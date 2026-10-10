// S3 retention purge: reader IP hashes ~1h, report hashes 90d, unpaid orders 30d after expiry; paid orders untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeD1 } from './d1-shim.mjs';
import { purge, maybePurge, _resetPurgeGate, PURGE_EVERY_MS } from '../store-core/purge.js';
const migs = ['0001_store.sql', '0002_order_payee.sql', '0003_status_reset.sql', '0004_signals.sql', '0006_attribution.sql'].map((m) => new URL(`../migrations/${m}`, import.meta.url));
const NOW = Date.parse('2026-12-01T12:00:00Z'), MIN = 60_000, DAY = 86_400_000;
async function seed() {
  const db = makeD1(migs);
  const ins = (sql, ...b) => db.prepare(sql).bind(...b).run();
  const m = (ms) => `m${Math.floor(ms / MIN)}`, d = (ms) => `d${Math.floor(ms / DAY)}`;
  await ins('INSERT INTO signal_hits (k, bucket, n) VALUES (?1, ?2, 1)', 'read:old', m(NOW - 61 * MIN));
  await ins('INSERT INTO signal_hits (k, bucket, n) VALUES (?1, ?2, 1)', 'read:new', m(NOW - 30 * MIN));
  await ins('INSERT INTO signal_hits (k, bucket, n) VALUES (?1, ?2, 1)', 'post:SM-X', d(NOW - 5 * DAY));
  await ins('INSERT INTO signal_hits (k, bucket, n) VALUES (?1, ?2, 1)', 'post:SM-Y', d(NOW));
  await ins('INSERT INTO signal_reports (signal_id, reporter, reason, created_ms) VALUES (?1, ?2, ?3, ?4)', 'sig_a', 'h1', 'spam', NOW - 91 * DAY);
  await ins('INSERT INTO signal_reports (signal_id, reporter, reason, created_ms) VALUES (?1, ?2, ?3, ?4)', 'sig_b', 'h2', 'spam', NOW - 10 * DAY);
  const order = (id, status, expires, utm) => ins(`INSERT INTO orders (id, sku, net, amount_atomic, token_hash, created_ms, expires_ms, status, email, attempts, pay_to, utm_source)
    VALUES (?1, 'moneo', 'testnet', '50000001', 'h', ?2, ?3, ?4, NULL, 0, '0xp', ?5)`, id, expires - 1800_000, expires, status, utm);
  await order('SM-OLDOPEN01', 'open', NOW - 31 * DAY, 'x');
  await order('SM-NEWOPEN01', 'open', NOW - 29 * DAY, 'x');
  await order('SM-OLDPAID01', 'paid', NOW - 400 * DAY, 'x');
  return db;
}
const ids = async (db, sql) => (await db.prepare(sql).all()).results.map((r) => Object.values(r)[0]).sort();
test('purge deletes exactly what retention says, nothing paid', async () => {
  const db = await seed();
  const n = await purge(db, NOW);
  assert.equal(n.readHashes, 1); assert.equal(n.reportHashes, 1); assert.equal(n.unpaidOrders, 1);
  assert.deepEqual(await ids(db, 'SELECT k FROM signal_hits'), ['post:SM-Y', 'read:new']);
  assert.deepEqual(await ids(db, 'SELECT reporter FROM signal_reports'), ['h2']);
  assert.deepEqual(await ids(db, 'SELECT id FROM orders'), ['SM-NEWOPEN01', 'SM-OLDPAID01']);
});
test('maybePurge is gated (once per window) and never throws', async () => {
  _resetPurgeGate();
  const db = await seed();
  const kv = new Map(); const KV = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => kv.set(k, v) };
  assert.ok(await maybePurge({ db, kv: KV }, NOW));
  assert.equal(await maybePurge({ db, kv: KV }, NOW + 1000), null);
  _resetPurgeGate();
  assert.equal(await maybePurge({ db, kv: KV }, NOW + 1000), null, 'KV gate holds across isolates');
  _resetPurgeGate();
  assert.ok(await maybePurge({ db, kv: KV }, NOW + PURGE_EVERY_MS + 1));
  _resetPurgeGate();
  assert.equal(await maybePurge({ db: { prepare() { throw new Error('boom'); } } }, NOW + 3 * PURGE_EVERY_MS) !== undefined, true);
});
