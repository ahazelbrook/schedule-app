// THE iPAD FOLLOWS THE GM (tech run 06/11, items T2-T5) on the real GM page and the real display page, signed in as the table's own display login
// (role display, which cannot read the cast), against the demo night (scripts/demo-night.mjs: the invented Pelican Rooms, Mabel Quist and Dov Kessler revealed,
// GM-ONLY- people hidden). With an ambient scene PINNED, as on the night:
//   - the site's Spotlight puts the person on the iPad over the pinned scene (the display DOM, not just the stored overlay), Take it down goes back to the scene;
//   - with the iPad blank (lights out, the last thing pressed on the night), Introduce shows, and the SAME Introduce shows again after the first has gone (T4);
//   - the Cast view's Show on iPad draws the person on the display sign-in (it drew "Not found": the server now joins a revealed NPC to the display it serves),
//     and a pushed HIDDEN person is never joined, so nothing GM-only reaches the display GET or the iPad's DOM (T3);
//   - entering the Score puts the players' map on the iPad by itself, and the site's toolbar has Show on iPad / Take it down (T5); the map is the player
//     layer only: nothing GM-only in the display GET or the DOM.
// Screenshots (GM_SHOTS=<dir>): ipad-spotlight-pinned-1024.png, ipad-map-score-1024.png, site-show-on-ipad-1366.png. No model, $0. Every name is invented.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9310] [GM_SHOTS=<dir>] [PW_DISPLAY_ENGINE=webkit] node checks/runtime/ipad-follows.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9310);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const SHOTS = process.env.GM_SHOTS || '';
const PW = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright'), { chromium } = PW;
const DISPLAY_ENGINE = process.env.PW_DISPLAY_ENGINE === 'webkit' ? 'webkit' : 'chromium';      /* PW_DISPLAY_ENGINE=webkit: the iPad page in WebKit (Safari's engine), the GM page as ever */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 150) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j, text: t }; });
const displayGet = async () => (await api('GET', '/gm/display', undefined, IPAD)).text;

if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const demo = spawn(process.execPath, [path.join(ROOT, 'scripts', 'demo-night.mjs'), '--port', String(PORT)], { cwd: ROOT, env: { ...process.env, B68_ANTHROPIC_KEY: '', ANTHROPIC_API_KEY: '' }, detached: !WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let demoOut = '';
demo.stdout.on('data', (d) => { demoOut += d; }); demo.stderr.on('data', (d) => { demoOut += d; });
function killDemo() {
  if (WIN) spawnSync('taskkill', ['/pid', String(demo.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-demo.pid, 'SIGKILL'); } catch (_) {} }
}
process.on('exit', killDemo);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + demoOut.slice(-1500)); process.exit(1); }, 420000);

