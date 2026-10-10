// R9 handoff, split out of course.js (Siona GL14) so lessons.js works when the course is absent or disabled:
// it only reads course_subs and fails soft (no table, no row -> null).
/** R9: the address confirmed the 14-day lessons -> stop the free course at once. Returns the track for the day-1 line. */
export async function courseHandoff(db, { email, net }) {
  if (!db) return null;
  const r = await Promise.resolve().then(() => db.prepare(`SELECT id, track, status FROM course_subs WHERE net = ?1 AND email = ?2`).bind(net, String(email).toLowerCase()).first()).catch(() => null);
  if (!r) return null;
  if (!['unsubscribed', 'suppressed', 'handed_off'].includes(r.status)) await db.prepare(`UPDATE course_subs SET status = 'handed_off', handoff_ms = ?2 WHERE id = ?1`).bind(r.id, Date.now()).run();
  return r.track;
}
export const HANDOFF_LINE = {
  pilgrim: "You came from the free Golden Path course, so we'll go slowly: every term is defined as we go.",
  fremen: "You came from the free Golden Path course: you know the basics, so watch for the order-book and fee details.",
  naib: 'You came from the free Golden Path course: skim days 1 to 3; day 6 onward is where your settings get tested.',
};

