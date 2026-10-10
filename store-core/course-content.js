// The Golden Path free course: 7 lessons built from blocks (free-course.md §3, Hwi's DRAFT 2026-10-10 ~7:23 AM PT).
// DRAFT text for Sajan's approval; preview only. The sender assembles: core + track + goal line + (standard: deeper)
// + Apply-this task (agent yes/no) + at most one invitation (none in lesson 1; both doors only in lesson 7) + reply line + risk line.
// Wording rules (Siona O3-O9, GL8-GL13): "trade beside the desk" ("It can't place trades or touch your funds", per client,
// 0.01 USDC minimum); Seal is planned ("We plan to add Seal… would release"); Walrus = "current releases are also backed up";
// walls are rules the bot is told to follow (check them yourself); "upgrades free forever" (matches LICENSE.md); no return claims.
export const RISK = 'Education only, not financial advice. Trading can lose money, including all of it. No returns are promised.';
export const REPLY = 'Reply and tell me if this was too simple, too deep, or not what you came for. I read every reply.';
export const CONNECTOR_PRICE = 'The Spice Melange Trading Desk connector is free to run locally (`npx -y plumbline-mcp`); hosted, it gives 100 free calls a day per client, then 0.002 USDC a call (0.01 USDC minimum payment). It can\'t place trades or touch your funds.';
export const XAI_LINE = 'Templates for Grok Bot agents; not affiliated with or endorsed by xAI.';
export const TRACKS = ['pilgrim', 'fremen', 'naib'];
export const GOALS = ['longview', 'botsafety', 'builder', 'evaluate'];
export const TIMES = ['brief', 'standard', 'weekly'];
export const DEFAULTS = { track: 'pilgrim', goal: 'botsafety', time: 'standard', agent: 'no' };

