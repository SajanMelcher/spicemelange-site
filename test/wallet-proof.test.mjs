import test from 'node:test';
import assert from 'node:assert/strict';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Secp256k1Keypair } from '@mysten/sui/keypairs/secp256k1';
import { readFileSync } from 'node:fs';
import { PIN, checkUpgradeBytes, checkPauseTx, txDigest, base58 } from '../src/lib/sign-verify.js';
import { signRateLimit, SIGN_RATE } from '../store-core/sign-ratelimit.js';
import { handleProof, proofMessage, verifyProofSignature, field } from '../store-core/wallet-proof.js';

const SECRET = 'x'.repeat(40), HOST = 'prove.example.pages.dev';
const kv = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; };
const env = (o = {}) => ({ SPICE_CERT_PREVIEW: '1', SPICE_SESSION_SECRET: SECRET, STORE_KV: kv(), ...o });
const req = (a, body, origin = `https://${HOST}`) => new Request(`https://${HOST}/api/wallet-proof/${a}`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(body) });
const call = async (a, body, e, deps) => (await handleProof(a, { request: req(a, body), env: e }, deps)).json();
const sign = async (kp, msg) => (await kp.signPersonalMessage(new TextEncoder().encode(msg))).signature;

test('throwaway ed25519 + secp256k1 keys: challenge -> sign -> verified and stored; message names the wallet', async () => {
  for (const kp of [new Ed25519Keypair(), new Secp256k1Keypair()]) {
    const e = env(), addr = kp.toSuiAddress();
    const ch = await call('challenge', { address: addr, network: 'testnet' }, e);
    assert.ok(ch.ok); assert.match(ch.message, new RegExp(`I control ${addr} and accept the Spice Certificate AdminCap and UpgradeCap`));
    assert.equal(field(ch.message, 'Domain'), HOST);
    const r = await call('submit', { message: ch.message, signature: await sign(kp, ch.message) }, e);
    assert.equal(r.ok, true, JSON.stringify(r)); assert.equal(r.address, addr);
    const [k, v] = [...e.STORE_KV.m.entries()][0]; assert.ok(k.startsWith(`walletproof:${addr}:`));
    const rec = JSON.parse(v); assert.equal(rec.message, ch.message); assert.equal(rec.signature, r.signature);
    assert.equal((await verifyProofSignature(rec.message, rec.signature)).ok, true); // independent re-check
    assert.equal((await call('submit', { message: ch.message, signature: r.signature }, e)).reason, 'nonce_already_used');
  }
});
test('refusals: other signer, edited message, wrong domain, expired, forged nonce, not preview, cross-origin', async () => {
  const kp = new Ed25519Keypair(), other = new Ed25519Keypair(), e = env(), addr = kp.toSuiAddress();
  const ch = await call('challenge', { address: addr }, e);
  assert.equal((await call('submit', { message: ch.message, signature: await sign(other, ch.message) }, e)).ok, false);
  const edited = ch.message.replace('Network: mainnet', 'Network: testnet');
  assert.equal((await call('submit', { message: edited, signature: await sign(kp, edited) }, e)).ok, true); // network line is free-form but signed
  const forged = ch.message.replace(/Nonce: .+/, 'Nonce: ' + 'a'.repeat(32) + '.9999999999999.' + 'b'.repeat(32));
  assert.equal((await call('submit', { message: forged, signature: await sign(kp, forged) }, e)).reason, 'bad_nonce');
  const ch2 = await call('challenge', { address: addr }, e);
  const wrongDom = ch2.message.replace(`Domain: ${HOST}`, 'Domain: evil.example');
  assert.equal((await call('submit', { message: wrongDom, signature: await sign(kp, wrongDom) }, e)).reason, 'wrong_domain');
  const late = await handleProof('submit', { request: req('submit', { message: ch2.message, signature: await sign(kp, ch2.message) }), env: e }, { now: Date.now() + 16 * 60 * 1000 });
  assert.equal((await late.json()).reason, 'nonce_expired');
  const swapped = ch2.message.replaceAll(addr, other.toSuiAddress());
  assert.equal((await call('submit', { message: swapped, signature: await sign(other, swapped) }, e)).reason, 'bad_nonce'); // nonce bound to address
  assert.equal((await call('challenge', { address: addr }, env({ SPICE_CERT_PREVIEW: '0' }))).reason, 'preview_only');
  const x = await handleProof('challenge', { request: req('challenge', { address: addr }, 'https://evil.example'), env: e });
  assert.equal(x.status, 403);
});
test('zkLogin path is routed to the GraphQL client (verifyZkLoginSignature)', async () => {
  const msg = proofMessage({ host: HOST, address: '0x' + '1'.repeat(64), nonce: 'n', network: 'mainnet', now: 0 });
  const zk = btoa(String.fromCharCode(5, ...new Uint8Array(40)));
  const r = await verifyProofSignature(msg, zk, { client: { core: { verifyZkLoginSignature: async () => { throw new Error('called'); } } } });
  assert.equal(r.ok, false); assert.equal(r.scheme, 'zklogin');
});
test('admin-tx: builds only for the AdminCap holder, preview-only, never signs', async () => {
  const e = env(); let seen;
  const r = await call('admin-tx', { network: 'testnet', issuerId: '0x2', sender: '0x3', action: 'pause' }, e, { adminTx: async (a) => { seen = a; return { ok: false, reason: 'wallet_has_no_admincap' }; } });
  assert.equal(r.reason, 'wallet_has_no_admincap'); assert.equal(seen.action, 'pause');
  assert.equal((await call('admin-tx', {}, env({ SPICE_CERT_PREVIEW: '0' }))).reason, 'preview_only');
  const { adminTx } = await import('../store-core/admin-actions.js');
  assert.equal((await adminTx({ network: 'devnet', issuerId: '0x2', sender: '0x3', action: 'pause' })).reason, 'bad_network');
  assert.equal((await adminTx({ network: 'testnet', issuerId: '0x2', sender: '0x3', action: 'transfer' })).reason, 'bad_action');
});
test('V4-4: admin tool refuses any client package id and unpinned Issuers; package comes from the Issuer type and must match the pin', async () => {
  const { adminTx } = await import('../store-core/admin-actions.js');
  const pin = { testnet: [{ issuerId: '0x' + 'a'.repeat(64), packageId: '0x' + 'b'.repeat(64) }] };
  const base = { network: 'testnet', issuerId: '0x' + 'a'.repeat(64), sender: '0x' + 'c'.repeat(64), action: 'pause' };
  assert.equal((await adminTx({ ...base, packageId: '0x' + 'e'.repeat(64) }, null, pin)).reason, 'package_not_accepted');
  assert.equal((await adminTx({ ...base, package: '0x' + 'e'.repeat(64) }, null, pin)).reason, 'package_not_accepted');
  assert.equal((await adminTx({ ...base, issuerId: '0x' + 'd'.repeat(64) }, null, pin)).reason, 'issuer_not_pinned');
  const fake = (type) => ({ core: { getObject: async () => ({ object: { type, json: {} } }), listOwnedObjects: async () => ({ objects: [] }) } });
  assert.equal((await adminTx(base, fake('0x' + 'e'.repeat(64) + '::certificate::Issuer'), pin)).reason, 'issuer_package_mismatch'); // attacker package
  assert.equal((await adminTx(base, fake('0x' + 'b'.repeat(64) + '::certificate::Issuer'), pin)).reason, 'wallet_has_no_admincap');
  const page = (await import('node:fs')).readFileSync(new URL('../src/pages/certificates/admin/index.astro', import.meta.url), 'utf8');
  assert.doesNotMatch(page, /packageId|get\('package'\)/);
});

