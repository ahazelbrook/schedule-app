// The Claude box (app/gm/assist-panel.js) on the real GM page, in a real browser, against a local wrangler dev. The assist endpoints are
// answered by the browser's own route (invented cards): no key, no model, no spend. Checks: the launcher and its count, the banner, key A,
// Listening-gated polling, the five Fit lines, the 429 state, a phone layout with no box, and that the player view never has it.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [GM_SHOTS=<dir>] node checks/runtime/gm-assist-panel.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8861);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const SHOTS = process.env.GM_SHOTS || '';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const fx = (f) => JSON.parse(readFileSync(path.join(FIX, f), 'utf8'));
const con = fx('console-pack.json'), loc = fx('location-pack.json'), np = fx('npc-pack.json');
const PARTS = {
  console: con.parts.console, campaign: np.parts.campaign, npc: np.parts.npc,
  location: { src: { file: 'fixture/location', blockSha: '0', exportedAt: new Date().toISOString() }, T: loc.T, extra: loc.extra },
};

const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-assist-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', stateDir], { cwd: ROOT, env, encoding: 'utf8', shell: WIN });
if (mig.status !== 0) { console.log('FAIL migrations\n' + mig.stdout + mig.stderr); process.exit(1); }
const server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
  '--persist-to', stateDir, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM], { cwd: ROOT, env, detached: !WIN, shell: WIN, stdio: 'ignore' });
function killServer() {
  if (WIN) spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} }
}
process.on('exit', () => { killServer(); try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {} });
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130));

