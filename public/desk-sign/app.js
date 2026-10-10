// Desk signing page. Plain JS, no network: the CSP has connect-src 'none', and nothing here calls fetch/XHR/beacon.
// Key: Ed25519, created on this device. WebCrypto (non-extractable CryptoKey in IndexedDB) when the browser has Ed25519;
// otherwise the vendored @noble/ed25519 with the 32-byte seed kept AES-GCM-encrypted under a non-extractable WebCrypto key in IndexedDB.
// Signature token: desksig1.<id>.<keyid8>.<base64url(Ed25519(PREFIX + payload bytes))>, checked on the desk by desk_sigverify.py.
const te = new TextEncoder(), td = new TextDecoder('utf-8', { fatal: true });
const PREFIX = te.encode('IXIANS-DESK-SIG-V1\n');
const PURPOSE = 'ixians.desk.guard-approval';
const DB = 'desk-sign', ST = 'keys', KID = 'approver';
const BACKUP_AAD = te.encode('ixians-desk-sign-backup-v1');
const PBKDF2_ITER = 600000;
// PKCS#8 wrapper for a raw Ed25519 seed (RFC 8410): SEQUENCE { INTEGER 0, SEQUENCE { OID 1.3.101.112 }, OCTET STRING { OCTET STRING seed } }
const PKCS8_HEAD = new Uint8Array([48, 46, 2, 1, 0, 48, 5, 6, 3, 43, 101, 112, 4, 34, 4, 32]);
const $ = (id) => document.getElementById(id);
const subtle = globalThis.crypto && crypto.subtle;

// ---------- encoding
const b64 = (u8) => { let s = ''; for (const b of u8) s += String.fromCharCode(b); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const b64u = (u8) => b64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => { if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error('bad base64url'); s = s.replace(/-/g, '+').replace(/_/g, '/'); return unb64(s + '==='.slice((s.length + 3) % 4)); };
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const u32 = (n) => new Uint8Array([n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const sshStr = (u8) => cat(u32(u8.length), u8);
const sshBlob = (pub) => cat(sshStr(te.encode('ssh-ed25519')), sshStr(pub));
async function fingerprint(pub) { return 'SHA256:' + b64(new Uint8Array(await subtle.digest('SHA-256', sshBlob(pub)))).replace(/=+$/, ''); }
const sshLine = (pub) => 'ssh-ed25519 ' + b64(sshBlob(pub)) + ' desk-sign-phone';

// ---------- IndexedDB
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(ST);
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function dbOp(mode, fn) {
  const db = await idb();
  try {
    return await new Promise((res, rej) => {
      const tx = db.transaction(ST, mode); const r = fn(tx.objectStore(ST));
      tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
  } finally { db.close(); }
}
const getRec = () => dbOp('readonly', (s) => s.get(KID));
const putRec = (v) => dbOp('readwrite', (s) => s.put(v, KID));

// ---------- crypto backends
let wcOk = null;
async function webcryptoEd25519() {
  if (wcOk !== null) return wcOk;
  try {
    const k = await subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify']);
    const m = te.encode('probe'); const s = await subtle.sign({ name: 'Ed25519' }, k.privateKey, m);
    wcOk = await subtle.verify({ name: 'Ed25519' }, k.publicKey, s, m);
  } catch { wcOk = false; }
  return wcOk;
}
let nobleMod = null;
const noble = async () => (nobleMod ||= await import('./noble-ed25519.js'));

async function newSeed() {
  if (await webcryptoEd25519()) {
    try {
      const kp = await subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
      const p8 = new Uint8Array(await subtle.exportKey('pkcs8', kp.privateKey));
      if (p8.length === 48 && p8.slice(0, 16).every((b, i) => b === PKCS8_HEAD[i])) return p8.slice(16);
    } catch { /* fall through to random seed */ }
  }
  return crypto.getRandomValues(new Uint8Array(32));
}
// Store a seed as the device key. Returns the public key. The seed itself is never written in the clear.
async function storeSeed(seed) {
  if (await webcryptoEd25519()) {
    try {
      const p8 = cat(PKCS8_HEAD, seed);
      const tmp = await subtle.importKey('pkcs8', p8, { name: 'Ed25519' }, true, ['sign']);
      const pub = unb64u((await subtle.exportKey('jwk', tmp)).x);
      const priv = await subtle.importKey('pkcs8', p8, { name: 'Ed25519' }, false, ['sign']);  // NON-extractable
      p8.fill(0);
      await putRec({ kind: 'webcrypto', priv, pub, created: new Date().toISOString() });
      return pub;
    } catch (e) { console.warn('WebCrypto Ed25519 import failed, using the vendored library', e); }
  }
  const ed = await noble();
  const pub = await ed.getPublicKeyAsync(seed);
  const wrap = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);  // non-extractable
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, wrap, seed));
  await putRec({ kind: 'noble', wrap, iv, ct, pub, created: new Date().toISOString() });
  return pub;
}
async function signBytes(rec, data) {
  if (rec.kind === 'webcrypto') return new Uint8Array(await subtle.sign({ name: 'Ed25519' }, rec.priv, data));
  const ed = await noble();
  const seed = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: rec.iv }, rec.wrap, rec.ct));
  try { return await ed.signAsync(data, seed); } finally { seed.fill(0); }
}
async function verifyBytes(pub, sig, data) {
  if (await webcryptoEd25519()) {
    try { return await subtle.verify({ name: 'Ed25519' }, await subtle.importKey('raw', pub, { name: 'Ed25519' }, false, ['verify']), sig, data); } catch { /* noble */ }
  }
  return (await noble()).verifyAsync(sig, data, pub);
}

