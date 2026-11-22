// gm-room-things (RK08.1 to RK08.3, room.key): app/gm/room-things.js reads a room note's things. INVENTED data only: the Pelican Rooms of
// checks/runtime/fixtures/gm/pelican-room-things.md (GM-ONLY- markers on every closer look, roll and danger), the rooms-pack fixture's
// things, and the demo night's room notes. The grammar, the old one-line Find, a nested Find, fences, the limits, slugs, room-notes.js
// unchanged (every old room note parses to nothing and keeps its md), and things kept GM-side (RK08.3). No browser, no network.
//   node checks/runtime/gm-room-things.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/room-things.js';
const RT = require(path.join(ROOT, FILE));
const RN = require(path.join(ROOT, 'app', 'gm', 'room-notes.js'));
const FX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm');
const NOTE = fs.readFileSync(path.join(FX, 'pelican-room-things.md'), 'utf8');
const ROOMS = ['Showroom', 'Cocktail lounge', 'Underground counting room', 'Security control room', 'Private card rooms', 'Luxury penthouse', 'Pelican cloakroom'];
const PART = { notes: [{ id: 'n-pelican', rel: 'prep/pelican.md', title: 'The Pelican Rooms', blocks: [{ k: 'md', src: NOTE }] }] };
const FOUND = RN.find(PART, ROOMS);
const mdOf = (room) => FOUND.byRoom[room].md;
const T = (name, o = {}) => Object.assign({ name, line: '', look: '', roll: '', danger: '', states: [], tags: [], slug: RT.slug(name) }, o);

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

test('gm-room-things: loads under Node, and as a plain script defines window.B68GmRoomThings (room-notes.js read when called, not at load)', () => {
  assert.equal(RT.stub, undefined, 'no longer a stub');
  for (const k of ['parse', 'read', 'slug', 'clean']) assert.equal(typeof RT[k], 'function', k);
  assert.deepEqual(RT.LIMITS, { name: 40, line: 80, look: 120, roll: 160, danger: 100, state: 24, states: 4, tags: 3, slug: 40 });
  assert.equal(RT.MAX, 10);
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, FILE), 'utf8'), win, { filename: FILE });
  assert.ok(win.B68GmRoomThings && typeof win.B68GmRoomThings.parse === 'function', 'defined with nothing else loaded');
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'app', 'gm', 'room-notes.js'), 'utf8'), win, { filename: 'room-notes.js' });
  assert.deepEqual(JSON.parse(JSON.stringify(win.B68GmRoomThings.parse(mdOf('Showroom')))), RT.parse(mdOf('Showroom')), 'in the browser shape it reads exactly as under Node');
});

test('the fixture: room-notes finds all seven Pelican rooms (the fenced "## Rooms" is passed over), and the Showroom parses to its four things', () => {
  assert.equal(FOUND.source, 'n-pelican'); assert.deepEqual(FOUND.missing, []); assert.deepEqual(FOUND.extra, []);
  assert.deepEqual(RT.parse(mdOf('Showroom')), [
    T('A brass umbrella stand', { line: 'too heavy to tip.', look: 'GM-ONLY-look: one umbrella is dry, though it is raining outside.',
      roll: 'GM-ONLY-roll: 4/5: a cloakroom ticket in its folds. 6: and the number on it is circled.',
      danger: 'GM-ONLY-danger: the stand rings like a bell if it is knocked.', states: ['full', 'empty'], tags: ['clue'] }),
    T('A velvet rope', { line: 'on two brass posts.', look: 'GM-ONLY-look: one post is hollow and unscrews at the knob.', tags: ['cover'] }),
    T('The stage curtain', { line: 'heavy with dust.', look: 'GM-ONLY-look: a door behind it, painted to look like the wall.',
      roll: 'GM-ONLY-roll: 4/5: it opens on the wings. 6: and on the stairs to the dressing rooms.', states: ['shut', 'open'], tags: ['escape', 'cover'] }),
    T('A grand piano', { line: 'its lid propped open.', look: 'GM-ONLY-look: sheet music with a name pencilled in the margin.', tags: ['talk', 'clue'] })]);
  assert.deepEqual(RT.parse(mdOf('Showroom')).map((t) => t.slug), ['brass-umbrella-stand', 'velvet-rope', 'stage-curtain', 'grand-piano']);
});

