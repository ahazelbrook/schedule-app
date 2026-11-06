// The registry's door for the Worker (suite ticket W0.2; the night rebuild, N0). The registry is app/features.js (the GM page reads it, the tests read it); this
// file is the one way the Worker reaches it, so a line added there needs nothing here. Plain ES with no Cloudflare imports: node loads it through the checks.
//
// Everything built is ON. What a phone or the iPad is told is made on every READ, here, from the registry: every display and phone line ON, and the three
// settings (phoneCards, fx.off, room.music) exactly as stored. So the first request after a deploy already sees every feature on, whether or not the GM page
// has been opened since, and no stored value is ever rewritten to make it so (a rollback finds the documents as they were).
//
//   cleanFeatures(raw)      -> { id: bool }   the WRITE side: only the display and phone lines in the registry, only booleans. A GM-only id, an id nobody
//                              registered, a value that is not true or false: dropped, never an error (an older Worker meeting a newer page must not refuse it).
//   servedFeatures(raw)     -> { id: bool }   the READ side: what a phone or the iPad is told from a stored map (Features.publicView). Never empty, never a GM-only id.
//   featuresOfDoc(doc)      -> servedFeatures of the campaign document's `features`
//   forPlayer(doc)          -> the campaign document as anyone reads it (a player, the iPad, the GM): `features` served, the rest as is
//   parseFeatures(text)     -> servedFeatures of a JSON text (the display GET's one-statement read hands it the column; junk reads as nothing stored)
//
// Where the values live: the GM state document holds the settings (`features`); the campaign document holds the display and phone settings, copied by the
// GM page. A phone or the iPad is never sent a GM-only id: it is not in the campaign document (cleaned on the write), and the served map holds none.

import Features from '../../app/features.js';

export const cleanFeatures = (raw) => Features.cleanPublic(raw);

export const servedFeatures = (raw) => Features.publicView(raw);

export function featuresOfDoc(doc) {
  return servedFeatures(doc && typeof doc === 'object' ? doc.features : null);
}

export function parseFeatures(text) {
  let raw = null;
  if (typeof text === 'string' && text) { try { raw = JSON.parse(text); } catch (_) { raw = null; } }
  return servedFeatures(raw);
}

export function forPlayer(doc) {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return doc;
  const { features, ...rest } = doc;
  return { ...rest, features: servedFeatures(features) };
}

export default Features;
