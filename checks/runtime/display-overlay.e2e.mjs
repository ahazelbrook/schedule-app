// The overlay channel on the table display in a real browser (GM.md "Overlays"; the ambient document's `overlay` and `auto`):
// a clock, an NPC, a line of text and the dawn laid over what is up WITHOUT replacing it, each id shown once for its ms from first
// sight, taken away by null or a new id, the right-hand 34% for cards and the whole frame for the dawn, the AUTO chip, reduced motion,
// and the display-only sign-in (which cannot read the cast, so an NPC overlay draws nothing there and the page carries on).
//   PW_MODULE=<path to playwright-core> PW_CHANNEL=msedge node checks/runtime/display-overlay.e2e.mjs      (invented fixtures only)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8874);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-displayoverlay-e2e-'));
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

const gmCall = (method, p, body) => fetch(BASE + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
async function push(doc) { const r = await gmCall('PUT', '/api/gm/display', doc); if (r.status !== 200) throw new Error('could not push ' + JSON.stringify(doc).slice(0, 60) + ': ' + r.status); }
async function ambient(patch) { const r = await gmCall('PATCH', '/api/gm/ambient', patch); if (r.status !== 200) throw new Error('ambient ' + JSON.stringify(patch).slice(0, 80) + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 120)); return r.json(); }
/* a computed transition-duration list ("0s", "0.001s, 0s"): every one of them a blink or less (the app also clamps all motion under reduce) */
const instant = (list) => String(list).split(',').every((d) => parseFloat(d) < 0.02);
const storedAt = async () => Date.parse((await (await gmCall('GET', '/api/gm/ambient')).json()).doc.overlay.at);   // the SERVER's start of the overlay
const SPOT = { kind: 'text', title: 'Spot', text: 'The invented spotlight line' };
let n = 0; const uid = (p) => p + '-' + (++n);

