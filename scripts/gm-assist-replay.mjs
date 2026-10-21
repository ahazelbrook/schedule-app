#!/usr/bin/env node
// Phase 0 of "Claude at the table": replay a finished session's transcript through the assist seats, a minute at a time,
// and see what each one would have said. Offline: it never touches the Worker or the D1 database.
//
//   node scripts/gm-assist-replay.mjs --transcript <file> --context <file> [--context <file> ...] --count
//   node scripts/gm-assist-replay.mjs --transcript <file> --context <file> --from 22:10 --to 22:30 --out <dir>
//
//   --count           free: count the tokens in the context and the transcript (no model is run, nothing is billed)
//   --from / --to     HH:MM window of the transcript to replay (default: all of it)
//   --seat-window s@HH:MM[@since],...   run voice/stall/showrunner/mystery at chosen minutes (writes seat-window.md)
//   --nightshift      hour-long chunks -> sorters in parallel -> writer; writes nightshift.md
//   --seats a,b,c    which seats run (default tripwire,ref,clerk,ledger)
//   --set seat.k=v    override a seat's model or effort for a sweep, e.g. --set ref.effort=high
//   --max-spend <$>   stop when the calls so far cost this much (default 3)
//   --out <dir>       where calls.jsonl and summary.txt go (default gm-private/assist-replay/<timestamp>)
//
// The key is read from the environment variable B68_ANTHROPIC_KEY, never ANTHROPIC_API_KEY (Claude Code reads that
// name and would bill it instead of Max). The context files hold the campaign, so they stay in the vault and nothing
// here prints their text. This script and the seat prompts are generic and safe to commit.

import fs from 'node:fs';
import path from 'node:path';
import { makeClient, callSeat, countTokens } from '../functions/_lib/assist/claude.js';
import { SEATS, WAKES } from '../functions/_lib/assist/seats.js';

const argv = process.argv.slice(2);
const flag = n => argv.includes(`--${n}`);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const args = n => argv.flatMap((a, i) => (a === `--${n}` ? [argv[i + 1]] : []));

const transcriptFile = arg('transcript');
const contextFiles = args('context');
if (!transcriptFile) { console.error('--transcript <file> is required'); process.exit(2); }

const seats = (arg('seats', 'tripwire,ref,clerk,ledger')).split(',').map(s => s.trim()).filter(Boolean);
const registry = structuredClone(SEATS);
for (const s of args('set')) {
  const m = /^(\w+)\.(model|effort|maxTokens)=(.+)$/.exec(s);
  if (!m || !registry[m[1]]) { console.error(`bad --set ${s}`); process.exit(2); }
  registry[m[1]][m[2]] = m[2] === 'maxTokens' ? Number(m[3]) : m[3];
}

const toMin = hhmm => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const from = arg('from') ? toMin(arg('from')) : -1;
const to = arg('to') ? toMin(arg('to')) : 1e9;

// Lines look like "- **[HH:MM] Name:** text". Anything else (reconnect markers, headings) is skipped.
const LINE = /^- \*\*\[(\d\d):(\d\d)\] ([^:*]+):\*\* (.*)$/;
const minutes = new Map();
for (const raw of fs.readFileSync(transcriptFile, 'utf8').split(/\r?\n/)) {
  const m = LINE.exec(raw);
  if (!m) continue;
  const t = Number(m[1]) * 60 + Number(m[2]);
  if (t < from || t > to) continue;
  if (!minutes.has(t)) minutes.set(t, []);
  minutes.get(t).push(`[${m[1]}:${m[2]}] ${m[3]}: ${m[4]}`);
}
const order = [...minutes.keys()].sort((a, b) => a - b);
const stamp = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
const textFor = (from_, to_) => order.filter(t => t >= from_ && t <= to_).flatMap(t => minutes.get(t)).join('\n');

const prefix = contextFiles.length
  ? contextFiles.map(f => `<context name="${path.basename(f)}">\n${fs.readFileSync(f, 'utf8')}\n</context>`).join('\n\n')
  : '';

const key = process.env.B68_ANTHROPIC_KEY;
if (!key) { console.error('Set B68_ANTHROPIC_KEY first (a user environment variable).'); process.exit(2); }
const client = makeClient(key);

