// kit-shell (KS09 of the kit and stage build): the shell of the new desk (kit.desk on), on the real GM page, Worker and pack, in a real browser.
// The assist endpoints are answered by the browser's own route (no key, no model, no spend); /act goes to the real Worker for a parsed cue.
//   0. the setting off: today's view row, Menu, Find and toast (#toastMsg); the kit-desk bundle is not fetched
//   1. the tabs (KS09.1): the view row is the kit's Tabs with every old hook (button.gm-vt, data-pv, role=tab, .gm-vt-l); Chase, Street, Score
//      generator and Opportunities are not in the row (nor the chip row); Planning opens on Intel; all eleven panes open by their keys
//      (R T B S J C N D O I G), a put-away one showing in the row only while it is open; Find opens a put-away view
//   2. Menu, Find, drawer and capture bar (KS09.2): every old id and data-gm hook in the Menu; Ctrl+K and / open Find (dressed, focused), Enter
//      goes; W opens the drawer (dressed tabs); the capture keys p, x and m arm the bar and file a line
//   3. Esc in today's order: the Menu, then the drawer; Find over the drawer, then the drawer; a toast takes no Esc
//   4. the toasts (KS09.3): the page's toast() speaks through the stack, #toastMsg stays empty; an error stays until X; signed out is said once;
//      the cue's Undo (a typed "Blade, risky, standard") undoes from the stack; the cue's Reveal question: Cancel reveals no one, Reveal does
//   5. the dialogs (KS09.4): the three converted native confirms (Clear tonight's capture, Remove a card, Clear a beat's start time), each with
//      Cancel (one by Esc, which is not PANIC) and Yes; no native dialog opens
//  5b. the plain dialog (no showModal): Ctrl+K does not open Find behind it; one Esc closes it (not PANIC); then Ctrl+K opens Find
//   6. the layers (KS09.5): the ladder in the six tokens (drawer < band < popover < Find < toast < Blank); Blank covers the band, a toast and the
//      capture bar; PANIC's row stays on top of an open drawer
//   7. the setting off mid-session: the old row, Menu and toast without a reload; no class the shell added is left on the page
// Every name is invented; a hidden person carries a GM-ONLY- marker. SHOTS=<dir> writes the pictures (<view>-<theme>-<width>.png).
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9407] [SHOTS=<dir>] node checks/runtime/kit-shell.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildPrep } from '../../scripts/lib/prep-export.mjs';
import { basenames } from '../../scripts/lib/vault.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9407);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const SHOTS = process.env.SHOTS || '';
if (!process.env.PW_MODULE) { console.log('SKIP kit-shell: PW_MODULE is not set (it needs Playwright)'); process.exit(0); }
const { chromium } = require(process.env.PW_MODULE);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), np = fx('npc-pack.json');
const MIN = 60000, pad = (n) => (n < 10 ? '0' : '') + n, hm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-kitshell-e2e-'));
const vault = path.join(stateDir, 'vault'), G = 'Wiki/Games/Blades in the Dark/Campaigns/Group';
const w = (rel, text) => { const f = path.join(vault, ...rel.split('/')); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); };
w(G + '/Sessions/b68g-s09.md', ['---', 'session: 9', 'date: 01/02/2030', 'status: prep', 'gm_prep: true', '---', '', '# Session 9: prep', '',
  'start: 19:30', 'curfew: 22:40', '', '## Run order', '', '| # | Beat | About |', '|---|---|---|', '| 1 | Personal business | 30 min |', '| 2 | Planning | 25 min |', '| 3 | The score | 90 min |', '',
  '## Cues', '', 'safe: testcard', '', '1. light: The lamps fail on the mezzanine', '2. sound: The band strikes up by the cloakroom', '',
  '## Score', '', 'The Pelican Rooms, after the lamps go.', ''].join('\n'));
const prep = buildPrep({ vault, repo: ROOT, exportedAt: new Date().toISOString(), basenames: basenames(vault) });
const PARTS = {
  console: { ...con.parts.console, src: { ...(con.parts.console.src || {}), exportedAt: new Date().toISOString() } }, campaign: { ...np.parts.campaign, src: { ...(np.parts.campaign.src || {}), exportedAt: new Date().toISOString() } }, npc: np.parts.npc,
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: new Date().toISOString() }, T: loc.T, extra: loc.extra },
  prep
};
const SPEND = { tonight: 0.4, cap: 20, tier: 'all' };

const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
delete env.ANTHROPIC_API_KEY; delete env.B68_ANTHROPIC_KEY;
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
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
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 900000);
const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j }; });
const feats = (f) => api('PATCH', '/gm/state', { features: f });
const ELEVEN = [['r', 'prep'], ['t', 'rules'], ['b', 'location'], ['s', 'scenes'], ['j', 'score'], ['c', 'chase'], ['n', 'npc'], ['d', 'downtime'], ['o', 'cards'], ['i', 'ipad'], ['g', 'run']];
const AWAY = ['chase', 'scenes', 'score', 'cards'];
const MENU_IDS = ['gm-menu-exp', 'gm-menu-warn', 'gm-menu-shortcuts', 'gm-menu-capbar', 'gm-menu-live'];
const MENU_GM = ['find-open', 'drawer', 'shortcuts', 'update', 'note', 'clearcap', 'capbar', 'livesync', 'forget'];
const MENU_HREF = ['#display', '#t', '#rules', '#cast', '#'];

