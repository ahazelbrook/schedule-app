// Unit test for the Spotted beat (suite 2.6, app/gm/map-spotted.js): the pure parts, then the controller against a fake host on a VIRTUAL clock (no wall time, no DOM, no network).
// The real timing on the fixture is measured by gm-map-spotted.e2e.mjs. Every name is invented.
//   node checks/runtime/gm-map-spotted.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const Sp = require(path.join(ROOT, 'app', 'gm', 'map-spotted.js'));
const F = require(path.join(ROOT, 'app', 'features.js'));
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

// a virtual clock: setTimeout runs callbacks in time order when advance() is awaited
function clock() {
  let t = 0, seq = 0, q = [];
  return {
    now: () => t,
    setTimeout: (fn, ms) => { q.push({ at: t + ms, id: ++seq, fn }); return seq; },
    clearTimeout: (id) => { q = q.filter((x) => x.id !== id); },
    async run() { for (let guard = 0; guard < 1000; guard++) { await Promise.resolve(); await new Promise((r) => setImmediate(r)); if (!q.length) return; q.sort((a, b) => a.at - b.at || a.id - b.id); const n = q.shift(); t = Math.max(t, n.at); n.fn(); } throw new Error('clock did not settle'); }
  };
}
// a fake svg/doc: just enough to count what fillSvg adds and clearFill removes
function fakeDoc() {
  const made = [];
  const node = (tag) => ({ tag, attrs: {}, children: [], style: {}, parent: null, setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { c.parentNode = this; this.children.push(c); return c; }, removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; }, get firstChild() { return this.children[0] || null; } });
  return { made, createElementNS: (ns, tag) => { const n = node(tag); made.push(n); return n; }, createElement: node };
}
function fakeSvg() {
  const svg = { children: [], appendChild(c) { c.parentNode = this; this.children.push(c); return c; }, removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; }, querySelectorAll(sel) { assert.equal(sel, '.b19-spot'); return this.children.filter((c) => c.attrs && c.attrs.class === 'b19-spot'); } };
  return svg;
}
const BOX = { x: 10, y: 20, w: 40, h: 30 };
const CLOCKS = () => [{ id: 'c_fuse', name: 'Fuse', size: 6, filled: 2 }, { id: 'c_other', name: 'Other', size: 4, filled: 0 }];

await test('the switch is a registry line: GM-only, default off, in the maps stage', () => {
  const s = F.get('map.spotted'); assert.ok(s); assert.equal(s.surface, 'gm'); assert.equal(s.default, false); assert.equal(s.stage, 'map'); assert.equal(s.saturday, 'try');
});
await test('pickClock: the named table clock, one segment further; none, full or unnamed gives null', () => {
  assert.deepEqual(Sp.pickClock(CLOCKS(), 'Fuse'), { id: 'c_fuse', from: 2, to: 3, size: 6 });
  assert.equal(Sp.pickClock(CLOCKS(), 'Nope'), null); assert.equal(Sp.pickClock(CLOCKS(), ''), null); assert.equal(Sp.pickClock(null, 'Fuse'), null);
  assert.equal(Sp.pickClock([{ id: 'x', name: 'Fuse', size: 4, filled: 4 }], 'Fuse'), null);
});
await test('beatKey: the same clock and segment is the same key on two pages; the next segment is another', () => {
  const a = Sp.beatKey(Sp.pickClock(CLOCKS(), 'Fuse'), 1), b = Sp.beatKey(Sp.pickClock(CLOCKS(), 'Fuse'), 99999);
  assert.equal(a, b); assert.match(a, /^[A-Za-z0-9_-]{1,80}$/);
  assert.notEqual(a, Sp.beatKey({ id: 'c_fuse', to: 4 }, 1));
  assert.equal(Sp.beatKey(null, 1000), Sp.beatKey(null, 2900)); assert.notEqual(Sp.beatKey(null, 1000), Sp.beatKey(null, 3100));
});
await test('fillSvg draws a yellow circle clipped to the room, from the eyes; clearFill takes it away; no page text goes in', () => {
  const doc = fakeDoc(), svg = fakeSvg();
  const g = Sp.fillSvg(doc, svg, BOX, 'k1');
  assert.equal(svg.children.length, 1); assert.equal(g.attrs.class, 'b19-spot');
  const circle = doc.made.find((n) => n.tag === 'circle'), eye = Sp.eyeFor(BOX);
  assert.equal(circle.attrs.fill, '#f2c200'); assert.equal(+circle.attrs.cx, eye.x); assert.equal(+circle.attrs.cy, eye.y);
  const rect = doc.made.find((n) => n.tag === 'rect'); assert.deepEqual([rect.attrs.x, rect.attrs.y, rect.attrs.width, rect.attrs.height].map(Number), [10, 20, 40, 30]);
  assert.ok(doc.made.every((n) => !('textContent' in n)));
  Sp.fillSvg(doc, svg, BOX, 'k2'); assert.equal(svg.children.length, 1, 'a second fill replaces the first');
  Sp.clearFill(svg); assert.equal(svg.children.length, 0);
});

