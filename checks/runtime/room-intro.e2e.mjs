// room-intro (RK29 of the room key build, setting room.intro): room openings on the iPad, end to end against a real local Worker (wrangler dev) on
// PORT (default 9508; the inspector on PORT + 20000), invented fixtures only: the Palazzo Rooms (kit: 1, 12 rooms on four floors) as an authored
// site with a v2 play, Location's live map on the GM page, and the iPad (a DISPLAY_EMAILS sign-in on the display page).
//   off  Show on iPad, then a room opened and a band ticked: no arrive in the push, no card, and neither page asks for the room-intro bundle
//   on   the first Show on iPad carries nothing; Open for the players (one room) plays its card at the push: the site's colour, the room's name and
//        its band and floor tapes, the plate cut from the map; the tray says "Opening <room> on the iPad"; each piece lands on its room's box within
//        4 px; the card is up 6 s after the push and gone by 7.5 s (the 0.8 s lead and 6.6 s); a band ticked plays its rooms (three names and
//        "and N more"); a second push cuts a card at once; a page that joins once the hand-over has begun shows the map and no card; reduced motion
//        holds the frozen frame (no ring) and cuts after 3 s; no hidden room in either GET or either DOM
//   KIT_SHOTS=<dir>  the frames for Alex's picture review: one room and a band, 1024x768 and 768x1024, at 0.3, 0.75, 1.5, 3.5, 4.6 and 6 s
//   PW_DISPLAY_ENGINE=webkit  the display pages in WebKit (the GM page stays on Edge), and the hand-over's frames are timed: none over 50 ms after the first
//   PW_MODULE=<path to playwright-core> [PW_CHANNEL=msedge] [PORT=9508] [KIT_SHOTS=<dir>] node checks/runtime/room-intro.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9508);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const SHOTS = process.env.KIT_SHOTS || '';
const ENGINE = process.env.PW_DISPLAY_ENGINE === 'webkit' ? 'webkit' : 'chromium';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

let failed = 0, passed = 0;
async function step(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.message || e)); } }
const expect = (c, m) => { if (!c) throw new Error(m); };
async function until(fn, ms, every = 100) { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(every); } return v; }

const PW = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/* ---------- the invented site ---------- */
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const json = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const conFix = json('console-pack.json'), locFix = json('location-pack.json'), PALAZZO = json('palazzo-kit1.json'), V2 = json('pelican-play-v2.json');
PALAZZO.patch.colour = 'ketchup and mustard';      /* one of the map kit's own schemes (map-kit.js colours), so the cover and the card's field are a real site colour */
const NAME = PALAZZO.patch.name, NOW = new Date().toISOString();
const PARTS = {
  console: conFix.parts.console,
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: NOW }, T: locFix.T, extra: locFix.extra,
    authored: { v: 1, sites: { [NAME]: { name: NAME, rel: 'x', map: { view: 'iso', theme: 'rulebook' }, patch: PALAZZO.patch, play: V2 } }, bind: {} } },
};
const HIDDEN = ['Luxury penthouse', 'Roof terrace', 'Private card rooms'];      /* secure and controlled: never on the iPad until opened */

