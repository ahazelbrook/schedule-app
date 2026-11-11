// kit-stage-roll (KS15, the roll as beats, S4, behind kit.stage), end to end on the real GM page, Worker and iPad (wrangler dev on PORT, default
// 9413; the inspector on PORT + 20000). Invented fixtures only (Ray, risky, standard, "She calls the desk.", the cost "Lotte remembers your face.";
// GM-ONLY- markers for anything hidden). Blade's endpoints are faked: no model, $0.
//   stamp     the Roll stamps: the report carries who; the iPad draws the stakes plate (who goes for it, the line, RISKY / STANDARD)
//   result    key 2 lays the SAME overlay id again with result 45 for 8 s: the slam in plain words and a timed plate; nothing taken down
//   cost      the Roll's "Cost on the iPad" field, Enter: the cost beat; a cost naming a hidden NPC is refused, said, and kept in the field;
//             an unsent cost never reaches the display GET
//   chip      the beat folds into the last-roll chip on the idle stage; a reload of the iPad clears it, with no error
//   replace   a second stamp over the first (stakes over stakes, and stakes over a result)
//   one Esc   Esc, Take it down and Clean at every beat; nothing is laid again after a takedown
//   off       with kit.stage off a mark takes the card down as today and the stamp carries no who
// The display makes no request outside its own origin. KIT_SHOTS=<dir> saves the pictures.
//   PW_MODULE=<path to playwright-core> [PW_CHANNEL=msedge] [PORT=9413] [KIT_SHOTS=<dir>] node checks/runtime/kit-stage-roll.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9413);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const SHOTS = process.env.KIT_SHOTS || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), np = fx('npc-pack.json');
const PARTS = {
  console: con.parts.console, campaign: np.parts.campaign, npc: np.parts.npc,
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: new Date().toISOString() }, T: loc.T, extra: loc.extra },
};
const LINE = 'She calls the desk.', COST = 'Lotte remembers your face.';

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-kit-stage-roll-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
delete env.B68_ANTHROPIC_KEY; delete env.ANTHROPIC_API_KEY;
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'DISPLAY_EMAILS:' + IPAD],
{ cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: 'ignore' });
function killServer() {
  if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} }
}
process.on('exit', () => { killServer(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j }; });
const ambientDoc = async () => { const j = (await api('GET', '/gm/ambient')).json || {}; return j.doc || {}; };
const ov = async () => (await ambientDoc()).overlay || null;
/* the GM page reads its settings from the GM state and publishes the display's to the campaign: both are set, so neither undoes the other */
const setting = async (on) => { const a = await api('PATCH', '/gm/state', { features: { 'kit.stage': on } }); const b = await api('PATCH', '/campaign', { features: { 'kit.stage': on } }); return a.status !== 200 ? a : b; };
const displayGet = async () => JSON.stringify((await api('GET', '/gm/display?seq=-1&aseq=-1&sseq=-1', null, IPAD)).json || {});
function chromium() { return require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright').chromium; }

try {
  const upOk = await until(async () => { try { return (await fetch(BASE + '/index.html')).status > 0; } catch (_) { return false; } }, 90000, 500);
  if (!upOk) throw new Error('the server did not start');
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status);
  }
  await api('PUT', '/campaign', { v: 1, session: { number: 1, startedAt: new Date().toISOString(), endedAt: null }, crew: { name: 'The Dovetail Crew', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] }, clocks: [], log: [] });
  await api('PUT', '/npcs/npc_lotte', { name: 'Lotte Brand', role: 'Doorwoman', revealed: true, firstSeen: new Date().toISOString() });
  await api('PUT', '/npcs/npc_hid', { name: 'GM-ONLY-NPC-1', role: 'GM-ONLY-ROLE', revealed: false });
  await api('PUT', '/gm/display', { kind: 'blank' });
  await api('PATCH', '/gm/ambient', { mode: 'pin', scene: 'duskwall' });
  const r0 = await setting(true); if (r0.status !== 200) throw new Error('kit.stage on -> ' + r0.status + ' ' + JSON.stringify(r0.json));
  await api('PATCH', '/gm/state', { con: { live: { pc: 'Ray' } } });

  const browser = await chromium().launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  /* the GM page: Blade's endpoints faked (no model) */
  const G = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await G.addInitScript(atPlace('score'));
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await G.route('**/api/gm/assist/**', (route) => json(route, { cards: [], updates: [], flags: [], asks: [], marked: 1, error: 'no model in this check' }, /\/(ask|act|fit)/.test(route.request().url()) ? 500 : 200));
  const page = await G.newPage();
  page.on('pageerror', (e) => errors.push('gm: ' + e.message));
  await page.goto(BASE + '/#gm');
  await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  /* the iPad */
  const D = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1024, height: 768 }, serviceWorkers: 'block' });
  const ipad = await D.newPage();
  const outside = [];
  ipad.on('request', (q) => { if (!q.url().startsWith(BASE)) outside.push(q.url()); });
  ipad.on('pageerror', (e) => errors.push('ipad: ' + e.message));
  await ipad.goto(BASE + '/');
  await ipad.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 20000 });
  check(!!(await until(() => ipad.evaluate(() => !!document.querySelector('.dp-root .stage-frame') && !!window.B68StageRoll), 30000, 250)), 'kit.stage on: the iPad has the stage frame and the roll module');

  const STAMP = '#gm-stamp [data-gm="stamp"]';
  const beat = () => ipad.evaluate(() => { const b = document.querySelector('.dp-overlay .ks15-beat:not([hidden])'); return b ? { beat: b.getAttribute('data-ks15-beat'), text: b.innerText.replace(/\s+/g, ' ') } : null; });
  const beatIs = (name, ms = 12000) => until(async () => { const b = await beat(); return b && b.beat === name ? b : null; }, ms, 150);
  const noBeat = (ms = 20000) => until(async () => !(await beat()), ms, 200);
  const chip = () => ipad.evaluate(() => { const c = document.querySelector('.stage-slot-roll .ks15-chip'); if (!c) return null; const cs = getComputedStyle(c.parentNode); return { text: c.innerText.replace(/\s+/g, ' ').trim(), shown: cs.visibility !== 'hidden' && cs.display !== 'none' }; });
  /* the pictures (KIT_SHOTS only): each beat at the iPad's three sizes, named <view>-<theme>-<width>.png; the page's fade has landed first */
  const IPAD_SIZES = [[1024, 768], [1180, 820], [768, 1024]];
  const shot = async (view, theme = 'night') => {
    if (!SHOTS) return; mkdirSync(SHOTS, { recursive: true }); await sleep(700);
    for (const [w, h] of IPAD_SIZES) { await ipad.setViewportSize({ width: w, height: h }); await sleep(350); await ipad.screenshot({ path: path.join(SHOTS, view + '-' + theme + '-' + w + '.png') }); }
    await ipad.setViewportSize({ width: 1024, height: 768 });
  };
  const blur = () => page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  const stampIt = async (pos = 'risky', eff = 'standard') => {
    await page.fill('#gm-c-threat', LINE); await page.click('#gm-pos [data-v="' + pos + '"]'); await page.click('#gm-eff [data-v="' + eff + '"]');
    await until(() => page.$(STAMP), 4000); await page.click(STAMP);
    return until(async () => { const o = await ov(); return o && o.kind === 'report' && !o.payload.result && o.payload.position === pos ? o : null; }, 8000);
  };
  const key = async (n) => { await blur(); await page.click('#gm-buttons [data-gm="situation"][data-n="' + n + '"]'); };

  // ============ stamp: the stakes ============
  const o1 = await stampIt();
  check(!!o1 && o1.payload.who === 'Ray' && o1.payload.text === LINE && o1.ms === 180000, 'the stamp carries who: ' + JSON.stringify(o1 && o1.payload));
  const s1 = await beatIs('stakes');
  check(!!s1 && /Ray goes for it/i.test(s1.text) && /if it goes wrong: she calls the desk\./i.test(s1.text) && /risky/i.test(s1.text) && /standard/i.test(s1.text), 'the iPad draws the stakes plate: ' + (s1 && s1.text));
  const m1 = await ipad.evaluate(() => { const p = document.querySelector('.ks15-beat .stage-plate'), r = p.getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, t: r.top, W: innerWidth, H: innerHeight,
    min: Math.min(...[...p.querySelectorAll('.ui-slot')].filter((n) => n.textContent.trim()).map((n) => parseFloat(getComputedStyle(n).fontSize))) }; });
  check(m1.l >= 0.05 * m1.W - 1 && m1.r <= 0.95 * m1.W + 1 && m1.b <= 0.95 * m1.H + 1 && m1.min >= 0.033 * m1.H - 0.01, 'the stakes plate sits in the inner 90%, every line at least 3.3% of the height: ' + JSON.stringify(m1));
  await shot('ipad-stakes');

  // ============ result: the same overlay, laid again ============
  await key(2);
  const o2 = await until(async () => { const o = await ov(); return o && o.payload.result === '45' ? o : null; }, 8000);
  check(!!o2 && o2.id === o1.id && o2.ms === 8000 && o2.payload.who === 'Ray', 'key 2: the SAME overlay id laid again with result 45 for 8 s: ' + JSON.stringify(o2 && { same: o2.id === o1.id, ms: o2.ms, p: o2.payload }));
  const s2 = await beatIs('result');
  check(!!s2 && /you do it\. it costs\./i.test(s2.text) && !/\d/.test(s2.text.replace(/\d+:\d\d/g, '')), 'the slam in plain words, no numbers but the timer: ' + (s2 && s2.text));
  check(await ipad.evaluate(() => !!document.querySelector('.ks15-beat .stage-plate[data-stage-timed]') && /\d:\d\d/.test(document.querySelector('.ks15-beat .stage-plate-timer').textContent)), 'the result shows its timer');
  await shot('ipad-result');

  // ============ cost: refused (hidden name) is said and kept; unsent never reaches the display GET; sent is drawn ============
  check(!!(await until(() => page.$('#gm-stamp-cost'), 4000)), 'after a 4/5 the Roll shows "Cost on the iPad"');
  await page.fill('#gm-stamp-cost', COST);
  check(!(await displayGet()).includes('Lotte remembers'), 'an unsent cost is not in the display GET');
  await page.fill('#gm-stamp-cost', 'GM-ONLY-NPC-1 saw it'); await page.press('#gm-stamp-cost', 'Enter');
  const said = await until(() => page.evaluate(() => document.body.innerText).then((t) => /did not go to the iPad/.test(t) ? 'said' : ''), 4000);
  check(!!said, 'a cost naming a hidden NPC is refused and said');
  check((await page.inputValue('#gm-stamp-cost')) === 'GM-ONLY-NPC-1 saw it', 'and the typed text is kept');
  check(!/player-layer/.test(await page.evaluate(() => document.body.innerText)), 'and only the cost message is shown (not the general refusal of the page)');
  check(!(await displayGet()).includes('GM-ONLY') && !JSON.stringify(await ov()).includes('GM-ONLY'), 'nothing hidden reached the ambient document or the display GET');
  await page.fill('#gm-stamp-cost', COST); await page.press('#gm-stamp-cost', 'Enter');
  const o3 = await until(async () => { const o = await ov(); return o && o.payload.cost === COST ? o : null; }, 8000);
  check(!!o3 && o3.id === o1.id && o3.ms === 10000 && o3.payload.result === '45', 'Enter sends the cost as the same beat for 10 s');
  const s3 = await beatIs('cost');
  check(!!s3 && s3.text.includes(COST) && /it costs/i.test(s3.text), 'the iPad draws the cost: ' + (s3 && s3.text));
  await shot('ipad-cost');

  // ============ the chip: the beat folds; a reload clears it ============
  check(!!(await noBeat(20000)), 'the beat folds');
  const c1 = await until(async () => { const c = await chip(); return c && c.shown ? c : null; }, 8000);
  check(!!c1 && /last roll/i.test(c1.text) && /ray/i.test(c1.text) && /it costs/i.test(c1.text) && !/\d/.test(c1.text), 'the last-roll chip on the idle stage: ' + JSON.stringify(c1));
  await sleep(600);
  const running = await ipad.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName || 'x'));
  check(running.length === 0, 'nothing moves on the idle stage: ' + running.join(','));
  await shot('ipad-idle-chip');
  await ipad.reload();
  await ipad.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 20000 });
  await until(() => ipad.evaluate(() => !!document.querySelector('.dp-root .stage-frame')), 30000, 250);
  await sleep(1500);
  check(!(await chip()), 'a reload of the iPad clears the chip (display memory only)');

  // ============ a second stamp over the first; stakes over a result ============
  const a1 = await stampIt('risky', 'standard');
  const a2 = await stampIt('desperate', 'great');
  check(!!a1 && !!a2 && a2.id !== a1.id, 'a second stamp replaces the first (a new id)');
  const s4 = await until(async () => { const b = await beatIs('stakes'); return b && /desperate/i.test(b.text) ? b : null; }, 10000);
  check(!!s4, 'the iPad shows the second stakes');
  await key(3); await beatIs('result');
  const a3 = await stampIt('controlled', 'limited');
  check(!!a3 && a3.id !== a2.id, 'a stamp over a result replaces it');
  const s5 = await until(async () => { const b = await beatIs('stakes'); return b && /controlled/i.test(b.text) ? b : null; }, 10000);
  check(!!s5, 'stakes over the result on the iPad');

  // ============ one Esc: Esc, Take it down and Clean at every beat; nothing laid again after a takedown ============
  await blur(); await page.keyboard.press('Escape');
  check(!!(await until(async () => !(await ov()), 6000)) && !!(await noBeat(8000)), 'Esc takes the stakes down');
  await stampIt(); await key(2); await beatIs('result');
  await blur(); await page.keyboard.press('Escape');
  check(!!(await until(async () => !(await ov()), 6000)), 'Esc takes the result down');
  await sleep(1500); check(!(await ov()), 'and nothing lays it again');
  check(!(await page.$('#gm-stamp-cost')), 'the cost field went with it');
  await stampIt(); await key(3); await beatIs('result');
  await page.fill('#gm-stamp-cost', COST); await page.press('#gm-stamp-cost', 'Enter'); await beatIs('cost');
  await page.click('#gm-stamp [data-gm="stamp-down"]');
  check(!!(await until(async () => !(await ov()), 6000)) && !!(await noBeat(8000)), 'Take it down takes the cost down');
  await stampIt();
  check(/^Clean: You do it\.$/.test((await page.textContent('#gm-stamp [data-gm="stamp-clean"]')).trim()), 'with the setting on, Clean says what it does: ' + (await page.textContent('#gm-stamp [data-gm="stamp-clean"]')));
  await page.click('#gm-stamp [data-gm="stamp-clean"]');
  const cl = await beatIs('result');
  check(!!cl && /you do it\./i.test(cl.text) && !/it costs/i.test(cl.text), 'Clean at the stakes: "You do it."');
  check(!(await page.$('#gm-stamp-cost')), 'a clean roll offers no cost');
  await until(() => page.$('#gm-stamp [data-gm="stamp-clean"]'), 3000);
  await page.click('#gm-stamp [data-gm="stamp-clean"]');
  check(!!(await until(async () => !(await ov()), 6000)), 'Clean at the result takes it down');
  await sleep(1500); check(!(await ov()), 'and nothing lays it again');

  // ============ review: another show taking over ends the cost field; it never comes back ============
  await stampIt(); await key(2); await beatIs('result');
  check(!!(await until(() => page.$('#gm-stamp-cost'), 4000)), 'a cost field after a 4/5');
  await page.fill('#gm-stamp-cost', COST);
  await api('PATCH', '/gm/ambient', { overlay: { id: 'other-beat-1', kind: 'stamp', ms: 3000, payload: { word: 'PAID' } } });
  check(!!(await until(async () => !(await page.$('#gm-stamp-cost')), 20000, 250)), 'another show takes over: the cost field ends');
  await sleep(4000);
  check(!(await page.$('#gm-stamp-cost')) && !JSON.stringify(await ov()).includes('Lotte'), 'after the other show runs out the cost field stays gone and nothing put the roll back');
  await blur(); await page.keyboard.press('Escape'); await api('PATCH', '/gm/ambient', { overlay: null });

  // ============ the pictures in Paper, and the desk's Roll with its cost field (KIT_SHOTS only) ============
  if (SHOTS) {
    await ipad.evaluate(() => localStorage.setItem('b68.theme', 'light')); await ipad.reload();
    await ipad.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 20000 });
    await until(() => ipad.evaluate(() => !!document.querySelector('.dp-root .stage-frame')), 30000, 250);
    await stampIt(); await beatIs('stakes'); await shot('ipad-stakes', 'paper');
    await key(2); await beatIs('result'); await shot('ipad-result', 'paper');
    await page.fill('#gm-stamp-cost', COST); await page.press('#gm-stamp-cost', 'Enter'); await beatIs('cost'); await shot('ipad-cost', 'paper');
    await noBeat(20000); await sleep(800); await shot('ipad-idle-chip', 'paper');
    await ipad.evaluate(() => localStorage.removeItem('b68.theme'));
    for (const [theme, store] of [['night', 'dark'], ['paper', 'light']]) {
      await page.evaluate((t) => localStorage.setItem('b68.theme', t), store); await page.reload(); await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
      await stampIt(); await key(2); await until(() => page.$('#gm-stamp-cost'), 4000);
      await page.fill('#gm-stamp-cost', 'Lotte remembers'); await blur();
      for (const [w, h] of [[1366, 768], [1536, 864]]) {
        await page.setViewportSize({ width: w, height: h }); await sleep(400);
        const box = await page.$('#gm-rl') || await page.$('#gm-stamp');
        await (box || page).screenshot({ path: path.join(SHOTS, 'desk-roll-' + theme + '-' + w + '.png') });
      }
      await page.setViewportSize({ width: 1440, height: 900 }); await blur(); await page.keyboard.press('Escape'); await until(async () => !(await ov()), 6000);
    }
    await page.evaluate(() => localStorage.removeItem('b68.theme'));
  }

  // ============ off: today's mark ============
  await setting(false);
  await page.reload(); await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  const f1 = await stampIt();
  check(!!f1 && f1.payload.who === undefined, 'off: the stamp carries no who: ' + JSON.stringify(f1 && f1.payload));
  check((await page.textContent('#gm-stamp [data-gm="stamp-clean"]')).trim() === 'Clean (no card)', 'off: Clean keeps its old words');
  await key(2);
  check(!!(await until(async () => !(await ov()), 6000)), 'off: a 4/5 takes the card down as today');
  check(!(await page.$('#gm-stamp-cost')), 'off: no cost field');

  check(outside.length === 0, 'the iPad made no request outside its origin: ' + outside.slice(0, 3).join(' | '));
  check(errors.length === 0, 'no page errors: ' + errors.slice(0, 3).join(' | '));
  await browser.close();
} catch (e) {
  console.log('FAIL ' + (e && e.stack || e)); failed++;
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
