// gm-room-state (RK08.4, room.key / room.tables): the room-state contract, app/gm/room-state.js, the only code that reads or writes the GM
// state's `roomstate` key. Driven through a rig that is the page's own write path: gm-page.js's applyPatch (the page applies a patch at
// once) and mergePatch (the saver merges what is pending), and the server's deepMerge (functions/_lib/http.js). INVENTED data only (the
// Pelican Rooms; GM-ONLY- markers). The shape; rollKeys; same-named rooms (#1, #2); one rollKey a patch; the caps with the oldest dropped;
// a table change dropping gone slugs with the note; two quick writes never losing one (and a random sweep of page, saver and server);
// nothing written while off; an unknown v left alone; Deploy 41's (1ad1ba3) merge code keeping the key. No browser, no network.
//   node checks/runtime/gm-room-state.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/room-state.js';
const RS = require(path.join(ROOT, FILE));
const RT = require(path.join(ROOT, 'app', 'gm', 'room-things.js'));
const PP = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
const { deepMerge } = await import(pathToFileURL(path.join(ROOT, 'functions', '_lib', 'http.js')).href);
const clone = (v) => JSON.parse(JSON.stringify(v));
const T0 = Date.parse('2026-11-22T09:00:00.000Z');
const iso = (s) => new Date(T0 + s * 1000).toISOString();
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const SITE = 'a:The Pelican Rooms', SEED = 3141592;

/* the page, its saver and the server: doc is what the page holds, ref every patch applied in order (what the GM was shown), server the D1 row */
function rig(o = {}) {
  const r = { on: o.on !== false, part: o.part == null ? 'p1' : o.part, t: T0, doc: clone(o.doc || {}), pending: null, patches: [], toasts: [], refuse: false };
  r.ref = clone(r.doc); r.server = clone(r.doc);
  r.host = {
    on: () => r.on, doc: () => r.doc, now: () => (r.t += 1000), part: () => r.part, toast: (t) => r.toasts.push(t),
    patch: (p) => { if (r.refuse) return false; r.patches.push(clone(p)); r.doc = PP.applyPatch(r.doc, p); r.ref = PP.applyPatch(r.ref, p); r.pending = r.pending ? PP.mergePatch(r.pending, p) : clone(p); return true; },
  };
  r.rs = RS.create(r.host);
  r.flush = () => { if (r.pending) { r.server = deepMerge(r.server, r.pending); r.pending = null; } r.doc = clone(r.server); return r.server; };
  return r;
}
const rooms = (doc, rk) => doc.roomstate.keys[rk].rooms;

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

test('gm-room-state: loads under Node and as a plain script (window.B68GmRoomState), no longer a stub; the contract is written at the top', () => {
  assert.equal(RS.stub, undefined);
  assert.equal(RS.V, 1); assert.equal(RS.NOTE, 'tables changed');
  assert.deepEqual(RS.CAPS, { rolls: 24, rooms: 40, blades: 12, extra: 10, swaps: 10, marks: 20, kept: 12, bytes: 48 * 1024, tomb: 4000 });
  const api = Object.keys(RS.create({})).sort();
  assert.deepEqual(api, ['addExtra', 'addKept', 'clear', 'on', 'prune', 'read', 'roll', 'setBlade', 'setExtra', 'setMark', 'setSay', 'setSwap', 'stale'].sort());
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, FILE), 'utf8'), win, { filename: FILE });
  assert.equal(typeof win.B68GmRoomState.create, 'function');
  const head = fs.readFileSync(path.join(ROOT, FILE), 'utf8').split('(function (root, factory)')[0];
  for (const w of ['THE ROOM-STATE CONTRACT', 'roomstate = { v: 1, at, keys: { <rollKey>: { part, at, rooms: { <roomKey>: {', 'RS.prune(partVersion, known, rollKey?)', 'Caps: 24 rolls']) assert.ok(head.includes(w), w);
});

