// The room notes (app/gm/room-notes.js, ticket A1): a prep part's one "## Rooms" section, one "### <room>" per room, read into the lines a
// phone card may show (the costume line and the SAY lines; the md stays GM-side). INVENTED venue: the section 5 fixture's Pelican Rooms, in
// hand-built prep parts. normRoom, find (source, missing, extra, md, costume, say, fences, split blocks, malformed input) and plain.
//   node checks/runtime/room-notes.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const req = createRequire(import.meta.url);
const RN = req(path.join(ROOT, 'app', 'gm', 'room-notes.js'));
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'pelican-play-v2.json'), 'utf8'));
const ROOMS = FX.zones.flatMap((z) => z.rooms);
const EMPTY = { byRoom: {}, missing: ROOMS.slice(), extra: [], source: null };   // no Rooms section: nothing found, every room missing
const note = (id, ...srcs) => ({ id, rel: 'prep/' + id + '.md', title: id, blocks: srcs.map((src) => ({ k: 'md', src })) });
const one = (src, names) => RN.find({ notes: [note('n1', src)] }, names || ROOMS);

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

/* the part: a note with H3s but no Rooms, a Rooms inside a fence, the source, and a later Rooms note that is never read */
const RM = ['# The Pelican Rooms', 'Prep for the gala.',
  '## Rooms \u00b7 Gala',
  '### Showroom',
  'The big hall, see [[Pelican floor plan|the plan]].',
  '- **Costume:** Evening dress from [[Wardrobe|the wardrobe]] and **white gloves**',
  '- **Costume:** A second costume line',
  '> [!quote] SAY', '> Chandeliers glitter', '> over a **long** stage.', '',
  '> [!quote] say', '> A string quartet tunes up.', '',
  '> [!quote] Someone', '> Not a line to say.',
  '### The Cocktail lounge!', 'Low lights.',
  '### Kitchen', 'Not a room of the site.',
  '### Showroom', '- **Costume:** A later Showroom section',
  '## Elsewhere',
  '### Luxury penthouse', 'After the next H2: not a room.'];
const PART = { notes: [
  note('n-intro', '# Intro\n### Showroom\n- **Costume:** Not under a Rooms heading'),
  note('n-code', '```\n## Rooms\n### Showroom\n- **Costume:** Inside a fence\n```'),
  note('n-rooms', RM.join('\n')),
  note('n-late', '## Rooms\n### Security control room\n- **Costume:** From a later note'),
] };

test('the fixture\'s rooms are the six this file reads', () => {
  assert.deepEqual(ROOMS, ['Showroom', 'Cocktail lounge', 'Underground counting room', 'Security control room', 'Private card rooms', 'Luxury penthouse']);
});

test('normRoom: NFKC, lower case, a leading "the " dropped, punctuation dropped, whitespace collapsed', () => {
  assert.equal(RN.normRoom('The Showroom!'), 'showroom');
  assert.equal(RN.normRoom('  THE   Cocktail\tlounge \n'), 'cocktail lounge');
  assert.equal(RN.normRoom('the cocktail lounge'), 'cocktail lounge');
  assert.equal(RN.normRoom('Theatre'), 'theatre', 'only "the" as a word');
  assert.equal(RN.normRoom('Private card-rooms.'), 'private cardrooms', 'punctuation is dropped, not spaced');
  assert.equal(RN.normRoom('Security control room (back)'), 'security control room back');
  assert.equal(RN.normRoom('\uFF33\uFF48\uFF4F\uFF57\uFF52\uFF4F\uFF4F\uFF4D'), 'showroom', 'NFKC: fullwidth letters');
  assert.equal(RN.normRoom('\uFF34\uFF48\uFF45\u3000\uFF33\uFF48\uFF4F\uFF57\uFF52\uFF4F\uFF4F\uFF4D'), 'showroom', 'NFKC: a fullwidth "The" and an ideographic space');
  assert.equal(RN.normRoom('Luxury\u00a0penthouse'), 'luxury penthouse');
  ROOMS.forEach((r) => assert.equal(RN.normRoom('The ' + r.toUpperCase() + '!'), RN.normRoom(r), r));
  for (const v of [null, undefined, '', '   ', '!!!']) assert.equal(RN.normRoom(v), '', String(v));
  assert.equal(RN.normRoom(5), '5');
});

