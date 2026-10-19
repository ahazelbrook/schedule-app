#!/usr/bin/env node
// A live end-to-end run of "Claude at the table", GM side: the REAL tick handler (functions/api/gm/assist.js) driven over a
// finished session's transcript, one tick a minute, on an in-memory D1 stand-in, with the REAL Anthropic client.
// It is the Phase 1 acceptance run: what would the Conductor and Editor have let through, and what did it cost.
//
//   node scripts/gm-assist-e2e.mjs --transcript <file> --context <file> [--context <file> ...]
//                                  [--from HH:MM] [--to HH:MM] [--cap 4] [--out gm-private/assist-e2e-report.txt]
//                                  [--hard-stop <$>] [--fake] [--slips 22:14,22:24]
//
//   --context     a note that goes in the cached prefix as <context name="...">, in the order given (repeatable)
//   --cap         the Worker's ASSIST_CAP_USD for the run (default 4): the Conductor's budget ladder works against it
//   --hard-stop   stop ticking when the log says this much has been spent (default cap + 0.5)
//   --slips       HH:MM stamps of slips known in advance; the report lists what appeared near each (no judgement is made)
//   --fake        no network and no key: a canned client, to check the harness itself
//
// The key is read from the environment variable B68_ANTHROPIC_KEY, never ANTHROPIC_API_KEY (Claude Code reads that name and
// would bill it instead of the plan). It is passed to the SDK and never printed or written. The transcript and the context
// hold the campaign, so they stay in the vault; the report is written under gm-private/ (git-ignored). This script is generic
// and safe to commit.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from './lib/d1.mjs';
import { cleanLines, addLines, patchStt } from '../functions/_lib/stt.js';
import { makeClient } from '../functions/_lib/assist/claude.js';
import { WAKES } from '../functions/_lib/assist/seats.js';
import { makeHandler } from '../functions/api/gm/assist.js';
import { estimateTokens, contextBlock } from './lib/assist-export.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(`--${n}`);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const args = (n) => argv.flatMap((a, i) => (a === `--${n}` ? [argv[i + 1]] : []));
const die = (m) => { console.error(m); process.exit(2); };

const transcriptFile = arg('transcript');
const contextFiles = args('context');
if (!transcriptFile) die('--transcript <file> is required');
const cap = Number(arg('cap', 4));
if (!(cap > 0)) die('--cap must be a positive number of dollars');
const hardStop = Number(arg('hard-stop', cap + 0.5));
const outFile = path.resolve(REPO, arg('out', path.join('gm-private', 'assist-e2e-report.txt')));
const fake = flag('fake');

const toMin = (hhmm) => { const m = /^(\d\d?):(\d\d)$/.exec(hhmm || ''); if (!m) die('bad time ' + hhmm + ' (want HH:MM)'); return Number(m[1]) * 60 + Number(m[2]); };
const stamp = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
const from = arg('from') ? toMin(arg('from')) : -1;
const to = arg('to') ? toMin(arg('to')) : 1e9;

// ---- the transcript: "- **[HH:MM] Name:** text", dated by `date: DD/MM/YYYY` in its frontmatter
const raw = fs.readFileSync(transcriptFile, 'utf8').replace(/\r\n?/g, '\n');
const dm = /^date:\s*(\d\d)\/(\d\d)\/(\d{4})\s*$/m.exec(raw);
if (!dm) die('the transcript has no `date: DD/MM/YYYY` in its frontmatter');
const [DAY, MON, YEAR] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
const LINE = /^- \*\*\[(\d\d):(\d\d)\] ([^:*]+):\*\* (.*)$/;
const minutes = new Map();
for (const l of raw.split('\n')) {
  const m = LINE.exec(l);
  if (!m) continue;
  const t = Number(m[1]) * 60 + Number(m[2]);
  if (t < from || t > to) continue;
  if (!minutes.has(t)) minutes.set(t, []);
  minutes.get(t).push({ who: m[3].trim(), text: m[4] });
}
if (!minutes.size) die('no transcript lines in that window');
const first = Math.min(...minutes.keys()), last = Math.max(...minutes.keys());
// A label "S<n>" is Deepgram's own speaker number n (left unnamed, as the page shows it before "Who is who" names it); any other
// label is a name the GM gave, kept in the control document (at most 16) under an id of its own from 40 up.
const speakerIds = new Map();
for (const t of [...minutes.keys()].sort((a, b) => a - b)) for (const x of minutes.get(t)) {
  if (speakerIds.has(x.who)) continue;
  const m = /^S(\d{1,2})$/.exec(x.who);
  speakerIds.set(x.who, m && Number(m[1]) < 40 ? Number(m[1]) : 40 + [...speakerIds.keys()].filter((k) => !/^S\d{1,2}$/.test(k) || Number(k.slice(1)) >= 40).length);
}
const named = [...speakerIds].filter(([name]) => !/^S\d{1,2}$/.test(name));
if (named.length > 16 || speakerIds.size > 64) die('too many speaker labels for the control document');

