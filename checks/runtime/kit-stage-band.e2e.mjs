// kit-stage-band (KS14, the top band, S2, behind kit.stage), end to end on the real GM page, Worker and iPad (wrangler dev on PORT, default
// 9412; the inspector on PORT + 20000). Invented fixtures only: the Dovetail Crew (Nell Arbuthnot, Ray Okonjo, Tam Petrakis) and one made-up
// 22-character name (Octavia Fennimore-Clay); GM-ONLY- markers for anything hidden. Blade's endpoints are faked: no model, $0.
//   pure      app/display/kit/band.js's Pure (heads, the clock, one acting head at most) under node, before any server
//   heads     the iPad at 1024x768 draws a head per PC playing (hud.crew) with the FULL name, never cut; a stress ring and its number on the
//             three PCs the faces layer carries (its cap is 3); the fourth has a head and no ring (Gate 2 condition 2)
//   clock     the night's clock and NEXT from the band model; every line at least 3.3% of the screen's height, 4.5:1 on its ground
//   acting    picking Who on the desk marks that PC's face (acting: true) and the iPad grows the head within one poll; a fourth PC picked takes
//             the third face's place; the mark goes on Esc, Take it down, Clean, a result, Blank and PANIC (Gate 2 condition 1)
//   off       kit.stage turned off mid-game: face.pcstatus is always on in this build (not a Settings row), so the faces stay as today, without
//             the mark, and a Who pick marks nothing; on again, the mark rides (Gate 2 condition 3; the clear with both off is unit-tested in
//             suite-b20-faces, since it cannot be reached here)
// The display GET never carries a GM-ONLY- string; the iPad makes no request outside its origin; nothing moves on the idle stage.
// KIT_SHOTS=<dir> saves the pictures (<view>-<theme>-<width>.png at 1024x768, 1180x820 and 768x1024).
//   PW_MODULE=<path to playwright-core> [PW_CHANNEL=msedge] [PORT=9412] [KIT_SHOTS=<dir>] node checks/runtime/kit-stage-band.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9412);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const SHOTS = process.env.KIT_SHOTS || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), np = fx('npc-pack.json');
const CREW = [['pc1-nell', 'Nell Arbuthnot', 3], ['pc2-ray', 'Ray Okonjo', 5], ['pc3-tam', 'Tam Petrakis', 7], ['pc4-octavia', 'Octavia Fennimore-Clay', 1]];
const LONG = 'Octavia Fennimore-Clay';
const PARTS = {
  console: con.parts.console, npc: np.parts.npc,
  campaign: { ...np.parts.campaign, pcs: CREW.map(([, name]) => ({ name, first: name.split(' ')[0] })) },      /* the Roll's Who chips: our four */
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: new Date().toISOString() }, T: loc.T, extra: loc.extra },
};
const POLL_MS = 4000;      /* the iPad's poll (display-page.js Pure.POLL.intervalMs) */

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }

