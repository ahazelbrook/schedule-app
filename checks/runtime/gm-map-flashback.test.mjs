// Unit test for the flashback filter on the map (suite 2.9, app/gm/map-flashback.js): the Stress-cost parse, the cue grammar's "flashback 2" (honoured only while the
// switch is on, and unparsed as it was while it is off), the controller against a fake host, the iPad's look (app/display/layers.js) and where the files are bundled.
// Every name is invented.
//   node checks/runtime/gm-map-flashback.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
globalThis.self = globalThis;                  // the display files hang their API on `self`, as they do in a browser
const require = createRequire(import.meta.url);
const Fl = require(path.join(ROOT, 'app', 'gm', 'map-flashback.js'));
globalThis.B68GmMapFlashback = Fl;              // the grammar finds the parser the way the page does
const Gr = require(path.join(ROOT, 'app', 'gm', 'cue-grammar.js'));
const F = require(path.join(ROOT, 'app', 'features.js'));
const Layers = require(path.join(ROOT, 'app', 'display', 'layers.js'));
const Hands = await import(pathToFileURL(path.join(ROOT, 'functions', '_lib', 'assist', 'hands.js')).href);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

await test('the switch: a display switch, default off, Saturday on, in the maps stage', () => {
  const s = F.get('map.flashback'); assert.ok(s); assert.equal(s.surface, 'display'); assert.equal(s.default, false); assert.equal(s.saturday, 'on'); assert.equal(s.stage, 'map');
});
await test('parseStress: a number, in digits or words, with the little words round it; nothing else', () => {
  const p = (w) => Fl.parseStress(w, { and: 1, a: 1, to: 1 });
  assert.deepEqual(p(['2']), { stress: 2, ok: true }); assert.deepEqual(p(['two', 'stress']), { stress: 2, ok: true }); assert.deepEqual(p(['for', 'three', 'stress']), { stress: 3, ok: true });
  assert.deepEqual(p(['costs', '1']), { stress: 1, ok: true }); assert.deepEqual(p(['none']), { stress: 0, ok: true }); assert.deepEqual(p([]), { stress: null, ok: true });
  assert.equal(p(['stress']).ok, false, 'a cost word with no number is not a cue'); assert.equal(p(['2', '3']).ok, false); assert.equal(p(['banana']).ok, false); assert.equal(p(['12']).ok, false);
});

// the grammar's parse of the flashback word, through the registry's definition
const flashDef = () => Gr.defs().find((d) => d.id === 'flashback');
await test('the grammar: "flashback" is as before; "flashback 2" and "flashback, two stress" carry the cost; junk is unparsed', () => {
  const d = flashDef();
  const parse = (words) => d.parse({ word: 'flashback', rest: words.join(' '), words });
  const act = (r) => r.action || r;
  assert.equal(act(parse([])).verb, 'flashback'); assert.equal(act(parse([])).stress, undefined);
  assert.equal(act(parse(['2'])).stress, 2); assert.equal(act(parse(['two', 'stress'])).stress, 2); assert.equal(act(parse(['for', '1', 'stress'])).stress, 1);
  const bad = parse(['banana']); assert.ok(bad.refused || bad.unparsed || !(act(bad).verb), JSON.stringify(bad));
  assert.ok(!act(parse(['stress'])).verb, 'a cost word alone is not a cue');
});

