// The shared campaign document (see CAMPAIGN.md): its default shape, the player write rule,
// and the read-modify-write loop on the `campaigns` table.
//
// Plain ES module with no Cloudflare-specific imports. The page keeps its own copy of the
// default document (app/campaign.js); keep the two in step.

import { HttpError, ID_RE, MAX_BODY_BYTES, isPlainObject, nowIso } from './http.js';

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
    schedule: defaultSchedule(),
    log: [],
    updatedAt: null,
  };
}

/** What a missing `schedule` reads as (see SCHEDULE.md). */
export function defaultSchedule() {
  return { options: {}, avail: {}, next: null, rsvp: {}, cadence: null, quorum: 0 };
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

function playerMayChange(path, meId) {
  if (PLAYER_PATHS.some((p) => p.length === path.length &&
    p.every((seg, i) => (seg === INDEX ? typeof path[i] === 'number' : seg === path[i])))) return true;
  // schedule.avail.<me>[.…] and schedule.rsvp.<me>[.…]: a person's own answers. Ids are emails,
  // and a path is an array of segments, so a key containing '.' cannot be confused with a path.
  return typeof meId === 'string' && meId !== '' && path.length >= 3 && path[0] === 'schedule' &&
    (path[1] === 'avail' || path[1] === 'rsvp') && path[2] === meId;
}

/**
 * Every leaf path whose value differs between two documents. Objects are compared key by key,
 * arrays of equal length index by index; an array whose length changed is reported as the
 * array's own path (so adding or removing a clock is never a player change). A key present on
 * one side only is reported as the paths under it when its value is a non-empty plain object
 * (so a new `schedule.avail.<me>` is `[schedule, avail, <me>, <key>]`), else as its own path.
 */
export function changedPaths(before, after, path = [], out = []) {
  const nonEmpty = (v) => isPlainObject(v) && Object.keys(v).length > 0;
  if (before === undefined && nonEmpty(after)) before = {};
  else if (after === undefined && nonEmpty(before)) after = {};
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

// A stored document may predate `schedule`: compare both sides with the missing keys filled in.
function withSchedule(doc) {
  if (doc.schedule !== undefined && !isPlainObject(doc.schedule)) return doc;
  return { ...doc, schedule: { ...defaultSchedule(), ...(doc.schedule || {}) } };
}

/**
 * True when a player (`meId`, the caller's id) may turn `before` into `after`: anything under
 * `crew`, `clocks.<i>.filled` (same number of clocks), and the caller's own entries
 * `schedule.avail.<meId>` and `schedule.rsvp.<meId>`. `log` is not compared here: a PATCH adds
 * to it through mergeLog, and only the GM can PUT. updatedAt is ignored: the server stamps it.
 */
export function playerMayWrite(before, after, meId) {
  const { log: _l1, crew: _c1, updatedAt: _u1, ...oldRest } = withSchedule(before);
  const { log: _l2, crew: _c2, updatedAt: _u2, ...newRest } = withSchedule(after);
  return changedPaths(oldRest, newRest).every((p) => playerMayChange(p, meId));
}

// ---------- the log: PATCH adds entries, it never replaces ----------

const entryKey = (e) => JSON.stringify([e.at, e.by, e.text]);
const slotKey = (e) => JSON.stringify([e.at, e.by]);

/**
 * PATCH semantics for `log`: the incoming array is a set of entries to add, so two clients that
 * append from the same stale copy both land. An entry already stored (same at + by + text) is
 * skipped. One with the same at + by as a stored entry but other text is an attempt to rewrite
 * it: 403 for a player, ignored for the GM (rewriting the log takes a PUT). The result is sorted
 * by `at`, newest first (stable), and trimmed to LOG_MAX.
 * @returns {Array} the new log; throws HttpError(400 | 403)
 */
export function mergeLog(stored, incoming, gm) {
  if (!Array.isArray(incoming)) throw new HttpError(400, 'log must be an array of entries');
  const old = Array.isArray(stored) ? stored.filter(isPlainObject) : [];
  const have = new Set(old.map(entryKey));
  const slots = new Set(old.map(slotKey));
  const added = [];
  for (const e of incoming) {
    if (!isPlainObject(e)) throw new HttpError(400, 'log entries must be objects');
    if (have.has(entryKey(e))) continue;
    if (slots.has(slotKey(e))) {
      if (gm) continue;
      throw new HttpError(403, GM_ONLY);
    }
    have.add(entryKey(e)); slots.add(slotKey(e));
    added.push(e);
  }
  if (!added.length) return old.slice(0, LOG_MAX);
  const at = (e) => (typeof e.at === 'string' ? e.at : '');
  return added.concat(old)
    .map((e, i) => [e, i])
    .sort((a, b) => (at(a[0]) < at(b[0]) ? 1 : at(a[0]) > at(b[0]) ? -1 : a[1] - b[1]))
    .map(([e]) => e)
    .slice(0, LOG_MAX);
}

/**
 * `crew`, `session`, `schedule` and `scene`, when a body names them, must be plain objects (400
 * otherwise). `scene` (who is on stage, see CAST.md) is { npcs: { <id>: true | false | null }, at }.
 */
export function checkShape(body) {
  for (const k of ['crew', 'session', 'schedule', 'scene']) {
    if (k in body && !isPlainObject(body[k])) throw new HttpError(400, k + ' must be an object');
  }
  const sc = body.scene;
  if (sc === undefined) return;
  if ('npcs' in sc) {
    const n = sc.npcs;
    if (!isPlainObject(n) || Object.keys(n).length > 100 ||
      Object.entries(n).some(([id, v]) => !ID_RE.test(id) || (v !== true && v !== false && v !== null))) {
      throw new HttpError(400, 'scene.npcs must map NPC ids to true or false');
    }
  }
  if ('at' in sc && sc.at !== null && (typeof sc.at !== 'string' || sc.at.length > 40)) throw new HttpError(400, 'scene.at must be a time or null');
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
