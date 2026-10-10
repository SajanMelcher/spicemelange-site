// Siona S5: per-forwarded-client limits for the hosted connector, trusted only with a valid store key.
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeD1 } from './d1-shim.mjs';
import { loadConfig, createOrder, connectorClientFrom } from '../store-core/core.js';
class MemKV { m = new Map(); async get(k) { return this.m.has(k) ? this.m.get(k) : null; } async put(k, v) { this.m.set(k, String(v)); } }
const KEY = 'c'.repeat(40);
const mk = (extra = {}) => loadConfig({ STORE_ENABLED: '1', SUI_NETWORK: 'testnet', STORE_PAYTO: '0x' + 'ab'.repeat(32), DOWNLOAD_HMAC_SECRET: 'x'.repeat(48), STORE_KV: new MemKV(),
  STORE_DB: makeD1(['0001_store.sql', '0002_order_payee.sql', '0003_status_reset.sql'].map((m) => new URL(`../migrations/${m}`, import.meta.url))), ...extra });
const H = (o) => new Headers(o);

test('connectorClientFrom: only with the right key and a 24-hex id', () => {
  const cfg = mk({ STORE_CONNECTOR_KEY: KEY });
  const id = 'a1'.repeat(12);
  assert.equal(connectorClientFrom(cfg, H({ 'x-connector-key': KEY, 'x-connector-client': id })), id);
  assert.equal(connectorClientFrom(cfg, H({ 'x-connector-key': 'wrong'.padEnd(40, 'x'), 'x-connector-client': id })), null);
  assert.equal(connectorClientFrom(cfg, H({ 'x-connector-key': KEY, 'x-connector-client': 'not-hex' })), null);
  assert.equal(connectorClientFrom(mk(), H({ 'x-connector-key': KEY, 'x-connector-client': id })), null, 'no key configured -> never trusted');
});

test('verified connector clients get their own hourly cap instead of the shared IP cap', async () => {
  const cfg = mk({ STORE_CONNECTOR_KEY: KEY, STORE_MAX_ORDERS_PER_IP_HOUR: '2', STORE_MAX_ORDERS_PER_CONNECTOR_CLIENT_HOUR: '2', STORE_MAX_ORDERS_PER_CONNECTOR_HOUR: '5' });
  const ipHash = 'f'.repeat(24); // the connector's shared IP
  for (const c of ['a', 'b']) for (let i = 0; i < 2; i++) assert.equal((await createOrder(cfg, { sku: 'moneo', ipHash, connectorClient: c.repeat(24) })).ok, true);
  assert.equal((await createOrder(cfg, { sku: 'moneo', ipHash, connectorClient: 'a'.repeat(24) })).reason, 'too_many_orders', 'per forwarded client');
  assert.equal((await createOrder(cfg, { sku: 'moneo', ipHash, connectorClient: 'c'.repeat(24) })).ok, true);
  assert.equal((await createOrder(cfg, { sku: 'moneo', ipHash, connectorClient: 'd'.repeat(24) })).reason, 'too_many_orders', 'connector-wide total');
  // A plain caller on the same IP still has the IP cap (unaffected by connector counts)
  assert.equal((await createOrder(cfg, { sku: 'moneo', ipHash })).ok, true);
  assert.equal((await createOrder(cfg, { sku: 'moneo', ipHash })).ok, true);
  assert.equal((await createOrder(cfg, { sku: 'moneo', ipHash })).reason, 'too_many_orders');
});
