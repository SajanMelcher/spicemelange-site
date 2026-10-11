// Holder "Wallet" panel (read-only): the signed-in holder's OWN balances on Sui TESTNET, read server-side from public
// Sui GraphQL with src/lib/sui-read.js (same reader as /wallet/). USD = DeepBook v3 MAINNET mid of the matching USDC
// pair, shown as a reference only: testnet tokens have no value, and testnet DeepBook USDC books are empty.
import { fetchBalances, fetchMarkets, normType, USDC } from '../src/lib/sui-read.js';

export const GQL_TESTNET = 'https://graphql.testnet.sui.io/graphql';
// testnet type -> { sym, mainnet type used for the reference price }
export const TESTNET_TOKENS = {
  '0x2::sui::SUI': { sym: 'SUI', ref: '0x2::sui::SUI' },
  '0x36dbef866a1d62bf7328989a10fb2f07d769f4ee587c0de4a0a256e57e0a58a8::deep::DEEP': { sym: 'DEEP', ref: '0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP' },
  '0x9ef7676a9f81937a52ae4b2af8d511a28a0b080477c0c2db40b0ab8882240d76::wal::WAL': { sym: 'WAL', ref: '0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL' },
  '0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDC::DBUSDC': { sym: 'DBUSDC (testnet USDC)', ref: USDC },
  '0xf7152c05930480cd740d7311b5b8b45c6f488e3a53a11c3f74a6fac36a52e0d7::DBUSDT::DBUSDT': { sym: 'DBUSDT', ref: USDC },
  '0x6502dae813dbe5e42643c119a6450a518481f03063febc7e20238e43b6ea9e86::dbtc::DBTC': { sym: 'DBTC (testnet BTC)', ref: '0x876a4b7bce8aeaef60464c11f4026903e9afacab79b9b142686158aa86560b50::xbtc::XBTC' },
};
export const MAINNET_ONLY = ['USDC', 'NS', 'IKA', 'XBTC'];

/** testnet-type -> {usd, src} reference prices from mainnet px (pure; unit tested). */
export function referencePrices(mainPx) {
  const out = {};
  for (const [t, v] of Object.entries(TESTNET_TOKENS)) {
    const p = mainPx[normType(v.ref)];
    if (p) out[normType(t)] = { usd: p.usd, src: `reference: ${p.src} (mainnet); testnet token has no value` };
  }
  return out;
}
export async function walletBalances(address, deps = {}) {
  const mk = await (deps.fetchMarkets ?? fetchMarkets)();
  const px = referencePrices(mk.px);
  const b = await (deps.fetchBalances ?? fetchBalances)(address, px, {}, GQL_TESTNET);
  return { network: 'testnet', address, coins: b.coins.map((c) => ({ ...c, symbol: TESTNET_TOKENS[Object.keys(TESTNET_TOKENS).find((t) => normType(t) === c.type)]?.sym || c.symbol })),
    reference_usd: b.usd, checkpoint: b.checkpoint, mainnet_only: MAINNET_ONLY, price_note: 'USD is a mainnet DeepBook mid reference; testnet tokens have no value.' };
}
