// Unit tests for the P30 store verifier. Mock RPC + in-memory KV; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeD1 } from './d1-shim.mjs';
import { loadConfig, createOrder, verifyOrder, checkLink, signLink, orderStatus, authorizeDownload, resetChallenge, resetToken, SUI_USDC, CHAIN_ID, atomicToDecimal } from '../store-core/core.js';
import { tokenFrom } from '../store-core/http.js';
import { verifyPersonalMessage, personalMessageDigest, suiAddress } from '../store-core/suisig.js';
import { ed25519 } from '@noble/curves/ed25519';
import { secp256k1 } from '@noble/curves/secp256k1';
import { sha256 as nsha256 } from '@noble/hashes/sha256';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PAYTO = '0x' + 'ab'.repeat(32);
const OTHER = '0x' + 'cd'.repeat(32);
class MemKV {
  m = new Map();
  async get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  async put(k, v) { this.m.set(k, String(v)); }
  keys(prefix) { return [...this.m.keys()].filter((k) => k.startsWith(prefix)); }
}
const env = (over = {}) => ({ STORE_ENABLED: '1', SUI_NETWORK: 'testnet', STORE_PAYTO: PAYTO, DOWNLOAD_HMAC_SECRET: 'x'.repeat(48), STORE_KV: new MemKV(), STORE_DB: makeD1(['../migrations/0001_store.sql', '../migrations/0002_order_payee.sql', '../migrations/0003_status_reset.sql'].map((m) => new URL(m, import.meta.url))), ...over });
const D1 = '7'.repeat(43), D2 = '8'.repeat(43), D3 = '9'.repeat(43);

