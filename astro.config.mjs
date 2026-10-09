// @ts-check
import { defineConfig } from 'astro/config';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  site: 'https://thespicemelange.org',
  output: 'static',
  trailingSlash: 'ignore',
  build: { inlineStylesheets: 'auto' },
  vite: { plugins: [tailwindcss()] },
});
