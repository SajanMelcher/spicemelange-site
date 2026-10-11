// Spice Certificate on-chain redemption request (terms v2026.10.10.3, "How to withdraw" step 1): builds an UNSIGNED
// `certificate::request_redemption(&Issuer, SpiceCertificate, u8, &Clock)` for the signed-in holder's own certificate,
// dry-runs it, and hands it to the wallet only if the dry-run passed. The wallet signs and executes; the holder pays gas.
// ONE config switch: SPICE_CERT_REDEEM_NETWORK ("testnet" default). "mainnet" works only once the mainnet ids land in the
// generated ids file (store-core/spice-cert-testnet.json "mainnet", from spice-certificates/deploy.mainnet.json via
// scripts/sync-spice-cert-ids.mjs); until then it refuses (not_configured). Never signs, never submits.
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { certTarget, certNetwork } from './spice-cert-net.js';

export const ASSET_CODE = Object.freeze({ USDC: 0, BTC: 1 }); // certificate.move ASSET_USDC / ASSET_BTC
const ACTIVE = 0; // certificate.move ACTIVE
export const redeemTarget = (env) => { const t = certTarget(certNetwork(env)); return t && { ...t, baseUrl: t.fullnode }; };
const big = (_, v) => (typeof v === 'bigint' ? v.toString() : v);

export async function certRedeemQuote({ address, serial, asset }, t, c = new SuiGrpcClient({ network: t.network, baseUrl: t.baseUrl })) {
  const base = { network: t.network, chain: t.chain, package_id: t.packageId, issuer_id: t.issuerId };
  if (!(asset in ASSET_CODE)) return { ...base, ready: false, reason: 'bad_asset', tx_json: null };
  let cert;
  try {
    const o = await c.core.listOwnedObjects({ owner: address, type: t.certificateType, limit: 50, include: { json: true } });
    cert = (o.objects || []).find((x) => Number((x.json ?? x.content?.json)?.serial) === Number(serial));
  } catch { return { ...base, ready: false, reason: 'read_failed', tx_json: null }; }
  if (!cert) return { ...base, ready: false, reason: 'certificate_not_in_this_wallet', tx_json: null,
    explain: `No on-chain certificate No. ${serial} from this contract is in the signed-in wallet.` };
  const j = cert.json ?? cert.content?.json;
  if (Number(j?.status) !== ACTIVE) return { ...base, ready: false, reason: 'not_active', tx_json: null, explain: 'This certificate already has a redemption request or is redeemed.' };
  const tx = new Transaction(); tx.setSender(address);
  tx.moveCall({ target: `${t.packageId}::certificate::request_redemption`,
    arguments: [tx.object(t.issuerId), tx.object(cert.objectId ?? cert.id), tx.pure.u8(ASSET_CODE[asset]), tx.object.clock()] });
  let dry;
  try {
    const r = await c.core.simulateTransaction({ transaction: tx, include: { effects: true } });
    dry = r.$kind === 'Transaction' ? { status: 'success' } : { status: 'failure', error: r.FailedTransaction?.status?.error?.message?.slice(0, 200) };
  } catch (e) { dry = { status: 'error', error: String(e.message || e).slice(0, 200) }; }
  const tx_json = dry.status === 'success' ? await tx.toJSON({ client: c }) : null;
  return JSON.parse(JSON.stringify({ ...base, ready: !!tx_json, serial: Number(serial), cert_id: cert.objectId ?? cert.id, dry_run: dry, tx_json }, big));
}
