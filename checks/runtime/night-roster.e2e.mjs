// night-roster (the roster flows, KS12 of the kit and stage build) on the real GM page, Worker, campaign document, iPad and phones, night.who on.
// The invented table: Nell Arbuthnot and Ray Okonjo play; Tam Petrakis's player said no. The secrecy string is "Petrakis" (and Tam's id, ch-tam).
//   1. Start the night with two of three; the band's chip says 2 playing (KS12.7) and the sheet warns about a pack PC no filed character matches (KS12.1)
//   2. KS12.2 the Roll's Who chips: two, Tam's not among them
//   3. KS12.3 the iPad: the Run view's night is published: hud.crew and the cards carry Nell and Ray only, though all three are placed; the band's faces
//      the same; nothing about Tam in the display's GET or in the display page's DOM; Tam's phone gets no card, no hud entry, no told entry
//   4. KS12.4 the told list: Nell and Ray, Tell the crew, then Not here (1) with Tam; Tell the crew reaches two cards, not three
//   5. KS12.5 the polaroids: the GM page sends { polaroids } alone (a polaroid-only PATCH), the two playing; the server takes a polaroid-only body and refuses
//      a malformed one; the display's code holds no list
//   6. KS12.6 the absent packet's page opens with Tam's player ticked
//   7. KS12.7 the chip opens Who is here; adding Tam updates the chips, the iPad's crew, the cards, the told list and the polaroids without a reload
//   8. KS12.0 After's End: the polaroids go (null); the page's close drops the who sheet's Esc entry; the lead reads Carry on while a session is open
//   9. the stylesheet (KS12.0 item 6): the sheet's rows look the same with night.who alone (old sheets unlayered) and with kit.desk (old sheets layered)
//  10. the setting off: all three PCs everywhere (chips, hud.crew, cards, told list), no chip, who.js not fetched
// Every name is invented. SHOTS=<dir> writes the pictures.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9410] [SHOTS=<dir>] node checks/runtime/night-roster.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9410);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'ipad@example.test';
const SHOTS = process.env.SHOTS || '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), V2 = fx('pelican-play-v2.json');
const NOW = new Date().toISOString();
const SECRET = /Petrakis|ch-tam/;

const SITE = 'The Pelican Rooms';
const ROOMS = [
  { name: 'Showroom', band: 'public', detail: 'Chairs.' }, { name: 'Cocktail lounge', band: 'public', detail: 'Glass.' },
  { name: 'Security control room', band: 'working', detail: 'Screens.' }, { name: 'Private card rooms', band: 'controlled', detail: 'Cards.' },
  { name: 'Underground counting room', band: 'working', detail: 'Coins.' }, { name: 'Luxury penthouse', band: 'secure', isTarget: true, detail: 'The strongbox.' }];
