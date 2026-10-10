-- Siona GL2: after an unsubscribe we keep only a hashed-email suppression record and the date; the subscription row,
-- quiz answers, utm/ref and send history are deleted. A later fresh opt-in + confirm lifts the suppression.
CREATE TABLE IF NOT EXISTS email_suppressions (
  email_hash TEXT NOT NULL,               -- sha256 of the lowercased address; never the address itself
  list TEXT NOT NULL CHECK (list IN ('lessons','course')),
  unsub_ms INTEGER NOT NULL,
  PRIMARY KEY (email_hash, list)
);
ALTER TABLE course_subs ADD COLUMN handoff_ms INTEGER; -- R9: when the 14-day lessons took over (row deleted 7 days later)
