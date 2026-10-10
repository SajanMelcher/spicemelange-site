/**
 * The Golden Path free course (Ixians R2, R6-R9). DOUBLE opt-in, its own production flag (COURSE_PRODUCTION_SENDING, OFF),
 * the same footer / reply-to / sender / legal gate as the 14-day lessons. Lessons are assembled from blocks by tags.
 * Sends: 9 AM PT hour only; brief/standard every other day, weekly = two lessons per email once a week.
 * Stop rules: unsubscribe ends everything; confirming the 14-day lessons hands off (no more course mail).
 */
import { sha256Hex } from './core.js';
import { lessonsConfig, legalGate, resendPost, escHtml, ptHour, SEND_HOUR_PT } from './lessons.js';
import { suppress, unsuppress, suppressedSince } from './suppress.js';
import { COURSE, RISK, REPLY, TRACKS, GOALS, TIMES, DEFAULTS, schedule, GAP_DAYS } from './course-content.js';

const DAY = 86_400_000;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
const TAG_RE = /^[a-z0-9._-]{1,32}$/;
const SRC_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'ref'];
const MAX_CONFIRM_SENDS = 3, PENDING_EXPIRE_MS = 7 * DAY, HOURLY_PER_IP = 5, HOURLY_TOTAL = 200;
const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? ''));
const b64url = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rnd = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0;
}

export function courseConfig(env = {}) {
  const l = lessonsConfig({ ...env, LESSONS_PRODUCTION_SENDING: env.COURSE_PRODUCTION_SENDING, LESSONS_TEST_RECIPIENTS: env.COURSE_TEST_RECIPIENTS ?? env.LESSONS_TEST_RECIPIENTS });
  // GL7: preview (testnet) signups only from the test allowlist (COURSE_TEST_RECIPIENTS); GL4: Resend contact sync stays OFF.
  return { ...l, signupOpen: l.production, contacts: truthy(env.COURSE_RESEND_CONTACTS), contactsUrl: String(env.COURSE_RESEND_CONTACTS_URL ?? 'https://api.resend.com/contacts') };
}

/** Validate quiz answers. Unknown keys are ignored; skipped answers take the safe defaults; junk is rejected. */
export function cleanQuiz(b = {}) {
  const pick = (k, allowed) => {
    const v = b[k];
    if (v === undefined || v === null || v === '') return { ok: true, v: DEFAULTS[k] };
    return allowed.includes(v) ? { ok: true, v } : { ok: false };
  };
  const out = {};
  for (const [k, allowed] of [['track', TRACKS], ['goal', GOALS], ['time', TIMES], ['agent', ['yes', 'no']]]) {
    const r = pick(k, allowed); if (!r.ok) return { ok: false, reason: `bad_${k}` }; out[k] = r.v;
  }
  let src = null;
  if (b.src && typeof b.src === 'object') {
    const s = {}; for (const k of SRC_KEYS) { const v = String(b.src[k] ?? '').toLowerCase(); if (v && TAG_RE.test(v)) s[k] = v; }
    if (Object.keys(s).length) src = JSON.stringify(s);
  }
  return { ok: true, ...out, src };
}

/** Rate limit (same shape as the store: salted IP hash per hour + a site-wide cap), in status_hits. */
async function hit(db, key, limit, nowMs) {
  const r = await db.prepare(`INSERT INTO status_hits (order_id, bucket, n) VALUES (?1, ?2, 1)
    ON CONFLICT (order_id, bucket) DO UPDATE SET n = n + 1 WHERE status_hits.n < ?3`).bind(key, `cs:${Math.floor(nowMs / 3_600_000)}`, limit).run();
  return Number(r?.meta?.changes ?? 0) === 1;
}

