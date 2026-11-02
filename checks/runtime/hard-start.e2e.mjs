// The hard start (1.2, spine.start) and the ON AIR lamp (A6, ai.onair) on the table display, against a real local Worker: switches off draw nothing; on, the countdown, fuse, credits,
// three blank plates and three reveals run on the iPad. Invented data only.
//   PW_MODULE=<path to playwright-core> PW_CHANNEL=msedge PORT=9060 node checks/runtime/hard-start.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9060);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-hardstart-e2e-'));
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
async function ambient(patch) { const r = await gmCall('PATCH', '/api/gm/ambient', patch); if (r.status !== 200) throw new Error('ambient ' + JSON.stringify(patch).slice(0, 100) + ' -> ' + r.status + ' ' + (await r.text()).slice(0, 120)); return r.json(); }
let n = 0; const uid = (p) => p + '-' + (++n);

/* a browser on #display signed in as the table iPad (role 'display': it may read the display call and nothing else) */
async function openDisplay(browser, user) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, viewport: { width: 1366, height: 1024 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => { try { if (window === window.top) localStorage.setItem('b68.display.ambientTiming', JSON.stringify({ intervalMs: 600000, graceMs: 60000 })); } catch (e) { /* no storage */ } });
  const seen = { requests: [], errors: [], console: [] };
  page.on('request', (r) => seen.requests.push(r.url()));
  page.on('pageerror', (e) => seen.errors.push(String(e && e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') seen.console.push(m.text()); });
  await page.goto(BASE + '/#display');
  await page.waitForSelector('.dp-overlay', { state: 'attached', timeout: 20000 });
  await page.waitForFunction(() => /Updated|Waiting/.test((document.querySelector('.dp-status-text') || {}).textContent || ''), null, { timeout: 20000 });
  return { ctx, page, seen };
}
const shows = (page) => page.evaluate(() => Array.from(document.querySelectorAll('.dp-overlay .dp-show')).map((c) => ({ kind: c.getAttribute('data-show'), cls: c.className, text: c.innerText })));
const showIn = (page, kind, t) => page.waitForFunction((k) => !!document.querySelector('.dp-overlay .dp-show-' + k + '.dp-ov-in'), kind, { timeout: t || 20000 });
const noShow = (page, t) => page.waitForFunction(() => !document.querySelector('.dp-overlay .dp-show'), null, { timeout: t || 20000 });
const pageText = (page) => page.evaluate(() => document.getElementById('display-page').innerText);

for (const [id, name, role, revealed, seen] of [['n_a', 'Mabel Quist', 'Fixer', true, '2026-10-01T10:00:00.000Z'], ['n_b', 'Dov Kessler', 'Desk sergeant', true, '2026-10-08T10:00:00.000Z'], ['n_c', 'Lotte Brand', 'Doorwoman', true, '2026-10-15T10:00:00.000Z'], ['n_d', 'Pip Tolliver', 'Bookmaker', true, '2026-10-22T10:00:00.000Z'], ['n_hid', 'GM-ONLY-NPC-1', 'GM-ONLY-ROLE-1', false, null]]) {
  const r = await gmCall('PUT', '/api/npcs/' + id, { name, alias: '', role, faction: 'The Invented Guild', description: '', gmNotes: 'GMNOTES-MARKER', revealed, firstSeen: seen, spec: {} });
  if (r.status !== 200) { console.log('FAIL could not create ' + id + ': ' + r.status); process.exit(1); }
}
const layer = (p, value) => ambient({ layer: { path: p, value } });
const hs = (page) => page.evaluate(() => { const n = document.querySelector('.dp-hs'); return n ? { phase: n.getAttribute('data-hs'), text: n.innerText } : null; });
const phaseIs = (page, ph, t) => page.waitForFunction((p) => { const n = document.querySelector('.dp-hs'); return !!n && n.getAttribute('data-hs') === p; }, ph, { timeout: t || 15000 });
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
try {
  const I = await openDisplay(browser, IPAD);
  const startLayers = async (to) => {
    await layer('data.credits', ['n_d', 'n_c']); await layer('data.previously', ['n_d', 'n_c', 'n_b']);
    await layer('data.countdown', { to, label: 'Station clock' }); await layer('scene.mode', 'start');
  };
  await step('switches off: the start layers draw nothing and the campaign document gains nothing', async () => {
    await startLayers(Date.now() + 2000); await sleep(7000);
    expect((await hs(I.page)) === null, 'no hard start on the iPad: ' + JSON.stringify(await hs(I.page)));
    expect((await I.page.evaluate(() => !!document.querySelector('.dp-onair'))) === false, 'no lamp');
    const c = await (await gmCall('GET', '/api/campaign')).json();
    expect(!c.doc.features || Object.keys(c.doc.features).every((k) => k === 'phoneCards'), 'campaign features untouched: ' + JSON.stringify(c.doc.features));
    await ambient({ layers: null });
  });
  await step('switches on: countdown, fuse, credits, three blank plates, three reveals, end', async () => {
    const r = await gmCall('PATCH', '/api/campaign', { features: { 'spine.start': true, 'ai.onair': true } });
    expect(r.status === 200, 'features written: ' + r.status);
    await sleep(6000);
    await startLayers(Date.now() + 10000);
    await phaseIs(I.page, 'card', 12000);
    const card = await hs(I.page);
    expect(/Please stand by/i.test(card.text) && /\d:\d\d/.test(card.text), 'the station clock counts down: ' + JSON.stringify(card));
    await phaseIs(I.page, 'fuse', 12000);
    await I.page.waitForFunction(() => { const n = document.querySelector('.dp-hs'); return !!n && n.getAttribute('data-hs') === 'credits' && /Lotte Brand/i.test(n.innerText); }, null, { timeout: 12000 });
    expect(!/GM-ONLY/.test(await pageText(I.page)), 'credits roll with revealed names only');
    await phaseIs(I.page, 'previously', 20000);
    expect((await I.page.evaluate(() => document.querySelectorAll('.dp-hs-face').length)) === 3, 'three faces');
    expect(!/Pip Tolliver|Lotte Brand|Dov Kessler/i.test((await hs(I.page)).text), 'plates are blank: ' + JSON.stringify(await hs(I.page)));
    await layer('band.faces', [{ npcId: 'n_d' }]);
    await I.page.waitForFunction(() => /Pip Tolliver/i.test(document.querySelector('.dp-hs').innerText), null, { timeout: 12000 });
    await layer('band.faces', [{ npcId: 'n_d' }, { npcId: 'n_c' }, { npcId: 'n_b' }]);
    await I.page.waitForFunction(() => /Pip Tolliver[\s\S]*Lotte Brand[\s\S]*Dov Kessler/i.test(document.querySelector('.dp-hs').innerText), null, { timeout: 12000 });
    const bad = await gmCall('PATCH', '/api/gm/ambient', { layer: { path: 'band.faces', value: [{ npcId: 'n_hid' }] } });
    await sleep(5000);
    expect(!/GM-ONLY/.test(await pageText(I.page)), 'a hidden NPC never reaches the page (write: ' + bad.status + ')');
    await ambient({ layers: null });
    await I.page.waitForFunction(() => !document.querySelector('.dp-hs'), null, { timeout: 12000 });
  });
  await step('ai.onair: the lamp shows while live and counts down off the record; the command line is judged, not kept', async () => {
    const r = await I.page.evaluate(() => {
      const A = window.B68OnAir; if (!A || !window.B68Flags.on('ai.onair')) return { err: 'switch not on' };
      const a = A.shared(), root = document.getElementById('display-page'), out = {};
      a.paint(root, true); out.on = (document.querySelector('.dp-onair') || {}).innerText;
      out.cmd = a.filter('Blade, off the record'); a.paint(root, true); out.off = (document.querySelector('.dp-onair') || {}).innerText;
      out.kept = a.filter('private chatter'); a.filter('Blade, back on'); a.paint(root, false); out.gone = !document.querySelector('.dp-onair');
      return out;
    });
    expect(!r.err, r.err); expect(/on air/i.test(r.on), 'lamp: ' + r.on); expect(r.cmd.drop === true && /off the record 5:00|off the record 4:5/i.test(r.off), 'paused with countdown: ' + r.off);
    expect(r.kept.drop === true && r.gone === true, 'private chatter dropped; lamp gone when the mic is not live');
  });
  await step('switches off again: the hard start is gone, no page errors', async () => {
    expect((await gmCall('PATCH', '/api/campaign', { features: { 'spine.start': false, 'ai.onair': false } })).status === 200, 'written');
    await sleep(6000); await startLayers(Date.now() + 1000); await sleep(6000);
    expect((await hs(I.page)) === null, 'no hard start with the switch off'); await ambient({ layers: null });
    expect(I.seen.errors.length === 0, 'page errors: ' + I.seen.errors.join(' | '));
  });
} finally { await browser.close(); }
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