// the grammar controller: a flashback cue with a cost is heard only while map.flashback is on
function gramHost(flags) {
  const calls = { layers: [], notes: [], ends: [], toasts: [] };
  const layers = {};
  const host = {
    feature: (id) => !!flags[id], cueVerbs: () => ({ register() {}, unregister() {}, list: () => [] }), toast: (m, bad) => calls.toasts.push([m, !!bad]),
    layer: async (p, v) => { calls.layers.push([p, v]); layers[p] = v; return {}; }, layerValue: (p) => layers[p] || null,
    flashbackNote: (c) => calls.notes.push(c), flashbackEnd: () => calls.ends.push(1), doc: () => null, npcs: () => []
  };
  return { host, calls };
}
await test('the cue "flashback 2": with map.flashback on it sets the layer and notes the cost; with it off it does what an unparsed cue does (nothing)', async () => {
  let g = gramHost({ 'ai.grammar': true, 'map.flashback': true }); let c = Gr.create(g.host);
  const r = await c.run({ type: 'cue_do', verb: 'flashback', stress: 2 });
  assert.equal(r.ok, true); assert.deepEqual(g.calls.layers, [['scene.filter', 'flashback']]); assert.deepEqual(g.calls.notes, [2]);
  const b = await c.run({ type: 'cue_do', verb: 'back' }); assert.equal(b.ok, true); assert.deepEqual(g.calls.layers[1], ['scene.filter', null]); assert.equal(g.calls.ends.length, 1);
  g = gramHost({ 'ai.grammar': true }); c = Gr.create(g.host);
  const off = await c.run({ type: 'cue_do', verb: 'flashback', stress: 2 });
  assert.equal(off.ok, false); assert.equal(g.calls.layers.length, 0); assert.deepEqual(g.calls.toasts[0], ['Didn’t catch that.', false]);
  const plain = await c.run({ type: 'cue_do', verb: 'flashback' }); assert.equal(plain.ok, true, 'a plain flashback is as it was'); assert.deepEqual(g.calls.notes, [null]);
});
await test('the Worker keeps a Stress cost on a flashback cue, and only a whole number 0 to 9', () => {
  const text = 'Blade, flashback two stress', state = Hands.cleanState({ clocks: [], npcs: [], pcs: [] });
  const run = (a) => Hands.validateActions([{ ...a, quote: text }], { state, lines: [{ id: 'l2', kind: 'line', text }], cue: { parsed: true, cueLineId: 'l2' } });
  const ok = run({ type: 'cue_do', verb: 'flashback', stress: 2 }); assert.equal(ok.actions[0].stress, 2);
  assert.equal(run({ type: 'cue_do', verb: 'flashback', stress: 12 }).actions[0].stress, undefined);
  assert.equal(run({ type: 'cue_do', verb: 'flashback', stress: 'x' }).actions[0].stress, undefined);
  assert.equal(run({ type: 'cue_do', verb: 'flashback' }).actions[0].stress, undefined);
});

function node(tag) { return { tag, attrs: {}, children: [], parentNode: null, setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { c.parentNode = this; this.children.push(c); return c; }, removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; } }; }
const fakeDoc = () => ({ createElementNS: (ns, t) => node(t) });
const fakeSvg = () => Object.assign(node('svg'), { querySelectorAll(sel) { assert.equal(sel, '.b19-pin'); return this.children.filter((c) => c.attrs.class === 'b19-pin'); } });
const BOX = { x: 10, y: 20, w: 40, h: 30 };
function world(flag = true) {
  const w = { layer: null, layers: [], logs: [], toasts: [], room: 'Showroom', flag };
  const host = { feature: (id) => w.flag && id === 'map.flashback', doc: () => fakeDoc(), filter: () => w.layer, layer: async (p, v) => { w.layers.push([p, v]); w.layer = v; return {}; },
    room: () => w.room, roomBox: () => BOX, toast: (m, bad) => w.toasts.push([m, !!bad]), log: (t) => w.logs.push(t) };
  return { w, host };
}
await test('start and end: the layer goes up and down, the cost is logged and said, a second start while up does nothing', async () => {
  const { w, host } = world(), c = Fl.create(host);
  assert.equal(await c.start(2), true); assert.deepEqual(w.layers, [['scene.filter', 'flashback']]); assert.deepEqual(w.logs, ['Flashback: costs 2 Stress']); assert.match(w.toasts[0][0], /2 Stress/);
  assert.equal(await c.start(1), false, 'already up');
  assert.equal(await c.end(), true); assert.deepEqual(w.layers[1], ['scene.filter', null]); assert.equal(w.logs[1], 'Back from the flashback'); assert.equal(await c.end(), false);
  assert.equal(await c.toggle(), true); assert.equal(w.layer, 'flashback'); assert.equal(await c.toggle(), true); assert.equal(w.layer, null);
});
await test('switch off: nothing starts, nothing is noted, nothing is pinned', async () => {
  const { w, host } = world(false), c = Fl.create(host);
  assert.equal(await c.start(2), false); assert.equal(c.note(2), false); assert.equal(c.pin(), false); assert.equal(w.layers.length + w.logs.length, 0);
});
await test('a refused layer write leaves it off and says nothing of a cost', async () => {
  const { w, host } = world(); host.layer = async () => null; const c = Fl.create(host);
  assert.equal(await c.start(2), false); assert.equal(w.logs.length, 0);
});
await test('the pin: a pin on the crew’s room, a second tap takes it up, none without a room, and it is drawn on the map without any page text', () => {
  const { w, host } = world(), c = Fl.create(host), svg = fakeSvg();
  c.paint({ ownerDocument: null }, svg, null);
  assert.equal(c.pin(), true); assert.equal(c.pinned(), 'Showroom'); assert.equal(w.logs.at(-1), 'Flashback pin: Showroom');
  const g = Fl.pinSvg(fakeDoc(), svg, BOX); assert.equal(svg.children.length, 1); assert.equal(g.attrs.class, 'b19-pin'); Fl.pinSvg(fakeDoc(), svg, BOX); assert.equal(svg.children.length, 1);
  Fl.clearPin(svg); assert.equal(svg.children.length, 0);
  assert.equal(c.pin(), true); assert.equal(c.pinned(), '', 'tapped again in the same room: up');
  w.room = ''; assert.equal(c.pin(), false); assert.equal(w.toasts.at(-1)[1], true);
});

