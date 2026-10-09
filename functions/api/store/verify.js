// POST /api/store/verify {orderId, token, digest?}  (no digest = auto-detect recent payments to the store)
import { verifyOrder } from '../../../store-core/core.js';
import { guard, json, readJson, sameOrigin } from '../../../store-core/http.js';

export async function onRequestPost(context) {
  const { cfg, res } = guard(context);
  if (res) return res;
  if (!sameOrigin(context.request)) return json(403, { ok: false, reason: 'bad_origin' });
  const b = await readJson(context.request);
  if (!b) return json(400, { ok: false, reason: 'bad_request' });
  const r = await verifyOrder(cfg, { orderId: String(b.orderId ?? ''), token: String(b.token ?? ''), digest: b.digest ? String(b.digest).trim() : '' });
  return json(r.ok ? 200 : r.status ?? 400, r);
}
