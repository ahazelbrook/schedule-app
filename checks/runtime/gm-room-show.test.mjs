// gm-room-show (RK10 of the room key build, room.key): app/gm/room-show.js, Show on iPad for one line of a thing, and its page wiring. INVENTED data
// only: the Pelican Rooms of checks/runtime/fixtures/gm/pelican-room-things.md (GM-ONLY- markers on every closer look, roll and danger).
// What a beat holds (the name and the line, or the name and the closer look; never the roll or the danger, for every fixture thing), its kind, time
// and key, the names gate (the spotlight's question, the reveal, a hidden clock refused), Take it down (our beat only), and the page's two lines.
// The browser half is room-key.e2e.mjs (the secrecy steps). No browser, no network.
//   node checks/runtime/gm-room-show.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/room-show.js';
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const RS = require(path.join(ROOT, FILE));
const SHOW = require(path.join(ROOT, 'app', 'gm', 'show.js'));
const RT = require(path.join(ROOT, 'app', 'gm', 'room-things.js'));
const RN = require(path.join(ROOT, 'app', 'gm', 'room-notes.js'));
const namesHit = require(path.join(ROOT, 'app', 'gm-page.js'))._pure.namesHit;
const NOTE = read('checks/runtime/fixtures/gm/pelican-room-things.md');
const ROOMS = ['Showroom', 'Cocktail lounge', 'Underground counting room', 'Security control room', 'Private card rooms', 'Luxury penthouse'];
const FOUND = RN.find({ notes: [{ id: 'n-pelican', rel: 'prep/pelican.md', title: 'The Pelican Rooms', blocks: [{ k: 'md', src: NOTE }] }] }, ROOMS);
const ALL = ROOMS.flatMap((r) => (FOUND.byRoom[r] ? RT.parse(FOUND.byRoom[r].md) : []).map((t) => ({ room: r, t })));
const SHOWROOM = RT.parse(FOUND.byRoom.Showroom.md);
const UMB = SHOWROOM[0], ROPE = SHOWROOM[1];

let passed = 0, failed = 0;
const queue = [];
function test(name, fn) { queue.push([name, fn]); }
const ctxOf = (t, extra) => Object.assign({ room: 'Showroom', rollKey: 'roll-1', roomKey: 'showroom#1', thing: Object.assign({}, t), index: 0, count: 4, state: '', rs: null, page: null, refresh() {}, close() {}, toast() {} }, extra || {});

/* a fake page host: the hidden cast and clocks are invented, and every call is written down */
function fakeHost(o = {}) {
  const log = [], npcs = (o.npcs || []).map((n) => Object.assign({}, n));
  const h = {
    log, cast: npcs, up: '', answer: o.answer !== undefined ? o.answer : {}, confirmSays: o.confirm !== undefined ? o.confirm : true,
    show(kind, p, opts) { log.push(['show', kind, p, opts]); if (h.answer != null) h.up = SHOW.idFor(opts.key); return Promise.resolve(h.answer); },
    hidden() { return npcs.filter((n) => !n.revealed).flatMap((n) => [n.name].concat(n.alias ? [n.alias] : [])).concat(o.clocks || []); },
    namesHit,
    npcs: () => npcs.map((n) => Object.assign({}, n)),
    reveal(id) { log.push(['reveal', id]); if (o.revealFails) return Promise.reject(new Error('no')); npcs.find((n) => n.id === id).revealed = true; return Promise.resolve(); },
    confirm(m) { log.push(['confirm', m]); return h.confirmSays; },
    overlayId() { return h.up; },
    clear() { log.push(['clear']); h.up = ''; return Promise.resolve({}); },
    toast(t, bad) { log.push(['toast', t, !!bad]); }
  };
  return h;
}
const kinds = (log) => log.map((l) => l[0]).join(',');

