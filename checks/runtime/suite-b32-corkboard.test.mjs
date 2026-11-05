// Suite B32, ticket 2.7 (switch map.corkboard; no browser, no network): the intel corkboard. Intel Polaroids on their rooms, mugshots of revealed people on their
// posts, the print page, the controller against a fake host, and the real kit board drawn through the page's player door.
// INVENTED data only (the Pelican Rooms cast); GM-ONLY- markers for anything that must never reach the board.
//   node checks/runtime/suite-b32-corkboard.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sites } from './fixtures/gm/map-kit1-cases.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const CB = require(path.join(ROOT, 'app', 'gm', 'corkboard.js'));
const F = require(path.join(ROOT, 'app', 'features.js'));
const K = require(path.join(ROOT, 'app', 'maps', 'map-kit.js'));
const P = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
const ROLL = sites().pelicanK1;
const ROOMS = ROLL.rooms.map((r) => r.name);
const PUB = ROLL.rooms.find((r) => r.band === 'public').name, SECURE = ROLL.rooms.find((r) => r.band === 'secure').name;

const PLAY = {
  intel: [
    { id: 'i1', text: 'The porter takes his tea at nine.', room: PUB },
    { id: 'i2', text: 'A rear door sticks <badly>.', reveals: { ways: ['w1'] } },
    { id: 'i3', text: 'Nobody has been told this one.', room: PUB },
    { id: 'i4', text: 'The strongbox hums at night. GM-ONLY-secure-fact', room: SECURE },
    { id: 'i5', text: 'A rumour with no room.' },
    { id: 'i6', text: 'A cellar log.', reveals: { events: ['e1'] } }
  ],
  ways: [{ id: 'w1', room: PUB }],
  events: [{ id: 'e1', room: SECURE }],
  people: [
    { id: 'p1', label: 'Mara Quill', stops: [{ at: '20:00', room: PUB }] },
    { id: 'p2', label: 'Hidden Person', npc: 'c', stops: [{ at: '20:00', room: PUB }] },
    { id: 'p3', label: 'Odo Bell', stops: [{ at: '20:00', gone: true }, { at: '21:00', room: SECURE }] }
  ]
};
const TOLD = { i1: 'crew', i2: ['pc1'], i4: 'crew', i5: 'crew', i6: [] };
const NPCS = {
  a: { name: 'Mara Quill', alias: 'The Clerk', revealed: true },
  b: { name: 'Pip Marlow', revealed: true, post: PUB },
  c: { name: 'Hidden Person', alias: 'GM-ONLY-alias', revealed: false, post: PUB },
  d: { name: 'Odo Bell', revealed: true }
};

await test('switch: GM-only, off by default, bland text', () => {
  const s = F.get('map.corkboard'); assert.ok(s); assert.equal(s.surface, 'gm'); assert.equal(s.default, false);
  assert.equal(F.valueOf({}, 'map.corkboard'), true); assert.ok(!F.publicIds().includes('map.corkboard'));
});

await test('intelOf: told facts only, room from its own field or the way or event it reveals, unpinned ones kept', () => {
  const r = CB.intelOf(PLAY, TOLD, ROOMS);
  assert.deepEqual(r.map((x) => x.id), ['i1', 'i2', 'i4', 'i5']);
  assert.deepEqual(r.map((x) => x.room), [PUB, PUB, SECURE, null]);
  assert.deepEqual(CB.intelOf(PLAY, {}, ROOMS), []);
  assert.deepEqual(CB.intelOf(null, TOLD, ROOMS), []);
  assert.equal(CB.intelOf({ intel: [{ id: 'x', text: 't', room: 'No Such Room' }] }, { x: 'crew' }, ROOMS)[0].room, null);
});

await test('postsOf: revealed people only; own post, else the play person by name or alias or npc id', () => {
  const r = CB.postsOf(NPCS, PLAY, ROOMS);
  assert.deepEqual(r.map((x) => [x.id, x.room]), [['a', PUB], ['d', SECURE], ['b', PUB]].sort((p, q) => NPCS[p[0]].name.localeCompare(NPCS[q[0]].name)));
  assert.ok(!JSON.stringify(r).includes('Hidden'));
  assert.deepEqual(CB.postsOf(null, PLAY, ROOMS), []);
});

await test('hideOf: names and aliases of everyone not revealed', () => {
  assert.deepEqual(CB.hideOf(NPCS), ['Hidden Person', 'GM-ONLY-alias']);
});

