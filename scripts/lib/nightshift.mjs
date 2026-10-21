// The Night Shift ("Claude at the table", build plan WP6): after the game, on the GM's PC, turn a session transcript into
// the night's paperwork drafts and file them in the session note under ONE heading. Never runs in the Worker.
//
//   two-stage (default): hour-long chunks -> sorters in parallel (rolls, names, ledger, loose ends, clocks) -> the writer (streamed)
//   single:              one Opus call over the whole transcript, same sections
//
// Both return the same shape, so renderDraft() and the filing are the same. This file is generic: no campaign text. The
// transcript and the prefix are passed in; nothing here prints them. Models and effort live in seats.js only.
//
// Filing: one `## Night Shift draft` block, appended at the end of the note. If the heading is already there the draft is
// SKIPPED (before any money is spent) unless `force`, which replaces only that block, up to the next `##` heading. XP is
// never marked: the block says so, and lists only candidate triggers.

import { callSeat, PRICES } from '../../functions/_lib/assist/claude.js';
import { SEATS } from '../../functions/_lib/assist/seats.js';

export const HEADING = 'Night Shift draft';
export const DEFAULT_CAP = 3;
export const CHARS_PER_TOKEN = 3.5;
const LINE = /^- \*\*\[(\d\d):(\d\d)\] ([^:*]+):\*\* (.*)$/;
const SECTIONS = [['session_log', 'Session log'], ['xp_per_pc', 'XP candidates'], ['feedback_card', 'Feedback card'], ['group_chat', 'Group chat highlights'], ['previously_on', 'Previously on'], ['prep_skeleton', 'Prep skeleton']];

const stamp = (t) => String(Math.floor(t / 60) % 24).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0');

/** Transcript note text -> [{ t (minutes from the first stamp's day start; past midnight keeps counting), stamp, text }]. */
export function parseTranscript(text) {
  const out = [];
  let day = 0, prev = -1;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const m = LINE.exec(raw);
    if (!m) continue;
    let t = Number(m[1]) * 60 + Number(m[2]);
    if (prev >= 0 && t + day < prev - 12 * 60) day += 1440;      // the clock wrapped past midnight
    t += day;
    prev = Math.max(prev, t);
    out.push({ t, stamp: m[1] + ':' + m[2], text: '[' + m[1] + ':' + m[2] + '] ' + m[3] + ': ' + m[4] });
  }
  return out;
}

/** Lines -> hour-long chunks from the first line: [{ from, to, text, lines }]. Empty hours are dropped. */
export function chunkLines(lines, size = 60) {
  if (!lines.length) return [];
  const first = lines[0].t, last = lines[lines.length - 1].t, chunks = [];
  for (let s = first; s <= last; s += size) {
    const part = lines.filter((l) => l.t >= s && l.t < s + size);
    if (part.length) chunks.push({ from: stamp(s), to: stamp(Math.min(s + size - 1, last)), text: part.map((l) => l.text).join('\n'), lines: part.length });
  }
  return chunks;
}

/** Rough dollars to send `chars` characters of input to a seat (the 1-hour cache write rate), used to refuse a call that cannot fit the cap. */
export function estimateInput(model, chars) {
  const p = PRICES[model];
  return p ? (chars / CHARS_PER_TOKEN) * p.in * 2 / 1e6 : 0;
}

/** { total, positioned, withDots, zeroDot, pushed } for a rolls array. */
export function rollStats(rolls) {
  const r = Array.isArray(rolls) ? rolls : [];
  return {
    total: r.length,
    positioned: r.filter((x) => x && x.position && x.position !== 'unclear').length,
    withDots: r.filter((x) => x && Number.isInteger(x.dots) && x.dots >= 0).length,
    complete: r.filter((x) => x && x.position && x.position !== 'unclear' && Number.isInteger(x.dots) && x.dots >= 0).length,
    zeroDot: r.filter((x) => x && x.dots === 0).length,
    pushed: r.filter((x) => x && x.pushed).length,
  };
}

/**
 * Run the Night Shift. opts: { client, prefix, lines (parseTranscript), mode: 'two-stage' | 'single', maxSpend, seats, onStep }.
 * Returns { ok, stopped, spend, parts: {sorters, writer}, rolls, sections, calls, sorted }.
 * stopped is '' | 'cap' | 'nojson' | 'empty'; on any stop nothing is to be filed (sorted is kept so the spend is not lost).
 */
