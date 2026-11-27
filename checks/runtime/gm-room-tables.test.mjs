// gm-room-tables (RK12.4 of the room key build; setting room.tables): app/gm/room-tables.js, the page's side of the `rooms` part.
// get(name, T) through normRoom and the aliases, role(), create(T), validate(T) and check(T), the wiring into the CHECKED loop of gm-page.js (packWarnings), and the
// file's own rules (ES5, UMD, reads other modules only when called). No browser, no network, no key. INVENTED data only (the Pelican Rooms).
//   node checks/runtime/gm-room-tables.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/room-tables.js';
const M = require(path.join(ROOT, FILE));
const P = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
const Scene = require(path.join(ROOT, 'app', 'gm', 'scene-state.js'));
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'rooms-pack.json'), 'utf8'));
const T0 = FIX.T;
const clone = (o) => JSON.parse(JSON.stringify(o));
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

/* a browser-like context: the page's scripts one after another, as plain scripts */
function page(files) {
  const win = {}; win.self = win; win.window = win;
  vm.createContext(win);
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), win, { filename: f });
  return win;
}

test('gm-room-tables: the module loads under Node and is no longer a stub', () => {
  assert.ok(M && typeof M === 'object');
  assert.ok(!M.stub, 'filled by RK12');
  for (const k of ['create', 'get', 'keyOf', 'role', 'validate', 'check']) assert.equal(typeof M[k], 'function', k);
});

test('gm-room-tables: as plain scripts after room-notes.js and room-things.js it defines window.B68GmRoomTables, and get() finds a room by its alias', () => {
  const win = page(['app/gm/room-notes.js', 'app/gm/room-things.js', FILE]);
  const B = win.B68GmRoomTables;
  assert.ok(B && typeof B.get === 'function');
  const T = clone(T0);
  T.rooms['a pelican bar'] = T.rooms['pelican bar']; delete T.rooms['pelican bar']; T.rooms['a pelican bar'].name = 'A Pelican bar';
  T.aliases = { 'pelican bar': 'a pelican bar' };
  assert.equal(B.get('Pelican bar', T).name, 'A Pelican bar');
  assert.equal(B.get('The Pelican Cloakroom', T).band, 'working');
  assert.equal(B.get('Pelican laundry', T), null);
  assert.equal(B.check(T).length, 0);
});

test('gm-room-tables: it reads room-notes.js and room-things.js when called, never at load: alone in a bare context it defines its global, finds nothing and checks nothing', () => {
  const win = page([FILE]);
  const B = win.B68GmRoomTables;
  assert.ok(B && typeof B.get === 'function', 'defined at load with nothing else there');
  assert.equal(B.get('Pelican bar', T0), null, 'no normRoom, no room');
  const broken = clone(T0); broken.rooms['pelican bar'].things.length = 3;
  assert.equal(B.check(broken).length, 0, 'it says nothing while the bundle it needs is not loaded (as the other modules do)');
  assert.equal(B.validate(broken).errors.length, 0);
});

