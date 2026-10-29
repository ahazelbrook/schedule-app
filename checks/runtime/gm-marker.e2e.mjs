// The target's marker on the iPad (VV8, design 5.3): a real browser against a real local Worker on PORT (default 9022), with INVENTED sites.
// The player layer is put on the iPad; the marker comes with the time, the PC and the open bands, follows a Lockdown, and leaves on Target is down.
//   PW_MODULE=<playwright install> PW_CHANNEL=msedge node checks/runtime/gm-marker.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9022);
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
  console: conFix.parts.console, campaign: { ...conFix.parts.campaign, src: { ...conFix.parts.campaign.src, exportedAt: NOW } },
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


  /* ---- the GM files three PCs, picks the v2 site and puts the PLAYER layer on the iPad ---- */
  const G0 = await open();
  const spec = await G0.page.evaluate(() => window.B68.BASE_FIGURE);
  const pcDoc = (name) => ({ v: 2, name, alias: '', code: '', playbook: 'hound', playbookName: 'Hound', spec, sheet: { name }, play: { vice: '', purveyor: '', contacts: [], clocks: [] } });
  for (const [id, n] of [['run-pc1', 'Cass Fenn'], ['run-pc2', 'Dov Ketch']]) check((await api('PUT', '/characters/' + id, pcDoc(n))).status === 200, 'an invented PC is filed: ' + n);
  await G0.c.close();
  const display = async () => (await api('GET', '/gm/display')).json;
  const OPEN_PUBLIC = { public: true, working: false, controlled: false, secure: false };
  const card = { hid: 'h_vv8', auth: NAME2, label: NAME2 + ' · Nowhere Ward', at: new Date().toISOString() };
  check((await api('PATCH', '/gm/state', { cards: { location: card }, loc: { map: { view: 'iso', theme: 'rulebook', layer: 'player', reveal: OPEN_PUBLIC } },
    ball: { site: NAME2, start: 0, t: 100, crew: { 'run-pc1': { room: 'Cocktail lounge', disguise: 'guest' } } } })).status === 200, 'the v2 site, the player layer, public bands open, 22:40, one PC in the lounge');
  const G = await open();
  await G.page.keyboard.press('b');
  await G.page.waitForSelector('[data-gm="ipad"]', { timeout: 20000 });
  const sendAndWait = async (act) => { const before = (await display()).seq; await act(); return until(async () => { const d = await display(); return d.seq > before ? d : null; }, 9000); };
  const lastSeq = { v: 0 };
  const OM = (svg) => (String(svg).match(/>OM</g) || []).length;                 // the target's pill: his initials, once per marker
  const names = (svg) => ['Odette', 'Marsh', 'Wren', 'Tully', 'Pip', 'Quill', 'GM-ONLY'].filter((n) => String(svg).includes(n));
  const follow = async (what, cond, act) => {
    const before = (await display()).seq; await act();
    await G.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    const d = await until(async () => { const x = await display(); return x.seq > before && x.display.kind === 'svg' && cond(x.display.svg) ? x : null; }, 12000);
    check(!!d, what);
    if (d) lastSeq.v = d.seq;
    return d;
  };

  const d0 = await sendAndWait(() => G.page.click('[data-gm="ipad"]'));
  check(!!d0 && d0.display.kind === 'svg', 'Show on iPad: the player copy goes');
  check(d0 && (d0.display.svg.match(/#fffdf6/g) || []).length === 1 && OM(d0.display.svg) === 0 && names(d0.display.svg).length === 0, '22:40: the PC in the lounge has a marker; the target (in the Showroom, nobody with him, no event) has none');
  check(d0 && d0.display.svg.includes('\u{1F3AD}'), 'the PC\'s marker carries the Guest costume\'s icon (a glyph, no new text)');
  check(!d0.display.svg.includes('>Guest<'), 'and not the costume\'s name');

  const d1 = await follow('a PC walks into his room: his marker appears on the iPad by itself (the next push the page already makes)', (s) => OM(s) === 1 && !names(s).length,
    () => api('PATCH', '/gm/state', { ball: { crew: { 'run-pc1': { room: 'Showroom', disguise: 'guest' } } } }));
  check(d1 && (d1.display.svg.match(/#fffdf6/g) || []).length === 1, 'one token in the Showroom: the PC and the target share it');

  await follow('time moves on to 23:30 (he has gone to the card rooms, a closed band): no marker, and the card rooms are not named', (s) => OM(s) === 0 && !/Private card/.test(s),
    () => api('PATCH', '/gm/state', { ball: { t: 150 } }));
  await follow('the PC follows him into a CLOSED room: still no marker, nothing about that room', (s) => OM(s) === 0 && !/Private card/.test(s) && (s.match(/#fffdf6/g) || []).length === 0,
    () => api('PATCH', '/gm/state', { ball: { crew: { 'run-pc1': { room: 'Private card rooms', disguise: 'guest' } } } }));
  const dOpen = await follow('the GM opens that band: the marker is there, with the PC', (s) => OM(s) === 1,
    () => api('PATCH', '/gm/state', { loc: { map: { reveal: { public: true, working: false, controlled: true, secure: false } } } }));
  check(!!dOpen, 'opening a band goes through the existing live reveal (the page may have asked first)');
  await follow('Lockdown into the Showroom (over.at): the marker leaves the card rooms and the PC is alone there', (s) => OM(s) === 0,
    () => api('PATCH', '/gm/state', { ball: { over: { od: { at: 'Showroom' } } } }));
  await follow('the PC joins him in the Showroom: the marker follows the lockdown', (s) => OM(s) === 1,
    () => api('PATCH', '/gm/state', { ball: { crew: { 'run-pc1': { room: 'Showroom', disguise: 'guest' } } } }));
  check((await api('PUT', '/npcs/npc_od', { name: 'Odette Marsh', alias: 'The Host', role: 'invented', revealed: false })).status === 200, 'the target is also a HIDDEN NPC in the cast');
  await follow('hidden NPC: no marker at all, not even his initials, though he is in view with a PC', (s) => OM(s) === 0 && (s.match(/#fffdf6/g) || []).length === 1,
    () => api('PATCH', '/gm/state', { ball: { crew: { 'run-pc1': { room: 'Showroom', disguise: 'guest', moved: 1 } } } }));
  await follow('revealed: the marker is back (positive control)', (s) => OM(s) === 1,
    () => api('PATCH', '/npcs/npc_od', { revealed: true }).then(() => api('PATCH', '/gm/state', { ball: { crew: { 'run-pc1': { room: 'Showroom', disguise: 'guest', moved: 2 } } } })));
  await follow('Target is down (over.gone): the marker is gone, the PC\'s stays', (s) => OM(s) === 0 && (s.match(/#fffdf6/g) || []).length === 1,
    () => api('PATCH', '/gm/state', { ball: { over: { od: { gone: true } } } }));
  const fin = (await display()).display;
  check(names(fin.svg).length === 0, 'the final copy names no one');
  check(!JSON.stringify(await api('GET', '/campaign')).includes('Odette'), 'nothing of the target in the campaign document');
  await G.c.close();
  check(!errors.length, 'no page errors: ' + errors.slice(0, 3).join(' | '));
  await browser.close();
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
clearTimeout(timeout);
console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASSED'));
process.exit(failed ? 1 : 0);
