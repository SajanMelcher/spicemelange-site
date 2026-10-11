import test from 'node:test';
import assert from 'node:assert/strict';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Secp256k1Keypair } from '@mysten/sui/keypairs/secp256k1';
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
  assert.equal((await call('challenge', { address: addr, network: 'testnet' }, prod({ WALLET_PAGES_LIVE: '1' }))).reason, 'mainnet_only');
  assert.equal((await call('admin-tx', { network: 'testnet', issuerId: '0x2', sender: '0x3', action: 'pause' }, prod({ WALLET_PAGES_LIVE: '1' }))).reason, 'mainnet_only');
  assert.equal((await call('challenge', { address: addr }, prod({ WALLET_PAGES_LIVE: '1' }))).ok, true);
  const toml = (await import('node:fs')).readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml.split('[env.')[0], /\nWALLET_PAGES_LIVE = "0"/);
});
