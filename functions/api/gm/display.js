// /api/gm/display (GM only, see GM.md): what the table's display shows. The GM may GET and PUT; the table display
// sign-in (role 'display', DISPLAY_EMAILS) may GET only. Never part of /api/export. A player gets 403 on every method,
// before the body is read.
//   GET            -> { seq, display, updatedAt, ambient: { seq, doc, updatedAt } }
//                     (seq 0 and a blank display while none is stored; the ambient document, AMBIENT-PLAN.md and
//                     functions/api/gm/ambient.js, rides along because the display sign-in may not call /api/gm/ambient)
//   GET ?seq=N     -> { seq, unchanged: true } while N is still the current seq (the old call: the ambient is ignored)
//   GET ?seq=N&aseq=M
//                  -> both current: { seq, unchanged: true, ambient: { seq, unchanged: true } }
//                     otherwise the full display, with ambient = { seq, unchanged: true } when M is current, else the
//                     full { seq, doc, updatedAt }
//   PUT  display   -> { seq, display, updatedAt }: replaces the display and bumps seq
// display: { kind: 'blank' | 'dark' | 'svg' | 'npc' | 'text' | 'rule', title?, caption? } plus `svg` (a player-safe
// render: starts with <svg, at most 600 KiB, no <script, <foreignObject, javascript:, on...= attributes, or href / src /
// url() other than a #fragment or a data:image/ URI), `npcId` (an id), `text`, or `md` (a rules entry's Markdown, at most
// 40000 characters; the display renders it escaped, with no links). blank: nothing spotlit, the ambient scene plays;
// dark: lights out. title, caption and text: at most 2000 characters. Other keys are dropped. A malformed display is
// 400, a size over a cap 413.

import { getDb } from '../../_lib/db.js';
import { json, methodNotAllowed, readJsonObject, campaignOf } from '../../_lib/http.js';
import { LIMITS, requireGm, cleanDisplay, loadDisplay, putDisplay, loadAmbient } from '../../_lib/gm.js';

const METHODS = ['GET', 'PUT'];

export async function onRequest({ request, env, data }) {
  const method = request.method;
  // the table display sign-in (role 'display') may read what the GM pushed, nothing more; everyone else but the GM is refused first
  if (!(data && data.me && data.me.role === 'display' && method === 'GET')) requireGm(data);
  if (!METHODS.includes(method)) return methodNotAllowed(METHODS);
  const campaign = campaignOf(env);
  if (method === 'GET') {
    const db = await getDb(env);
    const q = new URL(request.url).searchParams;
    const seq = q.get('seq'), aseq = q.get('aseq');
    const cur = await loadDisplay(db, campaign);
    const same = seq !== null && seq === String(cur.seq);
    if (aseq === null) {
      if (same) return json({ seq: cur.seq, unchanged: true });   // an old client: the ambient is not even read
      return json({ ...cur, ambient: await loadAmbient(db, campaign) });
    }
    const amb = await loadAmbient(db, campaign);
    const ambSame = aseq === String(amb.seq);
    const ambient = ambSame ? { seq: amb.seq, unchanged: true } : amb;
    if (same && ambSame) return json({ seq: cur.seq, unchanged: true, ambient });
    return json({ ...cur, ambient });
  }
  const display = cleanDisplay(await readJsonObject(request, LIMITS.displayRequest));
  const db = await getDb(env);
  return json(await putDisplay(db, campaign, display));
}
