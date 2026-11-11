// night-who (Start the night, KS11 of the kit and stage build) on the real GM page, Worker and campaign document, with the night.who setting on.
//   1. Before leads with one Primary, Start the night; Before's own Next is no longer a Primary
//   2. the sheet: the three filed characters with their players' names, Tam unticked (the RSVP said no), session 5 (the counter + 1) beside the
//      Prep note's 4.5; Start with two of three
//   3. the campaign document: session 5, session.present = the two ids stamped with startedAt, session 5's attendance, the log line; the night log;
//      the page moves to the Opening
//   4. the trace (KS11.6): the band chip, listening's session (it was already on, at 4), the iPad's GET (which stamps the transcript, and so
//      Blade's log), After's line, and the export that End the night downloads
//   5. one name, one job: the Run view's own control reads Start the clock
//   6. After's End the night also ends the session; Before then offers session 6
//   7. the setting off: no button, Before's Next is the Primary again, the Run view says Start the night, as before
// Every name is invented. SHOTS=<dir> writes the pictures (Before, the sheet, After; Paper and Night; 1366x768 and 1536x864).
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9409] [SHOTS=<dir>] node checks/runtime/night-who.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9409);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const SHOTS = process.env.SHOTS || '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), V2 = fx('pelican-play-v2.json');
const NOW = new Date().toISOString();

const SITE = 'The Pelican Rooms';
const ROOMS = [
  { name: 'Showroom', band: 'public', detail: 'Chairs.' }, { name: 'Cocktail lounge', band: 'public', detail: 'Glass.' },
  { name: 'Security control room', band: 'working', detail: 'Screens.' }, { name: 'Private card rooms', band: 'controlled', detail: 'Cards.' },
  { name: 'Underground counting room', band: 'working', detail: 'Coins.' }, { name: 'Luxury penthouse', band: 'secure', isTarget: true, detail: 'The strongbox.' }];
