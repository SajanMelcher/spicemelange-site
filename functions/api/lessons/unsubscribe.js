// One-click unsubscribe for Hwi's practice lessons. Always works, whatever the sending flag says.
// GET  /api/lessons/unsubscribe?s=<sub id>&t=<token>   link in every email: unsubscribes at once (Sajan: one-click)
// POST /api/lessons/unsubscribe?s=..&t=..  body "List-Unsubscribe=One-Click" (RFC 8058, sent by mail providers)
import { unsubscribe } from '../../../store-core/lessons.js';
import { page } from '../../../store-core/lessons-page.js';

const run = (context) => {
  const u = new URL(context.request.url);
  return unsubscribe(context.env.STORE_DB, { subId: u.searchParams.get('s'), token: u.searchParams.get('t') });
};
export async function onRequestGet(context) {
  const r = await run(context);
  return r.ok
    ? page(200, "You're unsubscribed", ["You won't get any more of Hwi's practice lessons. Your templates still include every lesson in their education/ folder, and your bot can show you one a day."])
    : page(400, 'That link is not valid', ['It may be incomplete. Copy the whole link from the email, or email reserve@thespicemelange.org and we will remove you by hand.']);
}
export async function onRequestPost(context) {
  const r = await run(context);
  return new Response(r.ok ? 'unsubscribed' : 'bad link', { status: r.ok ? 200 : 400, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
}
