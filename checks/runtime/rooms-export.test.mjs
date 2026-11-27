// rooms-export (RK12 of the room key build; setting room.tables): the exporter scripts/lib/rooms-export.mjs, the validator it shares with the page
// (app/gm/room-tables.js), buildRooms in scripts/gm-pack.mjs, and the proof that the `rooms` part is GM only. No browser, no network, no vault, no key.
// INVENTED data only (the Pelican Rooms): checks/runtime/fixtures/gm/rooms-pages/ is a folder of fixture pages in the format page's shape, and
// checks/runtime/fixtures/gm/rooms-pack.json is the part they export to.
//   node checks/runtime/rooms-export.test.mjs
// Every validator rule is proved RED: the fixture pages are copied, the rule is broken in the copy by one edit that is asserted to have changed the text,
// and the exporter must name that rule (and the page and room) in its errors. The baseline copy must have none.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PART_RE, LIMITS } from '../../functions/_lib/gm.js';
import { exportRooms, POSES, FACES, PART_CAP, PART_SOFT } from '../../scripts/lib/rooms-export.mjs';
import { packLosses } from '../../scripts/lib/pack-guard.mjs';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { onRequest as packHandler } from '../../functions/api/gm/pack.js';
import { onRequest as displayHandler } from '../../functions/api/gm/display.js';
import { onRequest as screenHandler } from '../../functions/api/table/screen.js';
import { onRequest as campaignHandler } from '../../functions/api/campaign.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const Tables = require(path.join(ROOT, 'app', 'gm', 'room-tables.js'));
const Things = require(path.join(ROOT, 'app', 'gm', 'room-things.js'));
const Scene = require(path.join(ROOT, 'app', 'gm', 'scene-state.js'));
const Pack = await import(pathToFileURL(path.join(ROOT, 'scripts', 'gm-pack.mjs')).href);
const PAGES = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'rooms-pages');
const FIXTURE = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'rooms-pack.json');
const ROLE_IDS = Scene.ROLE_IDS;
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const tmps = [];
const mk = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rooms-export-')); tmps.push(d); return d; };
const clone = (o) => JSON.parse(JSON.stringify(o));
const FIX = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')), pack = FIX.T;
const TAGS = Things.TAGS;
const LIM = { name: 40, line: 80, look: 120, roll: 160, danger: 100 };
const norm = (s) => String(s).normalize('NFKC').toLowerCase().trim().replace(/^the\s+/, '').replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

/* ---------- editing a copy of the fixture pages ---------- */
function edit(dir, file, fn) {
  const p = path.join(dir, file), a = fs.readFileSync(p, 'utf8'), b = fn(a);
  assert.notEqual(b, a, 'the edit changed nothing');
  fs.writeFileSync(p, b);
}
function copyPages(rooms, roles) {
  const d = mk();
  for (const f of fs.readdirSync(PAGES)) fs.copyFileSync(path.join(PAGES, f), path.join(d, f));
  if (rooms) edit(d, 'pelican-rooms.md', rooms);
  if (roles) edit(d, 'pelican-roles.md', roles);
  return d;
}
const once = (a, b) => (t) => { assert.ok(t.includes(a), 'the anchor is not in the page: ' + a.slice(0, 50)); return t.replace(a, () => b); };
function span(t, name) { const s = t.indexOf('\n## ' + name + '\n'); assert.ok(s >= 0, 'no section ' + name); const e = t.indexOf('\n## ', s + 1); return [s, e < 0 ? t.length : e]; }
const inRoom = (name, fn) => (t) => { const [s, e] = span(t, name); return t.slice(0, s) + fn(t.slice(s, e)) + t.slice(e); };
const setTags = (name, sets) => inRoom(name, (sec) => { let i = 0; const out = sec.replace(/Tags: .*/g, () => 'Tags: ' + sets[i++].join(', ')); assert.equal(i, 10, 'ten Tags lines'); return out; });
const errorsOf = (dir) => exportRooms(dir).errors;

/* ---------- the slot ---------- */
await test('rooms: the part name is a legal pack part name, and the pack has room for a 12th part', () => {
  assert.ok(PART_RE.test('rooms'), 'PART_RE accepts "rooms"');
  assert.ok(LIMITS.parts >= 12, 'at most ' + LIMITS.parts + ' parts: the cap is 24, not the stale 12');
  assert.ok(!PART_RE.test('Rooms') && !PART_RE.test('rooms_x'), 'and still refuses a bad name');
});

