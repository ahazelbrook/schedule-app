// The release in one command (npm run release): the 01/11 deploy recipe as one step list.
//
//   npm run release -- --dry --expect <live version> --parts prep,assist --assist-prep <vault note>
//   npm run release -- --go  --expect <live version> --parts prep,assist --assist-prep <vault note> [--migrations 0009_x.sql]
//
// Steps, in order (the same list for --dry and a real run; --dry prints each and runs nothing):
//   guard        refuses on a game day and without --go (a dry run is exempt from --go)
//   worktree     fetch origin, deploy worktree detached at origin/main, clean check, npm ci if the lockfile changed
//   media        the gitignored files copied from the ambient2 worktree when missing
//   live         `wrangler deployments list` must show --expect as the live version (the rollback target)
//   bookmark     `wrangler d1 time-travel info blades68` (read, before anything changes)
//   handouts     npm run gm:handouts
//   check        npm run check:runtime, unstamped
//   migrate      the listed D1 migrations, remotely (must be exactly the pending ones)
//   deploy       stamp BUILD in app/routes.js, plain `wrangler deploy` (never npm run deploy), revert the stamp
//   parts        gm:pack, a trimmed pack of --parts, gm:push as a plan then --yes, each part read back
//   assist-file  gm-private/assist-file.json copied back to the main checkout
//   preflight    npm run gm:preflight -- --remote
//   note         the rollback line, and a line in gm-private/releases.log
//
// No `sh`: wrangler runs as `node <worktree>/node_modules/wrangler/bin/wrangler.js`, npm through npm-cli.js beside node.
// Exit 0 done, 1 a step failed (a note is still written), 2 refused before anything ran.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..');
export const GAME_DAYS = ['2026-11-07', '2026-11-21', '2026-11-27', '2026-12-18'];
export const MEDIA = ['app/ambient/calling-cards.html', 'tools/ambient/cards', 'app/media/theme.mp3'];
export const DB = 'blades68';
export const STEP_IDS = ['guard', 'worktree', 'media', 'live', 'bookmark', 'handouts', 'check', 'migrate', 'deploy', 'parts', 'assist-file', 'preflight', 'note'];

const WT_ROOT = path.resolve(REPO, '..');
const USAGE = [
  'usage: node scripts/release.mjs [--dry | --go] --expect <live version id> [--parts a,b] [--assist-prep <vault note>]',
  '                                [--assist-extra seat=note]... [--migrations 0009_x.sql,...] [--worktree <dir>] [--media-from <dir>]',
  '  --dry      print every step, run and write nothing        --go   required for a real run',
  '  --expect   the version id (or its first 8 characters) that must be live now: the rollback target',
  '  --parts    pack parts to push after the deploy, e.g. prep,assist,location,handouts',
  '  --assist-prep is required with the assist part; it goes to gm:pack (the pushed assist part is built from it)',
  '  --today YYYY-MM-DD overrides the date (tests)'
];

export function parseArgs(argv) {
  const o = { dry: false, go: false, parts: [], migrations: [], assistExtra: [], preflight: true };
  const need = (i, f) => { if (i >= argv.length || argv[i].startsWith('--')) throw new Error(f + ' needs a value'); return argv[i]; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry' || a === '--dry-run') o.dry = true;
    else if (a === '--go') o.go = true;
    else if (a === '--no-preflight') o.preflight = false;
    else if (a === '--expect') o.expect = need(++i, a);
    else if (a === '--parts') o.parts = need(++i, a).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--migrations') o.migrations = need(++i, a).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--assist-prep') o.assistPrep = need(++i, a);
    else if (a === '--assist-extra') o.assistExtra.push(need(++i, a));
    else if (a === '--worktree') o.worktree = need(++i, a);
    else if (a === '--media-from') o.mediaFrom = need(++i, a);
    else if (a === '--today') o.today = need(++i, a);
    else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error('unknown argument: ' + a);
  }
  for (const p of o.parts) if (!/^[a-z][a-z0-9_-]*$/i.test(p)) throw new Error('bad part name: ' + p);
  for (const m of o.migrations) if (!/^[\w.-]+\.sql$/.test(m)) throw new Error('bad migration name: ' + m);
  return o;
}

// ---- the context: the only way a step touches the world ----------------------------------------------------------------

