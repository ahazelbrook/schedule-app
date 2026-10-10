// GET /api/characters            -> { now, docs }: every live character, newest first, at most 500
// GET /api/characters?since=ISO  -> { now, docs }: every row changed after `since`, tombstones
//                                   included ({ deleted: true, doc: null })
// Both also carry campaignUpdatedAt (ISO or null), so the adapter knows when to refetch
// /api/campaign without polling it separately.

import { getDb } from '../../_lib/db.js';
import { HttpError, json, methodNotAllowed, campaignOf } from '../../_lib/http.js';
import { campaignUpdatedAt } from '../../_lib/campaign.js';

// `now` is reported this far in the past so a write stamped just before a poll but
// committed just after it is still picked up by the next poll. Rows changed inside the
// window may be delivered twice; applying a row is idempotent on the client.
export const SINCE_OVERLAP_MS = 2000;

function toEntry(row) {
  if (row.deleted) return { id: row.id, doc: null, updatedAt: row.updated_at, deleted: true };
  let doc = {};
  try { doc = JSON.parse(row.doc); } catch (_) { /* keep {} */ }
  return { id: row.id, doc, updatedAt: row.updated_at, deleted: false };
}

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return methodNotAllowed(['GET']);
  const campaign = campaignOf(env);
  const db = await getDb(env);
  const url = new URL(request.url);
  const sinceRaw = url.searchParams.get('since');
  const now = new Date(Date.now() - SINCE_OVERLAP_MS).toISOString();

  let stmt;
  if (sinceRaw !== null && sinceRaw !== '') {
    const t = Date.parse(sinceRaw);
    if (!Number.isFinite(t)) throw new HttpError(400, 'bad since');
    const since = new Date(t).toISOString();
    stmt = db
      .prepare(
        `SELECT id, updated_at, deleted, doc FROM characters
         WHERE campaign = ?1 AND updated_at > ?2 ORDER BY updated_at DESC`
      )
      .bind(campaign, since);
  } else {
    stmt = db
      .prepare(
        `SELECT id, updated_at, deleted, doc FROM characters
         WHERE campaign = ?1 AND deleted = 0 ORDER BY updated_at DESC LIMIT 500`
      )
      .bind(campaign);
  }
  const [{ results }, campaignAt] = await Promise.all([stmt.all(), campaignUpdatedAt(db, campaign)]);
  return json({ now, docs: (results || []).map(toEntry), campaignUpdatedAt: campaignAt });
}