test('the shape: one write of each kind gives exactly the contract\'s document; reads give the cleaned copy', () => {
  const r = rig(), rs = r.rs, [s1, s2] = RS.roomKeys(['Showroom', 'Showroom']);
  assert.ok(rs.setMark(SEED, s1, 'brass-umbrella-stand', 'Empty'));
  assert.ok(rs.setSwap(SEED, s1, 'velvet-rope', 'grand-piano'));
  assert.ok(rs.addExtra(SEED, s1, 'stage-curtain'));
  assert.ok(rs.setSay(SEED, s1, 2));
  assert.ok(rs.addKept(SEED, s1, 'npc_mabel_quist_k3x9'));
  assert.ok(rs.setBlade(SEED, s2, { say: 'GM-ONLY-blade: the lights flicker twice.', things: [{ name: 'A tin whistle', line: 'dented', look: 'GM-ONLY-look: a name scratched on it', tags: ['clue', 'bogus'] }], people: ['"Evening, all."'] }));
  assert.deepEqual(r.doc, { roomstate: { v: 1, at: iso(6), keys: { [String(SEED)]: { part: 'p1', at: iso(6), rooms: {
    'showroom#1': { marks: { 'brass-umbrella-stand': 'empty' }, swaps: { 'velvet-rope': 'grand-piano' }, extra: ['stage-curtain'], say: 2, kept: ['npc_mabel_quist_k3x9'] },
    'showroom#2': { blade: { at: iso(6), say: 'GM-ONLY-blade: the lights flicker twice.', people: ['"Evening, all."'],
      things: [{ name: 'A tin whistle', line: 'dented', look: 'GM-ONLY-look: a name scratched on it', roll: '', danger: '', states: [], tags: ['clue'] }] } } } } } } });
  assert.deepEqual(rs.read(SEED, s1), { say: 2, extra: ['stage-curtain'], swaps: { 'velvet-rope': 'grand-piano' }, marks: { 'brass-umbrella-stand': 'empty' }, blade: null, kept: ['npc_mabel_quist_k3x9'] });
  assert.equal(rs.read(SEED, s2).blade.things[0].slug, 'tin-whistle', 'a Blade thing reads with its slug (stored without)');
  assert.deepEqual(rs.read(SEED, 'nowhere#1'), { say: null, extra: [], swaps: {}, marks: {}, blade: null, kept: [] }, 'nothing stored: the empty room');
  assert.deepEqual(rs.roll(SEED), { part: 'p1', at: iso(6), rooms: { 'showroom#1': rs.read(SEED, s1), 'showroom#2': rs.read(SEED, s2) } });
  assert.equal(rs.roll('404'), null);
  const copy = rs.read(SEED, s1); copy.marks.x = 'y'; copy.extra.push('z'); assert.deepEqual(rs.read(SEED, s1).extra, ['stage-curtain'], 'a read is a copy');
  /* store overrides only: outside the Blade entry every string is a slug, a state, an id, a time or a part version */
  const strs = []; (function walk(v, inBlade) { if (typeof v === 'string') { if (!inBlade) strs.push(v); } else if (v && typeof v === 'object') Object.entries(v).forEach(([k, x]) => walk(x, inBlade || k === 'blade')); })(r.doc.roomstate, false);
  assert.ok(strs.every((s) => /^[a-z0-9-]+$/.test(s) || ISO.test(s) || s === 'p1' || s === 'empty' || /^npc_/.test(s)), strs.join(' '));
});

test('rollKey: the page\'s own (a seed, or a: + an authored site), for saved, unsaved and hand-written sites; never sites."<key>"', () => {
  assert.equal(PP.rollKey({ seed: SEED, name: 'The Pelican Rooms' }), SEED); assert.equal(PP.rollKey({ auth: 'The Pelican Rooms' }), SITE);
  const r = rig();
  assert.ok(r.rs.setMark(PP.rollKey({ seed: SEED }), 'showroom#1', 'a', 'on'));
  assert.ok(r.rs.setMark(PP.rollKey({ auth: 'The Pelican Rooms' }), 'showroom#1', 'a', 'off'));
  assert.ok(r.rs.setMark('77', 'showroom#1', 'a', 'on'));
  assert.deepEqual(Object.keys(r.doc.roomstate.keys).sort(), [String(SEED), '77', SITE].sort());
  assert.equal(r.rs.read(String(SEED), 'showroom#1').marks.a, 'on', 'a number and its string are the same key');
  assert.ok(r.patches.every((p) => Object.keys(p).join() === 'roomstate'), 'only roomstate is ever patched: no sites, no cards');
  for (const bad of [null, undefined, '', '  ', NaN, {}, [], 'x'.repeat(81)]) assert.equal(r.rs.setMark(bad, 'showroom#1', 'a', 'on'), false, String(bad));
});

