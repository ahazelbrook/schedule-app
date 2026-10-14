// The GM page (#gm) and the display wiring (#display) end to end against a real local Worker (wrangler dev, DEV_USER) on
// PORT (default 8845), with the migrations applied (the seven seeded NPCs are there) and only invented fixture tables
// (checks/runtime/fixtures/gm/). The GM imports a fixture pack through the page, rolls with the number keys, reloads and
// gets the same card, files capture with P / X / L, keys stay quiet while typing, the location tab rolls and draws, only a
// player-layer map reaches the display (a GM-layer svg is refused in code), H blanks the screen, an NPC goes to the iPad
// (hidden ones after a confirm), the note downloads; the phone (360 px) and the iPad (both orientations) layouts do not
// overflow and their buttons are at least 44 px; a player sees "GM only" and no GM button, and their sign-in purges the
// cached pack; #display hides the header and mounts the display page.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node checks/runtime/gm.e2e.mjs      (or: npm run check:gm)
// PW_MODULE=<path to playwright> picks the Playwright install; GM_SHOTS=<dir> also saves screenshots there.
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

  const browser = await chromium.launch();
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
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: false }); };
  const cardText = (page) => page.$eval('#gm-card .gm-card', (c) => c.textContent).catch(() => '');
  const gmState = async () => (await api('GET', '/gm/state', GM)).json.doc;

  /* ---- a player first: no GM button, "GM only", 403 from the API ---- */
  const P = await open(PLAYER, '#gm');
  check(await P.page.waitForSelector('#gm-page .gm-note', { timeout: 20000 }).then(() => true, () => false) && /GM only/.test(await P.page.textContent('#gm-page')), 'player: #gm says GM only');
  check(await P.page.$eval('#gmBtn', (b) => b.hidden), 'player: no GM button in the nav');
  check((await api('GET', '/gm/pack', PLAYER)).status === 403, 'player: GET /api/gm/pack is 403');
  await P.page.goto(BASE + '/#display'); await sleep(800);
  check(/GM only/.test(await P.page.textContent('#display-page')), 'player: #display says GM only and mounts nothing');

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
  check((await G.page.$$('#gm-buttons .gm-btn')).length === 9, 'console: nine buttons');
  check(await G.page.$eval('#gm-exp', (e) => e.classList.contains('stale') && /days old/.test(e.textContent)), 'header: the five-day-old export is flagged');
  const cached = await G.page.evaluate(() => new Promise((res) => { const r = indexedDB.open('b68-gm'); r.onsuccess = () => { const tx = r.result.transaction('kv'); const q = tx.objectStore('kv').getAllKeys(); q.onsuccess = () => res(q.result); }; r.onerror = () => res(null); }));
  check(Array.isArray(cached) && cached.length === 1 && /^pack:/.test(cached[0]), 'the pack is cached in IndexedDB under pack:<user>: ' + JSON.stringify(cached));
  await shot(G.page, '01-gm-console');

  /* ---- the number keys, history, reload replays the same card ---- */
  await G.page.click('#gm-page .gm-h').catch(() => {}); await G.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await G.page.keyboard.press('2');
  await G.page.waitForSelector('#gm-card .gm-card', { timeout: 5000 });
  check(/Complication/i.test(await cardText(G.page)), 'key 2: a Complication card');
  await G.page.keyboard.press('1');
  const card1 = await cardText(G.page);
  check(/Devil/i.test(card1), 'key 1: a Devil’s Bargain card');
  check((await G.page.$$('#gm-earlier [data-gm="replay"]')).length === 2, 'Earlier: two rolls');
  // the keys never fire while typing
  await G.page.click('#gm-c-threat');
  await G.page.keyboard.type('3');
  check((await cardText(G.page)) === card1 && (await G.page.$$('#gm-earlier [data-gm="replay"]')).length === 2, 'typing a digit in a text box rolls nothing');
  await G.page.keyboard.press('Escape');
  check(await G.page.evaluate(() => document.activeElement === document.body || !document.activeElement || document.activeElement.id !== 'gm-c-threat'), 'Esc leaves the text box');
  await G.page.keyboard.press('Control+3');
  check((await G.page.$$('#gm-earlier [data-gm="replay"]')).length === 2, 'a modifier held: no roll');
  await until(async () => { const d = await gmState(); return d.cards && d.cards.console && d.hist && Object.keys(d.hist.console || {}).length === 2; }, 5000);
  const st1 = await gmState();
  check(st1.cards.console.id === 'devilsBargain' && typeof st1.cards.console.seed === 'number' && typeof st1.cards.console.mem === 'string' && !('lines' in st1.cards.console), 'state: the current card is replay info only {id, seed, ui, mem}');
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
  check(!!cap && cap.some((e) => e.bucket === 'n' && e.text === 'Inspector Invented') && cap.some((e) => e.bucket === 'x' && /goose/.test(e.text)) && cap.some((e) => e.bucket === 'r' && /Devil/.test(e.text)), 'capture: a name, a loose end and the last roll are filed in GM state');
  const campLog = (await api('GET', '/campaign', GM)).json.doc.log || [];
  check(!campLog.some((e) => /Inspector Invented|goose/.test(e.text)), 'nothing from capture reaches the campaign log');

  /* ---- the location tab and the map ---- */
  await G.page.keyboard.press('b');
  check(await G.page.$eval('#gm-loc', (p) => !p.hidden), 'B shows the Location tab');
  await G.page.click('[data-gm="locroll"]');
  await G.page.waitForSelector('#gm-loc .gm-loccard', { timeout: 10000 });
  check((await G.page.$$('#gm-loc .gm-secret')).length > 0 && /GM only/.test(await G.page.textContent('#gm-loc .gm-loccard')), 'location: the card marks its GM-only sections');
  check(await G.page.$eval('[data-gm="ipad"]', (b) => b.disabled), 'map: Show on iPad is off on the GM layer');
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
  check(await until(async () => (await api('GET', '/gm/display', GM)).json.display.kind === 'blank', 5000), 'Blank the iPad: the display is blank');
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
  check(/NPC generator: coming/.test(await G.page.textContent('#gm-npc')), 'NPC: the generator is marked as coming');
  await G.page.click('#gm-npc .gm-npcrow[data-id="npc_mira"] [data-gm="npcipad"]');      // hidden: the confirm is accepted
  check(await until(async () => { const d = (await api('GET', '/gm/display', GM)).json.display; return d.kind === 'npc' && d.npcId === 'npc_mira'; }, 5000), 'Show on iPad (after the confirm): the display shows the NPC');
  check((await G.page.getAttribute('#gm-npc .gm-npcrow[data-id="npc_mira"] a.btn', 'href')) === '#cast/npc_mira', 'Put on stage leads to the cast page');

  /* ---- H blanks the screen; any key brings it back ---- */
  await G.page.keyboard.press('h');
  check(await G.page.$eval('.gm-blank', (b) => getComputedStyle(b).position === 'fixed').catch(() => false), 'H: a black screen');
  await G.page.keyboard.press('q');
  check(!(await G.page.$('.gm-blank')), 'any key restores the page');

  /* ---- Export tonight's note ---- */
  const [dl] = await Promise.all([G.page.waitForEvent('download', { timeout: 10000 }), G.page.click('.gm-head [data-gm="note"]')]);
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
  check(await G.page.$eval('header.top', (h) => getComputedStyle(h).display !== 'none') && (await G.page.$eval('#display-page', (d) => d.hidden && d.childElementCount === 0)), 'leaving #display: unmounted, the header is back');

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
      check(cols === 3, 'phone: the buttons are a 3 × 3 grid');
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

  /* ---- a player's sign-in on a browser that holds a GM pack purges it ---- */
  const Q = await open(PLAYER, '#');
  await Q.page.evaluate(() => new Promise((res) => { const r = indexedDB.open('b68-gm', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ parts: {} }, 'pack:gm@example.test'); tx.oncomplete = () => { r.result.close(); res(); }; }; }));
  await Q.page.evaluate(() => localStorage.setItem('b68.gm.sticky', '{"v":1}'));
  await Q.page.reload(); await Q.page.waitForFunction(() => window.B68Runtime && window.B68Runtime.me, null, { timeout: 20000 });
  const left = await until(async () => { const k = await Q.page.evaluate(() => new Promise((res) => { const r = indexedDB.open('b68-gm'); r.onsuccess = () => { try { const q = r.result.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess = () => res(q.result); } catch (e) { res([]); } }; r.onerror = () => res(null); })); return Array.isArray(k) && k.length === 0 ? k : null; }, 8000);
  check(!!left, 'a player signing in: no pack:* key is left in IndexedDB');
  check(await Q.page.evaluate(() => localStorage.getItem('b68.gm.sticky') === null), 'and the sticky copy is gone');

  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
}
clearTimeout(timeout);
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
