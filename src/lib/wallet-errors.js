// Real errors on the wallet-signing pages (Sajan 10/10 9:45 PM PT saw only "Failed to fetch"): our endpoint + HTTP status,
// the step that failed, and any request the page's CSP blocked (an injected wallet's own fetch shows up here).
export const blocked = [];
if (typeof document !== 'undefined')
  document.addEventListener('securitypolicyviolation', (e) => blocked.push(`${e.effectiveDirective} blocked ${e.blockedURI}`));
// Any page-realm fetch that fails (an injected wallet's RPC call, CORS, dead endpoint) is named too: host + path only.
if (typeof window !== 'undefined' && window.fetch && !window.fetch.__spiceWrapped) {
  const f0 = window.fetch.bind(window);
  const w = async (input, init) => {
    try { return await f0(input, init); } catch (e) {
      try { const u = new URL(typeof input === 'string' ? input : input?.url ?? String(input), location.href); blocked.push(`fetch ${u.origin}${u.pathname} failed: ${e?.message || e}`); } catch {}
      throw e;
    }
  };
  w.__spiceWrapped = true; window.fetch = w;
}
export async function apiCall(ep, init = {}, fetchFn = globalThis.fetch) {
  const m = init.method ?? 'GET';
  let r;
  try { r = await fetchFn(ep, init); } catch (e) { return { ok: false, reason: 'network_error', detail: `${m} ${ep}: ${e?.message || e} (no HTTP response)` }; }
  const j = await r.json().catch(() => null);
  if (!j || typeof j !== 'object') return { ok: false, reason: 'bad_response', detail: `${m} ${ep}: HTTP ${r.status}, not JSON` };
  if (!j.ok) j.detail = (typeof j.detail === 'string' ? j.detail + '; ' : '') + `${m} ${ep}: HTTP ${r.status}`;
  return j;
}
export function failText(step, e) {
  const b = [...new Set(blocked)];
  return `Cancelled or failed at step "${step}": ${String(e?.message || e).slice(0, 200)}` + (b.length ? ` | page blocked: ${b.join(', ').slice(0, 300)}` : '');
}
