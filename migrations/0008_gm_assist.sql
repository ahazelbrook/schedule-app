-- Migration 0008: "Claude at the table" (the assist build plan, Phase 1). GM only, never part of the /api/export backup.
-- IF NOT EXISTS, as in 0004. The same statements are in schema.sql and functions/_lib/db.js.

-- One row per seat call, for the cost meter (tonight's spend), the Conductor's cooldowns and the replay analysis.
-- cents is real money (the Worker's own estimate from the usage block); flags is the Tripwire's set that woke the call
-- (comma separated); card is JSON: the seat's output plus whether the Editor let it through ({ out, text, keys, shown }),
-- or { error } when the call failed. No prompt text and no key is ever stored here.
CREATE TABLE IF NOT EXISTS gm_assist_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign TEXT NOT NULL DEFAULT 'default',
  at TEXT NOT NULL,
  session TEXT NOT NULL DEFAULT '',
  seat TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT NOT NULL DEFAULT '',
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read INTEGER NOT NULL DEFAULT 0,
  cache_write INTEGER NOT NULL DEFAULT 0,
  cents REAL NOT NULL DEFAULT 0,
  flags TEXT NOT NULL DEFAULT '',
  card TEXT
);
CREATE INDEX IF NOT EXISTS gm_assist_log_at ON gm_assist_log (campaign, at);
