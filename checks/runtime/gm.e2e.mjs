// The GM page (#gm) and the display wiring (#display) end to end against a real local Worker (wrangler dev, DEV_USER) on
// PORT (default 8845), with the migrations applied (the seven seeded NPCs are there) and only invented fixture tables
// (checks/runtime/fixtures/gm/). The GM imports a fixture pack through the page; the console opens on the four Situations
// (keys 1-4, a three-way Position switch, a lead box with "Or" rows, one merged actions row); the Situations | Classic toggle
// shows the nine-button console and is remembered across a reload; reloading redraws the same card; capture with P / X / L
// records the session; the Home greeting's "Change name" edits the display name (saved, cleared, the API's 400 message,
// offline); keys stay quiet while typing, the location tab rolls and draws, only a
// player-layer map reaches the display (a GM-layer svg is refused in code), H blanks the screen, an NPC goes to the iPad
// (hidden ones after a confirm), the note downloads; the phone (360 px) and the iPad (both orientations) layouts do not
// overflow and their buttons are at least 44 px; a player sees "GM only" and no GM button, and their sign-in purges the
// cached pack; #display hides the header and mounts the display page.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node checks/runtime/gm.e2e.mjs      (or: npm run check:gm)
// PW_MODULE=<path to playwright> picks the Playwright install; GM_SHOTS=<dir> also saves screenshots there (GM_FULLPAGE=1: whole page).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8845);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', PLAYER = 'p1@example.test';
const SHOTS = process.env.GM_SHOTS || '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

/* ---------- an invented fixture pack (format 1), its campaign data five days old ---------- */
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const conFix = JSON.parse(readFileSync(path.join(FIX, 'console-pack.json'), 'utf8'));
const locFix = JSON.parse(readFileSync(path.join(FIX, 'location-pack.json'), 'utf8'));
const OLD = new Date(Date.now() - 5 * 86400000).toISOString();
const PACK = { format: 1, exportedAt: OLD, parts: {
  console: conFix.parts.console,
  campaign: { ...conFix.parts.campaign, src: { ...conFix.parts.campaign.src, exportedAt: OLD } },
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: OLD }, T: locFix.T, extra: locFix.extra }
} };
const TABLE_TEXT = JSON.stringify(PACK.parts.location.T).match(/"([^"]{20,})"/)[1];   // a fixture table string: never in localStorage

