-- Spice Certificate holder records (prod + preview), read by /api/certificates/* (store-core/spice-holder-store.js).
-- Rows mirror Hwi's ledger/master.json spice_certificates block (source 'ledger', no PII) and, until Hwi's next accrual run,
-- a minimal row per new mint written box-side from the watcher log (source 'watcher': principal 100.00, accrued 0, active).
CREATE TABLE IF NOT EXISTS spice_holder_rows (
  network                TEXT    NOT NULL,           -- 'mainnet' | 'testnet'
  serial                 INTEGER NOT NULL,
  holder_ref             TEXT,                       -- opaque key into spice_holders_private (ledger rows only)
  owner_address          TEXT,                       -- holder Sui address at mint (watcher rows); ownership is re-read on-chain
  principal_usd          TEXT    NOT NULL,
  accrued_sats           INTEGER NOT NULL DEFAULT 0,
  value_usd              TEXT    NOT NULL DEFAULT '0.00',
  status                 TEXT    NOT NULL,
  withdrawal_status      TEXT    NOT NULL DEFAULT 'none',
  withdrawal_request_id  TEXT,
  token_hash             TEXT,                       -- sha256 of the personal-link token (never the token)
  last_reserve_credit_pt TEXT,
  next_reserve_credit_pt TEXT,
  source                 TEXT    NOT NULL,           -- 'ledger' | 'watcher'
  updated_ms             INTEGER NOT NULL,
  PRIMARY KEY (network, serial)
);
-- One row per network: the master block header (schema_version, as_of, btc_price_usd, price_source, ...) as JSON.
CREATE TABLE IF NOT EXISTS spice_holder_meta (network TEXT PRIMARY KEY, header TEXT NOT NULL, updated_ms INTEGER NOT NULL);
-- holders.private.json (PRIVATE): display names, served only behind a wallet signature or a personal link.
CREATE TABLE IF NOT EXISTS spice_holders_private (holder_ref TEXT PRIMARY KEY, display_name TEXT NOT NULL, wallet TEXT);
-- Signed withdrawal requests (private; Sajan approves each payout by hand).
CREATE TABLE IF NOT EXISTS spice_withdraw_requests (request_id TEXT PRIMARY KEY, network TEXT NOT NULL, serial INTEGER NOT NULL, record TEXT NOT NULL, created_ms INTEGER NOT NULL);
