// The shared clocks under concurrent writes (CAMPAIGN.md, *Clocks*), against a local `wrangler dev` (the Worker in worker/).
//
//   node checks/api/clocks.mjs            (part of npm run check:api)
//
// First the server's clock functions in plain node (ids, ops, the stale-array count), then the API on its own dev server
// on PORT (default 8788) with DEV_USER set and a throwaway D1 state directory:
//   (a) two players ticking different clocks, one after the other from the same copy and all at once, both land
//   (b) a player ticking while the GM renames, resizes, re-kinds or hides another clock
//   (c) the GM adding and removing clocks while players tick
//   (d) two ticks of the same clock: the one the server takes last wins on that clock, nothing else moves
//   the previous release's whole `clocks` array, interleaved with ops: a current one lands, a stale one is refused (412)
//   without undoing anything, a player's rename through it is still 403; documents whose clocks have no ids
//   a player's ops may only fill (403 otherwise); malformed ops are 400; an op applied twice changes nothing more
// Prints PASS/FAIL per step, exits non-zero on any failure, always stops the server.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withClockIds, applyClockOps, checkClockOps, changedFills, playerMayWrite, STALE_CLOCKS, CLOCK_OPS_MAX } from '../../functions/_lib/campaign.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 8788);
const GM = 'gm@example.test';
const P1 = 'player@example.test';
const P2 = 'player2@example.test';
const P3 = 'player3@example.test';
const GM_ONLY = 'only the GM can change that';
const OVERALL_TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS || 180000);

let server = null;
const stateDir = mkdtempSync(join(tmpdir(), 'b68-clocks-check-'));
let failures = 0;
let passes = 0;

function signalServer(sig) {
  if (!server) return;
  // the whole process group (wrangler and its workerd), even if wrangler is gone
  try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(-server.pid, sig); } catch (_) {}
}
async function stopServer() {
  signalServer('SIGTERM');
  const until = Date.now() + 5000;
  while (server && Date.now() < until && server.exitCode === null && server.signalCode === null) await sleep(100);
  signalServer('SIGKILL');
  try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {}
}
process.on('exit', () => signalServer('SIGKILL'));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await stopServer(); process.exit(130); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));

