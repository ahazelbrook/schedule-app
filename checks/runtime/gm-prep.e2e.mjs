// The Prep tab and the planning meeting's cards, end to end against a real local Worker (wrangler dev, DEV_USER) on PORT
// (default 8846), with only invented data: a prep note written to a temp vault and exported by scripts/lib/prep-export.mjs,
// beside the fixture console and location parts. The GM imports the pack through the page; R opens Prep; a task box ticks
// (GM state), survives a reload, and a box ticked in the note is locked; a beat starts its clock; a section pins to the rail;
// an NPC link opens a peek card; Wide hides the console; the phone layout does not overflow. Then O opens Cards: three cards
// are typed, shown on the iPad as a carousel (the server holds exactly the typed lines) and as a spread; #display draws them
// and a tap turns the carousel.
//   PW_MODULE=<playwright> PW_CHANNEL=msedge node checks/runtime/gm-prep.e2e.mjs
// PREP_PACK=<pack.json> uses that pack instead of the invented one (a local look at real prep; nothing is asserted about its
// text). GM_SHOTS=<dir> saves screenshots there.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildPrep } from '../../scripts/lib/prep-export.mjs';
import { buildScreen } from '../../scripts/lib/screen-export.mjs';
import { basenames } from '../../scripts/lib/vault.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8846);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const SHOTS = process.env.GM_SHOTS || '';
const REAL = process.env.PREP_PACK || '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

/* ---------- the pack: fixture console and location, and a prep part from an invented note ---------- */
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-prep-e2e-'));
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
let PACK;
if (REAL) PACK = JSON.parse(readFileSync(REAL, 'utf8'));
else {
  const conFix = JSON.parse(readFileSync(path.join(FIX, 'console-pack.json'), 'utf8')), locFix = JSON.parse(readFileSync(path.join(FIX, 'location-pack.json'), 'utf8'));
  const vault = path.join(stateDir, 'vault'), G = 'Wiki/Games/Blades in the Dark/Campaigns/Group';
  const w = (rel, text) => { const f = path.join(vault, ...rel.split('/')); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); };
  w(G + '/Sessions/b68g-s07.md', ['---', 'session: 7', 'date: 01/02/2030', 'status: prep', 'gm_prep: true', '---', '', '# Session 7: prep', '',
    '## Run order', '', '| # | Beat | About |', '|---|---|---|', '| 1 | **Titles** | 5 min |', '| 2 | **The score** | 60 min |', '',
    '## Must land', '', '- [ ] **#1** The lamp flickers', '- [x] **#2** The dog barks twice', '',
    '> [!quote] SAY', '> *"The fog comes in off the canal."* `[Invented pitch]`', '',
    '> [!warning] Mind the time', '> Cut the scene at ten minutes.', '',
    '## Cast', '', 'Open on [[Odo Plim]]. Then the [[pip-pockets#A. The goose job|goose job]].', '',
    '![[pip-pockets#A. The goose job]]', '', '# Play log', '', '## Names', '', '-', '', '## Loose ends', '', '-', '', '## Moments', '', '-', '', '## Rolled at the table', '', '-', ''].join('\n'));
  w(G + '/pip-pockets.md', ['# Pockets', '', '## A. The goose job', '', '| | |', '|---|---|', '| **Target** | A goose |', '| **Pays** | 2 |', '', '- [ ] Ask the goose', ''].join('\n'));
  w('Wiki/Games/Blades in the Dark/NPCs/Odo Plim.md', '# Odo\n');
  w('Wiki/Games/Blades in the Dark/Rules/pip-screen.md', ['---', 'gm_screen: true', '---', '', '# Pip\'s screen', '', '> [!danger] House law', '> Geese first.', '',
    '## Rolling', '', '1. **Ask** what they want.', '2. **Say** what could go wrong.', '', '## Weather', '', '| | |', '|---|---|', '| 0 | drizzle |', '| 1 | a squall |', '',
    '## Canals', '', '| Canal | Rule |', '|---|---|', '| **Goosegate** | Bread is +1d. |', '| **Lampwick** | Fog all night. |', '', '## Related', '', '- [[pip-pockets]]', ''].join('\n'));
  const prep = buildPrep({ vault, repo: ROOT, exportedAt: new Date().toISOString(), basenames: basenames(vault) });
  const screen = buildScreen({ vault, repo: ROOT, exportedAt: new Date().toISOString() });
  PACK = { format: 1, exportedAt: new Date().toISOString(), parts: { console: conFix.parts.console, campaign: conFix.parts.campaign,
    location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: new Date().toISOString() }, T: locFix.T, extra: locFix.extra }, prep, screen } };
}
const packFile = path.join(stateDir, 'b68-gm-pack.json');
writeFileSync(packFile, JSON.stringify(PACK));

