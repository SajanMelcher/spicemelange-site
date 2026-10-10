/**
 * DRAFT desk signal feed (branch signal-feed-draft; NOT deployed, needs the owner's yes).
 * Trade IDEAS only: text plus a small JSON of numbers/tags. The server never builds, signs, routes or executes
 * anything, and the response marks every item executable:false.
 *   read   : open (GET), per-IP rate limit, visible items only
 *   post   : a PAID store order token (Authorization: Bearer smt_...), per-order daily cap + minimum gap,
 *            automated moderation (reject links/addresses/keys; hold hype for review), duplicate check
 *   report : open, one per reporter per idea; N distinct reports hold an idea for review
 *   mod    : SIGNALS_ADMIN_KEY bearer: hide / restore / remove / hold / credit / bounty (append-only audit log)
 * Attribution: public pseudonym spice-<hmac(order)>; the order id is stored privately so bounties/credits can be
 * paid out later; credits are append-only rows.
 * Off unless SIGNALS_ENABLED=1 AND the store itself is enabled.
 */
import { hmac, paidOrder, randomBytes, sha256Hex } from './core.js';

const truthy = (v) => v === '1' || v === 'true' || v === true;
const int = (v, d, lo, hi) => { const n = v === undefined || v === '' ? d : Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : d; };
export const DISCLAIMER = 'User-posted trade ideas. Not investment advice. Nothing here places or executes trades.';

export function signalsConfig(env = {}) {
  if (!truthy(env.SIGNALS_ENABLED)) return { enabled: false, reason: 'signals_not_open' };
  const admin = String(env.SIGNALS_ADMIN_KEY ?? '');
  return {
    enabled: true,
    postsPerDay: int(env.SIGNALS_POSTS_PER_DAY, 5, 1, 100),
    minGapSec: int(env.SIGNALS_MIN_GAP_SEC, 600, 0, 86400),
    readsPerMin: int(env.SIGNALS_READS_PER_MIN, 120, 10, 10000),
    reportsPerDay: int(env.SIGNALS_REPORTS_PER_DAY, 20, 1, 1000),
    holdAtReports: int(env.SIGNALS_HOLD_AT_REPORTS, 3, 1, 100),
    adminKey: admin.length >= 32 ? admin : null,
  };
}

// ---------- validation (mirrors the desk-kit client) ----------
const FIELDS = ['pool', 'side', 'thesis', 'entry', 'target', 'invalidation', 'horizonHours', 'confidence', 'tags'];
export function validateIdea(i) {
  const e = [];
  if (!i || typeof i !== 'object' || Array.isArray(i)) return ['idea must be an object'];
  if (typeof i.pool !== 'string' || !/^[A-Z0-9]{1,12}_[A-Z0-9]{1,12}$/.test(i.pool)) e.push('pool');
  if (!['buy', 'sell', 'watch'].includes(i.side)) e.push('side');
  if (typeof i.thesis !== 'string' || i.thesis.trim().length < 20 || i.thesis.length > 1200) e.push('thesis_length');
  for (const k of ['entry', 'target', 'invalidation', 'horizonHours']) if (i[k] !== undefined && !(typeof i[k] === 'number' && Number.isFinite(i[k]) && i[k] > 0 && i[k] < 1e12)) e.push(k);
  if (i.confidence !== undefined && !['low', 'medium', 'high'].includes(i.confidence)) e.push('confidence');
  if (i.tags !== undefined && (!Array.isArray(i.tags) || i.tags.length > 5 || i.tags.some((t) => typeof t !== 'string' || !/^[a-z0-9-]{1,24}$/.test(t)))) e.push('tags');
  for (const k of Object.keys(i)) if (!FIELDS.includes(k)) e.push(`unknown_field:${k}`);
  return e;
}

