// Spice Certificate purchase: TESTNET PREVIEW ONLY. No mainnet purchase path exists in this file or anywhere on the site
// (mainnet needs Siona SC1 + SC9 fixed and Sajan's yes). Builds an UNSIGNED `certificate::purchase<TUSDC>` transaction on
// Sui TESTNET for the signed-in wallet, dry-runs it, and hands it to the wallet (chain sui:testnet) only if the dry-run passed.
// Testnet tokens have no value; nothing real is bought. Ids: /workspace/ixians/spice-certificates/deploy.testnet.json.
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction, coinWithBalance } from '@mysten/sui/transactions';

export const TESTNET_CERT = Object.freeze({
  network: 'testnet', chain: 'sui:testnet',
  packageId: '0x8b5476e542f09aec64e0cd3b6239ab521d38bb044b3232b11bbf9b8f0693b75a',
  issuerId: '0x33bf1e62fed97b37592dc8b4ba13a2ee5e2c5bc1542803243c7ebaecb1508462',
  // purchase<T>(&mut Issuer, &DeskLicense, Coin<T>, &Clock): the TESTNET DeskLicense type the canonical package links to.
  deskLicenseType: '0xf561fbf70901f16effb816633f764fe3889f311b647e4de749a7a7727af43969::desk_license::DeskLicense',
  coinType: '0x8ff45fbd1d5432646e9ff85766f844f0b15ff12fdac9fe0e733ec2e4ffdeacf2::tusdc::TUSDC', // mock test USDC, no value
  price: 100_000_000n, // 100 tUSDC (6 dp)
});
export const BUY_NOTE = 'Testnet preview: no real purchases yet. Testnet tokens have no value and this certificate is not real.';
export const isMainnetTarget = (t) => t.packageId !== TESTNET_CERT.packageId || t.network !== 'testnet'; // guard for tests

export function client() { return new SuiGrpcClient({ network: 'testnet', baseUrl: 'https://fullnode.testnet.sui.io:443' }); }
const big = (_, v) => (typeof v === 'bigint' ? v.toString() : v);

/** Find the wallet's TESTNET DeskLicense + tUSDC, build purchase, dry-run. Never signs, never submits. */
export async function certBuyQuote({ address }, c = client()) {
  const base = { network: 'testnet', preview: true, note: BUY_NOTE, price_display: '100 tUSDC (testnet)', package_id: TESTNET_CERT.packageId, issuer_id: TESTNET_CERT.issuerId };
  let lic, bal;
  try {
    const o = await c.core.listOwnedObjects({ owner: address, type: TESTNET_CERT.deskLicenseType, limit: 1 });
    lic = (o.objects || [])[0];
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
