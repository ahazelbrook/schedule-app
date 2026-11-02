// The show contract in a real browser (W0.3 / F6; functions/_lib/show.js, app/display/*.js): each brief-beat kind laid over the table display reaches both
// the GM's display and the table iPad's display-only sign-in within a poll, draws its payload and goes by itself at its ms; a hidden NPC in a payload is
// dropped by the server (and a drawn NPC who is hidden afterwards comes off in place); the lasting layers set, show, reach an ambient scene frame as a
// b68:data message (joined to revealed NPCs only) and clear; the look book draws a frame per kind at 1024 x 768 and is GM only. Invented data only.
//   PW_MODULE=<path to playwright-core> PW_CHANNEL=msedge node checks/runtime/show-contract.e2e.mjs      (port 9050 unless PORT is set)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9050);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-showcontract-e2e-'));
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

const FIX = {
  stamp: { word: 'PAID', tone: 'orange' }, spotted: { text: 'Eyes on the door', level: 2 }, keyturn: { label: 'KEY-1', pc: 'Nell Arbuthnot' },
  title: { text: 'The Pelican Rooms', sub: 'Gala night' }, wanted: { level: 3, heat: 7, siren: true }, ring: { text: 'The desk phone' },
  rolodex: { npcIds: ['n_mabel', 'n_dov', 'n_lotte'] }, spotlight: { npcId: 'n_lotte' },
};
/* innerText follows the CSS text-transform (the beats set their headings in capitals), so every match ignores case */
const WORD = { stamp: /PAID/i, spotted: /SPOTTED[\s\S]*Eyes on the door/i, keyturn: /KEY-1[\s\S]*Nell Arbuthnot/i, title: /The Pelican Rooms[\s\S]*Gala night/i, wanted: /WANTED[\s\S]*Heat 7/i, ring: /Ringing[\s\S]*The desk phone/i, rolodex: /Mabel Quist[\s\S]*Dov Kessler[\s\S]*Lotte Brand/i, spotlight: /Lotte Brand[\s\S]*Doorwoman/i };

