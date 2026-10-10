// /terms/ renders the approved licence byte-for-byte from src/content-static/LICENSE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
// LICENSE.md (372a9241…fffb, approved 2026-10-10) + section 9 privacy (Sajan S3 decision 2:45 AM PT; fact-checked: store/PRIVACY-FACTCHECK.md)
// Final store/LICENSE.md b48ce36f (Tleilaxu Run 9; Sajan approved 8:09 AM PT; hello@ for deletion; quiz answers not sent to Resend): the earlier text (bbefd005…) plus the
// section 9 "Lesson and course emails" bullet naming Resend (Siona GL1). Also templates/LICENSE.md.
const APPROVED = 'b48ce36f9b325cbb58ff20f7ce9d932681b453484a4d2b801049bae994161fc7';
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