await test('rooms-export: an empty folder is the empty part with no errors and no warnings; a page with no b68: key, and the format page, are skipped', () => {
  const d = mk();
  const r = exportRooms(d);
  assert.deepEqual(Object.keys(r).sort(), ['bytes', 'errors', 'part', 'warnings']);
  assert.deepEqual(r.part, { v: 1, T: { rooms: {}, roles: {}, aliases: {} } });
  assert.deepEqual(r.errors, []); assert.deepEqual(r.warnings, []);
  fs.writeFileSync(path.join(d, 'plain.md'), '# A page\n## Not a room\n- **Band:** public\n');
  fs.writeFileSync(path.join(d, 'format.md'), '---\nb68: rooms-format\n---\n## Pelican bar\n- **Band:** public\n');
  fs.writeFileSync(path.join(d, 'notes.txt'), '---\nb68: rooms\ntheme: x\n---\n## Pelican bar\n');
  assert.deepEqual(exportRooms(d).part, r.part);
});

await test('rooms-export: npm run gm:rooms-check is registered; check mode exits 0 on the fixture pages, 1 on a broken copy, 2 without a folder or on a non-folder', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['gm:rooms-check'] || '', /scripts\/lib\/rooms-export\.mjs --check/, 'gm:rooms-check runs the exporter in check mode');
  const run = (...a) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'lib', 'rooms-export.mjs'), ...a], { encoding: 'utf8' });
  const ok = run('--check', PAGES);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /rooms: 2 room\(s\), 2 role\(s\), 0 alias\(es\), [\d.]+ KiB, 0 error\(s\), 2 warning\(s\)/);
  const bad = run('--check', copyPages(once('- **Band:** public', '- **Band:** open')));
  assert.equal(bad.status, 1, bad.stdout); assert.match(bad.stdout, /^ERROR: pelican-rooms\.md > Pelican bar: band "open"/m);
  assert.equal(run('--check').status, 2, 'no folder: a usage line and exit 2');
  assert.equal(run('--check', path.join(PAGES, 'pelican-rooms.md')).status, 2, 'a file is not a folder');
});

/* ---------- the fixture JSON, and the pages that export to it ---------- */
await test('rooms fixture: the shape RK12.1 gives, under T so the CHECKED loop fits ({ v: 1, T: { rooms, roles, aliases } }), two rooms keyed by their normalised names', () => {
  assert.deepEqual(Object.keys(FIX), ['v', 'T']);
  assert.deepEqual(Object.keys(FIX.T), ['rooms', 'roles', 'aliases']);
  assert.equal(FIX.v, 1); assert.deepEqual(FIX.T.aliases, {});
  assert.deepEqual(Object.keys(FIX.T.rooms), ['pelican bar', 'pelican cloakroom']);
  for (const [key, r] of Object.entries(pack.rooms)) {
    assert.equal(norm(r.name), key, key + ': the key is normRoom(name)');
    assert.deepEqual(Object.keys(r), ['name', 'themes', 'band', 'say', 'people', 'things']);
    assert.ok(['public', 'working', 'controlled', 'secure'].includes(r.band), key + ' band: ' + r.band);
    assert.equal(r.say.length, 3, key + ': three says'); assert.equal(r.things.length, 10, key + ': ten things');
    for (const t of r.things) {
      assert.deepEqual(Object.keys(t), ['name', 'line', 'look', 'roll', 'danger', 'states', 'tags'], key + ': ' + t.name);
      for (const f of Object.keys(LIM)) assert.ok(typeof t[f] === 'string' && t[f].length <= LIM[f], key + ': ' + t.name + ' ' + f);
      for (const g of t.tags) assert.ok(TAGS.includes(g), key + ': known tag ' + g);
    }
  }
  assert.deepEqual(Object.keys(pack.roles), ['waiter', 'cleaner']);
});

await test('rooms fixture: the shared validator passes the fixture JSON as it stands (with the figure kit\'s roles), so the page-side check(T) says nothing', () => {
  const v = Tables.validate(pack, { roles: ROLE_IDS });
  assert.deepEqual(v.errors, []);
  assert.deepEqual(Tables.check(pack), []);
});

await test('rooms-export: the fixture pages export with 0 errors to the very part rooms-pack.json holds (pose and face the format\'s own words, a role look in lower case)', () => {
  const r = exportRooms(PAGES);
  assert.deepEqual(r.errors, []);
  const want = clone(FIX);
  Object.assign(want.T.roles.waiter, { pose: 'hold', face: 'pleased' }); Object.assign(want.T.roles.cleaner, { pose: 'carry', face: 'tired' });
  for (const o of Object.values(want.T.roles)) o.looks = o.looks.map((l) => l.charAt(0).toLowerCase() + l.slice(1));
  assert.deepStrictEqual(r.part, want);
  assert.deepEqual(Object.keys(r.part), ['v', 'T']); assert.deepEqual(Object.keys(r.part.T), ['rooms', 'roles', 'aliases']);
  // the only warnings: the map kit does not know an invented room
  assert.equal(r.warnings.length, 2); assert.ok(r.warnings.every((w) => /the map kit does not know this room name$/.test(w)), r.warnings.join(' | '));
  assert.ok(POSES.includes(r.part.T.roles.waiter.pose) && FACES.includes(r.part.T.roles.waiter.face));
});

