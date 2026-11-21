// room-bundles (RK01): with every room key setting off, the GM page and a phone request no room key file; each setting turned on from the Settings fetches
// exactly its own bundle (room.tables also room-key, room.key also kit-ui, night.flow also prep-actions); a phone fetches sheet/ability-find.js only while
// phone.find is on; a fresh GM page with only room.key on fetches room-key's files only. Runs the demo night (invented data), no model, no network beyond loopback.
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
};
const ALL = Object.values(BUNDLES).flat();
let failed = 0;
const check = (ok, name) => { if (ok) console.log('PASS ' + name); else { failed++; console.log('FAIL ' + name); } };
const demo = await startDemo(ROOT, PORT);
try {
  const browser = await pw.chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
  const mine = (urls) => ALL.filter((f) => urls.some((u) => u.split('?')[0].endsWith('/' + f)));
  async function open(route, user, size) {
    const ctx = await browser.newContext({ viewport: { width: size[0], height: size[1] }, extraHTTPHeaders: { 'X-Dev-User': user } });
    const page = await ctx.newPage(); const urls = [];
    page.on('request', (r) => urls.push(r.url()));
    await page.goto(demo.base + '/' + route);
    return { ctx, page, urls };
  }
  const G = await open('#gm', 'gm@example.test', [1366, 768]);
  await G.page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
  await G.page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
  await G.page.waitForTimeout(2500);
  check(mine(G.urls).length === 0, 'all eight off: no room key file requested by the GM page (' + G.urls.length + ' requests)');
  await G.page.click('.gm-tray [data-tray="open"]');
  await G.page.waitForSelector('#gm-ipad-settings [data-set-row]', { timeout: 10000 });
  const rows = await G.page.$$eval('#gm-ipad-settings [data-set-row]', (els) => els.map((e) => e.getAttribute('data-set-row')));
  check(rows.slice(-8).join() === 'stamp.brief,night.flow,close.crew,room.key,room.tables,gm.glance,phone.find,map.fit' && rows.length === 25, 'the Settings list: 25 rows, the eight last: ' + rows.slice(-9).join(' '));
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
  // off again: a reload of the GM page with all but room.key off asks only for that
  for (const id of ['stamp.brief', 'night.flow', 'close.crew', 'room.tables', 'gm.glance', 'phone.find', 'map.fit']) await G.page.click('#gm-ipad-settings [data-set="' + id + '"][data-v="0"]');
  await G.page.waitForTimeout(1500);
  const G2 = await open('#gm', 'gm@example.test', [1366, 768]);
  await G2.page.waitForTimeout(6000);
  check(mine(G2.urls).sort().join() === BUNDLES['room.key'].slice().sort().join(), 'a fresh GM page with only room.key on fetches room-key\'s files only: ' + mine(G2.urls).join(' '));
  await browser.close();
} finally { await demo.stop(); }
console.log(failed ? failed + ' FAILED' : 'ALL PASSED');
process.exit(failed ? 1 : 0);
