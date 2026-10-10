// POST /api/store/status {orderId, token}  (or the token in `Authorization: Bearer`) -> same result as
// GET /api/store/order, without the token in the URL. Separate per-order hourly limit; never uses verify attempts.
import { orderStatus } from '../../../store-core/core.js';
import { guard, json, readJson, tokenFrom } from '../../../store-core/http.js';

export async function onRequestPost(context) {
  const { cfg, res } = guard(context);
  if (res) return res;
  const b = await readJson(context.request);
  if (!b) return json(400, { ok: false, reason: 'bad_request' });
  const r = await orderStatus(cfg, { orderId: String(b.orderId ?? ''), token: tokenFrom(context.request, b, null) });
  return json(r.ok ? 200 : r.status, r);
}
