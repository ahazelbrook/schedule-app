// Tests for a site's play block (app/gm/ball.js checkPlay) and its export through authored sites
// (scripts/lib/authored-export.mjs). INVENTED data only: a made-up venue and cast in a temporary vault.
//   node checks/runtime/gm-ball.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { buildAuthored, parseSite, LOCATIONS_REL, SCORES_REL } from '../../scripts/lib/authored-export.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const B = require(path.join(ROOT, 'app', 'gm', 'ball.js'));
const P = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
const L = require(path.join(ROOT, 'app', 'gm', 'location.js'));
const FIXL = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'location-pack.json'), 'utf8'));

let failed = 0, passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const ROOMS = ['Foyer', 'Boathouse', 'Ledger room', 'Roof garden', 'Pantry'];
const PLAY = () => ({
  v: 1,
  clock: { start: '18:00', end: '02:00', step: 30, label: 'Gala night' },
  floors: { '-1': 'Under', '0': 'Ground', '1': 'Upper' },
  routes: [
    { id: 'lift', from: 'Pantry', to: 'Roof garden', via: 'the service lift', dir: 'up', needs: 'a key' },
    { id: 'steps', from: 'Foyer', to: 'Boathouse', via: 'the wet steps', who: 'anyone' },
  ],
  people: [
    { id: 'p1', label: 'Odette', kind: 'target', npc: 'Odette Marsh', stops: [
      { at: '23:30', room: 'Roof garden', note: 'alone' }, { at: '00:15', room: 'Ledger room' }, { at: '19:00', room: 'Foyer' }] },
    { id: 'g1', label: 'Wren', kind: 'guard', with: 'p1' },
    { id: 's1', label: 'Pip', kind: 'staff', stops: [{ at: '18:00', room: 'Pantry' }] },
  ],
  disguises: [{ id: 'cook', label: 'Cook', floors: [-1], rooms: ['Foyer'], never: ['Roof garden'], sees: 'the steward' }],
  events: [{ at: '00:00', id: 'fw', label: 'Fireworks', room: 'Roof garden', fx: 'dawn' }, { at: '20:00', id: 'sp', label: 'Speeches' }],
  clocks: [{ name: 'Alarm', room: 'Ledger room' }],
});
const run = (mut) => { const p = PLAY(); if (mut) mut(p); return B.checkPlay(p, ROOMS); };
const warnsLike = (r, re) => r.warnings.filter((w) => re.test(w));

test('a valid play passes whole with no warnings, and the input is not mutated', () => {
  const src = PLAY(), before = JSON.stringify(src);
  const r = B.checkPlay(src, ROOMS);
  assert.deepEqual(r.warnings, []);
  assert.equal(JSON.stringify(src), before);
  assert.equal(r.play.people.length, 3);
  assert.equal(r.play.clock.step, 30);
  assert.deepEqual(r.play.floors, { '-1': 'Under', '0': 'Ground', '1': 'Upper' });
  assert.deepEqual(B.countPlay(r.play), { people: 3, stops: 4, routes: 2, disguises: 1, events: 2, clocks: 1 });
});

test('stops sort by minutes from clock.start, so 00:15 follows 23:30; with is kept; a person may hold both', () => {
  const r = run();
  assert.deepEqual(r.play.people[0].stops.map((s) => s.at), ['19:00', '23:30', '00:15']);
  assert.equal(r.play.people[1].with, 'p1');
  const both = run((p) => { p.people[1].stops = [{ at: '19:00', room: 'Pantry' }]; });
  assert.equal(both.play.people[1].with, 'p1'); assert.equal(both.play.people[1].stops.length, 1); assert.deepEqual(both.warnings, []);
});

test('minuteOf wraps past midnight', () => {
  assert.equal(B.minuteOf('19:00', '19:00'), 0);
  assert.equal(B.minuteOf('23:30', '19:00'), 270);
  assert.equal(B.minuteOf('00:15', '19:00'), 315);
  assert.equal(B.minuteOf('18:59', '19:00'), 1439);
  assert.ok(isNaN(B.minuteOf('25:00', '19:00')));
  assert.ok(isNaN(B.minuteOf('7pm', '19:00')));
});

test('a stop in an unknown room is dropped with its warning; the rest stay', () => {
  const r = run((p) => { p.people[0].stops[1].room = 'Nowhere'; });
  assert.equal(r.play.people[0].stops.length, 2);
  assert.ok(!r.play.people[0].stops.some((s) => s.room === 'Nowhere'));
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /^play\.people\[p1\]\.stops\[\d\]: room "Nowhere" is not in the site; dropped$/);
});

