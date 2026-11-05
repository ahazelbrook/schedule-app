// The Roll (the GM night rebuild, N4; app/gm/roll.js, app/gm/stamp.js, the console column of gm-page.js) on the real GM page against the demo night
// (scripts/demo-night.mjs: the Pelican Rooms, a v2 night started with the crew in the Showroom, a prep note whose rooms carry "If it goes wrong" lines):
// one Position control drives both the stamp and the tables; the line prefilled from the room, following the crew, staying empty once emptied, and
// setThreat (the room card's "-> the Roll"); Stamp it on the iPad, Stamp again, Take it down and Esc through gm/esc.js (one thing per press, never PANIC
// while the stamp is up); the keys 1-4; the sizer's strip under the card with its two-tap Reduce and the quick tables; the folds; Focus with the
// position; the column at 1366x768 (no overlap, no sideways scroll) and at 390x844. No model, $0. Every name is invented.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9036] node checks/runtime/gm-roll.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9036);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const api = (method, p, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j }; });
const gmState = async () => ((await api('GET', '/gm/state')).json || {}).doc || {};
const ambientDoc = async () => { const j = (await api('GET', '/gm/ambient')).json || {}; return j.doc || (j.ambient && j.ambient.doc) || {}; };
const overlay = async () => (await ambientDoc()).overlay || null;

