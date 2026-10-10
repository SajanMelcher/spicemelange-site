// One-click unsubscribe for Hwi's practice lessons. Always works, whatever the sending flag says.
// GET  /api/lessons/unsubscribe?s=<sub id>&t=<token>   link in every email: unsubscribes at once, shows a short page
// POST /api/lessons/unsubscribe?s=..&t=..  body "List-Unsubscribe=One-Click" (RFC 8058, sent by mail providers)
import { unsubscribe } from '../../../store-core/lessons.js';

const page = (ok) => new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${ok ? 'Unsubscribed' : 'Link not valid'}</title></head>
<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:60px auto;padding:0 20px;color:#2b2218;background:#fffdf8">
<h1 style="font-family:Georgia,serif;color:#5a3a12">${ok ? "You're unsubscribed" : 'That link is not valid'}</h1>
<p>${ok ? "You won't get any more of Hwi's practice lessons. Your templates still include every lesson in their education/ folder, and your bot can show you one a day." : 'It may be incomplete. Copy the whole link from the email, or email hello@thespicemelange.org and we will remove you by hand.'}</p>
<p><a href="/" style="color:#a0742f">The Spice Melange</a></p></body></html>`, { status: ok ? 200 : 400, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });

const run = (context) => {
  const u = new URL(context.request.url);
  return unsubscribe(context.env.STORE_DB, { subId: u.searchParams.get('s'), token: u.searchParams.get('t') });
};
export async function onRequestGet(context) { return page((await run(context)).ok); }
export async function onRequestPost(context) {
  const r = await run(context);
  return new Response(r.ok ? 'unsubscribed' : 'bad link', { status: r.ok ? 200 : 400, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
}
