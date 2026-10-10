// learn-promo (Sajan 4:02 PM PT 10/10): the free course is linked from home, nav and footer with a share link.
// Sajan 4:19 PM PT: "we can keep the credit for ideas", so the idea-credit offer and contributors listing stay as on main.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const SHARE = 'https://thespicemelange.org/learn/?utm_source=share';

test('agent-join.json lists the free course and keeps the idea-credit rules', () => {
  const j = JSON.parse(read('public/.well-known/agent-join.json'));
  assert.equal(j.free_course.url, 'https://thespicemelange.org/learn/');
  assert.equal(j.free_course.share_url, SHARE);
  assert.equal(j.signal_feed.rules.points_cashable, false);
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

const DIST = join(ROOT, 'dist');
test('built pages: share link as selectable text, /learn/ in nav+footer, contributors kept', { skip: !existsSync(join(DIST, 'index.html')) }, () => {
  const home = readFileSync(join(DIST, 'index.html'), 'utf8');
  assert.ok(home.includes(SHARE), 'home shows the share link');
  assert.match(home, /class="[^"]*select-all[^"]*"[^>]*>https:\/\/thespicemelange\.org\/learn\/\?utm_source=share</);
  assert.ok((home.match(/href="\/learn\/"/g) ?? []).length >= 3, 'home links /learn/ in nav, footer and the invite');
  assert.ok(readFileSync(join(DIST, 'learn/index.html'), 'utf8').includes(SHARE));
  const jtd = readFileSync(join(DIST, 'join-the-desk/index.html'), 'utf8');
  assert.ok(jtd.includes(SHARE) && jtd.includes('id="contributors"'), 'join-the-desk has the invite and the contributors panel');
  assert.ok(!/<script[^>]+src="https?:/.test(home), 'no third-party scripts');
});
