/**
 * Hwi's 14-day practice lessons: opt-in signup, one-click unsubscribe, and the daily sender.
 * Opt-in only (a ticked box + an email, tied to an order the buyer holds the token for). Lessons go out
 * only after that order is paid, one a day, day 1..14, then the subscription is done.
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
const UNPAID_EXPIRE_MS = 7 * 86_400_000; // opted-in orders never paid are expired after 7 days
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i;
const ORDER_RE = /^SM-[0-9A-HJKMNP-TV-Z]{10}$/;
const TOKEN_RE = /^smt_[A-Za-z0-9_-]{43}$/;
// Sender footer (CAN-SPAM postal address). Address confirmed by Sajan 2026-10-10 6:40 AM PT; contact set by Hwi.
export const LESSONS_FOOTER = 'Sajan Melcher · 9017 Village Dr, Yosemite National Park, CA 95389 · reserve@thespicemelange.org';
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
  const testRecipients = net === 'testnet'
    ? String(env.LESSONS_TEST_RECIPIENTS ?? '').split(',').map((s) => s.trim().toLowerCase()).filter((s) => EMAIL_RE.test(s))
    : []; // a test list is ignored on mainnet
  return {
    net, production, testRecipients,
    signupOpen: production || net === 'testnet',
    db: env.STORE_DB,
    apiKey: env.RESEND_API_KEY ? String(env.RESEND_API_KEY) : '',
    from: String(env.LESSONS_FROM ?? 'Hwi Noree <hwi@thespicemelange.org>'),
    replyTo: String(env.LESSONS_REPLY_TO ?? 'reserve@thespicemelange.org'),
    footer: String(env.LESSONS_FOOTER ?? LESSONS_FOOTER),
    baseUrl: String(env.LESSONS_BASE_URL ?? 'https://thespicemelange.org').replace(/\/+$/, ''),
    resendUrl: String(env.LESSONS_RESEND_URL ?? 'https://api.resend.com/emails'),
  };
}

/** Opt in (or update the email / re-opt-in) for an order the caller holds the token for. */
export async function subscribe(lcfg, { orderId, token, email, source, nowMs = Date.now() }) {
  if (!lcfg.signupOpen) return { ok: false, status: 503, reason: 'lessons_not_open' };
  if (!lcfg.db) return { ok: false, status: 503, reason: 'db_not_bound' };
  const e = String(email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return { ok: false, status: 400, reason: 'bad_email' };
  if (source !== 'checkout' && source !== 'order_page') return { ok: false, status: 400, reason: 'bad_source' };
  if (!ORDER_RE.test(orderId ?? '') || !TOKEN_RE.test(token ?? '')) return { ok: false, status: 401, reason: 'bad_order_or_token' };
  const o = await lcfg.db.prepare('SELECT id, net, token_hash, status FROM orders WHERE id = ?1').bind(orderId).first();
  if (!o || o.net !== lcfg.net || !safeEqual(o.token_hash, await sha256Hex(token))) return { ok: false, status: 401, reason: 'bad_order_or_token' };
  const cur = await lcfg.db.prepare('SELECT id, status, next_day FROM lesson_subs WHERE net = ?1 AND order_id = ?2').bind(lcfg.net, orderId).first();
  if (cur) {
    if (cur.status === 'done') return { ok: true, status: 'done', day: LESSON_DAYS };
    await lcfg.db.prepare(`UPDATE lesson_subs SET email = ?1, consent_ms = ?2, consent_source = ?3, status = 'active', unsub_ms = NULL WHERE id = ?4`)
      .bind(e, nowMs, source, cur.id).run();
    return { ok: true, status: 'active', nextDay: Number(cur.next_day), waitingForPayment: o.status !== 'paid' };
  }
  await lcfg.db.prepare(`INSERT INTO lesson_subs (id, net, order_id, email, consent_ms, consent_source, status, next_day, unsub_token)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'active', 1, ?7)`).bind('ls_' + rnd(12), lcfg.net, orderId, e, nowMs, source, 'lu_' + rnd(24)).run();
  return { ok: true, status: 'active', nextDay: 1, waitingForPayment: o.status !== 'paid' };
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

/** Build the email for one subscription and day. */
export function lessonEmail(lcfg, sub, day) {
  const L = LESSONS[day - 1];
  if (!L) throw new Error(`no lesson for day ${day}`);
  const u = unsubUrl(lcfg, sub);
  const why = "You're getting this because you ticked \"Get Hwi's 14-day practice lessons\" for your Spice Melange order. One lesson a day for 14 days, then they stop on their own.";
  const html = `<!doctype html><html><body style="margin:0;background:#f6f1e7">`
    + `<div style="display:none;max-height:0;overflow:hidden">${L.preview.replace(/</g, '&lt;')}</div>`
    + `<div style="max-width:620px;margin:0 auto;padding:24px 20px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:16px;color:#2b2218;background:#fffdf8">`
    + `<p style="margin:0 0 18px;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#a0742f">Hwi's practice lessons · Day ${day} of ${LESSON_DAYS}</p>`
    + L.html
    + `<hr style="border:0;border-top:1px solid #eadfcb;margin:24px 0 12px">`
    + `<p style="margin:0 0 8px;font-size:12px;color:#7a6a55;line-height:1.5">${why}</p>`
    + `<p style="margin:0;font-size:12px;color:#7a6a55"><a href="${u.replace(/&/g, '&amp;')}" style="color:#7a6a55">Unsubscribe in one click</a> · The Spice Melange · thespicemelange.org</p>`
    + `<p style="margin:6px 0 0;font-size:12px;color:#7a6a55">${lcfg.footer.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p>`
    + `</div></body></html>`;
  const text = `Hwi's practice lessons · Day ${day} of ${LESSON_DAYS}\n\n${L.text}\n\n--\n${why}\nUnsubscribe in one click: ${u}\nThe Spice Melange · https://thespicemelange.org\n${lcfg.footer}\n`;
  return {
    from: lcfg.from, to: [sub.email], reply_to: lcfg.replyTo, subject: L.subject, html, text,
    headers: {
      'List-Unsubscribe': `<${u}>, <mailto:${lcfg.replyTo}?subject=unsubscribe%20lessons>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
    tags: [{ name: 'kind', value: 'hwi_lesson' }, { name: 'day', value: String(day).padStart(2, '0') }],
  };
}

/**
 * The daily sender (Cron Trigger). Sends the next lesson to each due subscription, once.
 * opts.force (testnet test mode only) ignores the 20 h gap so a test inbox can receive all 14 in a row.
 */
export async function runLessons(env, { nowMs = Date.now(), fetchImpl = fetch, dryRun = false, force = false, limit = 200 } = {}) {
  const lcfg = lessonsConfig(env);
  const mode = lcfg.production ? 'production' : 'test';
  const out = { mode, net: lcfg.net, sent: 0, skipped: 0, failed: 0, expired: 0, details: [] };
  if (!lcfg.db) return { ...out, ok: false, reason: 'db_not_bound' };
  if (!lcfg.production && lcfg.testRecipients.length === 0) return { ...out, ok: true, reason: 'sending_off' };
  if (!dryRun && !lcfg.apiKey) return { ...out, ok: false, reason: 'resend_key_not_set' };
  const useForce = force && !lcfg.production && lcfg.net === 'testnet';
  // expire opt-ins whose order was never paid
  const ex = await lcfg.db.prepare(`UPDATE lesson_subs SET status = 'expired' WHERE net = ?1 AND status = 'active' AND consent_ms < ?2
    AND order_id IN (SELECT id FROM orders WHERE status != 'paid')`).bind(lcfg.net, nowMs - UNPAID_EXPIRE_MS).run();
  out.expired = Number(ex?.meta?.changes ?? 0);
  const { results = [] } = await lcfg.db.prepare(`SELECT s.* FROM lesson_subs s JOIN orders o ON o.id = s.order_id
    WHERE s.net = ?1 AND s.status = 'active' AND o.status = 'paid' AND s.next_day <= ?2 AND (s.last_sent_ms IS NULL OR s.last_sent_ms <= ?3)
    ORDER BY s.consent_ms LIMIT ?4`).bind(lcfg.net, LESSON_DAYS, useForce ? nowMs : nowMs - MIN_GAP_MS, limit).all();
  for (const sub of results) {
    const day = Number(sub.next_day);
    const tag = { sub: sub.id, day };
    if (!lcfg.production && !lcfg.testRecipients.includes(String(sub.email).toLowerCase())) { out.skipped++; out.details.push({ ...tag, result: 'skipped_not_test_recipient' }); continue; }
    if (dryRun) { out.details.push({ ...tag, result: 'dry_run' }); continue; }
    // claim (sub, day) first: the PRIMARY KEY makes a second run or a racing run a no-op
    try {
      await lcfg.db.prepare('INSERT INTO lesson_sends (sub_id, day, sent_ms, mode) VALUES (?1, ?2, ?3, ?4)').bind(sub.id, day, nowMs, mode).run();
    } catch (e) {
      if (!/UNIQUE|constraint|PRIMARY KEY/i.test(String(e?.message ?? e))) throw e;
      await advance(lcfg.db, sub.id, day, nowMs);
      out.skipped++; out.details.push({ ...tag, result: 'already_sent' }); continue;
    }
    let res, body;
    try {
      res = await fetchImpl(lcfg.resendUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${lcfg.apiKey}`, 'content-type': 'application/json', 'idempotency-key': `hwi-lesson/${sub.id}/day-${day}` },
        body: JSON.stringify(lessonEmail(lcfg, sub, day)),
      });
      body = await res.json().catch(() => ({}));
    } catch (e) { res = { ok: false, status: 0 }; body = { message: String(e?.message ?? e) }; }
    if (res.ok && body?.id) {
      await lcfg.db.prepare('UPDATE lesson_sends SET resend_id = ?1 WHERE sub_id = ?2 AND day = ?3').bind(String(body.id), sub.id, day).run();
      await advance(lcfg.db, sub.id, day, nowMs);
      out.sent++; out.details.push({ ...tag, result: 'sent', resendId: String(body.id) });
    } else {
      // release the claim so the next run retries; give up (expire) after 5 failures
      await lcfg.db.prepare('DELETE FROM lesson_sends WHERE sub_id = ?1 AND day = ?2 AND resend_id IS NULL').bind(sub.id, day).run();
      await lcfg.db.prepare(`UPDATE lesson_subs SET fail_count = fail_count + 1, status = CASE WHEN fail_count + 1 >= 5 THEN 'expired' ELSE status END WHERE id = ?1`).bind(sub.id).run();
      out.failed++; out.details.push({ ...tag, result: 'failed', http: res.status, error: String(body?.message ?? body?.name ?? 'error').slice(0, 200) });
    }
  }
  return { ...out, ok: true };
}
async function advance(db, subId, day, nowMs) {
  await db.prepare(`UPDATE lesson_subs SET next_day = ?1, last_sent_ms = ?2, fail_count = 0, status = CASE WHEN ?1 > ?3 THEN 'done' ELSE status END WHERE id = ?4 AND next_day = ?5`)
    .bind(day + 1, nowMs, LESSON_DAYS, subId, day).run();
}
