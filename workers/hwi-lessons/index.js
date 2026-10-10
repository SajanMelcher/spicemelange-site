// Hwi's practice lessons: daily sender (Cloudflare Cron Trigger). Pages Functions cannot run crons, so this is a
// small standalone Worker bound to the store's D1. All logic is in store-core/lessons.js.
//   scheduled  -> runLessons(env)  (the daily cron)
//   POST /run  -> manual run, Authorization: Bearer <LESSONS_ADMIN_KEY>; ?dry=1 lists who is due without sending;
//                 ?force=1 (testnet test mode only) ignores the 20 h gap so a test inbox can get all 14 in a row.
// Production sending is OFF unless LESSONS_PRODUCTION_SENDING=1 (see portfolio-desk/education/HWI-REVIEW.md).
import { runLessons, lessonsConfig } from '../../store-core/lessons.js';

const j = (s, b) => new Response(JSON.stringify(b, null, 1), { status: s, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0;
}
export default {
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runLessons(env).then((r) => console.log(JSON.stringify({ at: new Date().toISOString(), ...r, details: undefined }))));
  },
  async fetch(request, env) {
    const u = new URL(request.url);
    if (u.pathname === '/health') {
      const c = lessonsConfig(env);
      return j(200, { ok: true, net: c.net, productionSending: c.production, testRecipients: c.testRecipients.length, resendKey: Boolean(c.apiKey) });
    }
    if (u.pathname !== '/run' || request.method !== 'POST') return j(404, { ok: false });
    const m = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
    const key = String(env.LESSONS_ADMIN_KEY ?? '');
    if (key.length < 32 || !m || !safeEqual(m[1], key)) return j(401, { ok: false, reason: 'admin_key_required' });
    return j(200, await runLessons(env, { dryRun: u.searchParams.get('dry') === '1', force: u.searchParams.get('force') === '1' }));
  },
};
