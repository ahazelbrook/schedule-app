-- Migration 0007: the table iPad's transcriber (GM.md "Listening"). GM only, never part of the /api/export backup.
-- IF NOT EXISTS, as in 0004. The same statements are in schema.sql and functions/_lib/db.js.

-- The lines the iPad heard, in order. seq is per campaign; id is the iPad's own, so a resend is skipped.
CREATE TABLE IF NOT EXISTS gm_transcript (
  campaign TEXT NOT NULL,
  seq INTEGER NOT NULL,
  id TEXT NOT NULL,
  session TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL,
  conn TEXT NOT NULL DEFAULT '',
  speaker INTEGER,
  kind TEXT NOT NULL DEFAULT 'line',
  text TEXT NOT NULL,
  PRIMARY KEY (campaign, seq)
);
CREATE UNIQUE INDEX IF NOT EXISTS gm_transcript_id ON gm_transcript (campaign, id);

-- The control document, one row per campaign: { want, session, speakers, status }.
CREATE TABLE IF NOT EXISTS gm_stt (
  campaign TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  doc TEXT NOT NULL
);