test('loads under Node, and as a plain script defines window.B68GmRoomShow with nothing else loaded (other modules are read when called)', () => {
  assert.equal(RS.stub, undefined, 'no longer a stub');
  const win = {}; win.self = win; win.window = win; win.setTimeout = setTimeout;
  vm.runInNewContext(read(FILE), win, { filename: FILE });
  const M = win.B68GmRoomShow;
  assert.ok(M && typeof M.buttons === 'function' && typeof M.make === 'function' && typeof M.payload === 'function');
  assert.equal(M.buttons({ thing: { name: 'x', slug: 'x' } }).length, 0, 'no page host (no B68GmPage): no buttons');
  win.B68GmPage = { roomShow: () => null };
  assert.equal(M.buttons({ thing: { name: 'x', slug: 'x' } }).length, 0, 'the page says room.key is off: no buttons');
  assert.equal(RS.KIND, 'title'); assert.equal(RS.MS, 12000); assert.deepEqual(RS.WHICH, ['thing', 'look']);
  assert.equal(RS.QUESTION, 'This names someone hidden: reveal and show?');
});

test('the beat: Show the thing is { text: name, sub: line }, Show the closer look is { text: name, sub: look }, both a title the show contract takes', () => {
  assert.deepEqual(RS.payload(UMB, 'thing'), { text: 'A brass umbrella stand', sub: 'Too heavy to tip.' });
  assert.deepEqual(RS.payload(UMB, 'look'), { text: 'A brass umbrella stand', sub: 'GM-ONLY-look: one umbrella is dry, though it is raining outside.' });
  assert.deepEqual(RS.payload({ name: 'A tin tray', line: '', look: '' }, 'thing'), { text: 'A tin tray' }, 'no line: the name alone');
  assert.equal(RS.payload({ name: 'A tin tray', line: 'dented', look: '' }, 'look'), null, 'no closer look: nothing to show');
  assert.equal(RS.payload({ name: '  ', line: 'x' }, 'thing'), null, 'no name: nothing');
  for (const { t } of ALL) for (const w of RS.WHICH) { const p = RS.payload(t, w); if (p) assert.ok(SHOW.payloadOk('title', p) && SHOW.overlayFor('title', p, { ms: RS.MS, id: 'x' }), 'the contract takes ' + JSON.stringify(p)); }
  const long = { name: 'A '.repeat(60) + 'long name', line: 'word '.repeat(40), look: 'x'.repeat(300) };
  for (const w of RS.WHICH) assert.ok(SHOW.payloadOk('title', RS.payload(long, w)), 'an over-long line is cut to fit (' + w + ')');
});

test('the 🎲 roll and the ! danger are never sendable: no which reaches them, and no fixture beat holds a roll or a danger line', () => {
  for (const w of ['roll', 'danger', 'state', 'tags', 'states', '', null, undefined, 'Thing', 'LOOK']) assert.equal(RS.payload(UMB, w), null, 'which ' + w);
  let n = 0;
  for (const { t } of ALL) for (const w of RS.WHICH) {
    const p = RS.payload(t, w); if (!p) continue; n++;
    const s = JSON.stringify(p);
    assert.ok(!/GM-ONLY-(roll|danger)/.test(s), 'no roll or danger in ' + s);
    if (t.roll) assert.ok(!s.includes(t.roll.slice(0, 30)), 'not the roll');
    if (t.danger) assert.ok(!s.includes(t.danger.slice(0, 30)), 'not the danger');
    if (w === 'thing') assert.ok(!/GM-ONLY-look/.test(s), 'the thing\'s beat holds no closer look');
  }
  assert.ok(n >= 12 && ALL.some(({ t }) => t.roll) && ALL.some(({ t }) => t.danger), 'the fixture has things with rolls and dangers (' + n + ' beats)');
  const labels = RS.make(fakeHost()).buttons(ctxOf(UMB)).map((b) => b.label + '#' + b.id);
  assert.deepEqual(labels, ['Show on iPad#show-thing', 'Show the closer look#show-look'], 'two buttons, and no third for the roll or the danger');
});

test('the buttons: none without a host or a thing, one when there is no closer look, every one standard (the card keeps one Primary)', () => {
  assert.deepEqual(RS.make(null).buttons(ctxOf(UMB)), []);
  assert.deepEqual(RS.make(() => null).buttons(ctxOf(UMB)), [], 'room.key off: the page gives no host');
  assert.deepEqual(RS.make(fakeHost()).buttons({ room: 'Showroom' }), []);
  const one = RS.make(fakeHost()).buttons(ctxOf({ name: 'a cocktail shaker', line: '', look: '', slug: 'a-cocktail-shaker' }));
  assert.deepEqual(one.map((b) => b.label), ['Show on iPad']);
  assert.ok(RS.make(fakeHost()).buttons(ctxOf(UMB)).every((b) => b.rank === 'standard' && b.pressed === false && typeof b.run === 'function' && /12 seconds/.test(b.title)));
});