test('roomKey: normRoom(name) + #n, n counting same-named rooms from 1 (names repeat within a site); each is its own room', () => {
  assert.deepEqual(RS.roomKeys(['Showroom', 'Cocktail lounge', 'The showroom', 'SHOWROOM!', 5, '', 'Cocktail lounge']), ['showroom#1', 'cocktail lounge#1', 'showroom#2', 'showroom#3', '', '', 'cocktail lounge#2']);
  assert.equal(RS.roomKey('The Showroom', 2), 'showroom#2'); assert.equal(RS.roomKey('Showroom'), 'showroom#1');
  for (const bad of [[''], ['!!!'], ['Showroom', 0], ['Showroom', 1.5], ['Showroom', 100]]) assert.equal(RS.roomKey(...bad), '', JSON.stringify(bad));
  const r = rig();
  assert.ok(r.rs.setMark(SEED, 'showroom#1', 'a', 'open')); assert.ok(r.rs.setMark(SEED, 'showroom#2', 'a', 'shut'));
  assert.deepEqual([r.rs.read(SEED, 'showroom#1').marks.a, r.rs.read(SEED, 'showroom#2').marks.a], ['open', 'shut']);
  for (const bad of ['showroom', 'showroom#0', 'showroom#100', '#1', ' #1', 'a#b#1', 5]) assert.equal(r.rs.setMark(SEED, bad, 'a', 'on'), false, String(bad));
});

test('each write is one patch touching one rollKey; a no-op sends nothing; a room left empty goes, and so does a roll left with no rooms', () => {
  const r = rig();
  r.rs.setMark(SEED, 'showroom#1', 'a', 'on'); r.rs.setMark('77', 'bar#1', 'b', 'on'); r.rs.setMark(SEED, 'showroom#1', 'a', 'off');
  assert.equal(r.patches.length, 3);
  assert.ok(r.patches.every((p) => Object.keys(p.roomstate.keys).length === 1), 'one rollKey each');
  assert.deepEqual(r.patches[2], { roomstate: { v: 1, at: iso(3), keys: { [String(SEED)]: { at: iso(3), rooms: { 'showroom#1': { marks: { a: 'off' } } } } } } }, 'the smallest patch: one leaf, the two times');
  assert.ok(r.rs.setMark(SEED, 'showroom#1', 'a', 'off')); assert.equal(r.patches.length, 3, 'the same mark again: true, nothing sent');
  assert.ok(r.rs.setMark(SEED, 'showroom#1', 'a', null)); assert.equal(r.doc.roomstate.keys[String(SEED)], undefined, 'the last mark gone: the room, then the roll');
  assert.ok(r.rs.setMark(SEED, 'showroom#1', 'zz', null)); assert.equal(r.patches.length, 4, 'taking away what is not there sends nothing');
  r.rs.setMark('77', 'bar#2', 'c', 'on'); assert.ok(r.rs.clear('77', 'bar#1'));
  assert.deepEqual(Object.keys(rooms(r.doc, '77')), ['bar#2'], 'clear removes the room, the roll stays for its other room');
  assert.ok(r.rs.setSwap('77', 'bar#2', 'c', 'd') && r.rs.setSwap('77', 'bar#2', 'c', null)); assert.equal(rooms(r.doc, '77')['bar#2'].swaps, undefined, 'a map left empty goes');
  assert.ok(r.rs.setExtra('77', 'bar#2', ['x', 'y', 'x'])); assert.deepEqual(rooms(r.doc, '77')['bar#2'].extra, ['x', 'y']);
  assert.ok(r.rs.setExtra('77', 'bar#2', [])); assert.equal(rooms(r.doc, '77')['bar#2'].extra, undefined);
  assert.ok(r.rs.setSay('77', 'bar#2', 0)); assert.equal(rooms(r.doc, '77')['bar#2'].say, 0, 'say 0 is a say');
  assert.ok(r.rs.setSay('77', 'bar#2', null)); assert.equal(rooms(r.doc, '77')['bar#2'].say, undefined);
});

test('bad arguments are refused and send nothing', () => {
  const r = rig();
  const no = [() => r.rs.setMark(SEED, 'a#1', 'Not A Slug', 'on'), () => r.rs.setMark(SEED, 'a#1', 'a', ''), () => r.rs.setMark(SEED, 'a#1', 'a', '   '), () => r.rs.setMark(SEED, 'a#1', '__proto__', 'on'),
    () => r.rs.setSay(SEED, 'a#1', 10), () => r.rs.setSay(SEED, 'a#1', -1), () => r.rs.setSay(SEED, 'a#1', 1.5), () => r.rs.setSay(SEED, 'a#1', '1'),
    () => r.rs.setSwap(SEED, 'a#1', 'a', 'a'), () => r.rs.setSwap(SEED, 'a#1', 'a', 'B'), () => r.rs.setSwap(SEED, 'a#1', 'x'.repeat(41), 'b'),
    () => r.rs.addExtra(SEED, 'a#1', ''), () => r.rs.setExtra(SEED, 'a#1', ['ok', 'Not ok']), () => r.rs.setExtra(SEED, 'a#1', 'a'),
    () => r.rs.addKept(SEED, 'a#1', 'npc mabel'), () => r.rs.addKept(SEED, 'a#1', 'x'.repeat(65)), () => r.rs.addKept(SEED, 'a#1', 7),
    () => r.rs.setBlade(SEED, 'a#1', 'text'), () => r.rs.setBlade(SEED, 'a#1', {}), () => r.rs.setBlade(SEED, 'a#1', { say: '   ', things: [{ line: 'no name' }], people: [''] })];
  no.forEach((f, i) => assert.equal(f(), false, 'case ' + i));
  assert.equal(r.patches.length, 0);
  assert.ok(r.rs.setMark(SEED, 'a#1', 'a', '  Half\nOpen  ')); assert.equal(r.rs.read(SEED, 'a#1').marks.a, 'half open', 'a state is one line, lower case');
  assert.ok(r.rs.setMark(SEED, 'a#1', 'b', 'x'.repeat(30))); assert.equal(r.rs.read(SEED, 'a#1').marks.b, 'x'.repeat(24));
});

