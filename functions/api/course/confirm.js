// Double opt-in step 2 for the free course. GET shows a button (scanner-safe); POST confirms.
import { courseConfirm } from '../../../store-core/course.js';
import { page } from '../../../store-core/lessons-page.js';

const ids = (c) => { const u = new URL(c.request.url); return { subId: u.searchParams.get('s'), token: u.searchParams.get('t') }; };
export async function onRequestGet(context) {
  const x = ids(context);
  if (!/^cs_[A-Za-z0-9_-]{16}$/.test(x.subId ?? '') || !/^cc_[A-Za-z0-9_-]{32}$/.test(x.token ?? '')) return page(400, 'That link is not valid', ['Copy the whole link from the email.']);
  return page(200, "Confirm Hwi's free course", ['Press the button to get the seven Golden Path lessons, shaped to your answers. Every email has a one-click unsubscribe.', "Didn't ask for this? Just close this page."],
    { action: `/api/course/confirm?s=${encodeURIComponent(x.subId)}&t=${encodeURIComponent(x.token)}`, label: 'Confirm: send me the course' });
}
export async function onRequestPost(context) {
  const o = context.request.headers.get('origin');
  if (o && o !== 'null' && o !== new URL(context.request.url).origin) return page(403, 'Not allowed', ['Please use the button on the confirmation page.']);
  const r = await courseConfirm(context.env, ids(context));
  if (r.ok) return page(200, "You're confirmed", ['Your first lesson arrives at the next 9:00 AM Pacific send. Reply to any lesson to tell Hwi if it is too simple or too deep.']);
  if (r.status === 410) return page(410, 'This request has ended', ['Sign up again on /learn/ if you would like the course.']);
  return page(400, 'That link is not valid', ['It may be incomplete or from an older request.']);
}
