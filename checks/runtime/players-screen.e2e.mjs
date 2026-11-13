// players-screen (IP2, the players' screen: map first, behind the display setting stage.players), end to end on the demo night (scripts/demo-night.mjs:
// the real GM page, Worker and iPad on PORT, default 12050; the inspector on PORT + 20000). Invented fixtures only (the demo night's Pelican Rooms,
// the Dovetail Crew, Mabel Quist, Ada Vell; GM-ONLY- markers for anything hidden). No model, no network beyond loopback, $0.
//   off       the setting off (kit.stage off and on): today's band, plate, time label and Ways are all there; no dials; the display GET has no clocks;
//             Next landing on a public event lays its 8-second line by itself; a scene tile leaves the map up
//   on        no band, plate, time, Now/Next, ways or crew text anywhere in the display DOM (kit.stage off and on); the map frame fills the screen;
//             dials for the visible clocks only (at most four, the alarm kept), a hidden clock's name in neither the GET nor the DOM; a tick swells
//             the dial (reduced motion: a flash); Next landing on a public event shows nothing until the GM presses Send; a scene tile replaces the
//             map within a poll; Show on iPad opens the NPC's card on the GM page (the cast notes, as the demo night has no vault cards)
// DIALS_ONLY=1 runs the display part only (the WebKit pass: PW_MODULE=app/checks/pw-webkit.js PW_CORE_DIR=<playwright-core>).
// IP2_SHOTS=<dir> saves the pictures (iPad 1180x820 and 1024x768, TV 1920x1080 and 1536x864, desk 1366x768).
//   PW_MODULE=<path to playwright-core> [PW_CHANNEL=msedge] [PORT=12050] [IP2_SHOTS=<dir>] node checks/runtime/players-screen.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 12050);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const SHOTS = process.env.IP2_SHOTS || '';
const DIALS_ONLY = process.env.DIALS_ONLY === '1';
const WIN = process.platform === 'win32';
const POLL_MS = 4000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 150) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }

/* the pure parts (the dials, the GM side, the Worker join) are checks/runtime/players-screen.test.mjs, in check:runtime */

/* ============ the demo night ============ */
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
delete env.B68_ANTHROPIC_KEY; delete env.ANTHROPIC_API_KEY;
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const demo = spawn(process.execPath, [path.join(ROOT, 'scripts', 'demo-night.mjs'), '--port', String(PORT)], { cwd: ROOT, env, detached: !WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let demoLog = ''; demo.stdout.on('data', (d) => { demoLog += d; }); demo.stderr.on('data', (d) => { demoLog += d; });
function killDemo() {
  if (WIN) spawnSync('taskkill', ['/pid', String(demo.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-demo.pid, 'SIGKILL'); } catch (_) {} }
}
process.on('exit', killDemo);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j, text: t }; });
const setting = async (f) => { const a = await api('PATCH', '/gm/state', { features: f }); const b = await api('PATCH', '/campaign', { features: f }); return a.status !== 200 ? a : b; };
const displayGet = async () => (await api('GET', '/gm/display?seq=-1&aseq=-1&sseq=-1&hseq=-1', null, IPAD)).text || '';
const ambientDoc = async () => { const j = (await api('GET', '/gm/ambient')).json || {}; return j.doc || {}; };
const shownKind = async () => { const j = (await api('GET', '/gm/display')).json || {}; return j.display ? j.display.kind : ''; };
const clockOps = (ops) => api('PATCH', '/campaign', { clockOps: ops });
function engine() { return require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright').chromium; }

/* everything the players could read on the display that is not the map's own drawing: text outside every svg */
const DISPLAY_TEXT = () => {
  const out = []; const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType === 3) { const t = c.textContent.trim(); if (t) out.push(t); } else if (c.nodeType === 1 && c.tagName.toLowerCase() !== 'svg' && c.tagName !== 'IFRAME') { const cs = getComputedStyle(c); if (cs.display !== 'none' && cs.visibility !== 'hidden' && !c.hidden) walk(c); } } };
  const r = document.querySelector('.dp-root'); if (r) walk(r); return out.join(' | ');
};
const BAND_BITS = () => {
  const vis = (s) => [...document.querySelectorAll(s)].some((e) => { const r = e.getBoundingClientRect(); return !e.closest('[hidden]') && r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; });
  return { band: vis('.dp-band'), plate: vis('.ks16-bandplate, .ks16-mapfoot'), clock: vis('.stage-clock'), heads: vis('.stage-head'), strip: vis('.dp-lay-strip'), crew: vis('.dp-lay-crew, .dp-b-crew, .ks16-crew'),
    idleAlarm: vis('.ks16-idlealarm, .ks16-mapalarm'), auto: vis('.dp-auto'), bandOn: document.querySelector('.dp-root').classList.contains('dp-band-on') };
};
const DIALS = () => [...document.querySelectorAll('.p2-dials:not([hidden]) .p2-dial')].map((d) => ({ name: d.querySelector('.p2-name').textContent, filled: +d.getAttribute('data-p2-filled'), size: +d.getAttribute('data-p2-size'),
  tick: d.getAttribute('data-p2-tick') || '', alarm: d.hasAttribute('data-p2-alarm'), full: d.classList.contains('p2-full'), w: Math.round(d.querySelector('.p2-face').getBoundingClientRect().width),
  nameH: parseFloat(getComputedStyle(d.querySelector('.p2-name')).fontSize), right: Math.round(innerWidth - d.getBoundingClientRect().right), top: Math.round(d.getBoundingClientRect().top) }));

