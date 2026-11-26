// gm-room-keep (RK19 of the room key build; setting room.tables): app/gm/room-keep.js, Keep: a quick-draw person filed into the cast as a hidden NPC.
// INVENTED data only: the npc part of checks/runtime/fixtures/gm/npc-pack.json, the rooms part of fixtures/gm/rooms-pack.json (the Pelican bar's waiter and cleaner)
// and slots made up here. What it checks: the doc is castDoc's shape, hidden (revealed false, so a player's view of it is nothing), tagged room and generated, and the
// server's own checkNpc takes it; its GM notes carry Tell, Signature and Met lines the face looks read (from the role's face and pose words, with a fallback for an
// older pack); Keep files the person the room SHOWS (cards(), never a lone card()), then marks the slot Kept through room-state's addKept, which survives a "reload"
// and allows one Keep a slot; a name clash (name or alias in the cast, or filed a moment ago) is refused and files nothing; a cast still loading or a failed write
// stores nothing; Keep never moves what the roll draws; the markup. The browser half is room-tables.e2e.mjs (step 8). No browser, no network.
//   node checks/runtime/gm-room-keep.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/room-keep.js';
const KP = require(path.join(ROOT, FILE));
const P = require(path.join(ROOT, 'app', 'gm', 'room-people.js'));
const RS = require(path.join(ROOT, 'app', 'gm', 'room-state.js'));
const FL = require(path.join(ROOT, 'app', 'display', 'face-look.js'));
const K = require(path.join(ROOT, 'app', 'figures', 'figure-kit.js'));
const { checkNpc, playerView, blankNpc } = await import('../../functions/_lib/npcs.js');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NPC = JSON.parse(read('checks/runtime/fixtures/gm/npc-pack.json')).parts.npc.T;
const T = JSON.parse(read('checks/runtime/fixtures/gm/rooms-pack.json')).T;
const clone = (v) => JSON.parse(JSON.stringify(v));
const NOW = Date.UTC(2026, 10, 27, 1, 0, 0);
const ROLL = 4242, ROOM = 'pelican bar#1';

let passed = 0, failed = 0;
const tests = [];
function test(name, fn) { tests.push([name, fn]); }

/* the page's GM state, as room-state's host sees it: a patch merges, a null deletes */
function merge(a, p) { for (const k of Object.keys(p)) { if (p[k] === null) delete a[k]; else if (p[k] && typeof p[k] === 'object' && !Array.isArray(p[k])) { if (!a[k] || typeof a[k] !== 'object') a[k] = {}; merge(a[k], p[k]); } else a[k] = p[k]; } return a; }
function stateOf(doc) { return RS.create({ on: () => true, doc: () => doc, patch: (p) => { merge(doc, clone(p)); return true; }, busy: () => false, now: () => NOW, part: () => '1' }); }
/* two waiters whose lone card() would say the same line: cards() steers the second one off it */
function twoWaiters() {
  for (let s = 1; s < 4000; s++) {
    const slots = [{ id: 'p1', role: 'waiter', seed: s }, { id: 'p2', role: 'waiter', seed: s * 7 + 3 }, { id: 'p3', role: 'cleaner', seed: s + 11 }];
    const ctx = { npc: NPC, T, K, roomKey: ROOM }, all = P.cards(slots, ctx), lone = P.card(slots[1], ctx);
    if (lone.line === all[0].line && all[1].line !== lone.line) return slots;
  }
  throw new Error('no seed gives two waiters on one line');
}
const SLOTS = twoWaiters();
function rig({ cast = {}, file = null, doc = {} } = {}) {
  const st = stateOf(doc), toasts = [], files = [];
  const host = { roll: () => ({ name: 'The Pelican Rooms', seed: ROLL }), rs: () => st, cast: () => cast, npc: () => NPC, T: () => T, masked: () => false,
    file: file || ((id, d) => { files.push({ id, d: clone(d) }); cast[id] = clone(d); return Promise.resolve(); }), toast: (t, bad) => toasts.push((bad ? '!' : '') + t), redraw: () => {} };
  const model = () => ({ rollKey: String(ROLL), cards: [{ name: 'Pelican bar', n: 1, roomKey: ROOM, people: clone(SLOTS) }] });
  const inst = KP.create(host, { model, cards: (s, x) => P.cards(s, x), now: () => NOW });
  return { st, toasts, files, host, inst, doc, cast, ctx: { room: 'Pelican bar', roomKey: ROOM, rollKey: String(ROLL), page: host } };
}
const shownCards = () => P.cards(SLOTS, { npc: NPC, T, K, roomKey: ROOM });

