// The Music desk in a real browser (M1; app/gm/music.js) against its own demo night (scripts/demo-night.mjs):
//   - Before > The room holds the Music tool: three playlists; generated WAV tracks go in through each playlist's picker (setInputFiles) and stay
//   - the band's pill waits, paused, until a tap; Play plays Hanging around; a phase change (the Score chip) brings Tension; a Desperate 1–3 brings Action;
//     a manual mood holds and Auto takes back over; PANIC fades it down and Resume brings it back; Stop fades it out
//   - a reload keeps the library and waits for a tap; Esc closes the popover (and does not PANIC); no request carries audio or a track's name
//   - nothing overflows at 1366, 1536 or 390 (the pill hides on a phone), and there are no console errors
//   PW_MODULE=<playwright-core> PW_CHANNEL=msedge [PORT=8601] [GM_SHOTS=<dir>] node checks/runtime/music.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8601);
const SHOTS = process.env.GM_SHOTS || '';
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const WIN = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const Mu = require('../../app/gm/music.js');

let passed = 0, failed = 0;
const check = (ok, name) => { if (ok) { passed++; console.log('PASS ' + name); } else { failed++; console.log('FAIL ' + name); } };
async function until(fn, ms, step = 150) { const t0 = Date.now(); for (;;) { let v; try { v = await fn(); } catch (e) { v = false; } if (v || Date.now() - t0 > ms) return v; await sleep(step); } }

let demo = null, tmp = '', browser = null;
async function startDemo() {
  tmp = mkdtempSync(path.join(tmpdir(), 'b68-m1-music-'));
  demo = spawn(process.execPath, [path.join(ROOT, 'scripts', 'demo-night.mjs'), '--port', String(PORT), '--state', tmp], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } });
  let out = '';
  demo.stdout.on('data', (d) => { out += d; }); demo.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 240 && !/Ctrl\+C stops it/.test(out); i++) { await sleep(500); if (demo.exitCode !== null) break; }
  if (!/Ctrl\+C stops it/.test(out)) { console.log('FAIL the demo night did not come up\n' + out.slice(-1500)); await stop(); process.exit(1); }
}
async function stop() {
  if (browser) { try { await browser.close(); } catch (e) { /* gone */ } browser = null; }
  if (demo && demo.pid) { if (WIN) spawnSync('taskkill', ['/PID', String(demo.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-demo.pid, 'SIGKILL'); } catch (e) { try { demo.kill('SIGKILL'); } catch (e2) { /* gone */ } } } }
  if (tmp) { await sleep(800); try { rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* a lingering handle */ } }
}
const timer = setTimeout(async () => { console.log('FAIL timed out'); await stop(); process.exit(1); }, 420000);

/* the tracks: a WAV made here (no audio file in the repo), 12 s each, two per playlist */
const wav = (secs) => Buffer.from(Mu.toneWav(secs));
const TRACKS = { calm: ['m1-calm-a', 'm1-calm-b'], tension: ['m1-tension-a', 'm1-tension-b'], action: ['m1-action-a', 'm1-action-b'] };
const files = (l) => TRACKS[l].map((n) => ({ name: n + '.wav', mimeType: 'audio/wav', buffer: wav(12) }));

const PILL = '[data-band-slot="music"] [data-mu-pill]', POP = '[data-band-slot="music"] .gm-mu-pop';
const attr = (page, a) => page.$eval(PILL, (e, k) => e.getAttribute(k), a);

