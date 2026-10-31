// app/mapzoom.js: the pure view maths (clamp, window, pinch, zoomAt) and the attach wiring against a minimal fake DOM.
//   node checks/runtime/mapzoom.test.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const { Pure, attach } = createRequire(import.meta.url)(path.join(ROOT, 'app', 'mapzoom.js'));
let failed = 0;
async function test(name, fn) { try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function near(a, b, msg) { if (!(Math.abs(a - b) < 1e-6)) throw new Error((msg || 'not near') + ': got ' + a + ' want ' + b); }

const V = { x: 0, y: 0, w: 200, h: 100 }, size = { w: 400, h: 400 };   // fit: k = 2, the map is 400x200 px, letterboxed vertically

await test('parseViewBox: four finite numbers with a positive size, else null', () => {
  ok(JSON.stringify(Pure.parseViewBox('0 0 200 100')) === JSON.stringify(V));
  ok(Pure.parseViewBox('1,2,3,4').w === 3);
  ok(Pure.parseViewBox('0 0 0 100') === null && Pure.parseViewBox('') === null && Pure.parseViewBox('a b c d') === null && Pure.parseViewBox(null) === null);
});
await test('clampView: s is held to 1..MAXZOOM; an axis that fits the frame is centred; a zoomed axis cannot pan off the map', () => {
  const f = Pure.clampView(V, size, { s: 1, cx: 5, cy: 5 });
  near(f.cx, 100); near(f.cy, 50);
  ok(Pure.clampView(V, size, { s: 0.2, cx: 0, cy: 0 }).s === 1);
  ok(Pure.clampView(V, size, { s: 99, cx: 0, cy: 0 }).s === Pure.MAXZOOM);
  const z = Pure.clampView(V, size, { s: 4, cx: -500, cy: 900 }); // k = 8: half-window 25 x 25 map units
  near(z.cx, 25); near(z.cy, 75);
  const bad = Pure.clampView(V, size, { s: NaN, cx: NaN, cy: NaN }); ok(bad.s === 1 && isFinite(bad.cx) && isFinite(bad.cy));
});
await test('viewWindow: at fit the window is the frame aspect centred on the map; zoom 2 halves it', () => {
  const w1 = Pure.viewWindow(V, size, Pure.fit(V));
  near(w1.w, 200); near(w1.h, 200); near(w1.x, 0); near(w1.y, -50);
  const w2 = Pure.viewWindow(V, size, { s: 2, cx: 100, cy: 50 });
  near(w2.w, 100); near(w2.h, 100); near(w2.x, 50);
});
await test('zoomAt: the map point under the cursor stays under it', () => {
  const st = { s: 2, cx: 100, cy: 50 }, px = 60, py = -20;   // pixels from the frame centre
  const k0 = Pure.fitK(V, size), before = { x: st.cx + px / (k0 * st.s), y: st.cy + py / (k0 * st.s) };
  const n = Pure.zoomAt(V, size, st, 1.5, px, py);
  near(n.s, 3);
  near(n.cx + px / (k0 * n.s), before.x); near(n.cy + py / (k0 * n.s), before.y);
});
await test('zoomAt at the centre keeps the centre; zooming out past fit stops at 1 and recentres', () => {
  const n = Pure.zoomAt(V, size, { s: 2, cx: 80, cy: 50 }, 1.5, 0, 0); near(n.cx, 80);
  const o = Pure.zoomAt(V, size, { s: 1.2, cx: 40, cy: 50 }, 0.1, 0, 0); near(o.s, 1); near(o.cx, 100);
});
await test('pinchView: the midpoint moving pans at constant scale; fingers closing zoom out', () => {
  const pan = Pure.pinchView(V, size, { s: 4, cx: 100, cy: 50, d: 1, px: 0, py: 0 }, { d: 1, px: 80, py: 0 });   // drag right 80px: the centre moves left by 80/(2*4)=10
  near(pan.s, 4); near(pan.cx, 90);
  const out = Pure.pinchView(V, size, { s: 4, cx: 100, cy: 50, d: 200, px: 0, py: 0 }, { d: 100, px: 0, py: 0 }); near(out.s, 2);
});

// ---- attach, against a minimal fake DOM ----
function fakeEl(tag) {
  const L = {}, el = {
    tag, attrs: {}, children: [], parentNode: null, classes: new Set(), className: '', ownerDocument: null, textContent: '', rect: { left: 0, top: 0, width: 400, height: 400 },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; }, removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; },
    addEventListener(t, f) { (L[t] = L[t] || []).push(f); }, removeEventListener(t, f) { L[t] = (L[t] || []).filter((x) => x !== f); },
    fire(t, ev) { (L[t] || []).slice().forEach((f) => f(Object.assign({ preventDefault() {}, stopPropagation() {}, target: this }, ev))); }, count(t) { return (L[t] || []).length; },
    getBoundingClientRect() { return this.rect; }, setPointerCapture() {}, releasePointerCapture() {},
    classList: null, closest(sel) { return sel.split(',').some((q) => { q = q.trim(); return q[0] === String.fromCharCode(91) ? q.slice(1, -1) in this.attrs : q[0] === '.' ? this.classes.has(q.slice(1)) : q === this.tag; }) ? this : null; }
  };
  el.classList = { toggle(c, on) { on ? el.classes.add(c) : el.classes.delete(c); }, add(c) { el.classes.add(c); }, remove(c) { el.classes.delete(c); } };
  return el;
}
const doc = { createElement: fakeEl };
function setup(store) {
  const frame = fakeEl('div'), svg = fakeEl('svg'); frame.ownerDocument = doc; svg.setAttribute('viewBox', '0 0 200 100'); frame.appendChild(svg);
  const z = attach(frame, svg, { store });
  return { frame, svg, z, vb: () => svg.getAttribute('viewBox').split(' ').map(Number) };
}
const ctlOf = (t) => t.frame.children.find((c) => c.className === 'mz-ctl');
await test('attach: fits on first draw and adds + / - / Fit buttons; no viewBox means no zoom', () => {
  const t = setup({}); ok(t.z); ok(t.vb()[2] === 200 && t.vb()[3] === 200, 'fit window ' + t.vb());
  ok(ctlOf(t).children.map((b) => b.textContent).join('|') === '+|−|Fit');
  const f = fakeEl('div'), s = fakeEl('svg'); f.ownerDocument = doc; ok(attach(f, s, {}) === null);
});
await test('attach: wheel zooms at the cursor and is cancelled; buttons zoom; Fit resets; the zoomed class follows', () => {
  const t = setup({});
  let prevented = false; t.frame.fire('wheel', { clientX: 300, clientY: 200, deltaY: -300, deltaMode: 0, preventDefault() { prevented = true; } });
  ok(prevented && t.vb()[2] < 200, 'zoomed in: ' + t.vb()); ok(t.frame.classes.has('mz-zoomed'));
  const ctl = ctlOf(t), btn = (n) => ctl.children.find((b) => b.attrs['data-mz'] === n);
  const w0 = t.vb()[2]; ctl.fire('click', { target: btn('in') }); ok(t.vb()[2] < w0, 'in');
  ctl.fire('click', { target: btn('out') }); near(t.vb()[2], w0);
  ctl.fire('click', { target: btn('fit') }); ok(t.vb()[2] === 200 && !t.frame.classes.has('mz-zoomed'), 'fit');
});
await test('Pure.keyOf and Pure.fitK', () => {
  ok(Pure.keyOf({ x: 1, y: 2, w: 3, h: 4 }) === '1 2 3 4'); ok(Pure.keyOf(V) === '0 0 200 100');
  near(Pure.fitK(V, size), 2); near(Pure.fitK(V, { w: 100, h: 400 }), 0.5); near(Pure.fitK({ x: 0, y: 0, w: 50, h: 400 }, size), 1);
});
await test('a press does not pan or capture until it moves past the slop; a press on a control or a chip never pans; the click after a pan is swallowed', () => {
  const t = setup({}); t.z.zoomBy(4); const v0 = t.vb().join(' '); let cap = 0; t.frame.setPointerCapture = () => { cap++; };
  t.frame.fire('pointerdown', { pointerId: 1, clientX: 200, clientY: 200, button: 0, pointerType: 'mouse', target: t.svg }); t.frame.fire('pointermove', { pointerId: 1, clientX: 202, clientY: 201 });
  ok(cap === 0 && t.vb().join(' ') === v0 && !t.frame.classes.has('mz-drag'), 'a 2px wobble is a tap'); t.frame.fire('pointerup', { pointerId: 1 });
  const chip = fakeEl('div'); chip.classes.add('rv-pc'); const btn = fakeEl('button'); btn.setAttribute('data-rv', 'x');
  for (const tg of [chip, btn]) { t.frame.fire('pointerdown', { pointerId: 2, clientX: 200, clientY: 200, button: 0, pointerType: 'mouse', target: tg }); t.frame.fire('pointermove', { pointerId: 2, clientX: 100, clientY: 100 }); t.frame.fire('pointerup', { pointerId: 2 }); }
  ok(cap === 0 && t.vb().join(' ') === v0, 'interactive targets never pan');
  t.frame.fire('pointerdown', { pointerId: 3, clientX: 200, clientY: 200, button: 0, pointerType: 'mouse', target: t.svg }); t.frame.fire('pointermove', { pointerId: 3, clientX: 190, clientY: 200 }); t.frame.fire('pointermove', { pointerId: 3, clientX: 120, clientY: 200 });
  ok(cap > 0 && t.vb().join(' ') !== v0, 'a real drag captures and pans'); t.frame.fire('pointerup', { pointerId: 3 });
  let stopped = false; t.frame.fire('click', { stopPropagation() { stopped = true; } }); ok(stopped, 'the click ending a pan is swallowed');
});
await test('the view is mirrored to sessionStorage by map, and a fresh store picks it up', () => {
  const mem = {}; globalThis.sessionStorage = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); } };
  try {
    const a = setup({}); a.z.zoomBy(3); ok(Object.keys(mem).length === 1 && Object.keys(mem)[0].endsWith('0 0 200 100'), 'written by map');
    const b = setup({}); near(+b.vb()[2], +a.vb()[2], 'an empty store recalls the session view');
    mem[Object.keys(mem)[0]] = '{not json'; const c = setup({}); ok(c.vb()[2] === 200, 'bad storage falls back to fit');
  } finally { delete globalThis.sessionStorage; }
});
await test('attach: a drag pans a zoomed map and does nothing at fit; two fingers pinch', () => {
  const t = setup({});
  t.frame.fire('pointerdown', { pointerId: 1, clientX: 200, clientY: 200, button: 0, pointerType: 'mouse' }); t.frame.fire('pointermove', { pointerId: 1, clientX: 100, clientY: 200 }); t.frame.fire('pointerup', { pointerId: 1 });
  ok(t.vb()[0] === 0 && t.vb()[2] === 200, 'no pan at fit');
  t.z.zoomBy(4); const x0 = t.vb()[0];
  t.frame.fire('pointerdown', { pointerId: 1, clientX: 200, clientY: 200, button: 0, pointerType: 'mouse' }); t.frame.fire('pointermove', { pointerId: 1, clientX: 190, clientY: 200 }); t.frame.fire('pointermove', { pointerId: 1, clientX: 100, clientY: 200 });
  ok(t.vb()[0] > x0, 'dragged left shows more of the right: ' + x0 + ' -> ' + t.vb()[0]); ok(t.frame.classes.has('mz-drag')); t.frame.fire('pointerup', { pointerId: 1 }); ok(!t.frame.classes.has('mz-drag'));
  t.z.fit(); const w = t.vb()[2];
  t.frame.fire('pointerdown', { pointerId: 1, clientX: 150, clientY: 200, pointerType: 'touch' }); t.frame.fire('pointerdown', { pointerId: 2, clientX: 250, clientY: 200, pointerType: 'touch' });
  t.frame.fire('pointermove', { pointerId: 2, clientX: 350, clientY: 200 }); ok(t.vb()[2] < w, 'fingers spreading zoom in');
});
await test('attach: the view survives a redraw through the shared store; a different map starts fitted; destroy removes the controls and listeners', () => {
  const store = {}; const a = setup(store); a.z.zoomBy(3); const was = a.vb(); a.z.destroy();
  ok(!ctlOf(a) && a.frame.count('wheel') === 0 && a.frame.count('pointerdown') === 0, 'destroy cleans up');
  const b = setup(store); was.forEach((n, i) => near(b.vb()[i], n, 'same view after redraw'));
  const f = fakeEl('div'), s = fakeEl('svg'); f.ownerDocument = doc; s.setAttribute('viewBox', '0 0 300 300'); f.appendChild(s); attach(f, s, { store });
  ok(store.s === 1 && store.key === '0 0 300 300', 'a new map starts at fit');
});
console.log(failed ? failed + ' FAILED' : 'all passed'); process.exit(failed ? 1 : 0);