// ---------- automated moderation ----------
const REJECT = [
  [/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|io|xyz|app|gg|me|net|org|link)\b|t\.me\/|discord\.gg/i, 'links_not_allowed'],
  [/0x[0-9a-f]{8,}|\b[0-9a-f]{32,}\b/i, 'addresses_or_ids_not_allowed'],
  [/suiprivkey|private key|seed phrase|mnemonic|-----BEGIN/i, 'keys_or_secrets_not_allowed'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/i, 'contact_details_not_allowed'],
  [/(?:\+\d{1,3}[\s-]?)?\(?\b\d{3}\)?[\s-]\d{3}[\s-]\d{4}\b/, 'contact_details_not_allowed'],
  [/\b(send|transfer|deposit)\b.{0,30}\b(to me|my wallet|this wallet)\b/i, 'solicitation_not_allowed'],
];
const HOLD = [
  [/\bguarantee(d|s)?\b|risk[- ]free|can'?t lose|no[- ]lose|\b\d{2,}x\b|to the moon|free money/i, 'hype_review'],
  [/\b(dm|message) me\b|\bjoin my\b|\bsignal group\b|\bpaid group\b/i, 'promotion_review'],
];
export function moderate(text) {
  for (const [re, why] of REJECT) if (re.test(text)) return { reject: why };
  const letters = text.replace(/[^A-Za-z]/g, '');
  if (letters.length > 40 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.6) return { hold: 'caps_review' };
  for (const [re, why] of HOLD) if (re.test(text)) return { hold: why };
  return {};
}

// ---------- counters ----------
async function hit(db, k, bucket, limit) {
  const r = await db.prepare(
    `INSERT INTO signal_hits (k, bucket, n) VALUES (?1, ?2, 1)
     ON CONFLICT (k, bucket) DO UPDATE SET n = n + 1 WHERE signal_hits.n < ?3`).bind(k, bucket, limit).run();
  return Number(r?.meta?.changes ?? 0) === 1;
}
const day = (ms) => `d${Math.floor(ms / 86_400_000)}`;
const minute = (ms) => `m${Math.floor(ms / 60_000)}`;
export const authorOf = async (cfg, orderId) => 'spice-' + (await hmac(cfg.secret, `signals|author|${orderId}`)).replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toLowerCase();
const newId = () => 'sig_' + [...randomBytes(12)].map((b) => b.toString(16).padStart(2, '0')).join('');

function publicItem(r, credits) {
  const idea = JSON.parse(r.idea_json);
  return { id: r.id, author: r.author, createdAt: new Date(r.created_ms).toISOString(), pool: r.pool, side: r.side, thesis: r.thesis, ...idea,
    status: r.status, credits: credits ?? { points: 0, bounties: 0 }, executable: false };
}
async function creditsFor(db, ids) {
  if (!ids.length) return {};
  const q = `SELECT signal_id, SUM(points) AS p, SUM(CASE WHEN kind = 'bounty' THEN 1 ELSE 0 END) AS b FROM signal_credits WHERE signal_id IN (${ids.map((_, i) => `?${i + 1}`).join(',')}) GROUP BY signal_id`;
  const { results } = await db.prepare(q).bind(...ids).all();
  return Object.fromEntries((results ?? []).map((x) => [x.signal_id, { points: Number(x.p ?? 0), bounties: Number(x.b ?? 0) }]));
}

// ---------- operations ----------
export async function readAllowed(cfg, scfg, ipHash, nowMs = Date.now()) {
  return hit(cfg.db, `read:${ipHash}`, minute(nowMs), scfg.readsPerMin);
}

export async function listSignals(cfg, { pool, limit, before } = {}) {
  const lim = Math.min(100, Math.max(1, Number(limit) || 30));
  const args = [cfg.net];
  let q = `SELECT * FROM signals WHERE net = ?1 AND status = 'visible'`;
  if (pool) { if (!/^[A-Z0-9]{1,12}_[A-Z0-9]{1,12}$/.test(pool)) return { ok: false, status: 400, reason: 'bad_pool' }; args.push(pool); q += ` AND pool = ?${args.length}`; }
  if (before) { const b = Date.parse(before); if (!Number.isFinite(b)) return { ok: false, status: 400, reason: 'bad_before' }; args.push(b); q += ` AND created_ms < ?${args.length}`; }
  args.push(lim); q += ` ORDER BY created_ms DESC LIMIT ?${args.length}`;
  const { results } = await cfg.db.prepare(q).bind(...args).all();
  const rows = results ?? [];
  const cr = await creditsFor(cfg.db, rows.map((r) => r.id));
  const items = rows.map((r) => publicItem(r, cr[r.id]));
  return { ok: true, items, next: rows.length === lim ? items.at(-1).createdAt : null, disclaimer: DISCLAIMER };
}

export async function getSignal(cfg, id) {
  if (!/^sig_[0-9a-f]{24}$/.test(id ?? '')) return { ok: false, status: 404, reason: 'not_found' };
  const r = await cfg.db.prepare(`SELECT * FROM signals WHERE id = ?1 AND net = ?2 AND status = 'visible'`).bind(id, cfg.net).first();
  if (!r) return { ok: false, status: 404, reason: 'not_found' };
  return { ok: true, item: publicItem(r, (await creditsFor(cfg.db, [id]))[id]), disclaimer: DISCLAIMER };
}

export async function createSignal(cfg, scfg, { orderId, token, idea, nowMs = Date.now() }) {
  const auth = await paidOrder(cfg, String(orderId ?? ''), token);
  if (!auth.ok) return auth;
  const errs = validateIdea(idea);
  if (errs.length) return { ok: false, status: 400, reason: 'bad_idea', fields: errs };
  const author = await authorOf(cfg, auth.order.id);
  const last = await cfg.db.prepare('SELECT MAX(created_ms) AS t FROM signals WHERE author = ?1').bind(author).first();
  if (last?.t && nowMs - Number(last.t) < scfg.minGapSec * 1000) return { ok: false, status: 429, reason: 'too_soon', retryAfterSec: Math.ceil((scfg.minGapSec * 1000 - (nowMs - Number(last.t))) / 1000) };
  if (!(await hit(cfg.db, `post:${auth.order.id}`, day(nowMs), scfg.postsPerDay))) return { ok: false, status: 429, reason: 'daily_post_limit' };
  const text = [idea.thesis, ...(idea.tags ?? [])].join(' ');
  const mod = moderate(text);
  if (mod.reject) return { ok: false, status: 422, reason: mod.reject };
  const { pool, side, thesis, ...rest } = idea;
  const id = newId();
  const thesisHash = await sha256Hex(thesis.trim().toLowerCase().replace(/\s+/g, ' '));
  try {
    await cfg.db.prepare(`INSERT INTO signals (id, net, order_id, author, created_ms, pool, side, thesis, idea_json, thesis_hash, status, status_reason)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)`)
      .bind(id, cfg.net, auth.order.id, author, nowMs, pool, side, thesis.trim(), JSON.stringify(rest), thesisHash, mod.hold ? 'held' : 'visible', mod.hold ?? null).run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e?.message ?? e))) return { ok: false, status: 409, reason: 'duplicate_idea' };
    throw e;
  }
  return { ok: true, status: 201, id, author, state: mod.hold ? 'held' : 'visible', ...(mod.hold ? { heldFor: mod.hold } : {}) };
}

