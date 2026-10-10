// GET  /api/lessons/subscribe  -> { open, lessonsLive } so the checkout box and order-page form show only when signup is open,
//      and the "on hold until the privacy page is live" sentence follows the legal gate (Siona GL6). Gate result cached 5 min.
// POST /api/lessons/subscribe {orderId, email, source: "checkout"|"order_page"}, Authorization: Bearer <order token>
//      Double opt-in step 1 for Hwi's 14-day practice lessons. A confirmation email follows once the order is paid;
//      lessons start only after the buyer confirms. Email never echoed back.
import { json, readJson, sameOrigin, tokenFrom } from '../../../store-core/http.js';
import { lessonsConfig, subscribe, legalGate } from '../../../store-core/lessons.js';

let cache = { at: 0, base: '', live: false };
export async function gateLive(lcfg, origin, nowMs = Date.now(), fetchImpl = fetch) {
  if (cache.base === origin && nowMs - cache.at < 300_000) return cache.live;
  const g = await legalGate({ ...lcfg, baseUrl: origin }, fetchImpl).catch(() => ({ open: false }));
  cache = { at: nowMs, base: origin, live: Boolean(g.open) };
  return cache.live;
}
export async function onRequestGet(context) {
  const lcfg = lessonsConfig(context.env);
  const lessonsLive = await gateLive(lcfg, new URL(context.request.url).origin);
  return json(200, { ok: true, open: lcfg.signupShown, lessonsLive });
}
export async function onRequestPost(context) {
  if (!sameOrigin(context.request)) return json(403, { ok: false, reason: 'bad_origin' });
  const b = await readJson(context.request);
  if (!b) return json(400, { ok: false, reason: 'bad_request' });
  const token = tokenFrom(context.request, null, null);
  if (!token) return json(401, { ok: false, reason: 'token_required_in_authorization_header' });
  const r = await subscribe(lessonsConfig(context.env), { orderId: String(b.orderId ?? ''), token, email: b.email, source: b.source });
  return json(r.ok ? 200 : r.status, r);
}
