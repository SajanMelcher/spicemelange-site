// /terms/ renders the approved licence byte-for-byte from src/content-static/LICENSE.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const APPROVED = '372a924141bf7e1ba72cfb8be016642b8990bb048236c2ce320a1ce92b38fffb';
test('licence source matches the approved sha256', () => {
  const b = readFileSync(new URL('../src/content-static/LICENSE.md', import.meta.url));
  assert.equal(createHash('sha256').update(b).digest('hex'), APPROVED);
});
test('terms page has no draft banner or noindex', () => {
  const s = readFileSync(new URL('../src/pages/terms.astro', import.meta.url), 'utf8');
  assert.doesNotMatch(s, /noindex|Draft, waiting/);
});
