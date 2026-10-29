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
  for (const [bad, re] of [[null, /not an object/], ['x', /not an object/], [[], /not an object/], [Object.assign(PLAY(), { v: 3 }), /v is 3, not 1/], [noClock, /clock needs start and end/], [badClock, /clock needs start and end/]]) {
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

test('ballView: an event with fx carries it into next (the False dawn button reads it); others carry no fx key', () => {
  const p = VIEWPLAY(); p.events.forEach((e) => { if (e.id === 'fw') e.fx = 'dawn'; });
  const nx = view({ t: B.minuteOf('23:59', START) }, p).next;
  assert.deepEqual(nx[0], { at: '00:00', label: 'Fireworks', room: 'Roof garden', fx: 'dawn' });
  assert.ok(view({ t: B.minuteOf('19:00', START) }, p).next.every((x) => x.label === 'Speeches' || !('fx' in x) || x.fx === 'dawn'));
  assert.ok(!('fx' in view({ t: B.minuteOf('19:00', START) }, p).next[0]), 'Speeches has none');
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

/* ---- play v2 (VV1): the engine ---------------------------------------------------------------------------------- */
const FX2 = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'pelican-play-v2.json'), 'utf8'));
const R2 = ['Showroom', 'Cocktail lounge', 'Underground counting room', 'Security control room', 'Private card rooms', 'Luxury penthouse'];
const fx2 = () => JSON.parse(JSON.stringify(FX2));
const run2 = (mut) => { const p = fx2(); if (mut) mut(p); return B.checkPlay(p, R2); };
const deepFreeze = (o) => { if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); Object.values(o).forEach(deepFreeze); } return o; };
const P2 = deepFreeze(B.checkPlay(fx2(), R2).play);          /* frozen: any mutation by the engine throws (ESM is strict) */
const T = (hhmm) => B.minuteOf(hhmm, '21:00');                 /* the fixture's clock starts at 21:00 */
const PUBLIC_ROOMS = ['Showroom', 'Cocktail lounge'];
const hasWarn = (r, re) => r.warnings.some((w) => re.test(w));
const oneWarn = (r, re) => { const n = r.warnings.filter((w) => re.test(w)).length; assert.equal(n, 1, 'exactly one warning like ' + re + ' in ' + JSON.stringify(r.warnings)); };

test('v2: the section 5 fixture checks clean, is not mutated, and every GM-only marker survives the check', () => {
  const src = fx2(), before = JSON.stringify(src);
  const r = B.checkPlay(src, R2);
  assert.deepEqual(r.warnings, []);
  assert.equal(JSON.stringify(src), before);
  assert.equal(r.play.v, 2);
  assert.equal(r.play.clock.beat, 15);
  assert.deepEqual(r.play.clock.starts, { crit: '21:00', '6': '21:30', '4/5': '21:45', '1-3': '22:00' });
  assert.deepEqual([r.play.zones.length, r.play.routes.length, r.play.people.length, r.play.disguises.length, r.play.items.length, r.play.events.length, r.play.ways.length, r.play.intel.length, r.play.entries.length, r.play.exits.length, r.play.secret.length], [4, 2, 4, 3, 1, 4, 2, 4, 1, 1, 1]);
  assert.equal(JSON.stringify(r.play).match(/GM-ONLY/g).length, JSON.stringify(FX2).match(/GM-ONLY/g).length, 'nothing the engine keeps is lost');
  assert.deepEqual(B.beatOf(r.play, 0), { n: 1, of: 16, i: 0 });
});

test('v2: unknown keys are carried through, at the top and on each item', () => {
  const r = run2((p) => { p.extra = { a: 1 }; p.zones[0].colour = 'red'; p.people[0].mood = 'calm'; p.ways[0].tag = 'x'; p.intel[0].more = 1; p.items[0].weight = 2; p.alarm.skin = 's'; });
  assert.deepEqual(r.warnings, []);
  assert.deepEqual(r.play.extra, { a: 1 });
  assert.equal(r.play.zones[0].colour, 'red'); assert.equal(r.play.people[0].mood, 'calm'); assert.equal(r.play.ways[0].tag, 'x');
  assert.equal(r.play.intel[0].more, 1); assert.equal(r.play.items[0].weight, 2); assert.equal(r.play.alarm.skin, 's');
});

test('v2: v1 is unchanged; v 3 and v 0 are dropped whole; the v1 fixture still checks clean', () => {
  const a = B.checkPlay(PLAY(), ROOMS);
  assert.deepEqual(a.warnings, []); assert.equal(a.play.v, 1); assert.equal(a.play.clock.step, 30); assert.equal(a.play.clock.beat, undefined);
  assert.equal(a.play.zones, undefined); assert.equal(a.play.items, undefined); assert.equal(a.play.ways, undefined);
  for (const v of [3, 0, '2', null]) { const r = B.checkPlay(Object.assign(fx2(), { v }), R2); assert.equal(r.play, null); assert.match(r.warnings[0], /not 1; the whole block is dropped/); }
  for (const k of ['zones', 'items', 'ways', 'intel', 'steps']) assert.ok(B.LIMITS[k] > 0, 'LIMITS.' + k);
  assert.deepEqual([B.LIMITS.zones, B.LIMITS.items, B.LIMITS.ways, B.LIMITS.intel, B.LIMITS.steps], [16, 24, 12, 40, 6]);
  assert.deepEqual([B.LIMITS.people, B.LIMITS.stops, B.LIMITS.routes, B.LIMITS.disguises, B.LIMITS.events, B.LIMITS.clocks, B.LIMITS.floors, B.LIMITS.rooms, B.LIMITS.text], [60, 40, 40, 24, 40, 24, 12, 40, 400]);
});

test('v2 clock: beat defaults to 15 and takes 5 to 60; starts keeps only crit, 6, 4/5, 1-3 inside the clock; start/end are required', () => {
  assert.equal(run2((p) => { delete p.clock.beat; }).play.clock.beat, 15);
  assert.equal(run2((p) => { p.clock.beat = 5; }).play.clock.beat, 5);
  assert.equal(run2((p) => { p.clock.beat = 60; }).play.clock.beat, 60);
  for (const bad of [4, 61, 7.5, '15', null]) { const r = run2((p) => { p.clock.beat = bad; }); assert.equal(r.play.clock.beat, 15); oneWarn(r, /clock\.beat/); }
  const r = run2((p) => { p.clock.starts = { crit: '21:00', '6': '2130', '4/5': '03:00', '1-3': '22:00', '2': '22:00', bonus: '22:10' }; });
  assert.deepEqual(r.play.clock.starts, { crit: '21:00', '1-3': '22:00' });
  oneWarn(r, /starts\["6"\].*not HH:MM/); oneWarn(r, /starts\["4\/5"\].*outside the clock/); oneWarn(r, /starts\["2"\]/); oneWarn(r, /starts\["bonus"\]/);
  const r2 = run2((p) => { p.clock.starts = 'now'; p.clock.label = 7; });
  assert.equal(r2.play.clock.starts, undefined); oneWarn(r2, /clock\.starts: not an object/); oneWarn(r2, /clock\.label/); assert.equal(r2.play.clock.label, undefined);
  for (const mut of [(p) => { delete p.clock; }, (p) => { p.clock.start = '9pm'; }, (p) => { delete p.clock.end; }]) {
    const x = run2(mut); assert.equal(x.play, null); assert.equal(x.warnings.length, 1); assert.match(x.warnings[0], /clock needs start and end/);
  }
});

test('v2 zones: a room in two zones stays in the first; unknown rooms, a missing label, empty zones and extras are dropped with one warning each', () => {
  const r = run2((p) => {
    p.zones[1].rooms.push('Showroom');                       /* already in 'floor' */
    p.zones[2].rooms.push('Attic');                          /* not in the site */
    p.zones.push({ id: 'nolabel', rooms: ['Pantry'] }, { id: 'empty', label: 'Nothing', rooms: ['Attic'] }, { id: 'floor', label: 'Dup', rooms: [] });
    p.zones[3].pub = 7;
  });
  assert.deepEqual(r.play.zones.map((z) => z.id), ['floor', 'back', 'cards', 'loft']);
  assert.deepEqual(r.play.zones[1].rooms, ['Underground counting room', 'Security control room']);
  assert.deepEqual(r.play.zones[2].rooms, ['Private card rooms']);
  oneWarn(r, /zones\[back\]\.rooms: "Showroom" is already in zone floor/); oneWarn(r, /zones\[cards\]\.rooms: "Attic" is not a room/);
  oneWarn(r, /zones\[nolabel\]: no label/); oneWarn(r, /zones\[empty\]: no rooms/); oneWarn(r, /id floor is used twice/); oneWarn(r, /zones\[loft\]\.pub: not text/);
  assert.equal(r.play.zones[3].pub, undefined);
  const many = run2((p) => { p.zones = Array.from({ length: 20 }, (_, i) => ({ id: 'z' + i, label: 'Z' + i, rooms: [R2[i % 6]] })); });
  assert.equal(many.play.zones.length <= 16, true); oneWarn(many, /play\.zones: 20 entries, keeping the first 16/);
});

test('v2 routes: v1 rules plus open windows and pub; a bad open list drops the route (it would otherwise be open all night)', () => {
  const r = run2((p) => {
    p.routes[1].open = [{ from: '23:00', to: '00:00' }, { from: '22:00', to: '21:30' }, { from: '9am', to: '10:00' }, 'x', { from: '23:30', to: '03:00' }];
    p.routes.push({ id: 'bad1', from: 'Showroom', to: 'Attic' }, { id: 'bad2', from: 'Showroom', to: 'Cocktail lounge', dir: 'sideways' }, { id: 'o1', from: 'Showroom', to: 'Cocktail lounge', open: 'always' }, { id: 'o2', from: 'Showroom', to: 'Cocktail lounge', open: [{ from: 'x' }] }, { id: 'p1', from: 'Showroom', to: 'Cocktail lounge', pub: 9 });
  });
  assert.deepEqual(r.play.routes.map((x) => x.id), ['lift', 'trap', 'p1']);
  assert.deepEqual(r.play.routes[1].open, [{ from: '23:00', to: '00:00' }]);
  assert.equal(r.play.routes[0].dir, 'up'); assert.equal(r.play.routes[2].dir, 'both'); assert.equal(r.play.routes[2].pub, undefined);
  oneWarn(r, /routes\[trap\]\.open\[1\]: 21:30 is not after 22:00/); oneWarn(r, /routes\[trap\]\.open\[2\]: needs from and to/); oneWarn(r, /routes\[trap\]\.open\[3\]/);
  oneWarn(r, /routes\[trap\]\.open\[4\]: 23:30 to 03:00 is outside the clock/);
  oneWarn(r, /routes\[bad1\]: to "Attic"/); oneWarn(r, /routes\[bad2\]: dir "sideways"/); oneWarn(r, /routes\[o1\]\.open: not a list; the route is dropped/); oneWarn(r, /routes\[o2\]\.open: no usable window/); oneWarn(r, /routes\[p1\]\.pub/);
});

