// Sui personal-message signature verification (no network). Supports the three plain key schemes a wallet
// can sign with directly: Ed25519 (flag 0x00), Secp256k1 (0x01), Secp256r1 (0x02). Multisig (0x03),
// zkLogin (0x05) and passkey (0x06) are refused (`unsupported_signature_scheme`); those buyers use support.
// Format (Sui): serialized signature = base64(flag || sig[64] || pubkey); address = blake2b256(flag || pubkey);
// signed digest = blake2b256([3,0,0] || bcs(vector<u8> message)); k1/r1 sign sha256(digest).
import { ed25519 } from '@noble/curves/ed25519';
import { secp256k1 } from '@noble/curves/secp256k1';
import { p256 } from '@noble/curves/p256';
import { blake2b } from '@noble/hashes/blake2b';
import { sha256 } from '@noble/hashes/sha256';

const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const uleb = (n) => { const o = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b); } while (n); return o; };
export function personalMessageDigest(msgBytes) {
  const bcs = new Uint8Array([...uleb(msgBytes.length), ...msgBytes]);
  return blake2b(new Uint8Array([3, 0, 0, ...bcs]), { dkLen: 32 });
}
export const suiAddress = (flag, pub) => '0x' + hex(blake2b(new Uint8Array([flag, ...pub]), { dkLen: 32 }));
function b64(s) {
  if (typeof s !== 'string' || s.length > 400 || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  try { return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)); } catch { return null; }
}
const SCHEMES = { 0: { name: 'ed25519', pk: 32 }, 1: { name: 'secp256k1', pk: 33 }, 2: { name: 'secp256r1', pk: 33 } };

/** Verify `signature` (Sui serialized, base64) over the UTF-8 `message` and return the signer's address. */
export function verifyPersonalMessage(message, signature) {
  const raw = b64(signature);
  if (!raw || raw.length < 2) return { ok: false, reason: 'bad_signature_format' };
  const s = SCHEMES[raw[0]];
  if (!s) return { ok: false, reason: 'unsupported_signature_scheme' };
  if (raw.length !== 1 + 64 + s.pk) return { ok: false, reason: 'bad_signature_format' };
  const sig = raw.slice(1, 65), pub = raw.slice(65);
  const digest = personalMessageDigest(new TextEncoder().encode(message));
  let ok = false;
  try {
    if (s.name === 'ed25519') ok = ed25519.verify(sig, digest, pub);
    else if (s.name === 'secp256k1') ok = secp256k1.verify(sig, sha256(digest), pub, { lowS: true });
    else ok = p256.verify(sig, sha256(digest), pub, { lowS: true });
  } catch { ok = false; }
  return ok ? { ok: true, address: suiAddress(raw[0], pub), scheme: s.name } : { ok: false, reason: 'signature_invalid' };
}
