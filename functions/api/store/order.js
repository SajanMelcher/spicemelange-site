// POST /api/store/order {sku, email?}  -> order id, private token, exact USDC amount.
// GET  /api/store/order?id=..&token=..  -> status (and a fresh signed link once paid).
import { createOrder, orderStatus } from '../../../store-core/core.js';
import { guard, json, ipHash, readJson, sameOrigin } from '../../../store-core/http.js';

export async function onRequestPost(context) {
  const { cfg, res } = guard(context);
  if (res) return res;
  if (!sameOrigin(context.request)) return json(403, { ok: false, reason: 'bad_origin' });
  const b = await readJson(context.request);
  if (!b) return json(400, { ok: false, reason: 'bad_request' });
  const r = await createOrder(cfg, { sku: String(b.sku ?? ''), email: b.email ? String(b.email).trim() : null, ipHash: await ipHash(context.request, cfg.secret) });
  return json(r.ok ? 201 : r.status, r);
}
export async function onRequestGet(context) {
  const { cfg, res } = guard(context);
  if (res) return res;
  const u = new URL(context.request.url);
  const r = await orderStatus(cfg, { orderId: u.searchParams.get('id'), token: u.searchParams.get('token') });
  return json(r.ok ? 200 : r.status, r);
}
