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
//   --turn-at seat@HH:MM,...   run seats once at those minutes with the endpoint's own turn, no Tripwire, no Conductor; writes turns.md and
//                     turns.json, and checks Mystery's must_land_item against the prefix's "## Must land" section (grounded or not).
//   --nightshift      hour-long chunks -> sorters in parallel -> writer; writes nightshift.md
//   --seats a,b,c    which seats run (default tripwire,ref,clerk,ledger)
//   --set seat.k=v    override a seat's model or effort for a sweep, e.g. --set ref.effort=high
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
import { fitUser, voiceUser, anotherUser, showrunnerUser, mysteryUser, SHOWRUNNER_MIN, MYSTERY_MIN } from '../functions/_lib/assist/prompts.js';
import { decide } from '../functions/_lib/assist/conductor.js';
import { toVoice, toAnother } from '../functions/_lib/assist/editor.js';
import { makeDrawsFor, parsePositionAt } from './lib/fixer-draws.mjs';

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
const minutes = new Map(), allMinutes = new Map();     // allMinutes ignores --from/--to (--tap-sim loads talk before the window)
for (const raw of fs.readFileSync(transcriptFile, 'utf8').split(/\r?\n/)) {
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
  const { memoryExec, asD1 } = await import('./lib/d1.mjs');
  const { cleanLines, addLines } = await import('../functions/_lib/stt.js');
  const { makeHandler } = await import('../functions/api/gm/assist.js');
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
  const exec = await memoryExec({ schemaFile: path.join(root, 'schema.sql') });
  const db = asD1(exec);
  const DAY = '2026-10-17', OFFSET = '+11:00';                 // an AEDT Saturday: the endpoint stamps lines in Melbourne time
  const iso = (t, sec) => new Date(`${DAY}T${stamp(t)}:${String(sec).padStart(2, '0')}${OFFSET}`).toISOString();
  const lead = Number(arg('lead', 20)), fromT = from < 0 ? order[0] : from, toT = to > 1e8 ? order[order.length - 1] : to;
  const enabled = new Set((arg('tap-seats', 'tripwire,ref,clerk,ledger,stall,showrunner,mystery')).split(',').map(x => x.trim()).filter(Boolean));
  const names = [...new Set([...allMinutes.values()].flat().map(l => l.speaker))].slice(0, 60);
  const sp = Object.fromEntries(names.map((n, i) => [String(i), n]));
  await db.prepare('INSERT INTO gm_stt (campaign, updated_at, doc) VALUES (?1, ?2, ?3)').bind('c', iso(fromT, 0), JSON.stringify({ want: 'on', session: '2', speakers: sp })).run();
  await db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'assist', 'v', '{}', 0, ?1)").bind(JSON.stringify({ file_id: 'file_sim000001' })).run();
  let seq = 0;
  const feed = async t => {
    const ls = allMinutes.get(t) || [];
    const batch = ls.map((l, i) => ({ id: 'sim' + (++seq), at: iso(t, Math.min(58, Math.floor(i * 58 / Math.max(1, ls.length)))), session: '2', conn: 'sim', speaker: Math.min(63, names.indexOf(l.speaker)), text: l.text }));
    for (let i = 0; i < batch.length; i += 50) await addLines(db, 'c', cleanLines({ lines: batch.slice(i, i + 50) }));
  };
  const seatOf = ins => Object.keys(registry).find(k => ins && ins.startsWith(registry[k].instructions));
  const virt = { t: 0, real0: 0, hhmm: '' };
  const call = async (cl, a) => {
    const seat = seatOf(a.instructions);
    if (!enabled.has(seat)) return { json: null, text: '', usage: {}, cost: 0, stop: 'skipped', secs: 0 };
    const r = await callSeat(cl, { ...a, prefix, prefixFileId: '' });
    total += r.cost; spend[seat] = (spend[seat] || 0) + r.cost; calls[seat] = (calls[seat] || 0) + 1; secsLog.push(r.secs); stopLog.push(r.stop);
    log.write(JSON.stringify({ at: virt.hhmm, seat, model: a.model, effort: a.effort, usage: r.usage, cost: r.cost, stop: r.stop, secs: r.secs, json: r.json }) + '\n');
    return r;
  };
  const handler = makeHandler({ clientFor: () => client, now: () => virt.t + (Date.now() - virt.real0), call, seats: registry });
  const env = { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'sim', ASSIST_CAP_USD: String(arg('cap', 20)) };
  for (let t = fromT - lead; t < fromT; t++) await feed(t);
  const ticks = [], shown = [];
  let after = null, lastId = 0;
  for (let t = fromT; t <= toT; t++) {
    if (total >= maxSpend) { console.error('stopped at ' + stamp(t) + ': spend cap $' + maxSpend + ' reached'); break; }
    await feed(t);
    virt.t = Date.parse(iso(t, 59)); virt.real0 = Date.now(); virt.hhmm = stamp(t);
    const res = await handler({ request: new Request('https://sim.example.test/api/gm/assist/tick', { method: 'POST', body: JSON.stringify(after === null ? {} : { after }), headers: { 'Content-Type': 'application/json' } }), env, data: { me: { role: 'gm', id: 'gm@example.test' } } });
    const b = JSON.parse(await res.text());
    after = b.last;
    const rows = exec.db.prepare('SELECT id, seat, card FROM gm_assist_log WHERE id > ? ORDER BY id').all(lastId).map(r => ({ ...r }));
    if (rows.length) lastId = rows[rows.length - 1].id;
    const called = rows.filter(r => r.seat !== 'editor' && !/"stop":"skipped"/.test(r.card || '')).map(r => r.seat);
    const card = (b.cards || [])[0] || null;
    if (card) shown.push({ t, seat: card.seat, text: card.text });
    const mrow = rows.find(r => r.seat === 'mystery'); let g = null;
    if (mrow) { try { const c = JSON.parse(mrow.card), o = c.out; g = o ? { item_given: !!(o.must_land_item || '').trim(), grounded: groundedItem(o.must_land_item), shown: c.shown === 1 } : null; } catch { g = null; } }
    ticks.push({ at: stamp(t), flags: b.flags || [], called, card, stall: b.stall || null, mystery: g, errors: b.errors || [], spend: b.spend && b.spend.tonight });
  }
  const gaps = shown.slice(1).map((c, i) => c.t - shown[i].t);
  const mys = ticks.filter(x => x.mystery);
  const calledCount = {}; for (const x of ticks) for (const s of x.called) calledCount[s] = (calledCount[s] || 0) + 1;
  const bySeat = {}; for (const c of shown) bySeat[c.seat] = (bySeat[c.seat] || 0) + 1;
  const md = ['# The Tap, simulated ' + stamp(fromT) + ' to ' + stamp(toT), '', '| minute | flags | seats called | card | Stall |', '|---|---|---|---|---|',
    ...ticks.map(x => '| ' + x.at + ' | ' + x.flags.join(', ') + ' | ' + x.called.join(', ') + ' | ' + (x.card ? '**' + x.card.seat + '**: ' + cell(x.card.text) : '') + ' | ' + (x.stall ? cell(x.stall.offer) : '') + ' |')];
  fs.writeFileSync(path.join(outDir, 'tap.md'), md.join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'tap.json'), JSON.stringify(ticks, null, 1) + '\n');
  const stats = `tap-sim ${stamp(fromT)}-${stamp(toT)}: ticks ${ticks.length}; total $${total.toFixed(3)}; seats on ${[...enabled].join(',')}; calls ${JSON.stringify(calledCount)}; cards shown ${shown.length} by seat ${JSON.stringify(bySeat)}; ` +
    `minutes between cards ${JSON.stringify(gaps)} (min ${gaps.length ? Math.min(...gaps) : 'n/a'}); stall offers ${ticks.filter(x => x.stall).length}; mystery runs ${mys.length}, with a Must land item ${mys.filter(x => x.mystery.item_given).length}, grounded ${mys.filter(x => x.mystery.grounded).length}, shown ${mys.filter(x => x.mystery.shown).length}; ` +
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
