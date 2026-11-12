// map-scene (MK1): the map kit's new options on the demo night (scripts/demo-night.mjs: the real Worker, pack and GM page, everything invented), in a real
// browser. No model, no key: the Anthropic keys are taken out of the environment. Every options object the page hands B68Map.render is captured.
//   0. the four settings off: no Shared screen select, no Cut to room, and no option the settings govern reaches the kit (GM copy or the iPad's copy)
//   1. the four rows in the iPad view's Settings, turned on there
//   2. the Shared screen select in the map's View & theme (iPad by default); the Run map's GM copy gets people and the crowd
//   3. Cut to room stays hidden while the vendored map kit has no view "room" (kit 1.0.0)
//   4. the map is put up on the iPad: the player copy is layout "stage" at 1366 x 1024 with the crew only; the select set to TV re-sends the live map at
//      once, through the same path, at 1920 x 1080; the iPad's GET carries no GM-ONLY- text and names no one but the crew
// SHOTS=<dir> writes the pictures.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9310] [SHOTS=<dir>] node checks/runtime/map-scene.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9310);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const SHOTS = process.env.SHOTS || '';
const { chromium } = require(process.env.PW_MODULE || 'playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const CREW = ['Nell Arbuthnot', 'Ray Okonjo', 'Tam Petrakis'];
const CAST = ['Mabel Quist', 'Dov Kessler', 'Ada Vell', 'Lotte Brand'];

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 150) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, text: t, json: j }; });

const env = { ...process.env };
delete env.ANTHROPIC_API_KEY; delete env.B68_ANTHROPIC_KEY;
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const demo = spawn(process.execPath, [path.join(ROOT, 'scripts', 'demo-night.mjs'), '--port', String(PORT)], { cwd: ROOT, env, detached: !WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let demoLog = '';
demo.stdout.on('data', (d) => { demoLog += d; }); demo.stderr.on('data', (d) => { demoLog += d; });
function killDemo() { if (WIN) spawnSync('taskkill', ['/pid', String(demo.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-demo.pid, 'SIGKILL'); } catch (_) {} } }
process.on('exit', killDemo);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + demoLog.slice(-2000)); process.exit(1); }, 600000);

/* the spy: every options object the page hands the map kit, as JSON (the figure kit replaced by a mark) */
const SPY = () => {
  const K = window.B68Map; if (!K || K.__mk1) return !!K;
  const r0 = K.render; window.__mk1 = [];
  K.render = function (roll, o) { try { window.__mk1.push(JSON.parse(JSON.stringify(o, (k, v) => (k === 'kit' && v && typeof v === 'object' ? '(kit)' : v)))); } catch (e) { window.__mk1.push({ err: String(e) }); } return r0.apply(this, arguments); };
  K.__mk1 = true; return true;
};
const opts = (page) => page.evaluate(() => (window.__mk1 || []).slice());
const GOVERNED = ['people', 'crowd', 'lights', 'figures', 'displayWidth', 'displayHeight', 'room'];
/* the Score place's Run view, visible (from another view: the Run view is opened again, as G does) */
const toRun = async (page) => {
  await page.evaluate(() => { window.B68GmPage.goPlace('score'); window.B68GmPage.openView('run'); });
  await page.waitForSelector('#gm-runv .rv-head', { state: 'visible', timeout: 20000 }); await page.waitForTimeout(900);
};
/* a picture: the passing toasts hidden first (they cover what the picture is of); sel is one element, or a list of selectors pictured together */
const shot = async (page, name, sel) => {
  if (!SHOTS) return;
  await page.evaluate(() => { for (const e of document.querySelectorAll('body *')) { const s = getComputedStyle(e); if (s.position === 'fixed' && /toast/i.test(e.className + ' ' + e.id + ' ' + (e.parentElement ? e.parentElement.className + ' ' + e.parentElement.id : ''))) e.style.visibility = 'hidden'; } });
  if (Array.isArray(sel)) {
    await page.evaluate((l) => { const e = document.querySelector(l[0]); if (e) e.scrollIntoView({ block: 'start' }); }, sel); await page.waitForTimeout(200);
    const box = await page.evaluate((l) => { const rs = l.map((q) => document.querySelector(q)).filter(Boolean).map((e) => e.getBoundingClientRect()); if (!rs.length) return null;
      const x = Math.min(...rs.map((r) => r.left)), y = Math.min(...rs.map((r) => r.top)); return { x: Math.max(0, x - 8), y: Math.max(0, y - 8), width: Math.max(...rs.map((r) => r.right)) - x + 16, height: Math.max(...rs.map((r) => r.bottom)) - y + 16 }; }, sel);
    await page.screenshot({ path: path.join(SHOTS, name + '.png'), clip: box || undefined }); return;
  }
  const el = sel ? await page.$(sel) : null; await (el || page).screenshot({ path: path.join(SHOTS, name + '.png') });
};

