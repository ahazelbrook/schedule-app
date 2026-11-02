// The release script (scripts/release.mjs): one step list for --dry and a real run, with every command and file write
// stubbed. Nothing here runs git, npm or wrangler. Paths, versions and notes are made up.
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseArgs, run, STEP_IDS, GAME_DAYS, liveVersion, verifiedParts, stampRoutes, melbourneDate } from '../../scripts/release.mjs';

let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const WT = path.resolve('/tmp-wt/deploy'), MAIN = path.resolve('/tmp-main'), AMB = path.resolve('/tmp-wt/ambient');
const LIVE = 'aaaaaaaa-1111-4111-8111-111111111111', NEWV = 'bbbbbbbb-2222-4222-8222-222222222222';
const BM = '00000001-00000002-00000003-' + 'a'.repeat(32);
const ROUTES = "/* x */\n  var BUILD = 'dev';   /* B68_BUILD */\n";
const NOW = new Date('2026-11-03T02:00:00Z');
const ROUTES_PATH = path.join(WT, 'app', 'routes.js');

// A fake world: scripted exec, in-memory files. `log` records every effect in order.
function world(over = {}) {
  const files = new Map([[path.join(WT, '.git'), ''], [path.join(WT, 'node_modules'), ''], [ROUTES_PATH, ROUTES],
    [path.join(AMB, 'app/ambient/calling-cards.html'), 'c'], [path.join(AMB, 'tools/ambient/cards'), 'c'], [path.join(AMB, 'app/media/theme.mp3'), 'c'],
    [path.join(WT, 'app/ambient/calling-cards.html'), 'c'], [path.join(WT, 'tools/ambient/cards'), 'c'], [path.join(WT, 'app/media/theme.mp3'), 'c'],
    [path.join(WT, 'migrations', '0009_x.sql'), 'sql'], [path.join(WT, 'gm-private', 'assist-file.json'), '{}']]);
  const log = [], printed = [], routesSeen = [];
  const pack = { format: 1, exportedAt: 'x', parts: { prep: { a: 1 }, assist: { b: 2 }, location: { c: 3 } } };
  const handlers = over.handlers || {};
  const exec = (cmd, args, o = {}) => {
    const line = (cmd === 'git' ? 'git ' : '') + args.map((a) => String(a).replace(WT, '<wt>')).join(' ');
    log.push({ kind: 'exec', line, cwd: o.cwd });
    if (over.throwOn && over.throwOn(line)) throw new Error('boom: ' + line);
    for (const [re, fn] of Object.entries(handlers)) if (new RegExp(re).test(line)) return fn(line);
    if (cmd === 'git' && args[0] === 'rev-parse') return { code: 0, stdout: 'abcdef0123456789\n' };
    if (cmd === 'git' && args[0] === 'status') return { code: 0, stdout: '' };
    if (cmd === 'git' && args[0] === 'diff') return { code: 0, stdout: '' };
    if (/deployments list/.test(line)) return { code: 0, stdout: JSON.stringify([{ created_on: '2026-10-01T00:00:00Z', versions: [{ version_id: 'old' }] }, { created_on: '2026-11-01T00:00:00Z', versions: [{ version_id: LIVE }] }]) };
    if (/time-travel info/.test(line)) return { code: 0, stdout: "The current bookmark is '" + BM + "'\n" };
    if (/migrations list/.test(line)) return { code: 0, stdout: '0009_x.sql\n' };
    if (/wrangler\.js deploy$/.test(line)) { routesSeen.push(files.get(ROUTES_PATH)); return { code: 0, stdout: 'Current Version ID: ' + NEWV + '\n' }; }
    if (/checkout -- app\/routes\.js/.test(line)) { files.set(ROUTES_PATH, ROUTES); return { code: 0, stdout: '' }; }
    if (/gm:pack/.test(line)) { files.set(path.join(WT, 'gm-private', 'release-pack-full.json'), JSON.stringify(pack)); return { code: 0, stdout: '' }; }
    if (/gm:push/.test(line) && /--yes/.test(line)) {
      const parts = Object.keys(JSON.parse(files.get(path.join(WT, 'gm-private', 'release-pack.json'))).parts);
      return { code: 255, stdout: parts.map((p, i) => '  pack part ' + p + ' v' + (i + 4) + ' (3 pieces, read back and verified)').join('\n') };
    }
    return { code: 0, stdout: '' };
  };
  const rfs = {
    exists: (p) => files.has(p),
    read: (p) => { if (!files.has(p)) throw new Error('ENOENT ' + p); return files.get(p); },
    write: (p, t) => { log.push({ kind: 'write', line: p }); files.set(p, t); },
    append: (p, t) => { log.push({ kind: 'append', line: p }); files.set(p, (files.get(p) || '') + t); },
    cp: (a, b) => { log.push({ kind: 'cp', line: a + ' -> ' + b }); files.set(b, files.get(a) || ''); }
  };
  const ctx = { exec, fs: rfs, now: () => NOW, print: (s) => printed.push(s), repo: MAIN, nodePath: 'node', npmCli: 'npm-cli.js' };
  return { ctx, files, log, printed, routesSeen };
}
const base = (extra) => parseArgs(['--expect', 'aaaaaaaa', '--worktree', WT, '--media-from', AMB].concat(extra || []));
const stepsOf = (printed) => printed.filter((l) => /^\[\d+\/\d+\] /.test(l)).map((l) => l.replace(/^\[\d+\/\d+\] /, ''));
const execLines = (w) => w.log.filter((l) => l.kind === 'exec').map((l) => l.line);

