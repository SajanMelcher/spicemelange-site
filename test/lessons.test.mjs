// Hwi's 14-day practice lessons: DOUBLE opt-in, gating (one production flag + footer), daily sender, unsubscribe, content. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { makeD1 } from './d1-shim.mjs';
import { sha256Hex } from '../store-core/core.js';
import { lessonsConfig, subscribe, confirm, unsubscribe, runLessons, runConfirmations, scheduledRun, lessonEmail, confirmEmail, ptHour, legalGate, LESSON_DAYS, MIN_GAP_MS } from '../store-core/lessons.js';
import { LESSONS } from '../store-core/lessons-content.js';
import { PAGE_CSP } from '../store-core/lessons-page.js';

const MIG = readdirSync(new URL('../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort().map((m) => new URL(`../migrations/${m}`, import.meta.url));
const TOK = 'smt_' + 'A'.repeat(43), TOK2 = 'smt_' + 'B'.repeat(43);
const FOOT = 'Test Sender · 1 Example St, Town, CA 90000 · reserve@thespicemelange.org';
const T0 = Date.UTC(2026, 9, 10, 16, 0, 0), DAY = 86_400_000; // 9:00 AM PDT
async function setup(envOver = {}) {
  const db = makeD1(MIG);
  const add = async (id, tok, net = 'testnet', status = 'paid', email = null) => db.prepare(`INSERT INTO orders (id, sku, net, amount_atomic, token_hash, created_ms, expires_ms, status, attempts, pay_to, email) VALUES (?1,'fish-speakers',?2,'1',?3,?4,?5,?6,0,'0x1',?7)`).bind(id, net, await sha256Hex(tok), T0, T0 + 3600e3, status, email).run();
  await add('SM-AAAAAAAAAA', TOK); await add('SM-BBBBBBBBBB', TOK2, 'testnet', 'open'); await add('SM-CCCCCCCCCC', TOK, 'mainnet');
  const env = { STORE_DB: db, SUI_NETWORK: 'testnet', RESEND_API_KEY: 're_test', LESSONS_TEST_RECIPIENTS: 'delivered@resend.dev', LESSONS_BASE_URL: 'https://hwi-lessons.example.dev', LESSONS_FOOTER: FOOT, ...envOver };
  const sent = [];
  const legal = { privacy: 200, terms: '<h2>9. Privacy</h2><p>Lesson emails go out <em>through Resend</em>, our email provider.</p>' };
  const fetchImpl = async (url, init) => {
    if (String(url).endsWith('/privacy/')) return new Response('privacy', { status: legal.privacy });
    if (String(url).endsWith('/terms/')) return new Response(legal.terms, { status: 200 });
    sent.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ id: `re_${sent.length}` }), { status: 200 }); };
  return { db, env, sent, fetchImpl, lcfg: lessonsConfig(env), add, legal };
}
const sub = (lcfg, o = {}) => subscribe(lcfg, { orderId: 'SM-AAAAAAAAAA', token: TOK, email: 'Delivered@Resend.dev', source: 'checkout', nowMs: T0, ...o });
const row = (db) => db.raw.prepare('SELECT * FROM lesson_subs ORDER BY consent_ms').get();
/** subscribe -> confirmation email -> click confirm */
async function optIn(t, o = {}) {
  await sub(t.lcfg, o);
  await runConfirmations(t.env, { nowMs: T0, fetchImpl: t.fetchImpl });
  const r = t.db.raw.prepare('SELECT id, confirm_token FROM lesson_subs WHERE order_id = ?').get(o.orderId ?? 'SM-AAAAAAAAAA');
  return confirm(t.db, { subId: r.id, token: r.confirm_token, nowMs: T0 + 1 });
}

