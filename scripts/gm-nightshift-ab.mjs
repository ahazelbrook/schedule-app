#!/usr/bin/env node
// One-off A/B for the Night Shift (build plan WP6), live through the scripts. Generic: reads the transcript and prefix at run
// time, prints counts and dollars only, never the text.
//
//   node scripts/gm-nightshift-ab.mjs --transcript <file> --vault <dir> [--out gm-private/nightshift-ab] [--cap 3] [--variants A,B]
//       A = two-stage (sorters then the writer), B = one Opus call over the whole transcript. Writes <out>/A.md, B.md, A.json, B.json
//       and summary.md. The cap is the TOTAL for both variants.
//   node scripts/gm-nightshift-ab.mjs --file-scratch <note copy> --use A|B [--out ...] [--force]
//       no API call: files the stored result of that variant into a COPY of a session note (never the vault's own).
//
// The key is B68_ANTHROPIC_KEY only (never ANTHROPIC_API_KEY).

import fs from 'node:fs';
import path from 'node:path';
import { parseTranscript, runNightShift, renderDraft, applyDraft, loadPrefix, rollStats, estimateInput, parseAppRolls, applyApp, sourceStats } from './lib/nightshift.mjs';
import { makeClient } from '../functions/_lib/assist/claude.js';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const flag = (n) => argv.includes('--' + n);
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const out = path.resolve(arg('out', path.join(REPO, 'gm-private', 'nightshift-ab')));
fs.mkdirSync(out, { recursive: true });
const NAMES = { A: 'two-stage', B: 'single' };

if (arg('file-scratch')) {
  const v = arg('use');
  if (!NAMES[v]) { console.error('--use A|B'); process.exit(2); }
  const res = JSON.parse(fs.readFileSync(path.join(out, v + '.json'), 'utf8'));
  const f = path.resolve(arg('file-scratch'));
  if (!/scratch/i.test(path.basename(f))) { console.error('refusing: the target must be a scratch copy (its name has "scratch")'); process.exit(2); }
  const text = fs.readFileSync(f, 'utf8');
  applyApp(res, parseAppRolls(text));      // the app's own roll records in the note win; the stored speech rolls fill the rest
  const so = sourceStats(res.rolls), rs = rollStats(res.rolls);
  console.log('rolls: ' + rs.total + ' (app only ' + so.app + ', app+speech ' + so.both + ', speech only ' + so.speech + '); with position and dots ' + rs.complete + '; xp candidates by code ' + res.xp.length);
  const a = applyDraft(text, renderDraft(res, { date: arg('date', ''), session: arg('session', '') }), { force: flag('force') });
  if (a.action !== 'present') fs.writeFileSync(f, a.text);
  console.log(a.action + ' in ' + f);
  process.exit(0);
}

const tf = arg('transcript'), vault = arg('vault');
if (!tf || !vault) { console.error('--transcript <file> and --vault <dir> are required'); process.exit(2); }
const key = process.env.B68_ANTHROPIC_KEY;
if (!key) { console.error('Set B68_ANTHROPIC_KEY first.'); process.exit(2); }
const lines = parseTranscript(fs.readFileSync(tf, 'utf8'));
const { prefix, from } = await loadPrefix({ privateDir: path.join(REPO, 'gm-private'), vault });
if (!prefix) { console.error('no assist prefix'); process.exit(2); }
const cap = Number(arg('cap', 3));
console.log(`transcript lines ${lines.length}, prefix ${prefix.length} chars (${from}), cap $${cap}`);
const client = makeClient(key);
let spent = 0;
const rows = [];
for (const v of (arg('variants', 'A,B')).split(',')) {
  const left = cap - spent;
  if (left <= 0) { console.log(`cap reached before ${v}`); break; }
  const t0 = Date.now();
  const r = await runNightShift({ client, prefix, lines, mode: v === 'A' ? 'two-stage' : 'single', maxSpend: left, onStep: (name, c) => console.log(`  ${v} ${name}: stop=${c.stop} out=${c.usage && c.usage.output_tokens} $${c.cost.toFixed(3)} ${Math.round((Date.now() - t0) / 1000)}s`) });
  spent += r.spend;
  const s = rollStats(r.rolls);
  const secs = r.sections ? Object.values(r.sections).filter((x) => x && x.trim() && !/^\[TODO/.test(x.trim())).length : 0;
  fs.writeFileSync(path.join(out, v + '.json'), JSON.stringify({ mode: r.mode, spend: r.spend, rolls: r.rolls, sections: r.sections, sorted: r.sorted }, null, 1));
  if (r.ok) fs.writeFileSync(path.join(out, v + '.md'), renderDraft(r, { session: '' }) + '\n');
  rows.push({ v, mode: NAMES[v], ok: r.ok, stopped: r.stopped, reason: r.reason, spend: r.spend, parts: r.parts, calls: r.calls, secs, ...s, secsTotal: 6, seconds: Math.round((Date.now() - t0) / 1000) });
  console.log(`${v} ${NAMES[v]}: ${r.ok ? 'ok' : 'STOPPED ' + r.reason}; $${r.spend.toFixed(3)}; rolls ${s.total} (position+dots ${s.complete}); sections ${secs}/6; ${rows[rows.length - 1].seconds}s`);
}
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ lines: lines.length, prefixChars: prefix.length, cap, spent, rows }, null, 1));
console.log(`total spent $${spent.toFixed(3)}`);