// Melbourne wall-clock -> epoch ms (the handler formats stamps in Australia/Melbourne)
const melb = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', hour12: false });
function melbMs(min, sec) {
  for (const off of [11, 10]) {
    const ms = Date.UTC(YEAR, MON - 1, DAY, Math.floor(min / 60) - off, min % 60, sec);
    if (melb.format(new Date(ms)).replace(/^24:/, '00:') === stamp(min)) return ms;
  }
  die('could not place ' + stamp(min) + ' on ' + DAY + '/' + MON + '/' + YEAR + ' in Melbourne');
}

// ---- the prefix: the context files, as in the replay
const prefix = contextFiles.map((f) => contextBlock(f, fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'))).join('\n\n');
if (!prefix) console.error('(no --context: the seats run without a cached prefix)');

// ---- the client
let client;
if (fake) {
  const NONE = Object.fromEntries(['roll_talk', 'harm', 'npc_change', 'new_name', 'clue_mention', 'xp_trigger', 'scene_change', 'stall'].map((f) => [f, false]));
  let n = 0;
  client = { messages: { async create(req) {
    const ins = req.system[req.system.length - 1].text;
    const body = /listen to a live/.test(ins) ? { ...NONE, roll_talk: n++ % 2 === 0 } : /rules referee/.test(ins) ? { slip: true, said_at: '00:00', what_was_said: 'x', rule: 'Rule ' + n + ' (p.1)', card: 'Fake card ' + n }
      : /keep the ledger/.test(ins) ? { events: [], xp_totalled: false } : { new_names: [], drift: [], clues_landed: [] };
    return { content: [{ type: 'text', text: JSON.stringify(body) }], usage: { input_tokens: 500, output_tokens: 100, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 }, stop_reason: 'end_turn' };
  } } };
} else {
  const key = process.env.B68_ANTHROPIC_KEY;
  if (!key) die('Set B68_ANTHROPIC_KEY first (a user environment variable). ANTHROPIC_API_KEY is deliberately not read.');
  client = makeClient(key);
}

// ---- the stand-in D1, the control document and the cached prefix
const exec = await memoryExec({ schemaFile: path.join(REPO, 'schema.sql') });
const db = asD1(exec);
const CAMPAIGN = 'e2e';
await patchStt(db, CAMPAIGN, { speakers: Object.fromEntries(named.map(([name, id]) => [String(id), name])) });
if (prefix) exec.db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES (?, 'assist', 'e2e', '{}', 0, ?)").run(CAMPAIGN, JSON.stringify({ prefix }));

let clock = melbMs(first, 0);
const handler = makeHandler({ clientFor: () => client, now: () => clock });
const env = { DB: db, CAMPAIGN, ANTHROPIC_API_KEY: 'unused-by-the-injected-client', ASSIST_CAP_USD: String(cap) };
const GM = { role: 'gm', id: 'gm@example.test' };
const tick = async (after) => {
  const res = await handler({ request: new Request('https://e2e.invalid/api/gm/assist/tick', { method: 'POST', body: JSON.stringify(after === null ? {} : { after }) }), env, data: { me: GM } });
  return JSON.parse(await res.text());
};
const spentSoFar = () => (exec.db.prepare('SELECT COALESCE(SUM(cents), 0) AS c FROM gm_assist_log').get().c) / 100;
const logRows = () => exec.db.prepare('SELECT id, at, seat, model, effort, input_tokens, output_tokens, cache_read, cache_write, cents, flags, card FROM gm_assist_log ORDER BY id').all().map((r) => ({ ...r }));

// ---- the run: add each minute's lines, then tick once at the end of that minute
const cards = [], ticks = [];
let after = null, n = 0, stopped = '';
const t0wall = Date.now();
for (let t = first; t <= last; t++) {
  clock = melbMs(t, 59);
  const lines = minutes.get(t) || [];
  if (lines.length) {
    const step = 55 / lines.length;
    await addLines(db, CAMPAIGN, cleanLines({ lines: lines.map((x, i) => ({ id: 'e' + (++n), at: new Date(melbMs(t, 0) + Math.floor(i * step * 1000)).toISOString(), session: '2', conn: 'e2e', speaker: speakerIds.get(x.who), text: x.text })) }));
  }
  const before = logRows().length;
  const out = await tick(after);
  if (typeof out.last === 'number') after = out.last;
  const rows = logRows().slice(before);
  ticks.push({ t, flags: out.flags || [], tier: out.spend && out.spend.tier, spend: out.spend && out.spend.tonight, errors: out.errors || [], seats: rows.map((r) => r.seat) });
  for (const c of out.cards || []) cards.push({ t, seat: c.seat, text: c.text, detail: c.detail });
  if ((out.errors || []).length) console.error(`${stamp(t)} errors: ${out.errors.map((e) => e.seat + ' ' + e.error).join(', ')}`);
  if (out.cards && out.cards.length) console.log(`${stamp(t)} CARD ${out.cards.map((c) => c.seat + ': ' + c.text).join(' | ')}`);
  else if (rows.length > 1) console.log(`${stamp(t)} flags ${(out.flags || []).join(',')} -> ${rows.map((r) => r.seat).join(',')} (no card)`);
  if (spentSoFar() >= hardStop) { stopped = `hard stop at ${stamp(t)}: $${spentSoFar().toFixed(3)} spent (limit $${hardStop})`; break; }
  if (out.spend && out.spend.tier === 'off') { stopped = `the budget ladder reached "off" at ${stamp(t)}`; break; }
}

// ---- the report
const rows = logRows();
const total = rows.reduce((s, r) => s + r.cents, 0) / 100;
const bySeat = {};
for (const r of rows) {
  const b = bySeat[r.seat] || (bySeat[r.seat] = { calls: 0, cents: 0, shown: 0, in: 0, out: 0, read: 0, write: 0 });
  b.calls++; b.cents += r.cents; b.in += r.input_tokens; b.out += r.output_tokens; b.read += r.cache_read; b.write += r.cache_write;
  try { if (JSON.parse(r.card || '{}').shown === 1) b.shown++; } catch (_) { /* a row with no card */ }
}
const L = [];
const p = (s = '') => L.push(s);
const ran = [...new Set(ticks.map((x) => x.t))];
p(`Claude at the table: end-to-end run (real tick handler, real Anthropic client, in-memory D1)`);
p(`transcript: ${path.basename(transcriptFile)}  ${DAY}/${MON}/${YEAR}  ${stamp(first)} to ${stamp(ran.length ? ran[ran.length - 1] : last)}  (${ticks.length} ticks, ${[...minutes.values()].reduce((s, m) => s + m.length, 0)} lines)`);
p(`context: ${contextFiles.map((f) => path.basename(f)).join(', ') || '(none)'}  about ${estimateTokens(prefix)} tokens`);
p(`cap: $${cap}   wall clock: ${Math.round((Date.now() - t0wall) / 1000)} s${fake ? '   FAKE CLIENT (no API calls)' : ''}`);
if (stopped) p(`STOPPED EARLY: ${stopped}`);
p();
p(`CARDS LET THROUGH BY THE EDITOR: ${cards.length}`);
for (const c of cards) p(`  ${stamp(c.t)}  ${c.seat.toUpperCase().padEnd(6)} ${c.text}`);
if (!cards.length) p('  (none)');
p();
p('CARDS PER 5-MINUTE WINDOW (from ' + stamp(first) + ')');
const wins = new Map();
for (const c of cards) { const w = Math.floor((c.t - first) / 5); wins.set(w, (wins.get(w) || 0) + 1); }
const nWin = Math.floor(((ran.length ? ran[ran.length - 1] : last) - first) / 5) + 1;
let maxPer = 0, windowsWith = 0;
for (let w = 0; w < nWin; w++) { const k = wins.get(w) || 0; maxPer = Math.max(maxPer, k); if (k) windowsWith++; p(`  ${stamp(first + w * 5)}-${stamp(first + w * 5 + 4)}  ${'#'.repeat(k) || '.'} ${k || ''}`); }
p(`  windows ${nWin}, with a card ${windowsWith}, most in one window ${maxPer}`);
p();
p('SEATS CALLED (from gm_assist_log)');
for (const [s, b] of Object.entries(bySeat)) p(`  ${s.padEnd(9)} ${String(b.calls).padStart(4)} calls  ${String(b.shown).padStart(3)} shown  $${(b.cents / 100).toFixed(4)}  tokens in ${b.in} out ${b.out} cache-read ${b.read} cache-write ${b.write}`);
p(`TOTAL SPEND (gm_assist_log): $${total.toFixed(4)}`);
p();
p('CONDUCTOR');
const flagged = ticks.filter((x) => x.flags.length);
let wokeWanted = 0, wokeCalled = 0, coolSuppressed = 0;
const suppressedBy = {};
for (const x of flagged) {
  const wanted = Object.keys(WAKES).filter((s) => WAKES[s].some((f) => x.flags.includes(f)) && !['showrunner', 'mystery', 'meanwhile', 'fixer', 'closer'].includes(s));
  const called = wanted.filter((s) => x.seats.includes(s));
  wokeWanted += wanted.length; wokeCalled += called.length;
  for (const s of wanted) if (!called.includes(s)) { coolSuppressed++; suppressedBy[s] = (suppressedBy[s] || 0) + 1; }
}
p(`  ticks with the Tripwire flagging: ${flagged.length} of ${ticks.length}`);
p(`  seat wake-ups wanted by the flags: ${wokeWanted}; called: ${wokeCalled}; held back (cooldown, in-flight or ladder): ${coolSuppressed}${Object.keys(suppressedBy).length ? ' (' + Object.entries(suppressedBy).map(([s, k]) => s + ' ' + k).join(', ') + ')' : ''}`);
const tiers = [...new Set(ticks.map((x) => x.tier))];
p(`  budget tiers seen: ${tiers.join(', ')}${tiers.every((x) => x === 'all') ? '  (the ladder never moved: spend stayed under 60% of the cap)' : ''}`);
const tierChange = ticks.find((x, i) => i && x.tier !== ticks[i - 1].tier);
if (tierChange) p(`  first tier change at ${stamp(tierChange.t)} to ${tierChange.tier} ($${tierChange.spend})`);
const notShown = rows.filter((r) => !['tripwire', 'fixer'].includes(r.seat) && (() => { try { return JSON.parse(r.card || '{}').shown === 0; } catch (_) { return false; } })());
p(`  Tap-seat calls the Editor did not show (repeat, throttle, outranked or empty): ${notShown.length} of ${rows.filter((r) => !['tripwire', 'fixer'].includes(r.seat)).length}`);
const errs = ticks.flatMap((x) => x.errors.map((e) => `${stamp(x.t)} ${e.seat} ${e.error}`));
p(`  provider errors: ${errs.length}${errs.length ? '\n    ' + errs.slice(0, 20).join('\n    ') : ''}`);

const slips = arg('slips');
if (slips) {
  p();
  p('KNOWN SLIPS: what appeared near each (shown cards within -1/+6 min, and every Ref call that quoted a time within 2 min)');
  for (const s of slips.split(',').map((x) => x.trim()).filter(Boolean)) {
    const ts = toMin(s);
    const near = cards.filter((c) => c.seat === 'ref' && c.t >= ts - 1 && c.t <= ts + 6);
    p(`  ${s}: ${near.length ? near.map((c) => `shown ${stamp(c.t)} "${c.text}"`).join('; ') : 'NO Ref card shown in the window'}`);
    for (const r of rows.filter((r) => r.seat === 'ref')) {
      let c; try { c = JSON.parse(r.card || '{}'); } catch (_) { continue; }
      const said = c.out && /^\d\d:\d\d$/.test(c.out.said_at || '') ? toMin(c.out.said_at) : null;
      if (c.out && c.out.slip && said !== null && Math.abs(said - ts) <= 2) p(`      ref saw it (said_at ${c.out.said_at}, ${c.shown ? 'SHOWN' : 'not shown'}): ${c.out.card}`);
    }
  }
}
p();
p('ALL CARDS SEEN BY THE EDITOR (Ref slips, whether shown or not)');
for (const r of rows.filter((r) => r.seat === 'ref')) {
  let c; try { c = JSON.parse(r.card || '{}'); } catch (_) { continue; }
  if (c.out && c.out.slip) p(`  ${melb.format(new Date(r.at))}  ${c.shown ? 'SHOWN ' : 'held  '} said ${c.out.said_at}: ${c.out.card}`);
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, L.join('\n') + '\n');
console.log('\n' + L.join('\n') + `\n\nreport written to ${path.relative(REPO, outFile)}`);
