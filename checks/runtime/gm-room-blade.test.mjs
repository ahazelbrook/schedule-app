// gm-room-blade (RK16 of the room key build, room.tables): app/gm/room-blade.js, the Blade tap that fits one rolled room, its one-line hook in
// RK14's rolled cards and its wiring in the GM page. INVENTED data only: the rooms part of checks/runtime/fixtures/gm/rooms-pack.json (the Pelican bar
// and the Pelican cloakroom; GM-ONLY- markers on every closer look, roll and danger), rolls made up here, and GM-ONLY- markers in every field of the
// fake answers. The page's runtime is a fake (gm.assistRoom): no network, no key, no browser (the browser half is room-tables.e2e.mjs; the server half,
// with the handler's injected fake client, is checks/api/room-seat.mjs).
//   node checks/runtime/gm-room-blade.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/room-blade.js';
const B = require(path.join(ROOT, FILE));
const RR = require(path.join(ROOT, 'app', 'gm', 'room-rolled.js'));
const RL = require(path.join(ROOT, 'app', 'gm', 'room-roll.js'));
const RS = require(path.join(ROOT, 'app', 'gm', 'room-state.js'));
const RT = require(path.join(ROOT, 'app', 'gm', 'room-things.js'));
const Z = require(path.join(ROOT, 'app', 'gm', 'room-zoom.js'));
const PP = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
const SEAT = await import(pathToFileURL(path.join(ROOT, 'functions', '_lib', 'assist', 'room-seat.js')).href);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const T = JSON.parse(read('checks/runtime/fixtures/gm/rooms-pack.json')).T;
const clone = (v) => JSON.parse(JSON.stringify(v));

let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }

const ROLL = { seed: 515151, name: 'The Pelican Rooms', themeName: 'Nightclub', faction: 'The Dovetail Crew', targetRoom: 'Pelican cloakroom', targetWhat: 'a ledger in a coat',
  rooms: [{ name: 'Pelican bar', band: 'public', detail: 'A low bar.' }, { name: 'Pelican cloakroom', band: 'working', detail: 'Coats.', isTarget: true }, { name: 'Zorn quib room', band: 'secure', detail: 'Quib walls.' }],
  skips: [] };
const GOOD = {
  say: 'GM-ONLY-say: the band stops as you come in.',
  things: [
    { name: 'GM-ONLY-name velvet rope', line: 'GM-ONLY-line: it guards a side stair.', look: 'GM-ONLY-look: the hook is loose.', roll: 'GM-ONLY-roll 4/5: it drops.', danger: 'GM-ONLY-danger: the bouncer sees.', states: ['up', 'down'], tags: ['door'] },
    { name: 'GM-ONLY-name ice bucket', line: 'GM-ONLY-line: sweating on the bar.', look: '', roll: '', danger: '', states: [], tags: [] },
  ],
  people: [{ line: 'GM-ONLY-person: a cleaner counting tips', role: 'cleaner' }],
};
const SECRET = /GM-ONLY-(look|roll|danger)/;

/* the page's write path for room-state (gm-page.js applyPatch), a fake runtime and a fake Run pane that keeps its one capture listener */
function rig(o = {}) {
  const r = { doc: {}, toasts: [], redraws: 0, asked: [], on: true, t: Date.parse('2026-11-26T09:00:00.000Z'), listeners: [] };
  r.rs = RS.create({ on: () => r.on, doc: () => r.doc, now: () => (r.t += 1000), part: () => 'p1', busy: () => false, toast: (t) => r.toasts.push(['rs', t]),
    patch: (p) => { r.doc = PP.applyPatch(r.doc, p); return true; } });
  r.answer = o.answer || (() => Promise.resolve({ room: { ...clone(GOOD), at: '2026-11-26T09:00:05.000Z' }, cents: 0.5, spend: { tonight: 0.01 } }));
  r.gm = { assistRoom: (body) => { r.asked.push(body); return r.answer(body); } };
  r.box = { addEventListener: (t, f) => r.listeners.push(f), removeEventListener: (t, f) => { r.listeners = r.listeners.filter((x) => x !== f); }, contains: () => true, querySelectorAll: () => [] };
  r.inst = RR.create({ roll: () => ROLL, rollKey: (x) => x.seed, T: () => T, doc: () => r.doc, rs: () => (o.noWriter ? null : r.rs), redraw: () => { r.redraws++; },
    toast: (t, bad) => r.toasts.push([bad ? 'bad' : 'ok', t]), zoom: (h) => { r.hooks = h; return Z.create(h); }, box: () => r.box, gm: () => (o.noGm ? null : r.gm), tonight: () => ({ onStage: ['Mabel Quist'] }) });
  r.inst.block('Pelican bar');           /* puts the instance's (wrapped) capture listener on the fake pane */
  r.el = (rb, room) => { const el = { disabled: false, getAttribute: (k) => ({ 'data-rb': rb, 'data-rb-room': room })[k] || null, closest: (sel) => (/data-rb|rr-blade/.test(sel) ? el : null) }; return el; };
  r.click = (el) => { const ev = { target: el, stopped: 0, prevented: 0, preventDefault() { this.prevented++; }, stopPropagation() { this.stopped++; } }; r.listeners.forEach((f) => f(ev)); return ev; };
  r.card = (key) => r.inst.model().cards.find((c) => c.roomKey === key);
  r.settle = () => new Promise((res) => setTimeout(res, 0));
  return r;
}