try {
  if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
  await startDemo();
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, args: ['--autoplay-policy=user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, extraHTTPHeaders: { 'X-Dev-User': GM }, reducedMotion: 'reduce' });
  await ctx.addInitScript(atPlace('before', { before: 'room' }));
  const page = await ctx.newPage();
  const errors = [], sent = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() !== 'error') return; const at = (m.location() && m.location().url) || ''; if (at.includes(':9300') || at.endsWith('/media/theme.mp3')) return; errors.push('console: ' + m.text() + (at ? ' @ ' + at : '')); });
  page.on('request', (r) => { let body = null; try { body = r.postDataBuffer(); } catch (e) { body = null; } sent.push({ url: r.url(), method: r.method(), type: (r.headers()['content-type'] || ''), body }); });
  await page.goto(BASE + '/#gm', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.B68GmMusic && document.querySelector('[data-band-slot="music"] [data-mu-pill]'), null, { timeout: 60000 });
  await page.waitForTimeout(1200);

  /* ---- the Music tool in The room ---- */
  const room = await until(() => page.$eval('#gm-vpane', (e) => !!e.querySelector('[data-vcell="music"] [data-inline="music"] [data-mu-list="calm"]')), 15000);
  check(room, 'Before > The room draws the Music tool inline, first in the grid');
  check(await page.$$eval('[data-vcell="music"] [data-mu-list]', (a) => a.map((e) => e.getAttribute('data-mu-list')).join(',')) === 'calm,tension,action', 'three playlists: Hanging around, Tension, Action');
  check(await page.$eval('[data-vcell="music"]', (e) => /Hanging around/.test(e.textContent) && /Tension/.test(e.textContent) && /Action/.test(e.textContent)), 'each playlist named');
  check(await page.$eval(PILL, (e) => /Music/.test(e.textContent) && e.getAttribute('data-state') === 'pause'), 'the band pill says Music, paused, before any track is in');
  for (const l of ['calm', 'tension', 'action']) {
    await page.setInputFiles('[data-vcell="music"] [data-mu-file="' + l + '"]', files(l));
    const ok = await until(() => page.$eval('[data-vcell="music"] [data-mu-sum="' + l + '"]', (e) => e.textContent), 10000).then(() => until(() => page.$eval('[data-vcell="music"] [data-mu-sum="' + l + '"]', (e) => /^2 tracks · 1 min$/.test(e.textContent)), 10000));
    check(ok, l + ': two generated tracks added through the picker ("2 tracks · 1 min", the lengths read from the files)');
  }
  check(await page.$$eval('[data-vcell="music"] .gm-mu-tracks li', (a) => a.length) === 6, 'six tracks listed, each with its length');
  check(await page.$eval('[data-vcell="music"] [data-mu="sink"]', (s) => s.options[0] && /default output/.test(s.options[0].textContent)), 'Output: the laptop’s default output first, then the named outputs');
  check(await page.$eval('[data-vcell="music"] [data-mu-store]', (e) => /Stored in this browser/.test(e.textContent)), 'the storage used is shown');
  const box = await page.$eval('[data-vcell="music"]', (e) => { const r = e.getBoundingClientRect(); return { w: r.width, sw: e.scrollWidth, cw: e.clientWidth }; });
  check(box.sw <= box.cw + 1, 'the Music tool does not overflow at 1366 (' + JSON.stringify(box) + ')');
  if (SHOTS) { const el = await page.$('[data-vcell="music"]'); await el.screenshot({ path: path.join(SHOTS, 'tool-1366.png') }); }

  /* ---- never by itself: waits for a tap ---- */
  await page.waitForTimeout(1500);
  check(await attr(page, 'data-state') === 'pause' && await attr(page, 'data-list') === '', 'with tracks in, nothing plays until a tap');
  await page.click(PILL);
  check(await until(() => page.$eval(POP, (e) => !e.hidden), 3000), 'a tap on the pill opens its popover');
  check(await page.$$eval(POP + ' [data-mu-mode]', (a) => a.map((b) => b.textContent).join('|')) === 'Hanging around|Tension|Action|Auto|Stop', 'the moods, Auto and Stop as one segmented control');
  check(await page.$$eval(POP + ' [data-mu-act]', (a) => a.map((b) => b.getAttribute('data-mu-act')).join(',')) === 'toggle,next,library', '▶/❚❚, Next track and Library… in the popover');
  check(!!(await page.$(POP + ' [data-mu-vol]')), 'a volume slider');
  if (SHOTS) { await page.screenshot({ path: path.join(SHOTS, 'popover-1366.png'), clip: { x: 0, y: 0, width: 1366, height: 420 } }); }
  await page.click(POP + ' [data-mu-act="toggle"]');
  const played = await until(async () => (await attr(page, 'data-state')) === 'play' && (await attr(page, 'data-list')) === 'calm', 6000);
  check(played, 'Play: Hanging around plays (Before is not the Score)');
  if (!played) console.log('  the pill: ' + JSON.stringify(await page.$eval(PILL, (e) => [e.getAttribute('data-state'), e.getAttribute('data-list'), e.getAttribute('data-mode'), e.title])) + ' the popover: ' + await page.$eval(POP, (e) => e.textContent));
  check(await page.$eval(PILL, (e) => /Hanging around/.test(e.textContent) && !!e.querySelector('.gm-mu-a')), 'the pill reads ♪ Hanging around with the A of Auto');
  check(await until(() => page.$eval(POP + ' [data-mu-np]', (e) => /Now playing/.test(e.textContent) && /m1-calm-/.test(e.textContent)), 4000), 'now playing names the track');
  /* ---- a phase change brings Tension ---- */
  await page.click('[data-band-place="score"]');
  check(await until(async () => (await attr(page, 'data-mood')) === 'tension' && (await attr(page, 'data-list')) === 'tension', 8000), 'the Score: Tension, at once (a step up)');
  /* ---- a trigger brings Action: a Desperate 1–3 ---- */
  await until(() => page.$('[data-gm="pos"][data-v="desperate"]'), 8000);
  await page.click('[data-gm="pos"][data-v="desperate"]');
  await page.click('[data-gm="situation"][data-sit="onetothree"]');
  check(await until(async () => (await attr(page, 'data-mood')) === 'action' && (await attr(page, 'data-list')) === 'action', 8000), 'a Desperate 1–3 in the Score: Action');
  /* ---- a manual mood holds; Auto takes back over ---- */
  if (!(await page.$eval(POP, (e) => !e.hidden))) await page.click(PILL);
  await page.click(POP + ' [data-mu-mode="calm"]');
  check(await until(async () => (await attr(page, 'data-mode')) === 'calm' && (await attr(page, 'data-list')) === 'calm', 6000), 'a tap on Hanging around holds it (no A)');
  check(await page.$eval(PILL, (e) => !e.querySelector('.gm-mu-a')), 'the pill drops the A while a mood is held');
  await page.waitForTimeout(1500);
  check(await attr(page, 'data-list') === 'calm', 'the held mood stays while the Score holds Action');
  await page.click(POP + ' [data-mu-mode="auto"]');
  check(await until(async () => (await attr(page, 'data-mode')) === 'auto' && (await attr(page, 'data-list')) === 'action', 6000), 'Auto takes back over: Action (still inside its 90 s)');
  check(await page.evaluate(() => { try { const p = JSON.parse(localStorage.getItem('b68.gm.music')); return p && p.auto === true && typeof p.vol === 'number'; } catch (e) { return false; } }), 'the choices are in localStorage b68.gm.music');

  /* ---- Esc closes the popover, and only that ---- */
  await page.click('#gm-page .gm-main', { position: { x: 5, y: 5 } }).catch(() => {});
  if (!(await page.$eval(POP, (e) => !e.hidden))) await page.click(PILL);
  await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await page.keyboard.press('Escape');
  check(await until(() => page.$eval(POP, (e) => e.hidden), 2000), 'Esc closes the popover');
  check(await page.$eval('.gm-band-r2', (e) => e.getAttribute('data-alarm') !== 'panic'), 'and does not PANIC');

  /* ---- PANIC fades it down; Resume brings it back ---- */
  await page.click('[data-band="panic"]');
  check(await until(async () => (await attr(page, 'data-gate')) === 'down', 4000), 'PANIC: the music fades to silence (within a second of the work light)');
  check(await attr(page, 'data-state') === 'play', 'it keeps its place under the work light');
  const resume = await until(() => page.$('.gm-cs-resume'), 4000);
  if (resume) await resume.click();
  check(!!resume && await until(async () => (await attr(page, 'data-gate')) === 'up', 6000), 'Resume brings it back');

  /* ---- the shots of the pill and the popover at 1366 and 1536, and the fit ---- */
  for (const w of [1366, 1536]) {
    await page.setViewportSize({ width: w, height: w === 1366 ? 768 : 864 });
    await page.waitForTimeout(500);
    if (await page.$eval(POP, (e) => e.hidden)) await page.click(PILL);
    await page.waitForTimeout(300);
    const fit = await page.evaluate(([pill, pop]) => {
      const vw = document.documentElement.clientWidth, vh = innerHeight, r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
      const p = r(pill), o = r(pop), panic = r('[data-band="panic"]'), mic = r('#gm-bar-stt:not([hidden])'), cue = r('.gm-band-cue'), tray = r('.gm-band-tray');
      const over = (a, b) => !!(a && b && a.w > 0 && b.w > 0 && a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5);
      return { p, o, vw, vh, inWin: !!p && p.l >= 0 && p.r <= vw && p.t >= 0, popIn: !!o && o.l >= 0 && o.r <= vw + 0.5 && o.b <= vh, hitPanic: over(p, panic), hitMic: over(p, mic), hitCue: over(p, cue), hitTray: over(p, tray),
        panicIn: !!panic && panic.r <= vw + 0.5, scroll: document.documentElement.scrollWidth <= vw + 1 };
    }, [PILL, POP]);
    check(fit.inWin && fit.popIn && !fit.hitPanic && !fit.hitMic && !fit.hitCue && !fit.hitTray && fit.panicIn && fit.scroll, 'at ' + w + ': the pill sits in row 2 beside the mic, overlaps nothing, PANIC stays in the window, the popover fits (' + JSON.stringify(fit) + ')');
    if (SHOTS) {
      await page.screenshot({ path: path.join(SHOTS, 'popover-' + w + '.png'), clip: { x: 0, y: 0, width: w, height: 430 } });
      await page.click(PILL); await page.mouse.move(w / 2, 600); await page.waitForTimeout(250);
      await page.screenshot({ path: path.join(SHOTS, 'band-pill-' + w + '.png'), clip: { x: 0, y: 0, width: w, height: 100 } });
    } else await page.click(PILL);
  }
  await page.setViewportSize({ width: 1366, height: 768 });

  /* ---- Stop fades it out ---- */
  await page.click(PILL);
  await page.click(POP + ' [data-mu-mode="off"]');
  check(await until(async () => (await attr(page, 'data-mode')) === 'off' && (await attr(page, 'data-state')) === 'pause', 4000), 'Stop: the music fades out and the pill reads Off');
  await page.click(POP + ' [data-mu-mode="auto"]');
  check(await until(async () => (await attr(page, 'data-state')) === 'play', 4000), 'Auto after Stop plays again');

  /* ---- a reload keeps the library and waits for a tap ---- */
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.B68GmMusic && document.querySelector('[data-band-slot="music"] [data-mu-pill]'), null, { timeout: 60000 });
  check(await until(async () => /Tension|Action|Hanging/.test(await page.$eval(PILL, (e) => e.textContent)), 8000), 'after a reload the pill knows its tracks');
  await page.waitForTimeout(2000);
  check(await attr(page, 'data-state') === 'pause' && await attr(page, 'data-list') === '', 'after a reload it waits, paused, for a tap');
  await page.click(PILL);
  check(await until(() => page.$eval(POP + ' [data-mu-np]', (e) => /tap on ▶/.test(e.textContent)), 3000), 'and says so in the popover');
  await page.click(POP + ' [data-mu-act="library"]');
  check(await until(() => page.$$eval('[data-inline="music"] .gm-mu-tracks li', (a) => a.length === 6), 8000), 'Library… opens the Music tool, all six tracks still there (IndexedDB)');
  check(await page.$eval(POP, (e) => e.hidden), 'Library… closes the popover');
  /* ---- 390: no overflow, the pill hidden (the phone is not the player), the tool stacks ---- */
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, extraHTTPHeaders: { 'X-Dev-User': GM }, reducedMotion: 'reduce' });
  await ph.addInitScript(atPlace('before', { before: 'room' }));
  const pp = await ph.newPage();
  pp.on('pageerror', (e) => errors.push('390 pageerror: ' + e.message));
  pp.on('console', (m) => { if (m.type() !== 'error') return; const at = (m.location() && m.location().url) || ''; if (at.includes(':9300') || at.endsWith('/media/theme.mp3')) return; errors.push('390 console: ' + m.text()); });
  await pp.goto(BASE + '/#gm', { waitUntil: 'domcontentloaded' });
  await pp.waitForFunction(() => window.B68GmMusic && document.querySelector('[data-band-slot="music"] [data-mu-pill]'), null, { timeout: 60000 });
  await pp.evaluate(() => { const T = window.B68GmTools; const t = T && T.get('music'); if (t) t.open(); });
  await until(() => pp.$('[data-mu-file="action"]'), 8000);
  /* a fresh browser has its own library: fill it here too, so the phone's picture shows three filled playlists */
  for (const l of ['calm', 'tension', 'action']) { await pp.setInputFiles('[data-mu-file="' + l + '"]', files(l)); await until(() => pp.$eval('[data-mu-sum="' + l + '"]', (e) => /^2 tracks/.test(e.textContent)), 8000); }
  await until(() => pp.$eval('[data-mu-list="action"] .gm-mu-tracks li', () => true), 8000);
  const p390 = await pp.evaluate(() => {
    const vw = document.documentElement.clientWidth, slot = document.querySelector('[data-band-slot="music"]');
    const lists = Array.from(document.querySelectorAll('[data-mu-list]')).filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); return { l: r.left, r: r.right }; });
    return { scroll: document.documentElement.scrollWidth <= vw + 1, pillHidden: getComputedStyle(slot).display === 'none', lists, fit: lists.every((r) => r.l >= -0.5 && r.r <= vw + 0.5), n: lists.length };
  });
  check(p390.scroll && p390.pillHidden && p390.n >= 3 && p390.fit, 'at 390: nothing overflows, the band pill is hidden, the three playlists fit (' + JSON.stringify(p390) + ')');
  if (SHOTS) {
    const m = await pp.$('.gm-mu');
    if (m) { await m.scrollIntoViewIfNeeded(); await m.screenshot({ path: path.join(SHOTS, 'tool-390.png') }); }
  }
  await ph.close();

  /* ---- nothing audio left the laptop ---- */
  const names = Object.values(TRACKS).flat();
  const bad = sent.filter((r) => /^audio\//i.test(r.type) || (r.body && (r.body.includes('RIFF') || r.body.includes('WAVE'))) || names.some((n) => r.url.includes(n) || (r.body && r.body.includes(n))));
  check(bad.length === 0, 'no request carries audio or a track’s name (' + sent.length + ' requests; ' + bad.slice(0, 3).map((r) => r.method + ' ' + r.url).join(', ') + ')');
  check(errors.length === 0, 'no console or page error' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
}
clearTimeout(timer);
await stop();
console.log((failed ? 'FAILED ' : 'ALL PASSED ') + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
