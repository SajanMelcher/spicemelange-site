// GET /api/store/download?o=&p=&e=&s=  -> file, only with a valid, unexpired HMAC signature.
import { checkLink } from '../../../store-core/core.js';
import { loadFile } from '../../../store-core/files.js';
import { guard, json } from '../../../store-core/http.js';

export async function onRequestGet(context) {
  const { cfg, res } = guard(context);
  if (res) return res;
  const q = Object.fromEntries(new URL(context.request.url).searchParams);
  const v = await checkLink(cfg, { ...q, nowMs: Date.now() });
  if (!v.ok) return json(403, v);
  const f = await loadFile(context.env, q.p);
  if (!f) return json(404, { ok: false, reason: 'not_found' });
  return new Response(f.body, {
    headers: {
      'content-type': f.type,
      'content-disposition': `attachment; filename="${f.name.replace(/[^\w.-]/g, '_')}"`,
      'cache-control': 'private, no-store',
      'x-robots-tag': 'noindex',
      'referrer-policy': 'no-referrer',
    },
  });
}
