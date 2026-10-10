// GET  /api/course/subscribe -> { open } (the /learn/ form shows only while signup is open)
// POST /api/course/subscribe {email, consent:true, track?, goal?, time?, agent?, src?}  double opt-in step 1 (R6)
//      Same reply whether or not the address is known; rate-limited per salted IP hash and site-wide.
import { json, readJson, sameOrigin, ipHash } from '../../../store-core/http.js';
import { courseConfig, courseSubscribe } from '../../../store-core/course.js';

export async function onRequestGet(context) {
  const c = courseConfig(context.env);
  return json(200, { ok: true, open: c.production || (c.net === 'testnet' && c.testRecipients.length > 0) });
}
export async function onRequestPost(context) {
  if (!sameOrigin(context.request)) return json(403, { ok: false, reason: 'bad_origin' });
  const body = await readJson(context.request);
  if (!body) return json(400, { ok: false, reason: 'bad_request' });
  // GL3: the IP-hash salt is required; fail closed (no signup, nothing stored) if it isn't set.
  const salt = String(context.env.DOWNLOAD_HMAC_SECRET ?? '');
  if (salt.length < 16) return json(503, { ok: false, reason: 'not_configured' });
  const ipKey = await ipHash(context.request, salt);
  const r = await courseSubscribe(courseConfig(context.env), { body, ipKey });
  return json(r.ok ? 200 : r.status, r);
}
