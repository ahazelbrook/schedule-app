// IP7 (map.shade, map kit 1.2): a shaded map WITH PEOPLE on the real display, end to end against a local Worker (wrangler dev) on PORT (default 12520;
// the inspector on PORT + 20000). Invented fixtures only (the Pelican Rooms, the Dovetail Crew). The maps are drawn here, in Node, through the GM page's
// own player path (P.playerDisplay with the vendored kits), then sent through the server as the GM page sends them.
//   a. Every checker on the way keeps the occluders whole: the server (PUT /api/gm/display, PATCH /api/gm/ambient score), the display's sanitiser, the
//      score scene's message (cleanScore, scoreMessage) and the planning board's own parser: each <use href="#id"> still resolves inside its own svg
//      and draws (a box of its own).
//   b. Two copies of a map in the document (the Chromium bug: an earlier hidden copy with the same ids breaks the visible one's references): the map
//      sent again as it is (the live re-send: the same ids, the kit's prefix is a hash of the inputs), keyed -> stage -> a room cut -> back, Blank and
//      again, and the planning board pinned again. Sampled every 100 ms: never a hidden copy; when it settles one copy, no id twice, every reference
//      inside it, and it draws as a freshly loaded page draws it.
//   Settings: the classic display, the new stage, and the new stage with the players' screen (map first).
//   PW_MODULE=<playwright-core> [PW_CHANNEL=msedge] [PW_ENGINE=webkit] [PORT=12520] [KIT_SHOTS=<dir>] node checks/runtime/map-shade.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sites } from './fixtures/gm/map-kit1-cases.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 12520);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const SHOTS = process.env.KIT_SHOTS || '';
const ENGINE = process.env.PW_ENGINE === 'webkit' ? 'webkit' : 'chromium';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
let failed = 0, passed = 0;
async function step(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.message || e)); } }
const expect = (c, m) => { if (!c) throw new Error(m); };
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

/* ---------- the maps, drawn through the GM page's own path ---------- */
const K = require(path.join(ROOT, 'app', 'maps', 'map-kit.js'));
if (!/^1\.2\./.test(K.VERSION)) { console.log('SKIP the vendored map kit is ' + K.VERSION + ': this suite is for 1.2 (shade)'); process.exit(0); }
const FK = require(path.join(ROOT, 'app', 'figures', 'figure-kit.js'));
const G = require(path.join(ROOT, 'app', 'gm', 'scene-state.js'));
const PB = require(path.join(ROOT, 'app', 'gm', 'players-board.js'));
const P = require(path.join(ROOT, 'app', 'gm-page.js'))._pure; P.sceneMod = G; P.kit1On = () => true;
const S = sites(), ROLL = S.pelican;
const PCS = [{ id: 'pc1', name: 'Nell Arbuthnot', spec: { id: 'nell', name: 'Nell Arbuthnot', figure: 'fem', heightIn: 66, skin: 'olive', outfit: 'street' } },
  { id: 'pc2', name: 'Ray Okonjo', spec: { id: 'ray', name: 'Ray Okonjo', figure: 'masc', heightIn: 71, skin: 'brown', outfit: 'street' } }, { id: 'pc3', name: 'Tam Petrakis', spec: null }];
