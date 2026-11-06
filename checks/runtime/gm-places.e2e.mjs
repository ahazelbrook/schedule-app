// The places of the night (app/gm/places.js; the night rebuild N1b) on the real GM page, against the demo night (scripts/demo-night.mjs, a local Worker holding
// one complete invented night) on PORT (default 8860; its inspector takes PORT + 20000).
//   1. Before: a page with no phase opens there; its left column is Preflight (the tool, drawn inline) and Tonight; Tonight, The room, Print and iPad scenes.
//   2. Ctrl+Left / Ctrl+Right walk the places without changing the phase; Opening's Hard start and Titles (Prep at the place's heading).
//   3. A place of the night entered through the page's host (as the band does) enters the phase; the Roll is the left column there; each place's first view.
//   4. Follow the night: a phase entered by a cue (GO on the note's "phase:" cue), by the night controller, or on another GM device takes the page there; not
//      out of Between.
//   5. Tools come to you: a key for a view the place does not lay out opens it as an extra view (with a ×); a tool the place holds is shown where it is.
//   6. Prep opens at the place's heading, and turns to the new place's when the place changes while it shows.
//   7. Find: places and tools ("go to planning", "front page", "montage").
//   8. Between's desks: a desk opens its tool inline with "← Desks"; Esc goes back; a generator desk shows its pane.
//   9. The Aftermath: the crew, callAftermath (the curfew's Call the Aftermath) enters the phase, goes there and starts the show.
//  10. A roll in a place whose column is its own brings the Roll in; the memory survives a reload; the GM's phone (390 x 844) end to end.
//   PW_MODULE=<playwright> PW_CHANNEL=msedge PORT=8860 node checks/runtime/gm-places.e2e.mjs      (GM_SHOTS=<dir> keeps screenshots)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8860);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const SHOTS = process.env.GM_SHOTS || '';
const WIN = process.platform === 'win32';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 150) { const t0 = Date.now(); for (;;) { let v; try { v = await fn(); } catch (_) { v = null; } if (v || Date.now() - t0 > ms) return v; await sleep(step); } }

