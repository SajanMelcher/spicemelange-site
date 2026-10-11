// "Sign in with wallet" (browser). Sui Wallet Standard: standard:connect + sui:signPersonalMessage over a server challenge.
// No gas, no transaction, never a seed phrase. The session token lives only in this page's memory (no storage, no cookie).
// Shared by /certificates/ (buying gate) and /certificates/holder/.
const wallets = [];
const reg = { register: (...ws) => { wallets.push(...ws); return () => {}; } };
if (typeof window !== 'undefined') {
  window.addEventListener('wallet-standard:register-wallet', (e) => { try { e.detail(reg); } catch {} });
  window.dispatchEvent(new CustomEvent('wallet-standard:app-ready', { detail: reg }));
}
export const state = { session: null, account: null, wallet: null, address: null };
export function api(action, body = {}) {
  return fetch('/api/certificates/' + action, { method: 'POST', headers: { 'content-type': 'application/json', ...(state.session ? { authorization: 'Bearer ' + state.session } : {}) }, body: JSON.stringify(body) })
    .then((r) => r.json()).catch(() => ({ ok: false, reason: 'network_error' }));
}
export const suiWallets = () => wallets.filter((w) => w.features?.['sui:signPersonalMessage'] && w.features?.['standard:connect']);
export async function signMessage(message) {
  return (await state.wallet.features['sui:signPersonalMessage'].signPersonalMessage({ message: new TextEncoder().encode(message), account: state.account })).signature;
}
export const REASONS = {
  not_configured: 'Wallet sign-in is not switched on here yet.', nonce_expired: 'The sign-in message expired (2 minutes). Try again.',
  nonce_already_used: 'That signature was already used. Try again for a fresh message.', wrong_domain: 'The message was for another site.',
  message_mismatch: 'The signed message was changed.', signer_is_not_the_named_wallet: 'A different wallet signed the message.', network_error: 'Network error.',
};
/** Connect, fetch a challenge for this wallet, sign it, exchange it for a session. `say` gets progress text. */
export async function signIn(say = () => {}) {
  const ws = suiWallets();
  state.wallet = ws[0];
  if (!state.wallet) { say('No Sui wallet found in this browser. Install or unlock a Sui wallet (Wallet Standard), then reload.'); return null; }
  const { accounts } = await state.wallet.features['standard:connect'].connect();
  state.account = accounts.find((a) => a.chains?.some((c) => c.startsWith('sui:'))) ?? accounts[0];
  if (!state.account) { say('The wallet shared no account.'); return null; }
  const ch = await api('challenge', { address: state.account.address });
  if (!ch.ok) { say('Sign-in unavailable: ' + (REASONS[ch.reason] ?? ch.reason)); return null; }
  say(`Sign the message in ${state.wallet.name}. It is a message, not a transaction: no gas, nothing moves.`);
  const r = await api('signin', { message: ch.message, signature: await signMessage(ch.message) });
  if (!r.ok) { say('Sign-in refused: ' + (REASONS[r.reason] ?? r.reason)); return null; }
  state.session = r.session; state.address = r.address;
  return r;
}
export const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
