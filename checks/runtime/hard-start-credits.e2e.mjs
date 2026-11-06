// F1 (after the real iPad, 06/11): the hard start's "Previously on" draws each face's portrait, and Roll the opening credits ends the hard start and pins
// the Opening credits scene. Against the demo night (invented cast with figure specs), a GM page at the Opening and the table iPad:
//   1. the GM page's Hard start panel (the Opening's left column): Test arms it; once armed it shows Roll the opening credits, End without credits and
//      the tap-for-sound line;
//   2. GO: the fuse, the credits, then Previously on: three faces drawn by the figure kit (no silhouette for a face with a figure), plates blank; a reveal
//      names one plate; the display GET carries a spec on each "previously" row and nothing hidden;
//   3. Roll the opening credits: every hard start layer is off the ambient document, the iPad shows the credits scene's frame, and the panel says so.
//   PW_MODULE=<playwright-core> PW_CHANNEL=msedge [PORT=8670] [DEMO_URL=http://127.0.0.1:8650] [HS_SHOTS=<dir>] node checks/runtime/hard-start-credits.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8670);
const OWN = !process.env.DEMO_URL;
const BASE = process.env.DEMO_URL || 'http://127.0.0.1:' + PORT;
const SHOTS = process.env.HS_SHOTS || '';
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

