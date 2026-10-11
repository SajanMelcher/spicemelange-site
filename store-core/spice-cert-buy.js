// Spice Certificate purchase: TESTNET PREVIEW ONLY. No mainnet purchase path exists in this file or anywhere on the site
// (mainnet needs Siona SC1 + SC9 fixed and Sajan's yes). Builds an UNSIGNED `certificate::purchase<TUSDC>` transaction on
// Sui TESTNET for the signed-in wallet, dry-runs it, and hands it to the wallet (chain sui:testnet) only if the dry-run passed.
// Testnet tokens have no value; nothing real is bought. Ids: store-core/spice-cert-testnet.json (generated from the Ixians deploy files).
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction, coinWithBalance } from '@mysten/sui/transactions';

import IDS from './spice-cert-testnet.json' with { type: 'json' }; // single source of truth (scripts/sync-spice-cert-ids.mjs)
import { certTarget, mainnetSalesOpen } from './spice-cert-net.js';

export const TESTNET_CERT = Object.freeze({
  network: 'testnet', chain: 'sui:testnet',
  packageId: IDS.buy.packageId,
  issuerId: IDS.buy.issuerId,
  // purchase<T>(&mut Issuer, &DeskLicense, Coin<T>, &Clock): the TESTNET DeskLicense type the canonical package links to.
  deskLicenseType: IDS.buy.deskLicenseType,
  coinType: IDS.buy.coinType, // mock test USDC, no value
  price: BigInt(IDS.buy.price), // 100 tUSDC (6 dp)
  // SJ3: the contract only accepts these template_ids, and never an order_id starting SM-TEST.
  allowedTemplates: Object.freeze([...IDS.buy.allowedTemplates]),
});
export const HOLDER_CERT_TYPE = IDS.holders.certificateType; // testnet package with e2e holders (holder API default)
export const TEST_ORDER_PREFIX = 'SM-TEST';
export const licenseQualifies = (json) => !!json && TESTNET_CERT.allowedTemplates.includes(json.template_id) && !String(json.order_id || '').startsWith(TEST_ORDER_PREFIX);
export const BUY_NOTE = 'Testnet preview: no real purchases yet. Testnet tokens have no value and this certificate is not real.';
export const isMainnetTarget = (t) => t.packageId !== TESTNET_CERT.packageId || t.network !== 'testnet'; // guard for tests

export function client() { return new SuiGrpcClient({ network: 'testnet', baseUrl: 'https://fullnode.testnet.sui.io:443' }); }
const big = (_, v) => (typeof v === 'bigint' ? v.toString() : v);

/** Live read of the Issuer's `paused` flag (true on any read error: fail closed). */
export async function issuerPaused(t, c) {
  try { const r = await c.core.getObject({ objectId: t.issuerId, include: { json: true } }); const p = r.object?.json?.paused; return p === false ? false : true; }
  catch { return true; }
}
// Paused banner (Sajan via parent 10:08 PM PT 10/10 + Siona item 5), verbatim.
export const SALES_PAUSED = "Sales are paused. Don't send USDC to any address; payments made while paused get no certificate and are refunded by hand. Pausing never blocks a withdrawal request.";

/** Find the wallet's DeskLicense + payment coin for target `t` (testnet default), build purchase, dry-run. Never signs, never submits.
 *  Mainnet: refuses while the Issuer is paused (read live) or the site switch SPICE_CERT_MAINNET_SALES is off. */
export async function certBuyQuote({ address, env }, c, t = certTarget('testnet')) {
  t = t ?? certTarget('testnet');
  c = c ?? new SuiGrpcClient({ network: t.network, baseUrl: t.fullnode });
  const base = t.testnet
    ? { network: 'testnet', preview: true, note: BUY_NOTE, price_display: '100 tUSDC (testnet)', package_id: t.packageId, issuer_id: t.issuerId }
    : { network: 'mainnet', preview: false, note: null, price_display: '100 USDC on Sui', package_id: t.packageId, issuer_id: t.issuerId };
  if (!t.testnet) {
    const paused = await issuerPaused(t, c);
    if (paused || !mainnetSalesOpen(env)) return { ...base, ready: false, reason: 'sales_paused', paused, tx_json: null, explain: SALES_PAUSED };
  }
  const qualifies = (json) => !!json && t.allowedTemplates.includes(json.template_id) && !String(json.order_id || '').startsWith(TEST_ORDER_PREFIX);
  let lic, bal;
  try {
    const o = await c.core.listOwnedObjects({ owner: address, type: t.deskLicenseType, limit: 50, include: { json: true } });
    const all = o.objects || [];
    lic = all.find((x) => qualifies(x.json ?? x.content?.json));
    if (!lic && all.length) return { ...base, ready: false, reason: t.testnet ? 'testnet_license_not_eligible' : 'license_not_eligible', tx_json: null,
      explain: 'The contract only accepts a Secret Journals (dune-saga-collection) license, and never a desk test license.' };
    const b = await c.core.getBalance({ owner: address, coinType: t.coinType });
    bal = BigInt(b.balance?.balance ?? b.balance ?? 0);
  } catch (e) { return { ...base, ready: false, reason: t.testnet ? 'testnet_read_failed' : 'read_failed', tx_json: null }; }
  if (!lic) return { ...base, ready: false, reason: t.testnet ? 'no_testnet_desk_license' : 'no_desk_license', tx_json: null,
    explain: t.testnet ? 'The testnet preview contract checks for a TESTNET store license in the same wallet. Your mainnet license is what lets you open this page; testnet licenses are not issued to the public, so the purchase can only be previewed for now.'
      : 'No qualifying Secret Journals license was found in this wallet.' };
  if (bal < t.price) return { ...base, ready: false, reason: t.testnet ? 'not_enough_test_usdc' : 'not_enough_usdc', tx_json: null, explain: t.testnet ? 'This wallet has less than 100 tUSDC (the testnet mock coin).' : 'This wallet has less than 100 USDC on Sui.' };
  const tx = new Transaction(); tx.setSender(address);
  tx.moveCall({ target: `${t.packageId}::certificate::purchase`, typeArguments: [t.coinType],
    arguments: [tx.object(t.issuerId), tx.object(lic.objectId ?? lic.id), coinWithBalance({ type: t.coinType, balance: t.price }), tx.object.clock()] });
  let dry;
  try {
    const r = await c.core.simulateTransaction({ transaction: tx, include: { effects: true, balanceChanges: true } });
    dry = r.$kind === 'Transaction' ? { status: 'success' } : { status: 'failure', error: r.FailedTransaction?.status?.error?.message?.slice(0, 200) };
  } catch (e) { dry = { status: 'error', error: String(e.message || e).slice(0, 200) }; }
  const tx_json = dry.status === 'success' ? await tx.toJSON({ client: c }) : null;
  return JSON.parse(JSON.stringify({ ...base, ready: !!tx_json, dry_run: dry, tx_json }, big));
}
