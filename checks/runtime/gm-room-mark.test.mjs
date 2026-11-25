// gm-room-mark (RK11 of the room key build, room.key): app/gm/room-mark.js, a thing's state: the zoom card's 'state' slot. INVENTED data only (the
// Pelican Rooms of checks/runtime/fixtures/gm/pelican-room-things.md). Driven through the page's own write path (gm-page.js's applyPatch and
// mergePatch, the server's deepMerge) with the real room-state.js as the writer. The states a thing allows (its State: list, else found / taken /
// gone), one tap to set and one to take away, the pressed button, a mark the note no longer lists (Clear), the disabled state with no writer or no place
// (a title that says why), a refusal thrown for the card's toast, the fresh read at tap time, a reload and two devices merging key by key, and the
// page's wiring (rs on the zoom host, the fourth rsInst line). The browser half is room-key.e2e.mjs. No browser, no network.
//   node checks/runtime/gm-room-mark.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/room-mark.js';
const M = require(path.join(ROOT, FILE));
const RS = require(path.join(ROOT, 'app', 'gm', 'room-state.js'));
const RT = require(path.join(ROOT, 'app', 'gm', 'room-things.js'));
const Z = require(path.join(ROOT, 'app', 'gm', 'room-zoom.js'));
const PP = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
const { deepMerge } = await import(pathToFileURL(path.join(ROOT, 'functions', '_lib', 'http.js')).href);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const clone = (v) => JSON.parse(JSON.stringify(v));
const SITE = 'a:The Pelican Rooms', ROOM = 'showroom#1';
const THINGS = RT.parse(read('checks/runtime/fixtures/gm/pelican-room-things.md').split('## Rooms · The gala')[1].split('### Showroom')[1].split('### Cocktail lounge')[0]);
const STAND = THINGS.find((t) => t.slug === 'brass-umbrella-stand'), ROPE = THINGS.find((t) => t.slug === 'velvet-rope');
const MONITORS = RT.clean({ name: 'A bank of monitors', states: ['on', 'off'] });

/* the page, its saver and the server, as gm-room-state.test.mjs has them: doc is what the page holds, server the D1 row */
function rig(o = {}) {
  const r = { on: o.on !== false, t: Date.parse('2026-11-25T09:00:00.000Z'), doc: clone(o.doc || {}), pending: null, toasts: [] };
  r.server = clone(r.doc);
  r.rs = RS.create({ on: () => r.on, doc: () => r.doc, now: () => (r.t += 1000), part: () => '', toast: (t) => r.toasts.push(t), busy: () => !!(r.pending && r.pending.roomstate),
    patch: (p) => { r.doc = PP.applyPatch(r.doc, p); r.pending = r.pending ? PP.mergePatch(r.pending, p) : clone(p); return true; } });
  r.flush = () => { if (r.pending) { r.server = deepMerge(r.server, r.pending); r.pending = null; } r.doc = clone(r.server); return r.server; };
  /* the ctx the zoom card hands a slot, for a thing, from what the page holds now */
  r.ctx = (thing, over) => Object.assign({ room: 'Showroom', rollKey: SITE, roomKey: ROOM, thing: { name: thing.name, slug: thing.slug, states: thing.states, tags: thing.tags || [] },
    index: 0, count: 4, state: (r.rs.read(SITE, ROOM).marks[thing.slug] || ''), rs: r.rs, page: {}, refresh() {}, close() {}, toast() {} }, over || {});
  return r;
}
const marks = (r) => r.rs.read(SITE, ROOM).marks;
const names = (bs) => bs.map((b) => b.label);

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

test('gm-room-mark: loads under Node and as a plain script (window.B68GmRoomMark), no longer a stub, and reads no other module', () => {
  assert.equal(M.stub, undefined, 'no longer a stub');
  for (const k of ['buttons', 'statesOf', 'label', 'markOf']) assert.equal(typeof M[k], 'function', k);
  assert.deepEqual(M.DEFAULT_STATES, ['found', 'taken', 'gone']);
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(read(FILE), win, { filename: FILE });
  assert.ok(win.B68GmRoomMark && typeof win.B68GmRoomMark.buttons === 'function' && !win.B68GmRoomMark.stub, 'defined, with nothing else loaded');
  assert.equal(win.B68GmRoomMark.buttons(null).length, 0, 'a bad ctx is no buttons, never a throw');
  const src = read(FILE).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/require\(|B68Gm(?!RoomMark)|B68Ui|document\.|window\./.test(src), 'no other module, and no DOM: the ctx and its rs do everything');
});

