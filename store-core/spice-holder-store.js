// Holder records for /api/certificates/*. SPICE_HOLDER_SOURCE picks where the master block comes from:
//   "sample"    (default): the bundled FAKE sample (preview tests)
//   "d1"        : D1 tables from migrations/0012 (production): Hwi's ledger rows + watcher minimal rows, for one network
//   "d1+sample" : both (preview: sample rows for review + real testnet mints from the watcher)
// Box-side writers: scripts/spice-holder-sync.mjs (push-ledger / mint-row / follow). Never written from the web.
import SAMPLE from './spice-sample/master.sample.json' with { type: 'json' };
export const holderSource = (env) => String(env?.SPICE_HOLDER_SOURCE ?? 'sample');
const usesD1 = (env) => holderSource(env).startsWith('d1');
const ROW_COLS = ['serial', 'holder_ref', 'principal_usd', 'accrued_sats', 'value_usd', 'last_reserve_credit_pt', 'next_reserve_credit_pt', 'status', 'withdrawal_status', 'withdrawal_request_id', 'token_hash'];
export const EMPTY_HEADER = (network) => ({ schema_version: 'spice_certificates.v1', network, as_of: null, btc_price_usd: null, price_source: null, rows: [] });

/** The master block for `network`: { ...header, rows, network, minimal_ok } */
export async function loadBlock(env, network) {
  const src = holderSource(env);
  const sample = src === 'sample' || src === 'd1+sample' ? SAMPLE.spice_certificates : null;
  if (!usesD1(env)) return { ...sample, network: sample.network ?? 'testnet', synth: false };
  const db = env.STORE_DB;
  const meta = await db.prepare('SELECT header FROM spice_holder_meta WHERE network = ?').bind(network).first();
  const header = meta ? { ...EMPTY_HEADER(network), ...JSON.parse(meta.header) } : EMPTY_HEADER(network);
  const res = await db.prepare(`SELECT ${ROW_COLS.join(', ')} FROM spice_holder_rows WHERE network = ? ORDER BY serial`).bind(network).all();
  const rows = (res.results || []).map((r) => ({ ...r, serial: Number(r.serial), accrued_sats: Number(r.accrued_sats) }));
  // d1+sample (preview): real testnet rows from D1 win over FAKE sample rows with the same serial.
  const all = sample ? [...sample.rows.filter((x) => !rows.some((r) => r.serial === x.serial)), ...rows].sort((x, y) => x.serial - y.serial) : rows;
  return { ...(sample ? { ...sample } : header), network, rows: all, synth: true };
}
export async function loadPrivate(env, parseEnv) {
  const fromEnv = parseEnv(env);
  if (!usesD1(env)) return fromEnv;
  const res = await env.STORE_DB.prepare('SELECT holder_ref, display_name, wallet FROM spice_holders_private').all();
  const out = { ...fromEnv };
  for (const r of res.results || []) out[r.holder_ref] = { display_name: r.display_name, ...(r.wallet ? { wallet: r.wallet } : {}) };
  return out;
}
/** A certificate the wallet owns on-chain but that has no row yet (minted after Hwi's last run): show the minimal row. */
export const minimalRow = (serial) => ({ serial: Number(serial), holder_ref: null, principal_usd: '100.00', accrued_sats: 0, value_usd: '0.00',
  last_reserve_credit_pt: null, next_reserve_credit_pt: null, status: 'active', withdrawal_status: 'none', token_hash: null, minimal: true });
export async function storeWithdrawal(env, network, rec, now) {
  await env.STORE_DB.prepare('INSERT INTO spice_withdraw_requests (request_id, network, serial, record, created_ms) VALUES (?, ?, ?, ?, ?)')
    .bind(rec.request_id, network, Number(rec.serial), JSON.stringify(rec), now).run();
}
export { usesD1 };