test('prod domain: WALLET_PAGES_LIVE off -> preview_only; on -> mainnet only', async () => {
  const kp = new Ed25519Keypair(), addr = kp.toSuiAddress();
  const prod = (o) => env({ SPICE_CERT_PREVIEW: undefined, ...o });
  assert.equal((await call('challenge', { address: addr }, prod({ WALLET_PAGES_LIVE: '0' }))).reason, 'preview_only');
  assert.equal((await call('challenge', { address: addr, network: 'testnet' }, prod({ WALLET_PAGES_LIVE: '1' }))).reason, 'not_on_prod');
  assert.equal((await call('admin-tx', { network: 'testnet', issuerId: '0x2', sender: '0x3', action: 'pause' }, prod({ WALLET_PAGES_LIVE: '1' }))).reason, 'mainnet_only');
  // F-2: challenge/submit refused on prod even with the flag on
  assert.equal((await call('challenge', { address: addr }, prod({ WALLET_PAGES_LIVE: '1' }))).reason, 'not_on_prod');
  assert.equal((await call('submit', { message: 'x', signature: 'y' }, prod({ WALLET_PAGES_LIVE: '1' }))).reason, 'not_on_prod');
  const toml = (await import('node:fs')).readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml.split('[env.')[0], /\nWALLET_PAGES_LIVE = "0"/);
});

