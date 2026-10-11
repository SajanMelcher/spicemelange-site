// Sajan 10/10 9:45 PM PT: the page said only "Failed to fetch". The pages must name the step, our endpoint + HTTP status,
// and any CSP-blocked request. The admin page (define:vars, can't import) carries an exact inline copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { apiCall, failText, blocked } from '../src/lib/wallet-errors.js';
test('apiCall reports endpoint + HTTP status, network failures and non-JSON', async () => {
  const r1 = await apiCall('/api/wallet-proof/challenge', { method: 'POST' }, async () => ({ status: 503, json: async () => ({ ok: false, reason: 'not_configured' }) }));
  assert.equal(r1.reason, 'not_configured'); assert.equal(r1.detail, 'POST /api/wallet-proof/challenge: HTTP 503');
  const r2 = await apiCall('/api/x', {}, async () => { throw new TypeError('Failed to fetch'); });
  assert.equal(r2.reason, 'network_error'); assert.match(r2.detail, /^GET \/api\/x: Failed to fetch \(no HTTP response\)$/);
  const r3 = await apiCall('/api/x', {}, async () => ({ status: 502, json: async () => { throw new SyntaxError('x'); } }));
  assert.equal(r3.detail, 'GET /api/x: HTTP 502, not JSON');
  const r4 = await apiCall('/api/x', {}, async () => ({ status: 400, json: async () => ({ ok: false, reason: 'r', detail: 'srv' }) }));
  assert.equal(r4.detail, 'srv; GET /api/x: HTTP 400');
  const r5 = await apiCall('/api/x', {}, async () => ({ status: 200, json: async () => ({ ok: true, v: 1 }) }));
  assert.deepEqual(r5, { ok: true, v: 1 });
});
test('failText names the step and the CSP-blocked URL', () => {
  blocked.length = 0; blocked.push('connect-src blocked https://rpc.example/');
  assert.equal(failText('Crypto.com Onchain signPersonalMessage', new TypeError('Failed to fetch')),
    'Cancelled or failed at step "Crypto.com Onchain signPersonalMessage": Failed to fetch | page blocked: connect-src blocked https://rpc.example/');
  blocked.length = 0; assert.equal(failText('s', 'x'), 'Cancelled or failed at step "s": x');
});
test('seal-upgrade-sign page uses the helper', () => {
  const f = 'src/pages/seal-upgrade-sign/index.astro';
  if (existsSync(f)) { const s = readFileSync(f, 'utf8'); assert.match(s, /failText\(step, e\)/); assert.match(s, /apiCall\('\/api\/upgrade-sign\/execute'/); }
});
test('pages use the helper; admin inline copy matches the module', () => {
  const PW = 'src/pages/certificates/prove-wallet/index.astro', AD = 'src/pages/certificates/admin/index.astro';
  if (!existsSync(PW)) return; // branch without the cert wallet pages (seal-upgrade-sign); its page is checked below
  const pw = readFileSync(PW, 'utf8');
  assert.match(pw, /import \{ apiCall, failText, blocked \} from '..\/..\/..\/lib\/wallet-errors.js'/);
  assert.doesNotMatch(pw, /\.catch\(\(\) => \(\{ ok: false, reason: 'network_error' \}\)\)/);
  const ad = readFileSync(AD, 'utf8');
  const lib = readFileSync('src/lib/wallet-errors.js', 'utf8').split('\n').filter((l) => l && !l.startsWith('//')).map((l) => l.replace(/^export /, '').replace("if (typeof document !== 'undefined')", '').trim()).filter(Boolean);
  const inl = ad.slice(ad.indexOf('// inline copy of src/lib/wallet-errors.js'), ad.indexOf('// end wallet-errors')).split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
  assert.deepEqual(inl, lib);
});
test('page-realm fetch failures are recorded (host + path, no query)', async () => {
  const g = globalThis; const saved = { window: g.window, location: g.location };
  g.location = { href: 'https://p.example/x' };
  g.window = { fetch: async () => { throw new TypeError('Failed to fetch'); } };
  const mod = await import('../src/lib/wallet-errors.js?wrap=' + Date.now());
  await assert.rejects(g.window.fetch('https://rpc.wallet.example/v1?key=secret'));
  assert.ok(mod.blocked.includes('fetch https://rpc.wallet.example/v1 failed: Failed to fetch'));
  assert.ok(!mod.blocked.join().includes('secret'));
  Object.assign(g, saved);
});
