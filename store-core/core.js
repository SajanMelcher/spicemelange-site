/**
 * P30 store core: Sui USDC checkout verified by tx digest.
 * Ported from Plumbline (deepbook-mcp/src/payments.ts, scheme "sui-challenge" v2) to Web Crypto + KV
 * so it runs in a Cloudflare Pages Function. Receive-only: the server never holds keys.
 *
 * Flow: createOrder -> buyer pays EXACT amount (price + unique sub-cent tag) -> verifyOrder(digest)
 * -> signed, short-lived download link (HMAC-SHA256, secret in a Pages secret).
 *
 * Checks (same as Plumbline): SUCCESS status, pinned coin type, net credit to payTo EQUAL to the
 * order amount (BigInt), tx time inside [created - skew, expires + skew] and not in the future,
 * digest never used before, order not already paid, chain identifier matches the network.
 */
import { bySku } from './catalog.js';

export const SUI_USDC = {
  // Circle native USDC. Source: https://developers.circle.com/stablecoins/usdc-contract-addresses
  mainnet: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
  testnet: '0xa1ec7fc00a6f40db9693ad1415d0c193ad3906494428cf252621037bd7117e29::usdc::USDC',
};
export const GRAPHQL = {
  mainnet: 'https://graphql.mainnet.sui.io/graphql',
  testnet: 'https://graphql.testnet.sui.io/graphql',
};
export const CHAIN_ID = {
  mainnet: '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S',
  testnet: '69WiPg3DAQiwdxfncX6wYQ2siKwAe6L9BZthQea3JNMD',
};
export const DECIMALS = 6;
export const DIGEST_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
export const TOKEN_RE = /^smt_[A-Za-z0-9_-]{43}$/;
export const ORDER_RE = /^SM-[0-9A-HJKMNP-TV-Z]{10}$/;

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? ''));
const enc = new TextEncoder();

export function normalizeAddress(a) {
  return '0x' + String(a).trim().toLowerCase().replace(/^0x/, '').padStart(64, '0');
}
export function normalizeCoinType(t) {
  const [addr, ...rest] = String(t).trim().split('::');
  return [normalizeAddress(addr), ...rest].join('::');
}
export function decimalToAtomic(v, decimals = DECIMALS) {
  if (!/^\d+(\.\d+)?$/.test(String(v))) throw new Error('bad decimal');
  const [i, f = ''] = String(v).split('.');
  if (f.length > decimals) throw new Error('too many decimals');
  return BigInt(i) * 10n ** BigInt(decimals) + BigInt(f.padEnd(decimals, '0') || '0');
}
export function atomicToDecimal(a, decimals = DECIMALS) {
  const s = BigInt(a).toString().padStart(decimals + 1, '0');
  const f = s.slice(-decimals).replace(/0+$/, '');
  return f ? `${s.slice(0, -decimals)}.${f}` : s.slice(0, -decimals);
}