try {
  const up = await until(() => /The demo night is up/.test(demoOut), 240000, 500);
  if (!up) throw new Error('the demo night did not start:\n' + demoOut.slice(-1500));
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };

  /* the night's state: a scene pinned, nothing spotlit */
  check((await api('PATCH', '/gm/ambient', { mode: 'pin', scene: 'wanted', overlay: null })).status === 200, 'an ambient scene is pinned (as on the night)');
  check((await api('PUT', '/gm/display', { kind: 'blank' })).status === 200, 'nothing is on the iPad: the pinned scene plays');

  /* the iPad: the display page, signed in as the table's display login */
  const dbrowser = DISPLAY_ENGINE === 'webkit' ? await PW.webkit.launch() : browser;
  console.log('INFO the iPad page runs in ' + DISPLAY_ENGINE);
  const dc = await dbrowser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1024, height: 768 }, serviceWorkers: 'block' });
  const dp = await dc.newPage();
  dp.on('pageerror', (e) => errors.push('display: ' + e.message));
  await dp.goto(BASE + '/#display');
  const amb = () => dp.evaluate(() => (window.B68DisplayPage && window.B68DisplayPage.ambient.state()) || null);
  check(!!(await until(async () => { const a = await amb(); return a && a.active === 'wanted' && !a.covered; }, 20000)), 'the iPad plays the pinned scene');
  const ovText = () => dp.evaluate(() => [...document.querySelectorAll('.dp-overlay > *')].filter((e) => !e.classList.contains('dp-ov-out')).map((e) => (e.querySelector('.dp-ov-name') || e).textContent).join(' | '));
  const stageEl = () => dp.evaluate(() => { const e = [...document.querySelectorAll('.dp-stages > .dp-stage')].pop(); return e ? { cls: e.className, text: e.textContent } : null; });
  const domLeak = async () => /GM-ONLY/.test(await dp.evaluate(() => document.body.innerHTML));

  /* the GM laptop, in the Score place, the site open on the room Mabel Quist is in */
  const gc = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
  await gc.addInitScript(atPlace('score'));
  const gp = await gc.newPage();
  gp.on('pageerror', (e) => errors.push('gm: ' + e.message));
  gp.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text()) && !/127\.0\.0\.1:9300\/light/.test(m.text())) errors.push('gm: ' + m.text()); });      /* the room light's local bridge (gm/light.js, 127.0.0.1:9300) is not part of this check */
  gp.on('dialog', (d) => d.accept());
  await gp.goto(BASE + '/#gm');
  await gp.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
  await gp.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  await gp.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await gp.keyboard.press('g');
  await gp.waitForSelector('.rv-card[data-room="Luxury penthouse"]', { timeout: 20000 });
  await gp.click('.rv-card[data-room="Luxury penthouse"] .rv-cn');
  await gp.waitForSelector('.rv-rm.sel .rv-p[data-pid="npc-mabel"] [data-site="spot"]', { timeout: 10000 });

  /* ---- T3/T4: Spotlight over the pinned scene ---- */
  await gp.click('.rv-rm.sel .rv-p[data-pid="npc-mabel"] [data-site="spot"]');
  check(!!(await until(async () => /Mabel Quist/.test(await ovText()), 6000)), 'Spotlight: the iPad DOM shows Mabel Quist within the poll (' + (await ovText()).slice(0, 60) + ')');
  check(await dp.evaluate(() => !!document.querySelector('.dp-overlay .dp-ov-npc')), 'as the held face card');
  { const a = await amb(); check(a.active === 'wanted' && !a.covered, 'over the pinned scene, which keeps playing under it'); }
  await sleep(700); await shot(dp, 'ipad-spotlight-pinned-1024');
  await gp.click('.rv-rm.sel [data-site="down"]');
  check(!!(await until(async () => !/Mabel Quist/.test(await ovText()), 6000)), 'Take it down: the face goes');
  { const a = await amb(); check(a.active === 'wanted' && !a.covered, 'and the pinned scene is what is there'); }

  /* ---- T4: Introduce while the iPad is blank (lights out), twice ---- */
  check((await api('PUT', '/gm/display', { kind: 'dark' })).status === 200, 'the iPad goes black (Blank)');
  check(!!(await until(() => dp.evaluate(() => document.querySelector('.dp-root').classList.contains('dp-lights-out')), 8000)), 'the display is in lights out');
  const intro = '.rv-rm.sel .rv-p[data-pid="npc-mabel"] [data-site="intro"]';
  await gp.click(intro);
  check(!!(await until(async () => /Mabel Quist/.test(await ovText()), 6000)), 'Introduce in the dark: her card shows');
  check((await api('PATCH', '/gm/ambient', { overlay: null })).status === 200, 'the beat comes down (as when it runs out, or Clear)');
  check(!!(await until(async () => !(await ovText()), 6000)), 'the iPad drops it');
  await sleep(600);
  await gp.click(intro);
  check(!!(await until(async () => /Mabel Quist/.test(await ovText()), 6000)), 'Introduce the same person again, still in the dark: it shows again (it was kept off as "already seen")');
  await api('PATCH', '/gm/ambient', { overlay: null });
  check((await api('PUT', '/gm/display', { kind: 'blank' })).status === 200, 'lights back on');

  /* ---- T3: the Cast view's Show on iPad, on the display sign-in ---- */
  await gp.keyboard.press('n');
  await gp.waitForSelector('#gm-npc .gm-npcrow[data-id="npc-dov"] [data-gm="npcipad"]', { timeout: 15000 });
  await gp.click('#gm-npc .gm-npcrow[data-id="npc-dov"] [data-gm="npcipad"]');
  const dov = await until(async () => { const s = await stageEl(); return s && /dp-npc/.test(s.cls) ? s : null; }, 8000);
  check(!!dov && !/dp-npc-missing/.test(dov.cls) && /Dov Kessler/.test(dov.text) && !/Not found/.test(dov.text), 'Cast > Show on iPad: the iPad (display login) draws Dov Kessler, not "Not found" (' + (dov ? dov.cls + ' ' + dov.text.slice(0, 50) : 'nothing') + ')');
  const dg = JSON.parse(await displayGet());
  check(dg.display && dg.display.npc && dg.display.npc.name === 'Dov Kessler' && !('gmNotes' in dg.display.npc) && !('tags' in dg.display.npc), 'the display GET carries his player view only (no GM notes, no tags)');
  /* a HIDDEN person pushed as the display is never joined */
  check((await api('PUT', '/gm/display', { kind: 'npc', npcId: 'npc-hidden-partner', title: 'Someone' })).status === 200, 'a hidden person pushed straight to the display (no page asks first)');
  await sleep(2500);
  const hidGet = await displayGet();
  check(!/GM-ONLY/.test(hidGet) && !/"npc":\{/.test(hidGet), 'secrecy: the display GET joins nothing of a hidden person');
  check(!(await domLeak()), 'secrecy: nothing GM-only in the iPad DOM');
  check((await api('PUT', '/gm/display', { kind: 'blank' })).status === 200, 'taken down');

  /* ---- T5: the Score puts the players' map up; the site's Show on iPad / Take it down ---- */
  await until(async () => { const s = await stageEl(); return s && /dp-blank/.test(s.cls); }, 8000);
  await gp.click('[data-band-place="score"]');
  const map = await until(async () => { const s = await stageEl(); return s && /dp-map/.test(s.cls) ? s : null; }, 10000);
  check(!!map, 'entering the Score puts the players’ map on the iPad by itself (' + (map ? map.cls : JSON.stringify(await stageEl())) + ')');
  const mg = await displayGet();
  check(/"kind":"svg"/.test(mg) && !/GM-ONLY/.test(mg), 'it is a map, and the display GET holds nothing GM-only');
  check(!(await domLeak()), 'and neither does the iPad DOM');
  await sleep(900); await shot(dp, 'ipad-map-score-1024');
  await gp.keyboard.press('g');
  await gp.waitForSelector('.rv-tools', { timeout: 10000 });
  check(!!(await until(() => gp.$('.rv-tools [data-site="ipad-down"]'), 6000)), 'the site’s toolbar offers Take it down while the map is up');
  await gp.click('.rv-tools [data-site="ipad-down"]');
  check(!!(await until(async () => { const s = await stageEl(); return s && /dp-blank/.test(s.cls); }, 8000)), 'Take it down: the map comes off');
  check(!!(await until(() => gp.$('.rv-tools [data-site="ipad"]'), 6000)), 'and the toolbar offers Show on iPad');
  await gp.mouse.move(1, 1); await shot(gp, 'site-show-on-ipad-1366');
  await gp.click('.rv-tools [data-site="ipad"]');
  check(!!(await until(async () => { const s = await stageEl(); return s && /dp-map/.test(s.cls); }, 8000)), 'Show on iPad: the players’ map is back on the iPad');
  check(/LIVE/.test(await gp.textContent('.rv-tools')), 'and the site says it is LIVE, so Seen + Send update it');
  check(!errors.length, 'no page errors: ' + errors.slice(0, 3).join(' | '));
  if (dbrowser !== browser) await dbrowser.close();
  await browser.close();
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
clearTimeout(timeout);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
