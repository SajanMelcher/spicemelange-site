// DRAFT signal feed tests: paid-token posting, open reads, no execution, rate limits, moderation, attribution, endpoints.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeD1 } from './d1-shim.mjs';
import { loadConfig, createOrder, verifyOrder, SUI_USDC, CHAIN_ID } from '../store-core/core.js';
import { signalsConfig, createSignal, listSignals, getSignal, reportSignal, moderateSignal, moderate, validateIdea, authorOf } from '../store-core/signals.js';
import * as feed from '../functions/api/signals/index.js';
import * as one from '../functions/api/signals/[id].js';
import * as rep from '../functions/api/signals/[id]/report.js';
import * as mod from '../functions/api/signals/moderate.js';

const PAYTO = '0x' + 'ab'.repeat(32), OTHER = '0x' + 'cd'.repeat(32);
const ADMIN = 'a'.repeat(40);
class MemKV { m = new Map(); async get(k) { return this.m.get(k) ?? null; } async put(k, v) { this.m.set(k, String(v)); } }
const MIG = ['0001_store.sql', '0002_order_payee.sql', '0003_status_reset.sql', '0004_signals.sql'].map((m) => new URL(`../migrations/${m}`, import.meta.url));
const mkEnv = (over = {}) => ({ STORE_ENABLED: '1', SUI_NETWORK: 'testnet', STORE_PAYTO: PAYTO, DOWNLOAD_HMAC_SECRET: 'x'.repeat(48), STORE_KV: new MemKV(), STORE_DB: makeD1(MIG),
  SIGNALS_ENABLED: '1', SIGNALS_ADMIN_KEY: ADMIN, SIGNALS_MIN_GAP_SEC: '0', ...over });
