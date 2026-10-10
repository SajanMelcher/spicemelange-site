// GET  /api/signals?pool=SUI_USDC&limit=30&before=<iso>   open read, visible ideas only, newest first
// POST /api/signals {orderId, idea}  Authorization: Bearer <paid order token>   (DRAFT; not deployed)
import { json, ipHash, tokenFrom } from '../../../store-core/http.js';
import { createSignal, listSignals, readAllowed } from '../../../store-core/signals.js';
import { publicJson, sguard, smallJson } from '../../../store-core/signals-http.js';

export async function onRequestGet(context) {
  const { cfg, scfg, res } = sguard(context);
  if (res) return res;
  if (!(await readAllowed(cfg, scfg, await ipHash(context.request, cfg.secret)))) return json(429, { ok: false, reason: 'read_rate_limited', retryAfterSec: 60 });
  const u = new URL(context.request.url);
  const r = await listSignals(cfg, { pool: u.searchParams.get('pool') ?? undefined, limit: u.searchParams.get('limit') ?? undefined, before: u.searchParams.get('before') ?? undefined });
  return publicJson(r.ok ? 200 : r.status, r);
}

export async function onRequestPost(context) {
  const { cfg, scfg, res } = sguard(context);
  if (res) return res;
  const b = await smallJson(context.request);
  if (!b) return json(400, { ok: false, reason: 'bad_request', hint: 'POST JSON {"orderId":"SM-...","idea":{...}} with Authorization: Bearer <token>' });
  // header only: a token in the body or URL is refused so it never lands in logs
  const token = tokenFrom(context.request, null, null);
  if (!token) return json(401, { ok: false, reason: 'token_required_in_authorization_header' });
  const r = await createSignal(cfg, scfg, { orderId: b.orderId, token, idea: b.idea });
  return json(r.ok ? 201 : r.status, r);
}
