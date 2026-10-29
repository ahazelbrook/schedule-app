// /api/gm/state (GM only, see GM.md): the GM state document (live controls, history, pins, capture, bargains owed).
// Stored as the `campaigns` row `<CAMPAIGN>#gm` (functions/_lib/gm.js says why it has its own write loop). Never part of
// /api/export. A player gets 403 on every method, before the body is read.
//   GET            -> { doc, updatedAt }   ({} and null while none is stored)
//   PATCH  patch   -> { doc, updatedAt }   deep merge: plain objects (maps) merge, arrays and scalars replace,
//                                          null deletes the key. The patch and the stored document are each at most
//                                          256 KiB (413); a write that keeps colliding is 409.

import { getDb } from '../../_lib/db.js';
import { json, methodNotAllowed, readJsonObject, campaignOf } from '../../_lib/http.js';
import { LIMITS, requireGm, loadState, patchState } from '../../_lib/gm.js';
import { closeLive, pokeLive } from '../../_lib/live.js';

const METHODS = ['GET', 'PATCH'];

export async function onRequest({ request, env, data, waitUntil }) {
  requireGm(data);
  const method = request.method;
  if (!METHODS.includes(method)) return methodNotAllowed(METHODS);
  const campaign = campaignOf(env);
  if (method === 'GET') {
    const db = await getDb(env);
    const { doc, updatedAt } = await loadState(db, campaign);
    return json({ doc, updatedAt });
  }
  const patch = await readJsonObject(request, LIMITS.state);
  const db = await getDb(env);
  const meta = {};
  const out = await patchState(db, campaign, patch, meta);
  if (meta.liveOff) closeLive({ env, waitUntil });   // only on the flip to off (design 2.5): the sockets close server-side too
  if (meta.mirrorFlip) pokeLive({ env, waitUntil }, ['screen']);   // the phones' mirror switch flipped (MM1): their screenSeq moves, so they poll at once
  return json(out);
}