test('caps: 24 rolls, and a 25th drops the oldest by at (a write refreshes a roll); 40 rooms a roll, the 41st refused; room lists capped', () => {
  const r = rig();
  for (let i = 1; i <= 24; i++) assert.ok(r.rs.setMark('roll-' + i, 'bar#1', 'a', 'on'));
  assert.ok(r.rs.setMark('roll-1', 'bar#1', 'b', 'on'), 'roll-1 used again: now roll-2 is the oldest');
  assert.ok(r.rs.setMark('roll-25', 'bar#1', 'a', 'on'));
  const keys = Object.keys(r.doc.roomstate.keys);
  assert.equal(keys.length, 24); assert.ok(!keys.includes('roll-2') && keys.includes('roll-1') && keys.includes('roll-25'));
  const last = r.patches[r.patches.length - 1].roomstate.keys;
  assert.deepEqual(Object.keys(last).sort(), ['roll-2', 'roll-25']); assert.equal(last['roll-2'], null, 'the dropped roll rides in the same patch as a null');
  const q = rig();
  for (let i = 1; i <= 40; i++) assert.ok(q.rs.setMark(SEED, 'room ' + i + '#1', 'a', 'on'));
  const n = q.patches.length;
  assert.equal(q.rs.setMark(SEED, 'room 41#1', 'a', 'on'), false); assert.equal(q.patches.length, n, 'refused: nothing sent');
  assert.match(q.toasts[0], /at most 40 rooms/);
  assert.ok(q.rs.setMark(SEED, 'room 40#1', 'b', 'on'), 'a room already kept still takes changes');
  assert.ok(q.rs.clear(SEED, 'room 1#1') && q.rs.setMark(SEED, 'room 41#1', 'a', 'on'), 'a cleared room makes space');
  const c = rig();
  for (let i = 0; i < 10; i++) { assert.ok(c.rs.addExtra(SEED, 'a#1', 'e' + i)); assert.ok(c.rs.setSwap(SEED, 'a#1', 's' + i, 't' + i)); }
  for (let i = 0; i < 20; i++) assert.ok(c.rs.setMark(SEED, 'a#1', 'm' + i, 'on'));
  for (let i = 0; i < 12; i++) assert.ok(c.rs.addKept(SEED, 'a#1', 'npc_' + i));
  assert.deepEqual([c.rs.addExtra(SEED, 'a#1', 'e10'), c.rs.setSwap(SEED, 'a#1', 's10', 't'), c.rs.setMark(SEED, 'a#1', 'm20', 'on'), c.rs.addKept(SEED, 'a#1', 'npc_12'), c.rs.setExtra(SEED, 'a#1', Array.from({ length: 11 }, (_, i) => 'x' + i))], [false, false, false, false, false]);
  assert.deepEqual([c.rs.addExtra(SEED, 'a#1', 'e3'), c.rs.setSwap(SEED, 'a#1', 's3', 'u3'), c.rs.setMark(SEED, 'a#1', 'm3', 'off'), c.rs.addKept(SEED, 'a#1', 'npc_3')], [true, true, true, true], 'changing one already there is fine');
});

const BLADE = (i) => ({ say: 'GM-ONLY-blade ' + i + ': ' + 'w'.repeat(400), people: ['"' + 'p'.repeat(130) + '"', 'two', 'three', 'four'],
  things: [1, 2, 3].map((k) => ({ name: 'A thing ' + k + ' ' + 'n'.repeat(40), line: 'l'.repeat(90), look: 'GM-ONLY-look ' + 'o'.repeat(120), roll: 'GM-ONLY-roll ' + 'r'.repeat(160), danger: 'GM-ONLY-danger ' + 'd'.repeat(100), states: ['on', 'off'], tags: ['clue'] })) });