await test('rooms-export: every thing is exactly what B68GmRoomThings.clean() makes of it, without its slug (no markdown, no odd separator left in a field)', () => {
  const r = exportRooms(PAGES);
  let n = 0;
  for (const room of Object.values(r.part.T.rooms)) for (const t of room.things) {
    const c = Things.clean(t); delete c.slug;
    assert.deepStrictEqual(c, t, room.name + ' > ' + t.name); n++;
  }
  assert.equal(n, 20);
  // and a page that leaves markdown in a field is told so, not shipped as it is
  const d = copyPages(once('GM-ONLY-look: a till key taped under the lip, still warm.', 'GM-ONLY-look: a *till key* taped under the lip, still [[warm]].'));
  const e = exportRooms(d);
  assert.deepEqual(e.errors, []);
  assert.equal(e.part.T.rooms['pelican bar'].things[0].look, 'GM-ONLY-look: a till key taped under the lip, still warm.', 'markdown is gone from the part');
});

/* ---------- RK12.2: every rule goes red ---------- */
const MIX = {
  ok: [['loot', 'talk'], ['weapon', 'cover'], ['clue'], ['clue', 'hazard'], ['escape', 'door'], ['tool'], ['costume'], ['weird'], ['loot'], ['talk']],
  fewTags: [['clue'], ['clue'], ['cover'], ['cover'], ['clue'], ['cover'], ['clue'], ['clue'], ['cover'], ['clue']],
  weapons: [['weapon'], ['weapon'], ['weapon'], ['clue'], ['clue'], ['cover'], ['loot'], ['talk'], ['tool'], ['door']],
  clues: [['clue'], ['weapon'], ['cover'], ['loot'], ['talk'], ['tool'], ['door'], ['costume'], ['weird'], ['hazard']],
  exits: [['clue'], ['clue'], ['weapon'], ['loot'], ['talk'], ['tool'], ['door'], ['costume'], ['weird'], ['hazard']],
};
const BAR = 'Pelican bar', CLOAK = 'Pelican cloakroom';
const SAY3 = '  3. The bar is quiet for a Friday. Every bottle has been turned to face the door.\n';
const RULES = [
  ['a room with 9 things', inRoom(BAR, (s) => s.replace(/\n {2}10\. [\s\S]*$/, '\n')), /Pelican bar: 9 things \(exactly 10\)/],
  ['a room with 11 things', inRoom(BAR, (s) => s + '  11. **A spare lamp**, Dusty.\n     - \u{1F50D} GM-ONLY-look: x.\n     - Tags: tool\n'), /Pelican bar: 11 things \(exactly 10\)/],
  ['a room with 2 says', once(SAY3, ''), /Pelican bar: 2 say lines \(exactly 3\)/],
  ['a room with 4 says', once(SAY3, SAY3 + '  4. A fourth line.\n'), /Pelican bar: 4 say lines \(exactly 3\)/],
  ['a say over 300', once('Somebody has left the radio on.', 'x'.repeat(300)), /Pelican bar: say 1 is \d+ characters \(at most 300\)/],
  ['a name over 40', once('**A long zinc bar**', '**A long zinc bar ' + 'z'.repeat(30) + '**'), /thing 1 \(A long zinc bar z+\): name is 46 characters \(at most 40\)/],
  ['a first line over 80 with its name', once('Wet rings on the zinc, a cloth left folded.', 'Wet rings on the zinc, a cloth left folded, ' + 'q'.repeat(40) + '.'), /thing 1 \(A long zinc bar\): the first line is \d+ characters with its name \(at most 80\)/],
  ['a closer look over 120', once('GM-ONLY-look: a till key taped under the lip, still warm.', 'GM-ONLY-look: ' + 'k'.repeat(110)), /thing 1 \(A long zinc bar\): look is 124 characters \(at most 120\)/],
  ['a roll over 160', once('GM-ONLY-roll: 4/5 a few notes. 6: the whole float.', 'GM-ONLY-roll: 4/5 a few. 6: ' + 'r'.repeat(150)), /thing 1 \(A long zinc bar\): roll is 1\d\d characters \(at most 160\)/],
  ['a danger over 100', once('GM-ONLY-danger: The lid scalds.', 'GM-ONLY-danger: ' + 'd'.repeat(90)), /thing 4 \(A glass-washer, humming\): danger is 106 characters \(at most 100\)/],
  ['an unknown tag', once('Tags: loot\n', 'Tags: loot, treasure\n'), /thing 1 \(A long zinc bar\): unknown tag "treasure"/],
  ['four tags on a thing', once('Tags: weapon, cover', 'Tags: weapon, cover, loot, clue'), /thing 2 \(A row of upturned stools\): 4 tags \(1 to 3\)/],
  ['a thing with no Tags line', once('     - Tags: loot\n', ''), /thing 1 \(A long zinc bar\): no Tags line/],
  ['a thing with no closer look', once('     - \u{1F50D} GM-ONLY-look: a till key taped under the lip, still warm.\n', ''), /thing 1 \(A long zinc bar\): no closer look/],
  ['one state', once('State: closed · open', 'State: closed'), /thing 1 \(A long zinc bar\): 1 states \(2 to 4, or none\)/],
  ['five states', once('State: closed · open', 'State: a · b · c · d · e'), /thing 1 \(A long zinc bar\): 5 states \(2 to 4, or none\)/],
  ['a state over 24', once('State: closed · open', 'State: closed · ' + 's'.repeat(30)), /a state is empty or over 24 characters/],
  ['an unknown role', once('waiter 3', 'plumber 3'), /Pelican bar: unknown role "plumber"/],
  ['a role the roles page does not write', once('cleaner 1', 'cook 1'), /Pelican bar: role "cook" has no entry in the roles/],
  ['a People entry that is not "role weight"', once('waiter 3', 'waiter three'), /Pelican bar: the People entry "waiter three" is not "role weight"/],
  ['a weight of 0', once('waiter 3', 'waiter 0'), /Pelican bar: role waiter has no whole weight of 1 or more/],
  ['fewer than 5 different tags', setTags(CLOAK, MIX.fewTags), /Pelican cloakroom: only 2 different tags/],
  ['no more than 2 weapons', setTags(CLOAK, MIX.weapons), /Pelican cloakroom: 3 weapons \(at most 2\)/],
  ['fewer than 2 clues', setTags(CLOAK, MIX.clues), /Pelican cloakroom: 1 clues \(at least 2\)/],
  ['no escape and no cover', setTags(CLOAK, MIX.exits), /Pelican cloakroom: no escape and no cover/],
  ['a duplicate thing name', once('**A row of upturned stools**', '**A long zinc bar**'), /Pelican bar: "A long zinc bar" repeats "A long zinc bar"/],
  ['a duplicate thing name once articles are dropped (roomstate\'s slug)', once('**A row of upturned stools**', '**The long zinc bar**'), /Pelican bar: "The long zinc bar" repeats "A long zinc bar"/],
  ['a thing numbered out of order', once('  2. **A row of upturned stools**', '  3. **A row of upturned stools**'), /thing 2: numbered 3 \(expected 2\)/],
  ['a thing whose first line has no **Name**', once('  1. **A long zinc bar**, Wet', '  1. A long zinc bar, Wet'), /thing 1: the first line must start with \*\*Name\*\*/],
  ['a line under a thing that is none of the five', once('     - State: closed · open\n', '     - State: closed · open\n     - Weather: damp\n'), /thing 1 \(A long zinc bar\): an unexpected line: "Weather: damp"/],
  ['a band that is not one of the four', once('- **Band:** public', '- **Band:** open'), /Pelican bar: band "open" is not one of public, working, controlled, secure/],
  ['no Band line', once('- **Band:** public\n', ''), /Pelican bar: no Band line/],
  ['a page with no theme', once('theme: the Pelican Rooms\n', ''), /pelican-rooms\.md > the frontmatter has no theme:/],
];
for (const [label, mutate, re] of RULES) {
  await test('rooms-export (red): ' + label + ' fails and is named', () => {
    const errs = errorsOf(copyPages(mutate));
    assert.ok(errs.some((e) => re.test(e)), 'no error matched ' + re + ':\n  ' + errs.join('\n  '));
    assert.ok(errs.every((e) => /^pelican-rooms\.md > /.test(e)), 'every error names its page: ' + errs[0]);
  });
}