test('v2 people: the three stop kinds, look and wary as text, with that is unknown, self or a loop, and gone', () => {
  const r = run2((p) => {
    p.people[1].stops.push({ at: '00:45', gone: true }, { at: '01:00', gone: false }, { at: '00:50', with: 5 }, { at: '00:55', with: 'nobody' }, { at: '00:56', with: 'wr' }, { at: '00:57', room: 'Attic' }, { at: 'late', room: 'Showroom' }, { at: '00:58' }, 'x');
    p.people[2].look = 4; p.people[2].wary = []; p.people[2].with = 'od';
    p.people.push({ id: 'lp1', label: 'Loop A', kind: 'staff', stops: [{ at: '21:00', with: 'lp2' }] }, { id: 'lp2', label: 'Loop B', kind: 'staff', stops: [{ at: '21:00', with: 'lp1' }, { at: '22:00', room: 'Showroom' }] });
    p.people.push({ id: 'empty', label: 'Nobody', kind: 'staff', stops: [] }, { id: 'badkind', label: 'X', kind: 'wizard', stops: [{ at: '21:00', room: 'Showroom' }] }, { id: 'nolabel', kind: 'guard', stops: [] });
  });
  const wr = r.play.people.find((x) => x.id === 'wr');
  assert.deepEqual(wr.stops.map((s) => s.at), ['21:00', '23:00', '23:30', '00:45']);
  assert.deepEqual(wr.stops[3], { at: '00:45', gone: true }); assert.equal(wr.stops[0].with, 'od'); assert.equal(wr.stops[0].room, undefined);
  oneWarn(r, /people\[wr\]\.stops\[4\]: gone must be true/); oneWarn(r, /people\[wr\]\.stops\[5\]: with is not a person id/); oneWarn(r, /people\[wr\] stop at 00:55: with "nobody" is not a person/);
  oneWarn(r, /people\[wr\] stop at 00:56: follows itself/); oneWarn(r, /people\[wr\]\.stops\[8\]: room "Attic"/); oneWarn(r, /people\[wr\]\.stops\[9\]: time "late"/); oneWarn(r, /people\[wr\]\.stops\[10\]: room undefined/); oneWarn(r, /people\[wr\]\.stops\[11\]: not an object/);
  const pq = r.play.people.find((x) => x.id === 'pq');
  assert.equal(pq.look, undefined); assert.equal(pq.wary, undefined); assert.equal(pq.with, undefined);
  oneWarn(r, /people\[pq\]\.look: not text/); oneWarn(r, /people\[pq\]\.wary: not text/); oneWarn(r, /people\[pq\]\.with: a v2 person follows through a stop/);
  /* the loop: lp1 follows lp2 (kept); lp2's stop that follows lp1 would close it (dropped), and lp2 keeps its room stop */
  assert.equal(r.play.people.find((x) => x.id === 'lp1').stops[0].with, 'lp2');
  assert.deepEqual(r.play.people.find((x) => x.id === 'lp2').stops.map((s) => s.room), ['Showroom']);
  oneWarn(r, /people\[lp2\] stop at 21:00: with "lp1" would lead back to lp2/);
  assert.equal(r.play.people.some((x) => ['empty', 'badkind', 'nolabel'].includes(x.id)), false);
  oneWarn(r, /people\[empty\]: no usable stop/); oneWarn(r, /people\[badkind\]: kind "wizard"/); oneWarn(r, /people\[nolabel\]: no label/);
  /* a person whose only stops follow someone who is dropped goes too */
  const chain = run2((p) => { p.people.push({ id: 'f1', label: 'F', kind: 'staff', stops: [{ at: '21:00', with: 'ghost' }] }); });
  assert.equal(chain.play.people.some((x) => x.id === 'f1'), false); oneWarn(chain, /people\[f1\] stop at 21:00: with "ghost"/); oneWarn(chain, /people\[f1\]: no usable stop/);
});

test('v2 disguises: home/risky name zones, homeRooms/riskyRooms/never name rooms, sees names people; unknowns drop one by one', () => {
  const r = run2((p) => {
    p.disguises[0].home.push('moon'); p.disguises[0].riskyRooms = ['Showroom', 'Attic']; p.disguises[0].never = 'Showroom';
    p.disguises[1].sees.push('ghost'); p.disguises[1].icon = 3; p.disguises[1].get = {}; p.disguises[2].homeRooms = ['Luxury penthouse', 7];
    p.disguises.push({ label: 'No id' }, { id: 'nolabel' }, { id: 'bare', label: 'Bare' });
  });
  assert.deepEqual(r.play.disguises[0].home, ['floor']); assert.deepEqual(r.play.disguises[0].riskyRooms, ['Showroom']); assert.equal(r.play.disguises[0].never, undefined);
  assert.deepEqual(r.play.disguises[1].sees, ['pq']); assert.equal(r.play.disguises[1].icon, undefined); assert.equal(r.play.disguises[1].get, undefined);
  assert.deepEqual(r.play.disguises[2].homeRooms, ['Luxury penthouse']);
  assert.deepEqual(r.play.disguises.map((d) => d.id), ['guest', 'cook', 'guard', 'bare']);
  oneWarn(r, /disguises\[guest\]\.home: "moon" is not a zone/); oneWarn(r, /disguises\[guest\]\.riskyRooms: "Attic" is not a room/); oneWarn(r, /disguises\[guest\]\.never: not a list/);
  oneWarn(r, /disguises\[cook\]\.sees: "ghost" is not a person/); oneWarn(r, /disguises\[cook\]\.icon/); oneWarn(r, /disguises\[cook\]\.get/); oneWarn(r, /disguises\[guard\]\.homeRooms: 7 is not a room/);
  oneWarn(r, /disguises\[3\]: no id/); oneWarn(r, /disguises\[nolabel\]: no label/);
  assert.equal(r.play.disguises[3].home, undefined);
});

test('v2 items: lift names a zone and risky or controlled; label is required; pub is text', () => {
  const r = run2((p) => {
    p.items[0].lift.push({ zone: 'moon', to: 'risky' }, { zone: 'back', to: 'desperate' }, 'x'); p.items[0].pub = 5;
    p.items.push({ id: 'nolabel' }, { id: 'badlift', label: 'B', lift: 'all' }, { id: 'ok', label: 'Fine', lift: [{ zone: 'cards', to: 'controlled' }] });
  });
  assert.deepEqual(r.play.items[0].lift, [{ zone: 'loft', to: 'risky' }]); assert.equal(r.play.items[0].pub, undefined);
  assert.deepEqual(r.play.items.map((i) => i.id), ['key', 'badlift', 'ok']); assert.equal(r.play.items[1].lift, undefined);
  oneWarn(r, /items\[key\]\.lift\[1\]: zone "moon"/); oneWarn(r, /items\[key\]\.lift\[2\]: to "desperate"/); oneWarn(r, /items\[key\]\.lift\[3\]: zone "x"/); oneWarn(r, /items\[key\]\.pub/); oneWarn(r, /items\[nolabel\]: no label/); oneWarn(r, /items\[badlift\]\.lift: not a list/);
  const many = run2((p) => { p.items = Array.from({ length: 30 }, (_, i) => ({ id: 'i' + i, label: 'I' + i })); });
  assert.equal(many.play.items.length, 24); oneWarn(many, /play\.items: 30 entries, keeping the first 24/);
});

test('v2 events: vis defaults to hidden (fail closed); pub, say and rival are typed; v1 drops still apply; sorted past midnight', () => {
  const r = run2((p) => {
    delete p.events[0].vis; p.events[1].vis = 'loud'; p.events[2].pub = 4; p.events[2].say = null; p.events[3].rival = 'yes';
    p.events.push({ id: 'late', at: '9am', label: 'x' }, { id: 'nolabel', at: '22:00' }, { id: 'badroom', at: '22:00', label: 'x', room: 'Attic' }, { id: 'early', at: '21:05', label: 'GM-ONLY-E', vis: 'seen', room: 'Showroom', pub: 'Early' });
  });
  assert.deepEqual(r.play.events.map((e) => e.id), ['early', 'sp', 'cr', 'fw', 'sh']);
  assert.equal(r.play.events[1].vis, 'hidden'); assert.equal(r.play.events[2].vis, 'hidden'); assert.equal(r.play.events[0].vis, 'seen');
  assert.equal(r.play.events[3].pub, undefined); assert.equal(r.play.events[3].say, undefined); assert.equal(r.play.events[4].rival, undefined);
  oneWarn(r, /events\[cr\]: vis "loud"/); oneWarn(r, /events\[fw\]\.pub/); oneWarn(r, /events\[sh\]\.rival/); oneWarn(r, /events\[late\]: time "9am"/); oneWarn(r, /events\[nolabel\]: time|events\[nolabel\]: no label/); oneWarn(r, /events\[badroom\]: room "Attic"/);
  oneWarn(r, /events\[fw\]\.say/);
});

test('v2 ways: kind, window, lead, steps (at most 6), needs and told each drop alone; the way survives', () => {
  const r = run2((p) => {
    const a = p.ways[0], b = p.ways[1];
    a.kind = 'sneaky'; a.window.until = '23:00'; a.window.room = 'Attic'; a.window.pub = 3; a.window.told = 'nothing'; a.pubName = 9; a.cost = []; a.steps = ['1', '2', '3', '4', '5', '6', '7', 8];
    b.window = { until: '23:00' }; b.lead.from = '23:00'; b.lead.to = '22:00'; b.needs = ['key', 'crowbar'];
    p.ways.push({ id: 'C', name: 'C', lead: { line: 'L', from: '21:00', to: '22:00', room: 'Attic' }, window: 'soon', steps: 'one', needs: 'key' }, { id: 'D', pubName: 'no name' }, { id: 'E', name: 'E', lead: { line: 5, from: '21:00', to: '22:00' } });
  });
  const [a, b, c] = r.play.ways;
  assert.deepEqual(r.play.ways.map((w) => w.id), ['A', 'B', 'C', 'E']);
  assert.equal(a.kind, 'either'); assert.equal(a.window.until, undefined); assert.equal(a.window.room, undefined); assert.equal(a.window.pub, undefined); assert.equal(a.window.told, undefined); assert.equal(a.pubName, undefined); assert.equal(a.cost, undefined);
  assert.equal(a.steps.length, 6);
  assert.equal(b.window, undefined); assert.equal(b.lead, undefined); assert.deepEqual(b.needs, ['key']);
  assert.equal(c.window, undefined); assert.equal(c.lead, undefined); assert.deepEqual(c.steps, []); assert.equal(c.needs, undefined);
  assert.equal(r.play.ways[3].lead, undefined);
  for (const re of [/ways\[A\]: kind "sneaky"/, /ways\[A\]\.window\.until: "23:00"/, /ways\[A\]\.window\.room: "Attic"/, /ways\[A\]\.window\.pub/, /ways\[A\]\.window\.told: "nothing" is not an intel item or an event/, /ways\[A\]\.pubName/, /ways\[A\]\.cost/,
    /ways\[A\]\.steps: 7 steps, keeping the first 6/, /ways\[A\]\.steps\[7\]/, /ways\[B\]\.window: needs at/, /ways\[B\]\.lead: needs from and to/, /ways\[B\]\.needs: "crowbar" is not an item/, /ways\[C\]\.window: not an object/, /ways\[C\]\.lead\.room: "Attic"/, /ways\[C\]\.steps: not a list/, /ways\[C\]\.needs: not a list/, /ways\[D\]: no name/, /ways\[E\]\.lead: no line/]) oneWarn(r, re);
  assert.equal(B.checkPlay(fx2(), R2).play.ways[0].window.told, 'cr', 'an event id is a valid told');
  const intelTold = run2((p) => { p.ways[1].window = { at: '00:15', told: 'I3' }; });
  assert.equal(intelTold.play.ways[1].window.told, 'I3'); assert.deepEqual(intelTold.warnings, []);
  const many = run2((p) => { p.ways = Array.from({ length: 14 }, (_, i) => ({ id: 'w' + i, name: 'W' })); });
  assert.equal(many.play.ways.length, 12); oneWarn(many, /play\.ways: 14 entries, keeping the first 12/);
});

