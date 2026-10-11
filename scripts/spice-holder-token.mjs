#!/usr/bin/env node
// Admin: issue / rotate / revoke a holder's tailored VIEW-ONLY link /certificates/holder/#s=<serial>&t=<token> (token in the fragment: never sent to a server; Siona SC15).
// 256-bit random token (base64url, 43 chars). Only sha256(token) is stored: in the tokens registry (outside the repo,
// for Hwi's daily master.json build) and, with --master, straight into that block's row.token_hash. The link is printed ONCE.
//   node scripts/spice-holder-token.mjs issue|rotate --serial 3 --tokens <registry.json> [--master <master.json|block.json>] [--base https://...]
//   node scripts/spice-holder-token.mjs revoke --serial 3 --tokens <registry.json> [--master ...]
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { randomBytes, createHash } from 'node:crypto';
import { resolve } from 'node:path';

const REPO = resolve(new URL('..', import.meta.url).pathname);
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
export const newToken = () => randomBytes(32).toString('base64url');
export const tokenHash = (t) => 'sha256:' + createHash('sha256').update(t).digest('hex');
const write = (p, o) => { writeFileSync(p + '.tmp', JSON.stringify(o, null, 2) + '\n', { mode: 0o600 }); renameSync(p + '.tmp', p); };
const blockOf = (m) => (m.spice_certificates ? m.spice_certificates : m);

export function apply(cmd, serial, reg, master, now = new Date()) {
  const s = String(serial); let token = null;
  reg.tokens ||= {};
  const prev = reg.tokens[s];
  if (cmd === 'revoke' || cmd === 'rotate') { if (prev) reg.tokens[s] = { ...prev, revoked_at: now.toISOString(), token_hash: null, revoked_hash: prev.token_hash }; }
  if (cmd === 'issue' && prev?.token_hash) throw new Error(`serial ${s} already has an active link; use rotate`);
  if (cmd === 'issue' || cmd === 'rotate') { token = newToken(); reg.tokens[s] = { token_hash: tokenHash(token), created_at: now.toISOString(), revoked_at: null }; }
  if (master) { const row = blockOf(master).rows.find((r) => String(r.serial) === s); if (!row) throw new Error(`serial ${s} not in master block`); row.token_hash = reg.tokens[s]?.token_hash ?? null; }
  return token;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const cmd = process.argv[2], serial = arg('--serial'), tokPath = arg('--tokens'), mPath = arg('--master');
  if (!['issue', 'rotate', 'revoke'].includes(cmd) || !/^\d+$/.test(serial || '') || !tokPath) { console.error('usage: issue|rotate|revoke --serial N --tokens <file> [--master <file>]'); process.exit(2); }
  if (resolve(tokPath).startsWith(REPO)) { console.error('REFUSED: keep the tokens registry outside the site repo'); process.exit(2); }
  const reg = existsSync(tokPath) ? JSON.parse(readFileSync(tokPath, 'utf8')) : { note: 'hashes only; tokens are never stored', tokens: {} };
  const master = mPath ? JSON.parse(readFileSync(mPath, 'utf8')) : null;
  const token = apply(cmd, serial, reg, master);
  write(tokPath, reg); if (master) write(mPath, master);
  if (token) console.log(`${arg('--base', 'https://thespicemelange.org')}/certificates/holder/#s=${serial}&t=${token}`);
  else console.log(`serial ${serial}: link revoked`);
}
