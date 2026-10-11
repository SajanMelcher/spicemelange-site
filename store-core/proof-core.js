// Wallet-ownership proof: message format, nonce and signature checks (no network config, no admin code).
// Imported by the Pages Function (wallet-proof.js) and bundled into the pinned box verifier (V4-2).
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { SuiGraphQLClient } from '@mysten/sui/graphql';
import { normAddr } from './spice-holder.js';

export const PROOF_TTL_MS = 15 * 60 * 1000;
export const GQL = { mainnet: 'https://graphql.mainnet.sui.io/graphql', testnet: 'https://graphql.testnet.sui.io/graphql' };
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
async function hmac(secret, s) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(s)));
}
const ctEq = (a, b) => { a = String(a); b = String(b); let d = a.length ^ b.length; for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return d === 0; };
const ptTime = (ms) => new Date(ms).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', dateStyle: 'medium', timeStyle: 'medium' }) + ' PT';

export async function makeProofNonce(secret, address, now = Date.now()) {
  const n = hex(crypto.getRandomValues(new Uint8Array(16))), exp = now + PROOF_TTL_MS;
  return `${n}.${exp}.${(await hmac(secret, `proof|${normAddr(address)}|${n}|${exp}`)).slice(0, 32)}`;
}
export async function checkProofNonce(secret, address, nonce, now = Date.now()) {
  const m = /^([0-9a-f]{32})\.(\d{1,15})\.([0-9a-f]{32})$/.exec(String(nonce || ''));
  if (!m) return 'bad_nonce';
  if (!ctEq((await hmac(secret, `proof|${normAddr(address)}|${m[1]}|${m[2]}`)).slice(0, 32), m[3])) return 'bad_nonce';
  if (Number(m[2]) < now) return 'nonce_expired';
  return null;
}
/** The exact text the wallet signs. One field per line so anyone can re-check it. */
export function proofMessage({ host, address, nonce, network = 'mainnet', now }) {
  const a = normAddr(address);
  return ['The Spice Melange: wallet ownership proof',
    `I control ${a} and accept the Spice Certificate AdminCap and UpgradeCap.`,
    'This is a message, not a transaction: no gas, nothing moves. Never share a seed phrase.',
    `Wallet: ${a}`, `Network: ${network}`, `Domain: ${host}`, `Nonce: ${nonce}`, `Time: ${ptTime(now)} (${new Date(now).toISOString()})`].join('\n');
}
export const field = (msg, k) => (new RegExp(`^${k}: (.+)$`, 'm').exec(String(msg || '')) || [])[1];

/** Signature check only (no nonce): returns {ok, address, scheme} | {ok:false, reason}. Used by the server and the box script. */
export async function verifyProofSignature(message, signature, { client } = {}) {
  if (typeof message !== 'string' || message.length > 2000 || !message.startsWith('The Spice Melange: wallet ownership proof\n')) return { ok: false, reason: 'bad_message' };
  const address = normAddr(field(message, 'Wallet'));
  if (!address) return { ok: false, reason: 'bad_message' };
  if (!message.includes(`\nI control ${address} and accept the Spice Certificate AdminCap and UpgradeCap.\n`)) return { ok: false, reason: 'bad_message' };
  const network = field(message, 'Network');
  if (!GQL[network]) return { ok: false, reason: 'bad_network' };
  let scheme = 'unknown';
  try { scheme = { 0: 'ed25519', 1: 'secp256k1', 2: 'secp256r1', 3: 'multisig', 5: 'zklogin', 6: 'passkey' }[Uint8Array.from(atob(signature), (c) => c.charCodeAt(0))[0]] ?? 'unknown'; }
  catch { return { ok: false, reason: 'bad_signature_format' }; }
  try {
    const c = client ?? new SuiGraphQLClient({ url: GQL[network], network });
    const pk = await verifyPersonalMessageSignature(enc.encode(message), signature, { client: c, address });
    if (normAddr(pk.toSuiAddress()) !== address) return { ok: false, reason: 'signer_is_not_the_named_wallet', scheme };
    return { ok: true, address, scheme, network };
  } catch (e) {
    const m = String(e?.message || e);
    return { ok: false, reason: /address/i.test(m) ? 'signer_is_not_the_named_wallet' : /not valid/i.test(m) ? 'signature_invalid' : 'verify_error', scheme, detail: m.slice(0, 160) };
  }
}

