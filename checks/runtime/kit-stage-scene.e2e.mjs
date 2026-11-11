// kit-stage-scene (the new stage: clocks, the NPC and the map, KS16 of the kit and stage build: S5, S6, S8), end to end against a real local
// Worker (wrangler dev) on PORT (default 9414; the inspector on PORT + 20000), with invented fixtures only. The iPad (a DISPLAY_EMAILS sign-in)
// opens the display; the GM turns kit.stage on, shows and ticks a clock, pushes an NPC, holds a spotlight, plays the spotlight beat, publishes
// the mission's band and pushes a map, then turns the setting off again.
//   S5   a shown clock grows to the centre (about 2 s), then docks on a plate at the foot right ("Last tram", "3 of 8"); a tick grows again with
//        the NEW segments in red, then docks; an untick just redraws the dock; the mission's alarm docks on the idle stage and its tick is red
//        for 2 s; a hidden clock is never sent and never drawn, and hiding a shown one takes it down
//   S6   a pushed NPC stands over the DIMMED scene (the scene stays up, the stage is see-through), a nameplate (role and place, the name, one
//        line) with a faction stripe; the held spotlight (the npc overlay) and the spotlight beat are a timed "Speaking" bar with its timer;
//        the hidden fixture NPC (GM-ONLY-NPC-1) cannot be shown by any of the three: never in the display GET, never in the DOM
//   S8   a map that names itself fills the screen (at least 90% of the height at 1024x768) and the band is a lower-third plate over it, the
//        alarm beside it; a captioned drawing keeps its caption dock under it with the band's row in it
//   every plate: inside the inner 90%, every line at least 3.3% of the screen's height, 4.5:1 on an opaque ground, Night and Paper
//   off: the old band beside the map and the old clock card, no ks16 node; the display makes no request outside its own origin
// KIT_SHOTS=<dir> saves the pictures (<view>-<theme>-<width>.png).
//   PW_MODULE=<path to playwright-core> [PW_CHANNEL=msedge] [PORT=9414] [KIT_SHOTS=<dir>] node checks/runtime/kit-stage-scene.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9414);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const SHOTS = process.env.KIT_SHOTS || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

let failed = 0, passed = 0;
async function step(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.message || e)); } }
const expect = (c, m) => { if (!c) throw new Error(m); };

