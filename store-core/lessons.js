/**
 * Hwi's 14-day practice lessons: DOUBLE opt-in signup, one-click unsubscribe, and the daily sender.
 * Step 1: a ticked box + an email, tied to an order the buyer holds the token for (row 'pending').
 * Step 2: once that order is paid, one confirmation email goes out; the lessons start only after the buyer
 * clicks Confirm (row 'active', confirmed_ms set). Then one lesson a day at 9:00 AM PT, day 1..14, then 'done'.
 * Nothing ever reads orders.email (the receipt address): there are no back-sends to past buyers.
 *
 * ONE production flag: LESSONS_PRODUCTION_SENDING=1.
 *   - off (default): signup is open on testnet (preview) only; the sender mails ONLY addresses listed in
 *     LESSONS_TEST_RECIPIENTS, and only on testnet. On mainnet with the flag off, nothing is sent and
 *     signup is closed.
 *   - on: signup open everywhere; the sender mails every active, paid, opted-in subscription.
 */
import { LESSONS } from './lessons-content.js';
import { sha256Hex } from './core.js';

export const LESSON_DAYS = 14;
export const MIN_GAP_MS = 20 * 3_600_000; // a daily cron with some slack: never two lessons within 20 h
const UNPAID_EXPIRE_MS = 7 * 86_400_000; // opted-in orders never paid, or never confirmed, expire after 7 days
const MAX_CONFIRM_SENDS = 3; // confirmation emails per order, lifetime
export const SEND_HOUR_PT = 9; // lessons go out in the 9 AM hour, America/Los_Angeles (DST handled here, not in the cron)
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
const ORDER_RE = /^SM-[0-9A-HJKMNP-TV-Z]{10}$/;
const TOKEN_RE = /^smt_[A-Za-z0-9_-]{43}$/;
const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? ''));
const b64url = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rnd = (n) => b64url(crypto.getRandomValues(new Uint8Array(n)));
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0;
}

export function lessonsConfig(env = {}) {
  const net = String(env.SUI_NETWORK ?? 'testnet').trim() === 'mainnet' ? 'mainnet' : 'testnet';
  const production = truthy(env.LESSONS_PRODUCTION_SENDING);
  // Test list: while the production flag is OFF, only these addresses can sign up (mainnet: no public signup box) and
  // only they get mail; their test orders need not be paid (mainnet can't mark synthetic orders paid). Ignored once ON.
  const testRecipients = production ? [] : String(env.LESSONS_TEST_RECIPIENTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => EMAIL_RE.test(s));
  return {
    net, production, testRecipients,
    signupOpen: production || net === 'testnet',
    db: env.STORE_DB,
    apiKey: env.RESEND_API_KEY ? String(env.RESEND_API_KEY) : '',
    from: String(env.LESSONS_FROM ?? '"Hwi Noree, The Spice Melange" <hwi@thespicemelange.org>'),
    replyTo: String(env.LESSONS_REPLY_TO ?? 'reserve@thespicemelange.org'),
    // CAN-SPAM sender footer (name · postal address · contact). Set as a Worker secret, not in the public repo.
    footer: String(env.LESSONS_FOOTER ?? '').trim(),
    baseUrl: String(env.LESSONS_BASE_URL ?? 'https://thespicemelange.org').replace(/\/+$/, ''),
    resendUrl: String(env.LESSONS_RESEND_URL ?? 'https://api.resend.com/emails'),
    // Legal gate (Siona O2, Hwi): production lesson runs hold until /privacy/ is live and /terms/ carries the Resend
    // opt-in line. The marker is agreed in portfolio-desk/store/FOR-TLEILAXU-S9-RESEND.md.
    termsMarker: String(env.LESSONS_TERMS_MARKER ?? 'through Resend').toLowerCase(),
  };
}