/** Returns { enabled:false, reason } unless the store is explicitly on and safely configured. */
export function loadConfig(env = {}) {
  if (!truthy(env.STORE_ENABLED)) return { enabled: false, reason: 'store_not_open' };
  const net = String(env.SUI_NETWORK ?? 'testnet').trim();
  if (net !== 'testnet' && net !== 'mainnet') return { enabled: false, reason: 'bad_network' };
  if (net === 'mainnet' && !truthy(env.STORE_ALLOW_MAINNET)) return { enabled: false, reason: 'mainnet_not_approved' };
  const payTo = String(env.STORE_PAYTO ?? '').trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(payTo) || /^0x0+$/.test(payTo)) return { enabled: false, reason: 'payto_not_set' };
  const secret = String(env.DOWNLOAD_HMAC_SECRET ?? '');
  if (secret.length < 32) return { enabled: false, reason: 'hmac_secret_not_set' };
  if (!env.STORE_KV) return { enabled: false, reason: 'kv_not_bound' };
  const int = (v, d, lo, hi) => { const n = v === undefined || v === '' ? d : Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : d; };
  return {
    enabled: true,
    net,
    payTo: normalizeAddress(payTo),
    asset: normalizeCoinType(SUI_USDC[net]),
    graphqlUrl: GRAPHQL[net],
    secret,
    kv: env.STORE_KV,
    // Unique tag added to the price. Default: 1..9999 atomic units (< 1 cent, like Plumbline).
    // "Unique cents" mode for wallets/exchanges that cannot send 6 decimals: UNIT=10000, RANGE=99.
    tagUnit: BigInt(int(env.STORE_AMOUNT_TAG_UNIT, 1, 1, 10000)),
    tagRange: int(env.STORE_AMOUNT_TAG_RANGE, 9999, 10, 9999),
    ttlSec: int(env.STORE_ORDER_TTL_SEC, 1800, 300, 7200), // pay within 30 min
    graceSec: int(env.STORE_REDEEM_GRACE_SEC, 900, 0, 3600), // extra time to submit the digest
    skewSec: int(env.STORE_CLOCK_SKEW_SEC, 60, 0, 300),
    linkTtlSec: int(env.STORE_LINK_TTL_SEC, 900, 60, 86400), // download link lifetime
    maxOrdersPerIpPerHour: int(env.STORE_MAX_ORDERS_PER_IP_HOUR, 6, 1, 100),
    webhookUrl: String(env.HWI_WEBHOOK_URL ?? '').trim() || null,
    webhookSecret: String(env.HWI_WEBHOOK_SECRET ?? '') || null,
  };
}

// ---------- crypto helpers (Web Crypto; works in Workers and Node >= 20) ----------
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));
export async function sha256Hex(s) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function hmac(secret, msg) {
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(msg))));
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
export function newToken() { return 'smt_' + b64url(randomBytes(32)); }
export function newOrderId() {
  const A = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
  return 'SM-' + [...randomBytes(10)].map((b) => A[b & 31]).join('');
}
function randomTag(range) {
  const r = new Uint32Array(1);
  const lim = Math.floor(0x100000000 / range) * range;
  do crypto.getRandomValues(r); while (r[0] >= lim);
  return (r[0] % range) + 1;
}

// ---------- signed download links ----------
export async function signLink(cfg, { orderId, sku, nowMs }) {
  const exp = Math.floor(nowMs / 1000) + cfg.linkTtlSec;
  const sig = await hmac(cfg.secret, `dl1|${cfg.net}|${orderId}|${sku}|${exp}`);
  return `/api/store/download?o=${encodeURIComponent(orderId)}&p=${encodeURIComponent(sku)}&e=${exp}&s=${sig}`;
}
export async function checkLink(cfg, { o, p, e, s, nowMs }) {
  if (!ORDER_RE.test(o ?? '') || !bySku(p) || !/^\d{9,11}$/.test(e ?? '')) return { ok: false, reason: 'bad_link' };
  if (Number(e) * 1000 < nowMs) return { ok: false, reason: 'link_expired' };
  const want = await hmac(cfg.secret, `dl1|${cfg.net}|${o}|${p}|${e}`);
  return safeEqual(want, s) ? { ok: true } : { ok: false, reason: 'bad_signature' };
}