test('gm-room-blade: loads under Node, and as a plain script defines window.B68GmRoomBlade with nothing else loaded', () => {
  assert.equal(B.stub, undefined, 'no longer a stub');
  for (const k of ['hook', 'apply', 'payload', 'check', 'blockHtml']) assert.equal(typeof B[k], 'function', k);
  assert.equal(B.LABEL, 'Fit to tonight (~3¢)'); assert.equal(B.MARK, '✦ Blade'); assert.equal(B.BUSY, 'Fitting…');
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(read(FILE), win, { filename: FILE });
  const M = win.B68GmRoomBlade;
  assert.ok(M && !M.stub && typeof M.hook === 'function');
  assert.equal(M.hook({}, {}), null, 'no instance to wrap: no hook');
  assert.equal(M.blockHtml({ table: true, roomKey: 'x#1' }, {}), '<div class="rr-blade" data-rr-blade="x#1"><p class="rr-bbar"></p></div>', 'no B68Ui on the page yet: no buttons, and no throw');
});

test('the request limits are the server\'s (room-seat.js IN), and the server\'s thing shape is room-things.js\'s', () => {
  for (const k of Object.keys(SEAT.IN)) assert.equal(B.LIMITS[k], SEAT.IN[k], k);
  assert.equal(B.LIMITS.say, SEAT.SAY_MAX); assert.equal(B.LIMITS.bladeThings, SEAT.THINGS_MAX); assert.equal(B.LIMITS.bladePeople, SEAT.PEOPLE_MAX); assert.equal(B.LIMITS.person, SEAT.PERSON_MAX);
  for (const k of ['name', 'line', 'look', 'roll', 'danger', 'state', 'states', 'tags']) assert.equal(SEAT.THING[k], RT.LIMITS[k], 'thing.' + k);
  assert.deepEqual(SEAT.TAGS, RT.TAGS);
});

test('apply(): Blade\'s say replaces the table\'s, its things follow the drawn ones (deduped by slug) and are named in "There\'s ...", its dangers join If it goes wrong', () => {
  const card = RR.model(ROLL, T, { rollKey: ROLL.seed }).cards[0];
  assert.equal(B.apply(card, null), card, 'no Blade entry: the very same card');
  const things = GOOD.things.map((t) => RT.clean(t)).concat([RT.clean({ name: card.things[0].name, line: 'GM-ONLY-dupe' })]);
  const c = B.apply(card, { at: 'x', say: GOOD.say, things, people: GOOD.people }, RL.there);
  assert.equal(c.say, GOOD.say); assert.equal(c.tableSay, card.say, 'the table\'s line is kept for the next tap');
  assert.deepEqual(c.things.map((t) => t.slug), card.things.map((t) => t.slug).concat(things.slice(0, 2).map((t) => t.slug)), 'drawn first, then Blade\'s two; a thing already on the card is not doubled');
  assert.ok(c.things.slice(-2).every((t) => t.blade === true) && card.things.every((t) => !t.blade));
  assert.equal(c.there, RL.there(c.things.map((t) => t.name)));
  assert.deepEqual(c.wrong.slice(-1), [{ name: GOOD.things[0].name, line: GOOD.things[0].danger }]);
  assert.deepEqual(c.blade, { at: 'x', say: true, things: [GOOD.things[0].name, GOOD.things[1].name], people: [{ line: GOOD.people[0].line, role: 'cleaner' }] });
  assert.equal(card.things.length, 4, 'the card it was given is untouched');
  const sayOnly = B.apply(card, { at: 'y', say: '', things: [], people: [{ line: 'GM-ONLY-p' }] }, RL.there);
  assert.equal(sayOnly.say, card.say, 'no Blade say: the table\'s stays'); assert.equal(sayOnly.there, card.there);
});

