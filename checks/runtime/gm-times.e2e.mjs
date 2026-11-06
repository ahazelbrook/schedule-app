// F2: the GM sets tonight's start and curfew in the app (Before > Tonight), against the demo night in a real local Worker. Invented data only.
//   1. Tonight's two time fields show the note's times and no "from the prep note" line until they differ.
//   2. Set the start to 18:30 and the curfew to 22:00: the night keeps them, the fields say what the note had, the Hard start arms for 18:30, the band's curfew follows.
//   3. Entering a phase leaves them alone; the fields survive a reload.
//   4. Use the prep's puts the note's times back.
//   PW_MODULE=<playwright> PW_CHANNEL=msedge PORT=8700 node checks/runtime/gm-times.e2e.mjs      (GM_SHOTS=<dir> keeps screenshots)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8700);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const SHOTS = process.env.GM_SHOTS || '';
const WIN = process.platform === 'win32';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 150) { const t0 = Date.now(); for (;;) { let v; try { v = await fn(); } catch (_) { v = null; } if (v || Date.now() - t0 > ms) return v; await sleep(step); } }

/* the demo night, in a state folder of our own */
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use: stop what is on it, or set PORT'); process.exit(1); }
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-times-e2e-'));
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
delete env.ANTHROPIC_API_KEY; delete env.B68_ANTHROPIC_KEY;
const demo = spawn(process.execPath, [path.join(ROOT, 'scripts', 'demo-night.mjs'), '--port', String(PORT), '--state', stateDir], { cwd: ROOT, env, detached: !WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let demoLog = '';
demo.stdout.on('data', (d) => { demoLog += d; }); demo.stderr.on('data', (d) => { demoLog += d; });
function stopDemo() { if (WIN) spawnSync('taskkill', ['/pid', String(demo.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-demo.pid, 'SIGKILL'); } catch (_) {} } }
process.on('exit', () => { stopDemo(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + demoLog.slice(-2000)); process.exit(1); }, 600000);
const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const nightPhase = async () => { const d = (await api('GET', '/gm/state')).json; return d && d.doc && d.doc.night ? d.doc.night.phase || '' : ''; };

try {
  const up = await until(() => /Ctrl\+C stops it/.test(demoLog) || demo.exitCode !== null, 300000, 500);
  if (!up || demo.exitCode !== null) throw new Error('the demo night did not come up:\n' + demoLog.slice(-2000));
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open({ w = 1366, h = 768, mobile = false, ctx = null } = {}) {
    const c = ctx || await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w, height: h }, serviceWorkers: 'block', ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
    if (!ctx) await c.addInitScript(() => { window.__B68_POLL_MS = 700; });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me && window.B68GmPage && window.B68GmPage._places && window.B68GmPage._places(), null, { timeout: 40000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await sleep(500);
    return { c, page };
  }
  const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png'), animations: 'disabled' }); } };
  const st = (page) => page.evaluate(() => window.B68GmPage._places()._state());
  const attr = (page, a) => page.$eval('#gm-root', (r, x) => r.getAttribute(x), a);
  const views = (page) => page.$$eval('.gm-views [data-pv]', (els) => els.map((e) => e.getAttribute('data-pv')));
  const visible = (page, sel) => page.$eval(sel, (e) => !!e && !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0).catch(() => false);
  const blur = (page) => page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  const key = async (page, k) => { await blur(page); await page.keyboard.press(k); await sleep(250); };


  const field = (page, k) => page.$eval('#gm-left [data-tn-time="' + k + '"]', (e) => e.value);
  const fromNote = (page, k) => page.$eval('#gm-left [data-tn-time="' + k + '"]', (e) => { const r = e.closest('.gm-tn-time'); const s = r && r.querySelector('.gm-tn-from'); return s ? s.textContent : ''; }).catch(() => '');
  const hasPrepBtn = (page, k) => page.$('#gm-left [data-tn-prep="' + k + '"]').then((b) => !!b);
  const nightDoc = async () => { const d = (await api('GET', '/gm/state')).json; return (d && d.doc && d.doc.night) || {}; };
  const bandCurfew = (page) => page.$eval('[data-band-curfew]', (e) => e.textContent).catch(() => '');
  const arm = (page) => page.$eval('#gm-left [data-hs="arm"]', (e) => ({ text: e.textContent, disabled: e.disabled })).catch(() => null);

  /* ---- 1. the note's times ---- */
  check(await nightPhase() === '', 'the demo night has no phase in play yet');
  const A = await open(); const a = A.page;
  check(await attr(a, 'data-place') === 'before', 'the page opens in Before');
  check(await until(async () => (await field(a, 'startAt')) === '19:30', 8000) && await field(a, 'curfewAt') === '22:40', 'Tonight: Start 19:30 and Curfew 22:40, from the note');
  check(await fromNote(a, 'startAt') === '' && await fromNote(a, 'curfewAt') === '' && !(await hasPrepBtn(a, 'startAt')), 'and no "from the prep note" line while they match');
  await shot(a, 'tonight-1366-note');

  /* ---- 2. set them ---- */
  await a.fill('#gm-left [data-tn-time="startAt"]', '18:30');
  check(await until(async () => (await nightDoc()).startAt === '18:30', 8000), 'the start is written to the night (18:30)');
  await a.fill('#gm-left [data-tn-time="curfewAt"]', '22:00');
  check(await until(async () => (await nightDoc()).curfewAt === '22:00', 8000), 'and the curfew (22:00)');
  check(await until(async () => /19:30/.test(await fromNote(a, 'startAt')) && /22:40/.test(await fromNote(a, 'curfewAt')), 6000), 'the fields say "from the prep note: 19:30" and "22:40"');
  check(await field(a, 'startAt') === '18:30' && await field(a, 'curfewAt') === '22:00' && await hasPrepBtn(a, 'startAt') && await hasPrepBtn(a, 'curfewAt'), 'they still show the GM\'s times, each with Use the prep\'s');
  check(await until(async () => /curfew 22:00/.test(await bandCurfew(a)), 8000), 'the band\'s curfew follows: ' + (await bandCurfew(a)));
  await shot(a, 'tonight-1366-set');

  /* ---- the Hard start reads it ---- */
  await a.evaluate(() => window.B68GmPage.goPlace('opening', { navigateOnly: true }));
  check(await until(async () => { const r = await arm(a); return r && /Arm for 18:30/.test(r.text) && !r.disabled; }, 8000), 'the Hard start: "Arm for 18:30" ' + JSON.stringify(await arm(a)));
  await shot(a, 'opening-1366');

  /* ---- 3. a phase leaves them alone ---- */
  await a.evaluate(() => window.B68GmPage.goPlace('pb'));
  check(await until(async () => (await nightPhase()) === 'pb', 8000), 'Personal is entered');
  await a.evaluate(() => window.B68GmPage.goPlace('plan'));
  check(await until(async () => (await nightPhase()) === 'plan', 8000), 'then Planning');
  const nd = await nightDoc();
  check(nd.startAt === '18:30' && nd.curfewAt === '22:00', 'the times stayed (' + nd.startAt + ', ' + nd.curfewAt + ')');
  await a.evaluate(() => window.B68GmPage.goPlace('before', { navigateOnly: true }));
  check(await field(a, 'startAt') === '18:30' && await field(a, 'curfewAt') === '22:00', 'Before still shows 18:30 and 22:00');
  await a.reload(); await a.waitForFunction(() => window.B68GmPage && window.B68GmPage._places && window.B68GmPage._places(), null, { timeout: 30000 }); await sleep(800);
  await a.evaluate(() => window.B68GmPage.goPlace('before', { navigateOnly: true }));
  check(await until(async () => (await field(a, 'startAt')) === '18:30', 8000) && await field(a, 'curfewAt') === '22:00', 'and after a reload');

  /* ---- a second GM device sees it on its refetch ---- */
  const B = await open(); await B.page.evaluate(() => window.B68GmPage.goPlace('before', { navigateOnly: true }));
  check(await until(async () => (await field(B.page, 'startAt')) === '18:30', 10000), 'another GM page shows 18:30');
  await B.c.close();

  /* ---- 4. Use the prep's ---- */
  await a.click('#gm-left [data-tn-prep="startAt"]');
  check(await until(async () => (await field(a, 'startAt')) === '19:30' && !(await hasPrepBtn(a, 'startAt')), 8000), 'Use the prep\'s: the start is 19:30 again');
  check(await until(async () => { const d = await nightDoc(); return d.startAt === "19:30" && d.curfewAt === "22:00"; }, 6000), "and only the start; the curfew is still the GM own");
  await a.click('#gm-left [data-tn-prep="curfewAt"]');
  check(await until(async () => (await field(a, 'curfewAt')) === '22:40', 8000) && await until(async () => /curfew 22:40/.test(await bandCurfew(a)), 8000), 'and the curfew (22:40); the band follows');

  /* ---- phone ---- */
  await a.fill('#gm-left [data-tn-time="startAt"]', '18:30');
  await a.fill('#gm-left [data-tn-time="curfewAt"]', '22:00');
  check(await until(async () => { const d = await nightDoc(); return d.startAt === '18:30' && d.curfewAt === '22:00'; }, 8000), 'both reach the server');
  const M = await open({ w: 390, h: 844, mobile: true }); const m = M.page;
  await m.evaluate(() => window.B68GmPage.goPlace('before', { navigateOnly: true }));
  await m.tap(".gm-vchips [data-seg=\"console\"]"); await sleep(400);
  check(await until(async () => (await field(m, 'startAt')) === '18:30', 10000), 'phone: the fields show the GM own times');
  const h44 = await m.$eval('#gm-left [data-tn-time="startAt"]', (e) => Math.round(e.getBoundingClientRect().height));
  check(h44 >= 44, 'phone: the field is 44 px (' + h44 + ')');
  await m.$eval('#gm-left [data-tn-time="startAt"]', (e) => e.scrollIntoView({ block: 'center' }));
  const over = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 1, 'phone: nothing wider than the screen (' + over + ' px)');
  await shot(m, 'tonight-390-set');
  await M.c.close(); await A.c.close();

  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e) + '\n' + demoLog.slice(-1500));
}
clearTimeout(timeout);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
