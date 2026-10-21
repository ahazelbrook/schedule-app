// /api/gm/ambient (GM only, see GM.md, "Ambient scenes", and docs/history/AMBIENT-PLAN.md): what plays on the table display when nothing is spotlit. Stored in
// `gm_ambient`; never part of /api/export. A player AND the table display sign-in get 403 on every method, before the body
// is read: the display reads this document only through GET /api/gm/display (its `ambient` key), not from here.
//   GET            -> { seq, doc, updatedAt }   (seq 0, {} and null while none is stored)
//   PATCH  patch   -> { seq, doc, updatedAt }   merge at the top level: a key replaces (playlist, crew and score as a
//                                               whole), null deletes it, `skip: true` adds one to doc.skip. seq goes up by one.
// patch (other keys are dropped; malformed is 400, too long or too large 413, a write that keeps colliding 409):
//   mode 'auto' | 'pin' | 'off'      scene (an id: harvest, watch, duskwall, board, exploded, testcard)
//   playlist [scene ids]  1 to 16, no repeats      intervalMin  whole number 3 to 30      skip  true
//   crew { heat 0-9, wanted 0-4 }    score null | { name, district, target (at most 200 characters each),
//                                                   reveal [public|working|controlled|secure], view 'plan'|'rings',
//                                                   board, iso (player-safe svgs, as for the display) } (`at` is set here)
//   wire null | [{ id, text }]   up to 6 in-world bulletins (text at most 240 characters) the display lays over the playing scene, one at a time
// The stored document is at most 1.4 MiB.

import { getDb } from '../../_lib/db.js';
import { json, methodNotAllowed, readJsonObject, campaignOf } from '../../_lib/http.js';
import { LIMITS, requireGm, cleanAmbientPatch, loadAmbient, patchAmbient } from '../../_lib/gm.js';

const METHODS = ['GET', 'PATCH'];

export async function onRequest({ request, env, data }) {
  requireGm(data);
  const method = request.method;
  if (!METHODS.includes(method)) return methodNotAllowed(METHODS);
  const campaign = campaignOf(env);
  if (method === 'GET') {
    const db = await getDb(env);
    return json(await loadAmbient(db, campaign));
  }
  const patch = cleanAmbientPatch(await readJsonObject(request, LIMITS.ambientRequest));
  const db = await getDb(env);
  return json(await patchAmbient(db, campaign, patch));
}