test('the Blade entry: the one stored text, capped (say 300, 2 things at the thing limits, 3 people of 120); 12 a roll, the oldest dropped', () => {
  const r = rig();
  assert.ok(r.rs.setBlade(SEED, 'bar#1', BLADE(0)));
  const b = r.doc.roomstate.keys[String(SEED)].rooms['bar#1'].blade;
  assert.equal(b.say.length, 300); assert.equal(b.things.length, 2); assert.equal(b.people.length, 3); assert.equal(b.people[0].length, 120);
  assert.deepEqual(b.things.map((t) => [t.name.length, t.line.length, t.look.length, t.roll.length, t.danger.length]), [[40, 80, 120, 160, 100], [40, 80, 120, 160, 100]]);
  assert.ok(b.things.every((t) => !('slug' in t)), 'stored without slugs');
  assert.ok(r.rs.setBlade(SEED, 'bar#1', { say: 'Shorter.' }));
  assert.deepEqual(r.doc.roomstate.keys[String(SEED)].rooms['bar#1'].blade, { at: iso(2), say: 'Shorter.' }, 'a new answer replaces the whole entry, no old things left');
  assert.ok(r.rs.setBlade(SEED, 'bar#1', null)); assert.equal(r.doc.roomstate.keys[String(SEED)], undefined);
  const q = rig();
  for (let i = 1; i <= 12; i++) assert.ok(q.rs.setBlade(SEED, 'room ' + i + '#1', { say: 'Line ' + i }));
  assert.ok(q.rs.setMark(SEED, 'room 1#1', 'a', 'on'));
  assert.ok(q.rs.setBlade(SEED, 'room 13#1', { say: 'Line 13' }));
  const rm = rooms(q.doc, String(SEED));
  assert.equal(Object.values(rm).filter((x) => x.blade).length, 12);
  assert.ok(!rm['room 1#1'].blade && rm['room 1#1'].marks.a === 'on', 'the oldest Blade entry went; its room keeps its mark');
  assert.ok(q.rs.setBlade(SEED, 'room 14#1', { say: 'Line 14' }));
  assert.equal(rooms(q.doc, String(SEED))['room 2#1'], undefined, 'the next oldest went, and its room with it (nothing else in it)');
  assert.ok(q.rs.setBlade(SEED, 'room 5#1', { say: 'Line 5 again' }), 'replacing one of the twelve drops nothing');
  assert.equal(Object.values(rooms(q.doc, String(SEED))).filter((x) => x.blade).length, 12);
});

test('the byte budget: roomstate stays within 48 KiB; past it the oldest Blade entries anywhere go first; with none to drop, the write is refused', () => {
  const r = rig(), sizes = [];
  for (let i = 0; i < 40; i++) { assert.ok(r.rs.setBlade('roll-' + (i % 20), 'bar ' + i + '#1', BLADE(i)), 'blade ' + i); sizes.push(Buffer.byteLength(JSON.stringify(r.doc.roomstate))); }
  assert.ok(Math.max(...sizes) <= 48 * 1024, 'never past the budget: ' + Math.max(...sizes));
  const all = Object.values(r.doc.roomstate.keys).flatMap((k) => Object.values(k.rooms)).map((x) => x.blade.say.slice(0, 16));
  assert.ok(all.length < 40 && all.includes('GM-ONLY-blade 39'), 'the newest is kept: ' + all.length + ' entries');
  assert.ok(!all.includes('GM-ONLY-blade 0'), 'the oldest went');
  const q = rig();
  for (let i = 0; i < 24; i++) for (let j = 0; j < 40; j++) q.rs.setExtra('roll-' + i, 'a room with a long long name ' + j + '#1', Array.from({ length: 10 }, (_, k) => 'a-very-long-slug-for-thing-number-' + k));
  assert.ok(Buffer.byteLength(JSON.stringify(q.doc.roomstate)) <= 48 * 1024);
  assert.ok(q.toasts.some((t) => /room notes are full/.test(t)), 'refused, and said so');
});

