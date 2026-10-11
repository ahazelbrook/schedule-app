-- D1 schema for the hosted build (see HOSTING.md, "Database"): the whole schema as it stands.
-- Applied through migrations/ (migrations/0001_init.sql holds these same statements; later changes
-- go in new numbered files there, and here):
--   production: npx wrangler d1 migrations apply DB --remote   (scripts/deploy.sh does this)
--   local:      npm run db:local
-- The API also runs these CREATE ... IF NOT EXISTS statements lazily (once per isolate), so a
-- fresh database works, and applying the migration to a database made from this file is harmless.

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

-- One shared campaign document per campaign (id = the CAMPAIGN binding), see CAMPAIGN.md.
CREATE TABLE IF NOT EXISTS campaigns (
  id TEXT PRIMARY KEY,
  updated_at TEXT NOT NULL,
  doc TEXT NOT NULL
);
