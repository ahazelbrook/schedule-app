// Turn the Key and the Key Cabinet in a real browser (suite 1.8, 5.6): a player's phone, the GM page and the iPad against a local Worker.
//   Everything built is on (N0): with nothing stored the Keys box is the cabinet, a card per key with a fill bar and a flip to both deadlocks.
//   A key with three hits offers the turn; turning it deadlocks the key for good, clears Stress, the iPad shows the keyturn card with AUTOMATIC CRITICAL,
//   and the next action roll is a critical. A key with fewer than three hits offers nothing. A stored false (the old All off) changes nothing.
//   PW_MODULE=<playwright> PW_CHANNEL=msedge PORT=9160 node checks/runtime/sheet-keys.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9160);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', P1 = 'p1@example.test', ID = 'c-keys-1';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const conFix = JSON.parse(readFileSync(path.join(FIX, 'console-pack.json'), 'utf8'));
const locFix = JSON.parse(readFileSync(path.join(FIX, 'location-pack.json'), 'utf8'));
const NOW = new Date().toISOString();
const PARTS = {
  console: conFix.parts.console,
  campaign: { ...conFix.parts.campaign, src: { ...conFix.parts.campaign.src, exportedAt: NOW } },
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: NOW }, T: locFix.T, extra: locFix.extra }
};

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-keys-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM], { cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: ['ignore', 'pipe', 'pipe'] });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
function killServer() { if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} } }
process.on('exit', () => { killServer(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const timeout = setTimeout(() => { console.log('FAIL timed out\n' + serverLog.slice(-2000)); process.exit(1); }, 400000);
const api = (method, p, user, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': user, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const charDoc = (j) => (!j || typeof j !== 'object') ? null : (j.doc && typeof j.doc === 'object') ? j.doc : j;

try {
  const ready = await until(async () => { if (server.exitCode !== null) throw new Error('wrangler exited:\n' + serverLog); try { return (await fetch(BASE + '/api/me')).status > 0; } catch (_) { return false; } }, 120000, 500);
  if (!ready) throw new Error('server not ready:\n' + serverLog);
  for (const [part, q] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', GM, { part, src: q.src || {}, body: Object.fromEntries(Object.entries(q).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status + ' ' + JSON.stringify(r.json));
  }
  const play = { keys: [{ name: 'KEY-1', down: 'Reversed word', up: 'Intensified word', hits: 2 }, { name: 'KEY-2', down: 'Down two', up: 'Up two', hits: 1 }], stress: 5 };
  check((await api('PUT', '/characters/' + ID, P1, { name: 'Nell Arbuthnot', playbook: 'hound', spec: { name: 'Nell Arbuthnot', playbook: 'hound' }, sheet: { name: 'Nell Arbuthnot' }, play })).status === 200, 'the player files a character with two keys');
  await api('PUT', '/campaign', GM, { v: 1, session: { number: 1, startedAt: new Date().toISOString(), endedAt: null }, crew: {}, clocks: [], log: [] });

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(route, user, { w = 1280, h = 800, mobile = false } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': user }, viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
    await c.addInitScript(() => { window.__B68_POLL_MS = 600; });
    const page = await c.newPage();
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(route + ': ' + m.text()); });
    page.on('pageerror', (e) => errors.push(route + ' pageerror: ' + e.message));
    page.on('dialog', (d) => d.accept());
    await page.goto(BASE + '/' + route);
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    return { c, page };
  }
  const keyBox = (pg) => pg.evaluate(() => { const b = document.querySelector('#dossier .ds-keybox'); return b ? { html: b.innerHTML, offer: b.querySelectorAll('.ds-kt-offer').length, cards: b.querySelectorAll('.ds-kcard').length, text: b.innerText } : null; });
  const stressNow = async () => (charDoc((await api('GET', '/characters/' + ID, GM)).json).play || {}).stress;

  const G = await open('#gm', GM);
  await G.page.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  const Pn = await open('#c/' + ID, P1, { w: 390, h: 844, mobile: true });
  await Pn.page.waitForSelector('#dossier .ds-keybox', { timeout: 30000 });
  const D = await open('#display', GM, { w: 1366, h: 1024 });
  await D.page.waitForSelector('.dp-overlay', { state: 'attached', timeout: 20000 });

  /* ---- everything on (N0), nothing stored: the cabinet, and no offer below three hits ---- */
  const c0 = await until(async () => { const b = await keyBox(Pn.page); return b && b.cards === 2 ? b : null; }, 10000, 200);
  check(!!c0 && c0.offer === 0 && /KEY-1/.test(c0.html), 'nothing stored: the Keys box is the cabinet, a card per key, and no key below three hits offers a turn');
  check(!!c0 && /1 more hit to turn it/.test(c0.text) && /2 more hits to turn it/.test(c0.text), 'each card counts the hits it still needs');
  /* tap KEY-1's third hit */
  await Pn.page.click('#dossier .ds-kcard[data-key="0"] .ds-pip:nth-of-type(3)');
  await until(async () => ((charDoc((await api('GET', '/characters/' + ID, GM)).json).play || {}).keys || [])[0].hits === 3, 6000, 200);
  const offered = await until(async () => (await keyBox(Pn.page)).offer === 1, 10000, 200);
  const on1 = await keyBox(Pn.page);
  check(offered && /You can turn this key/.test(on1.text) && /KEY-1/.test(on1.html), 'the key with three hits offers the turn; the other (one hit) offers nothing: offers=' + on1.offer);
  check(on1.cards === 2, 'inside the cabinet');

  await Pn.page.click('#dossier .ds-keybox [data-act="kturn"][data-dir="down"]');
  const turned = await until(async () => { const d = charDoc((await api('GET', '/characters/' + ID, GM)).json); const k = (d.play || {}).keys; return k && k[0].deadlock === 'down' ? d : null; }, 8000, 200);
  check(!!turned, 'turning saves: the key is deadlocked (reversed) on the character');
  check(turned && turned.play.stress === 0 && turned.play.keyTurn && turned.play.keyTurn.seq === 1 && turned.play.autoCrit, 'Stress is clear, keyTurn seq 1 and an automatic critical are recorded');
  check(turned && turned.play.keys[1].deadlock == null, 'the other key is untouched');
  const sawCard = await until(async () => D.page.evaluate(() => { const c = document.querySelector('.dp-overlay .dp-show-keyturn'); return c ? c.innerText : null; }), 15000, 150);
  check(!!sawCard && /KEY-1/.test(sawCard) && /AUTOMATIC CRITICAL/.test(sawCard) && /Reversed word/.test(sawCard) && /Nell Arbuthnot/.test(sawCard), 'the iPad shows the keyturn card with the key, its deadlock and AUTOMATIC CRITICAL: ' + JSON.stringify(sawCard));
  const after = await keyBox(Pn.page);
  check(after.offer === 0 && /Automatic critical waiting/.test(after.text), 'the offer is gone and the sheet says an automatic critical is waiting');
  await sleep(1500);
  check((await G.page.$$eval('.dp-show-keyturn', (e) => e.length)) === 0, 'the GM page fired the beat once (no second card from the same turn)');

  /* the next action roll */
  await Pn.page.click('#dossier [data-act="rollopen"]');
  await Pn.page.click('#dossier [data-act="rollapp"]');
  await Pn.page.waitForSelector('#dossier .ds-roll [data-act="roll"]', { timeout: 8000 });
  check(/Automatic critical waiting/.test(await Pn.page.$eval('#dossier .ds-roll', (e) => e.innerText)), 'the roll panel says the roll will be an automatic critical');
  await Pn.page.click('#dossier .ds-roll [data-act="roll"]');
  await Pn.page.waitForSelector('#dossier .ds-roll-word.critical', { timeout: 8000 });
  const stored = await until(async () => { const d = charDoc((await api('GET', '/characters/' + ID, GM)).json); return d.play && !d.play.autoCrit ? d : null; }, 6000, 200);
  check(!!stored, 'the roll is a critical and the debt is cleared (once)');
  await Pn.page.click('#dossier [data-act="rollclose"]');

  /* ---- the cabinet after the turn ---- */
  const cab = await until(async () => (await keyBox(Pn.page)).cards === 2, 10000, 200);
  const on2 = await keyBox(Pn.page);
  check(cab, 'still a card per key (' + on2.cards + ')');
  check(/Deadlocked: ▼ Reversed word/.test(on2.text) && /2 more hits to turn it/.test(on2.text), 'the turned card shows its deadlock; the other counts the hits it still needs');
  await Pn.page.click('#dossier .ds-kcard[data-key="1"] [data-act="kflip"]');
  await until(async () => (await Pn.page.$('#dossier .ds-kcard[data-key="1"].back')) !== null, 3000, 100);
  const back = await keyBox(Pn.page), dv = await Pn.page.$eval('#dossier .ds-kcard[data-key="1"] [data-path="keys.1.down"]', (e) => e.value).catch(() => null);
  check(/reversed/i.test(back.text) && /intensified/i.test(back.text) && dv === 'Down two', 'turned over, the card shows both deadlocks (reversed and intensified): ' + JSON.stringify([dv, back.text.slice(0, 200)]));
  await Pn.page.click('#dossier .ds-kcard[data-key="1"] [data-act="kflip"]');
  await Pn.page.click('#dossier .ds-kcard[data-key="1"] .ds-pip:nth-of-type(2)');
  const hit2 = await until(async () => ((charDoc((await api('GET', '/characters/' + ID, GM)).json).play || {}).keys || [])[1].hits === 2, 6000, 200);
  check(hit2 && (await Pn.page.$eval('#dossier .ds-kcard[data-key="1"] .ds-kc-bar i', (e) => e.style.width)) === '67%', 'a hit fills the card (2 of 3)');
  check(await Pn.page.evaluate(() => document.documentElement.scrollWidth <= 391), 'the cabinet fits a 390 px phone');

  /* ---- a stored false (the old All off, written by an older page into both documents) changes nothing ---- */
  check((await api('PATCH', '/gm/state', GM, { features: { 'spine.keyturn': false, 'between.keys': false } })).status === 200 && (await api('PATCH', '/campaign', GM, { features: { 'spine.keyturn': false, 'between.keys': false } })).status === 200, 'a stored false is written to both documents');
  await sleep(2500);
  const still = await keyBox(Pn.page);
  check(still && still.cards === 2 && (await Pn.page.evaluate(() => window.B68Flags.on('between.keys') && window.B68Flags.on('spine.keyturn'))), 'and changes nothing: the phone is still told both are on, and the cabinet stays');
  check((await G.page.$$('#gm-menu-switchboard')).length === 0, 'there is no Switchboard to turn them off');
  check(errors.length === 0, 'no console errors: ' + errors.slice(0, 3).join(' / '));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e) + '\n' + serverLog.slice(-1500));
}
clearTimeout(timeout);
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