test('the states a thing allows: its State: list in the note\'s order, lower case, no repeats, at most four; else found, taken, gone', () => {
  assert.deepEqual(M.statesOf(STAND), ['full', 'empty']);
  assert.deepEqual(M.statesOf(MONITORS), ['on', 'off']);
  assert.deepEqual(M.statesOf(ROPE), ['found', 'taken', 'gone'], 'a thing with no State: line');
  assert.deepEqual(M.statesOf({ states: ['Open', ' OPEN ', 'Shut', '', 'a', 'b', 'c'] }), ['open', 'shut', 'a', 'b'], 'trimmed, one of each, four at most');
  for (const none of [null, undefined, {}, { states: [] }, { states: 'on' }, 'x']) assert.deepEqual(M.statesOf(none), ['found', 'taken', 'gone'], JSON.stringify(none));
  assert.equal(M.label('empty'), 'Empty'); assert.equal(M.label(''), '');
});

test('the buttons: one for each state, the pressed one is the mark, none disabled, ids per state, Standard rank (Primary stays Show\'s)', () => {
  const r = rig(), bs = M.buttons(r.ctx(STAND));
  assert.deepEqual(names(bs), ['Full', 'Empty']);
  assert.deepEqual(bs.map((b) => b.id), ['mark-full', 'mark-empty']);
  assert.deepEqual(bs.map((b) => b.pressed), [false, false]);
  assert.deepEqual(bs.map((b) => b.disabled), [false, false]);
  assert.deepEqual(bs.map((b) => b.rank), ['standard', 'standard']);
  assert.deepEqual(bs.map((b) => b.title), ['Mark it full.', 'Mark it empty.']);
  assert.ok(bs.every((b) => typeof b.run === 'function'));
  assert.deepEqual(names(M.buttons(r.ctx(ROPE))), ['Found', 'Taken', 'Gone'], 'the default states');
  const pressed = M.buttons(r.ctx(STAND, { state: 'empty' }));
  assert.deepEqual(pressed.map((b) => b.pressed), [false, true]);
  assert.equal(pressed[1].title, 'Empty. Tap again to take the mark away.');
  for (const bad of [null, {}, { thing: {} }, { thing: { slug: '' } }]) assert.deepEqual(M.buttons(bad), [], JSON.stringify(bad));
});

test('one tap sets the mark (room-state\'s marks: { <slug>: <state> }); one tap on the pressed one takes it away; one tap on the other switches', () => {
  const r = rig();
  M.buttons(r.ctx(MONITORS, { thing: { name: 'A bank of monitors', slug: 'bank-of-monitors', states: ['on', 'off'], tags: [] } }))[1].run(r.ctx(MONITORS));
  assert.deepEqual(r.doc.roomstate.keys[SITE].rooms[ROOM], { marks: { 'bank-of-monitors': 'off' } }, 'the store: the contract\'s shape, one small key');
  const c1 = r.ctx(STAND);
  M.buttons(c1)[1].run(c1);
  assert.deepEqual(marks(r), { 'bank-of-monitors': 'off', 'brass-umbrella-stand': 'empty' });
  const c2 = r.ctx(STAND); assert.equal(c2.state, 'empty');
  const b2 = M.buttons(c2); assert.deepEqual(b2.map((b) => b.pressed), [false, true]);
  b2[0].run(c2); assert.equal(marks(r)['brass-umbrella-stand'], 'full', 'one tap on the other state switches it');
  const c3 = r.ctx(STAND); M.buttons(c3)[0].run(c3);
  assert.equal(marks(r)['brass-umbrella-stand'], undefined, 'a tap on the pressed state takes the mark away');
  assert.deepEqual(marks(r), { 'bank-of-monitors': 'off' }, 'nothing else touched');
  const c4 = r.ctx(MONITORS, { thing: { slug: 'bank-of-monitors', states: ['on', 'off'] } }); M.buttons(c4)[1].run(c4);
  assert.deepEqual(r.doc.roomstate.keys, {}, 'the last mark gone: the room and the roll are gone too (nothing stored for nothing)');
});

test('the tap reads the store afresh: a card drawn before another device wrote still does the right thing', () => {
  const r = rig(), stale = r.ctx(STAND);            /* drawn with no mark */
  const other = r.ctx(STAND); M.buttons(other)[1].run(other);      /* the other device: empty */
  assert.equal(stale.state, '');
  M.buttons(stale)[1].run(stale);                    /* this card's Empty: the store says it is empty already, so a tap takes it away */
  assert.equal(marks(r)['brass-umbrella-stand'], undefined);
  assert.equal(M.markOf(stale), '');
  assert.equal(M.markOf({ state: 'Taken' }), 'taken', 'with no writer, the ctx\'s own');
});

