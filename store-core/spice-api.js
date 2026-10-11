// Spice Certificates holder API (TESTNET PREVIEW). One dispatcher used by functions/api/certificates/[action].js.
// Fails closed: refuses unless SUI_NETWORK=testnet AND SPICE_CERT_PREVIEW=1 AND a >=32-char SPICE_SESSION_SECRET exists.
import { json, readJson, sameOrigin } from './http.js';
import * as H from './spice-holder.js';
import SAMPLE from './spice-sample/master.sample.json' with { type: 'json' };
import { walletBalances } from './spice-wallet.js';
import { tradeQuote, TRADE_LIMITS } from './spice-trade.js';

const GQL_TESTNET = 'https://graphql.testnet.sui.io/graphql';

export function gate(env) {
  if (env?.SUI_NETWORK !== 'testnet' || env?.SPICE_CERT_PREVIEW !== '1') return 'preview_only';
  if (!H.requireSecret(env)) return 'not_configured';
  return null;
}
/** The master block. Preview: the bundled FAKE sample. (Prod would read Hwi's ledger/master.json block; gate 2.) */
export function masterBlock(env) { return SAMPLE.spice_certificates; }

async function ownedSerials(env, address, fetchImpl = fetch) {
  if (!env.SPICE_CERT_TYPE) return null; // testnet package not published yet -> private map (preview)
  const q = 'query($a:SuiAddress!,$t:String!){ address(address:$a){ objects(filter:{type:$t}, first:50){ nodes{ asMoveObject{ contents{ json } } } } } }';
  const r = await fetchImpl(GQL_TESTNET, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q, variables: { a: address, t: env.SPICE_CERT_TYPE } }) });
  const d = (await r.json()).data;
  return (d?.address?.objects?.nodes || []).map((n) => Number(n.asMoveObject?.contents?.json?.serial)).filter(Number.isFinite);
}
const bearer = (req) => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');

export async function handle(action, context, deps = {}) {
  const { request, env } = context;
  const now = deps.now ?? Date.now();
  const g = gate(env); if (g) return json(503, { ok: false, reason: g });
  if (request.method !== 'POST') return json(405, { ok: false, reason: 'method' });
  if (!sameOrigin(request)) return json(403, { ok: false, reason: 'bad_origin' });
  const secret = H.requireSecret(env), host = new URL(request.url).host;
  const b = (await readJson(request)) || {};
  const block = masterBlock(env), holders = H.parsePrivate(env);
  const bad = H.validateBlock(block); if (bad.length) return json(500, { ok: false, reason: 'ledger_block_invalid' });

  if (action === 'challenge') {
    const nonce = await H.makeNonce(secret, now);
    if (b.kind === 'withdraw') {
      const s = await H.readSession(secret, bearer(request), now); if (!s) return json(401, { ok: false, reason: 'sign_in_again' });
      if (!H.ASSETS[b.asset] || !H.validPayoutAddress(b.asset, b.payoutAddress)) return json(400, { ok: false, reason: 'bad_payout' });
      return json(200, { ok: true, message: H.withdrawalMessage(host, nonce, { serial: Number(b.serial), asset: b.asset, payoutAddress: b.payoutAddress }) });
    }
    return json(200, { ok: true, message: H.signInMessage(host, nonce), expires_in_s: H.NONCE_TTL_MS / 1000 });
  }
  if (action === 'signin') {
    const v = await H.verifySigned(secret, host, b.message, b.signature, (n) => H.signInMessage(host, n), now);
    if (!v.ok) return json(401, { ok: false, reason: v.reason });
    const owned = await (deps.ownedSerials ?? ownedSerials)(env, v.address);
    const view = H.viewByAddress(block, holders, v.address, owned);
    if (!view.certificates.length) return json(403, { ok: false, reason: 'no_certificate_in_this_wallet' });
    return json(200, { ok: true, session: await H.makeSession(secret, v.address, now), address: v.address, view });
  }
  if (action === 'token-view') {
    const view = await H.viewByToken(block, holders, b.serial, b.token);
    return view ? json(200, { ok: true, view }) : json(404, { ok: false, reason: 'link_invalid_or_revoked' });
  }
  const s = await H.readSession(secret, bearer(request), now);
  if (!s) return json(401, { ok: false, reason: 'sign_in_again' });
  const owned = await (deps.ownedSerials ?? ownedSerials)(env, s.address);
  const view = H.viewByAddress(block, holders, s.address, owned);
  if (action === 'me') return json(200, { ok: true, address: s.address, view });
  if (action === 'withdraw') {
    const serial = Number(b.serial);
    if (!view.certificates.some((c) => c.serial === serial)) return json(403, { ok: false, reason: 'not_your_certificate' });
    const cert = view.certificates.find((c) => c.serial === serial);
    if (cert.withdrawal_status !== 'none' || cert.status !== 'active') return json(409, { ok: false, reason: 'already_requested_or_not_active' });
    if (!H.ASSETS[b.asset] || !H.validPayoutAddress(b.asset, b.payoutAddress)) return json(400, { ok: false, reason: 'bad_payout' });
    const v = await H.verifySigned(secret, host, b.message, b.signature, (n) => H.withdrawalMessage(host, n, { serial, asset: b.asset, payoutAddress: b.payoutAddress }), now);
    if (!v.ok) return json(401, { ok: false, reason: v.reason });
    if (v.address !== H.normAddr(s.address)) return json(403, { ok: false, reason: 'signer_is_not_the_signed_in_wallet' });
    const kv0 = env.SPICE_WITHDRAW_QUEUE_TESTNET;
    if (kv0) { if (await kv0.get(`n:${v.nonce}`)) return json(409, { ok: false, reason: 'request_already_used' }); await kv0.put(`n:${v.nonce}`, '1', { expirationTtl: 900 }); }
    const rec = H.withdrawalRecord({ serial, asset: b.asset, payoutAddress: b.payoutAddress, address: v.address, message: b.message, signature: b.signature, now });
    const kv = env.SPICE_WITHDRAW_QUEUE_TESTNET;
    if (kv) await kv.put(`w:${rec.request_id}`, JSON.stringify(rec), { expirationTtl: 30 * 86400 });
    return json(200, { ok: true, queued: !!kv, request_id: rec.request_id, payout_deadline_pt: rec.payout_deadline_pt,
      note: kv ? 'Queued on the TESTNET preview queue. Nothing is paid on preview.' : 'Preview: signature verified, but no queue is bound, so nothing was stored. Nothing is paid on preview.' });
  }
  if (action === 'wallet') return json(200, { ok: true, ...(await (deps.walletBalances ?? walletBalances)(s.address)) });
  if (action === 'trade-quote') {
    try { return json(200, { ok: true, ...(await (deps.tradeQuote ?? tradeQuote)({ address: s.address, pair: b.pair, side: b.side, amount: Number(b.amount), slippageBps: Number(b.slippageBps ?? TRADE_LIMITS.defaultBps) })) }); }
    catch (e) { return json(400, { ok: false, reason: String(e.message || e).slice(0, 200) }); }
  }
  return json(404, { ok: false, reason: 'unknown_action' });
}
