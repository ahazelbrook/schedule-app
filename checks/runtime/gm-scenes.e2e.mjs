// The street scene roller (S) and the engagement roll (E) on the real GM page, in a real browser, against a local wrangler dev:
// keys and tabs, a roll per tool, reload (the same card), Earlier, the iPad push (read-aloud only), and a phone layout.
// Invented fixtures only (checks/runtime/fixtures/gm/).
//   PW_MODULE=<path to playwright> node checks/runtime/gm-scenes.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8857);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const SHOTS = process.env.GM_SHOTS || '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), sc = fx('scenes-pack.json');
const PARTS = {
  console: con.parts.console, campaign: con.parts.campaign, location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: new Date().toISOString() }, T: loc.T, extra: loc.extra },
  scenes: sc.parts.scenes, engagement: sc.parts.engagement,
};
const T_SC = sc.parts.scenes.T;

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-scenes-e2e-'));
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

try {
  const up = await until(async () => { try { return (await fetch(BASE + '/index.html')).status > 0; } catch (_) { return false; } }, 90000, 500);
  if (!up) throw new Error('the server did not start');
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  await api('PATCH', '/campaign', { session: { number: 4 } });

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(hash, { width = 1280, height = 900, mobile = false } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width, height }, serviceWorkers: 'block', isMobile: mobile, hasTouch: mobile });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(BASE + '/' + hash);
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
    return { c, page };
  }
  const text = (page, sel) => page.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };

  const G = await open('#gm');
  const p = G.page;
  check((await p.$$eval('.gm-tab', (t) => t.map((x) => x.getAttribute('data-panel')).join())) === 'prep,rules,location,scenes,engagement,npc,cards,ipad', 'the side tabs: Prep, Screen, Location, Street, Engage, NPC, Cards, iPad');
  await p.keyboard.press('s');
  check(await p.$eval('#gm-root', (r) => r.getAttribute('data-panel')) === 'scenes' && await p.$eval('#gm-scn', (e) => !e.closest('[hidden]') && !e.hidden), 'key S opens the street scene panel');
  await p.click('[data-gm="scnroll"]');
  check(await p.waitForSelector('#gm-scn .gm-scncard', { timeout: 5000 }).then(() => true, () => false), 'Roll a street scene draws a card');
  const name = await text(p, '#gm-scn .gm-scncard h3');
  check(T_SC.district.some((d) => d.n === name), 'the card is one of the pack\'s districts');
  check((await p.$$('#gm-scn .gm-read')).length === 3 && (await p.$$('#gm-scn .gm-chip')).length === 4, 'three read-aloud paragraphs and four ratings');
  await p.selectOption('#gm-s-sel', 'Cobb Hill');
  await p.click('[data-gm="scnroll"]');
  await p.waitForFunction(() => document.querySelector('#gm-scn .gm-scncard h3') && document.querySelector('#gm-scn .gm-scncard h3').textContent === 'Cobb Hill');
  const second = await text(p, '#gm-scn .gm-scncard');
  await sleep(1200);
  const st = (await api('GET', '/gm/state')).json.doc;
  check(st.cards.scenes && st.cards.scenes.ui.sel === 'Cobb Hill' && Object.keys(st.hist.scenes).length === 2, 'server: the card and two history entries are stored');
  check(!JSON.stringify(st).includes(T_SC.district[2].notables[0][1]), 'server: no table text in the stored state (replay info only)');
  await shot(p, 'scenes-desktop');

  // the iPad push: read-aloud only
  await p.click('[data-gm="scnipad"]');
  const disp = await until(async () => { const d = (await api('GET', '/gm/display')).json; return d && d.display && d.display.kind === 'text' ? d.display : null; }, 8000);
  check(!!disp && disp.title === 'Cobb Hill' && !/Sir Marl|Owns half the lamps|Anyone loud/.test(disp.text) && disp.text.split('\n\n').length === 3, 'iPad: the three read-aloud paragraphs only, no notable and no rule');

  // reload: the same card; Earlier brings back the first
  await p.reload();
  await p.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  await p.keyboard.press('s');
  check(await text(p, '#gm-scn .gm-scncard') === second, 'reload: the same street scene');
  await p.click('#gm-scn [data-gm="replay"]:not([aria-current])');
  check(await text(p, '#gm-scn .gm-scncard h3') === name, 'Earlier: the first card is back');

  // engagement
  await p.keyboard.press('e');
  check(await p.$eval('#gm-root', (r) => r.getAttribute('data-panel')) === 'engagement', 'key E opens the engagement panel');
  check(await text(p, '#gm-eng .gm-engcard h3') === 'Smash — 1d', 'the preview shows the pool before any roll');
  check((await p.$$('#gm-eng [data-gm="engtri"][data-id="bold"]')).length === 3 && (await p.$$('#gm-eng select[data-engmod]')).length === 0, 'each factor is three chips (−1d / 0 / +1d), its two statements as the labels');
  await p.click('#gm-eng [data-gm="engtri"][data-id="bold"][data-v="1"]');
  await p.click('#gm-eng [data-gm="engtri"][data-id="tier"][data-v="1"]');
  check(await p.$eval('#gm-eng [data-gm="engtri"][data-id="bold"][data-v="1"]', (b) => b.getAttribute('aria-pressed') === 'true') && await text(p, '#gm-eng .gm-engcard h3') === 'Smash — 3d', 'two +1d factors: 3d');
  await p.click('[data-gm="engroll"]');
  await p.waitForFunction(() => /Roll/.test(document.querySelector('#gm-eng .gm-engcard').textContent) && !/Set the factors/.test(document.querySelector('#gm-eng .gm-engcard').textContent));
  const roll = await text(p, '#gm-eng .gm-engcard');
  check(/\[\d \d \d\]/.test(roll) && /Ahead|Level|Behind/.test(roll), 'a 3d roll shows three dice and a position: ' + roll.slice(0, 90));
  await sleep(1200);
  check((await api('GET', '/gm/state')).json.doc.cards.engagement.ui.mods.bold === 1, 'server: the engagement card and its controls are stored');
  await p.reload();
  await p.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  await p.keyboard.press('e');
  check(await text(p, '#gm-eng .gm-engcard') === roll, 'reload: the same dice');
  await p.selectOption('#gm-e-approach', 'Slip');
  check(await text(p, '#gm-eng .gm-engcard h3') === 'Slip — 3d' && /Set the factors/.test(await text(p, '#gm-eng .gm-engcard')), 'a control change shows the preview again');
  await shot(p, 'engagement-desktop');
  check(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await G.c.close();

  // a phone: ten segments, nothing wider than the screen, every control 44 px or more
  const M = await open('#gm', { width: 390, height: 844, mobile: true });
  const mp = M.page;
  check((await mp.$$eval('.gm-segbar .chip', (c) => c.map((x) => x.getAttribute('data-seg')).join())) === 'console,prep,location,scenes,engagement,npc,cards,rules,ipad,state', 'phone: the bar is Console, Prep, Location, Street, Engage, NPC, Cards, GM screen, iPad, State');
  const segRows = await mp.$$eval('.gm-segbar .chip', (c) => c.map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.right)]; }));
  check(new Set(segRows.map((r) => r[0])).size === 2 && segRows.every((r) => r[1] <= 390), 'phone: two rows of five, every segment on screen (' + JSON.stringify(segRows) + ')');
  for (const seg of ['scenes', 'engagement']) {
    await mp.click('.gm-segbar [data-seg="' + seg + '"]');
    await mp.waitForSelector('#gm-' + (seg === 'scenes' ? 'scn' : 'eng') + ' select', { state: 'visible', timeout: 5000 });
    if (seg === 'scenes') { await mp.click('[data-gm="scnroll"]'); await mp.waitForSelector('#gm-scn .gm-scncard'); } else { await mp.click('[data-gm="engroll"]'); await mp.waitForSelector('#gm-eng .gm-engcard .gm-grid'); }
    const lay = await mp.evaluate(() => {
      const vw = window.innerWidth, wide = [], small = [];
      for (const el of document.querySelectorAll('#gm-page *')) { const r = el.getBoundingClientRect(); if (r.width && r.height && r.right > vw + 1) { let clipped = false; for (let q = el.parentElement; q && q !== document.body; q = q.parentElement) if (getComputedStyle(q).overflowX !== 'visible') { clipped = true; break; } if (!clipped && getComputedStyle(el).position !== 'fixed') wide.push(el.tagName + '.' + (el.className || '')); } }
      for (const el of document.querySelectorAll('#gm-page button, #gm-page select')) { const r = el.getBoundingClientRect(); if (r.width && r.height && r.height < 43.5) small.push((el.getAttribute('data-gm') || el.id) + ' ' + Math.round(r.height)); }
      return { vw, sw: document.documentElement.scrollWidth, wide: wide.slice(0, 5), small: small.slice(0, 6) };
    });
    check(lay.sw <= lay.vw + 1 && !lay.wide.length, 'phone ' + seg + ': nothing wider than the screen (' + JSON.stringify({ sw: lay.sw, vw: lay.vw, wide: lay.wide }) + ')');
    check(!lay.small.length, 'phone ' + seg + ': every visible control is 44 px or taller' + (lay.small.length ? ' (' + lay.small.join(', ') + ')' : ''));
    await shot(mp, 'phone-' + seg);
  }
  check(errors.length === 0, 'no page errors on the phone' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
killServer();
process.exit(failed ? 1 : 0);
