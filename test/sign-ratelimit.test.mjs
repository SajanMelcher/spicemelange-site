// /sign/ rate limiter: D1 atomic counter (migrations/0013_rate_limits.sql). Real SQL via node:sqlite, plus a real local D1 via
// Miniflare when it is available on the box (skipped otherwise).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { signRateLimit, SIGN_RATE, UPSERT, CLEANUP } from '../store-core/sign-ratelimit.js';

const MIG = readFileSync(new URL('../migrations/0013_rate_limits.sql', import.meta.url), 'utf8');
const SECRET = 's'.repeat(40);
const req = (ip, path = '/api/upgrade-sign/tx') => new Request('https://thespicemelange.org' + path, { headers: { 'cf-connecting-ip': ip } });
const T0 = 1_760_000_000_000 - (1_760_000_000_000 % 60_000); // start of a minute

// D1-shaped wrapper over node:sqlite (real SQLite executes the exact statements)
async function sqliteD1() {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(':memory:'); db.exec(MIG);
  const stmt = (sql, args = []) => ({ bind: (...a) => stmt(sql, a), sql, args,
    all: async () => ({ results: db.prepare(sql).all(...args) }), run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: r.changes } }; } });
  return { raw: db, prepare: (sql) => stmt(sql), batch: async (ss) => { db.exec('BEGIN'); try { const out = ss.map((s) => ({ results: db.prepare(s.sql).all(...s.args) })); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; } } };
}

test('migration 0013 creates rate_limits(key TEXT PRIMARY KEY, window INTEGER, count INTEGER); the UPSERT is one statement with RETURNING', () => {
  assert.match(MIG, /CREATE TABLE IF NOT EXISTS rate_limits \(key TEXT PRIMARY KEY, "window" INTEGER NOT NULL, count INTEGER NOT NULL\)/);
  assert.match(UPSERT, /^INSERT INTO rate_limits[\s\S]*ON CONFLICT\(key\) DO UPDATE SET count = CASE WHEN rate_limits\."window" = excluded\."window" THEN rate_limits\.count \+ 1 ELSE 1 END,\s*"window" = excluded\."window" RETURNING count$/);
  assert.equal((UPSERT.match(/;/g) || []).length, 0);
  const files = readdirSync(new URL('../migrations/', import.meta.url)).sort(); assert.equal(files.at(-1), '0013_rate_limits.sql');
});

test('real SQLite: 20 allowed, 21st -> 429, per IP and per endpoint; new window resets; rows older than ~2 min are deleted', async () => {
  const D = await sqliteD1(), env = { STORE_DB: D, SPICE_SESSION_SECRET: SECRET };
  for (let i = 1; i <= SIGN_RATE.perMinute; i++) assert.equal(await signRateLimit(req('1.2.3.4'), env, T0 + i), null, `request ${i}`);
  const r21 = await signRateLimit(req('1.2.3.4'), env, T0 + 30_000); assert.equal(r21.status, 429); assert.equal((await r21.json()).reason, 'rate_limited');
  assert.equal(await signRateLimit(req('5.6.7.8'), env, T0 + 30_000), null, 'other IP');
  assert.equal(await signRateLimit(req('1.2.3.4', '/api/wallet-proof/admin-tx'), env, T0 + 30_000), null, 'other endpoint');
  assert.equal(await signRateLimit(req('1.2.3.4'), env, T0 + 60_000), null, 'next window resets to 1');
  const rows = D.raw.prepare('SELECT key, "window", count FROM rate_limits').all();
  assert.ok(rows.every((r) => !r.key.includes('1.2.3.4') && !r.key.includes('5.6.7.8')), 'no raw IP stored');
  assert.equal(rows.find((r) => r.key.startsWith('/api/upgrade-sign/tx:') && r.count === 1 && r.window === T0 / 60_000 + 1) !== undefined, true);
  // two windows later: everything from T0's window is gone (kept at most the current + previous minute)
  await signRateLimit(req('9.9.9.9'), env, T0 + 180_000);
  const left = D.raw.prepare('SELECT "window" FROM rate_limits').all().map((r) => r.window);
  assert.ok(left.every((w) => w >= T0 / 60_000 + 2), JSON.stringify(left));
  assert.match(CLEANUP, /DELETE FROM rate_limits WHERE "window" < \?1/);
});

