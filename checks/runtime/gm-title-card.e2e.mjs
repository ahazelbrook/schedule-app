// The score title card (suite 2.10, switch map.title; app/gm/title-card.js, app/display/title-card.js) in a real browser against a real local Worker, on an invented site (the Pelican
// Rooms). Switch off: GO into the Score phase puts nothing up. Switch on: the phase rail's Score puts a scoretitle beat on the ambient document (the site's name and the building's storeys,
// no room name), the iPad builds the card inside six seconds with the name landing last and it goes by itself, pressing Score again while in it does nothing, reduced motion stills it.
// GM_SHOTS=<dir> keeps four frames. Every name is invented; no model, $0.
//   PW_MODULE=<playwright install> PW_CHANNEL=msedge [PORT=9202] node checks/runtime/gm-map-spotted.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9202);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'ipad@example.test';
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

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-b24-e2e-9202-'));
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
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function openGm() {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1366, height: 900 }, serviceWorkers: 'block' });
    await c.addInitScript(() => { window.__B68_POLL_MS = 700; });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
    return { c, page };
  }
  async function openDisplay(w = 1366, h = 1024) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: w, height: h } });
    const page = await c.newPage();
    await page.addInitScript(() => { try { if (window === window.top) localStorage.setItem('b68.display.ambientTiming', JSON.stringify({ intervalMs: 600000, graceMs: 60000 })); } catch (e) { /* no storage */ } });
    page.on('pageerror', (e) => errors.push('display pageerror: ' + e.message));
    await page.goto(BASE + '/#display');
    await page.waitForSelector('.dp-overlay', { state: 'attached', timeout: 20000 });
    await page.waitForFunction(() => /Updated|Waiting/.test((document.querySelector('.dp-status-text') || {}).textContent || ''), null, { timeout: 20000 });
    return { c, page };
  }
  const overlay = async () => { const j = (await api('GET', '/gm/ambient')).json || {}; const d = j.doc || (j.ambient && j.ambient.doc) || {}; return d.overlay || null; };

  const card = { hid: 'h_b24t', auth: NAME2, label: NAME2 + ' · Nowhere Ward', at: new Date().toISOString() };
  check((await api('PATCH', '/gm/state', { cards: { location: card }, loc: { map: { view: 'plan', theme: 'casefile', layer: 'gm', reveal: { public: true } } },
    ball: { site: NAME2, v: 2, start: 0, t: 100, crew: {} }, features: { 'spine.rail': true } })).status === 200, 'the site is the location card; the phase rail is on (it is how GO is pressed)');

  const D = await openDisplay();
  const G = await openGm();
  await G.page.waitForSelector('#gm-phaserail [data-rail="score"]', { timeout: 20000 });
  const rail = async (id) => { await G.page.$eval('#gm-phaserail [data-rail="' + id + '"]', (e) => e.click()); await sleep(900); };

  /* ---- switch off: GO shows nothing ---- */
  await rail('plan'); await rail('score');
  check(!(await overlay()) || (await overlay()).kind !== 'scoretitle', 'switch off: GO into the Score phase puts no title card up');
  check((await D.page.$$('.dp-show-scoretitle')).length === 0, 'and the iPad shows none');

  /* ---- switch on ---- */
  check((await api('PATCH', '/gm/state', { features: { 'map.title': true, 'spine.rail': true } })).status === 200, 'map.title is switched on');
  await sleep(1500);
  await rail('plan'); await sleep(400);
  await G.page.$eval('#gm-phaserail [data-rail="score"]', (e) => e.click());
  const t0 = Date.now();
  const ov = await until(async () => { const o = await overlay(); return o && o.kind === 'scoretitle' ? o : null; }, 6000, 50);
  check(!!ov, 'GO into the Score phase: a scoretitle beat is on the ambient document (' + (Date.now() - t0) + ' ms)');
  if (ov) {
    check(ov.ms === 6000 && ov.payload.text === NAME2, 'six seconds, named for the site: ' + JSON.stringify(ov.payload).slice(0, 160));
    const fl = ov.payload.floors || [];
    check(fl.length >= 1 && fl.length <= 6 && fl.every((f) => /^\d{1,3},\d{1,3},\d{1,3},\d{1,3}$/.test(f)), 'the building is storeys of four numbers: ' + fl.join(' | '));
    const flat = JSON.stringify(ov);
    check(!ROOMS.some((r) => flat.includes(r.name)) && !/GM-ONLY|Odette|Lamplighters/.test(flat), 'no room name and no GM-only text in the beat');
  }

  /* ---- on the iPad: the card builds, inside six seconds, with the name landing last ---- */
  await D.page.waitForSelector('.dp-overlay .dp-show-scoretitle.dp-ov-in', { timeout: 15000 });
  const tIn = Date.now();
  const SHOTS_DIR = process.env.GM_SHOTS || '';
  const snap = async (name) => { if (SHOTS_DIR) { mkdirSync(SHOTS_DIR, { recursive: true }); await D.page.screenshot({ path: path.join(SHOTS_DIR, 'title-' + name + '.png') }); } };
  const timing = await D.page.evaluate(() => {
    const node = document.querySelector('.dp-overlay .dp-show-scoretitle');
    const anims = node.getAnimations({ subtree: true }).map((a) => a.effect.getComputedTiming());
    return { n: anims.length, end: Math.max(...anims.map((t) => t.endTime)), floors: node.querySelectorAll('.dp-tc-floor').length, title: node.querySelector('.dp-tc-title').textContent, sub: (node.querySelector('.dp-tc-sub') || {}).textContent };
  });
  check(timing.n >= 8 && timing.end <= 6000, 'every animation on the card ends by ' + timing.end + ' ms (at most 6000), ' + timing.n + ' of them');
  check(timing.floors === (ov && ov.payload.floors ? ov.payload.floors.length : 1) && timing.title === NAME2, 'the card has a group per storey and the site name: ' + timing.floors + ' / ' + timing.title);
  await sleep(1000 - (Date.now() - tIn)); await snap('1s-plans-flying');
  await sleep(1700); await snap('2.7s-becoming-the-building');
  await sleep(1000); await snap('3.7s-slab');
  await sleep(1100); await snap('4.8s-name-landed');
  const named = await D.page.evaluate(() => { const t = document.querySelector('.dp-overlay .dp-show-scoretitle .dp-tc-title'); return t ? getComputedStyle(t).clipPath + '|' + getComputedStyle(t).opacity : ''; });
  check(/^(inset\(0(px|%)? 0(px|%)? 0(px|%)? 0(px|%)?\)|none)$/.test(named.split('|')[0]) && named.split('|')[1] === '1', 'by five seconds the name is fully on the grid: ' + named);
  await D.page.waitForFunction(() => !document.querySelector('.dp-overlay .dp-show-scoretitle'), null, { timeout: 8000 });
  check((Date.now() - t0) < 9500, 'and it is gone by itself');

  /* ---- twice in the same phase, or GO again: not again; two GM pages in the same minute: once ---- */
  const seq = async () => ((await api('GET', '/gm/ambient')).json || {}).seq;
  const s1 = await seq();
  await G.page.$eval('#gm-phaserail [data-rail="score"]', (e) => e.click()); await sleep(1200);
  check((await seq()) === s1, 'pressing the Score phase while already in it puts nothing up');

  /* ---- reduced motion: a still card ---- */
  const R = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1024, height: 768 }, reducedMotion: 'reduce' });
  const rp = await R.newPage();
  await rp.addInitScript(() => { try { if (window === window.top) localStorage.setItem('b68.display.ambientTiming', JSON.stringify({ intervalMs: 600000, graceMs: 60000 })); } catch (e) { /* no storage */ } });
  await rp.goto(BASE + '/#display'); await rp.waitForSelector('.dp-overlay', { state: 'attached', timeout: 20000 });
  await rail('plan'); await G.page.$eval('#gm-phaserail [data-rail="score"]', (e) => e.click());
  await rp.waitForSelector('.dp-overlay .dp-show-scoretitle.dp-ov-in', { timeout: 15000 });
  const still = await rp.evaluate(() => { const node = document.querySelector('.dp-overlay .dp-show-scoretitle'); return { anims: node.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').length, ok: !!node.querySelector('.dp-tc-title') }; });
  check(still.anims === 0 && still.ok, 'reduced motion: no animation runs, the card is its last frame (' + JSON.stringify(still) + ')');
  await R.close();

  /* ---- off again ---- */
  check((await api('PATCH', '/gm/state', { features: { 'map.title': false } })).status === 200, 'switched off again');
  await sleep(1500); await rail('plan'); await sleep(7000);
  const o1 = await overlay(); await G.page.$eval('#gm-phaserail [data-rail="score"]', (e) => e.click()); await sleep(1500);
  check(((await overlay()) || {}).id === (o1 || {}).id, 'off again: GO puts no new beat up');
  check(errors.length === 0, 'no page errors: ' + errors.slice(0, 3).join(' | '));
  await browser.close();
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
clearTimeout(timeout);
console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASSED'));
process.exit(failed ? 1 : 0);
