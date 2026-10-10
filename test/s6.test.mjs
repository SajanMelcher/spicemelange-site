// Siona S6: the order token never goes into a URL (checkout link or re-download prefill).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
test('checkout re-download link carries only the order id', () => {
  const s = read('../src/components/Checkout.astro');
  assert.doesNotMatch(s, /download\/[?#][^`'"]*token=/);
  assert.match(s, /\/store\/download\/\?order=\$\{encodeURIComponent\(order\.orderId\)\}`/);
});
test('download page never prefills or auto-submits a token from the URL', () => {
  const s = read('../src/pages/store/download.astro');
  assert.doesNotMatch(s, /\$\('dl-token'\)\.value = pre\.token/);
  assert.match(s, /token: ''/);
  assert.match(s, /authorization: `Bearer \$\{token\}`/);
});