if (flag('count')) {
  const all = order.flatMap(t => minutes.get(t)).join('\n');
  const models = [...new Set(seats.map(s => registry[s].model))];
  console.log(`minutes with talk: ${order.length}, lines: ${order.reduce((n, t) => n + minutes.get(t).length, 0)}`);
  for (const model of models) {
    const ctx = prefix ? await countTokens(client, { model, prefix, user: 'x' }) : 0;
    const tr = await countTokens(client, { model, user: all || 'x' });
    console.log(`${model}: context ${ctx} tokens, transcript ${tr} tokens`);
  }
  process.exit(0);
}

const outDir = arg('out', path.join('gm-private', 'assist-replay', new Date().toISOString().replace(/[:.]/g, '-')));
fs.mkdirSync(outDir, { recursive: true });
const log = fs.createWriteStream(path.join(outDir, 'calls.jsonl'));
const maxSpend = Number(arg('max-spend', 3));
const spend = {}, calls = {}, cards = [];
let total = 0;

async function run(seat, at, user) {
  const cfg = registry[seat];
  const r = await callSeat(client, { ...cfg, prefix, user });
  total += r.cost; spend[seat] = (spend[seat] || 0) + r.cost; calls[seat] = (calls[seat] || 0) + 1;
  log.write(JSON.stringify({ at, seat, model: cfg.model, effort: cfg.effort, usage: r.usage, cost: r.cost, stop: r.stop, json: r.json }) + '\n');
  if (r.json === null) {
    console.error(`${at} ${seat}: no JSON (stop=${r.stop}, ${r.usage?.output_tokens} output tokens)`);
    fs.writeFileSync(path.join(outDir, `failed-${seat}-${at.replace(':', '')}.txt`), r.text || '');
  }
  return r.json;
}

// --fixer 22:09,22:23: run the Fixer as if a position had just been set at each minute, and write fixer.md
if (arg('fixer')) {
  const out = [];
  for (const hhmm of arg('fixer').split(',')) {
    const t = toMin(hhmm);
    const j = await run('fixer', hhmm, `A roll is about to be made. Last five minutes, up to ${hhmm}:\n${textFor(t - 4, t)}`);
    out.push(`## ${hhmm}\n` + (j ? Object.entries(j).map(([k, v]) => `- **${k}:** ${v}`).join('\n') : '(no JSON)'));
  }
  fs.writeFileSync(path.join(outDir, 'fixer.md'), out.join('\n\n') + '\n');
  console.log(out.join('\n\n') + `\n\nfixer total: $${total.toFixed(3)}`);
  process.exit(0);
}


// --once seat@HH:MM@since: run one seat once over the transcript from `since` to HH:MM (the close-out check), and write <seat>-once.json
if (arg('once')) {
  const [seat, at, since] = arg('once').split('@');
  const j = await run(seat, at, `Transcript from ${since} to ${at}:\n${textFor(toMin(since), toMin(at))}`);
  fs.writeFileSync(path.join(outDir, `${seat}-once.json`), JSON.stringify(j, null, 2) + '\n');
  console.log(JSON.stringify(j, null, 2) + `\n\n${seat} total: $${total.toFixed(3)}`);
  process.exit(0);
}

// --seat-window seat@HH:MM[@since],...: run voice/stall/showrunner/mystery at chosen minutes and write seat-window.md.
// Without @since, voice and stall read the last 5 minutes; showrunner and mystery read from the start of the replay.
if (arg('seat-window')) {
  const WINDOW_MIN = { voice: 5, stall: 5 };
  const out = [];
  for (const spec of arg('seat-window').split(',')) {
    const [seat, at, since] = spec.trim().split('@');
    if (!registry[seat]) { console.error(`unknown seat ${seat}`); process.exit(2); }
    if (total >= maxSpend) { console.error(`spend cap $${maxSpend} reached before ${spec}`); break; }
    const t = toMin(at);
    const start = since ? toMin(since) : (WINDOW_MIN[seat] ? t - WINDOW_MIN[seat] + 1 : -1);
    const before = total;
    const j = await run(seat, at, `Transcript up to ${at}${since || WINDOW_MIN[seat] ? ` (from ${stamp(Math.max(start, 0))})` : ' (from the start)'}:\n${textFor(start, t)}`);
    out.push(`## ${seat} @ ${at}  ($${(total - before).toFixed(4)}, ${registry[seat].model} ${registry[seat].effort})\n\n` +
      (j ? '```json\n' + JSON.stringify(j, null, 2) + '\n```' : '(no JSON)'));
  }
  fs.writeFileSync(path.join(outDir, 'seat-window.md'), out.join('\n\n') + '\n');
  console.log(out.join('\n\n') + `\n\nseat-window total: $${total.toFixed(3)}  ${JSON.stringify(spend)}`);
  process.exit(0);
}

