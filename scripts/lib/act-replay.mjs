// Pure helpers for scripts/gm-assist-act-replay.mjs (C1): cut a transcript into windows, keep a stand-in copy of the table's state between windows,
// and a fake model for --fake. No I/O, no network, no key, so checks/runtime/gm-assist-hands.test.mjs can run them.
//
// The real page (C2, app/gm/cogm.js) picks its windows with a pre-filter and applies the actions through the GM's own write paths. Until that module exists the
// replay cuts the transcript into plain windows and applies accepted actions to its OWN copy of the state, only so that a later window sees an NPC that an
// earlier one added (as the page's state would show it) and the keys can be deduped as the page will. Nothing real is written.

import { parseMinutes } from './tap-sim.mjs';
import { LINES_MAX } from '../../functions/_lib/assist/hands.js';

const stamp = (t) => String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');

/** A transcript file's text -> rows [{ seq, kind: 'line', t (minute of day), stamp, speaker, text }], in order. The format is the vault's: `- **[HH:MM] Name:** text`. */
export function rowsOf(text) {
  const all = parseMinutes(text), rows = [];
  let seq = 0;
  for (const t of [...all.keys()].sort((a, b) => a - b)) for (const l of all.get(t)) rows.push({ seq: ++seq, kind: 'line', t, stamp: stamp(t), speaker: l.speaker, text: l.text });
  return rows;
}

/**
 * Windows of `window` minutes stepping `step` minutes, over minutes `from`..`to` (minutes of day, -1 and 1e9 for all). The transcript is stamped to the minute, so a 30-second
 * window is not possible: one or two minutes is the closest. An empty window is skipped, and so is one with the same lines as the one before it.
 * -> [{ from: seq, to: seq, t: minute the window starts, rows (at most LINES_MAX: the latest) }]
 */
export function windowsOf(rows, { window = 2, step = 1, from = -1, to = 1e9 } = {}) {
  const inRange = rows.filter((r) => r.t >= from && r.t <= to);
  if (!inRange.length) return [];
  const out = [];
  let prev = '';
  for (let t = inRange[0].t; t <= inRange[inRange.length - 1].t; t += step) {
    let w = inRange.filter((r) => r.t >= t && r.t < t + window);
    if (w.length > LINES_MAX) w = w.slice(w.length - LINES_MAX);
    if (!w.length) continue;
    const id = w[0].seq + '-' + w[w.length - 1].seq;
    if (id === prev) continue;
    prev = id;
    out.push({ from: w[0].seq, to: w[w.length - 1].seq, t, rows: w });
  }
  return out;
}

/** The "[HH:MM] Name: text" lines a window is shown as (the Worker's formatLines does the same for D1 rows). */
export const talkOf = (win) => win.rows.map((r) => '[' + r.stamp + '] ' + r.speaker + ': ' + r.text).join('\n');

/**
 * Stand-in for the page's apply step: take the validated `act` actions whose key has not been applied, change a copy of the state, and say what was applied.
 * Offers are not applied (the GM taps them). -> { state (new), applied: [action], skipped: [action] (a key already applied) }
 */
export function applyToState(state, actions, appliedKeys) {
  const s = structuredClone(state), applied = [], skipped = [];
  let n = (s.clocks || []).length;
  for (const a of actions) {
    if (a.mode !== 'act') continue;
    if (appliedKeys.has(a.key)) { skipped.push(a); continue; }
    if (a.type === 'clock_add') s.clocks.push({ id: 'sim' + (++n), name: a.name, size: a.size, filled: 0, hidden: a.hidden });
    else if (a.type === 'clock_tick') { const c = s.clocks.find((x) => x.id === a.clock_id); if (!c) continue; c.filled = Math.max(0, Math.min(c.size, c.filled + a.by)); }
    else if (a.type === 'npc_add') s.npcs.push({ id: 'simn' + (++n), name: a.name });
    else continue;                                // capture and roll_log write nothing to the state
    appliedKeys.add(a.key);
    applied.push(a);
  }
  return { state: s, applied, skipped };
}

/**
 * --fake: a model that needs no network. It reads the window it is given and answers like a careful, slightly over-eager seat would: a clock_add for a line that says
 * "clock" with a number word, a clock_tick for "tick that" on the first clock in the state, and every third window one INVENTED quote (which validation must drop).
 * -> a callSeat-shaped result { json, text, usage, cost, stop, secs }
 */
export function fakeHandsCall({ user, n }) {
  const talk = user.slice(user.indexOf('\n[') + 1).split('\n').filter((l) => /^\[\d\d:\d\d\] /.test(l));
  const actions = [];
  const base = { confidence: 0.9, name: '', size: 0, hidden: false, clock_id: '', by: 0, look: '', role: '', bucket: '', text: '', who: '', action: '', position: '', effect: '', result: '' };
  const sizes = { four: 4, six: 6, eight: 8, ten: 10, twelve: 12 };
  for (const l of talk) {
    const at = l.slice(1, 6), body = l.replace(/^\[\d\d:\d\d\] [^:]*: /, '');
    const m = /\b(four|six|eight|ten|twelve)[- ]segment clock\b/i.exec(body);
    if (m) actions.push({ ...base, type: 'clock_add', quote: m[0], at, name: 'Fake ' + m[1], size: sizes[m[1].toLowerCase()] });
    const t = /\btick (that|it)\b/i.exec(body);
    const id = /"id":"([^"]+)"/.exec(user);
    if (t && id) actions.push({ ...base, type: 'clock_tick', quote: t[0], at, clock_id: id[1], by: 1 });
  }
  if (n % 3 === 0) actions.push({ ...base, type: 'capture', quote: 'a sentence nobody ever said at this table', at: '00:00', bucket: 'moment', text: 'invented' });
  const json = { actions };
  return { json, text: JSON.stringify(json), usage: { input_tokens: 0, output_tokens: 0 }, cost: 0, stop: 'end_turn', secs: 0 };
}

/** One-line description of a validated action for actions.md. */
export function describe(a) {
  const what = a.type === 'clock_add' ? `${a.name} (${a.size}${a.hidden ? ', hidden' : ''})`
    : a.type === 'clock_tick' ? `${a.clock_name} ${a.from_filled}/${a.size} -> ${a.to_filled}/${a.size}`
    : a.type === 'npc_add' ? `${a.name}${a.role ? ', ' + a.role : ''}${a.look ? ': ' + a.look : ''}`
    : a.type === 'capture' ? `${a.bucket}: ${a.text}` : `${a.who}: ${a.action} (${a.position}/${a.effect}/${a.result})`;
  return `${a.mode.toUpperCase()} ${a.type} ${what} [${a.confidence}] key ${a.key}`;
}