await test('parseArgs: parts, migrations, flags, bad input', () => {
  const o = parseArgs(['--go', '--expect', 'abc', '--parts', 'prep, assist', '--migrations', '0009_a.sql', '--assist-extra', 's=n']);
  assert.deepEqual([o.go, o.dry, o.parts, o.migrations, o.assistExtra], [true, false, ['prep', 'assist'], ['0009_a.sql'], ['s=n']]);
  assert.throws(() => parseArgs(['--nope']), /unknown argument/);
  assert.throws(() => parseArgs(['--expect']), /needs a value/);
  assert.throws(() => parseArgs(['--parts', 'a;b']), /bad part name/);
  assert.throws(() => parseArgs(['--migrations', '../x']), /bad migration name/);
});

await test('helpers: liveVersion, verifiedParts, stampRoutes, melbourneDate', () => {
  assert.equal(liveVersion(JSON.stringify([{ created_on: '2026-01-01', versions: [{ version_id: 'a' }] }, { created_on: '2026-02-01', versions: [{ version_id: 'b' }] }])), 'b');
  assert.equal(liveVersion('Version(s): ' + LIVE + '\nVersion(s): ' + NEWV), NEWV);
  assert.deepEqual(verifiedParts('pack part prep v2 (4 pieces, read back and verified)\npack part x v1 (nope)'), { prep: 2 });
  assert.match(stampRoutes(ROUTES, '20261103-abcdef0'), /var BUILD = '20261103-abcdef0';/);
  assert.throws(() => stampRoutes('nothing', 'x'), /found 0/);
  assert.equal(melbourneDate(new Date('2026-11-06T20:00:00Z')), '2026-11-07');   // Friday evening UTC is already Saturday in Melbourne
  assert.equal(GAME_DAYS.length, 4);
});

await test('refuses on a game day, without --go, without --expect, and assist without --assist-prep: no command runs', async () => {
  for (const [args, re] of [[['--go', '--today', '2026-11-07'], /game day/], [['--go', '--today', '2026-12-18'], /game day/], [[], /needs --go/], [['--go', '--parts', 'assist'], /assist-prep/]]) {
    const w = world();
    const r = await run(base(args), w.ctx);
    assert.equal(r.code, 2); assert.match(w.printed.join('\n'), re); assert.equal(w.log.length, 0);
  }
  const w = world();
  assert.equal((await run(parseArgs(['--go', '--worktree', WT]), w.ctx)).code, 2); assert.match(w.printed.join('\n'), /--expect/);
  const w2 = world(); w2.ctx.now = () => new Date('2026-11-06T22:00:00Z');       // Saturday 07/11 in Melbourne
  assert.equal((await run(base(['--go']), w2.ctx)).code, 2); assert.equal(w2.log.length, 0);
});

