// Retention purge (Siona S3; Sajan approved 2026-10-10 ~2:59 AM PT). Pages has no cron, so this runs opportunistically from
// normal requests (order create + signal reads), at most once per PURGE_EVERY_MS per isolate+KV gate. All deletes are bounded.
//  - signal-feed reader per-minute IP-hash counters ('read:<hash>' in signal_hits): older than 1 hour  -> deleted
//  - other signal counters (post/report day buckets): older than 3 days                             -> deleted
//  - report IP hashes (signal_reports.reporter): older than 90 days                                 -> deleted (signals.reports keeps the count)
//  - UNPAID orders (status 'open') whose payment window ended more than 30 days ago, with their tags  -> deleted
//    (plus their status_hits / reset_challenges rows, and expired amount holds). Paid orders, email and tags are kept as sales records.
//  - course signup rate-limit rows ('course:ip:<hash>' / 'course:all' in status_hits, hour buckets 'cs:<h>'): older than 1 hour -> deleted (GL3)
//  - lesson + course signups never confirmed (pending/expired): 7 days after the request                -> deleted (GL2)
//  - finished lesson/course subscriptions ('done'): 30 days after the last lesson                       -> deleted, with send history
//  - course rows handed off to the 14-day lessons: 7 days after the handoff                             -> deleted
//  - reply-keyword suggestions: older than 90 days                                                      -> deleted
//  Unsubscribes are minimized at once (lessons.js / course.js); only email_suppressions (hash + date) is kept, indefinitely.
// The Worker cron (every 10 min) also calls purge(), so these run even when the site is quiet.
export const PURGE_EVERY_MS = 10 * 60_000;
export const RETENTION = { readHashMs: 3_600_000, counterDays: 3, reportHashDays: 90, unpaidOrderDays: 30,
  courseIpHashMs: 3_600_000, unconfirmedDays: 7, afterLastLessonDays: 30, handoffDays: 7, suggestionDays: 90 };
const DAY = 86_400_000;

export async function purge(db, nowMs = Date.now()) {
  const minuteCut = Math.floor((nowMs - RETENTION.readHashMs) / 60_000);
  const dayCut = Math.floor(nowMs / DAY) - RETENTION.counterDays;
  const reportCut = nowMs - RETENTION.reportHashDays * DAY;
  const unpaidCut = nowMs - RETENTION.unpaidOrderDays * DAY;
  const n = {};
  const run = async (key, sql, ...b) => { try { n[key] = Number((await db.prepare(sql).bind(...b).run())?.meta?.changes ?? 0); } catch (e) { n[key] = `skip: ${String(e?.message ?? e).slice(0, 80)}`; } };
  await run('readHashes', `DELETE FROM signal_hits WHERE k LIKE 'read:%' AND bucket LIKE 'm%' AND CAST(substr(bucket, 2) AS INTEGER) < ?1`, minuteCut);
  await run('dayCounters', `DELETE FROM signal_hits WHERE bucket LIKE 'd%' AND CAST(substr(bucket, 2) AS INTEGER) < ?1`, dayCut);
  await run('reportHashes', `DELETE FROM signal_reports WHERE created_ms < ?1`, reportCut);
  const old = `SELECT id FROM orders WHERE status = 'open' AND expires_ms < ?1`;
  await run('unpaidStatusHits', `DELETE FROM status_hits WHERE order_id IN (${old})`, unpaidCut);
  await run('unpaidResets', `DELETE FROM reset_challenges WHERE order_id IN (${old})`, unpaidCut);
  await run('unpaidOrders', `DELETE FROM orders WHERE status = 'open' AND expires_ms < ?1`, unpaidCut);
  const hourCut = Math.floor((nowMs - RETENTION.courseIpHashMs) / 3_600_000);
  await run('courseIpHashes', `DELETE FROM status_hits WHERE order_id LIKE 'course:%' AND bucket LIKE 'cs:%' AND CAST(substr(bucket, 4) AS INTEGER) < ?1`, hourCut);
  const pendCut = nowMs - RETENTION.unconfirmedDays * DAY, doneCut = nowMs - RETENTION.afterLastLessonDays * DAY;
  const lessonOld = `SELECT id FROM lesson_subs WHERE (status IN ('pending','expired') AND consent_ms < ?1) OR (status = 'done' AND last_sent_ms < ?2)`;
  await run('lessonSends', `DELETE FROM lesson_sends WHERE sub_id IN (${lessonOld})`, pendCut, doneCut);
  await run('lessonSubs', `DELETE FROM lesson_subs WHERE id IN (${lessonOld})`, pendCut, doneCut);
  const courseOld = `SELECT id FROM course_subs WHERE (status IN ('pending','expired') AND consent_ms < ?1) OR (status = 'done' AND last_sent_ms < ?2)
    OR (status = 'handed_off' AND COALESCE(handoff_ms, 0) < ?3) OR status = 'unsubscribed'`;
  const hoCut = nowMs - RETENTION.handoffDays * DAY;
  await run('courseSuggestions', `DELETE FROM course_suggestions WHERE sub_id IN (${courseOld}) OR received_ms < ?4`, pendCut, doneCut, hoCut, nowMs - RETENTION.suggestionDays * DAY);
  await run('courseSends', `DELETE FROM course_sends WHERE sub_id IN (${courseOld})`, pendCut, doneCut, hoCut);
  await run('courseSubs', `DELETE FROM course_subs WHERE id IN (${courseOld})`, pendCut, doneCut, hoCut);
  await run('expiredHolds', `DELETE FROM amount_holds WHERE hold_until_ms < ?1 AND order_id NOT IN (SELECT id FROM orders WHERE status = 'open')`, nowMs);
  return n;
}

let lastLocal = 0;
/** Run purge() at most every PURGE_EVERY_MS (per isolate, and across isolates via a KV timestamp when KV is bound). Never throws. */
export async function maybePurge(cfg, nowMs = Date.now()) {
  try {
    if (!cfg?.db || nowMs - lastLocal < PURGE_EVERY_MS) return null;
    lastLocal = nowMs;
    if (cfg.kv) {
      const last = Number((await cfg.kv.get('purge:last')) ?? 0);
      if (nowMs - last < PURGE_EVERY_MS) return null;
      await cfg.kv.put('purge:last', String(nowMs), { expirationTtl: 86_400 });
    }
    const n = await purge(cfg.db, nowMs);
    console.log('retention purge', JSON.stringify(n));
    return n;
  } catch (e) { console.log('retention purge failed', String(e?.message ?? e)); return null; }
}
export const _resetPurgeGate = () => { lastLocal = 0; };