test('gm-room-keep: the module loads under Node, and as a plain script it defines window.B68GmRoomKeep (no stub)', () => {
  assert.ok(KP && !KP.stub && typeof KP.create === 'function' && typeof KP.html === 'function');
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(read(FILE), win, { filename: FILE });
  assert.ok(win.B68GmRoomKeep && !win.B68GmRoomKeep.stub && typeof win.B68GmRoomKeep.doc === 'function');
});

test('the doc is castDoc\'s shape, hidden, tagged room and generated; the server\'s checkNpc takes it and a player sees nothing of it', () => {
  const c = shownCards()[0], d = KP.doc(c, { site: 'The Pelican Rooms', room: 'Pelican bar', now: NOW });
  assert.deepEqual(Object.keys(d).sort(), Object.keys(blankNpc()).sort(), 'exactly the cast\'s fields (castDoc\'s shape)');
  assert.equal(d.revealed, false, 'hidden'); assert.equal(d.firstSeen, null);
  assert.deepEqual(d.tags, ['room', 'generated']);
  assert.ok(d.name === c.name && d.role === c.label && d.description === c.look && d.alias === '' && d.faction === '');
  assert.equal(d.spec.name, c.name, 'the spec is the card\'s figure, named');
  assert.deepEqual(Object.assign({}, d.spec, { name: undefined }), Object.assign({}, c.spec, { name: undefined }));
  const stored = checkNpc(clone(d));
  assert.equal(stored.revealed, false, 'checkNpc keeps it hidden');
  assert.equal(playerView(stored), null, 'a player\'s view of a kept person is nothing (GET /api/npcs leaves the row out)');
});

test('the GM notes: Tell (the role\'s face word, then the card\'s tell), Signature (the role\'s pose word) and Met (site · room · date), which the face looks read', () => {
  const c = shownCards()[0], d = KP.doc(c, { site: 'The Pelican Rooms', room: 'Pelican bar', now: NOW }), lines = d.gmNotes.split('\n');
  const habit = c.tell.replace(/[.!?…]+$/, '');
  assert.equal(lines[0], 'Tell: ' + T.roles.waiter.face + ' — ' + habit.charAt(0).toLowerCase() + habit.slice(1));
  assert.equal(lines[1], 'Signature: ' + T.roles.waiter.pose);
  assert.equal(lines[2], 'Met: The Pelican Rooms · Pelican bar · ' + KP.dmy(NOW));
  assert.match(lines[2], /^Met: .+ · .+ · \d\d\/\d\d\/\d{4}$/);
  const p = FL.parseNotes(d.gmNotes);
  assert.equal(p.tell, T.roles.waiter.face, 'the Tell button works'); assert.equal(p.signature, T.roles.waiter.pose, 'the Signature button works');
  assert.ok(d.gmNotes.includes('“' + c.line + '”') && d.gmNotes.includes(c.want), 'the line and the want are kept, GM-side');
  assert.ok(d.gmNotes.length <= 8000 && !/GM-ONLY-/.test(d.gmNotes));
});

test('rule 11: every role of the kit, with and without a roles entry and with an older pack\'s prose face and pose, gets a Tell and a Signature the face looks read', () => {
  const prose = clone(T); prose.roles.waiter.face = 'Smiles at the room'; prose.roles.waiter.pose = 'Weight on one foot';
  let n = 0;
  for (const TT of [T, prose]) for (const role of K.roles().map((r) => r.id).concat(['waiter'])) for (const seed of [3, 77, 901]) {
    const c = P.card({ id: 'p1', role, seed }, { npc: NPC, T: TT, K });
    const p = FL.parseNotes(KP.notes(c, { site: 'S', room: 'R', now: NOW }));
    assert.ok(FL.EXPRS.includes(p.tell) && FL.POSES.includes(p.signature), role + ': ' + JSON.stringify(p)); n++;
  }
  const c = P.card({ id: 'p1', role: 'waiter', seed: 3 }, { npc: NPC, T: prose, K });
  assert.ok(FL.EXPRS.includes(KP.tellLine(c).split(' ')[1]) && KP.tellLine(c).split(' ')[1] !== 'smiles', 'prose falls back to the figure\'s own expression');
  assert.ok(n > 100);
});

