// Character rows: reads, and writes with optimistic concurrency so two people editing
// the same character at once (a player and the GM) never silently clobber each other.

import { HttpError, ID_RE, MAX_BODY_BYTES, nowIso } from './http.js';

export const FORBIDDEN = 'you can only change characters you own';
const MAX_ATTEMPTS = 5;

export function checkId(id) {
  if (typeof id !== 'string' || !ID_RE.test(id)) throw new HttpError(400, 'bad id');
  return id;
}

export async function loadRow(db, id) {
  return db
    .prepare('SELECT id, campaign, owner, created_at, updated_at, deleted, doc FROM characters WHERE id = ?1')
    .bind(id)
    .first();
}

export function isLive(row, campaign) {
  return !!row && row.campaign === campaign && !row.deleted;
}

export function parseDoc(row) {
  try {
    const d = JSON.parse(row.doc);
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch (_) {
    return {};
  }
}

export function canChange(me, row) {
  return me.role === 'gm' || (row.owner != null && row.owner === me.id);
}

function serialize(doc) {
  const text = JSON.stringify(doc);
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new HttpError(413, 'document too large');
  return text;
}

function ownerColumn(owner) {
  return typeof owner === 'string' && owner ? owner : null;
}

/**
 * Read-modify-write loop. `build(row, now)` gets the current row (or null) and the
 * timestamp to stamp, checks permissions (throwing HttpError), and returns the new doc.
 * The write only lands when the row is unchanged since it was read; otherwise retry.
 */
export async function writeDoc(db, campaign, id, build) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row = await loadRow(db, id);
    if (row && row.campaign !== campaign) throw new HttpError(403, 'this id belongs to another campaign');
    const now = nowIso(row && row.updated_at);
    const doc = build(row, now);
    const text = serialize(doc);
    const createdAt = typeof doc.createdAt === 'string' && doc.createdAt ? doc.createdAt : now;
    let result;
    if (row) {
      result = await db
        .prepare(
          `UPDATE characters SET owner = ?1, created_at = ?2, updated_at = ?3, deleted = 0, doc = ?4
           WHERE id = ?5 AND campaign = ?6 AND updated_at = ?7 AND deleted = ?8`
        )
        .bind(ownerColumn(doc.owner), createdAt, now, text, id, campaign, row.updated_at, row.deleted)
        .run();
    } else {
      result = await db
        .prepare(
          `INSERT INTO characters (id, campaign, owner, created_at, updated_at, deleted, doc)
           VALUES (?1, ?2, ?3, ?4, ?5, 0, ?6) ON CONFLICT(id) DO NOTHING`
        )
        .bind(id, campaign, ownerColumn(doc.owner), createdAt, now, text)
        .run();
    }
    if (result && result.meta && result.meta.changes > 0) return doc;
  }
  throw new HttpError(409, 'the character changed while saving, try again');
}

export async function tombstone(db, campaign, id, me) {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row = await loadRow(db, id);
    if (!isLive(row, campaign)) throw new HttpError(404, 'not found');
    if (!canChange(me, row)) throw new HttpError(403, FORBIDDEN);
    const now = nowIso(row.updated_at);
    const result = await db
      .prepare(
        `UPDATE characters SET deleted = 1, doc = '{}', updated_at = ?1
         WHERE id = ?2 AND campaign = ?3 AND updated_at = ?4 AND deleted = 0`
      )
      .bind(now, id, campaign, row.updated_at)
      .run();
    if (result && result.meta && result.meta.changes > 0) return;
  }
  throw new HttpError(409, 'the character changed while deleting, try again');
}
