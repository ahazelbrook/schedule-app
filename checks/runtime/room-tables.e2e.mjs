// room-tables (RK14 of the room key build, room.tables): a rolled site's room cards in the Run pane, on the demo night (scripts/demo-night.mjs: invented
// data, the Pelican Rooms). The rooms part is made here from checks/runtime/fixtures/gm/rooms-pack.json: its two invented tables (GM-ONLY- markers on every
// closer look, roll and danger), copied under the names of the rooms on the page (never a vault table). RK15's steps follow the last of RK14's (step 7).
//   1. room.tables off: no room-tables file is fetched, and the night's v2 room card is today's.
//   2. room.tables on (with room.key, which Show on iPad needs): a roll goes straight to the site screen (RK14.3); with no rooms part every card says
//      "No table for <room>"; with the part, every tabled room has its read-aloud ("There's ..." naming its things), 4 things to click, a people slot list,
//      exits from the roll, and the one room left out of the part says "No table for <room>". A click and a key open the zoom card, Esc closes it, and
//      Show on iPad sends one line. A reload gives the same cards.
//      Secrecy, with no play block (a rolled site): the display's GET, a phone's /api/table/screen and character, and the campaign document (the
//      mission) hold no rolled-room text, before a send and after it (bar the one line sent).
//   3. The night's authored v2 site (play.v === 2, missionSource live): its Run view card carries the same parts; every room of the authored roll has a
//      description, 4 things and a people slot; the same secrecy probe.
//   4. The kit desk: the same cards, a click opens the zoom card.
//   4b. RK16, the Blade tap (POST /api/gm/assist/room answered by a page.route fake registered before the page loads: no model, no key; GM-ONLY- markers in
//      every field of its answer): "Fit to tonight (~3¢)" on every tabled room and none on the room with no table; a tap is busy, then the answer lands on the card
//      marked ✦ Blade (its say, 6 things, the people line) and in the GM state; the request carries no closer look, roll or danger; secrecy after the tap and
//      after Show on iPad of a Blade thing (one line), the iPad's DOM included; a ✦ on Blade's things and its people in Who's here; a reload keeps it; a malformed answer and the server's refusal are toasts and store nothing; Clear;
//      the kit desk draws the same.
//   5. room.tables off again: the Run pane says what it said before.
//   6. room.tables turned off on a live page (the review of RK14): the rolled instance goes, and a plain RK09 thing opens only RK09's card.
//   7. RK15, Swap, Roll another and Reroll the room, on the rolled site: every tabled room's card has the two buttons; Swap is in the zoom card's swap slot, replaces
//      the thing in its place, is stored as one override under the roll's key and the room's roomKey, and the card stays open on the new thing; a second page on the same
//      state and a reload both show it; Roll another adds a fifth thing; Reroll the room asks first when a mark is set (Cancel leaves it, the second tap clears it) and
//      does it at once when nothing is marked, and the people never move; the kit desk; nothing of any of it reaches the GETs or a phone's DOM; room.tables off on a
//      live page takes the buttons away.
// With ROOM_TABLES_SHOTS=<dir>: the desk and the kit desk at 1366x768 and 1536x864, Paper and Night, a card open; the iPad at 1024x768; a phone at 390x844.
// No model, no network beyond loopback, nothing deployed. Its default port is 9503, with wrangler's inspector on PORT + 20000.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9503] [ROOM_TABLES_SHOTS=<dir>] node checks/runtime/room-tables.e2e.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!process.env.PW_MODULE) { console.log('SKIP room-tables: PW_MODULE is not set (the demo night needs Playwright)'); process.exit(0); }
const require = createRequire(import.meta.url);
const pw = require(process.env.PW_MODULE);
const PORT = Number(process.env.PORT || 9503), BASE = 'http://127.0.0.1:' + PORT, SHOTS = process.env.ROOM_TABLES_SHOTS || '';
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test', P1 = 'player1@example.test';
const WIN = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, name) => { if (ok) console.log('PASS ' + name); else { failed++; console.log('FAIL ' + name); } };
async function until(fn, ms, step = 200) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, text: t, json: j }; });
const feats = (f) => api('PATCH', '/gm/state', { features: f });

/* the fixture's two tables, and every string of them a player must never be sent (the says, the things' names, lines, closer looks, rolls and dangers) */
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'rooms-pack.json'), 'utf8')).T;
const KINDS = [FIX.rooms['pelican bar'], FIX.rooms['pelican cloakroom']];
const TEXTS = [...new Set(KINDS.flatMap((t) => t.say.concat(t.things.flatMap((x) => [x.name, x.line, x.look, x.roll, x.danger]))).filter((s) => s && s.length >= 8))];
const leaks = (text, sent = []) => { const t = sent.reduce((a, l) => a.split(l).join(''), text); return TEXTS.filter((s) => t.includes(s)).concat(/GM-ONLY-(look|roll|danger)/.test(t) ? ['GM-ONLY-'] : []); };
/* a rooms part for these room names: each one a copy of one of the two tables under that name (alternately), none of them a vault table */
function roomsPart(names) {
  const rooms = {};
  [...new Set(names)].forEach((n, i) => { rooms[n.toLowerCase().replace(/\s+/g, ' ').trim()] = Object.assign(JSON.parse(JSON.stringify(KINDS[i % 2])), { name: n }); });
  return { v: 1, T: { rooms, roles: FIX.roles, aliases: {} } };
}
const putRooms = (names) => api('POST', '/gm/pack', { part: 'rooms', src: { file: 'demo/rooms', blockSha: '0', exportedAt: new Date().toISOString() }, body: roomsPart(names) });

const env = { ...process.env };
delete env.ANTHROPIC_API_KEY; delete env.B68_ANTHROPIC_KEY;
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const demo = spawn(process.execPath, [path.join(ROOT, 'scripts', 'demo-night.mjs'), '--port', String(PORT)], { cwd: ROOT, env, detached: !WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let demoLog = '';
demo.stdout.on('data', (d) => { demoLog += d; }); demo.stderr.on('data', (d) => { demoLog += d; });
function killDemo() { if (WIN) spawnSync('taskkill', ['/pid', String(demo.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-demo.pid, 'SIGKILL'); } catch (_) {} } }
process.on('exit', killDemo);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + demoLog.slice(-2000)); process.exit(1); }, 1500000);

