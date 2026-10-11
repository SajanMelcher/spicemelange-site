// Holder "Trade" panel (TESTNET ONLY): quote + build + dry-run a DeepBook v3 swap for the signed-in holder's OWN wallet.
// The server only builds an UNSIGNED transaction whose sender is the holder; the holder's wallet signs it (Wallet
// Standard). The desk never holds holder funds or keys and is never a party to the trade. Education, self-directed, no advice.
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { deepbook } from '@mysten/deepbook-v3';

export const TRADE_LIMITS = { defaultBps: 100, maxBps: 300, maxQuoteUsd: 1000 };
export const TESTNET_PAIRS = { SUI: 'SUI_DBUSDC', DEEP: 'DEEP_DBUSDC', WAL: 'WAL_DBUSDC', DBTC: 'DBTC_DBUSDC' };
export const MAINNET_ONLY_PAIRS = ['NS_USDC', 'IKA_USDC', 'XBTC_USDC'];

/** Validate a trade request and compute min-out (pure; unit tested). */
export function checkTrade({ pair, side, amount, slippageBps }) {
  if (!Object.values(TESTNET_PAIRS).includes(pair)) throw new Error(MAINNET_ONLY_PAIRS.includes(pair) ? `${pair} has no testnet pool` : 'unknown pair');
  if (side !== 'buy' && side !== 'sell') throw new Error('side must be buy or sell');
  if (!(amount > 0) || amount > 1e9) throw new Error('bad amount');
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > TRADE_LIMITS.maxBps) throw new Error(`slippage must be 1-${TRADE_LIMITS.maxBps} bps`);
  return true;
}
export const minOut = (out, bps) => Math.floor(out * (1 - bps / 1e4) * 1e9) / 1e9;

export function client(address) {
  return new SuiGrpcClient({ network: 'testnet', baseUrl: 'https://fullnode.testnet.sui.io:443' }).$extend(deepbook({ address }));
}

/** sell = exact base -> DBUSDC; buy = exact DBUSDC -> base. Returns quote, fees, slippage limit, dry-run and (only if the
 *  dry-run succeeded) the unsigned tx JSON for the wallet. */
export async function tradeQuote({ address, pair, side, amount, slippageBps }, c = client(address)) {
  checkTrade({ pair, side, amount, slippageBps });
  const [q, fees] = await Promise.all([
    (side === 'sell' ? c.deepbook.getQuoteQuantityOut(pair, amount) : c.deepbook.getBaseQuantityOut(pair, amount)).catch((e) => ({ error: String(e.message || e) })),
    c.deepbook.poolTradeParams(pair).catch(() => null),
  ]);
  const out = q.error ? 0 : side === 'sell' ? q.quoteOut : q.baseOut;
  const base = { network: 'testnet', pair, side, amount, slippage_bps: slippageBps, fees, deep_required: q.deepRequired ?? null,
    disclosure: 'Education and self-directed only, not advice. This is your own trade from your own wallet; the desk never holds your funds or keys.' };
  if (q.error || !(out > 0)) return { ...base, quote_out: 0, min_out: 0, dry_run: { status: 'skipped', reason: q.error ? 'quote failed' : 'no liquidity in this testnet pool' }, tx_json: null };
  const mo = minOut(out, slippageBps);
  const tx = new Transaction(); tx.setSender(address);
  const deepAmount = q.deepRequired ? Math.ceil(q.deepRequired * 1.05 * 1e6) / 1e6 : 0; // DEEP fee (+5% headroom), from the holder's own DEEP
  const params = { poolKey: pair, amount, deepAmount, minOut: mo };
  const [b, qc, d] = tx.add(side === 'sell' ? c.deepbook.deepBook.swapExactBaseForQuote(params) : c.deepbook.deepBook.swapExactQuoteForBase(params));
  tx.transferObjects([b, qc, d], address);
  let dry;
  try {
    const r = await c.core.simulateTransaction({ transaction: tx, include: { effects: true, balanceChanges: true } });
    dry = r.$kind === 'Transaction' ? { status: 'success', balance_changes: r.Transaction?.balanceChanges ?? [] } : { status: 'failure', error: r.FailedTransaction?.status?.error?.message?.slice(0, 200) };
  } catch (e) { dry = { status: 'error', error: String(e.message || e).slice(0, 200) }; }
  const tx_json = dry.status === 'success' ? await tx.toJSON({ client: c }) : null;
  return JSON.parse(JSON.stringify({ ...base, quote_out: out, min_out: mo, dry_run: dry, tx_json }, (_, v) => (typeof v === 'bigint' ? v.toString() : v)));
}
