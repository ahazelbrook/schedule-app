// The write-time checks of the show contract (functions/_lib/show.js): run by PATCH /api/gm/ambient on a brief beat or a layer, after the
// shape checks and before anything is stored. Changes nothing in the database. The read-time join (joinShows) checks again on every poll.
import { HttpError } from './http.js';
import { namesHit, loadHiddenNames } from './gm.js';
import { SHOW_KINDS, isShowKind, npcIdsOf, showTexts, revealedCards } from './show.js';

const NONE = 'names no NPC the players have met';

/**
 * `ov`: a cleaned overlay (any kind; only show kinds are checked), `layer`: a cleaned { path, value } (or null). Mutates them:
 *   - free text that names, as a whole word in any case, a hidden clock or an NPC who is not revealed: 400;
 *   - an NPC who is hidden, missing, deleted or another campaign's is DROPPED from the ids; if none is left: 400 (the same words for
 *     every cause, so the answer says nothing about a hidden row).
 */
export async function vetShow(db, campaign, ov, layer) {
  const show = ov && isShowKind(ov.kind) ? ov : null;
  const lay = layer && layer.value !== null ? layer : null;
  if (!show && !lay) return;
  const texts = showTexts(show, lay);
  if (texts.length) {
    const hidden = await loadHiddenNames(db, campaign);
    if (texts.some((t) => namesHit(t, hidden))) throw new HttpError(400, 'a show names something the players must not see');
  }
  const wanted = npcIdsOf(show, lay);
  if (!wanted.length) return;
  const ok = await revealedCards(db, campaign, wanted, false);
  const keep = (id) => !!ok[id];
  if (show) {
    const p = show.payload, how = SHOW_KINDS[show.kind].npc;
    if (how === 'list') { p.npcIds = p.npcIds.filter(keep); if (!p.npcIds.length) throw new HttpError(400, 'overlay.payload ' + NONE); }
    if (how === 'one' && !keep(p.npcId)) throw new HttpError(400, 'overlay.payload ' + NONE);
  }
  if (lay) {
    if (lay.path === 'band.faces') lay.value = lay.value.filter((f) => !f.npcId || keep(f.npcId));
    else if (lay.path === 'data.credits' || lay.path === 'data.previously') lay.value = lay.value.filter(keep);
    if (Array.isArray(lay.value) && !lay.value.length) throw new HttpError(400, 'layer ' + NONE);
  }
}
