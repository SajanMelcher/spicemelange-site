-- DRAFT (signal-feed-draft branch, not applied anywhere): desk signal feed. Ideas are text + JSON only; nothing executes.
CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,                    -- sig_<random>
  net TEXT NOT NULL,
  order_id TEXT NOT NULL,                 -- PRIVATE: the paid order that posted (for bounty/credit payout later); never returned
  author TEXT NOT NULL,                   -- public pseudonym: spice-<hmac(order)>; stable per order
  created_ms INTEGER NOT NULL,
  pool TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('buy','sell','watch')),
  thesis TEXT NOT NULL,
  idea_json TEXT NOT NULL,                -- validated numbers/tags only
  thesis_hash TEXT NOT NULL,              -- duplicate detection per author
  status TEXT NOT NULL DEFAULT 'visible' CHECK (status IN ('visible','held','hidden','removed')),
  status_reason TEXT,
  reports INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS signals_feed ON signals (net, status, created_ms DESC);
CREATE INDEX IF NOT EXISTS signals_author ON signals (author, created_ms DESC);
CREATE UNIQUE INDEX IF NOT EXISTS signals_dupe ON signals (author, thesis_hash);
-- one report per (signal, reporter ip-hash)
CREATE TABLE IF NOT EXISTS signal_reports (
  signal_id TEXT NOT NULL,
  reporter TEXT NOT NULL,                 -- salted ip hash, never the raw IP
  reason TEXT,
  created_ms INTEGER NOT NULL,
  PRIMARY KEY (signal_id, reporter)
);
-- attribution: bounties / credits granted later by a moderator; append-only
CREATE TABLE IF NOT EXISTS signal_credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('credit','bounty')),
  points INTEGER NOT NULL CHECK (points BETWEEN 1 AND 1000),
  note TEXT,
  created_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS signal_credits_sig ON signal_credits (signal_id);
-- moderation audit log
CREATE TABLE IF NOT EXISTS signal_mod_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  signal_id TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT,
  created_ms INTEGER NOT NULL
);
-- generic hourly/daily counters (posts per order, reads/reports per ip-hash)
CREATE TABLE IF NOT EXISTS signal_hits (
  k TEXT NOT NULL,
  bucket TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (k, bucket)
);
