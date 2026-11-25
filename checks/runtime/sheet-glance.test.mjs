// sheet-glance (RK31 of the room key build: the glance screen on a player's phone, phone.glance). No browser, no network.
// The pure parts of app/sheet/glance.js: the fit steps, the harm cost line, the chip clamp, the undo stack, what a change is called, what Undo puts
// back (never a deadlock), deadlock to 0, the foot's strip; and the seam in tracker.js (one line, the four-screen sheet waits on it).
//   node checks/runtime/sheet-glance.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/sheet/glance.js';
const G = require(path.join(ROOT, FILE)), P = G.Pure;
const CT = (() => { const sb = {}; sb.window = sb; sb.self = sb; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'app/content.js'), 'utf8'), sb); return sb.B68Content; })();
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const hound = CT.byId.hound, hull = CT.byId.hull, ghost = CT.byId.ghost, vamp = CT.byId.vampire, tt = CT.byId.timetraveler;

test('the module: under Node and as a plain script (window.B68SheetGlance), no stub left; not started, apply() takes nothing', () => {
  assert.deepEqual(Object.keys(G).sort(), ['Pure', 'apply', 'start', 'state', 'stop', 'teardown']);
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, FILE), 'utf8'), win, { filename: FILE });
  const M = win.B68SheetGlance;
  assert.ok(M && typeof M.apply === 'function' && !M.stub);
  assert.equal(M.apply({}, { play: {} }), false, 'not started: the sheet is today\'s');
  assert.equal(M.state().on, false);
});

test('the cost line: none, a die per level held (the levels summed), Mortal; the Hull says damage', () => {
  assert.deepEqual(P.cost({ l1: ['', ''], l2: ['', ''], l3: '', l4: '' }, hound), { kind: 'none', dice: 0, text: 'No harm' });
  assert.equal(P.cost({ l1: ['Winded', ''], l2: ['Cracked ribs', ''], l3: '', l4: '' }, hound).text, 'Effect may drop · 3d complications after');
  assert.equal(P.cost({ l1: ['a', 'b'], l2: ['c', 'd'], l3: 'e', l4: '' }, hound).dice, 9);
  const m = P.cost({ l1: ['', ''], l2: ['', ''], l3: '', l4: 'Shot' }, hound);
  assert.equal(m.kind, 'mortal'); assert.equal(m.text, 'Mortal: you die without help, fast');
  assert.equal(P.cost({}, hull).text, 'No damage');
  assert.equal(P.cost({ l1: ['  ', ''], l2: [], l3: ' ', l4: '' }, hound).kind, 'none', 'blank words hold no harm');
  assert.deepEqual(P.harmList({ l1: ['x', ''], l2: ['y', 'z'], l3: '', l4: 'w' }), [[4, 'w'], [2, 'y'], [2, 'z'], [1, 'x']]);
});

test('the fit steps: the first that does not overflow, else the last (c1, c2, c2 with one chip row)', () => {
  assert.deepEqual(P.STEPS.map((s) => s.c + ':' + s.rows), [':2', 'gl-c1:2', 'gl-c2:2', 'gl-c2:1']);
  assert.equal(P.pickStep(() => false), 0);
  assert.equal(P.pickStep((i) => i < 1), 1);
  assert.equal(P.pickStep((i) => i < 2), 2);
  assert.equal(P.pickStep(() => true), 3);
  const tried = []; P.pickStep((i) => { tried.push(i); return i < 2; });
  assert.deepEqual(tried, [0, 1, 2], 'it stops at the first that fits');
  assert.equal(P.pickStep(() => false, 2), 2, 'a ResizeObserver refit starts from the step it has: it only steps further down, so it cannot flip-flop');
});

test('the chip clamp: all when they fit; else as many as fit with "+n more" on the rows allowed; a long name takes a row', () => {
  const more = () => 90;
  assert.equal(P.clampChips([150, 170, 90], 358, 6, 2, more), 3, 'three on two rows');
  assert.equal(P.clampChips([150, 170, 90], 343, 6, 1, more), 1, 'one row at 343: one chip and "+2 more"');
  assert.equal(P.clampChips([120, 120, 120, 120, 120, 120], 358, 6, 2, more), 4, 'six of 120 on two rows of 358: four and "+2 more"');
  assert.equal(P.clampChips([400, 100], 358, 6, 2, more), 2, 'a chip wider than the row is clamped to it and takes a row of its own');
  assert.equal(P.clampChips([400, 100], 358, 6, 1, more), 0, 'and on one row only "+2 more" is left');
  assert.equal(P.clampChips([], 358, 6, 2, more), 0);
  assert.equal(P.rowsFor([100, 100, 100], 312, 6), 1);
  assert.equal(P.rowsFor([100, 100, 100], 300, 6), 2);
});

