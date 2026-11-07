// The Fixer on the stamp (08/11/2026; vault Projects/blades-68-fixer-on-the-stamp) on the real GM page, Worker and ambient document: setting the
// Position, the effect or the line asks nothing; Stamp it on the iPad asks Blade for ONE fit, with the stamped line as the threat and no draws; the
// lines open under They rolled in the Roll's button order, coloured; marking 1–3 puts that line above the result card and folds Blade to its summary;
// Stamp again (a new line) asks again; the Fit button asks for an unstamped roll with the console's draws. The fit endpoint is faked (no model, $0);
// the stamp, the report card and the transcript are real. Every name is invented. SHOTS=<dir> also writes two screenshots of the Roll.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9330] [SHOTS=<dir>] node checks/runtime/gm-fixer-stamp.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9330);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), np = fx('npc-pack.json');
const PARTS = {
  console: con.parts.console, campaign: np.parts.campaign, npc: np.parts.npc,
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: new Date().toISOString() }, T: loc.T, extra: loc.extra },
};

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-fxs-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM], { cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: 'ignore' });
function killServer() {
  if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} }
}
process.on('exit', () => { killServer(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const api = (method, p, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j }; });
const SPEND = { tonight: 0.3, cap: 20, tier: 'all', tick: 0.02 };
/* the Fixer's answer, in its 08/11 shape (invented) */
const FIT = (n) => ({ cards: [{ seat: 'fixer', at: new Date().toISOString(), text: 'r', read: 'Quill on the catwalk above the guard; risky, standard.',
  bargain: { lead: 'The dog wakes', say: 'Take the die, and the dog on the crate starts barking.' },
  four_five: { lead: 'Clear, ankle caught', say: 'You drop clear, but the stack clips your ankle.', size: 'harm 2' },
  one_three: { lead: 'The cars come down', say: 'The stack lands on you, and the guard rolls clear.', size: 'harm 2' },
  six: { lead: 'Clean drop', say: 'You land soft, and the guard never looks up.' },
  crit: { lead: 'Clear, door sealed', say: 'You land clear and the wrecks block the door behind you.' },
  ...(n > 1 ? { read: 'fit ' + n } : {}) }], flags: [], spend: SPEND, last: 9 });

try {
  const up = await until(async () => { try { return (await fetch(BASE + '/index.html')).status > 0; } catch (_) { return false; } }, 90000, 500);
  if (!up) throw new Error('the server did not start');
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status);
  }
  await api('PUT', '/campaign', { v: 1, session: { number: 1, startedAt: new Date().toISOString(), endedAt: null }, crew: { name: 'The Lamplighters', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] }, clocks: [], log: [] });
  await api('PATCH', '/gm/stt', { want: 'on' });

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [], fits = [];
  const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await c.addInitScript(atPlace('score'));
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await c.route('**/api/gm/assist/tick', (route) => json(route, { cards: [], updates: [], flags: [], spend: SPEND, last: 9 }));
  await c.route('**/api/gm/assist/cards', (route) => route.request().method() === 'POST' ? json(route, { marked: 1 }) : json(route, { cards: [], updates: [], asks: [] }));
  await c.route('**/api/gm/assist/fit', async (route) => { fits.push(JSON.parse(route.request().postData() || '{}')); await sleep(600); return json(route, FIT(fits.length)); });
  const page = await c.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(BASE + '/#gm');
  await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
  await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  const STAMP = '#gm-stamp [data-gm="stamp"]';
  check(!!(await until(() => page.$(STAMP), 8000)), 'the Roll offers Stamp it on the iPad');
  const order = await page.$$eval('#gm-roll > *', (l) => l.map((x) => x.id || x.className));
  check(order.indexOf('gm-rackf') >= 0 && order.indexOf('gm-rackf') < order.indexOf('gm-fxhit') && order.indexOf('gm-fxhit') < order.indexOf('gm-card'), 'Blade, then the hit line, then the result card: ' + order.slice(0, 5).join(', '));
  check(!!(await until(() => page.$eval('#gm-fitnow', (b) => !b.hidden), 6000)), 'the Fit button shows (a box that can fit)');

  // 1. setting what goes up asks nothing
  await page.fill('#gm-c-threat', 'Either you or the guard gets crushed');
  await page.click('#gm-pos [data-v="desperate"]'); await page.click('#gm-pos [data-v="risky"]');
  await page.click('#gm-eff [data-v="standard"]');
  await sleep(2200);
  check(fits.length === 0, 'Position, effect and the line ask nothing (' + fits.length + ')');

  // 2. Who, then the stamp: it asks once, with the line, the PC and no draws
  const whoName = await page.$eval('#gm-who [data-gm="who"]', (b) => b.getAttribute('data-v'));
  await page.click('#gm-who [data-gm="who"]');
  check(await page.$eval('#gm-who [data-gm="who"]', (b) => b.getAttribute('aria-checked') === 'true'), 'Who: one tap on a PC, above the stamp');
  await sleep(1800);
  check(fits.length === 0, 'and Who asks nothing either');
  await page.click(STAMP);
  check(!!(await until(async () => /Fitting…/.test(await page.textContent('#gm-rack')), 3000)), 'the Roll says Fitting… the moment the stamp is up');
  check(!!(await until(async () => fits.length === 1 && /The cars come down/.test(await page.textContent('#gm-rack')), 8000)), 'one fit, and its lines show');
  const f1 = fits[0] || {};
  check(f1.position === 'risky' && f1.effect === 'standard' && f1.threat === 'Either you or the guard gets crushed' && f1.draws === undefined, 'the ask: ' + JSON.stringify({ p: f1.position, e: f1.effect, t: f1.threat, d: !!f1.draws }));
  check(typeof f1.size === 'string' && /harm 2/.test(f1.size) && Array.isArray(f1.onStage), 'the size for risky (' + f1.size + ') and who is on stage');
  check(f1.pc === whoName, 'Who goes with the fit: ' + f1.pc);
  const rows = await page.$$eval('#gm-rack li.gm-fx', (l) => l.map((x) => x.className.replace('gm-fx ', '') + ':' + x.querySelector('.gm-fx-k').textContent));
  check(rows.join('|') === 'gm-fx-deal:Bargain|gm-fx-mid:4/5|gm-fx-low:1–3|gm-fx-six:6|gm-fx-crit:Crit', 'five coloured rows in the Roll\'s order: ' + rows.join('|'));
  const kbg = await page.$eval('#gm-rack li.gm-fx-low .gm-fx-k', (e) => getComputedStyle(e).backgroundColor);
  check(kbg === 'rgb(168, 33, 15)', 'the 1–3 label is the alarm red (' + kbg + ')');
  check(await page.$eval('#gm-rackf', (d) => d.open && !d.hidden), 'the Blade fold is open');
  if (process.env.SHOTS) { mkdirSync(process.env.SHOTS, { recursive: true }); await (await page.$('#gm-roll')).screenshot({ path: path.join(process.env.SHOTS, 'fixer-1-stamped.png') }); }

  // 3. moving the Position after the stamp still asks nothing
  await page.click('#gm-pos [data-v="desperate"]'); await page.click('#gm-pos [data-v="risky"]'); await sleep(2200);
  check(fits.length === 1, 'the Position again asks nothing');

  // 4. the result: 1–3 heads the card, Blade folds
  await page.click('#gm-buttons [data-gm="situation"][data-n="3"]');
  check(!!(await until(async () => /The cars come down/.test(await page.$eval('#gm-fxhit', (e) => (e.hidden ? '' : e.textContent))), 4000)), 'the 1–3 line heads the result card');
  check(await page.$eval('#gm-rackf', (d) => !d.open) && /1–3 · The cars come down/.test(await page.textContent('#gm-rack-sum')), 'and Blade folds to its summary');
  check(await page.$eval('#gm-rack li.gm-fx-low', (e) => e.classList.contains('hit')), 'the 1–3 row is marked');
  check(await page.$$eval('#gm-who [data-gm="who"]', (l) => l.every((b) => b.getAttribute('aria-checked') === 'false')), 'and the resolved roll clears Who');
  if (process.env.SHOTS) await (await page.$('#gm-roll')).screenshot({ path: path.join(process.env.SHOTS, 'fixer-2-result.png') });

  // 5. a new stamp asks again; the Fit button asks for an unstamped roll with the draws
  await page.fill('#gm-c-threat', 'The guard turns round');
  await page.click(STAMP);
  check(!!(await until(() => fits.length === 2, 6000)) && fits[1].threat === 'The guard turns round', 'a new stamp is a new fit with its own line');
  check(!!(await until(async () => /fit 2/.test(await page.textContent('#gm-rack')), 4000)) && await page.$eval('#gm-fxhit', (e) => e.hidden), 'its lines replace the last, and the old headline goes');
  await page.click('#gm-fitnow');
  check(!!(await until(() => fits.length === 3, 6000)) && fits[2].threat === undefined && !!(fits[2].draws && /^A 1–3/.test(fits[2].draws.low)), 'the Fit button: the console\'s draws, no line');
  check(!!(await until(async () => /not stamped/.test(await page.textContent('#gm-rack')), 4000)), 'and the Roll says it was not stamped');
  // 6. Clean (no card) is the 6: its row and the fold say so, and it never heads a card (the next plain roll has no headline)
  await page.fill('#gm-c-threat', 'The lamp goes out');
  await page.click(STAMP);
  check(!!(await until(async () => fits.length === 4 && /fit 4/.test(await page.textContent('#gm-rack')), 9000)), 'a fourth stamp, fitted');
  await page.click('#gm-stamp [data-gm="stamp-clean"]');
  check(!!(await until(async () => /6 · Clean drop/.test(await page.textContent('#gm-rack-sum')), 4000)) && await page.$eval('#gm-fxhit', (e) => e.hidden), 'Clean marks the 6 in the fold, with no headline');
  await page.click('#gm-buttons [data-gm="situation"][data-n="3"]');
  await sleep(300);
  check(await page.$eval('#gm-fxhit', (e) => e.hidden), 'and the next roll, a plain one, has no headline');
  check(errors.length === 0, 'no console errors: ' + JSON.stringify(errors.slice(0, 3)));
  await c.close();
  await browser.close();
} catch (e) {
  console.log('FAIL ' + (e && e.stack || e)); failed++;
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