/* ---------- the server ---------- */
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-room-intro-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
delete env.ANTHROPIC_API_KEY; delete env.B68_ANTHROPIC_KEY;
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'DISPLAY_EMAILS:' + IPAD],
{ cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: 'ignore' });
function killServer() {
  if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} }
}
process.on('exit', () => { killServer(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
const hard = setTimeout(() => { console.log('FAIL timed out'); process.exit(1); }, 900000);
let up = false;
for (let i = 0; i < 180 && !up; i++) { try { up = (await fetch(BASE + '/index.html', { signal: AbortSignal.timeout(2000) })).status > 0; } catch (_) {} if (!up) await sleep(500); }
if (!up) { console.log('FAIL server did not start'); process.exit(1); }

const call = (user, method, p, body) => fetch(BASE + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const gm = (method, p, body) => call(GM, method, p, body);
const ok = async (pr, what) => { const r = await pr; if (r.status !== 200) throw new Error(what + ': ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 160)); return r.json; };
const setting = async (on) => { for (const p of ['/api/gm/state', '/api/campaign']) await ok(gm('PATCH', p, { features: { 'room.intro': on } }), 'room.intro ' + on); };
const ipadGet = async () => (await call(IPAD, 'GET', '/api/gm/display?seq=-1&aseq=-1&hseq=-1')).json;
const gmGet = async () => (await gm('GET', '/api/gm/display')).json;
const MAPSTATE = { view: 'iso', theme: 'rulebook', layer: 'player', reveal: { public: true, working: false, controlled: false, secure: false } };
const resetSite = async () => ok(gm('PATCH', '/api/gm/state', { cards: { location: { hid: 'h_rk29', auth: NAME, label: NAME + ' · Nowhere Ward', at: NOW } }, loc: { map: MAPSTATE },
  ball: { site: NAME, v: 2, start: 0, t: 100, crew: {}, open: null, know: null } }), 'the site');

const browser = await PW.chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const dbrowser = ENGINE === 'webkit' ? await PW.webkit.launch() : browser;
console.log('INFO the display runs in ' + ENGINE);
const errors = [], asked = { gm: [], ipad: [] };
async function openIpad(o = {}) {
  const ctx = await dbrowser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: o.w || 1024, height: o.h || 768 }, serviceWorkers: 'block', reducedMotion: o.reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('display: ' + e.message));
  page.on('request', (r) => { if (/room-intro/.test(r.url())) asked.ipad.push(r.url()); });
  await page.goto(BASE + '/#display');
  await page.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 30000 });
  return { ctx, page };
}
async function openGm() {
  const gc = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
  await gc.addInitScript(atPlace('score', { score: 'location' }));
  await gc.addInitScript(() => { window.__B68_POLL_MS = 700; });
  const gp = await gc.newPage();
  gp.on('pageerror', (e) => errors.push('gm: ' + e.message));
  gp.on('request', (r) => { if (/room-intro/.test(r.url())) asked.gm.push(r.url()); });
  gp.on('dialog', (d) => d.accept());
  await gp.goto(BASE + '/#gm');
  await gp.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
  await gp.waitForSelector('#gm-loc [data-gm="ipad"]', { timeout: 30000 });
  return { gc, gp };
}
/* what the display shows: the card and its parts, the map stage on top */
const look = (page) => page.evaluate(() => {
  const card = document.querySelector('.ro-card'), st = [...document.querySelectorAll('.dp-stages > .dp-stage')].pop();
  const g = card && card.querySelector('.ro-ground');
  return { card: !!card, seq: card ? card.getAttribute('data-ro-seq') : '', still: !!card && card.classList.contains('ro-still'), field: g ? getComputedStyle(g).backgroundColor : '',
    names: card ? [...card.querySelectorAll('.ro-front')].map((e) => e.textContent) : [], kick: card ? [...card.querySelectorAll('.ro-kick-t')].map((e) => e.textContent).join('|') : '',
    more: card ? (card.querySelector('.ro-more') || {}).textContent || '' : '', pieces: card ? card.querySelectorAll('.ro-piece').length : 0,
    rings: !!document.querySelector('.dp-map-frame svg .ro-rings'), map: !!(st && st.classList.contains('dp-map')), cover: (() => { const c = st && st.querySelector('.map-cover path'); return c ? c.getAttribute('fill') : ''; })() };
});
const domHas = (page, needle) => page.evaluate((n) => document.documentElement.outerHTML.toLowerCase().includes(n.toLowerCase()), needle);
const hex = (rgb) => { const m = String(rgb).match(/\d+/g); return m ? '#' + m.slice(0, 3).map((x) => (+x).toString(16).padStart(2, '0')).join('') : ''; };
/* each piece against its room on the map: the union of the room's elements on the map (and its number badge), padded as the plate is (4%) */
const landing = (page, arrive) => page.evaluate((arr) => {
  const svg = [...document.querySelectorAll('.dp-stages > .dp-stage.dp-map')].pop().querySelector('.dp-map-frame svg'), out = [];
  for (const piece of document.querySelectorAll('.ro-card .ro-piece')) {
    const id = piece.getAttribute('data-ro-room'), a = arr.find((e) => e.id === id), els = [...svg.querySelectorAll('[data-room="' + id + '"]')];
    if (a && a.n != null) for (const g of svg.querySelectorAll('.room-label')) { const t = g.querySelector('text'); if (t && t.textContent.trim() === String(a.n)) els.push(g); }
    let L = Infinity, T = Infinity, R = -Infinity, B = -Infinity;
    for (const e of els) { if (e.closest('.ro-rings')) continue; const r = e.getBoundingClientRect(); if (!(r.width > 0) || !(r.height > 0)) continue; L = Math.min(L, r.left); T = Math.min(T, r.top); R = Math.max(R, r.right); B = Math.max(B, r.bottom); }
    const pad = Math.max(R - L, B - T) * 0.04, want = [L - pad, T - pad, R + pad, B + pad], got = piece.querySelector('.ro-col').getBoundingClientRect();
    out.push({ id, off: Math.max(Math.abs(got.left - want[0]), Math.abs(got.top - want[1]), Math.abs(got.right - want[2]), Math.abs(got.bottom - want[3])) });
  }
  return out;
}, arrive);
const settled = (page) => page.evaluate(() => { const a = document.getAnimations().filter((x) => x.animationName === 'ro-settle'); return a.length > 0 && a.every((x) => x.playState === 'finished'); });
const sinceAt = (d) => Date.now() - Date.parse(d.updatedAt);
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); }
/* the frames for the picture review: the card paused at each second asked for (every animation seeked to that time from its mount) */
async function frames(page, tag) {
  if (!SHOTS) return;
  const at = await page.evaluate(() => Number(document.querySelector('.ro-card').getAttribute('data-ro-at')));
  for (const t of [300, 750, 1500, 3500, 4600, 6000]) {
    await page.evaluate(([tt, a]) => { for (const x of document.getAnimations()) { x.pause(); x.currentTime = Math.max(0, tt - a); } }, [t, at]);
    await shot(page, tag + '-' + String(t).padStart(4, '0'));
  }
}

