// players-board (IP6 of the players' screen build, setting stage.players): the planning board's pins end to end, on the real GM page and the real
// display page signed in as the table's display login, against the demo night (scripts/demo-night.mjs: the invented Pelican Rooms, Ada Vell and
// Mabel Quist revealed, GM-ONLY- people hidden) on PORT (default 12260; the inspector on PORT + 20000).
//   on   the Location view has the Board block; Board on the iPad pins the board scene and blanks what covers it; a line pinned to a room the players
//        know: the stored board and the scene show the card's words and one more red string, and the card arrives large then settles; a face
//        (a revealed NPC) goes up with ids of its own; a pin whose room's band is taken back waits (nothing of it on the iPad), and comes up by
//        itself when the band is revealed again; a hidden NPC named in a pin's words is refused with a toast and never stored; remove: it goes;
//        held still (reduced motion), a new pin is simply there; no GM-ONLY- text in the display GET or either DOM
//   off  no Board block, and Set as score scene stores today's board (no pin card in it)
// PW_DISPLAY_ENGINE=webkit runs the display page in WebKit (the GM page stays on Edge). KIT_SHOTS=<dir> saves the pictures.
//   PW_MODULE=<path to playwright-core> [PW_CHANNEL=msedge] [PORT=12260] [KIT_SHOTS=<dir>] node checks/runtime/players-board.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 12260);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const SHOTS = process.env.KIT_SHOTS || '';
const PW = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const ENGINE = process.env.PW_DISPLAY_ENGINE === 'webkit' ? 'webkit' : 'chromium';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const HIDDEN = 'GM-ONLY-Silent Partner';

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 150) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j, text: t }; });
const players = async (on) => { for (const p of ['/gm/state', '/campaign']) await api('PATCH', p, { features: { 'stage.players': on } }); };
const score = async () => { const d = (await api('GET', '/gm/ambient')).json; return d && d.doc && d.doc.score ? d.doc.score : null; };
const displayGet = async () => (await api('GET', '/gm/display?seq=-1&aseq=-1&hseq=-1', undefined, IPAD)).text;
const strings = (svg) => (String(svg).match(/stroke="#a51d16"/g) || []).length;

if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const demo = spawn(process.execPath, [path.join(ROOT, 'scripts', 'demo-night.mjs'), '--port', String(PORT)], { cwd: ROOT, env: { ...process.env, B68_ANTHROPIC_KEY: '', ANTHROPIC_API_KEY: '' }, detached: !WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let demoOut = '';
demo.stdout.on('data', (d) => { demoOut += d; }); demo.stderr.on('data', (d) => { demoOut += d; });
function killDemo() { if (WIN) spawnSync('taskkill', ['/pid', String(demo.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-demo.pid, 'SIGKILL'); } catch (_) {} } }
process.on('exit', killDemo);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + demoOut.slice(-1500)); process.exit(1); }, 480000);

