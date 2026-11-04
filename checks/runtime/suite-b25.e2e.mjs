// Suite B25 (3.2 expressions and a signature pose, 3.3 portrait formats, 3.4 a badge, a style and a motif) on the real display page, in a real browser.
// A held NPC overlay may carry a look of names; with the switches off the card is the plain one; with them on it wears the expression, the pose, the format, the badge and plays its motif
// (a fake AudioContext records what the page asks of it). A hidden NPC is refused and its notes never reach the page. INVENTED data only (the Pelican Rooms cast).
//   PW_MODULE=<path to playwright-core> PW_CHANNEL=msedge node checks/runtime/suite-b25.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9250);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-b25-e2e-'));
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
async function openDisplay(browser, { user = GM, reduced = false, watch = false, fakeAudio = false } = {}) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, viewport: { width: 1366, height: 1024 }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  /* a fake AudioContext that only records what the motif asks of Web Audio, on the page's own clock */
  if (fakeAudio) await page.addInitScript(() => {
    window.__au = { made: 0, oscs: [], gains: [], resumed: 0 };
    class FakeParam { constructor(log, name) { this.log = log; this.name = name; } setValueAtTime(v, t) { this.log.push([this.name, 'set', v, t]); } linearRampToValueAtTime() {} setTargetAtTime(v, t) { this.log.push([this.name, 'target', v, t]); } cancelScheduledValues() {} }
    window.AudioContext = class {
      constructor() { window.__au.made++; this.state = 'running'; this.destination = {}; this.t0 = performance.now(); }
      get currentTime() { return (performance.now() - this.t0) / 1000; }
      resume() { window.__au.resumed++; return Promise.resolve(); }
      createGain() { return { gain: new FakeParam(window.__au.gains, 'g'), connect() {}, disconnect() {} }; }
      createOscillator() { const o = { type: '', frequency: new FakeParam([], 'f'), detune: new FakeParam([], 'd'), connect() {}, start(t) { o.at = t; window.__au.oscs.push(o); }, stop(t) { o.to = t; } }; return o; }
    };
  });
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

const NOTES = (tell, sig, rel) => 'GM-ONLY-NOTES-' + tell + '\nTell: ' + tell + '\nSignature: ' + sig + '\nRelation: ' + rel + '\n';
const FEATURES = ['face.expressions', 'face.formats', 'face.badge'];
const setFeatures = async (on) => {
  const m = {}; FEATURES.forEach((id) => { m[id] = !!on[id]; });
  const r = await gmCall('PATCH', '/api/campaign', { features: m }); if (r.status !== 200) throw new Error('features ' + r.status);
};
const flagOn = (page, id, want) => page.waitForFunction(([i, w]) => !!(window.B68Flags && window.B68Flags.on(i)) === w, [id, want], { timeout: 20000 });
/* the portrait's markup with the overlay's own id taken out (the kit gives each drawing ids made from it) */
const portraitOf = (page) => page.evaluate(() => { const p = document.querySelector('.dp-ov-npc .dp-ov-portrait svg'); return p ? p.outerHTML.replace(/dp-[A-Za-z0-9_-]*(?:fl|ov-npc)-[A-Za-z0-9_-]+/g, 'ID') : ''; });
const look = async (page, id, npcId, lk, ms = 60000) => { await ambient({ overlay: { id, kind: 'npc', ms, npcId, ...(lk ? { look: lk } : {}) } }); await cardIn(page, 'npc', id); await sleep(700); };