/* ---------- our own server, on a database the migrations were applied to ---------- */
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-gm-e2e-'));
const packFile = path.join(stateDir, 'b68-gm-pack.json');
writeFileSync(packFile, JSON.stringify(PACK));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use: stop what is on it, or set PORT'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM], { cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
function killServer() {
  if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} }
}
process.on('exit', () => { killServer(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 300000);
const api = (method, p, user, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

/* anything wider than the screen (fixed elements and scrollers aside), and visible controls smaller than 44 px */
function layout() {
  const de = document.documentElement, vw = window.innerWidth, wide = [], small = [];
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1) {
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { if (getComputedStyle(p).overflowX !== 'visible') { clipped = true; break; } }
      if (!clipped && getComputedStyle(el).position !== 'fixed') wide.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(/\s+/)[0] : '')) + ' ' + Math.round(r.right));
    }
  }
  for (const el of document.querySelectorAll('#gm-page button, #gm-page a.btn, #gm-page a.chip, #gm-page select, #gm-page input[type="text"]')) {
    const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
    if (r.height < 43.5) small.push((el.getAttribute('data-gm') || el.id || el.tagName) + ' ' + Math.round(r.height));
  }
  return { vw, scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, wide: wide.slice(0, 8), small: small.slice(0, 8) };
}

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 300);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(user, hash, { width = 1280, height = 900, mobile = false, ctx = null } = {}) {
    const c = ctx || await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, viewport: { width, height }, serviceWorkers: 'block', isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1, acceptDownloads: true });
    await c.addInitScript(() => { window.__B68_POLL_MS = 700; });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(user + ': ' + m.text()); });
    page.on('pageerror', (e) => errors.push(user + ' pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '/' + hash);
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    return { ctx: c, page };
  }
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: !!process.env.GM_FULLPAGE }); };
  const cardText = (page) => page.$eval('#gm-card .gm-card', (c) => c.textContent).catch(() => '');
  const gmState = async () => (await api('GET', '/gm/state', GM)).json.doc;

  /* ---- a player first: no GM button, "GM only", 403 from the API ---- */
  const P = await open(PLAYER, '#gm');
  check(await P.page.waitForSelector('#gm-page .gm-note', { timeout: 20000 }).then(() => true, () => false) && /GM only/.test(await P.page.textContent('#gm-page')), 'player: #gm says GM only');
  check(await P.page.$eval('#gmBtn', (b) => b.hidden), 'player: no GM button in the nav');
  check((await api('GET', '/gm/pack', PLAYER)).status === 403, 'player: GET /api/gm/pack is 403');
  await P.page.goto(BASE + '/#display'); await sleep(800);
  check(/GM only/.test(await P.page.textContent('#display-page')), 'player: #display says GM only and mounts nothing');

  await api('PATCH', '/campaign', GM, { session: { number: 4 } });

  /* ---- the GM: no pack yet, so the import screen ---- */
  const G = await open(GM, '#gm');
  check(await G.page.waitForSelector('#gm-file', { state: 'attached', timeout: 20000 }).then(() => true, () => false), 'GM: with no pack on the server, the import screen');
  check(/npm run gm:pack/.test(await G.page.textContent('#gm-page')), 'import: says how the pack is built');
  check(!(await G.page.$eval('#gmBtn', (b) => b.hidden)), 'GM: the GM button is in the nav');
  await G.page.setInputFiles('#gm-file', packFile);
  await G.page.waitForSelector('#gm-prev table', { timeout: 10000 });
  const prevText = await G.page.textContent('#gm-prev');
  check(/console/.test(prevText) && /location/.test(prevText) && /campaign/.test(prevText) && /Upload 3 parts/.test(prevText), 'import: the preview lists the three parts');
  await G.page.click('[data-gm="upload"]');
  check(await G.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 20000 }).then(() => true, () => false), 'import: uploaded, the console draws');
  const idx = (await api('GET', '/gm/pack', GM)).json;
  check(Object.keys(idx.parts).sort().join() === 'campaign,console,location', 'server: the three parts are stored: ' + Object.keys(idx.parts));
  check((await G.page.$$('#gm-buttons .gm-btn')).length === 4 && (await G.page.$$eval('#gm-buttons .gm-btn kbd', (k) => k.map((x) => x.textContent).join(''))) === '1234', 'console: opens on the four Situations (keys 1-4)');
  check((await G.page.$$('#gm-pos [data-gm="pos"]')).length === 3 && (await G.page.$eval('#gm-pos [aria-checked="true"]', (b) => b.getAttribute('data-v'))) === 'risky', 'console: the three-way Position switch, risky by default');
  check((await G.page.$$('#gm-singles [data-gm="roll"]')).length === 9 && (await G.page.$$('#gm-singles kbd')).length === 0 && await G.page.$eval('#gm-singles', (d) => d.tagName === 'DETAILS' && !d.open), 'console: the nine single tables fold under "More tables" below the card, without keys');
  check((await G.page.$$('#gm-controls [data-ctl="result"]')).length === 0, 'Situations: no Result control (the button is the result)');
  check(await G.page.$eval('#gm-controls', (c) => getComputedStyle(c).display === 'none') && /District: any/.test(await G.page.textContent('#gm-scene-chips')), 'the scene controls fold under a Scene line of labelled chips');
  const colOrder = await G.page.$$eval('.gm-console > *', (ks) => ks.filter((k) => getComputedStyle(k).display !== 'none').map((k) => k.id).join());
  check(colOrder === 'gm-pos,gm-scene,gm-buttons,gm-card,gm-earlier,gm-singles', 'the console column: Position, Scene, the four buttons, the card, Earlier, More tables (' + colOrder + ')');
  check(!(await G.page.$('.gm-console [data-gm="view"]')) && await G.page.$eval('.gm-menu-list [data-gm="view"][data-v="situations"]', (b) => b.getAttribute('aria-pressed') === 'true') && !!(await G.page.$('.gm-menu-list [data-gm="view"][data-v="classic"]')), 'the Situations | Classic toggle is in the Menu, not the console column');
  const viewClick = async (page, v) => { await page.click('[data-gm="menu"]'); await page.click('.gm-menu-list [data-gm="view"][data-v="' + v + '"]'); };
  check(await G.page.$eval('#gm-menu-exp', (e) => e.classList.contains('stale') && /days old/.test(e.textContent)), 'menu: the five-day-old export is flagged');
  const cached = await G.page.evaluate(() => new Promise((res) => { const r = indexedDB.open('b68-gm'); r.onsuccess = () => { const tx = r.result.transaction('kv'); const q = tx.objectStore('kv').getAllKeys(); q.onsuccess = () => res(q.result); }; r.onerror = () => res(null); }));
  check(Array.isArray(cached) && cached.length === 1 && /^pack:/.test(cached[0]), 'the pack is cached in IndexedDB under pack:<user>: ' + JSON.stringify(cached));
  await shot(G.page, '01-gm-console');

  /* ---- the number keys, history, reload replays the same card ---- */
  await G.page.click('#gm-page .gm-h').catch(() => {}); await G.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await G.page.keyboard.press('2');
  await G.page.waitForSelector('#gm-card .gm-card', { timeout: 5000 });
  check(/A 4\/5/.test(await cardText(G.page)) && !!(await G.page.$('#gm-card .gm-lead .gm-lead-t')), 'key 2: a 4/5 card with a lead box');
  const nOr = (await G.page.$$('#gm-card details.gm-or')).length;
  check(nOr >= 1 && nOr <= 3 && (await G.page.$$('#gm-card .gm-card-acts')).length === 1, 'the card: one to three "Or" rows and ONE actions row (' + nOr + ' Or)');
  const orOpen = await G.page.$eval('#gm-card details.gm-or', (d) => d.open);
  await G.page.click('#gm-card details.gm-or > summary');
  check(!orOpen && await G.page.$eval('#gm-card details.gm-or', (d) => d.open) && (await G.page.$eval('#gm-card details.gm-or .gm-or-b', (b) => b.getBoundingClientRect().height)) > 20, 'an "Or" row opens to its full section on one tap');
  await G.page.keyboard.press('5'); await G.page.keyboard.press('9');
  check((await G.page.$$('#gm-earlier [data-gm="replay"]')).length === 1, 'keys 5-9 do nothing in Situations');
  await G.page.keyboard.press('1');
  const card1 = await cardText(G.page);
  check(/Before the roll/i.test(card1) && /Devil/i.test(await G.page.textContent('#gm-card')), 'key 1: a Devil’s Bargain card (Before the roll)');
  check((await G.page.$$('#gm-earlier [data-gm="replay"]')).length === 2, 'Earlier: two rolls');
  // the keys never fire while typing (the Scene line opens the controls)
  await G.page.click('#gm-scene');
  check(await G.page.$eval('#gm-controls', (c) => getComputedStyle(c).display !== 'none'), 'the Scene line opens the controls');
  await G.page.click('#gm-c-threat');
  await G.page.keyboard.type('3');
  check((await cardText(G.page)) === card1 && (await G.page.$$('#gm-earlier [data-gm="replay"]')).length === 2, 'typing a digit in a text box rolls nothing');
  await G.page.keyboard.press('Escape');
  check(await G.page.evaluate(() => document.activeElement === document.body || !document.activeElement || document.activeElement.id !== 'gm-c-threat'), 'Esc leaves the text box');
  await G.page.keyboard.press('Control+3');
  check((await G.page.$$('#gm-earlier [data-gm="replay"]')).length === 2, 'a modifier held: no roll');
  await until(async () => { const d = await gmState(); return d.cards && d.cards.situation && d.hist && Object.keys(d.hist.situation || {}).length === 2; }, 5000);
  const st1 = await gmState();
  check(st1.cards.situation.id === 'situation' && st1.cards.situation.situation === 'before' && typeof st1.cards.situation.seed === 'number' && typeof st1.cards.situation.mem === 'string' && !('lines' in st1.cards.situation) && !('sections' in st1.cards.situation), 'state: the current card is replay info only {id, situation, seed, ui, mem}');
  check(!st1.cards.console && !(st1.hist && st1.hist.console), 'state: composed cards are filed under "situation", never under "console"');
  await G.page.reload(); await G.page.waitForSelector('#gm-card .gm-card', { timeout: 20000 });
  check((await cardText(G.page)) === card1, 'reload: the same card, redrawn from its seed');
  const sticky = await G.page.evaluate(() => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); } return o; });
  check('b68.gm.sticky' in sticky && !Object.values(sticky).some((v) => String(v).includes(TABLE_TEXT)), 'localStorage: the sticky copy is there, and no table text anywhere');

  /* ---- capture: P, X, L; Enter files ---- */
  await G.page.keyboard.press('p');
  check(await G.page.evaluate(() => document.activeElement && document.activeElement.id === 'gm-cap-in'), 'P focuses the capture box');
  await G.page.keyboard.type('Inspector Invented'); await G.page.keyboard.press('Enter');
  await G.page.keyboard.press('Escape');
  await G.page.keyboard.press('x'); await G.page.keyboard.type('The goose is still loose'); await G.page.keyboard.press('Enter'); await G.page.keyboard.press('Escape');
  await G.page.keyboard.press('l');
  const cap = await until(async () => { const d = await gmState(); const c = Object.values(d.capture || {}); return c.length >= 3 ? c : null; }, 5000);
  check(!!cap && cap.some((e) => e.bucket === 'n' && e.text === 'Inspector Invented') && cap.some((e) => e.bucket === 'x' && /goose/.test(e.text)) && cap.some((e) => e.bucket === 'r' && /Before the roll/.test(e.text)), 'capture: a name, a loose end and the last roll are filed in GM state');
  check(!!cap && cap.every((e) => e.s === 4), 'capture: every entry records its session number (4)' + (cap ? ' ' + JSON.stringify(cap.map((e) => e.s)) : ''));
  const campLog = (await api('GET', '/campaign', GM)).json.doc.log || [];
  check(!campLog.some((e) => /Inspector Invented|goose/.test(e.text)), 'nothing from capture reaches the campaign log');

  /* ---- the Position switch, a single table, and the Classic toggle (remembered per device) ---- */
  await G.page.click('#gm-pos [data-v="desperate"]');
  check(await G.page.$eval('#gm-pos [data-v="desperate"]', (b) => b.getAttribute('aria-checked') === 'true'), 'Position: one tap sets desperate');
  await G.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await G.page.keyboard.press('3');
  check(/^desperate/.test(await G.page.textContent('#gm-card .gm-sub')), 'the next card is rolled at that Position');
  await until(async () => ((await gmState()).con || {}).live && (await gmState()).con.live.pos === 'desperate', 5000);
  await G.page.click('#gm-pos [data-v="risky"]');
  await G.page.click('#gm-singles > summary');
  await G.page.click('#gm-singles [data-gm="roll"][data-n="9"]');
  check(await G.page.$eval('#gm-card article', (a) => a.getAttribute('data-tool')) === 'console' && !(await G.page.$('#gm-card .gm-lead')), 'a single table from the fold: a classic card in the same box');
  await viewClick(G.page, 'classic');
  check((await G.page.$$('#gm-buttons .gm-btn')).length === 9 && (await G.page.$$('#gm-pos [data-gm="pos"]')).length === 0 && (await G.page.$$('#gm-controls [data-ctl="result"]')).length === 1, 'Classic: the nine buttons, the Result control, no Position switch');
  check(await G.page.evaluate(() => localStorage.getItem('b68.gm.view')) === 'classic', 'Classic is remembered on this device (localStorage)');
  await G.page.keyboard.press('7');
  check(await G.page.$eval('#gm-card article', (a) => a.getAttribute('data-tool')) === 'console', 'Classic: key 7 rolls a single table');
  await until(async () => { const d = await gmState(); return d.hist && Object.keys(d.hist.console || {}).length >= 2; }, 5000);
  await G.page.reload(); await G.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 20000 });
  check((await G.page.$$('#gm-buttons .gm-btn')).length === 9 && await G.page.$eval('#gm-root', (r) => r.getAttribute('data-view')) === 'classic', 'reload: still Classic');
  check(!!(await G.page.$('#gm-card article[data-tool="console"]')), 'reload: the Classic card is back');
  check(await G.page.$eval('#gm-buttons', (b) => getComputedStyle(b).gridTemplateColumns.split(' ').length) === 2 && await G.page.$$eval('#gm-buttons .gm-btn b', (bs) => bs.every((b) => b.scrollWidth <= b.clientWidth + 1)), 'laptop Classic: two columns, no label wider than its button');
  await shot(G.page, '01b-gm-classic');
  await viewClick(G.page, 'situations');
  check((await G.page.$$('#gm-buttons .gm-btn')).length === 4 && await G.page.evaluate(() => localStorage.getItem('b68.gm.view')) === 'situations', 'back to Situations in one tap');
  await G.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await G.page.keyboard.press('4'); await G.page.waitForSelector('#gm-card .gm-lead');
  await sleep(700);   // the smooth scroll
  const cardPos = await G.page.$eval('#gm-card .gm-lead-t', (e) => { const r = e.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; });
  check(cardPos.top >= 0 && cardPos.bottom <= 900, 'a roll: the lead line is on screen at 1280×900 ' + JSON.stringify(cardPos));
  // Focus hides the card: a roll in Focus leaves Focus, so the card shows (said once)
  await G.page.keyboard.press('f');
  check(await G.page.$eval('#gm-root', (r) => r.classList.contains('focus')) && await G.page.$eval('#gm-card', (c) => c.getBoundingClientRect().height === 0), 'F: Focus hides the card');
  await G.page.keyboard.press('3'); await sleep(700);
  check(!(await G.page.$eval('#gm-root', (r) => r.classList.contains('focus'))) && await G.page.$eval('#gm-card .gm-lead-t', (e) => { const r = e.getBoundingClientRect(); return r.height > 0 && r.top >= 0 && r.bottom <= 900; }), 'a roll in Focus leaves Focus and shows the card');
  await shot(G.page, '01c-gm-situation');

  /* ---- the location tab and the map ---- */
  await G.page.keyboard.press('b');
  check(await G.page.$eval('#gm-loc', (p) => !p.hidden), 'B shows the Location tab');
  await G.page.click('[data-gm="locroll"]');
  await G.page.waitForSelector('#gm-loc .gm-loccard', { timeout: 10000 });
  check((await G.page.$$('#gm-loc .gm-secret')).length > 0 && /GM only/.test(await G.page.textContent('#gm-loc .gm-loccard')), 'location: the card marks its GM-only sections');
  check(await G.page.$eval('[data-gm="ipad"]', (b) => b.disabled), 'map: Show on iPad is off on the GM layer');
  check(!!(await G.page.$('#gm-map svg')) && await G.page.$eval('#gm-map', (m) => m.getAttribute('data-layer') === 'gm') && await G.page.$eval('#gm-m-view', (s) => s.value === 'rings'), 'a roll draws the GM-layer rings map at once');
  await G.page.click('[data-gm="draw"]');
  check(await G.page.waitForSelector('#gm-map svg', { timeout: 10000 }).then(() => true, () => false), 'map: the GM layer draws inline');
  // a GM-layer render forced at the display is refused in code, and the server's display is unchanged
  const before = (await api('GET', '/gm/display', GM)).json;
  const refused = await G.page.evaluate(async () => { const st = window.B68GmPage._state(); const svg = window.B68Map.render(st.locRoll, { layer: 'gm' }).svg; try { await window.B68GmPage._pushDisplay({ kind: 'svg', title: 'x', svg }); return 'sent'; } catch (e) { return e.message; } });
  check(/player-layer/.test(refused), 'a GM-layer svg pushed at the display is refused: ' + refused);
  check((await api('GET', '/gm/display', GM)).json.seq === before.seq, 'server: the display did not change');
  await G.page.click('[data-gm="layer"][data-v="player"]');
  await G.page.check('[data-reveal="working"]');
  check(!(await G.page.$eval('[data-gm="ipad"]', (b) => b.disabled)), 'map: Show on iPad is on for the player layer');
  await G.page.click('[data-gm="ipad"]');
  const disp = await until(async () => { const d = (await api('GET', '/gm/display', GM)).json; return d.seq > before.seq ? d : null; }, 8000);
  const want = await G.page.evaluate(() => { const st = window.B68GmPage._state(); return window.B68Map.render(st.locRoll, { view: 'rings', theme: 'rulebook', layer: 'player', reveal: ['public', 'working'], width: 1400 }).svg; });
  const ids = (s) => String(s || '').replace(/b68m\d+-/g, 'b68m-');   // the kit numbers its ids per render
  check(!!disp && disp.display.kind === 'svg' && ids(disp.display.svg) === ids(want) && /working/.test(disp.display.caption), 'Show on iPad: the display holds the player-layer render with the reveal' + (disp ? ' (' + disp.display.caption + ')' : ' (nothing sent)'));
  await G.page.click('[data-gm="blankipad"]');
  check(await until(async () => (await api('GET', '/gm/display', GM)).json.display.kind === 'blank', 5000), 'Clear → ambient: the display is blank');
  check(!(await G.page.evaluate(() => /Blank the iPad/.test(document.getElementById('gm-page').textContent))) && /Clear → ambient/.test(await G.page.textContent('#gm-loc [data-gm="blankipad"]')), 'the old "Blank the iPad" name is gone');

  /* ---- Set as score scene (Location panel), then the iPad panel (I): Lights out, Clear, mode, scenes, the score ---- */
  const ambientDoc = async () => (await api('GET', '/gm/ambient', GM)).json;
  const rollName = await G.page.evaluate(() => window.B68GmPage._state().locRoll.name);
  check(!(await G.page.$eval('[data-gm="scorescene"]', (b) => b.disabled)), 'Set as score scene is on for the player layer, beside Show on iPad');
  await G.page.click('[data-gm="scorescene"]');
  const sc = await until(async () => { const d = await ambientDoc(); return d.doc && d.doc.score ? d.doc.score : null; }, 8000);
  check(!!sc && sc.name === rollName && sc.target === '' && sc.reveal.includes('working') && /^<svg/.test(sc.board) && /^<svg/.test(sc.iso) && (sc.view === 'plan' || sc.view === 'rings'),
    'Set as score scene: the server holds the player-layer board and iso for ' + rollName + (sc ? ' (' + sc.view + ', ' + sc.reveal.join('+') + ')' : ' (nothing stored)'));
  const hiddenNow = await G.page.evaluate(() => { const r = window.B68GmPage._state().locRoll, pub = r.rooms.filter((x) => x.band === 'public' || x.band === 'working').map((x) => x.name); return r.rooms.filter((x) => !pub.includes(x.name)).map((x) => x.name); });
  check(!!sc && !hiddenNow.some((n) => new RegExp('(^|[^a-z0-9])' + n.toLowerCase().replace(/[^a-z0-9 ]/g, '.') + '([^a-z0-9]|$)').test((' ' + sc.board + ' ' + sc.iso).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').toLowerCase())), 'the stored score svgs name no hidden room');
  await G.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await G.page.keyboard.press('i');
  check(await G.page.$eval('#gm-ipad', (p) => !p.hidden) && await G.page.waitForSelector('#gm-ipad .gm-ipad-tile:not([disabled])[data-id="board"]', { timeout: 8000 }).then(() => true, () => false), 'I opens the iPad panel; the score scenes are open now that a score is set');
  check((await G.page.textContent('#gm-ipad-score')).includes(rollName), 'the score line names the roll');
  check((await G.page.$$('#gm-ipad .gm-ipad-tile')).length === 16, 'sixteen scenes in the picker');
  await G.page.click('#gm-ipad [data-gm="darkipad"]');
  check(await until(async () => (await api('GET', '/gm/display', GM)).json.display.kind === 'dark', 5000), 'Lights out: the display is dark');
  check(/Lights out/.test(await G.page.textContent('#gm-ipad-now')), 'On the iPad now says so');
  await G.page.click('#gm-ipad [data-gm="blankipad"]');
  check(await until(async () => (await api('GET', '/gm/display', GM)).json.display.kind === 'blank', 5000), 'Clear → ambient in the panel: blank');
  await G.page.click('#gm-ipad [data-gm="darkipad"]'); await until(async () => (await api('GET', '/gm/display', GM)).json.display.kind === 'dark', 5000);
  await G.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await G.page.keyboard.press('0');
  check(await until(async () => (await api('GET', '/gm/display', GM)).json.display.kind === 'blank', 5000), 'key 0 clears to ambient');
  await G.page.click('#gm-ipad [data-gm="ambscene"][data-id="board"]');
  check(!!(await until(async () => { const d = (await ambientDoc()).doc; return d.mode === 'pin' && d.scene === 'board' ? d : null; }, 5000)) && await G.page.$eval('#gm-ipad [data-id="board"]', (b) => b.getAttribute('aria-pressed') === 'true'), 'tapping the board pins it on the server and the panel shows it');
  await G.page.click('#gm-ipad [data-gm="ambmode"][data-v="auto"]');
  check(!!(await until(async () => (await ambientDoc()).doc.mode === 'auto', 5000)), 'Auto');
  await G.page.selectOption('#gm-amb-int', '15');
  check(!!(await until(async () => (await ambientDoc()).doc.intervalMin === 15, 5000)), 'the interval is 15 min');
  const skip0 = (await ambientDoc()).doc.skip || 0;
  await G.page.click('#gm-ipad [data-gm="ambskip"]');
  check(!!(await until(async () => ((await ambientDoc()).doc.skip || 0) === skip0 + 1, 5000)), 'Next scene bumps the skip counter');
  await G.page.click('#gm-ipad [data-gm="clearscore"]');
  check(!!(await until(async () => !(await ambientDoc()).doc.score, 5000)) && await G.page.$eval('#gm-ipad [data-id="board"]', (b) => b.disabled), 'Clear score: gone on the server, and the score scenes close');
  await G.page.keyboard.press('b');
  check(await G.page.$eval('#gm-loc', (p) => !p.hidden), 'B is back on the Location panel');
  // the street description: with Layer back on GM the working tick no longer counts; it goes as plain text
  await G.page.click('[data-gm="layer"][data-v="gm"]');
  await G.page.click('[data-gm="pushtext"]');
  const txt = await until(async () => { const d = (await api('GET', '/gm/display', GM)).json.display; return d.kind === 'text' ? d : null; }, 5000);
  const hiddenRooms = await G.page.evaluate(() => { const r = window.B68GmPage._state().locRoll, pub = r.rooms.filter((x) => x.band === 'public').map((x) => x.name); return r.rooms.filter((x) => x.band !== 'public' && !pub.includes(x.name)).map((x) => x.name); });
  check(!!txt && !/\*\*|(^|\n)#|`|\[\[/.test(txt.text) && !hiddenRooms.some((n) => txt.text.includes(n)), 'street description on the iPad: plain text, the public band only (Layer GM ignores the tick)');
  // a new roll starts again from public only
  await G.page.click('[data-gm="locroll"]'); await G.page.waitForSelector('#gm-loc .gm-loccard');
  const rv = await until(async () => { const d = await gmState(); return d.loc && d.loc.map && d.loc.map.reveal && d.loc.map.reveal.working === false ? d.loc.map.reveal : null; }, 5000);
  check(!!rv && !(await G.page.isChecked('[data-reveal="working"]')) && await G.page.isVisible('[data-reveal="working"]'), 'a new roll resets the reveal to public only (the ticks stay visible)');
  await shot(G.page, '02-gm-location');

  /* ---- the NPC tab: the cast, Show on iPad for a hidden one after a confirm ---- */
  await G.page.keyboard.press('n');
  check(await G.page.waitForFunction(() => document.querySelectorAll('#gm-npc .gm-npcrow').length === 7, null, { timeout: 15000 }).then(() => true, () => false), 'N: the NPC tab lists the seven seeded NPCs');
  check(!/coming/.test(await G.page.textContent('#gm-npc')) && /The pack has no npc part/.test(await G.page.textContent('#gm-npcgen')), 'NPC: the generator panel is there, and says so when the pack has no npc part (its own check: gm-npc-panel.e2e.mjs)');
  await G.page.click('#gm-npc .gm-npcrow[data-id="npc_mira"] [data-gm="npcipad"]');      // hidden: the confirm is accepted
  check(await until(async () => { const d = (await api('GET', '/gm/display', GM)).json.display; return d.kind === 'npc' && d.npcId === 'npc_mira'; }, 5000), 'Show on iPad (after the confirm): the display shows the NPC');
  check((await G.page.getAttribute('#gm-npc .gm-npcrow[data-id="npc_mira"] a.btn', 'href')) === '#cast/npc_mira', 'Put on stage leads to the cast page');

  /* ---- H blanks the screen; any key brings it back ---- */
  await G.page.keyboard.press('h');
  check(await G.page.$eval('.gm-blank', (b) => getComputedStyle(b).position === 'fixed').catch(() => false), 'H: a black screen');
  await G.page.keyboard.press('q');
  check(!(await G.page.$('.gm-blank')), 'any key restores the page');

  /* ---- Export tonight's note ---- */
  const [dl] = await Promise.all([G.page.waitForEvent('download', { timeout: 10000 }), G.page.click('.gm-capacts [data-gm="note"]')]);
  const noteText = readFileSync(await dl.path(), 'utf8');
  check(/^b68g-s\d\d-notes\.md$/.test(dl.suggestedFilename()) && ['## Names', '## Loose ends', '## Moments', '## Rolled at the table'].every((h) => noteText.includes(h)) && /Inspector Invented/.test(noteText), 'the note downloads with its four headings: ' + dl.suggestedFilename());

  /* ---- #display: full screen, mounted; leaving brings the header back ---- */
  await G.page.goto(BASE + '/#display');
  await sleep(1500);
  check(await G.page.$eval('header.top', (h) => getComputedStyle(h).display === 'none' || h.getBoundingClientRect().height === 0), '#display: the header and nav are hidden');
  check(await G.page.$eval('#display-page', (d) => !d.hidden && d.childElementCount > 0), '#display: the display page is mounted');
  check(await G.page.waitForFunction(() => /Mira/.test(document.getElementById('display-page').textContent), null, { timeout: 15000 }).then(() => true, () => false), '#display: it shows the NPC last pushed (Mira, from the cast)');
  check(await G.page.$$eval('#display-page a, #display-page [href]', (xs) => xs.filter((x) => x.tagName.toLowerCase() === 'a' || /gm/i.test(x.getAttribute('href') || '')).length) === 0, '#display: no link anywhere in the display (no way to the GM page)');
  await G.page.goto(BASE + '/#gm'); await G.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 20000 });
  /* on a laptop the GM page brings its own top bar instead of the site header (the laptop layout) */
  check(await G.page.evaluate(() => getComputedStyle(document.querySelector('header.top')).display !== 'none' || (document.body.classList.contains('gm-app') && getComputedStyle(document.querySelector('.gm-bar')).display !== 'none')) && (await G.page.$eval('#display-page', (d) => d.hidden && d.childElementCount === 0)), 'leaving #display: unmounted, the header (or the GM bar) is back');

  /* ---- layouts: the phone at 360 px, the iPad both ways ---- */
  for (const [w, h, name] of [[360, 740, 'phone'], [768, 1024, 'iPad portrait'], [1024, 768, 'iPad landscape']]) {
    const V = await open(GM, '#gm', { width: w, height: h, mobile: true });
    await V.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 20000 });
    const l = await V.page.evaluate(layout);
    check(l.scrollWidth <= l.clientWidth + 1 && !l.wide.length, name + ': no sideways overflow ' + JSON.stringify(l.wide));
    check(!l.small.length, name + ': every visible control is at least 44 px tall ' + JSON.stringify(l.small));
    if (w < 600) {
      check(await V.page.$eval('.gm-segbar', (s) => getComputedStyle(s).display !== 'none'), 'phone: the segmented bar shows');
      const cols = await V.page.$eval('#gm-buttons', (b) => getComputedStyle(b).gridTemplateColumns.split(' ').length);
      check(cols === 2 && (await V.page.$$('#gm-buttons .gm-btn')).length === 4, 'phone: the four situations are a 2 × 2 grid');
      const pr = await V.page.$$eval('#gm-pos [data-gm="pos"]', (bs) => bs.map((b) => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) }; }));
      check(pr.length === 3 && pr.every((r) => r.w >= 90 && r.h >= 44), 'phone: the Position switch is three large buttons ' + JSON.stringify(pr));
      check(pr.every((r) => r.bottom <= h), 'phone: the Position switch is on the first screen (no scrolling) ' + JSON.stringify(pr.map((r) => r.bottom)));
      await V.page.keyboard.press('2'); await V.page.waitForSelector('#gm-card .gm-lead');
      const lt = await V.page.$eval('#gm-card .gm-lead-t', (e) => parseFloat(getComputedStyle(e).fontSize));
      check(lt >= 19, 'phone: the lead line is large (' + lt + 'px)');
      const l2 = await V.page.evaluate(layout);
      check(l2.scrollWidth <= l2.clientWidth + 1 && !l2.wide.length && !l2.small.length, 'phone: with a card showing, no overflow and every control is at least 44 px ' + JSON.stringify([l2.wide, l2.small]));
      await shot(V.page, '03a-phone-situation');
      await V.page.click('#gm-card details.gm-or > summary'); const l3 = await V.page.evaluate(layout);
      check(l3.scrollWidth <= l3.clientWidth + 1 && !l3.wide.length, 'phone: an opened "Or" row does not overflow ' + JSON.stringify(l3.wide));
      await viewClick(V.page, 'classic');
      check(await V.page.$eval('#gm-buttons', (b) => getComputedStyle(b).gridTemplateColumns.split(' ').length) === 3, 'phone: Classic keeps its 3 × 3 grid');
      const l4 = await V.page.evaluate(layout);
      check(l4.scrollWidth <= l4.clientWidth + 1 && !l4.wide.length && !l4.small.length, 'phone: Classic, no overflow and every control is at least 44 px ' + JSON.stringify([l4.wide, l4.small]));
      await viewClick(V.page, 'situations');
      check(await V.page.$eval('#gm-controls', (c) => getComputedStyle(c).display === 'none'), 'phone: the controls fold into the Scene line');
      await V.page.click('[data-gm="seg"][data-seg="state"]');
      check(await V.page.$eval('#gm-rail', (r) => getComputedStyle(r).display !== 'none') && await V.page.$eval('.gm-console', (c) => getComputedStyle(c).display === 'none'), 'phone: State shows the rail alone');
      await V.page.click('.gm-fab');
      check(await V.page.$eval('#gm-foot', (f) => getComputedStyle(f).display !== 'none'), 'phone: the capture button opens the capture bar');
      await shot(V.page, '03-phone');
    }
    await V.ctx.close();
  }

  /* ---- a part that will not download: the page carries on with the copy on this device ---- */
  {
    const pr = await api('POST', '/gm/pack', GM, { part: 'location', src: PACK.parts.location.src, body: { T: PACK.parts.location.T, extra: PACK.parts.location.extra, note: 'changed on the server' } });
    check(pr.status === 200 && pr.json.unchanged !== true, 'server: the location part changed (a new version to fetch)');
    await G.page.route('**/api/gm/pack?part=*', (r) => r.abort());
    await G.page.goto(BASE + '/#gm'); await G.page.reload();
    check(await G.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 20000 }).then(() => true, () => false) && /offline copy/.test(await G.page.textContent('#gm-exp')), 'packPart fails: the console draws from the cached pack, marked offline copy');
    await G.page.unroute('**/api/gm/pack?part=*');
  }

  /* ---- the identity unknown (/api/me fails): nothing is purged; known as a player: purged ---- */
  {
    const U = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': PLAYER }, serviceWorkers: 'block' });
    const up = await U.newPage();
    up.on('pageerror', (e) => errors.push('unknown pageerror: ' + e.message));
    await up.route('**/api/me', (r) => r.abort());
    await up.goto(BASE + '/#');
    await up.evaluate(() => new Promise((res) => { const r = indexedDB.open('b68-gm', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ parts: {} }, 'pack:gm@example.test'); tx.oncomplete = () => { r.result.close(); res(); }; }; }));
    await up.reload(); await sleep(3000);
    const keys = await up.evaluate(() => new Promise((res) => { const r = indexedDB.open('b68-gm'); r.onsuccess = () => { try { const q = r.result.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess = () => res(q.result); } catch (e) { res([]); } }; r.onerror = () => res(null); }));
    check(Array.isArray(keys) && keys.length === 1, '/api/me failing (who is this?): the cached pack is left alone ' + JSON.stringify(keys));
    await U.close();
  }

  /* ---- the display name: "Change name" under the Home greeting ---- */
  {
    const N = await open(GM, '#');
    check(await N.page.waitForSelector('#home .hm-name [data-nm="open"]', { timeout: 20000 }).then(() => true, () => false), 'Home: a "Change name" control under the greeting');
    await N.page.click('[data-nm="open"]');
    check(await N.page.evaluate(() => document.activeElement && document.activeElement.id === 'homeNameIn'), 'Change name: the box opens focused');
    await N.page.fill('#homeNameIn', 'Rex <b>');
    await N.page.click('[data-nm="save"]');
    check(await N.page.waitForFunction(() => /not contain|not allowed|characters|invalid|<|>/i.test((document.getElementById('homeNameErr') || {}).textContent || ''), null, { timeout: 8000 }).then(() => true, () => false), 'Change name: the API\'s message is shown for a refused name: ' + await N.page.textContent('#homeNameErr'));
    check((await api('GET', '/me', GM)).json.name !== 'Rex <b>', 'the refused name was not stored');
    await N.ctx.setOffline(true);
    await N.page.fill('#homeNameIn', 'Rex Invented'); await N.page.click('[data-nm="save"]');
    check(await N.page.waitForFunction(() => /offline/i.test((document.getElementById('homeNameErr') || {}).textContent || ''), null, { timeout: 8000 }).then(() => true, () => false), 'Change name: offline says so and keeps the box open');
    await N.ctx.setOffline(false);
    await N.page.click('[data-nm="save"]');
    check(await N.page.waitForFunction(() => /Rex Invented/.test((document.querySelector('#home .hm-name') || {}).textContent || ''), null, { timeout: 10000 }).then(() => true, () => false), 'Change name: saved, the box closes and shows the new name');
    check((await api('GET', '/me', GM)).json.name === 'Rex Invented', 'server: /api/me carries the chosen name');
    check(await N.page.waitForFunction(() => /Rex Invented/.test((document.getElementById('whoami') || {}).textContent || ''), null, { timeout: 5000 }).then(() => true, () => false), 'the header ("Signed in as") shows the new name without a reload');
    check(await N.page.evaluate(() => window.B68Runtime.me.name === 'Rex Invented'), 'B68Runtime.me.name is current');
    await N.page.click('[data-nm="open"]'); await N.page.click('[data-nm="clear"]');
    check(await N.page.waitForFunction(() => !/Rex Invented/.test((document.querySelector('#home .hm-name') || {}).textContent || '') && !!document.querySelector('#home [data-nm="open"]'), null, { timeout: 10000 }).then(() => true, () => false), 'Clear: back to the sign-in name');
    check((await api('GET', '/me', GM)).json.name !== 'Rex Invented', 'server: the override is cleared');
    await N.page.reload(); await N.page.waitForSelector('#home .hm-name', { timeout: 20000 });
    check(!/Rex Invented/.test(await N.page.textContent('#home .hm-name')), 'after a reload the cleared name stays cleared');
    await N.ctx.close();
  }

  /* ---- a player's sign-in on a browser that holds a GM pack purges it ---- */
  const Q = await open(PLAYER, '#');
  await Q.page.evaluate(() => new Promise((res) => { const r = indexedDB.open('b68-gm', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ parts: {} }, 'pack:gm@example.test'); tx.oncomplete = () => { r.result.close(); res(); }; }; }));
  await Q.page.evaluate(() => localStorage.setItem('b68.gm.sticky', '{"v":1}'));
  await Q.page.reload(); await Q.page.waitForFunction(() => window.B68Runtime && window.B68Runtime.me, null, { timeout: 20000 });
  const left = await until(async () => { const k = await Q.page.evaluate(() => new Promise((res) => { const r = indexedDB.open('b68-gm'); r.onsuccess = () => { try { const q = r.result.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess = () => res(q.result); } catch (e) { res([]); } }; r.onerror = () => res(null); })); return Array.isArray(k) && k.length === 0 ? k : null; }, 8000);
  check(!!left, 'a player signing in: no pack:* key is left in IndexedDB');
  check(await Q.page.evaluate(() => localStorage.getItem('b68.gm.sticky') === null), 'and the sticky copy is gone');

  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  /* an ambient scene may still be loading in the display's frame: closing rejects that navigation, which is not a failure */
  process.on('unhandledRejection', (e) => { if (!(e && e.name === 'TargetClosedError')) { console.log('FAIL ' + (e && e.stack || e)); process.exit(1); } });
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
}
clearTimeout(timeout);
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
