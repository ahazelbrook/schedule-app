// Unit test for the spine tickets: the phase rail (app/gm/phase-rail.js, 1.1), the curfew (app/gm/curfew.js, 1.5), the Workshop's first cuts
// (app/gm/workshop-first.js, 1.9) and the one hook between them and the page (app/gm/spine.js). No browser, no network: a small fake page stands in for the DOM.
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
const WSF = require(path.join(ROOT, 'app', 'gm', 'workshop-first.js'));
const Spine = require(path.join(ROOT, 'app', 'gm', 'spine.js'));
const WS = require(path.join(ROOT, 'app', 'gm', 'workshop.js'));
const F = require(path.join(ROOT, 'app', 'features.js'));

let failed = 0, passed = 0;
async function test(name, fn) {
  Tools.reset(); Rail._setAll(false);
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}

/* ---- a fake page: just enough element for the rail and the curfew bar ---- */
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

/* ---- 1.1 the rail ---- */
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
await test('filterFor: on only with a phase in play; "All tools" is the same as off for the tool registry', () => {
  assert.deepEqual(Rail.filterFor('plan', true, false), { on: true, phase: 'plan', all: false });
  assert.deepEqual(Rail.filterFor('', true, false), { on: false, phase: '', all: false });
  Tools.setFilter(Rail.filterFor('plan', true, false)); assert.equal(Tools.visible('score'), true); assert.equal(Tools.visible('chase'), false);
  Tools.setFilter(Rail.filterFor('plan', true, true)); assert.equal(Tools.visible('chase'), true, 'All tools overrides');
});
await test('the bar: four chips and All tools; a tap enters the phase through the night controller; the phase filter follows within the same sync', () => {
  const { root } = page(), c = ctl();
  const rail = Rail.create({ root: () => root, night: () => c.N, now: () => c.clock.t });
  rail.sync();
  const el = rail.el(); assert.equal(root.children[1], el, 'inserted right after the top bar');
  assert.equal((el.innerHTML.match(/data-rail="(pb|plan|score|after)"/g) || []).length, 4); assert.ok(/data-rail="all"/.test(el.innerHTML));
  click(el, 'data-rail', 'plan'); assert.equal(c.N.phase(), 'plan');
  c.clock.t += 5 * MIN; rail.sync(); assert.ok(/data-state="now"/.test(el.innerHTML));
  click(el, 'data-rail', 'pb'); assert.equal(c.N.phase(), 'pb', 'Back is allowed');
});

/* the rail reads gm/tools.js from the window it was built on: give it one */
function withWindow(extra, fn) {
  const w = Object.assign({ B68GmTools: Tools, B68GmNight: Night, B68GmWorkshop: WS, B68GmPhaseRail: Rail, B68GmCurfew: Curfew, B68GmWorkshopFirst: WSF, B68Features: F }, extra);
  return fn(w);
}
function loadMods(w) {
  /* the factories take the window: re-evaluate each file against it so its DOM and registry reads go to the fake */
  const fs = require('node:fs');
  const make = (f, name) => { const src = fs.readFileSync(path.join(ROOT, 'app', 'gm', f), 'utf8'); const m = { exports: {} }; new Function('module', 'self', 'require', src + '\n//# sourceURL=' + f)(m, w, require); return m.exports; };
  const sp = (n) => w[n];
  void sp;
  w.B68GmPhaseRail = make('phase-rail.js'); w.B68GmCurfew = make('curfew.js'); w.B68GmWorkshopFirst = make('workshop-first.js'); w.B68GmSpine = make('spine.js');
  return w;
}

