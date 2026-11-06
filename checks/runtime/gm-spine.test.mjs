// Unit test for the spine tickets: the phases in minutes (app/gm/phase-rail.js, 1.1), the curfew's rules (app/gm/curfew.js, 1.5) and the one hook between them and
// the page (app/gm/spine.js). Their face is the band (app/gm/band.js, checks/runtime/gm-band.test.mjs). The Workshop's first cuts (1.9) went with the Workshop in N0. No browser, no network: a small fake page stands in for the DOM.
//   node checks/runtime/gm-spine.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const Night = require(path.join(ROOT, 'app', 'gm', 'night.js'));
const Tools = require(path.join(ROOT, 'app', 'gm', 'tools.js'));
const Rail = require(path.join(ROOT, 'app', 'gm', 'phase-rail.js'));
const Curfew = require(path.join(ROOT, 'app', 'gm', 'curfew.js'));
const Spine = require(path.join(ROOT, 'app', 'gm', 'spine.js'));
const WS = require(path.join(ROOT, 'app', 'gm', 'workshop.js'));
const F = require(path.join(ROOT, 'app', 'features.js'));

let failed = 0, passed = 0;
async function test(name, fn) {
  Tools.reset();
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}

/* ---- a fake page: just enough element for the curfew's Next ▸ watch ---- */
function cls() { const s = new Set(); return { s, add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c), toggle: (c) => (s.has(c) ? s.delete(c) : s.add(c)) }; }
class El {
  constructor(tag, doc) { this.tagName = tag; this.ownerDocument = doc; this.attrs = {}; this.children = []; this.parentNode = null; this.html = ''; this.listeners = {}; this.classList = cls(); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  set className(v) { this.attrs.class = v; }
  set id(v) { this.attrs.id = v; }
  get id() { return this.attrs.id || ''; }
  get nextSibling() { const p = this.parentNode; return p ? p.children[p.children.indexOf(this) + 1] || null : null; }
  get firstChild() { return this.children[0] || null; }
  set innerHTML(v) { this.html = String(v); }
  get innerHTML() { return this.html; }
  appendChild(n) { n.parentNode = this; this.children.push(n); return n; }
  insertBefore(n, ref) { if (n.parentNode) n.parentNode.removeChild(n); n.parentNode = this; const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(n); else this.children.splice(i, 0, n); return n; }
  removeChild(n) { const i = this.children.indexOf(n); if (i >= 0) this.children.splice(i, 1); n.parentNode = null; return n; }
  addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
  removeEventListener(t, fn) { this.listeners[t] = (this.listeners[t] || []).filter((x) => x !== fn); }
  querySelector(sel) {
    const walk = (n) => { for (const c of n.children) { if (match(c, sel)) return c; const r = walk(c); if (r) return r; } return null; };
    return walk(this);
  }
}
function match(el, sel) { if (sel[0] === '#') return el.id === sel.slice(1); if (sel[0] === '.') return (el.attrs.class || '').split(/\s+/).includes(sel.slice(1)); return false; }
function page() {
  const doc = { body: new El('body', null), createElement: (t) => new El(t, doc), getElementById: () => null };
  doc.body.ownerDocument = doc;
  const root = new El('div', doc); root.id = 'gm-root';
  const bar = new El('div', doc); bar.className = 'gm-bar'; root.appendChild(bar);
  const tab = new El('div', doc); tab.className = 'gm-main'; root.appendChild(tab);
  return { doc, root };
}
/* a click on a button that carries `attr` = `value` (what closest() finds); a bare click on something else is { closest: () => null } */
function click(el, attr, value, opts = {}) {
  const hit = attr ? { getAttribute: (a) => (a === attr ? value : null) } : null;
  const ev = { target: { closest: (sel) => (hit && sel.includes(attr) ? hit : (opts.beat && sel.includes('beat-next') ? {} : null)) }, stopped: false, prevented: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  (el.listeners.click || []).slice().forEach((fn) => fn(ev));
  return ev;
}
const MIN = 60000;
const T0 = new Date(2026, 10, 7, 19, 30, 0).getTime();       /* a Saturday evening, 19:30 */
function ctl(initial = {}, clock = { t: T0 }) {
  const state = { doc: { night: initial } };
  const N = Night.create({ doc: () => state.doc, patch: (p) => { state.doc = { night: mergeNight(state.doc.night, p.night) }; return true; }, now: () => clock.t, changed: () => {} });
  return { N, state, clock };
}
function mergeNight(a, b) {
  const out = JSON.parse(JSON.stringify(a || {}));
  const m = (x, y) => { Object.keys(y).forEach((k) => { if (y[k] && typeof y[k] === 'object' && !Array.isArray(y[k])) { x[k] = x[k] && typeof x[k] === 'object' ? x[k] : {}; m(x[k], y[k]); } else if (y[k] === null) delete x[k]; else x[k] = y[k]; }); };
  m(out, b); return out;
}

/* ---- 1.1 the phases in minutes (the band's chips draw them: checks/runtime/gm-band.test.mjs) ---- */
await test('model: four phases in order; the one in play shows minutes against its budget; amber at 80%, red when over', () => {
  const night = { phase: 'plan', phases: { pb: { budget: 40, start: T0, end: T0 + 40 * MIN }, plan: { budget: 20, start: T0 + 40 * MIN, end: null }, score: { budget: 90 }, after: {} } };
  const at = (m) => Rail.model(night, T0 + (40 + m) * MIN);
  assert.deepEqual(at(0).items.map((i) => i.id), ['pb', 'plan', 'score', 'after']);
  assert.deepEqual(at(0).items.map((i) => i.state), ['done', 'now', 'next', 'next']);
  assert.equal(at(5).items[1].text, '5 / 20 min'); assert.equal(at(5).items[1].tone, '');
  assert.equal(at(15).items[1].tone, ''); assert.equal(at(16).items[1].tone, 'amber', '80% of 20 is 16');
  assert.equal(at(20).items[1].tone, 'amber', 'at the budget is not yet over'); assert.equal(at(21).items[1].tone, 'red');
  assert.equal(at(0).items[0].text, '40 min', 'a finished phase shows what it took');
  assert.equal(at(0).items[2].text, '90 min', 'a phase to come shows its budget');
  assert.equal(Rail.model({}, T0).phase, ''); assert.ok(Rail.model(null, T0).items.every((i) => i.state === 'next'));
});
await test('model: Back is a plain move: the earlier phase is "now" again, the later ones next', () => {
  const night = { phase: 'pb', phases: { pb: { start: T0 + 50 * MIN, end: null, budget: 30 }, plan: { start: T0 + 30 * MIN, end: T0 + 50 * MIN } } };
  assert.deepEqual(Rail.model(night, T0 + 55 * MIN).items.map((i) => i.state), ['now', 'next', 'next', 'next']);
});
await test('the rail filters nothing (N1b: the places lay out each phase\'s tools): no filterFor, no All tools, nothing set on the tool registry', () => {
  assert.equal(Rail.filterFor, undefined); assert.equal(Rail._setAll, undefined);
  assert.equal(Tools.setFilter, undefined, 'the registry has no filter to set');
});
await test('the rail draws nothing any more: the band holds the places (no bar, no "All tools", no tool filter of its own)', () => {
  assert.deepEqual(Object.keys(Rail).sort(), ['PHASES', 'model', 'toneOf']);
  const src = require('node:fs').readFileSync(path.join(ROOT, 'app', 'gm', 'phase-rail.js'), 'utf8');
  assert.ok(!/createElement|insertBefore|innerHTML|setFilter/.test(src), 'no DOM and no filter in the file');
});

/* the modules read their neighbours from the window they were built on: give them one */
function withWindow(extra, fn) {
  const w = Object.assign({ B68GmTools: Tools, B68GmNight: Night, B68GmWorkshop: WS, B68GmPhaseRail: Rail, B68GmCurfew: Curfew, B68Features: F }, extra);
  return fn(w);
}
function loadMods(w) {
  /* the factories take the window: re-evaluate each file against it so its registry reads go to the fake */
  const fs = require('node:fs');
  const make = (f) => { const src = fs.readFileSync(path.join(ROOT, 'app', 'gm', f), 'utf8'); const m = { exports: {} }; new Function('module', 'self', 'require', src + '\n//# sourceURL=' + f)(m, w, require); return m.exports; };
  w.B68GmPhaseRail = make('phase-rail.js'); w.B68GmCurfew = make('curfew.js'); w.B68GmSpine = make('spine.js');
  return w;
}

/* ---- 1.5 the curfew (its face is the band's second row: gm-band.test.mjs) ---- */
await test('curfew state: warn from 30 minutes before, due at the curfew, snoozed ten minutes once, idle without a phase, in the Aftermath or with no curfew', () => {
  const n = (extra) => Object.assign({ phase: 'score', curfewAt: '22:40', phases: { score: { start: T0 } } }, extra);
  const at = (h, m) => new Date(2026, 10, 7, h, m, 0).getTime();
  assert.equal(Curfew.state(n(), at(22, 9), null), 'idle'); assert.equal(Curfew.state(n(), at(22, 10), null), 'warn'); assert.equal(Curfew.state(n(), at(22, 39), null), 'warn');
  assert.equal(Curfew.state(n(), at(22, 40), null), 'due');
  const s = Curfew.snoozed(null, Curfew.nightKey(n()), at(22, 41));
  assert.equal(Curfew.state(n(), at(22, 45), s), 'snoozed'); assert.equal(Curfew.state(n(), at(22, 51), s), 'due', 'the snooze ends');
  assert.equal(Curfew.snoozed(s, Curfew.nightKey(n()), at(22, 52)), null, 'once only');
  assert.equal(Curfew.state(n({ phase: '' }), at(23, 0), null), 'idle'); assert.equal(Curfew.state(n({ phase: 'after' }), at(23, 0), null), 'idle'); assert.equal(Curfew.state(n({ curfewAt: null }), at(23, 0), null), 'idle');
  const late = n({ curfewAt: '00:30', phases: { score: { start: at(21, 0) } } });
  assert.equal(Curfew.state(late, at(22, 0), null), 'idle'); assert.equal(Curfew.state(late, new Date(2026, 10, 8, 0, 31).getTime(), null), 'due', 'a curfew after midnight is the next day\'s');
});
await test('curfew controller: one toast at curfew minus 30; view() says due at the curfew; snooze once; Call the Aftermath goes through the places (host.callAftermath), and no event is fired that nothing hears', () => {
  const sent = []; const w = loadMods(withWindow({ dispatchEvent: (e) => sent.push(e), CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o.detail; } } }, (x) => x));
  const { root } = page(), c = ctl({ phase: 'score', curfewAt: '22:40', phases: { score: { start: T0 } } }), toasts = [], calls = []; let mem = null;
  const cf = w.B68GmCurfew.create({ root: () => root, night: () => c.N, now: () => c.clock.t, toast: (m) => toasts.push(m), store: { get: () => mem, set: (v) => { mem = v; } },
    callAftermath: () => { calls.push(c.clock.t); c.N.enter('after'); return true; } });
  const at = (h, m) => new Date(2026, 10, 7, h, m, 0).getTime();
  c.clock.t = at(22, 5); cf.sync(); assert.equal(toasts.length, 0); assert.equal(cf.view().state, 'idle'); assert.equal(cf.view().at, '22:40');
  c.clock.t = at(22, 12); cf.sync(); cf.sync(); assert.equal(toasts.length, 1, 'the warning is said once'); assert.ok(/22:40/.test(toasts[0])); assert.equal(cf.view().state, 'warn');
  c.clock.t = at(22, 40); cf.sync(); assert.equal(cf.view().state, 'due'); assert.equal(cf.view().used, false); assert.equal(root.children.length, 2, 'nothing is drawn into the page: the band draws it');
  assert.equal(cf.snooze(), true); assert.equal(cf.view().state, 'snoozed');
  c.clock.t = at(22, 51); assert.equal(cf.view().state, 'due'); assert.equal(cf.view().used, true, 'only one snooze'); assert.equal(cf.snooze(), false);
  assert.equal(cf.call(), true); assert.deepEqual(calls, [at(22, 51)], 'the places\' call'); assert.equal(c.N.phase(), 'after'); assert.equal(sent.length, 0, 'no b68:aftermath event');
  assert.equal(cf.view().state, 'idle', 'in the Aftermath the curfew is done'); assert.ok(toasts.includes('Aftermath.'));
  cf.destroy();
});
await test('curfew: without the places, Call the Aftermath enters it on the night alone; a refused call changes nothing', () => {
  const w = loadMods(withWindow({}, (x) => x)); const { root } = page(), c = ctl({ phase: 'score', curfewAt: '22:40', phases: { score: { start: T0 } } });
  const cf = w.B68GmCurfew.create({ root: () => root, night: () => c.N, now: () => new Date(2026, 10, 7, 22, 45).getTime(), toast() {}, store: { get: () => null, set() {} } });
  assert.equal(cf.view().state, 'due'); assert.equal(cf.call(), true); assert.equal(c.N.phase(), 'after');
  const c2 = ctl({ phase: 'score', curfewAt: '22:40', phases: { score: { start: T0 } } });
  const cf2 = w.B68GmCurfew.create({ root: () => root, night: () => c2.N, now: () => new Date(2026, 10, 7, 22, 45).getTime(), toast() {}, store: { get: () => null, set() {} }, callAftermath: () => false });
  assert.equal(cf2.call(), false); assert.equal(c2.N.phase(), 'score');
});
await test('curfew: the next Next ▸ press, while the curfew is due, moves to the Aftermath instead; before the curfew it is left alone', () => {
  const w = loadMods(withWindow({}, (x) => x)); const { root } = page(), c = ctl({ phase: 'score', curfewAt: '22:40', phases: { score: { start: T0 } } });
  const cf = w.B68GmCurfew.create({ root: () => root, night: () => c.N, now: () => c.clock.t, toast() {}, store: { get: () => null, set() {} } });
  c.clock.t = new Date(2026, 10, 7, 22, 20).getTime(); cf.sync();
  let ev = click(root, null, null, { beat: true }); assert.equal(ev.prevented, false); assert.equal(c.N.phase(), 'score');
  c.clock.t = new Date(2026, 10, 7, 22, 41).getTime(); cf.sync();
  ev = click(root, null, null, { beat: true }); assert.equal(ev.prevented, true); assert.equal(ev.stopped, true); assert.equal(c.N.phase(), 'after');
});

