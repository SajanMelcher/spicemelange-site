// Unit tests for the P30 store verifier. Mock RPC + in-memory KV; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeD1 } from './d1-shim.mjs';
import { loadConfig, createOrder, verifyOrder, checkLink, signLink, orderStatus, SUI_USDC, CHAIN_ID, atomicToDecimal } from '../store-core/core.js';

const PAYTO = '0x' + 'ab'.repeat(32);
const OTHER = '0x' + 'cd'.repeat(32);
class MemKV {
  m = new Map();
  async get(k) { return this.m.has(k) ? this.m.get(k) : null; }
  async put(k, v) { this.m.set(k, String(v)); }
  keys(prefix) { return [...this.m.keys()].filter((k) => k.startsWith(prefix)); }
}
const env = (over = {}) => ({ STORE_ENABLED: '1', SUI_NETWORK: 'testnet', STORE_PAYTO: PAYTO, DOWNLOAD_HMAC_SECRET: 'x'.repeat(48), STORE_KV: new MemKV(), STORE_DB: makeD1(new URL('../migrations/0001_store.sql', import.meta.url)), ...over });
const D1 = '7'.repeat(43), D2 = '8'.repeat(43), D3 = '9'.repeat(43);

/** Mock Sui GraphQL: txs = { digest: {status, timestampMs, changes:[[owner, coinType, amount]]} } */
function mockRpc(txs, { chain = CHAIN_ID.testnet, recent = [] } = {}) {
  return async (_url, init) => {
    const { query, variables } = JSON.parse(init.body);
    let data;
    if (query.includes('chainIdentifier')) data = { chainIdentifier: chain };
    else if (query.includes('transactions(')) data = { transactions: { nodes: recent.map((digest) => ({ digest })) } };
    else {
      const t = txs[variables.d];
      data = { transaction: t ? { digest: variables.d, sender: { address: OTHER }, effects: { status: t.status ?? 'SUCCESS', timestamp: new Date(t.timestampMs).toISOString(), balanceChanges: { nodes: t.changes.map(([o, c, a]) => ({ owner: { address: o }, coinType: { repr: c }, amount: String(a) })) } } } : null };
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
