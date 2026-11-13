// Handouts on the players' phones (the players' screen build, IP4; setting phone.handouts), end to end against a real local Worker (wrangler dev) on PORT
// (default 12170; the inspector on PORT + 20000). Invented fixtures only: two players (Nell's and Ray's), two flat generated PNGs written into the
// git-ignored app/media/handouts/ for the run (and removed after), and an invented handouts pack part with a GM-ONLY- cue.
//   off      the setting off: the GM page has no Send to and fetches no gm/handout-send.js; a phone has no Handouts button, fetches no sheet/handouts.js
//            and makes no docs request of the kind
//   send     the GM sends the sewer map to Nell: Nell's phone counts it (with a dot), toasts it, lists it and opens it full screen (the image loads);
//            Ray's phone does not list it and none of Ray's responses holds its file name; the GM's chip reads as sent ("Sent to: Nell")
//   everyone Everyone reaches both phones; the shared screen is never sent anything
//   back     the GM takes the sewer map back from Nell while her viewer is open on it: the viewer closes ("The GM took this back"), the list loses it
//   offline  a handout whose file is not there: the list says "Needs a connection"
//   kit      with kit.phone on, the Handouts button is in the top bar on every one of the four screens
//   sizes    390 x 844 and 360 x 640: no sideways scroll; the viewer's Close inside the screen
// KIT_SHOTS=<dir> saves the pictures. Run on Edge (PW_MODULE=playwright-core, PW_CHANNEL=msedge) and on WebKit (PW_MODULE=app/checks/pw-webkit.js
// with PW_CORE_DIR=<playwright-core>).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 12170);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test', P1 = 'player1@example.test', P2 = 'player2@example.test';
const SHOTS = process.env.KIT_SHOTS || '';
const TAG = process.env.SHOT_TAG || (/webkit/i.test(process.env.PW_MODULE || '') ? 'webkit' : 'edge');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 150) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }

/* a flat generated PNG: bands of colour and a grid, no art */
function png(w, h, seed) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3, band = Math.floor(y / (h / 4)), grid = x % 80 < 3 || y % 80 < 3;
      const c = grid ? [30, 28, 26] : [[200, 180, 140], [150, 170, 160], [120, 140, 170], [190, 150, 120]][(band + seed) % 4];
      raw[o] = c[0]; raw[o + 1] = c[1]; raw[o + 2] = c[2];
    }
  }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const MEDIA = path.join(ROOT, 'app', 'media', 'handouts');
const FILES = { sewer: 'a1b2c3d4e5f60718.png', ledger: 'f0e1d2c3b4a59687.png', gone: '0badc0ffee123456.png' };
const preExisting = existsSync(MEDIA) ? readdirSync(MEDIA) : [];
mkdirSync(MEDIA, { recursive: true });
writeFileSync(path.join(MEDIA, FILES.sewer), png(1200, 900, 0)); writeFileSync(path.join(MEDIA, FILES.ledger), png(900, 1200, 2));
const cleanMedia = () => { for (const f of [FILES.sewer, FILES.ledger]) { try { rmSync(path.join(MEDIA, f), { force: true }); } catch (_) {} } if (!preExisting.length) { try { rmSync(MEDIA, { recursive: true, force: true }); } catch (_) {} } };
const MANIFEST = { v: 1, rel: 'invented/handouts', items: [
  { id: 'sewer-map', title: 'Invented sewer map', file: FILES.sewer, when: 'GM-ONLY-cue when the bin man is handed it' },
  { id: 'ledger', title: 'Invented ledger page', file: FILES.ledger },
  { id: 'gone', title: 'Invented lost postcard', file: FILES.gone },
] };

