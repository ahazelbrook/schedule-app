// THE SITE (the GM night rebuild, N3; app/gm/site.js, app/gm/run-view.js) on the real GM page and a real local Worker (wrangler dev, DEV_USER) on PORT (default 8760),
// with the INVENTED Pelican Rooms (fixtures/gm/pelican-play-v2.json) and an invented cast (a revealed person and a GM-ONLY- hidden one). It checks what the brief asks:
// ONE alarm readout (the table clock's segments and the security level from the prep's security: line; Spotted ticks it; a hidden clock keeps the level off the iPad),
// select a room -> its card -> the Players' map (Dark / Blueprint at once, Seen stages, Send through B68GmStage opens), the people rows (Spotlight, the expressions,
// Take it down, a hidden person's Reveal and show? refused), If it goes wrong -> the Roll, the ⋯ items (the Costume engine), the Montage inline (N2's registry) with its
// glow past the budget, Location without the old boxes, and secrecy: no GM-ONLY- text in the display GET at any point. No model, $0.
//   PW_MODULE=<playwright install> PW_CHANNEL=msedge [PORT=8760] [GM_SHOTS=<dir>] node checks/runtime/gm-site.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8760);
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
const NAME = 'The Pelican Rooms', HIDDEN = 'GM-ONLY-Hidden Partner';
const ROOMS = [
  { name: 'Showroom', band: 'public', detail: 'Chairs.' }, { name: 'Cocktail lounge', band: 'public', detail: 'Glass.' },
  { name: 'Security control room', band: 'working', detail: 'Screens.' }, { name: 'Private card rooms', band: 'controlled', detail: 'Cards.' },
  { name: 'Underground counting room', band: 'working', detail: 'Coins.' }, { name: 'Luxury penthouse', band: 'secure', isTarget: true, detail: 'The strongbox.' }];
