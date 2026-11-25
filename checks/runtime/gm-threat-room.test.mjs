// gm-threat-room (RK05, night.flow): the threat marker follows the roll. No browser, no network; every name is invented (the Pelican Rooms, the Dovetail Crew).
//   room()      the Run view's selected room first, else the room most of the crew are in (a tie to the first counted)
//   stamped()   a stamp with a Who set moves that PC's marker to the roll's room, once, only for a PC and a room of the night's, and costs nothing
//   map-threat  RK05.3: a line with no threat stem is no threat with night.flow on (no log line, no glyph); off, the plain warning mark as ever
//   gm-page     the two branches are guarded by the setting and call this module; the module is in the night-flow bundle, not the display
//   node checks/runtime/gm-threat-room.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/threat-room.js';
const M = require(path.join(ROOT, FILE));
const St = require(path.join(ROOT, 'app', 'gm', 'stamp.js'));
const MT = require(path.join(ROOT, 'app', 'gm', 'map-threat.js'));
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const PCS = [{ id: 'pc1', name: 'Nell Arbuthnot' }, { id: 'pc2', name: 'Ray Okonjo' }, { id: 'pc3', name: 'Tam Petrakis' }];
const ROOMS = ['Pelican bar', 'Pelican cellar', 'Pelican roof'];
/* a fake page: the crew's rooms live in `crew`, a move writes them, as the Ball doc's crew[k].room does */
function page(o) {
  o = o || {};
  const p = { on: o.on !== false, sel: o.sel || '', crew: Object.assign({}, o.crew || {}), who: o.who || '', rooms: o.rooms || ROOMS, writes: [], logs: [], told: [], openRooms: o.openRooms || ROOMS, failMove: !!o.failMove };
  p.host = {
    feature: (id) => p.on && id === 'night.flow', sel: () => p.sel, crew: () => p.crew, pick: (c) => St.pickRoom(c), who: () => p.who, pcs: () => PCS, rooms: () => p.rooms,
    open: (r) => p.openRooms.indexOf(r) >= 0, closed: (r) => p.told.push(r),
    move: (id, room) => { if (p.failMove) return false; p.writes.push([id, room]); p.crew[id] = room; return true; }, log: (t) => p.logs.push(t)
  };
  p.c = M.create(p.host);
  return p;
}

