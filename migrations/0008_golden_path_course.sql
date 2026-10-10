-- The Golden Path free course (Ixians R2/R6-R9). DOUBLE opt-in: /learn/ quiz + unticked consent box (pending), then the
-- emailed confirm link (active). Quiz answers are teaching tags only; never income, savings, debts, balances or age.
CREATE TABLE IF NOT EXISTS course_subs (
  id TEXT PRIMARY KEY,                    -- cs_<random>
  net TEXT NOT NULL,                      -- testnet (preview) | mainnet (production), keeps preview data apart
  email TEXT NOT NULL,                    -- PRIVATE, lowercased
  track TEXT NOT NULL CHECK (track IN ('pilgrim','fremen','naib')),
  goal TEXT NOT NULL CHECK (goal IN ('longview','botsafety','builder','evaluate')),
  time TEXT NOT NULL CHECK (time IN ('brief','standard','weekly')),
  agent TEXT NOT NULL CHECK (agent IN ('yes','no')),
  consent_ms INTEGER NOT NULL,
  consent_source TEXT NOT NULL CHECK (consent_source IN ('learn_quiz')),
  src TEXT,                               -- first-touch utm/ref JSON (validated tags only)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','done','unsubscribed','handed_off','expired','suppressed')),
  confirm_token TEXT NOT NULL UNIQUE,
  confirm_sent_ms INTEGER,
  confirm_sends INTEGER NOT NULL DEFAULT 0,
  confirmed_ms INTEGER,
  next_email INTEGER NOT NULL DEFAULT 1,  -- index into schedule(time), 1-based
  last_sent_ms INTEGER,
  unsub_token TEXT NOT NULL UNIQUE,
  unsub_ms INTEGER,
  fail_count INTEGER NOT NULL DEFAULT 0,
  resend_contact_id TEXT,                 -- R7: Resend contact holding the tags (written only by the Worker)
  CHECK (status NOT IN ('active','done') OR confirmed_ms IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS course_subs_email ON course_subs (net, email);
CREATE INDEX IF NOT EXISTS course_subs_due ON course_subs (net, status, last_sent_ms);
CREATE TABLE IF NOT EXISTS course_sends (
  sub_id TEXT NOT NULL, email_no INTEGER NOT NULL, sent_ms INTEGER NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('test','production')), resend_id TEXT,
  PRIMARY KEY (sub_id, email_no)
);
-- R8: replies to reserve@ become SUGGESTED tag changes for Hwi; applied only after Sajan approves ('stop' unsubscribes at once).
CREATE TABLE IF NOT EXISTS course_suggestions (
  id TEXT PRIMARY KEY, sub_id TEXT NOT NULL, received_ms INTEGER NOT NULL,
  keyword TEXT NOT NULL CHECK (keyword IN ('simpler','deeper','slower','faster','stop')),
  proposal TEXT NOT NULL,                 -- e.g. 'track: fremen -> pilgrim'
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','applied'))
);
