// POST /api/certificates/{challenge|signin|token-view|me|withdraw|wallet|trade-quote}  (TESTNET PREVIEW only; see store-core/spice-api.js)
import { handle } from '../../../store-core/spice-api.js';
import { certsLive } from '../../../store-core/launch.js';
// Not launched (SPICE_CERTS_LIVE != 1): the API does not exist (404), whatever secrets or D1 are bound (Siona SJ2).
export const onRequest = (context) => (certsLive(context.env) ? handle(String(context.params.action), context)
  : new Response(JSON.stringify({ ok: false, reason: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } }));
