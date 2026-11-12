// kit-run (KS08 of the kit and stage build): the Run view on the new desk (kit.desk on), on the demo night (scripts/demo-night.mjs: the real
// Worker, pack and GM page, everything invented), in a real browser. No model, no key: the Anthropic keys are taken out of the environment.
//   0. the setting off: today's Run view (no krv- markup, the old view chips), and the kit-desk bundle's gm/kit/run.js is not fetched
//   1. the head (KS08.1): one line at 1366 (every part on one row, nothing past the edge), the site's title, the beat, the time, the alarm as a chip with
//      a meter, the countdown chip with a meter, the Players chip, ⋯; every old hook (data-rv back/next/timepop/tgo/menu, #rv-time, [data-rvtimer])
//   2. tabs and tools (KS08.2): Board · Map · Players as kit Tabs that switch the view; the map tools quiet; every hook of today's head, toolbar and ⋯
//      (data-rv / data-site and its key) is still on the page with the kit on (moved, not gone); ⋯ opens and Esc shuts it
//   3. the rooms (KS08.3): rows grouped by floor, each with a swatch and its word, the PCs' heads in the room they are in; a row tapped is selected
//      (the inspector follows), Enter on a row selects it, a PC armed then a row tapped moves the PC (and back); Right and Left step a beat as today
//   4. the inspector (KS08.4): the room's name, the players' map control (Blueprint then Dark again: the per-room reveal), Who's here as rows with
//      one action and ⋯, What they can learn: Tell the crew writes ball.told[id] = "crew" (as today) and shows Told, which takes it back
//   5. secrecy: the iPad's GET and a phone's GET carry no GM-ONLY- text before or after; the boxed controls on Run at 1366x768 (the kit-accept
//      measure: the Run view's own, and the whole window's, printed); nothing under 12 px in the Run view
//   6. the setting off mid-session: today's Run view comes back without a reload
//   7. Add someone opened focuses its field; a row's ⋯ open and the view redrawn under it (another device, the beat timer): the FIRST Esc is PANIC
//   8. the GM's phone (KS20): at 390x844 and 360x640 the Run view is one column (the board, then the inspector), nothing past the window's edge,
//      on the Board and the Map; at 1366 and 1536 it keeps its two columns
//   (2: also every view tab is in the tab order, and the map's Blank stays a quiet button in the toolbar while the map is live)
// SHOTS=<dir> writes the pictures (<view>-<theme>-<width>.png).
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9406] [SHOTS=<dir>] node checks/runtime/kit-run.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9406);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test', P1 = 'player1@example.test';
const SHOTS = process.env.SHOTS || '';
if (!process.env.PW_MODULE) { console.log('SKIP kit-run: PW_MODULE is not set (it needs Playwright)'); process.exit(0); }
const { chromium } = require(process.env.PW_MODULE);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 150) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, text: t, json: j }; });
const feats = (f) => api('PATCH', '/gm/state', { features: f });

/* the demo night, on its own temp state */
const env = { ...process.env };
delete env.ANTHROPIC_API_KEY; delete env.B68_ANTHROPIC_KEY;
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const demo = spawn(process.execPath, [path.join(ROOT, 'scripts', 'demo-night.mjs'), '--port', String(PORT)], { cwd: ROOT, env, detached: !WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let demoLog = '';
demo.stdout.on('data', (d) => { demoLog += d; }); demo.stderr.on('data', (d) => { demoLog += d; });
function killDemo() { if (WIN) spawnSync('taskkill', ['/pid', String(demo.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-demo.pid, 'SIGKILL'); } catch (_) {} } }
process.on('exit', killDemo);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + demoLog.slice(-2000)); process.exit(1); }, 600000);

