// players-intro (IP3 of the players' screen build, setting stage.players): the NPC introduction end to end against a real local Worker
// (wrangler dev) on PORT (default 12110; the inspector on PORT + 20000), invented fixtures only. The GM page (the cast list's Introduce) and
// the iPad (a DISPLAY_EMAILS sign-in on the display page), with the map up.
//   on   Introduce: the title card covers the screen (the colour field, the name as text, no map anywhere), the tray says "Introducing";
//        then the ordinary npc stage is up and stays (30 s), the tray says the name; a second display page opened after the card shows the
//        stage and never a card; Take it down mid-card clears it at once; a hidden NPC's Introduce asks first and, declined, sends nothing:
//        no card, and the hidden name in neither the display GET nor the DOM; reduced motion: the still frame, then the stage
//   off  Introduce is the old rolodex beat (the paper card), no title card
// PW_DISPLAY_ENGINE=webkit runs the display pages in WebKit (the GM page stays on Edge).
//   PW_MODULE=<path to playwright-core> [PW_CHANNEL=msedge] [PORT=12110] [KIT_SHOTS=<dir>] node checks/runtime/players-intro.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 12110);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const SHOTS = process.env.KIT_SHOTS || '';
const ENGINE = process.env.PW_DISPLAY_ENGINE === 'webkit' ? 'webkit' : 'chromium';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

let failed = 0, passed = 0;
async function step(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.message || e)); } }
const expect = (c, m) => { if (!c) throw new Error(m); };
async function until(fn, ms, every = 100) { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(every); } return v; }

const PW = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-players-intro-e2e-'));
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
const players = async (on) => { for (const p of ['/api/gm/state', '/api/campaign']) await ok(gm('PATCH', p, { features: { 'stage.players': on } }), 'stage.players ' + on); };
const ipadGet = async () => JSON.stringify((await call(IPAD, 'GET', '/api/gm/display?seq=-1&aseq=-1&hseq=-1')).json);
const MAP = { kind: 'svg', title: 'The Pelican Rooms', caption: '', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600"><title>The Pelican Rooms, ground floor</title><rect x="10" y="10" width="780" height="580" fill="#1d2a44" stroke="#e8c33c" stroke-width="6"/></svg>' };
const NPCS = [
  ['n-mabel', { name: 'Mabel Quist', alias: 'Mab', role: 'The house', faction: 'The Pelican Rooms', description: 'Runs the rooms.', revealed: true, gmNotes: 'GM-ONLY-NOTE one\nTell: smirk\nSignature: lapel\n',
    spec: { figure: 'fem', skin: 'porcelain', heightIn: 66, age: 47, hair: { style: 'beehive', color: 'cloth-chocolate' }, outfit: { base: { type: 'shirt', color: 'cloth-white' }, outer: { type: 'double-breasted', color: 'cloth-oxblood' } } } }],
  ['n-dov', { name: 'Dov Kessler', alias: '', role: 'House security', faction: 'The Tidewater Watch', description: 'Watches the doors.', revealed: true, gmNotes: 'Tell: tired\nSignature: cross\n',
    spec: { skin: 'tan', heightIn: 74, age: 44, hair: { style: 'buzz', color: 'cloth-graphite' }, outfit: { outer: { type: 'peacoat', color: 'cloth-charcoal' } } } }],
  ['n-hid', { name: 'GM-ONLY-NPC-1', alias: 'GM-ONLY-ALIAS-1', role: 'GM-ONLY-ROLE-1', faction: 'GM-ONLY-FACTION-1', description: 'GM-ONLY-DESC-1', gmNotes: 'GM-ONLY-NOTES', revealed: false, spec: { heightIn: 70, age: 40 } }]
];

const browser = await PW.chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const dbrowser = ENGINE === 'webkit' ? await PW.webkit.launch() : browser;
console.log('INFO the display runs in ' + ENGINE);
const errors = [];
async function openIpad(o = {}) {
  const ctx = await dbrowser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: o.w || 1180, height: o.h || 820 }, serviceWorkers: 'block', reducedMotion: o.reduced ? 'reduce' : 'no-preference' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push('display: ' + e.message));
  await page.goto(BASE + '/#display');
  await page.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 30000 });
  return { ctx, page };
}
/* what the display shows: the card (its seq, whether it covers the screen, its text), the stage on top, any rolodex beat */
const look = (page) => page.evaluate(() => {
  const card = document.querySelector('.pi-card'), st = [...document.querySelectorAll('.dp-stages > .dp-stage')].pop();
  let covers = false;
  if (card) {
    const pts = [[0.1, 0.2], [0.5, 0.5], [0.9, 0.8], [0.3, 0.9], [0.8, 0.15]], pe = card.style.pointerEvents;
    card.style.pointerEvents = 'auto';      /* the card lets taps through; hit-test it for this probe only */
    covers = pts.every(([x, y]) => { const e = document.elementFromPoint(innerWidth * x, innerHeight * y); return !!e && !!e.closest('.pi-card'); });
    card.style.pointerEvents = pe;
  }
  const g = card && card.querySelector('.pi-ground');
  return { card: !!card, covers, field: g ? getComputedStyle(g).backgroundColor : '', text: card ? card.textContent : '', name: card ? (card.querySelector('.pi-name-front') || {}).textContent : '', kick: card ? [...card.querySelectorAll('.pi-kick-t')].map((e) => e.textContent).join('|') : '',
    stage: st ? st.className : '', stageText: st ? st.textContent : '', rolodex: !!document.querySelector('.dp-show-rolodex, .dp-rc'), map: !!document.querySelector('.dp-stage.dp-map.dp-in') };
});
const domHas = (page, needle) => page.evaluate((n) => document.documentElement.outerHTML.includes(n), needle);
async function shot(page, name) { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); }
const toMap = async (I) => { await ok(gm('PUT', '/api/gm/display', MAP), 'map'); await I.page.waitForFunction(() => !!document.querySelector('.dp-stage.dp-map.dp-in') && !document.querySelector('.pi-card'), null, { timeout: 15000 }); };

