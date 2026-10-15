/**
 * Non-custodial agent trading helpers (v0.4.0).
 * The desk NEVER creates, holds or sees keys and never moves funds. It only returns quotes, routes and
 * UNSIGNED transaction bytes. The agent signs locally with its own key and submits to a Sui fullnode itself.
 * No leverage, no margin, spot swaps only. Education only; no return claims.
 */
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Transaction, coinWithBalance } from "@mysten/sui/transactions";
import { isValidSuiAddress, normalizeSuiAddress, toBase64, fromBase64 } from "@mysten/sui/utils";
import { deepbook } from "@mysten/deepbook-v3";
import { AggregatorClient, Env } from "@cetusprotocol/aggregator-sdk";
import BN from "bn.js";

// Site copy of deepbook-mcp/src/trading.ts (same quote/build logic). Fee rate comes from the build env PUBLIC_DESK_FEE_BPS
// (unset = 30 bps, the production rate Sajan approved 1:01 PM PT 10/15; same as the connector's fly.toml).
const ENV: Record<string, string | undefined> = { DESK_FEE_BPS: (import.meta as any).env?.PUBLIC_DESK_FEE_BPS ?? "30" };
export const FULLNODE = ENV.PLUMBLINE_FULLNODE_URL || "https://fullnode.mainnet.sui.io:443";

export const COINS = {
  SUI: { type: "0x0000000000000000000000000000000000000000000000000000000000000002::sui::SUI", decimals: 9 },
  USDC: { type: "0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC", decimals: 6 },
  WAL: { type: "0x356a26eb9e012a68958082340d4c4116e7f55615cf27affcff209cf0ae544f59::wal::WAL", decimals: 9 },
  DEEP: { type: "0xdeeb7a4662eec9f2f3def03fb937a663dddaa2e215b8078a284d026b7946c270::deep::DEEP", decimals: 6 },
  CETUS: { type: "0x06864a6f921804860930db6ddbe2e16acdf8504495ea7481637a1c8b9a8fe54b::cetus::CETUS", decimals: 9 },
} as const;
export type Sym = keyof typeof COINS;
export const SYMBOLS = Object.keys(COINS) as Sym[];

/** DeepBook v3 pools (BASE_QUOTE) among the supported coins. CETUS has no DeepBook pool: Cetus aggregator only. */
export const DB_POOLS: Record<string, [Sym, Sym]> = {
  SUI_USDC: ["SUI", "USDC"], WAL_USDC: ["WAL", "USDC"], DEEP_USDC: ["DEEP", "USDC"], WAL_SUI: ["WAL", "SUI"], DEEP_SUI: ["DEEP", "SUI"],
};

/**
 * Desk integrator fee (Sajan 10/15 12:09 PT): a small, DISCLOSED fee to the desk trading wallet, shown on every quote.
 * Preview placeholder = 10 bps; the production rate is TBD by Sajan (set DESK_FEE_BPS; 0 turns it off). Hard cap 30 bps.
 *  - Cetus routes: native aggregator "overlay fee" (overlayFeeRate + overlayFeeReceiver); taken from the output in the same tx.
 *  - DeepBook routes: no native integrator fee on swaps, so the PTB splits the fee from the output coin and transfers it
 *    to the desk wallet in the same signed transaction (visible in the tx before signing).
 */
export const DESK_FEE_WALLET = "0x340480183e48ac0b45e883d2c8f6e3d37f57dd88d42c17a5c457293bf9fbd9d5";
export function feeConfig(env: Record<string, string | undefined> = ENV) {
  const raw = env.DESK_FEE_BPS;
  const bps = raw === undefined || raw === "" ? 10 : Number(raw); // 10 = preview placeholder
  const receiver = env.DESK_FEE_RECEIVER || DESK_FEE_WALLET;
  const ok = Number.isFinite(bps) && bps > 0 && bps <= 30 && isValidSuiAddress(receiver);
  return { enabled: ok, bps: ok ? bps : 0, rate: ok ? bps / 1e4 : 0, receiver: ok ? normalizeSuiAddress(receiver) : null, status: raw === undefined || raw === "" ? "preview placeholder (production rate TBD)" : "configured" };
}
export const INTEGRATOR_FEE = feeConfig();
const feeOn = () => INTEGRATOR_FEE.enabled;
export function feeDisclosure() {
  return INTEGRATOR_FEE.enabled
    ? { desk_fee_bps: INTEGRATOR_FEE.bps, desk_fee_receiver: INTEGRATOR_FEE.receiver, status: INTEGRATOR_FEE.status,
        text: `A ${INTEGRATOR_FEE.bps / 100}% desk fee (${INTEGRATOR_FEE.bps} bps) of the output goes to the desk wallet ${INTEGRATOR_FEE.receiver} in the same transaction. expected_out is AFTER this fee. It is visible in the unsigned transaction before you sign.` }
    : { desk_fee_bps: 0, text: "No desk fee." };
}