/** Step 1 of the double opt-in: record the request (pending). Never sends anything itself. */
export async function subscribe(lcfg, { orderId, token, email, source, nowMs = Date.now() }) {
  const e = String(email ?? '').trim().toLowerCase();
  if (!lcfg.signupOpen && !lcfg.testRecipients.includes(e)) return { ok: false, status: 503, reason: 'lessons_not_open' };
  if (!lcfg.db) return { ok: false, status: 503, reason: 'db_not_bound' };
  if (!EMAIL_RE.test(e)) return { ok: false, status: 400, reason: 'bad_email' };
  if (source !== 'checkout' && source !== 'order_page') return { ok: false, status: 400, reason: 'bad_source' };
  if (!ORDER_RE.test(orderId ?? '') || !TOKEN_RE.test(token ?? '')) return { ok: false, status: 401, reason: 'bad_order_or_token' };
  const o = await lcfg.db.prepare('SELECT id, net, token_hash, status FROM orders WHERE id = ?1').bind(orderId).first();
  if (!o || o.net !== lcfg.net || !safeEqual(o.token_hash, await sha256Hex(token))) return { ok: false, status: 401, reason: 'bad_order_or_token' };
  const waitingForPayment = o.status !== 'paid';
  const cur = await lcfg.db.prepare('SELECT id, status, email, next_day, confirm_sends FROM lesson_subs WHERE net = ?1 AND order_id = ?2').bind(lcfg.net, orderId).first();
  if (cur) {
    if (cur.status === 'done') return { ok: true, status: 'done', day: LESSON_DAYS };
    if (cur.status === 'active' && cur.email === e) return { ok: true, status: 'active', nextDay: Number(cur.next_day), waitingForPayment };
    if (Number(cur.confirm_sends) >= MAX_CONFIRM_SENDS) return { ok: false, status: 429, reason: 'too_many_confirmations' };
    // new email, or re-opting in after unsubscribe/expiry: back to pending, a fresh confirm token, confirm again
    await lcfg.db.prepare(`UPDATE lesson_subs SET email = ?1, consent_ms = ?2, consent_source = ?3, status = 'pending', confirmed_ms = NULL,
      confirm_token = ?4, confirm_sent_ms = NULL, unsub_ms = NULL WHERE id = ?5`).bind(e, nowMs, source, 'lc_' + rnd(24), cur.id).run();
    return { ok: true, status: 'pending', confirmEmail: waitingForPayment ? 'after_payment' : 'within_minutes', waitingForPayment };
  }
  await lcfg.db.prepare(`INSERT INTO lesson_subs (id, net, order_id, email, consent_ms, consent_source, status, next_day, confirm_token, unsub_token)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', 1, ?7, ?8)`).bind('ls_' + rnd(12), lcfg.net, orderId, e, nowMs, source, 'lc_' + rnd(24), 'lu_' + rnd(24)).run();
  return { ok: true, status: 'pending', confirmEmail: waitingForPayment ? 'after_payment' : 'within_minutes', waitingForPayment };
}

/** Step 2 of the double opt-in: the buyer pressed Confirm on the page behind the emailed link. Idempotent. */
export async function confirm(db, { subId, token, nowMs = Date.now() }) {
  if (!db || !/^ls_[A-Za-z0-9_-]{16}$/.test(subId ?? '') || !/^lc_[A-Za-z0-9_-]{32}$/.test(token ?? '')) return { ok: false, status: 400, reason: 'bad_link' };
  const r = await db.prepare('SELECT id, confirm_token, status, confirm_sent_ms FROM lesson_subs WHERE id = ?1').bind(subId).first();
  if (!r || !safeEqual(r.confirm_token, token) || r.confirm_sent_ms == null) return { ok: false, status: 400, reason: 'bad_link' };
  if (r.status === 'active' || r.status === 'done') return { ok: true, status: r.status };
  if (r.status !== 'pending') return { ok: false, status: 410, reason: r.status }; // unsubscribed / expired: sign up again
  await db.prepare(`UPDATE lesson_subs SET status = 'active', confirmed_ms = ?1 WHERE id = ?2 AND status = 'pending'`).bind(nowMs, subId).run();
  return { ok: true, status: 'active' };
}

