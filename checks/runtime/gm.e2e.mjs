// The GM page (#gm) and the display wiring (#display) end to end against a real local Worker (wrangler dev, DEV_USER) on
// PORT (default 8845), with the migrations applied (the seven seeded NPCs are there) and only invented fixture tables
// (checks/runtime/fixtures/gm/). The GM imports a fixture pack through the page; the console opens on the four Situations
// (keys 1-4, a three-way Position switch, a lead box with "Or" rows, one merged actions row; the nine single tables fold under
// the card, without keys); reloading redraws the same card; capture with P / X / L
// records the session; the Home greeting's "Change name" edits the display name (saved, cleared, the API's 400 message,
// offline); keys stay quiet while typing, the location tab rolls and draws, only a
// player-layer map reaches the display (a GM-layer svg is refused in code), H blanks the screen, an NPC goes to the iPad
// (hidden ones after a confirm), the Downtime panel (D) turns two taps into a card and starts a hidden clock on the table,
// the note downloads; the phone (360 px) and the iPad (both orientations) layouts do not
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
    await c.addInitScript(() => { try { localStorage.setItem('b68.gm.capbar', '1'); } catch (e) { /* the capture bar is off by default; these tests use it */ } });
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

  /* ---- lazy bundles (app/routes.js): Home asks for the core only; the GM's files come with #gm, in order ---- */
  {
    const scripts = (asked) => asked.filter((f) => /\.(js|css)$/.test(f));
    const LAZY = ['gm-page.js', 'gm/console.js', 'gm.css', 'maps/map-kit.js', 'display-page.js', 'stt.js', 'campaign.js', 'crewsheet.js', 'season.js'];
    for (const user of [GM, PLAYER]) {
      const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, serviceWorkers: 'block' });
      const page = await c.newPage(), asked = [];
      page.on('request', (r) => { const u = new URL(r.url()); if (u.origin === BASE) asked.push(u.pathname.slice(1)); });
      page.on('pageerror', (e) => errors.push(user + ' lazy pageerror: ' + e.message));
      await page.goto(BASE + '/#');
      await page.waitForFunction(() => window.B68Runtime && window.B68Runtime.me && document.querySelector('#home'), null, { timeout: 30000 });
      await sleep(1500);
      const who = user === GM ? 'GM' : 'player';
      check(scripts(asked).includes('boot.js') && scripts(asked).includes('routes.js'), who + ' Home: the core loaded (' + scripts(asked).length + ' files)');
      check(!LAZY.some((f) => asked.includes(f)), who + ' Home: no GM, display or table file was fetched: ' + LAZY.filter((f) => asked.includes(f)).join(', '));
      if (user === GM) {
        await page.evaluate(() => { location.hash = '#gm'; });
        check(await page.waitForSelector('#gm-file', { state: 'attached', timeout: 20000 }).then(() => true, () => false), 'GM: #gm fetches its bundle and draws (the import screen: no pack yet)');
        const at = (f) => asked.indexOf(f);
        check(at('gm/console.js') > 0 && at('gm/console.js') < at('gm-page.js') && at('maps/map-kit.js') > 0 && at('gm.css') > 0, 'GM: the bundle came in its order (gm/console.js before gm-page.js), map kit and stylesheet included');
        check(await page.evaluate(() => { const l = [...document.querySelectorAll('link[rel="stylesheet"]')].map((x) => x.getAttribute('href')); return l.indexOf('gm.css') > l.indexOf('cast.css') && !!document.querySelector('link[href="gm.css"] ~ style'); }), 'GM: gm.css went in after cast.css and before the inline style (the cascade index.html had)');
      }
      await c.close();
    }
  }

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
  check(colOrder === 'gm-pos,gm-scenebox,gm-buttons,gm-card,gm-earlier,gm-singles', 'the console column: Position, Scene, the four buttons, the card, Earlier, More tables (' + colOrder + ')');
  check(!(await G.page.$('[data-gm="view"]')) && !(await G.page.$('.gm-head')), 'one console (the four Situations) and one layout: no Situations | Classic toggle, no page heading');
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

  /* ---- the Position switch, the single tables under More tables, a reload ---- */
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
  await G.page.click('#gm-singles [data-gm="roll"][data-n="7"]');
  check(await G.page.$eval('#gm-card article', (a) => a.getAttribute('data-tool')) === 'console' && (await G.page.$$('#gm-earlier [data-gm="replay"]')).length >= 3, 'More tables: another single table rolls (no keys: 5-9 do nothing)');
  await until(async () => { const d = await gmState(); return d.hist && Object.keys(d.hist.console || {}).length >= 2; }, 5000);
  await G.page.reload(); await G.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 20000 });
  check((await G.page.$$('#gm-buttons .gm-btn')).length === 4 && !(await G.page.$('[data-gm="view"]')) && (await G.page.$$('#gm-pos [data-gm="pos"]')).length === 3, 'reload: the four Situations and the Position switch; there is no Classic view to remember');
  check(!!(await G.page.$('#gm-card article[data-tool="console"]')) && await G.page.$eval('#gm-earlier [data-gm="replay"][data-tool="console"]', (c) => !!c), 'reload: the single-table card is back, and Earlier lists it with the situations');
  await shot(G.page, '01b-gm-single-table');
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
  check(await G.page.$eval('#gm-scene', (b) => { const r = b.getBoundingClientRect(); return [...b.querySelectorAll('.gm-chip')].every((c) => c.getBoundingClientRect().bottom <= r.bottom + 1); }), 'with the column overflowing, the Scene line still holds all its chips (no clipped button)');
  await shot(G.page, '01c-gm-situation');

  /* ---- wave 2: the generators' fields on the card: the spend sentence under the lead, the coaching under "Why", the position on the pin ---- */
  {
    await G.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    const sceneOpen = () => G.page.$eval('#gm-root', (r) => r.classList.contains('scene-open'));
    if (!(await sceneOpen())) await G.page.click('#gm-scene');
    await G.page.fill('#gm-c-threat', 'the dog is waking up');
    await until(async () => ((await gmState()).con || {}).live && (await gmState()).con.live.threat === 'the dog is waking up', 5000);
    if (await sceneOpen()) await G.page.click('#gm-scene');
    check(!(await sceneOpen()), 'one tap on the Scene line folds the controls right after typing in Threat (the blur redraws the chips: that tap used to be lost)');
    let spend = '';
    for (let i = 0; i < 6 && !spend; i++) { await G.page.keyboard.press('2'); await G.page.waitForSelector('#gm-card .gm-lead'); spend = await G.page.$eval('#gm-card .gm-lead', (l) => (l.querySelector('.gm-lead-s') || { textContent: '' }).textContent.trim()).catch(() => ''); }
    check(/the dog is waking up/.test(spend), 'a 4/5 with a threat: the spend sentence sits under the lead line (' + spend + ')');
    check(await G.page.$eval('#gm-card .gm-lead', (l) => { const t = l.querySelector('.gm-lead-t').getBoundingClientRect(), s = l.querySelector('.gm-lead-s').getBoundingClientRect(); return s.top >= t.bottom - 1 && s.height > 10; }), 'and it is drawn right under it');
    const whys = await G.page.$$eval('#gm-card details.gm-why', (ds) => ds.map((d) => d.open));
    check(whys.length >= 1 && whys.every((o) => !o), 'the coaching lines are folded under closed "Why" folds (' + whys.length + ')');
    check(await G.page.$eval('#gm-card .gm-lead .gm-more', (m) => !m.open) && !(await G.page.$('#gm-card .gm-lead .gm-more .gm-want')), 'More starts shut, and does not repeat the lead line');
    await G.page.click('#gm-card .gm-lead .gm-more > summary');
    /* a closed <details> keeps its content's layout size in Chromium, so "shown" is checkVisibility() (false while closed) and a real height */
    const whyShown = async () => G.page.$eval('#gm-card .gm-lead .gm-why-b', (b) => b.checkVisibility() && b.getBoundingClientRect().height > 20).catch(() => false);
    check(!(await whyShown()), 'a closed Why shows none of its text');
    await G.page.click('#gm-card .gm-lead .gm-why > summary');
    check(await whyShown(), 'a tap on Why opens the coaching');
    const coachWords = (await G.page.$eval('#gm-card .gm-lead .gm-why-b', (b) => b.textContent.replace(/\s+/g, ' ').trim())).slice(0, 30);
    await G.page.evaluate(() => { document.querySelector('.gm-console').scrollTop = document.querySelector('#gm-card').offsetTop - 70; });
    await sleep(300);
    await shot(G.page, 'wave2-situation-why');
    await G.page.click('#gm-card [data-gm="pin"]');
    const pin = await until(async () => { const d = await gmState(); const p = Object.values(d.pins || {}); return p.length ? p[p.length - 1] : null; }, 5000);
    check(!!pin && coachWords.length > 10 && /^A 4\/5 \(risky → .*harm \d/.test(pin.text.split('\n')[0]) && !pin.text.includes(coachWords), 'Pin: the position chip is on the title line, and the coaching is left out (' + (pin ? pin.text.split('\n')[0] : '') + ')');
    check(await G.page.$eval('#gm-card', (c) => !c.querySelector('.gm-quiet')), 'a current card carries no "redrawn" note');
  }

  /* ---- the location tab and the map ---- */
  await G.page.keyboard.press('b');
  check(await G.page.$eval('#gm-loc', (p) => !p.hidden), 'B shows the Location tab');
  await G.page.click('[data-gm="locroll"]');
  await G.page.waitForSelector('#gm-loc .gm-loccard', { timeout: 10000 });
  check((await G.page.$$('#gm-loc .gm-secret')).length > 0 && !/GM only/i.test(await G.page.textContent('#gm-loc .gm-loccard')) && (await G.page.$$('#gm-loc .gm-badge')).length === 0, 'location: no "GM only" badges (the whole page is GM only); the orange rule stays');
  check((await G.page.$$eval('#gm-loc .gm-gband.shown .gm-seen', (xs) => xs.length)) === 1 && (await G.page.$$eval('#gm-loc .gm-gband:not(.shown) .gm-seen', (xs) => xs.length)) === 0 && (await G.page.$$eval('#gm-loc .gm-lfold[data-fold="band-public"] summary .gm-seen', (xs) => xs.length)) === 1, 'a "Players see" chip marks the public band and its fold, nothing else yet');
  check(!(await G.page.$('#gm-loc .gm-say .gm-seen')), 'the Say box carries no "Players see" chip until it has gone to the iPad');
  {   /* wave 2: the plan under Say (GM only), a Rule row, Flags only the rare ones */
    const gl = await G.page.evaluate((pk) => { const st = window.B68GmPage._state(), g = window.B68GmLocation.glance(st.locRoll, pk, ['public']); return { plan: g.plan, rule: g.rule, flags: g.flags }; }, { T: PACK.parts.location.T, extra: PACK.parts.location.extra });
    check(!!gl.plan && await G.page.$eval('#gm-loc .gm-plan', (p, t) => p.textContent.replace(/\s+/g, ' ').includes(t) && /Plan/.test(p.querySelector('.gm-lab').textContent) && !p.closest('.gm-say'), gl.plan), 'location: a Plan line under Say, outside the Say box: ' + gl.plan);
    check(await G.page.$eval('#gm-loc .gm-glance', (g) => { const say = g.querySelector('.gm-say').getBoundingClientRect(), plan = g.querySelector('.gm-plan').getBoundingClientRect(); return plan.top >= say.bottom - 1; }), 'and it is drawn under the Say box');
    const dts = await G.page.$$eval('#gm-loc .gm-glance-dl dt', (xs) => xs.map((x) => x.textContent));
    check(dts.includes('Rule') === !!gl.rule && dts.includes('Flags') === (gl.flags.length > 0) && !/ring-skip|District rule/.test(await G.page.textContent('#gm-loc .gm-glance')), 'a Rule row when the district has a rule (' + !!gl.rule + '); Flags only the rare ones (' + gl.flags.length + ')');
    await G.page.evaluate(() => { const p = document.querySelector('#gm-loc'); p.scrollTop = 0; document.querySelector('.gm-console').scrollTop = document.querySelector('#gm-card').offsetTop - 70; });
    await G.page.waitForFunction(() => !document.getElementById('toastMsg').textContent && !document.getElementById('toastErr').textContent, null, { timeout: 9000 }).catch(() => {});
    await sleep(200);
    await shot(G.page, 'wave2-location-plan');
  }
  check(await G.page.$eval('[data-gm="ipad"]', (b) => b.disabled), 'map: Show on iPad is off on the GM layer');
  check(!!(await G.page.$('#gm-map svg')) && await G.page.$eval('#gm-map', (m) => m.getAttribute('data-layer') === 'gm') && await G.page.$eval('#gm-m-view', (s) => s.value === 'iso'), 'a roll draws the GM-layer iso map at once');
  check(await G.page.$eval('#gm-m-view', (s) => !!s.closest('details.gm-mapopts') && !s.closest('details').open) && await G.page.$eval('#gm-map', (m) => m.compareDocumentPosition(document.querySelector('.gm-mapopts')) & Node.DOCUMENT_POSITION_FOLLOWING) && await G.page.$eval('.gm-map-ctl [data-gm="draw"]', (b) => !b.closest('details')), 'View and Theme fold under the map; Layer, Reveal and Draw stay above it');
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
  check((await G.page.$$eval('#gm-loc .gm-gband.shown .gm-seen', (xs) => xs.length)) === 2, 'the working band revealed on the player layer: two "Players see" chips');
  await G.page.click('[data-gm="ipad"]');
  const disp = await until(async () => { const d = (await api('GET', '/gm/display', GM)).json; return d.seq > before.seq ? d : null; }, 8000);
  const want = await G.page.evaluate(() => { const st = window.B68GmPage._state(); return window.B68Map.render(st.locRoll, Object.assign({ view: 'iso', theme: 'rulebook', layer: 'player', reveal: ['public', 'working'] }, window.B68GmPage._pure.IPAD_MAP)).svg; });
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
  check(await G.page.waitForSelector('#gm-loc .gm-say .gm-seen', { timeout: 5000 }).then(() => true, () => false), 'once sent, the Say box carries the "Players see" chip');
  // a new roll starts again from public only
  await G.page.click('[data-gm="locroll"]'); await G.page.waitForSelector('#gm-loc .gm-loccard');
  const rv = await until(async () => { const d = await gmState(); return d.loc && d.loc.map && d.loc.map.reveal && d.loc.map.reveal.working === false ? d.loc.map.reveal : null; }, 5000);
  check(!!rv && !(await G.page.isChecked('[data-reveal="working"]')) && await G.page.isVisible('[data-reveal="working"]'), 'a new roll resets the reveal to public only (the ticks stay visible)');
  await shot(G.page, '02-gm-location');

  /* ---- Now in (A7): one district in the bar; the pickers follow it; a pick of their own wins; a stored card never moves ---- */
  {
    const optText = (sel) => G.page.$eval(sel + ' option', (o) => o.textContent);
    const stateNow = gmState;
    const opts = await G.page.$$eval('#gm-now option', (os) => os.map((o) => o.value));
    check(opts[0] === '' && new Set(opts).size === opts.length && opts.includes('Puddleton') && opts.includes('Dockside Test') && await G.page.$eval('#gm-now', (s) => s.getBoundingClientRect().height > 0 && s.value === ''), 'Now in: a select in the bar, on anywhere, listing the console’s and the location tool’s districts once each (' + opts.length + ')');
    check(await G.page.$eval('#gm-now-s', (s) => getComputedStyle(s.closest('.gm-nowline')).display === 'none') && await G.page.$eval('#gm-now', (s) => s.getBoundingClientRect().right <= innerWidth), 'Now in: the Scene-line copy is for the phone only; the bar’s fits the laptop');
    check(await optText('#gm-l-district') === 'Now in: anywhere' && await optText('#gm-c-district') === 'Now in: anywhere', 'the Location and console District pickers lead with "Now in: anywhere"');
    await G.page.selectOption('#gm-now', 'Dockside Test');
    check(!!(await until(async () => { const d = await stateNow(); return d.now && d.now.district === 'Dockside Test'; }, 5000)), 'Now in: kept in the GM state (now.district)');
    check(await G.page.$eval('#gm-l-district', (s) => s.value === '' && s.options[0].textContent === 'Now in: Dockside Test') && /^Now in: any \(no Dockside Test here\)$/.test(await optText('#gm-c-district')), 'the Location picker follows it; the console, whose list lacks it, says so and stays on any');
    await G.page.click('[data-gm="locroll"]'); await G.page.waitForSelector('#gm-loc .gm-loccard');
    let st = await until(async () => { const x = await stateNow(); return x.cards && x.cards.location && x.cards.location.ui && x.cards.location.ui.district === 'Dockside Test' ? x : null; }, 5000);
    check(!!st && /Dockside Test/.test(await G.page.textContent('#gm-loc .gm-glance-place')), 'a location roll uses it, and stores the district in the roll’s own ui');
    const first = st ? { hid: st.cards.location.hid, place: await G.page.textContent('#gm-loc .gm-glance-place') } : null;
    await G.page.selectOption('#gm-now', 'Quietside Test');
    check((await G.page.textContent('#gm-loc .gm-glance-place')) === (first && first.place), 'Now in changed: the location card on screen does not move');
    await G.page.click('[data-gm="locroll"]'); await G.page.waitForFunction((p) => document.querySelector('#gm-loc .gm-glance-place').textContent !== p, first && first.place, { timeout: 5000 });
    st = await until(async () => { const x = await stateNow(); return x.cards.location.ui.district === 'Quietside Test' ? x : null; }, 5000);
    check(!!st && /Quietside Test/.test(await G.page.textContent('#gm-loc .gm-glance-place')), 'the next roll uses the new Now in');
    await G.page.click('#gm-loc .gm-earlier [data-gm="replay"][data-h="' + (first && first.hid) + '"]');
    check((await G.page.textContent('#gm-loc .gm-glance-place')) === (first && first.place) && !!(await until(async () => (await stateNow()).cards.location.ui.district === 'Dockside Test', 5000)), 'Earlier: the older location card comes back exactly as rolled, whatever Now in is');
    /* a pick of its own wins, through a change of Now in; the first choice gives it back */
    await G.page.selectOption('#gm-l-district', 'Hightown Test');
    await G.page.click('[data-gm="locroll"]');
    check(!!(await until(async () => { const x = await stateNow(); return x.cards.location.ui.district === 'Hightown Test' && x.loc.ui.district === 'Hightown Test' ? x : null; }, 5000)), 'the Location picker’s own pick wins over Now in (Quietside Test)');
    await G.page.selectOption('#gm-now', 'Lowmarsh Test');
    check(await G.page.$eval('#gm-l-district', (s) => s.value === 'Hightown Test') && await G.page.$eval('#gm-l-district', (s) => s.options[0].textContent === 'Now in: Lowmarsh Test'), 'Now in changed: the pick stays, and the picker’s first choice names the new Now in');
    await G.page.selectOption('#gm-l-district', ''); await G.page.click('[data-gm="locroll"]');
    check(!!(await until(async () => { const x = await stateNow(); return x.cards.location.ui.district === 'Lowmarsh Test' && x.loc.ui.district === '' ? x : null; }, 5000)), 'the first choice ("Now in: …") gives the tool back to Now in');
    await G.page.selectOption('#gm-l-district', '*'); await G.page.selectOption('#gm-now', 'Dockside Test'); await G.page.click('[data-gm="locroll"]');
    check(!!(await until(async () => { const x = await stateNow(); return x.cards.location.ui.district === '' && x.loc.ui.district === '*' ? x : null; }, 5000)), '"any" is a pick too: the tool rolls on any whatever Now in says, and no "*" reaches the roll');
    await G.page.selectOption('#gm-l-district', '');
    /* the console: the same default, an own pick, a replay that does not move */
    await G.page.selectOption('#gm-now', 'Puddleton');
    check(/District: Puddleton/.test(await G.page.textContent('#gm-scene-chips')) && /^Now in: Puddleton$/.test(await optText('#gm-c-district')), 'the console’s Scene line and picker follow Now in (Puddleton)');
    await G.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await G.page.keyboard.press('3'); await G.page.waitForSelector('#gm-card .gm-lead');
    const cardA = await cardText(G.page);
    check(!!(await until(async () => { const x = await stateNow(); return x.cards.situation.ui.district === 'Puddleton'; }, 5000)), 'a console roll stores Puddleton in its own ui');
    await G.page.selectOption('#gm-now', 'Crumbhall');
    check((await cardText(G.page)) === cardA && /District: Crumbhall/.test(await G.page.textContent('#gm-scene-chips')), 'Now in changed: the card on screen stays, the Scene line shows what the next roll uses');
    await G.page.keyboard.press('3'); await sleep(300);
    check(!!(await until(async () => { const x = await stateNow(); return x.cards.situation.ui.district === 'Crumbhall'; }, 5000)), 'the next console roll uses Crumbhall');
    const olders = await G.page.$$('#gm-earlier [data-gm="replay"][data-tool="situation"]');
    await olders[1].click();
    check((await cardText(G.page)) === cardA, 'Earlier: the older console card, exactly as it was');
    const sceneShut = () => G.page.$eval('#gm-controls', (c) => getComputedStyle(c).display === 'none');
    if (await sceneShut()) await G.page.click('#gm-scene');
    await G.page.selectOption('#gm-c-district', 'Muddle End');
    await G.page.selectOption('#gm-now', 'Puddleton');
    await G.page.keyboard.press('3'); await sleep(300);
    check(!!(await until(async () => { const x = await stateNow(); return x.cards.situation.ui.district === 'Muddle End' && x.con.live.district === 'Muddle End'; }, 5000)) && /District: Muddle End/.test(await G.page.textContent('#gm-scene-chips')), 'the console’s own pick wins (Muddle End), and its chip says so');
    await G.page.selectOption('#gm-c-district', '');
    if (!(await sceneShut())) await G.page.click('#gm-scene');
    await G.page.reload(); await G.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 20000 });
    check(await G.page.$eval('#gm-now', (s) => s.value === 'Puddleton') && await G.page.$eval('#gm-now-s', (s) => s.value === 'Puddleton'), 'reload: Now in is still Puddleton (the GM state), in both selects');
    await G.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await G.page.keyboard.press('3'); await sleep(700);
    await shot(G.page, '01d-gm-now-in');
    await G.page.selectOption('#gm-now', '');
    check(!!(await until(async () => { const x = await stateNow(); return x.now && x.now.district === ''; }, 5000)) && await optText('#gm-l-district') === 'Now in: anywhere', 'Now in: back to anywhere, and the pickers say so');
    await G.page.keyboard.press('b');
  }

  /* ---- the NPC tab: the cast, Show on iPad for a hidden one after a confirm ---- */
  await G.page.keyboard.press('n');
  check(await G.page.waitForFunction(() => document.querySelectorAll('#gm-npc .gm-npcrow').length === 7, null, { timeout: 15000 }).then(() => true, () => false), 'N: the NPC tab lists the seven seeded NPCs');
  check(!/coming/.test(await G.page.textContent('#gm-npc')) && /The pack has no npc part/.test(await G.page.textContent('#gm-npcgen')), 'NPC: the generator panel is there, and says so when the pack has no npc part (its own check: gm-npc-panel.e2e.mjs)');
  await G.page.click('#gm-npc .gm-npcrow[data-id="npc_mira"] [data-gm="npcipad"]');      // hidden: the confirm is accepted
  check(await until(async () => { const d = (await api('GET', '/gm/display', GM)).json.display; return d.kind === 'npc' && d.npcId === 'npc_mira'; }, 5000), 'Show on iPad (after the confirm): the display shows the NPC');
  /* Put on stage stages the NPC from here (a hidden one is revealed first, after the confirm); the rail's On stage box is the feedback */
  check(!!(await G.page.$('#gm-npc .gm-npcrow[data-id="npc_mira"] [data-gm="npcstage"]')) && (await G.page.getAttribute('#gm-npc .gm-npcrow[data-id="npc_mira"] a[href="#cast/npc_mira"]', 'href')) === '#cast/npc_mira', 'Put on stage is a button here, with a small link to the cast');
  await G.page.click('#gm-npc .gm-npcrow[data-id="npc_mira"] [data-gm="npcstage"]');
  const staged = await until(async () => { const d = (await api('GET', '/campaign', GM)).json.doc; return d && d.scene && d.scene.npcs && d.scene.npcs.npc_mira === true ? d.scene : null; }, 8000);
  check(!!staged && typeof staged.at === 'string', 'Put on stage: campaign.scene.npcs.npc_mira is true, with the time');
  check((await api('GET', '/npcs', GM)).json.docs.some((d) => d.id === 'npc_mira' && d.doc.revealed === true && !!d.doc.firstSeen), 'and the hidden NPC was revealed first (firstSeen set)');
  check(await G.page.waitForFunction(() => /Mira/.test((document.querySelector('#gm-rail') || {}).textContent || '') && !/Nobody: the cast/.test(document.querySelector('#gm-rail').textContent), null, { timeout: 8000 }).then(() => true, () => false) && G.page.url().endsWith('#gm'), 'the rail’s On stage box shows Mira, and the page did not leave #gm');

  /* ---- Downtime (D): two invented PCs filed through the API reach the panel, and an invented downtime part (the morning tables, and a
          Gambling hook with a clock) pushed as gm:push does; two taps (the PC, Overindulged) give a card with the d100 box on screen; the
          d100 deals two cards from one band and keeps the scene and the seed; Keep folds the other; Start a clock puts a hidden danger
          clock on the table ---- */
  {
    const spec = await G.page.evaluate(() => window.B68.BASE_FIGURE);
    const pc = (name, play) => ({ v: 2, name, alias: '', code: '', playbook: 'hound', playbookName: 'Hound', spec, sheet: { name }, play });
    const put1 = await api('PUT', '/characters/dt-mags', GM, pc('Mags Invented', { vice: 'Gambling', purveyor: 'Old Mo, Mo’s Bar',
      contacts: [{ name: 'Nim', role: 'a dock boss', kind: 'rival' }, { name: 'Ada', role: 'a nurse', kind: 'friend' }], clocks: [{ name: 'Learn the code', size: 8, filled: 3 }] }));
    const put2 = await api('PUT', '/characters/dt-rook', GM, pc('Rook Invented', { vice: 'Weird', purveyor: '', contacts: [], clocks: [] }));
    check(put1.status === 200 && put2.status === 200, 'two invented PCs are filed');
    const e = (lo, hi, band, title, md, play) => ({ lo, hi, band, title, md, play });
    const DT_T = {
      benefit: [e(1, 50, '01–50 · Small', 'The biscuit', 'A baker hands you a biscuit. *"Mind the crumbs."* **Nothing much.**', 'who baked it?'),
        e(51, 100, '51–00 · Big', 'The medal', 'A clerk pins a medal on you. *"For services."* **Standing.**', 'what services?')],
      mishap: [e(1, 60, '01–80 · Bad', 'The cell', 'You wake in a cell. *"Talk."* **Attract Trouble: a questioning.**', 'talk, or not?'),
        e(61, 80, '01–80 · Bad', 'The song', 'A busker sings about you. *"Here they are!"* **Brag: +2 Heat.**', 'take a bow?'),
        e(81, 100, '81–00 · Silly', 'The door', '{Host} shuts the door. *"Not tonight."* **Tapped.**', 'who got there first?')],
      vice: { Gambling: { hook: ['A debt comes due at {place}. || The debt at {place} (4)'] } }
    };
    check((await api('POST', '/gm/pack', GM, { part: 'downtime', src: { exportedAt: new Date().toISOString() }, body: { v: 2, T: DT_T } })).status === 200, 'an invented downtime part is stored');
    await G.page.reload(); await G.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 20000 });
    await G.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await G.page.keyboard.press('d');
    check(await G.page.$eval('#gm-dt', (p) => !p.hidden && /Downtime · personal business/.test(p.querySelector('.gm-band').textContent)), 'D opens the Downtime panel');
    check(await G.page.$eval('.gm-tabs', (t) => t.scrollWidth <= t.clientWidth + 1 && [...t.querySelectorAll('.gm-tab')].every((x) => x.getBoundingClientRect().right <= t.getBoundingClientRect().right + 1 && !!x.querySelector('kbd'))), 'the ten side tabs fit one row at 1280 px, each with its key');
    check(await G.page.waitForSelector('#gm-dt [data-gm="dt-who"][data-id="dt-mags"]', { timeout: 15000 }).then(() => true, () => false), 'the PCs filed a moment ago appear as chips (the characters snapshot reaches the open panel)');
    await G.page.click('#gm-dt [data-gm="dt-who"][data-id="dt-mags"]');
    check(await G.page.$eval('#gm-dt-vice', (s) => s.value) === 'Gambling' && await G.page.$eval('#gm-dt-purveyor', (i) => i.value) === 'Old Mo, Mo’s Bar', 'picking the PC prefills the vice and purveyor from their sheet');
    await G.page.click('#gm-dt [data-gm="dt-roll"][data-v="over"]');
    await G.page.waitForSelector('#gm-dt-d100', { timeout: 5000 }); await sleep(700);   // the smooth scroll
    check(await G.page.$eval('#gm-dt .gm-dt-morning', (c) => { const r = c.getBoundingClientRect(), p = document.getElementById('gm-dt').getBoundingClientRect(); return r.height > 20 && r.top >= p.top - 1 && r.bottom <= p.bottom + 1 && !!c.previousElementSibling && c.previousElementSibling.classList.contains('gm-want'); }), 'two taps from "Mags overindulged": the card is drawn and its d100 box is on screen, right under the scene');
    check(await G.page.$eval('#gm-dt .gm-dt-mh', (h) => /Mishaps/.test(h.textContent) && getComputedStyle(h.querySelector('.gm-lab')).color !== getComputedStyle(document.querySelector('#gm-dt .gm-dtcard h3')).color), 'the Mishaps heading has a colour of its own');
    const st1 = await until(async () => { const d = await gmState(); return d.cards && d.cards.downtime && d.cards.downtime.ui.res === 'over' ? d.cards.downtime : null; }, 5000);
    check(!!st1 && st1.ui.who === 'Mags Invented' && st1.ui.purveyor === 'Old Mo, Mo’s Bar' && st1.ui.d100 === '' && typeof st1.mem === 'string' && Number.isInteger(st1.seed), 'state: the card is replay info with the resolved strings');
    const lead = await G.page.textContent('#gm-dt .gm-dtcard .gm-want');
    await G.page.fill('#gm-dt-d100', '73'); await G.page.keyboard.press('Enter');
    const st2 = await until(async () => { const d = await gmState(); return d.cards.downtime.ui.d100 === '73' ? d.cards.downtime : null; }, 5000);
    check(!!st2 && st2.seed === st1.seed && st2.hid === st1.hid && st2.mem === st1.mem && (await G.page.textContent('#gm-dt .gm-dtcard .gm-want')) === lead, 'the d100 (typed, then Enter): the same card (seed, memory, the scene above)');
    const cards = await G.page.$$eval('#gm-dt .gm-dt-mcard', (cs) => cs.map((c) => [c.getAttribute('data-which'), c.querySelector('.gm-dt-mt b').textContent]));
    check(JSON.stringify(cards) === JSON.stringify([['roll', 'The song'], ['alt', 'The cell']]), '73 lands on The song, and the second card is the other in its band: ' + JSON.stringify(cards));
    check(/\+2 heat/.test(await G.page.textContent('#gm-dt .gm-dt-mcard[data-which="roll"] .gm-dt-mcost')), 'the cost under it: the book\'s line, in our words');
    /* a three-card table keeps one in its guard (the window is half the table): the second card dealt */
    check(!!(await until(async () => { const d = await gmState(); return d.mem && d.mem.downtime && JSON.stringify(d.mem.downtime['morning.mishap']) === '[0]'; }, 5000)), 'the cards dealt went into the repeat guard');
    await G.page.click('#gm-dt [data-gm="dt-keep"][data-v="alt"]');
    check(!!(await until(async () => { const d = await gmState(); return d.cards.downtime.ui.keep === 'alt'; }, 5000)) && await G.page.$eval('#gm-dt .gm-dt-mcard[data-which="roll"]', (c) => c.classList.contains('gm-dt-off') && c.getBoundingClientRect().height < 110), 'Keep the second card: the first folds to its title');
    const clockLabel = await G.page.$eval('#gm-dt [data-gm="dt-clock"][data-i="0"]', (b) => b.textContent);
    const clockName = (/^Start a clock: (.*) \(\d+\)$/.exec(clockLabel) || [])[1];
    await G.page.click('#gm-dt [data-gm="dt-clock"][data-i="0"]');
    const tc = await until(async () => { const d = (await api('GET', '/campaign', GM)).json.doc; return (d.clocks || []).find((c) => c.name === clockName) || null; }, 8000);
    check(clockName === 'The debt at Mo’s Bar' && !!tc && tc.hidden === true && tc.kind === 'danger' && tc.size === 4 && tc.filled === 0 && /^c_/.test(tc.id), 'Start a clock: a hidden danger clock on the table: ' + clockName);
    check(await G.page.waitForFunction((n) => /Clock started, hidden from the players/.test(document.getElementById('toastMsg').textContent) && [...document.querySelectorAll('#gm-rail .gm-clocks li')].some((li) => li.textContent.includes(n) && /hidden from players/.test(li.textContent)), clockName, { timeout: 8000 }).then(() => true, () => false), 'a toast says so, and the rail\'s Table clocks shows it, hidden');
    check(await G.page.$eval('#gm-dt [data-gm="dt-clock"][data-i="0"]', (b) => b.disabled && /^Clock started: /.test(b.textContent)), 'the button is done for this card');
    await shot(G.page, 'downtime-laptop');
    await G.page.reload(); await G.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 20000 });
    await G.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await G.page.keyboard.press('d');
    check(await G.page.waitForSelector('#gm-dt .gm-dt-kept', { timeout: 10000 }).then(() => true, () => false) && (await G.page.textContent('#gm-dt .gm-dtcard .gm-want')) === lead && await G.page.$eval('#gm-dt [data-gm="dt-clock"][data-i="0"]', (b) => b.disabled), 'reload: the same card, the card kept, its clock still started');
    await G.page.click('#gm-dt [data-gm="dt-act"][data-v="recover"]'); await G.page.click('#gm-dt [data-gm="dt-roll"][data-v="45"]');
    await G.page.waitForFunction(() => /Recover/.test(document.querySelector('#gm-dt .gm-dtcard h3').textContent));
    await G.page.click('#gm-dt .gm-earlier [data-gm="replay"]:not([aria-current])');
    check(await G.page.waitForFunction((l) => document.querySelector('#gm-dt .gm-dtcard .gm-want') && document.querySelector('#gm-dt .gm-dtcard .gm-want').textContent === l && !!document.querySelector('#gm-dt .gm-dt-kept'), lead, { timeout: 5000 }).then(() => true, () => false), 'Earlier brings the overindulgence back as it was left');
    await G.page.click('#gm-dt [data-gm="dt-act"][data-v="indulge"]');
    await G.page.keyboard.press('b');
  }

  /* ---- a stray H does nothing; H twice within a second, or Shift+H, blanks the screen; any key brings it back ---- */
  await G.page.keyboard.press('h'); await sleep(1200);
  check(!(await G.page.$('.gm-blank')), 'one H alone does not blank the laptop');
  await G.page.keyboard.press('h'); await G.page.keyboard.press('h');
  check(await G.page.$eval('.gm-blank', (b) => getComputedStyle(b).position === 'fixed').catch(() => false), 'H twice: a black screen');
  await G.page.keyboard.press('q');
  check(!(await G.page.$('.gm-blank')), 'any key restores the page');
  await G.page.keyboard.press('Shift+H');
  check(await G.page.$eval('.gm-blank', (b) => getComputedStyle(b).position === 'fixed').catch(() => false), 'Shift+H: a black screen at once');
  await G.page.keyboard.press('q');
  check(!(await G.page.$('.gm-blank')), 'and any key restores it');

  /* ---- Export tonight's note ---- */
  check(!(await G.page.$('.gm-capacts [data-gm="note"]')) && !(await G.page.$('.gm-capacts [data-gm="clearcap"]')), 'the capture bar keeps buckets, the input, File, the count and File last roll (Export and Clear are in the Menu)');
  await G.page.click('[data-gm="menu"]');
  const [dl] = await Promise.all([G.page.waitForEvent('download', { timeout: 10000 }), G.page.click('.gm-menu-list [data-gm="note"]')]);
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
    /* every width: the site header gives way to the GM bar while the tools are open; the admin buttons and the display link are in the Menu */
    check(await V.page.$eval('header.top', (h) => getComputedStyle(h).display === 'none') && !(await V.page.$('.gm-head')), name + ': no site header and no "The console" header while the tools are open');
    const bar = await V.page.$eval('.gm-bar', (b) => { const r = b.getBoundingClientRect(); return { top: Math.round(r.top), h: Math.round(r.height), pos: getComputedStyle(b).position }; });
    check(bar.top === 0 && bar.h >= 44 && (w >= 600 || bar.h === 44) && bar.pos === 'sticky', name + ': a sticky bar at the top ' + JSON.stringify(bar));
    await V.page.click('[data-gm="menu"]');
    check(await V.page.$eval('.gm-menu-list', (m) => !m.hidden && m.getBoundingClientRect().right <= innerWidth + 1) && (await V.page.$$eval('.gm-menu-list [data-gm]', (xs) => xs.map((x) => x.getAttribute('data-gm')))).join().includes('note,clearcap,update') && !!(await V.page.$('.gm-menu-list a[href="#display"]')), name + ': the Menu holds the display page, the note, the capture, the pack, Forget');
    await V.page.click('[data-gm="menu"]');
    if (w < 600) {
      check(await V.page.$eval('.gm-segbar', (s) => getComputedStyle(s).display !== 'none'), 'phone: the segmented bar shows');
      const segs = await V.page.$$eval('.gm-segbar .chip', (c) => c.map((x) => { const r = x.getBoundingClientRect(); return { seg: x.getAttribute('data-seg'), top: Math.round(r.top), right: Math.round(r.right) }; }));
      const segTop = await V.page.$eval('.gm-segbar', (s) => Math.round(s.getBoundingClientRect().top));
      const rowsOf = segs.reduce((m, s) => { m[s.top] = (m[s.top] || 0) + 1; return m; }, {});
      check(segs.length === 12 && JSON.stringify(Object.values(rowsOf)) === '[6,6]' && segs.every((s) => s.right <= w) && segTop === 44, 'phone: twelve segments in two rows of six under the bar, none off screen ' + JSON.stringify([segTop, rowsOf, segs.map((s) => s.right)]));
      /* the label's own text box inside the segment's box (scrollWidth overstates on these inline-flex chips, and text-overflow does
         not reach the text inside them, so a cut label would show no ellipsis) */
      check(await V.page.$$eval('.gm-segbar .chip', (c) => c.every((x) => { const rg = document.createRange(); rg.selectNodeContents(x); const t = rg.getBoundingClientRect(), b = x.getBoundingClientRect(), s = getComputedStyle(x); return t.width > 0 && t.left >= b.left + parseFloat(s.borderLeftWidth) - 0.5 && t.right <= b.right - parseFloat(s.borderRightWidth) + 0.5 && b.height >= 40; })), 'phone: every segment label shows whole, each 40 px or taller');
      check(await V.page.$eval('#gm-bar-ipad', (p) => getComputedStyle(p).display !== 'none') && await V.page.$eval('#gm-bar-stt', (p) => getComputedStyle(p).display === 'none'), 'phone: the bar shows the iPad pill (no Listening pill while the transcriber was never set up)');
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
      check(await V.page.$eval('#gm-controls', (c) => getComputedStyle(c).display === 'none'), 'phone: the controls fold into the Scene line');
      check(await V.page.$eval('#gm-now-s', (sel) => { const r = sel.getBoundingClientRect(); return r.height >= 44 && r.right <= innerWidth && getComputedStyle(sel.closest('.gm-nowline')).display !== 'none'; }) && await V.page.$eval('#gm-now', (sel) => getComputedStyle(sel.closest('.gm-now')).display === 'none'), 'phone: Now in is a select in the Scene line (the bar keeps the session and the iPad)');
      await V.page.selectOption('#gm-now-s', 'Puddleton');
      check(await V.page.$eval('#gm-now', (sel) => sel.value === 'Puddleton') && /District: Puddleton/.test(await V.page.textContent('#gm-scene-chips')) && !!(await until(async () => { const d = await gmState(); return d.now && d.now.district === 'Puddleton'; }, 5000)), 'phone: choosing it there sets Now in (the bar’s copy follows, the Scene line shows the district)');
      await V.page.selectOption('#gm-now-s', '');
      /* the Downtime segment: the PC and the two vice buttons on the first screen (clear of the Capture button), the card's d100 box on
         screen after the tap, then the two cards; nothing too wide or too small (taps, not clicks: a touch screen) */
      await V.page.tap('[data-gm="seg"][data-seg="downtime"]'); await V.page.evaluate(() => scrollTo(0, 0));
      check(await V.page.waitForSelector('#gm-dt [data-gm="dt-who"][data-id="dt-mags"]', { timeout: 10000 }).then(() => true, () => false), 'phone: the Downtime segment shows the panel with the PCs');
      await V.page.tap('#gm-dt [data-gm="dt-who"][data-id="dt-mags"]');
      if (await V.page.$eval('#gm-dt [data-gm="dt-act"][data-v="indulge"]', (b) => b.getAttribute('aria-pressed') !== 'true')) await V.page.tap('#gm-dt [data-gm="dt-act"][data-v="indulge"]');
      /* how the vice roll went (Indulged · Overindulged) is the tap every indulgence needs: both on the first screen, clear of the Capture
         button (above it, or beside it) */
      const rb = await V.page.$$eval('#gm-dt [data-gm="dt-roll"][data-k="res"]', (bs) => { const f = document.querySelector('.gm-fab').getBoundingClientRect(); return { n: bs.length, v: bs.map((b) => b.getAttribute('data-v')).join(), bottom: Math.round(Math.max(...bs.map((b) => b.getBoundingClientRect().bottom))), right: Math.round(Math.max(...bs.map((b) => b.getBoundingClientRect().right))), fab: Math.round(f.top), fabLeft: Math.round(f.left), ih: innerHeight }; });
      check(rb.n === 2 && rb.v === 'in,over' && rb.bottom <= rb.ih && (rb.bottom <= rb.fab || rb.right <= rb.fabLeft), 'phone: after the PC, Indulged and Overindulged are on the first screen, clear of the Capture button ' + JSON.stringify(rb));
      const ld = await V.page.evaluate(layout);
      check(ld.scrollWidth <= ld.clientWidth + 1 && !ld.wide.length && !ld.small.length, 'phone Downtime: no overflow and every control is at least 44 px ' + JSON.stringify([ld.wide, ld.small]));
      await V.page.tap('#gm-dt [data-gm="dt-roll"][data-v="over"]'); await V.page.waitForSelector('#gm-dt-d100'); await sleep(800);
      const cv = await V.page.$eval('#gm-dt .gm-dt-d100row', (c) => { const r = c.getBoundingClientRect(), f = document.querySelector('.gm-fab').getBoundingClientRect(), seg = document.querySelector('.gm-segbar').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), bars: Math.round(seg.bottom), fab: Math.round(f.top) }; });
      check(cv.top >= cv.bars && cv.bottom <= cv.fab, 'phone: after the tap the d100 box is on screen, under the bars and above the Capture button ' + JSON.stringify(cv));
      await V.page.tap('#gm-dt-d100'); await V.page.keyboard.type('45'); await V.page.tap('#gm-dt [data-gm="dt-d100"]');
      await V.page.waitForSelector('#gm-dt .gm-dt-mcard'); await sleep(800);
      const mc = await V.page.$eval('#gm-dt .gm-dt-mcard', (c) => { const r = c.getBoundingClientRect(), seg = document.querySelector('.gm-segbar').getBoundingClientRect(); return { top: Math.round(r.top), bars: Math.round(seg.bottom), ih: innerHeight, n: document.querySelectorAll('#gm-dt .gm-dt-mcard').length }; });
      check(mc.n === 2 && mc.top >= mc.bars && mc.top < mc.ih, 'phone: the d100 deals two cards, the first on screen under the bars ' + JSON.stringify(mc));
      const ld2 = await V.page.evaluate(layout);
      check(ld2.scrollWidth <= ld2.clientWidth + 1 && !ld2.wide.length && !ld2.small.length, 'phone: with the downtime card showing, no overflow and every control is at least 44 px ' + JSON.stringify([ld2.wide, ld2.small]));
      await shot(V.page, '03b-phone-downtime');
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
    check(await G.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 20000 }).then(() => true, () => false) && /offline copy/.test(await G.page.textContent('#gm-menu-exp')), 'packPart fails: the console draws from the cached pack, marked offline copy');
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

  /* ---- E5: the Access session ends mid-session: the saver holds, the bar says so, the notes are kept and resent once after a reload ---- */
  {
    const SO = 'Signed out: reload to sign in. Your notes are kept on this device.';
    const S5 = await open(GM, '#gm');
    await S5.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 20000 });
    await S5.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    let hits = 0;
    await S5.page.route('**/api/gm/state', (r) => { if (r.request().method() !== 'PATCH') return r.continue(); hits++; return r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized', reason: 'expired' }) }); });
    await S5.page.keyboard.press('3');
    await S5.page.waitForSelector('#gm-card .gm-lead');
    check(await S5.page.waitForFunction((m) => { const b = document.getElementById('gm-signed'); return b && !b.hidden && b.textContent === m && getComputedStyle(b).display !== 'none'; }, SO, { timeout: 8000 }).then(() => true, () => false), 'signed out mid-session: the bar says "' + SO + '"');
    check(await S5.page.$eval('.gm-save', (s) => s.textContent === 'Signed out' && s.classList.contains('bad')) && await S5.page.$eval('.gm-bar', (b) => b.classList.contains('out') && b.getBoundingClientRect().bottom <= 120), 'and the bar\'s status reads Signed out, the message on a second row of the bar');
    await S5.page.keyboard.press('2'); await S5.page.waitForSelector('#gm-card .gm-lead');
    const card2 = (await S5.page.textContent('#gm-card')).replace(/\s+/g, ' ');
    await S5.page.keyboard.press('p'); await S5.page.keyboard.type('Written while signed out'); await S5.page.keyboard.press('Enter'); await S5.page.keyboard.press('Escape');
    await sleep(1500);
    check(hits === 1, 'only the first request met the 401: later changes are held, not sent (' + hits + ')');
    const sticky5 = await S5.page.evaluate(() => JSON.parse(localStorage.getItem('b68.gm.sticky')));
    check(!!sticky5.pending && !!sticky5.pending.cards && !!sticky5.pending.cards.situation && Object.values(sticky5.pending.capture || {}).some((e) => e.text === 'Written while signed out') && !sticky5.parked, 'the notes wait on this device as pending (the cards and the capture line), not as a refused patch');
    check(!Object.values((await gmState()).capture || {}).some((e) => e.text === 'Written while signed out'), 'the server has not seen them');
    check(/Written while signed out/.test(await S5.page.textContent('#gm-foot')) || /1 filed/.test(await S5.page.textContent('#gm-foot')), 'the page still files it (the capture bar counts it)');
    await shot(S5.page, 'wave2-signed-out');
    await S5.page.unroute('**/api/gm/state');
    await S5.page.reload(); await S5.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 20000 });
    const sent5 = await until(async () => { const d = await gmState(); return Object.values(d.capture || {}).some((e) => e.text === 'Written while signed out') && d.cards.situation && d.cards.situation.hid === sticky5.pending.cards.situation.hid ? d : null; }, 8000);
    check(!!sent5, 'after a reload the pending copy goes up once: the line and the card are on the server');
    check(await S5.page.$eval('#gm-signed', (b) => b.hidden) && (await S5.page.textContent('#gm-card')).replace(/\s+/g, ' ') === card2, 'the bar is quiet again and the page shows the card rolled while signed out');
    await sleep(1200);
    check(await S5.page.evaluate(() => JSON.parse(localStorage.getItem('b68.gm.sticky')).pending === undefined), 'the sticky copy no longer holds it');
    check(Object.values((await gmState()).capture || {}).filter((e) => e.text === 'Written while signed out').length === 1, 'and it was filed once, not twice');
    await S5.ctx.close();
  }

  /* ---- E18: capture is budgeted by bytes: earlier sessions' oldest lines make room, one toast says so; a session that alone fills the budget
          files no more text; a roll is never refused ---- */
  {
    const lines = (session, n, from) => { const m = {}; for (let i = 0; i < n; i++) { const id = 's' + session + '_' + i; m[id] = { id, bucket: 'm', text: ('Line ' + id + ' ').padEnd(470, 'x'), at: new Date(Date.UTC(2026, 8, 1) + (from + i) * 60000).toISOString(), s: session }; } return m; };
    const capBytes = (c) => Buffer.byteLength(JSON.stringify(c));
    const toastErr = (E, re) => E.page.waitForFunction((src) => new RegExp(src).test(document.getElementById('toastErr').textContent), re.source, { timeout: 8000 }).then(() => true, () => false);
    const mine = Object.values((await gmState()).capture || {}).filter((e) => e.s === 4).length;
    check((await api('PATCH', '/gm/state', GM, { capture: lines(3, 300, 0) })).status === 200 && capBytes((await gmState()).capture) > 160 * 1024, 'server: 300 capture lines from session 3 (over 160 KiB) are stored beside this session\'s ' + mine);
    const E = await open(GM, '#gm');
    await E.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 20000 });
    await E.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await E.page.keyboard.press('p'); await E.page.keyboard.type('Session four, past the budget'); await E.page.keyboard.press('Enter'); await E.page.keyboard.press('Escape');
    check(await toastErr(E, /Dropped \d+ old capture lines? from earlier sessions.*npm run gm:after files them into the vault/), 'a toast says how many earlier-session lines were dropped and that npm run gm:after files them into the vault: ' + (await E.page.textContent('#toastErr')));
    const droppedM = /Dropped (\d+)/.exec(await E.page.textContent('#toastErr')), dropped = droppedM ? +droppedM[1] : -1;
    const st = await until(async () => { const d = await gmState(); const c = d.capture || {}; return Object.values(c).some((e) => e.text === 'Session four, past the budget') ? d : null; }, 8000);
    const left = st ? st.capture : {};
    check(!!st && capBytes(left) <= 128 * 1024 + 200 && !left.s3_0 && !!left.s3_299 && Object.keys(left).filter((k) => /^s3_/.test(k)).length === 300 - dropped, 'server: the capture is back under 128 KiB, the oldest lines of session 3 went (' + dropped + '), the newest stayed');
    check(Object.values(left).filter((e) => e.s === 4).length === mine + 1, 'and every line of this session is still there (' + (mine + 1) + ')');
    await E.page.keyboard.press('2'); await E.page.waitForSelector('#gm-card .gm-lead');
    check(!!(await until(async () => { const d = await gmState(); return d.cards.situation && d.cards.situation.situation === 'fourfive' ? d : null; }, 8000)) && !(await E.page.textContent('#toastErr')).includes('notes are full'), 'a roll is taken and saved');
    // this session alone over the budget: new text is refused (clear message), rolls still go
    await api('PATCH', '/gm/state', GM, { capture: null });
    check((await api('PATCH', '/gm/state', GM, { capture: lines(4, 300, 0) })).status === 200, 'server: now this session alone has 300 lines');
    await E.page.reload(); await E.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 20000 });
    await E.page.keyboard.press('p'); await E.page.keyboard.type('One more line'); await E.page.keyboard.press('Enter'); await E.page.keyboard.press('Escape');
    check(await toastErr(E, /Tonight.s capture is full.*Export tonight.s note.*Rolls still work/), 'this session alone over the budget: "Tonight’s capture is full … Rolls still work."');
    const before = (await gmState()).cards.situation;
    await E.page.keyboard.press('3'); await E.page.waitForSelector('#gm-card .gm-lead');
    const after = await until(async () => { const d = await gmState(); return d.cards.situation && d.cards.situation.hid !== (before && before.hid) ? d : null; }, 8000);
    check(!!after && !Object.values(after.capture || {}).some((e) => e.text === 'One more line'), 'the line was not filed, and the roll was saved');
    await api('PATCH', '/gm/state', GM, { capture: null });
    await E.ctx.close();
  }

  /* ---- the pack check: a pack file that lacks tables is a warning (the modules' own check(T)), never an error; the upload stays on ---- */
  {
    check((await api('DELETE', '/gm/pack?part=downtime', GM)).status === 200, 'the Downtime section\'s part is taken off again (the fixture pack has none, so a file without it would read as a part lost)');
    const sparse = JSON.parse(JSON.stringify(PACK)); delete sparse.parts.console.T.spend; delete sparse.parts.location.T.rumour;
    const sparseFile = path.join(stateDir, 'sparse-pack.json'); writeFileSync(sparseFile, JSON.stringify(sparse));
    const U = await open(GM, '#gm');
    await U.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 20000 });
    check(await U.page.$eval('#gm-menu-warn', (b) => b.hidden && b.textContent === ''), 'a complete pack: the Menu has no Pack check');
    await U.page.click('[data-gm="menu"]'); await U.page.click('.gm-menu-list [data-gm="update"]');
    await U.page.setInputFiles('#gm-file', sparseFile);
    await U.page.waitForSelector('#gm-prev table', { timeout: 10000 });
    const w = await U.page.$eval('#gm-prev .gm-warns', (b) => ({ text: b.textContent, cls: b.className })).catch(() => null);
    check(!!w && /console/.test(w.text) && /spend/.test(w.text) && /location/.test(w.text) && /rumour/.test(w.text) && /warning, not an error/.test(w.text), 'Update pack with a sparse file: a warning lists the missing tables by part (' + (w ? w.text.slice(0, 120) : 'none') + ')');
    check(!!w && /\bwarn\b/.test(w.cls) && !/\bbad\b/.test(w.cls) && !(await U.page.$('#gm-prev .gm-errs')) && await U.page.$eval('[data-gm="upload"]', (b) => !b.disabled && !b.classList.contains('bad')), 'it is a warning (not an error list), and Upload stays on');
    await shot(U.page, 'wave2-pack-warning');
    await U.page.click('[data-gm="cancel-import"]');
    check(await U.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 10000 }).then(() => true, () => false), 'Cancel: back to the console on the pack the page has');
    await U.ctx.close();
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

  /* ---- a player's sign-in on a browser that holds only the pack's database (no sticky copy) purges it too: the GM bundle,
     which holds the purge, is fetched for it (boot.js purgeGm) ---- */
  {
    const D = await open(PLAYER, '#');
    await D.page.evaluate(() => new Promise((res) => { const r = indexedDB.open('b68-gm', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ parts: {} }, 'pack:gm@example.test'); tx.oncomplete = () => { r.result.close(); res(); }; }; }));
    const asked = []; D.page.on('request', (r) => asked.push(new URL(r.url()).pathname.slice(1)));
    await D.page.reload(); await D.page.waitForFunction(() => window.B68Runtime && window.B68Runtime.me, null, { timeout: 20000 });
    const gone = await until(async () => { const k = await D.page.evaluate(() => new Promise((res) => { const r = indexedDB.open('b68-gm'); r.onsuccess = () => { try { const q = r.result.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess = () => res(q.result); } catch (e) { res([]); } }; r.onerror = () => res(null); })); return Array.isArray(k) && k.length === 0 ? k : null; }, 8000);
    check(!!gone && asked.includes('gm-page.js'), 'a player with only the pack database: the GM bundle is fetched and the pack:* key purged');
    await D.ctx.close();
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