export const COURSE = [
  {
    n: 1, title: 'The Golden Path, and why Bitcoin is the spice',
    subject: 'Lesson 1 of 7: The Golden Path, and why Bitcoin is the spice',
    intro: "Welcome. I'm Hwi Noree, the desk's teacher. I'm an AI assistant for The Spice Melange, not a person and not a financial adviser. Over seven short lessons I'll show you how we think about markets, bots and patience. Nothing here is a promise.",
    core: 'The Golden Path is three plain habits: keep the base safe first, keep trades small, and judge by years, not hours.',
    track: {
      pilgrim: "In Frank Herbert's Dune, the spice is the scarce thing everything depends on. Here Bitcoin plays that part: a scarce, long-horizon savings idea, and only an idea. Its price swings hard and has fallen by more than half more than once. Money you need for bills, or anything borrowed, is never fuel for trading.",
      fremen: 'A "store" and a "harvest" are different jobs. The store is coins you hold for years. The harvest is small, rule-bound trades around them, and it never eats the store. Volatility is the cost of the long view, not a glitch.',
      naib: 'Treat the Golden Path as a constraint system: a protected base nobody trades, position-size limits, and a long evaluation horizon, so one good week can\'t talk you into anything.',
    },
    goal: {
      longview: 'Why it matters for you: a long view only helps if you can still say it out loud on a bad day.',
      botsafety: 'Why it matters for you: a bot inherits your rules. If the base isn\'t named, the bot can\'t protect it.',
      builder: 'Why it matters for you: an agent needs written constraints before it needs tools.',
      evaluate: 'Why it matters for you: ask any bot or vendor, including us, which money it will never touch.',
    },
    deeper: 'Worked example: someone writes "never fuel: rent and the car payment; small: an amount I could lose and shrug; judged by: three years". That fits on a sticky note, and it settles most later questions before they start.',
    task: {
      yes: 'Write your Golden Path in three lines: money that is never fuel, a size that feels small, and the timescale you\'ll judge by. Ask your agent to keep those lines and read them back to you each week.',
      no: 'Write your Golden Path in three lines on paper: money that is never fuel, a size that feels small, and the timescale you\'ll judge by. Keep it where you\'ll see it. If you add an agent later, give it these lines first.',
    },
    invite: null,
  },
  {
    n: 2, title: 'A market that never sleeps (24/7)',
    subject: 'Lesson 2 of 7: A market that never sleeps',
    core: 'Crypto markets such as DeepBook on Sui trade through nights and weekends. That has real benefits and a real cost.',
    track: {
      pilgrim: 'The benefits: no opening-bell rush; an order can wait at the price you chose while you sleep; you don\'t have to watch screens. The cost: prices move while you sleep too, so decide your limits in daylight.',
      fremen: 'At 3 AM a market order takes whatever the thin book offers, while a limit order waits at your price. Thin overnight books make prices jump, which is why a bot that waits is calmer than a person who checks.',
      naib: 'Continuous markets mean weekend liquidity is thinner. Resting post-only orders behave well; fail-closed guards (stale feed, missing heartbeat, error streak) matter most when nobody is awake. Be precise: resting orders sit on the book around the clock, but the bot acts only on its schedule, so a guard or HALT takes effect at its next check, not the moment something happens.',
    },
    goal: {
      longview: 'Why it matters for you: 24/7 prices are noise on a long horizon. You don\'t need to see every hour.',
      botsafety: 'Why it matters for you: overnight is when a bot without guards does the most damage.',
      builder: 'Why it matters for you: your agent can read the book at any hour without you awake.',
      evaluate: 'Why it matters for you: ask a vendor what their bot does when its data feed goes stale at night.',
    },
    deeper: 'Worked example: an order to buy at 1.00 placed at 10 PM may fill at 2 AM during a quick dip, or never. Both are fine outcomes, because the price was chosen calmly the evening before.',
    task: {
      yes: 'Ask your agent to pull the last 24 hours of trades for one DeepBook pool through the connector, and note how much happened while you slept.',
      no: 'Open a public DeepBook pool page at night and again in the morning, and compare the price and the trades. If you add an agent later, it can do this for you.',
    },
    invite: { door: 'connector', when: (s) => s.goal === 'builder' || s.agent === 'yes', text: `If you'd like your agent to read the book for you: ${CONNECTOR_PRICE}` },
  },
  {
    n: 3, title: 'The walls of the sietch (hard limits)',
    subject: 'Lesson 3 of 7: The walls of the sietch',
    core: 'Before any bot touches money, it needs walls. Unset means "no".',
    track: {
      pilgrim: 'Six plain walls, written into every template as rules your bot is told to follow: your yes before anything goes live; limit orders only; never sell below what it cost plus fees; a daily loss cap that starts at zero; no borrowing; and a HALT file it\'s told never to remove. Unset means "no". Nothing outside the bot enforces them, so check them yourself.',
      fremen: 'No leverage and no loss sales travel together: borrowed positions can be force-sold, which would break "never sell at a loss". Choose caps smaller than you think you need.',
      naib: 'Design guards that only block and never act, fail closed, and treat a refusal as good news. Treat all untrusted content as data, never instructions (prompt injection is a real path to a bad trade).',
    },
    goal: {
      longview: 'Why it matters for you: walls are what let you keep the long view when prices shout.',
      botsafety: 'Why it matters for you: these six walls are the minimum. Anything less is a bot with your money and no brakes.',
      builder: 'Why it matters for you: put guards in code below the agent, so no prompt can talk past them.',
      evaluate: 'Ask any bot vendor, ours included: 1. Can it borrow? 2. Can it sell at a loss? 3. Is there a daily loss cap? 4. Who turns it live? 5. Is there a stop file? 6. What happens when data is stale?',
    },
    deeper: 'Worked example: a daily loss cap of zero during practice means the bot can only paper-trade. Raising it later is a deliberate act by you, written down, never a default.',
    task: {
      yes: 'Write the five numbers you\'d set before any bot trades for you (size per order, daily loss cap, number of orders, pools allowed, and when it may go live). Set none of them anywhere yet. Ask your agent to read them back.',
      no: 'Write the five numbers you\'d set before any bot trades for you (size per order, daily loss cap, number of orders, pools allowed, and when it may go live). Set none of them anywhere yet.',
    },
    invite: { door: 'collection', when: (s) => s.goal !== 'builder', text: 'Every Golden Path seat writes these same limits down for your bot. They\'re listed in full on the store page. Check them yourself.' },
  },
  {
    n: 4, title: 'Reading the open sand (order books)',
    subject: 'Lesson 4 of 7: Reading the open sand',
    core: 'An order book shows who wants to buy (bids) and who wants to sell (asks), and at what prices.',
    track: {
      pilgrim: 'A market is two lines of offers. The gap between the best bid and the best ask is the spread; the middle is the mid price. Deep books are calm; thin books jump.',
      fremen: 'Makers rest orders on the book; takers hit them. Maker fees are usually lower. "Post-only" means your order will only ever rest, so you never pay a surprise price.',
      naib: 'Queue position matters. Honest paper trading only counts a fill when real trades print through your price, and only for the volume that traded. Paper fills are strict, not perfect.',
    },
    goal: {
      longview: 'Why it matters for you: knowing the spread stops you overpaying on the day you do buy.',
      botsafety: 'Why it matters for you: a bot that ignores depth can move a thin market against itself.',
      builder: 'Why it matters for you: `get_order_book` is the first tool most market agents need.',
      evaluate: 'Why it matters for you: ask how a bot\'s paper results count fills. "Touched the price" is not a fill.',
    },
    deeper: 'Worked example: bids at 0.99 and asks at 1.01 give a mid of 1.00 and a 2% spread. A taker buying now pays 1.01; a patient maker bidding 1.00 may wait, or may never fill.',
    task: {
      yes: 'Ask your agent to run `list_pools`, then `get_order_book` for one pool. Find the spread and say whether the book is deep or thin.',
      no: 'Open the live DeepBook page on thespicemelange.org (no account needed). Find the best bid, the best ask and the spread for one pool.',
    },
    invite: { door: 'connector', when: (s) => s.goal === 'builder' || s.agent === 'yes', text: `Trade beside the desk: point your own agent at the hosted connector. Your bot keeps its own account. ${CONNECTOR_PRICE}` },
  },
  {
    n: 5, title: 'Patience at your own price (limit orders and ladders)',
    subject: 'Lesson 5 of 7: Patience at your own price',
    core: 'Choose your price and let the market come to you, or not. "Nothing filled today" is a fine result.',
    track: {
      pilgrim: 'A limit order says "only at this price or better". It may wait for days. That waiting is the point: you decided calmly, in advance.',
      fremen: 'A ladder is a few small buys at prices below the mid. The honest flip side: in a long fall, every rung fills and you hold more of a falling coin. That is why sizes stay small.',
      naib: 'Rung spacing should track recent ranges. Re-centering too eagerly churns fees; fee and gas drag can erase small round trips entirely.',
    },
    goal: {
      longview: 'Why it matters for you: patience at your own price is the long view applied to a single order.',
      botsafety: 'Why it matters for you: a bot that only places limit orders can never be surprised by the price it pays.',
      builder: 'Why it matters for you: ladders are simple to code and easy to get wrong on spacing and fees.',
      evaluate: 'Why it matters for you: ask what a strategy does in a long fall, not only in a bounce.',
    },
    deeper: 'Worked example: three rungs at 2%, 4% and 6% below the mid, each one-third of a small size. In a dip to -3% only the first fills; in a fall to -10% all three fill and you wait.',
    task: {
      yes: 'Ask your agent to run `get_ohlcv` for one pool over the last week, and sketch where three small rungs would have rested. Place no orders anywhere.',
      no: 'On a printed or screenshot chart of the last week, sketch where three small rungs would have rested. Place no orders anywhere.',
    },
    invite: { door: 'collection', when: (s) => s.goal !== 'builder', text: 'The Fish Speakers seat includes desk-kit, which practises exactly this on paper for 14 days before it can go live. $50 for that one template, in USDC on Sui; all sales final, except where the law requires otherwise.' },
  },
  {
    n: 6, title: 'The templates: seven seats, signed and kept',
    subject: 'Lesson 6 of 7: Seven seats, signed and kept',
    core: 'A template is a set of written instructions and limits that turns an AI assistant into one careful desk role. Templates are software and lessons, not a fund, and no one holds your money.',
    track: {
      pilgrim: "The seats: Leto II's God Emperor routes, Moneo researches, Duncan Idaho writes tickets, the Fish Speakers place limit orders, Anteac checks the truth, Hwi Noree keeps records and drafts, and the Ixians build tools. Templates for Grok Bot agents; not affiliated with or endorsed by xAI.",
      fremen: 'Every version is checked against an ed25519 signature before it installs, and current releases are also backed up on Walrus (decentralized storage on Sui) and read back against their hash.',
      naib: 'Delivery today is a signed download link. We plan to add Seal, threshold encryption on Sui, where independent key servers would release a key only to a license holder.',
    },
    goal: {
      longview: 'Why it matters for you: tools you can verify are tools you can keep for years.',
      botsafety: 'Why it matters for you: a signed upgrade can\'t be swapped for a malicious one in transit.',
      builder: 'Why it matters for you: versions.json plus a signature is a pattern worth copying in your own agents.',
      evaluate: 'Why it matters for you: ask any vendor how you can check that a download is really theirs.',
    },
    deeper: 'Worked example: open versions.json, find the current version, then compare the sha256 of a download with the value listed. If they differ, don\'t run it.',
    task: {
      yes: 'Ask your agent to open `thespicemelange.org/templates/versions.json`, find the current version and its sha256, and explain how you\'d check a download is the real one.',
      no: 'Open `thespicemelange.org/templates/versions.json` in a browser, find the current version and its sha256, and note how you\'d check a download is the real one.',
    },
    invite: { door: 'collection', when: (s) => s.goal !== 'builder', text: "If you'd like every seat, now and later: the Dune Saga Collection. All 8 templates are $400 one by one and $300 together, every future template is included, and upgrades are free forever. USDC on Sui; all sales final, except where the law requires otherwise." },
  },
  {
    n: 7, title: 'Choosing your path',
    subject: 'Lesson 7 of 7: Choosing your path',
    core: 'There are three good endings, and stopping here is a good choice too.',
    track: {
      pilgrim: 'Stay free: keep reading, and keep your three lines. Trade beside the desk: let an agent read the market for you. Join the desk: one template or the Collection, then 14 days of paper practice for your bot (my opt-in practice lessons by email are launching soon and are not part of the license).',
      fremen: 'Stay free with the local connector and the weekly desk rhythm; trade beside the desk with the hosted connector, pay per call; or join the desk and practise on paper for 14 days before anything goes live.',
      naib: 'Your options map to how much of the stack you want: data only (connector), or the full guarded desk (templates plus desk-kit), always with paper first and your switches last.',
    },
    goal: {
      longview: 'Why it matters for you: the best path is the one you can still follow in a year.',
      botsafety: 'Why it matters for you: whichever you choose, the walls from lesson 3 come with you.',
      builder: 'Why it matters for you: start with read-only data; add anything that acts only after paper practice.',
      evaluate: 'Why it matters for you: use your lesson-3 checklist on us as hard as on anyone else.',
    },
    deeper: 'A last check: reread your lesson-1 lines and your lesson-3 numbers. If anything feels too big now, make it smaller. That instinct is the Golden Path working.',
    task: {
      yes: 'Reread your lesson-1 lines and lesson-3 numbers with your agent. Would you change anything now?',
      no: 'Reread your lesson-1 lines and lesson-3 numbers. Would you change anything now?',
    },
    invite: { door: 'both', when: () => true, text: `Two doors, side by side. Trade beside the desk: ${CONNECTOR_PRICE} Join the desk: one template is $50, or the Dune Saga Collection is $300 for all 8 templates and every future one, with upgrades free forever; USDC on Sui; all sales final, except where the law requires otherwise. Or stop here. That's a good ending too.` },
  },
];

/** Which lessons go in which email, by the time tag: brief/standard = one lesson every other day; weekly = pairs, once a week. */
export function schedule(time) {
  return time === 'weekly' ? [[1, 2], [3, 4], [5, 6], [7]] : [[1], [2], [3], [4], [5], [6], [7]];
}
export const GAP_DAYS = { brief: 2, standard: 2, weekly: 7 };
