// Read-only Sui + DeepBook reader shared by /wallet/ (public) and /desk/wallets/ (private, behind Cloudflare Access).
// Plain ESM with no dependencies, so the browser and the Node unit tests run the exact same code.
// It only READS: Sui GraphQL (public mainnet endpoint) and the public DeepBook indexer. It never asks for a key,
// never builds or signs a transaction, and every figure it returns carries a public explorer link to check it.
export const GQL = 'https://graphql.mainnet.sui.io/graphql';
export const INDEXER = 'https://deepbook-indexer.mainnet.mystenlabs.com';
// Every cross-origin endpoint this file calls. scripts/csp-headers.mjs CONNECT must list exactly these (test enforces it).
export const ENDPOINTS = [GQL, INDEXER];
export const EXPLORER = 'https://suiscan.xyz/mainnet';
export const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
export const SUI = '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI';
// DeepBook v3 (mainnet). BalanceManagerEvent {balance_manager_id, owner} is emitted by `balance_manager::new`.
export const DEEPBOOK_BM_EVENT = '0xcaf6ba059d539a97646d47f0b9ddf843e138d215e2a12ca1f4585d386f7aec3a::balance_manager::BalanceManagerEvent';
export const DEEPBOOK_BM_TYPE = '0x2c8d603bc51326b8c13cef9dd07031a408a48dddb541963357661df5d3204809::balance_manager::BalanceManager';
export const PAIRS = ['SUI_USDC', 'WAL_USDC', 'DEEP_USDC', 'XBTC_USDC', 'IKA_USDC', 'NS_USDC'];
const FLOAT = 1e9;
// Sui GraphQL allows ~21 store-backed lookups per request; aliased batches stay well under it.
const BATCH = 8;
// Well-known decimals (skip a metadata lookup). Anything else is read from on-chain CoinMetadata.
const KNOWN = {
  [SUI]: { dec: 9, sym: 'SUI' }, [USDC]: { dec: 6, sym: 'USDC' },
  '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL': { dec: 9, sym: 'WAL' },
  '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP': { dec: 6, sym: 'DEEP' },
  '0x876a4b7bce8aeaef60464c11f4026903e9afacab79b9b142686158aa86560b50::xbtc::XBTC': { dec: 8, sym: 'XBTC' },
  '0x7262fb2f7a3a14c888c438a3cd9b912469a58cf60f367352c46584262e8299aa::ika::IKA': { dec: 9, sym: 'IKA' },
  '0x5145494a5f5100e645e4b0aa950fa6b68f614e8c59e17bc5ded3495123a79178::ns::NS': { dec: 6, sym: 'NS' },
};
const TWO64 = 1n << 64n, BIT127 = 1n << 127n;

