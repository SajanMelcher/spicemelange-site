// Sajan 8:41/8:51 AM PT (Siona O5): Day 11 HALT line is "...and your bot is told never to remove it."; upgrades wording is "Upgrades are free forever".
import test from 'node:test';
import assert from 'node:assert/strict';
import { LESSONS } from '../store-core/lessons-content.js';

test('Day 11 HALT wording (HTML + text) and no "never cost extra" anywhere in the lessons', () => {
  const d11 = LESSONS.find((l) => l.day === 11);
  for (const s of [d11.text, d11.html]) {
    assert.match(s, /remove it, and your bot is told never to remove it\./);
    assert.doesNotMatch(s, /Only (<strong>)?you(<\/strong>)? remove it/i);
    assert.doesNotMatch(s, /never deletes or renames it/);
  }
  const all = JSON.stringify(LESSONS);
  assert.doesNotMatch(all, /never cost extra/i);
  assert.doesNotMatch(all, /with upgrades free forever/i);
});
