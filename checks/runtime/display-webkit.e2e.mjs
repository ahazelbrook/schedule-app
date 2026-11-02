// The table display at iPad and iPhone sizes in a real browser engine, end to end against a local Worker (wrangler dev) on PORT
// (default 9150), invented fixtures only. Meant for the WebKit pass (F4): it finds problems, it fixes none.
//   PW_MODULE=<path to app/checks/pw-webkit.js> PORT=9150 node checks/runtime/display-webkit.e2e.mjs
//   (PW_DEVICE=ipad|iphone adds the touch profile; PW_ENGINE=chromium runs the same thing on Edge for comparison)
// For each size: the display signs in, draws a pushed map inside the viewport with no sideways scroll and no page error, the corner
// status shows, the band (when a hud is set) stays inside the viewport. Then an INFO line lists the web APIs the display leans on
// that this engine lacks (these are probes, not failures).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9150);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-displaywk-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };

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

let failed = 0, passed = 0;
async function step(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.message || e)); } }
const expect = (c, m) => { if (!c) throw new Error(m); };

let up = false;
for (let i = 0; i < 180 && !up; i++) { try { up = (await fetch(BASE + '/index.html', { signal: AbortSignal.timeout(2000) })).status > 0; } catch (_) {} if (!up) await sleep(500); }
if (!up) { console.log('FAIL server did not start'); process.exit(1); }

const gm = (method, p, body) => fetch(BASE + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect x="10" y="10" width="380" height="280" fill="#223" stroke="#eee" stroke-width="4"/><rect x="40" y="40" width="140" height="100" fill="#456"/><rect x="220" y="150" width="140" height="100" fill="#654"/></svg>';
const HUD = { time: '22:30', showTime: true, label: 'Test night', now: [{ text: 'A quiet hour', where: 'The hall', until: '23:00' }], next: [{ text: 'The toast', where: 'The bar', at: '00:00', inMin: 90 }],
  night: { beats: 8, start: 1, cur: 3, marks: [] }, alarm: { name: 'Fuse', size: 6, filled: 2, text: 'A door slams' }, crew: [{ name: 'Ada', room: 'The hall' }], ways: { found: 1, total: 4 } };

const probe = () => {
  const miss = [];
  const has = (n, ok) => { if (!ok) miss.push(n); };
  has('navigator.wakeLock', 'wakeLock' in navigator); has('Element.requestFullscreen', !!document.documentElement.requestFullscreen);
  has('BroadcastChannel', typeof BroadcastChannel === 'function'); has('structuredClone', typeof structuredClone === 'function'); has('ResizeObserver', typeof ResizeObserver === 'function');
  has('IntersectionObserver', typeof IntersectionObserver === 'function'); has('AbortSignal.timeout', typeof AbortSignal.timeout === 'function'); has('Array.prototype.at', typeof [].at === 'function');
  has('CSS dvh', CSS.supports('height', '100dvh')); has('CSS :has()', CSS.supports('selector(:has(a))')); has('CSS color-mix', CSS.supports('color', 'color-mix(in srgb, red, blue)'));
  has('CSS aspect-ratio', CSS.supports('aspect-ratio', '1/1')); has('CSS inset', CSS.supports('inset', '0')); has('CSS env(safe-area)', CSS.supports('padding-top', 'env(safe-area-inset-top)'));
  has('serviceWorker', 'serviceWorker' in navigator); has('speechSynthesis', 'speechSynthesis' in window); has('MediaRecorder', typeof MediaRecorder === 'function');
  has('Intl.DateTimeFormat timeZone', (() => { try { new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne' }); return true; } catch (e) { return false; } })());
  return miss;
};

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
try {
  expect((await gm('PUT', '/api/gm/display', { kind: 'svg', title: 'The Test Rooms', caption: 'Ground floor', svg: SVG })).status === 200, 'could not push a map as the GM');
  expect((await gm('PATCH', '/api/campaign', { mission: { v: 1, site: 'The Test Rooms', t: 90, seq: 1, hud: HUD } })).status === 200, 'could not write a mission as the GM');
  for (const [name, w, h] of [['iPad 1180x820', 1180, 820], ['iPad 820x1180 portrait', 820, 1180], ['iPad 1024x768', 1024, 768], ['iPhone 390x844', 390, 844], ['iPhone 844x390 landscape', 844, 390]]) {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const errors = []; page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
    await page.goto(BASE + '/');
    await step(name + ': the display signs in and draws', async () => {
      await page.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 15000 });
      await page.waitForFunction(() => !!document.querySelector('.dp-map-frame svg'), null, { timeout: 15000 });
      await sleep(900);
    });
    await step(name + ': the map and status sit inside the viewport, no sideways scroll', async () => {
      const g = await page.evaluate(() => {
        const box = (q) => { const x = document.querySelector(q); if (!x) return null; const r = x.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
        return { vw: innerWidth, vh: innerHeight, svg: box('.dp-map-frame svg'), status: box('.dp-status'), hscroll: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      expect(g.svg && g.svg.w > 40 && g.svg.h > 40, 'map drawn with a real size: ' + JSON.stringify(g.svg));
      expect(g.svg.l >= -1 && g.svg.t >= -1 && g.svg.r <= g.vw + 1 && g.svg.b <= g.vh + 1, 'map inside ' + g.vw + 'x' + g.vh + ': ' + JSON.stringify(g.svg));
      expect(g.status, 'corner status present');
      expect(!g.hscroll, 'no sideways scroll');
    });
    await step(name + ': the band, when shown, stays inside the viewport', async () => {
      const g = await page.evaluate(() => { const b = document.querySelector('.dp-band'); if (!b || b.hidden) return null; const r = b.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, vw: innerWidth, vh: innerHeight }; });
      if (g) expect(g.l >= -1 && g.t >= -1 && g.r <= g.vw + 1 && g.b <= g.vh + 1, 'band inside viewport: ' + JSON.stringify(g));
    });
    await step(name + ': no page errors', async () => { expect(!errors.length, errors.join(' | ')); });
    if (name.startsWith('iPad 1180')) {
      const miss = await page.evaluate(probe);
      console.log('INFO missing web APIs in this engine: ' + (miss.length ? miss.join(', ') : 'none'));
    }
    await ctx.close();
  }
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
await browser.close();
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
