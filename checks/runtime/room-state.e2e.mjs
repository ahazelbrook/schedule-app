// room-state (RK08.4, room.key): the stored room-state contract on a real local Worker and browser, then the rollback proof. The demo night
// (invented data: the Pelican Rooms; GM-ONLY- markers) runs on PORT with a state folder this check owns.
//   1. With room.key off the GM page asks for no room-key file, has no room-state API and sends no roomstate.
//   2. room.key on (the Settings row): writes through the page's own GM-state write (B68GmPage._roomState()): a mark, a swap, an extra, a say,
//      the Blade entry, a kept id, two quick marks in a row, a cleared room written again; the server holds exactly that, one rollKey a patch.
//   3. A reload reads it all back. No player, phone or display GET carries it (a player gets 403 on the GM state).
//   4. room.key off again: every write is false and no PATCH carries roomstate; a fresh page has no API, and the key is still stored.
//   5. Rollback: the code of Deploy 41 (1ad1ba3), taken from git into a temp folder, runs on PORT + 2 against the SAME state. Its GM page loads
//      the state holding roomstate, saves something else (a Settings row, through its own write), and roomstate is still there, unchanged.
// No model, no network beyond loopback, nothing deployed. Wrangler's inspector is PORT + 20000 (and PORT + 20002).
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9505] [ROLLBACK_REF=1ad1ba3] node checks/runtime/room-state.e2e.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!process.env.PW_MODULE) { console.log('SKIP room-state: PW_MODULE is not set (the demo night needs Playwright)'); process.exit(0); }
const require = createRequire(import.meta.url);
const pw = require(process.env.PW_MODULE);
const PORT = Number(process.env.PORT || 9505), OLD_PORT = PORT + 2, REF = process.env.ROLLBACK_REF || '1ad1ba3';
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test', P1 = 'player1@example.test';
const WIN = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, name) => { if (ok) console.log('PASS ' + name); else { failed++; console.log('FAIL ' + name); } };
const same = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(v) { return Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.keys(v).sort().reduce((o, k) => (o[k] = sortKeys(v[k]), o), {}) : v; }
function noKey() { const e = { ...process.env }; delete e.B68_ANTHROPIC_KEY; delete e.ANTHROPIC_API_KEY; return e; }

/* the demo night from a tree (this one, or the old one) on a port, with a state folder kept between the two */
async function boot(root, port, state) {
  const base = 'http://127.0.0.1:' + port;
  if (await fetch(base + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) throw new Error('port ' + port + ' is already in use');
  const child = spawn(process.execPath, [path.join(root, 'scripts', 'demo-night.mjs'), '--port', String(port), '--state', state], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: noKey() });
  let log = ''; child.stdout.on('data', (d) => { log += d; }); child.stderr.on('data', (d) => { log += d; });
  const stop = async () => { if (child.pid) { if (WIN) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { child.kill('SIGKILL'); } catch (e) { /* gone */ } } } await sleep(1500); };
  for (let i = 0; i < 300 && !/Ctrl\+C stops it/.test(log); i++) { await sleep(500); if (child.exitCode !== null) break; }
  if (!/Ctrl\+C stops it/.test(log)) { await stop(); throw new Error('the demo night did not come up on ' + port + ':\n' + log.slice(-1500)); }
  return { base, stop, log: () => log };
}
const api = (base, method, p, body, user = GM) => fetch(base + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) { /* not JSON */ } return { status: r.status, json: j, text: t }; });
const stored = async (base) => { const r = await api(base, 'GET', '/api/gm/state'); return r.json && r.json.doc ? r.json.doc : {}; };
async function until(fn, ms, what) { const end = Date.now() + ms; for (;;) { const v = await fn(); if (v) return v; if (Date.now() > end) throw new Error('timed out: ' + what); await sleep(400); } }

