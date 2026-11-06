// The band in a real browser (the GM night rebuild, N1a; app/gm/band.js): one header, two rows, on the real GM page, Worker and documents.
//   - at 1366x768, 1536x864, 900x700 and 390x844, in the plain, curfew-due and PANIC states: no two of its items overlap, none is outside the window,
//     nothing sits between the band and the main area, and the Blade tab never covers PANIC
//   - the place chips enter phases (the night, the iPad's band.phase); Back is allowed; Ctrl+Left / Ctrl+Right move the place on screen, not the phase
//   - the curfew due: row 2 red, Call the Aftermath reaches the Aftermath (the night moves; the Aftermath show opens, or the places put the GM there)
//   - Esc, one thing per press: an open thing first (the Menu, Find even with the focus in its box, a sheet with the focus elsewhere), then a field,
//     then the stamp, then PANIC; keys never fire behind an open thing (the Menu, the drawer), and W shuts the drawer it opened
//   - PANIC with no Cues section in the note; the quiet line's badge sits in the band's second row
//   PW_MODULE=<playwright> PW_CHANNEL=msedge GM_SHOTS=<dir> PORT=8810 node checks/runtime/gm-band.e2e.mjs
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
const PORT = Number(process.env.PORT || 8810);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', P1 = 'player1@example.test';
const SHOTS = process.env.GM_SHOTS || '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), np = fx('npc-pack.json');
const MIN = 60000, pad = (n) => (n < 10 ? '0' : '') + n, hm = (ms) => { const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-band-e2e-'));
/* two invented prep notes through the real exporter: one with a run order naming the four phases and a Cues section, one with no Cues at all */
const vault = path.join(stateDir, 'vault'), G = 'Wiki/Games/Blades in the Dark/Campaigns/Group';
const w = (rel, text) => { const f = path.join(vault, ...rel.split('/')); mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, text); };
w(G + '/Sessions/b68g-s09.md', ['---', 'session: 9', 'date: 01/02/2030', 'status: prep', 'gm_prep: true', '---', '', '# Session 9: prep', '',
  'start: 19:30', 'curfew: 22:40', '',
  '## Run order', '', '| # | Beat | About |', '|---|---|---|', '| 1 | Personal business | 30 min |', '| 2 | Planning | 25 min |', '| 3 | The score | 90 min |', '| 4 | Aftermath | 25 min |', '',
  '## Cues', '', 'safe: testcard', '', '1. scene: duskwall', '2. show: title: The Pelican Rooms | A night out', '3. light: Lamps down, amber', '4. phase: plan', '',
  '## Notes', '', 'Nothing else here.', ''].join('\n'));
w(G + '/Sessions/b68g-s10.md', ['---', 'session: 10', 'date: 08/02/2030', 'status: prep', 'gm_prep: true', '---', '', '# Session 10: prep', '', '## Notes', '', 'No cues tonight.', ''].join('\n'));
const prep = buildPrep({ vault, repo: ROOT, exportedAt: new Date().toISOString(), basenames: basenames(vault) });
const PARTS = {
  console: con.parts.console, campaign: np.parts.campaign, npc: np.parts.npc,
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: new Date().toISOString() }, T: loc.T, extra: loc.extra },
  prep
};

const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use: stop what is on it, or set PORT'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM], { cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: 'ignore' });
function killServer() { if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} } }
process.on('exit', () => { killServer(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j }; });
const timeout = setTimeout(() => { console.log('FAIL timed out'); process.exit(1); }, 600000);
const gmState = async () => ((await api('GET', '/gm/state')).json || {}).doc || {};
/* the night the checks want: the Score in play 41 minutes in, Personal and Planning done, the curfew `curfewIn` minutes from now */
async function setNight(o = {}) {
  const now = Date.now();
  await api('PATCH', '/gm/state', { night: null, cues: null });
  await api('PATCH', '/gm/state', { night: { v: 1, phase: o.phase || 'score', startAt: hm(now - 120 * MIN), curfewAt: hm(now + (o.curfewIn === undefined ? 58 : o.curfewIn) * MIN),
    phases: { pb: { budget: 30, start: now - 111 * MIN, end: now - 79 * MIN }, plan: { budget: 25, start: now - 79 * MIN, end: now - 41 * MIN }, score: { budget: 90, start: now - 41 * MIN, end: null } } } });
}

