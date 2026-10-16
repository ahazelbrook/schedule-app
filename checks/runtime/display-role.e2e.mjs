// The table display sign-in in a real browser (GM.md "The display sign-in"): the iPad signed in as a DISPLAY_EMAILS address opens
// the app, lands on the full-screen display whatever the hash says, shows what the GM pushed, and makes no API call but the two
// it needs (GET /api/me, GET /api/gm/display, which also carries what the transcriber wants: no GET /api/gm/stt) and its own
// status report: no 403 anywhere, no characters / campaign / members / npcs fetch. The request budget (Workers Free, GM.md "The
// display"): a look every 4 s, every 15 s after two hours of nothing new, and a page whose sign-in has ended reloads itself after
// ten minutes and not again within half an hour. The two long waits use Playwright's clock (page.clock, 1.45+) to jump the time.
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
  const calls = [], reads = [];
  page.on('response', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/')) calls.push(r.request().method() + ' ' + u.pathname + ' ' + r.status()); });
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname === '/api/gm/display') reads.push(u.search); });
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

  await step('only GET /api/me and GET /api/gm/display (and the iPad’s own status report) were called, and none was refused: the transcriber asks nothing of its own', async () => {
    await sleep(6000);                                           // past the 4 s beat the transcriber would have used on its own
    const odd = calls.filter((c) => !/^(GET \/api\/(me|gm\/display)|PATCH \/api\/gm\/stt) 200$/.test(c));
    expect(odd.length === 0, 'unexpected API calls: ' + odd.join(' | '));
    expect(calls.some((c) => c === 'GET /api/gm/display 200'), 'display was polled: ' + calls.join(' | '));
    expect(!calls.some((c) => c.startsWith('GET /api/gm/stt')), 'the display read carries the transcriber, so no GET /api/gm/stt: ' + calls.join(' | '));
  });

  await step('the display read names all three parts after the first (seq, aseq, sseq), and the first names none', async () => {
    expect(reads[0] === '', 'the first read: ' + reads[0]);
    expect(reads.length >= 2 && reads.slice(1).every((q) => /^\?seq=\d+&aseq=\d+&sseq=\d+$/.test(q)), 'the later reads: ' + reads.join(' | '));
  });

  await step('the GM asks for listening: the tap appears on the display and goes when the GM stops, with no GET /api/gm/stt', async () => {
    const ask = (body) => fetch(BASE + '/api/gm/stt', { method: 'PATCH', headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect((await ask({ want: 'on', session: '9' })).status === 200, 'want on');
    await page.waitForSelector('.stt-tap:not([hidden])', { timeout: 15000 });
    expect((await page.textContent('.stt-tap')).includes('Tap to start listening'), 'the tap says so');
    expect((await ask({ want: 'off' })).status === 200, 'want off');
    await page.waitForSelector('.stt-tap', { state: 'hidden', timeout: 15000 });
    expect(!calls.some((c) => c.startsWith('GET /api/gm/stt')), 'still no GET /api/gm/stt: ' + calls.filter((c) => c.includes('stt')).join(' | '));
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

  /* ---- the request budget: what an iPad left on all night costs (Workers Free allows 100,000 requests a day for the whole site) ---- */
  const STATUS = '.dp-status-text';
  const text = (pg, sel) => pg.evaluate((q) => (document.querySelector(q) || {}).textContent || '', sel);
  async function until(fn, ms, every = 100) { const t0 = Date.now(); for (;;) { const v = await fn(); if (v || Date.now() - t0 > ms) return v; await sleep(every); } }

  /* E14: when the Access sign-in ends, every call is refused for good and the page used to say "Not signed in" for ever.
     Access answers a fetch with a redirect to its sign-in page; the adapter calls that signed out. */
  const octx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1180, height: 820 } });
  const opage = await octx.newPage();
  await opage.clock.install();                                  // time flows as usual until a test jumps it
  let signedIn = true, loads = 0;
  opage.on('load', () => { loads++; });
  await opage.route((u) => u.pathname === '/api/gm/display', (route) => (signedIn ? route.continue()
    : route.fulfill({ status: 302, headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login/blades' } })));
  await opage.goto(BASE + '/');
  await opage.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 15000 });

  await step('the sign-in ends: the display says so, and the page has not reloaded yet', async () => {
    expect(await until(async () => /Updated|Waiting/.test(await text(opage, STATUS)), 10000), 'signed in first: ' + await text(opage, STATUS));
    signedIn = false;
    expect(await until(async () => /Not signed in/.test(await text(opage, STATUS)), 12000), 'the corner says so: ' + await text(opage, STATUS));
    expect(loads === 1, 'loads so far: ' + loads);
  });

  await step('ten minutes signed out: it reloads itself once, having noted the time in localStorage and sessionStorage', async () => {
    await opage.clock.fastForward('09:30'); await sleep(1500);
    expect(loads === 1, 'not before the ten minutes: ' + loads);
    await opage.clock.fastForward('01:00');
    expect(await until(() => loads === 2, 15000), 'reloaded: loads ' + loads);
    await opage.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 15000 });
    const kept = await opage.evaluate(() => [localStorage.getItem('b68.display.reload'), sessionStorage.getItem('b68.display.reload'), Date.now()]);
    expect(/^\d{13}$/.test(kept[0]) && kept[0] === kept[1], 'the time noted in both: ' + kept.join(' | '));
    expect(Math.abs(Number(kept[0]) - kept[2]) < 60000, 'and it is about now (the jumped clock): ' + kept.join(' | '));
  });

  await step('still signed out ten minutes after that: no second reload within half an hour; after half an hour, one more', async () => {
    expect(await until(async () => /Not signed in/.test(await text(opage, STATUS)), 12000), 'denied again: ' + await text(opage, STATUS));
    await opage.clock.fastForward('10:30'); await sleep(2500);
    expect(loads === 2, 'ten minutes after the last reload is too soon: ' + loads);
    await opage.clock.fastForward('20:00');
    expect(await until(() => loads === 3, 15000), 'half an hour after the last: loads ' + loads);
    await opage.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 15000 });
  });

  await step('with no storage to note the time in, a signed-out display does not reload', async () => {
    const sctx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1180, height: 820 } });
    const spage = await sctx.newPage();
    await spage.addInitScript(() => {
      const refuse = () => { throw new DOMException('blocked', 'SecurityError'); };
      for (const k of ['setItem']) { try { Storage.prototype[k] = refuse; } catch (e) { /* kept */ } }
    });
    await spage.clock.install();
    let n = 0, out = false; spage.on('load', () => { n++; });
    await spage.route((u) => u.pathname === '/api/gm/display', (route) => (out ? route.fulfill({ status: 302, headers: { location: 'https://team.cloudflareaccess.com/x' } }) : route.continue()));
    await spage.goto(BASE + '/'); await spage.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 15000 });
    expect(await until(async () => /Updated|Waiting/.test(await text(spage, STATUS)), 10000), 'signed in first');
    out = true;
    expect(await until(async () => /Not signed in/.test(await text(spage, STATUS)), 12000), 'denied');
    await spage.clock.fastForward('01:00:00'); await sleep(3000);
    expect(n === 1, 'it stayed as it was: loads ' + n);
    await sctx.close();
  });

  /* E4: nothing changes for two hours and the display looks every 15 s instead of every 4 s, until the GM pushes something */
  await step('two hours with nothing new: it looks every 15 s; a push shows within one beat and brings the 4 s beat back', async () => {
    const ictx = await browser.newContext({ extraHTTPHeaders: { 'X-Dev-User': IPAD }, viewport: { width: 1180, height: 820 } });
    const ipg = await ictx.newPage();
    await ipg.clock.install();
    const at = []; ipg.on('request', (r) => { if (new URL(r.url()).pathname === '/api/gm/display') at.push(Date.now()); });
    await ipg.goto(BASE + '/'); await ipg.waitForFunction(() => document.body.dataset.mode === 'display', null, { timeout: 15000 });
    expect(await until(() => at.length >= 3, 15000), 'looking every few seconds: ' + at.length);
    const gaps = () => at.slice(1).map((t, i) => t - at[i]);
    expect(gaps().every((g) => g > 2500 && g < 7000), 'the 4 s beat while things are fresh: ' + gaps().join(' '));
    await ipg.clock.fastForward('02:00:30');
    const n0 = at.length;
    expect(await until(() => at.length >= n0 + 2, 45000, 200), 'looks after the jump: ' + (at.length - n0));
    const idle = gaps().slice(n0 - 1);                         // the look the jump itself caused (or timed out), then the beat it settled on
    expect(idle.slice(-1)[0] > 13000 && idle.slice(-1)[0] < 18000, 'every 15 s: ' + idle.join(' '));
    const NEW = 'Quiet again, then this';
    const r = await fetch(BASE + '/api/gm/display', { method: 'PUT', headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'text', title: 'After hours', text: NEW }) });
    expect(r.status === 200, 'push ' + r.status);
    await ipg.waitForFunction((t) => document.getElementById('display-page').innerText.includes(t), NEW, { timeout: 20000 });
    const n1 = at.length;
    expect(await until(() => at.length >= n1 + 2, 15000, 200), 'looks after the push');
    expect(gaps().slice(-1)[0] < 7000, 'back on the 4 s beat: ' + gaps().slice(-3).join(' '));
    await ictx.close();
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
