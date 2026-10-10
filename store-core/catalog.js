// P30 store catalog: "The Spice Melange" Golden Path Desk archetype templates (Sajan, 10/9 6:12 AM PT).
// Grok Bot templates (Sajan, 10/9 8:38 PM PT): $50 USDC each, weekly updates included.
// STAGED 10/9 10:04 PM PT (branch dune-saga-collection): the $250 Full Desk is retired for new orders and replaced by
// The Dune Saga Collection at $300 (7 packs + Leto's Journals + all future templates, upgrades free forever, all sales final).
// Retired SKUs stay in CATALOG so past paid orders keep re-downloading their original file (checkLink needs bySku).
// Re-downloading with the order ID and token always serves the latest version in STORE_FILES.
// Product files live in private storage (STORE_FILES KV), keyed by `file`. Never under public/.
// No desk records, balances, wallet internals, family or reserve data. No return or yield claims.
import { latestFor } from './versions.js';
const COMMON = ['profile.json: name, title, short description', 'instructions.md: narrow role plus HARD LIMITS', 'memories.md: desk conventions', 'skills/getting-started: first-conversation setup, one question at a time', 'routines.md: suggested schedules', 'SETUP.md: import by hand into a new Grok Bot', 'VERSION and CHANGELOG.md', 'Weekly updates: re-download the latest any time'];
export const KIND = 'Grok Bot template';
const t = (o) => ({ priceUsdc: '50', placeholder: false, kind: KIND, format: 'Grok Bot template (ZIP, Markdown + JSON)', includes: COMMON, file: `file:${o.sku}`, version: latestFor(o.sku)?.version ?? null, ...o });

