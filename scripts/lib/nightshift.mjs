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

// ---- the app's own roll records, merged with the sorters' speech-derived rolls -------------------------------------------------
//
// What the GM app records is thinner than a roll sheet: gm:pull files each "L" capture of a console card as "- **HH:MM** Title:
// lead ^b68-id" under "## Rolled at the table". The Situations cards carry the result band in their title ("A 4/5" = a partial,
// "A 1-3" = a miss; "Before the roll" is only a Devil's Bargain offered ahead of a roll), and a title may carry a position in
// brackets if the app ever writes one, then the PC and the dots the GM set ("2d", zero is "0d"; only when set). There is no effect. So the app is authoritative for the fields it
// states (time, result band, position when bracketed) and the speech fills everything else; the speech never overwrites an app field.

const MATCH_MIN = 2;                                  // an app record and a spoken roll are the same roll within +/- 2 minutes
const POS_RE = /\((?:[^)]*?\b)?(controlled|risky|desperate)\b/i;
const EFFECTS = ['limited', 'standard', 'great'];
const unk = (v) => v == null || v === '' || v === 'unclear' || v === -1;
const clock = (at) => { const m = /(\d\d):(\d\d)/.exec(String(at || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const apart = (a, b) => { const d = Math.abs(a - b) % 1440; return Math.min(d, 1440 - d); };
const sameWho = (a, b) => { const x = String(a || '').trim().toLowerCase(), y = String(b || '').trim().toLowerCase(); return !x || !y || x === '?' || y === '?' || x === y || x.split(/\s+/)[0] === y.split(/\s+/)[0]; };

/**
 * The session note text -> the app-recorded rolls: [{ at '[HH:MM]', t, who '', position, result, card }]. Reads only the bullets
 * under "## Rolled at the table" (the hand-written table under "From the transcript" is not the app's and is ignored). Cards
 * that are not a roll outcome (Before the roll, Location, Downtime, ...) are not rolls and are skipped; their count is returned
 * as `others` by appRollsFrom().
 */
export function appRollsFrom(noteText) {
  const out = { rolls: [], others: 0 };
  let inside = false, fence = false;
  for (const raw of String(noteText || '').split(/\r?\n/)) {
    const line = raw.trim();
    if (/^(```|~~~)/.test(line)) { fence = !fence; continue; }
    if (fence) continue;
    if (/^#{1,6}\s/.test(line)) { inside = /^##\s+Rolled at the table\s*$/.test(line); continue; }
    if (!inside) continue;
    const m = /^- \*\*(\d\d):(\d\d)\*\* (.*?)(?:\s+\^b68-[\w-]+)?$/.exec(line);
    if (!m) continue;
    const body = m[3], t = Number(m[1]) * 60 + Number(m[2]);
    const result = /^A 4\/5\b/.test(body) ? 'partial' : /^A 1[–-]3\b/.test(body) ? 'miss' : '';
    if (!result) { out.others++; continue; }
    // the bracket after the title: "(risky, standard, Name)" from the app today, or the older "(desperate -> 3 winds, harm 3)"
    const p = POS_RE.exec(body), br = /^[^:(]*\(([^)]*)\)/.exec(body);
    const parts = br ? br[1].split(/[,;]/).map((x) => x.trim()).filter(Boolean) : [];
    const word = (x) => /^(controlled|risky|desperate|limited|standard|great)\b/i.test(x);
    const effect = (parts.find((x) => EFFECTS.includes(x.toLowerCase())) || '').toLowerCase();
    const dotsPart = parts.find((x) => /^[0-4]d$/i.test(x));      // "2d" or "0d": the dots the GM set on the console, only when set
    const who = parts.find((x) => !word(x) && !/^[0-4]d$/i.test(x) && !/[→·]/.test(x)) || '';
    out.rolls.push({ at: '[' + m[1] + ':' + m[2] + ']', t, who, effect, position: p ? p[1].toLowerCase() : '', result, card: body.split(/[:(]/)[0].trim(), ...(dotsPart ? { dots: Number(dotsPart[0]) } : {}) });
  }
  return out;
}
export const parseAppRolls = (noteText) => appRollsFrom(noteText).rolls;

/**
 * Merge the app's rolls (authoritative) with the speech rolls. Each app record claims the nearest unclaimed speech roll within
 * +/- 2 minutes whose character agrees (when the app names one) and whose result does not contradict it; the merged roll keeps the
 * speech's fields and the app's stated fields on top. An app record that claims nothing becomes a row of its own (source app);
 * a speech roll nobody claimed stays (source speech). -> rolls in time order, each with src 'app' | 'speech' | 'app+speech'
 * and `app` (the fields the app supplied).
 */
export function mergeRolls(speechRolls, appRolls) {
  const speech = (Array.isArray(speechRolls) ? speechRolls : []).map((r) => ({ ...r, src: 'speech', _t: clock(r.at) }));
  const taken = new Set(), out = [];
  for (const a of (Array.isArray(appRolls) ? appRolls : []).slice().sort((x, y) => x.t - y.t)) {
    let best = -1, bd = Infinity;
    speech.forEach((s, i) => {
      if (taken.has(i) || s._t == null) return;
      const d = apart(s._t, a.t);
      if (d > MATCH_MIN || d >= bd) return;
      if (!sameWho(a.who, s.who)) return;
      if (a.result && !unk(s.result) && s.result !== a.result) return;
      best = i; bd = d;
    });
    const fields = {};
    if (a.position) fields.position = a.position;
    if (a.result) fields.result = a.result;
    if (a.who) fields.who = a.who;
    if (a.effect) fields.effect = a.effect;
    if (Number.isInteger(a.dots) && a.dots >= 0) fields.dots = a.dots;
    if (typeof a.pushed === 'boolean') fields.pushed = a.pushed;
    if (best >= 0) {
      taken.add(best);
      const s = speech[best];
      out.push({ ...s, ...fields, src: 'app+speech', app: Object.keys(fields), _t: s._t });
    } else {
      out.push({ at: a.at, who: a.who || '?', action: 'recorded by the app (' + (a.card || 'card') + '), not found in the speech', position: 'unclear', effect: 'unclear', dots: -1, pushed: false, result: 'unclear', ...fields, src: 'app', app: Object.keys(fields), _t: a.t });
    }
  }
  speech.forEach((s, i) => { if (!taken.has(i)) out.push(s); });
  out.sort((x, y) => (x._t == null ? 1e9 : x._t) - (y._t == null ? 1e9 : y._t));
  return out.map(({ _t, ...r }) => r);
}

/**
 * XP candidates that are mechanical, computed from the merged table: desperate rolls, and zero-dot rolls when dots are known.
 * -> [{ who, at, action, kind: 'desperate' | 'zero-dot', src }] in time order. Candidates only; whether a roll counts (an action
 * roll, not a resistance or fortune roll) is the GM's call.
 */
export function xpCandidates(rolls) {
  const out = [];
  for (const r of Array.isArray(rolls) ? rolls : []) {
    if (!r) continue;
    if (r.position === 'desperate') out.push({ who: r.who, at: r.at, action: r.action, kind: 'desperate', src: r.src || 'speech' });
    if (r.dots === 0) out.push({ who: r.who, at: r.at, action: r.action, kind: 'zero-dot', src: r.src || 'speech' });
  }
  return out;
}

/** { app, speech, both } counts of a merged table by source. */
export function sourceStats(rolls) {
  const r = Array.isArray(rolls) ? rolls : [];
  const n = (s) => r.filter((x) => x && (x.src || 'speech') === s).length;
  return { app: n('app'), speech: n('speech'), both: n('app+speech') };
}

/** Merge into a stored result in place: result.rolls (speech) -> merged, result.xp computed. */
export function applyApp(result, appRolls) {
  result.speechRolls = result.speechRolls || result.rolls || [];
  result.rolls = mergeRolls(result.speechRolls, appRolls);
  result.xp = xpCandidates(result.rolls);
  return result;
}

const XP_NOTE = ' XP: desperate rolls and zero-dot rolls are computed by code from the rolls table and filed separately: do not list them in xp_per_pc.'
  + ' In xp_per_pc give only the judgement-based triggers from the transcript (beliefs, drives, heritage, background or vice played out; playbook and crew xp triggers), still as candidates.';
const withMergedRolls = (notes, rolls) => ({ chunks: notes.map((n) => ({ from: n.from, to: n.to, notes: { ...n.notes, rolls: undefined } })), merged_rolls: rolls });

/**
 * Run the Night Shift. opts: { client, prefix, lines (parseTranscript), mode: 'two-stage' | 'single', maxSpend, seats, onStep, appRolls }.
 * appRolls (parseAppRolls of the session note) are authoritative; the speech rolls fill the rest (see mergeRolls).
 * Returns { ok, stopped, spend, parts: {sorters, writer}, rolls, sections, calls, sorted }.
 * stopped is '' | 'cap' | 'nojson' | 'empty'; on any stop nothing is to be filed (sorted is kept so the spend is not lost).
 */
export async function runNightShift({ client, prefix, lines, mode = 'two-stage', maxSpend = DEFAULT_CAP, seats = SEATS, onStep = () => {}, appRolls = [] }) {
  const res = { ok: false, stopped: '', reason: '', spend: 0, parts: { sorters: 0, writer: 0 }, calls: 0, rolls: [], xp: [], sections: null, sorted: null, mode };
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
    const user = 'Session transcript, ' + first + ' to ' + last + ':\n' + lines.map((l) => l.text).join('\n') + '\n\n' + XP_NOTE.trim();
    const need = estimateInput(seats.nightshift_single.model, (prefix || '').length + user.length);
    if (need >= maxSpend) return stop('cap', 'the one call would cost about $' + need.toFixed(2) + ' before any output: over the $' + maxSpend.toFixed(2) + ' cap');
    const r = await call('nightshift_single', user, 'writer');
    if (!r.json) return stop('nojson', 'the writer returned no JSON (stop=' + r.stop + ')');
    res.speechRolls = r.json.rolls || [];
    res.rolls = mergeRolls(res.speechRolls, appRolls); res.xp = xpCandidates(res.rolls);
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
  res.speechRolls = sorted.flatMap((s) => s.notes.rolls || []);
  res.rolls = mergeRolls(res.speechRolls, appRolls); res.xp = xpCandidates(res.rolls);
  if (res.spend >= maxSpend) return stop('cap', 'the sorters used $' + res.spend.toFixed(3) + ' and the cap is $' + maxSpend.toFixed(2) + ': the writer did not run');
  const notes = sorted.map((s) => ({ from: s.from, to: s.to, notes: s.notes }));
  const user = 'Session ran ' + first + ' to ' + last + ". Sorters' notes, one per hour chunk, and the merged rolls table (rolls the GM app recorded win over what was said; each roll keeps its position and dots):\n" + JSON.stringify(withMergedRolls(notes, res.rolls)) + '\n\n' + XP_NOTE.trim();
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
  const head = '| At | Who | Action | Position | Effect | Dots | Pushed | Result | Source |\n| --- | --- | --- | --- | --- | --- | --- | --- | --- |';
  return head + '\n' + rolls.map((r) => '| ' + [r.at, r.who, r.action, r.position, r.effect, dotsText(r.dots), r.pushed ? 'yes' : 'no', r.result, r.src || 'speech'].map(cell).join(' | ') + ' |').join('\n');
}

/** The code-computed XP candidates, grouped by character, one line per trigger with its stamp and source. */
export function xpLines(xp) {
  if (!xp || !xp.length) return '(none: no desperate or zero-dot rolls in the table)';
  const by = new Map();
  for (const x of xp) { const k = x.who || '?'; if (!by.has(k)) by.set(k, []); by.get(k).push(x); }
  return [...by].map(([who, list]) => '**' + cell(who) + '** (' + list.length + ')\n' + list.map((x) => '- ' + cell(x.at) + ' ' + x.kind + ' roll' + (x.action ? ': ' + cell(x.action) : '') + ' (' + x.src + ')').join('\n')).join('\n');
}

/** Model text must not open a second `##` heading (that would break the one-heading rule): demote any heading of level 1 to 3. */
const flat = (s) => String(s || '').replace(/\r\n?/g, '\n').split('\n').map((l) => (/^#{1,3}\s/.test(l) ? '#### ' + l.replace(/^#+\s*/, '') : l)).join('\n').trim();

/** The whole block, from the `## Night Shift draft` heading on, as a string without a trailing newline. */
export function renderDraft(result, { date = '', session = '', from = '', to = '' } = {}) {
  const s = rollStats(result.rolls), src = sourceStats(result.rolls), sec = result.sections || {};
  const xp = result.xp || xpCandidates(result.rolls);
  const out = [
    '## ' + HEADING, '',
    '> [!note] Drafted by Claude' + (date ? ' on ' + date : '') + (session ? ' for session ' + session : '') + ' (' + (result.mode === 'single' ? 'one call' : 'sorters then writer') + '; $' + result.spend.toFixed(2) + '). Check it against the transcript before relying on it.',
    '> [!warning] XP is manual',
    '> Nothing here is awarded. The XP section lists possible triggers only; you mark xp yourself.', '',
    '### Rolls (' + s.total + '; ' + s.complete + ' with position and dots)', '',
    '*' + (src.app + src.both) + ' recorded by the app, ' + (src.speech + src.both) + ' heard in the speech. Source: app = the GM app\'s own record (it wins wherever it states a field); speech = heard in the transcript; app+speech = matched within 2 minutes, the app\'s fields kept.*', '',
    rollsTable(result.rolls), '',
  ];
  for (const [k, title] of SECTIONS) {
    out.push('### ' + title, '');
    if (k === 'xp_per_pc') {
      out.push('*Candidates only. XP is the GM\'s to mark.*', '',
        '**Computed from the rolls table (' + xp.length + '):** desperate rolls and zero-dot rolls. Action rolls only: drop resistance and fortune rolls by hand.', '', xpLines(xp), '',
        '**From the transcript (judgement):**', '');
    }
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