test('a tap sends one title beat for 12 seconds under the thing\'s key and toasts; its button reads Take it down while it is up, and that takes off our beat only', async () => {
  const h = fakeHost(), m = RS.make(h);
  const ctx = ctxOf(UMB);
  const b = m.buttons(ctx)[0];
  assert.equal(await b.run(ctx), true);
  assert.equal(kinds(h.log), 'show,toast');
  const [, kind, p, opts] = h.log[0];
  assert.equal(kind, 'title'); assert.deepEqual(p, { text: 'A brass umbrella stand', sub: 'Too heavy to tip.' });
  assert.deepEqual(opts, { ms: 12000, key: RS.keyOf(ctx, 'thing') });
  assert.ok(!/brass|umbrella/i.test(SHOW.idFor(opts.key)), 'the overlay id is opaque');
  assert.equal(h.log[1][1], 'On the iPad for 12 seconds: A brass umbrella stand.');
  const now = m.buttons(ctx);
  assert.deepEqual(now.map((x) => x.label + ':' + x.pressed), ['Take it down:true', 'Show the closer look:false']);
  assert.equal(await now[0].run(ctx), true); assert.equal(h.log[h.log.length - 1][0], 'clear', 'Take it down clears our beat');
  assert.deepEqual(m.buttons(ctx).map((x) => x.label), ['Show on iPad', 'Show the closer look']);
  await m.buttons(ctx)[1].run(ctx); h.up = 'someone-else';
  assert.equal(m.isUp(ctx, 'look'), false, 'another overlay is up: ours is not');
  assert.equal(await m.down(ctx, 'look'), false); assert.notEqual(h.log[h.log.length - 1][0], 'clear', 'nothing cleared');
});

test('the same thing\'s same line has the same key from any page; a different line, thing, room or roll has another', () => {
  const k = RS.keyOf(ctxOf(UMB), 'thing');
  assert.equal(RS.keyOf(ctxOf(UMB), 'thing'), k);
  for (const c of [RS.keyOf(ctxOf(UMB), 'look'), RS.keyOf(ctxOf(ROPE), 'thing'), RS.keyOf(ctxOf(UMB, { room: 'Cocktail lounge' }), 'thing'), RS.keyOf(ctxOf(UMB, { rollKey: 'roll-2' }), 'thing')]) assert.notEqual(c, k);
});

test('a refused send (the page\'s gate or the server said no) is not up and says nothing more; the roll and the danger never reach show()', async () => {
  const h = fakeHost({ answer: null }), m = RS.make(h), ctx = ctxOf(UMB);
  assert.equal(await m.send(ctx, 'thing'), false);
  assert.equal(kinds(h.log), 'show');
  assert.equal(m.buttons(ctx)[0].label, 'Show on iPad');
  assert.equal(await m.send(ctx, 'roll'), false); assert.equal(await m.send(ctx, 'danger'), false); assert.equal(kinds(h.log), 'show');
});

const HIDDEN = [{ id: 'npc-hidden-a', name: 'GM-ONLY-Silent Partner', alias: 'The Partner', revealed: false }, { id: 'npc-dov', name: 'Dov Kessler', alias: '', revealed: true }];
const NAMING = { name: 'A sealed envelope', line: 'addressed to GM-ONLY-Silent Partner in green ink', look: 'a crest that is the partner\'s, of course', slug: 'a-sealed-envelope' };

test('the names gate: a line naming a hidden NPC asks the spotlight\'s question; no shows nothing and reveals no one', async () => {
  const h = fakeHost({ npcs: HIDDEN, confirm: false }), m = RS.make(h);
  assert.equal(await m.send(ctxOf(NAMING), 'thing'), false);
  assert.equal(kinds(h.log), 'confirm,toast');
  assert.ok(h.log[0][1].startsWith('This names someone hidden: reveal and show?') && h.log[0][1].includes('GM-ONLY-Silent Partner'));
  assert.ok(!h.cast.find((n) => n.id === 'npc-hidden-a').revealed);
});