/* a browser on #display: signed in as `user`, with its page errors, console errors and requests collected */
async function openDisplay(browser, { user = GM, reduced = false, watch = false } = {}) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, viewport: { width: 1366, height: 1024 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  /* watch: every data-phase the dawn goes through from the very first node, recorded before the page's own script runs (a reload cannot miss the first phase) */
  if (watch) await page.addInitScript(() => {
    window.__ph = []; window.__t0 = Date.now();
    const rec = (n) => { if (n && n.nodeType === 1 && n.classList.contains('dp-ov-dawn')) window.__ph.push(n.getAttribute('data-phase')); };
    new MutationObserver((ms) => ms.forEach((m) => { if (m.type === 'attributes' && m.attributeName === 'data-phase') rec(m.target); if (m.type === 'childList') m.addedNodes.forEach(rec); })).observe(document, { attributes: true, childList: true, subtree: true });
  });
  await page.addInitScript(() => { try { if (window === window.top) localStorage.setItem('b68.display.ambientTiming', JSON.stringify({ intervalMs: 600000, graceMs: 60000 })); } catch (e) { /* no storage */ } });
  const seen = { requests: [], errors: [], console: [], responses: [] };
  page.on('request', (r) => seen.requests.push(r.url()));
  page.on('response', (r) => seen.responses.push({ path: new URL(r.url()).pathname, status: r.status() }));
  page.on('pageerror', (e) => seen.errors.push(String(e && e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') seen.console.push(m.text()); });
  await page.goto(BASE + '/#display');
  await page.waitForSelector('.dp-overlay', { state: 'attached', timeout: 20000 });
  await page.waitForFunction(() => /Updated|Waiting/.test((document.querySelector('.dp-status-text') || {}).textContent || ''), null, { timeout: 20000 });
  return { ctx, page, seen };
}
const cards = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.dp-overlay .dp-ov-card')).map((c) => ({ id: c.getAttribute('data-ov-id'), cls: c.className, text: c.innerText })));
const cardIn = (page, kind, id) => page.waitForFunction(([k, i]) => { const c = document.querySelector('.dp-overlay .dp-ov-' + k + '.dp-ov-in'); return !!c && (!i || c.getAttribute('data-ov-id') === i); }, [kind, id || ''], { timeout: 20000 });
const noOverlay = (page, ms) => page.waitForFunction(() => !document.querySelector('.dp-overlay .dp-ov-card, .dp-overlay .dp-ov-dawn'), null, { timeout: ms || 20000 });
const rect = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(), f = document.getElementById('display-page').getBoundingClientRect(); return { l: (r.left - f.left) / f.width, r: (r.right - f.left) / f.width, t: (r.top - f.top) / f.height, b: (r.bottom - f.top) / f.height, fw: f.width, fh: f.height }; }, sel);
const stageText = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#display-page .dp-stages .dp-stage')).map((s) => s.innerText).join('|'));
/* every data-phase the dawn goes through, in order (read by a MutationObserver from the moment it is installed) */
const watchPhases = (page) => page.evaluate(() => {
  window.__ph = [];
  const rec = (n) => { if (n && n.nodeType === 1 && n.classList.contains('dp-ov-dawn')) window.__ph.push(n.getAttribute('data-phase')); };
  new MutationObserver((ms) => ms.forEach((m) => {
    if (m.type === 'attributes' && m.attributeName === 'data-phase') rec(m.target);
    if (m.type === 'childList') { m.addedNodes.forEach(rec); }
  })).observe(document.querySelector('.dp-overlay'), { attributes: true, childList: true, subtree: true });
});

await push(SPOT);
await ambient({ overlay: null, auto: null });
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
try {
  const G = await openDisplay(browser);

  await step('a clock card lies over a spotlight in the right-hand 34%: segments, name, count; the spotlight underneath is unchanged', async () => {
    await G.page.waitForFunction(() => document.querySelectorAll('#display-page .dp-stages .dp-stage').length === 1 && /invented spotlight line/i.test(document.getElementById('display-page').innerText), null, { timeout: 20000 });   // the cross-fade has finished
    const t0 = await stageText(G.page);
    expect(/invented spotlight line/i.test(t0), 'the spotlight is up first: ' + t0);
    await ambient({ overlay: { id: 'c1', kind: 'clock', ms: 9000, name: 'Invented Fuse', size: 8, filled: 3 } });
    await cardIn(G.page, 'clock', 'c1');
    const info = await G.page.evaluate(() => {
      const c = document.querySelector('.dp-ov-clock');
      return { segs: c.querySelectorAll('svg path.dp-ov-seg').length, on: c.querySelectorAll('svg path.dp-ov-seg-on').length, name: c.querySelector('.dp-ov-name').textContent, count: c.querySelector('.dp-ov-count').textContent, inLayer: !!c.closest('.dp-overlay') };
    });
    expect(info.segs === 8 && info.on === 3 && info.name === 'Invented Fuse' && info.count === '3 / 8' && info.inLayer, 'the clock: ' + JSON.stringify(info));
    await sleep(800);                                               // the slide-in (0.5 s) has finished
    const r = await rect(G.page, '.dp-ov-clock');
    expect(r.l >= 0.66 - 1e-6 && r.r <= 1 + 1e-6 && r.t >= 0 && r.b <= 1, 'the card sits in the right-hand 34% (left ' + r.l.toFixed(3) + ', right ' + r.r.toFixed(3) + ')');
    expect(r.l < 0.7, 'and is not squeezed far into the corner (left ' + r.l.toFixed(3) + ')');
    expect(await stageText(G.page) === t0, 'the display underneath did not change');
    expect(await G.page.evaluate(() => document.querySelector('.dp-auto').hidden), 'no AUTO chip while auto is off');
  });

  await step('each id shows once for its ms from first sight: it goes by itself, and the same id arriving again does not bring it back', async () => {
    const t = Date.now();
    await noOverlay(G.page, 20000);
    expect(Date.now() - t < 12000, 'it ran out');
    await ambient({ auto: true });                                  // the document moves, the overlay id is the same
    await G.page.waitForFunction(() => !document.querySelector('.dp-auto').hidden, null, { timeout: 15000 });
    expect((await cards(G.page)).length === 0, 'the same id did not come back');
    expect(await G.page.evaluate(() => document.querySelector('.dp-auto').textContent) === 'AUTO', 'the AUTO chip says AUTO');
    const r = await rect(G.page, '.dp-auto');
    expect(r.l < 0.2 && r.t < 0.2, 'the chip is in a corner (' + r.l.toFixed(2) + ', ' + r.t.toFixed(2) + ')');
    expect(await G.page.evaluate(() => { const e = document.querySelector('.dp-auto'); return e.getBoundingClientRect().width < 200; }), 'and small');
    await ambient({ auto: null });
    await G.page.waitForFunction(() => document.querySelector('.dp-auto').hidden, null, { timeout: 15000 });
  });

  await step('a new id replaces the card; null takes it away; after null the same id shows afresh', async () => {
    const a = uid('r'), b = uid('r');
    await ambient({ overlay: { id: a, kind: 'clock', ms: 60000, name: 'Invented Wick', size: 4, filled: 1 } });
    await cardIn(G.page, 'clock', a);
    await ambient({ overlay: { id: b, kind: 'text', ms: 60000, text: 'An invented line, one at a time.' } });
    await cardIn(G.page, 'text', b);
    await sleep(900);
    const now = await cards(G.page);
    expect(now.length === 1 && now[0].id === b && /one at a time/.test(now[0].text), 'only the new card remains: ' + JSON.stringify(now));
    await sleep(800);
    const r = await rect(G.page, '.dp-ov-text');
    expect(r.l >= 0.66 - 1e-6, 'a text card is in the right-hand 34% too (' + r.l.toFixed(3) + ')');
    await ambient({ overlay: null });
    await noOverlay(G.page, 15000);
    await ambient({ overlay: { id: b, kind: 'text', ms: 60000, text: 'An invented line, one at a time.' } });
    await cardIn(G.page, 'text', b);
    await ambient({ overlay: null });
    await noOverlay(G.page, 15000);
  });

  await step('an NPC card draws a revealed NPC by the same path as the npc spotlight: portrait, name, alias, role and faction, and nothing hidden', async () => {
    const spec = await G.page.evaluate(() => window.B68 && window.B68.BASE_FIGURE);
    expect(spec && typeof spec === 'object', 'the figure kit gives a base spec');
    const doc = { name: 'Inspector Invented', alias: 'Inky', role: 'Clerk', faction: 'The Invented Guild', description: 'DESCRIPTION-MARKER', gmNotes: 'GMNOTES-MARKER', revealed: true, spec };
    expect((await gmCall('PUT', '/api/npcs/npc_ov_seen', doc)).status === 200, 'created');
    expect((await gmCall('PUT', '/api/npcs/npc_ov_hid', { ...doc, name: 'Hidden Invented', gmNotes: 'HIDDEN-MARKER', revealed: false })).status === 200, 'created hidden');
    const bad = await gmCall('PATCH', '/api/gm/ambient', { overlay: { id: 'h1', kind: 'npc', ms: 20000, npcId: 'npc_ov_hid' } });
    expect(bad.status === 400, 'the server refuses a hidden NPC: ' + bad.status);
    await sleep(4500);                                              // a poll or two: the refusal changed nothing on the iPad
    expect((await cards(G.page)).length === 0, 'nothing appeared for the refused overlay');
    await ambient({ overlay: { id: 'n1', kind: 'npc', ms: 30000, npcId: 'npc_ov_seen' } });
    await cardIn(G.page, 'npc', 'n1');
    const info = await G.page.evaluate(() => {
      const c = document.querySelector('.dp-ov-npc');
      return { name: (c.querySelector('.dp-ov-name') || {}).textContent, alias: (c.querySelector('.dp-ov-alias') || {}).textContent, kicker: (c.querySelector('.dp-kicker') || {}).textContent, svg: !!c.querySelector('.dp-ov-portrait svg'), text: c.innerText, body: document.getElementById('display-page').innerText };
    });
    expect(info.name === 'Inspector Invented' && /Inky/.test(info.alias) && info.kicker === 'Clerk · The Invented Guild', 'the card: ' + JSON.stringify(info));
    expect(info.svg, 'the portrait is drawn (this is the intended path, not the fallback)');
    expect(!/MARKER/.test(info.body), 'no description, gmNotes or hidden text anywhere on the display');
    await sleep(800);
    const r = await rect(G.page, '.dp-ov-npc');
    expect(r.l >= 0.66 - 1e-6 && r.r <= 1 + 1e-6, 'right-hand 34% (' + r.l.toFixed(3) + ')');
    await ambient({ overlay: null });
    await noOverlay(G.page, 15000);
  });

  await step('an NPC hidden after the overlay was stored: a display that sees it afterwards draws nothing, while the server still holds it', async () => {
    const spec = await G.page.evaluate(() => window.B68 && window.B68.BASE_FIGURE);
    expect((await gmCall('PUT', '/api/npcs/npc_ov_later', { name: 'Later Hidden Invented', alias: 'Shade', role: 'Courier', faction: 'The Invented Guild', gmNotes: 'LATER-MARKER', revealed: true, spec })).status === 200, 'created revealed');
    const id = uid('n');
    await ambient({ overlay: { id, kind: 'npc', ms: 120000, npcId: 'npc_ov_later' } });
    await cardIn(G.page, 'npc', id);                                // revealed: it draws (the intended path)
    expect((await gmCall('PATCH', '/api/npcs/npc_ov_later', { revealed: false })).status === 200, 'hidden afterwards');
    const stored = (await (await gmCall('GET', '/api/gm/ambient')).json()).doc.overlay;
    expect(stored && stored.id === id && stored.npcId === 'npc_ov_later', 'the server still holds the overlay: ' + JSON.stringify(stored));
    const F = await openDisplay(browser);                           // a fresh display (a reload) sees it for the first time
    await sleep(6500);                                              // more than one poll
    const body = await F.page.evaluate(() => document.getElementById('display-page').innerText);
    expect((await cards(F.page)).length === 0 && !/Later Hidden Invented|Shade|Courier|LATER-MARKER/.test(body), 'nothing of the hidden NPC on the display: ' + body.slice(0, 120));
    expect(F.seen.responses.some((x) => x.path === '/api/npcs/npc_ov_later' && x.status === 200), 'the GM sign-in did read the row (so the draw was refused by the page, not by a failed read)');
    expect(F.seen.errors.length === 0, 'page errors: ' + F.seen.errors.join(' | '));
    await F.ctx.close();
    await ambient({ overlay: null });
    await noOverlay(G.page, 15000);
  });

  await step('the dawn: warm, a white hold, a fade, over the whole frame and over a spotlight; the display underneath is untouched; it lasts its ms', async () => {
    await watchPhases(G.page);
    const t0 = await stageText(G.page);
    const MS = 8000;
    await ambient({ overlay: { id: uid('d'), kind: 'fx', ms: MS, fx: 'dawn' } });
    const t1 = await storedAt();                                    // a dawn lasts its ms from the server's clock, however late this page's poll sees it
    await G.page.waitForSelector('.dp-overlay .dp-ov-dawn', { timeout: 20000 });
    await sleep(350);
    const warm = await G.page.evaluate(() => { const e = document.querySelector('.dp-ov-dawn'); return { phase: e.getAttribute('data-phase'), op: parseFloat(getComputedStyle(e).opacity), warm: parseFloat(getComputedStyle(e.querySelector('.dp-ov-warm')).opacity) }; });
    expect(warm.phase === 'ramp' && (warm.op > 0 && warm.op < 1 || warm.warm > 0 && warm.warm < 1), 'the ramp is animating about 0.4 s in (not a jump to white): ' + JSON.stringify(warm));
    const r = await rect(G.page, '.dp-ov-dawn');
    expect(r.l === 0 && r.t === 0 && Math.abs(r.r - 1) < 1e-6 && Math.abs(r.b - 1) < 1e-6, 'the whole frame: ' + JSON.stringify(r));
    await G.page.waitForSelector('.dp-ov-dawn[data-phase="hold"]', { timeout: 15000 });
    const hold = await G.page.evaluate(() => { const e = document.querySelector('.dp-ov-dawn'), cs = getComputedStyle(e); return { op: cs.opacity, bg: cs.backgroundColor, warm: getComputedStyle(e.querySelector('.dp-ov-warm')).opacity, z: getComputedStyle(e.parentNode).zIndex, text: e.innerText }; });
    expect(hold.op === '1' && /255, 255, 255/.test(hold.bg) && hold.warm === '0', 'white in the hold, the warm gone: ' + JSON.stringify(hold));
    expect(hold.text === '', 'no text in the dawn');
    expect(Number(hold.z) >= 3, 'above the stages and the wire');
    await G.page.waitForSelector('.dp-ov-dawn[data-phase="fade"]', { timeout: 15000 });
    await noOverlay(G.page, 15000);
    const took = Date.now() - t1;
    expect(Math.abs(took - MS) < 2500, 'from the server start to gone took ' + took + ' ms for ms ' + MS);
    const ph = (await G.page.evaluate(() => window.__ph)).filter((x) => x !== 'pre');
    /* a dawn that arrives on a running page plays whole, however late the 4 s poll saw it: the hold is shortened, the ramp is not */
    expect(JSON.stringify(ph) === JSON.stringify(['ramp', 'hold', 'fade']), 'phases: ' + JSON.stringify(ph));
    expect(await stageText(G.page) === t0, 'the spotlight underneath is still there, unchanged');
    await ambient({ overlay: null });
  });

  await step('a dawn lights over the ambient scene too (a blank display), and null cuts it short', async () => {
    await push({ kind: 'blank' });
    await G.page.waitForFunction(() => !/invented spotlight/i.test(document.getElementById('display-page').innerText), null, { timeout: 15000 });
    await ambient({ overlay: { id: uid('d'), kind: 'fx', ms: 60000, fx: 'dawn' } });
    await G.page.waitForSelector('.dp-ov-dawn[data-phase="hold"]', { timeout: 20000 });
    await ambient({ overlay: null });
    await noOverlay(G.page, 15000);
    await push(SPOT);
  });

  await step('prefers-reduced-motion: the dawn is white at once and straight back (no ramp, no fade); cards do not slide', async () => {
    const R = await openDisplay(browser, { reduced: true });
    await watchPhases(R.page);
    const MS = 9000;
    await ambient({ overlay: { id: uid('d'), kind: 'fx', ms: MS, fx: 'dawn' } });
    await R.page.waitForSelector('.dp-overlay .dp-ov-dawn', { timeout: 20000 });
    const t1 = await storedAt();
    const first = await R.page.evaluate(() => { const e = document.querySelector('.dp-ov-dawn'); return { phase: e.getAttribute('data-phase'), op: getComputedStyle(e).opacity, tr: getComputedStyle(e).transitionDuration }; });
    expect(first.phase === 'hold' && first.op === '1' && instant(first.tr), 'white at once: ' + JSON.stringify(first));
    await sleep(Math.max(0, t1 + MS - 1500 - Date.now()));
    expect(await R.page.evaluate(() => !!document.querySelector('.dp-ov-dawn[data-phase="hold"]')), 'still white near the end');
    await noOverlay(R.page, 15000);
    const took = Date.now() - t1;
    expect(Math.abs(took - MS) < 2500, 'gone at its ms (' + took + ')');
    const ph = (await R.page.evaluate(() => window.__ph)).filter((x) => x !== 'pre');
    expect(JSON.stringify(ph) === JSON.stringify(['hold']), 'only a hold: ' + JSON.stringify(ph));
    await ambient({ overlay: { id: uid('c'), kind: 'clock', ms: 60000, name: 'Invented Still', size: 6, filled: 6 } });
    await cardIn(R.page, 'clock');
    const cs = await R.page.evaluate(() => { const c = document.querySelector('.dp-ov-clock'); const s = getComputedStyle(c); return { tr: s.transitionDuration, tf: s.transform }; });
    expect(instant(cs.tr), 'no transition on a card: ' + cs.tr);
    await ambient({ overlay: null });
    expect(R.seen.errors.length === 0, 'page errors: ' + R.seen.errors.join(' | '));
    await R.ctx.close();
  });

  await step('the display-only sign-in: the dawn and a clock work; an NPC overlay draws nothing (it cannot read the cast) and the poll stays live', async () => {
    const D = await openDisplay(browser, { user: IPAD });
    await ambient({ overlay: { id: uid('c'), kind: 'clock', ms: 60000, name: 'Invented Ticker', size: 6, filled: 2 } });
    await cardIn(D.page, 'clock');
    await ambient({ overlay: { id: uid('d'), kind: 'fx', ms: 60000, fx: 'dawn' } });
    await D.page.waitForSelector('.dp-ov-dawn[data-phase="hold"]', { timeout: 20000 });
    await ambient({ overlay: { id: uid('n'), kind: 'npc', ms: 60000, npcId: 'npc_ov_seen' } });
    await D.page.waitForFunction(() => !document.querySelector('.dp-ov-dawn') && !document.querySelector('.dp-ov-card'), null, { timeout: 20000 });
    await sleep(1500);
    expect((await cards(D.page)).length === 0, 'no card, no "not found" note');
    await sleep(4500);
    const st = await D.page.evaluate(() => ({ dot: document.querySelector('.dp-dot').className, text: document.querySelector('.dp-status-text').textContent }));
    expect(/dp-dot-ok/.test(st.dot), 'the poll is still live: ' + JSON.stringify(st));
    await ambient({ overlay: { id: uid('c'), kind: 'text', ms: 60000, text: 'Still working.' } });
    await cardIn(D.page, 'text');
    await ambient({ overlay: null });
    expect(D.seen.errors.length === 0, 'page errors: ' + D.seen.errors.join(' | '));
    await D.ctx.close();
  });

  await step('a bump of the document (the same id, other fields) mid-overlay does not restart it, and the server holds one overlay for one ms', async () => {
    const id = uid('s');
    await ambient({ overlay: { id, kind: 'clock', ms: 60000, name: 'Invented Steady', size: 6, filled: 1 } });
    await cardIn(G.page, 'clock', id);
    await G.page.evaluate(() => { document.querySelector('.dp-ov-clock').setAttribute('data-keep', '1'); });
    await ambient({ auto: true });
    await G.page.waitForFunction(() => !document.querySelector('.dp-auto').hidden, null, { timeout: 15000 });
    expect(await G.page.evaluate(() => !!document.querySelector('.dp-ov-clock[data-keep="1"]')), 'the very same card is still there: it did not restart');
    await ambient({ auto: null, overlay: null });
    await noOverlay(G.page, 15000);
  });

  await step('reload the display MID-dawn: it carries on in the hold (never the warm start or the ramp again) and ends at the server end, not a fresh ms later', async () => {
    const MS = 24000;
    await ambient({ overlay: { id: uid('d'), kind: 'fx', ms: MS, fx: 'dawn' } });
    const at = await storedAt();
    await sleep(7000);                                              // well into the hold, by the server's clock
    const R = await openDisplay(browser, { watch: true });
    await R.page.waitForSelector('.dp-overlay .dp-ov-dawn', { timeout: 20000 });   // it IS shown (a vanished dawn would not pass this)
    await R.page.reload();                                          // a real reload of the same page and context: its storage carries over; the observer re-arms clean
    await R.page.waitForSelector('.dp-overlay .dp-ov-dawn', { timeout: 20000 });
    const first = await R.page.evaluate(() => { const e = document.querySelector('.dp-ov-dawn'); return { phase: e.getAttribute('data-phase'), op: getComputedStyle(e).opacity }; });
    expect(first.phase === 'hold' && first.op === '1', 'white straight away, in the hold: ' + JSON.stringify(first));
    await noOverlay(R.page, 30000);
    const end = Date.now();
    const ph = await R.page.evaluate(() => window.__ph);
    expect(ph.length >= 1 && ph[0] === 'hold' && !ph.includes('pre') && !ph.includes('ramp'), 'phases from the first node: ' + JSON.stringify(ph));
    expect(ph.includes('fade'), 'and it still fades at the end: ' + JSON.stringify(ph));
    expect(Math.abs(end - (at + MS)) < 3000, 'it ended at the server end (off by ' + (end - (at + MS)) + ' ms); a restart would be ' + (MS - 7000) + ' ms late');
    expect(R.seen.errors.length === 0, 'page errors: ' + R.seen.errors.join(' | '));
    await R.ctx.close();
    await ambient({ overlay: null });
  });

  await step('reload the display after the dawn has expired: nothing shows, across several polls', async () => {
    await ambient({ overlay: { id: uid('d'), kind: 'fx', ms: 2000, fx: 'dawn' } });
    await sleep(2600);
    const stored = (await (await gmCall('GET', '/api/gm/ambient')).json()).doc.overlay;
    expect(stored && stored.kind === 'fx', 'the server still holds the expired overlay (so only the display GET dropped it)');
    const R = await openDisplay(browser, { watch: true });
    await sleep(6500);
    expect(await R.page.evaluate(() => window.__ph.length === 0 && !document.querySelector('.dp-ov-dawn') && !document.querySelector('.dp-ov-card')), 'no dawn, no card: ' + JSON.stringify(await R.page.evaluate(() => window.__ph)));
    expect(/dp-dot-ok/.test(await R.page.evaluate(() => document.querySelector('.dp-dot').className)), 'and the poll is live (it asked, and was told nothing)');
    await R.ctx.close();
    await ambient({ overlay: null });
  });

  await step('reload mid-card: a clock card carries on for the rest of its ms by the server clock, and a text card past its end does not return', async () => {
    const MS = 14000;
    await ambient({ overlay: { id: uid('c'), kind: 'clock', ms: MS, name: 'Invented Wick', size: 6, filled: 2 } });
    const at = await storedAt();
    await sleep(6000);
    const R = await openDisplay(browser);
    await cardIn(R.page, 'clock');
    await noOverlay(R.page, 20000);
    const end = Date.now();
    expect(Math.abs(end - (at + MS)) < 3500, 'the card left at the server end (off by ' + (end - (at + MS)) + ' ms), not a fresh ' + MS + ' ms');
    await ambient({ overlay: { id: uid('t'), kind: 'text', ms: 1500, text: 'Over before the reload.' } });
    await sleep(2200);
    await R.page.reload();
    await R.page.waitForSelector('.dp-overlay', { state: 'attached', timeout: 20000 });
    await sleep(5500);
    expect((await cards(R.page)).length === 0, 'the expired text card did not come back');
    await R.ctx.close();
    await ambient({ overlay: null });
  });

  await step('only same-origin requests; no page errors; the GM display made no unexpected calls', async () => {
    expect(G.seen.requests.length > 20, 'the requests were recorded: ' + G.seen.requests.length);
    const out = G.seen.requests.filter((u) => /^https?:/i.test(u) && new URL(u).origin !== BASE);
    expect(out.length === 0, 'requests left the origin: ' + out.join(' | '));
    expect(G.seen.errors.length === 0, 'page errors: ' + G.seen.errors.join(' | '));
    const csp = G.seen.console.filter((m) => /content security policy|refused to/i.test(m));
    expect(csp.length === 0, 'CSP refusals: ' + csp.join(' | '));
  });
  await G.ctx.close();
} finally {
  await browser.close();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
killServer();
process.exit(failed ? 1 : 0);