test('v2 intel: text is required, from is text, reveals names only events, ways and routes that exist; cap 40', () => {
  const r = run2((p) => {
    p.intel[0].reveals.events.push('nope'); p.intel[1].reveals.ways = 'A'; p.intel[2].reveals = 'all'; p.intel[3].from = 8;
    p.intel.push({ id: 'I9', reveals: {} }, { id: 'I10', text: 'x', reveals: { routes: ['trap', 'ghost'], events: [], ways: ['B'] } });
  });
  assert.deepEqual(r.play.intel[0].reveals.events, ['sp', 'fw']); assert.equal(r.play.intel[1].reveals.ways, undefined); assert.deepEqual(r.play.intel[1].reveals.events, ['cr']);
  assert.equal(r.play.intel[2].reveals, undefined); assert.equal(r.play.intel[3].from, undefined);
  assert.deepEqual(r.play.intel[4].reveals, { routes: ['trap'], events: [], ways: ['B'] }); assert.equal(r.play.intel.length, 5);
  oneWarn(r, /intel\[I1\]\.reveals\.events: "nope"/); oneWarn(r, /intel\[I2\]\.reveals\.ways: not a list/); oneWarn(r, /intel\[I3\]\.reveals: not an object/); oneWarn(r, /intel\[I4\]\.from/); oneWarn(r, /intel\[I9\]: no text/); oneWarn(r, /intel\[I10\]\.reveals\.routes: "ghost"/);
  const many = run2((p) => { p.intel = Array.from({ length: 45 }, (_, i) => ({ id: 'n' + i, text: 'T' })); });
  assert.equal(many.play.intel.length, 40); oneWarn(many, /play\.intel: 45 entries, keeping the first 40/);
});

test('v2 alarm, entries, exits and secret: typed, capped, and dropped one by one', () => {
  const r = run2((p) => { p.alarm.beats[1] = 5; p.alarm.ticks.push({ why: 'x', by: 0 }, 'x'); p.alarm.at = { '5': 'skip-private', '6': 'lockdown', '7': 'lockdown', '3': 'explode', x: 'lockdown' }; });
  assert.equal(r.play.alarm.beats[1], ''); assert.equal(r.play.alarm.ticks.length, 1); assert.deepEqual(r.play.alarm.at, { '5': 'skip-private', '6': 'lockdown' });
  oneWarn(r, /alarm\.beats\[1\]: not text; blanked/); oneWarn(r, /alarm\.ticks\[1\]: needs by/); oneWarn(r, /alarm\.ticks\[2\]/); oneWarn(r, /alarm\.at\["7"\]: not a segment of the alarm \(1 to 6\)/); oneWarn(r, /alarm\.at\["3"\]: "explode"/); oneWarn(r, /alarm\.at\["x"\]/);
  assert.equal(run2((p) => { p.alarm.clock = ''; }).play.alarm, undefined); assert.equal(run2((p) => { p.alarm = 'x'; }).play.alarm, undefined);
  assert.equal(run2((p) => { delete p.alarm; }).play.alarm, undefined);
  assert.deepEqual(run2((p) => { p.alarm.pub = 'x'; p.alarm.beats = 'y'; }).play.alarm.pub, []);
  const long = run2((p) => { p.alarm.pub = Array.from({ length: 15 }, (_, i) => 'p' + i); });
  assert.equal(long.play.alarm.pub.length, 12); oneWarn(long, /alarm\.pub: 15 entries, keeping the first 12/);
  const e = run2((p) => { p.entries[0].room = 'Attic'; p.entries[0].disguise = 'wizard'; p.exits[0].from = 'Attic'; p.entries.push({ id: 'x' }); p.secret.push(5, 'Thank R.'); });
  assert.equal(e.play.entries[0].room, undefined); assert.equal(e.play.entries[0].disguise, undefined); assert.equal(e.play.exits[0].from, undefined); assert.equal(e.play.entries.length, 1);
  assert.deepEqual(e.play.secret, ['GM-ONLY-SECRET-1', 'Thank R.']);
  oneWarn(e, /entries\[front\]\.room: "Attic"/); oneWarn(e, /entries\[front\]\.disguise: "wizard"/); oneWarn(e, /exits\[lift\]\.from: "Attic"/); oneWarn(e, /entries\[x\]: no label/); oneWarn(e, /secret\[1\]: not text/);
  assert.deepEqual(run2((p) => { delete p.secret; }).play.secret, []); assert.deepEqual(run2((p) => { p.secret = 'x'; }).play.secret, []);
});

test('v2 whereAt: stops sort from clock.start across midnight; with follows from its time; gone is nowhere', () => {
  const by = Object.fromEntries(P2.people.map((p) => [p.id, p])), at = (id, hhmm, over) => B.whereAt(by[id], T(hhmm), by, '21:00', { over });
  assert.equal(B.whereAt(by.od, T('21:00'), by, '21:00', {}).room, 'Showroom');
  assert.equal(at('od', '23:29').room, 'Showroom'); assert.equal(at('od', '23:30').room, 'Private card rooms'); assert.equal(at('od', '00:14').room, 'Private card rooms'); assert.equal(at('od', '00:15').room, 'Luxury penthouse'); assert.equal(at('od', '01:00').room, 'Luxury penthouse');
  assert.equal(T('00:15'), 195, '00:15 is after 23:30 on this clock');
  assert.equal(at('wr', '21:00').room, 'Showroom'); assert.equal(at('wr', '22:59').room, 'Showroom'); assert.equal(at('wr', '23:00').room, 'Security control room');
  assert.equal(at('wr', '23:29').room, 'Security control room'); assert.equal(at('wr', '23:30').room, 'Private card rooms'); assert.equal(at('wr', '00:15').room, 'Luxury penthouse', 'Wren follows Odette upstairs');
  assert.equal(at('iv', '00:29').room, 'Security control room'); assert.equal(at('iv', '00:30'), null); assert.equal(at('iv', '01:00'), null);
  assert.equal(at('pq', '23:59').room, 'Cocktail lounge'); assert.equal(at('pq', '00:00').room, 'Underground counting room');
  assert.equal(B.whereAt(by.od, -5, by, '21:00', {}), null, 'before the first stop: not there yet');
  /* moving: five minutes before a stop in a different room */
  assert.deepEqual(at('od', '23:25').moving, { to: 'Private card rooms', inMin: 5 }); assert.equal(at('od', '23:24').moving, null);
  assert.deepEqual(at('wr', '22:55').moving, { to: 'Security control room', inMin: 5 });
  assert.deepEqual(at('wr', '23:25').moving, { to: 'Private card rooms', inMin: 5 }, 'towards where Odette will be');
  /* a follower of someone who is gone is nowhere */
  assert.equal(at('wr', '23:30', { od: { gone: true } }), null); assert.equal(at('wr', '21:00', { od: { gone: true } }), null);
  assert.equal(at('wr', '23:15', { od: { gone: true } }).room, 'Security control room', 'its own stops still hold');
  /* the v1 call is untouched */
  assert.equal(B.whereAt(by.pq, T('23:00'), by, '21:00').room, 'Cocktail lounge');
});

test('v2 whereAt overrides: delay shifts every stop after the first, skip drops stops by index, at pins a room, gone ends it', () => {
  const by = Object.fromEntries(P2.people.map((p) => [p.id, p])), at = (id, hhmm, o) => B.whereAt(by[id], T(hhmm), by, '21:00', { over: o });
  const d = { od: { delay: 20 } };
  assert.equal(at('od', '21:00', d).room, 'Showroom'); assert.equal(at('od', '23:30', d).room, 'Showroom'); assert.equal(at('od', '23:49', d).room, 'Showroom'); assert.equal(at('od', '23:50', d).room, 'Private card rooms'); assert.equal(at('od', '00:35', d).room, 'Luxury penthouse');
  assert.equal(at('wr', '23:30', d).room, 'Showroom', 'Wren\'s 23:30 stop follows Odette, who is delayed in the showroom');
  assert.equal(at('wr', '23:50', d).room, 'Private card rooms');
  assert.equal(at('od', '23:30', { od: { delay: 0 } }).room, 'Private card rooms'); assert.equal(at('od', '23:30', { od: { delay: -15 } }).room, 'Private card rooms');
  assert.equal(at('od', '23:15', { od: { delay: -15 } }).room, 'Private card rooms', 'a negative delay moves later stops earlier');
  const s = { od: { skip: [1] } };
  assert.equal(at('od', '23:30', s).room, 'Showroom'); assert.equal(at('od', '00:15', s).room, 'Luxury penthouse'); assert.equal(at('od', '00:15', { od: { skip: [1, 2] } }).room, 'Showroom'); assert.equal(at('od', '00:15', { od: { skip: [0, 1, 2] } }), null);
  assert.equal(at('od', '22:00', { od: { skip: [0] } }), null, 'skipping the only earlier stop leaves him nowhere yet');
  const pin = { od: { at: 'Cocktail lounge' } };
  assert.equal(at('od', '21:00', pin).room, 'Cocktail lounge'); assert.equal(at('od', '23:30', pin).room, 'Cocktail lounge'); assert.equal(B.whereAt(by.od, -5, by, '21:00', { over: pin }).room, 'Cocktail lounge'); assert.equal(at('od', '23:30', pin).moving, null);
  assert.equal(at('wr', '23:30', pin).room, 'Cocktail lounge', 'a follower follows the pinned room');
  assert.equal(at('od', '23:30', { od: { at: 'Cocktail lounge', gone: true } }), null, 'gone beats at');
  assert.equal(at('od', '21:00', { od: { gone: true } }), null);
  assert.equal(at('od', '23:30', { od: { at: '' } }).room, 'Private card rooms', 'an empty pin is cleared');
  assert.equal(at('od', '23:30', { pq: { gone: true } }).room, 'Private card rooms', 'other people are unaffected');
  assert.equal(at('od', '23:30', null).room, 'Private card rooms');
  const pl = B.placesAt(P2, { over: { iv: { at: 'Showroom' } } }, T('22:00'));
  assert.equal(pl.iv.room, 'Showroom'); assert.equal(pl.od.room, 'Showroom'); assert.equal(pl.wr.room, 'Showroom');
  assert.equal(B.placesAt(P2, {}, T('00:45')).iv, null);
});

