// glance (the GM’s glance (gm.glance)): the browser check for the setting, on the demo night (the invented Pelican Rooms; no model, no key).
// Registered as a stub by RK01 of the room key build. RK21 made it the harness (the demo night, a browser, the checks' helpers, as night-flow.e2e.mjs
// is) and runs its own part from fixtures/gm/glance-rk21.mjs. RK20, RK22, RK23 and RK24 each add a part: a fixtures/gm file of their own and one row in PARTS.
// Its default port is 9504, with wrangler's inspector on PORT + 20000, as the other browser checks do (a builder runs it on a port of their own).
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9504] [RK_SHOTS=<dir>] [GL_ONLY=RK21] node checks/runtime/glance.e2e.mjs
//
// THE PARTS (one demo night, one browser, run in turn):
//   - before a part, the harness turns every setting in BASE_OFF off (on the GM state and the campaign) and calls the part's own reset(c) if it exports one;
//     a part also resets, at its start, the state and settings it uses (it must not rely on what the part before it left)
//   - each part runs in its own try with its own timeout (ms): a part that throws or times out is one FAIL, and the next part still runs; the run fails
//   - every browser context a part opened is closed when it ends, then its reset(c) and BASE_OFF run again: a part leaves nothing on
//   - page errors are counted per part
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9504);
assert.ok(Number.isInteger(PORT) && PORT > 0, 'a port');
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test', P1 = 'player1@example.test';
const SHOTS = process.env.RK_SHOTS || '';
const WIN = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 150) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j, text: t }; });

/* the parts, in the order they run: { name, file (a fixtures/gm module), run (its exported function), ms (its own timeout) }. RK23 and RK24 add a row. */
const PARTS = [
  { name: 'RK21', file: './fixtures/gm/glance-rk21.mjs', run: 'rk21', ms: (SHOTS ? 900 : 300) * 1000 },
  { name: 'RK20', file: './fixtures/gm/glance-rk20.mjs', run: 'rk20', ms: (SHOTS ? 900 : 600) * 1000 },
  { name: 'RK22', file: './fixtures/gm/glance-rk22.mjs', run: 'rk22', ms: (SHOTS ? 1500 : 480) * 1000 },
  { name: 'RK23', file: './fixtures/gm/glance-rk23.mjs', run: 'rk23', ms: (SHOTS ? 900 : 300) * 1000 },
];
/* every setting a part may turn on: all off before and after each part */
const BASE_OFF = { 'gm.glance': false, 'kit.desk': false };
const ONLY = (process.env.GL_ONLY || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const RUN = PARTS.filter((p) => !ONLY.length || ONLY.includes(p.name));

for (const f of ['app/routes.js', 'app/features.js', 'app/gm/glance-now.js', 'app/gm/glance-crew.js', 'app/gm/glance.css']) check(existsSync(path.join(ROOT, f)), f + ' exists');

if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const demo = spawn(process.execPath, [path.join(ROOT, 'scripts', 'demo-night.mjs'), '--port', String(PORT)], { cwd: ROOT, env: { ...process.env, B68_ANTHROPIC_KEY: '', ANTHROPIC_API_KEY: '' }, detached: !WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let demoOut = '';
demo.stdout.on('data', (d) => { demoOut += d; }); demo.stderr.on('data', (d) => { demoOut += d; });
function killDemo() { if (WIN) spawnSync('taskkill', ['/pid', String(demo.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-demo.pid, 'SIGKILL'); } catch (_) {} } }
process.on('exit', () => { killDemo(); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
/* the backstop: the demo night's start, every part's own timeout, and a minute to spare */
const HARD = 240000 + RUN.reduce((t, p) => t + p.ms + 30000, 0) + 60000;
setTimeout(() => { console.log('FAIL timed out (the whole run, ' + Math.round(HARD / 1000) + ' s)\n' + demoOut.slice(-1500)); process.exit(1); }, HARD);

const errors = [];
let browser = null;
/* a screenshot into RK_SHOTS (nothing when it is unset) */
const shots = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
const baseOff = async () => { await api('PATCH', '/gm/state', { features: BASE_OFF }); await api('PATCH', '/campaign', { features: BASE_OFF }); };

async function runPart(part, shared) {
  const t0 = Date.now(), e0 = errors.length, opened = [];
  /* the part's browser: the same one, but every context it opens is closed when the part ends */
  const pb = new Proxy(browser, { get: (t, k) => (k === 'newContext' ? async (o) => { const x = await t.newContext(o); opened.push(x); return x; } : typeof t[k] === 'function' ? t[k].bind(t) : t[k]) });
  const c = { ...shared, browser: pb };
  let mod = null, timer = null;
  console.log('\n---- ' + part.name + ' (' + part.file + ', ' + Math.round(part.ms / 1000) + ' s at most) ----');
  try {
    mod = await import(part.file);
    if (typeof mod[part.run] !== 'function') throw new Error(part.file + ' exports no ' + part.run + '()');
    await baseOff();
    if (typeof mod.reset === 'function') await mod.reset(c);
    const going = Promise.resolve().then(() => mod[part.run](c));
    going.catch(() => {});      /* a part that timed out may still throw later, once its pages are closed: that is not a second failure */
    await Promise.race([going, new Promise((_, no) => { timer = setTimeout(() => no(new Error('timed out after ' + Math.round(part.ms / 1000) + ' s')), part.ms); })]);
  } catch (e) {
    console.log('FAIL ' + part.name + ': ' + (e && e.stack || e)); failed++;
  } finally {
    clearTimeout(timer);
    for (const x of opened) await x.close().catch(() => {});
    try { if (mod && typeof mod.reset === 'function') await mod.reset(c); await baseOff(); }
    catch (e) { console.log('FAIL ' + part.name + ': the reset after it failed: ' + (e && e.message || e)); failed++; }
    const pe = errors.slice(e0);
    check(pe.length === 0, part.name + ': no page error (' + pe.slice(0, 3).join(' | ') + ')');
    console.log('---- ' + part.name + ' ended after ' + Math.round((Date.now() - t0) / 1000) + ' s ----');
  }
}

try {
  const up = await until(() => /The demo night is up/.test(demoOut), 240000, 500);
  if (!up) throw new Error('the demo night did not start:\n' + demoOut.slice(-1500));
  const PW = require(process.env.PW_MODULE || 'playwright-core');
  browser = await PW.chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const shared = { BASE, GM, IPAD, P1, api, check, until, sleep, browser, errors, atPlace, shots, mkdirSync, path, SHOTS };
  check(RUN.length > 0, 'parts to run: ' + RUN.map((p) => p.name).join(', ') + (ONLY.length ? ' (GL_ONLY)' : ''));
  for (const part of RUN) await runPart(part, shared);
} catch (e) {
  console.log('FAIL ' + (e && e.stack || e)); failed++;
} finally {
  if (browser) await browser.close().catch(() => {});
  killDemo();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
