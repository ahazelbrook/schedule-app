// Pure helpers for scripts/gm-assist-act-replay.mjs (C1): cut a transcript into windows, keep a stand-in copy of the table's state between windows,
// and a fake model for --fake. No I/O, no network, no key, so checks/runtime/gm-assist-hands.test.mjs can run them.
//
// The real page (app/gm/cogm.js) picks its windows with a pre-filter; cogmWindows below runs that module itself, and windowsOf is the plain time-cut kept for --no-prefilter.
// Accepted actions are applied to the replay's OWN copy of the state, only so that a later window sees an NPC that an earlier one added (as the page's state would
// show it) and the keys can be deduped as the page will. Nothing real is written.

import { createRequire } from 'node:module';
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

// ---------- the page's own pre-filter (C3) ----------
const cogm = createRequire(import.meta.url)('../../app/gm/cogm.js');

/**
 * The windows the PAGE would send, by running app/gm/cogm.js itself over the rows: every line is ingested as the page's poll would hand it over, a line the pre-filter matches
 * is noted, and nextWindow/windowSent pick and retire windows with the page's own settle rule, gap and cursors. The transcript is stamped to the minute, so each line gets a
 * time spread evenly through its minute (the page's 30-second widening and its settle/gap timers then behave as they would at that talking speed). A window holds the lines
 * from its `from` to `to` seq, the matching line plus its context, so a line that matched is never left out and a quiet stretch is never sent.
 * -> { windows: [{ from, to, t, rows, matched: [seq], intents: [..] }], matchedLines (lines that matched), lines }
 */
export function cogmWindows(rows, { api = cogm } = {}) {
  const byMinute = new Map();
  for (const r of rows) byMinute.set(r.t, (byMinute.get(r.t) || 0) + 1);
  const seen = new Map(), ms = (r) => { const k = seen.get(r.t) || 0; seen.set(r.t, k + 1); return r.t * 60000 + Math.floor(((k + 0.5) / byMinute.get(r.t)) * 60000); };
  const st = api.newState();
  api.start(st, 0);
  const windows = [], bySeq = new Map(rows.map((r) => [r.seq, r]));
  let now = 0, matchedLines = 0;
  const take = () => {
    const w = api.nextWindow(st, now);
    if (!w) return false;
    const wrows = []; for (let s = w.from; s <= w.to; s++) if (bySeq.has(s)) wrows.push(bySeq.get(s));
    windows.push({ from: w.from, to: w.to, t: wrows[0].t, rows: wrows, matched: w.seqs, intents: [...new Set(w.seqs.flatMap((s) => api.match(bySeq.get(s).text)))] });
    api.windowSent(st, w, now);
    return true;
  };
  for (const r of rows) {
    now = ms(r);
    if (api.match(r.text).length) matchedLines++;
    api.ingest(st, [{ seq: r.seq, kind: 'line', at: new Date(Date.UTC(2000, 0, 1) + now).toISOString(), text: r.text, speaker: null }], undefined, now);
    take();
  }
  for (let i = 0; i < 100000 && st.pending.length; i++) { now += 1000; take(); }       // the talk has stopped: let what is left settle
  return { windows, matchedLines, lines: rows.length };
}

/** The seq of the row a quote starts on (its first words, compared as letters and digits only), or 0. */
export function lineOf(rows, quote) {
  const n = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const q = n(quote).split(' ').slice(0, 5).join(' ');
  if (!q) return 0;
  const hit = rows.find((r) => (' ' + n(r.text) + ' ').includes(' ' + q + ' '));
  return hit ? hit.seq : 0;
}