export async function runNightShift({ client, prefix, lines, mode = 'two-stage', maxSpend = DEFAULT_CAP, seats = SEATS, onStep = () => {} }) {
  const res = { ok: false, stopped: '', reason: '', spend: 0, parts: { sorters: 0, writer: 0 }, calls: 0, rolls: [], sections: null, sorted: null, mode };
  if (!lines.length) { res.stopped = 'empty'; res.reason = 'no transcript lines'; return res; }
  const call = async (name, user, bucket) => {
    const r = await callSeat(client, { ...seats[name], prefix, user });
    res.spend += r.cost; res.parts[bucket] += r.cost; res.calls++;
    onStep(name, r);
    return r;
  };
  const stop = (why, reason) => { res.stopped = why; res.reason = reason; return res; };
  const first = lines[0].stamp, last = lines[lines.length - 1].stamp;

  if (mode === 'single') {
    const user = 'Session transcript, ' + first + ' to ' + last + ':\n' + lines.map((l) => l.text).join('\n');
    const need = estimateInput(seats.nightshift_single.model, (prefix || '').length + user.length);
    if (need >= maxSpend) return stop('cap', 'the one call would cost about $' + need.toFixed(2) + ' before any output: over the $' + maxSpend.toFixed(2) + ' cap');
    const r = await call('nightshift_single', user, 'writer');
    if (!r.json) return stop('nojson', 'the writer returned no JSON (stop=' + r.stop + ')');
    res.rolls = r.json.rolls || [];
    res.sections = Object.fromEntries(SECTIONS.map(([k]) => [k, r.json[k] || '']));
    res.ok = true;
    return res;
  }

  const chunks = chunkLines(lines);
  const sorted = await Promise.all(chunks.map(async (c) => {
    const r = await call('sorter', 'Transcript chunk ' + c.from + ' to ' + c.to + ':\n' + c.text, 'sorters');
    return { from: c.from, to: c.to, notes: r.json, stop: r.stop };
  }));
  res.sorted = sorted;
  if (sorted.some((s) => !s.notes)) return stop('nojson', 'a sorter returned no JSON (' + sorted.filter((s) => !s.notes).map((s) => s.from + ' stop=' + s.stop).join(', ') + ')');
  res.rolls = sorted.flatMap((s) => s.notes.rolls || []);
  if (res.spend >= maxSpend) return stop('cap', 'the sorters used $' + res.spend.toFixed(3) + ' and the cap is $' + maxSpend.toFixed(2) + ': the writer did not run');
  const notes = sorted.map((s) => ({ from: s.from, to: s.to, notes: s.notes }));
  const user = 'Session ran ' + first + ' to ' + last + ". Sorters' notes, one per hour chunk (each roll keeps its position and dots):\n" + JSON.stringify(notes);
  const need = estimateInput(seats.writer.model, (prefix || '').length + user.length);
  if (res.spend + need >= maxSpend) return stop('cap', 'the writer would take the total past the $' + maxSpend.toFixed(2) + ' cap (spent $' + res.spend.toFixed(3) + ', input alone about $' + need.toFixed(2) + ')');
  const w = await call('writer', user, 'writer');
  if (!w.json) return stop('nojson', 'the writer returned no JSON (stop=' + w.stop + ')');
  res.sections = Object.fromEntries(SECTIONS.map(([k]) => [k, w.json[k] || '']));
  res.ok = true;
  return res;
}

const cell = (v) => String(v == null ? '' : v).replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const dotsText = (d) => (d === 0 ? '0 (zero-dot)' : Number.isInteger(d) && d > 0 ? String(d) : '?');

/** The rolls as a markdown table (one row per roll). */
export function rollsTable(rolls) {
  if (!rolls.length) return '(no rolls found)';
  const head = '| At | Who | Action | Position | Effect | Dots | Pushed | Result |\n| --- | --- | --- | --- | --- | --- | --- | --- |';
  return head + '\n' + rolls.map((r) => '| ' + [r.at, r.who, r.action, r.position, r.effect, dotsText(r.dots), r.pushed ? 'yes' : 'no', r.result].map(cell).join(' | ') + ' |').join('\n');
}