/* ---------- our own server ---------- */
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
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

let failed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 300000);
const api = (method, p, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const gmState = async () => (await api('GET', '/gm/state')).json.doc;

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 300);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  await api('PATCH', '/campaign', { session: { number: 7 } });
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(hash, { width = 1440, height = 900, mobile = false } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width, height }, serviceWorkers: 'block', isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
    await c.addInitScript(() => { window.__B68_POLL_MS = 700; });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '/' + hash);
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    return { ctx: c, page };
  }
  const shot = async (page, name, full) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: !!full }); };

  /* ---- import, then Prep ---- */
  const { page } = await open('#gm');
  await page.waitForSelector('#gm-file', { state: 'attached', timeout: 30000 });
  await page.setInputFiles('#gm-file', packFile);
  await page.waitForSelector('[data-gm="upload"]:not([disabled])', { timeout: 10000 });
  await page.click('[data-gm="upload"]');
  await page.waitForSelector('#gm-root', { timeout: 30000 });
  await page.keyboard.press('r');
  check(await page.waitForSelector('#gm-prep .pp-doc', { timeout: 10000 }).then(() => true, () => false), 'R opens Prep and the note renders');
  check(await page.$eval('[data-gm="panel"][data-panel="prep"]', (b) => b.getAttribute('aria-selected')) === 'true', 'the Prep tab is selected');
  check(await page.evaluate(() => document.activeElement && document.activeElement.id === 'gm-prep-q'), 'R focuses the note’s find box, so typing is safe');
  await page.keyboard.type('2');
  check((await page.$$('#gm-earlier [data-gm="replay"]')).length === 0, 'a digit typed there rolls nothing');
  await page.fill('#gm-prep-q', 'must'); await page.keyboard.press('Enter');
  check(await page.$$eval('#gm-prep .pp-rail .chip', (cs) => cs.filter((c) => !c.hidden).map((c) => c.textContent.trim())).then((v) => v.length === 1 && /Must land/.test(v[0])), 'the find box filters the section rail; Enter goes to the first match');
  await page.fill('#gm-prep-q', ''); await page.keyboard.press('Escape');
  check(await page.$$eval('#gm-prep .pp-rail .chip', (cs) => cs.every((c) => !c.hidden)), 'cleared: every section is listed again');
  const boxes = await page.$$eval('#gm-prep .pp-box', (bs) => bs.map((b) => ({ a: b.getAttribute('data-task'), locked: b.getAttribute('aria-disabled') === 'true' })));
  check(boxes.length > 0 && boxes.some((b) => b.locked) === !!boxes.find((b) => b.locked), 'task boxes are tickable checkboxes (' + boxes.length + ')');
  check((await page.$$('#gm-prep .pp-sec')).length > 1 && (await page.$$('#gm-prep .pp-rail .chip')).length > 1, 'sections and a section rail');
  check(await page.$eval('#gm-prep-q', (q) => q.getBoundingClientRect().height < 60), 'laptop: the note’s find box in the outline is one line tall');
  await shot(page, 'prep-desktop');
  if (!REAL) {
    const open1 = boxes.find((b) => !b.locked), done1 = boxes.find((b) => b.locked);
    check(!!done1, 'a box ticked in the note is locked');
    await page.click('#gm-prep .pp-box[data-task="' + open1.a + '"]');
    check(await page.$eval('#gm-prep .pp-box[data-task="' + open1.a + '"]', (b) => b.classList.contains('here') && b.getAttribute('aria-checked') === 'true'), 'a tick shows at once (orange: not yet in the note)');
    const st = await until(async () => { const d = await gmState(); return d.prep && d.prep.ticks && d.prep.ticks[open1.a]; }, 8000, 300);
    check(!!st && st.s === 7 && /b68g-s07\.md$/.test(st.rel) && /lamp/.test(st.t), 'the tick is in the GM state with its note, session and text');
    await page.click('#gm-prep .pp-box[data-task="' + done1.a + '"]', { force: true });
    check(await page.$eval('#gm-prep .pp-box[data-task="' + done1.a + '"]', (b) => !b.classList.contains('here')), 'a box ticked in the note cannot be unticked here');
    await page.click('#gm-prep .pp-beat');
    check(await until(async () => { const d = await gmState(); return d.prep && d.prep.beats && Object.keys(d.prep.beats).length === 1; }, 8000, 300), 'a beat starts');
    check(/0:0\d \/ 5:00/.test(await page.textContent('#gm-prep .pp-clock.run')), 'the beat clock runs against its 5 min budget');
    check(await page.$eval('#gm-prep .rl-callout.pp-say', () => true).catch(() => false) && await page.$eval('#gm-prep code.pp-prov', () => true).catch(() => false), 'SAY card and provenance chip');
    check((await page.$$('#gm-prep .pp-embed')).length === 1, 'the transcluded section is carried in');
    await page.click('#gm-prep #pp-must-land .pp-pin');
    check(await page.waitForSelector('#gm-rail .pp-pinbox .pp-box', { timeout: 5000 }).then(() => true, () => false), 'a pinned section sits in the rail with its boxes');
    await page.click('#gm-prep a[href^="#pp:npc:"]');
    check(await page.$eval('#gm-prep-peek', (p) => !p.hidden && /Odo Plim/.test(p.textContent)), 'an NPC link opens a peek card');
    check(page.url().endsWith('#gm'), 'a link in the note does not leave the page');
    await page.reload(); await page.waitForSelector('#gm-prep .pp-doc', { timeout: 20000 });
    check(await page.$eval('#gm-prep .pp-box[data-task="' + open1.a + '"]', (b) => b.classList.contains('here')), 'reload: the tick is still there');
  }
  /* 1280 wide with a beat running (and the iPad showing something): the bar, which now carries Now in, still holds every item on one row */
  await page.setViewportSize({ width: 1280, height: 900 }); await sleep(400);
  check(await page.evaluate(() => { const b = document.querySelector('.gm-bar'), r = b.getBoundingClientRect(); return r.height < 60 && b.scrollWidth <= b.clientWidth + 1 && [...b.querySelectorAll('.gm-now, .gm-beatbar, [data-gm="find-open"], #gm-bar-ipad, [data-gm="menu"]')].every((c) => { const q = c.getBoundingClientRect(); return q.width > 0 && q.right <= innerWidth + 1; }); }), 'laptop 1280: with a beat running, the bar holds Now in, the beat, Find, the iPad pill and the Menu on one row');
  await shot(page, 'bar-1280-beat');
  await page.setViewportSize({ width: 1440, height: 900 }); await sleep(300);
  /* the laptop layout: one window tall, the outline follows the reading, Focus shrinks the console to its keys */
  check(await page.evaluate(() => document.body.classList.contains('gm-app') && document.documentElement.scrollHeight <= innerHeight + 1), 'laptop: the page is one window tall with the note open');
  await page.evaluate(() => { const p = document.getElementById('gm-prep'); p.scrollTop = Math.floor(p.scrollHeight / 2); });
  check(await page.waitForSelector('#gm-prep .pp-rail [aria-current="true"]', { timeout: 5000 }).then(() => true, () => false), 'laptop: the outline marks the section being read');
  await page.click('[data-gm="focus"]');
  check(await page.$eval('#gm-root .gm-console', (c) => c.getBoundingClientRect().width < 100) && await page.$eval('#gm-mini', (m) => getComputedStyle(m).display !== 'none' && m.querySelectorAll('button').length > 0), 'Focus shrinks the console to its keys');
  await shot(page, 'prep-wide');
  await page.click('[data-gm="focus"]');

  /* ---- the phone ---- */
  const ph = await open('#gm', { width: 390, height: 844, mobile: true });
  await ph.page.waitForSelector('#gm-root', { timeout: 30000 });
  await ph.page.click('.gm-segbar [data-seg="prep"]');
  await ph.page.waitForSelector('#gm-prep .pp-doc', { timeout: 10000 });
  const over = await ph.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 1, 'phone: the note does not overflow the screen (' + over + ' px)');
  await shot(ph.page, 'prep-phone');

  /* ---- Cards ---- */
  await page.keyboard.press('o');
  check(await page.waitForSelector('#gm-cards [data-gm="opp-add"]', { timeout: 5000 }).then(() => true, () => false), 'O opens Cards');
  const typed = [{ from: 'Pip', client: 'The Lantern Guild', target: 'A barge (2)', payout: '6 stacks' }, { from: 'Wen', type: 'Smuggling', note: 'Tonight only' }, { from: 'GM', target: 'A bell tower' }];
  for (const c of typed) {
    await page.click('[data-gm="opp-add"]');
    const id = await page.$$eval('#gm-cards .gm-opp', (os) => os[os.length - 1].querySelector('[data-opp]').getAttribute('data-opp'));
    for (const [f, v] of Object.entries(c)) await page.fill('[data-opp="' + id + '"][data-f="' + f + '"]', v);
    await page.click('#gm-cards .gm-cardsbar');                 // leave the field: the change event saves it
  }
  await page.selectOption('#gm-opp-iv', '8');
  await shot(page, 'cards-editor');
  await page.click('[data-gm="opp-show"][data-mode="carousel"]');
  const disp = await until(async () => { const r = await api('GET', '/gm/display'); return r.json && r.json.display && r.json.display.kind === 'cards' ? r.json.display : null; }, 8000, 300);
  check(!!disp && disp.cards.length === 3 && disp.cards[0].client === 'The Lantern Guild' && disp.cards[1].note === 'Tonight only' && disp.interval === 8 && disp.mode === 'carousel', 'Show on iPad: the server holds the three cards as typed');
  const ipad = await open('#display', { width: 1180, height: 820, mobile: true });
  check(await ipad.page.waitForSelector('#display-page .oc-card.oc-cur', { timeout: 15000 }).then(() => true, () => false), '#display draws the carousel');
  check(/The Lantern Guild/.test(await ipad.page.textContent('#display-page .oc-cur')), 'the first card is in front');
  await sleep(1200); await shot(ipad.page, 'ipad-carousel');
  await ipad.page.mouse.click(1000, 400);
  check(/Wen/.test(await ipad.page.textContent('#display-page .oc-cur')), 'a tap on the right turns to the next card');
  await page.click('[data-gm="opp-show"][data-mode="spread"]');
  check(await ipad.page.waitForSelector('#display-page .dp-cards-spread', { timeout: 15000 }).then(() => true, () => false), 'Spread on iPad lays all three out');
  await sleep(1500); await shot(ipad.page, 'ipad-spread');

  /* ---- the Screen tab (T) ---- */
  await page.keyboard.press('t');
  check(await page.waitForSelector('#gm-rules .gs-sec', { timeout: 5000 }).then(() => true, () => false), 'T opens the Screen and its sections render');
  check(await page.$eval('[data-gm="panel"][data-panel="rules"]', (b) => /GM screen/.test(b.textContent)), 'the tab is called GM screen');
  check(await page.evaluate(() => document.activeElement && document.activeElement.id === 'gm-gs-q'), 'T focuses the screen’s find box, so typing is safe');
  if (!REAL) {
    check(JSON.stringify(await page.$$eval('#gm-rules .gs-sec .gs-h span', (s) => s.map((x) => x.textContent))) === '["Rolling","Weather","Canals"]', 'one section per ## heading, Related left in the vault');
    check(/Geese first/.test(await page.textContent('#gm-rules .gs-intro')), 'the intro (house law) sits above the sections');
    check(await page.$eval('#gm-rules [data-gs="canals"] table', (t) => !!t), 'tables render');
    check(await page.$eval('#gm-rules [data-gs="weather"] thead', (t) => getComputedStyle(t).display === 'none'), 'a blank header row is hidden');
    await page.fill('#gm-gs-q', 'lampwick');
    check(JSON.stringify(await page.$$eval('#gm-rules .gs-sec:not([hidden])', (s) => s.map((x) => x.getAttribute('data-gs')))) === '["canals"]', 'the filter keeps only the sections that match');
    check(await page.$$eval('#gm-rules [data-gm="gs-jump"]:not([hidden])', (c) => c.length) === 1, 'and only their jump chips');
    await page.fill('#gm-gs-q', 'zzz');
    check(await page.$eval('#gm-rules .gs-none', (p) => !p.hidden), 'nothing matching says so');
    await page.fill('#gm-gs-q', '');
    check(await page.$$eval('#gm-rules .gs-sec:not([hidden])', (s) => s.length) === 3, 'clearing the filter shows everything again');
    await page.click('#gm-rules [data-gm="gs-ipad"][data-id="canals"]');
    const rd = await until(async () => { const r = await api('GET', '/gm/display'); return r.json && r.json.display && r.json.display.kind === 'rule' ? r.json.display : null; }, 8000, 300);
    check(!!rd && rd.title === 'Canals' && /Goosegate/.test(rd.md) && rd.caption === 'GM screen', 'Show on iPad sends the section as a rule');
    check(await ipad.page.waitForFunction(() => /Goosegate/.test(document.querySelector('#display-page').textContent), null, { timeout: 15000 }).then(() => true, () => false), '#display shows it');
  }
  /* the full rules, searched in the pane (A11): listed with a snippet, one read in place, Show on iPad as the rules page sends it, never a new tab.
     The corpus is one invented house rule (its [TODO] note is the compiler's, and must reach neither the pane nor the iPad). */
  if (await page.$('#gm-rq')) {
    await page.evaluate(() => window.claude.rules.saveHouse('goose-law', { title: 'Goose Law', trail: 'House rules', body: 'A goose goes first in any scene, and nobody argues.\n\nThe second paragraph is about the marsh. [TODO: GM secret note]' }));
    const tabs0 = page.context().pages().length;
    await page.fill('#gm-rq', 'goose'); await page.press('#gm-rq', 'Enter');
    check(await page.waitForSelector('#gm-rq-hits .gs-hit', { timeout: 15000 }).then(() => true, () => false), 'the full rules search lists its hits in the pane');
    check(await page.$eval('#gm-rq-hits .gs-hit', (b) => /Goose Law/.test(b.querySelector('.gs-hit-t').textContent) && !!b.querySelector('.gs-hit-t mark') && /House rules/.test(b.querySelector('.gs-hit-c').textContent) && !!b.querySelector('.gs-hit-s mark')), 'a hit shows its title, its book and a snippet, the word marked in both');
    check(page.context().pages().length === tabs0 && await page.$eval('#gm-rq-hits .gs-hitbar a[target="_blank"]', (a) => /Open in the Rules page/.test(a.textContent) && /#rules\?q=goose$/.test(a.getAttribute('href'))), 'no new tab: the rules page is a small link (Open in the Rules page)');
    check(await page.waitForFunction(() => { const r = document.getElementById('gm-rq-hits').getBoundingClientRect(), p = document.getElementById('gm-rules').getBoundingClientRect(); return r.top >= p.top - 1 && r.bottom <= p.bottom + 1; }, null, { timeout: 4000 }).then(() => true, () => false), 'the hits are scrolled into view in the pane');
    await shot(page, 'screen-rules-hits');
    await page.click('#gm-rq-hits .gs-hit');
    check(await page.waitForSelector('#gm-rq-hits .gs-entry', { timeout: 5000 }).then(() => true, () => false) && await page.$eval('#gm-rq-hits .gs-entry .gs-body', (b) => /goose goes first/.test(b.textContent) && !/TODO|secret note/.test(b.textContent)), 'one hit opens in place, without the compiler’s [TODO] note');
    await shot(page, 'screen-rules-entry');
    await page.click('#gm-rq-hits [data-gm="rq-ipad"]');
    const rr = await until(async () => { const r = await api('GET', '/gm/display'); return r.json && r.json.display && r.json.display.kind === 'rule' && r.json.display.title === 'Goose Law' ? r.json.display : null; }, 8000, 300);
    check(!!rr && rr.caption === 'House rules' && /goose goes first/.test(rr.md) && !/TODO|secret note/.test(rr.md), 'Show on iPad sends the entry as a rule display, as the rules page does');
    check(await ipad.page.waitForFunction(() => /goose goes first/.test(document.querySelector('#display-page').textContent), null, { timeout: 15000 }).then(() => true, () => false), '#display shows the rule');
    await page.click('#gm-rq-hits [data-gm="rq-back"]');
    check(await page.$$eval('#gm-rq-hits .gs-hit', (b) => b.length) === 1, 'Back is the list again');
    /* Find (Ctrl+K) lists the rules this device now holds, and a hit opens in the pane */
    await page.keyboard.press('Control+k'); await page.fill('#gm-find-q', 'goose');
    check(await page.waitForFunction(() => [...document.querySelectorAll('.gm-find-hit .gm-find-kind')].some((k) => /Rules/.test(k.textContent)), null, { timeout: 5000 }).then(() => true, () => false), 'Find lists a rules entry');
    await page.evaluate(() => { [...document.querySelectorAll('.gm-find-hit')].filter((b) => /Rules/.test(b.querySelector('.gm-find-kind').textContent))[0].click(); });
    check(await page.waitForSelector('#gm-rq-hits .gs-entry', { timeout: 5000 }).then(() => true, () => false) && await page.$eval('#gm-find', (f) => f.hasAttribute('hidden')), 'a rules hit in Find opens it in the GM screen pane');
    /* the screen's own find box: nothing there, one click to the same words in the rules */
    await page.fill('#gm-gs-q', 'zzzq');
    check(await page.$eval('#gm-rules .gs-none', (p) => !p.hidden && /Search the full rules for “zzzq”/.test(p.textContent)), 'with nothing on the screen, the find box offers the full rules for the same words');
    await page.click('#gm-rules [data-gm="rq-find"]');
    check(await page.waitForFunction(() => /Nothing in the rules matches “zzzq”/.test(document.getElementById('gm-rq-hits').textContent), null, { timeout: 8000 }).then(() => true, () => false), 'and the answer comes in the pane');
    await page.fill('#gm-gs-q', '');
  } else check(/not available/.test(await page.textContent('#gm-rules .gs-rules')), 'no rules runtime here: the pane says so');
  await shot(page, 'screen-desktop');
  await ph.page.click('.gm-segbar [data-seg="rules"]');
  check(await ph.page.waitForSelector('#gm-rules .gs-sec', { state: 'visible', timeout: 10000 }).then(() => true, () => false), 'phone: Screen is a segment');
  if (await ph.page.$('#gm-rq')) {
    await ph.page.fill('#gm-rq', 'goose'); await ph.page.press('#gm-rq', 'Enter');
    check(await ph.page.waitForSelector('#gm-rq-hits .gs-hit', { state: 'visible', timeout: 15000 }).then(() => true, () => false), 'phone: the rules search lists its hits');
    check(await ph.page.waitForFunction(() => { const r = document.querySelector('#gm-rq-hits .gs-hit').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 130 && r.bottom <= innerHeight; }, null, { timeout: 4000 }).then(() => true, () => false), 'phone: the first hit is on screen, under the sticky bars');
    await shot(ph.page, 'screen-rules-phone');
  }
  const over2 = await ph.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over2 <= 1, 'phone: the screen does not overflow (' + over2 + ' px)');
  await shot(ph.page, 'screen-phone', true);

  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''));
  await browser.close();
} catch (e) { console.log('FAIL ' + (e && e.stack || e)); failed++; }
clearTimeout(timeout);
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