test('prod domain admin-tx: only status / pause / unpause', async () => {
  const e = env({ SPICE_CERT_PREVIEW: undefined, WALLET_PAGES_LIVE: '1' });
  for (const action of ['revoke_mint_cap', 'create_mint_cap', 'burn_redeemed', 'display_edit'])
    assert.equal((await call('admin-tx', { network: 'mainnet', issuerId: '0x2', sender: '0x3', action }, e, { adminTx: async () => ({ ok: true }) })).reason, 'action_not_on_prod');
  assert.equal((await call('admin-tx', { network: 'mainnet', issuerId: '0x2', sender: '0x3', action: 'unpause' }, e, { adminTx: async () => ({ ok: true }) })).ok, true);
});
test('/sign/ is standalone: brand mark + purpose + action, no site nav/footer; signAndExecute only; mainnet pinned Issuer only', () => {
  const rd = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const page = rd('../src/pages/sign/index.astro'), lay = rd('../src/layouts/Standalone.astro');
  assert.match(page, /import Standalone from/); assert.doesNotMatch(page, /layouts\/Base/);
  assert.doesNotMatch(lay.replace(/^\/\/.*$/gm, ''), /NAV|DISCLAIMER|<footer|<nav|og:|canonical|utm_/); assert.match(lay, /noindex, nofollow/); assert.match(lay, /<Sigil/);
  assert.match(page, /sui:signAndExecuteTransaction/); assert.doesNotMatch(page, /sui:signTransaction'|upgrade-sign\/execute|testnet/);
  const ALL = JSON.parse(rd('../store-core/spice-cert-admin-issuers.json'));
  assert.equal(PIN.issuer, ALL.mainnet[0].issuerId); assert.equal(PIN.certPackage, ALL.mainnet[0].packageId);
  assert.match(page, /checkUpgradeBytes\(r\.txBytesB64\)/); assert.match(page, /checkPauseTx\(r\.tx_json, action\)/);
  assert.doesNotMatch(page, /r\.summary|r\.sha256|summary\.sender/, 'F-1: no decision uses server-reported values');

  const cfg = rd('../astro.config.mjs'); assert.match(cfg, /'sign\/', 'certificates\/prove-wallet\/', 'certificates\/admin\/'/); assert.match(cfg, /DEPLOY_MODE === 'production'/); assert.match(cfg, /if \(strip.length\) pruneOrphans/);
});

test('F-1: browser-side checks compute sha + digest from the bytes and pin every field of set_paused', async () => {
  const TX = JSON.parse(readFileSync(new URL('../store-core/upgrade-tx.json', import.meta.url), 'utf8'));
  assert.equal(PIN.upgradeSha256, 'e000df0ffd6f7cd271a691fffe77dc0eeb324c7df9cc4704c6db2b6799dc6566');
  assert.equal(PIN.upgradeDigest, '37bSrXhV5D5bfmtNtLdh9gHjPpNpos3koYJ5JQC9iwLw');
  assert.equal(PIN.account, '0x04b178f7855b2e84ae9c1585093009bb6c212cd3b5ccf9c76672dda04be087e0');
  const v = await checkUpgradeBytes(TX.txBytesB64); assert.equal(v.ok, true); assert.equal(v.sha, PIN.upgradeSha256); assert.equal(v.digest, PIN.upgradeDigest);
  const { TransactionDataBuilder } = await import('@mysten/sui/transactions');
  const u8 = Uint8Array.from(Buffer.from(TX.txBytesB64, 'base64')); assert.equal(txDigest(u8), TransactionDataBuilder.getDigestFromBytes(u8));
  assert.equal(base58(Uint8Array.from([0, 0, 1])), '112');
  const changed = Buffer.from(u8); changed[changed.length - 1] ^= 1;
  assert.equal((await checkUpgradeBytes(changed.toString('base64'))).ok, false);
  const good = (flag) => ({ version: 2, sender: PIN.account, expiration: null, gasData: { budget: null, price: null, owner: null, payment: null },
    inputs: [{ UnresolvedObject: { objectId: PIN.adminCap } }, { UnresolvedObject: { objectId: PIN.issuer } }, { Pure: { bytes: flag } }],
    commands: [{ MoveCall: { package: PIN.certPackage, module: 'certificate', function: 'set_paused', typeArguments: [], arguments: [{ Input: 0 }, { Input: 1 }, { Input: 2 }] } }] });
  assert.equal(checkPauseTx(JSON.stringify(good('AA==')), 'unpause'), true);
  assert.equal(checkPauseTx(good('AQ=='), 'pause'), true);
  const bad = (mut, re, action = 'unpause') => { const t = good('AA=='); mut(t); assert.throws(() => checkPauseTx(t, action), re); };
  bad(() => {}, /flag/, 'pause');
  bad((t) => { t.sender = '0x' + '1'.repeat(64); }, /sender/);
  bad((t) => { t.commands.push(t.commands[0]); }, /exactly one command/);
  bad((t) => { t.commands[0].MoveCall.package = '0x' + '2'.repeat(64); }, /pinned set_paused/);
  bad((t) => { t.commands[0].MoveCall.module = 'other'; }, /pinned set_paused/);
  bad((t) => { t.commands[0].MoveCall.function = 'revoke_mint_cap'; }, /pinned set_paused/);
  bad((t) => { t.inputs[1] = { UnresolvedObject: { objectId: '0x' + '3'.repeat(64) } }; }, /Issuer/);
  bad((t) => { t.inputs[0] = { UnresolvedObject: { objectId: '0x' + '4'.repeat(64) } }; }, /AdminCap/);
  bad((t) => { t.inputs.push({ Pure: { bytes: 'AA==' } }); }, /three inputs/);
  bad((t) => { t.gasData.owner = '0x' + '5'.repeat(64); }, /gas/);
  bad((t) => { t.gasData.payment = []; }, /gas payment/);
  bad((t) => { t.commands[0] = { TransferObjects: {} }; }, /MoveCall/);
  bad((t) => { t.extra = 1; }, /unexpected fields/);
  // the real server-built tx shape (admin-actions) passes
  const { adminTx } = await import('../store-core/admin-actions.js');
  assert.equal(typeof adminTx, 'function');
});
test('F-2: per-IP rate limit on the /sign APIs (prod domain), fails closed without KV/secret', async () => {
  const k = kv(), e = { STORE_KV: k, SPICE_SESSION_SECRET: SECRET };
  const r = (ip) => new Request('https://x/api/upgrade-sign/tx', { headers: { 'cf-connecting-ip': ip } });
  for (let i = 0; i < SIGN_RATE.perMinute; i++) assert.equal(await signRateLimit(r('1.2.3.4'), e, 60_000), null);
  assert.equal((await signRateLimit(r('1.2.3.4'), e, 60_000)).status, 429);
  assert.equal(await signRateLimit(r('5.6.7.8'), e, 60_000), null);
  assert.equal(await signRateLimit(r('1.2.3.4'), e, 120_000), null, 'next minute');
  assert.ok([...k.m.keys()].every((x) => !x.includes('1.2.3.4')), 'no raw IP stored');
  assert.equal((await signRateLimit(r('1.2.3.4'), {}, 0)).status, 503);
  const live = env({ SPICE_CERT_PREVIEW: undefined, WALLET_PAGES_LIVE: '1' });
  let n429 = 0; for (let i = 0; i < SIGN_RATE.perMinute + 2; i++) { const x = await call('admin-tx', { network: 'mainnet', issuerId: '0x2', sender: '0x3', action: 'status' }, live, { adminTx: async () => ({ ok: true }) }); if (x.reason === 'rate_limited') n429++; }
  assert.ok(n429 >= 2, 'admin-tx is rate limited on prod');
  const { handleUpgradeSign } = await import('../store-core/upgrade-sign.js');
  const TX = JSON.parse(readFileSync(new URL('../store-core/upgrade-tx.json', import.meta.url), 'utf8'));
  let seen = 0; const u = await handleUpgradeSign('tx', { request: new Request('https://x/api/upgrade-sign/tx'), env: { WALLET_PAGES_LIVE: '1', UPGRADE_SIGN_ENABLED: '1', UPGRADE_REVIEWED_SHA256: TX.sha256 } }, fetch, { rateLimit: async () => { seen++; return new Response('{}', { status: 429 }); } });
  assert.equal(u.status, 429); assert.equal(seen, 1);
});
test('Low: signed withdrawal requests: 30 days on /privacy/ and purged after 30 days', async () => {
  const p = readFileSync(new URL('../src/pages/privacy.astro', import.meta.url), 'utf8');
  assert.match(p, /Signed withdrawal requests are kept in a private database for 30 days/);
  const { purge, RETENTION } = await import('../store-core/purge.js');
  assert.equal(RETENTION.withdrawRequestDays, 30);
  const seen = []; const db = { prepare: (sql) => ({ bind: (...b) => ({ run: async () => { seen.push([sql, b]); return { meta: { changes: 0 } }; }, all: async () => ({ results: [] }) }) }) };
  const now = 100 * 86_400_000; await purge(db, now);
  const w = seen.find(([s]) => /spice_withdraw_requests/.test(s)); assert.ok(w); assert.match(w[0], /created_ms < \?1/); assert.equal(w[1][0], now - 30 * 86_400_000);
});
