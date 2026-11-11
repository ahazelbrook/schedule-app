// The kit flag (the kit and stage build, KS01.2): app/ui/kit-flag.js (B68Kit) in a fake window. No browser, no network.
// data-kit on <html> follows set(); the memory (localStorage b68.kit) brings back only the route's own token and asks for its bundle;
// with every setting off nothing is painted, written or fetched; onChange hears each change and the bundle's arrival. Then the files:
// the flag names no setting id, sits in the core before boot.js, and each of the three routes makes its one call.
//   node checks/runtime/kit-flag.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const SRC = fs.readFileSync(path.join(APP, 'ui', 'kit-flag.js'), 'utf8');
const KEY = 'b68.kit';

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
/* localStorage (shared between pages made with it, as the tabs of one laptop share it); blocked: every call throws */
function storage(blocked) {
  const m = new Map(), log = [];
  const no = () => { throw new Error('SecurityError: storage is blocked'); };
  return { m, log, s: {
    getItem: (k) => (blocked ? no() : m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (blocked) no(); log.push('set ' + k + '=' + v); m.set(k, String(v)); },
    removeItem: (k) => { if (blocked) no(); log.push('remove ' + k); m.delete(k); }
  } };
}
/* <html>: its attributes and every write to them */
function htmlEl() {
  const a = {}, log = [];
  return { a, log, setAttribute(k, v) { log.push('set ' + k + '=' + v); a[k] = String(v); }, removeAttribute(k) { log.push('remove ' + k); delete a[k]; },
    hasAttribute: (k) => Object.prototype.hasOwnProperty.call(a, k), getAttribute: (k) => (Object.prototype.hasOwnProperty.call(a, k) ? a[k] : null) };
}
/* B68Load.need: records each ask; the test settles it */
function loader() {
  const calls = [], pending = {};
  return { calls, pending, need(name) { calls.push(name); return new Promise((res, rej) => { pending[name] = { res, rej }; }); } };
}
/* a page: kit-flag.js run as index.html runs it (window.B68Kit), on a route (location.hash) */
function page({ hash = '', store = storage(), load = loader(), clock = { t: 1000 }, noLoad = false } = {}) {
  const el = htmlEl(), errors = [];
  const win = { document: { documentElement: el }, location: { hash }, localStorage: store.s, console: { error: (e) => errors.push(e) }, Date: { now: () => clock.t } };
  if (!noLoad) win.B68Load = load;
  win.self = win;
  vm.createContext(win); vm.runInContext(SRC, win, { filename: 'ui/kit-flag.js' });
  return { K: win.B68Kit, el, store, load, clock, errors };
}
const flush = () => new Promise((r) => setImmediate(r));