export async function reportSignal(cfg, scfg, { id, reporter, reason, nowMs = Date.now() }) {
  if (!/^sig_[0-9a-f]{24}$/.test(id ?? '')) return { ok: false, status: 404, reason: 'not_found' };
  if (!(await hit(cfg.db, `report:${reporter}`, day(nowMs), scfg.reportsPerDay))) return { ok: false, status: 429, reason: 'report_limit' };
  const r = await cfg.db.prepare(`SELECT status FROM signals WHERE id = ?1 AND net = ?2`).bind(id, cfg.net).first();
  if (!r || r.status !== 'visible') return { ok: false, status: 404, reason: 'not_found' };
  const ins = await cfg.db.prepare(`INSERT OR IGNORE INTO signal_reports (signal_id, reporter, reason, created_ms) VALUES (?1, ?2, ?3, ?4)`)
    .bind(id, reporter, String(reason ?? '').slice(0, 200), nowMs).run();
  if (Number(ins?.meta?.changes ?? 0) === 1) {
    await cfg.db.prepare(`UPDATE signals SET reports = reports + 1 WHERE id = ?1`).bind(id).run();
    await cfg.db.prepare(`UPDATE signals SET status = 'held', status_reason = 'reports' WHERE id = ?1 AND status = 'visible' AND reports >= ?2`).bind(id, scfg.holdAtReports).run();
  }
  return { ok: true };
}

const ACTIONS = { hide: 'hidden', restore: 'visible', remove: 'removed', hold: 'held' };
export async function moderateSignal(cfg, scfg, { adminKey, id, action, points, note, nowMs = Date.now() }) {
  if (!scfg.adminKey) return { ok: false, status: 503, reason: 'moderation_not_configured' };
  const a = new TextEncoder().encode(String(adminKey ?? '')), b = new TextEncoder().encode(scfg.adminKey);
  let diff = a.length ^ b.length; for (let i = 0; i < Math.min(a.length, b.length); i++) diff |= a[i] ^ b[i];
  if (diff) return { ok: false, status: 401, reason: 'unauthorized' };
  const r = await cfg.db.prepare(`SELECT id FROM signals WHERE id = ?1 AND net = ?2`).bind(String(id ?? ''), cfg.net).first();
  if (!r) return { ok: false, status: 404, reason: 'not_found' };
  if (ACTIONS[action]) {
    await cfg.db.prepare(`UPDATE signals SET status = ?1, status_reason = ?2 WHERE id = ?3`).bind(ACTIONS[action], `mod:${action}`, id).run();
  } else if (action === 'credit' || action === 'bounty') {
    const p = Number(points);
    if (!Number.isInteger(p) || p < 1 || p > 1000) return { ok: false, status: 400, reason: 'bad_points' };
    await cfg.db.prepare(`INSERT INTO signal_credits (signal_id, kind, points, note, created_ms) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(id, action, p, String(note ?? '').slice(0, 200), nowMs).run();
  } else return { ok: false, status: 400, reason: 'bad_action' };
  await cfg.db.prepare(`INSERT INTO signal_mod_log (signal_id, action, note, created_ms) VALUES (?1, ?2, ?3, ?4)`).bind(id, action, String(note ?? '').slice(0, 200), nowMs).run();
  return { ok: true };
}
