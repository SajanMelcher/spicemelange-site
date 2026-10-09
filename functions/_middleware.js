// 301 www.thespicemelange.org/* -> https://thespicemelange.org/* (keeps path and query).
export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (url.hostname === 'www.thespicemelange.org') {
    url.hostname = 'thespicemelange.org';
    url.protocol = 'https:';
    return Response.redirect(url.toString(), 301);
  }
  return next();
}
