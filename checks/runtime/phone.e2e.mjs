// Phone layout of the hosted build against a real local Worker (wrangler dev, DEV_USER) on PORT (default 8792):
// a 390 x 844 mobile Chromium (isMobile, touch) opens the page and every main mode, and the page must lay out at
// the device width: innerWidth 390, standards mode (the Worker's doctype), a viewport meta, and nothing wider
// than the screen. Without the Worker's head a phone renders the page 980 px wide in quirks mode (UX P1-1).
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node checks/runtime/phone.e2e.mjs      (or: npm run check:phone)
import { spawn, spawnSync } from 'node:child_process';
const WIN = process.platform === 'win32';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8792);
const BASE = 'http://127.0.0.1:' + PORT;
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- our own server (only this process group is ever signalled) ---------- */
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-phone-check-'));
const server = spawn(path.join(ROOT, 'node_modules', '.bin', 'wrangler'), ['dev', '--port', String(PORT), '--ip', '127.0.0.1',
  '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false', '--persist-to', stateDir, '--log-level', 'warn',
  '--var', 'DEV_USER:gm@example.test', '--var', 'GM_EMAILS:gm@example.test'],
{ cwd: ROOT, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, detached: !WIN, shell: WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
function killServer(sig = 'SIGTERM') { try { WIN ? spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }) : process.kill(-server.pid, sig); } catch (_) {} }
process.on('exit', () => { killServer('SIGKILL'); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 180000);

/* what the phone sees: width, mode, the viewport meta, and anything sticking out past the right edge */
function layout() {
  const de = document.documentElement, vw = window.innerWidth;
  const wide = [];
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || r.right <= vw + 1) continue;
    // ignore what is clipped by a scrolling or hidden-overflow ancestor (a scroller is fine on a phone)
    let clipped = false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox !== 'visible') { clipped = true; break; }
    }
    if (!clipped && getComputedStyle(el).position !== 'fixed') wide.push((el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(/\s+/)[0] : '')) + ' ' + Math.round(r.right));
  }
  return {
    innerWidth: vw,
    compatMode: document.compatMode,
    charset: document.characterSet,
    viewport: (document.querySelector('meta[name="viewport"]') || {}).content || null,
    scrollWidth: de.scrollWidth,
    clientWidth: de.clientWidth,
    wide: wide.slice(0, 8),
  };
}

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).ok; } catch (_) { return false; } }, 90000, 300);
  if (!ready) throw new Error('server not ready:\n' + serverLog);

  const raw = await (await fetch(BASE + '/')).text();
  check(/^<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width, initial-scale=1, viewport-fit=cover">/.test(raw), 'the Worker serves / with the doctype, charset and viewport first');

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());

  for (const [name, hash] of [['creator', ''], ['table page', '#t']]) {
    await page.goto(BASE + '/' + hash);
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 20000 });
    await sleep(800);
    const l = await page.evaluate(layout);
    check(l.innerWidth === 390, name + ': innerWidth ' + l.innerWidth + ' (390 wanted, 980 means no viewport)');
    check(l.compatMode === 'CSS1Compat', name + ': standards mode (' + l.compatMode + ')');
    check(l.charset === 'UTF-8', name + ': charset ' + l.charset);
    check(/width=device-width/.test(l.viewport || ''), name + ': viewport meta ' + JSON.stringify(l.viewport));
    check(l.scrollWidth <= l.clientWidth, name + ': no horizontal overflow (scrollWidth ' + l.scrollWidth + ', clientWidth ' + l.clientWidth + ')' + (l.wide.length ? ' wide: ' + l.wide.join(', ') : ''));
  }
  const viewports = await page.evaluate(() => document.querySelectorAll('meta[name="viewport"]').length);
  check(viewports === 1, 'one viewport meta (cf.js does not add a second): ' + viewports);
  check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
} finally {
  clearTimeout(timeout);
  killServer('SIGTERM');
  const t0 = Date.now(); while (server.exitCode === null && server.signalCode === null && Date.now() - t0 < 5000) await sleep(100);
  killServer('SIGKILL');
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
