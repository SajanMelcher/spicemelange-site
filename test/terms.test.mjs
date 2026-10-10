// /terms/ renders the approved licence byte-for-byte from src/content-static/LICENSE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
// LICENSE.md (372a9241…fffb, approved 2026-10-10) + section 9 privacy (Sajan S3 decision 2:45 AM PT; fact-checked: store/PRIVACY-FACTCHECK.md)
// Final store/LICENSE.md 2271d634 (Tleilaxu Run 10; Sajan approved 10:07 AM PT: no reply lines, Mysten + Sui GraphQL in 'Who helps us'; hello@ for deletion
// section 9 "Lesson and course emails" bullet naming Resend (Siona GL1). Also templates/LICENSE.md.
const APPROVED = '2271d6341d3ca596aafa62b838aa07a684e4eba2febc5c5c989490064e86de00';
const PROPOSAL = '/home/box/agent-data/shared/portfolio-desk/store/LICENSE.md';
test('licence source matches the approved sha256', () => {
  const b = readFileSync(new URL('../src/content-static/LICENSE.md', import.meta.url));
  assert.equal(createHash('sha256').update(b).digest('hex'), APPROVED);
});
test('terms page has no draft banner or noindex', () => {
  const s = readFileSync(new URL('../src/pages/terms.astro', import.meta.url), 'utf8');
  assert.doesNotMatch(s, /noindex|Draft, waiting/);
});
test('section 9 carries the Resend bullet (sent through Resend), deletion contact hello@, and still "Upgrades are free forever"', () => {
  const t = readFileSync(new URL('../src/content-static/LICENSE.md', import.meta.url), 'utf8');
  assert.match(t, /Lesson and course emails are sent through Resend \(Resend, Inc\.\)/);
  assert.match(t, /Your quiz answers are not sent to Resend\./);
  assert.match(t, /\*\*Questions or deletion:\*\* email hello@thespicemelange\.org\./);
  assert.match(t, /Upgrades are free forever/);
  if (existsSync(PROPOSAL)) assert.equal(readFileSync(PROPOSAL, 'utf8'), t, 'site LICENSE.md must equal the canonical store/LICENSE.md exactly');
});

test('run10: terms and /privacy/ agree (no reply lines; Mysten Labs + Sui GraphQL named; gate marker present)', async () => {
  const lic = readFileSync(new URL('../src/content-static/LICENSE.md', import.meta.url), 'utf8');
  const priv = readFileSync(new URL('../src/pages/privacy.astro', import.meta.url), 'utf8');
  const BAD = /replying "stop"|keyword such as|receives replies|save only a suggestion/i;
  assert.doesNotMatch(lic, BAD); assert.doesNotMatch(priv, BAD);
  for (const s of [lic, priv]) { assert.match(s, /Mysten Labs/); assert.match(s, /Sui GraphQL/); assert.match(s, /one-click unsubscribe/); }
  const { lessonsConfig } = await import('../store-core/lessons.js');
  assert.ok(lic.toLowerCase().includes(lessonsConfig({}).termsMarker), 'lesson gate marker must be in the approved terms');
});
