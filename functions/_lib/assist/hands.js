// The co-GM's hands, server side (design 5.3 and 5.4): the request checks for POST /api/gm/assist/act and the validation of what the `hands` seat
// returns. Pure code with no I/O and no clock, so the Worker and the node tests run the same thing. Everything here is linear in a few dozen
// items (at most 40 lines, 8 actions, a state of at most 8 KB), so it costs the request next to no CPU.
//
// The seat PROPOSES; this module is the trust boundary. The route never applies anything: the page does that (C2), through the GM's own write paths.
// An action survives only if:
//   - its type is known, and its quote appears in the lines the Worker itself read (after normalising): the guard against an invented action;
//   - its ids exist in the state the page sent, its sizes are legal, its ticks are clamped to the clock, and a name already known is not added again.
// A confidence under CONFIDENCE_MIN comes back as mode 'offer' (a yellow card with Do it) instead of 'act'. Each action carries a stable `key`.

import { HttpError } from '../http.js';
import { CLOCK_SIZES } from '../campaign.js';

export const STATE_MAX_BYTES = 8 * 1024;       // the state the page sends: more is a 400
export const LINES_MAX = 40;                   // transcript lines the Worker reads for one call
export const RANGE_MAX = 200;                  // the widest seq span accepted (lines and marks share seqs; a window is a few dozen at most)
export const CONFIDENCE_MIN = 0.7;             // under this, an action is an offer, not an act
export const ACTIONS_MAX = 8;                  // actions looked at per reply (the seat is told 6)
export const DROPPED_MAX = 8;                  // drops reported back
export const QUOTE_MIN = 6;                    // a quote shorter than this (normalised) proves nothing
export const QUOTE_KEEP = 200;                 // characters of the quote the answer carries
export const TICK_MIN = -3, TICK_MAX = 6;      // one tick action moves a clock by this much, at most
const NAME_MAX = 80, ID_MAX = 64, LOOK_MAX = 200, ROLE_MAX = 80, TEXT_MAX = 300, FIELD_MAX = 120;
const CLOCKS_MAX = 40, NPCS_MAX = 100, PCS_MAX = 12, STATE_SIZE_MAX = 12;
export const BUCKETS = ['name', 'loose_end', 'moment'];
export const TYPES = ['clock_add', 'clock_tick', 'npc_add', 'capture', 'roll_log'];
const POSITIONS = ['controlled', 'risky', 'desperate', 'unclear'], EFFECTS = ['limited', 'standard', 'great', 'unclear'], RESULTS = ['critical', 'full', 'partial', 'miss', 'unclear'];

/** Lowercase, accents and punctuation gone, runs of whitespace one space: what a quote and the talk are compared as. */
export function normalise(s) {
  return String(s === undefined || s === null ? '' : s).normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

const clip = (s, n) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, n) : '');

// a small string hash (FNV-1a, 32 bit) in hex: the key only has to be stable. The page uses the key as the Worker gives it and never recomputes one.
function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * The key of an action: its type, the normalised target and a hash of its ANCHOR, the normalised text of the line the quote starts on (design 5.4 hashes the quote; see
 * validateActions for why the line). At, confidence and the amount are not in it, so the same decision gives the same key in any window that holds that line.
 */
export function actionKey(type, target, anchor) {
  return type + ':' + normalise(target).replace(/ /g, '-').slice(0, 40) + ':' + hash(anchor);
}

/** The seq range of a request: { from, to } or null. Whole numbers, from <= to, at most RANGE_MAX apart. */
export function cleanRange(from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to - from > RANGE_MAX) return null;
  return { from, to };
}

function bad(why) { throw new HttpError(400, why); }
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * The table's state as the page sends it, checked and trimmed: { clocks: [{ id, name, size, filled, hidden }], npcs: [{ id, name }], pcs: [{ id, name }], onStage }.
 * At most STATE_MAX_BYTES of JSON (UTF-8), else HttpError 400, as is any other shape. Unknown keys are dropped.
 */