test('the undo stack: the last 20, the newest on top; the bar stays 6 s', () => {
  const u = new P.Undo(P.KEEP);
  for (let i = 0; i < 25; i++) u.push('Stress ' + i, '{"stress":' + i + '}', 1000 + i);
  assert.equal(u.items.length, 20); assert.equal(P.KEEP, 20);
  assert.equal(u.list()[0].label, 'Stress 24'); assert.equal(u.list()[19].label, 'Stress 5');
  assert.equal(u.pop().label, 'Stress 24'); assert.equal(u.top().label, 'Stress 23'); assert.equal(u.items.length, 19);
  u.clear(); assert.equal(u.pop(), null);
  assert.equal(P.BAR_MS, 6000);
});

test('what a change is called; a change to the log alone is not one', () => {
  const b = { stress: 6, harm: { l1: ['', ''], l2: ['', ''], l3: '', l4: '' }, keys: [{ name: 'KEY-1', hits: 1 }], log: [], xpHold: 0, healing: 0 };
  const a = (o) => Object.assign(JSON.parse(JSON.stringify(b)), o);
  assert.equal(P.diffLabel(b, a({ stress: 7 }), hound), 'Stress 6 → 7');
  assert.equal(P.diffLabel(b, a({ stress: 8 }), hull), 'Drain 6 → 8');
  assert.equal(P.diffLabel(b, a({ harm: { l1: ['x', ''], l2: ['', ''], l3: '', l4: '' } }), hound), 'Harm updated');
  assert.equal(P.diffLabel(b, a({ log: [{ text: 'a roll' }] }), hound), '', 'the log is the audit trail, not an undoable change');
  assert.equal(P.diffLabel(b, a({ keys: [{ name: 'KEY-1', hits: 2 }], xpHold: 1, keyHitSession: { 0: true } }), hound), 'KEY-1 1 → 2 hits · Unspent xp 0 → 1');
  assert.equal(P.diffLabel(b, a({ keys: [{ name: 'KEY-1', hits: 1, deadlock: 'down' }] }), hound), 'Deadlocked KEY-1');
  assert.equal(P.diffLabel(b, a({ notes: 'x' }), hound), 'Sheet changed');
  assert.equal(P.diffLabel(b, a({ stress: 7, healing: 1, xpHold: 2 }), hound), 'Stress 6 → 7 · Healing 0 → 1 · …');
  assert.ok(P.permanent(b, a({ keys: [{ name: 'KEY-1', hits: 1, deadlock: 'up' }] })) && P.permanent({ roboticDeadlocks: [] }, { roboticDeadlocks: ['x'] }) && !P.permanent(b, a({ stress: 2 })));
});

test('Undo puts the play back in place, but never clears a deadlock, a glitch or a robotic deadlock', () => {
  const before = { stress: 9, keys: [{ name: 'KEY-1', deadlock: null, glitch: null }, { name: 'KEY-2', deadlock: null, glitch: null }], roboticDeadlocks: [], harm: { l3: '' } };
  const live = { stress: 0, keys: [{ name: 'KEY-1', deadlock: 'down', glitch: null }, { name: 'KEY-2', deadlock: null, glitch: 'G-1' }], roboticDeadlocks: ['R-1'], harm: { l3: 'x' }, extra: 1 };
  const same = live;
  P.restore(live, JSON.stringify(before));
  assert.equal(live, same, 'in place: the sheet keeps its own object');
  assert.equal(live.stress, 9); assert.equal(live.harm.l3, ''); assert.ok(!('extra' in live));
  assert.equal(live.keys[0].deadlock, 'down'); assert.equal(live.keys[1].glitch, 'G-1'); assert.deepEqual(live.roboticDeadlocks, ['R-1']);
});

