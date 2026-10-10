// POST /api/signals/:id/report {reason}   open; one report per reporter (salted IP hash) per idea (DRAFT)
import { json, ipHash } from '../../../../store-core/http.js';
import { reportSignal } from '../../../../store-core/signals.js';
import { sguard, smallJson } from '../../../../store-core/signals-http.js';
export async function onRequestPost(context) {
  const { cfg, scfg, res } = sguard(context);
  if (res) return res;
  const b = (await smallJson(context.request)) ?? {};
  const r = await reportSignal(cfg, scfg, { id: String(context.params.id ?? ''), reporter: await ipHash(context.request, cfg.secret), reason: b.reason });
  return json(r.ok ? 200 : r.status, r);
}
