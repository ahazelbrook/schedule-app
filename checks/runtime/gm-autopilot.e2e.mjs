// The iPad autopilot (A2; design 6, GM.md "Autopilot") in a real browser against a real local Worker (wrangler dev, DEV_USER, a display-only
// sign-in): a table clock ticks and the overlay shows on the iPad and then goes, a cooldown holds the next one back, Take over clears it and
// holds, Hand back resumes, a hidden clock's id or name is refused (positive control beside each), an NPC overlay draws on the display-only
// sign-in only while revealed, nothing autopilot-driven lights a blacked-out screen, a GM-pressed dawn is never cleared by the autopilot, and
// (the gap left by M5) a short overlay is gone from the display-only sign-in's GET /api/gm/display once it is over and the page draws nothing.
// Every name, clock and NPC in here is invented. The clocks are named by id: a clock overlay carries no name, the server resolves it.
//   PW_MODULE=<playwright install> PW_CHANNEL=msedge node checks/runtime/gm-autopilot.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8879);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const conFix = JSON.parse(readFileSync(path.join(FIX, 'console-pack.json'), 'utf8'));
const locFix = JSON.parse(readFileSync(path.join(FIX, 'location-pack.json'), 'utf8'));
const NOW = new Date().toISOString();
const PARTS = {
  console: conFix.parts.console, campaign: { ...conFix.parts.campaign, src: { ...conFix.parts.campaign.src, exportedAt: NOW } },
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: NOW }, T: locFix.T, extra: locFix.extra },
};

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-autopilot-e2e-'));
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
async function until(fn, ms, step = 150) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 720000);
const call = (user, method, p, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const api = (method, p, body) => call(GM, method, p, body);
const amb = async () => (await api('GET', '/gm/ambient')).json;
const ovOf = async () => (await amb()).doc.overlay || null;
const ipadDisplay = async (q = '') => (await call(IPAD, 'GET', '/gm/display' + q)).json;
const bump = async (id) => { const c = (await api('GET', '/campaign')).json.doc.clocks.find((x) => x.id === id); return api('PATCH', '/campaign', { clockOps: [{ id, filled: c.filled + 1 }] }); };
const ID_RE = /^a[a-z0-9]+-\d+$/;

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src || {}, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  const clk = (id, name, size, filled, hidden) => ({ id, name, size, filled, kind: 'danger', hidden: !!hidden });
  check((await api('PUT', '/campaign', {
    v: 1, session: { number: 1, startedAt: NOW, endedAt: null },
    crew: { name: 'The Lamplighters', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] },
    clocks: [clk('c_x1k', 'Invented Fuse', 12, 1), clk('c_x2k', 'Invented Wick', 12, 0), clk('c_x3k', 'Invented Dusk', 12, 0), clk('c_x9k', 'Secret Hush Clock', 4, 0, true)], log: [], scene: { npcs: {} } })).status === 200,
  'the table holds three visible clocks and one hidden');

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  const G = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1366, height: 1024 }, serviceWorkers: 'block' });
  await G.addInitScript(() => { window.__B68_POLL_MS = 700; });
  const gp = await G.newPage();
  gp.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  gp.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  gp.on('dialog', (d) => d.accept());
  await gp.goto(BASE + '/#gm');
  await gp.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
  await gp.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  const spec = await gp.evaluate(() => window.B68.BASE_FIGURE);
  /* the cast: a revealed NPC with a portrait, and a hidden one */
  check((await api('PUT', '/npcs/npc_seen', { name: 'Inspector Invented', alias: 'Inky', role: 'Clerk', faction: 'The Invented Guild', description: 'DESC-MARKER', gmNotes: 'GMNOTES-MARKER', revealed: true, spec })).status === 200, 'a revealed NPC with a portrait');
  check((await api('PUT', '/npcs/npc_hid', { name: 'Hidden Mystery Person', alias: 'Shade', role: 'Courier', faction: 'The Invented Guild', gmNotes: 'HIDDEN-MARKER', revealed: false, spec })).status === 200, 'a hidden NPC');
  await gp.evaluate(() => { window.__toasts = []; const t = window.B68.toast; window.B68.toast = function (m) { window.__toasts.push(String(m)); return t.apply(this, arguments); }; });
  const ap = () => gp.evaluate(() => window.B68GmPage._autopilot());
  const barText = () => gp.$eval('#gm-bar-ap', (b) => b.textContent.trim());

  const D = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1366, height: 1024 }, serviceWorkers: 'block' });
  const dp = await D.newPage();
  dp.on('pageerror', (e) => errors.push('display pageerror: ' + e.message));
  await dp.goto(BASE + '/#display'); await dp.waitForSelector('.dp-overlay', { state: 'attached', timeout: 20000 });
  await dp.waitForFunction(() => /Updated|Waiting/.test((document.querySelector('.dp-status-text') || {}).textContent || ''), null, { timeout: 20000 });
  const card = (kind) => dp.$eval('.dp-overlay .dp-ov-' + kind, (c) => ({ text: c.textContent, id: c.getAttribute('data-ov-id'), seg: c.querySelectorAll('.dp-ov-seg-on').length })).catch(() => null);
  const noCard = (ms) => dp.waitForFunction(() => !document.querySelector('.dp-overlay .dp-ov-card'), null, { timeout: ms || 20000 }).then(() => true, () => false);
  const chipShown = () => dp.$eval('.dp-auto', (e) => !e.hidden && getComputedStyle(e).display !== 'none');

  /* ---------- opening writes nothing; a hidden clock never shows ---------- */
  check(await barText() === 'Auto' && /Take over/.test(await gp.$eval('#gm-bar-ap', (b) => b.title)), 'the top bar reads Auto, and its tooltip says Take over');
  const a0 = await amb();
  check(!a0.doc.overlay && !('auto' in a0.doc), 'opening the page wrote no overlay and no auto flag (' + JSON.stringify(Object.keys(a0.doc)) + ')');
  check((await api('PATCH', '/campaign', { clockOps: [{ id: 'c_x9k', filled: 2 }] })).status === 200, 'the hidden clock is ticked');
  await sleep(3500);
  check(!(await ovOf()) && (await ap()).mode === 'ready' && Object.keys((await ap()).pending).length === 0, 'a hidden clock ticking shows nothing and queues nothing');

  /* ---------- a visible clock: the overlay shows on the display-only sign-in, then goes ---------- */
  check((await bump('c_x1k')).status === 200, 'a visible clock is ticked');
  const o1 = await until(ovOf, 15000);
  check(!!o1 && o1.kind === 'clock' && o1.clockId === 'c_x1k' && o1.auto === true && o1.ms === 8000, 'the overlay is a clock overlay for that id, from the autopilot, 8 s (' + JSON.stringify(o1) + ')');
  check(!!o1 && Object.keys(o1).sort().join() === 'at,auto,clockId,id,kind,ms', 'stored by id alone, no name, size or fill: ' + JSON.stringify(o1 && Object.keys(o1).sort()));
  const j1 = (await ipadDisplay()).ambient.doc.overlay;
  check(!!j1 && j1.name === 'Invented Fuse' && j1.size === 12 && j1.filled === 2, 'and the display-only sign-in\'s GET joins the name and the live fill from the campaign (' + JSON.stringify(j1 && { n: j1.name, f: j1.filled }) + ')');
  check(!!o1 && ID_RE.test(o1.id) && !/x1k|c_/i.test(o1.id), 'the overlay id is opaque (a prefix and a counter): ' + (o1 && o1.id));
  check((await amb()).doc.auto === true, 'the ambient document says auto: true with the first overlay');
  check(await dp.waitForSelector('.dp-overlay .dp-ov-clock', { timeout: 15000 }).then(() => true, () => false), 'the display-only sign-in draws the clock card');
  const c1 = await card('clock');
  check(!!c1 && /Invented Fuse/.test(c1.text) && /2 \/ 12/.test(c1.text) && c1.seg === 2, 'with the name and the fill: ' + JSON.stringify(c1));
  check(await chipShown(), 'and the AUTO chip');
  check((await gp.evaluate(() => window.__toasts)).filter((t) => /directing the iPad/.test(t)).length === 1, 'one first-time toast');
  const ids = [o1.id];
  check(await until(async () => !(await ovOf()), 14000), 'the overlay goes (the autopilot clears it at time\'s up)');
  check(await noCard(12000), 'and the card leaves the iPad');
  check(await chipShown(), 'the AUTO chip stays while the autopilot is on');
  check((await ap()).mode === 'ready' && (await ap()).cool > Date.now() - 2000, 'and the 15 s cooldown has started');

  /* ---------- the cooldown holds the next one back; it shows when it is over ---------- */
  const tCool = Date.now();
  check((await bump('c_x1k')).status === 200, 'another tick right after');
  await sleep(4000);
  check(!(await ovOf()) && !!(await ap()).pending.clock, 'inside the cooldown it waits (nothing shown, one waiting)');
  const o2 = await until(ovOf, 25000);
  check(!!o2 && o2.clockId === 'c_x1k' && (await ipadDisplay()).ambient.doc.overlay.filled === 3 && Date.now() - tCool > 8000, 'and it shows once the cooldown is over (after ' + (Date.now() - tCool) + ' ms)');
  ids.push(o2 && o2.id);

  /* ---------- another change while it is up extends it: a new overlay id ---------- */
  check((await bump('c_x1k')).status === 200, 'a tick while the card is up');
  const o3 = await until(async () => { const o = await ovOf(); return o && o.id !== o2.id ? o : null; }, 15000);
  check(!!o3 && o3.ms <= 8000 && o3.clockId === 'c_x1k' && (await ipadDisplay()).ambient.doc.overlay.filled === 4, 'it extends as a new overlay with the new fill (' + JSON.stringify(o3 && { id: o3.id, ms: o3.ms }) + ')');
  ids.push(o3 && o3.id);
  check(!!o3 && await until(async () => { const c = await card('clock'); return c && c.id === o3.id && /4 \/ 12/.test(c.text); }, 15000), 'and the card shows the new fill');
  check(await until(async () => !(await ovOf()), 25000), 'then it goes');
  check(await noCard(12000), 'card gone');

  /* ---------- Take over (from the Blade panel's header) clears it now and holds; the display-only sign-in sees it go ---------- */
  await sleep(1000);
  await gp.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await gp.keyboard.press('a');
  const hdr = await gp.waitForSelector('#as-ap', { state: 'visible', timeout: 10000 }).then(() => true, () => false);
  check(hdr && /Auto · Take over/.test(await gp.$eval('#as-ap', (b) => b.textContent)), 'the Blade panel\'s header has the button');
  const tw = Date.now();
  await gp.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
  check((await bump('c_x2k')).status === 200, 'a tick on another clock');
  const o4 = await until(async () => { const o = await ovOf(); return o && o.clockId === 'c_x2k' ? o : null; }, 30000);
  check(!!o4, 'it shows (after the cooldown if need be, ' + (Date.now() - tw) + ' ms)');
  if (o4) {
    await dp.waitForSelector('.dp-overlay .dp-ov-clock', { timeout: 15000 }).catch(() => {});
    await gp.click('#as-ap');
    check(await until(async () => !(await ovOf()), 8000), 'Take over clears the overlay now (the document holds none)');
    check((await amb()).doc.auto === false, 'and auto is false');
    check(await noCard(12000), 'the card leaves the iPad');
    check(!(await chipShown()), 'and the AUTO chip');
    check(await barText() === 'GM' && /Hand back/.test(await gp.$eval('#gm-bar-ap', (b) => b.title)) && /GM · Hand back/.test(await gp.$eval('#as-ap', (b) => b.textContent)), 'the bar badge reads GM (Hand back in its tooltip) and the panel header reads GM · Hand back');
  }
  check((await ap()).mode === 'hold', 'the controller is on Hold');
  check((await bump('c_x2k')).status === 200 && (await bump('c_x2k')).status === 200, 'ticks while on Hold');
  await sleep(4500);
  check(!(await ovOf()) && Object.keys((await ap()).pending).length === 0, 'Hold shows nothing and queues nothing');

  /* ---------- the display-only expiry, the gap M5 left: a short overlay is gone from the IPAD user's GET once over, and nothing is drawn ---------- */
  const ex = await api('PATCH', '/gm/ambient', { overlay: { id: 'short-1', kind: 'text', ms: 1500, text: 'An invented short line.' } });
  check(ex.status === 200, 'a 1.5 s overlay is set by the GM');
  const live = await ipadDisplay();
  check(live.ambient.doc.overlay && live.ambient.doc.overlay.id === 'short-1' && live.ambient.doc.overlay.age >= 0, 'while it runs the IPAD user\'s GET /api/gm/display carries it (positive control)');
  await sleep(2400);
  const gone = [await ipadDisplay(), await ipadDisplay('?seq=-1&aseq=-1'), await ipadDisplay('?seq=-1&aseq=-1&sseq=-1')];
  check(gone.every((d) => d.ambient && d.ambient.doc && !('overlay' in d.ambient.doc)), 'once it is over the IPAD user\'s GET carries no ambient.doc.overlay, in all three call shapes');
  check((await ovOf()) && (await ovOf()).id === 'short-1', 'the document still holds it (the drop is response only)');
  const fresh = await D.newPage();
  await fresh.goto(BASE + '/#display'); await fresh.waitForSelector('.dp-overlay', { state: 'attached', timeout: 20000 });
  await fresh.waitForFunction(() => /Updated|Waiting/.test((document.querySelector('.dp-status-text') || {}).textContent || ''), null, { timeout: 20000 });
  await sleep(5500);
  check(await fresh.evaluate(() => !document.querySelector('.dp-ov-card') && !document.querySelector('.dp-ov-dawn')), 'and a display-only page that loads after the end draws nothing');
  await fresh.close();
  check(await noCard(12000), 'and the page that was up when it ended draws nothing either');
  await api('PATCH', '/gm/ambient', { overlay: null });

  /* ---------- Hand back resumes ---------- */
  await gp.click('#gm-bar-ap');
  check(await barText() === 'Auto' && (await ap()).mode === 'ready', 'Hand back (the top bar): Auto again');
  const o5 = await until(ovOf, 1500).catch(() => null);
  check(!o5, 'handing back does not replay what happened on Hold');
  check((await bump('c_x2k')).status === 200, 'a tick after handing back');
  const o6 = await until(async () => { const o = await ovOf(); return o && o.clockId === 'c_x2k' ? o : null; }, 15000);
  check(!!o6 && o6.auto === true, 'the overlay shows again');
  check((await amb()).doc.auto === true, 'auto is true again');

  /* ---------- the GM's dawn is never cleared by the autopilot ---------- */
  const dawn = await gp.evaluate(() => window.B68GmPage.showOverlay({ kind: 'fx', fx: 'dawn', ms: 30000 }));
  check(!!dawn, 'the GM sends a dawn over the autopilot\'s card');
  const dd = await ovOf();
  check(dd && dd.kind === 'fx' && !('auto' in dd), 'the document holds the dawn, with no auto mark');
  await sleep(11000);
  const dd2 = await ovOf();
  check(!!dd2 && dd2.id === dd.id && dd2.kind === 'fx', 'ten seconds on, past the clock\'s 8 s, the dawn is still there (the autopilot clears only what it set)');
  await api('PATCH', '/gm/ambient', { overlay: null });
  await dp.waitForFunction(() => !document.querySelector('.dp-ov-dawn'), null, { timeout: 15000 }).catch(() => {});

  /* ---------- secrecy: a hidden clock's id or name is refused; ids are opaque ---------- */
  check((await api('PATCH', '/gm/ambient', { overlay: { id: 'x1', kind: 'clock', ms: 5000, clockId: 'c_x9k' } })).status === 400, 'the server refuses the hidden clock by id (400)');
  check((await api('PATCH', '/gm/ambient', { overlay: { id: 'x2', kind: 'clock', ms: 5000, clockId: 'c_x2k' } })).status === 200, 'and takes a visible one (positive control)');
  await api('PATCH', '/gm/ambient', { overlay: null });
  const r1 = await gp.evaluate(() => window.B68GmPage.showOverlay({ kind: 'text', ms: 5000, text: 'The Secret Hush Clock is ticking.' }));
  check(r1 === null && !(await ovOf()), 'a text overlay naming the hidden clock is refused before it is sent');
  const r2 = await gp.evaluate(() => window.B68GmPage.showOverlay({ kind: 'text', ms: 5000, text: 'Hidden Mystery Person waits outside.' }));
  check(r2 === null && !(await ovOf()), 'and one naming the hidden NPC');
  const r3 = await gp.evaluate(() => window.B68GmPage.showOverlay({ kind: 'text', ms: 5000, text: 'A quiet moment by the invented pier.' }));
  check(!!r3 && (await ovOf()) && (await ovOf()).text === 'A quiet moment by the invented pier.', 'while a line naming nobody hidden goes (positive control)');
  await api('PATCH', '/gm/ambient', { overlay: null });
  check(ids.every((i) => ID_RE.test(i)) && new Set(ids).size === ids.length, 'every autopilot overlay id was opaque and different: ' + ids.join(' '));

  /* ---------- an NPC overlay: drawn on the display-only sign-in while revealed; a hidden NPC never ---------- */
  await sleep(1500);
  check((await api('PATCH', '/campaign', { scene: { npcs: { npc_hid: true, npc_seen: false }, at: NOW } })).status === 200, 'the hidden NPC is put on stage');
  await sleep(2500);
  await gp.evaluate(() => window.B68GmPage._voice({ who: 'Anybody', want: '', lines: ['An invented line.'], at: new Date().toISOString() }));
  await sleep(3500);
  check(!(await ovOf()) && !(await ap()).pending.npc, 'the hidden NPC speaking shows nothing and queues nothing');
  check((await api('PATCH', '/campaign', { scene: { npcs: { npc_hid: false, npc_seen: true } } })).status === 200, 'the revealed NPC is put on stage instead');
  await sleep(2500);
  await gp.evaluate(() => window.B68GmPage._voice({ who: 'Anybody', want: '', lines: ['Another invented line.'], at: new Date().toISOString() }));
  const n1 = await until(async () => { const o = await ovOf(); return o && o.kind === 'npc' ? o : null; }, 30000);
  check(!!n1 && n1.npcId === 'npc_seen' && n1.auto === true && n1.ms === 180000, 'a revealed NPC with a portrait speaking sets an npc overlay (' + JSON.stringify(n1) + ')');
  check(!!n1 && Object.keys(n1).sort().join() === 'at,auto,id,kind,ms,npcId' && ID_RE.test(n1.id) && !/seen|npc/i.test(n1.id), 'stored with the id alone: no name, opaque overlay id');
  check(!JSON.stringify(await amb()).includes('Inspector Invented'), 'no NPC name in the stored ambient document');
  check(await dp.waitForSelector('.dp-overlay .dp-ov-npc .dp-ov-portrait svg', { timeout: 20000 }).then(() => true, () => false), 'the display-only sign-in (which cannot read the cast) draws the portrait');
  const nc = await card('npc');
  check(!!nc && /Inspector Invented/i.test(nc.text) && /Inky/.test(nc.text) && !/MARKER/.test(await dp.evaluate(() => document.getElementById('display-page').innerText)), 'with the name from the server\'s join, and nothing hidden');
  check((await call(IPAD, 'GET', '/npcs/npc_seen')).status === 403, 'the display sign-in cannot read the cast itself');
  const tHide = Date.now();
  check((await api('PATCH', '/npcs/npc_seen', { revealed: false })).status === 200, 'the NPC is hidden');
  check(await until(async () => !(await ovOf()), 10000), 'the page takes the overlay down when its NPC stops being revealed (' + (Date.now() - tHide) + ' ms)');
  check(await noCard(10000), 'and the card leaves the iPad');
  check((await api('PATCH', '/npcs/npc_seen', { revealed: true })).status === 200, 'revealed again (positive control: nothing returns by itself)');
  await sleep(4500);
  check(!(await ovOf()) && !(await card('npc')), 'it does not come back by itself');
  check((await api('PATCH', '/campaign', { scene: { npcs: { npc_seen: false, npc_hid: false } } })).status === 200, 'both off stage');

  /* ---------- Lights out: nothing autopilot-driven lights a blacked-out screen ---------- */
  await sleep(1500);
  await gp.click('#gm-page [data-gm="darkipad"]');
  check(await until(async () => (await ipadDisplay()).display.kind === 'dark', 8000), 'lights out is on the iPad');
  check((await ap()).guards.lights === true, 'the autopilot knows (a guard)');
  check((await bump('c_x3k')).status === 200, 'a clock ticks under lights out');
  await sleep(4000);
  check(!(await ovOf()) && !!(await ap()).pending.clock, 'the autopilot holds it back (one waiting, nothing sent)');
  const refused = await api('PATCH', '/gm/ambient', { overlay: { id: 'lo1', kind: 'clock', ms: 20000, clockId: 'c_x3k' }, auto: true });
  check(refused.status === 409 && /lights out/.test(refused.json && refused.json.error) && !(await ovOf()), 'and the server refuses an autopilot overlay under lights out (409, nothing stored)');
  /* the lights come back: the one that waited shows (positive control) */
  await gp.click('#gm-page [data-gm="blankipad"]');
  const lo2 = await until(async () => { const o = await ovOf(); return o && o.clockId === 'c_x3k' ? o : null; }, 25000);
  check(!!lo2 && lo2.auto === true, 'when the lights come back the held overlay shows (' + (lo2 && lo2.id) + ')');
  check(await dp.waitForSelector('.dp-overlay .dp-ov-clock', { timeout: 15000 }).then(() => true, () => false), 'and the iPad draws it');
  /* another device puts the lights out while the card is up: the page takes it off the black, and the chip, and nothing comes back over it */
  const keep = await ovOf();
  check((await api('PUT', '/gm/display', { kind: 'dark' })).status === 200, 'lights out from another device, with the autopilot\'s card up');
  check(await noCard(12000) && !(await chipShown()), 'the card and the AUTO chip are gone from the black screen');
  check(await dp.evaluate(() => !!document.querySelector('.dp-dark, .dp-stage') && !document.querySelector('.dp-ov-card')), 'the screen is dark with nothing over it');
  const darkGet = await ipadDisplay();
  check(darkGet.display.kind === 'dark' && !('overlay' in darkGet.ambient.doc), 'the display GET leaves the autopilot\'s overlay out while dark');
  const dawnSet = await api('PATCH', '/gm/ambient', { overlay: { id: 'dawn-lo', kind: 'fx', ms: 20000, fx: 'dawn' } });
  const dawnSeen = dawnSet.status === 200 && await dp.waitForSelector('.dp-overlay .dp-ov-dawn', { timeout: 15000 }).then(() => true, () => false);
  check(dawnSeen, 'a GM-pressed dawn is allowed over black (positive control) ' + (dawnSeen ? '' : JSON.stringify({ status: dawnSet.status, doc: (await amb()).doc.overlay, shown: await dp.evaluate(() => ({ ov: document.querySelector('.dp-overlay').innerHTML.slice(0, 200), kind: (document.querySelector('.dp-status-text') || {}).textContent })) })));
  await api('PATCH', '/gm/ambient', { overlay: null });
  check((await api('PUT', '/gm/display', { kind: 'blank' })).status === 200, 'the lights come back');
  await sleep(6000);
  check(!(await card('clock')) && !!keep, 'the autopilot\'s card that was up before the black does not return afterwards');

  check(!errors.length, 'no page errors: ' + errors.slice(0, 3).join(' | '));
  const log = await gp.evaluate(() => window.B68GmPage._autopilot().log);
  check(log.length > 0 && log.every((x) => !/Fuse|Wick|Dusk|Inspector|Secret/i.test(JSON.stringify(x))), 'the controller\'s log has ids and words only, never a name (' + log.length + ' lines)');
  await sleep(1500);
  const st = (await api('GET', '/gm/state')).json.doc;
  check(st.ap && Array.isArray(st.ap.log) && st.ap.log.length > 0 && st.ap.log.length <= 20 && !/Fuse|Wick|Dusk|Inspector|Secret/i.test(JSON.stringify(st.ap)), 'the GM state keeps the last 20 autopilot lines (ap.log): ' + (st.ap && st.ap.log.length));
  await browser.close();
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
clearTimeout(timeout);
console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASSED'));
process.exit(failed ? 1 : 0);
