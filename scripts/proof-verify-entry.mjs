// Entry for the vendored, pinned box verifier (V4-2). Bundled by scripts/build-proof-verifier.sh into
// /workspace/ixians/spice-certificates/verifier/verify-proof.bundle.mjs; run with the pinned /usr/bin/node (no npx).
// usage: node verify-proof.bundle.mjs <proof.json> <expected-address> <network> <host> <schemes,comma>
// Prints one JSON line; exit 0 only if every check passes.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { verifyProofSignature, field } from '../store-core/proof-core.js';
import { normAddr } from '../store-core/spice-holder.js';
const [file, want, network, host, schemes] = process.argv.slice(2);
const raw = readFileSync(file); const r = JSON.parse(raw);
const out = { file, proof_sha256: createHash('sha256').update(raw).digest('hex') };
const fail = (reason) => { console.log(JSON.stringify({ ...out, ok: false, reason })); process.exit(1); };
const v = await verifyProofSignature(r.message, r.signature);
if (!v.ok) fail('signature: ' + v.reason);
if (v.address !== normAddr(want)) fail('address_mismatch');
if (v.network !== network) fail('network_mismatch');
if (field(r.message, 'Domain') !== host) fail('domain_mismatch');
if (!String(schemes).split(',').includes(v.scheme)) fail('scheme_not_allowed: ' + v.scheme);
const nonce = String(field(r.message, 'Nonce') || '');
// One-time nonce: the record must be the server's KV record for exactly this nonce (the server checked the HMAC, expiry
// and single use at submit time). The box side then refuses to reuse a nonce (setup_caps.py keeps the used list).
if (!r.server_verified_ms || r.id !== `walletproof:${v.address}:${nonce.split('.')[0]}`) fail('not_a_server_verified_record');
console.log(JSON.stringify({ ...out, ok: true, address: v.address, scheme: v.scheme, network: v.network, domain: host, nonce, time: field(r.message, 'Time') }));
