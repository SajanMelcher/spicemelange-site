// HTML builders for the read-only wallet views. Every value from the chain or indexer is escaped (coin symbols and
// names are attacker-controlled: anyone can airdrop a coin called "USDC"). Every figure gets a "verify" link.
import { links } from './sui-read.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const usd = (n, d = 2) => (n == null || !isFinite(n) ? '–' : (n < 0 ? '-$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d }));
export function qty(n) {
  if (n == null || !isFinite(n)) return '–';
  const a = Math.abs(n);
  const d = a === 0 ? 0 : a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.0001 ? 6 : 9;
  return n.toLocaleString('en-US', { maximumFractionDigits: d });
}
export function price(n) {
  if (n == null || !isFinite(n)) return '–';
  const a = Math.abs(n), d = a >= 1000 ? 2 : a >= 1 ? 4 : a >= 0.01 ? 5 : 7;
  return n.toLocaleString('en-US', { maximumFractionDigits: d });
}
export const pct = (n, d = 2) => (n == null || !isFinite(n) ? '–' : `${n > 0 ? '+' : ''}${n.toFixed(d)}%`);
export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
export const pt = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' PT' : '–');
const ext = (href, text, cls = 'text-ibad-300') => `<a class="${cls}" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${text}</a>`;
export const verify = (href, label = 'verify') => `<a class="verify" href="${esc(href)}" target="_blank" rel="noopener noreferrer" title="Check this figure on a public explorer">${esc(label)}<span aria-hidden="true"> ↗</span></a>`;
const th = (cols) => `<thead><tr>${cols.map(([t, r]) => `<th scope="col" class="${r ? 'num' : ''}">${t}</th>`).join('')}</tr></thead>`;
const empty = (n, t) => `<tr><td colspan="${n}" class="muted">${esc(t)}</td></tr>`;

export function coinsTable(r) {
  const rows = r.coins.map((c) => `<tr>
    <td>${ext(links.coin(c.type), esc(c.symbol))}${c.usd == null ? ' <span class="tag" title="No DeepBook USDC market for this exact coin type, so it is not valued">unpriced</span>' : ''}</td>
    <td class="num">${c.qty == null ? esc(c.raw) + ' <span class="muted">raw</span>' : qty(c.qty)}</td>
    <td class="num">${usd(c.usd)}</td>
    <td class="num">${verify(links.account(r.address))}</td></tr>`).join('');
  return `<table class="tbl">${th([['Coin'], ['Balance', 1], ['USD', 1], ['', 1]])}<tbody>${rows || empty(4, 'No coins at this address.')}</tbody></table>`;
}

export function bmBlock(bm) {
  const bal = bm.balances.map((b) => `<tr><td>${esc(b.symbol)}</td><td class="num">${qty(b.qty)}</td><td class="num">${usd(b.usd)}</td><td class="num">${verify(links.object(bm.id))}</td></tr>`).join('');
  const settled = bm.settled.map((s) => `<tr><td>${esc(s.symbol)} <span class="tag">settled in ${esc(s.pool)}</span></td><td class="num">${qty(s.qty)}</td><td class="num">–</td><td class="num">${verify(links.object(bm.id))}</td></tr>`).join('');
  const ord = bm.orders.map((o) => `<tr>
    <td class="whitespace-nowrap">${esc(o.pool.replace('_', '/'))}</td>
    <td><span class="side ${o.side}">${o.side}</span></td>
    <td class="num">${price(o.price)}</td>
    <td class="num">${o.qty == null ? '–' : qty(o.qty)}${o.qtySource ? ' <span class="muted" title="Remaining size is read from the public DeepBook indexer">idx</span>' : ''}</td>
    <td class="num">${o.lockedQty == null ? '–' : `${qty(o.lockedQty)} ${esc(o.side === 'buy' ? o.quote : o.base)}`}</td>
    <td class="num">${verify(links.object(o.poolId), 'pool')} ${verify(links.orders(o.pool, bm.id), 'size')}</td></tr>`).join('');
  return `<div class="bm">
    <div class="bm-head"><h4>BalanceManager ${ext(links.object(bm.id), esc(short(bm.id)), 'font-mono text-ibad-300')}</h4><span class="bm-total">${usd(bm.usd)}${verify(links.object(bm.id))}</span></div>
    <p class="muted text-xs">Value = free funds + funds locked in open orders (at order price) + settled funds. Funds inside a BalanceManager are not in the wallet's coin list.</p>
    <table class="tbl">${th([['Free in manager'], ['Amount', 1], ['USD', 1], ['', 1]])}<tbody>${bal + settled || empty(4, 'No free funds.')}</tbody></table>
    <table class="tbl mt-3">${th([['Pool'], ['Side'], ['Price', 1], ['Size left', 1], ['Locked', 1], ['Verify', 1]])}<tbody>${ord || empty(6, 'No open orders.')}</tbody></table>
  </div>`;
}

export function txTable(r) {
  const rows = r.txs.map((t) => `<tr>
    <td class="whitespace-nowrap">${pt(t.at)}</td>
    <td>${esc(t.what)}</td>
    <td>${t.changes.map((c) => `<span class="${Number(c.raw) < 0 ? 'neg' : 'pos'}">${Number(c.raw) > 0 ? '+' : ''}${c.qty == null ? esc(c.raw) : qty(c.qty)} ${esc(c.symbol)}</span>`).join('<br>') || '<span class="muted">–</span>'}</td>
    <td>${t.status === 'SUCCESS' ? '<span class="ok">ok</span>' : `<span class="neg">${esc(t.status || '?')}</span>`}</td>
    <td class="num">${ext(links.tx(t.digest), `<span class="font-mono">${esc(t.digest.slice(0, 8))}…</span>`)}</td></tr>`).join('');
  return `<table class="tbl">${th([['When'], ['What'], ['Change here'], ['Status'], ['Suiscan', 1]])}<tbody>${rows || empty(5, r.txError ? 'Could not read transactions: ' + r.txError : 'No transactions yet.')}</tbody></table>`;
}

export function pairsTable(mk) {
  const rows = mk.pairs.map((p) => `<tr>
    <th scope="row">${esc(p.base)} <span class="muted">/ ${esc(p.quote)}</span></th>
    <td class="num">${price(p.mid)}</td>
    <td class="num">${p.spreadBps == null ? '–' : p.spreadBps.toFixed(1) + ' bps'}</td>
    <td class="num">${price(p.low24)} – ${price(p.high24)}</td>
    <td class="num ${p.chg24 > 0 ? 'pos' : p.chg24 < 0 ? 'neg' : ''}">${pct(p.chg24)}</td>
    <td class="num">${usd(p.volUsd, 0)}</td>
    <td class="num">${verify(links.book(p.name), 'book')} ${verify(links.object(p.id), 'pool')}</td></tr>`).join('');
  return `<table class="tbl">${th([['Pair'], ['Mid (USDC)', 1], ['Spread', 1], ['24h range', 1], ['24h', 1], ['24h volume', 1], ['', 1]])}<tbody>${rows || empty(7, 'Markets unavailable.')}</tbody></table>`;
}