// ---------- Sui GraphQL ----------
async function gql(url, query, variables, fetchImpl, timeoutMs = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }), signal: ctl.signal });
    if (!r.ok) throw new Error(`graphql_http_${r.status}`);
    const j = await r.json();
    if (j.errors?.length) throw new Error('graphql_error');
    return j.data;
  } finally { clearTimeout(t); }
}
export async function fetchChainId(cfg, fetchImpl = fetch) {
  return String((await gql(cfg.graphqlUrl, '{ chainIdentifier }', {}, fetchImpl))?.chainIdentifier ?? '');
}
export async function fetchTx(cfg, digest, fetchImpl = fetch) {
  const d = await gql(cfg.graphqlUrl,
    'query($d:String!){ transaction(digest:$d){ digest sender{address} effects{ status timestamp balanceChanges(first:50){ nodes{ owner{address} amount coinType{repr} } } } } }',
    { d: digest }, fetchImpl);
  const tx = d?.transaction;
  if (!tx?.effects) return null;
  return {
    digest: tx.digest,
    sender: tx.sender?.address,
    status: tx.effects.status,
    timestampMs: Date.parse(tx.effects.timestamp),
    balanceChanges: (tx.effects.balanceChanges?.nodes ?? []).map((n) => ({ owner: n.owner?.address, coinType: n.coinType?.repr, amount: n.amount })),
  };
}
/** Auto-detect: recent digests touching payTo (newest last). Candidates are fully re-verified. */
export async function recentDigests(cfg, fetchImpl = fetch, n = 25) {
  const d = await gql(cfg.graphqlUrl,
    'query($a:SuiAddress!,$n:Int){ transactions(last:$n, filter:{affectedAddress:$a}){ nodes{ digest } } }',
    { a: cfg.payTo, n }, fetchImpl);
  return (d?.transactions?.nodes ?? []).map((x) => x.digest).filter((x) => DIGEST_RE.test(x ?? ''));
}

/** Pure check of a fetched tx against an order. No I/O. Mirrors Plumbline's verify(). */
export function checkTx(cfg, order, tx, digest, nowMs) {
  if (!tx) return { ok: false, reason: 'transaction_not_found', retryable: true };
  if (tx.digest && tx.digest !== digest) return { ok: false, reason: 'digest_mismatch' };
  if (tx.status !== 'SUCCESS') return { ok: false, reason: 'transaction_failed' };
  if (!Number.isFinite(tx.timestampMs)) return { ok: false, reason: 'transaction_timestamp_missing' };
  const skew = cfg.skewSec * 1000;
  if (tx.timestampMs < order.createdMs - skew) return { ok: false, reason: 'payment_predates_order' };
  if (tx.timestampMs > order.expiresMs + skew) return { ok: false, reason: 'payment_after_order_expiry' };
  if (tx.timestampMs > nowMs + skew) return { ok: false, reason: 'payment_timestamp_in_future' };
  let credited = 0n;
  for (const bc of tx.balanceChanges ?? []) {
    if (!bc.owner || !bc.coinType || !/^-?\d{1,40}$/.test(String(bc.amount))) continue;
    if (normalizeAddress(bc.owner) === cfg.payTo && normalizeCoinType(bc.coinType) === cfg.asset) credited += BigInt(bc.amount);
  }
  if (credited <= 0n) return { ok: false, reason: 'no_usdc_payment_to_store' };
  if (credited !== BigInt(order.amountAtomic)) {
    return { ok: false, reason: `amount_mismatch (received ${atomicToDecimal(credited)} USDC, order needs exactly ${atomicToDecimal(order.amountAtomic)})` };
  }
  return { ok: true, sender: tx.sender ?? null };
}

// ---------- KV-backed order flow ----------
const K = {
  order: (id) => `ord:${id}`,
  amount: (net, a) => `amt:${net}:${a}`,
  digest: (net, d) => `dig:${net}:${d}`,
  ip: (h, hour) => `ip:${h}:${hour}`,
  outbox: (ms, id, kind) => `outbox:${String(ms).padStart(14, '0')}:${id}:${kind}`,
};
const getJSON = async (kv, k) => { const v = await kv.get(k); return v ? JSON.parse(v) : null; };