await test('polaroidSvg and mugshotSvg: escaped, on the kit frame, a plate when there is no portrait', () => {
  const p = CB.polaroidSvg('A rear door sticks <badly> & "hard"');
  assert.ok(p.startsWith('<svg') && p.includes('viewBox="0 0 540 600"') && p.includes('&lt;badly&gt;') && !p.includes('<badly>'));
  assert.ok(CB.polaroidSvg('x '.repeat(400)).split('<text').length <= 12);
  assert.ok(CB.mugshotSvg('Mara Quill', '').includes('>MQ<'));
  assert.equal(CB.mugshotSvg('Mara Quill', '<svg id="fig"></svg>'), '<svg id="fig"></svg>');
  assert.ok(!CB.mugshotSvg('<b>', 'not svg').includes('<b>'));
});

await test('tokensOf: exactly { room, label, svg } each (the page token screen shape)', () => {
  const t = CB.tokensOf({ intel: CB.intelOf(PLAY, TOLD, ROOMS), posts: CB.postsOf(NPCS, PLAY, ROOMS) }, () => '');
  assert.equal(t.length, 3 + 3);   // three mugshots, three pinned facts (the unpinned one has no token)
  t.forEach((x) => assert.equal(Object.keys(x).sort().join(), 'label,room,svg'));
});

await test('corkboardHtml: A4 or A3 landscape, the board, the unpinned facts, escaped', () => {
  const a4 = CB.corkboardHtml({ title: 'The <Pelican> Rooms', caption: 'surveyed', svg: '<svg id="b"></svg>', loose: ['A rumour <x>'] }, 'A4');
  assert.ok(a4.includes('size:A4 landscape') && a4.includes('width:297mm;height:210mm') && a4.includes('<svg id="b">') && a4.includes('Also known') && a4.includes('A rumour &lt;x&gt;'));
  assert.ok(a4.includes('The &lt;Pelican&gt; Rooms') && !a4.includes('<Pelican>'));
  const a3 = CB.corkboardHtml({ title: 't', caption: 'c', svg: '<svg></svg>', loose: [] }, 'A3');
  assert.ok(a3.includes('size:A3 landscape') && !a3.includes('Also known'));
  assert.ok(CB.corkboardHtml({}, 'A9').includes('A4 landscape'));
});

function hostFor(over) {
  const printed = [], toasts = [];
  const host = Object.assign({
    on: () => true, roll: () => ROLL, play: () => PLAY, told: () => TOLD, npcs: () => NPCS, phase: () => 'plan', portrait: () => '', toast: (m, bad) => toasts.push([m, bad]),
    print: (html) => { printed.push(html); return true; },
    board: (tokens) => ({ title: 'T', caption: 'C', svg: '<svg id="board"></svg>', tokens: tokens.length, tokensRefused: false })
  }, over || {});
  return { host, printed, toasts };
}

await test('controller: build hands the board the tokens and the hidden names; print uses the print door', () => {
  const { host, printed } = hostFor(); let seen = null; host.board = (t, h) => { seen = { t, h }; return { title: 'T', caption: 'C', svg: '<svg id="board"></svg>' }; };
  const c = CB.make(host), b = c.build();
  assert.equal(b.model.intel.length, 4); assert.equal(b.model.loose.length, 1);
  assert.deepEqual(seen.h, ['Hidden Person', 'GM-ONLY-alias']); assert.ok(!JSON.stringify(seen.t).includes('Hidden Person'));
  assert.equal(c.print('A3'), true); assert.ok(printed[0].includes('A3 landscape') && printed[0].includes('A rumour with no room.'));
});

await test('controller: nothing to draw says so; a board that throws is a toast, not a print', () => {
  let h = hostFor({ roll: () => null }); assert.equal(CB.make(h.host).print('A4'), false); assert.ok(h.toasts[0][1] === true && h.printed.length === 0);
  h = hostFor({ board: () => { throw new Error('This view would name a hidden room'); } }); assert.equal(CB.make(h.host).print('A4'), false);
  assert.equal(h.toasts[0][0], 'This view would name a hidden room'); assert.equal(h.printed.length, 0);
});

await test('controller: render with a fake box; off switch and a wrong phase', () => {
  const box = { innerHTML: '', parentNode: null };
  CB.make(hostFor().host).render(box); assert.ok(box.innerHTML.includes('Print A4') && box.innerHTML.includes('id="board"') && box.innerHTML.includes('Also known') && !box.innerHTML.includes('not in Planning'));
  CB.make(hostFor({ phase: () => 'score' }).host).render(box); assert.ok(box.innerHTML.includes('not in Planning'));
  CB.make(hostFor({ on: () => false }).host).render(box); assert.ok(box.innerHTML.includes('switch is off'));
});

