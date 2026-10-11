// GET /certificates/holder/<serial>/<token>: serve the holder page shell; the page posts serial+token to
// /api/certificates/token-view (token never goes in a query string or a third-party request). no-referrer + noindex.
export async function onRequestGet({ request, env }) {
  const u = new URL(request.url); u.pathname = '/certificates/holder/'; u.search = '';
  const page = await env.ASSETS.fetch(new Request(u.toString(), { headers: { accept: 'text/html' } }));
  const h = new Headers(page.headers);
  h.set('Referrer-Policy', 'no-referrer'); h.set('X-Robots-Tag', 'noindex, nofollow, noarchive'); h.set('Cache-Control', 'no-store');
  return new Response(page.body, { status: page.status, headers: h });
}
