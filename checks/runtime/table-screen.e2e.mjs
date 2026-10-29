// The phones' table screen end to end (MM1, design 2.4): the sheet's Table button and viewer, boot.js, the adapter (cf.js) and a real
// local Worker (wrangler dev, DEV_USER) on PORT (default 9014). A player's phone (390 x 844, touch) opens a sheet; the GM puts things on
// the iPad through the API. Checks:
//   - the Table button is in the sticky bar; its dot lights when the iPad shows a map or a handout and goes when the player looks
//   - the viewer shows the map as an <img> from a blob URL (never inline svg), the handout from media/handouts/, the title and caption as TEXT
//   - the viewer makes no request of its own while screenSeq stays put, one more when it moves (a new map, then lights out), and shows
//     "nothing" for lights out; × and Esc close it; the browser's own pinch-zoom is allowed (touch-action, viewport meta)
//   - the mirror switched off takes the dot away and empties an open viewer; a second player's read-only copy of the sheet works too
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] PORT=9014 node checks/runtime/table-screen.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9014);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', P1 = 'p1@example.test', P2 = 'p2@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// an invented handout image, written into the git-ignored app/media/handouts/ for the run and removed after
const MEDIA = path.join(ROOT, 'app', 'media', 'handouts');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const FILE = 'mm1-invented-note.png';
const preExisting = existsSync(MEDIA) ? readdirSync(MEDIA) : [];
mkdirSync(MEDIA, { recursive: true });
writeFileSync(path.join(MEDIA, FILE), PNG);
const cleanMedia = () => { try { rmSync(path.join(MEDIA, FILE), { force: true }); } catch (_) {} if (!preExisting.length) { try { rmSync(MEDIA, { recursive: true, force: true }); } catch (_) {} } };