test('prune(partVersion, known): a table change drops the overrides on slugs that are gone, moves part, and says "tables changed"', () => {
  const r = rig();
  r.rs.setMark(SEED, 'bar#1', 'a', 'open'); r.rs.setMark(SEED, 'bar#1', 'b', 'shut'); r.rs.setSwap(SEED, 'bar#1', 'a', 'c'); r.rs.setSwap(SEED, 'bar#1', 'b', 'a');
  r.rs.addExtra(SEED, 'bar#1', 'd'); r.rs.setSay(SEED, 'bar#1', 1); r.rs.addKept(SEED, 'bar#1', 'npc_1');
  r.rs.setMark(SEED, 'cellar#1', 'gone', 'on');
  r.rs.setMark('other', 'bar#1', 'a', 'on');
  assert.equal(r.rs.stale(SEED), false);
  r.part = 'p2';
  assert.equal(r.rs.stale(SEED), true); assert.equal(r.rs.stale('404'), false);
  const n = r.patches.length;
  const seen = [];
  const res = r.rs.prune('p2', (rk, rm) => { seen.push(rk + '|' + rm); return rk === String(SEED) ? (rm === 'bar#1' ? ['a', 'c'] : []) : null; });
  assert.deepEqual(res, { rolls: 1, dropped: 4, note: 'tables changed' });
  assert.deepEqual(r.rs.read(SEED, 'bar#1'), { say: 1, extra: [], swaps: { a: 'c' }, marks: { a: 'open' }, blade: null, kept: ['npc_1'] }, 'b, the b->a swap and the extra d are gone; say and kept stay');
  assert.equal(rooms(r.doc, String(SEED))['cellar#1'], undefined, 'a room left with nothing goes');
  assert.equal(r.doc.roomstate.keys[String(SEED)].part, 'p2'); assert.equal(r.rs.stale(SEED), false);
  assert.equal(r.doc.roomstate.keys.other.part, 'p1', 'known gave null for the other roll: left as it is');
  assert.equal(r.patches.length, n + 1, 'one patch for the one roll');
  assert.equal(r.toasts.length, 1); assert.match(r.toasts[0], /tables changed: 4 room changes/i);
  assert.deepEqual(seen.sort(), [String(SEED) + '|bar#1', String(SEED) + '|cellar#1', 'other|bar#1'].sort());
  assert.deepEqual(r.rs.prune('p2', () => ['a']), { rolls: 1, dropped: 0, note: '' }, 'the other roll: nothing gone, only its part moves');
  assert.equal(r.doc.roomstate.keys.other.part, 'p2'); assert.equal(r.toasts.length, 1, 'no toast when nothing was dropped');
  const m = r.patches.length;
  assert.deepEqual(r.rs.prune('p2', () => []), { rolls: 0, dropped: 0, note: '' }); assert.equal(r.patches.length, m, 'the same part: nothing to do');
  r.part = 'p3'; r.rs.prune('p3', () => [], 'other');
  assert.equal(r.doc.roomstate.keys.other, undefined, 'only the roll named; left empty, it goes');
  assert.equal(r.doc.roomstate.keys[String(SEED)].part, 'p2');
  assert.deepEqual(r.rs.prune('p3', 'not a function'), { rolls: 0, dropped: 0, note: '' });
  assert.deepEqual(r.rs.prune('p3', () => { throw new Error('boom'); }), { rolls: 0, dropped: 0, note: '' }, 'a known() that throws is unknown');
});

test('two quick writes never lose one: both marks reach the server in the one merged PATCH', () => {
  const r = rig();
  assert.ok(r.rs.setMark(SEED, 'bar#1', 'a', 'open')); assert.ok(r.rs.setMark(SEED, 'bar#1', 'b', 'shut'));
  assert.ok(r.rs.setSwap(SEED, 'bar#2', 'c', 'd')); assert.ok(r.rs.addExtra(SEED, 'bar#1', 'e')); assert.ok(r.rs.addExtra(SEED, 'bar#1', 'f'));
  r.flush();
  assert.deepEqual(r.server.roomstate.keys[String(SEED)].rooms, { 'bar#1': { marks: { a: 'open', b: 'shut' }, extra: ['e', 'f'] }, 'bar#2': { swaps: { c: 'd' } } });
});

test('a room cleared and written again before the saver sends keeps the clear (the saver would merge "null R, then set R.x" into "set R.x")', () => {
  const r = rig();
  r.rs.setMark(SEED, 'bar#1', 'a', 'open'); r.rs.setSwap(SEED, 'bar#1', 'x', 'y'); r.rs.setBlade(SEED, 'bar#1', { say: 'Old.', people: ['old'] }); r.flush();
  assert.ok(r.rs.clear(SEED, 'bar#1')); assert.ok(r.rs.setMark(SEED, 'bar#1', 'b', 'on'));
  r.flush();
  assert.deepEqual(r.server.roomstate.keys[String(SEED)].rooms['bar#1'], { marks: { b: 'on' } }, 'no old mark, swap or Blade entry came back');
  /* the same for a roll dropped by the cap and written again in the same window */
  const q = rig();
  for (let i = 1; i <= 24; i++) q.rs.setMark('roll-' + i, 'bar#1', 'old', 'on');
  q.flush();
  q.rs.setMark('roll-25', 'bar#1', 'a', 'on'); q.rs.setMark('roll-1', 'bar#1', 'new', 'on');
  q.flush();
  assert.deepEqual(q.server.roomstate.keys['roll-1'].rooms['bar#1'].marks, { new: 'on' }, 'the dropped roll came back without its old mark');
  assert.deepEqual(q.server.roomstate, q.ref.roomstate);
});

