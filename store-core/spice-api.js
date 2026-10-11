// Spice Certificates API. One dispatcher used by functions/api/certificates/[action].js.
//
// Two gates (Ixians 10/10/2026 PT):
//  1. signinGate: wallet sign-in + license check + TESTNET purchase preview. On wherever SPICE_SESSION_SECRET (>=32 chars)
//     and the D1 binding exist (preview and, once the secret is set, production). Reads MAINNET DeskLicenses (spice-gate.js).
//  2. gate (holder data: statements, view-only links, withdrawal requests, wallet, trade): TESTNET PREVIEW only
//     (SUI_NETWORK=testnet AND SPICE_CERT_PREVIEW=1). Production answers 503 preview_only for these.
// cert-buy-quote builds against the network chosen by SPICE_CERT_REDEEM_NETWORK (store-core/spice-cert-net.js). On mainnet it
// refuses while the Issuer is paused (live) or SPICE_CERT_MAINNET_SALES is not "1".
import { readJson, sameOrigin } from './http.js';
import * as H from './spice-holder.js';
import { walletBalances } from './spice-wallet.js';
import { tradeQuote, TRADE_LIMITS } from './spice-trade.js';
import { licenseAccess, CERT_ELIGIBILITY, copy } from './spice-gate.js';
import { certBuyQuote, TESTNET_CERT, HOLDER_CERT_TYPE, issuerPaused, SALES_PAUSED } from './spice-cert-buy.js';
import { certNetwork, certTarget, mainnetSalesOpen } from './spice-cert-net.js';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { certRedeemQuote, redeemTarget } from './spice-cert-redeem.js';
import { loadBlock, loadPrivate, minimalRow, storeWithdrawal, usesD1 } from './spice-holder-store.js';

const GQL_TESTNET = 'https://graphql.testnet.sui.io/graphql';
// Function responses get none of the _headers rules (Siona SC14), so set them here. One Referrer-Policy.
export const json = (status, body) => new Response(JSON.stringify(body), { status, headers: {
  'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow, noarchive' } });

export function signinGate(env) {
  if (!H.requireSecret(env)) return 'not_configured';
  if (!env?.STORE_DB) return 'not_configured';
  return null;
}
// Holder data is on where SPICE_HOLDERS_LIVE="1" (production, D1 records) or on the testnet preview.
export const holdersLive = (env) => env?.SPICE_HOLDERS_LIVE === '1';
const isPreview = (env) => env?.SUI_NETWORK === 'testnet' && env?.SPICE_CERT_PREVIEW === '1';
export function gate(env) {
  if (!isPreview(env) && !holdersLive(env)) return 'preview_only';
  if (!H.requireSecret(env)) return 'not_configured';
  return null;
}
/** The master block: SPICE_HOLDER_SOURCE (sample | d1 | d1+sample), see spice-holder-store.js. */
export async function masterBlock(env) { return loadBlock(env, certNetwork(env)); }

export async function ownedSerials(env, address, fetchImpl = fetch) {
  // network switch SPICE_CERT_REDEEM_NETWORK: mainnet reads mainnet GraphQL with the mainnet certificate type (generated ids)
  const mt = certNetwork(env) === 'mainnet' ? certTarget('mainnet') : null;
  if (certNetwork(env) === 'mainnet' && !mt) return [];
  const type = mt ? mt.certificateType : (env.SPICE_CERT_TYPE || HOLDER_CERT_TYPE); // default: the generated testnet ids (single source of truth)
  if (!type) return null;
  const q = 'query($a:SuiAddress!,$t:String!){ address(address:$a){ objects(filter:{type:$t}, first:50){ nodes{ contents{ json } } } } }';
  const url = mt ? mt.graphql : GQL_TESTNET;
  const get = async (owner) => { const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q, variables: { a: owner, t: type } }) });
    return ((await r.json()).data?.address?.objects?.nodes || []).map((n) => n.contents?.json || {}); };
  const own = (await get(address)).map((j) => Number(j.serial));
  // After step 1 (request_redemption) the contract holds the certificate at the Issuer's address; it is still this holder's.
  let held = [];
  if (mt) { const me = H.normAddr(address); held = (await get(mt.issuerId)).filter((j) => H.normAddr(j.holder) === me).map((j) => Number(j.serial)); }
  return [...new Set([...own, ...held])].filter(Number.isFinite);
}
const bearer = (req) => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
const HOLDER_ACTIONS = new Set(['token-view', 'me', 'withdraw', 'wallet', 'trade-quote', 'redeem-quote']);
const PREVIEW_ONLY_ACTIONS = new Set(['wallet', 'trade-quote']); // testnet wallet + DeepBook testnet trade panel