export class TradeInputError extends Error {}

export function sym(s: string): Sym {
  const u = s.trim().toUpperCase();
  if (!(u in COINS)) throw new TradeInputError(`Unsupported coin "${s}". Supported: ${SYMBOLS.join(", ")}`);
  return u as Sym;
}
export function addr(a: string): string {
  if (!isValidSuiAddress(a)) throw new TradeInputError(`"${a}" is not a valid Sui address (0x + 64 hex)`);
  return normalizeSuiAddress(a);
}
const toRaw = (s: Sym, amt: number) => BigInt(Math.round(amt * 10 ** COINS[s].decimals));
const fromRaw = (s: Sym, raw: bigint | string | number) => Number(raw) / 10 ** COINS[s].decimals;

let _grpc: SuiGrpcClient | undefined;
export function grpc() { return (_grpc ??= new SuiGrpcClient({ network: "mainnet", baseUrl: FULLNODE })); }
/** DeepBook client scoped to a sender address (the address is only used as the simulated/tx sender, never a key). */
function dbClient(sender: string) {
  return new SuiGrpcClient({ network: "mainnet", baseUrl: FULLNODE }).$extend(deepbook({ address: sender }));
}
function cetus(sender: string) {
  return new AggregatorClient({
    env: Env.Mainnet, signer: sender,
    ...(feeOn() ? { overlayFeeRate: INTEGRATOR_FEE.rate, overlayFeeReceiver: INTEGRATOR_FEE.receiver! } : {}),
  });
}

/** One DeepBook hop description. */
interface Hop { pool: string; sell: "base" | "quote"; from: Sym; to: Sym }
function hop(from: Sym, to: Sym): Hop | null {
  for (const [pool, [b, q]] of Object.entries(DB_POOLS)) {
    if (b === from && q === to) return { pool, sell: "base", from, to };
    if (q === from && b === to) return { pool, sell: "quote", from, to };
  }
  return null;
}
/** Direct pool, else 2 hops through USDC or SUI. */
export function deepbookPaths(from: Sym, to: Sym): Hop[][] {
  const out: Hop[][] = [];
  const d = hop(from, to); if (d) out.push([d]);
  for (const mid of ["USDC", "SUI"] as Sym[]) {
    if (mid === from || mid === to) continue;
    const a = hop(from, mid), b = hop(mid, to);
    if (a && b) out.push([a, b]);
  }
  return out;
}

async function dbHopOut(c: ReturnType<typeof dbClient>, h: Hop, amountIn: number): Promise<number> {
  // Input-token fee mode: fees are taken from the input coin, so the agent needs no DEEP.
  if (h.sell === "base") return (await c.deepbook.getQuoteQuantityOutInputFee(h.pool, amountIn)).quoteOut;
  return (await c.deepbook.getBaseQuantityOutInputFee(h.pool, amountIn)).baseOut;
}

export interface RouteQuote {
  venue: "deepbook" | "cetus";
  route: string;
  amount_in: number;
  expected_out: number;
  price: number;           // to per from
  price_impact_pct: number | null;
  fees: Record<string, unknown>;
  hops?: Hop[];
  providers?: string[];
  error?: string;
}

async function deepbookMidRate(c: ReturnType<typeof dbClient>, path: Hop[]): Promise<number> {
  let r = 1;
  for (const h of path) { const m = await c.deepbook.midPrice(h.pool); r *= h.sell === "base" ? m : 1 / m; }
  return r;
}

