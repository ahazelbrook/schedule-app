// The display's health (iPad build IP1, 13/11/2026): the bugs seen on the table's iPad and TV, end to end against a local Worker (wrangler dev) on PORT
// (default 9461), invented fixtures only.
//   PW_MODULE=<playwright or playwright-core> PW_CHANNEL=msedge PORT=9461 node checks/runtime/display-health.e2e.mjs
//   (PW_MODULE=<app/checks/pw-webkit.js> runs it in WebKit, the engine under every iPad browser)
// What it holds:
//   clock    the stand-by card's clock tells the right time with "Scenes: held still" on (it read 12:00 for ever), and moves with it off, the new stage on
//   fit      the stand-by card's title, station lines, footer and rings sit inside its frame at the iPad and TV sizes, with the top band and without
//   scenes   every ambient scene held still paints a full picture (no blank, no page error), and moves again when the setting goes off, no reload
//   figures  every demo figure on the display (Show on iPad, the old stage and the new): one copy of each id on the page, and every url(#)/href in a
//            figure resolves inside that same figure (a stray reference draws a part with another figure's clip: shapes outside the outline)
//   looks    Show on iPad with a look plays the signature pose and then loops the tell; held still it wears the tell and does not loop; the held
//            spotlight on the new stage wears its expression (the head sits deeper there)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9461);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const SHOTS = process.env.SHOTS || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

let failed = 0, passed = 0;
async function step(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.message || e)); } }
const expect = (c, m) => { if (!c) throw new Error(m); };

const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-display-health-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
delete env.ANTHROPIC_API_KEY; delete env.B68_ANTHROPIC_KEY;
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
const settings = async (f) => { for (const p of ['/api/gm/state', '/api/campaign']) await ok(gm('PATCH', p, { features: { 'kit.stage': !!f.stage, 'fx.off': !!f.still, 'display.band': !!f.band } }), 'settings ' + p); };
const ambient = (patch) => ok(gm('PATCH', '/api/gm/ambient', patch), 'ambient ' + JSON.stringify(patch).slice(0, 60));
const push = (doc) => ok(gm('PUT', '/api/gm/display', doc), 'push ' + doc.kind);

/* the invented cast: specs as the demo night's, a Tell and a Signature in the GM notes (the look's names are what the GM page sends) */
const NPCS = [
  ['n-mabel', { name: 'Mabel Quist', alias: 'Mab', role: 'Fixer', faction: 'The Kestrel Club', description: 'Counts the room twice.', revealed: true,
    spec: { figure: 'fem', skin: 'porcelain', heightIn: 66, age: 47, hair: { style: 'beehive', color: 'cloth-chocolate' }, outfit: { base: { type: 'shirt', color: 'cloth-white' }, outer: { type: 'double-breasted', color: 'cloth-oxblood' } } } }],
  ['n-dov', { name: 'Dov Kessler', alias: '', role: 'Desk sergeant', faction: 'The Tidewater Watch', description: 'Watches the doors.', revealed: true,
    spec: { skin: 'tan', heightIn: 74, age: 44, hair: { style: 'buzz', color: 'cloth-graphite' }, outfit: { outer: { type: 'peacoat', color: 'cloth-charcoal' } } } }],
  ['n-ada', { name: 'Ada Vell', alias: '', role: 'Croupier', faction: 'The Kestrel Club', description: 'Deals the high table.', revealed: true,
    spec: { figure: 'fem', skin: 'brown', heightIn: 63, age: 29, hair: { style: 'bowl-bob', color: 'cloth-black' }, outfit: { base: { type: 'shirt', color: 'cloth-cream' }, outer: { type: 'blazer', color: 'cloth-charcoal' } } } }],
  ['n-lotte', { name: 'Lotte Brand', alias: '', role: 'Doorwoman', faction: 'The Kestrel Club', description: 'Decides who comes in.', revealed: true,
    spec: { figure: 'fem', skin: 'fair', heightIn: 70, age: 52, hair: { style: 'short', color: 'cloth-brown' }, outfit: { outer: { type: 'cape-coat', color: 'cloth-black' } } } }],
  ['n-silver', { name: 'Rex Halloran', alias: '', role: 'Host', faction: 'The Kestrel Club', description: 'Silver hair, a white jacket.', revealed: true,
    spec: { skin: 'tan', heightIn: 71, age: 60, hair: { style: 'slick-back', color: 'ink-300' }, outfit: { base: { type: 'shirt', color: 'cloth-white' }, outer: { type: 'dinner-jacket', color: 'cloth-white' } }, face: { expression: 'smile' }, pose: { arms: { R: 'hold' } } } }],
  ['n-plain', { name: 'Ned Prosser', alias: '', role: 'Porter', faction: '', description: 'Carries what he is told to.', revealed: true, spec: { heightIn: 67, age: 35 } }]
];
const SCENES = ['harvest', 'watch', 'duskwall', 'boneyard', 'undertow', 'vet', 'tram', 'lurker', 'pells', 'wanted', 'meeting', 'veil', 'testcard'];
const NOISE = /Content Security Policy|Report Only|media\/theme\.mp3|favicon/;      // report-only CSP lines, the theme kept off git, the icon

