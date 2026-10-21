// Handouts on the real GM page and the real table display, in a real browser, against a local wrangler dev. Invented fixtures: two tiny
// generated images written into the git-ignored app/media/handouts/ for the run (and removed after), an invented manifest posted as the
// pack's `handouts` part. Checks: the list in the iPad tab (titles, cues, thumbnails), Show on iPad posts exactly one item, Clear iPad,
// the title toggle, the display draws the image fitted on black (and says so when the file is missing), the iPad is never sent the
// manifest, suggestHandout puts a "Show handout?" item in the Rack (Show posts it and drops it; Dismiss just drops it).
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] node checks/runtime/gm-handouts.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8863);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), np = fx('npc-pack.json');

const MEDIA = path.join(ROOT, 'app', 'media', 'handouts');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="100" viewBox="0 0 400 100"><rect width="400" height="100" fill="#c33"/></svg>';
const MINE = ['ho-test-key.png', 'ho-test-wide.svg'];
const preExisting = existsSync(MEDIA) ? readdirSync(MEDIA) : [];
mkdirSync(MEDIA, { recursive: true });
writeFileSync(path.join(MEDIA, MINE[0]), PNG); writeFileSync(path.join(MEDIA, MINE[1]), SVG);
const cleanMedia = () => { for (const f of MINE) { try { rmSync(path.join(MEDIA, f), { force: true }); } catch (_) {} } if (!preExisting.length) { try { rmSync(MEDIA, { recursive: true, force: true }); } catch (_) {} } };

