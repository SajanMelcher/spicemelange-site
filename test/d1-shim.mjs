// Minimal Cloudflare D1 API over node:sqlite (Node >= 22.5) for unit tests. Every call yields to the
// event loop first, so concurrent requests interleave like they do in a Worker.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const tick = () => new Promise((r) => setImmediate(r));
export function makeD1(schemaPath) {
  const db = new DatabaseSync(':memory:');
  for (const sp of [].concat(schemaPath)) db.exec(readFileSync(sp, 'utf8')); // migrations in order
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => stmt(sql, a),
    _run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes) } }; },
    async run() { await tick(); return this._run(); },
    async first() { await tick(); return db.prepare(sql).get(...args) ?? null; },
    async all() { await tick(); return { results: db.prepare(sql).all(...args) }; },
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    async batch(list) {
      await tick();
      db.exec('BEGIN');
      try { const out = list.map((s) => s._run()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