/* ---------- no browser: the files' own rules and the pure parts ---------- */
const SRC = readFileSync(path.join(ROOT, 'app', 'display', 'kit', 'scene.js'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'app', 'display', 'kit', 'scene.css'), 'utf8');
await step('scene.js: no markup sink, no request, no hand-built button; scene.css: every rule under the stage token, no important flag, no mangled punctuation', async () => {
  const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  expect(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment/.test(code), 'a markup sink in scene.js');
  expect(!/fetch\(|XMLHttpRequest|\.src\s*=|sendBeacon|WebSocket/.test(code), 'a request in scene.js');
  expect(!/<button/.test(code), 'a hand-built button in scene.js');
  const rules = CSS.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '').replace(/@media[^{]+\{/g, '');
  const sels = (rules.match(/[^{}]+\{/g) || []).map((s) => s.slice(0, -1).trim()).filter(Boolean);
  expect(sels.length > 20, 'the sheet has its rules: ' + sels.length);
  for (const s of sels) for (const one of s.split(',')) expect(one.trim().startsWith(':root[data-kit~="stage"]'), 'a rule outside the stage token: ' + one.trim());
  expect(!/!\s*important/i.test(CSS), 'an important flag in scene.css');
  expect(!/@layer/.test(CSS), 'a layer in scene.css');
  expect(!/[\u0080-\u009f]/.test(CSS) && !/[\u0080-\u009f]/.test(SRC), 'a character in U+0080 to U+009F');
});
await step('B68StageScene.Pure: the faction stripe, the one line, the count, the new segments, the countdown, the band\'s words', async () => {
  globalThis.B68FaceLook = require(path.join(ROOT, 'app', 'display', 'face-look.js'));
  const P = require(path.join(ROOT, 'app', 'display', 'kit', 'scene.js')).Pure;
  const e1 = P.edge('The Kestrel Club'), e2 = P.edge('the kestrel club'), e3 = P.edge('The Tidewater Watch');
  expect(/^faction-[1-6]$/.test(e1) && e1 === P.edge('The Kestrel Club') && P.edge('') === '' && /^faction-[1-6]$/.test(e3), 'one stripe per faction: ' + [e1, e2, e3]);
  expect(e1 === 'faction-' + globalThis.B68FaceLook.slotOf('The Kestrel Club'), 'the same slot as the face looks');
  expect(P.kicker('Fixer', 'The Kestrel Club') === 'Fixer · The Kestrel Club' && P.kicker('', 'The Kestrel Club') === 'The Kestrel Club' && P.kicker('', '') === '', 'role and place');
  expect(P.oneLine({ alias: 'Mab', description: 'Counts the room twice.' }).text === '“Mab”' && P.oneLine({ alias: 'Mab' }).alias === true, 'the alias in quotes');
  expect(P.oneLine({ description: 'Counts the room twice. Then once more for luck.' }).text === 'Counts the room twice.', 'the first sentence');
  const long = P.oneLine({ description: 'word '.repeat(60) }).text;
  expect(long.length <= 140 && long.endsWith('…'), 'a long line is cut at a word: ' + long.length);
  expect(P.oneLine({}).text === '', 'nothing to say');
  expect(P.count(3, 8) === '3 of 8', 'n of m');
  expect(JSON.stringify(P.fresh('3', 5, 8)) === '[3,4]' && P.fresh('5', 4, 8).length === 0 && P.fresh(null, 3, 8).length === 0 && JSON.stringify(P.fresh(0, 9, 8)) === '[0,1,2,3,4,5,6,7]', 'the new segments');
  expect(P.timer({ left: 90, endsAt: 1000 + 90000 }, 1000, 0).text === '1:30' && P.timer({ left: 90, endsAt: 1000 + 90000 }, 1000, 30000).text === '1:00' && P.timer({ left: 75, paused: true }, 0, 0).state === 'paused' && P.timer({ left: 30, endsAt: 30000 }, 0, 0).state === 'warn', 'the countdown, corrected by the skew');
  const w = P.bandWords({ time: '21:14', label: 'Gala night', now: [{ text: 'The band plays', where: 'The floor', until: '' }], next: [{ text: 'The band takes five', where: '', at: '21:30', inText: 'in 16 min', soon: false }], alarm: { name: 'Alarm', size: 6, filled: 2 }, crew: [{ name: 'Nell Arbuthnot', room: 'Cloakroom' }], ways: 'Ways found: 1 of 3', night: null, timer: null });
  expect(w.kicker === '21:14 · Gala night' && w.title === 'Now: The band plays · The floor' && w.line === 'Next: The band takes five · 21:30 · in 16 min' && w.crew === 'Nell Arbuthnot · Cloakroom' && w.ways === 'Ways found: 1 of 3' && w.alarm.name === 'Alarm', 'the band\'s words: ' + JSON.stringify(w));
  expect(P.bandWords(null) === null && P.bandWords({ now: [], next: [], crew: [] }) === null, 'no band, no plate');
  const onlyAlarm = P.bandWords({ now: [], next: [], crew: [], alarm: { name: 'Alarm', size: 4, filled: 1 } });
  expect(onlyAlarm && onlyAlarm.text === false && onlyAlarm.alarm, 'the alarm alone: no plate, the dock');
  delete globalThis.B68FaceLook;
});

/* ---------- the browser run ---------- */
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-kit-scene-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
delete env.ANTHROPIC_API_KEY; delete env.B68_ANTHROPIC_KEY;
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

let up = false;
for (let i = 0; i < 180 && !up; i++) { try { up = (await fetch(BASE + '/index.html', { signal: AbortSignal.timeout(2000) })).status > 0; } catch (_) {} if (!up) await sleep(500); }
if (!up) { console.log('FAIL server did not start'); process.exit(1); }

const call = (user, method, p, body) => fetch(BASE + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const gm = (method, p, body) => call(GM, method, p, body);
const ok = async (pr, what) => { const r = await pr; if (r.status !== 200) throw new Error(what + ': ' + r.status + ' ' + JSON.stringify(r.json).slice(0, 160)); return r.json; };
const push = (doc) => ok(gm('PUT', '/api/gm/display', doc), 'push ' + doc.kind);
const ambient = (patch) => gm('PATCH', '/api/gm/ambient', patch);
const overlay = async (o) => { const r = await ambient({ overlay: o }); return r.status; };
const setting = (on) => ok(gm('PATCH', '/api/campaign', { features: { 'kit.stage': on } }), 'kit.stage ' + on);
/* the display's own GET, as the iPad: what a hidden thing must never be in */
const ipadGet = async () => JSON.stringify((await call(IPAD, 'GET', '/api/gm/display?seq=-1&aseq=-1&hseq=-1')).json);

/* invented fixtures: a visible clock and a hidden one; two revealed people and a hidden one */
const CLOCKS = (tram, hiddenTram = false) => [{ id: 'c-tram', name: 'Last tram', size: 8, filled: tram, kind: 'progress', hidden: hiddenTram },
  { id: 'c-hid', name: 'GM-ONLY-CLOCK-1', size: 6, filled: 2, kind: 'danger', hidden: true }];
const clocks = (tram, hiddenTram) => ok(gm('PATCH', '/api/campaign', { clocks: CLOCKS(tram, hiddenTram), updatedAt: new Date().toISOString() }), 'clocks');
const NPCS = [
  ['n-mabel', { name: 'Mabel Quist', alias: 'Mab', role: 'Fixer', faction: 'The Kestrel Club', description: 'Counts the room twice. Then once more.', revealed: true,
    spec: { figure: 'fem', skin: 'porcelain', heightIn: 66, age: 47, hair: { style: 'beehive', color: 'cloth-chocolate' }, outfit: { base: { type: 'shirt', color: 'cloth-white' }, outer: { type: 'double-breasted', color: 'cloth-oxblood' } } } }],
  ['n-dov', { name: 'Dov Kessler', alias: '', role: 'Desk sergeant', faction: 'The Tidewater Watch', description: 'Watches the doors.', revealed: true,
    spec: { skin: 'tan', heightIn: 74, age: 44, hair: { style: 'buzz', color: 'cloth-graphite' }, outfit: { outer: { type: 'peacoat', color: 'cloth-charcoal' } } } }],
  ['n-hid', { name: 'GM-ONLY-NPC-1', alias: 'GM-ONLY-ALIAS-1', role: 'GM-ONLY-ROLE-1', faction: 'GM-ONLY-FACTION-1', description: 'GM-ONLY-DESC-1', gmNotes: 'GM-ONLY-NOTES', revealed: false, spec: { heightIn: 70, age: 40 } }]
];
let mseq = 0;
const HUD = (filled, more = {}) => ({ time: '21:14', showTime: true, label: 'Gala night', now: [{ text: 'The band plays the long set', where: 'The floor' }],
  next: [{ text: 'The band takes five', at: '21:30', inMin: 16 }, { text: 'The doors close', at: '22:40', inMin: 86 }], alarm: { name: 'Alarm', size: 6, filled, text: '' },
  crew: [{ name: 'Nell Arbuthnot', room: 'Cloakroom' }, { name: 'Ray Okonjo', room: 'The floor' }, { name: 'Tam Petrakis', room: 'The bar' }], ...more });
const mission = (filled, more) => ok(gm('PATCH', '/api/campaign', { mission: filled === null ? null : { v: 1, site: 'The Pelican Rooms', t: 90, seq: ++mseq, hud: HUD(filled, more) } }), 'mission');
/* a map that names itself (the map kit's do: a <title> first), and a captioned drawing that does not */
const MAP = { kind: 'svg', title: 'The Pelican Rooms', caption: '', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><title>The Pelican Rooms, ground floor</title><rect x="10" y="10" width="780" height="580" fill="#1d2a44" stroke="#e8c33c" stroke-width="6"/><rect x="60" y="60" width="300" height="200" fill="#2f4f7a"/><rect x="420" y="300" width="300" height="220" fill="#7a4f2f"/></svg>' };
const DRAWING = { kind: 'svg', title: 'Clocks', caption: 'The clocks on the table', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect x="10" y="10" width="380" height="280" fill="#223" stroke="#eee" stroke-width="4"/></svg>' };
const SIZES = [[1024, 768], [1180, 820], [768, 1024]];

async function openIpad(browser, o = {}) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: o.w || 1024, height: o.h || 768 }, reducedMotion: o.reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  await page.addInitScript((a) => {
    try {
      if (window !== window.top) return;
      localStorage.setItem('b68.display.ambientTiming', JSON.stringify({ wireOnMs: 30000, wireGapMs: 600000, wireFirstMs: 600000 }));
      if (a.theme) localStorage.setItem('b68.theme', a.theme);
    } catch (e) { /* no storage */ }
  }, { theme: o.theme || '' });
  const seen = { requests: [], errors: [] };
  page.on('request', (r) => seen.requests.push(r.url()));
  page.on('pageerror', (e) => seen.errors.push(String(e && e.message || e)));
  await page.goto(BASE + '/');
  await page.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 20000 });
  return { ctx, page, seen };
}
const frameOn = (page, ms = 30000) => page.waitForFunction(() => !!document.querySelector('.dp-root .stage-frame') && !!window.B68StageScene && /(^|\s)stage(\s|$)/.test(document.documentElement.getAttribute('data-kit') || ''), null, { timeout: ms });
const sceneIn = (page) => page.waitForFunction(() => { const f = document.querySelector('.dp-ambient iframe.dp-amb-in'); return !!f && !!f.contentDocument && f.contentDocument.readyState === 'complete'; }, null, { timeout: 40000 });
const plateMeasure = (sel) => {
  const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number).slice(0, 3).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
  const p = typeof sel === 'string' ? document.querySelector(sel) : null; if (!p) return null;
  const r = p.getBoundingClientRect(), bg = getComputedStyle(p).backgroundColor, W = innerWidth, H = innerHeight;
  const alpha = (bg.match(/[\d.]+/g) || []).map(Number)[3];
  let minPx = 999, minRatio = 99; const texts = [];
  for (const n of p.querySelectorAll('.ui-slot, .ks16-crew, .ks16-ways')) {
    if (!n.textContent.trim() || getComputedStyle(n).display === 'none') continue;
    const cs = getComputedStyle(n), px = parseFloat(cs.fontSize), nb = getComputedStyle(n).backgroundColor, na = (nb.match(/[\d.]+/g) || []).map(Number)[3];
    const ground = na === 0 ? bg : nb;
    minPx = Math.min(minPx, px); texts.push((n.getAttribute('data-ui-slot') || n.className) + ':' + px.toFixed(1));
    const a = lum(cs.color) + 0.05, b = lum(ground) + 0.05; minRatio = Math.min(minRatio, Math.max(a, b) / Math.min(a, b));
  }
  return { l: r.left, t: r.top, r: r.right, b: r.bottom, W, H, minPx, minRatio, texts, opaque: alpha === undefined || alpha === 1, text: p.innerText };
};
const inside90 = (m) => m.l >= 0.05 * m.W - 1 && m.r <= 0.95 * m.W + 1 && m.b <= 0.95 * m.H + 1 && m.t >= 0.05 * m.H - 1;
function judgePlate(m, what) {
  expect(m, what + ': no plate');
  expect(inside90(m), what + ': outside the inner 90%: ' + JSON.stringify({ l: m.l, t: m.t, r: m.r, b: m.b, W: m.W, H: m.H }));
  expect(m.minPx >= 0.033 * m.H - 0.01, what + ': text under 3.3% of the height (' + (0.033 * m.H).toFixed(1) + ' px): ' + m.texts.join(' '));
  expect(m.minRatio >= 4.5, what + ': contrast on the plate ' + m.minRatio.toFixed(2));
  expect(m.opaque, what + ': the plate is not opaque');
}
/* the map's drawn box (the svg is fitted, meet, centred) against the plates over it */
const mapCover = () => {
  const st = document.querySelector('.dp-stage.dp-map.dp-in'), svg = st.querySelector('.dp-map-frame svg'), r = svg.getBoundingClientRect();
  const vb = (svg.getAttribute('data-vb') || '0 0 1 1').split(/\s+/).map(Number), k = Math.min(r.width / vb[2], r.height / vb[3]);
  const d = { l: r.left + (r.width - vb[2] * k) / 2, t: r.top + (r.height - vb[3] * k) / 2 }; d.r = d.l + vb[2] * k; d.b = d.t + vb[3] * k;
  const area = (d.r - d.l) * (d.b - d.t); let cov = 0, top = innerHeight;
  for (const p of st.querySelectorAll('.ks16-mapfoot > .stage-plate')) {
    const q = p.getBoundingClientRect(); top = Math.min(top, q.top);
    cov += Math.max(0, Math.min(q.right, d.r) - Math.max(q.left, d.l)) * Math.max(0, Math.min(q.bottom, d.b) - Math.max(q.top, d.t));
  }
  const bp = st.querySelector('.ks16-bandplate').getBoundingClientRect();
  return { kept: 1 - cov / area, drawnH: (d.b - d.t) / innerHeight, plateH: bp.height / innerHeight, footTop: top / innerHeight };
};
const running = (page) => page.evaluate(() => (document.getAnimations ? document.getAnimations() : []).filter((a) => a.playState === 'running').map((a) => (a.animationName || a.transitionProperty || 'anim') + '@' + ((a.effect && a.effect.target && a.effect.target.className) || '').toString().slice(0, 50)));
const domHas = (page, needle) => page.evaluate((n) => document.documentElement.outerHTML.includes(n), needle);
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); }

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
let I = null;
try {
  for (const [id, doc] of NPCS) await ok(gm('PUT', '/api/npcs/' + id, { ...doc, firstSeen: new Date().toISOString(), tags: [] }), 'npc ' + id);
  await clocks(3);
  await push({ kind: 'blank' });
  await ambient({ mode: 'pin', scene: 'duskwall', overlay: null });
  await setting(true);

  I = await openIpad(browser);
  await frameOn(I.page); await sceneIn(I.page);

  /* ---------------- S5: clocks with names ---------------- */
  await step('S5: a shown clock grows to the centre, its name and "3 of 8", then docks on a plate at the foot right', async () => {
    await I.page.evaluate(() => { window.__ph = []; new MutationObserver(() => { const n = document.querySelector('.ks16-clock'); if (n) window.__ph.push(n.getAttribute('data-ks16-phase')); }).observe(document.querySelector('.dp-overlay'), { attributes: true, subtree: true, childList: true, attributeFilter: ['data-ks16-phase'] }); });
    expect((await overlay({ id: 'ov-tram', kind: 'clock', clockId: 'c-tram', ms: 120000 })) === 200, 'the overlay');
    await I.page.waitForSelector('.dp-ov-card.dp-ov-clock.ks16-clock[data-ks16-phase="grow"]', { timeout: 20000 });
    await sleep(500);
    const g = await I.page.evaluate(() => {
      const p = document.querySelector('.ks16-clock .ks16-grow'), r = p.getBoundingClientRect(), f = p.querySelector('.ui-clock').getBoundingClientRect();
      return { cx: (r.left + r.right) / 2 / innerWidth, cy: (r.top + r.bottom) / 2 / innerHeight, face: f.height / innerHeight, name: p.querySelector('.dp-ov-name').textContent, count: p.querySelector('.dp-ov-count').textContent,
        news: p.querySelectorAll('.ks16-new').length, on: p.querySelectorAll('.dp-ov-seg.dp-ov-seg-on').length, wedges: p.querySelectorAll('.dp-ov-seg').length, dock: getComputedStyle(document.querySelector('.ks16-clock .ks16-dock')).display, id: document.querySelector('.ks16-clock').getAttribute('data-ov-id') };
    });
    expect(Math.abs(g.cx - 0.5) < 0.03 && Math.abs(g.cy - 0.5) < 0.05 && g.face >= 0.3, 'the grow is big and in the centre: ' + JSON.stringify(g));
    expect(g.name === 'Last tram' && g.count === '3 of 8' && g.on === 3 && g.wedges === 8 && g.news === 0 && g.dock === 'none' && g.id === 'ov-tram', 'the grow says it, no new segment on a first sight, the old hooks kept: ' + JSON.stringify(g));
    await shot(I.page, 'clock-grow-night-1024');
    await I.page.waitForFunction(() => document.querySelector('.ks16-clock').getAttribute('data-ks16-phase') === 'dock', null, { timeout: 4000 });
    const ph = await I.page.evaluate(() => window.__ph.slice());
    expect(ph.indexOf('grow') >= 0 && ph.lastIndexOf('dock') > ph.indexOf('grow'), 'the grow, then the dock: ' + ph.join(','));
    const d = await I.page.evaluate(() => { const p = document.querySelector('.ks16-clock .ks16-dock'), r = p.getBoundingClientRect(); return { right: r.right / innerWidth, bottom: r.bottom / innerHeight, left: r.left / innerWidth, grow: getComputedStyle(document.querySelector('.ks16-clock .ks16-grow')).display, text: p.innerText.replace(/\s+/g, ' '), role: p.getAttribute('role') }; });
    expect(d.right > 0.9 && d.bottom > 0.9 && d.left > 0.5 && d.grow === 'none' && /Last tram/i.test(d.text) && /3 of 8/.test(d.text) && d.role === 'status', 'docked at the foot right: ' + JSON.stringify(d));
    judgePlate(await I.page.evaluate(plateMeasure, '.ks16-clock .ks16-dock'), 'the docked clock');
    await sleep(600);
    const a = await running(I.page);
    expect(a.length === 0, 'nothing moves once docked: ' + a.join(', '));
    await shot(I.page, 'clock-dock-night-1024');
  });

  await step('S5: a tick grows again with the new segments in red, then docks at "5 of 8"; an untick just redraws the dock', async () => {
    await clocks(5);
    await I.page.waitForSelector('.ks16-clock[data-ks16-phase="grow"] .ks16-grow .ks16-new', { timeout: 20000 });
    const t = await I.page.evaluate(() => {
      const p = document.querySelector('.ks16-clock .ks16-grow'), news = [...p.querySelectorAll('.ui-wedge')].map((w, i) => (w.classList.contains('ks16-new') ? i : -1)).filter((i) => i >= 0);
      const red = getComputedStyle(p.querySelector('.ks16-new')).fill, plain = getComputedStyle(p.querySelector('.ui-wedge.is-on:not(.ks16-new)')).fill;
      const probe = document.createElement('span'); probe.style.color = 'var(--ui-alarm)'; document.querySelector('.dp-root').appendChild(probe); const alarm = getComputedStyle(probe).color; probe.remove();
      return { news, red, plain, alarm, count: p.querySelector('.dp-ov-count').textContent, nodes: document.querySelectorAll('.ks16-clock').length };
    });
    expect(JSON.stringify(t.news) === '[3,4]' && t.red === t.alarm && t.red !== t.plain && t.count === '5 of 8' && t.nodes === 1, 'two new segments, in the alarm red: ' + JSON.stringify(t));
    await shot(I.page, 'clock-tick-night-1024');
    await I.page.waitForFunction(() => document.querySelector('.ks16-clock').getAttribute('data-ks16-phase') === 'dock', null, { timeout: 4000 });
    await clocks(4);
    await I.page.waitForFunction(() => { const c = document.querySelector('.ks16-clock .ks16-dock .dp-ov-count'); return c && c.textContent === '4 of 8'; }, null, { timeout: 20000 });
    const u = await I.page.evaluate(() => ({ phase: document.querySelector('.ks16-clock').getAttribute('data-ks16-phase'), grow: !!document.querySelector('.ks16-clock .ks16-grow') }));
    expect(u.phase === 'dock' && !u.grow, 'an untick is no grow: ' + JSON.stringify(u));
  });

  await step('S5: hiding the shown clock takes it down; the hidden fixture clock is never sent and never drawn', async () => {
    await clocks(4, true);
    await I.page.waitForFunction(() => !document.querySelector('.ks16-clock'), null, { timeout: 20000 });
    await overlay({ id: 'ov-hid', kind: 'clock', clockId: 'c-hid', ms: 60000 });      /* the server may take it; it never serves it */
    await sleep(6000);
    const get = await ipadGet();
    expect(!get.includes('GM-ONLY-CLOCK') && !get.includes('c-hid'), 'the display GET holds the hidden clock: ' + get.slice(0, 300));
    expect(!(await I.page.evaluate(() => !!document.querySelector('.ks16-clock, .dp-ov-clock'))) && !(await domHas(I.page, 'GM-ONLY-CLOCK')), 'a hidden clock drawn');
    await overlay(null); await clocks(3);
  });

  await step('S5: the mission\'s alarm docks on the idle stage at the foot right; a tick is red for about 2 seconds', async () => {
    await mission(2);
    await I.page.waitForSelector('.stage-slot-clocks .ks16-alarm', { timeout: 20000 });
    const v = await I.page.evaluate(() => { const p = document.querySelector('.stage-slot-clocks .ks16-alarm'); return { text: p.innerText.replace(/\s+/g, ' '), idle: document.querySelector('.dp-root').classList.contains('stage-idle-on'), vis: getComputedStyle(document.querySelector('.stage-slot-clocks')).visibility }; });
    expect(/Alarm/i.test(v.text) && /2 of 6/.test(v.text) && v.idle && v.vis === 'visible', 'the alarm docked: ' + JSON.stringify(v));
    judgePlate(await I.page.evaluate(plateMeasure, '.stage-slot-clocks .ks16-alarm'), 'the docked alarm');
    await shot(I.page, 'idle-alarm-night-1024');
    await mission(3);
    await I.page.waitForSelector('.stage-slot-clocks .ks16-alarm[data-ks16-ticked] .ks16-new', { timeout: 20000 });
    expect((await I.page.evaluate(() => document.querySelectorAll('.stage-slot-clocks .ks16-alarm .ks16-new').length)) === 1, 'one new segment');
    await I.page.waitForFunction(() => !document.querySelector('.stage-slot-clocks .ks16-alarm[data-ks16-ticked]'), null, { timeout: 4000 });
    await mission(null);
    await I.page.waitForFunction(() => !document.querySelector('.stage-slot-clocks .ks16-alarm'), null, { timeout: 20000 });
  });

  /* ---------------- S6: the NPC and who is speaking ---------------- */
  await step('S6: a pushed NPC stands over the dimmed scene with a nameplate (role and place, the name, one line) and a faction stripe', async () => {
    await push({ kind: 'npc', npcId: 'n-mabel' });
    await I.page.waitForSelector('.dp-stage.dp-npc.ks16-npc.dp-in .ks16-nameplate', { timeout: 20000 });
    await sleep(800);
    const v = await I.page.evaluate(() => {
      const st = document.querySelector('.dp-stage.dp-npc.ks16-npc.dp-in'), p = st.querySelector('.ks16-nameplate'), bg = getComputedStyle(st).backgroundColor;
      const f = document.querySelector('.dp-ambient iframe.dp-amb-in'), fig = st.querySelector('.dp-npc-fig svg'), fr = fig && fig.getBoundingClientRect(), pr = p.getBoundingClientRect();
      return { kicker: p.querySelector('.dp-kicker').textContent, name: p.querySelector('.dp-npc-name').textContent, line: p.querySelector('[data-ui-slot="line"]').textContent, alias: !!p.querySelector('.dp-npc-alias'),
        edge: (p.className.match(/ui-edge-(faction-\d)/) || [])[1] || '', alpha: (bg.match(/[\d.]+/g) || []).map(Number)[3], scene: !!f, covered: window.B68DisplayPage.ambient.state().covered,
        figH: fr ? fr.height / innerHeight : 0, overlap: fr ? !(fr.left >= pr.right - 2 || fr.bottom <= pr.top + 2) : null, txt: st.innerText };
    });
    expect(v.kicker === 'Fixer · The Kestrel Club' && v.name === 'Mabel Quist' && v.line === '“Mab”' && v.alias, 'the nameplate: ' + JSON.stringify(v));
    expect(/^faction-[1-6]$/.test(v.edge), 'a faction stripe: ' + v.edge);
    expect(v.scene && v.covered === false && v.alpha > 0 && v.alpha < 1, 'over the dimmed scene, not on black: ' + JSON.stringify({ scene: v.scene, covered: v.covered, alpha: v.alpha }));
    expect(v.figH >= 0.6 && v.overlap === false, 'the figure stands tall beside the plate: ' + JSON.stringify({ figH: v.figH, overlap: v.overlap }));
    expect(!/Then once more/.test(v.txt), 'one line, not the description');
    for (const [w, h] of SIZES) {
      await I.page.setViewportSize({ width: w, height: h }); await sleep(500);
      judgePlate(await I.page.evaluate(plateMeasure, '.ks16-npc.dp-in .ks16-nameplate'), 'nameplate ' + w + 'x' + h);
      await shot(I.page, 'npc-night-' + w);
    }
    await I.page.setViewportSize({ width: 1024, height: 768 });
  });

  await step('S6: an NPC with no alias gets the description\'s first sentence; the stripe follows the faction', async () => {
    await push({ kind: 'npc', npcId: 'n-dov' });
    await I.page.waitForFunction(() => { const n = document.querySelector('.ks16-npc.dp-in .dp-npc-name'); return n && n.textContent === 'Dov Kessler'; }, null, { timeout: 20000 });
    const v = await I.page.evaluate(() => { const p = document.querySelector('.ks16-npc.dp-in .ks16-nameplate'); return { line: p.querySelector('[data-ui-slot="line"]').textContent, desc: !!p.querySelector('.dp-npc-desc'), kicker: p.querySelector('.dp-kicker').textContent }; });
    expect(v.line === 'Watches the doors.' && v.desc && v.kicker === 'Desk sergeant · The Tidewater Watch', JSON.stringify(v));
  });

  await step('S6: the hidden fixture NPC cannot be shown: not pushed, not held, not as a beat; never in the display GET or the DOM', async () => {
    await gm('PUT', '/api/gm/display', { kind: 'npc', npcId: 'n-hid' });
    await sleep(6000);
    expect(!(await I.page.evaluate(() => !!document.querySelector('.ks16-nameplate'))), 'a nameplate for the hidden NPC');
    const get1 = await ipadGet();
    expect(!/GM-ONLY/.test(get1), 'the display GET after the push: ' + get1.slice(0, 300));
    await overlay({ id: 'ov-hid-npc', kind: 'npc', npcId: 'n-hid', ms: 60000 });
    await sleep(6000);
    expect(!(await I.page.evaluate(() => !!document.querySelector('.ks16-speak'))), 'a speaking bar for the hidden NPC');
    const st = await overlay({ id: 'ov-hid-spot', kind: 'spotlight', ms: 8000, payload: { npcId: 'n-hid' } });
    await sleep(5000);
    expect(!(await I.page.evaluate(() => !!document.querySelector('.ks16-speak, .dp-show-spotlight'))), 'a spotlight beat for the hidden NPC (status ' + st + ')');
    const get2 = await ipadGet();
    expect(!/GM-ONLY/.test(get2), 'the display GET after the overlays: ' + get2.slice(0, 300));
    expect(!(await domHas(I.page, 'GM-ONLY')), 'GM-ONLY text in the DOM');
    await overlay(null);
    await push({ kind: 'blank' });
  });

  await step('S6: SPOTLIGHT (the held portrait) is a timed "who\'s speaking" bar: the head, Speaking, the name, role and place, the timer', async () => {
    expect((await overlay({ id: 'ov-spot', kind: 'npc', npcId: 'n-dov', ms: 180000 })) === 200, 'the hold');
    await I.page.waitForSelector('.dp-ov-card.dp-ov-npc.ks16-speak .ks16-speakplate', { timeout: 20000 });
    await sleep(1200);
    const v = await I.page.evaluate(() => {
      const n = document.querySelector('.ks16-speak'), p = n.querySelector('.ks16-speakplate');
      return { kicker: p.querySelector('[data-ui-slot="kicker"]').textContent, name: p.querySelector('.dp-ov-name').textContent, line: p.querySelector('[data-ui-slot="line"]').textContent,
        timer: p.querySelector('[data-ui-slot="timer"]').textContent, timed: p.hasAttribute('data-stage-timed'), head: !!n.querySelector('.dp-ov-portrait.ks16-head svg'), edge: /ui-edge-faction-\d/.test(p.className) };
    });
    expect(v.kicker === 'Speaking' && v.name === 'Dov Kessler' && v.line === 'Desk sergeant · The Tidewater Watch' && /^[23]:\d\d$/.test(v.timer) && v.timed && v.head && v.edge, 'the bar: ' + JSON.stringify(v));
    for (const [w, h] of SIZES) {
      await I.page.setViewportSize({ width: w, height: h }); await sleep(500);
      judgePlate(await I.page.evaluate(plateMeasure, '.ks16-speak .ks16-speakplate'), 'speaking bar ' + w + 'x' + h);
      await shot(I.page, 'speaking-night-' + w);
    }
    await I.page.setViewportSize({ width: 1024, height: 768 });
    await overlay(null);
    await I.page.waitForFunction(() => !document.querySelector('.ks16-speak'), null, { timeout: 20000 });
    /* SPOTLIGHT's own hold (a b17sl- id, laid again before it runs out): the same bar with no timer */
    await overlay({ id: 'b17sl-e2e1', kind: 'npc', npcId: 'n-dov', ms: 180000 });
    await I.page.waitForSelector('.ks16-speak[data-ks16-held] .ks16-speakplate', { timeout: 20000 });
    const h = await I.page.evaluate(() => { const p = document.querySelector('.ks16-speak .ks16-speakplate'); return { timed: p.hasAttribute('data-stage-timed'), timer: p.querySelector('[data-ui-slot="timer"]').textContent, name: p.querySelector('.dp-ov-name').textContent }; });
    expect(!h.timed && h.timer === '' && h.name === 'Dov Kessler', 'a hold has no timer: ' + JSON.stringify(h));
    await shot(I.page, 'speaking-held-night-1024');
    await overlay(null);
    await I.page.waitForFunction(() => !document.querySelector('.ks16-speak'), null, { timeout: 20000 });
  });

  await step('S6: the spotlight beat is the same bar for its own time', async () => {
    expect((await overlay({ id: 'ov-beat', kind: 'spotlight', ms: 9000, payload: { npcId: 'n-mabel' } })) === 200, 'the beat');
    await I.page.waitForSelector('.dp-show-spotlight.ks16-speak .ks16-speakplate', { timeout: 20000 });
    const v = await I.page.evaluate(() => { const p = document.querySelector('.ks16-beat .ks16-speakplate'); return { name: p.querySelector('[data-ui-slot="title"]').textContent, timer: p.querySelector('[data-ui-slot="timer"]').textContent, line: p.querySelector('[data-ui-slot="line"]').textContent }; });
    expect(v.name === 'Mabel Quist' && /^0:0\d$/.test(v.timer) && v.line === 'Fixer · The Kestrel Club · “Mab”', 'the beat: ' + JSON.stringify(v));
    judgePlate(await I.page.evaluate(plateMeasure, '.ks16-beat .ks16-speakplate'), 'spotlight beat');
    await overlay(null);
  });

  /* ---------------- S8: the map full-bleed ---------------- */
  await step('S8: a map fills the screen (at least 90% of the height at 1024x768); the band is a lower-third plate over it, the alarm docked beside it', async () => {
    await mission(2, { timer: { left: 300, endsAt: Date.now() + 300000, len: 300 } });
    await push(MAP);
    await I.page.waitForSelector('.dp-stage.dp-map.ks16-bleed.dp-in .ks16-mapfoot .ks16-bandplate', { timeout: 20000 });
    await sleep(900);
    const v = await I.page.evaluate(() => {
      const st = document.querySelector('.dp-stage.dp-map.dp-in'), svg = st.querySelector('.dp-map-frame svg').getBoundingClientRect(), fr = st.querySelector('.dp-map-frame').getBoundingClientRect();
      const p = st.querySelector('.ks16-bandplate'), band = document.querySelector('.dp-band');
      return { svgH: svg.height / innerHeight, frameH: fr.height / innerHeight, oldBand: !band.hidden, bandOn: document.querySelector('.dp-root').classList.contains('dp-band-on'),
        kicker: p.querySelector('[data-ui-slot="kicker"]').textContent, title: p.querySelector('[data-ui-slot="title"]').textContent, line: p.querySelector('[data-ui-slot="line"]').textContent,
        crew: (p.querySelector('.ks16-crew') || {}).textContent, side: p.querySelector('[data-ui-slot="side"]').textContent, alarm: (st.querySelector('.ks16-mapfoot .ks16-alarm') || {}).innerText };
    });
    expect(v.svgH >= 0.9 && v.frameH >= 0.9, 'the map fills the height: ' + JSON.stringify({ svgH: v.svgH, frameH: v.frameH }));
    expect(!v.oldBand && !v.bandOn, 'the old band beside the map is put away');
    expect(v.kicker === '21:14 · Gala night' && v.title === 'Now: The band plays the long set · The floor' && /^Next: The band takes five · 21:30/.test(v.line) && v.crew === 'Nell Arbuthnot · Cloakroom, Ray Okonjo · The floor, Tam Petrakis · The bar', 'the band\'s words: ' + JSON.stringify(v));
    expect(/^[45]:\d\d$/.test(v.side) && /2 of 6/.test(v.alarm || ''), 'the countdown on the side, the alarm beside: ' + JSON.stringify({ side: v.side, alarm: v.alarm }));
    for (const [w, h] of SIZES) {
      await I.page.setViewportSize({ width: w, height: h }); await sleep(800);
      judgePlate(await I.page.evaluate(plateMeasure, '.dp-map.dp-in .ks16-bandplate'), 'band plate ' + w + 'x' + h);
      judgePlate(await I.page.evaluate(plateMeasure, '.dp-map.dp-in .ks16-mapalarm'), 'map alarm ' + w + 'x' + h);
      const c = await I.page.evaluate(mapCover);
      console.log('     map ' + w + 'x' + h + ': drawing ' + (c.drawnH * 100).toFixed(0) + '% of the height, ' + (c.kept * 100).toFixed(0) + '% of it uncovered; plate ' + (c.plateH * 100).toFixed(0) + '% of the height');
      expect(c.plateH <= 0.335, 'the plate is a lower third (' + w + 'x' + h + '): ' + JSON.stringify(c));
      expect(h > w ? c.kept >= 0.97 : c.kept >= 2 / 3, 'the map keeps its area (' + w + 'x' + h + '): ' + JSON.stringify(c));
      if (h > w) expect(c.drawnH >= 0.4, 'portrait: the map at the top, a legible share: ' + JSON.stringify(c));
      await shot(I.page, 'map-night-' + w);
    }
    await I.page.setViewportSize({ width: 1024, height: 768 });
    const t1 = await I.page.evaluate(() => document.querySelector('.ks16-bandplate [data-ui-slot="side"]').textContent);
    await sleep(2200);
    const t2 = await I.page.evaluate(() => document.querySelector('.ks16-bandplate [data-ui-slot="side"]').textContent);
    expect(t1 !== t2, 'the countdown steps: ' + t1 + ' then ' + t2);
  });

  await step('S8: an overlay over the map takes the lower third; a captioned drawing keeps its caption under it, the band\'s row with it', async () => {
    await overlay({ id: 'ov-tram2', kind: 'clock', clockId: 'c-tram', ms: 60000 });
    await I.page.waitForSelector('.ks16-clock[data-ks16-phase="dock"]', { timeout: 20000 });
    expect((await I.page.evaluate(() => getComputedStyle(document.querySelector('.ks16-mapfoot')).visibility)) === 'hidden', 'the map foot stands down under an overlay');
    await overlay(null);
    await I.page.waitForFunction(() => !document.querySelector('.ks16-clock'), null, { timeout: 20000 });
    await push(DRAWING);
    await I.page.waitForSelector('.dp-stage.dp-map.dp-map-capped.dp-in .stage-dock .ks16-mapfoot .ks16-bandplate', { timeout: 20000 });
    await sleep(800);
    const g = await I.page.evaluate(() => { const st = document.querySelector('.dp-stage.dp-map.dp-in'), f = st.querySelector('.dp-map-frame').getBoundingClientRect(), d = st.querySelector('.stage-dock').getBoundingClientRect();
      return { fb: f.bottom, dt: d.top, bleed: st.classList.contains('ks16-bleed'), cap: st.querySelector('.stage-dock .dp-strip-cap').textContent }; });
    expect(Math.abs(g.fb - g.dt) <= 2 && !g.bleed && g.cap === DRAWING.caption, 'the drawing ends where the dock starts: ' + JSON.stringify(g));
    const row = await I.page.evaluate(() => { const p = document.querySelector('.dp-map.dp-in .ks16-bandrow'); return p && { title: p.querySelector('[data-ui-slot="title"]').textContent, side: p.querySelector('[data-ui-slot="side"]').textContent, line: p.querySelector('[data-ui-slot="line"]').textContent, alarm: !!document.querySelector('.dp-map.dp-in .stage-dock .ks16-mapalarm'), crew: !!document.querySelector('.dp-map.dp-in .stage-dock .ks16-crew') }; });
    expect(row && row.title === '21:14 · Gala night' && /^[0-9]:\d\d$/.test(row.side) && row.line === '' && row.alarm && !row.crew, 'one row beside the caption: the time, the countdown, the alarm: ' + JSON.stringify(row));
    for (const [w, h] of SIZES) {
      await I.page.setViewportSize({ width: w, height: h }); await sleep(800);
      const d = await I.page.evaluate(() => { const st = document.querySelector('.dp-stage.dp-map.dp-in'), f = st.querySelector('.dp-map-frame').getBoundingClientRect(), dk = st.querySelector('.stage-dock').getBoundingClientRect(); return { frameH: f.height / innerHeight, fb: f.bottom, dt: dk.top }; });
      console.log('     drawing ' + w + 'x' + h + ': ' + (d.frameH * 100).toFixed(0) + '% of the height');
      expect(Math.abs(d.fb - d.dt) <= 2 && d.frameH >= (h > w ? 0.5 : 0.62), 'the drawing keeps its share (' + w + 'x' + h + '): ' + JSON.stringify(d));
      judgePlate(await I.page.evaluate(plateMeasure, '.dp-map.dp-in .ks16-bandrow'), 'band row ' + w + 'x' + h);
      await shot(I.page, 'drawing-night-' + w);
    }
    await I.page.setViewportSize({ width: 1024, height: 768 });
  });

  /* ---------------- PANIC: the safe scene leaves nothing of the stage on screen ---------------- */
  await step('PANIC from a clock, a hold, a beat, an NPC and a map: the test card, and no docked clock, crew head or plate left on it', async () => {
    await mission(2);
    /* PANIC's own calls (gm-page.js): the ambient pinned to the test card with no overlay and no layers, and a blank push */
    const panic = () => Promise.all([ambient({ mode: 'pin', scene: 'testcard', overlay: null, layers: null }), push({ kind: 'blank' })]);
    const left = () => I.page.evaluate(() => ({
      safe: document.querySelector('.dp-root').hasAttribute('data-stage-safe'),
      shown: [...document.querySelectorAll('[class*="ks16-"], .stage-slot > *, .stage-lower > *')].filter((n) => n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden')
        .map((n) => String(n.className.baseVal !== undefined ? n.className.baseVal : n.className).slice(0, 60)).slice(0, 6),
      card: !!document.querySelector('.dp-ambient iframe[data-scene="testcard"]')
    }));
    const cases = [
      ['clock', () => overlay({ id: 'ov-p1', kind: 'clock', clockId: 'c-tram', ms: 60000 }), '.ks16-clock'],
      ['hold', () => overlay({ id: 'b17sl-p1', kind: 'npc', npcId: 'n-mabel', ms: 60000 }), '.ks16-speak'],
      ['beat', () => overlay({ id: 'ov-p2', kind: 'spotlight', ms: 20000, payload: { npcId: 'n-mabel' } }), '.ks16-beat'],
      ['npc', () => push({ kind: 'npc', npcId: 'n-mabel' }), '.ks16-npc.dp-in'],
      ['map', () => push(MAP), '.dp-map.dp-in .ks16-bandplate']
    ];
    for (const [n, put, sel] of cases) {
      await ambient({ mode: 'pin', scene: 'duskwall' });
      await I.page.waitForFunction(() => !document.querySelector('.dp-root').hasAttribute('data-stage-safe'), null, { timeout: 20000 });
      await put(); await I.page.waitForSelector(sel, { timeout: 20000 }); await sleep(600);
      await panic();
      await I.page.waitForFunction(() => document.querySelector('.dp-root').hasAttribute('data-stage-safe') && document.querySelector('.dp-root').classList.contains('stage-idle-on') && !document.querySelector('.dp-ov-card, .dp-show'), null, { timeout: 20000 });
      await sleep(1500);
      const v = await left();
      expect(v.safe && v.card && v.shown.length === 0, 'PANIC from ' + n + ' left: ' + JSON.stringify(v));
      if (n === 'clock' || n === 'map') await shot(I.page, 'panic-from-' + n + '-night-1024');
    }
    await ambient({ mode: 'pin', scene: 'duskwall' });
    await I.page.waitForFunction(() => !document.querySelector('.dp-root').hasAttribute('data-stage-safe'), null, { timeout: 20000 });
    await I.page.waitForFunction(() => { const a = document.querySelector('.stage-slot-clocks .ks16-alarm'); return !!a && a.getClientRects().length > 0; }, null, { timeout: 20000 });
  });

  /* ---------------- kit.stage turned off mid-session: what the stage drew is drawn again the old way ---------------- */
  await step('off mid-session: a docked clock, a hold, a beat and a pushed NPC are drawn again the old way within a poll; nothing of KS16 is left', async () => {
    const cases = [
      ['clock', () => overlay({ id: 'ov-o1', kind: 'clock', clockId: 'c-tram', ms: 90000 }), '.ks16-clock[data-ks16-phase="dock"]', '.dp-ov-card.dp-ov-clock:not(.ks16-clock) svg.dp-ov-face path.dp-ov-seg'],
      ['hold', () => overlay({ id: 'b17sl-o2', kind: 'npc', npcId: 'n-dov', ms: 90000 }), '.ks16-speak', '.dp-ov-card.dp-ov-npc:not(.ks16-speak) .dp-ov-portrait'],
      ['beat', () => overlay({ id: 'ov-o3', kind: 'spotlight', ms: 60000, payload: { npcId: 'n-mabel' } }), '.ks16-beat', '.dp-show-spotlight:not(.ks16-speak) .dp-spot-beam'],
      ['npc', () => push({ kind: 'npc', npcId: 'n-mabel' }), '.ks16-npc.dp-in', '.dp-stage.dp-npc.dp-in:not(.ks16-npc) .dp-npc-name']
    ];
    for (const [n, put, kitSel, oldSel] of cases) {
      await setting(true);
      await frameOn(I.page);
      await overlay(null); await push({ kind: 'blank' });
      await put(); await I.page.waitForSelector(kitSel, { timeout: 20000 }); await sleep(800);
      await setting(false);
      await I.page.waitForFunction(() => !document.querySelector('.stage-frame'), null, { timeout: 30000 });
      const t0 = Date.now();
      await I.page.waitForSelector(oldSel, { timeout: 12000 });
      await I.page.waitForFunction(() => !document.querySelector('[class*="ks16-"]'), null, { timeout: 5000 }).catch(() => {});
      const k = await I.page.evaluate(() => [...document.querySelectorAll('[class*="ks16-"]')].map((e) => String(e.className.baseVal !== undefined ? e.className.baseVal : e.className).slice(0, 50)).slice(0, 4));
      expect(k.length === 0, 'off from ' + n + ': KS16 nodes left: ' + k.join(' | '));
      console.log('     off from ' + n + ': the old way in ' + (Date.now() - t0) + ' ms');
      await sleep(1500);      /* the old card fades in (0.5 s) */
      const op = await I.page.evaluate((q) => { const e = document.querySelector(q); const c = e && (e.closest('.dp-ov-card, .dp-show, .dp-stage') || e); return c ? Number(getComputedStyle(c).opacity) : -1; }, oldSel);
      expect(op > 0.9, 'off from ' + n + ': the old one is on screen (opacity ' + op + ')');
      await shot(I.page, 'off-' + n + '-night-1024');
    }
    await overlay(null); await push({ kind: 'blank' });
    await setting(true);
    await frameOn(I.page);
  });


  await step('Paper: the nameplate, the speaking bar and the band plate pass at 1024x768', async () => {
    const P = await openIpad(browser, { theme: 'light' });
    try {
      await frameOn(P.page);
      expect((await P.page.evaluate(() => document.querySelector('.dp-root').getAttribute('data-ui-theme'))) === 'paper', 'paper');
      await push(MAP);
      await P.page.waitForSelector('.dp-map.dp-in .ks16-bandplate', { timeout: 20000 }); await sleep(700);
      judgePlate(await P.page.evaluate(plateMeasure, '.dp-map.dp-in .ks16-bandplate'), 'paper band plate');
      await shot(P.page, 'map-paper-1024');
      await push({ kind: 'npc', npcId: 'n-mabel' });
      await P.page.waitForSelector('.ks16-npc.dp-in .ks16-nameplate', { timeout: 20000 }); await sleep(800);
      judgePlate(await P.page.evaluate(plateMeasure, '.ks16-npc.dp-in .ks16-nameplate'), 'paper nameplate');
      await shot(P.page, 'npc-paper-1024');
      await overlay({ id: 'ov-spot-p', kind: 'npc', npcId: 'n-mabel', ms: 60000 });
      await P.page.waitForSelector('.ks16-speak .ks16-speakplate', { timeout: 20000 }); await sleep(800);
      judgePlate(await P.page.evaluate(plateMeasure, '.ks16-speak .ks16-speakplate'), 'paper speaking bar');
      await shot(P.page, 'speaking-paper-1024');
      await overlay(null); await push({ kind: 'blank' });
      await overlay({ id: 'ov-tram-p', kind: 'clock', clockId: 'c-tram', ms: 60000 });
      await P.page.waitForSelector('.ks16-clock[data-ks16-phase="dock"]', { timeout: 20000 });
      judgePlate(await P.page.evaluate(plateMeasure, '.ks16-clock .ks16-dock'), 'paper docked clock');
      await shot(P.page, 'clock-dock-paper-1024');
      await overlay(null);
      expect(P.seen.errors.length === 0, 'page errors: ' + P.seen.errors.join(' | '));
    } finally { await P.ctx.close(); }
  });

  await step('reduced motion: the clock\'s grow does not animate (it is simply there), then the dock', async () => {
    const R = await openIpad(browser, { reduced: true });
    try {
      await frameOn(R.page); await sleep(800);
      await overlay({ id: 'ov-tram-r', kind: 'clock', clockId: 'c-tram', ms: 60000 });
      await R.page.waitForSelector('.ks16-clock[data-ks16-phase="grow"][data-reduced]', { timeout: 20000 });
      const a = await running(R.page);
      expect(!a.some((x) => /ks16/.test(x)), 'an animation under reduced motion: ' + a.join(', '));
      await R.page.waitForFunction(() => document.querySelector('.ks16-clock').getAttribute('data-ks16-phase') === 'dock', null, { timeout: 4000 });
      await overlay(null);
    } finally { await R.ctx.close(); }
  });

  await step('off: the old band beside the map and the old clock card come back, no ks16 node; no request left the origin', async () => {
    await push(MAP);
    await setting(false);
    await I.page.waitForFunction(() => !(document.documentElement.getAttribute('data-kit') || '').includes('stage') && !document.querySelector('.stage-frame'), null, { timeout: 30000 });
    await I.page.waitForFunction(() => { const b = document.querySelector('.dp-band'); return b && !b.hidden && document.querySelector('.dp-root').classList.contains('dp-band-on'); }, null, { timeout: 20000 });
    await overlay({ id: 'ov-tram-off', kind: 'clock', clockId: 'c-tram', ms: 60000 });
    await I.page.waitForSelector('.dp-ov-card.dp-ov-clock svg.dp-ov-face path.dp-ov-seg', { timeout: 20000 });
    await I.page.waitForFunction(() => !document.querySelector('[class*="ks16-"]'), null, { timeout: 5000 }).catch(() => {});      /* a kit overlay seen before the switch may still be fading out (450 ms) */
    const v = await I.page.evaluate(() => ({ ks16: document.querySelectorAll('[class*="ks16-"]').length, which: [...document.querySelectorAll('[class*="ks16-"]')].map((e) => String(e.className.baseVal !== undefined ? e.className.baseVal : e.className) + '<' + (e.parentNode && e.parentNode.className)).slice(0, 6), bleed: !!document.querySelector('.ks16-bleed'), right: getComputedStyle(document.querySelector('.dp-stage.dp-map.dp-in')).right }));
    expect(v.ks16 === 0 && !v.bleed && v.right !== '0px', 'the old map and band: ' + JSON.stringify(v));
    await overlay(null);
    await mission(null);
    await push({ kind: 'blank' });
    const out = I.seen.requests.filter((u) => /^https?:/i.test(u) && new URL(u).origin !== BASE);
    expect(out.length === 0, 'requests outside the origin: ' + out.join(', '));
    expect(I.seen.errors.length === 0, 'page errors: ' + I.seen.errors.join(' | '));
  });
} finally {
  if (I) await I.ctx.close().catch(() => {});
  await browser.close();
}
console.log((failed ? 'FAIL' : 'PASS') + ' kit-stage-scene: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
