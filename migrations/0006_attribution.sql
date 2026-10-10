-- Sales sources (Sajan 2026-10-10 ~2:18 AM PT relay, PREVIEW first): utm_* and ?ref= saved with each order, plus referral codes.
-- Additive only. createOrder falls back to the old INSERT if these columns are missing, so code can ship before this runs.
ALTER TABLE orders ADD COLUMN utm_source TEXT;
ALTER TABLE orders ADD COLUMN utm_medium TEXT;
ALTER TABLE orders ADD COLUMN utm_campaign TEXT;
ALTER TABLE orders ADD COLUMN utm_term TEXT;
ALTER TABLE orders ADD COLUMN utm_content TEXT;
ALTER TABLE orders ADD COLUMN ref TEXT;
CREATE INDEX IF NOT EXISTS orders_ref ON orders(ref);
CREATE TABLE IF NOT EXISTS referral_codes (
  code TEXT PRIMARY KEY,          -- lowercase a-z0-9-, 2..32
  owner TEXT NOT NULL,            -- who the code credits (a pseudonym or contact label; no wallet keys)
  created_ms INTEGER NOT NULL,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1
);
