-- D1 schema for the hosted build (see HOSTING.md, "Database").
-- Production: npx wrangler d1 execute DB --remote --file schema.sql
-- Local:      npm run db:local
-- The API also runs these statements lazily (once per isolate), so a fresh database works.

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  campaign TEXT NOT NULL DEFAULT 'default',
  owner TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  doc TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS characters_campaign_updated ON characters (campaign, updated_at);

-- Everyone who has called /api/me, so the GM table can show names.
CREATE TABLE IF NOT EXISTS members (
  email TEXT PRIMARY KEY,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'player',
  last_seen TEXT NOT NULL
);
