// The Chase panel (C) on the real GM page and the iPad's display, in a real browser, against a local wrangler dev (PORT, default 8861):
// the tab, key and phone segment; a chase started from the Location roll's street; ticks drawing one panel each (stored in the GM state);
// Show on iPad sending only the player copy (no roll line, no hidden clock); the display page drawing it; the next tick reaching the iPad
// by itself; Find listing the panels' captions; End chase keeping it under Past chases; a phone layout (two rows of six, 44 px, nothing
// wider than the screen). Invented fixtures only (checks/runtime/fixtures/gm/).
// The strip is map kit 0.6's (B68Map.chase). Until the vendored kit has it, the page is served the kit with
// checks/runtime/fixtures/chase-kit-stub.js appended (it installs only on a kit without a chase strip of its own).
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node checks/runtime/gm-chase.e2e.mjs
// PW_MODULE=<path to playwright> picks the Playwright install; GM_SHOTS=<dir> saves screenshots there (the panel at 1440×900, the
// iPad's display at 1366×1024, the phone).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8861);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const SHOTS = process.env.GM_SHOTS || '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), scn = fx('scenes-pack.json');
const PARTS = {
  console: con.parts.console, campaign: con.parts.campaign, scenes: scn.parts.scenes,
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: new Date().toISOString() }, T: loc.T, extra: loc.extra },
};
const STUB = readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'chase-kit-stub.js'), 'utf8');
const KIT = require(path.join(ROOT, 'app', 'maps', 'map-kit.js'));

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-chase-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM], { cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: 'ignore' });
function killServer() {
  if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} }
}
process.on('exit', () => { killServer(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const api = (method, p, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j }; });
const gmState = async () => (await api('GET', '/gm/state')).json.doc;
const onIpad = async () => (await api('GET', '/gm/display')).json;
const ROLL1 = 'Ana · Finesse · risky/standard · 4', ROLL2 = 'Bo · Skirmish · desperate/great · 6', HIDDEN = 'Reinforcements arrive';

try {
  const up = await until(async () => { try { return (await fetch(BASE + '/index.html')).status > 0; } catch (_) { return false; } }, 90000, 500);
  if (!up) throw new Error('the server did not start');
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src || {}, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  await api('PATCH', '/campaign', { session: { number: 2 } });
  console.log('map kit ' + KIT.VERSION + (typeof KIT.chase === 'function' ? ' (its own chase strip)' : ' (no chase strip: the checks stub is appended to it)'));

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(hash, { width = 1440, height = 900, mobile = false, ready = '#gm-buttons .gm-btn' } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width, height }, serviceWorkers: 'block', isMobile: mobile, hasTouch: mobile });
    await c.addInitScript(() => { window.__B68_POLL_MS = 700; });
    await c.route('**/maps/map-kit.js*', async (route) => {
      const res = await route.fetch(), body = await res.text();
      await route.fulfill({ response: res, body: body + '\n;' + STUB, headers: { ...res.headers(), 'content-type': 'application/javascript' } });
    });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '/' + hash);
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    if (ready) await page.waitForSelector(ready, { timeout: 30000 });
    return { c, page };
  }
  const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
  const shot = async (page, name) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
  const panelOf = (page) => page.$eval('#gm-root', (r) => r.getAttribute('data-panel'));
  async function tick(page, n, cap, roll, between) {
    const before = await page.$$eval('#gm-ch-strip svg', (s) => s.length ? s[0].outerHTML.length : 0);
    await page.fill('#gm-ch-cap', cap); if (roll) await page.fill('#gm-ch-roll', roll); if (between) await page.fill('#gm-ch-between', between);
    await page.click('#gm-chase [data-gm="ch-tick"][data-n="' + n + '"]');
    await page.waitForFunction((b) => { const s = document.querySelector('#gm-ch-strip svg'); return s && s.outerHTML.length !== b; }, before, { timeout: 10000 });
  }

  /* ---- the laptop: the tab, the key, a chase from the Location roll's street ---- */
  const G = await open('#gm');
  const p = G.page;
  check((await p.$$eval('.gm-tab', (t) => t.map((x) => x.getAttribute('data-panel')).join())) === 'prep,rules,location,scenes,score,chase,npc,downtime,cards,ipad', 'the side tabs: Chase after Score');
  check(await p.$eval('.gm-tabs', (t) => t.scrollWidth <= t.clientWidth + 1 && [...t.querySelectorAll('.gm-tab')].every((x) => x.getBoundingClientRect().right <= t.getBoundingClientRect().right + 1 && !!x.querySelector('kbd'))), 'the ten side tabs fit one row at 1440 px, each with its key');
  await p.keyboard.press('b');
  await p.click('[data-gm="locroll"]');
  await p.waitForSelector('#gm-loc .gm-loccard', { timeout: 15000 });
  const street = await p.evaluate(() => window.B68GmPage._state().locRoll.namedStreet);
  await p.keyboard.press('c');
  check(await panelOf(p) === 'chase' && await p.$eval('#gm-chase', (e) => !e.hidden), 'key C opens the Chase panel');
  check(await p.$eval('#gm-chase [data-k="from"][data-v="location"]', (b) => b.getAttribute('aria-pressed') === 'true' && b.textContent.includes('Location')), 'the street defaults to the Location roll\'s: ' + await text(p, '#gm-chase [data-k="from"][data-v="location"]'));
  await p.fill('#gm-ch-name', 'The tallow run');
  await p.fill('#gm-ch-clock', 'Shake them');
  await p.click('#gm-chase [data-k="opp"][data-v="hidden"]');
  await p.fill('#gm-ch-opp', HIDDEN);
  await shot(p, 'chase-gm-1440-start');
  await p.click('#gm-chase [data-gm="ch-start"]');
  check(await p.waitForSelector('#gm-chase .gm-ch-play', { timeout: 10000 }).then(() => true, () => false), 'Start the chase: the tick box shows');
  await tick(p, 2, 'The autopod clips a fruit stand', ROLL1, 'A flashback to the garage');
  await p.click('#gm-chase [data-k="level"][data-v="above"]');
  await p.click('#gm-chase [data-k="time"][data-v="Night"]');
  await tick(p, 1, 'Over the rooftops', ROLL2);
  await sleep(1500);
  let st = await gmState();
  const cur = st.chase && st.chase.current;
  check(!!cur && cur.name === 'The tallow run' && cur.street && cur.street.named === street && cur.panels.length === 2 && cur.panels[0].ticks === 2 && cur.panels[1].level === 'above' && cur.panels[1].time === 'Night' && cur.panels[0].between[0] === 'A flashback to the garage',
    'server: the chase with two panels (2 then 1), the level and time as switched, the between note ' + JSON.stringify(cur && cur.panels.map((x) => [x.ticks, x.level, x.time])));
  check(!!cur && cur.clocks.some((k) => k.hidden && k.name === HIDDEN), 'server: the hidden opposing clock is in the GM state');
  check(/Finesse/.test(await text(p, '#gm-ch-strip')) && new RegExp(HIDDEN).test(await text(p, '#gm-ch-strip')), 'the GM copy in the panel shows the roll lines and the hidden clock');
  await shot(p, 'chase-gm-1440');
  await p.$eval('#gm-ch-strip', (e) => e.scrollIntoView({ block: 'end' })); await sleep(300);
  await shot(p, 'chase-gm-1440-strip');
  await p.$eval('#gm-chase', (e) => { e.scrollTop = 0; });

  /* ---- Show on iPad: the player copy only; the display page draws it ---- */
  const seq0 = (await onIpad()).seq;
  await p.click('#gm-chase [data-gm="ch-ipad"]');
  const d1 = await until(async () => { const d = await onIpad(); return d.seq > seq0 ? d : null; }, 8000);
  check(!!d1 && d1.display.kind === 'svg' && d1.display.title === 'The tallow run' && /Shake them 3\/6/.test(d1.display.caption), 'Show on iPad: the display holds the strip ' + (d1 ? JSON.stringify([d1.display.title, d1.display.caption]) : '(nothing sent)'));
  check(!!d1 && /clips a fruit stand/.test(d1.display.svg) && !/Finesse|Skirmish/.test(d1.display.svg) && !d1.display.svg.includes(HIDDEN), 'the pushed svg has the captions, and no roll line or hidden clock');
  const D = await open('#display', { width: 1366, height: 1024, ready: null });
  const dp = D.page;
  check(await dp.waitForFunction(() => { const s = document.querySelector('#display-page .dp-map-frame svg'); return s && /clips a fruit stand/.test(s.textContent); }, null, { timeout: 20000 }).then(() => true, () => false), '#display draws the strip');
  check(!/Finesse|Skirmish/.test(await text(dp, '#display-page')) && !(await text(dp, '#display-page')).includes(HIDDEN), '#display: no roll line, no hidden clock anywhere on the iPad');
  await sleep(6500);                              /* the title strip fades after 6 s: the picture as the table sees it */
  await shot(dp, 'chase-ipad-1366');

  /* ---- the next tick reaches the iPad by itself ---- */
  await tick(p, 2, 'Down the canal steps', 'Cy · Wreck · risky/standard · 5');
  check(await dp.waitForFunction(() => { const s = document.querySelector('#display-page .dp-map-frame svg'); return s && /Down the canal steps/.test(s.textContent); }, null, { timeout: 15000 }).then(() => true, () => false), 'a tick while the chase is up reaches the iPad');
  check(!/Wreck/.test(await text(dp, '#display-page')), 'and still no roll line');
  await sleep(6500);
  await shot(dp, 'chase-ipad-1366-more');

  /* ---- Find lists the panels' captions ---- */
  await p.keyboard.press('o');
  await p.keyboard.press('Control+k');
  await p.fill('#gm-find-q', 'canal steps');
  const hit = await p.waitForSelector('.gm-find-hit', { timeout: 5000 }).then(() => text(p, '.gm-find-hit'), () => '');
  check(/^Chase\s*Down the canal steps/.test(hit), 'Find lists a panel by its caption: ' + hit);
  await p.keyboard.press('Enter');
  check(await panelOf(p) === 'chase', 'Enter jumps to the Chase panel');

  /* ---- clear, then End chase: the iPad is left alone, the chase goes under Past chases ---- */
  await p.click('#gm-chase [data-gm="blankipad"]');
  await until(async () => (await onIpad()).display.kind === 'blank', 5000);
  const seq1 = (await onIpad()).seq;
  await tick(p, 1, 'After the clear');
  await sleep(1200);
  check((await onIpad()).seq === seq1, 'once the iPad was cleared, a tick sends nothing');
  await p.click('#gm-chase [data-gm="ch-end"]');
  await p.waitForSelector('#gm-chase .gm-ch-start', { timeout: 5000 });
  await sleep(1500);
  st = await gmState();
  check(!st.chase.current && Object.values(st.chase.past || {}).some((x) => x.name === 'The tallow run' && x.panels.length === 4 && x.endedAt), 'End chase: no current chase; it is under Past chases with its four panels');
  check(/Past chases\s*1/.test(await text(p, '#gm-chase .gm-ch-past summary')), 'the panel lists it under Past chases');
  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await D.c.close(); await G.c.close();

  /* ---- a phone: two rows of six, the Chase segment, every control 44 px, nothing wider than the screen ---- */
  const M = await open('#gm', { width: 390, height: 844, mobile: true });
  const mp = M.page;
  const segs = await mp.$$eval('.gm-segbar .chip', (c) => c.map((x) => { const r = x.getBoundingClientRect(); return { seg: x.getAttribute('data-seg'), top: Math.round(r.top), right: Math.round(r.right) }; }));
  const perRow = segs.reduce((m, s) => { m[s.top] = (m[s.top] || 0) + 1; return m; }, {});
  check(segs.map((s) => s.seg).join() === 'console,prep,location,scenes,score,chase,npc,downtime,cards,rules,ipad,state' && JSON.stringify(Object.values(perRow)) === '[6,6]' && segs.every((s) => s.right <= 390), 'phone: twelve segments in two rows of six ' + JSON.stringify(perRow));
  await mp.click('.gm-segbar [data-seg="chase"]');
  await mp.waitForSelector('#gm-chase [data-gm="ch-start"]', { state: 'visible', timeout: 5000 });
  await mp.click('#gm-chase [data-k="opp"][data-v="shown"]');
  await mp.click('#gm-chase [data-gm="ch-start"]');
  await mp.waitForSelector('#gm-chase .gm-ch-play', { timeout: 10000 });
  await tick(mp, 3, 'Phone tick');
  const lay = await mp.evaluate(() => {
    const vw = window.innerWidth, wide = [], small = [];
    for (const el of document.querySelectorAll('#gm-page *')) { const r = el.getBoundingClientRect(); if (r.width && r.height && r.right > vw + 1) { let clipped = false; for (let q = el.parentElement; q && q !== document.body; q = q.parentElement) if (getComputedStyle(q).overflowX !== 'visible') { clipped = true; break; } if (!clipped && getComputedStyle(el).position !== 'fixed') wide.push(el.tagName + '.' + (el.className && el.className.baseVal === undefined ? el.className : '')); } }
    for (const el of document.querySelectorAll('#gm-chase button, #gm-chase select, #gm-chase input, #gm-chase summary')) { const r = el.getBoundingClientRect(); if (r.width && r.height && r.height < 43.5) small.push((el.getAttribute('data-gm') || el.id || el.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height)); }
    return { vw, sw: document.documentElement.scrollWidth, wide: wide.slice(0, 5), small: small.slice(0, 6) };
  });
  check(lay.sw <= lay.vw + 1 && !lay.wide.length, 'phone: nothing wider than the screen ' + JSON.stringify({ sw: lay.sw, vw: lay.vw, wide: lay.wide }));
  check(!lay.small.length, 'phone: every control in the panel is 44 px or taller' + (lay.small.length ? ' (' + lay.small.join(', ') + ')' : ''));
  await shot(mp, 'chase-phone');
  await mp.click('#gm-chase [data-gm="ch-end"]');
  check(errors.length === 0, 'no page errors on the phone' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
killServer();
process.exit(failed ? 1 : 0);