const crewS = (o) => Object.assign({ crew: {} }, o);
test('v2 positionOf: every zone for every costume, room overrides, lifts, noticed and blown', () => {
  const pos = (disguise, room, extra) => B.positionOf(P2, crewS({ crew: { a: Object.assign({ room, disguise }, extra) } }), 'a');
  const rooms = { floor: 'Showroom', back: 'Security control room', cards: 'Private card rooms', loft: 'Luxury penthouse' };
  const want = { guest: { floor: 'controlled', back: 'desperate', cards: 'risky', loft: 'desperate' }, cook: { floor: 'risky', back: 'controlled', cards: 'desperate', loft: 'desperate' }, guard: { floor: 'controlled', back: 'controlled', cards: 'risky', loft: 'risky' } };
  for (const d of Object.keys(want)) for (const z of Object.keys(rooms)) assert.equal(pos(d, rooms[z]).pos, want[d][z], d + ' in ' + z);
  assert.equal(pos('guest', 'Cocktail lounge').pos, 'controlled', 'the second room of a zone');
  assert.match(pos('guard', 'Showroom').why, /home zone The floor/); assert.match(pos('guard', 'Private card rooms').why, /risky zone/); assert.match(pos('cook', 'Private card rooms').why, /not a zone this costume works in/);
  /* no costume, no room, an unknown disguise */
  assert.deepEqual(pos(undefined, 'Showroom'), { pos: 'desperate', why: 'no costume' }); assert.equal(pos('wizard', 'Showroom').pos, 'desperate'); assert.deepEqual(pos('guest', ''), { pos: 'desperate', why: 'no room' });
  assert.equal(B.positionOf(P2, crewS(), 'nobody').pos, 'desperate');
  /* room overrides beat zones: never, homeRooms, riskyRooms */
  const over = (mut, d, room) => { const p = fx2(); mut(p); const pl = B.checkPlay(p, R2).play; return B.positionOf(pl, crewS({ crew: { a: { room, disguise: d } } }), 'a'); };
  assert.deepEqual(over((p) => { p.disguises[2].never = ['Showroom']; }, 'guard', 'Showroom'), { pos: 'desperate', why: 'never in Showroom' });
  assert.equal(over((p) => { p.disguises[2].never = ['Showroom']; }, 'guard', 'Cocktail lounge').pos, 'controlled');
  assert.equal(over((p) => { p.disguises[0].homeRooms = ['Private card rooms']; }, 'guest', 'Private card rooms').pos, 'controlled');
  assert.equal(over((p) => { p.disguises[0].homeRooms = ['Private card rooms']; }, 'guest', 'Showroom').pos, 'controlled');
  assert.equal(over((p) => { p.disguises[2].riskyRooms = ['Showroom']; }, 'guard', 'Showroom').pos, 'risky', 'riskyRooms lowers a room inside a home zone');
  assert.equal(over((p) => { p.disguises[1].riskyRooms = ['Luxury penthouse']; }, 'cook', 'Luxury penthouse').pos, 'risky');
  assert.equal(over((p) => { p.disguises[2].never = ['Showroom']; p.disguises[2].homeRooms = ['Showroom']; }, 'guard', 'Showroom').pos, 'desperate', 'never wins');
  /* lifts: the key makes the loft risky for a costume that would be desperate there; it never lowers, and only its zone */
  assert.deepEqual(pos('guest', 'Luxury penthouse', { items: ['key'] }), { pos: 'risky', why: 'not a zone this costume works in (The loft); lifted by A brass key' });
  assert.equal(pos('guest', 'Luxury penthouse', { items: [] }).pos, 'desperate'); assert.equal(pos('guest', 'Luxury penthouse', { items: ['other'] }).pos, 'desperate');
  assert.equal(pos('guard', 'Luxury penthouse', { items: ['key'] }).pos, 'risky'); assert.equal(pos('guard', 'Showroom', { items: ['key'] }).pos, 'controlled'); assert.equal(pos('cook', 'Security control room', { items: ['key'] }).pos, 'controlled');
  const best = (() => { const p = fx2(); p.items.push({ id: 'pass', label: 'Pass', lift: [{ zone: 'loft', to: 'controlled' }] }); p.items.push({ id: 'dud', label: 'Dud', lift: [{ zone: 'loft', to: 'risky' }] }); const pl = B.checkPlay(p, R2).play; return (items) => B.positionOf(pl, crewS({ crew: { a: { room: 'Luxury penthouse', disguise: 'guest', items } } }), 'a').pos; })();
  assert.equal(best(['key', 'pass', 'dud']), 'controlled', 'the best lift wins'); assert.equal(best(['dud', 'key']), 'risky');
  assert.equal(over((p) => { p.disguises[0].never = ['Luxury penthouse']; }, 'guest', 'Luxury penthouse').pos, 'desperate');
  /* noticed: one step worse, after the lift */
  assert.equal(pos('guest', 'Showroom', { noticed: true }).pos, 'risky'); assert.equal(pos('guest', 'Private card rooms', { noticed: true }).pos, 'desperate'); assert.equal(pos('guest', 'Security control room', { noticed: true }).pos, 'desperate');
  assert.equal(pos('guest', 'Luxury penthouse', { items: ['key'], noticed: true }).pos, 'desperate'); assert.equal(pos('guard', 'Showroom', { noticed: true }).why, 'home zone The floor; noticed');
  assert.equal(pos('guest', 'Showroom', { noticed: false }).pos, 'controlled');
  /* blown: only the costume in the list */
  assert.deepEqual(pos('guard', 'Showroom', { blown: ['guard'] }), { pos: 'desperate', why: 'home zone The floor; blown' }); assert.equal(pos('guard', 'Showroom', { blown: ['cook', 'guest'] }).pos, 'controlled'); assert.equal(pos('guest', 'Showroom', { blown: ['guest'], items: ['key'], noticed: true }).pos, 'desperate');
  /* a room in no zone */
  const oz = (() => { const p = fx2(); p.zones[0].rooms = ['Showroom']; return B.checkPlay(p, R2).play; })();
  assert.equal(B.positionOf(oz, crewS({ crew: { a: { room: 'Cocktail lounge', disguise: 'guest' } } }), 'a').pos, 'desperate'); assert.equal(B.positionOf(oz, crewS({ crew: { a: { room: 'Cocktail lounge', disguise: 'guest' } } }), 'a').why, 'no zone');
});

test('v2 lookers: here (in the room now) and soon (there by t + beat); only people the costume sees through', () => {
  const lk = (pcState, hhmm) => B.lookers(P2, crewS({ crew: { a: pcState } }), 'a', T(hhmm));
  const ids = (l) => l.map((x) => x.id);
  /* a guard in the showroom sees Wren (with Odette, 21:00 to 22:59) */
  let l = lk({ room: 'Showroom', disguise: 'guard' }, '21:00');
  assert.deepEqual(ids(l.here), ['wr']); assert.deepEqual(l.soon, []); assert.deepEqual(l.here[0], { id: 'wr', label: 'Wren Tully', look: 'A tall man in a grey coat', wary: 'GM-ONLY-WARY-1' });
  l = lk({ room: 'Showroom', disguise: 'guard' }, '22:59'); assert.deepEqual(ids(l.here), ['wr']);
  l = lk({ room: 'Showroom', disguise: 'guard' }, '23:00'); assert.deepEqual(ids(l.here), []); assert.deepEqual(l.soon, []);
  /* soon: Wren arrives in the card rooms at 23:30; from 23:15 the beat reaches it, and `at`/inMin say when */
  l = lk({ room: 'Private card rooms', disguise: 'guard' }, '23:15'); assert.deepEqual(ids(l.soon), ['wr']); assert.equal(l.soon[0].at, T('23:30')); assert.equal(l.soon[0].inMin, 15); assert.deepEqual(l.here, []);
  l = lk({ room: 'Private card rooms', disguise: 'guard' }, '23:14'); assert.deepEqual(l.soon, []);
  l = lk({ room: 'Private card rooms', disguise: 'guard' }, '23:30'); assert.deepEqual(ids(l.here), ['wr']); assert.deepEqual(l.soon, []);
  /* the cook sees Pip (not Wren): Pip is in the lounge until midnight, then the counting room */
  assert.deepEqual(ids(lk({ room: 'Cocktail lounge', disguise: 'cook' }, '23:00').here), ['pq']); assert.deepEqual(ids(lk({ room: 'Showroom', disguise: 'cook' }, '21:00').here), []);
  l = lk({ room: 'Underground counting room', disguise: 'cook' }, '23:45'); assert.deepEqual(ids(l.soon), ['pq']); assert.equal(l.soon[0].inMin, 15);
  assert.deepEqual(ids(lk({ room: 'Underground counting room', disguise: 'cook' }, '00:00').here), ['pq']);
  /* a guest sees nobody; no costume, no room: nobody */
  assert.deepEqual(lk({ room: 'Showroom', disguise: 'guest' }, '21:00'), { here: [], soon: [] }); assert.deepEqual(lk({ room: 'Showroom' }, '21:00'), { here: [], soon: [] }); assert.deepEqual(lk({ disguise: 'guard' }, '21:00'), { here: [], soon: [] });
  /* overrides count: Wren held in the lounge by the GM is not in the showroom */
  const held = B.lookers(P2, { crew: { a: { room: 'Showroom', disguise: 'guard' } }, over: { wr: { at: 'Cocktail lounge' } } }, 'a', T('21:00'));
  assert.deepEqual(held.here, []);
});

test('v2 routesAt: untimed routes always; the trapdoor only from 23:00 up to but not including 00:00', () => {
  const ids = (t) => B.routesAt(P2, t).map((r) => r.id);
  assert.deepEqual(ids(T('21:00')), ['lift']); assert.deepEqual(ids(T('22:59')), ['lift']); assert.deepEqual(ids(T('23:00')), ['lift', 'trap']); assert.deepEqual(ids(T('23:59')), ['lift', 'trap']); assert.deepEqual(ids(T('00:00')), ['lift']); assert.deepEqual(ids(T('01:00')), ['lift']);
  const two = (() => { const p = fx2(); p.routes[1].open.push({ from: '21:30', to: '22:00' }); return B.checkPlay(p, R2).play; })();
  assert.deepEqual(B.routesAt(two, T('21:45')).map((r) => r.id), ['lift', 'trap']); assert.deepEqual(B.routesAt(two, T('22:00')).map((r) => r.id), ['lift']);
  assert.deepEqual(B.routesAt(null, 0), []);
});

test('v2 leadsInReach: per PC, a way whose lead is said in the PC\'s room inside its from-to, until that PC has heard it', () => {
  const st = (crew, heard) => ({ crew, heard: heard || {} });
  const f = (state, hhmm) => B.leadsInReach(P2, state, T(hhmm)).map((l) => l.way + ':' + l.pc);
  const crew = { a: { room: 'Cocktail lounge' }, b: { room: 'Underground counting room' }, c: { room: 'Showroom' } };
  assert.deepEqual(f(st(crew), '21:00'), ['A:a', 'B:b']);
  assert.deepEqual(f(st(crew), '22:59'), ['A:a', 'B:b']); assert.deepEqual(f(st(crew), '23:00'), ['B:b'], 'A\'s lead ends at 23:00'); assert.deepEqual(f(st(crew), '00:00'), [], 'B\'s lead ends at 00:00 (to is exclusive)');
  assert.deepEqual(f(st(crew, { A: { a: 100 } }), '21:00'), ['B:b'], 'heard by a: gone for a'); assert.deepEqual(f(st(crew, { A: { c: 100 } }), '21:00'), ['A:a', 'B:b'], 'heard by someone else: still in reach');
  assert.deepEqual(f(st({ a: { room: 'Cocktail lounge' }, a2: { room: 'Cocktail lounge' } }, { A: { a: 5 } }), '21:30'), ['A:a2']);
  assert.deepEqual(f(st({ c: { room: 'Showroom' } }), '21:00'), []);
  const l = B.leadsInReach(P2, st(crew), T('21:00'))[0];
  assert.deepEqual(l, { way: 'A', pc: 'a', line: 'She never leaves a table while she\'s winning.', who: 'GM-ONLY-WHO-1', room: 'Cocktail lounge', name: 'GM-ONLY-NAME-1' });
  const anywhere = (() => { const p = fx2(); delete p.ways[0].lead.room; return B.checkPlay(p, R2).play; })();
  assert.deepEqual(B.leadsInReach(anywhere, st({ c: { room: 'Showroom' } }), T('21:00')).map((x) => x.way), ['A'], 'a lead with no room is in reach everywhere');
  assert.deepEqual(B.leadsInReach(P2, {}, 0), []);
});