// ---------------------------------------------------------------- pure helpers (unit tested)
export function normAddress(s) {
  const t = String(s ?? '').trim();
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(t)) return null;
  return '0x' + t.slice(2).toLowerCase().padStart(64, '0');
}
/** Normalize a Move type's leading address so 0x2::sui::SUI and the long form compare equal. */
export function normType(t) {
  return String(t).replace(/0x([0-9a-fA-F]{1,64})(?=::)/g, (_, h) => '0x' + h.toLowerCase().padStart(64, '0'));
}
export const symbolOf = (t) => String(t).split('<')[0].split('::').pop();
export const toUnits = (raw, dec) => (dec == null ? null : Number(BigInt(String(raw))) / 10 ** dec);
/** DeepBook v3 order id: bit 127 = ask, bits 64..126 = price (FLOAT_SCALING 1e9, decimals-adjusted), low 64 = sequence. */
export function decodeOrderId(id) {
  const n = BigInt(String(id));
  const isAsk = (n & BIT127) !== 0n;
  const price = Number((n >> 64n) & ((1n << 63n) - 1n));
  return { side: isAsk ? 'sell' : 'buy', rawPrice: price, seq: (n % TWO64).toString() };
}
export const realPrice = (rawPrice, baseDec, quoteDec) => (rawPrice / FLOAT) * 10 ** (baseDec - quoteDec);
export function b64(bytes) {
  let s = ''; for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export const idBcs = (addr) => b64(normAddress(addr).slice(2).match(/../g).map((h) => parseInt(h, 16)));
export const u64Bcs = (n) => { const a = []; let v = BigInt(n); for (let i = 0; i < 8; i++) { a.push(Number(v & 255n)); v >>= 8n; } return b64(a); };
export const links = {
  account: (a) => `${EXPLORER}/account/${a}`,
  object: (o) => `${EXPLORER}/object/${o}`,
  tx: (d) => `${EXPLORER}/tx/${d}`,
  coin: (t) => `${EXPLORER}/coin/${encodeURIComponent(t)}`,
  summary: () => `${INDEXER}/summary`,
  book: (p) => `${INDEXER}/orderbook/${p}?level=2&depth=10`,
  orders: (p, bm) => `${INDEXER}/order_updates/${p}?balance_manager_id=${bm}&status=Placed&limit=100`,
};
/** Pool rows from indexer /get_pools + /summary. mid = (best bid + best ask) / 2, falls back to last trade. */
export function buildPools(pools, summary) {
  const sm = new Map((summary || []).map((s) => [s.trading_pairs, s]));
  return (pools || []).map((p) => {
    const s = sm.get(p.pool_name) || {};
    const bid = Number(s.highest_bid) || null, ask = Number(s.lowest_ask) || null;
    const mid = bid && ask ? (bid + ask) / 2 : Number(s.last_price) || null;
    return {
      name: p.pool_name, id: p.pool_id, baseType: normType(p.base_asset_id), quoteType: normType(p.quote_asset_id),
      base: p.base_asset_symbol, quote: p.quote_asset_symbol, baseDec: p.base_asset_decimals, quoteDec: p.quote_asset_decimals,
      bid, ask, mid, spreadBps: bid && ask ? ((ask - bid) / ((ask + bid) / 2)) * 1e4 : null,
      high24: Number(s.highest_price_24h) || null, low24: Number(s.lowest_price_24h) || null,
      chg24: s.price_change_percent_24h ?? null, volUsd: Number(s.quote_volume) || 0, last: Number(s.last_price) || null,
    };
  });
}
/** USD per whole coin, keyed by full coin type. Only exact DeepBook USDC-quoted pools are trusted (no symbol matching). */
export function pricesByType(pools) {
  const px = { [normType(USDC)]: { usd: 1, src: 'USDC = $1' } };
  for (const p of pools) if (p.quoteType === normType(USDC) && p.mid && !px[p.baseType]) px[p.baseType] = { usd: p.mid, src: `DeepBook ${p.name} mid`, pool: p.name };
  return px;
}
/** Free balance-manager funds + funds locked in open orders + settled-but-unclaimed, valued in USD. */
export function valueBM(bm, px) {
  let usd = 0, unpriced = 0;
  const add = (type, qty) => { const p = px[normType(type)]; if (p && qty != null) usd += qty * p.usd; else if (qty) unpriced++; };
  for (const b of bm.balances) add(b.type, b.qty);
  for (const o of bm.orders) if (o.lockedQty != null) add(o.lockedType, o.lockedQty);
  for (const s of bm.settled) add(s.type, s.qty);
  return { usd, unpriced };
}

// ---------------------------------------------------------------- network (browser fetch; Node 20+ fetch in tests)
async function getJson(url, ms = 15000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { accept: 'application/json' } });
  if (!r.ok) throw new Error(`${r.status} from ${new URL(url).host}`);
  return r.json();
}
export async function gql(query, variables = {}, ms = 20000, url = GQL) {
  const r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(ms), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  if (!r.ok) throw new Error(`Sui GraphQL ${r.status}`);
  const j = await r.json();
  if (j.errors?.length) throw new Error('Sui GraphQL: ' + j.errors[0].message);
  return j.data;
}
export async function fetchMarkets() {
  const [pools, summary] = await Promise.all([getJson(`${INDEXER}/get_pools`), getJson(`${INDEXER}/summary`)]);
  const all = buildPools(pools, summary);
  return { all, pairs: PAIRS.map((n) => all.find((p) => p.name === n)).filter(Boolean), px: pricesByType(all), at: new Date() };
}