await test('rooms-export (control): a valid tag set written by the same helper still exports with 0 errors, so the tag rules above fail for their own reason', () => {
  assert.deepEqual(errorsOf(copyPages(setTags(CLOAK, MIX.ok))), []);
  assert.deepEqual(errorsOf(copyPages(setTags(BAR, MIX.ok))), []);
});

const ROLE_RULES = [
  ['a pose that is not one of the nine', once('**Pose:** hold', '**Pose:** slouch'), /role waiter: Pose "slouch" is not one of/],
  ['a face that is not one of the seventeen', once('**Face:** tired', '**Face:** bored'), /role cleaner: Face "bored" is not one of/],
  ['a role with 2 lines', once('  3. "If you want the good seats, ask me before they’re taken."\n', ''), /role waiter: 2 lines \(exactly 3\)/],
  ['a role line over 120', once('Nobody looks at the mop.', 'Nobody looks at the mop. ' + 'n'.repeat(120)), /role cleaner: line 3 is empty or over 120 characters/],
  ['a role look over 80', once('sleeves pushed up, hands red from the water.', 'sleeves pushed up, hands red from the water' + ', and'.repeat(10) + '.'), /role cleaner: look 2 is empty or over 80 characters/],
  ['a role the figure kit does not know', once('## waiter', '## plumber'), /role plumber: not a role the figure kit knows/],
  ['a role written twice', (t) => t + '\n## cleaner\n- **Lines:**\n  1. "a"\n  2. "b"\n  3. "c"\n- **Looks:**\n  1. x\n  2. y\n- **Pose:** hold\n- **Face:** tired\n', /role cleaner: written twice/],
];
for (const [label, mutate, re] of ROLE_RULES) {
  await test('rooms-export (red): ' + label + ' fails and is named', () => {
    const errs = errorsOf(copyPages(null, mutate));
    assert.ok(errs.some((e) => re.test(e)), 'no error matched ' + re + ':\n  ' + errs.join('\n  '));
  });
}