/** Mock Sui GraphQL: txs = { digest: {status, timestampMs, changes:[[owner, coinType, amount]]} } */
function mockRpc(txs, { chain = CHAIN_ID.testnet, recent = [], sender = OTHER } = {}) {
  return async (_url, init) => {
    const { query, variables } = JSON.parse(init.body);
    let data;
    if (query.includes('chainIdentifier')) data = { chainIdentifier: chain };
    else if (query.includes('transactions(')) data = { transactions: { nodes: recent.map((digest) => ({ digest })) } };
    else {
      const t = txs[variables.d];
      data = { transaction: t ? { digest: variables.d, sender: { address: sender }, effects: { status: t.status ?? 'SUCCESS', timestamp: new Date(t.timestampMs).toISOString(), balanceChanges: { nodes: t.changes.map(([o, c, a]) => ({ owner: { address: o }, coinType: { repr: c }, amount: String(a) })) } } } : null };
    }
    return new Response(JSON.stringify({ data }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}
const T0 = Date.UTC(2026, 9, 9, 13, 0, 0);
async function setup(over) {
  const cfg = loadConfig(env(over));
  const r = await createOrder(cfg, { sku: 'moneo', email: 'buyer@example.com', ipHash: 'h1', nowMs: T0 });
  assert.equal(r.ok, true);
  return { cfg, o: r.order };
}
const pay = (o, extra = {}) => ({ status: 'SUCCESS', timestampMs: T0 + 60_000, changes: [[PAYTO, SUI_USDC.testnet, o.amountAtomic], [OTHER, SUI_USDC.testnet, '-' + o.amountAtomic]], ...extra });

test('config: off by default, mainnet needs second opt-in, missing secret refused', () => {
  assert.equal(loadConfig({}).enabled, false);
  assert.equal(loadConfig(env({ SUI_NETWORK: 'mainnet' })).reason, 'mainnet_not_approved');
  assert.equal(loadConfig(env({ SUI_NETWORK: 'mainnet', STORE_ALLOW_MAINNET: '1' })).enabled, true);
  assert.equal(loadConfig(env({ DOWNLOAD_HMAC_SECRET: 'short' })).reason, 'hmac_secret_not_set');
  assert.equal(loadConfig(env({ STORE_PAYTO: 'suiprivkey1qq' })).reason, 'payto_not_set');
  assert.equal(loadConfig(env({ STORE_DB: undefined })).reason, 'db_not_bound');
  assert.equal(loadConfig(env()).asset.endsWith('::usdc::USDC'), true);
});

test('order: exact unique amount = price + sub-cent tag', async () => {
  const { o } = await setup();
  const a = BigInt(o.amountAtomic);
  assert.ok(a > 50_000_000n && a < 50_010_000n, o.amount);
  assert.match(o.orderId, /^SM-/); assert.match(o.token, /^smt_/);
  assert.equal(o.payTo, PAYTO);
});

test('order: unique-cents mode', async () => {
  const cfg = loadConfig(env({ STORE_AMOUNT_TAG_UNIT: '10000', STORE_AMOUNT_TAG_RANGE: '99' }));
  const o = (await createOrder(cfg, { sku: 'moneo', nowMs: T0 })).order;
  assert.match(o.amount, /^50\.\d{1,2}$/); assert.equal(BigInt(o.amountAtomic) % 10000n, 0n);
});

test('order: unknown sku, bad email, IP rate limit', async () => {
  const cfg = loadConfig(env({ STORE_MAX_ORDERS_PER_IP_HOUR: '2' }));
  assert.equal((await createOrder(cfg, { sku: 'nope', nowMs: T0 })).reason, 'unknown_product');
  assert.equal((await createOrder(cfg, { sku: 'moneo', email: 'x', nowMs: T0 })).reason, 'bad_email');
  await createOrder(cfg, { sku: 'moneo', ipHash: 'z', nowMs: T0 });
  await createOrder(cfg, { sku: 'moneo', ipHash: 'z', nowMs: T0 });
  assert.equal((await createOrder(cfg, { sku: 'moneo', ipHash: 'z', nowMs: T0 })).reason, 'too_many_orders');
});

test('verify: happy path -> signed link + Hwi outbox draft', async () => {
  const { cfg, o } = await setup();
  const r = await verifyOrder(cfg, { orderId: o.orderId, token: o.token, digest: D1, nowMs: T0 + 120_000, fetchImpl: mockRpc({ [D1]: pay(o) }) });
  assert.equal(r.ok, true, r.reason);
  assert.match(r.downloadUrl, /^\/api\/store\/download\?o=SM-/);
  const ob = cfg.kv.keys('outbox:');
  assert.equal(ob.length, 1);
  const doc = JSON.parse(await cfg.kv.get(ob[0]));
  assert.equal(doc.draftOnly, true); assert.equal(doc.kind, 'receipt.draft'); assert.equal(doc.draft.to, 'buyer@example.com');
  // idempotent: verifying again returns a fresh link, no second outbox entry
  const again = await verifyOrder(cfg, { orderId: o.orderId, token: o.token, digest: D1, nowMs: T0 + 130_000, fetchImpl: mockRpc({}) });
  assert.equal(again.alreadyPaid, true); assert.equal(cfg.kv.keys('outbox:').length, 1);
});

test('verify: wrong amount (off by 1 atomic), wrong coin, wrong payee, failed tx', async () => {
  const { cfg, o } = await setup();
  const call = (tx) => verifyOrder(cfg, { orderId: o.orderId, token: o.token, digest: D1, nowMs: T0 + 120_000, fetchImpl: mockRpc({ [D1]: tx }) });
  const plus1 = (BigInt(o.amountAtomic) + 1n).toString();
  assert.match((await call(pay(o, { changes: [[PAYTO, SUI_USDC.testnet, plus1]] }))).reason, /^amount_mismatch/);
  assert.equal((await call(pay(o, { changes: [[PAYTO, '0x2::sui::SUI', o.amountAtomic]] }))).reason, 'no_usdc_payment_to_store');
  assert.equal((await call(pay(o, { changes: [[PAYTO, SUI_USDC.mainnet, o.amountAtomic]] }))).reason, 'no_usdc_payment_to_store');
  assert.equal((await call(pay(o, { changes: [[OTHER, SUI_USDC.testnet, o.amountAtomic]] }))).reason, 'no_usdc_payment_to_store');
  assert.equal((await call(pay(o, { status: 'FAILURE' }))).reason, 'transaction_failed');
});

test('verify: freshness (predates order, after expiry, future) and wrong chain', async () => {
  const { cfg, o } = await setup();
  const call = (tx, opt) => verifyOrder(cfg, { orderId: o.orderId, token: o.token, digest: D1, nowMs: T0 + 120_000, fetchImpl: mockRpc({ [D1]: tx }, opt) });
  assert.equal((await call(pay(o, { timestampMs: T0 - 3_600_000 }))).reason, 'payment_predates_order');
  assert.equal((await call(pay(o, { timestampMs: T0 + 3 * 3_600_000 }))).reason, 'payment_after_order_expiry');
  assert.equal((await call(pay(o, { timestampMs: T0 + 1_000_000 }))).reason, 'payment_timestamp_in_future');
  assert.equal((await call(pay(o), { chain: CHAIN_ID.mainnet })).reason, 'rpc_wrong_chain');
});

test('verify: digest reuse across orders is rejected (replay)', async () => {
  const { cfg, o } = await setup();
  const rpc = mockRpc({ [D1]: pay(o) });
  assert.equal((await verifyOrder(cfg, { orderId: o.orderId, token: o.token, digest: D1, nowMs: T0 + 120_000, fetchImpl: rpc })).ok, true);
  const o2 = (await createOrder(cfg, { sku: 'moneo', nowMs: T0 })).order;
  const r = await verifyOrder(cfg, { orderId: o2.orderId, token: o2.token, digest: D1, nowMs: T0 + 120_000, fetchImpl: rpc });
  assert.equal(r.reason, 'digest_already_used');
});

test('verify: front-runner with own order cannot claim victim digest (amount differs)', async () => {
  const { cfg, o } = await setup();
  const atk = (await createOrder(cfg, { sku: 'moneo', nowMs: T0 })).order;
  assert.notEqual(atk.amountAtomic, o.amountAtomic);
  const r = await verifyOrder(cfg, { orderId: atk.orderId, token: atk.token, digest: D1, nowMs: T0 + 120_000, fetchImpl: mockRpc({ [D1]: pay(o) }) });
  assert.match(r.reason, /^amount_mismatch/);
  // victim still succeeds afterwards
  assert.equal((await verifyOrder(cfg, { orderId: o.orderId, token: o.token, digest: D1, nowMs: T0 + 120_000, fetchImpl: mockRpc({ [D1]: pay(o) }) })).ok, true);
});

test('verify: bad token, bad digest, window closed', async () => {
  const { cfg, o } = await setup();
  assert.equal((await verifyOrder(cfg, { orderId: o.orderId, token: 'smt_' + 'A'.repeat(43), digest: D1, fetchImpl: mockRpc({}) })).reason, 'unknown_order');
  assert.equal((await verifyOrder(cfg, { orderId: o.orderId, token: o.token, digest: '0OIl', nowMs: T0, fetchImpl: mockRpc({}) })).reason, 'invalid_digest_format');
  assert.equal((await verifyOrder(cfg, { orderId: o.orderId, token: o.token, digest: D1, nowMs: T0 + 6 * 3_600_000, fetchImpl: mockRpc({}) })).reason, 'order_window_closed');
});

test('verify: auto-detect finds the matching tx among recent payee txs', async () => {
  const { cfg, o } = await setup();
  const other = pay(o, { changes: [[PAYTO, SUI_USDC.testnet, '15004321']] });
  const rpc = mockRpc({ [D2]: other, [D3]: pay(o) }, { recent: [D3, D2] });
  const r = await verifyOrder(cfg, { orderId: o.orderId, token: o.token, nowMs: T0 + 120_000, fetchImpl: rpc });
  assert.equal(r.ok, true, r.reason); assert.equal(r.digest, D3);
  const none = await setup();
  const r2 = await verifyOrder(none.cfg, { orderId: none.o.orderId, token: none.o.token, nowMs: T0 + 120_000, fetchImpl: mockRpc({ [D2]: other }, { recent: [D2] }) });
  assert.equal(r2.reason, 'payment_not_found_yet'); assert.equal(r2.retryable, true);
});

test('download link: valid, tampered, expired, other network', async () => {
  const cfg = loadConfig(env());
  const url = await signLink(cfg, { orderId: 'SM-ABCDEFGHJK', sku: 'moneo', nowMs: T0 });
  const q = Object.fromEntries(new URL(url, 'https://x').searchParams);
  assert.equal((await checkLink(cfg, { ...q, nowMs: T0 })).ok, true);
  assert.equal((await checkLink(cfg, { ...q, p: 'anteac', nowMs: T0 })).reason, 'bad_signature');
  assert.equal((await checkLink(cfg, { ...q, e: String(Number(q.e) + 999), nowMs: T0 })).reason, 'bad_signature');
  assert.equal((await checkLink(cfg, { ...q, nowMs: T0 + 3_600_000 })).reason, 'link_expired');
  const main = loadConfig(env({ SUI_NETWORK: 'mainnet', STORE_ALLOW_MAINNET: '1' }));
  assert.equal((await checkLink(main, { ...q, nowMs: T0 })).reason, 'bad_signature');
});

test('status: unpaid then paid', async () => {
  const { cfg, o } = await setup();
  assert.equal((await orderStatus(cfg, { orderId: o.orderId, token: o.token, nowMs: T0 })).status, 'open');
  await verifyOrder(cfg, { orderId: o.orderId, token: o.token, digest: D1, nowMs: T0 + 120_000, fetchImpl: mockRpc({ [D1]: pay(o) }) });
  const s = await orderStatus(cfg, { orderId: o.orderId, token: o.token, nowMs: T0 + 200_000 });
  assert.equal(s.status, 'paid'); assert.ok(s.downloadUrl);
  assert.equal(atomicToDecimal(9_004_127n), '9.004127');
});

// ---------- race tests (D1 constraints) ----------
const count = (cfg, sql) => cfg.db.raw.prepare(sql).get().n;

test('race: 10 concurrent orders on a 10-slot amount space all get unique amounts; 11th is refused', async () => {
  const cfg = loadConfig(env({ STORE_AMOUNT_TAG_RANGE: '10' }));
  const rs = await Promise.all(Array.from({ length: 10 }, () => createOrder(cfg, { sku: 'moneo', nowMs: T0 })));
  assert.ok(rs.every((r) => r.ok));
  assert.equal(new Set(rs.map((r) => r.order.amountAtomic)).size, 10);
  assert.equal((await createOrder(cfg, { sku: 'moneo', nowMs: T0 })).reason, 'busy_try_again');
  // after every hold has expired, amounts can be reissued
  assert.equal((await createOrder(cfg, { sku: 'moneo', nowMs: T0 + 6 * 3_600_000 })).ok, true);
});

test('race: same order + same digest verified in parallel -> paid once, one redemption, one outbox draft', async () => {
  const { cfg, o } = await setup();
  const rpc = mockRpc({ [D1]: pay(o) });
  const rs = await Promise.all(Array.from({ length: 5 }, () => verifyOrder(cfg, { orderId: o.orderId, token: o.token, digest: D1, nowMs: T0 + 120_000, fetchImpl: rpc })));
  assert.ok(rs.every((r) => r.ok), JSON.stringify(rs.map((r) => r.reason)));
  assert.equal(count(cfg, 'SELECT COUNT(*) n FROM redemptions'), 1);
  assert.equal(cfg.kv.keys('outbox:').length, 1);
});

test('race: two orders forced onto the SAME amount, one digest, parallel verify -> exactly one wins', async () => {
  const { cfg, o } = await setup();
  // Simulate the old KV failure mode: a second order that (wrongly) holds the same exact amount.
  const twin = (await createOrder(cfg, { sku: 'moneo', nowMs: T0 })).order;
  cfg.db.raw.prepare('UPDATE orders SET amount_atomic = ? WHERE id = ?').run(o.amountAtomic, twin.orderId);
  const rpc = mockRpc({ [D1]: pay(o) });
  const [a, b] = await Promise.all([
    verifyOrder(cfg, { orderId: o.orderId, token: o.token, digest: D1, nowMs: T0 + 120_000, fetchImpl: rpc }),
    verifyOrder(cfg, { orderId: twin.orderId, token: twin.token, digest: D1, nowMs: T0 + 120_000, fetchImpl: rpc }),
  ]);
  assert.equal([a, b].filter((r) => r.ok).length, 1, JSON.stringify([a.reason, b.reason]));
  assert.equal([a, b].find((r) => !r.ok).reason, 'digest_already_used');
  assert.equal(count(cfg, "SELECT COUNT(*) n FROM orders WHERE status='paid'"), 1);
  assert.equal(count(cfg, 'SELECT COUNT(*) n FROM redemptions'), 1);
});

test('race: attempt cap is atomic under parallel load', async () => {
  const { cfg, o } = await setup();
  cfg.db.raw.prepare('UPDATE orders SET attempts = 58 WHERE id = ?').run(o.orderId);
  const rs = await Promise.all(Array.from({ length: 6 }, () => verifyOrder(cfg, { orderId: o.orderId, token: o.token, digest: D2, nowMs: T0 + 120_000, fetchImpl: mockRpc({}) })));
  assert.equal(rs.filter((r) => r.reason === 'too_many_attempts').length, 4);
});

test('files: private KV zip served with metadata; coming-soon and unknown SKUs refused', async () => {
  const { loadFile } = await import('../store-core/files.js');
  const kv = { async getWithMetadata(k) { return k === 'file:moneo' ? { value: new Uint8Array([80, 75]).buffer, metadata: { name: 'golden-path-moneo-v1.0.0.zip', type: 'application/zip' } } : { value: null, metadata: null }; } };
  const f = await loadFile({ STORE_FILES: kv }, 'moneo');
  assert.equal(f.type, 'application/zip'); assert.equal(f.name, 'golden-path-moneo-v1.0.0.zip');
  assert.equal(await loadFile({ STORE_FILES: kv }, 'nope'), null);
  assert.equal(await loadFile({ STORE_FILES: kv }, 'plumbline-pro'), null);
  const cfg = loadConfig(env());
  assert.equal((await createOrder(cfg, { sku: 'plumbline-pro', nowMs: T0 })).reason, 'unknown_product');
});

test('selftest SKU: hidden, needs the secret flag, 0.05 + tag, 3 h expiry, inline file', async () => {
  const { CATALOG, ARCHETYPES, LISTED } = await import('../store-core/catalog.js');
  const { loadFile } = await import('../store-core/files.js');
  assert.ok(!ARCHETYPES.some((p) => p.sku === 'selftest') && !LISTED.some((p) => p.sku === 'selftest'));
  assert.equal(CATALOG.find((p) => p.sku === 'full-desk').priceUsdc, '250');
  const KEY = 'k'.repeat(32);
  const none = loadConfig(env());
  assert.equal((await createOrder(none, { sku: 'selftest', selftestKey: KEY, nowMs: T0 })).reason, 'unknown_product'); // no key configured
  const cfg = loadConfig(env({ STORE_SELFTEST_KEY: KEY }));
  assert.equal((await createOrder(cfg, { sku: 'selftest', nowMs: T0 })).reason, 'unknown_product');
  assert.equal((await createOrder(cfg, { sku: 'selftest', selftestKey: 'k'.repeat(31) + 'x', nowMs: T0 })).reason, 'unknown_product');
  const r = await createOrder(cfg, { sku: 'selftest', selftestKey: KEY, nowMs: T0 });
  assert.equal(r.ok, true);
  const a = BigInt(r.order.amountAtomic);
  assert.ok(a > 50_000n && a < 60_000n, r.order.amount);
  assert.equal(Date.parse(r.order.expiresAt) - T0, 3 * 3_600_000);
  const v = await verifyOrder(cfg, { orderId: r.order.orderId, token: r.order.token, digest: D1, nowMs: T0 + 2 * 3_600_000, fetchImpl: mockRpc({ [D1]: pay(r.order, { timestampMs: T0 + 2 * 3_600_000 - 5000 }) }) });
  assert.equal(v.ok, true, v.reason);
  const f = await loadFile({}, 'selftest');
  assert.match(f.body, /self-test/); assert.equal(f.type.startsWith('text/plain'), true);
});

test("catalog: Leto's Secret Journals listed at 50, bundle stays 250", async () => {
  const { bySku, ARCHETYPES } = await import('../store-core/catalog.js');
  assert.equal(bySku('leto-journals').priceUsdc, '50'); assert.equal(bySku('leto-journals').file, 'file:leto-journals');
  assert.ok(ARCHETYPES.some((p) => p.sku === 'leto-journals'));
  assert.equal(bySku('full-desk').priceUsdc, '250');
  const cfg = loadConfig(env());
  const r = await createOrder(cfg, { sku: 'leto-journals', nowMs: T0 });
  assert.ok(BigInt(r.order.amountAtomic) > 50_000_000n && BigInt(r.order.amountAtomic) < 50_010_000n);
});

test('payee change: each order verifies against the payee recorded on it; new orders use the new payee', async () => {
  const NEW = '0x' + 'ef'.repeat(32);
  const db = makeD1(['../migrations/0001_store.sql', '../migrations/0002_order_payee.sql', '../migrations/0003_status_reset.sql'].map((m) => new URL(m, import.meta.url)));
  const kv = new MemKV();
  const oldCfg = loadConfig(env({ STORE_DB: db, STORE_KV: kv }));
  const a = (await createOrder(oldCfg, { sku: 'moneo', nowMs: T0 })).order;
  assert.equal(a.payTo, PAYTO);
  const newCfg = loadConfig(env({ STORE_DB: db, STORE_KV: kv, STORE_PAYTO: NEW }));
  const b = (await createOrder(newCfg, { sku: 'moneo', nowMs: T0 })).order;
  assert.equal(b.payTo, NEW);
  assert.match(b.howToPay, /single transfer/);
  // Old order, paid to the old payee, still verifies after the switch.
  const va = await verifyOrder(newCfg, { orderId: a.orderId, token: a.token, digest: D1, nowMs: T0 + 120_000, fetchImpl: mockRpc({ [D1]: pay(a) }) });
  assert.equal(va.ok, true, va.reason);
  // New order paid to the OLD payee is refused; paid to the new payee it verifies (net incoming, exact amount).
  const vb1 = await verifyOrder(newCfg, { orderId: b.orderId, token: b.token, digest: D2, nowMs: T0 + 120_000, fetchImpl: mockRpc({ [D2]: pay(b) }) });
  assert.equal(vb1.reason, 'no_usdc_payment_to_store');
  const toNew = { status: 'SUCCESS', timestampMs: T0 + 60_000, changes: [[NEW, SUI_USDC.testnet, b.amountAtomic], [OTHER, SUI_USDC.testnet, '-' + b.amountAtomic]] };
  const vb2 = await verifyOrder(newCfg, { orderId: b.orderId, token: b.token, digest: D3, nowMs: T0 + 120_000, fetchImpl: mockRpc({ [D3]: toNew }) });
  assert.equal(vb2.ok, true, vb2.reason);
  // Legacy row with no recorded payee falls back to the configured payee.
  db.raw.prepare('UPDATE orders SET pay_to = NULL WHERE id = ?').run(b.orderId);
  assert.equal((await orderStatus(newCfg, { orderId: b.orderId, token: b.token, nowMs: T0 + 130_000 })).status, 'paid');
});

test('templates: Grok Bot catalog copy, prices, and a public versions.json with no paid content', async () => {
  const { bySku, ARCHETYPES } = await import('../store-core/catalog.js');
  const { versionsDoc, TEMPLATES, compareVersions, versionKey } = await import('../store-core/versions.js');
  const seven = ['god-emperor', 'moneo', 'duncan-idaho', 'fish-speakers', 'anteac', 'hwi-noree', 'ixians'];
  for (const s of seven) { const p = bySku(s); assert.equal(p.kind, 'Grok Bot template'); assert.equal(p.priceUsdc, '50'); assert.match(p.version, /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/); }
  const saga = bySku('dune-saga-collection');
  assert.equal(saga.priceUsdc, '300'); assert.equal(saga.bundle, true); assert.equal(saga.file, 'file:dune-saga-collection');
  assert.ok(saga.includes.some((i) => /Leto/.test(i)) && saga.includes.some((i) => /future/i.test(i)) && saga.includes.some((i) => /free forever/i.test(i)));
  assert.equal(bySku('hwi-noree').role, 'Ambassador of the Trading Desk');
  assert.ok(ARCHETYPES.length === 8);
  const v = versionsDoc();
  assert.deepEqual(Object.keys(v.templates).sort(), [...seven, 'dune-saga-collection', 'leto-journals'].sort());
  assert.equal(v.templates['dune-saga-collection'].version, TEMPLATES.current);
  const [yy, mm, dd, nn = 0] = TEMPLATES.current.split('.').map(Number);
  assert.equal(v.templates['dune-saga-collection'].versionKey, (yy * 10000 + mm * 100 + dd) * 1000 + nn);
  // Leto's Secret Journals joins date releases from 2026.10.10.2 (desk reading guide); before that it stayed at 2026.10.09.
  const leto = v.templates['leto-journals'].version; assert.ok(compareVersions(leto, '2026.10.09') >= 0); assert.equal(v.templates['leto-journals'].versionKey, versionKey(leto));
  for (const s of seven) assert.equal(v.templates[s].version, TEMPLATES.current);
  assert.ok(v.packs['dune-saga-collection'] && v.packs['leto-journals'] && !v.packs['full-desk']);
  assert.equal(v.packs['dune-saga-collection'].version, TEMPLATES.current);
  assert.equal(v.templates['hwi-noree'].title, 'Ambassador of the Trading Desk');
  const txt = JSON.stringify(v);
  assert.doesNotMatch(txt, /## HARD LIMITS|These override every other instruction|0x[0-9a-f]{20}|smt_|file:/i);
  assert.match(v.howToUpdate, /\/store\/download\//);
});

test('retired Full Desk: not orderable or listed; a past paid order is served the current Dune Saga Collection (T1 alias) with add-ons', async () => {
  const { bySku, LISTED, ARCHETYPES } = await import('../store-core/catalog.js');
  const { loadFile } = await import('../store-core/files.js');
  assert.equal(bySku('full-desk').retired, true);
  assert.ok(!LISTED.some((p) => p.sku === 'full-desk') && !ARCHETYPES.some((p) => p.sku === 'full-desk'));
  const cfg = loadConfig(env());
  assert.equal((await createOrder(cfg, { sku: 'full-desk', nowMs: T0 })).reason, 'unknown_product');
  // Simulate an order paid before the switch: insert a paid full-desk row directly.
  const c2 = (await setup()).cfg;
  const r = await createOrder(c2, { sku: 'moneo', nowMs: T0 });
  c2.db.raw.prepare("UPDATE orders SET sku = 'full-desk', status = 'paid', digest = 'x', paid_ms = ? WHERE id = ?").run(T0 + 1000, r.order.orderId);
  const st = await orderStatus(c2, { orderId: r.order.orderId, token: r.order.token, nowMs: T0 + 5000 });
  assert.equal(st.status, 'paid'); assert.match(st.downloadUrl, /p=dune-saga-collection/); assert.equal(st.sku, 'dune-saga-collection'); assert.equal(st.upgradedFrom, 'full-desk');
  assert.equal(st.addons?.[0]?.sku, 'desk-kit');
  const q = Object.fromEntries(new URL('https://x' + st.downloadUrl).searchParams);
  assert.equal((await checkLink(c2, { ...q, nowMs: T0 + 6000 })).ok, true);
  assert.equal((await authorizeDownload(c2, { orderId: r.order.orderId, token: r.order.token, nowMs: T0 + 7000 })).sku, 'dune-saga-collection');
  const kv = { async getWithMetadata(k) { return k === 'file:full-desk' ? { value: new Uint8Array([80, 75]).buffer, metadata: { name: 'golden-path-full-desk-2026.10.09.zip', type: 'application/zip' } } : { value: null, metadata: null }; } };
  const f = await loadFile({ STORE_FILES: kv }, 'full-desk');
  assert.equal(f.name, 'golden-path-full-desk-2026.10.09.zip');
});

test('version order: 2026.10.09.1 is newer than 2026.10.09 (update check, versions.json, release sort)', async () => {
  const { compareVersions, versionKey, versionsDoc, TEMPLATES } = await import('../store-core/versions.js');
  assert.equal(compareVersions('2026.10.09.1', '2026.10.09'), 1);
  assert.equal(compareVersions('2026.10.09', '2026.10.09.1'), -1);
  assert.equal(compareVersions('2026.10.09.1', '2026.10.09.1'), 0);
  assert.equal(compareVersions('2026.10.10', '2026.10.09.9'), 1);
  assert.equal(compareVersions('2026.10.09.10', '2026.10.09.9'), 1); // numeric, not string order
  assert.throws(() => compareVersions('1.0.0', '2026.10.09'));
  assert.ok(versionKey('2026.10.09.1') > versionKey('2026.10.09'));
  const v = versionsDoc();
  // A bot that installed 2026.10.09 sees the staged release as newer.
  for (const [k, t] of Object.entries(v.templates)) { if (k === 'leto-journals') continue; assert.equal(compareVersions(t.version, '2026.10.09'), 1); assert.equal(t.versionKey, versionKey(t.version)); }
  // Leto: a newer version only when a release actually covers it (no false update).
  assert.equal(v.templates['leto-journals'].version, TEMPLATES.releases.find((r) => r.skus === 'all' || r.skus.includes('leto-journals')).version);
  // Releases are kept newest first, and latestFor picks the newest covering release.
  const vs = TEMPLATES.releases.map((r) => r.version);
  assert.deepEqual([...vs].sort((a, b) => compareVersions(b, a)), vs);
  assert.equal(v.current, vs[0]);
});

test('versions.json: every update-checked entry carries a 64-hex sha256 of the served ZIP', async () => {
  const { versionsDoc } = await import('../store-core/versions.js');
  const v = versionsDoc();
  for (const [k, t] of Object.entries(v.templates)) assert.match(t.sha256 ?? '', /^[0-9a-f]{64}$/, k);
  const { TEMPLATES } = await import('../store-core/versions.js');
  for (const x of [...TEMPLATES.templates, ...TEMPLATES.packs]) assert.equal(v.templates[x.sku].sha256, x.sha256, x.sku);
  // When the staged release ZIPs are on this machine (products-private, gitignored), the published hashes must match them byte for byte.
  const { existsSync } = await import('node:fs');
  const dir = new URL(`../products-private/staged-${TEMPLATES.current}/`, import.meta.url);
  if (existsSync(new URL('SHA256SUMS', dir))) {
    const sums = Object.fromEntries(readFileSync(new URL('SHA256SUMS', dir), 'utf8').trim().split('\n').map((l) => l.split(/\s+/).reverse()));
    for (const [k, t] of Object.entries(v.templates)) if (sums[`${k}-v${TEMPLATES.current}.zip`]) {
      assert.equal(t.sha256, sums[`${k}-v${TEMPLATES.current}.zip`], k);
      assert.equal(t.sha256, createHash('sha256').update(readFileSync(new URL(`${k}-v${TEMPLATES.current}.zip`, dir))).digest('hex'), k);
    }
  }
});

// ---------- auto-update support (10/9/2026) ----------
const b64 = (u) => Buffer.from(u).toString('base64');
function edWallet() {
  const sk = ed25519.utils.randomPrivateKey(), pk = ed25519.getPublicKey(sk);
  return { address: suiAddress(0, pk), sign: (m) => b64([0, ...ed25519.sign(personalMessageDigest(new TextEncoder().encode(m)), sk), ...pk]) };
}
function k1Wallet() {
  const sk = secp256k1.utils.randomPrivateKey(), pk = secp256k1.getPublicKey(sk, true);
  return { address: suiAddress(1, pk), sign: (m) => b64([1, ...secp256k1.sign(nsha256(personalMessageDigest(new TextEncoder().encode(m))), sk).toCompactRawBytes(), ...pk]) };
}
async function paidOrder(over, sender = OTHER) {
  const { cfg, o } = await setup(over);
  const r = await verifyOrder(cfg, { orderId: o.orderId, token: o.token, digest: D1, nowMs: T0 + 120_000, fetchImpl: mockRpc({ [D1]: pay(o) }, { sender }) });
  assert.equal(r.ok, true, r.reason);
  return { cfg, o };
}

test('token transport: Authorization Bearer, then JSON body, then legacy ?token=', () => {
  const u = new URL('https://thespicemelange.org/api/store/order?id=SM-X&token=smt_query');
  const req = (h) => new Request(u, { headers: h });
  assert.equal(tokenFrom(req({ authorization: 'Bearer smt_header' }), { token: 'smt_body' }, u), 'smt_header');
  assert.equal(tokenFrom(req({}), { token: 'smt_body' }, u), 'smt_body');
  assert.equal(tokenFrom(req({}), null, u), 'smt_query');
  assert.equal(tokenFrom(req({}), null, null), null);
});

test('status on a paid order: never uses verify attempts; own hourly limit; resets next hour', async () => {
  const { cfg, o } = await paidOrder({ STORE_STATUS_PER_HOUR: '5' });
  const att = () => cfg.db.raw.prepare('SELECT attempts AS n FROM orders WHERE id = ?').get(o.orderId).n;
  const before = att();
  for (let i = 0; i < 5; i++) assert.equal((await orderStatus(cfg, { orderId: o.orderId, token: o.token, nowMs: T0 + 300_000 })).status, 'paid');
  const lim = await orderStatus(cfg, { orderId: o.orderId, token: o.token, nowMs: T0 + 300_000 });
  assert.equal(lim.reason, 'status_rate_limited'); assert.ok(lim.retryAfterSec > 0);
  assert.equal(att(), before, 'status must not touch payment-verify attempts');
  // verifying again on the paid order is also free and still works while status is limited
  assert.equal((await verifyOrder(cfg, { orderId: o.orderId, token: o.token, digest: D1, nowMs: T0 + 300_000, fetchImpl: mockRpc({}) })).ok, true);
  assert.equal(att(), before);
  assert.equal((await orderStatus(cfg, { orderId: o.orderId, token: o.token, nowMs: T0 + 3_700_000 })).status, 'paid');
  // a wrong token never consumes the order's quota
  assert.equal((await orderStatus(cfg, { orderId: o.orderId, token: 'smt_' + 'A'.repeat(43), nowMs: T0 + 3_700_000 })).ok, false);
});

test('direct download with the order token: paid only, wrong token refused; links last >= 15 min, relative path', async () => {
  const { cfg, o } = await setup();
  assert.equal((await authorizeDownload(cfg, { orderId: o.orderId, token: o.token, nowMs: T0 })).reason, 'not_paid');
  await verifyOrder(cfg, { orderId: o.orderId, token: o.token, digest: D1, nowMs: T0 + 120_000, fetchImpl: mockRpc({ [D1]: pay(o) }) });
  const a = await authorizeDownload(cfg, { orderId: o.orderId, token: o.token, nowMs: T0 + 200_000 });
  assert.equal(a.ok, true); assert.equal(a.sku, 'moneo');
  assert.equal((await authorizeDownload(cfg, { orderId: o.orderId, token: 'smt_' + 'B'.repeat(43) })).ok, false);
  assert.ok(cfg.linkTtlSec >= 900);
  assert.ok(loadConfig(env({ STORE_LINK_TTL_SEC: '60' })).linkTtlSec >= 900, 'a TTL under 15 minutes is ignored');
  const s = await orderStatus(cfg, { orderId: o.orderId, token: o.token, nowMs: T0 + 200_000 });
  assert.match(s.downloadUrl, /^\/api\/store\/download\?o=/);
  const q = Object.fromEntries(new URL(s.downloadUrl, 'https://x').searchParams);
  assert.equal((await checkLink(cfg, { ...q, nowMs: T0 + 200_000 + 899_000 })).ok, true, 'still valid at 14m59s');
});

test('sui signatures: ed25519 + secp256k1 personal messages verify; tamper and other schemes refused', () => {
  for (const w of [edWallet(), k1Wallet()]) {
    const r = verifyPersonalMessage('hello', w.sign('hello'));
    assert.equal(r.ok, true); assert.equal(r.address, w.address);
    assert.equal(verifyPersonalMessage('hellO', w.sign('hello')).ok, false);
  }
  assert.equal(verifyPersonalMessage('x', b64([5, ...new Uint8Array(96)])).reason, 'unsupported_signature_scheme');
  assert.equal(verifyPersonalMessage('x', 'not base64!').reason, 'bad_signature_format');
});

test('token reset: paying wallet rotates the token, old token revoked; wrong wallet, replay, expiry refused', async () => {
  const w = edWallet(), thief = edWallet();
  const { cfg, o } = await paidOrder({}, w.address);
  const t1 = T0 + 400_000;
  const ch = await resetChallenge(cfg, { orderId: o.orderId, nowMs: t1 });
  assert.equal(ch.ok, true); assert.match(ch.message, new RegExp(o.orderId));
  // wrong wallet
  assert.equal((await resetToken(cfg, { orderId: o.orderId, message: ch.message, signature: thief.sign(ch.message), nowMs: t1 })).detail, 'not_the_paying_address');
  // edited message
  assert.equal((await resetToken(cfg, { orderId: o.orderId, message: ch.message + ' ', signature: w.sign(ch.message + ' '), nowMs: t1 })).ok, false);
  const r = await resetToken(cfg, { orderId: o.orderId, message: ch.message, signature: w.sign(ch.message), nowMs: t1 + 1000 });
  assert.equal(r.ok, true, r.reason); assert.match(r.token, /^smt_/); assert.ok(r.downloadUrl);
  assert.equal((await orderStatus(cfg, { orderId: o.orderId, token: o.token, nowMs: t1 + 2000 })).ok, false, 'old token revoked');
  assert.equal((await orderStatus(cfg, { orderId: o.orderId, token: r.token, nowMs: t1 + 2000 })).status, 'paid');
  // replay of the same signed challenge
  assert.equal((await resetToken(cfg, { orderId: o.orderId, message: ch.message, signature: w.sign(ch.message), nowMs: t1 + 3000 })).ok, false);
  // expired challenge
  const ch2 = await resetChallenge(cfg, { orderId: o.orderId, nowMs: t1 });
  assert.equal((await resetToken(cfg, { orderId: o.orderId, message: ch2.message, signature: w.sign(ch2.message), nowMs: t1 + 11 * 60_000 })).ok, false);
  // unknown / unpaid orders get an identical-looking challenge that can never succeed (no existence oracle)
  const fake = await resetChallenge(cfg, { orderId: 'SM-ZZZZZZZZZZ', nowMs: t1 });
  assert.equal(fake.ok, true);
  assert.equal((await resetToken(cfg, { orderId: 'SM-ZZZZZZZZZZ', message: fake.message, signature: w.sign(fake.message), nowMs: t1 })).ok, false);
});

test('token reset: per-order hourly limit', async () => {
  const w = edWallet();
  const { cfg, o } = await paidOrder({ STORE_RESET_PER_HOUR: '2' }, w.address);
  await resetChallenge(cfg, { orderId: o.orderId, nowMs: T0 + 400_000 });
  await resetChallenge(cfg, { orderId: o.orderId, nowMs: T0 + 400_000 });
  assert.equal((await resetChallenge(cfg, { orderId: o.orderId, nowMs: T0 + 400_000 })).reason, 'reset_rate_limited');
});

test('signed versions.json: static file matches templates.json, signature verifies with the published key, tamper fails', async () => {
  const { render, checkFiles, publicKey } = await import('../scripts/versions-sign.mjs');
  const file = readFileSync(new URL('../public/templates/versions.json', import.meta.url));
  assert.equal(file.toString(), render(), 'run: node scripts/versions-sign.mjs sign');
  assert.equal(checkFiles(), true);
  const tampered = Buffer.from(file.toString().replace(/"sha256": "[0-9a-f]/, '"sha256": "_'));
  assert.equal(checkFiles({ json: tampered }), false);
  const pk = publicKey();
  assert.equal(pk.raw.length, 32);
  assert.equal(JSON.parse(file).signature.fingerprintSha256, createHash('sha256').update(pk.raw).digest('hex'));
  // the private key must never be in the repo
  const { execSync } = await import('node:child_process');
  assert.equal(execSync('git grep -l "PRIVATE KEY" -- . ":!test/store.test.mjs" || true', { cwd: new URL('..', import.meta.url) }).toString().trim(), '');
});

test('endpoints: POST /api/store/status (Bearer + {orderId}) and legacy GET /api/store/order?id=&token= both return paid + a link', async () => {
  const { onRequestPost: statusPost } = await import('../functions/api/store/status.js');
  const { onRequestGet: orderGet } = await import('../functions/api/store/order.js');
  const E = env();
  const cfg = loadConfig(E);
  const o = (await createOrder(cfg, { sku: 'dune-saga-collection', nowMs: Date.now() })).order;
  E.STORE_DB.raw.prepare("UPDATE orders SET status='paid', digest='T-'||id, sender=?, paid_ms=? WHERE id=?").run(OTHER, Date.now(), o.orderId);
  const B = 'https://thespicemelange.org';
  const call = async (p) => { const r = await p; return { code: r.status, body: await r.json() }; };
  // 2026.10.10 client: POST status, Bearer header, {orderId} body (with and without a content-type)
  for (const headers of [{ authorization: `Bearer ${o.token}`, 'content-type': 'application/json' }, { authorization: `Bearer ${o.token}` }]) {
    const r = await call(statusPost({ env: E, request: new Request(`${B}/api/store/status`, { method: 'POST', headers, body: JSON.stringify({ orderId: o.orderId }) }) }));
    assert.equal(r.code, 200); assert.equal(r.body.status, 'paid'); assert.match(r.body.downloadUrl, /^\/api\/store\/download\?o=/);
  }
  // wrong / missing token, bad body
  assert.equal((await call(statusPost({ env: E, request: new Request(`${B}/api/store/status`, { method: 'POST', headers: { authorization: 'Bearer smt_' + 'Z'.repeat(43) }, body: JSON.stringify({ orderId: o.orderId }) }) }))).code, 404);
  assert.equal((await call(statusPost({ env: E, request: new Request(`${B}/api/store/status`, { method: 'POST', body: JSON.stringify({ orderId: o.orderId }) }) }))).code, 404);
  assert.equal((await call(statusPost({ env: E, request: new Request(`${B}/api/store/status`, { method: 'POST', headers: { authorization: `Bearer ${o.token}` }, body: 'nope' }) }))).code, 400);
  // 2026.10.09.2 client: legacy token in the URL
  const g = await call(orderGet({ env: E, request: new Request(`${B}/api/store/order?id=${o.orderId}&token=${o.token}`) }));
  assert.equal(g.code, 200); assert.equal(g.body.status, 'paid'); assert.ok(g.body.downloadUrl);
  // Bearer on the GET as well
  assert.equal((await call(orderGet({ env: E, request: new Request(`${B}/api/store/order?id=${o.orderId}`, { headers: { authorization: `Bearer ${o.token}` } }) }))).body.status, 'paid');
});

test('desk-kit add-on: second signed link only for Fish Speakers and collection orders; never orderable alone', async () => {
  const cfg = loadConfig(env());
  assert.equal((await createOrder(cfg, { sku: 'desk-kit', ipHash: 'a1', nowMs: T0 })).reason, 'unknown_product');
  const { CATALOG, ARCHETYPES, LISTED } = await import('../store-core/catalog.js');
  assert.ok(CATALOG.some((p) => p.sku === 'desk-kit' && p.hidden && p.addon));
  assert.ok(!ARCHETYPES.some((p) => p.sku === 'desk-kit') && !LISTED.some((p) => p.sku === 'desk-kit'));
  for (const [sku, want] of [['fish-speakers', true], ['dune-saga-collection', true], ['moneo', false]]) {
    const r = await createOrder(cfg, { sku, ipHash: 'a' + sku, nowMs: T0 }); assert.equal(r.ok, true);
    const o = r.order;
    await verifyOrder(cfg, { orderId: o.orderId, token: o.token, digest: { 'fish-speakers': D1, 'dune-saga-collection': D2, moneo: D3 }[sku], nowMs: T0 + 120_000,
      fetchImpl: mockRpc({ [{ 'fish-speakers': D1, 'dune-saga-collection': D2, moneo: D3 }[sku]]: pay(o) }) });
    const s = await orderStatus(cfg, { orderId: o.orderId, token: o.token, nowMs: T0 + 200_000 });
    assert.equal(s.status, 'paid');
    if (!want) { assert.equal(s.addons, undefined); continue; }
    assert.equal(s.addons.length, 1); assert.equal(s.addons[0].sku, 'desk-kit');
    const q = Object.fromEntries(new URL(s.addons[0].downloadUrl, 'https://x').searchParams);
    assert.equal(q.p, 'desk-kit'); assert.equal(q.o, o.orderId);
    assert.equal((await checkLink(cfg, { ...q, nowMs: T0 + 200_000 })).ok, true);
    assert.equal((await checkLink(cfg, { ...q, p: 'moneo', nowMs: T0 + 200_000 })).ok, false);
  }
});

test('synthetic E2E paid rows never unlock status, download or upgrades on mainnet', async () => {
  const { cfg } = await setup();
  const mcfg = { ...cfg, net: 'mainnet' };
  for (const [net, digest, email] of [['e2e-test', 'E2E-SYNTH-X', 'e2e-selftest@ixians.invalid'], ['mainnet', 'E2E-SYNTH-Y', null], ['mainnet', 'RealLookingDigest1111111111111111111111111', 'e2e-selftest@ixians.invalid']]) {
    const r = await createOrder(cfg, { sku: 'dune-saga-collection', nowMs: T0 });
    cfg.db.raw.prepare("UPDATE orders SET net = ?, status = 'paid', digest = ?, email = ?, paid_ms = ? WHERE id = ?").run(net, digest, email, T0 + 1000, r.order.orderId);
    const st = await orderStatus(mcfg, { orderId: r.order.orderId, token: r.order.token, nowMs: T0 + 5000 });
    assert.equal(st.ok, false); assert.equal(st.reason, 'unknown_order'); assert.equal(st.downloadUrl, undefined);
    assert.equal((await authorizeDownload(mcfg, { orderId: r.order.orderId, token: r.order.token, nowMs: T0 + 6000 })).ok, false);
  }
});