// the real thing: the kit's heist board through the page's one player door
const reveal = { public: true, working: true, controlled: false, secure: false };
const mapFor = (over) => Object.assign({}, P.MAP0, { layer: 'player', view: 'plan', theme: 'board', reveal }, over);
function board(npcs, play, told) {
  const intel = CB.intelOf(play, told, ROOMS), model = { intel, posts: CB.postsOf(npcs, play, ROOMS) };
  return P.playerDisplay(ROLL, mapFor(), K.render, { tokens: CB.tokensOf(model, () => ''), hide: CB.hideOf(npcs) });
}
await test('real board: a revealed room carries its Polaroid and mugshot; a hidden room, hidden NPC and untold fact appear nowhere', () => {
  const d = board(NPCS, PLAY, TOLD);
  assert.ok(d.svg.startsWith('<svg') && d.tokens >= 3 && d.tokensRefused === false, JSON.stringify([d.tokens, d.tokensRefused]));
  assert.ok(d.svg.includes('The porter takes'), 'the intel fact is on the board');
  assert.ok(/mara quill/i.test(d.svg), 'the mugshot is labelled');
  for (const bad of ['GM-ONLY', 'Hidden Person', 'Nobody has been told', 'strongbox hums', SECURE]) assert.ok(!d.svg.includes(bad), 'leaked: ' + bad);
  assert.ok(!d.svg.includes('Odo Bell'), 'a person whose post is in a hidden room is not drawn');
});

await test('real board: a fact that names a hidden room refuses the whole set of pins, and the board still draws', () => {
  const leaky = { intel: [{ id: 'z', text: 'Meet in the ' + SECURE, room: PUB }] };
  const d = board(NPCS, leaky, { z: 'crew' });
  assert.equal(d.tokensRefused, true); assert.equal(d.tokens, 0); assert.ok(!d.svg.includes(SECURE));
});

await test('real board: a told fact that names a hidden person refuses the pins', () => {
  const play = { intel: [{ id: 'z', text: 'Hidden Person was seen.', room: PUB }] };
  assert.equal(board(NPCS, play, { z: 'crew' }).tokensRefused, true);
});

await test('real board: with nothing to pin it is the kit board and nothing more', () => {
  const d = board({}, { intel: [] }, {});
  assert.equal(d.tokens, 0); assert.equal(d.tokensRefused, false);
});

await test('loose facts are screened: a line naming a hidden room or person is dropped from the sheet and the print', () => {
  const play = { intel: [{ id: 'l1', text: 'Meet in the ' + SECURE + ' at ten.' }, { id: 'l2', text: 'hidden person is the buyer.' }, { id: 'l3', text: 'A harmless rumour.' }] };
  const told = { l1: 'crew', l2: 'crew', l3: 'crew' };
  const { host, printed } = hostFor({ play: () => play, told: () => told, hiddenNames: () => [SECURE.toLowerCase()] });
  const c = CB.make(host), b = c.build();
  assert.deepEqual(b.model.loose, ['A harmless rumour.']);
  c.print('A4'); assert.ok(printed[0].includes('A harmless rumour.') && !printed[0].includes(SECURE) && !/hidden person/i.test(printed[0]));
  const box = { innerHTML: '', parentNode: null }; c.render(box); assert.ok(!box.innerHTML.includes(SECURE) && !/hidden person/i.test(box.innerHTML));
});

await test('wiring: routes bundle (GM only), Menu hook, the player door, no API', () => {
  const routes = fs.readFileSync(path.join(ROOT, 'app', 'routes.js'), 'utf8');
  const gmLine = routes.split('\n').find((l) => /^\s*gm:\s*\[/.test(l)) || '';
  assert.ok(gmLine.includes("'gm/corkboard.js'") && gmLine.indexOf("'gm/corkboard.js'") < gmLine.indexOf("'gm-page.js'"));
  assert.equal((routes.match(/corkboard/g) || []).length, 1, 'only the GM bundle names it');
  const g = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  assert.ok(g.includes("case 'corkboard':") && g.includes("reg('corkboard', cbInst)") && g.includes("theme: 'board' }), W.B68Map && W.B68Map.render"));
  assert.ok(!/anthropic/i.test(fs.readFileSync(path.join(ROOT, 'app', 'gm', 'corkboard.js'), 'utf8')));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
