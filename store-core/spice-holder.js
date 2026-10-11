// Spice Certificates holder page core (TESTNET PREVIEW). Pure functions + Web Crypto; runs in Pages Functions and Node tests.
// Security model:
//  - Sign-in = Sui personal-message signature over a server-issued challenge (stateless HMAC nonce, 5-minute expiry,
//    domain-bound). No gas, no transaction, never a seed phrase. Result = 15-minute HMAC session bound to the address.
//  - Tailored link /certificates/holder/<serial>/<token>: VIEW-ONLY. Only sha256(token) is stored (master.json row
//    `token_hash`); compared in constant time. Withdrawal always needs a fresh wallet signature.
//  - Data = exactly the `spice_certificates` block of ledger/master.json (preview: a FAKE sample). Display names are read
//    at render time from a separate private holder file (env secret SPICE_HOLDERS_PRIVATE), never from master.json.
//  - Statements are protected by the signature/token gate on this API. Seal encryption is NOT used (see README).
import { verifyPersonalMessage } from './suisig.js';

export const NONCE_TTL_MS = 5 * 60_000;
export const SESSION_TTL_MS = 15 * 60_000;
export const ASSETS = { USDC: { network: 'sui' }, BTC: { network: 'bitcoin' } };
export const WITHDRAW_STATUSES = ['none', 'withdrawal_requested', 'payout_pending', 'paid', 'rejected'];
const enc = new TextEncoder();
const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const b64u = (s) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => atob(s.replace(/-/g, '+').replace(/_/g, '/'));