test('v2 helpers: beatOf counts from clock.start and clamps; timeLabel wraps; inMin never goes below zero', () => {
  assert.deepEqual(B.beatOf(P2, 0), { n: 1, of: 16, i: 0 }); assert.deepEqual(B.beatOf(P2, 14), { n: 1, of: 16, i: 0 }); assert.deepEqual(B.beatOf(P2, 15), { n: 2, of: 16, i: 1 }); assert.deepEqual(B.beatOf(P2, 225), { n: 16, of: 16, i: 15 }); assert.deepEqual(B.beatOf(P2, 999), { n: 16, of: 16, i: 15 }); assert.deepEqual(B.beatOf(P2, -5), { n: 1, of: 16, i: 0 });
  const half = (() => { const p = fx2(); p.clock.end = '01:30'; p.clock.beat = 30; return B.checkPlay(p, R2).play; })();
  assert.equal(B.beatOf(half, 0).of, 9); assert.equal(B.beatOf(half, 30).n, 2);
  assert.equal(B.timeLabel(P2, 0), '21:00'); assert.equal(B.timeLabel(P2, 195), '00:15'); assert.equal(B.timeLabel('21:00', 240), '01:00'); assert.equal(B.timeLabel('23:50', 15), '00:05'); assert.equal(B.timeLabel(P2, -15), '20:45'); assert.equal(B.timeLabel(P2.clock, 60), '22:00'); assert.equal(B.timeLabel('x', 5), ''); assert.equal(B.timeLabel(P2, NaN), '');
  assert.equal(B.inMin(10, 25), 15); assert.equal(B.inMin(25, 10), 0); assert.equal(B.inMin(10, 10), 0);
});

const SAY = (p) => p.items.filter((i) => i.type === 'event').map((i) => i.say).filter(Boolean);
test('v2 beatCard: typed items in speaking order, the target\'s moves, lookers, routes, gone, leads, then next; back for an earlier time', () => {
  const crew = { a: { room: 'Showroom', disguise: 'guard' }, b: { room: 'Underground counting room', disguise: 'cook' } };
  const st = { crew, heard: {} };
  const card = (t0, t1, s) => B.beatCard(P2, s || st, T(t0), T(t1));
  const types = (c) => c.items.map((i) => i.type);
  /* 21:00 */
  let c = B.beatCard(P2, st, 0, 0);
  assert.equal(c.back, false); assert.equal(c.t0, -15); assert.equal(c.t1, 0);
  assert.deepEqual(types(c), ['move', 'looker', 'lead', 'next']);
  assert.deepEqual(c.items[0], { type: 'move', at: '21:00', id: 'od', label: 'Odette Marsh', from: null, to: 'Showroom', note: 'GM-ONLY-NOTE-1' });
  assert.deepEqual(c.items[1], { type: 'looker', when: 'here', pc: 'a', id: 'wr', label: 'Wren Tully', look: 'A tall man in a grey coat', wary: 'GM-ONLY-WARY-1', pos: 'controlled', at: '21:00', arrived: true });
  assert.deepEqual(c.items[2], { type: 'lead', way: 'B', pc: 'b', line: 'The lift key hangs on the cook\'s hook.', who: 'GM-ONLY-WHO-2', room: 'Underground counting room', name: 'GM-ONLY-NAME-2' });
  assert.deepEqual(c.items[3], { type: 'next', what: 'event', id: 'sp', label: 'GM-ONLY-LABEL-1', room: 'Showroom', vis: 'public', pub: 'The speeches', at: '22:00', inMin: 60 });
  /* 23:30: the hidden card-table event lands, Odette moves, and the next thing is the fireworks */
  c = card('23:15', '23:30');
  assert.deepEqual(types(c), ['event', 'move', 'lead', 'next']);
  assert.deepEqual([c.items[0].id, c.items[0].vis, c.items[0].pub, c.items[0].say, c.items[0].label], ['cr', 'hidden', 'Odette at the card tables', undefined, 'GM-ONLY-LABEL-2']);
  assert.deepEqual([c.items[1].from, c.items[1].to], ['Showroom', 'Private card rooms']);
  assert.deepEqual([c.items[2].type, c.items[2].way, c.items[3].what, c.items[3].id, c.items[3].at, c.items[3].inMin], ['lead', 'B', 'event', 'fw', '00:00', 30]);
  /* 00:15 */
  c = card('00:00', '00:15', { crew: { b: { room: 'Underground counting room', disguise: 'cook' } }, heard: {} });
  assert.deepEqual(types(c), ['move', 'looker', 'next']);
  assert.deepEqual([c.items[0].to, c.items[1].id, c.items[1].arrived, c.items[2].id, c.items[2].inMin], ['Luxury penthouse', 'pq', false, 'sh', 15]);
  /* the order across a long span: event, move, looker, route, gone, lead, next */
  c = B.beatCard(P2, { crew: { a: { room: 'Private card rooms', disguise: 'guard' }, b: { room: 'Underground counting room', disguise: 'cook' } }, heard: {} }, T('22:45'), T('00:30'));
  const order = ['event', 'move', 'looker', 'route', 'gone', 'lead', 'next'], seq = types(c).map((x) => order.indexOf(x));
  assert.ok(seq.every((n, i) => n >= 0 && (i === 0 || n >= seq[i - 1])), 'in speaking order: ' + types(c).join(','));
  assert.deepEqual(new Set(types(c)), new Set(['event', 'move', 'looker', 'route', 'gone']), 'a long card holds each kind it should (no lead is in reach at 00:30, no next after the last)');
  assert.deepEqual(c.items.filter((i) => i.type === 'event').map((i) => i.id), ['cr', 'fw', 'sh']);
  assert.deepEqual(c.items.filter((i) => i.type === 'route').map((i) => [i.id, i.change, i.at]), [['trap', 'opened', '23:00'], ['trap', 'closed', '00:00']]);
  assert.deepEqual(c.items.filter((i) => i.type === 'gone').map((i) => [i.id, i.at, i.from]), [['iv', '00:30', 'Security control room']]);
  assert.deepEqual(c.items.filter((i) => i.type === 'move').map((i) => i.to), ['Private card rooms', 'Luxury penthouse']);
  assert.deepEqual(c.items.filter((i) => i.type === 'looker').map((i) => [i.when, i.id, i.pc]), [['here', 'pq', 'b']]);
  /* soon lookers and the moment they arrive */
  c = card('23:00', '23:15', { crew: { a: { room: 'Private card rooms', disguise: 'guard' } }, heard: {} });
  const soon = c.items.filter((i) => i.type === 'looker');
  assert.deepEqual(soon.map((i) => [i.when, i.id, i.at, i.inMin, i.pos]), [['soon', 'wr', '23:30', 15, 'risky']]);
  /* back: the card for t1, flagged */
  const fwd = B.beatCard(P2, st, T('23:15'), T('23:30')), back = B.beatCard(P2, st, T('23:45'), T('23:30'));
  assert.equal(back.back, true); assert.equal(back.t1, T('23:30')); assert.equal(back.t0, T('23:15')); assert.deepEqual(back.items, fwd.items);
  assert.equal(B.beatCard(P2, st, T('23:30'), T('23:30')).back, false);
  assert.deepEqual(B.beatCard(P2, st, T('23:30'), T('23:30')).items, fwd.items, 'the same time asks for that beat\'s card');
  /* overrides show: Odette held back; the next move waits */
  c = B.beatCard(P2, { crew: {}, over: { od: { delay: 30 } } }, T('23:15'), T('23:30'));
  assert.equal(c.items.some((i) => i.type === 'move'), false); assert.ok(c.items.some((i) => i.type === 'event' && i.id === 'cr'), 'events do not move with a person');
  assert.deepEqual(c.items.filter((i) => i.type === 'next').map((i) => [i.what, i.id || '']), [['event', 'fw']]);
  /* the last beat has no next */
  assert.equal(B.beatCard(P2, { crew: {} }, T('01:00') - 15, T('01:00')).items.some((i) => i.type === 'next'), false);
  /* GM-facing: the SAY line is there */
  assert.deepEqual(SAY(B.beatCard(P2, st, T('21:45'), T('22:00'))), ['GM-ONLY-SAY-1']);
  const dawn = B.beatCard(P2, st, T('23:45'), T('00:00')).items.find((i) => i.type === 'event'); assert.equal(dawn.fx, 'dawn');
  const sh = B.beatCard(P2, st, T('00:15'), T('00:30')).items; assert.equal(sh.find((i) => i.type === 'event').rival, true); assert.ok(sh.some((i) => i.type === 'gone'));
});

/* ---- the player's view and the mission ------------------------------------------------------------------------- */
const PCS = [{ id: 'a', name: 'Ana', owner: 'u1' }, { id: 'b', name: 'Bo', owner: 'u2' }];
const mission = (state, hhmm, open, pcs) => { const v = B.playerView(P2, state, open || R2); return B.missionFor(v, state, T(hhmm), pcs || PCS); };
const CREW = { a: { room: 'Showroom', disguise: 'guard' }, b: { room: 'Underground counting room', disguise: 'cook' } };
const BEATS = Array.from({ length: 17 }, (_, i) => i * 15);

test('v2 playerView is a new, frozen-safe object built from named fields only; missionFor reads the view, never the play', () => {
  const st = { crew: CREW, told: { I1: 'crew' }, heard: { A: { a: 90 } }, steps: { A: [true] }, ways: {}, site: 'The Pelican Rooms', start: 30 };
  const frozenState = deepFreeze(JSON.parse(JSON.stringify(st)));
  const v = B.playerView(P2, frozenState, R2);
  assert.ok(v && v !== P2 && v.clock !== P2.clock);
  const seen = new Set(); (function walk(o) { if (o && typeof o === 'object') { seen.add(o); Object.values(o).forEach(walk); } })(v);
  for (const part of [P2.zones, P2.people, P2.events, P2.ways, P2.intel, P2.routes, P2.alarm, P2.disguises, P2.items]) assert.equal(seen.has(part), false, 'no part of the block is shared with the view');
  P2.people.concat(P2.events, P2.ways, P2.intel, P2.zones).forEach((o) => assert.equal(seen.has(o), false));
  assert.equal(JSON.stringify(v).includes('GM-ONLY'), false, 'the view itself holds nothing GM-only');
  assert.equal(B.playerView(null, st, R2), null); assert.equal(B.playerView(Object.assign({}, P2, { v: 1 }), st, R2), null);
  assert.equal(B.missionFor(null, st, 0, PCS), null);
  /* the same view always gives the same mission, and missionFor does not need the play */
  const frozenView = deepFreeze(JSON.parse(JSON.stringify(v)));
  const m1 = B.missionFor(frozenView, frozenState, T('22:30'), PCS), m2 = B.missionFor(v, frozenState, T('22:30'), PCS);
  assert.deepEqual(m1, m2); assert.equal(m1.site, 'The Pelican Rooms'); assert.equal(m1.t, T('22:30')); assert.equal(m1.v, 1);
  assert.equal(m1.hud.night.start, 2, 'start 30 minutes in is beat index 2');
  assert.deepEqual(Object.keys(m1.cards), ['a', 'b']); assert.equal(m1.cards.a.owner, 'u1'); assert.equal(m1.cards.b.name, 'Bo');
});