/** The real effects. exec(cmd, args, {cwd}) -> {code, stdout} streams as it captures; fs is node's. */
export function realContext(opts) {
  const exec = (cmd, args, o = {}) => {
    const r = spawnSync(cmd, args, { cwd: o.cwd, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['inherit', 'pipe', 'pipe'], shell: !!o.shell });
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
    return { code: r.status === null ? 1 : r.status, stdout: (r.stdout || '') + (r.stderr || '') };
  };
  const rfs = {
    exists: (p) => fs.existsSync(p),
    read: (p) => fs.readFileSync(p, 'utf8'),
    write: (p, t) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); },
    append: (p, t) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.appendFileSync(p, t); },
    cp: (a, b) => { fs.mkdirSync(path.dirname(b), { recursive: true }); fs.cpSync(a, b, { recursive: true }); }
  };
  return { exec, fs: rfs, now: () => new Date(), print: (s) => console.log(s), repo: REPO, nodePath: process.execPath, npmCli: findNpmCli() };
}

function findNpmCli() {
  const p = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
  return fs.existsSync(p) ? p : null;
}

/** Dry wrapper: effects print and return a bland success; reads (exists, read) stay real so the plan is accurate. */
function dryContext(ctx) {
  const say = (s) => ctx.print('    [dry] ' + s);
  return {
    ...ctx,
    exec: (cmd, args, o = {}) => { say(showCmd(cmd, args, o)); return { code: 0, stdout: '', dry: true }; },
    fs: {
      exists: (p) => ctx.fs.exists(p), read: (p) => ctx.fs.read(p),
      write: (p) => say('write ' + p), append: (p) => say('append ' + p), cp: (a, b) => say('copy ' + a + ' -> ' + b)
    }
  };
}

const showCmd = (cmd, args, o) => (o.cwd ? '(in ' + o.cwd + ') ' : '') + [path.basename(cmd) === cmd ? cmd : '"' + cmd + '"'].concat(args.map((a) => (/\s/.test(a) ? '"' + a + '"' : a))).join(' ');

// ---- helpers -----------------------------------------------------------------------------------------------------------

export const melbourneDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Melbourne', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
export const utcDate = (d) => d.toISOString().slice(0, 10);
const dmy = (iso) => iso.slice(8, 10) + '/' + iso.slice(5, 7) + '/' + iso.slice(0, 4);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** The live version from `wrangler deployments list --json` (newest created_on), else the last uuid in the text. */
export function liveVersion(text) {
  try {
    const j = JSON.parse(text);
    const list = (Array.isArray(j) ? j : []).map((d) => ({ at: Date.parse(d.created_on || d.createdOn || ''), id: ((d.versions && d.versions[0]) || {}).version_id || d.id })).filter((d) => d.id);
    if (list.length) return list.sort((a, b) => (b.at || 0) - (a.at || 0))[0].id;
  } catch (e) { /* plain text */ }
  const all = String(text).match(UUID);
  return all ? all[all.length - 1] : null;
}

/** Part lines: "pack part prep v3 (n pieces, read back and verified)" -> {prep: 3}. */
export function verifiedParts(text) {
  const out = {}; const re = /pack part (\S+) v(\d+)[^\n]*read back and verified/g; let m;
  while ((m = re.exec(String(text)))) out[m[1]] = Number(m[2]);
  return out;
}

export function stampRoutes(src, build) {
  const re = /var BUILD = 'dev';/g;
  const n = (src.match(re) || []).length;
  if (n !== 1) throw new Error("app/routes.js: expected exactly one `var BUILD = 'dev';`, found " + n);
  return src.replace(re, "var BUILD = '" + build + "';");
}

const fail = (m) => { const e = new Error(m); e.step = true; return e; };

// ---- the steps ---------------------------------------------------------------------------------------------------------

function wranglerRun(S, args, o = {}) {
  return S.ctx.exec(S.ctx.nodePath, [path.join(S.wt, 'node_modules', 'wrangler', 'bin', 'wrangler.js')].concat(args), { cwd: S.wt, ...o });
}
function npmRun(S, args, o = {}) {
  const c = S.ctx;
  return c.npmCli ? c.exec(c.nodePath, [c.npmCli].concat(args), { cwd: S.wt, ...o }) : c.exec('npm', args, { cwd: S.wt, shell: true, ...o });
}
const git = (S, args, cwd) => S.ctx.exec('git', args, { cwd: cwd || S.wt });
const must = (r, what) => { if (r.code !== 0) throw fail(what + ' failed (exit ' + r.code + ')'); return r; };