const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler');
const WENV = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
function wrangler(args) {
  const r = spawnSync(WRANGLER, args, { cwd: ROOT, env: WENV, encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error('wrangler ' + args.slice(0, 3).join(' ') + ' failed:\n' + r.stdout + r.stderr);
}

// A table stored before clocks had ids (the page has always given its own clocks one; a file restored from elsewhere,
// or a hand edit, may not): seeded straight into D1, since every write through the API now names them.
function idlessDoc() { const d = startDoc(); d.clocks.forEach((c) => { delete c.id; }); return d; }

async function startServer() {
  const busy = await fetch('http://127.0.0.1:' + PORT + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
  if (busy) throw new Error('port ' + PORT + ' is already in use: stop what is on it, or set PORT');
  wrangler(['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir]);
  // --file, not --command: the Windows shell (shell:true) would split a SQL/JSON argument at its spaces
  const seed = join(stateDir, 'seed.sql');
  writeFileSync(seed, "INSERT INTO campaigns (id, updated_at, doc) VALUES ('clocks', '2026-10-01T19:00:00.000Z', '" + JSON.stringify(idlessDoc()).replace(/'/g, "''") + "')");
  wrangler(['d1', 'execute', 'DB', '--local', '--persist-to', stateDir, '--file', seed]);
  let log = '';
  server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1',
    '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false', '--persist-to', stateDir, '--log-level', 'warn',
    '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'CAMPAIGN:clocks'], {
    cwd: ROOT, env: WENV, detached: true, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });
  const until = Date.now() + 90000;
  while (Date.now() < until) {
    if (server.exitCode !== null) throw new Error('server exited:\n' + log);
    try { const r = await fetch('http://127.0.0.1:' + PORT + '/index.html', { signal: AbortSignal.timeout(2000) }); if (r.status > 0) return; } catch (_) {}
    await sleep(500);
  }
  throw new Error('server did not start:\n' + log);
}

async function api(method, path, { user, body, raw } = {}) {
  const h = {};
  if (user) h['X-Dev-User'] = user;
  let payload;
  if (raw !== undefined) { payload = raw; h['Content-Type'] = 'application/json'; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch('http://127.0.0.1:' + PORT + path, { method, headers: h, body: payload });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, json, text };
}

async function step(name, fn) {
  try { await fn(); passes++; console.log('PASS ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e && e.message || e)); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
function expectStatus(r, status) { expect(r.status === status, 'expected ' + status + ', got ' + r.status + ' ' + r.text.slice(0, 300)); }
const eqJson = (a, b, msg) => expect(JSON.stringify(a) === JSON.stringify(b), msg + ': got ' + JSON.stringify(a) + ' want ' + JSON.stringify(b));

// ---------- the server's functions, in plain node ----------

async function libSteps() {
  await step('lib: ids as the page reads them: c_<i> for none, "_" for a repeat, non-objects dropped; the same array when all have one', () => {
    const had = [{ id: 'a' }, { id: 'b' }];
    expect(withClockIds(had) === had, 'unchanged array returned as is');
    const out = withClockIds([{ name: 'x' }, null, { id: 'a' }, { id: 'a' }, { id: 5 }, { id: '' }, { id: 'constructor' }, { id: '__proto__' }]);
    eqJson(out.map((c) => c.id), ['c_0', 'a', 'a_', '5', 'c_4', 'constructor', '__proto__'], 'ids');
  });
  await step('lib: applyClockOps: by id, in order; fill clamped to 0..size (a smaller size takes it down); add once; remove; an op for a missing clock does nothing', () => {
    const start = [{ id: 'a', name: 'A', size: 8, filled: 6, kind: 'danger', hidden: false }, { name: 'no id', size: 4, filled: 1 }];
    const ops = [{ id: 'c_1', filled: 9 }, { id: 'a', size: 4 }, { add: { id: 'n', name: 'N', size: 6, filled: 7 } }, { add: { id: 'n', name: 'again' } },
      { remove: 'gone' }, { id: 'gone', filled: 2 }, { id: 'a', filled: -3, name: 'A2', kind: 'project', hidden: true }];
    const out = applyClockOps(start, ops);
    eqJson(out, [{ id: 'a', name: 'A2', size: 4, filled: 0, kind: 'project', hidden: true }, { name: 'no id', size: 4, filled: 4, id: 'c_1' },
      { id: 'n', name: 'N', size: 6, filled: 6, kind: 'other', hidden: false }], 'result');
    eqJson(start[0].filled, 6, 'input untouched');
    eqJson(applyClockOps(out, ops), out, 'applied twice: the same clocks');
    eqJson(applyClockOps(out, [{ remove: 'n' }]).map((c) => c.id), ['a', 'c_1'], 'remove');
  });
  await step('lib: checkClockOps refuses malformed ops (400) and takes the page\'s', () => {
    checkClockOps([{ id: 'a', filled: 2 }, { id: 'a', name: 'x', size: 6, kind: 'faction', hidden: true }, { add: { id: 'c_1', name: '', size: 4, filled: 0, kind: 'danger', hidden: false } }, { remove: 'a' }]);
    const bad = [{}, 'x', [1], [{ id: 'a' }], [{ id: '', filled: 1 }], [{ id: 'a', filled: '1' }], [{ id: 'a', filled: null }], [{ id: 'a', size: 5 }], [{ id: 'a', kind: 'evil' }],
      [{ id: 'a', hidden: 1 }], [{ id: 'a', name: 3 }], [{ id: 'a', owner: 'me' }], [{ add: { id: 'bad id' } }], [{ add: {} }], [{ add: { id: 'n' }, id: 'n' }],
      [{ remove: 3 }], [{ remove: 'a', id: 'a' }], Array.from({ length: CLOCK_OPS_MAX + 1 }, () => ({ id: 'a', filled: 1 }))];
    for (const b of bad) {
      let err = null; try { checkClockOps(b); } catch (e) { err = e; }
      expect(err && err.status === 400 && /^clockOps: /.test(err.message), 'accepted ' + JSON.stringify(b).slice(0, 80));
    }
  });
  await step('lib: a player may fill through ops, nothing else; changedFills counts the fills a whole array changes', () => {
    const before = { clocks: withClockIds([{ id: 'a', name: 'A', size: 4, filled: 1 }, { size: 6, filled: 0 }]) };
    expect(playerMayWrite(before, { clocks: applyClockOps(before.clocks, [{ id: 'c_1', filled: 3 }, { id: 'a', filled: 0 }]) }, P1), 'fills');
    for (const op of [{ id: 'a', name: 'B' }, { id: 'a', size: 8 }, { id: 'a', hidden: true }, { id: 'a', kind: 'other' }, { remove: 'a' }, { add: { id: 'z' } }]) {
      expect(!playerMayWrite(before, { clocks: applyClockOps(before.clocks, [op]) }, P1), 'player may ' + JSON.stringify(op));
    }
    const arr = clone(before.clocks);
    expect(changedFills(before.clocks, arr) === 0, 'none');
    arr[0].filled = 2; expect(changedFills(before.clocks, arr) === 1, 'one');
    arr[1].filled = 9; expect(changedFills(before.clocks, arr) === 2, 'two');
    expect(changedFills([{ size: 4, filled: 1 }], [{ size: 4, filled: '1' }]) === 0, 'the same fill written another way is no change');
  });
}

// ---------- the API ----------

function startDoc() {
  return {
    v: 1, session: { number: 2, startedAt: '2026-10-01T19:00:00.000Z', endedAt: null },
    crew: { name: 'The Lamplighters', type: 'shadows', lair: '', notes: '', tier: 1, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] },
    clocks: [
      { id: 'c_a', name: 'Alarm', size: 4, filled: 1, kind: 'danger', hidden: false },
      { id: 'c_b', name: 'Fence', size: 6, filled: 0, kind: 'project', hidden: false },
      { id: 'c_c', name: 'Doomed', size: 8, filled: 2, kind: 'faction', hidden: true },
      { id: 'c_d', name: 'Heat', size: 6, filled: 3, kind: 'danger', hidden: false },
    ],
    log: [],
  };
}
const read = async (user = P1) => (await api('GET', '/api/campaign', { user })).json;
const ops = (user, list) => api('PATCH', '/api/campaign', { user, body: { clockOps: list, updatedAt: new Date().toISOString() } });
const byId = (doc) => Object.fromEntries(doc.clocks.map((c) => [c.id, c]));
const fillsOf = (doc) => Object.fromEntries(doc.clocks.map((c) => [c.id, c.filled]));
async function reset(doc = startDoc()) { const r = await api('PUT', '/api/campaign', { body: doc }); expectStatus(r, 200); return r.json; }

async function apiSteps() {
  let idless = null;
  await step('a table stored before clocks had ids reads as it is; an old page\'s whole array from it lands and names them c_0, c_1, … in place, as the page does', async () => {
    const g = await read();
    expect(g.doc.clocks.length === 4 && g.doc.clocks.every((c) => !('id' in c)), 'stored without ids: ' + JSON.stringify(g.doc.clocks));
    idless = clone(g.doc.clocks);                                      // what an old page and a new page both read
    const clocks = clone(idless); clocks[0].filled = 2;                // the old page ticks the first clock (its array has no ids)
    const r = await api('PATCH', '/api/campaign', { user: P1, body: { clocks, updatedAt: new Date().toISOString() } });
    expectStatus(r, 200);
    eqJson(r.json.doc.clocks.map((c) => [c.id, c.filled]), [['c_0', 2], ['c_1', 0], ['c_2', 2], ['c_3', 3]], 'named in place');
  });
  await step('a new page that read that table without ids ticks its second clock as c_1 (the page\'s own name for it): the op finds it', async () => {
    const r = await ops(P2, [{ id: 'c_1', filled: 4 }]);
    expectStatus(r, 200);
    eqJson(r.json.doc.clocks.map((c) => [c.id, c.name, c.filled]), [['c_0', 'Alarm', 2], ['c_1', 'Fence', 4], ['c_2', 'Doomed', 2], ['c_3', 'Heat', 3]], 'op by the page\'s id');
  });
  await step('an old page still on the copy without ids, two ticks behind, is refused (412): nothing undone', async () => {
    const clocks = clone(idless); clocks[3].filled = 4;
    const before = await read();
    const r = await api('PATCH', '/api/campaign', { user: P3, body: { clocks } });
    expectStatus(r, 412);
    const after = await read();
    expect(after.updatedAt === before.updatedAt, 'stored doc changed');
  });
  await step('a GM PUT of clocks without ids stores them named c_0, c_1, …', async () => {
    const r = await reset(idlessDoc());
    eqJson(r.doc.clocks.map((c) => c.id), ['c_0', 'c_1', 'c_2', 'c_3'], 'ids');
  });

  await step('the GM stores the table: four clocks with ids', async () => {
    const r = await reset();
    eqJson(r.doc.clocks.map((c) => c.id), ['c_a', 'c_b', 'c_c', 'c_d'], 'ids');
  });

  // (a)
  await step('(a) two players tick different clocks from the same copy, one after the other: both land', async () => {
    await reset();
    const copy = await read(P1);                                       // what P1's phone shows
    expectStatus(await ops(P2, [{ id: 'c_b', filled: 3 }]), 200);      // P2 ticks first, inside P1's poll interval
    const r = await ops(P1, [{ id: 'c_a', filled: copy.doc.clocks[0].filled + 1 }]);
    expectStatus(r, 200);
    eqJson(fillsOf(r.json.doc), { c_a: 2, c_b: 3, c_c: 2, c_d: 3 }, 'both ticks');
  });
  await step('(a) three players tick three clocks at the same moment, five times over: every tick lands', async () => {
    await reset();
    for (let round = 1; round <= 5; round++) {
      const rs = await Promise.all([ops(P1, [{ id: 'c_a', filled: round % 5 }]), ops(P2, [{ id: 'c_b', filled: round }]), ops(P3, [{ id: 'c_d', filled: 6 - round }])]);
      rs.forEach((r) => expectStatus(r, 200));
      eqJson(fillsOf((await read()).doc), { c_a: round % 5, c_b: round, c_c: 2, c_d: 6 - round }, 'round ' + round);
    }
  });

  // (b)
  await step('(b) a player ticks while the GM renames, resizes, re-kinds and hides another clock: both land', async () => {
    await reset();
    const [rp, rg] = await Promise.all([
      ops(P1, [{ id: 'c_a', filled: 3 }]),
      ops(GM, [{ id: 'c_b', name: 'Fence the paintings', size: 8, kind: 'faction', hidden: true }]),
    ]);
    expectStatus(rp, 200); expectStatus(rg, 200);
    const c = byId((await read(GM)).doc);
    eqJson([c.c_a.filled, c.c_b.name, c.c_b.size, c.c_b.kind, c.c_b.hidden, c.c_b.filled], [3, 'Fence the paintings', 8, 'faction', true, 0], 'both');
  });
  await step('(b) the GM shrinks a clock a player is ticking: the fill stays within the new size whichever lands first', async () => {
    await reset();
    const [rp, rg] = await Promise.all([ops(P2, [{ id: 'c_d', filled: 5 }]), ops(GM, [{ id: 'c_d', size: 4 }])]);
    expectStatus(rp, 200); expectStatus(rg, 200);
    const c = byId((await read()).doc).c_d;
    eqJson([c.size, c.filled], [4, 4], 'c_d');
  });

  // (c)
  await step('(c) the GM adds a clock and removes another while players tick two more: everything lands', async () => {
    await reset();
    const rs = await Promise.all([
      ops(GM, [{ add: { id: 'c_new', name: 'Bluecoats close in', size: 6, filled: 0, kind: 'danger', hidden: false } }, { remove: 'c_c' }]),
      ops(P1, [{ id: 'c_a', filled: 4 }]),
      ops(P2, [{ id: 'c_b', filled: 5 }]),
    ]);
    rs.forEach((r) => expectStatus(r, 200));
    const d = (await read(GM)).doc;
    eqJson(d.clocks.map((c) => [c.id, c.filled]), [['c_a', 4], ['c_b', 5], ['c_d', 3], ['c_new', 0]], 'clocks');
  });
  await step('(c) a tick of a clock the GM removed changes nothing and brings nothing back (200)', async () => {
    const before = (await read(GM)).doc;
    const r = await ops(P1, [{ id: 'c_c', filled: 7 }]);
    expectStatus(r, 200);
    eqJson(r.json.doc.clocks, before.clocks, 'clocks');
  });

  // (d)
  await step('(d) two ticks of the same clock: the later one wins on that clock, the others do not move', async () => {
    await reset();
    expectStatus(await ops(P1, [{ id: 'c_a', filled: 2 }]), 200);
    expectStatus(await ops(P2, [{ id: 'c_a', filled: 3 }]), 200);
    eqJson(fillsOf((await read()).doc), { c_a: 3, c_b: 0, c_c: 2, c_d: 3 }, 'the later tick');
    const [r1, r2] = await Promise.all([ops(P1, [{ id: 'c_b', filled: 1 }]), ops(P2, [{ id: 'c_b', filled: 2 }])]);
    expectStatus(r1, 200); expectStatus(r2, 200);
    const later = r1.json.updatedAt > r2.json.updatedAt ? 1 : 2;      // the one the server stored last
    eqJson(fillsOf((await read()).doc), { c_a: 3, c_b: later, c_c: 2, c_d: 3 }, 'at the same moment');
  });

  // the previous release
  await step('previous release: a player\'s whole array copied before another player\'s op is refused (412) and undoes nothing', async () => {
    await reset();
    const copy = (await read(P1)).doc;                                 // the old page's raw copy
    expectStatus(await ops(P2, [{ id: 'c_b', filled: 4 }]), 200);      // a new phone ticks c_b
    const clocks = clone(copy.clocks); clocks[0].filled = 2;           // the old page ticks c_a: its array still has c_b at 0
    const before = await read();
    const r = await api('PATCH', '/api/campaign', { user: P1, body: { clocks, updatedAt: new Date().toISOString() } });
    expectStatus(r, 412);
    expect(r.json.error === STALE_CLOCKS, r.text);
    const after = await read();
    expect(after.updatedAt === before.updatedAt, 'stored doc changed');
    eqJson(fillsOf(after.doc), { c_a: 1, c_b: 4, c_c: 2, c_d: 3 }, 'c_b kept');
  });
  await step('previous release: a current whole array lands between new ops, and the ops after it land on top', async () => {
    const copy = (await read(P1)).doc;                                 // the old page reloaded
    const clocks = clone(copy.clocks); clocks[0].filled = 2;
    expectStatus(await api('PATCH', '/api/campaign', { user: P1, body: { clocks, updatedAt: new Date().toISOString() } }), 200);
    expectStatus(await ops(P2, [{ id: 'c_d', filled: 5 }]), 200);
    const clocks2 = clone((await read(P1)).doc.clocks); clocks2[0].filled = 3;   // the old page ticks again from a fresh copy
    expectStatus(await api('PATCH', '/api/campaign', { user: P1, body: { clocks: clocks2 } }), 200);
    expectStatus(await ops(P2, [{ id: 'c_b', filled: 5 }]), 200);
    eqJson(fillsOf((await read()).doc), { c_a: 3, c_b: 5, c_c: 2, c_d: 5 }, 'every tick');
  });
  await step('previous release: a player still may only change `filled` through a whole array (rename, resize, add, remove: 403)', async () => {
    const d = (await read()).doc;
    const before = await read();
    for (const mk of [
      (cs) => { cs[0].name = 'Mine'; }, (cs) => { cs[1].size = 12; }, (cs) => { cs[2].hidden = false; },
      (cs) => { cs.push({ id: 'c_x', name: 'x', size: 4, filled: 0, kind: 'other', hidden: false }); }, (cs) => { cs.pop(); },
    ]) {
      const clocks = clone(d.clocks); mk(clocks); clocks[0].filled = 0;   // with a tick, as a page would send it
      const r = await api('PATCH', '/api/campaign', { user: P1, body: { clocks } });
      expectStatus(r, 403);
      expect(r.json.error === GM_ONLY, r.text);
    }
    expect((await read()).updatedAt === before.updatedAt, 'stored doc changed');
  });
  await step('previous release: the GM\'s whole array still replaces the clocks (a rename from the GM\'s copy)', async () => {
    const d = (await read(GM)).doc;
    const clocks = clone(d.clocks); clocks[3].name = 'Heat (GM)';
    const r = await api('PATCH', '/api/campaign', { body: { clocks } });
    expectStatus(r, 200);
    expect(r.json.doc.clocks[3].name === 'Heat (GM)', JSON.stringify(r.json.doc.clocks));
  });
  // the player rule and the shape
  await step('a player\'s ops may only fill: rename, resize, re-kind, hide, add or remove is 403 and stores nothing', async () => {
    await reset();
    const before = await read();
    for (const op of [{ id: 'c_a', name: 'Mine' }, { id: 'c_a', size: 8 }, { id: 'c_a', kind: 'project' }, { id: 'c_c', hidden: false },
      { add: { id: 'c_x', name: 'x', size: 4, filled: 0, kind: 'other', hidden: false } }, { remove: 'c_a' }]) {
      const r = await ops(P1, [{ id: 'c_b', filled: 2 }, op]);
      expectStatus(r, 403);
      expect(r.json.error === GM_ONLY, r.text);
    }
    expect((await read()).updatedAt === before.updatedAt, 'stored doc changed');
  });
  await step('a player may fill a hidden clock (hidden is how the page shows it, not a lock), and a fill is kept within 0..size', async () => {
    const r = await ops(P1, [{ id: 'c_c', filled: 99 }, { id: 'c_a', filled: -4 }]);
    expectStatus(r, 200);
    const c = byId(r.json.doc);
    eqJson([c.c_c.filled, c.c_a.filled], [8, 0], 'clamped');
  });
  await step('malformed clockOps are 400 and store nothing; clockOps in a PUT is 400', async () => {
    const before = await read();
    for (const body of [{ clockOps: 'c_a' }, { clockOps: [{ id: 'c_a' }] }, { clockOps: [{ id: 'c_a', filled: 'two' }] }, { clockOps: [{ id: 'c_a', size: 7 }] },
      { clockOps: [{ add: { id: 'no spaces allowed' } }] }, { clockOps: [{ remove: 'c_a', filled: 1 }] }, { clockOps: [{ id: 'c_a', owner: P1 }] }]) {
      const r = await api('PATCH', '/api/campaign', { user: GM, body });
      expectStatus(r, 400);
      expect(/^clockOps: /.test(r.json.error), r.text);
    }
    const p = await api('PUT', '/api/campaign', { body: { ...startDoc(), clockOps: [{ id: 'c_a', filled: 1 }] } });
    expectStatus(p, 400);
    expect((await read()).updatedAt === before.updatedAt, 'stored doc changed');
  });
  await step('an op sent twice (the offline queue may resend one) changes nothing the second time', async () => {
    const list = [{ id: 'c_d', filled: 1 }, { remove: 'c_b' }, { add: { id: 'c_z', name: 'Z', size: 4, filled: 1, kind: 'other', hidden: false } }];
    const r1 = await ops(GM, list);
    const r2 = await ops(GM, list);
    expectStatus(r1, 200); expectStatus(r2, 200);
    eqJson(r2.json.doc.clocks, r1.json.doc.clocks, 'clocks');
  });
}

const timer = setTimeout(async () => {
  console.log('FAIL overall timeout after ' + OVERALL_TIMEOUT_MS + ' ms');
  await stopServer();
  process.exit(1);
}, OVERALL_TIMEOUT_MS);

try {
  await libSteps();
  await startServer();
  console.log('server up on ' + PORT);
  await apiSteps();
} catch (e) {
  failures++;
  console.log('FAIL setup\n     ' + (e && e.message || e));
}
clearTimeout(timer);
console.log('\n' + passes + ' passed, ' + failures + ' failed');
await stopServer();
process.exit(failures ? 1 : 0);