let failed = 0, passed = 0;
function check(cond, msg) { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (cond) passed++; else failed++; }
async function until(fn, ms, step = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(step); } }
const api = (method, p, body) => fetch(BASE + '/api' + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
  .then(async (r) => { const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { status: r.status, json: j }; });

const CARD = { seat: 'ref', at: new Date().toISOString(), text: 'Invented rule slip: a stress cost can be resisted once per roll.', detail: { said_at: '22:14', rule: 'Rulebook p. 12' } };
const CLERK = { seat: 'clerk', at: new Date().toISOString(), text: 'Invented clerk note: a new name came up twice.' };
const FIT = { seat: 'fixer', at: new Date().toISOString(), text: 'Crew at the gate, risky, standard effect.', read: 'Crew at the gate, risky, standard effect.',
  one_three: 'A guard glances over.', four_five: 'In, but the lock is marked.', six: 'Clean through.', crit: 'The guard waves them in.', bargain: 'Leave a tool behind.' };

try {
  const up = await until(async () => { try { return (await fetch(BASE + '/index.html')).status > 0; } catch (_) { return false; } }, 90000, 500);
  if (!up) throw new Error('the server did not start');
  for (const [part, p] of Object.entries(PARTS)) {
    const r = await api('POST', '/gm/pack', { part, src: p.src, body: Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'src')) });
    if (r.status !== 200) throw new Error('pack ' + part + ' -> ' + r.status);
  }
  await api('PATCH', '/gm/stt', { want: 'on' });

  const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
  const errors = [];
  async function open(hash, { width = 1280, height = 800, mobile = false, tickReply } = {}) {
    const c = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width, height }, serviceWorkers: 'block', isMobile: mobile, hasTouch: mobile });
    const page = await c.newPage();
    const seen = { tick: [], fit: [] };
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    const reply = { cards: [CARD], updates: [{ seat: 'ledger', at: CARD.at, key: 'stress', text: 'Invented: two stress to the crew.' }], flags: ['harm'], spend: { tonight: 1.42, cap: 20, tier: 'all', tick: 0.02 }, last: 12 };
    seen.mode = 'card';
    await page.route('**/api/gm/assist/tick', async (route) => {
      seen.tick.push(JSON.parse(route.request().postData() || '{}'));
      if (seen.mode === 'cap') return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: "tonight's cap is reached" }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(seen.mode === 'second' ? { ...reply, cards: [CLERK], updates: [], last: 20 } : reply) });
    });
    await page.route('**/api/gm/assist/fit', async (route) => {
      seen.fit.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cards: [FIT], flags: [], spend: { tonight: 1.9, cap: 20, tier: 'all', tick: 0.5 }, last: 12 }) });
    });
    await page.goto(BASE + '/' + hash);
    await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me, null, { timeout: 30000 });
    return { c, page, seen };
  }
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'assist-ui-' + name + '.png') }); };

  // ---- laptop ----
  const G = await open('#gm');
  const p = G.page;
  await p.waitForSelector('#gm-buttons .gm-btn', { timeout: 30000 });
  check(await p.waitForSelector('.gm-assist .as-launch', { timeout: 10000 }).then(() => true, () => false), 'the launcher is on the GM page');
  check(await p.waitForFunction(() => !document.querySelector('.gm-assist .as-count').hidden, null, { timeout: 15000 }).then(() => true, () => false), 'Listening is on: the first tick ran and the count shows');
  check(JSON.stringify(G.seen.tick[0]) === '{}', 'the first tick has no cursor');
  check(await p.$eval('.gm-assist .as-launch img', (i) => i.complete && i.naturalWidth > 0), 'the launcher shows the portrait');
  check(await p.$eval('.gm-assist .as-banner', (b) => !b.hidden && /rule slip/i.test(b.textContent)), 'the banner is up beside the launcher');
  await sleep(400);
  await shot(p, 'collapsed-banner');
  await p.waitForTimeout(500);
  await p.keyboard.press('a');
  check(await p.$eval('#as-panel', (e) => !e.hidden), 'key A opens the box');
  check(await p.$eval('.gm-assist .as-banner', (b) => b.hidden), 'the banner goes when the box opens');
  check((await p.$$('.gm-assist .as-card')).length === 1 && /p\. 12/.test(await p.$eval('.gm-assist .as-card', (e) => e.textContent)), 'the bubble carries the page cite');
  check(await p.$$eval('.gm-assist .as-up', (l) => l.length) === 1, 'the Ledger update is listed');
  await p.fill('#as-eff', 'standard');
  await p.click('.gm-assist .as-pos label:nth-child(3)');
  await p.click('#as-go');
  check(await p.waitForSelector('.gm-assist .as-lines li', { timeout: 10000 }).then(() => true, () => false), 'Fit it shows the lines');
  check((await p.$$('.gm-assist .as-lines li')).length === 5, 'five lines: 1-3, 4-5, 6, crit, bargain');
  check(JSON.stringify(G.seen.fit[0]) === JSON.stringify({ position: 'desperate', effect: 'standard' }), 'the fit request carried the position and the effect');
  await shot(p, 'expanded');
  await p.keyboard.press('Escape');
  check(await p.$eval('#as-panel', (e) => e.hidden), 'Escape closes the box');
  await p.keyboard.press('a'); await p.keyboard.press('a');
  check(await p.$eval('#as-panel', (e) => e.hidden), 'A twice leaves it closed');
  check(await p.$eval('#gm-root', (r) => r.getAttribute('data-panel')) !== null && await p.$eval('#gm-page', (e) => !!e.querySelector('#gm-buttons')), 'the other keys still work: the page is intact');
  await p.keyboard.press('n');
  check(await p.$eval('#gm-root', (r) => r.getAttribute('data-panel')) === 'npc', 'key N still opens the NPC panel');

  // the next tick carries the cursor; then a 429 stops everything
  G.seen.mode = 'second';
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  check(await until(async () => G.seen.tick.length >= 2, 8000), 'a returning tab polls at once');
  check(G.seen.tick[1] && G.seen.tick[1].after === 12, 'the second tick carries `after` = the last answer');
  G.seen.mode = 'cap';
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await until(async () => G.seen.tick.length >= 3, 8000);
  await p.keyboard.press('a');
  check(await p.waitForFunction(() => /Cap reached/.test(document.querySelector('#as-status').textContent), null, { timeout: 8000 }).then(() => true, () => false), 'a 429 shows the cap state, in words');
  check(!/[{}]|error/.test(await p.$eval('#as-status', (e) => e.textContent)), 'no raw JSON');
  const n = G.seen.tick.length;
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await sleep(800);
  check(G.seen.tick.length === n, 'polling has stopped');
  await shot(p, 'capped');

  // Listening off: no ticks
  await api('PATCH', '/gm/stt', { want: 'off' });
  G.seen.mode = 'card';
  if (await p.$eval('#as-panel', (e) => e.hidden)) await p.keyboard.press('a');
  await p.click('.gm-assist [data-as="resume"]');
  await sleep(1200);
  check(G.seen.tick.length === n, 'Listening off: Check again asks nothing of the model');
  await G.c.close();

  // ---- a phone: no box ----
  await api('PATCH', '/gm/stt', { want: 'on' });
  const M = await open('#gm', { width: 390, height: 800, mobile: true });
  await sleep(4000);
  check(await M.page.$eval('.gm-assist', (e) => getComputedStyle(e).display === 'none').catch(() => true), 'a phone has no Claude box');
  check(M.seen.tick.length === 0, 'and it does not poll');
  await M.c.close();

  // ---- not the GM page: no box ----
  const H = await open('#');
  await sleep(2500);
  check(await H.page.$('.gm-assist') === null && H.seen.tick.length === 0, 'the home page has no Claude box and calls nothing');
  await H.c.close();
  check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