/* ============ pure: no server ============ */
{
  const P = require(path.join(ROOT, 'app', 'display', 'kit', 'band.js')).Pure;
  const fc = [{ pcId: 'a', name: 'Nell Arbuthnot', stress: 3 }, { pcId: 'b', name: 'ray  okonjo', stress: 12, acting: true }, { npcId: 'n-mabel' }, { pcId: 'c', name: 'Tam Petrakis', acting: true }];
  const h = P.heads(fc, CREW.map(([, name]) => ({ name })));
  check(JSON.stringify(h.map((x) => x.name)) === JSON.stringify(CREW.map((c) => c[1])), 'pure: a head per hud.crew name, in order, full names: ' + h.map((x) => x.name).join(', '));
  check(h[0].stress === 3 && h[1].stress === 9 && h[2].stress === null && h[3].stress === null, 'pure: the ring from the face joined by name (case and spacing do not split them), at most 9; no face, no ring');
  check(h.filter((x) => x.acting).length === 1 && h[1].acting, 'pure: one acting head at most, whatever arrives');
  check(P.heads(fc, []).map((x) => x.name).join('|') === 'Nell Arbuthnot|ray okonjo|Tam Petrakis', 'pure: no hud.crew: the PC faces are the heads (an NPC face never is)');
  check(P.heads(null, null).length === 0 && P.initial('  octavia') === 'O' && P.initial('') === '?', 'pure: nothing in, nothing drawn; the initial');
  const c = P.clock({ time: '21:14', next: [{ text: 'The band takes five', at: '21:30' }] });
  check(!!c && c.time === '21:14' && c.kick === 'Next · 21:30' && c.text === 'The band takes five', 'pure: the clock and NEXT from the band model: ' + JSON.stringify(c));
  check(P.clock({ time: '', next: [] }) === null && P.clock(null) === null && P.clock({ time: '', next: [{ text: 'Soon', inText: 'in 5 min' }] }).kick === 'Next · in 5 min', 'pure: no clock and no NEXT draws nothing; NEXT without a time says how soon');
}

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-kit-stage-band-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
delete env.B68_ANTHROPIC_KEY; delete env.ANTHROPIC_API_KEY;
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

const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j }; });
const ambientDoc = async () => { const j = (await api('GET', '/gm/ambient')).json || {}; return j.doc || {}; };
const ov = async () => (await ambientDoc()).overlay || null;
const faces = async () => { const d = await ambientDoc(); return d.layers && d.layers.band && Array.isArray(d.layers.band.faces) ? d.layers.band.faces : null; };
/* the GM page reads its settings from the GM state and publishes the display's to the campaign: both are set, so neither undoes the other */
const setting = async (f) => { const a = await api('PATCH', '/gm/state', { features: f }); const b = await api('PATCH', '/campaign', { features: f }); return a.status !== 200 ? a : b; };
const displayGet = async () => JSON.stringify((await api('GET', '/gm/display?seq=-1&aseq=-1&sseq=-1', null, IPAD)).json || {});
const MISSION = { v: 1, site: 'The Pelican Rooms', t: 90, seq: 1,
  hud: { time: '21:14', showTime: true, label: 'Gala night', now: [], next: [{ text: 'The band takes five', at: '21:30', inMin: 16 }], crew: CREW.map(([, name]) => ({ name })) } };
