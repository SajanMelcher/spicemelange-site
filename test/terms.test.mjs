// /terms/ renders the approved licence byte-for-byte from src/content-static/LICENSE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
// LICENSE.md (372a9241…fffb, approved 2026-10-10) + section 9 privacy (Sajan S3 decision 2:45 AM PT; fact-checked: store/PRIVACY-FACTCHECK.md)
const APPROVED = '6d2ad7078131bf14edb08ae10914d565c4e50bfab1d140d68b531f3bfb2e977c'; // store/LICENSE.md as adopted by Tleilaxu (Run 6)
test('licence source matches the approved sha256', () => {
  const b = readFileSync(new URL('../src/content-static/LICENSE.md', import.meta.url));
  assert.equal(createHash('sha256').update(b).digest('hex'), APPROVED);
});
test('terms page has no draft banner or noindex', () => {
  const s = readFileSync(new URL('../src/pages/terms.astro', import.meta.url), 'utf8');
  assert.doesNotMatch(s, /noindex|Draft, waiting/);
});
