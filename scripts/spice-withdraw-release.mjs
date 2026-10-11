#!/usr/bin/env node
// Siona SJ10: release the D1 withdrawal lock for one certificate serial once its request is REJECTED or PAID.
//   node scripts/spice-withdraw-release.mjs <serial> <rejected|paid> [--env preview|production]   (prints, then runs with --yes)
// The holder API also releases it automatically the next time the ledger shows rejected/paid for that serial.
import { execFileSync } from 'node:child_process';
const [serial, outcome] = process.argv.slice(2);
const envName = process.argv.includes('--env') ? process.argv[process.argv.indexOf('--env') + 1] : 'preview';
if (!/^\d{1,9}$/.test(serial || '') || !['rejected', 'paid'].includes(outcome)) { console.error('usage: <serial> <rejected|paid> [--env preview|production]'); process.exit(1); }
const db = envName === 'production' ? 'spicemelange-store-prod' : 'spicemelange-store-preview';
const args = ['--yes', '-p', 'node@22', '-p', 'wrangler', '--', 'wrangler', 'd1', 'execute', db, '--remote', ...(envName === 'production' ? [] : ['--env', 'preview']),
  '--command', `DELETE FROM spice_withdraw_pending WHERE serial = ${Number(serial)}`];
console.log(`release lock: serial ${serial} (${outcome}) on ${db}`);
if (process.argv.includes('--yes')) execFileSync('npx', args, { stdio: 'inherit' }); else console.log('dry run; add --yes to execute:\n  npx ' + args.join(' '));
