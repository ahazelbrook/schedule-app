-- Migration 0006: the ambient scenes' document (AMBIENT-PLAN.md). GM only, never part of the /api/export backup.
-- IF NOT EXISTS, as in 0004. The same statement is in schema.sql and functions/_lib/db.js.

-- What plays on the table display when nothing is spotlit, one row per campaign. seq goes up by one on every write.
-- doc: { mode: auto | pin | off, scene, playlist: [ids], intervalMin, skip: n, crew: { heat, wanted },
--        score: { name, district, target, reveal: [bands], view, board: svg, iso: svg, at } }. At most 1.4 MiB.
CREATE TABLE IF NOT EXISTS gm_ambient (
  campaign TEXT PRIMARY KEY,
  seq INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  doc TEXT NOT NULL
);