// --nightshift: cut the replay window into hour-long chunks, run a sorter on each in parallel, then the writer on their
// output; write nightshift.md (and nightshift.json). Honours --from/--to; --max-spend is checked before the writer.
if (flag('nightshift')) {
  if (!order.length) { console.error('no transcript lines in range'); process.exit(2); }
  const first = order[0];
  const chunks = [];
  for (let s = first; s <= order[order.length - 1]; s += 60) chunks.push([s, s + 59]);
  const sorted = await Promise.all(chunks.map(async ([a, b]) => {
    const j = await run('sorter', stamp(a), `Transcript chunk ${stamp(a)} to ${stamp(Math.min(b, order[order.length - 1]))}:\n${textFor(a, b)}`);
    return { from: stamp(a), to: stamp(b), notes: j };
  }));
  const sorterCost = total;
  if (sorted.some(s => !s.notes)) { console.error('a sorter returned no JSON; stopping before the writer'); process.exit(1); }
  if (total >= maxSpend) { console.error(`spend cap $${maxSpend} reached before the writer`); process.exit(1); }
  const w = await run('writer', 'night', `Session ran ${stamp(first)} to ${stamp(order[order.length - 1])}. Sorters' notes, one per hour chunk:\n${JSON.stringify(sorted, null, 1)}`);
  const titles = { session_log: 'Session log', xp_per_pc: 'XP per PC', feedback_card: 'Feedback card', group_chat: 'Group chat highlights', previously_on: 'Previously on', prep_skeleton: 'Prep skeleton' };
  const md = [
    `# Night Shift draft`, '',
    `Sorters: ${chunks.length} chunks, $${sorterCost.toFixed(3)}. Writer: $${(total - sorterCost).toFixed(3)}. Total $${total.toFixed(3)}.`, '',
    ...(w ? Object.entries(titles).flatMap(([k, t]) => [`## ${t}`, '', w[k] || '(empty)', '']) : ['(writer returned no JSON)']),
    '---', '## Sorter notes (raw)', '', '```json', JSON.stringify(sorted, null, 1), '```', '',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'nightshift.md'), md);
  fs.writeFileSync(path.join(outDir, 'nightshift.json'), JSON.stringify({ sorted, writer: w, spend }, null, 1) + '\n');
  console.log(`nightshift: ${chunks.length} sorters $${sorterCost.toFixed(3)}, writer $${(total - sorterCost).toFixed(3)}, total $${total.toFixed(3)}\nwritten to ${outDir}`);
  process.exit(0);
}

for (const t of order) {
  if (total >= maxSpend) { console.error(`stopped at ${stamp(t)}: spend cap $${maxSpend} reached`); break; }
  const at = stamp(t);
  const tw = seats.includes('tripwire') ? await run('tripwire', at, `Minute ${at}:\n${minutes.get(t).join('\n')}`) : null;
  const flags = tw ? Object.keys(tw).filter(k => tw[k]) : Object.values(WAKES).flat();
  const recent = `Last four minutes, up to ${at}:\n${textFor(t - 3, t)}`;
  const woken = Object.keys(WAKES).filter(s => seats.includes(s) && WAKES[s].some(f => flags.includes(f)));
  const results = await Promise.all(woken.map(async s => [s, await run(s, at, recent)]));
  for (const [s, j] of results) {
    if (s === 'ref' && j?.slip) cards.push(`${at} REF  said ${j.said_at}: ${j.card}`);
    if (s === 'clerk' && j && (j.new_names.length || j.drift.length)) cards.push(`${at} CLERK names=${j.new_names.join('|')} drift=${j.drift.join('|')}`);
    if (s === 'ledger' && j?.xp_totalled) cards.push(`${at} LEDGER xp totalled`);
  }
  if (flags.length) console.log(`${at} flags: ${flags.join(',')}${woken.length ? '  woke: ' + woken.join(',') : ''}`);
}

const lines = [
  `replayed ${order.length} minutes, ${stamp(order[0] ?? 0)} to ${stamp(order[order.length - 1] ?? 0)}`,
  ...Object.keys(spend).map(s => `${s}: ${calls[s]} calls, $${spend[s].toFixed(3)}`),
  `total: $${total.toFixed(3)}`,
  '', 'cards:', ...(cards.length ? cards : ['(none)']),
];
fs.writeFileSync(path.join(outDir, 'summary.txt'), lines.join('\n') + '\n');
console.log('\n' + lines.join('\n') + `\n\nwritten to ${outDir}`);
