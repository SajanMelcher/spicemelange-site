// Signed versions.json (ed25519). versions.json is a STATIC file (public/templates/versions.json) so the bytes
// that were signed are exactly the bytes served. The private key never enters the repo.
//   node scripts/versions-sign.mjs sign    regenerate versions.json from store-core/templates.json and sign it
//   node scripts/versions-sign.mjs check   verify the committed file matches templates.json and its signature
// Signature: versions.json.sig = base64(ed25519(signature over the exact bytes of versions.json)).
// Public key: /templates/release-key.pub = base64 of the raw 32-byte ed25519 key. Fingerprint = sha256(raw key), hex.
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { versionsDoc } from '../store-core/versions.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = `${root}public/templates/versions.json`, SIG = `${OUT}.sig`, PUB = `${root}public/templates/release-key.pub`;
const KEY = process.env.RELEASE_KEY || '/home/box/agent-data/shared/portfolio-desk/store/release-key/release-ed25519.pem';
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

export function publicKey(b64 = readFileSync(PUB, 'utf8').trim()) {
  const raw = Buffer.from(b64, 'base64');
  if (raw.length !== 32) throw new Error('release-key.pub must be 32 raw bytes, base64');
  return { raw, key: createPublicKey({ key: Buffer.concat([SPKI_ED25519, raw]), format: 'der', type: 'spki' }), fingerprint: createHash('sha256').update(raw).digest('hex') };
}
export function render() {
  const pk = publicKey();
  const doc = versionsDoc();
  doc.signature = { alg: 'ed25519', file: 'https://thespicemelange.org/templates/versions.json.sig', publicKey: 'https://thespicemelange.org/templates/release-key.pub', fingerprintSha256: pk.fingerprint,
    how: 'Verify the base64 ed25519 signature in versions.json.sig over the exact bytes of this file with the pinned public key before trusting any version or sha256.' };
  return JSON.stringify(doc, null, 2) + '\n';
}
export function checkFiles({ json = readFileSync(OUT), sig = readFileSync(SIG, 'utf8').trim(), pub } = {}) {
  const pk = publicKey(pub);
  return verify(null, Buffer.from(json), pk.key, Buffer.from(sig, 'base64'));
}
const mode = process.argv[2];
if (mode === 'sign') {
  const body = render();
  const priv = createPrivateKey(readFileSync(KEY)); // never printed
  const pubFromPriv = createPublicKey(priv).export({ format: 'der', type: 'spki' }).subarray(-32);
  if (!pubFromPriv.equals(publicKey().raw)) throw new Error('release key does not match public/templates/release-key.pub');
  writeFileSync(OUT, body);
  writeFileSync(SIG, sign(null, Buffer.from(body), priv).toString('base64') + '\n');
  console.log(`signed versions.json (current ${JSON.parse(body).current}); key fingerprint ${publicKey().fingerprint}`);
} else if (mode === 'check') {
  const ok = readFileSync(OUT, 'utf8') === render() && checkFiles();
  console.log(ok ? 'versions.json matches templates.json and the signature verifies' : 'versions.json stale or signature invalid');
  process.exit(ok ? 0 : 1);
}