const CREW = { pc1: { room: 'Showroom' }, pc2: { room: 'Cocktail lounge' }, pc3: { room: 'Cocktail lounge' } };
const FL = (ks) => G.flags((id) => ks.some((k) => G.IDS[k] === id));
const SC = (ks, extra) => Object.assign({ flags: FL(ks), pcs: PCS, crew: CREW, disguises: [], crowd: true, lights: {}, screen: 'tv', stage: G.stageOk(K), view: '', room: '', kit: FK }, extra || {});
const MAP = { layer: 'player', view: 'iso', theme: 'rulebook', reveal: { public: true, working: true }, open: [], know: [] };
function draw(on, ks, extra) { P.shadeOn = () => on; try { return P.playerDisplay(ROLL, MAP, K.render, { tokens: [], hide: [], sig: '', scene: SC(ks, extra) }); } finally { P.shadeOn = () => false; } }
const MAPS = {};
for (const on of [false, true]) {
  const w = on ? 'on' : 'off';
  MAPS['keyed-' + w] = draw(on, ['people']);
  MAPS['stage-' + w] = draw(on, ['people', 'fill']);
  MAPS['room-' + w] = draw(on, ['people', 'room'], { view: 'room', room: 'Showroom' });
}
/* the score scene and the planning board with a pin, as the GM page builds them (scoreScene, then the board drawn again with its pins) */
function board(on, texts) {
  P.shadeOn = () => on;
  try {
    const built = P.scoreScene(ROLL, MAP, K.render), seen = P.revealEntries(MAP);
    const items = texts.map((t, i) => ({ full: PB.token({ id: 'p' + i, room: i ? 'Cocktail lounge' : 'Showroom', kind: 'line', text: t }, { npcs: {}, K: FK }) })).filter((x) => x.full);
    const fit = PB.fitBoard(ROLL, K.render, Object.assign({ seen, view: built.view, kit1: true, leaks: P.leaks }, P.shadeOpt()), items);
    if (fit.svg) built.score.board = fit.svg;
    return built.score;
  } finally { P.shadeOn = () => false; }
}
const occ = (svg) => (svg.match(/class="map-occluder"/g) || []).length;
console.log('INFO map kit ' + K.VERSION + '; occluders: keyed ' + occ(MAPS['keyed-on'].svg) + ', stage ' + occ(MAPS['stage-on'].svg) + ', room ' + occ(MAPS['room-on'].svg) + '; the display runs in ' + ENGINE);

/* ---------- the Worker ---------- */
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const stateDir = fs.mkdtempSync(path.join(tmpdir(), 'b68-map-shade-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
delete env.ANTHROPIC_API_KEY; delete env.B68_ANTHROPIC_KEY;
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'DISPLAY_EMAILS:' + IPAD],
{ cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: 'ignore' });
function killServer() { if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} } }
process.on('exit', () => { killServer(); try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
let up = false;
for (let i = 0; i < 180 && !up; i++) { try { up = (await fetch(BASE + '/index.html', { signal: AbortSignal.timeout(2000) })).status > 0; } catch (_) {} if (!up) await sleep(500); }
if (!up) { console.log('FAIL server did not start'); process.exit(1); }
const call = (method, p, body) => fetch(BASE + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const ok = async (pr, what) => { const r = await pr; if (r.status !== 200) throw new Error(what + ': ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 200)); return r.json; };
const settings = async (f) => { for (const p of ['/api/gm/state', '/api/campaign']) await ok(call('PATCH', p, { features: { 'kit.stage': !!f.stage, 'stage.players': !!f.players, 'fx.off': true } }), 'settings ' + p); };
const push = (k, extra) => ok(call('PUT', '/api/gm/display', Object.assign(k === 'blank' ? { kind: 'blank' } : { kind: 'svg', title: ROLL.name, caption: 'surveyed: public, working', svg: MAPS[k].svg }, extra || {})), 'push ' + k);
const ambient = (patch) => ok(call('PATCH', '/api/gm/ambient', patch), 'ambient');

/* ---------- the browser ---------- */
const PW = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const browser = ENGINE === 'webkit' ? await PW.webkit.launch() : await PW.chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const NOISE = /Content Security Policy|Report Only|media\/theme\.mp3|favicon/;
async function openIpad(w, h) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: w, height: h }, serviceWorkers: 'block' });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push('pageerror ' + (e && e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text() + ' ' + ((m.location() && m.location().url) || ''))) errors.push('console ' + m.text()); });
  await page.goto(BASE + '/');
  await page.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 30000 });
  return { ctx, page, errors };
}
/* the people maps in a document (top-level svgs holding a person or an occluder), each: hidden?, its box, its references and whether they resolve inside it,
   the occluders' own boxes; and the ids that appear twice in that document */
