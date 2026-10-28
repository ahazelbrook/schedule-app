// /api/npcs/:id (CAST.md)
//   GET     -> { id, doc }   404 when missing, deleted, or (for a player) not revealed; a player's
//                            copy never carries `gmNotes`
//   PUT     body = whole NPC doc   GM only, create or replace -> { id, doc }
//   PATCH   body = partial doc     GM only, deep merge into the stored doc -> { id, doc }
//   DELETE                         GM only, tombstone -> { ok: true }
// Every write is 403 for a player. The doc is validated (checkNpc): known fields, lengths, types.

import { getDb } from '../../_lib/db.js';
import { HttpError, json, methodNotAllowed, readJsonObject, deepMerge, campaignOf } from '../../_lib/http.js';
import { GM_ONLY_NPC, checkNpc, checkNpcId, isGm, isLiveNpc, loadNpcRow, parseNpc, tombstoneNpc, viewFor, writeNpc } from '../../_lib/npcs.js';
import { pokeLive } from '../../_lib/live.js';

export async function onRequest({ request, env, params, data, waitUntil }) {
  const method = request.method;
  if (!['GET', 'PUT', 'PATCH', 'DELETE'].includes(method)) return methodNotAllowed(['GET', 'PUT', 'PATCH', 'DELETE']);
  const id = checkNpcId(params.id);
  const me = data.me;
  const campaign = campaignOf(env);

  if (method === 'GET') {
    const db = await getDb(env);
    const row = await loadNpcRow(db, id);
    const doc = isLiveNpc(row, campaign) ? viewFor(me, parseNpc(row)) : null;
    if (!doc) throw new HttpError(404, 'not found');   // a hidden NPC reads exactly like a missing one
    return json({ id, doc });
  }

  if (!isGm(me)) throw new HttpError(403, GM_ONLY_NPC);
  const db = await getDb(env);

  if (method === 'DELETE') {
    await tombstoneNpc(db, campaign, id);
    pokeLive({ env, waitUntil }, ['npcs']);
    return json({ ok: true });
  }

  const body = await readJsonObject(request);

  if (method === 'PUT') {
    const doc = await writeNpc(db, campaign, id, (row, now) => ({
      ...checkNpc(body),
      createdAt: row && !row.deleted ? row.created_at : now,
      updatedAt: now,
    }));
    pokeLive({ env, waitUntil }, ['npcs']);
    return json({ id, doc });
  }

  // PATCH
  const doc = await writeNpc(db, campaign, id, (row, now) => {
    if (!isLiveNpc(row, campaign)) throw new HttpError(404, 'not found');
    return { ...checkNpc(deepMerge(parseNpc(row), body)), createdAt: row.created_at, updatedAt: now };
  });
  pokeLive({ env, waitUntil }, ['npcs']);
  return json({ id, doc });
}
