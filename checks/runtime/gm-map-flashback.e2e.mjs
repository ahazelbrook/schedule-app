// The flashback filter on the map (suite 2.9, switch map.flashback; app/gm/map-flashback.js, app/display/layers.js, app/display/shows.css) in a real browser against a real local Worker, an invented site
// (the Pelican Rooms) and the table iPad signed in as the display role. Everything built is on (N0): with nothing stored the buttons are there and the iPad's filter layer comes with the grain and caption; a stored false changes nothing. The Flashback button sets the
// scene.filter layer, the GM map goes sepia, the iPad gains the grain and the "Earlier" caption, a Pin sits on the crew's room (GM page only), and a tap on Back clears it all.
//   PW_MODULE=<playwright install> PW_CHANNEL=msedge [PORT=9072] node checks/runtime/gm-map-flashback.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9072);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const SHOTS = process.env.GM_SHOTS || '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const BALL = require(path.join(ROOT, 'app', 'gm', 'ball.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const conFix = JSON.parse(readFileSync(path.join(FIX, 'console-pack.json'), 'utf8'));
const locFix = JSON.parse(readFileSync(path.join(FIX, 'location-pack.json'), 'utf8'));
const V2 = JSON.parse(readFileSync(path.join(FIX, 'pelican-play-v2.json'), 'utf8'));
const NOW = new Date().toISOString();

const NAME2 = 'The Pelican Rooms', NAME1 = 'The Brass Anchor';
const ROOMS = [
  { name: 'Showroom', band: 'public', detail: 'Chairs.' }, { name: 'Cocktail lounge', band: 'public', detail: 'Glass.' },
  { name: 'Security control room', band: 'working', detail: 'Screens.' }, { name: 'Private card rooms', band: 'controlled', detail: 'Cards.' },
  { name: 'Underground counting room', band: 'working', detail: 'Coins.' }, { name: 'Luxury penthouse', band: 'secure', isTarget: true, detail: 'The strongbox.' }];
