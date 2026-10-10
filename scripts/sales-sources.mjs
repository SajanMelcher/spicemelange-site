#!/usr/bin/env node
// Sales-sources report: paid orders grouped by utm_* / ref, with referral-code owners. Read-only SELECTs.
// Writes portfolio-desk/feeds/sales-sources.md. No emails, order ids, tokens or digests in the output.
// Usage: node scripts/sales-sources.mjs [--prod] [--out PATH]   (default: PREVIEW database; --prod needs migration 0006 on prod)
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const prod = args.includes('--prod');
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : '/home/box/agent-data/shared/portfolio-desk/feeds/sales-sources.md';
const db = prod ? 'spicemelange-store-prod' : 'spicemelange-store-preview';
const q = (sql) => {
  const raw = execFileSync('npx', ['wrangler', 'd1', 'execute', db, '--remote', '--json', ...(prod ? [] : ['--env', 'preview']), '--command', sql], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(raw)[0]?.results ?? [];
};
const REAL = `o.status = 'paid' AND o.sku <> 'selftest' AND COALESCE(o.digest,'') NOT LIKE 'E2E-%' AND lower(COALESCE(o.email,'')) NOT LIKE '%.invalid'`;
const usd = (a) => (Number(a ?? 0) / 1e6).toFixed(2);
const bySrc = q(`SELECT COALESCE(o.utm_source,'(none)') src, COALESCE(o.utm_medium,'') med, COALESCE(o.utm_campaign,'') camp, COUNT(*) n, SUM(CAST(o.amount_atomic AS INTEGER)) amt
  FROM orders o WHERE ${REAL} GROUP BY 1,2,3 ORDER BY amt DESC`);
const byRef = q(`SELECT COALESCE(o.ref,'(none)') ref, COALESCE(r.owner, CASE WHEN o.ref IS NULL THEN '' ELSE '(unknown code)' END) owner, COUNT(*) n, SUM(CAST(o.amount_atomic AS INTEGER)) amt
  FROM orders o LEFT JOIN referral_codes r ON r.code = o.ref WHERE ${REAL} GROUP BY 1,2 ORDER BY amt DESC`);
const bySku = q(`SELECT o.sku, COUNT(*) n, SUM(CASE WHEN o.utm_source IS NOT NULL OR o.ref IS NOT NULL THEN 1 ELSE 0 END) tagged FROM orders o WHERE ${REAL} GROUP BY 1 ORDER BY n DESC`);
const codes = q(`SELECT code, owner, created_ms, active FROM referral_codes ORDER BY created_ms`);
const opened = q(`SELECT COALESCE(utm_source, ref, '(none)') src, COUNT(*) n FROM orders o WHERE o.sku <> 'selftest' AND COALESCE(o.digest,'') NOT LIKE 'E2E-%' AND lower(COALESCE(o.email,'')) NOT LIKE '%.invalid' GROUP BY 1 ORDER BY n DESC`);
const now = new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
const t = (rows, cols, fmt) => rows.length ? [`| ${cols.join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${fmt(r).join(' | ')} |`)].join('\n') : '_none yet_';
const md = `# Sales sources (${prod ? 'PRODUCTION' : 'PREVIEW (testnet)'})
Generated ${now} PT by scripts/sales-sources.mjs from \`${db}\`. Paid orders only, except the last table. Test orders (selftest, E2E, .invalid) are excluded. No emails, order IDs or digests.

## Paid by utm source / medium / campaign
${t(bySrc, ['source', 'medium', 'campaign', 'orders', 'USDC'], (r) => [r.src, r.med, r.camp, r.n, usd(r.amt)])}

## Paid by referral code
${t(byRef, ['ref', 'owner', 'orders', 'USDC'], (r) => [r.ref, r.owner, r.n, usd(r.amt)])}

## Paid by product (how many carried a source)
${t(bySku, ['sku', 'orders', 'with source'], (r) => [r.sku, r.n, r.tagged])}

## All orders created (paid or not) by first source
${t(opened, ['source or ref', 'orders'], (r) => [r.src, r.n])}

## Referral codes
${t(codes, ['code', 'owner', 'created (PT)', 'active'], (r) => [r.code, r.owner, new Date(r.created_ms).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }), r.active ? 'yes' : 'no'])}

Add a code (preview): \`npx wrangler d1 execute ${db} --remote${prod ? "" : " --env preview"} --command "INSERT INTO referral_codes (code, owner, created_ms) VALUES ('code', 'owner', $(date +%s000))"\`. Links: \`https://thespicemelange.org/store/?ref=code\` or \`?utm_source=...&utm_medium=...&utm_campaign=...\`.
`;
writeFileSync(out, md);
console.log(`wrote ${out}`);
