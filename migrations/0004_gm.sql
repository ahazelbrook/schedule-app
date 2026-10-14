-- Migration 0004: the GM tools (GM.md). GM only, never in git, never part of the /api/export backup.
-- Every statement is IF NOT EXISTS, as in 0001. The same statements are in schema.sql.
-- (The GM state document needs no table: it is the `campaigns` row with id '<CAMPAIGN>#gm'.)

-- The GM pack: the generators' tables, one row per part ('console', 'location', 'campaign', ...), imported by the GM
-- from their own PC. version: a short hash of body. src: JSON (file, blockSha, exportedAt). updated_at: ms since 1970.
-- body: the part as JSON text (an object), at most 900 KiB.
CREATE TABLE IF NOT EXISTS gm_pack (
  campaign TEXT NOT NULL,
  part TEXT NOT NULL,
  version TEXT NOT NULL,
  src TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  body TEXT NOT NULL,
  PRIMARY KEY (campaign, part)
);

-- What the table's display shows, one row per campaign. seq goes up by one on every write.
-- doc: { kind: blank | svg | npc | text, title, caption, svg | npcId | text }.
CREATE TABLE IF NOT EXISTS gm_display (
  campaign TEXT PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  doc TEXT NOT NULL
);
