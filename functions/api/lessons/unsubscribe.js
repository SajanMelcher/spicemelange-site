// One-click unsubscribe for Hwi's practice lessons. Always works, whatever the sending flag says.
// GET  /api/lessons/unsubscribe?s=<sub id>&t=<token>   link in every email: unsubscribes at once (Sajan: one-click)
// POST /api/lessons/unsubscribe?s=..&t=..  body "List-Unsubscribe=One-Click" (RFC 8058, sent by mail providers)
import { unsubscribe } from '../../../store-core/lessons.js';
import { page } from '../../../store-core/lessons-page.js';
import { DELETION_CONTACT } from '../../../store-core/contact.js';

const run = (context) => {
  const u = new URL(context.request.url);
  return unsubscribe(context.env.STORE_DB, { subId: u.searchParams.get('s'), token: u.searchParams.get('t') });
};
// R11: log the method (no ids, no email) so link-scanner GET unsubscribes can be spotted next to RFC 8058 POSTs.
const logUnsub = (method, r) => console.log(JSON.stringify({ kind: 'lesson_unsubscribe', method, ok: r.ok }));
export async function onRequestGet(context) {
  const r = await run(context); logUnsub('GET', r);
  return r.ok
    ? page(200, "You're unsubscribed", ["You won't get any more of Hwi's practice lessons.", `We deleted your address and send history and kept only a hashed record so we never email you again. Questions or deletion: ${DELETION_CONTACT}.`])
    : page(400, 'That link is not valid', [`It may be incomplete. Copy the whole link from the email, or write to ${DELETION_CONTACT} and we will remove you by hand.`]);
}
export async function onRequestPost(context) {
  const r = await run(context); logUnsub('POST', r);
  return new Response(r.ok ? 'unsubscribed' : 'bad link', { status: r.ok ? 200 : 400, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
}
