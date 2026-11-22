// night-flow (ticks reach the clock (night.flow)): the browser check for the setting, on the demo night (the invented Pelican Rooms; no model, no key).
// Registered as a stub by RK01 of the room key build; RK04 made it the harness (the demo night, a browser, the checks' helpers) and runs its own part from
// fixtures/gm/night-flow-rk04.mjs. RK03, RK05 and RK06 add theirs below the marked line, each in a fixtures/gm file of their own.
// Its default port is 9500, with wrangler's inspector on PORT + 20000, as the other browser checks do (a builder runs it on a port of their own).
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9500] [RK_SHOTS=<dir>] node checks/runtime/night-flow.e2e.mjs
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9500);
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

for (const f of ['app/routes.js', 'app/features.js', 'app/gm/blade-chips.js', 'app/gm/night-ticks.js', 'app/gm/threat-room.js', 'app/gm/public-lines.js']) check(existsSync(path.join(ROOT, f)), f + ' exists');

if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const demo = spawn(process.execPath, [path.join(ROOT, 'scripts', 'demo-night.mjs'), '--port', String(PORT)], { cwd: ROOT, env: { ...process.env, B68_ANTHROPIC_KEY: '', ANTHROPIC_API_KEY: '' }, detached: !WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let demoOut = '';
demo.stdout.on('data', (d) => { demoOut += d; }); demo.stderr.on('data', (d) => { demoOut += d; });
function killDemo() { if (WIN) spawnSync('taskkill', ['/pid', String(demo.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-demo.pid, 'SIGKILL'); } catch (_) {} } }
process.on('exit', () => { killDemo(); });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
setTimeout(() => { console.log('FAIL timed out\n' + demoOut.slice(-1500)); process.exit(1); }, 900000);

const errors = [];
let browser = null;
/* a screenshot into RK_SHOTS (nothing when it is unset) */
const shots = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
try {
  const up = await until(() => /The demo night is up/.test(demoOut), 240000, 500);
  if (!up) throw new Error('the demo night did not start:\n' + demoOut.slice(-1500));
  const PW = require(process.env.PW_MODULE || 'playwright-core');
  browser = await PW.chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const ctx = { BASE, GM, IPAD, P1, api, check, until, sleep, browser, errors, atPlace, shots, mkdirSync, path, SHOTS };

  /* ---- RK04: Blade's cards act on what they suggest ---- */
  await (await import('./fixtures/gm/night-flow-rk04.mjs')).rk04(ctx);

  /* ---- RK03, RK05 and RK06 add their parts here ---- */

  check(errors.length === 0, 'no page error (' + errors.slice(0, 3).join(' | ') + ')');
} catch (e) {
  console.log('FAIL ' + (e && e.stack || e)); failed++;
} finally {
  if (browser) await browser.close().catch(() => {});
  killDemo();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
