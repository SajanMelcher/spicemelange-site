// POST /api/store/pay-tx {orderId, sender} + `Authorization: Bearer <token>` -> unsigned, dry-run-checked USDC transfer
// (tx_json) for the buyer's wallet to sign and execute. Never signs or submits anything.
import { buildPayTx } from '../../../store-core/pay-tx.js';
import { guard, json, readJson, sameOrigin, tokenFrom } from '../../../store-core/http.js';

export async function onRequestPost(context) {
  const { cfg, res } = guard(context);
  if (res) return res;
  if (!sameOrigin(context.request)) return json(403, { ok: false, reason: 'bad_origin' });
  const b = await readJson(context.request);
  if (!b) return json(400, { ok: false, reason: 'bad_request' });
  const r = await buildPayTx(cfg, { orderId: String(b.orderId ?? ''), token: tokenFrom(context.request, b, null), sender: String(b.sender ?? '') });
  return json(r.ok ? 200 : r.status, r);
}