/* ---------- our own server (only this process group is ever signalled) ---------- */
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-mm1-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use: stop what is on it, or set PORT'); cleanMedia(); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM],
{ cwd: ROOT, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, detached: true, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
function killServer(sig = 'SIGTERM') { try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(-server.pid, sig); } catch (_) {} }
process.on('exit', () => { killServer('SIGKILL'); cleanMedia(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 240000);
const api = (method, p, user, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const display = (d) => api('PUT', '/gm/display', GM, d).then((r) => { if (r.status !== 200) throw new Error('display PUT ' + r.status + ' ' + JSON.stringify(r.json)); return r.json; });
const mapSvg = (fill, word) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><rect width="200" height="100" fill="' + fill + '"/><text x="10" y="50" fill="#fff">' + word + '</text></svg>';

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 90000, 300);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  const made = await api('PUT', '/characters/char_mm1', P1, { name: 'Invented Scoundrel', playbook: 'hound', sheet: { name: 'Invented Scoundrel' }, play: {} });
  check(made.status === 200, 'a player files a character: ' + made.status);

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(user) {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.addInitScript(() => { window.__B68_POLL_MS = 300; });
    const page = await ctx.newPage();
    const screenReqs = [];
    page.on('request', (r) => { if (/\/api\/table\/screen/.test(r.url())) screenReqs.push(r.url()); });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(user + ': ' + m.text()); });
    page.on('pageerror', (e) => errors.push(user + ' pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '/#c/char_mm1');
    await page.waitForSelector('#dossier .ds-bar', { timeout: 30000 });
    return { page, ctx, screenReqs };
  }
  const p1 = await open(P1);
  const page = p1.page;
  const dot = () => page.$$eval('.ds-tablebtn .ds-tdot', (n) => n.length);
  const viewer = () => page.evaluate(() => {
    const v = document.querySelector('.ds-tv'); if (!v) return null;
    const img = v.querySelector('.ds-tv-img'), cap = v.querySelector('.ds-tv-cap');
    return { src: img ? img.getAttribute('src') : null, loaded: img ? img.complete && img.naturalWidth > 0 : false, alt: img ? img.alt : null, cap: cap && !cap.hidden ? cap.textContent : '', none: (v.querySelector('.ds-tv-none') || {}).textContent || '', inlineSvg: v.querySelectorAll('svg').length, injected: v.querySelectorAll('#pwn, script, iframe, [onerror]').length };
  });

  // the button is in the sticky bar, with no dot while the iPad shows nothing a phone may copy
  const barHas = await page.$eval('.ds-bar .ds-nav .ds-tablebtn', (b) => b.textContent.trim()).catch(() => null);
  check(barHas === 'Table', 'the sticky bar has a Table button: ' + JSON.stringify(barHas));
  check((await dot()) === 0, 'no dot while the iPad is blank');
  const box = await page.$eval('.ds-tablebtn', (b) => { const r = b.getBoundingClientRect(); return { h: r.height, w: r.width, inView: r.right <= innerWidth }; });
  check(box.h >= 40 && box.inView, 'the button is a phone-sized tap target inside the bar (' + Math.round(box.w) + ' x ' + Math.round(box.h) + ')');

  // the GM puts a map on the iPad: the dot lights within a poll or two
  const m1 = await display({ kind: 'svg', title: '<b id="pwn">Invented harbour</b>', caption: 'Lantern deck · twelve minutes', svg: mapSvg('#a33', 'Jetty') });
  check(!!(await until(async () => (await dot()) === 1, 10000, 150)), 'a map on the iPad lights the dot');
  check(await page.$eval('.ds-tablebtn', (b) => /changed/.test(b.getAttribute('aria-label'))), 'and the button says so to a screen reader');
  check(p1.screenReqs.length === 0, 'nothing fetched yet: the dot comes from the data poll alone');

  // open the viewer
  await page.click('.ds-tablebtn');
  check(!!(await until(async () => { const v = await viewer(); return v && v.loaded; }, 8000, 100)), 'the viewer opens and the map loads');
  let v = await viewer();
  check(/^blob:/.test(v.src || '') && v.inlineSvg === 0, 'the map is an <img> from a blob URL, never inline svg: ' + (v.src || '').slice(0, 30));
  check(v.cap === '<b id="pwn">Invented harbour</b> · Lantern deck · twelve minutes' && v.injected === 0, 'the title and caption are text, not markup: ' + JSON.stringify(v.cap));
  check(p1.screenReqs.length === 1, 'one request for the picture: ' + p1.screenReqs.length);
  check((await dot()) === 0, 'the dot goes once the player has looked');
  const css = await page.$eval('.ds-tv', (e) => { const s = getComputedStyle(e); return { ta: s.touchAction, bg: s.backgroundColor, pos: s.position, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height }; });
  check(/^(manipulation|pan-x pan-y pinch-zoom)$/.test(css.ta) && css.pos === 'fixed' && css.w === 390 && css.h === 844, 'full screen, touch-action allows pinch-zoom: ' + JSON.stringify(css));
  check(/^rgb\((?:\d|1\d), ?(?:\d|1\d), ?(?:\d|1\d)\)$/.test(css.bg), 'dark background: ' + css.bg);
  const meta = await page.$eval('meta[name="viewport"]', (m) => m.content);
  check(!/user-scalable\s*=\s*(no|0)|maximum-scale/i.test(meta), 'the viewport meta does not forbid zoom: ' + meta);
  // (a real two-finger pinch cannot be synthesised in this headless browser, not even on a plain page: the check is that nothing blocks the
  // browser's own zoom: touch-action 'manipulation' is pan + pinch-zoom, the viewport meta has no limits, and there is no zoom script in the viewer)
  // nothing polls on its own: several data polls go by with screenSeq unchanged
  await sleep(1800);
  check(p1.screenReqs.length === 1, 'the open viewer makes no request while screenSeq stays put (' + p1.screenReqs.length + ')');

  // a new map: screenSeq moves, the viewer refetches once and redraws
  const before = v.src;
  await display({ kind: 'svg', title: 'Second harbour', caption: 'Lower deck', svg: mapSvg('#36a', 'Stairs') });
  check(!!(await until(async () => { const x = await viewer(); return x && x.src && x.src !== before && x.loaded && /Second harbour/.test(x.cap); }, 8000, 100)), 'a new map redraws the open viewer');
  check(p1.screenReqs.length === 2, 'one more request, not a stream: ' + p1.screenReqs.length);

  // lights out: screenSeq goes to 0, the open viewer refetches and shows nothing
  await display({ kind: 'dark' });
  check(!!(await until(async () => { const x = await viewer(); return x && !x.src && /Nothing on the table screen/.test(x.none); }, 8000, 100)), 'lights out empties the open viewer');
  check(p1.screenReqs.length === 3, 'the move to 0 is one more request: ' + p1.screenReqs.length);
  await page.keyboard.press('Escape');
  check((await viewer()) === null, 'Esc closes the viewer');

  // an NPC, text and a rule on the iPad: no dot, and opening the viewer shows nothing
  for (const d of [{ kind: 'npc', npcId: 'invented-npc' }, { kind: 'text', text: 'Invented words' }, { kind: 'rule', md: '# Invented' }]) {
    await display(d); await sleep(900);
    check((await dot()) === 0, d.kind + ' on the iPad: no dot');
  }

  // a handout
  await display({ kind: 'handout', file: FILE, title: 'An invented note', showTitle: true });
  check(!!(await until(async () => (await dot()) === 1, 10000, 150)), 'a handout lights the dot');
  await page.click('.ds-tablebtn');
  check(!!(await until(async () => { const x = await viewer(); return x && x.loaded; }, 8000, 100)), 'the handout loads in the viewer');
  v = await viewer();
  check(v.src === 'media/handouts/' + FILE && v.cap === 'An invented note', 'from the static handouts path, with its title: ' + JSON.stringify([v.src, v.cap]));
  await page.click('.ds-tv-x');
  check((await viewer()) === null, '× closes the viewer');
  check(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('ds-tablebtn')), 'and focus goes back to the Table button');

  // the mirror switched off: the dot goes and an open viewer empties
  await page.click('.ds-tablebtn');
  await until(async () => { const x = await viewer(); return x && x.loaded; }, 8000, 100);
  const off = await api('PATCH', '/gm/state', GM, { mirror: false });
  check(off.status === 200, 'the GM switches the mirror off');
  check(!!(await until(async () => { const x = await viewer(); return x && !x.src && /Nothing on the table screen/.test(x.none); }, 8000, 100)), 'an open viewer empties when the mirror goes off');
  await page.click('.ds-tv-x');
  await display({ kind: 'svg', title: 'Hidden by the switch', svg: mapSvg('#363', 'Off') }); await sleep(1000);
  check((await dot()) === 0, 'a map put up with the mirror off lights no dot');
  await api('PATCH', '/gm/state', GM, { mirror: null });
  check(!!(await until(async () => (await dot()) === 1, 10000, 150)), 'back on: the dot lights for the map that is up');

  // a second player, on someone else's (read only) sheet, can use it too
  const p2 = await open(P2);
  check(!!(await until(async () => (await p2.page.$$eval('.ds-tablebtn .ds-tdot', (n) => n.length)) === 1, 10000, 150)), 'a second player sees the dot on a sheet they cannot edit');
  await p2.page.click('.ds-tablebtn');
  check(!!(await until(async () => p2.page.evaluate(() => { const i = document.querySelector('.ds-tv-img'); return !!i && i.complete && i.naturalWidth > 0; }), 8000, 100)), 'and the viewer opens there');
  await p2.ctx.close();

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