test('the module: a plain script defines window.B68GmThreatRoom, is no stub, and names no campaign', () => {
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, FILE), 'utf8'), win, { filename: FILE });
  const W = win.B68GmThreatRoom;
  assert.ok(W && typeof W.create === 'function' && !W.stub, 'defined and filled');
  assert.equal(M.SWITCH, 'night.flow');
  const src = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
  assert.ok(src.split('\n').every((l) => !/(['"])(?:(?!\1).){221,}\1/.test(l)), 'no string literal over 220 characters');
  const bare = M.create();
  assert.ok(bare && typeof bare.room === 'function' && typeof bare.stamped === 'function', 'create() with no host still gives a controller');
  assert.equal(bare.room(), '');
  assert.equal(bare.stamped(), null);
});

test('roomOf: the selected room first, then the old pick', () => {
  assert.equal(M.roomOf('Pelican bar', { pc1: 'Pelican cellar' }, St.pickRoom), 'Pelican bar');
  assert.equal(M.roomOf('', { pc1: 'Pelican cellar' }, St.pickRoom), 'Pelican cellar');
  assert.equal(M.roomOf('  ', {}, St.pickRoom), '');
  assert.equal(M.roomOf('', { pc1: 'Pelican cellar', pc2: 'Pelican bar' }, St.pickRoom), 'Pelican cellar', 'a tie goes to the first counted');
  assert.equal(M.roomOf('', { pc1: 'Pelican cellar', pc2: 'Pelican bar', pc3: 'Pelican bar' }, St.pickRoom), 'Pelican bar', 'the room with most of the crew');
  assert.equal(M.roomOf('', null, St.pickRoom), '');
});

test('room(): a stamp in the Pelican bar with the Run view set to it is in the Pelican bar, whoever stands where', () => {
  const p = page({ sel: 'Pelican bar', crew: { pc1: 'Pelican cellar', pc2: 'Pelican cellar', pc3: 'Pelican roof' } });
  assert.equal(p.c.room(), 'Pelican bar');
  assert.equal(St.pickRoom(p.crew), 'Pelican cellar', 'the old pick would have said the cellar');
  p.sel = '';
  assert.equal(p.c.room(), 'Pelican cellar', 'nothing selected: the room most of the crew are in');
});

test('pcFor: the Who chip’s name picks one PC; an unknown or doubled name picks none', () => {
  assert.equal(M.pcFor('Ray Okonjo', PCS), 'pc2');
  assert.equal(M.pcFor('  ray   okonjo ', PCS), 'pc2');
  assert.equal(M.pcFor('Tam', PCS), 'pc3', 'a first name that is one PC’s');
  assert.equal(M.pcFor('', PCS), '');
  assert.equal(M.pcFor('Mabel Quist', PCS), '');
  assert.equal(M.pcFor('Ray Okonjo', PCS.concat([{ id: 'pcx', name: 'Ray Okonjo' }])), '', 'two PCs of one name: none');
  assert.equal(M.pcFor('Ray', PCS.concat([{ id: 'pcx', name: 'Ray Kessler' }])), '', 'a first name that is two PCs’: none');
});

test('stamped(): the roller’s marker moves to the room the threat is in, and the log says so', () => {
  const p = page({ sel: 'Pelican bar', who: 'Ray Okonjo', crew: { pc1: 'Pelican cellar', pc2: 'Pelican cellar' } });
  const r = p.c.stamped({ position: 'risky', effect: 'standard', text: 'the guard turns' });
  assert.deepEqual(r, { pc: 'pc2', room: 'Pelican bar' });
  assert.deepEqual(p.writes, [['pc2', 'Pelican bar']]);
  assert.equal(p.crew.pc1, 'Pelican cellar', 'nobody else moves');
  assert.deepEqual(p.logs, ['Marker follows the roll: Ray Okonjo to Pelican bar']);
});

test('stamped(): no room selected, the roller goes where most of the crew are; a PC with no place yet is placed', () => {
  const p = page({ who: 'Tam Petrakis', crew: { pc1: 'Pelican roof', pc2: 'Pelican roof' } });
  assert.deepEqual(p.c.stamped(), { pc: 'pc3', room: 'Pelican roof' });
});

test('stamped(): once, and for nothing that is not a PC or a room of the night', () => {
  const p = page({ sel: 'Pelican bar', who: 'Ray Okonjo', crew: { pc2: 'Pelican bar' } });
  assert.equal(p.c.stamped(), null, 'already there: no write');
  assert.deepEqual(p.writes, []);
  let q = page({ sel: 'Pelican bar', who: '' }); assert.equal(q.c.stamped(), null, 'no Who: nothing moves'); assert.deepEqual(q.writes, []);
  q = page({ sel: 'Pelican bar', who: 'Mabel Quist' }); assert.equal(q.c.stamped(), null, 'a Who that is no PC of the night'); assert.deepEqual(q.writes, []);
  q = page({ sel: 'The Lighthouse', who: 'Ray Okonjo' }); assert.equal(q.c.stamped(), null, 'a room the site does not have'); assert.deepEqual(q.writes, []);
  q = page({ who: 'Ray Okonjo' }); assert.equal(q.c.stamped(), null, 'no room selected and nobody placed: no room'); assert.deepEqual(q.writes, []);
  q = page({ sel: 'Pelican bar', who: 'Ray Okonjo', rooms: [] }); assert.ok(q.c.stamped(), 'a site with no room list known: the selected room is trusted');
  q = page({ sel: 'Pelican bar', who: 'Ray Okonjo', failMove: true }); assert.equal(q.c.stamped(), null, 'no night running: the move is refused and nothing is logged'); assert.deepEqual(q.logs, []);
});

test('stamped(): a room the players have not been shown never takes a marker; the GM is told, and the threat still lands there', () => {
  const p = page({ sel: 'Pelican cellar', who: 'Ray Okonjo', openRooms: ['Pelican bar', 'Pelican roof'], crew: { pc2: 'Pelican bar' } });
  assert.equal(p.c.room(), 'Pelican cellar', 'the glyph is GM-only and still goes to the selected room');
  assert.equal(p.c.stamped(), null);
  assert.deepEqual(p.writes, []); assert.equal(p.crew.pc2, 'Pelican bar'); assert.deepEqual(p.logs, []);
  assert.deepEqual(p.told, ['Pelican cellar'], 'told once, naming the room');
  p.sel = 'Pelican roof';
  assert.deepEqual(p.c.stamped(), { pc: 'pc2', room: 'Pelican roof' }, 'an open room takes it');
  assert.deepEqual(p.told, ['Pelican cellar']);
  const q = page({ sel: 'Pelican bar', who: 'Ray Okonjo', crew: { pc2: 'Pelican bar' } }); q.c.stamped(); assert.deepEqual(q.told, [], 'already there: nothing said');
});

test('off: nothing moves; room() still answers, so the page’s own branch decides', () => {
  const p = page({ on: false, sel: 'Pelican bar', who: 'Ray Okonjo' });
  assert.equal(p.c.stamped(), null); assert.deepEqual(p.writes, []);
  assert.equal(M.create({}).stamped(), null);
});

test('moving a marker costs nothing: the module reaches no clock, heat, show, request or storage', () => {
  const src = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
  assert.ok(!/clockOps|\.heat|\.show\(|fetch\(|XMLHttpRequest|localStorage/.test(src));
});

/* RK05.3: map-threat */
function threatHost(flow, log) {
  return { feature: (id) => id === 'map.threat' || (flow && id === 'night.flow'), room: () => 'Pelican bar', log: (t) => log.push(t), roomBox: () => null, doc: () => null };
}
test('map-threat RK05.3: with night.flow on, a line with no threat stem adds no log line and no glyph', () => {
  const log = [], c = MT.create(threatHost(true, log));
  assert.equal(c.drop({ text: 'the ceiling is thin' }), null);
  assert.deepEqual(log, []);
  assert.equal(c.view(), null);
  assert.deepEqual(c.drop({ text: 'the guard turns' }), { room: 'Pelican bar', kind: 'guard' }, 'a stem still drops its glyph');
  assert.equal(log.length, 1);
  assert.equal(c.drop({ text: 'something odd happens' }), null, 'and a later fall-through clears the glyph before it');
  assert.equal(c.view(), null);
  assert.equal(log.length, 1, 'with no new line');
});
test('map-threat RK05.3: off, the plain warning mark and its log line are as they were', () => {
  const log = [], c = MT.create(threatHost(false, log));
  assert.deepEqual(c.drop({ text: 'the ceiling is thin' }), { room: 'Pelican bar', kind: 'warn' });
  assert.deepEqual(log, ['Threat on the map: warn in Pelican bar']);
  assert.equal(MT.glyphFor('the ceiling is thin'), 'warn', 'glyphFor itself is untouched');
});
test('map-threat: the glyph and the marker agree on the room (the glyph drops where the roller lands)', () => {
  const p = page({ sel: 'Pelican bar', who: 'Ray Okonjo', crew: { pc1: 'Pelican cellar', pc2: 'Pelican cellar' } });
  const log = [], t = MT.create({ feature: () => true, room: () => p.c.room(), log: (x) => log.push(x), roomBox: () => null });
  const d = t.drop({ text: 'an alarm trips' }), m = p.c.stamped();
  assert.equal(d.room, 'Pelican bar'); assert.equal(m.room, 'Pelican bar'); assert.equal(p.crew.pc2, 'Pelican bar');
});

/* the page's two branches */
const pageJs = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
test('gm-page: b19Host.room and the threat hook take the new branch only through trInst, which needs night.flow and the bundle', () => {
  const inst = pageJs.slice(pageJs.indexOf('function trInst(me)'), pageJs.indexOf('function b19Host(me)'));
  assert.ok(inst.length > 100, 'trInst is there');
  assert.ok(/b09On\('night\.flow'\)/.test(inst) && /W\.B68GmThreatRoom/.test(inst) && /return null/.test(inst), 'guarded by the setting and the global');
  assert.ok(pageJs.includes("room: function () { var tr = trInst(me); return S === me ? (tr ? tr.room() : W.B68GmStamp.pickRoom(runCrewRooms())) : ''; }"), 'room: the new room, else the old pick');
  assert.ok(pageJs.includes('if (t) t.drop(st); var tr = trInst(me); if (tr) tr.stamped(st);'), 'threat: the drop as it was, then the marker');
  assert.ok(inst.includes('move: function (id, room) { return S === me && runMovePc(id, room) !== null; }'), 'the move is the Run view’s own write (moveCrew through the ball)');
  assert.ok(inst.includes('S.b19Model') && !inst.includes('S.locRoll'), 'the rooms are the Run view’s own, not the Location roll’s');
  assert.ok(inst.includes('open: function (room) { return S === me && runIsOpen(room); }'), 'the move is held to rooms open to the players (runIsOpen)');
  assert.ok(inst.includes('str(S.rollSel)'), 'the selected room is the one the Roll’s own line uses');
});
test('the bundle: threat-room.js is in night-flow, not in the always-on GM bundle or the display', () => {
  const routes = fs.readFileSync(path.join(ROOT, 'app', 'routes.js'), 'utf8');
  assert.ok(/'night-flow': \[[^\]]*'gm\/threat-room\.js'/.test(routes));
  const gmBundle = routes.split('\n').find((l) => /^\s*gm: \[/.test(l)) || '';
  assert.ok(gmBundle && !gmBundle.includes('threat-room.js'), 'not in the always-on GM bundle');
  const display = routes.split('\n').find((l) => /^\s*display: \[/.test(l)) || '';
  assert.ok(!display.includes('threat-room.js'), 'not on the display');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
