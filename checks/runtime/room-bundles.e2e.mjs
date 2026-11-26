// room-bundles (RK01, extended by RK30): with every room key setting off, the GM page and a phone request no room key file; each setting turned on from the Settings fetches
// exactly its own bundle (room.tables also room-key, room.key also kit-ui, night.flow also prep-actions); a phone fetches sheet/ability-find.js only while
// phone.find is on; a fresh GM page with only room.key on fetches room-key's files only. Runs the demo night (invented data), no model, no network beyond loopback.
// RK30 added the two later settings: room.intro (one bundle, asked for by the GM page and by the iPad's display page from its poll's features) and phone.glance
// (a phone's, through boot.js). Each page fetches only its own bundle, and a page whose setting is off fetches none of its files.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9507] node checks/runtime/room-bundles.e2e.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
if (!process.env.PW_MODULE) { console.log('SKIP room-bundles: PW_MODULE is not set (the demo night needs Playwright)'); process.exit(0); }
const { startDemo } = await import(pathToFileURL(path.join(ROOT, 'scripts', 'kit-fingerprint.mjs')).href);
const require = createRequire(import.meta.url);
const pw = require(process.env.PW_MODULE);
const PORT = Number(process.env.PORT || 9507);
const BUNDLES = {
  'night.flow': ['gm/night-ticks.js', 'gm/blade-chips.js', 'gm/threat-room.js', 'gm/public-lines.js'],
  'close.crew': ['gm/close-crew.js'],
  'room.key': ['gm/room-key.css', 'gm/room-things.js', 'gm/room-state.js', 'gm/room-zoom.js', 'gm/room-show.js', 'gm/room-mark.js'],
  'room.tables': ['gm/room-tables.js', 'gm/room-roll.js', 'gm/room-rolled.js', 'gm/room-swap.js', 'gm/room-blade.js', 'gm/room-people.js', 'gm/room-keep.js'],
  'gm.glance': ['gm/glance.css', 'gm/glance-crew.js', 'gm/glance-now.js', 'gm/quick-rules.js', 'gm/loud.js', 'gm/npc-find.js'],
  'phone.find': ['sheet/ability-find.js'],
  'map.fit': ['gm/map-fit.js', 'gm/svg-slim.js'],
  'room.intro': ['display/room-intro.css', 'gm/room-intro.js', 'display/room-intro.js'],
  'phone.glance': ['sheet/glance.css', 'sheet/page.css', 'sheet/glance.js', 'sheet/page.js'],
};
const ALL = Object.values(BUNDLES).flat();
let failed = 0;
const check = (ok, name) => { if (ok) console.log('PASS ' + name); else { failed++; console.log('FAIL ' + name); } };
const demo = await startDemo(ROOT, PORT);
try {
  const browser = await pw.chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
  const mine = (urls) => ALL.filter((f) => urls.some((u) => u.split('?')[0].endsWith('/' + f)));
  /* RK01b: three rows are not built yet and not drawn (built: false in app/gm/settings.js). To drive their bundles from the Settings, the GM page of this test is served settings.js
     without the flag; the Settings list itself is checked first, as shipped */
  const unhide = async (ctx) => ctx.route('**/gm/settings.js*', async (route) => { const r = await route.fetch(); const body = (await r.text()).replace(/built: false, /g, ''); await route.fulfill({ response: r, body }); });
  async function open(route, user, size, o = {}) {
    const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, extraHTTPHeaders: { 'X-Dev-User': user }, ...((o.noSw || o.unhide) ? { serviceWorkers: 'block' } : {}) });
    if (o.unhide) await unhide(ctx);
    const page = await ctx.newPage(); const urls = [];
    page.on('request', (r) => urls.push(r.url()));
    await page.goto(demo.base + '/' + route);
    return { ctx, page, urls };
  }
  const G = await open('#gm', 'gm@example.test', [1366, 768], { noSw: true });
  await G.page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
  await G.page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
  await G.page.waitForTimeout(2500);
  check(mine(G.urls).length === 0, 'all ten off: no room key file requested by the GM page (' + G.urls.length + ' requests)');
  await G.page.click('.gm-tray [data-tray="open"]');
  await G.page.waitForSelector('#gm-ipad-settings [data-set-row]', { timeout: 10000 });
  const rows = await G.page.$$eval('#gm-ipad-settings [data-set-row]', (els) => els.map((e) => e.getAttribute('data-set-row')));
  check(rows.slice(-9).join() === 'stamp.brief,night.flow,close.crew,room.key,gm.glance,phone.find,map.fit,room.intro,phone.glance' && rows.length === 26, 'the Settings list as shipped: 26 rows, the nine of this deploy last (gm.glance and phone.find now built): ' + rows.slice(-10).join(' '));
  /* RK35 follow-up: gm.glance and phone.find are drawn now; room.tables (built: false) is the one row not drawn. All three still read off. */
  check(!rows.includes('room.tables') && rows.includes('gm.glance') && rows.includes('phone.find'), 'room.tables is not drawn, the other two are');
  const feats = await G.page.evaluate(() => fetch('/api/gm/state', { credentials: 'same-origin', cache: 'no-store' }).then((r) => r.json()).then((j) => (j.doc || j).features || {}));
  const offPressed = await G.page.$$eval('#gm-ipad-settings [data-set="gm.glance"][data-v="0"], #gm-ipad-settings [data-set="phone.find"][data-v="0"]', (els) => els.map((e) => e.getAttribute('aria-pressed')));
  check(['room.tables', 'gm.glance', 'phone.find'].every((id) => feats[id] !== true) && offPressed.length === 2 && offPressed.every((v) => v === 'true'), 'all three still read off (the two drawn show Off pressed; the state holds none on)');
  await unhide(G.ctx); await G.page.reload();
  await G.page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 }); await G.page.waitForTimeout(2500);
  await G.page.click('.gm-tray [data-tray="open"]');
  await G.page.waitForSelector('#gm-ipad-settings [data-set-row]', { timeout: 10000 });
  const all = await G.page.$$eval('#gm-ipad-settings [data-set-row]', (els) => els.map((e) => e.getAttribute('data-set-row')));
  check(all.slice(-10).join() === 'stamp.brief,night.flow,close.crew,room.key,room.tables,gm.glance,phone.find,map.fit,room.intro,phone.glance' && all.length === 27, 'with the flag taken off in the served file (the test, not the app): 27 rows, so the rest of this test can drive every bundle');
  let seen = new Set(mine(G.urls));
  for (const id of ['stamp.brief', 'night.flow', 'close.crew', 'room.key', 'room.tables', 'gm.glance', 'map.fit']) {
    await G.page.click('#gm-ipad-settings [data-set="' + id + '"][data-v="1"]');
    await G.page.waitForTimeout(1500);
    const now = new Set(mine(G.urls)), fresh = [...now].filter((f) => !seen.has(f));
    const want = (BUNDLES[id] || []).filter((f) => !seen.has(f)).concat(id === 'room.tables' ? [] : []);
    const wantAll = id === 'room.tables' ? BUNDLES['room.tables'].concat(BUNDLES['room.key']).filter((f) => !seen.has(f)) : want;
    check(fresh.sort().join() === wantAll.sort().join(), id + ' on: the new room key files are ' + (fresh.join(' ') || '(none)') + (id === 'stamp.brief' ? ' (no file, by design)' : ''));
    seen = now;
  }
  const kitUi = G.urls.some((u) => /\/ui\/ui\.js/.test(u)), prepAct = G.urls.some((u) => /prep-actions\.js/.test(u));
  check(kitUi && prepAct, 'room.key brought kit-ui and night.flow brought prep-actions (DEPS)');
  // the phone
  const P = await open('#c/pc-nell', 'player1@example.test', [390, 844]);
  await P.page.waitForTimeout(3500);
  check(mine(P.urls).length === 0, 'a phone with phone.find off requests no room key file');
  await G.page.click('#gm-ipad-settings [data-set="phone.find"][data-v="1"]');
  await G.page.waitForTimeout(8000);
  await P.page.reload(); await P.page.waitForTimeout(4000);
  check(mine(P.urls).includes('sheet/ability-find.js') && mine(P.urls).length === 1, 'phone.find on: the phone fetches sheet/ability-find.js and no other room key file: ' + mine(P.urls).join(' '));
  // RK30: the iPad's display page. With room.intro off it asks for none of the room key files. Then the GM turns it on: the open page picks it up from its poll, and a fresh one asks at once
  const IPAD = 'table.ipad@example.test';
  const D = await open('#display', IPAD, [1180, 820], { noSw: true });
  await D.page.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 30000 });
  await D.page.waitForTimeout(3500);
  check(mine(D.urls).length === 0, 'the display with room.intro off requests no room key file (' + D.urls.length + ' requests): ' + mine(D.urls).join(' '));
  seen = new Set(mine(G.urls));
  await G.page.click('#gm-ipad-settings [data-set="room.intro"][data-v="1"]');
  await G.page.waitForTimeout(1500);
  const gfresh = mine(G.urls).filter((f) => !seen.has(f));
  check(gfresh.sort().join() === BUNDLES['room.intro'].slice().sort().join(), 'room.intro on: the GM page fetches the room-intro bundle and nothing else: ' + gfresh.join(' '));
  await D.page.waitForTimeout(9000);
  check(mine(D.urls).sort().join() === BUNDLES['room.intro'].slice().sort().join(), 'room.intro on: the open display page picks it up from its poll and fetches the room-intro bundle only: ' + mine(D.urls).join(' '));
  const D2 = await open('#display', IPAD, [1180, 820], { noSw: true });
  await D2.page.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 30000 });
  await D2.page.waitForTimeout(5000);
  check(mine(D2.urls).sort().join() === BUNDLES['room.intro'].slice().sort().join(), 'a fresh display page with room.intro on fetches the room-intro bundle only: ' + mine(D2.urls).join(' '));
  await P.page.reload(); await P.page.waitForTimeout(4000);
  check(!mine(P.urls).some((f) => BUNDLES['room.intro'].includes(f)), 'a phone, with room.intro on, fetches none of its files');
  // RK30: a phone and phone.glance
  check(!mine(P.urls).some((f) => BUNDLES['phone.glance'].includes(f)), 'a phone with phone.glance off requests no phone-glance file');
  await G.page.click('#gm-ipad-settings [data-set="phone.glance"][data-v="1"]');
  await G.page.waitForTimeout(8000);
  await P.page.reload(); await P.page.waitForTimeout(4000);
  const pnow = mine(P.urls);
  check(BUNDLES['phone.glance'].every((f) => pnow.includes(f)) && pnow.every((f) => BUNDLES['phone.glance'].includes(f) || BUNDLES['phone.find'].includes(f)), 'phone.glance on: the phone fetches the phone-glance bundle (and the ability search, which is also on) and no room-intro file: ' + pnow.join(' '));
  check(!mine(G.urls).some((f) => BUNDLES['phone.glance'].includes(f)) && !mine(D2.urls).some((f) => BUNDLES['phone.glance'].includes(f)), 'neither the GM page nor the display page fetches a phone-glance file');
  // off again: a reload of the GM page with all but room.key off asks only for that
  for (const id of ['stamp.brief', 'night.flow', 'close.crew', 'room.tables', 'gm.glance', 'phone.find', 'map.fit', 'room.intro', 'phone.glance']) await G.page.click('#gm-ipad-settings [data-set="' + id + '"][data-v="0"]');
  await G.page.waitForTimeout(1500);
  const G2 = await open('#gm', 'gm@example.test', [1366, 768], { unhide: true });
  await G2.page.waitForTimeout(6000);
  check(mine(G2.urls).sort().join() === BUNDLES['room.key'].slice().sort().join(), 'a fresh GM page with only room.key on fetches room-key\'s files only: ' + mine(G2.urls).join(' '));
  await browser.close();
} finally { await demo.stop(); }
console.log(failed ? failed + ' FAILED' : 'ALL PASSED');
process.exit(failed ? 1 : 0);
