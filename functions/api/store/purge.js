// POST /api/store/purge  (Authorization: Bearer <STORE_PURGE_KEY>)  -> runs the retention purge now (Siona S3, scheduled path).
// Called every 15 minutes by the box cron (autopilot/store-purge-cron.sh). The traffic-based maybePurge() stays as a backup.
// Without STORE_PURGE_KEY set (>= 32 chars) the endpoint is disabled (404). Deletes only what store-core/purge.js allows.
import { guard, json } from '../../../store-core/http.js';
import { safeEqual } from '../../../store-core/core.js';
import { purge } from '../../../store-core/purge.js';

export async function onRequestPost(context) {
  const key = String(context.env.STORE_PURGE_KEY ?? '');
  if (key.length < 32) return json(404, { ok: false, reason: 'not_found' });
  const m = /^Bearer\s+(\S+)$/i.exec(context.request.headers.get('authorization') ?? '');
  if (!m || !safeEqual(m[1], key)) return json(401, { ok: false, reason: 'unauthorized' });
  const { cfg, res } = guard(context);
  if (res) return res;
  const deleted = await purge(cfg.db, Date.now(), { salt: context.env.SUPPRESSION_SALT });
  console.log('scheduled retention purge', JSON.stringify(deleted));
  return json(200, { ok: true, deleted });
}
