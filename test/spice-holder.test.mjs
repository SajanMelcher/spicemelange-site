// Spice Certificates holder page (TESTNET PREVIEW): auth, token links, ledger block, withdrawal, wallet, trade, wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519';
import * as H from '../store-core/spice-holder.js';
import { handle, gate } from '../store-core/spice-api.js';
import { personalMessageDigest, suiAddress } from '../store-core/suisig.js';
import { referencePrices } from '../store-core/spice-wallet.js';
import { checkTrade, minOut, TRADE_LIMITS } from '../store-core/spice-trade.js';
import { certTable, walletTable, summary } from '../src/lib/holder-render.js';
import { apply, tokenHash } from '../scripts/spice-holder-token.mjs';

const SECRET = 'x'.repeat(40), HOST = 'spice-cert-preview.example.pages.dev';
const sk = ed25519.utils.randomPrivateKey(), pk = ed25519.getPublicKey(sk);
const ADDR = suiAddress(0, pk);
const signMsg = (m, key = sk, pub = pk) => btoa(String.fromCharCode(0, ...ed25519.sign(personalMessageDigest(new TextEncoder().encode(m)), key), ...pub));
const SAMPLE = JSON.parse(readFileSync(new URL('../store-core/spice-sample/master.sample.json', import.meta.url)));
const holders = { 'H-TN-0001': { display_name: 'Fake One', wallet: ADDR }, 'H-TN-0002': { display_name: 'Fake Two', wallet: '0x' + '2'.repeat(64) } };
const ENV = { SUI_NETWORK: 'testnet', SPICE_CERT_PREVIEW: '1', SPICE_SESSION_SECRET: SECRET, SPICE_HOLDERS_PRIVATE: JSON.stringify({ holders }) };
const req = (action, body, auth) => ({ request: new Request(`https://${HOST}/api/certificates/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `https://${HOST}`, ...(auth ? { authorization: 'Bearer ' + auth } : {}) }, body: JSON.stringify(body) }), env: ENV });
const call = async (a, b, auth, deps = {}) => (await handle(a, req(a, b, auth), { ownedSerials: async () => null, ...deps })).json();

test('fails closed outside the testnet preview', () => {
  assert.equal(gate({ SUI_NETWORK: 'mainnet', SPICE_CERT_PREVIEW: '1', SPICE_SESSION_SECRET: SECRET }), 'preview_only');
  assert.equal(gate({ SUI_NETWORK: 'testnet', SPICE_SESSION_SECRET: SECRET }), 'preview_only');
  assert.equal(gate({ SUI_NETWORK: 'testnet', SPICE_CERT_PREVIEW: '1', SPICE_SESSION_SECRET: 'short' }), 'not_configured');
  const w = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.ok(w.indexOf('SPICE_CERT_PREVIEW') > w.indexOf('[env.preview.vars]'), 'flag only in preview vars');
});
test('nonce: MAC, expiry, tamper', async () => {
  const n = await H.makeNonce(SECRET, 1_000);
  assert.equal(await H.checkNonce(SECRET, n, 2_000), null);
  assert.equal(await H.checkNonce(SECRET, n, 1_000 + H.NONCE_TTL_MS + 1), 'nonce_expired');
  assert.equal(await H.checkNonce(SECRET, n.replace(/.$/, (c) => (c === '0' ? '1' : '0')), 2_000), 'bad_nonce');
  assert.equal(await H.checkNonce('y'.repeat(40), n, 2_000), 'bad_nonce');
});
test('sign-in with a real Sui ed25519 personal-message signature returns only my certificates', async () => {
  const ch = await call('challenge', {});
  assert.match(ch.message, /not a transaction/); assert.match(ch.message, /TESTNET PREVIEW/); assert.match(ch.message, new RegExp('Domain: ' + HOST));
  const r = await call('signin', { message: ch.message, signature: signMsg(ch.message) });
  assert.equal(r.ok, true); assert.equal(r.address, ADDR);
  assert.deepEqual(r.view.certificates.map((c) => c.serial), [1, 2]);
  assert.equal(r.view.display_name, 'Fake One');
  assert.ok(!JSON.stringify(r.view).includes('H-TN-') && !JSON.stringify(r.view).includes('token_hash'));
});
test('sign-in refusals: wrong domain, edited message, someone else\'s key, no certificate', async () => {
  const ch = await call('challenge', {});
  assert.equal((await call('signin', { message: ch.message.replace(HOST, 'evil.example'), signature: signMsg(ch.message.replace(HOST, 'evil.example')) })).reason, 'wrong_domain');
  const edited = ch.message.replace('Sign to view', 'Sign to give');
  assert.equal((await call('signin', { message: edited, signature: signMsg(edited) })).reason, 'message_mismatch');
  const other = ed25519.utils.randomPrivateKey();
  const r = await call('signin', { message: ch.message, signature: signMsg(ch.message, other, ed25519.getPublicKey(other)) });
  assert.equal(r.reason, 'no_certificate_in_this_wallet');
  const bad = signMsg(ch.message).slice(0, -6) + 'AAAAAA';
  assert.equal((await call('signin', { message: ch.message, signature: bad })).ok, false);
});
test('session: required, tamper-proof, expires', async () => {
  assert.equal((await call('me', {})).reason, 'sign_in_again');
  const s = await H.makeSession(SECRET, ADDR, 0);
  assert.equal(await H.readSession(SECRET, s, H.SESSION_TTL_MS + 1), null);
  assert.equal(await H.readSession(SECRET, s.replace(/^./, 'A'), 1), null);
  const live = await H.makeSession(SECRET, ADDR);
  assert.equal((await call('me', {}, live)).view.certificates.length, 2);
});
test('on-chain ownership is used when the testnet package type is configured', async () => {
  const live = await H.makeSession(SECRET, ADDR);
  const r = await call('me', {}, live, { ownedSerials: async () => [3] });
  assert.deepEqual(r.view.certificates.map((c) => c.serial), [3]);
});
test('token link: view-only, hash only, revocable', async () => {
  const blk = structuredClone(SAMPLE.spice_certificates), reg = { tokens: {} };
  const tok = apply('issue', 3, reg, { spice_certificates: blk });
  assert.ok(tok.length >= 43);
  assert.equal(blk.rows.find((r) => r.serial === 3).token_hash, tokenHash(tok));
  assert.ok(!JSON.stringify(reg).includes(tok) && !JSON.stringify(blk).includes(tok), 'token never stored');
  const v = await H.viewByToken(blk, holders, 3, tok);
  assert.equal(v.mode, 'token_view_only'); assert.equal(v.can_withdraw, false); assert.equal(v.display_name, 'Fake Two');
  assert.equal(await H.viewByToken(blk, holders, 1, tok), null, 'token is bound to its serial');
  assert.equal(await H.viewByToken(blk, holders, 3, tok.slice(0, -1) + (tok.endsWith('A') ? 'B' : 'A')), null);
  const tok2 = apply('rotate', 3, reg, { spice_certificates: blk });
  assert.equal(await H.viewByToken(blk, holders, 3, tok), null, 'old token dead after rotate');
  assert.ok(await H.viewByToken(blk, holders, 3, tok2));
  apply('revoke', 3, reg, { spice_certificates: blk });
  assert.equal(await H.viewByToken(blk, holders, 3, tok2), null);
  assert.throws(() => apply('issue', 1, { tokens: { 1: { token_hash: 'sha256:' + 'a'.repeat(64) } } }, null), /rotate/);
});
test('token-view API: unknown link 404s, no PII leaks', async () => {
  const r = await call('token-view', { serial: 1, token: 'A'.repeat(43) });
  assert.equal(r.reason, 'link_invalid_or_revoked');
});
test('master block: schema guard refuses PII; the bundled sample has none', () => {
  assert.deepEqual(H.validateBlock(SAMPLE.spice_certificates), []);
  const bad = structuredClone(SAMPLE.spice_certificates); bad.rows[0].display_name = 'x';
  assert.match(H.validateBlock(bad)[0], /PII/);
  const s = JSON.stringify(SAMPLE);
  for (const k of ['display_name', 'holder_email', 'Fake', '@', 'wallet']) assert.ok(!s.includes(k), k);
  const schema = JSON.parse(readFileSync(new URL('../store-core/spice-sample/master-spice-block.schema.json', import.meta.url)));
  assert.equal(schema.properties.rows.items.additionalProperties, false);
  assert.ok(!('display_name' in schema.properties.rows.items.properties));
});
test('withdrawal: needs session + fresh signature by the same wallet, whole active cert, valid address', async () => {
  const live = await H.makeSession(SECRET, ADDR);
  const body = { kind: 'withdraw', serial: 1, asset: 'USDC', payoutAddress: ADDR };
  assert.equal((await call('challenge', body)).reason, 'sign_in_again');
  const ch = await call('challenge', body, live);
  assert.match(ch.message, /whole certificate/); assert.match(ch.message, /target, not a promise/); assert.match(ch.message, /approved by hand by Sajan/);
  const put = [], kv = new Map(); ENV.SPICE_WITHDRAW_QUEUE_TESTNET = { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); if (k.startsWith('w:')) put.push([k, JSON.parse(v)]); } };
  const ok = await call('withdraw', { ...body, message: ch.message, signature: signMsg(ch.message) }, live);
  assert.equal((await call('withdraw', { ...body, message: ch.message, signature: signMsg(ch.message) }, live)).reason, 'request_already_used', 'signed request cannot be replayed');
  delete ENV.SPICE_WITHDRAW_QUEUE_TESTNET;
  assert.equal(ok.ok, true); assert.equal(ok.queued, true); assert.match(ok.request_id, /^W-TN-/); assert.match(ok.note, /Nothing is paid/);
  assert.equal(put[0][1].status, 'withdrawal_requested'); assert.equal(put[0][1].network, 'testnet-preview');
  const other = ed25519.utils.randomPrivateKey();
  const ch2 = await call('challenge', body, live);
  assert.equal((await call('withdraw', { ...body, message: ch2.message, signature: signMsg(ch2.message, other, ed25519.getPublicKey(other)) }, live)).reason, 'signer_is_not_the_signed_in_wallet');
  assert.equal((await call('withdraw', { ...body, serial: 2, message: ch2.message, signature: signMsg(ch2.message) }, live)).reason, 'already_requested_or_not_active');
  assert.equal((await call('withdraw', { ...body, serial: 3, message: ch2.message, signature: signMsg(ch2.message) }, live)).reason, 'not_your_certificate');
  assert.equal((await call('challenge', { ...body, payoutAddress: 'nope' }, live)).reason, 'bad_payout');
  assert.ok(H.validPayoutAddress('BTC', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq'));
});
test('cross-origin POST refused', async () => {
  const r = { request: new Request(`https://${HOST}/api/certificates/challenge`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{}' }), env: ENV };
  assert.equal((await (await handle('challenge', r)).json()).reason, 'bad_origin');
});
test('wallet panel: testnet tokens get mainnet DeepBook reference prices only', () => {
  const px = referencePrices({ '0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI': { usd: 3, src: 'DeepBook SUI_USDC mid' } });
  const k = Object.keys(px); assert.equal(k.length, 1); assert.match(px[k[0]].src, /reference.*no value/);
  const html = walletTable({ address: ADDR, coins: [{ symbol: '<b>x</b>', qty: 1, usd: 3, raw: '1' }], price_note: 'n', mainnet_only: ['NS'] });
  assert.ok(html.includes('&lt;b&gt;') && !html.includes('<b>x'));
});
test('trade: pairs, slippage 1-300 bps (default 100), min-out', () => {
  assert.equal(TRADE_LIMITS.defaultBps, 100); assert.equal(TRADE_LIMITS.maxBps, 300);
  assert.ok(checkTrade({ pair: 'SUI_DBUSDC', side: 'buy', amount: 1, slippageBps: 100 }));
  assert.throws(() => checkTrade({ pair: 'SUI_DBUSDC', side: 'buy', amount: 1, slippageBps: 301 }), /slippage/);
  assert.throws(() => checkTrade({ pair: 'NS_USDC', side: 'buy', amount: 1, slippageBps: 100 }), /no testnet pool/);
  assert.throws(() => checkTrade({ pair: 'SUI_DBUSDC', side: 'steal', amount: 1, slippageBps: 100 }));
  assert.equal(minOut(10, 100), 9.9);
});
test('page wording: TESTNET PREVIEW label, targets not promises, no forbidden words, noindex headers', () => {
  const p = readFileSync(new URL('../src/pages/certificates/holder/index.astro', import.meta.url), 'utf8');
  assert.match(p, /TESTNET PREVIEW/); assert.match(p, /target, not a promise/); assert.match(p, / noindex>/);
  assert.match(p, /reserve@thespicemelange\.org/); assert.match(p, /never holds your funds or your keys/);
  for (const w of [/guarantee/i, /\bsafe\b/i, /risk-free/i, /backed up/i, /insured\b(?! \()/i]) assert.ok(!w.test(p.replace(/not insured/gi, '').replace(/It is not insured/gi, '')), String(w));
  const hd = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
  assert.match(hd, /\/certificates\/holder\/\*\n  X-Robots-Tag: noindex[^\n]*\n  Referrer-Policy: no-referrer/);
  const r = summary({ display_name: '<img src=x>', mode: 'token_view_only', as_of: 'a', btc_price_usd: '1', price_source: 's', totals: { principal_usd: 1, accrued_sats: 1, value_usd: 0 } });
  assert.ok(!r.includes('<img'));
  assert.ok(!certTable({ certificates: [] }).includes('issued'), 'no count of certificates issued');
});