const Q_ADDR = `query($a:SuiAddress!,$after:String){ checkpoint{ sequenceNumber timestamp }
  address(address:$a){ balances(first:50, after:$after){ pageInfo{ hasNextPage endCursor } nodes{ coinType{ repr } totalBalance } } } }`;
const Q_TX = `query($a:SuiAddress!){ transactions(last:10, filter:{ affectedAddress:$a }){ nodes{ digest sender{ address }
  kind{ __typename ... on ProgrammableTransaction{ commands(first:6){ nodes{ __typename ... on MoveCallCommand{ function{ name module{ name } } } } } } }
  effects{ status timestamp balanceChanges(first:20){ nodes{ owner{ address } amount coinType{ repr } } } } } } }`;
const Q_BM_EVENTS = `query($a:SuiAddress!,$t:String!){ events(last:50, filter:{ sender:$a, type:$t }){ nodes{ contents{ json } timestamp } } }`;

/** Run one aliased sub-query per item in batches of BATCH; returns the merged data object (aliases x0, x1, ...). */
async function batched(items, part) {
  const out = {};
  for (let i = 0; i < items.length; i += BATCH) {
    const d = await gql('{' + items.slice(i, i + BATCH).map((it, j) => `x${i + j}: ${part(it, i + j)}`).join(' ') + '}');
    Object.assign(out, d);
  }
  return out;
}

/** decimals + symbol for coin types (aliased batch). Unknown metadata -> null decimals (shown raw, never valued). */
export async function coinMeta(types, cache = {}, url = GQL) {
  for (const t of types.map(normType)) if (KNOWN[t] && !(t in cache)) cache[t] = KNOWN[t];
  const need = [...new Set(types.map(normType))].filter((t) => !(t in cache));
  for (let i = 0; i < need.length; i += BATCH) {
    const part = need.slice(i, i + BATCH);
    const q = '{' + part.map((t, j) => `m${j}: coinMetadata(coinType:${JSON.stringify(t)}){ decimals symbol }`).join(' ') + '}';
    let d = {}; try { d = await gql(q, {}, 20000, url); } catch { /* leave unknown */ }
    part.forEach((t, j) => { cache[t] = d[`m${j}`] ? { dec: d[`m${j}`].decimals, sym: d[`m${j}`].symbol } : null; });
  }
  return cache;
}

export async function fetchBalances(address, px, meta = {}, url = GQL) {
  let after = null, nodes = [], cp = null;
  for (let page = 0; page < 6; page++) {
    const d = await gql(Q_ADDR, { a: address, after }, 20000, url);
    cp = d.checkpoint;
    const b = d.address?.balances; if (!b) break;
    nodes = nodes.concat(b.nodes);
    if (!b.pageInfo.hasNextPage) break; after = b.pageInfo.endCursor;
  }
  nodes = nodes.filter((n) => n.totalBalance !== '0');
  await coinMeta(nodes.map((n) => n.coinType.repr), meta, url);
  const coins = nodes.map((n) => {
    const type = normType(n.coinType.repr), m = meta[type], qty = m ? toUnits(n.totalBalance, m.dec) : null, p = px[type];
    return { type, symbol: m?.sym || symbolOf(type), raw: n.totalBalance, qty, usd: p && qty != null ? qty * p.usd : null, priceSrc: p?.src || null };
  }).sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1));
  return { coins, usd: coins.reduce((t, c) => t + (c.usd || 0), 0), checkpoint: cp };
}

