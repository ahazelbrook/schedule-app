// /api/campaign: the shared campaign document of this deployment (env.CAMPAIGN), see CAMPAIGN.md.
//   GET    -> { doc, updatedAt }   the default document and updatedAt null when none is stored yet
//   PUT    body = whole doc        GM only -> { doc, updatedAt }
//   PATCH  body = partial doc      deep merge (objects merge, arrays and scalars replace, null
//                                  deletes), except `log`, whose entries are added (mergeLog), and
//                                  `clockOps`, changes to single clocks applied to the clocks as
//                                  stored (applyClockOps); a player may only change what
//                                  playerMayWrite allows -> { doc, updatedAt }
// A player may also change their own `schedule.avail.<id>` and `schedule.rsvp.<id>` (SCHEDULE.md).
// `crew`, `session` and `schedule` in a body must be plain objects (400); `clockOps` must be well formed (400).
// A whole `clocks` array (how the previous release sends a tick) is still taken, but a player's that changes more than
// one clock's fill was copied before another device's tick, and is refused (412) rather than allowed to undo it.
// The server stamps doc.updatedAt, keeps the newest LOG_MAX log entries and gives every clock an id.

import { getDb } from '../_lib/db.js';
import { HttpError, json, methodNotAllowed, readJsonObject, deepMerge, campaignOf } from '../_lib/http.js';
import {
  GM_ONLY, STALE_CLOCKS, loadCampaignRow, campaignDoc, writeCampaign, playerMayWrite, mergeLog, checkShape,
  withClockIds, applyClockOps, changedFills,
} from '../_lib/campaign.js';

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
  if (method === 'PUT' && 'clockOps' in body) throw new HttpError(400, 'clockOps: only in a PATCH');

  // build runs on the row as stored, again on every attempt of the write loop: the ops land on the latest clocks
  const doc = await writeCampaign(db, id, (current) => {
    if (method === 'PUT') return { ...body };
    const { log, clockOps, ...rest } = body;
    const next = deepMerge(current, rest);
    const whole = Array.isArray(rest.clocks);
    if (whole) next.clocks = withClockIds(rest.clocks);
    if (clockOps !== undefined) next.clocks = applyClockOps(next.clocks, clockOps);
    if (!gm && !playerMayWrite(current, next, me.id)) throw new HttpError(403, GM_ONLY);
    if (!gm && whole && changedFills(current.clocks, rest.clocks) > 1) throw new HttpError(412, STALE_CLOCKS);
    if ('log' in body) next.log = mergeLog(current.log, log, gm);
    return next;
  });
  return json({ doc, updatedAt: doc.updatedAt });
}