await test('the bar through the window: tapping a phase hides the other phases\' tabs (the tool filter), All tools brings them back', () => {
  const w = loadMods(withWindow({}, (x) => x)); const { root } = page(), c = ctl();
  const rail = w.B68GmPhaseRail.create({ root: () => root, night: () => c.N, now: () => c.clock.t });
  rail.sync(); click(rail.el(), 'data-rail', 'plan'); rail.sync();
  assert.equal(Tools.visible('score'), true); assert.equal(Tools.visible('chase'), false, 'Chase is a Score tool');
  assert.equal(Tools.visible('chase', { current: 'chase' }), true, 'the tab on screen is kept');
  click(rail.el(), 'data-rail', 'all'); assert.equal(Tools.visible('chase'), true);
  click(rail.el(), 'data-rail', 'all'); assert.equal(Tools.visible('chase'), false);
  rail.destroy(); assert.equal(Tools.filter().on, false, 'taken down: the filter is off again'); assert.equal(root.querySelector('#gm-phaserail'), null);
});
await test('a phase another GM device entered shows here on the next sync (the night is read live)', () => {
  const w = loadMods(withWindow({}, (x) => x)); const { root } = page(), c = ctl();
  const rail = w.B68GmPhaseRail.create({ root: () => root, night: () => c.N, now: () => c.clock.t });
  rail.sync(); assert.equal(Tools.filter().on, false);
  c.state.doc = { night: Night.enter({}, 'score', T0).night };
  rail.sync(); assert.deepEqual(Tools.filter(), { on: true, phase: 'score', all: false });
  assert.ok(/data-rail="score"[^>]*data-state="now"/.test(rail.el().innerHTML));
});

/* ---- 1.5 the curfew ---- */
await test('curfew state: warn from 30 minutes before, due at the curfew, snoozed ten minutes once, idle without a phase, in the Aftermath or with no curfew', () => {
  const n = (extra) => Object.assign({ phase: 'score', curfewAt: '22:40', phases: { score: { start: T0 } } }, extra);
  const at = (h, m) => new Date(2026, 10, 7, h, m, 0).getTime();
  assert.equal(Curfew.state(n(), at(22, 9), null), 'idle'); assert.equal(Curfew.state(n(), at(22, 10), null), 'warn'); assert.equal(Curfew.state(n(), at(22, 39), null), 'warn');
  assert.equal(Curfew.state(n(), at(22, 40), null), 'due');
  const s = Curfew.snoozed(null, '22:40', at(22, 41));
  assert.equal(Curfew.state(n(), at(22, 45), s), 'snoozed'); assert.equal(Curfew.state(n(), at(22, 51), s), 'due', 'the snooze ends');
  assert.equal(Curfew.snoozed(s, '22:40', at(22, 52)), null, 'once only');
  assert.equal(Curfew.state(n({ phase: '' }), at(23, 0), null), 'idle'); assert.equal(Curfew.state(n({ phase: 'after' }), at(23, 0), null), 'idle'); assert.equal(Curfew.state(n({ curfewAt: null }), at(23, 0), null), 'idle');
  const late = n({ curfewAt: '00:30', phases: { score: { start: at(21, 0) } } });
  assert.equal(Curfew.state(late, at(22, 0), null), 'idle'); assert.equal(Curfew.state(late, new Date(2026, 10, 8, 0, 31).getTime(), null), 'due', 'a curfew after midnight is the next day\'s');
});
await test('curfew bar: one toast at curfew minus 30; "Call the Aftermath" at the curfew; snooze once; the call moves to the Aftermath and tells the page', () => {
  const sent = []; const w = loadMods(withWindow({ dispatchEvent: (e) => sent.push(e), CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o.detail; } } }, (x) => x));
  const { root } = page(), c = ctl({ phase: 'score', curfewAt: '22:40', phases: { score: { start: T0 } } }), toasts = []; let mem = null;
  const cf = w.B68GmCurfew.create({ root: () => root, night: () => c.N, now: () => c.clock.t, toast: (m) => toasts.push(m), store: { get: () => mem, set: (v) => { mem = v; } } });
  const at = (h, m) => new Date(2026, 10, 7, h, m, 0).getTime();
  c.clock.t = at(22, 5); cf.sync(); assert.equal(toasts.length, 0); assert.equal(root.querySelector('.gm-curfew'), null);
  c.clock.t = at(22, 12); cf.sync(); cf.sync(); assert.equal(toasts.length, 1, 'the warning is said once'); assert.ok(/22:40/.test(toasts[0]));
  c.clock.t = at(22, 40); cf.sync(); const bar = root.querySelector('.gm-curfew'); assert.ok(bar); assert.ok(/Call the Aftermath/.test(bar.innerHTML)); assert.ok(/Snooze/.test(bar.innerHTML));
  click(bar, 'data-curfew', 'snooze'); assert.equal(root.querySelector('.gm-curfew'), null, 'snoozed: the bar goes');
  c.clock.t = at(22, 51); cf.sync(); const again = root.querySelector('.gm-curfew'); assert.ok(again); assert.ok(!/Snooze/.test(again.innerHTML), 'only one snooze');
  click(again, 'data-curfew', 'call'); assert.equal(c.N.phase(), 'after'); assert.equal(sent.length, 1); assert.equal(sent[0].type, 'b68:aftermath');
  assert.equal(root.querySelector('.gm-curfew'), null);
  cf.destroy();
});
await test('curfew: the next Next-beat press, while the bar is up, moves to the Aftermath instead; before the curfew it is left alone', () => {
  const w = loadMods(withWindow({}, (x) => x)); const { root } = page(), c = ctl({ phase: 'score', curfewAt: '22:40', phases: { score: { start: T0 } } });
  const cf = w.B68GmCurfew.create({ root: () => root, night: () => c.N, now: () => c.clock.t, toast() {}, store: { get: () => null, set() {} } });
  c.clock.t = new Date(2026, 10, 7, 22, 20).getTime(); cf.sync();
  let ev = click(root, null, null, { beat: true }); assert.equal(ev.prevented, false); assert.equal(c.N.phase(), 'score');
  c.clock.t = new Date(2026, 10, 7, 22, 41).getTime(); cf.sync();
  ev = click(root, null, null, { beat: true }); assert.equal(ev.prevented, true); assert.equal(ev.stopped, true); assert.equal(c.N.phase(), 'after');
});

