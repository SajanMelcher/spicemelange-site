-- Hwi's 14-day practice lessons. DOUBLE opt-in only (Sajan 2026-10-10 7:16 AM PT): a ticked box + email tied to an
-- order the buyer holds the token for (status 'pending'), THEN a click on the emailed confirm link (status 'active',
-- confirmed_ms set). Lessons go only to active rows with confirmed_ms set and a paid order. orders.email (receipt
-- address) is never used for lessons. One subscription per order. Idempotent.
CREATE TABLE IF NOT EXISTS lesson_subs (
  id TEXT PRIMARY KEY,                    -- ls_<random>
  net TEXT NOT NULL,                      -- testnet | mainnet (same as orders.net)
  order_id TEXT NOT NULL,                 -- PRIVATE
  email TEXT NOT NULL,                    -- PRIVATE: lowercased; never returned by any API, never logged
  consent_ms INTEGER NOT NULL,            -- step 1: box ticked
  consent_source TEXT NOT NULL CHECK (consent_source IN ('checkout','order_page')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','done','unsubscribed','expired')),
  confirm_token TEXT NOT NULL UNIQUE,     -- lc_<random>; only in the confirmation email
  confirm_sent_ms INTEGER,                -- when the confirmation email went out (null = not yet)
  confirm_sends INTEGER NOT NULL DEFAULT 0,
  confirmed_ms INTEGER,                   -- step 2: confirm link clicked. NULL = never gets a lesson
  next_day INTEGER NOT NULL DEFAULT 1 CHECK (next_day BETWEEN 1 AND 15),
  last_sent_ms INTEGER,
  unsub_token TEXT NOT NULL UNIQUE,       -- lu_<random>; only in the one-click unsubscribe link
  unsub_ms INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0,
  CHECK (status NOT IN ('active','done') OR confirmed_ms IS NOT NULL)
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
