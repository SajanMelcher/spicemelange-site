// Spice Certificate purchase: TESTNET PREVIEW ONLY. No mainnet purchase path exists in this file or anywhere on the site
// (mainnet needs Siona SC1 + SC9 fixed and Sajan's yes). Builds an UNSIGNED `certificate::purchase<TUSDC>` transaction on
// Sui TESTNET for the signed-in wallet, dry-runs it, and hands it to the wallet (chain sui:testnet) only if the dry-run passed.
// Testnet tokens have no value; nothing real is bought. Ids: store-core/spice-cert-testnet.json (generated from the Ixians deploy files).
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction, coinWithBalance } from '@mysten/sui/transactions';

import IDS from './spice-cert-testnet.json' with { type: 'json' }; // single source of truth (scripts/sync-spice-cert-ids.mjs)

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

/** Find the wallet's TESTNET DeskLicense + tUSDC, build purchase, dry-run. Never signs, never submits. */
export async function certBuyQuote({ address }, c = client()) {
  const base = { network: 'testnet', preview: true, note: BUY_NOTE, price_display: '100 tUSDC (testnet)', package_id: TESTNET_CERT.packageId, issuer_id: TESTNET_CERT.issuerId };
  let lic, bal;
  try {
    const o = await c.core.listOwnedObjects({ owner: address, type: TESTNET_CERT.deskLicenseType, limit: 50, include: { json: true } });
    const all = o.objects || [];
    lic = all.find((x) => licenseQualifies(x.json ?? x.content?.json));
    if (!lic && all.length) return { ...base, ready: false, reason: 'testnet_license_not_eligible', tx_json: null,
      explain: 'The contract only accepts a Secret Journals (dune-saga-collection) license, and never a desk test license.' };
    const b = await c.core.getBalance({ owner: address, coinType: TESTNET_CERT.coinType });
    bal = BigInt(b.balance?.balance ?? b.balance ?? 0);
  } catch (e) { return { ...base, ready: false, reason: 'testnet_read_failed', tx_json: null }; }
  if (!lic) return { ...base, ready: false, reason: 'no_testnet_desk_license', tx_json: null,
    explain: 'The testnet preview contract checks for a TESTNET store license in the same wallet. Your mainnet license is what lets you open this page; testnet licenses are not issued to the public, so the purchase can only be previewed for now.' };
  if (bal < TESTNET_CERT.price) return { ...base, ready: false, reason: 'not_enough_test_usdc', tx_json: null, explain: 'This wallet has less than 100 tUSDC (the testnet mock coin).' };
  const tx = new Transaction(); tx.setSender(address);
  tx.moveCall({ target: `${TESTNET_CERT.packageId}::certificate::purchase`, typeArguments: [TESTNET_CERT.coinType],
    arguments: [tx.object(TESTNET_CERT.issuerId), tx.object(lic.objectId ?? lic.id), coinWithBalance({ type: TESTNET_CERT.coinType, balance: TESTNET_CERT.price }), tx.object.clock()] });
  let dry;
  try {
    const r = await c.core.simulateTransaction({ transaction: tx, include: { effects: true, balanceChanges: true } });
    dry = r.$kind === 'Transaction' ? { status: 'success' } : { status: 'failure', error: r.FailedTransaction?.status?.error?.message?.slice(0, 200) };
  } catch (e) { dry = { status: 'error', error: String(e.message || e).slice(0, 200) }; }
  const tx_json = dry.status === 'success' ? await tx.toJSON({ client: c }) : null;
  return JSON.parse(JSON.stringify({ ...base, ready: !!tx_json, dry_run: dry, tx_json }, big));
}