/** One-click unsubscribe. Always allowed, whatever the flags say. Idempotent; never reveals whether an id exists. */
export async function unsubscribe(db, { subId, token, nowMs = Date.now() }) {
  if (!db || !/^ls_[A-Za-z0-9_-]{16}$/.test(subId ?? '') || !/^lu_[A-Za-z0-9_-]{32}$/.test(token ?? '')) return { ok: false, status: 400, reason: 'bad_link' };
  const r = await db.prepare('SELECT id, unsub_token, status FROM lesson_subs WHERE id = ?1').bind(subId).first();
  if (!r || !safeEqual(r.unsub_token, token)) return { ok: false, status: 400, reason: 'bad_link' };
  if (r.status !== 'unsubscribed') await db.prepare(`UPDATE lesson_subs SET status = 'unsubscribed', unsub_ms = ?1 WHERE id = ?2`).bind(nowMs, subId).run();
  return { ok: true, status: 'unsubscribed' };
}

export const unsubUrl = (lcfg, sub) => `${lcfg.baseUrl}/api/lessons/unsubscribe?s=${encodeURIComponent(sub.id)}&t=${encodeURIComponent(sub.unsub_token)}`;
export const confirmUrl = (lcfg, sub) => `${lcfg.baseUrl}/api/lessons/confirm?s=${encodeURIComponent(sub.id)}&t=${encodeURIComponent(sub.confirm_token)}`;
const escHtml = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SHELL_A = '<!doctype html><html><body style="margin:0;background:#f6f1e7">';
const BOX = '<div style="max-width:620px;margin:0 auto;padding:24px 20px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;color:#2b2218;background:#fffdf8">';
const SMALL = 'margin:0 0 8px;font-size:12px;color:#7a6a55;line-height:1.5';
function footerHtml(lcfg, extra = '') {
  return `<hr style="border:0;border-top:1px solid #eadfcb;margin:24px 0 12px">${extra}`
    + (lcfg.footer ? `<p style="${SMALL}">${escHtml(lcfg.footer)}</p>` : '');
}