/* ---- 1.9 the Workshop ---- */
await test('workshop: off registers nothing (the Menu has no Workshop line); on registers the five and puts the originals away; off again takes it all back', () => {
  const w = loadMods(withWindow({}, (x) => x)); const { root, doc } = page();
  let on = false; const h = { root: () => root, on: () => on, toast() {}, phoneCards: () => false, setPhoneCards() {}, mirrorOn: () => true, toggleMirror() {} };
  const ws = w.B68GmWorkshopFirst.create(h);
  const before = Tools.tabs().length; ws.sync(); assert.equal(Tools.workshop().length, 0); assert.equal(WS.menuLine(), ''); assert.ok(!doc.body.classList.contains('ws-away'));
  on = true; ws.sync(); assert.equal(Tools.workshop().length, 5); assert.ok(WS.menuLine().includes('Workshop')); assert.ok(doc.body.classList.contains('ws-away'));
  assert.deepEqual(Tools.workshop().map((t) => t.label), ['Phone mission cards', 'Costume engine', 'Screen mirror', 'Uncued co-GM', 'Screen props']);
  assert.equal(Tools.tabs().length, before, 'the tab bar is the same: the five were never tabs');
  on = false; ws.sync(); assert.equal(Tools.workshop().length, 0); assert.equal(WS.menuLine(), ''); assert.ok(!doc.body.classList.contains('ws-away'));
  const c = w.B68GmWorkshopFirst.count(before); assert.equal(c.before, before + 5); assert.equal(c.after, before);
});
await test('workshop tools: the toggles call the page\'s own functions; a reveal button flips the class that shows the original again', () => {
  const w = loadMods(withWindow({}, (x) => x)); const { root, doc } = page(); const cl = doc.body.classList.s;
  const calls = []; let pc = false;
  const ws = w.B68GmWorkshopFirst.create({ root: () => root, on: () => true, toast() {}, phoneCards: () => pc, setPhoneCards: (v) => { calls.push(['pc', v]); pc = v; }, mirrorOn: () => true, toggleMirror: () => calls.push(['mirror']) });
  ws.sync();
  const box = (id) => { const b = new El('div', doc); Tools.get(id).mount(b, {}); return b; };
  let b = box('ws-phonecards'); assert.ok(/off \(turn on\)/.test(b.innerHTML)); click(b, 'data-wsf', 'go'); assert.deepEqual(calls[0], ['pc', true]); assert.ok(/on \(turn off\)/.test(b.innerHTML));
  b = box('ws-mirror'); click(b, 'data-wsf', 'go'); assert.deepEqual(calls[1], ['mirror']);
  b = box('ws-screen'); click(b, 'data-wsf', 'go'); assert.ok(cl.has('ws-show-screen')); click(b, 'data-wsf', 'go'); assert.ok(!cl.has('ws-show-screen'));
  b = box('ws-costume'); click(b, 'data-wsf', 'go'); assert.ok(cl.has('ws-show-costume'));
  b = box('ws-cogm'); assert.ok(/Co-GM on first/.test(b.innerHTML), 'with no co-GM box on the page it says so');
  ws.destroy(); assert.ok(!cl.has('ws-show-costume'), 'taken down: the reveal classes go too');
});

