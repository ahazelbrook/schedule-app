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
//   --voice-at HH:MM[=NPC],...   Voice as the table agent runs it: wakes only for a moment that names the NPC on stage (the name the page
//                     would send), silent otherwise with no call; --another N adds a voice_plus call after the first N moments with lines.
//                     Writes lines.md and voice.json.
//   --tap-sim         the whole table agent over --from/--to, one tick a minute, through the REAL endpoint (functions/api/gm/assist.js on an
//                     in-memory D1, a virtual clock, the real API): Tripwire, Conductor, every seat that is on, the Editor's card gap.
//                     --tap-seats a,b,c  which seats really call the API (default tripwire,ref,clerk,ledger,stall,showrunner,mystery); the
//                     others are skipped for free. --lead N  minutes of talk loaded before --from (default 20, for the Showrunner).
//                     Writes tap.md (per tick: flags, seats called, the card, Stall's offer), tap.json and summary.txt (counts, no text).
//                     The Scribe (tap-seats ...,scribe) folds the talk into a story every 5 minutes and Meanwhile (...,meanwhile) answers a scene_change
//                     (the Tripwire's, or one forced with --force-flag 21:10=scene_change,...); a silent stretch raises the code-side stall flag
//                     (the sim has the iPad report "listening" every tick; --no-listening turns that off). Also writes story.md (the story after each
//                     Scribe run, with its fixes) and meanwhile.md (each cutaway).
//                     --clocks-file <json>  [{ name, size, filled, kind }]: the table's live clocks for Meanwhile (the real ones sit in D1)
//   --prefix-file <f>   use this file's text as the prefix exactly as it is (already context-blocked: the gm:pack builder's output), instead of
//                     wrapping each --context file
//   --turn-at seat@HH:MM,...   run seats once at those minutes with the endpoint's own turn, no Tripwire, no Conductor; writes turns.md and
//                     turns.json, and checks Mystery's must_land_item against the prefix's "## Must land" section (grounded or not).
//   --screen-at portrait@HH:MM[=Name],prop@HH:MM[=ask],wire@HH:MM,board=a | b   the Screen seats with the endpoint's own turns, each item then gated
//                     (the panel's own gate text); board is code (the lines you give). Writes screen.md (--out under gm-private/), screen.json,
//                     portrait-N.svg and summary.txt.
//   --nightshift      hour-long chunks -> sorters in parallel -> writer; writes nightshift.md
//   --seats a,b,c    which seats run (default tripwire,ref,clerk,ledger)
//   --set seat.k=v    override a seat's model or effort for a sweep, e.g. --set ref.effort=high
//   --gatekeeper-file <json>   run the gatekeeper over sample items [{ kind, text, cites? }] (no transcript needed; --context carries the never-reveal block);
//                     prints verdict and counts per item, never the text; writes gatekeeper.json and gatekeeper.md
//   --fixer-at HH:MM,...   run the Fixer at those minutes as if the Position had just been set, and write fixer.md and
//                     fixer-moments.md (each moment's two draws beside the fitted lines). The Fixer FITS the console's two draws, so
//                     they must come from one of:
//     --draws-file <json>    { "HH:MM": { "position", "low", "mid" }, "default": { ... } }  (small, under gm-private/)
//     --draws-pack <json>    draw them from that GM pack's console part with the console's own function (default
//                            gm-private/b68-gm-pack.json); seeds are fixed: --draws-seed N (default 1) + 2 per moment
//     --position <p>         the Position for the drawn pair (default risky); --position-at 22:09=desperate,22:12=controlled
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
import { cleanItem, verdictOf } from '../functions/_lib/assist/gatekeeper.js';
import { gatekeeperUser, fitUser, voiceUser, anotherUser, showrunnerUser, mysteryUser, SHOWRUNNER_MIN, MYSTERY_MIN, scribeUser, meanwhileUser, MEANWHILE_MIN, SCRIBE_FIRST_MIN } from '../functions/_lib/assist/prompts.js';
import { decide } from '../functions/_lib/assist/conductor.js';
import { toVoice, toAnother } from '../functions/_lib/assist/editor.js';
import { clerkTurn, takeFreshNames } from './lib/replay-clerk.mjs';
import { makeDrawsFor, parsePositionAt } from './lib/fixer-draws.mjs';

const argv = process.argv.slice(2);
const flag = n => argv.includes(`--${n}`);
const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const args = n => argv.flatMap((a, i) => (a === `--${n}` ? [argv[i + 1]] : []));