test('the fixture: Look:/Roll:/Danger: words in place of the marks, a blank line between items, tags capped at 3 known ones', () => {
  assert.deepEqual(RT.parse(mdOf('Security control room')), [
    T('A bank of monitors', { line: 'one of them dark.', look: 'GM-ONLY-look: the dark one shows the back stairs when it is thumped.',
      roll: 'GM-ONLY-roll: 4/5: the guard\'s rounds. 6: and when the next one starts.', danger: 'GM-ONLY-danger: the guard\'s chair still turns.',
      states: ['on', 'off'], tags: ['clue', 'tool'] }),
    T('A key cabinet', { look: 'GM-ONLY-look: one hook is empty and labelled VAULT.', tags: ['door', 'loot', 'clue'] })]);
  assert.deepEqual(RT.parse(mdOf('Pelican cloakroom')), [T('A rail of coats', { line: 'every one with a ticket.', look: 'GM-ONLY-look: one ticket number is written twice.', tags: ['costume', 'clue'] })]);
});

test('RK08.2 the old one-line Find gives things with a name only; a Find with a list under it reads as a Things list', () => {
  assert.deepEqual(RT.parse(mdOf('Cocktail lounge')), [T('a cocktail shaker'), T('a lipstick on a glass'), T('the bar tab')]);
  assert.deepEqual(RT.parse(mdOf('Underground counting room')), [T('A cash drawer', { line: 'left ajar.', look: 'GM-ONLY-look: the float is short by exactly one note.' }), T('A ledger', { line: 'open at today' })]);
  assert.deepEqual(RT.parse('- **Find:** a ticket ; a bent key | a lipstick • a fan'), [T('a ticket'), T('a bent key'), T('a lipstick'), T('a fan')], 'split on · ; | •');
  assert.deepEqual(RT.parse('* __find__: one thing, with a comma'), [T('one thing, with a comma')], 'a comma is part of a name; __ and any case');
  assert.deepEqual(RT.parse('- **Find:** a key\n  - a nested line under a one-line Find\n- **Find:** a second Find'), [T('a key')], 'the first Find wins; a one-line Find takes no nested lines');
  const both = '- **Find:** a key · a coin\n- **Things:**\n  1. **A lamp**\n';
  assert.deepEqual(RT.parse(both), [T('A lamp')], 'a Things block wins over a Find');
  assert.equal(RT.read(both).md, '- **Find:** a key · a coin', 'and only the Things block leaves the md');
  assert.deepEqual(RT.parse('- **Things:**\n- **Find:** a coin'), [T('a coin')], 'an empty Things block falls back to the Find');
});

test('fences: lines inside ``` / ~~~ are never read (the penthouse\'s fenced Things is skipped, the real one is read, names after "Things:" count)', () => {
  assert.deepEqual(RT.parse(mdOf('Luxury penthouse')), [T('a telescope'), T('a silver tray'),
    T('A drinks trolley', { line: 'rattling.', danger: 'GM-ONLY-danger: the bottles fall if it is pushed fast.', tags: ['weapon', 'hazard'] })]);
  assert.deepEqual(RT.parse('```\n- **Things:**\n  1. **A lamp**\n```'), [], 'a block wholly in a fence is nothing');
  assert.deepEqual(RT.parse('- **Things:**\n  1. **A lamp**\n     ```\n     - Tags: clue\n     ```\n     - Tags: tool'), [T('A lamp', { tags: ['tool'] })], 'a fence inside an item is not read');
});

test('read(md): the md without the block the things came from; a note with neither block keeps its md exactly (the same string)', () => {
  assert.equal(RT.read(mdOf('Showroom')).md, 'The big hall, under the chandeliers.\n- **Who:** Mabel Quist\n- **Costume:** Evening dress and white gloves\n- If it goes wrong: the band stops mid-bar\n\n> [!quote] SAY\n> Chandeliers glitter over a long stage.');
  assert.equal(RT.read(mdOf('Cocktail lounge')).md, 'Low lights and a long mirror.\n- **Costume:** A waiter\'s white jacket', 'the one-line Find goes');
  assert.equal(RT.read(mdOf('Underground counting room')).md, '- **Costume:** Staff overalls', 'the nested Find goes whole');
  assert.equal(RT.read(mdOf('Luxury penthouse')).md, '~~~\n- **Things:**\n  1. **Not this one either**\n~~~\n- **Costume:** Nothing works up here', 'the fence stays');
  const plainRoom = mdOf('Private card rooms');
  assert.deepEqual(RT.parse(plainRoom), []); const r = RT.read(plainRoom);
  assert.equal(r.md, plainRoom); assert.deepEqual(r.things, []);
  /* the costume and SAY room-notes reads are not changed by a Things block beside them */
  assert.equal(FOUND.byRoom.Showroom.costume, 'Evening dress and white gloves'); assert.deepEqual(FOUND.byRoom.Showroom.say, ['Chandeliers glitter over a long stage.']);
  assert.deepEqual(Object.keys(FOUND.byRoom.Showroom).sort(), ['costume', 'md', 'note', 'say'], 'room-notes hands back no things');
});