/* the kit-accept measure (KS04.4): a visible control in the window drawn as a box */
const MEASURE = () => {
  const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0; };
  const alpha = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return 0; const p = m[1].split(/[ ,/]+/).filter(Boolean); return p.length > 3 ? parseFloat(p[3]) : 1; };
  const boxed = (e) => { const s = getComputedStyle(e); for (const side of ['top', 'right', 'bottom', 'left']) if (parseFloat(s.getPropertyValue('border-' + side + '-width')) >= 1 && s.getPropertyValue('border-' + side + '-style') !== 'none' && alpha(s.getPropertyValue('border-' + side + '-color')) > 0) return true; return alpha(s.backgroundColor) > 0 || (s.boxShadow && s.boxShadow !== 'none') || false; };
  const touches = (e) => { const r = e.getBoundingClientRect(); return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; };
  const all = [...document.querySelectorAll('button, [role="button"], input:not([type="hidden"]), select, textarea, summary')].filter(vis).filter(touches).filter(boxed);
  const run = all.filter((e) => e.closest('#gm-runv'));
  let small = 99;
  for (const e of document.querySelectorAll('#gm-runv *')) {
    let own = ''; for (const n of e.childNodes) if (n.nodeType === 3) own += n.nodeValue;
    if (!own.trim() || e.closest('svg')) continue;
    const r = e.getBoundingClientRect(), s = getComputedStyle(e);
    if (r.width < 2 || r.height < 2 || r.top >= innerHeight || r.bottom <= 0 || s.visibility === 'hidden' || (s.position === 'absolute' && s.clip && s.clip !== 'auto')) continue;
    small = Math.min(small, parseFloat(s.fontSize));
  }
  return { total: all.length, run: run.length, runList: run.map((e) => (e.textContent || e.value || e.getAttribute('aria-label') || '').trim().slice(0, 20)), small };
};
/* every hook of the head, the toolbar and ⋯ (data-rv / data-site and the key that says which), so moved is checked, not gone */
const HOOKS = () => [...document.querySelectorAll('#gm-runv .rv-headwrap [data-rv], #gm-runv .rv-headwrap [data-site], #gm-runv .rv-tools [data-rv], #gm-runv .rv-tools [data-site]')]
  .map((e) => (e.getAttribute('data-rv') || '') + '/' + (e.getAttribute('data-site') || '') + '/' + (e.getAttribute('data-v') || e.getAttribute('data-mid') || e.getAttribute('data-group') || e.getAttribute('data-key') || ''))
  .filter((v, i, a) => a.indexOf(v) === i).sort();