async function quoteDeepbook(from: Sym, to: Sym, amount: number, sender: string): Promise<RouteQuote[]> {
  const c = dbClient(sender);
  const res: RouteQuote[] = [];
  for (const path of deepbookPaths(from, to)) {
    const route = path.map((h) => h.pool).join(" -> ");
    try {
      let x = amount;
      for (const h of path) { x = await dbHopOut(c, h, x); if (!(x > 0)) throw new Error(`${h.pool}: output 0 (amount below pool min size/lot, or no liquidity)`); }
      const fees: Record<string, unknown> = { mode: "taker fee paid in the input coin (no DEEP needed); expected_out is already net of fees" };
      for (const h of path) fees[h.pool] = { taker_fee_rate: (await c.deepbook.poolTradeParams(h.pool)).takerFee };
      const ref = await deepbookMidRate(c, path);
      const gross = x; x = x * (1 - INTEGRATOR_FEE.rate);
      if (INTEGRATOR_FEE.enabled) fees.desk_fee = { bps: INTEGRATOR_FEE.bps, amount: gross - x };
      res.push({ venue: "deepbook", route, amount_in: amount, expected_out: x, price: x / amount,
        price_impact_pct: ref > 0 ? +((1 - x / amount / ref) * 100).toFixed(4) : null, fees, hops: path });
    } catch (e) {
      res.push({ venue: "deepbook", route, amount_in: amount, expected_out: 0, price: 0, price_impact_pct: null, fees: {}, hops: path, error: (e as Error).message });
    }
  }
  return res;
}

async function cetusRouter(from: Sym, to: Sym, amount: number, sender: string) {
  const r: any = await cetus(sender).findRouters({ from: COINS[from].type, target: COINS[to].type, amount: new BN(toRaw(from, amount).toString()), byAmountIn: true });
  if (!r || r.insufficientLiquidity || r.error) throw new Error(`no Cetus route (${r?.error ? JSON.stringify(r.error) : "insufficient liquidity"})`);
  return r;
}

async function cetusImpact(from: Sym, to: Sym, amount: number, out: number, sender: string): Promise<number | null> {
  try {
    // Reference = Cetus quote for 1% of the size (DeepBook mids can be stale on thin pools).
    const small = amount / 100; const r = await cetusRouter(from, to, small, sender); const ref = fromRaw(to, r.amountOut.toString()) / small;
    return ref > 0 ? +((1 - out / amount / ref) * 100).toFixed(4) : null;
  } catch { return null; }
}

async function quoteCetus(from: Sym, to: Sym, amount: number, sender: string): Promise<RouteQuote> {
  try {
    const r = await cetusRouter(from, to, amount, sender);
    const out = fromRaw(to, r.amountOut.toString());
    const providers = [...new Set<string>(r.paths.map((p: any) => p.provider))];
    return {
      venue: "cetus", route: `Cetus aggregator (${providers.join("/")}, ${r.paths.length} path legs)`, amount_in: amount, expected_out: out, price: out / amount,
      price_impact_pct: await cetusImpact(from, to, amount, out, sender),
      fees: { pool_fee_rates: r.paths.map((p: any) => ({ provider: p.provider, fee_rate: p.feeRate })), desk_fee: feeOn() ? { bps: INTEGRATOR_FEE.bps, amount: fromRaw(to, r.overlayFee ?? 0), mechanism: "Cetus overlay fee" } : null, note: "expected_out is net of pool fees and the desk fee" },
      providers,
    };
  } catch (e) {
    return { venue: "cetus", route: "Cetus aggregator", amount_in: amount, expected_out: 0, price: 0, price_impact_pct: null, fees: {}, error: (e as Error).message };
  }
}

/** Cetus CLMM pool ids used by the current aggregator route (for read-only pool inspection). */
export async function cetusRoutePools(from: Sym, to: Sym): Promise<string[]> {
  const amt = from === "USDC" ? 10 : from === "SUI" ? 10 : 100;
  const r: any = await cetus("0x" + "0".repeat(63) + "1").findRouters({ from: COINS[from].type, target: COINS[to].type, amount: new BN(toRaw(from, amt).toString()), byAmountIn: true, providers: ["CETUS"] });
  if (!r || r.error || r.insufficientLiquidity) return [];
  return [...new Set<string>(r.paths.filter((p: any) => p.provider === "CETUS").map((p: any) => p.id))];
}