await test('curfew memory belongs to the night: the next week same curfew warns again and has its snooze back; Keep running lets Next ▸ through', () => {
  const w = loadMods(withWindow({}, (x) => x)); let mem = null; const toasts = [];
  const store = { get: () => mem, set: (v) => { mem = v; } };
  const run = (day) => {
    const { root } = page(), start = new Date(2026, 10, day, 19, 30).getTime(), clock = { t: start };
    const c = ctl({ phase: 'score', curfewAt: '22:40', phases: { score: { start } } }, clock);
    const cf = w.B68GmCurfew.create({ root: () => root, night: () => c.N, now: () => clock.t, toast: (m) => toasts.push(m), store });
    return { root, clock, c, cf, at: (h, m) => new Date(2026, 10, day, h, m).getTime() };
  };
  let n = run(7); n.clock.t = n.at(22, 12); n.cf.sync(); assert.equal(toasts.length, 1);
  n.clock.t = n.at(22, 41); n.cf.sync(); assert.equal(n.cf.snooze(), true);
  n.clock.t = n.at(22, 55); n.cf.sync(); assert.equal(n.cf.view().used, true, 'used tonight');
  n.cf.destroy();
  n = run(14); n.clock.t = n.at(22, 12); n.cf.sync(); assert.equal(toasts.length, 2, 'warned again a week later');
  n.clock.t = n.at(22, 41); n.cf.sync(); assert.equal(n.cf.view().used, false, 'a fresh snooze');
  assert.equal(n.cf.keep(), true); assert.equal(n.cf.view().state, 'kept', 'Keep running: not due any more');
  const ev = click(n.root, null, null, { beat: true }); assert.equal(ev.prevented, false, 'Next ▸ works as normal after Keep running'); assert.equal(n.c.N.phase(), 'score');
  n.cf.destroy();
});

