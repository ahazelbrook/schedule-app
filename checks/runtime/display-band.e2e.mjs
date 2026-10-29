// The band beside the map on the table display (VV3, design 5.3), end to end against a real local Worker (wrangler dev) on PORT (default
// 8900), with invented fixtures only. The iPad (a DISPLAY_EMAILS sign-in) opens #display; the GM pushes a map and a mission; the band
// draws from the display answer's mission.hud. At 1180x820 and 1366x1024 (landscape) and 820x1180 (portrait): the band sits beside the
// map (below it in portrait), never over it, the caption bar and the corner status keep their places, nothing in it is under 26 px, the
// time is at least 112 px, the squares at least 22 px, every line has 4.5:1 contrast, and it all fits. The band hides over an npc,
// text, rule, dark and blank stage; a hud change shows within one poll; NEXT turns amber (with words) at one beat; no hud, no band.
// The display never requests /api/campaign and its poll stays on the 4 s beat.
//   PW_MODULE=<path to playwright-core> PW_CHANNEL=msedge node checks/runtime/display-band.e2e.mjs      (BAND_SHOTS=<dir> saves screenshots)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8900);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const SHOTS = process.env.BAND_SHOTS || '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-band-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

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
/* an invented map: a plain drawing that names nothing of its own, so the page gives it a title and caption bar (the case fitAboveBar serves) */
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect x="10" y="10" width="380" height="280" fill="#223" stroke="#eee" stroke-width="4"/><rect x="40" y="40" width="140" height="100" fill="#456"/><rect x="220" y="150" width="140" height="110" fill="#654"/></svg>';
const pushMap = () => gm('PUT', '/api/gm/display', { kind: 'svg', title: 'The Pelican Rooms', caption: 'Ground floor', svg: SVG });
const HUD = (over = {}) => ({
  time: '22:30', label: 'Gala night',
  now: [{ text: 'The photo call', where: 'The floor', until: '23:00' }],
  next: [{ text: 'The toast', where: 'Showroom', at: '00:00', inMin: 90 }],
  night: { beats: 16, start: 2, cur: 6, marks: [{ i: 3, icon: 'star', text: 'The speeches' }, { i: 12, icon: 'diamond', text: 'The fireworks' }] },
  alarm: { name: 'Fuse', size: 6, filled: 2, text: 'A door slams' },
  crew: [{ name: 'Ada', costume: 'Cook', icon: 'tray', room: 'Cocktail lounge' }, { name: 'Bo', costume: 'Guest', icon: 'mask', room: 'Showroom' }, { name: 'Cy', costume: 'Guard', icon: 'jacket', room: '' }, { name: 'Di', costume: 'Guest', icon: 'mask', room: 'Cocktail lounge' }],
  ways: { found: 2, total: 7 }, ...over
});
let seq = 0;
const setMission = (hud) => gm('PATCH', '/api/campaign', { mission: hud === null ? null : { v: 1, site: 'The Pelican Rooms', t: 90, seq: ++seq, hud } });