const STATE = (root) => {
  const doc = root || document;
  const hiddenUp = (e) => { for (let n = e; n && n.nodeType === 1; n = n.parentNode) { const cs = getComputedStyle(n); if (n.hidden || cs.display === 'none' || cs.visibility === 'hidden') return true; } return false; };
  const maps = [...doc.querySelectorAll('svg')].filter((s) => (s.querySelector('.map-person') || s.querySelector('.map-occluder')) && !(s.parentNode && s.parentNode.closest && s.parentNode.closest('svg')) && !s.closest('.dp-ambient'));
  const seen = {}, dup = []; doc.querySelectorAll('[id]').forEach((e) => { if (e.closest('.dp-ambient')) return; if (seen[e.id]) dup.push(e.id); seen[e.id] = 1; });
  return { maps: maps.map((m) => {
    const bad = []; let uses = 0, drawn = 0;
    m.querySelectorAll('use').forEach((u) => { const h = u.getAttribute('href') || u.getAttribute('xlink:href') || ''; uses++; const t = h[0] === '#' ? doc.getElementById(h.slice(1)) : null; if (!t || !m.contains(t)) bad.push(h); });
    m.querySelectorAll('.map-occluder use').forEach((u) => { try { const b = u.getBBox(); if (b.width > 0 && b.height > 0) drawn++; } catch (e) { /* not drawn */ } });
    const r = m.getBoundingClientRect();
    return { hidden: hiddenUp(m), w: Math.round(r.width), h: Math.round(r.height), occ: m.querySelectorAll('.map-occluder').length, uses, bad: bad.slice(0, 3), nbad: bad.length, drawn };
  }), ndup: dup.length, dup: dup.slice(0, 3) };
};
const state = (page) => page.evaluate(STATE);
async function watch(page, ms, log) {
  const t0 = Date.now(); let last = null;
  while (Date.now() - t0 < ms) {
    last = await state(page);
    if (last.maps.length > 1) log.two = Math.max(log.two || 0, last.maps.length);
    if (last.maps.some((m) => m.hidden)) log.hidden.push(last.maps.map((m) => m.hidden));
    if (last.maps.length > 1 && last.ndup) log.dupWhileTwo = Math.max(log.dupWhileTwo || 0, last.ndup);
    await sleep(100);
  }
  return last;
}
const settled = (s, what, occWant) => {
  expect(s && s.maps.length === 1, what + ': one map copy after it settles, found ' + (s && s.maps.length));
  const m = s.maps[0];
  expect(!m.hidden && m.w > 100 && m.h > 100, what + ': the map is visible ' + JSON.stringify(m));
  expect(!s.ndup, what + ': no id twice in the document: ' + s.dup.join(', '));
  expect(!m.nbad, what + ': every reference resolves inside the map: ' + m.bad.join(', '));
  if (occWant) { expect(m.occ === occWant, what + ': every occluder arrived (' + m.occ + ' of ' + occWant + ')'); expect(m.drawn === m.occ, what + ': every occluder draws (' + m.drawn + ' of ' + m.occ + ')'); }
};
/* a grey thumbnail of the map's box, to compare with a freshly loaded page */
async function thumb(page) {
  const box = await page.evaluate(() => { const s = [...document.querySelectorAll('svg')].find((x) => x.querySelector('.map-person') && !x.closest('.dp-ambient') && !(x.parentNode.closest && x.parentNode.closest('svg'))); if (!s) return null; const r = s.getBoundingClientRect(); return { x: Math.max(0, r.left), y: Math.max(0, r.top), width: Math.min(innerWidth, r.right) - Math.max(0, r.left), height: Math.min(innerHeight, r.bottom) - Math.max(0, r.top) }; });
  if (!box || box.width < 10 || box.height < 10) return null;
  await page.addStyleTag({ content: '.dp-fs, .dp-hint, [class*="dp-hint"] { visibility: hidden !important; }' });      /* the page's own Full screen button and its one-time hint: not the map */
  const buf = await page.screenshot({ clip: box });
  return page.evaluate(async (b64) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = 160; c.height = 120; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 160, 120);
    const d = g.getImageData(0, 0, 160, 120).data, px = []; for (let i = 0; i < d.length; i += 4) px.push((d[i] + d[i + 1] + d[i + 2]) / 3); return px; }, buf.toString('base64'));
}
const mad = (a, b) => { let t = 0; for (let i = 0; i < a.length; i++) t += Math.abs(a[i] - b[i]); return t / a.length; };
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '-' + ENGINE + '.png') }); };