test('payload(): only what the card shows the GM, cut to the server\'s limits; never a closer look, a roll, a danger line or a Blade thing; the server accepts it', () => {
  const m = RR.model(ROLL, T, { rollKey: ROLL.seed }), card = m.cards[0];
  const p = B.payload(ROLL, card, { onStage: ['Mabel Quist', ' '] });
  assert.deepEqual(Object.keys(p), ['site', 'room', 'tonight']);
  assert.deepEqual(p.site, { name: 'The Pelican Rooms', theme: 'Nightclub', faction: 'The Dovetail Crew' });
  assert.equal(p.room.name, 'Pelican bar'); assert.equal(p.room.band, 'public'); assert.equal(p.room.say, card.say);
  assert.deepEqual(p.room.things, card.things.map((t) => ({ name: t.name, line: t.line })));
  assert.deepEqual(p.room.people, card.people.map((x) => x.role));
  assert.equal(p.tonight.goal, 'The target, Pelican cloakroom: a ledger in a coat'); assert.deepEqual(p.tonight.onStage, ['Mabel Quist']);
  const s = JSON.stringify(p);
  assert.ok(!SECRET.test(s), 'no closer look, roll or danger in the request');
  assert.deepEqual(Object.keys(p.room.things[0]), ['name', 'line'], 'a thing is { name, line }');
  const tail = B.apply(card, { at: 'x', say: GOOD.say, things: GOOD.things.map((t) => RT.clean(t)), people: [] }, RL.there);
  const p2 = B.payload(ROLL, tail, {});
  assert.equal(p2.room.say, card.say, 'a second tap sends the table\'s line, not Blade\'s'); assert.equal(p2.room.things.length, 4, 'and the drawn things only');
  assert.ok(!/GM-ONLY/.test(JSON.stringify(p2)));
  const huge = B.payload({ name: 'N'.repeat(500), themeName: 'T'.repeat(500), faction: 'F'.repeat(500) },
    { name: 'R'.repeat(500), band: 'attic', say: 'S '.repeat(400), things: Array.from({ length: 30 }, () => ({ name: 'n'.repeat(90), line: 'l'.repeat(200) })), people: Array.from({ length: 9 }, () => ({ role: 'r'.repeat(40) })) },
    { goal: 'g'.repeat(900), plan: 'p'.repeat(900), onStage: Array.from({ length: 9 }, () => 'o'.repeat(200)) });
  const c = SEAT.cleanRoomBody(huge);
  assert.ok(!c.error, 'the server takes the largest card the page can send: ' + c.error);
  assert.equal(huge.room.band, '', 'a band that is not one is left out');
  assert.ok(!SEAT.cleanRoomBody(B.payload(ROLL, card, {})).error);
  assert.ok(!SEAT.cleanRoomBody(B.payload({ auth: 'Pelican Annexe', rooms: [] }, { name: 'Pelican bar', things: [], people: [] }, null)).error, 'an authored site');
});

test('check(): a good answer passes; { room: null, error } and anything malformed are an error to toast', () => {
  const ok = B.check({ room: { ...GOOD, at: 'x' }, cents: 1 });
  assert.deepEqual(ok, { room: { say: GOOD.say, things: GOOD.things, people: GOOD.people } });
  const said = 'Blade’s answer did not fit the card (things: at most 2): nothing changed';
  assert.deepEqual(B.check({ room: null, error: said }), { error: said });
  for (const bad of [null, 'x', {}, { room: 'x' }, { room: { ...GOOD, say: 5 } }, { room: { ...GOOD, things: [1, 2, 3] } }, { room: { ...GOOD, things: [{ line: 'no name' }] } },
    { room: { ...GOOD, people: [{ line: 'p'.repeat(121) }] } }, { room: { ...GOOD, people: [1, 2, 3, 4].map(() => ({ line: 'a' })) } }, { room: { ...GOOD, say: 's'.repeat(301) } }]) {
    assert.ok(B.check(bad).error, JSON.stringify(bad).slice(0, 60));
  }
});