test('v2 mission hud: time, label, now, next, the night, crew, the alarm, ways found', () => {
  const st = { crew: CREW, told: { I1: 'crew' }, heard: { A: { a: 90 } }, alarm: { filled: 3 } };
  let m = mission(st, '22:00');
  assert.equal(m.hud.time, '22:00'); assert.equal(m.hud.label, 'Gala night');
  assert.deepEqual(m.hud.now, [{ text: 'The speeches', where: 'Showroom', until: '22:15' }]);
  assert.deepEqual(m.hud.next, [{ text: 'The fireworks', where: 'Showroom', at: '00:00', inMin: 120 }]);
  assert.deepEqual(m.hud.night.beats, 16); assert.equal(m.hud.night.cur, 4); assert.equal(m.hud.night.start, 0);
  assert.deepEqual(m.hud.night.marks, [{ i: 4, icon: 'star', text: 'The speeches' }, { i: 12, icon: 'star', text: 'The fireworks' }]);
  assert.deepEqual(m.hud.crew, [{ name: 'Ana', costume: 'Guard', icon: 'jacket', room: 'Showroom' }, { name: 'Bo', costume: 'Cook', icon: 'tray', room: 'Underground counting room' }]);
  assert.deepEqual(m.hud.alarm, { name: 'Alarm', size: 6, filled: 3, text: 'The lift is guarded' }, 'no alarm.label: the generic name, never alarm.clock');
  assert.deepEqual(m.hud.ways, { found: 1, total: 2 });
  assert.equal(mission({ crew: CREW }, '22:00').hud.alarm, null); assert.equal(mission({ crew: CREW, alarm: { filled: 0 } }, '22:00').hud.alarm.text, ''); assert.equal(mission({ crew: CREW, alarm: { filled: 9 } }, '22:00').hud.alarm.filled, 6); assert.equal(mission({ crew: CREW, alarm: { filled: 2, visible: false } }, '22:00').hud.alarm, null);
  /* a public event is NOW only in its own beat, and nothing is NEXT without the programme told */
  m = mission({ crew: CREW }, '22:00'); assert.equal(m.hud.now.length, 1); assert.deepEqual(m.hud.next, []);
  assert.deepEqual(mission({ crew: CREW }, '22:15').hud.now, []);
  m = mission({ crew: CREW }, '00:00'); assert.deepEqual(m.hud.now, [{ text: 'The fireworks', where: 'Showroom', until: '00:15' }]);
  /* a room that is not open is not named */
  m = mission({ crew: CREW }, '22:00', ['Cocktail lounge']); assert.deepEqual(m.hud.now, [{ text: 'The speeches', until: '22:15' }]); assert.deepEqual(m.hud.crew.map((c) => c.room), [undefined, undefined]);
  /* no PCs, or a PC with no crew entry: a card with just the name */
  assert.deepEqual(mission({ crew: {} }, '21:00', R2, []).cards, {}); assert.deepEqual(mission({ crew: CREW }, '21:00', R2, [{ id: 'z', name: 'Zed' }]).cards.z, { name: 'Zed', owner: '', costume: '', icon: '', room: '', pos: null, warn: null, zones: { controlled: [], risky: [] }, items: [], leads: [], know: [], next: [], paths: [], busy: null });
});

test('v2 mission cards: costume, position, zones, items, busy, and the target\'s marker only while in view', () => {
  let m = mission({ crew: CREW }, '21:00');
  assert.deepEqual([m.cards.a.costume, m.cards.a.icon, m.cards.a.room, m.cards.a.pos], ['Guard', 'jacket', 'Showroom', 'controlled']);
  assert.deepEqual(m.cards.a.zones, { controlled: ['The floor', 'Back of house'], risky: ['The card rooms', 'The loft'] }); assert.deepEqual(m.cards.b.zones, { controlled: ['Back of house'], risky: ['The floor'] });
  /* the key lifts the loft for a guest: risky, and the item is listed */
  m = mission({ crew: { a: { room: 'Luxury penthouse', disguise: 'guest', items: ['key'], busy: T('22:15'), noticed: true } } }, '22:00', R2, [PCS[0]]);
  assert.deepEqual(m.cards.a.zones, { controlled: ['The floor'], risky: ['The card rooms', 'The loft'] }); assert.deepEqual(m.cards.a.items, ['A brass key']); assert.equal(m.cards.a.busy, '22:15'); assert.equal(m.cards.a.pos, 'desperate', 'risky, noticed');
  assert.equal(mission({ crew: { a: { room: 'Showroom', disguise: 'guest', busy: T('22:00') } } }, '22:00', R2, [PCS[0]]).cards.a.busy, null, 'busy until now is over');
  assert.equal(mission({ crew: { a: { room: 'Showroom', disguise: 'guest', blown: ['guest'] } } }, '22:00', R2, [PCS[0]]).cards.a.pos, 'desperate');
  /* the target: in view at a public event in an open room, or with a PC; never in a closed room */
  assert.deepEqual(mission({ crew: {} }, '22:00').hud.target, { room: 'Showroom' }, 'the speeches, with no PC there');
  assert.equal(mission({ crew: {} }, '21:00').hud.target, null, 'no event, no PC');
  assert.deepEqual(mission({ crew: { a: { room: 'Showroom', disguise: 'guest' } } }, '21:00').hud.target, { room: 'Showroom' });
  assert.equal(mission({ crew: { a: { room: 'Cocktail lounge', disguise: 'guest' } } }, '21:00').hud.target, null);
  assert.equal(mission({ crew: { a: { room: 'Private card rooms', disguise: 'guest' } } }, '23:30', PUBLIC_ROOMS).hud.target, null, 'in a room that is not open');
  assert.deepEqual(mission({ crew: { a: { room: 'Private card rooms', disguise: 'guest' } } }, '23:30').hud.target, { room: 'Private card rooms' });
  assert.equal(mission({ crew: {} }, '22:00', ['Cocktail lounge']).hud.target, null);
  assert.equal(mission({ crew: {}, over: { od: { at: 'Cocktail lounge' } } }, '22:00', R2).hud.target, null, 'held away from the speeches');
  assert.deepEqual(mission({ crew: {}, over: { od: { gone: true } } }, '22:00').hud.target, null);
});

test('v2 leak: the hidden event cr appears only once I2 is told; the exact window of way A only then', () => {
  const heard = { A: { a: 90, b: 90 }, B: { a: 100 } };
  for (const t of BEATS) {
    const hhmm = B.timeLabel(P2, t);
    for (const [told, expectCr] of [[{}, false], [{ I1: 'crew' }, false], [{ I1: 'crew', I2: 'crew' }, true], [{ I2: ['a'] }, true]]) {
      const m = B.missionFor(B.playerView(P2, { crew: CREW, told, heard }, R2), { crew: CREW, told, heard }, t, PCS);
      const json = JSON.stringify(m);
      if (!expectCr) { assert.equal(json.includes('card tables'), false, 'cr at ' + hhmm + ' told ' + JSON.stringify(told)); assert.equal(json.includes('23:30–00:15'), false); }
      assert.equal(m.cards.a.leads.find((l) => l.name === 'The Last Hand').window === 'Late, at the cards', !expectCr || false, 'A window at ' + hhmm + ' ' + JSON.stringify(told));
    }
  }
  /* once told to the crew: hud next and every card carry cr until it has happened; told to one PC: that card only */
  const stC = { crew: CREW, told: { I2: 'crew' } }, stA = { crew: CREW, told: { I2: ['a'] } };
  assert.ok(mission(stC, '21:00').hud.next.some((n) => n.text === 'Odette at the card tables'));
  assert.ok(mission(stC, '21:00').cards.b.next.some((n) => n.text === 'Odette at the card tables'));
  assert.equal(mission(stA, '21:00').hud.next.some((n) => n.text === 'Odette at the card tables'), false); assert.equal(mission(stA, '21:00').cards.b.next.some((n) => n.text === 'Odette at the card tables'), false); assert.ok(mission(stA, '21:00').cards.a.next.some((n) => n.text === 'Odette at the card tables'));
  assert.equal(mission(stC, '23:45').hud.next.some((n) => n.text === 'Odette at the card tables'), false, 'past');
  /* the exact window, as the card prints it; way B has no told, so only its vague words, ever */
  const wa = (told, who) => mission({ crew: CREW, told, heard: { A: { a: 90, b: 90 }, B: { a: 100, b: 100 } } }, '23:00').cards[who].leads;
  assert.equal(wa({}, 'a').find((l) => l.name === 'The Last Hand').window, 'Late, at the cards');
  assert.equal(wa({ I2: 'crew' }, 'a').find((l) => l.name === 'The Last Hand').window, '23:30–00:15 · Private card rooms');
  assert.equal(wa({ I2: ['b'] }, 'a').find((l) => l.name === 'The Last Hand').window, 'Late, at the cards', 'told to b: a still has only the vague words');
  assert.equal(wa({ I2: ['b'] }, 'b').find((l) => l.name === 'The Last Hand').window, '23:30–00:15 · Private card rooms');
  assert.equal(wa({ I1: 'crew', I2: 'crew', I3: 'crew', I4: 'crew' }, 'a').find((l) => l.name === 'Going Up').window, 'After midnight, upstairs');
  assert.equal(wa({ I2: 'crew' }, 'a').find((l) => l.name === 'The Last Hand').heard, '22:30 · Cocktail lounge');
  /* the view itself holds the exact window only once told (not just the mission) */
  const wv = (told) => B.playerView(P2, { crew: CREW, told, heard: { A: { a: 1 } } }, R2).ways[0].window;
  assert.equal(wv({}).exact, undefined); assert.equal(wv({ I1: 'crew' }).exact, undefined); assert.equal(wv({ I2: ['b'] }).aud.pcs[0], 'b'); assert.equal(wv({ I2: 'crew' }).exact, '23:30–00:15 · Private card rooms');
  /* a way with a different told: an intel item */
  const alt = (() => { const p = fx2(); p.ways[1].window.told = 'I3'; return deepFreeze(B.checkPlay(p, R2).play); })();
  const vm = (told) => { const s = { crew: CREW, told, heard: { B: { a: 5 } } }; return B.missionFor(B.playerView(alt, s, R2), s, 0, PCS).cards.a.leads[0].window; };
  assert.equal(vm({}), 'After midnight, upstairs'); assert.equal(vm({ I3: 'crew' }), '00:15 · Luxury penthouse'); assert.equal(vm({ I3: ['a'] }), '00:15 · Luxury penthouse');
});

test('v2 leak: a zone appears only once one of its rooms is open', () => {
  const zones = { 'The floor': ['Showroom', 'Cocktail lounge'], 'Back of house': ['Underground counting room', 'Security control room'], 'The card rooms': ['Private card rooms'], 'The loft': ['Luxury penthouse'] };
  const st = { crew: { a: { room: 'Showroom', disguise: 'guard' } } };
  for (const open of [[], ['Showroom'], ['Cocktail lounge'], ['Security control room'], ['Private card rooms', 'Showroom'], R2, ['Attic']]) {
    const json = JSON.stringify(mission(st, '21:00', open, [PCS[0]]));
    for (const [label, rs] of Object.entries(zones)) assert.equal(json.includes('"' + label + '"'), rs.some((r) => open.includes(r)), label + ' with open ' + JSON.stringify(open));
  }
  const v = B.playerView(P2, st, ['Showroom']); assert.deepEqual(v.zones, [{ id: 'floor', label: 'The floor', pub: 'Where the guests are' }]);
  assert.deepEqual(B.playerView(P2, st, null).zones, [], 'open falls back to state.open'); assert.deepEqual(B.playerView(P2, { crew: st.crew, open: ['Luxury penthouse'] }, undefined).zones.map((z) => z.id), ['loft']);
});

