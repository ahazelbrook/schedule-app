// Run the site (M2b) in a real browser against a real local Worker (wrangler dev, DEV_USER) on PORT (default 8877), with an
// INVENTED authored site (a made-up venue and cast, rooms from the map kit's catalogue) in the location part of the pack:
// the GM page opens the authored card, shows the strip, switches floors, scrubs across midnight, picks a disguise, places a PC,
// pins a table clock, reloads and sees the same; and nothing of it reaches the iPad.
//   PW_MODULE=<playwright install> PW_CHANNEL=msedge node checks/runtime/gm-run.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8877);
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
const NOW = new Date().toISOString();

const NAME = 'The Pelican Rooms';
const ROOMS = [
  { name: 'Showroom', band: 'public', detail: 'Chairs.' }, { name: 'Cocktail lounge', band: 'public', detail: 'Glass.' },
  { name: 'Security control room', band: 'working', detail: 'Screens.' }, { name: 'Private card rooms', band: 'controlled', detail: 'Cards.' },
  { name: 'Underground counting room', band: 'working', detail: 'Coins.' }, { name: 'Luxury penthouse', band: 'secure', isTarget: true, detail: 'The strongbox.' }];
const PLAY = {
  v: 1, clock: { start: '21:00', end: '02:00', label: 'Gala night' }, floors: { '-1': 'Under', '0': 'Ground', '1': 'Upper', '2': 'Loft' },
  routes: [{ id: 'lift', from: 'Cocktail lounge', to: 'Luxury penthouse', via: 'the service lift', dir: 'up', needs: 'a key', watched: true }],
  people: [
    { id: 'od', label: 'Odette Marsh', kind: 'target', stops: [{ at: '21:00', room: 'Showroom' }, { at: '23:30', room: 'Private card rooms', note: 'cards' }, { at: '00:15', room: 'Luxury penthouse', note: 'alone' }] },
    { id: 'wr', label: 'Wren Tully', kind: 'guard', with: 'od' },
    { id: 'pq', label: 'Pip Quill', kind: 'staff', stops: [{ at: '21:00', room: 'Cocktail lounge' }, { at: '00:00', room: 'Underground counting room' }] },
    { id: 'iv', label: 'Ivo Stark', kind: 'rival', stops: [{ at: '21:00', room: 'Security control room' }] }],
  disguises: [{ id: 'cook', label: 'Cook', floors: [-1], sees: 'Ivo Stark' }],
  events: [{ at: '22:00', id: 'sp', label: 'Speeches' }, { at: '00:00', id: 'fw', label: 'Fireworks', room: 'Showroom', fx: 'dawn' }],
  clocks: [{ name: 'Fuse', room: 'Security control room' }],
};
const checked = BALL.checkPlay(PLAY, ROOMS.map((r) => r.name));
if (checked.warnings.length) { console.log('FAIL the fixture play has warnings: ' + checked.warnings.join(' | ')); process.exit(1); }
const PARTS = {
  console: conFix.parts.console, campaign: { ...conFix.parts.campaign, src: { ...conFix.parts.campaign.src, exportedAt: NOW } },
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: NOW }, T: locFix.T, extra: locFix.extra,
    authored: { v: 1, sites: { [NAME]: { name: NAME, rel: 'x', map: { view: 'iso', theme: 'rulebook' }, patch: { district: 'Nowhere Ward', rooms: ROOMS }, play: checked.play } }, bind: {} } },
};

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-run-e2e-'));
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
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 300000);
const api = (method, p, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const gmState = async () => (await api('GET', '/gm/state')).json.doc;
const TOKEN = '#fffdf6';   /* the background of a combined token: one per occupied room */
const tokensIn = (page) => page.$eval('#gm-map', (m) => (m.innerHTML.match(/#fffdf6/g) || []).length);

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src || {}, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  const put = await api('PUT', '/campaign', {
    v: 1, session: { number: 1, startedAt: NOW, endedAt: null },
    crew: { name: 'The Lamplighters', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] },
    clocks: [{ id: 'c_fuse', name: 'Fuse', size: 6, filled: 2, kind: 'danger', hidden: true }], log: [] });
  check(put.status === 200, 'the table holds a hidden Fuse clock');
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [], asked = [], answer = { no: false };
  async function open() {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1366, height: 1024 }, serviceWorkers: 'block', isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await c.addInitScript(() => { window.__B68_POLL_MS = 700; });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('dialog', (d) => { asked.push(d.message()); return answer.no ? d.dismiss() : d.accept(); });
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
    return { c, page };
  }
  const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
  const clock = (page) => page.$eval('#gm-run-clock', (e) => e.textContent.trim());

  /* the GM's laptop opens first, so a character can be filed by the page's own adapter, then the card is the authored one */
  const G0 = await open();
  const spec = await G0.page.evaluate(() => window.B68.BASE_FIGURE);
  const pcDoc = (name) => ({ v: 2, name, alias: '', code: '', playbook: 'hound', playbookName: 'Hound', spec, sheet: { name }, play: { vice: '', purveyor: '', contacts: [], clocks: [] } });
  check((await api('PUT', '/characters/run-pc1', pcDoc('Cass Fenn'))).status === 200, 'an invented PC is filed');
  const t0 = new Date().toISOString();
  check((await api('PATCH', '/gm/state', { cards: { location: { hid: 'h_run', auth: NAME, label: NAME + ' · Nowhere Ward', at: t0 } }, loc: { map: { view: 'iso', theme: 'rulebook', layer: 'gm', reveal: { public: true, working: false, controlled: false, secure: false } } } })).status === 200, 'the Location card is the authored site');
  await G0.c.close();

  const G = await open();
  await G.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await G.page.keyboard.press('b');
  await G.page.waitForSelector('#gm-run', { timeout: 20000 });
  check(await G.page.$eval('#gm-run-tabs', (t) => [...t.querySelectorAll('button')].map((b) => b.textContent).join()) === 'All,Under,Ground,Upper,Loft', 'the floor tabs, All then by level number');
  check(await clock(G.page) === '21:00', 'the strip opens at the start of the evening');
  await G.page.waitForSelector('#gm-map svg', { timeout: 20000 });
  check(await tokensIn(G.page) === 3, 'one token per occupied room at 21:00 (three rooms)');
  check(!(await gmState()).ball, 'looking wrote nothing');
  await G.page.evaluate(() => { const m = document.querySelector('#gm-run'); if (m) m.scrollIntoView({ block: 'start' }); });
  await shot(G.page, 'run-01-open');

  /* Next window, then the slider across midnight (00:15 is 195 minutes in) */
  await G.page.click('[data-gm="run-next"]');
  check(await clock(G.page) === '23:30', 'Next window goes to 23:30');
  await G.page.evaluate(() => { const s = document.getElementById('gm-run-t'); s.value = '195'; s.dispatchEvent(new Event('input', { bubbles: true })); s.dispatchEvent(new Event('change', { bubbles: true })); });
  check(await clock(G.page) === '00:15', 'scrubbed across midnight: 00:15');
  check(await G.page.waitForFunction(() => /Odette Marsh[^]*Luxury penthouse/.test(document.getElementById('gm-run-side').textContent), null, { timeout: 5000 }).then(() => true, () => false), 'Odette is in the penthouse at 00:15');
  await G.page.focus('#gm-run'); await G.page.keyboard.press('ArrowRight');
  check(await clock(G.page) === '00:20', 'Right moves 5 minutes while the strip has the focus');
  await G.page.keyboard.press('ArrowLeft');
  check(await clock(G.page) === '00:15', 'and Left moves back');
  const sb = await until(async () => { const b = (await gmState()).ball; return b && b.t === 195 ? b : null; }, 8000);
  check(!!sb && sb.site === NAME, 'the time is saved in the GM state (' + JSON.stringify(sb) + ')');

  /* floors */
  await G.page.click('#gm-run-tabs [data-v="2"]');
  await G.page.waitForFunction(() => document.querySelector('#gm-map svg'), null, { timeout: 5000 });
  check(await until(async () => (await tokensIn(G.page)) === 1, 5000), 'the Loft floor shows one token (Odette and Wren share the penthouse)');
  check(await G.page.$$eval('#gm-run-rooms [data-gm="run-room"]', (b) => b.map((x) => x.getAttribute('data-room')).join()) === 'Luxury penthouse', 'and the room list follows the floor');
  await shot(G.page, 'run-02-top-floor');
  await G.page.click('#gm-run-tabs [data-v="all"]');
  check(await until(async () => (await tokensIn(G.page)) >= 3, 5000), 'All brings the other floors back');

  /* the disguise: Cook; the control room is desperate, and Ivo (whom a cook sees through) is in it */
  await G.page.selectOption('#gm-run-lens', 'cook');
  check(await until(async () => await G.page.$eval('#gm-map', (m) => m.innerHTML.includes('#d11')), 5000), 'the red ring is on the map for the one room where Ivo stands');
  check(await G.page.$eval('#gm-run-rooms [data-room="Security control room"]', (b) => b.className.includes('pos-desperate') && b.className.includes('danger')), 'and the room chip says desperate and danger');
  await shot(G.page, 'run-03-cook');

  /* a PC, then the table clock */
  await G.page.click('#gm-run-place [data-gm="run-pc"]');
  await G.page.click('#gm-run-rooms [data-room="Cocktail lounge"]');
  check(await until(async () => { const b = (await gmState()).ball; return b && b.crew && b.crew['run-pc1'] === 'Cocktail lounge'; }, 8000), 'the PC is in the lounge, saved');
  check(await until(async () => (await tokensIn(G.page)) >= 3, 3000), 'still one token per room');
  await G.page.click('#gm-run-place [data-gm="run-clock"]');
  await G.page.click('#gm-run-rooms [data-room="Security control room"]');
  check(await until(async () => { const b = (await gmState()).ball; return b && b.pins && b.pins.c_fuse === 'Security control room'; }, 8000), 'the Fuse clock is pinned to the control room, saved');
  /* the chips were rebuilt by those taps: the focus went to the same control, so Left and Right still work with no explicit focus */
  const c0 = await clock(G.page); await G.page.keyboard.press('ArrowRight');
  check(await clock(G.page) !== c0, 'Left and Right still work after tapping chips and rooms (' + c0 + ' then ' + await clock(G.page) + ')');
  await G.page.keyboard.press('ArrowLeft');
  check(await clock(G.page) === c0, 'and back again');
  await until(async () => { const b = (await gmState()).ball; return b && b.t === 195 && b.pins && b.pins.c_fuse; }, 8000);
  await shot(G.page, 'run-04-placed');
  const before = await gmState();
  await G.c.close();

  /* a reload: the same */
  const R = await open();
  await R.page.keyboard.press('b');
  await R.page.waitForSelector('#gm-run', { timeout: 20000 });
  await R.page.waitForSelector('#gm-map svg', { timeout: 20000 });
  check(await clock(R.page) === '00:15', 'after a reload: the same time');
  check(await R.page.$eval('#gm-run-lens', (s) => s.value) === 'cook', 'the same disguise');
  check(await R.page.$eval('#gm-run-place', (p) => /Cass Fenn\s*Cocktail lounge/.test(p.textContent) && /Fuse 2\/6\s*Security control room/.test(p.textContent)), 'the same crew and pin');
  check(JSON.stringify((await gmState()).ball) === JSON.stringify(before.ball), 'and the server still holds exactly that state');
  check(await R.page.$eval('#gm-map', (m) => m.innerHTML.includes('#d11') && m.innerHTML.includes('#fffdf6')), 'the map has its tokens again');

  /* nothing reaches the iPad */
  await R.page.click('[data-gm="layer"][data-v="player"]');
  check(await R.page.$eval('#gm-map', (m) => !m.innerHTML.includes('#fffdf6')), 'the player layer\'s map has no token');
  const s0 = (await api('GET', '/gm/display')).json.seq;
  await R.page.click('[data-gm="ipad"]');
  const d = await until(async () => { const x = (await api('GET', '/gm/display')).json; return x.seq > s0 ? x : null; }, 8000);
  const all = JSON.stringify(d || {});
  check(!!d && d.display.kind === 'svg', 'Show on iPad sent the player map');
  check(!!d && ['"ball"', 'Odette', 'Wren', 'Pip Quill', 'Ivo', 'Cook', 'Speeches', 'Fireworks', 'Cass Fenn', 'Gala night', '#d11', '#fffdf6'].every((w) => !all.includes(w)), 'the iPad payload carries no ball, no people, no disguise, no event and no token');
  await R.page.click('[data-gm="layer"][data-v="gm"]');
  check(await R.page.$eval('#gm-map', (m) => m.innerHTML.includes('#fffdf6')), 'the GM layer has them again');

  /* the false dawn (M5): a button on the strip and on the fx event in Next; it asks first and never fires by itself */
  const amb = async () => (await api('GET', '/gm/ambient')).json;
  await R.page.evaluate(() => { const sl = document.getElementById('gm-run-t'); sl.value = '150'; sl.dispatchEvent(new Event('input', { bubbles: true })); sl.dispatchEvent(new Event('change', { bubbles: true })); });
  check(await clock(R.page) === '23:30', 'scrubbed to 23:30, where the fireworks are next');
  check(await R.page.waitForFunction(() => { const b = document.querySelector('#gm-run-side [data-gm="run-dawn"]'); return !!b && /00:00 Fireworks/.test(b.textContent) && /False dawn/.test(b.textContent); }, null, { timeout: 5000 }).then(() => true, () => false), 'the fx event in the Next list carries a False dawn button');
  check(await R.page.$eval('#gm-run .gm-run-btns [data-gm="run-dawn"]', (b) => /False dawn/.test(b.textContent)), 'and the strip has its own False dawn button');
  check(await R.page.$$eval('#gm-run-side .chip:not([data-gm])', (c) => c.every((x) => !/Fireworks/.test(x.textContent))) && await R.page.$$eval('#gm-run-side [data-gm="run-dawn"]', (c) => c.length) === 1, 'only the fx event has a button (Speeches is gone by 23:30; one button)');
  const a0 = await amb();
  await R.page.click('[data-gm="run-next"]'); await R.page.click('[data-gm="run-step"][data-d="15"]'); await R.page.keyboard.press('ArrowRight');
  await sleep(1500);
  const a1 = await amb();
  check(!a1.doc.overlay && !a0.doc.overlay, 'moving the clock past midnight and onto the fireworks sends no overlay (it never fires by itself)');
  answer.no = true; asked.length = 0;
  await R.page.click('#gm-run .gm-run-btns [data-gm="run-dawn"]');
  await sleep(1500);
  const a2 = await amb(), st2 = await gmState();
  check(asked.length === 1 && /The iPad goes white for 30 seconds/.test(asked[0]), 'the button asks first (' + asked.join(' | ') + ')');
  check(!a2.doc.overlay && !(st2.ball && st2.ball.dawn), 'a no sends nothing and records nothing (' + JSON.stringify({ a0: a0.seq, a1: a1.seq, a2: a2.seq }) + ')');
  answer.no = false; asked.length = 0;
  await R.page.evaluate(() => { const sl = document.getElementById('gm-run-t'); sl.value = '150'; sl.dispatchEvent(new Event('input', { bubbles: true })); sl.dispatchEvent(new Event('change', { bubbles: true })); });
  await R.page.waitForSelector('#gm-run-side [data-gm="run-dawn"]', { timeout: 5000 });
  const D = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1366, height: 1024 }, serviceWorkers: 'block' });
  const dp = await D.newPage();
  dp.on('pageerror', (e) => errors.push('display pageerror: ' + e.message));
  await dp.goto(BASE + '/#display'); await dp.waitForSelector('.dp-overlay', { state: 'attached', timeout: 20000 });
  check(await dp.waitForFunction(() => /Updated|Waiting/.test((document.querySelector('.dp-status-text') || {}).textContent || ''), null, { timeout: 20000 }).then(() => true, () => false) && !(await dp.$('.dp-ov-dawn')), 'the iPad is up and shows no dawn yet');
  await R.page.click('#gm-run-side [data-gm="run-dawn"]');
  check(asked.length === 1 && /The iPad goes white for 30 seconds/.test(asked[0]), 'the Next chip asks the same question');
  const a3 = await until(async () => { const a = await amb(); return a.doc.overlay ? a : null; }, 8000);
  check(!!a3 && a3.doc.overlay.kind === 'fx' && a3.doc.overlay.fx === 'dawn' && a3.doc.overlay.ms === 30000 && Object.keys(a3.doc.overlay).sort().join() === 'at,fx,id,kind,ms', 'a yes sends exactly { kind fx, fx dawn, ms 30000 } (' + JSON.stringify(a3 && a3.doc.overlay) + ')');
  check(await dp.waitForSelector('.dp-overlay .dp-ov-dawn', { timeout: 20000 }).then(() => true, () => false), 'and the iPad shows the dawn');
  const rec = await until(async () => { const b = (await gmState()).ball; return b && b.dawn ? b : null; }, 8000);
  check(!!rec && typeof rec.dawn.at === 'string' && Object.keys(rec.dawn).join() === 'at' && rec.lens === 'cook' && rec.crew && rec.pins, 'ball.dawn is recorded as { at } with the rest of the run kept (' + JSON.stringify(rec && rec.dawn) + ')');
  check((await api('GET', '/gm/display')).json.ambient.doc.overlay.age >= 0, 'the display call reports the age of the running dawn');
  check((await api('PATCH', '/gm/ambient', { overlay: null })).status === 200 && await dp.waitForFunction(() => !document.querySelector('.dp-ov-dawn'), null, { timeout: 15000 }).then(() => true, () => false), 'clearing takes the dawn off the iPad');
  await D.close();

  /* the table ticks the pinned clock: the strip and the map follow by themselves */
  check((await api('PATCH', '/campaign', { clockOps: [{ id: 'c_fuse', filled: 4 }] })).status === 200, 'the Fuse clock is ticked on the table');
  check(await R.page.waitForFunction(() => /Fuse 4\/6/.test(document.getElementById('gm-run-place').textContent), null, { timeout: 15000 }).then(() => true, () => false), 'the strip shows 4/6 at once');

  /* timing: the strip's own scrub, ten steps, the map redrawn each time */
  const ms = await R.page.evaluate(async () => {
    const out = [];
    for (let i = 0; i < 10; i++) { const t = performance.now(); const e = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }); document.getElementById('gm-run').dispatchEvent(e); out.push(performance.now() - t); await new Promise((r) => setTimeout(r, 260)); }
    return out;
  });
  const worst = Math.max(...ms);
  console.log('     a keyboard step (state, strip, 200 ms later the map): ' + ms.map((x) => x.toFixed(1)).join(' ') + ' ms in the handler');
  check(worst < 100, 'a step costs ' + worst.toFixed(1) + ' ms on the page before the debounced draw');
  check(!errors.length, 'no page errors: ' + errors.slice(0, 3).join(' | '));
  await browser.close();
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
clearTimeout(timeout);
console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASSED'));
process.exit(failed ? 1 : 0);