export async function fetchTransactions(address, meta = {}) {
  const d = await gql(Q_TX, { a: address });
  const txs = (d.transactions?.nodes || []).slice().reverse();
  await coinMeta(txs.flatMap((t) => (t.effects?.balanceChanges?.nodes || []).map((c) => c.coinType.repr)), meta);
  return txs.map((t) => {
    const calls = (t.kind?.commands?.nodes || []).filter((c) => c.function).map((c) => `${c.function.module.name}::${c.function.name}`);
    const changes = (t.effects?.balanceChanges?.nodes || []).filter((c) => normAddress(c.owner?.address) === normAddress(address)).map((c) => {
      const type = normType(c.coinType.repr), m = meta[type];
      return { type, symbol: m?.sym || symbolOf(type), qty: m ? Number(c.amount) / 10 ** m.dec : null, raw: c.amount };
    });
    return { digest: t.digest, at: t.effects?.timestamp || null, status: t.effects?.status || null, sender: t.sender?.address || null,
      what: calls.length ? [...new Set(calls)].slice(0, 2).join(', ') : t.kind?.__typename === 'ProgrammableTransaction' ? 'transfer' : (t.kind?.__typename || 'system'),
      changes };
  });
}

/** BalanceManagers created by `address` (DeepBook BalanceManagerEvent), confirmed against each object's current owner field. */
export async function findBalanceManagers(address, extra = []) {
  const ids = new Set(extra.map(normAddress).filter(Boolean));
  try {
    const d = await gql(Q_BM_EVENTS, { a: address, t: DEEPBOOK_BM_EVENT });
    for (const e of d.events?.nodes || []) if (normAddress(e.contents?.json?.owner) === normAddress(address)) ids.add(normAddress(e.contents.json.balance_manager_id));
  } catch { /* event index unavailable: fall back to the extra list */ }
  return [...ids];
}

const poolAccountsCache = {};
async function poolAccountTables(pools) {
  const need = pools.filter((p) => !poolAccountsCache[p.id]);
  if (need.length) {
    const d1 = await batched(need, (p) => `object(address:"${p.id}"){ asMoveObject{ contents{ json } } }`);
    const inner = need.map((p, i) => d1[`x${i}`]?.asMoveObject?.contents?.json?.inner).map((v, i) => [need[i], v]).filter(([, v]) => v);
    const d2 = await batched(inner, ([, v]) => `address(address:"${v.id}"){ dynamicField(name:{ type:"u64", bcs:"${u64Bcs(v.version)}" }){ value{ ... on MoveValue{ json } } } }`);
    inner.forEach(([p], i) => { const t = d2[`x${i}`]?.dynamicField?.value?.json?.state?.accounts?.id; if (t) poolAccountsCache[p.id] = t; });
  }
  return poolAccountsCache;
}

/**
 * Full on-chain read of BalanceManagers: owner, free balances (Bag), and per pool the open order ids + settled balances
 * (pool Account). Order side and price are decoded from the on-chain order id; remaining size comes from the public
 * indexer (marked qtySource:'indexer') because it lives deep in the book's BigVector.
 */
