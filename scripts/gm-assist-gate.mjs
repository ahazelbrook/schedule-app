#!/usr/bin/env node
// The gate replay: one command that replays a finished session through the whole table agent and writes the gate report.
//
//   node scripts/gm-assist-gate.mjs --transcript <file> --prefix-from <pack.json | vault> [--assist-prep <vault note>] --session-label s02 \
//        [--fixer-at 22:12,22:40] [--voice-at 22:30=Name,22:50=Name] [--expect-ref 22:14,~22:24] [--max-spend 15] \
//        [--from 22:10 --to 22:20] --out gm-private/gate-s02 [--dry-run]
//
//   --prefix-from  a GM pack file (its parts.assist.prefix), or the word "vault" to build the prefix from the vault the way gm:pack
//                  does (read only; --vault <dir> or B68_VAULT, and --assist-prep <vault-relative note>, else gm-private/assist-config.json)
//   --fixer-at     the Fixer at those minutes. It fits the console's two draws, taken from --draws-file <json> or drawn from the pack's
//                  console part (--draws-pack, default gm-private/b68-gm-pack.json) with --draws-seed N (default 1); --position / --position-at
//   --voice-at     HH:MM=NPC: Voice wakes only when an NPC is named for the moment
//   --expect-ref   the known slips; a Ref card within 2 minutes counts as caught (~ marks an approximate time, matched the same way)
//   --max-spend    one cap over everything (default 15); the run stops cleanly and the report covers what ran
//   --dry-run      no API calls: counts the calls the Tap would make (Tripwire flags guessed by keyword) and estimates spend. The prefix
//                  size is counted with the free countTokens when a key is set (--no-count skips it), else chars/4
//   --day          YYYY-MM-DD for the virtual clock (default: the transcript note's own `date:`, else an invented date)
//   --out          a folder under gm-private/ (default gm-private/gate-<label>): gate.md for the GM, gate.json, calls are in gate.json
//
// The key is read from B68_ANTHROPIC_KEY, never ANTHROPIC_API_KEY. s03 is a hold-out: replay it, never tune on it. Generic and safe to
// commit: it prints counts and money, never table text.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeClient, countTokens } from '../functions/_lib/assist/claude.js';
import { SEATS } from '../functions/_lib/assist/seats.js';
import { parseMinutes, toMin, dayFromTranscript } from './lib/tap-sim.mjs';
import { makeDrawsFor, parsePositionAt } from './lib/fixer-draws.mjs';
import { runGate, report, parseExpectRef, GATE } from './lib/gate.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Read the prefix text: from a pack's assist part, or built from the vault. -> { prefix, from } (throws with a plain reason). */
export async function loadGatePrefix({ source, vault, prep, privateDir }) {
  if (source && source !== 'vault') {
    const pack = JSON.parse(fs.readFileSync(source, 'utf8'));
    const p = pack && pack.parts && pack.parts.assist && pack.parts.assist.prefix;
    if (typeof p !== 'string' || !p.trim()) throw new Error(`${source} has no parts.assist.prefix`);
    return { prefix: p, from: 'pack ' + path.basename(source) };
  }
  const { buildAssist, readConfig } = await import('./lib/assist-export.mjs');
  const a = buildAssist({ vault, exportedAt: '', prep, config: readConfig(path.join(privateDir, 'assist-config.json')), playersFile: path.join(privateDir, 'players.json'), warn: (w) => console.error(w) });
  if (!a || !a.prefix) throw new Error('could not build a prefix from the vault');
  return { prefix: a.prefix, from: 'vault' + (prep ? ' + ' + path.basename(prep) : '') };
}

