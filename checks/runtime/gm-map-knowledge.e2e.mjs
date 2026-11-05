// The three knowledge states (suite 2.2, switch map.knowledge; app/gm/knowledge.js) on the Run view and the iPad copy, in a real browser against a real local Worker, on an
// invented site (the Pelican Rooms). Everything built is on (N0): with nothing stored the state button sits beside Reveal, and a stored false changes nothing. Each room card's button is its state and a tap cycles it; Intel sets a band's dark
// rooms to blueprint; the iPad copy draws a blueprint room as linework with its name and a dark room not at all, and follows a change live. Every name is invented; no model, $0.
//   PW_MODULE=<playwright install> PW_CHANNEL=msedge [PORT=9201] node checks/runtime/gm-map-spotted.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9201);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
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

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-b24-e2e-9201-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use: stop what is on it, or set PORT'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM], { cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(view = 'location') {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
    await c.addInitScript(() => { window.__B68_POLL_MS = 700; });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    if (view === 'run') {
      await page.keyboard.press('b'); await page.keyboard.press('g');
      await page.waitForSelector('.rv-head', { timeout: 20000 });
    }
    return { c, page };
  }
  const card = { hid: 'h_b24', auth: NAME2, label: NAME2 + ' · Nowhere Ward', at: new Date().toISOString() };
  const MAP = (layer, reveal) => ({ view: 'plan', theme: 'casefile', layer, reveal });
  check((await api('PATCH', '/gm/state', { cards: { location: card }, loc: { map: MAP('player', { public: true, working: false, controlled: false, secure: false }) },
    ball: { site: NAME2, v: 2, start: 0, t: 100, crew: {} } })).status === 200, 'the v2 site on the Player layer, public only, nobody placed');
  const KNOW = ['Security control room'], DARK = ['Luxury penthouse', 'Underground counting room'];
  const ballNow = async () => (await gmState()).ball || {};
  const display = async () => (await api('GET', '/gm/display')).json;
  const svgOf = async () => { const d = await display(); const o = d && d.display ? d.display : null; return o && o.kind === 'svg' && typeof o.svg === 'string' ? o.svg : ''; };

  /* ---- everything on (N0): with NOTHING stored the room card has its state button beside Reveal on the map, and the Map heading has the panel ---- */
  const A = await open('run');
  await A.page.waitForSelector('.rv-card[data-room="Security control room"]', { timeout: 20000 });
  await A.page.click('.rv-card[data-room="Security control room"]');
  await A.page.waitForSelector('.rv-rm[data-room="Security control room"] [data-rv="know"]', { timeout: 10000 });
  check((await A.page.$$('.rv-rm[data-room="Security control room"] [data-rv="know"]')).length === 1, 'nothing stored: the room card has its state button');
  await A.c.close();
  const L0 = await open('location');
  check(!!(await L0.page.waitForSelector('#gm-b24', { timeout: 20000 }).catch(() => null)), 'nothing stored: the knowledge panel is under the Map heading');
  await L0.c.close();

  /* ---- a stored true (what the Switchboard used to write) is the same ---- */
  check((await api('PATCH', '/gm/state', { features: { 'map.knowledge': true } })).status === 200, 'a stored true is taken (and changes nothing)');
  const R = await open('run');
  await R.page.waitForSelector('.rv-card[data-room="Security control room"]', { timeout: 20000 });
  await R.page.click('.rv-card[data-room="Security control room"]');
  await R.page.waitForSelector('.rv-rm[data-room="Security control room"] [data-rv="know"]', { timeout: 10000 });
  const btn = '.rv-rm[data-room="Security control room"] [data-rv="know"]';
  const txt = async () => (await R.page.textContent(btn) || '').trim();
  check(/^Dark/.test(await txt()), 'a room starts dark: ' + (await txt()));
  await R.page.click(btn);
  check(await until(async () => JSON.stringify((await ballNow()).know) === JSON.stringify(KNOW), 5000, 100), 'a tap makes it blueprint: ball.know holds it');
  check(!(await ballNow()).open, 'and it is not open: ball.open is untouched (phones read that)');
  check(await until(async () => /^Blueprint/.test(await txt()), 4000, 100), 'the button says Blueprint');

  /* the Intel bar sits under the Run map */
  await R.page.click('[data-rv="view"][data-v="map"]');
  await R.page.waitForSelector('#rv-map svg', { timeout: 20000 });
  check(await until(async () => (await R.page.$$('.rv-know-bar [data-kn="intel"]')).length >= 2, 5000, 100), 'the Intel bar is under the Run map (bands, floors)');

  /* the iPad copy: the Location card's Show on iPad, then the live follow */
  const L = await open('location');
  await L.page.waitForSelector('#gm-b24', { timeout: 20000 });
  check((await L.page.$$('#gm-b24 [data-kn="cycle"]')).length >= 4, 'the Location card has the knowledge panel, a button per room not seen through a band');
  await L.page.click('[data-gm="ipad"]');
  const t0 = Date.now();
  const svg1 = await until(async () => { const v = await svgOf(); return /data-know="blueprint"/.test(v) ? v : ''; }, 8000, 100);
  check(!!svg1, 'Show on iPad: the blueprint room is drawn as linework (' + (Date.now() - t0) + ' ms)');
  check(!!svg1 && /Security control room/.test(svg1) && !DARK.some((n) => new RegExp(n, 'i').test(svg1)) && !/GM-ONLY/.test(svg1), 'the copy names the blueprint room and no dark room, and no GM-only marker');
  const live = await until(() => L.page.evaluate(() => /Live on the iPad/.test(document.body.textContent)), 5000, 100);
  check(!!live, 'the map is live on the iPad');

  /* blueprint to seen: the live follow asks first (the dialog is accepted), then redraws; the room is no longer linework */
  const tSeen = Date.now();
  await L.page.click('#gm-b24 [data-kn="cycle"][data-room="Security control room"]');
  const svg2 = await until(async () => { const v = await svgOf(); return v && !/data-know="blueprint"/.test(v) && v !== svg1 ? v : ''; }, 8000, 50);
  const dt = Date.now() - tSeen;
  check(!!svg2, 'blueprint to seen: the iPad redraws without linework (' + dt + ' ms)');
  check(dt < 3000, 'inside the page budget with polling: ' + dt + ' ms (the render itself is under 600 ms: suite-b24)');
  let b2 = {};
  await until(async () => { b2 = await ballNow(); return JSON.stringify(b2.open) === JSON.stringify(KNOW); }, 5000, 100);
  check(JSON.stringify(b2.open) === JSON.stringify(KNOW) && !b2.know, 'seen is ball.open, and it left ball.know: ' + JSON.stringify(b2));

  /* seen to dark: gone from the iPad */
  await L.page.click('#gm-b24 [data-kn="cycle"][data-room="Security control room"]');
  const svg3 = await until(async () => { const v = await svgOf(); return v && !/Security control room/i.test(v) ? v : ''; }, 8000, 100);
  check(!!svg3, 'seen to dark: the room and its name are gone from the iPad copy');
  await until(async () => { const b = await ballNow(); return !b.open && !b.know; }, 5000, 100);
  check(!(await ballNow()).open && !(await ballNow()).know, 'both lists are empty again: ' + JSON.stringify(await ballNow()));

  /* Intel on the working band: its dark rooms become blueprint, the others stay dark */
  await L.page.click('#gm-b24 [data-kn="intel"][data-group="band:working"]');
  check(await until(async () => { const k = (await ballNow()).know || []; return k.length === 2 && k.includes('Security control room') && k.includes('Underground counting room'); }, 5000, 100), 'Intel: the working band is blueprint, both of its rooms');
  const svg4 = await until(async () => { const v = await svgOf(); return (v.match(/data-know="blueprint"/g) || []).length >= 2 ? v : ''; }, 8000, 100);
  check(!!svg4 && !/Luxury penthouse|Private card rooms/i.test(svg4) && (svg4.match(/data-know="blueprint"/g) || []).length >= 2, 'the iPad shows the two as linework and still no secure or controlled room: ' + (svg4 ? (svg4.match(/data-know="blueprint"/g) || []).length + ' linework, penthouse ' + /Luxury penthouse/i.test(svg4) + ', card rooms ' + /Private card rooms/i.test(svg4) : 'no svg'));
  check(!(await ballNow()).open, 'nothing is open to the players: a blueprint room is not a room the phones know');

  /* a stored false (the old All off) changes nothing */
  await R.c.close(); await L.c.close();
  check((await api('PATCH', '/gm/state', { features: { 'map.knowledge': false } })).status === 200, 'a stored false is taken');
  const O = await open('location');
  check(!!(await O.page.waitForSelector('#gm-b24', { timeout: 20000 }).catch(() => null)), 'a stored false changes nothing: the panel stays');
  check(errors.length === 0, 'no page errors: ' + errors.slice(0, 3).join(' | '));
  await browser.close();
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
clearTimeout(timeout);
console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASSED'));
process.exit(failed ? 1 : 0);
