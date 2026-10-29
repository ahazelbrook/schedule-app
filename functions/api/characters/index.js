// GET /api/characters            -> { now, docs }: every live character, newest first, at most 500
// GET /api/characters?since=ISO  -> { now, docs }: every row changed after `since`, tombstones
//                                   included ({ deleted: true, doc: null })
// Both also carry campaignUpdatedAt and npcsUpdatedAt (ISO or null), so the adapter knows when to
// refetch /api/campaign and /api/npcs without polling them separately, and `live`: the live-sync switch (the GM state
// document's `live`; true unless the GM turned it off), so a page learns of a flip in the poll it already makes, and `screenSeq` (MM1): the
// table display's seq while the phones' mirror is on and the display is a map or a handout, else 0 (a number only; the picture is
// GET /api/table/screen).

import { getDb } from '../../_lib/db.js';
import { HttpError, json, methodNotAllowed, campaignOf } from '../../_lib/http.js';
import { campaignStamp } from '../../_lib/live.js';
import { npcsUpdatedAt } from '../../_lib/npcs.js';

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
  // campaignStamp: the campaign's updated_at, the live-sync switch (design 2.5) and the table screen's seq (MM1) in one read, so they add no call to the poll
  const [{ results }, stamp, npcsAt] = await Promise.all([stmt.all(), campaignStamp(db, campaign), npcsUpdatedAt(db, campaign)]);
  return json({ now, docs: (results || []).map(toEntry), campaignUpdatedAt: stamp.at, npcsUpdatedAt: npcsAt, live: stamp.live, screenSeq: stamp.screenSeq });
}
