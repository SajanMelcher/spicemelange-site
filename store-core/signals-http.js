// DRAFT signal feed helpers. Feed is off unless SIGNALS_ENABLED=1 (and the store is enabled).
import { guard, json } from './http.js';
import { signalsConfig } from './signals.js';
export function sguard(context) {
  const { cfg, res } = guard(context);
  if (res) return { res };
  const scfg = signalsConfig(context.env);
  if (!scfg.enabled) return { res: json(503, { ok: false, reason: 'signals_not_open' }) };
  return { cfg, scfg };
}
export const publicJson = (status, body) => {
  const r = json(status, body);
  r.headers.set('access-control-allow-origin', '*');
  if (status === 200) r.headers.set('cache-control', 'public, max-age=30');
  return r;
};
export async function smallJson(request) {
  try { const t = await request.text(); if (t.length > 8192) return null; const b = JSON.parse(t); return b && typeof b === 'object' ? b : null; } catch { return null; }
}