test('find: the first note with a "## Rooms" H2 is the source (a note with H3s but no Rooms, and a Rooms in a fence, are passed over); its H3s up to the next H2 are the rooms', () => {
  const r = RN.find(PART, ROOMS);
  assert.equal(r.source, 'n-rooms');
  assert.deepEqual(Object.keys(r.byRoom), ['Showroom', 'Cocktail lounge']);
  assert.deepEqual(r.missing, ['Underground counting room', 'Security control room', 'Private card rooms', 'Luxury penthouse'], 'in roomNames order; the H3 after the next H2 is no room, and the later note is never read');
  assert.deepEqual(r.extra, ['Kitchen'], 'a heading no room matches; the second Showroom section is not extra');
  const show = r.byRoom.Showroom;
  assert.equal(show.note, 'n-rooms');
  assert.equal(show.md, RM.slice(RM.indexOf('### Showroom') + 1, RM.indexOf('### The Cocktail lounge!')).join('\n'));
  assert.ok(!show.md.includes('### Showroom') && !show.md.includes('A later Showroom section'), 'the heading is left out, and the first section for a room wins');
  assert.equal(show.costume, 'Evening dress from the wardrobe and white gloves');
  assert.deepEqual(show.say, ['Chandeliers glitter over a long stage.', 'A string quartet tunes up.']);
  assert.deepEqual(r.byRoom['Cocktail lounge'], { note: 'n-rooms', md: 'Low lights.', costume: null, say: [] }, '"The Cocktail lounge!" is the lounge');
  /* roomNames order and spelling are kept */
  assert.deepEqual(RN.find(PART, ROOMS.slice().reverse()).missing, ['Luxury penthouse', 'Private card rooms', 'Security control room', 'Underground counting room']);
  const as = RN.find(PART, ['the showroom', 'COCKTAIL LOUNGE', 'Showroom']);
  assert.deepEqual(Object.keys(as.byRoom), ['the showroom', 'Showroom', 'COCKTAIL LOUNGE']); assert.deepEqual(as.missing, []);
  assert.equal(as.byRoom['the showroom'].costume, as.byRoom.Showroom.costume);
  /* the source is the first such note even when it matches nothing */
  const none = RN.find(PART, ['Nowhere']);
  assert.equal(none.source, 'n-rooms'); assert.deepEqual(none.byRoom, {}); assert.deepEqual(none.missing, ['Nowhere']);
  assert.deepEqual(none.extra, ['Showroom', 'The Cocktail lounge!', 'Kitchen', 'Showroom']);
  assert.notEqual(RN.find(PART, ROOMS).byRoom, r.byRoom, 'a new result each call');
});

test('find: "## Rooms" in any case, "Rooms \u00b7 …", "Rooms - …", closing #s, up to three spaces; other headings are not the section; it ends at the next H1 too', () => {
  for (const h of ['## Rooms', '## ROOMS', '## rooms', '## Rooms \u00b7 Gala', '## Rooms - upstairs', '## Rooms ##', '   ## Rooms', '## The rooms', '## The Rooms · Gala']) {
    const r = one(h + '\n### Showroom\n- **Costume:** Brocade');
    assert.equal(r.source, 'n1', h); assert.equal(r.byRoom.Showroom.costume, 'Brocade', h);
  }
  for (const h of ['## Roomservice', '### Rooms', '# Rooms', '##Rooms', '    ## Rooms', '## Room', 'Rooms', '## Our rooms', '## The rooms and props', '## Rooms and props', '## Rooms of the house', '## Roomsmith']) assert.deepEqual(one(h + '\n### Showroom\n- **Costume:** Brocade'), EMPTY, h);
  const r = one('## Rooms\n### Showroom\nIn.\n# Appendix\n### Cocktail lounge\nOut.');
  assert.deepEqual(Object.keys(r.byRoom), ['Showroom']); assert.equal(r.byRoom.Showroom.md, 'In.');
});