await test('every setting off, nothing stored: no attribute, nothing written, nothing fetched, on any route; set(token, false) changes none of it', async () => {
  for (const hash of ['#gm', '#display', '#c/abc', '']) {
    const p = page({ hash });
    for (const n of ['desk', 'stage', 'phone']) { assert.equal(p.K.on(n), false, n); assert.equal(p.K.set(n, false), false, n); assert.equal(p.K.ready(n), false); }
    assert.deepEqual([p.el.log, p.store.log, p.load.calls], [[], [], []], hash + ': the page untouched');
    assert.equal(p.el.getAttribute('data-kit'), null);
  }
});
await test('set: on paints data-kit, remembers the token and asks for kit-<token> once; onChange hears the change, then ready when the bundle lands', async () => {
  const p = page({ hash: '#gm' }), heard = [];
  p.K.onChange((e) => heard.push(e.name + ':' + e.on + ':' + e.ready));
  assert.equal(p.K.set('desk', true), true);
  assert.equal(p.el.getAttribute('data-kit'), 'desk'); assert.equal(p.store.m.get(KEY), 'desk'); assert.deepEqual(p.load.calls, ['kit-desk']);
  assert.ok(p.K.on('desk') && !p.K.ready('desk'), 'on, its bundle not here yet');
  assert.equal(p.K.set('desk', true), false, 'the same value: no change'); assert.deepEqual(p.load.calls, ['kit-desk'], 'asked once');
  p.load.pending['kit-desk'].res('kit-desk'); await flush();
  assert.ok(p.K.ready('desk'));
  assert.deepEqual(heard, ['desk:true:false', 'desk:true:true']);
  assert.equal(p.K.set('desk', false), true); assert.equal(p.el.getAttribute('data-kit'), null); assert.equal(p.store.m.has(KEY), false, 'the last token off removes the key');
  assert.deepEqual(heard.slice(2), ['desk:false:false']);
  assert.equal(p.K.set('desk', true), true); assert.deepEqual(p.load.calls, ['kit-desk'], 'on again: the bundle is already here'); assert.ok(p.K.ready('desk'));
});
await test('several tokens: data-kit lists them in one order (desk stage phone); turning one off keeps the others; the last one off removes the attribute and the key', async () => {
  const p = page();
  p.K.set('phone', true); p.K.set('desk', true); p.K.set('stage', true);
  assert.equal(p.el.getAttribute('data-kit'), 'desk stage phone'); assert.equal(p.store.m.get(KEY), 'desk stage phone');
  p.K.set('stage', false); assert.equal(p.el.getAttribute('data-kit'), 'desk phone'); assert.equal(p.store.m.get(KEY), 'desk phone');
  p.K.set('desk', false); p.K.set('phone', false);
  assert.equal(p.el.hasAttribute('data-kit'), false); assert.equal(p.store.m.has(KEY), false);
  assert.deepEqual(p.store.log.slice(-1), ['remove ' + KEY]);
});
await test('remember: a reload brings back only this route\'s own token (#gm desk, #display stage, any other route phone) and asks for its bundle at once, writing nothing', async () => {
  for (const [hash, tok] of [['#gm', 'desk'], ['#display', 'stage'], ['#c/abc', 'phone'], ['', 'phone'], ['#t', 'phone']]) {
    const store = storage(); store.m.set(KEY, 'desk stage phone');
    const p = page({ hash, store });
    assert.equal(p.el.getAttribute('data-kit'), tok, hash); assert.deepEqual(p.load.calls, ['kit-' + tok], hash + ': its bundle, before the route draws');
    for (const n of ['desk', 'stage', 'phone']) assert.equal(p.K.on(n), n === tok, hash + ' ' + n);
    assert.deepEqual(store.log, [], hash + ': nothing written at load');
  }
  const store = storage(); store.m.set(KEY, 'stage');
  const g = page({ hash: '#gm', store });
  assert.equal(g.el.hasAttribute('data-kit'), false, 'the GM page does not take the iPad\'s token'); assert.deepEqual(g.load.calls, []);
});
await test('remember: the route confirms (set on: no change, no second fetch) or undoes it (set off: attribute and its token gone, another tab\'s kept)', async () => {
  const store = storage(); store.m.set(KEY, 'desk stage');
  const a = page({ hash: '#gm', store });
  assert.equal(a.K.set('desk', true), false); assert.deepEqual(a.load.calls, ['kit-desk']);
  const b = page({ hash: '#gm', store });
  assert.equal(b.K.set('desk', false), true); assert.equal(b.el.hasAttribute('data-kit'), false); assert.equal(store.m.get(KEY), 'stage', 'the iPad tab\'s token stays');
  for (const s of ['junk', ' desk  desk nope ']) { const st = storage(); st.m.set(KEY, s); const p = page({ hash: '#gm', store: st }); assert.equal(p.el.getAttribute('data-kit'), s === 'junk' ? null : 'desk', JSON.stringify(s)); }
});
await test('two tabs on one laptop: the memory merges per token, so each keeps its own', async () => {
  const store = storage();
  const gm = page({ hash: '#gm', store }), ds = page({ hash: '#display', store });
  gm.K.set('desk', true); ds.K.set('stage', true);
  assert.equal(store.m.get(KEY), 'desk stage');
  ds.K.set('stage', false); assert.equal(store.m.get(KEY), 'desk');
  assert.equal(gm.el.getAttribute('data-kit'), 'desk'); assert.equal(ds.el.hasAttribute('data-kit'), false, 'each page paints its own tokens');
});
await test('blocked storage (a private window): nothing throws, the attribute follows, the memory lasts for the visit', async () => {
  const p = page({ hash: '#c/x', store: storage(true) });
  assert.equal(p.K.set('phone', true), true); assert.equal(p.el.getAttribute('data-kit'), 'phone');
  assert.equal(p.K.set('phone', false), true); assert.equal(p.el.hasAttribute('data-kit'), false);
  assert.deepEqual(p.errors, []);
});
await test('a failed fetch: not ready; asked again by a later set(on), not sooner than 30 seconds', async () => {
  const p = page({ hash: '#gm' });
  p.K.set('desk', true); p.load.pending['kit-desk'].rej(new Error('could not load gm/kit/band.js')); await flush();
  assert.ok(p.K.on('desk') && !p.K.ready('desk'), 'on, not ready');
  p.K.set('desk', true); p.K.set('desk', false); p.K.set('desk', true);
  assert.deepEqual(p.load.calls, ['kit-desk'], 'not again within 30 s');
  p.clock.t += 30001; p.K.set('desk', true);
  assert.deepEqual(p.load.calls, ['kit-desk', 'kit-desk'], 'asked again (the token was already on)');
  p.load.pending['kit-desk'].res('kit-desk'); await flush(); assert.ok(p.K.ready('desk'));
});
await test('unknown names do nothing; a listener that throws does not stop the others; off() unsubscribes; with no B68Load the attribute and memory still follow', async () => {
  const p = page();
  for (const n of ['nope', 'kit.desk', '', null, 'who', 'pitches']) { assert.equal(p.K.set(n, true), false, String(n)); assert.equal(p.K.on(n), false); }
  assert.deepEqual([p.el.log, p.store.log, p.load.calls], [[], [], []]);
  const got = []; p.K.onChange(() => { throw new Error('boom'); }); const off = p.K.onChange((e) => got.push(e.name));
  p.K.set('stage', true); assert.deepEqual(got, ['stage']); assert.equal(p.errors.length, 1, 'the throw is logged');
  off(); p.K.set('stage', false); assert.deepEqual(got, ['stage']);
  assert.equal(typeof p.K.onChange(null), 'function');
  const q = page({ noLoad: true });
  assert.equal(q.K.set('phone', true), true); assert.equal(q.el.getAttribute('data-kit'), 'phone'); assert.equal(q.store.m.get(KEY), 'phone');
  assert.deepEqual([...p.K.NAMES], ['desk', 'stage', 'phone']);      /* spread: the page's array is from another realm */
});

