// kit-band (KS05 of the kit and stage build): the band on the new desk (kit.desk on), on the real GM page, Worker and pack, in a real browser.
// The assist endpoints are answered by the browser's own route (invented cards): no key, no model, no spend.
//   0. the setting off: today's band, nothing of the kit; its height at 1366x768 is the height to beat
//   1. the hooks: every id, data-band*, data-gm and old class of band.js skeleton() is in the new band; #gm-bar-who is there, empty and hidden;
//      row 1 and row 2 in the design's order
//   2. the look: at 1366x768 and 1536x864, plain, curfew due and PANIC: no two items overlap, none is outside the window, the band is no taller than
//      today's, nothing in it is under 12 px, one Danger on the page (PANIC) and one Primary in the band (GO)
//   3. the phase tabs move the place as before (a tap enters the phase; Ctrl+Right looks, the night stays)
//   4. Blade: the button carries the hidden tab's count and pips; a click opens the panel as A does and closes it; A closes it and the focus comes back
//   5. the cue unit: GO fires on Space and on PgDn; the quiet Next is the stack's Bypass
//   6. the iPad: Clear sends what 0 sends; Blank turns the iPad black, as the tray's Blank does; Shift+H still blanks the laptop
//   7. the setting off mid-session (Settings): the old band without a reload, painted; on again: the new one, painted
// Every name is invented. SHOTS=<dir> writes the pictures (<view>-<theme>-<width>.png, Paper and Night, 1366x768 and 1536x864).
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9403] [SHOTS=<dir>] [KIT_BAND_ONLY=shots] node checks/runtime/kit-band.e2e.mjs
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
const PORT = Number(process.env.PORT || 9403);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const SHOTS = process.env.SHOTS || '';
const ONLY = process.env.KIT_BAND_ONLY || '';      /* shots: the pictures only, while working on the look */
if (!process.env.PW_MODULE) { console.log('SKIP kit-band: PW_MODULE is not set (it needs Playwright)'); process.exit(0); }
const { chromium } = require(process.env.PW_MODULE);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), np = fx('npc-pack.json');
const MIN = 60000, pad = (n) => (n < 10 ? '0' : '') + n, hm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-kitband-e2e-'));
/* two invented prep notes through the real exporter: one with a run order and a Cues section, one with no Cues at all */
const vault = path.join(stateDir, 'vault'), G = 'Wiki/Games/Blades in the Dark/Campaigns/Group';
const w = (rel, text) => { const f = path.join(vault, ...rel.split('/')); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); };
w(G + '/Sessions/b68g-s09.md', ['---', 'session: 9', 'date: 01/02/2030', 'status: prep', 'gm_prep: true', '---', '', '# Session 9: prep', '',
  'start: 19:30', 'curfew: 22:40', '',
  '## Run order', '', '| # | Beat | About |', '|---|---|---|', '| 1 | Personal business | 30 min |', '| 2 | Planning | 25 min |', '| 3 | The score | 90 min |', '| 4 | Aftermath | 25 min |', '',
  '## Cues', '', 'safe: testcard', '', '1. light: The lamps fail on the mezzanine', '2. show: title: The Pelican Rooms | A night out', '3. light: Lamps down, amber',
  '4. sound: The band strikes up a slow one by the cloakroom', '5. phase: plan', '',
  '## Notes', '', 'Nothing else here.', ''].join('\n'));
w(G + '/Sessions/b68g-s10.md', ['---', 'session: 10', 'date: 08/02/2030', 'status: prep', 'gm_prep: true', '---', '', '# Session 10: prep', '', '## Notes', '', 'No cues tonight.', ''].join('\n'));
const prep = buildPrep({ vault, repo: ROOT, exportedAt: new Date().toISOString(), basenames: basenames(vault) });
const PARTS = {
  console: con.parts.console, campaign: np.parts.campaign, npc: np.parts.npc,
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: new Date().toISOString() }, T: loc.T, extra: loc.extra },
  prep
};
/* three Blade cards (two not yet seen): the band's button carries the tab's count */
const at = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
const CARDS = [
  { seat: 'ref', kind: 'rule', at: at(2), seen: false, text: 'Resistance: Nell can resist the harm from the bouncer; the stress is six minus her highest die.' },
  { seat: 'fixer', kind: 'say', at: at(4), seen: false, text: 'Mabel Quist leans over the rail: the ledger never left the counting room.', say: 'Love, you want the book? Then you owe me the door.' },
  { seat: 'clerk', kind: 'note', at: at(10), seen: true, text: 'New name: Lotte Brand came up twice tonight, both times by the cloakroom.' }
];
const SPEND = { tonight: 1.42, cap: 20, tier: 'all' };