await test('--dry: every step is printed, exec is never called, no file is written', async () => {
  const w = world({ throwOn: () => true });
  let execCalls = 0;
  const ctx = { ...w.ctx, exec: (...a) => { execCalls++; return w.ctx.exec(...a); } };
  const r = await run(base(['--dry', '--parts', 'prep,assist', '--assist-prep', 'n.md', '--migrations', '0009_x.sql']), ctx);
  assert.equal(r.code, 0); assert.equal(execCalls, 0); assert.equal(w.log.length, 0);
  assert.deepEqual(stepsOf(w.printed), STEP_IDS);
  const text = w.printed.join('\n');
  for (const needle of ['deployments list', 'time-travel info', 'gm:handouts', 'check:runtime', 'migrations apply', 'wrangler.js deploy', 'gm:push', '--yes', 'releases.log', 'ROLLBACK']) assert.ok(text.includes(needle), 'dry output names ' + needle);
  assert.equal(w.files.get(ROUTES_PATH), ROUTES);
});

await test('real run (stubbed): same step list, right order, stamp on the deploy only, reverted after, rollback line and note', async () => {
  const w = world();
  const r = await run(base(['--go', '--parts', 'prep,assist', '--assist-prep', 'n.md', '--migrations', '0009_x.sql']), w.ctx);
  assert.equal(r.code, 0, w.printed.join('\n'));
  assert.deepEqual(stepsOf(w.printed), STEP_IDS);
  const lines = execLines(w);
  const order = [/fetch origin main/, /deployments list/, /time-travel info/, /gm:handouts/, /check:runtime/, /migrations apply/, /wrangler\.js deploy$/, /checkout -- app\/routes\.js/, /gm:pack/, /gm:push.*--only pack$/, /gm:push.*--yes/, /gm:preflight -- --remote/]
    .map((re) => lines.findIndex((l) => re.test(l)));
  assert.ok(order.every((i) => i >= 0), 'all commands ran: ' + JSON.stringify(order));
  assert.deepEqual(order.slice().sort((a, b) => a - b), order, 'in order');
  assert.ok(!lines.some((l) => /run deploy|deploy\.sh|rollback /.test(l)), 'never the old deploy script or a rollback');
  assert.ok(lines.find((l) => /gm:pack/.test(l)).includes('--assist-prep n.md'));
  assert.ok(!lines.filter((l) => /gm:push/.test(l)).some((l) => /assist-prep/.test(l)), 'assist-prep is for gm:pack only');
  assert.match(w.routesSeen[0], /var BUILD = '20261103-abcdef0';/);
  assert.equal(w.files.get(ROUTES_PATH), ROUTES);
  const trimmed = JSON.parse(w.files.get(path.join(WT, 'gm-private', 'release-pack.json')));
  assert.deepEqual(Object.keys(trimmed.parts).sort(), ['assist', 'prep']);
  assert.ok(w.files.has(path.join(MAIN, 'gm-private', 'assist-file.json')), 'assist-file copied back');
  const note = w.files.get(path.join(MAIN, 'gm-private', 'releases.log'));
  assert.ok(note.includes('npx wrangler rollback ' + LIVE) && note.includes(BM) && note.includes('version ' + NEWV) && note.includes('prep v4,assist v5'), note);
  assert.ok(w.printed.some((l) => l.includes('ROLLBACK: npx wrangler rollback ' + LIVE)));
});