await test('rooms-export (red): a room written on two pages fails, and a role "waiter" left off the roles page fails the room that names it', () => {
  const d = copyPages();
  fs.copyFileSync(path.join(d, 'pelican-rooms.md'), path.join(d, 'pelican-rooms2.md'));
  assert.ok(errorsOf(d).some((e) => /^pelican-rooms2\.md > Pelican bar: already written in pelican-rooms\.md/.test(e)), errorsOf(d).join('\n'));
  const e2 = errorsOf(copyPages(null, (t) => t.slice(0, t.indexOf('\n## waiter')) + t.slice(t.indexOf('\n## cleaner'))));
  assert.ok(e2.some((e) => /Pelican bar: role "waiter" has no entry in the roles/.test(e)), e2.join('\n'));
});

await test('rooms-export: a room name the map kit does not know is a WARNING (never an error), and one it knows is not warned about', () => {
  const r = exportRooms(PAGES);
  assert.ok(r.warnings.some((w) => /Pelican bar: the map kit does not know this room name/.test(w)));
  const known = exportRooms(copyPages(once('## Pelican bar', '## Janitor\'s closet')));
  assert.ok(!known.warnings.some((w) => /Janitor/.test(w)), 'a catalogue room is not warned about: ' + known.warnings.join(' | '));
  assert.equal(known.errors.length, 0);
});

/* ---------- the part: aliases, get() ---------- */
await test('rooms-export + get(): a leading a / an / some is also an alias; a room may add names with an Aliases line; an alias may not shadow a room', () => {
  const d1 = copyPages(once('## Pelican bar', '## A Pelican bar'));
  const r1 = exportRooms(d1);
  assert.deepEqual(r1.errors, []);
  assert.deepEqual(Object.keys(r1.part.T.rooms), ['a pelican bar', 'pelican cloakroom']);
  assert.deepEqual(r1.part.T.aliases, { 'pelican bar': 'a pelican bar' });
  assert.equal(Tables.get('Pelican bar', r1.part.T).name, 'A Pelican bar', 'get() finds the room by its alias');
  assert.equal(Tables.get('A Pelican Bar!', r1.part.T).name, 'A Pelican bar', 'and by its own name, case and punctuation aside');
  assert.equal(Tables.keyOf('the pelican bar', r1.part.T), 'a pelican bar', 'a leading "the" is dropped by normRoom first');
  const d2 = copyPages(once('- **People:** waiter 3 · cleaner 1 · nobody 2\n', '- **People:** waiter 3 · cleaner 1 · nobody 2\n- **Aliases:** Zinc bar · The tap room\n'));
  const r2 = exportRooms(d2);
  assert.deepEqual(r2.errors, []);
  assert.deepEqual(r2.part.T.aliases, { 'zinc bar': 'pelican bar', 'tap room': 'pelican bar' });
  assert.equal(Tables.get('the Tap Room', r2.part.T).name, 'Pelican bar', 'get() finds a room by an alias a room wrote');
  assert.equal(Tables.get('Zinc bar', r2.part.T).things.length, 10);
  const d3 = copyPages(once('- **People:** waiter 3 · cleaner 1 · nobody 2\n', '- **People:** waiter 3 · cleaner 1 · nobody 2\n- **Aliases:** Pelican cloakroom\n'));
  assert.ok(errorsOf(d3).some((e) => /Pelican bar: the alias "Pelican cloakroom" is a room of its own/.test(e)));
});

