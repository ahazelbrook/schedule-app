// The 18 tools INLINE (the night rebuild, N2): against the demo night (scripts/demo-night.mjs), bind each tool to a container in the GM page in turn,
// open it through B68GmTools.get(id).open(), assert it drew real content (a known element per tool), that nothing is logged as an error, that it
// kept its place after an action, and that unbinding it stops its timers: no request leaves the page for 10 s after the unbind that the page did not
// already make by itself in a 16 s window before any tool was opened. (N2-fix) Also: the Light relay panel asks the relay once on open; a bound tool
// that is hidden or detached is not open for Esc; binding inline empties the right-edge copy (no SVG id twice in the page).
//   PW_MODULE=<playwright-core> PW_CHANNEL=msedge [PORT=8951] [DEMO_URL=http://127.0.0.1:8950] [GM_SHOTS=<dir>] node checks/runtime/gm-tools-inline.e2e.mjs
// With DEMO_URL the check uses a demo night that is already running (npm run demo:night -- --port 8950) and starts none; otherwise it starts its own on PORT.
// With GM_SHOTS it keeps a picture of every tool at 330 px (a left column) and at 900 px (a view) in <dir> (<id>-330.png, <id>-900.png).
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8951);
const SHOTS = process.env.GM_SHOTS || '';
const OWN = !process.env.DEMO_URL;
const BASE = process.env.DEMO_URL || 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const WIN = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');

let passed = 0, failed = 0;
const check = (ok, name) => { if (ok) { passed++; console.log('PASS ' + name); } else { failed++; console.log('FAIL ' + name); } };

/* the tools, each with an element only that tool draws (what "it rendered real content" means) */
const TOOLS = [
  ['hardstart', '[data-hs="arm"]'], ['preflight', '[data-pf-run]'], ['print', '[data-pr]'], ['corkboard', '[data-cb]'], ['montage', '[data-mt]'],
  ['practical', '[data-pq]'], ['phone', '[data-ph]'], ['trouble', '[data-tr]'], ['canon', '[data-cq]'], ['frontpage', '[data-fp]'], ['absent', '[data-ab]'],
  ['aftermath', '.gm-aft-steps, .gm-aft-start, button'], ['debrief', '.gm-debrief-list'], ['board', '.gm-board-list, .gm-board-card, button'], ['castphoto', 'button'],
  ['lair', 'input, button'], ['record', '[data-b29-rec]'], ['light', '[data-b29-alarm]']
];

let demo = null, tmp = '';
async function startDemo() {
  tmp = mkdtempSync(path.join(tmpdir(), 'b68-n2-inline-'));
  demo = spawn(process.execPath, [path.join(ROOT, 'scripts', 'demo-night.mjs'), '--port', String(PORT), '--state', tmp], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } });
  let out = '';
  demo.stdout.on('data', (d) => { out += d; }); demo.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 240 && !/Ctrl\+C stops it/.test(out); i++) { await sleep(500); if (demo.exitCode !== null) break; }
  if (!/Ctrl\+C stops it/.test(out)) { console.log('FAIL the demo night did not come up\n' + out.slice(-1500)); await stop(); process.exit(1); }
}
async function stop() {
  if (demo && demo.pid) { if (WIN) spawnSync('taskkill', ['/PID', String(demo.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-demo.pid, 'SIGKILL'); } catch (e) { try { demo.kill('SIGKILL'); } catch (e2) { /* gone */ } } } }
  if (tmp) { await sleep(800); try { rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* a lingering handle: the temp dir goes with the OS */ } }
}