for (const [id, name, role, revealed] of [['n_mabel', 'Mabel Quist', 'Fixer', true], ['n_dov', 'Dov Kessler', 'Desk sergeant', true], ['n_lotte', 'Lotte Brand', 'Doorwoman', true], ['n_hid', 'GM-ONLY-NPC-1', 'GM-ONLY-ROLE-1', false]]) {
  const r = await gmCall('PUT', '/api/npcs/' + id, { name, alias: '', role, faction: 'The Invented Guild', description: 'DESC-MARKER', gmNotes: 'GMNOTES-MARKER', revealed, spec: {} });
  if (r.status !== 200) { console.log('FAIL could not create ' + id + ': ' + r.status); process.exit(1); }
}
await gmCall('PUT', '/api/gm/display', { kind: 'text', title: 'Spot', text: 'The invented spotlight line' });
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
try {
  const G = await openDisplay(browser, GM);
  const I = await openDisplay(browser, IPAD);

  for (const [kind, payload] of Object.entries(FIX)) {
    await step('the ' + kind + ' beat reaches the iPad within one poll, draws its payload over the spotlight and goes by itself at its ms', async () => {
      const ms = 3500, t0 = Date.now();
      await ambient({ overlay: { id: uid(kind), kind, ms, payload } });
      for (const P of [G, I]) await showIn(P.page, kind, 8000);
      const arrived = Date.now() - t0;
      expect(arrived < 8000, 'it reached both displays within a poll or so: ' + arrived + ' ms');
      const t = await shows(I.page);
      expect(t.length === 1 && WORD[kind].test(t[0].text), 'the iPad drew ' + kind + ': ' + JSON.stringify(t));
      expect(/invented spotlight line/i.test(await pageText(I.page)), 'the spotlight underneath is unchanged');
      await noShow(I.page, ms + 8000);
      expect(Date.now() - t0 < ms + 8000, 'it expired by itself');
      expect((await shows(G.page)).length <= 1, 'one beat at a time');
    });
  }

  await step('a rolodex with a hidden NPC in it: the server drops it, the iPad never draws it; hiding a drawn NPC takes that card off in place; hiding the last takes the beat away', async () => {
    const r = await gmCall('PATCH', '/api/gm/ambient', { overlay: { id: uid('rd'), kind: 'rolodex', ms: 90000, payload: { npcIds: ['n_mabel', 'n_hid', 'n_dov'] } } });
    expect(r.status === 200, 'accepted: ' + r.status);
    expect(JSON.stringify((await r.json()).doc.overlay.payload.npcIds) === '["n_mabel","n_dov"]', 'stored without the hidden one');
    await showIn(I.page, 'rolodex', 12000);
    let cards = await I.page.evaluate(() => Array.from(document.querySelectorAll('.dp-roll-card .dp-roll-name')).map((e) => e.textContent));
    expect(cards.join('|') === 'Mabel Quist|Dov Kessler', 'two cards: ' + cards.join('|'));
    expect(!/GM-ONLY|DESC-MARKER|GMNOTES-MARKER/.test(await pageText(I.page)), 'no hidden marker on the iPad');
    expect((await gmCall('PATCH', '/api/npcs/n_dov', { revealed: false })).status === 200, 'Dov hidden afterwards');
    await I.page.waitForFunction(() => document.querySelectorAll('.dp-roll-card').length === 1, null, { timeout: 15000 });
    cards = await I.page.evaluate(() => Array.from(document.querySelectorAll('.dp-roll-card .dp-roll-name')).map((e) => e.textContent));
    expect(cards.join('|') === 'Mabel Quist', 'the hidden NPC\'s card went off in place: ' + cards.join('|'));
    expect((await gmCall('PATCH', '/api/npcs/n_mabel', { revealed: false })).status === 200, 'Mabel hidden afterwards');
    await noShow(I.page, 15000);
    expect(!/Mabel|Dov/.test(await pageText(I.page)), 'no hidden name left on the iPad');
    await gmCall('PATCH', '/api/npcs/n_mabel', { revealed: true }); await gmCall('PATCH', '/api/npcs/n_dov', { revealed: true });
    const bad = await gmCall('PATCH', '/api/gm/ambient', { overlay: { id: uid('rd'), kind: 'rolodex', ms: 5000, payload: { npcIds: ['n_hid'] } } });
    expect(bad.status === 400, 'a rolodex of only a hidden NPC is refused: ' + bad.status);
    await ambient({ overlay: null });
  });

  await step('lasting layers: set, they stay past any beat, reach the iPad and the scene frame, and clear', async () => {
    await ambient({ layer: { path: 'band.phase', value: 'plan' } });
    await ambient({ layer: { path: 'band.security', value: 2 } });
    await ambient({ layer: { path: 'band.onair', value: true } });
    await ambient({ layer: { path: 'band.faces', value: [{ npcId: 'n_mabel' }, { npcId: 'n_hid' }, { pcId: 'pc-nell' }] } });
    await ambient({ layer: { path: 'scene.filter', value: 'flashback' } });
    await ambient({ layer: { path: 'data.credits', value: ['n_lotte', 'n_hid', 'n_dov'] } });
    await ambient({ layer: { path: 'data.countdown', value: { to: Date.now() + 600000, label: 'Curfew' } } });
    await I.page.waitForFunction(() => { const r = document.querySelector('.dp-root'); return !!r && r.getAttribute('data-band-phase') === 'plan' && r.getAttribute('data-scene-filter') === 'flashback' && r.getAttribute('data-band-onair') === '1'; }, null, { timeout: 15000 });
    const strip = await I.page.evaluate(() => (document.querySelector('.dp-lay-strip') || {}).textContent || '');
    expect(/ON AIR/.test(strip) && /Plan/.test(strip) && /Mabel Quist/.test(strip) && /pc-nell/.test(strip), 'the strip: ' + strip);
    expect(!/GM-ONLY/.test(strip + await pageText(I.page)), 'no hidden NPC in the strip');
    const filt = await I.page.evaluate(() => getComputedStyle(document.querySelector('.dp-ambient')).filter);
    expect(/sepia/.test(filt), 'the flashback filter is on the ambient floor: ' + filt);
    // the data channel: put the credits scene up and ask what its frame was told
    await gmCall('PUT', '/api/gm/display', { kind: 'blank', title: '', caption: '' });
    await ambient({ mode: 'pin', scene: 'credits' });
    await I.page.waitForSelector('.dp-ambient iframe', { state: 'attached', timeout: 20000 });
    await sleep(1500);
    const got = await I.page.evaluate(async () => {
      const f = document.querySelector('.dp-ambient iframe'); const w = f && f.contentWindow; if (!w) return null;
      const msgs = []; w.addEventListener('message', (e) => msgs.push(e.data));
      const sc = w.document.createElement('script'); sc.textContent = "parent.postMessage({ type: 'b68:ready' }, location.origin)"; w.document.body.appendChild(sc);   // the scene says it is ready, from its own window (the scenes' CSP allows inline script, not eval)
      await new Promise((r) => setTimeout(r, 500));
      return msgs.filter((m) => m && m.type === 'b68:data');
    });
    expect(got && got.length >= 1, 'the scene frame was sent b68:data: ' + JSON.stringify(got));
    const m = got[got.length - 1];
    expect(m.phase === 'plan' && m.security === 2 && m.onair === true && m.filter === 'flashback', 'the layers: ' + JSON.stringify(m));
    expect(m.credits.map((c) => c.name).join('|') === 'Lotte Brand|Dov Kessler' && m.faces.map((c) => c.name || c.pcId).join('|') === 'Mabel Quist|pc-nell', 'joined to revealed NPCs: ' + JSON.stringify([m.credits, m.faces]));
    expect(m.countdown && m.countdown.label === 'Curfew' && Math.abs(m.countdown.to - Date.now() - 600000) < 30000, 'the countdown: ' + JSON.stringify(m.countdown));
    expect(!/GM-ONLY|n_lotte|n_mabel|spec/.test(JSON.stringify(m)), 'nothing but names and roles reaches the scene');
    await ambient({ layers: null });
    await I.page.waitForFunction(() => { const r = document.querySelector('.dp-root'); return !r.getAttribute('data-band-phase') && !r.getAttribute('data-scene-filter') && !document.querySelector('.dp-lay-strip'); }, null, { timeout: 15000 });
    await ambient({ mode: 'auto', scene: null });
  });

  await step('only same-origin requests; no page errors; the iPad sign-in made only the display call and the page files', async () => {
    for (const P of [G, I]) {
      const out = P.seen.requests.filter((u) => /^https?:/i.test(u) && new URL(u).origin !== BASE);
      expect(out.length === 0, 'requests left the origin: ' + out.join(' | '));
      expect(P.seen.errors.length === 0, 'page errors: ' + P.seen.errors.join(' | '));
      const csp = P.seen.console.filter((m) => /content security policy|refused to/i.test(m));
      expect(csp.length === 0, 'CSP refusals: ' + csp.join(' | '));
    }
    expect(I.seen.requests.every((u) => !/\/api\/npcs|\/api\/gm\/ambient/.test(u)), 'the iPad never read the cast or the ambient document directly');
  });

  await step('the look book: GM only; a frame for every registered kind and the layers, each drawn at iPad size', async () => {
    const L = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1280, height: 900 } });
    const p = await L.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    await p.goto(BASE + '/lookbook.html');
    await p.waitForSelector('.lb-card', { timeout: 20000 });
    const cardsN = await p.evaluate(() => Array.from(document.querySelectorAll('.lb-card figcaption code')).map((c) => c.textContent));
    expect(cardsN.join(',') === 'stamp,spotted,keyturn,title,wanted,ring,rolodex,spotlight,report,layers', 'a card per kind: ' + cardsN.join(','));
    await sleep(2500);
    for (const k of ['stamp', 'rolodex', 'wanted']) {
      const fr = p.frames().find((f) => f.url().includes('frame=' + k));
      expect(!!fr, 'the frame for ' + k);
      await fr.waitForSelector('.dp-show.dp-ov-in', { timeout: 15000 });
      const size = await fr.evaluate(() => [innerWidth, innerHeight]);
      expect(size[0] === 1024 && size[1] === 768, k + ' is drawn at iPad size: ' + size);
    }
    const lf = p.frames().find((f) => f.url().includes('frame=layers'));
    await lf.waitForSelector('.dp-lay-strip', { timeout: 15000 });
    await p.screenshot({ path: path.join(stateDir, 'lookbook.png'), fullPage: false }).catch(() => {});
    expect(errs.length === 0, 'page errors: ' + errs.join(' | '));
    await L.close();
    const P = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': 'player@example.test' }, viewport: { width: 800, height: 600 } });
    const pp = await P.newPage(); await pp.goto(BASE + '/lookbook.html');
    await pp.waitForFunction(() => /GM only/i.test(document.body.innerText), null, { timeout: 15000 });
    expect(!(await pp.evaluate(() => document.querySelector('.lb-card'))), 'a player sees no card');
    await P.close();
  });

  await G.ctx.close(); await I.ctx.close();
} finally {
  await browser.close();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
killServer();
process.exit(failed ? 1 : 0);