const checked = BALL.checkPlay(V2, ROOMS.map((r) => r.name));
if (checked.warnings.length) { console.log('FAIL the fixture play has warnings: ' + checked.warnings.join(' | ')); process.exit(1); }
const PREP = '# Gala prep\n\nsecurity: Hush > Eyes > Bells > Hounds > Walls\n\n## Rooms\n\n### Showroom\n- **Who:** Odette Marsh, ' + HIDDEN + '\n- If it goes wrong: GM-ONLY-the guard turns\n\n> [!quote] SAY\n> Welcome to the gala.\n\n### Private card rooms\n- **Costume:** Evening dress.\n';
const PARTS = {
  console: conFix.parts.console, campaign: { ...conFix.parts.campaign, src: { ...conFix.parts.campaign.src, exportedAt: NOW }, cards: { 'Odette Marsh': '# Odette Marsh\n\nODETTECARD-BODY runs the house.' } },
  prep: { src: { file: 'fixture/prep', exportedAt: NOW }, vault: 'Fixture', links: {}, notes: [{ id: 'n-gala', rel: 'Sessions/gala.md', title: 'Gala prep', blocks: [{ k: 'md', src: PREP }] }] },
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: NOW }, T: locFix.T, extra: locFix.extra,
    authored: { v: 1, sites: { [NAME]: { name: NAME, rel: 'x', map: { view: 'iso', theme: 'rulebook' }, patch: { district: 'Nowhere Ward', rooms: ROOMS }, play: checked.play } }, bind: {} } }
};

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-site-e2e-' + PORT + '-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
delete env.B68_ANTHROPIC_KEY; delete env.ANTHROPIC_API_KEY;
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
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 480000);
const api = (method, p, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const ball = async () => ((await api('GET', '/gm/state')).json.doc || {}).ball || {};
const ambient = async () => ((await api('GET', '/gm/ambient')).json || {}).doc || {};
const displayText = async () => JSON.stringify((await api('GET', '/gm/display')).json || {});
const secret = [];          /* every display GET we take is kept and scanned for GM-ONLY- text at the end, and at each step */
async function noLeak(step) { const t = await displayText(); secret.push(t); check(!/GM-ONLY/.test(t) && !t.includes(HIDDEN), 'secrecy, ' + step + ': nothing GM-only in the display GET'); }
const clocks = (filled, hidden) => api('PATCH', '/campaign', { clocks: [{ id: 'c_fuse', name: 'Fuse', size: 6, filled, kind: 'danger', hidden }], updatedAt: new Date().toISOString() });
const layer = (doc, p) => { let l = doc && doc.layers; for (const k of p.split('.')) { if (!l || typeof l !== 'object') return undefined; l = l[k]; } return l; };      /* the lasting layers are nested: band.security */

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src || {}, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  check((await api('PUT', '/campaign', { v: 1, session: { number: 1, startedAt: NOW, endedAt: null },
    crew: { name: 'The Lamplighters', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] },
    clocks: [{ id: 'c_fuse', name: 'Fuse', size: 6, filled: 2, kind: 'danger', hidden: false }], log: [] })).status === 200, 'the table holds the Fuse, 2/6, shown to the players');
  check((await api('PUT', '/npcs/npc-od', { name: 'Odette Marsh', role: 'The house', revealed: true, firstSeen: NOW, gmNotes: 'Tell: smirk\nSignature: lapel\nRelation: society' })).status === 200, 'a revealed person, with a tell and a signature');
  check((await api('PUT', '/npcs/npc-hp', { name: HIDDEN, role: 'GM-ONLY-ROLE', revealed: false, gmNotes: 'GM-ONLY-NOTE' })).status === 200, 'a hidden person, on the Showroom\'s Who: line');

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
  const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.mouse.move(1, 1); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };

  /* the PCs, filed through the page's own adapter, then the site on the Location card with the night started at 21:45, one PC in the Showroom */
  const G0 = await open();
  const spec = await G0.page.evaluate(() => window.B68.BASE_FIGURE);
  await G0.c.close();
  const pcDoc = (name) => ({ v: 2, name, alias: '', code: '', playbook: 'hound', playbookName: 'Hound', spec, sheet: { name }, play: { vice: '', purveyor: '', contacts: [], clocks: [] } });
  for (const [id, n] of [['site-pc1', 'Cass Fenn'], ['site-pc2', 'Dov Ketch']]) check((await api('PUT', '/characters/' + id, pcDoc(n))).status === 200, 'an invented PC is filed: ' + n);
  check((await api('PATCH', '/gm/state', { cards: { location: { hid: 'h_site', auth: NAME, label: NAME + ' · Nowhere Ward', at: NOW } },
    loc: { map: { view: 'iso', theme: 'rulebook', layer: 'gm', reveal: { public: true, working: false, controlled: false, secure: false } } },
    ball: { site: NAME, v: 2, start: 45, t: 45, crew: { 'site-pc1': { room: 'Showroom' } } } })).status === 200, 'the v2 site, the night at 21:45, Cass Fenn in the Showroom');

  const G = await open();
  await G.page.keyboard.press('g');
  await G.page.waitForSelector('.rv-head', { timeout: 20000 });
  await G.page.click('[data-rv="view"][data-v="board"]').catch(() => {});
  await G.page.waitForSelector('.rv-card[data-room="Showroom"]', { timeout: 20000 });

  /* ---- 1. the header: one line, ONE alarm readout ---- */
  const geo = await G.page.evaluate(() => {
    const h = document.querySelector('.rv-head').getBoundingClientRect(), kids = [...document.querySelectorAll('.rv-head > *')].filter((e) => e.offsetParent && e.getBoundingClientRect().width > 0);
    return { h: h.height, top: h.top, bottom: h.bottom, inside: kids.every((e) => { const r = e.getBoundingClientRect(); return r.top >= h.top - 1 && r.bottom <= h.bottom + 1 && r.right <= h.right + 1; }), rows: new Set(kids.map((e) => { const r = e.getBoundingClientRect(); return Math.round((r.top + r.bottom) / 2 / 12); })).size };
  });
  check(geo.inside && geo.h < 60 && geo.rows === 1, 'the header is ONE line at 1366x768 (' + JSON.stringify(geo) + ')');
  check((await G.page.$$('.rv-alarm')).length === 1, 'one alarm readout');
  const rd = () => G.page.$eval('.rv-alarm', (e) => ({ t: e.textContent.replace(/\s+/g, ' ').trim(), title: e.title, f: e.querySelectorAll('.rv-segs i.f').length, n: e.querySelectorAll('.rv-segs i').length, quiet: e.classList.contains('quiet') }));
  let a = await rd();
  check(/Eyes/.test(a.t) && a.f === 2 && a.n === 6 && /^Fuse 2 of 6/.test(a.title) && !a.quiet, 'it merges the site alarm clock (Fuse 2/6) and the level from the prep\'s security: line (Eyes): ' + JSON.stringify(a));
  check(!!(await until(async () => layer(await ambient(), 'band.security') === 1, 8000)), 'the clock is shown to the players: the iPad\'s band carries the level (band.security 1)');
  await G.page.click('.rv-alarm');
  check(/Fuse 2: GM-ONLY-BEAT-2/.test((await G.page.textContent('.rv-alarmpop')).replace(/\s+/g, ' ')), 'the readout\'s popover says what this beat of the alarm does (GM only)');
  await G.page.keyboard.press('Escape');
  check(await until(async () => (await G.page.$$('.rv-alarmpop')).length === 0, 3000), 'Esc shuts it');
  await G.page.click('.rv-tools [data-site="spotted"]');
  check(!!(await until(async () => { const r = await rd(); return r.f === 3 && /Bells/.test(r.t) ? r : null; }, 10000)), 'Spotted ticks the alarm: 3/6, and the level reads Bells');
  check(!!(await until(async () => layer(await ambient(), 'band.security') === 2, 8000)), 'and the iPad\'s band follows (band.security 2)');
  await noLeak('the alarm');
  check((await clocks(5, true)).status === 200, 'the GM hides the Fuse from the players and it runs on to 5/6');
  await G.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  check(!!(await until(async () => { const r = await rd(); return r.quiet && /Hounds/.test(r.t) ? r : null; }, 15000)), 'the readout follows on the GM screen (Hounds), dashed: hidden');
  check(!!(await until(async () => [null, undefined].includes(layer(await ambient(), 'band.security')), 8000)), 'and the level comes off the iPad while the clock is hidden');
  await sleep(1500);
  check(!/Hounds/.test(JSON.stringify(await ambient())), 'no level name was flashed on the iPad for a hidden clock');
  await clocks(2, false);
  await shot(G.page, 'site-01-header');

  /* ---- 2. select a room, then act: the Players' map ---- */
  const seg = (k) => '.rv-rm.sel [data-site="kn"][data-k="' + k + '"]';
  const pressed = () => G.page.$$eval('.rv-rm.sel [data-site="kn"][aria-pressed="true"]', (l) => l.map((e) => e.getAttribute('data-k')).join());
  const stage = () => G.page.evaluate(() => window.B68GmStage.state());
  await G.page.click('.rv-card[data-room="Private card rooms"] .rv-cn');
  check(await G.page.$eval('.rv-rm.sel', (e) => e.getAttribute('data-room')) === 'Private card rooms' && await G.page.$eval('.rv-card[data-room="Private card rooms"]', (e) => e.classList.contains('sel')), 'a tap selects the room: its card on the right, the board marks it');
  check((await pressed()) === 'dark', 'the Players\' map: Dark');
  await G.page.click(seg('blueprint'));
  check(!!(await until(async () => ((await ball()).know || []).includes('Private card rooms'), 8000)) && (await stage()).staged === 0, 'Blueprint at once (ball.know), nothing staged');
  await G.page.click(seg('seen'));
  check((await stage()).staged === 1 && !((await ball()).open || []).length && await G.page.$eval('.rv-card[data-room="Private card rooms"]', (e) => e.classList.contains('staged')), 'Seen stages it: amber, nothing open yet');
  await G.page.click('.rv-card[data-room="Luxury penthouse"] .rv-cn'); await G.page.click(seg('seen'));
  check((await stage()).staged === 2 && /Send 2/.test(await G.page.textContent('.rv-tools [data-site="send"]')), 'a second room staged: Send 2 in the toolbar');
  await shot(G.page, 'site-02-staged');
  await noLeak('staging');
  check(await G.page.evaluate(() => window.B68GmStage.send()) === true, 'B68GmStage.send() (what the band\'s iPad tray calls) sends them');
  check(!!(await until(async () => { const b = await ball(); return (b.open || []).includes('Private card rooms') && (b.open || []).includes('Luxury penthouse') && !(b.know || []).length ? b : null; }, 8000)), 'both rooms are open, and the blueprint one left ball.know');
  check((await stage()).staged === 0 && (await pressed()) === 'seen', 'nothing staged; the selected room reads Seen');
  await G.page.click(seg('dark'));
  check(!!(await until(async () => !((await ball()).open || []).includes('Luxury penthouse'), 8000)), 'Dark at once: the penthouse is shut again');

  /* ---- 3. the people ---- */
  await G.page.click('.rv-card[data-room="Showroom"] .rv-cn');
  const rows = await G.page.$$eval('.rv-rm.sel .rv-p', (l) => l.map((e) => e.getAttribute('data-pid') + ':' + e.className));
  check(rows.some((r) => r.startsWith('npc-od:')) && rows.some((r) => r.startsWith('npc-hp:') && /hidden/.test(r)), 'Who\'s here: Odette (in the play, here now) and the hidden person (the Who: line): ' + rows.join(' | '));
  check((await G.page.$$('.rv-rm.sel .rv-p[data-pid="npc-od"] [data-site="card"]')).length === 1, 'Card, where the cast has one');
  await G.page.click('.rv-rm.sel .rv-p[data-pid="npc-od"] [data-site="spot"]');
  const ov = await until(async () => { const o = (await ambient()).overlay; return o && o.kind === 'npc' && o.npcId === 'npc-od' ? o : null; }, 8000);
  check(!!ov && /^b17sl-/.test(ov.id), 'Spotlight holds her on the iPad (' + JSON.stringify(ov) + ')');
  await G.page.waitForSelector('.rv-rm.sel .rv-p.held [data-site="expr"]', { timeout: 8000 });
  check(/On the iPad/.test(await G.page.textContent('.rv-rm.sel .rv-p.held [data-site="spot"]')), 'her row says she is on the iPad');
  await G.page.click('.rv-rm.sel .rv-p.held [data-site="expr"][data-expr="hostile"]');
  check(!!(await until(async () => { const o = (await ambient()).overlay; return o && o.look && o.look.expr === 'hostile' ? o : null; }, 8000)), 'Hostile: the held portrait carries the look');
  check(await G.page.$eval('.rv-rm.sel .rv-p.held [data-expr="hostile"]', (e) => e.getAttribute('aria-pressed') === 'true'), 'and Hostile is pressed');
  await shot(G.page, 'site-03-held');
  await G.page.click('.rv-card[data-room="Luxury penthouse"] .rv-cn');
  check((await G.page.$$('.rv-rm.sel .rv-p.held [data-site="down"]')).length === 1, 'held, and looking at another room: the top card still offers Take it down');
  await G.page.click('.rv-rm.sel .rv-p.held [data-site="down"]');
  check(!!(await until(async () => { const o = (await ambient()).overlay; return !o || o.npcId !== 'npc-od' ? true : null; }, 8000)), 'Take it down: her portrait comes off the iPad');
  await G.page.click('.rv-card[data-room="Showroom"] .rv-cn');
  answer.no = true; asked.length = 0;
  await G.page.click('.rv-rm.sel .rv-p[data-pid="npc-hp"] [data-site="spot"]');
  await sleep(1200);
  check(asked.length === 1 && /^Reveal and show\?/.test(asked[0]), 'a hidden person asks "Reveal and show?" first');
  const hp = (await api('GET', '/npcs')).json.docs.find((d) => d.id === 'npc-hp');
  check(!!hp && hp.revealed !== true && !(((await ambient()).overlay || {}).npcId === 'npc-hp'), 'a no: still hidden, nothing on the iPad');
  answer.no = false;
  await noLeak('the people');

  /* ---- 4. If it goes wrong -> the Roll: with N4's B68GmPage.setThreat, its one line (#gm-c-threat, the console's Threat, which is on the page before N4
     too); until then the stamp's own line ---- */
  const n4 = await G.page.evaluate(() => !!(window.B68GmPage && typeof window.B68GmPage.setThreat === 'function'));
  await G.page.click('.rv-rm.sel .rv-wrong [data-site="threat"]');
  check(!!(await until(() => G.page.evaluate((withN4) => { const i = withN4 ? document.querySelector('#gm-c-threat') : document.querySelector('#gm-stamp input, #gm-stamp .gm-st-text'); return !!i && i.value === 'GM-ONLY-the guard turns'; }, n4), 5000)),
    '"→ the Roll" puts the room\'s line in the Roll\'s line (' + (n4 ? 'B68GmPage.setThreat, N4' : 'no N4 yet: the stamp\'s own line') + ')');
  check(!(await G.page.$eval('.rv-rm.sel .rv-rmnote', (e) => /the guard turns/.test(e.textContent))), 'and the note no longer repeats it');

  /* ---- 5. ⋯ ---- */
  await G.page.click('[data-rv="menu"]');
  const items = await G.page.$$eval('#rv-menu button', (l) => l.map((b) => b.textContent.trim()));
  check(items[0] === 'Back to now' && items.includes('False dawn') && items.includes('End the night') && items.includes('Costume engine: hidden') && items[items.length - 1] === 'Reset the night', 'the ⋯ menu: ' + items.join(' | '));
  await shot(G.page, 'site-04-menu');
  await G.page.click('#rv-menu [data-site="costume"]');
  check(await G.page.evaluate(() => document.body.classList.contains('gm-show-costume') && localStorage.getItem('b68.gm.costume') === '1'), 'the Costume engine shows the Disguise select (this device only)');
  await G.page.click('[data-rv="menu"]'); await G.page.click('#rv-menu [data-site="costume"]');
  check(await G.page.evaluate(() => !document.body.classList.contains('gm-show-costume') && !localStorage.getItem('b68.gm.costume')), 'and puts it away again');
  await G.page.click('[data-rv="menu"]');
  await G.page.keyboard.press('Escape');
  check(await G.page.$eval('#rv-menu', (e) => e.hidden), 'Esc shuts the menu');

  /* ---- 6. Montage, inline (N2's registry), glowing past the budget ---- */
  check((await api('PATCH', '/gm/state', { night: { v: 1, phase: 'score', phases: { pb: {}, plan: {}, score: { budget: 1, start: Date.now() - 10 * 60000, end: null }, after: {} } } })).status === 200, 'the night is in the score, ten minutes into a one-minute budget');
  await G.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  check(!!(await until(() => G.page.$eval('.rv-tools [data-site="montage"]', (e) => e.classList.contains('glow')).catch(() => false), 15000)), 'Montage glows: the score is past its budget');
  await G.page.click('.rv-tools [data-site="montage"]');
  check(!!(await until(() => G.page.evaluate(() => !!document.querySelector('.rv-side .rv-sec[data-sec="tool"] .gm-inline [data-mt-pick]') && window.B68GmWorkshop.bound('montage')), 8000)), 'it opens INLINE at the top of the right column, a row per PC, bound through B68GmWorkshop.inline');
  check((await G.page.$$('#gm-sheet-montage:not([hidden])')).length === 0, 'not in a right-edge sheet');
  await shot(G.page, 'site-05-montage');
  await G.page.click('[data-rv="next"]');
  check(!!(await until(() => G.page.evaluate(() => !!document.querySelector('.rv-sec[data-sec="tool"] .gm-inline [data-mt-pick]')), 5000)), 'it stays through a redraw of the site');
  await G.page.click('[data-rv="back"]');
  await G.page.keyboard.press('Escape');
  check(!!(await until(() => G.page.evaluate(() => !document.querySelector('.rv-sec[data-sec="tool"]') && !window.B68GmWorkshop.bound('montage')), 5000)), 'Esc closes it and unbinds it');

  /* ---- 7. Location keeps its Map section, without the old boxes ---- */
  await G.page.keyboard.press('b');
  await G.page.waitForSelector('#gm-loc .gm-mapbox', { timeout: 10000 });
  check((await G.page.$$('#gm-b17, #gm-b24')).length === 0 && (await G.page.$$('#gm-loc [data-gm="ipad"]')).length === 1 && (await G.page.$$('#gm-loc [data-gm="scorescene"]')).length === 1, 'Location: Show on iPad and Set as score scene stay; the stage and knowledge boxes are gone');
  await noLeak('the end');
  check(secret.every((t) => !/GM-ONLY/.test(t)), 'no display GET taken in this run held GM-only text');
  check(!errors.length, 'no page errors: ' + errors.slice(0, 3).join(' | '));
  await G.c.close();
  await browser.close();
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
clearTimeout(timeout);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