test('Keep files the person the room SHOWS (cards(), not a lone card()), hidden, then marks the slot Kept; a reload still shows Kept; the draw does not move', async () => {
  const R = rig(), before = JSON.stringify(shownCards().map((c) => [c.name, c.line, c.look]));
  const shown = shownCards()[1], lone = P.card(SLOTS[1], { npc: NPC, T, K, roomKey: ROOM });
  assert.notEqual(shown.line, lone.line, 'the fixture: a lone card() would differ from what the room shows');
  const r = await R.inst.keep(ROOM, 'p2');
  assert.ok(r.ok && /^npc_[a-z0-9-]+_[a-z0-9]+$/.test(r.id), JSON.stringify(r));
  assert.equal(R.files.length, 1, 'one write');
  const d = R.files[0].d;
  assert.ok(d.name === shown.name && d.gmNotes.includes('“' + shown.line + '”') && !d.gmNotes.includes('“' + lone.line + '”'), 'the room\'s second waiter, as the room shows them');
  assert.equal(d.revealed, false); assert.deepEqual(d.tags, ['room', 'generated']);
  assert.deepEqual(R.st.read(String(ROLL), ROOM).kept, [{ id: r.id, slot: 'p2' }], 'kept through room-state');
  assert.deepEqual(Object.keys(R.doc), ['roomstate'], 'nothing else is stored in the GM state (no npcgen entry, no rolled text)');
  assert.ok(!JSON.stringify(R.doc).includes(shown.name), 'the GM state holds an id, never the person\'s text');
  assert.ok(R.toasts.some((t) => t === shown.name + ' is in the cast, hidden.'), R.toasts.join(' | '));
  const reload = stateOf(clone(R.doc));      /* a reload: a fresh room-state on the saved document */
  assert.deepEqual(reload.read(String(ROLL), ROOM).kept, [{ id: r.id, slot: 'p2' }]);
  const h = KP.html(shown, Object.assign({}, R.ctx, { page: Object.assign({}, R.host, { rs: () => reload }) }));
  assert.ok(/data-rr-kept="npc_/.test(h) && /data-gm="npcipad"/.test(h) && h.includes('data-id="' + r.id + '"') && /Show on iPad/.test(h) && !/data-rr-keep=/.test(h), h);
  const tags = [...P.html(SLOTS, Object.assign({ npc: NPC, T, K }, R.ctx, { page: Object.assign({}, R.host, { rs: () => reload }) })).matchAll(/rr-ptag">([a-z]+)</g)].map((x) => x[1]);
  assert.deepEqual(tags, ['quick', 'kept', 'quick'], 'the kept person is tagged "kept" beside the name, the others "quick"');
  assert.ok(/^<span class="rr-pkeep">.*data-rr-keep="p1"/.test(KP.html(shownCards()[0], R.ctx)), 'the other waiter still has Keep');
  assert.equal(JSON.stringify(shownCards().map((c) => [c.name, c.line, c.look])), before, 'Keep never changes what the roll draws');
  assert.ok(R.st.reroll(String(ROLL), ROOM) && R.st.read(String(ROLL), ROOM).kept.length === 1, 'Reroll the room keeps kept');
  KP.reset();
});

test('one Keep a slot: a second Keep of the slot files nothing; busy while the write is out', async () => {
  let release; const R = rig({ file: (id, d) => { R.files.push({ id, d }); R.cast[id] = d; return new Promise((res) => { release = res; }); } });
  const p = R.inst.keep(ROOM, 'p1');
  assert.ok(R.inst.busy(ROOM, 'p1'));
  const again = await R.inst.keep(ROOM, 'p1');
  assert.equal(again.ok, false); assert.equal(R.files.length, 1, 'no second write while the first is out');
  release(); await p;
  assert.ok(!R.inst.busy(ROOM, 'p1'));
  const third = await R.inst.keep(ROOM, 'p1');
  assert.ok(third.ok && !third.id && /is kept already\.$/.test(third.say), JSON.stringify(third)); assert.equal(R.files.length, 1);
  assert.equal(R.st.read(String(ROLL), ROOM).kept.length, 1);
  KP.reset();
});

test('a name clash is refused and files nothing: a cast member of the name, of the alias, or a room person met somewhere else', async () => {
  KP.reset();
  const c0 = shownCards()[0], name = c0.name, elsewhere = KP.doc(c0, { site: 'The Pelican Rooms', room: 'Pelican cloakroom', now: NOW });
  for (const cast of [{ npc_a: { name: name.toUpperCase(), tags: [] } }, { npc_b: { name: 'Mabel Quist', alias: name, tags: ['generated'] } }, { npc_c: elsewhere }]) {
    const R = rig({ cast });
    const r = await R.inst.keep(ROOM, 'p1');
    assert.ok(!r.ok && /is in the cast already, so Keep filed nobody/.test(r.say), r.say);
    assert.equal(R.files.length, 0); assert.deepEqual(R.st.read(String(ROLL), ROOM).kept, []);
  }
  KP.reset();
});

test('the reload gap: a person filed from this room whose slot was never marked is ADOPTED (addKept), never filed twice; one kept elsewhere in the room is not', async () => {
  KP.reset();
  const c0 = shownCards()[0], mine = KP.doc(c0, { site: 'The Pelican Rooms', room: 'Pelican bar', now: NOW - 86400000 });
  const R = rig({ cast: { npc_mine: mine } });      /* the cast holds them; the GM state lost the mark (a reload before the save) */
  const r = await R.inst.keep(ROOM, 'p1');
  assert.ok(r.ok && r.id === 'npc_mine' && R.files.length === 0 && /from this room/.test(r.say), JSON.stringify(r));
  assert.deepEqual(R.st.read(String(ROLL), ROOM).kept, [{ id: 'npc_mine', slot: 'p1' }]);
  /* this page filed them a moment ago and the cast's snapshot has not caught up: adopted too */
  const A = rig(); const a = await A.inst.keep(ROOM, 'p1'); assert.ok(a.ok);
  const B = rig({ cast: {} });
  const b = await B.inst.keep(ROOM, 'p1');
  assert.ok(b.ok && b.id === a.id && B.files.length === 0, 'filed a moment ago on this page: adopted, not filed again: ' + JSON.stringify(b));
  /* the same doc already kept in another slot of this room: refused (a second person of one name) */
  const doc2 = {}; const C = rig({ cast: { npc_mine: mine }, doc: doc2 });
  assert.ok(C.st.addKept(String(ROLL), ROOM, 'npc_mine', 'p3'));
  const c = await C.inst.keep(ROOM, 'p1');
  assert.ok(!c.ok && C.files.length === 0 && /Keep filed nobody/.test(c.say), c.say);
  KP.reset();
});

test('a refused Keep can be tapped again: the button is off while the write is out and on again after a clash, a cast still loading or a failed write', async () => {
  KP.reset();
  const el = (slot) => ({ disabled: false, getAttribute: (k) => (k === 'data-rr-room' ? ROOM : k === 'data-rr-keep' ? slot : null) });
  const L = rig(); L.host.cast = () => null;
  const b1 = el('p1'); const p1 = L.inst.tap(b1); assert.equal(b1.disabled, true, 'off at once'); await p1; assert.equal(b1.disabled, false, 'on again after "still loading"');
  const X = rig({ cast: { npc_x: { name: shownCards()[0].name, tags: [] } } });
  const b2 = el('p1'); await X.inst.tap(b2); assert.equal(b2.disabled, false, 'on again after a clash');
  const F = rig({ file: () => Promise.reject(new Error('offline')) });
  const b3 = el('p1'); await F.inst.tap(b3); assert.equal(b3.disabled, false, 'on again after a failed write');
  L.host.cast = () => ({}); const r = await L.inst.tap(b1);
  assert.ok(r.ok && b1.disabled === true && L.files.length === 1, 'tapped again, it keeps them (and stays off until the redraw draws Kept)');
  KP.reset();
});

test('a cast still loading, a failed write, an unknown room or slot: nothing is filed or stored, and a toast says why', async () => {
  KP.reset();
  const L = rig(); L.host.cast = () => null;
  const a = await L.inst.keep(ROOM, 'p1');
  assert.ok(!a.ok && /still loading/.test(a.say) && L.files.length === 0);
  const F = rig({ file: () => Promise.reject(new Error('offline')) });
  const b = await F.inst.keep(ROOM, 'p1');
  assert.ok(!b.ok && /Could not add them to the cast: offline/.test(b.say)); assert.deepEqual(F.st.read(String(ROLL), ROOM).kept, []);
  const U = rig();
  assert.ok(!(await U.inst.keep('nowhere#1', 'p1')).ok && !(await U.inst.keep(ROOM, 'p9')).ok && U.files.length === 0);
  assert.ok(U.toasts.every((t) => t.startsWith('!')));
  KP.reset();
});

test('the markup: Keep carries data-rr-keep and data-rr-room (never data-rr-slot), escaped; nothing without a name, a writer or a file host', () => {
  const R = rig(), c = shownCards()[0];
  const h = KP.html(c, R.ctx);
  assert.match(h, /^<span class="rr-pkeep"><button type="button" class="ui-btn ui-btn--quiet rv-btn sm rr-keep" title="Adds them to the cast, hidden from the players" data-rr-keep="p1" data-rr-room="pelican bar#1">Keep<\/button><\/span>$/);
  assert.ok(!/data-rr-slot/.test(h));
  assert.equal(KP.html(Object.assign({}, c, { name: '' }), R.ctx), '', 'no name, no Keep');
  assert.equal(KP.html(c, Object.assign({}, R.ctx, { page: Object.assign({}, R.host, { rs: () => null }) })), '', 'no writer');
  assert.equal(KP.html(c, Object.assign({}, R.ctx, { page: Object.assign({}, R.host, { file: undefined }) })), '', 'no file host');
  assert.ok(!/<script/.test(KP.html(Object.assign({}, c, { id: '"><script>' }), R.ctx)), 'escaped');
  /* the card carries it (room-people.js row(), one line): with no host it draws nothing, as RK17 left it */
  assert.ok(!/rr-pkeep/.test(P.html(SLOTS, { npc: NPC, T, K, roomKey: ROOM })) && /rr-pkeep/.test(P.html(SLOTS, Object.assign({ npc: NPC, T, K }, R.ctx))));
});

test('wiring and hygiene: an id the server and room-state take; it names neither the quick cards\' nor the rolled cards\' module; it sends nothing itself', () => {
  const id = KP.idFor('Ådá  O\'Vell-Smith', NOW);
  assert.ok(/^[A-Za-z0-9_-]{1,64}$/.test(id) && id.startsWith('npc_'), id);
  const src = read(FILE), code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/room-people|B68GmRoomPeople|room-rolled|B68GmRoomRolled/.test(src), 'their tests pin who names them');
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|\.patch\(|\/api\/|Math\.random/.test(code), 'it writes only through its host (file) and room-state (addKept)');
  assert.ok(src.split('\n').every((l) => !/(['"])(?:(?!\1).){221,}\1/.test(l)), 'no string literal over 220 characters');
  const rolled = read('app/gm/room-rolled.js').split('\n').filter((l) => /B68GmRoomKeep|room-keep/.test(l));
  assert.equal(rolled.length, 1, 'one line in the rolled cards makes the instance');
  assert.ok(/ev\.stopPropagation\(\); kp\.tap\(kb\); return; \}/.test(read('app/gm/room-rolled.js')), 'the click goes to tap(), which turns the button on again when Keep did not keep');
  const page = read('app/gm-page.js').split('\n').filter((l) => /function rrInst\(\)/.test(l))[0];
  assert.ok(/cast: function \(\) \{ return S === me && me\.npcsIn/.test(page) && /file: function \(id, d\) \{/.test(page) && /col\.doc\(id\)\.set\(clone\(d\)\)/.test(page), 'the page gives the host cast() and file(), the same db adapter fileNpc writes through');
});

for (const [name, fn] of tests) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
