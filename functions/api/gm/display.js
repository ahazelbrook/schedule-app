// /api/gm/display (GM only, see GM.md): what the table's display shows. The GM may GET and PUT; the table display
// sign-in (role 'display', DISPLAY_EMAILS) may GET only. Never part of /api/export. A player gets 403 on every method,
// before the body is read.
//   GET            -> { seq, display, updatedAt, ambient: { seq, doc, updatedAt }, stt: { seq, want, session } }
//                     (The ambient overlay is served live: left out once the server's clock passes its at + ms, else with `age`, the whole
//                     ms since the server set `at`; response only, nothing is written. An overlay the autopilot sent (`auto: true`) is left out
//                     while the display is in lights out. An npc overlay is joined to its row now: it gains `npc` (name, alias, role, faction,
//                     spec: nothing else) while that NPC is revealed, and is left out otherwise. GM.md, "Overlays".
//                     seq 0 and a blank display while none is stored. The ambient document, GM.md "Ambient scenes" and
//                     functions/api/gm/ambient.js, rides along because the display sign-in may not call /api/gm/ambient.
//                     So does what the iPad needs of the transcriber, so that one poll does the work of two (GM.md "Listening"):
//                     `want` ('on' | 'off': the GM wants it listening) and `session` (the number to stamp on its lines), and
//                     nothing else: never a speaker name, the iPad's own status, the PC's heartbeat or a transcript line. Its
//                     `seq` is made from those two values alone, see sttPartOf in functions/_lib/stt.js.)
//   GET ?seq=N     -> { seq, unchanged: true } while N is still the current seq (the oldest call: neither part is even read)
//   GET ?seq=N&aseq=M
//                  -> the call of a display page from before the transcriber rode along, answered as it always was and without
//                     `stt`: both current: { seq, unchanged: true, ambient: { seq, unchanged: true } }, else the full display
//                     with ambient { seq, unchanged: true } when M is current, else in full
//   GET ?seq=N&aseq=M&sseq=K
//                  -> the same with the transcriber part named too: each part comes as { seq, unchanged: true } when its number
//                     is the one given, else in full; all three current: { seq, unchanged: true, ambient, stt }, else the full
//                     display along with them. A part whose number is not given counts as stale (`?aseq=M` alone, `?sseq=K` alone).
//   PUT  display   -> { seq, display, updatedAt }: replaces the display and bumps seq. With ifSeq (a whole number) only while the
//                     display is still at that seq, else 409 and nothing changes (the GM page's live reveal; GM.md "Location")
// display: { kind: 'blank' | 'dark' | 'svg' | 'npc' | 'text' | 'rule' | 'cards' | 'handout', title?, caption? } plus `file` + `showTitle`
// (handout: a plain image file name in the static folder media/handouts/), `svg` (a player-safe
// render: starts with <svg, at most 600 KiB, no <script, <foreignObject, javascript:, on...= attributes, or href / src /
// url() other than a #fragment or a data:image/ URI), `npcId` (an id), `text`, or `md` (a rules entry's Markdown, at most
// 40000 characters; the display renders it escaped, with no links). blank: nothing spotlit, the ambient scene plays;
// dark: lights out. title, caption and text: at most 2000 characters. Other keys are dropped. A malformed display is
// 400, a size over a cap 413.

import { getDb } from '../../_lib/db.js';
import { json, methodNotAllowed, readJsonObject, campaignOf, HttpError } from '../../_lib/http.js';
import { LIMITS, requireGm, cleanDisplay, loadDisplay, putDisplay, loadAmbient, liveAmbient } from '../../_lib/gm.js';
import { joinOverlayNpc } from '../../_lib/npcs.js';
import { loadSttPart } from '../../_lib/stt.js';

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
    const seq = q.get('seq'), aseq = q.get('aseq'), sseq = q.get('sseq');
    const cur = await loadDisplay(db, campaign);
    const same = seq !== null && seq === String(cur.seq);
    // the ambient part as served: the overlay left out once the server's clock passes its end, or while the display is in lights out and
    // the autopilot sent it; an npc overlay joined to its row now (one read by primary key) or left out when that NPC is not revealed
    const liveAmb = async () => joinOverlayNpc(db, campaign, liveAmbient(await loadAmbient(db, campaign), Date.now(), cur.display && cur.display.kind));
    if (aseq === null && sseq === null) {
      if (same) return json({ seq: cur.seq, unchanged: true });   // the oldest call: neither the ambient nor the transcriber is even read
      return json({ ...cur, ambient: (await liveAmb()).amb, stt: await loadSttPart(db, campaign) });
    }
    const { amb, dropped } = await liveAmb();
    // an overlay left out because its NPC is hidden is news even when the ambient seq is the one the display holds: send it in full
    const ambSame = aseq === String(amb.seq) && !dropped;
    const ambient = ambSame ? { seq: amb.seq, unchanged: true } : amb;
    if (sseq === null) {   // a display page from before the transcriber rode along: what it always got, so it never pulls the full display each time
      return json(same && ambSame ? { seq: cur.seq, unchanged: true, ambient } : { ...cur, ambient });
    }
    const st = await loadSttPart(db, campaign);
    const sttSame = sseq === String(st.seq);
    const stt = sttSame ? { seq: st.seq, unchanged: true } : st;
    if (same && ambSame && sttSame) return json({ seq: cur.seq, unchanged: true, ambient, stt });
    return json({ ...cur, ambient, stt });
  }
  const raw = await readJsonObject(request, LIMITS.displayRequest);
  let ifSeq;
  if ('ifSeq' in raw) {
    if (!Number.isInteger(raw.ifSeq) || raw.ifSeq < 0) throw new HttpError(400, 'ifSeq must be a whole number');
    ifSeq = raw.ifSeq;
  }
  const display = cleanDisplay(raw);
  const db = await getDb(env);
  return json(await putDisplay(db, campaign, display, ifSeq));
}