let G = null, I = null;
try {
  for (const [part, p] of Object.entries(PARTS)) await ok(gm('POST', '/api/gm/pack', { part, src: p.src || {}, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) }), 'pack ' + part);
  await ok(gm('PATCH', '/api/gm/ambient', { mode: 'pin', scene: 'duskwall', overlay: null }), 'ambient');
  await resetSite();
  const trayText = () => G.gp.evaluate(() => [...document.querySelectorAll('[title^="On the iPad: "]')].map((e) => e.getAttribute('title')).join(' | '));
  const showOnIpad = async () => {
    const before = (await gmGet()).seq;
    await G.gp.click('#gm-loc [data-gm="ipad"]');
    await until(async () => (await gmGet()).seq !== before && (await G.gp.evaluate(() => /Live on the iPad/.test(document.body.textContent))), 10000);
    await until(async () => (await look(I.page)).map, 10000);
  };
  const openRoom = async (name) => {
    const before = (await gmGet()).seq;
    await G.gp.evaluate(() => { const d = document.querySelector('#gm-loc details.gm-rooms'); if (d) d.open = true; });
    await G.gp.click('#gm-loc [data-gm="room-open"][data-room="' + name + '"]');
    return until(async () => { const d = await gmGet(); return d.seq !== before && d.display.kind === 'svg' ? d : null; }, 10000, 50);
  };
  const tick = async (band) => {
    const before = (await gmGet()).seq;
    await G.gp.click('#gm-loc input[data-reveal="' + band + '"]');
    return until(async () => { const d = await gmGet(); return d.seq !== before && d.display.kind === 'svg' ? d : null; }, 10000, 50);
  };

  /* ---------------- off ---------------- */
  await setting(false);
  I = await openIpad();
  G = await openGm();
  await step('off: Show on iPad, a room opened and a band ticked: no arrive pushed, no card, and neither page asks for the room-intro bundle', async () => {
    await showOnIpad();
    const d1 = await openRoom('Library');
    expect(d1 && !('arrive' in d1.display), 'no arrive: ' + JSON.stringify(d1 && Object.keys(d1.display)));
    let saw = false; for (let i = 0; i < 25; i++) { if ((await look(I.page)).card) saw = true; await sleep(100); }
    const d2 = await tick('working');
    expect(d2 && !('arrive' in d2.display), 'no arrive on a band tick');
    for (let i = 0; i < 25; i++) { if ((await look(I.page)).card) saw = true; await sleep(100); }
    expect(!saw, 'no card');
    expect(!asked.gm.length && !asked.ipad.length, 'no request for the bundle: ' + asked.gm.concat(asked.ipad).join(' '));
  });
  await G.gc.close(); await I.ctx.close();

  /* ---------------- on ---------------- */
  await resetSite();
  await setting(true);
  I = await openIpad();
  G = await openGm();
  await until(async () => asked.ipad.length > 0 && asked.gm.length > 0, 15000);
  let one = null;
  await step('on: both pages ask for the bundle; the first Show on iPad carries nothing and plays no card', async () => {
    expect(asked.ipad.some((u) => /room-intro\.js/.test(u)) && asked.gm.some((u) => /room-intro/.test(u)), 'asked: ' + asked.ipad.concat(asked.gm).join(' '));
    await showOnIpad();
    const d = await gmGet();
    expect(!('arrive' in d.display), 'the first show: no arrive');
    let saw = false; for (let i = 0; i < 20; i++) { if ((await look(I.page)).card) saw = true; await sleep(100); }
    expect(!saw, 'no card');
  });
  await step('on: Open for the players (one room) plays its card: the site\'s colour, the name and its tapes, a plate; the tray says Opening; no hidden room anywhere', async () => {
    one = await openRoom('Library');
    expect(one && Array.isArray(one.display.arrive) && one.display.arrive.length === 1 && one.display.arrive[0].name === 'Library', 'arrive: ' + JSON.stringify(one && one.display.arrive));
    const L = await until(async () => { const v = await look(I.page); return v.card && v.pieces ? v : null; }, 4000, 50);
    expect(L, 'no card: ' + JSON.stringify(await look(I.page)));
    expect(L.names.join('|') === 'Library' && L.kick === 'Controlled|Upper floor', 'name and tapes: ' + JSON.stringify(L));
    expect(L.pieces === 1 && L.cover && hex(L.field) === L.cover.toLowerCase(), 'one piece, on the site\'s own colour (the cover\'s): ' + L.field + ' vs ' + L.cover);
    const t = await until(async () => { const x = await trayText(); return /Opening Library on the iPad/.test(x) ? x : null; }, 3000) || await trayText();
    expect(/Opening Library on the iPad/.test(t), 'the tray: ' + t);
    const g = JSON.stringify(await ipadGet());
    for (const h of HIDDEN.filter((n) => n !== 'Private card rooms')) { expect(!g.toLowerCase().includes(h.toLowerCase()), 'the iPad GET names ' + h); expect(!(await domHas(I.page, h)), 'the iPad DOM names ' + h); }
    expect(!/GM-ONLY/.test(g), 'no GM-only line');
  });
  await step('on: each piece lands on its room\'s box within 4 px; the card is up 6 s after the push and gone by 7.5 s; a ring was drawn in the map and goes with it', async () => {
    expect(await until(async () => (await look(I.page)).rings, 6000, 50), 'a ring in the map svg');
    expect(await until(() => settled(I.page), 7000, 50), 'the pieces settled');
    const land = await landing(I.page, one.display.arrive);
    expect(land.length === 1 && land.every((x) => x.off <= 4), 'landing: ' + JSON.stringify(land));
    await until(async () => sinceAt(one) >= 6000, 7000, 20);
    expect((await look(I.page)).card, 'up at 6 s');
    await until(async () => sinceAt(one) >= 7500, 3000, 20);
    const v = await look(I.page);
    expect(!v.card && !v.rings && v.map, 'gone by 7.5 s, ring too, the map stays: ' + JSON.stringify(v));
    const t = await until(async () => { const x = await trayText(); return !/Opening/.test(x) ? x : null; }, 2000) || await trayText();
    expect(!/Opening/.test(t), 'the tray after: ' + t);
  });
  let band = null;
  await step('on: a band ticked plays its newly shown rooms: three names and "and N more", the band and "N rooms"; every piece lands', async () => {
    band = await tick('working');
    expect(band && band.display.arrive && band.display.arrive.length === 5 && band.display.arrive.every((e) => e.band === 'working'), 'arrive: ' + JSON.stringify(band && band.display.arrive));
    const L = await until(async () => { const v = await look(I.page); return v.card && v.pieces ? v : null; }, 4000, 50);
    expect(L && L.names.length === 3 && L.more === 'and 2 more' && L.kick === 'Working|5 rooms' && L.pieces === 5, JSON.stringify(L));
    await shot(I.page, 'band-' + ENGINE + '-1024-live');
    expect(await until(() => settled(I.page), 7000, 50), 'settled');
    const land = await landing(I.page, band.display.arrive);
    expect(land.length === 5 && land.every((x) => x.off <= 4), 'landing: ' + JSON.stringify(land));
    await until(async () => !(await look(I.page)).card, 4000);
  });
  await step('on: more rooms than the 8 a push lists (arriveTotal): the card says the true count, with the plates it has', async () => {
    await ok(gm('PUT', '/api/gm/display', Object.assign({}, band.display, { arriveTotal: 12 })), 'the band, said to be 12');
    const seq = String((await gmGet()).seq);
    const L = await until(async () => { const v = await look(I.page); return v.card && v.seq === seq ? v : null; }, 5000, 30);
    expect(L && L.kick === 'Working|12 rooms' && L.more === 'and 9 more' && L.pieces === 5, JSON.stringify(L));
    await until(async () => !(await look(I.page)).card, 9000);
  });
  await step('on: a second push cuts a card at once', async () => {
    await ok(gm('PUT', '/api/gm/display', band.display), 'the band again');
    expect(await until(async () => (await look(I.page)).card, 5000, 50), 'a card');
    await sleep(1500);
    const before = (await look(I.page)).seq;
    await ok(gm('PUT', '/api/gm/display', { kind: 'text', title: 'A note', text: 'The lights go out.' }), 'another push');
    const v = await until(async () => { const x = await look(I.page); return !x.map ? x : null; }, 6000, 30);
    expect(v && !v.card, 'the stage changed and the card went with it: ' + JSON.stringify(v) + ' (was ' + before + ')');
  });
  await step('on: a page that joins once the hand-over has begun shows the map and never a card', async () => {
    const d = await ok(gm('PUT', '/api/gm/display', band.display), 'the band again');
    const at = (await gmGet()).updatedAt;
    await until(async () => Date.now() - Date.parse(at) >= 4900, 6000, 20);      /* the lead (0.8 s) plus the hand-over's start (4 s) */
    const late = await openIpad();
    try {
      await until(async () => (await look(late.page)).map, 15000);
      let saw = false; for (let i = 0; i < 30; i++) { if ((await look(late.page)).card) saw = true; await sleep(100); }
      expect(!saw && (await look(late.page)).map, 'map, no card');
    } finally { await late.ctx.close(); }
    expect(d, 'pushed');
  });
  await step('on: reduced motion holds the frozen frame (no ring) and cuts after 3 s', async () => {
    const R = await openIpad({ reduced: true });
    try {
      await until(async () => (await look(R.page)).map, 15000);
      await until(() => R.page.evaluate(() => !!window.B68RoomIntro), 10000);
      await ok(gm('PUT', '/api/gm/display', one.display), 'one room again');
      const at = (await gmGet()).updatedAt;
      const v = await until(async () => { const x = await look(R.page); return x.card ? x : null; }, 4000, 30);
      expect(v && v.still, 'the still frame: ' + JSON.stringify(v));
      const moving = await R.page.evaluate(() => document.getAnimations().filter((a) => /^ro-/.test(a.animationName || '') && a.playState === 'running').length);
      expect(moving === 0, 'nothing moves: ' + moving);
      await sleep(600);
      expect(!(await look(R.page)).rings, 'no ring');
      await until(async () => Date.now() - Date.parse(at) >= 800 + 3000 + 400, 6000, 20);
      expect(!(await look(R.page)).card, 'cut after 3 s');
    } finally { await R.ctx.close(); }
  });
  await step('on: the hand-over\'s frames' + (ENGINE === 'webkit' ? ' in WebKit: none over 50 ms after the first (one retry)' : ' (timed; asserted in WebKit)'), async () => {
    /* the GM page is closed while the iPad is timed: at the table it is another device, and here its 0.7 s poll shares this PC's CPU (it reopens below) */
    await G.gc.close(); G = null;
    const once = async () => {
    await until(async () => !(await look(I.page)).card, 9000);
    await I.page.evaluate(() => {
      if (window.__ro) window.__ro.stop = true;      /* a retry: the last loop and watcher end */
      const me = window.__ro = { frames: [], mount: null, at: null, stop: false };
      const mo = new MutationObserver(() => { const c = document.querySelector('.ro-card'); if (c && me.mount === null) { me.mount = performance.now(); me.at = Number(c.getAttribute('data-ro-at')); mo.disconnect(); } });
      mo.observe(document.body, { childList: true, subtree: true });
      const loop = (t) => { if (me.stop) return; me.frames.push(t); if (me.frames.length < 2000) requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    });
    await ok(gm('PUT', '/api/gm/display', band.display), 'the band again');
    await until(async () => (await I.page.evaluate(() => window.__ro.mount !== null)), 5000, 30);
    await sleep(7500);      /* past the ring's end (6.4 s from the card's zero, which is up to 0.8 s after the mount) */
    const win = (a, b) => I.page.evaluate(([fa, fb]) => {
      const o = window.__ro, z = o.mount - o.at, from = z + fa, to = z + fb;      /* the card's fa to fb ms, on this page's clock */
      const f = o.frames.filter((t) => t >= from && t <= to), gaps = f.slice(1).map((t, i) => t - f[i]);
      const worst = gaps.length > 1 ? Math.max(...gaps.slice(1)) : 0, wi = gaps.indexOf(worst, 1);
      return { n: f.length, worst, first: gaps[0] || 0, at: wi > 0 ? Math.round(f[wi] - z) : null };      /* at: the card's time where the worst gap began */
    }, [a, b]);
    const r = await win(3950, 5000), ring = await win(4900, 6400);
    console.log('INFO the hand-over in ' + ENGINE + ': ' + r.n + ' frames, the first gap ' + Math.round(r.first) + ' ms, the worst after it ' + Math.round(r.worst) + ' ms (at ' + r.at + ' ms)');
    console.log('INFO the ring (4.9 to 6.4 s) in ' + ENGINE + ': ' + ring.n + ' frames, the worst gap after the first ' + Math.round(ring.worst) + ' ms (at ' + ring.at + ' ms)');
    return r;
    };
    let r = await once();
    if (ENGINE === 'webkit' && !(r.n > 20 && r.worst <= 50)) { console.log('INFO over 50 ms: timed once more'); r = await once(); }
    if (ENGINE === 'webkit') expect(r.n > 20 && r.worst <= 50, 'a frame over 50 ms: ' + JSON.stringify(r));
  });
  await step('frames for the picture review (KIT_SHOTS): one room and a band, at 1024x768 and 768x1024', async () => {
    if (!SHOTS) { console.log('  (no KIT_SHOTS: skipped)'); return; }
    for (const [w, h] of [[1024, 768], [768, 1024]]) {
      await I.page.setViewportSize({ width: w, height: h });
      await sleep(600);
      for (const [tag, d] of [['one', one], ['band', band]]) {
        await until(async () => !(await look(I.page)).card, 9000);      /* the card before has gone */
        await ok(gm('PUT', '/api/gm/display', d.display), tag);
        const seq = String((await gmGet()).seq);
        expect(await until(async () => { const v = await look(I.page); return v.card && v.pieces && v.seq === seq ? v : null; }, 5000, 30), 'this push\'s card at ' + w + 'x' + h);
        await frames(I.page, 'ipad-' + tag + '-' + w + 'x' + h + '-' + ENGINE);
        await I.page.evaluate(() => { for (const x of document.getAnimations()) x.play(); });
        await until(async () => !(await look(I.page)).card, 9000);
      }
    }
    await I.page.setViewportSize({ width: 1024, height: 768 });
  });
  await step('on: the GM page\'s tray while a card plays (1366x768)', async () => {
    if (!G) G = await openGm();
    await showOnIpad();      /* the pushes above came from elsewhere: live reveal has stopped, so the map goes up again (it asks; the dialog is accepted) */
    const d = await openRoom('Private card rooms');
    expect(d && d.display.arrive && d.display.arrive[0].name === 'Private card rooms', 'arrive: ' + JSON.stringify(d && d.display.arrive));
    await sleep(700);
    if (SHOTS) await G.gp.screenshot({ path: path.join(SHOTS, 'gm-tray-1366.png') });
    expect(/Opening Private card rooms on the iPad/.test(await trayText()), 'the tray: ' + await trayText());
  });
  await step('no page error on either page', async () => { expect(!errors.length, errors.join(' | ')); });
} catch (e) {
  failed++; console.log('FAIL the run stopped: ' + (e && e.stack || e));
} finally {
  try { if (G) await G.gc.close(); } catch (_) {}
  try { if (I) await I.ctx.close(); } catch (_) {}
  try { await browser.close(); if (dbrowser !== browser) await dbrowser.close(); } catch (_) {}
  clearTimeout(hard);
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