/* a commit's tree, written out by one `git cat-file --batch` (no tar, no worktree), with node_modules a junction to this tree's */
function extract(rev, dest) {
  const ls = spawnSync('git', ['ls-tree', '-r', '-z', rev], { cwd: ROOT, maxBuffer: 1 << 26 });
  if (ls.status !== 0) return false;
  const files = ls.stdout.toString('utf8').split('\0').filter(Boolean).map((l) => { const t = l.indexOf('\t'), [mode, type, sha] = l.slice(0, t).split(' '); return { mode, type, sha, p: l.slice(t + 1) }; })
    .filter((e) => e.type === 'blob' && e.mode !== '120000');
  const cat = spawnSync('git', ['cat-file', '--batch'], { cwd: ROOT, input: files.map((e) => e.sha).join('\n') + '\n', maxBuffer: 1 << 29 });
  if (cat.status !== 0) return false;
  const buf = cat.stdout; let at = 0;
  for (const e of files) {
    const nl = buf.indexOf(10, at), head = buf.slice(at, nl).toString('utf8').split(' '), size = Number(head[2]);
    if (head[0] !== e.sha) throw new Error('git cat-file out of step at ' + e.p);
    const f = path.join(dest, ...e.p.split('/')); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf.slice(nl + 1, nl + 1 + size));
    at = nl + 1 + size + 1;
  }
  fs.symlinkSync(fs.realpathSync(path.join(ROOT, 'node_modules')), path.join(dest, 'node_modules'), 'junction');
  return files.length;
}
function removeTree(dir) {
  if (!dir) return;
  try { fs.unlinkSync(path.join(dir, 'node_modules')); } catch (e) { /* no junction */ }      /* the junction first, so nothing behind it is touched */
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* a lingering handle */ }
}

