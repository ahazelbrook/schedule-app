// The table display sign-in in a real browser (GM.md "The display sign-in"): the iPad signed in as a DISPLAY_EMAILS address opens
// the app, lands on the full-screen display whatever the hash says, shows what the GM pushed, and makes no API call but the two
// it is allowed (GET /api/me, GET /api/gm/display): no 403 anywhere, no characters / campaign / members / npcs fetch.
//   PW_MODULE=<path to playwright> node checks/runtime/display-role.e2e.mjs      (invented fixtures only)
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8856);
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';
const stateDir = mkdtempSync(path.join(tmpdir(), 'b68-displayrole-e2e-'));
const WRANGLER = path.join(ROOT, 'node_modules', '.bin', 'wrangler');
const env = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };

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

const TEXT = 'The Hart is late tonight';
const put = await fetch(BASE + '/api/gm/display', { method: 'PUT', headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'text', title: 'Tonight', text: TEXT }) });
if (put.status !== 200) { console.log('FAIL could not push a display as the GM: ' + put.status); process.exit(1); }

const browser = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
try {
  const ctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1180, height: 820 } });
  const page = await ctx.newPage();
  const calls = [];
  page.on('response', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) calls.push(r.request().method() + ' ' + u.pathname + ' ' + r.status()); });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));

  await step('the display sign-in opens the app on the plain URL and lands on the display', async () => {
    await page.goto(BASE + '/');
    await page.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 15000 });
    expect(await page.evaluate(() => location.hash) === '#display', 'hash is #display');
  });

  await step('it shows what the GM pushed', async () => {
    await page.waitForFunction((t) => document.getElementById('display-page') && document.getElementById('display-page').innerText.includes(t), TEXT, { timeout: 15000 });
  });

  await step('it cannot leave: #gm, #cast, #t and #create all stay on the display', async () => {
    for (const h of ['#gm', '#cast', '#t', '#create', '#rules']) {
      await page.evaluate((x) => { location.hash = x; }, h);
      await sleep(400);
      const m = await page.evaluate(() => document.body.dataset.mode);
      expect(m === 'display', h + ' -> mode ' + m);
    }
  });

  await step('only GET /api/me, GET /api/gm/display and the transcriber’s GET /api/gm/stt were called, and none was refused', async () => {
    await sleep(1500);
    const odd = calls.filter((c) => !/^GET \/api\/(me|gm\/display|gm\/stt) 200$/.test(c));
    expect(odd.length === 0, 'unexpected API calls: ' + odd.join(' | '));
    expect(calls.some((c) => c === 'GET /api/gm/display 200'), 'display was polled: ' + calls.join(' | '));
  });

  await step('no page errors, and no "files offline" toast', async () => {
    expect(errors.length === 0, errors.join(' | '));
    expect(!(await page.evaluate(() => document.body.innerText)).includes('Files offline'), 'toast visible');
  });

  await step('a new push reaches the display without a reload', async () => {
    const r = await fetch(BASE + '/api/gm/display', { method: 'PUT', headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'text', title: 'Later', text: 'Second words' }) });
    expect(r.status === 200, 'push ' + r.status);
    await page.waitForFunction(() => document.getElementById('display-page').innerText.includes('Second words'), null, { timeout: 20000 });
  });

  // and the GM is unchanged: the same browser as the GM still gets the GM page
  const gctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': GM }, viewport: { width: 1180, height: 820 } });
  const gpage = await gctx.newPage();
  await step('the GM is unchanged: #gm opens the GM page, not the display', async () => {
    await gpage.goto(BASE + '/#gm');
    await gpage.waitForFunction(() => document.body.dataset.mode === 'gm', null, { timeout: 15000 });
    await gpage.evaluate(() => { location.hash = '#display'; });
    await gpage.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 5000 });
  });
} finally {
  await browser.close();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
killServer();
process.exit(failed ? 1 : 0);
