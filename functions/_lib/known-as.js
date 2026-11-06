// T15 "known as": an NPC the players know by one name only (say a surname), while the GM keeps the full name.
//
// The marker is no new field: an NPC document whose `tags` hold KNOWN_AS ('known-as', any case) and whose `alias` is not empty. The stored
// shape is unchanged, so an older build just shows the name and the quoted alias as it always did. The GM's own reads keep the whole
// document, because the prep, a site's timeline and the rooms' Who lines match cast rows by the exact name or alias: renaming the row would
// break those joins.
//
// Every road an NPC takes to a phone or the table iPad runs knownAs(), on the server, before the answer leaves:
//   functions/_lib/npcs.js playerView       a player's GET /api/npcs and /api/npcs/:id, and the transcriber's key terms (the iPad)
//   functions/_lib/npcs.js joinOverlayNpc   an npc overlay on the display GET
//   functions/_lib/npcs.js joinDisplayNpc   the display GET's own NPC card (kind 'npc'): the title the GM page stored is the full name
//   functions/_lib/show.js revealedCards    rolodex, spotlight, cast photo, credits ("Seen tonight"), band faces, "Previously on"
// and app/display-page.js Pure.playerNpc makes the same swap for an iPad signed in as the GM (it reads the cast as the GM).
//
// Plain ES module with no Cloudflare-specific imports.

import { isPlainObject } from './http.js';

export const KNOWN_AS = 'known-as';

const isMarker = (t) => typeof t === 'string' && t.trim().toLowerCase() === KNOWN_AS;

/** true when the document is marked known-as and has an alias to be known by. */
export function isKnownAs(doc) {
  return isPlainObject(doc) && Array.isArray(doc.tags) && doc.tags.some(isMarker) && typeof doc.alias === 'string' && !!doc.alias.trim();
}

/**
 * The document as the table meets it. Unmarked: returned as it came (the same object). Marked: a copy with name := the alias, alias := ''
 * (no quoted nickname line), the marker tag dropped (the cast page shows tags as chips), and a copy of the figure spec with name and plate
 * (the portrait's name plate) := the alias and spec.id, notes and $comment left out (the cast page saves spec.id as a slug of the name;
 * every page that draws a spec sets its own id). Nothing else changes; the input is never mutated.
 */
export function knownAs(doc) {
  if (!isKnownAs(doc)) return doc;
  const alias = doc.alias.trim();
  const out = { ...doc, name: alias, alias: '', tags: doc.tags.filter((t) => !isMarker(t)) };
  if (isPlainObject(doc.spec)) {
    const { id: _id, notes: _notes, $comment: _comment, ...spec } = doc.spec;
    spec.name = alias;
    if (spec.plate) spec.plate = alias;
    out.spec = spec;
  }
  return out;
}
