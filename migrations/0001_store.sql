-- P30 store: strongly consistent order state in D1. UNIQUE/PRIMARY KEY constraints close the
-- amount-reservation and digest-reuse races that KV (eventually consistent) could not.
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  sku TEXT NOT NULL,
  net TEXT NOT NULL,
  amount_atomic TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid')),
  email TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  digest TEXT UNIQUE,
  sender TEXT,
  paid_ms INTEGER
);
-- One live hold per (network, exact amount). Expired holds may be taken over atomically.
CREATE TABLE IF NOT EXISTS amount_holds (
  net TEXT NOT NULL,
  amount_atomic TEXT NOT NULL,
  order_id TEXT NOT NULL,
  hold_until_ms INTEGER NOT NULL,
  PRIMARY KEY (net, amount_atomic)
);
-- A digest can pay for at most one order, ever.
CREATE TABLE IF NOT EXISTS redemptions (
  net TEXT NOT NULL,
  digest TEXT NOT NULL,
  order_id TEXT NOT NULL UNIQUE,
  redeemed_ms INTEGER NOT NULL,
  PRIMARY KEY (net, digest)
);
