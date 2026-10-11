// E2E helper (testnet only): build an AdminCap tx with EXACTLY the admin page's server builder (store-core/admin-actions.js),
// then sign it with a box testnet key through `sui keytool sign` (as the wallet would) and execute. Prints one JSON line.
// usage: node scripts/admin-page-tx.mjs <keystore> <client.yaml> '<request json>'
import { adminTx } from '../store-core/admin-actions.js';
import { Transaction } from '@mysten/sui/transactions';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { toBase64 } from '@mysten/sui/utils';
import { execFileSync } from 'node:child_process';
const [ks, cfg, reqJson] = process.argv.slice(2);
const req = JSON.parse(reqJson);
if (req.network !== 'testnet') { console.log(JSON.stringify({ ok: false, reason: 'testnet only' })); process.exit(2); }
const c = new SuiGrpcClient({ network: 'testnet', baseUrl: 'https://fullnode.testnet.sui.io:443' });
const r = await adminTx(req, c);
if (!r.ok || !r.ready) { console.log(JSON.stringify({ ok: false, reason: r.reason, dry_run: r.dry_run, target: r.target })); process.exit(1); }
const bytes = toBase64(await Transaction.from(r.tx_json).build({ client: c }));
const sig = JSON.parse(execFileSync('sui', ['keytool', '--keystore-path', ks, 'sign', '--address', req.sender, '--data', bytes, '--json'], { encoding: 'utf8' })).suiSignature;
const out = execFileSync('sui', ['client', '--client.config', cfg, 'execute-signed-tx', '--tx-bytes', bytes, '--signatures', sig, '--json'], { encoding: 'utf8' });
const d = JSON.parse(out.slice(out.indexOf('{')));
console.log(JSON.stringify({ ok: d.effects?.status?.status === 'success', digest: d.digest, status: d.effects?.status, target: r.target,
  events: (d.events || []).map((e) => e.type.split('::').pop()) }));