let browser = null;
const errors = [];
try {
  if (!(await until(async () => /Ctrl\+C stops it/.test(demoLog), 180000, 500))) throw new Error('the demo night did not come up:\n' + demoLog.slice(-1500));
  const card0 = (await api('GET', '/gm/state')).json;
  const SITE_CARD = card0 && card0.doc && card0.doc.cards ? card0.doc.cards.location : (card0 && card0.cards ? card0.cards.location : null);
  check(!!(SITE_CARD && SITE_CARD.auth), 'the demo night\'s Location card is its authored v2 site');

  browser = await pw.chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const blur = (page) => page.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); });
  async function open({ w = 1366, h = 768, theme = 'paper', kit = false, tables = true, v2 = false, route = null } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w, height: h }, serviceWorkers: 'block' });
    if (route) await c.route('**/api/gm/assist/room', route);      /* RK16: the Blade tap's fake, in place before the page loads */
    await c.addInitScript({ content: 'window.__B68_POLL_MS = 1000; try { localStorage.setItem("b68.theme", ' + JSON.stringify(theme === 'night' ? 'dark' : 'light') + '); } catch (e) {}' });
    const page = await c.newPage(), fetched = [];
    page.on('request', (r) => fetched.push(r.url()));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());      /* "Replace tonight's site with a rolled location?": yes */
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me && window.B68GmPage && window.B68GmPage._places && window.B68GmPage._places(), null, { timeout: 40000 });
    if (kit) await page.waitForFunction(() => window.B68Kit && window.B68Kit.ready('desk') && window.B68KitRun, null, { timeout: 30000 });
    if (tables) await page.waitForFunction(() => window.B68GmRoomRolled && !window.B68GmRoomRolled.stub && window.B68GmPage._roomRolled(), null, { timeout: 30000 });
    await blur(page); await page.waitForTimeout(600);
    await page.evaluate(() => window.B68GmPage.goPlace('score')); await page.waitForTimeout(700);
    await page.keyboard.press('g');
    await page.waitForSelector(v2 ? (kit ? '.krv-head' : '.rv-head') : '#gm-runv .rr-site, #gm-runv .gm-runhelp, #gm-runv .rv-head', { timeout: 20000 }); await page.waitForTimeout(700);
    return { c, page, fetched };
  }
  const card = (room, n) => '#gm-runv .rv-rm[data-room="' + room + '"]' + (n > 1 ? '[data-rn="' + n + '"]' : ':not([data-rn])');
  const cards = (page) => page.evaluate(() => [...document.querySelectorAll('#gm-runv .rr-site .rv-rm[data-room]')].map((c) => ({
    room: c.getAttribute('data-room'), n: +(c.getAttribute('data-rn') || 1), say: (c.querySelector('[data-rr-say]') || { textContent: '' }).textContent,
    none: (c.querySelector('.rr-none') || { textContent: '' }).textContent, things: [...c.querySelectorAll('[data-site="thing"]')].map((b) => b.getAttribute('data-thing')),
    keys: [...c.querySelectorAll('[data-site="thing"] .ui-key')].map((k) => k.getAttribute('data-ui-key')).join(''), ppl: !!c.querySelector('ul.rr-ppl'),
    slots: [...c.querySelectorAll('[data-rr-slot]')].map((s) => s.getAttribute('data-role')), exits: (c.querySelector('.rr-exits') || { textContent: '' }).textContent })));
  const zoom = (page) => page.evaluate(() => {
    const z = document.querySelector('.rk-zscope .rk-zoom'); if (!z || !z.isConnected) return null;
    const t = (s) => { const e = z.querySelector(s); return e ? e.textContent : ''; };
    return { name: t('.rk-zname'), eye: t('.rk-zeye'), line: t('.rk-zline'), slots: [...z.querySelectorAll('[data-rk-slot]')].map((s) => s.getAttribute('data-rk-slot') + ':' + [...s.querySelectorAll('button')].map((b) => (b.querySelector('.ui-label') || b).textContent).join('/')),
      focusIn: z.contains(document.activeElement), esc: (window.B68GmEsc.list().filter((e) => e.open)[0] || {}).id };
  });
  const shot = async (page, name) => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); await page.mouse.move(1, 1); await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTS, name + '.png'), animations: 'disabled' }); };
  const reads = async () => {
    const d = await api('GET', '/gm/display', undefined, IPAD), s = await api('GET', '/table/screen', undefined, P1), c = await api('GET', '/campaign', undefined, P1), p = await api('GET', '/characters/pc-nell', undefined, P1);
    return { ok: [d, s, c, p].every((x) => x.status === 200), all: d.text + s.text + c.text + p.text, ov: d.json && d.json.ambient && d.json.ambient.doc ? d.json.ambient.doc.overlay || null : null, mission: !!(c.json && c.json.doc && c.json.doc.mission && c.json.doc.mission.hud) };
  };

  /* ---- 1. off ---- */
  check((await feats({ 'room.tables': false, 'room.key': false, 'kit.desk': false })).status === 200, 'room.tables, room.key and kit.desk are off');
  const A = await open({ tables: false, v2: true });
  await A.page.waitForSelector('#gm-runv .rv-rm[data-room="Showroom"]', { timeout: 15000 }); await A.page.waitForTimeout(1500);
  check(!A.fetched.some((u) => /\/gm\/room-(rolled|roll|tables|swap|blade|people|keep)\.js/.test(u)), 'off: the GM page fetches no room-tables file');
  const offShow = await A.page.evaluate(() => document.querySelector('#gm-runv .rv-rm[data-room="Showroom"]').outerHTML);
  check(!/data-rr-|rr-say|rr-ppl/.test(offShow) && await A.page.evaluate(() => window.B68GmPage._roomRolled() === null), 'off: the night\'s Showroom card is today\'s (no rolled parts), and there is no rolled-room instance');
  const SITE_ROOMS = await A.page.evaluate(() => window.B68GmPage._state().locRoll.rooms.map((r) => r.name));
  await A.c.close();

  /* ---- 2. on: a rolled site ---- */
  check((await feats({ 'room.tables': true, 'room.key': true })).status === 200, 'room.tables and room.key are on');
  const B = await open({ v2: true });
  let page = B.page;
  check(B.fetched.some((u) => /\/gm\/room-rolled\.js/.test(u)) && B.fetched.some((u) => /\/gm\/room-zoom\.js/.test(u)), 'on: the room-tables bundle is fetched, with room-key first');
  await page.evaluate(() => window.B68GmPage.goPlace('score')); await sleep(300);
  await page.evaluate(() => { window.B68GmPage.openView('location'); });
  await page.waitForSelector('[data-gm="locroll"]', { timeout: 15000 });
  await page.evaluate(() => document.querySelector('[data-gm="locroll"]').click());
  await page.waitForSelector('#gm-runv .rr-site .rv-rm[data-room]', { timeout: 15000 }); await sleep(600);
  const st = await page.evaluate(() => { const s = window.B68GmPage._state(); return { panel: s.panel, auth: !!(s.doc.cards.location || {}).auth, rooms: s.locRoll.rooms.map((r) => r.name), seen: !!document.querySelector('#gm-runv .rr-site') && document.querySelector('#gm-runv').offsetParent !== null }; });
  check(st.panel === 'run' && !st.auth && st.seen && st.rooms.length >= 6, 'RK14.3: a new roll goes straight to the site screen, its cards on it (' + JSON.stringify({ panel: st.panel, rooms: st.rooms.length }) + ')');
  let cs = await cards(page);
  check(cs.length === st.rooms.length && cs.every((c) => c.none === 'No table for ' + c.room + '.' || c.none.startsWith('No table for ' + c.room + '. ')) && await page.evaluate(() => /the pack has no room tables/.test(document.querySelector('#gm-runv .rr-site').textContent)),
    'with no rooms part: one card a room, each saying "No table for <room>" (no theme items), and the site says the pack has none');
  const LEFT = st.rooms[st.rooms.length - 1], COVERED = st.rooms.filter((n) => n !== LEFT);
  check((await putRooms(COVERED.concat(SITE_ROOMS))).status === 200, 'a rooms part for every room on the page but one (' + LEFT + '), each a copy of a fixture table');
  await B.c.close();

  const C = await open({});
  page = C.page;
  await page.waitForSelector('#gm-runv .rr-site [data-rr-say]', { timeout: 20000 });
  cs = await cards(page);
  const tabled = cs.filter((c) => c.room !== LEFT);
  const good = tabled.filter((c) => /^SAY “.+ There['’]s .+\.”$/.test(c.say) && c.things.length === 4 && c.keys === '1234' && c.ppl);
  check(cs.length === st.rooms.length && good.length === tabled.length, 'Alex\'s test, rolled: every room with a table has a read-aloud ending in "There\'s ...", 4 things to click (keys 1 to 4) and a people slot list (' + good.length + ' of ' + tabled.length + ')');
  check(cs.filter((c) => c.room === LEFT).every((c) => c.none.startsWith('No table for ' + LEFT) && !c.things.length && !c.say), 'the room left out of the part says "No table for ' + LEFT + '", with no things');
  const pub = tabled.filter((c) => c.slots.length), named = tabled.every((c) => c.things.every((s) => c.say.toLowerCase().includes(s.split('-')[0])));
  check(pub.length > 0 && named, 'people slots drawn by the table\'s band, and the read-aloud names each drawn thing (' + pub.length + ' rooms with someone)');
  const roll = await page.evaluate(() => { const r = window.B68GmPage._state().locRoll; return { connects: r.rooms.filter((x) => x.connects).map((x) => [x.name, x.connects]), skips: (r.skips || []).length }; });
  check(roll.connects.every(([n, via]) => cs.some((c) => c.room === n && c.exits.includes('Out via ' + via))), 'exits from the roll: each back route shows on its room (' + roll.connects.length + ' rooms, ' + roll.skips + ' ring-skips)');
  await shot(page, 'desk-1366-paper-cards');

  /* a click and a key open the zoom card; Esc closes it */
  const first = tabled[0];
  await page.click(card(first.room, first.n) + ' [data-site="thing"][data-i="1"]');
  let z = await until(() => zoom(page), 4000);
  check(!!z && z.eye.startsWith(first.room + ' · 2 of 4') && z.focusIn && z.esc === 'room.zoom', 'a click on a rolled room\'s thing opens its zoom card (' + (z && z.eye) + ')');
  await shot(page, 'desk-1366-paper-zoom');
  await page.keyboard.press('Escape');
  check(!!(await until(async () => !(await zoom(page)), 3000)), 'Esc closes it');
  await page.focus(card(first.room, first.n) + ' [data-site="thing"][data-i="0"]');
  await page.keyboard.press('3'); z = await until(() => zoom(page), 3000);
  const k3 = !!z && z.eye.startsWith(first.room + ' · 3 of 4');
  await page.keyboard.press('ArrowRight'); z = await zoom(page);
  check(k3 && !!z && z.eye.startsWith(first.room + ' · 4 of 4'), 'keys: 3 in a focused card opens the third thing, → steps on');
  await page.keyboard.press('Escape'); await sleep(200);

  /* secrecy, no play block: nothing of a rolled room in the GETs, before a send and after one */
  const r0 = await reads();
  check(r0.ok && leaks(r0.all).length === 0, 'secrecy (a rolled site, no play): the display\'s GET, a phone\'s /api/table/screen and character, and the campaign document hold no rolled-room text (' + leaks(r0.all).slice(0, 3).join(' | ') + ')');
  await page.click(card(first.room, first.n) + ' [data-site="thing"][data-i="0"]'); z = await until(() => zoom(page), 3000);
  const T0 = await page.evaluate(() => { const z = document.querySelector('.rk-zoom'); return { name: z.querySelector('.rk-zname').textContent, line: (z.querySelector('.rk-zline') || { textContent: '' }).textContent }; });
  check(!!z && /^show:Show on iPad/.test(z.slots[0] || ''), 'the zoom card offers Show on iPad (RK10\'s, with room.key on) (' + (z && z.slots.join(' ')) + ')');
  await page.click('.rk-zoom [data-rk-btn="show-thing"]');
  const r1 = await until(async () => { const r = await reads(); return r.ov && r.ov.kind === 'title' ? r : null; }, 8000);
  const p1 = r1 && r1.ov ? r1.ov.payload || {} : {};
  const sub = T0.line ? T0.line.charAt(0).toUpperCase() + T0.line.slice(1) : '';
  check(!!r1 && p1.text === T0.name && (!T0.line || p1.sub === sub), 'Show on iPad sends the one line: a title beat of the thing\'s name and its line (' + JSON.stringify(p1) + ')');
  check(!!r1 && leaks(r1.all, [T0.name, T0.line, sub]).length === 0, 'secrecy after the send: that line and nothing else of a rolled room (' + (r1 ? leaks(r1.all, [T0.name, T0.line, sub]).slice(0, 3).join(' | ') : '') + ')');
  if (SHOTS) {
    const ip = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1024, height: 768 }, serviceWorkers: 'block' });
    const dp = await ip.newPage(); await dp.addInitScript({ content: 'window.__B68_POLL_MS = 1000;' }); await dp.goto(BASE + '/#display'); await dp.waitForTimeout(4000);
    fs.mkdirSync(SHOTS, { recursive: true }); await dp.screenshot({ path: path.join(SHOTS, 'ipad-1024-beat.png') }); await ip.close();
  }
  {      /* a phone's DOM, always (the review of RK14): no rolled-room text or markup, bar the one line sent */
    const ph = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': P1 }, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    const pp = await ph.newPage(); await pp.goto(BASE + '/#c/pc-nell'); await pp.waitForTimeout(5000);
    const dom = await pp.evaluate(() => document.documentElement.outerHTML);
    check(dom.length > 2000 && leaks(dom, [T0.name, T0.line, sub]).length === 0 && !/rr-site|data-rr-/.test(dom), 'a phone\'s DOM holds no rolled-room text or markup');
    if (SHOTS) await pp.screenshot({ path: path.join(SHOTS, 'phone-390.png') });
    await ph.close();
  }
  await page.click('.rk-zoom [data-rk-btn="show-thing"]'); await sleep(600);      /* Take it down */
  await page.keyboard.press('Escape'); await sleep(200);

  /* a reload gives the same cards */
  const before = JSON.stringify(cs);
  await C.c.close();
  const D = await open({});
  await D.page.waitForSelector('#gm-runv .rr-site [data-rr-say]', { timeout: 20000 });
  check(JSON.stringify(await cards(D.page)) === before, 'a reload gives the same cards: the same read-aloud, things and people');
  if (SHOTS) {
    await D.page.evaluate(() => document.querySelector('#gm-runv .rr-cards').scrollIntoView({ block: 'start' }));
    await shot(D.page, 'desk-1366-paper-cards-scrolled');
  }
  await D.c.close();
  const sNow = (await api('GET', '/gm/state')).json, ROLLED_CARD = sNow && sNow.doc && sNow.doc.cards ? sNow.doc.cards.location : null;

  /* ---- 2b. room.tables alone (room.key off): Show on iPad and the marks still work on a rolled card (the overseer's RK14 rulings) ---- */
  check((await feats({ 'room.key': false })).status === 200, 'room.key off, room.tables on');
  const H = await open({});
  page = H.page;
  await page.waitForSelector('#gm-runv .rr-site [data-rr-say]', { timeout: 20000 });
  check(await page.evaluate(() => window.B68GmPage.roomShow() !== null && window.B68GmPage._roomZoom() === null), 'room.tables alone: Show on iPad has its host (RK10\'s, the gate is room.key or room.tables), and RK09\'s card is off');
  const mc = (await cards(page)).filter((c) => c.things.length)[0];
  const mKey = await page.evaluate((sel) => document.querySelector(sel + ' [data-rr-room]').getAttribute('data-rr-room'), card(mc.room, mc.n));
  await page.click(card(mc.room, mc.n) + ' [data-site="thing"][data-i="0"]'); z = await until(() => zoom(page), 4000);
  const T1 = await page.evaluate(() => { const z = document.querySelector('.rk-zoom'); return { name: z.querySelector('.rk-zname').textContent, line: (z.querySelector('.rk-zline') || { textContent: '' }).textContent }; });
  const sub1 = T1.line ? T1.line.charAt(0).toUpperCase() + T1.line.slice(1) : '';
  check(!!z && /^show:Show on iPad/.test(z.slots[0] || ''), 'room.tables alone: the zoom card offers Show on iPad (' + (z && z.slots.join(' ')) + ')');
  await page.click('.rk-zoom [data-rk-btn="show-thing"]');
  const r3 = await until(async () => { const r = await reads(); return r.ov && r.ov.kind === 'title' ? r : null; }, 8000);
  check(!!r3 && r3.ov.payload && r3.ov.payload.text === T1.name && leaks(r3.all, [T1.name, T1.line, sub1]).length === 0, 'room.tables alone: Show on iPad sends the one line, and nothing else of a rolled room reaches the GETs (' + JSON.stringify(r3 && r3.ov && r3.ov.payload) + ')');
  await sleep(300); await page.click('.rk-zoom [data-rk-btn="show-thing"]'); await until(async () => !(await reads()).ov, 8000);      /* Take it down */
  const st1 = await page.evaluate(() => { const b = document.querySelector('.rk-zoom [data-rk-slot="state"] button'); return b ? { id: b.getAttribute('data-rk-btn'), label: (b.querySelector('.ui-label') || b).textContent, disabled: b.disabled } : null; });
  check(!!st1 && !st1.disabled, 'room.tables alone: the state buttons are live on a rolled card (' + JSON.stringify(st1) + ')');
  const slug1 = mc.things[0], rk1 = await page.evaluate(() => String(window.B68GmPage._pure.rollKey(window.B68GmPage._state().locRoll)));
  if (st1) await page.click('.rk-zoom [data-rk-btn="' + st1.id + '"]');
  const stored = async () => { const s = (await api('GET', '/gm/state')).json; const k = s && s.doc && s.doc.roomstate && s.doc.roomstate.keys && s.doc.roomstate.keys[rk1]; return k && k.rooms ? k.rooms : {}; };
  const want = st1 ? st1.label.toLowerCase() : '?';
  const rooms1 = await until(async () => { const r = await stored(); return r[mKey] && r[mKey].marks && r[mKey].marks[slug1] === want ? r : null; }, 15000);
  check(!!rooms1 && Object.keys(rooms1).every((k) => k === mKey), 'a mark on a rolled thing is stored under the roll\'s key and that room\'s own roomKey (' + mKey + ', ' + slug1 + ' = ' + want + ')');
  await page.keyboard.press('Escape');
  const chipOf = (p) => p.evaluate(([sel, s]) => { const b = document.querySelector(sel + ' [data-site="thing"][data-thing="' + s + '"]'); const c = b && b.parentNode.querySelector('.rk-tstate'); return c ? c.textContent : ''; }, [card(mc.room, mc.n), slug1]);
  const I = await open({});
  await I.page.waitForSelector('#gm-runv .rr-site [data-rr-say]', { timeout: 20000 });
  check((await chipOf(I.page)) === want, 'a second page shows the mark as a chip on the same rolled thing');
  await H.c.close(); await I.c.close();
  const J = await open({});
  await J.page.waitForSelector('#gm-runv .rr-site [data-rr-say]', { timeout: 20000 });
  check((await chipOf(J.page)) === want, 'the mark survives a reload');
  await J.page.click(card(mc.room, mc.n) + ' [data-site="thing"][data-thing="' + slug1 + '"]'); await until(() => zoom(J.page), 4000);
  if (st1) await J.page.click('.rk-zoom [data-rk-btn="' + st1.id + '"]');      /* tapped again: the mark goes */
  check(!!(await until(async () => { const r = await stored(); return !(r[mKey] && r[mKey].marks && r[mKey].marks[slug1]); }, 15000)), 'a tap on the pressed state takes the mark away again');
  await J.page.keyboard.press('Escape'); await J.c.close();
  await feats({ 'room.key': true });

  /* ---- 3. the authored v2 night (play.v === 2) ---- */
  check((await api('PATCH', '/gm/state', { cards: { location: Object.assign({}, SITE_CARD, { seed: null, ui: null, mem: null }) } })).status === 200, 'the night\'s authored v2 site is the Location card again');
  const E = await open({ v2: true });
  page = E.page;
  await page.waitForSelector('#gm-runv .rv-rm[data-room="Showroom"] [data-rr-say]', { timeout: 20000 });
  const v2 = await page.evaluate(() => { const c = document.querySelector('#gm-runv .rv-rm[data-room="Showroom"]'); return { say: c.querySelector('[data-rr-say]').textContent, things: c.querySelectorAll('[data-site="thing"]').length, ppl: !!c.querySelector('ul.rr-ppl'), lab: [...c.querySelectorAll('.rr-lab')].map((l) => l.textContent).join('|'), rr: !!document.querySelector('#gm-runv .rr-site') }; });
  check(/There['’]s /.test(v2.say) && v2.things === 4 && v2.ppl && /Quick-draw people/.test(v2.lab) && !v2.rr, 'the v2 night\'s Showroom card carries the same parts (read-aloud, 4 things, people), inside the Run view\'s own card (' + JSON.stringify(v2) + ')');
  const am = await page.evaluate(() => window.B68GmPage._roomRolled().model().cards.map((c) => ({ room: c.name, ok: c.table && !!c.say && /^There's/.test(c.there) && c.things.length === 4 && Array.isArray(c.people) })));
  check(am.length === SITE_ROOMS.length && am.every((c) => c.ok), 'Alex\'s test, authored: every room of the authored site has a description, 4 things and a people slot (' + am.filter((c) => c.ok).length + ' of ' + am.length + ')');
  await page.click('#gm-runv .rv-rm[data-room="Showroom"] [data-site="thing"][data-i="0"]'); z = await until(() => zoom(page), 4000);
  check(!!z && z.eye.startsWith('Showroom · 1 of 4') && await page.evaluate(() => document.querySelectorAll('.rk-zscope .rk-zoom').length === 1), 'a click on its thing opens one zoom card (the rolled room\'s), never two');
  await shot(page, 'desk-1366-paper-v2-card');
  await page.keyboard.press('Escape'); await sleep(200);
  await page.evaluate(() => window.B68GmPage._setPhoneCards(true));      /* the players' mission published at once (missionSource: the open rooms go to the phones) */
  const r2 = (await until(async () => { const r = await reads(); return r.mission ? r : null; }, 15000)) || (await reads());
  await page.evaluate(() => window.B68GmPage._setPhoneCards(false)); await sleep(600);
  check(r2.ok && r2.mission && leaks(r2.all).length === 0, 'secrecy (play.v === 2, the mission published): the display\'s GET, a phone\'s screen and character, and the campaign document with its mission hold no rolled-room text (' + JSON.stringify({ ok: r2.ok, mission: r2.mission, leaks: leaks(r2.all).slice(0, 3) }) + ')');
  await E.c.close();

  /* ---- 4. the kit desk, on the rolled site of step 2 ---- */
  check(!!(ROLLED_CARD && ROLLED_CARD.seed) && (await api('PATCH', '/gm/state', { cards: { location: Object.assign({}, ROLLED_CARD, { auth: null }) } })).status === 200, 'step 2\'s rolled site is the Location card again');
  await feats({ 'kit.desk': true });
  const F = await open({ kit: true });
  const kitUp = await until(() => F.page.evaluate(() => !!document.querySelector('#gm-runv .rr-site .rv-rm.krv-rm [data-site="thing"]')), 20000, 500);
  if (!kitUp) console.log('  kit desk: ' + JSON.stringify(await F.page.evaluate(() => { const s = window.B68GmPage._state(), b = document.querySelector('#gm-runv'); return { panel: s.panel, auth: !!(s.doc.cards.location || {}).auth, kit: document.documentElement.getAttribute('data-kit'), rr: !!window.B68GmPage._roomRolled(), shown: !!(b && b.offsetParent), html: b ? b.innerHTML.slice(0, 400) : '' }; })));
  await sleep(600);
  const kAll = await cards(F.page), kc = kAll.filter((c) => c.things.length);
  check(JSON.stringify(kAll) === before, 'the kit desk draws the same cards as the old desk: the same read-aloud, things and people');
  z = null; if (kitUp && kc.length) { await F.page.click(card(kc[0].room, kc[0].n) + ' [data-site="thing"][data-i="0"]'); z = await until(() => zoom(F.page), 4000); }
  await shot(F.page, 'kitdesk-1366-paper-zoom-first');
  check(kc.length > 0 && !!z && z.eye.startsWith(kc[0].room + ' · 1 of '), 'the kit desk: the same cards (krv classes beside the old ones), and a click opens the zoom card');
  await F.page.keyboard.press('Escape'); await F.c.close();

  /* ---- 4b. RK16, the Blade tap, on the same rolled site. The seat is a page.route fake (no model, no key); GM-ONLY- markers in every field it answers ---- */
  {
    const BLADE = { say: 'GM-ONLY-say: the band stops as you come in.',
      things: [{ name: 'GM-ONLY-velvet rope', line: 'GM-ONLY-line: it guards a side stair.', look: 'GM-ONLY-look: the hook is loose.', roll: 'GM-ONLY-roll 4/5: it drops.', danger: 'GM-ONLY-danger: the bouncer sees.', states: ['up', 'down'], tags: ['door'] },
        { name: 'GM-ONLY-ice bucket', line: 'GM-ONLY-line: sweating on the bar.', look: '', roll: '', danger: '', states: [], tags: [] }],
      people: [{ line: 'GM-ONLY-person: a cleaner counting tips', role: 'cleaner' }] };
    const BL_TEXTS = [BLADE.say, BLADE.people[0].line].concat(BLADE.things.flatMap((x) => [x.name, x.line, x.look, x.roll, x.danger])).filter(Boolean);
    const bleaks = (text, sent = []) => { const t = sent.reduce((a, l) => a.split(l).join(''), text); return BL_TEXTS.filter((s) => t.includes(s)); };
    const SPEND = { tonight: 0.01, cap: 30, tier: 'all', tick: 0.005 };
    const fake = { mode: 'good', asked: [] };
    const route = async (rt) => {
      let b = null; try { b = rt.request().postDataJSON(); } catch (_) { b = null; }
      fake.asked.push(b); await sleep(700);
      const body = fake.mode === 'good' ? { room: { ...JSON.parse(JSON.stringify(BLADE)), at: new Date().toISOString() }, cents: 0.5, spend: SPEND }
        : fake.mode === 'refused' ? { room: null, error: 'Blade’s answer did not fit the card (unknown field: secret): nothing changed', cents: 0.4, spend: SPEND }
        : { room: { say: 5, things: 'GM-ONLY-not a list', people: [] }, cents: 0.4, spend: SPEND };
      return rt.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    };
    await feats({ 'kit.desk': false, 'room.tables': true, 'room.key': true });
    /* the site screen with its Fit buttons (no retry: the review of RK16 found a G retry only redrew the same stale cards); if they never come, say where the page is */
    const fitUp = async (p) => {
      if (await p.waitForSelector('#gm-runv .rr-site [data-rb="fit"]', { timeout: 20000 }).then(() => true, () => false)) return true;
      console.log('  4b: ' + JSON.stringify(await p.evaluate(() => { const s = window.B68GmPage._state(), b = document.querySelector('#gm-runv'); return { panel: s.panel, kit: document.documentElement.getAttribute('data-kit'),
        blade: !!(window.B68GmRoomBlade && !window.B68GmRoomBlade.stub), rr: !!window.B68GmPage._roomRolled(), html: b ? b.innerHTML.slice(0, 300) : '' }; })));
      return false;
    };
    const BL = await open({ route });
    page = BL.page;
    if (!(await fitUp(page))) throw new Error('4b: the Fit buttons never showed');
    const bc = await page.evaluate(() => [...document.querySelectorAll('#gm-runv .rr-site .rv-rm[data-room]')].map((c) => ({ room: c.getAttribute('data-room'), n: +(c.getAttribute('data-rn') || 1),
      things: c.querySelectorAll('[data-site="thing"]').length, fit: [...c.querySelectorAll('[data-rb="fit"]')].map((b) => (b.querySelector('.ui-label') || b).textContent) })));
    const tb = bc.filter((c) => c.things);
    check(tb.length >= 2 && tb.every((c) => c.fit.length === 1 && c.fit[0] === 'Fit to tonight (~3¢)') && bc.filter((c) => !c.things).every((c) => !c.fit.length),
      'RK16: "Fit to tonight (~3¢)" on every room with a table, and none on the room with no table (' + tb.length + ' rooms)');
    const sel1 = card(tb[0].room, tb[0].n), sel2 = card(tb[1].room, tb[1].n);
    const keyOf = (s) => page.evaluate((x) => document.querySelector(x + ' [data-rr-blade]').getAttribute('data-rr-blade'), s);
    const key1 = await keyOf(sel1), key2 = await keyOf(sel2);
    const rkB = await page.evaluate(() => String(window.B68GmPage._pure.rollKey(window.B68GmPage._state().locRoll)));
    const bladeAt = async (k) => { const s = (await api('GET', '/gm/state')).json; const r = s && s.doc && s.doc.roomstate && s.doc.roomstate.keys && s.doc.roomstate.keys[rkB]; return r && r.rooms && r.rooms[k] ? r.rooms[k].blade || null : null; };
    await page.click(sel1 + ' [data-rb="fit"]');
    const busy = await until(() => page.evaluate((s) => { const b = document.querySelector(s + ' [data-rb="fit"]'); return b && b.getAttribute('aria-busy') === 'true' && /Fitting…/.test(b.textContent) ? true : null; }, sel1), 3000, 100);
    const waits = await page.evaluate(() => [...document.querySelectorAll('#gm-runv [data-rb="fit"]')].filter((b) => b.getAttribute('aria-busy') !== 'true').every((b) => b.disabled));
    check(!!busy && waits, 'a tap is busy ("Fitting…"), and every other Fit waits');
    const landed = await until(() => page.evaluate((s) => { const c = document.querySelector(s), m = c && c.querySelector('.rr-bmark'); return m ? { mark: m.textContent, say: c.querySelector('[data-rr-say]').textContent,
      things: c.querySelectorAll('[data-site="thing"]').length, ppl: [...c.querySelectorAll('.rr-bperson')].map((l) => l.textContent), clear: !!c.querySelector('[data-rb="clear"]'),
      stars: c.querySelectorAll('.rk-ti > span.rr-bstar').length, starWho: c.querySelectorAll('.rr-ppl .rr-bperson').length,
      px: [m, c.querySelector('.rr-bperson')].filter(Boolean).map((e) => parseFloat(getComputedStyle(e).fontSize)) } : null; }, sel1), 8000);
    check(!!landed && landed.mark === '✦ Blade fitted this room to tonight: the read-aloud, GM-ONLY-velvet rope, GM-ONLY-ice bucket and 1 person.' && landed.say.startsWith('SAY “' + BLADE.say + ' There') && landed.things === 6 &&
      landed.ppl.length === 1 && landed.ppl[0].includes(BLADE.people[0].line) && landed.clear && landed.stars === 2 && landed.starWho === 1 && landed.px.length === 2 && landed.px.every((x) => x >= 12),
      'the fake\'s answer lands on the card marked ✦ Blade: its read-aloud, 6 things (keys 5 and 6 are Blade\'s, each with a ✦), its person in Who\'s here, Clear, all 12 px or more (' + JSON.stringify(landed) + ')');
    const okToast = await until(() => page.evaluate(() => (document.getElementById('toastMsg') || {}).textContent || ''), 3000, 100);
    check(okToast === '✦ Blade fitted ' + tb[0].room + ' to tonight.', 'a toast says so (' + okToast + ')');
    const q = fake.asked[0] || {}, qs = JSON.stringify(q);
    const LOOKS = KINDS.flatMap((t) => t.things.flatMap((x) => [x.look, x.roll, x.danger])).filter((s) => s && s.length >= 8);
    check(fake.asked.length === 1 && Object.keys(q).join() === 'site,room,tonight' && q.room && q.room.name === tb[0].room && q.room.things.length === 4 && q.room.things.every((x) => Object.keys(x).join() === 'name,line') &&
      !/GM-ONLY-(look|roll|danger)/.test(qs) && !LOOKS.some((s) => qs.includes(s)), 'the request carries only what the card shows: the site, the room (names and first lines of its things), tonight; no closer look, roll or danger');
    const stored1 = await until(() => bladeAt(key1), 15000, 500);
    check(!!stored1 && stored1.say === BLADE.say && stored1.things.length === 2 && stored1.people.length === 1, 'the answer is in the GM state, under the roll\'s key and that room\'s own roomKey (' + key1 + ')');
    const r4 = await reads();
    check(r4.ok && bleaks(r4.all).length === 0 && leaks(r4.all).length === 0, 'Gate 2 secrecy after the tap: the display\'s GET, a phone\'s /api/table/screen and character, and the campaign document hold nothing Blade said (' + bleaks(r4.all).slice(0, 3).join(' | ') + ')');
    if (SHOTS) { await page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'start' }), sel1); await shot(page, 'desk-1366-paper-blade'); }
    /* the iPad's DOM (Gate 2; the review could not reach it): kept open through the Show below */
    const ipC = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1024, height: 768 }, serviceWorkers: 'block' });
    const ipP = await ipC.newPage(); await ipP.addInitScript({ content: 'window.__B68_POLL_MS = 1000;' }); await ipP.goto(BASE + '/#display'); await ipP.waitForTimeout(5000);
    const ipDom0 = await ipP.evaluate(() => document.documentElement.outerHTML);
    check(ipDom0.length > 2000 && bleaks(ipDom0).length === 0 && leaks(ipDom0).length === 0 && !/rr-blade|data-rb/.test(ipDom0), 'Gate 2: the iPad\'s DOM after the tap holds nothing Blade said (' + bleaks(ipDom0).slice(0, 3).join(' | ') + ')');
    /* Show on iPad on a Blade thing: RK10's one line, nothing else */
    await page.click(sel1 + ' [data-site="thing"][data-i="4"]'); z = await until(() => zoom(page), 4000);
    check(!!z && z.name === BLADE.things[0].name && z.eye.startsWith(tb[0].room + ' · 5 of 6'), 'a Blade thing opens in the zoom card like any other (' + (z && z.eye) + ')');
    if (SHOTS) await shot(page, 'desk-1366-paper-blade-zoom');
    await page.click('.rk-zoom [data-rk-btn="show-thing"]');
    const r5 = await until(async () => { const r = await reads(); return r.ov && r.ov.kind === 'title' ? r : null; }, 8000);
    const bsub = BLADE.things[0].line.charAt(0).toUpperCase() + BLADE.things[0].line.slice(1), sentB = [BLADE.things[0].name, BLADE.things[0].line, bsub];
    check(!!r5 && r5.ov.payload && r5.ov.payload.text === BLADE.things[0].name && bleaks(r5.all, sentB).length === 0 && leaks(r5.all).length === 0,
      'Show on iPad of a Blade thing sends the one line (its name and line), and nothing else Blade said reaches the GETs (' + JSON.stringify(r5 && r5.ov && r5.ov.payload) + ')');
    const ipDom1 = (await until(async () => { const d = await ipP.evaluate(() => document.documentElement.outerHTML); return d.includes(BLADE.things[0].name) ? d : null; }, 10000, 500)) || (await ipP.evaluate(() => document.documentElement.outerHTML));
    check(ipDom1.includes(BLADE.things[0].name) && bleaks(ipDom1, sentB).length === 0 && leaks(ipDom1).length === 0 && !/rr-blade|data-rb/.test(ipDom1),
      'Gate 2: the iPad\'s DOM after Show on iPad of a Blade thing holds that one line and nothing else Blade said (' + bleaks(ipDom1, sentB).slice(0, 3).join(' | ') + ')');
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await ipP.screenshot({ path: path.join(SHOTS, 'ipad-1024-blade-beat.png') }); }
    await ipC.close();
    {
      const ph = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': P1 }, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const pp = await ph.newPage(); await pp.goto(BASE + '/#c/pc-nell'); await pp.waitForTimeout(5000);
      const dom = await pp.evaluate(() => document.documentElement.outerHTML);
      check(dom.length > 2000 && bleaks(dom, sentB).length === 0 && !/rr-blade|data-rb/.test(dom), 'a phone\'s DOM holds nothing Blade said, bar the one line sent');
      await ph.close();
    }
    await sleep(300); await page.click('.rk-zoom [data-rk-btn="show-thing"]'); await until(async () => !(await reads()).ov, 8000);      /* Take it down */
    await page.keyboard.press('Escape'); await sleep(200);
    /* refused: the server's { room: null, error }, then a malformed answer: a toast each, nothing stored, the button back */
    fake.mode = 'refused';
    await page.click(sel2 + ' [data-rb="fit"]');
    const e1 = await until(() => page.evaluate(() => { const t = (document.getElementById('toastErr') || {}).textContent || ''; return /unknown field: secret/.test(t) ? t : null; }), 6000, 100);
    fake.mode = 'bad';
    await until(() => page.evaluate((s) => { const b = document.querySelector(s + ' [data-rb="fit"]'); return b && !b.disabled && b.getAttribute('aria-busy') !== 'true'; }, sel2), 4000, 100);
    await page.click(sel2 + ' [data-rb="fit"]');
    const e2 = await until(() => page.evaluate(() => { const t = (document.getElementById('toastErr') || {}).textContent || ''; return /did not fit the card: nothing changed/.test(t) ? t : null; }), 6000, 100);
    await sleep(1500);
    const back = await page.evaluate((s) => { const c = document.querySelector(s), b = c.querySelector('[data-rb="fit"]'); return { label: (b.querySelector('.ui-label') || b).textContent, busy: b.getAttribute('aria-busy') === 'true', mark: !!c.querySelector('.rr-bmark') }; }, sel2);
    check(!!e1 && !!e2 && !(await bladeAt(key2)) && back.label === 'Fit to tonight (~3¢)' && !back.busy && !back.mark, 'a refusal and a malformed answer are each a toast; nothing is stored and the button is back (' + JSON.stringify({ e1, e2, back }) + ')');
    /* Clear takes one room's changes off; a reload keeps the other's */
    fake.mode = 'good';
    await page.click(sel2 + ' [data-rb="fit"]');
    await until(() => page.evaluate((s) => !!document.querySelector(s + ' .rr-bmark'), sel2), 8000);
    await until(() => bladeAt(key2), 15000, 500);
    await page.click(sel2 + ' [data-rb="clear"]');
    const cleared = await until(async () => (await page.evaluate((s) => !document.querySelector(s + ' .rr-bmark'), sel2)) && !(await bladeAt(key2)), 15000, 500);
    check(!!cleared && !!(await bladeAt(key1)), 'Clear takes Blade\'s changes off that room alone, on the card and in the GM state');
    await BL.c.close();
    const BR = await open({ route });
    check(await fitUp(BR.page), 'a reload: the Fit buttons are there');
    const look = () => BR.page.evaluate(([a, b]) => { const c = document.querySelector(a), m = c && c.querySelector('.rr-bmark'), say = c && c.querySelector('[data-rr-say]');
      return { kept: m && say ? say.textContent : '', mark2: !!document.querySelector(b + ' .rr-bmark'), card: c ? '' : (document.querySelector('#gm-runv') || { textContent: '' }).textContent.slice(0, 160) }; }, [sel1, sel2]);
    const kept = (await until(async () => { const v = await look(); return v.kept && !v.mark2 ? v : null; }, 20000, 400)) || (await look());
    check(kept.kept.startsWith('SAY “' + BLADE.say) && !kept.mark2, 'a reload keeps the fitted room as it was, and the cleared one plain (' + JSON.stringify({ kept: kept.kept.slice(0, 50), mark2: kept.mark2, server1: !!(await bladeAt(key1)), server2: !!(await bladeAt(key2)), card: kept.card }) + ')');
    await BR.c.close();
    await feats({ 'kit.desk': true });
    const BK = await open({ kit: true, route });
    const kitB = await until(() => BK.page.evaluate((s) => { const c = document.querySelector(s), m = c && c.querySelector('.rr-bmark'); return m ? { kit: c.classList.contains('krv-rm'), stars: c.querySelectorAll('.rk-ti > span.rr-bstar').length, fit: !!c.querySelector('[data-rb="fit"]') } : null; }, sel1), 20000, 500);
    check(!!kitB && kitB.kit && kitB.fit && kitB.stars === 2, 'the kit desk draws the same ✦ Blade block and marks (' + JSON.stringify(kitB) + ')');
    if (SHOTS) { await BK.page.evaluate((s) => document.querySelector(s).scrollIntoView({ block: 'start' }), sel1); await shot(BK.page, 'kitdesk-1366-paper-blade'); }
    await BK.c.close();
    await feats({ 'kit.desk': false });
  }

  /* pictures */
  if (SHOTS) {
    for (const [kit, w, theme] of [[false, 1366, 'night'], [false, 1536, 'paper'], [false, 1536, 'night'], [true, 1366, 'paper'], [true, 1366, 'night'], [true, 1536, 'paper'], [true, 1536, 'night']]) {
      await feats({ 'kit.desk': kit });
      const o = await open({ kit, w, h: w === 1536 ? 864 : 768, theme });
      await o.page.waitForSelector('#gm-runv .rr-site [data-site="thing"]', { timeout: 20000 });
      await shot(o.page, (kit ? 'kitdesk-' : 'desk-') + w + '-' + theme + '-cards');
      const c0 = (await cards(o.page)).filter((c) => c.things.length)[0];
      await o.page.click(card(c0.room, c0.n) + ' [data-site="thing"][data-i="0"]'); await until(() => zoom(o.page), 3000);
      await shot(o.page, (kit ? 'kitdesk-' : 'desk-') + w + '-' + theme + '-zoom');
      await o.c.close();
    }
    console.log('pictures in ' + SHOTS);
  }

  /* ---- 5. off again ---- */
  await feats({ 'room.tables': false, 'room.key': false, 'kit.desk': false });
  const G = await open({ tables: false });
  await G.page.waitForSelector('#gm-runv .gm-runhelp', { timeout: 20000 });
  check(await G.page.evaluate(() => !document.querySelector('#gm-runv .rr-site, [data-rr-say], .rk-zscope') && !!document.querySelector('#gm-runv .gm-runhelp')), 'off again: the rolled site\'s Run pane says how to get a night, as today, and no card is drawn');
  check(await G.page.evaluate(() => window.B68GmPage.roomShow() === null), 'with room.key and room.tables both off, Show on iPad has no host (it does not work)');
  await G.c.close();

  /* ---- 6. room.tables turned off live (no reload; the review of RK14): the rolled instance goes with its Run pane listener, so a plain RK09 thing opens
     only RK09's zoom card. The fixture's Showroom Things block (checks/runtime/fixtures/gm/pelican-room-things.md) goes into the prep note first, as room-key.e2e does. */
  {
    const FIXN = fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'pelican-room-things.md'), 'utf8'), gala = FIXN.slice(FIXN.indexOf('## Rooms · The gala'));
    const at = gala.indexOf('### Showroom'), ta = gala.indexOf('- **Things:**', at), BLOCK = gala.slice(ta, gala.indexOf('- **Costume:**', ta)).trimEnd();
    const prep = await api('GET', '/gm/pack?part=prep'), body = prep.json && prep.json.body;
    let put = 0;
    for (const n of (body && Array.isArray(body.notes) ? body.notes : [])) for (const b of (n.blocks || [])) if (typeof b.src === 'string' && b.src.includes('### Showroom\n')) { b.src = b.src.replace('### Showroom\n', '### Showroom\n\n' + BLOCK + '\n'); put++; }
    check(put === 1 && (await api('POST', '/gm/pack', { part: 'prep', src: prep.json.src || {}, body })).status === 200, 'the fixture\'s Showroom Things block is in the prep note');
    check((await api('PATCH', '/gm/state', { cards: { location: Object.assign({}, SITE_CARD, { seed: null, ui: null, mem: null }) } })).status === 200, 'the night\'s authored v2 site is the Location card');
    await feats({ 'room.tables': true, 'room.key': true });
    const K = await open({ v2: true }), kp = K.page, show = '#gm-runv .rv-rm[data-room="Showroom"]';
    await kp.waitForSelector(show + ' [data-rr-say]', { timeout: 20000 });
    await kp.click(show + ' [data-site="thing"][data-i="0"]'); await until(() => zoom(kp), 4000); await kp.keyboard.press('Escape'); await sleep(300);      /* the rolled zoom card has been made and used */
    await feats({ 'room.tables': false });
    await kp.evaluate(() => window.dispatchEvent(new Event('focus')));      /* the GM page takes another device's state when it is focused (refetch), as room-key.e2e does */
    const flipped = await until(() => kp.evaluate((sel) => { const c = document.querySelector(sel); return !!c && !!c.querySelector('.rk-things [data-site="thing"]') && !c.querySelector('[data-rr-say]') && window.B68GmPage._roomRolled() === null; }, show), 20000, 500);
    check(!!flipped, 'room.tables off on the live page: the Showroom card is RK09\'s again (its note\'s things), with no rolled parts, and no rolled instance');
    await kp.click(show + ' [data-site="thing"][data-i="0"]');
    const zk = await until(() => zoom(kp), 4000);
    const only = await kp.evaluate(() => ({ rz: !!(window.B68GmPage._roomZoom() && window.B68GmPage._roomZoom().isOpen()), n: [...document.querySelectorAll('.rk-zoom')].filter((e) => e.isConnected && e.closest('.rk-zscope')).length }));
    check(!!zk && zk.name === 'A brass umbrella stand' && only.rz && only.n === 1, 'then a plain RK09 thing opens only RK09\'s zoom card: no rolled listener is left on the Run pane (' + JSON.stringify(only) + ')');
    await kp.keyboard.press('Escape'); await K.c.close();
  }
  /* ---- 7. RK15: Swap, Roll another and Reroll the room, on step 2's rolled site (the rooms part is still the fixture's) ---- */
  {
    check(!!(ROLLED_CARD && ROLLED_CARD.seed) && (await api('PATCH', '/gm/state', { cards: { location: Object.assign({}, ROLLED_CARD, { auth: null }) } })).status === 200, 'RK15: step 2\'s rolled site is the Location card again');
    await feats({ 'room.tables': true, 'room.key': true, 'kit.desk': false });
    const acts = (pg) => pg.evaluate(() => [...document.querySelectorAll('#gm-runv .rr-site .rv-rm[data-room]')].map((c) => ({ room: c.getAttribute('data-room'), n: +(c.getAttribute('data-rn') || 1),
      btns: [...c.querySelectorAll('[data-rr-act]')].map((b) => (b.querySelector('.ui-label') || b).textContent + (b.disabled ? '!' : '')), ask: (c.querySelector('.rr-asktext') || { textContent: '' }).textContent })));
    const mine = (list, r) => list.filter((c) => c.room === r.room && c.n === r.n)[0];
    const keyOf = (pg, r) => pg.evaluate((sel) => document.querySelector(sel + ' [data-rr-room]').getAttribute('data-rr-room'), card(r.room, r.n));
    const nameAt = (pg, r, i) => pg.evaluate(([sel, k]) => { const b = document.querySelector(sel + ' [data-site="thing"][data-i="' + k + '"]'); return b ? (b.querySelector('.ui-label') || b).textContent : ''; }, [card(r.room, r.n), i]);
    const spoken = (s) => s.replace(/^(A|An|The|Some) /, (m) => m.toLowerCase());
    const focusPage = (pg) => pg.evaluate(() => window.dispatchEvent(new Event('focus')));
    const X = await open({}), Y = await open({});
    await X.page.waitForSelector('#gm-runv .rr-site [data-rr-say]', { timeout: 20000 }); await Y.page.waitForSelector('#gm-runv .rr-site [data-rr-say]', { timeout: 20000 });
    const tab = (await cards(X.page)).filter((c) => c.things.length), a0 = await acts(X.page);
    check(tab.length >= 4 && tab.every((c) => mine(a0, c).btns.join('/') === 'Roll another/Reroll the room') && a0.filter((c) => !tab.some((t) => t.room === c.room && t.n === c.n)).every((c) => !c.btns.length),
      'RK15: every room with a table has Roll another and Reroll the room under its things, and the room with no table has neither (' + JSON.stringify(a0.map((c) => c.btns.length)) + ')');
    const R1 = tab[0], R2 = tab[1], t0 = R1.things.slice(), rkey = await keyOf(X.page, R1), rkey2 = await keyOf(X.page, R2);

    /* Swap */
    await shot(X.page, 'rk15-desk-1366-paper-cards');
    await X.page.click(card(R1.room, R1.n) + ' [data-site="thing"][data-i="0"]'); z = await until(() => zoom(X.page), 4000);
    check(!!z && z.slots.length === 3 && /^swap:Swap$/.test(z.slots[2]), 'RK15: the zoom card\'s swap slot has one button, Swap (' + (z && z.slots.join(' ')) + ')');
    await shot(X.page, 'rk15-desk-1366-paper-zoom-swap');
    await X.page.click('.rk-zoom [data-rk-btn="swap"]');
    const sw1 = await until(async () => { const r = await stored(); return r[rkey] && r[rkey].swaps ? r : null; }, 15000);
    const n1 = mine(await cards(X.page), R1);
    check(!!sw1 && Object.keys(sw1[rkey].swaps).join() === t0[0] && n1.things[0] === sw1[rkey].swaps[t0[0]] && n1.things.slice(1).join() === t0.slice(1).join() && Object.keys(sw1).every((k) => k === rkey),
      'Swap stores one override under the roll\'s key and that room\'s own roomKey, and the thing is replaced in its place (' + t0[0] + ' to ' + n1.things[0] + ')');
    z = await until(() => zoom(X.page), 3000);
    const nm1 = await nameAt(X.page, R1, 0);
    check(!!z && z.eye.startsWith(R1.room + ' · 1 of 4') && !!nm1 && z.name === nm1, 'the zoom card stays open on the thing now in that place (' + (z && z.name) + ')');
    await shot(X.page, 'rk15-desk-1366-paper-zoom-after-swap');
    check(n1.say.includes(spoken(nm1)), 'the read-aloud names what is there now');
    await X.page.keyboard.press('Escape'); await sleep(200);
    /* a second page on the same state, then a reload */
    await focusPage(Y.page);
    check(!!(await until(async () => { const c = mine(await cards(Y.page), R1); return !!c && c.things[0] === n1.things[0]; }, 20000, 500)), 'a second device (another page on the same state) shows the swapped card');
    await Y.c.close(); await X.c.close();
    const Z1 = await open({}); await Z1.page.waitForSelector('#gm-runv .rr-site [data-rr-say]', { timeout: 20000 });
    const z1 = mine(await cards(Z1.page), R1);
    check(z1.things.join() === n1.things.join() && z1.slots.join() === R1.slots.join() && z1.say === n1.say, 'a swap survives a reload: the same things, the same read-aloud, the same people');
    page = Z1.page;

    /* Roll another */
    await page.click(card(R1.room, R1.n) + ' [data-rr-act="another"]');
    const ex1 = await until(async () => { const r = await stored(); return r[rkey] && r[rkey].extra && Object.keys(r[rkey].extra).length === 1 ? r : null; }, 15000);
    const n2 = mine(await cards(page), R1), exSlug = ex1 ? Object.keys(ex1[rkey].extra)[0] : '?';
    check(!!ex1 && n2.things.length === 5 && n2.things[4] === exSlug && n2.keys === '12345' && n2.things.slice(0, 4).join() === n1.things.join() && Object.keys(ex1[rkey].swaps).join() === t0[0],
      'Roll another adds a fifth thing at the end, stored as one extra under the room\'s key, and keeps the swap (' + exSlug + ')');
    check(n2.say.includes(spoken(await nameAt(page, R1, 4))) && /^SAY “.+ There['’]s .+ and .+\.”$/.test(n2.say), 'the read-aloud names the new thing');
    /* Swap on the thing Roll another added: it is replaced in the extra list, and shows */
    await page.click(card(R1.room, R1.n) + ' [data-site="thing"][data-i="4"]'); await until(() => zoom(page), 4000);
    await page.click('.rk-zoom [data-rk-btn="swap"]');
    const ex2 = await until(async () => { const r = await stored(); const e = r[rkey] && r[rkey].extra ? Object.keys(r[rkey].extra) : []; return e.length === 1 && e[0] !== exSlug ? r : null; }, 15000);
    const n3 = mine(await cards(page), R1);
    check(!!ex2 && n3.things.length === 5 && n3.things[4] === Object.keys(ex2[rkey].extra)[0] && Object.keys(ex2[rkey].swaps).sort().join() === [t0[0], exSlug].sort().join() && ex2[rkey].swaps[exSlug] === n3.things[4], 'Swap on a thing Roll another added replaces it in the extra list (and shows), and records it as swapped away, leaving the first swap alone');
    await page.keyboard.press('Escape'); await sleep(200);
    await page.click(card(R1.room, R1.n) + ' [data-rr-act="another"]');      /* the review: Roll another must not bring the swapped-away thing back */
    await until(async () => { const r = await stored(); return r[rkey] && r[rkey].extra && Object.keys(r[rkey].extra).length === 2 ? r : null; }, 15000);
    check(!mine(await cards(page), R1).things.includes(exSlug) && mine(await cards(page), R1).things.length === 6, 'and Roll another does not bring the swapped-away thing back (' + exSlug + ')');

    /* Reroll the room: marked, it asks; Cancel leaves it; the second tap does it */
    await page.click(card(R1.room, R1.n) + ' [data-site="thing"][data-i="1"]'); await until(() => zoom(page), 4000);
    const mark = await page.evaluate(() => { const b = document.querySelector('.rk-zoom [data-rk-slot="state"] button'); return b ? { id: b.getAttribute('data-rk-btn') } : null; });
    await page.click('.rk-zoom [data-rk-btn="' + mark.id + '"]');
    await until(async () => { const r = await stored(); return r[rkey] && r[rkey].marks && Object.keys(r[rkey].marks).length === 1 ? r : null; }, 15000);
    await page.keyboard.press('Escape'); await sleep(200);
    const before3 = JSON.stringify((await stored())[rkey]);
    await page.click(card(R1.room, R1.n) + ' [data-rr-act="reroll"]'); await sleep(500);
    const ask = mine(await acts(page), R1), focusOn = await page.evaluate(() => document.activeElement.getAttribute('data-rr-act') || '');
    check(ask.btns.join('/') === 'Reroll the room/Cancel' && ask.ask === 'Rerolling clears 1 mark.' && JSON.stringify((await stored())[rkey]) === before3 && focusOn === 'reroll-yes',
      'a marked room asks first: "Rerolling clears 1 mark." on its own line, then Reroll the room and Cancel, nothing written, the focus on the confirm (' + JSON.stringify(ask) + ', focus ' + focusOn + ')');
    await shot(page, 'rk15-desk-1366-paper-reroll-ask');
    await page.click(card(R1.room, R1.n) + ' [data-rr-act="reroll-no"]'); await sleep(500);
    check(mine(await acts(page), R1).btns.join('/') === 'Roll another/Reroll the room' && JSON.stringify((await stored())[rkey]) === before3, 'Cancel leaves the room as it was');
    await page.click(card(R1.room, R1.n) + ' [data-rr-act="reroll"]'); await sleep(400);
    await page.click(card(R1.room, R1.n) + ' [data-rr-act="reroll-yes"]');
    const rr1 = await until(async () => { const r = await stored(); return r[rkey] && r[rkey].rr === 1 ? r : null; }, 15000);
    const n4 = mine(await cards(page), R1);
    check(!!rr1 && !rr1[rkey].marks && !rr1[rkey].extra && !rr1[rkey].swaps && n4.things.length === 4 && (n4.things.join() !== t0.join() || n4.say !== R1.say), 'the second tap rerolls: rr is 1, the mark, the extra and the swap are gone, and the room is drawn again (' + n4.things.join() + ' / ' + t0.join() + ')');
    check(n4.slots.join() === R1.slots.join(), 'Reroll the room never moves the people (' + n4.slots.join() + ')');
    await shot(page, 'rk15-desk-1366-paper-after-reroll');
    /* nothing marked: at once */
    await page.click(card(R2.room, R2.n) + ' [data-rr-act="reroll"]');
    const rr2 = await until(async () => { const r = await stored(); return r[rkey2] && r[rkey2].rr === 1 ? r : null; }, 15000);
    check(!!rr2 && !mine(await acts(page), R2).ask, 'a room with no marks rerolls at once, with no question (' + R2.room + ')');
    check(Object.keys(await stored()).every((k) => [rkey, rkey2].includes(k)), 'only those two rooms\' keys hold anything');

    /* secrecy: the GETs and a phone's DOM hold nothing of a swap, a roll another or a reroll */
    const r7 = await reads();
    check(r7.ok && leaks(r7.all).length === 0 && !/rr-act|room-swap|"roomstate"/.test(r7.all), 'secrecy: the display\'s GET, a phone\'s screen and character and the campaign document hold no rolled-room text, no swap and no roomstate (' + leaks(r7.all).slice(0, 3).join(' | ') + ')');
    {
      const ph = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': P1 }, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const pp = await ph.newPage(); await pp.goto(BASE + '/#c/pc-nell'); await pp.waitForTimeout(4000);
      const dom = await pp.evaluate(() => document.documentElement.outerHTML);
      check(dom.length > 2000 && leaks(dom).length === 0 && !/rr-act|rr-site|data-rr-/.test(dom), 'a phone\'s DOM holds no rolled-room text, no Swap and no Roll another');
      await ph.close();
    }
    await Z1.c.close();

    /* the kit desk: the same two buttons, Swap in the zoom card */
    await feats({ 'kit.desk': true });
    const K = await open({ kit: true });
    await K.page.waitForSelector('#gm-runv .rr-site .krv-acts', { timeout: 20000 });
    const ka = await acts(K.page), kb = tab[2], kkey = await keyOf(K.page, kb);
    check(tab.every((c) => mine(ka, c).btns.join('/') === 'Roll another/Reroll the room') && await K.page.evaluate(() => !document.querySelector('#gm-runv .rr-acts .rv-btn')), 'the kit desk: the same two buttons on every tabled room, in the kit\'s button style');
    const gaps = await K.page.evaluate(() => [...document.querySelectorAll('#gm-runv .krv-acts')].map((g) => { const [x, y] = [...g.querySelectorAll('button')].map((b) => b.getBoundingClientRect()); return y ? Math.round(Math.max(y.left - x.right, y.top - x.bottom)) : -1; }));
    check(gaps.length >= 4 && gaps.every((g) => g >= 6), 'the kit desk: the two buttons have a gap of at least 6 px, side by side or stacked (' + gaps.join(',') + ')');
    await K.page.evaluate(() => { const g = document.querySelector('#gm-runv .krv-acts'); if (g) g.scrollIntoView({ block: 'center' }); }); await sleep(300);
    await shot(K.page, 'rk15-kitdesk-1366-paper-acts-gap');
    await K.page.click(card(kb.room, kb.n) + ' [data-site="thing"][data-i="0"]'); z = await until(() => zoom(K.page), 4000);
    check(!!z && /^swap:Swap$/.test(z.slots[2] || ''), 'the kit desk: the zoom card has Swap too');
    await shot(K.page, 'rk15-kitdesk-1366-paper-zoom-swap');
    await K.page.click('.rk-zoom [data-rk-btn="swap"]');
    check(!!(await until(async () => { const r = await stored(); return r[kkey] && r[kkey].swaps ? r : null; }, 15000)), 'the kit desk: Swap stores its override');
    await K.page.keyboard.press('Escape'); await sleep(200);
    await shot(K.page, 'rk15-kitdesk-1366-paper-cards');
    await K.c.close();

    /* pictures */
    if (SHOTS) {
      for (const [kit, w, theme] of [[false, 1366, 'night'], [false, 1536, 'paper'], [false, 1536, 'night'], [true, 1366, 'night'], [true, 1536, 'paper'], [true, 1536, 'night']]) {
        await feats({ 'kit.desk': kit });
        const o = await open({ kit, w, h: w === 1536 ? 864 : 768, theme });
        await o.page.waitForSelector('#gm-runv .rr-site [data-site="thing"]', { timeout: 20000 });
        await o.page.click(card(R1.room, R1.n) + ' [data-site="thing"][data-i="0"]'); await until(() => zoom(o.page), 3000);
        await shot(o.page, 'rk15-' + (kit ? 'kitdesk-' : 'desk-') + w + '-' + theme + '-zoom-swap');
        await o.page.keyboard.press('Escape'); await sleep(200);
        await o.page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: 'center' }), card(R1.room, R1.n));
        await shot(o.page, 'rk15-' + (kit ? 'kitdesk-' : 'desk-') + w + '-' + theme + '-cards');
        await o.c.close();
      }
      const ip = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1024, height: 768 }, serviceWorkers: 'block' });
      const dp = await ip.newPage(); await dp.addInitScript({ content: 'window.__B68_POLL_MS = 1000;' }); await dp.goto(BASE + '/#display'); await dp.waitForTimeout(3500);
      await dp.screenshot({ path: path.join(SHOTS, 'rk15-ipad-1024.png') }); await ip.close();
      const ph = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': P1 }, viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      const pp = await ph.newPage(); await pp.goto(BASE + '/#c/pc-nell'); await pp.waitForTimeout(3500);
      await pp.screenshot({ path: path.join(SHOTS, 'rk15-phone-390.png') }); await ph.close();
    }

    /* room.tables alone (room.key off): the same buttons, and Swap writes through the page's room-state writer, as the marks do (the overseer's RK14 ruling) */
    await feats({ 'kit.desk': false, 'room.tables': true, 'room.key': false });
    const A1 = await open({}); await A1.page.waitForSelector('#gm-runv .rr-site [data-rr-act]', { timeout: 20000 });
    const R3 = tab[3], rkey3 = await keyOf(A1.page, R3), t3 = mine(await cards(A1.page), R3).things.slice();
    await A1.page.click(card(R3.room, R3.n) + ' [data-site="thing"][data-i="2"]'); z = await until(() => zoom(A1.page), 4000);
    check(!!z && /^swap:Swap$/.test(z.slots[2] || '') && await A1.page.evaluate(() => window.B68GmPage._roomZoom() === null), 'room.tables alone: the zoom card has Swap, and RK09\'s own card is off');
    await A1.page.click('.rk-zoom [data-rk-btn="swap"]');
    const sw3 = await until(async () => { const r = await stored(); return r[rkey3] && r[rkey3].swaps && Object.keys(r[rkey3].swaps).join() === t3[2] ? r : null; }, 15000);
    check(!!sw3 && mine(await cards(A1.page), R3).things[2] === sw3[rkey3].swaps[t3[2]], 'room.tables alone: Swap stores its override and the card shows it');
    await A1.page.keyboard.press('Escape'); await A1.page.click(card(R3.room, R3.n) + ' [data-rr-act="another"]');
    check(!!(await until(async () => { const r = await stored(); return r[rkey3] && r[rkey3].extra && Object.keys(r[rkey3].extra).length === 1 ? r : null; }, 15000)), 'room.tables alone: Roll another works');
    await A1.c.close();
    await feats({ 'room.key': true });

    /* the authored v2 night: its Showroom card (the Run view's own, parts from block()) has the same two buttons, and what they store is keyed by the authored site ('a:' + its name) */
    check((await api('PATCH', '/gm/state', { cards: { location: Object.assign({}, SITE_CARD, { seed: null, ui: null, mem: null }) } })).status === 200, 'RK15: the night\'s authored v2 site is the Location card');
    await feats({ 'room.tables': true, 'room.key': true });
    const V = await open({ v2: true }), sh = '#gm-runv .rv-rm[data-room="Showroom"]';
    await V.page.waitForSelector(sh + ' [data-rr-act]', { timeout: 20000 });
    const vb = await V.page.evaluate((sel) => [...document.querySelectorAll(sel + ' [data-rr-act]')].map((b) => (b.querySelector('.ui-label') || b).textContent).join('/'), sh);
    check(vb === 'Roll another/Reroll the room', 'the authored v2 night\'s Showroom card has Roll another and Reroll the room too (' + vb + ')');
    await V.page.evaluate((sel) => { const b = document.querySelector(sel + ' [data-rr-act]'); if (b) b.scrollIntoView({ block: 'center' }); }, sh); await sleep(300);
    await shot(V.page, 'rk15-desk-1366-paper-v2-card');
    const things0 = await V.page.evaluate((sel) => document.querySelectorAll(sel + ' [data-site="thing"]').length, sh);
    await V.page.click(sh + ' [data-rr-act="another"]');
    const keyA = await until(async () => { const k = (await api('GET', '/gm/state')).json.doc.roomstate; const ks = Object.keys((k && k.keys) || {}).filter((x) => /^a:/.test(x)); const r = ks[0] && k.keys[ks[0]].rooms['showroom#1']; return r && r.extra && Object.keys(r.extra).length === 1 ? ks[0] : null; }, 15000);
    check(things0 >= 3 && !!keyA && await V.page.evaluate(([sel, n]) => document.querySelectorAll(sel + ' [data-site="thing"]').length === n + 1, [sh, things0]), 'Roll another on it adds one more thing (' + things0 + ' to ' + (things0 + 1) + '), stored under the authored site\'s own key (' + keyA + ')');
    await V.page.click(sh + ' [data-site="thing"][data-i="' + things0 + '"]'); z = await until(() => zoom(V.page), 4000);
    check(!!z && /^swap:Swap$/.test(z.slots[2] || ''), 'and the new thing\'s zoom card has Swap');
    await V.page.keyboard.press('Escape'); await V.c.close();
    if (SHOTS) {      /* the kit desk's Run view (the one-room inspector draws the same parts for the selected room) */
      await feats({ 'kit.desk': true });
      const VK = await open({ kit: true, v2: true });
      await VK.page.evaluate((sel) => { const b = document.querySelector(sel + ' [data-rr-act]') || document.querySelector('#gm-runv [data-rr-act]'); if (b) b.scrollIntoView({ block: 'center' }); }, sh); await sleep(300);
      await shot(VK.page, 'rk15-kitdesk-1366-paper-v2-card'); await VK.c.close(); await feats({ 'kit.desk': false });
    }
    check(!!(ROLLED_CARD && ROLLED_CARD.seed) && (await api('PATCH', '/gm/state', { cards: { location: Object.assign({}, ROLLED_CARD, { auth: null }) } })).status === 200, 'step 2\'s rolled site is the Location card again');

    /* room.tables off on the live page: the buttons go with the rolled instance */
    await feats({ 'kit.desk': false, 'room.tables': true });
    const L = await open({});
    await L.page.waitForSelector('#gm-runv .rr-site [data-rr-act]', { timeout: 20000 });
    await feats({ 'room.tables': false });
    await focusPage(L.page);
    check(!!(await until(() => L.page.evaluate(() => !document.querySelector('[data-rr-act]') && window.B68GmPage._roomRolled() === null), 20000, 500)), 'room.tables off on a live page: Roll another and Reroll the room go with the rolled cards');
    await L.c.close();
  }
  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
} finally {
  if (browser) await browser.close().catch(() => {});
  await feats({ 'room.tables': false, 'room.key': false, 'kit.desk': false }).catch(() => {});
  clearTimeout(timeout); killDemo();
}
console.log(failed ? 'FAIL room-tables: ' + failed + ' failed' : 'PASS room-tables: all passed');
process.exit(failed ? 1 : 0);
