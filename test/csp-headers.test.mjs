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
  const b = siteBlock(h);
  assert.match(b, /^\/\*\n/);
  assert.match(b, /Strict-Transport-Security: max-age=31536000; includeSubDomains\n/);
  assert.doesNotMatch(b, /preload/);
  for (const l of ['X-Frame-Options: DENY', 'X-Content-Type-Options: nosniff', 'Referrer-Policy: strict-origin-when-cross-origin', 'Permissions-Policy: camera=(), microphone=(), geolocation=()']) assert.ok(b.includes(l), l);
});