test('v2 leak: intel told to one PC puts its event in that card\'s next only; intel told to the crew goes to the hud and every card', () => {
  const sh = 'A shot in the card rooms';
  const m = mission({ crew: CREW, told: { I4: ['b'] } }, '23:00');
  assert.deepEqual(m.cards.b.next.map((n) => n.text), [sh]); assert.deepEqual(m.cards.a.next, []); assert.deepEqual(m.hud.next, []);
  assert.deepEqual(m.cards.b.know, ['The rival moves at half past twelve']); assert.deepEqual(m.cards.a.know, []);
  assert.equal(JSON.stringify(m.hud).includes(sh), false); assert.equal(JSON.stringify(m.cards.a).includes(sh), false);
  assert.equal(JSON.stringify(m.hud.night.marks).includes(sh), false, 'a private deadline is not on the shared track');
  for (const t of BEATS) { const x = B.missionFor(B.playerView(P2, { crew: CREW, told: { I4: ['b'] } }, R2), { crew: CREW, told: { I4: ['b'] } }, t, PCS); assert.equal(JSON.stringify(x.hud).includes(sh), false); assert.equal(JSON.stringify(x.cards.a).includes(sh), false); }
  /* it is gone from next once it has happened, and it does not show NOW on the hud */
  assert.deepEqual(mission({ crew: CREW, told: { I4: ['b'] } }, '00:30').cards.b.next, []); assert.deepEqual(mission({ crew: CREW, told: { I4: ['b'] } }, '00:30').hud.now, []);
  const c = mission({ crew: CREW, told: { I4: 'crew' } }, '23:00');
  assert.deepEqual(c.hud.next.map((n) => n.text), [sh]); assert.deepEqual(c.cards.a.next.map((n) => n.text), [sh]); assert.deepEqual(c.cards.b.next.map((n) => n.text), [sh]);
  assert.deepEqual(c.hud.night.marks.filter((k) => k.text === sh), [{ i: 14, icon: 'diamond', text: sh }], 'a revealed hidden event is a diamond on the track');
  /* a PC's own intel adds to the hud's next, ordered by time; at most 3 on the hud and 4 on a card */
  const both = mission({ crew: CREW, told: { I1: 'crew', I2: ['a'], I4: ['a'] } }, '21:00');
  assert.deepEqual(both.hud.next.map((n) => n.text), ['The speeches', 'The fireworks']); assert.deepEqual(both.cards.a.next.map((n) => n.text), ['The speeches', 'Odette at the card tables', 'The fireworks', sh]); assert.deepEqual(both.cards.b.next.map((n) => n.text), ['The speeches', 'The fireworks']);
  /* a seen event: shown (NOW) only while a PC is in its room */
  const seen = (() => { const p = fx2(); p.events[0].vis = 'seen'; return deepFreeze(B.checkPlay(p, R2).play); })();
  const sm = (crew, open) => { const s = { crew }; return B.missionFor(B.playerView(seen, s, open || R2), s, 60, PCS); };
  assert.equal(sm({ a: { room: 'Showroom', disguise: 'guest' } }).hud.now.length, 1); assert.equal(sm({ a: { room: 'Cocktail lounge', disguise: 'guest' } }).hud.now.length, 0);
});

test('v2 leak: the trapdoor\'s pub reaches a card\'s paths only while it is open (23:00 to 00:00) and only once I3 is told to that PC or the crew', () => {
  const pub = 'A trapdoor from the counting room into the showroom';
  for (const t of BEATS) {
    const hhmm = B.timeLabel(P2, t), open = t >= T('23:00') && t < T('00:00');
    for (const [told, a, b] of [[{}, false, false], [{ I3: 'crew' }, true, true], [{ I3: ['a'] }, true, false], [{ I3: ['b'] }, false, true], [{ I1: 'crew', I2: 'crew' }, false, false]]) {
      const s = { crew: CREW, told }, m = B.missionFor(B.playerView(P2, s, R2), s, t, PCS);
      assert.deepEqual(m.cards.a.paths.length > 0, open && a, 'a at ' + hhmm + ' ' + JSON.stringify(told)); assert.deepEqual(m.cards.b.paths.length > 0, open && b, 'b at ' + hhmm + ' ' + JSON.stringify(told));
      if (open && a) assert.deepEqual(m.cards.a.paths, [{ text: pub, until: '00:00' }]);
      assert.equal(JSON.stringify(m.hud).includes(pub), false, 'paths are on cards, never the hud');
      if (!(open && (a || b))) assert.equal(JSON.stringify(m).includes(pub), false);
    }
  }
  assert.equal(B.playerView(P2, { crew: CREW, told: {} }, R2).routes.length, 0, 'the route is not in the view until told');
  assert.equal(JSON.stringify(mission({ crew: CREW, told: { I3: 'crew' } }, '23:00', R2)).includes('GM-ONLY-VIA'), false);
  assert.deepEqual(mission({ crew: CREW, told: { I3: 'crew' } }, '23:00').cards.b.know, ['A trapdoor opens between the counting room and the showroom at eleven']);
});

test('v2 leak: a looker\'s name is on a card only while they are in that PC\'s room and the PC wears the costume that sees through it', () => {
  for (const t of BEATS) {
    const hhmm = B.timeLabel(P2, t), places = B.placesAt(P2, {}, t);
    for (const room of R2) for (const costume of ['guest', 'cook', 'guard']) {
      const s = { crew: { a: { room, disguise: costume } } }, m = B.missionFor(B.playerView(P2, s, R2), s, t, [PCS[0]]), json = JSON.stringify(m);
      const wren = costume === 'guard' && places.wr && places.wr.room === room, pip = costume === 'cook' && places.pq && places.pq.room === room;
      assert.equal(json.includes('Wren Tully'), !!wren, 'Wren, ' + costume + ' in ' + room + ' at ' + hhmm); assert.equal(json.includes('Pip Quill'), !!pip, 'Pip, ' + costume + ' in ' + room + ' at ' + hhmm);
      assert.equal(json.includes('GM-ONLY-PERSON-1'), false); assert.equal(json.includes('Odette Marsh'), false, 'the target\'s name is never on a card');
      if (wren) assert.deepEqual(m.cards.a.warn, { who: 'Wren Tully', look: 'A tall man in a grey coat', sees: 'Guard' });
      else if (pip) assert.deepEqual(m.cards.a.warn, { who: 'Pip Quill', look: 'A cook\'s hat and a cleaver', sees: 'Cook' });
      else assert.equal(m.cards.a.warn, null);
    }
  }
  /* the GM's override moves Wren, and the card follows */
  const s = { crew: { a: { room: 'Showroom', disguise: 'guard' } }, over: { wr: { at: 'Cocktail lounge' } } };
  assert.equal(B.missionFor(B.playerView(P2, s, R2), s, 0, [PCS[0]]).cards.a.warn, null);
  const s2 = { crew: { a: { room: 'Cocktail lounge', disguise: 'guard' } }, over: { wr: { at: 'Cocktail lounge' } } };
  assert.equal(B.missionFor(B.playerView(P2, s2, R2), s2, 0, [PCS[0]]).cards.a.warn.who, 'Wren Tully');
  /* the view only holds people a worn costume sees through, and the target */
  assert.deepEqual(B.playerView(P2, { crew: { a: { room: 'Showroom', disguise: 'guest' } } }, R2).people.map((p) => p.id), ['od']);
  assert.deepEqual(B.playerView(P2, { crew: { a: { room: 'Showroom', disguise: 'guard' }, b: { disguise: 'cook' } } }, R2).people.map((p) => p.id), ['od', 'wr', 'pq']);
});

test('v2 leak: a lead on a card carries one step, the first unticked; heard says when and where; done is flagged and listed last', () => {
  const lead = (steps, ways, t) => { const s = { crew: CREW, heard: { A: { a: 90 }, B: { a: 100, b: 100 } }, steps, ways: ways || {} }; return B.missionFor(B.playerView(P2, s, R2), s, t || 0, PCS); };
  let m = lead({});
  assert.deepEqual(m.cards.a.leads.map((l) => l.name), ['The Last Hand', 'Going Up']); assert.deepEqual(m.cards.b.leads.map((l) => l.name), ['Going Up']);
  assert.equal(m.cards.a.leads[0].next, 'A seat at her table'); assert.equal(m.cards.a.leads[1].next, 'The key'); assert.equal(JSON.stringify(m).includes('Make her lose'), false); assert.equal(JSON.stringify(m).includes('The lift"'), false);
  assert.equal(m.cards.a.leads[0].line, 'She never leaves a table while she\'s winning.'); assert.equal(m.cards.a.leads[0].heard, '22:30 · Cocktail lounge'); assert.equal(m.cards.b.leads[0].heard, '22:40 · Underground counting room');
  m = lead({ A: [true, false], B: [true, true] });
  assert.equal(m.cards.a.leads[0].next, 'Make her lose'); assert.equal(JSON.stringify(m).includes('A seat at her table'), false); assert.equal('next' in m.cards.a.leads[1], false, 'all ticked: no next');
  m = lead({ A: [false, true] }); assert.equal(m.cards.a.leads[0].next, 'A seat at her table', 'the first unticked, not the last');
  m = lead({ A: [true, true] }, { A: 'done' }); assert.deepEqual(m.cards.a.leads.map((l) => [l.name, l.done === true]), [['Going Up', false], ['The Last Hand', true]]);
  m = lead({}, { A: 'gone' }); assert.equal(m.cards.a.leads[0].done, undefined, 'gone is not done');
  /* a lead is on a card only for a PC who heard it; a room that is not open is left out of "heard" */
  const s = { crew: CREW, heard: { A: { a: 90 } } };
  assert.equal(B.missionFor(B.playerView(P2, s, PUBLIC_ROOMS), s, 0, PCS).cards.a.leads[0].heard, '22:30 · Cocktail lounge');
  assert.equal(B.missionFor(B.playerView(P2, s, ['Showroom']), s, 0, PCS).cards.a.leads[0].heard, '22:30');
  assert.deepEqual(B.missionFor(B.playerView(P2, s, R2), s, 0, PCS).cards.b.leads, []);
  assert.deepEqual(B.missionFor(B.playerView(P2, s, R2), s, 0, PCS).hud.ways, { found: 1, total: 2 });
  assert.equal(B.playerView(P2, { crew: CREW, heard: {} }, R2).ways.length, 0, 'unheard ways are not in the view');
});

