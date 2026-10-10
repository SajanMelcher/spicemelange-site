// POST /api/store/status {orderId, token}  (or the token in `Authorization: Bearer`) -> same result as
// GET /api/store/order, without the token in the URL. Separate per-order hourly limit; never uses verify attempts.
import { orderStatus } from '../../../store-core/core.js';
import { guard, json, tokenFrom } from '../../../store-core/http.js';

export async function onRequestPost(context) {
  const { cfg, res } = guard(context);
  if (res) return res;
  // Read-only and token-gated, so any content-type is accepted (bots may omit it); body must still be a small JSON object.
  let b = null;
  try { const t = await context.request.text(); if (t.length <= 4096) b = JSON.parse(t); } catch { b = null; }
  if (!b || typeof b !== 'object') return json(400, { ok: false, reason: 'bad_request', hint: 'POST a JSON body {"orderId":"SM-..."} with Authorization: Bearer <token>' });
  const r = await orderStatus(cfg, { orderId: String(b.orderId ?? ''), token: tokenFrom(context.request, b, null) });
  return json(r.ok ? 200 : r.status, r);
}
