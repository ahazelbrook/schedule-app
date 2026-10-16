// The shared clocks end to end (CAMPAIGN.md, *Clocks*): the table page, boot.js, the adapter (cf.js) and a real local Worker
// (wrangler dev, DEV_USER) on PORT (default 8797). Two players' phones and the GM's laptop open the table; the pages poll
// only when told to, so each acts on a copy that misses the others' last change, as within one poll interval at the table:
//   a tick goes out as { clockOps: [{ id, filled }] } (not the whole array); two players tick different clocks from the
//   same copy and both land; the GM renames, adds and removes clocks while a player ticks; every page ends up showing it all.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node checks/runtime/clocks.e2e.mjs      (or: npm run check:clocks-e2e)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8797);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', P1 = 'p1@example.test', P2 = 'p2@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- our own server (only this process group is ever signalled) ---------- */
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-clocks-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use: stop what is on it, or set PORT'); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM],
{ cwd: ROOT, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, detached: true, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
function killServer(sig = 'SIGTERM') { try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(-server.pid, sig); } catch (_) {} }
process.on('exit', () => { killServer('SIGKILL'); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 240000);
const api = (method, p, user, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const stored = async () => (await api('GET', '/campaign', GM)).json.doc;
const fills = (doc) => doc.clocks.map((c) => c.id + ' ' + c.filled).join(', ');

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 90000, 300);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  const put = await api('PUT', '/campaign', GM, {
    v: 1, session: { number: 1, startedAt: new Date().toISOString(), endedAt: null },
    crew: { name: 'The Lamplighters', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] },
    clocks: [
      { id: 'c_a', name: 'Alarm', size: 4, filled: 0, kind: 'danger', hidden: false },
      { id: 'c_b', name: 'Fence', size: 6, filled: 0, kind: 'project', hidden: false },
      { id: 'c_c', name: 'Doomed', size: 8, filled: 2, kind: 'faction', hidden: false },
    ],
    log: [],
  });
  check(put.status === 200, 'the GM stores a table with three clocks');

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  /* each page polls only when poke() says so (the poll interval is a minute), so it acts on the copy it last read */
  async function open(user, mobile) {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
    await ctx.addInitScript(() => { window.__B68_POLL_MS = 60000; });
    const page = await ctx.newPage();
    const sent = [];
    page.on('request', (r) => { if (r.method() === 'PATCH' && /\/api\/campaign$/.test(r.url())) sent.push(JSON.parse(r.postData() || 'null')); });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(user + ': ' + m.text()); });
    page.on('pageerror', (e) => errors.push(user + ' pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '/#t');
    await page.waitForSelector('.tp-clock[data-id="c_a"]', { timeout: 20000 });
    return { page, sent, poke: () => page.evaluate(() => window.dispatchEvent(new Event('online'))) };
  }
  const shown = (page) => page.$$eval('.tp-clock', (ns) => ns.map((n) => n.dataset.id + ' ' + n.querySelector('.tp-step .mono').textContent.split(' / ')[0]).join(', '));
  const plus = (page, id) => page.click('.tp-stepb[data-act="clockstep"][data-d="1"][data-id="' + id + '"]');
  const settled = (o) => until(async () => (await o.page.evaluate(() => window.B68Runtime.status.pending)) === 0, 10000);

  const a = await open(P1, true), b = await open(P2, true), g = await open(GM, false);
  check(await a.page.evaluate(() => window.B68Runtime.kind === 'cloudflare'), 'the hosted adapter runs the page');

  // (a) P2 ticks the fence; P1 has not heard of it and ticks the alarm: both land, nothing undone
  await plus(b.page, 'c_b'); await settled(b);
  await plus(a.page, 'c_a'); await settled(a);
  const s1 = await stored();
  check(fills(s1) === 'c_a 1, c_b 1, c_c 2', '(a) two players, two clocks, one stale copy: both ticks land (' + fills(s1) + ')');
  check(JSON.stringify(a.sent.map((x) => Object.keys(x).sort())) === '[["clockOps","updatedAt"]]' && JSON.stringify(a.sent[0].clockOps) === '[{"id":"c_a","filled":1}]',
    'the page sends a tick as one clock op, not the whole array: ' + JSON.stringify(a.sent));
  // the same moment: both tap at once
  await Promise.all([plus(a.page, 'c_b'), plus(b.page, 'c_c')]);
  await settled(a); await settled(b);
  check(fills(await stored()) === 'c_a 1, c_b 2, c_c 3', '(a) two taps at the same moment on two clocks both land (' + fills(await stored()) + ')');

  // (b, c) the GM renames the alarm, adds a clock and removes the doomed one; P2 ticks the alarm from its old copy meanwhile
  await g.page.click('.tp-clock[data-id="c_a"] .tp-in'); await g.page.keyboard.press('End'); await g.page.keyboard.type(' bells', { delay: 5 });
  await plus(b.page, 'c_a');
  await sleep(700); await settled(g); await settled(b);
  await g.page.fill('[data-ui="newclock"]', 'Bluecoats'); await g.page.click('[data-act="clockadd"]'); await settled(g);
  await plus(a.page, 'c_b');
  await g.page.click('[data-act="clockrm"][data-id="c_c"]'); await settled(g); await settled(a);
  const s2 = await stored();
  check(s2.clocks.map((c) => c.name + ' ' + c.filled).join(', ') === 'Alarm bells 2, Fence 3, Bluecoats 0', '(b, c) the GM\'s rename, add and remove and the players\' ticks all land: ' + JSON.stringify(s2.clocks.map((c) => [c.name, c.filled])));
  check(g.sent.every((x) => x.clockOps && !('clocks' in x)), 'the GM\'s clock changes go out as ops too: ' + JSON.stringify(g.sent.map((x) => x.clockOps)));

  // (d) the same clock from both phones, each from a copy at 3: each says 4, and the later write wins on that clock
  for (const o of [a, b]) await o.poke();
  await until(async () => (await shown(a.page)).includes('c_b 3') && (await shown(b.page)).includes('c_b 3'), 8000, 200);
  await plus(a.page, 'c_b'); await settled(a);
  await plus(b.page, 'c_b'); await settled(b);
  const s3 = await stored();
  check(fills(s3) === 'c_a 2, c_b 4, ' + s3.clocks[2].id + ' 0', '(d) two phones tick the fence from 3: it ends at 4 (the later write wins on that clock; the others do not move): ' + fills(s3));

  // every page shows the stored clocks once it polls
  for (const o of [a, b, g]) await o.poke();
  const want = s3.clocks.map((c) => c.id + ' ' + c.filled).join(', ');
  for (const [name, o] of [['P1', a], ['P2', b], ['GM', g]]) {
    const ok = await until(async () => (await shown(o.page)) === want, 8000, 200);
    check(!!ok, name + ' shows the stored clocks: ' + (await shown(o.page)) + ' (want ' + want + ')');
  }
  check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
} finally {
  clearTimeout(timeout);
  killServer('SIGTERM');
  const t0 = Date.now(); while (server.exitCode === null && server.signalCode === null && Date.now() - t0 < 5000) await sleep(100);
  killServer('SIGKILL');
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
