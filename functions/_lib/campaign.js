// The shared campaign document (see CAMPAIGN.md): its default shape, the player write rule,
// the clocks' ids and operations, and the read-modify-write loop on the `campaigns` table.
//
// Plain ES module with no Cloudflare-specific imports. The page keeps its own copy of the
// default document (app/campaign.js); keep the two in step.

import { HttpError, ID_RE, MAX_BODY_BYTES, isPlainObject, nowIso } from './http.js';
import { namesHit } from './gm.js';
import { hiddenNameHit } from './table-screen.js';
import { LIVE_SQL, liveFlagOf } from './live.js';

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
  if (before === after) return out;       // the same object (a part a PATCH did not touch, such as a big `mission`) cannot differ: skip its walk
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
 * `clockOps` are judged by their result, so a player's may only fill clocks that are there.
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

// ---------- clocks: stable ids, and a change as an operation on one clock ----------
//
// A PATCH replaces arrays, so a tick sent as the whole `clocks` array (what the previous release does) drops a tick
// another device made in the meantime. The page now sends `clockOps`: each change names one clock by its id and says
// only what changed. The PATCH handler applies them inside writeCampaign's loop, to the document as stored (re-read on
// every attempt), so changes to different clocks commute, and two ticks of the same clock leave the later one (last
// writer wins on that clock). CAMPAIGN.md, *Clocks*. app/runtime/cf.js applies the same rules to its optimistic copy:
// keep the two in step.

export const CLOCK_SIZES = [4, 6, 8, 10, 12];
export const CLOCK_KINDS = ['danger', 'project', 'faction', 'other'];
export const CLOCK_OPS_MAX = 200;
export const STALE_CLOCKS = 'the clocks changed on another device, try again';
const CLOCK_FIELDS = ['name', 'size', 'kind', 'hidden', 'filled'];   // what an op may set, in the order it is applied

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** The size a clock is drawn with: its own when it is one of CLOCK_SIZES, else the nearest (as app/campaign.js reads it). */
export function clockSize(c) {
  let n = +(c && c.size);
  if (CLOCK_SIZES.includes(n)) return n;
  n = n || 4;
  return CLOCK_SIZES.reduce((b, s) => (Math.abs(s - n) < Math.abs(b - n) ? s : b), 4);
}

/** A fill as a whole number within 0..size (the page's clamp). */
export function clampFill(n, size) {
  n = Math.round(+n || 0);
  return n < 0 ? 0 : n > size ? size : n;
}

/**
 * The clocks with an id each, named as the page names them (app/campaign.js normalize): a clock without an id is
 * 'c_<i>' (its place among the clocks), a repeated id gets '_' added until it is unique, and an entry that is not an
 * object is left out. Every write stores this (the in-place migration of a document from before ids), so an op the page
 * made for a clock it read without an id finds that clock. Returns the same array when nothing changes.
 */
export function withClockIds(list) {
  if (!Array.isArray(list)) return list;
  const seen = new Set(), out = [];
  let changed = false;
  for (const c of list) {
    if (!isPlainObject(c)) { changed = true; continue; }
    let id = str(c.id) || 'c_' + out.length;
    while (seen.has(id)) id += '_';
    seen.add(id);
    if (id === c.id) out.push(c);
    else { changed = true; out.push({ ...c, id }); }
  }
  return changed ? out : list;
}

/** The document with its clocks' ids filled in (withClockIds); the same object when they all have one. */
function withIds(doc) {
  if (!isPlainObject(doc) || !Array.isArray(doc.clocks)) return doc;
  const clocks = withClockIds(doc.clocks);
  return clocks === doc.clocks ? doc : { ...doc, clocks };
}

/** A clock from an `add` op, with the page's defaults for what the op leaves out. */
function newClock(a) {
  const size = a.size === undefined ? 4 : a.size;
  return {
    id: a.id, name: a.name === undefined ? '' : a.name, size, filled: clampFill(a.filled, size),
    kind: a.kind === undefined ? 'other' : a.kind, hidden: a.hidden === true,
  };
}

