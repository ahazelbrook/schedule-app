// The montage layer (suite 2.8, switch map.montage): `data.montage`, a lasting layer for the show contract in show.js (which imports this file; nothing here imports show.js).
//   data.montage { panels: [2-4 x { pcId, name?, room?, line?, done? }] }
// One panel per player character: pcId is the character's id (never an NPC id), name a short label, room the place the character is in (the GM page only offers
// rooms the players already know), line one line of what they are doing, done true once a marked roll has resolved the panel. Free text is scanned for hidden names
// by showTexts (show.js), exactly like any beat's words. It is a layer, not an overlay, so a stamp's report card can stand over it while a roll is resolved.
import { HttpError, ID_RE } from './http.js';

export const MONTAGE_LIMITS = { min: 2, max: 4, name: 40, room: 60, line: 100 };
const bad = (m) => { throw new HttpError(400, m); };
function text(v, name, max) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') bad(name + ' must be text');
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  if (t.length > max) bad(name + ' is too long (at most ' + max + ' characters)');
  return t;
}
const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

export function montageLayer(v) {
  if (!plain(v) || !Array.isArray(v.panels)) bad('data.montage must be { panels: [...] }');
  if (Object.keys(v).some((k) => k !== 'panels')) bad('data.montage holds only panels');
  const n = v.panels.length;
  if (n < MONTAGE_LIMITS.min || n > MONTAGE_LIMITS.max) bad('data.montage holds ' + MONTAGE_LIMITS.min + ' to ' + MONTAGE_LIMITS.max + ' panels');
  const seen = new Set();
  const panels = v.panels.map((p) => {
    if (!plain(p) || typeof p.pcId !== 'string' || !ID_RE.test(p.pcId)) bad('each montage panel needs a pcId');
    if (seen.has(p.pcId)) bad('a character has one montage panel');
    seen.add(p.pcId);
    if (p.done !== undefined && p.done !== null && typeof p.done !== 'boolean') bad('panel.done must be true or false');
    const o = { pcId: p.pcId };
    for (const [k, max] of [['name', MONTAGE_LIMITS.name], ['room', MONTAGE_LIMITS.room], ['line', MONTAGE_LIMITS.line]]) { const t = text(p[k], 'panel.' + k, max); if (t !== undefined) o[k] = t; }
    if (p.done === true) o.done = true;
    return o;
  });
  return { panels };
}

/** The words of a cleaned data.montage value that a reader will see (for the hidden-name scan). */
export function montageTexts(value) {
  const out = [];
  if (plain(value) && Array.isArray(value.panels)) for (const p of value.panels) if (plain(p)) for (const k of ['name', 'room', 'line']) if (typeof p[k] === 'string') out.push(p[k]);
  return out;
}