let browser = null;
try {
  const up = await until(() => /The demo night is up/.test(demoLog) || demo.exitCode !== null, 240000, 500);
  if (!up || demo.exitCode !== null) throw new Error('the demo night did not start:\n' + demoLog.slice(-2000));
  /* the table's clocks: the site alarm (hidden at first), the demo's visible marker, four more visible ones and one hidden with a GM-ONLY- name */
  const add = (id, name, size, filled, hidden) => ({ add: { id, name, size, filled, kind: 'other', hidden: !!hidden } });
  const r0 = await clockOps([add('c-look', 'Lookouts', 4, 1), add('c-crowd', 'The crowd turns', 4, 0), add('c-fuse', 'The fuse', 8, 2), add('c-hid', 'GM-ONLY-CLOCK-1', 4, 1, true)]);
  check(r0.status === 200, 'the table clocks: five visible, two hidden (the alarm and a GM-ONLY- one) ' + r0.status);

  browser = await engine().launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  let G = null, page = null;
  if (!DIALS_ONLY) {
    G = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
    await G.route('**/api/gm/assist/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cards: [], updates: [], flags: [], asks: [], marked: 1 }) }));
    page = await G.newPage();
    page.on('pageerror', (e) => errors.push('gm: ' + e.message));
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    /* the Score phase, the player map on the iPad (as the GM does it), then the Run view */
    await page.waitForSelector('#gm-band [data-band-place="score"]', { timeout: 15000 });
    if (await page.$eval('#gm-band [data-band-place="score"]', (e) => e.getAttribute('data-state') !== 'now')) await page.click('#gm-band [data-band-place="score"]');
    await page.waitForTimeout(600);
    await page.keyboard.press('b');
    await page.waitForSelector('#gm-loc [data-gm="layer"][data-v="player"]', { timeout: 20000 });
    await page.click('#gm-loc [data-gm="layer"][data-v="player"]');
    await page.waitForSelector('#gm-loc [data-gm="ipad"]:not([disabled])', { timeout: 10000 });
    await page.click('#gm-loc [data-gm="ipad"]');
    check(!!(await until(async () => (await shownKind()) === 'svg', 10000)), 'the player map is on the iPad');
    await page.keyboard.press('g'); await page.waitForSelector('.rv-head', { timeout: 15000 });
    await page.click('[data-rv="next"]').catch(() => {}); await page.waitForTimeout(1200);
    await page.click('[data-rv="back"]').catch(() => {}); await page.waitForTimeout(2000);
  } else {
    await api('PUT', '/gm/display', { kind: 'svg', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#e8dfcc"/><text x="20" y="40">The Showroom</text></svg>', title: 'The Pelican Rooms' });
    /* the HUD as the GM page would publish it (no GM page in this pass) */
    await api('PATCH', '/campaign', { mission: { v: 1, site: 'The Pelican Rooms', t: 60, seq: 99, hud: { time: '21:45', showTime: true, label: 'Gala night', now: [{ text: 'The speeches', where: 'Showroom' }],
      next: [{ text: 'The fireworks', at: '00:00', inMin: 135 }], crew: [{ name: 'Nell Arbuthnot', room: 'Cocktail lounge' }, { name: 'Ray Okonjo', room: 'Showroom' }], ways: { found: 1, total: 2 },
      alarm: { name: 'Alarm', size: 6, filled: 2, text: 'Someone is looking' } } } });
  }
  check(/"hud":\{/.test(await displayGet()),'the GM page published the players\' HUD (the band\'s data)');

  /* the iPad */
  const D = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1180, height: 820 }, serviceWorkers: 'block' });
  await D.addInitScript(() => { try { localStorage.setItem('b68.display.hint', '1'); } catch (e) { /* no storage */ } });
  const ipad = await D.newPage();
  const outside = [];
  ipad.on('request', (q) => { if (!q.url().startsWith(BASE) && !q.url().startsWith('data:')) outside.push(q.url()); });
  ipad.on('pageerror', (e) => { if (!/ResizeObserver loop/.test(e.message)) errors.push('ipad: ' + e.message); });      /* WebKit reports the benign ResizeObserver loop note as an error */
  await ipad.goto(BASE + '/');
  await ipad.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 20000 });
  await ipad.waitForSelector('.dp-stage.dp-map', { timeout: 20000 });
  const shot = async (name, sizes) => {
    if (!SHOTS) return; mkdirSync(SHOTS, { recursive: true });
    for (const [w, h] of sizes) { await ipad.setViewportSize({ width: w, height: h }); await sleep(700); await ipad.screenshot({ path: path.join(SHOTS, name + '-' + w + '.png') }); }
    await ipad.setViewportSize({ width: 1180, height: 820 }); await sleep(300);
  };
  const SIZES = [[1180, 820], [1024, 768], [1920, 1080], [1536, 864]];

  // ============ off: today ============
  for (const kit of [false, true]) {
    await setting({ 'stage.players': false, 'kit.stage': kit });
    const tag = kit ? ' (kit.stage on)' : ' (kit.stage off)';
    const b = await until(async () => { const x = await ipad.evaluate(BAND_BITS); return (kit ? x.plate : x.band) ? x : null; }, 15000);
    check(!!b, 'off' + tag + ': today\'s band beside the map is there: ' + JSON.stringify(b));
    const t = await ipad.evaluate(DISPLAY_TEXT);
    check(/Gala night/.test(t), 'off' + tag + ': the clock label ("Gala night") reads as today: ' + t.slice(0, 160));
    check(await ipad.evaluate((k) => !!document.querySelector('.ks16-bandrow') || /Ways found/.test((document.querySelector(k ? '.ks16-bandplate' : '.dp-band') || {}).textContent || ''), kit), 'off' + tag + ': "Ways found" is in the band as today (the old band may cut it for room; under a captioned drawing the plate is one row without it)');
    check((await ipad.$$('.p2-dials')).length === 0, 'off' + tag + ': no dials');
    if (!kit) await shot('off-map', [[1180, 820]]);
  }
  check(!/"clocks"/.test(await displayGet()), 'off: the display GET carries no clocks list');
  if (!DIALS_ONLY) {
    /* Next lands on a public event: today the 8-second line goes up by itself */
    await api('PATCH', '/gm/ambient', { overlay: null });
    await page.click('[data-rv="next"]'); await sleep(300);
    const o1 = await until(async () => { const o = (await ambientDoc()).overlay; return o && o.kind === 'text' ? o : null; }, 6000);
    check(!!o1 && /speeches/i.test(o1.text || ''), 'off: Next onto the public event lays its line by itself (today): ' + JSON.stringify(o1 && o1.text));
    await page.click('[data-rv="back"]'); await sleep(1200); await api('PATCH', '/gm/ambient', { overlay: null });
    /* a scene tile leaves the map up (today) */
    await page.click('.gm-tray [data-tray="open"]'); await page.waitForSelector('#gm-ipad-settings [data-set-row]', { timeout: 10000 });
    await page.click('[data-gm="ambscene"][data-id="tram"]'); await sleep(2500);
    check((await shownKind()) === 'svg', 'off: a scene tile leaves the map up (today: Clear first)');
    check(!!(await page.$('#gm-ipad-settings [data-set-row="stage.players"]')), 'the Settings have the Players\' screen row');
    await page.keyboard.press('g'); await page.waitForSelector('.rv-head', { timeout: 15000 });
  }

  // ============ on ============
  await setting({ 'stage.players': true, 'kit.stage': false });
  if (page) await page.reload().then(() => page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 })).then(async () => { await page.keyboard.press('g'); await page.waitForSelector('.rv-head', { timeout: 15000 }); });
  const d1 = await until(async () => { const d = await ipad.evaluate(DIALS); return d.length ? d : null; }, 15000);
  check(!!d1, 'on: the dials are up: ' + JSON.stringify(d1 && d1.map((d) => d.name)));
  for (const kit of [false, true]) {
    if (kit) { await setting({ 'stage.players': true, 'kit.stage': true }); await until(() => ipad.evaluate(() => !!document.querySelector('.dp-root .stage-frame')), 15000); await sleep(POLL_MS + 500); }
    const tag = kit ? ' (kit.stage on)' : ' (kit.stage off)';
    await sleep(1200);      /* a stage on its way out (750 ms) still carries what it showed */
    const b = await ipad.evaluate(BAND_BITS);
    check(!b.band && !b.plate && !b.clock && !b.heads && !b.strip && !b.crew && !b.idleAlarm && !b.bandOn, 'on' + tag + ': no band, plate, clock, crew heads, strip, docked alarm: ' + JSON.stringify(b));
    check(!b.auto, 'on' + tag + ': no AUTO mark');
    const t = (await ipad.evaluate(DISPLAY_TEXT)).replace(/Updated \d{1,2}:\d\d/, 'Updated');      /* the connection line's wall clock, not the night's */
    const bad = ['Gala night', 'Ways found', 'Nell Arbuthnot', 'Ray Okonjo', 'Tam Petrakis', 'GM-ONLY'].filter((w) => t.indexOf(w) >= 0).concat(/\bNow\b|\bNext\b|\bThen\b/.test(t) ? ['Now/Next'] : []).concat(/\b\d{1,2}:\d\d\b/.test(t) ? ['a time'] : []);
    check(bad.length === 0, 'on' + tag + ': none of the time, label, Now/Next, ways or crew in the display DOM: ' + (bad.join(', ') || 'clean') + ' | ' + t.slice(0, 200));
    const fr = await ipad.evaluate(() => { const m = document.querySelector('.dp-stage.dp-map'), r = m && m.getBoundingClientRect(); return r ? { l: r.left, t: r.top, r: innerWidth - r.right, b: innerHeight - r.bottom } : null; });
    check(!!fr && Math.max(Math.abs(fr.l), Math.abs(fr.t), Math.abs(fr.r), Math.abs(fr.b)) <= 1, 'on' + tag + ': the map frame reaches every edge: ' + JSON.stringify(fr));
    const ds = await ipad.evaluate(DIALS);
    check(ds.length === 4 && !ds.some((d) => /GM-ONLY/.test(d.name)) && !ds.some((d) => d.name === 'House alarm'), 'on' + tag + ': four dials, the visible clocks only (the hidden alarm and the GM-ONLY- one never): ' + ds.map((d) => d.name).join(', '));
    const H = await ipad.evaluate(() => innerHeight);
    check(ds.every((d) => d.w >= 0.085 * H && d.nameH >= 0.022 * H - 0.05 && d.top <= 0.05 * H) && ds[0].right <= 0.05 * 1180, 'on' + tag + ': top right, a dial about 9vh across, its name at least 2.2vh: ' + JSON.stringify(ds.map((d) => [d.w, d.nameH.toFixed(1), d.right, d.top])));
    await shot('on-map' + (kit ? '-kit' : ''), SIZES);
    if (SHOTS) await ipad.locator('.p2-dials').screenshot({ path: path.join(SHOTS, 'dials' + (kit ? '-kit' : '') + '-1180.png') });
    if (!kit) { await sleep(800); const run = await ipad.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.p2-dials')).length); check(run === 0, 'on: nothing moves on the dials when nothing changed'); }
  }
  const g1 = await displayGet();
  check(/"clocks"/.test(g1) && !/GM-ONLY-CLOCK/.test(g1) && !/House alarm/.test(g1), 'on: the display GET serves the visible clocks only (no hidden name)');

  /* the alarm made visible: kept among the four, drawn in the alarm colour */
  await clockOps([{ id: 'c-alarm', hidden: false }]);
  const d2 = await until(async () => { const d = await ipad.evaluate(DIALS); return d.some((x) => x.name === 'House alarm' && x.alarm) ? d : null; }, 40000);
  if (!d2) console.log('DEBUG alarm: ' + ((await displayGet()).match(/.alarm.:{[^}]*}/) || ['none'])[0] + ' dials ' + JSON.stringify(await ipad.evaluate(DIALS)));
  check(!!d2 && d2.length === 4 && d2.find((x) => x.name === 'House alarm').alarm, 'the alarm clock, once visible, is among the four and marked: ' + JSON.stringify(d2 && d2.map((x) => x.name)));

  /* a tick: the dial swells, its new segments in the alarm colour; a hidden clock's tick moves nothing */
  const swellSeen = async (name) => until(() => ipad.evaluate((n) => { const d = [...document.querySelectorAll('.p2-dial')].find((x) => x.querySelector('.p2-name').textContent === n); return d && d.getAttribute('data-p2-tick') ? { tick: d.getAttribute('data-p2-tick'), fresh: d.querySelectorAll('.p2-new').length, first: d === d.parentNode.firstElementChild } : null; }, name), POLL_MS * 3, 60);
  await clockOps([{ id: 'c-look', filled: 3 }]);
  const s1 = await swellSeen('Lookouts');
  if (!s1) console.log('DEBUG no swell: ' + JSON.stringify(await ipad.evaluate(() => ({ dials: [...document.querySelectorAll('.p2-dial')].map((d) => d.querySelector('.p2-name').textContent + ':' + d.getAttribute('data-p2-filled')), hidden: (document.querySelector('.p2-dials') || {}).hidden, cls: document.querySelector('.dp-root').className, kind: (document.querySelector('.dp-stage.dp-in') || {}).className }))));
  check(!!s1 && s1.tick === 'swell' && s1.fresh === 2 && s1.first, 'a tick swells the dial, two new segments in the alarm colour, and it moves to the corner: ' + JSON.stringify(s1));
  if (SHOTS) { await sleep(350); await ipad.screenshot({ path: path.join(SHOTS, 'tick-swell-1180.png') }); }
  await sleep(1800);
  check(!(await ipad.evaluate(() => !!document.querySelector('.p2-dial[data-p2-tick]'))), 'the swell settles back after 1.6 s');
  await clockOps([{ id: 'c-hid', filled: 3 }]);
  await sleep(POLL_MS + 1500);
  check(!(await ipad.evaluate(() => !!document.querySelector('.p2-dial[data-p2-tick]'))) && !(await ipad.evaluate(DISPLAY_TEXT)).includes('GM-ONLY'), 'a hidden clock\'s tick moves nothing and names nothing');
  await clockOps([{ id: 'c-fuse', filled: 8 }]);
  const s2 = await swellSeen('The fuse'); await sleep(1900);
  const full = (await ipad.evaluate(DIALS)).find((d) => d.name === 'The fuse');
  check(!!s2 && !!full && full.full, 'a filled clock stays, drawn full in the alarm colour');
  await ipad.emulateMedia({ reducedMotion: 'reduce' });
  await clockOps([{ id: 'c-crowd', filled: 1 }]);
  const s3 = await swellSeen('The crowd turns');
  check(!!s3 && s3.tick === 'flash', 'reduced motion: no swell, the new segment flashes: ' + JSON.stringify(s3));
  await ipad.emulateMedia({ reducedMotion: 'no-preference' });

  /* not over Blank */
  await api('PUT', '/gm/display', { kind: 'dark' });
  check(!!(await until(() => ipad.evaluate(() => { const e = document.querySelector('.p2-dials'); return !!e && e.hidden; }), POLL_MS * 3)), 'the dials stand down under Blank');

  if (!DIALS_ONLY) {
    await page.click('[data-gm="pushmap"]').catch(() => {});
    await api('PUT', '/gm/display', { kind: 'blank' });
    /* the map back on, from the GM page as before */
    await page.keyboard.press('b');
    await page.waitForSelector('#gm-loc [data-gm="ipad"]:not([disabled])', { timeout: 10000 });
    await page.click('#gm-loc [data-gm="ipad"]');
    check(!!(await until(async () => (await shownKind()) === 'svg', 10000)), 'the map is on the iPad again');
    await page.keyboard.press('g'); await page.waitForSelector('.rv-head', { timeout: 15000 });
    /* Next onto the public event: nothing on the iPad until Send */
    await api('PATCH', '/gm/ambient', { overlay: null });
    await page.click('[data-rv="next"]');
    const offer = await until(() => page.evaluate(() => { const o = document.querySelector('#gm-offer'); return o ? o.textContent : ''; }), 6000);
    check(/speeches/i.test(offer) && /Send/.test(offer), 'on: Next onto the public event offers the line with Send: ' + offer);
    await sleep(2500);
    check(!(await ambientDoc()).overlay, 'on: nothing goes to the iPad by itself (2.5 s after the beat, past the publish)');
    check(!!(await page.$('#gm-offer')), 'on: the offer outlives the publish that follows the beat');
    await page.click('#gm-offer [data-gm="offer-go"]');
    const o2 = await until(async () => { const o = (await ambientDoc()).overlay; return o && o.kind === 'text' ? o : null; }, 6000);
    check(!!o2 && /speeches/i.test(o2.text || ''), 'on: Send shows the line');
    await page.click('[data-rv="back"]'); await sleep(800); await api('PATCH', '/gm/ambient', { overlay: null });

    /* a scene tile replaces the map */
    await page.click('.gm-tray [data-tray="open"]'); await page.waitForSelector('#gm-ipad-settings [data-set-row]', { timeout: 10000 });
    const apWhy = await page.evaluate(() => { const l = document.querySelector('#gm-ipad-ap'); return l && !l.hidden ? l.textContent : '(no autopilot row)'; });
    check(/Map first: you send NPCs/.test(apWhy) || apWhy === '(no autopilot row)', 'on: the Autopilot row says why: ' + apWhy);
    const t0 = Date.now();
    await page.click('[data-gm="ambscene"][data-id="duskwall"]');
    const swapped = await until(() => ipad.evaluate(() => !document.querySelector('.dp-stage.dp-map.dp-in') && [...document.querySelectorAll('.dp-ambient iframe')].some((f) => /duskwall/.test(f.src))), POLL_MS * 3, 100);
    check(!!swapped && (await shownKind()) === 'blank', 'on: a scene tile takes the map down and the scene plays (' + (Date.now() - t0) + ' ms; the poll is ' + POLL_MS + ' ms)');
    await shot('on-scene', [[1180, 820]]);
    const before = (await api('GET', '/gm/display')).json.seq;
    await page.click('[data-gm="ambscene"][data-id="duskwall"]'); await sleep(1200);
    check((await api('GET', '/gm/display')).json.seq === before, 'on: re-picking the scene that is up changes nothing');

    /* Show on iPad opens the NPC's card on the GM page (the demo night has no vault cards: the cast notes, Tell: and Signature: first) */
    await page.keyboard.press('n'); await page.waitForSelector('#gm-npc [data-gm="npcipad"][data-id="npc-ada"]', { timeout: 15000 });
    await page.click('#gm-npc [data-gm="npcipad"][data-id="npc-ada"]');
    const card = await until(() => page.evaluate(() => { const c = document.querySelector('#gm-npc .gm-castcard'); return c ? c.textContent : ''; }), 8000);
    check(/Tell:/.test(card) && /Signature:/.test(card), 'on: Show on iPad opens the NPC\'s card on the GM page (Tell:, Signature:): ' + card.slice(0, 120));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'gm-npc-card-1366.png') });
    await until(async () => (await shownKind()) === 'npc', 6000);
    /* not while typing */
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'ip2-typing'; document.body.appendChild(i); i.focus(); });
    await page.evaluate(() => { const b = document.querySelector('#gm-npc [data-gm="npcintro"][data-id="npc-dov"]'); if (b) b.click(); });
    await sleep(800);
    check(await page.evaluate(() => document.activeElement && document.activeElement.id === 'ip2-typing'), 'on: Introduce while the GM types: the field keeps the focus');
    await page.evaluate(() => { const i = document.getElementById('ip2-typing'); if (i) { i.blur(); i.remove(); } });
    /* a held spotlight from the Run view's room card opens the card beside the right column */
    await page.keyboard.press('g'); await page.waitForSelector('.rv-head', { timeout: 15000 });
    const board = await page.$('[data-rv="view"][data-v="board"][aria-pressed="false"]'); if (board) await board.click();
    await page.waitForSelector('.rv-card[data-room="Showroom"]', { timeout: 15000 });
    await page.click('.rv-card[data-room="Showroom"] .rv-cn'); await page.waitForSelector('.rv-rm.sel[data-room="Showroom"]', { timeout: 8000 });
    await page.click('.rv-rm.sel .rv-p[data-pid="npc-mabel"] [data-site="spot"]');
    const pop = await until(() => page.evaluate(() => { const p = document.querySelector('.rv-npcpop'); return p ? p.textContent : ''; }), 8000);
    check(/Mabel Quist/.test(pop) && /Tell:/.test(pop), 'on: a held spotlight opens the NPC\'s card in the Run view: ' + pop.slice(0, 80));
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'gm-run-card-1366.png') });
    await page.click('.rv-npcpop [data-rv="npcx"]').catch(() => {});
    await sleep(2500);
    check(!(await page.$('.rv-npcpop')), 'on: the card stays closed once the GM closes it while the spotlight is held');
  }

  check(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  check(outside.length === 0, 'the iPad made no request outside its origin: ' + outside.slice(0, 3).join(', '));
} catch (e) {
  check(false, 'the run: ' + (e && e.stack || e));
} finally {
  if (browser) await browser.close().catch(() => {});
  try { await setting({ 'stage.players': false, 'kit.stage': false }); } catch (_) { /* the server is going anyway */ }
  killDemo();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