export async function getSwapQuote(a: { from: string; to: string; amount: number; sender: string }) {
  const from = sym(a.from), to = sym(a.to), sender = addr(a.sender);
  if (from === to) throw new TradeInputError("from and to must differ");
  if (!(a.amount > 0) || !Number.isFinite(a.amount)) throw new TradeInputError("amount must be > 0 (human units of the from coin)");
  const [db, ce] = await Promise.all([quoteDeepbook(from, to, a.amount, sender), quoteCetus(from, to, a.amount, sender)]);
  const all = [...db, ce];
  const valid = all.filter((r) => !r.error && r.expected_out > 0).sort((x, y) => y.expected_out - x.expected_out);
  const best = valid[0];
  return {
    from, to, amount_in: a.amount, sender,
    best: best ? { venue: best.venue, route: best.route, expected_out: best.expected_out, price_impact_pct: best.price_impact_pct } : null,
    routes: all.map(({ hops, ...r }) => r),
    desk_fee: feeDisclosure(),
    next_step: best ? `Call build_swap_tx with venue="${best.venue}"${best.venue === "deepbook" ? ` and route="${best.route}"` : ""}, then sign the bytes locally and submit them yourself.` : "No route available.",
    note: "Quotes move with the market. Not financial advice; no return is implied.",
  };
}

export async function buildSwapTransaction(a: { from: string; to: string; amount: number; sender: string; venue: "deepbook" | "cetus"; route?: string; slippage_bps: number }) {
  const from = sym(a.from), to = sym(a.to), sender = addr(a.sender);
  if (from === to) throw new TradeInputError("from and to must differ");
  if (!(a.amount > 0)) throw new TradeInputError("amount must be > 0");
  if (!(a.slippage_bps >= 1 && a.slippage_bps <= 500)) throw new TradeInputError("slippage_bps must be 1..500");
  const slip = a.slippage_bps / 1e4;
  const tx = new Transaction();
  tx.setSender(sender);
  let expected = 0, minOut = 0, route = "";
  if (a.venue === "deepbook") {
    const paths = deepbookPaths(from, to);
    const path = a.route ? paths.find((p) => p.map((h) => h.pool).join(" -> ") === a.route) : paths[0];
    if (!path) throw new TradeInputError(`No DeepBook route ${a.route ?? ""} for ${from}->${to}. Options: ${paths.map((p) => p.map((h) => h.pool).join(" -> ")).join(" | ") || "none"}`);
    route = path.map((h) => h.pool).join(" -> ");
    const c = dbClient(sender);
    let x = a.amount; const outs: number[] = [];
    for (const h of path) { x = await dbHopOut(c, h, x); outs.push(x); if (!(x > 0)) break; }
    if (!(x > 0)) throw new TradeInputError("DeepBook route returns 0 for this amount (below min size or no liquidity); use a larger amount or venue=cetus");
    const grossMin = x * (1 - slip);
    expected = x * (1 - INTEGRATOR_FEE.rate); minOut = grossMin * (1 - INTEGRATOR_FEE.rate);
    let carry: any = coinWithBalance({ type: COINS[from].type, balance: toRaw(from, a.amount) });
    let carryAmt = a.amount;
    const leftovers: any[] = [];
    path.forEach((h, i) => {
      const last = i === path.length - 1;
      const hopMin = last ? grossMin : 0; // only the final hop enforces the user's limit (it covers the whole route)
      const params: any = { poolKey: h.pool, amount: carryAmt, deepAmount: 0, minOut: +hopMin.toFixed(COINS[h.to].decimals), isBaseToCoin: h.sell === "base" };
      if (h.sell === "base") params.baseCoin = carry; else params.quoteCoin = carry;
      const [b, q, d] = tx.add(c.deepbook.deepBook.swapExactQuantity(params));
      const outCoin = h.sell === "base" ? q : b; const rest = h.sell === "base" ? b : q;
      leftovers.push(rest, d);
      carry = outCoin; carryAmt = +(outs[i]! * (1 - 1e-6)).toFixed(COINS[h.to].decimals);
    });
    if (INTEGRATOR_FEE.enabled) {
      const feeRaw = BigInt(Math.floor(grossMin * INTEGRATOR_FEE.rate * 10 ** COINS[to].decimals)); // fee on the guaranteed minimum, never more
      if (feeRaw > 0n) { const [fee] = tx.splitCoins(carry, [tx.pure.u64(feeRaw)]); tx.transferObjects([fee], INTEGRATOR_FEE.receiver!); }
    }
    tx.transferObjects([carry, ...leftovers], sender);
  } else {
    const r = await cetusRouter(from, to, a.amount, sender);
    expected = fromRaw(to, r.amountOut.toString()); minOut = expected * (1 - slip);
    route = `Cetus aggregator (${[...new Set(r.paths.map((p: any) => p.provider))].join("/")})`;
    const inCoin = coinWithBalance({ type: COINS[from].type, balance: toRaw(from, a.amount) });
    const out = await cetus(sender).routerSwap({ router: r, inputCoin: inCoin as any, slippage: slip, txb: tx as any });
    tx.transferObjects([out as any], sender);
  }
  return { tx, meta: { sender, from, to, amount_in: a.amount, venue: a.venue, route, expected_out: expected, min_out: minOut, slippage_bps: a.slippage_bps, desk_fee: feeDisclosure() } };
}

