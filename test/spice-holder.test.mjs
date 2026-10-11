// Spice Certificates holder page (TESTNET PREVIEW): auth, token links, ledger block, withdrawal, wallet, trade, wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519';
import * as H from '../store-core/spice-holder.js';
import { handle, gate, signinGate, ownedSerials } from '../store-core/spice-api.js';
import * as G from '../store-core/spice-gate.js';
import { TESTNET_CERT, certBuyQuote, licenseQualifies, HOLDER_CERT_TYPE } from '../store-core/spice-cert-buy.js';
import IDS from '../store-core/spice-cert-testnet.json' with { type: 'json' };
import { build as buildIds } from '../scripts/sync-spice-cert-ids.mjs';
import { makeD1 } from './d1-shim.mjs';
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
const freshDb = () => makeD1([new URL('../migrations/0011_spice_nonces.sql', import.meta.url)]);
const ENV = { SUI_NETWORK: 'testnet', SPICE_CERT_PREVIEW: '1', SPICE_SESSION_SECRET: SECRET, SPICE_HOLDERS_PRIVATE: JSON.stringify({ holders }), STORE_DB: freshDb() };
const NO_LIC = async () => ({ eligibility: 'collection_only', eligible: false, licenses: [] });
const req = (action, body, auth, env = ENV) => ({ request: new Request(`https://${HOST}/api/certificates/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `https://${HOST}`, ...(auth ? { authorization: 'Bearer ' + auth } : {}) }, body: JSON.stringify(body) }), env });
const call = async (a, b, auth, deps = {}, env = ENV) => (await handle(a, req(a, b, auth, env), { ownedSerials: async () => null, licenseAccess: NO_LIC, ...deps })).json();
const signInAs = async (key = sk, pub = pk, deps = {}, env = ENV) => { const addr = suiAddress(0, pub); const ch = await call('challenge', { address: addr }, null, deps, env); return call('signin', { message: ch.message, signature: signMsg(ch.message, key, pub) }, null, deps, env); };

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
  assert.equal((await call('challenge', {})).reason, 'bad_address', 'challenge is bound to a wallet');
  const ch = await call('challenge', { address: ADDR });
  assert.match(ch.message, /not a transaction/); assert.match(ch.message, /never ask for your seed phrase/); assert.match(ch.message, new RegExp('Domain: ' + HOST)); assert.match(ch.message, new RegExp('Wallet: ' + ADDR));
  assert.equal(ch.expires_in_s, 120, 'short TTL');
  const r = await call('signin', { message: ch.message, signature: signMsg(ch.message) });
  assert.equal(r.access.eligible, false);
  assert.equal(r.ok, true); assert.equal(r.address, ADDR);
  assert.deepEqual(r.view.certificates.map((c) => c.serial), [1, 2]);
  assert.equal(r.view.display_name, 'Fake One');
  assert.ok(!JSON.stringify(r.view).includes('H-TN-') && !JSON.stringify(r.view).includes('token_hash'));
});
test('sign-in refusals: wrong domain, edited message, someone else\'s key, no certificate', async () => {
  const ch = await call('challenge', { address: ADDR });
  assert.equal((await call('signin', { message: ch.message.replace(HOST, 'evil.example'), signature: signMsg(ch.message.replace(HOST, 'evil.example')) })).reason, 'wrong_domain');
  const edited = ch.message.replace('Sign to prove', 'Sign to give');
  assert.equal((await call('signin', { message: edited, signature: signMsg(edited) })).reason, 'message_mismatch');
  const other = ed25519.utils.randomPrivateKey();
  const r = await call('signin', { message: ch.message, signature: signMsg(ch.message, other, ed25519.getPublicKey(other)) });
  assert.equal(r.reason, 'signer_is_not_the_named_wallet', 'a challenge for wallet A cannot be signed by wallet B');
  const r2 = await signInAs(other, ed25519.getPublicKey(other));
  assert.equal(r2.ok, true); assert.deepEqual(r2.view.certificates, [], 'no certificate: signed in, nothing shown');
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
  assert.match(p, /reserve@thespicemelange\.org/); assert.match(p, /This trade panel never touches your certificate money or your keys; coins move only between your wallet and the DeepBook pool\./); assert.doesNotMatch(p, /never holds your funds/); assert.match(p, /is shown only after your wallet signature/); // Siona B-5, B-6
  for (const w of [/guarantee/i, /\bsafe\b/i, /risk-free/i, /backed up/i, /insured\b(?! \()/i]) assert.ok(!w.test(p.replace(/not insured/gi, '').replace(/It is not insured/gi, '')), String(w));
  const hd = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
  assert.match(hd, /\/certificates\/\*\n  X-Robots-Tag: noindex[^\n]*\n  Cache-Control: no-store/);
  const r = summary({ display_name: '<img src=x>', mode: 'token_view_only', as_of: 'a', btc_price_usd: '1', price_source: 's', totals: { principal_usd: 1, accrued_sats: 1, value_usd: 0 } });
  assert.ok(!r.includes('<img'));
  assert.ok(!certTable({ certificates: [] }).includes('issued'), 'no count of certificates issued');
});

test('on-chain ownership read: testnet GraphQL query shape and serial parse', async () => {
  let sent;
  const f = async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return { json: async () => ({ data: { address: { objects: { nodes: [{ contents: { json: { serial: '2' } } }] } } } }) }; };
  assert.deepEqual(await ownedSerials({ SPICE_CERT_TYPE: '0x1::certificate::SpiceCertificate' }, ADDR, f), [2]);
  assert.equal(sent.url, 'https://graphql.testnet.sui.io/graphql'); assert.ok(!sent.body.query.includes('asMoveObject'));
  await ownedSerials({}, ADDR, f); assert.equal(sent.body.variables.t, HOLDER_CERT_TYPE); // default = generated testnet ids
});

// ------------------------------------------------------------------ Ixians 10/10 PT: sign-in on prod, SC13/14/15, gate, testnet buy
test('gates: sign-in needs only the session secret + D1 (prod too); holder data stays testnet-preview only', async () => {
  assert.equal(signinGate({ SPICE_SESSION_SECRET: SECRET, STORE_DB: {} }), null);
  assert.equal(signinGate({ SPICE_SESSION_SECRET: SECRET }), 'not_configured');
  assert.equal(signinGate({ STORE_DB: {} }), 'not_configured');
  const PROD = { SUI_NETWORK: 'mainnet', SPICE_SESSION_SECRET: SECRET, STORE_DB: freshDb() };
  const r = await signInAs(sk, pk, {}, PROD);
  assert.equal(r.ok, true); assert.equal(r.view, null, 'no holder statements on production');
  for (const a of ['me', 'withdraw', 'wallet', 'trade-quote', 'token-view']) assert.equal((await call(a, {}, r.session, {}, PROD)).reason, 'preview_only', a);
  assert.equal((await call('access', {}, r.session, {}, PROD)).ok, true);
});
test('SC13: a sign-in signature works once (D1 primary key), even with a still-valid nonce', async () => {
  const env = { ...ENV, STORE_DB: freshDb() };
  const ch = await call('challenge', { address: ADDR }, null, {}, env);
  const body = { message: ch.message, signature: signMsg(ch.message) };
  assert.equal((await call('signin', body, null, {}, env)).ok, true);
  const again = await call('signin', body, null, {}, env);
  assert.equal(again.ok, false); assert.equal(again.reason, 'nonce_already_used');
  // two racing replays: exactly one wins
  const ch2 = await call('challenge', { address: ADDR }, null, {}, env);
  const b2 = { message: ch2.message, signature: signMsg(ch2.message) };
  const rs = await Promise.all([call('signin', b2, null, {}, env), call('signin', b2, null, {}, env)]);
  assert.equal(rs.filter((x) => x.ok).length, 1);
  assert.equal(H.NONCE_TTL_MS, 120_000);
  assert.equal((await H.consumeNonce(null, 'x', 'signin')), 'not_configured', 'no D1 = refuse, never accept');
});
test('SC14/SC15: API JSON sends one Referrer-Policy + noindex; cert pages add no second Referrer-Policy; token only in the fragment', async () => {
  const res = await handle('challenge', req('challenge', { address: ADDR }));
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer'); assert.match(res.headers.get('x-robots-tag'), /noindex/);
  const hd = readFileSync(new URL('../public/_headers', import.meta.url), 'utf8');
  const certBlock = hd.slice(hd.indexOf('/certificates/*'));
  assert.doesNotMatch(certBlock.split('\n').slice(0, 4).join('\n'), /Referrer-Policy/);
  const page = readFileSync(new URL('../src/pages/certificates/holder/index.astro', import.meta.url), 'utf8');
  assert.match(page, /location\.hash/); assert.doesNotMatch(page, /location\.pathname\.match/);
  const legacy = await import('../functions/certificates/holder/[serial]/[token].js');
  assert.equal((await legacy.onRequestGet({ env: {} })).status, 404, 'not launched: legacy route is 404');
  const lr = await legacy.onRequestGet({ env: { SPICE_CERTS_LIVE: '1' } });
  assert.equal(lr.status, 302); assert.equal(lr.headers.get('location'), '/certificates/holder/#old-link');
  assert.match(readFileSync(new URL('../scripts/spice-holder-token.mjs', import.meta.url), 'utf8'), /holder\/#s=\$\{serial\}&t=\$\{token\}/);
});
const node = (sku, extra = {}) => ({ address: '0x' + 'ab'.repeat(32), contents: { type: { repr: G.MAINNET_DESK_LICENSE_TYPE }, json: { template_id: sku, order_id: 'SM-ABCD1234', ...extra } }, ...(extra.$ || {}) });
test('gate: exact mainnet DeskLicense type + collection sku; legacy License, test licenses and singles never count (collection_only)', () => {
  assert.equal(G.CERT_ELIGIBILITY, 'collection_only', 'Sajan 8:18 PM PT: only The Secret Journals holders');
  assert.equal(G.COLLECTION_SKU, 'dune-saga-collection');
  assert.equal(G.judge(node('dune-saga-collection')).counts, true);
  assert.equal(G.judge(node('full-desk')).counts, true, 'retired Full Desk = served the collection');
  assert.deepEqual(G.judge(node('fish-speakers')), { counts: false, why: 'single_template_license' });
  assert.deepEqual(G.judge(node('leto-journals')), { counts: false, why: 'single_template_license' });
  const legacy = { address: '0x1', contents: { type: { repr: '0x9a376d022cac31a7db36139a5695f979804913c0713fe28be06bc5d1ee1d41bb::license::License' }, json: { sku: 'dune-saga-collection', template_id: 'dune-saga-collection' } } };
  assert.equal(G.judge(legacy).why, 'not_a_desk_license');
  const lookalike = { address: '0x1', contents: { type: { repr: '0xbad::desk_license::DeskLicense' }, json: { template_id: 'dune-saga-collection' } } };
  assert.equal(G.judge(lookalike).counts, false, 'a DeskLicense from another package never counts');
  assert.equal(G.judge(node('dune-saga-collection', { order_id: 'SM-TEST-X' })).why, 'test_license');
  assert.equal(G.judge(node('dune-saga-collection', { order_id: 'SM-MAINNET-SEALTEST-1' })).why, 'test_license');
  assert.equal(G.judge({ ...node('dune-saga-collection'), address: G.TEST_LICENSE_IDS[0] }).why, 'test_license');
  assert.equal(G.judge(node('test-desk-20261010')).why, 'test_license');
});
test('gate: any_template mode (ready, not active) accepts any non-test DeskLicense, still never legacy', () => {
  assert.equal(G.judge(node('fish-speakers'), 'any_template').counts, true);
  assert.equal(G.judge(node('test-desk-20261010'), 'any_template').counts, false);
  assert.equal(G.mode('bogus'), 'collection_only', 'unknown value falls back to collection_only');
  for (const m of G.ELIGIBILITY_MODES) for (const k of ['who', 'short', 'rule', 'notEligible']) assert.ok(G.GATE_COPY[m][k], `${m}.${k}`);
  assert.match(G.GATE_COPY.collection_only.notEligible, /only to holders of The Secret Journals/);
  assert.equal(G.GATE_COPY.collection_only.cta.href, '/store/dune-saga-collection/');
});
test('gate: licenseAccess reads mainnet GraphQL with the exact type filter, paginates, fails closed', async () => {
  const sent = [];
  const pages = [{ nodes: [node('fish-speakers')], pageInfo: { hasNextPage: true, endCursor: 'c1' } }, { nodes: [node('dune-saga-collection')], pageInfo: { hasNextPage: false } }];
  const f = async (url, init) => { sent.push({ url, v: JSON.parse(init.body).variables }); return { ok: true, json: async () => ({ data: { address: { objects: pages[sent.length - 1] } } }) }; };
  const a = await G.licenseAccess(ADDR, { fetchImpl: f });
  assert.equal(a.eligible, true); assert.equal(sent[0].url, 'https://graphql.mainnet.sui.io/graphql');
  assert.equal(sent[0].v.t, G.MAINNET_DESK_LICENSE_TYPE); assert.equal(sent[1].v.c, 'c1');
  const down = await G.licenseAccess(ADDR, { fetchImpl: async () => { throw new Error('down'); } });
  assert.equal(down.eligible, false); assert.equal(down.error, 'license_check_failed');
  const errs = await G.licenseAccess(ADDR, { fetchImpl: async () => ({ ok: true, json: async () => ({ errors: [{ message: 'x' }] }) }) });
  assert.equal(errs.eligible, false);
});
test('buy: needs a session AND an eligible wallet; testnet by default; mainnet only via the one network switch and only while unpaused + site switch on (Sajan 9:59 PM PT)', async () => {
  const env = { ...ENV, STORE_DB: freshDb() };
  assert.equal((await call('cert-buy-quote', {}, null, {}, env)).reason, 'sign_in_again');
  const r = await signInAs(sk, pk, {}, env);
  const no = await call('cert-buy-quote', {}, r.session, {}, env);
  assert.equal(no.reason, 'not_eligible'); assert.match(no.explain, /The Secret Journals/);
  let asked = null;
  const yes = await call('cert-buy-quote', {}, r.session, { licenseAccess: async () => ({ eligible: true }), certBuyQuote: async (x) => { asked = x; return { ready: false, network: 'testnet', note: 'n' }; } }, env);
  assert.equal(yes.ok, true); assert.equal(yes.chain, 'sui:testnet'); assert.equal(asked.address, ADDR);
  assert.equal(TESTNET_CERT.packageId, IDS.buy.packageId); assert.equal(TESTNET_CERT.issuerId, IDS.buy.issuerId);
  const fake = { core: { listOwnedObjects: async (o) => { assert.equal(o.type, TESTNET_CERT.deskLicenseType); return { objects: [] }; }, getBalance: async () => ({ balance: { balance: '0' } }) } };
  assert.equal((await certBuyQuote({ address: ADDR }, fake)).reason, 'no_testnet_desk_license');
  // mainnet: ids only from the generated file, the network only from certTarget (spice-cert-net.js)
  for (const f of ['../store-core/spice-cert-buy.js', '../store-core/spice-api.js']) assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /sui:mainnet|fullnode\.mainnet/, f);
  const MT = { network: 'mainnet', chain: 'sui:mainnet', testnet: false, packageId: '0x' + '9'.repeat(64), issuerId: '0x' + '8'.repeat(64), deskLicenseType: '0x1::desk_license::DeskLicense', coinType: '0x2::usdc::USDC', price: 100000000n, allowedTemplates: ['dune-saga-collection'] };
  let built = false;
  const mfake = (paused) => ({ core: { getObject: async ({ objectId }) => { assert.equal(objectId, MT.issuerId); return { object: { json: { paused } } }; },
    listOwnedObjects: async () => { built = true; return { objects: [] }; }, getBalance: async () => ({ balance: { balance: '0' } }) } });
  assert.equal((await certBuyQuote({ address: ADDR, env: { SPICE_CERT_MAINNET_SALES: '1' } }, mfake(true), MT)).reason, 'sales_paused', 'on-chain paused');
  assert.equal((await certBuyQuote({ address: ADDR, env: {} }, mfake(false), MT)).reason, 'sales_paused', 'site switch off');
  assert.equal(built, false, 'nothing is built while paused');
  const err = { core: { getObject: async () => { throw new Error('down'); } } };
  assert.equal((await certBuyQuote({ address: ADDR, env: { SPICE_CERT_MAINNET_SALES: '1' } }, err, MT)).reason, 'sales_paused', 'read error = paused');
  assert.equal((await certBuyQuote({ address: ADDR, env: { SPICE_CERT_MAINNET_SALES: '1' } }, mfake(false), MT)).reason, 'no_desk_license', 'unpaused + switch on reaches the license check');
});
test('copy: buy page, home and nav say holders of The Secret Journals; testnet banner; target not promise; no "guaranteed"; payout pricing', () => {
  const buy = readFileSync(new URL('../src/pages/certificates/index.astro', import.meta.url), 'utf8');
  const home = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
  const holder = readFileSync(new URL('../src/pages/certificates/holder/index.astro', import.meta.url), 'utf8');
  const data = readFileSync(new URL('../src/data/certificates.ts', import.meta.url), 'utf8');
  const site = readFileSync(new URL('../src/data/site.ts', import.meta.url), 'utf8');
  assert.match(data, /Testnet preview: no real purchases yet\./); assert.match(buy, /TESTNET_BANNER/); assert.match(home, /TESTNET_BANNER/);
  assert.match(buy, /Sign in with wallet/); assert.match(site, /\/certificates\/', label: 'Certificates'/);
  assert.match(home, /available only to \{cert\.who\}/); assert.match(G.copy().who, /The Secret Journals/);
  for (const t of [buy, home, holder, data]) { assert.doesNotMatch(t, /guarantee/i); }
  assert.match(buy, /target, not a promise/); assert.match(home, /target, not a promise/);
  assert.match(holder, /PAYOUT_PRICING/);
  assert.match(H.withdrawalMessage('h', 'n', { serial: 1, asset: 'USDC', payoutAddress: ADDR }), /Payout price: Bitcoin payouts are priced at the market price on the exchange we use for payouts, when the payout is made, and sent by hand after approval\./);
  // Footer: option A verbatim (Sajan 8:37 PM PT), selected only when certificates are launched; LIVE text otherwise (SJ2).
  const base = readFileSync(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8');
  assert.ok(site.includes('Our agent templates are educational software: they are not financial, investment, legal or tax advice, and they promise no returns.'));
  assert.ok(site.includes('Spice Certificates are a separate, holders-only offering with a stated 8% yearly target paid in bitcoin sats. That target is not guaranteed, a certificate is not a bank deposit and is not insured, and you can lose some or all of what you pay; see the Spice Certificate terms. Nothing else on this site is an offer or a solicitation to buy or sell any asset.'));
  assert.match(site, /export const DISCLAIMER = CERTS_LIVE_AT_BUILD \? DISCLAIMER_OPTION_A : DISCLAIMER_LIVE;/);
  const optA = site.slice(site.indexOf('DISCLAIMER_OPTION_A ='), site.indexOf('export const DISCLAIMER = '));
  assert.doesNotMatch(optA, /leverage|borrow/i, 'HOLD (Tleilaxu 8:47 PM): no leverage/borrowing claim in option A');
  // Final leverage wording (Sajan 8:53 PM PT via Tleilaxu), verbatim.
  assert.match(base, /no leverage, no hurry, think in decades\./);
  assert.match(home, /HOME_FUNDS_LINE_AT_BUILD\s*\? \{ title: 'No leverage, no borrowed money', glyph: 'shield', text: 'The Spice Melange trading desk trades on Sui with no leverage and no borrowed money\.' \}\s*: \{ title: 'No leverage', glyph: 'shield', text: 'No margin, no futures, no borrowed spice on the trading desk\. Leverage turns a bad week into a lost path\.' \}/);
  assert.match(home, /Quietly and patiently\./);
  assert.doesNotMatch((home + base).replace("No margin, no futures, no borrowed spice on the trading desk.", ''), /No leveraged trading|borrowed spice|borrowing against tomorrow|no leveraged trading/); // live card text is the SJ21 fallback
});
test('privacy (SC16): names the server-side Sui reads and the holder data', () => {
  const p = readFileSync(new URL('../src/pages/privacy.astro', import.meta.url), 'utf8');
  for (const s of ['graphql.mainnet.sui.io', 'graphql.testnet.sui.io', 'fullnode.testnet.sui.io', 'payout address', 'signature', '30 days', 'display name', 'wallet address']) assert.ok(p.includes(s), s);
});

test('cert footer line (FOOTER-LINE-v3, Sajan 9:50 PM PT) is exact and renders only on the certificate pages', () => {
  const FILE = new URL('../src/content-static/CERT-FOOTER-LINE-v3.txt', import.meta.url);
  const FSHA = '4c2757c5a9340cea69a39584b355a20e1ca15b63e9f3f6c8fd2ebd942b108237'; // FOOTER-LINE-v3.txt, Sajan 9:50 PM PT
  const SHARED = '/home/box/agent-data/shared/portfolio-desk/spice-certificates/design/FOOTER-LINE-v3.txt';
  if (existsSync(SHARED) && createHash('sha256').update(readFileSync(SHARED)).digest('hex') === FSHA) assert.ok(readFileSync(SHARED).equals(readFileSync(FILE)));
  assert.equal(createHash('sha256').update(readFileSync(FILE)).digest('hex'), FSHA);
  const LINE = readFileSync(FILE, 'utf8').replace(/\n$/, '');
  const src = readFileSync(new URL('../src/data/certificates.ts', import.meta.url), 'utf8');
  assert.ok(src.includes(JSON.stringify(LINE)));
  assert.doesNotMatch(src, /liquidation risk|its own funds only|personal brokerage|may borrow against bitcoin/, 'the 8:36, 8:53 and 9:19 PM lines are gone');
  for (const f of ['certificates/index.astro', 'certificates/holder/index.astro'])
    assert.match(readFileSync(new URL('../src/pages/' + f, import.meta.url), 'utf8'), /<CertFooterHook \/>/, f);
  assert.doesNotMatch(readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8'), /CertFooterHook/);
});
// Siona SJ20: broad repayment pattern over sources, lesson content, catalog and the built dist.
const REPAY = /(debt|loan)s? ?repay|repay(s|ing|ment)?( of| it| the| a| our| its)* (debt|loan)|pay(s|ing)?[ -]?down|paydown|towards? (the |a |our )?(loan|debt)|other obligations/i;
test('use of proceeds: no debt or loan repayment / pay down anywhere (sources, lessons, catalog, dist) (Sajan 8:53 PM PT; Siona SJ20)', () => {
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const root = fileURLToPath(new URL('..', import.meta.url));
  const files = [
    ...['src/pages', 'src/data', 'src/content-static', 'src/components', 'src/layouts', 'content'].flatMap((d) => walk(join(root, d))),
    join(root, 'store-core/lessons-content.js'), join(root, 'store-core/catalog-wording.js'), join(root, 'public/llms.txt'),
    ...(existsSync(join(root, 'dist')) ? walk(join(root, 'dist')).filter((f) => /\.(html|js|json|txt|xml)$/.test(f)) : []),
  ].filter((f) => !/LICENSE-2026\.10\.10\.md$/.test(f) && existsSync(f));
  const LI = '/home/box/agent-data/shared/portfolio-desk/spice-certificates/LESSON-INSERTS.md';
  // explicit negations are the approved wording ("Certificate money is never used to repay debt."), not use-of-proceeds claims
  const NEG = /(is )?never (used to )?repays? (the )?(debt|loan)|with no other obligations/gi;
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8').replace(NEG, ''), REPAY, f.slice(root.length));
  if (existsSync(LI)) {
    // reviewer notes and explicit negations ("never repays the loan", "no other obligations") are not use-of-proceeds claims
    const body = readFileSync(LI, 'utf8').split('\n').filter((l) => !/^(- \*\*HC9|HC1 funding)/.test(l)).join('\n').replace(NEG, '');
    assert.doesNotMatch(body, REPAY, 'LESSON-INSERTS.md');
  }
  for (const bad of ['to pay down the loan', 'paydown', 'repay the loan', 'loan repayment', 'debt repayment', 'towards the loan', 'repaying debt'])
    assert.match(bad, REPAY, `pattern must catch "${bad}"`);
  for (const ok of ['We never have to repay you on a set date.', 'Certificate money is never used to repay debt.'.replace(NEG, ''), 'Cash for bills or debt payments stays untouchable.', 'carries heavy bitcoin and debt exposure'])
    assert.doesNotMatch(ok, REPAY, `pattern must allow "${ok}"`);
  assert.match(readFileSync(new URL('../src/content-static/SPICE-CERT-TERMS.md', import.meta.url), 'utf8'), /\*\*38%\*\* is held as a USDC reserve on Sui\. [\s\S]*It pays withdrawals\.[\s\S]*We never borrow to pay withdrawals\./); // v2026.10.10.3
});
test('cert terms pin: one line to swap; 2026.10.10.3 is final (Sajan 9:50 PM PT)', async () => {
  const src = readFileSync(new URL('../src/data/cert-terms.ts', import.meta.url), 'utf8');
  const pinLines = src.split('\n').filter((l) => /^export const CERT_TERMS_/.test(l));
  assert.equal(pinLines.length, 1, 'sha, version and status live on ONE line');
  const status = src.match(/CERT_TERMS_STATUS: 'interim' \| 'final' = '(interim|final)'/)?.[1];
  assert.ok(status, 'status present');
  const { wranglerVar } = await import('../scripts/wrangler-var.mjs');
  const prodCerts = wranglerVar(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'), 'SPICE_CERTS_LIVE', 'production');
  if (prodCerts === '1') assert.equal(status, 'final', 'SPICE_CERTS_LIVE=1 in production needs the FINAL (Sajan-approved launch) terms pin');
  assert.equal(status, 'final', 'v2026.10.10.3 (2f6f6eab) approved by Sajan 9:50 PM PT as the launch text');
});
test('SJ17: a certs-off build serves no certificate content (only _headers config may mention it); gate strips orphan chunks', () => {
  const cfg = readFileSync(new URL('../astro.config.mjs', import.meta.url), 'utf8');
  assert.match(cfg, /SJ17/); assert.match(cfg, /unreferenced _astro chunk/); assert.match(cfg, /certificate content left in a certs-off build/);
  const root = fileURLToPath(new URL('../dist/', import.meta.url));
  if (!existsSync(root) || existsSync(join(root, 'certificates'))) return; // only meaningful for a certs-off build
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const hits = walk(root).filter((f) => !f.endsWith('/_headers') && /certificat/i.test(readFileSync(f, 'latin1')));
  assert.deepEqual(hits.map((f) => f.slice(root.length)), [], 'certificat hits outside _headers');
  for (const f of walk(root).filter((x) => x.endsWith('.html')))
    for (const [, a] of readFileSync(f, 'utf8').matchAll(/["'(](\/_astro\/[^"' )]+)/g)) assert.ok(existsSync(join(root, a)), `${f.slice(root.length)} -> ${a} missing`);
});
test('SJ21: home funds line is behind HOME_FUNDS_LINE_LIVE, ON in production (Sajan 9:18 PM PT), built from wrangler.toml by deploy.sh and walrus-update.sh (SJ18)', async () => {
  const { wranglerVar } = await import('../scripts/wrangler-var.mjs');
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.equal(wranglerVar(toml, 'HOME_FUNDS_LINE_LIVE', 'production'), '1');
  assert.equal(wranglerVar(toml, 'HOME_FUNDS_LINE_LIVE', 'preview'), '1');
  for (const sh of ['deploy.sh', 'walrus-update.sh']) {
    const t = readFileSync(new URL('../scripts/' + sh, import.meta.url), 'utf8');
    assert.match(t, /unset STORE_SINGLES_FOR_SALE SPICE_CERTS_LIVE HOME_FUNDS_LINE_LIVE/, sh);
    for (const k of ['STORE_SINGLES_FOR_SALE', 'SPICE_CERTS_LIVE', 'HOME_FUNDS_LINE_LIVE']) assert.match(t, new RegExp(`${k}="\\$\\(node scripts/wrangler-var\\.mjs ${k} `), `${sh} ${k}`);
  }
  assert.match(readFileSync(new URL('../scripts/walrus-update.sh', import.meta.url), 'utf8'), /wrangler-var\.mjs SPICE_CERTS_LIVE production/);
  const { homeFundsLineLive } = await import('../store-core/launch.js');
  assert.equal(homeFundsLineLive({}), false); assert.equal(homeFundsLineLive({ HOME_FUNDS_LINE_LIVE: '1' }), true);
  const idx = new URL('../dist/index.html', import.meta.url);
  if (existsSync(idx) && !existsSync(new URL('../dist/certificates/', import.meta.url)) && process.env.HOME_FUNDS_LINE_LIVE !== '0') {
    const h = readFileSync(idx, 'utf8'); // a production-like build (flag ON in production)
    assert.match(h, /No leverage, no borrowed money/); assert.match(h, /trades on Sui with no leverage and no borrowed money\./); assert.doesNotMatch(h, /own funds only/); assert.doesNotMatch(h, /No margin, no futures/);
  }
});



test('SJ2 launch flag: one value (wrangler.toml), OFF in production, ON in preview; API + legacy route 404 when off; pages removed from the build', async () => {
  const { wranglerVar } = await import('../scripts/wrangler-var.mjs');
  const w = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.equal(wranglerVar(w, 'SPICE_CERTS_LIVE', 'production'), '1', 'ON: Sajan 9:59 PM PT'); assert.equal(wranglerVar(w, 'SPICE_CERTS_LIVE', 'preview'), '1');
  const { certsLive } = await import('../store-core/launch.js');
  assert.equal(certsLive({}), false); assert.equal(certsLive({ SPICE_CERTS_LIVE: '1' }), true);
  const api = await import('../functions/api/certificates/[action].js');
  assert.equal((await api.onRequest({ params: { action: 'challenge' }, env: {}, request: new Request('https://x/api/certificates/challenge', { method: 'POST' }) })).status, 404);
  assert.match(readFileSync(new URL('../astro.config.mjs', import.meta.url), 'utf8'), /rmSync\(new URL\('certificates\/', dir\)/);
  for (const [f, re] of [['../src/data/site.ts', /CERTS_LIVE_AT_BUILD \? \[\{ href: 'https:\/\/thespicemelange\.org\/certificates\/'/], ['../src/pages/index.astro', /\{CERTS_LIVE_AT_BUILD && \(/], ['../src/pages/privacy.astro', /\{CERTS_LIVE_AT_BUILD && \(<>/]])
    assert.match(readFileSync(new URL(f, import.meta.url), 'utf8'), re, f);
  assert.doesNotMatch(w, /answers 503 there/, 'SJ: stale 503 comment removed');
});

test('SJ10: a rejected or paid outcome releases the withdrawal lock; a rejected certificate can request again', async () => {
  const db = freshDb();
  assert.equal(await H.lockPending(db, 7, 'r1', Date.now()), null);
  assert.equal(await H.lockPending(db, 7, 'r2', Date.now()), 'already_requested_or_not_active');
  assert.equal(await H.releasePending(db, 7), true);
  assert.equal(await H.lockPending(db, 7, 'r3', Date.now()), null);
  assert.deepEqual(H.OUTCOME_STATUSES, ['rejected', 'paid']);
  const api = readFileSync(new URL('../store-core/spice-api.js', import.meta.url), 'utf8');
  assert.match(api, /OUTCOME_STATUSES\.includes\(cert\.withdrawal_status\)\) await H\.releasePending\(db, serial\)/);
  assert.match(api, /\['none', 'rejected'\]\.includes\(cert\.withdrawal_status\)/);
});


test('Spice Certificate terms (Sajan approved 8:40 PM PT 10/10): sha pinned, rendered at /certificates/terms/, linked from buy, holder and footer', () => {
  const b = readFileSync(new URL('../src/content-static/SPICE-CERT-TERMS.md', import.meta.url));
  const pin = readFileSync(new URL('../src/data/cert-terms.ts', import.meta.url), 'utf8').match(/CERT_TERMS_SHA256 = '([0-9a-f]{64})'/)[1];
  assert.equal(createHash('sha256').update(b).digest('hex'), pin);
  assert.equal(pin, '2f6f6eaba83c64e7c6dfe6c015bee93d354ede2529d1cf77518d56eaf1e7c3ec', 'TERMS-FINAL-v3.md v2026.10.10.3, Sajan 9:50 PM PT');
  assert.match(b.toString('utf8'), /^Version 2026\.10\.10\.3 /m);
  // Compare with the shared file only while it still has the approved bytes (it was edited after approval before).
  const SRC = '/home/box/agent-data/shared/portfolio-desk/spice-certificates/design/TERMS-FINAL-v3.md';
  if (existsSync(SRC) && createHash('sha256').update(readFileSync(SRC)).digest('hex') === pin) assert.ok(readFileSync(SRC).equals(b));
  // superseded terms files / pins are never referenced by the site
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
  const root = fileURLToPath(new URL('..', import.meta.url));
  for (const f of ['src', 'store-core', 'functions', 'scripts', 'public', 'docs', 'content'].flatMap((d) => walk(join(root, d))).filter((f) => /\.(ts|js|mjs|astro|md|txt|json)$/.test(f)))
    assert.doesNotMatch(readFileSync(f, 'utf8'), new RegExp(['TERMS-plain', 'TERMS-DRAFT', 'design/TERMS\\.md', 'TERMS-FINAL\\.md', 'FOOTER-LINE-v2', '4b19' + 'db06', 'f876' + '94b7', '93bf' + 'bef2', '64ff' + '22a9'].join('|')), f.slice(root.length));
  assert.match(readFileSync(new URL('../src/pages/certificates/terms/index.astro', import.meta.url), 'utf8'), /SPICE-CERT-TERMS\.md/);
  for (const f of ['certificates/index.astro', 'certificates/holder/index.astro'])
    assert.match(readFileSync(new URL('../src/pages/' + f, import.meta.url), 'utf8'), /href="\/certificates\/terms\/" data-cert-terms-link/, f);
  assert.match(readFileSync(new URL('../src/components/DisclaimerText.astro', import.meta.url), 'utf8'), /https:\/\/thespicemelange\.org\/certificates\/terms\//);
  for (const f of ['../src/pages/certificates/index.astro', '../src/pages/certificates/holder/index.astro'])
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /Draft terms|DRAFT-2026/);
});

test('testnet cert ids: one source of truth, matches the Ixians deploy files; buy = v4, holders = v3 e2e', (t) => {
  const dir = '/workspace/ixians/spice-certificates';
  // Exact match with the deploy files whenever they are present: any later republish fails this test until the ids file is re-synced
  // (node scripts/sync-spice-cert-ids.mjs) and reviewed.
  // buy = exact. holders (e2e mirror) = exact unless the certificate team has republished the e2e mirror since the last reviewed sync;
  // then report it (republished as 'v5 mirror' 9:34 PM PT 10/10; the holder preview stays on the reviewed v3 e2e until re-synced).
  if (existsSync(`${dir}/deploy.testnet.json`)) {
    const fresh = buildIds(dir);
    // buy: exact for the reviewed design (v4, Siona 9:28 PM PT); a newer certificate design (v5 published 9:40 PM PT) is reported, not followed.
    if (fresh.buy.design === IDS.buy.design) assert.deepEqual(IDS.buy, fresh.buy);
    else t.diagnostic(`certificate deploy file is now ${fresh.buy.design} (${fresh.buy.packageId.slice(0, 10)}…); site buy page stays on reviewed ${IDS.buy.design} ${IDS.buy.packageId.slice(0, 10)}… until a reviewed sync`);
    if (fresh.holders.design === IDS.holders.design) assert.deepEqual(IDS.holders, fresh.holders);
    else t.diagnostic(`e2e holders mirror is now ${fresh.holders.design} (${fresh.holders.packageId.slice(0, 10)}…); site holders stay on reviewed ${IDS.holders.design} ${IDS.holders.packageId.slice(0, 10)}…`);
  }
  assert.equal(IDS.design, 'v4'); assert.equal(IDS.buy.design, 'v4'); assert.equal(IDS.holders.design, 'v3');
  assert.equal(IDS.buy.packageId, '0x1dd210a6592d392d2a44b95f47d6cce1904bafc1c16d191606bd7ab494622328');
  assert.equal(IDS.buy.issuerId, '0x41e6e589d1caaa8a67ca107048912db8c6bfe19e80b54a529ed7367188c86f4b');
  assert.equal(IDS.buy.originalPackageId, IDS.buy.packageId);
  assert.equal(IDS.buy.paymentRefLen, 32, 'v4: canonical payment_ref = raw 32-byte tx digest');
  assert.equal(TESTNET_CERT.packageId, IDS.buy.packageId); assert.equal(TESTNET_CERT.issuerId, IDS.buy.issuerId);
  assert.equal(HOLDER_CERT_TYPE, IDS.holders.certificateType);
  assert.equal(IDS.buy.payee, '0x88e8516771e71da54a7449a0a46e6a0c4af71ef71ac4d379847319c7e18a780f');
  // The site never builds or passes a payment_ref: the buy page uses purchase<T>(Issuer, DeskLicense, Coin, Clock), where the
  // contract records ctx.digest() (32 bytes) itself. The watcher path (MintCap + payment_ref) is server-side only, not on the site.
  const buy = readFileSync(new URL('../store-core/spice-cert-buy.js', import.meta.url), 'utf8');
  assert.match(buy, /arguments: \[tx\.object\(t\.issuerId\), tx\.object\(lic\.objectId \?\? lic\.id\), coinWithBalance\(\{ type: t\.coinType, balance: t\.price \}\), tx\.object\.clock\(\)\]/);
  assert.doesNotMatch(buy, /payment_ref|mint_from_payment|MintCap/i);
  for (const f of ['../store-core/spice-cert-buy.js', '../store-core/spice-api.js', '../wrangler.toml', '../src/pages/certificates/index.astro', '../src/pages/certificates/holder/index.astro']) {
    const t = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(t, /0x8b5476e5|0x33bf1e62|0x0c6baf07|0x448d2b7c|0x494e20b7|0xc281ac76|0x26887d83/, `stale cert id in ${f}`);
  }
});

test('SJ3 on the buy path: only a dune-saga-collection, non-test license is used', async () => {
  assert.equal(licenseQualifies({ template_id: 'dune-saga-collection', order_id: 'SM-AB12' }), true);
  assert.equal(licenseQualifies({ template_id: 'moneo', order_id: 'SM-AB12' }), false);
  assert.equal(licenseQualifies({ template_id: 'dune-saga-collection', order_id: 'SM-TEST-DESK-1' }), false);
  const fake = { core: { listOwnedObjects: async () => ({ objects: [{ objectId: '0x1', json: { template_id: 'moneo', order_id: 'SM-1' } }] }), getBalance: async () => ({ balance: { balance: '0' } }) } };
  assert.equal((await certBuyQuote({ address: ADDR }, fake)).reason, 'testnet_license_not_eligible');
});

test('join-the-desk and home lines (Sajan 9:50/9:51 PM PT) follow SPICE_CERTS_LIVE; certs off keeps the current lines', () => {
  const F = new URL('../src/content-static/JOIN-PAGE-LINE.txt', import.meta.url);
  assert.equal(createHash('sha256').update(readFileSync(F)).digest('hex'), 'b5d3367228c2dd71c6d47ccd34624f3691ca7fd092045caa52d559bd4e929a7b');
  const JOIN = readFileSync(F, 'utf8').replace(/\n$/, '');
  const j = readFileSync(new URL('../src/pages/join-the-desk.astro', import.meta.url), 'utf8');
  assert.ok(j.includes('CERTS_LIVE_AT_BUILD ? ' + JSON.stringify(JOIN)), 'join line verbatim behind the launch flag');
  assert.match(j, /: 'The desk never holds anyone’s keys or money\. There is no custody, no pooled account and no copy-trading\.'/);
  const h = readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8');
  assert.ok(h.includes("? 'A bitcoin practice desk run by Sajan Melcher. The templates are education. Spice Certificates are a separate holders-only offering with their own terms.'"));
  assert.ok(h.includes(": 'The Spice Melange is Sajan Melcher’s personal bitcoin desk. It is a practice, not a fund.'"));
  const holder = readFileSync(new URL('../src/pages/certificates/holder/index.astro', import.meta.url), 'utf8');
  assert.match(holder, /38% USDC reserve on Sui, 62% STRC on a third-party platform/); assert.doesNotMatch(holder, /cash reserve/);
  // built output matches the build's flag
  const d = (p) => new URL('../dist/' + p, import.meta.url);
  if (existsSync(d('index.html')) && existsSync(d('join-the-desk/index.html'))) {
    const on = existsSync(d('certificates/terms/index.html'));
    assert.equal(readFileSync(d('index.html'), 'utf8').includes('A bitcoin practice desk run by Sajan Melcher.'), on);
    assert.equal(readFileSync(d('join-the-desk/index.html'), 'utf8').includes('The desk holds money only for Spice Certificates'), on);
    assert.equal(readFileSync(d('join-the-desk/index.html'), 'utf8').includes('There is no custody, no pooled account'), !on);
  }
});

test('v3 restatement lines (Tleilaxu, Sajan 9:55 PM PT) are verbatim and placed; no Coinbase anywhere on the cert pages', async () => {
  const C = await import('../src/data/certificates.ts').catch(() => null);
  const data = readFileSync(new URL('../src/data/certificates.ts', import.meta.url), 'utf8');
  const L = {
    WITHDRAW_STEPS: 'To withdraw: send the on-chain redemption request from your wallet (a small Sui gas fee), sign the request on this page with the same wallet, and confirm by email from the address on file to reserve@thespicemelange.org. Sajan approves each payout by hand. We aim to pay within 6 hours of a verified request; that is a target, not a promise.',
    WITHDRAW_BOX: 'Withdrawals need an on-chain request, a signed request, email confirmation and manual approval.',
    RATE_IN_PRACTICE: 'about 7.3% to 7.9% a year in practice, depending on the bitcoin price.',
    PAYOUT_PRICING: 'Bitcoin payouts are priced at the market price on the exchange we use for payouts, when the payout is made, and sent by hand after approval.',
    BUY_NO_CAP: 'There is no cap on how many certificates are issued.',
    BUY_PAUSE: 'We can pause new sales or stop the automated minting key at any time. Pausing never blocks a withdrawal request.',
    BUY_WRONG_PAYMENT: 'Payments sent the wrong way (wrong amount, from an exchange, or from a wallet without a qualifying license) get no certificate. We refund them by hand and pay the network fee.',
  };
  for (const [k, v] of Object.entries(L)) assert.ok(data.includes(`export const ${k} = ${JSON.stringify(v)};`), k);
  const holder = readFileSync(new URL('../src/pages/certificates/holder/index.astro', import.meta.url), 'utf8');
  const buy = readFileSync(new URL('../src/pages/certificates/index.astro', import.meta.url), 'utf8');
  for (const k of ['WITHDRAW_STEPS', 'WITHDRAW_BOX', 'RATE_IN_PRACTICE', 'PAYOUT_PRICING']) assert.match(holder, new RegExp(`\\{${k}\\}`), 'holder ' + k);
  for (const k of ['WITHDRAW_BOX', 'BUY_NO_CAP', 'BUY_PAUSE', 'BUY_WRONG_PAYMENT', 'PAYOUT_PRICING']) assert.match(buy, new RegExp(`\\{${k}\\}`), 'buy ' + k);
  assert.doesNotMatch(holder, /about 7\.9% in practice|<b>or<\/b> email|verified, signed request and Sajan/);
  // the on-chain step comes BEFORE the signed-message step
  assert.ok(holder.indexOf('data-rd-btn>1. Send on-chain redemption request') > 0 && holder.indexOf('data-rd-btn>1.') < holder.indexOf('data-wd-btn>{TEST ? \'2. Sign withdrawal request'));
  // no Coinbase on any cert page source, the signed message, or the built cert pages
  const srcs = [data, holder, buy, readFileSync(new URL('../src/pages/certificates/terms/index.astro', import.meta.url), 'utf8'), readFileSync(new URL('../src/content-static/CERT-FOOTER-LINE-v3.txt', import.meta.url), 'utf8'),
    H.withdrawalMessage('h', 'n', { serial: 1, asset: 'BTC', payoutAddress: 'bc1qxyz' })];
  for (const t of srcs) assert.doesNotMatch(t, /Coinbase/i);
  for (const f of ['certificates/index.html', 'certificates/holder/index.html', 'certificates/terms/index.html']) {
    const u = new URL('../dist/' + f, import.meta.url);
    if (existsSync(u)) { const h = readFileSync(u, 'utf8'); assert.doesNotMatch(h, /Coinbase/i, f);
      if (f.includes('holder')) for (const k of ['WITHDRAW_STEPS', 'WITHDRAW_BOX', 'PAYOUT_PRICING']) assert.ok(h.includes(L[k].replace(/'/g, '&#39;')), 'built ' + k);
      if (f === 'certificates/index.html') for (const k of ['BUY_NO_CAP', 'BUY_PAUSE', 'BUY_WRONG_PAYMENT']) assert.ok(h.includes(L[k]), 'built ' + k); }
  }
});

test('withdrawal step 1: redeem-quote builds request_redemption for the signed-in wallet\'s own certificate; one network switch, mainnet refused until its ids land', async () => {
  const R = await import('../store-core/spice-cert-redeem.js');
  const IDS = JSON.parse(readFileSync(new URL('../store-core/spice-cert-testnet.json', import.meta.url), 'utf8'));
  const t = R.redeemTarget({});
  assert.equal(t.network, 'testnet'); assert.equal(t.packageId, IDS.buy.packageId); assert.equal(t.issuerId, IDS.buy.issuerId);
  assert.equal(R.redeemTarget({ SPICE_CERT_REDEEM_NETWORK: 'testnet' }).network, 'testnet');
  assert.equal(R.redeemTarget({ SPICE_CERT_REDEEM_NETWORK: 'devnet' }), null);
  if (!IDS.mainnet) assert.equal(R.redeemTarget({ SPICE_CERT_REDEEM_NETWORK: 'mainnet' }), null, 'mainnet refused until the generated ids file has it');
  else assert.equal(R.redeemTarget({ SPICE_CERT_REDEEM_NETWORK: 'mainnet' }).packageId, IDS.mainnet.packageId);
  const { wranglerVar } = await import('../scripts/wrangler-var.mjs');
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.equal(wranglerVar(toml, 'SPICE_CERT_REDEEM_NETWORK', 'production'), 'mainnet'); assert.equal(wranglerVar(toml, 'SPICE_CERT_MAINNET_SALES', 'production'), '1'); assert.equal(wranglerVar(toml, 'SPICE_HOLDERS_LIVE', 'production'), '1'); assert.equal(wranglerVar(toml, 'SPICE_HOLDER_SOURCE', 'production'), 'd1'); assert.equal(wranglerVar(toml, 'SPICE_CERT_REDEEM_NETWORK', 'preview'), 'testnet');
  const OWNER = '0x' + 'a'.repeat(64), CERT = '0x' + 'c'.repeat(64);
  let simulated = null;
  const fake = (status = 0) => ({ core: {
    listOwnedObjects: async ({ owner, type }) => { assert.equal(owner, OWNER); assert.equal(type, t.certificateType); return { objects: [{ objectId: CERT, json: { serial: '7', status } }] }; },
    simulateTransaction: async ({ transaction }) => { simulated = transaction; return { $kind: 'Transaction' }; },
  } });
  // no network: toJSON with a client that can't resolve would fail, so stub toJSON via a minimal client-less check
  const q0 = await R.certRedeemQuote({ address: OWNER, serial: 8, asset: 'USDC' }, t, fake());
  assert.equal(q0.ready, false); assert.equal(q0.reason, 'certificate_not_in_this_wallet');
  const q1 = await R.certRedeemQuote({ address: OWNER, serial: 7, asset: 'USDC' }, t, fake(1));
  assert.equal(q1.reason, 'not_active');
  assert.equal((await R.certRedeemQuote({ address: OWNER, serial: 7, asset: 'DOGE' }, t, fake())).reason, 'bad_asset');
  const q2 = await R.certRedeemQuote({ address: OWNER, serial: 7, asset: 'BTC' }, t, fake()).catch((e) => ({ err: e }));
  assert.ok(simulated, 'dry-run happens before anything is handed to the wallet');
  const d = simulated.getData();
  const mc = d.commands[0].MoveCall;
  assert.equal(mc.package, t.packageId); assert.equal(mc.module, 'certificate'); assert.equal(mc.function, 'request_redemption');
  assert.equal(d.sender, OWNER);
  // API: preview-only holder action, needs a session
  const api = readFileSync(new URL('../store-core/spice-api.js', import.meta.url), 'utf8');
  assert.match(api, /HOLDER_ACTIONS = new Set\(\[[^\]]*'redeem-quote'/);
  assert.match(api, /if \(action === 'redeem-quote'\) \{[\s\S]*redeemTarget\(env\)[\s\S]*address: s\.address/);
});

test('mainnet ids (v6) come only from deploy.mainnet.json via the generated file; buy page + holder reads + redemption follow the one switch; sales paused', async () => {
  const IDS = JSON.parse(readFileSync(new URL('../store-core/spice-cert-testnet.json', import.meta.url), 'utf8'));
  const { pickMainnet } = await import('../scripts/sync-spice-cert-ids.mjs');
  const F = '/workspace/ixians/spice-certificates/deploy.mainnet.json';
  if (existsSync(F)) assert.deepEqual(IDS.mainnet, pickMainnet(JSON.parse(readFileSync(F, 'utf8'))));
  assert.equal(IDS.mainnet.packageId, '0x294b4ff76830aaace850ba390fad5f2bb7692a36cb5b4b4f078590a0bb34e24f');
  assert.equal(IDS.mainnet.issuerId, '0x7fb5656aa9d4a504361d683fe0183df3e33b56a3e58e8c13714dc19fc5421319');
  const G = await import('../store-core/spice-gate.js');
  assert.equal(IDS.mainnet.deskLicenseType, G.MAINNET_DESK_LICENSE_TYPE, 'buy uses the same DeskLicense type the gate checks');
  const N = await import('../store-core/spice-cert-net.js');
  const m = N.certTarget('mainnet'); assert.equal(m.chain, 'sui:mainnet'); assert.equal(m.testnet, false); assert.equal(m.price, 100000000n);
  assert.equal(N.certTarget('devnet'), null);
  const R = await import('../store-core/spice-cert-redeem.js');
  assert.equal(R.redeemTarget({ SPICE_CERT_REDEEM_NETWORK: 'mainnet' }).packageId, IDS.mainnet.packageId);
  let q; const f = async (u, o) => { q = { u, body: JSON.parse(o.body) }; return { json: async () => ({ data: { address: { objects: { nodes: [] } } } }) }; };
  await ownedSerials({ SPICE_CERT_REDEEM_NETWORK: 'mainnet' }, ADDR, f);
  assert.equal(q.u, 'https://graphql.mainnet.sui.io/graphql'); assert.equal(q.body.variables.t, IDS.mainnet.certificateType);
  // sales-status endpoint: public, live paused flag, paused message
  const st = await call('cert-sales-status', {}, null, { issuerPaused: async (t) => { assert.equal(t.issuerId, IDS.mainnet.issuerId); return true; }, client: {} }, { ...ENV, SPICE_CERT_REDEEM_NETWORK: 'mainnet' });
  assert.equal(st.ok, true); assert.equal(st.paused, true); assert.equal(st.sales_open, false); assert.match(st.message, /^Sales are paused. Don't send USDC to any address; payments made while paused get no certificate and are refunded by hand. Pausing never blocks a withdrawal request.$/);
  const st2 = await call('cert-sales-status', {}, null, { issuerPaused: async () => false, client: {} }, { ...ENV, SPICE_CERT_REDEEM_NETWORK: 'mainnet' });
  assert.equal(st2.sales_open, false, 'unpaused on-chain but SPICE_CERT_MAINNET_SALES off');
  // built mainnet pages carry no testnet banner (checked when the build is a mainnet build)
  const b = new URL('../dist/certificates/index.html', import.meta.url);
  if (existsSync(b) && readFileSync(b, 'utf8').includes('data-sales-status')) {
    for (const p of ['certificates/index.html', 'certificates/holder/index.html', 'index.html'])
      assert.doesNotMatch(readFileSync(new URL('../dist/' + p, import.meta.url), 'utf8'), /Testnet preview|TESTNET PREVIEW|tUSDC/, p);
    assert.ok(readFileSync(b, 'utf8').includes(IDS.mainnet.packageId.slice(0, 6)) && readFileSync(b, 'utf8').includes(IDS.mainnet.issuerId.slice(-4)));
  }
});

// ---------------------------------------------------------------- production holder records (D1, migrations/0012)
import { ledgerSql, mintRowSql, followOnce } from '../scripts/spice-holder-sync.mjs';
const prodDb = () => makeD1([new URL('../migrations/0011_spice_nonces.sql', import.meta.url), new URL('../migrations/0012_spice_holder_rows.sql', import.meta.url)]);
const PRODH = () => ({ SUI_NETWORK: 'mainnet', SPICE_SESSION_SECRET: SECRET, SPICE_HOLDERS_LIVE: '1', SPICE_HOLDER_SOURCE: 'd1', SPICE_CERT_REDEEM_NETWORK: 'mainnet', STORE_DB: prodDb() });
const runSql = (db, list) => { for (const s of list) db.raw.exec(s); };

test('prod holders: zero certificates renders cleanly (empty D1, empty on-chain read)', async () => {
  const env = PRODH();
  assert.equal(gate(env), null, 'holder data on in production with SPICE_HOLDERS_LIVE=1');
  const r = await signInAs(sk, pk, { ownedSerials: async () => [] }, env);
  assert.equal(r.ok, true); assert.deepEqual(r.view.certificates, []); assert.equal(r.view.network, 'mainnet'); assert.equal(r.view.preview, false);
  assert.equal(r.view.totals.principal_usd, 0);
  // push-ledger with no spice_certificates block yet: meta only, still empty
  runSql(env.STORE_DB, ledgerSql({ schema_version: 'spice_certificates.v1', network: 'mainnet', rows: [] }, { holders: {} }, 'mainnet'));
  const me = await call('me', {}, r.session, { ownedSerials: async () => [] }, env);
  assert.equal(me.ok, true); assert.deepEqual(me.view.certificates, []);
  for (const a of ['wallet', 'trade-quote']) assert.equal((await call(a, {}, r.session, {}, env)).reason, 'preview_only', `${a} stays testnet-preview only`);
});
test('prod holders: a new mint shows at once (on-chain fallback), the watcher row, then Hwi\'s ledger row replaces it', async () => {
  const env = PRODH();
  const r = await signInAs(sk, pk, { ownedSerials: async () => [7] }, env);
  assert.deepEqual(r.view.certificates.map((c) => [c.serial, c.principal_usd, c.accrued_sats, c.status, c.withdrawal_status]), [[7, '100.00', 0, 'active', 'none']], 'minimal row before any write');
  runSql(env.STORE_DB, [mintRowSql('mainnet', 7, ADDR)]);
  let row = env.STORE_DB.raw.prepare('SELECT * FROM spice_holder_rows WHERE serial = 7').get();
  assert.equal(row.source, 'watcher'); assert.equal(row.owner_address, ADDR); assert.equal(row.principal_usd, '100.00'); assert.equal(row.status, 'active');
  runSql(env.STORE_DB, [mintRowSql('mainnet', 7, '0x' + '9'.repeat(64))]); // replay never overwrites
  assert.equal(env.STORE_DB.raw.prepare('SELECT owner_address FROM spice_holder_rows WHERE serial = 7').get().owner_address, ADDR);
  const tok = 'T'.repeat(43);
  runSql(env.STORE_DB, ledgerSql({ schema_version: 'spice_certificates.v1', network: 'mainnet', as_of: '2026-10-11T16:05:00-07:00', btc_price_usd: '60000.00', price_source: 'fix', rows: [
    { serial: 7, holder_ref: 'H-MN-0001', principal_usd: '100.00', accrued_sats: 36, value_usd: '0.02', status: 'active', withdrawal_status: 'none', token_hash: await tokenHash(tok) }] },
    { holders: { 'H-MN-0001': { display_name: 'First Holder' } } }, 'mainnet'));
  row = env.STORE_DB.raw.prepare('SELECT * FROM spice_holder_rows WHERE serial = 7').get();
  assert.equal(row.source, 'ledger'); assert.equal(row.accrued_sats, 36);
  const me = await call('me', {}, r.session, { ownedSerials: async () => [7] }, env);
  assert.equal(me.view.certificates[0].accrued_sats, 36); assert.equal(me.view.display_name, 'First Holder'); assert.equal(me.view.as_of, '2026-10-11T16:05:00-07:00');
  const tv = await call('token-view', { serial: 7, token: tok }, null, {}, env);
  assert.equal(tv.ok, true, 'personal links work from D1'); assert.equal(tv.view.mode, 'token_view_only');
  assert.equal((await call('me', {}, r.session, { ownedSerials: async () => [] }, env)).view.certificates.length, 0, 'not owned on-chain = not shown');
});
test('prod holders: signed withdrawal requests are stored privately in D1', async () => {
  const env = PRODH();
  const r = await signInAs(sk, pk, { ownedSerials: async () => [4] }, env);
  const body = { kind: 'withdraw', serial: 4, asset: 'USDC', payoutAddress: '0x' + 'b'.repeat(64) };
  const ch = await call('challenge', body, r.session, {}, env);
  const w = await call('withdraw', { ...body, message: ch.message, signature: signMsg(ch.message) }, r.session, { ownedSerials: async () => [4] }, env);
  assert.equal(w.ok, true, w.reason); assert.equal(w.queued, true); assert.match(w.note, /reserve@thespicemelange\.org/); assert.doesNotMatch(w.note, /preview/i);
  const rec = env.STORE_DB.raw.prepare('SELECT * FROM spice_withdraw_requests').get();
  assert.equal(rec.network, 'mainnet'); assert.equal(rec.serial, 4); assert.equal(JSON.parse(rec.record).request_id, w.request_id);
});
test('ledger push validates rows (no PII, schema fields) and the watcher follower writes minimal rows once per mint', async () => {
  assert.throws(() => ledgerSql({ schema_version: 'spice_certificates.v1', rows: [{ serial: 1, holder_ref: 'H-X-001', principal_usd: '100.00', accrued_sats: 0, value_usd: '0.00', status: 'active', withdrawal_status: 'none', token_hash: null, display_name: 'x' }] }, null, 'mainnet'), /PII/);
  assert.throws(() => ledgerSql({ schema_version: 'spice_certificates.v1', network: 'testnet', rows: [] }, null, 'mainnet'), /not mainnet/);
  assert.throws(() => mintRowSql('mainnet', 1, "0x1'; DROP TABLE x;--"), /bad mint row/);
  const { mkdtempSync, writeFileSync } = await import('node:fs'); const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'fol-')); const log = join(dir, 'payments.jsonl');
  writeFileSync(log, [{ decision: 'minted', mint_digest: 'D1', serial: 1 }, { decision: 'refused', payment_digest: 'D2' }, { decision: 'skipped_atomic_purchase', payment_digest: 'D3' }].map((x) => JSON.stringify(x)).join('\n') + '\n');
  const db = prodDb(); const writes = [];
  const write = (_env, sql) => { writes.push(...sql); runSql(db, sql); };
  const events = async (_n, d) => (d === 'D1' ? [{ serial: 1, holder: ADDR }] : d === 'D3' ? [{ serial: 2, holder: '0x' + 'c'.repeat(64) }] : []);
  const w1 = await followOnce({ env: 'preview', network: 'testnet', log, write, events });
  assert.deepEqual(w1.map((e) => e.serial), [1, 2]);
  assert.equal((await followOnce({ env: 'preview', network: 'testnet', log, write, events })).length, 0, 'state file: once per mint');
  assert.deepEqual(db.raw.prepare("SELECT serial, source, principal_usd, accrued_sats, status FROM spice_holder_rows ORDER BY serial").all().map((r) => [r.serial, r.source, r.principal_usd, r.accrued_sats, r.status]),
    [[1, 'watcher', '100.00', 0, 'active'], [2, 'watcher', '100.00', 0, 'active']]);
});
test('Siona 7c7f4a5f follow-ups: privacy mainnet reads + no Coinbase, no preview Seal line, paused warning, no testnet JS in mainnet builds', () => {
  const pv = readFileSync(new URL('../src/pages/privacy.astro', import.meta.url), 'utf8');
  assert.doesNotMatch(pv, /Coinbase/i);
  assert.match(pv, /market price on the exchange we use for payouts, when the payout is made/);
  assert.match(pv, /CERT_TESTNET \? \(<>/); assert.match(pv, /fullnode\.mainnet\.sui\.io/); assert.match(pv, /graphql\.mainnet\.sui\.io/);
  const holder = readFileSync(new URL('../src/pages/certificates/holder/index.astro', import.meta.url), 'utf8');
  assert.doesNotMatch(holder, /not used on this preview/);
  assert.match(holder, /if \(__CERT_TESTNET__\) \{/);
  assert.doesNotMatch(readFileSync(new URL('../src/pages/certificates/index.astro', import.meta.url), 'utf8'), /'sui:testnet'/);
  assert.match(readFileSync(new URL('../astro.config.mjs', import.meta.url), 'utf8'), /__CERT_TESTNET__: JSON\.stringify\(\(process\.env\.SPICE_CERT_REDEEM_NETWORK \?\? 'testnet'\) !== 'mainnet'\)/);
  const b = new URL('../dist/certificates/index.html', import.meta.url);
  if (existsSync(b) && readFileSync(b, 'utf8').includes('data-sales-status')) { // a mainnet build
    const dir = fileURLToPath(new URL('../dist/_astro/', import.meta.url));
    for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) assert.doesNotMatch(readFileSync(join(dir, f), 'utf8'), /sui:testnet/, f);
    const pd = readFileSync(new URL('../dist/privacy/index.html', import.meta.url), 'utf8');
    assert.doesNotMatch(pd, /testnet preview today|Coinbase/); assert.match(pd, /fullnode\.mainnet\.sui\.io/);
    assert.ok(readFileSync(b, 'utf8').includes("Sales are paused. Don&#39;t send USDC to any address; payments made while paused get no certificate and are refunded by hand. Pausing never blocks a withdrawal request."));
  }
});