/** Build the email for one subscription and day. */
export function lessonEmail(lcfg, sub, day) {
  const L = LESSONS[day - 1];
  if (!L) throw new Error(`no lesson for day ${day}`);
  const u = unsubUrl(lcfg, sub);
  const why = "You're getting this because you asked for Hwi's 14-day practice lessons for your Spice Melange order and confirmed by email. One lesson a day for 14 days, then they stop on their own.";
  const html = SHELL_A
    + `<div style="display:none;max-height:0;overflow:hidden">${escHtml(L.preview)}</div>` + BOX
    + `<p style="margin:0 0 18px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#a0742f">Hwi's practice lessons · Day ${day} of ${LESSON_DAYS}</p>`
    + L.html
    + footerHtml(lcfg, `<p style="${SMALL}">${escHtml(why)}</p><p style="${SMALL}"><a href="${escHtml(u)}" style="color:#7a6a55">Unsubscribe in one click</a> · The Spice Melange · thespicemelange.org</p>`)
    + `</div></body></html>`;
  const text = `Hwi's practice lessons · Day ${day} of ${LESSON_DAYS}\n\n${L.text}\n\n--\n${why}\nUnsubscribe in one click: ${u}\nThe Spice Melange · https://thespicemelange.org\n${lcfg.footer ? lcfg.footer + '\n' : ''}`;
  return {
    from: lcfg.from, to: [sub.email], reply_to: lcfg.replyTo, subject: L.subject, html, text,
    headers: {
      'List-Unsubscribe': `<${u}>, <mailto:${lcfg.replyTo}?subject=unsubscribe%20lessons>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    tags: [{ name: 'kind', value: 'hwi_lesson' }, { name: 'day', value: String(day).padStart(2, '0') }],
  };
}

/** The one confirmation email (double opt-in step 2). No lesson content, no List-Unsubscribe (not list mail). */
export function confirmEmail(lcfg, sub) {
  const c = confirmUrl(lcfg, sub);
  const p1 = "Someone (we hope you) asked for Hwi's 14-day practice lessons for a Spice Melange order: one short email a day for the 14 days your bot trains on paper, then they stop on their own.";
  const p2 = "If you didn't ask for this, ignore this email. You won't hear from us about lessons again.";
  const html = SHELL_A + BOX
    + `<h1 style="font-family:Georgia,serif;font-size:22px;color:#5a3a12;margin:0 0 12px">Please confirm your lessons</h1>`
    + `<p style="margin:0 0 14px;line-height:1.55">${escHtml(p1)}</p>`
    + `<p style="margin:0 0 18px"><a href="${escHtml(c)}" style="display:inline-block;background:#a0742f;color:#fffdf8;text-decoration:none;padding:10px 18px;border-radius:8px">Confirm: send me the lessons</a></p>`
    + `<p style="margin:0 0 14px;line-height:1.55">${escHtml(p2)}</p>`
    + `<p style="margin:0 0 14px;font-size:13px;color:#7a6a55">Education only, not financial advice. No returns are promised or implied.</p>`
    + footerHtml(lcfg) + `</div></body></html>`;
  const text = `Please confirm your lessons\n\n${p1}\n\nConfirm: ${c}\n\n${p2}\n\nEducation only, not financial advice. No returns are promised or implied.\n\n--\nThe Spice Melange · https://thespicemelange.org\n${lcfg.footer ? lcfg.footer + '\n' : ''}`;
  return { from: lcfg.from, to: [sub.email], reply_to: lcfg.replyTo, subject: "Please confirm: Hwi's 14-day practice lessons", html, text, tags: [{ name: 'kind', value: 'hwi_lesson_confirm' }] };
}

/** Current hour in America/Los_Angeles (PDT/PST handled by the runtime's time zone data). */
export function ptHour(nowMs) {
  return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', hourCycle: 'h23' }).format(new Date(nowMs)));
}

function gate(lcfg, dryRun) {
  if (!lcfg.db) return 'db_not_bound';
  if (!lcfg.production && lcfg.testRecipients.length === 0) return 'sending_off';
  if (lcfg.production && !lcfg.footer) return 'footer_not_set'; // CAN-SPAM: no production mail without the postal footer
  if (!dryRun && !lcfg.apiKey) return 'resend_key_not_set';
  return null;
}
const allowed = (lcfg, email) => lcfg.production || lcfg.testRecipients.includes(String(email).toLowerCase());
async function resendPost(lcfg, fetchImpl, payload, idemKey) {
  try {
    const res = await fetchImpl(lcfg.resendUrl, { method: 'POST', headers: { authorization: `Bearer ${lcfg.apiKey}`, 'content-type': 'application/json', 'idempotency-key': idemKey }, body: JSON.stringify(payload) });
    const body = await res.json().catch(() => ({}));
    return res.ok && body?.id ? { ok: true, id: String(body.id) } : { ok: false, http: res.status, error: String(body?.message ?? body?.name ?? 'error').slice(0, 200) };
  } catch (e) { return { ok: false, http: 0, error: String(e?.message ?? e).slice(0, 200) }; }
}

/** Legal gate: https://<site>/privacy/ answers 200 AND /terms/ text contains the Resend opt-in marker. Fails closed. */
export async function legalGate(lcfg, fetchImpl = fetch) {
  const get = async (path) => {
    try { const r = await fetchImpl(`${lcfg.baseUrl}${path}`, { headers: { 'cache-control': 'no-cache' }, redirect: 'follow' }); return { status: r.status, text: r.ok ? await r.text() : '' }; }
    catch (e) { return { status: 0, text: '' }; }
  };
  const [p, t] = await Promise.all([get('/privacy/'), get('/terms/')]);
  const terms = t.text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').toLowerCase();
  const privacyLive = p.status === 200, termsLine = t.status === 200 && terms.includes(lcfg.termsMarker);
  return { open: privacyLive && termsLine, privacyStatus: p.status, termsStatus: t.status, termsLine, reason: privacyLive && termsLine ? null : 'held: privacy/terms not live' };
}

/** Double opt-in step 2: send the confirmation email to pending requests whose order is paid (runs every 10 min). */
export async function runConfirmations(env, { nowMs = Date.now(), fetchImpl = fetch, dryRun = false, limit = 100 } = {}) {
  const lcfg = lessonsConfig(env);
  const out = { mode: lcfg.production ? 'production' : 'test', net: lcfg.net, sent: 0, skipped: 0, failed: 0, expired: 0, details: [] };
  const g = gate(lcfg, dryRun); if (g) return { ...out, ok: g === 'sending_off', reason: g };
  // never-confirmed and never-paid requests lapse after 7 days
  const ex = await lcfg.db.prepare(`UPDATE lesson_subs SET status = 'expired' WHERE net = ?1 AND status = 'pending' AND consent_ms < ?2`).bind(lcfg.net, nowMs - UNPAID_EXPIRE_MS).run();
  out.expired = Number(ex?.meta?.changes ?? 0);
  const { results = [] } = await lcfg.db.prepare(`SELECT s.* FROM lesson_subs s JOIN orders o ON o.id = s.order_id
    WHERE s.net = ?1 AND s.status = 'pending' AND s.confirm_sent_ms IS NULL AND s.confirm_sends < ?2 AND (o.status = 'paid' OR ?4 = 1)
    ORDER BY s.consent_ms LIMIT ?3`).bind(lcfg.net, MAX_CONFIRM_SENDS, limit, lcfg.production ? 0 : 1).all();
  for (const sub of results) {
    const tag = { sub: sub.id, kind: 'confirm' };
    if (!allowed(lcfg, sub.email)) { out.skipped++; out.details.push({ ...tag, result: 'skipped_not_test_recipient' }); continue; }
    if (dryRun) { out.details.push({ ...tag, result: 'dry_run' }); continue; }
    // claim first (confirm_sent_ms) so a racing run can't send twice
    const c = await lcfg.db.prepare(`UPDATE lesson_subs SET confirm_sent_ms = ?1, confirm_sends = confirm_sends + 1 WHERE id = ?2 AND confirm_sent_ms IS NULL AND status = 'pending'`).bind(nowMs, sub.id).run();
    if (Number(c?.meta?.changes ?? 0) !== 1) { out.skipped++; continue; }
    const r = await resendPost(lcfg, fetchImpl, confirmEmail(lcfg, sub), `hwi-lesson-confirm/${sub.id}/${sub.confirm_token.slice(3, 15)}`);
    if (r.ok) { out.sent++; out.details.push({ ...tag, result: 'sent', resendId: r.id }); }
    else {
      await lcfg.db.prepare('UPDATE lesson_subs SET confirm_sent_ms = NULL WHERE id = ?1').bind(sub.id).run();
      out.failed++; out.details.push({ ...tag, result: 'failed', http: r.http, error: r.error });
    }
  }
  return { ...out, ok: true };
}

/**
 * The daily lesson sender. ONLY confirmed (double opt-in) subscriptions on paid orders. Each (sub, day) once.
 * opts.force (testnet test mode only) ignores the 20 h gap so a test inbox can receive all 14 in a row.
 */
export async function runLessons(env, { nowMs = Date.now(), fetchImpl = fetch, dryRun = false, force = false, limit = 200 } = {}) {
  const lcfg = lessonsConfig(env);
  const mode = lcfg.production ? 'production' : 'test';
  const out = { mode, net: lcfg.net, sent: 0, skipped: 0, failed: 0, details: [] };
  const g = gate(lcfg, dryRun); if (g) return { ...out, ok: g === 'sending_off', reason: g };
  if (lcfg.production) {
    const lg = await legalGate(lcfg, fetchImpl);
    if (!lg.open) return { ...out, ok: true, held: true, reason: lg.reason, gate: lg };
  }
  const useForce = force && !lcfg.production && lcfg.net === 'testnet';
  const { results = [] } = await lcfg.db.prepare(`SELECT s.* FROM lesson_subs s JOIN orders o ON o.id = s.order_id
    WHERE s.net = ?1 AND s.status = 'active' AND s.confirmed_ms IS NOT NULL AND s.confirm_sent_ms IS NOT NULL AND s.confirmed_ms >= s.consent_ms
      AND (o.status = 'paid' OR ?5 = 1) AND s.next_day <= ?2 AND (s.last_sent_ms IS NULL OR s.last_sent_ms <= ?3)
    ORDER BY s.confirmed_ms LIMIT ?4`).bind(lcfg.net, LESSON_DAYS, useForce ? nowMs : nowMs - MIN_GAP_MS, limit, lcfg.production ? 0 : 1).all();
  for (const sub of results) {
    const day = Number(sub.next_day);
    const tag = { sub: sub.id, day };
    if (!allowed(lcfg, sub.email)) { out.skipped++; out.details.push({ ...tag, result: 'skipped_not_test_recipient' }); continue; }
    if (dryRun) { out.details.push({ ...tag, result: 'dry_run' }); continue; }
    try {
      await lcfg.db.prepare('INSERT INTO lesson_sends (sub_id, day, sent_ms, mode) VALUES (?1, ?2, ?3, ?4)').bind(sub.id, day, nowMs, mode).run();
    } catch (e) {
      if (!/UNIQUE|constraint|PRIMARY KEY/i.test(String(e?.message ?? e))) throw e;
      await advance(lcfg.db, sub.id, day, nowMs);
      out.skipped++; out.details.push({ ...tag, result: 'already_sent' }); continue;
    }
    const r = await resendPost(lcfg, fetchImpl, lessonEmail(lcfg, sub, day), `hwi-lesson/${sub.id}/day-${day}`);
    if (r.ok) {
      await lcfg.db.prepare('UPDATE lesson_sends SET resend_id = ?1 WHERE sub_id = ?2 AND day = ?3').bind(r.id, sub.id, day).run();
      await advance(lcfg.db, sub.id, day, nowMs);
      out.sent++; out.details.push({ ...tag, result: 'sent', resendId: r.id });
    } else {
      await lcfg.db.prepare('DELETE FROM lesson_sends WHERE sub_id = ?1 AND day = ?2 AND resend_id IS NULL').bind(sub.id, day).run();
      await lcfg.db.prepare(`UPDATE lesson_subs SET fail_count = fail_count + 1, status = CASE WHEN fail_count + 1 >= 5 THEN 'expired' ELSE status END WHERE id = ?1`).bind(sub.id).run();
      out.failed++; out.details.push({ ...tag, result: 'failed', http: r.http, error: r.error });
    }
  }
  return { ...out, ok: true };
}
async function advance(db, subId, day, nowMs) {
  await db.prepare(`UPDATE lesson_subs SET next_day = ?1, last_sent_ms = ?2, fail_count = 0, status = CASE WHEN ?1 > ?3 THEN 'done' ELSE status END WHERE id = ?4 AND next_day = ?5`)
    .bind(day + 1, nowMs, LESSON_DAYS, subId, day).run();
}

/** The cron entry point (every 10 min): confirmations always; lessons only in the 9 AM PT hour. */
export async function scheduledRun(env, { nowMs = Date.now(), fetchImpl = fetch } = {}) {
  const confirmations = await runConfirmations(env, { nowMs, fetchImpl });
  const lessons = ptHour(nowMs) === SEND_HOUR_PT ? await runLessons(env, { nowMs, fetchImpl }) : { skipped: 'not_9am_pt' };
  return { confirmations, lessons };
}
