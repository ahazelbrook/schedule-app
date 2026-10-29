// /api/gm/display (GM only, see GM.md): what the table's display shows. The GM may GET and PUT; the table display
// sign-in (role 'display', DISPLAY_EMAILS) may GET only. Never part of /api/export. A player gets 403 on every method,
// before the body is read.
//   GET            -> { seq, display, updatedAt, ambient: { seq, doc, updatedAt }, stt: { seq, want, session } }
//                     (The overlay is served on its own, as a top-level `overlay` (the object, or null) on every answer but the oldest `?seq` only
//                     "unchanged" one, and also inside `ambient.doc` whenever that goes out in full. It is made on each poll from the stored
//                     overlay alone, so it reaches a display whose ambient seq is current while the big ambient part stays changed-only.
//                     It is served live: left out once the server's clock passes its at + ms, else with `age`, the whole
//                     ms since the server set `at`; response only, nothing is written. An overlay the autopilot sent (`auto: true`) is left out
//                     while the display is in lights out. An npc overlay is joined to its row now: it gains `npc` (name, alias, role, faction,
//                     spec: only the figure's drawing keys) while that NPC is revealed, and is left out otherwise. A clock overlay is joined to
//                     its clock now: it gains the clock's name, size and LIVE fill while the clock is present and not hidden, and is left out
//                     otherwise (so is a clock overlay of the old shape, with no clockId). GM.md, "Overlays".
//                     seq 0 and a blank display while none is stored. The ambient document, GM.md "Ambient scenes" and
//                     functions/api/gm/ambient.js, rides along because the display sign-in may not call /api/gm/ambient.
//                     So does what the iPad needs of the transcriber, so that one poll does the work of two (GM.md "Listening"):
//                     `want` ('on' | 'off': the GM wants it listening) and `session` (the number to stamp on its lines), and
//                     nothing else: never a speaker name, the iPad's own status, the PC's heartbeat or a transcript line. Its
//                     `seq` is made from those two values alone, see sttPartOf in functions/_lib/stt.js.)
//                     Every answer but the two older calls below also carries `live`: the live-sync switch (the GM state's `live`, true unless the
//                     GM turned it off; design 2.5), read in SQL as one small row, so a flip lands even when everything else is unchanged.
//   GET ?seq=N     -> { seq, unchanged: true } while N is still the current seq (the oldest call: neither part is even read; no `live`)
//   GET ?seq=N&aseq=M
//                  -> the call of a display page from before the transcriber rode along, answered as it always was and without
//                     `stt`: both current: { seq, unchanged: true, ambient: { seq, unchanged: true } }, else the full display
//                     with ambient { seq, unchanged: true } when M is current, else in full
//   GET ?seq=N&aseq=M&sseq=K
//                  -> the same with the transcriber part named too: each part comes as { seq, unchanged: true } when its number
//                     is the one given, else in full; all three current: { seq, unchanged: true, ambient, stt }, else the full
//                     display along with them. A part whose number is not given counts as stale (`?aseq=M` alone, `?sseq=K` alone).
//   GET ...&hseq=N -> any of the above, plus a top-level `mission` (the fourth part, the band beside the map): { hseq, hud } while the campaign
//                     document's mission.seq differs from N (hud is mission.hud as stored; no mission at all is { hseq: 0, hud: null }), else
//                     { hseq, unchanged: true }. Read in one statement, the same one as the live switch when that is read too (loadMissionPart in
//                     functions/_lib/campaign.js). Never the mission's cards. A call without hseq is answered as before, with no `mission`.
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
import { LIMITS, requireGm, cleanDisplay, loadDisplay, putDisplay, loadAmbient, loadAmbientLite, liveAmbient } from '../../_lib/gm.js';
import { joinOverlayNpc } from '../../_lib/npcs.js';
import { joinOverlayClock, loadMissionPart } from '../../_lib/campaign.js';
import { loadSttPart } from '../../_lib/stt.js';
import { liveFlag, mirrorFlag, pokeLive } from '../../_lib/live.js';

const METHODS = ['GET', 'PUT'];