/* everything the band shows, measured in the page: each visible item's box (a place chip clipped to the strip it scrolls in), the window, the main area */
const MEASURE = () => {
  const band = document.querySelector('#gm-band'), main = document.querySelector('.gm-main'), vw = document.documentElement.clientWidth, vh = innerHeight;
  const vis = (e) => { if (!e) return false; const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; const r = e.getBoundingClientRect(); return r.width > 0.5 && r.height > 0.5; };
  const inPopover = (e) => !!e.closest('.gm-menu-list, .gm-cs-pop, .gm-quiet-list');
  const nav = band.querySelector('[data-band-places]'), navR = nav.getBoundingClientRect();
  const sel = 'a.gm-band-mark, #gm-bar-sess, .gm-save, [data-band-place], button, [data-band-clock], [data-band-curfew], .gm-cs-tag, .gm-cs-txt, .gm-cs-hand, #gm-signed, .gm-band-tray > *';
  const items = [];
  for (const e of band.querySelectorAll(sel)) {
    if (!vis(e) || inPopover(e)) continue;
    if (e.matches('.gm-band-tray > *') && e.querySelector('button')) continue;          /* a container in the tray: its buttons are measured */
    if (e.closest('button') && e.closest('button') !== e) continue;                        /* a part of a button */
    let r = e.getBoundingClientRect(), box = { l: r.left, t: r.top, r: r.right, b: r.bottom };
    if (nav.contains(e)) { box = { l: Math.max(box.l, navR.left), t: box.t, r: Math.min(box.r, navR.right), b: box.b }; if (box.r - box.l < 2) continue; }
    items.push({ id: (e.id || e.getAttribute('data-band-place') || e.getAttribute('data-band') || e.getAttribute('data-cs') || e.getAttribute('data-gm') || e.className || e.tagName).toString().slice(0, 30), ...box });
  }
  const over = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i], b = items[j], x = Math.min(a.r, b.r) - Math.max(a.l, b.l), y = Math.min(a.b, b.b) - Math.max(a.t, b.t);
    if (x > 1 && y > 1) over.push(a.id + ' x ' + b.id);
  }
  const out = items.filter((a) => a.l < -0.5 || a.t < -0.5 || a.r > vw + 0.5 || a.b > vh + 0.5).map((a) => a.id);
  const br = band.getBoundingClientRect(), mr = main ? main.getBoundingClientRect() : null;
  const tab = document.querySelector('#as-launch'), panic = band.querySelector('[data-band="panic"]').getBoundingClientRect();
  let tabOver = false;
  if (tab && vis(tab)) { const t = tab.getBoundingClientRect(); tabOver = Math.min(t.right, panic.right) - Math.max(t.left, panic.left) > 1 && Math.min(t.bottom, panic.bottom) - Math.max(t.top, panic.top) > 1; }
  const between = [...document.querySelectorAll('#gm-root > *')].filter((e) => e !== band && vis(e) && getComputedStyle(e).position !== 'fixed' && getComputedStyle(e).position !== 'absolute' && e.getBoundingClientRect().top < (mr ? mr.top : 0) - 1 && e.getBoundingClientRect().top >= br.bottom - 1 && !e.matches('.gm-segbar'));
  return { n: items.length, over, out, bandH: Math.round(br.height), gap: mr ? Math.round(mr.top - br.bottom) : null, tabOver, between: between.map((e) => e.id || e.className), alarm: band.querySelector('.gm-band-r2').getAttribute('data-alarm'), panicR: Math.round(panic.right), vw };
};

