// Live sync on the client side, in real browsers against a real local Worker (ticket MD2; design 2.5; GM.md "Live sync"): the phones' and the GM page's data poll
// (app/runtime/cf.js), the table display's poll (app/display-page.js) and the GM page's switch. Every name is invented.
//   shown: a write on one page reaches another within 1.5 s (p50/p95 reported); a healthy socket slows the data poll to 15 s; a socket that is killed falls back to the 4 s
//   poll with nothing lost and comes back; a socket that gets pongs but no pokes falls back to 4 s within one poll; the switch closes every socket and none reconnects while it is
//   off; a page's socket hears only its role's kinds; the iPad's 4 s poll never changes.
//   PW_MODULE=<path to playwright-core> [PW_CHANNEL=msedge] [PORT=8960] node checks/runtime/live-clients.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8960);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const P = (n) => 'player' + n + '@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-liveclients-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'DISPLAY_EMAILS:' + IPAD], { cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: 'ignore' });
function killServer() {
  if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} }
}
process.on('exit', () => { killServer(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j }; });
const pct = (l, p) => { const s = [...l].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)] : NaN; };

let browser = null;
try {
  const up = await until(async () => { try { return (await fetch(BASE + '/index.html')).status > 0; } catch (_) { return false; } }, 90000, 500);
  if (!up) throw new Error('the server did not start');
  browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  const ctxOf = (user) => browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, viewport: { width: 1180, height: 820 }, serviceWorkers: 'block' });

  // one record per page: its sockets, and when it asked for the data poll and the display
  const pages = [];
  async function openPage(user, name, { hash = '', route = null } = {}) {
    const ctx = await ctxOf(user);
    const page = await ctx.newPage();
    const rec = { name, user, page, ctx, sockets: [], chars: [], disp: [], dead: false, serverWs: null, route: null };
    page.on('websocket', (w) => { rec.sockets.push({ url: w.url(), at: Date.now() }); });
    page.on('request', (r) => {
      const u = new URL(r.url());
      if (u.pathname === '/api/characters' && r.method() === 'GET') rec.chars.push(Date.now());
      if (u.pathname === '/api/gm/display' && r.method() === 'GET') rec.disp.push(Date.now());
    });
    page.on('pageerror', (e) => errors.push(name + ': ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(name + ' console: ' + m.text()); });
    if (route) await route(page, rec);
    await page.goto(BASE + '/' + hash);
    await page.waitForFunction(() => window.B68Runtime && window.B68Runtime.me && window.B68Live, null, { timeout: 30000 });
    if (!hash) {
      await page.evaluate(async () => {
        const db = await window.claude.use('db');
        window.__seen = {};
        window.__un = db.collection('characters').onSnapshot((s) => { s.docs.forEach((d) => { if (!(d.id in window.__seen)) window.__seen[d.id] = Date.now(); }); });
      });
    }
    pages.push(rec);
    return rec;
  }
  const st = (r) => r.page.evaluate(() => window.B68Live.state());
  const open = async (r, ms = 15000) => !!(await until(async () => (await st(r)).open, ms, 100));
  const writeChar = (r, id) => r.page.evaluate(async (cid) => {
    const db = await window.claude.use('db'); const t = Date.now();
    await db.collection('characters').doc(cid).set({ v: 2, name: cid, playbook: 'hound', spec: { id: cid }, sheet: { name: cid }, play: { stress: 0, harm: { l1: '' } } });
    return t;
  }, id);
  const seenAt = (r, id, ms = 8000) => until(async () => r.page.evaluate((cid) => window.__seen[cid] || 0, id), ms, 20);
  const wsCount = (r) => r.sockets.length;

  // ---------- the pages ----------
  // a role-true header on the socket is checked below (a player hears no cue poke)
  const A = await openPage(P(1), 'A');
  const B = await openPage(P(2), 'B');
  const G = await openPage(GM, 'GM');
  const D = await openPage(IPAD, 'iPad');
  check((await Promise.all([A, B, G, D].map((r) => open(r)))).every(Boolean), 'live: every page opened its socket once its poll said live: true (phones, GM, iPad)');
  check([A, B, G, D].every((r) => wsCount(r) === 1 && /\/api\/live$/.test(r.sockets[0].url)), 'live: one socket per page, same origin /api/live');
  await sleep(1500);

  // ---------- 1. a write on one page is polled by the other within 1.5 s ----------
  const lat = [];
  for (let i = 0; i < 20; i++) {
    const id = 'lat' + i;
    const t0 = await writeChar(A, id);
    const at = await seenAt(B, id, 6000);
    lat.push(at ? at - t0 : 99999);
    await sleep(300);
  }
  const p50 = pct(lat, 0.5), p95 = pct(lat, 0.95);
  console.log('LATENCY write on A -> seen on B (ms), n=' + lat.length + ': p50=' + p50 + ' p95=' + p95 + ' max=' + Math.max(...lat) + ' all=' + lat.join(','));
  check(p95 <= 1500 && Math.max(...lat) < 3000, 'a write on one page reaches the other within 1.5 s (p50 ' + p50 + ' ms, p95 ' + p95 + ' ms)');
  check((await st(B)).healthy && (await st(A)).healthy, 'both sockets stayed healthy through twenty announced writes');

  // ---------- 2. roles: a socket hears only its role's kinds ----------
  await G.page.evaluate(() => { window.__cue = []; window.B68Live.on(['cue'], (k) => { if (k === 'cue') window.__cue.push(Date.now()); }); });
  await A.page.evaluate(() => { window.__cue = []; window.B68Live.on(['cue'], (k) => { if (k === 'cue') window.__cue.push(Date.now()); }); });
  await D.page.evaluate(() => { window.__cue = []; window.B68Live.on(['cue'], (k) => { if (k === 'cue') window.__cue.push(Date.now()); }); });
  const tr = await api('POST', '/gm/transcript', { lines: [{ id: 'live-cue-1', at: new Date().toISOString(), session: '1', conn: 'c1', speaker: 0, kind: 'line', text: 'Blade, an invented line', cue: true }] });
  check(tr.status === 200, 'a cued transcript line is accepted (' + tr.status + ')');
  await sleep(1200);
  const heard = await Promise.all([G, A, D].map((r) => r.page.evaluate(() => window.__cue.length)));
  check(heard[0] === 1 && heard[1] === 0 && heard[2] === 0, 'the cue poke reaches the GM page only (GM ' + heard[0] + ', player ' + heard[1] + ', iPad ' + heard[2] + ')');

  // ---------- 3. the iPad: its 4 s poll never changes, and a display write reaches it fast ----------
  const gaps = (r, from) => r.disp.filter((t) => t >= from).map((t, i, a) => (i ? t - a[i - 1] : null)).filter((x) => x !== null);
  const t1 = Date.now(); await sleep(14000);
  const ig = gaps(D, t1);
  console.log('IPAD display poll gaps over 14 s idle (ms): ' + ig.join(','));
  check(ig.length >= 2 && ig.every((g) => g >= 3200 && g <= 4900), 'the iPad polls every 4 s with a healthy socket (gaps ' + ig.join(',') + ')');
  const TXT = 'Invented lamplight text';
  const tp = Date.now();
  await api('PUT', '/gm/display', { kind: 'text', title: 'Tonight', text: TXT });
  const shown = await until(() => D.page.evaluate((t) => !!(document.getElementById('display-page') && document.getElementById('display-page').innerText.includes(t)), TXT), 6000, 20);
  const dms = Date.now() - tp;
  console.log('IPAD display write -> shown on the iPad: ' + dms + ' ms');
  check(!!shown && dms < 1500, 'a display write shows on the iPad within 1.5 s (' + dms + ' ms)');
  const t2 = Date.now(); await sleep(10000);
  const ig2 = gaps(D, t2);
  check(ig2.length >= 1 && ig2.every((g) => g >= 3200 && g <= 4900), 'and after a poke the beat is still 4 s (gaps ' + ig2.join(',') + ')');

  // ---------- 4. a healthy socket slows the data poll to 15 s ----------
  const FAST = !!process.env.FAST;
  const t3 = Date.now(); if (!FAST) await sleep(36000);
  const hp = A.chars.filter((t) => t >= t3);
  const hgaps = hp.map((t, i) => (i ? t - hp[i - 1] : null)).filter((x) => x !== null);
  console.log('PHONE data poll over 36 s idle: ' + hp.length + ' polls, gaps ' + hgaps.join(','));
  if (!FAST) check(hp.length >= 1 && hp.length <= 4 && hgaps.every((g) => g >= 13000), 'a healthy socket slows the phone\'s data poll to 15 s (' + hp.length + ' polls in 36 s; 4 s would be 9)');

  // ---------- 5. a socket that gets pongs but no pokes falls back to 4 s within one poll ----------
  const S = await openPage(P(3), 'silent', { route: async (page, rec) => {
    await page.routeWebSocket(/\/api\/live/, (ws) => {
      const srv = ws.connectToServer();
      srv.onMessage((m) => { if (typeof m === 'string' && /^\{"k"/.test(m)) return; ws.send(m); });   // pongs and hello pass; pokes are swallowed
      ws.onMessage((m) => srv.send(m));
      srv.onClose((code, reason) => ws.close({ code, reason })); ws.onClose((code, reason) => srv.close({ code, reason }));
    });
  } });
  check(await open(S), 'silent: the socket opens (hello and pongs get through)');
  await sleep(2500);
  const quietPolls = S.chars.length;
  let s0 = await st(S);
  check(s0.healthy, 'silent: healthy at first (nothing has changed yet)');
  const tw = Date.now();
  await writeChar(A, 'silent1');
  const went = await until(async () => !(await st(S)).healthy, 15000 + 2000 + 3000, 100);
  const tTrip = Date.now() - tw;
  if (!went) console.log('DEBUG silent state ' + JSON.stringify(await st(S)) + ' polls at ' + S.chars.map((t) => t - tw).join(','));
  check(!!went, 'silent: a poll that brought back a change no poke announced marks the socket unhealthy (' + tTrip + ' ms after the write; one 15 s poll + 2 s)');
  check(!!(await S.page.evaluate(() => window.__seen['silent1'])), 'silent: and the change itself was delivered by the poll');
  const t4 = Date.now(); await sleep(10500);
  const sp = S.chars.filter((t) => t >= t4); const sg = sp.map((t, i) => (i ? t - sp[i - 1] : null)).filter((x) => x !== null);
  console.log('SILENT data poll after the trip: ' + sp.length + ' polls in 10.5 s, gaps ' + sg.join(','));
  check(sp.length >= 2 && sg.every((g) => g <= 4900), 'silent: the poll is back on the 4 s beat (gaps ' + sg.join(',') + ')');

  // ---------- 6. a killed socket falls back to 4 s with nothing lost, and the page comes back ----------
  const K = await openPage(P(4), 'killed', { route: async (page, rec) => {
    await page.routeWebSocket(/\/api\/live/, (ws) => {
      rec.route = ws;
      if (rec.dead) return;                                                // a dead network: the page's socket opens and nothing ever comes back
      const srv = ws.connectToServer();
      srv.onMessage((m) => ws.send(m)); ws.onMessage((m) => srv.send(m));
      srv.onClose((code, reason) => ws.close({ code, reason })); ws.onClose((code, reason) => srv.close({ code, reason }));
    });
  } });
  check(await open(K), 'killed: the socket opens');
  await sleep(2000);
  check((await st(K)).healthy, 'killed: healthy');
  K.dead = true;
  await K.route.close({ code: 1011, reason: 'killed by the test' });
  await sleep(300);
  const ks = await st(K);
  check(!ks.open && !ks.healthy, 'killed: the page sees the socket gone and is not healthy');
  const kLat = [];
  for (const id of ['k1', 'k2', 'k3']) {
    const t0 = await writeChar(A, id);
    const at = await seenAt(K, id, 9000);
    kLat.push(at ? at - t0 : 99999);
    await sleep(500);
  }
  console.log('KILLED socket: write on A -> seen on K (ms): ' + kLat.join(','));
  check(kLat.every((x) => x < 5500), 'killed: nothing lost, every write arrived within a 4 s poll (' + kLat.join(', ') + ' ms)');
  const kp = K.chars.filter((t) => t >= Date.now() - 9000); const kg = kp.map((t, i) => (i ? t - kp[i - 1] : null)).filter((x) => x !== null);
  check(kg.length >= 1 && kg.every((g) => g <= 4900), 'killed: the poll is on the 4 s beat while it is down (gaps ' + kg.join(',') + ')');
  K.dead = false;                                                          // the network is back
  const back = await open(K, 40000);
  check(back, 'killed: the page reconnects on its own once the network is back (' + wsCount(K) + ' sockets made)');
  const afterBack = await writeChar(A, 'k4'); const kAt = await seenAt(K, 'k4', 4000);
  check(!!kAt && kAt - afterBack < 1500, 'killed: and a write is polled within 1.5 s again (' + (kAt ? kAt - afterBack : 'never') + ' ms)');

  // ---------- 7. the switch closes every socket, none comes back while it is off, and the iPad's beat holds ----------
  const before = pages.map((r) => wsCount(r));
  const toff = Date.now();
  const off = await api('PATCH', '/gm/state', { live: false });
  check(off.status === 200, 'the switch: PATCH /api/gm/state { live: false } is accepted');
  const allClosed = await until(async () => (await Promise.all(pages.map(st))).every((s) => !s.open), 17000, 100);
  check(!!allClosed, 'the switch: every socket is closed within one poll (' + (Date.now() - toff) + ' ms)');
  await sleep(20000);
  const mid = pages.map((r) => wsCount(r));
  check(mid.every((n, i) => n === before[i]), 'the switch: no page reconnected while it was off (sockets made ' + before.join(',') + ' -> ' + mid.join(',') + ')');
  check((await Promise.all(pages.map(st))).every((s) => !s.open && !s.healthy), 'the switch: nobody is open or healthy');
  const ap = A.chars.filter((t) => t >= toff + 3000); const ag = ap.map((t, i) => (i ? t - ap[i - 1] : null)).filter((x) => x !== null);
  check(ag.length >= 1 && ag.every((g) => g <= 4900), 'the switch: the phone polls on the 4 s beat (gaps ' + ag.join(',') + ')');
  const dgs = gaps(D, toff);
  check(dgs.every((g) => g >= 3200 && g <= 4900), 'the switch: the iPad\'s beat is 4 s throughout (' + dgs.length + ' gaps, min ' + Math.min(...dgs) + ', max ' + Math.max(...dgs) + ')');
  const tl = await writeChar(A, 'off1'); const oAt = await seenAt(B, 'off1', 8000);
  check(!!oAt && oAt - tl < 5500, 'the switch: with it off a write still arrives by the poll (' + (oAt ? oAt - tl : 'never') + ' ms)');
  const on = await api('PATCH', '/gm/state', { live: true });
  check(on.status === 200, 'the switch: turned back on');
  const reopened = await until(async () => (await Promise.all(pages.map(st))).filter((s) => s.open).length >= pages.length - 1, 25000, 200);
  const nOpen = (await Promise.all(pages.map(st))).filter((s) => s.open).length;
  check(!!reopened, 'the switch: pages reopen their sockets once a poll says live: true (' + nOpen + ' of ' + pages.length + ' open; the silent page counts too)');

  // ---------- 8. the budget, per device per hour ----------
  const mins = (Date.now() - pages[0].sockets[0].at) / 60000;
  console.log('BUDGET sockets made per page over ' + mins.toFixed(1) + ' min: ' + pages.map((r) => r.name + '=' + wsCount(r)).join(' '));
  check(errors.length === 0, 'no page error or console error (' + errors.slice(0, 3).join(' | ') + ')');
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
} finally {
  try { if (browser) await browser.close(); } catch (_) {}
}
console.log(failed ? '\n' + failed + ' FAILED, ' + passed + ' passed' : '\nALL PASSED (' + passed + ')');
process.exit(failed ? 1 : 0);