// the Dovetail Crew: three players, three characters; the pack names them too (the Roll's Who chips), plus one PC nobody has filed
const PLAYERS = [['nell.player@example.test', 'Mabel Quist', 'ch-nell', 'Nell Arbuthnot'], ['ray.player@example.test', 'Dov Kessler', 'ch-ray', 'Ray Okonjo'], ['tam.player@example.test', 'Ada Vell', 'ch-tam', 'Tam Petrakis']];
const pc0 = con.parts.campaign.pcs[0];
const PACK_PCS = PLAYERS.map(([, , , name]) => ({ ...pc0, name, first: name.split(' ')[0] })).concat([{ ...pc0, name: 'Lotte Brand', first: 'Lotte' }]);
const PARTS = {
  console: con.parts.console, campaign: { ...con.parts.campaign, pcs: PACK_PCS, src: { ...con.parts.campaign.src, exportedAt: NOW } },
  prep: { src: { file: 'fixture/prep', exportedAt: NOW }, vault: 'Fixture', links: {}, notes: [] },
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: NOW }, T: loc.T, extra: loc.extra,
    authored: { v: 1, sites: { [SITE]: { name: SITE, rel: 'x', map: { view: 'iso', theme: 'rulebook' }, patch: { district: 'Nowhere Ward', rooms: ROOMS }, play: V2 } }, bind: {} } },
};

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-roster-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
delete env.ANTHROPIC_API_KEY; delete env.B68_ANTHROPIC_KEY;      /* no model: Blade's seats are never asked here */
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'DISPLAY_EMAILS:' + IPAD], { cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
function killServer() { if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} } }
process.on('exit', () => { killServer(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 150) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 540000);
const api = (method, p, body, who = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': who, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const campaign = async (who = GM) => (await api('GET', '/campaign', null, who)).json.doc;
const gmState = async () => (await api('GET', '/gm/state')).json.doc;
const ambient = async () => (await api('GET', '/gm/ambient')).json.doc;
const mission = async (who = GM) => { const d = await campaign(who); return d && d.mission ? d.mission : null; };
const hudNames = (m) => (m && m.hud && Array.isArray(m.hud.crew) ? m.hud.crew.map((c) => c.name).sort() : []);
const cardIds = (m) => (m && m.cards ? Object.keys(m.cards).sort() : []);
const crew = { name: 'The Dovetail Crew', type: '', lair: 'The Pelican Rooms', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] };

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src || {}, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  for (const [email, name] of PLAYERS) await api('PATCH', '/me', { name }, email);
  await api('GET', '/me', null, IPAD);
  const next = new Date(Date.now() - 10 * 60000).toISOString();
  const put = await api('PUT', '/campaign', { v: 1, session: { number: 4, startedAt: '2026-11-07T08:30:00.000Z', endedAt: '2026-11-07T12:10:00.000Z' }, crew, clocks: [],
    log: [{ at: '2026-11-07T12:10:00.000Z', by: GM, text: 'Session 4 ended' }],
    schedule: { options: {}, avail: {}, next: { at: next, minutes: 240, place: '', note: '', confirmedAt: null }, cadence: null, quorum: 0, attendance: {},
      rsvp: { 'nell.player@example.test': { at: next, v: 'in' }, 'tam.player@example.test': { at: next, v: 'out' } } } });
  check(put.status === 200, 'the table: session 4 ended, Tam\'s player said no to tonight');
  check((await api('PATCH', '/gm/state', { features: { 'night.who': true, phoneCards: true }, cards: { location: { hid: 'h_who', auth: SITE, label: SITE + ' · Nowhere Ward', at: NOW } } })).status === 200, 'night.who and phone cards are on');

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(w = 1366, h = 768, theme = '', place = 'before') {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w, height: h }, serviceWorkers: 'block', acceptDownloads: true, colorScheme: theme === 'night' ? 'dark' : 'light' });
    await c.addInitScript(atPlace(place));
    if (theme) await c.addInitScript({ content: 'try { localStorage.setItem("b68.theme", ' + JSON.stringify(theme === 'night' ? 'dark' : 'light') + '); } catch (e) {}' });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
    return { c, page };
  }
  const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
  const whoChips = (page) => page.$$eval('#gm-who .gm-whob', (l) => l.map((b) => b.getAttribute('data-v')));
  const tellRow = (page) => page.$eval('.rv-intel1 .rv-acts', (a) => ({
    here: Array.from(a.children).filter((b) => b.matches('[data-vv="tell"]')).map((b) => b.getAttribute('data-pc')),
    away: Array.from(a.querySelectorAll('.who-away [data-vv="tell"]')).map((b) => b.getAttribute('data-pc')),
    fold: a.querySelector('.who-away > summary') ? a.querySelector('.who-away > summary').textContent : null })).catch(() => null);

  /* ---- 1. Start the night ---- */
  const G = await open();
  const page = G.page;
  const spec = await page.evaluate(() => window.B68.BASE_FIGURE);
  for (const [email, , id, name] of PLAYERS) {
    const r = await api('PUT', '/characters/' + id, { v: 2, name, alias: '', code: '', playbook: 'hound', playbookName: 'Hound', owner: email, spec, sheet: { name }, play: { vice: '', purveyor: '', contacts: [], clocks: [] } });
    if (r.status !== 200) throw new Error('character ' + id + ' -> ' + r.status);
  }
  await page.reload();
  await page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
  await page.waitForSelector('#gm-left [data-who="open"]', { timeout: 20000 });
  check(await until(async () => (await page.textContent('#gm-bar-who').catch(() => '')) === '3 playing', 5000), 'KS12.7: the band has a who chip: 3 playing (no roster yet: everyone)');
  check(JSON.stringify(await whoChips(page)) === JSON.stringify(['Nell Arbuthnot', 'Ray Okonjo', 'Tam Petrakis', 'Lotte Brand']), 'no roster: every pack PC is a Who chip, as before: ' + JSON.stringify(await whoChips(page)));
  await page.click('#gm-left [data-who="open"]');
  await page.waitForSelector('#gm-who-sheet:not([hidden])', { timeout: 5000 });
  check(/Not filed:\s*Lotte Brand\./.test(await page.textContent('#gm-who-sheet .who-warn').catch(() => '')), 'KS12.1: the sheet warns about the pack PC no filed character matches (it counts as playing)');
  await shot(page, 'start-sheet-paper-1366');
  await page.click('#gm-who-sheet [data-who="start"]');
  const d1 = await until(async () => { const d = await campaign(); return d.session.number === 5 && d.session.present ? d : null; }, 8000);
  check(!!d1 && JSON.stringify(Object.keys(d1.session.present).sort()) === '["ch-nell","ch-ray"]', 'session 5 started with Nell and Ray');
  check(!!d1 && JSON.stringify(d1.schedule.attendance['5']) === JSON.stringify({ 'nell.player@example.test': true, 'ray.player@example.test': true, 'tam.player@example.test': false }), 'KS12.0: attendance is the RSVPs with the ticks over them: ' + JSON.stringify(d1 && d1.schedule.attendance['5']));
  check(!!(await until(async () => (await page.textContent('#gm-bar-who')) === '2 playing', 5000)), 'the chip: 2 playing');
  await page.click('[data-band-place="before"]');
  check(!!(await until(async () => (await page.textContent('#gm-left .who-lead [data-who="open"]').catch(() => '')).trim() === 'Carry on session 5', 5000)), 'KS12.0: Before\'s lead reads Carry on session 5 while it is open');

  /* ---- 2. the Roll's Who chips ---- */
  check(!!(await until(async () => JSON.stringify(await whoChips(page)) === JSON.stringify(['Nell Arbuthnot', 'Ray Okonjo', 'Lotte Brand']), 5000)), 'KS12.2: the Who chips are the PCs playing (Tam gone; the unmatched pack PC stays): ' + JSON.stringify(await whoChips(page)));

  /* ---- 3. the iPad: a v2 night, all three placed ---- */
  await page.click('[data-band-place="score"]'); await page.keyboard.press('g');
  await page.waitForSelector('[data-rv="start"][data-key="4/5"]', { timeout: 15000 });
  await page.click('[data-rv="start"][data-key="4/5"]');
  check(!!(await until(async () => { const s = await gmState(); return s.ball && s.ball.start === 45; }, 8000)), 'the Run view\'s night starts');
  check((await api('PATCH', '/gm/state', { ball: { crew: { 'ch-nell': { room: 'Showroom' }, 'ch-ray': { room: 'Cocktail lounge' }, 'ch-tam': { room: 'Showroom' } } } })).status === 200, 'all three PCs are placed on the map (Tam too)');
  await page.reload(); await page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
  await page.click('[data-band-place="score"]'); await page.keyboard.press('g');
  await page.waitForSelector('[data-rv="next"]', { timeout: 15000 });
  await page.click('[data-rv="next"]');      /* a step of the night: the page publishes the mission from the placed crew */
  const m1 = await until(async () => { const m = await mission(); return hudNames(m).length >= 2 ? m : null; }, 20000, 300);
  check(JSON.stringify(hudNames(m1)) === '["Nell Arbuthnot","Ray Okonjo"]', 'KS12.3: mission.hud.crew is Nell and Ray: ' + JSON.stringify(hudNames(m1)));
  check(JSON.stringify(cardIds(m1)) === '["ch-nell","ch-ray"]', 'KS12.3: a card for each PC playing, none for Tam: ' + JSON.stringify(cardIds(m1)));
  const faces = await until(async () => { const a = await ambient(); const f = a && a.layers && a.layers.band && a.layers.band.faces; return Array.isArray(f) && f.length ? f : null; }, 10000, 300);
  check(!!faces && JSON.stringify(faces.map((f) => f.name).sort()) === '["Nell Arbuthnot","Ray Okonjo"]', 'KS12.3: the band\'s faces are the two playing: ' + JSON.stringify(faces && faces.map((f) => f.name)));
  const pol1 = await until(async () => { const a = await ambient(); return Array.isArray(a.polaroids) ? a.polaroids : null; }, 8000, 300);
  check(JSON.stringify(pol1) === JSON.stringify([{ id: 'nell', cap: 'Nell Arbuthnot' }, { id: 'ray', cap: 'Ray Okonjo' }]), 'KS12.5: the polaroids are the two playing, by cast id: ' + JSON.stringify(pol1));
  const dispGet = JSON.stringify((await api('GET', '/gm/display', null, IPAD)).json);
  check(dispGet.includes('Ray Okonjo') && !SECRET.test(dispGet), 'the display\'s GET names Ray and nothing of Tam (' + dispGet.length + ' chars)');
  const I = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1024, height: 768 }, serviceWorkers: 'block' });
  const ipad = await I.newPage(); const ipadOut = [];
  ipad.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== BASE) ipadOut.push(u.origin); });
  await ipad.goto(BASE + '/'); await ipad.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 20000 });
  const ipadSees = await until(async () => { const h = await ipad.content(); return /Ray Okonjo/.test(h) ? h : null; }, 15000, 300);
  check(!!ipadSees && !SECRET.test(ipadSees), 'the iPad\'s DOM names Ray and nothing of Tam');
  check(ipadOut.length === 0, 'the iPad made no outside request');
  await shot(ipad, 'ipad-crew-1024');
  const tam = await mission('tam.player@example.test');
  check(!!tam && !tam.cards?.['ch-tam'] && !SECRET.test(JSON.stringify(tam.hud || {})), 'Tam\'s phone: no card of his, no hud entry for him');

  /* ---- 4. the told list ---- */
  if (!(await page.$('.rv-intel1 .rv-acts'))) { await page.click('[data-band-place="score"]'); await page.keyboard.press('g'); }
  await page.waitForSelector('.rv-intel1 .rv-acts', { state: 'attached', timeout: 15000 });
  const t1 = await tellRow(page);
  check(!!t1 && JSON.stringify(t1.here) === '["ch-nell","ch-ray"]' && JSON.stringify(t1.away) === '["ch-tam"]' && t1.fold === 'Not here (1)', 'KS12.4: the told list offers Nell and Ray; Tam sits behind Not here (1): ' + JSON.stringify(t1));
  await page.evaluate(() => { const d = document.querySelector('.rv-intel'); if (d) d.open = true; const a = document.querySelector('.rv-intel1 .who-away'); if (a) a.open = true; });
  await shot(page, 'told-notHere-paper-1366');
  const intelId = await page.$eval('.rv-intel1', (e) => e.getAttribute('data-intel'));
  await page.click('.rv-intel1 [data-vv="tellcrew"]');
  check(!!(await until(async () => { const s = await gmState(); return s.ball && s.ball.told && s.ball.told[intelId] === 'crew'; }, 6000)), 'Tell the crew is stored as "crew"');
  const m2 = await until(async () => { const m = await mission(); const c = m && m.cards; return c && c['ch-nell'] && JSON.stringify(c['ch-nell']) !== JSON.stringify(((m1 && m1.cards) || {})['ch-nell']) ? m : null; }, 12000, 300);
  check(!!m2 && JSON.stringify(cardIds(m2)) === '["ch-nell","ch-ray"]', 'KS12.4: the crew\'s card reaches two phones, not three: ' + JSON.stringify(cardIds(m2)));
  const tam2 = JSON.stringify(await mission('tam.player@example.test'));
  check(!SECRET.test(tam2), 'Tam\'s phone: no told entry, card or hud entry of his');

  /* ---- 5. the polaroids: one PATCH of its own; the server's cleaner ---- */
  const before5 = await ambient();
  const pr = await api('PATCH', '/gm/ambient', { polaroids: [{ id: 'nell', cap: 'Nell Arbuthnot' }] });
  const after5 = pr.json && pr.json.doc;
  check(pr.status === 200 && JSON.stringify(after5.polaroids) === '[{"id":"nell","cap":"Nell Arbuthnot"}]' && after5.mode === before5.mode && JSON.stringify(after5.playlist) === JSON.stringify(before5.playlist) && JSON.stringify(after5.layers) === JSON.stringify(before5.layers),
    'a polaroid-only PATCH changes the polaroids and nothing else');
  check((await api('PATCH', '/gm/ambient', { polaroids: [{ id: 'Not An Id', cap: 'x' }] })).status === 400 && (await api('PATCH', '/gm/ambient', { polaroids: Array.from({ length: 9 }, (_, i) => ({ id: 'p' + i, cap: '' })) })).status === 413, 'a malformed list is 400, nine are 413');
  check((await api('PATCH', '/gm/ambient', { polaroids: pol1 })).status === 200, 'the list goes back');
  const dsrc = readFileSync(path.join(ROOT, 'app', 'display-page.js'), 'utf8');
  check(!/POLAROIDS\s*=/.test(dsrc) && /s\.plan && s\.plan\.polaroids/.test(dsrc), 'the display\'s code holds no polaroid list: it draws the one it is sent');

  /* ---- 6. the absent packet's page ---- */
  await page.evaluate(() => { const t = window.B68GmTools && window.B68GmTools.get('absent'); if (t && t.open) t.open(); });
  await page.waitForSelector('[data-ab-who]', { timeout: 10000 });
  const ab = await page.$$eval('[data-ab-who]', (l) => Object.fromEntries(l.map((i) => [i.getAttribute('data-ab-who'), i.checked])));
  check(ab['tam.player@example.test'] === true && ab['nell.player@example.test'] === false && ab['ray.player@example.test'] === false, 'KS12.6: the absent page opens with Tam\'s player ticked: ' + JSON.stringify(ab));
  await shot(page, 'absent-paper-1366');
  await page.keyboard.press('Escape');

  /* ---- 7. a late arrival from the band's chip, without a reload ---- */
  const reqs = []; page.on('request', (r) => { if (r.url().includes('/api/gm/ambient') && r.method() === 'PATCH') reqs.push(r.postData()); });
  await page.click('#gm-bar-who');
  await page.waitForSelector('#gm-who-sheet:not([hidden])', { timeout: 5000 });
  check(await page.textContent('#gm-who-sheet .gm-sheet-h') === 'Who is here', 'KS12.7: the chip opens the sheet as Who is here');
  await page.click('#gm-who-sheet [data-who-pc="ch-tam"]');
  check((await page.textContent('#gm-who-sheet [data-who="start"]')).trim() === 'Carry on session 5', 'its Primary carries session 5 on');
  await shot(page, 'who-late-paper-1366');
  await page.click('#gm-who-sheet [data-who="start"]');
  check(!!(await until(async () => { const d = await campaign(); return Object.keys(d.session.present || {}).length === 3 && d.session.startedAt === d1.session.startedAt; }, 8000)), 'the roster has Tam, the start time is kept');
  check(!!(await until(async () => (await page.textContent('#gm-bar-who')) === '3 playing', 5000)), 'the chip: 3 playing');
  check(!!(await until(async () => (await whoChips(page)).includes('Tam Petrakis'), 5000)), 'the Who chips have Tam again, no reload');
  const m3 = await until(async () => { const m = await mission(); return hudNames(m).length === 3 ? m : null; }, 15000, 300);
  check(!!m3 && JSON.stringify(cardIds(m3)) === '["ch-nell","ch-ray","ch-tam"]', 'the iPad\'s crew and the cards have Tam: ' + JSON.stringify(hudNames(m3)));
  check(!!(await until(async () => { const a = await ambient(); return Array.isArray(a.polaroids) && a.polaroids.length === 3; }, 8000, 300)), 'the polaroids have Tam');
  const polW = reqs.map((b) => JSON.parse(b || '{}')).filter((b) => 'polaroids' in b);
  check(polW.length > 0 && polW.every((b) => Object.keys(b).join() === 'polaroids'), 'Gate 2: every polaroid write is a PATCH of its own: ' + JSON.stringify(polW.map((b) => Object.keys(b))));
  if (!(await page.$('.rv-intel1 .rv-acts'))) { await page.click('[data-band-place="score"]'); await page.keyboard.press('g'); }
  check(!!(await until(async () => { const t = await tellRow(page); return t && t.fold === null && t.here.length === 3 ? t : null; }, 8000)), 'the told list: three, no fold');

  /* ---- 8. End: the polaroids go; close drops the Esc entry ---- */
  await page.click('[data-band-place="after"]');
  await page.waitForSelector('#gm-left [data-pv-end]', { timeout: 8000 });
  await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.click('#gm-left [data-pv-end]')]);
  check(!!(await until(async () => (await campaign()).session.endedAt, 8000)), 'the session ended');
  check(!!(await until(async () => !('polaroids' in (await ambient())), 8000, 300)), 'KS12.5: End takes the polaroids down (null)');
  const escBefore = await page.evaluate(() => window.B68GmEsc.list().map((e) => e.id));
  await page.evaluate(() => { location.hash = '#t'; });
  await sleep(800);
  const escAfter = await page.evaluate(() => window.B68GmEsc.list().map((e) => e.id));
  check(escBefore.includes('who.sheet') && !escAfter.includes('who.sheet') && !(await page.$('#gm-bar-who')), 'KS12.0: leaving the GM page drops the who sheet\'s Esc entry and the chip: ' + JSON.stringify(escAfter));
  await G.c.close();

  /* ---- 9. the stylesheet with night.who alone and with kit.desk ---- */
  const look = async (kit) => {
    await api('PATCH', '/gm/state', { features: { 'kit.desk': kit } });
    const S = await open(1366, 768, '', 'before'); const p = S.page;
    await p.click('[data-band-place="before"]');
    await p.waitForSelector('#gm-left [data-who="open"]', { timeout: 20000 });
    if (kit) await p.waitForFunction(() => /desk/.test(document.documentElement.getAttribute('data-kit') || ''), null, { timeout: 10000 });
    await p.click('#gm-left [data-who="open"]'); await p.waitForSelector('#gm-who-sheet:not([hidden]) .who-row');
    await sleep(300);
    const s = await p.$eval('#gm-who-sheet .who-row', (r) => { const c = getComputedStyle(r), b = r.querySelector('.who-name b'); return { display: c.display, minH: c.minHeight, cols: c.gridTemplateColumns.split(' ').length, bfs: getComputedStyle(b).fontSize, kit: document.documentElement.getAttribute('data-kit') || '', layered: !!document.querySelector('style[data-href]') }; });
    await S.c.close();
    return s;
  };
  const alone = await look(false), withKit = await look(true);
  check(alone.display === 'grid' && alone.minH === '52px' && alone.cols === 3 && alone.bfs === '15px' && !alone.layered, 'KS12.0: night.who alone (old sheets unlayered): the rows are laid out by desk-who.css: ' + JSON.stringify(alone));
  check(withKit.display === 'grid' && withKit.minH === '52px' && withKit.cols === 3 && withKit.bfs === '15px' && /desk/.test(withKit.kit), 'and the same with kit.desk (old sheets layered): ' + JSON.stringify(withKit));
  await api('PATCH', '/gm/state', { features: { 'kit.desk': false } });

  /* ---- 10. the setting off: everyone, as before ---- */
  await api('PATCH', '/campaign', { session: { number: 5, startedAt: d1.session.startedAt, endedAt: null, present: { 'ch-tam': null } } });      /* an open night, Tam let go */
  check(JSON.stringify(Object.keys((await campaign()).session.present).sort()) === '["ch-nell","ch-ray"]', 'the stored roster again says Nell and Ray');
  /* the pictures (setting on, Nell and Ray playing): the Roll's two chips and the told list's Not here fold; the sheet with the late arrival ticked */
  if (SHOTS) {
    for (const theme of ['paper', 'night']) {
      for (const [w, h] of [[1366, 768], [1536, 864]]) {
        const P = await open(w, h, theme, 'score'); const pp = P.page;
        if (!(await pp.$('.rv-intel1'))) { await pp.click('[data-band-place="score"]'); await pp.keyboard.press('g'); }
        await pp.waitForSelector('.rv-intel1 .who-away', { state: 'attached', timeout: 15000 });
        await pp.evaluate(() => { const d = document.querySelector('.rv-intel'); if (d) d.open = true; const a1 = document.querySelectorAll('.rv-intel1 .who-away')[1]; if (a1) a1.open = true; const x = document.querySelector('.rv-intel'); if (x) x.scrollIntoView({ block: 'start' }); });
        await sleep(500); await shot(pp, 'roll-told-' + theme + '-' + w);
        await pp.click('#gm-bar-who'); await pp.waitForSelector('#gm-who-sheet:not([hidden])');
        await pp.click('#gm-who-sheet [data-who-pc="ch-tam"]');
        await sleep(400); await shot(pp, 'sheet-late-' + theme + '-' + w);
        await P.c.close();
      }
    }
    const I2 = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1024, height: 768 }, serviceWorkers: 'block' });
    const ip2 = await I2.newPage(); await ip2.goto(BASE + '/'); await ip2.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 20000 });
    await sleep(3000); await shot(ip2, 'ipad-paper-1024'); await I2.close();
  }
  check((await api('PATCH', '/gm/state', { features: { 'night.who': false } })).status === 200, 'night.who off');
  const O = await open(1366, 768, '', 'score'); const op = O.page;
  check(JSON.stringify(await until(async () => { const l = await whoChips(op); return l.length === 4 ? l : null; }, 8000)) === JSON.stringify(['Nell Arbuthnot', 'Ray Okonjo', 'Tam Petrakis', 'Lotte Brand']), 'off: every pack PC is a Who chip');
  check(!(await op.$('#gm-bar-who')) && !(await op.evaluate(() => performance.getEntriesByType('resource').some((e) => /gm\/kit\/who\.js|desk-who\.css/.test(e.name)))), 'off: no chip, the bundle is not fetched');
  await op.keyboard.press('g');
  const t0 = await until(async () => { const t = await tellRow(op); return t && t.here.length === 3 ? t : null; }, 15000);
  check(!!t0 && t0.fold === null, 'off: the told list offers all three, no fold');
  await op.click('[data-rv="next"]');      /* a step of the night: the old code publishes */
  const m4 = await until(async () => { const m = await mission(); return hudNames(m).length === 3 ? m : null; }, 20000, 300);
  check(!!m4 && JSON.stringify(cardIds(m4)) === '["ch-nell","ch-ray","ch-tam"]', 'off: the iPad\'s crew and the cards are all three, as today: ' + JSON.stringify(hudNames(m4)));
  await O.c.close();
  await I.close();

  check(errors.length === 0, 'no console errors: ' + JSON.stringify(errors.slice(0, 3)));
  await browser.close();
} catch (e) {
  console.log('FAIL ' + (e && e.stack || e)); failed++;
}
clearTimeout(timeout);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
