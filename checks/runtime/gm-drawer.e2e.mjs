// The GM page drawer (app/gm-page.js): closed by default, W and the header button, Table / Crew / Players, at most one sheet frame, read only until Edit,
// removed on close, the same-origin framing header, three widths and a 390 px phone. Real local Worker on PORT (default 9800), invented data only.
//   PW_MODULE=<playwright install> PW_CHANNEL=msedge node checks/runtime/gm-drawer.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9800);
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
    notes: [{ id: 'n-gala', rel: 'Sessions/gala.md', title: 'Gala prep', blocks: [{ k: 'md', src: '# Gala prep\n\n## Rooms\n\n### Cocktail lounge\n- **Costume:** Brocade jackets.\nLOUNGE-NOTE-BODY the bar runs the length of the room, see [[Pip Quill]].\n\n> [!quote] SAY\n> Mind the glass.\n' }] }] },
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: NOW }, T: locFix.T, extra: locFix.extra,
    authored: { v: 1, sites: { [NAME2]: site(NAME2, c2.play), [NAME1]: site(NAME1, c1.play) }, bind: {} } },
};

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-drawer-e2e-'));
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
  for (const [id, n] of [['run-pc1', 'Cass Fenn'], ['run-pc2', 'Dov Ketch']]) check((await api('PUT', '/characters/' + id, pcDoc(n))).status === 200, 'an invented PC is filed: ' + n);
  await G0.c.close();
  check((await setCard(NAME2)).status === 200, 'the Location card is the v2 site');

  const shown = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && r.width > 0 && r.height > 0; });
  const frames = (page) => page.$$eval('iframe', (l) => l.map((f) => f.getAttribute('src')));
  const frameOf = async (page) => { const h = await page.waitForSelector('#gm-drawer iframe', { timeout: 15000 }); return h.contentFrame(); };
  const oneFrame = (page, re) => page.waitForFunction((s) => { const l = document.querySelectorAll('iframe'); return l.length === 1 && new RegExp(s).test(l[0].getAttribute('src')); }, re, { timeout: 10000 }).then(() => true, () => false);

  /* ---- 1. the response header ---- */
  { const r = await fetch(BASE + '/', { headers: { 'X-Dev-User': GM } }); check(r.headers.get('x-frame-options') === 'SAMEORIGIN' && r.headers.get('content-security-policy') === "frame-ancestors 'self'", 'the page may be framed by its own origin only: ' + r.headers.get('x-frame-options') + ' / ' + r.headers.get('content-security-policy')); }

  /* ---- 2. closed by default; the right column is gone ---- */
  const G = await open();
  const p = G.page;
  check(!(await shown(p, '#gm-drawer')) && (await frames(p)).length === 0, 'closed by default: nothing shown, no frame');
  check((await p.$$('.gm-rail')).length === 0, 'there is no right rail column');
  check(await p.$eval('.gm-side', (e) => e.getBoundingClientRect().right >= innerWidth - 70), 'the centre column takes the width the rail had');
  check(await p.$eval('#gm-bar-drawer', (b) => b.getAttribute('aria-expanded') === 'false'), 'the header button says it is shut');

  /* ---- 3. the key and the button open it; Table holds the rail ---- */
  await p.keyboard.press('w');
  check(await shown(p, '#gm-drawer') && await shown(p, '#gm-rail') && await p.$eval('#gm-rail', (e) => /Table clocks/.test(e.textContent)), 'W opens the drawer on the Table tab, with the table clocks');
  check(await p.evaluate(() => localStorage.getItem('b68.gm.drawer')) === '1', 'and keeps the choice');
  check((await frames(p)).length === 0, 'Table holds no frame');
  await p.keyboard.press('w');
  check(!(await shown(p, '#gm-drawer')), 'W shuts it');
  await p.click('#gm-bar-drawer');
  check(await shown(p, '#gm-drawer') && await p.$eval('#gm-bar-drawer', (b) => b.getAttribute('aria-expanded') === 'true'), 'the header button opens it');

  /* ---- 4. Crew: the Run view's crew lines, then the crew sheet in a read-only frame ---- */
  await p.click('#gm-drawer [data-gm="dtab"][data-tab="crew"]');
  check(!!(await p.waitForSelector('#gm-dcrew .rv-crew', { timeout: 10000 }).then(() => true, () => false)) && (await p.$$('#gm-dcrew .rv-crew')).length === 2, 'Crew: the Run view\'s crew lines (two PCs) sit in the drawer');
  check((await p.$$('.rv-sec[data-sec="crew"]')).length === 0, 'and no longer in the Run view\'s right column');
  { const src = await frames(p); check(src.length === 1 && /\?ro=1#t$/.test(src[0]), 'one frame: the crew sheet, read only (?ro=1): ' + JSON.stringify(src)); }
  { const fr = await frameOf(p);
    check(!!(await fr.waitForFunction(() => /Read only/i.test(document.body.textContent), null, { timeout: 30000 }).then(() => true, () => false)), 'the crew sheet says Read only'); }

  /* ---- 5. Players: one sub-tab per character; one frame at a time; the old node is torn down ---- */
  await p.evaluate(() => { window.__oldFrame = document.querySelector('#gm-drawer iframe'); });
  await p.click('#gm-drawer [data-gm="dtab"][data-tab="players"]');
  check((await p.$$('#gm-dpcs [data-gm="dpc"]')).length === 2, 'Players: a sub-tab per character');
  check(await oneFrame(p, '#c/run-pc1$'), 'one frame, the first character\'s sheet');
  check(await p.evaluate(() => !window.__oldFrame.isConnected && window.__oldFrame.getAttribute('src') === 'about:blank'), 'the crew frame was blanked and removed');
  { const fr = await frameOf(p);
    check(!!(await fr.waitForSelector('.dossier.ds-ro', { timeout: 30000 }).then(() => true, () => false)), 'the character sheet opens read only (ds-ro)'); }
  await p.evaluate(() => { window.__oldFrame = document.querySelector('#gm-drawer iframe'); });
  await p.click('#gm-dpcs [data-gm="dpc"][data-id="run-pc2"]');
  check(await oneFrame(p, '#c/run-pc2$') && await p.evaluate(() => !window.__oldFrame.isConnected), 'another character: still one frame, the old one gone');

  /* ---- 6. Edit ---- */
  await p.click('#gm-drawer .gm-dpane[data-dpane="players"] [data-gm="dedit"]');
  check(await p.waitForFunction(() => { const l = document.querySelectorAll('iframe'); return l.length === 1 && !/ro=1/.test(l[0].getAttribute('src')); }, null, { timeout: 8000 }).then(() => true, () => false), 'Edit reloads the frame without ro=1, still one frame');
  { const fr = await frameOf(p);
    check(!!(await fr.waitForSelector('.dossier', { timeout: 30000 }).then(() => true, () => false)) && await fr.$eval('.dossier', (e) => !e.classList.contains('ds-ro')), 'the sheet is editable (no ds-ro)'); }
  await p.click('#gm-drawer .gm-dpane[data-dpane="players"] [data-gm="dedit"]');
  check(await oneFrame(p, 'ro=1'), 'Done editing goes back to read only');

  /* ---- 7. closing takes the frame down; the choice survives a reload ---- */
  await p.evaluate(() => { window.__oldFrame = document.querySelector('#gm-drawer iframe'); });
  await p.keyboard.press('Escape');
  check(!(await shown(p, '#gm-drawer')) && (await frames(p)).length === 0 && await p.evaluate(() => !window.__oldFrame.isConnected && window.__oldFrame.getAttribute('src') === 'about:blank'), 'Esc shuts the drawer and takes the frame down (blanked, then removed)');
  await p.keyboard.press('w'); await p.reload();
  await p.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  check(await p.waitForFunction(() => document.getElementById('gm-root').classList.contains('dw-open'), null, { timeout: 8000 }).then(() => true, () => false), 'a reload keeps it open');
  await p.click('#gm-drawer .gm-dhead [data-gm="drawer"]'); await p.reload(); await p.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  check(!(await p.$eval('#gm-root', (r) => r.classList.contains('dw-open'))), 'and a reload keeps it shut');
  await G.c.close();

  /* ---- 8. three widths: the Blade tab at the edge, the drawer beside it, no overflow ---- */
  for (const [w, h] of [[1100, 700], [1366, 768], [1700, 900]]) {
    const W3 = await open(w, h);
    await W3.page.keyboard.press('w');
    const g = await W3.page.evaluate(() => { const d = document.querySelector('#gm-drawer').getBoundingClientRect(), t = document.querySelector('.gm-assist .as-tab'), tr = t ? t.getBoundingClientRect() : null; return { dl: d.left, dr: d.right, dt: d.top, db: d.bottom, vw: innerWidth, vh: innerHeight, tl: tr ? tr.left : null, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }; });
    check(g.dr <= g.vw + 1 && g.dl >= 0 && g.db <= g.vh + 1 && g.dt > 0 && g.sw <= g.cw + 1 && (g.tl === null || g.dr <= g.tl + 1), w + ' px: the drawer sits inside the window, clear of the Blade tab, no sideways scroll ' + JSON.stringify(g));
    await W3.c.close();
  }

  /* ---- 9. a 390 px phone: a full-screen sheet from the State segment ---- */
  { const P = await open(390, 800);
    await P.page.click('[data-gm="seg"][data-seg="state"]');
    const g = await P.page.evaluate(() => { const d = document.querySelector('#gm-drawer').getBoundingClientRect(); return { l: d.left, r: d.right, t: d.top, b: d.bottom, vw: innerWidth, vh: innerHeight, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }; });
    check(g.l <= 1 && g.r >= g.vw - 1 && g.t <= 1 && g.b >= g.vh - 1 && g.sw <= g.cw + 1, 'phone: State opens a full-screen sheet, no overflow ' + JSON.stringify(g));
    await P.page.click('#gm-drawer [data-gm="dtab"][data-tab="players"]');
    check(await oneFrame(P.page, '#c/'), 'phone: Players opens one frame');
    await P.page.click('#gm-drawer .gm-dhead [data-gm="drawer"]');
    check((await frames(P.page)).length === 0 && !(await shown(P.page, '#gm-drawer')), 'phone: the cross shuts it and takes the frame down');
    await P.c.close(); }

  const real = errors;
  check(!real.length, 'no page errors: ' + real.slice(0, 3).join(' | '));
  await browser.close();
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
clearTimeout(timeout);
console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASSED'));
process.exit(failed ? 1 : 0);
