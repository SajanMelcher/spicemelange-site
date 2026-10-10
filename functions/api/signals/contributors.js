// GET /api/signals/contributors   open: pseudonymous contributors with idea counts and granted credit/bounty points
import { json, ipHash } from '../../../store-core/http.js';
import { listContributors, readAllowed } from '../../../store-core/signals.js';
import { publicJson, sguard } from '../../../store-core/signals-http.js';
export async function onRequestGet(context) {
  const { cfg, scfg, res } = sguard(context);
  if (res) return res;
  if (!(await readAllowed(cfg, scfg, await ipHash(context.request, cfg.secret)))) return json(429, { ok: false, reason: 'read_rate_limited', retryAfterSec: 60 });
  const r = await listContributors(cfg, { limit: new URL(context.request.url).searchParams.get('limit') ?? undefined });
  return publicJson(200, r);
}