test('the limits hold: name 40, line 80, look 120, roll 160, danger 100 (no half surrogate at a cut); states 4 of 24; tags 3 known; 10 things; no repeats', () => {
  const x = (c, n) => c.repeat(n);
  const long = ['- **Things:**', '  1. **' + x('N', 60) + '**, ' + x('l', 120), '     - 🔍 ' + x('o', 200), '     - 🎲 ' + x('r', 200), '     - ! ' + x('d', 200),
    '     - State: ' + ['one', x('s', 30), 'three', 'four', 'five'].join(' · '), '     - Tags: clue, Weapon, nonsense, loot, tool, door'].join('\n');
  const [t] = RT.parse(long);
  assert.deepEqual([t.name.length, t.line.length, t.look.length, t.roll.length, t.danger.length], [40, 80, 120, 160, 100]);
  assert.deepEqual(t.states, ['one', x('s', 24), 'three', 'four']); assert.deepEqual(t.tags, ['clue', 'weapon', 'loot']);
  const [e] = RT.parse('- **Things:**\n  1. **A' + '\u{1F600}'.repeat(30) + '**');
  assert.equal(e.name.length, 39); assert.equal(/[\ud800-\udbff]$/.test(e.name), false, 'no half of a pair at the cut');
  const twelve = ['- **Things:**'].concat(Array.from({ length: 12 }, (_, i) => '  ' + (i + 1) + '. **A thing ' + (i + 1) + '**')).join('\n');
  assert.equal(RT.parse(twelve).length, 10, 'at most ten');
  assert.deepEqual(RT.parse('- **Things:**\n  1. **A broom**\n  2. **The broom!**\n  3. **A mop**').map((t) => t.name), ['A broom', 'A mop'], 'the same slug twice: the first wins');
  assert.deepEqual(RT.parse('- **Things:**\n  1. A loose plank, by the door\n  2. A coin — bent'), [T('A loose plank', { line: 'by the door' }), T('A coin', { line: 'bent' })], 'no bold: the name runs to the first comma or dash');
  assert.deepEqual(RT.parse('- **Things:**\n  1. **A [[Lamp|lamp]]**, `lit`\n     and still warm\n     - 🔍 **under** it, a\n       folded note'), [T('A lamp', { line: 'lit and still warm', look: 'under it, a folded note' })], 'Markdown made plain; wrapped lines join');
});