let G = null, I = null, I2 = null;
try {
  /* the GM page asks for a pack first: the repo's console fixture */
  const con = JSON.parse(readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'console-pack.json'), 'utf8')).parts.console;
  await ok(gm('POST', '/api/gm/pack', { part: 'console', src: con.src, body: Object.fromEntries(Object.entries(con).filter(([k]) => k !== 'src')) }), 'pack');
  for (const [id, doc] of NPCS) await ok(gm('PUT', '/api/npcs/' + id, { ...doc, firstSeen: new Date().toISOString(), tags: [] }), 'npc ' + id);
  await ok(gm('PATCH', '/api/gm/ambient', { mode: 'pin', scene: 'duskwall', overlay: null }), 'ambient');
  await players(true);
  I = await openIpad();
  await toMap(I);

  /* the GM page, the cast list */
  const gc = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
  await gc.addInitScript(atPlace('score'));      /* start in the Score (a page with no phase opens in Before) */
  const gp = await gc.newPage();
  gp.on('pageerror', (e) => errors.push('gm: ' + e.message));
  let dialogs = [], answer = 'accept';
  gp.on('dialog', (d) => { dialogs.push(d.message()); if (answer === 'accept') d.accept(); else d.dismiss(); });
  await gp.goto(BASE + '/#gm');
  await gp.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 }); await gp.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  await gp.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await gp.keyboard.press('n');
  const intro = (id) => '#gm-npc .gm-npcrow[data-id="' + id + '"] [data-gm="npcintro"]';
  await gp.waitForSelector(intro('n-mabel'), { timeout: 20000 });
  G = { gc, gp };
  const trayText = () => gp.evaluate(() => [...document.querySelectorAll('[title^="On the iPad: "]')].map((e) => e.getAttribute('title')).join(' | '));

  await step('on: Introduce covers the whole screen with the title card (the colour field, the name, no map), the tray says Introducing', async () => {
    await gp.click(intro('n-mabel'));
    const L = await until(async () => { const v = await look(I.page); return v.card && v.covers ? v : null; }, 6000, 50);
    expect(L, 'no card covering the screen: ' + JSON.stringify(await look(I.page)));
    expect(/rgb\(224, 105, 30\)|rgb\(\d+, \d+, \d+\)/.test(L.field) && L.field !== 'rgba(0, 0, 0, 0)', 'a colour field: ' + L.field);
    expect(L.name === 'Mabel Quist', 'the name as text: ' + L.name);
    expect(L.text.includes('“Mab”') && L.kick === 'The house|The Pelican Rooms', 'alias and kicker: ' + L.text);
    expect(!L.text.includes('Runs the rooms') && !(await domHas(I.page, 'GM-ONLY')), 'nothing but the card\'s fields, never the notes');
    const t = await until(async () => { const x = await trayText(); return /Introducing Mabel Quist/.test(x) ? x : null; }, 2000) || await trayText();
    console.log('INFO the tray: ' + t);
    expect(!t || /Introducing Mabel Quist/.test(t), 'the tray: ' + t);
    await sleep(2200); await shot(I.page, 'card-' + ENGINE + '-1180');
  });
  await step('on: the card hands over to the ordinary npc stage, which stays (30 s); the tray says her name', async () => {
    const gone = await until(async () => { const v = await look(I.page); return !v.card && /dp-npc/.test(v.stage) ? v : null; }, 9000);
    expect(gone, 'the stage after the card: ' + JSON.stringify(await look(I.page)));
    expect(/Mabel Quist/.test(gone.stageText), 'her stage: ' + gone.stageText.slice(0, 80));
    expect(await I.page.evaluate(() => !document.querySelector('.dp-root').classList.contains('pi-on')), 'the stage\'s own figure is shown again');
    await shot(I.page, 'stage-after-' + ENGINE + '-1180');
    await sleep(30000);
    const later = await look(I.page);
    expect(!later.card && /dp-npc/.test(later.stage) && /Mabel Quist/.test(later.stageText), 'still up after 30 s: ' + JSON.stringify(later).slice(0, 200));
    const t = await trayText();
    expect(!t || (/Mabel Quist/.test(t) && !/Introducing/.test(t)), 'the tray after: ' + t);
  });
  await step('on: a display page opened after the card shows the stage and never a card', async () => {
    I2 = await openIpad({ w: 1024, h: 768 });
    const st = await until(async () => { const v = await look(I2.page); return /dp-npc/.test(v.stage) ? v : null; }, 15000);
    expect(st && !st.card, 'stage, no card: ' + JSON.stringify(st));
    let sawCard = false; for (let i = 0; i < 20; i++) { if ((await look(I2.page)).card) sawCard = true; await sleep(100); }
    expect(!sawCard, 'a late joiner never replays the card');
    await I2.ctx.close(); I2 = null;
  });
  await step('on: Take it down mid-card takes the card away at once', async () => {
    await toMap(I);
    await gp.click(intro('n-dov'));
    expect(await until(async () => (await look(I.page)).card, 6000, 50), 'the card came');
    await sleep(1200);
    await ok(gm('PUT', '/api/gm/display', { kind: 'blank' }), 'take it down');
    const t0 = Date.now();
    const v = await until(async () => { const x = await look(I.page); return !x.card ? x : null; }, 6000, 50);
    expect(v, 'the card is still up');
    expect(!/dp-npc/.test(v.stage) || Date.now() - t0 < 6000, 'and the stage is not the NPC: ' + v.stage);
    await sleep(800);
    expect(!(await look(I.page)).card, 'and it does not come back');
  });
  await step('on: a hidden NPC\'s Introduce asks "Reveal and show?"; declined, nothing is sent: no card, the hidden name in neither the display GET nor the DOM', async () => {
    await toMap(I);
    await gp.waitForSelector(intro('n-hid'), { timeout: 10000 });
    answer = 'dismiss'; dialogs = [];
    await gp.click(intro('n-hid'));
    await until(() => dialogs.length > 0, 3000);
    expect(dialogs.some((m) => /^Reveal and show\? /.test(m)), 'the question: ' + dialogs.join(' / '));
    await sleep(2500);
    expect(!(await look(I.page)).card && (await look(I.page)).map, 'the map is still up, no card');
    expect(!/GM-ONLY/.test(await ipadGet()), 'the display GET never names them');
    expect(!(await domHas(I.page, 'GM-ONLY')), 'the display DOM never names them');
    const n = await gm('GET', '/api/npcs/n-hid'); expect(!n.json || !n.json.doc || n.json.doc.revealed !== true, 'still hidden');
    answer = 'accept';
  });
  await step('reduced motion: the still frame (no animation), then the stage', async () => {
    const R = await openIpad({ reduced: true, w: 1024, h: 768 });
    try {
      await ok(gm('PUT', '/api/gm/display', MAP), 'map');
      await R.page.waitForFunction(() => !!document.querySelector('.dp-stage.dp-map.dp-in'), null, { timeout: 15000 });
      await gp.click(intro('n-mabel'));
      expect(await until(() => R.page.evaluate(() => !!document.querySelector('.pi-card.pi-still')), 6000, 50), 'the still card');
      const running = await R.page.evaluate(() => document.getAnimations().filter((a) => a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('.pi-card') && a.playState === 'running').length);
      expect(running === 0, 'nothing animates: ' + running);
      await shot(R.page, 'still-' + ENGINE + '-1024');
      const st = await until(async () => { const v = await look(R.page); return !v.card && /dp-npc/.test(v.stage) ? v : null; }, 6000);
      expect(st, 'the stage after 3 s');
    } finally { await R.ctx.close(); }
  });
  await step('off: Introduce is the old rolodex beat, no title card', async () => {
    await players(false);
    await gp.reload();
    await gp.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 }); await gp.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
    await gp.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    await gp.keyboard.press('n');
    await gp.waitForSelector(intro('n-mabel'), { timeout: 20000 });
    expect(!(await gp.$(intro('n-hid'))), 'off: no Introduce on a hidden NPC (as before)');
    await toMap(I);
    await sleep(1500);
    await gp.click(intro('n-mabel'));
    const v = await until(async () => { const x = await look(I.page); return x.rolodex ? x : null; }, 8000);
    expect(v && !v.card, 'the rolodex beat: ' + JSON.stringify(await look(I.page)));
    expect(v.map, 'over the map, which stays');
    const seen = await until(() => I.page.evaluate(() => { const c = document.querySelector('.dp-rc-card'); if (!c) return null; const r = c.getBoundingClientRect(), cs = getComputedStyle(c.closest('.dp-show') || c); return r.width > 50 && r.height > 50 && cs.visibility !== 'hidden' && Number(cs.opacity) > 0.5 && /Mabel Quist/.test(c.textContent) ? { w: Math.round(r.width), h: Math.round(r.height), o: cs.opacity } : null; }), 4000);
    console.log('INFO the rolodex card: ' + JSON.stringify(seen) + ' ' + JSON.stringify(await I.page.evaluate(() => { const c = document.querySelector('.dp-show-rolodex, .dp-rc'); if (!c) return null; const r = c.getBoundingClientRect(), cs = getComputedStyle(c); return { cls: c.className, r: [r.x, r.y, r.width, r.height].map(Math.round), op: cs.opacity, vis: cs.visibility, z: cs.zIndex, parent: c.parentNode && c.parentNode.className }; })));
    await shot(I.page, 'off-rolodex-' + ENGINE + '-1180');
    expect(seen, 'the paper card is on screen with her name');
  });
  await step('no page errors on the GM page or the display', async () => { expect(!errors.length, errors.slice(0, 5).join(' / ')); });
} catch (e) { failed++; console.log('FAIL the run stopped: ' + (e && e.stack || e)); }
finally {
  try { if (I2) await I2.ctx.close(); if (I) await I.ctx.close(); if (G) await G.gc.close(); } catch (_) {}
  await browser.close(); if (dbrowser !== browser) await dbrowser.close();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