// ---------- backup (PBKDF2-SHA256 600k -> AES-256-GCM over the 32-byte seed)
async function passKey(pass, salt) {
  const base = await subtle.importKey('raw', te.encode(pass.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function makeBackup(seed, pub, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: BACKUP_AAD }, await passKey(pass, salt), seed));
  return JSON.stringify({ kind: 'desk-sign-backup', v: 1, kdf: 'PBKDF2-SHA256', iter: PBKDF2_ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct), pub: b64(pub), fp: await fingerprint(pub) });
}
async function openBackup(text, pass) {
  const j = JSON.parse(text);
  if (j.kind !== 'desk-sign-backup' || j.v !== 1 || j.kdf !== 'PBKDF2-SHA256' || !(j.iter >= 100000 && j.iter <= 10000000)) throw new Error('not a desk-sign backup');
  const key = await (async () => { const base = await subtle.importKey('raw', te.encode(pass.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(j.salt), iterations: j.iter }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']); })();
  let seed;
  try { seed = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: unb64(j.iv), additionalData: BACKUP_AAD }, key, unb64(j.ct))); }
  catch { throw new Error('wrong passphrase or damaged backup'); }
  if (seed.length !== 32) throw new Error('damaged backup');
  return { seed, pub: unb64(j.pub) };
}

