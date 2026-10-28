// The Location map on map kit 0.7 at the table, end to end against a real local Worker (wrangler dev, DEV_USER) on PORT (default
// 8866), with only invented fixture tables: the GM page at the iPad's size (1366 x 1024 landscape) rolls a site (iso by default),
// shows it on the iPad, opens a band (it asks) and the iPad updates by itself, closes it (no ask) and the iPad follows; the street
// and the lit plate at Night in the rain go to the iPad; the iPad (#display, the GM signed in) draws each map it is sent. Nothing a
// player must not see is in what the server holds. GM.md, "Location" (Live reveal).
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node checks/runtime/gm-maps.e2e.mjs
// PW_MODULE=<path to playwright> picks the Playwright install; GM_SHOTS=<dir> saves the screenshots there.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8866);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const SHOTS = process.env.GM_SHOTS || '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const conFix = JSON.parse(readFileSync(path.join(FIX, 'console-pack.json'), 'utf8'));
const locFix = JSON.parse(readFileSync(path.join(FIX, 'location-pack.json'), 'utf8'));
const BALL = require(path.join(ROOT, 'app', 'gm', 'ball.js'));
const NOW = new Date().toISOString();
/* an INVENTED authored site for the run-the-site part at the end (M3): a made-up venue, rooms from the map kit's catalogue */
const NAME = 'The Pelican Rooms';
const ROOMS = [
  { name: 'Showroom', band: 'public', detail: 'Chairs.' }, { name: 'Cocktail lounge', band: 'public', detail: 'Glass.' },
  { name: 'Security control room', band: 'working', detail: 'Screens.' }, { name: 'Private card rooms', band: 'controlled', detail: 'Cards.' },
  { name: 'Underground counting room', band: 'working', detail: 'Coins.' }, { name: 'Luxury penthouse', band: 'secure', isTarget: true, detail: 'The strongbox.' }];
