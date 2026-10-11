// Holder page rendering (pure string builders; unit tested). Everything shown comes from the API's view of the
// master.json block, plus the holder's own wallet. No count of certificates issued is ever shown.
import { esc, usd, qty, short } from './wallet-render.js';

export const STATUS_TEXT = {
  active: 'Active', withdrawal_requested: 'Withdrawal requested', payout_pending: 'Approved, payout pending', redeemed: 'Redeemed', burned: 'Redeemed (burned)',
};
export const WD_TEXT = { none: 'None', withdrawal_requested: 'Requested, awaiting verification and Sajan\'s approval', payout_pending: 'Approved, payout pending', paid: 'Paid', rejected: 'Not approved (contact us)' };
const sats = (n) => Number(n || 0).toLocaleString('en-US') + ' sats';

export function certTable(view) {
  const rows = view.certificates.map((c) => `<tr><td class="font-mono">No. ${esc(c.serial)}</td><td>${usd(Number(c.principal_usd))} USDC</td><td>${esc(sats(c.accrued_sats))}</td>
    <td>${usd(Number(c.value_usd))}</td><td>${esc(c.last_reserve_credit_pt || '–')}</td><td>${esc(c.next_reserve_credit_pt || '–')}</td>
    <td>${esc(STATUS_TEXT[c.status] || c.status)}</td><td>${esc(WD_TEXT[c.withdrawal_status] || c.withdrawal_status)}</td></tr>`).join('');
  return `<table class="tbl"><thead><tr><th>Certificate</th><th>Principal</th><th>Accrued (target 8% APR)</th><th>Sats value now</th><th>Last reserve credit</th><th>Next reserve credit</th><th>Status</th><th>Withdrawal</th></tr></thead><tbody>${rows}</tbody></table>`;
}
export function summary(view) {
  return `<p class="text-sand-200">Hello, <b class="text-sand-50">${esc(view.display_name)}</b>. ${view.mode === 'token_view_only' ? 'This is your <b>view-only</b> link: to request a withdrawal, sign in with the wallet that holds the certificate.' : 'Signed in with your wallet.'}</p>
  <p class="mt-1 text-xs muted">Ledger as of ${esc(view.as_of)} · BTC ${usd(Number(view.btc_price_usd))} (${esc(view.price_source)}) · totals: ${usd(view.totals.principal_usd)} principal, ${esc(sats(view.totals.accrued_sats))} ≈ ${usd(view.totals.value_usd)}</p>`;
}
export function walletTable(w) {
  if (!w.coins.length) return '<p class="muted">No coins in this wallet on Sui testnet.</p>';
  return `<table class="tbl"><thead><tr><th>Coin</th><th>Balance</th><th>Reference USD</th></tr></thead><tbody>${w.coins.map((c) =>
    `<tr><td>${esc(c.symbol)}</td><td>${c.qty == null ? esc(c.raw) + ' (raw)' : qty(c.qty)}</td><td>${c.usd == null ? '–' : usd(c.usd)}</td></tr>`).join('')}</tbody></table>
    <p class="mt-2 text-xs muted">Testnet ${esc(short(w.address))} · ${esc(w.price_note)} Mainnet-only (not on testnet): ${esc(w.mainnet_only.join(', '))}.</p>`;
}
export function quoteBlock(q) {
  const f = q.fees ? `taker fee ${(q.fees.takerFee * 100).toFixed(3)}%` : 'fees unavailable';
  const dr = q.dry_run.status === 'success' ? 'Dry-run passed on testnet.' : `Dry-run: ${esc(q.dry_run.status)}${q.dry_run.reason ? ' (' + esc(q.dry_run.reason) + ')' : ''}${q.dry_run.error ? ' (' + esc(q.dry_run.error) + ')' : ''}.`;
  return `<p>Quote: ${esc(q.side === 'sell' ? 'sell' : 'buy with')} ${esc(q.amount)} → about <b>${esc(q.quote_out)}</b> (${esc(q.pair)}). Minimum you accept: ${esc(q.min_out)} (slippage limit ${(q.slippage_bps / 100).toFixed(2)}%). ${f}${q.deep_required ? `, DEEP fee ≈ ${esc(q.deep_required)}` : ''}.</p><p class="mt-1">${dr}</p><p class="mt-1 text-xs muted">${esc(q.disclosure)}</p>`;
}
