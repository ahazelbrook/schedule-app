// The kit's day-0 baseline (KS04.1): every demo-night scenario at its viewport, as a PNG and a layout fingerprint, plus the request logs, taken from commit 798907c
// (Deploy 35) in a worktree of its own, so the baseline can never drift with the branch. The harness (the scripts/ files this build adds) is copied over that
// worktree for the run: the app under test is 798907c's, the code that looks at it is this branch's. The worktree is removed afterwards.
//   PW_MODULE=<playwright> PW_CHANNEL=msedge node scripts/kit-baseline.mjs --port 10150 [--out <dir>] [--commit 798907c] [--keep]
//   node scripts/kit-baseline.mjs --compare <dirA> <dirB>      two baselines (or a baseline and a run) against each other: the first 20 differences
// --out defaults to b68-wt\_kit-shots\baseline (outside the repo). Take it twice (--out ...\baseline-2) and --compare the two: they must agree.
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareFolders } from './kit-fingerprint.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WT = path.resolve(ROOT, '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };

function report(r, label) {
  console.log(label + ': ' + r.compared + ' fingerprints compared, ' + r.absent.length + ' absent, ' + r.diffs.length + ' differences, ' + r.exempted.length + ' exempted');
  for (const f of r.absent.slice(0, 20)) console.log('  ABSENT ' + f);
  for (const d of r.diffs.slice(0, 20)) console.log('  ' + d.file + '  ' + d.kind + '  ' + d.key.split('/').slice(-3).join('/') + '  ' + d.detail);
  if (r.diffs.length > 20) console.log('  ... and ' + (r.diffs.length - 20) + ' more');
  for (const [s, q] of Object.entries(r.requests)) {
    console.log('  requests ' + s + ': ' + q.extra.length + ' new' + (q.allowed.length ? ' (+' + q.allowed.length + ' allowed: kit-flag.js)' : '') + ', ' + q.missing.length + ' not made this time');
    for (const u of q.extra.slice(0, 20)) console.log('    NEW ' + u);
    for (const u of q.missing.slice(0, 20)) console.log('    GONE ' + u);
  }
}

if (argv.includes('--compare')) {
  const i = argv.indexOf('--compare');
  const r = await compareFolders(path.resolve(argv[i + 1]), path.resolve(argv[i + 2]));
  report(r, 'compare');
  const bad = r.diffs.length || r.absent.length || Object.values(r.requests).some((q) => q.extra.length || q.missing.length);
  console.log(bad ? 'DIFFERENT' : 'AGREE');
  process.exit(bad ? 1 : 0);
}

const PORT = Number(opt('port', 10150)), COMMIT = opt('commit', '798907c'), OUT = path.resolve(opt('out', path.join(WT, '_kit-shots', 'baseline')));
const BASE = path.join(WT, 'ks04-base');
const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', stdio: o.stdio || 'pipe', cwd: o.cwd || ROOT, env: o.env || process.env, shell: false });
if (existsSync(BASE)) { console.error('b68-wt\\ks04-base already exists: remove it (git worktree remove --force) before a new baseline'); process.exit(2); }
let made = false;
try {
  let r = run('git', ['worktree', 'add', '--detach', BASE, COMMIT]);
  if (r.status !== 0) throw new Error('git worktree add: ' + r.stderr);
  made = true;
  symlinkSync(path.join(WT, 'deploy-31bf4f9', 'node_modules'), path.join(BASE, 'node_modules'), 'junction');
  for (const f of ['kit-fingerprint.mjs', 'demo-night.mjs', 'demo-night-shots.mjs', 'demo-night-band-shots.mjs', 'demo-night-kit-shots.mjs']) copyFileSync(path.join(ROOT, 'scripts', f), path.join(BASE, 'scripts', f));
  rmSync(OUT, { recursive: true, force: true }); mkdirSync(OUT, { recursive: true });
  const env = { ...process.env, PW_MODULE: process.env.PW_MODULE || 'C:/Users/ahaze/AppData/Local/Temp/b07pw/node_modules/playwright-core', PW_CHANNEL: process.env.PW_CHANNEL || 'msedge', CI: '1' };
  delete env.B68_ANTHROPIC_KEY; delete env.ANTHROPIC_API_KEY;
  const head = run('git', ['rev-parse', 'HEAD'], { cwd: BASE }).stdout.trim();
  console.log('baseline of ' + head + ' into ' + OUT + ' on port ' + PORT);
  r = run(process.execPath, [path.join(BASE, 'scripts', 'demo-night.mjs'), '--port', String(PORT), '--shots', OUT, '--fingerprint'], { cwd: BASE, env, stdio: 'inherit' });
  const now = new Date();
  writeFileSync(path.join(OUT, 'baseline-meta.json'), JSON.stringify({ v: 1, commit: head, capturedAt: now.toISOString(), localTime: now.toTimeString().slice(0, 5), files: readdirSync(OUT).filter((f) => f.endsWith('.json')).length }, null, 1));
  if (r.status !== 0) throw new Error('demo-night exited ' + r.status);
} finally {
  if (made && !argv.includes('--keep')) { run('git', ['worktree', 'remove', '--force', BASE]); rmSync(BASE, { recursive: true, force: true }); run('git', ['worktree', 'prune']); }
}
