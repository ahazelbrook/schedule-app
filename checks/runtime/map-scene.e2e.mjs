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
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + demoLog.slice(-2000)); process.exit(1); }, 900000);      /* the frame waits on the display's own minute-long reports */

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
  const sceneReqs = []; let onAt = Infinity;
  page.on('request', (r) => { if (/\/gm\/scene-state\.js/.test(r.url())) sceneReqs.push({ at: Date.now(), url: r.url() }); });
  await page.goto(BASE + '/#gm');
  check(!!(await until(() => page.evaluate(() => !!(window.B68GmPage && window.B68GmPage._state() && window.B68GmPage._state().status === 'ready')), 30000)), 'the GM page is ready');
  check(!!(await until(() => page.evaluate(SPY), 20000)), 'the map kit is here and spied on');
  const kitVer = await page.evaluate(() => window.B68Map.VERSION || ''), roomView = await page.evaluate(() => { try { return window.B68Map.options().views.indexOf('room') >= 0; } catch (e) { return false; } });
  const stageKit = await page.evaluate(() => { try { return window.B68Map.options().layouts.indexOf('stage') >= 0; } catch (e) { return false; } });
  console.log('  map kit ' + kitVer + ', view "room": ' + roomView + ', layout "stage": ' + stageKit);

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
  check(await page.evaluate(() => !window.B68GmScene), 'off: the map-scene bundle is not loaded');
  onAt = Date.now();
  for (const k of ['map.fill', 'map.people', 'map.lights', 'map.room']) { await page.click('#gm-ipad-settings [data-set="' + k + '"][data-v="1"]'); await page.waitForTimeout(250); }
  await page.waitForTimeout(600);
  const st = await api('GET', '/gm/state');
  const fs = st.json && st.json.doc && st.json.doc.features || {};
  check(['map.fill', 'map.people', 'map.lights', 'map.room'].every((k) => fs[k] === true), 'each is stored on in the GM state');
  check(!!(await until(() => page.evaluate(() => !!window.B68GmScene), 8000)), 'a map setting on: the map-scene bundle is fetched (B68GmScene is here)');
  check(sceneReqs.filter((r) => r.at < onAt).length === 0 && sceneReqs.length >= 1, 'gm/scene-state.js was never asked for while the four were off, and once after (' + sceneReqs.length + ')');
  await page.evaluate(() => { const s = document.querySelector('#gm-ipad-settings'); if (s) s.scrollIntoView({ block: 'start' }); });
  await shot(page, 'settings-four-rows-on-1366', ['map.fill', 'map.people', 'map.lights', 'map.room'].map((k) => '#gm-ipad-settings [data-set-row="' + k + '"]'));

  /* 2. the select, and the GM copy's people */
  await page.evaluate(() => window.B68GmPage.openView('location')); await page.waitForTimeout(600);
  await page.evaluate(() => { const d = document.querySelector('details[data-fold="mapopts"]'); if (d) { d.open = true; d.scrollIntoView({ block: 'center' }); } });
  const sel = await page.evaluate(() => { const s = document.querySelector('#gm-m-screen'); return s ? { v: s.value, opts: [...s.options].map((o) => o.textContent), label: s.closest('label').textContent.trim() } : null; });
  if (stageKit) check(!!sel && sel.v === 'ipad' && JSON.stringify(sel.opts) === JSON.stringify(['iPad (4:3)', 'TV (16:9)']), 'the Shared screen select: iPad (4:3) / TV (16:9), iPad by default ' + JSON.stringify(sel));
  else check(!sel, 'the kit has no stage layout: no Shared screen select, even with map.fill on');
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
  if (stageKit) check(!!up && up.layout === 'stage' && up.displayWidth === 1366 && up.displayHeight === 1024, 'Show on iPad: the player copy is layout "stage" at 1366 x 1024 ' + JSON.stringify(up && [up.layout, up.displayWidth, up.displayHeight]));
  else check(!!up && up.layout === 'ipad' && !('displayWidth' in up), 'Show on iPad, map.fill on, a kit with no stage layout: the iPad layout as today ' + JSON.stringify(up && [up.layout, up.displayWidth]));
  check(!!up && Array.isArray(up.people) && up.people.every((p) => p.tone === 'crew' && CREW.includes(p.label)), 'the player copy\'s people are the crew only: ' + JSON.stringify(up && up.people && up.people.map((p) => p.label)));
  const d1 = await until(async () => { const d = await api('GET', '/gm/display', undefined, IPAD); return d.status === 200 && d.text !== d0.text ? d : null; }, 8000);
  check(!!d1, 'the iPad has the map');
  await page.evaluate(() => { window.__mk1.length = 0; window.B68GmPage.openView('location'); }); await page.waitForTimeout(600);
  await page.evaluate(() => { const d = document.querySelector('details[data-fold="mapopts"]'); if (d) d.open = true; });
  let d2 = null;
  if (stageKit) {
    await page.selectOption('#gm-m-screen', 'tv');
    const tv = await until(async () => (await opts(page)).filter((o) => o.layer === 'player' && o.displayWidth === 1920).pop(), 6000);
    check(!!tv && tv.layout === 'stage' && tv.displayHeight === 1080, 'Shared screen to TV: the live map is drawn again at once, 1920 x 1080');
    d2 = await until(async () => { const d = await api('GET', '/gm/display', undefined, IPAD); return d.status === 200 && d1 && d.text !== d1.text ? d : null; }, 8000);
    check(!!d2, 'and it reached the iPad (the display changed)');
  }
  const last = d2 || d1 || d0;
  check(!/GM-ONLY-/.test(last.text) && !CAST.some((n) => last.text.includes(n)), 'the iPad\'s GET carries no GM-ONLY- text and no cast name');
  await page.evaluate(() => { const d = document.querySelector('details[data-fold="mapopts"]'); if (d) d.scrollIntoView({ block: 'center' }); });
  await shot(page, 'location-shared-screen-tv-1366', 'details[data-fold="mapopts"]');

  /* 5. (MK2, a kit with people and the room view) each setting alone, then together: the desk and the two shared screens (an iPad at 1366 x 1024,
     a TV at 1920 x 1080: two display pages, the iPad's own login), the dawn event's room bright, one floor, Cut to room with pictures and back */
  if (roomView) {
    const disp = async (w, h) => { const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: w, height: h }, serviceWorkers: 'block' }); const p = await c.newPage(); p.on('pageerror', (e) => errors.push('display: ' + String(e && e.message || e))); await p.goto(BASE + '/#display'); return p; };
    const DI = await disp(1366, 1024), DT = await disp(1920, 1080);
    const frame = (p) => p.evaluate(() => { const s = document.querySelector('#display-page .dp-map-frame svg'); return s ? s.outerHTML.length + ':' + (s.getAttribute('viewBox') || '') : ''; });
    const settle = async (p, was) => { await until(async () => { const f = await frame(p); return f && f !== was ? f : null; }, 12000, 300); await p.waitForTimeout(700); };
    const both = async (name) => { const a = await frame(DI), b = await frame(DT); return { a, b, name }; };
    const shoot = async (st) => { await settle(DI, st.a); await settle(DT, st.b); if (SHOTS) { await DI.screenshot({ path: path.join(SHOTS, 'ipad-' + st.name + '-1366x1024.png') }); await DT.screenshot({ path: path.join(SHOTS, 'tv-' + st.name + '-1920x1080.png') }); } };
    const desk = async (name) => { if (!SHOTS) return; await page.setViewportSize({ width: 1366, height: 768 }); await toRun(page); await page.evaluate(() => { const b = document.querySelector('#gm-runv [data-rv="view"][data-v="map"]'); if (b) b.click(); }); await page.waitForTimeout(1500); await shot(page, 'desk-' + name + '-1366x768'); await page.setViewportSize({ width: 1366, height: 1024 }); };
    const setFlags = async (on) => {
      await page.evaluate(() => window.B68GmPage.openView('ipad')); await page.waitForSelector('#gm-ipad-settings [data-set-row="map.room"]', { timeout: 8000 });
      for (const k of ['map.fill', 'map.people', 'map.lights', 'map.room']) { await page.click('#gm-ipad-settings [data-set="' + k + '"][data-v="' + (on.includes(k) ? 1 : 0) + '"]'); await page.waitForTimeout(250); }
      await page.waitForTimeout(800);
    };
    const lastPlayer = async (pred, ms = 10000) => until(async () => (await opts(page)).filter((o) => o.layer === 'player' && (!pred || pred(o))).pop(), ms);
    const screenTo = async (v) => { await page.evaluate(() => window.B68GmPage.openView('location')); await page.waitForTimeout(500); await page.evaluate(() => { const d = document.querySelector('details[data-fold="mapopts"]'); if (d) d.open = true; }); if (await page.$('#gm-m-screen')) await page.selectOption('#gm-m-screen', v); await page.waitForTimeout(600); };
    /* the map stays up on the shared screen from here; every change goes through live reveal */
    let st = await both('fill');
    await setFlags(['map.fill']); await screenTo('ipad');
    let o = await lastPlayer((x) => x.layout === 'stage');
    check(!!o && !('people' in o) && !('lights' in o), 'map.fill alone: the stage layout, no people, no lights');
    await shoot(st);
    st = await both('people'); await page.evaluate(() => { window.__mk1.length = 0; }); await setFlags(['map.people']);
    o = await lastPlayer((x) => Array.isArray(x.people));
    check(!!o && o.layout !== 'stage' && o.crowd !== undefined && o.people.every((p) => p.tone === 'crew' && CREW.includes(p.label)), 'map.people alone: the crew and a crowd on the players\' map, the iPad layout');
    await shoot(st); await desk('people');
    st = await both('lights-bright'); await page.evaluate(() => { window.__mk1.length = 0; }); await setFlags(['map.lights']);
    await page.evaluate(() => window.B68GmPage._ballSet({ t: 180 }));      /* 00:00, the fireworks: a dawn event in the Showroom */
    o = await lastPlayer((x) => x.lights);
    check(!!o && o.lights && o.lights.Showroom === 'bright', 'map.lights alone, at 00:00: the Showroom is bright ' + JSON.stringify(o && o.lights));
    await shoot(st); await desk('lights-bright');
    st = await both('all'); await page.evaluate(() => { window.__mk1.length = 0; }); await setFlags(['map.fill', 'map.people', 'map.lights', 'map.room']); await screenTo('tv');
    o = await lastPlayer((x) => x.layout === 'stage' && x.displayWidth >= 200 && Array.isArray(x.people) && x.lights);      /* sized to a reported frame once one is in */
    check(!!o, 'all four together: the stage (' + (o ? o.displayWidth + ' x ' + o.displayHeight : '?') + '), the crew, the crowd and the light on the players\' map');
    await shoot(st); await desk('all');
    /* one floor */
    await page.evaluate(() => { window.B68GmPage.openView('location'); }); await page.waitForTimeout(500);
    await page.evaluate(() => { const d = document.querySelector('details[data-fold="mapopts"]'); if (d) d.open = true; });
    const fl = await page.evaluate(() => { const s = document.querySelector('#gm-m-ipadFloor'); return s ? [...s.options].map((x) => [x.value, x.textContent]) : null; });
    check(!!fl && fl[0][1] === 'Whole building' && fl.length > 2 && fl.slice(1).every(([v, t]) => /^-?\d+$/.test(v) && /^(Ground floor|Upper floor|Top floor|Basement)$/.test(t)), 'the Shared screen floor offers Whole building and the kit\'s own floor titles ' + JSON.stringify(fl));
    if (fl && fl.length > 1) {
      st = await both('one-floor'); await page.evaluate(() => { window.__mk1.length = 0; });
      await page.selectOption('#gm-m-ipadFloor', fl[1][0]);
      o = await lastPlayer((x) => Number.isInteger(x.floor), 8000);
      check(!!o && o.floor === +fl[1][0], 'choosing ' + fl[1][1] + ' re-sends the live map at once with floor ' + fl[1][0]);
      await shoot(st); await shot(page, 'location-floor-1366', 'details[data-fold="mapopts"]');
      st = await both('whole'); await page.selectOption('#gm-m-ipadFloor', ''); await settle(DT, st.b);
    }
    /* Cut to room, then back */
    await toRun(page);
    await page.evaluate(() => { const b = document.querySelector('#gm-runv [data-rv="view"][data-v="board"]'); if (b) b.click(); }); await page.waitForTimeout(500);
    const cuts = await page.evaluate(() => [...document.querySelectorAll('[data-site="scene-cut"]')].map((b) => b.getAttribute('data-room')));
    check(cuts.length > 0, 'the kit draws a room: Cut to room on the known rooms shown (' + cuts.join(', ') + ')');
    if (cuts.length) {
      st = await both('room'); await page.evaluate(() => { window.__mk1.length = 0; });
      await page.click('[data-site="scene-cut"][data-room="' + cuts[0].replace(/"/g, '\\"') + '"]');
      o = await lastPlayer((x) => x.view === 'room', 15000);
      check(!!o && o.room === cuts[0], 'Cut to room: view "room" of ' + cuts[0] + ' through the player path');
      const imgs = o ? (o.people || []).filter((p) => p.image).length : 0, specs = o ? (o.people || []).filter((p) => !p.image).length : 0;
      check(!!o && specs <= 3 && (o.people || []).every((p) => p.tone === 'crew'), 'the room\'s people: ' + imgs + ' as pictures (rasterize), ' + specs + ' as specs (three at most), the crew only');
      await shoot(st);
      check(await until(() => page.evaluate(() => !!document.querySelector('[data-site="scene-back"]') && /iPad: /.test((document.querySelector('.gm-scene-up') || {}).textContent || '')), 6000), 'the GM\'s toolbar says which room is up, with Back to the map');
      await shot(page, 'run-cut-to-room-1366', '#gm-runv');
      const dr = await api('GET', '/gm/display', undefined, IPAD);
      check(dr.status === 200 && !/GM-ONLY-/.test(dr.text) && !CAST.some((n) => dr.text.includes(n)), 'the room on the iPad carries no GM-ONLY- text and no cast name (' + Math.round(dr.text.length / 1024) + ' KiB)');
      st = await both('back'); await page.evaluate(() => { window.__mk1.length = 0; });
      await page.click('[data-site="scene-back"]');
      o = await lastPlayer((x) => x.view !== 'room', 10000);
      check(!!o && o.view !== 'room', 'Back to the map: the map again');
      await shoot(st);
      /* the review of #234, item 3: after a cut, a deliberate send of the map (the Location card's Show on iPad) puts the map up, and a later live
         re-send (the clock moves) keeps the map, not the room */
      await toRun(page); await page.evaluate(() => { const b = document.querySelector('#gm-runv [data-rv="view"][data-v="board"]'); if (b) b.click(); }); await page.waitForTimeout(400);
      await page.click('[data-site="scene-cut"][data-room="' + cuts[0].replace(/"/g, '\\"') + '"]');
      check(!!(await lastPlayer((x) => x.view === 'room', 15000)), 'cut to the room again');
      await page.evaluate(() => { window.__mk1.length = 0; window.B68GmPage.openView('location'); }); await page.waitForTimeout(600);
      await page.click('#gm-loc [data-gm="ipad"]');
      o = await lastPlayer(null, 10000);
      check(!!o && o.view !== 'room', 'the Location card\'s Show on iPad: the map, not the room');
      await page.evaluate(() => { window.__mk1.length = 0; window.B68GmPage._ballSet({ t: 195 }); });
      o = await lastPlayer(null, 10000);
      check(!!o && o.view !== 'room', 'and a live re-send after it keeps the map');
    }
    /* the overseer's addition 1: the stage drawn for the frame the shared screen reports. One screen only from here (two would both report) */
    if (stageKit) {
      await DI.context().close();
      /* both pages reported different frames above, so the GM may have stopped following (two screens must not make the map flap); choosing in the
         Shared screen select follows reports afresh. The frame rides on the display's own reports (idle: one a minute), so the waits are long */
      await screenTo('tv'); await toRun(page);
      const frameOf = (p) => p.evaluate(() => { const f = document.querySelector('#display-page .dp-map-frame'); if (!f) return null; const r = f.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; });
      const sizedTo = async (fr, ms) => until(async () => (await opts(page)).filter((x) => x.layer === 'player' && x.layout === 'stage' && Math.abs(x.displayWidth - fr.w) <= 8 && Math.abs(x.displayHeight - fr.h) <= 8).pop(), ms, 500);
      await page.evaluate(() => { window.__mk1.length = 0; });
      await DT.setViewportSize({ width: 1700, height: 1000 }); await DT.waitForTimeout(800);
      const f1 = await frameOf(DT);
      const s1 = f1 ? await sizedTo(f1, 110000) : null;
      check(!!f1 && !!s1, 'the TV page resized: its map frame (' + JSON.stringify(f1) + ') is reported and the live map is drawn again for it ' + JSON.stringify(s1 && [s1.displayWidth, s1.displayHeight]));
      /* the review: the frame's ask and answer are not the transcriber: fill on, the transcriber never used, the band shows no mic pill */
      const stt = await api('GET', '/gm/stt');
      check(!!(stt.json && stt.json.doc && stt.json.doc.frameWant === true && stt.json.doc.frame), 'the GM asked (frameWant) and the TV answered (frame) in the stt document');
      /* the pill depends on what it did before: the display's own idle status reports (as on a1f8d57) may show it; the frame's keys alone never do */
      const own = Object.keys((stt.json && stt.json.doc) || {}).filter((k) => k !== 'frameWant' && k !== 'frame'), on = !!(stt.json && stt.json.doc && stt.json.doc.want === 'on');
      const pill = await page.evaluate(() => { const p = document.querySelector('#gm-bar-stt'); return !!p && !p.hidden; });
      check(pill === (own.length > 0 || on), 'fill on, the transcriber not in use: the mic pill only for what showed it before (the document\'s own keys: ' + JSON.stringify(own) + ', pill ' + pill + ')');
      st = { b: await frame(DT), name: 'tv-frame' }; await page.evaluate(() => { window.__mk1.length = 0; });      /* the iPad page is closed: the TV alone */
      await DT.setViewportSize({ width: 1920, height: 1080 }); await DT.waitForTimeout(800);
      const f2 = await frameOf(DT), s2 = f2 ? await sizedTo(f2, 110000) : null;
      check(!!f2 && !!s2 && f2.w < 1920, 'back at 1920 x 1080: the stage is drawn for the real frame (' + JSON.stringify(f2) + '), not the whole TV');
      const sel2 = await page.evaluate(() => { window.B68GmPage.openView('location'); const s = document.querySelector('#gm-m-screen'); return s ? s.closest('label').textContent : ''; });
      await page.waitForTimeout(600);
      const lab2 = await page.evaluate(() => { const s = document.querySelector('#gm-m-screen'); return s ? s.closest('label').querySelector('.gm-lab').textContent : ''; });
      check(/if it stops reporting \(it reports \d+ × \d+\)/.test(lab2), 'the Shared screen select now reads as the fallback: "' + lab2 + '"');
      await settle(DT, st.b); if (SHOTS) await DT.screenshot({ path: path.join(SHOTS, 'tv-real-frame-1920x1080.png') });
      const sent = async () => (await opts(page)).filter((x) => x.layer === 'player' && x.layout === 'stage').length;
      const n0 = await sent(); await page.waitForTimeout(20000); const n1 = await sent();
      check(n1 - n0 <= 2, 'and it settles: no re-send loop with the frame unchanged (' + (n1 - n0) + ' shared-screen renders in 20 s)');
      void sel2;
    } else await DI.context().close();
    await DT.context().close();
  }
  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
} catch (e) { check(false, 'the run: ' + (e && e.stack || e)); }
clearTimeout(timeout);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
killDemo();
process.exit(failed ? 1 : 0);
