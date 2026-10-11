// POST /api/certificates/{challenge|signin|token-view|me|withdraw|wallet|trade-quote}  (TESTNET PREVIEW only; see store-core/spice-api.js)
import { handle } from '../../../store-core/spice-api.js';
export const onRequest = (context) => handle(String(context.params.action), context);