/** Step 1: the /learn/ quiz. Needs the unticked consent box ticked. Never sends anything itself. */
export async function courseSubscribe(ccfg, { body, ipKey = 'unknown', nowMs = Date.now() }) {
  const b = body ?? {};
  const e = String(b.email ?? '').trim().toLowerCase();
  if (!ccfg.db) return { ok: false, status: 503, reason: 'db_not_bound' };
  if (b.consent !== true) return { ok: false, status: 400, reason: 'consent_required' };
  if (!EMAIL_RE.test(e)) return { ok: false, status: 400, reason: 'bad_email' };
  if (!ccfg.signupOpen && !ccfg.testRecipients.includes(e)) return { ok: false, status: 503, reason: 'course_not_open' };
  const q = cleanQuiz(b); if (!q.ok) return { ok: false, status: 400, reason: q.reason };
  if (!(await hit(ccfg.db, `course:ip:${ipKey}`, HOURLY_PER_IP, nowMs)) || !(await hit(ccfg.db, 'course:all', HOURLY_TOTAL, nowMs))) return { ok: false, status: 429, reason: 'rate_limited' };
  // Same answer whatever the state, so the endpoint never reveals whether an address is subscribed.
  const same = { ok: true, status: 'check_your_inbox' };
  const cur = await ccfg.db.prepare('SELECT * FROM course_subs WHERE net = ?1 AND email = ?2').bind(ccfg.net, e).first();
  if (cur) {
    if (['active', 'done', 'handed_off', 'suppressed'].includes(cur.status)) return same;
    if (Number(cur.confirm_sends) >= MAX_CONFIRM_SENDS) return same;
    await ccfg.db.prepare(`UPDATE course_subs SET track = ?1, goal = ?2, time = ?3, agent = ?4, consent_ms = ?5, src = COALESCE(src, ?6), status = 'pending',
      confirmed_ms = NULL, confirm_token = ?7, confirm_sent_ms = NULL, unsub_ms = NULL WHERE id = ?8`).bind(q.track, q.goal, q.time, q.agent, nowMs, q.src, 'cc_' + rnd(24), cur.id).run();
    return same;
  }
  await ccfg.db.prepare(`INSERT INTO course_subs (id, net, email, track, goal, time, agent, consent_ms, consent_source, src, status, confirm_token, unsub_token)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'learn_quiz', ?9, 'pending', ?10, ?11)`)
    .bind('cs_' + rnd(12), ccfg.net, e, q.track, q.goal, q.time, q.agent, nowMs, q.src, 'cc_' + rnd(24), 'cu_' + rnd(24)).run();
  return same;
}