export const CATALOG = [
  t({ sku: 'god-emperor', name: 'The God Emperor', role: "Orchestrator", glyph: 'crown',
    quote: 'The patient ruler who sees the whole path.',
    blurb: "Your single front door. Routes every request to the seat that owns it, runs the decision gates, writes short daily orders and a weekly review, and brings you in only for decisions. Never does specialist work and never approves its own irreversible actions.",
    highlights: ['Route → research gate → completion gate → action guard', 'Daily orders and Sunday review', 'Escalates with options, not walls of text'] }),
  t({ sku: 'moneo', name: 'Moneo', role: "Mentat Researcher", glyph: 'scroll',
    quote: 'The loyal minister and human computer.',
    blurb: "Your research minister. Writes a small, owner-set number of evidence-backed findings a day, each with sources, an uncertainty note and what would prove it wrong, and runs fee-aware backtests before any strategy goes live. Proposes, never trades.",
    highlights: ['Evidence records and a coverage ledger', 'Proposal format with fees and risks', 'Strategy Gate: backtest, stress test, paper trade'] }),
  t({ sku: 'fish-speakers', name: 'The Fish Speakers', role: "Execution Operator", glyph: 'blade',
    quote: 'The disciplined guard who acts only on command.',
    blurb: "Your disciplined execution guard. The only seat that places orders: limit orders you approved on an exact preview, plus standing routines you enabled in writing, inside hard limits: never below cost, a daily realized-loss cap, no leverage, and a HALT-file kill switch.",
    highlights: ['Exact previews before any order', 'Paired exits in the same preview', 'Never sells below cost; stops at the daily loss cap'] }),
  t({ sku: 'anteac', name: 'Anteac', role: "Truthsayer Verifier", glyph: 'eye',
    quote: 'The truthsayer who tells fact from fiction.',
    blurb: "Your independent, read-only Truthsayer. Checks every material claim against a primary source, refuses false \"done\"s, and reconciles fills and records against the desk files each evening. Never trades, never moves money, never sends.",
    highlights: ['accept / verify_more / reject verdicts', 'Completion audits', 'Nightly reconciliation'] }),
  t({ sku: 'hwi-noree', name: 'Hwi Noree', role: "Ambassador of the Trading Desk", glyph: 'ledger',
    quote: 'The gentle, trustworthy envoy.',
    blurb: "Your desk's gentle ambassador. Keeps the records and ledgers, assists the other seats, reports balances to you, and drafts every outward update and reply for your yes. Never sends unasked, never holds anyone else's funds, and shares balances only with recipients you name.",
    highlights: ['Draft-only by design', 'Ledger with sources', 'Privacy-first customer voice'] }),
  t({ sku: 'duncan-idaho', name: 'Duncan Idaho', role: "Income Base and Ticket Planner", glyph: 'sword',
    quote: 'The steadfast swordmaster who prepares the field.',
    blurb: "Your income swordmaster. Plans paycheck splits, dividend income, idle-cash yield and margin safety, and turns verified research into exact limit-order tickets that you enter yourself. Writes tickets, never places them.",
    highlights: ['Fixed ticket format with invalidation', 'Guardrail pre-checks', 'Recurring cash-flow planning'] }),
  t({ sku: 'ixians', name: 'Ixians', role: "Toolmaker and Infrastructure", glyph: 'gear',
    quote: 'The inventive machine-makers.',
    blurb: "Your technocrat toolmakers. Build and maintain the connectors, scripts, guards and dashboards the desk runs on: read-only first, paper mode before live, testnet before mainnet, code-enforced guards, secret scans before every push.",
    highlights: ['Branch, test, preview, release', 'Paper mode first', 'Secret hygiene'] }),
  t({ sku: 'leto-journals', name: "Leto's Secret Journals", role: 'System templates for the Golden Path', glyph: 'book', kind: 'System templates', format: 'ZIP (Markdown)',
    quote: 'The God Emperor\'s journals, for those who come after.',
    blurb: 'The system around the seats: doctrine and playbook, decisions log, lessons with a "clearly better" promotion process, guardrails config, routine calendar, hand-off and approval protocols, shared memory, archive plan and onboarding.',
    includes: ['Weekly updates included', 'Doctrine and playbook template', 'Decisions log', 'lessons.md + "clearly better" promotion process', 'Guardrails config with editable defaults', 'Routine calendar (guard checks, daily briefs, nightly archive, low-data mode)', 'Hand-off and approval protocols', 'Shared-memory layout', 'Backup and archive plan (the Walrus pattern)', 'New-agent onboarding checklist'],
    highlights: ['Nine journals, one coherent system', 'Works with any or all of the seven archetypes', 'Start with doctrine, decisions, rails and memory'] }),
  // Retired 10/9 (staged): not listed, not orderable, no page (/store/full-desk/ redirects). Past paid orders still download file:full-desk.
  { sku: 'full-desk', name: 'The Full Desk', role: 'All seven Grok Bot templates (retired)', glyph: 'sigil', retired: true,
    priceUsdc: '250', placeholder: false, quote: '', blurb: '', includes: [], highlights: [], format: 'ZIP', file: 'file:full-desk' },
  { sku: 'dune-saga-collection', name: 'The Dune Saga Collection', role: 'Every template, now and in the future', glyph: 'sigil', bundle: true, kind: 'Grok Bot template collection', version: latestFor('dune-saga-collection')?.version ?? null,
    priceUsdc: '300', placeholder: false, // Sajan 10/9 ~10:00 PM PT (staged): replaces the $250 Full Desk; singles stay $50
    quote: 'Seven seats, one Golden Path, and every seat still to come.',
    blurb: "All seven Golden Path Desk Grok Bot templates plus Leto's Secret Journals, and every future template at no extra cost. Upgrades are free forever. All sales final.",
    includes: ['All 7 Grok Bot desk templates', "Leto's Secret Journals", 'Every future template, at no extra cost', 'Upgrades free forever: re-download the latest any time', 'Collection overview and README'],
    highlights: ['$300 for every template, now and in the future', 'Upgrades free forever', 'Start with three seats, grow to seven and beyond'],
    format: 'Grok Bot templates (ZIP, Markdown + JSON)', file: 'file:dune-saga-collection' },
  { sku: 'plumbline-pro', name: 'The Spice Melange Trading Desk Pro', role: 'Coming soon', glyph: 'plumb', comingSoon: true,
    priceUsdc: '—', placeholder: true, quote: '', blurb: 'A supporter tier for The Spice Melange Trading Desk, the read-only DeepBook market data connector. Coming soon.', includes: [], highlights: [], format: '', file: '' },
  // Add-on file (Sajan 2026-10-10 12:13 AM PT): desk-kit code, delivered with Fish Speakers and Dune Saga Collection orders
  // as a second signed link. Never listed, never orderable on its own (createOrder refuses addon SKUs).
  { sku: 'desk-kit', name: 'desk-kit', role: 'Add-on: guarded DeepBook bot (training by default)', glyph: 'blade', hidden: true, addon: true,
    addonFor: ['fish-speakers', 'dune-saga-collection'], priceUsdc: '0', placeholder: false, quote: '', blurb: '', includes: [], highlights: [], format: 'ZIP (TypeScript)', file: 'file:desk-kit' },
  // Hidden mainnet self-test (Sajan 10/9 6:26 AM PT). Never listed; ordering needs ?selftest=<STORE_SELFTEST_KEY>.
  { sku: 'selftest', name: 'Store self-test', role: 'internal', glyph: 'sigil', hidden: true,
    priceUsdc: '0.05', placeholder: false, ttlSec: 10800, quote: '', blurb: '', includes: [], highlights: [], format: 'TXT', file: '',
    inline: { name: 'spicemelange-selftest.txt', text: 'The Spice Melange store self-test: payment verified and delivery works.\n' } },
];

export const bySku = (sku) => CATALOG.find((p) => p.sku === sku) ?? null;
export const addonsFor = (sku) => CATALOG.filter((p) => p.addon && p.addonFor?.includes(sku));
export const ARCHETYPES = CATALOG.filter((p) => !p.bundle && !p.comingSoon && !p.hidden && !p.retired);
export const LISTED = CATALOG.filter((p) => !p.hidden && !p.retired);
