// /api/upgrade-sign/tx: reviewed unsigned bytes (GET only; the wallet executes) for Sajan's mainnet collection upgrade (store-core/upgrade-sign.js).
import { handleUpgradeSign } from '../../../store-core/upgrade-sign.js';
export const onRequest = (context) => handleUpgradeSign(context.params.action, context);