/**
 * Apply `clockOps` (checked by checkClockOps) to a clocks array, in order:
 *   { id, name?, size?, kind?, hidden?, filled? }    set those fields of the clock with that id; its fill stays within
 *                                                    0..size, so a smaller size takes the fill down with it
 *   { add: { id, name, size, filled, kind, hidden } } append a new clock, unless that id is already there
 *   { remove: id }                                   take that clock out
 * An op for a clock that is not there does nothing (a tick never brings back a clock the GM removed), and an op applied
 * twice gives what it gave once (the offline queue may send one again). Returns a new array; the clocks it changes are
 * new objects.
 */
export function applyClockOps(list, ops) {
  const clocks = withClockIds(Array.isArray(list) ? list : []).slice();
  for (const op of ops) {
    if (op.add !== undefined) {
      if (!clocks.some((c) => c.id === op.add.id)) clocks.push(newClock(op.add));
    } else if (op.remove !== undefined) {
      const i = clocks.findIndex((c) => c.id === op.remove);
      if (i >= 0) clocks.splice(i, 1);
    } else {
      const i = clocks.findIndex((c) => c.id === op.id);
      if (i < 0) continue;
      const c = { ...clocks[i] };
      for (const k of CLOCK_FIELDS) if (op[k] !== undefined) c[k] = op[k];
      if (op.filled !== undefined || op.size !== undefined) c.filled = clampFill(c.filled, clockSize(c));
      clocks[i] = c;
    }
  }
  return clocks;
}

/**
 * `clockOps` in a PATCH: a list of at most CLOCK_OPS_MAX ops in the shapes applyClockOps takes, every field of the type
 * the page writes (name text, size one of CLOCK_SIZES, filled a number, kind one of CLOCK_KINDS, hidden true or false)
 * and a new clock's id a plain id (ID_RE); anything else is 400. Who may do what is not decided here: the player rule
 * compares the result with the stored document, as for every other change (a player may only change `filled`).
 */
export function checkClockOps(ops) {
  const bad = (msg) => { throw new HttpError(400, 'clockOps: ' + msg); };
  const isId = (v) => typeof v === 'string' && v !== '';
  const fields = (o) => {
    for (const k of Object.keys(o)) if (k !== 'id' && !CLOCK_FIELDS.includes(k)) bad('unknown field ' + JSON.stringify(k).slice(0, 40));
    if (o.name !== undefined && typeof o.name !== 'string') bad('name must be text');
    if (o.size !== undefined && !CLOCK_SIZES.includes(o.size)) bad('size must be one of ' + CLOCK_SIZES.join(', '));
    if (o.filled !== undefined && !(typeof o.filled === 'number' && Number.isFinite(o.filled))) bad('filled must be a number');
    if (o.kind !== undefined && !CLOCK_KINDS.includes(o.kind)) bad('kind must be one of ' + CLOCK_KINDS.join(', '));
    if (o.hidden !== undefined && typeof o.hidden !== 'boolean') bad('hidden must be true or false');
  };
  if (!Array.isArray(ops)) bad('must be a list of clock changes');
  if (ops.length > CLOCK_OPS_MAX) bad('at most ' + CLOCK_OPS_MAX + ' changes in one write');
  for (const op of ops) {
    if (!isPlainObject(op)) bad('each change must be an object');
    const keys = Object.keys(op);
    if (keys.includes('add')) {
      if (keys.length !== 1 || !isPlainObject(op.add)) bad('add takes one new clock and nothing else');
      if (typeof op.add.id !== 'string' || !ID_RE.test(op.add.id)) bad('a new clock needs an id of letters, digits, _ or -');
      fields(op.add);
    } else if (keys.includes('remove')) {
      if (keys.length !== 1 || !isId(op.remove)) bad('remove takes a clock id and nothing else');
    } else {
      if (!isId(op.id)) bad('a change needs the clock id');
      if (keys.length < 2) bad('a change needs a field to set');
      fields(op);
    }
  }
}

/**
 * How many of the clocks in `incoming` (a whole array) have another fill than the stored clock with the same id. The
 * previous release sends a tick as the whole array, copied from the document as that device last read it with one fill
 * changed: from a player, more than one changed fill means the copy is older than another device's tick, and storing
 * it would undo that tick (the PATCH handler refuses it with 412, STALE_CLOCKS).
 */
