// The Run tab for a v2 night (VV4; app/gm/run-view.js) in a real browser against a real local Worker (wrangler dev, DEV_USER) on PORT
// (default 8950), with INVENTED authored sites (a made-up venue and cast) in the location part of the pack: one v1 site and one v2
// site (checks/runtime/fixtures/gm/pelican-play-v2.json). The tab shows for v2 only; the engagement start; a beat back and next
// write ball.t; a peek writes nothing; a PC moved by tap and by drag; Open for the players asks; the keys; Focus at three sizes.
// VV5 adds: This beat (four beats, three snapshots, False dawn, the alarm's buttons at their fill, Target is down and the exits), the crew
// (busy, items, noticed, blown, costume, room), the job (Heard by, steps, done, a delay from now) and intel (Tell).
//   PW_MODULE=<playwright install> PW_CHANNEL=msedge node checks/runtime/gm-run-v2.e2e.mjs      (GM_SHOTS=<dir> keeps screenshots)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8950);
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

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-runv2-e2e-'));
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
  const put = await api('PUT', '/campaign', {
    v: 1, session: { number: 1, startedAt: NOW, endedAt: null },
    crew: { name: 'The Lamplighters', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] },
    clocks: [{ id: 'c_fuse', name: 'Fuse', size: 6, filled: 2, kind: 'danger', hidden: true }], log: [] });
  check(put.status === 200, 'the table holds a hidden Fuse clock');
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [], asked = [], answer = { no: false };
  async function open(w = 1366, h = 768) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w, height: h }, serviceWorkers: 'block' });
    await c.addInitScript(() => { window.__B68_POLL_MS = 700; });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('dialog', (d) => { asked.push(d.message()); return answer.no ? d.dismiss() : d.accept(); });
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    return { c, page };
  }
  const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
  const setCard = (name) => api('PATCH', '/gm/state', { cards: { location: { hid: 'h_' + name.length, auth: name, label: name + ' · Nowhere Ward', at: new Date().toISOString() } }, loc: { map: { view: 'iso', theme: 'rulebook', layer: 'gm', reveal: { public: true, working: false, controlled: false, secure: false } } } });
  const tabShown = (page) => page.evaluate(() => { const b = document.querySelector('.gm-tab[data-panel="run"]'); return !!b && !b.hidden && b.offsetParent !== null; });
  const timeText = (page) => page.$eval('#rv-time', (e) => e.textContent.trim());

  /* the GM's laptop opens first, so characters can be filed by the page's own adapter */
  const G0 = await open();
  const spec = await G0.page.evaluate(() => window.B68.BASE_FIGURE);
  const pcDoc = (name) => ({ v: 2, name, alias: '', code: '', playbook: 'hound', playbookName: 'Hound', spec, sheet: { name }, play: { vice: '', purveyor: '', contacts: [], clocks: [] } });
  for (const [id, n] of [['run-pc1', 'Cass Fenn'], ['run-pc2', 'Dov Ketch'], ['run-pc3', 'Ira Lund']]) check((await api('PUT', '/characters/' + id, pcDoc(n))).status === 200, 'an invented PC is filed: ' + n);
  await G0.c.close();

  /* ---- 1. the tab appears for a v2 site only; a v1 site keeps its strip ---- */
  check((await setCard(NAME1)).status === 200, 'the Location card is the v1 site');
  const V1 = await open();
  await V1.page.keyboard.press('b');
  await V1.page.waitForSelector('#gm-run', { timeout: 20000 });
  check(!(await tabShown(V1.page)), 'a v1 site: the Run tab is not shown');
  check(await V1.page.$eval('#gm-run', (e) => /Run the site/.test(e.textContent)) && (await V1.page.$$('.gm-runv2note')).length === 0, 'and Location keeps its Run the site strip, as today');
  await V1.page.keyboard.press('g');
  check(await V1.page.waitForSelector('.gm-runhelp', { timeout: 5000 }).then(() => true, () => false) && await V1.page.$eval('.gm-runhelp', (e) => /"v": 2/.test(e.textContent)), 'G on a v1 site says how to get a v2 night');
  await V1.c.close();

  check((await setCard(NAME2)).status === 200, 'the Location card is the v2 site');
  const seq0 = await seqNow();
  const G = await open();
  check(await until(() => tabShown(G.page), 15000), 'a v2 site: the Run tab is shown');
  await G.page.keyboard.press('b');
  await G.page.waitForSelector('.gm-runv2note', { timeout: 10000 });
  check((await G.page.$$('#gm-run')).length === 0, 'and Location does not show the v1 strip for it');
  await G.page.keyboard.press('g');
  await G.page.waitForSelector('.rv-head', { timeout: 10000 });
  check(await G.page.$eval('#gm-runv', (p) => !p.hidden), 'G opens the Run pane');

  /* ---- 2. start the night ---- */
  check(await G.page.$$eval('.rv-start [data-rv="start"]', (b) => b.map((x) => x.getAttribute('data-key')).join()) === 'crit,6,4/5,1-3', 'before the first beat: a picker of the four engagement results');
  check(await G.page.$$eval('[data-rv="next"], [data-rv="back"]', (b) => b.length) === 0, 'and no back or next yet');
  check(!(await ball()), 'looking wrote nothing');
  await G.page.click('[data-rv="start"][data-key="4/5"]');
  let b = await until(async () => { const x = await ball(); return x && x.start === 45 ? x : null; }, 8000);
  check(!!b && b.t === 45 && b.v === 2 && b.site === NAME2, 'the 4/5 result sets ball.start and ball.t to 45 minutes (' + JSON.stringify(b) + ')');
  check(await timeText(G.page) === '21:45', 'the big time reads 21:45');
  check(await G.page.$eval('.rv-beat', (e) => e.textContent) === 'beat 4 of 16', 'beat 4 of 16, counted from clock.start');
  check(await G.page.$$eval('.rv-sq.before', (q) => q.length) === 3 && await G.page.$$eval('.rv-sq', (q) => q.length) === 16, 'sixteen squares, the three before the start shaded');
  check(await G.page.$$eval('.rv-sq .rv-ic[data-icon="star"]', (q) => q.length) === 2 && await G.page.$$eval('.rv-sq .rv-ic[data-icon="diamond"]', (q) => q.length) === 1 && await G.page.$$eval('.rv-sq .rv-ic[data-icon="skull"]', (q) => q.length) === 1, 'event icons on the track: two stars, a diamond, a skull');
  check(await G.page.$eval('.rv-alarm', (e) => /Fuse/.test(e.textContent) && /2\/6/.test(e.textContent)), 'the alarm is the table clock Fuse, 2/6');
  await G.page.click('.rv-alarm');
  check(await G.page.$eval('.rv-alarmtext', (e) => /GM-ONLY-BEAT-2/.test(e.textContent)), 'tapping the alarm shows its beat 2 (beats[filled-1])');
  await G.page.click('.rv-alarm');
  check(await G.page.$eval('.rv-players', (e) => /Players/.test(e.textContent)), 'the Players chip is in the header (VV6 fills it)');
  check(await seqNow() === seq0, 'nothing was published to the iPad');
  await shot(G.page, 'runv2-01-started');

  /* ---- 3. a beat each way ---- */
  await G.page.click('[data-rv="next"]');
  check(!!(await until(async () => (await ball()).t === 60, 8000)) && await timeText(G.page) === '22:00', 'next writes ball.t = 60 and the time reads 22:00');
  await G.page.click('[data-rv="back"]');
  check(!!(await until(async () => (await ball()).t === 45, 8000)) && await timeText(G.page) === '21:45', 'back writes ball.t = 45');
  check(await G.page.$eval('[data-rv="back"]', (e) => e.disabled), 'back is disabled at the start: never before ball.start');
  check((await ball()).start === 45, 'and ball.start stays');

  /* ---- 4. a peek is page-local ---- */
  await G.page.click('.rv-sq[data-i="10"]');
  check(await G.page.$eval('.rv-peekbar', (e) => /23:30/.test(e.textContent) && /Back to now/.test(e.textContent)) && await G.page.$eval('.rv-main', (e) => e.classList.contains('peeking')), 'tapping a square shows 23:30 in a dashed frame with Back to now');
  check(await timeText(G.page) === '21:45' && await G.page.$eval('.rv-card[data-room="Private card rooms"] .rv-npc.k-target', (e) => !!e), 'the published time still reads 21:45, while the board shows Odette in the card rooms');
  await sleep(1200);
  check((await ball()).t === 45 && await seqNow() === seq0, 'a peek wrote no ball.t and published nothing');
  await G.page.click('[data-rv="unpeek"]');
  check((await G.page.$$('.rv-peekbar')).length === 0 && await G.page.$eval('.rv-card[data-room="Showroom"] .rv-npc.k-target', (e) => !!e), 'Back to now returns the board to 21:45');

  /* ---- 5. moving PCs: a tap on the chip then the room; a drag ---- */
  check(await G.page.$$eval('.rv-tray .rv-pc', (c) => c.length) === 3, 'the three PCs wait in the tray');
  await G.page.click('.rv-tray .rv-pc[data-id="run-pc1"]');
  check(await G.page.$eval('.rv-arm', (e) => /Cass Fenn/.test(e.textContent)), 'a chip tapped is armed');
  await G.page.click('.rv-card[data-room="Showroom"]');
  b = await until(async () => { const x = await ball(); return x && x.crew && x.crew['run-pc1'] ? x : null; }, 8000);
  check(!!b && b.crew['run-pc1'].room === 'Showroom' && b.crew['run-pc1'].moved === 3, 'tap then room: ball.crew has the PC in the Showroom, moved in beat index 3 (' + JSON.stringify(b && b.crew) + ')');
  check(await G.page.$eval('.rv-card[data-room="Showroom"] .rv-pc[data-id="run-pc1"]', (e) => !!e), 'and the chip sits on that card');
  const chip = await G.page.$('.rv-tray .rv-pc[data-id="run-pc2"]'), cardBox = await (await G.page.waitForSelector('.rv-card[data-room="Cocktail lounge"]', { timeout: 10000 })).boundingBox(), cb = await chip.boundingBox();
  await G.page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  await G.page.mouse.down();
  await G.page.mouse.move(cb.x + cb.width / 2 + 20, cb.y + cb.height / 2 + 20, { steps: 4 });
  await G.page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2, { steps: 8 });
  check(await G.page.$eval('.rv-card[data-room="Cocktail lounge"]', (e) => e.classList.contains('target')) && (await G.page.$$('.rv-ghost')).length === 1, 'dragging: the card under the pointer lights and a ghost follows');
  await G.page.mouse.up();
  b = await until(async () => { const x = await ball(); return x && x.crew && x.crew['run-pc2'] ? x : null; }, 8000);
  check(!!b && b.crew['run-pc2'].room === 'Cocktail lounge', 'drag and drop: the PC is in the lounge');
  check((await G.page.$$('.rv-ghost')).length === 0 && (await G.page.$$('.rv-arm')).length === 0, 'the ghost is gone and nothing is armed');
  /* costumes are the next ticket's; set them from the server so the marks can be seen */
  await api('PATCH', '/gm/state', { ball: { crew: { 'run-pc1': { disguise: 'guard' }, 'run-pc2': { disguise: 'cook' } } } });
  await G.page.evaluate(() => window.dispatchEvent(new Event('focus')));        /* the GM page re-reads the state when its window gets the focus */
  await G.page.waitForFunction(() => document.querySelector('.rv-card[data-room="Cocktail lounge"] .rv-pc[data-id="run-pc2"]'), null, { timeout: 15000 });
  check(await G.page.$$eval('.rv-board .rv-mk, .rv-view .rv-mk, .rv-view .rv-cic', (l) => l.length) === 0 && await G.page.$$eval('.rv-view .rv-pc', (l) => l.every((e) => !/pos-/.test(e.className))), 'the costume mechanic is off the board: no warning or eye marks, no costume icon, no edge colour by position');
  check(await G.page.$eval('.rv-card[data-room="Private card rooms"]', (e) => e.classList.contains('fog')) && await G.page.$eval('.rv-card[data-room="Showroom"]', (e) => e.classList.contains('open')), 'cards are dashed (fog) while the room is not open to the players');
  await shot(G.page, 'runv2-02-board');

  /* ---- 6. a room tapped ---- */
  await G.page.click('.rv-card[data-room="Cocktail lounge"] .rv-cn');
  const side = () => G.page.$eval('.rv-sec[data-sec="room"]', (e) => e.textContent);
  check(/Cocktail lounge/.test(await side()) && /Dov Ketch/.test(await side()) && /Pip Quill/.test(await side()), 'a room tapped: who is there (a PC and a person)');
  check(await G.page.$eval('.rv-sec[data-sec="room"] .rv-say', (e) => /She never leaves a table/.test(e.textContent) && /SAY/.test(e.textContent)), 'leads in reach: the line as a SAY band');
  b = await until(async () => { const x = await ball(); return x && x.heard && x.heard.A ? x : null; }, 8000);
  check(!!b && b.heard.A['run-pc2'] === 45, 'auto-hear: the PC dragged into the lounge heard the lead at the published time (' + JSON.stringify(b && b.heard) + ')');
  const ub = await G.page.$$eval('.rv-sec[data-sec="room"] [data-rv="unhear"]', (l) => l.map((x) => x.getAttribute('data-way') + '/' + x.getAttribute('data-pc') + '/' + x.getAttribute('aria-pressed')));
  check(ub.join() === 'A/run-pc2/true', 'In reach shows an Un-hear toggle for the PC who is there, on (' + ub.join() + ')');
  await G.page.click('.rv-sec[data-sec="room"] [data-rv="unhear"]');
  b = await until(async () => { const x = await ball(); return x && x.unheard && x.unheard.A ? x : null; }, 8000);
  check(!!b && b.unheard.A['run-pc2'] === true && !(b.heard && b.heard.A && b.heard.A['run-pc2'] !== undefined), 'Un-hear writes ball.unheard.A.<pc> and takes the heard time back (' + JSON.stringify(b && [b.heard, b.unheard]) + ')');
  await G.page.click('.rv-card[data-room="Luxury penthouse"] .rv-cn');
  check(/Not open to the players/.test(await side()), 'a shut room says so');
  await G.page.click('.rv-sec[data-sec="room"] [data-rv="move"][data-id="run-pc3"]');
  b = await until(async () => { const x = await ball(); return x && x.crew && x.crew['run-pc3'] ? x : null; }, 8000);
  check(!!b && b.crew['run-pc3'].room === 'Luxury penthouse', 'Move Ira Lund here puts her in the penthouse');

  /* ---- 7. Open for the players asks: the map is live on the iPad first ---- */
  await G.page.keyboard.press('b');
  await G.page.click('[data-gm="layer"][data-v="player"]');
  await G.page.click('[data-gm="ipad"]');
  check(!!(await until(async () => (await seqNow()) > seq0, 8000)), 'Show on iPad put the player map up');
  await G.page.keyboard.press('g');
  await G.page.waitForSelector('.rv-head');
  await G.page.click('.rv-card[data-room="Private card rooms"] .rv-cn');
  answer.no = true; asked.length = 0;
  await G.page.click('.rv-sec[data-sec="room"] [data-rv="open"]');
  await sleep(600);
  check(asked.length === 1 && /opening the room Private card rooms shows it to the players now/.test(asked[0]), 'Open for the players asks first, by name (' + asked.join(' | ') + ')');
  check(!((await ball()).open || []).length && await G.page.$eval('.rv-card[data-room="Private card rooms"]', (e) => e.classList.contains('fog')), 'and a no leaves the room shut');
  answer.no = false; asked.length = 0;
  let sq = await seqNow();
  await G.page.click('.rv-card[data-room="Private card rooms"] .rv-cn');
  await G.page.click('.rv-sec[data-sec="room"] [data-rv="open"]');
  check(!!(await until(async () => JSON.stringify((await ball()).open) === '["Private card rooms"]', 8000)) && asked.length === 1, 'a yes: ball.open holds the room');
  check(!!(await until(async () => (await seqNow()) > sq, 8000)), 'and the room went to the iPad through the page');
  check(await G.page.waitForFunction(() => !document.querySelector('.rv-card[data-room="Private card rooms"]').classList.contains('fog'), null, { timeout: 8000 }).then(() => true, () => false), 'the card is solid once the room is open');

  /* ---- 8. the keys ---- */
  await G.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  const t0 = (await ball()).t;
  await G.page.keyboard.press('ArrowRight');
  check(!!(await until(async () => (await ball()).t === t0 + 15, 8000)), 'Right: next beat');
  await G.page.keyboard.press('ArrowLeft');
  check(!!(await until(async () => (await ball()).t === t0, 8000)), 'Left: back a beat');
  await G.page.keyboard.press('Shift+ArrowRight');
  check(!!(await until(async () => (await ball()).t === 60, 8000)) && await timeText(G.page) === '22:00', 'Shift+Right: the next thing that happens (22:00, the speeches)');
  await G.page.keyboard.press('Shift+ArrowRight');
  check(!!(await until(async () => (await ball()).t === 120, 8000)), 'and again: 23:00 (a guard moves, the passage opens)');
  check(await G.page.$eval('.rv-card[data-room="Underground counting room"] .rv-route.timed', (e) => /Showroom/.test(e.textContent)), 'the Passage is drawn only now, dashed, between the counting room and the showroom');
  await G.page.click('.rv-sq[data-i="12"]');
  check((await G.page.$$('.rv-peekbar')).length === 1, 'a peek is open');
  await G.page.keyboard.press('Escape');
  check((await G.page.$$('.rv-peekbar')).length === 0 && (await ball()).t === 120, 'Esc: back to now, without writing');
  await G.page.keyboard.press('ArrowLeft'); await G.page.keyboard.press('ArrowLeft'); await G.page.keyboard.press('ArrowLeft');
  check(!!(await until(async () => (await ball()).t === 75, 8000)), 'three Lefts go back three beats');
  /* the keys belong to the Run tab alone */
  await G.page.keyboard.press('b');
  await G.page.keyboard.press('ArrowRight');
  await sleep(500);
  check((await ball()).t === 75, 'Right in Location does not move the night');
  await G.page.keyboard.press('g');
  await G.page.waitForSelector('.rv-head');

  /* ---- 9. Board or Map ---- */
  await G.page.click('[data-rv="view"][data-v="map"]');
  check(await G.page.waitForSelector('#rv-map svg', { timeout: 15000 }).then(() => true, () => false), 'Map shows the GM-layer map');
  check(await G.page.$eval('#rv-map', (m) => m.innerHTML.includes('#fffdf6')), 'with its tokens (crew and people)');
  check(!!(await until(async () => (await ball()).view === 'map', 8000)), 'the view is kept in ball.view');
  await shot(G.page, 'runv2-03-map');
  { const g = await G.page.evaluate(() => { const m = document.querySelector('#rv-map').getBoundingClientRect(), s = document.querySelector('#rv-map svg').getBoundingClientRect(), a = document.querySelector('.rv-side').getBoundingClientRect(); return { mh: m.height, aw: a.width, vh: innerHeight, inside: s.bottom <= m.bottom + 1 && s.right <= m.right + 1 && s.top >= m.top - 1 }; });
    check(g.inside && g.mh >= g.vh * 0.6 && g.aw <= 250, 'Map view: the map frame fills the column height (' + Math.round(g.mh) + ' of ' + g.vh + '), the svg fits inside it, the side panel narrows (' + Math.round(g.aw) + ' px)'); }
  { /* E1: zoom and pan on the Map view */
    const vbw = () => G.page.$eval('#rv-map svg', (e) => +e.getAttribute('viewBox').split(' ')[2]), vbs = () => G.page.$eval('#rv-map svg', (e) => e.getAttribute('viewBox'));
    const w0 = await vbw(), r = await G.page.$eval('#rv-map', (m) => { const b = m.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
    check(!!(await G.page.$('#rv-map .mz-btn[data-mz="in"]')) && !!(await G.page.$('#rv-map .mz-btn[data-mz="out"]')) && !!(await G.page.$('#rv-map .mz-btn[data-mz="fit"]')), 'Map view: + / - / Fit buttons over the map');
    await G.page.mouse.move(r.x, r.y); await G.page.mouse.wheel(0, -500);
    check(!!(await until(async () => (await vbw()) < w0 * 0.8, 4000)), 'Map view: the wheel zooms in (viewBox ' + w0 + ' -> ' + (await vbw()) + ')');
    const z1 = await vbs(); await G.page.mouse.down(); await G.page.mouse.move(r.x - 80, r.y - 40, { steps: 6 }); await G.page.mouse.up();
    check((await vbs()) !== z1 && (await vbw()) === (+z1.split(' ')[2]), 'Map view: dragging pans without changing the zoom');
    /* a tap is not a pan: the click reaches the page, the view does not move; a press that starts on a control never pans */
    await G.page.evaluate(() => { window.__mzClicks = 0; document.querySelector('#rv-map').addEventListener('click', () => { window.__mzClicks++; }); });
    const vTap = await vbs(); await G.page.mouse.move(r.x, r.y); await G.page.mouse.down(); await G.page.mouse.up();
    check((await G.page.evaluate(() => window.__mzClicks)) === 1 && (await vbs()) === vTap, 'Map view: a tap on the map still fires its click');
    { const before = await vbs(), bb = await G.page.$eval('#rv-map .mz-btn[data-mz="out"]', (b) => { const q = b.getBoundingClientRect(); return { x: q.left + q.width / 2, y: q.top + q.height / 2 }; });
      await G.page.mouse.move(bb.x, bb.y); await G.page.mouse.down(); await G.page.mouse.move(bb.x - 120, bb.y + 90, { steps: 6 }); await G.page.mouse.up();
      check((await vbs()) === before, 'Map view: a drag that starts on a control does not pan'); }
    { const before = await vbs(); await G.page.mouse.move(r.x, r.y); await G.page.mouse.down(); await G.page.mouse.move(r.x + 2, r.y + 1); await G.page.mouse.up();
      check((await vbs()) === before, 'Map view: a 2px wobble is a tap, not a pan'); }
    const z2 = await vbs();
    await G.page.click('[data-rv="next"]'); await G.page.waitForSelector('#rv-map svg', { timeout: 15000 });
    check(!!(await until(async () => (await vbs()) === z2, 4000)), 'Map view: the zoom and pan survive a time step (the map redraws)');
    await G.page.click('#rv-map .mz-btn[data-mz="fit"]');
    check((await vbw()) >= w0 - 0.01, 'Map view: Fit shows the whole map again');
    await G.page.click('[data-rv="back"]'); await G.page.waitForSelector('#rv-map svg', { timeout: 15000 });
  }
  await G.page.click('[data-rv="view"][data-v="board"]');
  check((await G.page.$$('.rv-card')).length === 6, 'Board brings the cards back');

  /* ==== VV5 (the beat card, the crew, the job, intel) ============================================================ */
  const secT = (name) => G.page.$eval('.rv-sec[data-sec="' + name + '"]', (e) => e.textContent.replace(/\s+/g, ' ').trim());
  const ballT = async () => (await ball()).t;
  const waitBall = (pred, ms = 8000) => until(async () => { const x = await ball(); return x && pred(x) ? x : null; }, ms);
  const crewRow = (id) => '.rv-crew[data-pc="' + id + '"]';
  /* E2: the crew lines live in the drawer's Crew tab (an overlay on the right edge), so a check opens it, acts, and shuts it again */
  const drawer = async (page, on) => { const open = await page.$eval('#gm-root', (r) => r.classList.contains('dw-open')); if (open !== on) await page.click(on ? '#gm-bar-drawer' : '#gm-drawer .gm-dhead [data-gm="drawer"]'); if (on) { await page.click('#gm-drawer [data-gm="dtab"][data-tab="crew"]'); await page.waitForSelector('#gm-dcrew .rv-crew', { timeout: 10000 }); } };
  const crewRoom = async (page, id, room) => { await drawer(page, true); await page.selectOption(crewRow(id) + ' [data-vv="room"]', room); await drawer(page, false); };
  const BEAT = '.rv-sec[data-sec="beat"]';
  const od = (x, hhmm) => BALL.placesAt(c2.play, x, BALL.minuteOf(hhmm, '21:00')).od;
  check(await G.page.$$eval('.rv-sec', (e) => e.map((x) => x.getAttribute('data-sec')).join()) === 'room,beat,job,intel', 'the right column: Rooms on top, then This beat, the job and intel (the Tell, last); the crew moved to the drawer');
  check(await ballT() === 75, 'the night stands at 22:15 (beat 6)');

  /* four beats: each Next rewrites the card; 23:00 brings the Passage and the looker's wary line */
  const seen = [];
  for (let k = 1; k <= 4; k++) {
    await G.page.click('[data-rv="next"]');
    await waitBall((x) => x.t === 75 + 15 * k);
    const want = BALL.timeLabel(c2.play, 75 + 15 * k);
    check(await G.page.waitForFunction((w) => document.querySelector('.rv-sec[data-sec="beat"] .rv-sh').textContent === 'This beat · ' + w, want, { timeout: 5000 }).then(() => true, () => false), 'Next ' + k + ': This beat reads ' + want);
    seen.push(await secT('beat'));
  }
  check(/Passage opened 23:00 · Underground counting room ↔ Showroom/.test(seen[2]) && !/Passage opened/.test(seen[3]) && !/Passage opened/.test(seen[1]), 'snapshot 23:00: the Passage opens in the beat it opens, and only there');
  check(!/Pip Quill is where Dov Ketch is/.test(seen[2]) && !/GM-ONLY-WARY-2/.test(seen[2]), 'the costume mechanic is off: no looker row in the beat card');
  check(await G.page.$$eval(BEAT + ' [data-vv="dawn"]', (b) => b.length) === 0, 'no False dawn button on a card with no fx event');

  /* 23:30 and 00:00 (jumps): the typed list in speaking order; the fx event carries False dawn */
  await G.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await G.page.keyboard.press('Shift+ArrowRight'); await waitBall((x) => x.t === 150);
  await G.page.waitForFunction(() => document.querySelector('.rv-sec[data-sec="beat"] .rv-sh').textContent === 'This beat · 23:30', null, { timeout: 5000 });
  check(await G.page.$$eval(BEAT + ' .rv-bi', (l) => l.map((x) => x.className.replace('rv-bi t-', '')).join()) === 'event,move,next', 'snapshot 23:30: the event, the target\'s move, then what is next (no looker rows)');
  const s2 = await secT('beat');
  check(/GM-ONLY-LABEL-2 · Private card rooms/.test(s2) && /Odette Marsh → Private card rooms until 00:15/.test(s2), 'the move says until when: the target\'s next stop, 00:15');
  await G.page.keyboard.press('Shift+ArrowRight'); await waitBall((x) => x.t === 180);
  await G.page.waitForFunction(() => document.querySelector('.rv-sec[data-sec="beat"] .rv-sh').textContent === 'This beat · 00:00', null, { timeout: 5000 });
  const s3 = await secT('beat');
  check(/GM-ONLY-LABEL-3 · Showroom/.test(s3) && /Passage closed 00:00/.test(s3) && /00:15 Odette Marsh → Luxury penthouse in 15 min/.test(s3), 'snapshot 00:00: the fireworks, the Passage closing, and the next move');
  check(await G.page.$$eval(BEAT + ' [data-vv="dawn"]', (b) => b.length) === 1, 'the fx event carries one False dawn button');

  /* False dawn asks first (it reuses the page's runDawn); a no sends nothing */
  await api('PATCH', '/gm/ambient', { overlay: null });        /* VV6: a Next onto the speeches left its overlay in the ambient document */
  answer.no = true; asked.length = 0;
  const amb = async () => (await api('GET', '/gm/ambient')).json;
  await G.page.click(BEAT + ' [data-vv="dawn"]');
  await sleep(1200);
  check(asked.length === 1 && /The iPad goes white for 30 seconds/.test(asked[0]) && !(await amb()).doc.overlay && !(await ball()).dawn, 'False dawn asks first; a no sends nothing and records nothing');
  answer.no = false; asked.length = 0;
  await G.page.click(BEAT + ' [data-vv="dawn"]');
  const ov = await until(async () => { const a = await amb(); return a.doc.overlay ? a : null; }, 8000);
  check(asked.length === 1 && !!ov && ov.doc.overlay.fx === 'dawn' && ov.doc.overlay.ms === 30000, 'a yes sends the dawn');
  await api('PATCH', '/gm/ambient', { overlay: null });

  /* a peek reads as the beat that ends there, and writes nothing */
  await G.page.click('.rv-sq[data-i="4"]');
  check(await G.page.$eval(BEAT + ' .rv-sh', (e) => e.textContent) === 'Looking at 22:00' && await G.page.$eval(BEAT + ' .rv-say', (e) => /SAY/.test(e.textContent) && /GM-ONLY-SAY-1/.test(e.textContent)), 'peeking at 22:00: the card for that beat, the SAY line in a band');
  check(await ballT() === 180, 'and the published time did not move');
  await G.page.keyboard.press('Escape');

  /* the pacing line: wall clock, page-local */
  check(/^beat 13 · \d+ min in$/.test(await G.page.$eval('[data-pace]', (e) => e.textContent)) && !JSON.stringify(await gmState()).includes('min in'), 'the pacing line reads beat 13 · m min in, and is held nowhere shared');

  /* the alarm's buttons appear only at their fill (the table clock Fuse is the alarm) */
  const setFuse = async (n) => {
    const cur = (await api('GET', '/campaign')).json.doc;
    const r = await api('PATCH', '/campaign', { clocks: cur.clocks.map((c) => (c.name === 'Fuse' ? { ...c, filled: n } : c)), updatedAt: new Date().toISOString() });
    await G.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    return r.status;
  };
  const alarmBtns = () => G.page.$$eval(BEAT + ' [data-vv="skip"], ' + BEAT + ' [data-vv="lockdown"], ' + BEAT + ' [data-vv="release"]', (b) => b.map((x) => x.getAttribute('data-vv')).join());
  check(await alarmBtns() === '', 'at Fuse 2/6: neither alarm button');
  check(await setFuse(6) === 200 && !!(await until(async () => (await alarmBtns()) === 'skip,lockdown', 15000)), 'a jump from 2 straight to 6: both buttons (at or past their fill)');
  check(await setFuse(5) === 200 && !!(await until(async () => (await alarmBtns()) === 'skip', 15000)), 'at Fuse 5: only "skip the next private stop"');
  const skipTxt = await G.page.$eval(BEAT + ' [data-vv="skip"]', (e) => e.textContent);
  check(/skip the next private stop/.test(skipTxt) && /Luxury penthouse 00:15/.test(skipTxt), 'and it names the stop it would skip (the penthouse, 00:15)');
  await G.page.click(BEAT + ' [data-vv="skip"]');
  b = await waitBall((x) => x.over && x.over.od && Array.isArray(x.over.od.skip));
  check(!!b && JSON.stringify(b.over.od.skip) === '[2]' && od(b, '00:30').room === 'Private card rooms', 'it writes ball.over.od.skip with the stop\'s index, and Odette stays in the card rooms (' + JSON.stringify(b && b.over) + ')');
  check(await setFuse(6) === 200 && !!(await until(async () => (await alarmBtns()) === 'lockdown', 15000)), 'at Fuse 6: only Lockdown');
  await G.page.click(BEAT + ' [data-vv="lockdown"]');
  b = await waitBall((x) => x.over && x.over.od && x.over.od.at);
  check(!!b && b.over.od.at === 'Security control room', 'Lockdown sends the target to the alarm lockdown room and holds her there (ball.over.od.at)');
  check(!!(await until(async () => (await alarmBtns()) === 'release', 8000)), 'and the button becomes Release');
  await G.page.click(BEAT + ' [data-vv="release"]');
  b = await waitBall((x) => !(x.over && x.over.od && x.over.od.at));
  check(!!b, 'Release lets her move again');
  await setFuse(2);
  check(!!(await until(async () => (await alarmBtns()) === '', 15000)), 'back at 2/6 the alarm buttons are gone');

  /* the job: the target's row, a delay that starts now, the rival */
  const job = () => secT('job');
  check(/Odette Marsh Private card rooms/.test(await job()) && !/→ Luxury penthouse/.test(await job()), 'the skipped stop is gone from the target\'s row');
  check(/GM-ONLY-PERSON-1 Security control room next 00:30 → gone/.test(await job()), 'the rival\'s next move is on the job');
  await G.page.click('.rv-sec[data-sec="job"] [data-vv="late"][data-n="15"]');
  b = await waitBall((x) => x.over && x.over.od && x.over.od.delay === 15);
  check(!!b && b.over.od.from === 180, 'running late +15 writes delay 15 from ball.t (180), so a person is never dragged back (' + JSON.stringify(b && b.over.od) + ')');
  await G.page.click('.rv-sec[data-sec="job"] [data-vv="late"][data-n="0"]');
  b = await waitBall((x) => !(x.over && x.over.od && x.over.od.delay));
  check(!!b && !(b.over && b.over.od && b.over.od.from), 'clear removes both');

  /* Target is down: the exits */
  check(await G.page.$$eval(BEAT + ' .rv-exits', (l) => l.length) === 0, 'before: no exits listed');
  await G.page.click(BEAT + ' [data-vv="down"]');
  b = await waitBall((x) => x.over && x.over.od && x.over.od.gone === true);
  check(!!b && await G.page.waitForFunction(() => { const e = document.querySelector('.rv-sec[data-sec="beat"] .rv-exits'); return !!e && /GM-ONLY-EXIT-1/.test(e.textContent) && /Luxury penthouse/.test(e.textContent); }, null, { timeout: 5000 }).then(() => true, () => false), 'Target is down writes ball.over.od.gone and the card lists play.exits');
  check(/Odette Marsh down/.test(await job()), 'the job shows her down');
  await G.page.click(BEAT + ' [data-vv="up"]');
  b = await waitBall((x) => !(x.over && x.over.od && x.over.od.gone));
  check(!!b && await G.page.$$eval(BEAT + ' .rv-exits', (l) => l.length) === 0, 'and back up takes the exits away');

  /* the job: ways. B is unheard and its lead is said in the counting room, where nobody stands yet */
  const wayB = '.rv-way[data-way="B"]';
  check(/B GM-ONLY-NAME-2 unheard/.test(await job()) && /A GM-ONLY-NAME-1 unheard/.test(await job()), 'each way shows its state: B unheard, A unheard (the GM un-heard it)');
  await G.page.click(wayB + ' [data-vv="way"]');
  const bt = await G.page.$eval(wayB, (e) => e.textContent.replace(/\s+/g, ' '));
  check(/The lift key hangs on the cook's hook/.test(bt) && /GM-ONLY-WHO-2/.test(bt) && /Underground counting room 21:00–00:00/.test(bt) && /Window 00:15 · Luxury penthouse/.test(bt) && /GM-ONLY-COST-2/.test(bt) && /GM-ONLY-NOTE-6/.test(bt) && /The key/.test(bt), 'expanded: the line and who, where and when, the window, the steps, the cost and the note');
  check(await G.page.$$eval(wayB + ' > .rv-heard > [data-vv="heard"]', (b) => b.length) === 0 && await G.page.$$eval(wayB + ' details.rv-more [data-vv="heard"]', (b) => b.length) === 3, 'Heard by: nobody is in the lead\'s room, so all three wait behind More');
  await crewRoom(G.page, 'run-pc2', 'Underground counting room');
  b = await waitBall((x) => x.crew['run-pc2'].room === 'Underground counting room');
  check(!!b && b.crew['run-pc2'].moved === 12 && b.crew['run-pc2'].noticed === false, 'the room select moves her through moveCrew (moved this beat, noticed cleared)');
  check(await G.page.waitForFunction((s) => document.querySelectorAll(s).length === 1, wayB + ' > .rv-heard > [data-vv="heard"]', { timeout: 5000 }).then(() => true, () => false) && await G.page.$eval(wayB + ' > .rv-heard > [data-vv="heard"]', (e) => e.textContent) === 'Dov Ketch', 'now Dov Ketch is the Heard by button in front, the others behind More');
  await G.page.click(wayB + ' > .rv-heard > [data-vv="heard"]');
  b = await waitBall((x) => x.heard && x.heard.B && x.heard.B['run-pc2'] === 180);
  check(!!b && /B GM-ONLY-NAME-2 heard by Dov Ketch/.test(await job()), 'Heard by writes ball.heard.B.<pc> = the published time');
  await G.page.check(wayB + ' [data-vv="step"][data-i="0"]');
  b = await waitBall((x) => x.steps && x.steps.B);
  check(!!b && JSON.stringify(b.steps.B) === '[true,false]' && /B GM-ONLY-NAME-2 steps 1 of 2/.test(await job()), 'ticking a step writes ball.steps.B and the row reads steps 1 of 2');
  await G.page.click(wayB + ' [data-vv="done"]');
  b = await waitBall((x) => x.ways && x.ways.B === 'done');
  check(!!b && /B GM-ONLY-NAME-2 done/.test(await job()), 'Done writes ball.ways.B and the row reads done');
  await G.page.click(wayB + ' [data-vv="done"]'); await waitBall((x) => !x.ways);
  await G.page.uncheck(wayB + ' [data-vv="step"][data-i="0"]'); await waitBall((x) => !x.steps);
  check(!/GM-ONLY-NAME-1 window gone/.test(await job()), 'A\'s window (to 00:15) is still open at 00:00');

  /* the crew: busy, items, noticed, blown, the costume and the room; the position follows */
  const pc1 = crewRow('run-pc1'); await drawer(G.page, true);
  { const ns = await G.page.$$eval('.rv-crew .rv-crn', (l) => l.map((x) => x.textContent)); check(ns.length === 3 && ns.join() === ns.slice().sort().join(), 'the crew sits in the table\'s order (by name), not by danger: ' + ns.join()); }
  await G.page.click(pc1 + ' [data-vv="busy"][data-n="1"]');
  b = await waitBall((x) => x.crew['run-pc1'].busy === 195);
  check(!!b && /busy until 00:15/.test(await G.page.$eval(pc1 + ' .rv-busy', (e) => e.textContent)), '+1 beat: busy until t + 15 (195, 00:15)');
  await G.page.click(pc1 + ' [data-vv="busy"][data-n="2"]');
  b = await waitBall((x) => x.crew['run-pc1'].busy === 225);
  check(!!b, '+2 beats adds to what is left (225)');
  await G.page.click(pc1 + ' [data-vv="busy"][data-n="0"]');
  b = await waitBall((x) => x.crew['run-pc1'].busy === undefined);
  check(!!b, 'clear removes it');
  await G.page.click(pc1 + ' [data-vv="item"][data-id="key"]');
  b = await waitBall((x) => JSON.stringify(x.crew['run-pc1'].items) === '["key"]');
  check(!!b, 'an item toggles into ball.crew.<pc>.items');
  await G.page.click(pc1 + ' [data-vv="item"][data-id="key"]');
  await waitBall((x) => x.crew['run-pc1'].items === undefined);
  await G.page.selectOption(pc1 + ' [data-vv="room"]', 'Cocktail lounge');
  await waitBall((x) => x.crew['run-pc1'].room === 'Cocktail lounge');
  await G.page.selectOption(pc1 + ' [data-vv="room"]', 'Showroom'); await waitBall((x) => x.crew['run-pc1'].room === 'Showroom');
  check(await G.page.$$eval(pc1 + ' [data-vv="costume"], ' + pc1 + ' [data-vv="pos"], ' + pc1 + ' [data-vv="noticed"], ' + pc1 + ' [data-vv="blown"], ' + pc1 + ' .rv-wary', (l) => l.length) === 0, 'the crew row has no costume select, position chip, noticed or blown (the GM sets Position on the console by hand)');
  b = await waitBall((x) => x.crew['run-pc1'].moved === 12);          /* the room select above moved her in this beat */
  check(!!b && await G.page.waitForFunction((s) => document.querySelector(s).getAttribute('aria-pressed') === 'true', pc1 + ' [data-vv="moved"]', { timeout: 5000 }).then(() => true, () => false), 'the moved tick is on after a move (beat index 12 at 00:00)');
  await G.page.click('[data-rv="back"]'); await waitBall((x) => x.t === 165);
  check(await G.page.waitForFunction((s) => document.querySelector(s).getAttribute('aria-pressed') === 'false', pc1 + ' [data-vv="moved"]', { timeout: 5000 }).then(() => true, () => false), 'and clears when the time changes');

  await drawer(G.page, false);
  /* intel: Tell per PC and Tell the crew */
  await G.page.click('.rv-sec[data-sec="intel"] summary');
  const i1 = '.rv-intel1[data-intel="I1"]';
  check(await G.page.$$eval(i1 + ' [data-vv="tell"]', (b) => b.length) === 3 && await G.page.$$eval(i1 + ' [data-vv="tellcrew"]', (b) => b.length) === 1, 'intel: a Tell button per PC, and Tell the crew');
  await G.page.click(i1 + ' [data-vv="tell"][data-pc="run-pc1"]');
  b = await waitBall((x) => x.told && JSON.stringify(x.told.I1) === '["run-pc1"]');
  check(!!b, 'Tell Cass Fenn: ball.told.I1 = [pc]');
  await G.page.click(i1 + ' [data-vv="tellcrew"]');
  b = await waitBall((x) => x.told && x.told.I1 === 'crew');
  check(!!b && await G.page.$eval(i1 + ' [data-vv="tell"]', (e) => e.disabled), 'Tell the crew: ball.told.I1 = "crew"');
  await G.page.click(i1 + ' [data-vv="tellcrew"]');
  await waitBall((x) => !x.told);
  check(/Intel 0 of 4 told/.test(await secT('intel')), 'and takes it back (0 of 4 told)');

  await G.page.click(wayB + ' [data-vv="way"]'); await shot(G.page, 'runv2-04-beat-crew-job');
  /* put the night back where the later sections expect it: 22:15, the lounge */
  await crewRoom(G.page, 'run-pc2', 'Cocktail lounge'); await waitBall((x) => x.crew['run-pc2'].room === 'Cocktail lounge');
  await api('PATCH', '/gm/state', { ball: { t: 75 } }); await G.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await G.page.waitForFunction(() => document.querySelector('#rv-time').textContent.trim() === '22:15', null, { timeout: 10000 });
  check(!JSON.stringify(await gmState()).includes('"pace"'), 'nothing of the pacing line reached the state');
  /* ==== end VV5 ==== */

  /* ---- 10. nothing leaked: the iPad's payload and the campaign document ---- */
  const camp = (await api('GET', '/campaign')).json;
  const pub = camp.doc && camp.doc.mission;
  check(!!pub && pub.v === 1 && pub.seq >= 1 && ['GM-ONLY', 'Odette'].every((w) => !JSON.stringify(pub).includes(w)), 'the night is published to the campaign document (VV6), with no GM-only text and no target name');
  const disp = JSON.stringify((await api('GET', '/gm/display')).json || {});
  check(['GM-ONLY', 'Odette', 'Wren', 'Pip Quill', 'Fuse'].every((w) => !disp.includes(w)), 'the iPad payload carries no GM-only text, no person and no clock name');
  await G.c.close();

  /* ---- 11. a reload: the same ---- */
    const R = await open();
  check(await until(() => tabShown(R.page), 15000), 'after a reload the tab is there');
  await R.page.keyboard.press('g');
  await R.page.waitForSelector('.rv-head');
  check(await timeText(R.page) === '22:15' && await R.page.$eval('.rv-card[data-room="Cocktail lounge"] .rv-pc[data-id="run-pc2"]', (e) => !!e), 'the same time and the same crew');
  await R.c.close();

  /* ---- 12. Focus at three sizes ---- */
  for (const [w, h] of [[1366, 768], [1536, 864], [1920, 1080]]) {
    const S = await open(w, h);
    await S.page.keyboard.press('g');
    await S.page.waitForSelector('.rv-head');
    await S.page.keyboard.press('f');
    await S.page.click('.rv-card[data-room="Cocktail lounge"] .rv-cn');
    await sleep(300);
    const m = await S.page.evaluate(() => {
      const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, right: b.right, sh: e.scrollHeight, ch: e.clientHeight }; };
      return { vh: window.innerHeight, focus: document.querySelector('#gm-root').classList.contains('focus'), pane: r('#gm-runv'), head: r('.rv-head'), main: r('.rv-main'), side: r('.rv-side'), sec: r('.rv-sec[data-sec="room"]'), lastCard: (() => { const c = [...document.querySelectorAll('.rv-card')].pop().getBoundingClientRect(); return c.bottom; })() };
    });
    await shot(S.page, 'runv2-focus-' + w + 'x' + h);
    console.log('     ' + w + 'x' + h + ' ' + JSON.stringify(m));
    check(m.focus && m.head.bottom < m.vh && m.sec && m.sec.top < m.vh, w + 'x' + h + ': Focus on; the header and the right column\'s top are on screen');
    if (w >= 1536) check(m.main.sh <= m.main.ch + 1 && m.lastCard <= m.vh && m.pane.sh <= m.pane.ch + 1, w + 'x' + h + ': the header, the whole board and the right column\'s top fit without scrolling');
    else check(m.lastCard <= m.vh || m.main.sh > m.main.ch, w + 'x' + h + ': the board scrolls on its own if it does not fit');
    await S.c.close();
  }
  /* ---- 13. Reset the night (VV12) ---- */
  {
    const Z = await open();
    await Z.page.keyboard.press('g');
    await Z.page.waitForSelector('.rv-head');
    const mission = async () => (await api('GET', '/campaign')).json.doc.mission || null;
    const onlyKept = (x) => !!x && Object.keys(x).every((k) => ['site', 'floor', 'open'].includes(k)) && x.site === NAME2;
    check(await Z.page.$eval('.rv-head .rv-reset', (e) => e.textContent.trim() === 'Reset the night' && !e.matches('[data-rv="next"], [data-rv="back"]')), 'a started night shows Reset the night in the header, apart from the beat buttons');
    /* a no changes nothing */
    const before = JSON.stringify(await ball()), mBefore = JSON.stringify(await mission());
    check(before.length > 80 && !!(await mission()), 'positive control: the night carries state and a published mission');
    answer.no = true; const n0 = asked.length;
    await Z.page.click('.rv-head .rv-reset'); await sleep(1500);
    answer.no = false;
    check(asked.length === n0 + 1 && /^Reset the night\? The clock goes back to Start the night/.test(asked[n0]) && /table clocks stay as they are/.test(asked[n0]), 'Reset the night asks first, in plain words');
    check(JSON.stringify(await ball()) === before && JSON.stringify(await mission()) === mBefore && (await Z.page.$$('.rv-start')).length === 0, 'a no: the ball, the mission and the view are exactly as they were');
    /* a yes resets the night as it stands (whatever the earlier sections left) */
    await Z.page.click('.rv-head .rv-reset');
    check(!!(await until(async () => onlyKept(await ball()) && !(await mission()), 10000)), 'a yes: the ball holds only site/floor/open and the campaign document has no mission (' + JSON.stringify(await ball()) + ')');
    check(!!(await Z.page.waitForSelector('.rv-start [data-rv="start"]', { timeout: 8000 }).then(() => true, () => false)) && (await Z.page.$$('.rv-head .rv-reset')).length === 0, 'Start the night is offered again, and the reset button is gone');
    let disp = (await api('GET', '/gm/display?hseq=999999')).json;
    check(!!disp.mission && disp.mission.hud === null && typeof disp.mission.hseq === 'number' && !disp.mission.unchanged, 'the display answer\'s mission part is { hseq, hud: null } (' + JSON.stringify(disp.mission) + ')');
    check(JSON.stringify((await ball()).open) !== undefined && (await ball()).site === NAME2, 'the map\'s open rooms and the site stay');

    /* a night from the same start, then a reset, then the SAME result again */
    const fresh = async () => {
      await Z.page.click('[data-rv="start"][data-key="4/5"]');
      await until(async () => { const x = await ball(); return x && x.start === 45 ? x : null; }, 8000);
      check(!!(await until(async () => { const m = await mission(); return m && m.hud && m.hud.time === '21:45' ? m : null; }, 10000)), 'the night starts at 4/5 and the band is published (21:45)');
    };
    await fresh();
    await Z.page.click('[data-rv="next"]'); await until(async () => (await timeText(Z.page)) === '22:00', 8000);
    await Z.page.click('[data-rv="next"]'); await until(async () => (await timeText(Z.page)) === '22:15', 8000);
    await Z.page.click('.rv-tray .rv-pc[data-id="run-pc2"]'); await Z.page.click('.rv-card[data-room="Cocktail lounge"]');
    await until(async () => { const x = await ball(); return x && x.crew && x.crew['run-pc2'] ? x : null; }, 8000);
    await Z.page.click('.rv-card[data-room="Cocktail lounge"] .rv-cn');
    const mid = await until(async () => { const x = await ball(); return x && x.heard && x.crew && x.t === 75 ? x : null; }, 8000);
    check(!!mid && !!mid.heard.A, 'two beats, a PC placed and a lead heard are in the ball');
    check(!!(await until(async () => { const m = await mission(); return m && m.hud && m.hud.time === '22:15' ? m : null; }, 10000)), 'and the band follows to 22:15');
    const seqBefore = (await mission()).seq;
    await Z.page.click('.rv-head .rv-reset');
    check(!!(await until(async () => onlyKept(await ball()) && !(await mission()), 10000)), 'Reset the night: the ball is down to site/floor/open and the mission is gone');
    disp = (await api('GET', '/gm/display?hseq=999999')).json;
    check(!!disp.mission && disp.mission.hud === null, 'the display GET\'s mission part is { hseq, hud: null }');
    await Z.page.waitForSelector('.rv-start [data-rv="start"]', { timeout: 8000 });
    await fresh();                      /* the SAME result again: publishing works on the same start */
    await Z.page.click('[data-rv="next"]');
    const again = await until(async () => { const m = await mission(); return m && m.hud && m.hud.time === '22:00' ? m : null; }, 10000);
    check(!!again && again.seq > seqBefore, 'the SAME start picked again and a beat stepped: the mission is published again, the band returns (seq ' + seqBefore + ' to ' + (again && again.seq) + ')');
    const after = await ball();
    check(after.start === 45 && after.t === 60 && !after.heard && !after.crew, 'and nothing from the earlier night came back (' + JSON.stringify(after) + ')');
    await Z.c.close();
  }

  /* ---- A2: the cue moves a PC. A typed "Blade, <PC> to the <room>" in the Blade panel's Ask bar writes ball.crew on the running night, "Blade, undo" puts them back ---- */
  {
    const Q = await open();
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    await Q.c.route('**/api/gm/assist/tick', (route) => json(route, { cards: [], updates: [], flags: [], spend: { tonight: 0.3, cap: 20, tier: 'all', tick: 0.02 }, last: 9 }));
    await Q.c.route('**/api/gm/assist/cards', (route) => route.request().method() === 'POST' ? json(route, { marked: 1 }) : json(route, { cards: [], updates: [], asks: [] }));
    await Q.page.keyboard.press('g');
    await Q.page.waitForSelector('.rv-head', { timeout: 10000 });
    await Q.page.keyboard.press('a');
    await Q.page.waitForFunction(() => document.querySelector('#as-panel') && document.querySelector('#as-panel').getBoundingClientRect().left < innerWidth - 100, null, { timeout: 6000 });
    const type = async (text) => { await Q.page.fill('#as-ask-q', text); await Q.page.press('#as-ask-q', 'Enter'); };
    const cardText = (re) => until(async () => (await Q.page.$$eval('#as-list .as-card[data-id^="cogm|"]', (l) => l.map((x) => x.textContent))).find((t) => re.test(t)), 8000, 100);
    const nowI = BALL.beatOf(c2.play, (await ball()).t).i;
    await type('Blade, Cass to the cocktail lounge');
    const m1 = await until(async () => { const x = await ball(); return x && x.crew && x.crew['run-pc1'] && x.crew['run-pc1'].room === 'Cocktail lounge' ? x : null; }, 10000, 100);
    check(!!m1 && m1.crew['run-pc1'].moved === nowI, 'typed "Blade, Cass to the cocktail lounge": ball.crew holds Cass Fenn in the Cocktail lounge, moved = this beat (' + JSON.stringify(m1 && m1.crew) + ')');
    check(!!(await cardText(/Moved Cass Fenn to Cocktail lounge/)) && !!(await until(async () => (await Q.page.$$eval('.rv-card[data-room="Cocktail lounge"] .rv-pc', (c) => c.map((x) => x.getAttribute('data-id')))).includes('run-pc1'), 8000)), 'the green card says so and the Run board shows the chip in that room');
    await type('Blade, Dov Ketch is in the showroom');
    check(!!(await until(async () => { const x = await ball(); return x && x.crew && x.crew['run-pc2'] && x.crew['run-pc2'].room === 'Showroom' && x.crew['run-pc1'].room === 'Cocktail lounge' ? x : null; }, 10000, 100)), '"Dov Ketch is in the showroom" moves Dov and leaves Cass where she was');
    await type('Blade, undo');
    check(!!(await until(async () => { const x = await ball(); return x && x.crew && x.crew['run-pc2'] && x.crew['run-pc2'].room === '' && x.crew['run-pc1'].room === 'Cocktail lounge' ? x : null; }, 10000, 100)), '"Blade, undo" puts Dov back in the tray (the newest move), Cass stays');
    const before = JSON.stringify((await ball()).crew);
    await type('Blade, Ira to the vault');
    check(!!(await cardText(/don.t know a room called .vault/i)) && JSON.stringify((await ball()).crew) === before, 'an unknown room is a card and writes nothing');
    await type('Blade, move Zed to the showroom');
    check(!!(await cardText(/don.t know a PC called .Zed/i)) && JSON.stringify((await ball()).crew) === before, 'an unknown PC is a card and writes nothing');
    await type('Blade, tick Fuse');
    check(!!(await until(async () => (await api('GET', '/campaign')).json.doc.clocks.find((k) => k.name === 'Fuse' && k.filled === 3), 10000, 100)) && JSON.stringify((await ball()).crew) === before, 'a clock cue still ticks the clock');
    await Q.c.close();
  }

  /* ---- B: the Rooms section (notes from the prep part, who is here, an NPC card), the time toggle, the phone's move request ---- */
  {
    const N = await open();
    await N.page.keyboard.press('g');
    await N.page.waitForSelector('.rv-head', { timeout: 10000 });
    const st0 = await ball();
    const pipId = (c2.play.people.find((p) => p.label === 'Pip Quill') || {}).id;
    const pipRoom = BALL.placesAt(c2.play, st0, st0.t)[pipId];
    check(!!pipRoom && !!pipRoom.room, 'Pip Quill is somewhere at the published time (' + JSON.stringify(pipRoom) + ')');
    const sec = '.rv-sec[data-sec="room"]';
    await N.page.click('.rv-card[data-room="Cocktail lounge"] .rv-cn');
    const lounge = sec + ' .rv-rm[data-room="Cocktail lounge"]';
    check(await N.page.$eval(lounge, (e) => /LOUNGE-NOTE-BODY/.test(e.textContent) && !!e.querySelector('.rv-rmnote .pp-say')), 'a room block: the prep note\'s ## Rooms text for the room, its SAY callout drawn as a read-aloud card');
    check(await N.page.$eval(lounge + ' .rv-rmnote a[href^="#pp:npc:"]', (a) => /Pip Quill/.test(a.textContent)), 'a wikilink in the note is a #pp: link');
    /* ticket R: the segment of the note holding the beat's time is lit; a peek a beat later moves it */
    {
      const BL = Number.isInteger(c2.play.clock.beat) ? c2.play.clock.beat : 15, bt = Math.floor(st0.t / BL) * BL, lab = (m) => BALL.timeLabel(c2.play, m);
      const lit = () => N.page.$$eval(lounge + ' .rv-rmnote mark.rv-now', (l) => l.map((e) => e.textContent));
      const l0 = await lit();
      check(l0.length === 1 && l0[0].startsWith(lab(bt)), 'the room note lights the segment holding the shown beat time (' + lab(bt) + '): ' + JSON.stringify(l0));
      check(await N.page.$eval(sec + ' .rv-nowkey', (e) => e.textContent) === 'Lit: this beat, ' + lab(bt) + '–' + lab(bt + BL), 'the legend names the beat');
      check(await N.page.$eval(sec + ' .rv-nowkey', (e) => !!e.previousElementSibling && e.previousElementSibling.classList.contains('rv-sh')), 'the legend follows a heading');
      await N.page.click('.rv-sq[data-i="' + (bt / BL + 1) + '"]');
      const l1 = await lit();
      check(l1.length === 1 && l1[0].startsWith(lab(bt + BL)) && l1[0] !== l0[0], 'peeking a beat later moves the light: ' + JSON.stringify(l1));
      await N.page.click('[data-rv="unpeek"]');
      check(JSON.stringify(await lit()) === JSON.stringify(l0), 'Back to now returns it');
    }
    await N.page.click('.rv-card[data-room="Showroom"] .rv-cn');
    check(await N.page.$eval(sec + ' .rv-rm[data-room="Showroom"] .rv-nonote', (e) => /No notes for Showroom/.test(e.textContent) && /### Showroom/.test(e.textContent)), 'a room with no section says so, and what to add');
    check(await N.page.$$eval(sec + ' .rv-rm', (l) => l.length >= 1 && l[0].getAttribute('data-room') === 'Showroom'), 'the tapped room comes first');
    /* an NPC name opens the card */
    await N.page.click('.rv-card[data-room="' + pipRoom.room + '"] .rv-cn');
    await N.page.click(sec + ' .rv-rm[data-room="' + pipRoom.room + '"] .rv-npcname');
    check(!!(await N.page.waitForSelector('.rv-npcpop', { timeout: 5000 }).then(() => true, () => false)) && await N.page.$eval('.rv-npcpop', (e) => /PIPCARD-BODY/.test(e.textContent) && /Pip Quill/.test(e.querySelector('header').textContent)), 'an NPC name opens the card in a popover');
    await N.page.keyboard.press('Escape');
    check(!!(await until(async () => (await N.page.$$('.rv-npcpop')).length === 0, 5000, 100)), 'Esc closes the card');
    await N.page.click(sec + ' .rv-rm[data-room="' + pipRoom.room + '"] .rv-npcname');
    await N.page.click('.rv-npcpop [data-rv="npcx"]');
    check((await N.page.$$('.rv-npcpop')).length === 0, 'the cross closes it too');
    check(await N.page.$$eval(sec + ' .rv-npcname', (l) => l.every((b) => b.textContent === 'Pip Quill')), 'only an NPC with a card is a button (the others are plain text)');
    await N.page.click('.rv-card[data-room="Cocktail lounge"] .rv-cn');
    await N.page.click(lounge + ' .rv-rmnote a[href^="#pp:npc:"]');
    check(!!(await N.page.waitForSelector('.rv-npcpop', { timeout: 5000 }).then(() => true, () => false)) && await N.page.$eval('.rv-npcpop', (e) => /PIPCARD-BODY/.test(e.textContent)), 'a #pp: NPC link in a room note opens the same card');
    await shot(N.page, 'runv2-04-rooms-npc');
    await N.page.keyboard.press('Escape');

    /* the header time toggle in the Run menu */
    await N.page.click('[data-rv="menu"]');
    check(await N.page.$$eval('#rv-menu button', (l) => l.some((b) => /Show the time to the players/.test(b.textContent))), 'the Run menu offers Show the time to the players');
    await N.page.click('#rv-menu button:has-text("Show the time to the players")');
    check(!!(await until(async () => (await ball()).showTime === true, 8000, 100)), 'it writes ball.showTime');
    await N.page.click('[data-rv="menu"]');
    await N.page.click('#rv-menu button:has-text("Hide the time from the players")');
    check(!!(await until(async () => (await ball()).showTime === undefined, 8000, 100)), 'and again takes it back (the key goes)');
    check(await N.page.$eval('#rv-time', (e) => parseFloat(getComputedStyle(e).fontSize) <= 26), 'the header time is small (24 px)');

    /* the room note's costume line and SAY lines reach the player card of a PC standing in that (open) room */
    await crewRoom(N.page, 'run-pc1', 'Cocktail lounge');
    const mc = await until(async () => { const m = (await api('GET', '/campaign')).json.doc.mission; const c = m && m.cards && m.cards['run-pc1']; return c && c.room === 'Cocktail lounge' && c.costumeLine ? { c, hud: m.hud } : null; }, 20000, 200);
    check(!!mc && mc.c.costumeLine === 'Brocade jackets.' && JSON.stringify(mc.c.here) === '["Mind the glass."]', 'the published card carries costumeLine and here from the room note (' + JSON.stringify(mc && mc.c) + ')');
    check(!!mc && Array.isArray(mc.hud.rooms) && mc.hud.rooms.some((z) => z.rooms.includes('Cocktail lounge')) && !mc.hud.rooms.some((z) => z.rooms.includes('Luxury penthouse')), 'the band lists the open rooms by zone, and not a room that is shut');
    /* a phone move request folds in once; a GM move afterwards does not replay it */
    const crewOf = async (id) => ((await ball()).crew || {})[id];
    const cur = await crewOf('run-pc1');
    check(!!cur && typeof cur.room === 'string', 'a PC in the night to ask from (' + JSON.stringify(cur) + ')');
    const dest = cur.room === 'Showroom' ? 'Cocktail lounge' : 'Showroom';
    const seq1 = Date.now();
    check((await api('PATCH', '/characters/run-pc1', { moveReq: { room: dest, seq: seq1 } })).status === 200, 'the owner\'s own character takes a top-level moveReq');
    const f1 = await until(async () => { const c = await crewOf('run-pc1'); return c && c.room === dest && c.mseq === seq1 ? c : null; }, 20000, 200);
    check(!!f1, 'the request is folded in: the PC is in ' + dest + ', mseq is the request\'s seq (' + JSON.stringify(await crewOf('run-pc1')) + ')');
    await crewRoom(N.page, 'run-pc1', cur.room);
    await until(async () => (await crewOf('run-pc1')).room === cur.room, 8000, 100);
    await sleep(2500);
    const f2 = await crewOf('run-pc1');
    check(f2.room === cur.room && f2.mseq === seq1, 'a GM drag afterwards leaves mseq alone and the old request is not replayed (' + JSON.stringify(f2) + ')');
    const seq2 = seq1 + 1;
    await api('PATCH', '/characters/run-pc1', { moveReq: { room: 'Luxury penthouse', seq: seq2 } });
    const f3 = await until(async () => { const c = await crewOf('run-pc1'); return c && c.mseq === seq2 ? c : null; }, 20000, 200);
    check(!!f3 && f3.room === cur.room, 'a request for a room that is not open sets mseq and moves nobody (' + JSON.stringify(f3) + ')');
    /* Reset the night consumes every pending request: the PC keeps only its mseq, so nothing replays after the reset */
    const seq3 = seq2 + 1;
    await api('PATCH', '/characters/run-pc1', { moveReq: { room: 'Showroom', seq: seq3 } });
    await until(async () => (await crewOf('run-pc1')).mseq === seq3, 20000, 200);
    await N.page.click('.rv-head .rv-reset');
    const rb = await until(async () => { const x = await ball(); return x && !x.start && x.crew && x.crew['run-pc1'] ? x : null; }, 15000, 200);
    check(!!rb && JSON.stringify(rb.crew['run-pc1']) === JSON.stringify({ mseq: seq3 }), 'Reset the night leaves each pending request consumed (crew entry holds only mseq: ' + JSON.stringify(rb && rb.crew) + ')');
    await N.c.close();
  }

  check(!errors.length, 'no page errors: ' + errors.slice(0, 3).join(' | '));
  await browser.close();
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
clearTimeout(timeout);
console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASSED'));
process.exit(failed ? 1 : 0);