export async function main(argv, { client: injected, log = console.log, err = console.error, repo = REPO } = {}) {
  const arg = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
  const flag = (n) => argv.includes(`--${n}`);
  const list = (n) => String(arg(n, '')).split(',').map((x) => x.trim()).filter(Boolean);
  const bad = (m) => { err(m); return 2; };

  const transcript = arg('transcript'), source = arg('prefix-from');
  if (!transcript) return bad('--transcript <file> is required');
  if (!source) return bad('--prefix-from <pack.json | vault> is required');
  const label = arg('session-label', '');
  const dry = flag('dry-run');
  const outDir = path.resolve(repo, arg('out', path.join('gm-private', 'gate-' + (label || 'run'))));
  const priv = path.resolve(repo, 'gm-private');
  if (path.relative(priv, outDir).startsWith('..') || path.relative(priv, outDir) === '') return bad('--out must be a folder under gm-private/ (the report quotes the table)');

  let expectRef;
  try { expectRef = parseExpectRef(arg('expect-ref', '')); } catch (e) { return bad(e.message); }
  const maxSpend = Number(arg('max-spend', GATE.nightUsd));
  if (!(maxSpend > 0)) return bad('--max-spend must be a positive number of dollars');
  const fixerAt = list('fixer-at').concat(list('fixer'));
  const voiceAt = list('voice-at').map((x) => { const [at, ...n] = x.split('='); return { at, npc: n.join('=').trim() }; });
  for (const t of [...fixerAt, ...voiceAt.map((v) => v.at), arg('from'), arg('to')].filter(Boolean)) if (!/^\d{1,2}:\d\d$/.test(t)) return bad('bad time ' + t + ' (use HH:MM)');

  const tText = fs.readFileSync(transcript, 'utf8');
  const allMinutes = parseMinutes(tText);
  const day = arg('day') || dayFromTranscript(tText);
  if (arg('day') && !/^\d{4}-\d\d-\d\d$/.test(day)) return bad('--day is YYYY-MM-DD');
  if (!allMinutes.size) return bad('no transcript lines in ' + transcript);

  let pre;
  try { pre = await loadGatePrefix({ source, vault: arg('vault', process.env.B68_VAULT || 'C:/Vault/Hazel Second Brain'), prep: arg('assist-prep'), privateDir: priv }); } catch (e) { return bad(e.message); }

  let drawsFor = null;
  if (fixerAt.length) {
    try { drawsFor = makeDrawsFor({ moments: fixerAt, file: arg('draws-file'), packFile: path.resolve(repo, arg('draws-pack', path.join('gm-private', 'b68-gm-pack.json'))), seed: Number(arg('draws-seed', 1)), position: arg('position', 'risky'), positionAt: parsePositionAt(arg('position-at', '')) }); } catch (e) { return bad(e.message); }
  }

  const key = process.env.B68_ANTHROPIC_KEY;
  let client = injected || null;
  if (!client && key) client = makeClient(key);
  if (!client && !dry) return bad('Set B68_ANTHROPIC_KEY first (a user environment variable).');
  const tokenCount = dry && client && !flag('no-count') ? async (model, prefix) => countTokens(client, { model, prefix, user: 'x' }) : undefined;

  const g = await runGate({
    client, day, prefix: pre.prefix, registry: structuredClone(SEATS), allMinutes,
    fromT: arg('from') ? toMin(arg('from')) : -1, toT: arg('to') ? toMin(arg('to')) : 1e9,
    fixerAt, drawsFor, voiceAt, expectRef, maxSpend, cap: Number(arg('cap', 1000)), dryRun: dry, tokenCount, label,
  });
  g.prefix = { from: pre.from, chars: pre.prefix.length };

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'gate.md'), report(g));
  fs.writeFileSync(path.join(outDir, 'gate.json'), JSON.stringify(g, null, 1) + '\n');
  log(`gate ${label || ''}${dry ? ' (dry run)' : ''}: ${g.window.from}-${g.window.to}, ${g.window.minutes} min, prefix ${pre.from} (${pre.prefix.length} chars)`);
  log(`spend $${g.spend.total.toFixed(3)} of $${maxSpend}${g.partial ? ' (STOPPED at the cap at ' + g.stoppedAt + ')' : ''}; projected per 4-hour night ${g.spend.projectedNight == null ? 'n/a (window under 30 min)' : '$' + g.spend.projectedNight.toFixed(2)}; by seat ${JSON.stringify(Object.fromEntries(Object.entries(g.spend.bySeat).map(([k, v]) => [k, `${v.calls} calls $${v.cost.toFixed(3)}`])))}`);
  if (!dry) log(`cards ${g.cards.length} (${g.cardsPer30} per 30 min); Fixer median ${g.fixer.median} s, max ${g.fixer.max} s`);
  for (const c of g.criteria) log(`${c.result.padEnd(11)} ${c.name}: ${c.detail}`);
  log(`written to ${outDir}`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e && e.stack || e); process.exit(1); });
}
