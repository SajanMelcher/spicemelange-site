// Hwi's practice lessons: sender Worker (Cloudflare Cron Trigger, every 10 min). Pages Functions can't run crons.
//   scheduled           -> scheduledRun: confirmation emails (double opt-in) every run; lessons only in the 9 AM PT hour
//                          (America/Los_Angeles in code, so PDT/PST switches need no cron change)
//   POST /run           -> lessons now (admin). ?dry=1 lists who is due; ?force=1 (testnet test mode only) ignores the 20 h gap
//   POST /run-confirmations -> confirmations now (admin). ?dry=1
//   POST /test-send?sub=<id>&day=N -> testnet only: send ONE lesson to that subscription if its address is on
//                          LESSONS_TEST_RECIPIENTS; no D1 change, never counts as a real send
// Production sending is OFF unless LESSONS_PRODUCTION_SENDING=1, and refuses without the LESSONS_FOOTER secret.
import { runLessons, runConfirmations, scheduledRun, lessonsConfig, lessonEmail, legalGate } from '../../store-core/lessons.js';
import { courseScheduled, runCourse, runCourseConfirmations, courseConfig, courseDelete, syncContact } from '../../store-core/course.js';

const j = (s, b) => new Response(JSON.stringify(b, null, 1), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0;
}
const summary = (r) => ({ ...r, details: (r.details ?? []).map(({ sub, day, kind, result, http }) => ({ sub, day, kind, result, http })) });
export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scheduledRun(env, { nowMs: event.scheduledTime }).then((r) => console.log(JSON.stringify({ at: new Date(event.scheduledTime).toISOString(), confirmations: r.confirmations.details ? summary(r.confirmations) : r.confirmations, lessons: r.lessons.details ? summary(r.lessons) : r.lessons }))));
    // Free Golden Path course (R2): own flag COURSE_PRODUCTION_SENDING (OFF); same 9 AM PT hour and legal gate.
    ctx.waitUntil(courseScheduled(env, { nowMs: event.scheduledTime }).then((r) => console.log(JSON.stringify({ course: { confirmations: r.confirmations.details ? summary(r.confirmations) : r.confirmations, lessons: r.lessons.details ? summary(r.lessons) : r.lessons } }))).catch((e) => console.log('course error', String(e?.message ?? e))));
  },
  async fetch(request, env) {
    const u = new URL(request.url);
    if (u.pathname === '/health') {
      const c = lessonsConfig(env);
      const gate = await legalGate(c);
      return j(200, { ok: true, net: c.net, productionSending: c.production, testRecipients: c.testRecipients.length, resendKey: Boolean(c.apiKey), footer: Boolean(c.footer), from: c.from, replyTo: c.replyTo,
        lessonGate: gate.open ? 'open' : gate.reason, privacyStatus: gate.privacyStatus, termsResendLine: gate.termsLine });
    }
    if (request.method !== 'POST' || !['/run', '/run-confirmations', '/test-send', '/course/run', '/course/run-confirmations', '/course/delete', '/course/sync-contact'].includes(u.pathname)) return j(404, { ok: false });
    const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
    const key = String(env.LESSONS_ADMIN_KEY ?? '');
    if (key.length < 32 || !m || !safeEqual(m[1], key)) return j(401, { ok: false, reason: 'admin_key_required' });
    const dryRun = u.searchParams.get('dry') === '1';
    if (u.pathname === '/run') return j(200, await runLessons(env, { dryRun, force: u.searchParams.get('force') === '1' }));
    if (u.pathname === '/run-confirmations') return j(200, await runConfirmations(env, { dryRun }));
    if (u.pathname === '/course/run') return j(200, await runCourse(env, { dryRun, force: u.searchParams.get('force') === '1' }));
    if (u.pathname === '/course/run-confirmations') return j(200, await runCourseConfirmations(env, { dryRun }));
    if (u.pathname === '/course/delete') return j(200, await courseDelete(env, { email: u.searchParams.get('email') }));
    if (u.pathname === '/course/sync-contact') {
      const cc = courseConfig(env);
      const s = await env.STORE_DB.prepare('SELECT * FROM course_subs WHERE id = ?1 AND net = ?2').bind(u.searchParams.get('sub') ?? '', cc.net).first();
      return s ? j(200, await syncContact(cc, s)) : j(404, { ok: false });
    }
    // /test-send
    const c = lessonsConfig(env);
    if (c.production || c.net !== 'testnet') return j(403, { ok: false, reason: 'test_send_is_testnet_test_mode_only' });
    const day = Number(u.searchParams.get('day') ?? 1);
    if (!Number.isInteger(day) || day < 1 || day > 14) return j(400, { ok: false, reason: 'bad_day' });
    const sub = await env.STORE_DB.prepare('SELECT * FROM lesson_subs WHERE id = ?1 AND net = ?2').bind(u.searchParams.get('sub') ?? '', c.net).first();
    if (!sub || !c.testRecipients.includes(String(sub.email).toLowerCase())) return j(403, { ok: false, reason: 'not_a_test_recipient' });
    if (!c.apiKey) return j(503, { ok: false, reason: 'resend_key_not_set' });
    const res = await fetch(c.resendUrl, { method: 'POST', headers: { authorization: `Bearer ${c.apiKey}`, 'content-type': 'application/json', 'idempotency-key': `hwi-lesson-test/${sub.id}/day-${day}` }, body: JSON.stringify(lessonEmail(c, sub, day)) });
    const b = await res.json().catch(() => ({}));
    return j(res.ok ? 200 : 502, { ok: res.ok, day, resendId: b?.id ?? null, http: res.status, error: res.ok ? undefined : String(b?.message ?? '') });
  },
};