test('the names gate: yes reveals them (the spotlight\'s reveal), then the beat goes; an alias, in any case, is a hit too', async () => {
  const h = fakeHost({ npcs: HIDDEN, confirm: true }), m = RS.make(h);
  assert.equal(await m.send(ctxOf(NAMING), 'thing'), true);
  assert.equal(kinds(h.log), 'confirm,reveal,show,toast');
  assert.equal(h.log[1][1], 'npc-hidden-a');
  const h2 = fakeHost({ npcs: HIDDEN }), m2 = RS.make(h2);
  assert.equal(await m2.send(ctxOf(Object.assign({}, NAMING, { line: 'sealed by THE PARTNER' })), 'thing'), true);
  assert.equal(kinds(h2.log), 'confirm,reveal,show,toast');
  const h3 = fakeHost({ npcs: HIDDEN }), m3 = RS.make(h3);
  assert.equal(await m3.send(ctxOf(NAMING), 'look'), true, 'the closer look ("the partner\'s") holds the alias whole');
  assert.equal(kinds(h3.log), 'confirm,reveal,show,toast');
  const h4 = fakeHost({ npcs: HIDDEN }), m4 = RS.make(h4);
  assert.equal(await m4.send(ctxOf({ name: 'Partnership papers', line: 'Dov Kessler signed them', slug: 'pp' }), 'thing'), true, 'a revealed NPC and a longer word are no hit');
  assert.equal(kinds(h4.log), 'show,toast');
});

test('the names gate: a hidden clock is refused (never revealed from here); a failed reveal shows nothing', async () => {
  const h = fakeHost({ npcs: HIDDEN, clocks: ['GM-ONLY-Alarm'] }), m = RS.make(h);
  assert.equal(await m.send(ctxOf({ name: 'A red lamp', line: 'it lights when the GM-ONLY-Alarm fills', slug: 'lamp' }), 'thing'), false);
  assert.equal(kinds(h.log), 'toast'); assert.equal(h.log[0][2], true); assert.match(h.log[0][1], /hidden clock/);
  const h2 = fakeHost({ npcs: HIDDEN, revealFails: true }), m2 = RS.make(h2);
  assert.equal(await m2.send(ctxOf(NAMING), 'thing'), false);
  assert.equal(kinds(h2.log), 'confirm,reveal,toast');
});

test('the page: two lines in gm-page.js, the host is null while room.key is off, and no display, phone or server file names the module', () => {
  const P = read('app/gm-page.js');
  assert.match(P, /function rkShowHost\(\) \{ var me = S; if \(!me \|\| !b09On\('room\.key'\)\) return null; return \{ page: me, show: function \(k, p, o\) \{ var c = shows\(\);/);
  assert.match(P, /\n    roomShow: function \(\) \{ return rkShowHost\(\); \},/);
  assert.equal(P.split('\n').filter((l) => /rkShowHost|B68GmRoomShow|room-show/.test(l)).length, 3, 'the comment line, the host and the public hook');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const files = walk(path.join(ROOT, 'app')).concat(walk(path.join(ROOT, 'functions'))).filter((f) => /\.(js|mjs|html)$/.test(f)).map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
  const hits = files.filter((f) => /B68GmRoomShow|room-show\.js|rkShowHost/.test(read(f)));
  assert.deepEqual(hits.sort(), ['app/gm-page.js', 'app/gm/room-show.js', 'app/gm/room-zoom.js', 'app/routes.js'].sort());
  const src = read(FILE).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/\b(fetch|XMLHttpRequest|localStorage|sessionStorage|indexedDB|innerHTML|addEventListener)\b/.test(src), 'no request, storage, markup or listener of its own');
  assert.ok(!/'[^'\n]{221,}'/.test(read(FILE)) && !/[\u0080-\u009f]/.test(read(FILE)), 'no literal over 220 characters, no C1 characters');
});

for (const [name, fn] of queue) {
  try { await fn(); passed++; console.log('PASS gm-room-show: ' + name); } catch (e) { failed++; console.log('FAIL gm-room-show: ' + name + ': ' + (e && e.stack || e)); }
}
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