export async function createOrder(cfg, { sku, email, ipHash, nowMs = Date.now() }) {
  const p = bySku(sku);
  if (!p) return { ok: false, status: 400, reason: 'unknown_product' };
  if (email !== undefined && email !== null && email !== '' && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(String(email))) {
    return { ok: false, status: 400, reason: 'bad_email' };
  }
  if (ipHash) {
    const k = K.ip(ipHash, Math.floor(nowMs / 3_600_000));
    const n = Number((await cfg.kv.get(k)) ?? 0);
    if (n >= cfg.maxOrdersPerIpPerHour) return { ok: false, status: 429, reason: 'too_many_orders' };
    await cfg.kv.put(k, String(n + 1), { expirationTtl: 3700 });
  }
  const base = decimalToAtomic(p.priceUsdc);
  const holdSec = cfg.ttlSec + cfg.graceSec + 3600; // amount not reissued until well after the window
  let amount = null;
  for (let i = 0; i < 12 && amount === null; i++) {
    const a = base + BigInt(randomTag(cfg.tagRange)) * cfg.tagUnit;
    if (!(await cfg.kv.get(K.amount(cfg.net, a.toString())))) amount = a;
  }
  if (amount === null) return { ok: false, status: 503, reason: 'busy_try_again' };
  const id = newOrderId();
  const token = newToken();
  const order = {
    v: 1, id, sku: p.sku, net: cfg.net, amountAtomic: amount.toString(),
    tokenHash: await sha256Hex(token), createdMs: nowMs, expiresMs: nowMs + cfg.ttlSec * 1000,
    status: 'open', email: email || null, attempts: 0,
  };
  await cfg.kv.put(K.amount(cfg.net, amount.toString()), id, { expirationTtl: holdSec });
  await cfg.kv.put(K.order(id), JSON.stringify(order), { expirationTtl: 90 * 86400 });
  return {
    ok: true,
    order: {
      orderId: id, token, sku: p.sku, product: p.name, network: `sui:${cfg.net}`,
      payTo: cfg.payTo, coinType: cfg.asset, amount: atomicToDecimal(amount), amountAtomic: amount.toString(),
      expiresAt: new Date(order.expiresMs).toISOString(),
      howToPay: `Send EXACTLY ${atomicToDecimal(amount)} USDC on Sui ${cfg.net} to ${cfg.payTo} in one transaction before ${new Date(order.expiresMs).toISOString()}. Any other amount will not match. Keep your order token private.`,
    },
  };
}

async function authOrder(cfg, orderId, token) {
  if (!ORDER_RE.test(orderId ?? '') || !TOKEN_RE.test(token ?? '')) return { err: 'bad_order_or_token' };
  const o = await getJSON(cfg.kv, K.order(orderId));
  if (!o || o.net !== cfg.net) return { err: 'unknown_order' };
  if (!safeEqual(o.tokenHash, await sha256Hex(token))) return { err: 'unknown_order' }; // do not reveal existence
  return { o };
}

export async function verifyOrder(cfg, { orderId, token, digest, nowMs = Date.now(), fetchImpl = fetch }) {
  const { o, err } = await authOrder(cfg, orderId, token);
  if (err) return { ok: false, status: 404, reason: err };
  if (o.status === 'paid') return { ok: true, alreadyPaid: true, ...(await deliver(cfg, o, nowMs)) };
  if (nowMs > o.expiresMs + cfg.graceSec * 1000) return { ok: false, status: 410, reason: 'order_window_closed' };
  if (o.attempts >= 60) return { ok: false, status: 429, reason: 'too_many_attempts' };
  if (digest !== undefined && digest !== '' && !DIGEST_RE.test(digest)) return { ok: false, status: 400, reason: 'invalid_digest_format' };

  o.attempts++;
  await cfg.kv.put(K.order(o.id), JSON.stringify(o), { expirationTtl: 90 * 86400 });
  try {
    const chain = await fetchChainId(cfg, fetchImpl);
    if (chain !== CHAIN_ID[cfg.net]) return { ok: false, status: 502, reason: 'rpc_wrong_chain', retryable: true };
    const candidates = digest ? [digest] : (await recentDigests(cfg, fetchImpl)).reverse();
    let last = { ok: false, reason: 'payment_not_found_yet', retryable: true };
    for (const d of candidates) {
      if (await cfg.kv.get(K.digest(cfg.net, d))) { if (digest) last = { ok: false, reason: 'digest_already_used' }; continue; }
      const tx = await fetchTx(cfg, d, fetchImpl);
      const r = checkTx(cfg, o, tx, d, nowMs);
      if (!r.ok) { if (digest) last = r; continue; } // auto-detect: other people's txs are just skipped
      // Re-check after the awaits (KV is eventually consistent; see STORE-PLAN security review).
      if (await cfg.kv.get(K.digest(cfg.net, d))) return { ok: false, status: 409, reason: 'digest_already_used' };
      await cfg.kv.put(K.digest(cfg.net, d), o.id); // permanent replay guard
      Object.assign(o, { status: 'paid', digest: d, sender: r.sender, paidMs: nowMs });
      await cfg.kv.put(K.order(o.id), JSON.stringify(o), { expirationTtl: 400 * 86400 });
      await writeOutbox(cfg, o, nowMs);
      return { ok: true, ...(await deliver(cfg, o, nowMs)) };
    }
    return { ok: false, status: last.retryable ? 202 : 402, ...last };
  } catch (e) {
    return { ok: false, status: 503, reason: 'verification_unavailable', retryable: true };
  }
}

