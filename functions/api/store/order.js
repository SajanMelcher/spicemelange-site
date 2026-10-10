// POST /api/store/order {sku, email?}  -> order id, private token, exact USDC amount.
// GET  /api/store/order?id=..  with `Authorization: Bearer <token>` (preferred) or legacy `&token=..`
//      -> status (and a fresh signed link once paid). Status calls never count as payment-verify attempts.
import { createOrder, orderStatus } from '../../../store-core/core.js';
import { guard, json, ipHash, readJson, sameOrigin, tokenFrom } from '../../../store-core/http.js';

export async function onRequestPost(context) {
  const { cfg, res } = guard(context);
  if (res) return res;
  if (!sameOrigin(context.request)) return json(403, { ok: false, reason: 'bad_origin' });
  const b = await readJson(context.request);
  if (!b) return json(400, { ok: false, reason: 'bad_request' });
  const selftestKey = new URL(context.request.url).searchParams.get('selftest') ?? undefined;
  const r = await createOrder(cfg, { sku: String(b.sku ?? ''), email: b.email ? String(b.email).trim() : null, ipHash: await ipHash(context.request, cfg.secret), selftestKey });
  return json(r.ok ? 201 : r.status, r);
}
export async function onRequestGet(context) {
  const { cfg, res } = guard(context);
  if (res) return res;
  const u = new URL(context.request.url);
  const r = await orderStatus(cfg, { orderId: u.searchParams.get('id'), token: tokenFrom(context.request, null, u) });
  return json(r.ok ? 200 : r.status, r);
}