const T0 = Date.UTC(2026, 9, 9, 13, 0, 0);
function rpc(txs) {
  return async (_u, init) => {
    const { query, variables } = JSON.parse(init.body);
    let data;
    if (query.includes('chainIdentifier')) data = { chainIdentifier: CHAIN_ID.testnet };
    else if (query.includes('transactions(')) data = { transactions: { nodes: [] } };
    else { const t = txs[variables.d]; data = { transaction: t ? { digest: variables.d, sender: { address: OTHER }, effects: { status: 'SUCCESS', timestamp: new Date(T0 + 60_000).toISOString(), balanceChanges: { nodes: t.map(([o, c, a]) => ({ owner: { address: o }, coinType: { repr: c }, amount: String(a) })) } } } : null }; }
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
async function paid(env, digest = '7'.repeat(43)) {
  const cfg = loadConfig(env);
  const { order: o } = await createOrder(cfg, { sku: 'moneo', nowMs: T0 });
  const v = await verifyOrder(cfg, { orderId: o.orderId, token: o.token, digest, nowMs: T0 + 120_000, fetchImpl: rpc({ [digest]: [[PAYTO, SUI_USDC.testnet, o.amountAtomic], [OTHER, SUI_USDC.testnet, '-' + o.amountAtomic]] }) });
  assert.equal(v.ok, true);
  return { cfg, o };
}
const idea = (over = {}) => ({ pool: 'SUI_USDC', side: 'buy', thesis: 'Bids keep refilling near the range low while sell volume fades.', entry: 1.02, target: 1.08, invalidation: 0.99, tags: ['range'], ...over });
const req = (url, init = {}) => new Request(`https://example.test${url}`, init);
const ctx = (env, request, params = {}) => ({ env, request, params });

test('off by default: SIGNALS_ENABLED missing -> 503 on every endpoint', async () => {
  assert.equal(signalsConfig({}).enabled, false);
  const env = mkEnv({ SIGNALS_ENABLED: undefined });
  assert.equal((await feed.onRequestGet(ctx(env, req('/api/signals')))).status, 503);
  assert.equal((await feed.onRequestPost(ctx(env, req('/api/signals', { method: 'POST', body: '{}' })))).status, 503);
});

test('posting requires a valid PAID order token; unpaid or wrong token refused', async () => {
  const env = mkEnv(); const cfg = loadConfig(env); const scfg = signalsConfig(env);
  const { order: unpaid } = await createOrder(cfg, { sku: 'moneo', nowMs: T0 });
  assert.equal((await createSignal(cfg, scfg, { orderId: unpaid.orderId, token: unpaid.token, idea: idea(), nowMs: T0 })).reason, 'order_not_paid');
  const { o } = await paid(env);
  assert.equal((await createSignal(cfg, scfg, { orderId: o.orderId, token: 'smt_' + 'A'.repeat(43), idea: idea(), nowMs: T0 })).status, 401);
  const ok = await createSignal(cfg, scfg, { orderId: o.orderId, token: o.token, idea: idea(), nowMs: T0 });
  assert.equal(ok.ok, true); assert.equal(ok.state, 'visible'); assert.match(ok.id, /^sig_[0-9a-f]{24}$/);
});

test('read is open; items are text + numbers, executable:false, no order id leaked; attribution pseudonym', async () => {
  const env = mkEnv(); const { cfg, o } = await paid(env); const scfg = signalsConfig(env);
  const r = await createSignal(cfg, scfg, { orderId: o.orderId, token: o.token, idea: idea(), nowMs: T0 });
  const res = await feed.onRequestGet(ctx(env, req('/api/signals?pool=SUI_USDC')));
  assert.equal(res.status, 200); assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const body = await res.json();
  assert.equal(body.items.length, 1); const it = body.items[0];
  assert.equal(it.executable, false); assert.equal(it.entry, 1.02); assert.equal(it.author, await authorOf(cfg, o.orderId));
  assert.ok(!JSON.stringify(body).includes(o.orderId)); assert.ok(!JSON.stringify(body).includes(o.token));
  assert.match(body.disclaimer, /Nothing here places or executes trades/);
  assert.equal((await getSignal(cfg, r.id)).item.thesis, idea().thesis);
});

test('POST endpoint: token only in the Authorization header', async () => {
  const env = mkEnv(); const { o } = await paid(env);
  const bodyOnly = await feed.onRequestPost(ctx(env, req('/api/signals', { method: 'POST', body: JSON.stringify({ orderId: o.orderId, token: o.token, idea: idea() }) })));
  assert.equal(bodyOnly.status, 401);
  const good = await feed.onRequestPost(ctx(env, req('/api/signals', { method: 'POST', headers: { authorization: `Bearer ${o.token}` }, body: JSON.stringify({ orderId: o.orderId, idea: idea() }) })));
  assert.equal(good.status, 201);
});

test('ideas cannot carry executable fields; validation mirrors the client', () => {
  assert.deepEqual(validateIdea(idea()), []);
  assert.ok(validateIdea(idea({ tx: 'AAAA' })).includes('unknown_field:tx'));
  assert.ok(validateIdea(idea({ execute: true })).includes('unknown_field:execute'));
  assert.ok(validateIdea(idea({ side: 'market' })).includes('side'));
});

test('rate limits: per-order daily cap, minimum gap, duplicate thesis, reads per minute', async () => {
  const env = mkEnv({ SIGNALS_POSTS_PER_DAY: '2', SIGNALS_READS_PER_MIN: '10' }); const { cfg, o } = await paid(env); const scfg = signalsConfig(env);
  const post = (thesis, nowMs = T0) => createSignal(cfg, scfg, { orderId: o.orderId, token: o.token, idea: idea({ thesis }), nowMs });
  assert.equal((await post('First idea about the range low holding up well.')).ok, true);
  assert.equal((await post('First idea about the range low holding up well.')).reason, 'duplicate_idea');
  assert.equal((await post('Second idea about the range high getting sold.')).ok, false);   // dupe used a slot
  assert.equal((await post('Third idea about volume drying up into the weekend.')).reason, 'daily_post_limit');
  const gapEnv = mkEnv({ SIGNALS_MIN_GAP_SEC: '600' }); const g = await paid(gapEnv, '8'.repeat(43)); const gs = signalsConfig(gapEnv);
  assert.equal((await createSignal(g.cfg, gs, { orderId: g.o.orderId, token: g.o.token, idea: idea(), nowMs: T0 })).ok, true);
  assert.equal((await createSignal(g.cfg, gs, { orderId: g.o.orderId, token: g.o.token, idea: idea({ thesis: 'Another distinct idea, posted too soon after.' }), nowMs: T0 + 60_000 })).reason, 'too_soon');
  let last;
  for (let i = 0; i < 11; i++) last = await feed.onRequestGet(ctx(env, req('/api/signals')));
  assert.equal(last.status, 429);
});

test('moderation: links/addresses/keys rejected, hype held, reports hold, admin hide/restore', async () => {
  assert.equal(moderate('Buy here https://scam.example now please friends').reject, 'links_not_allowed');
  assert.equal(moderate('Send to 0x' + 'ef'.repeat(32) + ' for the pool').reject, 'addresses_or_ids_not_allowed');
  assert.equal(moderate('my suiprivkey is below, use it to trade the range').reject, 'keys_or_secrets_not_allowed');
  assert.equal(moderate('Guaranteed 50x, this cannot go wrong at all').hold, 'hype_review');
  assert.deepEqual(moderate('Range 1.10 - 1.20 held for three sessions on falling volume.'), {});
  const env = mkEnv({ SIGNALS_HOLD_AT_REPORTS: '2' }); const { cfg, o } = await paid(env); const scfg = signalsConfig(env);
  const held = await createSignal(cfg, scfg, { orderId: o.orderId, token: o.token, idea: idea({ thesis: 'Risk-free bounce from the range low, easy money here.' }), nowMs: T0 });
  assert.equal(held.state, 'held');
  assert.equal((await listSignals(cfg, {})).items.length, 0);
  const s = await createSignal(cfg, scfg, { orderId: o.orderId, token: o.token, idea: idea(), nowMs: T0 + 1 });
  await reportSignal(cfg, scfg, { id: s.id, reporter: 'r1' }); await reportSignal(cfg, scfg, { id: s.id, reporter: 'r1' });
  assert.equal((await listSignals(cfg, {})).items.length, 1);                 // same reporter counts once
  await reportSignal(cfg, scfg, { id: s.id, reporter: 'r2' });
  assert.equal((await listSignals(cfg, {})).items.length, 0);                 // held after 2 distinct reports
  const bad = await mod.onRequestPost(ctx(env, req('/api/signals/moderate', { method: 'POST', headers: { authorization: 'Bearer nope' }, body: JSON.stringify({ id: s.id, action: 'restore' }) })));
  assert.equal(bad.status, 401);
  const okr = await mod.onRequestPost(ctx(env, req('/api/signals/moderate', { method: 'POST', headers: { authorization: `Bearer ${ADMIN}` }, body: JSON.stringify({ id: s.id, action: 'restore' }) })));
  assert.equal(okr.status, 200);
  assert.equal((await listSignals(cfg, {})).items.length, 1);
  const rr = await rep.onRequestPost(ctx(env, req(`/api/signals/${s.id}/report`, { method: 'POST', body: '{"reason":"spam"}' }), { id: s.id }));
  assert.equal(rr.status, 200);
});

test('attribution: credits and bounties are admin-only, append-only, shown per idea', async () => {
  const env = mkEnv(); const { cfg, o } = await paid(env); const scfg = signalsConfig(env);
  const s = await createSignal(cfg, scfg, { orderId: o.orderId, token: o.token, idea: idea(), nowMs: T0 });
  assert.equal((await moderateSignal(cfg, scfg, { adminKey: 'x', id: s.id, action: 'credit', points: 5 })).status, 401);
  assert.equal((await moderateSignal(cfg, scfg, { adminKey: ADMIN, id: s.id, action: 'credit', points: 5, note: 'useful' })).ok, true);
  assert.equal((await moderateSignal(cfg, scfg, { adminKey: ADMIN, id: s.id, action: 'bounty', points: 20 })).ok, true);
  assert.equal((await moderateSignal(cfg, scfg, { adminKey: ADMIN, id: s.id, action: 'bounty', points: 0 })).reason, 'bad_points');
  const r = await one.onRequestGet(ctx(env, req(`/api/signals/${s.id}`), { id: s.id }));
  const b = await r.json();
  assert.deepEqual(b.item.credits, { points: 25, bounties: 1 });
  const row = await cfg.db.prepare('SELECT order_id FROM signals WHERE id = ?1').bind(s.id).first();
  assert.equal(row.order_id, o.orderId);                                      // kept privately for payout
});

test('contributors listing: pseudonyms, idea counts and points; no order ids', async () => {
  const { onRequestGet } = await import('../functions/api/signals/contributors.js');
  const env = mkEnv(); const { cfg, o } = await paid(env); const scfg = signalsConfig(env);
  const s = await createSignal(cfg, scfg, { orderId: o.orderId, token: o.token, idea: idea(), nowMs: T0 });
  await moderateSignal(cfg, scfg, { adminKey: ADMIN, id: s.id, action: 'credit', points: 7 });
  const r = await onRequestGet(ctx(env, req('/api/signals/contributors')));
  const b = await r.json();
  assert.equal(r.status, 200); assert.equal(b.contributors.length, 1);
  assert.equal(b.contributors[0].points, 7); assert.equal(b.contributors[0].ideas, 1);
  assert.ok(!JSON.stringify(b).includes(o.orderId));
});