const SUB_RE = /^cs_[A-Za-z0-9_-]{16}$/;
export async function courseConfirm(env, { subId, token, nowMs = Date.now(), fetchImpl = fetch }) {
  const ccfg = courseConfig(env), db = ccfg.db;
  if (!db || !SUB_RE.test(subId ?? '') || !/^cc_[A-Za-z0-9_-]{32}$/.test(token ?? '')) return { ok: false, status: 400, reason: 'bad_link' };
  const r = await db.prepare('SELECT * FROM course_subs WHERE id = ?1').bind(subId).first();
  if (!r || !safeEqual(r.confirm_token, token) || r.confirm_sent_ms == null) return { ok: false, status: 400, reason: 'bad_link' };
  if (r.status === 'active' || r.status === 'done') return { ok: true, status: r.status };
  if (r.status !== 'pending') return { ok: false, status: 410, reason: r.status };
  await db.prepare(`UPDATE course_subs SET status = 'active', confirmed_ms = ?1 WHERE id = ?2 AND status = 'pending'`).bind(nowMs, subId).run();
  await unsuppress(db, ccfg.suppressSalt, 'course', r.email).catch(() => null); // fresh double opt-in confirmed: lift the old block
  await syncContact(ccfg, { ...r, status: 'active' }, fetchImpl).catch(() => {});
  return { ok: true, status: 'active' };
}
export async function courseUnsubscribe(env, { subId, token, nowMs = Date.now(), fetchImpl = fetch }) {
  const ccfg = courseConfig(env), db = ccfg.db;
  if (!db || !SUB_RE.test(subId ?? '') || !/^cu_[A-Za-z0-9_-]{32}$/.test(token ?? '')) return { ok: false, status: 400, reason: 'bad_link' };
  const r = await db.prepare('SELECT * FROM course_subs WHERE id = ?1').bind(subId).first();
  if (!r) return { ok: true, status: 'unsubscribed' }; // already removed: a second click is a quiet no-op
  if (!safeEqual(r.unsub_token, token)) return { ok: false, status: 400, reason: 'bad_link' };
  return safeMinimize(ccfg, r, nowMs, fetchImpl);
}
/** GL15: never fail an unsubscribe. If minimizing fails, still stop all mail at once. */
async function safeMinimize(ccfg, r, nowMs, fetchImpl) {
  try { await minimizeCourseSub(ccfg, r, nowMs, fetchImpl); return { ok: true, status: 'unsubscribed' }; }
  catch (e) {
    console.log('course unsubscribe minimize failed; marking unsubscribed', String(e?.message ?? e));
    try { await ccfg.db.prepare(`UPDATE course_subs SET status = 'unsubscribed', unsub_ms = ?1 WHERE id = ?2`).bind(nowMs, r.id).run(); return { ok: true, status: 'unsubscribed', minimized: false }; }
    catch (e2) { return { ok: false, status: 503, reason: 'try_again' }; }
  }
}
/**
 * GL2 data minimization on unsubscribe (link, RFC 8058 POST, or a "stop" reply): keep ONLY a hashed-email suppression
 * record + the date. Deletes the row (address, quiz answers, utm/ref, consent, tokens), its send history and reply
 * suggestions, and the Resend contact if contact sync was ever on for it (sync is OFF: our key is send-only).
 */
export async function minimizeCourseSub(ccfg, r, nowMs, fetchImpl = fetch) {
  const db = ccfg.db;
  await suppress(db, ccfg.suppressSalt, 'course', r.email, nowMs);
  let contactDelete = null;
  if (r.resend_contact_id && ccfg.apiKey) {
    contactDelete = await fetchImpl(`${ccfg.contactsUrl}/${encodeURIComponent(r.resend_contact_id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${ccfg.apiKey}` } }).then((x) => x.status).catch(() => 0);
  }
  await db.prepare('DELETE FROM course_suggestions WHERE sub_id = ?1').bind(r.id).run();
  await db.prepare('DELETE FROM course_sends WHERE sub_id = ?1').bind(r.id).run();
  await db.prepare('DELETE FROM course_subs WHERE id = ?1').bind(r.id).run();
  return { contactDelete };
}
/** GL2: unconfirmed (pending) and failed (expired) course signups are deleted 7 days after the request. */
export async function deleteStaleCourse(db, nowMs, net = null) {
  const w = `status IN ('pending','expired') AND consent_ms < ?1 AND (?2 IS NULL OR net = ?2)`, cut = nowMs - PENDING_EXPIRE_MS;
  await db.prepare(`DELETE FROM course_suggestions WHERE sub_id IN (SELECT id FROM course_subs WHERE ${w})`).bind(cut, net).run();
  await db.prepare(`DELETE FROM course_sends WHERE sub_id IN (SELECT id FROM course_subs WHERE ${w})`).bind(cut, net).run();
  const d = await db.prepare(`DELETE FROM course_subs WHERE ${w}`).bind(cut, net).run();
  return Number(d?.meta?.changes ?? 0);
}