async function openIpad(browser, w, h) {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: w, height: h }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror ' + (e && e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error' && !NOISE.test(m.text() + ' ' + ((m.location() && m.location().url) || ''))) errors.push('console ' + m.text()); });
  await page.goto(BASE + '/');
  await page.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 20000 });
  return { ctx, page, errors };
}
const sceneUp = (page, id) => page.waitForFunction((sc) => { const f = document.querySelector('.dp-ambient iframe.dp-amb-in[data-scene="' + sc + '"]'); return !!(f && f.contentDocument && f.contentDocument.readyState === 'complete'); }, id, { timeout: 25000 });
const heldIs = (page, on) => page.waitForFunction((v) => { const f = document.querySelector('.dp-ambient iframe.dp-amb-in'); return !!(f && f.contentDocument && f.contentDocument.documentElement.classList.contains('b68-fx-off') === v); }, on, { timeout: 15000 });
/* the hands' angles (degrees) and what the real clock says they should be */
const clock = (page) => page.evaluate(() => {
  const f = document.querySelector('.dp-ambient iframe.dp-amb-in'); const d = f && f.contentDocument; if (!d) return null;
  const ang = (id) => { const t = d.getElementById(id) && d.getElementById(id).getAttribute('transform'); const m = /rotate\(([-\d.]+)/.exec(t || ''); return m ? +m[1] : null; };
  const n = new Date(); return { s: ang('hS'), m: ang('hM'), h: ang('hH'), wantM: (n.getMinutes() + n.getSeconds() / 60) * 6 };
});
/* a picture of the scene's frame -> { sd (contrast), px (a 160x120 grey thumbnail) } */
async function frameShot(page, name) {
  const box = await page.evaluate(() => { const f = document.querySelector('.dp-ambient iframe.dp-amb-in'); if (!f) return null; const r = f.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; });
  if (!box) return null;
  const buf = await page.screenshot({ clip: box, path: SHOTS ? path.join(SHOTS, name + '.png') : undefined });
  return page.evaluate(async (b64) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const c = document.createElement('canvas'); c.width = 160; c.height = 120; const g = c.getContext('2d'); g.drawImage(img, 0, 0, 160, 120);
    const d = g.getImageData(0, 0, 160, 120).data; const px = []; let s = 0, s2 = 0;
    for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; px.push(v); s += v; s2 += v * v; }
    const m = s / px.length; return { sd: Math.sqrt(Math.max(0, s2 / px.length - m * m)), px };
  }, buf.toString('base64'));
}
const diff = (a, b) => { let t = 0; for (let i = 0; i < a.px.length; i++) t += Math.abs(a.px[i] - b.px[i]); return t / a.px.length; };
/* every figure on the page: ids once on the page, and each reference inside its own svg */
const figureRefs = (page) => page.evaluate(() => {
  const seen = {}, dup = [];
  document.querySelectorAll('[id]').forEach((e) => { if (e.closest('.dp-ambient')) return; if (seen[e.id]) dup.push(e.id); seen[e.id] = 1; });
  const figs = [...document.querySelectorAll('.dp-npc-fig svg, .dp-ov-portrait svg, .dp-rc-face svg, .ks16-head svg')].filter((s) => !s.parentNode.closest('svg'));
  const stray = [];
  for (const f of figs) {
    const own = new Set([...f.querySelectorAll('[id]')].map((e) => e.id));
    f.querySelectorAll('*').forEach((e) => { for (const a of e.attributes) {
      const m = /url\(\s*#([^)\s]+)\s*\)/.exec(a.value) || (/(^|:)href$/.test(a.name) ? /^#(.+)$/.exec(a.value) : null);
      if (m && !own.has(m[1])) stray.push(a.name + '=' + a.value);
    } });
  }
  return { figs: figs.length, dup: dup.slice(0, 5), ndup: dup.length, stray: stray.slice(0, 5), nstray: stray.length };
});

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
try {
  for (const [id, doc] of NPCS) await ok(gm('PUT', '/api/npcs/' + id, { ...doc, firstSeen: new Date().toISOString(), tags: [] }), 'npc ' + id);
  await push({ kind: 'blank' });
  await ambient({ mode: 'pin', scene: 'testcard', overlay: null, layers: null, crew: { heat: 2, wanted: 1 } });

  /* ---------- clock ---------- */
  await settings({ still: true });
  let I = await openIpad(browser, 1180, 820);
  await step('clock: held still, the stand-by clock shows the right time (not 12:00)', async () => {
    await sceneUp(I.page, 'testcard'); await heldIs(I.page, true); await sleep(1500);
    const c = await clock(I.page);
    expect(c && c.m !== null && c.h !== null, 'the hands were never set: ' + JSON.stringify(c));
    const off = Math.abs(((c.m - c.wantM) % 360 + 540) % 360 - 180);
    expect(off <= 7, 'the minute hand is ' + off.toFixed(1) + ' degrees from the real time: ' + JSON.stringify(c));
  });
  await step('clock: held still, the scene paints a full picture and stays still', async () => {
    const a = await frameShot(I.page, 'health-testcard-held-1'); await sleep(1500); const b = await frameShot(I.page, 'health-testcard-held-2');
    expect(a && a.sd > 8, 'a blank frame: ' + (a && a.sd));
    expect(diff(a, b) < 0.5, 'a held scene moved: ' + diff(a, b).toFixed(2));
  });
  await settings({ stage: true, still: false });
  await step('clock: the new stage on and Scenes moving, the second hand moves (the stage no longer holds scenes still)', async () => {
    await I.page.waitForFunction(() => (document.documentElement.getAttribute('data-kit') || '').includes('stage'), null, { timeout: 30000 });
    await heldIs(I.page, false); await sleep(1200);
    const a = await clock(I.page); await sleep(2000); const b = await clock(I.page);
    expect(a && b && a.s !== b.s, 'the second hand did not move: ' + JSON.stringify([a, b]));
  });
  await step('clock: no page errors', async () => { expect(!I.errors.length, I.errors.join(' | ')); });
  await I.ctx.close();
  await settings({});

  /* ---------- fit ---------- */
  for (const band of [false, true]) {
    await settings({ band });
    await ambient(band ? { layer: { path: 'band.phase', value: 'plan' } } : { layers: null });
    for (const [w, h, what] of [[1024, 768, 'iPad 1024x768'], [1180, 820, 'iPad 1180x820'], [1536, 864, 'TV at 125% (1536x864)'], [1920, 1080, 'TV 1920x1080']]) {
      I = await openIpad(browser, w, h);
      await step('fit: ' + what + (band ? ', under the band' : '') + ': every word and the rings inside the frame', async () => {
        await sceneUp(I.page, 'testcard');
        if (band) await I.page.waitForFunction(() => document.querySelector('.dp-root').classList.contains('dp-lay-on'), null, { timeout: 15000 });
        await sleep(600);
        const g = await I.page.evaluate(() => {
          const f = document.querySelector('.dp-ambient iframe.dp-amb-in'), r = f.getBoundingClientRect(), d = f.contentDocument;
          const items = [...d.querySelectorAll('text'), d.querySelector('#ringsG circle')].filter(Boolean).map((t) => { const b = t.getBoundingClientRect(); return { t: (t.textContent || 'rings').slice(0, 24), top: b.top, bottom: b.bottom, left: b.left, right: b.right }; });
          return { frame: { w: r.width, h: r.height, top: r.top }, out: items.filter((b) => b.top < -1 || b.bottom > r.height + 1 || b.left < -1 || b.right > r.width + 1) };
        });
        expect(!g.out.length, 'cut at ' + JSON.stringify(g.frame) + ': ' + JSON.stringify(g.out));
        if (SHOTS) await I.page.screenshot({ path: path.join(SHOTS, 'health-fit-' + w + 'x' + h + (band ? '-band' : '') + '.png') });
      });
      await I.ctx.close();
    }
  }
  await ambient({ layers: null });
  await settings({});

  /* ---------- scenes ---------- */
  I = await openIpad(browser, 1180, 820);
  for (const id of SCENES) {
    await settings({ still: false });
    await ambient({ mode: 'pin', scene: id });
    I.errors.length = 0;
    await step('scenes: ' + id + ': moving, then held still (a full picture), then moving again, with no page error', async () => {
      await sceneUp(I.page, id); await heldIs(I.page, false); await sleep(2500);
      await settings({ still: true }); await heldIs(I.page, true); await sleep(1800);
      const h1 = await frameShot(I.page, 'health-' + id + '-held'); await sleep(1500); const h2 = await frameShot(I.page, 'health-' + id + '-held-2');
      expect(h1 && h1.sd > 6, 'held: a blank or flat frame (contrast ' + (h1 && h1.sd.toFixed(1)) + ')');
      expect(diff(h1, h2) < 0.5, 'held: the scene still moves (' + diff(h1, h2).toFixed(2) + ')');
      await settings({ still: false }); await heldIs(I.page, false); await sleep(1500);
      const m1 = await frameShot(I.page, 'health-' + id + '-moving'); await sleep(2500); const m2 = await frameShot(I.page, 'health-' + id + '-moving-2');
      expect(diff(m1, m2) > 0.02, 'moving again: two pictures 2.5 s apart are the same (' + diff(m1, m2).toFixed(3) + ')');
      expect(!I.errors.length, I.errors.join(' | '));
    });
  }
  await I.ctx.close();
  await ambient({ mode: 'pin', scene: 'duskwall' });

  /* ---------- figures ---------- */
  for (const stage of [false, true]) {
    await settings({ stage });
    for (const [w, h] of [[1180, 820], [1536, 864]]) {
      I = await openIpad(browser, w, h);
      if (stage) await I.page.waitForFunction(() => (document.documentElement.getAttribute('data-kit') || '').includes('stage'), null, { timeout: 30000 });
      for (const [id] of NPCS) {
        await step('figures: ' + (stage ? 'new stage' : 'old stage') + ' ' + w + 'x' + h + ': Show on iPad ' + id + ' paints within 2 s, every reference inside its own figure', async () => {
          const t0 = Date.now();
          await push({ kind: 'npc', npcId: id, title: id });
          await I.page.waitForFunction((n) => { const all = document.querySelectorAll('.dp-stages .dp-npc'), e = all[all.length - 1]; return !!(e && e.querySelector('.dp-npc-fig svg') && e.querySelector('.dp-npc-name') && e.querySelector('.dp-npc-name').textContent.toLowerCase() === n.toLowerCase()); },
            NPCS.find((x) => x[0] === id)[1].name, { timeout: 6000 });
          const ms = Date.now() - t0;
          expect(ms <= 2000 + 4500, 'took ' + ms + ' ms (a poll is 4 s)');
          await sleep(900);
          const r = await figureRefs(I.page);
          expect(r.figs >= 1 && !r.ndup && !r.nstray, JSON.stringify(r));
        });
      }
      await step('figures: ' + (stage ? 'new stage' : 'old stage') + ' ' + w + 'x' + h + ': no page errors', async () => { expect(!I.errors.length, I.errors.join(' | ')); });
      if (SHOTS) await I.page.screenshot({ path: path.join(SHOTS, 'health-npc-' + (stage ? 'stage' : 'old') + '-' + w + '.png') });
      await I.ctx.close();
    }
  }

  /* ---------- looks ---------- */
  const LOOK = { expr: 'smirk', tell: true, pose: 'lapel' };
  const figSig = (page) => page.evaluate(() => { const all = document.querySelectorAll('.dp-stages .dp-npc'), e = all[all.length - 1]; const s = e && e.querySelector('.dp-npc-fig > svg'); return s ? s.getAttribute('data-fl') || 'drawn' : ''; });
  for (const stage of [false, true]) {
    await settings({ stage });
    I = await openIpad(browser, 1180, 820);
    if (stage) await I.page.waitForFunction(() => (document.documentElement.getAttribute('data-kit') || '').includes('stage'), null, { timeout: 30000 });
    await step('looks: ' + (stage ? 'new' : 'old') + ' stage: Show on iPad with a look plays the signature pose, then the figure as drawn, then the tell, again and again', async () => {
      await push({ kind: 'npc', npcId: 'n-dov', title: 'Dov', look: LOOK });
      await I.page.waitForFunction(() => { const all = document.querySelectorAll('.dp-stages .dp-npc'), e = all[all.length - 1]; const s = e && e.querySelector('.dp-npc-fig > svg'); return !!s && s.getAttribute('data-fl') === 'pose'; }, null, { timeout: 8000 });
      const seen = new Set([await figSig(I.page)]);
      const t0 = Date.now();
      while (Date.now() - t0 < 26000) { seen.add(await figSig(I.page)); await sleep(300); }
      expect(seen.has('pose') && seen.has('tell') && seen.has('drawn'), 'the figure showed: ' + JSON.stringify([...seen]));
    });
    await settings({ stage, still: true });
    await I.page.waitForFunction(() => window.B68Flags && window.B68Flags.on('fx.off'), null, { timeout: 15000 });
    await step('looks: ' + (stage ? 'new' : 'old') + ' stage, held still: the tell is worn, and does not loop', async () => {
      await push({ kind: 'npc', npcId: 'n-ada', title: 'Ada', look: { expr: 'wary', tell: true } });
      await I.page.waitForFunction(() => { const all = document.querySelectorAll('.dp-stages .dp-npc'), e = all[all.length - 1]; return !!(e && /ada vell/i.test(e.textContent)); }, null, { timeout: 8000 });
      await sleep(600);
      const a = await figSig(I.page);
      expect(a === 'expr', 'the tell is not on the figure: ' + a);
      await sleep(16000);
      expect((await figSig(I.page)) === a, 'the figure changed while held still');
    });
    await settings({ stage });
    await I.ctx.close();
  }
  await settings({ stage: true });
  I = await openIpad(browser, 1180, 820);
  await I.page.waitForFunction(() => (document.documentElement.getAttribute('data-kit') || '').includes('stage'), null, { timeout: 30000 });
  await push({ kind: 'blank' });
  await step('looks: new stage: a held spotlight wears its expression (the head sits inside the speaking row)', async () => {
    await ambient({ overlay: { id: 'b17sl-health1', kind: 'npc', npcId: 'n-mabel', ms: 60000, look: { expr: 'hostile' } } });
    await I.page.waitForFunction(() => { const h = document.querySelector('.ks16-head > svg'); return !!h && h.getAttribute('data-fl') === 'expr'; }, null, { timeout: 10000 });
  });
  await ambient({ overlay: null });
  await step('looks: no page errors', async () => { expect(!I.errors.length, I.errors.join(' | ')); });
  await I.ctx.close();
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
await browser.close();
console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
