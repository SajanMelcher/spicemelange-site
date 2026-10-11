-- Spice Certificates sign-in / withdrawal challenges are SINGLE-USE (Siona SC13). A nonce row is inserted only after the
-- signature verifies; the PRIMARY KEY makes a replay fail atomically on any PoP. Rows are deleted ~1 minute after expiry.
CREATE TABLE IF NOT EXISTS spice_nonces (
  nonce   TEXT PRIMARY KEY,
  kind    TEXT NOT NULL,      -- 'signin' | 'withdraw'
  exp_ms  INTEGER NOT NULL,
  used_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS spice_nonces_exp ON spice_nonces (exp_ms);
-- One pending withdrawal request per certificate serial (testnet preview queue; nothing is paid by the site).
CREATE TABLE IF NOT EXISTS spice_withdraw_pending (
  serial     INTEGER PRIMARY KEY,
  request_id TEXT NOT NULL,
  created_ms INTEGER NOT NULL
);
