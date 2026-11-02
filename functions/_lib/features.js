// The switchboard, the Worker's half (suite ticket W0.2). The registry is app/features.js (the GM page draws it, the tests read it); this file is the one door the
// Worker uses to it, so a switch added there needs nothing here. Plain ES with no Cloudflare imports: node loads it through the checks.
//
//   cleanFeatures(raw)      -> { id: bool }   only the display and phone switches in the registry, only booleans. A GM-only id, an id nobody registered, a
//                              value that is not true or false: dropped, never an error (an older Worker meeting a newer page must not refuse the write).
//   featuresOfDoc(doc)      -> the campaign document's `features`, cleaned
//   forPlayer(doc)          -> the campaign document as a player or the iPad may read it: `features` cleaned (and left out when nothing is left), the rest as is
//   parseFeatures(text)     -> cleanFeatures of a JSON text (the display GET's one-statement read hands it the column)
//
// Where the values live: the GM state document holds every switch (`features`); the campaign document holds the display and phone ones, copied by the GM page.
// A phone or the iPad is never sent a GM-only id: it is not in the campaign document (cleaned on the write), and it is cleaned again on every read.

import Features from '../../app/features.js';

export const cleanFeatures = (raw) => Features.cleanPublic(raw);

export function featuresOfDoc(doc) {
  return doc && typeof doc === 'object' ? cleanFeatures(doc.features) : {};
}

export function parseFeatures(text) {
  if (typeof text !== 'string' || !text) return {};
  try { return cleanFeatures(JSON.parse(text)); } catch (_) { return {}; }
}

export function forPlayer(doc) {
  if (!doc || typeof doc !== 'object' || !('features' in doc)) return doc;
  const { features, ...rest } = doc;
  const clean = cleanFeatures(features);
  return Object.keys(clean).length ? { ...rest, features: clean } : rest;
}

export default Features;
