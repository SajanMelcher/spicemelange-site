// Per-IP rate limit for the /sign/ APIs on the prod domain (Siona F-2), D1 atomic counter (migrations/0013_rate_limits.sql).
// key = <endpoint>:<HMAC-SHA256(SPICE_SESSION_SECRET, CF-Connecting-IP), first 12 bytes hex>; window = floor(now / 60 s).
// ONE statement increments (or resets on a new window) and returns the count, so concurrent requests can't both read a stale value.
// Rows from before the previous window are deleted in the same batch, so a hashed IP is kept for about 2 minutes (/privacy/).
// Fails CLOSED (503) if D1 or the secret is missing, or D1 errors. Preview is not limited (callers skip it).
export const SIGN_RATE = Object.freeze({ perMinute: 20, windowSec: 60, retentionSec: 120 });
const te = new TextEncoder();
export async function ipHash(secret, ip) {
  const k = await crypto.subtle.importKey('raw', te.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, te.encode(String(ip))))].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}
export const UPSERT = `INSERT INTO rate_limits (key, "window", count) VALUES (?1, ?2, 1)
  ON CONFLICT(key) DO UPDATE SET count = CASE WHEN rate_limits."window" = excluded."window" THEN rate_limits.count + 1 ELSE 1 END,
  "window" = excluded."window" RETURNING count`;
export const CLEANUP = `DELETE FROM rate_limits WHERE "window" < ?1`;
const res = (s, reason) => new Response(JSON.stringify({ ok: false, reason }), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '60' } });
/** Returns null when allowed, or a 429 / 503 Response. endpoint: a short fixed label ('admin-tx', 'upgrade-tx'). */
export async function signRateLimit(request, env, now = Date.now(), endpoint = new URL(request.url).pathname) {
  const db = env?.STORE_DB, secret = env?.SPICE_SESSION_SECRET;
  if (!db || !secret || String(secret).length < 32) return res(503, 'not_configured');
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const w = Math.floor(now / 1000 / SIGN_RATE.windowSec);
  try {
    const key = `${String(endpoint).slice(0, 64)}:${await ipHash(secret, ip)}`;
    const [, up] = await db.batch([db.prepare(CLEANUP).bind(w - 1), db.prepare(UPSERT).bind(key, w)]);
    const n = Number(up?.results?.[0]?.count);
    if (!Number.isFinite(n)) return res(503, 'rate_limit_unavailable');
    return n > SIGN_RATE.perMinute ? res(429, 'rate_limited') : null;
  } catch { return res(503, 'rate_limit_unavailable'); }
}
