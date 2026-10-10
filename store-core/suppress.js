// Hashed-email suppression (Siona GL2 + LOW). Only HMAC-SHA256(SUPPRESSION_SALT, lowercased email) + list + date are kept.
// The salt is a required secret (Pages + Worker, same value): with no salt nothing is hashed and the senders fail closed.
const enc = new TextEncoder();
export const SALT_MIN = 16;
export async function emailHash(salt, email) {
  if (!salt || String(salt).length < SALT_MIN) throw new Error('suppression_salt_not_set');
  const k = await crypto.subtle.importKey('raw', enc.encode(String(salt)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(`suppress|${String(email).trim().toLowerCase()}`)));
  return [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function suppress(db, salt, list, email, nowMs) {
  await db.prepare(`INSERT INTO email_suppressions (email_hash, list, unsub_ms) VALUES (?1, ?2, ?3)
    ON CONFLICT (email_hash, list) DO UPDATE SET unsub_ms = ?3`).bind(await emailHash(salt, email), list, nowMs).run();
}
/** Block-lift: called only when a FRESH double opt-in is confirmed. */
export async function unsuppress(db, salt, list, email) {
  await db.prepare('DELETE FROM email_suppressions WHERE email_hash = ?1 AND list = ?2').bind(await emailHash(salt, email), list).run();
}
/** True if the address unsubscribed from this list at or after `sinceMs` (e.g. after it made this request / confirmed). */
export async function suppressedSince(db, salt, list, email, sinceMs) {
  const r = await db.prepare('SELECT unsub_ms FROM email_suppressions WHERE email_hash = ?1 AND list = ?2').bind(await emailHash(salt, email), list).first();
  return Boolean(r && Number(r.unsub_ms) >= Number(sinceMs ?? 0));
}