const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-phone-handouts-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
delete env.ANTHROPIC_API_KEY; delete env.B68_ANTHROPIC_KEY;
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { cleanMedia(); console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { cleanMedia(); console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'DISPLAY_EMAILS:' + IPAD], { cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: 'ignore' });
function killServer() { if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} } }
let browser = null;
process.on('exit', () => { killServer(); cleanMedia(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));
const timeout = setTimeout(async () => { console.log('FAIL timed out'); try { if (browser) await browser.close(); } catch (_) {} process.exit(1); }, 900000);

const api = (method, p, body, user = GM) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j, text: t }; });
const must = async (p, what) => { const r = await p; if (r.status !== 200) throw new Error(what + ' -> ' + r.status + ' ' + r.text.slice(0, 200)); return r; };
const setting = async (on) => { await must(api('PATCH', '/gm/state', { features: { 'phone.handouts': on } }), 'gm state ' + on); await must(api('PATCH', '/campaign', { features: { 'phone.handouts': on } }), 'campaign ' + on); };
const pc = (name, pb) => ({ name, playbook: pb, spec: { name, playbook: pb }, sheet: { name, alias: '', look: 'A long coat' }, play: { stress: 1, crew: 'The Dovetail Crew', dots: { Hunt: 1, Finesse: 2, Sway: 1 }, harm: { l1: ['', ''], l2: ['', ''], l3: '', l4: '' }, keys: [], clocks: [], notes: '', log: [] } });
const errors = [];
async function phone(user, id, o = {}) {
  const w = o.w || 390, h = o.h || 844;
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, viewport: { width: w, height: h }, isMobile: true, hasTouch: true, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await ctx.addInitScript(() => { window.__B68_POLL_MS = 500; window.__B68_HEALTHY_POLL_MS = 500; window.__toasts = []; setInterval(() => { const t = document.getElementById('toastMsg'); const x = t && t.textContent; if (x && window.__toasts[window.__toasts.length - 1] !== x) window.__toasts.push(x); }, 100); });
  const page = await ctx.newPage();
  const seen = { req: [], bodies: [] };
  page.on('request', (r) => seen.req.push(r.url()));
  page.on('response', async (r) => { if (r.url().indexOf('/api/') > 0) { try { seen.bodies.push({ u: r.url(), b: await r.text() }); } catch (_) {} } });
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|Content Security Policy/.test(m.text())) errors.push(user + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(user + ' pageerror: ' + e.message));
  await page.goto(BASE + '/#c/' + id);
  await page.waitForSelector('#dossier .ds-bar', { timeout: 30000 });
  return { ctx, page, seen };
}
async function gmPage() {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1366, height: 768 }, serviceWorkers: 'block' });
  await ctx.addInitScript(atPlace('score'));
  const page = await ctx.newPage(), seen = { req: [] };
  page.on('request', (r) => seen.req.push(r.url()));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|Content Security Policy|Report Only/.test(m.text())) errors.push('gm: ' + m.text()); });      /* WebKit logs the ambient frames' report-only policy */
  page.on('pageerror', (e) => errors.push('gm pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept());
  await page.goto(BASE + '/#gm');
  await page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  await page.click('.gm-views [data-pv="ipad"]');
  await page.waitForSelector('#gm-ipad .gm-handout', { timeout: 20000 });
  return { ctx, page, seen };
}
const shot = async (pg, name) => { if (SHOTS) await pg.screenshot({ path: path.join(SHOTS, name + '-' + TAG + '.png') }); };
const btnState = (pg) => pg.evaluate(() => { const b = document.querySelector('#dossier .ds-hobtn'); return b ? { label: b.getAttribute('aria-label'), n: (b.querySelector('.ds-ho-n') || {}).textContent || '', dot: !!b.querySelector('.ds-tdot') } : null; });
const listTitles = (pg) => pg.evaluate(() => [...document.querySelectorAll('.ds-ho-list .ds-ho-title')].map((e) => e.textContent));
const chipOf = (pg, id, to) => '#gm-ipad [data-ho-send="' + id + '"] [data-to="' + to + '"]';
const noSideways = (pg) => pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);

