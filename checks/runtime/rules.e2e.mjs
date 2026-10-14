// The rules wiki end to end against a real local Worker (wrangler dev on PORT, default 8795, DEV_USER): the GM imports a
// folder of (made-up) Obsidian notes through the page, a player searches and reads them, wikilinks, the folded entry of
// the other book, hostile text staying inert, the "?" links on the sheets, house rules, the offline copy, and a phone
// layout with no sideways scroll. Every text is placeholder prose from checks/runtime/fixtures/rules/: the real
// rulebooks are never in this repository.
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node checks/runtime/rules.e2e.mjs      (or: npm run check:rules)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8795);
const BASE = 'http://127.0.0.1:' + PORT;
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'rules');
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GM = 'gm@example.test';
const PLAYER = 'p1@example.test';

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-rules-e2e-'));
const bigDir = mkdtempSync(path.join(tmpdir(), 'b68-rules-big-'));
const server = spawn(path.join(ROOT, 'node_modules', '.bin', 'wrangler'), ['dev', '--port', String(PORT), '--ip', '127.0.0.1',
  '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false', '--persist-to', stateDir, '--log-level', 'warn',
  '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM],
{ cwd: ROOT, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, detached: true, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
function killServer(sig = 'SIGTERM') { try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(-server.pid, sig); } catch (_) {} }
process.on('exit', () => { killServer('SIGKILL'); for (const d of [stateDir, bigDir]) try { rmSync(d, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 240000);
const api = (user, method, p, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));

/* a made-up folder big enough for several upload parts: 60 notes of about 10 KB with H1 / H2 headings */
function makeBig() {
  const para = 'A made-up paragraph for the upload test: the copper kettle hums, the lantern wobbles, and nobody reads this. ';
  for (let i = 0; i < 60; i++) {
    let text = '# Big note ' + i + '\n\n' + para.repeat(8) + '\n';
    for (let s = 0; s < 4; s++) text += '\n## Part ' + i + '.' + s + '\n\n' + para.repeat(22) + '\n';
    mkdirSync(path.join(bigDir, 'Vol ' + (i % 3)), { recursive: true });
    writeFileSync(path.join(bigDir, 'Vol ' + (i % 3), 'note-' + String(i).padStart(2, '0') + '.md'), text);
  }
}

async function open(browser, user, opts = {}) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, viewport: { width: 1000, height: 900 }, ...opts });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.dialogs = [];
  page.on('dialog', (d) => { page.dialogs.push(d.message()); d.accept(); });
  return { ctx, page, errors };
}
/* `dir` is a folder (the folder picker) or an array of files (the chapter-files picker) */
async function importFolder(page, book, dir) {
  await page.waitForSelector('#rl-import', { timeout: 20000 });
  if (!(await page.$eval('#rl-import', (d) => d.open))) await page.click('#rl-import > summary');
  if (!(await page.$eval('.rl-other', (d) => d.open))) await page.click('.rl-other > summary');
  await page.click('[data-rl="book"][data-book="' + book + '"]');
  await page.setInputFiles(Array.isArray(dir) ? '#rl-files' : '#rl-folder', dir);
  await page.waitForFunction(() => { const b = document.getElementById('rl-go'); return b && !b.disabled; }, null, { timeout: 30000 });
  const preview = (await page.textContent('#rl-preview')).replace(/\s+/g, ' ');
  await page.click('#rl-go');
  await page.waitForFunction(() => /^Imported \d+ entr/.test((document.getElementById('rl-progress') || {}).textContent || ''), null, { timeout: 60000 });
  return preview;
}
const titles = (page) => page.$$eval('.rl-hit', (els) => els.map((e) => e.querySelector('.rl-hit-title').textContent.trim()));
async function search(page, q) { await page.fill('#rl-q', q); await sleep(150); return titles(page); }
async function noOverflow(page) { return page.evaluate(() => { const de = document.documentElement; return { iw: innerWidth, sw: de.scrollWidth, cw: de.clientWidth }; }); }

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).ok; } catch (_) { return false; } }, 90000, 300);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  makeBig();
  const browser = await chromium.launch();

  /* ---------- nobody has imported anything yet ---------- */
  const P = await open(browser, PLAYER);
  await P.page.goto(BASE + '/#rules');
  await P.page.waitForSelector('#rules-page h1');
  await P.page.waitForFunction(() => /GM has not put the rules in/.test(document.getElementById('rules-page').textContent), null, { timeout: 15000 });
  check(true, 'a player sees "the GM has not put the rules in yet" on an empty library');
  check(!(await P.page.$('#rl-import')) && !(await P.page.$('#rl-house')), 'a player has no import panel and no house rule editor');
  const credit = await P.page.textContent('.rl-credit');
  check(credit.includes('This work is based on Blades in the Dark (found at http://www.bladesinthedark.com/), product of One Seven Design, developed and authored by John Harper, and licensed for our use under the Creative Commons Attribution 3.0 Unported license (http://creativecommons.org/licenses/by/3.0/).'), 'the Blades in the Dark credit line is on the page');
  check(/Blades \u201968 text is \u00a9 Evil Hat Productions and is here for this table\u2019s private use/.test(credit), 'the Blades \u201968 copyright line is on the page');

  /* ---------- the GM imports ---------- */
  const G = await open(browser, GM);
  const posts = [];
  G.page.on('request', (r) => { if (r.method() === 'POST' && /\/api\/rules\/import/.test(r.url())) posts.push(JSON.parse(r.postData())); });
  await G.page.goto(BASE + '/#rules');
  await G.page.waitForSelector('#rl-import');
  const nav = await G.page.$eval('#rulesBtn', (b) => ({ hidden: b.hidden, current: b.getAttribute('aria-current') }));
  check(!nav.hidden && nav.current === 'page', 'the Rules button is in the header and marked current');

  let preview = await importFolder(G.page, 'bitd', bigDir);
  check(/60 files read/.test(preview) && /sent in [2-9] parts/.test(preview), 'a big folder previews as 60 files in several parts: ' + preview.slice(0, 120));
  check(posts.length >= 2 && posts.length === posts[0].of && posts.every((b, i) => b.part === i + 1 && b.of === posts.length && b.book === 'bitd' && b.replace === true), 'the upload is chunked: ' + posts.length + ' requests with part / of');
  check(posts.every((b) => JSON.stringify(b).length < 330000 && b.entries.length <= 40), 'every part is about 300 KB or less');
  const big = (await api(GM, 'GET', '/rules')).json;
  check(big.books.bitd === 60 * 5 && big.books.b68 === 0, 'the server holds the 300 entries (each note split at its H1 and H2s): ' + JSON.stringify(big.books));
  check(big.entries[0].title === 'Big note 0' && big.entries[0].src === 'Vol 0/note-00.md' && big.entries[0].trail === 'Vol 0 > note-00', 'order, source and trail come from the folder: ' + JSON.stringify([big.entries[0].title, big.entries[0].src, big.entries[0].trail]));
  posts.length = 0;

  preview = await importFolder(G.page, 'b68', path.join(FIX, 'b68'));
  check(/5 files read \(2 other files ignored/.test(preview) && /8 entries/.test(preview) && /sent in 1 part/.test(preview), 'the fixture previews as 5 notes, 8 entries, .obsidian and the picture ignored: ' + preview.slice(0, 160));
  check(posts.length === 1 && posts[0].replace === true && posts[0].part === 1 && posts[0].of === 1, 'one part for a small folder');
  const b68 = (await api(GM, 'GET', '/rules')).json.entries.filter((e) => e.book === 'b68');
  check(b68.map((e) => e.slug).join() === 'downtime,indulge-vice,personal-business,long-term-project,engagement-roll,heat,hostile-text,loose', 'entries are ordered by path, then position: ' + b68.map((e) => e.slug));
  check(!b68.some((e) => /Hidden|obsidian/i.test(e.title + e.src)), 'nothing from .obsidian was imported');
  const lead = b68[0];
  check(lead.keys === 'Downtime\nRest Phase\nBetween Scores' && !/aliases|^---/m.test(lead.body) && lead.src === 'Chapter One/Downtime.md', 'frontmatter is stripped; its title and aliases became search keys: ' + JSON.stringify(lead.keys));

  /* the same book again, as picked chapter files this time, replaces it (after a confirm) */
  G.page.dialogs.length = 0;
  await importFolder(G.page, 'b68', ['Chapter One/Downtime.md', 'Chapter One/Engagement Roll.md', 'Chapter One/Heat.md', 'Chapter Two/Hostile.md', 'Loose.md'].map((f) => path.join(FIX, 'b68', f)));
  check(G.page.dialogs.some((m) => /Replace the 8 entries/.test(m)), 'importing a book that has entries asks before replacing it');
  check((await api(GM, 'GET', '/rules')).json.books.b68 === 8, 'the book was replaced, not doubled');

  /* the other book: fixtures, replacing the big upload */
  await importFolder(G.page, 'bitd', path.join(FIX, 'bitd'));
  const c = (await api(GM, 'GET', '/rules')).json;
  check(c.books.bitd === 3 && c.books.b68 === 8, 'Blades in the Dark replaced by the 3 fixture entries: ' + JSON.stringify(c.books));
  const sections = await G.page.$$eval('#rl-index .rl-sec > summary', (e) => e.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  check(sections.length === 2 && /^Blades \u201968 \d+ chapters? \u00b7 8 entries$/.test(sections[0]) && /^Blades in the Dark 1 chapter \u00b7 3 entries$/.test(sections[1]), 'the index lists Blades \u201968 first, then the other book: ' + sections.join(' | '));
  const gmExport = await api(GM, 'GET', '/export');
  check(!JSON.stringify(gmExport.json).includes('wobbling lantern'), 'the backup export carries none of it');

  /* ---------- a player searches and reads ---------- */
  const R = await open(browser, PLAYER);
  await R.page.goto(BASE + '/#rules');
  await R.page.waitForSelector('#rl-index .rl-sec', { timeout: 20000 });
  check(!(await R.page.$('#rl-import')), 'still no import panel for the player');
  await R.page.click('#rl-q');
  await R.page.keyboard.type('indulge vice');
  await R.page.waitForSelector('.rl-hit');
  let t = await titles(R.page);
  check(t[0] === 'Indulge Vice', 'search "indulge vice": the entry itself first: ' + t.join(' | '));
  const hit0 = await R.page.$eval('.rl-hit', (e) => ({ book: e.querySelector('.rl-book').textContent, twin: (e.querySelector('.rl-twin > summary') || {}).textContent, marks: e.querySelectorAll('mark').length, twinHidden: !e.querySelector('.rl-twin').open }));
  check(hit0.book === 'Blades \u201968' && hit0.twin === 'In Blades in the Dark' && hit0.twinHidden && hit0.marks >= 2, 'the Blades \u201968 entry leads, the other book folds beneath it in <details>, matches are highlighted: ' + JSON.stringify(hit0));
  await sleep(400);
  check((await R.page.url()).endsWith('#rules?q=indulge%20vice'), 'the query is kept in the address: ' + R.page.url());
  t = await search(R.page, 'downtime');
  check(t[0] === 'Downtime', 'search "downtime": ' + t.join(' | '));
  const dtHref = await R.page.$eval('.rl-hit-title', (a) => a.getAttribute('href'));
  check(dtHref === '#rules/b68/downtime' && (await R.page.$$('.rl-hit')).length === (await R.page.$$eval('.rl-hit-title', (a) => new Set(a.map((x) => x.textContent)).size)), 'the same title appears once (the other book folded in): ' + dtHref);
  t = await search(R.page, 'personal business');
  check(t[0] === 'Personal Business', 'search "personal business": ' + t.join(' | '));
  t = await search(R.page, 'engagement roll');
  check(t[0] === 'Engagement Roll', 'search "engagement roll": ' + t.join(' | '));
  t = await search(R.page, 'rest phase');
  check(t[0] === 'Downtime', 'an alias from the frontmatter finds its note: ' + t.join(' | '));
  t = await search(R.page, 'copper spoon');
  check(t.join() === 'Indulge Vice', 'a body-only match in the other book is found (shown under its Blades \u201968 twin): ' + t.join(' | '));
  t = await search(R.page, 'zzzz nothing');
  check(t.length === 0 && /Nothing matches/.test(await R.page.textContent('#rl-results')), 'no match says so');
  /* ranking: a title match beats a body match */
  t = await search(R.page, 'kettle');
  check(t.length >= 2, 'body matches are found: ' + t.join(' | '));
  t = await search(R.page, 'heat');
  check(t[0] === 'Heat', 'a title match comes before body matches: ' + t.join(' | '));

  /* keyboard: Down from the box into the results, Enter opens */
  await search(R.page, 'downtime');
  await R.page.focus('#rl-q');
  await R.page.keyboard.press('ArrowDown');
  check(await R.page.evaluate(() => document.activeElement.classList.contains('rl-hit-title')), 'ArrowDown moves from the search box to the first result');
  await R.page.keyboard.press('ArrowDown');
  await R.page.keyboard.press('ArrowUp');
  await R.page.keyboard.press('ArrowUp');
  check(await R.page.evaluate(() => document.activeElement.id === 'rl-q'), 'ArrowUp from the first result returns to the box');
  await R.page.keyboard.press('Escape');
  check((await R.page.inputValue('#rl-q')) === '' && (await R.page.$eval('#rl-index', (e) => !e.hidden)), 'Escape clears the search and brings the index back');
  await R.page.keyboard.press('Tab');
  await search(R.page, 'downtime');
  await R.page.focus('#rl-q');
  await R.page.keyboard.press('ArrowDown');
  await R.page.keyboard.press('Enter');
  await R.page.waitForSelector('.rl-entry');
  check((await R.page.url()).endsWith('#rules/b68/downtime') && (await R.page.textContent('#rulesTitle')) === 'Downtime', 'Enter on a result opens the entry');

  /* the entry: wikilinks, embeds, the callout, the folded twin */
  const body = await R.page.$eval('.rl-entry .rl-body', (e) => e.innerHTML);
  const links = await R.page.$$eval('.rl-entry > .rl-body a', (a) => a.map((x) => [x.textContent, x.getAttribute('href')]));
  check(links.some((l) => l[0] === 'Engagement Roll' && l[1] === '#rules/b68/engagement-roll'), 'a wikilink resolves to its entry');
  check(links.some((l) => l[0] === 'vice time' && l[1] === '#rules/b68/indulge-vice'), 'a wikilink with an alias shows the alias and finds the section');
  check(links.some((l) => l[0] === 'Chapter One/Heat' && l[1] === '#rules/b68/heat'), 'a wikilink with a folder path resolves by its file name');
  check(links.some((l) => l[0] === 'Personal Business' && l[1] === '#rules/b68/personal-business'), 'a wikilink inside a callout resolves');
  check(body.includes('Missing Page') && !links.some((l) => /Missing/.test(l[0])), 'an unresolved wikilink is plain text');
  check(!body.includes('lantern.png') && !body.includes('<img'), 'an embedded image is dropped');
  check(await R.page.$('.rl-callout[data-callout="note"] .rl-callout-title'), 'the > [!note] callout renders as a callout');
  const twin = await R.page.$eval('.rl-twin-full', (d) => ({ summary: d.querySelector('summary').textContent, open: d.open, text: d.textContent }));
  check(twin.summary === 'In Blades in the Dark' && !twin.open && /humming teapot/.test(twin.text), 'the other book\'s entry of the same title is folded beneath: ' + twin.summary);
  check(!(await R.page.$('.rl-gmtools')), 'no edit tools for a player');
  await R.page.click('.rl-entry > .rl-body a[href="#rules/b68/engagement-roll"]');
  await R.page.waitForFunction(() => document.getElementById('rulesTitle').textContent === 'Engagement Roll');
  check(true, 'clicking a wikilink opens that entry');
  const eb = await R.page.$$eval('.rl-entry > .rl-body a', (a) => a.map((x) => x.getAttribute('href')));
  check(eb.includes('#rules/b68/indulge-vice'), 'a [[Note#Heading]] link goes to the heading\'s entry: ' + eb);
  await R.page.goBack();
  await R.page.waitForFunction(() => document.getElementById('rulesTitle').textContent === 'Downtime');
  check(true, 'the browser Back button returns to the previous entry');

  /* the book's other entry on its own, and a link back to the first */
  await R.page.goto(BASE + '/#rules/bitd/downtime');
  await R.page.waitForSelector('.rl-entry');
  check(/There is also a Blades \u201968 entry/.test(await R.page.textContent('.rl-alsonote')), 'a Blades in the Dark entry points at its Blades \u201968 twin');
  await R.page.goto(BASE + '/#rules/b68/not-there');
  await R.page.waitForFunction(() => /There is no entry/.test(document.getElementById('rules-page').textContent));
  check(true, 'an unknown entry says so instead of breaking');

  /* ---------- hostile text stays inert ---------- */
  await R.page.goto(BASE + '/#rules/b68/hostile-text');
  await R.page.waitForSelector('.rl-entry');
  await sleep(300);
  const x = await R.page.evaluate(() => ({
    flag: window.__xss,
    badEls: document.querySelectorAll('#rules-page script, #rules-page img, #rules-page iframe, #rules-page style, #rules-page svg').length,
    handlers: [...document.querySelectorAll('#rules-page *')].filter((e) => [...e.attributes].some((a) => /^on/i.test(a.name))).length,
    jsLinks: [...document.querySelectorAll('#rules-page a')].filter((a) => /^\s*javascript:/i.test(a.getAttribute('href') || '')).length,
    text: document.querySelector('.rl-entry .rl-body').textContent,
  }));
  check(x.flag === undefined && x.badEls === 0 && x.handlers === 0 && x.jsLinks === 0, 'hostile text: no script ran, no script / img / iframe element, no on* attribute, no javascript: link: ' + JSON.stringify({ ...x, text: undefined }));
  check(x.text.includes('<script>window.__xss = 1</script>') && x.text.includes('onerror="window.__xss = 2"') && x.text.includes('<script>code</script>'), 'the raw HTML shows as text');

  /* ---------- the "?" links on the sheets ---------- */
  await api(GM, 'PATCH', '/campaign', { crew: { playbook: 'shadows', type: 'Shadows', name: 'The Fixtures' } });
  const Q = await open(browser, GM);
  await Q.page.goto(BASE + '/#t');
  await Q.page.waitForSelector('.tp-clockbox', { timeout: 20000 });
  await sleep(500);
  const tq = await Q.page.$$eval('#table-page .rl-q', (a) => a.map((x) => x.getAttribute('href')));
  check(tq.includes('#rules?q=clock'), 'the table page has a "?" beside the shared clocks: ' + tq);
  check(tq.includes('#rules?q=heat') && tq.includes('#rules?q=wanted%20level') && tq.includes('#rules?q=stacks%20coin'), 'the crew sheet has "?" links for heat, wanted level and stacks: ' + tq);
  check((await Q.page.$$eval('.tp-meta a', (a) => a.map((x) => x.textContent))).includes('Rules'), 'the table page has a Rules link');
  await Q.page.click('.tp-clockbox .rl-q');
  await Q.page.waitForFunction(() => document.body.dataset.mode === 'rules');
  await Q.page.waitForSelector('.rl-hits, .rl-note');
  check((await Q.page.inputValue('#rl-q')) === 'clock', 'a "?" opens the rules with the search filled in');
  await Q.page.goto(BASE + '/');
  await Q.page.waitForSelector('#homeMain [data-hm="rules"]', { timeout: 20000 });
  await Q.page.click('#homeMain [data-hm="rules"]');
  await Q.page.waitForFunction(() => document.body.dataset.mode === 'rules' && location.hash === '#rules');
  check(true, 'Home has an entry point to the rules');
  const sheetDoc = await Q.page.evaluate(async () => {
    const sheet = window.B68.blankSheet(); sheet.playbook = 'hound'; sheet.name = 'Fixture Hound';
    const doc = { v: 2, name: 'Fixture Hound', alias: '', code: '', playbook: 'hound', playbookName: 'Hound', spec: window.B68.BASE_FIGURE, sheet, play: window.B68Tracker.initialPlay(sheet, 'hound') };
    const r = await fetch('/api/characters/fixture-hound', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc) });
    return r.status;
  });
  check(sheetDoc === 200, 'a fixture character is filed');
  await Q.page.goto(BASE + '/?sheet#c/fixture-hound');   /* a fresh load: the roster has the new character */
  await Q.page.waitForSelector('.ds-dtbtns', { timeout: 20000 });
  const sq = await Q.page.$$eval('#dossier .rl-q', (a) => a.map((x) => x.getAttribute('href')));
  for (const want of ['indulge%20vice', 'recover', 'long-term%20project', 'train', 'personal%20business', 'stress', 'clock']) check(sq.includes('#rules?q=' + want), 'the sheet has a "?" for ' + decodeURIComponent(want));
  await Q.page.click('.ds-dtbtns .rl-q');
  await Q.page.waitForFunction(() => document.body.dataset.mode === 'rules');
  check((await Q.page.inputValue('#rl-q')) === 'indulge vice', 'the downtime "?" searches for the activity');
  await Q.page.goBack();
  await Q.page.waitForSelector('.ds-dtbtns');
  check(true, 'Back returns to the sheet');

  /* ---------- house rules (GM) ---------- */
  await G.page.goto(BASE + '/#rules');
  await G.page.waitForSelector('#rl-house');
  await G.page.click('#rl-house [data-rl="edit"][data-slug=""]');
  await G.page.waitForSelector('#rl-h-title');
  await G.page.fill('#rl-h-title', 'Downtime');
  await G.page.fill('#rl-h-body', '# House heading\n\nA made-up **house** ruling about [[Heat]].');
  await G.page.click('details:has(#rl-h-prev) > summary');
  check((await G.page.$eval('#rl-h-prev', (e) => e.innerHTML)).includes('<strong>house</strong>'), 'the house rule editor previews the Markdown');
  await G.page.click('.rl-edit button[type="submit"]');
  await G.page.waitForFunction(() => document.getElementById('rulesTitle') && document.getElementById('rulesTitle').textContent === 'Downtime' && location.hash === '#rules/house/downtime', null, { timeout: 15000 });
  check((await api(PLAYER, 'GET', '/rules')).json.books.house === 1, 'a house rule is saved and readable by players');
  check(!!(await G.page.$('.rl-gmtools [data-rl="edit"]')), 'the GM sees Edit and Delete on a house rule');
  await R.page.goto(BASE + '/?fresh#rules?q=downtime');   /* a fresh load: this page's copy of the corpus predates the house rule */
  await R.page.waitForSelector('.rl-hit');
  const folded = await R.page.$eval('.rl-hit', (e) => [...e.querySelectorAll('.rl-twin > summary')].map((s) => s.textContent));
  check((await titles(R.page))[0] === 'Downtime' && folded.join() === 'House rule,In Blades in the Dark', 'a house rule of the same title folds under the Blades \u201968 entry: ' + folded);
  await G.page.click('.rl-gmtools [data-rl="delhouse"]');
  await G.page.waitForFunction(() => location.hash === '#rules');
  await sleep(500);
  check((await api(GM, 'GET', '/rules')).json.books.house === 0, 'the house rule can be deleted');

  /* ---------- the offline copy ---------- */
  const O = await open(browser, PLAYER);
  await O.page.goto(BASE + '/#rules');
  await O.page.waitForSelector('#rl-index .rl-sec');
  await sleep(600);
  const cached = await O.page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('b68-rules', 1);
    r.onsuccess = () => { const q = r.result.transaction('kv').objectStore('kv').getAll(); q.onsuccess = () => res(q.result.map((v) => ({ n: v.entries.length, version: !!v.version, leaked: v.entries.some((e) => '_b' in e) }))); };
    r.onerror = () => res(null);
  }));
  check(cached && cached.length === 1 && cached[0].n === 11 && cached[0].version && !cached[0].leaked, 'the corpus is kept in IndexedDB for this user: ' + JSON.stringify(cached));
  await O.ctx.route('**/api/rules*', (route) => route.abort());
  await O.page.goto(BASE + '/#rules?q=zebra');
  await O.page.reload();
  await O.page.waitForSelector('.rl-hit', { timeout: 15000 });
  check((await titles(O.page))[0] === 'Indulge Vice', 'search works from the saved copy when the rules cannot be fetched');
  check(/offline/.test(await O.page.textContent('#rl-status')), 'the page says it is showing the copy saved on the device: ' + (await O.page.textContent('#rl-status')));
  await O.ctx.unroute('**/api/rules*');

  /* ---------- the artifact build: no rules API ---------- */
  const A = await open(browser, PLAYER);
  await A.page.addInitScript(() => { window.claude = { use: () => Promise.resolve(null) }; });
  await A.page.goto(BASE + '/#rules');
  await A.page.waitForFunction(() => /available on the hosted app/.test(document.getElementById('rules-page').textContent), null, { timeout: 15000 });
  check(true, 'without window.claude.rules the page says "Rules are available on the hosted app"');
  check((await A.page.$$('#rules-page .rl-q, .rl-q')).length === 0 && (await A.page.$eval('#rulesBtn', (b) => b.hidden)), 'no Rules button and no "?" links without the rules API');
  await A.page.goto(BASE + '/#t');
  await sleep(800);
  check((await A.page.$$('.rl-q')).length === 0, 'no "?" links on the table page without the rules API');

  /* ---------- a phone ---------- */
  const M = await open(browser, GM, { viewport: { width: 360, height: 740 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  for (const [name, hash] of [['index', '#rules'], ['search', '#rules?q=downtime'], ['entry with a wide table', '#rules/b68/indulge-vice'], ['entry with hostile text', '#rules/b68/hostile-text'], ['entry with a callout', '#rules/b68/downtime']]) {
    await M.page.goto(BASE + '/' + hash);
    await M.page.waitForSelector('#rules-page h1');
    await M.page.waitForFunction(() => !/Opening the rules/.test(document.getElementById('rules-page').textContent), null, { timeout: 15000 });
    await sleep(500);
    const l = await noOverflow(M.page);
    check(l.iw === 360 && l.sw <= l.cw, 'phone 360px, ' + name + ': no sideways scroll (scrollWidth ' + l.sw + ', clientWidth ' + l.cw + ')');
  }
  await M.page.goto(BASE + '/#rules');
  await M.page.waitForSelector('#rl-import');
  await M.page.click('#rl-import > summary');
  await M.page.click('#rl-house [data-rl="edit"][data-slug=""]');
  await sleep(300);
  const lm = await noOverflow(M.page);
  check(lm.sw <= lm.cw, 'phone 360px, GM import panel and house rule editor open: no sideways scroll (' + lm.sw + ' / ' + lm.cw + ')');
  const tw = await (async () => { await M.page.goto(BASE + '/#rules/b68/indulge-vice'); await M.page.waitForSelector('.rl-tablewrap'); return M.page.$eval('.rl-tablewrap', (w) => ({ scrolls: w.scrollWidth > w.clientWidth, boxW: w.getBoundingClientRect().width })); })();
  check(tw.scrolls && tw.boxW <= 360, 'the wide table scrolls inside its own box on a phone: ' + JSON.stringify(tw));

  const all = [P, G, R, Q, O, A, M].flatMap((s) => s.errors).filter((e) => !/Failed to load resource|net::ERR_FAILED/.test(e));
  check(all.length === 0, 'no console errors' + (all.length ? ': ' + all.join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
} finally {
  clearTimeout(timeout);
  killServer('SIGTERM');
  const t0 = Date.now(); while (server.exitCode === null && server.signalCode === null && Date.now() - t0 < 5000) await sleep(100);
  killServer('SIGKILL');
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