export function changedFills(stored, incoming) {
  const before = new Map();
  for (const c of withClockIds(Array.isArray(stored) ? stored : [])) before.set(c.id, c);
  let n = 0;
  for (const c of withClockIds(Array.isArray(incoming) ? incoming : [])) {
    const s = before.get(c.id);
    if (s && clampFill(s.filled, clockSize(s)) !== clampFill(c.filled, clockSize(c))) n++;
  }
  return n;
}

/**
 * `crew`, `session`, `schedule` and `scene`, when a body names them, must be plain objects (400
 * otherwise). `scene` (who is on stage, see CAST.md) is { npcs: { <id>: true | false | null }, at }.
 * `clockOps` must pass checkClockOps.
 */
export function checkShape(body) {
  for (const k of ['crew', 'session', 'schedule', 'scene']) {
    if (k in body && !isPlainObject(body[k])) throw new HttpError(400, k + ' must be an object');
  }
  if ('clockOps' in body) checkClockOps(body.clockOps);
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

/** Server-side finishing touches: newest LOG_MAX log entries, every clock with an id, updatedAt stamped. */
export function finish(doc, now) {
  const next = withIds({ ...doc });
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

export const OVERLAY_CLOCK_REFUSED = 'overlay.clockId must be a clock the players can see';

/** The table's clocks (with ids) from the campaign row: one read by primary key, the array cut out in SQL so only it is parsed here. */
async function loadClocks(db, campaign) {
  const row = await db.prepare("SELECT json_extract(doc, '$.clocks') AS clocks FROM campaigns WHERE id = ?1").bind(campaign).first();
  let list = [];
  try { const v = row && typeof row.clocks === 'string' ? JSON.parse(row.clocks) : []; if (Array.isArray(v)) list = v; } catch (_) { /* none */ }
  return withClockIds(list);
}

/** The clock as the players see it, { name (at most 60), size, filled }, or null when it is missing, hidden or nameless. */
function visibleClock(list, clockId) {
  const c = list.find((x) => isPlainObject(x) && x.id === clockId);
  const name = c ? str(c.name).replace(/\s+/g, ' ').trim().slice(0, 60) : '';
  if (!c || c.hidden || !name) return null;
  const size = clockSize(c);
  return { name, size, filled: clampFill(c.filled, size) };
}

/**
 * 400 unless the clock an overlay names exists, is not hidden and has a name; a missing clock, a hidden one and a nameless one read
 * exactly alike, so the answer says nothing about a hidden clock. Run when the overlay is SET. Nothing of the clock is stored: the
 * overlay keeps its id, and joinOverlayClock() reads the clock again on every display GET.
 */
export async function assertOverlayClock(db, campaign, clockId) {
  if (!visibleClock(await loadClocks(db, campaign), clockId)) throw new HttpError(400, OVERLAY_CLOCK_REFUSED);
}

/**
 * The ambient part as the display is served it, with a clock overlay joined to its clock at READ time (GET /api/gm/display, after
 * liveAmbient): while that clock is present and not hidden, a copy of the overlay in the answer carries its name, size and LIVE fill
 * (whatever a stored overlay holds of those is overwritten); otherwise the overlay is left out of the answer, which also drops a clock
 * overlay of the old shape (no clockId). One read by primary key, only when the overlay is a clock one. Returns { amb, dropped, follows }:
 * `dropped` says the overlay was left out, `follows` that it is up and follows the clock, so the caller sends the ambient part in full
 * (a display whose ambient seq is current would otherwise never see the fill move or the clock go).
 */
export async function joinOverlayClock(db, campaign, amb) {
  const o = amb && amb.doc && amb.doc.overlay;
  if (!o || typeof o !== 'object' || o.kind !== 'clock') return { amb, dropped: false, follows: false };
  const vis = typeof o.clockId === 'string' && ID_RE.test(o.clockId) ? visibleClock(await loadClocks(db, campaign), o.clockId) : null;
  const next = { ...amb.doc };
  if (!vis) { delete next.overlay; return { amb: { ...amb, doc: next }, dropped: true, follows: false }; }
  // built from named keys, never by spreading the stored overlay: whatever else a stored row holds (an old shape, a stray key) is not served
  next.overlay = { id: o.id, kind: o.kind, ms: o.ms, at: o.at, age: o.age, auto: o.auto, clockId: o.clockId, name: vis.name, size: vis.size, filled: vis.filled };
  for (const k of Object.keys(next.overlay)) if (next.overlay[k] === undefined) delete next.overlay[k];       // absent stays absent (no `age: null`)
  return { amb: { ...amb, doc: next }, dropped: false, follows: true };
}

/**
 * Read-modify-write loop, as for characters. `build(current, now)` gets the stored document
 * (or the default one; its clocks with ids, see withClockIds) and the timestamp to stamp, checks
 * permissions (throwing HttpError), and returns the new document. The write only lands when the
 * row is unchanged since it was read; otherwise it is retried (build runs again on the new row),
 * and after MAX_ATTEMPTS the caller gets a 409.
 */
export async function writeCampaign(db, id, build) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row = await loadCampaignRow(db, id);
    const now = nowIso(row && row.updated_at);
    const doc = finish(build(withIds(campaignDoc(row)), now), now);
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

// ---------- the mission: what the players are shown of the Run view (design 5.1, 5.5c, 5.7) ----------
//
// `mission` in the campaign document is written by the GM page only, in a PATCH, and rebuilt here field by field (cleanMission):
// whatever else a body holds is dropped. It is { v, site, t, seq, hud, cards }. `hud` is the iPad's band and the one part the display
// GET serves (loadMissionPart); `cards` are one per PC and reach phones through the campaign document alone, never the display route.
// A player cannot write it: playerMayWrite reports any change under `mission`. The PATCH handler stores the GM's mission whole (it
// replaces, it does not deep merge), and a PUT never changes it (see functions/api/campaign.js).

export const MISSION_LIMITS = {
  str: 160, line: 300,                 // characters of a string; of a lead's line
  now: 3, next: 3, cardNext: 4,        // entries of hud.now, hud.next, a card's next
  marks: 24, crew: 8, cards: 8,        // night marks, hud.crew, cards
  leads: 8, zones: 12, items: 10, know: 16, paths: 6,   // per card
  beats: 200, size: 12, count: 99,     // whole numbers: beats in the night, an alarm clock's size, "ways found"
};
export const MISSION_REFUSED = 'mission names';

// text cut at `max` characters: control characters made spaces, and no half of a surrogate pair left at the cut
const cut = (v, max) => {
  if (typeof v !== 'string') return '';
  let s = v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  if (s.length > max) {
    s = s.slice(0, max);
    const c = s.charCodeAt(max - 1);
    if (c >= 0xd800 && c <= 0xdbff) s = s.slice(0, -1);
    s = s.trimEnd();
  }
  return s;
};
const whole = (v, lo, hi) => Math.min(hi, Math.max(lo, typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0));
const listOf = (v, max, one) => {
  const out = [];
  if (!Array.isArray(v)) return out;
  for (const x of v) {
    if (out.length >= max) break;
    const c = one(x);
    if (c !== null) out.push(c);
  }
  return out;
};
const strings = (v, max) => listOf(v, max, (x) => cut(x, MISSION_LIMITS.str) || null);
const nowEntry = (x) => {
  if (!isPlainObject(x)) return null;
  const text = cut(x.text, MISSION_LIMITS.str);
  return text ? { text, where: cut(x.where, MISSION_LIMITS.str), until: cut(x.until, MISSION_LIMITS.str) } : null;
};
const nextEntry = (x) => {
  if (!isPlainObject(x)) return null;
  const text = cut(x.text, MISSION_LIMITS.str);
  return text ? { text, where: cut(x.where, MISSION_LIMITS.str), at: cut(x.at, MISSION_LIMITS.str), inMin: whole(x.inMin, 0, 100000) } : null;
};

function cleanHud(h) {
  if (!isPlainObject(h)) return null;
  const L = MISSION_LIMITS, n = isPlainObject(h.night) ? h.night : null, a = isPlainObject(h.alarm) ? h.alarm : null;
  const size = a ? whole(a.size, 0, L.size) : 0;
  return {
    time: cut(h.time, L.str), label: cut(h.label, L.str),
    now: listOf(h.now, L.now, nowEntry),
    next: listOf(h.next, L.next, nextEntry),
    night: n ? {
      beats: whole(n.beats, 0, L.beats), start: whole(n.start, 0, L.beats), cur: whole(n.cur, 0, L.beats),
      marks: listOf(n.marks, L.marks, (m) => (isPlainObject(m) ? { i: whole(m.i, 0, L.beats), icon: cut(m.icon, L.str), text: cut(m.text, L.str) } : null)),
    } : null,
    alarm: a ? { name: cut(a.name, L.str), size, filled: Math.min(whole(a.filled, 0, L.size), size), text: cut(a.text, L.str) } : null,
    crew: listOf(h.crew, L.crew, (c) => {
      if (!isPlainObject(c)) return null;
      const out = { name: cut(c.name, L.str), costume: cut(c.costume, L.str), icon: cut(c.icon, L.str) };
      const room = cut(c.room, L.str);
      if (room) out.room = room;
      return out;
    }),
    target: isPlainObject(h.target) ? { room: cut(h.target.room, L.str) } : null,
    ways: isPlainObject(h.ways) ? { found: whole(h.ways.found, 0, L.count), total: whole(h.ways.total, 0, L.count) } : null,
  };
}

function cleanCard(c) {
  const L = MISSION_LIMITS, z = isPlainObject(c.zones) ? c.zones : {}, w = isPlainObject(c.warn) ? c.warn : null;
  return {
    name: cut(c.name, L.str), owner: cut(c.owner, L.str), costume: cut(c.costume, L.str), icon: cut(c.icon, L.str), room: cut(c.room, L.str), pos: cut(c.pos, L.str),
    warn: w ? { who: cut(w.who, L.str), look: cut(w.look, L.str), sees: cut(w.sees, L.str) } : null,
    zones: { controlled: strings(z.controlled, L.zones), risky: strings(z.risky, L.zones) },
    items: strings(c.items, L.items),
    leads: listOf(c.leads, L.leads, (d) => {
      if (!isPlainObject(d)) return null;
      const out = { name: cut(d.name, L.str), line: cut(d.line, L.line), heard: cut(d.heard, L.str), window: cut(d.window, L.str), next: cut(d.next, L.str) };
      if (d.done === true) out.done = true;
      return out.name || out.line ? out : null;
    }),
    know: strings(c.know, L.know),
    next: listOf(c.next, L.cardNext, nextEntry),
    paths: listOf(c.paths, L.paths, (p) => {
      if (!isPlainObject(p)) return null;
      const text = cut(p.text, L.str);
      return text ? { text, until: cut(p.until, L.str) } : null;
    }),
    busy: cut(c.busy, L.str) || null,
  };
}

/**
 * The mission as stored, rebuilt field by field from design 5.5c: every key is named here and anything else is dropped; strings are cut to
 * MISSION_LIMITS.str characters (a lead's line to .line), lists to their caps, numbers made whole and kept in range. null stays null (the
 * write removes the mission). Cards are kept by PC id (ID_RE), the first MISSION_LIMITS.cards of them. HttpError(400) for a value that is not
 * an object, and for a missing or non-whole `seq` (it must be 1 or more: the iPad compares it, and 0 reads as "no mission").
 */
export function cleanMission(raw) {
  if (raw === null) return null;
  if (!isPlainObject(raw)) throw new HttpError(400, 'mission must be an object, or null to remove it');
  if (!(Number.isInteger(raw.seq) && raw.seq >= 1 && raw.seq <= 1e9)) throw new HttpError(400, 'mission.seq must be a whole number of 1 or more');
  const cards = {};
  let n = 0;
  if (isPlainObject(raw.cards)) {
    for (const [id, c] of Object.entries(raw.cards)) {
      if (n >= MISSION_LIMITS.cards) break;
      if (!ID_RE.test(id) || id === '__proto__' || !isPlainObject(c)) continue;
      cards[id] = cleanCard(c);
      n++;
    }
  }
  return { v: 1, site: cut(raw.site, MISSION_LIMITS.str), t: whole(raw.t, -100000, 100000), seq: raw.seq, hud: cleanHud(raw.hud), cards };
}

/** Every string of a cleaned mission (the card ids too), as [path, text] pairs. */
export function missionTexts(m, path = 'mission', out = []) {
  if (typeof m === 'string') { if (m) out.push([path, m]); }
  else if (Array.isArray(m)) m.forEach((x, i) => missionTexts(x, path + '.' + i, out));
  else if (isPlainObject(m)) for (const [k, v] of Object.entries(m)) { out.push([path + '.' + k, k]); missionTexts(v, path + '.' + k, out); }
  return out;
}

/**
 * null, or { name, path }: the first of `names` (the hidden clocks and NPCs, loadHiddenNames) that a string of the cleaned mission holds as a
 * whole word, and where. Cost guard (a Worker has 10 ms of CPU): hiddenNameHit makes ONE pass over every string joined with a separator no name
 * can match across, and only when that finds something are the strings read one by one.
 */
export function missionHit(clean, names) {
  if (!clean || !Array.isArray(names) || !names.length) return null;
  const texts = missionTexts(clean);
  if (!hiddenNameHit([texts.map((t) => t[1]).join('\u0001')], names)) return null;
  for (const [path, text] of texts) for (const name of names) if (typeof name === 'string' && namesHit(text, [name])) return { name, path };
  return { name: '(a hidden name)', path: 'mission' };    // the joined pass saw a hit the strings do not show: fail closed
}

/** Throw the 422 for a hit from missionHit; the message names the hit and where, for the page to show. */
export function refuseMissionHit(hit) {
  throw new HttpError(422, MISSION_REFUSED + ' "' + hit.name + '" at ' + hit.path + ', which the players must not see');
}

// ---------- the iPad's fourth part ----------

const HSEQ_RE = /^\d{1,15}$/;

/**
 * The display GET's fourth part (?hseq=N), read in ONE statement: the mission's seq with json_extract, and `mission.hud` only while that seq
 * differs from the page's (the CASE keeps the hud, and everything else of the document, out of the answer when nothing changed). With
 * `withLive` the same statement carries the live-sync switch too, so a poll that reads the switch anyway makes no extra D1 call. The cards are
 * never selected. -> { part, live }: part is { hseq, hud } (no mission stored: hseq 0 and hud null) or { hseq, unchanged: true }.
 */
export async function loadMissionPart(db, campaign, hseqRaw, withLive) {
  const have = typeof hseqRaw === 'string' && HSEQ_RE.test(hseqRaw) ? Number(hseqRaw) : -1;      // anything else counts as stale
  const seq = "CASE WHEN json_valid(doc) THEN json_extract(doc, '$.mission.seq') END";
  const hud = "CASE WHEN json_valid(doc) AND COALESCE(json_extract(doc, '$.mission.seq'), 0) != ?2 THEN json_extract(doc, '$.mission.hud') END";
  const row = await db.prepare(
    'SELECT (SELECT ' + seq + ' FROM campaigns WHERE id = ?1) AS hseq, (SELECT ' + hud + ' FROM campaigns WHERE id = ?1) AS hud' +
    (withLive ? ', (SELECT ' + LIVE_SQL + ' FROM campaigns WHERE id = ?3) AS live' : '')
  ).bind(...(withLive ? [campaign, have, campaign + '#gm'] : [campaign, have])).first();
  const r = row || {};
  const now = Number.isInteger(r.hseq) && r.hseq >= 1 ? r.hseq : 0;
  let part;
  if (now === 0) part = { hseq: 0, hud: null };
  else if (now === have) part = { hseq: now, unchanged: true };
  else {
    let h = null;
    try { const v = typeof r.hud === 'string' ? JSON.parse(r.hud) : null; if (isPlainObject(v)) h = v; } catch (_) { /* no hud */ }
    part = { hseq: now, hud: h };
  }
  return { part, live: liveFlagOf(r.live === undefined ? null : r.live) };
}
