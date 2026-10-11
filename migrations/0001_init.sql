-- Migration 0001: the initial schema (the same statements as schema.sql). Every statement is
-- IF NOT EXISTS, so it also applies cleanly to a database first created from schema.sql.

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
