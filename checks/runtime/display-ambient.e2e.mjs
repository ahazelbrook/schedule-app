// The ambient floor on the table display in a real browser (AMBIENT-PLAN.md, phase 1): a blank display plays a scene in a
// sandboxed same-origin iframe under the stages; a spotlight covers it and, after the grace, the iframe is gone; blank brings it
// back; the rotation advances; nothing leaves the origin; nothing throws. Phase 3/4: scene URLs have no .html and answer 200 (never a
// 307); the GM's ambient PATCHes drive the display (pin, skip, crew, lights out, a score).
// Timings are shortened through the loopback-only hook localStorage['b68.display.ambientTiming'] (display-page.js).
//   PW_MODULE=<path to playwright> node checks/runtime/display-ambient.e2e.mjs      (invented fixtures only)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8871);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-displayambient-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };

if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM],
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

async function push(doc) {
  const r = await fetch(BASE + '/api/gm/display', { method: 'PUT', headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: JSON.stringify(doc) });
  if (r.status !== 200) throw new Error('could not push ' + JSON.stringify(doc).slice(0, 60) + ': ' + r.status);
}
const BLANK = { kind: 'blank' };

/* a GM browser on #display with the given timings; collects every request and every page error */
async function openDisplay(browser, timing) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  await page.addInitScript((t) => {
    try { if (window === window.top) localStorage.setItem('b68.display.ambientTiming', JSON.stringify(t)); } catch (e) { /* no storage */ }
  }, timing);
  const seen = { requests: [], fromScenes: [], errors: [], console: [], ambientResponses: [] };
  page.on('response', (r) => { try { if (new URL(r.url()).pathname.startsWith('/ambient/')) seen.ambientResponses.push({ url: r.url(), status: r.status(), redirected: !!r.request().redirectedFrom(), type: r.headers()['content-type'] || '' }); } catch (e) { /* no url */ } });
  page.on('request', (r) => { seen.requests.push(r.url()); let f = ''; try { f = r.frame().url(); } catch (e) { /* no frame */ } if (f.indexOf('/ambient/') >= 0) seen.fromScenes.push(r.url()); });
  page.on('pageerror', (e) => seen.errors.push(String(e && e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') seen.console.push(m.text()); });
  await page.goto(BASE + '/#display');
  await page.waitForSelector('.dp-ambient', { state: 'attached', timeout: 20000 });
  return { ctx, page, seen };
}
const frames = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.dp-ambient iframe')).map((f) => ({ scene: f.getAttribute('data-scene'), src: f.getAttribute('src'), on: f.classList.contains('dp-amb-in') })));
const shows = (page, scene) => page.waitForFunction((sc) => { const f = document.querySelector('.dp-ambient iframe[data-scene="' + sc + '"]'); return !!f && f.classList.contains('dp-amb-in'); }, scene, { timeout: 40000 });
const noFrames = (page, ms) => page.waitForFunction(() => document.querySelectorAll('.dp-ambient iframe').length === 0, null, { timeout: ms });
const textShown = (page, t) => page.waitForFunction((x) => document.getElementById('display-page').innerText.includes(x), t, { timeout: 20000 });

function outsiders(seen) {
  return seen.requests.filter((u) => /^https?:/i.test(u) && new URL(u).origin !== BASE);
}

await push(BLANK);
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});   // PW_CHANNEL=msedge uses an installed Edge
try {
  /* ---- A: the cover / grace / uncover cycle (no rotation) ---- */
  const A = await openDisplay(browser, { intervalMs: 600000, graceMs: 4000 });

  await step('a blank display plays the lair in a sandboxed iframe under the stages', async () => {
    await shows(A.page, 'harvest');
    const f = await frames(A.page);
    expect(f.length === 1 && f[0].src === 'ambient/second-harvest', 'one frame, ambient/second-harvest (no .html): ' + JSON.stringify(f));
    const attrs = await A.page.evaluate(() => {
      const fr = document.querySelector('.dp-ambient iframe'), cs = getComputedStyle(fr);
      const layer = document.querySelector('.dp-ambient'), stages = document.querySelector('.dp-stages');
      return {
        sandbox: fr.getAttribute('sandbox'), allow: fr.getAttribute('allow'), hidden: fr.getAttribute('aria-hidden'), tab: fr.getAttribute('tabindex'),
        ref: fr.getAttribute('referrerpolicy'), pe: cs.pointerEvents, border: cs.borderTopWidth, under: !!(layer.compareDocumentPosition(stages) & Node.DOCUMENT_POSITION_FOLLOWING),
        markHidden: getComputedStyle(document.querySelector('.dp-mark')).display === 'none',
        blankClear: getComputedStyle(document.querySelector('.dp-blank')).backgroundColor === 'rgba(0, 0, 0, 0)',
        w: fr.getBoundingClientRect().width, h: fr.getBoundingClientRect().height
      };
    });
    expect(attrs.sandbox === 'allow-scripts allow-same-origin' && attrs.allow === 'screen-wake-lock', 'sandbox / allow: ' + JSON.stringify(attrs));
    expect(attrs.hidden === 'true' && attrs.tab === '-1' && attrs.ref === 'same-origin' && attrs.pe === 'none' && attrs.border === '0px', 'frame attributes: ' + JSON.stringify(attrs));
    expect(attrs.under, 'the ambient layer sits before (under) the stages');
    expect(attrs.markHidden && attrs.blankClear, 'the blank stage is transparent and its mark hidden: ' + JSON.stringify(attrs));
    expect(attrs.w === 1180 && attrs.h === 820, 'the frame fills the screen: ' + attrs.w + 'x' + attrs.h);
  });

  await step('the scene is fetched without .html and answered 200: no 307, nothing redirected (a redirect would never cache offline)', async () => {
    const r = A.seen.ambientResponses.filter((x) => /\/ambient\/second-harvest/.test(x.url));
    expect(r.length >= 1, 'no response seen for the lair: ' + JSON.stringify(A.seen.ambientResponses));
    expect(r.every((x) => new URL(x.url).pathname === '/ambient/second-harvest' && x.status === 200 && !x.redirected), 'the lair: ' + JSON.stringify(r));
    expect(A.seen.ambientResponses.every((x) => x.status === 200 && !x.redirected && !/\.html/.test(x.url)), 'every ambient response is a 200 on an extensionless URL: ' + JSON.stringify(A.seen.ambientResponses));
    expect(/text\/html/.test(r[0].type), 'it is html: ' + r[0].type);
  });

  await step('a quick spotlight does not unload the scene (inside the grace)', async () => {
    await A.page.evaluate(() => { document.querySelector('.dp-ambient iframe').__keep = 1; });
    await push({ kind: 'text', title: 'Flash', text: 'A short word' });
    await textShown(A.page, 'A short word');
    await push(BLANK);
    await A.page.waitForFunction(() => !document.getElementById('display-page').innerText.includes('A short word'), null, { timeout: 20000 });
    const kept = await A.page.evaluate(() => { const f = document.querySelector('.dp-ambient iframe'); return !!f && f.__keep === 1 && f.classList.contains('dp-amb-in'); });
    expect(kept, 'the same iframe element is still up and visible');
  });

  await step('a text spotlight covers it, then the iframe is removed after the grace', async () => {
    await push({ kind: 'text', title: 'Tonight', text: 'The Hart is late tonight' });
    await textShown(A.page, 'The Hart is late tonight');
    expect((await frames(A.page)).length === 1, 'still loaded inside the grace');
    await noFrames(A.page, 15000);
    const op = await A.page.evaluate(() => getComputedStyle(document.querySelector('.dp-text')).backgroundColor);
    expect(op !== 'rgba(0, 0, 0, 0)', 'the text stage is opaque: ' + op);
  });

  await step('blank brings the scene back, and it fades in on load', async () => {
    await push(BLANK);
    await shows(A.page, 'harvest');
    expect((await frames(A.page)).length === 1, 'one frame');
  });

  await step('a map or NPC spotlight covers too (anything but blank)', async () => {
    await push({ kind: 'npc', npcId: 'nobody', title: 'Somebody' });
    await A.page.waitForFunction(() => document.getElementById('display-page').innerText.includes('Somebody'), null, { timeout: 20000 });
    await noFrames(A.page, 15000);
    await push(BLANK);
    await shows(A.page, 'harvest');
  });

  await step('only same-origin requests; no scene called the API (the watch feed runs with ?api=off); no page errors, no CSP refusals', async () => {
    expect(outsiders(A.seen).length === 0, 'requests left the origin: ' + outsiders(A.seen).join(' | '));
    expect(!A.seen.fromScenes.some((u) => new URL(u).pathname.startsWith('/api/')), 'a scene called the API: ' + A.seen.fromScenes.join(' | '));
    expect(A.seen.errors.length === 0, 'page errors: ' + A.seen.errors.join(' | '));
    const csp = A.seen.console.filter((m) => /content security policy|refused to|x-frame-options/i.test(m));
    expect(csp.length === 0, 'CSP / frame refusals: ' + csp.join(' | '));
  });

  /* ---- B: the rotation ---- */
  await push(BLANK);
  const B = await openDisplay(browser, { intervalMs: 3500, graceMs: 60000 });
  await step('the rotation advances: lair, then the watch feed (loaded with ?api=off, no .html), cross-faded', async () => {
    await shows(B.page, 'harvest');
    await shows(B.page, 'watch');
    await B.page.waitForFunction(() => document.querySelectorAll('.dp-ambient iframe').length === 1 && document.querySelector('.dp-ambient iframe').getAttribute('src') === 'ambient/watch-feed?api=off', null, { timeout: 15000 });
  });
  await step('rotation: duskwall comes next, then it wraps to the lair', async () => {
    await shows(B.page, 'duskwall');
    await shows(B.page, 'harvest');
  });
  await step('rotation requests stayed on the origin, with no page errors', async () => {
    expect(outsiders(B.seen).length === 0, 'requests left the origin: ' + outsiders(B.seen).join(' | '));
    expect(!B.seen.fromScenes.some((u) => new URL(u).pathname.startsWith('/api/')), 'a scene called the API: ' + B.seen.fromScenes.join(' | '));
    expect(B.seen.errors.length === 0, 'page errors: ' + B.seen.errors.join(' | '));
  });

  /* ---- C: unmounting leaves nothing behind ---- */
  await step('leaving the display removes the iframes and the layer', async () => {
    await B.page.evaluate(() => { location.hash = '#'; });
    await B.page.waitForFunction(() => document.body.dataset.mode !== 'display', null, { timeout: 15000 });
    const left = await B.page.evaluate(() => document.querySelectorAll('.dp-ambient, iframe').length);
    expect(left === 0, left + ' ambient nodes left');
    await sleep(5000);
    expect(B.seen.errors.length === 0, 'page errors after leaving: ' + B.seen.errors.join(' | '));
  });
  /* ---- D: the GM drives it from the server (Phase 3) ---- */
  const ambient = async (patch) => {
    const r = await fetch(BASE + '/api/gm/ambient', { method: 'PATCH', headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    if (r.status !== 200) throw new Error('ambient PATCH ' + JSON.stringify(patch).slice(0, 80) + ': ' + r.status + ' ' + (await r.text()).slice(0, 120));
    return r.json();
  };
  const current = (page) => page.evaluate(() => { const f = document.querySelector('.dp-ambient iframe.dp-amb-in'); return f ? f.getAttribute('data-scene') : null; });
  const sceneFrame = (page, name) => page.frames().find((fr) => fr.url().includes('/ambient/' + name));
  await ambient({ mode: null, scene: null, playlist: null, intervalMin: null, crew: null, score: null });
  await push(BLANK);
  const D = await openDisplay(browser, { intervalMs: 600000, graceMs: 60000 });
  await shows(D.page, 'harvest');

  await step('PATCH ambient pin duskwall: that scene loads', async () => {
    await ambient({ mode: 'pin', scene: 'duskwall' });
    await shows(D.page, 'duskwall');
    await D.page.waitForFunction(() => document.querySelectorAll('.dp-ambient iframe').length === 1, null, { timeout: 15000 });
    expect((await frames(D.page))[0].src === 'ambient/duskwall-after-dark', 'the pinned scene: ' + JSON.stringify(await frames(D.page)));
  });

  await step('PATCH crew with the watch pinned: the watch frame is told at load, and again on a change', async () => {
    await ambient({ mode: 'pin', scene: 'watch', crew: { heat: 5, wanted: 2 } });
    await shows(D.page, 'watch');
    const fr = () => sceneFrame(D.page, 'watch-feed');
    await sleep(300);
    const read = () => fr().evaluate(() => ({ line: document.getElementById('line').textContent, wl: document.getElementById('wl').textContent }));
    let got = null; for (let i = 0; i < 40 && !(got && got.line === 'LINE · PUSHED'); i++) { got = await read(); if (got.line !== 'LINE · PUSHED') await sleep(250); }
    expect(got.line === 'LINE · PUSHED' && got.wl === '2', 'told at load: ' + JSON.stringify(got));
    await ambient({ crew: { heat: 7, wanted: 3 } });
    for (let i = 0; i < 40 && got.wl !== '3'; i++) { await sleep(250); got = await read(); }
    expect(got.wl === '3' && got.line === 'LINE · PUSHED', 'told on a change, same frame: ' + JSON.stringify(got));
    expect((await frames(D.page)).length === 1, 'the frame was not reloaded');
  });

  await step('auto with a two-scene playlist: Next scene (skip) advances at once; off clears the layer', async () => {
    await ambient({ mode: 'auto', scene: null, playlist: ['harvest', 'duskwall'], crew: null });
    await D.page.waitForFunction(() => { const f = document.querySelector('.dp-ambient iframe.dp-amb-in'); const s = f && f.getAttribute('data-scene'); return s === 'harvest' || s === 'duskwall'; }, null, { timeout: 30000 });
    const before = await current(D.page);
    await ambient({ skip: true });
    await shows(D.page, before === 'harvest' ? 'duskwall' : 'harvest');
    const after = await current(D.page);
    expect(after && after !== before, 'skip moved ' + before + ' to ' + after);
    await ambient({ mode: 'off' });
    await noFrames(D.page, 15000);
    await ambient({ mode: 'auto' });
    await D.page.waitForFunction(() => document.querySelectorAll('.dp-ambient iframe').length >= 1, null, { timeout: 30000 });
  });

  await step('PUT dark: an opaque black stage covers the ambient; clear brings the scene back', async () => {
    await push({ kind: 'dark', title: 'Break' });
    await D.page.waitForFunction(() => { const d = document.querySelector('.dp-dark'); return !!d && d.classList.contains('dp-in'); }, null, { timeout: 20000 });
    await sleep(800);
    const s = await D.page.evaluate(() => {
      const d = document.querySelector('.dp-dark'), cs = getComputedStyle(d), top = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      return { bg: cs.backgroundColor, op: cs.opacity, covers: !!top && !!top.closest('.dp-dark'), text: d.innerText, status: !!document.querySelector('.dp-status') };
    });
    expect(s.bg === 'rgb(0, 0, 0)' && s.op === '1' && s.covers, 'black, opaque, on top: ' + JSON.stringify(s));
    expect(s.text.trim() === '', 'lights out draws nothing: ' + JSON.stringify(s.text));
    await push(BLANK);
    await D.page.waitForFunction(() => !document.querySelector('.dp-dark.dp-in'), null, { timeout: 20000 });
    await D.page.waitForFunction(() => !!document.querySelector('.dp-ambient iframe.dp-amb-in'), null, { timeout: 30000 });
  });

  await step('PATCH a score and pin the planning board: its shell asks, the display answers, an element of the board svg is in the frame', async () => {
    const board = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect width="400" height="300" fill="#d9c8a0"/><g id="e2e-board-mark"><rect x="40" y="40" width="120" height="80" fill="#fff"/><text x="50" y="80">Invented Hall</text></g></svg>';
    const iso = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><g id="e2e-iso-mark"><rect x="40" y="40" width="120" height="80" fill="#9ab"/></g></svg>';
    await ambient({ mode: 'pin', scene: 'board', score: { name: 'Invented Hall', district: 'Nowhere', target: '', reveal: ['public'], view: 'plan', board, iso } });
    await shows(D.page, 'board');
    let n = 0; for (let i = 0; i < 60 && !n; i++) { const fr = sceneFrame(D.page, 'planning-board'); n = fr ? await fr.locator('#e2e-board-mark').count() : 0; if (!n) await sleep(250); }
    expect(n >= 1, 'the board svg reached the frame');
    const fr = sceneFrame(D.page, 'planning-board');
    expect((await fr.content()).includes('Invented Hall'), 'its text is in the frame');
    expect(!(await fr.content()).includes('e2e-iso-mark'), 'the iso is not on the planning board');
    await ambient({ mode: 'pin', scene: 'exploded' });
    await shows(D.page, 'exploded');
    let m = 0; for (let i = 0; i < 60 && !m; i++) { const fx = sceneFrame(D.page, 'score-exploded'); m = fx ? await fx.locator('#e2e-iso-mark').count() : 0; if (!m) await sleep(250); }
    expect(m >= 1, 'the iso svg reached the exploded scene');
  });

  await step('clearing the score drops the score scenes out of a pin', async () => {
    await ambient({ score: null });
    await D.page.waitForFunction(() => { const f = document.querySelector('.dp-ambient iframe.dp-amb-in'); const s = f && f.getAttribute('data-scene'); return !!s && s !== 'exploded' && s !== 'board'; }, null, { timeout: 30000 });
  });

  await step('the whole run: only same-origin requests, no scene called the API, no page errors, no CSP refusals', async () => {
    expect(outsiders(D.seen).length === 0, 'requests left the origin: ' + outsiders(D.seen).join(' | '));
    expect(!D.seen.fromScenes.some((u) => new URL(u).pathname.startsWith('/api/')), 'a scene called the API: ' + D.seen.fromScenes.join(' | '));
    expect(D.seen.errors.length === 0, 'page errors: ' + D.seen.errors.join(' | '));
    const csp = D.seen.console.filter((m) => /content security policy|refused to|x-frame-options/i.test(m));
    expect(csp.length === 0, 'CSP / frame refusals: ' + csp.join(' | '));
    expect(D.seen.ambientResponses.every((x) => x.status === 200 && !x.redirected), 'every scene answered 200: ' + JSON.stringify(D.seen.ambientResponses.filter((x) => x.status !== 200 || x.redirected)));
  });
} finally {
  await browser.close();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
killServer();
process.exit(failed ? 1 : 0);
