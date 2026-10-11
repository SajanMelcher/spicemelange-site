// Per-IP rate limit for the /sign/ APIs on the prod domain (Siona F-2). Counter key = HMAC-SHA256(secret, IP) truncated, one
// bucket per minute, KV TTL 120 s (no raw IP stored; hash gone within ~2 minutes). Preview is not limited.
export const SIGN_RATE = Object.freeze({ perMinute: 20, ttlSec: 120 });
const te = new TextEncoder();
async function ipKey(secret, ip) {
  const k = await crypto.subtle.importKey('raw', te.encode(String(secret)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', k, te.encode(String(ip))))].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}
/** Returns null when allowed, or a 429 Response. Fails CLOSED (503) if KV or the secret is missing. */
export async function signRateLimit(request, env, now = Date.now()) {
  const kv = env.STORE_KV, secret = env.SPICE_SESSION_SECRET;
  const res = (s, reason) => new Response(JSON.stringify({ ok: false, reason }), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '60' } });
  if (!kv || !secret) return res(503, 'not_configured');
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const key = `signrl:${await ipKey(secret, ip)}:${Math.floor(now / 60_000)}`;
  const n = Number((await kv.get(key)) ?? 0);
  if (n >= SIGN_RATE.perMinute) return res(429, 'rate_limited');
  await kv.put(key, String(n + 1), { expirationTtl: SIGN_RATE.ttlSec });
  return null;
}
