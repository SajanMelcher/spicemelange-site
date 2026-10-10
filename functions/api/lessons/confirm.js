// Double opt-in step 2 for Hwi's practice lessons.
// GET  /api/lessons/confirm?s=<sub id>&t=<confirm token>  link in the confirmation email: shows a Confirm button only
//      (link scanners that open the link do NOT confirm anyone)
// POST /api/lessons/confirm?s=..&t=..                       the button: confirms; lessons start at the next 9 AM PT send
import { confirm } from '../../../store-core/lessons.js';
import { page } from '../../../store-core/lessons-page.js';

const ids = (context) => { const u = new URL(context.request.url); return { subId: u.searchParams.get('s'), token: u.searchParams.get('t') }; };
const okFmt = (x) => /^ls_[A-Za-z0-9_-]{16}$/.test(x.subId ?? '') && /^lc_[A-Za-z0-9_-]{32}$/.test(x.token ?? '');
export async function onRequestGet(context) {
  const x = ids(context);
  if (!okFmt(x)) return page(400, 'That link is not valid', ['It may be incomplete. Copy the whole link from the email.']);
  return page(200, "Confirm Hwi's practice lessons", [
    "Press the button to get one short lesson a day for 14 days, starting at the next 9:00 AM Pacific send. Every email has a one-click unsubscribe.",
    "Didn't ask for this? Just close this page. Nothing will be sent.",
  ], { action: `/api/lessons/confirm?s=${encodeURIComponent(x.subId)}&t=${encodeURIComponent(x.token)}`, label: 'Confirm: send me the lessons' });
}
export async function onRequestPost(context) {
  const o = context.request.headers.get('origin');
  if (o && o !== new URL(context.request.url).origin) return page(403, 'Not allowed', ['Please use the button on the confirmation page.']);
  const r = await confirm(context.env.STORE_DB, ids(context));
  if (r.ok) return page(200, "You're confirmed", ["Thank you. Your first lesson arrives at the next 9:00 AM Pacific send, then one a day for 14 days. Unsubscribe any time with the link in each email."]);
  if (r.reason === 'unsubscribed' || r.reason === 'expired') return page(410, 'This request has ended', ['Sign up again on the store\'s re-download page if you\'d like the lessons.']);
  return page(400, 'That link is not valid', ['It may be incomplete or from an older request. Copy the whole link from the newest email.']);
}
