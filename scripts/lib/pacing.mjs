// The pacing post-mortem's arithmetic (suite ticket A5): a night object (app/gm/night.js's shape) in, actual against planned out,
// per phase and per room. Pure: no clock, no network, no model, no vault. Rooms are log entries whose text starts "Room: <name>"
// (optionally "(8m)" for the planned minutes); a room runs until the next room or phase entry, or the end of the night.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Night = require(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'app', 'gm', 'night.js'));
export const HEADING = 'Pacing post-mortem';

const min = (ms) => Math.round(ms / 6000) / 10;                    // one decimal place of minutes
const round1 = (v) => Math.round(v * 10) / 10;
const ROOM = /^room\s*[:\-]\s*(.+?)\s*(?:\((\d+(?:\.\d+)?)\s*m(?:in)?\))?\s*$/i;

/** raw: a night object, or a state document holding one. endMs: when the night ended (default: the last log entry or phase end). */
export function pacing(raw, endMs) {
  const doc = raw && typeof raw === 'object' && raw.night && typeof raw.night === 'object' ? raw.night : raw;
  const n = Night.clean(doc), log = Night.logList(n);
  const last = log.length ? log[log.length - 1].at : 0;
  const stop = endMs || Math.max(last, ...Night.PHASES.map((p) => n.phases[p.id].end || 0));
  const phases = Night.PHASES.map((p) => {
    const ph = n.phases[p.id];
    if (!ph.start) return { id: p.id, label: p.label, planned: ph.budget, actual: null, delta: null, cues: 0 };
    const end = ph.end || stop || ph.start;
    const actual = min(Math.max(0, end - ph.start));
    const cues = log.filter((e) => e.k === 'cue' && e.at >= ph.start && e.at <= end).length;
    return { id: p.id, label: p.label, planned: ph.budget, actual, delta: ph.budget ? round1(actual - ph.budget) : null, cues };
  });
  const isRoom = (e) => e.k !== 'phase' && ROOM.test(e.text);
  const rooms = [];
  log.forEach((e, i) => {
    const m = e.k !== 'phase' ? ROOM.exec(e.text) : null;
    if (!m) return;
    const next = log.slice(i + 1).find((x) => x.k === 'phase' || isRoom(x));
    const end = next ? next.at : stop || e.at;
    const planned = m[2] ? +m[2] : null, actual = min(Math.max(0, end - e.at));
    rooms.push({ room: m[1], phase: e.p || '', planned, actual, delta: planned ? round1(actual - planned) : null });
  });
  const cues = log.filter((e) => e.k === 'cue').map((e) => ({ at: e.at, text: e.text }));
  return { phases, rooms, cues };
}

const cell = (v) => (v == null ? '-' : String(v));
const sign = (v) => (v == null ? '-' : (v > 0 ? '+' : '') + v);

/** The note block: a heading's body, as lines. */
export function render(r) {
  const out = ['Actual against planned, in minutes. Planned is the phase budget from the prep note; a dash means none was set.', '',
    '| Phase | Planned | Actual | Over (+) / under (-) | Cues |', '| --- | --- | --- | --- | --- |'];
  r.phases.forEach((p) => out.push('| ' + [p.label, cell(p.planned), cell(p.actual), sign(p.delta), p.cues].join(' | ') + ' |'));
  if (r.rooms.length) {
    out.push('', '| Room | Planned | Actual | Over (+) / under (-) |', '| --- | --- | --- | --- |');
    r.rooms.forEach((x) => out.push('| ' + [x.room, cell(x.planned), cell(x.actual), sign(x.delta)].join(' | ') + ' |'));
  }
  out.push('', '^b68-pacing');
  return out;
}
