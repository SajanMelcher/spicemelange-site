import { loadConfig, sha256Hex } from './core.js';
export const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
});
export function guard(context) {
  const cfg = loadConfig(context.env);
  if (!cfg.enabled) return { res: json(503, { ok: false, reason: cfg.reason === 'store_not_open' ? 'store_not_open' : 'store_misconfigured' }) };
  return { cfg };
}
export async function ipHash(request, secret) {
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  return (await sha256Hex(`${secret}|ip|${ip}`)).slice(0, 24); // salted; raw IPs never stored
}
export async function readJson(request) {
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) return null;
  const t = await request.text();
  if (t.length > 4096) return null;
  try { return JSON.parse(t); } catch { return null; }
}
export const sameOrigin = (request) => {
  const o = request.headers.get('origin');
  return !o || o === new URL(request.url).origin;
};

/** Order token from `Authorization: Bearer smt_...`, then a JSON body field, then the legacy `token` query param. */
export function tokenFrom(request, body, url) {
  const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  return m?.[1] ?? (body && typeof body.token === 'string' ? body.token : null) ?? url?.searchParams.get('token') ?? null;
}
