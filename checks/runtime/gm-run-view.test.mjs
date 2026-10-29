// Unit test for the Run view's pure half (app/gm/run-view.js, B68GmRunView): the board model, the beat moves, the engagement
// starts and the crew move, on the invented v2 fixture (checks/runtime/fixtures/gm/pelican-play-v2.json). Invented data only.
//   node checks/runtime/gm-run-view.test.mjs
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const B = require(path.join(ROOT, 'app', 'gm', 'ball.js'));
const R = require(path.join(ROOT, 'app', 'gm', 'run-view.js'));
const raw = JSON.parse(readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'pelican-play-v2.json'), 'utf8'));
const ROOMS = ['Showroom', 'Cocktail lounge', 'Underground counting room', 'Security control room', 'Private card rooms', 'Luxury penthouse'];
const checked = B.checkPlay(raw, ROOMS);
const play = checked.play;
const floors = { list: [{ lvl: -1, name: 'Under' }, { lvl: 0, name: 'Ground' }, { lvl: 1, name: 'Upper' }, { lvl: 2, name: 'Loft' }],
  floorOf: { 'Showroom': 0, 'Cocktail lounge': 0, 'Underground counting room': -1, 'Security control room': 1, 'Private card rooms': 1, 'Luxury penthouse': 2 } };
const PCS = [{ id: 'p1', name: 'Cass Fenn' }, { id: 'p2', name: 'Dov Ketch' }, { id: 'p3', name: 'Ira Lund' }];

let failed = 0, passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const mk = (st, t, extra) => R.model(play, st, Object.assign({ t, pcs: PCS, floors, isOpen: (n) => n === 'Showroom' || n === 'Cocktail lounge' }, extra));

test('the fixture is a clean v2 block', () => { assert.equal(checked.warnings.length, 0, checked.warnings.join(' | ')); assert.equal(play.v, 2); });

test('the board: floors top first, a card per room, zones named, fog on the rooms not open', () => {
  const m = mk({ start: 0, t: 0, crew: {} }, 0);
  assert.deepEqual(m.rows.map((r) => r.name), ['Loft', 'Upper', 'Ground', 'Under']);
  assert.equal(Object.keys(m.cards).length, 6);
  assert.equal(m.cards['Showroom'].zoneLabel, 'The floor');
  assert.equal(m.cards['Showroom'].open, true);
  assert.equal(m.cards['Private card rooms'].open, false);
  assert.equal(m.cards['Luxury penthouse'].zone, 3);
});

test('the people who matter are on the board: the target, a looker, the rival; plain staff are not', () => {
  const m = mk({ start: 0, t: 0, crew: {} }, 0);
  const ids = (room) => m.cards[room].npcs.map((n) => n.id).sort();
  assert.deepEqual(ids('Showroom'), ['od', 'wr']);               /* the target, and the guard (a costume is seen through by him) */
  assert.deepEqual(ids('Cocktail lounge'), ['pq']);              /* the cook's looker */
  assert.deepEqual(ids('Security control room'), ['iv']);        /* the rival */
});

test('a PC chip carries the edge, the icon, a warning when a looker is here and the PC is out of place, an eye when they belong', () => {
  const st = { start: 0, t: 0, crew: { p1: { room: 'Showroom', disguise: 'guard' }, p2: { room: 'Cocktail lounge', disguise: 'cook' }, p3: { room: 'Showroom', disguise: 'guest' } } };
  const m = mk(st, 0);
  const p1 = m.cards['Showroom'].pcs.filter((c) => c.id === 'p1')[0], p2 = m.cards['Cocktail lounge'].pcs[0], p3 = m.cards['Showroom'].pcs.filter((c) => c.id === 'p3')[0];
  assert.equal(p1.pos, 'controlled'); assert.equal(p1.mark, 'eye'); assert.match(p1.looker, /Wren Tully/);
  assert.equal(p2.pos, 'risky'); assert.equal(p2.mark, 'warn'); assert.match(p2.looker, /Pip Quill/);
  assert.equal(p3.pos, 'controlled'); assert.equal(p3.mark, '');
  assert.ok(p1.icon && p2.icon && p3.icon, 'a costume gives an icon');
  assert.equal(R.model(play, { start: 0, t: 0, crew: { p1: { room: 'Showroom' } } }, { t: 0, pcs: PCS, floors }).cards['Showroom'].pcs[0].pos, 'desperate', 'no costume is desperate');
});

test('a PC with no room is in the tray; moved shows only in the beat it moved', () => {
  const st = { start: 0, t: 0, crew: { p1: { room: 'Showroom', disguise: 'guest', moved: 0 } } };
  const m = mk(st, 0);
  assert.deepEqual(m.tray.map((c) => c.id), ['p2', 'p3']);
  assert.equal(m.cards['Showroom'].pcs[0].moved, true);
  assert.equal(mk({ ...st, t: 15 }, 15).cards['Showroom'].pcs[0].moved, false, 'the tick clears on the next beat');
});

