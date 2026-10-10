// R8: Resend inbound webhook (email.received for replies to reserve@). Verified with the svix signature
// (COURSE_INBOUND_SECRET); refuses everything while the secret is unset. Never auto-replies. 'stop' unsubscribes;
// other keywords become pending suggestions for Hwi (applied only after Sajan approves).
import { json } from '../../../store-core/http.js';
import { courseInbound, verifyWebhook } from '../../../store-core/course.js';

// Siona LL3 (2026-10-10): DORMANT. Returns 404 unless COURSE_INBOUND_ENABLED = "1" (set nowhere), so the prod build
// has no live inbound route. The code below stays for a later, separately approved launch.
export const INBOUND_ENABLED = (env) => String(env?.COURSE_INBOUND_ENABLED ?? '') === '1';
export async function onRequestPost(context) {
  if (!INBOUND_ENABLED(context.env)) return json(404, { ok: false, reason: 'not_found' });
  const raw = await context.request.text();
  if (raw.length > 200_000) return json(413, { ok: false });
  if (!(await verifyWebhook(String(context.env.COURSE_INBOUND_SECRET ?? ''), context.request.headers, raw))) return json(401, { ok: false, reason: 'bad_signature' });
  let ev; try { ev = JSON.parse(raw); } catch { return json(400, { ok: false }); }
  if (ev?.type !== 'email.received') return json(200, { ok: true, ignored: true });
  const d = ev.data ?? {};
  const r = await courseInbound(context.env, { from: d.from, text: d.text ?? '' });
  return json(200, { ok: true, matched: r.matched, keyword: r.keyword ?? null });
}
