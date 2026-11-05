// The GM seams (W0.5) and the Settings that replaced the switchboard (W0.2; the night rebuild, N0) in a real browser against a real local Worker (wrangler dev, DEV_USER) on
// PORT (default 8952).
//   1. With no phase entered the filter is off: every tab and phone chip is there; the Menu has no Settings, Switchboard or Workshop line.
//   2. A test tool tagged Planning (registered before the page opens) has a tab; the phase rail (always drawn: everything built is on) hides it outside Planning, "All tools"
//      brings everything back, the tab on screen is kept, its pane draws through mount().
//   3. Everything on from the first request: a phone and the iPad page are told every display and phone feature is on with nothing stored. The iPad view's Settings (N5): Phones flips the
//      phoneCards setting into the GM state (features and the old key) and the campaign document, and a phone and the iPad learn of it on a poll, no reload; Scenes and the mirror
//      take the same paths; a GM-only test line never reaches the campaign document, a phone's traffic or its flags. Preflight's Menu line is there from the start.
//   SEAMS_ROOT=<another worktree> with --snapshot <dir> only records the markup and screenshots (1280 and 390 px) of the page as it is there: run it on origin/main and on
//   this branch and compare.
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
    /* ---- 1. the page with no phase entered ---- */
    const TABS = ['prep', 'rules', 'location', 'scenes', 'score', 'chase', 'npc', 'downtime', 'cards', 'ipad'];
    const hasAll = (tabs) => TABS.every((id) => tabs.includes('data-panel="' + id + '"'));
    check(hasAll(base1280.tabs) && !/hidden/.test(base1280.tabs) && !/hidden/.test(base1280.seg), 'no phase entered: every tab and every phone chip is there and none is hidden');
    check(!/id="gm-menu-settings"/.test(base1280.menu), 'the Menu has no Settings line: they live in the iPad view (the GM night rebuild, N5)');
    check(!/Switchboard|gm-menu-switchboard/.test(base1280.menu) && !/Workshop|gm-menu-workshop/.test(base1280.menu), 'and no Switchboard or Workshop line (both are gone)');
    check(!/id="gm-menu-preflight"/.test(base1280.menu), 'N2: no tool has a Menu line (Preflight is reached through B68GmTools)');
    check(base1280.panes === 'prep,location,scenes,score,chase,npc,downtime,cards,rules,ipad,run', 'the panes are the page\'s own, in its order: ' + base1280.panes);

    /* ---- 2. a test tool and the phase filter, driven by the phase rail ---- */
    const INIT = () => {
      function hook(name, fn) { let v; Object.defineProperty(window, name, { configurable: true, get() { return v; }, set(x) { v = x; try { fn(x); } catch (e) { console.error('hook ' + name + ': ' + e.message); } } }); }
      hook('B68GmTools', (T) => { T.register({ id: 'testtool', label: 'Test tool', phases: ['plan'], key: 'Q', mount(box) { box.textContent = 'TESTTOOL-BODY'; } }); });
      hook('B68Features', (F) => { F.register({ id: 'test.gm', label: 'Test GM-only line', surface: 'gm', stage: 'spine', default: false, saturday: 'off', doc: 'A GM-only test line.' }); });
    };
    const G = await open('#gm', { init: INIT });
    const g = G.page;
    let t = await shown(g, '.gm-tab');
    check(t.includes('testtool') && TABS.every((id) => t.includes(id)), 'the registered test tool has a tab beside today\'s: ' + t.join(','));
    check((await chips(g)).includes('testtool'), 'and a phone chip');
    await g.click('.gm-tab[data-panel="testtool"]');
    check(await g.$eval('#gm-x-testtool', (e) => !e.hidden && e.textContent === 'TESTTOOL-BODY'), 'its pane is drawn by mount()');
    await g.click('.gm-tab[data-panel="location"]');
    await g.waitForSelector('#gm-phaserail [data-rail="score"]', { timeout: 10000 });
    const tap = async (id) => { await g.$eval('#gm-phaserail [data-rail="' + id + '"]', (e) => e.click()); await sleep(300); };
    await tap('score');
    t = await shown(g, '.gm-tab');
    check(!t.includes('testtool') && !t.includes('score') && !t.includes('downtime') && !t.includes('cards') && t.includes('location') && t.includes('scenes') && t.includes('chase') && t.includes('npc') && t.includes('prep'), 'the rail\'s Score: the planning and downtime tools are gone, the Score tools stay: ' + t.join(','));
    check(!(await chips(g)).includes('testtool') && !(await chips(g)).includes('score') && (await chips(g)).includes('console') && (await chips(g)).includes('state'), 'and the phone chip goes too (Console and State are not tools: they stay)');
    await tap('plan');
    t = await shown(g, '.gm-tab');
    check(t.includes('testtool') && t.includes('score') && t.includes('cards') && !t.includes('chase') && !t.includes('scenes') && !t.includes('downtime'), 'Planning: the test tool, Score and Cards are shown: ' + t.join(','));
    await tap('pb');
    t = await shown(g, '.gm-tab');
    check(t.includes('location') && t.includes('downtime') && !t.includes('scenes') && !t.includes('testtool'), 'Personal Business: Downtime is shown, and the tab on screen (Location) is kept: ' + t.join(','));
    await tap('all');
    t = await shown(g, '.gm-tab');
    check(t.includes('testtool') && TABS.every((id) => t.includes(id)), 'All tools brings every tab back');
    const withTool = await strip(g);
    check(hasAll(withTool.tabs) && /data-panel="testtool"/.test(withTool.tabs) && !/ hidden/.test(withTool.tabs.replace(/aria-hidden="[^"]*"/g, '')), 'and none of them is hidden');
    await tap('all');

    /* ---- 3. everything on, and the Settings ---- */
    const phoneTraffic = [];
    const PH = await open('#t', { user: PLAYER, record: phoneTraffic });
    const DS = await open('#display');
    const flag = (p, id) => p.evaluate((i) => (window.B68Flags ? window.B68Flags.on(i) : null), id);
    check((await flag(PH.page, 'phoneCards')) === false && (await flag(DS.page, 'phoneCards')) === false, 'a phone and the iPad page start with phone cards off (a setting, nothing stored)');
    check(await until(async () => (await flag(PH.page, 'spine.aftermath')) === true && (await flag(PH.page, 'between.keys')) === true, 8000), 'everything built is on: the phone is told spine.aftermath and between.keys are on with nothing stored');
    check(await until(async () => (await flag(DS.page, 'room.preflight')) === true && (await flag(DS.page, 'map.flashback')) === true, 8000), 'and the iPad is told room.preflight and map.flashback are on');
    await PH.page.evaluate(() => { window.__phoneMarker = 'same page'; }); await DS.page.evaluate(() => { window.__dsMarker = 'same page'; }); await g.evaluate(() => { window.__gmMarker = 'same page'; });
    await g.keyboard.press('i');
    await g.waitForSelector('#gm-ipad-settings [data-set-row]', { timeout: 10000 });
    const sheet = '#gm-ipad-settings';
    check(await g.$eval(sheet, (e) => ['Scenes', 'Music', 'Phones', 'Mirror for phones'].every((l) => e.textContent.includes(l))), 'the iPad view (I) holds the Settings: Scenes, Music, Phones and Mirror for phones');
    const pressed = (key) => g.$eval(sheet + ' [data-set-row="' + key + '"] [aria-pressed="true"]', (e) => e.textContent.trim());
    check(await pressed('fx.off') === 'Moving' && await pressed('room.music') === 'Scene themes' && await pressed('phoneCards') === 'Sheet only' && await pressed('mirror') === 'On', 'each row shows its current value: Moving, Scene themes, Sheet only, On');
    await shot(g, SHOTS, 'settings-1280');

    await g.click(sheet + ' [data-set="phoneCards"][data-v="1"]');
    await until(async () => { const d = (await api('GET', '/gm/state')).json.doc; return d.features && d.features.phoneCards === true; }, 8000);
    const st2 = (await api('GET', '/gm/state')).json.doc;
    check(st2.features && st2.features.phoneCards === true && st2.phoneCards === true, 'Phones: Mission cards: the GM state holds the setting (and the old phoneCards key): ' + JSON.stringify(st2.features) + ' ' + st2.phoneCards);
    const camp = await until(async () => { const c = (await api('GET', '/campaign', null, PLAYER)).json.doc; return c.features && c.features.phoneCards === true ? c : null; }, 8000);
    check(!!camp && !('test.gm' in camp.features), 'the campaign document serves the setting to a player, and no GM-only id: ' + JSON.stringify(camp && camp.features).slice(0, 120));
    check(await until(async () => (await flag(PH.page, 'phoneCards')) === true, 8000), 'the phone learns of it within a poll');
    check(await until(async () => (await flag(DS.page, 'phoneCards')) === true, 8000), 'and so does the iPad page');
    check(await pressed('phoneCards') === 'Mission cards', 'the Settings show Mission cards');

    await g.click(sheet + ' [data-set="fx.off"][data-v="1"]');
    check(await until(async () => (await flag(DS.page, 'fx.off')) === true, 8000), 'Scenes: Held still reaches the iPad within a poll');
    check(await pressed('fx.off') === 'Held still', 'and the Settings show it');
    await g.click(sheet + ' [data-set="fx.off"][data-v="0"]');
    check(await until(async () => (await flag(DS.page, 'fx.off')) === false, 8000), 'Scenes: Moving again');

    await g.click(sheet + ' [data-set="mirror"][data-v="0"]');
    check(await until(async () => (await api('GET', '/gm/state')).json.doc.mirror === false, 8000), 'Mirror for phones: Off writes the GM state\'s mirror');
    check(await pressed('mirror') === 'Off', 'and the Settings show it');
    await g.click(sheet + ' [data-set="mirror"][data-v="1"]');
    check(await until(async () => (await api('GET', '/gm/state')).json.doc.mirror === true, 8000), 'Mirror for phones: On again');

    await g.click(sheet + ' [data-set="phoneCards"][data-v="0"]');
    check(await until(async () => (await flag(PH.page, 'phoneCards')) === false, 8000) && await until(async () => (await flag(DS.page, 'phoneCards')) === false, 8000), 'Phones: Sheet only reaches the phone and the iPad within a poll');
    check((await PH.page.evaluate(() => window.__phoneMarker)) === 'same page' && (await DS.page.evaluate(() => window.__dsMarker)) === 'same page' && (await g.evaluate(() => window.__gmMarker)) === 'same page', 'no page reloaded');
    check(await flag(PH.page, 'spine.aftermath') === true, 'and the features stayed on throughout');

    const flags = await PH.page.evaluate(() => JSON.stringify(window.B68Flags.all()));
    check(!phoneTraffic.some((x) => x.includes('test.gm')) && !flags.includes('test.gm'), 'the GM-only id never reached the phone: not in one API answer it received, not in its flags');
    check(!JSON.stringify((await api('GET', '/campaign', null, PLAYER)).json).includes('test.gm'), 'nor in the campaign document it can read');
    check(!(await g.$('#gm-sheet-settings')), 'and no Settings sheet was made: they are part of the view');

    /* 4.2: Preflight's line is in the Menu with nothing stored; it opens the sheet (read-only, items green or red with a fix) */
    await g.evaluate(() => { window.B68GmTools.get('preflight').open(); });
    check(await until(async () => g.$eval('#gm-sheet-preflight', (e) => !e.hidden && /iPad sound/.test(e.textContent) && /Deepgram/.test(e.textContent) && /Pack version/.test(e.textContent) && /Access session/.test(e.textContent)).catch(() => false), 10000), 'Preflight: the sheet lists the items');
    check(await g.$eval('#gm-sheet-preflight', (e) => /Fix:/.test(e.textContent)), 'Preflight: a red item carries a Fix line');
    await G.c.close(); await PH.c.close(); await DS.c.close();
  } else console.log('SKIP the seams are not in ' + ROOT + ' (a snapshot of main?)');

  check(errors.length === 0, 'no console errors or page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e) + '\n' + serverLog.slice(-1500));
}
clearTimeout(timeout);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
