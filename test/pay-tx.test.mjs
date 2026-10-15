// "Pay with Sui wallet": server-built exact-amount USDC transfer. Mock gRPC client; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeD1 } from './d1-shim.mjs';
import { loadConfig, createOrder, SUI_USDC } from '../store-core/core.js';
import { buildPayTx, payTransaction } from '../store-core/pay-tx.js';

const PAYTO = '0x' + 'ab'.repeat(32), SENDER = '0x' + 'cd'.repeat(32);
class MemKV { m = new Map(); async get(k) { return this.m.get(k) ?? null; } async put(k, v) { this.m.set(k, String(v)); } }
const env = () => ({ STORE_ENABLED: '1', SUI_NETWORK: 'testnet', STORE_PAYTO: PAYTO, DOWNLOAD_HMAC_SECRET: 'x'.repeat(48), STORE_KV: new MemKV(),
  STORE_DB: makeD1(['../migrations/0001_store.sql', '../migrations/0002_order_payee.sql', '../migrations/0003_status_reset.sql'].map((m) => new URL(m, import.meta.url))) });
const T0 = Date.UTC(2026, 9, 15, 19, 0, 0);
function mockClient({ balance = 10n ** 12n, simOk = true, credit } = {}) {
  const calls = [];
  return { calls, core: {
    getBalance: async (a) => { calls.push(['getBalance', a]); return { balance: { balance: String(balance) } }; },
    simulateTransaction: async ({ transaction }) => {
      calls.push(['simulate', transaction]);
      const d = transaction.getData();
      return simOk ? { $kind: 'Transaction', Transaction: { balanceChanges: [{ address: PAYTO, coinType: SUI_USDC.testnet, amount: String(credit ?? d.__amt) }] } }
        : { $kind: 'FailedTransaction', FailedTransaction: { status: { error: { message: 'InsufficientGas' } } } };
    },
  } };
}
async function setup() { const cfg = loadConfig(env()); const o = (await createOrder(cfg, { sku: 'moneo', ipHash: 'h', nowMs: T0 })).order; return { cfg, o }; }

test('payTransaction: one transfer of exactly the amount to payTo, sender set, coin intent for USDC', () => {
  const tx = payTransaction({ sender: SENDER, payTo: PAYTO, coinType: SUI_USDC.mainnet, amountAtomic: 300000123n });
  const d = tx.getData();
  assert.equal(d.sender, SENDER);
  assert.equal(d.commands.length, 2); // $Intent(CoinWithBalance) + TransferObjects
  const intent = d.commands.find((c) => c.$kind === '$Intent');
  assert.equal(intent.$Intent.name, 'CoinWithBalance');
  assert.equal(BigInt(intent.$Intent.data.balance), 300000123n);
  assert.match(intent.$Intent.data.type, /usdc::USDC$/);
  assert.ok(d.commands.some((c) => c.$kind === 'TransferObjects'));
  assert.throws(() => payTransaction({ sender: SENDER, payTo: PAYTO, coinType: SUI_USDC.mainnet, amountAtomic: 0n }));
});

test('buildPayTx: guards (bad sender, bad token, expired, not enough USDC, dry-run failure, amount mismatch)', async () => {
  const { cfg, o } = await setup();
  const base = { orderId: o.orderId, token: o.token, sender: SENDER, nowMs: T0 + 1000 };
  assert.equal((await buildPayTx(cfg, { ...base, sender: 'nope' }, mockClient())).reason, 'bad_sender');
  assert.equal((await buildPayTx(cfg, { ...base, token: 'smt_' + 'A'.repeat(43) }, mockClient())).ok, false);
  assert.equal((await buildPayTx(cfg, { ...base, nowMs: T0 + 3 * 3600_000 }, mockClient())).reason, 'order_window_closed');
  assert.equal((await buildPayTx(cfg, base, mockClient({ balance: 1n }))).reason, 'not_enough_usdc');
  assert.equal((await buildPayTx(cfg, base, mockClient({ simOk: false }))).reason, 'dry_run_failed');
  assert.equal((await buildPayTx(cfg, base, mockClient({ credit: '1' }))).reason, 'dry_run_amount_mismatch');
});

test('checkout page keeps the manual fallback and adds the wallet button wired to /api/store/pay-tx', () => {
  const s = readFileSync(new URL('../src/components/Checkout.astro', import.meta.url), 'utf8');
  for (const id of ['co-wallet', 'co-digest', 'co-verify', 'co-auto', 'co-payto']) assert.ok(s.includes(`id="${id}"`), id);
  assert.ok(s.includes('/api/store/pay-tx') && s.includes('sui:signAndExecuteTransaction'));
  const p = readFileSync(new URL('../src/pages/privacy.astro', import.meta.url), 'utf8');
  assert.ok(p.includes('Pay with Sui wallet') && p.includes('fullnode.mainnet.sui.io'));
});