try {
  const up = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/index.html')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!up) throw new Error('the server did not start:\n' + serverLog);
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src || {}, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  await api('PUT', '/campaign', { v: 1, session: { number: 9, startedAt: new Date().toISOString(), endedAt: null }, crew: { name: 'The Dovetail Crew', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] }, clocks: [], log: [] });
  await api('PUT', '/npcs/npc_known', { name: 'Mabel Quist', role: 'invented', revealed: true, firstSeen: new Date().toISOString() });
  await api('PUT', '/npcs/npc_hidden', { name: 'GM-ONLY-Lotte Brand', role: 'invented', revealed: false });
  const now = Date.now();
  await api('PATCH', '/gm/state', { night: { v: 1, phase: 'score', startAt: hm(now - 120 * MIN), curfewAt: hm(now + 58 * MIN), phases: { pb: { budget: 30, start: now - 111 * MIN, end: now - 79 * MIN }, plan: { budget: 25, start: now - 79 * MIN, end: now - 41 * MIN }, score: { budget: 90, start: now - 41 * MIN, end: null } } } });
  const noteId = (prep.notes || []).map((n) => n.id).find((id) => /s09/.test(id));

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [], dialogs = [];
  async function open({ w = 1366, h = 768, theme = '', wantKit = true, init = null } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w, height: h }, serviceWorkers: 'block' });
    await c.addInitScript((id) => { window.__B68_POLL_MS = 700; try { localStorage.setItem('b68.gm.prepNote', id); } catch (e) {} }, noteId);
    if (init) await c.addInitScript(init);
    if (theme) await c.addInitScript({ content: 'try { localStorage.setItem("b68.theme", ' + JSON.stringify(theme === 'night' ? 'dark' : 'light') + '); } catch (e) {}' });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('dialog', (d) => { dialogs.push(d.type() + ': ' + d.message()); d.dismiss(); });
    const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    await page.route('**/api/gm/assist/tick', (route) => json(route, { cards: [], updates: [], flags: [], spend: SPEND, last: 10 }));
    await page.route('**/api/gm/assist/cards', (route) => (route.request().method() === 'POST' ? json(route, { marked: 1 }) : json(route, { cards: [], updates: [], asks: [], spend: SPEND })));
    await page.route('**/api/gm/assist/ask', (route) => json(route, { error: 'no model in this check' }, 500));
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-band [data-band-place]', { timeout: 30000 });
    await page.waitForSelector('.gm-views [data-pv]', { timeout: 30000 });
    if (wantKit) await page.waitForFunction(() => window.B68KitShell && window.B68KitShell.on() && document.querySelector('.gm-views.ui-tabs') && document.querySelector('#gm-find.kshell-find'), null, { timeout: 30000 });
    await blur(page); await page.waitForTimeout(500);
    return { c, page };
  }
  const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.mouse.move(1, 1); await page.screenshot({ path: path.join(SHOTS, name + '.png'), animations: 'disabled' }); } };
  const blur = (page) => page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); });
  const goPlace = async (page, id) => { await page.click('#gm-band [data-band-place="' + id + '"]'); await page.waitForFunction((p) => document.querySelector('#gm-root').getAttribute('data-place') === p, id, { timeout: 5000 }); await blur(page); await page.waitForTimeout(300); };
  const row = (page) => page.evaluate(() => [...document.querySelectorAll('.gm-views [data-pv]')].map((b) => ({ id: b.getAttribute('data-pv'), sel: b.getAttribute('aria-selected') === 'true', away: b.classList.contains('kshell-vt-away'), extra: b.classList.contains('gm-vt-extra') })));
  const chips = (page) => page.evaluate(() => [...document.querySelectorAll('.gm-vchips [data-pv]')].map((b) => b.getAttribute('data-pv')));
  const paneOn = (page, id) => page.evaluate((p) => { const e = document.querySelector('.gm-pane[data-pane="' + p + '"]'); return !!e && !e.hidden && e.getBoundingClientRect().height > 0; }, id);
  const stackText = (page) => page.$$eval('.ui-toast-stack .ui-toast', (l) => l.map((x) => x.querySelector('.ui-toast-text').textContent));
  const oldToast = (page) => page.evaluate(() => ((document.getElementById('toastMsg') || {}).textContent || '') + ((document.getElementById('toastErr') || {}).textContent || ''));
  const escList = (page) => page.evaluate(() => window.B68GmEsc.list().filter((e) => e.open).map((e) => e.id));

  /* ---- 0. off: today's shell ---- */
  check((await feats({ 'kit.desk': false })).status === 200, 'kit.desk is off');
  {
    const { c, page } = await open({ wantKit: false });
    await goPlace(page, 'score');
    const off = await page.evaluate(() => ({ fetched: performance.getEntriesByType('resource').some((e) => /gm\/kit\/shell\.js|desk-shell\.css/.test(e.name)), shell: !!window.B68KitShell,
      kit: !!document.querySelector('.ui-tabs, [data-kshell-cls], .kshell-mbox, .kshell-find'), oldMenu: !!document.querySelector('.gm-menu-list > button[data-gm="update"]') }));
    check(!off.fetched && !off.shell && !off.kit && off.oldMenu, 'off: the kit-desk bundle is not fetched, nothing of the shell on the page, the old Menu ' + JSON.stringify(off));
    const r = (await row(page)).map((t) => t.id);
    check(r.includes('chase') && r.includes('scenes'), 'off: Score\'s row still has Chase and Street: ' + r.join(','));
    await page.click('[data-gm="menu"]'); await page.click('[data-gm="capbar"]');
    check(!!(await until(async () => /capture bar/i.test(await oldToast(page)), 3000)), 'off: the page\'s toast is the old #toast line');
    await page.click('[data-gm="menu"]'); await page.click('[data-gm="capbar"]');      /* the bar hidden again (a device setting) */
    await c.close();
  }
  check((await feats({ 'kit.desk': true, 'ai.grammar': true, 'spine.stamp': true })).status === 200, 'kit.desk is on (and the cue grammar and the stamp, for the cue toasts)');

  /* ---- pictures: Paper and Night, 1366 and 1536 (before PANIC is pressed below) ---- */
  if (SHOTS) {
    for (const [wd, ht] of [[1366, 768], [1536, 864]]) for (const theme of ['paper', 'night']) {
      const { c, page } = await open({ w: wd, h: ht, theme });
      await goPlace(page, 'score'); await shot(page, 'desk-' + theme + '-' + wd);
      await goPlace(page, 'plan'); await page.click('[data-gm="menu"]'); await page.waitForTimeout(300); await shot(page, 'menu-' + theme + '-' + wd); await page.keyboard.press('Escape');
      await blur(page); await page.keyboard.press('w'); await page.waitForTimeout(400);
      await page.evaluate(() => { window.B68KitShell.toast('Sent to the iPad: the card rooms'); window.B68KitShell.toast('Preflight: 2 to fix before the start (Before, Preflight).', true); });
      await shot(page, 'drawer-' + theme + '-' + wd);
      await page.keyboard.press('Escape'); await blur(page); await page.keyboard.press('Control+k'); await page.keyboard.type('ma'); await page.waitForTimeout(400); await shot(page, 'find-' + theme + '-' + wd);
      await page.keyboard.press('Escape'); await page.keyboard.press('a'); await page.waitForTimeout(600); await shot(page, 'blade-toasts-' + theme + '-' + wd);
      await c.close();
    }
  }

  /* ---- 1. the tabs ---- */
  {
    const { c, page } = await open();
    await goPlace(page, 'plan');
    let r = await row(page);
    check(!r.some((t) => AWAY.includes(t.id)) && (r.find((t) => t.sel) || {}).id === 'corkboard', 'Planning: no Opportunities nor Score generator in the row; its first visit opens on Intel: ' + JSON.stringify(r));
    const hooks = await page.evaluate(() => { const v = document.querySelector('.gm-views'); const tabs = [...v.querySelectorAll('[data-pv]')];
      return { list: v.classList.contains('ui-tabs') && v.getAttribute('role') === 'tablist', every: tabs.every((b) => b.matches('button.gm-vt.ui-tab[role="tab"][aria-selected]') && !!b.querySelector('.gm-vt-l')),
        one: tabs.filter((b) => b.getAttribute('aria-selected') === 'true').length, pins: ['prep', 'rules', 'npc', 'ipad'].every((p) => !!v.querySelector('.gm-vt-pin[data-pv="' + p + '"]')),
        keys: tabs.filter((b) => b.getAttribute('aria-keyshortcuts')).map((b) => b.getAttribute('aria-keyshortcuts') + '=' + b.querySelector('.ui-key').getAttribute('data-ui-key')).every((s) => s.split('=')[0] === s.split('=')[1]) }; });
    check(hooks.list && hooks.every && hooks.one === 1 && hooks.pins && hooks.keys, 'the row is the kit\'s Tabs with the old hooks (button.gm-vt, data-pv, role=tab, .gm-vt-l, the four pinned, the key hints) ' + JSON.stringify(hooks));
    await goPlace(page, 'score');
    r = await row(page);
    check(!r.some((t) => AWAY.includes(t.id)) && r.some((t) => t.id === 'run') && r.some((t) => t.id === 'location'), 'Score: no Chase nor Street in the row; The site and the Location roller stay: ' + r.map((t) => t.id).join(','));
    for (const [k, id] of ELEVEN) {
      await blur(page); await page.keyboard.press(k);
      const ok = await until(() => paneOn(page, id), 4000);
      const t = (await row(page)).find((x) => x.id === id);
      check(!!ok && !!t && t.sel && (!AWAY.includes(id) || t.away || t.extra), 'key ' + k.toUpperCase() + ' opens ' + id + ' with the kit on' + (AWAY.includes(id) ? (t && t.extra ? ', in the row as a view brought here (its ×), as any other place’s view' : ', shown in the row (put away) only while open') : ''));
    }
    await blur(page); await page.keyboard.press('g'); await until(() => paneOn(page, 'run'), 4000);
    r = await row(page);
    check(!r.some((t) => AWAY.includes(t.id) && !t.extra) && r.filter((t) => t.extra).length <= 1, 'back on The site, Score’s own put-away views leave the row again (the one brought here keeps its × until dropped): ' + r.map((t) => t.id + (t.extra ? '+' : '')).join(','));
    if (await page.$('.gm-views [data-pvx]')) { await page.click('.gm-views [data-pvx]'); await page.waitForTimeout(300); }
    r = await row(page);
    check(!r.some((t) => AWAY.includes(t.id)), 'its × drops it: ' + r.map((t) => t.id).join(','));
    /* the chip row (below 1100 px) follows the same list */
    await page.setViewportSize({ width: 900, height: 900 }); await page.waitForTimeout(500);
    const ch = await chips(page);
    check(ch.length > 0 && !ch.some((x) => AWAY.includes(x)), 'below 1100 px the chip row has no put-away view either: ' + ch.join(','));
    await page.setViewportSize({ width: 1366, height: 768 }); await page.waitForTimeout(400);
    /* 2a. Find: Ctrl+K and /, dressed, focused; a put-away view by Find */
    await blur(page); await page.keyboard.press('Control+k');
    const f1 = await until(() => page.evaluate(() => { const f = document.querySelector('#gm-find'); return !f.hidden && f.classList.contains('kshell-find') && document.activeElement && document.activeElement.id === 'gm-find-q' && document.activeElement.classList.contains('ui-field-input'); }), 3000);
    check(!!f1, 'Ctrl+K opens Find, dressed in the kit, with the focus in its field');
    await page.keyboard.type('chase');
    await until(() => page.$('.gm-find-hit'), 3000);
    const hit0 = await page.$eval('.gm-find-hit[aria-selected="true"]', (b) => b.textContent);
    await page.keyboard.press('Enter');
    check(!!(await until(() => paneOn(page, 'chase'), 4000)) && await page.evaluate(() => document.querySelector('#gm-find').hidden), 'Find\'s Enter on "' + hit0.slice(0, 40) + '" opens the Chase (put away) and closes Find');
    await blur(page); await page.keyboard.press('/');
    check(!!(await until(() => page.evaluate(() => !document.querySelector('#gm-find').hidden), 3000)), '/ opens Find');
    await page.keyboard.press('Escape');
    check(!!(await until(() => page.evaluate(() => document.querySelector('#gm-find').hidden), 3000)), 'Esc closes Find');

    /* 2b. the Menu: every old id and hook */
    await page.click('[data-gm="menu"]');
    const m = await page.evaluate(([ids, gms, hrefs]) => { const l = document.querySelector('.gm-menu-list'); return { open: !l.hidden && l.getBoundingClientRect().height > 50, box: !!l.querySelector('.kshell-mbox .ui-menu'),
      ids: ids.filter((i) => !l.querySelector('#' + i)), gm: gms.filter((g) => !l.querySelector('[data-gm="' + g + '"]')), href: hrefs.filter((h) => !l.querySelector('a[href="' + h + '"]')),
      capbar: (document.getElementById('gm-menu-capbar').textContent || '').trim(), red: [...l.querySelectorAll('.ui-menu-item--danger')].map((b) => b.getAttribute('data-gm')), danger: document.querySelectorAll('.ui-btn--danger').length }; }, [MENU_IDS, MENU_GM, MENU_HREF]);
    check(m.open && m.box && !m.ids.length && !m.gm.length && !m.href.length && !!m.capbar, 'the Menu is the kit\'s rows with every old id, data-gm and link ' + JSON.stringify(m));
    check(m.red.join() === 'forget' && m.danger === 1, 'one red line in the Menu (Forget), and PANIC is still the one Danger on the page');
    await page.keyboard.press('Escape');
    check(!!(await until(() => page.evaluate(() => document.querySelector('.gm-menu-list').hidden), 2000)), 'Esc closes the Menu');

    /* 2c. the capture bar: the Menu shows it (a toast in the stack), then p, x and m */
    await page.click('[data-gm="menu"]'); await page.click('[data-gm="capbar"]');
    const t1 = await until(async () => (await stackText(page)).find((t) => /capture bar/i.test(t)), 3000);
    check(!!t1 && !/capture bar/i.test(await oldToast(page)), 'the page\'s toast speaks through the stack ("' + t1 + '"); the old #toast line stays empty');
    check(await page.evaluate(() => document.querySelector('#gm-foot').classList.contains('kshell-foot') && getComputedStyle(document.querySelector('#gm-foot')).display !== 'none'), 'the capture bar shows, dressed in the kit');
    for (const [k, b] of [['p', 'n'], ['x', 'x'], ['m', 'm']]) {
      await blur(page); await page.keyboard.press(k);
      const armed = await until(() => page.evaluate((bk) => document.querySelector('[data-gm="arm"][data-b="' + bk + '"]').getAttribute('aria-pressed') === 'true' && document.activeElement && document.activeElement.id === 'gm-cap-in', b), 2000);
      check(!!armed, 'key ' + k + ' arms the capture bar (' + b + ') and puts the focus in it');
      if (k === 'm') { await page.keyboard.type('Ada Vell laughs at the wrong moment'); await page.keyboard.press('Enter'); }
      else await page.keyboard.press('Escape');
    }
    const filed = await until(async () => (await stackText(page)).find((t) => /^Filed under/.test(t)), 3000);
    check(!!filed, 'a moment filed from the bar: its toast is in the stack ("' + filed + '")');

    /* 2d. the drawer (W), and Esc in today's order */
    await blur(page); await page.keyboard.press('w');
    const dw = await until(() => page.evaluate(() => document.querySelector('#gm-root').classList.contains('dw-open') && document.querySelector('#gm-drawer').classList.contains('kshell-drawer') && document.querySelectorAll('#gm-drawer .gm-dtab.ui-tab').length === 3), 3000);
    check(!!dw, 'W opens the drawer, dressed (its three tabs are the kit\'s)');
    await page.click('[data-gm="menu"]');
    check((await escList(page)).join() === 'menu,drawer' || ((await escList(page)).includes('menu') && (await escList(page)).includes('drawer')), 'the Menu and the drawer are both open: ' + (await escList(page)).join());
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    let open1 = await escList(page);
    check(!open1.includes('menu') && open1.includes('drawer'), 'the first Esc closes the Menu, the drawer stays: ' + open1.join());
    await blur(page); await page.keyboard.press('Control+k'); await page.waitForTimeout(200);
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    open1 = await escList(page);
    check(await page.evaluate(() => document.querySelector('#gm-find').hidden) && open1.includes('drawer'), 'Find over the drawer: Esc closes Find first: ' + open1.join());
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    check(!(await escList(page)).includes('drawer'), 'and the next Esc the drawer');

    /* ---- 4. toasts: an error stays; signed out is said once; a toast takes no Esc ---- */
    await page.evaluate(() => window.B68KitShell.toast('The pack check failed on two lines (invented).', true));
    await sleep(6800);
    const errUp = await page.$$eval('.ui-toast--error .ui-toast-text', (l) => l.map((x) => x.textContent));
    check(errUp.some((t) => /pack check failed/.test(t)), 'an error toast stays past the old six seconds');
    const signed = await page.evaluate(() => { const n = document.querySelectorAll('.ui-toast').length; const took = window.B68KitShell.toast(document.getElementById('gm-signed').textContent, true); return { took, same: document.querySelectorAll('.ui-toast').length === n }; });
    check(signed.took && signed.same, 'the page\'s "signed out" line is not shown twice (the band\'s toast with Reload holds it)');
    check((await escList(page)).length === 0 && !(await page.evaluate(() => window.B68GmEsc.anyOpen())), 'a toast takes no Esc (PANIC wins): nothing is open to Esc');
    await page.evaluate(() => { const t = [...document.querySelectorAll('.ui-toast--error')].find((x) => /pack check failed/.test(x.textContent)); if (t) t.querySelector('.ui-toast-x').click(); });
    check(!!(await until(async () => !(await stackText(page)).some((t) => /pack check failed/.test(t)), 3000)), 'X dismisses the error');
    /* the policy (the overseer's ruling on review): routine lines fade, Preflight is one toast, at most two of the page's errors stay */
    const kinds = () => page.$$eval('.ui-toast-stack .ui-toast', (l) => l.map((x) => ({ t: x.querySelector('.ui-toast-text').textContent, err: x.classList.contains('ui-toast--error') })));
    await page.evaluate(() => window.B68KitShell.toast('Roll a location first.', true));
    let k = await kinds();
    check(k.some((x) => x.t === 'Roll a location first.' && !x.err), 'a routine "do X first" line is news, not an error');
    check(!!(await until(async () => !(await kinds()).some((x) => x.t === 'Roll a location first.'), 9000)), 'and it fades by itself');
    await page.evaluate(() => { window.B68KitShell.toast('Preflight: 4 to fix before the start (Before, Preflight).', true); window.B68KitShell.toast('Preflight: 2 to fix before the start (Before, Preflight).', true); });
    k = await kinds();
    check(k.filter((x) => /^Preflight:/.test(x.t)).length === 1 && k.some((x) => /^Preflight: 2 /.test(x.t) && x.err), 'Preflight is one toast: a new count replaces the old one ' + JSON.stringify(k));
    await page.evaluate(() => { ['Could not send to the iPad: the line dropped (invented).', 'Not saved: the server refused a change (invented).', 'The roll failed: no table (invented).'].forEach((t) => window.B68KitShell.toast(t, true)); });
    await sleep(600);
    k = await kinds();
    check(k.filter((x) => x.err).length === 2 && k.some((x) => /roll failed/.test(x.t)) && k.some((x) => /Not saved/.test(x.t)), 'at most two of the page\'s errors stay: the newest two ' + JSON.stringify(k.map((x) => x.t.slice(0, 24))));
    await page.evaluate(() => [...document.querySelectorAll('.ui-toast-x')].forEach((x) => x.click()));
    await sleep(500);
    /* re-review: these exact page lines are failures and stay (a refused write, a send that did not happen, Co-GM switching itself off) */
    const STAY_LINES = ['The GM notes are full (250 of 256 KiB). Export tonight’s note and clear the capture first.',
      'Something else is on the iPad now, so the clocks were not sent and no longer follow the table. Show on iPad sends them again.',
      'Something else is on the iPad now, so the map was not sent and live reveal has stopped. Show on iPad starts it again.',
      'Something else is on the iPad now, so the chase was not sent and the strip no longer follows it. Show on iPad sends it again.',
      'Co-GM switched itself off: Listening is off.'];
    for (const line of STAY_LINES) {
      await page.evaluate((t) => window.B68KitShell.toast(t, true), line);
      const one = (await kinds()).find((x) => x.t === line);
      check(!!one && one.err, 'stays as an error: "' + line.slice(0, 60) + '…"');
      await page.evaluate(() => [...document.querySelectorAll('.ui-toast-x')].forEach((x) => x.click())); await sleep(400);
    }
    /* re-review: a "Not saved" line keeps its place when two later failures arrive */
    await page.evaluate(() => { ['Not saved: the server refused a change (invented).', 'Could not send to the iPad: the line dropped (invented).', 'The roll failed: no table (invented).'].forEach((t) => window.B68KitShell.toast(t, true)); });
    await sleep(600);
    k = await kinds();
    check(k.some((x) => /^Not saved/.test(x.t) && x.err) && k.some((x) => /roll failed/.test(x.t)) && !k.some((x) => /line dropped/.test(x.t)) && k.filter((x) => x.err).length === 2,
      'a "Not saved" line keeps its place: two later failures put the other one away ' + JSON.stringify(k.map((x) => x.t.slice(0, 24))));
    await page.evaluate(() => [...document.querySelectorAll('.ui-toast-x')].forEach((x) => x.click()));

    /* ---- 6. the layers ---- */
    const z = await page.evaluate(() => { const zi = (sel) => { const e = document.querySelector(sel); return e ? Number(getComputedStyle(e).zIndex) || 0 : null; };
      const root = getComputedStyle(document.documentElement), tok = (n) => Number(root.getPropertyValue('--ui-layer-' + n));
      return { drawer: zi('#gm-drawer'), band: zi('#gm-band'), assist: zi('.gm-assist'), menu: zi('.gm-menu-list'), find: zi('#gm-find'), stack: zi('.ui-toast-stack'),
        tok: { sticky: tok('sticky'), popover: tok('popover'), dialog: tok('dialog'), toast: tok('toast'), alarm: tok('alarm') } }; });
    check(z.drawer > z.tok.sticky && z.drawer < z.band && z.assist < z.band && z.band < z.tok.popover && z.menu === z.tok.popover && z.find === z.tok.dialog && z.stack === z.tok.toast,
      'the ladder in the six tokens: drawer and Blade panel < band < popover (the Menu) < dialog (Find) < toast ' + JSON.stringify(z));
    await page.evaluate(() => window.B68KitShell.toast('Sent to the iPad: the card rooms (invented).', true));
    await blur(page); await page.keyboard.press('Shift+H');
    const cover = await until(() => page.evaluate(() => { const b = document.querySelector('.gm-blank'); if (!b) return null;
      const at = (e) => { const r = e.getBoundingClientRect(); return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); };
      const t = document.querySelector('.ui-toast'), band = document.querySelector('#gm-band'), foot = document.querySelector('#gm-foot');
      return { z: Number(getComputedStyle(b).zIndex), toast: !!t && at(t) === b, band: at(band) === b, foot: !!foot && at(foot) === b }; }), 3000);
    check(!!cover && cover.toast && cover.band && cover.foot && cover.z === z.tok.alarm, 'Blank (Shift+H) covers the band, a toast and the capture bar, at the alarm layer ' + JSON.stringify(cover));
    await page.mouse.click(400, 400);
    check(!!(await until(() => page.evaluate(() => !document.querySelector('.gm-blank')), 2000)), 'a click takes Blank away');
    await page.evaluate(() => [...document.querySelectorAll('.ui-toast-x')].forEach((x) => x.click()));
    await blur(page); await page.keyboard.press('w'); await page.waitForTimeout(300);
    await page.click('#gm-band [data-band="panic"]');
    const pan = await until(() => page.evaluate(() => { const r2 = document.querySelector('#gm-band .gm-band-r2'); if (r2.getAttribute('data-alarm') !== 'panic') return null;
      const r = r2.getBoundingClientRect(), e = document.elementFromPoint(r.right - 200, r.top + r.height / 2); return !!e && !!e.closest('#gm-band'); }), 5000);
    check(!!pan, 'PANIC with the drawer open: the band\'s alarm row is on top');
    if (await page.$('[data-cs="resume"]')) await page.click('[data-cs="resume"]');
    await c.close();
  }

  /* ---- 4b. the cue's toasts: Undo, and the Reveal question ---- */
  {
    const { c, page } = await open();
    await goPlace(page, 'score');
    const type = async (text) => { await page.fill('#as-ask-q', text); await page.press('#as-ask-q', 'Enter'); };
    const ovKind = async () => { const d = (await api('GET', '/gm/ambient')).json; const doc = d && (d.doc || d); return doc && doc.overlay ? doc.overlay.kind || '' : ''; };
    await blur(page); await page.keyboard.press('a');
    await page.waitForFunction(() => document.querySelector('#as-panel').getBoundingClientRect().left < innerWidth - 100, null, { timeout: 4000 });
    await type('Blade, risky, standard');
    const undoB = await until(() => page.$('.ui-toast-stack .ui-toast.gm-ugtoast [data-ug="undo"]'), 6000);
    check(!!undoB && !(await page.$('body > .gm-ugtoast')), 'a typed cue\'s Undo toast is in the stack (gm-ugtoast, data-ug="undo"), not the old centred one');
    check(!!(await until(async () => (await ovKind()) === 'report', 6000)), 'and the stamp is up on the iPad');
    if (undoB) await undoB.click();
    check(!!(await until(async () => (await ovKind()) === '', 6000)), 'the cue\'s Undo still undoes (the stamp comes down)');
    check(!!(await until(async () => (await stackText(page)).includes('Undone.'), 3000)), 'and says so in the stack');
    await sleep(600);
    const hiddenNow = async () => (((await api('GET', '/npcs')).json.docs || []).find((n) => n.doc.name === 'GM-ONLY-Lotte Brand') || { doc: {} }).doc.revealed;
    await type('Blade, reveal GM-ONLY-Lotte Brand');
    let q = await until(() => page.$('.ui-toast[role="alertdialog"] [data-ug="confirm"]'), 6000);
    check(!!q && !!(await page.$('.ui-toast[role="alertdialog"] [data-ug="cancel"]')) && /Reveal/.test(await page.$eval('.ui-toast[role="alertdialog"] .ui-toast-text', (e) => e.textContent)), 'the cue\'s question is in the stack: Reveal (data-ug="confirm") or Cancel (data-ug="cancel")');
    if (q) await page.click('.ui-toast[role="alertdialog"] [data-ug="cancel"]');
    await sleep(1200);
    check((await hiddenNow()) === false && !(await page.$('.ui-toast[role="alertdialog"]')), 'Cancel: the toast goes and no one is revealed');
    await type('Blade, reveal GM-ONLY-Lotte Brand');
    q = await until(() => page.$('.ui-toast[role="alertdialog"] [data-ug="confirm"]'), 6000);
    if (q) await q.click();
    check(!!(await until(async () => (await hiddenNow()) === true, 6000)), 'Reveal: the person is revealed');
    await api('PUT', '/npcs/npc_hidden', { name: 'GM-ONLY-Lotte Brand', role: 'invented', revealed: false });
    await until(async () => (await hiddenNow()) === false, 4000); await sleep(2500);      /* the page hears the person is hidden again */
    /* the reviewer's case: Preflight and three errors up, then a typed Reveal: its question shows at once, with its hooks, and Cancel works */
    const seen = async () => page.evaluate(() => { const b = document.querySelector('[data-ug="confirm"]'); if (!b) return null; const r = b.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { inView: r.width > 0 && r.top >= 0 && r.bottom <= innerHeight, top: !!e && b.contains(e), cancel: !!document.querySelector('[data-ug="cancel"]'), stack: !!b.closest('.ui-toast-stack') }; });
    const qGone = () => page.evaluate(() => !document.querySelector('[data-ug="confirm"]'));
    await page.evaluate(() => { window.B68KitShell.toast('Preflight: 4 to fix before the start (Before, Preflight).', true); ['Could not send to the iPad: the line dropped (invented).', 'Not saved: the server refused a change (invented).', 'The roll failed: no table (invented).'].forEach((t) => window.B68KitShell.toast(t, true)); });
    await type('Blade, reveal GM-ONLY-Lotte Brand');
    let qs = await until(seen, 3000);
    check(!!qs && qs.inView && qs.top && qs.cancel, 'Preflight and three errors up: the Reveal question shows at once, on top, with Cancel ' + JSON.stringify(qs));
    if (qs) await page.click('[data-ug="cancel"]');
    check(!!(await until(qGone, 3000)) && (await hiddenNow()) === false, 'and its Cancel reveals no one');
    /* a full stack (four news lines that stay): the question cannot wait in the queue, so it is the old centred toast, with the same hooks */
    await page.evaluate(() => { for (let i = 1; i <= 4; i++) window.B68Ui.toast({ text: 'Sent to the iPad: slide ' + i + ' (invented)', tone: 'info', duration: 0 }); });
    await sleep(2500);
    await type('Blade, reveal GM-ONLY-Lotte Brand');
    qs = await until(seen, 3000);
    check(!!qs && qs.inView && qs.top && qs.cancel && !qs.stack, 'a full stack: the question is the old centred toast, at once, on top, with Cancel ' + JSON.stringify(qs));
    check(!(await page.$$eval('.ui-toast-stack .ui-toast', (l) => l.some((x) => /^Reveal/.test(x.textContent)))), 'and nothing of it waits in the stack\'s queue');
    const live = await page.evaluate(() => { const b = document.querySelector('body > .gm-ugtoast [data-ug="confirm"]'); if (!b) return null; const s = getComputedStyle(b); return { op: s.opacity, bg: s.backgroundColor, fg: s.color }; });
    check(!!live && live.op === '1' && !/rgba\(0, 0, 0, 0\)|transparent/.test(live.bg) && live.bg !== live.fg, 'its Reveal reads as a live button (full colour, no fade) ' + JSON.stringify(live));
    if (SHOTS) await shot(page, 'fallback-question-paper-1366');
    if (qs) await page.click('[data-ug="cancel"]');
    check(!!(await until(qGone, 3000)) && (await hiddenNow()) === false, 'its Cancel reveals no one');
    await c.close();
  }

  /* ---- 5. the dialogs (KS09.4): each converted site, Cancel (or Esc) and Yes; no native dialog opens ---- */
  {
    await api('PATCH', '/gm/state', { opps: { list: { o_ks09: { from: 'GM', client: 'A porter on the quay', target: 'The house ledger', type: '', note: '', payout: '', order: 1, at: new Date().toISOString() } } } });
    const { c, page } = await open();
    await goPlace(page, 'score');
    const doc = async () => ((await api('GET', '/gm/state')).json || {}).doc || {};
    const live = (o) => Object.keys(o || {}).filter((k) => o[k]);
    const dlg = () => page.$('dialog.ui-dialog[open]');
    const answer = async (act) => { if (!(await until(dlg, 3000))) return false; await until(() => page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('dialog[open]')), 2000); await sleep(150); if (act === 'esc') await page.keyboard.press('Escape'); else await page.click('dialog.ui-dialog[open] [data-ui-act="' + act + '"]'); return !!(await until(async () => !(await dlg()), 3000)); };
    const n0 = dialogs.length;
    /* a. the Menu's Clear tonight's capture */
    await page.click('[data-gm="menu"]'); await page.click('[data-gm="capbar"]');
    await blur(page); await page.keyboard.press('m'); await page.keyboard.type('Ray Okonjo pockets the marker'); await page.keyboard.press('Enter');
    await until(async () => live((await doc()).capture).length > 0, 4000);
    const caps = live((await doc()).capture).length;
    await page.click('[data-gm="menu"]'); await page.click('[data-gm="clearcap"]');
    check(await answer('cancel') && live((await doc()).capture).length === caps, 'Clear tonight\'s capture asks in the kit\'s Dialog; Cancel keeps the ' + caps + ' lines');
    await page.click('[data-gm="menu"]'); await page.click('[data-gm="clearcap"]');
    check(await answer('confirm') && !!(await until(async () => live((await doc()).capture).length === 0, 4000)), 'and Clear clears them');
    /* b. Opportunities: Remove a card that has words on it */
    await blur(page); await page.keyboard.press('o'); await until(() => paneOn(page, 'cards'), 4000);
    await page.waitForSelector('[data-gm="opp-del"][data-id="o_ks09"]', { timeout: 5000 });
    await page.click('[data-gm="opp-del"][data-id="o_ks09"]');
    const escd = await answer('esc'), kept = live(((await doc()).opps || {}).list).includes('o_ks09'), alarm = await page.evaluate(() => document.querySelector('#gm-band .gm-band-r2').getAttribute('data-alarm'));
    check(escd && kept && alarm !== 'panic', 'Remove this card asks in the Dialog; Esc is its Cancel (the card stays, and that Esc was not PANIC) ' + JSON.stringify({ escd, kept, alarm }));
    await page.click('[data-gm="opp-del"][data-id="o_ks09"]');
    check(await answer('confirm') && !!(await until(async () => !live(((await doc()).opps || {}).list).includes('o_ks09'), 4000)), 'and Remove removes it');
    /* c. Prep: clear a beat's start time */
    await blur(page); await page.keyboard.press('r'); await until(() => paneOn(page, 'prep'), 4000);
    await page.waitForSelector('#gm-prep .pp-beat[data-beat]', { timeout: 5000 });
    const beat = await page.$eval('#gm-prep .pp-beat[data-beat]', (b) => b.getAttribute('data-beat'));
    const started = async () => { const b = ((await doc()).prep || {}).beats || {}; return !!b[beat]; };
    await page.click('#gm-prep .pp-beat[data-beat="' + beat + '"]');
    await until(started, 4000);
    await page.click('#gm-prep .pp-beat[data-beat="' + beat + '"]');
    check(await answer('cancel') && await started(), 'Clear this beat\'s start time asks in the Dialog; Cancel keeps the time');
    await page.click('#gm-prep .pp-beat[data-beat="' + beat + '"]');
    check(await answer('confirm') && !!(await until(async () => !(await started()), 4000)), 'and Clear clears it');
    check(dialogs.length === n0, 'no native dialog opened for the three converted sites');
    await c.close();
  }

  /* ---- 5b. the plain dialog (a browser with no showModal): Ctrl+K waits behind it as every other key does; one Esc closes it, not PANIC ---- */
  {
    const { c, page } = await open({ init: () => { HTMLDialogElement.prototype.showModal = undefined; } });
    await goPlace(page, 'score');
    const st = () => page.evaluate(() => ({ plain: !!document.querySelector('.ui-dialog.is-plain'), find: !document.querySelector('#gm-find').hidden, open: window.B68GmEsc.list().filter((e) => e.open && e.kind === 'overlay').map((e) => e.id),
      alarm: document.querySelector('#gm-band .gm-band-r2').getAttribute('data-alarm'), r: window.__ks03c && window.__ks03c.v }));
    await page.evaluate(() => { window.__ks03c = undefined; window.B68Ui.confirm({ title: 'Clear the card rooms? (invented)' }).then((v) => { window.__ks03c = { v }; }); });
    await page.waitForSelector('.ui-dialog.is-plain', { timeout: 3000 });
    await page.keyboard.press('Control+k'); await page.waitForTimeout(300);
    let s = await st();
    check(s.plain && !s.find, 'a plain dialog: Ctrl+K does not open Find under its scrim ' + JSON.stringify(s));
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    s = await st();
    check(!s.plain && !s.find && s.r === false && s.open.length === 0 && s.alarm !== 'panic', 'one Esc closes it (its Cancel), nothing is left open behind it, and that Esc was not PANIC ' + JSON.stringify(s));
    await blur(page); await page.keyboard.press('Control+k');
    check(!!(await until(() => page.evaluate(() => !document.querySelector('#gm-find').hidden), 3000)), 'with the dialog gone, Ctrl+K opens Find');
    await page.keyboard.press('Escape');
    check(!!(await until(() => page.evaluate(() => document.querySelector('#gm-find').hidden), 3000)), 'and Esc closes Find');
    await c.close();
  }

  /* ---- 7. off mid-session: back to the old shell without a reload ---- */
  {
    const { c, page } = await open();
    await goPlace(page, 'score');
    await blur(page); await page.keyboard.press('i');
    await page.waitForSelector('#gm-ipad-settings [data-set="kit.desk"][data-v="0"]', { timeout: 5000 });
    await page.evaluate(() => { ['Could not send to the iPad: the line dropped (invented).', 'Not saved: the server refused a change (invented).'].forEach((t) => window.B68KitShell.toast(t, true)); window.B68KitShell.toast('Sent to the iPad: the card rooms (invented).'); });
    check((await page.$$('.ui-toast')).length >= 3, 'two errors and a news line up before the setting turns off');
    await page.click('#gm-ipad-settings [data-set="kit.desk"][data-v="0"]');
    const back = await until(() => page.evaluate(() => !/desk/.test(document.documentElement.getAttribute('data-kit') || '') && !document.querySelector('.gm-views.ui-tabs')
      && [...document.querySelectorAll('.gm-views [data-pv]')].some((b) => b.getAttribute('data-pv') === 'chase') && !!document.querySelector('.gm-menu-list > button[data-gm="update"]')), 15000);
    check(!!back, 'off: the old row (Chase back in Score) and the old Menu, without a reload');
    const left = await page.evaluate(() => ({ marks: document.querySelectorAll('[data-kshell-cls], [data-kshell-sig]').length, cls: document.querySelectorAll('#gm-root .kshell-find, #gm-root .kshell-drawer, #gm-root .kshell-foot, #gm-root .kshell-tabs, #gm-root .kshell-viewrow').length }));
    check(left.marks === 0 && left.cls === 0, 'off: no class or mark the shell added is left on the page ' + JSON.stringify(left));
    const flat = await until(() => page.evaluate(() => ({ toasts: document.querySelectorAll('.ui-toast').length, stack: document.querySelectorAll('.ui-toast-stack').length, h: document.scrollingElement.scrollHeight, vh: innerHeight }))
      .then((r) => (r.toasts === 0 && r.h <= r.vh ? r : null)), 4000);
    check(!!flat, 'off: no toast is left in the document and the page does not scroll ' + JSON.stringify(flat || await page.evaluate(() => ({ toasts: document.querySelectorAll('.ui-toast').length, h: document.scrollingElement.scrollHeight, vh: innerHeight }))));
    await page.click('[data-gm="menu"]'); await page.click('[data-gm="capbar"]');
    check(!!(await until(async () => /capture bar/i.test(await oldToast(page)), 3000)), 'off: the page\'s toast is the old #toast line again');
    await page.click('#gm-ipad-settings [data-set="kit.desk"][data-v="1"]');
    const again = await until(() => page.evaluate(() => !!document.querySelector('.gm-views.ui-tabs') && !!document.querySelector('#gm-find.kshell-find') && !!document.querySelector('#gm-drawer .gm-dtab.ui-tab')
      && !document.querySelector('.gm-menu-list > button[data-gm="update"]')), 10000);
    check(!!again, 'on again: the kit row, Find and the drawer dressed, and the kit Menu, without a reload');
    await sleep(800);
    check(!(await page.$$eval('.ui-toast', (l) => l.some((x) => /\(invented\)/.test(x.textContent)))), 'on again: the toasts put away when it turned off do not come back');
    await c.close();
  }

  check(!dialogs.length, 'no native dialog was opened by these steps: ' + dialogs.join(' | '));
  check(!errors.length, 'no page errors: ' + errors.slice(0, 5).join(' | '));
  await browser.close();
} catch (e) {
  console.log('FAIL ' + (e && e.stack || e));
  failed++;
}
clearTimeout(timeout);
console.log('kit-shell: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