/* a random sweep: the page, its saver and the server agree after every send, whatever the order of writes and sends */
function mulberry32(a) { return function () { a |= 0; a = a + 0x6d2b79f5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
test('a random sweep (6 seeds x 1,500 writes, sends at random): the server always holds exactly what the page showed, within the caps', () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const rnd = mulberry32(seed), pick = (a) => a[Math.floor(rnd() * a.length)], r = rig();
    const RK = Array.from({ length: 28 }, (_, i) => 'k' + i), RM = ['bar#1', 'bar#2', 'cellar#1'], SL = ['a', 'b', 'c', 'd'], ST = ['on', 'off', null];
    for (let i = 0; i < 1500; i++) {
      const rk = pick(RK.slice(0, seed % 2 ? 28 : 4)), rm = pick(RM), op = Math.floor(rnd() * 9);
      if (op === 0) r.rs.setMark(rk, rm, pick(SL), pick(ST));
      else if (op === 1) r.rs.setSwap(rk, rm, pick(SL), rnd() < 0.3 ? null : pick(['x', 'y']));
      else if (op === 2) r.rs.addExtra(rk, rm, pick(SL));
      else if (op === 3) r.rs.setExtra(rk, rm, rnd() < 0.5 ? [] : [pick(SL)]);
      else if (op === 4) r.rs.setSay(rk, rm, rnd() < 0.3 ? null : Math.floor(rnd() * 3));
      else if (op === 5) r.rs.setBlade(rk, rm, rnd() < 0.4 ? null : { say: 'S' + i, things: rnd() < 0.5 ? [{ name: 'A t' + i }] : [], people: rnd() < 0.5 ? ['p' + i] : [] });
      else if (op === 6) r.rs.addKept(rk, rm, 'npc_' + Math.floor(rnd() * 3));
      else if (op === 7) r.rs.clear(rk, rm);
      else { r.part = pick(['p1', 'p2']); r.rs.prune(r.part, () => SL.slice(0, 2 + Math.floor(rnd() * 2))); }
      if (rnd() < 0.25) { r.flush(); assert.deepEqual(r.server.roomstate || null, r.ref.roomstate || null, 'seed ' + seed + ', write ' + i); }
    }
    r.flush(); assert.deepEqual(r.server.roomstate || null, r.ref.roomstate || null, 'seed ' + seed + ' at the end');
    const ks = Object.keys(r.server.roomstate ? r.server.roomstate.keys : {});
    assert.ok(ks.length <= 24, 'seed ' + seed + ': ' + ks.length + ' rolls');
    const sets = (v) => v !== null && (typeof v !== 'object' || Object.values(v).some(sets));
    assert.ok(r.patches.every((p) => Object.values(p.roomstate.keys).filter(sets).length <= 1), 'seed ' + seed + ': each patch sets values in one rollKey at most (others only take nulls)');
  }
});

test('nothing is written while off (room.key and room.tables both off): every write is false and the page\'s patch is never called; reads still work', () => {
  const r = rig({ on: false, doc: { roomstate: { v: 1, at: iso(0), keys: { [String(SEED)]: { part: 'p1', at: iso(0), rooms: { 'bar#1': { marks: { a: 'open' } } } } } } } });
  const before = clone(r.doc);
  const all = [r.rs.setMark(SEED, 'bar#1', 'b', 'on'), r.rs.setSwap(SEED, 'bar#1', 'a', 'b'), r.rs.addExtra(SEED, 'bar#1', 'c'), r.rs.setExtra(SEED, 'bar#1', ['c']), r.rs.setSay(SEED, 'bar#1', 1),
    r.rs.setBlade(SEED, 'bar#1', { say: 'x' }), r.rs.addKept(SEED, 'bar#1', 'npc_1'), r.rs.clear(SEED, 'bar#1')];
  assert.deepEqual(all, all.map(() => false));
  assert.deepEqual(r.rs.prune('p2', () => []), { rolls: 0, dropped: 0, note: '' });
  assert.equal(r.patches.length, 0); assert.deepEqual(r.doc, before); assert.equal(r.rs.on(), false);
  assert.equal(r.rs.read(SEED, 'bar#1').marks.a, 'open', 'a read works off');
  assert.equal(RS.create({ doc: () => ({}), patch: () => { throw new Error('called'); } }).setMark(SEED, 'bar#1', 'a', 'on'), false, 'a host with no on() is off');
  assert.equal(RS.create({ on: () => { throw new Error('x'); }, patch: () => { throw new Error('called'); } }).setMark(SEED, 'bar#1', 'a', 'on'), false, 'an on() that throws is off');
  r.on = true; assert.ok(r.rs.setMark(SEED, 'bar#1', 'b', 'on')); assert.equal(r.patches.length, 1, 'and on again, it writes');
});

