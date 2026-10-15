/**
 * The Secret Journals holder check (mainnet, public Sui GraphQL). Same rule as the site's store-core/spice-gate.js
 * (collection_only): the address must OWN a non-test DeskLicense whose template_id is 'dune-saga-collection'.
 * Note: an address is public, so this proves holding, not control. Holder tools are read-only education, so that is acceptable;
 * a signed-challenge upgrade is possible later if any holder perk ever needs proof of control.
 */
export const COLLECTION_NAME = "The Secret Journals";
export const COLLECTION_SKU = "dune-saga-collection";
export const DESK_LICENSE_TYPE = "0xef77702f895c8d3131a3579931d3f48eb8b2b98b95ea8446fba342b565bdffdd::desk_license::DeskLicense";
const ALIASES = ["full-desk"];
const TEST_IDS = ["0xd081fe8f9150139d0884c2e6edd4d15c0e87116f6545698b595b0a18af11ddf6", "0xdd282ce7e3c0bf133c69ec6b5db1a6d0e8fb38b6f3480bf4743355d14bf2b2a0"];
const GQL = (globalThis as any).process?.env?.PLUMBLINE_GRAPHQL_URL || "https://graphql.mainnet.sui.io/graphql";
const norm = (a: string) => "0x" + a.toLowerCase().replace(/^0x/, "").padStart(64, "0");
const normType = (t: string) => String(t || "").replace(/^0x0*([0-9a-f]+)::/i, (_, h) => "0x" + h.toLowerCase().padStart(64, "0") + "::");

export function judge(n: any): boolean {
  const j = n?.contents?.json ?? {};
  if (normType(n?.contents?.type?.repr) !== normType(DESK_LICENSE_TYPE)) return false;
  if (TEST_IDS.includes(norm(String(n?.address ?? ""))) || /^SM-TEST-|SEALTEST/i.test(String(j.order_id ?? "")) || /^test-/i.test(String(j.template_id ?? ""))) return false;
  return j.template_id === COLLECTION_SKU || ALIASES.includes(j.template_id);
}

const Q = "query($a:SuiAddress!,$t:String!){ address(address:$a){ objects(filter:{type:$t}, first:50){ nodes{ address contents{ type{ repr } json } } } } }";
const cache = new Map<string, { at: number; v: boolean }>();
export async function isHolder(address: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const a = norm(address); const c = cache.get(a);
  if (c && Date.now() - c.at < 5 * 60_000) return c.v;
  const r = await fetchImpl(GQL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: Q, variables: { a, t: DESK_LICENSE_TYPE } }) });
  if (!r.ok) throw new Error(`holder check failed: graphql http ${r.status}`);
  const d: any = await r.json();
  if (d.errors?.length) throw new Error("holder check failed: graphql error");
  const v = (d.data?.address?.objects?.nodes ?? []).some(judge);
  cache.set(a, { at: Date.now(), v });
  return v;
}