const transcriptFile = arg('transcript');
const contextFiles = args('context');
if (!transcriptFile && !arg('gatekeeper-file')) { console.error('--transcript <file> is required'); process.exit(2); }

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
const minutes = new Map(), allMinutes = new Map();     // allMinutes ignores --from/--to (--tap-sim loads talk before the window)
for (const raw of (transcriptFile ? fs.readFileSync(transcriptFile, 'utf8') : '').split(/\r?\n/)) {
  const m = LINE.exec(raw);
  if (!m) continue;
  const t = Number(m[1]) * 60 + Number(m[2]);
  if (!allMinutes.has(t)) allMinutes.set(t, []);
  allMinutes.get(t).push({ speaker: m[3].trim(), text: m[4] });
  if (t < from || t > to) continue;
  if (!minutes.has(t)) minutes.set(t, []);
  minutes.get(t).push(`[${m[1]}:${m[2]}] ${m[3]}: ${m[4]}`);
}
const order = [...minutes.keys()].sort((a, b) => a - b);
const stamp = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
const textFor = (from_, to_) => order.filter(t => t >= from_ && t <= to_).flatMap(t => minutes.get(t)).join('\n');

const prefix = arg('prefix-file') ? fs.readFileSync(arg('prefix-file'), 'utf8') : contextFiles.length
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
const spend = {}, calls = {}, cards = [], secsLog = [], stopLog = [];
let total = 0;

async function run(seat, at, user) {
  const cfg = registry[seat];
  const r = await callSeat(client, { ...cfg, prefix, user });
  total += r.cost; spend[seat] = (spend[seat] || 0) + r.cost; calls[seat] = (calls[seat] || 0) + 1;
  secsLog.push(r.secs); stopLog.push(r.stop);
  log.write(JSON.stringify({ at, seat, model: cfg.model, effort: cfg.effort, usage: r.usage, cost: r.cost, stop: r.stop, secs: r.secs, json: r.json }) + '\n');
  if (r.json === null) {
    console.error(`${at} ${seat}: no JSON (stop=${r.stop}, ${r.usage?.output_tokens} output tokens)`);
    fs.writeFileSync(path.join(outDir, `failed-${seat}-${at.replace(':', '')}.txt`), r.text || '');
  }
  return r.json;
}

// --gatekeeper-file <json>: run the gatekeeper over sample items, [{ "kind": "prop", "text": "...", "cites": ["p.12"] }, ...] (kind is portrait,
// prop, wire, board or card). Needs --context for the prefix (the never-reveal block is in it). Needs no transcript. Prints one line per item
// (number, verdict, counts; never the text) and writes gatekeeper.json and gatekeeper.md under --out. Honours --max-spend.
if (arg('gatekeeper-file')) {
  let items;
  try { items = JSON.parse(fs.readFileSync(arg('gatekeeper-file'), 'utf8')); } catch (e) { console.error('--gatekeeper-file is not valid JSON: ' + e.message); process.exit(2); }
  if (!Array.isArray(items) || !items.length) { console.error('--gatekeeper-file must be a JSON list of { kind, text, cites? }'); process.exit(2); }
  const checked = items.map(b => cleanItem(b));
  const badAt = checked.findIndex(c => !c.ok);
  if (badAt >= 0) { console.error(`item ${badAt + 1}: ${checked[badAt].why}`); process.exit(2); }
  const results = [];
  for (let i = 0; i < checked.length; i++) {
    if (total >= maxSpend) { console.error(`spend cap $${maxSpend} reached before item ${i + 1}`); break; }
    const item = checked[i].item;
    const cfg = registry.gatekeeper, before = total;
    const r = await callSeat(client, { ...cfg, prefix, user: gatekeeperUser(item) });
    total += r.cost; spend.gatekeeper = (spend.gatekeeper || 0) + r.cost; calls.gatekeeper = (calls.gatekeeper || 0) + 1; secsLog.push(r.secs); stopLog.push(r.stop);
    const v = verdictOf(r.json, r.stop);
    log.write(JSON.stringify({ at: String(i + 1), seat: 'gatekeeper', model: cfg.model, effort: cfg.effort, usage: r.usage, cost: r.cost, stop: r.stop, secs: r.secs, json: r.json }) + '\n');
    results.push({ n: i + 1, kind: item.kind, ...v, cost: r.cost, secs: r.secs, stop: r.stop });
    console.log(`item ${i + 1} (${item.kind}): ${v.verdict}${v.unknown ? ' (unknown)' : ''}; revealed ${v.revealed.length}, rule ${v.rule.length}, cites_bad ${v.cites_bad.length}; $${(total - before).toFixed(4)}, ${r.secs}s`);
  }
  fs.writeFileSync(path.join(outDir, 'gatekeeper.json'), JSON.stringify(results, null, 1) + '\n');
  fs.writeFileSync(path.join(outDir, 'gatekeeper.md'), results.map(x => `## Item ${x.n} (${x.kind}): ${x.verdict}${x.unknown ? ' (unknown)' : ''}\n- reasons: ${x.reasons.join(' | ') || '-'}\n- revealed: ${x.revealed.join(' | ') || '-'}\n- rule: ${x.rule.join(' | ') || '-'}\n- cites_bad: ${x.cites_bad.join(' | ') || '-'}`).join('\n\n') + '\n');
  const sorted = [...secsLog].sort((a, b) => a - b), median = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
  console.log(`gatekeeper total: $${total.toFixed(4)}; ${results.length} items; secs median ${median}; stop reasons ${JSON.stringify(stopLog)}`);
  process.exit(0);
}