test('a bad time drops the stop; a single-digit hour is normalised to HH:MM', () => {
  const r = run((p) => { p.people[0].stops[0].at = '7:60'; p.people[2].stops[0].at = '9pm'; });
  assert.equal(r.play.people[0].stops.length, 2);
  assert.equal(warnsLike(r, /time "7:60" is not HH:MM; dropped/).length, 1);
  assert.equal(warnsLike(r, /time "9pm" is not HH:MM; dropped/).length, 1);
  assert.ok(!r.play.people.some((p) => p.id === 's1'), 'its only stop went, so the person has nowhere to be');
  assert.equal(warnsLike(r, /play\.people\[s1\]: no stops and no with/).length, 1);
  const n = run((p) => { p.people[0].stops[0].at = '9:05'; });
  assert.ok(n.play.people[0].stops.some((s) => s.at === '09:05'));
});

test('a time outside the clock is kept with a warning that says why', () => {
  const r = run((p) => { p.people[0].stops.push({ at: '17:45', room: 'Foyer' }); });
  assert.ok(r.play.people[0].stops.some((s) => s.at === '17:45'));
  assert.equal(warnsLike(r, /17:45 is outside the clock \(18:00 to 02:00\).*kept/).length, 1);
});

test('with: unknown id, self and a loop drop the person; dropping one cascades', () => {
  const unk = run((p) => { p.people[1].with = 'ghost'; });
  assert.ok(!unk.play.people.some((x) => x.id === 'g1'));
  assert.equal(warnsLike(unk, /play\.people\[g1\]: with "ghost" is not a person in the play; person dropped/).length, 1);
  const self = run((p) => { p.people[1].with = 'g1'; });
  assert.equal(warnsLike(self, /follows itself/).length, 1);
  const loop = run((p) => { p.people.push({ id: 'g2', label: 'Jo', kind: 'guard', with: 'g3' }, { id: 'g3', label: 'Al', kind: 'guard', with: 'g2' }); });
  assert.deepEqual(loop.play.people.map((x) => x.id), ['p1', 'g1', 's1']);
  assert.equal(warnsLike(loop, /leads back to itself/).length, 1);
  assert.equal(warnsLike(loop, /with "g2" is not a person in the play/).length, 1, "the second of the pair then follows a dropped person");
  const chain = run((p) => { p.people.push({ id: 'g4', label: 'Kit', kind: 'guard', with: 'g1' }); p.people[1].with = 'ghost'; });
  assert.ok(!chain.play.people.some((x) => x.id === 'g4'), 'g4 followed a dropped person');
});

test('kinds: only the six; a bad kind or a missing label drops the person', () => {
  const r = run((p) => { p.people[1].kind = 'villain'; p.people[2].label = ''; });
  assert.deepEqual(r.play.people.map((x) => x.id), ['p1']);
  assert.equal(warnsLike(r, /play\.people\[g1\]: kind "villain" is not target, guard, staff, rival, ally, contact; dropped/).length, 1);
  assert.equal(warnsLike(r, /play\.people\[s1\]: no label; dropped/).length, 1);
  ['target', 'guard', 'staff', 'rival', 'ally', 'contact'].forEach((k) => assert.deepEqual(run((p) => { p.people[2].kind = k; }).warnings, []));
});

test('routes: rooms must exist, dir is both|up|down (missing means both), ids are unique', () => {
  const r = run((p) => { p.routes.push({ id: 'bad', from: 'Foyer', to: 'Moon', dir: 'both' }, { id: 'sideways', from: 'Foyer', to: 'Pantry', dir: 'sideways' }, { id: 'lift', from: 'Foyer', to: 'Pantry' }); });
  assert.deepEqual(r.play.routes.map((x) => x.id), ['lift', 'steps']);
  assert.equal(r.play.routes[1].dir, 'both');
  assert.equal(r.play.routes[0].dir, 'up');
  assert.equal(warnsLike(r, /play\.routes\[bad\]: to "Moon" is not a room in the site; dropped/).length, 1);
  assert.equal(warnsLike(r, /play\.routes\[sideways\]: dir "sideways" is not both, up or down; dropped/).length, 1);
  assert.equal(warnsLike(r, /id lift is used twice/).length, 1);
});

test('disguises: floors are level numbers; unknown rooms leave the list, not the disguise; sees is carried as written', () => {
  const r = run((p) => { p.disguises[0].rooms = ['Foyer', 'Atlantis']; p.disguises.push({ id: 'x', label: 'Bad', floors: 'ground' }); });
  assert.deepEqual(r.play.disguises.map((d) => d.id), ['cook']);
  assert.deepEqual(r.play.disguises[0].rooms, ['Foyer']);
  assert.deepEqual(r.play.disguises[0].never, ['Roof garden']);
  assert.equal(r.play.disguises[0].sees, 'the steward');
  assert.equal(warnsLike(r, /play\.disguises\[cook\]\.rooms: room "Atlantis" is not in the site; dropped/).length, 1);
  assert.equal(warnsLike(r, /play\.disguises\[x\]: floors must be a list of level numbers; dropped/).length, 1);
});