const ONLY = String(process.env.ONLY || '').split(',').filter(Boolean);      /* ONLY=classic,stage,players,board,pictures */
const want = (p) => !ONLY.length || ONLY.includes(p);
const CONFIGS = [['classic', {}, 'classic'], ['new stage', { stage: true }, 'stage'], ['players\' screen', { stage: true, players: true }, 'players']].filter((c) => want(c[2]));
try {
  /* ---------- a + b on the shared screen's map ---------- */
  for (const [cname, cf] of CONFIGS) {
    await settings(cf); await ambient({ mode: 'pin', scene: 'duskwall', overlay: null }); await push('blank');
    const I = await openIpad(1536, 864);
    if (cf.stage) await I.page.waitForFunction(() => (document.documentElement.getAttribute('data-kit') || '').includes('stage'), null, { timeout: 30000 });
    const log = { hidden: [] };
    await step('a/b ' + cname + ': the shaded map with people arrives whole (every <use> resolves inside it and draws)', async () => {
      await push('keyed-on'); settled(await watch(I.page, 6000, log), 'keyed', occ(MAPS['keyed-on'].svg));
    });
    const ref = await thumb(I.page);
    await step('a/b ' + cname + ': sent again as it is (the same ids): never a hidden copy, one copy after, still whole', async () => {
      await push('keyed-on', { caption: 'again' }); settled(await watch(I.page, 6000, log), 'again', occ(MAPS['keyed-on'].svg));
      expect(!log.hidden.length, 'a hidden copy: ' + JSON.stringify(log.hidden.slice(0, 3)));
    });
    await step('a/b ' + cname + ': keyed -> stage -> a room cut -> back to the map -> Blank -> the map again: each settles whole, never a hidden copy', async () => {
      await push('stage-on'); settled(await watch(I.page, 6000, log), 'stage', occ(MAPS['stage-on'].svg));
      await push('room-on'); const r = await watch(I.page, 6000, log); expect(r.maps.length <= 1 && !r.ndup, 'room cut: ' + JSON.stringify(r).slice(0, 200));
      await push('keyed-on'); settled(await watch(I.page, 6000, log), 'back', occ(MAPS['keyed-on'].svg));
      await push('blank'); await watch(I.page, 5000, log);
      await push('keyed-on'); settled(await watch(I.page, 6000, log), 'after Blank', occ(MAPS['keyed-on'].svg));
      expect(!log.hidden.length, 'a hidden copy: ' + JSON.stringify(log.hidden.slice(0, 3)));
      console.log('INFO ' + cname + ': at most ' + (log.two || 1) + ' map copies at once during the transitions' + (log.dupWhileTwo ? ', ' + log.dupWhileTwo + ' ids twice while two were up' : ''));
    });
    await step('b ' + cname + ': after all that, the map draws as a freshly loaded page draws it', async () => {
      await sleep(1500); const a = await thumb(I.page); await shot(I.page, 'flows-' + cname.replace(/\W+/g, '') + '-after');
      await I.page.reload(); await I.page.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 30000 });
      settled(await watch(I.page, 7000, { hidden: [] }), 'reloaded', occ(MAPS['keyed-on'].svg));
      await shot(I.page, 'flows-' + cname.replace(/\W+/g, '') + '-fresh');
      const b = await thumb(I.page), d = a && b ? mad(a, b) : 99, d0 = ref && b ? mad(ref, b) : 99;
      console.log('INFO ' + cname + ': mean grey difference from a fresh page ' + d.toFixed(2) + ' (first arrival ' + d0.toFixed(2) + ')');
      expect(d < 4, 'differs from a fresh page by ' + d.toFixed(2));
    });
    await push('blank');
    await step('a/b ' + cname + ': no page errors', async () => { expect(!I.errors.length, I.errors.slice(0, 3).join(' | ')); });
    await I.ctx.close();
  }

  /* ---------- a + b on the planning board (the score scene's message, the scene's own parser, a re-pin) ---------- */
  if (want('board')) {
  await settings({ stage: true, players: true }); await push('blank');
  const B1 = board(true, ['Back by nine']), B2 = board(true, ['Back by nine', 'The side door sticks']);
  const I = await openIpad(1536, 864);
  const frame = async () => { const h = await I.page.waitForSelector('.dp-ambient iframe.dp-amb-in[data-scene="board"]', { timeout: 30000 }); return h.contentFrame(); };
  const boardState = (f) => f.evaluate(() => {
    const c = document.getElementById('content'), seen = {}, dup = [];
    document.querySelectorAll('[id]').forEach((e) => { if (seen[e.id]) dup.push(e.id); seen[e.id] = 1; });
    const bad = []; let uses = 0; (c ? c.querySelectorAll('use') : []).forEach((u) => { const h = u.getAttribute('href') || u.getAttribute('xlink:href') || ''; uses++; if (!(h[0] === '#' && document.getElementById(h.slice(1)))) bad.push(h); });
    return { nested: c ? c.querySelectorAll('svg').length : 0, uses, nbad: bad.length, bad: bad.slice(0, 3), ndup: dup.length, dup: dup.slice(0, 3) };
  });
  await step('a planning board: the shaded board and exploded site go through the server, cleanScore, scoreMessage and the scene\'s parser, references whole', async () => {
    await ambient({ score: B1 }); await ambient({ mode: 'pin', scene: 'board', overlay: null });
    const f = await frame(); await f.waitForFunction(() => { const c = document.getElementById('content'); return !!(c && c.querySelectorAll('svg').length >= 2); }, null, { timeout: 30000 });
    await sleep(4000); const s = await boardState(f);
    expect(s.nested >= 2 && !s.nbad && !s.ndup, JSON.stringify(s));
    await shot(I.page, 'board-pinned-1536x864-on');
  });
  await step('b planning board: pinned again (a second pin): the scene tears down before it draws, never two copies with the same ids', async () => {
    const f = await frame(); let worst = 0;
    await ambient({ score: B2 });
    for (let i = 0; i < 60; i++) { const s = await boardState(f); worst = Math.max(worst, s.ndup); await sleep(100); }
    const s = await boardState(f); expect(!worst && !s.nbad && s.nested >= 2, 'worst ' + worst + ' ' + JSON.stringify(s));
  });
  await step('a the planning board\'s own parser (its source, run in the scene) keeps a shaded people map\'s occluders whole', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'app', 'ambient', 'planning-board.html'), 'utf8'), i = src.indexOf('function parseSvg('), fn = src.slice(i, src.indexOf('\n}\n', i) + 2);
    expect(i > 0 && fn.length > 200, 'parseSvg found');
    const f = await frame();
    const r = await f.evaluate(({ fn, svg }) => {
      const parseSvg = new Function('MAX', fn + '\nreturn parseSvg;')(8e6), node = parseSvg(svg); if (!node) return null;
      const box = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); box.setAttribute('style', 'position:fixed;left:0;top:0;width:800px;height:600px'); box.appendChild(node); document.body.appendChild(box);
      let uses = 0, bad = 0, drawn = 0; node.querySelectorAll('use').forEach((u) => { uses++; const h = u.getAttribute('href') || ''; const t = h[0] === '#' ? document.getElementById(h.slice(1)) : null; if (!t || !node.contains(t)) bad++; });
      node.querySelectorAll('.map-occluder use').forEach((u) => { const b = u.getBBox(); if (b.width > 0) drawn++; });
      const occ = node.querySelectorAll('.map-occluder').length; box.remove(); return { uses, bad, drawn, occ };
    }, { fn, svg: MAPS['keyed-on'].svg });
    expect(r && r.occ === occ(MAPS['keyed-on'].svg) && !r.bad && r.drawn === r.occ, JSON.stringify(r));
  });
  await ambient({ mode: 'pin', scene: 'duskwall', overlay: null });
  await step('planning board: no page errors', async () => { expect(!I.errors.length, I.errors.slice(0, 3).join(' | ')); });
  await I.ctx.close();
  }

  /* ---------- the pictures: the players' screen, setting off and on, at the iPad's and a laptop's size ---------- */
  if (SHOTS && want('pictures')) {
    for (const [w, h] of [[1180, 820], [1536, 864]]) {
      const J = await openIpad(w, h);
      await J.page.waitForFunction(() => (document.documentElement.getAttribute('data-kit') || '').includes('stage'), null, { timeout: 30000 });
      for (const k of ['keyed', 'stage', 'room']) for (const on of ['off', 'on']) { await push(k + '-' + on); await sleep(5500); await shot(J.page, k + '-' + w + 'x' + h + '-' + on); }
      await push('blank');
      for (const on of [false, true]) { await ambient({ score: board(on, ['Back by nine', 'The side door sticks']) }); await ambient({ mode: 'pin', scene: 'board', overlay: null }); await sleep(9000); await shot(J.page, 'board-' + w + 'x' + h + '-' + (on ? 'on' : 'off')); await ambient({ mode: 'pin', scene: 'duskwall', overlay: null }); await sleep(1500); }
      await J.ctx.close();
    }
    console.log('INFO pictures in ' + SHOTS);
  }
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
await browser.close();
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