try {
  for (let i = 0; i < 240 && !/Ctrl\+C stops it/.test(demoLog); i++) { await sleep(500); if (demo.exitCode !== null) break; }
  if (!/Ctrl\+C stops it/.test(demoLog)) throw new Error('the demo night did not come up:\n' + demoLog.slice(-1500));
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1366, height: 1024 }, serviceWorkers: 'block' });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE + '/#gm');
  check(!!(await until(() => page.evaluate(() => !!(window.B68GmPage && window.B68GmPage._state() && window.B68GmPage._state().status === 'ready')), 30000)), 'the GM page is ready');
  check(!!(await until(() => page.evaluate(SPY), 20000)), 'the map kit is here and spied on');
  const kitVer = await page.evaluate(() => window.B68Map.VERSION || ''), roomView = await page.evaluate(() => { try { return window.B68Map.options().views.indexOf('room') >= 0; } catch (e) { return false; } });
  console.log('  map kit ' + kitVer + ', view "room": ' + roomView);

  /* 0. off */
  await page.evaluate(() => window.B68GmPage.openView('location')); await page.waitForTimeout(600);
  await page.evaluate(() => { const d = document.querySelector('details[data-fold="mapopts"]'); if (d) d.open = true; });
  check(await page.evaluate(() => !document.querySelector('#gm-m-screen') && !!document.querySelector('#gm-m-view')), 'off: the View & theme fold has no Shared screen select');
  await toRun(page);
  check(await page.evaluate(() => !document.querySelector('[data-site="scene-cut"], [data-site="scene-back"]')), 'off: no Cut to room, no Back to the map');
  await page.evaluate(() => { const b = document.querySelector('#gm-runv [data-rv="view"][data-v="map"]'); if (b) b.click(); }); await page.waitForTimeout(1200);
  await page.evaluate(() => { const b = document.querySelector('#gm-runv [data-rv="view"][data-v="board"]'); if (b) b.click(); }); await page.waitForTimeout(400);
  const showBtn = '#gm-runv [data-site="ipad"]';
  if (await page.$(showBtn)) { await page.click(showBtn); await page.waitForTimeout(1500); }
  const off = await opts(page);
  check(off.length > 0 && off.every((o) => GOVERNED.every((k) => !(k in o)) && o.layout !== 'stage'), 'off: no option a map setting governs reached the kit (' + off.length + ' renders: ' + [...new Set(off.map((o) => o.layer))].join(', ') + ')');

  /* 1. the four rows, turned on in Settings */
  await page.evaluate(() => window.B68GmPage.openView('ipad'));
  await page.waitForSelector('#gm-ipad-settings [data-set-row="map.room"]', { timeout: 8000 });
  const rows = await page.evaluate(() => ['map.fill', 'map.people', 'map.lights', 'map.room'].map((k) => { const r = document.querySelector('#gm-ipad-settings [data-set-row="' + k + '"]'); return r ? r.querySelector('.gm-lab').textContent + '=' + r.querySelector('[aria-pressed="true"]').textContent : null; }));
  check(JSON.stringify(rows) === JSON.stringify(['Map fills the screen=Off', 'People on the map=Off', 'Room lights=Off', 'Cut to the room=Off']), 'the four rows, each Off: ' + JSON.stringify(rows));
  for (const k of ['map.fill', 'map.people', 'map.lights', 'map.room']) { await page.click('#gm-ipad-settings [data-set="' + k + '"][data-v="1"]'); await page.waitForTimeout(250); }
  await page.waitForTimeout(600);
  const st = await api('GET', '/gm/state');
  const fs = st.json && st.json.doc && st.json.doc.features || {};
  check(['map.fill', 'map.people', 'map.lights', 'map.room'].every((k) => fs[k] === true), 'each is stored on in the GM state');
  await page.evaluate(() => { const s = document.querySelector('#gm-ipad-settings'); if (s) s.scrollIntoView({ block: 'start' }); });
  await shot(page, 'settings-four-rows-on-1366', ['map.fill', 'map.people', 'map.lights', 'map.room'].map((k) => '#gm-ipad-settings [data-set-row="' + k + '"]'));

  /* 2. the select, and the GM copy's people */
  await page.evaluate(() => window.B68GmPage.openView('location')); await page.waitForTimeout(600);
  await page.evaluate(() => { const d = document.querySelector('details[data-fold="mapopts"]'); if (d) { d.open = true; d.scrollIntoView({ block: 'center' }); } });
  const sel = await page.evaluate(() => { const s = document.querySelector('#gm-m-screen'); return s ? { v: s.value, opts: [...s.options].map((o) => o.textContent), label: s.closest('label').textContent.trim() } : null; });
  check(!!sel && sel.v === 'ipad' && JSON.stringify(sel.opts) === JSON.stringify(['iPad (4:3)', 'TV (16:9)']), 'the Shared screen select: iPad (4:3) / TV (16:9), iPad by default ' + JSON.stringify(sel));
  await shot(page, 'location-shared-screen-1366', 'details[data-fold="mapopts"]');
  await page.evaluate(() => { window.__mk1.length = 0; }); await toRun(page);
  await page.evaluate(() => { const b = document.querySelector('#gm-runv [data-rv="view"][data-v="map"]'); if (b) b.click(); }); await page.waitForTimeout(1500);
  const gmO = (await opts(page)).filter((o) => o.layer === 'gm');
  const lastGm = gmO[gmO.length - 1] || {};
  check(Array.isArray(lastGm.people) && lastGm.people.length > 0 && lastGm.crowd !== undefined && lastGm.figures && lastGm.figures.kit === '(kit)', 'the Run map\'s GM copy has people (' + (lastGm.people || []).length + '), the crowd and the figure kit');
  check(!('layout' in lastGm) || lastGm.layout !== 'stage', 'the stage layout is the shared screen\'s only');

  /* 3. Cut to room on kit 1.0.0 */
  await page.evaluate(() => { const r = document.querySelector('#gm-runv [data-rv="view"][data-v="board"]'); if (r) r.click(); }); await page.waitForTimeout(500);
  const cut = await page.evaluate(() => document.querySelectorAll('[data-site="scene-cut"]').length);
  check(roomView ? cut > 0 : cut === 0, roomView ? 'the kit draws a room: Cut to room on the known rooms (' + cut + ')' : 'the kit has no room view: Cut to room is hidden (' + cut + ')');
  await shot(page, 'run-room-card-1366', '#gm-runv');

  /* 4. the live map on the iPad, then TV */
  await page.evaluate(() => { window.__mk1.length = 0; });
  const down = await page.$('#gm-runv [data-site="ipad-down"]'); if (down) { await page.click('#gm-runv [data-site="ipad-down"]'); await page.waitForTimeout(800); }
  const d0 = await api('GET', '/gm/display', undefined, IPAD);
  await page.click(showBtn); await page.waitForTimeout(500);
  const up = await until(async () => (await opts(page)).filter((o) => o.layer === 'player').pop(), 10000);
  check(!!up && up.layout === 'stage' && up.displayWidth === 1366 && up.displayHeight === 1024, 'Show on iPad: the player copy is layout "stage" at 1366 x 1024 ' + JSON.stringify(up && [up.layout, up.displayWidth, up.displayHeight]));
  check(!!up && Array.isArray(up.people) && up.people.every((p) => p.tone === 'crew' && CREW.includes(p.label)), 'the player copy\'s people are the crew only: ' + JSON.stringify(up && up.people && up.people.map((p) => p.label)));
  const d1 = await until(async () => { const d = await api('GET', '/gm/display', undefined, IPAD); return d.status === 200 && d.text !== d0.text ? d : null; }, 8000);
  check(!!d1, 'the iPad has the map');
  await page.evaluate(() => { window.__mk1.length = 0; window.B68GmPage.openView('location'); }); await page.waitForTimeout(600);
  await page.evaluate(() => { const d = document.querySelector('details[data-fold="mapopts"]'); if (d) d.open = true; });
  await page.selectOption('#gm-m-screen', 'tv');
  const tv = await until(async () => (await opts(page)).filter((o) => o.layer === 'player' && o.displayWidth === 1920).pop(), 6000);
  check(!!tv && tv.layout === 'stage' && tv.displayHeight === 1080, 'Shared screen to TV: the live map is drawn again at once, 1920 x 1080');
  const d2 = await until(async () => { const d = await api('GET', '/gm/display', undefined, IPAD); return d.status === 200 && d1 && d.text !== d1.text ? d : null; }, 8000);
  check(!!d2, 'and it reached the iPad (the display changed)');
  const last = d2 || d1 || d0;
  check(!/GM-ONLY-/.test(last.text) && !CAST.some((n) => last.text.includes(n)), 'the iPad\'s GET carries no GM-ONLY- text and no cast name');
  await page.evaluate(() => { const d = document.querySelector('details[data-fold="mapopts"]'); if (d) d.scrollIntoView({ block: 'center' }); });
  await shot(page, 'location-shared-screen-tv-1366', 'details[data-fold="mapopts"]');
  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
} catch (e) { check(false, 'the run: ' + (e && e.stack || e)); }
clearTimeout(timeout);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
killDemo();
process.exit(failed ? 1 : 0);
