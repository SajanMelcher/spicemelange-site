// Shared DeepBook indexer logic. Plain ESM so both the browser dashboard and the
// Node snapshot script (scripts/deepbook-snapshot.mjs) use the exact same math.
export const INDEXER = 'https://deepbook-indexer.mainnet.mystenlabs.com';
export const POOLS = ['XBTC_USDC', 'SUI_USDC', 'WAL_USDC', 'DEEP_USDC', 'NS_USDC', 'IKA_USDC'];
export const BANDS = [1, 2];

async function getJson(url, timeoutMs = 10000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/** Mid, spread and ±band depth (in quote/USDC) from a raw indexer book. */
export function analyzeBook(raw) {
  const bids = (raw.bids || []).map(([p, q]) => [Number(p), Number(q)]).sort((a, b) => b[0] - a[0]);
  const asks = (raw.asks || []).map(([p, q]) => [Number(p), Number(q)]).sort((a, b) => a[0] - b[0]);
  if (!bids.length || !asks.length) return null;
  const bid = bids[0][0], ask = asks[0][0];
  const mid = (bid + ask) / 2;
  const spread_bps = ((ask - bid) / mid) * 1e4;
  const depth = {};
  for (const pct of BANDS) {
    const lo = mid * (1 - pct / 100), hi = mid * (1 + pct / 100);
    const b = bids.filter(([p]) => p >= lo), a = asks.filter(([p]) => p <= hi);
    depth[pct] = {
      bid_usd: b.reduce((s, [p, q]) => s + p * q, 0),
      ask_usd: a.reduce((s, [p, q]) => s + p * q, 0),
      // The indexer serves ~100 levels/side; if every level is inside the band the value is a lower bound.
      truncated: b.length === bids.length || a.length === asks.length,
    };
  }
  return { bid, ask, mid, spread_bps, depth, book_ts: Number(raw.timestamp) || Date.now() };
}

export async function fetchSummary(base = INDEXER) {
  const rows = await getJson(`${base}/summary`);
  const map = {};
  for (const r of rows) map[r.trading_pairs] = {
    vol24_usd: r.quote_volume, chg24_pct: r.price_change_percent_24h, last: r.last_price,
    high24: r.highest_price_24h, low24: r.lowest_price_24h, base: r.base_currency,
  };
  return map;
}

export async function fetchBook(pool, base = INDEXER) {
  return analyzeBook(await getJson(`${base}/orderbook/${pool}?level=2&depth=200`));
}

/** 1h candles, oldest first, as [ms, close]. Note: the indexer path really is spelled "ohclv". */
export async function fetchCandles(pool, base = INDEXER, limit = 48) {
  const j = await getJson(`${base}/ohclv/${pool}?interval=1h&limit=${limit}`);
  return (j.candles || []).map((c) => [Number(c[0]), Number(c[4])]).sort((a, b) => a[0] - b[0]);
}

export async function fetchAll(base = INDEXER, { candles = true } = {}) {
  const summary = await fetchSummary(base).catch(() => ({}));
  const pools = await Promise.all(POOLS.map(async (pool) => {
    const [book, series] = await Promise.all([
      fetchBook(pool, base).catch(() => null),
      candles ? fetchCandles(pool, base).catch(() => null) : Promise.resolve(null),
    ]);
    return { pool, ...(summary[pool] || {}), book, candles: series };
  }));
  return { generated_at: new Date().toISOString(), source: base, pools };
}
