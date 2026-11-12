// kit-stage (the stage frame, KS13 of the kit and stage build: S1 chrome off, S3 the plate, S7 three transitions, S10 idle), end to end against a
// real local Worker (wrangler dev) on PORT (default 9411; the inspector on PORT + 20000), with invented fixtures only. The iPad (a DISPLAY_EMAILS
// sign-in) opens the display; the GM turns kit.stage on (Settings > Stage), pushes, sets the wire and the mission's alarm, and turns it off again.
//   off      no data-kit, no frame, no kit file fetched, the old chrome
//   S1       on an idle stage: no Full screen button, no status line, no dot; a fault shows one dot (amber retrying, red offline); a tap on the
//            corner brings the chrome back for 5 seconds
//   S3       the map caption and the scene caption (the wire) on the plate: inside the inner 90%, every line at least 3.3% of the screen's height,
//            4.5:1 on the plate, the timed plate shows its timer; at 1024x768, 1180x820 and 768x1024, Night and Paper
//   S7       push (a new push), wipe (the same map again), alarm (the mission's alarm fills: the flash), and cut under reduced motion (no flash)
//   S10      idle: the scene held still, and no animation running in the page or in the scene's frame
// The display makes no request outside its own origin. KIT_SHOTS=<dir> saves the pictures.
//   PW_MODULE=<path to playwright-core> [PW_CHANNEL=msedge] [PORT=9411] [KIT_SHOTS=<dir>] node checks/runtime/kit-stage.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9411);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const SHOTS = process.env.KIT_SHOTS || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

let failed = 0, passed = 0;
async function step(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.message || e)); } }
const expect = (c, m) => { if (!c) throw new Error(m); };

