// Hwi's 14-day practice lessons: signup, gating (one production flag), daily sender, unsubscribe, content. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1 } from './d1-shim.mjs';
import { sha256Hex } from '../store-core/core.js';
import { lessonsConfig, subscribe, unsubscribe, runLessons, lessonEmail, LESSON_DAYS, MIN_GAP_MS, LESSONS_FOOTER } from '../store-core/lessons.js';
import { LESSONS } from '../store-core/lessons-content.js';

const MIG = ['0001_store.sql', '0002_order_payee.sql', '0003_status_reset.sql', '0004_signals.sql', '0005_hwi_lessons.sql'].map((m) => new URL(`../migrations/${m}`, import.meta.url));
const TOK = 'smt_' + 'A'.repeat(43), TOK2 = 'smt_' + 'B'.repeat(43);
const T0 = Date.UTC(2026, 9, 10, 16, 0, 0), DAY = 86_400_000;
async function setup(envOver = {}) {
  const db = makeD1(MIG);
  const add = async (id, tok, net = 'testnet', status = 'paid') => db.prepare(`INSERT INTO orders (id, sku, net, amount_atomic, token_hash, created_ms, expires_ms, status, attempts, pay_to) VALUES (?1,'fish-speakers',?2,'1',?3,?4,?5,?6,0,'0x1')`).bind(id, net, await sha256Hex(tok), T0, T0 + 3600e3, status).run();
  await add('SM-AAAAAAAAAA', TOK); await add('SM-BBBBBBBBBB', TOK2, 'testnet', 'open'); await add('SM-CCCCCCCCCC', TOK, 'mainnet');
  const env = { STORE_DB: db, SUI_NETWORK: 'testnet', RESEND_API_KEY: 're_test', LESSONS_TEST_RECIPIENTS: 'delivered@resend.dev', LESSONS_BASE_URL: 'https://hwi-lessons.example.dev', ...envOver };
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ id: `re_${sent.length}` }), { status: 200 }); };
  return { db, env, sent, fetchImpl, lcfg: lessonsConfig(env) };
}
const sub = (lcfg, o = {}) => subscribe(lcfg, { orderId: 'SM-AAAAAAAAAA', token: TOK, email: 'Delivered@Resend.dev', source: 'checkout', nowMs: T0, ...o });

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
test('config: signup open on testnet, closed on mainnet unless the one flag is on; test list ignored on mainnet', () => {
  assert.equal(lessonsConfig({ SUI_NETWORK: 'testnet' }).signupOpen, true);
  assert.equal(lessonsConfig({ SUI_NETWORK: 'mainnet' }).signupOpen, false);
  assert.equal(lessonsConfig({ SUI_NETWORK: 'mainnet', LESSONS_PRODUCTION_SENDING: '1' }).signupOpen, true);
  assert.deepEqual(lessonsConfig({ SUI_NETWORK: 'mainnet', LESSONS_TEST_RECIPIENTS: 'a@b.co' }).testRecipients, []);
  assert.equal(lessonsConfig({ SUI_NETWORK: 'mainnet', LESSONS_PRODUCTION_SENDING: '0' }).production, false);
});
test('subscribe: needs the order token, a valid email and source; one row per order; email lowercased', async () => {
  const { db, lcfg } = await setup();
  assert.equal((await sub(lcfg, { token: TOK2 })).reason, 'bad_order_or_token');
  assert.equal((await sub(lcfg, { orderId: 'SM-CCCCCCCCCC' })).reason, 'bad_order_or_token'); // other network
  assert.equal((await sub(lcfg, { email: 'nope' })).reason, 'bad_email');
  assert.equal((await sub(lcfg, { source: 'elsewhere' })).reason, 'bad_source');
  const r = await sub(lcfg);
  assert.deepEqual(r, { ok: true, status: 'active', nextDay: 1, waitingForPayment: false });
  assert.ok(!JSON.stringify(r).includes('@'), 'email never echoed');
  await sub(lcfg, { email: 'delivered@resend.dev', source: 'order_page' });
  const rows = db.raw.prepare('SELECT * FROM lesson_subs').all();
  assert.equal(rows.length, 1); assert.equal(rows[0].email, 'delivered@resend.dev'); assert.equal(rows[0].consent_source, 'order_page');
});
test('subscribe: closed on mainnet without the flag', async () => {
  const { env } = await setup();
  const r = await subscribe(lessonsConfig({ ...env, SUI_NETWORK: 'mainnet' }), { orderId: 'SM-CCCCCCCCCC', token: TOK, email: 'a@b.co', source: 'checkout' });
  assert.equal(r.reason, 'lessons_not_open');
});
test('sender: off on mainnet without the flag (no test list there), nothing fetched', async () => {
  const { env, sent, fetchImpl } = await setup();
  const r = await runLessons({ ...env, SUI_NETWORK: 'mainnet', LESSONS_TEST_RECIPIENTS: 'delivered@resend.dev' }, { nowMs: T0, fetchImpl });
  assert.equal(r.reason, 'sending_off'); assert.equal(sent.length, 0);
});
test('sender: test mode mails only test recipients, only paid orders; headers include one-click unsubscribe', async () => {
  const { env, lcfg, sent, fetchImpl, db } = await setup();
  await sub(lcfg);
  await subscribe(lcfg, { orderId: 'SM-BBBBBBBBBB', token: TOK2, email: 'delivered@resend.dev', source: 'checkout', nowMs: T0 }); // unpaid
  db.raw.prepare(`INSERT INTO orders (id, sku, net, amount_atomic, token_hash, created_ms, expires_ms, status, attempts, pay_to) VALUES ('SM-DDDDDDDDDD','fish-speakers','testnet','1','x',0,0,'paid',0,'0x1')`).run();
  db.raw.prepare(`INSERT INTO lesson_subs (id, net, order_id, email, consent_ms, consent_source, unsub_token) VALUES ('ls_realpersonxxxxxx','testnet','SM-DDDDDDDDDD','real@person.example',0,'checkout','lu_${'r'.repeat(32)}')`).run();
  const r = await runLessons(env, { nowMs: T0, fetchImpl });
  assert.equal(r.mode, 'test'); assert.equal(r.sent, 1); assert.equal(r.skipped, 1);
  assert.equal(sent.length, 1);
  const m = sent[0];
  assert.deepEqual(m.body.to, ['delivered@resend.dev']);
  assert.equal(m.body.from, 'Hwi Noree <hwi@thespicemelange.org>');
  assert.match(m.body.subject, /^Day 1 of 14: /);
  assert.match(m.body.headers['List-Unsubscribe'], /^<https:\/\/hwi-lessons\.example\.dev\/api\/lessons\/unsubscribe\?s=ls_[\w-]{16}&t=lu_[\w-]{32}>, <mailto:/);
  assert.equal(m.body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.match(m.body.html, /Unsubscribe in one click/); assert.match(m.body.text, /Unsubscribe in one click: https:/);
  assert.equal(m.headers['idempotency-key'].startsWith('hwi-lesson/ls_'), true);
});
test('sender: one lesson per 20 h, 14 days then done; a re-run never double-sends', async () => {
  const { env, lcfg, sent, fetchImpl, db } = await setup();
  await sub(lcfg);
  await runLessons(env, { nowMs: T0, fetchImpl });
  await runLessons(env, { nowMs: T0 + 3600e3, fetchImpl }); // same day: nothing
  assert.equal(sent.length, 1);
  for (let d = 1; d <= 16; d++) await runLessons(env, { nowMs: T0 + d * DAY, fetchImpl });
  assert.equal(sent.length, 14);
  assert.deepEqual(sent.map((s) => Number(s.body.subject.match(/^Day (\d+)/)[1])), [...Array(14)].map((_, i) => i + 1));
  const row = db.raw.prepare('SELECT status, next_day FROM lesson_subs').get();
  assert.equal(row.status, 'done'); assert.equal(row.next_day, 15);
  assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM lesson_sends').get().n, 14);
  assert.ok(MIN_GAP_MS < DAY);
});
test('sender: force (testnet test mode) walks all 14 in one go; force ignored in production', async () => {
  const { env, lcfg, sent, fetchImpl } = await setup();
  await sub(lcfg);
  for (let i = 0; i < 15; i++) await runLessons(env, { nowMs: T0 + i, fetchImpl, force: true });
  assert.equal(sent.length, 14);
  const p = await setup({ LESSONS_PRODUCTION_SENDING: '1' });
  await sub(p.lcfg);
  for (let i = 0; i < 3; i++) await runLessons(p.env, { nowMs: T0 + i, fetchImpl: p.fetchImpl, force: true });
  assert.equal(p.sent.length, 1);
});
test('sender: production flag mails every active paid subscriber; a failed send does not advance and is retried', async () => {
  const { env, lcfg, db } = await setup({ LESSONS_PRODUCTION_SENDING: '1', LESSONS_TEST_RECIPIENTS: '' });
  await sub(lcfg, { email: 'buyer@example.com' });
  let calls = 0;
  const flaky = async () => (++calls === 1 ? new Response(JSON.stringify({ name: 'rate_limit_exceeded' }), { status: 429 }) : new Response(JSON.stringify({ id: 're_ok' }), { status: 200 }));
  const a = await runLessons(env, { nowMs: T0, fetchImpl: flaky });
  assert.equal(a.mode, 'production'); assert.equal(a.failed, 1);
  assert.equal(db.raw.prepare('SELECT next_day FROM lesson_subs').get().next_day, 1);
  const b = await runLessons(env, { nowMs: T0 + 60e3, fetchImpl: flaky });
  assert.equal(b.sent, 1);
  assert.equal(db.raw.prepare('SELECT next_day FROM lesson_subs').get().next_day, 2);
});
test('sender: no Resend key -> refuses; dry run sends nothing', async () => {
  const { env, lcfg, sent, fetchImpl } = await setup({ RESEND_API_KEY: '' });
  await sub(lcfg);
  assert.equal((await runLessons(env, { nowMs: T0, fetchImpl })).reason, 'resend_key_not_set');
  const d = await runLessons(env, { nowMs: T0, fetchImpl, dryRun: true });
  assert.equal(d.details[0].result, 'dry_run'); assert.equal(sent.length, 0);
});
test('unsubscribe: one click stops sending; bad links rejected; works with sending off', async () => {
  const { env, lcfg, db, sent, fetchImpl } = await setup();
  await sub(lcfg);
  const row = db.raw.prepare('SELECT id, unsub_token FROM lesson_subs').get();
  assert.equal((await unsubscribe(db, { subId: row.id, token: 'lu_' + 'x'.repeat(32) })).reason, 'bad_link');
  assert.equal((await unsubscribe(db, { subId: row.id, token: row.unsub_token })).ok, true);
  assert.equal((await unsubscribe(db, { subId: row.id, token: row.unsub_token })).ok, true); // idempotent
  await runLessons(env, { nowMs: T0, fetchImpl });
  assert.equal(sent.length, 0);
  // re-opting in on the order page is explicit consent again
  await sub(lcfg, { source: 'order_page' });
  await runLessons(env, { nowMs: T0, fetchImpl });
  assert.equal(sent.length, 1);
});
test('unpaid opt-ins expire after 7 days', async () => {
  const { env, lcfg, db, fetchImpl } = await setup();
  await subscribe(lcfg, { orderId: 'SM-BBBBBBBBBB', token: TOK2, email: 'delivered@resend.dev', source: 'checkout', nowMs: T0 });
  const r = await runLessons(env, { nowMs: T0 + 8 * DAY, fetchImpl });
  assert.equal(r.expired, 1);
  assert.equal(db.raw.prepare('SELECT status FROM lesson_subs').get().status, 'expired');
});
test('email html/text carry the unsubscribe link and the why-you-got-this line', () => {
  const lcfg = lessonsConfig({ LESSONS_BASE_URL: 'https://x.example' });
  const e = lessonEmail(lcfg, { id: 'ls_aaaaaaaaaaaaaaaa', unsub_token: 'lu_' + 'b'.repeat(32), email: 'a@b.co' }, 14);
  assert.match(e.subject, /^Day 14 of 14/);
  assert.match(e.html, /https:\/\/x\.example\/api\/lessons\/unsubscribe\?s=ls_a+&amp;t=|https:\/\/x\.example\/api\/lessons\/unsubscribe\?s=ls_a+&t=/);
  assert.match(e.text, /ticked "Get Hwi's 14-day practice lessons"/);
});
test('lessons-content.js is in sync with content/hwi-lessons', async () => {
  const { buildAll } = await import('../scripts/lessons-build.mjs');
  assert.deepEqual(buildAll(), LESSONS);
  readFileSync(new URL('../content/hwi-lessons/day-14.md', import.meta.url));
});
test('every lesson email carries the postal footer (HTML + text), reply-to reserve@, and keeps the one-click unsubscribe', () => {
  const F = 'Sajan Melcher · 9017 Village Dr, Yosemite National Park, CA 95389 · reserve@thespicemelange.org';
  assert.equal(LESSONS_FOOTER, F);
  const lcfg = lessonsConfig({ LESSONS_BASE_URL: 'https://x.example' });
  assert.equal(lcfg.replyTo, 'reserve@thespicemelange.org');
  for (let d = 1; d <= LESSON_DAYS; d++) {
    const e = lessonEmail(lcfg, { id: 'ls_aaaaaaaaaaaaaaaa', unsub_token: 'lu_' + 'b'.repeat(32), email: 'a@b.co' }, d);
    assert.ok(e.html.includes(F), `html day ${d}`); assert.ok(e.text.includes(F), `text day ${d}`);
    assert.equal(e.reply_to, 'reserve@thespicemelange.org');
    assert.match(e.html, /Unsubscribe in one click/); assert.match(e.text, /Unsubscribe in one click: https:\/\/x\.example\/api\/lessons\/unsubscribe\?s=/);
    assert.match(e.headers['List-Unsubscribe'], /^<https:\/\/x\.example\/api\/lessons\/unsubscribe\?s=ls_a+&t=lu_b+>, <mailto:reserve@thespicemelange\.org\?subject=unsubscribe%20lessons>$/);
    assert.equal(e.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    assert.doesNotMatch(e.html + e.text, /\{postal address\}/i);
  }
});
