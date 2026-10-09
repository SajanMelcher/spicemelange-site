// P30 store catalog. EVERY price and line of copy here is a PLACEHOLDER for Sajan to set.
// Rules: purpose-made, sanitized products only. No desk records, balances, wallet internals,
// family or reserve data. No Dune names. No claims of returns or yields.
// `file` is a private KV key (STORE_FILES), never a public path.
export const CATALOG = [
  {
    sku: 'agent-desk-os',
    name: 'Agent-Desk OS Template Pack',
    priceUsdc: '29', // PLACEHOLDER (memo range $29 / pro $49)
    placeholder: true,
    blurb: 'PLACEHOLDER COPY. A generic, fill-in-the-blanks operating kit for running a small team of AI agents: playbook skeleton, guard-rule checklist, routine prompts, decision and lessons logs, scorecard sheet.',
    includes: ['Playbook skeleton (Markdown)', 'Guard-rule checklist', 'Decision and lessons log templates', 'Scorecard spreadsheet'],
    format: 'ZIP (Markdown + XLSX)',
    file: 'file:agent-desk-os',
  },
  {
    sku: 'golden-ratio-calculator',
    name: 'Golden-Ratio Allocation Calculator',
    priceUsdc: '15', // PLACEHOLDER (memo range $15–19)
    placeholder: true,
    blurb: 'PLACEHOLDER COPY. A spreadsheet that splits amounts YOU enter by 61.8 / 38.2, shows rebalance bands and loan-to-value safety math. It recommends no asset and makes no forecast.',
    includes: ['XLSX and Google Sheets copy', 'Band and LTV worked examples with made-up numbers', 'Education-only notes'],
    format: 'XLSX',
    file: 'file:golden-ratio-calculator',
  },
  {
    sku: 'prompt-pack',
    name: 'Research-Desk Prompt Pack',
    priceUsdc: '9', // PLACEHOLDER (memo range $9–15)
    placeholder: true,
    blurb: 'PLACEHOLDER COPY. Reusable prompts for research notes, checklists and agent routines. Process prompts only; no trade calls.',
    includes: ['Prompt library (Markdown)', 'Routine schedules', 'Review checklists'],
    format: 'Markdown',
    file: 'file:prompt-pack',
  },
  {
    sku: 'plumbline-pro',
    name: 'Plumbline Pro',
    priceUsdc: '19', // PLACEHOLDER (no price researched yet)
    placeholder: true,
    blurb: 'PLACEHOLDER COPY. A supporter tier for the free, read-only Plumbline MCP server: setup guide, self-hosting recipe and priority issue triage. Market data only; no keys, no trading.',
    includes: ['Self-hosting guide', 'Config recipes', 'Priority issue label (90 days)'],
    format: 'PDF + Markdown',
    file: 'file:plumbline-pro',
  },
];

export const bySku = (sku) => CATALOG.find((p) => p.sku === sku) ?? null;
