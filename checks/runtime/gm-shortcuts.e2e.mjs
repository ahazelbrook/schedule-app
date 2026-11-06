// The Shortcuts card in a real browser (K1; app/gm/shortcuts.js) against its own demo night (scripts/demo-night.mjs):
//   - ? opens it at 1366x768 and 1536x864: the right-edge sheet, every section, nothing overflowing or clipped, no section over another; ? again and Esc close it
//     (Esc does not PANIC); the page's keys do not fire behind it
//   - Find reaches it ("keys", "commands", "help", "Shortcuts"), and so does the Menu's Shortcuts line
//   - ? typed in a text field is the field's; ? with the drawer, the Menu or Find open does not open it
//   - nothing on the iPad's or a phone's page knows it; no console errors
//   PW_MODULE=<playwright-core> PW_CHANNEL=msedge [PORT=8765] [K1_SHOTS=<dir>] node checks/runtime/gm-shortcuts.e2e.mjs
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 8765);
const SHOTS = process.env.K1_SHOTS || '';
const BASE = 'http://127.0.0.1:' + PORT;
const GM = 'gm@example.test';
const WIN = process.platform === 'win32';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const { chromium } = require(process.env.PW_MODULE || '/opt/node-tools/node_modules/playwright');
const SC = require('../../app/gm/shortcuts.js');

let passed = 0, failed = 0;
const check = (ok, name) => { if (ok) { passed++; console.log('PASS ' + name); } else { failed++; console.log('FAIL ' + name); } };
async function until(fn, ms, step = 120) { const t0 = Date.now(); for (;;) { let v; try { v = await fn(); } catch (e) { v = false; } if (v || Date.now() - t0 > ms) return v; await sleep(step); } }

