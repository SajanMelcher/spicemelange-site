// Siona golden-path-learn faults GL1-GL13: privacy copy matches code; retention; allowlisted preview; course text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { makeD1 } from './d1-shim.mjs';
import { purge, RETENTION } from '../store-core/purge.js';
import { DELETION_CONTACT, SUB_RETENTION } from '../store-core/contact.js';
import { COURSE, CONNECTOR_PRICE, XAI_LINE } from '../store-core/course-content.js';
import { courseConfig } from '../store-core/course.js';
import { onRequestPost as courseSubscribePost, onRequestGet as courseSubscribeGet } from '../functions/api/course/subscribe.js';
import { onRequestGet as lessonsSubscribeGet, gateLive } from '../functions/api/lessons/subscribe.js';
import { lessonsConfig } from '../store-core/lessons.js';

const MIG = readdirSync(new URL('../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort().map((m) => new URL(`../migrations/${m}`, import.meta.url));
const NOW = Date.parse('2026-12-01T12:00:00Z'), H = 3_600_000, DAY = 86_400_000;
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('GL3: purge deletes course rate-limit IP-hash rows older than an hour, keeps the current hour', async () => {
  const db = makeD1(MIG);
  const ins = (k, ms) => db.prepare('INSERT INTO status_hits (order_id, bucket, n) VALUES (?1, ?2, 1)').bind(k, `cs:${Math.floor(ms / H)}`).run();
  await ins('course:ip:old', NOW - 2 * H); await ins('course:all', NOW - 2 * H); await ins('course:ip:new', NOW);
  const n = await purge(db, NOW);
  assert.equal(n.courseIpHashes, 2);
  assert.deepEqual(db.raw.prepare('SELECT order_id FROM status_hits').all().map((r) => r.order_id), ['course:ip:new']);
});
test('GL3: course signup fails closed without the salt secret (nothing stored)', async () => {
  const db = makeD1(MIG);
  const req = () => new Request('https://x.example/api/course/subscribe', { method: 'POST', headers: { origin: 'https://x.example', 'content-type': 'application/json', 'cf-connecting-ip': '1.2.3.4' }, body: JSON.stringify({ email: 'delivered@resend.dev', consent: true }) });
  const env = { STORE_DB: db, SUI_NETWORK: 'testnet', COURSE_TEST_RECIPIENTS: 'delivered@resend.dev' };
  const r = await courseSubscribePost({ request: req(), env });
  assert.equal(r.status, 503); assert.equal((await r.json()).reason, 'not_configured');
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM status_hits').get().n, 0);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM course_subs').get().n, 0);
  const ok = await courseSubscribePost({ request: req(), env: { ...env, DOWNLOAD_HMAC_SECRET: 'k'.repeat(48) } });
  assert.equal(ok.status, 200);
});
test('GL2 purge: stale unconfirmed, finished (30 d) and handed-off (7 d) rows go; old suggestions go; active rows stay', async () => {
  const db = makeD1(MIG);
  const cs = (id, status, o = {}) => db.raw.prepare(`INSERT INTO course_subs (id, net, email, track, goal, time, agent, consent_ms, consent_source, status, confirm_token, unsub_token, last_sent_ms, handoff_ms, confirmed_ms)
    VALUES (?, 'testnet', ?, 'pilgrim', 'botsafety', 'standard', 'no', ?, 'learn_quiz', ?, ?, ?, ?, ?, ?)`).run(id, `${id}@x.example`, o.consent ?? NOW, status, 'cc' + id, 'cu' + id, o.last ?? null, o.handoff ?? null, status === 'pending' || status === 'expired' ? null : NOW - 40 * DAY);
  cs('cs_oldpending', 'pending', { consent: NOW - 8 * DAY }); cs('cs_newpending', 'pending', { consent: NOW - 2 * DAY });
  cs('cs_olddone', 'done', { consent: NOW - 60 * DAY, last: NOW - 31 * DAY }); cs('cs_newdone', 'done', { consent: NOW - 40 * DAY, last: NOW - 5 * DAY });
  cs('cs_oldhandoff', 'handed_off', { handoff: NOW - 8 * DAY }); cs('cs_active', 'active', { consent: NOW - 400 * DAY });
  db.raw.prepare(`INSERT INTO course_suggestions (id, sub_id, received_ms, keyword, proposal) VALUES ('sg_old', 'cs_active', ?, 'slower', 'x'), ('sg_new', 'cs_active', ?, 'slower', 'x')`).run(NOW - 91 * DAY, NOW - DAY);
  await purge(db, NOW);
  assert.deepEqual(db.raw.prepare('SELECT id FROM course_subs ORDER BY id').all().map((r) => r.id), ['cs_active', 'cs_newdone', 'cs_newpending']);
  assert.deepEqual(db.raw.prepare('SELECT id FROM course_suggestions').all().map((r) => r.id), ['sg_new']);
});
test('GL5: one deletion contact (hello@) on /privacy/, the terms, and the unsubscribe pages; retention on /privacy/ comes from purge.js', () => {
  assert.equal(DELETION_CONTACT, 'hello@thespicemelange.org');
  assert.match(read('../src/content-static/LICENSE.md'), new RegExp(`Questions or deletion:\\*\\* email ${DELETION_CONTACT.replace('.', '\\.')}\\.`));
  const priv = read('../src/pages/privacy.astro');
  assert.match(priv, /DELETION_CONTACT/); assert.doesNotMatch(priv, /reserve@/);
  for (const f of ['../functions/api/lessons/unsubscribe.js', '../functions/api/course/unsubscribe.js']) { const s = read(f); assert.match(s, /DELETION_CONTACT/); assert.doesNotMatch(s, /reserve@thespicemelange/); }
  for (const s of [/feed/, /report counter/, /Referral codes/, /Paid orders, with the optional email and referral source, are kept/, /stored only in our own database/, /How long we keep subscribers/]) assert.match(priv, s);
  assert.deepEqual(SUB_RETENTION, { unconfirmedDays: RETENTION.unconfirmedDays, afterLastLessonDays: RETENTION.afterLastLessonDays, handoffDays: RETENTION.handoffDays, suggestionDays: RETENTION.suggestionDays });
});
test('GL6: GET /api/lessons/subscribe reports the legal gate; forms carry the on-hold sentence that hides only when live', async () => {
  const lcfg = lessonsConfig({ SUI_NETWORK: 'testnet', LESSONS_TEST_RECIPIENTS: 'delivered@resend.dev' });
  const held = async (u) => new Response(String(u).endsWith('/terms/') ? 'no line yet' : 'ok');
  const live = async (u) => new Response(String(u).endsWith('/terms/') ? 'emails are sent through Resend' : 'ok');
  assert.equal(await gateLive(lcfg, 'https://a.example', 1, held), false);
  assert.equal(await gateLive(lcfg, 'https://b.example', 1, live), true);
  for (const [f, id] of [['../src/components/Checkout.astro', 'co-lessons-hold'], ['../src/pages/store/download.astro', 'hl-hold']]) {
    const s = read(f);
    assert.match(s, new RegExp(`id="${id}">The lessons are on hold until our privacy page is live, then start daily after you confirm\\.`));
    assert.match(s, new RegExp(`lessonsLive === true\\) \\(?\\$\\('${id}'\\)`));
    assert.match(s, /through Resend\. See our <a class="text-ibad-300" href="\/privacy\/">privacy page<\/a>/);
  }
});
test('GL7: preview signups only for allowlisted test addresses', async () => {
  assert.equal(courseConfig({ SUI_NETWORK: 'testnet' }).signupOpen, false);
  const w = read('../wrangler.toml').split('[env.preview.vars]')[1].split('[[')[0];
  assert.match(w, /LESSONS_TEST_RECIPIENTS = "delivered@resend\.dev"/); assert.match(w, /COURSE_TEST_RECIPIENTS = "delivered@resend\.dev/);
  const r = await (await courseSubscribeGet({ env: { SUI_NETWORK: 'testnet' } })).json();
  assert.equal(r.open, false);
});
test('GL8-GL13 + license: course text uses the corrected wording', () => {
  const all = JSON.stringify(COURSE) + CONNECTOR_PRICE;
  assert.match(all, /rules your bot is told to follow/); assert.match(all, /Nothing outside the bot enforces them, so check them yourself/); // GL8
  assert.doesNotMatch(all, /one lesson a day|with me sending/); assert.match(all, /launching soon/); // GL9
  assert.match(all, /current releases are also backed up on Walrus/); assert.doesNotMatch(all, /archived on Walrus/); // GL10
  assert.match(all, /We plan to add Seal/); assert.match(all, /would release/); assert.doesNotMatch(all, /moving templates to Seal|is released only/); // GL11
  assert.match(CONNECTOR_PRICE, /per client/); assert.match(CONNECTOR_PRICE, /0\.01 USDC minimum/); assert.match(CONNECTOR_PRICE, /can't place trades or touch your funds/); // GL12
  assert.equal(XAI_LINE, 'Templates for Grok Bot agents; not affiliated with or endorsed by xAI.'); // GL13
  assert.match(read('../src/pages/learn/index.astro'), /no token\. \{XAI_LINE\}/);
  assert.match(all, /upgrades are free forever|upgrades free forever/); assert.doesNotMatch(all, /never cost extra/);
  for (const f of readdirSync(new URL('../content/hwi-lessons/cta/', import.meta.url))) assert.doesNotMatch(read(`../content/hwi-lessons/cta/${f}`), /never cost extra/, f);
});
test('Who helps us: every third-party origin in CSP connect-src is named on /privacy/; Resend line has no receipts; replies vs deletion contacts', async () => {
  const { CONNECT } = await import('../scripts/csp-headers.mjs');
  const priv = read('../src/pages/privacy.astro');
  for (const o of CONNECT) assert.ok(priv.includes(new URL(o).host), `${o} not named on /privacy/`);
  assert.match(priv, /Mysten Labs/);
  assert.doesNotMatch(priv, /lesson, course and receipt emails/);
  assert.match(priv, /every 10 and every 15 minutes\) and also as people use the site/);
  assert.match(priv, /sessionStorage/);
  const { REPLY_CONTACT } = await import('../store-core/contact.js');
  assert.match(read('../workers/hwi-lessons/wrangler.toml'), new RegExp(`LESSONS_REPLY_TO = "${REPLY_CONTACT.replace('.', '\\.')}"`));
  assert.match(priv, /Replies to lesson and course emails go to/);
});