const charDoc = (id, name, stress, spec) => ({ v: 2, name, alias: '', code: '', playbook: 'hound', playbookName: 'Hound', owner: id + '@example.test', spec, sheet: { name }, play: { vice: '', purveyor: '', contacts: [], clocks: [], stress } });
function chromium() { return require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright').chromium; }

try {
  const upOk = await until(async () => { try { return (await fetch(BASE + '/index.html')).status > 0; } catch (_) { return false; } }, 90000, 500);
  if (!upOk) throw new Error('the server did not start');
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status);
  }
  await api('PUT', '/campaign', { v: 1, session: { number: 1, startedAt: new Date().toISOString(), endedAt: null }, crew: { name: 'The Dovetail Crew', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [] }, factions: [], clocks: [], log: [] });
  await api('PUT', '/npcs/npc_hid', { name: 'GM-ONLY-NPC-1', role: 'GM-ONLY-ROLE', revealed: false });
  await api('PUT', '/gm/display', { kind: 'blank' });
  await api('PATCH', '/gm/ambient', { mode: 'pin', scene: 'duskwall' });
  const r0 = await setting({ 'kit.stage': true }); if (r0.status !== 200) throw new Error('kit.stage on -> ' + r0.status + ' ' + JSON.stringify(r0.json));
  check((await api('PATCH', '/campaign', { mission: MISSION })).status === 200, 'the mission\'s HUD: the clock, NEXT and four PCs playing');

  const browser = await chromium().launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  const G = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await G.addInitScript(atPlace('score'));
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await G.route('**/api/gm/assist/**', (route) => json(route, { cards: [], updates: [], flags: [], asks: [], marked: 1, error: 'no model in this check' }, /\/(ask|act|fit)/.test(route.request().url()) ? 500 : 200));
  const page = await G.newPage();
  page.on('pageerror', (e) => errors.push('gm: ' + e.message));
  const gmReady = () => page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  await page.goto(BASE + '/#gm'); await gmReady();
  const spec = await page.evaluate(() => window.B68.BASE_FIGURE);
  for (const [id, name, stress] of CREW) { const r = await api('PUT', '/characters/' + id, charDoc(id, name, stress, spec)); if (r.status !== 200) throw new Error('character ' + id + ' -> ' + r.status); }
  const f0 = await until(async () => { const f = await faces(); return f && f.length === 3 ? f : null; }, 30000, 300);
  check(!!f0 && f0.every((f) => f.pcId && typeof f.stress === 'number') && !f0.some((f) => f.acting), 'the GM page sends three PC faces with their Stress (face.pcstatus is always on in this build), nobody acting: ' + JSON.stringify(f0 && f0.map((f) => f.name)));

  /* the iPad */
  const D = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1024, height: 768 }, serviceWorkers: 'block' });
  const ipad = await D.newPage();
  const outside = [];
  ipad.on('request', (q) => { if (!q.url().startsWith(BASE)) outside.push(q.url()); });
  ipad.on('pageerror', (e) => errors.push('ipad: ' + e.message));
  await ipad.goto(BASE + '/');
  await ipad.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 20000 });
  check(!!(await until(() => ipad.evaluate(() => !!document.querySelector('.dp-root .stage-frame') && !!window.B68StageBand), 30000, 250)), 'kit.stage on: the iPad has the stage frame and the band module');
  const heads = () => ipad.evaluate(() => [...document.querySelectorAll('.stage-slot-crew .stage-head')].map((h) => {
    const n = h.querySelector('.stage-head-name'), f = h.querySelector('.stage-head-face').getBoundingClientRect();
    return { name: n.textContent, cut: n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1, lines: Math.round(n.getBoundingClientRect().height / parseFloat(getComputedStyle(n).lineHeight)),
      ring: !!h.querySelector('.stage-head-ring'), num: (h.querySelector('.stage-head-num') || {}).textContent || '', acting: h.hasAttribute('data-stage-acting'), size: Math.round(f.width) };
  }));
  const actingName = async () => { const l = await heads(); const a = l.filter((h) => h.acting); return a.length === 1 ? a[0].name : a.length ? 'MANY' : ''; };
  const IPAD_SIZES = [[1024, 768], [1180, 820], [768, 1024]];
  const shot = async (view, theme = 'night') => {
    if (!SHOTS) return; mkdirSync(SHOTS, { recursive: true }); await sleep(700);
    for (const [w, h] of IPAD_SIZES) { await ipad.setViewportSize({ width: w, height: h }); await sleep(450); await ipad.screenshot({ path: path.join(SHOTS, view + '-' + theme + '-' + w + '.png') }); }
    await ipad.setViewportSize({ width: 1024, height: 768 }); await sleep(300);
  };

  // ============ heads: four, full names, the cap ============
  const h1 = await until(async () => { const l = await heads(); return l.length === 4 && l.filter((h) => h.ring).length === 3 ? l : null; }, 20000, 250);
  check(!!h1 && JSON.stringify(h1.map((h) => h.name)) === JSON.stringify(CREW.map((c) => c[1])), 'a head per PC playing, the full names: ' + JSON.stringify(h1 && h1.map((h) => h.name)));
  check(!!h1 && h1.every((h) => !h.cut && h.lines <= 2), 'at 1024x768 every name reads in full, in at most two lines (the 22-character one too): ' + JSON.stringify(h1 && h1.map((h) => [h.name, h.lines, h.cut])));
  const withFace = new Set((f0 || []).map((f) => f.name));
  check(!!h1 && h1.every((h) => h.ring === withFace.has(h.name)) && h1.filter((h) => h.ring).every((h) => h.num === String(CREW.find((c) => c[1] === h.name)[2])), 'the three faces carry a ring and their Stress; the PC past the cap has a head and no ring: ' + JSON.stringify(h1 && h1.map((h) => [h.name, h.ring, h.num])));
  for (const [w, hgt] of IPAD_SIZES) {
    await ipad.setViewportSize({ width: w, height: hgt }); await sleep(500);
    const l = await heads();
    check(l.length === 4 && l.every((h) => !h.cut), w + 'x' + hgt + ': no name cut: ' + JSON.stringify(l.map((h) => h.cut)));
  }
  await ipad.setViewportSize({ width: 1024, height: 768 }); await sleep(400);

  // ============ clock and NEXT: legible at 1.5 m, 4.5:1, nothing over anything ============
  const m = await ipad.evaluate(() => {
    const lum = (c) => { const v = c.match(/[\d.]+/g).slice(0, 3).map((x) => { x = +x / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const H = innerHeight, out = { H, min: 999, lowest: 99, texts: [] };
    for (const [box, sel] of [['.stage-clock', '.stage-clock-time, .stage-clock-kick, .stage-clock-text'], ['.stage-heads', '.stage-head-name, .stage-head-num']]) {
      const b = document.querySelector(box); if (!b) { out.texts.push('missing ' + box); out.min = 0; continue; }
      const bg = getComputedStyle(b).backgroundColor;
      for (const n of b.querySelectorAll(sel)) {
        const cs = getComputedStyle(n), fs = parseFloat(cs.fontSize), nb = n.classList.contains('stage-head-num') ? cs.backgroundColor : bg;
        out.min = Math.min(out.min, fs); out.lowest = Math.min(out.lowest, ratio(cs.color, nb)); out.texts.push(n.textContent + ':' + fs.toFixed(1));
      }
    }
    const a = document.querySelector('.stage-clock').getBoundingClientRect(), c = document.querySelector('.stage-heads').getBoundingClientRect();
    out.overlap = !(c.left >= a.right || c.top >= a.bottom || a.left >= c.right || a.top >= c.bottom);
    out.inner = [a, c].every((r) => r.left >= 0.05 * innerWidth - 1 && r.right <= 0.95 * innerWidth + 1 && r.top >= 0.05 * H - 1);
    return out;
  });
  check(/21:14/.test(m.texts.join(' ')) && /Next · 21:30/i.test(m.texts.join(' ')) && /The band takes five/.test(m.texts.join(' ')), 'the clock and NEXT: ' + m.texts.slice(0, 3).join(' | '));
  check(m.min >= 0.033 * m.H - 0.01, 'every line of the band is at least 3.3% of the screen\'s height (read from 1.5 m): smallest ' + m.min.toFixed(1) + ' px of ' + m.H);
  check(m.lowest >= 4.5, 'every line is 4.5:1 or better on its ground: lowest ' + m.lowest.toFixed(2));
  check(!m.overlap && m.inner, 'the clock and the crew do not overlap and sit inside the inner 90%');
  await sleep(600);
  const running = await ipad.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running').map((a) => a.animationName || 'x'));
  check(running.length === 0, 'nothing moves on the idle stage: ' + running.join(','));
  await shot('ipad-band');

  // ============ acting: Who on the desk grows the head within one poll; a fourth PC takes the third face's place ============
  const whoChip = (name) => '[data-gm="who"][data-v="' + name + '"]';
  const pick = async (name) => { const t = Date.now(); await page.evaluate((s) => { const b = document.querySelector(s); if (b) b.click(); }, whoChip(name)); return t; };
  check(!!(await page.$(whoChip(LONG))), 'the Roll has a Who chip for each of the four');
  const t0 = await pick(LONG);
  const g1 = await until(async () => ((await actingName()) === LONG ? Date.now() - t0 : 0), POLL_MS + 4000, 100);
  check(!!g1 && g1 <= POLL_MS + 2500, 'Who picked: the head grows within one poll (' + g1 + ' ms; the poll is ' + POLL_MS + ' ms)');
  const fa = await faces();
  check(!!fa && fa.length === 3 && fa.filter((f) => f.acting).length === 1 && fa.find((f) => f.acting).name === LONG, 'the faces layer marks the one face; the fourth PC took the third place (the acting PC is always on the band): ' + JSON.stringify(fa && fa.map((f) => f.name + (f.acting ? '*' : ''))));
  const h2 = await heads(), big = h2.find((h) => h.acting), small = h2.filter((h) => !h.acting);
  check(!!big && small.every((h) => big.size > h.size + 10) && h2.every((h) => !h.cut), 'the acting head is larger (' + (big && big.size) + ' px vs ' + small.map((h) => h.size).join('/') + '), and still no name is cut');
  await shot('ipad-band-acting');
  await pick('Ray Okonjo');
  check(!!(await until(async () => (await actingName()) === 'Ray Okonjo', POLL_MS + 4000)), 'another pick moves the mark: Ray grows, the other shrinks');

  // ============ the head shrinks on Esc, Take it down, Clean, a result, Blank and PANIC (Gate 2 condition 1) ============
  const STAMP = '#gm-stamp [data-gm="stamp"]';
  const blur = () => page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  const stampIt = async () => {
    await page.fill('#gm-c-threat', 'She calls the desk.'); await page.click('#gm-pos [data-v="risky"]'); await page.click('#gm-eff [data-v="standard"]');
    await until(() => page.$(STAMP), 4000); await page.click(STAMP);
    return until(async () => { const o = await ov(); return o && o.kind === 'report' && !o.payload.result ? o : null; }, 8000);
  };
  const shrinks = async (label) => {
    const ok = await until(async () => { const f = await faces(); return (!f || !f.some((x) => x.acting)) && (await actingName()) === '' ? 'yes' : ''; }, POLL_MS + 4000, 150);
    check(!!ok, label + ': the head shrinks (the mark is off the layer and the iPad)');
  };
  const grows = async (name, label) => check(!!(await until(async () => (await actingName()) === name, POLL_MS + 4000)), label + ': ' + name + ' acts');
  const takeDown = async () => { await blur(); await page.keyboard.press('Escape'); await until(async () => !(await ov()), 6000); };
  await stampIt(); await sleep(800);
  check((await actingName()) === 'Ray Okonjo', 'the stamp goes up: the head stays large');
  await blur(); await page.keyboard.press('Escape');
  await shrinks('Esc takes the stamp down');
  await stampIt(); await grows('Ray Okonjo', 'stamped again with the same Who');
  await page.click('#gm-stamp [data-gm="stamp-down"]');
  await shrinks('Take it down (the stamp)');
  await stampIt(); await grows('Ray Okonjo', 'stamped again');
  await blur(); await page.click('#gm-buttons [data-gm="situation"][data-n="2"]');
  await shrinks('a result (4/5)');
  await takeDown();
  await pick('Ray Okonjo'); await grows('Ray Okonjo', 'picked again'); await stampIt();
  await until(() => page.$('#gm-stamp [data-gm="stamp-clean"]'), 3000); await page.click('#gm-stamp [data-gm="stamp-clean"]');
  await shrinks('Clean');
  await takeDown();
  await pick('Ray Okonjo'); await grows('Ray Okonjo', 'picked again');
  await page.evaluate(() => { const b = document.querySelector('[data-gm="blankipad"]'); if (b) b.click(); });
  await shrinks('Take it down (the iPad)');
  await pick('Ray Okonjo'); await pick('Ray Okonjo'); await grows('Ray Okonjo', 'picked again');
  await page.evaluate(() => { const b = document.querySelector('[data-gm="darkipad"]'); if (b) b.click(); });
  await shrinks('Blank');
  await pick('Ray Okonjo'); await pick('Ray Okonjo'); await grows('Ray Okonjo', 'picked again');
  await page.evaluate(() => { const b = document.querySelector('#gm-band [data-band="panic"]'); if (b) b.click(); });
  check(!!(await until(async () => !(await faces()), 8000, 200)), 'PANIC: the layers come down, the faces with them');
  await sleep(POLL_MS + 1500);
  check(!(await faces()), 'and the mark going is no reason to lay the faces again (they come back at the next real change, as today)');
  check(!(await displayGet()).includes('GM-ONLY'), 'the display GET never carries a GM-ONLY- string');

  // ============ off: kit.stage off mid-game (Gate 2 condition 3) ============
  await api('PATCH', '/gm/ambient', { mode: 'auto' });
  await api('PUT', '/characters/pc1-nell', charDoc('pc1-nell', 'Nell Arbuthnot', 4, spec));
  check(!!(await until(async () => { const f = await faces(); return f && f.length === 3 && f.some((x) => x.stress === 4); }, 20000, 300)), 'a Stress tick: the faces come back (as today)');
  /* face.pcstatus is not a Settings row in this build (features.js: always on), so the faces are today's and stay; the clear when both are off
     is suite-b20-faces' (pcstatus.js). Off mid-game: the page's own Settings row when it is drawn; else the stored setting and a reload */
  const flip = async (on) => {
    if (await page.evaluate((v) => { const b = document.querySelector('[data-set="kit.stage"][data-v="' + v + '"]'); if (b) { b.click(); return true; } return false; }, on ? '1' : '0')) return 'the Settings row';
    await setting({ 'kit.stage': on }); await page.reload(); await gmReady(); return 'a reload';
  };
  await pick('Tam Petrakis');
  check(!!(await until(async () => { const f = await faces(); return f && f.some((x) => x.acting && x.name === 'Tam Petrakis'); }, 20000, 300)), 'Tam picked: the mark');
  const how1 = await flip(false);
  const kept = await until(async () => { const f = await faces(); return f && f.length === 3 && !f.some((x) => x.acting) ? f : null; }, 20000, 300);
  check(!!kept, 'kit.stage off mid-game (' + how1 + '): the faces stay as face.pcstatus sends them today, the mark gone: ' + JSON.stringify(kept && kept.map((f) => f.name)));
  check(!!(await until(() => ipad.evaluate(() => !document.querySelector('.dp-root .stage-frame')), 20000, 300)), 'and the iPad leaves the stage');
  await pick('Ray Okonjo'); await sleep(2500);
  const f9 = await faces();
  check(!!f9 && !f9.some((x) => x.acting), 'kit.stage off: a Who pick marks nothing (today)');
  check(await page.evaluate(() => localStorage.getItem('b68.ks14.faces') === null), 'and the page keeps no memory of the stage\'s faces (face.pcstatus owns them)');
  const how2 = await flip(true);
  await pick('Ray Okonjo'); await pick('Ray Okonjo');
  check(!!(await until(async () => { const f = await faces(); return f && f.some((x) => x.acting && x.name === 'Ray Okonjo'); }, 20000, 300)), 'kit.stage on again (' + how2 + '): the mark rides again');

  check(!(await displayGet()).includes('GM-ONLY'), 'the display GET never carries a GM-ONLY- string (end)');
  check(outside.length === 0, 'the iPad made no request outside its origin: ' + outside.slice(0, 3).join(' | '));
  check(errors.length === 0, 'no page errors: ' + errors.slice(0, 3).join(' | '));

  // ============ the pictures in Paper (KIT_SHOTS only) ============
  if (SHOTS) {
    await page.reload(); await gmReady();
    await ipad.evaluate(() => localStorage.setItem('b68.theme', 'light')); await ipad.reload();
    await ipad.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 20000 });
    await until(async () => (await heads()).length === 4, 30000, 250);
    await shot('ipad-band', 'paper');
    await pick(LONG); await until(async () => (await actingName()) === LONG, POLL_MS + 4000);
    await shot('ipad-band-acting', 'paper');
  }
  await browser.close();
} catch (e) {
  console.log('FAIL ' + (e && e.stack || e)); failed++;
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
