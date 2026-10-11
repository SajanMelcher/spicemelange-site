// /api/wallet-proof/{challenge,submit}: preview-only wallet ownership proof (store-core/wallet-proof.js).
import { handleProof } from '../../../store-core/wallet-proof.js';
export const onRequest = (context) => handleProof(context.params.action, context);
