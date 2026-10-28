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
//   overlay null | { id (at most 40), kind clock|npc|fx|text, ms 1000-180000, auto?, ... }  something laid over the iPad without replacing it:
//             clock { clockId } (400 unless that clock exists and is not hidden; only the id is stored: the display GET joins the name, size
//             and live fill when it is read, and a name, size or fill the caller sends is dropped), npc { npcId } (400 unless that NPC is revealed),
//             fx { fx: 'dawn' }, text { text (at most 120); 400 when it names, as a whole word in any case, a hidden clock or an NPC who is
//             not revealed, by name or alias }; replaces, null removes, `at` is set here
//   auto true | false | null   the iPad's AUTO chip. Sent beside an overlay (or as overlay.auto: true) it also marks that overlay as the
//             autopilot's, which is refused with 409 while the display is in lights out, and which the display never draws over black
//   ifOverlay "<overlay id>"   beside `overlay: null` only (else 400): clear the overlay only while the stored one still has that id. If it
//             does not (it ended, or another was set meanwhile) nothing is written, seq does not move, and the answer is the stored
//             document with `unchanged: true`. The autopilot clears its own overlay this way.
// The stored document is at most 1.4 MiB.

import { getDb } from '../../_lib/db.js';
import { json, methodNotAllowed, readJsonObject, campaignOf, HttpError } from '../../_lib/http.js';
import { LIMITS, requireGm, cleanAmbientPatch, loadAmbient, patchAmbient, cleanIfOverlay, loadDisplayKind, loadHiddenNames, namesHit } from '../../_lib/gm.js';
import { assertRevealedNpc } from '../../_lib/npcs.js';
import { assertOverlayClock } from '../../_lib/campaign.js';
import { pokeLive } from '../../_lib/live.js';

const METHODS = ['GET', 'PATCH'];

export async function onRequest({ request, env, data, waitUntil }) {
  requireGm(data);
  const method = request.method;
  if (!METHODS.includes(method)) return methodNotAllowed(METHODS);
  const campaign = campaignOf(env);
  if (method === 'GET') {
    const db = await getDb(env);
    return json(await loadAmbient(db, campaign));
  }
  const raw = await readJsonObject(request, LIMITS.ambientRequest);
  const patch = cleanAmbientPatch(raw);
  const ifOverlay = cleanIfOverlay(raw, patch);
  const db = await getDb(env);
  const ov = patch.overlay;
  if (ov) {
    // an overlay sent with `auto: true` is the autopilot's: it is marked on the overlay itself (the display keeps it off a blacked-out screen too)
    if (patch.auto === true) ov.auto = true;
    // nothing the autopilot sends lights a blacked-out screen: refused while the display is in lights out (a GM-pressed overlay, the dawn, is not)
    if (ov.auto === true && (await loadDisplayKind(db, campaign)) === 'dark') throw new HttpError(409, 'the iPad is in lights out');
    // an npc overlay only for a revealed NPC, a clock overlay only for a clock the players can see: checked before anything is stored, so a
    // refusal changes nothing. Neither stores anything of the NPC or the clock: the display GET joins them to their rows when it is read.
    if (ov.kind === 'npc') await assertRevealedNpc(db, campaign, ov.npcId);
    if (ov.kind === 'clock') await assertOverlayClock(db, campaign, ov.clockId);
    // free text is checked for what it names: 400 when it holds, as a whole word in any case, the name of a hidden clock or the name or alias of
    // an NPC who is not revealed (one batch of two reads, only here, only for a text overlay; the GM page scans too, this is the server's own check)
    if (ov.kind === 'text' && namesHit(ov.text, await loadHiddenNames(db, campaign))) throw new HttpError(400, 'overlay.text names something the players must not see');
  }
  const out = await patchAmbient(db, campaign, patch, { ifOverlay });
  if (!out.unchanged) pokeLive({ env, waitUntil }, ['ambient']);       // a compare-and-swap that found another overlay wrote nothing: nothing to tell
  return json(out);
}