// --fixer-at 22:09,22:23 (alias --fixer): run the Fixer as if a Position had just been set at each minute, fitting the console's
// two draws (from --draws-file, or drawn from the pack's console part with a fixed seed). Writes fixer.md, fixer-moments.md, draws.json.
if (arg('fixer-at') || arg('fixer')) {
  const moments = (arg('fixer-at') || arg('fixer')).split(',').map(x => x.trim()).filter(Boolean);
  let drawsFor;
  try {
    drawsFor = makeDrawsFor({ moments, file: arg('draws-file'), packFile: arg('draws-pack', path.join('gm-private', 'b68-gm-pack.json')), seed: Number(arg('draws-seed', 1)), position: arg('position', 'risky'), positionAt: parsePositionAt(arg('position-at', '')) });
  } catch (e) { console.error(e.message); process.exit(2); }
  const out = [], mom = [], used = {};
  for (const hhmm of moments) {
    if (total >= maxSpend) { console.error(`spend cap $${maxSpend} reached before ${hhmm}`); break; }
    const t = toMin(hhmm), d = drawsFor(hhmm);
    used[hhmm] = d;
    const before = total, n0 = secsLog.length;
    const j = await run('fixer', hhmm, fitUser({ position: d.position, draws: d, stamp: hhmm, talk: textFor(t - 4, t) }));
    out.push(`## ${hhmm}\n` + (j ? Object.entries(j).map(([k, v]) => `- **${k}:** ${v}`).join('\n') : '(no JSON)'));
    mom.push([`## ${hhmm}  (${d.position}; ${secsLog[n0]} s, stop ${stopLog[n0]}, $${(total - before).toFixed(3)})`, '',
      '| | Console draw | Fitted line |', '|---|---|---|',
      `| 1-3 | ${cell(d.low)} | ${cell(j && j.one_three)} |`, `| 4-5 | ${cell(d.mid)} | ${cell(j && j.four_five)} |`, '',
      ...(j ? [`- **read:** ${j.read}`, `- **6:** ${j.six}`, `- **crit:** ${j.crit}`, `- **bargain:** ${j.bargain}`] : ['(no JSON)']), ''].join('\n'));
  }
  fs.writeFileSync(path.join(outDir, 'fixer.md'), out.join('\n\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'fixer-moments.md'), '# The Fixer fitting the console draws\n\n' + mom.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'draws.json'), JSON.stringify(used, null, 1) + '\n');
  const sorted = [...secsLog].sort((x, y) => x - y), med = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
  const stats = `fixer total: $${total.toFixed(3)}; calls ${secsLog.length}; seconds median ${med}, max ${sorted[sorted.length - 1] ?? 0}; stop reasons ${JSON.stringify(stopLog)}`;
  fs.writeFileSync(path.join(outDir, 'summary.txt'), stats + '\n');
  console.log(stats + `\nwritten to ${outDir}`);     // the text itself stays in the files
  process.exit(0);
}
function cell(x) { return String(x == null ? '' : x).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>'); }

// --voice-at HH:MM[=NPC],... : Voice as the table agent runs it. At each moment the Conductor decides (as the tick does, with the
// Tripwire's npc_change flag set) whether Voice wakes: it does only when an NPC name is given for that moment (the name the GM's page
// would send), and with none it makes NO call and says so. The turn is the endpoint's own (voiceUser, the last four minutes). With
// --another N, the first N moments that produced lines also get one voice_plus call (anotherUser, the lines shown so far). Writes
// lines.md (for the GM) and voice.json; prints only counts, cost and timings.
if (arg('voice-at')) {
  const moments = arg('voice-at').split(',').map(x => x.trim()).filter(Boolean).map(x => { const [at, ...n] = x.split('='); return { at, npc: n.join('=').trim() }; });
  let anotherLeft = Number(arg('another', 0)) || 0;
  const md = ['# Voice, replayed', ''], dump = [], silent = [];
  for (const { at, npc } of moments) {
    const t = toMin(at);
    const verdict = decide({ flags: ['npc_change'], now: 1e12, onStage: !!npc });
    if (!verdict.seats.includes('voice')) { silent.push(at); md.push(`## ${at}`, '', '_Silent: no NPC on stage, so Voice was not woken and no call was made._', ''); dump.push({ at, npc: '', voice: null }); continue; }
    if (total >= maxSpend) { console.error(`spend cap $${maxSpend} reached before ${at}`); break; }
    const talk = textFor(t - 3, t);
    const before = total, n0 = secsLog.length;
    const j = await run('voice', at, voiceUser({ npc, stamp: at, talk }));
    const v = toVoice(j);
    md.push(`## ${at}  (${secsLog[n0]} s, stop ${stopLog[n0]}, $${(total - before).toFixed(3)})`, '', `**${v ? v.who : npc}**${v && v.want ? ' wants: ' + v.want : ''}`, '');
    const shown = v ? [...v.lines] : [];
    for (const l of shown) md.push(`- ${l}`);
    if (!v) md.push('_No lines._');
    let more = null;
    if (v && anotherLeft > 0) {
      anotherLeft--;
      const b2 = total, m0 = secsLog.length;
      const j2 = await run('voice_plus', at, anotherUser({ npc: v.who, shown, stamp: at, talk }));
      more = toAnother(j2, shown);
      md.push('', `Another (${secsLog[m0]} s, stop ${stopLog[m0]}, $${(total - b2).toFixed(3)}):`, '', more ? `- ${more.line}` : '_Nothing new._');
    }
    md.push('');
    dump.push({ at, npc, voice: v, another: more });
  }
  fs.writeFileSync(path.join(outDir, 'lines.md'), md.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'voice.json'), JSON.stringify(dump, null, 1) + '\n');
  const sorted = [...secsLog].sort((x, y) => x - y), med = sorted.length ? sorted[Math.floor((sorted.length - 1) / 2)] : 0;
  const stats = `voice total: $${total.toFixed(3)}; calls ${secsLog.length} ${JSON.stringify(calls)}; seconds median ${med}, max ${sorted[sorted.length - 1] ?? 0}; stop reasons ${JSON.stringify(stopLog)}; ` +
    `silent moments (no NPC, no call): ${silent.length}; moments with lines: ${dump.filter(d => d.voice).length}; another lines: ${dump.filter(d => d.another).length}`;
  fs.writeFileSync(path.join(outDir, 'summary.txt'), stats + '\n');
  console.log(stats + `\nwritten to ${outDir}`);
  process.exit(0);
}

// The Must land section of the prep note inside the prefix (for the Mystery grounding check): from "## Must land" to the next "## ".
const normText = x => String(x || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const mustLand = (() => { const m = /\n## Must land\n([\s\S]*?)\n## /.exec(prefix); return m ? normText(m[1]) : ''; })();
const groundedItem = item => { const n = normText(item).slice(0, 30); return !!(n && mustLand.includes(n)); };

// --screen-at portrait@HH:MM[=Name],prop@HH:MM[=ask],wire@HH:MM,board[=known one | known two]: the Screen seats at chosen minutes, with the
// endpoint's own turn (the last SCREEN_WINDOW_MIN minutes of talk), the same item rules and the gatekeeper on every item (the panel's own
// gate text). `board` is code: it builds the board from the `|`-separated lines you give (invented ones for a check) and gates it. A portrait is
// cleaned with the figure kit and its SVG written beside the report. Writes screen.md (the items and the verdicts: it quotes the table, so
// --out must sit under gm-private/), screen.json, portrait-N.svg and summary.txt (counts and money only). Honours --max-spend.
if (arg('screen-at')) {
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url), here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
  const K = req(path.join(here, '..', 'app', 'figures', 'figure-kit.js')), NPC = req(path.join(here, '..', 'app', 'gm', 'npc.js')), PANEL = req(path.join(here, '..', 'app', 'gm', 'assist-panel.js'))._pure;
  const { toPortrait, toProp, toWire, buildBoard, vocabText, cleanName, cleanAsk } = await import('../functions/_lib/assist/screen.js');
  const { portraitUser, propUser, wireUser, SCREEN_WINDOW_MIN } = await import('../functions/_lib/assist/prompts.js');
  if (!path.resolve(outDir).split(path.sep).includes('gm-private')) { console.error('--out must sit under gm-private/: the report quotes the table'); process.exit(2); }
  const vocab = vocabText(K.options());
  const md = ['# The Screen at chosen minutes', '', 'Every item below was made by one seat call with the endpoint\'s own turn, then checked by the gatekeeper. Nothing here reached a screen.', ''], dump = [];
  let n = 0;
  for (const spec of arg('screen-at').split(',').map(x => x.trim()).filter(Boolean)) {
    const m = /^(portrait|prop|wire|board)(?:@(\d\d:\d\d))?(?:=(.*))?$/.exec(spec);
    if (!m) { console.error('bad --screen-at item ' + spec + ' (portrait@HH:MM[=Name], prop@HH:MM[=ask], wire@HH:MM, board=a | b)'); process.exit(2); }
    const [, kind, at, rest = ''] = m;
    if (kind !== 'board' && !at) { console.error(kind + ' needs @HH:MM'); process.exit(2); }
    if (total >= maxSpend) { console.error('spend cap $' + maxSpend + ' reached before ' + spec); break; }
    const t = at ? toMin(at) : 0, talk = at ? textFor(t - SCREEN_WINDOW_MIN + 1, t) : '';
    const before = total, n0 = secsLog.length;
    let item = null, made = null, cleaned = null;
    if (kind === 'board') item = buildBoard(rest.split('|').map(x => x.trim()).filter(Boolean), []);
    else {
      const user = kind === 'portrait' ? portraitUser({ name: cleanName(rest) || '', vocab, stamp: at, talk }) : kind === 'prop' ? propUser({ ask: cleanAsk(rest) || '', stamp: at, talk }) : wireUser({ stamp: at, talk });
      made = await run(kind, at, user);
      item = made ? (kind === 'portrait' ? toPortrait(made, cleanName(rest) || '') : kind === 'prop' ? toProp(made) : toWire(made)) : null;
      if (item && kind === 'portrait') {
        cleaned = NPC.cleanSpec(item.spec, { K, name: item.name });
        if (cleaned.ok) { const sp = JSON.parse(JSON.stringify(cleaned.spec)); sp.id = 'screen-preview'; fs.writeFileSync(path.join(outDir, `portrait-${++n}.svg`), K.portrait(sp, { lod: 'lo' }).svg); }
        else item = null;
      }
    }
    const make = made ? { secs: secsLog[n0], stop: stopLog[n0], cost: total - before } : null;
    let gate = null, gateCost = 0;
    if (item && total < maxSpend) {
      const gi = { kind: item.kind, text: PANEL.gateText(item), cites: [] }, g0 = total, ns = secsLog.length;
      const r = await callSeat(client, { ...registry.gatekeeper, prefix, user: gatekeeperUser(gi) });
      total += r.cost; spend.gatekeeper = (spend.gatekeeper || 0) + r.cost; calls.gatekeeper = (calls.gatekeeper || 0) + 1; secsLog.push(r.secs); stopLog.push(r.stop);
      log.write(JSON.stringify({ at: at || 'board', seat: 'gatekeeper', model: registry.gatekeeper.model, effort: registry.gatekeeper.effort, usage: r.usage, cost: r.cost, stop: r.stop, secs: r.secs, json: r.json }) + '\n');
      gate = { ...verdictOf(r.json, r.stop), secs: r.secs, stop: r.stop }; gateCost = total - g0;
    }
    md.push('## ' + kind + (at ? ' @ ' + at : '') + (make ? '  (made in ' + make.secs + ' s, stop ' + make.stop + ', $' + make.cost.toFixed(3) + ')' : ''), '');
    if (!item) md.push('(no usable item' + (cleaned && !cleaned.ok ? ': the figure kit rejected the drawing: ' + cleaned.warnings.slice(0, 2).join('; ') : '') + ')', '');
    else {
      md.push(item.kind === 'portrait' ? '**' + item.name + '**: ' + item.description + (cleaned && cleaned.notes.length ? '\n\nkit notes: ' + cleaned.notes.join('; ') : '') + '\n\nportrait-' + n + '.svg'
        : (item.title ? '**' + item.title + '**\n\n' : '') + '```\n' + item.text + '\n```');
      md.push('', gate ? 'gatekeeper: **' + gate.verdict + '**' + (gate.unknown ? ' (unknown)' : '') + ' (' + gate.secs + ' s, stop ' + gate.stop + ', $' + gateCost.toFixed(3) + ')' +
        '\n- reasons: ' + (gate.reasons.join(' | ') || '-') + '\n- revealed: ' + (gate.revealed.join(' | ') || '-') + '\n- rule: ' + (gate.rule.join(' | ') || '-') + '\n- cites_bad: ' + (gate.cites_bad.join(' | ') || '-') : 'gatekeeper: not run (spend cap)', '');
    }
    dump.push({ kind, at: at || null, make, item: item ? { ...item, ...(item.spec ? { spec: cleaned && cleaned.spec } : {}) } : null, gate, gateCost, total });
    console.log(`${kind}${at ? '@' + at : ''}: ${item ? 'item made' : 'no item'}${make ? ' (' + make.secs + 's ' + make.stop + ')' : ''}${gate ? '; gate ' + gate.verdict + (gate.unknown ? ' (unknown)' : '') : ''}; running total $${total.toFixed(4)}`);
  }
  fs.writeFileSync(path.join(outDir, 'screen.md'), md.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'screen.json'), JSON.stringify(dump, null, 1) + '\n');
  const stats = 'screen-at total: $' + total.toFixed(4) + '; calls ' + secsLog.length + ' ' + JSON.stringify(calls) + '; stop reasons ' + JSON.stringify(stopLog) + '; items ' + dump.filter(d => d.item).length + ' of ' + dump.length + '; gates ' + JSON.stringify(dump.map(d => d.gate ? d.gate.verdict + (d.gate.unknown ? '?' : '') : '-'));
  fs.writeFileSync(path.join(outDir, 'summary.txt'), stats + '\n');
  console.log(stats + '\nwritten to ' + outDir);
  process.exit(0);
}

// --turn-at seat@HH:MM,... : one call per spec with the endpoint's own turn (Stall and the Tap seats: the last four minutes;
// Showrunner and Mystery: their longer windows). No Tripwire and no Conductor: this asks what the SEAT says, not whether it would wake.
if (arg('turn-at')) {
  const md = ['# Seats at chosen minutes', ''], dump = [];
  for (const spec of arg('turn-at').split(',').map(x => x.trim()).filter(Boolean)) {
    const [seat, at] = spec.split('@');
    if (!registry[seat]) { console.error('unknown seat ' + seat); process.exit(2); }
    if (total >= maxSpend) { console.error('spend cap $' + maxSpend + ' reached before ' + spec); break; }
    const t = toMin(at);
    const user = seat === 'showrunner' ? showrunnerUser({ stamp: at, talk: textFor(t - SHOWRUNNER_MIN + 1, t) })
      : seat === 'mystery' ? mysteryUser({ stamp: at, talk: textFor(t - MYSTERY_MIN + 1, t), known: [] })
        : seat === 'scribe' ? scribeUser({ story: '', stamp: at, talk: textFor(t - SCRIBE_FIRST_MIN + 1, t) })
          : seat === 'meanwhile' ? meanwhileUser({ clocks: [], stamp: at, talk: textFor(t - MEANWHILE_MIN + 1, t) })
        : seat === 'clerk' ? clerkTurn([], at, textFor(t - 3, t))
        : 'Last four minutes, up to ' + at + ':\n' + textFor(t - 3, t);
    const before = total, n0 = secsLog.length;
    const j = await run(seat, at, user);
    const g = seat === 'mystery' && j ? { push_next_given: !!(j.push_next || '').trim(), grounded: groundedItem(j.must_land_item) } : null;
    md.push('## ' + seat + ' @ ' + at + '  (' + secsLog[n0] + ' s, stop ' + stopLog[n0] + ', $' + (total - before).toFixed(3) + ')', '',
      j ? '```json\n' + JSON.stringify(j, null, 1) + '\n```' : '(no JSON)', ...(g ? ['', 'grounded in Must land: ' + g.grounded] : []), '');
    dump.push({ seat, at, secs: secsLog[n0], stop: stopLog[n0], json: j, ...(g || {}) });
  }
  fs.writeFileSync(path.join(outDir, 'turns.md'), md.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'turns.json'), JSON.stringify(dump, null, 1) + '\n');
  const stats = 'turn-at total: $' + total.toFixed(3) + '; calls ' + secsLog.length + ' ' + JSON.stringify(calls) + '; stop reasons ' + JSON.stringify(stopLog) +
    '; stall offered: ' + dump.filter(d => d.seat === 'stall' && d.json && d.json.stalled === true && (d.json.offer || '').trim()).length + ' of ' + dump.filter(d => d.seat === 'stall').length +
    '; mystery grounded: ' + dump.filter(d => d.seat === 'mystery' && d.grounded).length + ' of ' + dump.filter(d => d.seat === 'mystery').length;
  fs.writeFileSync(path.join(outDir, 'summary.txt'), stats + '\n');
  console.log(stats + '\nwritten to ' + outDir);
  process.exit(0);
}

// --tap-sim: the table agent over a window, through the real endpoint (see the header). The Worker code is the code that runs; only the
// clock is virtual (one tick per transcript minute) and the database is in memory.
if (flag('tap-sim')) {
  const { runTapSim, dayFromTranscript } = await import('./lib/tap-sim.mjs');
  const day = arg('day') || dayFromTranscript(fs.readFileSync(transcriptFile, 'utf8'));          // --day YYYY-MM-DD, else the note's own date: (else an invented default)
  const fromT = from < 0 ? order[0] : from, toT = to > 1e8 ? order[order.length - 1] : to;
  const enabled = new Set((arg('tap-seats', 'tripwire,ref,clerk,ledger,stall,showrunner,mystery')).split(',').map(x => x.trim()).filter(Boolean));
  const forced = Object.fromEntries(args('force-flag').flatMap(x => x.split(',')).map(x => x.trim()).filter(Boolean).map(x => x.split('=')));   // { 'HH:MM': flag }
  const callHook = async (seat, a, at) => {
    const r = await callSeat(client, { ...a, prefix, prefixFileId: '' });
    if (seat === 'tripwire' && forced[at] && r.json) r.json = { ...r.json, [forced[at]]: true };            // a scene change the Tripwire missed, for the replay only
    total += r.cost; spend[seat] = (spend[seat] || 0) + r.cost; calls[seat] = (calls[seat] || 0) + 1; secsLog.push(r.secs); stopLog.push(r.stop);
    log.write(JSON.stringify({ at, seat, model: a.model, effort: a.effort, usage: r.usage, cost: r.cost, stop: r.stop, secs: r.secs, json: r.json }) + '\n');
    return r;
  };
  const sim = await runTapSim({ client, registry, allMinutes, ...(day ? { day } : {}), fromT, toT, lead: Number(arg('lead', 20)), enabled, listening: !flag('no-listening'), ...(arg('clocks-file') ? { clocks: JSON.parse(fs.readFileSync(arg('clocks-file'), 'utf8')) } : {}), cap: Number(arg('cap', 20)), callHook, shouldStop: () => (total >= maxSpend ? 'spend cap' : '') });
  if (sim.stopped) console.error('stopped at ' + sim.stoppedAt + ': spend cap $' + maxSpend + ' reached');
  const shown = sim.shown;
  const ticks = sim.ticks.map(x => {
    const { mysteryRow, ...rest } = x; let g = null;
    if (mysteryRow) { try { const c = JSON.parse(mysteryRow.card), o = c.out; g = o ? { item_given: !!(o.must_land_item || '').trim(), grounded: groundedItem(o.must_land_item), shown: c.shown === 1 } : null; } catch { g = null; } }
    return { ...rest, mystery: g };
  });
  const gaps = shown.slice(1).map((c, i) => c.t - shown[i].t);
  const mys = ticks.filter(x => x.mystery);
  const calledCount = {}; for (const x of ticks) for (const s of x.called) calledCount[s] = (calledCount[s] || 0) + 1;
  const bySeat = {}; for (const c of shown) bySeat[c.seat] = (bySeat[c.seat] || 0) + 1;
  const md = ['# The Tap, simulated ' + stamp(fromT) + ' to ' + stamp(toT), '', '| minute | flags | seats called | card | Stall |', '|---|---|---|---|---|',
    ...ticks.map(x => '| ' + x.at + ' | ' + x.flags.join(', ') + ' | ' + x.called.join(', ') + ' | ' + (x.card ? '**' + x.card.seat + '**: ' + cell(x.card.text) : '') + ' | ' + (x.stall ? cell(x.stall.offer) : '') + ' |')];
  fs.writeFileSync(path.join(outDir, 'tap.md'), md.join('\n') + '\n');
  if (sim.stories.length) fs.writeFileSync(path.join(outDir, 'story.md'), ['# The Scribe: the story so far after each run', '',
    ...sim.stories.flatMap((x, i) => ['## ' + x.at + ' (run ' + (i + 1) + ', ' + x.story.length + ' chars, ~' + Math.ceil(x.story.length / 3.5) + ' tokens)', '', 'Fixes this run: ' + (x.corrections.length ? x.corrections.join('; ') : '(none)'), '', x.story, ''])].join('\n'));
  const mw = ticks.filter(x => x.meanwhile);
  if (mw.length) fs.writeFileSync(path.join(outDir, 'meanwhile.md'), ['# Meanwhile: faction cutaways', '', ...mw.flatMap(x => ['## ' + x.at + ' (' + (x.meanwhile.faction || 'no faction') + ')', '', x.meanwhile.cutaway, '', 'Clock: ' + (x.meanwhile.clock || '(none named)') + ' | suggested tick: ' + x.meanwhile.ticks + ' | ' + x.meanwhile.why, ''])].join('\n'));
  fs.writeFileSync(path.join(outDir, 'tap.json'), JSON.stringify(ticks, null, 1) + '\n');
  const stats = `tap-sim ${stamp(fromT)}-${stamp(toT)}: ticks ${ticks.length}; total $${total.toFixed(3)}; seats on ${[...enabled].join(',')}; calls ${JSON.stringify(calledCount)}; cards shown ${shown.length} by seat ${JSON.stringify(bySeat)}; ` +
    `minutes between cards ${JSON.stringify(gaps)} (min ${gaps.length ? Math.min(...gaps) : 'n/a'}); stall offers ${ticks.filter(x => x.stall).length}; silence flags ${ticks.filter(x => x.silence).length}; scribe runs ${sim.stories.length} (story chars ${JSON.stringify(sim.stories.map(x => x.story.length))}); meanwhile cutaways ${mw.length}; mystery runs ${mys.length}, with a Must land item ${mys.filter(x => x.mystery.item_given).length}, grounded ${mys.filter(x => x.mystery.grounded).length}, shown ${mys.filter(x => x.mystery.shown).length}; ` +
    `ticks with errors ${ticks.filter(x => x.errors.length).length}; seconds max ${secsLog.length ? Math.max(...secsLog) : 0}; stop reasons ${JSON.stringify(stopLog.reduce((m, x) => ((m[x] = (m[x] || 0) + 1), m), {}))}`;
  fs.writeFileSync(path.join(outDir, 'summary.txt'), stats + '\n');
  console.log(stats + '\nwritten to ' + outDir);
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

const shownNames = [];          // names the Clerk has raised so far this replay: what the Worker's clerkKnown() would hand back
for (const t of order) {
  if (total >= maxSpend) { console.error(`stopped at ${stamp(t)}: spend cap $${maxSpend} reached`); break; }
  const at = stamp(t);
  const tw = seats.includes('tripwire') ? await run('tripwire', at, `Minute ${at}:\n${minutes.get(t).join('\n')}`) : null;
  const flags = tw ? Object.keys(tw).filter(k => tw[k]) : Object.values(WAKES).flat();
  const recent = `Last four minutes, up to ${at}:\n${textFor(t - 3, t)}`;
  const woken = Object.keys(WAKES).filter(s => seats.includes(s) && WAKES[s].some(f => flags.includes(f)));
  const results = await Promise.all(woken.map(async s => [s, await run(s, at, s === 'clerk' ? clerkTurn(shownNames, at, textFor(t - 3, t)) : recent)]));
  for (const [s, j] of results) {
    if (s === 'ref' && j?.slip) cards.push(`${at} REF  said ${j.said_at}: ${j.card}`);
    if (s === 'clerk' && j) { const fresh = takeFreshNames(j, shownNames); if (fresh.length || j.drift.length) cards.push(`${at} CLERK names=${fresh.join('|')} drift=${j.drift.join('|')}`); }
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
