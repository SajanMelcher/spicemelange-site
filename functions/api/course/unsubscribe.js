// One-click unsubscribe for the free course: GET link (logged as GET) and RFC 8058 POST (logged as POST).
import { courseUnsubscribe } from '../../../store-core/course.js';
import { page } from '../../../store-core/lessons-page.js';

const run = (c) => { const u = new URL(c.request.url); return courseUnsubscribe(c.env, { subId: u.searchParams.get('s'), token: u.searchParams.get('t') }); };
const log = (method, r) => console.log(JSON.stringify({ kind: 'course_unsubscribe', method, ok: r.ok }));
export async function onRequestGet(context) {
  const r = await run(context); log('GET', r);
  return r.ok ? page(200, "You're unsubscribed", ["You won't get any more of Hwi's course emails."])
    : page(400, 'That link is not valid', ['Copy the whole link from the email, or write to reserve@thespicemelange.org and we will remove you by hand.']);
}
export async function onRequestPost(context) {
  const r = await run(context); log('POST', r);
  return new Response(r.ok ? 'unsubscribed' : 'bad link', { status: r.ok ? 200 : 400, headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
}
