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
//      RK10: Show on iPad and Show the closer look (a title beat, 12 seconds, Take it down), the secrecy proof (the display's GET, a phone's
//      /api/table/screen and the campaign document hold no thing text before a send, and only the line sent after), and the names gate.
//   3. room.key on, the kit desk: the same list in the kit's room card, a click and a key open the card, Esc closes it.
//   5. (RK11) a thing's state: one tap on a state button in the zoom card sets it (the pressed button, the State, the chip, room-state's marks), it is saved and
//      survives a reload, two devices writing the room at once both land (merged key by key), a taken thing dims and stays clickable, a tap on the pressed
//      state takes it away (nothing stored), and the same one tap works on the kit desk.
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
    window.B68GmRoomShow = { buttons: (c) => [{ label: 'Probe show', id: 'probe', run: (c2) => { out.ctx = [c2.thing.slug, c2.room, c2.roomKey, c2.rollKey, c2.index, c2.count, typeof c2.refresh, typeof c2.close, c2.rs && typeof c2.rs.setMark].join('|'); } }] };
    let ran = 0;
    const off = Z.addButtons('state', () => [{ label: 'Probe state', rank: 'quiet', run: () => new Promise((r) => { ran++; setTimeout(r, 300); }) }, { label: '', run: () => 0 }, { label: 'no run' }]);
    document.querySelector('[data-site="thing"][data-thing="brass-umbrella-stand"]').click();
    await new Promise((r) => setTimeout(r, 300));
    const z = document.querySelector('.rk-zoom');
    out.slots = [...z.querySelectorAll('[data-rk-slot]')].map((s) => s.getAttribute('data-rk-slot') + ':' + [...s.querySelectorAll('button')].map((b) => (b.querySelector('.ui-label') || b).textContent + '#' + b.getAttribute('data-rk-btn')).join('/')).join(' ');
    z.querySelector('[data-rk-btn="probe"]').click();
    await new Promise((r) => setTimeout(r, 200));      /* one hook action at a time: the card draws again once it settles */
    const st = document.querySelector('.rk-zoom [data-rk-slot="state"] [data-rk-btn="state"]'); st.click(); st.click();
    out.busy = st.getAttribute('aria-busy');
    await new Promise((r) => setTimeout(r, 500));
    out.ran = ran; out.after = !!document.querySelector('.rk-zoom [data-rk-btn="state"]');
    off(); window.B68GmRoomShow = was;
    out.gone = !document.querySelector('.rk-zoom [data-rk-btn="state"]');
    return out;
  });
  const rk = await page.evaluate(() => String(window.B68GmPage._pure.rollKey(window.B68GmPage._state().locRoll)));
  check(hook.slots === 'show:Probe show#probe state:Full#mark-full/Empty#mark-empty/Probe state#state swap:', 'the hook: the show slot from B68GmRoomShow.buttons(ctx), the state slot from B68GmRoomMark (the thing\'s own states) then addButtons; a button with no label or no run is left out (' + hook.slots + ')');
  check(hook.ctx === ['brass-umbrella-stand', 'Showroom', 'showroom#1', rk, 0, 4, 'function', 'function', 'function'].join('|'), 'the hook\'s ctx: the thing, the room, its roomKey and rollKey, n of m, refresh, close and the page\'s room-state writer (' + hook.ctx + ')');
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

  /* RK10: Show on iPad, and the secrecy proof (RK10.3): the display's GET, a phone's /api/table/screen and the campaign document hold no thing text
     until a line is sent, and only that line after. The sent line is taken out of what they hold before the scan, so anything else trips it. */
  {
    const UMB_NAME = 'A brass umbrella stand', UMB_LINE = 'Too heavy to tip.', UMB_LOOK = 'GM-ONLY-look: one umbrella is dry, though it is raining outside.';
    const THING_TEXT = /GM-ONLY-(look|roll|danger)|brass umbrella|too heavy to tip|velvet rope|stage curtain|grand piano|cocktail shaker|lipstick on a glass|the bar tab|umbrella is dry|cloakroom ticket|rings like a bell/i;
    const reads = async () => { const d = await api('GET', '/gm/display', undefined, IPAD), s = await api('GET', '/table/screen', undefined, P1), c = await api('GET', '/campaign', undefined, P1); return { ok: d.status === 200 && s.status === 200 && c.status === 200, d: d.text, s: s.text, c: c.text, ov: d.json && d.json.ambient && d.json.ambient.doc ? d.json.ambient.doc.overlay || null : null }; };
    const without = (t, lines) => lines.reduce((a, l) => a.split(l).join(''), t);
    const r0 = await reads();
    check(r0.ok && !THING_TEXT.test(r0.d + r0.s + r0.c), 'RK10 secrecy: with things on, the display\'s GET, a phone\'s /api/table/screen and the campaign document hold no thing text before a send');
    await page.click(card('Showroom') + ' [data-site="thing"][data-i="0"]'); z = await until(() => zoom(page), 3000);
    check(!!z && z.slots[0] === 'show:Show on iPad/Show the closer look', 'RK10: the zoom card\'s show slot has Show on iPad and Show the closer look, and nothing for the roll or the danger (' + (z && z.slots.join(' ')) + ')');
    const t0 = Date.now();
    await page.click('.rk-zoom [data-rk-btn="show-thing"]');
    const r1 = await until(async () => { const r = await reads(); return r.ov && r.ov.kind === 'title' ? r : null; }, 8000);
    const p1 = r1 && r1.ov ? r1.ov.payload || {} : {};
    check(!!r1 && p1.text === UMB_NAME && p1.sub === UMB_LINE && r1.ov.ms === 12000 && !/umbrella|brass/i.test(String(r1.ov.id)), 'RK10: Show on iPad puts the thing up as a title beat for 12 seconds: the name and its line, under an opaque id (' + JSON.stringify(r1 && r1.ov) + ')');
    check(!!r1 && !THING_TEXT.test(without(r1.d, [UMB_NAME, UMB_LINE]) + without(r1.s, [UMB_NAME, UMB_LINE]) + without(r1.c, [UMB_NAME, UMB_LINE])), 'RK10 secrecy: after the send the display, the phone\'s screen and the campaign document hold that line and no other thing text (no closer look, roll or danger)');
    await sleep(400); z = await zoom(page);
    check(!!z && z.slots[0] === 'show:Take it down/Show the closer look', 'RK10: while the beat is up its button reads Take it down (' + (z && z.slots[0]) + ')');
    await page.click('.rk-zoom [data-rk-btn="show-thing"]');
    const r2 = await until(async () => { const r = await reads(); return !r.ov ? r : null; }, 8000);
    check(!!r2 && Date.now() - t0 < 12000 && !THING_TEXT.test(r2.d), 'RK10: Take it down takes the beat off the iPad before its 12 seconds');
    await sleep(400);
    /* the iPad: the closer look in its DOM, and gone after 12 seconds */
    const ip = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1024, height: 768 }, serviceWorkers: 'block' });
    const dp = await ip.newPage(); dp.on('pageerror', (e) => errors.push('display pageerror: ' + e.message));
    await dp.addInitScript({ content: 'window.__B68_POLL_MS = 1000;' }); await dp.goto(BASE + '/#display'); await dp.waitForTimeout(5000);
    const t1 = Date.now();
    await page.click('.rk-zoom [data-rk-btn="show-look"]');
    const r3 = await until(async () => { const r = await reads(); return r.ov && r.ov.kind === 'title' ? r : null; }, 8000);
    const p3 = r3 && r3.ov ? r3.ov.payload || {} : {};
    check(!!r3 && p3.text === UMB_NAME && p3.sub === UMB_LOOK && !THING_TEXT.test(without(r3.d, [UMB_NAME, UMB_LOOK]) + without(r3.s, [UMB_NAME, UMB_LOOK]) + without(r3.c, [UMB_NAME, UMB_LOOK])), 'RK10: Show the closer look sends the name and the closer look, and nothing else of the thing reaches the GETs (' + JSON.stringify(p3) + ')');
    const shown = await until(() => dp.evaluate((n) => document.body.textContent.includes(n) ? document.documentElement.outerHTML : '', UMB_NAME), 8000);      /* textContent: the iPad sets its titles in capitals with CSS */
    check(!!shown && shown.includes('one umbrella is dry') && !/GM-ONLY-(roll|danger)|too heavy to tip|velvet rope|cloakroom ticket/i.test(shown), 'RK10: the iPad shows the name and the closer look, and its DOM holds no roll, danger, line or other thing');
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await dp.screenshot({ path: path.join(SHOTS, 'ipad-1024-look.png') }); await shot(page, 'desk-1366-paper-shown'); }
    const gone = await until(async () => { const r = await reads(); return !r.ov ? r : null; }, 16000, 500);
    const secs = (Date.now() - t1) / 1000;
    const domGone = await until(() => dp.evaluate((n) => !document.body.textContent.includes(n), UMB_NAME), 6000);
    check(!!gone && secs >= 11 && secs <= 17 && domGone && !THING_TEXT.test(gone.d + gone.s + gone.c), 'RK10: the beat is gone from the display\'s GET after its 12 seconds (' + secs.toFixed(1) + ' s) and from the iPad, and no thing text is left anywhere');
    await ip.close();
    await page.keyboard.press('Escape'); await sleep(200);

    /* the names gate on the page's own host: a line naming a hidden person asks first; no sends nothing, yes reveals them and sends */
    const gate = await page.evaluate(async () => {
      const asked = [], M = window.B68GmRoomShow.make(() => window.B68GmPage.roomShow()), was = window.confirm;
      const ctx = { room: 'Showroom', rollKey: 'rk10-gate', thing: { name: 'A sealed envelope', line: 'addressed to GM-ONLY-Silent Partner', look: '', slug: 'a-sealed-envelope' }, refresh() {} };
      window.confirm = (m) => { asked.push(m); return false; };
      const no = await M.send(ctx, 'thing');
      window.confirm = (m) => { asked.push(m); return true; };
      const yes = await M.send(ctx, 'thing');
      window.confirm = was;
      return { no, yes, asked };
    });
    const npc = await api('GET', '/npcs/npc-hidden-partner');
    const r4 = await reads();
    check(gate.no === false && gate.yes === true && gate.asked.length === 2 && gate.asked.every((m) => m.startsWith('This names someone hidden: reveal and show?')) && npc.json && npc.json.doc && npc.json.doc.revealed === true &&
      r4.ov && r4.ov.payload && r4.ov.payload.text === 'A sealed envelope', 'RK10: a line naming a hidden person asks "This names someone hidden: reveal and show?"; no shows nothing, yes reveals them and shows it (' + JSON.stringify({ no: gate.no, yes: gate.yes, asked: gate.asked.length }) + ')');
    await page.evaluate(() => window.B68GmPage.clearShow({ layers: false }));
    check((await api('PATCH', '/npcs/npc-hidden-partner', { revealed: false })).status === 200, 'RK10: the demo\'s hidden person is hidden again');
  }

  /* RK11: a thing's state is one tap in the zoom card (B68GmRoomMark), it stays on a reload, and two devices merge key by key */
  const marksOf = (pg) => pg.evaluate((k) => JSON.stringify(window.B68GmPage._roomState().read(k, 'showroom#1').marks), rk);
  const storedMarks = async () => { const r = await api('GET', '/gm/state'), d = r.json && r.json.doc || {}, rs = d.roomstate && d.roomstate.keys && d.roomstate.keys[rk];
    return JSON.stringify(rs && rs.rooms && rs.rooms['showroom#1'] && rs.rooms['showroom#1'].marks || {}); };
  const pressed = (pg, id) => pg.evaluate((i) => { const b = document.querySelector('.rk-zoom [data-rk-btn="' + i + '"]'); return b ? b.getAttribute('aria-pressed') + (b.disabled ? ' disabled' : '') : 'none'; }, id);
  const tap = async (pg, slug, id) => {
    if (!(await zoom(pg)) || (await pg.evaluate(() => (document.querySelector('.rk-zoom .rk-zname') || {}).textContent)) !== (await things(pg, 'Showroom')).find((t) => t.slug === slug).name) {
      await pg.click(card('Showroom') + ' [data-site="thing"][data-thing="' + slug + '"]'); await until(() => zoom(pg), 3000);
    }
    await pg.click('.rk-zoom [data-rk-btn="' + id + '"]'); await sleep(500);
  };

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
  /* RK11 on the kit desk: the same one tap (the kit's buttons, the kit's room card chip), and a second tap takes it away */
  await tap(K.page, 'velvet-rope', 'mark-gone');
  const kc = (await things(K.page, 'Showroom')).find((t) => t.slug === 'velvet-rope');
  check(kc.chip === 'gone' && kc.done && await pressed(K.page, 'mark-gone') === 'true', 'the kit desk: one tap on Gone marks it (the chip on the kit\'s room card, dimmed, the pressed button)');
  await K.page.click('.rk-zoom [data-rk-btn="mark-gone"]'); await sleep(500);
  check(await until(async () => (await storedMarks()) === '{}' && (await things(K.page, 'Showroom')).every((t) => !t.chip), 20000), 'the kit desk: a second tap takes it away, and nothing is stored');
  await K.page.keyboard.press('Escape');
  await K.c.close();

  /* 5. RK11, on a page of its own (the desk, room.key on): a thing's state is one tap in the zoom card (B68GmRoomMark), it stays on a reload, and two devices merge key by key */
  check((await feats({ 'room.key': true, 'kit.desk': false })).status === 200, 'room.key on, the old desk, for the state steps');
  const D = await open({});
  await D.page.waitForSelector(card('Showroom') + ' [data-site="thing"]', { timeout: 15000 });
  check(await marksOf(D.page) === '{}' && await until(async () => (await storedMarks()) === '{}', 20000), 'state: no marks to begin with, here or stored (the earlier clear has been saved)');
  await tap(D.page, 'brass-umbrella-stand', 'mark-empty');
  z = await zoom(D.page); let chips = await things(D.page, 'Showroom');
  check(!!z && /State\s*empty/.test(z.state) && await pressed(D.page, 'mark-empty') === 'true' && await pressed(D.page, 'mark-full') === 'false' && await marksOf(D.page) === '{"brass-umbrella-stand":"empty"}' &&
    chips.find((t) => t.slug === 'brass-umbrella-stand').chip === 'empty', 'state: one tap on Empty sets it (the pressed button, the zoom card\'s State, the room card\'s chip, room-state\'s marks)');
  check(await until(async () => (await storedMarks()) === '{"brass-umbrella-stand":"empty"}', 20000), 'state: it is saved (the GM state\'s roomstate holds one small key)');
  await shot(D.page, 'desk-1366-paper-state');
  /* a reload: a new page reads it back, pressed, and one tap takes it away; a second device's write beside it */
  const R = await open({});
  await R.page.waitForSelector(card('Showroom') + ' [data-site="thing"]', { timeout: 15000 });
  chips = await things(R.page, 'Showroom');
  await R.page.click(card('Showroom') + ' [data-site="thing"][data-thing="brass-umbrella-stand"]'); const zr = await until(() => zoom(R.page), 3000);
  check(chips.find((t) => t.slug === 'brass-umbrella-stand').chip === 'empty' && !!zr && /State\s*empty/.test(zr.state) && await pressed(R.page, 'mark-empty') === 'true', 'state: after a reload (a new D.page) the chip, the State and the pressed button are all still Empty');
  await tap(R.page, 'velvet-rope', 'mark-taken');                      /* device 2 marks the rope taken ... */
  await tap(D.page, 'brass-umbrella-stand', 'mark-full');                /* ... while device 1 switches the stand to Full */
  check(await until(async () => (await storedMarks()) === '{"brass-umbrella-stand":"full","velvet-rope":"taken"}', 20000), 'state: two devices, one room, at once: both marks are stored (merged key by key; the stand switched with one tap)');
  await R.c.close();
  /* a third page (the GM page does not follow another device live, a reload does): it reads both marks; taken dims and stays clickable; a tap on the pressed state takes it away */
  const R2 = await open({});
  await R2.page.waitForSelector(card('Showroom') + ' [data-site="thing"]', { timeout: 15000 });
  const both = '{"brass-umbrella-stand":"full","velvet-rope":"taken"}';
  check(await marksOf(R2.page) === both, 'state: a fresh page reads both devices\' marks');
  chips = await things(R2.page, 'Showroom'); const rope = chips.find((t) => t.slug === 'velvet-rope');
  await R2.page.click(card('Showroom') + ' [data-site="thing"][data-thing="velvet-rope"]'); const zd = await until(() => zoom(R2.page), 3000);
  check(rope.chip === 'taken' && rope.done && !!zd && zd.name === NAMES[1] && await pressed(R2.page, 'mark-taken') === 'true' && await pressed(R2.page, 'mark-found') === 'false', 'state: a taken thing dims, stays clickable, and its zoom card has the default states (found, taken, gone), Taken pressed');
  await R2.page.click('.rk-zoom [data-rk-btn="mark-taken"]'); await sleep(500);
  await tap(R2.page, 'brass-umbrella-stand', 'mark-full');
  check(await until(async () => (await storedMarks()) === '{}', 20000) && (await things(R2.page, 'Showroom')).every((t) => !t.chip && !t.done), 'state: a tap on the pressed state takes the mark away; with every mark gone nothing is stored for the room');
  await R2.page.keyboard.press('Escape'); await D.page.keyboard.press('Escape'); await sleep(200);
  await R2.c.close();
  /* twins: two rooms of one name are told apart by instance; the card hands the slot the room's own key, and a mark writes to it */
  const twin = await D.page.evaluate(async () => {
    const Z = window.B68GmRoomZoom, RT = window.B68GmRoomThings, out = { writes: [], keys: [] };
    const store = {};
    const fakeRs = { read: (rk, rm) => ({ marks: store[rm] || {} }), setMark: (rk, rm, slug, st) => { out.writes.push([rk, rm, slug, st]); store[rm] = Object.assign({}, store[rm]); if (st === null) delete store[rm][slug]; else store[rm][slug] = st; return true; } };
    const things = [RT.clean({ name: 'A tin whistle', states: ['on', 'off'] })];
    const z = Z.create({ things: () => things, where: (room, n) => ({ rollKey: 'a:twin-site', roomKey: 'hall#' + n }), rs: () => fakeRs, doc: () => ({}), redraw: () => {}, toast: () => {} });
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;left:40px;top:300px;z-index:1;background:#fff;padding:8px';
    host.innerHTML = '<div class="rv-rm" data-room="Hall">' + z.html('Hall', { n: 1 }) + '</div><div class="rv-rm" data-room="Hall">' + z.html('Hall', { n: 2 }) + '</div>';
    document.body.appendChild(host);
    const bs = [...host.querySelectorAll('[data-site="thing"]')];
    out.rn = bs.map((b) => b.getAttribute('data-rn'));
    const off = z.addButtons('swap', (c) => { out.keys.push(c.roomKey + '|' + c.rollKey); return []; });
    z.act(bs[1]); await new Promise((r) => setTimeout(r, 200));
    document.querySelector('.rk-zoom [data-rk-btn="mark-on"]').click(); await new Promise((r) => setTimeout(r, 300));
    out.afterSecond = [...host.querySelectorAll('.rk-tstate')].length;
    out.chipOn2 = (() => { const l = host.querySelectorAll('.rv-rm'); return [l[0].querySelector('.rk-tstate'), l[1].querySelector('.rk-tstate')].map((e) => e ? e.textContent : ''); })();
    z.close(false);
    z.act(bs[0]); await new Promise((r) => setTimeout(r, 200));
    out.pressedFirst = document.querySelector('.rk-zoom [data-rk-btn="mark-on"]').getAttribute('aria-pressed');
    document.querySelector('.rk-zoom [data-rk-btn="mark-off"]').click(); await new Promise((r) => setTimeout(r, 300));
    z.close(false); off(); z.destroy(); host.remove();
    return out;
  });
  check(JSON.stringify(twin.rn) === '[null,"2"]' && twin.keys.includes('hall#2|a:twin-site') && twin.keys.includes('hall#1|a:twin-site') && JSON.stringify(twin.writes) === '[["a:twin-site","hall#2","tin-whistle","on"],["a:twin-site","hall#1","tin-whistle","off"]]' && twin.pressedFirst === 'false',
    'twins: the second room of a name hands the slot its own roomKey (hall#2), a mark on it writes there only, and the first room\'s card is not marked by it (' + JSON.stringify(twin) + ')');
  await D.c.close();
  /* the card clears the band: in a short window (1100 x 540, where the card cannot fit below the band at its natural height) the zoom card's top is held below
     the live bar (Clear, Blank, Auto, Music) and it scrolls inside itself; at 1100 x 768 it is the same card and the picture is of that */
  const T = await open({ w: 1100, h: 540 });
  await T.page.waitForSelector(card('Showroom') + ' [data-site="thing"]', { timeout: 15000 });
  await T.page.evaluate((sel) => { const e = document.querySelector(sel); if (e) e.scrollIntoView({ block: 'center' }); }, card('Showroom') + ' .rk-things');
  await sleep(300);
  await T.page.click(card('Showroom') + ' [data-site="thing"][data-i="0"]'); await until(() => zoom(T.page), 3000); await sleep(300);
  const geo = await T.page.evaluate(() => {
    const bar = document.getElementById('gm-band').getBoundingClientRect(), zb = document.querySelector('.rk-zoom'), z = zb.getBoundingClientRect();
    return { bandBottom: Math.round(bar.bottom), zoomTop: Math.round(z.top), zoomBottom: Math.round(z.bottom), vh: innerHeight, natural: zb.scrollHeight, scrolls: zb.scrollHeight > zb.clientHeight + 1 };
  });
  check(geo.natural + geo.bandBottom + 12 > geo.vh, 'the short window is short enough that the card cannot fit below the band at its natural height (' + JSON.stringify(geo) + ')');
  check(geo.zoomTop >= geo.bandBottom && geo.zoomBottom <= geo.vh, 'the zoom card in a short window stays below the band (the live bar is not covered) and inside the window (' + JSON.stringify(geo) + ')');
  await shot(T.page, 'desk-1100x540-paper-zoom-clamped');
  await T.page.keyboard.press('Escape'); await sleep(200);
  await T.c.close();
  const U = await open({ w: 1100, h: 768 });
  await U.page.waitForSelector(card('Showroom') + ' [data-site="thing"]', { timeout: 15000 });
  await U.page.click(card('Showroom') + ' [data-site="thing"][data-i="0"]'); await until(() => zoom(U.page), 3000); await sleep(300);
  const geo2 = await U.page.evaluate(() => ({ bandBottom: Math.round(document.getElementById('gm-band').getBoundingClientRect().bottom), zoomTop: Math.round(document.querySelector('.rk-zoom').getBoundingClientRect().top) }));
  check(geo2.zoomTop >= geo2.bandBottom, 'at 1100 x 768 the zoom card is below the band too (' + JSON.stringify(geo2) + ')');
  await shot(U.page, 'desk-1100-paper-zoom-clamped');
  await U.page.keyboard.press('Escape'); await sleep(200);
  await U.c.close();

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
