// The Screen's plain-code side (Phase 3): turn each Screen seat's JSON into an item the GM's page can preview, and build the case
// board from what the Mystery keeper already logged. No I/O and no clock; the Worker and node both import it. Nothing here
// parses more than a few KB: the Worker never loads the prefix or any long text.
// An item is { kind, ... } with text kept inside the limits in prompts.js, so the gatekeeper can always check all of it.

import { PROP_MAX, PROP_TITLE_MAX, WIRE_MAX, BOARD_MAX, SPEC_JSON_MAX, SCREEN_NAME_MAX, SCREEN_ASK_MAX, VOCAB_MAX } from './prompts.js';

const squash = (s) => String(s).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const one = (s) => String(s).replace(/\s+/g, ' ').trim();
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** An optional typed line (an NPC name, a prop ask): '' when absent, the trimmed line, or null when it is not a string or too long. */
export function cleanTyped(v, max) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null;
  const t = one(v);
  return t.length > max ? null : t;
}
export const cleanName = (v) => cleanTyped(v, SCREEN_NAME_MAX);
export const cleanAsk = (v) => cleanTyped(v, SCREEN_ASK_MAX);

/** The figure kit's vocabulary text the page sends with a portrait request: a non-empty string of at most VOCAB_MAX characters, or null. */
export function cleanVocab(v) {
  if (typeof v !== 'string') return null;
  const t = squash(v);
  return t && t.length <= VOCAB_MAX ? t : null;
}

/**
 * The Portrait seat's JSON -> { kind: 'portrait', name, description, spec } or null. spec is the parsed spec object (at most
 * SPEC_JSON_MAX characters as sent, a plain object, without the stamped fields the page adds itself); the page checks every name
 * against the figure kit and drops what it does not know. `typed` is the name the GM typed: it wins over the seat's.
 */
export function toPortrait(json, typed = '') {
  if (!isObj(json) || typeof json.spec_json !== 'string' || json.spec_json.length > SPEC_JSON_MAX) return null;
  let spec;
  try { spec = JSON.parse(json.spec_json); } catch { return null; }
  if (!isObj(spec) || !Object.keys(spec).length) return null;
  for (const k of ['id', 'name', 'plate', 'code']) delete spec[k];
  const name = one(typed || (typeof json.name === 'string' ? json.name : '')).slice(0, SCREEN_NAME_MAX);
  const description = typeof json.description === 'string' ? one(json.description).slice(0, 600) : '';
  return { kind: 'portrait', name, description, spec };
}

/** The Prop seat's JSON -> { kind: 'prop', title, text } or null. A document over PROP_MAX is refused, never cut: half a memo is not a memo. */
export function toProp(json) {
  if (!isObj(json) || typeof json.text !== 'string') return null;
  const text = squash(json.text);
  if (!text || text.length > PROP_MAX) return null;
  const title = typeof json.title === 'string' ? one(json.title).slice(0, PROP_TITLE_MAX) : '';
  return { kind: 'prop', title, text };
}

/** The Wire seat's JSON -> { kind: 'wire', text } or null (one line; over WIRE_MAX is refused). */
export function toWire(json) {
  if (!isObj(json) || typeof json.text !== 'string') return null;
  const text = one(json.text);
  return text && text.length <= WIRE_MAX ? { kind: 'wire', text } : null;
}

const KNOWN_LINE = 160, THEORY_LINE = 200;
/**
 * The case board from the Mystery keeper's latest `known` and `theories`, as a text display: { kind: 'board', title, text }, or null
 * when it holds neither. It is only what the players said aloud as the seat recorded it. The seat's own judgement of a theory
 * (`supported`) and its who/how/push_next are left out: that judgement is the GM's, not the players'. Cut at BOARD_MAX on a whole line.
 */
export function buildBoard(known, theories) {
  const k = (Array.isArray(known) ? known : []).filter((x) => typeof x === 'string' && x.trim()).map((x) => one(x).slice(0, KNOWN_LINE));
  const t = (Array.isArray(theories) ? theories : []).map((x) => (isObj(x) ? x.theory : x)).filter((x) => typeof x === 'string' && x.trim()).map((x) => one(x).slice(0, THEORY_LINE));
  if (!k.length && !t.length) return null;
  const lines = [];
  const section = (head, items) => { if (items.length) { if (lines.length) lines.push(''); lines.push(head); for (const i of items) lines.push('- ' + i); } };
  section('WHAT WE KNOW', k);
  section('WHO AND WHAT WE SUSPECT', t);
  let text = '';
  for (const l of lines) {
    const next = text ? text + '\n' + l : l;
    if (next.length > BOARD_MAX) break;
    text = next;
  }
  return text ? { kind: 'board', title: 'Case board', text } : null;
}

/** The Mystery keeper's latest `out` (from its log row) -> { known, theories }, each a short list. */
export function boardSource(out) {
  const o = isObj(out) ? out : {};
  return { known: Array.isArray(o.known) ? o.known.slice(0, 12) : [], theories: Array.isArray(o.theories) ? o.theories.slice(0, 12) : [] };
}

/**
 * The figure kit's vocabulary as plain text for the portrait seat: "label: name, name, ..." per line. `O` is the kit's options()
 * (a name list or an object keyed by name for each part kind). The page builds the same text from the loaded kit (app/gm-page.js,
 * VOCAB_KEYS, kept equal by checks/runtime/gm-screen-items.test.mjs); the replay script uses this one.
 */
export const VOCAB_KEYS = [['shape', 'shapes'], ['skin', 'skins'], ['arms (pose)', 'armPoses'], ['head.shape', 'head'], ['eyes', 'eyes'], ['brows', 'brows'], ['nose', 'nose'], ['mouth', 'mouth'],
  ['expression', 'expression'], ['ears', 'ears'], ['facialHair.type', 'facialHair'], ['eyewear.type', 'eyewear'], ['hair.style', 'hair'], ['hat.type', 'hat'], ['outfit.base', 'top'], ['outfit.mid', 'mid'],
  ['outfit.outer', 'outer'], ['outfit.neck', 'neckwear'], ['outfit.bottom', 'bottom'], ['outfit.dress', 'dress'], ['outfit.legs', 'legwear'], ['outfit.feet', 'footwear'], ['outfit.waist', 'belt'],
  ['outfit.hands', 'gloves'], ['props[].type', 'prop'], ['colour (any colour field)', 'cloth']];
export function vocabText(O) {
  const names = (v) => (Array.isArray(v) ? v : isObj(v) ? Object.keys(v) : []);
  return VOCAB_KEYS.map(([label, key]) => { const n = names(O && O[key]); return n.length ? label + ': ' + n.join(', ') : ''; }).filter(Boolean).join('\n');
}
