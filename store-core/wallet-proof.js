// Wallet ownership proof (Siona: signed challenge before any mainnet cap transfer). PREVIEW ONLY.
// The holder connects any Sui wallet (Wallet Standard), signs a personal message (no gas, no transaction), the server
// checks nonce + domain + signature, and stores {message, signature} privately in preview KV for the box to collect.
// Verification supports Ed25519 / Secp256k1 / Secp256r1 (offline) and zkLogin (Sui GraphQL verifyZkLoginSignature on
// the network the wallet signed for: mainnet by default). Passkey and multisig are verified by @mysten/sui too.
import { normAddr, requireSecret } from './spice-holder.js';
import { adminTx } from './admin-actions.js';
import { signRateLimit } from './sign-ratelimit.js';
import { PROOF_TTL_MS, makeProofNonce, checkProofNonce, proofMessage, field, verifyProofSignature } from './proof-core.js';
export { PROOF_TTL_MS, GQL, makeProofNonce, checkProofNonce, proofMessage, field, verifyProofSignature } from './proof-core.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow' } });
const sameOrigin = (req) => { const o = req.headers.get('origin'); return !o || o === new URL(req.url).origin; };

/** POST /api/wallet-proof/challenge {address, network?}  ->  {message}
 *  POST /api/wallet-proof/submit {message, signature}     ->  {ok, address, scheme, id}. Preview only. */
export async function handleProof(action, { request, env }, deps = {}) {
  const now = deps.now ?? Date.now();
  // Preview always; the prod domain only when WALLET_PAGES_LIVE=1 (OFF until Siona passes this branch), mainnet only there.
  const live = env.WALLET_PAGES_LIVE === '1' && env.SPICE_CERT_PREVIEW !== '1';
  if (env.SPICE_CERT_PREVIEW !== '1' && !live) return json(503, { ok: false, reason: 'preview_only' });
  // F-2: on the prod domain only admin-tx exists (status/pause/unpause, below); challenge/submit are refused even with the flag on.
  if (live && action !== 'admin-tx') return json(404, { ok: false, reason: 'not_on_prod' });
  if (live) { const lim = await (deps.rateLimit ?? signRateLimit)(request, env, now, 'wallet-proof/' + action); if (lim) return lim; }
  if (live) { let n = 'mainnet'; try { n = (await request.clone().json()).network ?? 'mainnet'; } catch {} if (n !== 'mainnet') return json(400, { ok: false, reason: 'mainnet_only' }); }
  const secret = requireSecret(env); if (!secret || (!env.STORE_KV && action !== 'admin-tx')) return json(503, { ok: false, reason: 'not_configured' });
  if (request.method !== 'POST') return json(405, { ok: false, reason: 'method' });
  if (!sameOrigin(request)) return json(403, { ok: false, reason: 'bad_origin' });
  let b = {}; try { b = await request.json(); } catch {}
  const host = new URL(request.url).host;
  if (action === 'challenge') {
    const address = normAddr(b.address); if (!address) return json(400, { ok: false, reason: 'bad_address' });
    const network = b.network === 'testnet' ? 'testnet' : 'mainnet';
    const nonce = await makeProofNonce(secret, address, now);
    return json(200, { ok: true, message: proofMessage({ host, address, nonce, network, now }), expires_in_s: PROOF_TTL_MS / 1000 });
  }
  if (action === 'submit') {
    const msg = String(b.message || ''), address = normAddr(field(msg, 'Wallet'));
    if (!address) return json(400, { ok: false, reason: 'bad_message' });
    if (field(msg, 'Domain') !== host) return json(401, { ok: false, reason: 'wrong_domain' });
    const nerr = await checkProofNonce(secret, address, field(msg, 'Nonce'), now); if (nerr) return json(401, { ok: false, reason: nerr });
    const v = await (deps.verify ?? verifyProofSignature)(msg, String(b.signature || ''));
    if (!v.ok) return json(401, { ok: false, reason: v.reason, scheme: v.scheme });
    const nonce = field(msg, 'Nonce'), key = `walletproof:${address}:${nonce.split('.')[0]}`;
    if (await env.STORE_KV.get(key)) return json(409, { ok: false, reason: 'nonce_already_used' });
    const rec = { kind: 'spice-wallet-proof', v: 1, address, scheme: v.scheme, network: v.network, host, message: msg, signature: String(b.signature), server_verified_ms: now };
    await env.STORE_KV.put(key, JSON.stringify(rec), { expirationTtl: 30 * 24 * 3600 });
    return json(200, { ok: true, address, scheme: v.scheme, network: v.network, id: key, message: msg, signature: rec.signature });
  }
  if (action === 'admin-tx') {
    // Prod domain (/sign/): only read status and set_paused(true/false). Revoke/mint caps/burn/display stay preview-only.
    if (live && !['status', 'pause', 'unpause'].includes(b?.action)) return json(403, { ok: false, reason: 'action_not_on_prod' });
    // V3-7: wallet-side pause / unpause / revoke for the AdminCap holder. Build + dry-run only; the wallet signs.
    const r = await (deps.adminTx ?? adminTx)(b); // the whole body: adminTx refuses packageId/package (V4-4)
    return json(r.ok ? 200 : 400, r);
  }
  return json(404, { ok: false, reason: 'unknown_action' });
}