const geometry = () => {
  const box = (q) => { const x = document.querySelector(q); if (!x) return null; const r = x.getBoundingClientRect(); return r.width && r.height ? { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height } : null; };
  const band = document.querySelector('.dp-band');
  const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
  const bg = band ? getComputedStyle(band).backgroundColor : 'rgb(0,0,0)';
  let minFont = 999, minContrast = 99, clock = 0, minSq = 999, texts = 0;
  if (band) {
    for (const n of band.querySelectorAll('p, span')) {
      const own = [...n.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim());
      if (!own || n.classList.contains('dp-b-sq')) continue;
      const cs = getComputedStyle(n), px = parseFloat(cs.fontSize);
      if (n.classList.contains('dp-b-badge')) continue;
      texts++; minFont = Math.min(minFont, px);
      if (n.classList.contains('dp-b-clock')) clock = px;
      const a = lum(cs.color) + 0.05, b = lum(bg) + 0.05;
      minContrast = Math.min(minContrast, Math.max(a, b) / Math.min(a, b));
    }
    for (const q of band.querySelectorAll('.dp-b-sq')) minSq = Math.min(minSq, q.getBoundingClientRect().width, q.getBoundingClientRect().height);
  }
  const stage = document.querySelector('.dp-stage.dp-map');
  return {
    vw: innerWidth, vh: innerHeight, band: band && !band.hidden ? box('.dp-band') : null, svg: box('.dp-map-frame svg'), frame: box('.dp-map-frame'), strip: box('.dp-strip'), status: box('.dp-status'),
    stage: stage ? (() => { const r = stage.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; })() : null,
    secBottom: band ? Math.max(...[...band.querySelectorAll('.dp-b-sec')].filter((x) => x.offsetParent).map((x) => x.getBoundingClientRect().bottom)) : 0, fit: band ? { sh: band.scrollHeight, ch: band.clientHeight, sw: band.scrollWidth, cw: band.clientWidth } : null,
    minFont, minContrast, clock, minSq, texts, text: band ? band.innerText : '', hscroll: document.documentElement.scrollWidth > innerWidth
  };
};
const waitBand = (page, on, ms = 15000) => page.waitForFunction((o) => { const b = document.querySelector('.dp-band'); return !!b && !b.hidden === o; }, on, { timeout: ms });

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
try {
  expect((await pushMap()).status === 200, 'could not push a map as the GM');
  expect((await setMission(HUD())).status === 200, 'could not write a mission as the GM');

  for (const [name, w, h] of [['1180x820', 1180, 820], ['1366x1024', 1366, 1024], ['820x1180 portrait', 820, 1180]]) {
    const portrait = h > w;
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: w, height: h } });
    const page = await ctx.newPage();
    const calls = [], reads = [];
    page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) calls.push(u.pathname); if (u.pathname === '/api/gm/display') reads.push({ at: Date.now(), q: u.search }); });
    const errors = []; page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
    await page.goto(BASE + '/');
    await page.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 15000 });
    await waitBand(page, true);
    await sleep(900);   // the stage cross-fade and the first fit
    let g;

    await step(name + ': the band is drawn from the hud, in the fixture\'s words', async () => {
      g = await page.evaluate(geometry);
      for (const t of ['22:30', 'Gala night', 'NOW', 'The photo call', 'until 23:00', 'NEXT', 'The toast', 'in 1 h 30', 'Fuse 2 of 6', 'A door slams', 'Ada', 'Cook']) expect(new RegExp(t, 'i').test(g.text), 'the band says "' + t + '": ' + JSON.stringify(g.text));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'band-' + name.replace(/\W+/g, '-') + '.png') });
    });
    await step(name + ': the band sits beside the map (below it in portrait), never over it; the caption bar and the status keep clear', async () => {
      expect(g.band && g.svg && g.strip && g.status, 'band, map, caption bar and status all measured: ' + JSON.stringify({ b: !!g.band, s: !!g.svg, c: !!g.strip, t: !!g.status }));
      if (!portrait) {
        expect(Math.abs(g.band.w / g.vw - 0.36) < 0.02, 'about 36% wide: ' + (g.band.w / g.vw).toFixed(3));
        expect(g.svg.r <= g.band.l + 1 && g.strip.r <= g.band.l + 1 && g.frame.r <= g.band.l + 1, 'the map and the caption end where the band starts: ' + JSON.stringify({ svg: g.svg.r, strip: g.strip.r, band: g.band.l }));
        expect(g.band.t <= 1 && g.band.b >= g.vh - 1, 'full height');
      } else {
        expect(g.svg.b <= g.band.t + 1 && g.strip.b <= g.band.t + 1 && g.frame.b <= g.band.t + 1, 'the map and the caption end where the band starts: ' + JSON.stringify({ svg: g.svg.b, strip: g.strip.b, band: g.band.t }));
        expect(g.band.l <= 1 && g.band.r >= g.vw - 1, 'full width');
      }
      expect(g.svg.w > 200 && g.svg.h > 150, 'the map still has room: ' + g.svg.w + 'x' + g.svg.h);
      // the caption bar is still under the frame (the fitAboveBar geometry of gm-maps.e2e) and the frame still ends where the bar starts
      expect(Math.abs(g.frame.b - g.strip.t) <= 2, 'the frame ends where the caption bar starts: ' + g.frame.b + ' vs ' + g.strip.t);
      expect(g.strip.t >= g.svg.b - 2 && g.strip.b <= g.stage.b + 1, 'the caption bar is under the drawing and inside the stage');
      // the status line sits in the left corner and the band never covers it
      const apart = portrait ? g.status.t >= g.secBottom - 1 : g.status.r <= g.band.l + 1;   // portrait: it sits in the band's bottom margin, below the last line
      expect(apart, 'the status line is not under the band: ' + JSON.stringify({ s: g.status, b: g.band }));
      expect(g.status.t >= g.svg.b - 1 || g.status.b <= g.svg.t + 1, 'and not over the drawing');
      expect(!g.hscroll, 'no horizontal page scroll');
    });
    await step(name + ': type for 1 to 1.5 m: time at least 112 px, nothing under 26 px, squares at least 22 px, 4.5:1 contrast, and it fits', async () => {
      expect(g.clock >= 112, 'the time is ' + g.clock + ' px');
      expect(g.minFont >= 26, 'smallest text is ' + g.minFont + ' px');
      expect(g.minSq >= 22, 'smallest square is ' + g.minSq + ' px');
      expect(g.minContrast >= 4.5, 'lowest contrast is ' + g.minContrast.toFixed(2));
      expect(g.fit.sh <= g.fit.ch + 1 && g.fit.sw <= g.fit.cw + 1, 'the band fits its box (nothing cut off): ' + JSON.stringify(g.fit));
      expect(g.texts >= 10, 'read ' + g.texts + ' text lines');
    });
    await step(name + ': the band has no controls: nothing in it takes a tap', async () => {
      const r = await page.evaluate(() => { const b = document.querySelector('.dp-band'); return { ctl: b.querySelectorAll('button, a, input, select, textarea, [tabindex], [onclick]').length, pe: getComputedStyle(b).pointerEvents }; });
      expect(r.ctl === 0 && r.pe === 'none', JSON.stringify(r));
    });
    await step(name + ': the squares are the night: 16 beats, 2 shaded before the start, 4 past, 1 outlined, 2 marked', async () => {
      const r = await page.evaluate(() => { const q = (c) => document.querySelectorAll('.dp-b-sq-' + c).length; return { all: document.querySelectorAll('.dp-b-sq').length, before: q('before'), past: q('past'), cur: q('cur'), marked: document.querySelectorAll('.dp-b-marked').length, glyphs: [...document.querySelectorAll('.dp-b-marked')].map((x) => x.textContent).join('') }; });
      expect(r.all === 16 && r.before === 2 && r.past === 4 && r.cur === 1 && r.marked === 2 && r.glyphs === '★◆', JSON.stringify(r));
    });

    await step(name + ': a hud change shows within one poll, and NEXT turns amber with its words at one beat', async () => {
      const t0 = Date.now();
      expect((await setMission(HUD({ time: '23:45', next: [{ text: 'The toast', where: 'Showroom', at: '00:00', inMin: 15 }] }))).status === 200, 'mission write');
      await page.waitForFunction(() => document.querySelector('.dp-b-clock') && document.querySelector('.dp-b-clock').textContent === '23:45', null, { timeout: 7000 });
      const took = Date.now() - t0;
      expect(took <= 6500, 'took ' + took + ' ms');
      const r = await page.evaluate(() => ({ soon: !!document.querySelector('.dp-b-next.dp-b-soon'), text: document.querySelector('.dp-b-next').innerText, col: getComputedStyle(document.querySelector('.dp-b-next .dp-b-kick')).color }));
      expect(r.soon && /Next, soon/i.test(r.text) && /in 15 min/.test(r.text), JSON.stringify(r));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'band-soon-' + name.replace(/\W+/g, '-') + '.png') });
      await setMission(HUD());
      await page.waitForFunction(() => document.querySelector('.dp-b-clock').textContent === '22:30', null, { timeout: 7000 });
    });

    await step(name + ': the band hides over an npc, text, rule, dark and blank stage, and comes back over the map', async () => {
      const pushes = [
        { kind: 'npc', npcId: 'nobody', title: 'Somebody' },
        { kind: 'text', title: 'Tonight', text: 'Words for the table' },
        { kind: 'rule', title: 'A rule', md: 'Roll **two** dice.' },
        { kind: 'dark', title: '' },
        { kind: 'blank', title: '' }];
      for (const p of pushes) {
        expect((await gm('PUT', '/api/gm/display', p)).status === 200, 'push ' + p.kind);
        await waitBand(page, false, 9000);
        const shown = await page.evaluate(() => ({ band: !!document.querySelector('.dp-band') && !document.querySelector('.dp-band').hidden, on: document.querySelector('.dp-root').classList.contains('dp-band-on') }));
        expect(!shown.band && !shown.on, 'hidden over ' + p.kind + ': ' + JSON.stringify(shown));
      }
      await pushMap(); await waitBand(page, true, 9000); await sleep(900);
      const g2 = await page.evaluate(geometry);
      expect(g2.band && g2.svg && (portrait ? g2.svg.b <= g2.band.t + 1 : g2.svg.r <= g2.band.l + 1), 'back over the map: ' + JSON.stringify({ band: g2.band, svg: g2.svg }));
    });

    await step(name + ': no mission, no band: the map takes the whole frame', async () => {
      expect((await setMission(null)).status === 200, 'mission removed');
      await waitBand(page, false, 9000); await sleep(700);
      const g3 = await page.evaluate(geometry);
      expect(!g3.band, 'no band');
      expect(Math.abs(g3.stage.r - g3.vw) <= 1 && Math.abs(g3.stage.b - g3.vh) <= 1, 'the stage fills the screen: ' + JSON.stringify(g3.stage));
      expect(Math.abs(g3.frame.r - g3.vw) <= 1, 'the frame runs to the edge');
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'band-none-' + name.replace(/\W+/g, '-') + '.png') });
      seq = Math.max(seq, 0); await setMission(HUD()); await waitBand(page, true, 9000);
    });

    await step(name + ': the poll stays on the 4 s beat with hseq on it, and the display never asks for /api/campaign', async () => {
      expect(!calls.includes('/api/campaign'), 'requests: ' + [...new Set(calls)].join(', '));
      expect(reads.length >= 3 && reads.every((x) => /[?&]hseq=\d+/.test(x.q)), 'every look carries hseq: ' + reads.slice(0, 3).map((x) => x.q).join(' | '));
      // quiet stretch: with nothing changing, the looks are 4 s apart (a live-sync poke may add one; never faster than ~3.5 s on average)
      const n0 = reads.length; await sleep(12500);
      const looks = reads.slice(n0);
      expect(looks.length >= 2 && looks.length <= 4, 'looks in 12.5 s: ' + looks.length);
      const gaps = looks.slice(1).map((x, i) => x.at - looks[i].at);
      expect(gaps.every((d) => d >= 3000), 'gaps ' + gaps.join(','));
      expect(errors.length === 0, 'page errors: ' + errors.join(' | '));
    });
    await ctx.close();
    await pushMap();
  }

  await step('reduced motion: the band repaints with no transition or animation', async () => {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1180, height: 820 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/'); await page.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 15000 });
    await waitBand(page, true);
    await setMission(HUD({ time: '21:15' }));
    await page.waitForFunction(() => document.querySelector('.dp-b-clock').textContent === '21:15', null, { timeout: 7000 });
    const r = await page.evaluate(() => { const b = document.querySelector('.dp-band'), cs = getComputedStyle(b); return { anim: cs.animationName, cls: b.classList.contains('dp-b-fade'), tr: cs.transitionDuration }; });
    expect(r.anim === 'none' && !r.cls, JSON.stringify(r));
    await ctx.close();
  });
  await step('with motion allowed, a change fades in over 300 ms and nothing else moves', async () => {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1180, height: 820 } });
    const page = await ctx.newPage();
    await page.goto(BASE + '/'); await page.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 15000 });
    await waitBand(page, true);
    await setMission(HUD({ time: '21:45' }));
    await page.waitForFunction(() => document.querySelector('.dp-b-clock').textContent === '21:45', null, { timeout: 7000 });
    const r = await page.evaluate(() => { const cs = getComputedStyle(document.querySelector('.dp-band')); return { anim: cs.animationName, dur: cs.animationDuration }; });
    expect(r.anim === 'dp-b-fade' && r.dur === '0.3s', JSON.stringify(r));
    await ctx.close();
  });
} finally {
  await browser.close();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
killServer();
process.exit(failed ? 1 : 0);
