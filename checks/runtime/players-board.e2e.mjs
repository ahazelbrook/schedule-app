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
/* what the board scene shows (run inside its frame): the strings and how many are pinned up, every word, a card arriving, the sheet, the kit's own way-in
   card words, and the big cards of the players' screen: each pin's on-screen width and the smallest of its words (body type and caption) in screen px */
function probe() {
  const S = [...document.querySelectorAll('.string')], px = (x) => parseFloat(x.getAttribute('font-size')) * Math.hypot(x.getScreenCTM().a, x.getScreenCTM().b);
  const cards = [...document.querySelectorAll('.pcard')].map((g) => { const r = g.getBoundingClientRect(), body = [...g.querySelectorAll('text[font-weight="800"], text[font-family="Yellowtail"]')].filter((x) => x.textContent.trim());
    const img = g.querySelector('svg'), ir = img ? img.getBoundingClientRect() : r, words = [...g.querySelectorAll('text[font-weight="800"]')].filter((x) => x.textContent.trim()).map((x) => x.getBoundingClientRect());
    const edge = words.length ? Math.min(...words.map((b) => Math.min(b.left - ir.left, ir.right - b.right) / ir.width)) : 1, plate = !!g.querySelector('[id$="-plate"]'), face = !plate && !!g.querySelector('clipPath');
    return { pin: g.getAttribute('data-pin'), w: r.width, edge, plate, face, text: [...g.querySelectorAll('text, title')].map((x) => x.textContent).join(' '), font: body.length ? Math.min(...body.map(px)) : 0 }; });
  return { strings: S.length, drawn: S.filter((s) => /^0(px)?$/.test(getComputedStyle(s).strokeDashoffset)).length, text: [...document.querySelectorAll('text, title')].map((x) => x.textContent).join(' | '),
    arriving: document.querySelectorAll('.arrive, .landing').length, sheet: !!document.querySelector('#content > svg'), kit: /costs a question|THE FRONT|THE SERVICE SIDE/.test(document.body.textContent), cards, gmOnly: /GM-ONLY/.test(document.documentElement.outerHTML) };
}
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
  const board = async () => { const f = frame(); if (!f) return null; try { return await f.evaluate(probe); } catch (e) { return null; } };

  /* Board on the iPad: the board scene, and the dark comes down */
  await gp.click('[data-pb="show"]');
  const amb0 = await until(async () => { const d = (await api('GET', '/gm/ambient')).json; return d && d.doc && d.doc.mode === 'pin' && d.doc.scene === 'board' && d.doc.score ? d.doc : null; }, 10000);
  check(!!amb0, 'Board on the iPad: the ambient scene is pinned to the board, with this site\'s score scene set');
  check(!!(await until(async () => { const t = await displayGet(); return /"kind":"blank"/.test(t); }, 10000)), 'Board on the iPad: the dark that covered it came down (a blank, as Roll the opening credits does)');
  const b0 = await until(async () => { const b = await board(); return b && b.sheet ? b : null; }, 30000);
  check(!!b0, 'the iPad plays the planning board (' + (b0 ? b0.strings + ' strings' : 'no frame') + ')');
  check(!!b0 && !b0.kit, 'on: the map kit way-in cards are not in the scene (their words, "costs a question", are nowhere in it)');
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
  const c1 = settled && settled.cards.find((c) => c.text.includes(LINE));
  check(!!c1 && c1.w >= 230 && c1.font >= 26, 'at 1920x1080 the pin is a big card in the cork: ' + (c1 ? Math.round(c1.w) + ' px wide, words ' + c1.font.toFixed(1) + ' px' : 'no card') + ' (at least 230 and 26)');

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

  /* secrecy after the fact: a name the players could see when it was pinned, hidden later, comes off the stored board, the display GET and
     the scene within one sync; the pin stays stored (waiting), and comes back when the name may be seen again */
  const gone = async (needle, what) => {
    const ok = await until(async () => { const s = await score(), b = await board(), g = await displayGet(); return s && !s.board.includes(needle) && b && !b.text.includes(needle) && !g.includes(needle) ? true : null; }, 15000, 250);
    check(!!ok, what + ': "' + needle + '" is gone from the stored board, the display GET and the scene');
  };
  const npc = (id, change) => api('PATCH', '/npcs/' + id, change);
  const CLOCKLINE = 'Win back the marker before dawn';
  await pinIt(pub[0], 'line', CLOCKLINE);
  const DOVLINE = 'Dov Kessler keeps the door';
  await pinIt(pub[0], 'line', DOVLINE);
  check(!!(await until(async () => { const b = await board(); return b && b.text.includes(CLOCKLINE) && b.text.includes(DOVLINE) && b.text.includes('Mabel Quist') ? b : null; }, 15000)), 'three pins naming people and a clock the players can see are up');
  check((await npc('npc-mabel', { revealed: false })).status === 200, 'the GM hides Mabel Quist again (her face is pinned)');
  await gone('Mabel Quist', 'a pinned face hidden again');
  check(await gp.evaluate(() => JSON.stringify(window.B68GmPage._state().doc.boardPins || {}).includes('npc-mabel')), 'her pin is still stored (it waits)');
  check((await npc('npc-mabel', { revealed: true })).status === 200, 'and revealed again');
  check(!!(await until(async () => { const b = await board(); return b && b.text.includes('Mabel Quist') ? b : null; }, 15000)), 'her face comes back by itself');
  const camp = (await api('GET', '/campaign')).json, cdoc = camp && (camp.doc || camp);
  const clocks = (cdoc.clocks || []).map((c) => c.id === 'c-marker' ? Object.assign({}, c, { hidden: true }) : c);
  check((await api('PATCH', '/campaign', { clocks })).status === 200, 'the GM hides the clock "Win back the marker"');
  await gone(CLOCKLINE, 'a pin naming a clock hidden later');
  await api('PATCH', '/campaign', { clocks: (cdoc.clocks || []) });
  check((await npc('npc-dov', { alias: 'Kessler', tags: ['recurring', 'known-as'] })).status === 200, 'Dov Kessler becomes known only as Kessler');
  await gone(DOVLINE, 'a pin with the full name of an NPC now known by an alias');
  await npc('npc-dov', { alias: '', tags: ['recurring'] });
  check(!!(await until(async () => { const s = await score(); return s && s.board.includes(CLOCKLINE) && s.board.includes(DOVLINE) ? s : null; }, 15000)), 'with the clock shown and the full name allowed again, both pins come back');

  /* leaving the site and coming back (Earlier) writes nothing: the iPad keeps the bands it had */
  await tick('working', true);
  const sKeep = await until(async () => { const s = await score(); return s && s.reveal.join() === 'public,working' ? s : null; }, 10000);
  await sleep(1500);
  await gp.click('[data-gm="locroll"]');
  await gp.waitForFunction((n) => window.B68GmPage._state().locRoll && window.B68GmPage._state().locRoll.name !== n, 'The Pelican Rooms', { timeout: 10000 }).catch(() => {});
  await sleep(1200);
  await gp.click('[data-gm="replay"][data-tool="location"][title^="The Pelican Rooms"]').catch(() => {});
  await gp.waitForFunction(() => window.B68GmPage._state().locRoll && window.B68GmPage._state().locRoll.name === 'The Pelican Rooms', null, { timeout: 10000 }).catch(() => {});
  await sleep(3000);
  const sBack = await score();
  check(!!sKeep && !!sBack && sBack.at === sKeep.at && sBack.reveal.join() === 'public,working' && await gp.evaluate(() => window.B68GmPage._state().locRoll.name === 'The Pelican Rooms'),
    'another site rolled, then the Pelican Rooms again from Earlier: no score write, the iPad keeps public,working' + (sBack ? ' (stored ' + sBack.reveal.join() + ')' : ''));
  const ticks = await gp.$$eval('[data-reveal]', (l) => l.filter((x) => x.checked).map((x) => x.getAttribute('data-reveal')).join());
  check(ticks === 'public,working', 'IP6b: after the replay the ticks are the stored bands (' + ticks + '), so the page starts where the iPad is');
  await npc('npc-mabel', { revealed: false });
  const sHid = await until(async () => { const s = await score(); return s && sBack && s.at !== sBack.at ? s : null; }, 15000);
  check(!!sHid && sHid.reveal.join() === 'public,working' && !sHid.board.includes('Mabel Quist'), 'and a face hidden after that comes off the board while the iPad keeps public,working' + (sHid ? ' (stored ' + sHid.reveal.join() + ')' : ''));
  await npc('npc-mabel', { revealed: true });
  await until(async () => { const s = await score(); return s && s.board.includes('Mabel Quist'); }, 15000);

  /* secrecy */
  const get = await displayGet(), bd = await board();
  check(!/GM-ONLY/.test(get), 'the display GET carries no GM-ONLY- text');
  check(!!bd && !bd.gmOnly && !(await dp.evaluate(() => /GM-ONLY/.test(document.documentElement.outerHTML))), 'neither the display DOM nor the board scene\'s DOM holds GM-ONLY- text');

  /* held still: "Hold scenes still" (fx.off) on a second display at iPad size, no reduced motion asked: a new pin is simply there */
  for (const p of ['/gm/state', '/campaign']) await api('PATCH', p, { features: { 'fx.off': true } });
  await openGm(); await sleep(800);      /* the GM page holds its own copy of the settings and writes it back to the campaign on every arrival: it must have fx.off too */
  const rc = await dbrowser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1180, height: 820 }, serviceWorkers: 'block' });
  const rp = await rc.newPage(); rp.on('pageerror', (e) => errors.push('display (reduced): ' + e.message));
  await rp.goto(BASE + '/#display');
  const rframe = () => rp.frames().find((f) => /planning-board/.test(f.url()) && !f.isDetached());
  const rboard = async () => { const f = rframe(); if (!f) return null; try { return await f.evaluate(probe); } catch (e) { return null; } };
  await until(async () => { const b = await rboard(); return b && b.sheet && b.cards.length > 0; }, 30000);
  await sleep(1000);
  const STILL = 'Who keeps the spare key behind the bar?';
  await pinIt(pub[0], 'item', STILL);
  const rb = await until(async () => { const b = await rboard(); return b && b.text.includes(STILL) ? b : null; }, 15000, 100);
  check(!!rb && rb.arriving === 0, 'held still (fx.off): the new pin is simply there (no arrival)');
  const rc1 = rb && rb.cards.find((c) => c.text.includes(STILL)), small = rb ? rb.cards.reduce((m, c) => Math.min(m, c.w), 1e9) : 0, smallF = rb ? rb.cards.reduce((m, c) => Math.min(m, c.font), 1e9) : 0;
  check(!!rc1 && small >= 160 && smallF >= 18, 'at 1180x820 every card is at least 160 px wide with words at least 18 px (' + (rb ? rb.cards.length + ' cards, narrowest ' + Math.round(small) + ' px, smallest words ' + smallF.toFixed(1) + ' px' : 'none') + ')');
  const rEdge = rb ? Math.min(...rb.cards.map((c) => c.edge)) : 0;
  check(rEdge >= 0.04, 'IP6b: at 1180x820 every card words sit at least 4% of its width clear of its edges (closest ' + (rEdge * 100).toFixed(1) + '%)');
  for (const p of ['/gm/state', '/campaign']) await api('PATCH', p, { features: { 'fx.off': false } });
  await shot(rp, 'board-still-ipad-1180');
  await rc.close();

  /* the GM's side, as the GM sees it */
  await gp.locator('[data-pb-slot]').scrollIntoViewIfNeeded(); await shot(gp, 'gm-board-block-desk-1366');

  /* IP6b: one more band ticked only adds; eight pins, four faces, three bands: at least three real faces, every card's words clear of its edges */
  const sPre = await score();
  await tick('controlled', true);
  const sGrow = await until(async () => { const s = await score(); return s && s.at !== sPre.at ? s : null; }, 10000);
  check(!!sGrow && sGrow.reveal.join() === 'public,working,controlled', 'IP6b: one more band ticked: the stored reveal only grows (' + (sGrow ? sGrow.reveal.join() : 'no write') + ')');
  const ctl = rooms.filter((r) => r.band === 'controlled').map((r) => r.name)[0] || pub[0];
  for (const [room, who] of [[ctl, 'Dov Kessler'], [work[0], 'Ada Vell'], [pub[0], 'Lotte Brand']]) await pinIt(room, 'face', who);
  const pinsNow = await gp.evaluate(() => { const d = window.B68GmPage._state().doc.boardPins || {}; return (d['The Pelican Rooms'] || { pins: [] }).pins; });
  const full = await until(async () => { const b = await board(); return b && b.cards.length === 8 && !b.arriving ? b : null; }, 40000, 300);
  const faces = full ? full.cards.filter((c) => c.face).length : 0, plates = full ? full.cards.filter((c) => c.plate).length : 0, sz = ((await score()) || { board: '' }).board.length;
  check(pinsNow.length === 8 && pinsNow.filter((p) => p.kind === 'face').length === 4 && faces >= 3, 'IP6b: 8 pins, 4 faces at three bands: ' + faces + ' real faces, ' + plates + ' name plates (board ' + Math.round(sz / 1024) + ' KiB)' + (faces < 3 || pinsNow.length !== 8 ? ' ' + pinsNow.length + ' pins; cards ' + JSON.stringify(full && full.cards.map((c) => [c.pin, c.face, c.plate])) : ''));
  const edge = full ? Math.min(...full.cards.map((c) => c.edge)) : 0;
  check(!!full && edge >= 0.04, 'IP6b: every card\'s words sit at least 4% of its width clear of its edges at 1920x1080 (closest ' + (edge * 100).toFixed(1) + '%)');
  await shot(dp, 'board-three-bands-tv-1920');
  /* IP6c: a GM page load writes nothing to the board: a reload, a second page opening and that page reloading; the stored score read late
     (held 3 s): no write, the ticks become the stored bands when it comes; a pin made before it comes lands at the stored bands */
  await gp.click('[data-pb-pin="p5"] [data-pb="remove"]');
  await until(async () => { const s = await score(); return s && !s.board.includes(STILL); }, 15000);
  await sleep(2500);
  const atOf = async () => ((await score()) || {}).at, stored = ((await score()) || { reveal: [] }).reveal.join();
  let at0 = await atOf();
  await openGm(); await sleep(15000);
  check((await atOf()) === at0, 'IP6c: a GM page reload writes nothing to the board (15 s)');
  const g2c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
  await g2c.addInitScript(atPlace('score'));
  const g2 = await g2c.newPage(); g2.on('pageerror', (e) => errors.push('gm2: ' + e.message)); g2.on('dialog', (d) => d.accept());
  await g2.goto(BASE + '/#gm');
  await g2.waitForFunction(() => window.B68GmPage && window.B68GmPage._state && window.B68GmPage._state().locRoll, null, { timeout: 40000 });
  await g2.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); await g2.keyboard.press('b');
  await sleep(15000);
  check((await atOf()) === at0, 'IP6c: a second GM page opening writes nothing to the board');
  await g2.reload(); await sleep(15000);
  check((await atOf()) === at0, 'IP6c: the second page reloading writes nothing to the board');
  await g2c.close();
  const late = async (route) => { await sleep(3000); try { await route.continue(); } catch (e) { /* the page went */ } };
  await gp.route('**/api/gm/ambient**', late);
  await openGm();
  await gp.waitForFunction(() => { const s = window.B68GmPage._state(); return s && s.npcsIn; }, null, { timeout: 20000 }).catch(() => {});
  await sleep(6000);
  const ticksLate = await gp.$$eval('[data-reveal]', (l) => l.filter((x) => x.checked).map((x) => x.getAttribute('data-reveal')).join());
  check((await atOf()) === at0 && ticksLate === stored, 'IP6c: the stored score read 3 s late, after the cast: no write, and the ticks are the stored bands when it comes (' + ticksLate + ' = ' + stored + ')');
  await gp.unroute('**/api/gm/ambient**', late);
  const later = async (route) => { await sleep(6000); try { await route.continue(); } catch (e) { /* the page went */ } };
  await gp.route('**/api/gm/ambient**', later);
  await openGm();
  const EARLY = 'Pinned before the board was read';
  await gp.waitForSelector('[data-pb-slot] .gm-pboard', { timeout: 15000 });
  await pinIt(pub[0], 'line', EARLY);
  const sEarly = await until(async () => { const s = await score(); return s && s.board.includes(EARLY) ? s : null; }, 20000);
  check(!!sEarly && sEarly.reveal.join() === stored, 'IP6c: a pin made before the stored score was read lands at the stored bands (' + (sEarly ? sEarly.reveal.join() : 'not written') + ')');
  await gp.unroute('**/api/gm/ambient**', later);

  /* IP6d: the GM page on ANOTHER site's roll; from a second device a pinned face is hidden again and a clock named on a pin is hidden: both
     leave the stored board, the display GET and the scene within one sync, the rest of the board stays, the page stays where it was */
  await sleep(2000);
  await gp.click('[data-gm="locroll"]');
  await gp.waitForFunction((n) => window.B68GmPage._state().locRoll && window.B68GmPage._state().locRoll.name !== n, 'The Pelican Rooms', { timeout: 10000 });
  await sleep(2500);
  const sA = await score(), otherSite = await gp.evaluate(() => window.B68GmPage._state().locRoll.name);
  check(!!sA && sA.name === 'The Pelican Rooms' && sA.board.includes('Mabel Quist') && sA.board.includes(CLOCKLINE), 'IP6d: the Pelican Rooms board is the score scene (Mabel Quist and the clock line on it) while the page is on ' + otherSite);
  await npc('npc-mabel', { revealed: false });
  const campD = (await api('GET', '/campaign')).json, cdD = campD && (campD.doc || campD);
  await api('PATCH', '/campaign', { clocks: (cdD.clocks || []).map((c) => c.id === 'c-marker' ? Object.assign({}, c, { hidden: true }) : c) });
  const sGone = await until(async () => { const s = await score(), g = await displayGet(), b = await board(); return s && !s.board.includes('Mabel Quist') && !s.board.includes(CLOCKLINE) && !g.includes('Mabel Quist') && !g.includes(CLOCKLINE) && b && !b.text.includes('Mabel Quist') && !b.text.includes(CLOCKLINE) ? s : null; }, 15000, 250);
  check(!!sGone, 'IP6d: the hidden face and the hidden clock line are gone from the stored board, the display GET and the scene within one sync');
  check(!!sGone && sGone.name === 'The Pelican Rooms' && sGone.board.includes(DOVLINE) && sGone.board.includes(EARLY) && sGone.reveal.join() === sA.reveal.join(), 'IP6d: the rest of the board stays, at the stored bands (' + (sGone ? sGone.reveal.join() : '') + ')');
  check(await gp.evaluate((n) => window.B68GmPage._state().locRoll.name === n, otherSite), 'IP6d: the GM page is still on ' + otherSite);
  const said = await toastErr();
  check(/planning board of The Pelican Rooms was redrawn/.test(said) && /Open The Pelican Rooms/.test(said), 'IP6d: one toast says what happened and how back: "' + said.slice(0, 120) + '"');
  await npc('npc-mabel', { revealed: true });
  await api('PATCH', '/campaign', { clocks: (cdD.clocks || []) });
  await gp.click('[data-gm="replay"][data-tool="location"][title^="The Pelican Rooms"]').catch(() => {});
  await gp.waitForFunction(() => window.B68GmPage._state().locRoll && window.B68GmPage._state().locRoll.name === 'The Pelican Rooms', null, { timeout: 10000 }).catch(() => {});
  check(!!(await until(async () => { const s = await score(); return s && s.board.includes('Mabel Quist') && s.board.includes(CLOCKLINE) ? s : null; }, 20000)), 'IP6d: back on the Pelican Rooms with the face and the clock allowed again, both come back');

  /* off: no Board block, and Set as score scene stores today's board */
  await players(false);
  await openGm();
  await sleep(800);
  await players(false);      /* again: the page that was open may have written its own copy (on) back to the campaign before it reloaded */
  check(await gp.evaluate(() => !document.querySelector('[data-pb-slot]')), 'off: no Board block');
  await gp.click('[data-gm="layer"][data-v="player"]');
  await gp.waitForSelector('[data-gm="scorescene"]:not([disabled])', { timeout: 8000 });
  const sOff0 = await score();
  await gp.click('[data-gm="scorescene"]');
  const sOff = await until(async () => { const s = await score(); return s && s.at !== sOff0.at ? s : null; }, 10000);
  check(!!sOff && !/pb-p\d/.test(sOff.board) && !sOff.board.includes(STILL), 'off: Set as score scene stores the board as today (no pin on it), though pins are still stored');
  const bOff = await until(async () => { const b = await board(); return b && b.sheet && b.kit && !b.cards.length ? b : null; }, 25000);
  check(!!bOff, 'off: the scene is as before (the map kit way-in cards on the board, no big cards)' + (bOff ? '' : ' ' + JSON.stringify(await board().then((b) => b && { sheet: b.sheet, kit: b.kit, cards: b.cards.length, text: b.text.slice(0, 300) }))));
  await sleep(6000);      /* every string of that board is pinned up by now */
  const sOff1 = await score();
  await gp.click('[data-gm="scorescene"]');
  let repin = null;
  for (let i = 0; i < 80 && !repin; i++) { const b = await board(); if (b && b.kit && b.strings > 0 && b.drawn === 0) repin = b; else await sleep(100); }
  check(!!repin && (await until(async () => { const s = await score(); return s && s.at !== sOff1.at; }, 5000)), 'off: the same site sent again re-pins every string from nothing, as ipad/main (' + (repin ? repin.strings + ' strings, 0 drawn' : 'never seen undrawn') + ')');

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