let browser = null, dbrowser = null;
try {
  if (!(await until(() => /The demo night is up/.test(demoOut), 240000, 500))) throw new Error('the demo night did not start:\n' + demoOut.slice(-1500));
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
  browser = await PW.chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  dbrowser = ENGINE === 'webkit' ? await PW.webkit.launch() : browser;
  console.log('INFO the display runs in ' + ENGINE);
  const errors = [], asked = [];
  await api('PATCH', '/gm/ambient', { mode: 'pin', scene: 'duskwall', overlay: null, score: null });
  await api('PUT', '/gm/display', { kind: 'blank' });
  await players(true);

  /* the GM laptop: the Location view (B), in the Score place */
  const gc = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
  await gc.addInitScript(atPlace('score'));
  await gc.addInitScript(() => { window.__B68_POLL_MS = 700; });
  const gp = await gc.newPage();
  gp.on('pageerror', (e) => errors.push('gm: ' + e.message));
  gp.on('dialog', (d) => { asked.push(d.message()); d.accept(); });
  const openGm = async () => {
    if (/#gm$/.test(gp.url())) await gp.reload(); else await gp.goto(BASE + '/#gm');      /* a second open is a reload (a goto to the same #gm would not load the page again) */
    await gp.waitForFunction(() => window.B68GmPage && window.B68GmPage._state && window.B68GmPage._state().locRoll, null, { timeout: 40000 });
    await gp.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await gp.keyboard.press('b');
    await gp.waitForSelector('#gm-loc .gm-loccard', { timeout: 15000 });
  };
  await openGm();
  check(await gp.waitForSelector('[data-pb-slot] .gm-pboard', { timeout: 10000 }).then(() => true, () => false), 'on: the Location view has the Board block');
  const offered = await gp.$$eval('[data-pb="room"] option', (o) => o.map((x) => x.value));
  const rooms = await gp.evaluate(() => window.B68GmPage._state().locRoll.rooms.map((r) => ({ name: r.name, band: r.band })));
  const pub = rooms.filter((r) => r.band === 'public').map((r) => r.name), work = rooms.filter((r) => r.band === 'working').map((r) => r.name);
  check(offered.length === pub.length && offered.every((n) => pub.includes(n)), 'the Room list holds only the rooms the players know (' + offered.join(', ') + ')');
  const toastErr = () => gp.evaluate(() => (document.getElementById('toastErr') || {}).textContent || '');
  const pinIt = async (room, kind, text) => {
    await gp.selectOption('[data-pb="kind"]', kind);
    if (kind === 'face') { await gp.waitForSelector('[data-pb="npc"]'); await gp.selectOption('[data-pb="npc"]', { label: text }); await gp.selectOption('[data-pb="room"]', room); await gp.click('[data-pb="pin"]'); }
    else { await gp.selectOption('[data-pb="room"]', room); await gp.fill('[data-pb="text"]', text); await gp.press('[data-pb="text"]', 'Enter'); }
  };

  /* the iPad: the display page, signed in as the table's display login */
  const dc = await dbrowser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block' });
  const dp = await dc.newPage();
  dp.on('pageerror', (e) => errors.push('display: ' + e.message));
  await dp.goto(BASE + '/#display');
  await dp.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 30000 });
  await api('PUT', '/gm/display', { kind: 'dark' });
  await until(async () => /"kind":"dark"/.test(await displayGet()), 8000);
  await sleep(1500);      /* the GM page's poll learns the iPad is dark */
  const frame = () => dp.frames().find((f) => /planning-board/.test(f.url()) && !f.isDetached());
  const board = async () => { const f = frame(); if (!f) return null; try { return await f.evaluate(() => ({ strings: document.querySelectorAll('.string').length, drawn: [...document.querySelectorAll('.string')].filter((s) => getComputedStyle(s).strokeDashoffset === '0' || getComputedStyle(s).strokeDashoffset === '0px').length, text: [...document.querySelectorAll('text, title')].map((t) => t.textContent).join(' | '), arriving: document.querySelectorAll('.arrive').length, gmOnly: /GM-ONLY/.test(document.documentElement.outerHTML) })); } catch (e) { return null; } };

  /* Board on the iPad: the board scene, and the dark comes down */
  await gp.click('[data-pb="show"]');
  const amb0 = await until(async () => { const d = (await api('GET', '/gm/ambient')).json; return d && d.doc && d.doc.mode === 'pin' && d.doc.scene === 'board' && d.doc.score ? d.doc : null; }, 10000);
  check(!!amb0, 'Board on the iPad: the ambient scene is pinned to the board, with this site\'s score scene set');
  check(!!(await until(async () => { const t = await displayGet(); return /"kind":"blank"/.test(t); }, 10000)), 'Board on the iPad: the dark that covered it came down (a blank, as Roll the opening credits does)');
  const b0 = await until(async () => { const b = await board(); return b && b.strings > 0 ? b : null; }, 30000);
  check(!!b0, 'the iPad plays the planning board (' + (b0 ? b0.strings + ' strings' : 'no frame') + ')');
  const s0 = await score();

  /* a line pinned to a room the players know */
  const LINE = 'The croupier deals seconds after midnight';
  await pinIt(pub[0], 'line', LINE);
  const s1 = await until(async () => { const s = await score(); return s && s.board !== s0.board && s.board.includes('pb-p1-') ? s : null; }, 10000);
  check(!!s1 && strings(s1.board) === strings(s0.board) + 1 && s1.board.includes(LINE), 'pin a line: the stored board carries the card (its words) and one more red string');
  const b1 = await until(async () => { const b = await board(); return b && b.strings === b0.strings + 1 && b.text.includes(LINE) ? b : null; }, 15000);
  check(!!b1, 'the iPad\'s board shows the card\'s words and one more string');
  const arriving = await until(async () => { const b = await board(); return b && b.arriving ? b : null; }, 3000, 100);
  check(!!arriving, 'the new card arrives (large in the middle) while the rest stays put: ' + (b1 ? b1.drawn + ' of ' + b1.strings + ' strings already pinned' : ''));
  await sleep(1300); await shot(dp, 'board-arrive-tv-1920');
  const settled = await until(async () => { const b = await board(); return b && !b.arriving && b.drawn === b.strings ? b : null; }, 15000);
  check(!!settled, 'it settles into its place and its string is pinned');
  await shot(dp, 'board-settled-tv-1920');

  /* a face: a revealed NPC */
  await pinIt(pub[0], 'face', 'Mabel Quist');
  const s2 = await until(async () => { const s = await score(); return s && s.board.includes('pb-p2-') ? s : null; }, 10000);
  check(!!s2 && strings(s2.board) === strings(s1.board) + 1, 'pin a face: a portrait goes up in the room, with its own string');
  if (await until(async () => { const b = await board(); return b && b.arriving ? b : null; }, 8000, 100)) { await sleep(1300); await shot(dp, 'board-face-arrive-tv-1920'); }
  await until(async () => { const b = await board(); return b && !b.arriving ? b : null; }, 15000);
  await sleep(2600); await shot(dp, 'board-face-settled-tv-1920');
  const ids = s2 ? [...s2.board.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]) : [];
  check(ids.length > 0 && new Set(ids).size === ids.length, 'every id on the board is there once (' + ids.length + ' ids)');

  /* a hidden NPC in a pin's words: refused, never stored */
  const before = await gp.evaluate(() => JSON.stringify(window.B68GmPage._state().doc.boardPins || {}));
  await pinIt(pub[0], 'question', 'Is ' + HIDDEN + ' upstairs?');
  const refused = await until(async () => /Not pinned/.test(await toastErr()) ? await toastErr() : '', 4000);
  check(!!refused && /must not see/.test(refused), 'a hidden name in the words is refused with a toast that says why: "' + refused.slice(0, 90) + '"');
  check(await gp.evaluate(() => JSON.stringify(window.B68GmPage._state().doc.boardPins || {})) === before, 'and nothing was stored');

  /* a room the players do not know: waits, then comes up with its band */
  const tick = async (band, on) => { const sel = '[data-reveal="' + band + '"]'; if ((await gp.$eval(sel, (e) => e.checked)) !== on) await gp.click(sel); };
  await tick('working', true);
  await gp.waitForFunction((n) => [...document.querySelectorAll('[data-pb="room"] option')].some((o) => o.value === n), work[0], { timeout: 8000 });
  const WAIT = 'Bring the long ladder';
  await pinIt(work[0], 'route', WAIT);
  await until(async () => { const s = await score(); return s && s.board.includes(WAIT); }, 10000);
  await tick('working', false);
  const s3 = await until(async () => { const s = await score(); return s && !s.board.includes(WAIT) && s.reveal.join() === 'public' ? s : null; }, 10000);
  check(!!s3, 'the band taken back: the stored board is redrawn by itself, without the pin in that room');
  check(await gp.evaluate(() => !!document.querySelector('[data-pb="waiting"]')), 'the GM\'s row says the pin is waiting for the room');
  check(!!(await until(async () => { const b = await board(); return b && !b.text.includes(WAIT) ? b : null; }, 15000)), 'nothing of it on the iPad');
  await tick('working', true);
  const s4 = await until(async () => { const s = await score(); return s && s.board.includes(WAIT) ? s : null; }, 10000);
  check(!!s4, 'the band revealed again: the board updates by itself (no second press of Set as score scene)');
  check(!!(await until(async () => { const b = await board(); return b && b.text.includes(WAIT) ? b : null; }, 15000)), 'and the pin comes up on the iPad');
  await tick('working', false);
  const s5 = await until(async () => { const s = await score(); return s && s.reveal.join() === 'public' && !s.board.includes(WAIT) ? s : null; }, 10000);
  check(!!s5, 'taken back once more: the board follows again' + (s5 ? '' : ' (stored ' + ((await score()) || {}).reveal + ', page ' + JSON.stringify(await gp.evaluate(() => window.B68GmPage._state().doc.loc.map.reveal)) + ')'));
  check(await gp.evaluate(() => !document.querySelector('.gm-scene-behind')), 'the Location view does not say the score scene is behind');

  /* remove */
  await gp.click('[data-pb-pin="p1"] [data-pb="remove"]');
  check(!!(await until(async () => { const s = await score(); return s && !s.board.includes(LINE) ? s : null; }, 10000)), 'remove: the card comes off the stored board');
  check(!!(await until(async () => { const b = await board(); return b && !b.text.includes(LINE) ? b : null; }, 15000)), 'and off the iPad');

  /* secrecy */
  const get = await displayGet(), bd = await board();
  check(!/GM-ONLY/.test(get), 'the display GET carries no GM-ONLY- text');
  check(!!bd && !bd.gmOnly && !(await dp.evaluate(() => /GM-ONLY/.test(document.documentElement.outerHTML))), 'neither the display DOM nor the board scene\'s DOM holds GM-ONLY- text');

  /* held still: reduced motion on a second display, a new pin is simply there */
  const rc = await dbrowser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1180, height: 820 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const rp = await rc.newPage(); rp.on('pageerror', (e) => errors.push('display (reduced): ' + e.message));
  await rp.goto(BASE + '/#display');
  const rframe = () => rp.frames().find((f) => /planning-board/.test(f.url()) && !f.isDetached());
  const rboard = async () => { const f = rframe(); if (!f) return null; try { return await f.evaluate(() => ({ strings: document.querySelectorAll('.string').length, text: [...document.querySelectorAll('text, title')].map((t) => t.textContent).join(' | '), arriving: document.querySelectorAll('.arrive').length })); } catch (e) { return null; } };
  await until(async () => { const b = await rboard(); return b && b.strings > 0; }, 30000);
  await sleep(1000);
  const STILL = 'The back stairs creak';
  await pinIt(pub[0], 'item', STILL);
  const rb = await until(async () => { const b = await rboard(); return b && b.text.includes(STILL) ? b : null; }, 15000, 100);
  check(!!rb && rb.arriving === 0, 'reduced motion: the new pin is simply there (no arrival)');
  await shot(rp, 'board-still-ipad-1180');
  await rc.close();

  /* the GM's side, as the GM sees it */
  await gp.locator('[data-pb-slot]').scrollIntoViewIfNeeded(); await shot(gp, 'gm-board-block-desk-1366');

  /* off: no Board block, and Set as score scene stores today's board */
  await players(false);
  await openGm();
  await sleep(800);
  check(await gp.evaluate(() => !document.querySelector('[data-pb-slot]')), 'off: no Board block');
  await gp.click('[data-gm="layer"][data-v="player"]');
  await gp.waitForSelector('[data-gm="scorescene"]:not([disabled])', { timeout: 8000 });
  const sOff0 = await score();
  await gp.click('[data-gm="scorescene"]');
  const sOff = await until(async () => { const s = await score(); return s && s.at !== sOff0.at ? s : null; }, 10000);
  check(!!sOff && !/pb-p\d/.test(sOff.board) && !sOff.board.includes(STILL), 'off: Set as score scene stores the board as today (no pin on it), though pins are still stored');

  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''));
  await dc.close(); await gc.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
} finally {
  clearTimeout(timeout);
  try { if (dbrowser && dbrowser !== browser) await dbrowser.close(); } catch (_) {}
  try { if (browser) await browser.close(); } catch (_) {}
  killDemo();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