// ---------- payload (v2, staged by desk_approve.py) and plain-English summary
const HEX64 = /^[0-9a-f]{64}$/;
function parsePayload(bytes) {
  const p = JSON.parse(td.decode(bytes));
  const bad = (m) => { throw new Error('This link is not a valid desk approval: ' + m); };
  if (!p || p.v !== 2) bad('version');
  if (p.purpose !== PURPOSE) bad('purpose');
  if (typeof p.desk !== 'string' || !p.desk) bad('desk');
  if (typeof p.id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(p.id)) bad('id');
  if (!Number.isInteger(p.seq) || p.seq < 1) bad('sequence number');
  if (typeof p.nonce !== 'string' || !/^[0-9a-fA-F]{16,64}$/.test(p.nonce)) bad('nonce');
  if (!p.files || typeof p.files !== 'object' || !Object.keys(p.files).length) bad('files');
  for (const [n, f] of Object.entries(p.files)) {
    if (!f || !HEX64.test(f.sha256) || !(f.prev_sha256 === null || HEX64.test(f.prev_sha256)) || Object.keys(f).length !== 2) bad('file entry ' + n);
  }
  if (!Array.isArray(p.changes) || p.changes.some((c) => !c || typeof c.key !== 'string' || !(c.file in p.files) || !('old' in c) || !('new' in c))) bad('changes');
  const ia = Date.parse(p.issued_at), ea = Date.parse(p.expires_at);
  if (!(ia < ea && ea - ia <= 24 * 3600e3)) bad('time window');
  return p;
}
// Which direction loosens a limit: a table keyed by the first 24 hex of SHA-256(lowercased setting name), so this public page carries no
// desk setting names (generated off-site). 'up' = higher loosens, 'down' = lower loosens, 'list' = adding items loosens.
// Per-pool settings ("name.POOL") are matched on the parent name. Anything not in the table is flagged "unknown setting" (amber).
const DIR = {"ca1dfd8dca25f83df42e2d71":"up","2b2fdd0897968f8141b5b7a9":"up","ab92f3d518a594b55b82981e":"list","bd842225587a004f3924ea89":"down","d75baa139a892cb72f6841be":"down","bb4e107fe9d709fc079648a6":"down","7aa5e133594f796c1ea5f022":"up","ff04b09a2804e6f2a1fffefa":"up","1d69f01599214255768896a3":"up","0a23f2f832941429dccbe601":"up","fd1794cb56b74fe72c0e8ef6":"down","a1c142b71f9b122f82c4d5d8":"down","c161030946a5fd60c8d8310f":"down","59dfb73d0a6fd24215450281":"down","46734d94cd0584b2ab0919d1":"up","42598e417412df9433fd937c":"up","1565fd467798286c000ec219":"down","cfee39eb5d8d416e419cae64":"down"};
const TEXTKEY = /(^|_)(comment|approved|source|scope|note)/i;
const show = (v) => (v === null || v === undefined ? '(none)' : JSON.stringify(v));
const human = (s) => s.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toLowerCase();
async function h24(s) { return [...new Uint8Array(await subtle.digest('SHA-256', te.encode(s.toLowerCase())))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24); }
async function judge(c) {
  const parts = c.key.split('.'), last = parts[parts.length - 1], parent = parts[parts.length - 2];
  let dir = DIR[await h24(last)], name = human(last);
  if (!dir && parent && DIR[await h24(parent)] && DIR[await h24(parent)] !== 'list') { dir = DIR[await h24(parent)]; name = `${human(parent)} (${last})`; }
  if (!dir && TEXTKEY.test(last)) return { name, kind: 'text', why: 'text only' };
  if (!dir) return { name: human(c.key), kind: 'unknown', why: 'unknown setting' };
  if (dir === 'list') {
    if (!Array.isArray(c.new) || (c.old !== null && !Array.isArray(c.old))) return { name, kind: 'unknown', why: 'unusual value' };
    const added = c.new.filter((x) => !(c.old || []).includes(x));
    return added.length ? { name, kind: 'looser', why: 'adds ' + added.join(', ') } : { name, kind: 'tighter', why: 'removes only' };
  }
  if (c.new === null || c.new === undefined) return { name, kind: 'looser', why: 'limit removed' };
  if (c.old === null || c.old === undefined) return { name, kind: 'unknown', why: 'new limit' };
  if (typeof c.old !== 'number' || typeof c.new !== 'number') return { name, kind: 'unknown', why: 'not a number' };
  const looser = dir === 'up' ? c.new > c.old : c.new < c.old;
  return { name, kind: looser ? 'looser' : 'tighter', why: looser ? 'LOOSER' : 'tighter' };
}
async function summarize(p) {
  const items = [], looser = [], amber = [];
  for (const [file, f] of Object.entries(p.files)) {
    const mine = p.changes.filter((c) => c.file === file);
    if (f.prev_sha256 === null) { items.push({ text: `${file}: approve it exactly as it is now (first approval)`, kind: 'text' }); continue; }
    if (!file.endsWith('.json')) {
      items.push({ text: `${file}: program change. Approves exact bytes ${f.sha256.slice(0, 12)}…; ask for the diff if you haven't seen it.`, kind: 'code' });
      amber.push(`${file} is a program change (the summary can't show it)`); continue;
    }
    if (!mine.length) { items.push({ text: `${file}: no setting changes (formatting only)`, kind: 'text' }); continue; }
    for (const c of mine) {
      const j = await judge(c);
      items.push({ text: `${file}: ${j.name}: ${show(c.old)} → ${show(c.new)}`, kind: j.kind, why: j.why });
      if (j.kind === 'looser') looser.push(`${j.name} ${show(c.old)} → ${show(c.new)}`);
      if (j.kind === 'unknown') amber.push(`${j.name} (${j.why})`);
    }
  }
  return { items, looser, amber };
}

