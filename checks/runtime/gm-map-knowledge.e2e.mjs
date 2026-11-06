// The three knowledge states (suite 2.2, switch map.knowledge; app/gm/knowledge.js) on the site (the Run view, N3) and the iPad copy, in a real browser against a real local
// Worker, on an invented site (the Pelican Rooms). Everything built is on (N0): a stored false changes nothing. Each room card's Players' map is Dark | Blueprint | Seen: Dark
// and Blueprint at once, Seen stages the room and Send opens it; Intel (the ⋯) sets a band's dark rooms to blueprint; Location has no knowledge box any more; the iPad copy
// draws a blueprint room as linework with its name and a dark room not at all, and follows a change live. Every name is invented; no model, $0.
//   PW_MODULE=<playwright install> PW_CHANNEL=msedge [PORT=9201] node checks/runtime/gm-map-knowledge.e2e.mjs
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

  /* N3: the knowledge states are the site's. Each room card has its Players' map (Dark | Blueprint | Seen); Seen stages the room and Send opens it; Intel is in the ⋯ */
  const seg = (k) => '.rv-rm.sel [data-site="kn"][data-k="' + k + '"]';
  const pressed = (page) => page.$$eval('.rv-rm.sel [data-site="kn"][aria-pressed="true"]', (l) => l.map((e) => e.getAttribute('data-k')).join()).catch(() => '');
  const pick = async (page, room) => { await page.click('.rv-card[data-room="' + room + '"] .rv-cn'); await page.waitForSelector('.rv-rm.sel[data-room="' + room + '"] [data-site="kn"]', { timeout: 10000 }); };

  /* ---- everything on (N0): with NOTHING stored, each room card on the site has its Players' map; Location's Map section has no knowledge box any more ---- */
  const A = await open('run');
  await A.page.waitForSelector('.rv-card[data-room="Security control room"]', { timeout: 20000 });
  await pick(A.page, 'Security control room');
  check((await A.page.$$('.rv-rm.sel [data-site="kn"]')).length === 3, 'nothing stored: the room card has its Players\' map, three states');
  await A.c.close();
  const L0 = await open('location');
  await L0.page.waitForSelector('#gm-loc .gm-mapbox', { timeout: 20000 });
  check((await L0.page.$$('#gm-b24, #gm-b17')).length === 0 && (await L0.page.$$('#gm-loc [data-kn]')).length === 0, 'N3: Location\'s Map section has no knowledge box (it is the site\'s)');
  await L0.c.close();

  /* ---- a stored true (what the Switchboard used to write) is the same ---- */
  check((await api('PATCH', '/gm/state', { features: { 'map.knowledge': true } })).status === 200, 'a stored true is taken (and changes nothing)');
  const R = await open('run');
  await R.page.waitForSelector('.rv-card[data-room="Security control room"]', { timeout: 20000 });
  await pick(R.page, 'Security control room');
  check((await pressed(R.page)) === 'dark', 'a room starts dark: ' + (await pressed(R.page)));
  await R.page.click(seg('blueprint'));
  check(await until(async () => JSON.stringify((await ballNow()).know) === JSON.stringify(KNOW), 5000, 100), 'Blueprint at once: ball.know holds it');
  check(!(await ballNow()).open, 'and it is not open: ball.open is untouched (phones read that)');
  check(await until(async () => (await pressed(R.page)) === 'blueprint', 4000, 100), 'Blueprint is pressed');
  check(await R.page.$eval('.rv-card[data-room="Security control room"]', (e) => e.classList.contains('k-blueprint')), 'and the board shows the room as blueprint');

  /* Intel is in the site's ⋯ (bands, floors), and the map's labels carry the states */
  await R.page.click('[data-rv="menu"]');
  check(await until(async () => (await R.page.$$('#rv-menu [data-site="intel"]')).length >= 2, 5000, 100), 'the ⋯ menu offers Intel by band and by floor');
  await R.page.click('[data-rv="menu"]');
  await R.page.click('[data-rv="view"][data-v="map"]');
  await R.page.waitForSelector('#rv-map svg', { timeout: 20000 });
  check(await until(async () => (await R.page.$$('#rv-map .room-label.rv-mk-blueprint')).length >= 1, 5000, 100), 'the Run map marks the blueprint room\'s label');
  await R.page.click('[data-rv="view"][data-v="board"]');
  await R.c.close();

  /* the iPad copy: Location's Show on iPad, then the live follow, from the site on the same page (as at the table) */
  const L = await open('location');
  await L.page.waitForSelector('#gm-loc [data-gm="ipad"]', { timeout: 20000 });
  await L.page.click('[data-gm="ipad"]');
  const t0 = Date.now();
  const svg1 = await until(async () => { const v = await svgOf(); return /data-know="blueprint"/.test(v) ? v : ''; }, 8000, 100);
  check(!!svg1, 'Show on iPad: the blueprint room is drawn as linework (' + (Date.now() - t0) + ' ms)');
  check(!!svg1 && /Security control room/.test(svg1) && !DARK.some((n) => new RegExp(n, 'i').test(svg1)) && !/GM-ONLY/.test(svg1), 'the copy names the blueprint room and no dark room, and no GM-only marker');
  const live = await until(() => L.page.evaluate(() => /Live on the iPad/.test(document.body.textContent)), 5000, 100);
  check(!!live, 'the map is live on the iPad');
  await L.page.keyboard.press('g'); await L.page.waitForSelector('.rv-head', { timeout: 20000 });
  check(await until(() => L.page.evaluate(() => /^LIVE/.test((document.querySelector('.rv-live') || {}).textContent || '') && window.B68GmStage.state().live !== ''), 5000, 100), 'the site\'s stage group says LIVE, and so does B68GmStage.state()');

  /* blueprint to seen: Seen stages it (nothing goes yet), Send opens it; the live follow asks first (the dialog is accepted), then redraws without linework */
  await pick(L.page, 'Security control room');
  await L.page.click(seg('seen'));
  await sleep(600);
  check(/data-know="blueprint"/.test(await svgOf()) && !(await ballNow()).open, 'staged: the iPad still shows it as linework, nothing is open');
  const tSeen = Date.now();
  await L.page.click('.rv-tools [data-site="send"]');
  const svg2 = await until(async () => { const v = await svgOf(); return v && !/data-know="blueprint"/.test(v) && v !== svg1 ? v : ''; }, 8000, 50);
  const dt = Date.now() - tSeen;
  check(!!svg2, 'Send: the iPad redraws without linework (' + dt + ' ms)');
  check(dt < 3000, 'inside the page budget with polling: ' + dt + ' ms (the render itself is under 600 ms: suite-b24)');
  let b2 = {};
  await until(async () => { b2 = await ballNow(); return JSON.stringify(b2.open) === JSON.stringify(KNOW); }, 5000, 100);
  check(JSON.stringify(b2.open) === JSON.stringify(KNOW) && !b2.know, 'seen is ball.open, and it left ball.know: ' + JSON.stringify(b2));

  /* seen to dark, at once: gone from the iPad */
  await pick(L.page, 'Security control room');
  await L.page.click(seg('dark'));
  const svg3 = await until(async () => { const v = await svgOf(); return v && !/Security control room/i.test(v) ? v : ''; }, 8000, 100);
  check(!!svg3, 'Dark: the room and its name are gone from the iPad copy');
  await until(async () => { const b = await ballNow(); return !b.open && !b.know; }, 5000, 100);
  check(!(await ballNow()).open && !(await ballNow()).know, 'both lists are empty again: ' + JSON.stringify(await ballNow()));

  /* Intel on the working band (the ⋯): its dark rooms become blueprint, the others stay dark */
  await L.page.click('[data-rv="menu"]');
  await L.page.click('#rv-menu [data-site="intel"][data-group="band:working"]');
  check(await until(async () => { const k = (await ballNow()).know || []; return k.length === 2 && k.includes('Security control room') && k.includes('Underground counting room'); }, 5000, 100), 'Intel: the working band is blueprint, both of its rooms');
  check(await L.page.$eval('#rv-menu', (e) => e.hidden), 'and the menu shuts');
  const svg4 = await until(async () => { const v = await svgOf(); return (v.match(/data-know="blueprint"/g) || []).length >= 2 ? v : ''; }, 8000, 100);
  check(!!svg4 && !/Luxury penthouse|Private card rooms/i.test(svg4) && (svg4.match(/data-know="blueprint"/g) || []).length >= 2, 'the iPad shows the two as linework and still no secure or controlled room: ' + (svg4 ? (svg4.match(/data-know="blueprint"/g) || []).length + ' linework, penthouse ' + /Luxury penthouse/i.test(svg4) + ', card rooms ' + /Private card rooms/i.test(svg4) : 'no svg'));
  check(!(await ballNow()).open, 'nothing is open to the players: a blueprint room is not a room the phones know');

  /* a stored false (the old All off) changes nothing */
  await L.c.close();
  check((await api('PATCH', '/gm/state', { features: { 'map.knowledge': false } })).status === 200, 'a stored false is taken');
  const O = await open('run');
  await O.page.waitForSelector('.rv-card[data-room="Private card rooms"]', { timeout: 20000 });
  await pick(O.page, 'Private card rooms');
  check((await O.page.$$('.rv-rm.sel [data-site="kn"]')).length === 3, 'a stored false changes nothing: the Players\' map stays');
  check(errors.length === 0, 'no page errors: ' + errors.slice(0, 3).join(' | '));
  await browser.close();
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
clearTimeout(timeout);
console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASSED'));
process.exit(failed ? 1 : 0);
