// kit-phone (the four-screen sheet, KS17 of the kit and stage build), end to end against a real local Worker (wrangler dev) on PORT (default 9415;
// the inspector on PORT + 20000), with invented fixtures only (the Dovetail Crew: Nell Arbuthnot's sheet; a GM-ONLY- unrevealed NPC and GM notes).
//   files    every part of the sheet (tracker.js ORDER) is on exactly one screen (sheet/kit/tabs.js TABLE): the check fails on a part with no screen
//            or two; tabs.css: every rule under the phone token, no important flag, no layer; tabs.js: no markup sink, no request, no hand-built button;
//            tracker.js meets it in one line; the pure parts (which screen opens, the top actions)
//   off      kit.phone off: no data-kit, no kit file fetched, no mark, no bar, every box on the one long page (as today)
//   on       kit.phone turned on from the GM's side, the sheet open: the bar comes (Now · Sheet · Crew · Notes), 390 x 844, at the foot and inside
//            the screen; no session at the table: Sheet; every box on exactly one screen, the top bar (and its vitals) on all four; the last box
//            clears the bar; the screen picked is kept over a reload
//   night    the fixture night starts (a session in play): an open sheet moves to Now, a fresh one opens on Now; the top actions (the best four,
//            their dots) open the roll over Now; "All twelve ›" goes to the Actions box; a vital jumps to its box on another screen
//   over     the mission card, the absent page and Quiet open over any screen
//   secret   the phone's requests with the kit on are the ones it makes with it off (and the kit's own files); no GM-ONLY- text in a response or the DOM
//   wide     1024 px with the kit on, and print: the long page, no bar, nothing hidden; kit.phone turned off mid-session: every mark and the bar go at once
// KIT_SHOTS=<dir> saves the pictures (390 and 360 wide, Paper and Night: now, sheet, crew, notes; and the roll over Now).
//   PW_MODULE=<path to playwright-core> [PW_CHANNEL=msedge] [PORT=9415] [KIT_SHOTS=<dir>] node checks/runtime/kit-phone.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9415);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', P1 = 'player1@example.test', ID = 'pc-nell';
const SHOTS = process.env.KIT_SHOTS || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }

