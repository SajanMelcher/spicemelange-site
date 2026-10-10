// Tleilaxu Run 9: Cloudflare Email Address Obfuscation must not touch our pages. Every visible address and mailto in the
// built HTML (and in the Functions confirm/unsubscribe pages) sits inside <!--email_off--> … <!--/email_off-->.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { page } from '../store-core/lessons-page.js';

const EMAIL = /mailto:|[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;
function uncovered(html) {
  const bad = [];
  for (const m of html.matchAll(EMAIL)) {
    const before = html.slice(0, m.index);
    const open = before.lastIndexOf('<!--email_off-->'), close = before.lastIndexOf('<!--/email_off-->');
    if (!(open > close)) bad.push(m[0]);
  }
  return bad;
}
const DIST = new URL('../dist/', import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.html') ? [p] : []; });

test('built HTML: every address/mailto is inside email_off, on every page (incl. /terms/, /privacy/, footer, store, download)', { skip: !existsSync(join(DIST, 'index.html')) }, () => {
  const files = walk(DIST);
  assert.ok(files.length > 10);
  let seen = 0;
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    seen += (s.match(EMAIL) ?? []).length;
    assert.deepEqual(uncovered(s), [], f.replace(DIST, ''));
    assert.doesNotMatch(s, /email-decode|__cf_email__/);
  }
  assert.ok(seen > 0, 'expected some addresses in the build');
  for (const p of ['terms/index.html', 'privacy/index.html']) assert.match(readFileSync(join(DIST, p), 'utf8'), /hello@thespicemelange\.org/);
});
test('Functions pages (confirm/unsubscribe): addresses inside email_off', async () => {
  const html = await page(200, 'x', ['Questions or deletion: hello@thespicemelange.org.']).text();
  assert.deepEqual(uncovered(html), []);
});
