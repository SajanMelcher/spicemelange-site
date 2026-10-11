// ONE network switch for the Spice Certificate contract the site talks to (buy page, holder ownership reads, redemption
// request): SPICE_CERT_REDEEM_NETWORK = "testnet" | "mainnet" (wrangler.toml; read at BUILD time by deploy.sh and at RUN time
// by /api/certificates/*). Ids come only from the generated file store-core/spice-cert-testnet.json (scripts/sync-spice-cert-ids.mjs):
// testnet = its "buy" section, mainnet = its "mainnet" section (from spice-certificates/deploy.mainnet.json). Mainnet without
// synced ids fails closed (null at run time; the build throws).
import IDS from './spice-cert-testnet.json' with { type: 'json' };
export const certNetwork = (env) => String(env?.SPICE_CERT_REDEEM_NETWORK ?? 'testnet');
const NETS = {
  testnet: { graphql: 'https://graphql.testnet.sui.io/graphql', fullnode: 'https://fullnode.testnet.sui.io:443' },
  mainnet: { graphql: 'https://graphql.mainnet.sui.io/graphql', fullnode: 'https://fullnode.mainnet.sui.io:443' },
};
export function certTarget(net) {
  const src = net === 'testnet' ? IDS.buy : net === 'mainnet' ? IDS.mainnet : null;
  if (!src?.packageId || !src?.issuerId) return null;
  return Object.freeze({ network: net, chain: `sui:${net}`, ...NETS[net], packageId: src.packageId, issuerId: src.issuerId,
    certificateType: src.certificateType, deskLicenseType: src.deskLicenseType, coinType: src.coinType, price: BigInt(src.price ?? 0),
    allowedTemplates: Object.freeze([...(src.allowedTemplates ?? ['dune-saga-collection'])]), testnet: net === 'testnet' });
}
const BUILD_ENV = typeof process !== 'undefined' && process?.env ? process.env : {};
export const CERT_NETWORK_AT_BUILD = certNetwork(BUILD_ENV);
export const CERT_TARGET_AT_BUILD = certTarget(CERT_NETWORK_AT_BUILD);
// Mainnet purchases: the Issuer's on-chain `paused` flag (read live) must be false AND this site switch must be "1".
// "0" (default) keeps the buy page on "sales are paused" even after an on-chain unpause, until the site is deliberately opened.
export const mainnetSalesOpen = (env) => String(env?.SPICE_CERT_MAINNET_SALES ?? '0') === '1';