test('events and clocks: unknown rooms drop them; an event may have no room', () => {
  const r = run((p) => { p.events.push({ at: '21:00', id: 'e3', label: 'Lost', room: 'Atlantis' }, { at: 'late', id: 'e4', label: 'Later' }); p.clocks.push({ name: 'Ghost', room: 'Atlantis' }); });
  assert.deepEqual(r.play.events.map((e) => e.id), ['sp', 'fw']);
  assert.equal(r.play.events[0].room, undefined);
  assert.deepEqual(r.play.clocks.map((c) => c.name), ['Alarm']);
  assert.equal(r.warnings.length, 3);
  assert.equal(warnsLike(r, /play\.events\[e3\]: room "Atlantis" is not in the site; dropped/).length, 1);
  assert.equal(warnsLike(r, /play\.events\[e4\]: time "late" is not HH:MM; dropped/).length, 1);
  assert.equal(warnsLike(r, /play\.clocks\[1\] \(Ghost\): room "Atlantis"/).length, 1);
});

test('a block that cannot be used whole is dropped: not an object, v not 1, no clock', () => {
  const noClock = PLAY(); delete noClock.clock;
  const badClock = PLAY(); badClock.clock.start = '7am';
  for (const [bad, re] of [[null, /not an object/], ['x', /not an object/], [[], /not an object/], [Object.assign(PLAY(), { v: 2 }), /v is 2, not 1/], [noClock, /clock needs start and end/], [badClock, /clock needs start and end/]]) {
    const r = B.checkPlay(bad, ROOMS);
    assert.equal(r.play, null); assert.equal(r.warnings.length, 1); assert.match(r.warnings[0], re);
  }
});

test('keys it does not know are carried through untouched, at the top and on items', () => {
  const r = run((p) => { p.mood = { a: 1 }; p.people[0].colour = 'red'; p.routes[0].locked = true; p.clock.tz = 'x'; });
  assert.deepEqual(r.play.mood, { a: 1 });
  assert.equal(r.play.people[0].colour, 'red');
  assert.equal(r.play.routes[0].locked, true);
  assert.equal(r.play.clock.tz, 'x');
  assert.deepEqual(r.warnings, []);
});

test('too many stops are cut with a warning, and an out-of-clock warning uses the author own index', () => {
  const r = run((p) => { p.people[0].stops = []; for (let i = 0; i < 45; i++) p.people[0].stops.push({ at: '20:00', room: 'Foyer' }); });
  assert.equal(r.play.people[0].stops.length, 40);
  assert.equal(r.warnings.filter((w) => w.includes('play.people[p1].stops: 45 stops, keeping the first 40')).length, 1);
  const o = run((p) => { p.people[0].stops[0].room = 'Nowhere'; p.people[0].stops[1].at = '17:00'; });
  assert.equal(o.warnings.filter((w) => w.includes('play.people[p1].stops[1]: 17:00 is outside the clock')).length, 1);
});


test('roomNames may be an array or an object keyed by room', () => {
  const o = {}; ROOMS.forEach((n) => { o[n] = 1; });
  assert.deepEqual(B.checkPlay(PLAY(), o).warnings, []);
  const none = B.checkPlay(PLAY(), []);
  assert.deepEqual(none.play.people, [], 'with no rooms every person loses all their stops and is dropped');
  assert.equal(none.warnings.filter((w) => w.includes('play.people[p1].stops[0]: room "Roof garden" is not in the site; dropped')).length, 1);
  assert.equal(none.warnings.filter((w) => w.includes('play.people[p1]: no stops and no with')).length, 1);
});

/* ---------- the exporter ---------- */
const BLOCK = (j) => '```json b68-site\n' + JSON.stringify(j) + '\n```';
const NOTE = (j) => ['---', 'wiki: entity', '---', '# The Pelican Rooms', '', BLOCK(j), ''].join('\n');
const PATCH = { name: 'The Pelican Rooms', district: 'Nowhere Ward', rooms: ROOMS.map((n, i) => ({ name: n, band: ['public', 'public', 'working', 'controlled', 'secure'][i], isTarget: i === 4 })) };

function tmpVault() {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-ball-'));
  fs.mkdirSync(path.join(v, ...LOCATIONS_REL.split('/')), { recursive: true });
  fs.mkdirSync(path.join(v, ...SCORES_REL.split('/')), { recursive: true });
  return v;
}

