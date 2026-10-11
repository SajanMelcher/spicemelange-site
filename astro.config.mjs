// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CERTS_LIVE_AT_BUILD } from './store-core/launch.js';

// Spice Certificates launch flag (Siona SJ2): when SPICE_CERTS_LIVE != 1 the /certificates/* pages are removed from the build.
const certsLaunchGate = {
  name: 'certs-launch-gate',
  hooks: { 'astro:build:done': ({ dir, logger }) => {
    if (CERTS_LIVE_AT_BUILD) return;
    rmSync(new URL('certificates/', dir), { recursive: true, force: true });
    logger.info(`SPICE_CERTS_LIVE off: removed ${fileURLToPath(new URL('certificates/', dir))}`);
  } },
};

export default defineConfig({
  site: 'https://thespicemelange.org',
  output: 'static',
  trailingSlash: 'ignore',
  build: { inlineStylesheets: 'auto' },
  vite: { plugins: [tailwindcss()] },
  integrations: [certsLaunchGate],
});