/* the demo night is the server: it boots a local Worker with a fresh state and seeds the invented night, then waits */
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const demo = spawn(process.execPath, [path.join(ROOT, 'scripts', 'demo-night.mjs'), '--port', String(PORT)], { cwd: ROOT, env: { ...process.env, B68_ANTHROPIC_KEY: '', ANTHROPIC_API_KEY: '' }, detached: !WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let demoOut = '';
demo.stdout.on('data', (d) => { demoOut += d; }); demo.stderr.on('data', (d) => { demoOut += d; });
function killDemo() {
  if (WIN) spawnSync('taskkill', ['/pid', String(demo.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-demo.pid, 'SIGKILL'); } catch (_) {} }
}
process.on('exit', killDemo);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

const GM_READY = async (page) => {
  await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
  await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
};
const blur = (page) => page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());

try {
  const up = await until(() => /The demo night is up/.test(demoOut), 240000, 500);
  if (!up) throw new Error('the demo night did not start:\n' + demoOut.slice(-1500));
  const SHOW_LINE = 'Dov Kessler turns and looks straight at you', LOUNGE_LINE = 'Lotte Brand checks her list and finds a name missing';
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  const openGm = async (size, extra = {}) => {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: size[0], height: size[1] }, serviceWorkers: 'block', ...extra });
    await c.addInitScript(() => { window.__B68_POLL_MS = 1000; });
    const page = await c.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '/#gm');
    await GM_READY(page);
    return { c, page };
  };
  const L = await openGm([1366, 768]);
  const page = L.page;
  const lineVal = () => page.inputValue('#gm-c-threat');

  /* ---- the column: one block, the design's order, laid out without overlap or sideways scroll at 1366x768 ---- */
  const box = await page.$eval('#gm-roll', (s) => { const r = s.getBoundingClientRect(); return { w: Math.round(r.width), sw: s.scrollWidth, cw: s.clientWidth, cls: s.className }; });
  check(/gm-console/.test(box.cls) && box.w >= 280 && box.w <= 420, 'the Roll is the console column, ' + box.w + ' px wide at 1366x768');
  check(box.sw <= box.cw + 1, 'nothing in it scrolls sideways (' + box.sw + ' / ' + box.cw + ')');
  const overlaps = await page.$eval('#gm-rl', (card) => {
    const kids = [...card.children].filter((k) => k.getBoundingClientRect().height > 0).map((k) => ({ id: k.id || k.className, r: k.getBoundingClientRect() }));
    const hits = [];
    for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) { const a = kids[i].r, b = kids[j].r; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) hits.push(kids[i].id + ' x ' + kids[j].id); }
    const out = [...card.querySelectorAll('button, textarea')].filter((e) => { const r = e.getBoundingClientRect(), c = card.getBoundingClientRect(); return r.width > 0 && (r.left < c.left - 1 || r.right > c.right + 1); }).map((e) => e.textContent.trim() || e.id);
    return { hits, out };
  });
  check(!overlaps.hits.length && !overlaps.out.length, 'the Roll card’s parts never overlap and nothing sticks out of it ' + JSON.stringify(overlaps));
  const clipped = await page.$$eval('#gm-rl .chip, #gm-buttons .gm-btn b', (l) => l.filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent.trim()));
  check(!clipped.length, 'no label is cut off at this width ' + JSON.stringify(clipped));
  check(await page.$eval('#gm-rl', (c) => c.getBoundingClientRect().top >= 0 && c.getBoundingClientRect().bottom <= innerHeight), 'the whole Roll card is on screen at 1366x768');

  /* ---- the line, prefilled from the room the crew is in ---- */
  check(!!(await until(async () => (await lineVal()) === SHOW_LINE, 8000)), 'the line starts as the Showroom’s "If it goes wrong" (the crew is there): ' + (await lineVal()));
  check(/From the room: Showroom/.test(await page.textContent('#gm-line-note')), 'and says where it came from');
  check(!!(await until(async () => ((await gmState()).con || {}).live && (await gmState()).con.live.threat === SHOW_LINE, 5000)), 'stored as the console’s Threat on screen: one field, one value');

  /* ---- one Position control: the tables and the stamp read it ---- */
  await page.click('#gm-pos [data-v="desperate"]');
  check(await page.$eval('#gm-pos [aria-checked="true"]', (b) => b.getAttribute('data-v')) === 'desperate', 'one tap sets desperate');
  check(/harm 3/.test(await page.textContent('#gm-pos-size')), 'the size under it is desperate’s: ' + (await page.textContent('#gm-pos-size')));
  check(!!(await until(async () => ((await gmState()).con || {}).live.pos === 'desperate', 5000)), 'the console’s Position is desperate (stored)');
  await blur(page); await page.keyboard.press('3');
  await page.waitForSelector('#gm-card .gm-lead', { timeout: 5000 });
  check(/^desperate/.test(await page.textContent('#gm-card .gm-sub')), 'key 3: a 1–3 rolled at that Position');
  check(new RegExp(SHOW_LINE).test(await page.textContent('#gm-card .gm-lead')), 'and its consequence spends the Roll’s line');
  check(!(await page.$('#gm-card #gm-sz:not([hidden])')), 'no stamp, no sizer strip (the size belongs to the stamped promise)');
  check(!!(await page.$('#gm-card [data-gm="qt"][data-n="4"]')) && !!(await page.$('#gm-card [data-gm="qt"][data-n="7"]')), 'a 1–3 card offers Pay the price and Harm & resist');

  /* ---- Stamp it on the iPad, Stamp again, Take it down ---- */
  await page.click('#gm-eff [data-v="great"]');
  await sleep(300);
  check(!(await overlay()), 'picking an effect stamps nothing');
  await page.click('#gm-stamp [data-gm="stamp"]');
  const ov1 = await until(async () => { const o = await overlay(); return o && o.kind === 'report' ? o : null; }, 6000);
  check(!!ov1 && ov1.payload.position === 'desperate' && ov1.payload.effect === 'great' && ov1.payload.text === SHOW_LINE, 'Stamp it on the iPad: the report card with the Roll’s position, effect and line ' + JSON.stringify(ov1 && ov1.payload));
  check(/On the iPad/.test(await page.textContent('#gm-stamp')) && !(await page.$('#gm-stamp [data-gm="stamp"]')), 'the Roll says it is on the iPad (and offers no second stamp while nothing changed)');
  await page.click('#gm-eff [data-v="limited"]');
  check(!!(await page.waitForSelector('#gm-stamp [data-gm="stamp"]', { timeout: 3000 }).catch(() => null)) && /Stamp again/.test(await page.textContent('#gm-stamp')), 'a changed effect offers Stamp again');
  await page.click('#gm-stamp [data-gm="stamp"]');
  check(!!(await until(async () => { const o = await overlay(); return o && o.payload && o.payload.effect === 'limited'; }, 6000)), 'Stamp again puts what is set now on the iPad');
  await page.click('#gm-stamp [data-gm="stamp-down"]');
  check(!!(await until(async () => !(await overlay()), 6000)), 'Take it down clears the iPad');
  check(!!(await page.$('#gm-stamp [data-gm="stamp"]')) && (await page.$eval('#gm-eff [aria-checked="true"]', (b) => b.getAttribute('data-v'))) === 'limited', 'and what was set stays, to go up again');

  /* ---- Esc: through gm/esc.js, one thing per press; PANIC is never reached while the stamp is up ---- */
  await page.click('#gm-stamp [data-gm="stamp"]');
  await until(async () => !!(await overlay()), 6000);
  const sceneBefore = (await ambientDoc()).scene;
  check(await page.evaluate(() => window.B68GmEsc.list().some((e) => e.id === 'stamp' && e.kind === 'stamp' && e.open)), 'the stamp is gm/esc.js’s stamp entry, open while it is up');
  await page.click('#gm-c-threat');
  await page.keyboard.press('Escape');
  await sleep(400);
  check(!!(await overlay()) && !(await page.evaluate(() => document.activeElement && document.activeElement.id === 'gm-c-threat')), 'Esc in the line leaves the field and nothing else');
  await page.keyboard.press('Escape');
  check(!!(await until(async () => !(await overlay()), 6000)), 'the next Esc takes the stamp down');
  await sleep(800);
  check((await ambientDoc()).scene === sceneBefore && !(await page.evaluate(() => window.B68GmEsc.list().some((e) => e.id === 'stamp' && e.open))), 'and it was not a PANIC: the scene is as it was');

  /* ---- the keys 1-4 and the sizer's strip ---- */
  for (const [k, re] of [['1', /Before the roll/], ['4', /Someone/], ['2', /A 4\/5/]]) {
    await blur(page); await page.keyboard.press(k);
    check(!!(await until(async () => re.test(await page.textContent('#gm-card .gm-card-h').catch(() => '')), 4000)), 'key ' + k + ': ' + re.source.replace(/\\/g, ''));
  }
  await page.click('#gm-pos [data-v="risky"]'); await page.click('#gm-eff [data-v="standard"]');
  await page.click('#gm-stamp [data-gm="stamp"]'); await until(async () => !!(await overlay()), 6000);
  await blur(page); await page.keyboard.press('3');
  check(!!(await until(async () => !(await overlay()), 6000)), 'a 1–3 marked on the stamped roll: the card comes down');
  check(!!(await page.waitForSelector('#gm-card #gm-sz:not([hidden])', { timeout: 4000 }).catch(() => null)), 'the sizer’s strip sits under the card’s header');
  const order = await page.$eval('#gm-card article', (a) => [...a.children].map((k) => k.className.split(' ')[0]).slice(0, 3));
  check(order[0] === 'gm-card-h' && order[1] === 'gm-sz', 'header, then the strip, then the card ' + JSON.stringify(order));
  const sz = await page.textContent('#gm-card #gm-sz');
  check(/Full size for risky/.test(sz) && /harm 2/.test(sz) && new RegExp(SHOW_LINE).test(sz), 'full size for the stamped position, with the promised line: ' + sz.replace(/\s+/g, ' ').slice(0, 140));
  check(/standard/i.test(await page.$eval('#gm-eff [aria-checked="true"]', (b) => b.textContent)), 'the roll is resolved: the effect is standard again');
  await page.click('#gm-card [data-gm="sz-reduce"]');
  check(/Full size for risky/.test(await page.textContent('#gm-card #gm-sz')) && /Tap again/.test(await page.textContent('#gm-card #gm-sz')), 'one tap only arms Reduce');
  await page.click('#gm-card [data-gm="sz-reduce"]');
  check(/Reduced to controlled/.test(await page.textContent('#gm-card #gm-sz')), 'the second tap reduces one step');
  const hadPay = !!(await page.$('#gm-card details.gm-or[data-sec="payThePrice"]'));
  await page.click('#gm-card [data-gm="qt"][data-n="4"]');
  check(hadPay ? await page.$eval('#gm-card details.gm-or[data-sec="payThePrice"]', (d) => d.open) : /Pay the price/.test(await page.textContent('#gm-card h3')), 'Pay the price: this card’s own row opens (no new roll)');
  check(!!(await page.$('#gm-card #gm-sz:not([hidden])')), 'and the strip stays with its card');
  await blur(page); await page.keyboard.press('1');
  check(!!(await until(async () => !(await page.$('#gm-card #gm-sz:not([hidden])')), 3000)), 'a Before card: the last roll’s size goes with its card');

  /* ---- the line follows the crew, stays empty once emptied, and setThreat fills it ---- */
  await page.click('[data-gm="line-clear"]');
  check((await lineVal()) === '' && !!(await until(async () => (await gmState()).con.live.threat === '', 5000)), '× empties the line (the store too)');
  await page.click('#gm-pos [data-v="controlled"]');
  await sleep(500);
  check((await lineVal()) === '', 'emptied in the Showroom, it stays empty there');
  const crew = (await gmState()).ball.crew, moved = {};
  for (const [id, v] of Object.entries(crew)) moved[id] = Object.assign({}, v, { room: 'Cocktail lounge' });
  check(await page.evaluate((c) => window.B68GmPage._ballSet({ crew: c }), moved), 'the crew moves to the Cocktail lounge');
  check(!!(await until(async () => (await lineVal()) === LOUNGE_LINE, 5000)), 'the line follows them: the lounge’s line (' + (await lineVal()) + ')');
  check(await page.evaluate(() => window.B68GmPage.setThreat('A waiter drops a tray of glasses')), 'B68GmPage.setThreat (what the room card’s "→ the Roll" calls)');
  check((await lineVal()) === 'A waiter drops a tray of glasses' && !!(await until(async () => (await gmState()).con.live.threat === 'A waiter drops a tray of glasses', 5000)), 'it becomes the line, stored');
  check(await page.$eval('#gm-line-note', (n) => n.hidden), 'and it is not the room’s own any more');
  const back = {}; for (const [id, v] of Object.entries(crew)) back[id] = Object.assign({}, v, { room: 'Showroom' });
  await page.evaluate((c) => window.B68GmPage._ballSet({ crew: c }), back); await sleep(800);
  check((await lineVal()) === 'A waiter drops a tray of glasses', 'a line set on purpose is never replaced by the room');

  /* ---- the folds ---- */
  check(await page.$eval('#gm-scenebox', (p) => p.hidden) && await page.$eval('#gm-earlier', (p) => p.hidden) && await page.$eval('#gm-singles', (p) => p.hidden), 'Scene, Earlier and More tables start folded');
  await page.click('#gm-scene');
  check(await page.$eval('#gm-now-s', (s) => s.checkVisibility() && s.getBoundingClientRect().width > 120), 'Scene opens with Now in shown (the one copy at every width)');
  check((await page.$$('#gm-controls [data-ctl]')).length === 4 && !(await page.$('#gm-controls [data-ctl="threat"]')), 'and the scene, district, aim and NPC (the threat is the Roll’s line)');
  await page.click('[data-rlfold="earlier"]');
  check((await page.$$('#gm-earlier [data-gm="replay"]')).length >= 4 && /\d/.test(await page.textContent('#gm-earlier-n')), 'Earlier lists the rolls, its count on the button');
  await page.click('[data-rlfold="singles"]');
  check((await page.$$('#gm-singles [data-gm="roll"]')).length === 9, 'More tables: the nine single tables');
  const fb = await page.$eval('#gm-roll', (s) => s.scrollWidth <= s.clientWidth + 1);
  check(fb, 'the open folds fit the column');
  for (const s of ['#gm-scene', '[data-rlfold="earlier"]', '[data-rlfold="singles"]']) await page.click(s);

  /* ---- Focus: the keys and the position ---- */
  await blur(page); await page.keyboard.press('f');
  check(!!(await until(() => page.$eval('#gm-root', (r) => r.classList.contains('focus')), 2000)), 'F: Focus');
  check(await page.$eval('#gm-roll', (c) => c.getBoundingClientRect().width < 100), 'the column shrinks to its keys');
  check(/Controlled/i.test(await page.$eval('#gm-mini .gm-mini-pos', (p) => p.textContent)) && (await page.$$('#gm-mini [data-gm="situation"]')).length === 4, 'Focus shows the position on top of the four keys');
  check(await page.$eval('#gm-mini .gm-mini-pos b', (b) => b.scrollWidth <= b.clientWidth + 1), 'and the position fits');
  await page.click('#gm-mini [data-gm="situation"][data-n="2"]');
  check(!!(await until(() => page.$eval('#gm-root', (r) => !r.classList.contains('focus')), 3000)), 'a roll in Focus leaves Focus, so its card shows');
  await L.c.close();

  /* ---- a phone (390x844): the Roll is the console segment, whole width, nothing sideways ---- */
  const Ph = await openGm([390, 844], { isMobile: true, hasTouch: true });
  const ph = await Ph.page.$eval('#gm-roll', (s) => ({ w: s.getBoundingClientRect().width, sw: document.documentElement.scrollWidth, vw: innerWidth }));
  check(ph.w > 330 && ph.sw <= ph.vw + 1, 'the phone: the Roll takes the width and nothing scrolls sideways ' + JSON.stringify(ph));
  const keys = await Ph.page.$$eval('#gm-buttons .gm-btn', (b) => b.map((x) => Math.round(x.getBoundingClientRect().top)));
  check(keys.length === 4 && new Set(keys).size === 1, 'the four keys in one row on the phone');
  check(await Ph.page.$eval('#gm-buttons .gm-btn', (b) => b.getBoundingClientRect().height >= 44), 'tall enough to tap');
  await Ph.c.close();

  check(errors.length === 0, 'no console errors: ' + JSON.stringify(errors.slice(0, 3)));
  await browser.close();
} catch (e) {
  console.log('FAIL ' + (e && e.stack || e)); failed++;
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
