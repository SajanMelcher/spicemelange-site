#!/usr/bin/env node
// Print one [vars] value from wrangler.toml for a deploy target, so the BUILD uses exactly what the Pages runtime gets.
//   node scripts/wrangler-var.mjs STORE_SINGLES_FOR_SALE production|preview
// Minimal reader: flat KEY = "value" lines inside [vars] or [env.preview.vars]. Exits 2 if the key is missing (fail closed).
import { readFileSync } from 'node:fs';
export function wranglerVar(toml, key, target) {
  const want = target === 'preview' ? 'env.preview.vars' : 'vars';
  let sec = null;
  for (const raw of toml.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').trim();
    const h = line.match(/^\[\[?([^\]]+)\]\]?$/); if (h) { sec = h[1].trim(); continue; }
    const m = line.match(/^([A-Z0-9_]+)\s*=\s*"([^"]*)"$/);
    if (m && sec === want && m[1] === key) return m[2];
  }
  return null;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [key, target] = process.argv.slice(2);
  const v = wranglerVar(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'), key, target);
  if (v === null) { console.error(`wrangler-var: ${key} missing for ${target}`); process.exit(2); }
  process.stdout.write(v);
}
