-- Migration 0009: the store (suite build W0.6). One generic table for the suite's small per-campaign documents: a player's
-- opportunity pick, a debrief, a quiet note, and whatever the later tickets keep beside them. ADDITIVE ONLY: nothing existing
-- is altered, so the previous Worker runs against this schema unchanged (it never reads the table).
-- IF NOT EXISTS, as in 0004. The same statements are in schema.sql and functions/_lib/db.js.

-- campaign_id is the CAMPAIGN binding (the other tables call it `campaign`); kind names the document ([a-z][a-z0-9-]{0,31});
-- owner is whose it is: a player's me.id (their email, as characters.owner) or, for the GM's campaign-wide rows, a name of the
-- GM's choosing ('_' by default). scope is who may read it: 'gm' (the GM only), 'player' (the GM and the owner) or 'public'
-- (every signed-in role, the table display included). json is JSON text, at most 64 KiB; updated_at is an ISO time.
CREATE TABLE IF NOT EXISTS docs (
  campaign_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  owner TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'gm' CHECK (scope IN ('gm', 'player', 'public')),
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, kind, owner)
);
CREATE INDEX IF NOT EXISTS docs_campaign_updated ON docs (campaign_id, updated_at);
