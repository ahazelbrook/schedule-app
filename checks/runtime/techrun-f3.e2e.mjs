// The tech run fixes, F3 (06/11/2026), in a real browser against the demo night (invented data only). Run it in Edge: its time field is the one
// that broke (12-hour, en-US).
//   1. Before > Tonight: typing a Start (0 7 4 5 P) and a Curfew (1 1 1 5 P) key by key lands as 19:45 and 23:15; every key reaches the field (none
//      reaches the page's shortcuts); the field keeps the focus throughout; the times are written when the field is left (Tab, a click away)
//   2. a curfew before the start is refused with a line under the fields (the stored time stays); one after midnight is taken; a reload keeps them
//   3. Opening > the hard start: Test, reveal a name, reload: the sheet is armed again (Roll the opening credits, End without credits, GO now, the name
//      shown); GO now works; Roll, reload: not armed; Test, End without credits, reload: not armed
//   PW_MODULE=<playwright-core> PW_CHANNEL=msedge [PORT=8680] [DEMO_URL=http://127.0.0.1:8650] [F3_SHOTS=<dir>] node checks/runtime/techrun-f3.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { atPlace } from './fixtures/gm/places.mjs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8680);
const OWN = !process.env.DEMO_URL;
const BASE = process.env.DEMO_URL || 'http://127.0.0.1:' + PORT;
const SHOTS = process.env.F3_SHOTS || '';
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const WIN = process.platform === 'win32';