let demo = null, tmp = '', browser = null;
async function startDemo() {
  tmp = mkdtempSync(path.join(tmpdir(), 'b68-k1-shortcuts-'));
  demo = spawn(process.execPath, [path.join(ROOT, 'scripts', 'demo-night.mjs'), '--port', String(PORT), '--state', tmp], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1' } });
  let out = '';
  demo.stdout.on('data', (d) => { out += d; }); demo.stderr.on('data', (d) => { out += d; });
  for (let i = 0; i < 240 && !/Ctrl\+C stops it/.test(out); i++) { await sleep(500); if (demo.exitCode !== null) break; }
  if (!/Ctrl\+C stops it/.test(out)) { console.log('FAIL the demo night did not come up\n' + out.slice(-1500)); await stop(); process.exit(1); }
}
async function stop() {
  if (browser) { try { await browser.close(); } catch (e) { /* gone */ } browser = null; }
  if (demo && demo.pid) { if (WIN) spawnSync('taskkill', ['/PID', String(demo.pid), '/T', '/F'], { stdio: 'ignore' }); else { try { process.kill(-demo.pid, 'SIGKILL'); } catch (e) { try { demo.kill('SIGKILL'); } catch (e2) { /* gone */ } } } }
  if (tmp) { await sleep(800); try { rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* a lingering handle */ } }
}
const timer = setTimeout(async () => { console.log('FAIL timed out'); await stop(); process.exit(1); }, 360000);

const SHEET = '#gm-sheet-shortcuts';
const isOpen = (page) => page.evaluate((s) => { const e = document.querySelector(s); return !!(e && !e.hidden && e.getClientRects().length); }, SHEET);
const blur = (page) => page.evaluate(() => { const a = document.activeElement; if (a && a !== document.body && a.blur) a.blur(); });
const panicUp = (page) => page.$eval('.gm-band-r2', (e) => e.getAttribute('data-alarm') === 'panic');
async function fit(page) {
  return page.evaluate((s) => {
    const sh = document.querySelector(s), body = sh && sh.querySelector('.gm-sheet-body'); if (!sh || !body) return { ok: false, why: 'no sheet' };
    const vw = document.documentElement.clientWidth, vh = innerHeight, R = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
    const sr = R(sh), br = R(body), bad = [];
    if (sr.l < 0 || sr.r > vw + 0.5 || sr.t < 0 || sr.b > vh + 0.5) bad.push('the sheet is off the screen ' + JSON.stringify(sr));
    if (document.documentElement.scrollWidth > vw + 1) bad.push('the page scrolls sideways');
    if (body.scrollWidth > body.clientWidth + 1) bad.push('the card scrolls sideways ' + body.scrollWidth + '>' + body.clientWidth);
    const secs = [...body.querySelectorAll('[data-sc-sec]')], rs = secs.map(R);
    secs.forEach((e, i) => {
      const r = rs[i];
      if (r.l < br.l - 0.5 || r.r > br.r + 0.5) bad.push(e.getAttribute('data-sc-sec') + ' is clipped at the side');
      if (e.scrollWidth > e.clientWidth + 1) bad.push(e.getAttribute('data-sc-sec') + ' overflows');
      rs.forEach((o, j) => { if (j > i && r.l < o.r - 0.5 && o.l < r.r - 0.5 && r.t < o.b - 0.5 && o.t < r.b - 0.5) bad.push(e.getAttribute('data-sc-sec') + ' overlaps ' + secs[j].getAttribute('data-sc-sec')); });
    });
    /* every row's term and text inside the row, every key inside its section */
    body.querySelectorAll('.gm-sc-row').forEach((row) => {
      const rr = R(row);
      row.querySelectorAll('dt, dd').forEach((c) => { const cr = R(c); if (c.scrollWidth > c.clientWidth + 1 || cr.r > rr.r + 1 || cr.l < rr.l - 1) bad.push('a row spills: ' + row.textContent.slice(0, 40)); });
    });
    body.querySelectorAll('kbd, var, .gm-sc-how').forEach((k) => { const sec = k.closest('[data-sc-sec]'), kr = R(k), s2 = sec ? R(sec) : br; if (kr.r > s2.r + 1 || kr.l < s2.l - 1) bad.push('clipped: ' + k.textContent); });
    const cols = new Set(rs.map((r) => Math.round(r.l))).size;
    const kb = body.querySelector('.gm-sc kbd'), q = body.querySelector('.gm-sc-q'), dd = body.querySelector('.gm-sc-row dd');
    return { ok: !bad.length, bad: bad.slice(0, 8), cols, sections: secs.length, sheet: sr, scroll: { h: body.scrollHeight, c: body.clientHeight },
      sizes: { kbd: kb && parseFloat(getComputedStyle(kb).fontSize), say: q && parseFloat(getComputedStyle(q).fontSize), dd: dd && parseFloat(getComputedStyle(dd).fontSize) } };
  }, SHEET);
}

try {
  if (await fetch(BASE + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false)) { console.log('FAIL port ' + PORT + ' is already in use'); process.exit(1); }
  await startDemo();
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, extraHTTPHeaders: { 'X-Dev-User': GM }, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() !== 'error') return; const at = (m.location() && m.location().url) || ''; if (at.includes(':' + (PORT + 20000)) || at.endsWith('/media/theme.mp3')) return; errors.push('console: ' + m.text() + (at ? ' @ ' + at : '')); });
  await page.goto(BASE + '/#gm', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.B68GmShortcuts && window.B68GmEsc && document.querySelector('#gm-band [data-gm="menu"]') && window.B68GmPage && window.B68GmPage.currentPlace, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  check(!(await isOpen(page)), 'the card is not up on load');

  /* ---- ? opens it, at 1366 and 1536 ---- */
  for (const [w, h] of [[1366, 768], [1536, 864]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    await blur(page);
    await page.keyboard.press('Shift+Slash');
    check(await until(() => isOpen(page), 3000), w + ': ? (Shift+/) opens the Shortcuts card');
    const top = await page.evaluate(() => (window.B68GmEsc.list().filter((x) => x.open && x.kind === 'overlay')[0] || {}).id);
    check(top === 'sheet-shortcuts', w + ': it is the top box, the one Esc\'s (' + top + ')');
    const f = await fit(page);
    check(f.ok && f.sections === SC.SECTIONS.length, w + ': every section, nothing overflows or is clipped, no section over another (' + JSON.stringify(f) + ')');
    check(f.cols >= 3, w + ': the sections sit in columns (' + f.cols + ')');
    check(f.sizes.kbd >= 12 && f.sizes.say >= 14 && f.sizes.dd >= 13, w + ': big enough to read at arm\'s length (' + JSON.stringify(f.sizes) + ')');
    check(await page.$eval(SHEET + ' .gm-sheet-h', (e) => e.textContent) === 'Shortcuts', w + ': titled Shortcuts');
    const rowsDrawn = await page.$$eval(SHEET + ' [data-sc-row]', (a) => a.length);
    check(rowsDrawn === SC.rows().length, w + ': every row of the card is drawn (' + rowsDrawn + ')');
    if (SHOTS) {
      await page.screenshot({ path: path.join(SHOTS, 'shortcuts-' + w + '.png') });
      if (f.scroll.h > f.scroll.c + 2) { await page.$eval(SHEET + ' .gm-sheet-body', (e) => { e.scrollTop = e.scrollHeight; }); await page.waitForTimeout(150); await page.screenshot({ path: path.join(SHOTS, 'shortcuts-' + w + '-end.png') }); await page.$eval(SHEET + ' .gm-sheet-body', (e) => { e.scrollTop = 0; }); }
    }
    /* nothing fires behind it: N (the cast) and 1 (a roll) are held */
    const view0 = await page.evaluate(() => window.B68GmPage.currentView());
    await page.keyboard.press('n'); await page.keyboard.press('1'); await page.waitForTimeout(250);
    check(await isOpen(page) && await page.evaluate(() => window.B68GmPage.currentView()) === view0, w + ': the page\'s keys wait behind it (N did not change the view)');
    await page.keyboard.press('Shift+Slash');
    check(await until(async () => !(await isOpen(page)), 2000), w + ': ? again closes it');
    await blur(page);
    await page.keyboard.press('Shift+Slash');
    check(await until(() => isOpen(page), 2000), w + ': and opens it again');
    await page.keyboard.press('Escape');
    check(await until(async () => !(await isOpen(page)), 2000) && !(await panicUp(page)), w + ': Esc closes it, and does not PANIC');
  }
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(300);

  /* ---- Find ---- */
  for (const q of ['keys', 'commands', 'help', 'Shortcuts']) {
    await blur(page);
    await page.keyboard.press('Control+k');
    const opened = await until(() => page.$eval('#gm-find', (e) => !e.hidden), 2000);
    await page.fill('#gm-find-q', q);
    await page.waitForTimeout(150);
    const hit = await page.$$eval('#gm-find-list .gm-find-hit', (a) => a.map((b) => b.textContent));
    const i = hit.findIndex((t) => /Shortcuts/.test(t));
    check(opened && i >= 0 && i <= 2, 'Find "' + q + '" lists the Shortcuts card near the top (' + i + ': ' + JSON.stringify(hit.slice(0, 3)) + ')');
    if (q === 'keys') { await page.keyboard.press('Enter'); }
    else { await page.click('#gm-find-list .gm-find-hit >> nth=' + Math.max(0, i)); }
    check(await until(() => isOpen(page), 2000) && await page.$eval('#gm-find', (e) => e.hidden), 'Find "' + q + '": ' + (q === 'keys' ? 'Enter' : 'a click') + ' opens the card and shuts Find');
    await page.keyboard.press('Escape');
    await until(async () => !(await isOpen(page)), 2000);
  }

  /* ---- the Menu ---- */
  await page.click('#gm-band [data-gm="menu"]');
  check(await until(() => page.$eval('#gm-menu-shortcuts', (e) => e.getClientRects().length > 0 && /Shortcuts/.test(e.textContent)), 2000), 'the Menu has a Shortcuts line (with its ? key)');
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'menu-1366.png'), clip: { x: 966, y: 0, width: 400, height: 520 } });
  await page.click('#gm-menu-shortcuts');
  check(await until(() => isOpen(page), 2000) && await page.$eval('.gm-menu-list', (e) => e.hasAttribute('hidden')), 'the Menu\'s Shortcuts opens the card and the Menu shuts');
  await page.keyboard.press('Escape');
  check(await until(async () => !(await isOpen(page)), 2000), 'Esc closes it');

  /* ---- ? is never the card while typing, or behind another open box ---- */
  await blur(page);
  await page.keyboard.press('r');                                         /* R: Prep, its find box takes the typing */
  const field = await until(() => page.evaluate(() => { const a = document.activeElement; return a && /^(INPUT|TEXTAREA)$/.test(a.tagName) ? a.id || a.tagName : ''; }), 3000);
  check(!!field, 'R puts the cursor in a text field (' + field + ')');
  await page.keyboard.type('a?b');
  await page.waitForTimeout(250);
  const typed = await page.evaluate(() => document.activeElement && document.activeElement.value);
  check(!(await isOpen(page)) && /\?/.test(typed || ''), '? typed in a text field goes into the field (' + JSON.stringify(typed) + '), the card stays shut');
  await page.evaluate(() => { const a = document.activeElement; if (a && 'value' in a) { a.value = ''; a.dispatchEvent(new Event('input', { bubbles: true })); } });
  await page.keyboard.press('Escape');                                    /* leaves the field */
  await blur(page);
  await page.keyboard.press('w');
  check(await until(() => page.evaluate(() => window.B68GmEsc.list().some((x) => x.id === 'drawer' && x.open)), 2000), 'W opens the drawer');
  await page.keyboard.press('Shift+Slash'); await page.waitForTimeout(300);
  check(!(await isOpen(page)), '? behind the open drawer does nothing');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await page.click('#gm-band [data-gm="menu"]');
  await page.keyboard.press('Shift+Slash'); await page.waitForTimeout(300);
  check(!(await isOpen(page)), '? behind the open Menu does nothing');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  await blur(page);
  await page.keyboard.press('Control+k'); await page.keyboard.press('Shift+Slash'); await page.waitForTimeout(300);
  check(!(await isOpen(page)) && await page.$eval('#gm-find-q', (e) => e.value === '?'), '? with Find open goes into Find\'s box');
  await page.keyboard.press('Escape'); await page.waitForTimeout(200);
  check(!(await panicUp(page)), 'none of these Escs was a PANIC');

  /* ---- a phone (no keys there): the Menu opens it, one column, full width, nothing sideways ---- */
  const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'X-Dev-User': GM }, reducedMotion: 'reduce', hasTouch: true, isMobile: true });
  const pp = await pctx.newPage();
  pp.on('pageerror', (e) => errors.push('390 pageerror: ' + e.message));
  await pp.goto(BASE + '/#gm', { waitUntil: 'domcontentloaded' });
  await pp.waitForFunction(() => window.B68GmShortcuts && document.querySelector('#gm-band [data-gm="menu"]'), null, { timeout: 60000 });
  await pp.waitForTimeout(1200);
  await pp.click('#gm-band [data-gm="menu"]');
  await pp.click('#gm-menu-shortcuts');
  check(await until(() => isOpen(pp), 3000), '390: the Menu opens the card on a phone');
  const pf = await fit(pp);
  check(pf.ok && pf.cols === 1 && pf.sheet.w >= 389, '390: full width, one column, nothing overflows or is clipped (' + JSON.stringify({ ok: pf.ok, bad: pf.bad, cols: pf.cols, w: pf.sheet.w }) + ')');
  if (SHOTS) await pp.screenshot({ path: path.join(SHOTS, 'shortcuts-390.png') });
  await pctx.close();

  /* ---- GM only ---- */
  const dctx = await browser.newContext({ viewport: { width: 1024, height: 768 }, extraHTTPHeaders: { 'X-Dev-User': GM } });
  const dp = await dctx.newPage();
  await dp.goto(BASE + '/#display', { waitUntil: 'domcontentloaded' });
  await dp.waitForTimeout(4000);
  check(await dp.evaluate(() => !window.B68GmShortcuts && !document.querySelector('#gm-sheet-shortcuts, [data-sc]')), 'the iPad\'s page has no Shortcuts card');
  await dctx.close();

  check(errors.length === 0, 'no console errors' + (errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''));
} catch (e) {
  failed++; console.log('FAIL ' + (e && e.stack || e));
} finally {
  clearTimeout(timer);
  await stop();
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
