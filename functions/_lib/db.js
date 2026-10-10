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
    last_seen TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
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