try {
  if (OWN) {
    if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
    await startDemo();
  }
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, extraHTTPHeaders: { 'X-Dev-User': GM }, reducedMotion: 'reduce' });
  await ctx.addInitScript(atPlace('score'));      /* N1b: start in the Score (a page with no phase opens in Before) */
  const page = await ctx.newPage();
  const errors = [], reqs = [], relay = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  /* the light relay (127.0.0.1:9300) is not running here: the browser logs each refused request to it as "Failed to load resource", with the relay's url as the
     message's location. Those, and only those, are not the page's errors (any other failed load still counts) */
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const at = (m.location() && m.location().url) || '';
    if (at.includes(':9300')) return;
    errors.push('console: ' + m.text() + (at ? ' @ ' + at : ''));
  });
  page.on('request', (r) => {
    if (/\/api\//.test(r.url())) reqs.push({ t: Date.now(), url: r.url() });
    if (r.url().includes(':9300/')) relay.push({ t: Date.now(), m: r.method(), p: new URL(r.url()).pathname });
  });
  await page.goto(BASE + '/#gm', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.B68 && window.B68Runtime && window.B68Runtime.me && document.querySelector('#gm-buttons .gm-btn'), null, { timeout: 60000 });
  await page.waitForTimeout(1500);

  check(await page.evaluate(() => !!(window.B68GmTools && window.B68GmWorkshop && window.B68GmTools.toolIds)), 'the page has the registry and the inline host');
  const ids = await page.evaluate(() => Array.from(window.B68GmTools.toolIds()));
  check(JSON.stringify(ids) === JSON.stringify(TOOLS.map((t) => t[0])), 'the registry holds all 18 tools, in order: ' + ids.join(','));
  check(await page.evaluate(() => !document.querySelector('#gm-menu-print, #gm-menu-preflight, #gm-menu-hardstart, #gm-menu-aftermath, #gm-menu-b29-batch, #gm-menu-trouble')), 'no tool has a Menu line of its own');

  /* timers: a control window BEFORE any tool is opened shows what the page itself asks for. (Taken after the loop below, a timer a tool leaked there would be
     counted as the page's own.) It lasts 16 s, past the page's slowest poll (the listening document, every 15 s: gm-page.js), and a docs request is told
     apart by its kind (the Quiet line polls /docs?kind=quiet every 8 s; a tool that kept polling its own kind must still show) */
  const key = (u) => { const x = new URL(u), k = x.searchParams.get('kind'); return x.pathname + (k ? '?kind=' + k : ''); };
  const c0 = Date.now(); await sleep(16000);
  const control = new Set(reqs.filter((r) => r.t > c0).map((r) => key(r.url)));
  console.log('     (what the page asks for by itself in 16 s: ' + ([...control].join(', ') || 'nothing') + ')');

  /* a container the shell would own: inside #gm-page so the page's CSS applies */
  const mount = (id, w) => page.evaluate(({ id, w }) => {
    let host = document.getElementById('n2-host'); if (host) { window.B68GmWorkshop.inline(id, null); host.remove(); }
    host = document.createElement('div'); host.id = 'n2-host'; host.style.cssText = 'width:' + w + 'px;padding:8px;background:var(--paper,#fff);position:relative;z-index:1;margin:8px';
    (document.getElementById('gm-page') || document.body).appendChild(host);
    window.__closed = 0;
    window.B68GmWorkshop.inline(id, host, { onClose: () => { window.__closed++; } });
    return window.B68GmTools.get(id).open();
  }, { id, w });
  const unmount = (id) => page.evaluate((id) => { window.B68GmWorkshop.inline(id, null); const h = document.getElementById('n2-host'); if (h) h.remove(); return window.B68GmWorkshop.bound(id); }, id);

  for (const [id, sel] of TOOLS) {
    for (const w of [330, 900]) {
      errors.length = 0;
      const relay0 = relay.length;
      const opened = await mount(id, w);
      await page.waitForTimeout(900);
      const info = await page.evaluate(({ id, sel }) => {
        const host = document.getElementById('n2-host'), body = host.querySelector('.gm-sheet-body.gm-inline'), r = host.getBoundingClientRect(), b = body ? body.getBoundingClientRect() : null;
        const over = body ? Array.from(body.querySelectorAll('*')).filter((e) => { const x = e.getBoundingClientRect(); return x.width > 0 && x.right > r.right + 2; }).length : -1;
        return { has: !!body, text: body ? body.innerText.trim().length : 0, known: !!(body && body.querySelector(sel)), open: window.B68GmWorkshop.bound(id), mounted: window.B68GmTools.get(id).mounted(),
          sheet: !!document.getElementById('gm-sheet-' + id) && !document.getElementById('gm-sheet-' + id).hidden, fixed: body ? getComputedStyle(body).position : '', over, w: Math.round(r.width), h: Math.round(r.height) };
      }, { id, sel });
      const tag = id + ' at ' + w;
      check(opened === true, tag + ': open() answers true');
      check(info.has && info.open && info.mounted, tag + ': bound inline, mounted() is true');
      check(info.text > 0 && info.known, tag + ': it drew real content (' + sel + ', ' + info.text + ' characters)');
      check(!info.sheet, tag + ': no right-edge sheet is shown behind it');
      check(info.over <= 0, tag + ': nothing sticks out of the container (' + info.over + ')');
      check(errors.length === 0, tag + ': no console or page error' + (errors.length ? ' ' + errors[0] : ''));
      if (id === 'light') {
        /* opening the panel asks the relay once (no timer), so it never says "not checked yet"; with no relay running it reads, calmly, "not answering" */
        const said = await page.waitForFunction(() => { const e = document.querySelector('#n2-host [data-b29-relay]'); return e && e.getAttribute('data-b29-relay') !== 'asking' ? e.textContent : null; }, null, { timeout: 10000 })
          .then((h) => h.jsonValue(), () => '(still asking)');
        const asked = relay.slice(relay0);
        check(said === 'Light relay: not answering' && asked.length === 1 && asked[0].m === 'GET' && asked[0].p === '/state' && !(await page.$('#n2-host .gm-warn')),
          tag + ': open() asks the relay once (' + asked.map((a) => a.m + ' ' + a.p).join(', ') + ') and, with none running, says "' + said + '" without a warning');
      }
      if (SHOTS) { const h = await page.$('#n2-host'); await h.scrollIntoViewIfNeeded(); await h.screenshot({ path: path.join(SHOTS, id + '-' + w + '.png') }); }
      /* an action that makes the tool redraw or close itself must leave it where it is */
      if (w === 330) {
        await page.evaluate((id) => { const t = window.B68GmTools.get(id); t.close(); }, id);
        const after = await page.evaluate((id) => ({ closed: window.__closed, still: window.B68GmWorkshop.bound(id), vis: !!document.querySelector('#n2-host .gm-sheet-body.gm-inline') }), id);
        check(after.closed >= 1 && after.still && after.vis, id + ': close() asks the shell (onClose) and hides nothing');
        const again = await page.evaluate((id) => window.B68GmTools.get(id).open(), id);
        check(again === true, id + ': open() again redraws it');
      }
      await unmount(id);
    }
    check(await unmount(id) === false, id + ': unbound');
  }

  /* Esc: the band gates its keys on B68GmEsc.anyOpen(), so a bound tool counts as open only while it is drawn. Hidden (its place hid the column) or detached
     (the container went without an unbind), it holds back no key */
  const escSeen = await page.evaluate(() => {
    const W = window.B68GmWorkshop, E = window.B68GmEsc, host = document.createElement('div');
    host.id = 'n2-esc'; (document.getElementById('gm-page') || document.body).appendChild(host);
    W.inline('record', host, { onClose: () => {}, esc: true }); window.B68GmTools.get('record').open();
    const mine = () => { const e = E.list().filter((x) => x.id === 'inline-record')[0]; return e ? e.open : null; };
    const r = { drawn: mine(), any: E.anyOpen(), others: E.list().filter((x) => x.id !== 'inline-record' && x.open && x.kind !== 'stamp').map((x) => x.id) };
    host.style.display = 'none'; r.hidden = mine(); r.anyHidden = E.anyOpen();
    host.style.display = ''; r.back = mine();
    host.remove(); r.detached = mine(); r.anyDetached = E.anyOpen(); r.stillBound = W.bound('record');
    W.inline('record', null); r.gone = !E.list().some((x) => x.id === 'inline-record');
    return r;
  });
  check(escSeen.drawn === true && escSeen.any === true && escSeen.others.length === 0 && escSeen.hidden === false && escSeen.anyHidden === false && escSeen.back === true &&
    escSeen.detached === false && escSeen.anyDetached === false && escSeen.stillBound === true && escSeen.gone === true,
  'Esc: a bound tool is open only while it is drawn; hidden or detached it holds back no key (' + JSON.stringify(escSeen) + ')');

  /* binding a tool inline closes AND empties its right-edge copy: two copies of one drawing share their SVG ids (the cast photo drew bare rectangles) */
  const dup = await page.evaluate(async () => {
    const T = window.B68GmTools, W = window.B68GmWorkshop, wait = (ms) => new Promise((r) => setTimeout(r, ms));
    T.get('castphoto').open(); await wait(1500);
    const sheetBody = document.querySelector('#gm-sheet-castphoto .gm-sheet-body');
    const r = { sheetSvg: sheetBody ? sheetBody.querySelectorAll('svg').length : -1 };
    const host = document.createElement('div'); host.id = 'n2-dup'; host.style.width = '900px';
    (document.getElementById('gm-page') || document.body).appendChild(host);
    W.inline('castphoto', host); T.get('castphoto').open(); await wait(1500);
    r.sheetLeft = sheetBody ? sheetBody.childNodes.length : -1; r.sheetHidden = document.getElementById('gm-sheet-castphoto').hidden;
    r.inlineSvg = host.querySelectorAll('svg').length;
    const ids = Array.from(host.querySelectorAll('[id]')).map((e) => e.id);
    r.ids = ids.length; r.twice = ids.filter((id) => document.querySelectorAll('[id="' + CSS.escape(id) + '"]').length > 1).slice(0, 3);
    W.inline('castphoto', null); host.remove();
    return r;
  });
  check(dup.sheetSvg >= 1 && dup.sheetLeft === 0 && dup.sheetHidden === true && dup.inlineSvg >= 1 && dup.ids > 0 && dup.twice.length === 0,
    'binding inline closes and empties the right-edge copy: the drawing is in the page once, no SVG id twice (' + JSON.stringify(dup) + ')');

  /* the right-edge path still works for an unbound tool, and its sheet is in the one Esc (priority 50) */
  const sh = await page.evaluate(() => { window.B68GmTools.get('print').open(); const e = window.B68GmEsc.list().filter((x) => x.id === 'sheet-print')[0]; const r = { shown: !document.getElementById('gm-sheet-print').hidden, esc: e ? e.priority + ':' + e.open : '' }; window.B68GmTools.get('print').close(); r.hidden = document.getElementById('gm-sheet-print').hidden; return r; });
  check(sh.shown && sh.esc === '50:true' && sh.hidden, 'unbound, a tool opens in the right-edge sheet and the sheet is registered with B68GmEsc at 50 (' + JSON.stringify(sh) + ')');
  /* timers: every tool is bound and opened together, unbound together, and the next 11 s (past the Aftermath's 10 s tick) must hold no request the control window
     before the loop did not have, and nothing to the light relay */
  await page.evaluate((ids) => {
    const root = document.getElementById('gm-page') || document.body;
    ids.forEach((id) => { const h = document.createElement('div'); h.className = 'n2-all'; root.appendChild(h); window.B68GmWorkshop.inline(id, h); window.B68GmTools.get(id).open(); });
  }, TOOLS.map((t) => t[0]));
  await page.waitForTimeout(2500);
  check(await page.evaluate(() => window.B68GmWorkshop.boundIds().length) === 18, 'all 18 tools bound and open together');
  await page.evaluate((ids) => { ids.forEach((id) => window.B68GmWorkshop.inline(id, null)); document.querySelectorAll('.n2-all').forEach((e) => e.remove()); }, TOOLS.map((t) => t[0]));
  await page.waitForTimeout(500);
  const t1 = Date.now(); await sleep(11000);
  const late = reqs.filter((r) => r.t > t1).map((r) => key(r.url)).filter((u) => !control.has(u)).concat(relay.filter((r) => r.t > t1).map((r) => 'relay ' + r.m + ' ' + r.p));
  check(late.length === 0, 'no request from any tool in the 11 s after every one is unbound' + (late.length ? ' (' + late.slice(0, 5).join(', ') + ')' : ''));
  check(await page.evaluate(() => window.B68GmWorkshop.boundIds().length) === 0, 'nothing is left bound');
  check(errors.length === 0, 'no console or page error through the unbind' + (errors.length ? ' ' + errors[0] : ''));
  await browser.close();
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
} finally {
  await stop();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
