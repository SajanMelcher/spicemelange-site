-- Hwi's 14-day practice lessons (branch hwi-lessons). Opt-in only; one subscription per order.
-- Renumber to the next free 0NNN if another branch lands a 0005 first (the SQL is idempotent).
CREATE TABLE IF NOT EXISTS lesson_subs (
  id TEXT PRIMARY KEY,                    -- ls_<random>
  net TEXT NOT NULL,                      -- testnet | mainnet (same as orders.net)
  order_id TEXT NOT NULL,                 -- PRIVATE: the order that opted in; lessons go out only once it is paid
  email TEXT NOT NULL,                    -- PRIVATE: lowercased; never returned by any API, never logged
  consent_ms INTEGER NOT NULL,            -- when the buyer ticked "Get Hwi's 14-day practice lessons"
  consent_source TEXT NOT NULL CHECK (consent_source IN ('checkout','order_page')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','done','unsubscribed','expired')),
  next_day INTEGER NOT NULL DEFAULT 1 CHECK (next_day BETWEEN 1 AND 15),
  last_sent_ms INTEGER,
  unsub_token TEXT NOT NULL UNIQUE,       -- random; only appears in the one-click unsubscribe link
  unsub_ms INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS lesson_subs_order ON lesson_subs (net, order_id);
CREATE INDEX IF NOT EXISTS lesson_subs_due ON lesson_subs (net, status, last_sent_ms);
-- One row per (subscription, day): the claim that makes each lesson send at most once.
CREATE TABLE IF NOT EXISTS lesson_sends (
  sub_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  sent_ms INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('test','production')),
  resend_id TEXT,
  PRIMARY KEY (sub_id, day)
);
