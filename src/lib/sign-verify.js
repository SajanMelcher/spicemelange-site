// /sign/ client-side checks (Siona F-1, 10/10 10:44 PM PT). Everything here runs in Sajan's browser and trusts ONLY the
// constants below, never values the server reports. Same-origin caveat: this catches server/file drift, not a malicious deploy
// of this page; the wallet's own transaction screen remains the real check.
import { blake2b } from '@noble/hashes/blake2b';

export const PIN = Object.freeze({
  upgradeSha256: 'e000df0ffd6f7cd271a691fffe77dc0eeb324c7df9cc4704c6db2b6799dc6566',
  upgradeDigest: '37bSrXhV5D5bfmtNtLdh9gHjPpNpos3koYJ5JQC9iwLw',
  account: '0x04b178f7855b2e84ae9c1585093009bb6c212cd3b5ccf9c76672dda04be087e0', // holds the UpgradeCap and the AdminCap
  certPackage: '0x294b4ff76830aaace850ba390fad5f2bb7692a36cb5b4b4f078590a0bb34e24f',
  issuer: '0x7fb5656aa9d4a504361d683fe0183df3e33b56a3e58e8c13714dc19fc5421319',
  adminCap: '0x1c2d85d8a7f2d68aef419b54f5ecdfc6e12e0d4f5b2ba255795fa85ec3b12de5',
});

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58(u8) {
  const d = [0];
  for (const byte of u8) { let c = byte; for (let i = 0; i < d.length; i++) { c += d[i] << 8; d[i] = c % 58; c = (c / 58) | 0; } while (c) { d.push(c % 58); c = (c / 58) | 0; } }
  let s = ''; for (const byte of u8) { if (byte) break; s += '1'; }
  for (let i = d.length - 1; i >= 0; i--) s += B58[d[i]];
  return s;
}
export const b64ToU8 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function sha256Hex(u8) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256', u8))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
/** Sui transaction digest: base58(blake2b-256("TransactionData::" || bcs bytes)). */
export function txDigest(u8) {
  const pre = new TextEncoder().encode('TransactionData::'); const m = new Uint8Array(pre.length + u8.length); m.set(pre); m.set(u8, pre.length);
  return base58(blake2b(m, { dkLen: 32 }));
}
/** Upgrade bytes: returns { ok, sha, digest } computed HERE from the bytes, compared with the pinned values. */
export async function checkUpgradeBytes(b64) {
  let u8; try { u8 = b64ToU8(String(b64)); } catch { return { ok: false, reason: 'not base64' }; }
  const sha = await sha256Hex(u8), digest = txDigest(u8);
  const ok = sha === PIN.upgradeSha256 && digest === PIN.upgradeDigest;
  return { ok, sha, digest, reason: ok ? null : 'bytes differ from the reviewed transaction' };
}
/** Server-built set_paused tx (Transaction JSON v2): exactly ONE MoveCall pinnedPackage::certificate::set_paused(AdminCap, Issuer, bool)
 *  from the pinned account, nothing else (no other inputs, commands, type args, gas payment or sponsor). Throws on any difference. */
export function checkPauseTx(txJson, action) {
  const t = typeof txJson === 'string' ? JSON.parse(txJson) : txJson;
  const fail = (m) => { throw new Error(m); };
  if (!t || t.version !== 2) fail('not a v2 transaction');
  if (t.sender !== PIN.account) fail('sender is not ' + PIN.account);
  if (t.expiration !== null && t.expiration !== undefined) fail('unexpected expiration');
  const g = t.gasData ?? {};
  if ((g.owner ?? null) !== null && g.owner !== PIN.account) fail('gas paid by another address');
  if ((g.payment ?? null) !== null) fail('gas payment pre-set');
  const keys = Object.keys(t).sort().join(','); if (keys !== 'commands,expiration,gasData,inputs,sender,version') fail('unexpected fields: ' + keys);
  if (!Array.isArray(t.commands) || t.commands.length !== 1) fail('must be exactly one command');
  const c = t.commands[0]; if (Object.keys(c).join() !== 'MoveCall') fail('command is not a MoveCall');
  const m = c.MoveCall;
  if (m.package !== PIN.certPackage || m.module !== 'certificate' || m.function !== 'set_paused') fail('call target is not the pinned set_paused');
  if ((m.typeArguments ?? []).length) fail('type arguments present');
  if (JSON.stringify(m.arguments) !== JSON.stringify([{ Input: 0 }, { Input: 1 }, { Input: 2 }])) fail('unexpected arguments');
  if (!Array.isArray(t.inputs) || t.inputs.length !== 3) fail('must have exactly three inputs');
  const objId = (i) => i?.UnresolvedObject?.objectId ?? i?.Object?.ImmOrOwnedObject?.objectId ?? i?.Object?.SharedObject?.objectId;
  if (objId(t.inputs[0]) !== PIN.adminCap) fail('first input is not the pinned AdminCap');
  if (objId(t.inputs[1]) !== PIN.issuer) fail('second input is not the pinned Issuer');
  const want = action === 'pause' ? 'AQ==' : action === 'unpause' ? 'AA==' : fail('bad action');
  if (t.inputs[2]?.Pure?.bytes !== want) fail(`flag is not ${action === 'pause' ? 'true' : 'false'}`);
  return true;
}
