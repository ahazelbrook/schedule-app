// The phones' table screen end to end (MM1, design 2.4): the sheet's Table button and viewer, boot.js, the adapter (cf.js) and a real
// local Worker (wrangler dev, DEV_USER) on PORT (default 9014). A player's phone (390 x 844, touch) opens a sheet; the GM puts things on
// the iPad through the API. Checks:
//   - the Table button is in the sticky bar; its dot lights when the iPad shows a map or a handout and goes when the player looks
//   - the viewer shows the map as an <img> from a blob URL (never inline svg), the handout from media/handouts/, the title and caption as TEXT
//   - the viewer makes no request of its own while screenSeq stays put, one more when it moves (a new map, then lights out), and shows
//     "nothing" for lights out; × and Esc close it; the browser's own pinch-zoom is allowed (touch-action, viewport meta)
//   - the mirror switched off takes the dot away and empties an open viewer; a second player's read-only copy of the sheet works too
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] PORT=9014 node checks/runtime/table-screen.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9014);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', P1 = 'p1@example.test', P2 = 'p2@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// an invented handout image, written into the git-ignored app/media/handouts/ for the run and removed after
const MEDIA = path.join(ROOT, 'app', 'media', 'handouts');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const FILE = 'mm1-invented-note.png';
const preExisting = existsSync(MEDIA) ? readdirSync(MEDIA) : [];
mkdirSync(MEDIA, { recursive: true });
writeFileSync(path.join(MEDIA, FILE), PNG);
const cleanMedia = () => { try { rmSync(path.join(MEDIA, FILE), { force: true }); } catch (_) {} if (!preExisting.length) { try { rmSync(MEDIA, { recursive: true, force: true }); } catch (_) {} } };

