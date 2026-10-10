// POST /api/signals/moderate {id, action: hide|restore|remove|hold|credit|bounty, points?, note?}
// Authorization: Bearer <SIGNALS_ADMIN_KEY>   (DRAFT)
import { json } from '../../../store-core/http.js';
import { moderateSignal } from '../../../store-core/signals.js';
import { sguard, smallJson } from '../../../store-core/signals-http.js';
export async function onRequestPost(context) {
  const { cfg, scfg, res } = sguard(context);
  if (res) return res;
  const b = await smallJson(context.request);
  if (!b) return json(400, { ok: false, reason: 'bad_request' });
  const m = /^Bearer\s+(\S+)$/i.exec(context.request.headers.get('authorization') ?? '');
  const r = await moderateSignal(cfg, scfg, { adminKey: m?.[1], id: b.id, action: b.action, points: b.points, note: b.note });
  return json(r.ok ? 200 : r.status, r);
}