test('the passage shows only inside its window, with when it closes', () => {
  const st = { start: 0, t: 0, crew: {} };
  const at = (t) => mk(st, t).cards['Underground counting room'].routes.map((r) => r.to);
  assert.deepEqual(at(60), []);
  assert.deepEqual(at(150), ['Showroom']);                       /* 23:30 */
  const r = mk(st, 150).cards['Underground counting room'].routes[0];
  assert.equal(r.timed, true); assert.equal(r.until, '00:00');
  assert.equal(mk(st, 150).cards['Cocktail lounge'].routes[0].mark, '↑', 'the lift goes up');
});

test('the track: a square a beat from clock.start, the loudest event icon on it, the start shading', () => {
  const m = mk({ start: 45, t: 60, crew: {} }, 60);
  assert.equal(m.track.length, 16); assert.equal(m.beat.of, 16);
  assert.equal(m.track[4].icon, 'star'); assert.equal(m.track[10].icon, 'diamond'); assert.equal(m.track[12].icon, 'star'); assert.equal(m.track[14].icon, 'skull');
  assert.deepEqual(m.track.filter((q) => q.before).map((q) => q.i), [0, 1, 2], 'squares before the 21:45 start are shaded');
  assert.equal(m.track.filter((q) => q.cur).map((q) => q.i).join(), '4');
  assert.equal(m.label, '22:00');
  assert.deepEqual(m.alarm, { name: 'Fuse', size: 6 });
});

test('a peek time moves the board but not the state', () => {
  const st = { start: 0, t: 0, crew: {} }, copy = JSON.stringify(st);
  assert.deepEqual(mk(st, 0).cards['Showroom'].npcs.map((n) => n.id).sort(), ['od', 'wr']);
  assert.deepEqual(mk(st, 150).cards['Private card rooms'].npcs.map((n) => n.id).sort(), ['od', 'wr']);
  assert.equal(JSON.stringify(st), copy);
});

test('stepTime: a beat each way, never before the start, never past the last beat; nothing before the night starts', () => {
  assert.equal(R.stepTime(play, { t: 0 }, 1), null);
  assert.equal(R.stepTime(play, { start: 30, t: 30 }, -1), null);
  assert.equal(R.stepTime(play, { start: 30, t: 30 }, 1), 45);
  assert.equal(R.stepTime(play, { start: 30, t: 60 }, -1), 45);
  assert.equal(R.stepTime(play, { start: 0, t: 225 }, 1), null, 'the 16th beat is the last');
});

test('jumpTime: the next thing that happens, or null', () => {
  assert.equal(R.jumpTime(play, { t: 0 }), null, 'not started');
  assert.equal(R.jumpTime(play, { start: 0, t: 0 }), 60, '22:00 the speeches');
  assert.equal(R.jumpTime(play, { start: 0, t: 60 }), 120, '23:00 the guard goes to the control room, the passage opens');
  assert.equal(R.jumpTime(play, { start: 0, t: 235 }), null);
});

test('startMinutes: the four engagement results, in minutes from clock.start', () => {
  assert.deepEqual(R.startMinutes(play).map((o) => o.key + '=' + o.t), ['crit=0', '6=30', '4/5=45', '1-3=60']);
  assert.deepEqual(R.startMinutes({ clock: { start: '21:00', end: '01:00' } }), []);
});

test('moveCrew: a new object, the room and beat set, noticed cleared only when the room changed', () => {
  const st = { crew: { p1: { room: 'Showroom', disguise: 'guest', noticed: true, items: ['key'], moved: 0 } } }, copy = JSON.stringify(st);
  const a = R.moveCrew(st, 'p1', 'Cocktail lounge', 3);
  assert.deepEqual(a.p1, { room: 'Cocktail lounge', disguise: 'guest', noticed: false, items: ['key'], moved: 3 });
  assert.equal(R.moveCrew(st, 'p1', 'Showroom', 3).p1.noticed, true);
  assert.deepEqual(R.moveCrew(st, 'p2', 'Showroom', 1).p2, { room: 'Showroom', noticed: false, moved: 1 });
  assert.equal(JSON.stringify(st), copy, 'the input is not mutated');
});

test('the seams VV5 and VV6 build on exist', () => {
  assert.equal(typeof R.setPlayersChip, 'function'); assert.ok(Array.isArray(R.menuItems)); assert.ok(Array.isArray(R.views)); assert.ok(Array.isArray(R.sections));
  assert.ok('heard' in R.hooks); assert.equal(typeof R.create, 'function');
  R.setPlayersChip('Players: 21:00', true);                      /* with no view on screen it only remembers */
  R.setPlayersChip('Players: —', false);
});