test('a mark the note no longer lists: shown pressed nowhere, with a Clear that takes it off; every other state still sets it', () => {
  const r = rig(); r.rs.setMark(SITE, ROOM, STAND.slug, 'taken');
  const c = r.ctx(STAND), bs = M.buttons(c);
  assert.deepEqual(names(bs), ['Full', 'Empty', 'Clear']);
  assert.deepEqual(bs.map((b) => b.pressed), [false, false, false]);
  assert.equal(bs[2].rank, 'quiet'); assert.equal(bs[2].id, 'mark-clear'); assert.match(bs[2].title, /"taken"/);
  bs[1].run(c); assert.equal(marks(r)[STAND.slug], 'empty', 'a listed state replaces it');
  r.rs.setMark(SITE, ROOM, STAND.slug, 'gone'); const c2 = r.ctx(STAND); M.buttons(c2)[2].run(c2);
  assert.equal(marks(r)[STAND.slug], undefined, 'Clear takes it away');
  assert.deepEqual(names(M.buttons(r.ctx(STAND))), ['Full', 'Empty'], 'no mark: no Clear');
});

test('no writer, or no place for the room: the buttons are drawn but disabled, with a title that says why; the state still shows; a run throws, never writes', () => {
  const r = rig(); r.rs.setMark(SITE, ROOM, STAND.slug, 'empty');
  const ro = r.ctx(STAND, { rs: null }), bs = M.buttons(ro);
  assert.deepEqual(names(bs), ['Full', 'Empty']);
  assert.ok(bs.every((b) => b.disabled && b.title === M.WHY.writer), 'disabled: ' + JSON.stringify(bs.map((b) => b.title)));
  assert.deepEqual(bs.map((b) => b.pressed), [false, true], 'the read-only card still says which state it is in');
  assert.throws(() => bs[0].run(ro), /live GM page/);
  for (const over of [{ roomKey: '' }, { rollKey: '' }]) {
    const c = r.ctx(STAND, over), b = M.buttons(c);
    assert.ok(b.every((x) => x.disabled && x.title === M.WHY.place), JSON.stringify(over));
    assert.throws(() => b[0].run(c), /no place/);
  }
  assert.ok(M.buttons(r.ctx(STAND, { rs: { read: () => ({ marks: {} }) } })).every((b) => b.disabled), 'a reader with no setMark is no writer');
  assert.deepEqual(marks(r), { [STAND.slug]: 'empty' }, 'nothing was written');
});

test('a refused write is thrown (the card toasts it): the setting off, and a room already holding 20 marks', () => {
  const off = rig({ on: false }), c = off.ctx(STAND);
  assert.throws(() => M.buttons(c)[0].run(c), /not saved/);
  assert.equal(off.doc.roomstate, undefined, 'nothing stored');
  const r = rig();
  for (let i = 0; i < 20; i++) assert.ok(r.rs.setMark(SITE, ROOM, 'thing-' + i, 'taken'));
  const c2 = r.ctx(STAND); assert.throws(() => M.buttons(c2)[0].run(c2), /20 marks/);
  assert.equal(Object.keys(marks(r)).length, 20);
  const c3 = r.ctx({ slug: 'thing-3', name: 'x', states: [] }); M.buttons(c3)[2].run(c3);      /* a thing that has a mark can still be changed at the cap */
  assert.equal(marks(r)['thing-3'], 'gone');
});

