// privacy-prod (Siona GL15 + Priority 1; GL14 retired when the course went live, Sajan 9:31 AM PT): privacy copy matches code; retention.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { makeD1 } from './d1-shim.mjs';
import { purge, RETENTION } from '../store-core/purge.js';
import { DELETION_CONTACT, REPLY_CONTACT, SUB_RETENTION } from '../store-core/contact.js';
import { gateLive } from '../functions/api/lessons/subscribe.js';
import { lessonsConfig } from '../store-core/lessons.js';
import { courseHandoff } from '../store-core/course-handoff.js';
import { CONNECT } from '../scripts/csp-headers.mjs';

const MIG = readdirSync(new URL('../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort().map((m) => new URL(`../migrations/${m}`, import.meta.url));
const NOW = Date.parse('2026-12-01T12:00:00Z'), H = 3_600_000;
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('course on prod (Sajan 9:31 AM PT, GL14 retired): /learn/ pages, course functions and modules are present', () => {
  for (const p of ['../src/pages/learn', '../functions/api/course', '../store-core/course.js', '../store-core/course-content.js']) assert.equal(existsSync(new URL(p, import.meta.url)), true, p);
  assert.doesNotMatch(read('../store-core/lessons.js'), /from '\.\/course\.js'/, 'lessons.js still works without course.js');
});
test('GL14: lessons handoff is a soft no-op without course tables', async () => {
  const db = makeD1(MIG.filter((u) => !/0008|0009/.test(String(u))));
  assert.equal(await courseHandoff(db, { email: 'a@b.co', net: 'mainnet' }), null);
});
test('GL3: purge deletes course rate-limit IP-hash rows older than an hour', async () => {
  const db = makeD1(MIG);
  const ins = (k, ms) => db.prepare('INSERT INTO status_hits (order_id, bucket, n) VALUES (?1, ?2, 1)').bind(k, `cs:${Math.floor(ms / H)}`).run();
  await ins('course:ip:old', NOW - 2 * H); await ins('course:ip:new', NOW);
  assert.equal((await purge(db, NOW)).courseIpHashes, 1);
});
test('GL5 + privacy: one deletion contact, replies vs deletion, every CSP connect origin named, retention from purge.js', () => {
  assert.equal(DELETION_CONTACT, 'hello@thespicemelange.org'); assert.equal(REPLY_CONTACT, 'reserve@thespicemelange.org');
  assert.match(read('../src/content-static/LICENSE.md'), /Questions or deletion:\*\* email hello@thespicemelange\.org\./);
  assert.match(read('../workers/hwi-lessons/wrangler.toml'), /LESSONS_REPLY_TO = "reserve@thespicemelange\.org"/);
  const priv = read('../src/pages/privacy.astro');
  for (const o of CONNECT) assert.ok(priv.includes(new URL(o).host), o);
  for (const s of [/Mysten Labs/, /sessionStorage/, /every 10 and every 15 minutes\) and also as people use the site/, /Replies to lesson and course emails go to/, /stored only in our own database/, /Referral codes/]) assert.match(priv, s);
  assert.doesNotMatch(priv, /receipt emails|reserve@thespicemelange/);
  for (const f of ['../functions/api/lessons/unsubscribe.js']) assert.match(read(f), /DELETION_CONTACT/);
  assert.equal(SUB_RETENTION.unconfirmedDays, RETENTION.unconfirmedDays);
});
test('GL6: forms carry the on-hold sentence + Resend line; GET reports the gate', async () => {
  const lcfg = lessonsConfig({ SUI_NETWORK: 'mainnet', LESSONS_PRODUCTION_SENDING: '1' });
  assert.equal(await gateLive(lcfg, 'https://h.example', 1, async (u) => new Response(String(u).endsWith('/terms/') ? 'x' : 'ok')), false);
  assert.equal(await gateLive(lcfg, 'https://l.example', 1, async (u) => new Response(String(u).endsWith('/terms/') ? 'sent through Resend' : 'ok')), true);
  for (const f of ['../src/components/Checkout.astro', '../src/pages/store/download.astro']) {
    const s = read(f);
    assert.match(s, /The lessons are on hold until our privacy page is live, then start daily after you confirm\./);
    assert.match(s, /We'll email your lessons through Resend\. See our <a class="text-ibad-300" href="\/privacy\/">privacy page<\/a>/);
  }
});
test('build check: dist/learn/ is in the build (when built)', { skip: !existsSync(new URL('../dist/index.html', import.meta.url)) }, () => {
  assert.equal(existsSync(new URL('../dist/learn/index.html', import.meta.url)), true);
});
test('purge: status=unsubscribed rows (fallback / pre-GL2) -> HMAC suppression written first, then the row and sends deleted; no salt -> untouched', async () => {
  const { emailHash } = await import('../store-core/suppress.js');
  const SALT = 's'.repeat(32);
  const seed = () => {
    const db = makeD1(MIG);
    db.raw.prepare(`INSERT INTO orders (id, sku, net, amount_atomic, token_hash, created_ms, expires_ms, status, attempts, pay_to) VALUES ('SM-AAAAAAAAAA','fish-speakers','mainnet','1','h',?,?,'paid',0,'0x1')`).run(NOW, NOW);
    db.raw.prepare(`INSERT INTO lesson_subs (id, net, order_id, email, consent_ms, consent_source, status, next_day, confirm_token, unsub_token, unsub_ms) VALUES ('ls_old','mainnet','SM-AAAAAAAAAA','old@x.example',?,'checkout','unsubscribed',2,'lc_a','lu_a',?)`).run(NOW - 1000, NOW - 500);
    db.raw.prepare(`INSERT INTO lesson_sends (sub_id, day, sent_ms, mode) VALUES ('ls_old', 1, ?, 'production')`).run(NOW - 900);
    return db;
  };
  const off = seed();
  assert.deepEqual((await purge(off, NOW)).unsubscribedMinimized, { skip: 'no_suppression_salt' });
  assert.equal(off.raw.prepare('SELECT COUNT(*) n FROM lesson_subs').get().n, 1);
  const db = seed();
  const n = await purge(db, NOW, { salt: SALT });
  assert.equal(n.unsubscribedMinimized.lessons, 1);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM lesson_subs').get().n, 0);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM lesson_sends').get().n, 0);
  const sup = db.raw.prepare('SELECT * FROM email_suppressions').all().map((r) => ({ ...r }));
  assert.deepEqual(sup, [{ email_hash: await emailHash(SALT, 'old@x.example'), list: 'lessons', unsub_ms: NOW - 500 }]);
  assert.equal((await purge(db, NOW + 1, { salt: SALT })).unsubscribedMinimized.lessons, 0); // idempotent
});
