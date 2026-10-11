// Site-wide security headers (scripts/csp-headers.mjs): inline scripts are allowed only by hash, never 'unsafe-inline'.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { inlineHashes, csp, siteBlock } from '../scripts/csp-headers.mjs';

test('hashes every executable inline script and style, skips src= and JSON data blocks', () => {
  const d = mkdtempSync(join(tmpdir(), 'csp-'));
  mkdirSync(join(d, 'a'));
  writeFileSync(join(d, 'index.html'), '<script>one()</script><script type="module">two()</script><script src="/x.js"></script><script type="application/ld+json">{"a":1}</script><style>.a{}</style>');
  writeFileSync(join(d, 'a', 'index.html'), '<script>one()</script>');
  const h = inlineHashes(d);
  const want = (s) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;
  assert.deepEqual(h.scripts, [want('one()'), want('two()')].sort());
  assert.deepEqual(h.styles, [want('.a{}')]);
  const c = csp(h);
  assert.doesNotMatch(c.split(';').find((x) => x.includes('script-src')), /unsafe-inline|unsafe-eval|\*/);
  for (const d of ["default-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "img-src 'self' data:", "object-src 'none'"]) assert.ok(c.includes(d), d);
  assert.doesNotMatch(c, /cloudflareinsights/, 'no third-party analytics allowance (terms s9: no third-party trackers)');
  const b = siteBlock(h);
  assert.match(b, /^\/\*\n/);
  assert.match(b, /Strict-Transport-Security: max-age=31536000; includeSubDomains\n/);
  assert.doesNotMatch(b, /preload/);
  for (const l of ['X-Frame-Options: DENY', 'X-Content-Type-Options: nosniff', 'Referrer-Policy: strict-origin-when-cross-origin', 'Permissions-Policy: camera=(), microphone=(), geolocation=()']) assert.ok(b.includes(l), l);
});

// Siona hold / Sajan 10/10 10:15 PM PT: per-route CSP on the wallet pages, hash-pinned, no wildcard connect-src.
import { walletBlock, WALLET_PATHS, csp as cspFn, siteBlock as siteFn } from '../scripts/csp-headers.mjs';
test('wallet-signing routes: own hashes only, connect-src self + Sui mainnet fullnode/GraphQL, no wildcard, noindex', () => {
  assert.deepEqual(WALLET_PATHS, ['/certificates/prove-wallet/', '/certificates/admin/']);
  const h = { '/certificates/prove-wallet/': { scripts: ["'sha256-p'"], styles: [] }, '/certificates/admin/': { scripts: ["'sha256-a'"], styles: [] } };
  const b = walletBlock(h);
  for (const p of WALLET_PATHS) assert.ok(b.includes(p + '*\n  ! Content-Security-Policy\n'));
  const lines = b.split('\n').filter((l) => l.includes('Content-Security-Policy:'));
  assert.equal(lines.length, 2);
  assert.match(lines[0], /script-src 'self' 'sha256-p';/); assert.doesNotMatch(lines[0], /sha256-a/);
  assert.match(lines[1], /script-src 'self' 'sha256-a';/); assert.doesNotMatch(lines[1], /sha256-p/);
  for (const l of lines) {
    assert.match(l, /connect-src 'self' https:\/\/fullnode\.mainnet\.sui\.io https:\/\/graphql\.mainnet\.sui\.io;/);
    assert.doesNotMatch(l, /https: |wss:|\*|unsafe-eval|testnet/); assert.match(l, /frame-ancestors 'none'/);
  }
  assert.equal((b.match(/X-Robots-Tag: noindex, nofollow/g) || []).length, 2);
  assert.match(siteFn({ scripts: ["'sha256-x'"], styles: [] }), /connect-src 'self' https:\/\/deepbook-indexer\.mainnet\.mystenlabs\.com;/); // rest of the site unchanged
  assert.equal(cspFn({ scripts: [], styles: [] }).includes('sui.io'), false);
});