async function deliver(cfg, o, nowMs) {
  const p = bySku(o.sku);
  return {
    orderId: o.id, product: p?.name, digest: o.digest,
    downloadUrl: await signLink(cfg, { orderId: o.id, sku: o.sku, nowMs }),
    linkExpiresInSec: cfg.linkTtlSec,
  };
}

// ---------- Hwi Noree outbox (draft-only; nothing is ever sent from here) ----------
export function receiptDraft(cfg, o) {
  const p = bySku(o.sku);
  return {
    schema: 'spicemelange.store.outbox/v1',
    kind: 'receipt.draft',
    draftOnly: true,
    requiresApproval: 'sajan',
    createdAt: new Date(o.paidMs).toISOString(),
    order: { id: o.id, sku: o.sku, product: p?.name, amountUsdc: atomicToDecimal(o.amountAtomic), network: `sui:${o.net}`, digest: o.digest, payer: o.sender },
    customer: { email: o.email }, // null when the buyer gave none
    draft: o.email ? {
      to: o.email,
      from: 'hello@thespicemelange.org',
      subject: `Your receipt: ${p?.name} (${o.id})`,
      text: `PLACEHOLDER (Hwi drafts, Sajan approves). Thanks for your order ${o.id}. Paid ${atomicToDecimal(o.amountAtomic)} USDC on Sui ${o.net}, tx ${o.digest}. Your download link was shown at checkout; reply to this email if you need a fresh one. Educational material only; not financial advice.`,
    } : null,
    onboarding: { sequence: o.sku, step: 1, status: 'draft' },
  };
}
export async function writeOutbox(cfg, o, nowMs) {
  const doc = receiptDraft(cfg, o);
  await cfg.kv.put(K.outbox(nowMs, o.id, 'receipt'), JSON.stringify(doc), { expirationTtl: 60 * 86400 });
  if (cfg.webhookUrl && cfg.webhookSecret) {
    const body = JSON.stringify(doc);
    const ts = Math.floor(nowMs / 1000);
    const sig = await hmac(cfg.webhookSecret, `${ts}.${body}`);
    try {
      await fetch(cfg.webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json', 'x-store-timestamp': String(ts), 'x-store-signature': `v1=${sig}` }, body });
    } catch { /* best effort; the KV outbox is the source of truth */ }
  }
  return doc;
}

export async function orderStatus(cfg, { orderId, token, nowMs = Date.now() }) {
  const { o, err } = await authOrder(cfg, orderId, token);
  if (err) return { ok: false, status: 404, reason: err };
  const base = { ok: true, orderId: o.id, status: o.status, amount: atomicToDecimal(o.amountAtomic), expiresAt: new Date(o.expiresMs).toISOString() };
  return o.status === 'paid' ? { ...base, ...(await deliver(cfg, o, nowMs)) } : base;
}
