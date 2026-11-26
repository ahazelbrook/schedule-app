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
  async function open({ w = 1366, h = 768, theme = 'paper', kit = false, tables = true, v2 = false } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w, height: h }, serviceWorkers: 'block' });
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
    check(tab.length >= 3 && tab.every((c) => mine(a0, c).btns.join('/') === 'Roll another/Reroll the room') && a0.filter((c) => !tab.some((t) => t.room === c.room && t.n === c.n)).every((c) => !c.btns.length),
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
    check(!!ex2 && n3.things.length === 5 && n3.things[4] === Object.keys(ex2[rkey].extra)[0] && Object.keys(ex2[rkey].swaps).join() === t0[0], 'Swap on a thing Roll another added replaces it in the extra list (and shows), leaving the first swap alone');
    await page.keyboard.press('Escape'); await sleep(200);

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
