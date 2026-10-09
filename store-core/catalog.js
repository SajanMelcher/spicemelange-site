// P30 store catalog: "The Spice Melange" Golden Path Desk archetype templates (Sajan, 10/9 6:12 AM PT).
// Templates are $50 each (Sajan). The full-desk bundle price is a PLACEHOLDER for Sajan.
// Product files live in private storage (STORE_FILES KV), keyed by `file`. Never under public/.
// No desk records, balances, wallet internals, family or reserve data. No return or yield claims.
const COMMON = ['README with 15-minute setup', 'Persona / system prompt', 'Role charter', 'Guardrails as configurable defaults (no leverage, loss cap, human approval)', 'Example routines', 'Skills and connectors list', 'Hand-off map to the other archetypes'];
const t = (o) => ({ priceUsdc: '50', placeholder: false, format: 'ZIP (Markdown)', includes: COMMON, file: `file:${o.sku}`, ...o });

export const CATALOG = [
  t({ sku: 'god-emperor', name: 'The God Emperor', role: 'Orchestrator', glyph: 'crown',
    quote: 'The patient ruler who sees the whole path.',
    blurb: 'One front door for you. Routes every task to the seat that owns it, runs the decision gates, writes daily orders and the weekly review, and never does specialist work itself.',
    highlights: ['Route → research gate → completion gate → action guard', 'Daily orders and Sunday review', 'Escalates with options, not walls of text'] }),
  t({ sku: 'moneo', name: 'Moneo', role: 'Mentat Researcher', glyph: 'scroll',
    quote: 'The loyal minister and human computer.',
    blurb: 'Scans news, filings and feeds, then writes at most three evidence-backed findings a day, with sources, uncertainty and what would prove them wrong.',
    highlights: ['Evidence records and a coverage ledger', 'Proposal format with fees and risks', 'Strategy Gate: backtest, stress test, paper trade'] }),
  t({ sku: 'fish-speakers', name: 'The Fish Speakers', role: 'Execution Operator', glyph: 'blade',
    quote: 'The disciplined guard who acts only on command.',
    blurb: 'Executes only previewed, approved actions inside hard limits: limit orders, a daily loss cap, no leverage by default, and silent checks when nothing changed.',
    highlights: ['Exact previews before any order', 'Paired exits on fills', 'Kill switch at the loss cap'] }),
  t({ sku: 'anteac', name: 'Anteac', role: 'Truthsayer Verifier', glyph: 'eye',
    quote: 'The truthsayer who tells fact from fiction.',
    blurb: 'An independent, read-only verifier. Checks every material claim against a primary source, refuses false "done"s, and reconciles the books each night.',
    highlights: ['accept / verify_more / reject verdicts', 'Completion audits', 'Nightly reconciliation'] }),
  t({ sku: 'hwi-noree', name: 'Hwi Noree', role: 'Bookkeeper and Onboarding', glyph: 'ledger',
    quote: 'The gentle, trustworthy envoy.',
    blurb: 'Keeps a sourced ledger, triages the inbox and drafts receipts, replies and onboarding sequences, and sends nothing without your approval.',
    highlights: ['Draft-only by design', 'Ledger with sources', 'Privacy-first customer voice'] }),
  t({ sku: 'duncan-idaho', name: 'Duncan Idaho', role: 'Premarket Planner', glyph: 'sword',
    quote: 'The steadfast swordmaster who prepares the field.',
    blurb: 'Turns verified research into a premarket plan and exact, reviewable tickets, checked against your guardrails before anyone sees them.',
    highlights: ['Fixed ticket format with invalidation', 'Guardrail pre-checks', 'Recurring cash-flow planning'] }),
  t({ sku: 'ixians', name: 'Ixians', role: 'Toolmaker and Infrastructure', glyph: 'gear',
    quote: 'The inventive machine-makers.',
    blurb: 'Builds the connectors, dashboards and archives the desk runs on: read-only first, paper mode before live, tests for the boring failures, and secret scans before every push.',
    highlights: ['Branch, test, preview, release', 'Paper mode first', 'Secret hygiene'] }),
  t({ sku: 'leto-journals', name: "Leto's Secret Journals", role: 'System templates for the Golden Path', glyph: 'book',
    quote: 'The God Emperor\'s journals, for those who come after.',
    blurb: 'The system around the seats: doctrine and playbook, decisions log, lessons with a "clearly better" promotion process, guardrails config, routine calendar, hand-off and approval protocols, shared memory, archive plan and onboarding.',
    includes: ['Doctrine and playbook template', 'Decisions log', 'lessons.md + "clearly better" promotion process', 'Guardrails config with editable defaults', 'Routine calendar (guard checks, daily briefs, nightly archive, low-data mode)', 'Hand-off and approval protocols', 'Shared-memory layout', 'Backup and archive plan (the Walrus pattern)', 'New-agent onboarding checklist'],
    highlights: ['Nine journals, one coherent system', 'Works with any or all of the seven archetypes', 'Start with doctrine, decisions, rails and memory'] }),
  { sku: 'full-desk', name: 'The Full Desk', role: 'All seven archetypes', glyph: 'sigil', bundle: true,
    priceUsdc: '250', placeholder: false, // Sajan 10/9 6:26 AM PT; still 250 with the Journals added 6:43 AM PT (8 × $50 = $400 list)
    quote: 'Seven seats, one Golden Path.',
    blurb: "Every archetype plus Leto's Secret Journals and the overview: how the seven work together, the decision layer, a day on the desk, the shared folder layout and a Mermaid flow diagram.",
    includes: ['All 7 archetype packs', "Leto's Secret Journals (system templates)", 'Bundle overview with Mermaid diagram', '"A day on the desk" walkthrough'],
    highlights: ['Save versus buying seven', 'Start with three seats, grow to seven'],
    format: 'ZIP (Markdown)', file: 'file:full-desk' },
  { sku: 'plumbline-pro', name: 'Plumbline Pro', role: 'Coming soon', glyph: 'plumb', comingSoon: true,
    priceUsdc: '—', placeholder: true, quote: '', blurb: 'A supporter tier for the free, read-only Plumbline MCP server. Coming soon.', includes: [], highlights: [], format: '', file: '' },
  // Hidden mainnet self-test (Sajan 10/9 6:26 AM PT). Never listed; ordering needs ?selftest=<STORE_SELFTEST_KEY>.
  { sku: 'selftest', name: 'Store self-test', role: 'internal', glyph: 'sigil', hidden: true,
    priceUsdc: '0.05', placeholder: false, ttlSec: 10800, quote: '', blurb: '', includes: [], highlights: [], format: 'TXT', file: '',
    inline: { name: 'spicemelange-selftest.txt', text: 'The Spice Melange store self-test: payment verified and delivery works.\n' } },
];

export const bySku = (sku) => CATALOG.find((p) => p.sku === sku) ?? null;
export const ARCHETYPES = CATALOG.filter((p) => !p.bundle && !p.comingSoon && !p.hidden);
export const LISTED = CATALOG.filter((p) => !p.hidden);
