// Post-build: add the site-wide security headers to dist/_headers (Siona prod scan, Oct 10 2026).
// The CSP allows only same-origin scripts plus the SHA-256 of every inline <script> the build actually emits, so
// no 'unsafe-inline' for scripts. Inline <style> elements are hashed too; style="" attributes (starfield delays,
// opacity) need style-src-attr 'unsafe-inline' (attributes can't run code). Fails the build if anything looks off.
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const DIST = process.argv[2] ?? 'dist';
// Cross-origin endpoints the shipped pages call from the browser. Keep this list exact.
export const CONNECT = ['https://deepbook-indexer.mainnet.mystenlabs.com'];
// No third-party script hosts. Cloudflare Web Analytics was allowed here until Siona's finding (terms s9: "no third-party
// trackers"); the allowance is removed, so an injected beacon is blocked by the CSP. Turn the beacon off in the Pages
// project too (Workers & Pages > spicemelange-site > Metrics > Web Analytics) so it isn't injected at all.
export const SCRIPT_HOSTS = [];
// Wallet-signing pages (/certificates/prove-wallet/, /certificates/admin/). Siona hold, Sajan 10/10 10:15 PM PT: per-route
// CSP, no wildcard https:/wss:. On these routes the site CSP is detached and replaced by a tighter one: script-src is
// 'self' plus ONLY the sha256 of the inline scripts those two pages emit (not the site-wide hash list), and connect-src
// is 'self' + Sui mainnet fullnode + Sui GraphQL mainnet + WALLET_HOSTS. WALLET_HOSTS lists specific hosts that an
// injected in-app wallet fetches from the page realm; add one only after seeing it in the page's "page blocked:" error
// text (wallet-errors.js), exact origin, never a wildcard. None observed yet.
export const WALLET_PATHS = ['/certificates/prove-wallet/', '/certificates/admin/'];
export const SUI_MAINNET = ['https://fullnode.mainnet.sui.io', 'https://graphql.mainnet.sui.io'];
export const WALLET_HOSTS = [];
export const WALLET_CONNECT = ["'self'", ...SUI_MAINNET, ...WALLET_HOSTS];
const sha = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
function* html(dir) {
  for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) yield* html(p); else if (n.endsWith('.html')) yield p; }
}
export function inlineHashes(dist = DIST) {
  const scripts = new Set(), styles = new Set();
  for (const f of html(dist)) {
    const s = readFileSync(f, 'utf8');
    for (const m of s.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
      const a = m[1] ?? '';
      if (/\ssrc=/.test(a) || /type="application\/(ld\+)?json"/.test(a)) continue; // external, or data blocks (never executed)
      scripts.add(sha(m[2]));
    }
    for (const m of s.matchAll(/<style(\s[^>]*)?>([\s\S]*?)<\/style>/g)) styles.add(sha(m[2]));
  }
  return { scripts: [...scripts].sort(), styles: [...styles].sort() };
}
export function csp({ scripts, styles }, connect = ["'self'", ...CONNECT]) {
  return [
    "default-src 'self'",
    ['script-src', "'self'", ...SCRIPT_HOSTS, ...scripts].join(' '),
    "style-src 'self'",
    `style-src-elem 'self' ${styles.join(' ')}`.trim(),
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src ${connect.join(' ')}`,
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}
export function siteBlock(h) {
  return ['/*',
    '  Strict-Transport-Security: max-age=31536000; includeSubDomains',
    `  Content-Security-Policy: ${csp(h)}`,
    '  X-Frame-Options: DENY',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    ''].join('\n');
}
// h: { [path]: {scripts, styles} } from routeHashes(); each route gets only its own inline hashes.
export function walletBlock(h) {
  return WALLET_PATHS.flatMap((p) => {
    const r = h[p] ?? { scripts: [], styles: [] };
    if ([...WALLET_CONNECT].some((c) => /^(https?:|wss?:)$|\*/.test(c))) throw new Error('wildcard in wallet connect-src');
    return [p + '*', '  ! Content-Security-Policy', `  Content-Security-Policy: ${csp(r, WALLET_CONNECT)}`, '  X-Robots-Tag: noindex, nofollow', '  Cache-Control: no-store'];
  }).join('\n') + '\n';
}
export function routeHashes(dist = DIST) {
  const out = {};
  for (const p of WALLET_PATHS) { try { statSync(join(dist, p)); out[p] = inlineHashes(join(dist, p)); } catch {} }
  return out;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const h = inlineHashes();
  const block = siteBlock(h);
  const v = block.split('\n').find((l) => l.includes('Content-Security-Policy'));
  if (v.length > 1900) { console.error(`CSP too long for Cloudflare _headers (${v.length})`); process.exit(1); }
  const path = join(DIST, '_headers');
  const cur = readFileSync(path, 'utf8');
  if (cur.includes('Strict-Transport-Security')) { console.error('dist/_headers already has a site-wide block'); process.exit(1); }
  writeFileSync(path, block + cur + (cur.endsWith('\n') ? '' : '\n') + (Object.keys(routeHashes()).length ? walletBlock(routeHashes()) : ''));
  console.log(`_headers: site-wide block added (${h.scripts.length} inline script hashes, ${h.styles.length} style hashes, CSP ${v.length} chars)`);
}
