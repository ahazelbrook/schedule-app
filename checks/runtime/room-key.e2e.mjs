// room-key (RK09 of the room key build, room.key): a room card's things and the zoom card, on the demo night (scripts/demo-night.mjs: invented data,
// the Pelican Rooms). Before the first page opens, the test puts the Showroom's Things block from checks/runtime/fixtures/gm/pelican-room-things.md
// (GM-ONLY- markers on every closer look, roll and danger) and an old one-line Find in the Cocktail lounge into the demo night's prep part.
//   1. room.key off: no room-key file is fetched, no card has things, and the Showroom card's markup is noted.
//   2. room.key on, the old desk: the Showroom card shows its four things as named buttons in the note's order, keys 1 to 4, before its note (which
//      no longer shows the block); the Cocktail lounge's old Find gives three names. Each thing opens its zoom card in one click (name, line, closer
//      look, roll, danger, state); Esc closes it and the focus goes back to the thing. Keys: 1 to 9 with the focus in the card, the arrows (in the
//      card and in the zoom card), Enter. A tap outside closes it; the same thing again closes it; a Run view redraw keeps it open. The button row's
//      hook: a slot module's buttons(ctx) and zoom.addButtons(slot, fn), with the ctx's keys; a mark written through room-state shows as a chip.
//      Secrecy: with a card open, the display's GET, a phone's GETs and the iPad's and a phone's DOM hold no thing text.
//   3. room.key on, the kit desk: the same list in the kit's room card, a click and a key open the card, Esc closes it.
//   4. room.key off again on the open page: the open card goes, and the Showroom card's markup is the same as in 1.
// With ROOM_KEY_SHOTS=<dir>: pictures of the desk and the kit desk at 1366x768 and 1100 wide, Paper and Night, a card open.
// No model, no network beyond loopback, nothing deployed. Its default port is 9502, with wrangler's inspector on PORT + 20000.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9502] [ROOM_KEY_SHOTS=<dir>] node checks/runtime/room-key.e2e.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!process.env.PW_MODULE) { console.log('SKIP room-key: PW_MODULE is not set (the demo night needs Playwright)'); process.exit(0); }
const require = createRequire(import.meta.url);
const pw = require(process.env.PW_MODULE);
const PORT = Number(process.env.PORT || 9502), BASE = 'http://127.0.0.1:' + PORT, SHOTS = process.env.ROOM_KEY_SHOTS || '';
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test', P1 = 'player1@example.test';
const WIN = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, name) => { if (ok) console.log('PASS ' + name); else { failed++; console.log('FAIL ' + name); } };
async function until(fn, ms, step = 200) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, text: t, json: j }; });
const feats = (f) => api('PATCH', '/gm/state', { features: f });

/* the fixture's Showroom Things block (outside its fence), and what it parses to */
const FIX = fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'pelican-room-things.md'), 'utf8');
const gala = FIX.slice(FIX.indexOf('## Rooms · The gala'));
const showAt = gala.indexOf('### Showroom'), thingsAt = gala.indexOf('- **Things:**', showAt), costumeAt = gala.indexOf('- **Costume:**', thingsAt);
const BLOCK = gala.slice(thingsAt, costumeAt).trimEnd();
const NAMES = ['A brass umbrella stand', 'A velvet rope', 'The stage curtain', 'A grand piano'];
const FIND = '- **Find:** a cocktail shaker · a lipstick on a glass · the bar tab';
const SECRET = /GM-ONLY-(look|roll|danger)|brass umbrella|velvet rope|stage curtain|grand piano|cocktail shaker/i;

const env = { ...process.env };
delete env.ANTHROPIC_API_KEY; delete env.B68_ANTHROPIC_KEY;
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const demo = spawn(process.execPath, [path.join(ROOT, 'scripts', 'demo-night.mjs'), '--port', String(PORT)], { cwd: ROOT, env, detached: !WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let demoLog = '';
demo.stdout.on('data', (d) => { demoLog += d; }); demo.stderr.on('data', (d) => { demoLog += d; });
function killDemo() { if (WIN) spawnSync('taskkill', ['/pid', String(demo.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-demo.pid, 'SIGKILL'); } catch (_) {} } }
process.on('exit', killDemo);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + demoLog.slice(-2000)); process.exit(1); }, 1200000);