export function cleanState(state) {
  if (!isObj(state)) bad('state is required: { clocks, npcs, pcs, onStage }');
  const raw = JSON.stringify(state);
  if (new TextEncoder().encode(raw).length > STATE_MAX_BYTES) bad('state is at most ' + STATE_MAX_BYTES / 1024 + ' KB');
  const list = (v, max, what) => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > max) bad('state.' + what + ' is a list of at most ' + max);
    return v;
  };
  const named = (v, what) => {
    if (!isObj(v) || typeof v.id !== 'string' || !v.id || v.id.length > ID_MAX || typeof v.name !== 'string' || !v.name.trim()) bad('state.' + what + ' items are { id, name }');
    return { id: v.id, name: clip(v.name, NAME_MAX) };
  };
  const clocks = list(state.clocks, CLOCKS_MAX, 'clocks').map((c) => {
    const o = named(c, 'clocks');
    if (!Number.isInteger(c.size) || c.size < 1 || c.size > STATE_SIZE_MAX) bad('state.clocks size is a whole number from 1 to ' + STATE_SIZE_MAX);
    if (!Number.isInteger(c.filled) || c.filled < 0) bad('state.clocks filled is a whole number, 0 or more');
    return { ...o, size: c.size, filled: Math.min(c.filled, c.size), hidden: c.hidden === true };
  });
  const npcs = list(state.npcs, NPCS_MAX, 'npcs').map((n) => named(n, 'npcs'));
  const pcs = list(state.pcs, PCS_MAX, 'pcs').map((n) => named(n, 'pcs'));
  if (state.onStage !== undefined && state.onStage !== null && (typeof state.onStage !== 'string' || state.onStage.length > NAME_MAX)) bad('state.onStage is a name of at most ' + NAME_MAX + ' characters, or null');
  return { clocks, npcs, pcs, onStage: typeof state.onStage === 'string' ? clip(state.onStage, NAME_MAX) : '' };
}

/** The body of POST /assist/act: { from, to, state } checked before the database or the key are touched. Any `lines` in it are ignored (the Worker reads them itself). Throws HttpError(400). */
export function cleanActBody(b) {
  const range = cleanRange(b.from, b.to);
  if (!range) bad('from and to are transcript seqs: whole numbers, from <= to, at most ' + RANGE_MAX + ' apart');
  return { ...range, state: cleanState(b.state) };
}

const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);

/**
 * What the seat said, checked against the state and the lines the Worker read.
 *   raw: the seat's `actions` (anything); state: cleanState's; lines: the transcript rows read from D1.
 * -> { actions, dropped }. An action is { type, mode: 'act' | 'offer', key, quote, at, confidence, ...its fields }. A dropped one is { type, why, name? }
 * (an npc_add of a known name is dropped with why 'already known' and its name, so the card can say so). Nothing here is applied.
 */