const STATE = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-rk08-state-'));
let OLD = '', demo = null, browser = null;
try {
  demo = await boot(ROOT, PORT, STATE);
  browser = await pw.chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
  async function gmPage(base) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, extraHTTPHeaders: { 'X-Dev-User': GM } });
    const page = await ctx.newPage(), urls = [], patches = [], errors = [];
    page.on('request', (r) => { urls.push(r.url()); if (r.method() === 'PATCH' && /\/api\/gm\/state/.test(r.url())) patches.push(r.postData() || ''); });
    page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
    await page.goto(base + '/#gm');
    await page.waitForFunction(() => window.B68GmPage && window.B68GmPage._state && window.B68GmPage._state() && window.B68GmPage._state().status === 'ready', null, { timeout: 60000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
    return { ctx, page, urls, patches, errors };
  }
  async function setting(G, id, on) {
    const row = '#gm-ipad-settings [data-set="' + id + '"][data-v="' + (on ? 1 : 0) + '"]';
    if (!(await G.page.isVisible(row))) { await G.page.click('.gm-tray [data-tray="open"]'); await G.page.waitForSelector(row, { state: 'visible', timeout: 10000 }); }
    await G.page.click(row);
    await until(async () => { const d = await stored(demo.base); return !!(d.features && d.features[id] === on); }, 15000, id + ' stored ' + on);
  }
  const roomKeyFiles = (urls) => urls.filter((u) => /\/gm\/room-(things|state)\.js/.test(u));

  /* 1. off */
  const G = await gmPage(demo.base);
  await G.page.waitForTimeout(2500);
  check(roomKeyFiles(G.urls).length === 0, 'off: the GM page asks for no room-key file');
  check(await G.page.evaluate(() => window.B68GmPage._roomState() === null && !window.B68GmRoomState), 'off: no room-state API on the page');
  const d0 = await stored(demo.base);
  check(!('roomstate' in d0), 'off: the demo night\'s GM state holds no roomstate');

  /* 2. on, and writes through the page */
  await setting(G, 'room.key', true);
  await G.page.waitForFunction(() => !!window.B68GmPage._roomState(), null, { timeout: 20000 });
  check(roomKeyFiles(G.urls).length === 2, 'room.key on: room-things.js and room-state.js come in with the room-key bundle');
  const off0 = G.patches.length;
  const ctx = await G.page.evaluate(() => {
    const P = window.B68GmPage, st = P._state(), roll = st.locRoll, card = st.doc.cards && st.doc.cards.location;
    const rk = roll ? P._pure.rollKey(roll) : P._pure.locKey(card);
    const names = roll && Array.isArray(roll.rooms) ? roll.rooms.map((r) => r.name) : ['Showroom', 'Cocktail lounge'];
    return { rk: String(rk), names, keys: window.B68GmRoomState.roomKeys(names) };
  });
  check(!!ctx.rk && ctx.keys.length >= 2 && ctx.keys.every((k) => /#\d+$/.test(k)), 'the site\'s rollKey (' + ctx.rk + ') and roomKeys: ' + ctx.keys.slice(0, 3).join(', '));
  const [R1, R2] = ctx.keys;
  const wrote = await G.page.evaluate(({ rk, R1, R2 }) => {
    const rs = window.B68GmPage._roomState(), out = [];
    out.push(rs.setMark(rk, R1, 'brass-umbrella-stand', 'empty'));
    out.push(rs.setSwap(rk, R1, 'velvet-rope', 'grand-piano'));
    out.push(rs.addExtra(rk, R1, 'stage-curtain'));
    out.push(rs.setSay(rk, R1, 1));
    out.push(rs.addKept(rk, R1, 'npc_mabel_quist_rk08'));
    out.push(rs.setBlade(rk, R2, { say: 'GM-ONLY-blade: the lights dip twice.', things: [{ name: 'A tin whistle', look: 'GM-ONLY-look: a name scratched on it', tags: ['clue'] }], people: ['GM-ONLY-blade-line'] }));
    out.push(rs.setMark(rk, R2, 'a', 'on')); out.push(rs.setMark(rk, R2, 'b', 'off'));           /* two quick writes in a row */
    out.push(rs.setMark(rk, 'pelican cloakroom#1', 'coat', 'taken')); out.push(rs.clear(rk, 'pelican cloakroom#1')); out.push(rs.setMark(rk, 'pelican cloakroom#1', 'hat', 'taken'));
    return out;
  }, { rk: ctx.rk, R1, R2 });
  check(wrote.every((x) => x === true), 'every write is true: ' + wrote.join(' '));
  const want = { [R1]: { marks: { 'brass-umbrella-stand': 'empty' }, swaps: { 'velvet-rope': 'grand-piano' }, extra: ['stage-curtain'], say: 1, kept: ['npc_mabel_quist_rk08'] },
    'pelican cloakroom#1': { marks: { hat: 'taken' } } };
  const d1 = await until(async () => { const d = await stored(demo.base); const k = d.roomstate && d.roomstate.keys && d.roomstate.keys[ctx.rk]; return k && k.rooms[R2] && k.rooms[R2].marks && k.rooms[R2].marks.b && k.rooms['pelican cloakroom#1'] && !k.rooms['pelican cloakroom#1'].marks.coat ? d : null; }, 20000, 'the writes saved');
  const k1 = d1.roomstate.keys[ctx.rk];
  check(d1.roomstate.v === 1 && /Z$/.test(d1.roomstate.at) && /Z$/.test(k1.at) && typeof k1.part === 'string', 'the server holds roomstate { v: 1, at, keys: { <rollKey>: { part, at, rooms } } }');
  const r1 = k1.rooms[R1] || {}, atMap = (m, keys) => !!m && Object.keys(m).join() === keys.join() && Object.values(m).every((v) => /^\d{4}-\d\d-\d\dT.*Z$/.test(v));
  check(same({ marks: r1.marks, swaps: r1.swaps, say: r1.say }, { marks: want[R1].marks, swaps: want[R1].swaps, say: want[R1].say }) && atMap(r1.extra, want[R1].extra) && atMap(r1.kept, want[R1].kept)
    && Object.keys(r1).sort().join() === 'extra,kept,marks,say,swaps', 'the first room: mark, swap, say, and extra and kept id as { <key>: <at> } maps, as written');
  check(same(k1.rooms['pelican cloakroom#1'], want['pelican cloakroom#1']), 'a room cleared and written again before the save holds only the new mark');
  check(same(k1.rooms[R2].marks, { a: 'on', b: 'off' }) && k1.rooms[R2].blade.say === 'GM-ONLY-blade: the lights dip twice.' && !('slug' in k1.rooms[R2].blade.things[0]), 'two quick marks both landed, beside the Blade entry');
  const mine = G.patches.slice(off0).map((b) => { try { return JSON.parse(b); } catch (e) { return {}; } }).filter((p) => p.roomstate);
  check(mine.length >= 1 && mine.every((p) => Object.values(p.roomstate.keys || {}).filter((v) => v !== null).length === 1), 'each PATCH carrying roomstate writes one rollKey (' + mine.length + ' PATCHes)');
  check(G.errors.length === 0, 'no page errors: ' + G.errors.slice(0, 2).join(' | '));

  /* 3. a reload reads it back; nothing reaches a player, a phone or the display */
  await G.page.reload();
  await G.page.waitForFunction(() => window.B68GmPage._state() && window.B68GmPage._state().status === 'ready' && !!window.B68GmPage._roomState(), null, { timeout: 60000 });
  const back = await G.page.evaluate(({ rk, R1, R2 }) => { const rs = window.B68GmPage._roomState(); return { r1: rs.read(rk, R1), r2: rs.read(rk, R2), roll: Object.keys(rs.roll(rk).rooms).sort() }; }, { rk: ctx.rk, R1, R2 });
  check(same(back.r1, { say: 1, extra: ['stage-curtain'], swaps: { 'velvet-rope': 'grand-piano' }, marks: { 'brass-umbrella-stand': 'empty' }, blade: null, kept: ['npc_mabel_quist_rk08'] }), 'after a reload the first room reads back as written');
  check(back.r2.blade && back.r2.blade.things[0].slug === 'tin-whistle' && same(back.r2.marks, { a: 'on', b: 'off' }), 'and the second, its Blade thing with its slug');
  const leaks = [];
  for (const [user, p] of [[P1, '/api/campaign'], [P1, '/api/table/screen'], [P1, '/api/characters'], [P1, '/api/npcs'], [IPAD, '/api/gm/display'], [IPAD, '/api/gm/ambient'], [IPAD, '/api/table/screen']]) {
    const r = await api(demo.base, 'GET', p, undefined, user);
    if (/GM-ONLY-blade|roomstate|brass-umbrella-stand|tin-whistle/.test(r.text)) leaks.push(user + ' ' + p);
  }
  check(leaks.length === 0, 'no player, phone or display GET carries roomstate or its text: ' + (leaks.join(', ') || 'none'));
  check((await api(demo.base, 'GET', '/api/gm/state', undefined, P1)).status === 403, 'a player gets 403 on the GM state');

  /* 4. off again */
  await setting(G, 'room.key', false);
  const off1 = G.patches.length;
  const offW = await G.page.evaluate(({ rk, R1 }) => { const rs = window.B68GmPage._roomState(); return [rs.setMark(rk, R1, 'x', 'on'), rs.clear(rk, R1), rs.setBlade(rk, R1, { say: 'no' }), rs.prune('other', () => [])]; }, { rk: ctx.rk, R1 });
  await G.page.waitForTimeout(2500);
  check(offW.slice(0, 3).every((x) => x === false) && offW[3].rolls === 0, 'room.key off: every write is false, prune does nothing');
  check(G.patches.slice(off1).every((b) => !/roomstate/.test(b)), 'room.key off: no PATCH carries roomstate (' + (G.patches.length - off1) + ' PATCHes after)');
  const G2 = await gmPage(demo.base);
  await G2.page.waitForTimeout(2500);
  check(roomKeyFiles(G2.urls).length === 0 && await G2.page.evaluate(() => window.B68GmPage._roomState() === null), 'a fresh page with room.key off has no room-state API and asks for no room-key file');
  const d2 = await stored(demo.base);
  check(same(d2.roomstate, d1.roomstate), 'off leaves the stored roomstate exactly as it was');
  await G2.ctx.close(); await G.ctx.close();
  await demo.stop(); demo = null;

  /* 5. rollback: Deploy 41's own tree on the same state */
  OLD = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-rk08-old-'));
  let n = 0; try { n = extract(REF, OLD); } catch (e) { console.log('  extract: ' + e.message); }
  if (!n) console.log('SKIP the rollback proof: git cannot write out ' + REF);
  else {
    console.log('  ' + REF + ': ' + n + ' files written out to a temp folder');
    demo = await boot(OLD, OLD_PORT, STATE);
    const O = await gmPage(demo.base);
    const held = await O.page.evaluate(() => window.B68GmPage._state().doc.roomstate || null);
    check(same(held, d2.roomstate), REF + ': the old GM page loads the state holding roomstate');
    check((await O.page.evaluate(() => typeof window.B68GmPage._roomState)) === 'undefined', REF + ': and is the old code (no room-state hook)');
    const before = (await stored(demo.base)).features || {};
    await setting(O, 'map.shade', !(before['map.shade'] === true));
    const d3 = await stored(demo.base);
    check(d3.features['map.shade'] === !(before['map.shade'] === true), REF + ': it saved something else (Furniture depth, through its own write)');
    check(same(d3.roomstate, d2.roomstate), REF + ': roomstate survived the old page\'s load and save, unchanged');
    check(O.patches.length >= 1 && O.patches.every((b) => !/roomstate/.test(b)), REF + ': the old page never sent roomstate (' + O.patches.length + ' PATCHes)');
    check(O.errors.length === 0, REF + ': no page errors on the old page: ' + O.errors.slice(0, 2).join(' | '));
    await O.ctx.close();
  }
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (demo) await demo.stop();
  removeTree(OLD);
  try { fs.rmSync(STATE, { recursive: true, force: true }); } catch (e) { /* a lingering handle */ }
}
console.log(failed ? failed + ' FAILED' : 'ALL PASSED');
process.exit(failed ? 1 : 0);
