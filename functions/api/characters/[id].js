// /api/characters/:id
//   GET    -> { id, doc }            404 when missing or deleted
//   PUT    body = whole doc          create or replace -> { id, doc }
//   PATCH  body = partial doc        deep merge into the stored doc -> { id, doc }
//   DELETE                           tombstone -> { ok: true }

import { getDb } from '../../_lib/db.js';
import { HttpError, json, methodNotAllowed, readJsonObject, deepMerge, campaignOf } from '../../_lib/http.js';
import { FORBIDDEN, checkId, loadRow, isLive, parseDoc, canChange, writeDoc, tombstone } from '../../_lib/characters.js';
import { pokeLive } from '../../_lib/live.js';

export async function onRequest({ request, env, params, data, waitUntil }) {
  const method = request.method;
  if (!['GET', 'PUT', 'PATCH', 'DELETE'].includes(method)) return methodNotAllowed(['GET', 'PUT', 'PATCH', 'DELETE']);
  const id = checkId(params.id);
  const me = data.me;
  const campaign = campaignOf(env);
  const db = await getDb(env);

  if (method === 'GET') {
    const row = await loadRow(db, id);
    if (!isLive(row, campaign)) throw new HttpError(404, 'not found');
    return json({ id, doc: parseDoc(row) });
  }

  if (method === 'DELETE') {
    await tombstone(db, campaign, id, me);
    pokeLive({ env, waitUntil }, ['characters']);
    return json({ ok: true });
  }

  const body = await readJsonObject(request);

  if (method === 'PUT') {
    const doc = await writeDoc(db, campaign, id, (row, now) => {
      const next = { ...body };
      if (row && !row.deleted) {
        // replace: a player must own the row; the stored owner is kept
        if (!canChange(me, row)) throw new HttpError(403, FORBIDDEN);
        next.owner = row.owner;
        if (typeof next.createdAt !== 'string' || !next.createdAt) next.createdAt = row.created_at;
      } else {
        // create (a tombstoned id counts as free)
        if (me.role !== 'gm' || next.owner === undefined) next.owner = me.id;
        if (typeof next.createdAt !== 'string' || !next.createdAt) next.createdAt = now;
      }
      next.updatedAt = now;
      return next;
    });
    pokeLive({ env, waitUntil }, ['characters']);
    return json({ id, doc });
  }

  // PATCH
  const doc = await writeDoc(db, campaign, id, (row, now) => {
    if (!row || row.deleted) throw new HttpError(404, 'not found');
    if (!canChange(me, row)) throw new HttpError(403, FORBIDDEN);
    const next = deepMerge(parseDoc(row), body);
    next.owner = row.owner;
    if (typeof next.createdAt !== 'string' || !next.createdAt) next.createdAt = row.created_at;
    next.updatedAt = now;
    return next;
  });
  pokeLive({ env, waitUntil }, ['characters']);
  return json({ id, doc });
}