await test('room-tables get(): a room the table lacks is null (the caller says "No table for <room>"): no theme fallback, no prototype key, no blank; a copy is returned', () => {
  const T = clone(pack);
  assert.equal(Tables.get('Pelican laundry', T), null);
  for (const bad of ['', '   ', undefined, null, 'constructor', '__proto__', 'toString', 'hasOwnProperty']) assert.equal(Tables.get(bad, T), null, String(bad));
  assert.equal(Tables.get('Pelican bar', null), null); assert.equal(Tables.get('Pelican bar', {}), null);
  assert.equal(Tables.role('cook', T), null); assert.equal(Tables.role('constructor', T), null);
  assert.equal(Tables.role('waiter', T).lines.length, 3);
  const g = Tables.get('pelican bar', T); g.things.length = 0; g.name = 'changed';
  assert.equal(T.rooms['pelican bar'].things.length, 10, 'get() hands back a copy');
  assert.equal(Tables.get('the pelican bar', T).name, 'Pelican bar');
  const inst = Tables.create(T);
  assert.deepEqual(inst.keys(), ['pelican bar', 'pelican cloakroom']);
  assert.equal(inst.get('Pelican cloakroom').band, 'working'); assert.equal(inst.get('nope'), null); assert.deepEqual(inst.check(), []);
});

/* ---------- sizes: 95 rooms, 39 roles ---------- */
const WORDS = 'brass lamp ledger cabinet crate hook rail stool rug mirror bell shutter drawer lock trunk pipe vent chair bench shelf'.split(' ');
function pad(prefix, n, seed) {
  let s = prefix, i = seed;
  while (s.length < n) s += ' ' + WORDS[i++ % WORDS.length];
  s = s.slice(0, n);
  return /\s$/.test(s) ? s.slice(0, -1) + 'x' : s;
}
const TAG_SETS = [['loot', 'talk'], ['weapon', 'cover'], ['clue'], ['clue', 'hazard'], ['escape', 'door'], ['tool'], ['costume'], ['weird', 'cover'], ['loot'], ['talk']];
function genPages(nRooms, fill) {
  const d = mk(), themes = 8, pages = [];
  for (let t = 0; t < themes; t++) pages.push('---\nb68: rooms\ntheme: Invented theme ' + (t + 1) + '\n---\n');
  for (let n = 0; n < nRooms; n++) {
    let s = '\n## Pelican room ' + (n + 1) + '\n- **Band:** ' + ['public', 'working', 'controlled', 'secure'][n % 4] + '\n- **Say:**\n';
    for (let k = 0; k < 3; k++) s += '  ' + (k + 1) + '. ' + pad('A room that is invented.', Math.floor(300 * fill), n + k) + '\n';
    s += '- **People:** ' + ROLE_IDS[n % 39] + ' 3 · ' + ROLE_IDS[(n + 7) % 39] + ' 1 · nobody 2\n- **Things:**\n';
    for (let i = 0; i < 10; i++) {
      const name = 'A ' + WORDS[(n + i) % 20] + ' ' + (i + 1), first = Math.floor(80 * fill);
      s += '  ' + (i + 1) + '. **' + name + '**, ' + pad('the first line', first - name.length - 2, n + i) + '\n';
      s += '     - \u{1F50D} ' + pad('GM-ONLY-look:', Math.floor(120 * fill), n + i + 1) + '\n';
      s += '     - \u{1F3B2} ' + pad('GM-ONLY-roll: 4/5 a few. 6: more', Math.floor(160 * fill), n + i + 2) + '\n';
      if (i % 2) s += '     - ! ' + pad('GM-ONLY-danger:', Math.floor(100 * fill), n + i + 3) + '\n';
      if (i % 3 === 0) s += '     - State: shut · open\n';
      s += '     - Tags: ' + TAG_SETS[i].join(', ') + '\n';
    }
    pages[n % themes] += s;
  }
  pages.forEach((p, i) => fs.writeFileSync(path.join(d, 'theme-' + (i + 1) + '.md'), p));
  let r = '---\nb68: room-roles\n---\n';
  ROLE_IDS.forEach((id, k) => {
    r += '\n## ' + id + '\n- **Lines:**\n' + [0, 1, 2].map((j) => '  ' + (j + 1) + '. "' + pad('Something invented.', Math.floor(118 * fill), k + j) + '"').join('\n') +
      '\n- **Looks:**\n' + [0, 1].map((j) => '  ' + (j + 1) + '. ' + pad('a look', Math.floor(80 * fill), k + j)).join('\n') + '\n- **Pose:** ' + POSES[k % POSES.length] + '\n- **Face:** ' + FACES[k % FACES.length] + '\n';
  });
  fs.writeFileSync(path.join(d, 'roles.md'), r);
  return d;
}

