// rooms-export: the `rooms` pack part's slot (RK01.4) and the exporter's stub (scripts/lib/rooms-export.mjs). Registered by RK01 of the room key
// build; RK12 builds the exporter and the validator and fills this test. No browser, no network, no vault. INVENTED data only (the Pelican Rooms).
// For now it checks that: the part name `rooms` is a legal pack part name and fits under the part count; exportRooms(dir) returns the empty part
// { v: 1, T: { rooms: {}, roles: {}, aliases: {} } } with no errors; `gm:rooms-check` runs it in check mode; and the invented fixture
// checks/runtime/fixtures/gm/rooms-pack.json has the shape RK12.1 gives and meets the limits and mix rules RK12.2 will enforce.
//   node checks/runtime/rooms-export.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PART_RE, LIMITS } from '../../functions/_lib/gm.js';
import { exportRooms } from '../../scripts/lib/rooms-export.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'rooms-pack.json');
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const TAGS = ['loot', 'clue', 'weapon', 'escape', 'cover', 'costume', 'talk', 'weird', 'hazard', 'tool', 'door'];
const LIM = { name: 40, line: 80, look: 120, roll: 160, danger: 100 };
const norm = (s) => String(s).normalize('NFKC').toLowerCase().trim().replace(/^the\s+/, '').replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

test('rooms: the part name is a legal pack part name, and the pack has room for a 12th part', () => {
  assert.ok(PART_RE.test('rooms'), 'PART_RE accepts "rooms"');
  assert.ok(LIMITS.parts >= 12, 'at most ' + LIMITS.parts + ' parts: the cap is 24, not the stale 12');
  assert.ok(!PART_RE.test('Rooms') && !PART_RE.test('rooms_x'), 'and still refuses a bad name');
});

test('rooms-export: exportRooms(dir) is the empty part with no errors and no warnings (a stub until RK12)', () => {
  const r = exportRooms(os.tmpdir());
  assert.deepEqual(Object.keys(r).sort(), ['errors', 'part', 'warnings']);
  assert.deepEqual(r.part, { v: 1, T: { rooms: {}, roles: {}, aliases: {} } });
  assert.deepEqual(r.errors, []); assert.deepEqual(r.warnings, []);
});

test('rooms-export: npm run gm:rooms-check is registered and its check mode exits 0 on a folder, 2 without one', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['gm:rooms-check'] || '', /scripts\/lib\/rooms-export\.mjs --check/, 'gm:rooms-check runs the exporter in check mode');
  const ok = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lib', 'rooms-export.mjs'), '--check', os.tmpdir()], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  const none = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lib', 'rooms-export.mjs'), '--check'], { encoding: 'utf8' });
  assert.equal(none.status, 2, 'no folder: a usage line and exit 2');
});

const FIX = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')), pack = FIX.T;

test('rooms fixture: the shape RK12.1 gives, under T so the CHECKED loop fits ({ v: 1, T: { rooms, roles, aliases } }), two rooms of the Pelican Rooms keyed by their normalised names', () => {
  assert.deepEqual(Object.keys(FIX), ['v', 'T']);
  assert.deepEqual(Object.keys(FIX.T), ['rooms', 'roles', 'aliases']);
  assert.equal(FIX.v, 1); assert.deepEqual(FIX.T.aliases, {});
  assert.deepEqual(Object.keys(FIX.T.rooms), ['pelican bar', 'pelican cloakroom']);
  for (const [key, r] of Object.entries(pack.rooms)) {
    assert.equal(norm(r.name), key, key + ': the key is normRoom(name)');
    assert.deepEqual(Object.keys(r), ['name', 'themes', 'band', 'say', 'people', 'things']);
    assert.ok(Array.isArray(r.themes) && r.themes.length, key + ' has themes');
    assert.ok(['public', 'working', 'controlled', 'secure'].includes(r.band), key + ' band: ' + r.band);
    assert.equal(r.say.length, 3, key + ': three says');
    assert.ok(r.people.every((p) => typeof p.role === 'string' && Number.isInteger(p.w) && p.w > 0), key + ': people are { role, w }');
    assert.equal(r.things.length, 10, key + ': ten things');
  }
});

test('rooms fixture: every thing is { name, line, look, roll, danger, states[], tags[] } inside the limits, with known tags', () => {
  for (const [key, r] of Object.entries(pack.rooms)) for (const t of r.things) {
    assert.deepEqual(Object.keys(t), ['name', 'line', 'look', 'roll', 'danger', 'states', 'tags'], key + ': ' + t.name);
    for (const f of Object.keys(LIM)) assert.ok(typeof t[f] === 'string' && t[f].length <= LIM[f], key + ': ' + t.name + ' ' + f + ' is a string of at most ' + LIM[f]);
    assert.ok(t.name && t.line, key + ': a thing has a name and a line');
    assert.ok(Array.isArray(t.states) && Array.isArray(t.tags) && t.tags.length, key + ': ' + t.name + ' has tags');
    for (const g of t.tags) assert.ok(TAGS.includes(g), key + ': known tag ' + g);
  }
});

test('rooms fixture: the mix rules RK12.2 will enforce (5+ tags, at most 2 weapons, 2+ clues, an escape or cover, no duplicate name)', () => {
  for (const [key, r] of Object.entries(pack.rooms)) {
    const all = r.things.flatMap((t) => t.tags), count = (g) => all.filter((x) => x === g).length;
    assert.ok(new Set(all).size >= 5, key + ': at least five distinct tags');
    assert.ok(count('weapon') <= 2, key + ': at most two weapons');
    assert.ok(count('clue') >= 2, key + ': at least two clues');
    assert.ok(count('escape') + count('cover') >= 1, key + ': a way out or cover');
    assert.equal(new Set(r.things.map((t) => t.name.toLowerCase())).size, 10, key + ': no duplicate thing name');
  }
});

test('rooms fixture: roles (waiter, cleaner) hold 3 lines, 2 looks, a pose and a face; every role a room names exists; the hidden text carries GM-ONLY- markers', () => {
  assert.deepEqual(Object.keys(pack.roles), ['waiter', 'cleaner']);
  for (const [k, o] of Object.entries(pack.roles)) {
    assert.equal(o.lines.length, 3, k + ': three lines'); assert.equal(o.looks.length, 2, k + ': two looks');
    assert.ok(o.pose && o.face, k + ': a pose and a face');
  }
  for (const [key, r] of Object.entries(pack.rooms)) for (const p of r.people) assert.ok(p.role === 'nobody' || pack.roles[p.role], key + ': role ' + p.role + ' is known');
  const looks = Object.values(pack.rooms).flatMap((r) => r.things.map((t) => t.look)).filter(Boolean);
  assert.ok(looks.length >= 18 && looks.every((l) => l.startsWith('GM-ONLY-')), 'a closer look is always a marked, GM-only string');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