await test('media is copied from ambient2 only when missing; npm ci only when the lockfile moved or modules are absent', async () => {
  const w = world(); w.files.delete(path.join(WT, 'app/media/theme.mp3'));
  assert.equal((await run(base(['--go']), w.ctx)).code, 0);
  assert.equal(w.log.filter((l) => l.kind === 'cp').length, 1);
  assert.ok(!w.log.some((l) => / ci$/.test(l.line)));
  const w2 = world(); w2.files.delete(path.join(WT, 'node_modules'));
  await run(base(['--go']), w2.ctx); assert.ok(w2.log.some((l) => / ci$/.test(l.line)));
  const w3 = world({ handlers: { '^git diff': () => ({ code: 0, stdout: 'package-lock.json\n' }) } });
  await run(base(['--go']), w3.ctx); assert.ok(w3.log.some((l) => / ci$/.test(l.line)));
});

await test('stops when the live version is not the expected one, and writes a FAILED note without deploying', async () => {
  const w = world({ handlers: { 'deployments list': () => ({ code: 0, stdout: JSON.stringify([{ created_on: '2026-11-02T00:00:00Z', versions: [{ version_id: 'cccccccc-9999' }] }]) }) } });
  const r = await run(base(['--go']), w.ctx);
  assert.equal(r.code, 1); assert.match(w.printed.join('\n'), /expected aaaaaaaa/);
  assert.ok(!execLines(w).some((l) => /wrangler\.js deploy$/.test(l)));
  assert.ok((w.files.get(path.join(MAIN, 'gm-private', 'releases.log')) || '').includes('FAILED at live'));
});

await test('a failing or throwing deploy still reverts app/routes.js', async () => {
  const w = world({ handlers: { 'wrangler\\.js deploy$': () => ({ code: 1, stdout: 'nope' }) } });
  assert.equal((await run(base(['--go']), w.ctx)).code, 1);
  assert.ok(execLines(w).some((l) => /checkout -- app\/routes\.js/.test(l)));
  assert.equal(w.files.get(ROUTES_PATH), ROUTES);
  const w2 = world({ throwOn: (l) => /wrangler\.js deploy$/.test(l) });
  await run(base(['--go']), w2.ctx).catch(() => null);
  assert.ok(execLines(w2).some((l) => /checkout -- app\/routes\.js/.test(l)), 'reverted even though exec threw');
  assert.equal(w2.files.get(ROUTES_PATH), ROUTES);
});

await test('a push without a "read back and verified" line for every part fails; a part missing from the pack fails', async () => {
  const w = world({ handlers: { 'gm:push.*--yes': () => ({ code: 255, stdout: '  pack part prep v4 (3 pieces, read back and verified)' }) } });
  const r = await run(base(['--go', '--parts', 'prep,location']), w.ctx);
  assert.equal(r.code, 1); assert.match(w.printed.join('\n'), /not read back and verified: location/);
  const w2 = world();
  assert.equal((await run(base(['--go', '--parts', 'handouts']), w2.ctx)).code, 1);
  assert.match(w2.printed.join('\n'), /pack has no part: handouts/);
});

await test('a listed migration that is not pending, or not in the worktree, stops before the deploy', async () => {
  const w = world({ handlers: { 'migrations list': () => ({ code: 0, stdout: 'nothing pending' }) } });
  assert.equal((await run(base(['--go', '--migrations', '0009_x.sql']), w.ctx)).code, 1);
  assert.ok(!execLines(w).some((l) => /migrations apply|wrangler\.js deploy$/.test(l)));
  const w2 = world();
  assert.equal((await run(base(['--go', '--migrations', '0010_none.sql']), w2.ctx)).code, 1);
});

await test('a dirty deploy worktree is refused before any change', async () => {
  const w = world({ handlers: { '^git status': () => ({ code: 0, stdout: ' M app/x.js\n' }) } });
  assert.equal((await run(base(['--go']), w.ctx)).code, 1);
  assert.ok(!execLines(w).some((l) => /checkout --detach/.test(l)));
});

console.log('\nrelease: ' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