try {
  const ready = await until(async () => { try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!ready) throw new Error('server not ready');
  const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm'), fx = (x) => JSON.parse(readFileSync(path.join(FIX, x), 'utf8'));
  const con = fx('console-pack.json'), loc = fx('location-pack.json'), np = fx('npc-pack.json'), at = new Date().toISOString();
  const PARTS = { console: con.parts.console, campaign: np.parts.campaign, npc: np.parts.npc, location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: at }, T: loc.T, extra: loc.extra },
    handouts: { src: { file: 'invented/handouts', blockSha: '1', exportedAt: at }, ...MANIFEST } };
  for (const [part, p] of Object.entries(PARTS)) await must(api('POST', '/gm/pack', { part, src: p.src, body: Object.fromEntries(Object.entries(p).filter(([k2]) => k2 !== 'src')) }), 'pack ' + part);
  const ended = new Date(Date.now() - 86400000).toISOString();
  await must(api('PUT', '/campaign', { v: 1, session: { number: 2, startedAt: ended, endedAt: ended }, crew: { name: 'The Dovetail Crew', playbook: 'shadows', claims: {}, factions: [], cohorts: [] }, clocks: [], log: [] }), 'the table');
  for (const u of [P1, P2]) await must(api('GET', '/me', undefined, u), 'sign in ' + u);
  await must(api('PATCH', '/me', { name: 'Nell Arbuthnot' }, P1), 'Nell\'s player names herself');      /* invented: the players' names are the characters' here */
  await must(api('PATCH', '/me', { name: 'Ray Okonjo' }, P2), 'Ray\'s player names himself');
  await must(api('PUT', '/characters/pc-nell', pc('Nell Arbuthnot', 'hound'), P1), 'Nell');
  await must(api('PUT', '/characters/pc-ray', pc('Ray Okonjo', 'slide'), P2), 'Ray');
  browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});

  /* ---------- off: as today ---------- */
  {
    const G = await gmPage(), N = await phone(P1, 'pc-nell');
    await sleep(2500);
    check(!(await G.page.$('.gm-ho-send')) && !G.seen.req.some((u) => /handout-send/.test(u)), 'off: no Send to on the GM page, gm/handout-send.js not fetched');
    check(!(await N.page.$('.ds-hobtn')) && !N.seen.req.some((u) => /sheet\/handouts|kind=handout/.test(u)), 'off: no Handouts on the phone, no sheet/handouts.js, no docs request of the kind');
    await G.ctx.close(); await N.ctx.close();
  }

  /* ---------- on ---------- */
  await setting(true);
  const G = await gmPage(), g = G.page;
  check(await until(async () => !!(await g.$(chipOf(g, 'sewer-map', P1))), 20000), 'on: each handout has Send to… chips');
  const chips = await g.$$eval('#gm-ipad [data-ho-send="sewer-map"] [data-gm="ho-send"]', (l) => l.map((b) => b.textContent + ':' + b.getAttribute('aria-pressed')));
  check(JSON.stringify(chips) === JSON.stringify(['Nell:false', 'Ray:false', 'Everyone:false']), 'one chip per player (first names) and Everyone, none sent: ' + chips.join(' '));
  const shownBefore = (await api('GET', '/gm/display')).json;
  const N = await phone(P1, 'pc-nell'), n = N.page, R = await phone(P2, 'pc-ray'), r = R.page;
  check(!!(await until(() => btnState(n), 15000)), 'on: Nell\'s sheet has a Handouts button');
  let b = await btnState(n);
  check(b && b.n === '' && !b.dot, 'nothing held yet: no count, no dot ' + JSON.stringify(b));
  await n.click('#dossier .ds-hobtn');
  check(await until(async () => /Nothing yet\. The GM can send you anything you are handed at the table\./.test(await n.textContent('.ds-ho-list')), 8000), 'the empty list says so');
  await shot(n, 'phone-empty-390');
  await n.click('.ds-ho-close');

  await g.click(chipOf(g, 'sewer-map', P1));
  check(await until(async () => (await g.getAttribute(chipOf(g, 'sewer-map', P1), 'aria-pressed')) === 'true', 10000), 'the GM\'s Nell chip fills');
  const sent1 = await g.textContent('#gm-ipad [data-ho-send="sewer-map"] .gm-ho-sent');
  check(sent1 === 'Sent to: Nell', '"Sent to: Nell" under the handout: ' + sent1);
  await shot(g, 'gm-send-1366');
  check(await until(async () => { const s = await btnState(n); return s && s.n === '1' && s.dot; }, 40000), 'Nell\'s button counts 1, with a dot ' + JSON.stringify(await btnState(n)));
  check(await until(() => n.evaluate(() => window.__toasts.includes('Invented sewer map is in your Handouts')), 3000), 'one quiet toast: "Invented sewer map is in your Handouts"');
  await shot(n, 'phone-bar-390');
  await n.click('#dossier .ds-hobtn');
  check(JSON.stringify(await listTitles(n)) === '["Invented sewer map"]', 'Nell\'s list: the sewer map');
  check(await until(async () => (await n.textContent('.ds-ho-list .ds-ho-when')).startsWith('Given '), 3000), 'with when it was given');
  check(await until(() => n.evaluate(() => { const i = document.querySelector('.ds-ho-list .ds-ho-img'); return !!i && i.complete && i.naturalWidth > 0; }), 10000), 'the thumbnail loads (lazily, after the title)');
  check(!(await btnState(n)).dot, 'opening the list takes the dot away');
  await shot(n, 'phone-list-390');
  await n.click('.ds-ho-list .ds-ho-open');
  check(await until(() => n.evaluate(() => { const i = document.querySelector('.ds-ho-v .ds-ho-vimg'); return !!i && i.complete && i.naturalWidth === 1200; }), 10000), 'opened: the picture full screen on a dark ground');
  const vb = await n.evaluate(() => { const v = document.querySelector('.ds-ho-v'), x = document.querySelector('.ds-ho-vx').getBoundingClientRect(), h = document.querySelector('.ds-ho-vh'); return { bg: getComputedStyle(v).backgroundColor, x: [x.bottom, x.height], h: h.textContent, ih: innerHeight }; });
  check(vb.bg === 'rgb(11, 10, 9)' && vb.h === 'Invented sewer map' && vb.x[0] <= vb.ih && vb.x[0] > vb.ih - 120 && vb.x[1] >= 44, 'the title on top, Close at the foot within thumb reach: ' + JSON.stringify(vb));
  await shot(n, 'phone-viewer-390');
  await n.click('.ds-ho-zoom');
  const z = await n.evaluate(() => { const s = document.querySelector('.ds-ho-stage'); return { big: s.classList.contains('big'), sw: s.scrollWidth, cw: s.clientWidth }; });
  check(z.big && z.sw > z.cw, 'Zoom in: full size in a box that pans ' + JSON.stringify(z));
  await shot(n, 'phone-viewer-zoom-390');
  await n.click('.ds-ho-zoom');
  await n.click('.ds-ho-vx');
  check(!(await n.$('.ds-ho-v')) && !!(await n.$('.ds-ho-list')), 'Close: back to the list');

  /* Ray: nothing of Nell's */
  await sleep(1500);
  const rb = await btnState(r);
  check(rb && rb.n === '', 'Ray\'s button: no count ' + JSON.stringify(rb));
  const rayDocs = await api('GET', '/docs?kind=handout', undefined, P2);
  check(rayDocs.status === 200 && !rayDocs.text.includes(FILES.sewer) && !R.seen.bodies.some((x) => x.b.includes(FILES.sewer)), 'Ray\'s docs GET and every response on his phone: no sewer map file name');
  check(!R.seen.bodies.some((x) => /GM-ONLY/.test(x.b)) && !N.seen.bodies.some((x) => /GM-ONLY/.test(x.b)), 'no phone ever receives the cue or a GM-ONLY- text');

  /* Everyone */
  await g.click(chipOf(g, 'ledger', '*'));
  check(await until(async () => (await g.getAttribute(chipOf(g, 'ledger', '*'), 'aria-pressed')) === 'true', 10000), 'Everyone fills');
  const sent2 = await g.textContent('#gm-ipad [data-ho-send="ledger"] .gm-ho-sent');
  check(sent2 === 'Sent to: Nell, Ray', '"Sent to: Nell, Ray": ' + sent2);
  check(await until(async () => { const s = await btnState(r); return s && s.n === '1'; }, 40000), 'Ray\'s phone has the ledger');
  check(await until(async () => JSON.stringify(await listTitles(n)) === '["Invented ledger page","Invented sewer map"]', 40000), 'Nell\'s open list: the ledger on top (newest first)');
  const shownAfter = (await api('GET', '/gm/display')).json;
  check(JSON.stringify(shownAfter) === JSON.stringify(shownBefore), 'sending never put anything on the shared screen');

  /* take back, with Nell's viewer open on it */
  await n.click('.ds-ho-list .ds-ho-open[aria-label="Open Invented sewer map"]');
  await n.waitForSelector('.ds-ho-v', { timeout: 5000 });
  await g.click(chipOf(g, 'sewer-map', P1));      /* the page asks "Take it back from Nell?": the dialog is accepted */
  check(await until(async () => (await g.getAttribute(chipOf(g, 'sewer-map', P1), 'aria-pressed')) === 'false', 10000), 'take back: the chip empties');
  check(await until(async () => !(await n.$('.ds-ho-v')), 40000), 'Nell\'s open viewer closes');
  check(await until(() => n.evaluate(() => window.__toasts.includes('The GM took this back')), 4000), '"The GM took this back"');
  check(JSON.stringify(await listTitles(n)) === '["Invented ledger page"]', 'and the list loses it');

  /* a file that is not there */
  await g.click(chipOf(g, 'gone', P1));
  check(await until(async () => (await listTitles(n)).includes('Invented lost postcard'), 40000), 'a third handout arrives');
  check(await until(async () => n.evaluate(() => [...document.querySelectorAll('.ds-ho-th.bad')].some((e) => e.textContent === 'Needs a connection')), 10000), 'its picture fails: "Needs a connection"');
  await n.click('.ds-ho-list .ds-ho-open[aria-label="Open Invented lost postcard"]');
  check(await until(async () => /Needs a connection/.test(await n.textContent('.ds-ho-v')), 8000), 'and the viewer says the same');
  await n.click('.ds-ho-vx'); await n.click('.ds-ho-close');
  check(await noSideways(n) && await noSideways(r), '390: no sideways scroll on either phone');
  await shot(g, 'gm-sent-1366');

  /* 360 x 640 */
  const S = await phone(P1, 'pc-nell', { w: 360, h: 640 }), s = S.page;
  check(await until(async () => { const x = await btnState(s); return x && x.n === '2'; }, 20000), '360: the button and its count');
  const nav = await s.evaluate(() => { const b = document.querySelector('#dossier .ds-hobtn').getBoundingClientRect(); return { r: b.right, w: innerWidth, sw: document.documentElement.scrollWidth }; });
  check(nav.r <= nav.w && nav.sw <= nav.w + 1, '360: the button inside the screen, no sideways scroll ' + JSON.stringify(nav));
  await shot(s, 'phone-bar-360');
  await s.click('#dossier .ds-hobtn'); await sleep(600);
  await shot(s, 'phone-list-360');
  await s.click('.ds-ho-list .ds-ho-open[aria-label="Open Invented ledger page"]');
  await sleep(800);
  const v360 = await s.evaluate(() => { const x = document.querySelector('.ds-ho-vx').getBoundingClientRect(); return { b: x.bottom, ih: innerHeight }; });
  check(v360.b <= v360.ih, '360: Close inside the screen');
  await shot(s, 'phone-viewer-360');
  await s.setViewportSize({ width: 640, height: 360 }); await sleep(500);
  const land = await s.evaluate(() => { const x = document.querySelector('.ds-ho-vx').getBoundingClientRect(), i = document.querySelector('.ds-ho-vimg').getBoundingClientRect(); return { b: x.bottom, ih: innerHeight, iw: innerWidth, img: [i.width, i.height] }; });
  check(land.b <= land.ih && land.img[0] > 0 && land.img[0] <= land.iw, 'landscape: the picture refits, Close still on screen ' + JSON.stringify(land));
  await shot(s, 'phone-viewer-landscape');
  await S.ctx.close();

  /* the four-screen sheet: the button on every screen (the GM page closed first: an open one copies its own settings back over the campaign's) */
  await G.ctx.close();
  await must(api('PATCH', '/gm/state', { features: { 'kit.phone': true } }), 'kit.phone on (the GM state: the open GM page copies it to the campaign)');
  await must(api('PATCH', '/campaign', { features: { 'kit.phone': true } }), 'kit.phone on');
  const K = await phone(P1, 'pc-nell'), k = K.page;
  const kitOn = await until(() => k.evaluate(() => !!document.querySelector('#dossier .ks17-bar')), 20000);
  if (kitOn) {
    const where = [];
    for (const sc of ['now', 'sheet', 'crew', 'notes']) {
      await k.click('#dossier .ks17-bar [data-ks17-tab="' + sc + '"]'); await sleep(250);
      where.push(sc + ':' + await k.evaluate(() => { const b = document.querySelector('#dossier .ds-hobtn'); if (!b) return 'none'; const r = b.getBoundingClientRect(); return r.width > 0 && r.top >= 0 && r.bottom <= innerHeight ? 'shown' : 'hidden'; }));
    }
    check(where.every((w) => /shown$/.test(w)), 'kit.phone: Handouts in the top bar on every screen ' + where.join(' '));
    await shot(k, 'phone-kit-notes-390');
  } else check(false, 'kit.phone: the bar did not come ' + JSON.stringify([(await api('GET', '/campaign')).json, (await api('GET', '/gm/state')).json].map((d) => d && (d.features || (d.doc && d.doc.features) || (d.campaign && d.campaign.features) || Object.keys(d)))) + JSON.stringify(await k.evaluate(() => ({ kit: document.documentElement.getAttribute('data-kit'), tabs: typeof window.B68SheetTabs, flag: window.B68Flags && window.B68Flags.on('kit.phone'), ho: !!document.querySelector('#dossier .ds-hobtn') }))));
  await K.ctx.close();
  await must(api('PATCH', '/gm/state', { features: { 'kit.phone': false } }), 'kit.phone off');
  await must(api('PATCH', '/campaign', { features: { 'kit.phone': false } }), 'kit.phone off');

  /* off again: the button goes from an open sheet */
  await setting(false);
  check(await until(async () => !(await n.$('#dossier .ds-hobtn')), 20000), 'turned off: Nell\'s Handouts button goes without a reload');
  await N.ctx.close(); await R.ctx.close();
  check(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
}
try { if (browser) await browser.close(); } catch (_) {}
clearTimeout(timeout);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