let demo = null, tmp = '';
async function startDemo() {
  tmp = mkdtempSync(path.join(tmpdir(), 'b68-f1-credits-'));
  demo = spawn(process.execPath, [path.join(ROOT, 'scripts', 'demo-night.mjs'), '--port', String(PORT), '--state', tmp], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } });
  let out = '';
  demo.stdout.on('data', (d) => { out += d; }); demo.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 240 && !/Ctrl\+C stops it/.test(out); i++) { await sleep(500); if (demo.exitCode !== null) break; }
  if (!/Ctrl\+C stops it/.test(out)) { console.log('FAIL the demo night did not come up\n' + out.slice(-1500)); await stop(); process.exit(1); }
}
async function stop() {
  if (demo && demo.pid) { if (WIN) spawnSync('taskkill', ['/PID', String(demo.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { demo.kill('SIGKILL'); } catch (e) { /* gone */ } } }
  if (tmp) { await sleep(800); try { rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* a lingering handle */ } }
}

let failed = 0, passed = 0;
async function step(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.message || e)); } }
const expect = (c, m) => { if (!c) throw new Error(m); };
const gm = (method, p, body) => fetch(BASE + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const display = () => fetch(BASE + '/api/gm/display?seq=-1&aseq=-1&sseq=-1', { headers: { 'X-Dev-User': IPAD } }).then((r) => r.json());

try {
  if (OWN) {
    if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
    await startDemo();
  }
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  await gm('PATCH', '/api/gm/ambient', { layers: null });
  await gm('PUT', '/api/gm/display', { kind: 'blank' });
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
  try {
    const gctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, extraHTTPHeaders: { 'X-Dev-User': GM }, reducedMotion: 'reduce' });
    await gctx.addInitScript(atPlace('opening'));
    const g = await gctx.newPage(); const gErr = []; g.on('pageerror', (e) => gErr.push(String(e && e.message || e)));
    await g.goto(BASE + '/#gm');
    const ictx = await browser.newContext({ viewport: { width: 1024, height: 768 }, extraHTTPHeaders: { 'X-Dev-User': IPAD } });
    await ictx.addInitScript(() => { try { localStorage.setItem('b68.display.hint', '1'); } catch (e) { /* the hint shows */ } });
    const ip = await ictx.newPage(); const iErr = []; ip.on('pageerror', (e) => iErr.push(String(e && e.message || e)));
    await ip.goto(BASE + '/');
    await ip.waitForFunction(() => document.body.dataset.mode === 'display' && document.querySelector('.dp-overlay'), null, { timeout: 25000 });
    const panel = '[data-left-tool="hardstart"]';

    await step('the Hard start panel (the Opening\'s left column): Test arms it, and only then are Roll the opening credits, End without credits and the tap line there', async () => {
      await g.waitForSelector(panel + ' [data-hs="test"]', { timeout: 30000 });
      expect(!(await g.$(panel + ' [data-hs="roll"]')), 'not armed: no Roll button');
      await sleep(4000);      /* the page's own load-time writes (the band's phase, the PCs' status) settle first */
      await g.click(panel + ' [data-hs="test"]');
      await g.waitForSelector(panel + ' [data-hs="roll"]', { timeout: 15000 });
      for (let i = 0; i < 20; i++) { const d = await display(); if (d.layers && d.layers.data && d.layers.data.previously) break; if (i === 10) await g.click(panel + ' [data-hs="test"]'); await sleep(500); }
      const t = await g.$eval(panel, (e) => e.innerText);
      expect(/Roll the opening credits/i.test(t) && /End without credits/i.test(t) && /Tap for sound/i.test(t), 'the panel: ' + t.slice(0, 400));
      if (SHOTS) { await g.screenshot({ path: path.join(SHOTS, 'gm-hardstart-panel-1366.png') }); }
    });

    await step('GO: Previously on draws three portraits from the figure kit (plates blank); the GET carries a spec per row and nothing hidden; one reveal names one plate', async () => {
      await g.click(panel + ' [data-hs="go"]');
      await ip.waitForFunction(() => { const n = document.querySelector('.dp-hs'); return !!n && n.getAttribute('data-hs') === 'previously'; }, null, { timeout: 60000 }).catch(async (e) => { throw new Error(e.message + ' | iPad: ' + JSON.stringify(await ip.evaluate(() => ({ hs: (document.querySelector('.dp-hs') || {}).outerHTML ? document.querySelector('.dp-hs').getAttribute('data-hs') : null, mode: document.querySelector('.dp-root') && document.querySelector('.dp-root').getAttribute('data-scene-mode'), flag: window.B68Flags && window.B68Flags.on('spine.start') }))) + ' | GET layers: ' + JSON.stringify((await display()).layers).slice(0, 300)); });
      await ip.waitForFunction(() => document.querySelectorAll('.dp-hs-pic.dp-hs-drawn svg').length >= 1, null, { timeout: 20000 });
      await sleep(800);
      const r = await ip.evaluate(() => {
        const faces = [...document.querySelectorAll('.dp-hs-face')];
        const box = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
        return faces.map((f) => { const pic = f.querySelector('.dp-hs-pic'), pl = f.querySelector('.dp-hs-name'), svg = pic.querySelector('svg');
          return { drawn: pic.classList.contains('dp-hs-drawn'), sil: !!pic.querySelector('.dp-hs-sil'), pic: box(pic), svg: svg ? box(svg) : null, plate: box(pl), plateText: pl.innerText.trim() }; });
      });
      expect(r.length === 3, 'three faces: ' + r.length);
      const served = await display(); const prev = served.layers && served.layers.data && served.layers.data.previously || [];
      expect(prev.length === 3, 'three previously rows served');
      prev.forEach((row, i) => expect(!!row.spec === r[i].drawn && r[i].drawn === !r[i].sil, 'face ' + (i + 1) + ': drawn ' + r[i].drawn + ', served spec ' + !!row.spec));
      expect(r.filter((x) => x.drawn).length >= 2, 'the demo cast has figures: at least two portraits: ' + JSON.stringify(r.map((x) => x.drawn)));
      for (const x of r) {
        expect(x.plateText === '', 'the plates are blank: ' + JSON.stringify(x.plateText));
        expect(x.pic.b <= x.plate.t + 0.5, 'the portrait keeps clear of the name plate: ' + JSON.stringify([x.pic, x.plate]));
        if (x.svg) expect(x.svg.w >= x.pic.w - 1 && x.svg.h >= x.pic.h - 1, 'the portrait fills its frame: ' + JSON.stringify([x.svg, x.pic]));
      }
      expect(!/GM-ONLY/.test(JSON.stringify(served)), 'no GM-ONLY text in the display GET');
      if (SHOTS) await ip.screenshot({ path: path.join(SHOTS, 'ipad-previously-blank-1024x768.png') });
      await g.click(panel + ' [data-hs-reveal="0"]');
      await ip.waitForFunction(() => { const p = document.querySelector('.dp-hs-face .dp-hs-name'); return !!p && p.innerText.trim().length > 0; }, null, { timeout: 15000 });
      await sleep(900);
      const named = await ip.evaluate(() => [...document.querySelectorAll('.dp-hs-face .dp-hs-name')].map((p) => p.innerText.trim()).filter(Boolean).length);
      expect(named === 1, 'one plate named: ' + named);
      if (SHOTS) for (const [w, h] of [[1024, 768], [1180, 820], [1366, 1024], [768, 1024]]) { await ip.setViewportSize({ width: w, height: h }); await sleep(900); await ip.screenshot({ path: path.join(SHOTS, 'ipad-previously-revealed-' + w + 'x' + h + '.png') }); }
      await ip.setViewportSize({ width: 1024, height: 768 });
    });

    await step('Roll the opening credits: the hard start\'s layers are gone, the iPad shows the credits scene, and the panel says what is on the iPad', async () => {
      await g.click(panel + ' [data-hs="roll"]');
      await g.waitForFunction((sel) => /On the iPad: Opening credits/.test((document.querySelector(sel) || {}).innerText || ''), panel, { timeout: 15000 });
      const amb = await gm('GET', '/api/gm/ambient');
      const doc = amb.json && (amb.json.doc || amb.json) || {};
      const L = doc.layers || {};
      expect(!(L.scene && L.scene.mode) && !(L.data && (L.data.countdown || L.data.credits || L.data.previously)) && !(L.band && L.band.faces && L.band.faces.some((f) => f.npcId)), 'no hard start layer is left: ' + JSON.stringify(L));
      expect(doc.mode === 'pin' && doc.scene === 'credits', 'the credits scene is pinned: ' + JSON.stringify({ mode: doc.mode, scene: doc.scene }));
      await ip.waitForFunction(() => !document.querySelector('.dp-hs') && !!document.querySelector('.dp-ambient iframe[data-scene="credits"]'), null, { timeout: 30000 });
      const t = await g.$eval(panel, (e) => e.innerText);
      expect(!/Roll the opening credits/i.test(t), 'no longer armed: ' + t.slice(0, 200));
      if (SHOTS) { await sleep(1500); await ip.screenshot({ path: path.join(SHOTS, 'ipad-after-roll-credits-1024x768.png') }); await g.screenshot({ path: path.join(SHOTS, 'gm-hardstart-after-roll-1366.png') }); }
      expect(gErr.length === 0 && iErr.length === 0, 'page errors: ' + gErr.concat(iErr).join(' | '));
    });

    await step('at 390 wide: the panel\'s two buttons and its tap line fit (the Opening on a phone)', async () => {
      await g.click(panel + ' [data-hs="test"]');
      await g.waitForSelector(panel + ' [data-hs="roll"]', { timeout: 15000 });
      await g.setViewportSize({ width: 390, height: 844 });
      await sleep(900);
      const fit = await g.evaluate((sel) => {
        const p = document.querySelector(sel); if (!p) return { none: true };
        p.scrollIntoView({ block: 'start' });
        const vw = innerWidth, out = [];
        for (const b of p.querySelectorAll('[data-hs="roll"], [data-hs="end"], .gm-hs-tap')) { const r = b.getBoundingClientRect(); if (r.width && (r.left < -0.5 || r.right > vw + 0.5)) out.push(b.textContent.trim().slice(0, 30)); }
        return { out, shown: !!p.getClientRects().length };
      }, panel);
      if (fit.none || !fit.shown) { console.log('     (the Opening\'s left column is not drawn at 390: the panel is in its sheet there)'); }
      else expect(fit.out.length === 0, 'cut at 390: ' + fit.out.join(', '));
      if (SHOTS) { await sleep(400); await g.screenshot({ path: path.join(SHOTS, 'gm-hardstart-panel-390.png') }); }
      await g.click(panel + ' [data-hs="end"]').catch(() => {});
    });
  } finally { await browser.close(); }
} finally { if (OWN) await stop(); }
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