test('find: the costume is the plain text of the first "- **Costume:**" bullet (also **Costume**: and __), links, bold, code and HTML stripped, <= 160 characters, no half surrogate; an empty one is null and ends the search', () => {
  const r = one(['## Rooms',
    '### Showroom', '- **Costume:** ' + 'x'.repeat(200),
    '### Cocktail lounge', '* __Costume__: An [apron](https://example.invalid/apron) and `a tray`',
    '### Private card rooms', '- **Costume:**   ', '- **Costume:** Not this one either',
    '### Security control room', 'Text first.', '+ **costume**: Grey <b>uniform</b> with [[Badges|a badge]]',
    '### Luxury penthouse', '- **Costume:** a' + '\u{1F600}'.repeat(100),
    '### Underground counting room', 'Costume: not a bullet', '**Costume:** not a bullet either', '- Costume: no bold'].join('\n'));
  assert.deepEqual(r.missing, []);
  assert.equal(r.byRoom.Showroom.costume, 'x'.repeat(160));
  assert.equal(r.byRoom['Cocktail lounge'].costume, 'An apron and a tray');
  assert.equal(r.byRoom['Private card rooms'].costume, null, 'an empty bullet is null, and the next one is not read');
  assert.equal(r.byRoom['Security control room'].costume, 'Grey uniform with a badge');
  const lux = r.byRoom['Luxury penthouse'].costume;
  assert.equal(lux.length, 159); assert.equal(/[\ud800-\udbff]$/.test(lux), false, 'no half of a pair at the cut');
  assert.equal(r.byRoom['Underground counting room'].costume, null, 'not a bullet, not a costume');
});

test('find: "> [!quote] SAY" callouts: bodies joined, plain, at most 3, <= 300 characters, SAY in any case; another callout title or type is ignored', () => {
  const r = one(['## Rooms', '### Showroom',
    '> [!quote] SAY', '',
    '> [!quote] SAY', '> one', '',
    '> [!quote]+ Say', '> two', '>', '> still two', '',
    '> [!QUOTE] SAY', '> ' + 'y'.repeat(400), '',
    '> [!quote] SAY', '> four',
    '### Cocktail lounge',
    '> [!quote] Someone', '> Not ours.', '',
    '> [!note] SAY', '> Not a quote.', '',
    '> [!quote] SAY: extra', '> Not just SAY.', '',
    '>[!quote] **SAY**', '> [[Odd|Tight]] **bold** line'].join('\n'));
  assert.deepEqual(r.byRoom.Showroom.say, ['one', 'two still two', 'y'.repeat(300)], 'an empty body is not a line; the fourth is past the cap');
  assert.deepEqual(r.byRoom['Cocktail lounge'].say, ['Tight bold line']);
});

test('find: lines inside ``` / ~~~ fences are never headings, costumes or callouts', () => {
  const r = one(['## Rooms',
    '```', '## Not the end of the section', '```',
    '### Security control room',
    '~~~', '- **Costume:** Not this one', '> [!quote] SAY', '> Not this either', '### Not a heading', '~~~',
    '- **Costume:** Grey uniform', '> [!quote] SAY', '> The monitors hum.',
    '````', '### Showroom', '```', '````'].join('\n'));
  assert.equal(r.source, 'n1'); assert.deepEqual(Object.keys(r.byRoom), ['Security control room']);
  const sec = r.byRoom['Security control room'];
  assert.equal(sec.costume, 'Grey uniform'); assert.deepEqual(sec.say, ['The monitors hum.']);
  assert.deepEqual(r.extra, [], 'a fenced H3 is no heading'); assert.ok(r.missing.includes('Showroom'));
  assert.ok(sec.md.includes('~~~') && sec.md.includes('### Not a heading'), 'the md keeps the fence as written');
});

