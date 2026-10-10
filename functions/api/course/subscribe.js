// GET  /api/course/subscribe -> { open } (the /learn/ form shows only while signup is open)
// POST /api/course/subscribe {email, consent:true, track?, goal?, time?, agent?, src?}  double opt-in step 1 (R6)
//      Same reply whether or not the address is known; rate-limited per salted IP hash and site-wide.
import { json, readJson, sameOrigin, ipHash } from '../../../store-core/http.js';
import { courseConfig, courseSubscribe } from '../../../store-core/course.js';

export async function onRequestGet(context) {
  return json(200, { ok: true, open: courseConfig(context.env).signupOpen });
}
export async function onRequestPost(context) {
  if (!sameOrigin(context.request)) return json(403, { ok: false, reason: 'bad_origin' });
  const body = await readJson(context.request);
  if (!body) return json(400, { ok: false, reason: 'bad_request' });
  const ipKey = await ipHash(context.request, String(context.env.DOWNLOAD_HMAC_SECRET ?? 'course'));
  const r = await courseSubscribe(courseConfig(context.env), { body, ipKey });
  return json(r.ok ? 200 : r.status, r);
}
