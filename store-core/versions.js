// Public template versions (the remote-config pull). Built from templates.json; versions and
// changelog summaries only, never paid template content.
import T from './templates.json' with { type: 'json' };
export const TEMPLATES = T;
const covers = (r, sku) => r.skus === 'all' || (Array.isArray(r.skus) && r.skus.includes(sku));
export function latestFor(sku) {
  return T.releases.find((r) => covers(r, sku)) ?? null; // releases are newest first
}
export function versionsDoc(site = 'https://thespicemelange.org') {
  const entry = (t) => {
    const r = latestFor(t.sku);
    return [t.sku, { name: t.name, title: t.title, version: r?.version ?? T.current, released: r?.date ?? null, summary: r?.summary ?? '' }];
  };
  return {
    schema: 'spicemelange.templates.versions/v1',
    current: T.current,
    updated: T.releases[0]?.date ?? null,
    howToUpdate: `Re-download the latest at ${site}/store/download/ with your order ID and token. Always serves the current version.`,
    changelog: `${site}/templates/changelog/`,
    templates: Object.fromEntries(T.templates.map(entry)),
    packs: Object.fromEntries(T.packs.map(entry)),
  };
}
