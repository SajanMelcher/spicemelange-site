// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CERTS_LIVE_AT_BUILD } from './store-core/launch.js';

// Drop _astro .js chunks no remaining HTML page reaches (directly or through imports), so stripped pages' scripts aren't served.
function pruneOrphans(dir, logger, why) {
  const root = fileURLToPath(dir), astroDir = join(root, '_astro');
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const js = existsSync(astroDir) ? readdirSync(astroDir).filter((f) => /\.m?js$/.test(f)) : [];
  const seen = new Set(), queue = walk(root).filter((f) => f.endsWith('.html'));
  while (queue.length) {
    const txt = readFileSync(queue.shift(), 'utf8');
    for (const f of js) if (!seen.has(f) && txt.includes(f)) { seen.add(f); queue.push(join(astroDir, f)); }
  }
  const orphans = js.filter((f) => !seen.has(f));
  for (const o of orphans) rmSync(join(astroDir, o), { force: true });
  logger.info(`${why}: removed ${orphans.length} unreferenced _astro chunk(s): ${orphans.join(', ')}`);
  return { root, walk };
}
// Spice Certificates launch flag (Siona SJ2): when SPICE_CERTS_LIVE != 1 the /certificates/* pages are removed from the build.
const certsLaunchGate = {
  name: 'certs-launch-gate',
  hooks: { 'astro:build:done': ({ dir, logger }) => {
    // Wallet-signing pages (prove-wallet, admin): held off the prod domain until Siona passes them (WALLET_PAGES_LIVE).
    // /sign/ is the one prod-domain signing page; prove-wallet + admin never ship in a production build (preview only).
    const strip = [...(process.env.WALLET_PAGES_LIVE !== '1' ? ['sign/', 'certificates/prove-wallet/', 'certificates/admin/'] : []),
      ...(process.env.DEPLOY_MODE === 'production' ? ['certificates/prove-wallet/', 'certificates/admin/'] : [])];
    for (const r of new Set(strip)) { rmSync(new URL(r, dir), { recursive: true, force: true }); logger.info(`wallet pages: removed /${r}`); }
    if (CERTS_LIVE_AT_BUILD) { if (strip.length) pruneOrphans(dir, logger, 'wallet pages'); return; }
    rmSync(new URL('certificates/', dir), { recursive: true, force: true });
    logger.info(`SPICE_CERTS_LIVE off: removed ${fileURLToPath(new URL('certificates/', dir))}`);
    // Siona SJ17: drop the now-orphaned scripts (wallet sign-in, holder, buy) from _astro/, so neither Pages nor the Walrus mirror
    // serves them. A .js chunk is kept only if a remaining HTML page reaches it (directly or through imports). Then fail the build if
    // any served file other than _headers still mentions certificates.
    const { root, walk } = pruneOrphans(dir, logger, 'SPICE_CERTS_LIVE off');
    const left = walk(root).filter((f) => !f.endsWith('/_headers') && /certificat/i.test(readFileSync(f, 'latin1')));
    if (left.length) throw new Error(`SJ17: certificate content left in a certs-off build: ${left.map((f) => f.slice(root.length)).join(', ')}`);
  } },
};

export default defineConfig({
  site: 'https://thespicemelange.org',
  output: 'static',
  trailingSlash: 'ignore',
  build: { inlineStylesheets: 'auto' },
  // Siona item 6: testnet-only client code (wallet + DeepBook testnet trade panels) is compiled out of mainnet builds.
  vite: { plugins: [tailwindcss()], define: { __CERT_TESTNET__: JSON.stringify((process.env.SPICE_CERT_REDEEM_NETWORK ?? 'testnet') !== 'mainnet') } },
  integrations: [certsLaunchGate],
});