test('v2 leak: for every beat, and every mix of told, heard, carried, open, costume, tick and alarm, the mission holds no GM-ONLY string', () => {
  assert.ok(JSON.stringify(P2).includes('GM-ONLY'), 'positive control: the play is full of markers');
  const told = [{}, { I1: 'crew' }, { I1: 'crew', I2: 'crew' }, { I1: 'crew', I2: ['a'], I3: ['b'], I4: ['a', 'b'] }, { I1: ['a'], I2: 'crew', I3: 'crew', I4: 'crew' }];
  const heard = [{}, { A: { a: 90 } }, { A: { a: 90, b: 95 }, B: { a: 100, b: 100 } }];
  const carried = [[], ['key']];
  const opens = [PUBLIC_ROOMS, R2];
  const crews = [CREW, { a: { room: 'Private card rooms', disguise: 'guest', noticed: true, blown: ['cook'] }, b: { room: 'Luxury penthouse', disguise: 'guard', busy: T('23:00') } }, { a: { room: 'Security control room', disguise: 'cook' }, b: { room: 'Cocktail lounge', disguise: 'cook' } }];
  const ticks = [{}, { A: [true, false], B: [true] }], waysState = [{}, { A: 'done', B: 'gone' }], alarms = [undefined, { filled: 0 }, { filled: 3 }, { filled: 6 }];
  const over = [undefined, { od: { delay: 30 }, wr: { skip: [0] }, iv: { gone: true } }, { od: { at: 'Cocktail lounge' }, pq: { at: 'Showroom' } }];
  const tms = BEATS.concat([7, 125, 226]);
  let n = 0, cardsSeen = 0;
  for (const t of told) for (const h of heard) for (const k of carried) for (const o of opens) for (const [ci, crew] of crews.entries()) {
    const sc = ci === 0 ? { tk: ticks[1], w: waysState[0], a: alarms[2], ov: over[0] } : ci === 1 ? { tk: ticks[0], w: waysState[1], a: alarms[3], ov: over[1] } : { tk: ticks[1], w: waysState[1], a: alarms[1], ov: over[2] };
    const cw = JSON.parse(JSON.stringify(crew)); if (k.length) Object.values(cw).forEach((c) => { c.items = k; });
    const st = { crew: cw, told: t, heard: h, steps: sc.tk, ways: sc.w, alarm: sc.a, over: sc.ov, open: o, site: 'The Pelican Rooms', start: 45 };
    const v = B.playerView(P2, st, o);
    assert.equal(JSON.stringify(v).includes('GM-ONLY'), false, 'the view: ' + JSON.stringify(st));
    for (const tt of tms) {
      const m = B.missionFor(v, st, tt, PCS), json = JSON.stringify(m);
      assert.equal(json.includes('GM-ONLY'), false, 'GM-ONLY at ' + tt + ' in ' + JSON.stringify(st) + '\n' + json.slice(json.indexOf('GM-ONLY') - 80, json.indexOf('GM-ONLY') + 60));
      assert.equal(json.includes('Odette Marsh'), false); assert.equal(json.includes('Make her lose') && !(sc.tk.A && sc.tk.A[0] && !sc.tk.A[1]) , false);
      n++; cardsSeen += Object.keys(m.cards).length;
    }
  }
  assert.ok(n > 3000, 'ran ' + n + ' missions'); assert.ok(cardsSeen === n * 2);
});

test('v2: the engine does not mutate what it is given (frozen play, state and view all pass)', () => {
  const st = deepFreeze({ crew: JSON.parse(JSON.stringify(CREW)), told: { I1: 'crew', I3: ['a'] }, heard: { A: { a: 90 } }, steps: { A: [true] }, over: { od: { delay: 10 } }, open: R2, alarm: { filled: 2 } });
  const v = deepFreeze(B.playerView(P2, st, R2));
  B.missionFor(v, st, T('23:15'), deepFreeze(PCS.map((p) => Object.assign({}, p)))); B.beatCard(P2, st, 0, T('23:15')); B.beatCard(P2, st, T('23:15'), 0); B.positionOf(P2, st, 'a'); B.lookers(P2, st, 'a', 10); B.routesAt(P2, 130); B.leadsInReach(P2, st, 5); B.placesAt(P2, st, 130);
});

test('v2 alarm: hud.alarm.name is alarm.label (player-safe, optional) or "Alarm"; alarm.clock never reaches the mission', () => {
  assert.equal(P2.alarm.clock, 'Fuse'); assert.equal(P2.alarm.label, undefined);
  const run = (play, filled) => { const st = { crew: CREW, alarm: { filled } }; return B.missionFor(B.playerView(play, st, R2), st, 0, PCS); };
  for (const filled of [0, 1, 3, 6]) { const m = run(P2, filled); assert.equal(m.hud.alarm.name, 'Alarm'); assert.equal(JSON.stringify(m).includes('Fuse'), false, 'the clock name stays off the mission at filled ' + filled); }
  const withLabel = (() => { const p = fx2(); p.alarm.label = 'The fuse'; return B.checkPlay(p, R2); })();
  assert.deepEqual(withLabel.warnings, []); assert.equal(withLabel.play.alarm.label, 'The fuse');
  const m = run(deepFreeze(withLabel.play), 2);
  assert.equal(m.hud.alarm.name, 'The fuse'); assert.equal(m.hud.alarm.text, 'Someone is looking'); assert.equal(JSON.stringify(m).includes('"Fuse"'), false);
  const bad = (() => { const p = fx2(); p.alarm.label = 4; return B.checkPlay(p, R2); })();
  assert.equal(bad.play.alarm.label, undefined); oneWarn(bad, /alarm\.label: not text/);
  const blank = (() => { const p = fx2(); p.alarm.label = '  '; return deepFreeze(B.checkPlay(p, R2).play); })();
  assert.equal(run(blank, 1).hud.alarm.name, 'Alarm');
});

test('v2 seen events: NOW only in their own beat while a PC is in the room, or once told like a hidden one; never marks from presence', () => {
  const seen = (() => { const p = fx2(); p.events[0].vis = 'seen'; return deepFreeze(B.checkPlay(p, R2).play); })();     /* sp, 22:00, Showroom, pub "The speeches" */
  const mk = (crew, hhmm, told) => { const st = { crew, told: told || {} }; return B.missionFor(B.playerView(seen, st, R2), st, T(hhmm), PCS); };
  const inRoom = { a: { room: 'Showroom', disguise: 'guest' } }, away = { a: { room: 'Cocktail lounge', disguise: 'guest' } };
  const speeches = (m) => JSON.stringify(m).includes('The speeches');
  assert.equal(mk(inRoom, '22:00').hud.now.length, 1, 'in its own beat, a PC in the room');
  assert.equal(mk(away, '22:00').hud.now.length, 0, 'no PC in the room');
  assert.equal(mk(inRoom, '22:15').hud.now.length, 0, 'the next beat');
  assert.equal(mk(inRoom, '21:45').hud.now.length, 0, 'before it');
  for (const hhmm of ['21:00', '21:45', '22:00', '22:15', '23:00', '00:30']) {
    assert.deepEqual(mk(inRoom, hhmm).hud.night.marks.filter((k) => k.text === 'The speeches'), [], 'presence is not a mark at ' + hhmm);
    assert.deepEqual(mk(inRoom, hhmm).cards.a.next, []); assert.deepEqual(mk(inRoom, hhmm).hud.next, []);
  }
  assert.equal(speeches(mk(inRoom, '23:00')), false, 'a PC who is there later learns nothing of it');
  assert.equal(speeches(mk(away, '23:00')), false);
  /* told to the crew: next before, the track after, like a hidden one; told to one PC: that card's next only */
  assert.deepEqual(mk(away, '21:00', { I1: 'crew' }).hud.next.map((n) => n.text), ['The speeches', 'The fireworks']);
  assert.deepEqual(mk(away, '23:00', { I1: 'crew' }).hud.night.marks.map((k) => k.text), ['The speeches', 'The fireworks']);
  assert.equal(mk(away, '22:00', { I1: 'crew' }).hud.now.length, 1, 'told to the crew: NOW in its beat even with nobody there');
  const one = mk(away, '21:00', { I1: ['a'] });
  assert.deepEqual(one.hud.next, []); assert.deepEqual(one.cards.a.next.map((n) => n.text), ['The speeches', 'The fireworks']); assert.deepEqual(one.cards.b.next, []);
  assert.equal(mk(away, '22:00', { I1: ['a'] }).hud.now.length, 0, 'told to one PC is not NOW on the shared band');
});

test('v2: ids named constructor, toString, __proto__ or hasOwnProperty are just ids, in the block, the state and every told lookup', () => {
  for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    const p = fx2();
    p.ways[0].window.told = id;                                       /* names nothing: dropped with a warning, not a crash */
    const r = B.checkPlay(p, R2);
    assert.ok(hasWarn(r, /window\.told: "/), id); assert.equal(r.play.ways[0].window.told, undefined);
    /* the same id as a real intel item, event, way, item, zone, person and PC */
    const q = fx2();
    q.intel[1].id = id; q.events[1].id = id + 'E'; q.intel[1].reveals = { events: [id + 'E'], ways: ['A'] }; q.ways[0].window.told = id;
    q.ways[0].id = id + 'W'; q.items[0].id = id + 'I'; q.zones[0].id = id + 'Z'; q.disguises[2].home = [id + 'Z', 'back']; q.people[3].id = id + 'P';
    q.intel[1].reveals.ways = [id + 'W']; q.disguises[0].home = [id + 'Z']; q.disguises[1].risky = [id + 'Z']; q.ways[1].needs = [id + 'I'];
    const c = B.checkPlay(q, R2);
    assert.deepEqual(c.warnings, [], id + ' ' + JSON.stringify(c.warnings));
    const play = deepFreeze(c.play);
    const st = JSON.parse('{"crew":{"' + id + '":{"room":"Showroom","disguise":"guard","items":["' + id + 'I"]},"b":{"room":"Cocktail lounge","disguise":"cook"}},"told":{"' + id + '":"crew"},"heard":{"' + id + 'W":{"' + id + '":10}},"steps":{"' + id + 'W":[true]},"ways":{"' + id + 'W":"done"},"over":{"' + id + 'P":{"gone":true}}}');
    const pcs = [{ id, name: 'Weird', owner: 'u' }, { id: 'b', name: 'Bo', owner: 'u2' }];
    for (const t of [0, 90, 150, 200]) {
      const m = B.missionFor(B.playerView(play, st, R2), st, t, pcs);
      assert.deepEqual(Object.keys(m.cards), [id, 'b']);
      assert.equal(m.cards[id].name, 'Weird'); assert.equal(m.cards[id].pos, 'controlled');
      assert.equal(m.cards[id].leads.length, 1); assert.equal(m.cards[id].leads[0].done, true);
      assert.equal(m.cards[id].leads[0].window, '23:30–00:15 · Private card rooms', 'told by the intel item named ' + id);
      assert.equal(m.cards.b.leads.length, 0); assert.equal(JSON.stringify(m).includes('GM-ONLY'), false);
      B.beatCard(play, st, t, t + 15); B.positionOf(play, st, id); B.lookers(play, st, id, t); B.leadsInReach(play, st, t); B.placesAt(play, st, t);
    }
    /* intel told to a PC with that id */
    const st2 = { crew: st.crew, told: JSON.parse('{"' + id + '":["' + id + '"]}') };
    const pm = B.missionFor(B.playerView(play, st2, R2), st2, 0, pcs);
    assert.ok(pm.cards[id].know.length === 1 && pm.cards.b.know.length === 0, id);
  }
  /* a lookup that is not an own key finds nothing, even when the map is a plain object */
  const loose = JSON.parse(JSON.stringify(P2));
  loose.ways.forEach((w) => { if (w.window) w.window.told = 'constructor'; });
  const st = { crew: CREW, heard: { A: { a: 1 }, B: { a: 1 } }, told: {} };
  const m = B.missionFor(B.playerView(loose, st, R2), st, 0, PCS);
  assert.equal(m.cards.a.leads[0].window, 'Late, at the cards');
  assert.equal(B.whereAt(P2.people[0], 10, { constructor: 1, toString: 2 }, '21:00', { over: { constructor: { gone: true } } }).room, 'Showroom');
  assert.equal(B.positionOf(P2, { crew: {} }, 'constructor').pos, 'desperate'); assert.equal(B.positionOf(P2, { crew: {} }, '__proto__').pos, 'desperate');
  assert.deepEqual(B.lookers(P2, {}, 'toString', 0), { here: [], soon: [] });
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
