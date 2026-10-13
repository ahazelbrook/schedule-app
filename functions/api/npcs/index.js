// /api/npcs: the cast (CAST.md).
//   GET   -> { now, docs: [ { id, doc, updatedAt } ], npcsUpdatedAt }
//            the GM gets every live NPC; a player only the revealed ones, without `gmNotes`
//            (filtered here, in the query: hidden data is never sent)
//   POST  body = NPC doc (GM only) -> { id, doc }: a new id is made; 403 for a player
// An NPC document: { name, alias, role, faction, description, spec, revealed, firstSeen, tags, gmNotes }.

import { getDb } from '../../_lib/db.js';
import { HttpError, json, methodNotAllowed, readJsonObject, campaignOf } from '../../_lib/http.js';
import { GM_ONLY_NPC, checkNpc, isGm, listNpcs, newNpcId, npcsUpdatedAt, writeNpc } from '../../_lib/npcs.js';

export async function onRequest({ request, env, data }) {
  const method = request.method;
  if (method !== 'GET' && method !== 'POST') return methodNotAllowed(['GET', 'POST']);
  const me = data.me;
  const campaign = campaignOf(env);

  if (method === 'POST') {
    if (!isGm(me)) throw new HttpError(403, GM_ONLY_NPC);
    const body = await readJsonObject(request);
    const db = await getDb(env);
    const id = newNpcId();
    const doc = await writeNpc(db, campaign, id, (_row, now) => ({ ...checkNpc(body), createdAt: now, updatedAt: now }));
    return json({ id, doc });
  }

  const db = await getDb(env);
  const now = new Date(Date.now() - 2000).toISOString();
  const [docs, at] = await Promise.all([listNpcs(db, campaign, me), npcsUpdatedAt(db, campaign)]);
  return json({ now, docs, npcsUpdatedAt: at });
}
