// Throwaway-key flow through the LIVE preview with an injected wallet that, like Crypto.com Onchain, fetches a Sui RPC
// from the page realm before signing. Signing is done in Node with a fresh throwaway Ed25519 key.
import { chromium } from 'playwright';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
const URL = process.argv[2] ?? 'https://prove-wallet.spicemelange-site.pages.dev/certificates/prove-wallet/';
const RPC = process.env.WALLET_RPC ?? 'https://graphql.mainnet.sui.io/graphql';
const kp = Ed25519Keypair.generate(); const addr = kp.toSuiAddress();
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome' }); const p = await b.newPage();
const cons = []; p.on('console', (m) => cons.push(m.text()));
await p.exposeFunction('nodeSign', async (bytes) => (await kp.signPersonalMessage(new Uint8Array(bytes))).signature);
await p.addInitScript(([addr, RPC]) => {
  const w = { name: 'FakeInjected', version: '1.0.0', icon: 'data:image/png;base64,', chains: ['sui:mainnet', 'sui:testnet'], accounts: [],
    features: { 'standard:connect': { version: '1.0.0', connect: async () => ({ accounts: [{ address: addr, chains: ['sui:mainnet', 'sui:testnet'], features: [] }] }) },
      'sui:signPersonalMessage': { version: '1.0.0', signPersonalMessage: async ({ message }) => {
        const r = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"query":"{ chainIdentifier }"}' });
        window.__rpc = r.status; return { signature: await window.nodeSign([...message]), bytes: '' }; } } } };
  window.addEventListener('wallet-standard:app-ready', (e) => e.detail.register(w));
}, [addr, RPC]);
await p.goto(URL); await p.waitForTimeout(2500);
if (process.argv[3]) await p.selectOption('#net', process.argv[3]);
await p.click('text=Sign with FakeInjected'); await p.waitForTimeout(5000);
console.log('ADDR', addr); console.log('RPC from page:', await p.evaluate(() => window.__rpc));
console.log('STATUS:', await p.textContent('#status'));
console.log('CSP console:', cons.filter((t) => /Content Security|Refused/i.test(t)).length);
await b.close();
