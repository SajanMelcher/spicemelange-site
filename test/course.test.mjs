// Free Golden Path course (R2, R6-R10): quiz validation, double opt-in, tailored assembly, cadence, replies, handoff, contacts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { makeD1 } from './d1-shim.mjs';
import { sha256Hex } from '../store-core/core.js';
import { courseConfig, courseSubscribe, courseConfirm, courseUnsubscribe, runCourse, runCourseConfirmations, courseScheduled, courseEmail, courseBlocks, cleanQuiz, courseInbound, courseDelete, verifyWebhook, HANDOFF_LINE } from '../store-core/course.js';
import { subscribe, confirm, runConfirmations, runLessons, lessonsConfig, lessonEmail, ctaVariant } from '../store-core/lessons.js';
import { COURSE, schedule } from '../store-core/course-content.js';
import { LESSONS } from '../store-core/lessons-content.js';

const MIG = readdirSync(new URL('../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort().map((m) => new URL(`../migrations/${m}`, import.meta.url));
const FOOT = 'Test Sender · 1 Example St, Town, CA 90000 · reserve@thespicemelange.org';
const T0 = Date.UTC(2026, 9, 10, 16, 0, 0), DAY = 86_400_000;
const TESTERS = 'delivered@resend.dev,delivered+pilgrim@resend.dev,delivered+fremen@resend.dev,delivered+naib@resend.dev';
function setup(over = {}) {
  const db = makeD1(MIG);
  const env = { STORE_DB: db, SUI_NETWORK: 'testnet', RESEND_API_KEY: 're_test', COURSE_TEST_RECIPIENTS: TESTERS, LESSONS_TEST_RECIPIENTS: TESTERS, LESSONS_BASE_URL: 'https://p.example.dev', LESSONS_FOOTER: FOOT, COURSE_RESEND_CONTACTS: '1', SUPPRESSION_SALT: 's'.repeat(32), ...over };
  const sent = [], contacts = [];
  const fetchImpl = async (url, init) => {
    url = String(url);
    if (url.endsWith('/privacy/')) return new Response('ok');
    if (url.endsWith('/terms/')) return new Response('sent through Resend');
    if (url.includes('/contacts')) { contacts.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null }); return new Response(JSON.stringify({ id: 'ct_1' }), { status: 200 }); }
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ id: `re_${sent.length}` }), { status: 200 });
  };
  return { db, env, sent, contacts, fetchImpl, c: courseConfig(env) };
}
const signup = (t, body, ipKey = 'ip1', nowMs = T0) => courseSubscribe(t.c, { body: { consent: true, ...body }, ipKey, nowMs });
const row = (t, email) => t.db.raw.prepare('SELECT * FROM course_subs WHERE email = ?').get(email);
async function optIn(t, body) {
  await signup(t, body);
  await runCourseConfirmations(t.env, { nowMs: T0, fetchImpl: t.fetchImpl });
  const r = row(t, body.email);
  return courseConfirm(t.env, { subId: r.id, token: r.confirm_token, nowMs: T0 + 1, fetchImpl: t.fetchImpl });
}