export const STEPS = {
  guard(S) {
    const { opts, ctx } = S;
    const today = opts.today || melbourneDate(ctx.now());
    const hit = GAME_DAYS.filter((d) => d === today || d === utcDate(ctx.now()) || d === opts.today);
    if (hit.length) { S.refused = true; throw fail('refusing: ' + dmy(hit[0]) + ' is a game day'); }
    if (!opts.go && !opts.dry) { S.refused = true; throw fail('refusing: a real run needs --go'); }
    if (!opts.dry && !opts.expect) { S.refused = true; throw fail('refusing: a real run needs --expect <the live version id>'); }
    if (opts.parts.includes('assist') && !opts.assistPrep) { S.refused = true; throw fail('refusing: the assist part needs --assist-prep <vault note>'); }
    ctx.print('    today ' + dmy(today) + ' (Melbourne), not a game day; ' + (opts.dry ? 'dry run' : '--go given'));
  },

  worktree(S) {
    const { ctx, opts } = S;
    const fsx = ctx.fs;
    const hadModules = fsx.exists(path.join(S.wt, 'node_modules'));
    const present = fsx.exists(path.join(S.wt, '.git'));
    must(git(S, ['fetch', 'origin', 'main'], ctx.repo), 'git fetch');
    let before = '';
    if (!present) {
      must(git(S, ['worktree', 'add', '--detach', S.wt, 'origin/main'], ctx.repo), 'git worktree add');
    } else {
      const st = git(S, ['status', '--porcelain']);
      if (st.stdout.trim()) throw fail('the deploy worktree is not clean:\n' + st.stdout.trim());
      before = git(S, ['rev-parse', 'HEAD']).stdout.trim();
      must(git(S, ['checkout', '--detach', 'origin/main']), 'git checkout');
    }
    S.commit = git(S, ['rev-parse', 'HEAD']).stdout.trim() || (ctx.dry ? '<commit>' : '');
    if (!ctx.dry && !S.commit) throw fail('could not read the worktree commit');
    S.commit7 = S.commit.startsWith('<') ? S.commit : S.commit.slice(0, 7);
    let lock = !hadModules || !before;
    if (!lock) lock = git(S, ['diff', '--name-only', before, 'HEAD', '--', 'package-lock.json']).stdout.trim() !== '';
    ctx.print('    worktree ' + S.wt + ' at ' + (S.commit7 || '?') + (lock ? ': npm ci' : ': lockfile unchanged, no npm ci'));
    if (lock) must(npmRun(S, ['ci']), 'npm ci');
  },

  media(S) {
    const { ctx } = S;
    for (const rel of MEDIA) {
      const dst = path.join(S.wt, rel), src = path.join(S.mediaFrom, rel);
      if (ctx.fs.exists(dst)) { ctx.print('    have ' + rel); continue; }
      if (!ctx.fs.exists(src)) throw fail('media missing in both places: ' + rel);
      ctx.fs.cp(src, dst);
    }
  },

  live(S) {
    const { ctx, opts } = S;
    const r = must(wranglerRun(S, ['deployments', 'list', '--json']), 'wrangler deployments list');
    if (ctx.dry) { S.previous = opts.expect || '<live version>'; return; }
    S.previous = liveVersion(r.stdout);
    if (!S.previous) throw fail('could not read the live version from wrangler deployments list');
    ctx.print('    live version ' + S.previous);
    if (!S.previous.toLowerCase().startsWith(String(opts.expect).toLowerCase())) throw fail('live version is ' + S.previous + ', expected ' + opts.expect + ': someone deployed since; stop and look');
  },

  bookmark(S) {
    const r = must(wranglerRun(S, ['d1', 'time-travel', 'info', DB]), 'd1 time-travel info');
    const m = /([0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{32})/i.exec(r.stdout);
    S.bookmark = m ? m[1] : (r.stdout.trim().split('\n').pop() || '').trim() || (S.ctx.dry ? '<bookmark>' : '');
    if (!S.ctx.dry && !S.bookmark) throw fail('no D1 bookmark in the time-travel output');
    S.ctx.print('    bookmark ' + S.bookmark);
  },

  handouts(S) { must(npmRun(S, ['run', 'gm:handouts']), 'gm:handouts'); },

  check(S) { must(npmRun(S, ['run', 'check:runtime']), 'check:runtime'); },

  migrate(S) {
    const { ctx, opts } = S;
    if (!opts.migrations.length) { ctx.print('    no migrations listed'); return; }
    for (const m of opts.migrations) if (!ctx.fs.exists(path.join(S.wt, 'migrations', m))) { if (!ctx.dry) throw fail('migration not in the worktree: ' + m); ctx.print('    (dry: ' + m + ' is not in the worktree yet; a real run refuses)'); }
    const r = must(wranglerRun(S, ['d1', 'migrations', 'list', DB, '--remote']), 'd1 migrations list');
    if (!ctx.dry) {
      const pending = opts.migrations.filter((m) => r.stdout.includes(m));
      if (pending.length !== opts.migrations.length) throw fail('not every listed migration is pending: ' + opts.migrations.filter((m) => !r.stdout.includes(m)).join(', '));
    }
    must(wranglerRun(S, ['d1', 'migrations', 'apply', DB, '--remote']), 'd1 migrations apply');
    S.migrated = opts.migrations.slice();
  },

  deploy(S) {
    const { ctx } = S;
    const file = path.join(S.wt, 'app', 'routes.js');
    const build = (S.opts.today || utcDate(ctx.now())).replace(/-/g, '') + '-' + S.commit7;
    S.build = build;
    let stamped = null;
    try { stamped = stampRoutes(ctx.fs.read(file), build); } catch (e) { if (!ctx.dry) throw e; ctx.print('    (dry: worktree not on disk yet, stamp not checked)'); }
    ctx.print('    BUILD ' + build);
    let r = null, err = null;
    try {
      ctx.fs.write(file, stamped);
      r = wranglerRun(S, ['deploy']);
    } catch (e) { err = e; }
    finally {
      const back = git(S, ['checkout', '--', 'app/routes.js']);
      if (back.code !== 0) ctx.print('    WARNING: could not revert app/routes.js; run: git -C "' + S.wt + '" checkout -- app/routes.js');
    }
    if (err) throw err;
    if (r.code !== 0) throw fail('wrangler deploy failed (exit ' + r.code + '); routes.js reverted');
    const m = /Current Version ID:\s*(\S+)/i.exec(r.stdout) || (r.stdout.match(UUID) ? [null, r.stdout.match(UUID).pop()] : null);
    S.version = m ? m[1] : (ctx.dry ? '<new version>' : '');
    ctx.print('    deployed ' + (S.version || '(version id not found in the output)'));
  },

  parts(S) {
    const { ctx, opts } = S;
    if (!opts.parts.length) { ctx.print('    no parts listed'); return; }
    const full = path.join('gm-private', 'release-pack-full.json'), trimmed = path.join('gm-private', 'release-pack.json');
    const packArgs = ['run', 'gm:pack', '--', '--out', full];
    if (opts.parts.includes('assist') && opts.assistPrep) packArgs.push('--assist-prep', opts.assistPrep);
    for (const x of opts.assistExtra) packArgs.push('--assist-extra', x);
    must(npmRun(S, packArgs), 'gm:pack');
    if (ctx.dry) ctx.print('    [dry] trim ' + full + ' to parts ' + opts.parts.join(',') + ' -> ' + trimmed);
    else {
      const pack = JSON.parse(ctx.fs.read(path.join(S.wt, full)));
      const miss = opts.parts.filter((p) => !pack.parts || !pack.parts[p]);
      if (miss.length) throw fail('the pack has no part: ' + miss.join(', '));
      const keep = {}; for (const p of opts.parts) keep[p] = pack.parts[p];
      ctx.fs.write(path.join(S.wt, trimmed), JSON.stringify({ ...pack, parts: keep }));
    }
    const base = ['run', 'gm:push', '--', '--pack', trimmed, '--only', 'pack'];
    npmRun(S, base);                                       // the plan; gm:push exits 255 even on success, so the exit is not read
    const push = npmRun(S, base.concat('--yes'));
    S.pushed = verifiedParts(push.stdout);
    if (ctx.dry) { for (const p of opts.parts) S.pushed[p] = '<n>'; }
    const bad = opts.parts.filter((p) => !S.pushed[p]);
    if (bad.length) throw fail('not read back and verified: ' + bad.join(', ') + ' (judge by the "read back and verified" lines above)');
    ctx.print('    parts verified: ' + opts.parts.map((p) => p + ' v' + S.pushed[p]).join(', '));
  },

  'assist-file'(S) {
    const { ctx, opts } = S;
    if (!opts.parts.includes('assist')) { ctx.print('    assist not pushed, nothing to copy'); return; }
    const src = path.join(S.wt, 'gm-private', 'assist-file.json'), dst = path.join(ctx.repo, 'gm-private', 'assist-file.json');
    if (!ctx.fs.exists(src)) { if (ctx.dry) { ctx.fs.cp(src, dst); return; } throw fail('no gm-private/assist-file.json in the worktree to copy back'); }
    ctx.fs.cp(src, dst);
  },

  preflight(S) {
    if (!S.opts.preflight) { S.ctx.print('    skipped (--no-preflight)'); return; }
    const r = npmRun(S, ['run', 'gm:preflight', '--', '--remote']);
    S.preflightOk = r.code === 0;
    if (!S.preflightOk) S.ctx.print('    WARNING: preflight exited ' + r.code + ': read it before telling Alex to reload');
  },

  note(S) { writeNote(S, 'done'); }
};

function noteLine(S, status) {
  const o = S.opts;
  return [
    S.ctx.now().toISOString(), status, 'commit ' + (S.commit7 || '-'), 'build ' + (S.build || '-'), 'version ' + (S.version || '-'),
    'previous ' + (S.previous || '-'), 'bookmark ' + (S.bookmark || '-'),
    'migrations ' + ((S.migrated || []).join(',') || '-'),
    'parts ' + (o.parts.map((p) => p + (S.pushed && S.pushed[p] ? ' v' + S.pushed[p] : '')).join(',') || '-'),
    'preflight ' + (S.preflightOk === undefined ? '-' : S.preflightOk ? 'ok' : 'CHECK'),
    'rollback: ' + rollbackLine(S)
  ].join(' | ');
}
const rollbackLine = (S) => 'npx wrangler rollback ' + (S.previous || '<previous>');

function writeNote(S, status) {
  const line = noteLine(S, status);
  S.ctx.print('    ' + line);
  S.ctx.print('    ROLLBACK: ' + rollbackLine(S) + (S.bookmark ? '   (D1 bookmark ' + S.bookmark + ')' : ''));
  S.ctx.fs.append(path.join(S.ctx.repo, 'gm-private', 'releases.log'), line + '\n');
}

/** Run the step list. ctx is realContext() or a test double. Returns {code, S}. */
export async function run(opts, ctx) {
  const dry = !!opts.dry;
  const base = ctx || realContext(opts);
  const S = {
    opts, dry, ctx: dry ? { ...dryContext(base), dry: true } : { ...base, dry: false },
    wt: opts.worktree || path.join(WT_ROOT, 'deploy-31bf4f9'), mediaFrom: opts.mediaFrom || path.join(WT_ROOT, 'ambient2'),
    ran: []
  };
  const say = S.ctx.print;
  say(dry ? 'DRY RUN: every step is printed, none is executed' : 'RELEASE: real run');
  for (const id of STEP_IDS) {
    say('[' + (S.ran.length + 1) + '/' + STEP_IDS.length + '] ' + id);
    S.ran.push(id);
    try { await STEPS[id](S); }
    catch (e) {
      say('    FAILED: ' + (e && e.message || e));
      if (S.refused) return { code: 2, S };
      if (!dry && id !== 'note') { try { writeNote(S, 'FAILED at ' + id); } catch (e2) { /* nothing more to do */ } }
      return { code: 1, S };
    }
  }
  say(dry ? 'DRY RUN complete: nothing was run or written.' : 'Release complete.');
  return { code: 0, S };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(String(e.message || e)); console.error(USAGE.join('\n')); process.exit(2); }
  if (opts.help) { console.log(USAGE.join('\n')); process.exit(0); }
  const { code } = await run(opts);
  process.exit(code);
}
