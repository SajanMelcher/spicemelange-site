// Verify Spice Certificate wallet-ownership proofs (box-side, independent of the server's check).
//   node scripts/wallet-proof-verify.mjs --from-kv [--address 0x…]   pull proofs from PREVIEW KV, verify, save box-only
//   node scripts/wallet-proof-verify.mjs --file proof.json [--address 0x…]   verify a saved record {message, signature}
// Saves verified records to /home/box/.ixians-secrets/wallet-proofs/<address>/ (dir 700, files 600). Never to shared memory/Walrus.
// zkLogin signatures are checked through Sui GraphQL (verifyZkLoginSignature) on the network named in the message.
// Exit 0 only if at least one proof verifies (and matches --address when given).
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { verifyProofSignature, field } from '../store-core/proof-core.js';
import { normAddr } from '../store-core/spice-holder.js';

const KV_PREVIEW = '20d393d0a08440a7b391b7b64e9aea4c';
const OUT = '/home/box/.ixians-secrets/wallet-proofs';
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const want = arg('--address') ? normAddr(arg('--address')) : null;
const HOST = arg('--host') || 'prove-wallet.spicemelange-site.pages.dev'; // V4-1: Domain must be the prove-wallet host
// Pinned wrangler (no npx at run time): /home/box/.ixians-tools/proof-fetch (package-lock.json, wrangler 4.149.0, node 22.23.3).
const WRANGLER = process.env.PROOF_FETCH_WRANGLER ?? '/home/box/.ixians-tools/proof-fetch/node_modules/.bin/wrangler';
const W = (args) => execFileSync(WRANGLER, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

let recs = [];
if (process.argv.includes('--from-kv')) {
  const keys = JSON.parse(W(['kv', 'key', 'list', '--namespace-id', KV_PREVIEW, '--prefix', 'walletproof:' + (want ?? ''), '--remote']));
  for (const k of keys) recs.push({ id: k.name, ...JSON.parse(W(['kv', 'key', 'get', k.name, '--namespace-id', KV_PREVIEW, '--remote', '--text'])) });
} else if (arg('--file')) recs = [JSON.parse(readFileSync(arg('--file'), 'utf8'))];
else { console.error('usage: --from-kv [--address 0x…] | --file proof.json [--address 0x…]'); process.exit(2); }

let good = 0;
for (const r of recs) {
  const v = await verifyProofSignature(r.message, r.signature);
  const nonce = String(field(r.message, 'Nonce') || '');
  const serverRec = !!r.server_verified_ms && r.id === `walletproof:${v.address}:${nonce.split('.')[0]}`;
  const match = (!want || v.address === want) && field(r.message, 'Domain') === HOST && serverRec;
  const line = { id: r.id ?? '(file)', address: v.address ?? normAddr(field(r.message, 'Wallet')), scheme: v.scheme, network: v.network,
    domain: field(r.message, 'Domain'), time: field(r.message, 'Time'), verified: v.ok && match, reason: v.ok ? (match ? 'ok' : (want && v.address !== want ? 'address_mismatch' : field(r.message, 'Domain') !== HOST ? 'domain_mismatch' : 'not_a_server_verified_record')) : v.reason };
  console.log(JSON.stringify(line));
  if (line.verified) {
    good++;
    const dir = `${OUT}/${v.address}`; mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(OUT, 0o700); chmodSync(dir, 0o700);
    const f = `${dir}/${String(field(r.message, 'Nonce')).split('.')[0]}.json`;
    writeFileSync(f, JSON.stringify({ ...r, box_verified_pt: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }) + ' PT', box_verify: line }, null, 2), { mode: 0o600 });
    console.log('saved', f);
  }
}
if (!recs.length) console.log('no proofs found' + (want ? ' for ' + want : ''));
process.exit(good ? 0 : 1);
