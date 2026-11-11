// kit-overlay: the kit's overlays (the kit and stage build, KS03): app/ui/overlay.js and overlay.css. No network, no production.
//   node checks/runtime/kit-overlay.test.mjs                                  the file checks and the logic (no browser)
//   KIT_OVERLAY_BROWSER=1 PW_MODULE=<playwright install> PW_CHANNEL=msedge [KIT_OVERLAY_PORT=10100] node checks/runtime/kit-overlay.test.mjs
//                                                                             the same, then the real dialog, popover, toast stack and tooltip in a
//                                                                             browser against a static page (a tiny server on KIT_OVERLAY_PORT, 10100 to 10149)
// No browser suite is registered for KS03, so the browser part lives here. It runs only with KIT_OVERLAY_BROWSER=1 (an exported PW_MODULE alone does not start a browser inside check:runtime), and says so when skipped.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');
const JS = read('ui/overlay.js'), CSS = read('ui/overlay.css');
const O = require(path.join(APP, 'ui', 'overlay.js'));

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
const SCOPE = ':where(:root[data-kit], [data-ui-scope]) ';   /* zero weight; the same prefix as parts.css (KS02b) */
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/* ---------- the files ---------- */
await test('the files exist and the header names what B68Ui gains', () => {
  for (const f of ['app/ui/overlay.css', 'app/ui/overlay.js']) assert.ok(fs.existsSync(path.join(ROOT, f)), f);
  for (const n of ['B68Ui.confirm', 'B68Ui.prompt', 'B68Ui.popover', 'B68Ui.openMenu', 'B68Ui.toast', 'B68Ui.tip', 'B68GmEsc']) assert.ok(JS.indexOf(n) >= 0, 'the header names ' + n);
  for (const n of ['confirm', 'prompt', 'popover', 'openMenu', 'toast', 'tip', 'place', 'step', 'toastCore', 'stack', 'attach']) assert.equal(typeof O[n], 'function', n);
});
await test('attach adds the six to B68Ui and leaves the frozen parts alone', () => {
  const part = () => 'menu part', U = { button() {}, row() {}, menu: part, VERSION: 1 };
  O.attach(U);
  assert.equal(U.menu, part, 'B68Ui.menu is the menu part (KS02b): the overlay kit leaves it alone');
  for (const n of ['confirm', 'prompt', 'popover', 'openMenu', 'toast', 'tip']) assert.equal(typeof U[n], 'function', n);
  assert.equal(U.VERSION, 1); assert.equal(typeof U.button, 'function');
});
await test('the ratchet would count nothing in the kit files: no hand-built button, no important flag, no inline style attribute, no native confirm or prompt call', () => {
  const KINDS = {
    button: /<button\b/g, important: /!\s*important\b/gi, style: /\bstyle=\\?["']/g,
    confirm: /(?:\b(?:window|self|globalThis|W)\.|(?<![\w$.]|function\s{1,4}))confirm\s*\(/g, prompt: /(?:\b(?:window|self|globalThis|W)\.|(?<![\w$.]|function\s{1,4}))prompt\s*\(/g
  };
  for (const [name, text] of [['overlay.js', JS], ['overlay.css', CSS]]) for (const k of Object.keys(KINDS)) assert.equal((text.match(KINDS[k]) || []).length, 0, name + ': ' + k);
});
await test('overlay.css: no @layer, no mangled punctuation, every selector starts with a ui- class, no colour of its own, no hard shadow', () => {
  const css = strip(CSS);
  assert.ok(!/@layer/.test(css));
  assert.ok(!/[\u0080-\u009f\uFFFD]/.test(CSS), 'no U+0080 to U+009F');
  const sel = css.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').replace(/@media[^{]*\{/g, '').split('}').map((b) => b.split('{')[0]).filter((s) => s.trim());
  assert.ok(sel.length > 20, 'found the rules');
  for (const g of sel) for (const s of g.split(SCOPE).join('@@').split(',').map((x) => x.trim()).filter(Boolean)) assert.ok(/^@@\.ui-[a-z]/.test(s) && !/:where|:root/.test(s), 'unscoped selector ' + s);
  assert.ok(!/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(css), 'colours come from the tokens');
  assert.ok(!/box-shadow:\s*[^;n]*\d/.test(css), 'no hard shadow (the Primary alone has one)');
  for (const t of ['--ui-layer-dialog', '--ui-layer-popover', '--ui-layer-toast']) assert.ok(css.indexOf(t) >= 0, t + ' is used');
});
await test('overlay.css: nothing under 12px on the desk, and reduced motion is a cut', () => {
  const css = strip(CSS);
  assert.ok(!/font:[^;]*\b(?:[0-9]|1[01])px\b/.test(css));
  assert.ok(/prefers-reduced-motion: reduce\)\s*\{\s*\.ui-toast \{ animation: none/.test(css.split(SCOPE).join('')));
});
await test('overlay.js adds no key listener to the document or the window (its source has none)', () => {
  assert.ok(!/(?:document|doc\(\)|\bd|\bW)\.addEventListener\(\s*['"]key/.test(JS));
});

/* ---------- placement ---------- */
const VP = { left: 0, top: 0, right: 1000, bottom: 700 };
const A = (l, t, w = 40, h = 30) => ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h });
const boxOf = (p, s) => ({ left: p.left, top: p.top, right: p.left + s.w, bottom: p.top + s.h });
const inside = (r, vp, m = 8) => r.left >= vp.left + m && r.top >= vp.top + m && r.right <= vp.right - m && r.bottom <= vp.bottom - m;
const overlaps = (x, y) => x.left < y.right && x.right > y.left && x.top < y.bottom && x.bottom > y.top;
await test('place: below and left-aligned when it fits', () => {
  const r = O.place(A(100, 100), { w: 160, h: 120 }, VP, 'bottom-start');
  assert.deepEqual([r.side, r.align, r.flipped, r.crossFlipped, r.left, r.top], ['bottom', 'start', false, false, 100, 136]);
});
await test('place: flips above at the bottom edge, to the other edge at the right edge, both at the corner; always inside and clear of the anchor', () => {
  const size = { w: 160, h: 120 };
  const up = O.place(A(100, 640), size, VP, 'bottom-start');
  assert.equal(up.side, 'top'); assert.ok(up.flipped); assert.equal(up.top, 640 - 6 - 120);
  const edge = O.place(A(950, 100), size, VP, 'bottom-start');
  assert.equal(edge.side, 'bottom'); assert.ok(edge.crossFlipped); assert.equal(edge.align, 'end'); assert.equal(edge.left, 990 - 160);
  const corner = O.place(A(950, 660), size, VP, 'bottom-start');
  assert.equal(corner.side, 'top'); assert.ok(corner.flipped && corner.crossFlipped);
  for (const [a, r] of [[A(100, 640), up], [A(950, 100), edge], [A(950, 660), corner]]) {
    const b = boxOf(r, size);
    assert.ok(inside(b, VP), 'inside the screen'); assert.ok(!overlaps(b, a), 'clear of the anchor');
  }
});
await test('place: sides left and right, centre, end alignment; a box taller than the screen is clamped; a bad placement means below', () => {
  const size = { w: 100, h: 60 };
  assert.equal(O.place(A(400, 300), size, VP, 'right-start').left, 446);
  assert.equal(O.place(A(900, 300), size, VP, 'right-start').side, 'left');
  assert.equal(O.place(A(400, 300, 40, 30), size, VP, 'bottom-center').left, 420 - 50);
  assert.equal(O.place(A(400, 300, 40, 30), size, VP, 'top-end').left, 440 - 100);
  assert.ok(O.place(A(400, 300), { w: 100, h: 900 }, VP, 'bottom-start').top >= 8);
  assert.equal(O.place(A(400, 300), size, VP, 'nonsense').side, 'bottom');
});
await test('step: arrows wrap, Home and End jump, other keys are not ours', () => {
  assert.equal(O.step(-1, 'ArrowDown', 3), 0); assert.equal(O.step(-1, 'ArrowUp', 3), 2);
  assert.equal(O.step(2, 'ArrowDown', 3), 0); assert.equal(O.step(0, 'ArrowUp', 3), 2);
  assert.equal(O.step(1, 'Home', 3), 0); assert.equal(O.step(1, 'End', 3), 2);
  assert.equal(O.step(1, 'a', 3), null); assert.equal(O.step(0, 'ArrowDown', 0), null);
});

/* ---------- the toast state machine, with a fake clock and a fake view ---------- */
function rig(over, hold) {
  let now = 0, id = 0; const tm = new Map(), held = [];
  const timers = { now: () => now, set: (fn, ms) => { id += 1; tm.set(id, { at: now + ms, fn }); return id; }, clear: (t) => { tm.delete(t); } };
  const view = { mount() {}, update() {}, unmount: (it, done) => { if (hold) held.push(done); else done(); } };
  const core = O.toastCore({ timers, view, ...over });
  const tick = (ms) => {
    const end = now + ms;
    for (;;) {
      const due = [...tm.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      tm.delete(due[0]); now = due[1].at; due[1].fn();
    }
    now = end;
  };
  return { core, tick, held, texts: () => core.shown().map((i) => i.text), queued: () => core.queued().map((i) => i.text) };
}
await test('toasts: five in a row show four and queue one; the fifth takes a slot when the first four fade after 5 seconds', () => {
  const r = rig();
  for (let i = 1; i <= 5; i++) r.core.add({ text: 't' + i });
  assert.deepEqual(r.texts(), ['t1', 't2', 't3', 't4']); assert.deepEqual(r.queued(), ['t5']);
  r.tick(4999); assert.equal(r.texts().length, 4, 'not before 5 s');
  r.tick(2);
  assert.deepEqual(r.texts(), ['t5']); assert.deepEqual(r.queued(), []);
  r.tick(5001); assert.deepEqual(r.texts(), []);
});
await test('toasts: an error outlives an info and stays; an error that finds the stack full waits ahead of a waiting info', () => {
  const r = rig();
  r.core.add({ text: 'saved' }); r.core.add({ text: 'boom', tone: 'error' });
  r.tick(60000);
  assert.deepEqual(r.texts(), ['boom']);
  const q = rig();
  ['a', 'b', 'c', 'd', 'e'].forEach((t) => q.core.add({ text: t })); q.core.add({ text: 'bad', tone: 'error' });
  assert.deepEqual(q.queued(), ['bad', 'e']);
  q.tick(5001); assert.deepEqual(q.texts(), ['bad', 'e']);
  q.tick(60000); assert.deepEqual(q.texts(), ['bad']);
});
await test('toasts: a dismissed one lets the next in once its fade is over; a queued one can be dismissed before it shows', () => {
  const r = rig({ max: 2 }, true);
  const a = r.core.add({ text: 'a', duration: 0 }), b = r.core.add({ text: 'b', duration: 0 });
  r.core.add({ text: 'c' });
  assert.deepEqual(r.queued(), ['c']);
  a.dismiss();
  assert.deepEqual(r.queued(), ['c'], 'the fade is not over, so the slot is still taken');
  r.held.splice(0).forEach((f) => f());
  assert.deepEqual(r.texts(), ['b', 'c']);
  const d = r.core.add({ text: 'd' }); assert.deepEqual(r.queued(), ['d']); d.dismiss(); assert.deepEqual(r.queued(), []);
  b.dismiss(); r.held.splice(0).forEach((f) => f()); assert.deepEqual(r.texts(), ['c']);
});
await test('toasts: hover pauses the time and the rest is kept; a duration of 0 stays; the same key replaces the words and restarts the time', () => {
  const r = rig(); const t = r.core.add({ text: 'x' });
  r.tick(3000); const it = r.core.byId(t.id); r.core.pause(it);
  r.tick(10000); assert.deepEqual(r.texts(), ['x'], 'paused');
  r.core.resume(it); r.tick(1999); assert.deepEqual(r.texts(), ['x']); r.tick(2); assert.deepEqual(r.texts(), []);
  const s = rig(); s.core.add({ text: 'stay', duration: 0 }); s.tick(60000); assert.deepEqual(s.texts(), ['stay']);
  const k = rig(); k.core.add({ text: 'one', key: 'save' }); k.tick(3000); k.core.add({ text: 'two', key: 'save' });
  assert.deepEqual(k.texts(), ['two']); k.tick(4000); assert.deepEqual(k.texts(), ['two'], 'its five seconds began again'); k.tick(1100); assert.deepEqual(k.texts(), []);
});
await test('toasts: dismissErrors takes every error down at once and leaves the info; undo is a function or { label, fn }', () => {
  const r = rig();
  r.core.add({ text: 'e1', tone: 'error' }); r.core.add({ text: 'e2', tone: 'error' }); r.core.add({ text: 'i', duration: 0, undo: () => {} });
  assert.ok(r.core.hasErrors()); r.core.dismissErrors();
  assert.deepEqual(r.texts(), ['i']); assert.ok(!r.core.hasErrors());
  assert.equal(r.core.shown()[0].undo.label, 'Undo');
  const u = rig(); u.core.add({ text: 'x', undo: { label: 'Put back', fn() {} } }); assert.equal(u.core.shown()[0].undo.label, 'Put back');
});

/* ---------- the browser part ---------- */
const PW = process.env.KIT_OVERLAY_BROWSER === '1' && process.env.PW_MODULE;
if (!PW) {
  console.log('SKIP the browser part: set KIT_OVERLAY_BROWSER=1 with PW_MODULE (and PW_CHANNEL=msedge) to run the dialog, popover, toast and tooltip in a real browser');
} else {
  const { chromium } = require(PW);
  const PORT = Number(process.env.KIT_OVERLAY_PORT || 10100);
  if (PORT < 10100 || PORT > 10149) throw new Error('KIT_OVERLAY_PORT must be 10100 to 10149 (this bundle\'s ports)');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* the page: the kit's tokens, parts and overlay sheets, esc.js, ui.js, overlay.js, and a stand-in for the GM page's one Esc (gm-page.js onKey: a
     capture listener on the document that returns while a dialog is open, else hands Esc to B68GmEsc) with entries at the page's own priorities */
  const PAGE = (esc) => `<!doctype html><html lang="en" data-kit="desk" data-theme="light"><head><meta charset="utf-8"><title>kit overlay</title>
<link rel="stylesheet" href="/app/ui/tokens.css"><link rel="stylesheet" href="/app/ui/parts.css"><link rel="stylesheet" href="/app/ui/overlay.css">
<style>html,body{margin:0;height:100%;background:var(--ui-surface);color:var(--ui-ink);font:14px/1.4 sans-serif}
.at{position:fixed}#tf{position:absolute;left:300px;top:300px;width:320px;transform:translateZ(0);overflow:hidden;height:240px}</style></head>
<body><button class="ui-btn at" id="opener" style="left:20px;top:20px">Opener</button>
<button class="ui-btn at" id="opener2" style="left:150px;top:20px">Menu</button>
<button class="ui-btn at" id="edge" style="right:4px;bottom:4px">Edge</button>
<button class="ui-btn at" id="tl" style="left:4px;top:4px">TL</button>
<button class="ui-btn at" id="tipbtn" style="left:300px;top:100px" title="Show on iPad" data-tip-key="I">Tip</button>
<button class="ui-btn at" id="tipbot" style="left:300px;bottom:4px" title="Low button">Low</button>
<input id="field" class="at" style="left:20px;top:80px"><div id="tf"></div>
<script>window.__docKeys=[];(function(){var a=document.addEventListener;document.addEventListener=function(t){window.__docKeys.push(t);return a.apply(this,arguments)};var b=window.addEventListener;window.addEventListener=function(t){window.__docKeys.push('w:'+t);return b.apply(this,arguments)}})();</script>
${esc ? '<script src="/app/gm/esc.js"></script>' : ''}<script src="/app/ui/ui.js"></script><script src="/app/ui/overlay.js"></script>
<script>
window.handleLog=[];window.flags={find:false,menu:false,drawer:false,stamp:false};window.panics=0;window.picked=[];
var E=window.B68GmEsc;
if(E){var h=E.handle;E.handle=function(c){var r=h.call(E,c);window.handleLog.push(r);return r};
 E.register('find',{priority:90,isOpen:function(){return flags.find},close:function(){flags.find=false}});
 E.register('menu',{priority:80,isOpen:function(){return flags.menu},close:function(){flags.menu=false}});
 E.register('drawer',{priority:50,isOpen:function(){return flags.drawer},close:function(){flags.drawer=false}});
 E.register('stamp',{priority:10,kind:'stamp',isOpen:function(){return flags.stamp},close:function(){flags.stamp=false}});
 document.addEventListener('keydown',function(ev){if(document.querySelector('dialog[open]'))return;
  if(ev.key==='Escape'){ev.preventDefault();ev.stopPropagation();E.handle({field:null,isField:function(){return false},blur:function(){},panic:function(){window.panics++}})}},true);}
</script></body></html>`;
  const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/favicon.ico') { res.statusCode = 204; res.end(); return; }
    if (u.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end(PAGE(true)); return; }
    if (u.pathname === '/noesc') { res.setHeader('content-type', 'text/html'); res.end(PAGE(false)); return; }
    const f = path.join(ROOT, path.normalize(u.pathname));
    if (!f.startsWith(APP + path.sep) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.statusCode = 404; res.end('no'); return; }
    res.setHeader('content-type', MIME[path.extname(f)] || 'application/octet-stream'); res.end(fs.readFileSync(f));
  });
  await new Promise((r, j) => { server.once('error', j); server.listen(PORT, '127.0.0.1', r); });
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined, headless: true });
  try {
    const open = async (url = '/', opt = {}) => {
      const ctx = await browser.newContext({ viewport: { width: 1100, height: 700 }, ...opt }), p = await ctx.newPage();
      const errs = []; p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
      await p.goto('http://127.0.0.1:' + PORT + url); p.errs = errs; p.ctx = ctx;
      return p;
    };
    let page = await open();
    const ev = (fn, arg, p = page) => p.evaluate(fn, arg);
    const rect = (sel, p = page) => p.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; }, sel);
    const active = (p = page) => p.evaluate(() => { const a = document.activeElement; return a.id || a.getAttribute('data-ui-act') || a.className || a.tagName; });
    const settle = (name) => page.waitForFunction((n) => window[n] !== undefined, name);
    /* start a dialog and leave its answer in window[name]; a click on its title is the user activation a real Esc comes after */
    const start = async (call, name, activate = true) => {
      await ev(([c, n]) => { window[n] = undefined; Function('return ' + c)().then((v) => { window[n] = { v }; }); }, [call, name]);
      await page.waitForSelector('dialog.ui-dialog[open]');
      if (activate) await page.click('.ui-dialog-title');
    };
    const dialogs = () => ev(() => document.querySelectorAll('dialog[open]').length);
    const answer = (name) => ev((n) => window[n] && window[n].v, name);

    /* ---- dialog ---- */
    await test('browser: B68Ui has the six and the page loaded without an error', async () => {
      assert.equal(await ev(() => ['confirm', 'prompt', 'popover', 'openMenu', 'toast', 'tip'].every((n) => typeof B68Ui[n] === 'function')), true);
      assert.deepEqual(page.errs, []);
    });
    await test('browser: confirm: the confirm button has focus; Enter confirms; the dialog is gone and focus is back on the opener', async () => {
      await page.focus('#opener');
      await start('B68Ui.confirm({ title: "Clear the board?", body: "Nothing is lost.", confirm: "Clear" })', 'r', false);
      assert.equal(await active(), 'confirm');
      assert.equal(await ev(() => document.querySelector('dialog').getAttribute('aria-labelledby') === document.querySelector('.ui-dialog-title').id), true);
      await page.keyboard.press('Enter'); await settle('r');
      assert.equal(await answer('r'), true);
      assert.equal(await ev(() => document.querySelectorAll('dialog').length), 0);
      assert.equal(await active(), 'opener');
    });
    await test('browser: confirm: Esc cancels through B68GmEsc (the dialog is one of its entries until it closes); the stamp and PANIC are not touched; focus returns', async () => {
      await page.focus('#opener'); await ev(() => { window.handleLog.length = 0; window.flags.stamp = true; });
      await start('B68Ui.confirm({ title: "Go?" })', 'r');
      assert.deepEqual(await ev(() => B68GmEsc.list().filter((x) => x.open && /^ui[.-]/.test(x.id)).map((x) => x.id + ':' + x.priority)), ['ui.dialog.1:101']);
      await page.keyboard.press('Escape'); await settle('r');
      assert.equal(await answer('r'), false);
      assert.deepEqual(await ev(() => window.handleLog), ['closed:ui.dialog.1']);
      assert.deepEqual(await ev(() => [window.flags.stamp, window.panics, B68GmEsc.list().some((x) => /^ui\.dialog/.test(x.id))]), [true, 0, false]);
      assert.equal(await active(), 'opener'); await ev(() => { window.flags.stamp = false; });
    });
    await test('browser: confirm: Esc with no user activation (the browser closes the dialog itself) settles it the same way and leaves nothing registered', async () => {
      await page.focus('#opener'); await ev(() => { window.handleLog.length = 0; });
      await start('B68Ui.confirm({ title: "Go?" })', 'r', false);
      await page.keyboard.press('Escape'); await settle('r');
      assert.equal(await answer('r'), false);
      assert.equal(await dialogs(), 0); assert.equal(await ev(() => B68GmEsc.list().some((x) => /^ui\.dialog/.test(x.id))), false); assert.equal(await active(), 'opener');
    });
    await test('browser: confirm: a click outside cancels; a press that starts inside and ends outside does not', async () => {
      await start('B68Ui.confirm({ title: "Go?" })', 'r', false);
      const t = await rect('.ui-dialog-title');
      await page.mouse.move(t.left + 4, t.top + 4); await page.mouse.down(); await page.mouse.move(3, 3); await page.mouse.up();
      assert.equal(await dialogs(), 1, 'a drag out of the dialog keeps it');
      await page.mouse.click(3, 3); await settle('r');
      assert.equal(await answer('r'), false); assert.equal(await dialogs(), 0);
    });
    await test('browser: a danger confirm: Cancel is the focused Primary and the danger button is not the default; Enter cancels; Tab then Enter confirms', async () => {
      await page.focus('#opener');
      const call = 'B68Ui.confirm({ title: "Delete the night?", confirm: "Delete", danger: true })';
      await start(call, 'r', false);
      assert.equal(await active(), 'cancel');
      assert.deepEqual(await ev(() => [document.querySelector('[data-ui-act=cancel]').className, document.querySelector('[data-ui-act=confirm]').className, document.querySelector('[data-ui-act=confirm]').type]),
        ['ui-btn ui-btn--primary', 'ui-btn ui-btn--danger', 'button']);
      await page.keyboard.press('Enter'); await settle('r');
      assert.equal(await answer('r'), false);
      await start(call, 'r', false);
      await page.keyboard.press('Tab'); assert.equal(await active(), 'confirm');
      await page.keyboard.press('Enter'); await settle('r');
      assert.equal(await answer('r'), true);
    });
    await test('browser: prompt: the value is selected; Enter returns it; an empty required value stays open and says so; Esc returns null; a text area takes Ctrl+Enter', async () => {
      await page.focus('#opener');
      await start('B68Ui.prompt({ title: "Rename the night", label: "Name", value: "Sunrise", required: true })', 'r', false);
      assert.equal(await ev(() => document.activeElement.value + '|' + document.activeElement.selectionStart + '-' + document.activeElement.selectionEnd), 'Sunrise|0-7');
      await page.keyboard.type('Velvet'); await page.keyboard.press('Enter'); await settle('r');
      assert.equal(await answer('r'), 'Velvet');
      await start('B68Ui.prompt({ title: "Rename", label: "Name", required: true })', 'r', false);
      await page.keyboard.press('Enter');
      assert.equal(await dialogs(), 1); assert.equal(await ev(() => document.activeElement.getAttribute('aria-invalid')), 'true');
      await page.keyboard.press('Escape'); await settle('r');
      assert.equal(await answer('r'), null);
      await start('B68Ui.prompt({ title: "A line", label: "Line", kind: "textarea" })', 'r', false);
      await page.keyboard.type('one'); await page.keyboard.press('Enter'); await page.keyboard.type('two');
      assert.equal(await dialogs(), 1, 'Enter in a text area is a new line'); await page.keyboard.press('Control+Enter'); await settle('r');
      assert.equal(await answer('r'), 'one\ntwo');
    });
    await test('browser: every word in a dialog goes in as text (a title with markup is shown, not built)', async () => {
      await start('B68Ui.confirm({ title: "<b id=x>bold</b>", body: "<i>no</i>" })', 'r');
      assert.equal(await ev(() => document.querySelectorAll('dialog b, dialog i').length), 0);
      assert.equal(await ev(() => document.querySelector('.ui-dialog-title').textContent), '<b id=x>bold</b>');
      await page.keyboard.press('Escape'); await settle('r');
    });

    /* ---- popover and menu ---- */
    const menuCall = (anchor) => 'B68Ui.openMenu({ anchor: document.querySelector("' + anchor + '"), label: "Actions", items: [{ label: "Introduce", value: "i" }, { label: "Show on iPad", value: "s" }, { label: "Gone", value: "g", disabled: true }, { label: "Hide", value: "h", rank: "danger" }], onSelect: (v) => window.picked.push(v) })';
    const menuOpen = (anchor, name = 'mm') => ev(([c, n]) => { window[n] = Function('return ' + c)(); window[n].open(); }, [menuCall(anchor), name]);
    const menus = () => ev(() => document.querySelectorAll('.ui-menu').length);
    await test('browser: a menu opens under its anchor with focus on the first item; arrows wrap past a disabled item; Home and End jump; Enter picks, closes and returns focus', async () => {
      await menuOpen('#opener2');
      assert.equal(await ev(() => document.querySelector('#opener2').getAttribute('aria-expanded')), 'true');
      const m = await rect('.ui-menu'), a = await rect('#opener2');
      assert.ok(m.top >= a.bottom, 'under the anchor'); assert.ok(Math.abs(m.left - a.left) < 2, 'left aligned');
      const lab = () => ev(() => document.activeElement.textContent);
      assert.equal(await lab(), 'Introduce');
      await page.keyboard.press('ArrowDown'); assert.equal(await lab(), 'Show on iPad');
      await page.keyboard.press('ArrowDown'); assert.equal(await lab(), 'Hide', 'the disabled one is skipped');
      await page.keyboard.press('ArrowDown'); assert.equal(await lab(), 'Introduce', 'wraps');
      await page.keyboard.press('ArrowUp'); assert.equal(await lab(), 'Hide');
      await page.keyboard.press('Home'); assert.equal(await lab(), 'Introduce'); await page.keyboard.press('End'); assert.equal(await lab(), 'Hide');
      await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter');
      assert.deepEqual(await ev(() => window.picked), ['s']);
      assert.equal(await menus(), 0); assert.equal(await active(), 'opener2');
    });
    await test('browser: a menu flips at the screen edge (up at the bottom, to the other edge at the right) and stays clear of its anchor; Esc and Tab close it', async () => {
      await menuOpen('#edge');
      const m = await rect('.ui-menu'), a = await rect('#edge');
      assert.equal(await ev(() => document.querySelector('.ui-menu').getAttribute('data-side')), 'top');
      assert.ok(m.bottom <= a.top, 'above the anchor'); assert.ok(m.right <= 1100 - 7 && m.left >= 7 && m.top >= 7, 'inside the page');
      assert.ok(Math.abs(m.right - a.right) < 8, 'aligned to the anchor\'s right edge');
      await page.keyboard.press('Escape'); assert.equal(await menus(), 0);
      await menuOpen('#tl');
      assert.equal(await ev(() => document.querySelector('.ui-menu').getAttribute('data-side')), 'bottom');
      await page.keyboard.press('Tab'); assert.equal(await menus(), 0, 'Tab closes');
    });
    await test('browser: the Esc order is the same with a popover open: find, the Menu, the popover, the drawer, then the stamp and PANIC; the page\'s own entries are untouched', async () => {
      const order = () => ev(() => B68GmEsc.list().filter((x) => !/^ui[.-]/.test(x.id)).map((x) => x.id + ':' + x.priority));
      const before = await order();
      await ev(() => { window.handleLog.length = 0; window.panics = 0; window.flags.find = true; window.flags.menu = true; window.flags.drawer = true; window.flags.stamp = true; });
      await menuOpen('#opener2', 'm4');
      const seen = [];
      for (let i = 0; i < 6; i++) { await page.keyboard.press('Escape'); seen.push((await ev(() => window.handleLog)).slice(-1)[0]); }
      assert.deepEqual([seen[0], seen[1], seen[3], seen[4], seen[5]], ['closed:find', 'closed:menu', 'closed:drawer', 'stamp', 'panic']);
      assert.match(seen[2], /^closed:ui\.pop\.\d+$/, 'the popover (70) sits between the Menu (80) and the drawer (50)');
      assert.equal(await ev(() => window.panics), 1);
      assert.deepEqual(await order(), before, 'the page\'s own entries and their order are untouched');
      assert.equal(await menus(), 0);
    });
    await test('browser: a popover opened inside a dialog closes first, then the dialog, and the page behind is not touched; closing the dialog any other way takes the popover with it', async () => {
      await ev(() => { window.handleLog.length = 0; window.flags.drawer = true; });
      await start('B68Ui.prompt({ title: "Pick", label: "Name" })', 'r');
      const inner = () => ev(() => { const b = document.createElement('button'); b.id = 'inner'; b.textContent = 'Menu'; document.querySelector('.ui-dialog-acts').prepend(b); window.m5 = B68Ui.openMenu({ anchor: b, items: ['One', 'Two'] }); window.m5.open(); });
      await inner();
      assert.equal(await ev(() => document.querySelector('dialog .ui-menu') !== null), true, 'it opens inside the dialog, so it is above the backdrop');
      await page.keyboard.press('Escape'); assert.equal(await dialogs(), 1);
      assert.match((await ev(() => window.handleLog))[0], /^closed:ui\.pop\.\d+$/);
      await page.keyboard.press('Escape'); await settle('r');
      assert.equal(await dialogs(), 0); assert.equal(await ev(() => window.flags.drawer), true); await ev(() => { window.flags.drawer = false; });
      await start('B68Ui.prompt({ title: "Pick", label: "Name" })', 'r');
      await inner(); await page.mouse.click(3, 3); await settle('r');
      assert.deepEqual(await ev(() => [window.m5.isOpen(), B68GmEsc.list().some((x) => /^ui\.pop/.test(x.id) && x.open)]), [false, false]);
      assert.equal(await menus(), 0);
    });
    await test('browser: the row\'s more button opens its menu (in a transformed, clipping box too), one at a time; a pick closes it; Esc goes through B68GmEsc; a click elsewhere closes it', async () => {
      await ev(() => {
        const a = B68Ui.row({ id: 'r1', label: 'Mabel Quist', sub: 'Fixer', lead: 'MQ', action: { label: 'Spotlight' }, more: [{ label: 'Introduce' }, { label: 'Hide', rank: 'danger' }] });
        const b = B68Ui.row({ id: 'r2', label: 'Dov Kessler', sub: 'Sergeant', lead: 'DK', more: [{ label: 'Introduce' }] });
        document.getElementById('tf').innerHTML = a + b; window.handleLog.length = 0;
      });
      const hidden = (s) => ev((x) => document.querySelector(x).hidden, s);
      assert.equal(await hidden('#r1-more'), true);
      await page.click('#r2 [data-ui-more]'); assert.equal(await hidden('#r2-more'), false);
      await page.click('#r1 [data-ui-more]');
      assert.equal(await hidden('#r1-more'), false); assert.equal(await hidden('#r2-more'), true, 'one at a time');
      assert.equal(await ev(() => document.querySelector('#r1 [data-ui-more]').getAttribute('aria-expanded')), 'true');
      const m = await rect('#r1-more'), b = await rect('#r1 [data-ui-more]');
      assert.ok(Math.abs(m.top - (b.bottom + 6)) <= 2, 'under the button although the box has a transform: ' + m.top + ' vs ' + (b.bottom + 6));
      assert.ok(m.right <= 1100 - 7 && m.left >= 7);
      assert.match(await active(), /ui-menu-item/, 'focus is on an item');
      await page.keyboard.press('Escape');
      assert.equal(await hidden('#r1-more'), true);
      assert.deepEqual(await ev(() => window.handleLog), ['closed:ui.more']);
      await page.click('#r1 [data-ui-more]'); await page.click('#r1-more .ui-menu-item'); assert.equal(await hidden('#r1-more'), true);
      assert.match(await active(), /ui-row-more/);
      await page.click('#r1 [data-ui-more]'); await page.mouse.click(1000, 600);
      assert.equal(await hidden('#r1-more'), true, 'a click elsewhere closes it');
    });

    /* ---- the toast stack ---- */
    const toasts = () => ev(() => document.querySelectorAll('.ui-toast').length);
    await test('browser: five toasts in a row show four and queue one; the stack is one live region at the bottom right', async () => {
      await page.mouse.move(5, 300);   /* the pointer is not over where the stack will be (a hover pauses a toast) */
      await ev(() => { for (let i = 1; i <= 5; i++) B68Ui.toast({ text: 'Toast ' + i, duration: 700 }); });
      assert.equal(await toasts(), 4);
      assert.deepEqual(await ev(() => B68Ui.toast.stack().queued().map((i) => i.text)), ['Toast 5']);
      assert.equal(await ev(() => document.querySelectorAll('.ui-toast-stack').length), 1);
      assert.deepEqual(await ev(() => { const e = document.querySelector('.ui-toast-stack'); return [e.getAttribute('aria-live'), e.getAttribute('role'), document.querySelector('.ui-toast').getAttribute('role')]; }), ['polite', 'region', 'status']);
      const r = await rect('.ui-toast-stack');
      assert.ok(r.right > 1100 - 40 && r.bottom > 700 - 40, 'bottom right');
      await page.waitForFunction(() => document.querySelectorAll('.ui-toast').length === 1 && document.querySelector('.ui-toast-text').textContent === 'Toast 5');
      await page.waitForFunction(() => document.querySelectorAll('.ui-toast').length === 0);
    });
    await test('browser: an info toast shows its 5-second timer and can carry Undo; Undo runs and takes it down', async () => {
      await ev(() => { window.undone = 0; B68Ui.toast({ text: 'Sent to the iPad: The vault floor', undo: () => { window.undone++; } }); });
      assert.equal(await ev(() => getComputedStyle(document.querySelector('.ui-toast-timer')).animationDuration), '5s');
      assert.equal(await ev(() => document.querySelector('.ui-toast-undo').textContent), 'Undo');
      await page.click('.ui-toast-undo');
      assert.equal(await ev(() => window.undone), 1);
      await page.waitForFunction(() => document.querySelectorAll('.ui-toast').length === 0);
    });
    await test('browser: an error outlives an info, has a red edge, an Error label and an alert role, and stays until X; an info is paused while hovered', async () => {
      await ev(() => { B68Ui.toast({ text: 'Could not save', tone: 'error' }); B68Ui.toast({ text: 'Saved earlier', duration: 500 }); });
      assert.deepEqual(await ev(() => { const e = document.querySelector('.ui-toast--error'); return [e.getAttribute('role'), e.querySelector('.ui-toast-kind').textContent, !!e.querySelector('.ui-toast-timer')]; }), ['alert', 'Error', false]);
      assert.equal(await ev(() => {
        const e = document.querySelector('.ui-toast--error'), p = document.createElement('i'); p.style.color = 'var(--ui-alarm)'; document.body.appendChild(p);
        const same = getComputedStyle(e).borderLeftColor === getComputedStyle(p).color; p.remove(); return same;
      }), true, 'the edge is the alarm red');
      await page.hover('.ui-toast:not(.ui-toast--error)'); await sleep(900);
      assert.equal(await toasts(), 2, 'paused while hovered');
      await page.mouse.move(5, 300);
      await page.waitForFunction(() => document.querySelectorAll('.ui-toast').length === 1); await sleep(1200);
      assert.equal(await ev(() => document.querySelector('.ui-toast').classList.contains('ui-toast--error')), true, 'the error is still there');
      await page.click('.ui-toast--error .ui-toast-x');
      await page.waitForFunction(() => document.querySelectorAll('.ui-toast').length === 0);
    });
    await test('browser: an error toast changes nothing about Esc: no B68GmEsc entry, anyOpen stays false, Esc still takes the stamp down and then reaches PANIC in the order of today; X dismisses it', async () => {
      const order = () => ev(() => B68GmEsc.list().map((x) => x.id + ':' + x.priority + ':' + x.kind));
      const before = await order();
      await ev(() => { window.handleLog.length = 0; window.panics = 0; window.flags.stamp = true; B68Ui.toast({ text: 'One', tone: 'error' }); B68Ui.toast({ text: 'Two', tone: 'error' }); });
      assert.deepEqual(await order(), before, 'the toast registered nothing');
      assert.equal(await ev(() => B68GmEsc.anyOpen()), false, 'a toast does not hold the keys of the page');
      await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
      assert.deepEqual(await ev(() => window.handleLog), ['stamp', 'panic']);
      assert.deepEqual(await ev(() => [window.panics, window.flags.stamp]), [1, false]);
      assert.equal(await ev(() => document.querySelectorAll('.ui-toast--error').length), 2, 'Esc left the errors standing');
      await page.click('.ui-toast--error .ui-toast-x');
      await page.waitForFunction(() => document.querySelectorAll('.ui-toast--error').length === 1);
      await page.click('.ui-toast--error .ui-toast-x');
      await page.waitForFunction(() => document.querySelectorAll('.ui-toast').length === 0);
    });
    await test('browser: reduced motion is a cut: a dismissed toast is gone at once and the timer steps instead of draining', async () => {
      const p2 = await open('/', { reducedMotion: 'reduce' });
      await ev(() => { B68Ui.toast({ text: 'Quiet', duration: 0 }); }, null, p2);
      assert.equal(await ev(() => getComputedStyle(document.querySelector('.ui-toast')).animationName, null, p2), 'none');
      await p2.click('.ui-toast-x');
      assert.equal(await ev(() => document.querySelectorAll('.ui-toast').length, null, p2), 0);
      await ev(() => { B68Ui.toast({ text: 'Timed' }); }, null, p2);
      assert.equal(await ev(() => getComputedStyle(document.querySelector('.ui-toast-timer')).animationTimingFunction, null, p2), 'steps(5)');
      await p2.ctx.close();
    });
    await test('browser: a toast that comes while a dialog is open stands inside it (above the backdrop) and goes home when the dialog closes', async () => {
      await start('B68Ui.confirm({ title: "Busy" })', 'r');
      await ev(() => { B68Ui.toast({ text: 'Not behind', duration: 0 }); });
      assert.equal(await ev(() => !!document.querySelector('dialog .ui-toast-stack')), true);
      await page.keyboard.press('Escape'); await settle('r');
      assert.equal(await ev(() => document.querySelector('.ui-toast-stack').parentNode === document.body), true);
      assert.equal(await toasts(), 1, 'it is still showing');
      await ev(() => { const s = B68Ui.toast.stack(); s.dismiss(s.shown()[0]); });
    });

    /* ---- tooltip ---- */
    const tips = () => ev(() => document.querySelectorAll('.ui-tip').length);
    const keyTo = async (from, key) => { await page.focus(from); await page.keyboard.press(key); };   /* a focus a key moved is a keyboard focus (:focus-visible) */
    await test('browser: a title is a tooltip on keyboard focus, with the key hint; the native title steps aside while it shows and is back after; it never covers the control', async () => {
      await keyTo('#tl', 'Tab');
      assert.equal(await active(), 'tipbtn');
      await page.waitForSelector('.ui-tip');
      assert.deepEqual(await ev(() => [document.querySelector('.ui-tip-text').textContent, document.querySelector('.ui-tip .ui-key').textContent, document.querySelector('.ui-tip').getAttribute('role')]), ['Show on iPad', 'I', 'tooltip']);
      assert.equal(await ev(() => document.getElementById('tipbtn').hasAttribute('title')), false);
      assert.equal(await ev(() => document.getElementById('tipbtn').getAttribute('aria-describedby') === document.querySelector('.ui-tip').id), true);
      const t = await rect('.ui-tip'), a = await rect('#tipbtn');
      assert.ok(!overlaps(t, a), 'clear of the control'); assert.ok(t.top >= a.bottom, 'below it');
      await page.keyboard.press('Shift+Tab');
      assert.equal(await tips(), 0);
      assert.equal(await ev(() => document.getElementById('tipbtn').getAttribute('title')), 'Show on iPad');
      assert.equal(await ev(() => document.getElementById('tipbtn').hasAttribute('aria-describedby')), false);
    });
    await test('browser: a title is a tooltip on hover after a short wait; it goes when the pointer leaves or presses; at the bottom edge it flips above', async () => {
      const c = await rect('#tipbtn');
      await page.mouse.move(c.left + 5, c.top + 5); assert.equal(await tips(), 0, 'not at once');
      await page.waitForSelector('.ui-tip'); await page.mouse.move(5, 400);
      await page.waitForFunction(() => document.querySelectorAll('.ui-tip').length === 0);
      await page.mouse.move(c.left + 5, c.top + 5); await page.waitForSelector('.ui-tip'); await page.mouse.down();
      assert.equal(await tips(), 0); await page.mouse.up(); await page.mouse.move(5, 400);
      const l = await rect('#tipbot'); await page.mouse.move(l.left + 5, l.top + 5); await page.waitForSelector('.ui-tip');
      const t = await rect('.ui-tip'); assert.ok(t.bottom <= l.top, 'above the low button, not off the page'); assert.ok(t.top >= 0);
      await page.mouse.move(5, 400);
    });
    await test('browser: a title the page changes while its tooltip shows is not written over when the tooltip goes', async () => {
      await keyTo('#tipbtn', 'Tab'); assert.equal(await active(), 'tipbot'); await page.waitForSelector('.ui-tip');
      assert.equal(await ev(() => document.querySelector('.ui-tip-text').textContent), 'Low button');
      await ev(() => { document.getElementById('tipbot').setAttribute('title', 'Changed while shown'); });
      await page.keyboard.press('Tab');   /* to the field, which has no title */
      assert.equal(await tips(), 0);
      assert.deepEqual(await ev(() => [document.getElementById('tipbot').getAttribute('title'), document.getElementById('tipbot').hasAttribute('data-ui-tip')]), ['Changed while shown', false]);
      await ev(() => { document.getElementById('tipbot').setAttribute('title', 'Low button'); });
    });
    await test('browser: B68Ui.tip(el, text, key) works the same; a plain title is left alone on a page without the desk token', async () => {
      await ev(() => { B68Ui.tip(document.getElementById('opener'), 'Opens things', 'O'); });
      await keyTo('#opener2', 'Shift+Tab');
      assert.equal(await active(), 'opener'); await page.waitForSelector('.ui-tip');
      assert.deepEqual(await ev(() => [document.querySelector('.ui-tip-text').textContent, document.querySelector('.ui-tip .ui-key').textContent]), ['Opens things', 'O']);
      await page.keyboard.press('Tab');
      await ev(() => { document.documentElement.setAttribute('data-kit', 'stage'); });
      await keyTo('#tl', 'Tab'); assert.equal(await active(), 'tipbtn'); await sleep(150);
      assert.equal(await tips(), 0, 'a title is taken over on the desk only');
      assert.equal(await ev(() => document.getElementById('tipbtn').getAttribute('title')), 'Show on iPad');
      await ev(() => { document.documentElement.setAttribute('data-kit', 'desk'); });
    });

    /* ---- no key listener, and a page without an Esc owner ---- */
    await test('browser: overlay.js added no key listener to the document or the window, at load or while anything was open', async () => {
      const t = await ev(() => window.__docKeys.slice());
      assert.ok(t.indexOf('click') >= 0, 'the recorder saw the document listeners');
      assert.deepEqual(t.filter((x) => /key/.test(x)), ['keydown'], 'only the stand-in page\'s own capture listener');
      assert.deepEqual(page.errs, []);
    });
    await page.ctx.close();
    page = await open('/noesc');
    await test('browser: with no B68GmEsc (the look book): a dialog keeps its own Esc; a popover and an error toast close on an Escape heard on themselves', async () => {
      await start('B68Ui.confirm({ title: "Go?" })', 'r');
      await page.keyboard.press('Escape'); await settle('r');
      assert.equal(await answer('r'), false);
      await menuOpen('#opener2');
      await page.keyboard.press('Escape');
      assert.equal(await menus(), 0); assert.equal(await active(), 'opener2');
      await ev(() => { B68Ui.toast({ text: 'Oops', tone: 'error' }); document.querySelector('.ui-toast-x').focus(); });
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.querySelectorAll('.ui-toast').length === 0);
      assert.deepEqual(page.errs, []);
    });
    await page.ctx.close();
  } finally {
    await browser.close(); server.close();
  }
}

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