// the host: a table, a show that is "unchanged" when the key is already running, and a log of what happened
function world() {
  const w = { shows: [], ticks: [], clocks: CLOCKS(), runningKey: null, toasts: [], logs: [], zooms: [], sets: [], flag: true };
  const mkHost = (cl, room = 'Showroom') => ({
    feature: (id) => w.flag && id === 'map.spotted', doc: () => doc0, now: cl.now, setTimeout: cl.setTimeout, clearTimeout: cl.clearTimeout,
    room: () => room, roomBox: () => BOX, clockName: () => 'Fuse', clocks: () => w.clocks.map((c) => ({ ...c })),
    tick: async (id, to) => { w.ticks.push([id, to]); w.clocks.find((c) => c.id === id).filled = to; return { ok: true }; },
    show: async (kind, payload, o) => { w.shows.push([kind, payload, o.key]); if (w.runningKey === o.key) return { unchanged: true }; w.runningKey = o.key; return { seq: 1 }; },
    toast: (m, bad) => w.toasts.push([m, !!bad]), log: (t) => w.logs.push(t)
  });
  return { w, mkHost };
}
const doc0 = fakeDoc();
const zoomFake = (w) => ({ get: () => ({ s: 1, cx: 0, cy: 0 }), set: (v) => w.sets.push(v), zoomToBox: (b) => w.zooms.push(b) });

await test('one tap: zoom, sting, fill, one tick, back, all inside 3 seconds on the virtual clock', async () => {
  const { w, mkHost } = world(), cl = clock(), svg = fakeSvg(), c = Sp.create(mkHost(cl));
  c.paint({ ownerDocument: null }, svg, zoomFake(w));
  const p = c.run(); await cl.run(); const r = await p;
  assert.equal(r.why, ''); assert.ok(r.zoomed && r.sting && r.filled && r.ticked, JSON.stringify(r));
  assert.ok(r.ms < 3000 && r.ms >= Sp.STEPS_MS.tick, 'took ' + r.ms);
  assert.deepEqual(w.zooms, [BOX]); assert.deepEqual(w.sets, [{ s: 1, cx: 0, cy: 0 }], 'and the map went back to the view it had');
  assert.deepEqual(w.ticks, [['c_fuse', 3]]); assert.equal(w.shows.length, 1);
  assert.deepEqual(w.shows[0].slice(0, 2), ['spotted', { text: 'SPOTTED' }], 'the sting names no room and no person');
  assert.equal(svg.children.length, 0, 'the fill is gone at the end');
  assert.ok(w.logs.length === 1 && /3\/6/.test(w.logs[0]));
});
await test('two GM pages at once: the clock ticks once', async () => {
  const { w, mkHost } = world(), cl = clock(), a = Sp.create(mkHost(cl)), b = Sp.create(mkHost(cl));
  const za = zoomFake(w); a.paint({ ownerDocument: null }, fakeSvg(), za); b.paint({ ownerDocument: null }, fakeSvg(), za);
  const pa = a.run(), pb = b.run(); await cl.run(); const [ra, rb] = await Promise.all([pa, pb]);
  assert.equal(w.ticks.length, 1, JSON.stringify(w.ticks)); assert.equal(w.clocks[0].filled, 3);
  assert.equal([ra, rb].filter((r) => r.ticked).length, 1);
});
await test('a second press while it runs does nothing; a second press after it is a second beat', async () => {
  const { w, mkHost } = world(), cl = clock(), c = Sp.create(mkHost(cl)); c.paint({ ownerDocument: null }, fakeSvg(), zoomFake(w));
  const p1 = c.run(), p2 = c.run(); assert.equal((await p2).why, 'busy'); await cl.run(); await p1;
  const p3 = c.run(); await cl.run(); const r3 = await p3;
  assert.ok(r3.ticked); assert.deepEqual(w.ticks.map((t) => t[1]), [3, 4]);
});
await test('switch off: it does nothing at all (no beat, no tick, no zoom)', async () => {
  const { w, mkHost } = world(), cl = clock(); w.flag = false; const c = Sp.create(mkHost(cl)); c.paint({ ownerDocument: null }, fakeSvg(), zoomFake(w));
  const r = await c.run(); assert.equal(r.why, 'off'); assert.equal(w.shows.length + w.ticks.length + w.zooms.length, 0);
});
await test('no room, no alarm clock, a refused sting: each says so and nothing is ticked wrongly', async () => {
  let { w, mkHost } = world(), cl = clock(), c = Sp.create(mkHost(cl, '')); const r0 = await c.run();
  assert.equal(r0.why, 'no room'); assert.equal(w.shows.length, 0); assert.ok(w.toasts[0][1]);
  ({ w, mkHost } = world()); cl = clock(); const h = mkHost(cl); h.clockName = () => ''; c = Sp.create(h); c.paint({ ownerDocument: null }, fakeSvg(), zoomFake(w));
  let p = c.run(); await cl.run(); let r = await p; assert.ok(r.sting && !r.ticked && w.ticks.length === 0 && w.toasts.length === 1, 'sting yes, tick no');
  ({ w, mkHost } = world()); cl = clock(); const h2 = mkHost(cl); h2.show = async () => null; c = Sp.create(h2); c.paint({ ownerDocument: null }, fakeSvg(), zoomFake(w));
  p = c.run(); await cl.run(); r = await p; assert.ok(!r.sting && !r.ticked && w.ticks.length === 0, 'a refused beat ticks nothing');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
