// The shared campaign document (see CAMPAIGN.md): its default shape, the player write rule,
// and the read-modify-write loop on the `campaigns` table.
//
// Plain ES module with no Cloudflare-specific imports. The page keeps its own copy of the
// default document (app/campaign.js); keep the two in step.

import { HttpError, MAX_BODY_BYTES, isPlainObject, nowIso } from './http.js';

export const CAMPAIGN_DOC_ID = 'main';
export const LOG_MAX = 200;
export const GM_ONLY = 'only the GM can change that';
const MAX_ATTEMPTS = 5;

/** A fresh default campaign document (what a missing row reads as). */
export function defaultCampaign() {
  return {
    v: 1,
    session: { number: 0, startedAt: null, endedAt: null },
    crew: {
      name: '', type: '', lair: '', notes: '',
      tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0,
      claims: [], cohorts: [], factions: [],
    },
    clocks: [],
    log: [],
    updatedAt: null,
  };
}

// ---------- the player rule ----------

// Leaf paths a player may change outside `crew` (the crew sheet is shared by the whole table, so
// everything under `crew` is open to players and treated as opaque JSON). A path is an array of
// segments: object keys are strings, array indices are numbers, so a crafted key such as
// "clocks.0.filled" never matches.
const INDEX = Symbol('array index');
const PLAYER_PATHS = [
  ['clocks', INDEX, 'filled'],
];

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function playerMayChange(path) {
  return PLAYER_PATHS.some((p) => p.length === path.length &&
    p.every((seg, i) => (seg === INDEX ? typeof path[i] === 'number' : seg === path[i])));
}

/**
 * Every leaf path whose value differs between two documents. Objects are compared key by key,
 * arrays of equal length index by index; an array whose length changed is reported as the
 * array's own path (so adding or removing a clock is never a player change).
 */
export function changedPaths(before, after, path = [], out = []) {
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const k of keys) changedPaths(before[k], after[k], path.concat(k), out);
  } else if (Array.isArray(before) && Array.isArray(after) && before.length === after.length) {
    for (let i = 0; i < before.length; i++) changedPaths(before[i], after[i], path.concat(i), out);
  } else if (!sameJson(before, after)) {
    out.push(path);
  }
  return out;
}

/**
 * `next` only adds entries at the front of `prev` (newest first) and leaves the old ones
 * unchanged. A log already trimmed to LOG_MAX by the client may drop the oldest entries.
 */
export function isLogAppend(prev, next) {
  if (!Array.isArray(next)) return false;
  const old = Array.isArray(prev) ? prev : [];
  for (let added = Math.max(0, next.length - old.length); added <= next.length; added++) {
    const kept = next.length - added;
    if (kept !== old.length && next.length < LOG_MAX) continue; // only the cap may drop old entries
    if (sameJson(next.slice(added), old.slice(0, kept))) return true;
  }
  return false;
}

/**
 * True when a player may turn `before` into `after`: anything under `crew`, `clocks.<i>.filled`
 * (same number of clocks), and appending to `log`. updatedAt is ignored: the server stamps it.
 */
export function playerMayWrite(before, after) {
  const { log: oldLog, crew: _c1, updatedAt: _u1, ...oldRest } = before;
  const { log: newLog, crew: _c2, updatedAt: _u2, ...newRest } = after;
  if (!changedPaths(oldRest, newRest).every(playerMayChange)) return false;
  return sameJson(oldLog, newLog) || isLogAppend(oldLog, newLog);
}

/** Server-side finishing touches: newest LOG_MAX log entries, updatedAt stamped. */
export function finish(doc, now) {
  const next = { ...doc };
  if (Array.isArray(next.log) && next.log.length > LOG_MAX) next.log = next.log.slice(0, LOG_MAX);
  next.updatedAt = now;
  return next;
}

// ---------- storage ----------

export async function loadCampaignRow(db, id) {
  return db.prepare('SELECT id, updated_at, doc FROM campaigns WHERE id = ?1').bind(id).first();
}

export async function campaignUpdatedAt(db, id) {
  const row = await db.prepare('SELECT updated_at FROM campaigns WHERE id = ?1').bind(id).first();
  return row ? row.updated_at : null;
}

/** The stored document, or the default one when the row is missing or unreadable. */
export function campaignDoc(row) {
  if (!row) return defaultCampaign();
  try {
    const d = JSON.parse(row.doc);
    if (isPlainObject(d)) return d;
  } catch (_) { /* fall through */ }
  return defaultCampaign();
}

/**
 * Read-modify-write loop, as for characters. `build(current, now)` gets the stored document
 * (or the default one) and the timestamp to stamp, checks permissions (throwing HttpError),
 * and returns the new document. The write only lands when the row is unchanged since it was
 * read; otherwise it is retried, and after MAX_ATTEMPTS the caller gets a 409.
 */
export async function writeCampaign(db, id, build) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row = await loadCampaignRow(db, id);
    const now = nowIso(row && row.updated_at);
    const doc = finish(build(campaignDoc(row), now), now);
    const text = JSON.stringify(doc);
    if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new HttpError(413, 'document too large');
    const result = row
      ? await db
        .prepare('UPDATE campaigns SET updated_at = ?1, doc = ?2 WHERE id = ?3 AND updated_at = ?4')
        .bind(now, text, id, row.updated_at)
        .run()
      : await db
        .prepare('INSERT INTO campaigns (id, updated_at, doc) VALUES (?1, ?2, ?3) ON CONFLICT(id) DO NOTHING')
        .bind(id, now, text)
        .run();
    if (result && result.meta && result.meta.changes > 0) return doc;
  }
  throw new HttpError(409, 'the campaign changed while saving, try again');
}
