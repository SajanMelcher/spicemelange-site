// Rhythm feed: schema/guidance-only validation, the published file, and its ed25519 signature (release key).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPublicKey, verify } from 'node:crypto';
import { validateRhythm, RHYTHM_DISCLAIMER } from '../store-core/rhythm.js';
const root = new URL('..', import.meta.url);
const raw = readFileSync(new URL('public/rhythm.json', root));
const sig = Buffer.from(readFileSync(new URL('public/rhythm.json.sig', root), 'utf8').trim(), 'base64');
const pub = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(readFileSync(new URL('public/templates/release-key.pub', root), 'utf8').trim(), 'base64')]), format: 'der', type: 'spki' });
const doc = JSON.parse(raw);
const clone = (f) => { const d = structuredClone(doc); f(d); return validateRhythm(d); };

test('published rhythm.json validates, is guidance-only, and its signature verifies with the release key', () => {
  assert.deepEqual(validateRhythm(doc), []);
  assert.equal(doc.guidanceOnly, true); assert.equal(doc.disclaimer, RHYTHM_DISCLAIMER);
  assert.equal(doc.rungs.default, 3); assert.ok(doc.rungs.max <= 5);
  assert.equal(verify(null, raw, pub, sig), true);
});
test('tampered bytes or a different signature fail closed', () => {
  const t = Buffer.from(raw.toString().replace('"default": 3', '"default": 5'));
  assert.equal(verify(null, t, pub, sig), false);
  const bad = Buffer.from(sig); bad[0] ^= 1;
  assert.equal(verify(null, raw, pub, bad), false);
});
test('validator refuses orders, money sizes, promises, addresses, links and rungs above 5', () => {
  assert.ok(clone((d) => { d.orders = [{ pool: 'SUI_USDC' }]; }).some((e) => /forbidden key|unknown_field/.test(e)));
  assert.ok(clone((d) => { d.focusPools[0].size = 10; }).some((e) => /forbidden key/.test(e)));
  assert.ok(clone((d) => { d.lessons[0].text = 'Put $50 on each rung.'; }).some((e) => /money_size/.test(e)));
  assert.ok(clone((d) => { d.lessons[0].text = 'Spend 40 USDC per rung.'; }).some((e) => /money_size/.test(e)));
  assert.ok(clone((d) => { d.dailyNote.text = 'This is guaranteed to work.'; }).some((e) => /return_promise/.test(e)));
  assert.ok(clone((d) => { d.projects[0].status = 'send to 0x' + 'ab'.repeat(20); }).some((e) => /address_or_id/.test(e)));
  assert.ok(clone((d) => { d.lessons[0].text = 'Read https://example.com first.'; }).some((e) => /link/.test(e)));
  assert.ok(clone((d) => { d.lessons[0].text = 'Place an order now.'; }).some((e) => /order_instruction/.test(e)));
  assert.ok(clone((d) => { d.rungs.max = 7; }).some((e) => /rungs/.test(e)));
  assert.ok(clone((d) => { d.rebalanceRanges[0].minPct = 80; d.rebalanceRanges[0].maxPct = 20; }).some((e) => /rebalanceRanges/.test(e)));
  assert.ok(clone((d) => { d.guidanceOnly = false; }).includes('guidanceOnly must be true'));
  assert.ok(clone((d) => { d.disclaimer = 'trust me'; }).some((e) => /disclaimer/.test(e)));
});