export function validateActions(raw, { state, lines }) {
  const actions = [], dropped = [];
  if (!Array.isArray(raw)) return { actions, dropped };
  // The talk as one normalised string, each line a word-bounded stretch of it; starts[i] is where line i begins in `hay` (so a quote's position names its line).
  const norm = (lines || []).filter((l) => l && l.kind === 'line').map((l) => normalise(l.text)).filter(Boolean);
  const hay = ' ' + norm.join(' ') + ' ';
  const starts = []; let at0 = 1;
  for (const t of norm) { starts.push(at0); at0 += t.length + 1; }
  // The line a quote starts on (the first, if it is said twice). The key hashes THAT LINE, not the quote: the model may copy "Tick that once" in one window and
  // "Tick that once, the night crew is stirring." in the next (the C1 replay did exactly that), and the same decision must keep one key. A quote running across lines takes its first.
  const lineAt = (pos) => { let i = starts.length - 1; while (i > 0 && starts[i] > pos) i--; return norm[i]; };
  const clocks = new Map(state.clocks.map((c) => [c.id, c]));
  const known = new Set(state.npcs.concat(state.pcs).map((n) => normalise(n.name)).filter(Boolean));
  const seen = new Set();
  const drop = (type, why, name) => { if (dropped.length < DROPPED_MAX) dropped.push({ type: typeof type === 'string' ? type.slice(0, 20) : '', why, ...(name ? { name } : {}) }); };
  if (raw.length > ACTIONS_MAX) drop('', 'too many');
  for (const a of raw.slice(0, ACTIONS_MAX)) {
    if (!isObj(a) || !TYPES.includes(a.type)) { drop(isObj(a) ? a.type : '', 'unknown type'); continue; }
    const nq = normalise(a.quote);
    const hit = nq.length < QUOTE_MIN ? -1 : hay.indexOf(' ' + nq + ' ');
    if (hit < 0) { drop(a.type, 'quote not in the talk'); continue; }
    const anchor = lineAt(hit + 1);
    const conf = typeof a.confidence === 'number' && Number.isFinite(a.confidence) ? clamp(a.confidence, 0, 1) : 0;
    const base = { type: a.type, mode: conf >= CONFIDENCE_MIN ? 'act' : 'offer', quote: clip(a.quote, QUOTE_KEEP), at: typeof a.at === 'string' && /^\d{2}:\d{2}$/.test(a.at.trim()) ? a.at.trim() : '', confidence: Math.round(conf * 100) / 100 };
    let out;
    if (a.type === 'clock_add') {
      const name = clip(a.name, NAME_MAX);
      if (!name) { drop(a.type, 'no name'); continue; }
      if (!CLOCK_SIZES.includes(a.size)) { drop(a.type, 'illegal size'); continue; }
      out = { ...base, key: actionKey(a.type, name, anchor), name, size: a.size, hidden: a.hidden === true };
    } else if (a.type === 'clock_tick') {
      const c = typeof a.clock_id === 'string' ? clocks.get(a.clock_id) : undefined;
      if (!c) { drop(a.type, 'unknown clock'); continue; }
      if (!Number.isFinite(a.by)) { drop(a.type, 'no amount'); continue; }
      // the amount is clamped twice: to what one action may do, then to what the clock can take. Nothing left to do is dropped, not sent as a zero.
      const by = clamp(clamp(Math.trunc(a.by), TICK_MIN, TICK_MAX), -c.filled, c.size - c.filled);
      if (by === 0) { drop(a.type, 'no change'); continue; }
      out = { ...base, key: actionKey(a.type, c.id, anchor), clock_id: c.id, clock_name: c.name, by, from_filled: c.filled, to_filled: c.filled + by, size: c.size };
    } else if (a.type === 'npc_add') {
      const name = clip(a.name, NAME_MAX);
      if (!name) { drop(a.type, 'no name'); continue; }
      if (known.has(normalise(name))) { drop(a.type, 'already known', name); continue; }
      out = { ...base, key: actionKey(a.type, name, anchor), name, look: clip(a.look, LOOK_MAX), role: clip(a.role, ROLE_MAX) };
    } else if (a.type === 'capture') {
      const text = clip(a.text, TEXT_MAX);
      if (!BUCKETS.includes(a.bucket)) { drop(a.type, 'unknown bucket'); continue; }
      if (!text) { drop(a.type, 'no text'); continue; }
      out = { ...base, key: actionKey(a.type, a.bucket, anchor), bucket: a.bucket, text };
    } else {
      // roll_log (P3): the page has no apply path for it yet (design 5.5), so it is only ever an offer
      const who = clip(a.who, FIELD_MAX), what = clip(a.action, FIELD_MAX);
      if (!who || !what) { drop(a.type, 'no roll'); continue; }
      out = { ...base, mode: 'offer', key: actionKey(a.type, who, anchor), who, action: what,
        position: POSITIONS.includes(a.position) ? a.position : 'unclear', effect: EFFECTS.includes(a.effect) ? a.effect : 'unclear', result: RESULTS.includes(a.result) ? a.result : 'unclear' };
    }
    if (seen.has(out.key)) { drop(a.type, 'duplicate'); continue; }
    seen.add(out.key);
    actions.push(out);
  }
  return { actions, dropped };
}
