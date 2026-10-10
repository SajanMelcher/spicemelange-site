// Desk rhythm feed (Sajan 2026-10-10 12:25 AM PT): weekly guidance drafted by the desk's God Emperor, published as a
// static signed file (public/rhythm.json + rhythm.json.sig, ed25519 release key). GUIDANCE ONLY: no orders, no sizes in
// money, no return promises. Each Fish Speakers chooses within its own guards and wallet.
export const RHYTHM_SCHEMA = 'spicemelange.rhythm/v1';
export const RHYTHM_DISCLAIMER = 'Guidance only. Not an order, not a recommendation to buy or sell, and not investment advice. No sizes in money and no promised returns. Each agent decides within its own guards and its own wallet, and trains on paper first.';
const POOL = /^[A-Z0-9]{1,12}_[A-Z0-9]{1,12}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const FORBIDDEN_KEYS = /^(orders?|size|sizes|qty|quantity|amount|amounts|notional|usd|price|prices|limit_?price|side|leverage|margin|borrow|execute|tx|wallet|address|key|token)$/i;
// Text checks: money sizes, promises, addresses, links, contact details, instructions to act.
const TEXT_RULES = [
  ['money_size', /[$€£]\s?\d|\b\d[\d,.]*\s?(usd|usdc|usdt|dollars?|eur)\b/i],
  ['return_promise', /\b(guarantee[sd]?|risk[- ]free|sure thing|can'?t lose|will (return|make|earn)|promised? returns?|\d+\s?x\b)/i],
  ['address_or_id', /\b0x[0-9a-f]{6,}/i],
  ['link', /https?:\/\/|www\./i],
  ['email', /[a-z0-9._%+-]+@[a-z0-9-]+\.[a-z]{2,}/i],
  ['order_instruction', /\b(place|submit|send|market)\s+(an?\s+)?(order|buy|sell)s?\b|\bbuy now\b|\bsell now\b/i],
];
function walk(v, at, out) {
  if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${at}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (FORBIDDEN_KEYS.test(k)) out.push(`${at}.${k}: forbidden key`); walk(x, `${at}.${k}`, out); }
  else if (typeof v === 'string') { if (at === '$.disclaimer' || at.startsWith('$.signature')) return; for (const [n, re] of TEXT_RULES) if (re.test(v)) out.push(`${at}: ${n}`); if (v.length > 600) out.push(`${at}: too long`); }
}
const pct = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 100;
export function validateRhythm(d) {
  const e = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['not an object'];
  const allowed = ['schema', 'issued', 'week', 'dailyNote', 'focusPools', 'ladderWindows', 'rungs', 'rebalanceRanges', 'projects', 'lessons', 'guidanceOnly', 'disclaimer', 'source', 'signature'];
  for (const k of Object.keys(d)) if (!allowed.includes(k)) e.push(`unknown_field:${k}`);
  if (d.schema !== RHYTHM_SCHEMA) e.push('schema');
  if (d.guidanceOnly !== true) e.push('guidanceOnly must be true');
  if (d.disclaimer !== RHYTHM_DISCLAIMER) e.push('disclaimer must be the standard text');
  if (typeof d.issued !== 'string' || Number.isNaN(Date.parse(d.issued))) e.push('issued');
  if (!d.week || !DATE.test(d.week.start ?? '') || !DATE.test(d.week.end ?? '') || d.week.start > d.week.end) e.push('week');
  if (d.dailyNote != null && (typeof d.dailyNote !== 'object' || !DATE.test(d.dailyNote.date ?? '') || typeof d.dailyNote.text !== 'string')) e.push('dailyNote');
  if (!Array.isArray(d.focusPools) || !d.focusPools.length || d.focusPools.length > 8 || d.focusPools.some((p) => !POOL.test(p?.pool ?? '') || typeof p.why !== 'string')) e.push('focusPools');
  if (!Array.isArray(d.ladderWindows) || d.ladderWindows.some((w) => typeof w?.label !== 'string' || !HHMM.test(w.utcStart ?? '') || !HHMM.test(w.utcEnd ?? '') || (w.days && !Array.isArray(w.days)))) e.push('ladderWindows');
  const r = d.rungs;
  if (!r || !Number.isInteger(r.default) || !Number.isInteger(r.max) || r.default < 1 || r.max > 5 || r.default > r.max || typeof r.wideSwing !== 'string') e.push('rungs (default <= max <= 5)');
  if (!Array.isArray(d.rebalanceRanges) || d.rebalanceRanges.some((b) => typeof b?.bucket !== 'string' || !pct(b.minPct) || !pct(b.maxPct) || b.minPct > b.maxPct)) e.push('rebalanceRanges (percent ranges only)');
  if (!Array.isArray(d.projects) || d.projects.some((p) => typeof p?.title !== 'string' || typeof p.status !== 'string')) e.push('projects');
  if (!Array.isArray(d.lessons) || d.lessons.some((l) => typeof l?.id !== 'string' || typeof l.text !== 'string')) e.push('lessons');
  const t = []; walk(d, '$', t); e.push(...t);
  return e;
}
