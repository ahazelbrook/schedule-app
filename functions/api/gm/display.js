// /api/gm/display (GM only, see GM.md): what the table's display (an iPad signed in as the GM) shows. Never part of
// /api/export. A player gets 403 on every method, before the body is read.
//   GET            -> { seq, display, updatedAt }   (seq 0 and a blank display while none is stored)
//   GET ?seq=N     -> { seq, unchanged: true } while N is still the current seq
//   PUT  display   -> { seq, display, updatedAt }: replaces the display and bumps seq
// display: { kind: 'blank' | 'svg' | 'npc' | 'text', title?, caption? } plus `svg` (a player-safe render: starts with <svg,
// at most 600 KiB, no <script, <foreignObject, javascript:, on...= attributes, or href / src / url() other than a
// #fragment or a data:image/ URI), `npcId` (an id) or `text`. title, caption and text: at most 2000 characters. Other
// keys are dropped. A malformed display is 400, a size over a cap 413.

import { getDb } from '../../_lib/db.js';
import { json, methodNotAllowed, readJsonObject, campaignOf } from '../../_lib/http.js';
import { LIMITS, requireGm, cleanDisplay, loadDisplay, putDisplay } from '../../_lib/gm.js';

const METHODS = ['GET', 'PUT'];

export async function onRequest({ request, env, data }) {
  requireGm(data);
  const method = request.method;
  if (!METHODS.includes(method)) return methodNotAllowed(METHODS);
  const campaign = campaignOf(env);
  if (method === 'GET') {
    const db = await getDb(env);
    const cur = await loadDisplay(db, campaign);
    const seq = new URL(request.url).searchParams.get('seq');
    if (seq !== null && seq === String(cur.seq)) return json({ seq: cur.seq, unchanged: true });
    return json(cur);
  }
  const display = cleanDisplay(await readJsonObject(request, LIMITS.displayRequest));
  const db = await getDb(env);
  return json(await putDisplay(db, campaign, display));
}