/* ---------- no browser: the file's own rules and its pure parts ---------- */
const SRC = readFileSync(path.join(ROOT, 'app', 'display', 'kit', 'stage.js'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'app', 'display', 'kit', 'stage.css'), 'utf8');
await step('stage.js: no markup sink, no request, no hand-built button; stage.css: every rule under the stage token, no important flag, no mangled punctuation', async () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  expect(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment/.test(code), 'a markup sink in stage.js');
  expect(!/fetch\(|XMLHttpRequest|\.src\s*=|sendBeacon|WebSocket/.test(code), 'a request in stage.js');
  expect(!/<button/.test(code), 'a hand-built button in stage.js');
  const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '').replace(/@media[^{]+\{/g, '');
  const sels = (rules.match(/[^{}]+\{/g) || []).map((s) => s.slice(0, -1).trim()).filter(Boolean);
  for (const s of sels) for (const one of s.split(',')) expect(one.trim().startsWith(':root[data-kit~="stage"]'), 'a rule outside the stage token: ' + one.trim());
  expect(!/!\s*important/i.test(CSS), 'an important flag in stage.css');
  expect(!/[\u0080-\u009f]/.test(CSS) && !/[\u0080-\u009f]/.test(SRC), 'a character in U+0080 to U+009F');
});
await step('B68Stage.Pure: the transition picked, the timer text, the alarm, the fault, the theme', async () => {
  const St = require(path.join(ROOT, 'app', 'display', 'kit', 'stage.js'));
  const P = St.Pure;
  expect(JSON.stringify(St.TRANSITIONS) === JSON.stringify(['cut', 'push', 'wipe', 'alarm']), 'the four names: ' + St.TRANSITIONS);
  expect(JSON.stringify(St.SLOTS) === JSON.stringify(['clock', 'crew', 'roll', 'clocks']), 'the four slots: ' + St.SLOTS);
  const map = { kind: 'svg', title: 'The Pelican Rooms' };
  expect(P.pick(null, map, true, false) === 'cut', 'a stage the frame has not seen: cut');
  expect(P.pick({ kind: 'blank', title: '' }, map, false, false) === 'cut', 'the first stage: cut');
  expect(P.pick({ kind: 'blank', title: '' }, map, true, false) === 'push', 'a new push: push');
  expect(P.pick(map, { kind: 'svg', title: 'The Pelican Rooms' }, true, false) === 'wipe', 'the same map again: wipe');
  expect(P.pick(map, { kind: 'svg', title: 'Another drawing' }, true, false) === 'push', 'another map: push');
  expect(P.pick(map, { kind: 'text', title: 'The Pelican Rooms' }, true, false) === 'push', 'text after a map of the same name: push');
  expect(P.pick(map, map, true, true) === 'cut', 'reduced motion: cut');
  expect(P.fmt(14000) === '0:14' && P.fmt(13001) === '0:14' && P.fmt(65000) === '1:05' && P.fmt(0) === '0:00' && P.fmt(-5) === '0:00', 'm:ss rounded up');
  expect(P.alarmFull({ alarm: { name: 'Alarm', size: 6, filled: 6 } }).full === true && P.alarmFull({ alarm: { name: 'Alarm', size: 6, filled: 5 } }).full === false && P.alarmFull({}) === null, 'the alarm is full at its size');
  expect(P.faultTone('dp-dot dp-dot-bad') === 'alarm' && P.faultTone('dp-dot dp-dot-warn') === 'caution' && P.faultTone('dp-dot dp-dot-ok') === '' && P.faultTone('dp-dot dp-dot-idle') === '', 'the fault tones');
  expect(P.themeOf('light') === 'paper' && P.themeOf('dark') === 'night' && P.themeOf(null) === 'night', 'the stage theme: Night unless the page is Paper');
});

/* ---------- the browser run ---------- */
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-kit-stage-e2e-'));
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

let up = false;
for (let i = 0; i < 180 && !up; i++) { try { up = (await fetch(BASE + '/index.html', { signal: AbortSignal.timeout(2000) })).status > 0; } catch (_) {} if (!up) await sleep(500); }
if (!up) { console.log('FAIL server did not start'); process.exit(1); }

const gm = (method, p, body) => fetch(BASE + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const ok = async (pr, what) => { const r = await pr; if (r.status !== 200) throw new Error(what + ': ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 160)); return r.json; };
const push = (doc) => ok(gm('PUT', '/api/gm/display', doc), 'push ' + doc.kind);
const ambient = (patch) => ok(gm('PATCH', '/api/gm/ambient', patch), 'ambient');
const setting = (on) => ok(gm('PATCH', '/api/campaign', { features: { 'kit.stage': on } }), 'kit.stage ' + on);
let mseq = 0;
const mission = (filled) => ok(gm('PATCH', '/api/campaign', { mission: filled === null ? null : { v: 1, site: 'The Pelican Rooms', t: 90, seq: ++mseq,
  hud: { time: '21:14', showTime: true, label: 'Gala night', now: [], next: [], alarm: { name: 'Alarm', size: 6, filled, text: '' }, crew: [] } } }), 'mission');
/* invented drawings that name nothing of their own, so the page gives them a caption */
const svgOf = (fill) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect x="10" y="10" width="380" height="280" fill="' + fill + '" stroke="#eee" stroke-width="4"/><rect x="40" y="40" width="140" height="100" fill="#456"/></svg>';
const MAP = { kind: 'svg', title: 'The Pelican Rooms', caption: 'Ground floor: the cloakroom and the floor', svg: svgOf('#223') };
const MAP2 = { ...MAP, caption: 'Ground floor: the quiet side of the hall opened', svg: svgOf('#232') };
const WIRE = 'Invented bulletin: the Pelican Rooms shuts its doors at midnight.';
const SIZES = [[1024, 768], [1180, 820], [768, 1024]];

async function openIpad(browser, o = {}) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1024, height: 768 }, reducedMotion: o.reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  await page.addInitScript((a) => {
    try {
      if (window !== window.top) return;
      localStorage.setItem('b68.display.ambientTiming', JSON.stringify({ wireOnMs: 30000, wireGapMs: 600000, wireFirstMs: 300 }));
      if (a.theme) localStorage.setItem('b68.theme', a.theme);
    } catch (e) { /* no storage */ }
  }, { theme: o.theme || '' });
  const seen = { requests: [], errors: [] };
  page.on('request', (r) => seen.requests.push(r.url()));
  page.on('pageerror', (e) => seen.errors.push(String(e && e.message || e)));
  await page.goto(BASE + '/');
  await page.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 20000 });
  return { ctx, page, seen };
}
const frameOn = (page, ms = 30000) => page.waitForFunction(() => !!document.querySelector('.dp-root .stage-frame') && /(^|\s)stage(\s|$)/.test(document.documentElement.getAttribute('data-kit') || ''), null, { timeout: ms });
const sceneIn = (page) => page.waitForFunction(() => { const f = document.querySelector('.dp-ambient iframe.dp-amb-in'); return !!f && !!f.contentDocument && f.contentDocument.readyState === 'complete'; }, null, { timeout: 40000 });
const tx = (page) => page.evaluate(() => document.querySelector('.dp-root').getAttribute('data-stage-tx'));

/* the plate's measures: its box against the inner 90%, every text line's height against the screen's, the contrast on its own ground */
const plateMeasure = (sel) => {
  const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
  const p = document.querySelector(sel); if (!p) return null;
  const r = p.getBoundingClientRect(), bg = getComputedStyle(p).backgroundColor, W = innerWidth, H = innerHeight;
  const alpha = (bg.match(/[\d.]+/g) || []).map(Number)[3];
  let minPx = 999, minRatio = 99; const texts = [];
  for (const n of p.querySelectorAll('.ui-slot')) {
    if (!n.textContent.trim() || getComputedStyle(n).display === 'none') continue;
    const cs = getComputedStyle(n), px = parseFloat(cs.fontSize);
    minPx = Math.min(minPx, px); texts.push(n.getAttribute('data-ui-slot') + ':' + px.toFixed(1));
    const a = lum(cs.color) + 0.05, b = lum(bg) + 0.05; minRatio = Math.min(minRatio, Math.max(a, b) / Math.min(a, b));
    const nr = n.getBoundingClientRect(); if (nr.right > r.right + 1 || nr.left < r.left - 1) minRatio = -1;
  }
  return { l: r.left, t: r.top, r: r.right, b: r.bottom, W, H, minPx, minRatio, texts, opaque: alpha === undefined || alpha === 1, text: p.innerText };
};
const inside90 = (m) => m.l >= 0.05 * m.W - 1 && m.r <= 0.95 * m.W + 1 && m.b <= 0.95 * m.H + 1 && m.t >= 0.05 * m.H - 1;
function judgePlate(m, what) {
  expect(m, what + ': no plate');
  expect(inside90(m), what + ': outside the inner 90%: ' + JSON.stringify({ l: m.l, t: m.t, r: m.r, b: m.b, W: m.W, H: m.H }));
  expect(m.minPx >= 0.033 * m.H - 0.01, what + ': text under 3.3% of the height (' + (0.033 * m.H).toFixed(1) + ' px): ' + m.texts.join(' '));
  expect(m.minRatio >= 4.5, what + ': contrast on the plate ' + m.minRatio.toFixed(2));
  expect(m.opaque, what + ': the plate is not opaque');
}
/* running animations in the page and in every same-origin frame (the scene) */
const running = (page) => page.evaluate(() => {
  const count = (d) => (d.getAnimations ? d.getAnimations() : []).filter((a) => a.playState === 'running').map((a) => (a.animationName || a.transitionProperty || 'anim') + '@' + ((a.effect && a.effect.target && a.effect.target.className) || '').toString().slice(0, 40));
  const out = { page: count(document), frames: [] };
  for (const f of document.querySelectorAll('iframe')) { try { if (f.contentDocument) out.frames.push(...count(f.contentDocument)); } catch (e) { out.frames.push('unreadable'); } }
  return out;
});
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); }

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
let I = null;
try {
  await push({ kind: 'blank' });
  await ambient({ mode: 'pin', scene: 'duskwall' });
  await setting(false);

  I = await openIpad(browser);
  await sceneIn(I.page);

  await step('off: no data-kit, no frame, no kit file fetched, the old chrome (Full screen) on a tap', async () => {
    await sleep(4500);   // a poll has come and gone
    const v = await I.page.evaluate(() => ({ kit: document.documentElement.getAttribute('data-kit'), frame: !!document.querySelector('.stage-frame'), fs: !!document.querySelector('.dp-chrome .dp-fs') }));
    expect(v.kit === null && !v.frame && v.fs, 'off: ' + JSON.stringify(v));
    expect(!I.seen.requests.some((u) => /display\/kit\/|\/ui\/(?!kit-flag\.js)/.test(u)), 'a kit file (other than the flag) was fetched with the setting off');
    await I.page.mouse.click(500, 400);
    await I.page.waitForFunction(() => document.querySelector('.dp-root').classList.contains('dp-ui') && getComputedStyle(document.querySelector('.dp-chrome')).pointerEvents === 'auto', null, { timeout: 5000 });
  });

  await setting(true);
  await step('on: the frame attaches within a few polls; the stage is Night at distance; the scene is held still', async () => {
    await frameOn(I.page);
    const v = await I.page.evaluate(() => { const r = document.querySelector('.dp-root'), f = document.querySelector('.dp-ambient iframe.dp-amb-in');
      return { theme: r.getAttribute('data-ui-theme'), density: r.getAttribute('data-density'), still: !!(f && f.contentDocument && f.contentDocument.documentElement.classList.contains('b68-fx-off')), idle: r.classList.contains('stage-idle-on') }; });
    expect(v.theme === 'night' && v.density === 'distance' && v.still && v.idle, JSON.stringify(v));
  });

  await step('S1 + S10: the idle stage shows the art and nothing else: no Full screen, no status, no dot; nothing animates, here or in the scene', async () => {
    await I.page.mouse.move(10, 10); await sleep(7600);       // past the old 7 s chrome
    const v = await I.page.evaluate(() => {
      const vis = (q) => { const e = document.querySelector(q); if (!e) return false; const cs = getComputedStyle(e); return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.01; };
      return { chrome: vis('.dp-chrome'), status: vis('.dp-status'), hint: vis('.dp-hint:not([hidden])'), dot: vis('.stage-fault .ui-dot'), fault: document.querySelector('.stage-fault').getAttribute('data-stage-fault'),
        slots: [...document.querySelectorAll('.stage-slot')].filter((e) => getComputedStyle(e).display !== 'none').length, plate: !!document.querySelector('.stage-lower .stage-plate') };
    });
    expect(!v.chrome && !v.status && !v.hint && !v.dot && v.fault === 'none' && v.slots === 0 && !v.plate, 'idle: ' + JSON.stringify(v));
    await I.page.mouse.click(500, 400); await sleep(300);
    expect(!(await I.page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.dp-chrome')).opacity) > 0)), 'a tap on the art does not bring the chrome back');
    await sleep(1500);
    const a = await running(I.page);
    expect(a.page.length === 0 && a.frames.length === 0, 'running animations on an idle stage: ' + JSON.stringify(a));
    await shot(I.page, 'idle-night-1024');
  });

  await step('S1: a fault is one dot (amber retrying, red offline); a tap on it brings Full screen and the status back for 5 seconds', async () => {
    await I.page.route('**/api/gm/display*', (r) => r.abort());
    await I.page.waitForFunction(() => document.querySelector('.stage-fault').getAttribute('data-stage-fault') === 'caution', null, { timeout: 20000 });
    const amber = await I.page.evaluate(() => { const d = document.querySelector('.stage-fault .ui-dot'); const cs = getComputedStyle(d); return { vis: cs.visibility, bg: cs.backgroundColor, w: d.getBoundingClientRect().width }; });
    expect(amber.vis === 'visible' && amber.w >= 14, 'the amber dot shows: ' + JSON.stringify(amber));
    await shot(I.page, 'fault-amber-night-1024');
    await I.page.waitForFunction(() => document.querySelector('.stage-fault').getAttribute('data-stage-fault') === 'alarm', null, { timeout: 45000 });
    const red = await I.page.evaluate(() => getComputedStyle(document.querySelector('.stage-fault .ui-dot')).backgroundColor);
    expect(red !== amber.bg, 'red is not amber: ' + red);
    await shot(I.page, 'fault-red-night-1024');
    const box = await I.page.evaluate(() => { const r = document.querySelector('.stage-fault').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; });
    expect(box.w >= 44, 'the corner is a 44 px target: ' + box.w);
    await I.page.mouse.click(box.x, box.y);
    await sleep(150);
    const c = await I.page.evaluate(() => ({ on: document.querySelector('.dp-root').classList.contains('stage-chrome'), fs: getComputedStyle(document.querySelector('.dp-chrome')).opacity, pe: getComputedStyle(document.querySelector('.dp-chrome')).pointerEvents,
      status: getComputedStyle(document.querySelector('.dp-status')).opacity, text: document.querySelector('.dp-status-text').textContent }));
    expect(c.on && c.fs === '1' && c.pe === 'auto' && c.status === '1' && /Offline|trouble/.test(c.text), 'the chrome is back: ' + JSON.stringify(c));
    await shot(I.page, 'chrome-back-night-1024');
    await sleep(5300);
    expect(!(await I.page.evaluate(() => document.querySelector('.dp-root').classList.contains('stage-chrome'))), 'the chrome goes again after 5 seconds');
    await I.page.unroute('**/api/gm/display*');
    await I.page.waitForFunction(() => document.querySelector('.stage-fault').getAttribute('data-stage-fault') === 'none', null, { timeout: 30000 });
  });

  await step('S7 + S3: a map is a push; its caption is a plate under the drawing; the same map again is a wipe', async () => {
    await I.page.evaluate(() => { window.__tx = []; new MutationObserver(() => { const r = document.querySelector('.dp-root'); window.__tx.push(r.getAttribute('data-stage-tx') + (document.querySelector('.stage-in-push') ? '+in-push' : '') + (document.querySelector('.stage-in-wipe') ? '+in-wipe' : '')); }).observe(document.querySelector('.dp-root'), { attributes: true, subtree: true, attributeFilter: ['data-stage-tx', 'class'] }); });
    await push(MAP);
    await I.page.waitForSelector('.dp-stage.dp-map .stage-dock.dp-capbar .stage-plate', { timeout: 15000 });
    await sleep(600);
    const log1 = await I.page.evaluate(() => window.__tx.slice());
    expect(log1.some((x) => x === 'push+in-push') && (await tx(I.page)) === 'push', 'the map came in by a push: ' + log1.join(','));
    const g = await I.page.evaluate(() => { const f = document.querySelector('.dp-stage.dp-map .dp-map-frame').getBoundingClientRect(), d = document.querySelector('.dp-stage.dp-map .stage-dock').getBoundingClientRect();
      return { fb: f.bottom, dt: d.top, title: document.querySelector('.stage-dock .dp-strip-title').textContent, cap: document.querySelector('.stage-dock .dp-strip-cap').textContent, stages: document.querySelectorAll('.dp-stages > .dp-stage').length }; });
    expect(Math.abs(g.fb - g.dt) <= 2, 'the drawing ends where the plate\'s dock starts: ' + JSON.stringify(g));
    expect(g.title === MAP.title && g.cap === MAP.caption && g.stages === 1, 'the plate says the title and the caption, the old stage is gone: ' + JSON.stringify(g));
    for (const [w, h] of SIZES) {
      await I.page.setViewportSize({ width: w, height: h }); await sleep(500);
      judgePlate(await I.page.evaluate(plateMeasure, '.stage-dock .stage-plate'), 'map caption ' + w + 'x' + h);
      await shot(I.page, 'map-caption-night-' + w);
    }
    await I.page.setViewportSize({ width: 1024, height: 768 });
    await I.page.evaluate(() => { window.__tx = []; });
    await push(MAP2);
    await I.page.waitForFunction((c) => { const e = document.querySelector('.dp-stage.dp-map.dp-in .dp-strip-cap'); return !!e && e.textContent === c; }, MAP2.caption, { timeout: 15000 });
    await sleep(600);
    const log2 = await I.page.evaluate(() => window.__tx.slice());
    expect(log2.some((x) => x === 'wipe+in-wipe') && (await tx(I.page)) === 'wipe', 'the same map again came in by a wipe: ' + log2.join(','));
    expect((await I.page.evaluate(() => document.querySelectorAll('.dp-stages > .dp-stage').length)) === 1, 'one stage left after the wipe');
  });

  await step('S7: taking it down is a push back to the idle stage, and nothing is left moving', async () => {
    await push({ kind: 'blank' });
    await I.page.waitForFunction(() => document.querySelector('.dp-root').classList.contains('stage-idle-on') && document.querySelectorAll('.dp-stages > .dp-stage').length === 1, null, { timeout: 15000 });
    expect((await tx(I.page)) === 'push', 'push: ' + (await tx(I.page)));
    await sleep(1800);
    const a = await running(I.page);
    expect(a.page.length === 0 && a.frames.length === 0, 'running after the push: ' + JSON.stringify(a));
  });

  await step('S3: the scene caption (the wire) is a timed plate in the lower third, with its timer; it goes when the wire is cleared', async () => {
    await ambient({ wire: [{ id: 'w1', text: WIRE }] });
    await I.page.waitForSelector('.stage-lower .stage-plate[data-stage-caption="wire"]', { timeout: 20000 });
    const v = await I.page.evaluate(() => { const p = document.querySelector('.stage-lower .stage-plate'); return { title: p.querySelector('[data-ui-slot="title"]').textContent, kicker: p.querySelector('[data-ui-slot="kicker"]').textContent,
      timer: p.querySelector('[data-ui-slot="timer"]').textContent, timed: p.hasAttribute('data-stage-timed'), role: p.getAttribute('role'), old: !!document.querySelector('.dp-wire.dp-wire-on'),
      oldShown: getComputedStyle(document.querySelector('.dp-wire')).display !== 'none' }; });
    expect(v.title === WIRE && v.kicker === 'Wire' && /^0:[0-3]\d$/.test(v.timer) && v.timed && v.role === 'status' && v.old && !v.oldShown, 'the wire on a plate: ' + JSON.stringify(v));
    for (const [w, h] of SIZES) {
      await I.page.setViewportSize({ width: w, height: h }); await sleep(500);
      judgePlate(await I.page.evaluate(plateMeasure, '.stage-lower .stage-plate'), 'scene caption ' + w + 'x' + h);
      await shot(I.page, 'scene-caption-night-' + w);
    }
    await I.page.setViewportSize({ width: 1024, height: 768 });
    const a = await running(I.page);
    expect(a.page.length === 0 && a.frames.length === 0, 'a timed plate steps, it does not animate: ' + JSON.stringify(a));
    await ambient({ wire: null });
    await I.page.waitForFunction(() => !document.querySelector('.stage-lower .stage-plate'), null, { timeout: 20000 });
  });

  await step('S7: the alarm: the mission\'s alarm clock filling is a hard cut to a red flash and back; a reload of a full alarm is not', async () => {
    await mission(5);
    await sleep(5000);
    await I.page.evaluate(() => { window.__flash = 0; new MutationObserver(() => { if (!document.querySelector('.stage-flash').hidden) window.__flash++; }).observe(document.querySelector('.stage-flash'), { attributes: true, attributeFilter: ['hidden'] }); });
    await mission(6);
    await I.page.waitForFunction(() => window.__flash > 0, null, { timeout: 15000 });
    const word = await I.page.evaluate(() => document.querySelector('.stage-flash-word').textContent);
    expect((await tx(I.page)) === 'alarm' && word === 'Alarm', 'the flash names the alarm: ' + word);
    await I.page.waitForFunction(() => document.querySelector('.stage-flash').hidden, null, { timeout: 3000 });
    await sleep(5000);
    expect((await I.page.evaluate(() => window.__flash)) === 1, 'one flash, not one per poll');
    await mission(null);
  });

  await step('Paper: the stored theme makes the stage Paper; the plates pass at the three sizes', async () => {
    const P = await openIpad(browser, { theme: 'light' });
    try {
      await frameOn(P.page); await sceneIn(P.page);
      expect((await P.page.evaluate(() => document.querySelector('.dp-root').getAttribute('data-ui-theme'))) === 'paper', 'paper');
      await sleep(1500);
      await shot(P.page, 'idle-paper-1024');
      await ambient({ wire: [{ id: 'w2', text: WIRE }] });
      await P.page.waitForSelector('.stage-lower .stage-plate[data-stage-caption="wire"]', { timeout: 20000 });
      for (const [w, h] of SIZES) {
        await P.page.setViewportSize({ width: w, height: h }); await sleep(500);
        judgePlate(await P.page.evaluate(plateMeasure, '.stage-lower .stage-plate'), 'paper scene caption ' + w + 'x' + h);
        await shot(P.page, 'scene-caption-paper-' + w);
      }
      await ambient({ wire: null });
      await push(MAP);
      await P.page.waitForSelector('.dp-stage.dp-map.dp-in .stage-dock .stage-plate', { timeout: 15000 });
      for (const [w, h] of SIZES) {
        await P.page.setViewportSize({ width: w, height: h }); await sleep(600);
        judgePlate(await P.page.evaluate(plateMeasure, '.dp-stage.dp-map.dp-in .stage-dock .stage-plate'), 'paper map caption ' + w + 'x' + h);
        await shot(P.page, 'map-caption-paper-' + w);
      }
      expect(P.seen.errors.length === 0, 'page errors: ' + P.seen.errors.join(' | '));
    } finally { await P.ctx.close(); }
    await push({ kind: 'blank' });
  });

  await step('reduced motion: every change is a cut, and the alarm does not flash', async () => {
    const R = await openIpad(browser, { reduced: true });
    try {
      await frameOn(R.page); await sleep(1000);
      await push(MAP);
      await R.page.waitForSelector('.dp-stage.dp-map.dp-in .stage-dock', { timeout: 15000 });
      expect((await tx(R.page)) === 'cut', 'a map under reduced motion: ' + (await tx(R.page)));
      expect(!(await R.page.evaluate(() => !!document.querySelector('.stage-in-push, .stage-in-wipe, .stage-out-push'))), 'no transition class');
      await mission(5); await sleep(5000);
      await R.page.evaluate(() => { window.__flash = 0; new MutationObserver(() => { if (!document.querySelector('.stage-flash').hidden) window.__flash++; }).observe(document.querySelector('.stage-flash'), { attributes: true, attributeFilter: ['hidden'] }); });
      await mission(6);
      await R.page.waitForFunction(() => document.querySelector('.dp-root').getAttribute('data-stage-tx') === 'alarm', null, { timeout: 15000 });
      expect((await R.page.evaluate(() => window.__flash)) === 0, 'no flash under reduced motion');
    } finally { await R.ctx.close(); }
    await mission(null);
    await push({ kind: 'blank' });
  });

  await step('off again: the frame goes, the scene moves again, the old chrome comes back on a tap; no request left the origin', async () => {
    await setting(false);
    await I.page.waitForFunction(() => !document.querySelector('.stage-frame') && !document.querySelector('.stage-fault') && !(document.documentElement.getAttribute('data-kit') || '').includes('stage'), null, { timeout: 30000 });
    const v = await I.page.evaluate(() => { const r = document.querySelector('.dp-root'), f = document.querySelector('.dp-ambient iframe.dp-amb-in');
      return { theme: r.getAttribute('data-ui-theme'), tx: r.getAttribute('data-stage-tx'), still: !!(f && f.contentDocument && f.contentDocument.documentElement.classList.contains('b68-fx-off')) }; });
    expect(v.theme === null && v.tx === null && !v.still, 'nothing of the frame is left: ' + JSON.stringify(v));
    await I.page.mouse.click(500, 400);
    await I.page.waitForFunction(() => document.querySelector('.dp-root').classList.contains('dp-ui') && getComputedStyle(document.querySelector('.dp-chrome')).pointerEvents === 'auto', null, { timeout: 5000 });
    const out = I.seen.requests.filter((u) => /^https?:/i.test(u) && new URL(u).origin !== BASE);
    expect(out.length === 0, 'requests outside the origin: ' + out.join(', '));
    expect(I.seen.errors.length === 0, 'page errors: ' + I.seen.errors.join(' | '));
  });

  await step('the look book: the plate at the three sizes in both themes, the map caption, the idle stage and the three transitions', async () => {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1200, height: 900 } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    try {
      await p.goto(BASE + '/lookbook.html');
      await p.waitForSelector('.lb-card', { timeout: 20000 });
      const kinds = await p.evaluate(() => [...document.querySelectorAll('.lb-card figcaption code')].map((c) => c.textContent));
      const n = (k) => kinds.filter((x) => x === k).length;
      expect(n('stage-plate-night') === 3 && n('stage-plate-paper') === 3 && n('stage-map-night') === 3 && n('stage-idle-night') === 3 && n('stage-txpush-night') === 1 && n('stage-txwipe-night') === 1 && n('stage-txalarm-night') === 1, 'the stage cards: ' + kinds.filter((k) => /^stage-/.test(k)).join(','));
      for (const [w, h] of SIZES) {
        for (const t of ['night', 'paper']) {
          const f = await ctx.newPage();
          await f.setViewportSize({ width: w, height: h });
          await f.goto(BASE + '/lookbook.html?frame=stage-plate-' + t);
          await f.waitForSelector('.stage-lower .stage-plate', { timeout: 20000 });
          await sleep(700);
          judgePlate(await f.evaluate(plateMeasure, '.stage-lower .stage-plate'), 'look book plate ' + t + ' ' + w + 'x' + h);
          if (w === 1024) await shot(f, 'lookbook-plate-' + t + '-' + w);
          if (t === 'night' && w === 1024) {
            await f.goto(BASE + '/lookbook.html?frame=stage-idle-night'); await f.waitForSelector('.stage-slot-clocks .ui-meter', { timeout: 20000 }); await sleep(1200);
            await shot(f, 'lookbook-idle-night-1024');
          }
          await f.close();
        }
      }
      expect(errs.length === 0, 'page errors: ' + errs.join(' | '));
    } finally { await ctx.close(); }
  });
} finally {
  if (I) await I.ctx.close().catch(() => {});
  await browser.close();
}
console.log((failed ? 'FAIL' : 'PASS') + ' kit-stage: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