let browser = null;
try {
  const up = await until(async () => { if (demo.exitCode !== null) throw new Error('the demo night exited:\n' + demoLog); return /Ctrl\+C stops it/.test(demoLog); }, 240000, 500);
  if (!up) throw new Error('the demo night did not start:\n' + demoLog.slice(-3000));
  browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  const blur = (page) => page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); });
  async function open({ w = 1366, h = 768, theme = 'paper', kit = true } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w, height: h }, serviceWorkers: 'block' });
    await c.addInitScript({ content: 'window.__B68_POLL_MS = 1000; try { localStorage.setItem("b68.theme", ' + JSON.stringify(theme === 'night' ? 'dark' : 'light') + '); } catch (e) {}' });
    const page = await c.newPage(), fetched = [];
    page.on('request', (r) => fetched.push(r.url()));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('dialog', (d) => d.dismiss());
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me && window.B68GmPage && window.B68GmPage._places && window.B68GmPage._places(), null, { timeout: 40000 });
    if (kit) await page.waitForFunction(() => window.B68Kit && window.B68Kit.ready('desk') && window.B68KitRun, null, { timeout: 30000 });
    await blur(page); await page.waitForTimeout(600);
    await page.evaluate(() => window.B68GmPage.goPlace('score')); await page.waitForTimeout(700);
    await page.keyboard.press('g');
    await page.waitForSelector(kit ? '.krv-head' : '.rv-head', { timeout: 20000 }); await page.waitForTimeout(700);
    return { c, page, fetched };
  }
  const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.mouse.move(1, 1); await page.waitForTimeout(250); await page.screenshot({ path: path.join(SHOTS, name + '.png'), animations: 'disabled' }); } };
  const secret = async () => { const d = await api('GET', '/gm/display', undefined, IPAD), p = await api('GET', '/characters/pc-nell', undefined, P1); return { ok: d.status === 200 && p.status === 200, leak: /GM-ONLY-/.test(d.text) || /GM-ONLY-/.test(p.text) }; };

  /* ---- 0. the setting off ---- */
  check((await feats({ 'kit.desk': false })).status === 200, 'kit.desk is off');
  let off = null;
  {
    const { c, page, fetched } = await open({ kit: false });
    off = await page.evaluate(() => ({ krv: !!document.querySelector('#gm-runv.krv, .krv-head, .krv-room'), chips: document.querySelectorAll('.rv-tools .rv-views [data-rv="view"].chip').length, cards: document.querySelectorAll('.rv-card').length }));
    const hooksOff = await page.evaluate(HOOKS);
    off.hooks = hooksOff;
    check(!off.krv && off.chips >= 2 && off.cards > 0, 'off: today\'s Run view (the view chips, the room cards), nothing of the kit ' + JSON.stringify({ krv: off.krv, chips: off.chips, cards: off.cards }));
    check(!fetched.some((u) => /gm\/kit\/run\.js|ui\/desk-run\.css/.test(u)), 'off: gm/kit/run.js and ui/desk-run.css are not fetched');
    await shot(page, 'run-off-paper-1366');
    await c.close();
  }
  const s0 = await secret();
  check(s0.ok && !s0.leak, 'secrecy before: the iPad\'s GET and a phone\'s GET carry no GM-ONLY- text');

  /* ---- the setting on ---- */
  check((await feats({ 'kit.desk': true })).status === 200, 'kit.desk is on');
  const { c, page } = await open();
  await shot(page, 'run-paper-1366');

  /* 1. the head */
  const head = await page.evaluate(() => {
    const hd = document.querySelector('.krv-head'), hr = hd.getBoundingClientRect(), kids = [...hd.children].filter((e) => e.getBoundingClientRect().width > 0);
    const mids = kids.map((e) => { const r = e.getBoundingClientRect(); return (r.top + r.bottom) / 2; });
    return { h: Math.round(hr.height), spread: Math.round(Math.max(...mids) - Math.min(...mids)), past: kids.filter((e) => e.getBoundingClientRect().right > hr.right + 1).map((e) => e.className),
      title: (document.querySelector('.krv-title') || {}).textContent, beat: (document.querySelector('.krv-beat') || {}).textContent, time: !!document.querySelector('#rv-time'), timer: !!document.querySelector('.krv-head [data-rvtimer]'),
      alarm: !!document.querySelector('.krv-head [data-rv="alarm"].ui-chip .ui-meter'), count: !!document.querySelector('.krv-head .rv-count.ui-chip .ui-meter'), players: !!document.querySelector('.krv-head .rv-players'),
      hooks: ['back', 'next', 'timepop', 'tgo', 'menu'].every((k) => document.querySelector('.krv-head [data-rv="' + k + '"]')) };
  });
  check(head.h <= 48 && head.spread <= 4 && !head.past.length, 'the head is one line at 1366: ' + JSON.stringify({ h: head.h, spread: head.spread, past: head.past }));
  check(head.title === 'The Pelican Rooms' && /^Beat \d+ of \d+$/.test(head.beat || '') && head.time && head.timer, 'the head says the site, the beat, the time and the timer: ' + JSON.stringify([head.title, head.beat]));
  check(head.alarm && head.count && head.players, 'the clocks are chips with meters (the alarm, the countdown), and the Players chip is there');
  check(head.hooks, 'the head keeps data-rv back, next, timepop, tgo and menu');

  /* 2. tabs, tools and ⋯ */
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.krv-views[role="tablist"] [role="tab"][data-rv="view"]')].map((t) => t.textContent.trim() + ':' + t.getAttribute('aria-selected')));
  check(tabs.join(',') === 'Board:true,Map:false,Players:false', 'Board · Map · Players are kit Tabs, Board selected: ' + tabs.join(','));
  await page.click('.krv-views [data-v="map"]'); await page.waitForTimeout(500);
  check(await page.evaluate(() => document.querySelector('#rv-view').getAttribute('data-view') === 'map' && document.querySelector('.krv-views [data-v="map"]').getAttribute('aria-selected') === 'true'), 'the Map tab shows the map');
  await shot(page, 'run-map-paper-1366');
  await page.click('.krv-views [data-v="board"]'); await page.waitForTimeout(500);
  check(await page.evaluate(() => document.querySelector('#rv-view').getAttribute('data-view') === 'board'), 'the Board tab shows the board again');
  const tools = await page.evaluate(() => [...document.querySelectorAll('.krv-mtools [data-site]')].map((b) => b.getAttribute('data-site') + ':' + (b.classList.contains('ui-btn--quiet') || b.getAttribute('data-site') === 'send')));
  check(tools.length >= 3 && tools.every((t) => /:true$/.test(t)), 'the map tools are quiet: ' + tools.join(','));
  /* every view tab is in the tab order (Left and Right stay the beat's): Tab from Board reaches Map, then Players */
  await page.focus('.krv-views [data-v="board"]'); await page.keyboard.press('Tab');
  const tab1 = await page.evaluate(() => document.activeElement.getAttribute('data-v'));
  await page.keyboard.press('Tab');
  const tab2 = await page.evaluate(() => document.activeElement.getAttribute('data-v'));
  check(tab1 === 'map' && tab2 === 'players', 'Tab goes Board → Map → Players: ' + [tab1, tab2].join(','));
  await blur(page);
  /* the map's Blank: in the toolbar, one press, while the map is live */
  const wasLive = await page.evaluate(() => !!document.querySelector('.krv-mtools [data-site="ipad-down"]'));
  if (!wasLive && await page.$('.krv-mtools [data-site="ipad"]')) { await page.click('.krv-mtools [data-site="ipad"]'); await until(() => page.evaluate(() => !!document.querySelector('.krv-mtools [data-site="ipad-down"]')), 6000); await page.waitForTimeout(400); }
  const live = await page.evaluate(() => ({ down: !!document.querySelector('.krv-mtools [data-site="ipad-down"]'), blank: !!document.querySelector('.krv-mtools [data-site="blank"].ui-btn--quiet'), menu: !!document.querySelector('#rv-menu [data-site="blank"]') }));
  check(live.down && live.blank && !live.menu, 'while the map is live its Blank is a quiet button in the toolbar (not in ⋯): ' + JSON.stringify(live));
  if (!wasLive && live.down) { await page.click('.krv-mtools [data-site="ipad-down"]'); await until(() => page.evaluate(() => !document.querySelector('.krv-mtools [data-site="ipad-down"]')), 6000); await page.waitForTimeout(400); }
  await blur(page);
  await page.click('.krv-head [data-rv="menu"]'); await page.waitForTimeout(300);
  check(await page.evaluate(() => { const m = document.querySelector('#rv-menu'); return !!m && !m.hidden && m.getBoundingClientRect().height > 0 && m.querySelectorAll('.ui-menu-item').length >= 3; }), '⋯ opens the kit menu (#rv-menu)');
  await shot(page, 'run-menu-paper-1366');
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  check(await page.evaluate(() => document.querySelector('#rv-menu').hidden), 'Esc shuts ⋯');

  /* 3. the rooms */
  const rooms = await page.evaluate(() => ({ floors: [...document.querySelectorAll('.krv-floor .krv-floorname')].map((e) => e.textContent), rows: [...document.querySelectorAll('.krv-room')].map((r) => ({ room: r.getAttribute('data-room'), rv: r.getAttribute('data-rv'), card: r.classList.contains('rv-card'), sw: !!r.querySelector('.krv-sw'), sub: (r.querySelector('.krv-rsub') || {}).textContent || '', pcs: [...r.querySelectorAll('.rv-pc[data-rv="pc"]')].map((p) => p.getAttribute('data-id')) })) }));
  check(rooms.floors.length >= 2 && rooms.rows.length >= 4 && rooms.rows.every((r) => r.rv === 'room' && r.card && r.sw && /^(Dark|Blueprint|Seen|Open|Not open)/.test(r.sub)), 'rooms are rows by floor, each with its swatch and its word: ' + rooms.floors.join(','));
  const show = rooms.rows.find((r) => r.room === 'Showroom') || {}, lounge = rooms.rows.find((r) => r.room === 'Cocktail lounge') || {};
  check(String(show.pcs) === 'pc-ray,pc-tam' && String(lounge.pcs) === 'pc-nell', 'the PCs\' heads are in the room they are in: ' + JSON.stringify([show.pcs, lounge.pcs]));
  const pick = rooms.rows.find((r) => !r.pcs.length) || rooms.rows[0];
  await page.click('.krv-room[data-room="' + pick.room + '"] .krv-rname'); await page.waitForTimeout(400);
  check(await page.evaluate((n) => document.querySelector('.krv-room[data-room="' + n + '"]').classList.contains('is-selected') && document.querySelector('.krv-rm .krv-rmt').firstChild.textContent.trim() === n, pick.room), 'a row tapped is selected and the inspector shows it (' + pick.room + ')');
  await page.focus('.krv-room[data-room="Showroom"]'); await page.keyboard.press('Enter'); await page.waitForTimeout(400);
  check(await page.evaluate(() => document.querySelector('.krv-room[data-room="Showroom"]').classList.contains('is-selected')), 'Enter on a focused row selects it');
  await page.click('.krv-room[data-room="Cocktail lounge"] .rv-pc[data-id="pc-nell"]'); await page.waitForTimeout(300);
  check(await page.evaluate(() => !!document.querySelector('.krv-arm') && document.querySelector('.rv-pc[data-id="pc-nell"]').getAttribute('aria-pressed') === 'true'), 'a PC\'s head tapped is armed');
  await page.click('.krv-room[data-room="' + pick.room + '"] .krv-rname'); await page.waitForTimeout(600);
  check(await page.evaluate((n) => !!document.querySelector('.krv-room[data-room="' + n + '"] .rv-pc[data-id="pc-nell"]'), pick.room), 'then a row tapped moves the PC there');
  await page.click('.rv-pc[data-id="pc-nell"]'); await page.waitForTimeout(250); await page.click('.krv-room[data-room="Cocktail lounge"] .krv-rname'); await page.waitForTimeout(600);
  check(await page.evaluate(() => !!document.querySelector('.krv-room[data-room="Cocktail lounge"] .rv-pc[data-id="pc-nell"]')), 'and back again');
  await blur(page);
  const t0 = await page.$eval('#rv-time', (e) => e.textContent);
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(700);
  const t1 = await page.$eval('#rv-time', (e) => e.textContent);
  await blur(page); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(700);
  const t2 = await page.$eval('#rv-time', (e) => e.textContent);
  check(t1 !== t0 && t2 === t0, 'Right steps a beat and Left steps back, as today: ' + [t0, t1, t2].join(' → '));

  /* 4. the inspector */
  await page.click('.krv-room[data-room="Showroom"] .krv-rname'); await page.waitForTimeout(400);
  await shot(page, 'run-inspector-paper-1366');
  const insp = await page.evaluate(() => ({ seg: [...document.querySelectorAll('.krv-rm .krv-kseg [data-site="kn"]')].map((b) => b.getAttribute('data-k')), rows: [...document.querySelectorAll('.krv-rm .krv-p')].map((r) => ({ acts: r.querySelectorAll('.ui-row-acts > .ui-btn:not(.ui-row-more)').length, more: !!r.querySelector('[data-ui-more]') })), learn: document.querySelectorAll('.krv-rm .krv-learn').length }));
  check(insp.seg.join(',') === 'dark,blueprint,seen', 'the players\' map control: dark, blueprint, seen (data-site="kn")');
  check(insp.rows.length >= 1 && insp.rows.every((r) => r.acts === 1), 'Who\'s here: rows with one visible action each (' + insp.rows.length + ')');
  check(insp.learn >= 1, 'What they can learn here: ' + insp.learn + ' piece(s) of intel');
  /* per-room reveal: a dark room to blueprint and back, from the inspector */
  const dark = rooms.rows.find((r) => /^Dark/.test(r.sub));
  if (dark) {
    await page.click('.krv-room[data-room="' + dark.room + '"] .krv-rname'); await page.waitForTimeout(400);
    await page.click('.krv-rm .krv-kseg [data-k="blueprint"]'); await page.waitForTimeout(800);
    const bp = await page.evaluate((n) => ({ sub: document.querySelector('.krv-room[data-room="' + n + '"] .krv-rsub').textContent, sw: document.querySelector('.krv-room[data-room="' + n + '"] .krv-sw').classList.contains('k-blueprint') }), dark.room);
    check(/^Blueprint/.test(bp.sub) && bp.sw, 'Blueprint from the inspector: the row says it and its swatch shows it (' + dark.room + ')');
    await page.click('.krv-rm .krv-kseg [data-k="dark"]'); await page.waitForTimeout(800);
    check(await page.evaluate((n) => /^Dark/.test(document.querySelector('.krv-room[data-room="' + n + '"] .krv-rsub').textContent), dark.room), 'and Dark again');
  } else check(false, 'a dark room to try the per-room reveal on');
  /* Tell the crew: the same write as today */
  await page.click('.krv-room[data-room="Showroom"] .krv-rname'); await page.waitForTimeout(400);
  const iid = await page.$eval('.krv-rm .krv-learn', (e) => e.getAttribute('data-intel'));
  const before = ((await api('GET', '/gm/state')).json || {}).doc || {};
  const was = before.ball && before.ball.told ? before.ball.told[iid] : undefined;
  await page.click('.krv-rm .krv-learn[data-intel="' + iid + '"] [data-rv="tellroom"]');
  const told = await until(async () => { const s = ((await api('GET', '/gm/state')).json || {}).doc || {}; return s.ball && s.ball.told && s.ball.told[iid] === 'crew'; }, 6000);
  check(told, 'Tell the crew writes ball.told.' + iid + ' = "crew", as today (it was ' + JSON.stringify(was === undefined ? null : was) + ')');
  check(await page.evaluate((id) => { const b = document.querySelector('.krv-rm .krv-learn[data-intel="' + id + '"] [data-rv="tellroom"]'); return !!b && b.classList.contains('ui-chip') && b.textContent.trim() === 'Told' && b.getAttribute('aria-pressed') === 'true'; }, iid), 'and the row shows Told');
  await page.click('.krv-rm .krv-learn[data-intel="' + iid + '"] [data-rv="tellroom"]');
  const back = await until(async () => { const s = ((await api('GET', '/gm/state')).json || {}).doc || {}; return !(s.ball && s.ball.told && s.ball.told[iid]); }, 6000);
  check(back, 'Told tapped takes it back');

  /* 5. secrecy and the numbers */
  const s1 = await secret();
  check(s1.ok && !s1.leak, 'secrecy after: the iPad\'s GET and a phone\'s GET carry no GM-ONLY- text');
  await page.evaluate(() => window.scrollTo(0, 0)); await page.mouse.move(1, 1); await page.waitForTimeout(300);
  const m = await page.evaluate(MEASURE);
  console.log('     boxed controls at 1366x768: the Run view ' + m.run + ' (' + m.runList.join(', ') + '); the whole window ' + m.total + ' (the target, 25, counts the band and the Roll too)');
  check(m.run <= 12, 'the Run view draws 12 or fewer boxed controls at 1366x768 (' + m.run + ')');
  check(m.small >= 12, 'nothing in the Run view under 12 px (smallest ' + m.small + ')');
  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));

  /* 6. the setting off mid-session */
  const hooksOn = await page.evaluate(HOOKS);
  /* the way the GM turns it off: Settings in the iPad pane (I), then back to the Run view (G) */
  await blur(page); await page.keyboard.press('i');
  await page.waitForSelector('#gm-ipad-settings [data-set="kit.desk"][data-v="0"]', { timeout: 8000 });
  await page.click('#gm-ipad-settings [data-set="kit.desk"][data-v="0"]'); await page.waitForTimeout(600);
  await blur(page); await page.keyboard.press('g'); await page.waitForTimeout(600);
  check(true, 'kit.desk turned off mid-session, from Settings');
  const back2 = await until(() => page.evaluate(() => !!document.querySelector('.rv-head') && !document.querySelector('.krv-head, .krv-room') && !document.querySelector('#gm-runv').classList.contains('krv')), 15000, 300);
  check(back2, 'today\'s Run view comes back without a reload' + (back2 ? '' : ' ' + JSON.stringify(await page.evaluate(() => ({ kit: document.documentElement.getAttribute('data-kit'), krv: document.querySelector('#gm-runv').className, head: !!document.querySelector('.krv-head'), room: !!document.querySelector('.krv-room') })))));
  /* moved, not gone: every hook of today's head, toolbar and ⋯, read in the same page a moment apart (the map's live state changes between pages) */
  const hooksOff = await page.evaluate(HOOKS), lost = hooksOff.filter((k) => hooksOn.indexOf(k) < 0);
  check(hooksOff.length > 10 && !lost.length, 'every hook of today\'s head, toolbar and ⋯ (' + hooksOff.length + ') was on the page with the kit on' + (lost.length ? ': lost ' + lost.join(', ') : ''));
  await c.close();
  await feats({ 'kit.desk': true });

  /* the pictures: Paper and Night at 1366 and 1536 */
  if (SHOTS) for (const [w, h] of [[1366, 768], [1536, 864]]) for (const theme of ['paper', 'night']) {
    const o = await open({ w, h, theme });
    await o.page.click('.krv-room[data-room="Showroom"] .krv-rname'); await o.page.waitForTimeout(400);
    await shot(o.page, 'run-' + theme + '-' + w);
    await o.c.close();
  }

  /* 7. the Add someone fold focuses its field; then Esc after a redraw under an open row ⋯ is PANIC at the first press (the review's blocker) */
  {
    const o = await open();
    await o.page.click('.krv-room[data-room="Showroom"] .krv-rname'); await o.page.waitForTimeout(400);
    await o.page.click('.krv-rm .krv-addsum'); await o.page.waitForTimeout(500);
    check(await o.page.evaluate(() => !!document.activeElement && document.activeElement.matches('#gm-runv .krv-padd input')), 'Add someone opened: its field has the focus');
    await o.page.click('.krv-rm .krv-addsum'); await o.page.waitForTimeout(400); await blur(o.page);
    await o.page.click('.krv-rm .krv-p [data-ui-more]'); await o.page.waitForTimeout(300);
    const opened = await o.page.evaluate(() => [...document.querySelectorAll('#gm-runv .krv-p .ui-menu')].some((m) => !m.hidden));
    await o.page.evaluate(() => window.B68GmRunView.redrawAll()); await o.page.waitForTimeout(400);
    const writes = [];
    o.page.on('request', (r) => { if (r.method() !== 'GET' && /\/api\/gm\/(display|ambient)/.test(r.url())) writes.push(r.method() + ' ' + r.url()); });
    await o.page.keyboard.press('Escape');
    await until(() => writes.length > 0, 3000);
    check(opened && writes.length > 0, 'a row ⋯ open, the view redrawn under it: the FIRST Esc is PANIC (' + writes.length + ' writes)');
    await o.c.close();
  }

  /* 8. the GM's phone (KS20): under 760 px the Run view is one column, the board and the inspector stacked, nothing past the window's edge
     (the head and the tools wrap); on the laptops it keeps its two columns. The Board and the Map both. */
  const LAYOUT = () => {
    const body = document.querySelector('#gm-runv.krv > .rv-body'), main = body && body.querySelector(':scope > .rv-main'), side = body && body.querySelector(':scope > .rv-side');
    if (!body || !main || !side) return { missing: true };
    const tracks = getComputedStyle(body).gridTemplateColumns.split(' ').filter(Boolean).length, mr = main.getBoundingClientRect(), sr = side.getBoundingClientRect();
    const vis = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const parts = [...document.querySelectorAll('#gm-runv .krv-head > *, #gm-runv .krv-tools > *, #gm-runv .krv-mtools > *, #gm-runv .krv-room, #gm-runv .krv-rm')].filter(vis);
    const past = parts.filter((e) => { const r = e.getBoundingClientRect(); return r.left < -1 || r.right > innerWidth + 1; }).map((e) => e.className.split(' ').slice(-1)[0] + ':' + Math.round(e.getBoundingClientRect().right));
    const rooms = [...document.querySelectorAll('#gm-runv .krv-room')].filter(vis).map((e) => Math.round(e.getBoundingClientRect().width));
    return { tracks, stacked: sr.top >= mr.bottom - 1, mainW: Math.round(mr.width), sideW: Math.round(sr.width), past, roomMin: rooms.length ? Math.min(...rooms) : 0,
      scroll: document.documentElement.scrollWidth - innerWidth, paneScroll: (() => { const p = document.querySelector('#gm-runv'); return p.scrollWidth - p.clientWidth; })() };
  };
  for (const [w, h] of [[390, 844], [360, 640]]) for (const view of ['board', 'map']) {
    const o = await open({ w, h });
    if (view === 'map') { await o.page.click('.krv-views [data-v="map"]'); await o.page.waitForTimeout(700); }
    const L = await o.page.evaluate(LAYOUT);
    check(!L.missing && L.tracks === 1 && L.stacked && L.mainW >= w - 60 && L.sideW >= w - 60, 'the GM\'s phone at ' + w + 'x' + h + ' (' + view + '): one column, the board and the inspector stacked ' + JSON.stringify({ tracks: L.tracks, stacked: L.stacked, main: L.mainW, side: L.sideW }));
    check(!L.missing && !L.past.length && L.scroll <= 0 && L.paneScroll <= 1 && (view === 'map' || L.roomMin >= w - 80), 'and nothing past the edge (the head, the tools, the rooms, the inspector) ' + JSON.stringify({ past: L.past, scroll: L.scroll, pane: L.paneScroll, roomMin: L.roomMin }));
    if (view === 'board') await shot(o.page, 'run-paper-' + w);
    if (view === 'map') await o.page.click('.krv-views [data-v="board"]').then(() => o.page.waitForTimeout(500), () => {});      /* the view is GM state: leave the Board for the next page */
    await o.c.close();
  }
  for (const [w, h] of [[1366, 768], [1536, 864]]) {
    const o = await open({ w, h });
    const L = await o.page.evaluate(LAYOUT);
    check(!L.missing && L.tracks === 2 && !L.stacked && L.sideW >= 280 && L.sideW <= 340, 'the laptop at ' + w + ': still two columns, the inspector beside the board ' + JSON.stringify({ tracks: L.tracks, side: L.sideW }));
    await o.c.close();
  }
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
} finally {
  if (browser) await browser.close().catch(() => {});
  clearTimeout(timeout);
  killDemo();
}
console.log((failed ? 'FAIL' : 'PASS') + ' kit-run: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
