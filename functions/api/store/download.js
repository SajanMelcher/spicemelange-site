// Download, always served from this path on this host (no redirects), byte-identical to the stored file.
// 1. GET  ?o=&p=&e=&s=                     signed link (HMAC, from status/verify)  [existing buyers]
// 2. GET  ?o=<orderId> + Authorization: Bearer <token>   direct, for a paid order
// 3. POST {orderId, token} (or Bearer header)             direct, for a paid order
import { checkLink, authorizeDownload } from '../../../store-core/core.js';
import { loadFile } from '../../../store-core/files.js';
import { guard, json, readJson, tokenFrom } from '../../../store-core/http.js';

async function serve(context, sku) {
  const f = await loadFile(context.env, sku);
  if (!f) return json(404, { ok: false, reason: 'not_found' });
  return new Response(f.body, {
    headers: {
      'content-type': f.type,
      'content-disposition': `attachment; filename="${f.name.replace(/[^\w.-]/g, '_')}"`,
      'cache-control': 'private, no-store, no-transform',
      'x-robots-tag': 'noindex',
      'referrer-policy': 'no-referrer',
      ...(f.sha256 ? { 'x-content-sha256': f.sha256 } : {}),
    },
  });
}
export async function onRequestGet(context) {
  const { cfg, res } = guard(context);
  if (res) return res;
  const u = new URL(context.request.url);
  const q = Object.fromEntries(u.searchParams);
  if (q.s) {
    const v = await checkLink(cfg, { ...q, nowMs: Date.now() });
    if (!v.ok) return json(403, v);
    return serve(context, q.p);
  }
  const token = tokenFrom(context.request, null, null); // header only: no tokens in download URLs
  if (!token) return json(403, { ok: false, reason: 'bad_link' });
  const a = await authorizeDownload(cfg, { orderId: q.o, token });
  return a.ok ? serve(context, a.sku) : json(a.status, a);
}
export async function onRequestPost(context) {
  const { cfg, res } = guard(context);
  if (res) return res;
  const b = await readJson(context.request);
  if (!b) return json(400, { ok: false, reason: 'bad_request' });
  const a = await authorizeDownload(cfg, { orderId: String(b.orderId ?? ''), token: tokenFrom(context.request, b, null) });
  return a.ok ? serve(context, a.sku) : json(a.status, a);
}
