// NPC rows (the cast, see CAST.md): shape checks, who sees what, and writes with optimistic
// concurrency, like characters.js. Only the GM writes; a player reads the revealed NPCs and never
// receives `gmNotes` or an unrevealed row.
//
// Plain ES module with no Cloudflare-specific imports.

import { HttpError, ID_RE, MAX_BODY_BYTES, isPlainObject, nowIso } from './http.js';

export const GM_ONLY_NPC = 'only the GM can change the cast';
const MAX_ATTEMPTS = 5;
export const MAX_NPCS = 300;          // live rows returned by a list
const MAX_SPEC_BYTES = 32 * 1024;     // a figure spec is a few KB; this is a generous cap

// the fields of an NPC document, with the longest text each may hold
const TEXT = { name: 80, alias: 80, role: 80, faction: 80, description: 2000, gmNotes: 8000 };
const MAX_TAGS = 20;
const MAX_TAG = 40;

/** A fresh NPC document: every field present. */
export function blankNpc() {
  return { name: '', alias: '', role: '', faction: '', description: '', spec: {}, revealed: false, firstSeen: null, tags: [], gmNotes: '' };
}

/**
 * Check a body from the GM and return the document to store: exactly the known fields (a missing
 * one takes its blank value), plus `createdAt` / `updatedAt` stamped by the caller. Unknown fields
 * are refused so a typo never silently vanishes. Throws HttpError(400 | 413).
 */
export function checkNpc(body) {
  if (!isPlainObject(body)) throw new HttpError(400, 'body must be a JSON object');
  const known = new Set([...Object.keys(blankNpc()), 'v', 'id', 'createdAt', 'updatedAt']);
  for (const k of Object.keys(body)) if (!known.has(k)) throw new HttpError(400, 'unknown field: ' + k);
  const doc = blankNpc();
  for (const [k, max] of Object.entries(TEXT)) {
    if (!(k in body)) continue;
    const v = body[k];
    if (typeof v !== 'string') throw new HttpError(400, k + ' must be a string');
    if (v.length > max) throw new HttpError(400, k + ' is too long (at most ' + max + ' characters)');
    doc[k] = v;
  }
  if (!doc.name.trim()) throw new HttpError(400, 'name is required');
  if ('spec' in body) {
    if (!isPlainObject(body.spec)) throw new HttpError(400, 'spec must be an object');
    if (new TextEncoder().encode(JSON.stringify(body.spec)).byteLength > MAX_SPEC_BYTES) throw new HttpError(413, 'spec too large');
    doc.spec = body.spec;
  }
  if ('revealed' in body) {
    if (typeof body.revealed !== 'boolean') throw new HttpError(400, 'revealed must be true or false');
    doc.revealed = body.revealed;
  }
  if ('firstSeen' in body && body.firstSeen !== null) {
    if (typeof body.firstSeen !== 'string' || body.firstSeen.length > 40 || (body.firstSeen && !Number.isFinite(Date.parse(body.firstSeen)))) {
      throw new HttpError(400, 'firstSeen must be an ISO time or null');
    }
    doc.firstSeen = body.firstSeen || null;
  }
  if ('tags' in body) {
    if (!Array.isArray(body.tags) || body.tags.length > MAX_TAGS) throw new HttpError(400, 'tags must be a list of at most ' + MAX_TAGS + ' strings');
    for (const t of body.tags) if (typeof t !== 'string' || !t.trim() || t.length > MAX_TAG) throw new HttpError(400, 'a tag must be a short, non-empty string');
    doc.tags = body.tags.map((t) => t.trim());
  }
  if ('v' in body) {
    if (body.v !== 1) throw new HttpError(400, 'unknown version');
    doc.v = 1;
  }
  return doc;
}

export function checkNpcId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new HttpError(400, 'bad id');
  return id;
}

