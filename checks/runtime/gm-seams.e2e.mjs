// The GM seams (W0.5) and the switchboard (W0.2) in a real browser against a real local Worker (wrangler dev, DEV_USER) on PORT (default 8952).
//   1. With every switch off and the filter off the GM page is today's: the tab strip and the phone segment bar are exactly the markup the page always had; the Menu holds no
//      Workshop line; the Switchboard line is the only addition.
//   2. A test tool tagged Planning (registered before the page opens) hides outside Planning when the filter is on, "All tools" and off bring it back, the tab on screen is kept,
//      its pane draws through mount(); a Workshop tool shows Menu -> Workshop and opens in the sheet.
//   SEAMS_ROOT=<another worktree> with --snapshot <dir> only records the markup and screenshots (1280 and 390 px) of the page as it is there: run it on origin/main and on
//   this branch and compare (the W0.5 "screenshots match today's" check).
//   PW_MODULE=<playwright install> PW_CHANNEL=msedge node checks/runtime/gm-seams.e2e.mjs      (GM_SHOTS=<dir> keeps screenshots)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOT = process.env.SEAMS_ROOT ? path.resolve(process.env.SEAMS_ROOT) : HERE;
const PORT = Number(process.env.PORT || 8952);
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

  /* ---- the snapshot of the page as it is in this tree (also what origin/main is compared with) ---- */
  const A = await open('#gm');
  const base1280 = await strip(A.page);
  await shot(A.page, snapAt || SHOTS, 'gm-1280');
  await A.c.close();
  const P0 = await open('#gm', { w: 390, h: 844 });
  await shot(P0.page, snapAt || SHOTS, 'gm-390');
  await P0.c.close();
  if (snapAt) { writeFileSync(path.join(snapAt, 'markup.json'), JSON.stringify(base1280, null, 1)); console.log('snapshot written to ' + snapAt); }
  else if (HAS_SEAMS) {
    /* ---- 1. today's page ---- */
    const TABS = ['prep', 'rules', 'location', 'scenes', 'score', 'chase', 'npc', 'downtime', 'cards', 'ipad'];
    const hasAll = (tabs) => TABS.every((id) => tabs.includes('data-panel="' + id + '"'));
    check(hasAll(base1280.tabs) && !/hidden/.test(base1280.tabs) && !/hidden/.test(base1280.seg), 'filter off, no switch on: every tab and every phone chip is there and none is hidden');
    check(!/Workshop/.test(base1280.menu), 'and no Workshop line while nothing is behind it');
    check(base1280.panes === 'prep,location,scenes,score,chase,npc,downtime,cards,rules,ipad,run', 'the panes are the page\'s own, in its order: ' + base1280.panes);

    /* ---- 2. a test tool, the phase filter, the Workshop ---- */
    const INIT = () => {
      function hook(name, fn) { let v; Object.defineProperty(window, name, { configurable: true, get() { return v; }, set(x) { v = x; try { fn(x); } catch (e) { console.error('hook ' + name + ': ' + e.message); } } }); }
      hook('B68GmTools', (T) => {
        T.register({ id: 'testtool', label: 'Test tool', phases: ['plan'], key: 'Q', mount(box) { box.textContent = 'TESTTOOL-BODY'; } });
        T.register({ id: 'shopper', label: 'Shopper', phases: 'all', workshop: true, mount(box) { box.textContent = 'SHOPPER-BODY'; } });
      });
    };
    const G = await open('#gm', { init: INIT });
    const g = G.page;
    let t = await shown(g, '.gm-tab');
    check(t.includes('testtool') && TABS.every((id) => t.includes(id)), 'the registered test tool has a tab beside today\'s: ' + t.join(','));
    check((await chips(g)).includes('testtool'), 'and a phone chip');
    await g.click('.gm-tab[data-panel="testtool"]');
    check(await g.$eval('#gm-x-testtool', (e) => !e.hidden && e.textContent === 'TESTTOOL-BODY'), 'its pane is drawn by mount()');
    await g.click('.gm-tab[data-panel="location"]');
    await g.evaluate(() => window.B68GmTools.setFilter({ on: true, phase: 'score' }));
    t = await shown(g, '.gm-tab');
    check(!t.includes('testtool') && !t.includes('score') && !t.includes('downtime') && !t.includes('cards') && t.includes('location') && t.includes('scenes') && t.includes('chase') && t.includes('npc') && t.includes('prep'), 'filter on, phase Score: the planning and downtime tools are gone, the Score tools stay: ' + t.join(','));
    check(!(await chips(g)).includes('testtool') && !(await chips(g)).includes('score') && (await chips(g)).includes('console') && (await chips(g)).includes('state'), 'and the phone chip goes too (Console and State are not tools: they stay)');
    await g.evaluate(() => window.B68GmTools.setFilter({ phase: 'plan' }));
    t = await shown(g, '.gm-tab');
    check(t.includes('testtool') && t.includes('score') && t.includes('cards') && !t.includes('chase') && !t.includes('scenes') && !t.includes('downtime'), 'phase Planning: the test tool, Score and Cards are shown: ' + t.join(','));
    await g.evaluate(() => window.B68GmTools.setFilter({ phase: 'pb' }));
    t = await shown(g, '.gm-tab');
    check(t.includes('location') && t.includes('downtime') && !t.includes('scenes') && !t.includes('testtool'), 'phase Personal Business: Downtime is shown, and the tab on screen (Location) is kept: ' + t.join(','));
    await g.evaluate(() => window.B68GmTools.setFilter({ all: true }));
    t = await shown(g, '.gm-tab');
    check(t.includes('testtool') && TABS.every((id) => t.includes(id)), 'All tools overrides the phase');
    await g.evaluate(() => window.B68GmTools.setFilter({ all: false, on: false }));
    t = await shown(g, '.gm-tab');
    check(t.includes('testtool') && TABS.every((id) => t.includes(id)), 'filter off: everything is back');
    const withTool = await strip(g);
    check(withTool.tabs.replace(/<button[^>]*data-panel="testtool"[\s\S]*?<\/button>/, '') === base1280.tabs, 'with the test tool\'s tab taken out the strip is byte for byte the same as without it');

    await g.click('[data-gm="menu"]');
    check(await g.$eval('#gm-menu-workshop', (e) => e.textContent === 'Workshop'), 'a tool behind the Workshop puts Workshop in the Menu');
    await g.click('#gm-menu-workshop');
    check(await g.$eval('#gm-sheet-workshop', (e) => !e.hidden && /Shopper/.test(e.textContent)), 'Menu -> Workshop opens the sheet and lists the tool');
    await g.click('#gm-sheet-workshop [data-ws="shopper"]');
    check(await g.$eval('#gm-ws-tool', (e) => e.textContent === 'SHOPPER-BODY'), 'a tool opens in the sheet');
    await g.click('#gm-sheet-workshop [data-sheet-close]');
    check(await g.$eval('#gm-sheet-workshop', (e) => e.hidden), 'and the sheet closes');
    check(!(await shown(g, '.gm-tab')).includes('shopper'), 'a Workshop tool has no tab');

    await G.c.close();
  } else console.log('SKIP the seams are not in ' + ROOT + ' (a snapshot of main?)');

  check(errors.length === 0, 'no console errors or page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e) + '\n' + serverLog.slice(-1500));
}
clearTimeout(timeout);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