test('find: a note\'s blocks are one text: the heading in one block and the body in the next still work; CRLF line ends too', () => {
  const r = RN.find({ notes: [{ id: 'n-split', rel: 'prep/split.md', title: 'Split', blocks: [{ k: 'md', src: 'Intro.\n## Rooms' }, { k: 'embed' }, { k: 'md', src: 7 }, null,
    { k: 'md', src: '### Showroom' }, { k: 'embed', src: '- **Costume:** Split across blocks\n> [!quote] SAY' }, { k: 'md', src: '> From the next block' }] }] }, ROOMS);
  assert.equal(r.source, 'n-split');
  assert.deepEqual(r.byRoom.Showroom, { note: 'n-split', md: '- **Costume:** Split across blocks\n> [!quote] SAY\n> From the next block', costume: 'Split across blocks', say: ['From the next block'] });
  const crlf = one('## Rooms\r\n### Cocktail lounge\r\n- **Costume:** Bar apron\r\n> [!quote] SAY\r\n> Ice rattles.\r\n');
  assert.deepEqual(crlf.byRoom['Cocktail lounge'], { note: 'n1', md: '- **Costume:** Bar apron\n> [!quote] SAY\n> Ice rattles.', costume: 'Bar apron', say: ['Ice rattles.'] });
});

test('find: malformed input is the empty result and never throws (no section: every room missing, source null); bad room names are skipped', () => {
  const bads = [null, undefined, 5, 'notes', [], {}, { notes: 'x' }, { notes: {} }, { notes: null }, { notes: [] },
    { notes: [null, 5, 'x', [], { id: 'q' }, { id: 'r', blocks: 'no' }, { id: 's', blocks: [null, { k: 'md' }, { src: 7 }, 'x', { k: 'md', src: null }] }] }];
  for (const bad of bads) assert.deepEqual(RN.find(bad, ROOMS), EMPTY, String(JSON.stringify(bad)));
  const boom = { notes: [{ id: 't', get blocks() { throw new Error('boom'); } }, note('n-after', '## Rooms\n### Showroom')] };
  assert.doesNotThrow(() => RN.find(boom, ROOMS)); assert.deepEqual(RN.find(boom, ROOMS), EMPTY, 'a part that cannot be read is no section');
  const boom2 = Object.defineProperty({}, 'notes', { enumerable: true, get() { throw new Error('boom'); } });
  assert.deepEqual(RN.find(boom2, ROOMS), EMPTY);
  for (const names of [undefined, null, 'Showroom', 5, {}]) {
    const r = RN.find(PART, names);
    assert.equal(r.source, 'n-rooms'); assert.deepEqual(r.byRoom, {}); assert.deepEqual(r.missing, []);
  }
  const mixed = RN.find(PART, ['Showroom', 5, '   ', null, '', 'Nowhere']);
  assert.deepEqual(Object.keys(mixed.byRoom), ['Showroom']); assert.deepEqual(mixed.missing, ['Nowhere']); assert.deepEqual(mixed.extra, ['The Cocktail lounge!', 'Kitchen']);
});

test('find: a room named constructor, __proto__ or hasOwnProperty is just a key (no prototype is touched)', () => {
  const r = one('## Rooms\n### Constructor\n- **Costume:** Coat A\n### __proto__\n- **Costume:** Coat B\n### hasOwnProperty\nPlain.', ['constructor', '__proto__', 'toString', 'hasOwnProperty']);
  assert.deepEqual(Object.keys(r.byRoom), ['constructor', '__proto__', 'hasOwnProperty']);
  assert.equal(r.byRoom.constructor.costume, 'Coat A');
  assert.equal(Object.getOwnPropertyDescriptor(r.byRoom, '__proto__').value.costume, 'Coat B');
  assert.equal(Object.getPrototypeOf(r.byRoom), Object.prototype); assert.equal(({}).costume, undefined);
  assert.equal(r.byRoom.hasOwnProperty.md, 'Plain.');
  assert.deepEqual(r.missing, ['toString']); assert.deepEqual(r.extra, []);
});

test('plain: Markdown to one line of text', () => {
  assert.equal(RN.plain('[[a|b]] and [[c]] and [t](https://example.invalid) **bold** `code` <i>x</i> <!-- note -->'), 'b and c and t bold code x');
  assert.equal(RN.plain('> [!quote] SAY'), 'SAY');
  assert.equal(RN.plain('Two\n  lines'), 'Two lines');
  assert.equal(RN.plain(null), '');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);