export async function buildSwapTx(a: Parameters<typeof buildSwapTransaction>[0]) {
  const { tx, meta } = await buildSwapTransaction(a);
  const { sender, from, to, venue: _v, route, expected_out: expected, min_out: minOut } = meta;
  const b64 = toBase64(await tx.build({ client: grpc() as any }));
  return {
    unsigned_tx_bytes_base64: b64, sender, from, to, amount_in: a.amount, venue: a.venue, route,
    expected_out: expected, min_out: minOut, slippage_bps: a.slippage_bps,
    desk_fee: feeDisclosure(),
    sign_and_submit: "Inspect the bytes, sign locally with your own key (keypair.signTransaction(bytes)), then submit to a public fullnode yourself (client.executeTransaction). The desk never sees your key.",
    note: "The transaction reverts on-chain if output is below min_out. Quotes expire quickly; rebuild if stale. Not financial advice.",
  };
}

/** Simulate unsigned bytes against mainnet (no signature, nothing executed). */
export async function simulateBytes(b64: string) {
  const sim: any = await (grpc() as any).core.simulateTransaction({ transaction: fromBase64(b64), include: { effects: true, balanceChanges: true } });
  const t = sim.Transaction ?? sim.FailedTransaction ?? sim.transaction;
  return { success: t?.effects?.status?.success ?? false, error: t?.effects?.status?.error ?? null, gasUsed: t?.effects?.gasUsed ?? null, balanceChanges: t?.balanceChanges ?? null };
}

export const WALLET_SETUP_GUIDE = {
  principles: [
    "Non-custodial: generate the key on YOUR machine. Never send the secret key, seed phrase or keystore to the desk, this connector, or any chat/log.",
    "The desk only returns quotes and unsigned transaction bytes. You sign and submit yourself.",
    "Spot swaps only; no leverage. Start small. Education only, not financial advice.",
  ],
  steps: [
    "1. npm i @mysten/sui (v2+).",
    "2. Generate an Ed25519 keypair locally (code below) and store the secret in a local secret store/env var with restricted file permissions (chmod 600). Back it up offline.",
    "3. Share only the public address (0x...).",
    "4. Fund the address: some SUI for gas (about 0.1-0.5 SUI covers many swaps) plus the coin you want to sell (e.g. USDC on Sui, native Circle USDC type 0xdba3...::usdc::USDC). Withdraw from an exchange on the Sui network or send from another wallet.",
    "5. Call get_swap_quote(from,to,amount,sender) then build_swap_tx(...) to receive unsigned bytes.",
    "6. Verify the bytes (optional: client.core.simulateTransaction), sign locally, submit to a fullnode yourself, and check the digest on a Sui explorer.",
  ],
  code_generate: `import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
const kp = new Ed25519Keypair();               // generated locally, never leaves this machine
console.log('address:', kp.toSuiAddress());     // safe to share
// kp.getSecretKey() returns a 'suiprivkey1...' string: save it to a local secret store, NEVER print, log, or send it.`,
  code_sign_submit: `import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fromBase64 } from '@mysten/sui/utils';
const kp = Ed25519Keypair.fromSecretKey(process.env.SUI_SECRET_KEY!); // your own key, loaded locally
const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: 'https://fullnode.mainnet.sui.io:443' });
const bytes = fromBase64(unsigned_tx_bytes_base64);              // from build_swap_tx
const sim = await client.core.simulateTransaction({ transaction: bytes, include: { effects: true, balanceChanges: true } }); // optional check
const { signature } = await kp.signTransaction(bytes);
const res = await client.core.executeTransaction({ transaction: bytes, signatures: [signature], include: { effects: true } });
console.log(res);`,
  gas_note: "Sui gas is paid in SUI from the sender. build_swap_tx sets a gas budget and picks gas coins owned by the sender when it builds, so build after funding.",
};
