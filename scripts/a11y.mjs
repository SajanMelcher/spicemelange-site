// Quick axe-core accessibility pass against the local preview (localhost only).
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const axe = readFileSync('node_modules/axe-core/axe.min.js', 'utf8');
const BASE = 'http://127.0.0.1:4321';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await b.newPage();
for (const path of ['/', '/join/', '/plumbline/', '/dashboard/', '/desk/']) {
  await p.goto(BASE + path, { waitUntil: 'networkidle' });
  await p.addScriptTag({ content: axe });
  const r = await p.evaluate(async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'] })).violations.map((v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
  console.log(path, r.length ? r : 'no violations');
}
await b.close();
