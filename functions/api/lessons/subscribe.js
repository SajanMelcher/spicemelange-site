// GET  /api/lessons/subscribe  -> { open } so the checkout box and order-page form show only when signup is open.
// POST /api/lessons/subscribe {orderId, email, source: "checkout"|"order_page"}, Authorization: Bearer <order token>
//      Opt in to Hwi's 14-day practice lessons. Lessons start after the order is paid. Email never echoed back.
import { json, readJson, sameOrigin, tokenFrom } from '../../../store-core/http.js';
import { lessonsConfig, subscribe } from '../../../store-core/lessons.js';

export async function onRequestGet(context) {
  return json(200, { ok: true, open: lessonsConfig(context.env).signupOpen });
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
