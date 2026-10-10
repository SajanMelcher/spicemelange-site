// Hashed-email suppression (Siona GL2). Only sha256(lowercased email) + list + date are kept.
import { sha256Hex } from './core.js';
export const emailHash = (email) => sha256Hex(`suppress|${String(email).trim().toLowerCase()}`);
export async function suppress(db, list, email, nowMs) {
  await db.prepare(`INSERT INTO email_suppressions (email_hash, list, unsub_ms) VALUES (?1, ?2, ?3)
    ON CONFLICT (email_hash, list) DO UPDATE SET unsub_ms = ?3`).bind(await emailHash(email), list, nowMs).run();
}
export async function unsuppress(db, list, email) {
  await db.prepare('DELETE FROM email_suppressions WHERE email_hash = ?1 AND list = ?2').bind(await emailHash(email), list).run();
}
/** True if the address unsubscribed from this list after `sinceMs` (e.g. after it confirmed). */
export async function suppressedSince(db, list, email, sinceMs) {
  const r = await db.prepare('SELECT unsub_ms FROM email_suppressions WHERE email_hash = ?1 AND list = ?2').bind(await emailHash(email), list).first().catch(() => null);
  return Boolean(r && Number(r.unsub_ms) >= Number(sinceMs ?? 0));
}
