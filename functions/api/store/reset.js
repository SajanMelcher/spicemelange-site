// Buyer token reset, proven with the paying Sui wallet.
// POST /api/store/reset {orderId}                         -> {message} to sign (single use, 10 min)
// POST /api/store/reset {orderId, message, signature}     -> new token (old one revoked) + fresh download link
import { resetChallenge, resetToken } from '../../../store-core/core.js';
import { guard, json, readJson, sameOrigin } from '../../../store-core/http.js';

export async function onRequestPost(context) {
  const { cfg, res } = guard(context);
  if (res) return res;
  if (!sameOrigin(context.request)) return json(403, { ok: false, reason: 'bad_origin' });
  const b = await readJson(context.request);
  if (!b) return json(400, { ok: false, reason: 'bad_request' });
  const orderId = String(b.orderId ?? '');
  const r = b.signature
    ? await resetToken(cfg, { orderId, message: String(b.message ?? ''), signature: String(b.signature) })
    : await resetChallenge(cfg, { orderId });
  return json(r.ok ? 200 : r.status, r);
}