test('buildAuthored carries site.play, checked against the patch rooms; warnings reach warn()', () => {
  const v = tmpVault();
  const play = PLAY(); play.people[0].stops[1].room = 'Nowhere'; play.routes.push({ id: 'bad', from: 'Foyer', to: 'Moon' });
  fs.writeFileSync(path.join(v, ...LOCATIONS_REL.split('/'), 'The Pelican Rooms.md'), NOTE({ patch: PATCH, play }));
  const warns = [];
  const a = buildAuthored({ vault: v, warn: (m) => warns.push(m) });
  const site = a.sites['The Pelican Rooms'];
  assert.ok(site.play, 'play reached the site');
  assert.deepEqual(B.countPlay(site.play), { people: 3, stops: 3, routes: 2, disguises: 1, events: 2, clocks: 1 });
  assert.equal(warns.length, 2);
  assert.ok(warns.every((w) => w.startsWith('location: authored site The Pelican Rooms play.')));
  assert.ok(warns.some((w) => /stops\[\d\]: room "Nowhere" is not in the site; dropped/.test(w)));
  assert.ok(warns.some((w) => /routes\[bad\]: to "Moon"/.test(w)));
  assert.deepEqual(site.patch, PATCH, 'the patch itself is untouched');
});

test('an unusable play is dropped with one warning and the site still exports; no play means no key', () => {
  const v = tmpVault(), dir = path.join(v, ...LOCATIONS_REL.split('/'));
  fs.writeFileSync(path.join(dir, 'A.md'), NOTE({ patch: PATCH, play: { v: 9 } }));
  fs.writeFileSync(path.join(dir, 'B.md'), NOTE({ patch: PATCH }));
  const warns = [];
  const a = buildAuthored({ vault: v, warn: (m) => warns.push(m) });
  assert.ok(a.sites.A && !('play' in a.sites.A));
  assert.ok(a.sites.B && !('play' in a.sites.B));
  assert.equal(warns.length, 1); assert.match(warns[0], /authored site A play: v is 9, not 1/);
  assert.equal(parseSite(NOTE({ patch: PATCH }), 'B', 'r').warnings, undefined);
});

test('SECRECY: the roll an authored site makes, which feeds Show on iPad, carries no play', () => {
  const v = tmpVault();
  fs.writeFileSync(path.join(v, ...LOCATIONS_REL.split('/'), 'The Pelican Rooms.md'), NOTE({ patch: PATCH, play: PLAY() }));
  const site = buildAuthored({ vault: v }).sites['The Pelican Rooms'];
  assert.ok(site.play);
  const roll = P.authoredRoll(L, FIXL, site);
  assert.ok(roll && roll.auth === 'The Pelican Rooms', 'the roll was made');
  assert.ok(!('play' in roll));
  assert.ok(!JSON.stringify(roll).includes('Odette'), 'no play text anywhere in the roll');
  assert.ok(!JSON.stringify(roll).includes('Fireworks'));
});

// ---- the live view: minuteOf, whereAt, lensRating, seesMatches, ballView. Invented cast and venue. ----
const K = require(path.join(ROOT, 'app', 'maps', 'map-kit.js'));
const START = '18:00';
const PEOPLE = () => [
  { id: 'lead', label: 'Odette', kind: 'target', stops: [
    { at: '22:00', room: 'Foyer', note: 'greeting' }, { at: '23:30', room: 'Roof garden', note: 'alone' },
    { at: '00:15', room: 'Ledger room', note: 'cards' }] },
  { id: 'shadow', label: 'Wren', kind: 'guard', with: 'lead' },
  { id: 'post', label: 'Pip', kind: 'staff', stops: [{ at: '18:00', room: 'Pantry' }] },
  { id: 'mixed', label: 'Sable', kind: 'rival', with: 'lead', stops: [{ at: '23:50', room: 'Boathouse' }] },
];
const byIdOf = (ps) => Object.fromEntries(ps.map((p) => [p.id, p]));
const at = (p, hhmm, ps) => B.whereAt(p, B.minuteOf(hhmm, START), byIdOf(ps), START);

test('minuteOf is the checkPlay one: 00:15 is after 23:30, a time before start is next morning, junk is NaN', () => {
  assert.equal(B.minuteOf('23:30', START), 330);
  assert.equal(B.minuteOf('00:15', START), 375);
  assert.ok(B.minuteOf('00:15', START) > B.minuteOf('23:30', START));
  assert.equal(B.minuteOf('18:00', START), 0);
  assert.equal(B.minuteOf('17:59', START), 1439);
  assert.ok(Number.isNaN(B.minuteOf('25:00', START)) && Number.isNaN(B.minuteOf('18:00', 'x')));
});

