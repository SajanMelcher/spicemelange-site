#!/usr/bin/env node
// Box-side writer for the holder records the site serves (D1, migrations/0012). Writes only through `wrangler d1 execute
// --remote` (the box's own wrangler login); the website never writes these tables. Values are validated before any SQL.
//   node scripts/spice-holder-sync.mjs push-ledger --env production|preview [--master <ledger/master.json>] [--private <holders.private.json>] [--network mainnet|testnet]
//       Hwi's spice_certificates block -> spice_holder_meta + spice_holder_rows (source 'ledger', replaces those serials);
//       holders.private.json -> spice_holders_private (replaced). Missing block = zero certificates (meta only).
//   node scripts/spice-holder-sync.mjs mint-row --env ... --network mainnet|testnet --serial N --owner 0x...
//       minimal row (principal 100.00, accrued 0, active) if no row exists yet (INSERT OR IGNORE: never overwrites a ledger row).
//   node scripts/spice-holder-sync.mjs follow --env ... --network ... --log <watcher payments.jsonl> [--package 0x...] [--once] [--interval 30]
//       tails the watcher log; for each "minted" / "skipped_atomic_purchase" record reads the CertificateMinted event of that tx
//       (holder + serial, from Sui GraphQL) and writes the minimal row. State: <log>.holder-rows.json (processed digests).
import { readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DB = { production: 'spicemelange-store-prod', preview: 'spicemelange-store-preview' };
const GQL = { mainnet: 'https://graphql.mainnet.sui.io/graphql', testnet: 'https://graphql.testnet.sui.io/graphql' };
const ADDR = /^0x[0-9a-f]{64}$/, REF = /^H-[A-Z0-9-]{3,32}$/, USD = /^[0-9]+\.[0-9]{2}$/, DATE = /^\d{4}-\d{2}-\d{2}$/, HASH = /^sha256:[0-9a-f]{64}$/;
const STATUS = ['active', 'withdrawal_requested', 'payout_pending', 'redeemed', 'burned'], WSTATUS = ['none', 'withdrawal_requested', 'payout_pending', 'paid', 'rejected'];
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
export const normAddr = (a) => { a = String(a || '').toLowerCase(); return /^0x[0-9a-f]{1,64}$/.test(a) ? '0x' + a.slice(2).padStart(64, '0') : null; };

export function validateLedgerRow(r) {
  const e = [];
  if (!Number.isInteger(r.serial) || r.serial < 1) e.push('serial');
  if (!REF.test(r.holder_ref || '')) e.push('holder_ref');
  if (!USD.test(r.principal_usd || '')) e.push('principal_usd');
  if (!Number.isInteger(r.accrued_sats) || r.accrued_sats < 0) e.push('accrued_sats');
  if (!USD.test(r.value_usd || '')) e.push('value_usd');
  if (!STATUS.includes(r.status)) e.push('status');
  if (!WSTATUS.includes(r.withdrawal_status)) e.push('withdrawal_status');
  if (r.token_hash !== null && !HASH.test(r.token_hash || '')) e.push('token_hash');
  for (const k of ['last_reserve_credit_pt', 'next_reserve_credit_pt']) if (r[k] != null && !DATE.test(r[k])) e.push(k);
  for (const k of ['display_name', 'holder_email', 'holder_sui_wallet', 'payout_address']) if (k in r) e.push(`PII field ${k}`);
  return e;
}
export function ledgerSql(block, priv, network, now = Date.now()) {
  if (!['mainnet', 'testnet'].includes(network)) throw new Error('network');
  const out = [];
  if (block) {
    if (block.schema_version !== 'spice_certificates.v1') throw new Error('schema_version must be spice_certificates.v1');
    if (block.network && block.network !== network) throw new Error(`block is for ${block.network}, not ${network}`);
    const header = Object.fromEntries(Object.entries(block).filter(([k]) => k !== 'rows'));
    out.push(`INSERT OR REPLACE INTO spice_holder_meta (network, header, updated_ms) VALUES (${q(network)}, ${q(JSON.stringify(header))}, ${now});`);
    for (const r of block.rows || []) {
      const bad = validateLedgerRow(r); if (bad.length) throw new Error(`row ${r.serial}: ${bad.join(', ')}`);
      out.push(`INSERT OR REPLACE INTO spice_holder_rows (network, serial, holder_ref, owner_address, principal_usd, accrued_sats, value_usd, status, withdrawal_status, withdrawal_request_id, token_hash, last_reserve_credit_pt, next_reserve_credit_pt, source, updated_ms) VALUES (${[network, r.serial, r.holder_ref, null, r.principal_usd, r.accrued_sats, r.value_usd, r.status, r.withdrawal_status, r.withdrawal_request_id ?? null, r.token_hash, r.last_reserve_credit_pt ?? null, r.next_reserve_credit_pt ?? null, 'ledger', now].map(q).join(', ')});`);
    }
  }
  if (priv) {
    out.push('DELETE FROM spice_holders_private;');
    for (const [ref, h] of Object.entries(priv.holders || {})) {
      if (!REF.test(ref) || typeof h.display_name !== 'string' || h.display_name.length > 64) throw new Error(`private ${ref}: bad entry`);
      const w = h.wallet ? normAddr(h.wallet) : null; if (h.wallet && !w) throw new Error(`private ${ref}: bad wallet`);
      out.push(`INSERT INTO spice_holders_private (holder_ref, display_name, wallet) VALUES (${q(ref)}, ${q(h.display_name)}, ${q(w)});`);
    }
  }
  return out;
}
export function mintRowSql(network, serial, owner, now = Date.now()) {
  const o = normAddr(owner);
  if (!['mainnet', 'testnet'].includes(network) || !Number.isInteger(serial) || serial < 1 || !o || !ADDR.test(o)) throw new Error('bad mint row');
  return `INSERT OR IGNORE INTO spice_holder_rows (network, serial, holder_ref, owner_address, principal_usd, accrued_sats, value_usd, status, withdrawal_status, token_hash, source, updated_ms) VALUES (${q(network)}, ${serial}, NULL, ${q(o)}, '100.00', 0, '0.00', 'active', 'none', NULL, 'watcher', ${now});`;
}
function d1(env, sql) {
  if (!DB[env]) throw new Error('--env production|preview');
  const dir = mkdtempSync(join(tmpdir(), 'spice-holder-'));  // 0700 dir; SQL may carry display names
  const f = join(dir, 'w.sql');
  try {
    writeFileSync(f, sql.join('\n') + '\n', { mode: 0o600 });
    const args = ['--yes', '-p', 'node@22', '-p', 'wrangler', '--', 'wrangler', 'd1', 'execute', DB[env], '--remote', '--file', f, ...(env === 'preview' ? ['--env', 'preview'] : [])];
    execFileSync('npx', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
async function mintedEvents(network, digest, pkg) {
  const query = 'query($d:String!){ transaction(digest:$d){ effects{ status events{ nodes{ contents{ type{ repr } json } } } } } }';
  const r = await fetch(GQL[network], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables: { d: digest } }) }).then((x) => x.json());
  const eff = r.data?.transaction?.effects; if (!eff || eff.status !== 'SUCCESS') return [];
  return eff.events.nodes.filter((n) => n.contents.type.repr.endsWith('::certificate::CertificateMinted') && (!pkg || normAddr(n.contents.type.repr.split('::')[0]) === normAddr(pkg)))
    .map((n) => ({ serial: Number(n.contents.json.serial), holder: normAddr(n.contents.json.holder) }));
}
export async function followOnce({ env, network, log, pkg, write = d1, events = mintedEvents }) {
  const statePath = log + '.holder-rows.json';
  const done = new Set(existsSync(statePath) ? JSON.parse(readFileSync(statePath, 'utf8')).done : []);
  const wrote = [];
  for (const line of (existsSync(log) ? readFileSync(log, 'utf8') : '').split('\n')) {
    if (!line.trim()) continue;
    const rec = JSON.parse(line);
    if (!['minted', 'skipped_atomic_purchase'].includes(rec.decision)) continue;
    const dig = rec.mint_digest || rec.payment_digest; if (!dig || done.has(dig)) continue;
    const ev = await events(network, dig, pkg);
    if (!ev.length) continue; // not indexed yet: retried next poll
    write(env, ev.map((e) => mintRowSql(network, e.serial, e.holder)));
    wrote.push(...ev); done.add(dig);
    writeFileSync(statePath, JSON.stringify({ done: [...done] }, null, 1));
  }
  return wrote;
}
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2], env = arg('env'), network = arg('network', 'mainnet');
  if (cmd === 'push-ledger') {
    const mp = arg('master', '/home/box/agent-data/shared/portfolio-desk/ledger/master.json');
    const block = JSON.parse(readFileSync(mp, 'utf8')).spice_certificates ?? null;
    const pp = arg('private'); const priv = pp ? JSON.parse(readFileSync(pp, 'utf8')) : null;
    const sql = ledgerSql(block ?? { schema_version: 'spice_certificates.v1', network, rows: [] }, priv, network);
    d1(env, sql); console.log(`push-ledger: ${env} ${network}: ${(block?.rows || []).length} ledger row(s)${priv ? `, ${Object.keys(priv.holders || {}).length} private holder(s)` : ''}${block ? '' : ' (no spice_certificates block yet = zero certificates)'}`);
  } else if (cmd === 'mint-row') {
    d1(env, [mintRowSql(network, Number(arg('serial')), arg('owner'))]); console.log('mint-row: written (or already present)');
  } else if (cmd === 'follow') {
    const log = arg('log'), pkg = arg('package'); if (!log) throw new Error('--log');
    do {
      const w = await followOnce({ env, network, log, pkg });
      for (const e of w) console.log(`follow: ${network} serial ${e.serial} -> minimal holder row (${e.holder.slice(0, 8)}…)`);
      if (process.argv.includes('--once')) break;
      await new Promise((r) => setTimeout(r, Number(arg('interval', 30)) * 1000));
    } while (true);
  } else { console.error('usage: push-ledger | mint-row | follow (see header)'); process.exit(2); }
}