test('slug: a-z0-9 words joined by "-", a leading a/an/the/some dropped, accents folded, <= 40; a name with no such letters gets a hash', () => {
  assert.equal(RT.slug('A brass umbrella stand'), 'brass-umbrella-stand');
  assert.equal(RT.slug('The Brass  Umbrella-Stand!'), 'brass-umbrella-stand', 'an article or punctuation never changes the key');
  assert.equal(RT.slug('Some candles'), 'candles'); assert.equal(RT.slug('An oil lamp'), 'oil-lamp'); assert.equal(RT.slug('Anchor'), 'anchor');
  assert.equal(RT.slug('Étagère à café'), 'etagere-a-cafe');
  assert.equal(RT.slug('x'.repeat(39) + ' yz'), 'x'.repeat(39), 'no trailing dash at the cut');
  const h = RT.slug('金庫'); assert.match(h, /^x[0-9a-f]{8}$/); assert.equal(RT.slug('金庫'), h, 'stable'); assert.notEqual(RT.slug('金'), h);
  for (const v of [null, undefined, '', '   ']) assert.equal(RT.slug(v), '', String(v));
  for (const room of ROOMS) for (const th of RT.parse(mdOf(room))) assert.match(th.slug, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
});

test('clean(thing): a table\'s thing (the rooms-pack fixture) passes through as it is, plus its slug; malformed is null', () => {
  const pack = JSON.parse(fs.readFileSync(path.join(FX, 'rooms-pack.json'), 'utf8'));
  let n = 0;
  for (const room of Object.values(pack.T.rooms)) for (const th of room.things) { assert.deepEqual(RT.clean(th), Object.assign({}, th, { slug: RT.slug(th.name) }), th.name); n++; }
  assert.equal(n, 20);
  for (const bad of [null, 5, 'x', [], {}, { name: '' }, { name: '  ' }, { line: 'no name' }]) assert.equal(RT.clean(bad), null, JSON.stringify(bad));
  assert.deepEqual(RT.clean({ name: 'A tin', states: 'Open, shut', tags: 'clue weird bogus' }), T('A tin', { states: ['open', 'shut'], tags: ['clue', 'weird'] }));
});

test('every old room note parses to nothing and keeps its md: the demo night\'s six rooms, and the room-notes shapes (Costume, Who, SAY, If it goes wrong)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'demo-night.mjs'), 'utf8');
  const lit = /const ROOM_NOTES = (\{[\s\S]*?\n\});/.exec(src); assert.ok(lit, 'the demo night\'s ROOM_NOTES');
  const NOTES = vm.runInNewContext('(' + lit[1] + ')');
  assert.equal(Object.keys(NOTES).length, 6);
  assert.ok(src.includes("'- **Costume:** ' + n.costume, '- **Who:** ' + n.who, '- If it goes wrong: ' + n.wrong, '', '> [!quote] SAY', '> ' + n.say"), 'the demo night still writes its rooms in this shape (else update this test)');
  for (const [room, n] of Object.entries(NOTES)) {
    const md = ['- **Costume:** ' + n.costume, '- **Who:** ' + n.who, '- If it goes wrong: ' + n.wrong, '', '> [!quote] SAY', '> ' + n.say].join('\n');
    assert.deepEqual(RT.parse(md), [], room); assert.equal(RT.read(md).md, md, room);
  }
  for (const md of ['The big hall, see [[Pelican floor plan|the plan]].\n- **Costume:** Evening dress\n> [!quote] SAY\n> Chandeliers.', 'Low lights.', '',
    '- **When:** 21:30\n- **Exits:** the back stairs\n- If it goes wrong\n  - the band stops\n  - Lotte checks her list', '- **Things to do:** nothing parsed', '- Things: no bold, no block', '**Things:** no bullet, no block\n1. **A lamp**'])
    assert.deepEqual(RT.read(md), { things: [], md }, JSON.stringify(md));
  for (const bad of [null, undefined, 5, {}, [], true]) { assert.deepEqual(RT.parse(bad), []); assert.doesNotThrow(() => RT.read(bad)); }
});

test('room-notes.js is unchanged by this build (room/main\'s base 0ac15a50), so every existing room-notes fixture reads as before', () => {
  const g = spawnSync('git', ['diff', '--quiet', '0ac15a50', '--', 'app/gm/room-notes.js'], { cwd: ROOT });
  if (g.error || (g.status !== 0 && g.status !== 1)) { console.log('  (skipped: git cannot compare with 0ac15a50)'); return; }
  assert.equal(g.status, 0, 'app/gm/room-notes.js differs from 0ac15a50');
});

test('RK08.3 things stay GM-side: only the room-key bundle loads the two files, and no player, phone, display or server path names them', () => {
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'app', 'routes.js'), 'utf8'), win, { filename: 'routes.js' });
  const B = win.B68Load.BUNDLES, homes = (f) => Object.keys(B).filter((n) => B[n].includes(f));
  assert.deepEqual(homes('gm/room-things.js'), ['room-key']); assert.deepEqual(homes('gm/room-state.js'), ['room-key']);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const files = walk(path.join(ROOT, 'app')).concat(walk(path.join(ROOT, 'functions'))).filter((f) => /\.(js|mjs|html)$/.test(f)).map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
  const hits = files.filter((f) => /B68GmRoomThings|B68GmRoomState|room-things|room-state|roomstate/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepEqual(hits.filter((f) => !/^app\/gm\/room-[a-z]+\.js$/.test(f)).sort(), ['app/gm-page.js', 'app/routes.js'], 'only the room key files, routes.js and gm-page.js name them');
  const page = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8').split('\n').filter((l) => /B68GmRoomState|B68GmRoomThings|roomstate|rsInst/.test(l));
  assert.equal(page.length, 3, 'gm-page.js: the rsInst comment and line, and the check hook (' + page.length + ')');
  assert.ok(page.every((l) => !/missionFor|missionSource|playerView|ballDoc|pushDisplay|playerSummary/.test(l)), 'none of them feeds a player path');
  const ball = fs.readFileSync(path.join(ROOT, 'app', 'gm', 'ball.js'), 'utf8');
  assert.ok(!/\bThings\b|room-things|roomstate/.test(ball), 'missionFor (ball.js) never reads things');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