const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
delete env.ANTHROPIC_API_KEY; delete env.B68_ANTHROPIC_KEY;      /* no model: every assist call is answered by the browser's route */
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
const api = (method, p, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j }; });
const kit = (on) => api('PATCH', '/gm/state', { features: { 'kit.desk': on } });
const gmState = async () => ((await api('GET', '/gm/state')).json || {}).doc || {};
async function setNight(o = {}) {
  const now = Date.now();
  await api('PATCH', '/gm/state', { night: null, cues: null });
  await api('PATCH', '/gm/state', { night: { v: 1, phase: o.phase || 'score', startAt: hm(now - 120 * MIN), curfewAt: hm(now + (o.curfewIn === undefined ? 58 : o.curfewIn) * MIN),
    phases: { pb: { budget: 30, start: now - 111 * MIN, end: now - 79 * MIN }, plan: { budget: 25, start: now - 79 * MIN, end: now - 41 * MIN }, score: { budget: 90, start: now - 41 * MIN, end: null } } } });
}

/* the band, measured in the page: each visible item's box (a tab clipped to the strip it scrolls in), overlaps, the window, the height, small text */
const MEASURE = () => {
  const band = document.querySelector('#gm-band'), vw = document.documentElement.clientWidth, vh = innerHeight;
  const vis = (e) => { if (!e) return false; const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; const r = e.getBoundingClientRect(); return r.width > 0.5 && r.height > 0.5; };
  const inPopover = (e) => !!e.closest('.gm-menu-list, .gm-cs-pop, .gm-quiet-list, .gm-mu-pop');
  const nav = band.querySelector('[data-band-places]'), navR = nav.getBoundingClientRect();
  const sel = 'a.gm-band-mark, #gm-bar-sess, .gm-save, [data-band-place], button, [data-band-clock], [data-band-curfew], .gm-cs-tag, .gm-cs-txt, .gm-cs-hand, #gm-signed';
  const items = [], small = [];
  for (const e of band.querySelectorAll(sel)) {
    if (!vis(e) || inPopover(e)) continue;
    if (e.closest('button') && e.closest('button') !== e) continue;
    let r = e.getBoundingClientRect(), box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    if (nav.contains(e)) { box = { l: Math.max(box.l, navR.left), t: box.t, r: Math.min(box.r, navR.right), b: box.b }; if (box.r - box.l < 2) continue; }
    items.push({ id: (e.id || e.getAttribute('data-band-place') || e.getAttribute('data-band') || e.getAttribute('data-cs') || e.getAttribute('data-gm') || e.getAttribute('data-tray') || e.className || e.tagName).toString().slice(0, 30), ...box });
  }
  for (const e of band.querySelectorAll('*')) {
    if (!vis(e) || inPopover(e)) continue;
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (own && parseFloat(getComputedStyle(e).fontSize) < 11.9) small.push((e.className || e.tagName).toString().slice(0, 24) + ' ' + getComputedStyle(e).fontSize);
  }
  const over = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j], x = Math.min(a.r, b.r) - Math.max(a.l, b.l), y = Math.min(a.b, b.b) - Math.max(a.t, b.t);
    if (x > 1 && y > 1) over.push(a.id + ' x ' + b.id);
  }
  const out = items.filter((a) => a.l < -0.5 || a.t < -0.5 || a.r > vw + 0.5 || a.b > vh + 0.5).map((a) => a.id);
  const danger = [...document.querySelectorAll('.ui-btn--danger')].filter(vis).length, primary = [...band.querySelectorAll('.ui-btn--primary')].filter(vis).length;
  return { n: items.length, over, out, small, bandH: Math.round(band.getBoundingClientRect().height), danger, primary, alarm: band.querySelector('.gm-band-r2').getAttribute('data-alarm'), vw };
};
/* every hook band.js skeleton() carries, read from that skeleton in the page, and whether the band on screen has each */
const HOOKS = () => {
  const t = document.createElement('div'); t.innerHTML = window.B68GmBand.skeleton({ menu: '', signed: '' });
  const band = document.querySelector('#gm-band'), miss = [], seen = { ids: 0, data: 0, cls: 0 };
  for (const e of t.querySelectorAll('*')) {
    if (e.id) { seen.ids++; if (!band.querySelector('#' + e.id)) miss.push('#' + e.id); }
    for (const a of e.attributes) if (/^data-/.test(a.name)) { seen.data++; const s = a.value && a.name !== 'data-alarm' ? '[' + a.name + '="' + a.value + '"]' : '[' + a.name + ']'; if (!band.querySelector(s)) miss.push(s); }
    for (const c of e.classList) { seen.cls++; if (!band.querySelector('.' + c)) miss.push('.' + c); }
  }
  return { miss: [...new Set(miss)], seen };
};