/** A new id for POST: npc_ + time + random, within ID_RE. */
export function newNpcId() {
  const rnd = crypto.getRandomValues(new Uint8Array(4));
  return 'npc_' + Date.now().toString(36) + Array.from(rnd, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function isGm(me) { return !!me && me.role === 'gm'; }

/** Parse a stored row's doc (an object, else {}). */
export function parseNpc(row) {
  try {
    const d = JSON.parse(row.doc);
    return isPlainObject(d) ? d : {};
  } catch (_) {
    return {};
  }
}

/** What a player may see of a document: nothing unless it is revealed, and never `gmNotes`. */
export function playerView(doc) {
  if (!doc || doc.revealed !== true) return null;
  const { gmNotes: _hidden, ...rest } = doc;
  return rest;
}

/** The document as `me` may see it: the GM's whole, a player's playerView (or null). */
export function viewFor(me, doc) {
  return isGm(me) ? doc : playerView(doc);
}

export async function loadNpcRow(db, id) {
  return db
    .prepare('SELECT id, campaign, created_at, updated_at, deleted, doc FROM npcs WHERE id = ?1')
    .bind(id)
    .first();
}

export function isLiveNpc(row, campaign) {
  return !!row && row.campaign === campaign && !row.deleted;
}

/** The newest updated_at over every row of the campaign, tombstones included (the adapter's cheap change stamp). */
export async function npcsUpdatedAt(db, campaign) {
  const row = await db.prepare('SELECT MAX(updated_at) AS at FROM npcs WHERE campaign = ?1').bind(campaign).first();
  return row && row.at ? row.at : null;
}

/**
 * The live NPCs of a campaign as the caller may see them: [{ id, doc, updatedAt }], newest change
 * first. For a player the filter is in the query (revealed only) and again on each parsed
 * document; hidden rows and `gmNotes` never leave the server.
 */
export async function listNpcs(db, campaign, me) {
  const sql = 'SELECT id, updated_at, doc FROM npcs WHERE campaign = ?1 AND deleted = 0' +
    (isGm(me) ? '' : " AND json_extract(doc, '$.revealed') = 1") +
    ' ORDER BY updated_at DESC LIMIT ' + MAX_NPCS;
  const { results } = await db.prepare(sql).bind(campaign).all();
  const out = [];
  for (const r of results || []) {
    const doc = viewFor(me, parseNpc(r));
    if (doc) out.push({ id: r.id, doc, updatedAt: r.updated_at });
  }
  return out;
}

function serialize(doc) {
  const text = JSON.stringify(doc);
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new HttpError(413, 'document too large');
  return text;
}

/**
 * Read-modify-write loop. `build(row, now)` gets the current row (null when none) and the stamp,
 * and returns the new document (throwing HttpError to refuse). A tombstoned id counts as free.
 * The write only lands when the row is unchanged since it was read; otherwise retry.
 */
export async function writeNpc(db, campaign, id, build) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row = await loadNpcRow(db, id);
    if (row && row.campaign !== campaign) throw new HttpError(403, 'this id belongs to another campaign');
    const now = nowIso(row && row.updated_at);
    const doc = build(row, now);
    const text = serialize(doc);
    const createdAt = typeof doc.createdAt === 'string' && doc.createdAt ? doc.createdAt : now;
    let result;
    if (row) {
      result = await db
        .prepare(
          `UPDATE npcs SET created_at = ?1, updated_at = ?2, deleted = 0, doc = ?3
           WHERE id = ?4 AND campaign = ?5 AND updated_at = ?6 AND deleted = ?7`
        )
        .bind(createdAt, now, text, id, campaign, row.updated_at, row.deleted)
        .run();
    } else {
      result = await db
        .prepare(
          `INSERT INTO npcs (id, campaign, created_at, updated_at, deleted, doc)
           VALUES (?1, ?2, ?3, ?4, 0, ?5) ON CONFLICT(id) DO NOTHING`
        )
        .bind(id, campaign, createdAt, now, text)
        .run();
    }
    if (result && result.meta && result.meta.changes > 0) return doc;
  }
  throw new HttpError(409, 'the NPC changed while saving, try again');
}

export async function tombstoneNpc(db, campaign, id) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row = await loadNpcRow(db, id);
    if (!isLiveNpc(row, campaign)) throw new HttpError(404, 'not found');
    const now = nowIso(row.updated_at);
    const result = await db
      .prepare(
        `UPDATE npcs SET deleted = 1, doc = '{}', updated_at = ?1
         WHERE id = ?2 AND campaign = ?3 AND updated_at = ?4 AND deleted = 0`
      )
      .bind(now, id, campaign, row.updated_at)
      .run();
    if (result && result.meta && result.meta.changes > 0) return;
  }
  throw new HttpError(409, 'the NPC changed while deleting, try again');
}
