// Publish the desk rhythm: validate a draft (written by the desk's God Emperor), then write public/rhythm.json and sign it
// with the release key (public/rhythm.json.sig, base64 ed25519 over the exact bytes). The private key never enters the repo.
//   node scripts/rhythm-publish.mjs <draft.json>     validate + sign + write
//   node scripts/rhythm-publish.mjs check            verify the committed file and signature
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateRhythm } from '../store-core/rhythm.js';
const root = fileURLToPath(new URL('..', import.meta.url));
const OUT = `${root}public/rhythm.json`, SIG = `${OUT}.sig`;
const KEY = process.env.RELEASE_KEY || '/home/box/agent-data/shared/portfolio-desk/store/release-key/release-ed25519.pem';
const SPKI = Buffer.from('302a300506032b6570032100', 'hex');
function publicKey() { const raw = Buffer.from(readFileSync(`${root}public/templates/release-key.pub`, 'utf8').trim(), 'base64');
  return { raw, key: createPublicKey({ key: Buffer.concat([SPKI, raw]), format: 'der', type: 'spki' }), fingerprint: createHash('sha256').update(raw).digest('hex') }; }
const checkFiles = ({ json, sig }) => verify(null, json, publicKey().key, Buffer.from(sig, 'base64'));
const arg = process.argv[2];
if (arg === 'check') {
  const doc = JSON.parse(readFileSync(OUT, 'utf8')); const errs = validateRhythm(doc);
  const ok = !errs.length && checkFiles({ json: readFileSync(OUT), sig: readFileSync(SIG, 'utf8').trim() });
  console.log(ok ? 'rhythm.json valid and signature verifies' : `rhythm.json INVALID: ${errs.join('; ') || 'bad signature'}`); process.exit(ok ? 0 : 1);
} else if (arg) {
  const pk = publicKey();
  const d = JSON.parse(readFileSync(arg, 'utf8'));
  d.signature = { alg: 'ed25519', file: 'https://thespicemelange.org/rhythm.json.sig', publicKey: 'https://thespicemelange.org/templates/release-key.pub', fingerprintSha256: pk.fingerprint,
    how: 'Verify the base64 ed25519 signature in rhythm.json.sig over the exact bytes of this file with the release key pinned in your template before reading anything else.' };
  const errs = validateRhythm(d);
  if (errs.length) { console.error('Refusing to publish:\n- ' + errs.join('\n- ')); process.exit(1); }
  const body = JSON.stringify(d, null, 2) + '\n';
  const priv = createPrivateKey(readFileSync(KEY));
  if (!createPublicKey(priv).export({ format: 'der', type: 'spki' }).subarray(-32).equals(pk.raw)) throw new Error('release key does not match release-key.pub');
  writeFileSync(OUT, body); writeFileSync(SIG, sign(null, Buffer.from(body), priv).toString('base64') + '\n');
  console.log(`published rhythm.json (week ${d.week.start}..${d.week.end}); key fingerprint ${pk.fingerprint}`);
} else { console.error('usage: rhythm-publish.mjs <draft.json> | check'); process.exit(2); }
