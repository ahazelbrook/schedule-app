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
// `mission` (what the players are shown of the Run view, see cleanMission) is the GM's: a PATCH by the GM replaces it whole, rebuilt field by field
// (400 for a bad shape, 422 naming the hit when a string holds a hidden clock's or NPC's name), null removes it, and the write pokes `display` as well as
// `campaign` so the iPad polls at once. A player's change under it is 403 (playerMayWrite). A PUT never changes it: the stored mission is kept and a
// `mission` in the body is ignored, so a whole-document save from a stale copy cannot put an old band back on the iPad.

import { getDb } from '../_lib/db.js';
import { HttpError, json, methodNotAllowed, readJsonObject, deepMerge, campaignOf } from '../_lib/http.js';
import {
  GM_ONLY, STALE_CLOCKS, loadCampaignRow, campaignDoc, writeCampaign, playerMayWrite, mergeLog, checkShape,
  withClockIds, applyClockOps, changedFills, cleanMission, missionHit, refuseMissionHit,
} from '../_lib/campaign.js';
import { pokeLive } from '../_lib/live.js';
import { loadHiddenNames } from '../_lib/gm.js';

export async function onRequest({ request, env, data, waitUntil }) {
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

  // the GM's mission: rebuilt and scanned once, before the write loop (which may run build again, and must not wait on the hidden-name read)
  const setsMission = gm && method === 'PATCH' && 'mission' in body;
  const mission = setsMission ? cleanMission(body.mission) : null;
  if (mission) {
    const hit = missionHit(mission, await loadHiddenNames(db, id));
    if (hit) refuseMissionHit(hit);
  }

  // build runs on the row as stored, again on every attempt of the write loop: the ops land on the latest clocks
  const doc = await writeCampaign(db, id, (current) => {
    if (method === 'PUT') {
      const { mission: _ignored, ...whole } = body;     // a PUT never changes the mission: the stored one stays
      if (current.mission !== undefined) whole.mission = current.mission;
      return whole;
    }
    const { log, clockOps, ...rest } = body;
    if (setsMission) delete rest.mission;
    const next = deepMerge(current, rest);
    const whole = Array.isArray(rest.clocks);
    if (whole) next.clocks = withClockIds(rest.clocks);
    if (clockOps !== undefined) next.clocks = applyClockOps(next.clocks, clockOps);
    if (!gm && !playerMayWrite(current, next, me.id)) throw new HttpError(403, GM_ONLY);
    if (!gm && whole && changedFills(current.clocks, rest.clocks) > 1) throw new HttpError(412, STALE_CLOCKS);
    if ('log' in body) next.log = mergeLog(current.log, log, gm);
    if (setsMission) { if (mission) next.mission = mission; else delete next.mission; }     // replaced whole: a deep merge would keep a card the page dropped
    return next;
  });
  if (setsMission) pokeLive({ env, waitUntil }, ['campaign', 'display']);     // the iPad polls for the band at once
  else pokeLive({ env, waitUntil }, ['campaign']);
  return json({ doc, updatedAt: doc.updatedAt });
}