let browser = null;
const errors = [];
try {
  if (!(await until(async () => /Ctrl\+C stops it/.test(demoLog), 180000, 500))) throw new Error('the demo night did not come up:\n' + demoLog.slice(-1500));

  /* the fixture's things into the demo night's prep part (the Showroom and the Cocktail lounge), before any page opens */
  const prep = await api('GET', '/gm/pack?part=prep');
  const body = prep.json && prep.json.body, notes = body && Array.isArray(body.notes) ? body.notes : [];
  let put = 0;
  for (const n of notes) for (const b of (n.blocks || [])) {
    if (typeof b.src !== 'string' || !b.src.includes('### Showroom')) continue;
    b.src = b.src.replace('### Showroom\n', '### Showroom\n\n' + BLOCK + '\n').replace('### Cocktail lounge\n', '### Cocktail lounge\n\n' + FIND + '\n'); put++;
  }
  check(BLOCK.split('\n').length > 10 && put === 1, 'the fixture\'s Showroom Things block (' + BLOCK.split('\n').length + ' lines) goes into the demo night\'s prep note');
  check((await api('POST', '/gm/pack', { part: 'prep', src: prep.json.src || {}, body })).status === 200, 'the prep part is stored again');

  browser = await pw.chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const blur = (page) => page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); });
  async function open({ w = 1366, h = 768, theme = 'paper', kit = false, key = true } = {}) {
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
    if (key) await page.waitForFunction(() => window.B68GmRoomZoom && !window.B68GmRoomZoom.stub && window.B68GmRoomThings && window.B68GmPage._roomZoom(), null, { timeout: 30000 });
    await blur(page); await page.waitForTimeout(600);
    await page.evaluate(() => window.B68GmPage.goPlace('score')); await page.waitForTimeout(700);
    await page.keyboard.press('g');
    await page.waitForSelector(kit ? '.krv-head' : '.rv-head', { timeout: 20000 }); await page.waitForTimeout(700);
    return { c, page, fetched };
  }
  const card = (room) => '#gm-runv .rv-rm[data-room="' + room + '"]';
  const things = (page, room) => page.evaluate((sel) => [...document.querySelectorAll(sel + ' [data-site="thing"]')].map((b) => ({ name: (b.querySelector('.ui-label') || b).textContent,
    key: (b.querySelector('.ui-key') || { getAttribute: () => '' }).getAttribute('data-ui-key'), slug: b.getAttribute('data-thing'), done: b.classList.contains('is-done'),
    chip: b.parentNode.querySelector('.rk-tstate') ? b.parentNode.querySelector('.rk-tstate').textContent : '' })), card(room));
  const zoom = (page) => page.evaluate(() => {
    const z = document.querySelector('.rk-zscope .rk-zoom'); if (!z || z.hidden || !z.isConnected) return null;
    const t = (s) => { const e = z.querySelector(s); return e ? e.textContent : ''; };
    return { name: t('.rk-zname'), eye: t('.rk-zeye'), line: t('.rk-zline'), look: t('.rk-zlook'), roll: [...z.querySelectorAll('.rk-zroll dd')].map((d) => d.textContent), danger: t('.rk-zdanger'),
      state: t('.rk-zstate'), slots: [...z.querySelectorAll('[data-rk-slot]')].map((s) => s.getAttribute('data-rk-slot') + ':' + [...s.querySelectorAll('button')].map((b) => (b.querySelector('.ui-label') || b).textContent).join('/')),
      focusIn: z.contains(document.activeElement), role: z.getAttribute('role'), placed: z.classList.contains('is-placed'), scope: !!z.closest('[data-ui-scope]'), esc: (window.B68GmEsc.list().filter((e) => e.open)[0] || {}).id };
  });
  const focused = (page) => page.evaluate(() => { const a = document.activeElement; return a && a.getAttribute ? a.getAttribute('data-thing') || '' : ''; });
  const shot = async (page, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await page.mouse.move(1, 1); await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTS, name + '.png'), animations: 'disabled' }); };

  /* ---- 1. off ---- */
  check((await feats({ 'room.key': false, 'kit.desk': false })).status === 200, 'room.key and kit.desk are off');
  const A = await open({ key: false });
  await A.page.waitForSelector(card('Showroom'), { timeout: 15000 }); await A.page.waitForTimeout(1500);
  check(!A.fetched.some((u) => /\/gm\/room-(zoom|things|state)\.js|\/gm\/room-key\.css/.test(u)), 'off: the GM page fetches no room-key file');
  check(await A.page.evaluate(() => !document.querySelector('.rk-things, [data-site="thing"], .rk-zscope') && window.B68GmPage._roomZoom() === null), 'off: no card has things, and there is no zoom card');
  const markupOff = await A.page.evaluate((sel) => document.querySelector(sel).outerHTML, card('Showroom'));
  check(/GM-ONLY-look/.test(markupOff), 'off: the note shows its Things block as it always did (today\'s card)');
  await A.c.close();

  /* ---- 2. on, the old desk ---- */
  check((await feats({ 'room.key': true })).status === 200, 'room.key is on');
  const B = await open({});
  const page = B.page;
  await page.waitForSelector(card('Showroom') + ' .rk-things [data-site="thing"]', { timeout: 15000 });
  const list = await things(page, 'Showroom');
  check(JSON.stringify(list.map((t) => t.name)) === JSON.stringify(NAMES) && list.map((t) => t.key).join('') === '1234', 'the Showroom card: its four things as named buttons in the note\'s order, keys 1 to 4: ' + list.map((t) => t.name).join(' | '));
  const order = await page.evaluate((sel) => { const c = document.querySelector(sel), t = c.querySelector('.rk-things'), n = c.querySelector('.rv-rmnote'); return { before: !!(t && n && (t.compareDocumentPosition(n) & 4)), note: n ? n.textContent : '' }; }, card('Showroom'));
  check(order.before && !/GM-ONLY-|brass umbrella/i.test(order.note) && /Chandeliers|Costume|Evening/i.test(order.note + markupOff), 'the things come before the note, and the note no longer shows the block (not twice)');
  const lounge = await things(page, 'Cocktail lounge');
  check(lounge.map((t) => t.name).join('|') === 'a cocktail shaker|a lipstick on a glass|the bar tab', 'the Cocktail lounge\'s old one-line Find: three names (' + lounge.map((t) => t.name).join(', ') + ')');
  check(B.fetched.some((u) => /\/gm\/room-zoom\.js/.test(u)) && B.fetched.some((u) => /\/gm\/room-key\.css/.test(u)), 'on: the room-key bundle (room-zoom.js and room-key.css) is fetched');

  /* each thing in one click, Esc closes, the focus goes back */
  let clicks = 0;
  for (let i = 0; i < NAMES.length; i++) {
    await page.click(card('Showroom') + ' [data-site="thing"][data-i="' + i + '"]');
    const z = await until(() => zoom(page), 4000);
    if (z && z.name === NAMES[i] && z.eye.startsWith('Showroom · ' + (i + 1) + ' of 4') && z.focusIn && z.role === 'dialog' && z.placed && z.scope && z.esc === 'room.zoom') clicks++;
    else console.log('  thing ' + (i + 1) + ': ' + JSON.stringify(z));
    if (i === 0) {
      check(!!z && /GM-ONLY-look: one umbrella is dry/.test(z.look) && z.roll.length === 2 && /^GM-ONLY-roll: 4\/5: a cloakroom ticket/.test(z.roll[0]) && /^6: and the number/.test(z.roll[1]) &&
        /GM-ONLY-danger: the stand rings/.test(z.danger) && /full · empty/.test(z.state) && z.line === 'too heavy to tip.', 'the zoom card: the line, 🔍 the closer look, 🎲 the 4/5 and the 6 on their own lines, ! the danger, the states');
      await shot(page, 'desk-1366-paper-zoom');
    }
    await page.keyboard.press('Escape');
    const gone = await until(async () => !(await zoom(page)), 3000);
    if (!gone || (await focused(page)) !== list[i].slug) { clicks -= 10; console.log('  Esc on ' + (i + 1) + ': gone ' + gone + ', focus ' + (await focused(page))); }
  }
  check(clicks === 4, 'every thing opens its zoom card in one click (name, "n of 4", focus in it, a dialog, placed, in a kit scope, B68GmEsc\'s room.zoom), and Esc closes it with the focus back on the thing');

  /* keys */
  await page.focus(card('Showroom') + ' [data-site="thing"][data-i="0"]');
  await page.keyboard.press('3'); let z = await until(() => zoom(page), 3000);
  const k1 = z && z.name === NAMES[2];
  await page.keyboard.press('ArrowRight'); z = await zoom(page); const k2 = z && z.name === NAMES[3];
  await page.keyboard.press('ArrowRight'); z = await zoom(page); const k3 = z && z.name === NAMES[0];
  await page.keyboard.press('ArrowLeft'); z = await zoom(page); const k4 = z && z.name === NAMES[3];
  await page.keyboard.press('2'); z = await zoom(page); const k5 = z && z.name === NAMES[1];
  await page.keyboard.press('Escape'); await sleep(200);
  const k6 = !(await zoom(page)) && (await focused(page)) === list[1].slug;
  check(k1 && k2 && k3 && k4 && k5 && k6, 'keys: 3 in the card opens the third; → and ← step round the room in the zoom card; 2 there jumps; Esc closes, the focus back on the thing (' + [k1, k2, k3, k4, k5, k6].join(' ') + ')');
  await page.keyboard.press('ArrowRight'); const f1 = await focused(page);
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft'); const f2 = await focused(page);
  await page.keyboard.press('Enter'); z = await until(() => zoom(page), 3000);
  check(f1 === list[2].slug && f2 === list[0].slug && !!z && z.name === NAMES[0], 'keys: with the focus on a thing, the arrows move it between the things (no card opens), and Enter opens the one focused');
  await page.keyboard.press('Escape'); await sleep(200);
  const sit = () => page.evaluate(() => JSON.stringify((window.B68GmPage._state().doc.cards || {}).situation || null));
  const sit0 = await sit();
  await page.focus(card('Cocktail lounge') + ' [data-site="thing"][data-i="2"]');
  await page.keyboard.press('4'); await sleep(600);
  check(!(await zoom(page)) && (await sit()) === sit0, 'a digit with no thing (4 of 3) in a focused card does nothing: no card, and no "They rolled" situation behind it');
  await blur(page);

  /* closing: a tap outside, the same thing again; a redraw keeps it open */
  await page.click(card('Showroom') + ' [data-site="thing"][data-i="1"]'); await until(() => zoom(page), 3000);
  await page.click('#gm-runv .rv-head', { position: { x: 5, y: 5 } }); await sleep(300);
  const outside = !(await zoom(page));
  await page.click(card('Showroom') + ' [data-site="thing"][data-i="1"]'); await until(() => zoom(page), 3000);
  await page.click(card('Showroom') + ' [data-site="thing"][data-i="1"]'); await sleep(300);
  const again = !(await zoom(page));
  await page.click(card('Showroom') + ' [data-site="thing"][data-i="0"]'); await until(() => zoom(page), 3000);
  await page.evaluate(() => window.B68GmRunView.redrawAll()); await sleep(500);
  z = await zoom(page);
  check(outside && again && !!z && z.name === NAMES[0] && await page.evaluate(() => document.querySelectorAll('.rk-zscope').length === 1), 'a tap outside closes it; the same thing again closes it; a Run view redraw keeps it open on the same thing (' + [outside, again, !!z].join(' ') + ')');

  /* secrecy: a card open, and nothing of a thing anywhere the players or the iPad read */
  const disp = await api('GET', '/gm/display', undefined, IPAD), scr = await api('GET', '/table/screen', undefined, P1), pc = await api('GET', '/characters/pc-nell', undefined, P1);
  check(disp.status === 200 && scr.status === 200 && pc.status === 200 && !SECRET.test(disp.text + scr.text + pc.text), 'secrecy: the display\'s GET, a phone\'s /api/table/screen and its character hold no thing text while a card is open');
  {
    const ip = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1024, height: 768 }, serviceWorkers: 'block' });
    const dp = await ip.newPage(); await dp.goto(BASE + '/#display'); await dp.waitForTimeout(6000);
    const ph = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': P1 }, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const pp = await ph.newPage(); await pp.goto(BASE + '/#c/pc-nell'); await pp.waitForTimeout(6000);
    const dom = (await dp.evaluate(() => document.documentElement.outerHTML)) + (await pp.evaluate(() => document.documentElement.outerHTML));
    check(dom.length > 2000 && !SECRET.test(dom) && !/room-zoom|rk-zoom|rk-thing/.test(dom), 'secrecy: the iPad\'s and a phone\'s DOM hold no thing and no room-key markup');
    await ip.close(); await ph.close();
  }
  await page.keyboard.press('Escape'); await sleep(200);

  /* the button row's hook */
  const hook = await page.evaluate(async () => {
    const was = window.B68GmRoomShow, Z = window.B68GmPage._roomZoom(), out = {};
    window.B68GmRoomShow = { buttons: (c) => [{ label: 'Probe show', id: 'probe', run: (c2) => { out.ctx = [c2.thing.slug, c2.room, c2.roomKey, c2.rollKey, c2.index, c2.count, typeof c2.refresh, typeof c2.close].join('|'); } }] };
    let ran = 0;
    const off = Z.addButtons('state', () => [{ label: 'Probe state', rank: 'quiet', run: () => new Promise((r) => { ran++; setTimeout(r, 300); }) }, { label: '', run: () => 0 }, { label: 'no run' }]);
    document.querySelector('[data-site="thing"][data-thing="brass-umbrella-stand"]').click();
    await new Promise((r) => setTimeout(r, 300));
    const z = document.querySelector('.rk-zoom');
    out.slots = [...z.querySelectorAll('[data-rk-slot]')].map((s) => s.getAttribute('data-rk-slot') + ':' + [...s.querySelectorAll('button')].map((b) => (b.querySelector('.ui-label') || b).textContent + '#' + b.getAttribute('data-rk-btn')).join('/')).join(' ');
    z.querySelector('[data-rk-btn="probe"]').click();
    await new Promise((r) => setTimeout(r, 200));      /* one hook action at a time: the card draws again once it settles */
    const st = document.querySelector('.rk-zoom [data-rk-slot="state"] button'); st.click(); st.click();
    out.busy = st.getAttribute('aria-busy');
    await new Promise((r) => setTimeout(r, 500));
    out.ran = ran; out.after = !!document.querySelector('.rk-zoom [data-rk-btn="state"]');
    off(); window.B68GmRoomShow = was;
    out.gone = !document.querySelector('.rk-zoom [data-rk-btn="state"]');
    return out;
  });
  const rk = await page.evaluate(() => String(window.B68GmPage._pure.rollKey(window.B68GmPage._state().locRoll)));
  check(hook.slots === 'show:Probe show#probe state:Probe state#state swap:', 'the hook: the show slot from B68GmRoomShow.buttons(ctx), the state slot from addButtons; a button with no label or no run is left out (' + hook.slots + ')');
  check(hook.ctx === ['brass-umbrella-stand', 'Showroom', 'showroom#1', rk, 0, 4, 'function', 'function'].join('|'), 'the hook\'s ctx: the thing, the room, its roomKey and rollKey, n of m, refresh and close (' + hook.ctx + ')');
  check(hook.busy === 'true' && hook.ran === 1 && hook.after && hook.gone, 'a hook button runs once while busy, the card draws again after, and off() takes it away (' + JSON.stringify({ busy: hook.busy, ran: hook.ran, after: hook.after, gone: hook.gone }) + ')');
  await page.keyboard.press('Escape'); await sleep(200);

  /* a mark through room-state shows on the card and in the zoom card */
  const marked = await page.evaluate((rk) => window.B68GmPage._roomState().setMark(rk, 'showroom#1', 'velvet-rope', 'taken'), rk);
  await page.evaluate(() => window.B68GmRunView.redrawAll()); await sleep(400);
  const l2 = await things(page, 'Showroom'), vr = l2.find((t) => t.slug === 'velvet-rope') || {};
  await page.click(card('Showroom') + ' [data-site="thing"][data-thing="velvet-rope"]'); z = await until(() => zoom(page), 3000);
  check(marked && vr.chip === 'taken' && vr.done && !!z && /State\s*taken/.test(z.state), 'a mark (taken) written through room-state: a chip on the card, the thing dims and still opens, and the zoom card says so');
  await shot(page, 'desk-1366-paper-marked');
  await page.keyboard.press('Escape');
  await page.evaluate((rk) => window.B68GmPage._roomState().setMark(rk, 'showroom#1', 'velvet-rope', null), rk);

  /* 4. off again on the open page: the card goes, and the markup is today's */
  await page.click(card('Showroom') + ' [data-site="thing"][data-i="2"]'); await until(() => zoom(page), 3000);
  check((await feats({ 'room.key': false })).status === 200, 'room.key off again, with a card open');
  const offAgain = await until(() => page.evaluate(() => !document.querySelector('[data-site="thing"]')), 15000);
  await page.evaluate(() => window.B68GmRunView.redrawAll()); await sleep(500);
  const markupOff2 = await page.evaluate((sel) => document.querySelector(sel).outerHTML, card('Showroom'));
  const og = { offAgain: !!offAgain, zoom: JSON.stringify(await zoom(page)), scope: await page.evaluate(() => !!document.querySelector('.rk-zscope')), rz: await page.evaluate(() => window.B68GmPage._roomZoom() === null) };
  check(og.offAgain && og.zoom === 'null' && !og.scope && og.rz, 'off again: the things and the open card go, the scope host too (' + JSON.stringify(og) + ')');
  check(markupOff2 === markupOff, 'off again: the Showroom card\'s markup is the same as before room.key was ever on' + (markupOff2 === markupOff ? '' : '\n  off: ' + markupOff.slice(0, 300) + '\n  now: ' + markupOff2.slice(0, 300)));
  await B.c.close();

  /* ---- 3. the kit desk ---- */
  check((await feats({ 'room.key': true, 'kit.desk': true })).status === 200, 'room.key and kit.desk are on');
  const K = await open({ kit: true });
  await K.page.waitForSelector(card('Showroom') + ' .krv-things [data-site="thing"]', { timeout: 15000 });
  const kl = await things(K.page, 'Showroom');
  await K.page.click(card('Showroom') + ' [data-site="thing"][data-i="1"]'); z = await until(() => zoom(K.page), 3000);
  const kz = !!z && z.name === NAMES[1] && z.focusIn;
  await shot(K.page, 'kitdesk-1366-paper-zoom');
  await K.page.keyboard.press('Escape'); await sleep(200);
  const kesc = !(await zoom(K.page)) && (await focused(K.page)) === 'velvet-rope';
  await K.page.keyboard.press('4'); z = await until(() => zoom(K.page), 3000);
  check(kl.map((t) => t.name).join('|') === NAMES.join('|') && kz && kesc && !!z && z.name === NAMES[3], 'the kit desk: the four things in the kit\'s room card, a click opens one, Esc closes it, 4 opens the fourth');
  await K.page.keyboard.press('Escape');
  await K.c.close();

  /* pictures: the desk and the kit desk, 1366x768 and 1100 wide, Paper and Night */
  if (SHOTS) {
    for (const [kit, w, theme] of [[false, 1366, 'night'], [false, 1100, 'paper'], [false, 1100, 'night'], [true, 1366, 'night'], [true, 1100, 'paper'], [true, 1100, 'night'], [false, 1536, 'paper'], [true, 1536, 'paper']]) {
      await feats({ 'room.key': true, 'kit.desk': kit });
      const o = await open({ kit, w, h: w === 1536 ? 864 : 768, theme });
      await o.page.waitForSelector(card('Showroom') + ' [data-site="thing"]', { timeout: 15000 });
      await o.page.evaluate((sel) => { const e = document.querySelector(sel); if (e) e.scrollIntoView({ block: 'center' }); }, card('Showroom') + ' .rk-things');
      await shot(o.page, (kit ? 'kitdesk-' : 'desk-') + w + '-' + theme + '-list');
      await o.page.click(card('Showroom') + ' [data-site="thing"][data-i="0"]'); await until(() => zoom(o.page), 3000);
      await shot(o.page, (kit ? 'kitdesk-' : 'desk-') + w + '-' + theme + '-zoom');
      await o.c.close();
    }
    console.log('pictures in ' + SHOTS);
  }
  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
} finally {
  if (browser) await browser.close().catch(() => {});
  await feats({ 'room.key': false, 'kit.desk': false }).catch(() => {});
  clearTimeout(timeout); killDemo();
}
console.log(failed ? 'FAIL room-key: ' + failed + ' failed' : 'PASS room-key: all passed');
process.exit(failed ? 1 : 0);