test('it survives a reload, and two devices merge key by key', () => {
  const a = rig(), c = a.ctx(STAND); M.buttons(c)[1].run(c);
  const server = a.flush();
  const reload = rig({ doc: server });
  assert.deepEqual(reload.rs.read(SITE, ROOM).marks, { 'brass-umbrella-stand': 'empty' }, 'a new page session reads the mark back');
  assert.deepEqual(M.buttons(reload.ctx(STAND)).map((b) => b.pressed), [false, true], 'and draws it pressed');
  /* two devices, one room, at the same time: each writes its own thing */
  const d1 = rig({ doc: server }), d2 = rig({ doc: server });
  const e1 = d1.ctx(ROPE); M.buttons(e1)[1].run(e1);                    /* taken */
  const e2 = d2.ctx(STAND); M.buttons(e2)[0].run(e2);                   /* full (replaces empty) */
  const e3 = d2.ctx(MONITORS, { thing: { slug: 'bank-of-monitors', states: ['on', 'off'] } }); M.buttons(e3)[0].run(e3);
  let s = deepMerge(clone(server), d1.pending); s = deepMerge(s, d2.pending);
  assert.deepEqual(s.roomstate.keys[SITE].rooms[ROOM].marks, { 'brass-umbrella-stand': 'full', 'velvet-rope': 'taken', 'bank-of-monitors': 'on' }, 'every device\'s key survives');
  s = deepMerge(clone(server), d2.pending); s = deepMerge(s, d1.pending);
  assert.deepEqual(s.roomstate.keys[SITE].rooms[ROOM].marks, { 'brass-umbrella-stand': 'full', 'velvet-rope': 'taken', 'bank-of-monitors': 'on' }, 'in either order');
  /* one device takes a mark away while the other writes another: the null is a delete, never a tombstone */
  const f1 = rig({ doc: server }), f2 = rig({ doc: server });
  const g1 = f1.ctx(STAND); M.buttons(g1)[1].run(g1);                   /* empty again: off */
  const g2 = f2.ctx(ROPE); M.buttons(g2)[2].run(g2);
  s = deepMerge(deepMerge(clone(server), f1.pending), f2.pending);
  assert.deepEqual(s.roomstate.keys[SITE].rooms[ROOM].marks, { 'velvet-rope': 'gone' });
});

test('the zoom card\'s state slot: B68GmRoomMark.buttons is drawn by the card once the module is loaded (not a stub), and never in another slot', () => {
  const r = rig(), c = r.ctx(STAND), at = { B68GmRoomMark: M };
  assert.deepEqual(Z.slotsOf('state', c, [], at).map((b) => b.label), ['Full', 'Empty']);
  assert.deepEqual(Z.slotsOf('show', c, [], at), []); assert.deepEqual(Z.slotsOf('swap', c, [], at), []);
  const [full] = Z.slotsOf('state', c, [], at); full.run(c);
  assert.equal(marks(r)[STAND.slug], 'full');
  assert.deepEqual(Z.rows(STAND, marks(r)[STAND.slug]).pop(), { k: 'state', icon: '', label: 'State', lines: ['full'] }, 'the zoom card reads it as the State');
  assert.match(Z.listHtml('Showroom', THINGS, { marks: marks(r) }), /<span class="rk-tstate">full<\/span>/, 'and the room card draws it as a chip');
  assert.match(Z.listHtml('Showroom', THINGS, { marks: { 'velvet-rope': 'taken' } }), /class="[^"]*is-done[^"]*"[\s\S]*<span class="rk-tstate is-done">taken/, 'taken dims it');
});

test('the page\'s wiring: the zoom host gives rs only on the live page, through rsInst and never _roomState; the fourth rsInst line is this one', () => {
  const P = read('app/gm-page.js');
  assert.match(P, /toast: toast, rs: function \(\) \{ return S === me \? rsInst\(\) : null; \} \}\); return me\.rz; \}/, 'rkZoom\'s host: rs is the page\'s room-state instance, null off the live page');
  const zoomLine = P.split('\n').filter((l) => /function rkZoom\(\)/.test(l));
  assert.equal(zoomLine.length, 1); assert.ok(!/_roomState/.test(zoomLine[0]), 'not through the check hook');
  const lines = P.split('\n').filter((l) => /B68GmRoomState|B68GmRoomThings|roomstate|rsInst/.test(l));
  assert.equal(lines.length, 4, 'the rsInst comment and line, the check hook, and the zoom card\'s state writes (RK11): ' + lines.length);
  assert.ok(lines.some((l) => /function rkZoom\(\)/.test(l)), 'the fourth is rkZoom\'s');
  const zoom = read('app/gm/room-zoom.js');
  assert.ok(/function rs\(\) \{ var r = call\('rs'\); return r && typeof r\.read === 'function' \? r : null; \}/.test(zoom), 'the card reads ctx.rs from the host');
});

test('the room-key bundle carries room-mark.js, and nothing on a player path names it', () => {
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(read('app/routes.js'), win, { filename: 'routes.js' });
  const B = win.B68Load.BUNDLES, homes = (f) => Object.keys(B).filter((n) => B[n].includes(f));
  assert.deepEqual(homes('gm/room-mark.js'), ['room-key']);
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const files = walk(path.join(ROOT, 'app')).concat(walk(path.join(ROOT, 'functions'))).filter((f) => /\.(js|mjs|html)$/.test(f)).map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
  const hits = files.filter((f) => /B68GmRoomMark|room-mark/.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepEqual(hits.filter((f) => !/^app\/gm\/room-[a-z]+\.js$/.test(f)).sort(), ['app/routes.js'], 'only the room key files and routes.js name it: ' + hits.join(', '));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
