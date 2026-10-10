-- 10/9/2026: auto-update support.
-- status_hits: per-order hourly counter for status/download/reset calls. Separate from orders.attempts
-- (payment verification), so polling a paid order never uses up verify attempts.
CREATE TABLE IF NOT EXISTS status_hits (
  order_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (order_id, bucket)
);
-- reset_challenges: single-use, short-lived messages a paid buyer signs with the paying Sui wallet to rotate the order token.
CREATE TABLE IF NOT EXISTS reset_challenges (
  nonce TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS reset_challenges_order ON reset_challenges (order_id);
