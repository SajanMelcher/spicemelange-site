// Catalog + gallery wording from Tleilaxu (portfolio-desk/store/CATALOG-WORDING.md, drafted 2026-10-10 ~2:16 AM PT).
// DRAFT: Sajan approves every word before it goes live. Copy rule (Sajan 2:30 AM PT): Dune product names only, plain wording everywhere else.
export const role = (sku) => CARDS[sku]?.title.split(': ').slice(1).join(': ') ?? null;
export const STANDARD = {
  terms: 'All sales final, except where the law requires otherwise.',
  disclaimer: 'Educational templates, not financial advice; no returns promised.',
  license: 'Single owner, one desk. No resale or redistribution. Free automatic upgrades.',
  format: 'ZIP of Markdown and JSON agent templates (Grok Bot; the Markdown also works on other agent platforms)',
  hardLimits: 'Hard limits come first in every template: the owner approves every order and money move, messages are draft-only, limit orders only, never below cost, a daily loss cap, no leverage, a HALT kill switch.',
};
export const CARDS = {
  'god-emperor': { title: 'The God Emperor: Orchestrator', tagline: 'One front door for your whole desk of agents.',
    bullets: ['Routes each request to the seat that owns it', 'Short daily orders and a weekly review', 'Brings you in only for decisions; never approves its own irreversible actions'],
    description: 'Orchestrator template: routes requests to the right seat, runs decision gates, writes daily orders and a weekly review, and brings the owner in only for decisions.' },
  moneo: { title: 'Moneo: Researcher', tagline: 'Evidence first: a few findings a day, each with sources.',
    bullets: ['An owner-set number of findings, each with an uncertainty note', 'Says what would prove each finding wrong', 'Fee-aware backtests before any strategy goes live; proposes, never trades'],
    description: 'Researcher template: a few evidence-backed findings a day with sources and uncertainty, plus fee-aware backtests before anything goes live. Proposes, never trades.' },
  'duncan-idaho': { title: 'Duncan Idaho: Income Base and Ticket Planner', tagline: 'Plans the base and writes exact tickets you enter yourself.',
    bullets: ['Paycheck splits, dividend and idle-cash planning, margin safety checks', 'Turns verified research into exact limit-order tickets', 'Writes tickets, never places them'],
    description: 'Planner template: income splits, dividend and idle-cash planning, margin safety checks, and exact limit-order tickets the owner enters. Never places orders.' },
  'fish-speakers': { title: 'The Fish Speakers: Execution Operator', tagline: 'The only seat that places orders, and only inside your limits.',
    bullets: ['Limit orders you approved on an exact preview', 'Never below cost, a daily loss cap, no leverage, a HALT kill switch', 'Includes desk-kit: a guarded order-book bot, paper training by default'],
    description: 'Execution template: places only owner-approved limit orders inside hard limits (never below cost, daily loss cap, no leverage, HALT). Includes the desk-kit add-on, paper training by default.' },
  anteac: { title: 'Anteac: Verifier', tagline: 'An independent check on every claim and every "done".',
    bullets: ['Checks material claims against a primary source', 'Reconciles fills and records each evening', 'Read-only: never trades, moves money or sends'],
    description: 'Verifier template: read-only checks of claims against primary sources, and nightly reconciliation of fills and records. Never trades, moves money or sends.' },
  'hwi-noree': { title: 'Hwi Noree: Ambassador of the Trading Desk', tagline: 'Records, ledgers and every outward word, drafted for your yes.',
    bullets: ['Keeps the ledgers and reports balances to you', 'Drafts updates and replies; never sends unasked', 'Shares balances only with recipients you name, and logs every share'],
    description: 'Ambassador template: keeps records and ledgers, reports balances to the owner, and drafts outward messages for approval. Shares balances only with owner-named recipients.' },
  ixians: { title: 'Ixians: Toolmaker and Infrastructure', tagline: 'Builds the tools the desk runs on, carefully.',
    bullets: ['Connectors, scripts, guards and dashboards', 'Read-only first, paper before live, testnet before mainnet', 'Code-enforced guards and secret scans before every push'],
    description: 'Toolmaker template: builds and maintains connectors, scripts, guards and dashboards: read-only first, paper before live, testnet before mainnet.' },
  'leto-journals': { title: "Leto's Secret Journals: System templates", tagline: 'System templates that keep a team of agents consistent.',
    bullets: ['Doctrine, decisions log, lessons and guardrails templates', 'Routine calendar, hand-offs, shared-memory and backup plans', 'A HALT kill switch, and every number set by you'],
    description: "System templates (version 2026.10.10.1): doctrine, decisions, lessons, guardrails, routine calendar, hand-offs, shared memory, backups and onboarding, with a HALT kill switch." },
  'dune-saga-collection': { title: 'The Dune Saga Collection: Every template, now and in the future', tagline: 'Every template now and in the future, for one price.',
    bullets: ['The 7 desk templates plus Leto\'s Secret Journals', 'Every future template at no extra cost', 'Free automatic upgrades, verified by signature'],
    description: 'Every template, now and in the future: the 7 desk templates plus Leto\'s Secret Journals, and every future template at no extra cost. Free automatic upgrades.',
    includesFuture: true, includes: ['god-emperor', 'moneo', 'duncan-idaho', 'fish-speakers', 'anteac', 'hwi-noree', 'ixians', 'leto-journals'] },
};
export const ORDER = ['god-emperor', 'moneo', 'duncan-idaho', 'fish-speakers', 'anteac', 'hwi-noree', 'ixians', 'leto-journals', 'dune-saga-collection'];
