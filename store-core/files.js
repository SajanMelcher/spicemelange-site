// Private file lookup. Real product files go in the STORE_FILES KV namespace (or a private R2
// bucket), keyed by catalog `file`. NOTHING here is under public/. Until Sajan supplies files,
// a clearly labelled placeholder is returned.
import { bySku } from './catalog.js';
export async function loadFile(env, sku) {
  const p = bySku(sku);
  if (!p || p.comingSoon || !p.file) return null;
  const kv = env.STORE_FILES;
  if (kv) {
    const { value, metadata } = await kv.getWithMetadata(p.file, { type: 'arrayBuffer' });
    if (value) return { body: value, name: metadata?.name ?? `${p.sku}.zip`, type: metadata?.type ?? 'application/octet-stream' };
  }
  return {
    body: `PLACEHOLDER FILE for "${p.name}" (${p.sku}).\nThe real product file has not been uploaded yet.\nEducational material only. Not financial, investment, tax or legal advice.\n`,
    name: `${p.sku}-PLACEHOLDER.txt`,
    type: 'text/plain; charset=utf-8',
  };
}