test('gm-room-tables: the file is ES5 (no arrow, const, let, template literal or spread) and holds no string literal over 220 characters', () => {
  const src = fs.readFileSync(path.join(ROOT, FILE), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  assert.ok(!/=>/.test(code), 'an arrow'); assert.ok(!/\b(?:const|let)\s/.test(code), 'const or let'); assert.ok(!/`/.test(code), 'a template literal'); assert.ok(!/\.\.\./.test(code), 'a spread');
  for (const m of code.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"/g)) assert.ok((m[1] || m[2] || '').length <= 220, 'a long literal');
  assert.match(src, /root\.B68GmRoomTables = M/); assert.match(src, /module\.exports = M/);
});

test('gm-room-tables get(): a missing room is null (no theme fallback), the key is normRoom, an alias reaches its room, prototype names and blanks are nothing, and a copy comes back', () => {
  const T = clone(T0);
  assert.equal(M.get('Pelican laundry', T), null);
  for (const bad of ['', '  ', undefined, null, 0, {}, 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) assert.equal(M.get(bad, T), null, String(bad));
  assert.equal(M.get('PELICAN BAR!', T).name, 'Pelican bar');
  assert.equal(M.keyOf('the Pelican bar', T), 'pelican bar');
  T.aliases['tap room'] = 'pelican bar';
  assert.equal(M.get('The tap room', T).name, 'Pelican bar');
  T.aliases['ghost'] = 'no such room';
  assert.equal(M.get('ghost', T), null, 'an alias to nothing finds nothing');
  const g = M.get('Pelican bar', T); g.things.pop(); g.say[0] = 'changed';
  assert.equal(T.rooms['pelican bar'].things.length, 10); assert.notEqual(T.rooms['pelican bar'].say[0], 'changed');
  assert.equal(M.get('Pelican bar', undefined), null); assert.equal(M.get('Pelican bar', 'x'), null); assert.equal(M.get('Pelican bar', { rooms: [] }), null);
  assert.equal(M.role('waiter', T).pose, T0.roles.waiter.pose); assert.equal(M.role('cook', T), null); assert.equal(M.role('', T), null);
  const c = M.create(T);
  assert.equal(c.get('tap room').name, 'Pelican bar'); assert.equal(c.keyOf('x'), null); assert.equal(c.role('cleaner').lines.length, 3);
  assert.deepEqual(M.create(null).keys(), []);
});

const bar = (T) => T.rooms['pelican bar'];
const cloak = (T) => T.rooms['pelican cloakroom'];
const ROLE_IDS = Scene.ROLE_IDS;
function withTags(T, key, sets) { T.rooms[key].things.forEach((t, i) => { t.tags = sets[i]; }); }
const OK = [['loot', 'talk'], ['weapon', 'cover'], ['clue'], ['clue', 'hazard'], ['escape', 'door'], ['tool'], ['costume'], ['weird'], ['loot'], ['talk']];
const RED = [
  ['9 things', (T) => { bar(T).things.pop(); }, /^Pelican bar: 9 things \(exactly 10\)/],
  ['11 things', (T) => { bar(T).things.push(clone(bar(T).things[0])); bar(T).things[10].name = 'A spare'; }, /^Pelican bar: 11 things \(exactly 10\)/],
  ['2 says', (T) => { bar(T).say.pop(); }, /^Pelican bar: 2 say lines \(exactly 3\)/],
  ['4 says', (T) => { bar(T).say.push('x'); }, /^Pelican bar: 4 say lines \(exactly 3\)/],
  ['a say over 300', (T) => { bar(T).say[1] = 'x'.repeat(301); }, /^Pelican bar: say 2 is 301 characters \(at most 300\)/],
  ['a name over 40', (T) => { bar(T).things[0].name = 'n'.repeat(41); }, /name is 41 characters \(at most 40\)/],
  ['a line over 80', (T) => { bar(T).things[0].line = 'l'.repeat(81); }, /line is 81 characters \(at most 80\)/],
  ['a look over 120', (T) => { bar(T).things[0].look = 'k'.repeat(121); }, /look is 121 characters \(at most 120\)/],
  ['a roll over 160', (T) => { bar(T).things[0].roll = 'r'.repeat(161); }, /roll is 161 characters \(at most 160\)/],
  ['a danger over 100', (T) => { bar(T).things[0].danger = 'd'.repeat(101); }, /danger is 101 characters \(at most 100\)/],
  ['a field that is not text', (T) => { bar(T).things[0].look = 5; }, /look is not text/],
  ['no closer look', (T) => { bar(T).things[0].look = ''; }, /thing 1 \(A long zinc bar\) has no closer look/],
  ['an unknown tag', (T) => { bar(T).things[0].tags = ['treasure']; }, /unknown tag "treasure"/],
  ['no tag on a thing', (T) => { bar(T).things[0].tags = []; }, /0 tags \(1 to 3\)/],
  ['4 tags on a thing', (T) => { bar(T).things[0].tags = ['loot', 'clue', 'tool', 'door']; }, /4 tags \(1 to 3\)/],
  ['one state', (T) => { bar(T).things[0].states = ['only']; }, /1 states \(2 to 4, or none\)/],
  ['a state over 24', (T) => { bar(T).things[0].states = ['a', 's'.repeat(25)]; }, /a state is empty or over 24 characters/],
  ['fewer than 5 tags', (T) => withTags(T, 'pelican cloakroom', [['clue'], ['clue'], ['cover'], ['cover'], ['clue'], ['cover'], ['clue'], ['clue'], ['cover'], ['clue']]), /^Pelican cloakroom: only 2 different tags/],
  ['3 weapons', (T) => withTags(T, 'pelican cloakroom', [['weapon'], ['weapon'], ['weapon'], ['clue'], ['clue'], ['cover'], ['loot'], ['talk'], ['tool'], ['door']]), /^Pelican cloakroom: 3 weapons \(at most 2\)/],
  ['1 clue', (T) => withTags(T, 'pelican cloakroom', [['clue'], ['weapon'], ['cover'], ['loot'], ['talk'], ['tool'], ['door'], ['costume'], ['weird'], ['hazard']]), /^Pelican cloakroom: 1 clues \(at least 2\)/],
  ['no escape and no cover', (T) => withTags(T, 'pelican cloakroom', [['clue'], ['clue'], ['weapon'], ['loot'], ['talk'], ['tool'], ['door'], ['costume'], ['weird'], ['hazard']]), /^Pelican cloakroom: no escape and no cover/],
  ['a duplicate thing name', (T) => { bar(T).things[1].name = bar(T).things[0].name; }, /^Pelican bar: "A long zinc bar" repeats "A long zinc bar"/],
  ['a duplicate once articles go (the roomstate slug)', (T) => { bar(T).things[1].name = 'The long zinc bar'; }, /^Pelican bar: "The long zinc bar" repeats "A long zinc bar"/],
  ['an unknown band', (T) => { bar(T).band = 'open'; }, /band "open" is not one of/],
  ['themes that are not names', (T) => { bar(T).themes = [3]; }, /themes is not a short list of names/],
  ['a key that is not normRoom(name)', (T) => { bar(T).name = 'The Pelican Bar Two'; }, /its key "pelican bar" is not normRoom of its name/],
  ['no people', (T) => { bar(T).people = []; }, /0 people entries \(1 to 5\)/],
  ['a weight that is not a whole number', (T) => { bar(T).people[0].w = 1.5; }, /role waiter has no whole weight of 1 or more/],
  ['a role the roles do not hold', (T) => { bar(T).people[0].role = 'cook'; }, /role "cook" has no entry in the roles/],
  ['a role the figure kit does not know', (T) => { bar(T).people[0].role = 'plumber'; T.roles.plumber = clone(T.roles.waiter); }, /unknown role "plumber"/],
  ['a role entry with 2 lines', (T) => { T.roles.waiter.lines.pop(); }, /^role waiter: 2 lines \(exactly 3\)/],
  ['a role entry with a long look', (T) => { T.roles.waiter.looks[0] = 'x'.repeat(81); }, /^role waiter: look 1 is empty or over 80 characters/],
  ['a role entry with no pose', (T) => { T.roles.cleaner.pose = ''; }, /^role cleaner: has no pose/],
  ['a role the figure kit does not know, in the roles', (T) => { T.roles.plumber = clone(T.roles.waiter); }, /^role plumber: not a role the figure kit knows/],
  ['an alias that is a room', (T) => { T.aliases['pelican bar'] = 'pelican cloakroom'; }, /^alias pelican bar: is a room of its own/],
  ['an alias to nowhere', (T) => { T.aliases.ghost = 'nothing'; }, /^alias ghost: points at "nothing", which is not a room/],
  ['an alias that is not normalised', (T) => { T.aliases['Tap Room'] = 'pelican bar'; }, /^alias Tap Room: is not normRoom of itself/],
  ['no aliases object', (T) => { delete T.aliases; }, /^the part needs T\.rooms, T\.roles and T\.aliases/],
];
for (const [label, brk, re] of RED) {
  test('gm-room-tables check (red): ' + label + ' is named', () => {
    const T = clone(T0); brk(T);
    const errs = M.validate(T, { roles: ROLE_IDS }).errors;
    assert.ok(errs.some((e) => re.test(e)), 'no error matched ' + re + ':\n  ' + errs.join('\n  '));
    if (!/role figure|figure kit|unknown role/.test(label)) assert.ok(M.check(T).length > 0, 'check(T) says so too');
  });
}

test('gm-room-tables check (control): the fixture passes untouched; a valid tag set written by the same helper still passes, so the red rows above fail for their own reason', () => {
  assert.deepEqual(M.validate(T0, { roles: ROLE_IDS }).errors, []);
  const T = clone(T0); withTags(T, 'pelican cloakroom', OK); withTags(T, 'pelican bar', OK);
  assert.deepEqual(M.validate(T, { roles: ROLE_IDS }).errors, []);
  assert.deepEqual(M.check(T), []);
  // exactly at every limit is fine
  const E = clone(T0); const t = bar(E).things[0];
  t.name = 'n'.repeat(40); t.line = 'l'.repeat(80); t.look = 'k'.repeat(120); t.roll = 'r'.repeat(160); t.danger = 'd'.repeat(100); bar(E).say[0] = 's'.repeat(300);
  assert.deepEqual(M.validate(E, { roles: ROLE_IDS }).errors, []);
});

test('gm-room-tables validate: a room the map kit does not know is a warning, never an error; check() never throws on junk', () => {
  const v = M.validate(T0, { roles: ROLE_IDS, knownRoom: (n) => n !== 'Pelican bar' });
  assert.deepEqual(v.errors, []); assert.deepEqual(v.warnings, ['Pelican bar: the map kit does not know this room name']);
  assert.deepEqual(M.validate(T0, { knownRoom: () => { throw new Error('x'); } }).warnings, [], 'a throwing lookup is no warning');
  for (const junk of [undefined, null, 5, 'x', [], {}, { rooms: 5, roles: {}, aliases: {} }, { rooms: { a: null }, roles: {}, aliases: {} }, { rooms: { a: [] }, roles: { b: null }, aliases: { c: 3 } },
    { rooms: { 'pelican bar': { name: 'Pelican bar', things: [null, 7, 'x'] } }, roles: {}, aliases: {} }]) {
    assert.doesNotThrow(() => M.check(junk), JSON.stringify(junk));
    assert.ok(Array.isArray(M.check(junk)));
  }
  assert.ok(M.check({}).length > 0 && M.check(null).length > 0, 'a part with no tables is a problem');
});

test('gm-page CHECKED wiring: packWarnings({ B68GmRoomTables }, { rooms }) is silent for a good part, "rooms: ..." for a broken one, and says nothing when the module or the part is absent', () => {
  assert.deepEqual(P.packWarnings({ B68GmRoomTables: M }, { rooms: FIX }), []);
  const bad = clone(FIX); bar(bad.T).things.pop(); bar(bad.T).band = 'open';
  const w = P.packWarnings({ B68GmRoomTables: M }, { rooms: bad });
  assert.equal(w.length, 1); assert.equal(w[0].part, 'rooms');
  assert.ok(w[0].missing.some((m) => /Pelican bar: 9 things/.test(m)) && w[0].missing.some((m) => /band "open"/.test(m)), w[0].missing.join(' | '));
  assert.match(P.packWarnLines(w)[0], /^rooms: Pelican bar: /);
  assert.deepEqual(P.packWarnings({}, { rooms: bad }), [], 'the bundle is not loaded: nothing is said');
  assert.deepEqual(P.packWarnings({ B68GmRoomTables: M }, {}), [], 'no rooms part: nothing is said');
  const noT = P.packWarnings({ B68GmRoomTables: M }, { rooms: { v: 1 } });
  assert.equal(noT.length, 1); assert.match(noT[0].missing[0], /^the part needs T.rooms/, 'a rooms part with no tables is a warning, not silence');
});

test('gm-room-tables: the part is valid for the Update pack check (a rooms part needs no src and no T for the pack to load) and holds no key the page does not know', () => {
  const pk = { format: 1, exportedAt: 'x', parts: { console: { T: {} }, location: { T: {} }, rooms: FIX } };
  const v = P.validatePack(pk);
  assert.ok(!v.errors.some((e) => /rooms/.test(e)), v.errors.join(' | '));
  assert.ok(v.parts.some((p) => p.name === 'rooms'));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