/* the demo night, in a state folder of our own */
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use: stop what is on it, or set PORT'); process.exit(1); }
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-places-e2e-'));
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
delete env.ANTHROPIC_API_KEY; delete env.B68_ANTHROPIC_KEY;
const demo = spawn(process.execPath, [path.join(ROOT, 'scripts', 'demo-night.mjs'), '--port', String(PORT), '--state', stateDir], { cwd: ROOT, env, detached: !WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let demoLog = '';
demo.stdout.on('data', (d) => { demoLog += d; }); demo.stderr.on('data', (d) => { demoLog += d; });
function stopDemo() { if (WIN) spawnSync('taskkill', ['/pid', String(demo.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-demo.pid, 'SIGKILL'); } catch (_) {} } }
process.on('exit', () => { stopDemo(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + demoLog.slice(-2000)); process.exit(1); }, 600000);
const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const nightPhase = async () => { const d = (await api('GET', '/gm/state')).json; return d && d.doc && d.doc.night ? d.doc.night.phase || '' : ''; };

try {
  const up = await until(() => /Ctrl\+C stops it/.test(demoLog) || demo.exitCode !== null, 300000, 500);
  if (!up || demo.exitCode !== null) throw new Error('the demo night did not come up:\n' + demoLog.slice(-2000));
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open({ w = 1366, h = 768, mobile = false, ctx = null } = {}) {
    const c = ctx || await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w, height: h }, serviceWorkers: 'block', ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
    if (!ctx) await c.addInitScript(() => { window.__B68_POLL_MS = 700; });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '/#gm');
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me && window.B68GmPage && window.B68GmPage._places && window.B68GmPage._places(), null, { timeout: 40000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { state: 'attached', timeout: 30000 });
    await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await sleep(500);
    return { c, page };
  }
  const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png'), animations: 'disabled' }); } };
  const st = (page) => page.evaluate(() => window.B68GmPage._places()._state());
  const attr = (page, a) => page.$eval('#gm-root', (r, x) => r.getAttribute(x), a);
  const views = (page) => page.$$eval('.gm-views [data-pv]', (els) => els.map((e) => e.getAttribute('data-pv')));
  const visible = (page, sel) => page.$eval(sel, (e) => !!e && !e.closest('[hidden]') && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0).catch(() => false);
  const blur = (page) => page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  const key = async (page, k) => { await blur(page); await page.keyboard.press(k); await sleep(250); };
  /* a heading's top against its pane's (the laptop: each view scrolls on its own) */
  const headTop = (page, id) => page.evaluate((i) => { const p = document.querySelector('#gm-prep'), e = document.getElementById(i); return p && e ? Math.round(e.getBoundingClientRect().top - p.getBoundingClientRect().top) : null; }, id);

  /* ---- 1. Before ---- */
  check(await nightPhase() === '', 'the demo night has no phase in play yet');
  const A = await open();
  const a = A.page;
  check(await attr(a, 'data-place') === 'before' && await attr(a, 'data-left') === 'own', 'a page with no phase opens in Before, with a left column of its own');
  check(!(await visible(a, '#gm-buttons')) && await visible(a, '#gm-left'), 'Before\'s column is its own, not the Roll');
  check(await until(() => a.$eval('#gm-left [data-inline="preflight"]', (e) => /iPad sound/.test(e.textContent)), 10000), 'Preflight is drawn inline in the column (N2\'s inline host)');
  check(await a.$eval('#gm-left', (e) => /Tonight/.test(e.textContent) && e.querySelector('[data-tn-time=startAt]').value === '19:30' && e.querySelector('[data-tn-time=curfewAt]').value === '22:40' && /8\s*cues/.test(e.textContent) && /6\s*rooms/.test(e.textContent)), 'and Tonight: the start, the curfew, eight cues and six rooms, read from the prep note');
  check(JSON.stringify(await views(a)) === JSON.stringify(['tonight', 'room', 'print', 'ipadscenes', 'prep', 'rules', 'npc', 'ipad']), 'Before\'s views: Tonight, The room, Print, iPad scenes, then Prep, Rules, Cast and iPad');
  check(await a.$eval('.gm-views [data-pv="tonight"]', (e) => e.getAttribute('aria-selected')) === 'true' && await visible(a, '#gm-vpane'), 'Tonight is the first view');
  check(await a.$eval('#gm-vpane', (e) => e.querySelectorAll('.gm-tn-run tbody tr').length === 5 && /Before the night/.test(e.textContent) && /Charge the iPad/.test(e.textContent) && /Tonight/.test(e.textContent)), 'Tonight: the note\'s run order (five beats) and its Before the night and Tonight sections');
  check(await a.$$eval('#gm-vpane .gm-tn-run tbody tr td:nth-child(3)', (td) => td.map((x) => x.textContent).join()) === 'Opening,Personal,Planning,Score,Aftermath', 'each beat named by its place');
  await shot(a, 'before-1366');
  await a.click('.gm-views [data-pv="room"]');
  check(await until(() => a.$eval('#gm-vpane', (e) => ['music', 'practical', 'phone', 'light', 'record'].every((t) => e.querySelector('[data-vcell="' + t + '"] [data-inline="' + t + '"]'))), 6000), 'The room: the music, the practical speaker, the ringing phone, the light relay and the recording, each drawn inline');
  await a.click('.gm-views [data-pv="print"]');
  check(await until(() => a.$eval('#gm-vpane [data-inline="print"]', (e) => !!e), 5000) && !(await a.$('#gm-vpane [data-inline="practical"]')), 'Print: its tool inline, and The room\'s four unbound');
  await a.click('.gm-views [data-pv="ipadscenes"]');
  check(await attr(a, 'data-panel') === 'ipad' && await visible(a, '#gm-ipad'), 'iPad scenes: the iPad view');

  /* ---- 2. Ctrl+arrows: navigation only ---- */
  await key(a, 'Control+ArrowRight');
  check(await attr(a, 'data-place') === 'opening' && await nightPhase() === '', 'Ctrl+Right: the Opening, and the night has no phase still');
  check(await until(() => a.$eval('#gm-left [data-inline="hardstart"]', (e) => /GO now|Arm|start/i.test(e.textContent)), 8000), 'the Opening\'s column is the Hard start, inline');
  check(await attr(a, 'data-panel') === 'prep' && await a.$eval('.gm-views [data-pv="titles"]', (e) => e.getAttribute('aria-selected')) === 'true', 'its first view is Titles: Prep');
  const tt = await headTop(a, 'pp-titles');
  check(tt !== null && tt >= -4 && tt <= 60, 'at the note\'s "Titles" heading (' + tt + ' px from the top of the view)');
  await shot(a, 'opening-1366');
  await key(a, 'Control+ArrowRight');
  check(await attr(a, 'data-place') === 'pb' && await nightPhase() === '', 'Ctrl+Right again: Personal, still no phase (no phase change until the GM goes into it)');
  await key(a, 'Control+ArrowLeft'); await key(a, 'Control+ArrowLeft'); await key(a, 'Control+ArrowLeft');
  check(await attr(a, 'data-place') === 'before', 'Ctrl+Left walks back and stops at Before');

  /* ---- 3. a place of the night entered as the band does: the phase, the Roll, its first view ---- */
  await a.evaluate(() => window.B68GmPage.goPlace('pb'));
  check(await until(async () => (await nightPhase()) === 'pb', 8000), 'goPlace(Personal) enters the phase (the night controller, as the rail did)');
  check(await attr(a, 'data-left') === 'roll' && await visible(a, '#gm-buttons') && !(await visible(a, '#gm-left')), 'Personal\'s column is the Roll');
  check(JSON.stringify(await views(a)) === JSON.stringify(['downtime', 'debrief', 'trouble', 'prep', 'rules', 'npc', 'ipad']) && await attr(a, 'data-panel') === 'downtime', 'Personal: Downtime first, Debrief replies, Trouble desk');
  await a.click('.gm-views [data-pv="debrief"]');
  check(await until(() => a.$eval('#gm-vpane [data-inline="debrief"]', (e) => !!e), 5000), 'Debrief replies: the debrief tool, inline');
  await shot(a, 'pb-1366');

  /* ---- 4. follow the night ---- */
  /* the note's cues: 1 scene, 2 show, 3 light, 4 phase: pb, 5 phase: plan. GO (Space) until the fifth has fired. Personal is in play already (goPlace
     entered it): a phase: cue for the phase in play is done at once (N1a), so GO goes straight on past the fourth, no Bypass */
  for (let i = 0; i < 12 && (await attr(a, 'data-place')) !== 'plan'; i++) { await key(a, 'Space'); await sleep(900); }
  check(await until(async () => (await attr(a, 'data-place')) === 'plan', 8000) && await nightPhase() === 'plan', 'a phase: cue (GO on the note\'s "phase: plan") moves the night, and the page follows it to Planning');
  check(JSON.stringify(await views(a)) === JSON.stringify(['cards', 'corkboard', 'run', 'score', 'handouts', 'prep', 'rules', 'npc', 'ipad']) && await attr(a, 'data-panel') === 'cards', 'Planning: Opportunities first, Intel, The site, the Score generator, the Handouts');
  check(await until(() => a.$eval('#gm-opps-players [data-inline="board"]', (e) => !!e), 6000) && await a.$eval('#gm-opps-gm', (e) => e.querySelectorAll('.oc-card').length >= 1), 'Opportunities: the players\' board over the GM\'s own cards');
  await shot(a, 'plan-1366');
  const B = await open({ w: 1280, h: 800 });
  check(await attr(B.page, 'data-place') === 'plan', 'a second GM device opens in the night\'s place');
  await B.page.evaluate(() => window.B68GmPage._night().enter('score'));
  /* the GM page takes another device's changes when it comes back into focus (refetch): the GM puts the phone down and looks at the laptop */
  await until(async () => (await nightPhase()) === 'score', 8000);
  await a.evaluate(() => window.dispatchEvent(new Event('focus')));
  check(await until(async () => (await attr(a, 'data-place')) === 'score', 12000), 'a phase entered on another GM device: this page follows it to the Score (when it is looked at again)');
  check(await attr(a, 'data-panel') === 'run' && await until(() => a.$eval('#gm-runv .rv-head', (e) => !!e), 8000), 'the Score opens at The site');
  await shot(a, 'score-1366');
  await B.page.evaluate(() => window.B68GmPage.goPlace('between'));
  await a.evaluate(() => window.B68GmPage._night().enter('after'));
  await sleep(2500);
  check(await attr(B.page, 'data-place') === 'between', 'the GM in Between is not taken out of it');
  check(await attr(a, 'data-place') === 'after', 'the night controller moving the phase takes this page with it (the Aftermath)');
  await B.c.close();

  /* ---- 5. tools come to you ---- */
  await a.evaluate(() => window.B68GmPage.goPlace('plan', { navigateOnly: true }));
  await key(a, 'c');
  check(await attr(a, 'data-panel') === 'chase' && await attr(a, 'data-place') === 'plan' && JSON.stringify(await views(a)) === JSON.stringify(['cards', 'corkboard', 'run', 'score', 'handouts', 'chase', 'prep', 'rules', 'npc', 'ipad']), 'C in Planning: the Chase comes to Planning as an extra view, at the end of its own');
  check(!!(await a.$('.gm-views [data-pvx="chase"]')) && await nightPhase() === 'after', 'with a × to drop it; the night stays where it was');
  await a.click('.gm-views [data-pvx="chase"]');
  check(!(await views(a)).includes('chase') && await attr(a, 'data-panel') === 'cards', '× drops it: back to the view before it');
  await key(a, 'g');
  check(await attr(a, 'data-panel') === 'run', 'G: The site, Planning\'s own view');
  await a.evaluate(() => window.B68GmPage.openView('board'));
  check(await attr(a, 'data-panel') === 'cards' && !(await views(a)).includes('board'), 'the board, which Opportunities holds, opens there and not as a second copy');
  await a.evaluate(() => window.B68GmPage.goPlace('before', { navigateOnly: true }));
  await a.evaluate(() => window.B68GmPage.openView('practical'));
  check((await st(a)).view === 'room', 'the practical speaker in Before: The room');

  /* ---- 6. Prep at the place's heading ---- */
  await a.evaluate(() => window.B68GmPage.goPlace('plan', { navigateOnly: true }));
  await key(a, 'r');
  const br = await headTop(a, 'pp-briefing');
  check(await attr(a, 'data-panel') === 'prep' && br !== null && br >= -4 && br <= 60, 'R in Planning: Prep at "Briefing" (' + br + ' px)');
  await blur(a);
  await key(a, 'Control+ArrowRight');
  const sc = await headTop(a, 'pp-score');
  check(await attr(a, 'data-place') === 'score' && await attr(a, 'data-panel') === 'prep' && sc !== null && sc >= -4 && sc <= 60, 'moving to the Score while Prep shows: Prep stays, at "Score" (' + sc + ' px)');

  /* ---- 7. Find: places and tools ---- */
  const find = async (q) => { await blur(a); await a.keyboard.press('Control+k'); await a.fill('#gm-find-q', q); await sleep(300); const first = await a.$eval('.gm-find-hit[aria-selected="true"]', (e) => e.textContent).catch(() => ''); await a.keyboard.press('Enter'); await sleep(500); return first; };
  const f1 = await find('front page');
  check(/Front page/.test(f1) && (await st(a)).view === 'frontpage' && await attr(a, 'data-place') === 'score', 'Find "front page": the tool, in the place the GM is in (' + f1.replace(/\s+/g, ' ').slice(0, 60) + ')');
  check(await until(() => a.$eval('#gm-vpane [data-inline="frontpage"]', (e) => !!e), 5000), 'drawn inline as an extra view');
  const f2 = await find('montage');
  check(/Montage/.test(f2) && (await st(a)).view === 'montage', 'Find "montage" opens the montage');
  const f3 = await find('go to planning');
  check(/Go to Planning/.test(f3) && await attr(a, 'data-place') === 'plan' && await until(async () => (await nightPhase()) === 'plan', 8000), 'Find "go to planning": the place, the night moved there as the band\'s chip would');

  /* ---- 8. Between's desks ---- */
  await a.evaluate(() => window.B68GmPage.goPlace('between'));
  check(await nightPhase() === 'plan' && await attr(a, 'data-left') === 'slim', 'Between never changes the phase; its column is the list of the desks');
  check(await a.$$eval('#gm-vpane .gm-desk', (d) => d.length) === 10, 'Desks: ten desks, the generators among them');
  await shot(a, 'between-1366');
  await a.click('#gm-vpane .gm-desk[data-desk="frontpage"]');
  check(await until(() => a.$eval('#gm-vpane [data-inline="frontpage"]', (e) => !!e), 5000) && await a.$eval('#gm-vhead', (e) => !e.hidden && /← Desks/.test(e.textContent) && /Front page/.test(e.textContent)), 'a desk opens its tool inline, under "← Desks"');
  check(await a.$eval('#gm-left [data-desk="frontpage"]', (e) => e.getAttribute('aria-current')) === 'true', 'the column marks the open desk');
  /* a real Esc press: the page's one Esc (onKey -> B68GmEsc.handle, N1a) closes the open desk, and it is not a PANIC */
  await blur(a); await a.keyboard.press('Escape'); await sleep(300);
  check(await a.$$eval('#gm-vpane .gm-desk', (d) => d.length) === 10 && await a.$eval('#gm-vhead', (e) => e.hidden), 'Esc goes back to the desks');
  check(!(await a.$('#gm-band .gm-band-r2[data-alarm="panic"]')), 'and the press was not a PANIC');
  await a.click('#gm-vpane [data-desk="gen:score"]');
  check(await attr(a, 'data-panel') === 'score' && await a.$eval('#gm-vhead', (e) => /Score generator/.test(e.textContent)), 'Generators › Score: the score generator, under "← Desks"');
  await a.click('#gm-vhead [data-pv-desks]');
  check(await attr(a, 'data-panel') === 'view' && await a.$$eval('#gm-vpane .gm-desk', (d) => d.length) === 10, '← Desks');

  /* ---- 9. the Aftermath: the crew, and Call the Aftermath ---- */
  await a.evaluate(() => window.B68GmPage.goPlace('score'));
  await until(async () => (await nightPhase()) === 'score', 8000);
  await a.evaluate(() => window.B68GmPage.callAftermath());
  check(await attr(a, 'data-place') === 'after' && await until(async () => (await nightPhase()) === 'after', 8000), 'callAftermath (the curfew\'s Call the Aftermath): the night enters the Aftermath and the page is there');
  check(await until(async () => { const d = (await api('GET', '/gm/state')).json; return d && d.doc && d.doc.night && d.doc.night.aftermath && d.doc.night.aftermath.step === 'payout'; }, 10000), 'and the show is started: its first step, the payout, is on');
  check(await until(() => a.$eval('#gm-vpane [data-inline="aftermath"]', (e) => /Payout/.test(e.textContent) && /Next/.test(e.textContent)), 6000), 'the show inline, at its first step, with Next');
  check(await a.$eval('#gm-left', (e) => /Nell Arbuthnot/.test(e.textContent) && /Stress/.test(e.textContent) && /Can turn: KEY-1/.test(e.textContent) && /Debrief: send to phones/.test(e.textContent) && /End the night/.test(e.textContent)), 'the column: the crew (Stress, harm, the key Nell can turn), Debrief, Cast photo, End the night');
  await shot(a, 'after-1366');
  await a.click('#gm-left [data-pv="castphoto"]');
  check((await st(a)).extra === 'castphoto' && await until(() => a.$eval('#gm-vpane [data-inline="castphoto"]', (e) => !!e), 5000), 'Cast photo opens beside the show as an extra view');

  /* ---- 10. a roll in a column of its own; the memory; the phone ---- */
  await a.evaluate(() => window.B68GmPage.goPlace('opening', { navigateOnly: true }));
  await key(a, '2');
  check(await until(async () => (await attr(a, 'data-left')) === 'roll', 4000) && await visible(a, '#gm-card') && await visible(a, '#gm-left [data-left-back]'), 'a roll in the Opening brings the Roll into the column, under a strip back to the Hard start');
  await a.click('#gm-left [data-left-back]');
  check(await attr(a, 'data-left') === 'own' && await until(() => a.$eval('#gm-left [data-inline="hardstart"]', (e) => !!e), 5000), 'the strip puts the Hard start back');
  await a.evaluate(() => window.B68GmPage.goPlace('before', { navigateOnly: true }));
  await a.click('.gm-views [data-pv="print"]');
  await a.evaluate(() => window.B68GmPage.goPlace('plan', { navigateOnly: true }));
  await key(a, 's');
  await a.reload(); await a.waitForFunction(() => window.B68GmPage && window.B68GmPage._places && window.B68GmPage._places(), null, { timeout: 30000 }); await sleep(800);
  check(await attr(a, 'data-place') === 'plan' && (await st(a)).view === 'scenes' && (await views(a)).includes('scenes'), 'a reload keeps the place, its view and its extra view (the phase has not moved)');
  await a.evaluate(() => window.B68GmPage.goPlace('before', { navigateOnly: true }));
  check((await st(a)).view === 'print', 'and each place\'s last view (Before: Print)');
  await A.c.close();
  await api('PATCH', '/gm/state', { night: { phase: 'pb' } });       /* the night moved while no page was open */
  const C = await open();
  check(await attr(C.page, 'data-place') === 'pb', 'a phase that moved while the page was shut: the page opens in its place');
  await C.c.close();

  /* T10: the way forward. Every place's left column ends in Next: <place> → (and ← Back), on screen at 1366 x 768; the Opening's Next takes the hard
     start and the opening credits off the iPad and starts Personal business; ← Back only looks */
  await api('PATCH', '/gm/state', { night: { phase: '' } });
  await api('PATCH', '/gm/ambient', { mode: 'pin', scene: 'credits' });
  await api('PATCH', '/gm/ambient', { layer: { path: 'scene.mode', value: 'start' } });
  await api('PATCH', '/gm/ambient', { layer: { path: 'data.countdown', value: { to: Date.now() + 600000, label: 'Station clock' } } });
  const pre = (await api('GET', '/gm/ambient')).json, preL = (pre && pre.doc && pre.doc.layers) || {};
  check(pre && pre.doc && pre.doc.mode === 'pin' && pre.doc.scene === 'credits' && preL.scene && preL.scene.mode === 'start', 'T10 setup: the hard start and the credits pin are up ' + JSON.stringify(preL.scene || null));
  const N = await open();
  const n = N.page;
  const foot = (pg) => pg.evaluate(() => { const f = document.querySelector('.gm-pnext'); if (!f) return null; const r = f.getBoundingClientRect(); return { col: f.parentElement.id, last: f.parentElement.lastElementChild === f, text: f.innerText.replace(/\s+/g, ' ').trim(), top: Math.round(r.top), bottom: Math.round(r.bottom), vh: innerHeight, count: document.querySelectorAll('.gm-pnext').length }; });
  const WANT = { before: ['gm-left', 'Next: Opening →'], opening: ['gm-left', 'Start Personal → ends the hard start ← Back'], pb: ['gm-roll', 'Start Planning → ← Back'], plan: ['gm-roll', 'Start Score → ← Back'], score: ['gm-roll', 'Start Aftermath → ← Back'], after: ['gm-left', '← Back'] };      /* no phase yet: each phase place's Next starts it, and says so */
  for (const id of Object.keys(WANT)) {
    await n.evaluate((i) => window.B68GmPage.goPlace(i, { navigateOnly: true }), id); await sleep(300);
    const f = await foot(n);
    check(!!f && f.count === 1 && f.col === WANT[id][0] && f.last && f.text.toUpperCase() === WANT[id][1].toUpperCase() && f.top >= 0 && f.bottom <= f.vh, 'T10 ' + id + ': the column ends in "' + WANT[id][1] + '", on screen at 1366 x 768 ' + JSON.stringify(f));
  }
  await n.evaluate(() => window.B68GmPage.goPlace('between'));
  check(!(await foot(n)), 'T10 Between: no Next (it is not the night)');
  await n.evaluate(() => window.B68GmPage.goPlace('opening', { navigateOnly: true })); await sleep(300);
  await n.click('.gm-pnext [data-place-next]');
  check(await until(async () => (await st(n)).place === 'pb' && await nightPhase() === 'pb', 8000), 'T10 Opening\'s Next: the page is in Personal and the night in Personal business');
  const offAir = await until(async () => { const a = (await api('GET', '/gm/ambient')).json, d = a && a.doc, L = (d && d.layers) || {}; return d && d.mode !== 'pin' && !(L.scene && L.scene.mode) && !(L.data && L.data.countdown) ? d : null; }, 10000);
  check(!!offAir && offAir.mode === 'auto', 'T10 Opening\'s Next: the hard start\'s layers came off and the credits pin went back to Auto ' + JSON.stringify(offAir && { mode: offAir.mode, scene: offAir.scene }));
  await n.click('.gm-pnext [data-place-back]'); await sleep(400);
  check((await st(n)).place === 'opening' && await nightPhase() === 'pb', 'T10 ← Back looks at the Opening; the night stays in Personal business');
  check(/^Next: Personal/i.test((await foot(n)).text), 'T10 a Next that only looks says Next:, not Start ' + JSON.stringify((await foot(n)).text));
  await sleep(1000); await n.click('.gm-pnext [data-place-next]'); await sleep(1000);      /* Nexts a second apart: past the double-tap guard */
  await n.click('.gm-pnext [data-place-next]');
  check(await until(async () => (await st(n)).place === 'plan' && await nightPhase() === 'plan', 8000), 'T10 Next from Personal starts Planning, as its chip does');
  await n.click('.gm-pnext [data-place-back]'); await sleep(300); await n.click('.gm-pnext [data-place-back]'); await sleep(1000);
  await n.click('.gm-pnext [data-place-next]'); await sleep(500);
  check((await st(n)).place === 'pb' && await nightPhase() === 'plan', 'T10 Back, Back, Next: a look at Personal, never a rewind of the night');
  /* a double click on Next is one Next: from Planning it starts the Score, never the Aftermath */
  await sleep(1000); await n.click('.gm-pnext [data-place-next]'); await sleep(400);
  check((await st(n)).place === 'plan', 'T10 (to Planning, for the double click)');
  await sleep(1000); await n.dblclick('.gm-pnext [data-place-next]'); await sleep(1200);
  check((await st(n)).place === 'score' && await nightPhase() === 'score', 'T10 a double click on Start Score from Planning: the Score, not the Aftermath (' + (await st(n)).place + ', ' + await nightPhase() + ')');

  /* T13: Prep's index has a second level: each section's ### headings under its ## chip, folded but for the section in view; each a jump that
     lands below the top; the ▸ folds them by hand; the find box and Find (Ctrl K) still work */
  await n.evaluate(() => window.B68GmPage.goPlace('score', { navigateOnly: true })); await sleep(300);
  await key(n, 'r'); await sleep(600);
  const idx = () => n.evaluate(() => ({ chips: document.querySelectorAll('#gm-prep .pp-rail > [data-gm="prep-go"]').length, heads: document.querySelectorAll('#gm-prep .pp-doc > .pp-sec > h3').length,
    subs: [...document.querySelectorAll('#gm-prep .pp-subs')].map((g) => ({ of: g.getAttribute('data-subs'), open: !g.hidden && g.getBoundingClientRect().height > 0, n: [...g.children].filter((b) => b.getAttribute('data-gm') === 'prep-sub').length, n3: g.querySelectorAll('.pp-subs3 [data-gm="prep-sub"]').length,
      open3: [...g.querySelectorAll('.pp-subs3')].filter((x) => !x.hidden && x.getBoundingClientRect().height > 0).map((x) => x.querySelectorAll('button').length), cur: [...g.querySelectorAll('[aria-current="true"]')].map((b) => b.textContent).join(' > ') })),
    cur: (document.querySelector('#gm-prep .pp-rail [data-gm="prep-go"][aria-current="true"]') || {}).textContent || '' }));
  const grp = (x, of) => x.subs.find((g) => g.of === of) || {};
  await n.evaluate(() => { document.querySelector('#gm-prep').scrollTop = 0; }); await sleep(400);
  let ix = await idx();
  check(ix.subs.length === 2 && grp(ix, 'pp-rooms').n === 6 && !grp(ix, 'pp-rooms').open && grp(ix, 'pp-downtime').n === 3 && grp(ix, 'pp-downtime').n3 === 3, 'T13 the index: Rooms holds six ###, Downtime three ### with three #### under them; folded while not in view; sections with neither have none ' + JSON.stringify(ix.subs));
  await n.click('#gm-prep .pp-rail [data-gm="prep-go"][data-id="pp-rooms"]');
  check(await until(async () => { const x = await idx(); return x.cur === 'Rooms' && grp(x, 'pp-rooms').open && !grp(x, 'pp-downtime').open; }, 5000), 'T13 Rooms in view: its rooms open under it, and only its');
  const rooms = '#gm-prep .pp-subs[data-subs="pp-rooms"] > [data-gm="prep-sub"]';
  await n.click(rooms + ':nth-child(4)');
  const landed = await until(() => n.evaluate((sel) => { const b = document.querySelector(sel), h = document.getElementById(b.getAttribute('data-id')), p = document.querySelector('#gm-prep'); const t = Math.round(h.getBoundingClientRect().top - p.getBoundingClientRect().top); return t >= 0 && t <= 60 && b.getAttribute('aria-current') === 'true' ? { t, text: b.textContent } : null; }, rooms + ':nth-child(4)'), 5000);
  check(!!landed, 'T13 a room in the index jumps to its heading, just under the top of the pane, and is marked ' + JSON.stringify(landed));
  await n.click('#gm-prep .pp-subt[data-subt="pp-rooms"]'); await sleep(200);
  await n.evaluate(() => { document.querySelector('#gm-prep').scrollTop += 40; }); await sleep(400);
  check(!grp(await idx(), 'pp-rooms').open, 'T13 the ▸ folds them by hand, and they stay folded while Rooms is read');
  await n.click('#gm-prep .pp-subt[data-subt="pp-rooms"]'); await sleep(200);
  check(grp(await idx(), 'pp-rooms').open, 'T13 and opens them again');
  /* the third level: within Downtime, a PC's ### opens its #### scenes while it is read; a scene is a jump and is marked under its PC */
  await n.click('#gm-prep .pp-rail [data-gm="prep-go"][data-id="pp-downtime"]');
  check(await until(async () => { const x = await idx(); return x.cur === 'Downtime' && grp(x, 'pp-downtime').open; }, 5000), 'T13 Downtime in view: its three PCs open under it (Rooms stays open: the GM opened it by hand)');
  const dt = '#gm-prep .pp-subs[data-subs="pp-downtime"]';
  await n.click(dt + ' > [data-gm="prep-sub"]:first-child');
  check(await until(async () => JSON.stringify(grp(await idx(), 'pp-downtime').open3) === '[2]', 5000), 'T13 the first PC read: its two #### scenes open under it, the others stay shut ' + JSON.stringify(grp(await idx(), 'pp-downtime')));
  await n.click(dt + ' .pp-subs3 [data-gm="prep-sub"]:nth-child(2)');
  const scn = await until(() => n.evaluate((sel) => { const b = document.querySelector(sel), h = document.getElementById(b.getAttribute('data-id')), p = document.querySelector('#gm-prep'); const t = Math.round(h.getBoundingClientRect().top - p.getBoundingClientRect().top); return t >= 0 && t <= 60 && b.getAttribute('aria-current') === 'true' ? { t, text: b.textContent } : null; }, dt + ' .pp-subs3 [data-gm="prep-sub"]:nth-child(2)'), 5000);
  check(!!scn && /long way round/i.test(scn.text) && /Nell > The long way round/.test(grp(await idx(), 'pp-downtime').cur), 'T13 a #### scene jumps under the top and is marked, under its PC ' + JSON.stringify([scn, grp(await idx(), 'pp-downtime').cur]));
  /* the entry being read stays in sight inside the index, which overflows at 768 px once a long section is open */
  await n.evaluate(() => { const p = document.querySelector('#gm-prep'); p.scrollTop = p.scrollHeight; }); await sleep(300);
  await n.click('#gm-prep .pp-rail [data-gm="prep-go"][data-id="pp-rooms"]'); await sleep(900);
  await n.click(rooms + ':nth-child(6)'); await sleep(1200);
  const seen = await n.evaluate(() => { const bar = document.querySelector('#gm-prep .pp-bar'), b = document.querySelector('#gm-prep .pp-subs [aria-current="true"]'); if (!bar || !b) return null; const br = bar.getBoundingClientRect(), r = b.getBoundingClientRect(); return { over: bar.scrollHeight > bar.clientHeight, inside: r.top >= br.top - 1 && r.bottom <= br.bottom + 1, text: b.textContent }; });
  check(!!seen && seen.inside, 'T13 the room being read is in sight inside the index ' + JSON.stringify(seen));
  /* a short window, where the open index overflows: the index scrolls itself to the entry being read */
  await n.setViewportSize({ width: 1366, height: 520 }); await sleep(400);
  await n.evaluate(() => { const bar = document.querySelector('#gm-prep .pp-bar'); if (bar) bar.scrollTop = 0; });
  await n.click(rooms + ':nth-child(5)'); await sleep(1400);
  const seen2 = await n.evaluate(() => { const bar = document.querySelector('#gm-prep .pp-bar'), b = document.querySelector('#gm-prep .pp-subs [aria-current="true"]'); if (!bar || !b) return null; const br = bar.getBoundingClientRect(), r = b.getBoundingClientRect(); return { over: bar.scrollHeight > bar.clientHeight, inside: r.top >= br.top - 1 && r.bottom <= br.bottom + 1, scrolled: bar.scrollTop, text: b.textContent }; });
  check(!!seen2 && seen2.over && seen2.inside && seen2.scrolled > 0, 'T13 at 520 px high the index overflows and scrolls itself to the room being read ' + JSON.stringify(seen2));
  await n.setViewportSize({ width: 1366, height: 768 }); await sleep(400);
  ix = await idx();
  check(ix.chips === ix.heads && ix.chips >= 10, 'T13 the ## rail is as it was: one chip per section (' + ix.chips + ')');
  await n.fill('#gm-prep-q', 'zzqqnothing'); await sleep(300);
  check(await n.evaluate(() => { const g = document.querySelector('#gm-prep .pp-subs'), t = document.querySelector('#gm-prep .pp-subt'); return g.hidden && t.hidden; }), 'T13 a section the find box filters out takes its headings and its ▸ with it');
  await n.fill('#gm-prep-q', ''); await sleep(300);
  await blur(n); await n.keyboard.press('Control+k'); await n.fill('#gm-find-q', 'counting room'); await sleep(400);
  const hit = await n.$eval('.gm-find-hit[aria-selected="true"]', (e) => e.textContent).catch(() => '');
  await n.keyboard.press('Enter'); await sleep(900);
  const fpos = await n.evaluate(() => { const h = [...document.querySelectorAll('#gm-prep .pp-doc h4')].find((e) => /counting room/i.test(e.textContent)), p = document.querySelector('#gm-prep'); return h && !p.hidden ? Math.round(h.getBoundingClientRect().top - p.getBoundingClientRect().top) : null; });
  check(/counting room/i.test(hit) && fpos !== null && fpos >= -2 && fpos <= 80, 'T13 Find (Ctrl K) still finds a room and lands on it in Prep (' + hit.replace(/\s+/g, ' ').slice(0, 60) + ', top ' + fpos + ')');
  await N.c.close();
  await api('PATCH', '/gm/state', { night: { phase: 'pb' } });       /* the phone below opens in the night's place */

  const M = await open({ w: 390, h: 844, mobile: true });
  const m = M.page;
  check(await attr(m, 'data-place') === 'pb', 'the GM\'s phone opens in the night\'s place');
  const chips = await m.$$eval('.gm-vchips .chip', (c) => c.map((x) => { const r = x.getBoundingClientRect(); return { id: x.getAttribute('data-pv') || x.getAttribute('data-seg'), h: Math.round(r.height), right: Math.round(r.right) }; }));
  check(chips.map((x) => x.id).join() === 'console,downtime,debrief,trouble,prep,rules,npc,ipad,state' && chips.every((x) => x.h >= 44 && x.right <= 390), 'phone: the chip row under the bar: the Roll, the place\'s views, the pinned four, the drawer; all on screen, each 44 px tall ' + JSON.stringify(chips.map((x) => x.right)));
  await m.tap('.gm-vchips [data-seg="console"]');
  check(await visible(m, '#gm-buttons') && !(await visible(m, '#gm-dt')), 'the Roll chip shows the column (the console), and not the view');
  await m.tap('.gm-vchips [data-pv="downtime"]');
  check(await visible(m, '#gm-dt') && !(await visible(m, '#gm-buttons')), 'a view chip shows the view');
  await m.evaluate(() => window.B68GmPage.goPlace('before', { navigateOnly: true }));
  await m.tap('.gm-vchips [data-seg="console"]');
  check(await until(() => m.$eval('#gm-left [data-inline="preflight"]', (e) => e.getBoundingClientRect().height > 0), 6000), 'phone: Before\'s chip shows Preflight');
  await m.tap('.gm-vchips [data-pv="tonight"]');
  check(await visible(m, '#gm-vpane .gm-tn-run'), 'and Tonight');
  const over = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check(over <= 1, 'phone: nothing wider than the screen (' + over + ' px)');
  await shot(m, 'before-390');
  await m.evaluate(() => window.B68GmPage.goPlace('between'));
  check(!(await m.$('.gm-vchips [data-seg="console"]')) && await visible(m, '#gm-vpane .gm-desks') && !(await visible(m, '#gm-left')), 'phone, Between: the desks are the view (no column chip)');
  await M.c.close();

  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 4).join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e) + '\n' + demoLog.slice(-1500));
}
clearTimeout(timeout);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