export async function onRequest({ request, env, data, waitUntil }) {
  const method = request.method;
  // the table display sign-in (role 'display') may read what the GM pushed, nothing more; everyone else but the GM is refused first
  if (!(data && data.me && data.me.role === 'display' && method === 'GET')) requireGm(data);
  if (!METHODS.includes(method)) return methodNotAllowed(METHODS);
  const campaign = campaignOf(env);
  if (method === 'GET') {
    const db = await getDb(env);
    const q = new URL(request.url).searchParams;
    const seq = q.get('seq'), aseq = q.get('aseq'), sseq = q.get('sseq'), hseq = q.get('hseq');
    // THE FOURTH PART (?hseq=N, the mission's band): a top-level `mission` on any answer, only when the page asks. One statement; when the page also reads the
    // live switch it is the SAME statement (loadMissionPart), so a page that sends hseq makes no more D1 calls than one that does not. hud only, never the cards.
    const wantHud = hseq !== null;
    const withHud = (out, part) => (part ? { ...out, mission: part } : out);
    const tail = async (needLive) => {      // the live switch (when the call reads it) and the mission part (when asked), in one read
      if (wantHud) return loadMissionPart(db, campaign, hseq, needLive);
      return { part: undefined, live: needLive ? await liveFlag(db, campaign) : true };
    };
    const cur = await loadDisplay(db, campaign);
    const same = seq !== null && seq === String(cur.seq);
    // THE OVERLAY, served on its own: a small top-level `overlay` on every answer (null when none), made on each poll from the stored overlay
    // alone (the ambient row's overlay cut out in SQL, never the whole document): the server's expiry (left out once its clock passes at + ms,
    // else with `age`), lights out (an autopilot overlay is left out while the display is dark), an npc overlay joined to its row (name, alias,
    // role, faction, drawing keys of the spec) and a clock overlay to its clock (name, size and the LIVE fill), or left out when that NPC is not
    // revealed / that clock is hidden, gone or the old shape. One primary-key read each, only while such an overlay is up. So a hidden NPC or
    // clock, and a fill that moves, reach a display whose ambient seq is current without the big ambient part being sent or even parsed.
    const liveOverlay = async () => {
      const lite = await loadAmbientLite(db, campaign);
      const shell = { seq: lite.seq, doc: lite.overlay ? { overlay: lite.overlay } : {}, updatedAt: lite.updatedAt };
      const a = await joinOverlayNpc(db, campaign, liveAmbient(shell, Date.now(), cur.display && cur.display.kind));
      const b = await joinOverlayClock(db, campaign, a.amb);
      return { seq: lite.seq, overlay: b.amb.doc.overlay || null };
    };
    // the ambient part in full: the stored document with its overlay replaced by the served one (the same object the overlay field carries)
    const fullAmbient = async (ov) => {
      const amb = await loadAmbient(db, campaign), doc = { ...amb.doc };
      if (ov) doc.overlay = ov; else delete doc.overlay;
      return { ...amb, doc };
    };
    if (aseq === null && sseq === null) {
      if (same) return json(withHud({ seq: cur.seq, unchanged: true }, wantHud ? (await tail(false)).part : undefined));   // the oldest call: neither the ambient nor the transcriber is even read
      const [o, rest] = await Promise.all([liveOverlay(), tail(true)]);
      return json(withHud({ ...cur, ambient: await fullAmbient(o.overlay), overlay: o.overlay, stt: await loadSttPart(db, campaign), live: rest.live }, rest.part));
    }
    // the live-sync switch (design 2.5): one small read beside the overlay's, on every answer a page that knows the switch can send
    // (the ones with a transcriber seq, and the first full one); the seq-only call and the older ?aseq-only one stay as they were
    const [{ seq: aseqNow, overlay }, { live, part }] = await Promise.all([liveOverlay(), tail(sseq !== null)]);
    const ambSame = aseq === String(aseqNow);
    const ambient = ambSame ? { seq: aseqNow, unchanged: true } : await fullAmbient(overlay);
    if (sseq === null) {   // a display page from before the transcriber rode along: what it always got, so it never pulls the full display each time
      return json(withHud(same && ambSame ? { seq: cur.seq, unchanged: true, ambient, overlay } : { ...cur, ambient, overlay }, part));
    }
    const st = await loadSttPart(db, campaign);
    const sttSame = sseq === String(st.seq);
    const stt = sttSame ? { seq: st.seq, unchanged: true } : st;
    if (same && ambSame && sttSame) return json(withHud({ seq: cur.seq, unchanged: true, ambient, stt, overlay, live }, part));
    return json(withHud({ ...cur, ambient, stt, overlay, live }, part));
  }
  const raw = await readJsonObject(request, LIMITS.displayRequest);
  let ifSeq;
  if ('ifSeq' in raw) {
    if (!Number.isInteger(raw.ifSeq) || raw.ifSeq < 0) throw new HttpError(400, 'ifSeq must be a whole number');
    ifSeq = raw.ifSeq;
  }
  const display = cleanDisplay(raw);
  const db = await getDb(env);
  // the phones' table screen (MM1): read the mirror switch before the write, poke after it succeeded. Any change of the display pokes while the mirror is
  // on, not only a map or a handout, so a map that gives way to lights out (or anything else) leaves an open viewer at once instead of on the next
  // poll, which is 15 s apart while live sync is healthy. A poke is a kind and a time, so it carries nothing; the phones' poll then says screenSeq 0.
  const phones = await mirrorFlag(db, campaign);
  const out = await putDisplay(db, campaign, display, ifSeq);
  if (phones) pokeLive({ env, waitUntil }, ['display', 'screen']); else pokeLive({ env, waitUntil }, ['display']);
  return json(out);
}