try {
  const up = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/index.html')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!up) throw new Error('the server did not start:\n' + serverLog);
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src || {}, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  await api('PUT', '/campaign', { v: 1, session: { number: 9, startedAt: new Date().toISOString(), endedAt: null }, crew: { name: 'The Dovetail Crew', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] }, clocks: [], log: [] });
  const noteIds = (prep.notes || []).map((n) => n.id), withCues = noteIds.find((id) => /s09/.test(id)), noCues = noteIds.find((id) => /s10/.test(id));
  check(!!withCues && !!noCues, 'the two invented notes went through the exporter');
  check((await api('PATCH', '/gm/stt', { want: 'on' })).status === 200, 'listening is on (the Listening chip shows)');
  await setNight();

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open({ w = 1366, h = 768, theme = '', note = withCues, wantKit = true, routes = null } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w, height: h }, serviceWorkers: 'block', colorScheme: theme === 'night' ? 'dark' : 'light' });
    await c.addInitScript((id) => { window.__B68_POLL_MS = 700; try { localStorage.setItem('b68.gm.prepNote', id); } catch (e) {} }, note);
    if (theme) await c.addInitScript({ content: 'try { localStorage.setItem("b68.theme", ' + JSON.stringify(theme === 'night' ? 'dark' : 'light') + '); } catch (e) {}' });
    if (routes) await routes(c);
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());
    const json = (route, body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    let ticks = 0;
    await page.route('**/api/gm/assist/tick', (route) => { ticks++; return json(route, { cards: [], updates: [], flags: [], spend: SPEND, last: 10 + ticks }); });
    await page.route('**/api/gm/assist/cards', (route) => (route.request().method() === 'POST' ? json(route, { marked: 1 }) : json(route, { cards: CARDS, updates: [], asks: [], spend: SPEND })));
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-band [data-band-place]', { timeout: 30000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
    if (wantKit) await page.waitForSelector('#gm-band .kband-r1 [data-band-place]', { timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#as-count') !== null, null, { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await page.waitForTimeout(700);
    return { c, page };
  }
  const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.mouse.move(1, 1); await page.screenshot({ path: path.join(SHOTS, name + '.png'), animations: 'disabled' }); } };
  const blur = (page) => page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());

  /* ---- 0. the setting off: today's band, and its height ---- */
  check((await kit(false)).status === 200, 'kit.desk is off');
  let H0 = 0;
  {
    const { c, page } = await open({ wantKit: false });
    const off = await page.evaluate(() => ({ kit: !!document.querySelector('#gm-band .kband-r, #gm-bar-who'), attr: document.documentElement.getAttribute('data-kit') || '',
      fetched: performance.getEntriesByType('resource').some((e) => /gm\/kit\/band\.js|desk-band\.css/.test(e.name)), h: Math.round(document.querySelector('#gm-band').getBoundingClientRect().height) }));
    H0 = off.h;
    check(!off.kit && !/desk/.test(off.attr) && !off.fetched, 'off: the old band, no data-kit desk, the kit-desk bundle not fetched ' + JSON.stringify(off));
    check(H0 > 40, 'off: today\'s band at 1366x768 is ' + H0 + ' px (the height to beat)');
    if (SHOTS) await shot(page, 'band-off-paper-1366');
    await c.close();
  }
  check((await kit(true)).status === 200, 'kit.desk is on');

  /* ---- 2. the look, and the pictures: every state, Paper and Night, 1366 and 1536 ---- */
  const signedOut = async (c) => { await c.route(/\/api\/gm\/state/, (route) => (route.request().method() === 'PATCH' ? route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"signed out"}' }) : route.fallback())); };
  const STATES = [
    ['band-normal', {}, null],
    ['band-curfew', { curfewIn: -3 }, async (p) => { await p.waitForSelector('#gm-band .gm-band-r2[data-alarm="curfew"]', { timeout: 15000 }); }],
    ['band-panic', {}, async (p) => { await p.click('#gm-band [data-band="panic"]'); await p.waitForSelector('#gm-band .gm-band-r2[data-alarm="panic"]', { timeout: 8000 }); }],
    ['band-nocues', { note: 'none' }, null],
    ['band-elsewhere', {}, async (p) => { await blur(p); await p.keyboard.press('Control+ArrowLeft'); await p.waitForTimeout(400); }],
    ['band-cuemore', {}, async (p) => { await p.click('#gm-cuebar .gm-cs-more'); await p.waitForTimeout(300); }],
    ['band-menu', {}, async (p) => { await p.click('#gm-band [data-gm="menu"]'); await p.waitForTimeout(300); }],
    ['band-blade', {}, async (p) => { await p.click('#gm-band [data-band="blade"]'); await p.waitForTimeout(600); }],
    ['band-signedout', { routes: signedOut }, async (p) => { await p.keyboard.press('2'); await p.waitForSelector('#gm-band.out #gm-signed:not([hidden])', { timeout: 15000 }); }]
  ];
  const MEASURED = ['band-normal', 'band-curfew', 'band-panic'];
  for (const [wd, ht] of [[1366, 768], [1536, 864]]) {
    for (const [name, o, steps] of STATES) {
      if (!SHOTS && !MEASURED.includes(name)) continue;
      for (const theme of (SHOTS ? ['paper', 'night'] : ['paper'])) {
        await setNight({ curfewIn: o.curfewIn });
        const { c, page } = await open({ w: wd, h: ht, theme, note: o.note === 'none' ? noCues : withCues, routes: o.routes || null });
        if (steps) await steps(page);
        await page.waitForTimeout(300);
        if (theme === 'paper' && MEASURED.includes(name)) {
          const m = await page.evaluate(MEASURE), st = name.replace('band-', '');
          check(m.over.length === 0, wd + 'x' + ht + ' ' + st + ': no two of the band\'s ' + m.n + ' items overlap' + (m.over.length ? ': ' + m.over.slice(0, 5).join(', ') : ''));
          check(m.out.length === 0, wd + 'x' + ht + ' ' + st + ': none is outside the window' + (m.out.length ? ': ' + m.out.join(', ') : ''));
          check(m.small.length === 0, wd + 'x' + ht + ' ' + st + ': nothing in the band under 12 px' + (m.small.length ? ': ' + m.small.slice(0, 5).join(', ') : ''));
          if (wd === 1366) check(m.bandH <= H0, wd + 'x' + ht + ' ' + st + ': the band is ' + m.bandH + ' px, no taller than today\'s ' + H0);
          check(m.danger === 1, wd + 'x' + ht + ' ' + st + ': one Danger on the page, PANIC (' + m.danger + ')');
          if (st !== 'panic') check(m.primary === 1, wd + 'x' + ht + ' ' + st + ': one Primary in the band, GO (' + m.primary + ')');
        }
        if (ONLY === 'shots' && theme === 'paper') console.log('  ' + name + ' ' + wd + ': ' + await page.evaluate(() => ['.kband-r1', '.kband-r2'].map((s) => [...document.querySelectorAll('#gm-band ' + s + ' > *')]
          .filter((e) => e.getBoundingClientRect().width > 0).map((e) => ([...e.classList].find((c) => /^kband-/.test(c)) || e.id || e.className) + '=' + Math.round(e.getBoundingClientRect().width) + (e.scrollWidth > e.clientWidth + 1 ? '/' + e.scrollWidth : '')).join(' ')).join(' || ')));
        await shot(page, name + '-' + theme + '-' + wd);
        if (name === 'band-panic') await page.click('#gm-cuebar [data-cs="resume"]').catch(() => {});
        await c.close();
      }
    }
  }
  if (ONLY === 'shots') throw new Error('shots only');
  await setNight();

  /* ---- 1. the hooks, and the order ---- */
  const A = await open();
  const hooks = await A.page.evaluate(HOOKS);
  check(hooks.miss.length === 0 && hooks.seen.ids >= 9, 'every id, data hook and class of band.js skeleton() is in the new band (' + JSON.stringify(hooks.seen) + ')' + (hooks.miss.length ? ': missing ' + hooks.miss.join(' ') : ''));
  const who = await A.page.evaluate(() => { const e = document.querySelector('#gm-band .kband-r1 #gm-bar-who'); return e ? { empty: e.textContent === '', shown: getComputedStyle(e).display !== 'none' } : null; });
  check(!!who && who.empty && !who.shown, 'the who slot #gm-bar-who is in row 1, empty and hidden until night.who fills it');
  const r1 = await A.page.evaluate(() => [...document.querySelectorAll('#gm-band .kband-r1 > *')].map((e) => [...e.classList].find((c) => /^kband-/.test(c)) || e.id || e.className));
  check(['kband-sess', 'kband-places', 'kband-bladebox', 'kband-mic', 'kband-clock', 'kband-panic'].every((k, i, a) => r1.indexOf(k) >= 0 && (i === 0 || r1.indexOf(a[i - 1]) < r1.indexOf(k))), 'row 1 in order: session, tabs, Blade, Listening, curfew and clock, PANIC (' + r1.join(' ') + ')');
  const r2 = await A.page.evaluate(() => [...document.querySelectorAll('#gm-band .kband-r2 [data-tray], #gm-band .kband-r2 [data-cs]')].filter((e) => getComputedStyle(e).display !== 'none').map((e) => e.getAttribute('data-tray') || e.getAttribute('data-cs')));
  check(['open', 'clear', 'blank', 'more', 'go', 'bypass'].every((k) => r2.includes(k)) && r2.indexOf('clear') < r2.indexOf('blank') && r2.indexOf('go') < r2.indexOf('bypass'), 'row 2: the iPad chip with Clear, Blank, then the cue, GO, Next (' + r2.join(' ') + ')');
  const inChip = await A.page.evaluate(() => { const ch = document.querySelector('#gm-band .kband-ipad'); return !!ch && !!ch.querySelector('[data-tray="open"]') && !!ch.querySelector('[data-tray="clear"]'); });
  check(inChip, 'Clear sits inside the iPad chip');
  const goTxt = await A.page.$eval('#gm-cuebar', (e) => e.textContent.replace(/\s+/g, ' '));
  check(/STANDBY · #1 LIGHT/.test(goTxt) && /The lamps fail on the mezzanine/.test(goTxt) && /GO/.test(goTxt) && /Next/.test(goTxt), 'the cue unit: STANDBY #1, the cue, GO and Next (' + goTxt.slice(0, 120) + ')');

  /* ---- 3. the phase tabs ---- */
  const tab = (id) => A.page.$eval('#gm-band [data-band-place="' + id + '"]', (e) => ({ state: e.getAttribute('data-state'), sel: e.getAttribute('aria-current'), cls: e.className }));
  check((await tab('score')).sel === 'true' && /ui-tab/.test((await tab('score')).cls) && /gm-place/.test((await tab('score')).cls), 'the Score is the tab on screen, a ui-tab that keeps gm-place');
  await A.page.click('#gm-band [data-band-place="plan"]');
  check(await until(async () => ((await gmState()).night || {}).phase === 'plan', 5000), 'a tap on Planning enters the phase on the night');
  check(await until(async () => (await tab('plan')).state === 'now' && (await tab('plan')).sel === 'true', 4000), 'and its tab is now and on screen');
  await blur(A.page); await A.page.keyboard.press('Control+ArrowRight');
  check(await until(async () => (await tab('score')).sel === 'true', 3000), 'Ctrl+Right puts the Score on screen');
  check(await until(async () => ((await gmState()).night || {}).phase === 'plan', 3000) && (await tab('plan')).state === 'now', 'and the night stays in Planning');
  await A.page.click('#gm-band [data-band-place="score"]');
  check(await until(async () => ((await gmState()).night || {}).phase === 'score', 5000), 'a tap on the Score enters it');

  /* ---- 4. Blade ---- */
  const blade = () => A.page.evaluate(() => {
    const b = document.querySelector('#gm-band [data-band="blade"]'), n = document.querySelector('#gm-band [data-band-count]'), l = document.querySelector('#as-count');
    return { count: n && !n.hidden ? n.textContent : '', tab: l && !l.hidden ? l.textContent : '', exp: b.getAttribute('aria-expanded'), label: b.getAttribute('aria-label') || '',
      pips: document.querySelectorAll('#gm-band .kband-pip').length, open: document.querySelector('.gm-assist') ? document.querySelector('.gm-assist').getAttribute('data-state') : '' };
  });
  check(await until(async () => { const b = await blade(); return b.count === '2' && b.tab === '2'; }, 8000), 'the Blade button carries the hidden tab\'s count: 2 waiting (' + JSON.stringify(await blade()) + ')');
  check((await blade()).pips >= 1 && /Blade, 2 new/.test((await blade()).label), 'and its pips and its name (' + (await blade()).label + ')');
  await A.page.click('#gm-band [data-band="blade"]');
  check(await until(async () => { const b = await blade(); return b.exp === 'true' && b.open && b.open !== 'closed'; }, 4000), 'a click opens the panel, as A does (' + JSON.stringify(await blade()) + ')');
  check(await until(async () => (await blade()).count === '', 6000), 'opened, the count goes (the cards are seen)');
  await A.page.click('#gm-band [data-band="blade"]');
  check(await until(async () => { const b = await blade(); return b.exp === 'false' && b.open === 'closed'; }, 4000), 'a second click closes it (' + JSON.stringify(await blade()) + ')');
  await blur(A.page); await A.page.keyboard.press('a');
  check(await until(async () => (await blade()).exp === 'true', 4000), 'key A opens it too, and the button says so');
  await A.page.keyboard.press('a');
  check(await until(async () => (await blade()).exp === 'false', 4000), 'A again closes it');
  check(await A.page.evaluate(() => { const a = document.activeElement; return !!a && a.getAttribute('data-band') === 'blade'; }), 'the focus comes back to the band\'s Blade button (the tab is put away)');

  /* ---- 5. the cue unit ---- */
  await blur(A.page);
  const seq = async () => (((await gmState()).cues || {}).seq || []).map((x) => x.join(''));
  await A.page.keyboard.press('Space');
  check(await until(async () => (await seq()).join(',') === '1f', 4000), 'Space fires GO: cue 1 (' + (await seq()).join(',') + ')');
  await sleep(700); await blur(A.page); await A.page.keyboard.press('PageDown');
  check(await until(async () => (await seq()).join(',') === '1f,2f', 4000), 'PgDn fires GO: cue 2 (' + (await seq()).join(',') + ')');
  await sleep(700); await A.page.click('#gm-cuebar [data-cs="bypass"]');
  check(await until(async () => (await seq()).join(',') === '1f,2f,3b', 4000), 'Next is the Bypass: cue 3 skipped (' + (await seq()).join(',') + ')');
  await sleep(700); await A.page.click('#gm-cuebar [data-cs="go"]');
  check(await until(async () => (await seq()).join(',') === '1f,2f,3b,4f', 4000), 'GO, clicked, fires cue 4 (' + (await seq()).join(',') + ')');

  /* ---- 6. the iPad: Clear is 0, Blank is the tray's Blank, Shift+H the laptop ---- */
  const writes = [];
  A.page.on('request', (r) => { if (/\/api\/gm\/(ambient|display)/.test(r.url()) && r.method() !== 'GET') { let k = ''; try { k = Object.keys(JSON.parse(r.postData() || '{}')).sort().join(','); } catch (_) {} writes.push(r.method() + ' ' + new URL(r.url()).pathname + ' ' + k); } });
  const run = async (fn) => { await api('PUT', '/gm/display', { kind: 'text', title: 'A line', text: 'The Pelican Rooms, after hours' }); await sleep(1500); writes.length = 0; await fn(); await sleep(1800); return writes.slice().sort().join(' | '); };
  const byKey = await run(async () => { await blur(A.page); await A.page.keyboard.press('0'); });
  const byBtn = await run(async () => { await A.page.click('#gm-band [data-tray="clear"]'); });
  check(byKey.length > 0 && byKey === byBtn, 'Clear (in the iPad chip) sends what 0 sends (' + byBtn + ')');
  await A.page.click('#gm-band [data-tray="blank"]');
  check(await until(async () => (((await api('GET', '/gm/display')).json || {}).display || {}).kind === 'dark', 5000), 'Blank turns the iPad black, as the tray\'s Blank does');
  await blur(A.page); await A.page.keyboard.press('Shift+H');
  check(await until(async () => !!(await A.page.$('.gm-blank')), 3000), 'Shift+H still blanks the laptop');
  await A.page.keyboard.press('x'); await sleep(400);
  check(!(await A.page.$('.gm-blank')), 'and a key brings it back');

  /* ---- 7. the setting off mid-session, and on again ---- */
  await blur(A.page); await A.page.keyboard.press('i');
  await A.page.waitForSelector('#gm-ipad-settings [data-set="kit.desk"][data-v="0"]', { timeout: 5000 });
  await A.page.click('#gm-ipad-settings [data-set="kit.desk"][data-v="0"]');
  check(await until(async () => !(await A.page.$('#gm-band .kband-r')) && !!(await A.page.$('#gm-band .gm-band-r1 [data-band-place]')), 8000), 'turned off in Settings: the old band, without a reload');
  const painted = () => A.page.evaluate(() => ({ sess: (document.querySelector('#gm-bar-sess') || {}).textContent || '', who: !!document.querySelector('#gm-band #gm-bar-who'),
    btn: !!document.querySelector('#gm-band [data-band="blade"]'), stt: !!document.querySelector('#gm-bar-stt') && !document.querySelector('#gm-bar-stt').hidden,
    cue: ((document.querySelector('#gm-cuebar') || {}).textContent || '').slice(0, 40), go: !!document.querySelector('#gm-cuebar .kband-go'), ipad: !!document.querySelector('#gm-band .kband-ipad [data-tray="clear"]'),
    tray: !!document.querySelector('#gm-band .gm-tray [data-tray="clear"]') }));
  check(await until(async () => { const p = await painted(); return /Session 9/.test(p.sess) && !p.who && !p.btn && p.stt && /STANDBY/.test(p.cue) && p.tray && !p.ipad; }, 5000), 'the old band is painted again: the session, the mic, the cue, the tray; no who slot, no Blade button (' + JSON.stringify(await painted()) + ')');
  await A.page.click('#gm-ipad-settings [data-set="kit.desk"][data-v="1"]');
  check(await until(async () => !!(await A.page.$('#gm-band .kband-r1 [data-band-place]')), 8000), 'on again: the new band, without a reload');
  check(await until(async () => { const p = await painted(); return /Session 9/.test(p.sess) && p.go && p.ipad && p.stt && p.btn; }, 5000), 'and painted: the session, the mic, the cue unit, the iPad chip, Blade (' + JSON.stringify(await painted()) + ')');
  await A.c.close();

  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''));
  await browser.close();
} catch (e) {
  if (!(ONLY === 'shots' && /shots only/.test(String(e && e.message)))) { console.log('FAIL ' + (e && e.stack || e)); failed++; }
}
clearTimeout(timeout);
console.log((failed ? 'FAIL' : 'PASS') + ' kit-band: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
