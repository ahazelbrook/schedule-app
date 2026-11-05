// THE BAND on the iPad (the GM night rebuild, design section 6; app/display/layers.js, display/shows.css), end to end against a real local Worker
// (wrangler dev) on PORT (default 8655), with invented fixtures only.
//   1. Every combination of the band's layers (the lamp on air or off the record, band.onair, the phase, security, three PCs at their worst, one PC,
//      two NPC faces, the hard start) at 1024x768 and in portrait: the strip is one row of fixed slots inside the screen, no slot's contents cross
//      into another slot, a slot holds its place whatever else is set, and the beats, the AUTO chip and the hard start lay out below it.
//   2. The real iPad page with a map, the band beside it (its countdown) and every layer: the strip never covers the map, its caption bar, the band
//      beside the map, the AUTO chip or the corner status, and the band beside the map still fits its box. Lights out leaves only the lamp.
//   3. The look book's two band cards draw; the display GET with every layer set stays quick and adds no request.
//   PW_MODULE=<path to playwright-core> PW_CHANNEL=msedge node checks/runtime/ipad-band.e2e.mjs      (BAND_SHOTS=<dir> saves screenshots)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8655);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const SHOTS = process.env.BAND_SHOTS || '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-ipadband-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

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

const gm = (method, p, body) => fetch(BASE + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><rect x="10" y="10" width="380" height="280" fill="#223" stroke="#eee" stroke-width="4"/><rect x="40" y="40" width="140" height="100" fill="#456"/></svg>';
const HUD = { time: '22:30', showTime: true, label: 'Gala night', now: [{ text: 'The photo call', where: 'The floor', until: '23:00' }], next: [{ text: 'The toast', where: 'Showroom', at: '00:00', inMin: 90 }],
  night: { beats: 16, start: 2, cur: 6, marks: [{ i: 3, icon: 'star', text: 'The speeches' }] }, alarm: { name: 'Fuse', size: 6, filled: 2, text: 'A door slams' },
  crew: [{ name: 'Ada', room: 'Cocktail lounge' }, { name: 'Bo', room: 'Showroom' }], timer: { endsAt: Date.now() + 600000, left: 600, paused: false, len: 900 } };
const PCS = [{ pcId: 'pc-nell', name: 'Nell Arbuthnot', stress: 9, harm: [1, 1, 2, 3], locks: 2 }, { pcId: 'pc-ray', name: 'Ray Okonjo', stress: 2, harm: [4] }, { pcId: 'pc-tam', name: 'Tamsin-Petronella Vandermeerholt', stress: 6, locks: 1 }];

/* every combination, measured in the look book's frame page (the iPad's own stylesheets and modules, nothing of the network) */
const combos = () => {
  const out = [];
  const lamp = [null, { off: false }, { off: true }], onair = [false, true], phase = [null, 'pb', 'after'], sec = [null, 0, 4];
  const faces = [null, 'pcs', 'one', 'npcs'], mode = [null, 'start'];
  for (const l of lamp) for (const o of onair) for (const p of phase) for (const s of sec) for (const f of faces) for (const m of mode) {
    if (m === 'start' && f !== 'npcs') continue;      /* the hard start holds the faces it reveals */
    out.push({ l, o, p, s, f, m });
  }
  return out;
};
const measure = (list) => {
  const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0'; document.body.appendChild(host);
  const PCS = [{ pcId: 'pc-nell', name: 'Nell Arbuthnot', stress: 9, harm: [1, 1, 2, 3], locks: 2 }, { pcId: 'pc-ray', name: 'Ray Okonjo', stress: 2, harm: [4] }, { pcId: 'pc-tam', name: 'Tamsin-Petronella Vandermeerholt', stress: 6, locks: 1 }];
  const NPCS = [{ name: 'Mabel Quist', role: 'Fixer' }, { name: 'Dov Kessler', role: 'Desk sergeant' }];
  const vw = innerWidth, vh = innerHeight, bad = [];
  const rect = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; };
  const inside = (a, b) => a.l >= b.l - 0.5 && a.t >= b.t - 0.5 && a.r <= b.r + 0.5 && a.b <= b.b + 0.5;
  const cut = (a, b) => Math.max(a.l, b.l) < Math.min(a.r, b.r) - 0.5 && Math.max(a.t, b.t) < Math.min(a.b, b.b) - 0.5;
  let slotsSeen = null;
  for (const c of list) {
    const root = document.createElement('div'); root.className = 'dp-root'; root.style.position = 'absolute'; root.style.inset = '0';
    root.appendChild(Object.assign(document.createElement('div'), { className: 'dp-ambient' })); root.appendChild(Object.assign(document.createElement('div'), { className: 'dp-stages' }));
    const ov = Object.assign(document.createElement('div'), { className: 'dp-overlay' }); root.appendChild(ov);
    const chip = Object.assign(document.createElement('div'), { className: 'dp-auto', textContent: 'AUTO' }); root.appendChild(chip);
    host.appendChild(root);
    const L = window.B68Layers.attach(root, { skew: () => 0 });
    const faces = c.f === 'pcs' ? PCS : c.f === 'one' ? PCS.slice(0, 1) : c.f === 'npcs' ? NPCS : null;
    const layers = { band: {}, scene: {}, data: {} };
    if (c.o) layers.band.onair = true; if (c.p) layers.band.phase = c.p; if (c.s !== null) layers.band.security = c.s; if (faces) layers.band.faces = faces;
    if (c.m) { layers.scene.mode = c.m; layers.data.countdown = { to: Date.now() - 60000 }; layers.data.previously = NPCS; }
    L.apply(layers);
    if (c.l) { const a = window.B68OnAir.make({}); if (c.l.off) a.pause(272000); a.paint(root, true); }
    const tag = JSON.stringify(c);
    const strip = root.querySelector('.dp-lay-strip');
    const any = !!(c.l || c.o || c.p || c.s !== null || faces);
    if (!any) { if (strip) bad.push(tag + ': a strip with nothing in it'); root.remove(); L.destroy(); continue; }
    if (!strip) { bad.push(tag + ': no strip'); root.remove(); L.destroy(); continue; }
    const sr = rect(strip);
    if (sr.l < -0.5 || sr.t < -0.5 || sr.r > vw + 0.5 || sr.b > vh + 0.5) bad.push(tag + ': the strip leaves the screen ' + JSON.stringify(sr));
    if (strip.scrollWidth > strip.clientWidth + 1) bad.push(tag + ': the strip is wider than the screen');
    const slots = [...strip.querySelectorAll(':scope > .dp-lay-slot')].map((s) => ({ k: s.getAttribute('data-slot'), r: rect(s), el: s }));
    if (slots.map((s) => s.k).join() !== 'mic,phase,crew,sec') bad.push(tag + ': slots ' + slots.map((s) => s.k).join());
    /* fixed slots: the same place whatever is set (portrait moves the crew to its own row only while it is drawn) */
    const key = slots.filter((s) => s.k !== 'crew').map((s) => s.k + Math.round(s.r.l) + ',' + Math.round(s.r.w)).join(' ');
    if (slotsSeen === null) slotsSeen = key; else if (slotsSeen !== key) bad.push(tag + ': a slot moved: ' + key + ' vs ' + slotsSeen);
    for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++) if (slots[i].r.w && slots[j].r.w && cut(slots[i].r, slots[j].r)) bad.push(tag + ': slots ' + slots[i].k + ' and ' + slots[j].k + ' overlap');
    for (const s of slots) {
      if (!inside(s.r, sr)) bad.push(tag + ': slot ' + s.k + ' outside the strip');
      /* everything drawn in a slot is drawn inside it (a long text is clipped by its own slot, never laid over the next) */
      for (const e of s.el.querySelectorAll('*')) {
        if (!e.getClientRects().length || getComputedStyle(e).visibility === 'hidden') continue;
        const r = rect(e); if (!r.w || !r.h) continue;
        const vis = { l: Math.max(r.l, s.r.l), t: Math.max(r.t, s.r.t), r: Math.min(r.r, s.r.r), b: Math.min(r.b, s.r.b) };
        for (const o of slots) if (o !== s && o.r.w && vis.r > vis.l && vis.b > vis.t && cut(vis, o.r)) bad.push(tag + ': ' + e.className + ' in ' + s.k + ' crosses into ' + o.k);
      }
    }
    /* below the strip: the beats' layer and the AUTO chip */
    if (rect(ov).t < sr.b - 0.5) bad.push(tag + ': the beats start under the strip');
    if (cut(rect(chip), sr)) bad.push(tag + ': the AUTO chip is under the strip');
    /* the crew: one cell per face; a PC's cell names it by its first name */
    if (faces && c.m !== 'start') {
      const cells = strip.querySelectorAll('.dp-lay-face');
      if (cells.length !== faces.length) bad.push(tag + ': ' + cells.length + ' crew cells for ' + faces.length + ' faces');
      for (const cell of cells) { const cr = rect(cell); if (!cr.w || !inside(cr, slots[2].r)) bad.push(tag + ': a crew cell outside the crew slot'); }
    }
    if (c.m === 'start' && [...strip.querySelectorAll('.dp-lay-face')].some((e) => e.getClientRects().length)) bad.push(tag + ': a face shows in the strip during the hard start');
    if (c.l && !strip.querySelector('.dp-lay-s-mic .dp-onair')) bad.push(tag + ': the lamp is not in the mic slot');
    if (root.querySelector(':scope > .dp-onair')) bad.push(tag + ': a corner lamp beside the band');
    L.destroy(); root.remove();
  }
  host.remove();
  return { n: list.length, bad: bad.slice(0, 12), count: bad.length };
};

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
try {
  for (const [w, h] of [[1024, 768], [768, 1024], [1180, 820]]) {
    await step('every layer combination at ' + w + 'x' + h + ': one strip, fixed slots, nothing in one slot crosses into another, everything else below it', async () => {
      const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: w, height: h } });
      const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e && e.message || e)));
      await p.goto(BASE + '/lookbook.html?frame=band-all');
      await p.waitForSelector('.dp-lay-strip', { timeout: 20000 });
      await p.evaluate(() => document.fonts.ready);
      const list = combos();
      const r = await p.evaluate(measure, list);
      expect(r.n > 150, 'combinations measured: ' + r.n);
      expect(r.count === 0, r.count + ' problems, the first: ' + r.bad.join(' | '));
      expect(errs.length === 0, 'page errors: ' + errs.join(' | '));
      if (SHOTS) for (const f of ['band-all', 'band-start']) { await p.goto(BASE + '/lookbook.html?frame=' + f); await sleep(1800); await p.screenshot({ path: path.join(SHOTS, f + '-' + w + 'x' + h + '.png') }); }
      await ctx.close();
    });
  }

  expect((await gm('PUT', '/api/gm/display', { kind: 'svg', title: 'The Pelican Rooms', caption: 'Ground floor', svg: SVG })).status === 200, 'a map');
  expect((await gm('PATCH', '/api/campaign', { mission: { v: 1, site: 'The Pelican Rooms', t: 90, seq: 1, hud: HUD } })).status === 200, 'a mission');
  for (const [p, v] of [['band.phase', 'score'], ['band.security', 3], ['band.onair', true], ['band.faces', PCS]]) expect((await gm('PATCH', '/api/gm/ambient', { layer: { path: p, value: v } })).status === 200, 'layer ' + p);

  for (const [w, h] of [[1024, 768], [768, 1024], [1180, 820], [1366, 1024]]) {
    const portrait = h > w;
    await step('the iPad at ' + w + 'x' + h + ' with a map, the band beside it and every layer: the strip covers none of them, and the band beside the map fits', async () => {
      const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: w, height: h } });
      const page = await ctx.newPage(); const calls = []; page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) calls.push(u.pathname); });
      await page.goto(BASE + '/');
      await page.waitForFunction(() => document.body.dataset.mode === 'display' && document.querySelector('.dp-lay-strip') && document.querySelector('.dp-band:not([hidden])'), null, { timeout: 20000 });
      await page.evaluate(() => { document.querySelector('.dp-auto').hidden = false; });
      await sleep(1500);
      const g = await page.evaluate(() => {
        const box = (q) => { const x = document.querySelector(q); if (!x || !x.getClientRects().length) return null; const r = x.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
        const b = document.querySelector('.dp-band');
        return { strip: box('.dp-lay-strip'), band: box('.dp-band'), svg: box('.dp-map-frame svg'), cap: box('.dp-strip'), auto: box('.dp-auto'), status: box('.dp-status'), lamp: box('.dp-lay-s-mic > *'),
          fit: { sh: b.scrollHeight, ch: b.clientHeight }, cls: b.className, vw: innerWidth };
      });
      const cut = (a, b) => !!a && !!b && Math.max(a.l, b.l) < Math.min(a.r, b.r) - 0.5 && Math.max(a.t, b.t) < Math.min(a.b, b.b) - 0.5;
      expect(g.strip && g.band && g.svg && g.lamp, 'all measured: ' + JSON.stringify({ s: !!g.strip, b: !!g.band, m: !!g.svg, l: !!g.lamp }));
      expect(g.strip.l <= 0.5 && g.strip.r >= g.vw - 0.5 && g.strip.t <= 0.5, 'the strip runs across the top: ' + JSON.stringify(g.strip));
      for (const k of ['band', 'svg', 'cap', 'auto', 'status']) expect(!cut(g.strip, g[k]), 'the strip covers the ' + k + ': ' + JSON.stringify([g.strip, g[k]]));
      if (!portrait) expect(Math.abs(g.band.t - g.strip.b) <= 1, 'the band beside the map starts where the strip ends: ' + g.band.t + ' vs ' + g.strip.b);
      expect(g.fit.sh <= g.fit.ch + 1, 'the band beside the map fits its box (' + g.cls + '): ' + JSON.stringify(g.fit));
      expect(calls.every((u) => u !== '/api/campaign' && u !== '/api/npcs'), 'no new reads: ' + [...new Set(calls)].join(','));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'ipad-map-band-' + w + 'x' + h + '.png') });
      /* a held face (N0's review: the card was drawn over the band's words): it takes the band's own column, the band's words stand down, the map stays clear */
      expect((await gm('PUT', '/api/npcs/npc_bd_lotte', { name: 'Lotte Brand', alias: 'The Latch', role: 'Doorwoman', faction: 'The Kestrel Club', gmNotes: 'GM-ONLY-note', revealed: true })).status === 200, 'a revealed NPC');
      expect((await gm('PATCH', '/api/gm/ambient', { overlay: { id: 'b17sl-bd' + w, kind: 'npc', ms: 60000, npcId: 'npc_bd_lotte' } })).status === 200, 'held on the iPad');
      await page.waitForFunction(() => document.querySelector('.dp-ov-card.dp-ov-in'), null, { timeout: 15000 });
      await sleep(700);
      const held = await page.evaluate(() => {
        const box = (e) => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
        const card = box(document.querySelector('.dp-ov-card')), band = document.querySelector('.dp-band');
        const words = [...band.querySelectorAll('p, span')].filter((e) => getComputedStyle(e).visibility !== 'hidden' && e.textContent.trim() && e.getClientRects().length).map(box);
        return { card, band: box(band), svg: box(document.querySelector('.dp-map-frame svg')), strip: box(document.querySelector('.dp-lay-strip')), words, vh: innerHeight };
      });
      expect(held.words.every((r) => !cut(r, held.card)), 'no word of the band beside the map is under the card: ' + held.words.filter((r) => cut(r, held.card)).length);
      expect(!cut(held.card, held.svg) && !cut(held.card, held.strip), 'the card keeps off the map and the iPad\'s band: ' + JSON.stringify(held));
      expect(held.card.l >= held.band.l - 0.5 && held.card.r <= held.band.r + 0.5 && held.card.t >= held.band.t - 0.5 && held.card.b <= held.vh + 0.5, 'it sits in the band\'s own column: ' + JSON.stringify([held.card, held.band]));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'ipad-held-face-band-' + w + 'x' + h + '.png') });
      expect((await gm('PATCH', '/api/gm/ambient', { overlay: null })).status === 200, 'taken down');
      await page.waitForFunction(() => !document.querySelector('.dp-root.dp-ov-up') && getComputedStyle(document.querySelector('.dp-band .dp-b-sec')).visibility !== 'hidden', null, { timeout: 15000 });
      /* lights out: true black, all but the lamp */
      expect((await gm('PUT', '/api/gm/display', { kind: 'dark' })).status === 200, 'lights out');
      await page.waitForFunction(() => document.querySelector('.dp-root.dp-lights-out'), null, { timeout: 15000 });
      const dark = await page.evaluate(() => ({ shown: [...document.querySelectorAll('.dp-lay-slot')].filter((s) => getComputedStyle(s).visibility !== 'hidden' && s.textContent.trim()).map((s) => s.getAttribute('data-slot')), bg: getComputedStyle(document.querySelector('.dp-lay-strip')).backgroundColor }));
      expect(dark.shown.join() === 'mic' && /rgb\(0, 0, 0\)/.test(dark.bg), 'only the mic slot (ON AIR) over lights out: ' + JSON.stringify(dark));
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'ipad-lights-out-' + w + 'x' + h + '.png') });
      expect((await gm('PUT', '/api/gm/display', { kind: 'svg', title: 'The Pelican Rooms', caption: 'Ground floor', svg: SVG })).status === 200, 'the map again');
      await page.waitForFunction(() => !document.querySelector('.dp-root.dp-lights-out'), null, { timeout: 15000 });
      await ctx.close();
    });
  }

  await step('the display GET with every layer set: quick, and the same one request a poll always was', async () => {
    const t = [];
    for (let i = 0; i < 12; i++) { const t0 = performance.now(); const r = await fetch(BASE + '/api/gm/display', { headers: { 'X-Dev-User': IPAD } }); await r.text(); t.push(performance.now() - t0); }
    t.sort((a, b) => a - b);
    const med = t[Math.floor(t.length / 2)];
    console.log('     display GET median ' + med.toFixed(1) + ' ms (local, round trip)');
    expect(med < 60, 'the round trip median is ' + med.toFixed(1) + ' ms');
  });

  await step('the look book: "Band: everything on" and "Band: hard start faces" are cards, drawn without an error', async () => {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e && e.message || e)));
    await p.goto(BASE + '/lookbook.html');
    await p.waitForSelector('.lb-card', { timeout: 20000 });
    const kinds = await p.evaluate(() => [...document.querySelectorAll('.lb-card figcaption code')].map((c) => c.textContent));
    expect(kinds.includes('band-all') && kinds.includes('band-start'), 'cards: ' + kinds.join(','));
    const fr = p.frames().find((f) => f.url().includes('frame=band-start'));
    expect(!!fr, 'the hard start card has a frame');
    await fr.waitForSelector('.dp-hs-face', { timeout: 20000 });
    const hs = await fr.evaluate(() => ({ plates: document.querySelectorAll('.dp-hs-face').length, lamp: !!document.querySelector('.dp-lay-s-mic .dp-onair') }));
    expect(hs.plates === 3 && hs.lamp, 'the hard start draws its plates under the band, the lamp in its slot: ' + JSON.stringify(hs));
    expect(errs.length === 0, 'page errors: ' + errs.join(' | '));
    await ctx.close();
  });
} finally {
  await browser.close();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