test('a deadlock resets Stress to 0 (the design §6); the Hull and the paranormal playbooks keep their own rules', () => {
  const p = { stress: 9 };
  assert.deepEqual(P.afterDeadlock(p, hound), { from: 9, to: 0 }); assert.equal(p.stress, 0);
  assert.equal(P.afterDeadlock({ stress: 0 }, hound), null, 'nothing to reset');
  for (const pb of [hull, ghost, vamp, tt]) { const q = { stress: 5 }; assert.equal(P.afterDeadlock(q, pb), null, pb.id); assert.equal(q.stress, 5); }
  assert.ok(P.resets(hound) && P.resets(CT.byId.paranormalist) && !P.resets(hull) && !P.resets(ghost));
});

test('the playbooks\' tracks: Drain 10, Stress 12, Instability 9; what the stress block counts', () => {
  assert.deepEqual([hound, hull, vamp, tt, ghost].map((pb) => P.stressName(pb) + ' ' + P.stressMax(pb)), ['Stress 9', 'Drain 10', 'Stress 12', 'Instability 9', 'Drain 10']);
  assert.equal(P.struck({ keys: [{ deadlock: 'down' }, { glitch: 'x' }, {}] }, hound), 1);
  assert.equal(P.struck({ keys: [{ deadlock: 'down' }, { glitch: 'x' }] }, tt), 1, 'a Time Traveler counts glitches');
  assert.equal(P.struck({ keys: [{ deadlock: 'down' }], roboticDeadlocks: ['a', 'b'] }, hull), 3, 'a Hull counts its robotic deadlocks too');
  assert.equal(P.resistDice({ dots: { Hunt: 1, Study: 2, Survey: 0 }, darkMajesty: null }, hound, 'Insight', CT.ACTIONS), 2);
  assert.equal(P.resistDice({ dots: { Hunt: 1 }, darkMajesty: 'Insight' }, vamp, 'Insight', CT.ACTIONS), 2, 'Dark Majesty adds one');
});

test('the foot\'s strip: the first of commendations, the Debrief, the packet, a key to turn (the Now card\'s order); the rest wait in Table', () => {
  assert.deepEqual(P.FOOT, ['commend', 'debrief', 'absent', 'keys']);
  let f = P.footSplit([{ id: 'commend' }, { id: 'debrief' }, { id: 'mission' }]);
  assert.equal(f.strip.id, 'commend'); assert.deepEqual(f.rest.map((x) => x.id), ['debrief', 'mission']);
  f = P.footSplit([{ id: 'mission' }, { id: 'keys' }]);
  assert.equal(f.strip.id, 'keys'); assert.deepEqual(f.rest.map((x) => x.id), ['mission'], 'the mission card waits in Table');
  f = P.footSplit([]); assert.equal(f.strip, null);
});

test('the seam: tracker.js meets the glance in one line, and the four-screen sheet is not drawn while it has the sheet', () => {
  const T = fs.readFileSync(path.join(ROOT, 'app/tracker.js'), 'utf8').split('\n');
  const g = T.filter((l) => /B68SheetGlance/.test(l)), t = T.filter((l) => /B68SheetTabs/.test(l));
  assert.equal(g.length, 1); assert.ok(/^\s*var gl = !cur\.ui\.static && !!window\.B68SheetGlance && typeof window\.B68SheetGlance\.apply === 'function' && window\.B68SheetGlance\.apply\(cur\.root, \{/.test(g[0]));
  assert.ok(/\}\) === true;/.test(g[0]), 'only a true answer takes the sheet');
  assert.equal(t.length, 1); assert.ok(/^\s*if \(!gl && window\.B68SheetTabs/.test(t[0]));
  assert.equal(T[T.indexOf(g[0]) + 1], t[0], 'the two lines sit together, after the draw');
});

test('no book text and no request: ability texts come from the sheet\'s data, the harm rule from the rules search', () => {
  const src = fs.readFileSync(path.join(ROOT, FILE), 'utf8'), code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon/.test(code));
  assert.ok(/R\.hits\('harm', 1\)/.test(code) && /R\.entry\(/.test(code), 'the harm rule opens from B68Rules.hits()');
  for (const pb of [hound, hull, vamp, ghost, tt]) for (const a of pb.abilities) assert.ok(!a[1] || src.indexOf(a[1].slice(0, 40)) < 0, 'no ability text in the file: ' + a[0]);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