const MANIFEST = { v: 1, rel: 'invented/handouts', items: [
  { id: 'key', title: 'Invented brass key', file: MINE[0], when: 'after the invented dock clue' },
  { id: 'wide', title: 'Invented wide banner', file: MINE[1] },
  { id: 'gone', title: 'Invented missing image', file: 'ho-test-missing.png' },
] };
const PARTS = {
  console: con.parts.console, campaign: np.parts.campaign, npc: np.parts.npc,
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: new Date().toISOString() }, T: loc.T, extra: loc.extra },
  handouts: { src: { file: 'invented/handouts', blockSha: '1', exportedAt: new Date().toISOString() }, ...MANIFEST },
};

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-handouts-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { cleanMedia(); console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { cleanMedia(); console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM], { cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: 'ignore' });
function killServer() {
  if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} }
}
process.on('exit', () => { killServer(); cleanMedia(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const api = (method, p, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j, text: t }; });
const shownDisplay = async () => (await api('GET', '/gm/display')).json.display;

try {
  const up = await until(async () => { try { return (await fetch(BASE + '/index.html')).status > 0; } catch (_) { return false; } }, 90000, 500);
  if (!up) throw new Error('the server did not start');
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + r.text.slice(0, 120));
  }
  const bad = await api('PUT', '/gm/display', { kind: 'handout', file: '../secret.png' });
  check(bad.status === 400, 'the server refuses a handout with a path in its file name');
  const stray = await api('PUT', '/gm/display', { kind: 'handout', file: MINE[0], title: 'T', handouts: MANIFEST.items });
  check(stray.status === 200 && !('handouts' in stray.json.display) && !stray.text.includes('Invented wide banner'), 'the server keeps the one item and drops any other key');
  await api('PUT', '/gm/display', { kind: 'blank' });

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(hash, { width = 1280, height = 800 } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width, height }, serviceWorkers: 'block' });
    const page = await c.newPage();
    const reqs = [];
    page.on('request', (r) => reqs.push(r.url()));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    await page.goto(BASE + '/' + hash);
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    return { c, page, reqs };
  }

  // ---- the GM page ----
  const G = await open('#gm');
  const p = G.page;
  await p.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  await p.click('.gm-tab[data-panel="ipad"]');
  check(await p.waitForSelector('#gm-ipad .gm-handout', { timeout: 15000 }).then(() => true, () => false), 'the iPad tab lists the handouts');
  check((await p.$$('#gm-ipad .gm-handout')).length === 3, 'three entries, as in the pack');
  const titles = await p.$$eval('#gm-ipad .gm-handout b', (l) => l.map((e) => e.textContent));
  check(JSON.stringify(titles) === JSON.stringify(['Invented brass key', 'Invented wide banner', 'Invented missing image']), 'each shows its title');
  check(/after the invented dock clue/.test(await p.textContent('#gm-ipad [data-ho="key"]')) && !/after the invented/.test(await p.textContent('#gm-ipad [data-ho="wide"]')), 'the cue shows only where the vault gave one');
  check(await p.waitForFunction(() => { const i = document.querySelector('#gm-ipad [data-ho="key"] img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 }).then(() => true, () => false), 'a thumbnail loads from media/handouts/');
  check(await p.$$eval('#gm-ipad [data-ho] [data-gm="ho-show"]', (l) => l.length) === 3 && await p.$$eval('#gm-ipad [data-ho] [data-gm="blankipad"]', (l) => l.length) === 3, 'each has Show on iPad and Clear iPad');

  await p.click('#gm-ipad [data-ho="key"] [data-gm="ho-show"]');
  check(await until(async () => (await shownDisplay()).kind === 'handout', 8000), 'Show on iPad puts a handout on the display');
  let d = await shownDisplay();
  check(JSON.stringify(d) === JSON.stringify({ kind: 'handout', title: 'Invented brass key', caption: '', file: MINE[0], showTitle: false }), 'the display doc is the one item, title caption off: ' + JSON.stringify(d));
  check(/Handout · Invented brass key/.test(await p.textContent('#gm-ipad-now')), '"On the iPad now" names it');

  await p.click('#gm-ipad [data-hotitle]');
  await p.click('#gm-ipad [data-ho="wide"] [data-gm="ho-show"]');
  check(await until(async () => (await shownDisplay()).file === MINE[1], 8000), 'the next Show replaces it');
  d = await shownDisplay();
  check(d.showTitle === true && d.title === 'Invented wide banner', 'with the title toggle on, the title caption is on');
  await p.click('#gm-ipad [data-ho="wide"] [data-gm="blankipad"]');
  check(await until(async () => (await shownDisplay()).kind === 'blank', 8000), 'Clear iPad blanks it');

  // ---- the table display ----
  await p.click('#gm-ipad [data-hotitle]');   // title off again
  const D = await open('#display', { width: 1180, height: 820 });
  const dp = D.page;
  await dp.waitForSelector('.dp-ambient', { state: 'attached', timeout: 20000 });
  await p.click('#gm-ipad [data-ho="wide"] [data-gm="ho-show"]');
  check(await dp.waitForSelector('.dp-handout img', { timeout: 20000 }).then(() => true, () => false), 'the display draws the handout');
  await dp.waitForFunction(() => { const i = document.querySelector('.dp-handout img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 10000 });
  const geo = await dp.evaluate(() => {
    const st = document.querySelector('.dp-handout'), i = st.querySelector('img'), r = i.getBoundingClientRect(), s = st.getBoundingClientRect();
    return { bg: getComputedStyle(st).backgroundColor, fit: getComputedStyle(i).objectFit, w: r.width, h: r.height, sw: s.width, sh: s.height, capHidden: st.querySelector('.dp-handout-cap').hidden, src: i.getAttribute('src') };
  });
  check(geo.bg === 'rgb(0, 0, 0)' && geo.fit === 'contain', 'on black, fitted (object-fit: contain)');
  check(geo.w <= geo.sw + 1 && geo.h <= geo.sh + 1 && geo.w > geo.sw * 0.9 && geo.h > geo.sh * 0.9, 'the image box is the whole screen (object-fit contain does the fitting, a small prop is enlarged): ' + JSON.stringify(geo));
  check(geo.capHidden && geo.src === 'media/handouts/' + MINE[1], 'the title caption is off; the image comes from media/handouts/');
  await dp.click('.dp-handout');
  check(await dp.$eval('.dp-handout-cap', (e) => !e.hidden && e.textContent === 'Invented wide banner'), 'a tap on the iPad shows the title caption');
  await dp.click('.dp-handout');
  check(await dp.$eval('.dp-handout-cap', (e) => e.hidden), 'and a second tap hides it');
  check(!D.reqs.some((u) => /\/api\/gm\/pack|handouts-manifest/.test(u)), 'the display never asked for the pack or a manifest');
  const seen = await dp.evaluate(() => document.getElementById('display-page').innerText);
  check(!/Invented brass key|dock clue|Invented missing/.test(seen), 'and shows nothing of the other entries');

  await p.click('#gm-ipad [data-ho="gone"] [data-gm="ho-show"]');
  check(await dp.waitForFunction(() => /not on the server/.test(document.querySelector('.dp-handout-cap') ? document.querySelector('.dp-handout-cap').textContent : ''), null, { timeout: 15000 }).then(() => true, () => false), 'a handout whose file was not deployed says so on the iPad');
  await p.click('#gm-ipad [data-ho="gone"] [data-gm="blankipad"]');
  await dp.waitForFunction(() => !document.querySelector('.dp-handout'), null, { timeout: 15000 });

  // ---- Claude suggests: the Rack ----
  check(await p.evaluate(() => window.B68GmPage.suggestHandout('nope', 'x')) === false, 'suggestHandout refuses an id the pack does not hold');
  check(await p.evaluate(() => window.B68GmPage.suggestHandout('key', 'They asked who owned the dock key.')) === true, 'suggestHandout accepts a pack id');
  await p.waitForSelector('#gm-rack .gm-offer', { timeout: 5000 });
  check(/Show handout: Invented brass key\?/.test(await p.textContent('#gm-rack .gm-offer')) && /who owned the dock key/.test(await p.textContent('#gm-rack .gm-offer')), 'the Rack shows "Show handout: <title>?" with the reason');
  check(await p.$('#gm-rack .gm-offer [data-gm="offer-show"]') !== null && await p.$('#gm-rack .gm-offer [data-gm="offer-dismiss"]') !== null, 'with Show and Dismiss');
  check(await p.$eval('#gm-rack .gm-offer', (e) => e.getBoundingClientRect().height > 0), 'it is visible under the console card');
  await p.evaluate(() => window.B68GmPage.suggestHandout('key', 'second reason'));
  check((await p.$$('#gm-rack .gm-offer')).length === 1 && /second reason/.test(await p.textContent('#gm-rack .gm-offer')), 'a repeat replaces the offer');
  await p.evaluate(() => window.B68GmPage.suggestHandout('wide', ''));
  check((await p.$$('#gm-rack .gm-offer')).length === 2, 'a second handout adds a second offer');
  await p.click('#gm-rack [data-offer="wide"] [data-gm="offer-dismiss"]');
  check((await p.$$('#gm-rack .gm-offer')).length === 1 && (await shownDisplay()).kind === 'blank', 'Dismiss drops it and shows nothing');
  await p.click('#gm-rack [data-offer="key"] [data-gm="offer-show"]');
  check(await until(async () => (await shownDisplay()).file === MINE[0], 8000), 'Show posts the handout');
  check(await p.waitForFunction(() => !document.querySelector('#gm-rack .gm-offer'), null, { timeout: 5000 }).then(() => true, () => false), 'and drops the offer');
  const post = await shownDisplay();
  check(post.kind === 'handout' && post.showTitle === false && !('when' in post) && !('id' in post), 'only the display fields went out');

  await G.c.close(); await D.c.close();
  check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