await test('rooms-export: 95 invented rooms and the 39 roles (every field at 80% of its limit) export with 0 errors, under the 600 KB budget, measured as gm-pack measures it', () => {
  const r = exportRooms(genPages(95, 0.8));
  assert.deepEqual(r.errors, []);
  assert.equal(Object.keys(r.part.T.rooms).length, 95); assert.equal(Object.keys(r.part.T.roles).length, 39);
  assert.equal(r.bytes, Buffer.byteLength(JSON.stringify(r.part)));
  assert.ok(r.bytes < PART_SOFT, 'the part is ' + r.bytes + ' bytes');
  assert.ok(!r.warnings.some((w) => /budget/.test(w)));
  assert.deepEqual(Tables.check(r.part.T), [], 'and the page-side check says nothing');
  console.log('     95 rooms and 39 roles at 80% of every limit: ' + (r.bytes / 1024).toFixed(1) + ' KiB');
});

await test('rooms-export: every field at its limit (the worst 95 rooms the validator lets through) is under the 900 KiB cap; past 600 KB it warns, past the cap it fails', () => {
  const r = exportRooms(genPages(95, 1));
  assert.deepEqual(r.errors, []);
  console.log('     95 rooms and 39 roles at 100% of every limit: ' + (r.bytes / 1024).toFixed(1) + ' KiB (budget 600, cap 900)');
  assert.ok(r.bytes < PART_CAP);
  const mid = exportRooms(genPages(Math.ceil(95 * (PART_SOFT * 1.1) / r.bytes), 1));
  assert.deepEqual(mid.errors, []); assert.ok(mid.bytes > PART_SOFT && mid.bytes < PART_CAP, 'mid ' + mid.bytes);
  assert.ok(mid.warnings.some((w) => /past the 600 KiB budget/.test(w)), 'a warning past the budget');
  const over = exportRooms(genPages(Math.ceil(95 * (PART_CAP * 1.1) / r.bytes), 1));
  assert.ok(over.bytes > PART_CAP);
  assert.ok(over.errors.some((e) => /over the server's 900 KiB cap/.test(e)), 'an error past the cap: ' + over.errors.join(' | '));
});

/* ---------- RK12.3: buildRooms and the pack guard ---------- */
const warned = () => { const w = Pack.exportWarnings.slice(); Pack.exportWarnings.length = 0; return w; };
function vaultWith(dirName, pages) {
  const v = mk(), dir = path.join(v, 'Wiki', 'Games', 'Blades in the Dark', 'Tools', dirName);
  fs.mkdirSync(dir, { recursive: true });
  if (pages) for (const f of fs.readdirSync(pages)) fs.copyFileSync(path.join(pages, f), path.join(dir, f));
  return v;
}
await test('buildRooms: the 12th part. Pages in Tools/Room tables/ give { v: 1, T }; no folder, no pages, or only the format page give no part', () => {
  warned();
  const part = Pack.buildRooms(vaultWith('Room tables', PAGES));
  assert.deepStrictEqual(part, exportRooms(PAGES).part);
  assert.deepEqual(Object.keys(part), ['v', 'T']);
  assert.ok(warned().every((w) => /^rooms: .*the map kit does not know/.test(w)));
  assert.equal(Pack.buildRooms(mk()), null, 'no Tools folder');
  assert.equal(Pack.buildRooms(vaultWith('Room tables', null)), null, 'an empty Room tables folder');
  const only = mk(); fs.copyFileSync(path.join(PAGES, 'pelican-format.md'), path.join(only, 'pelican-format.md'));
  assert.equal(Pack.buildRooms(vaultWith('Room tables', only)), null, 'only the format page');
  assert.deepEqual(warned(), []);
  assert.equal(Pack.buildRooms(vaultWith('Other tables', PAGES)), null, 'pages in another folder are not read');
});

await test('buildRooms: an error in the pages leaves the part OUT (the pack still builds) and says why as WARNINGs; the pack guard then refuses to drop a rooms part the app has', () => {
  warned();
  const bad = copyPages(once('- **Band:** public', '- **Band:** open'));
  assert.equal(Pack.buildRooms(vaultWith('Room tables', bad)), null);
  const w = warned();
  assert.ok(w.some((m) => /^rooms: ERROR pelican-rooms\.md > Pelican bar: band "open"/.test(m)), w.join('\n'));
  assert.ok(w.some((m) => /^rooms: 1 error\(s\) in Tools\/Room tables\/, so there is no rooms part this time: npm run gm:rooms-check/.test(m)));
  const had = exportRooms(PAGES).part;
  const gone = packLosses({ rooms: had, console: { T: {} } }, { console: { T: {} } });
  assert.ok(gone.some((l) => l.part === 'rooms' && /the rooms part is gone/.test(l.what)), JSON.stringify(gone));
  assert.deepEqual(packLosses({ console: { T: {} } }, { console: { T: {} } }), [], 'no rooms part before and none now: nothing is lost');
});

await test('pack-guard: a rooms part that shrinks below 75% is refused, and a part at 75% or more is not; the server\'s 900 KiB cap names the part', () => {
  const full = exportRooms(PAGES).part, half = clone(full);
  delete half.T.rooms['pelican cloakroom'];
  const lost = packLosses({ rooms: full }, { rooms: half });
  assert.equal(lost.length, 1); assert.match(lost[0].what, /the rooms part shrank from [\d.]+ KiB to [\d.]+ KiB/);
  const slight = clone(full); slight.T.rooms['pelican bar'].things.pop();
  assert.deepEqual(packLosses({ rooms: full }, { rooms: slight }), []);
  assert.equal(PART_CAP, LIMITS.partBody, 'the exporter\'s cap is the server\'s');
});

/* ---------- GM only ---------- */
const GM = { role: 'gm', id: 'gm@example.test' };
const reqOf = (method, url, body) => new Request('https://blades.example.test' + url, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: body === undefined ? {} : { 'content-type': 'application/json' } });
await test('the rooms part is GM only: /api/gm/pack is 403 for a player, the table display and no sign-in, on every method, before the database is touched', async () => {
  const touched = [];
  const env = { get DB() { touched.push('DB'); return undefined; }, CAMPAIGN: 'c' };
  for (const me of [{ role: 'player', id: 'p@example.test' }, { role: 'display', id: 'd@example.test' }, undefined]) {
    for (const [method, url] of [['GET', '/api/gm/pack?part=rooms'], ['GET', '/api/gm/pack'], ['DELETE', '/api/gm/pack?part=rooms'], ['POST', '/api/gm/pack']]) {
      let err = null;
      try { await packHandler({ request: new Request('https://blades.example.test' + url, { method, body: method === 'POST' ? '{"part":"rooms","body":{}}' : undefined }), env, data: { me } }); } catch (e) { err = e; }
      assert.ok(err && err.status === 403, method + ' ' + url + ' as ' + (me && me.role));
    }
  }
  assert.deepEqual(touched, []);
});

await test('the rooms part is GM only: with a rooms part stored, the display\'s GET, the phones\' Table copy and the campaign document carry none of it (GM-ONLY- markers and room names are absent), while the GM\'s own read has them', async () => {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec), env = { DB: db, CAMPAIGN: 'c' };
  const posted = await packHandler({ request: reqOf('POST', '/api/gm/pack', { part: 'rooms', src: {}, body: FIX }), env, data: { me: GM } });
  assert.equal(posted.status, 200);
  const mine = await packHandler({ request: reqOf('GET', '/api/gm/pack?part=rooms'), env, data: { me: GM } });
  const mineText = await mine.text();
  assert.ok(mineText.includes('GM-ONLY-look') && mineText.includes('Pelican bar'), 'the control: the GM reads the part');
  const probes = [
    ['the display GET', displayHandler({ request: reqOf('GET', '/api/gm/display?seq=0'), env, data: { me: { role: 'display', id: 'd@example.test' } }, waitUntil() {} })],
    ['the Table copy, as a player', screenHandler({ request: reqOf('GET', '/api/table/screen'), env, data: { me: { role: 'player', id: 'p@example.test' } } })],
    ['the Table copy, as the display', screenHandler({ request: reqOf('GET', '/api/table/screen'), env, data: { me: { role: 'display', id: 'd@example.test' } } })],
    ['the campaign document, as a player', campaignHandler({ request: reqOf('GET', '/api/campaign'), env, data: { me: { role: 'player', id: 'p@example.test' } }, waitUntil() {} })],
  ];
  for (const [what, p] of probes) {
    const res = await p, text = await res.text();
    assert.ok(res.status === 200, what + ': ' + res.status + ' ' + text.slice(0, 120));
    assert.ok(!/GM-ONLY|Pelican|zinc|cloakroom|till key/i.test(text), what + ' holds a part of the rooms part: ' + text.slice(0, 200));
  }
  let denied = null;
  try { await packHandler({ request: reqOf('GET', '/api/gm/pack?part=rooms'), env, data: { me: { role: 'player', id: 'p@example.test' } } }); } catch (e) { denied = e; }
  assert.ok(denied && denied.status === 403);
});

for (const d of tmps) fs.rmSync(d, { recursive: true, force: true });
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