/* ---------- the files ---------- */
const read = (f) => fs.readFileSync(path.join(APP, f), 'utf8');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
await test('the flag names no setting id (the routes read their own settings); it is in the core after routes.js and before boot.js, and index.html loads it there', async () => {
  assert.ok(!/kit\.(desk|stage|phone)|night\.who|blade\.pitches|B68Features|B68Flags/.test(code(SRC)), 'kit-flag.js knows no setting id');
  const g = {}; new Function('self', 'globalThis', read('routes.js'))(g, g);
  const core = g.B68Load.BUNDLES.core;
  assert.deepEqual(core.slice(-3), ['routes.js', 'ui/kit-flag.js', 'boot.js']);
  for (const t of ['desk', 'stage', 'phone']) assert.ok(Array.isArray(g.B68Load.BUNDLES['kit-' + t]), 'kit-' + t + ' is a bundle');
  assert.match(read('index.html'), /<script src="routes\.js"><\/script>\n<script src="ui\/kit-flag\.js"><\/script>\n<script src="boot\.js"><\/script>/);
});
await test('the three routes each make one call, each with its own token and its own setting: gm-page.js (renderBar, once the GM state is ready), display-page.js (onFeatures), tracker.js (render, a live sheet once the campaign has said)', async () => {
  const want = [['gm-page.js', 'desk', 'kit.desk'], ['display-page.js', 'stage', 'kit.stage'], ['tracker.js', 'phone', 'kit.phone']];
  for (const [f, tok, id] of want) {
    const src = read(f), calls = src.match(/B68Kit\.set\(/g) || [];
    assert.equal(calls.length, 1, f + ' calls B68Kit.set once');
    const line = src.split('\n').find((l) => l.includes('B68Kit.set('));
    assert.ok(line.includes("B68Kit.set('" + tok + "'") && line.includes("'" + id + "'"), f + ': ' + line.trim().slice(0, 160));
  }
  const gm = read('gm-page.js'), at = gm.indexOf('B68Kit.set('), rb = gm.indexOf('\n  function renderBar() {');
  assert.ok(rb > 0 && rb < at && gm.indexOf('\n  function ', rb + 5) > at, 'in renderBar (it runs on the first draw, on every arrival of the GM state and after every Settings change)');
  assert.ok(/S\.status === 'ready'/.test(gm.split('\n').find((l) => l.includes('B68Kit.set('))), 'only once the GM state is here (an early draw must not turn a remembered desk off)');
  assert.ok(/!cur\.ui\.static/.test(read('tracker.js').split('\n').find((l) => l.includes('B68Kit.set('))), 'a live sheet only (not print)');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
