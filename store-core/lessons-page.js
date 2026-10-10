// Small self-contained HTML pages for the lesson confirm/unsubscribe links. Pages Functions responses don't get the
// site-wide _headers block, so each page sets its own strict CSP: no scripts at all, inline style attributes only,
// and the one form posts back to this origin.
export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'";
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function page(status, title, paragraphs, form) {
  const body = paragraphs.map((p) => `<p style="line-height:1.55">${esc(p)}</p>`).join('')
    + (form ? `<form method="post" action="${esc(form.action)}" style="margin:20px 0"><button type="submit" style="font-size:16px;background:#a0742f;color:#fffdf8;border:0;border-radius:8px;padding:10px 18px;cursor:pointer">${esc(form.label)}</button></form>` : '');
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title></head>
<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;max-width:560px;margin:60px auto;padding:0 20px;color:#2b2218;background:#fffdf8">
<h1 style="font-family:Georgia,serif;color:#5a3a12">${esc(title)}</h1>${body}
<p><a href="/" style="color:#a0742f">The Spice Melange</a></p></body></html>`, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store, no-transform', // no-transform: keep the edge from injecting the analytics beacon (this CSP blocks it) 'x-robots-tag': 'noindex',
      'content-security-policy': PAGE_CSP, 'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer', 'strict-transport-security': 'max-age=31536000; includeSubDomains',
    },
  });
}