test('fails closed: no D1, no/short secret, or a D1 error -> 503', async () => {
  assert.equal((await signRateLimit(req('1.1.1.1'), { SPICE_SESSION_SECRET: SECRET })).status, 503);
  assert.equal((await signRateLimit(req('1.1.1.1'), { STORE_DB: await sqliteD1() })).status, 503);
  assert.equal((await signRateLimit(req('1.1.1.1'), { STORE_DB: await sqliteD1(), SPICE_SESSION_SECRET: 'short' })).status, 503);
  const broken = { prepare: () => ({ bind: () => ({}) }), batch: async () => { throw new Error('D1_ERROR: no such table'); } };
  assert.equal((await signRateLimit(req('1.1.1.1'), { STORE_DB: broken, SPICE_SESSION_SECRET: SECRET })).status, 503);
});

test('privacy "about 2 minutes" matches the retention; purge.js backstop deletes rate_limits rows older than 2 minutes', async () => {
  const p = readFileSync(new URL('../src/pages/privacy.astro', import.meta.url), 'utf8');
  assert.match(p, /The wallet signing tools at \/sign\/ keep a salted hash of your IP address for about 2 minutes, to rate-limit requests\./);
  assert.equal(SIGN_RATE.retentionSec, 120); assert.equal(SIGN_RATE.windowSec * 2, SIGN_RATE.retentionSec);
  const { purge, RETENTION } = await import('../store-core/purge.js');
  assert.equal(RETENTION.rateLimitSec, 120);
  const seen = []; const db = { prepare: (sql) => ({ bind: (...b) => ({ run: async () => { seen.push([sql, b]); return { meta: { changes: 0 } }; }, all: async () => ({ results: [] }) }) }) };
  const now = T0 + 10 * 60_000; await purge(db, now);
  const r = seen.find(([s]) => /rate_limits/.test(s)); assert.ok(r); assert.equal(r[1][0], Math.floor((now - 120_000) / 60_000));
  for (const f of ['../store-core/wallet-proof.js', '../store-core/upgrade-sign.js']) assert.doesNotMatch(readFileSync(new URL(f, import.meta.url), 'utf8'), /signrl:|STORE_KV\.put\(`signrl/);
});

// Real local D1 (workerd) via Miniflare, if the box has it in the npx cache.
function findMiniflare() {
  const base = join(homedir(), '.npm/_npx'); if (!existsSync(base)) return null;
  for (const d of readdirSync(base)) { const p = join(base, d, 'node_modules/miniflare'); try { if (/^4\./.test(JSON.parse(readFileSync(join(p, 'package.json'), 'utf8')).version)) return p; } catch {} }
  return null;
}
const MF = findMiniflare();
test('real local D1 (Miniflare): the 21st request in a window gets 429', { skip: MF ? false : 'miniflare not available on this box' }, async () => {
  const { Miniflare } = await import(join(MF, 'dist/src/index.js'));
  const mf = new Miniflare({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', d1Databases: { STORE_DB: 'rl-test' } });
  try {
    const d1 = await mf.getD1Database('STORE_DB');
    for (const s of MIG.replace(/--.*$/gm, '').split(';').map((x) => x.trim()).filter(Boolean)) await d1.prepare(s).run();
    const env = { STORE_DB: d1, SPICE_SESSION_SECRET: SECRET };
    const codes = [];
    for (let i = 0; i < 21; i++) { const r = await signRateLimit(req('203.0.113.7'), env, T0 + i * 1000); codes.push(r ? r.status : 200); }
    assert.deepEqual(codes, [...Array(20).fill(200), 429]);
    assert.equal(await signRateLimit(req('203.0.113.7'), env, T0 + 61_000), null, 'next window');
    const { results } = await d1.prepare('SELECT count, "window" FROM rate_limits').all();
    assert.equal(results.length, 1); assert.equal(results[0].count, 1);
  } finally { await mf.dispose(); }
});