test('content: 14 lessons, each with subject, practice task, education line, ~3 minute read', () => {
  assert.equal(LESSONS.length, LESSON_DAYS);
  LESSONS.forEach((l, i) => {
    assert.equal(l.day, i + 1);
    assert.match(l.subject, new RegExp(`^Day ${i + 1} of 14: `));
    assert.match(l.text, /Today's practice task for your bot/);
    assert.match(l.text, /not financial advice/i);
    assert.ok(l.words >= 380 && l.words <= 700, `day ${i + 1}: ${l.words} words`);
    assert.doesNotMatch(l.text, /guarantee|\bAPY\b|\d+% (a|per) (year|month)|Sajan|0x[0-9a-f]{8}/i);
  });
});
test('config: signup open on testnet, closed on mainnet unless the one flag is on; test list ignored on mainnet; sender', () => {
  assert.equal(lessonsConfig({ SUI_NETWORK: 'testnet' }).signupOpen, true);
  assert.equal(lessonsConfig({ SUI_NETWORK: 'mainnet' }).signupOpen, false);
  assert.equal(lessonsConfig({ SUI_NETWORK: 'mainnet', LESSONS_PRODUCTION_SENDING: '1' }).signupOpen, true);
  assert.deepEqual(lessonsConfig({ SUI_NETWORK: 'mainnet', LESSONS_TEST_RECIPIENTS: 'a@b.co' }).testRecipients, ['a@b.co']);
  assert.deepEqual(lessonsConfig({ SUI_NETWORK: 'mainnet', LESSONS_PRODUCTION_SENDING: '1', LESSONS_TEST_RECIPIENTS: 'a@b.co' }).testRecipients, []);
  const c = lessonsConfig({});
  assert.equal(c.from, '"Hwi Noree, The Spice Melange" <hwi@thespicemelange.org>');
  assert.equal(c.replyTo, 'reserve@thespicemelange.org');
});
test('worker toml: site and worker flags match, sender name, reply-to reserve@, cron every 10 min', () => {
  const w = readFileSync(new URL('../workers/hwi-lessons/wrangler.toml', import.meta.url), 'utf8');
  const prod = w.split('[env.preview]')[0], prev = w.split('[env.preview]')[1];
  const flag = /^LESSONS_PRODUCTION_SENDING = "(\d)"/m.exec(prod)[1]; assert.match(prev, /LESSONS_PRODUCTION_SENDING = "0"/);
  const site = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.equal(/^LESSONS_PRODUCTION_SENDING = "(\d)"/m.exec(site.split('[env.preview')[0])[1], flag, 'site and worker flags must match');
  assert.match(prod, /LESSONS_FROM = '"Hwi Noree, The Spice Melange" <hwi@thespicemelange\.org>'/);
  assert.match(prod, /LESSONS_REPLY_TO = "reserve@thespicemelange\.org"/);
  assert.match(prod, /crons = \["\*\/10 \* \* \* \*"\]/);
  assert.doesNotMatch(prod, /LESSONS_TEST_RECIPIENTS/);
});
test('subscribe: needs the order token, a valid email and source; one row per order; starts PENDING; email never echoed', async () => {
  const { db, lcfg } = await setup();
  assert.equal((await sub(lcfg, { token: TOK2 })).reason, 'bad_order_or_token');
  assert.equal((await sub(lcfg, { orderId: 'SM-CCCCCCCCCC' })).reason, 'bad_order_or_token');
  assert.equal((await sub(lcfg, { email: 'nope' })).reason, 'bad_email');
  assert.equal((await sub(lcfg, { source: 'elsewhere' })).reason, 'bad_source');
  const r = await sub(lcfg);
  assert.equal(r.status, 'pending'); assert.equal(r.confirmEmail, 'within_minutes');
  assert.ok(!JSON.stringify(r).includes('@'));
  const x = row(db); assert.equal(x.status, 'pending'); assert.equal(x.confirmed_ms, null); assert.equal(x.email, 'delivered@resend.dev');
});
test('schema: an active/done row without confirmed_ms is impossible', async () => {
  const { db } = await setup();
  assert.throws(() => db.raw.prepare(`INSERT INTO lesson_subs (id, net, order_id, email, consent_ms, consent_source, status, confirm_token, unsub_token) VALUES ('ls_x','testnet','SM-AAAAAAAAAA','a@b.co',0,'checkout','active','lc_x','lu_x')`).run(), /CHECK/);
});
test('double opt-in: no lesson before confirm; one confirmation email only after payment; confirm GET-safe, then lessons', async () => {
  const t = await setup({ SUI_NETWORK: 'mainnet', LESSONS_PRODUCTION_SENDING: '1' });
  await t.add('SM-FFFFFFFFFF', TOK2, 'mainnet', 'open');
  await subscribe(t.lcfg, { orderId: 'SM-FFFFFFFFFF', token: TOK2, email: 'delivered@resend.dev', source: 'checkout', nowMs: T0 }); // unpaid
  await sub(t.lcfg, { orderId: 'SM-CCCCCCCCCC' });
  // lessons run before confirmation: nothing
  assert.equal((await runLessons(t.env, { nowMs: T0, fetchImpl: t.fetchImpl })).sent, 0);
  // confirmations: only the paid order gets one
  const c = await runConfirmations(t.env, { nowMs: T0, fetchImpl: t.fetchImpl });
  assert.equal(c.sent, 1); assert.equal(t.sent.length, 1);
  const m = t.sent[0].body;
  assert.equal(m.subject, "Please confirm: Hwi's 14-day practice lessons");
  assert.match(m.text, /Confirm: https:\/\/hwi-lessons\.example\.dev\/api\/lessons\/confirm\?s=ls_[\w-]{16}&t=lc_[\w-]{32}/);
  assert.ok(m.text.includes(FOOT) && m.html.includes(FOOT));
  assert.equal(m.reply_to, 'reserve@thespicemelange.org');
  // a second confirmation run sends nothing more
  await runConfirmations(t.env, { nowMs: T0 + 600e3, fetchImpl: t.fetchImpl });
  assert.equal(t.sent.length, 1);
  // still no lesson: not confirmed
  assert.equal((await runLessons(t.env, { nowMs: T0 + 700e3, fetchImpl: t.fetchImpl })).sent, 0);
  const r = t.db.raw.prepare("SELECT id, confirm_token FROM lesson_subs WHERE order_id='SM-CCCCCCCCCC'").get();
  assert.equal((await confirm(t.db, { subId: r.id, token: 'lc_' + 'x'.repeat(32) })).ok, false);
  assert.deepEqual(await confirm(t.db, { subId: r.id, token: r.confirm_token, nowMs: T0 + 800e3 }), { ok: true, status: 'active' });
  const l = await runLessons(t.env, { nowMs: T0 + 900e3, fetchImpl: t.fetchImpl });
  assert.equal(l.sent, 1); assert.match(t.sent[1].body.subject, /^Day 1 of 14/);
});
test('no back-sends: past buyers with a receipt email and no lesson opt-in get nothing, ever', async () => {
  const t = await setup({ SUI_NETWORK: 'mainnet', LESSONS_PRODUCTION_SENDING: '1', LESSONS_TEST_RECIPIENTS: '' });
  for (let i = 0; i < 5; i++) await t.add(`SM-PAST00000${i}`, TOK, 'mainnet', 'paid', `buyer${i}@example.com`);
  const s = await scheduledRun(t.env, { nowMs: T0, fetchImpl: t.fetchImpl });
  assert.equal(s.confirmations.sent, 0); assert.equal(s.lessons.sent, 0); assert.equal(t.sent.length, 0);
  // even an injected 'pending' row that never got a confirm email can't be lessoned, and can't be confirmed without that email
  t.db.raw.prepare(`INSERT INTO lesson_subs (id, net, order_id, email, consent_ms, consent_source, status, confirm_token, unsub_token) VALUES ('ls_pastpastpastpast','mainnet','SM-PAST000000','buyer0@example.com',${T0},'checkout','pending','lc_${'p'.repeat(32)}','lu_${'p'.repeat(32)}')`).run();
  assert.equal((await confirm(t.db, { subId: 'ls_pastpastpastpast', token: 'lc_' + 'p'.repeat(32) })).ok, false);
  assert.equal((await runLessons(t.env, { nowMs: T0, fetchImpl: t.fetchImpl })).sent, 0);
});
test('production refuses to send without the postal footer', async () => {
  const t = await setup({ SUI_NETWORK: 'mainnet', LESSONS_PRODUCTION_SENDING: '1', LESSONS_FOOTER: '' });
  assert.equal((await runLessons(t.env, { nowMs: T0, fetchImpl: t.fetchImpl })).reason, 'footer_not_set');
  assert.equal((await runConfirmations(t.env, { nowMs: T0, fetchImpl: t.fetchImpl })).reason, 'footer_not_set');
});
test('sender: off on mainnet without the flag, nothing fetched', async () => {
  const { env, sent, fetchImpl } = await setup();
  const r = await runLessons({ ...env, SUI_NETWORK: 'mainnet', LESSONS_TEST_RECIPIENTS: '' }, { nowMs: T0, fetchImpl });
  assert.equal(r.reason, 'sending_off'); assert.equal(sent.length, 0);
});
test('test mode: only test recipients get confirmations or lessons', async () => {
  const t = await setup();
  await t.add('SM-DDDDDDDDDD', TOK2);
  await subscribe(t.lcfg, { orderId: 'SM-DDDDDDDDDD', token: TOK2, email: 'real@person.example', source: 'checkout', nowMs: T0 });
  const c = await runConfirmations(t.env, { nowMs: T0, fetchImpl: t.fetchImpl });
  assert.equal(c.sent, 0); assert.equal(c.skipped, 1); assert.equal(t.sent.length, 0);
});
test('lesson headers: sender, reply-to, List-Unsubscribe (https + mailto) and one-click POST; footer in html and text', async () => {
  const t = await setup();
  assert.equal((await optIn(t)).ok, true);
  await runLessons(t.env, { nowMs: T0 + 1000, fetchImpl: t.fetchImpl });
  const m = t.sent.at(-1);
  assert.deepEqual(m.body.to, ['delivered@resend.dev']);
  assert.equal(m.body.from, '"Hwi Noree, The Spice Melange" <hwi@thespicemelange.org>');
  assert.equal(m.body.reply_to, 'reserve@thespicemelange.org');
  assert.match(m.body.headers['List-Unsubscribe'], /^<https:\/\/hwi-lessons\.example\.dev\/api\/lessons\/unsubscribe\?s=ls_[\w-]{16}&t=lu_[\w-]{32}>, <mailto:reserve@thespicemelange\.org\?subject=unsubscribe%20lessons>$/);
  assert.equal(m.body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(m.body.html.includes(FOOT) && m.body.text.includes(FOOT));
  assert.match(m.body.text, /confirmed by email/);
  assert.equal(m.headers['idempotency-key'].startsWith('hwi-lesson/ls_'), true);
});
test('sender: one lesson per 20 h, 14 days then done; a re-run never double-sends', async () => {
  const t = await setup();
  await optIn(t);
  const base = t.sent.length;
  await runLessons(t.env, { nowMs: T0 + 1000, fetchImpl: t.fetchImpl });
  await runLessons(t.env, { nowMs: T0 + 3600e3, fetchImpl: t.fetchImpl });
  assert.equal(t.sent.length - base, 1);
  for (let d = 1; d <= 16; d++) await runLessons(t.env, { nowMs: T0 + d * DAY, fetchImpl: t.fetchImpl });
  assert.equal(t.sent.length - base, 14);
  assert.equal(row(t.db).status, 'done');
  assert.ok(MIN_GAP_MS < DAY);
});
test('schedule: lessons only in the 9 AM PT hour, across PDT and PST; confirmations any time', async () => {
  assert.equal(ptHour(Date.UTC(2026, 9, 10, 16, 0)), 9);   // PDT: 16:00 UTC
  assert.equal(ptHour(Date.UTC(2026, 10, 2, 17, 0)), 9);   // PST (after Nov 1): 17:00 UTC
  assert.equal(ptHour(Date.UTC(2026, 10, 2, 16, 0)), 8);
  const t = await setup();
  await optIn(t);
  const base = t.sent.length;
  const a = await scheduledRun(t.env, { nowMs: Date.UTC(2026, 9, 10, 15, 50), fetchImpl: t.fetchImpl }); // 8:50 AM PDT
  assert.equal(a.lessons.skipped, 'not_9am_pt'); assert.equal(t.sent.length, base);
  const b = await scheduledRun(t.env, { nowMs: Date.UTC(2026, 9, 10, 16, 0), fetchImpl: t.fetchImpl });
  assert.equal(b.lessons.sent, 1);
  for (const mm of [10, 20, 30, 40, 50]) await scheduledRun(t.env, { nowMs: Date.UTC(2026, 9, 10, 16, mm), fetchImpl: t.fetchImpl });
  assert.equal(t.sent.length, base + 1); // the rest of the 9 AM hour sends nothing more
});
test('force (testnet test mode) walks all 14; ignored in production', async () => {
  const t = await setup();
  await optIn(t);
  const base = t.sent.length;
  for (let i = 0; i < 15; i++) await runLessons(t.env, { nowMs: T0 + 10 + i, fetchImpl: t.fetchImpl, force: true });
  assert.equal(t.sent.length - base, 14);
});
test('failed send does not advance and is retried; failed confirmation is retried', async () => {
  const t = await setup({ SUI_NETWORK: 'testnet' });
  await sub(t.lcfg);
  let calls = 0;
  const flaky = async () => (++calls === 1 ? new Response(JSON.stringify({ name: 'rate_limit_exceeded' }), { status: 429 }) : new Response(JSON.stringify({ id: 're_ok' }), { status: 200 }));
  assert.equal((await runConfirmations(t.env, { nowMs: T0, fetchImpl: flaky })).failed, 1);
  assert.equal((await runConfirmations(t.env, { nowMs: T0 + 1, fetchImpl: flaky })).sent, 1);
  const r = row(t.db); await confirm(t.db, { subId: r.id, token: r.confirm_token, nowMs: T0 + 2 });
  calls = 0;
  assert.equal((await runLessons(t.env, { nowMs: T0 + 3, fetchImpl: flaky })).failed, 1);
  assert.equal(row(t.db).next_day, 1);
  assert.equal((await runLessons(t.env, { nowMs: T0 + 4, fetchImpl: flaky })).sent, 1);
  assert.equal(row(t.db).next_day, 2);
});
test('unsubscribe: one click stops sending; re-opt-in needs a NEW confirmation', async () => {
  const t = await setup();
  await optIn(t);
  const r = row(t.db);
  assert.equal((await unsubscribe(t.db, { subId: r.id, token: 'lu_' + 'x'.repeat(32) })).reason, 'bad_link');
  assert.equal((await unsubscribe(t.db, { subId: r.id, token: r.unsub_token })).ok, true);
  const base = t.sent.length;
  await runLessons(t.env, { nowMs: T0 + 5, fetchImpl: t.fetchImpl });
  assert.equal(t.sent.length, base);
  // old confirm link can't revive it
  assert.equal((await confirm(t.db, { subId: r.id, token: r.confirm_token })).ok, false);
  await sub(t.lcfg, { source: 'order_page' });
  assert.equal(row(t.db).status, 'pending'); assert.equal(row(t.db).confirmed_ms, null);
  await runLessons(t.env, { nowMs: T0 + 6, fetchImpl: t.fetchImpl });
  assert.equal(t.sent.length, base); // pending: nothing until confirmed again
});
test('confirmations capped at 3 per order; pending requests expire after 7 days', async () => {
  const t = await setup({ LESSONS_TEST_RECIPIENTS: 'delivered@resend.dev,delivered1@resend.dev,delivered2@resend.dev' });
  for (let i = 0; i < 3; i++) { await sub(t.lcfg, { email: `delivered${i ? i : ''}@resend.dev` }); await runConfirmations(t.env, { nowMs: T0 + i, fetchImpl: t.fetchImpl }); }
  assert.equal((await sub(t.lcfg, { email: 'other@resend.dev' })).reason, 'too_many_confirmations');
  const u = await setup();
  await subscribe(u.lcfg, { orderId: 'SM-BBBBBBBBBB', token: TOK2, email: 'delivered@resend.dev', source: 'checkout', nowMs: T0 });
  assert.equal((await runConfirmations(u.env, { nowMs: T0 + 8 * DAY, fetchImpl: u.fetchImpl })).expired, 1);
});
test('mainnet with the flag OFF: only test-list addresses can sign up, get a confirmation and lessons (unpaid test order OK); nobody else', async () => {
  const t = await setup({ SUI_NETWORK: 'mainnet', LESSONS_TEST_RECIPIENTS: 'tester@example.com' });
  await t.add('SM-EEEEEEEEEE', TOK2, 'mainnet', 'open');
  const lc = lessonsConfig(t.env);
  assert.equal(lc.signupOpen, false);
  assert.equal((await subscribe(lc, { orderId: 'SM-CCCCCCCCCC', token: TOK, email: 'buyer@example.com', source: 'checkout', nowMs: T0 })).reason, 'lessons_not_open');
  assert.equal((await subscribe(lc, { orderId: 'SM-EEEEEEEEEE', token: TOK2, email: 'Tester@example.com', source: 'order_page', nowMs: T0 })).status, 'pending');
  assert.equal((await runConfirmations(t.env, { nowMs: T0, fetchImpl: t.fetchImpl })).sent, 1);
  const r = t.db.raw.prepare("SELECT id, confirm_token FROM lesson_subs WHERE order_id='SM-EEEEEEEEEE'").get();
  await confirm(t.db, { subId: r.id, token: r.confirm_token, nowMs: T0 + 1 });
  assert.equal((await runLessons(t.env, { nowMs: T0 + 2, fetchImpl: t.fetchImpl })).sent, 1);
  assert.deepEqual(t.sent.map((m) => m.body.to[0]), ['tester@example.com', 'tester@example.com']);
  // flag ON: unpaid orders are no longer eligible, even for the old tester
  const on = { ...t.env, LESSONS_PRODUCTION_SENDING: '1' };
  assert.equal((await runLessons(on, { nowMs: T0 + 2 * DAY, fetchImpl: t.fetchImpl })).sent, 0);
});
test('legal gate: production lesson runs hold (and say why) until /privacy/ is 200 and /terms/ has the Resend line; confirmations still go', async () => {
  const t = await setup({ SUI_NETWORK: 'mainnet', LESSONS_PRODUCTION_SENDING: '1' });
  t.legal.privacy = 404; t.legal.terms = '<p>no third-party trackers</p>';
  await sub(t.lcfg, { orderId: 'SM-CCCCCCCCCC' });
  const s1 = await scheduledRun(t.env, { nowMs: T0, fetchImpl: t.fetchImpl });
  assert.equal(s1.confirmations.sent, 1);
  const r = row(t.db); await confirm(t.db, { subId: r.id, token: r.confirm_token, nowMs: T0 + 1 });
  const h = await runLessons(t.env, { nowMs: T0 + 2, fetchImpl: t.fetchImpl });
  assert.equal(h.held, true); assert.equal(h.reason, 'held: privacy/terms not live'); assert.equal(h.sent, 0);
  t.legal.privacy = 200; // privacy alone is not enough
  assert.equal((await runLessons(t.env, { nowMs: T0 + 3, fetchImpl: t.fetchImpl })).held, true);
  t.legal.terms = '<p>Emails are sent <strong>through   Resend</strong>.</p>';
  const ok = await runLessons(t.env, { nowMs: T0 + 4, fetchImpl: t.fetchImpl });
  assert.equal(ok.held, undefined); assert.equal(ok.sent, 1);
  // network failure fails closed
  const down = async (u, i) => (/privacy|terms/.test(String(u)) ? Promise.reject(new Error('down')) : t.fetchImpl(u, i));
  assert.equal((await runLessons(t.env, { nowMs: T0 + 2 * DAY, fetchImpl: down })).held, true);
});
test("legal gate marker 'through Resend' matches Tleilaxu's section 9 bullet (store/LICENSE.md.proposed-resend)", async () => {
  // Bullet text as proposed by Tleilaxu (10/10). If the live proposal file is on this box, check it too.
  let bullet = 'These emails are sent through Resend (Resend, Inc.), our email provider, which processes your address only to deliver them.';
  const f = '/home/box/agent-data/shared/portfolio-desk/store/LICENSE.md.proposed-resend';
  if (existsSync(f)) bullet = readFileSync(f, 'utf8').split('\n').find((l) => /Lesson and course emails/.test(l)) ?? assert.fail('bullet missing from proposal');
  assert.equal(lessonsConfig({}).termsMarker, 'through resend');
  const html = `<h2>9. Your data</h2><ul><li>${bullet.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')}</li></ul>`;
  const g = await legalGate(lessonsConfig({ LESSONS_BASE_URL: 'https://x.example' }), async (u) => new Response(String(u).endsWith('/terms/') ? html : 'ok'));
  assert.equal(g.termsLine, true); assert.equal(g.open, true);
});
test('legal gate does not apply to test mode', async () => {
  const t = await setup(); t.legal.privacy = 404;
  await optIn(t);
  assert.equal((await runLessons(t.env, { nowMs: T0 + 5, fetchImpl: t.fetchImpl })).sent, 1);
});
test('confirm/unsubscribe pages: strict CSP with no scripts, form posts to self', () => {
  assert.match(PAGE_CSP, /default-src 'none'/); assert.match(PAGE_CSP, /form-action 'self'/); assert.doesNotMatch(PAGE_CSP, /script-src/);
});
test('lessons-content.js is in sync with content/hwi-lessons', async () => {
  const { buildAll } = await import('../scripts/lessons-build.mjs');
  assert.deepEqual(buildAll(), LESSONS);
});
test('confirm email has no List-Unsubscribe and no lesson content', () => {
  const e = confirmEmail(lessonsConfig({ LESSONS_FOOTER: FOOT }), { id: 'ls_aaaaaaaaaaaaaaaa', confirm_token: 'lc_' + 'b'.repeat(32), email: 'a@b.co' });
  assert.equal(e.headers, undefined); assert.doesNotMatch(e.text, /Day 1 of 14/); assert.ok(e.text.includes(FOOT));
});
