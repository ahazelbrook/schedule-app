// The cue replay (C4c): ten INVENTED cue windows, each sent through the model path of POST /assist/act exactly as the Worker would build it (the hands seat, the cue
// instruction after the base instructions, the cue line in the user turn, validateActions in cue mode), and checked against what the command should do. Nothing here is
// from a real session: every name and sentence is made up. scripts/gm-assist-act-replay.mjs --cue runs it; no I/O of its own beyond the injected `call`.

import { SEATS, CUE_INSTRUCTION } from '../../functions/_lib/assist/seats.js';
import { handsUser } from '../../functions/_lib/assist/prompts.js';
import { cleanState, validateActions } from '../../functions/_lib/assist/hands.js';

export const CUE_STATE = {
  clocks: [
    { id: 'ck1', name: 'Lamp Oil Running Low', size: 6, filled: 2, hidden: false },
    { id: 'ck2', name: 'Harbour Watch Wakes', size: 4, filled: 3, hidden: true },
    { id: 'ck3', name: 'Empty One', size: 8, filled: 0, hidden: false },
  ],
  npcs: [{ id: 'n1', name: 'Mirelle Tanager' }],
  pcs: [{ id: 'p1', name: 'Odo Vance' }],
  onStage: 'Mirelle Tanager',
};

// each window: lines [speaker, text], cue (the index of the line holding the wake word), and `ok(actions)`: does what came back do what the command says?
const only = (acts, type) => acts.length === 1 && acts[0].type === type;
export const CUE_WINDOWS = [
  { name: 'make a clock', lines: [[0, 'The dockside is quiet tonight.'], [1, 'Blade, make a six clock called Harbour Bell'], [0, 'Right, where were we.']], cue: 1,
    ok: (a) => only(a, 'clock_add') && a[0].size === 6 && /harbour bell/i.test(a[0].name) && a[0].filled === 0 },
  { name: 'clock with a mark', lines: [[1, 'Blade, make a four clock called Night Crew and mark one.'], [0, 'They look nervous.']], cue: 0,
    ok: (a) => only(a, 'clock_add') && a[0].size === 4 && /night crew/i.test(a[0].name) && a[0].filled === 1 },
  { name: 'split over two lines, other speaker', lines: [[0, 'Okay.'], [1, 'Blade,'], [0, 'tick Lamp Oil Running Low twice.'], [2, 'Is that bad?']], cue: 1,
    ok: (a) => only(a, 'clock_tick') && a[0].clock_id === 'ck1' && a[0].by === 2 },
  { name: 'a mishearing of the wake word', lines: [[1, 'Played, new NPC called Corvin Lathe, a tall porter with a bad knee.'], [0, 'Oh him.']], cue: 0,
    ok: (a) => only(a, 'npc_add') && /corvin lathe/i.test(a[0].name) },
  { name: 'clear a clock', lines: [[1, 'Blade, clear one on Harbour Watch Wakes.']], cue: 0,
    ok: (a) => only(a, 'clock_tick') && a[0].clock_id === 'ck2' && a[0].by === -1 },
  { name: 'a note', lines: [[0, 'The ferry has stopped running.'], [1, 'Blade, note that the ferry stopped running after the bell.']], cue: 1,
    ok: (a) => only(a, 'capture') },
  { name: 'a loose end', lines: [[1, 'Blade, loose end: who rang the bell that night?'], [0, 'Good question.']], cue: 0,
    ok: (a) => only(a, 'capture') && a[0].bucket === 'loose_end' },
  { name: 'a name for the notes', lines: [[1, 'Blade, name: Pernel Quayle, the ropemaker.']], cue: 0,
    ok: (a) => (only(a, 'capture') && a[0].bucket === 'name') || (only(a, 'npc_add') && /pernel quayle/i.test(a[0].name)) },
  { name: 'an unclear command: nothing', lines: [[1, 'Blade, do the thing with the whatsit.'], [0, 'Sure.']], cue: 0,
    ok: (a) => a.length === 0 },
  { name: 'an illegal size: nothing made at nine', lines: [[1, 'Blade, make a nine clock called Tide Table.']], cue: 0,
    ok: (a) => !a.some((x) => x.type === 'clock_add' && x.size === 9) },
];

/** The rows of one window as the Worker would have read them from D1: ids l<i>, seq, a stamp, kind 'line'. */
export function windowRows(w, base = Date.parse('2030-06-01T11:00:00.000Z')) {
  return w.lines.map(([speaker, text], i) => ({ seq: i + 1, id: 'l' + (i + 1), kind: 'line', session: '3', speaker, at: new Date(base + i * 4000).toISOString(), text }));
}

// the Worker's formatLines, for these rows (the stamp is UTC+11 in June: Melbourne, AEDT is not in force; AEST is +10, so the stamp is cosmetic here)
const talkOf = (rows) => rows.map((l) => '[' + new Date(Date.parse(l.at) + 10 * 3600 * 1000).toISOString().slice(11, 16) + '] S' + l.speaker + ': ' + l.text).join('\n');

/**
 * Runs the windows. call({ ...seat, user, deadlineMs }) -> { json, usage, cost, stop }. -> { results: [{ name, ok, kept, dropped, cost, stop, proposed }], spend, stopped }.
 * Stops before a call when the spend so far has reached maxSpend.
 */
export async function runCueWindows({ call, maxSpend = 0.1, deadlineMs = 15000 } = {}) {
  const state = cleanState(CUE_STATE), results = [];
  let spend = 0, stopped = '';
  for (const w of CUE_WINDOWS) {
    if (spend >= maxSpend) { stopped = 'budget'; break; }
    const rows = windowRows(w);
    const user = handsUser({ state, stamp: talkOf(rows).slice(1, 6), talk: talkOf(rows), cue: talkOf([rows[w.cue]]) });
    let r = null, err = '';
    try { r = await call({ ...SEATS.hands, instructions: SEATS.hands.instructions + '\n' + CUE_INSTRUCTION, user, deadlineMs }); } catch (e) { err = e && Number.isInteger(e.status) ? 'provider status ' + e.status : 'call failed'; }
    if (r) spend += r.cost || 0;
    const usable = r && r.stop !== 'refusal' && r.stop !== 'max_tokens' && r.json && Array.isArray(r.json.actions);
    const v = usable ? validateActions(r.json.actions, { state, lines: rows, cue: { parsed: false, cueLineId: 'l' + (w.cue + 1) } }) : { actions: [], dropped: [] };
    results.push({ name: w.name, ok: !!usable && w.ok(v.actions), kept: v.actions, dropped: v.dropped, cost: r ? r.cost || 0 : 0, stop: r ? r.stop || '' : '', proposed: usable ? r.json.actions : [], ...(err ? { error: err } : {}) });
  }
  return { results, spend, stopped };
}
