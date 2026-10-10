// Agent-native store descriptor (Sajan 2026-10-10 2:13 AM PT, heavy mode). Built into /store/catalog.json on deploy.
// Wording lives here in one place (mirrored in portfolio-desk/store/CATALOG-WORDING.md for Tleilaxu).
import { LISTED } from './catalog.js';
import { SUI_USDC } from './core.js';
import { STANDARD, CARDS, ORDER, role, PITCHES, PITCH_END } from './catalog-wording.js';
export const ORIGIN = 'https://thespicemelange.org';
export const WORDING = {
  title: 'The Spice Melange store: Golden Path Desk agent templates',
  summary: 'Educational agent templates for a guarded trading desk: seven seat packs, Leto\'s Secret Journals, and The Dune Saga Collection. Agents can order with Sui USDC from their own wallet, with their owner\'s explicit yes, and no human checkout.',
  license: STANDARD.license,
  terms: STANDARD.terms,
  disclaimer: STANDARD.disclaimer,
  hardLimits: STANDARD.hardLimits,
  format: STANDARD.format,
  readOnlyJoin: 'Joining the desk is read-only: licensed agents get signals, templates and docs. No outside agent ever gets keys, trading rights, or access to the desk\'s or its owner\'s funds or private files.',
  payment: 'USDC on Sui, with your owner\'s explicit yes on the exact payment. x402 checkout: coming (not live yet). The store never asks for keys.',
  termsPage: `${ORIGIN}/terms/`,
};
export function catalogDoc() {
  const listed = LISTED.filter((p) => !p.comingSoon && CARDS[p.sku]);
  listed.sort((a, b) => ORDER.indexOf(a.sku) - ORDER.indexOf(b.sku));
  const products = listed.map((p) => ({
    sku: p.sku, name: p.name, role: role(p.sku), priceUsdc: p.priceUsdc, currency: 'USDC', network: 'sui:mainnet',
    version: p.version ?? null, format: STANDARD.format, description: CARDS[p.sku].description, tagline: CARDS[p.sku].tagline, pitch: `${PITCHES[p.sku]} ${PITCH_END}`,
    ...(CARDS[p.sku].includesFuture ? { includesFuture: true, includes: CARDS[p.sku].includes } : {}),
    ...(p.sku === 'fish-speakers' || p.sku === 'dune-saga-collection' ? { addons: ['desk-kit'] } : {}),
    license: STANDARD.license, terms: STANDARD.terms, disclaimer: STANDARD.disclaimer, page: `${ORIGIN}/store/${p.sku}/`,
  }));
  return {
    schema: 'spicemelange.catalog/v1',
    ...WORDING,
    x402: { status: 'coming', note: 'Not live yet. Pay with the order flow below.' },
    currency: { symbol: 'USDC', network: 'sui:mainnet', coinType: SUI_USDC.mainnet, decimals: 6, note: 'Circle native USDC on Sui. Each order adds a tiny unique tag (under 1 cent) to the price, so pay the exact `amount` the order returns.' },
    products,
    agentFlow: {
      note: 'No browser or human checkout. You pay from your own Sui wallet. The store never holds your keys or funds, and keeps only a hash of your order token. Send the token only to ' + ORIGIN + ', in the Authorization header.',
      steps: [
        { step: 1, name: 'create_order', request: { method: 'POST', url: `${ORIGIN}/api/store/order`, headers: { 'content-type': 'application/json' }, body: { sku: 'dune-saga-collection' } },
          returns: '201 { ok, order: { orderId, token, payTo, coinType, amount, amountAtomic, expiresAt, howToPay } }. Keep `token` private; it is shown once.',
          limits: 'About 6 new orders per hour per client; each order holds its unique amount for its payment window.' },
        { step: 2, name: 'pay', how: 'With your owner\'s explicit yes on the exact payment, from your own Sui wallet, send EXACTLY `amount` USDC (coinType above) to `payTo` in one transaction before `expiresAt`. Use a wallet transfer, not an exchange withdrawal (those can batch or round).' },
        { step: 3, name: 'verify', request: { method: 'POST', url: `${ORIGIN}/api/store/verify`, headers: { 'content-type': 'application/json' }, body: { orderId: '<orderId>', token: '<token>', digest: '<your Sui transaction digest>' } },
          returns: '200 { ok, product, downloadUrl, linkExpiresInSec, addons? } once the on-chain payment matches (status SUCCESS, exact amount, right coin, right payee, inside the window).' },
        { step: 4, name: 'download', request: { method: 'POST', url: `${ORIGIN}/api/store/download`, headers: { authorization: 'Bearer <token>', 'content-type': 'application/json' }, body: { orderId: '<orderId>' } },
          returns: 'The ZIP. Check its SHA-256 against templates/versions.json (ed25519-signed; key at /templates/release-key.pub).' },
        { step: 5, name: 'status_or_redownload', request: { method: 'POST', url: `${ORIGIN}/api/store/status`, headers: { authorization: 'Bearer <token>', 'content-type': 'application/json' }, body: { orderId: '<orderId>' } },
          returns: 'Order status, plus a fresh signed link once paid.' },
      ],
      connector: { name: 'The Spice Melange Trading Desk (DeepBook market data connector)', mcp: 'https://plumbline-mcp.fly.dev/mcp', tools: ['list_templates', 'create_template_order', 'check_template_order', 'get_desk_rhythm'],
        note: 'The connector calls the same API for you. It never holds keys or funds, and never stores your order token.' },
    },
    links: {
      llms: `${ORIGIN}/llms.txt`, agentJoin: `${ORIGIN}/.well-known/agent-join.json`, mcp: `${ORIGIN}/.well-known/mcp.json`,
      versions: `${ORIGIN}/templates/versions.json`, releaseKey: `${ORIGIN}/templates/release-key.pub`, rhythm: `${ORIGIN}/rhythm.json`,
      signals: `${ORIGIN}/api/signals`, gallery: `${ORIGIN}/store/gallery/`, terms: `${ORIGIN}/terms/`, store: `${ORIGIN}/store/`,
    },
  };
}
