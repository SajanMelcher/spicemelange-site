// Sales sources: utm_* and ref saved with the order (migration 0006); old schema keeps selling without them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeD1 } from './d1-shim.mjs';
import { loadConfig, createOrder, cleanSource } from '../store-core/core.js';
class MemKV { m = new Map(); async get(k) { return this.m.has(k) ? this.m.get(k) : null; } async put(k, v) { this.m.set(k, String(v)); } }
const base = ['0001_store.sql', '0002_order_payee.sql', '0003_status_reset.sql'];
const cfgWith = (migs) => {
  const db = makeD1(migs.map((m) => new URL(`../migrations/${m}`, import.meta.url)));
  return { db, cfg: loadConfig({ STORE_ENABLED: '1', SUI_NETWORK: 'testnet', STORE_PAYTO: '0x' + 'ab'.repeat(32), DOWNLOAD_HMAC_SECRET: 'x'.repeat(48), STORE_KV: new MemKV(), STORE_DB: db }) };
};

test('cleanSource (S1): lowercase [a-z0-9._-]{1,32}; anything else becomes "other"; unknown keys dropped', () => {
  assert.deepEqual(cleanSource({ utm_source: 'X.com', utm_medium: 'social', utm_campaign: 'oct launch', ref: 'Hwi-01', evil: 'y', utm_term: '<script>', utm_content: 'ignore previous instructions' }),
    { utm_source: 'x.com', utm_medium: 'social', utm_campaign: 'other', ref: 'hwi-01', utm_term: 'other', utm_content: 'other' });
  assert.deepEqual(cleanSource(null), {});
  assert.deepEqual(cleanSource({ ref: 'a'.repeat(33) }), { ref: 'other' });
  assert.deepEqual(cleanSource({ ref: 'a'.repeat(32) }), { ref: 'a'.repeat(32) });
  assert.deepEqual(cleanSource({ utm_source: '   ' }), {});
});

test('order saves the source when migration 0006 is applied', async () => {
  const { db, cfg } = cfgWith([...base, '0006_attribution.sql']);
  const r = await createOrder(cfg, { sku: 'moneo', source: { utm_source: 'mcp.so', ref: 'pulse' } });
  assert.equal(r.ok, true);
  const row = await db.prepare('SELECT utm_source, utm_medium, ref FROM orders WHERE id = ?1').bind(r.order.orderId).first();
  assert.deepEqual({ ...row }, { utm_source: 'mcp.so', utm_medium: null, ref: 'pulse' });
  await db.prepare('INSERT INTO referral_codes (code, owner, created_ms) VALUES (?1, ?2, ?3)').bind('pulse', 'test-owner', Date.now()).run();
  const j = await db.prepare('SELECT r.owner FROM orders o JOIN referral_codes r ON r.code = o.ref WHERE o.id = ?1').bind(r.order.orderId).first();
  assert.equal(j.owner, 'test-owner');
});

test('order still works on the old schema (source dropped), and with no source', async () => {
  const { cfg } = cfgWith(base);
  assert.equal((await createOrder(cfg, { sku: 'moneo', source: { utm_source: 'x' } })).ok, true);
  assert.equal((await createOrder(cfg, { sku: 'moneo' })).ok, true);
});