test('whereAt: a stop exactly at t is active and not moving; the person holds a room until the next stop', () => {
  const ps = PEOPLE(), lead = ps[0];
  const w = at(lead, '23:30', ps);
  assert.deepEqual(w, { room: 'Roof garden', note: 'alone', moving: null });
  assert.equal(at(lead, '23:00', ps).room, 'Foyer');
  assert.equal(at(lead, '23:29', ps).room, 'Foyer');
  assert.equal(at(lead, '23:29', ps).moving.inMin, 1);
});

test('whereAt: 00:15 comes after 23:30 (across midnight)', () => {
  const ps = PEOPLE();
  assert.equal(at(ps[0], '23:59', ps).room, 'Roof garden');
  assert.equal(at(ps[0], '00:14', ps).room, 'Roof garden');
  assert.equal(at(ps[0], '00:15', ps).room, 'Ledger room');
  assert.equal(at(ps[0], '01:30', ps).room, 'Ledger room', 'the last stop holds to the end');
});

test('whereAt: moving in the 5 minutes before a stop, not at 6, and never into the same room', () => {
  const ps = PEOPLE(), lead = ps[0];
  assert.deepEqual(at(lead, '23:25', ps).moving, { to: 'Roof garden', inMin: 5 });
  assert.equal(at(lead, '23:24', ps).moving, null);
  assert.deepEqual(at(lead, '23:25', ps).room, 'Foyer', 'still shown in the room they are leaving');
  const same = [{ id: 'x', label: 'X', kind: 'staff', stops: [{ at: '19:00', room: 'Pantry' }, { at: '19:30', room: 'Pantry' }] }];
  assert.equal(at(same[0], '19:27', same).moving, null);
});

test('whereAt: before the first stop and with no with, nowhere; null for junk', () => {
  const ps = PEOPLE();
  assert.equal(at(ps[0], '19:00', ps), null);
  assert.equal(B.whereAt(null, 5, {}, START), null);
  assert.equal(B.whereAt(ps[0], NaN, {}, START), null);
});

test('whereAt: a guard follows the target, including the moving flag', () => {
  const ps = PEOPLE(), g = ps[1];
  assert.equal(at(g, '19:00', ps), null, 'the target is nowhere yet');
  assert.equal(at(g, '22:30', ps).room, 'Foyer');
  assert.deepEqual(at(g, '23:27', ps).moving, { to: 'Roof garden', inMin: 3 });
  assert.equal(at(g, '23:30', ps).room, 'Roof garden');
  assert.equal(at(g, '00:15', ps).room, 'Ledger room');
});

test('whereAt: own stop wins when active; before it they follow with; after their last own stop they stay (not re-follow)', () => {
  const ps = PEOPLE(), m = ps[3];
  assert.equal(at(m, '22:30', ps).room, 'Foyer', 'before the first own stop: follows lead');
  assert.equal(at(m, '23:40', ps).room, 'Roof garden', 'still following at 23:40');
  assert.equal(at(m, '23:50', ps).room, 'Boathouse', 'own stop wins while active');
  assert.equal(at(m, '00:30', ps).room, 'Boathouse', 'a minute after, lead has moved to Ledger room but m stays on own stop');
  assert.equal(at(ps[0], '00:30', ps).room, 'Ledger room');
});

test('whereAt: a follower with own stops shows moving towards their own next stop, which beats the leader moving', () => {
  const ps = PEOPLE(), m = ps[3];
  assert.deepEqual(at(m, '23:47', ps), { room: 'Roof garden', note: '', moving: { to: 'Boathouse', inMin: 3 } });
  assert.equal(at(m, '23:44', ps).moving, null);
  assert.deepEqual(at(m, '23:45', ps).moving, { to: 'Boathouse', inMin: 5 });
  const lead = at(ps[0], '23:27', ps).moving;
  assert.deepEqual(lead, { to: 'Roof garden', inMin: 3 });
  assert.deepEqual(at(m, '23:27', ps).moving, lead, 'no own stop near: the leader moving shows');
});

test('whereAt: a follower shows their own note (or none), never the leader\'s; an own stop falls back to the person note', () => {
  const ps = PEOPLE();
  assert.equal(at(ps[0], '23:30', ps).note, 'alone');
  assert.equal(at(ps[1], '23:30', ps).note, '', 'a follower with no note of their own');
  const withNote = [ps[0], { id: 'shadow', label: 'Wren', kind: 'guard', with: 'lead', note: 'Drinks' }];
  assert.equal(at(withNote[1], '23:30', withNote).note, 'Drinks');
  const own = [{ id: 'q', label: 'Q', kind: 'staff', note: 'Serving', stops: [{ at: '19:00', room: 'Pantry' }, { at: '20:00', room: 'Foyer', note: 'Clearing' }] }];
  assert.equal(at(own[0], '19:30', own).note, 'Serving', 'stop has no note: the person note');
  assert.equal(at(own[0], '20:00', own).note, 'Clearing', 'the stop note wins');
});