const PARTS = {
  console: con.parts.console, campaign: { ...con.parts.campaign, src: { ...con.parts.campaign.src, exportedAt: NOW } },
  prep: { src: { file: 'fixture/prep', exportedAt: NOW }, vault: 'Fixture', links: {},
    notes: [{ id: 'n-s45', rel: 'Sessions/s45.md', title: 'The Pelican Rooms, part two', session: '4.5', blocks: [{ k: 'md', src: '# The Pelican Rooms, part two\n\n## Before the night\n\n- Chairs out.\n' }] }] },
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: NOW }, T: loc.T, extra: loc.extra,
    authored: { v: 1, sites: { [SITE]: { name: SITE, rel: 'x', map: { view: 'iso', theme: 'rulebook' }, patch: { district: 'Nowhere Ward', rooms: ROOMS }, play: V2 } }, bind: {} } },
};
// the Dovetail Crew: three players, three characters; Tam's player said no to tonight
const PLAYERS = [['nell.player@example.test', 'Mabel Quist', 'ch-nell', 'Nell Arbuthnot'], ['ray.player@example.test', 'Dov Kessler', 'ch-ray', 'Ray Okonjo'], ['tam.player@example.test', 'Ada Vell', 'ch-tam', 'Tam Petrakis']];

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-who-e2e-'));
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

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 420000);
const api = (method, p, body, who = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': who, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const campaign = async () => (await api('GET', '/campaign')).json.doc;
const gmState = async () => (await api('GET', '/gm/state')).json.doc;
const crew = { name: 'The Dovetail Crew', type: '', lair: 'The Pelican Rooms', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] };

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src || {}, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  for (const [email, name] of PLAYERS) await api('PATCH', '/me', { name }, email);
  // session 4 was played and ended; the next one is now, and two players answered (an answer's `at` is the session it is for)
  const next = new Date(Date.now() - 10 * 60000).toISOString();
  const put = await api('PUT', '/campaign', { v: 1, session: { number: 4, startedAt: '2026-11-07T08:30:00.000Z', endedAt: '2026-11-07T12:10:00.000Z' }, crew, clocks: [],
    log: [{ at: '2026-11-07T12:10:00.000Z', by: GM, text: 'Session 4 ended' }],
    schedule: { options: {}, avail: {}, next: { at: next, minutes: 240, place: '', note: '', confirmedAt: null }, cadence: null, quorum: 0, attendance: {},
      rsvp: { 'nell.player@example.test': { at: next, v: 'in' }, 'tam.player@example.test': { at: next, v: 'out' } } } });
  check(put.status === 200, 'the table: session 4 ended, the next session now, Tam\'s player said no');
  check((await api('PATCH', '/gm/state', { features: { 'night.who': true }, cards: { location: { hid: 'h_who', auth: SITE, label: SITE + ' · Nowhere Ward', at: NOW } } })).status === 200, 'night.who is on');
  check((await api('PATCH', '/gm/stt', { want: 'on', session: '4' })).status === 200, 'listening is already on, at session 4');

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [], asked = [];
  async function open(w = 1366, h = 768, theme = '') {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w, height: h }, serviceWorkers: 'block', acceptDownloads: true, colorScheme: theme === 'night' ? 'dark' : 'light' });
    await c.addInitScript(atPlace('before'));
    if (theme) await c.addInitScript({ content: 'try { localStorage.setItem("b68.theme", ' + JSON.stringify(theme === 'night' ? 'dark' : 'light') + '); } catch (e) {}' });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('dialog', (d) => { asked.push(d.message()); return d.accept(); });
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
    return { c, page };
  }
  const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };

  /* ---- 1. Before ---- */
  const G = await open();
  const page = G.page;
  /* the characters are filed once the page can give the base figure (the roster lists only characters with one) */
  const spec = await page.evaluate(() => window.B68.BASE_FIGURE);
  for (const [email, , id, name] of PLAYERS) {
    const r = await api('PUT', '/characters/' + id, { v: 2, name, alias: '', code: '', playbook: 'hound', playbookName: 'Hound', owner: email, spec, sheet: { name }, play: { vice: '', purveyor: '', contacts: [], clocks: [] } });
    if (r.status !== 200 || r.json.doc.owner !== email) throw new Error('character ' + id + ' -> ' + r.status);
  }
  await page.reload();
  await page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
  check(!!(await page.waitForSelector('#gm-left .who-lead [data-who="open"]', { timeout: 20000 }).catch(() => null)), 'Before leads with Start the night');
  check(await page.$eval('#gm-left', (l) => l.firstElementChild && l.firstElementChild.classList.contains('who-lead')), 'at the top of the left column');
  const prim = await page.$$eval('#gm-left .btn.primary', (l) => l.filter((b) => b.offsetParent !== null).map((b) => b.textContent.trim()));
  check(prim.length === 1 && prim[0] === 'Start the night', 'one Primary in Before: ' + JSON.stringify(prim));
  check(await page.$eval('#gm-left [data-place-next="opening"]', (b) => !b.classList.contains('primary') && b.classList.contains('gm-pnext-go')), 'Before\'s own Next stays, as a Standard button with its hooks');
  check(/session 5/.test(await page.textContent('#gm-left .who-lead-sub')), 'the line under it names session 5: ' + await page.textContent('#gm-left .who-lead-sub'));
  check(await page.textContent('#gm-bar-sess') === 'Session 4', 'the band says Session 4 before the start');
  await shot(page, 'before-paper-1366');

  /* ---- 2. the sheet ---- */
  await page.click('#gm-left [data-who="open"]');
  await page.waitForSelector('#gm-who-sheet:not([hidden])', { timeout: 5000 });
  const rows = () => page.$$eval('#gm-who-sheet .who-row', (l) => l.map((b) => [b.getAttribute('data-who-pc'), b.getAttribute('aria-pressed'), b.textContent]));
  await until(async () => /Mabel Quist/.test(JSON.stringify(await rows())), 4000);
  const r1 = await rows();
  check(r1.length === 3, 'every filed character is a row: ' + r1.map((r) => r[0]).join(', '));
  const tick = Object.fromEntries(r1.map((r) => [r[0], r[1]]));
  check(tick['ch-tam'] === 'false' && tick['ch-nell'] === 'true' && tick['ch-ray'] === 'true', 'Tam unticked (the RSVP said no), the others ticked: ' + JSON.stringify(tick));
  check(['Mabel Quist', 'Dov Kessler', 'Ada Vell'].every((n) => JSON.stringify(r1).includes(n)), 'with the players\' names');
  check(await page.$eval('#gm-who-sheet [data-who-n]', (i) => i.value) === '5', 'session 5: the counter plus one');
  check(/the Prep note says 4\.5/.test(await page.textContent('#gm-who-sheet .who-num-sub')), 'beside the Prep note\'s 4.5');
  check(await page.$eval('#gm-who-sheet [data-who="start"]', (b) => b.textContent.trim()) === 'Start session 5', 'the sheet\'s Primary: Start session 5');
  check(await page.$$eval('#gm-who-sheet .btn.primary', (l) => l.length) === 1, 'one Primary in the sheet');
  await shot(page, 'sheet-paper-1366');
  await page.keyboard.press('Escape');
  check(!!(await until(() => page.$eval('#gm-who-sheet', (s) => s.hidden), 2000)), 'Esc closes the sheet (B68GmEsc)');
  await page.click('#gm-left [data-who="open"]');
  await page.waitForSelector('#gm-who-sheet:not([hidden])', { timeout: 5000 });

  /* ---- 3. Start ---- */
  await page.click('#gm-who-sheet [data-who="start"]');
  const d1 = await until(async () => { const d = await campaign(); return d.session.number === 5 ? d : null; }, 8000);
  check(!!d1, 'the table holds session 5');
  const at = d1 && d1.session.startedAt;
  check(!!d1 && !d1.session.endedAt && Date.parse(at) > Date.now() - 60000, 'started now, not ended: ' + at);
  check(!!d1 && JSON.stringify(d1.session.present) === JSON.stringify({ 'ch-nell': at, 'ch-ray': at }), 'two of three are present, stamped with the start: ' + JSON.stringify(d1 && d1.session.present));
  check(!!d1 && JSON.stringify(d1.schedule.attendance['5']) === JSON.stringify({ 'nell.player@example.test': true, 'ray.player@example.test': true, 'tam.player@example.test': false }), 'session 5\'s attendance');
  check(!!d1 && d1.schedule.next === undefined && d1.log[0].text === 'Session 5 started' && d1.log[0].by === GM, 'the table\'s own writes: next gone, the log line');
  const nl = await until(async () => { const s = await gmState(); const l = s.night && s.night.log ? Object.values(s.night.log) : []; return l.find((e) => /^Session 5 started · 2 playing$/.test(e.text)); }, 5000);
  check(!!nl, 'the night log: Session 5 started · 2 playing');
  check(!!(await until(() => page.$eval('[data-band-place="opening"]', (b) => b.getAttribute('aria-current') === 'true'), 4000)), 'the page moves to the Opening');
  check(await page.$eval('#gm-who-sheet', (s) => s.hidden), 'and the sheet closes');

  /* ---- Gate 2: the roster survives a real PATCH, a reload and a whole-document write (the table removing a log line) ---- */
  const leadSub = async () => { await page.click('[data-band-place="before"]'); await page.waitForSelector('#gm-left .who-lead-sub', { timeout: 8000 }); return page.textContent('#gm-left .who-lead-sub'); };
  await page.reload();
  await page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
  const sub1 = await until(async () => { const t = await leadSub(); return /Session 5 is open · 2 playing/.test(t) ? t : null; }, 8000);
  check(!!sub1, 'after a reload the page reads the stored roster: ' + sub1);
  const raw = await campaign();
  await page.evaluate(() => window.B68Load.need('table'));      /* the table page's own code: what its log-line removal writes */
  const whole = await page.evaluate((d) => { const n = window.B68Campaign.normalize(d); n.log = n.log.slice(1); return n; }, raw);
  check((await api('PUT', '/campaign', whole)).status === 200, 'the table\'s whole-document write (a log line removed): PUT of its own normalized copy');
  const d1b = await campaign();
  check(d1b.log.length === raw.log.length - 1 && JSON.stringify(d1b.session.present) === JSON.stringify(raw.session.present) && d1b.session.startedAt === at, 'the roster and startedAt come through the PUT unchanged');
  await page.reload();
  await page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
  const sub2 = await until(async () => { const t = await leadSub(); return /Session 5 is open · 2 playing/.test(t) ? t : null; }, 8000);
  check(!!sub2, 'and after another reload Tam is still absent: ' + sub2);
  await page.click('#gm-left [data-who="open"]');
  await page.waitForSelector('#gm-who-sheet:not([hidden])', { timeout: 5000 });
  const r2 = Object.fromEntries((await rows()).map((r) => [r[0], r[1]]));
  check(r2['ch-tam'] === 'false' && r2['ch-nell'] === 'true' && r2['ch-ray'] === 'true' && await page.$eval('#gm-who-sheet [data-who="start"]', (b) => b.textContent.trim()) === 'Carry on session 5', 'the sheet offers Carry on session 5 with Tam unticked: ' + JSON.stringify(r2));
  await page.keyboard.press('Escape');

  /* ---- 4. the trace ---- */
  const trace = {};
  trace.band = await until(async () => { const t = await page.textContent('#gm-bar-sess'); return t === 'Session 5' ? t : null; }, 5000);
  check(trace.band === 'Session 5', 'the band chip: ' + trace.band);
  trace.stt = await until(async () => { const s = (await api('GET', '/gm/stt')).json; return s && s.doc && s.doc.session === '5' ? s.doc.session : null; }, 5000);
  check(trace.stt === '5', 'listening (already on) follows: its session is ' + trace.stt);
  const disp = (await api('GET', '/gm/display')).json;
  trace.ipad = disp && disp.stt ? disp.stt.session : null;
  check(trace.ipad === '5', 'the iPad\'s GET carries session ' + trace.ipad + ' (the transcript lines it stamps, and so Blade\'s log)');
  trace.capture = await page.evaluate((doc) => { const P = window.B68GmPage && window.B68GmPage._pure; return P && P.captureEntry ? P.captureEntry('x', 'rules', 't', 'now', doc).s : null; }, d1);
  check(trace.capture === 5, 'a capture line is filed in session ' + trace.capture);

  /* ---- 5. one name, one job ---- */
  await page.click('[data-band-place="score"]');
  await page.keyboard.press('g');
  const rv = await page.waitForSelector('.rv-start', { timeout: 10000 }).catch(() => null);
  check(!!rv && await page.$eval('.rv-start', (e) => e.getAttribute('aria-label') === 'Start the clock' && e.querySelector('b').textContent === 'Start the clock'), 'the Run view\'s own control reads Start the clock');
  const says = await page.evaluate(() => Array.prototype.filter.call(document.querySelectorAll('button, [role="group"], b, [aria-label]'), (e) => e.offsetParent !== null && (e.textContent.trim() === 'Start the night' || e.getAttribute('aria-label') === 'Start the night')).length);
  check(says === 0, 'nothing in the Score says Start the night (' + says + ')');

  /* ---- 6. After and End ---- */
  await page.click('[data-band-place="after"]');
  await page.waitForSelector('#gm-left [data-who-after]', { timeout: 8000 });
  const line = await until(async () => { const t = await page.textContent('#gm-left [data-who-after]'); return /^Session 5 · started \d\d:\d\d · 2 playing$/.test(t) ? t : null; }, 4000);
  check(!!line, 'After\'s line: ' + (line || await page.textContent('#gm-left [data-who-after]')));
  trace.after = line;
  await shot(page, 'after-paper-1366');
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }).catch(() => null), page.click('#gm-left [data-pv-end]')]);
  let exported = '';
  if (dl) { const p = await dl.path(); exported = p ? readFileSync(p, 'utf8') : ''; }
  trace.export = (exported.split('\n')[0] || '').trim();
  check(/^# Session 5: notes from the table$/.test(trace.export), 'End the night\'s export: ' + trace.export);
  check(asked.some((m) => /^End the night\?/.test(m)), 'End the night asked first');
  const d2 = await until(async () => { const d = await campaign(); return d.session.endedAt ? d : null; }, 8000);
  check(!!d2 && d2.session.number === 5 && d2.log[0].text === 'Session 5 ended', 'the session ended with the night: ' + (d2 && d2.session.endedAt));
  check(!!d2 && JSON.stringify(d2.session.present) === JSON.stringify(d1.session.present), 'the roster stays with the ended session');
  check(!!(await until(async () => / · ended \d\d:\d\d · 2 playing$/.test(await page.textContent('#gm-left [data-who-after]')), 4000)), 'After\'s line says it ended');
  await page.click('[data-band-place="before"]');
  await page.waitForSelector('#gm-left [data-who="open"]', { timeout: 8000 });
  await page.click('#gm-left [data-who="open"]');
  await page.waitForSelector('#gm-who-sheet:not([hidden])', { timeout: 5000 });
  check(await page.$eval('#gm-who-sheet [data-who-n]', (i) => i.value) === '6' && await page.$eval('#gm-who-sheet [data-who="start"]', (b) => b.textContent.trim()) === 'Start session 6', 'a second Start offers session 6');
  check((await rows()).every((r) => r[1] === 'true'), 'no RSVPs now: everyone ticked');
  await page.keyboard.press('Escape');

  /* ---- 7. the setting off ---- */
  check((await api('PATCH', '/gm/state', { features: { 'night.who': false } })).status === 200, 'night.who off');
  await page.reload();
  await page.waitForSelector('#gm-left [data-place-next="opening"]', { timeout: 20000 });
  check((await page.$$('#gm-left .who-lead, #gm-left [data-who-after]')).length === 0, 'off: no Start the night in Before');
  check(await page.$eval('#gm-left [data-place-next="opening"]', (b) => b.classList.contains('primary')), 'off: Before\'s Next is the Primary again');
  const fetched = await page.evaluate(() => performance.getEntriesByType('resource').some((e) => /gm\/kit\/who\.js/.test(e.name)));
  check(!fetched, 'off: who.js is not fetched');
  await page.click('[data-band-place="score"]'); await page.keyboard.press('g');
  check(await page.waitForSelector('.rv-start b', { timeout: 10000 }).then((e) => e.textContent()).catch(() => '') === 'Start the night', 'off: the Run view says Start the night, as before');
  await G.c.close();

  /* ---- the pictures: Before, the sheet, After at both desk widths, in Paper and in Night (setting on again) ---- */
  if (SHOTS) {
    await api('PATCH', '/gm/state', { features: { 'night.who': true } });
    for (const theme of ['paper', 'night']) {
      for (const [w, h] of [[1366, 768], [1536, 864]]) {
        await api('PUT', '/campaign', { ...(await campaign()), session: { number: 4, startedAt: '2026-11-07T08:30:00.000Z', endedAt: '2026-11-07T12:10:00.000Z' },
          schedule: { options: {}, avail: {}, next: { at: next, minutes: 240, place: '', note: '', confirmedAt: null }, cadence: null, quorum: 0, attendance: {},
            rsvp: { 'nell.player@example.test': { at: next, v: 'in' }, 'tam.player@example.test': { at: next, v: 'out' } } } });
        const S = await open(w, h, theme);
        await S.page.click('[data-band-place="before"]');
        await S.page.waitForSelector('#gm-left [data-who="open"]', { timeout: 20000 });
        await sleep(400); await shot(S.page, 'before-' + theme + '-' + w);
        await S.page.click('#gm-left [data-who="open"]'); await S.page.waitForSelector('#gm-who-sheet:not([hidden])');
        await until(async () => /Ada Vell/.test(await S.page.textContent('#gm-who-sheet')), 4000);
        await sleep(400); await shot(S.page, 'sheet-' + theme + '-' + w);
        await S.page.click('#gm-who-sheet [data-who="start"]');      /* Nell and Ray, as ticked */
        await until(async () => (await campaign()).session.number === 5, 8000);
        await S.page.click('[data-band-place="after"]');
        await until(async () => / · 2 playing$/.test(await S.page.textContent('#gm-left [data-who-after]').catch(() => '')), 8000);
        await sleep(400); await shot(S.page, 'after-' + theme + '-' + w);
        await S.c.close();
      }
    }
  }
  check(errors.length === 0, 'no console errors: ' + JSON.stringify(errors.slice(0, 3)));
  console.log('TRACE ' + JSON.stringify(trace));
  await browser.close();
} catch (e) {
  console.log('FAIL ' + (e && e.stack || e)); failed++;
}
clearTimeout(timeout);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
