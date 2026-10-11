// Spice Certificates holder page (TESTNET PREVIEW): auth, token links, ledger block, withdrawal, wallet, trade, wording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { ed25519 } from '@noble/curves/ed25519';
import * as H from '../store-core/spice-holder.js';
import { handle, gate, signinGate, ownedSerials } from '../store-core/spice-api.js';
import * as G from '../store-core/spice-gate.js';
import { TESTNET_CERT, certBuyQuote } from '../store-core/spice-cert-buy.js';
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
  assert.match(p, /reserve@thespicemelange\.org/); assert.match(p, /never holds your funds or your keys/);
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
  assert.equal(await ownedSerials({}, ADDR, f), null);
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
  const lr = await legacy.onRequestGet({});
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
test('buy: needs a session AND an eligible wallet; builds TESTNET only; no mainnet purchase path anywhere', async () => {
  const env = { ...ENV, STORE_DB: freshDb() };
  assert.equal((await call('cert-buy-quote', {}, null, {}, env)).reason, 'sign_in_again');
  const r = await signInAs(sk, pk, {}, env);
  const no = await call('cert-buy-quote', {}, r.session, {}, env);
  assert.equal(no.reason, 'not_eligible'); assert.match(no.explain, /The Secret Journals/);
  let asked = null;
  const yes = await call('cert-buy-quote', {}, r.session, { licenseAccess: async () => ({ eligible: true }), certBuyQuote: async (x) => { asked = x; return { ready: false, network: 'testnet', note: 'n' }; } }, env);
  assert.equal(yes.ok, true); assert.equal(yes.chain, 'sui:testnet'); assert.equal(asked.address, ADDR);
  assert.equal(TESTNET_CERT.packageId, '0x8b5476e542f09aec64e0cd3b6239ab521d38bb044b3232b11bbf9b8f0693b75a');
  assert.equal(TESTNET_CERT.issuerId, '0x33bf1e62fed97b37592dc8b4ba13a2ee5e2c5bc1542803243c7ebaecb1508462');
  const fake = { core: { listOwnedObjects: async (o) => { assert.equal(o.type, TESTNET_CERT.deskLicenseType); return { objects: [] }; }, getBalance: async () => ({ balance: { balance: '0' } }) } };
  assert.equal((await certBuyQuote({ address: ADDR }, fake)).reason, 'no_testnet_desk_license');
  for (const f of ['../store-core/spice-cert-buy.js', '../store-core/spice-api.js', '../src/pages/certificates/index.astro']) {
    const t = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(t, /sui:mainnet|fullnode\.mainnet|network: 'mainnet'/, f);
  }
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
  assert.match(data, /Coinbase market price at the time of withdrawal/); assert.match(holder, /PAYOUT_PRICING/);
  assert.match(H.withdrawalMessage('h', 'n', { serial: 1, asset: 'USDC', payoutAddress: ADDR }), /Coinbase market price at the time of withdrawal/);
  // Footer wording option A (Sajan 8:37 PM PT 10/10), verbatim from FOOTER-WORDING-DRAFT.md.
  const base = readFileSync(new URL('../src/layouts/Base.astro', import.meta.url), 'utf8');
  assert.ok(site.includes('Our agent templates are educational software: they are not financial, investment, legal or tax advice, and they promise no returns.'));
  assert.ok(site.includes('Spice Certificates are a separate, holders-only offering with a stated 8% yearly target paid in bitcoin sats. That target is not guaranteed, a certificate is not a bank deposit and is not insured, and you can lose some or all of what you pay; see the Spice Certificate terms. Nothing else on this site is an offer or a solicitation to buy or sell any asset.'));
  assert.doesNotMatch(site, /No returns are promised or implied|deposits from the public/);
  assert.equal((site.match(/guarantee/gi) || []).length, 1); assert.match(site, /is not guaranteed/);
  assert.match(base, /no leveraged trading, no hurry, think in decades\./); assert.doesNotMatch(base, /no leverage, no hurry/);
  assert.match(home, /title: 'No leveraged trading'/); assert.match(home, /without trading on borrowed spice\./); assert.doesNotMatch(home, /borrowing against tomorrow/);
});
test('privacy (SC16): names the server-side Sui reads and the holder data', () => {
  const p = readFileSync(new URL('../src/pages/privacy.astro', import.meta.url), 'utf8');
  for (const s of ['graphql.mainnet.sui.io', 'graphql.testnet.sui.io', 'fullnode.testnet.sui.io', 'payout address', 'signature', '30 days', 'display name', 'wallet address']) assert.ok(p.includes(s), s);
});

test('Tleilaxu footer line (Sajan 8:36 PM PT) is exact and renders only on the certificate pages', () => {
  const LINE = 'The Fish Speakers trade with no leverage. To pay certificate withdrawals, the desk may borrow against bitcoin it holds, only as a last resort, and that borrowing carries liquidation risk.';
  const src = readFileSync(new URL('../src/data/certificates.ts', import.meta.url), 'utf8');
  assert.ok(src.includes(JSON.stringify(LINE)));
  for (const f of ['certificates/index.astro', 'certificates/holder/index.astro'])
    assert.match(readFileSync(new URL('../src/pages/' + f, import.meta.url), 'utf8'), /<CertFooterHook \/>/, f);
  assert.doesNotMatch(readFileSync(new URL('../src/pages/index.astro', import.meta.url), 'utf8'), /CertFooterHook/);
});

test('Spice Certificate terms (Sajan approved 8:40 PM PT 10/10): sha pinned, rendered at /certificates/terms/, linked from buy, holder and footer', () => {
  const b = readFileSync(new URL('../src/content-static/SPICE-CERT-TERMS.md', import.meta.url));
  assert.equal(createHash('sha256').update(b).digest('hex'), '4b19db069bdfd4f4d3b441dfabc06bc217f46ab5033c5af9cef307e2aa664540');
  const SRC = '/home/box/agent-data/shared/portfolio-desk/spice-certificates/design/TERMS.md';
  if (existsSync(SRC)) assert.ok(readFileSync(SRC).equals(b), 'site copy must equal Tleilaxu\'s TERMS.md byte for byte');
  assert.match(readFileSync(new URL('../src/pages/certificates/terms/index.astro', import.meta.url), 'utf8'), /SPICE-CERT-TERMS\.md/);
  for (const f of ['certificates/index.astro', 'certificates/holder/index.astro'])
    assert.match(readFileSync(new URL('../src/pages/' + f, import.meta.url), 'utf8'), /href="\/certificates\/terms\/" data-cert-terms-link/, f);
  assert.match(readFileSync(new URL('../src/components/DisclaimerText.astro', import.meta.url), 'utf8'), /https:\/\/thespicemelange\.org\/certificates\/terms\//);
  for (const f of ['../src/pages/certificates/index.astro', '../src/pages/certificates/holder/index.astro'])
    assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /Draft terms|DRAFT-2026/);
});