test('a roomstate with another v (a later build\'s) is read as empty and never written; a refused page patch is false', () => {
  const later = { roomstate: { v: 2, at: iso(0), keys: { [String(SEED)]: { rooms: { 'bar#1': { marks: { a: 'open' } } } } } } };
  const r = rig({ doc: later });
  assert.deepEqual(r.rs.read(SEED, 'bar#1').marks, {}); assert.equal(r.rs.roll(SEED), null);
  assert.equal(r.rs.setMark(SEED, 'bar#1', 'b', 'on'), false); assert.equal(r.patches.length, 0); assert.deepEqual(r.doc, later);
  const q = rig(); q.refuse = true;
  assert.equal(q.rs.setMark(SEED, 'bar#1', 'a', 'on'), false); q.refuse = false;
  assert.ok(q.rs.setMark(SEED, 'bar#1', 'a', 'on'));
  const junk = rig({ doc: { roomstate: { v: 1, keys: { [String(SEED)]: { part: 'p1', rooms: { 'bar#1': { marks: { a: 'open', 'Bad Key': 'x', b: 7, c: '' }, extra: 'x', swaps: { a: 'B' }, kept: ['ok_1', 'bad id', 'ok_1'], say: 12, blade: 'x' } } } } } } });
  assert.deepEqual(junk.rs.read(SEED, 'bar#1'), { say: null, extra: [], swaps: {}, marks: { a: 'open' }, blade: null, kept: ['ok_1'] }, 'malformed values are left out of a read');
  assert.ok(junk.rs.setMark(SEED, 'bar#1', 'a', 'shut'));
});

/* Deploy 41 (1ad1ba3) is what a rollback runs: its page's merge code and its server's must keep roomstate while they save other things */
function atCommit(rev, rel, ext) {
  const r = spawnSync('git', ['show', rev + ':' + rel], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-rk08-')), f = path.join(dir, path.basename(rel, path.extname(rel)) + ext);
  fs.writeFileSync(f, r.stdout);
  return { f, dir };
}
const OLD = 'Deploy 41 (1ad1ba3)';
const oldPage = atCommit('1ad1ba3', 'app/gm-page.js', '.js'), oldHttp = atCommit('1ad1ba3', 'functions/_lib/http.js', '.mjs');
const OP = oldPage ? require(oldPage.f)._pure : null, OH = oldHttp ? await import(pathToFileURL(oldHttp.f).href) : null;
for (const x of [oldPage, oldHttp]) if (x) try { fs.rmSync(x.dir, { recursive: true, force: true }); } catch (e) { /* harmless */ }
test('rollback: ' + OLD + '\'s page and server merge code keep a stored roomstate while they save other things', () => {
  if (!OP || !OH) { console.log('  (skipped: git cannot show 1ad1ba3)'); return; }
  const r = rig();
  r.rs.setMark(SEED, 'bar#1', 'a', 'open'); r.rs.setBlade(SITE, 'showroom#1', { say: 'GM-ONLY-blade: kept.' }); r.flush();
  const stored = clone(r.server.roomstate);
  let page = clone(r.server), server = clone(r.server);
  const saves = [{ cards: { location: OP.replacePatch(page.cards && page.cards.location, { hid: 'h1', seed: 99, ui: {}, mem: '{}', label: 'x', at: iso(9) }) } },
    { features: { 'map.shade': true } }, { pins: OP.addCapped(page.pins, 'p1', { text: 'a pin', at: iso(10) }, 50) }, { capture: { c1: { id: 'c1', bucket: 'n', text: 'a line', at: iso(11) } } }];
  let pending = null;
  for (const p of saves) { page = OP.applyPatch(page, p); pending = pending ? OP.mergePatch(pending, p) : clone(p); }
  server = OH.deepMerge(server, pending);
  assert.deepEqual(page.roomstate, stored, 'the old page keeps it'); assert.deepEqual(server.roomstate, stored, 'the old server keeps it');
  assert.equal(server.features['map.shade'], true); assert.equal(server.cards.location.seed, 99, 'and saved the other things');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
