// Wallet-side AdminCap tool (Siona V3-7 / V4-4 / V4-5). Builds an UNSIGNED AdminCap transaction for the wallet that holds the
// Spice Certificate AdminCap, dry-runs it, and hands it to that wallet to sign. The server never signs or holds a key.
// V4-4: the client NEVER chooses the package. Only Issuers pinned in spice-cert-admin-issuers.json are served; the package
// is the Issuer object's on-chain type origin and must equal the pinned package. Any client-supplied packageId is refused.
import { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { normAddr } from './spice-holder.js';
import PINNED from './spice-cert-admin-issuers.json' with { type: 'json' };

export const NETS = { mainnet: 'https://fullnode.mainnet.sui.io:443', testnet: 'https://fullnode.testnet.sui.io:443' };
export const ACTIONS = ['status', 'pause', 'unpause', 'revoke_mint_cap', 'create_mint_cap', 'burn_redeemed', 'reject_redemption',
  'set_template_allowed', 'display_edit'];
export const DISPLAY_FIELDS = ['name', 'description', 'image_url', 'link', 'project_url'];
const client = (network) => new SuiGrpcClient({ network, baseUrl: NETS[network] });
const big = (_, v) => (typeof v === 'bigint' ? v.toString() : v);
const str = (v, max = 300) => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

export function unsetGas(txJson) {
  const t = JSON.parse(txJson); t.gasData = { budget: null, price: null, owner: null, payment: null };
  return JSON.stringify(t, null, 2);
}
export function pinnedIssuer(network, issuerId, pinned = PINNED) {
  const id = normAddr(issuerId);
  return (pinned[network] || []).find((p) => normAddr(p.issuerId) === id) || null;
}

export async function adminTx(req, c, pinned = PINNED) {
  const { network, issuerId, sender, action } = req;
  if ('packageId' in req || 'package' in req) return { ok: false, reason: 'package_not_accepted' }; // V4-4
  if (!NETS[network]) return { ok: false, reason: 'bad_network' };
  if (!ACTIONS.includes(action)) return { ok: false, reason: 'bad_action' };
  const pin = pinnedIssuer(network, issuerId, pinned);
  if (!pin) return { ok: false, reason: 'issuer_not_pinned' };
  const iss = normAddr(pin.issuerId), who = normAddr(sender);
  if (!who) return { ok: false, reason: 'bad_sender' };
  c = c ?? client(network);
  let issuer, pkg, cap, pending = [], display = null;
  try {
    const o = await c.core.getObject({ objectId: iss, include: { json: true } });
    const obj = o.object ?? o; issuer = obj.json ?? obj.content?.json;
    const m = /^(0x[0-9a-fA-F]+)::certificate::Issuer$/.exec(String(obj.type || ''));
    if (!m) return { ok: false, reason: 'not_an_issuer' };
    pkg = normAddr(m[1]);
    if (pkg !== normAddr(pin.packageId)) return { ok: false, reason: 'issuer_package_mismatch' };
    const caps = await c.core.listOwnedObjects({ owner: who, type: `${pkg}::certificate::AdminCap`, limit: 5 });
    cap = (caps.objects || [])[0];
    const esc = await c.core.listOwnedObjects({ owner: iss, type: `${pkg}::certificate::SpiceCertificate`, limit: 50, include: { json: true } });
    pending = (esc.objects || []).map((x) => ({ id: x.objectId ?? x.id, serial: (x.json ?? x.content?.json)?.serial, holder: (x.json ?? x.content?.json)?.holder }));
    const ds = await c.core.listOwnedObjects({ owner: who, type: `0x2::display::Display<${pkg}::certificate::SpiceCertificate>`, limit: 2 });
    display = (ds.objects || [])[0]?.objectId ?? null;
  } catch (e) { return { ok: false, reason: 'read_failed', detail: String(e.message || e).slice(0, 160) }; }
  const status = { package: pkg, issuer: iss, paused: !!issuer?.paused, payee: issuer?.payee, price: issuer?.price,
    mint_caps: issuer?.mint_caps?.contents ?? [], allowed_templates: issuer?.allowed_templates?.contents ?? [],
    admin_cap: cap ? (cap.objectId ?? cap.id) : null, display, pending_redemptions: pending };
  if (action === 'status') return { ok: true, status };
  if (!cap) return { ok: false, reason: 'wallet_has_no_admincap', status };
  const tx = new Transaction(); tx.setSender(who);
  const A = () => tx.object(cap.objectId ?? cap.id), I = () => tx.object(iss);
  const fn = (f) => `${pkg}::certificate::${f}`;
  let target;
  const bad = (reason) => ({ ok: false, reason, status });
  switch (action) {
    case 'pause': case 'unpause':
      target = fn('set_paused'); tx.moveCall({ target, arguments: [A(), I(), tx.pure.bool(action === 'pause')] }); break;
    case 'revoke_mint_cap': {
      const id = normAddr(req.mintCapId); if (!id || !status.mint_caps.map(normAddr).includes(id)) return bad('unknown_mint_cap');
      target = fn('revoke_mint_cap'); tx.moveCall({ target, arguments: [A(), I(), tx.pure.id(id)] }); break; }
    case 'create_mint_cap': {
      const to = normAddr(req.recipient), lim = Number(req.dailyLimit);
      if (!to || !Number.isInteger(lim) || lim < 1 || lim > 1000) return bad('bad_mint_cap_args');
      if (to === who) return bad('mint_cap_to_admin_wallet'); // keep the watcher key separate
      target = fn('create_mint_cap'); tx.moveCall({ target, arguments: [A(), I(), tx.pure.address(to), tx.pure.u64(lim)] }); break; }
    case 'burn_redeemed': case 'reject_redemption': {
      const cert = normAddr(req.certId); if (!cert || !pending.some((p) => normAddr(p.id) === cert)) return bad('not_a_pending_redemption');
      if (action === 'burn_redeemed') {
        const amt = /^\d{1,19}$/.test(String(req.payoutAmount ?? '')) ? BigInt(req.payoutAmount) : null, ptx = str(req.payoutTx, 200);
        if (amt === null || amt <= 0n || !ptx) return bad('bad_payout_args');
        target = fn('burn_redeemed'); tx.moveCall({ target, arguments: [A(), I(), tx.object(cert), tx.pure.u64(amt), tx.pure.string(ptx), tx.object.clock()] });
      } else {
        const reason = str(req.reason, 200); if (!reason) return bad('bad_reason');
        target = fn('reject_redemption'); tx.moveCall({ target, arguments: [A(), I(), tx.object(cert), tx.pure.string(reason)] });
      }
      break; }
    case 'set_template_allowed': {
      const t = str(req.templateId, 64); if (!t || !/^[a-z0-9-]+$/.test(t)) return bad('bad_template');
      target = fn('set_template_allowed'); tx.moveCall({ target, arguments: [A(), I(), tx.pure.string(t), tx.pure.bool(!!req.allowed)] }); break; }
    case 'display_edit': {
      if (!display) return bad('wallet_has_no_display');
      const f = req.field, v = str(req.value, 1000);
      if (!DISPLAY_FIELDS.includes(f) || !v) return bad('bad_display_args');
      if (['image_url', 'link', 'project_url'].includes(f) && !/^https:\/\/[^\s]+$/.test(v)) return bad('display_url_must_be_https');
      const T = `${pkg}::certificate::SpiceCertificate`;
      target = '0x2::display::edit + update_version';
      tx.moveCall({ target: '0x2::display::edit', typeArguments: [T], arguments: [tx.object(display), tx.pure.string(f), tx.pure.string(v)] });
      tx.moveCall({ target: '0x2::display::update_version', typeArguments: [T], arguments: [tx.object(display)] });
      break; }
  }
  let dry;
  try {
    const r = await c.core.simulateTransaction({ transaction: tx, include: { effects: true } });
    dry = r.$kind === 'Transaction' ? { status: 'success' } : { status: 'failure', error: r.FailedTransaction?.status?.error?.message?.slice(0, 200) };
  } catch (e) { dry = { status: 'error', error: String(e.message || e).slice(0, 200) }; }
  let tx_json = dry.status === 'success' ? await tx.toJSON({ client: c }) : null;
  // Siona S-1: the wallet sets gas. Never hand over a budget, price, owner or payment for set_paused (the page rejects any).
  if (tx_json && (action === 'pause' || action === 'unpause')) tx_json = unsetGas(tx_json);
  return JSON.parse(JSON.stringify({ ok: true, ready: !!tx_json, action, network, target, status, dry_run: dry, tx_json }, big));
}
