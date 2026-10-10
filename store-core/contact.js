// One place for the public deletion/privacy contact (Siona GL5). hello@ is final (Sajan, 10/10, with the final LICENSE.md).
// Change it here and in LICENSE.md together (test/course.test.mjs checks they match).
export const DELETION_CONTACT = 'hello@thespicemelange.org';
// Replies to lesson and course emails go here (Sajan chose reply-to reserve@ at 7:16 AM PT). Must equal LESSONS_REPLY_TO.
export const REPLY_CONTACT = 'reserve@thespicemelange.org';
// Subscriber retention the code enforces (purge.js RETENTION), stated on /privacy/.
import { RETENTION } from './purge.js';
export const SUB_RETENTION = { unconfirmedDays: RETENTION.unconfirmedDays, afterLastLessonDays: RETENTION.afterLastLessonDays, handoffDays: RETENTION.handoffDays, suggestionDays: RETENTION.suggestionDays };