// the iPad's look
function fakeContainer() {
  const attrs = {};
  return { ownerDocument: { createElement: () => ({ className: '', style: {}, setAttribute() {}, appendChild() {}, remove() {} }) }, attrs,
    setAttribute: (k, v) => { attrs[k] = String(v); }, removeAttribute: (k) => { delete attrs[k]; }, querySelectorAll: () => [], appendChild() {}, removeChild() {} };
}
await test('layers.js: data-flash-look only while the filter is up AND map.flashback is on; it follows the switch without a new layer; with it off it is never set', () => {
  let on = false, sub = null;
  globalThis.B68Flags = { on: (id) => id === 'map.flashback' && on, subscribe: (fn) => { sub = fn; return () => { sub = null; }; } };
  const c = fakeContainer(), a = Layers.attach(c, {});
  a.apply({ scene: { filter: 'flashback' } }); assert.equal(c.attrs['data-scene-filter'], 'flashback'); assert.equal(c.attrs['data-flash-look'], undefined, 'switch off: the plain sepia only');
  on = true; sub(); assert.equal(c.attrs['data-flash-look'], '1', 'the switch arrives after the layer');
  a.apply({ scene: {} }); assert.equal(c.attrs['data-flash-look'], undefined, 'filter cleared: look gone');
  a.apply({ scene: { filter: 'flashback' } }); assert.equal(c.attrs['data-flash-look'], '1');
  a.destroy(); assert.equal(c.attrs['data-flash-look'], undefined); assert.equal(sub, null);
  delete globalThis.B68Flags;
  const c2 = fakeContainer(), a2 = Layers.attach(c2, {}); a2.apply({ scene: { filter: 'flashback' } }); assert.equal(c2.attrs['data-flash-look'], undefined, 'no flags at all: off');
});
await test('the files: the look is in shows.css behind data-flash-look only, the module is in the GM bundle and not on the display, and it names no campaign', () => {
  const css = fs.readFileSync(path.join(ROOT, 'app', 'display', 'shows.css'), 'utf8');
  assert.ok(/\.dp-root\[data-flash-look\]::after \{[^}]*Earlier/.test(css)); assert.ok(!/\.dp-root::(before|after)/.test(css));
  const routes = fs.readFileSync(path.join(ROOT, 'app', 'routes.js'), 'utf8');
  const gm = routes.split('\n').find((l) => /^\s*gm:/.test(l)), disp = routes.split('\n').find((l) => /^\s*display:/.test(l));
  assert.ok(gm.includes("'gm/map-flashback.js'") && !disp.includes('map-flashback'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