export function randomHex(bytes = 16) { const a = new Uint8Array(bytes); crypto.getRandomValues(a); return hex(a); }
export async function sha256Hex(s) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }
async function hmac(secret, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
export function ctEqual(a, b) {
  a = String(a); b = String(b); let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
export const normAddr = (a) => { a = String(a || '').toLowerCase(); return /^0x[0-9a-f]{1,64}$/.test(a) ? '0x' + a.slice(2).padStart(64, '0') : null; };
export function requireSecret(env) {
  const s = env?.SPICE_SESSION_SECRET; if (!s || s.length < 32) return null; return s;
}

// ------------------------------------------------------------- challenges (sign-in and withdrawal)
export async function makeNonce(secret, now = Date.now()) {
  const n = randomHex(16), exp = now + NONCE_TTL_MS;
  return `${n}.${exp}.${(await hmac(secret, `nonce|${n}|${exp}`)).slice(0, 32)}`;
}
export async function checkNonce(secret, nonce, now = Date.now()) {
  const m = /^([0-9a-f]{32})\.(\d{1,15})\.([0-9a-f]{32})$/.exec(String(nonce || ''));
  if (!m) return 'bad_nonce';
  if (!ctEqual((await hmac(secret, `nonce|${m[1]}|${m[2]}`)).slice(0, 32), m[3])) return 'bad_nonce';
  if (Number(m[2]) < now) return 'nonce_expired';
  return null;
}
export function signInMessage(host, nonce) {
  return ['The Spice Melange: Spice Certificate holder sign-in (TESTNET PREVIEW)',
    'Sign to view your own certificates. This is a message, not a transaction: no gas, nothing moves.',
    'We will never ask for your seed phrase or private key.',
    `Domain: ${host}`, `Nonce: ${nonce}`].join('\n');
}
export function withdrawalMessage(host, nonce, { serial, asset, payoutAddress }) {
  return ['The Spice Melange: Spice Certificate WITHDRAWAL REQUEST (TESTNET PREVIEW)',
    `I hold Spice Certificate No. ${serial} and request redemption of the whole certificate.`,
    `Payout asset: ${asset} on ${ASSETS[asset].network}`, `Payout address: ${payoutAddress}`,
    'Each payout is approved by hand by Sajan Melcher. Target: within 6 hours of a verified request (a target, not a promise).',
    'This is a message, not a transaction: no gas, nothing moves now.',
    `Domain: ${host}`, `Nonce: ${nonce}`].join('\n');
}
const field = (msg, k) => (new RegExp(`^${k}: (.+)$`, 'm').exec(msg) || [])[1];

/** Verify a signed challenge: format, domain, nonce MAC/expiry, signature. Returns {ok, address} or {ok:false, reason}. */
export async function verifySigned(secret, host, message, signature, expected, now = Date.now()) {
  if (typeof message !== 'string' || message.length > 2000) return { ok: false, reason: 'bad_message' };
  const nonce = field(message, 'Nonce');
  if (field(message, 'Domain') !== host) return { ok: false, reason: 'wrong_domain' };
  const nerr = await checkNonce(secret, nonce, now); if (nerr) return { ok: false, reason: nerr };
  if (message !== expected(nonce)) return { ok: false, reason: 'message_mismatch' };
  const v = verifyPersonalMessage(message, signature);
  if (!v.ok) return v;
  return { ok: true, address: normAddr(v.address), nonce };
}

// ------------------------------------------------------------- sessions
export async function makeSession(secret, address, now = Date.now()) {
  const body = b64u(JSON.stringify({ a: normAddr(address), e: now + SESSION_TTL_MS }));
  return `${body}.${await hmac(secret, 'sess|' + body)}`;
}
export async function readSession(secret, tok, now = Date.now()) {
  const [body, mac] = String(tok || '').split('.');
  if (!body || !mac || !ctEqual(await hmac(secret, 'sess|' + body), mac)) return null;
  try { const s = JSON.parse(unb64u(body)); return s.e > now && normAddr(s.a) ? { address: s.a, exp: s.e } : null; } catch { return null; }
}

// ------------------------------------------------------------- master.json block + private holder file
export function validateBlock(b) {
  const errs = [];
  if (!b || typeof b !== 'object') return ['missing spice_certificates block'];
  for (const k of ['schema_version', 'as_of', 'btc_price_usd', 'price_source', 'rows']) if (!(k in b)) errs.push(`missing ${k}`);
  for (const r of b.rows || []) {
    if ('display_name' in r || 'holder_email' in r || 'holder_sui_wallet' in r) errs.push(`row ${r.serial}: PII field in master.json`);
    if (!/^sha256:[0-9a-f]{64}$/.test(r.token_hash || '') && r.token_hash !== null) errs.push(`row ${r.serial}: bad token_hash`);
  }
  return errs;
}
export function parsePrivate(env) {
  try { return JSON.parse(env?.SPICE_HOLDERS_PRIVATE || '{}').holders || {}; } catch { return {}; }
}
const PUBLIC_ROW = ['serial', 'principal_usd', 'accrued_sats', 'value_usd', 'last_reserve_credit_pt', 'next_reserve_credit_pt', 'status', 'withdrawal_status'];
export function viewOf(block, rows, holders, mode) {
  const ref = rows[0]?.holder_ref;
  return {
    mode, network: 'testnet', preview: true, as_of: block.as_of, btc_price_usd: block.btc_price_usd, price_source: block.price_source,
    display_name: (ref && holders[ref]?.display_name) || 'Holder',
    certificates: rows.map((r) => Object.fromEntries(PUBLIC_ROW.map((k) => [k, r[k] ?? null]))),
    totals: { principal_usd: rows.reduce((t, r) => t + Number(r.principal_usd || 0), 0), accrued_sats: rows.reduce((t, r) => t + Number(r.accrued_sats || 0), 0),
      value_usd: Math.floor(rows.reduce((t, r) => t + Number(r.value_usd || 0), 0) * 100) / 100 },
    can_withdraw: mode === 'signed',
  };
}
/** Token link: VIEW-ONLY view of the holder who owns `serial`, if sha256(token) matches that row's token_hash. */
export async function viewByToken(block, holders, serial, token) {
  if (!/^\d{1,12}$/.test(String(serial)) || !/^[A-Za-z0-9_-]{43,128}$/.test(String(token))) return null;
  const row = block.rows.find((r) => String(r.serial) === String(serial));
  const h = 'sha256:' + (await sha256Hex(token));
  if (!row || !row.token_hash || !ctEqual(row.token_hash, h)) return null;
  return viewOf(block, block.rows.filter((r) => r.holder_ref === row.holder_ref), holders, 'token_view_only');
}
/** Signed-in: rows for serials the address owns on-chain (or, on preview without a testnet package, the private map). */
export function viewByAddress(block, holders, address, ownedSerials) {
  const a = normAddr(address);
  let rows;
  if (ownedSerials) rows = block.rows.filter((r) => ownedSerials.includes(Number(r.serial)));
  else { const refs = Object.entries(holders).filter(([, h]) => normAddr(h.wallet) === a).map(([k]) => k); rows = block.rows.filter((r) => refs.includes(r.holder_ref)); }
  return viewOf(block, rows, holders, 'signed');
}

// ------------------------------------------------------------- withdrawal queue record (private; never public)
export function withdrawalRecord({ serial, asset, payoutAddress, address, message, signature, now = Date.now() }) {
  const t = new Date(now);
  const pt = (d) => d.toLocaleString('sv-SE', { timeZone: 'America/Los_Angeles' }).replace(' ', 'T') + ' PT';
  return {
    request_id: 'W-TN-' + randomHex(6), serial: Number(serial), payout_asset: asset, payout_network: ASSETS[asset].network,
    request_ts_utc: t.toISOString(), request_ts_pt: pt(t), sig_verified_at_pt: pt(t),
    payout_deadline_pt: pt(new Date(now + 6 * 3600_000)), deadline_note: 'target, not a promise; Sajan approves each payout',
    status: 'withdrawal_requested', email_confirmed_at_pt: null, address_confirm_1_at_pt: null, address_confirm_2_at_pt: null,
    private: { holder_address: address, payout_address_private: payoutAddress, signed_message_text: message, signature },
    network: 'testnet-preview',
  };
}
export function validPayoutAddress(asset, a) {
  if (asset === 'USDC') return !!normAddr(a) && String(a).length === 66;
  if (asset === 'BTC') return /^(bc1[02-9ac-hj-np-z]{11,71}|[13][1-9A-HJ-NP-Za-km-z]{25,34}|tb1[02-9ac-hj-np-z]{11,71})$/.test(String(a));
  return false;
}
