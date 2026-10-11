-- Per-IP rate limit for the /sign/ APIs (store-core/sign-ratelimit.js), replacing the KV counter (KV reads are edge-cached, so the
-- KV limit never fired on prod, 11:06 PM PT 10/10). key = <endpoint>:<HMAC(SPICE_SESSION_SECRET, IP) hex>, "window" = floor(now/60 s).
-- Rows older than the previous window are deleted on every request (so a hashed IP is kept for about 2 minutes); purge.js is the backstop.
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, "window" INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rate_limits_window ON rate_limits ("window");
