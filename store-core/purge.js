// Retention purge (Siona S3; Sajan approved 2026-10-10 ~2:59 AM PT). Pages has no cron, so this runs opportunistically from
// normal requests (order create + signal reads), at most once per PURGE_EVERY_MS per isolate+KV gate. All deletes are bounded.
//  - signal-feed reader per-minute IP-hash counters ('read:<hash>' in signal_hits): older than 1 hour  -> deleted
//  - other signal counters (post/report day buckets): older than 3 days                             -> deleted
//  - report IP hashes (signal_reports.reporter): older than 90 days                                 -> deleted (signals.reports keeps the count)
//  - UNPAID orders (status 'open') whose payment window ended more than 30 days ago, with their tags  -> deleted
//    (plus their status_hits / reset_challenges rows, and expired amount holds). Paid orders, email and tags are kept as sales records.
export const PURGE_EVERY_MS = 10 * 60_000;
export const RETENTION = { readHashMs: 3_600_000, counterDays: 3, reportHashDays: 90, unpaidOrderDays: 30 };
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
