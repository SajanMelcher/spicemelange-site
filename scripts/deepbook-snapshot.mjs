#!/usr/bin/env node
// Fallback data path: writes public/data/deepbook-snapshot.json from the public DeepBook indexer.
// The live dashboard fetches the indexer directly in the browser (CORS is open: Access-Control-Allow-Origin: *),
// and only falls back to this file if live requests fail. Run before each build, or on a schedule
// (e.g. a GitHub Action every 15 min) if CORS is ever tightened.
import { writeFile, mkdir } from 'node:fs/promises';
import { fetchAll } from '../src/lib/deepbook-core.js';

const out = new URL('../public/data/deepbook-snapshot.json', import.meta.url);
const data = await fetchAll();
const ok = data.pools.filter((p) => p.book).length;
if (!ok) { console.error('No pools fetched; keeping the previous snapshot.'); process.exit(1); }
await mkdir(new URL('.', out), { recursive: true });
await writeFile(out, JSON.stringify(data));
console.log(`Wrote ${out.pathname} with ${ok}/${data.pools.length} pools at ${data.generated_at}`);