// ---------- UI
const ui = { rec: null, payload: null, payloadBytes: null, pendingSeed: null };
function err(m) { const e = $('err'); e.textContent = m; e.hidden = !m; }
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); }
  catch { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); document.execCommand('copy'); t.remove(); }
  const o = btn.textContent; btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = o), 1500);
}
async function renderKey() {
  ui.rec = await getRec().catch(() => null);
  const have = !!(ui.rec && ui.rec.pub);
  $('su-none').hidden = have; $('su-have').hidden = !have; $('restore').hidden = have;
  if (have) {
    const fp = await fingerprint(ui.rec.pub);
    $('keystate').textContent = `Key on this phone: ${fp}` + (ui.rec.kind === 'noble' ? ' (compatibility mode)' : '');
    $('su-pub').value = sshLine(ui.rec.pub); $('su-fp').textContent = fp;
  } else {
    $('keystate').textContent = 'No key on this phone yet.';
  }
  return have;
}
async function renderApprove() {
  const p = ui.payload, s = await summarize(p);
  $('ap-title').textContent = `Approve change #${p.seq}`;
  $('ap-note').textContent = p.note ? `“${p.note}”` : '(no note)';
  const left = Date.parse(p.expires_at) - Date.now();
  const when = new Date(Date.parse(p.expires_at)).toLocaleString();
  $('ap-expiry').textContent = left > 0 ? `Expires ${when} (in ${Math.max(1, Math.round(left / 60000))} min). Desk: ${p.desk}.` : `EXPIRED at ${when}. Ask for a new link.`;
  const list = $('ap-list'); list.replaceChildren();
  for (const it of s.items) {
    const li = document.createElement('li'); li.append(document.createTextNode(it.text));
    if (it.kind !== 'text' || it.why) { const t = document.createElement('span'); t.className = 'tag ' + it.kind; t.textContent = it.why || it.kind; li.append(t); }
    list.append(li);
  }
  $('ap-red').hidden = !s.looser.length;
  $('ap-red').textContent = s.looser.length ? `This LOOSENS ${s.looser.length} limit${s.looser.length > 1 ? 's' : ''}: ${s.looser.join('; ')}.` : '';
  $('ap-amber').hidden = !s.amber.length;
  $('ap-amber').textContent = s.amber.length ? `Check before approving: ${s.amber.join('; ')}.` : '';
  $('ap-confirm-wrap').hidden = !s.looser.length; $('ap-confirm').checked = false;
  const tech = { id: p.id, seq: p.seq, nonce: p.nonce, issued_at: p.issued_at, expires_at: p.expires_at, files: p.files };
  $('ap-tech').textContent = JSON.stringify(tech, null, 1);
  const ok = () => left > 0 && !!ui.rec && (!s.looser.length || $('ap-confirm').checked);
  $('ap-yes').disabled = !ok();
  $('ap-confirm').onchange = () => { $('ap-yes').disabled = !ok(); };
  if (!ui.rec) err('There is no key on this phone yet. Create one below first (or restore your backup).');
}
async function onApprove() {
  $('ap-yes').disabled = true; $('ap-no').disabled = true;
  try {
    const p = ui.payload, msg = cat(PREFIX, ui.payloadBytes);
    const sig = await signBytes(ui.rec, msg);
    if (!(await verifyBytes(ui.rec.pub, sig, msg))) throw new Error('self-check of the signature failed; nothing to send');
    const keyid = (await fingerprint(ui.rec.pub)).slice(7, 15);
    const token = `desksig1.${p.id}.${keyid}.${b64u(sig)}`;
    $('ap-sig').value = token; $('ap-done').hidden = false;
    $('ap-copy').onclick = () => copy(token, $('ap-copy'));
    if (navigator.share) { $('ap-share').hidden = false; $('ap-share').onclick = () => navigator.share({ text: token }).catch(() => {}); }
  } catch (e) { err('Signing failed: ' + e.message); $('ap-yes').disabled = false; $('ap-no').disabled = false; }
}
function onDecline() {
  $('ap-yes').disabled = true; $('ap-no').disabled = true; $('ap-declined').hidden = false;
  history.replaceState(null, '', location.pathname);
}
async function onCreate() {
  $('su-create').disabled = true; err('');
  try {
    if (await getRec()) throw new Error('a key already exists on this phone');
    const seed = await newSeed();
    const pub = await storeSeed(seed);
    ui.pendingSeed = { seed, pub };
    navigator.storage && navigator.storage.persist && navigator.storage.persist().catch(() => {});
    await renderKey(); $('su-backup').hidden = false;
    if (ui.payload) await renderApprove();
  } catch (e) { err('Could not create the key: ' + e.message); $('su-create').disabled = false; }
}
function dropSeed() { if (ui.pendingSeed) ui.pendingSeed.seed.fill(0); ui.pendingSeed = null; $('su-backup').hidden = true; }
async function onBackup() {
  const a = $('bk-pass').value, b = $('bk-pass2').value;
  if (a.length < 10) return err('Passphrase: at least 10 characters.');
  if (a !== b) return err('The two passphrases differ.');
  err(''); $('bk-make').disabled = true;
  try {
    const text = await makeBackup(ui.pendingSeed.seed, ui.pendingSeed.pub, a);
    $('bk-text').value = text; $('bk-out').hidden = false;
    $('bk-copy').onclick = () => copy(text, $('bk-copy'));
    $('bk-dl').href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    $('bk-pass').value = $('bk-pass2').value = '';
    ui.pendingSeed.seed.fill(0); ui.pendingSeed = null; $('bk-skip').textContent = 'Done';
  } catch (e) { err('Backup failed: ' + e.message); $('bk-make').disabled = false; }
}
async function onRestore() {
  err(''); $('rs-go').disabled = true;
  try {
    if (await getRec()) throw new Error('a key already exists on this phone');
    const { seed, pub } = await openBackup($('rs-text').value.trim(), $('rs-pass').value);
    const got = await storeSeed(seed); seed.fill(0);
    if (b64(got) !== b64(pub)) throw new Error('backup is damaged (public key mismatch)');
    $('rs-pass').value = ''; $('rs-text').value = '';
    await renderKey(); if (ui.payload) await renderApprove();
  } catch (e) { err('Restore failed: ' + e.message); $('rs-go').disabled = false; }
}
async function main() {
  if (!subtle || !window.indexedDB) { err('This browser has no WebCrypto or IndexedDB (private browsing?). Use Safari or Chrome normally.'); return; }
  $('su-create').onclick = onCreate; $('su-copy').onclick = () => copy($('su-pub').value, $('su-copy'));
  $('bk-make').onclick = onBackup; $('bk-skip').onclick = dropSeed; $('rs-go').onclick = onRestore;
  $('ap-yes').onclick = onApprove; $('ap-no').onclick = onDecline;
  await renderKey();
  const m = location.hash.match(/^#payload=([A-Za-z0-9_-]+)$/);
  if (m) {
    try { ui.payloadBytes = unb64u(m[1]); ui.payload = parsePayload(ui.payloadBytes); $('approve').hidden = false; await renderApprove(); }
    catch (e) { err(e.message.startsWith('This link') ? e.message : 'This link is damaged (copy the whole link).'); }
  }
  $('setup').hidden = !!ui.payload && !!ui.rec;
  document.body.dataset.ready = '1';
}
window.addEventListener('hashchange', () => location.reload());  // a new approve link opened while the page is already open
main().catch((e) => err('Error: ' + e.message));
