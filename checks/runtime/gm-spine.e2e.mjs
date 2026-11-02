// The spine in a real browser (B08): all switches off is the page as it was; rail, curfew and Workshop switches on; All off puts it back.
//   PW_MODULE=<playwright> PW_CHANNEL=msedge GM_SHOTS=<dir> PORT=8956 node checks/runtime/gm-spine.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = process.env.SEAMS_ROOT ? path.resolve(process.env.SEAMS_ROOT) : HERE;
const PORT = Number(process.env.PORT || 8956);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', PLAYER = 'player@example.test';
const SHOTS = process.env.GM_SHOTS || '';
const snapAt = process.argv.indexOf('--snapshot') >= 0 ? process.argv[process.argv.indexOf('--snapshot') + 1] : '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const HAS_SEAMS = existsSync(path.join(ROOT, 'app', 'gm', 'tools.js'));

const FIX = path.join(HERE, 'checks', 'runtime', 'fixtures', 'gm');
const conFix = JSON.parse(readFileSync(path.join(FIX, 'console-pack.json'), 'utf8'));
const locFix = JSON.parse(readFileSync(path.join(FIX, 'location-pack.json'), 'utf8'));
const NOW = new Date().toISOString();
const PARTS = {
  console: conFix.parts.console,
  campaign: { ...conFix.parts.campaign, src: { ...conFix.parts.campaign.src, exportedAt: NOW } },
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: NOW }, T: locFix.T, extra: locFix.extra }
};

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-seams-e2e-'));
const WRANGLER = path.join(HERE, 'node_modules', '.bin', 'wrangler');
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

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 420000);
const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src || {}, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  check((await api('PUT', '/campaign', { v: 1, session: { number: 1, startedAt: NOW, endedAt: null }, crew: { name: 'The Lamplighters', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] }, clocks: [], log: [] })).status === 200, 'the table is set up');
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(route, { w = 1280, h = 800, user = GM, init = null, record = null } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, viewport: { width: w, height: h }, serviceWorkers: 'block' });
    await c.addInitScript(() => { window.__B68_POLL_MS = 700; });
    if (init) await c.addInitScript(init);
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(route + ': ' + m.text()); });
    page.on('pageerror', (e) => errors.push(route + ' pageerror: ' + e.message));
    if (record) page.on('response', async (r) => { if (/\/api\//.test(r.url())) { try { record.push(await r.text()); } catch (_) {} } });
    await page.goto(BASE + '/' + route);
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    if (route === '#gm') { await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 }); await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); }
    return { c, page };
  }
  const shot = async (page, dir, name) => { if (dir) { mkdirSync(dir, { recursive: true }); await page.screenshot({ path: path.join(dir, name + '.png'), animations: 'disabled' }); } };
  const strip = (page) => page.evaluate(() => ({
    tabs: document.querySelector('.gm-tabrow').outerHTML, seg: document.querySelector('.gm-segbar').outerHTML,
    menu: document.querySelector('.gm-menu-list').innerHTML, panes: [].map.call(document.querySelectorAll('.gm-pane'), (e) => e.getAttribute('data-pane')).join(',')
  }));
  const chips = (page) => page.$$eval('.gm-segbar .chip', (els) => els.filter((e) => !e.hidden).map((e) => e.getAttribute('data-seg')));   /* the phone bar is display:none at 1280 px, so [hidden] is what the filter sets */
  const shown = (page, sel) => page.$$eval(sel, (els) => els.filter((e) => !e.hidden && e.offsetParent !== null).map((e) => e.getAttribute('data-panel') || e.getAttribute('data-seg')));

  const A = await open('#gm');
  const count = (page) => page.evaluate(() => ({ tabs: [].filter.call(document.querySelectorAll('.gm-tab'), (e) => !e.hidden && e.offsetParent !== null).length, chips: [].filter.call(document.querySelectorAll('.gm-segbar .chip'), (e) => !e.hidden).length, hasRail: !!document.querySelector('#gm-phaserail'), ws: !!document.querySelector('#gm-menu-workshop'), awayClass: document.body.classList.contains('ws-away'),
    loose: ['[data-gm="mirror"]', '#as-screen', '#gm-run-lens'].map((s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent !== null).length) }));
  const before = await count(A.page);
  check(!before.hasRail && !before.ws && !before.awayClass, 'all switches off: no rail, no Workshop line, no away class: ' + JSON.stringify(before));
  await A.page.click('[data-gm="menu"]'); await A.page.click('#gm-menu-switchboard');
  for (const id of ['spine.rail', 'spine.curfew', 'spine.workshop']) await A.page.click('[data-sb="' + id + '"]');
  await A.page.click('.gm-sheet:not([hidden]) [data-sheet-close]');
  await A.page.waitForSelector('#gm-phaserail .gm-pr-chip', { timeout: 8000 });
  check(await A.page.$$eval('#gm-phaserail .gm-pr-chip', (e) => e.length) === 4, 'the rail has four phase chips');
  await A.page.click('[data-rail="plan"]');
  await until(async () => (await A.page.$eval('[data-rail="plan"]', (e) => e.getAttribute('data-state'))) === 'now', 4000);
  const tabs = await shown(A.page, '.gm-tab');
  check(tabs.includes('score') && tabs.includes('cards') && !tabs.includes('chase') && !tabs.includes('scenes'), 'Planning: the tabs follow within the tap: ' + tabs.join(','));
  const bandSet = await until(async () => { const d = (await api('GET', '/gm/ambient')).json; return JSON.stringify(d || {}).includes('"plan"'); }, 6000);
  check(bandSet, 'the ambient document carries band.phase plan');
  await A.page.click('[data-rail="all"]'); check((await shown(A.page, '.gm-tab')).includes('chase'), 'All tools shows every tab again');
  await A.page.click('[data-rail="pb"]'); check(await A.page.$eval('[data-rail="pb"]', (e) => e.getAttribute('data-state')) === 'now', 'Back is allowed');
  await A.page.click('[data-gm="menu"]');
  check(await A.page.$eval('#gm-menu-workshop', (e) => !!e), 'Menu has Workshop');
  await A.page.click('#gm-menu-workshop');
  await A.page.waitForSelector('#gm-sheet-workshop:not([hidden]) .chip');
  const items = await A.page.$$eval('#gm-sheet-workshop .gm-ws-list .chip', (e) => e.map((x) => x.textContent));
  check(items.length === 5, 'Workshop lists five: ' + items.join(' | '));
  await shot(A.page, SHOTS, 'workshop-1280');
  await A.page.click('.gm-sheet:not([hidden]) [data-sheet-close]');
  const after = await count(A.page);
  check(after.hasRail && after.ws && after.awayClass && after.loose.every((n) => n === 0), 'on: the loose controls are put away: ' + JSON.stringify(after));
  console.log('TOOLCOUNT main page tabs before=' + before.tabs + ' after=' + after.tabs + ' | phone chips before=' + before.chips + ' after=' + after.chips + ' | loose controls visible before=' + JSON.stringify(before.loose) + ' after=' + JSON.stringify(after.loose));
  await shot(A.page, SHOTS, 'rail-1280');
  await until(async () => { const d = (await api('GET', '/gm/state')).json.doc; return d.features && d.features['spine.rail'] === true; }, 8000);
  const Pn = await open('#gm', { w: 390, h: 844 }); await Pn.page.waitForSelector('#gm-phaserail .gm-pr-chip', { timeout: 10000 }); await shot(Pn.page, SHOTS, 'rail-390');
  check(await Pn.page.$eval('#gm-phaserail', (e) => e.getBoundingClientRect().width <= 390), 'the rail fits a 390 px phone');
  /* off again */
  await A.page.click('[data-gm="menu"]'); await A.page.click('#gm-menu-switchboard'); await A.page.click('[data-sb-alloff]');
  await until(async () => !(await count(A.page)).hasRail, 6000);
  const off = await count(A.page);
  check(!off.hasRail && !off.ws && !off.awayClass && JSON.stringify(off) === JSON.stringify(before), 'All off puts the page back exactly: ' + JSON.stringify(off));
  check(errors.length === 0, 'no console errors: ' + errors.slice(0, 3).join(' / '));
  await browser.close();

} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e) + '\n' + serverLog.slice(-1500));
}
clearTimeout(timeout);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
