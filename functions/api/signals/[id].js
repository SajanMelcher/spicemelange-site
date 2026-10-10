// GET /api/signals/:id   one visible idea (DRAFT)
import { json, ipHash } from '../../../store-core/http.js';
import { getSignal, readAllowed } from '../../../store-core/signals.js';
import { publicJson, sguard } from '../../../store-core/signals-http.js';
export async function onRequestGet(context) {
  const { cfg, scfg, res } = sguard(context);
  if (res) return res;
  if (!(await readAllowed(cfg, scfg, await ipHash(context.request, cfg.secret)))) return json(429, { ok: false, reason: 'read_rate_limited', retryAfterSec: 60 });
  const r = await getSignal(cfg, String(context.params.id ?? ''));
  return publicJson(r.ok ? 200 : r.status, r);
}