/** R7 (T4: address + unsubscribed flag only, no quiz properties). Worker-only (API key never in the repo). Off unless COURSE_RESEND_CONTACTS=1. */
export async function syncContact(ccfg, sub, fetchImpl = fetch) {
  if (!ccfg.contacts || !ccfg.apiKey) return { ok: false, reason: 'contacts_off' };
  if (!ccfg.production && !ccfg.testRecipients.includes(sub.email)) return { ok: false, reason: 'not_test_recipient' };
  // T4: address + unsubscribed flag only. No quiz answers (track/goal/time/agent) or status as contact properties.
  const body = { email: sub.email, unsubscribed: sub.status === 'unsubscribed' };
  const url = sub.resend_contact_id ? `${ccfg.contactsUrl}/${encodeURIComponent(sub.resend_contact_id)}` : ccfg.contactsUrl;
  const res = await fetchImpl(url, { method: sub.resend_contact_id ? 'PATCH' : 'POST', headers: { authorization: `Bearer ${ccfg.apiKey}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json().catch(() => ({}));
  if (res.ok && j?.id && !sub.resend_contact_id) await ccfg.db.prepare('UPDATE course_subs SET resend_contact_id = ?1 WHERE id = ?2').bind(String(j.id), sub.id).run();
  return { ok: res.ok, http: res.status, id: j?.id ?? sub.resend_contact_id ?? null, error: res.ok ? undefined : String(j?.message ?? j?.name ?? '') };
}
/** Deletion request: removes the row (and its quiz answers) and the Resend contact. Admin-only (Worker). */
export async function courseDelete(env, { email, fetchImpl = fetch }) {
  const ccfg = courseConfig(env); const e = String(email ?? '').trim().toLowerCase();
  const r = await ccfg.db.prepare('SELECT * FROM course_subs WHERE net = ?1 AND email = ?2').bind(ccfg.net, e).first();
  if (!r) return { ok: true, deleted: 0 };
  let contact = null;
  if (r.resend_contact_id && ccfg.apiKey) {
    const res = await fetchImpl(`${ccfg.contactsUrl}/${encodeURIComponent(r.resend_contact_id)}`, { method: 'DELETE', headers: { authorization: `Bearer ${ccfg.apiKey}` } });
    contact = res.status;
  }
  await ccfg.db.prepare('DELETE FROM course_suggestions WHERE sub_id = ?1').bind(r.id).run();
  await ccfg.db.prepare('DELETE FROM course_sends WHERE sub_id = ?1').bind(r.id).run();
  await ccfg.db.prepare('DELETE FROM course_subs WHERE id = ?1').bind(r.id).run();
  return { ok: true, deleted: 1, contactDelete: contact };
}

export { courseHandoff, HANDOFF_LINE } from './course-handoff.js';

// ---------- assembly ----------
const md = (t) => escHtml(t).replace(/`([^`]+)`/g, '<code style="background:#f3ece0;padding:1px 4px;border-radius:3px;font-size:90%">$1</code>');
const P = 'margin:0 0 14px;line-height:1.55';
/** Build the blocks for one email (one lesson, or two for weekly), by the subscriber's tags. At most one invitation. */
export function courseBlocks(sub, emailNo) {
  const lessons = schedule(sub.time)[emailNo - 1];
  if (!lessons) throw new Error(`no email ${emailNo} for time=${sub.time}`);
  const parts = [];
  let invite = null;
  for (const n of lessons) {
    const L = COURSE[n - 1];
    const sec = [];
    if (L.intro) sec.push(L.intro);
    sec.push(L.core, L.track[sub.track]);
    if (sub.goal) sec.push(L.goal[sub.goal]);
    if (sub.time === 'standard' || (sub.time === 'weekly' && L.deeper)) sec.push(L.deeper);
    parts.push({ n, title: L.title, paras: sec }); // no setup task: the free course is information only (Sajan 9:36 AM PT)
    if (L.invite && L.invite.when(sub)) invite = { n, door: L.invite.door, text: L.invite.text }; // later lesson wins: one per email
  }
  const subject = lessons.length === 1 ? COURSE[lessons[0] - 1].subject : `Lessons ${lessons.join(' and ')} of 7: ${lessons.map((n) => COURSE[n - 1].title).join(' / ')}`;
  return { lessons, subject, parts, invite };
}
export const courseUnsubUrl = (c, sub) => `${c.baseUrl}/api/course/unsubscribe?s=${encodeURIComponent(sub.id)}&t=${encodeURIComponent(sub.unsub_token)}`;
export const courseConfirmUrl = (c, sub) => `${c.baseUrl}/api/course/confirm?s=${encodeURIComponent(sub.id)}&t=${encodeURIComponent(sub.confirm_token)}`;
export function courseEmail(ccfg, sub, emailNo) {
  const b = courseBlocks(sub, emailNo);
  const u = courseUnsubUrl(ccfg, sub);
  const html = ['<!doctype html><html><body style="margin:0;background:#f6f1e7"><div style="max-width:620px;margin:0 auto;padding:24px 20px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;color:#2b2218;background:#fffdf8">',
    `<p style="margin:0 0 18px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#a0742f">Hwi's Golden Path course · ${escHtml(b.lessons.length === 1 ? `Lesson ${b.lessons[0]} of 7` : `Lessons ${b.lessons.join(' and ')} of 7`)}</p>`];
  const text = [];
  for (const p of b.parts) {
    html.push(`<h1 style="font-family:Georgia,serif;font-size:22px;color:#5a3a12;margin:0 0 10px">Lesson ${p.n} · ${escHtml(p.title)}</h1>`, ...p.paras.map((x) => `<p style="${P}">${md(x)}</p>`));
    text.push(`LESSON ${p.n} · ${p.title.toUpperCase()}`, '', ...p.paras.flatMap((x) => [x, '']));
  }
  if (b.invite) { html.push(`<p style="${P};background:#fbf6ee;padding:10px 14px;border-left:4px solid #c8862a">${md(b.invite.text)}</p>`); text.push(b.invite.text, ''); }
  html.push(`<p style="${P}">${escHtml(REPLY)}</p><p style="${P};font-size:13px;color:#7a6a55"><em>${escHtml(RISK)}</em></p>`);
  text.push(REPLY, '', RISK);
  const why = "You're getting this because you signed up for Hwi's free Golden Path course on thespicemelange.org and confirmed by email. Seven lessons, then it stops on its own.";
  html.push(`<hr style="border:0;border-top:1px solid #eadfcb;margin:24px 0 12px"><p style="margin:0 0 8px;font-size:12px;color:#7a6a55">${escHtml(why)}</p>`,
    `<p style="margin:0 0 8px;font-size:12px;color:#7a6a55"><a href="${escHtml(u)}" style="color:#7a6a55">Unsubscribe in one click</a> · <a href="${escHtml(ccfg.baseUrl)}/privacy/" style="color:#7a6a55">Privacy</a></p>`,
    ccfg.footer ? `<p style="margin:0 0 8px;font-size:12px;color:#7a6a55">${escHtml(ccfg.footer)}</p>` : '', '</div></body></html>');
  text.push('', '--', why, `Unsubscribe in one click: ${u}`, `Privacy: ${ccfg.baseUrl}/privacy/`, ccfg.footer);
  return {
    from: ccfg.from, to: [sub.email], reply_to: ccfg.replyTo, subject: b.subject, html: html.join(''), text: text.filter((x) => x !== undefined).join('\n'),
    headers: { 'List-Unsubscribe': `<${u}>, <mailto:${ccfg.replyTo}?subject=unsubscribe%20course>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    // T4: no quiz-derived tag (track/goal/time/agent) ever goes to Resend; /privacy/ says quiz answers stay in our D1.
    tags: [{ name: 'kind', value: 'golden_path_course' }, { name: 'email', value: String(emailNo) }],
    _meta: { lessons: b.lessons, invite: b.invite?.door ?? null },
  };
}
export function courseConfirmEmail(ccfg, sub) {
  const c = courseConfirmUrl(ccfg, sub);
  const p1 = "Someone (we hope you) asked for Hwi's free 7-lesson Golden Path course on thespicemelange.org. Press the button to confirm. If you didn't ask for this, ignore this email and you won't hear from us.";
  return {
    from: ccfg.from, to: [sub.email], reply_to: ccfg.replyTo, subject: "Please confirm: Hwi's free Golden Path course",
    html: `<!doctype html><html><body style="margin:0;background:#f6f1e7"><div style="max-width:620px;margin:0 auto;padding:24px 20px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;color:#2b2218;background:#fffdf8"><h1 style="font-family:Georgia,serif;font-size:22px;color:#5a3a12">Please confirm your free course</h1><p style="${P}">${escHtml(p1)}</p><p><a href="${escHtml(c)}" style="display:inline-block;background:#a0742f;color:#fffdf8;text-decoration:none;padding:10px 18px;border-radius:8px">Confirm: send me the course</a></p><p style="${P};font-size:13px;color:#7a6a55">${escHtml(RISK)}</p>${ccfg.footer ? `<hr style="border:0;border-top:1px solid #eadfcb;margin:24px 0 12px"><p style="font-size:12px;color:#7a6a55">${escHtml(ccfg.footer)}</p>` : ''}</div></body></html>`,
    text: `Please confirm your free course\n\n${p1}\n\nConfirm: ${c}\n\n${RISK}\n\n--\n${ccfg.footer}`,
    tags: [{ name: 'kind', value: 'golden_path_course_confirm' }],
  };
}

// ---------- senders ----------
function gate(c, dryRun) {
  if (!c.db) return 'db_not_bound';
  if (!c.production && c.testRecipients.length === 0) return 'sending_off';
  if (!c.suppressSalt) return 'suppression_salt_not_set';
  if (c.production && !c.footer) return 'footer_not_set';
  if (!dryRun && !c.apiKey) return 'resend_key_not_set';
  return null;
}
const allowed = (c, email) => c.production || c.testRecipients.includes(String(email).toLowerCase());
export async function runCourseConfirmations(env, { nowMs = Date.now(), fetchImpl = fetch, dryRun = false } = {}) {
  const c = courseConfig(env);
  const out = { kind: 'course_confirm', mode: c.production ? 'production' : 'test', sent: 0, skipped: 0, failed: 0, expired: 0, details: [] };
  const g = gate(c, dryRun); if (g) return { ...out, ok: g === 'sending_off', reason: g };
  out.expired = await deleteStaleCourse(c.db, nowMs, c.net); // GL2: deleted, not just marked
  const { results = [] } = await c.db.prepare(`SELECT * FROM course_subs WHERE net = ?1 AND status = 'pending' AND confirm_sent_ms IS NULL AND confirm_sends < ?2 ORDER BY consent_ms LIMIT 100`).bind(c.net, MAX_CONFIRM_SENDS).all();
  for (const s of results) {
    if (!allowed(c, s.email)) { out.skipped++; out.details.push({ sub: s.id, result: 'skipped_not_test_recipient' }); continue; }
    if (await suppressedSince(c.db, c.suppressSalt, 'course', s.email, s.consent_ms)) { out.skipped++; out.details.push({ sub: s.id, result: 'skipped_suppressed' }); continue; }
    if (dryRun) { out.details.push({ sub: s.id, result: 'dry_run' }); continue; }
    const cl = await c.db.prepare(`UPDATE course_subs SET confirm_sent_ms = ?1, confirm_sends = confirm_sends + 1 WHERE id = ?2 AND confirm_sent_ms IS NULL AND status = 'pending'`).bind(nowMs, s.id).run();
    if (Number(cl?.meta?.changes ?? 0) !== 1) continue;
    const r = await resendPost(c, fetchImpl, courseConfirmEmail(c, s), `course-confirm/${s.id}/${s.confirm_token.slice(3, 15)}`);
    if (r.ok) { out.sent++; out.details.push({ sub: s.id, result: 'sent', resendId: r.id }); }
    else { await c.db.prepare('UPDATE course_subs SET confirm_sent_ms = NULL WHERE id = ?1').bind(s.id).run(); out.failed++; out.details.push({ sub: s.id, result: 'failed', http: r.http }); }
  }
  return { ...out, ok: true };
}
export async function runCourse(env, { nowMs = Date.now(), fetchImpl = fetch, dryRun = false, force = false } = {}) {
  const c = courseConfig(env);
  const out = { kind: 'course', mode: c.production ? 'production' : 'test', sent: 0, skipped: 0, failed: 0, details: [] };
  const g = gate(c, dryRun); if (g) return { ...out, ok: g === 'sending_off', reason: g };
  if (c.production) { const lg = await legalGate(c, fetchImpl); if (!lg.open) return { ...out, ok: true, held: true, reason: lg.reason }; }
  const useForce = force && !c.production && c.net === 'testnet';
  const { results = [] } = await c.db.prepare(`SELECT * FROM course_subs WHERE net = ?1 AND status = 'active' AND confirmed_ms IS NOT NULL ORDER BY confirmed_ms LIMIT 200`).bind(c.net).all();
  for (const s of results) {
    const plan = schedule(s.time), no = Number(s.next_email);
    if (no > plan.length) continue;
    const gapMs = (GAP_DAYS[s.time] ?? 2) * DAY - 4 * 3_600_000; // e.g. "every other day" with a few hours of slack
    if (!useForce && s.last_sent_ms != null && nowMs - s.last_sent_ms < gapMs) continue;
    if (!allowed(c, s.email)) { out.skipped++; out.details.push({ sub: s.id, email: no, result: 'skipped_not_test_recipient' }); continue; }
    if (dryRun) { out.details.push({ sub: s.id, email: no, result: 'dry_run' }); continue; }
    try { await c.db.prepare('INSERT INTO course_sends (sub_id, email_no, sent_ms, mode) VALUES (?1, ?2, ?3, ?4)').bind(s.id, no, nowMs, out.mode).run(); }
    catch (e) { if (!/UNIQUE|constraint|PRIMARY KEY/i.test(String(e?.message ?? e))) throw e; await advance(c.db, s, no, plan.length, nowMs); continue; }
    const msg = courseEmail(c, s, no); const meta = msg._meta; delete msg._meta;
    const r = await resendPost(c, fetchImpl, msg, `course/${s.id}/email-${no}`);
    if (r.ok) {
      await c.db.prepare('UPDATE course_sends SET resend_id = ?1 WHERE sub_id = ?2 AND email_no = ?3').bind(r.id, s.id, no).run();
      await advance(c.db, s, no, plan.length, nowMs);
      out.sent++; out.details.push({ sub: s.id, email: no, lessons: meta.lessons, invite: meta.invite, result: 'sent', resendId: r.id });
    } else {
      await c.db.prepare('DELETE FROM course_sends WHERE sub_id = ?1 AND email_no = ?2 AND resend_id IS NULL').bind(s.id, no).run();
      await c.db.prepare(`UPDATE course_subs SET fail_count = fail_count + 1, status = CASE WHEN fail_count + 1 >= 5 THEN 'expired' ELSE status END WHERE id = ?1`).bind(s.id).run();
      out.failed++; out.details.push({ sub: s.id, email: no, result: 'failed', http: r.http });
    }
  }
  return { ...out, ok: true };
}
async function advance(db, s, no, total, nowMs) {
  await db.prepare(`UPDATE course_subs SET next_email = ?1, last_sent_ms = ?2, fail_count = 0, status = CASE WHEN ?1 > ?3 THEN 'done' ELSE status END WHERE id = ?4 AND next_email = ?5`)
    .bind(no + 1, nowMs, total, s.id, no).run();
}
export async function courseScheduled(env, { nowMs = Date.now(), fetchImpl = fetch } = {}) {
  const confirmations = await runCourseConfirmations(env, { nowMs, fetchImpl });
  const lessons = ptHour(nowMs) === SEND_HOUR_PT ? await runCourse(env, { nowMs, fetchImpl }) : { skipped: 'not_9am_pt' };
  return { confirmations, lessons };
}

// ---------- R8: replies -> suggestions ----------
const KEYWORDS = ['stop', 'simpler', 'deeper', 'slower', 'faster'];
const ORDER = { track: TRACKS, time: ['brief', 'standard', 'weekly'] };
function propose(sub, kw) {
  const step = (k, d) => { const a = ORDER[k], i = a.indexOf(sub[k]), j = Math.max(0, Math.min(a.length - 1, i + d)); return i === j ? null : `${k}: ${sub[k]} -> ${a[j]}`; };
  if (kw === 'simpler') return step('track', -1) ?? 'no change (already simplest)';
  if (kw === 'deeper') return step('track', +1) ?? 'no change (already deepest)';
  if (kw === 'slower') return sub.time === 'weekly' ? 'no change (already weekly)' : 'time: ' + sub.time + ' -> weekly';
  if (kw === 'faster') return sub.time === 'weekly' ? 'time: weekly -> standard' : 'no change (already every other day)';
  return 'unsubscribe (applied at once)';
}
/**
 * One inbound reply (already verified as coming from Resend). Untrusted: only the sender address and a keyword are
 * used; the text is never stored or acted on beyond this. 'stop' unsubscribes at once; others become pending suggestions.
 */
export async function courseInbound(env, { from, text, nowMs = Date.now() }) {
  const c = courseConfig(env);
  const m = /<([^>]+)>/.exec(String(from ?? '')); const e = String(m ? m[1] : from ?? '').trim().toLowerCase();
  const s = await c.db.prepare('SELECT * FROM course_subs WHERE net = ?1 AND email = ?2').bind(c.net, e).first();
  if (!s) return { ok: true, matched: false };
  const first = String(text ?? '').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('>')).slice(0, 3).join(' ').toLowerCase();
  const kw = KEYWORDS.find((k) => new RegExp(`\\b${k}\\b`).test(first));
  if (!kw) return { ok: true, matched: true, keyword: null };
  if (kw === 'stop') {
    await safeMinimize(c, s, nowMs, fetch); // GL2: same minimization as the link; nothing about the reply is kept
    return { ok: true, matched: true, keyword: 'stop', applied: true };
  }
  await c.db.prepare(`INSERT INTO course_suggestions (id, sub_id, received_ms, keyword, proposal) VALUES (?1, ?2, ?3, ?4, ?5)`).bind('sg_' + rnd(9), s.id, nowMs, kw, propose(s, kw)).run();
  return { ok: true, matched: true, keyword: kw, applied: false, proposal: propose(s, kw) };
}
/** Svix-style signature check for Resend webhooks (svix-id, svix-timestamp, svix-signature; secret "whsec_<base64>"). */
export async function verifyWebhook(secret, headers, raw, nowMs = Date.now()) {
  if (!/^whsec_/.test(secret ?? '')) return false;
  const id = headers.get('svix-id'), ts = headers.get('svix-timestamp'), sig = headers.get('svix-signature');
  if (!id || !ts || !sig || Math.abs(nowMs / 1000 - Number(ts)) > 300) return false;
  const key = Uint8Array.from(atob(secret.slice(6)), (ch) => ch.charCodeAt(0));
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(`${id}.${ts}.${raw}`)));
  const want = btoa(String.fromCharCode(...mac));
  return sig.split(' ').some((p) => safeEqual(p.split(',')[1] ?? '', want));
}
export { sha256Hex };
