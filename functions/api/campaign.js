// /api/campaign: the shared campaign document of this deployment (env.CAMPAIGN), see CAMPAIGN.md.
//   GET    -> { doc, updatedAt }   the default document and updatedAt null when none is stored yet
//   PUT    body = whole doc        GM only -> { doc, updatedAt }
//   PATCH  body = partial doc      deep merge (objects merge, arrays and scalars replace, null
//                                  deletes), except `log`, whose entries are added (mergeLog);
//                                  a player may only change what playerMayWrite allows
//                                  -> { doc, updatedAt }
// `crew` and `session` in a body must be plain objects (400).
// The server stamps doc.updatedAt and keeps the newest LOG_MAX log entries.

import { getDb } from '../_lib/db.js';
import { HttpError, json, methodNotAllowed, readJsonObject, deepMerge, campaignOf } from '../_lib/http.js';
import { GM_ONLY, loadCampaignRow, campaignDoc, writeCampaign, playerMayWrite, mergeLog, checkShape } from '../_lib/campaign.js';

export async function onRequest({ request, env, data }) {
  const method = request.method;
  if (!['GET', 'PUT', 'PATCH'].includes(method)) return methodNotAllowed(['GET', 'PUT', 'PATCH']);
  const me = data.me;
  const gm = me.role === 'gm';
  const id = campaignOf(env);
  const db = await getDb(env);

  if (method === 'GET') {
    const row = await loadCampaignRow(db, id);
    return json({ doc: campaignDoc(row), updatedAt: row ? row.updated_at : null });
  }

  if (method === 'PUT' && !gm) throw new HttpError(403, GM_ONLY);
  const body = await readJsonObject(request);
  checkShape(body);

  const doc = await writeCampaign(db, id, (current) => {
    if (method === 'PUT') return { ...body };
    const { log, ...rest } = body;
    const next = deepMerge(current, rest);
    if (!gm && !playerMayWrite(current, next)) throw new HttpError(403, GM_ONLY);
    if ('log' in body) next.log = mergeLog(current.log, log, gm);
    return next;
  });
  return json({ doc, updatedAt: doc.updatedAt });
}
