// The Location map on map kit 0.7 at the table, end to end against a real local Worker (wrangler dev, DEV_USER) on PORT (default
// 8866), with only invented fixture tables: the GM page at the iPad's size (1366 x 1024 landscape) rolls a site (iso by default),
// shows it on the iPad, opens a band (it asks) and the iPad updates by itself, closes it (no ask) and the iPad follows; the street
// and the lit plate at Night in the rain go to the iPad; the iPad (#display, the GM signed in) draws each map it is sent. Nothing a
// player must not see is in what the server holds. GM.md, "Location" (Live reveal).
//   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node checks/runtime/gm-maps.e2e.mjs
// PW_MODULE=<path to playwright> picks the Playwright install; GM_SHOTS=<dir> saves the screenshots there.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8866);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const SHOTS = process.env.GM_SHOTS || '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const conFix = JSON.parse(readFileSync(path.join(FIX, 'console-pack.json'), 'utf8'));
const locFix = JSON.parse(readFileSync(path.join(FIX, 'location-pack.json'), 'utf8'));
const NOW = new Date().toISOString();
const PACK = { format: 1, exportedAt: NOW, parts: {
  console: conFix.parts.console, campaign: { ...conFix.parts.campaign, src: { ...conFix.parts.campaign.src, exportedAt: NOW } },
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: NOW }, T: locFix.T, extra: locFix.extra }
} };

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-maps-e2e-'));
const packFile = path.join(stateDir, 'b68-gm-pack.json');
writeFileSync(packFile, JSON.stringify(PACK));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use: stop what is on it, or set PORT'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM], { cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
function killServer() { if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} } }
process.on('exit', () => { killServer(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 300000);
const api = (method, p, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const display = async () => (await api('GET', '/gm/display')).json;
const text = (svg) => String(svg || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ').toLowerCase();

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [], asked = [];
  async function open(hash, answer) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1366, height: 1024 }, serviceWorkers: 'block', isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
    await c.addInitScript(() => { window.__B68_POLL_MS = 700; });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(hash + ': ' + m.text()); });
    page.on('pageerror', (e) => errors.push(hash + ' pageerror: ' + e.message));
    page.on('dialog', (d) => { asked.push(d.message()); return answer && answer.no ? d.dismiss() : d.accept(); });
    await page.goto(BASE + '/' + hash);
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    return { ctx: c, page };
  }
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + '.png') }); };
  const quiet = (page) => page.waitForFunction(() => !document.getElementById('toastMsg').textContent && !document.getElementById('toastErr').textContent, null, { timeout: 9000 }).catch(() => {});

  /* the GM: import the invented pack, roll a site */
  const answer = { no: false };
  const G = await open('#gm', answer);
  await G.page.waitForSelector('#gm-file', { state: 'attached', timeout: 20000 });
  await G.page.setInputFiles('#gm-file', packFile); await G.page.waitForSelector('#gm-prev table', { timeout: 10000 });
  await G.page.click('[data-gm="upload"]'); await G.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 20000 });
  await G.page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
  await G.page.keyboard.press('b'); await G.page.click('[data-gm="locroll"]'); await G.page.waitForSelector('#gm-loc .gm-loccard', { timeout: 10000 });
  check(await G.page.$eval('#gm-m-view', (s) => s.value === 'iso') && !!(await G.page.$('#gm-map svg')), 'a roll draws the GM-layer iso at once');
  check(await G.page.$$eval('#gm-m-view option', (o) => o.map((x) => x.value).join()) === 'iso,rings,plan,section,street' && await G.page.$$eval('#gm-m-theme option', (o) => o.map((x) => x.value).join()) === 'rulebook,blueprint,casefile,board,plate', 'the views and themes of map kit 0.7');
  check(!!(await G.page.$('#gm-m-time')) && !!(await G.page.$('#gm-m-weather')), 'Time and Weather in the View & theme fold');
  const roll = await G.page.evaluate(() => window.B68GmPage._state().locRoll);
  const secretsAt = (shown) => roll.rooms.filter((r) => !shown.includes(r.band)).map((r) => r.name.toLowerCase()).filter((n) => !['basement', 'ground floor', 'upper floor', 'top floor'].includes(n) && !roll.rooms.some((r) => shown.includes(r.band) && r.name.toLowerCase() === n))
    .concat([roll.physThreatName, roll.socThreatName].map((x) => String(x || '').toLowerCase())).filter((x) => x.length >= 4);
  await G.page.evaluate(() => { const m = document.querySelector('#gm-loc .gm-mapbox'); if (m) m.scrollIntoView({ block: 'start' }); });
  await quiet(G.page); await shot(G.page, 'maps1-01-gm-iso-gm-layer');

  /* the player layer to the iPad, then live reveal */
  await G.page.click('[data-gm="layer"][data-v="player"]');
  const s0 = (await display()).seq;
  await G.page.click('[data-gm="ipad"]');
  const d1 = await until(async () => { const d = await display(); return d.seq > s0 ? d : null; }, 8000);
  check(!!d1 && d1.display.kind === 'svg' && /surveyed: public$/.test(d1.display.caption), 'Show on iPad: the player copy (' + (d1 && d1.display.caption) + ')');
  const want1 = await G.page.evaluate(() => { const st = window.B68GmPage._state(); return window.B68Map.render(st.locRoll, Object.assign({ view: 'iso', theme: 'rulebook', layer: 'player', reveal: ['public'] }, window.B68GmPage._pure.IPAD_MAP)).svg; });
  const ids = (s) => String(s || '').replace(/b68m\d+-/g, 'b68m-');
  check(!!d1 && ids(d1.display.svg) === ids(want1), 'the iPad copy is the kit\'s player layer at the iPad\'s size');
  check(!!d1 && !secretsAt(['public']).some((n) => text(d1.display.svg).includes(n)), 'the iPad copy names nothing hidden');
  check(await G.page.waitForSelector('.gm-reveal .gm-live', { timeout: 5000 }).then(() => true, () => false), 'the Reveal legend says Live on the iPad');

  const D = await open('#display');
  check(await D.page.waitForSelector('#display-page .dp-map-frame svg', { timeout: 20000 }).then(() => true, () => false), '#display draws the map');
  await sleep(1200); await shot(D.page, 'maps1-02-ipad-iso-public');

  asked.length = 0;
  await G.page.check('[data-reveal="working"]');
  const d2 = await until(async () => { const d = await display(); return d.seq > d1.seq ? d : null; }, 8000);
  check(asked.length === 1 && /opening the working band shows it to the players now/.test(asked[0]), 'opening a band asks first (' + asked.join(' | ') + ')');
  check(!!d2 && /surveyed: public, working$/.test(d2.display.caption), 'and the iPad gets the player copy again at once (' + (d2 && d2.display.caption) + ')');
  check(!!d2 && !secretsAt(['public', 'working']).some((n) => text(d2.display.svg).includes(n)), 'the new copy names nothing still hidden');
  check(await D.page.waitForFunction(() => /working/.test((document.querySelector('#display-page .dp-strip-cap') || {}).textContent || ''), null, { timeout: 10000 }).then(() => true, () => false), '#display redraws by itself with the working band');
  await sleep(1200); await shot(D.page, 'maps1-03-ipad-iso-working');
  await G.page.evaluate(() => { const m = document.querySelector('#gm-loc .gm-mapbox'); if (m) m.scrollIntoView({ block: 'start' }); }); await quiet(G.page); await shot(G.page, 'maps1-04-gm-live');

  asked.length = 0;
  await G.page.uncheck('[data-reveal="working"]');
  const d3 = await until(async () => { const d = await display(); return d.seq > d2.seq ? d : null; }, 8000);
  check(asked.length === 0 && !!d3 && /surveyed: public$/.test(d3.display.caption), 'closing a band does not ask, and the iPad follows');

  answer.no = true; asked.length = 0;
  await G.page.click('[data-reveal="controlled"]');
  await sleep(1500);
  const noSeq = (await display()).seq, noChecked = await G.page.$eval('[data-reveal="controlled"]', (x) => x.checked), noDoc = await G.page.evaluate(() => window.B68GmPage._state().doc.loc.map.reveal.controlled);
  check(asked.length === 1 && noSeq === d3.seq && !noChecked && noDoc !== true, 'a no keeps the band shut and sends nothing (' + JSON.stringify({ asked: asked.length, sent: noSeq !== d3.seq, checked: noChecked, doc: noDoc }) + ')');
  answer.no = false;

  /* the street and the plate, at Night, in the rain */
  await G.page.evaluate(() => { const d = document.querySelector('details.gm-mapopts'); if (d) d.open = true; });
  await G.page.selectOption('#gm-m-view', 'street'); await G.page.selectOption('#gm-m-theme', 'plate');
  await G.page.selectOption('#gm-m-time', 'Night'); await G.page.selectOption('#gm-m-weather', 'rain');
  check(/street · plate · at night · rain/.test(await G.page.textContent('.gm-mapopts summary')), 'the fold\'s line names the view, theme, time and weather');
  const s4 = (await display()).seq;
  check(s4 === d3.seq, 'changing the view, theme, time or weather sends nothing by itself');
  await G.page.click('[data-gm="ipad"]');
  const d4 = await until(async () => { const d = await display(); return d.seq > s4 ? d : null; }, 8000);
  const want4 = await G.page.evaluate(() => { const st = window.B68GmPage._state(); return window.B68Map.render(st.locRoll, Object.assign({ view: 'street', theme: 'plate', layer: 'player', reveal: ['public'], time: 'Night', weather: 'rain' }, window.B68GmPage._pure.IPAD_MAP)).svg; });
  check(!!d4 && ids(d4.display.svg) === ids(want4), 'Show on iPad: the street on the plate at Night in the rain');
  check(!!d4 && roll.watcher && !text(d4.display.svg).includes(String(roll.watcher).replace(/,.*$/, '').toLowerCase()), 'the street\'s player copy has no watcher');
  await D.page.waitForFunction((n) => (document.querySelector('#display-page .dp-map-frame svg') || {}).outerHTML && document.querySelector('#display-page .dp-map-frame svg').outerHTML.length !== n, (d2.display.svg || '').length, { timeout: 10000 }).catch(() => {});
  await sleep(4500); await shot(D.page, 'maps1-05-ipad-street-plate-night-rain');
  await G.page.evaluate(() => { const m = document.querySelector('#gm-loc .gm-mapbox'); if (m) m.scrollIntoView({ block: 'start' }); }); await quiet(G.page); await shot(G.page, 'maps1-06-gm-street-plate');

  /* the iso on the plate at Bluetime */
  await G.page.selectOption('#gm-m-view', 'iso'); await G.page.selectOption('#gm-m-time', 'Bluetime'); await G.page.selectOption('#gm-m-weather', '');
  await G.page.click('[data-gm="ipad"]');
  const d5 = await until(async () => { const d = await display(); return d.seq > d4.seq ? d : null; }, 8000);
  check(!!d5 && d5.display.kind === 'svg', 'Show on iPad: the iso on the plate at Bluetime');
  await sleep(2000); await shot(D.page, 'maps1-07-ipad-iso-plate-bluetime');

  check(!errors.length, 'no page errors: ' + errors.slice(0, 3).join(' | '));
  await browser.close();
} catch (e) { failed++; console.log('FAIL ' + (e && e.stack || e)); }
clearTimeout(timeout);
console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASSED'));
process.exit(failed ? 1 : 0);