/* ---------- no browser: the table, the files' own rules, the pure parts ---------- */
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const TRACKER = read('app/tracker.js'), JS = read('app/sheet/kit/tabs.js'), CSS = read('app/sheet/kit/tabs.css');
const Tabs = require(path.join(ROOT, 'app', 'sheet', 'kit', 'tabs.js'));
{
  const m = TRACKER.match(/var ORDER = \[([^\]]*)\]/);
  const ORDER = m ? m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, '')).filter(Boolean) : [];
  const where = {};
  for (const p of Object.keys(Tabs.TABLE)) (where[p] = where[p] || []).push(Tabs.TABLE[p]);
  /* the places: a part named on a screen's list must be on that screen, and on no other list */
  for (const s of Object.keys(Tabs.PLACE)) for (const p of Tabs.PLACE[s]) if (p[0] !== '@') (where[p] = where[p] || []).push(s);
  const none = ORDER.filter((p) => !Tabs.TABLE[p]), two = ORDER.filter((p) => where[p] && new Set(where[p]).size > 1);
  const extra = Object.keys(where).filter((p) => ORDER.indexOf(p) < 0);
  check(ORDER.length === 25 && !none.length && !two.length && !extra.length && Object.values(Tabs.TABLE).every((s) => Tabs.SCREENS.includes(s)),
    'every part in ORDER (' + ORDER.length + ') is on exactly one screen' + (none.length ? '; no screen: ' + none : '') + (two.length ? '; two: ' + two : '') + (extra.length ? '; not in ORDER: ' + extra : ''));
  check(JSON.stringify(Tabs.SCREENS) === '["now","sheet","crew","notes"]' && Object.values(Tabs.LABELS).join(' · ') === 'Now · Sheet · Crew · Notes', 'four screens: Now · Sheet · Crew · Notes');
  const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]+\{/g, '');
  const sels = (rules.match(/[^{}]+\{/g) || []).map((s) => s.slice(0, -1).trim()).filter(Boolean);
  const out = []; for (const s of sels) for (const one of s.split(',')) if (!one.trim().startsWith(':root[data-kit~="phone"]')) out.push(one.trim());
  check(sels.length > 10 && !out.length, 'tabs.css: every rule under the phone token' + (out.length ? ': ' + out.slice(0, 3) : ''));
  check(!/!\s*important/i.test(CSS) && !/@layer/.test(CSS) && !/[\u0080-\u009f]/.test(CSS + JS), 'tabs.css: no important flag, no layer; no character in U+0080 to U+009F');
  const head = CSS.replace(/\/\*[\s\S]*?\*\//g, '').split('@media')[0];
  check(/@media screen and \(max-width: 760px\)/.test(CSS) && !/data-ks17-off/.test(head), 'the split is in the phone\'s media query only: the wide layout and print hide nothing');
  const code = JS.replace(/\/\*[\s\S]*?\*\//g, '');
  check(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment/.test(code) && !/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(code) && !/<button/.test(code) && !/'keydown'/.test(code),
    'tabs.js: no markup sink, no request, no hand-built button, no key listener of its own');
  const seams = TRACKER.split('\n').filter((l) => /B68SheetTabs/.test(l));
  check(seams.length === 1 && /B68Kit\.ready\('phone'\)/.test(seams[0]), 'tracker.js meets it in one line, behind B68Kit.ready(\'phone\')');
  const P = Tabs.Pure;
  check(P.opening(null, { session: 3, inPlay: true }) === 'now' && P.opening(null, { session: 3, inPlay: false }) === 'sheet' && P.opening(null, null) === 'sheet', 'opening: Now while a session is open, otherwise Sheet');
  check(P.opening({ t: 'notes', k: 'play:3' }, { session: 3, inPlay: true }) === 'notes' && P.opening({ t: 'notes', k: 'idle' }, { session: 3, inPlay: true }) === 'now' && P.opening({ t: 'crew', k: 'idle' }, { session: 3, inPlay: false }) === 'crew',
    'then the last screen used, while the table is as it was when it was picked');
  const ACTS = [['Insight', ['Hunt', 'Study', 'Survey', 'Tinker']], ['Prowess', ['Finesse', 'Prowl', 'Skirmish', 'Wreck']], ['Resolve', ['Attune', 'Command', 'Consort', 'Sway']]];
  const t = P.topActions({ Hunt: 1, Finesse: 3, Prowl: 2, Sway: 2, Study: 1, Wreck: 0 }, ACTS, 4);
  check(t.total === 12 && t.list.map((x) => x.a + x.v).join(' ') === 'Finesse3 Prowl2 Sway2 Hunt1' && P.allLabel(12) === 'All twelve ›', 'the top actions: the best four, book order between equals; "All twelve ›": ' + t.list.map((x) => x.a + x.v).join(' '));
}

/* ---------- the browser run ---------- */
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-kit-phone-e2e-'));
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
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 600000);

const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const must = async (p, what) => { const r = await p; if (r.status !== 200) throw new Error(what + ' -> ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 200)); return r; };
const kit = (on) => must(api('PATCH', '/campaign', { features: { 'kit.phone': on } }), 'kit.phone ' + on);

/* the mission card: the same invented site and play the night checks use (the Pelican Rooms) */
const BALL = require(path.join(ROOT, 'app', 'gm', 'ball.js'));
const ROOMS = ['Showroom', 'Cocktail lounge', 'Underground counting room', 'Security control room', 'Private card rooms', 'Luxury penthouse'];
const CHECKED = BALL.checkPlay(JSON.parse(read('checks/runtime/fixtures/gm/pelican-play-v2.json')), ROOMS);
let mseq = 0;
function mission(room) {
  const s = { crew: { [ID]: { room, disguise: 'guest' } }, heard: {}, steps: {}, ways: {}, told: {} };
  const v = BALL.playerView(CHECKED.play, s, ROOMS, { rooms: {} });
  const m = BALL.missionFor(v, s, BALL.minuteOf('22:15', '21:00'), [{ id: ID, name: 'Nell Arbuthnot', owner: P1 }]); m.seq = ++mseq; return m;
}
const PACKET = () => ({ v: 1, at: Date.now(), front: { masthead: 'The Pelican Post', issue: 'No. 12', date: 'Thursday', headline: 'Lights out at the Pelican Rooms', standfirst: 'A power cut and a missing ledger.', account: ['The lights went out at a quarter past eleven.'], name: '', hook: '' },
  previously: { faces: [{ name: 'Mabel Quist', role: 'Fixer' }], lines: ['The crew took the job from Mabel.', 'Ray talked his way past the door.', 'Tam found the second set of books.'] }, changes: ['Stress 2 to 5'] });
const NELL = { name: 'Nell Arbuthnot', playbook: 'hound', spec: { name: 'Nell Arbuthnot', playbook: 'hound' }, sheet: { name: 'Nell Arbuthnot', alias: 'Wren', look: 'Long coat, short temper' },
  play: { stress: 6, crew: 'The Dovetail Crew', dots: { Hunt: 1, Study: 1, Finesse: 3, Prowl: 2, Sway: 2, Consort: 1 }, harm: { l1: ['', ''], l2: ['Wrenched wrist', ''], l3: '', l4: '' },
    keys: [{ name: 'Keep the promise to Mabel', down: 'Walk away', up: 'Burn it down', hits: 1 }, { name: 'Owe Dov a favour', down: 'Cut him off', up: 'Bring him in', hits: 0 }],
    clocks: [{ name: 'Find the second ledger', size: 6, filled: 2 }], notes: 'Ada Vell owes us a door.', log: [{ at: '2026-11-07T10:00:00Z', kind: 'note', text: 'Ray talked us past the cloakroom.' }] } };

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const errors = [];
async function open(o = {}) {
  const w = o.w || 390, h = o.h || 844, mobile = o.mobile !== false;
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': P1 }, viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block', colorScheme: o.night ? 'dark' : 'light', reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { window.__B68_POLL_MS = 500; window.__B68_HEALTHY_POLL_MS = 500; });
  const page = await ctx.newPage();
  const seen = { req: [], bodies: [] };
  page.on('request', (r) => seen.req.push(r.url()));
  page.on('response', async (r) => { if (r.url().indexOf('/api/') > 0) { try { seen.bodies.push({ u: r.url(), b: await r.text() }); } catch (_) {} } });
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|Content Security Policy/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE + '/#c/' + ID);
  await page.waitForSelector('#dossier .ds-bar', { timeout: 30000 });
  return { ctx, page, seen };
}
const shot = async (pg, name) => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, name + '.png') }); };
const barOn = (pg, ms = 20000) => until(() => pg.evaluate(() => !!document.querySelector('#dossier .ks17-bar') && document.documentElement.getAttribute('data-kit') === 'phone'), ms, 100);
const screen = (pg) => pg.evaluate(() => { const r = document.querySelector('#dossier'); return r ? r.getAttribute('data-ks17-screen') : null; });
const tap = (pg, s) => pg.click('#dossier .ks17-bar [data-ks17-tab="' + s + '"]');
const closeCard = async (pg) => {
  for (let i = 0; i < 8; i++) { if (await pg.$('.ds-mv')) { await pg.click('.ds-mv-x').catch(() => {}); await sleep(300); continue; } await sleep(400); if (!(await pg.$('.ds-mv'))) return true; }
  return !(await pg.$('.ds-mv'));
};
/* what shows: each box (its title), the top bar, the name row, the bar and the kit's own pieces */
const view = (pg) => pg.evaluate(() => {
  const vis = (e) => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const r = document.querySelector('#dossier');
  const boxes = Array.from(r.querySelectorAll('section.ds-box')).map((b) => ({ t: (b.querySelector('.ds-bt') || {}).textContent || '?', on: vis(b), s: b.getAttribute('data-ks17'), fig: b.classList.contains('ds-figbox') }));
  const bar = r.querySelector('.ks17-bar'), br = bar && bar.getBoundingClientRect();
  return { boxes, topbar: vis(r.querySelector('.ds-bar')), vitals: vis(r.querySelector('.ds-vitals')), idrow: vis(r.querySelector('.ds-idrow')),
    nowcard: r.querySelector('.ds-now') ? vis(r.querySelector('.ds-now')) : null, fold: r.querySelector('.ds-betweenbox') ? vis(r.querySelector('.ds-betweenbox')) : null,
    top: vis(r.querySelector('.ks17-top')), crew: vis(r.querySelector('.ks17-crew')), bar: vis(bar), barBox: br ? { t: Math.round(br.top), b: Math.round(br.bottom), l: Math.round(br.left), r: Math.round(br.right) } : null,
    tabs: bar ? Array.from(bar.querySelectorAll('[role="tab"]')).map((b) => b.textContent + (b.getAttribute('aria-selected') === 'true' ? '*' : '')).join(' ') : '',
    tabH: bar ? Math.min(...Array.from(bar.querySelectorAll('[role="tab"]')).map((b) => Math.round(b.getBoundingClientRect().height))) : 0,
    sw: document.documentElement.scrollWidth, ih: innerHeight, iw: innerWidth };
});
const shownTitles = (v) => v.boxes.filter((b) => b.on).map((b) => b.t).join(', ');
const covers = (pg, sel, y) => pg.evaluate((a) => { const d = document.querySelector(a.sel); if (!d) return null; const e = document.elementFromPoint(innerWidth / 2, a.y == null ? innerHeight / 2 : innerHeight - a.y); return { cover: !!(e && e.closest(a.sel)), screen: document.querySelector('#dossier').getAttribute('data-ks17-screen') }; }, { sel, y });
const openFold = async (pg) => { const t = await pg.$('.ds-betweenbox .ds-between-t'); if (t && (await t.getAttribute('aria-expanded')) !== 'true') await t.click(); };

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  const ended = new Date(Date.now() - 86400000).toISOString();
  await must(api('PUT', '/campaign', { v: 1, session: { number: 2, startedAt: ended, endedAt: ended }, crew: { name: 'The Dovetail Crew', playbook: 'shadows', claims: {}, factions: [], cohorts: [] },
    clocks: [{ id: 'k2', name: 'The Pelican Rooms close', size: 4, filled: 1, kind: 'other', hidden: false }], log: [] }), 'the table');
  /* what a phone must never receive: an unrevealed NPC, and a revealed one's GM notes (a table clock's `hidden` is presentation only, CAMPAIGN.md) */
  await must(api('PUT', '/npcs/npc_ks17_clerk', { name: 'GM-ONLY-Night Clerk', alias: '', role: 'Clerk', faction: '', description: 'GM-ONLY-desc', gmNotes: 'GM-ONLY-notes', revealed: false, firstSeen: null, spec: {} }), 'a hidden NPC');
  await must(api('PUT', '/npcs/npc_ks17_lotte', { name: 'Lotte Brand', alias: '', role: 'Cloakroom', faction: '', description: 'Keeps the coats.', gmNotes: 'GM-ONLY-her debts', revealed: true, firstSeen: null, spec: {} }), 'a revealed NPC');
  await must(api('PATCH', '/campaign', { features: { 'spine.keyturn': true, 'between.keys': true, 'spine.aftermath': true, 'spine.debrief': true, 'between.quiet': true, 'between.board': true, 'between.absent': true } }), 'the phone switches');
  await must(api('PUT', '/characters/' + ID, NELL, P1), 'Nell');
  await must(api('PUT', '/docs', { kind: 'packet', owner: P1, scope: 'player', json: PACKET() }), 'the absent packet');

  /* ---------- off: today ---------- */
  const A = await open(), a = A.page;
  await sleep(1500);
  const off = await a.evaluate(() => ({ kit: document.documentElement.getAttribute('data-kit'), marks: document.querySelectorAll('[data-ks17], [data-ks17-off], [data-ks17-screen]').length, bar: !!document.querySelector('.ks17-bar, .ui-bottombar'),
    tabs: typeof window.B68SheetTabs, ui: typeof window.B68Ui }));
  const offView = await view(a);
  const offBoxes = offView.boxes.filter((b) => !b.fig);
  check(off.kit === null && off.marks === 0 && !off.bar && off.tabs === 'undefined' && off.ui === 'undefined', 'off: no data-kit, no mark, no bar, the kit not loaded: ' + JSON.stringify(off));
  check(offBoxes.every((b) => b.on) && offBoxes.length >= 14, 'off: every box on the one long page (' + offBoxes.length + '): ' + shownTitles(offView));
  const kitFiles = A.seen.req.filter((u) => /\/(ui|sheet\/kit)\//.test(u) && !/\/ui\/kit-flag\.js/.test(u));
  check(!kitFiles.length, 'off: no kit file fetched (the core\'s ui/kit-flag.js aside)' + (kitFiles.length ? ': ' + kitFiles : ''));
  const offReq = A.seen.req.slice(), offApi = new Set(offReq.filter((u) => u.indexOf('/api/') > 0).map((u) => new URL(u).pathname));

  /* ---------- on, from the GM's side, with the sheet open ---------- */
  await kit(true);
  check(!!(await barOn(a)), 'on: the open sheet takes the bar without a reload');
  let v = await view(a);
  check(v.tabs === 'Now Sheet* Crew Notes' && (await screen(a)) === 'sheet', 'no session at the table: it opens on Sheet (' + v.tabs + ')');
  check(v.barBox && v.barBox.b === v.ih && v.barBox.l === 0 && v.barBox.r === v.iw && v.tabH >= 44 && v.sw <= 390, 'the bar sits at the foot, edge to edge, inside the 390 x 844 screen, each screen 44 px or taller: ' + JSON.stringify([v.barBox, v.tabH, v.sw]));
  const fixed = await a.evaluate(() => getComputedStyle(document.querySelector('.ks17-bar')).position);
  check(fixed === 'fixed' && /env\(safe-area-inset-bottom/.test(CSS) && /env\(safe-area-inset-bottom/.test(read('app/ui/parts.css')), 'fixed, and padded by the safe area (clear of the home indicator)');
  /* every box on exactly one screen; the top bar on all four */
  const seenOn = {};
  for (const s of ['now', 'sheet', 'crew', 'notes']) {
    await tap(a, s); await sleep(150);
    v = await view(a);
    for (const b of v.boxes) if (b.on) (seenOn[b.t] = seenOn[b.t] || []).push(s);
    const wrong = v.boxes.filter((b) => b.on && b.s !== s).map((b) => b.t);
    check((await screen(a)) === s && v.topbar && v.vitals && !wrong.length && v.idrow === (s === 'now') && v.top === (s === 'now') && v.crew === (s === 'crew') && v.sw <= 390,
      s + ': ' + shownTitles(v) + (v.top ? ' + the top actions' : '') + (v.crew ? ' + the crew sheet link' : '') + '; the top bar and vitals stay' + (wrong.length ? '; WRONG: ' + wrong : ''));
    const clear = await a.evaluate(() => {
      scrollTo(0, document.documentElement.scrollHeight);
      const bar = document.querySelector('.ks17-bar').getBoundingClientRect();
      const shown = Array.from(document.querySelectorAll('#dossier > *, #dossier .ds-grid > *, #dossier .ds-col > *')).filter((e) => e.getClientRects().length && getComputedStyle(e).position !== 'fixed' && !e.classList.contains('ds-col') && !e.classList.contains('ds-grid'));
      const last = Math.max(...shown.map((e) => e.getBoundingClientRect().bottom)); scrollTo(0, 0); return { last: Math.round(last), bar: Math.round(bar.top) };
    });
    check(clear.last <= clear.bar, s + ': the last box clears the bar when scrolled to the end (' + clear.last + ' <= ' + clear.bar + ')');
  }
  const reach = offBoxes.map((b) => b.t).filter((t) => (seenOn[t] || []).length !== 1);
  check(!reach.length, 'every box of the long page is on exactly one screen (' + offBoxes.length + ')' + (reach.length ? '; not: ' + reach.map((t) => t + '=' + (seenOn[t] || [])).join(' ') : ''));
  check((await a.evaluate(() => { const f = document.querySelector('.ds-betweenbox'); return f ? f.getAttribute('data-ks17') : 'none'; })) === 'crew', 'the Between sessions fold is on Crew');
  /* the screen picked is kept over a reload */
  await tap(a, 'notes');
  await a.reload(); await a.waitForSelector('#dossier .ds-bar'); await barOn(a);
  check((await screen(a)) === 'notes', 'a reload opens on the last screen used (Notes)');
  await tap(a, 'crew'); await sleep(100);
  const link = await a.evaluate(() => { const l = document.querySelector('.ks17-crew a'); return l ? { href: l.getAttribute('href'), text: l.textContent, h: Math.round(l.getBoundingClientRect().height) } : null; });
  check(!!link && link.href === '#t' && /crew sheet/i.test(link.text) && link.h >= 44, 'Crew: a link to the crew sheet: ' + JSON.stringify(link));

  /* ---------- the night starts ---------- */
  const B = await open(), b = B.page;   /* a second phone, left on Crew, open while the GM starts the session */
  await barOn(b); await tap(b, 'crew');
  await must(api('PATCH', '/campaign', { session: { number: 3, startedAt: new Date().toISOString(), endedAt: null } }), 'the night starts');
  check(!!(await until(async () => (await screen(b)) === 'now', 15000)), 'the session starts: an open sheet moves to Now');
  await B.ctx.close();
  const C = await open(), c = C.page;
  await barOn(c);
  check((await screen(c)) === 'now', 'the fixture night has started: a sheet opens on Now');
  v = await view(c);
  const tops = await c.evaluate(() => Array.from(document.querySelectorAll('.ks17-top .ks17-act')).map((r) => r.querySelector('button').textContent + ':' + r.querySelectorAll('.ui-pip.is-on').length + '/' + r.querySelectorAll('.ui-pip').length));
  check(tops.join(' ') === 'Finesse:3/4 Prowl:2/4 Sway:2/4 Hunt:1/4', 'Now: the best four actions with their dots: ' + tops.join(' '));
  await shot(c, 'now-paper-390-first');
  /* a top action opens the roll over Now */
  await c.click('.ks17-top .ks17-actbtn >> text=Finesse');
  const roll = await until(() => c.evaluate(() => { const p = document.querySelector('#dossier .ds-roll'); if (!p || !p.getClientRects().length) return null; const r = p.getBoundingClientRect(); return { pos: getComputedStyle(p).position, b: Math.round(r.bottom), h: Math.round(r.height), screen: document.querySelector('#dossier').getAttribute('data-ks17-screen'), box: document.querySelector('#dossier .ds-actbox').getAttribute('data-ks17-off'), head: (p.querySelector('.ds-roll-t') || {}).textContent || '', exp: document.querySelector('.ks17-top .ks17-actbtn').getAttribute('aria-expanded') }; }), 5000);
  check(!!roll && roll.pos === 'fixed' && roll.screen === 'now' && roll.box === 'panel' && /Finesse/.test(roll.head) && roll.exp === 'true', 'a top action opens its roll over Now (the Actions box stays on Sheet): ' + JSON.stringify(roll));
  const over = await covers(c, '.ds-roll', 10);
  check(!!over && over.cover, 'the panel sits over the bar, not under it');
  await shot(c, 'roll-paper-390');
  await c.keyboard.press('Escape');
  check(!!(await until(() => c.evaluate(() => !document.querySelector('#dossier .ds-roll') && document.querySelector('#dossier .ds-actbox').getAttribute('data-ks17-off') === '1'), 3000)), 'Esc closes it, and Now is as it was');
  /* All twelve, and a vital that jumps */
  await c.click('.ks17-top .ks17-all');
  const all = await c.evaluate(() => { const bx = document.querySelector('#dossier .ds-actbox'), r = bx.getBoundingClientRect(); return { screen: document.querySelector('#dossier').getAttribute('data-ks17-screen'), on: !!bx.getClientRects().length, top: Math.round(r.top), n: bx.querySelectorAll('.ds-actbtn').length }; });
  check(all.screen === 'sheet' && all.on && all.top >= 0 && all.top < 300 && all.n === 12, '"All twelve ›" opens Sheet at the Actions box (all twelve): ' + JSON.stringify(all));
  await tap(c, 'now'); await sleep(100);
  await c.click('#dossier .ds-vit[data-to="ds-xpbox"]');
  const jump = await until(() => c.evaluate(() => { const bx = document.querySelector('#dossier .ds-xpbox'); if (!bx.getClientRects().length) return null; const r = bx.getBoundingClientRect(), bar = document.querySelector('#dossier .ds-bar').getBoundingClientRect(); return r.top >= bar.bottom - 2 && r.top < innerHeight - 100 ? { screen: document.querySelector('#dossier').getAttribute('data-ks17-screen'), top: Math.round(r.top) } : null; }), 4000);
  check(!!jump && jump.screen === 'sheet', 'the XP vital jumps to the XP box on Sheet: ' + JSON.stringify(jump));
  await c.click('#dossier .ds-vit[data-to="ds-stressbox"]');
  check(!!(await until(async () => (await screen(c)) === 'now', 3000)), 'and the Stress vital back to Now');

  /* ---------- over any screen: the mission card, the absent page, Quiet ---------- */
  await tap(c, 'notes'); await sleep(100);
  await must(api('PATCH', '/campaign', { mission: mission('Cocktail lounge') }), 'the mission');
  const mv = await until(() => covers(c, '.ds-mv'), 15000);
  check(!!mv && mv.cover && mv.screen === 'notes', 'the mission card opens over Notes: ' + JSON.stringify(mv));
  check(await closeCard(c), 'and closes');
  await tap(c, 'now'); await sleep(100);
  const fromNow = await c.$('.ds-now [data-b68="absent-open"]');
  if (fromNow) {
    await fromNow.click();
    const d1 = await until(() => covers(c, '.ds-absent-dlg'), 4000);
    check(!!d1 && d1.cover && d1.screen === 'now', 'the absent page opens over Now ("Read it"): ' + JSON.stringify(d1));
    await c.keyboard.press('Escape'); await sleep(200);
  }
  await tap(c, 'crew'); await sleep(100);
  await openFold(c);
  await c.click('.ds-betweenbox [data-b68="absent-open"]');
  const d2 = await until(() => covers(c, '.ds-absent-dlg'), 4000);
  check(!!d2 && d2.cover && d2.screen === 'crew', 'the absent page opens over Crew (the fold\'s "Read it again"): ' + JSON.stringify(d2));
  await c.keyboard.press('Escape'); await sleep(200);
  await tap(c, 'sheet'); await sleep(100);
  await c.click('#dossier .ds-quietbtn');
  const q = await until(() => covers(c, '.ds-quiet-dlg', 30), 3000);
  check(!!q && q.cover && q.screen === 'sheet', 'Quiet opens over Sheet, and over the bar: ' + JSON.stringify(q));
  await c.keyboard.press('Escape');

  /* ---------- the pictures: 390 and 360, Paper and Night ---------- */
  if (SHOTS) {
    for (const [night, w, h] of [[false, 390, 844], [true, 390, 844], [false, 360, 780], [true, 360, 780]]) {
      const S = await open({ night, w, h }), s = S.page; await barOn(s);
      await closeCard(s);
      await until(() => s.evaluate(() => { const t = document.querySelector('.ds-thumb'); return !!t && t.complete && t.naturalWidth > 0 && !/^data:image\/svg/.test(t.src) ? true : !!window.B68Figure; }), 8000);
      await sleep(400);
      for (const sc of ['now', 'sheet', 'crew', 'notes']) {
        await tap(s, sc); await sleep(250); await shot(s, sc + '-' + (night ? 'night' : 'paper') + '-' + w);
        if (w === 390 && !night) await s.screenshot({ path: path.join(SHOTS, sc + '-paper-390-whole.png'), fullPage: true });   /* the whole screen, scrolled */
      }
      if (night && w === 390) { await tap(s, 'now'); await s.click('.ks17-top .ks17-actbtn >> text=Finesse'); await sleep(400); await shot(s, 'roll-night-390'); await s.keyboard.press('Escape'); }
      const sv = await view(s);
      check(sv.sw <= w, w + ' ' + (night ? 'Night' : 'Paper') + ': nothing wider than the screen (' + sv.sw + ')');
      await S.ctx.close();
    }
  }

  /* ---------- nothing new reaches the phone ---------- */
  const onApi = new Set(C.seen.req.filter((u) => u.indexOf('/api/') > 0).map((u) => new URL(u).pathname));
  const extraApi = [...onApi].filter((p) => !offApi.has(p));
  check(!extraApi.length, 'the kit asks the server for nothing new: ' + [...onApi].join(' ') + (extraApi.length ? '; NEW: ' + extraApi : ''));
  const offStatic = new Set(offReq.filter((u) => u.startsWith(BASE) && u.indexOf('/api/') < 0).map((u) => new URL(u).pathname));
  const statics = [...new Set(C.seen.req.filter((u) => u.startsWith(BASE) && u.indexOf('/api/') < 0).map((u) => new URL(u).pathname))].filter((p) => !offStatic.has(p));
  check(statics.length > 0 && statics.every((p) => /^\/(ui|sheet\/kit)\//.test(p)), 'the only new files are the kit\'s own: ' + statics.join(' '));
  check(!C.seen.req.some((u) => !u.startsWith(BASE) && !u.startsWith('data:') && !u.startsWith('blob:')), 'no request outside the app\'s own origin');
  const leaks = [...A.seen.bodies, ...C.seen.bodies].filter((x) => x.b.includes('GM-ONLY')).map((x) => x.u + ' ' + x.b.slice(Math.max(0, x.b.indexOf('GM-ONLY') - 120), x.b.indexOf('GM-ONLY') + 40));
  const domLeak = await c.evaluate(() => document.documentElement.outerHTML.includes('GM-ONLY'));
  check(!leaks.length && !domLeak && C.seen.bodies.length > 0, 'no GM-ONLY- text in any response the phone got (' + (A.seen.bodies.length + C.seen.bodies.length) + '), or in its page' + (leaks.length ? ': ' + leaks[0] : '') + (domLeak ? ' (DOM)' : ''));

  /* ---------- wide, print, and off mid-session ---------- */
  const Wd = await open({ w: 1024, h: 768, mobile: false }), wd = Wd.page;
  await until(() => wd.evaluate(() => document.documentElement.getAttribute('data-kit') === 'phone' && !!document.querySelector('[data-ks17]')), 15000);
  const wide = await view(wd);
  check(!wide.bar && wide.boxes.filter((x) => !x.fig).every((x) => x.on) && wide.boxes.length === offView.boxes.length && !wide.top && !wide.crew, 'at 1024 px with the kit on: the long page, every box, no bar, no added piece');
  /* print: what tracker.css prints today (the Now card, the fold, Session and Downtime are screen-only), and no bar */
  await wd.emulateMedia({ media: 'print' });
  const pv = await view(wd);
  const unprinted = pv.boxes.filter((x) => !x.on && !x.fig && !/^Now · |^Between sessions$|^Session$|^Downtime$/.test(x.t)).map((x) => x.t);
  check(!pv.bar && !unprinted.length, 'print: every box tracker.css prints, no bar' + (unprinted.length ? '; missing: ' + unprinted : ''));
  await Wd.ctx.close();
  await tap(c, 'notes'); await sleep(100);
  await kit(false);
  const gone = await until(() => c.evaluate(() => !document.documentElement.getAttribute('data-kit') && !document.querySelector('.ks17-bar, .ks17-top, .ks17-crew, [data-ks17], [data-ks17-off], [data-ks17-n], [data-ks17-screen]')), 15000);
  v = await view(c);
  check(!!gone && v.boxes.filter((x) => !x.fig).every((x) => x.on), 'kit.phone off mid-session: every mark and every added piece go, the long page is back without a reload');
  await A.ctx.close(); await C.ctx.close();

  check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e) + '\n' + serverLog.slice(-1500));
} finally {
  clearTimeout(timeout);
  killServer();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