let demo = null, tmp = '';
async function startDemo() {
  tmp = mkdtempSync(path.join(tmpdir(), 'b68-f3-'));
  demo = spawn(process.execPath, [path.join(ROOT, 'scripts', 'demo-night.mjs'), '--port', String(PORT), '--state', tmp], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } });
  let out = '';
  demo.stdout.on('data', (d) => { out += d; }); demo.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 240 && !/Ctrl\+C stops it/.test(out); i++) { await sleep(500); if (demo.exitCode !== null) break; }
  if (!/Ctrl\+C stops it/.test(out)) { console.log('FAIL the demo night did not come up\n' + out.slice(-1500)); await stop(); process.exit(1); }
}
async function stop() {
  if (demo && demo.pid) { if (WIN) spawnSync('taskkill', ['/PID', String(demo.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { demo.kill('SIGKILL'); } catch (e) { /* gone */ } } }
  if (tmp) { await sleep(800); try { rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* a lingering handle */ } }
}

let failed = 0, passed = 0;
async function step(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + (e && e.message || e)); } }
const expect = (c, m) => { if (!c) throw new Error(m); };
const gm = (method, p, body) => fetch(BASE + p, { method, headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const display = () => fetch(BASE + '/api/gm/display?seq=-1&aseq=-1&sseq=-1', { headers: { 'X-Dev-User': IPAD } }).then((r) => r.json());
const night = async () => { const r = await gm('GET', '/api/gm/state'); const n = r.json && r.json.doc && r.json.doc.night; return n ? { startAt: n.startAt || null, curfewAt: n.curfewAt || null } : {}; };
async function until(fn, ms) { const end = Date.now() + ms; let v; while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(300); } return v; }

/* every keydown the page hears, with its target, and whether the page's Roll keys did anything */
const KEYLOG = { content: 'window.__f3keys = []; document.addEventListener("keydown", function (e) { var t = e.target; window.__f3keys.push({ k: e.key, tag: t && t.tagName || "", tn: t && t.getAttribute ? t.getAttribute("data-tn-time") || "" : "" }); }, true);' };

try {
  if (OWN) {
    if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
    await startDemo();
  }
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  await gm('PATCH', '/api/gm/state', { night: { v: 1, startAt: null, curfewAt: null } });
  await gm('PATCH', '/api/gm/ambient', { layers: null });
  await gm('PUT', '/api/gm/display', { kind: 'blank' });
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
  try {
    /* ---------- 1 and 2: Before > Tonight ---------- */
    const bctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'en-US', extraHTTPHeaders: { 'X-Dev-User': GM }, reducedMotion: 'reduce' });
    await bctx.addInitScript(atPlace('before')); await bctx.addInitScript(KEYLOG);
    const b = await bctx.newPage(); const bErr = []; b.on('pageerror', (e) => bErr.push(String(e && e.message || e)));
    await b.goto(BASE + '/#gm');
    const START = '#gm-left [data-tn-time="startAt"]', CURFEW = '#gm-left [data-tn-time="curfewAt"]', MSG = '#gm-left [data-tn-msg]';
    await b.waitForSelector(START, { timeout: 40000 });
    await sleep(4000);      /* the page's own load-time writes settle first */
    /* type into a field key by key from its hour part, as the GM does: the focus and the field must survive every key */
    async function typeTime(sel, keys) {
      await b.$eval(sel, (e) => e.scrollIntoView({ block: 'center' })); await sleep(200);      /* in the middle of the column, clear of its sticky Next */
      const box = await b.locator(sel).boundingBox();
      const hit = await b.evaluate(([s, x, y]) => document.elementFromPoint(x, y) === document.querySelector(s), [sel, box.x + 14, box.y + box.height / 2]);
      if (!hit) throw new Error('something covers the field at its hour part');
      await b.mouse.click(box.x + 14, box.y + box.height / 2);
      await b.evaluate(() => { window.__f3keys = []; window.__f3el = document.activeElement; });
      const lost = [];
      for (const k of keys) {
        await b.keyboard.press(k); await sleep(220);
        const f = await b.evaluate((s) => { const el = document.querySelector(s); return { same: el === window.__f3el, active: document.activeElement === el }; }, sel);
        if (!f.same || !f.active) lost.push(k + (f.same ? '' : ' (the field was replaced)') + (f.active ? '' : ' (the focus left it)'));
      }
      const heard = await b.evaluate(() => window.__f3keys);
      return { lost, stray: heard.filter((x) => !x.tn).map((x) => x.k + '@' + x.tag) };
    }
    /* Tab out of a field: Edge's own Tab steps through the field's parts and its picker button before it leaves */
    async function tabOut(sel) {
      for (let i = 0; i < 5; i++) { await b.keyboard.press('Tab'); await sleep(150); if (!(await b.evaluate((s) => document.activeElement === document.querySelector(s), sel))) return; }
      throw new Error('Tab never left the field');
    }

    await step('Before > Tonight: Start typed key by key (0 7 4 5 P) keeps the field and its focus, every key reaches it, and leaving with Tab writes 19:45', async () => {
      expect(await b.$eval(START, (e) => e.value) === '19:30', 'the note\'s start shows first');
      const r = await typeTime(START, ['0', '7', '4', '5', 'P']);
      expect(!r.lost.length, 'the field went away under the cursor at: ' + r.lost.join(', '));
      expect(!r.stray.length, 'keys reached the page instead of the field: ' + r.stray.join(', '));
      expect(await b.$eval(START, (e) => e.value) === '19:45', 'the field reads ' + await b.$eval(START, (e) => e.value));
      await tabOut(START);
      const n = await until(async () => { const x = await night(); return x.startAt === '19:45' ? x : null; }, 12000);
      expect(n && n.startAt === '19:45', 'written on leaving the field: ' + JSON.stringify(await night()));
    });

    await step('Curfew typed the same way (1 1 1 5 P) after a Tab lands as 23:15; a click away writes it; the box then says where each differs from the note', async () => {
      const r = await typeTime(CURFEW, ['1', '1', '1', '5', 'P']);
      expect(!r.lost.length && !r.stray.length, 'lost: ' + r.lost.join(', ') + ' stray: ' + r.stray.join(', '));
      await b.click('#gm-left .gm-tn-title');
      const n = await until(async () => { const x = await night(); return x.curfewAt === '23:15' ? x : null; }, 12000);
      expect(n && n.startAt === '19:45' && n.curfewAt === '23:15', 'stored: ' + JSON.stringify(await night()));
      await b.waitForFunction(() => /from the prep note: 19:30/.test(document.querySelector('#gm-left').textContent) && /from the prep note: 22:40/.test(document.querySelector('#gm-left').textContent), null, { timeout: 8000 });
      expect(await b.$eval(START, (e) => e.value) === '19:45' && await b.$eval(CURFEW, (e) => e.value) === '23:15', 'the fields show the night\'s own');
    });

    await step('a curfew before the start (07:00 PM, Enter) is refused with a line under the fields; the field keeps the focus; leaving puts the stored one back', async () => {
      const r = await typeTime(CURFEW, ['0', '7', '0', '0', 'P']);
      expect(!r.lost.length && !r.stray.length, 'lost: ' + r.lost.join(', ') + ' stray: ' + r.stray.join(', '));
      await b.keyboard.press('Enter'); await sleep(500);
      const m = await b.$eval(MSG, (e) => ({ text: e.textContent, hidden: e.hidden, role: e.getAttribute('role') }));
      expect(!m.hidden && /Not saved: a 19:00 curfew is before the 19:45 start/.test(m.text) && m.role === 'alert', 'the line: ' + JSON.stringify(m));
      expect(await b.evaluate((s) => document.activeElement === document.querySelector(s), CURFEW), 'Enter leaves the focus in the field');
      if (SHOTS) { await b.locator('#gm-left .gm-tn-title').scrollIntoViewIfNeeded(); await b.screenshot({ path: path.join(SHOTS, 'before-tonight-refused-1366.png') }); }
      await tabOut(CURFEW); await sleep(900);
      expect((await night()).curfewAt === '23:15', 'the stored curfew stays: ' + JSON.stringify(await night()));
      expect(await b.$eval(CURFEW, (e) => e.value) === '23:15', 'the field shows the stored curfew again: ' + await b.$eval(CURFEW, (e) => e.value));
      expect(await b.$eval(MSG, (e) => !e.hidden), 'the line stays until a time is taken');
    });

    await step('a curfew after midnight (12:30 AM) is taken and the line goes; a reload keeps both times', async () => {
      const r = await typeTime(CURFEW, ['1', '2', '3', '0', 'A']);
      expect(!r.lost.length && !r.stray.length, 'lost: ' + r.lost.join(', ') + ' stray: ' + r.stray.join(', '));
      await b.keyboard.press('Enter');
      const n = await until(async () => { const x = await night(); return x.curfewAt === '00:30' ? x : null; }, 12000);
      expect(n && n.curfewAt === '00:30', 'stored: ' + JSON.stringify(await night()));
      await b.waitForFunction((s) => document.querySelector(s).hidden, MSG, { timeout: 5000 });
      await b.click('#gm-left .gm-tn-title'); await sleep(1500);
      await b.reload(); await b.waitForSelector(START, { timeout: 40000 }); await sleep(2500);
      const v = [await b.$eval(START, (e) => e.value), await b.$eval(CURFEW, (e) => e.value)];
      expect(v[0] === '19:45' && v[1] === '00:30', 'after the reload: ' + v.join(' '));
      const r2 = await typeTime(START, ['0', '8', '0', '5', 'P']);
      expect(!r2.lost.length && !r2.stray.length, 'after the reload, lost: ' + r2.lost.join(', ') + ' stray: ' + r2.stray.join(', '));
      await tabOut(START);
      expect(await until(async () => (await night()).startAt === '20:05', 12000), 'typed again after the reload: ' + JSON.stringify(await night()));
      if (SHOTS) { await b.click('#gm-left .gm-tn-title'); await sleep(800); await b.locator('#gm-left .gm-tn-title').scrollIntoViewIfNeeded(); await b.screenshot({ path: path.join(SHOTS, 'before-tonight-1366.png') }); }
      expect(bErr.length === 0, 'page errors: ' + bErr.join(' | '));
    });
    await bctx.close();
    await gm('PATCH', '/api/gm/state', { night: { v: 1, startAt: null, curfewAt: null } });

    /* ---------- 3: Opening > the hard start, across reloads ---------- */
    const gctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, extraHTTPHeaders: { 'X-Dev-User': GM }, reducedMotion: 'reduce' });
    await gctx.addInitScript(atPlace('opening'));
    const g = await gctx.newPage(); const gErr = []; g.on('pageerror', (e) => gErr.push(String(e && e.message || e)));
    const panel = '[data-left-tool="hardstart"]';
    const sheet = () => g.$eval(panel, (p) => ({ text: p.innerText, roll: !!p.querySelector('[data-hs="roll"]'), end: !!p.querySelector('[data-hs="end"]'), go: !!p.querySelector('[data-hs="go"]:not([disabled])'), shown0: (p.querySelector('[data-hs-reveal="0"]') || {}).getAttribute ? p.querySelector('[data-hs-reveal="0"]').getAttribute('aria-pressed') : null }));
    const layers = async () => { const a = await gm('GET', '/api/gm/ambient'); const d = a.json && (a.json.doc || a.json) || {}; return d.layers || {}; };
    await g.goto(BASE + '/#gm');
    await g.waitForSelector(panel + ' [data-hs="test"]', { timeout: 40000 });
    await sleep(4000);

    await step('Opening: Test arms it and a name is revealed; after a reload the sheet is armed again (Roll, End, GO now enabled, the name still shown)', async () => {
      await g.click(panel + ' [data-hs="test"]');
      await g.waitForSelector(panel + ' [data-hs="roll"]', { timeout: 15000 });
      await g.click(panel + ' [data-hs-reveal="0"]');
      expect(await until(async () => { const L = await layers(); return L.band && Array.isArray(L.band.faces) && L.band.faces.some((f) => f.npcId); }, 10000), 'the reveal reached the ambient document');
      const laid = ((await layers()).data || {}).previously || [];
      await g.reload();
      await g.waitForSelector(panel + ' [data-hs="test"]', { timeout: 40000 });
      await g.waitForSelector(panel + ' [data-hs="roll"]', { timeout: 15000 }).catch(() => {});
      const s = await sheet();
      expect(s.roll && s.end && s.go, 'armed again after the reload: ' + JSON.stringify(s).slice(0, 300));
      expect(/Test armed for \d\d:\d\d/.test(s.text), 'the status line: ' + s.text.slice(0, 160));
      expect(s.shown0 === 'true', 'the name shown before the reload is still marked shown: ' + s.shown0);
      /* the cast arrives after the first draw: the sheet is drawn again with the faces laid (not "(none)"), and the next Reveal is live */
      const faces = await until(() => g.$eval(panel, (p) => { const v = [0, 1, 2].map((i) => (p.querySelector('[data-hs-pick="' + i + '"]') || {}).value || ''); return v.every(Boolean) ? v : null; }), 10000);
      expect(faces && JSON.stringify(faces) === JSON.stringify(laid.slice(0, 3)), 'the faces after the reload: ' + JSON.stringify(faces) + ' laid: ' + JSON.stringify(laid));
      expect(await g.$eval(panel + ' [data-hs-reveal="1"]', (e) => !e.disabled), 'Reveal the name (face 2) is live after the reload');
      if (SHOTS) { await g.locator(panel).scrollIntoViewIfNeeded(); await g.screenshot({ path: path.join(SHOTS, 'opening-hardstart-after-reload-1366.png') }); }
    });

    await step('after the reload GO now works (the countdown goes to now), then Roll the opening credits ends it; a reload is not armed', async () => {
      const t0 = Date.now();
      await g.click(panel + ' [data-hs="go"]');
      expect(await until(async () => { const d = await display(); const c = d.layers && d.layers.data && d.layers.data.countdown; return c && c.to >= t0 - 5000 && c.to <= Date.now() + 5000; }, 10000), 'GO set the countdown to now: ' + JSON.stringify(((await display()).layers || {}).data || {}).slice(0, 200));
      await g.click(panel + ' [data-hs="roll"]');
      await g.waitForFunction((sel) => /On the iPad: Opening credits/.test((document.querySelector(sel) || {}).innerText || ''), panel, { timeout: 15000 });
      await g.reload();
      await g.waitForSelector(panel + ' [data-hs="test"]', { timeout: 40000 }); await sleep(5000);
      const s = await sheet();
      expect(!s.roll && !s.go && /Not armed/.test(s.text), 'after Roll and a reload: ' + s.text.slice(0, 200));
      const L = await layers(); expect(!(L.scene && L.scene.mode), 'no start scene left: ' + JSON.stringify(L.scene || {}));
    });

    await step('Test, End without credits, reload: not armed', async () => {
      await g.click(panel + ' [data-hs="test"]');
      await g.waitForSelector(panel + ' [data-hs="end"]', { timeout: 15000 });
      await g.click(panel + ' [data-hs="end"]');
      await g.waitForFunction((sel) => /Not armed/.test((document.querySelector(sel) || {}).innerText || ''), panel, { timeout: 15000 });
      await g.reload();
      await g.waitForSelector(panel + ' [data-hs="test"]', { timeout: 40000 }); await sleep(5000);
      const s = await sheet();
      expect(!s.roll && !s.go && /Not armed/.test(s.text), 'after End and a reload: ' + s.text.slice(0, 200));
      expect(gErr.length === 0, 'page errors: ' + gErr.join(' | '));
    });
  } finally { await browser.close(); }
} finally { if (OWN) await stop(); }
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