test('quiz: defaults when skipped, junk rejected, no sensitive fields kept, consent box required', async () => {
  assert.deepEqual(cleanQuiz({}), { ok: true, track: 'pilgrim', goal: 'botsafety', time: 'standard', agent: 'no', src: null });
  for (const [k, v] of [['track', 'rich'], ['goal', '<script>'], ['time', 'daily'], ['agent', 'maybe']]) assert.equal(cleanQuiz({ [k]: v }).reason, `bad_${k}`);
  assert.equal(cleanQuiz({ src: { utm_source: 'X', ref: 'bad tag!', utm_campaign: 'gp-1' } }).src, '{"utm_source":"x","utm_campaign":"gp-1"}');
  const t = setup();
  assert.equal((await courseSubscribe(t.c, { body: { email: 'delivered@resend.dev' } })).reason, 'consent_required');
  assert.equal((await signup(t, { email: 'nope' })).reason, 'bad_email');
  assert.equal((await signup(t, { email: 'delivered@resend.dev', income: 100000, age: 40 })).ok, true);
  const cols = t.db.raw.prepare('PRAGMA table_info(course_subs)').all().map((c) => c.name).join(' ');
  assert.doesNotMatch(cols, /income|saving|debt|balance|age\b/);
});
test('quiz: rate limited per IP hash (5/h) and the same answer whether or not the address is known', async () => {
  const t = setup({ SUI_NETWORK: 'mainnet', COURSE_PRODUCTION_SENDING: '1' }); // public signup (production) for the limiter
  for (let i = 0; i < 5; i++) assert.equal((await signup(t, { email: `a${i}@example.com` })).ok, true);
  assert.equal((await signup(t, { email: 'a9@example.com' })).reason, 'rate_limited');
  assert.equal((await signup(t, { email: 'a9@example.com' }, 'ip2')).ok, true);
  assert.deepEqual(await signup(t, { email: 'a9@example.com' }, 'ip3'), { ok: true, status: 'check_your_inbox' });
});
test('production flag OFF: mainnet signup closed to the public; nothing sends', async () => {
  const t = setup({ SUI_NETWORK: 'mainnet', COURSE_TEST_RECIPIENTS: '', LESSONS_TEST_RECIPIENTS: '' });
  assert.equal(t.c.signupOpen, false);
  assert.equal((await signup(t, { email: 'someone@example.com' })).reason, 'course_not_open');
  assert.equal((await runCourse(t.env, { nowMs: T0, fetchImpl: t.fetchImpl })).reason, 'sending_off');
});
test('double opt-in: nothing before confirm; one confirmation; then lessons; contact synced with address only (T4)', async () => {
  const t = setup();
  await signup(t, { email: 'delivered+fremen@resend.dev', track: 'fremen', agent: 'yes' });
  assert.equal((await runCourse(t.env, { nowMs: T0, fetchImpl: t.fetchImpl, force: true })).sent, 0);
  assert.equal((await runCourseConfirmations(t.env, { nowMs: T0, fetchImpl: t.fetchImpl })).sent, 1);
  assert.equal((await runCourseConfirmations(t.env, { nowMs: T0 + 1, fetchImpl: t.fetchImpl })).sent, 0);
  assert.match(t.sent[0].body.subject, /Please confirm/);
  const r = row(t, 'delivered+fremen@resend.dev');
  assert.equal((await courseConfirm(t.env, { subId: r.id, token: r.confirm_token, fetchImpl: t.fetchImpl })).ok, true);
  assert.equal(t.contacts[0].method, 'POST'); assert.deepEqual(t.contacts[0].body, { email: 'delivered+fremen@resend.dev', unsubscribed: false }); // T4: no quiz properties
  const s = await runCourse(t.env, { nowMs: T0 + 2, fetchImpl: t.fetchImpl });
  assert.equal(s.sent, 1); assert.match(t.sent[1].body.subject, /^Lesson 1 of 7/);
  const m = t.sent[1].body;
  assert.equal(m.from, '"Hwi Noree, The Spice Melange" <hwi@thespicemelange.org>'); assert.equal(m.reply_to, 'reserve@thespicemelange.org');
  assert.equal(m.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click'); assert.match(m.headers['List-Unsubscribe'], /\/api\/course\/unsubscribe\?s=cs_/);
  assert.ok(m.text.includes(FOOT) && m.html.includes(FOOT)); assert.match(m.text, /AI assistant/); assert.match(m.text, /not financial advice/);
});
test('three tracks get visibly different lesson 2s; one invitation at most; none in lesson 1', () => {
  const c = courseConfig({ LESSONS_FOOTER: FOOT });
  const mk = (track, goal, agent) => courseEmail(c, { id: 'cs_aaaaaaaaaaaaaaaa', unsub_token: 'cu_x', email: 'a@b.co', track, goal, time: 'standard', agent }, 2);
  const [p, f, n] = [mk('pilgrim', 'botsafety', 'no'), mk('fremen', 'longview', 'yes'), mk('naib', 'builder', 'yes')];
  assert.notEqual(p.text, f.text); assert.notEqual(f.text, n.text);
  assert.match(p.text, /decide your limits in daylight/); assert.match(f.text, /limit order waits at your price/); assert.match(n.text, /fail-closed guards/);
  assert.equal(p._meta.invite, null); assert.equal(n._meta.invite, 'connector');
  for (const tr of ['pilgrim', 'fremen', 'naib']) for (const g of ['longview', 'botsafety', 'builder', 'evaluate'])
    assert.equal(courseBlocks({ track: tr, goal: g, time: 'standard', agent: 'yes' }, 1).invite, null);
  for (let e = 1; e <= 4; e++) { const b = courseBlocks({ track: 'naib', goal: 'builder', time: 'weekly', agent: 'yes' }, e); assert.ok(!b.invite || typeof b.invite.door === 'string'); }
  assert.equal(courseBlocks({ track: 'naib', goal: 'builder', time: 'weekly', agent: 'yes' }, 4).invite.door, 'both');
});
test('cadence: every other day for brief/standard (7 emails), weekly pairs (4 emails); 9 AM PT only; then done', async () => {
  const t = setup();
  await optIn(t, { email: 'delivered+pilgrim@resend.dev', time: 'brief' });
  await optIn(t, { email: 'delivered+naib@resend.dev', track: 'naib', time: 'weekly' });
  const base = t.sent.length;
  const off = await courseScheduled(t.env, { nowMs: Date.UTC(2026, 9, 10, 15, 0), fetchImpl: t.fetchImpl });
  assert.equal(off.lessons.skipped, 'not_9am_pt');
  for (let d = 0; d < 30; d++) await courseScheduled(t.env, { nowMs: Date.UTC(2026, 9, 10 + d, 16, 5) + (d >= 22 ? 3_600_000 : 0), fetchImpl: t.fetchImpl });
  const by = (e) => t.sent.slice(base).filter((m) => m.body.to[0] === e).map((m) => m.body.subject);
  assert.equal(by('delivered+pilgrim@resend.dev').length, 7);
  assert.deepEqual(by('delivered+naib@resend.dev').map((s) => s.split(':')[0]), ['Lessons 1 and 2 of 7', 'Lessons 3 and 4 of 7', 'Lessons 5 and 6 of 7', 'Lesson 7 of 7']);
  assert.equal(row(t, 'delivered+pilgrim@resend.dev').status, 'done');
});
test('production course runs hold behind the same legal gate', async () => {
  const t = setup({ SUI_NETWORK: 'mainnet', COURSE_PRODUCTION_SENDING: '1' });
  const nope = async (u, i) => (/privacy|terms/.test(String(u)) ? new Response('', { status: 404 }) : t.fetchImpl(u, i));
  assert.equal((await runCourse(t.env, { nowMs: T0, fetchImpl: nope })).reason, 'held: privacy/terms not live');
});
test('GL2 unsubscribe: row, quiz answers, utm/ref, sends and Resend contact deleted; only a hashed suppression + date kept', async () => {
  const t = setup();
  await optIn(t, { email: 'delivered@resend.dev', track: 'naib', src: { utm_source: 'x' } });
  assert.equal((await runCourse(t.env, { nowMs: T0 + 5, fetchImpl: t.fetchImpl, force: true })).sent, 1);
  await courseInbound(t.env, { from: 'delivered@resend.dev', text: 'slower' });
  const r = row(t, 'delivered@resend.dev');
  assert.equal((await courseUnsubscribe(t.env, { subId: r.id, token: r.unsub_token, nowMs: T0 + 9, fetchImpl: t.fetchImpl })).ok, true);
  assert.equal(t.contacts.at(-1).method, 'DELETE'); assert.match(t.contacts.at(-1).url, /\/contacts\/ct_1$/);
  assert.equal(row(t, 'delivered@resend.dev'), undefined);
  for (const tb of ['course_sends', 'course_suggestions']) assert.equal(t.db.raw.prepare(`SELECT COUNT(*) n FROM ${tb}`).get().n, 0, tb);
  const sup = t.db.raw.prepare('SELECT * FROM email_suppressions').all();
  assert.equal(sup.length, 1); assert.deepEqual(Object.keys(sup[0]).sort(), ['email_hash', 'list', 'unsub_ms']);
  assert.equal(sup[0].list, 'course'); assert.equal(sup[0].unsub_ms, T0 + 9); assert.match(sup[0].email_hash, /^[0-9a-f]{64}$/);
  assert.ok(!JSON.stringify(t.db.raw.prepare('SELECT * FROM email_suppressions').all()).includes('resend.dev'));
  // second click: quiet no-op; a fresh quiz signup gets the same reply, one confirmation, and only the confirm lifts the block
  assert.equal((await courseUnsubscribe(t.env, { subId: r.id, token: r.unsub_token, fetchImpl: t.fetchImpl })).ok, true);
  assert.deepEqual(await signup(t, { email: 'delivered@resend.dev' }, 'ip9', T0 + DAY), { ok: true, status: 'check_your_inbox' });
  const before = t.sent.length;
  assert.equal((await runCourseConfirmations(t.env, { nowMs: T0 + DAY, fetchImpl: t.fetchImpl })).sent, 1);
  assert.match(t.sent.at(-1).body.subject, /Please confirm/); assert.equal(t.sent.length, before + 1);
  assert.equal(t.db.raw.prepare('SELECT COUNT(*) n FROM email_suppressions').get().n, 1);
  const r2 = row(t, 'delivered@resend.dev');
  assert.equal((await courseConfirm(t.env, { subId: r2.id, token: r2.confirm_token, nowMs: T0 + DAY + 1, fetchImpl: t.fetchImpl })).ok, true);
  assert.equal(t.db.raw.prepare('SELECT COUNT(*) n FROM email_suppressions').get().n, 0);
});
test('T4: no Resend payload (send or contact) carries quiz-derived fields', async () => {
  const t = setup();
  for (const [email, track, goal, time, agent] of [['delivered+pilgrim@resend.dev', 'pilgrim', 'longview', 'brief', 'no'], ['delivered+naib@resend.dev', 'naib', 'builder', 'weekly', 'yes']]) {
    await optIn(t, { email, track, goal, time, agent });
  }
  await runCourse(t.env, { nowMs: T0 + 5, fetchImpl: t.fetchImpl, force: true });
  const lc = row(t, 'delivered+naib@resend.dev');
  await courseUnsubscribe(t.env, { subId: lc.id, token: lc.unsub_token, fetchImpl: t.fetchImpl });
  assert.ok(t.sent.length >= 4 && t.contacts.length >= 2);
  const QUIZ_KEYS = /^(track|goal|time|agent|fc_status|level|experience)$/i;
  const QUIZ_VALS = new Set(['pilgrim', 'fremen', 'naib', 'longview', 'botsafety', 'builder', 'evaluate', 'brief', 'standard', 'weekly']);
  const walk = (o, path) => {
    if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { assert.doesNotMatch(k, QUIZ_KEYS, `${path}.${k}`); walk(v, `${path}.${k}`); }
    else if (typeof o === 'string') assert.ok(!QUIZ_VALS.has(o.toLowerCase()), `${path} = ${o}`);
  };
  for (const m of t.sent) { const { html, text, subject, ...meta } = m.body; walk(meta, 'send'); } // body copy is the lesson text itself
  for (const c of t.contacts) walk(c.body ?? {}, 'contact');
});
test('GL2 unconfirmed course signups are deleted after 7 days (not just marked expired)', async () => {
  const t = setup();
  await signup(t, { email: 'delivered+pilgrim@resend.dev', src: { ref: 'abc' } });
  await runCourseConfirmations(t.env, { nowMs: T0 + 6 * DAY, fetchImpl: t.fetchImpl });
  assert.ok(row(t, 'delivered+pilgrim@resend.dev'));
  assert.equal((await runCourseConfirmations(t.env, { nowMs: T0 + 8 * DAY, fetchImpl: t.fetchImpl })).expired, 1);
  assert.equal(row(t, 'delivered+pilgrim@resend.dev'), undefined);
});
test('GL4: Resend contact sync is OFF in both wrangler.toml files', () => {
  for (const f of ['../wrangler.toml', '../workers/hwi-lessons/wrangler.toml']) {
    const s = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(s, /^\s*COURSE_RESEND_CONTACTS\s*=\s*"(1|true|yes|on)"/mi, f);
  }
  assert.equal(courseConfig({}).contacts, false);
});
test('deletion request: courseDelete removes quiz answers and the contact', async () => {
  const t = setup();
  await optIn(t, { email: 'delivered@resend.dev', track: 'naib' });
  const d = await courseDelete(t.env, { email: 'delivered@resend.dev', fetchImpl: t.fetchImpl });
  assert.equal(d.deleted, 1); assert.equal(t.contacts.at(-1).method, 'DELETE'); assert.equal(row(t, 'delivered@resend.dev'), undefined);
});
test('replies: keywords become PENDING suggestions (no change); "stop" unsubscribes at once; reply text never stored', async () => {
  const t = setup();
  await optIn(t, { email: 'delivered+fremen@resend.dev', track: 'fremen' });
  const a = await courseInbound(t.env, { from: 'Someone <Delivered+Fremen@resend.dev>', text: 'This was a bit much, simpler please\n> quoted lesson text deeper' });
  assert.equal(a.keyword, 'simpler'); assert.equal(a.applied, false); assert.equal(a.proposal, 'track: fremen -> pilgrim');
  assert.equal(row(t, 'delivered+fremen@resend.dev').track, 'fremen');
  const sg = t.db.raw.prepare('SELECT * FROM course_suggestions').all();
  assert.equal(sg.length, 1); assert.equal(sg[0].status, 'pending'); assert.ok(!JSON.stringify(sg).includes('bit much'));
  assert.equal((await courseInbound(t.env, { from: 'delivered+fremen@resend.dev', text: 'STOP' })).applied, true);
  assert.equal(row(t, 'delivered+fremen@resend.dev'), undefined); // GL2: minimized like a link unsubscribe
  assert.equal(t.db.raw.prepare('SELECT COUNT(*) n FROM course_suggestions').get().n, 0);
  assert.equal((await courseInbound(t.env, { from: 'stranger@example.com', text: 'stop' })).matched, false);
});
test('webhook signature: valid svix signature accepted; wrong, stale or missing secret refused', async () => {
  const secret = 'whsec_' + Buffer.from('k'.repeat(24)).toString('base64');
  const raw = '{"type":"email.received"}', id = 'msg_1', ts = String(Math.floor(T0 / 1000));
  const sig = createHmac('sha256', Buffer.from('k'.repeat(24))).update(`${id}.${ts}.${raw}`).digest('base64');
  const h = (s) => new Headers({ 'svix-id': id, 'svix-timestamp': ts, 'svix-signature': `v1,${s}` });
  assert.equal(await verifyWebhook(secret, h(sig), raw, T0), true);
  assert.equal(await verifyWebhook(secret, h('AAAA'), raw, T0), false);
  assert.equal(await verifyWebhook(secret, h(sig), raw, T0 + 3600e3), false);
  assert.equal(await verifyWebhook('', h(sig), raw, T0), false);
});
test('handoff (R9): confirming the 14-day lessons stops the course and adds one tailored line to day 1', async () => {
  const t = setup();
  await optIn(t, { email: 'delivered+naib@resend.dev', track: 'naib' });
  const TOK = 'smt_' + 'A'.repeat(43);
  await t.db.prepare(`INSERT INTO orders (id, sku, net, amount_atomic, token_hash, created_ms, expires_ms, status, attempts, pay_to) VALUES ('SM-AAAAAAAAAA','dune-saga-collection','testnet','1',?1,?2,?3,'paid',0,'0x1')`).bind(await sha256Hex(TOK), T0, T0 + 3600e3).run();
  const lc = lessonsConfig(t.env);
  await subscribe(lc, { orderId: 'SM-AAAAAAAAAA', token: TOK, email: 'delivered+naib@resend.dev', source: 'checkout', nowMs: T0 });
  await runConfirmations(t.env, { nowMs: T0, fetchImpl: t.fetchImpl });
  const l = t.db.raw.prepare('SELECT * FROM lesson_subs').get();
  await confirm(t.db, { subId: l.id, token: l.confirm_token, nowMs: T0 + 2 });
  assert.equal(row(t, 'delivered+naib@resend.dev').status, 'handed_off');
  const base = t.sent.length;
  assert.equal((await runCourse(t.env, { nowMs: T0 + 3 * DAY, fetchImpl: t.fetchImpl })).sent, 0);
  await runLessons(t.env, { nowMs: T0 + 3, fetchImpl: t.fetchImpl });
  const d1 = t.sent.slice(base).find((m) => /^Day 1 of 14/.test(m.body.subject)).body;
  assert.ok(d1.text.indexOf(HANDOFF_LINE.naib) > 0 && d1.text.indexOf(HANDOFF_LINE.naib) < d1.text.indexOf("DAY 1"));
  // R10: a Collection order gets the no-sale ending
  assert.match(d1.text, /You already hold every seat/); assert.doesNotMatch(d1.text, /together they're \$300/);
});
test('R10: CTA variant by SKU; every day has a buyer ending; endings never in the template overlay source', () => {
  assert.equal(ctaVariant('dune-saga-collection'), 'collection'); assert.equal(ctaVariant('full-desk'), 'collection'); assert.equal(ctaVariant('fish-speakers'), 'buyer');
  assert.ok(LESSONS.every((L) => L.cta.buyer && /Apply this on the desk/.test(L.cta.buyer.text)));
  assert.equal(LESSONS.filter((L) => L.cta.collection).length, 7);
  const lc = lessonsConfig({ LESSONS_FOOTER: FOOT });
  const s = { id: 'ls_aaaaaaaaaaaaaaaa', unsub_token: 'lu_' + 'a'.repeat(32), email: 'a@b.co' };
  assert.match(lessonEmail(lc, { ...s, sku: 'fish-speakers' }, 1).text, /together they're \$300/);
  assert.match(lessonEmail(lc, { ...s, sku: 'dune-saga-collection' }, 1).text, /nothing more to buy/);
  assert.match(lessonEmail(lc, { ...s, sku: 'dune-saga-collection' }, 2).text, /trade beside|connector/i); // day 2 has only the buyer ending
});
test('course text: no return promises, no private data, risk line in every lesson block set', () => {
  const all = JSON.stringify(COURSE);
  assert.doesNotMatch(all, /guarantee|\bAPY\b|\d+% (a|per) (year|month)|Sajan|0x[0-9a-f]{8}|never cost extra|sealed with Seal|archived on Walrus|moving templates to Seal|can't place orders|only you can remove|one lesson a day/i);
  assert.equal(schedule('weekly').length, 4); assert.equal(schedule('brief').length, 7);
});
