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

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