export async function handle(action, context, deps = {}) {
  const { request, env } = context;
  const now = deps.now ?? Date.now();
  const sg = signinGate(env); if (sg) return json(503, { ok: false, reason: sg });
  const holderOk = !gate(env);
  if (HOLDER_ACTIONS.has(action) && !holderOk) return json(503, { ok: false, reason: 'preview_only' });
  if (PREVIEW_ONLY_ACTIONS.has(action) && !isPreview(env)) return json(503, { ok: false, reason: 'preview_only' });
  if (request.method !== 'POST') return json(405, { ok: false, reason: 'method' });
  if (!sameOrigin(request)) return json(403, { ok: false, reason: 'bad_origin' });
  const secret = H.requireSecret(env), host = new URL(request.url).host, db = env.STORE_DB;
  const b = (await readJson(request)) || {};
  const access = (addr) => (deps.licenseAccess ?? licenseAccess)(addr, { m: CERT_ELIGIBILITY });
  const needBlock = holderOk && (HOLDER_ACTIONS.has(action) || action === 'signin');
  const block = needBlock ? await masterBlock(env) : null, holders = needBlock ? await loadPrivate(env, H.parsePrivate) : {};
  if (needBlock) { const bad = H.validateBlock(block); if (bad.length) return json(500, { ok: false, reason: 'ledger_block_invalid' }); }
  const holderView = async (addr) => {
    if (!holderOk) return null;
    const owned = await (deps.ownedSerials ?? ownedSerials)(env, addr);
    // D1 sources: a certificate owned on-chain without a row yet (minted since Hwi's last run) shows as the minimal row.
    const b = block.synth && owned ? { ...block, rows: [...block.rows, ...owned.filter((n) => !block.rows.some((r) => Number(r.serial) === n)).map(minimalRow)] } : block;
    return H.viewByAddress(b, holders, addr, owned);
  };

  if (action === 'challenge') {
    const nonce = await H.makeNonce(secret, now);
    if (b.kind === 'withdraw') {
      if (!holderOk) return json(503, { ok: false, reason: 'preview_only' });
      const s = await H.readSession(secret, bearer(request), now); if (!s) return json(401, { ok: false, reason: 'sign_in_again' });
      if (!H.ASSETS[b.asset] || !H.validPayoutAddress(b.asset, b.payoutAddress)) return json(400, { ok: false, reason: 'bad_payout' });
      return json(200, { ok: true, message: H.withdrawalMessage(host, nonce, { serial: Number(b.serial), asset: b.asset, payoutAddress: b.payoutAddress }) });
    }
    if (!H.normAddr(b.address)) return json(400, { ok: false, reason: 'bad_address' });
    return json(200, { ok: true, message: H.signInMessage(host, nonce, b.address), expires_in_s: H.NONCE_TTL_MS / 1000 });
  }
  if (action === 'signin') {
    const w = /^Wallet: (.+)$/m.exec(String(b.message || ''))?.[1];
    const v = await H.verifySigned(secret, host, b.message, b.signature, (n) => H.signInMessage(host, n, w), now);
    if (!v.ok) return json(401, { ok: false, reason: v.reason });
    const used = await H.consumeNonce(db, v.nonce, 'signin', now); if (used) return json(used === 'nonce_already_used' ? 409 : 503, { ok: false, reason: used });
    return json(200, { ok: true, session: await H.makeSession(secret, v.address, now), address: v.address, expires_in_s: H.SESSION_TTL_MS / 1000,
      access: await access(v.address), view: await holderView(v.address) });
  }
  if (action === 'cert-sales-status') {
    // Public: is buying open? Reads the Issuer's paused flag live (fails closed = paused).
    const t = certTarget(certNetwork(env)); if (!t) return json(503, { ok: false, reason: 'not_configured' });
    const paused = await (deps.issuerPaused ?? issuerPaused)(t, deps.client ?? new SuiGrpcClient({ network: t.network, baseUrl: t.fullnode }));
    const open = t.testnet ? !paused : !paused && mainnetSalesOpen(env);
    return json(200, { ok: true, network: t.network, paused, sales_open: open, message: open ? null : SALES_PAUSED });
  }
  if (action === 'token-view') {
    const view = await H.viewByToken(block, holders, b.serial, b.token);
    return view ? json(200, { ok: true, view }) : json(404, { ok: false, reason: 'link_invalid_or_revoked' });
  }
  const s = await H.readSession(secret, bearer(request), now);
  if (!s) return json(401, { ok: false, reason: 'sign_in_again' });
  if (action === 'access') return json(200, { ok: true, address: s.address, access: await access(s.address) });
  if (action === 'cert-buy-quote') {
    const a = await access(s.address);
    if (!a.eligible) return json(403, { ok: false, reason: 'not_eligible', access: a, explain: copy().notEligible });
    const t = certTarget(certNetwork(env)); if (!t) return json(503, { ok: false, reason: 'not_configured' });
    try { return json(200, { ok: true, chain: t.chain, ...(await (deps.certBuyQuote ?? certBuyQuote)({ address: s.address, env }, undefined, t)) }); }
    catch (e) { return json(400, { ok: false, reason: String(e.message || e).slice(0, 200) }); }
  }
  const view = await holderView(s.address);
  if (action === 'me') return json(200, { ok: true, address: s.address, view });
  if (action === 'withdraw') {
    const serial = Number(b.serial);
    if (!view.certificates.some((c) => c.serial === serial)) return json(403, { ok: false, reason: 'not_your_certificate' });
    const cert = view.certificates.find((c) => c.serial === serial);
    // SJ10: a recorded outcome (rejected / paid) releases the D1 lock; after a rejection the holder may ask again.
    if (H.OUTCOME_STATUSES.includes(cert.withdrawal_status)) await H.releasePending(db, serial);
    if (!['none', 'rejected'].includes(cert.withdrawal_status) || cert.status !== 'active') return json(409, { ok: false, reason: 'already_requested_or_not_active' });
    if (!H.ASSETS[b.asset] || !H.validPayoutAddress(b.asset, b.payoutAddress)) return json(400, { ok: false, reason: 'bad_payout' });
    const v = await H.verifySigned(secret, host, b.message, b.signature, (n) => H.withdrawalMessage(host, n, { serial, asset: b.asset, payoutAddress: b.payoutAddress }), now);
    if (!v.ok) return json(401, { ok: false, reason: v.reason });
    if (v.address !== H.normAddr(s.address)) return json(403, { ok: false, reason: 'signer_is_not_the_signed_in_wallet' });
    const used = await H.consumeNonce(db, v.nonce, 'withdraw', now);
    if (used) return json(used === 'nonce_already_used' ? 409 : 503, { ok: false, reason: used === 'nonce_already_used' ? 'request_already_used' : used });
    const rec = H.withdrawalRecord({ serial, asset: b.asset, payoutAddress: b.payoutAddress, address: v.address, message: b.message, signature: b.signature, now });
    const locked = await H.lockPending(db, serial, rec.request_id, now); if (locked) return json(409, { ok: false, reason: locked });
    const kv = env.SPICE_WITHDRAW_QUEUE_TESTNET;
    if (kv) await kv.put(`w:${rec.request_id}`, JSON.stringify(rec), { expirationTtl: 30 * 86400 });
    else if (usesD1(env)) await storeWithdrawal(env, certNetwork(env), rec, now);
    const stored = !!kv || usesD1(env);
    return json(200, { ok: true, queued: stored, request_id: rec.request_id, payout_deadline_pt: rec.payout_deadline_pt,
      note: isPreview(env) ? (stored ? 'Queued on the TESTNET preview queue. Nothing is paid on preview.' : 'Preview: signature verified and the request locked for this certificate, but no queue is bound, so nothing else was stored. Nothing is paid on preview.')
        : 'Request recorded. Now confirm it by email from the address on file to reserve@thespicemelange.org. Nothing is paid automatically.' });
  }
  if (action === 'redeem-quote') {
    // Withdrawal step 1 (terms v2026.10.10.3): on-chain request_redemption for the signed-in wallet's own certificate.
    const t = redeemTarget(env); if (!t) return json(503, { ok: false, reason: 'not_configured' });
    try { return json(200, { ok: true, ...(await (deps.certRedeemQuote ?? certRedeemQuote)({ address: s.address, serial: Number(b.serial), asset: b.asset }, t)) }); }
    catch (e) { return json(400, { ok: false, reason: String(e.message || e).slice(0, 200) }); }
  }
  if (action === 'wallet') return json(200, { ok: true, ...(await (deps.walletBalances ?? walletBalances)(s.address)) });
  if (action === 'trade-quote') {
    try { return json(200, { ok: true, ...(await (deps.tradeQuote ?? tradeQuote)({ address: s.address, pair: b.pair, side: b.side, amount: Number(b.amount), slippageBps: Number(b.slippageBps ?? TRADE_LIMITS.defaultBps) })) }); }
    catch (e) { return json(400, { ok: false, reason: String(e.message || e).slice(0, 200) }); }
  }
  return json(404, { ok: false, reason: 'unknown_action' });
}