/* ---- the hook ---- */
await test('spine.tick: every switch off does nothing at all; a switch builds only its own part; turning it off takes it back, the iPad band included', async () => {
  const w = loadMods(withWindow({ setInterval: () => 7, clearInterval() {} }, (x) => x)); const { root } = page();
  const c = ctl(), layers = []; const flags = {};
  const host = { root: () => root, night: () => c.N, now: () => c.clock.t, toast() {}, on: (id) => flags[id] === true, layer: (p, v) => { layers.push([p, v]); return Promise.resolve({}); }, phoneCards: () => false, setPhoneCards() {}, mirrorOn: () => true, toggleMirror() {} };
  w.B68GmSpine.tick(host); assert.deepEqual(w.B68GmSpine._state(), { rail: false, curfew: false, ws: false, band: undefined, timer: false }); assert.equal(root.children.length, 2); assert.equal(layers.length, 0); assert.equal(Tools.filter().on, false); assert.equal(Tools.workshop().length, 0);
  flags['spine.rail'] = true; w.B68GmSpine.tick(host);
  assert.ok(root.querySelector('#gm-phaserail')); assert.deepEqual(layers, [['band.phase', null]], 'no phase yet: the band is cleared, not lit');
  c.N.enter('plan'); w.B68GmSpine.tick(host); assert.deepEqual(layers[layers.length - 1], ['band.phase', 'plan'], 'the band is told the phase, nothing more');
  assert.ok(!JSON.stringify(layers).match(/\d{6,}/), 'no time goes to the iPad');
  const n = layers.length; w.B68GmSpine.tick(host); assert.equal(layers.length, n, 'unchanged: nothing is sent again');
  c.N.enter('score'); w.B68GmSpine.tick(host); assert.deepEqual(layers[layers.length - 1], ['band.phase', 'score']);
  assert.equal(Tools.filter().phase, 'score');
  flags['spine.rail'] = false; w.B68GmSpine.tick(host);
  assert.equal(root.querySelector('#gm-phaserail'), null); assert.equal(Tools.filter().on, false); assert.deepEqual(layers[layers.length - 1], ['band.phase', null], 'off: the band is cleared');
  assert.equal(w.B68GmSpine._state().timer, false);
  flags['spine.workshop'] = true; flags['spine.curfew'] = true; w.B68GmSpine.tick(host);
  assert.equal(Tools.workshop().length, 5); assert.equal(root.querySelector('#gm-phaserail'), null, 'the rail is not built by the other switches'); assert.equal(w.B68GmSpine._state().timer, true);
  w.B68GmSpine.reset(); assert.equal(Tools.workshop().length, 0);
});
await test('the three switches are registered GM-only, off, Saturday on, in the spine stage, with bland text', () => {
  for (const id of ['spine.rail', 'spine.curfew', 'spine.workshop']) {
    const s = F.get(id); assert.ok(s, id); assert.equal(s.surface, 'gm'); assert.equal(s.default, false); assert.equal(s.saturday, 'on'); assert.equal(s.stage, 'spine');
    assert.equal(F.valueOf({}, id), false); assert.equal(F.valueOf({ features: {} }, id), false);
  }
  assert.ok(!F.publicIds().some((i) => i.startsWith('spine.')), 'none of them reaches the campaign document');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
