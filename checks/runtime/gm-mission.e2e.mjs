// The players' mission from the Run view (VV6; app/gm/mission-publish.js) in a real browser against a real local Worker (wrangler dev, DEV_USER) on PORT
// (default 8910), with INVENTED authored sites (checks/runtime/fixtures/gm/pelican-play-v2.json). Start the night, place the crew, Next twice, Back, a peek and a
// jump; the Players chip ticks; the Players view matches the stored mission; the overlay comes only from Next; a PC in a shut room publishes with room ""; End the night.
//   PW_MODULE=<playwright install> PW_CHANNEL=msedge node checks/runtime/gm-mission.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8910);
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
const BANDS = ['public', 'public', 'working', 'working', 'controlled', 'secure'];
const ROOMS = V2.zones.flatMap((z) => z.rooms).map((name, i) => ({ name, band: BANDS[i], detail: 'A room.', ...(i === 5 ? { isTarget: true } : {}) }));
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
  console: conFix.parts.console, campaign: { ...conFix.parts.campaign, src: { ...conFix.parts.campaign.src, exportedAt: NOW } },
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: NOW }, T: locFix.T, extra: locFix.extra,
    authored: { v: 1, sites: { [NAME2]: site(NAME2, c2.play), [NAME1]: site(NAME1, c1.play) }, bind: {} } },
};

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-mission-e2e-'));
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

  /* ---- the night: Start the night, place the crew ---- */
  check((await setCard(NAME2)).status === 200, 'the Location card is the v2 site');
  check((await api('PATCH', '/gm/state', { phoneCards: true })).status === 200, 'Phone cards are on (they are off by default)');
  const G = await open();
  await G.page.keyboard.press('g');
  await G.page.waitForSelector('.rv-head', { timeout: 15000 });
  const mission = async () => (await api('GET', '/campaign')).json.doc.mission;
  const chipText = () => G.page.$eval('.rv-players', (e) => e.textContent.trim());
  const chipOk = () => G.page.$eval('.rv-players', (e) => e.getAttribute('data-ok'));
  const ambOverlay = async () => ((await api('GET', '/gm/ambient')).json.doc || {}).overlay || null;
  check(await chipText() === 'Players: —' && (await chipOk()) === '0', 'before the night the chip reads Players: —, no tick');
  check(!(await mission()), 'and nothing is published');
  check(await G.page.$$eval('.rv-menu [data-rv="menuitem"]', (b) => b.map((x) => x.textContent).join()) === 'Show the time to the players,Phone cards: on,End the night', 'Run\'s menu lists End the night');
  check(await G.page.$$eval('[data-rv="view"]', (b) => b.map((x) => x.textContent).join()) === 'Board,Map,Players', 'and the views are Board, Map, Players');

  await G.page.click('[data-rv="start"][data-key="4/5"]');
  check(!!(await until(async () => (await ball()) && (await ball()).start === 45, 8000)), 'Start the night (4/5): ball.start = 45');
  check(!!(await until(async () => (await chipText()) === 'Players: 21:45 ✓', 10000)), 'the chip ticks about 800 ms later: Players: 21:45 ✓ (' + await chipText() + ')');
  check((await chipOk()) === '1', 'and is marked ok');
  let m = await mission();
  check(!!m && m.v === 1 && m.t === 45 && m.hud.time === '21:45' && m.seq === 1, 'the campaign document holds the mission: t 45, hud 21:45, seq 1');
  check(JSON.stringify(m.cards) === '{}', 'no PC is on the job yet, so no card');

  await G.page.click('.rv-tray .rv-pc[data-id="run-pc1"]'); await G.page.click('.rv-card[data-room="Showroom"]');
  await until(async () => ((await ball()).crew || {})['run-pc1'], 8000);
  await G.page.click('.rv-tray .rv-pc[data-id="run-pc2"]'); await G.page.click('.rv-card[data-room="Cocktail lounge"]');
  await until(async () => ((await ball()).crew || {})['run-pc2'], 8000);
  await G.page.click('.rv-card[data-room="Luxury penthouse"] .rv-cn');
  await G.page.click('.rv-sec[data-sec="room"] [data-rv="move"][data-id="run-pc3"]');
  await until(async () => ((await ball()).crew || {})['run-pc3'], 8000);
  check(!!(await until(async () => { const x = await mission(); return x && Object.keys(x.cards).length === 3 ? x : null; }, 10000)), 'three PCs on the job: three cards');
  m = await mission();
  const owner1 = (await api('GET', '/characters/run-pc1')).json.doc.owner;
  check(Object.keys(m.cards).sort().join() === 'run-pc1,run-pc2,run-pc3' && m.cards['run-pc1'].name === 'Cass Fenn' && m.cards['run-pc1'].owner === (owner1 || ''), 'cards are keyed by the character document id, with the owner (' + JSON.stringify(owner1) + ')');
  check(m.cards['run-pc3'].room === '' && !JSON.stringify(m).includes('Luxury penthouse'), 'a PC in a room the players cannot see publishes with room "" (and the name is nowhere in the body)');
  check(m.cards['run-pc1'].room === 'Showroom' && m.cards['run-pc2'].room === 'Cocktail lounge', 'the PCs in open rooms name them');
  check(await G.page.$$eval('.gm-toast, #toastErr', (e) => e.map((x) => x.textContent).join('').trim()) === '', 'no refusal toast');

  /* ---- Next twice, Back, a peek, a jump ---- */
  const ov0 = await ambOverlay();
  await G.page.click('[data-rv="next"]');
  check(!!(await until(async () => (await mission()) && (await mission()).t === 60, 10000)) && await chipText() === 'Players: 22:00 ✓', 'Next: the mission is at 22:00 and the chip follows');
  const ov1 = await until(async () => { const o = await ambOverlay(); return o && (!ov0 || o.id !== ov0.id) ? o : null; }, 8000);
  check(!!ov1 && ov1.kind === 'text' && ov1.text === 'The speeches' && ov1.ms === 8000, 'Next landed on a public event: an 8 s text overlay of its pub (' + JSON.stringify(ov1) + ')');
  await G.page.click('[data-rv="next"]');
  check(!!(await until(async () => (await mission()).t === 75, 10000)), 'Next again: 22:15');
  check((await ambOverlay()).id === ov1.id, 'and no new overlay (nothing public lands at 22:15)');
  await G.page.click('[data-rv="back"]');
  check(!!(await until(async () => (await mission()).t === 60, 10000)) && (await ambOverlay()).id === ov1.id, 'Back: the mission is at 22:00 again and lays no overlay');
  const seqBefore = (await mission()).seq;
  await G.page.click('.rv-sq[data-i="10"]');
  check(await G.page.$eval('.rv-peekbar', (e) => /23:30/.test(e.textContent)), 'a peek at 23:30 is up');
  await sleep(1800);
  check((await mission()).seq === seqBefore && (await mission()).t === 60 && await chipText() === 'Players: 22:00 ✓', 'the peek published nothing: same seq, same time, same chip');
  check((await ambOverlay()).id === ov1.id, 'and laid no overlay');
  await G.page.click('[data-rv="unpeek"]');
  await G.page.click('[data-rv="back"]');
  check(!!(await until(async () => (await mission()).t === 45, 10000)), 'Back to 21:45');
  const seqJ = (await mission()).seq;
  await G.page.keyboard.press('Shift+ArrowRight');
  check(!!(await until(async () => (await mission()).t > 45, 10000)) && (await ambOverlay()).id === ov1.id, 'a jump publishes the new time and lays no overlay (' + (await mission()).t + ')');
  void seqJ;
  await G.page.click('[data-rv="back"]').catch(() => {});
  await until(async () => (await mission()).t === 45, 10000);
  await G.page.click('[data-rv="next"]');
  const ov2 = await until(async () => { const o = await ambOverlay(); return o && o.id !== ov1.id ? o : null; }, 8000);
  check(!!ov2 && ov2.text === 'The speeches', 'Next onto the event again lays a fresh overlay');
  await sleep(1200);

  /* ---- the Players view is the PATCH body ---- */
  await G.page.click('[data-rv="view"][data-v="players"]');
  await G.page.waitForSelector('.gm-pv', { timeout: 10000 });
  m = await mission();
  const pv = await G.page.$eval('#rv-view', (e) => e.textContent);
  check(pv.includes(m.hud.time) && Object.values(m.cards).every((c) => pv.includes(c.name)), 'the Players view shows the published time and each PC\'s card (' + m.hud.time + ')');
  const leads = Object.values(m.cards).flatMap((c) => c.leads.map((l) => l.name));
  check(Object.values(m.cards).flatMap((c) => c.know).every((k) => pv.includes(k)) && leads.every((n) => pv.includes(n)), 'what each card knows and the leads it holds are all there');
  check(await G.page.$$eval('.gm-pv-card', (c) => c.length) === Object.keys(m.cards).length, 'one card section per card in the body');
  check(!pv.includes('GM-ONLY') && !pv.includes('Odette') && !pv.includes('Luxury penthouse'), 'and nothing the players must not read');
  const bodyJson = JSON.stringify(m);
  check(!bodyJson.includes('GM-ONLY') && !bodyJson.includes('Odette'), 'the stored mission holds no GM-ONLY string and no target name');
  await shot(G.page, 'mission-01-players');
  /* the view is the last published, not the GM state: move a PC and look before the 800 ms are up */
  await G.page.click('[data-rv="view"][data-v="board"]');

  /* ---- End the night ---- */
  answer.no = true; asked.length = 0;
  await G.page.click('[data-rv="menu"]'); await G.page.click('[data-rv="menuitem"]:has-text("End the night")');
  await sleep(1500);
  check(asked.some((q) => /End the night/.test(q)) && !!(await mission()), 'a no to the question: it asked, and the mission stays');
  answer.no = false;
  await G.page.click('[data-rv="menu"]');
  asked.length = 0;
  await G.page.click('[data-rv="menuitem"]:has-text("End the night")');
  check(!!(await until(async () => !(await mission()), 10000)), 'End the night: the mission is gone from the campaign document');
  check(asked.some((q) => /End the night/.test(q)), 'it asked first');
  check(await chipText() === 'Players: —' && (await chipOk()) === '0', 'the chip is back to Players: — with no tick');
  await G.page.click('[data-rv="view"][data-v="players"]');
  check(await G.page.$eval('#rv-view', (e) => /Nothing is published/.test(e.textContent)), 'the Players view is empty');
  await G.page.click('[data-rv="view"][data-v="board"]');
  await G.page.click('[data-rv="next"]').catch(() => {});
  await sleep(1800);
  check(!(await mission()), 'an ended night stays ended while the GM keeps working');
  await G.c.close();

  check(!errors.length, 'no page errors: ' + errors.slice(0, 3).join(' | '));
  await browser.close();
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
clearTimeout(timeout);
console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASSED'));
process.exit(failed ? 1 : 0);