/* ---- 1.9 the Workshop: gone (N0) ---- */
await test('the Workshop\'s first cuts are gone (N0): spine.tick registers no Workshop tool and sets no class on the page, even with a stored spine.workshop', () => {
  const w = loadMods(withWindow({ setInterval: () => 7, clearInterval() {} }, (x) => x)); const { root, doc } = page();
  const c = ctl(), flags = { 'spine.workshop': true };
  w.B68GmSpine.tick({ root: () => root, night: () => c.N, now: () => c.clock.t, toast() {}, on: (id) => flags[id] === true, layer: () => Promise.resolve({}) });
  assert.equal(Tools.workshop, undefined, 'no Workshop list in the registry'); assert.ok(!doc.body.classList.contains('ws-away'));
  assert.equal(F.get('spine.workshop'), null, 'the line is gone from the registry'); assert.equal(F.valueOf({ features: { 'spine.workshop': true } }, 'spine.workshop'), false, 'and a stored value is never read');
  assert.deepEqual(Object.keys(w.B68GmSpine._state()).sort(), ['band', 'curfew', 'timer']);
  w.B68GmSpine.reset();
});

/* ---- the hook ---- */
await test('spine.tick (a host that says off, which the page no longer does: its on() is the registry, always on): every line off does nothing at all; a line runs only its own part; off takes it back, the iPad band included; nothing is drawn into the page', async () => {
  const w = loadMods(withWindow({ setInterval: () => 7, clearInterval() {} }, (x) => x)); const { root } = page();
  const c = ctl(), layers = []; const flags = {};
  const host = { root: () => root, night: () => c.N, now: () => c.clock.t, toast() {}, on: (id) => flags[id] === true, layer: (p, v) => { layers.push([p, v]); return Promise.resolve({}); } };
  w.B68GmSpine.tick(host); assert.deepEqual(w.B68GmSpine._state(), { curfew: false, band: undefined, timer: false }); assert.equal(root.children.length, 2); assert.equal(layers.length, 0);
  flags['spine.rail'] = true; w.B68GmSpine.tick(host);
  assert.equal(root.children.length, 2, 'nothing drawn into the page'); assert.deepEqual(layers, [['band.phase', null]], 'no phase yet: the band is cleared, not lit');
  c.N.enter('plan'); w.B68GmSpine.tick(host); assert.deepEqual(layers[layers.length - 1], ['band.phase', 'plan'], 'the band is told the phase, nothing more');
  assert.ok(!JSON.stringify(layers).match(/\d{6,}/), 'no time goes to the iPad');
  const n = layers.length; w.B68GmSpine.tick(host); assert.equal(layers.length, n, 'unchanged: nothing is sent again');
  c.N.enter('score'); w.B68GmSpine.tick(host); assert.deepEqual(layers[layers.length - 1], ['band.phase', 'score']);
  flags['spine.rail'] = false; w.B68GmSpine.tick(host);
  assert.deepEqual(layers[layers.length - 1], ['band.phase', null], 'off: the band is cleared');
  assert.equal(w.B68GmSpine._state().timer, false);
  flags['spine.curfew'] = true; w.B68GmSpine.tick(host);
  assert.equal(w.B68GmSpine._state().timer, true); assert.ok(w.B68GmSpine.curfew() && typeof w.B68GmSpine.curfew().view === 'function', 'the band reads the curfew from here');
  w.B68GmSpine.reset();
  /* the page's own host: on(id) is the registry, so with NOTHING stored both are built */
  const real = { ...host, on: (id) => F.valueOf({}, id) }; const p2 = page();
  real.root = () => p2.root; w.B68GmSpine.tick(real);
  assert.equal(w.B68GmSpine._state().curfew, true, 'the page with nothing stored: the curfew is watching'); assert.equal(w.B68GmSpine._state().band, 'score', 'and the iPad band is told the night\'s phase');
  w.B68GmSpine.reset();
});
await test('a reload never takes the iPad\'s phase down: before the page\'s night controller is there nothing is written; then the band follows night.phase', async () => {
  const w = loadMods(withWindow({ setInterval: () => 7, clearInterval() {} }, (x) => x)); const { root } = page();
  const c = ctl(), layers = []; let night = null;
  c.N.enter('score');
  const host = { root: () => root, night: () => night, now: () => c.clock.t, toast() {}, on: (id) => id === 'spine.rail', layer: (p, v) => { layers.push([p, v]); return Promise.resolve({}); } };
  w.B68GmSpine.reset(); w.B68GmSpine.tick(host);
  assert.deepEqual(layers, [], 'the first tick after a load, with no night controller yet: no band.phase write (it used to send null)');
  night = c.N; w.B68GmSpine.tick(host);
  assert.deepEqual(layers, [['band.phase', 'score']], 'the night is known: the band says its phase, and nothing was cleared first');
  w.B68GmSpine.reset();
});
await test('spine.rail and spine.curfew are registered GM-only, in the spine stage, and ON whatever is stored (N0); spine.workshop is gone', () => {
  for (const id of ['spine.rail', 'spine.curfew']) {
    const s = F.get(id); assert.ok(s, id); assert.equal(s.surface, 'gm'); assert.equal(s.default, false); assert.equal(s.saturday, 'on'); assert.equal(s.stage, 'spine');
    assert.equal(F.valueOf({}, id), true); assert.equal(F.valueOf({ features: { [id]: false } }, id), true, id + ': a stored false is still on');
  }
  assert.equal(F.get('spine.workshop'), null);
  assert.ok(!F.publicIds().some((i) => ['spine.rail', 'spine.curfew'].includes(i)), 'neither reaches the campaign document');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