/** Model text must not open a second `##` heading (that would break the one-heading rule): demote any heading of level 1 to 3. */
const flat = (s) => String(s || '').replace(/\r\n?/g, '\n').split('\n').map((l) => (/^#{1,3}\s/.test(l) ? '#### ' + l.replace(/^#+\s*/, '') : l)).join('\n').trim();

/** The whole block, from the `## Night Shift draft` heading on, as a string without a trailing newline. */
export function renderDraft(result, { date = '', session = '', from = '', to = '' } = {}) {
  const s = rollStats(result.rolls), sec = result.sections || {};
  const out = [
    '## ' + HEADING, '',
    '> [!note] Drafted by Claude' + (date ? ' on ' + date : '') + (session ? ' for session ' + session : '') + ' (' + (result.mode === 'single' ? 'one call' : 'sorters then writer') + '; $' + result.spend.toFixed(2) + '). Check it against the transcript before relying on it.',
    '> [!warning] XP is manual',
    '> Nothing here is awarded. The XP section lists possible triggers only; you mark xp yourself.', '',
    '### Rolls (' + s.total + '; ' + s.complete + ' with position and dots)', '', rollsTable(result.rolls), '',
  ];
  for (const [k, title] of SECTIONS) {
    out.push('### ' + title, '');
    if (k === 'xp_per_pc') out.push('*Candidates only. XP is the GM\'s to mark.*', '');
    out.push(flat(sec[k]) || '[TODO: empty]', '');
  }
  while (out.length && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

/** Where is the heading? -> { start, end } line indexes (end is exclusive: the next `## ` heading or the end), or null. */
export function findDraft(text) {
  const lines = String(text).split('\n');
  let fence = false, start = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].replace(/\r$/, '');
    if (/^(```|~~~)/.test(t.trim())) { fence = !fence; continue; }
    if (fence) continue;
    if (start < 0) { if (t.trim() === '## ' + HEADING) start = i; }
    else if (/^#{1,2} /.test(t.trim())) return { start, end: i };
  }
  return start < 0 ? null : { start, end: lines.length };
}
export const hasDraft = (text) => !!findDraft(text);

/**
 * Put the block into the note text: appended at the end when absent; when present, left alone (action 'present') unless
 * force, which swaps only the lines from the heading to the next `##` heading ('replaced'). Keeps the note's line ending.
 */
export function applyDraft(text, block, { force = false } = {}) {
  const crlf = /\r\n/.test(text);
  const eol = crlf ? '\r\n' : '\n';
  const blockLines = block.split('\n').map((l) => l + (crlf ? '\r' : ''));
  const found = findDraft(text);
  if (found && !force) return { text, action: 'present' };
  const lines = text.split('\n');
  if (found) {
    const after = lines.slice(found.end);
    const keepGap = after.length ? [crlf ? '\r' : ''] : [];
    return { text: [...lines.slice(0, found.start), ...blockLines, ...keepGap, ...after].join('\n'), action: 'replaced' };
  }
  while (lines.length && lines[lines.length - 1].replace(/\r$/, '').trim() === '') lines.pop();
  return { text: [...lines, crlf ? '\r' : '', ...blockLines, ''].join('\n'), action: 'added', eol };
}

/**
 * The prefix for the PC-side calls: the local pack's assist part (gm-private/b68-gm-pack.json, parts.assist.prefix) when it has
 * one; else built from the vault the way gm:pack builds it (read only). -> { prefix, from } or { prefix: '', from: '' }.
 */
export async function loadPrefix({ privateDir, vault }) {
  const { default: fs } = await import('node:fs');
  const { default: path } = await import('node:path');
  const packFile = path.join(privateDir, 'b68-gm-pack.json');
  try {
    const pack = JSON.parse(fs.readFileSync(packFile, 'utf8'));
    const p = pack && pack.parts && pack.parts.assist && pack.parts.assist.prefix;
    if (typeof p === 'string' && p.trim()) return { prefix: p, from: 'the local pack\'s assist part' };
  } catch (_) { /* no pack, or not readable: try the vault */ }
  try {
    const { buildAssist, readConfig } = await import('./assist-export.mjs');
    const a = buildAssist({ vault, exportedAt: '', config: readConfig(path.join(privateDir, 'assist-config.json')), playersFile: path.join(privateDir, 'players.json') });
    if (a && a.prefix) return { prefix: a.prefix, from: 'built from the vault (the pack has no assist part)' };
  } catch (_) { /* nothing usable */ }
  return { prefix: '', from: '' };
}
