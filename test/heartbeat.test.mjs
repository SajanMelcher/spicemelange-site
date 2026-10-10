import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { makeD1 } from './d1-shim.mjs';
import worker, { heartbeat } from '../workers/hwi-lessons/index.js';

const MIG = readdirSync(new URL('../migrations/', import.meta.url)).filter((f) => f.endsWith('.sql')).sort().map((m) => new URL(`../migrations/${m}`, import.meta.url));

test('cron heartbeat: each scheduled tick advances last_cron_at and /health shows it', async () => {
  const db = makeD1(MIG);
  const env = { STORE_DB: db };
  const t0 = Date.UTC(2026, 9, 10, 16, 30);
  await heartbeat(env, { scheduledTime: t0, cron: '*/10 * * * *' }, t0 + 50);
  await heartbeat(env, { scheduledTime: t0 + 600_000, cron: '*/10 * * * *' }, t0 + 600_050);
  const r = db.raw.prepare('SELECT * FROM cron_heartbeat').get();
  assert.equal(r.last_cron_at, t0 + 600_000);
  assert.equal(r.runs, 2);
  const h = await (await worker.fetch(new Request('https://w.example/health'), { STORE_DB: db, SUI_NETWORK: 'testnet' })).json();
  assert.equal(h.lastCronAt, new Date(t0 + 600_000).toISOString());
  assert.equal(h.cronRuns, 2);
});

test('worker wrangler.toml keeps the */10 trigger and Workers Logs on', () => {
  const t = readFileSync(new URL('../workers/hwi-lessons/wrangler.toml', import.meta.url), 'utf8');
  assert.match(t, /^crons = \["\*\/10 \* \* \* \*"\]/m);
  assert.match(t, /^\[observability\]\nenabled = true/m);
});

test('/tick (box watchdog): own key required; runs one tick and records the :box heartbeat', async () => {
  const db = makeD1(MIG);
  const KEY = 'k'.repeat(40);
  const env = { STORE_DB: db, SUI_NETWORK: 'testnet', LESSONS_TICK_KEY: KEY };
  assert.equal((await worker.fetch(new Request('https://w.example/tick', { method: 'POST' }), env)).status, 401);
  assert.equal((await worker.fetch(new Request('https://w.example/tick', { method: 'POST', headers: { authorization: 'Bearer ' + 'x'.repeat(40) } }), env)).status, 401);
  assert.equal((await worker.fetch(new Request('https://w.example/tick', { method: 'POST', headers: { authorization: 'Bearer ' + KEY } }), { ...env, LESSONS_TICK_KEY: '' })).status, 401);
  const r = await worker.fetch(new Request('https://w.example/tick', { method: 'POST', headers: { authorization: 'Bearer ' + KEY } }), env);
  assert.equal(r.status, 200);
  assert.equal(db.raw.prepare("SELECT runs FROM cron_heartbeat WHERE worker = 'hwi-lessons-cron:box'").get().runs, 1);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM cron_heartbeat WHERE worker = 'hwi-lessons-cron'").get().n, 0, 'box ticks never pose as Cloudflare cron runs');
  const h = await (await worker.fetch(new Request('https://w.example/health'), env)).json();
  assert.equal(h.lastCronAt, null);
  assert.equal(h.box.cronRuns, 1);
});
