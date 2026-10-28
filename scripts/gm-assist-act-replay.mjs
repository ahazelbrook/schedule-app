#!/usr/bin/env node
// C1: replay a transcript through the co-GM's `hands` seat, window by window, the way POST /api/gm/assist/act would (the same seat, the same user turn, the same
// validation in functions/_lib/assist/hands.js), and write what it would have done to actions.md. Offline: it never touches the Worker or D1, and it applies
// nothing real. By default the windows are the PAGE's: app/gm/cogm.js's own pre-filter and window builder are run over the transcript (scripts/lib/act-replay.mjs cogmWindows), so only the windows
// the pre-filter matches go to the seat. --no-prefilter cuts by time instead, for comparison: the transcript is stamped to the minute, so a 30-second window is not
// possible, and it is a 2-minute window every minute (overlap on purpose: a re-sent window must not apply twice, and its keys show that).
//
//   node scripts/gm-assist-act-replay.mjs --transcript <file> --state <json> [--from HH:MM] [--to HH:MM] [--window 2] [--step 1] [--max-windows 30] [--max-spend 0.25] [--budget 0.5] [--no-prefilter] [--out gm-private/...] [--fake]
//
//   --transcript   a transcript in the vault's form, `- **[HH:MM] Name:** text` per line (an invented one for tests: gm-private/ or a fixture; never commit a real one)
//   --state        the table's state as the page would send it: { clocks: [{ id, name, size, filled, hidden }], npcs: [{ id, name }], pcs: [{ id, name }], onStage }
//   --fake         no network and no key: a stand-in model (scripts/lib/act-replay.mjs) so the plumbing can be checked for free
//   --no-prefilter  window by time (--window/--step) instead of by cogm.js's pre-filter
//   --max-spend    stop when the calls so far cost this much (default 0.25; refused above --budget)
//   --budget       the ceiling for --max-spend (default 0.5; at most 1)
//   --out          where actions.md, actions.json, calls.jsonl and summary.txt go; must be under gm-private/ (default gm-private/assist-act-replay/<timestamp>)
//
// The key is read from the environment variable B68_ANTHROPIC_KEY, never ANTHROPIC_API_KEY (Claude Code reads that name and would bill it instead of Max), and is never printed.
// The seat is given NO prefix. What it prints is counts and money; the talk and the actions go only to the files under gm-private/.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeClient, callSeat } from '../functions/_lib/assist/claude.js';
import { SEATS } from '../functions/_lib/assist/seats.js';
import { DEADLINE_MS } from '../functions/_lib/assist/leases.js';
import { handsUser } from '../functions/_lib/assist/prompts.js';
import { cleanState, validateActions } from '../functions/_lib/assist/hands.js';
import { rowsOf, windowsOf, cogmWindows, lineOf, talkOf, applyToState, fakeHandsCall, describe } from './lib/act-replay.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const die = (msg) => { console.error(msg); process.exit(2); };
const toMin = (hhmm) => { const m = /^(\d\d):(\d\d)$/.exec(hhmm || ''); if (!m) die(`bad time ${hhmm}: HH:MM`); return Number(m[1]) * 60 + Number(m[2]); };
const BUDGET = Number(arg('budget', '0.5'));
if (!(BUDGET > 0) || BUDGET > 1) die('--budget must be above 0 and at most 1');

const transcriptFile = arg('transcript'), stateFile = arg('state', path.join(ROOT, 'gm-private', 'hands-state.json'));
if (!transcriptFile) die('--transcript <file> is required');
const fake = flag('fake');
const maxSpend = Number(arg('max-spend', '0.25'));
if (!(maxSpend > 0) || maxSpend > BUDGET) die(`--max-spend must be above 0 and at most ${BUDGET} (--budget)`);
const maxWindows = Number(arg('max-windows', '30'));
if (!Number.isInteger(maxWindows) || maxWindows < 1) die('--max-windows must be a whole number, 1 or more');
const outDir = path.resolve(arg('out', path.join(ROOT, 'gm-private', 'assist-act-replay', new Date().toISOString().replace(/[:.]/g, '-'))));
if (path.relative(path.join(ROOT, 'gm-private'), outDir).startsWith('..')) die('--out must be under gm-private/ (the files hold the talk)');

let key = '';
if (!fake) {
  key = process.env.B68_ANTHROPIC_KEY || '';
  if (!key) die('Set B68_ANTHROPIC_KEY first (a user environment variable), or use --fake.');
}
const rows = rowsOf(fs.readFileSync(transcriptFile, 'utf8'));
if (!rows.length) die('no transcript lines found (expected `- **[HH:MM] Name:** text`)');
let state;
try { state = cleanState(JSON.parse(fs.readFileSync(stateFile, 'utf8'))); } catch (e) { die(`state file: ${e.message}`); }
const range = { from: arg('from') ? toMin(arg('from')) : -1, to: arg('to') ? toMin(arg('to')) : 1e9 };
const timeWindows = windowsOf(rows, { window: Number(arg('window', '2')), step: Number(arg('step', '1')), ...range });
const pre = flag('no-prefilter') ? null : cogmWindows(rows.filter((r) => r.t >= range.from && r.t <= range.to));
const windows = pre ? pre.windows : timeWindows;
if (!windows.length) die('no windows to replay');