/* ---- VV5: the pure helpers behind This beat, the crew and the job ---- */
const TT = (h) => B.minuteOf(h, '21:00');
test('sortedStops mirrors the engine: the sorted list with usable times, indexed as over.skip reads them', () => {
  const od = play.people.find((p) => p.id === 'od');
  assert.deepEqual(R.sortedStops(od, '21:00').map((s) => [s.j, s.at, s.room]), [[0, '21:00', 'Showroom'], [1, '23:30', 'Private card rooms'], [2, '00:15', 'Luxury penthouse']]);
  /* skipping index 2 with the engine keeps her in the card rooms: the index means what the view thinks it means */
  assert.equal(B.placesAt(play, { over: { od: { skip: [2] } } }, TT('00:30')).od.room, 'Private card rooms');
});
test('scanChanges: the next change of room with the overrides on; null when nothing more happens', () => {
  const sc = R.scanChanges(play, {}, ['od', 'iv', 'pq'], TT('22:00'));
  assert.deepEqual(sc.od, { at: TT('23:30'), room: 'Private card rooms' }); assert.deepEqual(sc.iv, { at: TT('00:30'), room: null }); assert.deepEqual(sc.pq, { at: TT('00:00'), room: 'Underground counting room' });
  assert.deepEqual(R.scanChanges(play, { over: { od: { delay: 30, from: TT('22:00') } } }, ['od'], TT('22:00')).od, { at: TT('00:00'), room: 'Private card rooms' }, 'a delay from now moves the next stop');
  assert.equal(R.scanChanges(play, { over: { od: { gone: true } } }, ['od'], TT('22:00')).od, null, 'a person who is gone has no next move');
});
test('skipTarget: the next future stop flagged private, never a public one, never one already skipped; none left is null', () => {
  const open = () => false;
  assert.equal(R.skipTarget(play, {}, TT('22:00'), open).stop.room, 'Luxury penthouse', 'the card rooms stop is public, so it is passed over');
  assert.equal(R.skipTarget(play, { over: { od: { skip: [2] } } }, TT('22:00'), open), null);
  assert.equal(R.skipTarget(play, {}, TT('00:30'), open), null, 'nothing is left to skip after the last stop');
  assert.equal(R.skipTarget(play, {}, TT('22:00'), () => true).stop.room, 'Luxury penthouse', 'the fog does not matter');
});

test('crewOrder: desperate with a looker, desperate, risky with, risky, controlled with, controlled, then the unplaced', () => {
  const st = { crew: {
    p1: { room: 'Showroom', disguise: 'guard' },                        /* controlled, Wren is there at 21:00 */
    p2: { room: 'Cocktail lounge', disguise: 'cook' },                  /* risky (floor is risky for a cook), Pip is there */
    p3: { room: 'Luxury penthouse', disguise: 'guest' } } };            /* desperate */
  assert.deepEqual(R.crewOrder(play, st, PCS, 0).map((o) => [o.id, o.pos]), [['p3', 'desperate'], ['p2', 'risky'], ['p1', 'controlled']]);
  const st2 = { crew: { p1: { room: 'Showroom', disguise: 'guard', blown: ['guard'] }, p2: { room: 'Cocktail lounge', disguise: 'cook' } } };
  assert.deepEqual(R.crewOrder(play, st2, PCS, 0).map((o) => o.id), ['p1', 'p2', 'p3'], 'blown makes Cass desperate with a looker: first; the unplaced Ira is last');
  assert.equal(R.crewOrder(play, st2, PCS, 0)[0].here[0].label, 'Wren Tully');
});
test('waySummary: unheard, heard by, steps n of m, done, and gone once t passes window.until', () => {
  const wA = play.ways[0], wB = play.ways[1];
  assert.equal(R.waySummary(play, {}, wA, 0).state, 'unheard');
  assert.equal(R.waySummary(play, { heard: { A: { p1: 5 } } }, wA, 0).state, 'heard');
  assert.deepEqual([R.waySummary(play, { steps: { A: [true, false] } }, wA, 0).state, R.waySummary(play, { steps: { A: [true, false] } }, wA, 0).n, R.waySummary(play, {}, wA, 0).total], ['steps', 1, 2]);
  assert.equal(R.waySummary(play, { ways: { A: 'done' }, steps: { A: [true] } }, wA, 0).state, 'done');
  assert.equal(R.waySummary(play, {}, wA, TT('00:14')).state, 'unheard'); assert.equal(R.waySummary(play, {}, wA, TT('00:15')).state, 'gone', 'the window of A ends 00:15');
  assert.equal(R.waySummary(play, {}, wB, TT('01:00')).state, 'unheard', 'a window with no until never closes by itself');
});

console.log(failed ? 'FAILED ' + failed + ' of ' + (failed + passed) : 'ok ' + passed + ' passed');
process.exit(failed ? 1 : 0);