/* ---------- our own server (only this process group is ever signalled) ---------- */
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-mm1-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use: stop what is on it, or set PORT'); cleanMedia(); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM],
{ cwd: ROOT, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, detached: true, shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
function killServer(sig = 'SIGTERM') { try { if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else process.kill(-server.pid, sig); } catch (_) {} }
process.on('exit', () => { killServer('SIGKILL'); cleanMedia(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 240000);
const api = (method, p, user, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const display = (d) => api('PUT', '/gm/display', GM, d).then((r) => { if (r.status !== 200) throw new Error('display PUT ' + r.status + ' ' + JSON.stringify(r.json)); return r.json; });
const mapSvg = (fill, word) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100" width="200" height="100"><rect width="200" height="100" fill="' + fill + '"/><text x="10" y="50" fill="#fff">' + word + '</text></svg>';

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 90000, 300);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  const made = await api('PUT', '/characters/char_mm1', P1, { name: 'Invented Scoundrel', playbook: 'hound', sheet: { name: 'Invented Scoundrel' }, play: {} });
  check(made.status === 200, 'a player files a character: ' + made.status);

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(user, pollMs = 300) {
    const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await ctx.addInitScript((ms) => { window.__B68_POLL_MS = ms; }, pollMs);
    const page = await ctx.newPage();
    const screenReqs = [];
    page.on('request', (r) => { if (/\/api\/table\/screen/.test(r.url())) screenReqs.push(r.url()); });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(user + ': ' + m.text()); });
    page.on('pageerror', (e) => errors.push(user + ' pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '/#c/char_mm1');
    await page.waitForSelector('#dossier .ds-bar', { timeout: 30000 });
    return { page, ctx, screenReqs };
  }
  const p1 = await open(P1);
  const page = p1.page;
  const dot = () => page.$$eval('.ds-tablebtn .ds-tdot', (n) => n.length);
  const viewer = () => page.evaluate(() => {
    const v = document.querySelector('.ds-tv'); if (!v) return null;
    const img = v.querySelector('.ds-tv-img'), cap = v.querySelector('.ds-tv-cap');
    return { src: img ? img.getAttribute('src') : null, loaded: img ? img.complete && img.naturalWidth > 0 : false, alt: img ? img.alt : null, cap: cap && !cap.hidden ? cap.textContent : '', none: (v.querySelector('.ds-tv-none') || {}).textContent || '', inlineSvg: v.querySelectorAll('svg').length, injected: v.querySelectorAll('#pwn, script, iframe, [onerror]').length };
  });

  // the button is in the sticky bar, with no dot while the iPad shows nothing a phone may copy
  const barHas = await page.$eval('.ds-bar .ds-nav .ds-tablebtn', (b) => b.textContent.trim()).catch(() => null);
  check(barHas === 'Table', 'the sticky bar has a Table button: ' + JSON.stringify(barHas));
  check((await dot()) === 0, 'no dot while the iPad is blank');
  const box = await page.$eval('.ds-tablebtn', (b) => { const r = b.getBoundingClientRect(); return { h: r.height, w: r.width, inView: r.right <= innerWidth }; });
  check(box.h >= 40 && box.inView, 'the button is a phone-sized tap target inside the bar (' + Math.round(box.w) + ' x ' + Math.round(box.h) + ')');

  // the GM puts a map on the iPad: the dot lights within a poll or two
  const m1 = await display({ kind: 'svg', title: '<b id="pwn">Invented harbour</b>', caption: 'Lantern deck · twelve minutes', svg: mapSvg('#a33', 'Jetty') });
  check(!!(await until(async () => (await dot()) === 1, 10000, 150)), 'a map on the iPad lights the dot');
  check(await page.$eval('.ds-tablebtn', (b) => /changed/.test(b.getAttribute('aria-label'))), 'and the button says so to a screen reader');
  check(p1.screenReqs.length === 0, 'nothing fetched yet: the dot comes from the data poll alone');

  // open the viewer
  await page.click('.ds-tablebtn');
  check(!!(await until(async () => { const v = await viewer(); return v && v.loaded; }, 8000, 100)), 'the viewer opens and the map loads');
  let v = await viewer();
  check(/^blob:/.test(v.src || '') && v.inlineSvg === 0, 'the map is an <img> from a blob URL, never inline svg: ' + (v.src || '').slice(0, 30));
  check(v.cap === '<b id="pwn">Invented harbour</b> · Lantern deck · twelve minutes' && v.injected === 0, 'the title and caption are text, not markup: ' + JSON.stringify(v.cap));
  check(p1.screenReqs.length === 1, 'one request for the picture: ' + p1.screenReqs.length);
  check((await dot()) === 0, 'the dot goes once the player has looked');
  const css = await page.$eval('.ds-tv', (e) => { const s = getComputedStyle(e); return { ta: s.touchAction, bg: s.backgroundColor, pos: s.position, w: e.getBoundingClientRect().width, h: e.getBoundingClientRect().height }; });
  check(/^(manipulation|pan-x pan-y pinch-zoom)$/.test(css.ta) && css.pos === 'fixed' && css.w === 390 && css.h === 844, 'full screen, touch-action allows pinch-zoom: ' + JSON.stringify(css));
  check(/^rgb\((?:\d|1\d), ?(?:\d|1\d), ?(?:\d|1\d)\)$/.test(css.bg), 'dark background: ' + css.bg);
  const meta = await page.$eval('meta[name="viewport"]', (m) => m.content);
  check(!/user-scalable\s*=\s*(no|0)|maximum-scale/i.test(meta), 'the viewport meta does not forbid zoom: ' + meta);
  // (a real two-finger pinch cannot be synthesised in this headless browser, not even on a plain page: the check is that nothing blocks the
  // browser's own zoom: touch-action 'manipulation' is pan + pinch-zoom, the viewport meta has no limits, and there is no zoom script in the viewer)
  // nothing polls on its own: several data polls go by with screenSeq unchanged
  await sleep(1800);
  check(p1.screenReqs.length === 1, 'the open viewer makes no request while screenSeq stays put (' + p1.screenReqs.length + ')');

  // a new map: screenSeq moves, the viewer refetches once and redraws
  const before = v.src;
  await display({ kind: 'svg', title: 'Second harbour', caption: 'Lower deck', svg: mapSvg('#36a', 'Stairs') });
  check(!!(await until(async () => { const x = await viewer(); return x && x.src && x.src !== before && x.loaded && /Second harbour/.test(x.cap); }, 8000, 100)), 'a new map redraws the open viewer');
  check(p1.screenReqs.length === 2, 'one more request, not a stream: ' + p1.screenReqs.length);

  // lights out: screenSeq goes to 0, the open viewer refetches and shows nothing
  await display({ kind: 'dark' });
  check(!!(await until(async () => { const x = await viewer(); return x && !x.src && /Nothing on the table screen/.test(x.none); }, 8000, 100)), 'lights out empties the open viewer');
  check(p1.screenReqs.length === 3, 'the move to 0 is one more request: ' + p1.screenReqs.length);
  await page.keyboard.press('Escape');
  check((await viewer()) === null, 'Esc closes the viewer');

  // an NPC, text and a rule on the iPad: no dot, and opening the viewer shows nothing
  for (const d of [{ kind: 'npc', npcId: 'invented-npc' }, { kind: 'text', text: 'Invented words' }, { kind: 'rule', md: '# Invented' }]) {
    await display(d); await sleep(900);
    check((await dot()) === 0, d.kind + ' on the iPad: no dot');
  }

  // a handout
  await display({ kind: 'handout', file: FILE, title: 'An invented note', showTitle: true });
  check(!!(await until(async () => (await dot()) === 1, 10000, 150)), 'a handout lights the dot');
  // closed means closed: while the viewer was shut, every display change above only moved the dot
  check(p1.screenReqs.length === 3, 'a closed viewer never fetches /api/table/screen: still ' + p1.screenReqs.length + ' requests, all made by opens or by the open viewer');
  await page.click('.ds-tablebtn');
  check(!!(await until(async () => { const x = await viewer(); return x && x.loaded; }, 8000, 100)), 'the handout loads in the viewer');
  v = await viewer();
  check(v.src === 'media/handouts/' + FILE && v.cap === 'An invented note', 'from the static handouts path, with its title: ' + JSON.stringify([v.src, v.cap]));
  await page.click('.ds-tv-x');
  check((await viewer()) === null, '× closes the viewer');
  check(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('ds-tablebtn')), 'and focus goes back to the Table button');

  // a refused screen (a hidden name in the map) leaves an empty viewer and no dot behind
  const hid = await api('POST', '/npcs', GM, { name: 'Zephyrine Pemberthy', revealed: false });
  check(hid.status === 200, 'a hidden NPC is on file: ' + hid.status);
  await page.click('.ds-tablebtn');
  await until(async () => { const x = await viewer(); return x && x.loaded; }, 8000, 100);
  await display({ kind: 'svg', title: 'Refused', svg: mapSvg('#633', 'Zephyrine Pemberthy') });
  check(!!(await until(async () => { const x = await viewer(); return x && !x.src && /Nothing on the table screen/.test(x.none); }, 8000, 100)), 'a map that names a hidden NPC is refused: the open viewer shows nothing');
  await page.click('.ds-tv-x');
  await sleep(700);
  check((await dot()) === 0, 'and no dot is left behind by the refused screen');

  // the mirror switched off: the dot goes and an open viewer empties
  await page.click('.ds-tablebtn');
  await until(async () => { const x = await viewer(); return x && x.loaded; }, 8000, 100);
  const off = await api('PATCH', '/gm/state', GM, { mirror: false });
  check(off.status === 200, 'the GM switches the mirror off');
  check(!!(await until(async () => { const x = await viewer(); return x && !x.src && /Nothing on the table screen/.test(x.none); }, 8000, 100)), 'an open viewer empties when the mirror goes off');
  await page.click('.ds-tv-x');
  await display({ kind: 'svg', title: 'Hidden by the switch', svg: mapSvg('#363', 'Off') }); await sleep(1000);
  check((await dot()) === 0, 'a map put up with the mirror off lights no dot');
  await api('PATCH', '/gm/state', GM, { mirror: null });
  check(!!(await until(async () => (await dot()) === 1, 10000, 150)), 'back on: the dot lights for the map that is up');

  // a second player, on someone else's (read only) sheet, can use it too
  const p2 = await open(P2);
  check(!!(await until(async () => (await p2.page.$$eval('.ds-tablebtn .ds-tdot', (n) => n.length)) === 1, 10000, 150)), 'a second player sees the dot on a sheet they cannot edit');
  await p2.page.click('.ds-tablebtn');
  check(!!(await until(async () => p2.page.evaluate(() => { const i = document.querySelector('.ds-tv-img'); return !!i && i.complete && i.naturalWidth > 0; }), 8000, 100)), 'and the viewer opens there');
  await p2.ctx.close();

  // ---- hidden stays hidden for GEOMETRY: an invented site at a partial reveal, painted by the iPad's display page and by the phone's <img> ----
  // The reveal is baked into the stored bytes by the map kit (app/maps/map-kit.js "player cover": the file never holds a hidden room's edge) and the
  // display keeps nothing else (cleanDisplay stores kind, title, caption and the svg). So the checks are: (1) the bytes hold no hidden room; (2) the svg
  // the iPad paints, with all of the page's CSS, is pixel-for-pixel what an <img> of the same bytes paints, so the phone shows nothing the iPad hides;
  // (3) the same comparison against the FULL reveal fails, so the pixels compared are not blank.
  const L = require(path.join(ROOT, 'app', 'gm', 'location.js')), K = require(path.join(ROOT, 'app', 'maps', 'map-kit.js'));
  const FIXL = JSON.parse(readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'location-pack.json'), 'utf8'));
  const roll = L.generate({ T: FIXL.T, extra: FIXL.extra }, {}, { seed: 11, mem: {} });
  const mkMap = (reveal) => K.render(roll, { view: 'plan', theme: 'rulebook', layer: 'player', reveal, width: 1000 });
  const partial = mkMap(['public']), fullMap = mkMap(['public', 'working', 'controlled', 'secure']);
  const hiddenRooms = partial.model.rooms.filter((r) => r.band !== 'public' && r.name).map((r) => r.name);
  check(hiddenRooms.length >= 3 && hiddenRooms.every((n) => !partial.svg.includes(n)) && hiddenRooms.every((n) => fullMap.svg.includes(n)), 'the partial-reveal bytes name none of the ' + hiddenRooms.length + ' hidden rooms (the full ones name them all)');
  await display({ kind: 'svg', title: 'Invented warehouse', caption: 'surveyed: public', svg: partial.svg });
  const ipadCtx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1366, height: 1024 }, serviceWorkers: 'block' });
  const ipad = await ipadCtx.newPage();
  ipad.on('pageerror', (e) => errors.push('ipad pageerror: ' + e.message));
  await ipad.goto(BASE + '/#display');
  await ipad.waitForSelector('.dp-map-frame svg', { timeout: 30000 });
  const painted = await ipad.evaluate((names) => {
    const s = document.querySelector('.dp-map-frame svg'), txt = s.textContent + ' ' + s.outerHTML;
    return { elements: s.querySelectorAll('*').length, leaked: names.filter((n) => txt.includes(n)), vb: s.getAttribute('data-vb') };
  }, hiddenRooms);
  check(painted.leaked.length === 0 && painted.elements > 20, 'the iPad paints the partial reveal: ' + painted.elements + ' elements, no hidden room in its DOM');
  // the phone's answer for the same display, built into an <img> exactly as the viewer does (xmlns patch, blob URL)
  const shown = await api('GET', '/table/screen', P1);
  check(shown.json.kind === 'svg' && shown.json.svg === partial.svg, 'the phone is sent the very bytes that were pushed');
  // two boxes of the same size in the iPad's own page (so display.css and every other rule of the page apply): the iPad's painted svg, and an <img> of the phone's bytes
  async function snap(phoneSvg) {
    return ipad.evaluate(async ({ phoneSvg }) => {
      const live = document.querySelector('.dp-map-frame svg'), vb = live.getAttribute('data-vb').split(' ').map(Number), W = 600, H = Math.round(W * vb[3] / vb[2]);
      if (document.getElementById('mm1-cmp')) document.getElementById('mm1-cmp').remove();
      const box = document.createElement('div'); box.id = 'mm1-cmp'; box.style.cssText = 'position:fixed;left:0;top:0;z-index:99999;background:#fff;display:flex';
      const a = document.createElement('div'); a.className = 'dp-map-frame'; a.style.cssText = 'position:relative;inset:auto;width:' + W + 'px;height:' + H + 'px;background:#fff';
      const sv = live.cloneNode(true); sv.setAttribute('viewBox', vb.join(' ')); a.appendChild(sv);
      const b = document.createElement('div'); b.style.cssText = 'position:relative;width:' + W + 'px;height:' + H + 'px;background:#fff';
      let s = phoneSvg; const head = /^<svg[^>]*>/i.exec(s); if (head && !/\sxmlns\s*=/i.test(head[0])) s = s.replace(/^<svg/i, '<svg xmlns="http://www.w3.org/2000/svg"');
      const img = document.createElement('img'); img.style.cssText = 'display:block;width:100%;height:100%'; img.src = URL.createObjectURL(new Blob([s], { type: 'image/svg+xml' }));
      b.appendChild(img); box.appendChild(a); box.appendChild(b); (document.getElementById('display-page') || document.body).appendChild(box);
      await img.decode();
      return { W, H };
    }, { phoneSvg });
  }
  const raster = async (sel) => (await (await ipad.$(sel)).screenshot({ type: 'png' })).toString('base64');
  async function diff(x, y) {
    return ipad.evaluate(async ([p, q]) => {
      const load = (b) => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = 'data:image/png;base64,' + b; });
      const [i1, i2] = await Promise.all([load(p), load(q)]);
      const w = Math.min(i1.width, i2.width), h = Math.min(i1.height, i2.height), c = document.createElement('canvas'); c.width = w; c.height = h;
      const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(i1, 0, 0); const d1 = g.getImageData(0, 0, w, h).data; g.clearRect(0, 0, w, h); g.drawImage(i2, 0, 0); const d2 = g.getImageData(0, 0, w, h).data;
      let bad = 0, ink = 0; for (let k = 0; k < d1.length; k += 4) { const dd = Math.abs(d1[k] - d2[k]) + Math.abs(d1[k + 1] - d2[k + 1]) + Math.abs(d1[k + 2] - d2[k + 2]); if (dd > 96) bad++; if (d1[k] + d1[k + 1] + d1[k + 2] < 600) ink++; }
      return { bad: bad / (w * h), ink: ink / (w * h), w, h };
    }, [x, y]);
  }
  await snap(partial.svg);
  const ipadPng = await raster('#mm1-cmp > div:nth-child(1)'), phonePng = await raster('#mm1-cmp > div:nth-child(2)');
  if (process.env.MM1_SHOTS) { writeFileSync(path.join(process.env.MM1_SHOTS, 'ipad.png'), Buffer.from(ipadPng, 'base64')); writeFileSync(path.join(process.env.MM1_SHOTS, 'phone.png'), Buffer.from(phonePng, 'base64')); }
  const same = await diff(ipadPng, phonePng);
  check(same.ink > 0.02, 'the comparison is not blank: ' + (same.ink * 100).toFixed(1) + '% of the iPad box is inked');
  // what remains is type: an <img> cannot use the page's web fonts, so the lettering (title, labels) falls back to another face; the shapes, covers and hatching match
  check(same.bad < 0.06, 'the phone <img> of the partial reveal matches what the iPad paints, apart from the lettering face (' + (same.bad * 100).toFixed(2) + '% of pixels differ)');
  await snap(fullMap.svg);
  const fullPng = await raster('#mm1-cmp > div:nth-child(2)');
  const more = await diff(ipadPng, fullPng);
  check(more.bad > 0.15 && more.bad > 3 * same.bad, 'and the full reveal is visibly different, so the match above means something (' + (more.bad * 100).toFixed(1) + '% differ)');
  // a room opened on its own (reveal "room:<name>") is baked in the same way
  const one = hiddenRooms[0];
  const opened = mkMap(['public', 'room:' + one]);
  check(opened.svg.includes(one) && hiddenRooms.filter((n) => n !== one).every((n) => !opened.svg.includes(n)), 'opening one room by name shows that room in the bytes and still none of the others');
  await ipadCtx.close();

  // live sync (MD2): a 'screen' poke lights the dot at once. This phone polls only once a minute, so only the poke can bring the news in time
  await display({ kind: 'dark' });
  const p3 = await open('p3@example.test', 60000);
  check(!!(await until(() => p3.page.evaluate(() => !!window.B68Live && window.B68Live.state().open), 15000, 100)), 'the live socket of the phone is open');
  check((await p3.page.$$eval('.ds-tablebtn .ds-tdot', (n) => n.length)) === 0, 'no dot while the iPad is dark');
  const t0 = Date.now();
  await display({ kind: 'svg', title: 'Poked in', svg: mapSvg('#639', 'Poke') });
  const lit = await until(async () => (await p3.page.$$eval('.ds-tablebtn .ds-tdot', (n) => n.length)) === 1, 5000, 50);
  check(!!lit && Date.now() - t0 < 4500, 'a map on the iPad lights the dot through the poke, with the poll a minute away (' + (Date.now() - t0) + ' ms)');
  check(await p3.page.evaluate(() => window.B68Live.state().pokes.indexOf('screen') >= 0), 'and the socket did hear a screen poke');
  await api('PATCH', '/gm/state', GM, { mirror: false });
  check(!!(await until(async () => (await p3.page.$$eval('.ds-tablebtn .ds-tdot', (n) => n.length)) === 0, 5000, 50)), 'switching the mirror off clears the dot through a poke too');
  await api('PATCH', '/gm/state', GM, { mirror: null });
  await p3.ctx.close();
  check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
} finally {
  clearTimeout(timeout);
  killServer('SIGTERM');
  const t0 = Date.now(); while (server.exitCode === null && server.signalCode === null && Date.now() - t0 < 5000) await sleep(100);
  killServer('SIGKILL');
}
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
