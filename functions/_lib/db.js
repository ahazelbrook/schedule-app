// D1 access. The tables are also created lazily (once per isolate) so a fresh local
// database works without running schema.sql first; schema.sql holds the same statements.

import { HttpError } from './http.js';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS characters (
    id TEXT PRIMARY KEY,
    campaign TEXT NOT NULL DEFAULT 'default',
    owner TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    doc TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS characters_campaign_updated ON characters (campaign, updated_at)`,
  `CREATE TABLE IF NOT EXISTS members (
    email TEXT PRIMARY KEY,
    name TEXT,
    role TEXT NOT NULL DEFAULT 'player',
    last_seen TEXT NOT NULL,
    name_override TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    updated_at TEXT NOT NULL,
    doc TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS rules (
    campaign TEXT NOT NULL DEFAULT 'default',
    book TEXT NOT NULL CHECK (book IN ('b68', 'bitd', 'house')),
    slug TEXT NOT NULL,
    title TEXT NOT NULL,
    trail TEXT NOT NULL DEFAULT '',
    keys TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL DEFAULT '',
    ord INTEGER NOT NULL DEFAULT 0,
    src TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (campaign, book, slug)
  )`,
  `CREATE INDEX IF NOT EXISTS rules_campaign_book_ord ON rules (campaign, book, ord)`,
  `CREATE TABLE IF NOT EXISTS npcs (
    id TEXT PRIMARY KEY,
    campaign TEXT NOT NULL DEFAULT 'default',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    doc TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS npcs_campaign_updated ON npcs (campaign, updated_at)`,
  `CREATE TABLE IF NOT EXISTS gm_pack (
    campaign TEXT NOT NULL,
    part TEXT NOT NULL,
    version TEXT NOT NULL,
    src TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL,
    body TEXT NOT NULL,
    PRIMARY KEY (campaign, part)
  )`,
  `CREATE TABLE IF NOT EXISTS gm_display (
    campaign TEXT PRIMARY KEY,
    seq INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    doc TEXT NOT NULL
  )`,
];

let ready = null; // Promise, per isolate

export async function getDb(env) {
  const db = env && env.DB;
  if (!db || typeof db.prepare !== 'function') throw new HttpError(500, 'database not configured');
  if (!ready) {
    ready = db.batch(SCHEMA.map((sql) => db.prepare(sql))).catch((e) => {
      ready = null; // try again on the next request
      throw e;
    });
  }
  await ready;
  return db;
}