const PLAY1 = {
  v: 1, clock: { start: '21:00', end: '02:00', label: 'Gala night' }, floors: { '-1': 'Under', '0': 'Ground', '1': 'Upper', '2': 'Loft' },
  routes: [{ id: 'lift', from: 'Cocktail lounge', to: 'Luxury penthouse', via: 'the service lift', dir: 'up', needs: 'a key', watched: true }],
  people: [{ id: 'od', label: 'Odette Marsh', kind: 'target', stops: [{ at: '21:00', room: 'Showroom' }, { at: '23:30', room: 'Private card rooms', note: 'cards' }] }],
  disguises: [{ id: 'cook', label: 'Cook', floors: [-1], sees: 'Odette Marsh' }], events: [{ at: '22:00', id: 'sp', label: 'Speeches' }], clocks: [{ name: 'Fuse', room: 'Security control room' }],
};
const roomNames = ROOMS.map((r) => r.name);
const c1 = BALL.checkPlay(PLAY1, roomNames), c2 = BALL.checkPlay(V2, roomNames);
if (c1.warnings.length || c2.warnings.length) { console.log('FAIL the fixture plays have warnings: ' + c1.warnings.concat(c2.warnings).join(' | ')); process.exit(1); }
const site = (name, play) => ({ name, rel: 'x', map: { view: 'iso', theme: 'rulebook' }, patch: { district: 'Nowhere Ward', rooms: ROOMS }, play });
const PARTS = {
  console: conFix.parts.console, campaign: { ...conFix.parts.campaign, src: { ...conFix.parts.campaign.src, exportedAt: NOW }, cards: { 'Pip Quill': '# Pip Quill\n\nPIPCARD-BODY a nervous cook.\n\n> [!quote] SAY\n> Not the lounge, please.' } },
  prep: { src: { file: 'fixture/prep', exportedAt: NOW }, vault: 'Fixture', links: { 'pip quill': { k: 'npc', name: 'Pip Quill', rel: 'NPCs/Pip Quill.md' } },
    notes: [{ id: 'n-gala', rel: 'Sessions/gala.md', title: 'Gala prep', blocks: [{ k: 'md', src: '# Gala prep\n\n## Rooms\n\n### Cocktail lounge\n- **Costume:** Brocade jackets.\nLOUNGE-NOTE-BODY the bar runs the length of the room, see [[Pip Quill]].\n\n> [!quote] SAY\n> Mind the glass.\n\n- 21:45 the cook slips out · 22:00 the speeches start · 22:15 the raffle · 22:30 supper · 22:45 the band · 23:00 last call\n' }] }] },
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: NOW }, T: locFix.T, extra: locFix.extra,
    authored: { v: 1, sites: { [NAME2]: site(NAME2, c2.play), [NAME1]: site(NAME1, c1.play) }, bind: {} } },
};

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-b19-flash-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use: stop what is on it, or set PORT'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'DISPLAY_EMAILS:' + IPAD], { cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
function killServer() { if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} } }
process.on('exit', () => { killServer(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 420000);
const api = (method, p, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const gmState = async () => (await api('GET', '/gm/state')).json.doc;
const ball = async () => (await gmState()).ball;
const seqNow = async () => (await api('GET', '/gm/display')).json.seq;


try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src || {}, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  const CREW = { name: 'The Lamplighters', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] };
  check((await api('PUT', '/campaign', { v: 1, session: { number: 1, startedAt: NOW, endedAt: null }, crew: CREW, clocks: [{ id: 'c_fuse', name: 'Fuse', size: 6, filled: 2, kind: 'danger', hidden: true }], log: [] })).status === 200, 'the table is set');
  const ambientDoc = async () => { const j = (await api('GET', '/gm/ambient')).json || {}; return j.doc || (j.ambient && j.ambient.doc) || {}; };
  const filterNow = async () => { const d = await ambientDoc(); return (d.layers && d.layers.scene && d.layers.scene.filter) || null; };
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(run = true, w = 1366, h = 900) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w, height: h }, serviceWorkers: 'block' });
    await c.addInitScript(atPlace('score'));      /* N1b: start in the Score (a page with no phase opens in Before) */
    await c.addInitScript(() => { window.__B68_POLL_MS = 700; });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    if (!run) return { c, page };
    await page.keyboard.press('b');
    await page.keyboard.press('g');
    await page.waitForSelector('.rv-head', { timeout: 20000 });
    await page.click('[data-rv="view"][data-v="map"]');
    await page.waitForSelector('#rv-map svg', { timeout: 20000 });
    return { c, page };
  }
  async function openDisplay() {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1366, height: 1024 } });
    await c.addInitScript(atPlace('score'));      /* N1b: start in the Score (a page with no phase opens in Before) */
    const page = await c.newPage();
    page.on('pageerror', (e) => errors.push('ipad pageerror: ' + e.message));
    await page.goto(BASE + '/#display');
    await page.waitForSelector('.dp-overlay', { state: 'attached', timeout: 20000 });
    return { c, page };
  }
  const G0 = await open(false);
  const spec = await G0.page.evaluate(() => window.B68.BASE_FIGURE);
  await G0.c.close();
  const pcDoc = (name) => ({ v: 2, name, alias: '', code: '', playbook: 'hound', playbookName: 'Hound', spec, sheet: { name }, play: { vice: '', purveyor: '', contacts: [], clocks: [] } });
  check((await api('PUT', '/characters/run-pc1', pcDoc('Cass Fenn'))).status === 200, 'an invented PC is filed');
  const card = { hid: 'h_b19f', auth: NAME2, label: NAME2 + ' · Nowhere Ward', at: new Date().toISOString() };
  const OPEN_ALL = { public: true, working: true, controlled: true, secure: true };
  check((await api('PATCH', '/gm/state', { cards: { location: card }, loc: { map: { view: 'iso', theme: 'rulebook', layer: 'gm', reveal: OPEN_ALL } },
    ball: { site: NAME2, v: 2, start: 0, t: 100, crew: { 'run-pc1': { room: 'Showroom', disguise: 'guest' } } } })).status === 200, 'the v2 site on the GM layer, the crew in the Showroom');
  const lookOn = (page) => page.evaluate(() => { const r = document.querySelector('.dp-root'); return !!r && r.hasAttribute('data-flash-look'); });
  const filt = (page) => page.evaluate(() => { const r = document.querySelector('.dp-root'); return r ? r.getAttribute('data-scene-filter') : null; });

  /* ---- everything on (N0): with NOTHING stored, the buttons are on the map and the filter layer alone brings the grain and the caption on the iPad ---- */
  const A = await open();
  check((await A.page.$$('.rv-tools [data-site="flashback"]')).length === 1 && (await A.page.$$('.rv-tools [data-site="pin"]')).length === 1, 'nothing stored: a Flashback and a Pin button, in the site\'s toolbar over the map (N3)');
  const I0 = await openDisplay();
  check((await api('PATCH', '/gm/ambient', { layer: { path: 'scene.filter', value: 'flashback' } })).status === 200, 'the filter layer is set from outside the page');
  await I0.page.waitForFunction(() => { const r = document.querySelector('.dp-root'); return !!r && r.getAttribute('data-scene-filter') === 'flashback'; }, null, { timeout: 20000 });
  check(!!(await until(() => lookOn(I0.page), 15000, 200)), 'nothing stored: the iPad has the flash look with the filter (the served map says map.flashback is on)');
  await api('PATCH', '/gm/ambient', { layer: { path: 'scene.filter', value: null } });
  await I0.page.waitForFunction(() => { const r = document.querySelector('.dp-root'); return !!r && !r.hasAttribute('data-flash-look'); }, null, { timeout: 20000 });
  await A.c.close();

  /* ---- a stored true (what the Switchboard used to write) is the same ---- */
  check((await api('PATCH', '/gm/state', { features: { 'map.flashback': true } })).status === 200, 'a stored true is taken (and changes nothing)');
  const P = await open();
  check((await P.page.$$('.rv-tools [data-site="flashback"]')).length === 1 && (await P.page.$$('.rv-tools [data-site="pin"]')).length === 1, 'switch on: a Flashback button and a Pin button in the toolbar');
  await I0.page.reload();
  await I0.page.waitForSelector('.dp-overlay', { state: 'attached', timeout: 20000 });
  await P.page.click('.rv-tools [data-site="flashback"]');
  check(!!(await until(async () => (await filterNow()) === 'flashback', 6000, 100)), 'the Flashback button sets the scene.filter layer');
  check(await P.page.$eval('.rv-tools [data-site="flashback"]', (b) => b.textContent === 'Back'), 'and reads Back while it is up');
  check(!!(await until(() => P.page.evaluate(() => document.querySelector('#rv-map').classList.contains('b19-flash')), 6000, 100)), 'the GM map goes sepia');
  await I0.page.waitForFunction(() => { const r = document.querySelector('.dp-root'); return !!r && r.hasAttribute('data-flash-look'); }, null, { timeout: 25000 }).then(() => check(true, 'the iPad has the flash look'), () => check(false, 'the iPad has the flash look'));
  check(await I0.page.evaluate(() => { const r = document.querySelector('.dp-root'); return getComputedStyle(r, '::after').content === '"Earlier' + String.fromCharCode(0x2026) + '"'; }), 'the iPad caption reads Earlier…');
  check(await I0.page.evaluate(() => { const r = document.querySelector('.dp-root'); return /url\(/.test(getComputedStyle(r, '::before').backgroundImage); }), 'and the grain layer is drawn');

  /* the pin goes on the crew's room and comes up again */
  await P.page.click('.rv-tools [data-site="pin"]');
  check(!!(await until(() => P.page.evaluate(() => !!document.querySelector('#rv-map svg .b19-pin')), 4000, 100)), 'Pin drops a pin on the room');
  await sleep(1500);
  check(await P.page.evaluate(() => !!document.querySelector('#rv-map svg .b19-pin')), 'the pin survives the map being redrawn');
  check(!/Showroom/.test(await I0.page.evaluate(() => document.body.innerText)), 'and the pin’s room is named nowhere on the iPad');
  await P.page.click('.rv-tools [data-site="pin"]');
  check(!!(await until(() => P.page.evaluate(() => !document.querySelector('#rv-map svg .b19-pin')), 4000, 100)), 'a second tap takes the pin up');

  /* a tap ends it */
  await P.page.click('.rv-tools [data-site="flashback"]');
  check(!!(await until(async () => (await filterNow()) === null, 6000, 100)), 'a tap on Back clears the layer');
  await I0.page.waitForFunction(() => { const r = document.querySelector('.dp-root'); return !!r && !r.hasAttribute('data-flash-look'); }, null, { timeout: 25000 }).then(() => check(true, 'and the iPad look goes'), () => check(false, 'and the iPad look goes'));

  /* ---- a stored false (the old All off) changes nothing ---- */
  check((await api('PATCH', '/gm/state', { features: { 'map.flashback': false } })).status === 200, 'a stored false is taken');
  const R = await open();
  check((await R.page.$$('.rv-tools [data-site="flashback"]')).length === 1 && (await R.page.$$('.rv-tools [data-site="pin"]')).length === 1, 'a stored false changes nothing: both buttons stay');

  check(!errors.length, 'no page errors: ' + errors.slice(0, 3).join(' | '));
  await browser.close();
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
clearTimeout(timeout);
console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASSED'));
process.exit(failed ? 1 : 0);