await push(SPOT);
await ambient({ overlay: null, auto: null });
await setFeatures({});
const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
try {
  const G = await openDisplay(browser, { fakeAudio: true });
  const base = await G.page.evaluate(() => window.B68 && window.B68.BASE_FIGURE);
  const people = [
    ['npc_pr_mabel', { name: 'Mabel Quist', alias: 'Mab', role: 'Fixer', faction: 'The Kestrel Club', gmNotes: NOTES('smirk', 'lapel', 'resident'), spec: { ...base, seed: 11 } }],
    ['npc_pr_dov', { name: 'Dov Kessler', alias: '', role: 'Desk sergeant', faction: 'The Tidewater Watch', gmNotes: NOTES('tired', 'cross', 'staff'), spec: { ...base, seed: 42 } }],
    ['npc_pr_ada', { name: 'Ada Vell', alias: '', role: 'Croupier', faction: 'The Kestrel Club', gmNotes: NOTES('wary', 'hip', 'suspect'), spec: { ...base, seed: 77 } }]];
  await step('setup: three invented people filed and revealed, one hidden; the figure kit gives a base spec', async () => {
    expect(base && typeof base === 'object', 'a base figure');
    for (const [id, d] of people) expect((await gmCall('PUT', '/api/npcs/' + id, { ...d, description: '', revealed: true })).status === 200, id);
    expect((await gmCall('PUT', '/api/npcs/npc_pr_hid', { ...people[0][1], name: 'Hidden Person', gmNotes: 'GM-ONLY-HIDDEN', revealed: false })).status === 200, 'hidden');
  });

  await step('every switch off: a look on the overlay changes nothing; the card is the plain card, byte for byte', async () => {
    await look(G.page, 'o-off-1', 'npc_pr_mabel', null);
    const plain = await portraitOf(G.page);
    expect(plain.length > 500, 'a portrait is drawn');
    await ambient({ overlay: null }); await noOverlay(G.page, 15000);
    await look(G.page, 'o-off-2', 'npc_pr_mabel', { expr: 'afraid', fmt: 'passport', pose: 'lapel' });
    const withLook = await portraitOf(G.page);
    expect(withLook === plain, 'the portrait is identical with the switches off');
    const info = await G.page.evaluate(() => ({ fl: !!document.querySelector('.dp-ov-npc [class*="dp-fl"]') || /dp-fl/.test(document.querySelector('.dp-ov-npc').className), name: document.querySelector('.dp-ov-npc .dp-ov-name').textContent }));
    expect(!info.fl && info.name === 'Mabel Quist', 'no frame, no badge: ' + JSON.stringify(info));
    expect(G.seen.responses.every((r) => !/^\/api\/npcs\//.test(r.path)), 'the page never read the cast');
    await ambient({ overlay: null }); await noOverlay(G.page, 15000);
  });

  await step('expressions on: the five faces differ, a re-lay keeps the face, and the pose plays once and goes', async () => {
    await setFeatures({ 'face.expressions': true }); await flagOn(G.page, 'face.expressions', true);
    const seen = {};
    for (const [i, e] of ['neutral', 'pleased', 'hostile', 'afraid', 'smirk'].entries()) {
      await look(G.page, 'o-ex-' + i, 'npc_pr_mabel', { expr: e }); seen[e] = await portraitOf(G.page);
      await ambient({ overlay: null }); await noOverlay(G.page, 15000);
    }
    const uniq = new Set(Object.values(seen)); expect(uniq.size === 5, 'five different faces, got ' + uniq.size);
    expect(G.seen.errors.length === 0 && G.seen.console.length === 0, 'no page errors or console errors: ' + G.seen.errors.concat(G.seen.console).join(' | '));
    await look(G.page, 'o-pose-1', 'npc_pr_mabel', { expr: 'afraid', pose: 'lapel' }, 90000);
    expect(await G.page.evaluate(() => !!document.querySelector('.dp-ov-npc .dp-fl-pose svg')), 'the signature pose is up');
    await G.page.waitForFunction(() => !document.querySelector('.dp-ov-npc .dp-fl-pose'), null, { timeout: 8000 });
    expect(await portraitOf(G.page) === seen.afraid, 'and the afraid portrait is back under it');
    await look(G.page, 'o-pose-2', 'npc_pr_mabel', { expr: 'afraid', re: true }, 90000);
    expect(await G.page.evaluate(() => !document.querySelector('.dp-ov-npc .dp-fl-pose')), 'a re-laid hold does not replay the pose');
    expect(await portraitOf(G.page) === seen.afraid, 'but keeps the face');
    await ambient({ overlay: null }); await noOverlay(G.page, 15000);
  });

  await step('formats on: each of the five frames the person, with a duotone of the faction colour and no new request', async () => {
    await setFeatures({ 'face.formats': true }); await flagOn(G.page, 'face.formats', true);
    const before = G.seen.requests.length;
    for (const [i, fmt] of ['licence', 'badge', 'mugshot', 'society', 'passport'].entries()) {
      await look(G.page, 'o-fm-' + i, 'npc_pr_ada', { fmt });
      const info = await G.page.evaluate((f) => { const fr = document.querySelector('.dp-ov-npc .dp-fl-' + f); return { fr: !!fr, filter: !!document.querySelector('.dp-ov-npc filter'), holder: !!(fr && fr.querySelector('.dp-ov-portrait svg')), w: fr ? fr.getBoundingClientRect().width : 0, cw: document.querySelector('.dp-ov-npc').getBoundingClientRect().width }; }, fmt);
      expect(info.fr && info.filter && info.holder, fmt + ': ' + JSON.stringify(info));
      expect(info.w <= info.cw + 1, fmt + ' fits the card');
      if (process.env.B25_SHOTS) await G.page.screenshot({ path: path.join(process.env.B25_SHOTS, 'fmt-' + fmt + '.png') });
      await ambient({ overlay: null }); await noOverlay(G.page, 15000);
    }
    expect(G.seen.requests.slice(before).every((u) => !/\/api\/npcs/.test(u)), 'no cast request');
    expect(G.seen.errors.length === 0, 'no page errors: ' + G.seen.errors.join(' | '));
  });

  await step('badge on: a stable number and glyph, the faction style, one motif of 3 to 6 seconds on first sight and none on a re-lay', async () => {
    await setFeatures({ 'face.badge': true }); await flagOn(G.page, 'face.badge', true);
    await G.page.mouse.click(600, 500); await sleep(300);          // a tap: the iPad starts audio only inside one
    expect(await G.page.evaluate(() => window.__au.made) === 1, 'the tap made the audio context');
    await look(G.page, 'o-bd-1', 'npc_pr_dov', null);
    const one = await G.page.evaluate(() => { const c = document.querySelector('.dp-ov-npc'); return { no: (c.querySelector('.dp-fl-tag-no') || {}).textContent, glyph: !!c.querySelector('.dp-fl-glyph'), cls: c.className }; });
    expect(/^No\. \d{3}$/.test(one.no) && one.glyph && /dp-fl-styled/.test(one.cls) && /dp-fl-tx-/.test(one.cls), 'the badge: ' + JSON.stringify(one));
    const au = await G.page.evaluate(() => { const o = window.__au.oscs; return { n: o.length, from: Math.min(...o.map((x) => x.at)), to: Math.max(...o.map((x) => x.to)) }; });
    expect(au.n >= 5 && au.to - au.from >= 3 && au.to - au.from <= 6.3, 'the motif: ' + JSON.stringify(au));
    await ambient({ overlay: null }); await noOverlay(G.page, 15000);
    await look(G.page, 'o-bd-2', 'npc_pr_dov', null);
    expect((await G.page.evaluate(() => (document.querySelector('.dp-ov-npc .dp-fl-tag-no') || {}).textContent)) === one.no, 'the same number next time');
    const n2 = await G.page.evaluate(() => window.__au.oscs.length); expect(n2 > au.n, 'a fresh spotlight plays the motif again');
    await look(G.page, 'o-bd-3', 'npc_pr_dov', { re: true });
    expect(await G.page.evaluate(() => window.__au.oscs.length) === n2, 'a renewed hold is silent');
    await ambient({ overlay: null }); await noOverlay(G.page, 15000);
  });

  await step('all three on at once: the card fits the right-hand third, and the GM notes never reach the page', async () => {
    await setFeatures({ 'face.expressions': true, 'face.formats': true, 'face.badge': true });
    await flagOn(G.page, 'face.expressions', true); await flagOn(G.page, 'face.formats', true);
    await look(G.page, 'o-all-1', 'npc_pr_ada', { expr: 'hostile', fmt: 'mugshot' });
    const r = await rect(G.page, '.dp-ov-npc'); expect(r.l >= 0.66 - 1e-6 && r.r <= 1 + 1e-6 && r.t >= 0 && r.b <= 1, 'inside the right-hand 34%: ' + JSON.stringify(r));
    if (process.env.B25_SHOTS) await G.page.screenshot({ path: path.join(process.env.B25_SHOTS, 'all.png') });
    const body = await G.page.evaluate(() => document.body.innerHTML + document.body.innerText);
    expect(!/GM-ONLY|Signature:|Relation:|Tell:/.test(body), 'no notes anywhere on the page');
    await ambient({ overlay: null }); await noOverlay(G.page, 15000);
  });

  await step('a hidden person with a look is refused; a look of the wrong shape is refused; junk inside a look is dropped', async () => {
    const hid = await gmCall('PATCH', '/api/gm/ambient', { overlay: { id: 'o-h', kind: 'npc', ms: 20000, npcId: 'npc_pr_hid', look: { expr: 'afraid' } } });
    expect(hid.status === 400, 'hidden: ' + hid.status);
    const bad = await gmCall('PATCH', '/api/gm/ambient', { overlay: { id: 'o-b', kind: 'npc', ms: 20000, npcId: 'npc_pr_ada', look: 'afraid' } });
    expect(bad.status === 400, 'a string look: ' + bad.status);
    const ok = await gmCall('PATCH', '/api/gm/ambient', { overlay: { id: 'o-j', kind: 'npc', ms: 20000, npcId: 'npc_pr_ada', look: { expr: 'afraid', text: 'GM-ONLY-JUNK', fmt: 'bogus' } } });
    expect(ok.status === 200, 'junk is dropped, not refused: ' + ok.status);
    const stored = (await (await gmCall('GET', '/api/gm/ambient')).json()).doc.overlay;
    expect(JSON.stringify(stored.look) === '{"expr":"afraid"}', 'stored: ' + JSON.stringify(stored));
    await ambient({ overlay: null });
  });

  await step('no page errors, no CSP refusals, no request left the origin', async () => {
    const out = G.seen.requests.filter((u) => /^https?:/i.test(u) && new URL(u).origin !== BASE);
    expect(out.length === 0, 'requests left the origin: ' + out.join(' | '));
    expect(G.seen.errors.length === 0, 'page errors: ' + G.seen.errors.join(' | '));
    expect(G.seen.console.filter((m) => /content security policy|refused to/i.test(m)).length === 0, 'CSP refusals');
  });
  await setFeatures({});
  await G.ctx.close();
} finally {
  await browser.close();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
killServer();
process.exit(failed ? 1 : 0);