test('whereAt: a with loop cannot hang', () => {
  const a = { id: 'a', label: 'A', kind: 'staff', with: 'b' }, b = { id: 'b', label: 'B', kind: 'staff', with: 'a' };
  assert.equal(B.whereAt(a, 10, { a, b }, START), null);
});

test('seesMatches: id, label, whole-word, accents, "the", punctuation; near-misses and nobody/empty do not', () => {
  const p = { id: 'ren', label: 'Zoë Fairweather-Bell, the Reporter' };
  assert.ok(B.seesMatches('ren', p));
  assert.ok(B.seesMatches('The REN', p));
  assert.ok(B.seesMatches('zoe fairweather bell the reporter', p), 'label equals after normalising');
  assert.ok(B.seesMatches('Zoë', p), 'accent stripped, whole word');
  assert.ok(B.seesMatches('the reporter', p), 'leading the dropped, whole word in label');
  assert.ok(B.seesMatches('fairweather bell', p), 'a run of whole words');
  assert.ok(!B.seesMatches('port', p), 'substring of Reporter');
  assert.ok(!B.seesMatches('orter', p), 'a tail of Reporter');
  assert.ok(!B.seesMatches('reporters', p), 'a longer word than Reporter');
  assert.ok(!B.seesMatches('ren', { id: 'x', label: 'Søren Vale' }), 'a letter that does not decompose is not a word break');
  assert.ok(B.seesMatches('soren', { id: 'x', label: 'Søren Vale' }) === false, 'and is not folded to a plain o either');
  assert.ok(B.seesMatches('søren', { id: 'x', label: 'Søren Vale' }));
  assert.ok(!B.seesMatches('fair', p), 'prefix of a word');
  assert.ok(!B.seesMatches('nobody', { id: 'nobody', label: 'Nobody' }));
  assert.ok(!B.seesMatches('', { id: '', label: '' }));
  assert.ok(!B.seesMatches('the', p), '"the" alone is empty after stripping, so it matches no one');
  assert.ok(!B.seesMatches('x', null));
});

test('lensRating: home floor controlled, one off risky, further desperate, on every distance (numeric, with -1)', () => {
  const fo = { A: 0, B: 1, C: 2, D: -1, E: 3, F: -2 };
  const d = { id: 'd', label: 'D', floors: [0] };
  const r = (room) => B.lensRating(room, d, fo);
  assert.deepEqual(['A', 'B', 'D', 'C', 'F', 'E'].map(r), ['controlled', 'risky', 'risky', 'desperate', 'desperate', 'desperate']);
  const two = { id: 't', floors: [-1, 2] };
  assert.deepEqual(['D', 'C', 'A', 'B', 'E', 'F'].map((n) => B.lensRating(n, two, fo)), ['controlled', 'controlled', 'risky', 'risky', 'risky', 'risky']);
  assert.equal(B.lensRating('E', { floors: [0] }, { E: '3' }), 'desperate', 'string levels are coerced');
  assert.equal(B.lensRating('B', { floors: [-1] }, fo), 'desperate', 'level 1 from -1 is 2 away, not adjacent');
});

test('lensRating: never and rooms override the floor (never first); a room with no floor is unknown, unless named', () => {
  const fo = { A: 0, B: 2 };
  const d = { floors: [0], rooms: ['B', 'Z'], never: ['A', 'Z'] };
  assert.equal(B.lensRating('A', d, fo), 'desperate', 'never beats a home floor');
  assert.equal(B.lensRating('B', d, fo), 'controlled', 'rooms beats distance');
  assert.equal(B.lensRating('Z', d, fo), 'desperate', 'never wins over rooms');
  assert.equal(B.lensRating('Nowhere', { floors: [0] }, fo), 'unknown');
  assert.equal(B.lensRating('Nowhere', { floors: [0], rooms: ['Nowhere'] }, fo), 'controlled', 'an explicit rooms entry is data, not a guess');
  assert.equal(B.lensRating('A', null, fo), 'unknown');
  assert.equal(B.lensRating('A', { floors: [0] }, null), 'unknown');
});

