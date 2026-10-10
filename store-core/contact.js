// One place for the public deletion/privacy contact (Siona GL5). hello@ is final (Sajan, 10/10, with the final LICENSE.md).
// Change it here and in LICENSE.md together (test/course.test.mjs checks they match).
export const DELETION_CONTACT = 'hello@thespicemelange.org';
// Subscriber retention the code enforces (purge.js RETENTION), stated on /privacy/.
import { RETENTION } from './purge.js';
export const SUB_RETENTION = { unconfirmedDays: RETENTION.unconfirmedDays, afterLastLessonDays: RETENTION.afterLastLessonDays, handoffDays: RETENTION.handoffDays, suggestionDays: RETENTION.suggestionDays };