test('blockHtml(): "Fit to tonight (~3¢)" on a tabled room only; busy reads "Fitting…" with aria-busy; once fitted the ✦ Blade mark says what changed, its people and Clear', () => {
  const m = RR.model(ROLL, T, { rollKey: ROLL.seed }), card = m.cards[0];
  const h = B.blockHtml(card, {});
  assert.match(h, /^<div class="rr-blade" data-rr-blade="pelican bar#1"><p class="rr-bbar"><button [^>]*class="ui-btn ui-btn--quiet rv-btn sm rr-bbtn"[^>]*>Fit to tonight \(~3¢\)<\/button><\/p><\/div>$/);
  assert.match(h, /data-rb="fit"/); assert.match(h, /data-rb-room="pelican bar#1"/);
  assert.ok(!/✦|Clear/.test(h), 'unfitted: no mark, no Clear');
  assert.equal(B.blockHtml(m.cards[2], {}), '', 'a room with no table: no tap (ruling 6)');
  const busy = B.blockHtml(card, { busy: true, any: true });
  assert.match(busy, /aria-busy="true"/); assert.match(busy, />Fitting…<\/button>/); assert.match(busy, /disabled/);
  assert.match(B.blockHtml(card, { any: true }), /disabled[^>]*>Fit to tonight \(~3¢\)</, 'another room\'s tap is running: this one waits');
  const c = B.apply(card, { at: 'x', say: GOOD.say, things: GOOD.things.map((t) => RT.clean(t)), people: GOOD.people }, RL.there);
  const t = B.blockHtml(c, {});
  assert.match(t, /<p class="rr-bmark"><b class="rr-bstar">✦ Blade<\/b> fitted this room to tonight: the read-aloud, GM-ONLY-name velvet rope, GM-ONLY-name ice bucket and 1 person\.<\/p>/, 'body text, not a dim label (>= 12 px)');
  assert.ok(!/rr-bperson/.test(t), 'Blade\'s people are not in the block: they are in Who\'s here');
  assert.match(t, />Clear<\/button>/); assert.match(t, /data-rb="clear"/);
  assert.ok(!SECRET.test(t), 'the block names things; never their closer look, roll or danger');
  /* Who's here: RK14's slot list with Blade's people in it, each with a ✦; RK17's own list gets Blade's after it */
  const ppl = B.peopleHtml(c, '', false, (x) => x.people.map((p) => '<li data-slot="' + p.id + '"></li>').join(''));
  assert.equal(ppl, '<ul class="rv-who rr-ppl">' + c.people.map((p) => '<li data-slot="' + p.id + '"></li>').join('') +
    '<li class="npc rr-bperson" data-role="cleaner"><b>✦ Cleaner</b> GM-ONLY-person: a cleaner counting tips</li></ul>', 'the slot items are the rolled cards\' own (handed over), never a copy');
  assert.ok(!/rr-slot|quick-draw/.test(read(FILE).replace(/\/\*[\s\S]*?\*\//g, '')), 'room-blade.js holds no copy of the slot markup');
  assert.match(B.peopleHtml(c, '<div>RK17</div>', true), /^<div>RK17<\/div><ul class="rv-who rr-bppl krv-ppl"><li class="npc rr-bperson"/);
  assert.equal(B.peopleHtml(card, '<div>own</div>', false), '<div>own</div>', 'no Blade people: the card\'s own list, untouched');
  const esc = B.peopleHtml({ ...c, blade: { ...c.blade, people: [{ line: '<img src=x onerror=1>', role: '' }] } }, '', false);
  assert.ok(esc.includes('<b>✦</b> &lt;img src=x onerror=1&gt;') && !esc.includes('<img'), 'Blade\'s text is text');
  /* the Things list: a ✦ before each of Blade's own buttons, nothing else changed */
  const listH = Z.listHtml('Pelican bar', c.things, {}), starred = B.starThings(listH, c);
  assert.equal((starred.match(/<span class="rr-bstar"[^>]*>✦<\/span> /g) || []).length, 2);
  assert.equal(starred.replace(/<span class="rr-bstar"[^>]*>✦<\/span> /g, ''), listH, 'the buttons themselves are untouched');
  assert.ok(starred.indexOf('✦') > starred.indexOf('data-thing="' + c.things[3].slug + '"') && starred.indexOf('✦') < starred.indexOf('data-thing="' + c.things[4].slug + '"'), 'the marks sit on Blade\'s two, after the drawn four');
});

test('the tap: the fake runtime\'s answer lands on the card through setBlade, marked ✦ Blade; the request is the card\'s; one at a time', async () => {
  const r = rig();
  assert.equal(r.listeners.length, 1, 'one capture listener: the instance\'s, wrapped');
  const ev = r.click(r.el('fit', 'pelican bar#1'));
  assert.equal(ev.stopped, 1, 'heard first: nothing else sees a Blade button');
  assert.equal(r.asked.length, 1);
  assert.deepEqual(r.asked[0].site, { name: 'The Pelican Rooms', theme: 'Nightclub', faction: 'The Dovetail Crew' });
  assert.deepEqual(r.asked[0].tonight.onStage, ['Mabel Quist']);
  assert.match(r.inst.block('Pelican bar'), /aria-busy="true"[^>]*>Fitting…/, 'busy while it runs');
  assert.match(r.inst.block('Pelican cloakroom'), /disabled[^>]*>Fit to tonight \(~3¢\)/, 'every other Fit waits');
  r.click(r.el('fit', 'pelican cloakroom#1'));
  assert.equal(r.asked.length, 1, 'a second tap while one runs asks nothing');
  await r.settle();
  const stored = r.doc.roomstate.keys['515151'].rooms['pelican bar#1'].blade;
  assert.equal(stored.say, GOOD.say); assert.equal(stored.things.length, 2); assert.deepEqual(stored.people, GOOD.people);
  assert.ok(!('slug' in stored.things[0]), 'stored without slugs, as room-state says');
  const c = r.card('pelican bar#1');
  assert.equal(c.say, GOOD.say); assert.equal(c.things.length, 6); assert.ok(c.blade);
  const blk = r.inst.block('Pelican bar');
  assert.match(blk, /✦ Blade<\/b> fitted this room to tonight: the read-aloud, GM-ONLY-name velvet rope, GM-ONLY-name ice bucket and 1 person\./);
  assert.ok(blk.includes('SAY</span> “GM-ONLY-say: the band stops as you come in. ' + c.there.replace(/'/g, '&#39;')) || blk.includes('SAY</span> “GM-ONLY-say: the band stops as you come in. ' + c.there),
    'Blade\'s read-aloud, then the line naming every thing');
  assert.equal((blk.match(/data-site="thing"/g) || []).length, 6, 'the zoom card\'s list holds Blade\'s things too (keys 5 and 6)');
  assert.equal((blk.match(/class="rr-bstar"[^>]*>✦<\/span>/g) || []).length, 2, 'a ✦ on each of Blade\'s things in the list');
  assert.match(blk, /(Who’s here|Quick-draw people)<\/h4><ul class="rv-who rr-ppl"><li class="npc rr-slot" data-rr-slot="p1"[\s\S]*?<li class="npc rr-bperson" data-role="cleaner"><b>✦ Cleaner<\/b> GM-ONLY-person: a cleaner counting tips<\/li><\/ul>/, 'Blade\'s person in Who\'s here');
  assert.deepEqual(r.toasts.slice(-1), [['ok', '✦ Blade fitted Pelican bar to tonight.']]);
  assert.ok(!r.toasts.some((x) => x[0] === 'bad'));
  assert.ok(r.inst.zoom().html('Pelican bar', { n: 1 }).includes('data-thing="' + RT.slug(GOOD.things[0].name) + '"'), 'a Blade thing opens in the zoom card like any other');
  /* Reroll the room (RK15, through room-state) takes the Blade entry away with the rest */
  assert.equal(r.rs.reroll('515151', 'pelican bar#1'), true);
  const after = r.card('pelican bar#1');
  assert.equal(after.blade, undefined); assert.equal(after.things.length, 4); assert.ok(!/✦/.test(r.inst.block('Pelican bar')));
});

test('Clear takes Blade\'s changes off that room alone (setBlade null)', async () => {
  const r = rig();
  r.click(r.el('fit', 'pelican bar#1')); await r.settle();
  r.click(r.el('fit', 'pelican cloakroom#1')); await r.settle();
  assert.ok(r.card('pelican bar#1').blade && r.card('pelican cloakroom#1').blade);
  r.click(r.el('clear', 'pelican bar#1'));
  assert.equal(r.card('pelican bar#1').blade, undefined); assert.ok(r.card('pelican cloakroom#1').blade, 'the other room keeps its own');
  assert.equal(r.card('pelican bar#1').say, RR.model(ROLL, T, { rollKey: ROLL.seed }).cards[0].say, 'the table\'s read-aloud is back');
});

test('refused: a malformed answer, the server\'s { room: null, error } and a rejection are each a toast, and nothing is stored', async () => {
  const cases = [
    [() => Promise.resolve({ room: { say: 'GM-ONLY-x', things: 'GM-ONLY-not a list', people: [] } }), /did not fit the card: nothing changed/],
    [() => Promise.resolve({ room: null, error: 'Blade’s answer did not fit the card (unknown field: secret): nothing changed', cents: 0.4 }), /unknown field: secret/],
    [() => Promise.reject(Object.assign(new Error('Blade is fitting another room'), { status: 429 })), /could not fit Pelican bar: Blade is fitting another room/],
    [() => Promise.reject(Object.assign(new Error('too long for a 5¢ tap: nothing was asked'), { status: 413 })), /5¢ tap/],
  ];
  for (const [answer, re] of cases) {
    const r = rig({ answer });
    r.click(r.el('fit', 'pelican bar#1')); await r.settle(); await r.settle();
    const bad = r.toasts.filter((x) => x[0] === 'bad');
    assert.equal(bad.length, 1, String(re)); assert.match(bad[0][1], re);
    assert.equal(r.doc.roomstate, undefined, 'nothing stored');
    assert.equal(r.card('pelican bar#1').blade, undefined);
    assert.match(r.inst.block('Pelican bar'), /Fit to tonight \(~3¢\)/, 'and the button is back');
    assert.ok(!/aria-busy="true"/.test(r.inst.block('Pelican bar')));
  }
});

test('no runtime or no writer: a toast and no request; a room with no table and an unknown button do nothing; any other click is the instance\'s own', async () => {
  const a = rig({ noGm: true });
  a.click(a.el('fit', 'pelican bar#1'));
  assert.equal(a.asked.length, 0); assert.match(a.toasts[0][1], /can’t fit rooms on this page/);
  const b = rig({ noWriter: true });
  b.click(b.el('fit', 'pelican bar#1'));
  assert.equal(b.asked.length, 0); assert.match(b.toasts[0][1], /could not be kept here: nothing was asked/);
  const c = rig();
  c.click(c.el('fit', 'zorn quib room#1')); c.click(c.el('fit', 'nowhere#1')); c.click(c.el('steal', 'pelican bar#1'));
  assert.equal(c.asked.length, 0); assert.equal(c.toasts.length, 0);
  const ev = c.click({ getAttribute: () => null, closest: () => null });
  assert.equal(ev.stopped, 0, 'not a Blade button: the instance\'s own handler has it (and it is no thing either, so nothing stops it)');
});

test('torn down mid-tap: destroy() takes the wrapped listener off the pane, and the late answer is dropped, never written (even with the setting still on)', async () => {
  let open; const wait = new Promise((res) => { open = res; });
  const r = rig({ answer: () => wait.then(() => ({ room: clone(GOOD) })) });
  r.click(r.el('fit', 'pelican bar#1'));
  r.inst.destroy();
  assert.equal(r.listeners.length, 0, 'the one listener came off');
  open(); await r.settle(); await r.settle();
  assert.equal(r.on, true, 'room-state would still take a write');
  assert.equal(r.doc.roomstate, undefined, 'nothing stored: the cards were torn down');
  assert.equal(r.toasts.filter((x) => x[0] === 'ok').length, 0, 'and nothing claims it landed');
});

test('rerolled mid-tap: an answer that comes back after its room was rerolled is dropped with a toast, never written into the new draw', async () => {
  let open; const wait = new Promise((res) => { open = res; });
  const r = rig({ answer: () => wait.then(() => ({ room: clone(GOOD) })) });
  r.click(r.el('fit', 'pelican bar#1'));
  assert.equal(r.rs.reroll('515151', 'pelican bar#1'), true, 'Reroll the room while Blade works (RK15, through room-state)');
  open(); await r.settle(); await r.settle();
  const room = r.doc.roomstate.keys['515151'].rooms['pelican bar#1'];
  assert.equal(room.rr, 1); assert.ok(!room.blade, 'no Blade entry in the rerolled room');
  assert.equal(r.card('pelican bar#1').blade, undefined);
  assert.match(r.toasts.filter((x) => x[0] === 'bad').map((x) => x[1]).join('|'), /came after Pelican bar was rerolled: dropped/);
  /* another room's answer is not affected by this room's reroll */
  const s = rig();
  s.click(s.el('fit', 'pelican bar#1'));
  s.rs.reroll('515151', 'pelican cloakroom#1'); await s.settle();
  assert.ok(s.card('pelican bar#1').blade, 'a reroll of another room leaves this answer alone');
});

test('with RK15: a Blade answer, then Swap a thing, then Roll another, then Reroll the room; and an answer arriving after a Reroll from the card is dropped', async () => {
  const SW = require(path.join(ROOT, 'app', 'gm', 'room-swap.js'));
  const r = rig(), KEY = 'pelican bar#1', blade = () => r.card(KEY).blade;
  const act = (what) => { const el = { getAttribute: (k) => ({ 'data-rr-act': what, 'data-rr-room': KEY })[k] || null, closest: (sel) => (/data-rr-act|rr-site|rv-rm/.test(sel) ? el : null) }; return r.click(el); };
  r.click(r.el('fit', KEY)); await r.settle();
  assert.ok(blade() && r.card(KEY).things.length === 6, 'Blade\'s answer is on the card (4 drawn + 2)');
  /* Swap the first drawn thing, through RK15's zoom-card slot */
  r.inst.zoom();
  const c0 = r.card(KEY), ctx = { room: c0.name, rollKey: '515151', roomKey: KEY, thing: c0.things[0], index: 0, count: c0.things.length, state: '', rs: r.rs, page: r.hooks, refresh() {}, close() {}, toast() {} };
  const sb = SW.buttons(ctx)[0];
  assert.ok(sb && sb.label === 'Swap' && !sb.disabled, 'RK15\'s Swap is offered on a drawn thing');
  sb.run(ctx);
  const c1 = r.card(KEY);
  assert.notEqual(c1.things[0].slug, c0.things[0].slug, 'swapped'); assert.ok(c1.blade, 'Blade\'s answer stays through a Swap');
  assert.deepEqual(c1.things.slice(-2).map((t) => t.slug), c0.things.slice(-2).map((t) => t.slug), 'and Blade\'s things stay at the end');
  /* Roll another, from the card (the rolled instance's own listener, as RK15 wires it) */
  act('another');
  const c2 = r.card(KEY);
  assert.equal(c2.things.length, 7, 'Roll another adds one'); assert.ok(c2.blade, 'Blade\'s answer stays through Roll another');
  assert.ok(c2.things.slice(0, 5).every((t) => !t.blade) && c2.things.slice(5).every((t) => t.blade), 'the drawn and added first, Blade\'s two last');
  /* Reroll the room: the Blade answer goes with the rest */
  act('reroll');
  const c3 = r.card(KEY), room = r.doc.roomstate.keys['515151'].rooms[KEY];
  assert.equal(room.rr, 1); assert.ok(!room.blade, 'Reroll takes the Blade answer away'); assert.equal(c3.blade, undefined); assert.equal(c3.things.length, 4);
  /* a tap, then Reroll from the card while Blade works: the late answer is dropped */
  let open; const wait = new Promise((res) => { open = res; });
  r.answer = () => wait.then(() => ({ room: clone(GOOD) }));
  r.click(r.el('fit', KEY));
  act('reroll');
  open(); await r.settle(); await r.settle();
  const room2 = r.doc.roomstate.keys['515151'].rooms[KEY];
  assert.equal(room2.rr, 2); assert.ok(!room2.blade, 'never written into the rerolled room');
  assert.match(r.toasts.filter((x) => x[0] === 'bad').map((x) => x[1]).join('|'), /came after Pelican bar was rerolled: dropped/);
});

test('the late load (the review\'s blocker): rolled cards made BEFORE room-blade.js arrives pick the tap up on their next draw, with no new instance', () => {
  const win = {}; win.self = win; win.window = win;
  const ctx = vm.createContext(win);
  const load = (f) => vm.runInContext(read(f), ctx, { filename: f });
  for (const f of ['app/ui/ui.js', 'app/gm/room-notes.js', 'app/gm/room-things.js', 'app/gm/room-state.js', 'app/gm/room-tables.js', 'app/gm/room-roll.js', 'app/gm/room-rolled.js']) load(f);
  const doc = {}, host = { roll: () => ROLL, rollKey: (x) => x.seed, T: () => T, doc: () => doc };
  const early = win.B68GmRoomRolled.create(host);
  const before = early.block('Pelican bar');
  assert.ok(typeof before === 'string' && /rr-say/.test(before) && !/data-rb=/.test(before), 'drawn before the tap\'s file arrives: the card, with no Fit (as today)');
  load('app/gm/room-blade.js');
  assert.ok(win.B68GmRoomBlade && !win.B68GmRoomBlade.stub);
  const after = early.block('Pelican bar');
  assert.match(after, /data-rb="fit"[^>]*>Fit to tonight \(~3¢\)<\/button>/, 'the same instance, drawn again: the Fit button is there');
  assert.equal(typeof early.model, 'function');
  const late = win.B68GmRoomRolled.create(host);
  assert.match(late.block('Pelican bar'), /data-rb="fit"/, 'and an instance made after has it too');
});

test('the wiring: ONE line in room-rolled.js, two host parts on gm-page.js\'s rrInst line, cf.js\'s assistRoom; nothing else names this file', () => {
  const rolled = read('app/gm/room-rolled.js').split('\n').filter((l) => /B68GmRoomBlade|room-blade/.test(l));
  assert.equal(rolled.length, 1, 'one line in the rolled cards');
  assert.match(rolled[0], /function blade\(\) \{ if \(!bl\) \{ var B = live\(mod\('B68GmRoomBlade', '\.\/room-blade\.js'\)\);/, 'looked up when called, not once at create()');
  assert.match(rolled[0], /now = function \(\) \{ return blade\(\)\.now\(\); \}; opts = function \(k, m, r\) \{ return blade\(\)\.opts\(k, m, r\); \}; onClick = function \(ev\) \{ return blade\(\)\.click\(ev\); \};/, 'stable wrappers: the listener added is the one destroy() takes off');
  const PAGE = read('app/gm-page.js'), rr = PAGE.split('\n').filter((l) => /function rrInst\(\)/.test(l));
  assert.equal(rr.length, 1);
  assert.match(rr[0], /, gm: function \(\) \{ return S === me \? gmApi\(\) : null; \}, tonight: function \(\) \{ return S === me \? \{ onStage: stageNames\(\) \} : null; \} \}\); return me\.rr; \}$/);
  assert.ok(!/B68GmRoomBlade|room-blade|assistRoom/.test(PAGE), 'the page itself names neither the module nor the call');
  assert.match(read('app/runtime/cf.js'), /assistRoom: function \(req\) \{ return api\('POST', '\/gm\/assist\/room', req \|\| \{\}, 60000\); \},/);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const files = walk(path.join(ROOT, 'app')).concat(walk(path.join(ROOT, 'functions'))).filter((f) => /\.(js|mjs|html)$/.test(f)).map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
  assert.deepEqual(files.filter((f) => /B68GmRoomBlade|room-blade\.js/.test(read(f))).sort(), ['app/gm/room-blade.js', 'app/gm/room-rolled.js', 'app/routes.js'], 'no display, phone, player or server file names it');
  assert.deepEqual(files.filter((f) => /assistRoom/.test(read(f))).sort(), ['app/gm/room-blade.js', 'app/runtime/cf.js']);
});

test('GM-side and small: no request but the runtime\'s, no storage, no document listener, no write but setBlade, no literal over 220 characters, no C1 characters', () => {
  const src = read(FILE), code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\b(fetch|XMLHttpRequest|localStorage|sessionStorage|indexedDB|innerHTML|addEventListener|document)\b/.test(code), 'no request, storage, markup sink or listener of its own');
  assert.ok(!/\.(setMark|setSwap|addExtra|setExtra|setSay|addKept|reroll|clearRoll|prune|patch)\(/.test(code), 'its one write is setBlade');
  assert.equal((code.match(/\.setBlade\(/g) || []).length, 2, 'the answer, and Clear');
  assert.ok(src.split('\n').every((l) => !/(['"])(?:(?!\1).){221,}\1/.test(l)), 'no string literal over 220 characters');
  assert.ok(!/[\u0080-\u009f]/.test(src));
  assert.ok(!/Math\.random/.test(src));
});

for (const [name, fn] of queue) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