export async function fetchBalanceManagers(ids, mk, meta = {}) {
  if (!ids.length) return [];
  const pools = mk.all.filter((p) => p.quoteType === normType(USDC) || mk.pairs.includes(p));
  const d = await batched(ids, (id) => `object(address:"${id}"){ asMoveObject{ contents{ type{ repr } json } } }`);
  const objs = ids.map((id, i) => ({ id, c: d[`x${i}`]?.asMoveObject?.contents })).filter((o) => o.c && normType(o.c.type.repr) === normType(DEEPBOOK_BM_TYPE));
  if (!objs.length) return [];
  const bags = await batched(objs, (o) => `address(address:"${o.c.json.balances.id}"){ dynamicFields(first:50){ nodes{ name{ type{ repr } } value{ ... on MoveValue{ json } } } } }`);
  const tables = await poolAccountTables(pools);
  const pairs = []; objs.forEach((o, i) => pools.forEach((p, j) => tables[p.id] && pairs.push([i, j])));
  const acct = {};
  const r = await batched(pairs, ([i, j]) => `address(address:"${tables[pools[j].id]}"){ dynamicField(name:{ type:"0x2::object::ID", bcs:"${idBcs(objs[i].id)}" }){ value{ ... on MoveValue{ json } } } }`);
  pairs.forEach(([i, j], n) => { const v = r[`x${n}`]?.dynamicField?.value?.json; if (v) (acct[i] ||= []).push({ pool: pools[j], v }); });
  const types = [];
  const out = objs.map((o, i) => {
    const balances = (bags[`x${i}`]?.dynamicFields?.nodes || []).map((n) => {
      const type = normType((n.name.type.repr.match(/BalanceKey<(.+)>$/) || [])[1] || '');
      types.push(type); return { type, raw: String(typeof n.value?.json === 'object' ? n.value.json.value : n.value?.json) };
    }).filter((b) => b.type && b.raw !== '0');
    const orders = [], settled = [];
    for (const { pool, v } of acct[i] || []) {
      for (const oid of v.open_orders?.contents || []) {
        const dec = decodeOrderId(oid);
        orders.push({ pool: pool.name, poolId: pool.id, orderId: String(oid), side: dec.side, price: realPrice(dec.rawPrice, pool.baseDec, pool.quoteDec),
          qty: null, filled: null, qtySource: null, lockedType: dec.side === 'buy' ? pool.quoteType : pool.baseType, lockedQty: null, base: pool.base, quote: pool.quote });
      }
      for (const [k, t, dd] of [['base', pool.baseType, pool.baseDec], ['quote', pool.quoteType, pool.quoteDec]]) {
        const raw = v.settled_balances?.[k]; if (raw && raw !== '0') settled.push({ pool: pool.name, type: t, qty: toUnits(raw, dd), symbol: k === 'base' ? pool.base : pool.quote });
      }
    }
    return { id: o.id, owner: normAddress(o.c.json.owner), balances, orders, settled };
  });
  await coinMeta(types, meta);
  for (const bm of out) for (const b of bm.balances) { const m = meta[b.type]; b.symbol = m?.sym || symbolOf(b.type); b.qty = m ? toUnits(b.raw, m.dec) : null; b.usd = mk.px[b.type] && b.qty != null ? b.qty * mk.px[b.type].usd : null; }
  // Remaining size per open order from the indexer, joined on the on-chain order id (best effort, never blocks the page).
  await Promise.all(out.flatMap((bm) => [...new Set(bm.orders.map((o) => o.pool))].map(async (pool) => {
    try {
      const rows = await getJson(links.orders(pool, bm.id), 12000);
      const byId = new Map((rows || []).map((r) => [String(r.order_id), r]));
      for (const o of bm.orders) if (o.pool === pool && byId.has(o.orderId)) {
        const r = byId.get(o.orderId); o.qty = Number(r.remaining_quantity); o.filled = Number(r.filled_quantity); o.qtySource = 'indexer';
        o.lockedQty = o.side === 'buy' ? o.qty * o.price : o.qty;
      }
    } catch { /* size unknown: shown as "–", locked value excluded */ }
  })));
  for (const bm of out) { bm.orders.sort((a, b) => a.pool.localeCompare(b.pool) || b.price - a.price); Object.assign(bm, valueBM(bm, mk.px)); }
  return out;
}

/** One address, everything: coins, BalanceManagers, last 10 transactions. */
export async function readAddress(address, mk, { extraBMs = [], meta = {} } = {}) {
  const a = normAddress(address); if (!a) throw new Error('Not a Sui address');
  const [bal, txs, bmIds] = await Promise.all([fetchBalances(a, mk.px, meta), fetchTransactions(a, meta).catch((e) => ({ error: e.message })), findBalanceManagers(a, extraBMs)]);
  let bms = [], bmError = null;
  try { bms = (await fetchBalanceManagers(bmIds, mk, meta)).filter((b) => b.owner === a || extraBMs.map(normAddress).includes(b.id)); } catch (e) { bmError = e.message; }
  const bmUsd = bms.reduce((t, b) => t + b.usd, 0);
  return { address: a, ...bal, txs: Array.isArray(txs) ? txs : [], txError: txs.error || null, bms, bmError, bmUsd, totalUsd: bal.usd + bmUsd, at: new Date() };
}
