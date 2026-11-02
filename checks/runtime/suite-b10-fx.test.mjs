// Suite B10, ticket F7 (the FX budget, switches fx.pause and fx.off; no browser, no network): what each switch asks for, and that a fake frame is paused, held and put back
// without anything inside the ambient files changing.
//   node checks/runtime/suite-b10-fx.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { MiniEl } from './minidom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const require = createRequire(import.meta.url);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

/* a document the UMD files can draw into */
function fakeDoc() {
  const d = { hidden: false, listeners: {}, createElement: (t) => { const e = new MiniEl(t); e.ownerDocument = d; e.style = {}; e.addEventListener = (t, fn) => { (e.listeners = e.listeners || {})[t] = [fn]; }; return e; }, createElementNS: (ns, t) => d.createElement(t),
    addEventListener(t, f) { (d.listeners[t] = d.listeners[t] || []).push(f); }, removeEventListener() {} };
  return d;
}
globalThis.self = globalThis;
globalThis.location = { origin: 'http://x.test' };
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};

const Fx = require(path.join(APP, 'display', 'fx.js'));
const F = require(path.join(APP, 'features.js'));

/* ================= F7 the FX budget ================= */
function fakeWin() {
  const calls = { raf: [], playing: 0 };
  const media = { paused: false, pause() { this.paused = true; }, play() { this.paused = false; calls.playing++; return Promise.resolve(); } };
  const cls = new Set(); let style = null;
  const head = { appendChild(s) { style = s; } };
  const win = {
    requestAnimationFrame(cb) { calls.raf.push(cb); return calls.raf.length; }, cancelAnimationFrame() {},
    document: { head, documentElement: { classList: { toggle(c, on) { if (on) cls.add(c); else cls.delete(c); } } }, getElementById: () => style, createElement: () => ({ id: '', textContent: '' }), querySelectorAll: () => [media] }
  };
  return { win, calls, cls, media, style: () => style };
}
await test('fx.pause: want() pauses only a scene that is not on show; fx.off holds all; both off asks for nothing', () => {
  assert.deepEqual(Fx.want({}, { pageHidden: true }), { paused: false, off: false });
  assert.deepEqual(Fx.want({ pause: true }, { pageHidden: false }), { paused: false, off: false });
  assert.equal(Fx.want({ pause: true }, { pageHidden: true }).paused, true); assert.equal(Fx.want({ pause: true }, { covered: true }).paused, true); assert.equal(Fx.want({ pause: true }, { frameHidden: true }).paused, true);
  assert.deepEqual(Fx.want({ off: true }, {}), { paused: true, off: true });
});
await test('apply(): a frame with nothing asked is left exactly alone; paused holds rAF and media and puts them back; the ambient file is never opened', () => {
  const a = fakeWin();
  assert.equal(Fx.apply(a.win, { paused: false, off: false }), true); assert.equal(a.win.__b68fx, undefined, 'nothing installed');
  assert.equal(a.style(), null);
  Fx.apply(a.win, { paused: true, off: false });
  assert.ok(a.cls.has('b68-fx-paused')); assert.equal(a.media.paused, true); assert.match(a.style().textContent, /animation-play-state: paused/);
  const ran = []; const id = a.win.requestAnimationFrame(() => ran.push(1)); assert.ok(id < 0, 'held, not run'); assert.equal(a.calls.raf.length, 0);
  const id2 = a.win.requestAnimationFrame(() => ran.push(2)); a.win.cancelAnimationFrame(id2);
  Fx.apply(a.win, { paused: false, off: false });
  assert.equal(a.calls.raf.length, 1, 'the held frame is replayed once, the cancelled one is not'); assert.equal(a.media.paused, false); assert.equal(a.calls.playing, 1);
  assert.equal(a.cls.has('b68-fx-paused'), false);
  Fx.apply(a.win, { paused: true, off: true }); assert.ok(a.cls.has('b68-fx-off')); assert.match(a.style().textContent, /transition: none/);
  assert.equal(Fx.apply({ document: null }, { paused: true }), false, 'a frame we cannot reach is left alone');
  const scenes = fs.readdirSync(path.join(APP, 'ambient')).filter((f) => f.endsWith('.html'));
  assert.ok(scenes.length >= 10); assert.ok(scenes.every((f) => !/b68-fx/.test(fs.readFileSync(path.join(APP, 'ambient', f), 'latin1').slice(0, 400000))), 'nothing inside the ambient files');
});


/* ================= the switches, the wiring, the leaks ================= */
await test('fx.pause and fx.off are display switches, default off (Saturday on and try); the code asks for those ids', () => {
  for (const id of ['fx.pause', 'fx.off']) { const s = F.get(id); assert.ok(s, id); assert.equal(s.default, false); assert.equal(s.surface, 'display'); assert.ok(s.label && s.doc); }
  assert.equal(F.get('fx.pause').saturday, 'on'); assert.equal(F.get('fx.off').saturday, 'try');
  const src = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
  assert.match(src('display-page.js'), /swOn\('fx\.pause'\)/); assert.match(src('display-page.js'), /swOn\('fx\.off'\)/);
});
await test('display/fx.js is in the display bundle only and exists; no campaign names in it', () => {
  const routes = fs.readFileSync(path.join(APP, 'routes.js'), 'utf8');
  const bundle = (n) => (new RegExp('\\b' + n + ': \\[([^\\]]*)\\]').exec(routes) || [])[1] || '';
  assert.ok(bundle('display').includes("'display/fx.js'")); assert.ok(!bundle('gm').includes("'display/fx.js'")); assert.ok(fs.existsSync(path.join(APP, 'display', 'fx.js')));
  assert.doesNotMatch(fs.readFileSync(path.join(APP, 'display', 'fx.js'), 'utf8'), /GM-ONLY|Pelican/);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
