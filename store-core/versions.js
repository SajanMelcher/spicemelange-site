// Public template versions (the remote-config pull). Built from templates.json; versions and
// changelog summaries only, never paid template content.
import T from './templates.json' with { type: 'json' };
export const TEMPLATES = T;
// Date versions: YYYY.MM.DD with an optional .N for a same-day re-release. Compare numerically part by
// part; a missing part counts as 0, so 2026.10.09.1 > 2026.10.09 and 2026.10.10 > 2026.10.09.9.
export const VERSION_RE = /^\d{4}\.\d{2}\.\d{2}(\.\d+)?$/;
export function compareVersions(a, b) {
  if (!VERSION_RE.test(a) || !VERSION_RE.test(b)) throw new Error(`bad version: ${a} / ${b}`);
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < 4; i++) { const d = (pa[i] ?? 0) - (pb[i] ?? 0); if (d) return Math.sign(d); }
  return 0;
}
// Single comparable integer for bots: YYYYMMDD * 1000 + N (2026.10.09 -> 20261009000, 2026.10.09.1 -> 20261009001).
export const versionKey = (v) => { const [y, m, d, n = 0] = v.split('.').map(Number); return (y * 10000 + m * 100 + d) * 1000 + n; };
const covers = (r, sku) => r.skus === 'all' || (Array.isArray(r.skus) && r.skus.includes(sku));
export function latestFor(sku) {
  return T.releases.find((r) => covers(r, sku)) ?? null; // releases are newest first
}
export function versionsDoc(site = 'https://thespicemelange.org') {
  const entry = (t) => {
    const r = latestFor(t.sku);
    const version = r?.version ?? T.current;
    return [t.sku, { name: t.name, title: t.title, version, versionKey: versionKey(version), released: r?.date ?? null, summary: r?.summary ?? '', ...(t.sha256 ? { sha256: t.sha256 } : {}) }];
  };
  return {
    schema: 'spicemelange.templates.versions/v1',
    current: T.current,
    updated: T.releases[0]?.date ?? null,
    versionRule: 'Versions are YYYY.MM.DD with an optional .N for a same-day re-release. Newer = larger versionKey (YYYYMMDD*1000+N); e.g. 2026.10.09.1 is newer than 2026.10.09.',
    sha256Note: 'sha256 is the SHA-256 of the ZIP the store currently serves for that slug; verify a re-download against it.',
    howToUpdate: `Re-download the latest at ${site}/store/download/ with your order ID and token. Always serves the current version.`,
    changelog: `${site}/templates/changelog/`,
    // Every update-checked product is listed under `templates` by slug (the packs' skills look there), seats first,
    // then the Dune Saga Collection and Leto's Secret Journals. `packs` repeats the non-seat products for older readers.
    templates: Object.fromEntries([...T.templates, ...T.packs].map(entry)),
    packs: Object.fromEntries(T.packs.map(entry)),
  };
}
