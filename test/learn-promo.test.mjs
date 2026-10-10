// learn-promo (Sajan 4:02 PM PT 10/10): the free course is linked from home, nav and footer with a share link, and the
// site no longer offers credit/points for ideas (the signal feed itself stays; the backend is unchanged).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const SHARE = 'https://thespicemelange.org/learn/?utm_source=share';
const IDEA_CREDIT = [/credit points/i, /earn(s)? credit/i, /ideas? (are|is) credited/i, /contributors listing/i, /\/api\/signals\/contributors/, /points?[^.\n]{0,40}(cashable|granted)/i, /"points(_cashable)?"\s*:/];
const SITE_FILES = ['public/llms.txt', 'public/.well-known/agent-join.json', 'src/pages/join-the-desk.astro', 'src/pages/index.astro', 'src/layouts/Base.astro', 'src/data/site.ts', 'src/components/LearnInvite.astro', 'src/pages/learn/index.astro'];

test('site sources carry no idea-credit offer', () => {
  for (const f of SITE_FILES) for (const re of IDEA_CREDIT) assert.doesNotMatch(read(f), re, `${f} matches ${re}`);
  const j = JSON.parse(read('public/.well-known/agent-join.json'));
  assert.equal(j.free_course.url, 'https://thespicemelange.org/learn/');
  assert.equal(j.free_course.share_url, SHARE);
});

test('free course: nav, home and share link wiring', () => {
  assert.match(read('src/data/site.ts'), /\{ href: '\/learn\/', label: 'Free course' \}/);
  assert.match(read('src/data/site.ts'), /LEARN_SHARE_URL = `\$\{LEARN_URL\}\?utm_source=share`/);
  assert.match(read('src/pages/index.astro'), /<LearnInvite/);
  assert.match(read('src/pages/join-the-desk.astro'), /<LearnInvite/);
  assert.match(read('public/llms.txt'), /learn\/\?utm_source=share/);
  // the Base.astro first-touch capture already covers /learn/, so utm_source=share is recorded like any other tag
  assert.match(read('src/layouts/Base.astro'), /\(store\|learn\|plumbline\|join-the-desk\)/);
});

function* html(dir) { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) yield* html(p); else if (n.endsWith('.html')) yield p; } }
const DIST = join(ROOT, 'dist');
test('built pages: share link as selectable text, /learn/ in nav+footer, no idea-credit copy', { skip: !existsSync(join(DIST, 'index.html')) }, () => {
  const home = readFileSync(join(DIST, 'index.html'), 'utf8');
  assert.ok(home.includes(SHARE), 'home shows the share link');
  assert.match(home, /class="[^"]*select-all[^"]*"[^>]*>https:\/\/thespicemelange\.org\/learn\/\?utm_source=share</);
  assert.ok((home.match(/href="\/learn\/"/g) ?? []).length >= 3, 'home links /learn/ in nav, footer and the invite');
  assert.ok(readFileSync(join(DIST, 'learn/index.html'), 'utf8').includes(SHARE));
  for (const f of html(DIST)) { const s = readFileSync(f, 'utf8'); for (const re of IDEA_CREDIT) assert.doesNotMatch(s, re, `${f} matches ${re}`); }
  assert.ok(!/<script[^>]+src="https?:/.test(home), 'no third-party scripts');
});
