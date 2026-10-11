// LEGACY link format /certificates/holder/<serial>/<token> (Siona SC15: a token in the path lands in history and request
// logs). Retired: the token is NOT used. We redirect to the holder page without it and ask for a new link. New links put the
// token in the URL fragment (/certificates/holder/#s=<serial>&t=<token>), which browsers never send to any server.
export async function onRequestGet() {
  return new Response(null, { status: 302, headers: { location: '/certificates/holder/#old-link', 'referrer-policy': 'no-referrer',
    'x-robots-tag': 'noindex, nofollow, noarchive', 'cache-control': 'no-store' } });
}