const VIEWPLAY = () => ({
  v: 1, clock: { start: START, end: '02:00', step: 15 },
  routes: [{ id: 'lift', from: 'Pantry', to: 'Roof garden', via: 'the lift', dir: 'up', needs: 'a key' }, { id: 'steps', from: 'Foyer', to: 'Boathouse', via: 'steps', watched: 'Sable' }],
  people: PEOPLE(),
  disguises: [
    { id: 'cook', label: 'Cook', floors: [0], sees: 'the reporter' },
    { id: 'mask', label: 'Mask', floors: [0], sees: 'nobody' }],
  events: [{ at: '00:00', id: 'fw', label: 'Fireworks', room: 'Roof garden' }, { at: '20:00', id: 'sp', label: 'Speeches' }],
  clocks: [{ name: 'Alarm', room: 'Ledger room' }],
});
const FO = { Foyer: 0, Boathouse: -1, 'Ledger room': 1, 'Roof garden': 2, Pantry: 0, Cellar: -1 };
const view = (st, play) => B.ballView(play || VIEWPLAY(), st, FO);

test('ballView: the shape, people in rooms, a follower with the leader, rooms keyed by floorOf plus anything referenced', () => {
  const v = view({ t: B.minuteOf('23:30', START), crew: { pc1: 'Pantry' }, open: ['Foyer'], pins: { clk1: 'Ledger room' } });
  assert.equal(v.minute, 330); assert.equal(v.label, '23:30');
  assert.deepEqual(v.people.find((p) => p.id === 'lead'), { id: 'lead', label: 'Odette', kind: 'target', room: 'Roof garden', note: 'alone', moving: null });
  assert.equal(v.people.find((p) => p.id === 'shadow').note, '', 'a guard does not read the target\'s note');
  assert.deepEqual(v.rooms['Roof garden'].people, ['lead', 'shadow', 'mixed']);
  assert.deepEqual(v.rooms.Pantry.people, ['post']); assert.deepEqual(v.rooms.Pantry.crew, ['pc1']);
  assert.equal(v.rooms.Foyer.open, true); assert.equal(v.rooms.Cellar.open, false);
  assert.deepEqual(v.rooms['Ledger room'].pinned, ['clk1']);
  assert.equal(v.rooms.Cellar.lvl, -1); assert.equal(v.rooms.Cellar.lens, null, 'no lens chosen');
  assert.deepEqual(v.routes.map((r) => r.id + r.dir), ['liftup', 'stepsboth']);
  assert.equal(v.routes[0].needs, 'a key'); assert.equal(v.routes[1].watched, 'Sable');
  const odd = view({ t: 0, crew: { pc1: 'Attic' } });
  assert.equal(odd.rooms.Attic.lvl, null, 'a room on no floor has lvl null');
});

test('ballView: danger when the person the disguise sees stands in the room; nobody never does; lens follows the rating', () => {
  const t = B.minuteOf('23:30', START);
  const v = view({ t, lens: 'cook' });
  assert.deepEqual(v.rooms['Roof garden'].lens, { pos: 'desperate', danger: false }, 'the reporter is not a person here');
  const p = VIEWPLAY(); p.people.push({ id: 'rep', label: 'Dr Fenn, Reporter', kind: 'staff', stops: [{ at: '19:00', room: 'Boathouse' }] });
  const v2 = view({ t, lens: 'cook' }, p);
  assert.deepEqual(v2.rooms.Boathouse.lens, { pos: 'risky', danger: true });
  assert.equal(v2.rooms.Foyer.lens.pos, 'controlled'); assert.equal(v2.rooms.Foyer.lens.danger, false);
  const v3 = view({ t, lens: 'mask' }, p);
  assert.ok(Object.values(v3.rooms).every((r) => r.lens.danger === false), 'nobody sees through the mask');
  assert.equal(view({ t, lens: 'no-such-disguise' }, p).rooms.Foyer.lens, null, 'unknown disguise id is no lens');
});

test('ballView: danger moves with a follower (a guard who sees through it goes where the target goes)', () => {
  const p = VIEWPLAY(); p.disguises = [{ id: 'g', label: 'G', floors: [0], sees: 'wren' }];
  const a = view({ t: B.minuteOf('22:30', START), lens: 'g' }, p), b = view({ t: B.minuteOf('23:30', START), lens: 'g' }, p);
  assert.equal(a.rooms.Foyer.lens.danger, true); assert.equal(a.rooms['Roof garden'].lens.danger, false);
  assert.equal(b.rooms['Roof garden'].lens.danger, true); assert.equal(b.rooms.Foyer.lens.danger, false);
});