const client = fake ? null : makeClient(key);
fs.mkdirSync(outDir, { recursive: true });
const md = [`# hands replay${fake ? ' (FAKE model)' : ''}`, '', `${rows.length} lines, ${pre ? `${pre.matchedLines} lines matched the pre-filter, ${windows.length} windows to send (of ${timeWindows.length} time windows seen)` : `${windows.length} time windows (no pre-filter)`}, at most ${maxWindows} run`, ''];
const acts = [];
const calls = [];
const appliedKeys = new Set();
const tally = { windows: 0, actions: 0, act: 0, offer: 0, dropped: 0, byType: {}, droppedWhy: {}, stops: {}, errors: 0, skippedKeys: 0 };
let spend = 0, stopped = '', inTok = 0, outTok = 0;

for (const win of windows) {
  if (tally.windows >= maxWindows) { stopped = 'max-windows'; break; }
  if (spend >= maxSpend) { stopped = 'budget'; break; }
  tally.windows++;
  const user = handsUser({ state, stamp: win.rows[win.rows.length - 1].stamp, talk: talkOf(win) });
  let r = null, err = '';
  try {
    r = fake ? fakeHandsCall({ user, n: tally.windows }) : await callSeat(client, { ...SEATS.hands, user, deadlineMs: DEADLINE_MS.hands });
  } catch (e) { err = e && Number.isInteger(e.status) ? `provider status ${e.status}` : 'call failed'; tally.errors++; }
  if (r) { spend += r.cost || 0; inTok += (r.usage && r.usage.input_tokens) || 0; outTok += (r.usage && r.usage.output_tokens) || 0; tally.stops[r.stop || ''] = (tally.stops[r.stop || ''] || 0) + 1; }
  const usable = r && r.stop !== 'refusal' && r.stop !== 'max_tokens' && r.json && Array.isArray(r.json.actions);
  const v = usable ? validateActions(r.json.actions, { state, lines: win.rows }) : { actions: [], dropped: [] };
  const step = applyToState(state, v.actions, appliedKeys);
  state = step.state;
  tally.actions += v.actions.length; tally.dropped += v.dropped.length; tally.skippedKeys += step.skipped.length;
  for (const a of v.actions) { tally[a.mode]++; tally.byType[a.type] = (tally.byType[a.type] || 0) + 1; }
  for (const d of v.dropped) tally.droppedWhy[d.why] = (tally.droppedWhy[d.why] || 0) + 1;
  calls.push({ from: win.from, to: win.to, lines: win.rows.length, stop: r ? r.stop : '', secs: r ? r.secs : 0, in: r && r.usage ? r.usage.input_tokens : 0, out: r && r.usage ? r.usage.output_tokens : 0, cost: r ? r.cost : 0, raw: usable ? r.json.actions.length : 0, kept: v.actions.length, dropped: v.dropped.length, ...(err ? { error: err } : {}) });
  const used = r && r.usage ? `, in ${r.usage.input_tokens} out ${r.usage.output_tokens} $${(r.cost || 0).toFixed(4)}` : '';
  md.push(`## ${win.rows[0].stamp} to ${win.rows[win.rows.length - 1].stamp} (seq ${win.from}-${win.to}, ${win.rows.length} lines${win.matched ? ', matched ' + win.matched.length : ''}${r ? `, stop ${r.stop}` : ''}${used}${err ? ', ' + err : ''})`, '');
  if (!v.actions.length && !v.dropped.length) md.push('(nothing)', '');
  for (const a of v.actions) {
    const seq = lineOf(win.rows, a.quote), again = step.skipped.includes(a);
    md.push(`- ${describe(a)}`, `  - quote: "${a.quote}"${a.at ? ' at ' + a.at : ''}, line ${seq || '?'}${again ? '  (already applied: a re-sent window)' : ''}`);
    acts.push({ window: { from: win.from, to: win.to }, call: calls.length, line: seq, resent: again, ...a });
  }
  for (const d of v.dropped) md.push(`- DROPPED ${d.type || '?'}: ${d.why}${d.name ? ' (' + d.name + ')' : ''}`);
  md.push('');
}

const summary = [
  pre ? `pre-filter: ${pre.matchedLines} of ${rows.length} lines matched; ${windows.length} windows to send of ${timeWindows.length} time windows seen` : 'no pre-filter: time windows',
  `windows run ${tally.windows} of ${windows.length}${stopped ? ' (stopped: ' + stopped + ')' : ''}`,
  `actions kept ${tally.actions} (act ${tally.act}, offer ${tally.offer}); by type ${JSON.stringify(tally.byType)}`,
  `dropped ${tally.dropped}; by reason ${JSON.stringify(tally.droppedWhy)}`,
  `re-sent keys not applied twice ${tally.skippedKeys}; call errors ${tally.errors}`,
  `stop reasons ${JSON.stringify(tally.stops)} (max_tokens ${tally.stops.max_tokens || 0})`,
  `tokens in ${inTok}, out ${outTok}`,
  `spend $${spend.toFixed(4)}${fake ? ' (fake: nothing billed)' : ''}; limit $${maxSpend}`,
].join('\n');
fs.writeFileSync(path.join(outDir, 'actions.md'), md.join('\n') + '\n');
fs.writeFileSync(path.join(outDir, 'actions.json'), JSON.stringify({ lines: rows.length, matchedLines: pre ? pre.matchedLines : null, prefilter: !!pre, windowsSeen: timeWindows.length, windowsToSend: windows.length, windowsRun: tally.windows, spend, tokens: { in: inTok, out: outTok }, calls, actions: acts }, null, 1) + '\n');
fs.writeFileSync(path.join(outDir, 'calls.jsonl'), calls.map((c) => JSON.stringify(c)).join('\n') + '\n');
fs.writeFileSync(path.join(outDir, 'summary.txt'), summary + '\n');
console.log(summary);
console.log('written to ' + path.relative(ROOT, outDir));