try {
  const up = await until(async () => { try { return (await fetch(BASE + '/index.html')).status > 0; } catch (_) { return false; } }, 90000, 500);
  if (!up) throw new Error('the server did not start');
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src || {}, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  await api('PUT', '/campaign', { v: 1, session: { number: 9, startedAt: new Date().toISOString(), endedAt: null }, crew: { name: 'The Lamplighters', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] }, clocks: [], log: [] });
  const noteIds = (prep.notes || []).map((n) => n.id), withCues = noteIds.find((id) => /s09/.test(id)), noCues = noteIds.find((id) => /s10/.test(id));
  check(!!withCues && !!noCues, 'the two invented notes went through the exporter: ' + noteIds.join(', '));
  await setNight();

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open({ w = 1366, h = 768, note = withCues, phone = false } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w, height: h }, serviceWorkers: 'block', ...(phone ? { isMobile: true, hasTouch: true } : {}) });
    await c.addInitScript((id) => { window.__B68_POLL_MS = 700; try { localStorage.setItem('b68.gm.prepNote', id); } catch (e) {} }, note);
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-band [data-band-place]', { timeout: 30000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });      /* the Roll is drawn; it shows only in the places that roll (N1b) */
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await page.waitForTimeout(500);
    return { c, page };
  }
  const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.mouse.move(1, 1); await page.screenshot({ path: path.join(SHOTS, name + '.png'), animations: 'disabled' }); } };
  const blur = (page) => page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());

  /* ---- 1. the layout: four widths, three states ---- */
  for (const [wd, ht] of [[1366, 768], [1536, 864], [900, 700], [390, 844]]) {
    const phone = wd < 600;
    for (const state of ['plain', 'curfew', 'panic']) {
      await setNight({ curfewIn: state === 'curfew' ? -3 : 58 });
      const { c, page } = await open({ w: wd, h: ht, phone });
      if (state === 'panic') { await page.click('#gm-band [data-band="panic"]'); await page.waitForSelector('#gm-band .gm-band-r2[data-alarm="panic"]', { timeout: 8000 }); }
      if (state === 'curfew') await page.waitForSelector('#gm-band .gm-band-r2[data-alarm="curfew"]', { timeout: 15000 });
      await page.waitForTimeout(300);
      const m = await page.evaluate(MEASURE);
      check(m.over.length === 0, wd + 'x' + ht + ' ' + state + ': no two of the band\'s ' + m.n + ' items overlap' + (m.over.length ? ': ' + m.over.slice(0, 4).join(', ') : ''));
      check(m.out.length === 0, wd + 'x' + ht + ' ' + state + ': none is outside the window' + (m.out.length ? ': ' + m.out.join(', ') : ''));
      check(!m.tabOver, wd + 'x' + ht + ' ' + state + ': the Blade tab does not cover PANIC');
      if (!phone && wd >= 1100) check(m.gap !== null && Math.abs(m.gap) <= 1 && m.between.length === 0, wd + 'x' + ht + ' ' + state + ': nothing between the band and the main area (gap ' + m.gap + ', ' + m.between.join(',') + ')');
      if (wd >= 1366 && state !== 'panic') check(m.bandH <= 92, wd + 'x' + ht + ' ' + state + ': two rows (' + m.bandH + ' px)');
      if (phone) check(m.bandH <= (state === 'curfew' ? 150 : 92), '390 ' + state + ': the band leaves the phone\'s first screen to the work (' + m.bandH + ' px' + (state === 'curfew' ? ', the due buttons on a line of their own' : '') + ')');
      if (phone && state === 'plain') {
        const inView = await page.evaluate(() => {
          const n = document.querySelector('#gm-band [data-band-places]'), c = n && (n.querySelector('[aria-current="true"]') || n.querySelector('[data-state="now"]'));
          if (!c) return 'no chip'; const a = c.getBoundingClientRect(), b = n.getBoundingClientRect();
          return a.left >= b.left - 1 && a.right <= b.right + 1 ? '' : c.getAttribute('data-band-place') + ' at ' + Math.round(a.left) + '-' + Math.round(a.right) + ' in ' + Math.round(b.left) + '-' + Math.round(b.right);
        });
        check(inView === '', '390: the place on screen (the Score) is scrolled into view in the row of places' + (inView ? ' (' + inView + ')' : ''));
      }
      await shot(page, 'band-' + state + '-' + wd);
      if (state === 'panic') await page.click('#gm-cuebar [data-cs="resume"]').catch(() => {});
      await c.close();
    }
  }
  check(!(await gmState()).cues || !(await gmState()).cues.panic, 'Resume took the work light down');

  /* ---- 2. the places ---- */
  await setNight({ phase: 'score' });
  await api('PATCH', '/gm/state', { night: null });
  const A = await open();
  const chip = (id) => A.page.$eval('#gm-band [data-band-place="' + id + '"]', (e) => ({ state: e.getAttribute('data-state'), sel: e.getAttribute('aria-current'), text: e.textContent }));
  check((await chip('before')).sel === 'true', 'no phase yet: Before is the place on screen');
  check((await A.page.$$('#gm-band [data-band-place]')).length === 7 && !(await A.page.$('.gm-bar, #gm-phaserail, .gm-curfew')), 'six places and Between in the band; no old bar, rail or curfew bar');
  await A.page.click('#gm-band [data-band-place="plan"]');
  check(await until(async () => (await gmState()).night && (await gmState()).night.phase === 'plan', 5000), 'a tap on Planning enters the phase on the night');
  check(await until(async () => (await chip('plan')).state === 'now', 4000), 'and its chip is now');
  check(await until(async () => JSON.stringify((await api('GET', '/gm/ambient')).json || {}).includes('"plan"'), 8000), 'the iPad is told the phase (band.phase)');
  await A.page.click('#gm-band [data-band-place="pb"]');
  check(await until(async () => (await chip('pb')).state === 'now', 4000) && (await chip('plan')).state !== 'now', 'Back is allowed');
  await blur(A.page); await A.page.keyboard.press('Control+ArrowRight');
  check(await until(async () => (await chip('plan')).sel === 'true', 3000), 'Ctrl+Right puts Planning on screen');
  check(await until(async () => ((await gmState()).night || {}).phase === 'pb', 5000) && (await chip('pb')).state === 'now' && (await chip('plan')).state !== 'now', 'and the night stays in Personal business (the saved state too): Planning on screen, Personal now');
  await A.page.keyboard.press('Control+ArrowLeft'); await A.page.keyboard.press('Control+ArrowLeft');
  check(await until(async () => (await chip('opening')).sel === 'true', 3000), 'Ctrl+Left twice: back past Personal to Opening');
  await shot(A.page, 'band-places-1366');
  await A.page.click('#gm-band [data-band-place="pb"]');      /* back to Personal: a place with the Roll (its line is the field below) */
  check(await until(async () => (await chip('pb')).sel === 'true', 3000), 'a tap on Personal puts it back on screen');

  /* ---- 3. Esc, one thing per press; keys never fire behind an open thing ---- */
  const panicked = async () => !!((await gmState()).cues || {}).panic;
  const cards = async () => JSON.stringify(((await gmState()).cards || {}).situation || null);
  await A.page.click('#gm-band [data-gm="menu"]');
  const before = await cards(); await A.page.keyboard.press('2'); await sleep(600);
  check((await cards()) === before, 'with the Menu open, 2 rolls nothing behind it');
  await A.page.keyboard.press('Escape');
  check(await A.page.$eval('#gm-band .gm-menu-list', (e) => e.hidden), 'Esc shuts the Menu'); await sleep(300); check(!(await panicked()), 'and is not a PANIC');
  await A.page.keyboard.press('Control+k'); await A.page.waitForSelector('#gm-find:not([hidden])');
  check(await A.page.evaluate(() => document.activeElement && document.activeElement.id === 'gm-find-q'), 'Find has the focus in its box');
  await A.page.keyboard.press('Escape');
  check(await A.page.$eval('#gm-find', (e) => e.hidden), 'Esc shuts Find (an open thing goes before the field)'); await sleep(300); check(!(await panicked()), 'not a PANIC');
  await A.page.keyboard.press('w'); await A.page.waitForSelector('#gm-drawer', { state: 'attached' });
  check(await until(async () => A.page.$eval('#gm-root', (e) => e.classList.contains('dw-open')), 3000), 'W opens the drawer (Crew)');
  const b2 = await cards(); await A.page.keyboard.press('2'); await sleep(600); check((await cards()) === b2, 'with the drawer open, 2 rolls nothing behind it');
  await A.page.keyboard.press('w'); check(await until(async () => !(await A.page.$eval('#gm-root', (e) => e.classList.contains('dw-open'))), 3000), 'W shuts the drawer it opened (its own key)');
  await A.page.keyboard.press('2'); check(await until(async () => (await cards()) !== b2, 4000), 'with nothing open, 2 rolls');
  /* a sheet open, the focus elsewhere: Esc shuts the sheet, never a PANIC (the tools register their sheets) */
  const sheetOpened = await A.page.evaluate(() => { const T = window.B68GmTools, t = T && T.get && T.get('preflight'); if (!t) return false; t.open(); return true; });
  if (sheetOpened) {
    await A.page.waitForSelector('#gm-sheet-preflight:not([hidden])', { timeout: 5000 }); await blur(A.page);
    await A.page.keyboard.press('Escape'); await sleep(300);
    check(await A.page.$eval('#gm-sheet-preflight', (e) => e.hidden), 'a sheet with the focus elsewhere: Esc shuts it'); check(!(await panicked()), 'and is not a PANIC');
  } else console.log('NOTE the tool registry (B68GmTools) is not on this page: the sheet step is skipped');
  /* a field: Esc leaves it */
  await A.page.focus('#gm-c-threat');
  check(await A.page.evaluate(() => document.activeElement && document.activeElement.id === 'gm-c-threat'), 'a field has the focus (the Roll’s line)');
  await A.page.keyboard.press('Escape'); await sleep(200);
  check(await A.page.evaluate(() => document.activeElement && document.activeElement.id !== 'gm-c-threat'), 'Esc leaves a field'); check(!(await panicked()), 'and is not a PANIC');
  /* the stamp (the Roll's, N4): up, then one Esc takes it down; skipped when this page has no Stamp button */
  const stampOpen = () => A.page.evaluate(() => !!window.B68GmEsc && window.B68GmEsc.list().some((e) => e.id === 'stamp' && e.kind === 'stamp' && e.open));
  if (await A.page.$('#gm-stamp [data-gm="stamp"]')) {
    await A.page.click('#gm-pos [data-v="risky"]'); await A.page.click('#gm-eff [data-v="standard"]'); await A.page.click('#gm-stamp [data-gm="stamp"]');
    check(!!(await until(stampOpen, 6000)), 'a stamp is up');
    await blur(A.page); await A.page.keyboard.press('Escape');
    check(!!(await until(async () => !(await stampOpen()), 4000)), 'one Esc takes the stamp down'); await sleep(300); check(!(await panicked()), 'and is not a PANIC');
  } else console.log('NOTE no Stamp button on this page: the stamp step is skipped');
  /* nothing open, no field, no stamp: PANIC */
  await blur(A.page); await A.page.keyboard.press('Escape');
  check(await until(panicked, 4000), 'with nothing open, Esc is PANIC (the work light is in the state)');
  check(await until(async () => (await A.page.$eval('#gm-band .gm-band-r2', (e) => e.getAttribute('data-alarm'))) === 'panic', 3000), 'row 2 turns red');
  check(await until(async () => { const a = (await api('GET', '/gm/ambient')).json; return JSON.stringify(a || {}).includes('testcard'); }, 5000), 'the iPad is on the safe scene');
  await A.page.click('#gm-cuebar [data-cs="resume"]');
  check(await until(async () => !(await panicked()), 4000), 'Resume');
  await A.c.close();

  /* ---- 4. the curfew: Call the Aftermath reaches the Aftermath ---- */
  await setNight({ curfewIn: -2 });
  const C = await open();
  await C.page.waitForSelector('#gm-band .gm-band-r2[data-alarm="curfew"]', { timeout: 15000 });
  check(await C.page.$eval('#gm-band [data-band-due]', (e) => !e.hidden && /Call the Aftermath/.test(e.textContent) && /Keep running/.test(e.textContent) && /Snooze 10 min/.test(e.textContent)), 'the curfew is due: Call the Aftermath, Keep running, Snooze 10 min');
  await shot(C.page, 'band-curfew-call-1366');
  await C.page.click('#gm-band [data-band="call"]');
  check(await until(async () => ((await gmState()).night || {}).phase === 'after', 5000), 'Call the Aftermath moves the night to the Aftermath');
  const places = await C.page.evaluate(() => !!(window.B68GmPage && typeof window.B68GmPage._places === 'function' && window.B68GmPage._places()));
  if (places) {
    check(await until(async () => C.page.$eval('#gm-band [data-band-place="after"]', (e) => e.getAttribute('aria-current') === 'true'), 4000) && await C.page.$eval('#gm-root', (r) => r.getAttribute('data-place')) === 'after', 'and the page goes to the Aftermath place (the places, N1b), its chip selected in the band');
    check(await until(async () => !!(await C.page.$('#gm-sheet-aftermath:not([hidden]), [data-inline="aftermath"]')), 5000), 'where the Aftermath show is open');
  }
  else check(await until(async () => !!(await C.page.$('#gm-sheet-aftermath:not([hidden]), .gm-inline [data-tool="aftermath"], .gm-inline .gm-aft')), 5000), 'and the Aftermath show opens (no places registry on this page)');
  check(await until(async () => (await C.page.$eval('#gm-band .gm-band-r2', (e) => e.getAttribute('data-alarm'))) === '', 4000), 'the row is calm again');
  await C.c.close();

  /* ---- 5. PANIC with no Cues section in the note; the quiet line in the band ---- */
  await setNight();
  const qr = await api('PUT', '/docs', { kind: 'quiet', scope: 'player', json: { v: 1, items: [{ k: 'pause', at: Date.now() }] } }, P1);
  const N = await open({ note: noCues });
  await N.page.waitForSelector('#gm-cuebar[data-state="idle"]', { state: 'attached', timeout: 10000 });
  check(/NO CUES/.test(await N.page.$eval('#gm-cuebar', (e) => e.textContent)), 'a note with no Cues section: NO CUES');
  await N.page.click('#gm-band [data-band="panic"]');
  check(await until(panicked, 4000), 'PANIC still works without cues'); check(await until(async () => (await N.page.$eval('#gm-band .gm-band-r2', (e) => e.getAttribute('data-alarm'))) === 'panic', 3000), 'and the row is red');
  await N.page.click('#gm-cuebar [data-cs="resume"]'); check(await until(async () => !(await panicked()), 4000), 'Resume');
  if (qr.status === 200) {
    const q = await until(async () => N.page.$('#gm-band .gm-band-r2 .gm-quiet-badge'), 15000);
    check(!!q, 'the quiet line\'s badge is in the band\'s second row');
    if (q) {
      const inBand = await N.page.evaluate(() => { const b = document.querySelector('#gm-band').getBoundingClientRect(), q = document.querySelector('.gm-quiet-badge').getBoundingClientRect(); return q.top >= b.top && q.bottom <= b.bottom; });
      check(inBand && !(await N.page.$('body > .gm-quiet-badge')), 'inside the band, not floating over the console');
      await N.page.click('#gm-band .gm-quiet-badge'); await N.page.waitForSelector('#gm-band .gm-quiet-list:not([hidden])');
      await shot(N.page, 'band-quiet-1366');
      await N.page.keyboard.press('Escape');
      check(await N.page.$eval('#gm-band .gm-quiet-list', (e) => e.hidden), 'Esc shuts the quiet list'); await sleep(300); check(!(await panicked()), 'and is not a PANIC');
    }
  } else console.log('NOTE the quiet row was refused (' + qr.status + '): the quiet steps are skipped');
  await N.c.close();

  check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' / ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
}
clearTimeout(timeout);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
