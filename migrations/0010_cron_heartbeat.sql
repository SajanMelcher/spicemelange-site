-- Cron heartbeat: each scheduled run of a Worker records when it ran (no personal data). Shown on the Worker's /health.
CREATE TABLE IF NOT EXISTS cron_heartbeat (
  worker TEXT PRIMARY KEY,
  last_cron_at INTEGER NOT NULL,      -- event.scheduledTime (ms)
  last_cron TEXT,                     -- the cron expression that fired
  ran_at INTEGER NOT NULL,            -- wall clock when the handler started (ms)
  runs INTEGER NOT NULL DEFAULT 0
);
