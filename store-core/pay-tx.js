// "Pay with Sui wallet" (store checkout). The SERVER builds the exact-amount USDC transfer for an open order and dry-runs it;
// the buyer's own wallet signs and executes it; the digest then goes through the unchanged /api/store/verify.
// Never signs, never submits. The browser never talks to Sui (no CSP change): only our server reads the sender's USDC coins.
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction, coinWithBalance } from '@mysten/sui/transactions';
import { authOrder, normalizeAddress, orderPayee } from './core.js';

export const FULLNODE = { mainnet: 'https://fullnode.mainnet.sui.io:443', testnet: 'https://fullnode.testnet.sui.io:443' };
const ADDR_RE = /^0x[0-9a-fA-F]{64}$/;

/** Pure: the payment PTB. coinWithBalance merges/splits the sender's USDC coins at build time to exactly `amountAtomic`. */
export function payTransaction({ sender, payTo, coinType, amountAtomic }) {
  const amt = BigInt(amountAtomic);
  if (amt <= 0n) throw new Error('bad_amount');
  const tx = new Transaction();
  tx.setSender(normalizeAddress(sender));
  tx.transferObjects([coinWithBalance({ type: coinType, balance: amt })], normalizeAddress(payTo));
  return tx;
}

/** Build + dry-run the payment for an open order. Returns { ok, tx_json, chain, amount, payTo } or { ok:false, reason }. */
export async function buildPayTx(cfg, { orderId, token, sender, nowMs = Date.now() }, client) {
  if (!ADDR_RE.test(String(sender ?? ''))) return { ok: false, status: 400, reason: 'bad_sender' };
  const { o, err } = await authOrder(cfg, orderId, token);
  if (err) return { ok: false, status: 404, reason: err };
  if (o.status === 'paid') return { ok: false, status: 409, reason: 'already_paid' };
  if (nowMs > o.expiresMs) return { ok: false, status: 410, reason: 'order_window_closed' };
  const c = client ?? new SuiGrpcClient({ network: cfg.net, baseUrl: FULLNODE[cfg.net] });
  const amt = BigInt(o.amountAtomic);
  try {
    const b = await c.core.getBalance({ owner: sender, coinType: cfg.asset });
    const bal = BigInt(b.balance?.balance ?? b.balance ?? 0);
    if (bal < amt) return { ok: false, status: 402, reason: 'not_enough_usdc' };
  } catch { return { ok: false, status: 503, reason: 'read_failed', retryable: true }; }
  const payTo = orderPayee(cfg, o);
  const tx = payTransaction({ sender, payTo, coinType: cfg.asset, amountAtomic: amt });
  try {
    const r = await c.core.simulateTransaction({ transaction: tx, include: { effects: true, balanceChanges: true } });
    if (r.$kind !== 'Transaction') return { ok: false, status: 422, reason: 'dry_run_failed', error: String(r.FailedTransaction?.status?.error?.message ?? '').slice(0, 200) };
    const credited = (r.Transaction?.balanceChanges ?? []).filter((x) => normalizeAddress(x.address) === payTo && x.coinType.endsWith('::usdc::USDC')).reduce((s, x) => s + BigInt(x.amount), 0n);
    if (credited !== amt) return { ok: false, status: 422, reason: 'dry_run_amount_mismatch' };
  } catch (e) { return { ok: false, status: 503, reason: 'dry_run_unavailable', retryable: true }; }
  return { ok: true, chain: `sui:${cfg.net}`, payTo, amountAtomic: String(amt), tx_json: await tx.toJSON({ client: c }) };
}