const PLAY = {
  v: 1, clock: { start: '21:00', end: '02:00', label: 'Gala night' }, floors: { '-1': 'Under', '0': 'Ground', '1': 'Upper', '2': 'Loft' },
  routes: [{ id: 'lift', from: 'Cocktail lounge', to: 'Luxury penthouse', via: 'the service lift', dir: 'up', needs: 'a key', watched: true }],
  people: [
    { id: 'od', label: 'Odette Marsh', kind: 'target', stops: [{ at: '21:00', room: 'Showroom' }, { at: '23:30', room: 'Private card rooms' }] },
    { id: 'wr', label: 'Wren Tully', kind: 'guard', with: 'od' },
    { id: 'iv', label: 'Ivo Stark', kind: 'rival', stops: [{ at: '21:00', room: 'Security control room' }] }],
  disguises: [{ id: 'cook', label: 'Cook', floors: [-1], sees: 'Ivo Stark' }],
  events: [{ at: '22:00', id: 'sp', label: 'Speeches' }],
  clocks: [{ name: 'Fuse', room: 'Security control room' }],
};
const checked = BALL.checkPlay(PLAY, ROOMS.map((r) => r.name));
if (checked.warnings.length) { console.log('FAIL the fixture play has warnings: ' + checked.warnings.join(' | ')); process.exit(1); }
const PACK = { format: 1, exportedAt: NOW, parts: {
  console: conFix.parts.console, campaign: { ...conFix.parts.campaign, src: { ...conFix.parts.campaign.src, exportedAt: NOW } },
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: NOW }, T: locFix.T, extra: locFix.extra,
    authored: { v: 1, sites: { [NAME]: { name: NAME, rel: 'x', map: { view: 'iso', theme: 'rulebook' }, patch: { district: 'Nowhere Ward', rooms: ROOMS }, play: checked.play } }, bind: {} } }
} };

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-maps-e2e-'));
const packFile = path.join(stateDir, 'b68-gm-pack.json');
writeFileSync(packFile, JSON.stringify(PACK));
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
const display = async () => (await api('GET', '/gm/display')).json;
const text = (svg) => String(svg || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').toLowerCase();

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [], asked = [];
  async function open(hash, answer) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1366, height: 1024 }, serviceWorkers: 'block', isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await c.addInitScript(() => { window.__B68_POLL_MS = 700; });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(hash + ': ' + m.text()); });
    page.on('pageerror', (e) => errors.push(hash + ' pageerror: ' + e.message));
    page.on('dialog', (d) => { asked.push(d.message()); return answer && answer.no ? d.dismiss() : d.accept(); });
    await page.goto(BASE + '/' + hash);
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    return { ctx: c, page };
  }
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
  const quiet = (page) => page.waitForFunction(() => !document.getElementById('toastMsg').textContent && !document.getElementById('toastErr').textContent, null, { timeout: 9000 }).catch(() => {});

  /* the GM: import the invented pack, roll a site */
  const answer = { no: false };
  const G = await open('#gm', answer);
  await G.page.waitForSelector('#gm-file', { state: 'attached', timeout: 20000 });
  await G.page.setInputFiles('#gm-file', packFile); await G.page.waitForSelector('#gm-prev table', { timeout: 10000 });
  await G.page.click('[data-gm="upload"]'); await G.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 20000 });
  await G.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await G.page.keyboard.press('b'); await G.page.click('[data-gm="locroll"]'); await G.page.waitForSelector('#gm-loc .gm-loccard', { timeout: 10000 });
  check(await G.page.$eval('#gm-m-view', (s) => s.value === 'iso') && !!(await G.page.$('#gm-map svg')), 'a roll draws the GM-layer iso at once');
  check(await G.page.$$eval('#gm-m-view option', (o) => o.map((x) => x.value).join()) === 'iso,rings,plan,section,street' && await G.page.$$eval('#gm-m-theme option', (o) => o.map((x) => x.value).join()) === 'rulebook,blueprint,casefile,board,plate', 'the views and themes of map kit 0.7');
  check(!!(await G.page.$('#gm-m-time')) && !!(await G.page.$('#gm-m-weather')), 'Time and Weather in the View & theme fold');
  const roll = await G.page.evaluate(() => window.B68GmPage._state().locRoll);
  const secretsAt = (shown) => roll.rooms.filter((r) => !shown.includes(r.band)).map((r) => r.name.toLowerCase()).filter((n) => !['basement', 'ground floor', 'upper floor', 'top floor'].includes(n) && !roll.rooms.some((r) => shown.includes(r.band) && r.name.toLowerCase() === n))
    .concat([roll.physThreatName, roll.socThreatName].map((x) => String(x || '').toLowerCase())).filter((x) => x.length >= 4);
  await G.page.evaluate(() => { const m = document.querySelector('#gm-loc .gm-mapbox'); if (m) m.scrollIntoView({ block: 'start' }); });
  await quiet(G.page); await shot(G.page, 'maps1-01-gm-iso-gm-layer');

  /* the player layer to the iPad, then live reveal */
  await G.page.click('[data-gm="layer"][data-v="player"]');
  const s0 = (await display()).seq;
  await G.page.click('[data-gm="ipad"]');
  const d1 = await until(async () => { const d = await display(); return d.seq > s0 ? d : null; }, 8000);
  check(!!d1 && d1.display.kind === 'svg' && /surveyed: public$/.test(d1.display.caption), 'Show on iPad: the player copy (' + (d1 && d1.display.caption) + ')');
  const want1 = await G.page.evaluate(() => { const st = window.B68GmPage._state(); return window.B68Map.render(st.locRoll, Object.assign({ view: 'iso', theme: 'rulebook', layer: 'player', reveal: ['public'] }, window.B68GmPage._pure.IPAD_MAP)).svg; });
  const ids = (s) => String(s || '').replace(/b68m\d+-/g, 'b68m-');
  check(!!d1 && ids(d1.display.svg) === ids(want1), 'the iPad copy is the kit\'s player layer at the iPad\'s size');
  check(!!d1 && !secretsAt(['public']).some((n) => text(d1.display.svg).includes(n)), 'the iPad copy names nothing hidden');
  check(await G.page.waitForSelector('.gm-reveal .gm-live', { timeout: 5000 }).then(() => true, () => false), 'the Reveal legend says Live on the iPad');

  const D = await open('#display');
  check(await D.page.waitForSelector('#display-page .dp-map-frame svg', { timeout: 20000 }).then(() => true, () => false), '#display draws the map');
  await sleep(1200); await shot(D.page, 'maps1-02-ipad-iso-public');

  asked.length = 0;
  await G.page.check('[data-reveal="working"]');
  const d2 = await until(async () => { const d = await display(); return d.seq > d1.seq ? d : null; }, 8000);
  check(asked.length === 1 && /opening the working band shows it to the players now/.test(asked[0]), 'opening a band asks first (' + asked.join(' | ') + ')');
  check(!!d2 && /surveyed: public, working$/.test(d2.display.caption), 'and the iPad gets the player copy again at once (' + (d2 && d2.display.caption) + ')');
  check(!!d2 && !secretsAt(['public', 'working']).some((n) => text(d2.display.svg).includes(n)), 'the new copy names nothing still hidden');
  check(await D.page.waitForFunction(() => /working/.test((document.querySelector('#display-page .dp-map-frame svg') || { getAttribute: () => '' }).getAttribute('aria-label') || ''), null, { timeout: 10000 }).then(() => true, () => false), '#display redraws by itself with the working band');
  await sleep(1200); await shot(D.page, 'maps1-03-ipad-iso-working');
  await G.page.evaluate(() => { const m = document.querySelector('#gm-loc .gm-mapbox'); if (m) m.scrollIntoView({ block: 'start' }); }); await quiet(G.page); await shot(G.page, 'maps1-04-gm-live');

  asked.length = 0;
  await G.page.uncheck('[data-reveal="working"]');
  const d3 = await until(async () => { const d = await display(); return d.seq > d2.seq ? d : null; }, 8000);
  check(asked.length === 0 && !!d3 && /surveyed: public$/.test(d3.display.caption), 'closing a band does not ask, and the iPad follows');

  answer.no = true; asked.length = 0;
  await G.page.click('[data-reveal="controlled"]');
  await sleep(1500);
  const noSeq = (await display()).seq, noChecked = await G.page.$eval('[data-reveal="controlled"]', (x) => x.checked), noDoc = await G.page.evaluate(() => window.B68GmPage._state().doc.loc.map.reveal.controlled);
  check(asked.length === 1 && noSeq === d3.seq && !noChecked && noDoc !== true, 'a no keeps the band shut and sends nothing (' + JSON.stringify({ asked: asked.length, sent: noSeq !== d3.seq, checked: noChecked, doc: noDoc }) + ')');
  answer.no = false;

  /* the street and the plate, at Night, in the rain */
  await G.page.evaluate(() => { const d = document.querySelector('details.gm-mapopts'); if (d) d.open = true; });
  await G.page.selectOption('#gm-m-view', 'street'); await G.page.selectOption('#gm-m-theme', 'plate');
  await G.page.selectOption('#gm-m-time', 'Night'); await G.page.selectOption('#gm-m-weather', 'rain');
  check(/street · plate · at night · rain/.test(await G.page.textContent('.gm-mapopts summary')), 'the fold\'s line names the view, theme, time and weather');
  const s4 = (await display()).seq;
  check(s4 === d3.seq, 'changing the view, theme, time or weather sends nothing by itself');
  await G.page.click('[data-gm="ipad"]');
  const d4 = await until(async () => { const d = await display(); return d.seq > s4 ? d : null; }, 8000);
  const want4 = await G.page.evaluate(() => { const st = window.B68GmPage._state(); return window.B68Map.render(st.locRoll, Object.assign({ view: 'street', theme: 'plate', layer: 'player', reveal: ['public'], time: 'Night', weather: 'rain' }, window.B68GmPage._pure.IPAD_MAP)).svg; });
  check(!!d4 && ids(d4.display.svg) === ids(want4), 'Show on iPad: the street on the plate at Night in the rain');
  check(!!d4 && roll.watcher && !text(d4.display.svg).includes(String(roll.watcher).replace(/,.*$/, '').toLowerCase()), 'the street\'s player copy has no watcher');
  await D.page.waitForFunction((n) => (document.querySelector('#display-page .dp-map-frame svg') || {}).outerHTML && document.querySelector('#display-page .dp-map-frame svg').outerHTML.length !== n, (d2.display.svg || '').length, { timeout: 10000 }).catch(() => {});
  await sleep(4500); await shot(D.page, 'maps1-05-ipad-street-plate-night-rain');
  await G.page.evaluate(() => { const m = document.querySelector('#gm-loc .gm-mapbox'); if (m) m.scrollIntoView({ block: 'start' }); }); await quiet(G.page); await shot(G.page, 'maps1-06-gm-street-plate');

  /* the iso on the plate at Bluetime */
  await G.page.selectOption('#gm-m-view', 'iso'); await G.page.selectOption('#gm-m-time', 'Bluetime'); await G.page.selectOption('#gm-m-weather', '');
  await G.page.click('[data-gm="ipad"]');
  const d5 = await until(async () => { const d = await display(); return d.seq > d4.seq ? d : null; }, 8000);
  check(!!d5 && d5.display.kind === 'svg', 'Show on iPad: the iso on the plate at Bluetime');
  await sleep(2000); await shot(D.page, 'maps1-07-ipad-iso-plate-bluetime');

  /* nothing is drawn over a map: the drawn content box of the svg (getBBox through getScreenCTM, clipped to the svg element)
     against every overlay the display puts on top (the caption bar, the corner status), landscape and portrait */
  const geometry = () => {
    const all = document.querySelectorAll('#display-page .dp-map-frame svg'), s = all[all.length - 1]; if (!s) return null;   /* the newest stage (the old one fades out) */
    const v = (s.getAttribute('data-vb') || '').split(' ').map(Number), b0 = s.getBBox();
    const x0 = Math.max(b0.x, v[0]), y0 = Math.max(b0.y, v[1]), x1 = Math.min(b0.x + b0.width, v[0] + v[2]), y1 = Math.min(b0.y + b0.height, v[1] + v[3]);
    const bb = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, m = s.getScreenCTM(), el = s.getBoundingClientRect();
    const pt = (x, y) => ({ x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f });
    const p1 = pt(bb.x, bb.y), p2 = pt(bb.x + bb.width, bb.y + bb.height);
    const content = { l: Math.max(el.left, Math.min(p1.x, p2.x)), t: Math.max(el.top, Math.min(p1.y, p2.y)), r: Math.min(el.right, Math.max(p1.x, p2.x)), b: Math.min(el.bottom, Math.max(p1.y, p2.y)) };
    const box = (q) => { const x = document.querySelector(q); if (!x) return null; const st = getComputedStyle(x); if (st.display === 'none' || st.visibility === 'hidden' || +st.opacity === 0) return null; const r = x.getBoundingClientRect(); return r.width && r.height ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; };
    const over = (a, c) => !!a && a.l < c.r - 0.5 && a.r > c.l + 0.5 && a.t < c.b - 0.5 && a.b > c.t + 0.5;
    const stage = s.closest('.dp-stage'), capEl = stage && stage.querySelector('.dp-strip');
    const cap = capEl ? (() => { const r = capEl.getBoundingClientRect(); return r.width && r.height ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null; })() : null, status = box('.dp-status');
    return { content, cap: !!cap, capOver: over(cap, content), statusOver: over(status, content), label: s.getAttribute('aria-label') };
  };
  const untitled = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="#15120e"/><circle cx="800" cy="450" r="300" fill="#c33"/></svg>';
  for (const [w, h] of [[1366, 1024], [1024, 1366]]) {
    await D.page.setViewportSize({ width: w, height: h });
    for (const [what, put] of [['the map (iso)', null], ['the street on the plate', 'street'], ['an svg without its own title (the clocks)', 'untitled'], ['a chase strip', 'chase']]) {
      const before = (await display()).seq;
      if (put === 'street') { await G.page.selectOption('#gm-m-view', 'street'); await G.page.click('[data-gm="ipad"]'); }
      else if (put === 'untitled') await api('PUT', '/gm/display', { kind: 'svg', title: 'Clocks', caption: 'Lose them 3 / 6', svg: untitled });
      else if (put === 'chase') { const sv = await G.page.evaluate(() => { const K = window.B68Map; return K.chase(K.chaseTick(K.chaseNew({ street: 'a road bridge over a canal' }), { ticks: 2, caption: 'Two wheels through a fruit stand.' }), { layer: 'player' }).svg; }); await api('PUT', '/gm/display', { kind: 'svg', title: 'The chase', caption: 'Lose them', svg: sv }); }
      else { await G.page.selectOption('#gm-m-view', 'iso'); await G.page.click('[data-gm="ipad"]'); }
      const sent = await until(async () => { const d = await display(); return d.seq > before ? d.display : null; }, 8000);
      const want = sent ? sent.title + (sent.caption ? ' · ' + sent.caption : '') : '';
      await D.page.waitForFunction((l) => { const a = document.querySelectorAll('#display-page .dp-map-frame svg'), s = a[a.length - 1]; return !!s && s.getAttribute('aria-label') === l && document.querySelectorAll('#display-page .dp-stage').length === 1; }, want, { timeout: 15000 }).catch(() => {});
      await sleep(800);
      const g = await D.page.evaluate(geometry);
      const tag = w + '×' + h + ' ' + what;
      check(!!g && !g.capOver, tag + ': no caption over the drawing' + (g ? ' (caption bar: ' + g.cap + ')' : ''));
      check(!!g && (put === 'untitled' ? g.cap : !g.cap), tag + (put === 'untitled' ? ': its title and caption sit in a bar under it' : ': it names itself, so no caption is added'));
      check(!!g && !g.statusOver, tag + ': the corner status is clear of the drawing');
      await shot(D.page, 'maps1-ipad-' + (w > h ? 'landscape' : 'portrait') + '-' + (put || 'iso'));
    }
  }
  await D.page.setViewportSize({ width: 1366, height: 1024 });

  /* ---- M3: an authored site, a PC and the table's clocks: the crew marker and a visible pinned clock follow the GM onto the iPad,
     live, in revealed rooms only; a hidden clock, a person and a marker in a hidden room never do ---- */
  const spec = await G.page.evaluate(() => window.B68.BASE_FIGURE);
  await G.ctx.close();
  const pcDoc = (name) => ({ v: 2, name, alias: '', code: '', playbook: 'hound', playbookName: 'Hound', spec, sheet: { name }, play: { vice: '', purveyor: '', contacts: [], clocks: [] } });
  check((await api('PUT', '/characters/run-pc1', pcDoc('Cass Fenn'))).status === 200, 'an invented PC is filed');
  check((await api('PUT', '/campaign', { v: 1, session: { number: 1, startedAt: NOW, endedAt: null },
    crew: { name: 'The Lamplighters', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] },
    clocks: [{ id: 'c_fuse', name: 'Fuse', size: 6, filled: 2, kind: 'danger' }, { id: 'c_alarm', name: 'Vault alarm', size: 4, filled: 1, kind: 'danger', hidden: true }], log: [] })).status === 200, 'the table holds a visible Fuse clock and a hidden alarm');
  check((await api('PATCH', '/gm/state', { cards: { location: { hid: 'h_m3', auth: NAME, seed: null, label: NAME + ' · Nowhere Ward', at: new Date().toISOString() } }, ball: null,
    loc: { map: { view: 'rings', theme: 'rulebook', layer: 'player', reveal: { public: true, working: false, controlled: false, secure: false } } } })).status === 200, 'the Location card is the authored site, on the player layer');
  const R = await open('#gm', answer);
  await R.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  await R.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await R.page.keyboard.press('b');
  await R.page.waitForSelector('#gm-run', { timeout: 20000 });
  const roll3 = await R.page.evaluate(() => window.B68GmPage._state().locRoll);
  const nameIn = (svg, w) => text(svg).includes(w.toLowerCase());
  /* what the player copy should be, drawn here with the page's own builder and the kit: the markers it is given, at the public band */
  const expect = (crew, pins, pcs) => R.page.evaluate(({ crew, pins, pcs }) => {
    const P = window.B68GmPage._pure, st = window.B68GmPage._state(), roll = st.locRoll, shown = roll.rooms.filter((r) => r.band === 'public').map((r) => r.name);
    const clocks = [{ id: 'c_fuse', size: 6, filled: 2, hidden: false }, { id: 'c_alarm', size: 4, filled: 1, hidden: true }];
    const tokens = P.playerTokens({ crew, pins }, shown, clocks, pcs);
    return window.B68Map.render(roll, Object.assign(P.mapOpts({ view: 'rings', theme: 'rulebook' }, 'player', ['public'], P.IPAD_MAP), tokens.length ? { tokens } : {})).svg;
  }, { crew, pins, pcs });
  const PCS = [{ id: 'run-pc1', name: 'Cass Fenn' }];
  const sendAndWait = async (act, after) => { const before = (await display()).seq; await act(); return until(async () => { const d = await display(); return d.seq > before ? d : null; }, 9000); };
  const roomBtn = (n) => R.page.click('#gm-run-rooms [data-room="' + n + '"]');
  const armPc = () => R.page.click('#gm-run-place [data-gm="run-pc"]');
  const armClock = (id) => R.page.click('#gm-run-place [data-gm="run-clock"][data-id="' + id + '"]');

  const m0 = await sendAndWait(() => R.page.click('[data-gm="ipad"]'));
  check(!!m0 && m0.display.kind === 'svg' && !/#fffdf6/.test(m0.display.svg), 'Show on iPad: the authored site, no markers yet (nothing is placed)');
  check(!!m0 && ids(m0.display.svg) === ids(await expect({}, {}, PCS)), 'and it is byte for byte the kit\'s player copy (no tokens key)');
  check(await R.page.waitForSelector('.gm-reveal .gm-live', { timeout: 5000 }).then(() => true, () => false), 'live on the iPad');

  /* the first marker: Cass into the lounge (public) */
  await armPc();
  const m1 = await sendAndWait(() => roomBtn('Cocktail lounge'));
  check(!!m1 && ids(m1.display.svg) === ids(await expect({ 'run-pc1': 'Cocktail lounge' }, {}, PCS)) && (m1.display.svg.match(/#fffdf6/g) || []).length === 1 && nameIn(m1.display.svg, 'Cass Fenn'), 'a marker placed reaches the iPad at once: Cass in the lounge, one token (' + (m1 && m1.seq) + ')');
  await D.page.waitForFunction(() => /CASS FENN/.test((document.querySelector('#display-page .dp-map-frame svg') || { outerHTML: '' }).outerHTML), null, { timeout: 15000 }).then(() => check(true, '#display draws the marker'), () => check(false, '#display draws the marker'));
  await sleep(1500); await shot(D.page, 'maps3-01-ipad-marker-lounge'); await shot(R.page, 'maps3-02-gm-live');

  /* the marker moves: Cass to the showroom */
  await armPc();
  const m2 = await sendAndWait(() => roomBtn('Showroom'));
  check(!!m2 && m2.seq > m1.seq && ids(m2.display.svg) === ids(await expect({ 'run-pc1': 'Showroom' }, {}, PCS)) && ids(m2.display.svg) !== ids(m1.display.svg), 'a marker moved reaches the iPad: Cass in the showroom now');

  /* the visible clock pinned in the lounge adds its pie; the hidden one pinned in the showroom adds nothing and sends nothing */
  await armClock('c_fuse');
  const m3 = await sendAndWait(() => roomBtn('Cocktail lounge'));
  check(!!m3 && ids(m3.display.svg) === ids(await expect({ 'run-pc1': 'Showroom' }, { c_fuse: 'Cocktail lounge' }, PCS)) && (m3.display.svg.match(/#fffdf6/g) || []).length === 2, 'a pinned clock the players can see joins as a pie: two tokens');
  await armClock('c_alarm'); await roomBtn('Showroom');
  check(await until(async () => { const b = (await api('GET', '/gm/state')).json.doc.ball; return b && b.pins && b.pins.c_alarm === 'Showroom'; }, 8000), 'the hidden alarm is pinned in the showroom');
  await sleep(1800);
  const m3b = await display();
  check(m3b.seq === m3.seq && !nameIn(m3b.display.svg, 'Vault alarm'), 'and nothing was sent for it: the hidden clock is not on the iPad');

  /* a marker in a room the players cannot see: Cass into the penthouse (secure) -> her marker leaves the iPad; opening the band brings it */
  await armPc();
  const m4 = await sendAndWait(() => roomBtn('Luxury penthouse'));
  check(!!m4 && !nameIn(m4.display.svg, 'Cass Fenn') && (m4.display.svg.match(/#fffdf6/g) || []).length === 1 && !nameIn(m4.display.svg, 'penthouse'), 'a marker in a hidden room is not on the iPad (only the pie stays), and the room is not named');
  asked.length = 0;
  const m5 = await sendAndWait(() => R.page.check('[data-reveal="secure"]'));
  check(asked.length === 1 && !!m5 && nameIn(m5.display.svg, 'Cass Fenn') && (m5.display.svg.match(/#fffdf6/g) || []).length === 2, 'opening the secure band asks, and then her marker is there');

  /* the whole payload: nothing of the people, the disguise, the lens or the timeline, and no hidden clock */
  const stuff = JSON.stringify([m0, m1, m2, m3, m4, m5].map((x) => x && x.display));
  check(['"ball"', 'Odette', 'Wren', 'Ivo', 'Cook', 'Speeches', 'Gala night', '#d11', 'Vault alarm', 'VAULT', '>OM<', '>WT<', '>IS<'].every((w) => !stuff.includes(w)), 'no person, disguise, event, ring or hidden clock was ever on the iPad');
  check(roll3 && roll3.auth === NAME, 'the card was the authored site throughout');
  await R.ctx.close();

  check(!errors.length, 'no page errors: ' + errors.slice(0, 3).join(' | '));
  await browser.close();
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
clearTimeout(timeout);
console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASSED'));
process.exit(failed ? 1 : 0);
