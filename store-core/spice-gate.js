// Spice Certificates buying gate (Ixians 10/10/2026 PT). Who may open the certificate buying page.
//
// ONE SWITCH: CERT_ELIGIBILITY below. It is read by the server gate (/api/certificates/*) AND by the static page copy
// (home, /certificates/, nav), so flipping it is a one-line change plus a deploy. No env override, so the copy and the gate
// can never disagree.
//   'collection_only' (CURRENT, Sajan 8:18 PM PT 10/10: "only The Secret Journals token holders can buy Spice Certificates")
//   'any_template'    (Sajan 8:16 PM PT, superseded at 8:18 PM PT; kept ready in case he changes his mind)
//
// What counts as a license token (both modes):
//   - a MAINNET object whose type is EXACTLY MAINNET_DESK_LICENSE_TYPE (the non-transferable, key-only DeskLicense), owned
//     by the signed-in address. The type is matched in the GraphQL filter AND re-checked on every returned node.
//   - the legacy transferable `license::License` NEVER counts (different type; it can be bought second-hand).
//   - store TEST licenses never count (store/test-orders.json rules: order_id SM-TEST-* or *SEALTEST*, sku test-*, or a
//     listed test license id).
//   - collection_only: template_id must be COLLECTION_SKU ('dune-saga-collection' = The Secret Journals). Past $250 Full
//     Desk orders are minted with template_id 'dune-saga-collection' (spice-license/mint_paid.py SERVED map), so they count.
//     A DeskLicense whose template_id is 'full-desk' is not expected to exist; it also counts (same remap, defensive).
//   - any_template: any non-test DeskLicense template_id.
// Fails closed: any read error = not eligible.
export const CERT_ELIGIBILITY = 'collection_only';
export const ELIGIBILITY_MODES = ['collection_only', 'any_template'];
export const COLLECTION_SKU = 'dune-saga-collection';
export const COLLECTION_ALIASES = ['full-desk']; // retired $250 Full Desk -> served as the collection (catalog.js upgradeTo)
export const COLLECTION_NAME = 'The Secret Journals';
export const MAINNET_DESK_LICENSE_TYPE = '0xef77702f895c8d3131a3579931d3f48eb8b2b98b95ea8446fba342b565bdffdd::desk_license::DeskLicense';
export const GQL_MAINNET = 'https://graphql.mainnet.sui.io/graphql';
export const TEST_LICENSE_IDS = [
  '0xd081fe8f9150139d0884c2e6edd4d15c0e87116f6545698b595b0a18af11ddf6', // SM-TEST-DESK-20261010 (DeskLicense, test-desk-20261010)
  '0xdd282ce7e3c0bf133c69ec6b5db1a6d0e8fb38b6f3480bf4743355d14bf2b2a0', // SM-MAINNET-SEALTEST-1 (legacy License; never counts anyway)
];

export const mode = (m = CERT_ELIGIBILITY) => (ELIGIBILITY_MODES.includes(m) ? m : 'collection_only');

/** Copy for each mode (pages render the CURRENT mode at build; both are kept here so the flip needs no copy work). */
export const GATE_COPY = {
  collection_only: {
    who: `holders of ${COLLECTION_NAME}`,
    short: `For holders of ${COLLECTION_NAME} only`,
    rule: `Spice Certificates can be bought only by wallets that hold the license token for ${COLLECTION_NAME}: the non-transferable license minted when you buy ${COLLECTION_NAME} (every template, now and later) from our store. A single-template license does not qualify; you keep your templates either way.`,
    notEligible: `This wallet does not hold the license token for ${COLLECTION_NAME}, so it can't buy Spice Certificates. Certificates are available only to holders of ${COLLECTION_NAME}.`,
    cta: { href: '/store/dune-saga-collection/', label: `Get ${COLLECTION_NAME} ($300)` },
  },
  any_template: {
    who: 'holders of any template license from our store',
    short: 'For template license holders only',
    rule: `Spice Certificates can be bought only by wallets that hold a non-transferable template license from our store (any single template or ${COLLECTION_NAME}).`,
    notEligible: 'This wallet does not hold a template license from our store, so it can\'t buy Spice Certificates.',
    cta: { href: '/store/', label: 'See the templates' },
  },
};
export const copy = (m) => GATE_COPY[mode(m)];

export const normAddr = (a) => { a = String(a || '').toLowerCase(); return /^0x[0-9a-f]{1,64}$/.test(a) ? '0x' + a.slice(2).padStart(64, '0') : null; };
const normType = (t) => String(t || '').replace(/^0x0*([0-9a-f]+)::/i, (_, h) => '0x' + h.toLowerCase().padStart(64, '0') + '::');

export function isTestLicense(id, json) {
  const o = String(json?.order_id || ''), s = String(json?.template_id || '');
  return TEST_LICENSE_IDS.includes(normAddr(id)) || /^SM-TEST-/i.test(o) || /SEALTEST/i.test(o) || /^test-/i.test(s);
}
/** Does one DeskLicense node qualify under `m`? Returns { counts, why }. Pure; unit tested. */
export function judge(node, m = CERT_ELIGIBILITY) {
  const type = node?.contents?.type?.repr, json = node?.contents?.json || {}, id = node?.address;
  if (normType(type) !== normType(MAINNET_DESK_LICENSE_TYPE)) return { counts: false, why: 'not_a_desk_license' };
  if (isTestLicense(id, json)) return { counts: false, why: 'test_license' };
  const sku = String(json.template_id || '');
  if (mode(m) === 'any_template') return sku ? { counts: true, why: 'template_license' } : { counts: false, why: 'no_sku' };
  if (sku === COLLECTION_SKU || COLLECTION_ALIASES.includes(sku)) return { counts: true, why: 'collection_license' };
  return { counts: false, why: 'single_template_license' };
}

const Q = 'query($a:SuiAddress!,$t:String!,$c:String){ address(address:$a){ objects(filter:{type:$t}, first:50, after:$c){ pageInfo{ hasNextPage endCursor } nodes{ address contents{ type{ repr } json } } } } }';
/** Read the address's mainnet DeskLicenses and decide. Server-side only (public Sui GraphQL); never trusted from the browser. */
export async function licenseAccess(address, { fetchImpl = fetch, m = CERT_ELIGIBILITY, gql = GQL_MAINNET } = {}) {
  const a = normAddr(address), md = mode(m);
  const base = { eligibility: md, network: 'mainnet', license_type: MAINNET_DESK_LICENSE_TYPE, collection_sku: COLLECTION_SKU };
  if (!a) return { ...base, eligible: false, licenses: [], error: 'bad_address' };
  const licenses = []; let cursor = null;
  try {
    for (let page = 0; page < 4; page++) {
      const r = await fetchImpl(gql, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: Q, variables: { a, t: MAINNET_DESK_LICENSE_TYPE, c: cursor } }) });
      if (!r.ok) throw new Error('graphql_http_' + r.status);
      const d = await r.json();
      if (d.errors?.length) throw new Error('graphql_error');
      const objs = d.data?.address?.objects;
      for (const n of objs?.nodes || []) { const j = judge(n, md); licenses.push({ id: n.address, sku: String(n.contents?.json?.template_id || ''), counts: j.counts, why: j.why }); }
      if (!objs?.pageInfo?.hasNextPage) break;
      cursor = objs.pageInfo.endCursor;
    }
  } catch (e) { return { ...base, eligible: false, licenses, error: 'license_check_failed' }; }
  return { ...base, eligible: licenses.some((l) => l.counts), licenses };
}