test('ballView: next is the next three events and target windows, strictly after t, across midnight, in time order', () => {
  const n = (hhmm) => view({ t: B.minuteOf(hhmm, START) }).next.map((x) => x.at + ' ' + x.label);
  assert.deepEqual(n('23:30'), ['00:00 Fireworks', '00:15 cards']);
  assert.deepEqual(n('21:00'), ['22:00 greeting', '23:30 alone', '00:00 Fireworks']);
  assert.deepEqual(n('19:00'), ['20:00 Speeches', '22:00 greeting', '23:30 alone']);
  assert.deepEqual(n('00:15'), []);
  assert.deepEqual(view({ t: B.minuteOf('23:59', START) }).next[0], { at: '00:00', label: 'Fireworks', room: 'Roof garden' });
});

test('ballView: a window and an event at the same minute are both kept, the event first', () => {
  const p = VIEWPLAY(); p.events.push({ at: '22:00', id: 'zz', label: 'Bell', room: 'Foyer' }, { at: '22:00', id: 'aa', label: 'Gong' });
  const nx = view({ t: B.minuteOf('21:00', START) }, p).next;
  assert.deepEqual(nx.map((x) => x.label), ['Gong', 'Bell', 'greeting']);
});

test('ballView: an empty or partial input never throws', () => {
  assert.equal(B.ballView(null, {}, FO), null);
  assert.equal(B.ballView({ v: 1 }, {}, FO), null);
  const bare = B.ballView({ v: 1, clock: { start: START, end: '02:00' } }, undefined, undefined);
  assert.deepEqual(bare, { minute: 0, label: '18:00', people: [], rooms: {}, next: [], routes: [] });
  const withFloors = B.ballView({ v: 1, clock: { start: START, end: '02:00' } }, null, FO);
  assert.deepEqual(Object.keys(withFloors.rooms).sort(), Object.keys(FO).sort());
  assert.ok(Object.values(withFloors.rooms).every((r) => r.people.length === 0 && r.lens === null));
  const part = view({ t: 'junk', crew: 5, open: 'x', pins: [] });
  assert.equal(part.minute, 0);
  assert.equal(view({ t: -50 }).minute, 0);
});

test('ballView: does not change its arguments', () => {
  const p = VIEWPLAY(), st = { t: 100, lens: 'cook', crew: { a: 'Pantry' }, open: ['Foyer'], pins: { k: 'Foyer' } };
  const bp = JSON.stringify(p), bs = JSON.stringify(st), bf = JSON.stringify(FO);
  view(st, p); B.ballView(p, st, FO);
  assert.equal(JSON.stringify(p), bp); assert.equal(JSON.stringify(st), bs); assert.equal(JSON.stringify(FO), bf);
});

test('ballView with the real map kit: floorOf built from B68Map.floors on an authored roll (levels are numbers)', () => {
  const v = tmpVault();
  fs.writeFileSync(path.join(v, ...LOCATIONS_REL.split('/'), 'The Pelican Rooms.md'), NOTE({ patch: PATCH, play: PLAY() }));
  const site = buildAuthored({ vault: v }).sites['The Pelican Rooms'];
  const roll = P.authoredRoll(L, FIXL, site);
  const floors = K.floors(roll);
  assert.ok(floors.length >= 1);
  const floorOf = {};
  floors.forEach((f) => f.rooms.forEach((r) => { floorOf[r.name] = f.lvl; }));
  ROOMS.forEach((n) => assert.ok(n in floorOf, 'the kit placed "' + n + '" on a floor: ' + JSON.stringify(floorOf)));
  assert.ok(Object.values(floorOf).every((n) => typeof n === 'number'));
  const home = floorOf[ROOMS[0]];
  ROOMS.forEach((n) => {
    const d = Math.abs(floorOf[n] - home);
    assert.equal(B.lensRating(n, { floors: [home] }, floorOf), d === 0 ? 'controlled' : d === 1 ? 'risky' : 'desperate');
  });
  const checked = B.checkPlay(PLAY(), ROOMS).play;
  const bv = B.ballView(checked, { t: 100, lens: 'cook' }, floorOf);
  assert.equal(bv.label, '19:40');
  ROOMS.forEach((n) => assert.equal(bv.rooms[n].lvl, floorOf[n]));
  /* the 'cook' disguise names rooms: ['Foyer'] and never: ['Roof garden']; every other room is rated from its floor */
  const rated = ROOMS.filter((n) => n !== 'Foyer' && n !== 'Roof garden');
  assert.ok(rated.length >= 1);
  rated.forEach((n) => assert.ok(['controlled', 'risky', 'desperate'].includes(bv.rooms[n].lens.pos), n + ' is rated, not unknown: ' + bv.rooms[n].lens.pos));
  assert.equal(bv.rooms.Foyer.lens.pos, 'controlled'); assert.equal(bv.rooms['Roof garden'].lens.pos, 'desperate');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
