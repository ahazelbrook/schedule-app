// gm-room-people (RK17 of the room key build, with RK18 folded in; setting room.tables): app/gm/room-people.js, the quick-draw people of a room and their figure.
// INVENTED data only: the npc part of checks/runtime/fixtures/gm/npc-pack.json (invented names, looks, tells), the rooms part of fixtures/gm/rooms-pack.json (the
// Pelican bar's waiter and cleaner) and slots made up here. What it checks: the same slot gives the same person; every role of the figure kit is handled (a role with no
// roles entry, an unknown role, no npc part and no kit give a plain card, never an error); the figure is drawn first and the name matches its sex; each field is its own
// stream (a table changing moves no other field; no slot reads another; a hand-written thing never moves a person); masked; the markup (its hooks, its escaping, its
// portraits); and that nothing here is sent, stored or filed. The browser half is room-tables.e2e.mjs. No browser, no network.
//   node checks/runtime/gm-room-people.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/room-people.js';
const P = require(path.join(ROOT, FILE));
const K = require(path.join(ROOT, 'app', 'figures', 'figure-kit.js'));
const RL = require(path.join(ROOT, 'app', 'gm', 'room-roll.js'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NPC = JSON.parse(read('checks/runtime/fixtures/gm/npc-pack.json')).parts.npc.T;
const T = JSON.parse(read('checks/runtime/fixtures/gm/rooms-pack.json')).T;
const clone = (v) => JSON.parse(JSON.stringify(v));
const CTX = { npc: NPC, T, K, roomKey: 'pelican bar#1' };
const ROLES = K.roles().map((r) => r.id);

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const without = (c) => Object.assign({}, c, { spec: undefined });

test('gm-room-people: the module loads under Node, and as a plain script it defines window.B68GmRoomPeople (no stub) that makes a plain card with no tables and no kit', () => {
  assert.equal(typeof P.card, 'function');
  assert.equal(typeof P.html, 'function');
  assert.ok(!P.stub, 'filled, no longer a stub');
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(read(FILE), win, { filename: FILE });
  const M = win.B68GmRoomPeople;
  assert.ok(M && typeof M.card === 'function' && !M.stub, 'B68GmRoomPeople is defined');
  const c = M.card({ id: 'p1', role: 'waiter', seed: 7 }, {});
  assert.ok(c && c.role === 'waiter' && c.name === '' && c.spec === null && c.plain === true, 'no npc part, no kit, no roles part: a plain card, no error');
  assert.equal(M.html([{ role: 'waiter', seed: 7 }], {}).includes('data-role="waiter"'), true);
  assert.equal(M.html([], {}), '', 'no slot: nothing (the caller\'s own list says Nobody drawn.)');
  assert.equal(M.card(null, {}), null);
  assert.equal(M.card({ role: '', seed: 1 }, {}), null);
});

test('the same slot gives the same person: every field, the figure and the picture, across calls and a fresh copy of the tables', () => {
  const slot = { id: 'p1', role: 'waiter', seed: 123456789 };
  const a = P.card(slot, CTX), b = P.card(slot, CTX), c = P.card(slot, Object.assign({}, CTX, { npc: clone(NPC), T: clone(T) }));
  assert.deepEqual(a, b);
  assert.deepEqual(a, c);
  assert.ok(a.name && a.look && a.want && a.tell && a.line && a.spec, 'a name, a look, a want, a tell, a line and a figure: ' + JSON.stringify(without(a)));
  assert.equal(P.portrait(a, CTX), P.portrait(b, CTX));
  assert.ok(P.portrait(a, CTX).startsWith('<svg'), 'a portrait');
  const d = P.card({ id: 'p1', role: 'waiter', seed: 123456790 }, CTX);
  assert.notDeepEqual(without(a), without(d), 'another seed, another person');
  assert.ok(P.card(slot, CTX).line === T.roles.waiter.lines.find((l) => l === a.line) && T.roles.waiter.looks.some((l) => a.wearing === l), 'the line and the clothes are the role\'s own (the rooms part)');
  assert.ok(a.face === T.roles.waiter.face && a.pose === T.roles.waiter.pose, 'the role\'s face and pose are carried for Keep');
});

test('every role of the figure kit is handled: a card with a figure and a name, with or without a roles entry; an unknown role is drawn as a resident, never an error', () => {
  assert.ok(ROLES.length >= 39, 'the kit lists ' + ROLES.length + ' roles (the brief says 40; this walks the kit\'s own roles())');
  const withEntries = clone(T); ROLES.forEach((r) => { withEntries.roles[r] = withEntries.roles[r] || { lines: ['One line for ' + r + '.', 'Another.', 'A third.'], looks: ['A look for ' + r + '.', 'Another look.'], pose: 'A pose.', face: 'A face.' }; });
  ROLES.concat(['nobody', 'zz-not-a-role', 'Waiter ']).forEach((role, i) => {
    [CTX, Object.assign({}, CTX, { T: withEntries }), Object.assign({}, CTX, { T: { roles: {} } }), Object.assign({}, CTX, { T: null })].forEach((ctx, k) => {
      const slot = { id: 'p' + (i + 1), role, seed: 1000 + i * 7 };
      const c = P.card(slot, ctx);
      assert.ok(c && c.name && c.spec && (c.sex === 'fem' || c.sex === 'masc'), role + ': a card with a name and a figure');
      assert.equal(c.spec.figure === 'fem', c.sex === 'fem', role + ': the card\'s sex is the figure\'s');
      if (k === 1 && withEntries.roles[role.trim()]) assert.ok(c.plain === false && c.line && c.wearing && c.look.includes(c.wearing.replace(/\.$/, '')), role + ': with an entry, its line and clothes');
      if (k >= 2 || (k === 0 && !(role in T.roles))) assert.ok(c.plain === true && c.line === '' && c.wearing === '' && c.face === '', role + ': no entry is a plain card (no line, no clothes) and still has a name, a look, a want and a tell: ' + JSON.stringify(without(c)));
      assert.ok(c.look && c.want && c.tell, role + ': a look, a want, a tell');
      const h = P.html([slot], ctx);
      assert.ok(h.startsWith('<ul class="rv-ppl rr-ppl">') && h.includes('data-role="' + role.trim() + '"') && h.includes('<svg'), role + ': markup with its hooks and a portrait');
    });
  });
  const kitLabels = K.roles().map((r) => r.label);
  assert.ok(kitLabels.every((l) => P.card({ role: ROLES[kitLabels.indexOf(l)], seed: 3 }, CTX).label === l), 'the role\'s label is the kit\'s');
  assert.equal(P.card({ role: 'zz-not-a-role', seed: 3 }, CTX).label, 'Zz not a role', 'an unknown role keeps its own words as the label');
});

test('the figure is drawn first and the name matches its sex: fem figures take nameFem, masc take nameMasc, both seen, the kit\'s own pick (extra) is what the card uses', () => {
  const fem = new Set(NPC.nameFem), masc = new Set(NPC.nameMasc);
  assert.ok(NPC.nameFem.every((n) => !masc.has(n)) && NPC.nameMasc.every((n) => !fem.has(n)), 'precondition: the two name lists share no name');
  const seen = { fem: 0, masc: 0 };
  ROLES.concat(['waiter', 'cleaner']).forEach((role, i) => {
    for (let s = 0; s < 14; s++) {
      const seed = (s * 2654435761 + i * 97) >>> 0, c = P.card({ id: 'p1', role, seed }, CTX), sp = K.extra({ role, seed });
      assert.equal(c.spec.figure, sp.figure, role + ' ' + seed + ': the card\'s figure is the kit\'s extra() for that slot');
      assert.equal(c.sex, sp.figure === 'fem' ? 'fem' : 'masc');
      assert.ok(c.sex === 'fem' ? fem.has(c.first) && !masc.has(c.first) : masc.has(c.first) && !fem.has(c.first), role + ' ' + seed + ': ' + c.first + ' is a ' + c.sex + ' name');
      assert.ok(NPC.family.includes(c.family) && c.name === c.first + ' ' + c.family);
      seen[c.sex]++;
    }
  });
  assert.ok(seen.fem > 20 && seen.masc > 20, 'both sexes drawn: ' + JSON.stringify(seen));
  assert.equal(P.card({ role: 'waiter', seed: 5 }, CTX).spec.name, P.card({ role: 'waiter', seed: 5 }, CTX).name, 'the spec carries the person\'s name (for Keep)');
  const c = P.card({ id: 'p1', role: 'waiter', seed: 5 }, CTX), plainSpec = K.extra({ role: 'waiter', seed: 5 });
  assert.deepEqual(Object.assign({}, c.spec, { name: plainSpec.name }), plainSpec, 'the spec is the kit\'s own, but for the name');
});

test('stream independence: each field is its own fork of the slot, so a table changing moves no other field, no slot reads another, and the seed is all a slot is', () => {
  const slot = { id: 'p1', role: 'waiter', seed: 987654321 }, base = P.card(slot, CTX);
  const more = clone(NPC); more.goal.push('A seventh goal'); more.goal.push('An eighth goal');
  const a = P.card(slot, Object.assign({}, CTX, { npc: more }));
  ['first', 'family', 'name', 'build', 'hair', 'standout', 'manner', 'errand', 'tell', 'line', 'wearing', 'sex'].forEach((k) => assert.equal(a[k], base[k], 'a longer goal table does not move ' + k));
  assert.deepEqual(a.spec, base.spec, 'nor the figure');
  const lines = clone(T); lines.roles.waiter.lines.push('Extra line.'); lines.roles.waiter.looks.push('Extra look.');
  const b = P.card(slot, Object.assign({}, CTX, { T: lines }));
  ['name', 'build', 'hair', 'standout', 'manner', 'goal', 'errand', 'tell'].forEach((k) => assert.equal(b[k], base[k], 'a longer roles entry does not move ' + k));
  const s1 = { id: 'p1', role: 'cleaner', seed: 11 }, s2 = { id: 'p2', role: 'waiter', seed: 22 };
  const both = P.html([s1, s2], CTX), alone = P.html([{ id: 'p2', role: 'waiter', seed: 22 }], CTX);
  const rowOf = (h, id) => h.split('<li ').filter((x) => x.includes('data-rr-slot="' + id + '"'))[0];
  assert.equal(rowOf(both, 'p2').replace(/<small class="rv-dim">quick<\/small>/, ''), rowOf(alone, 'p2').replace(/<small class="rv-dim">quick<\/small>/, ''), 'a slot draws the same with its neighbour there or not');
  const fields = ['first', 'family', 'build', 'hair', 'standout', 'manner', 'goal', 'errand', 'tell', 'look', 'line', 'sex'];
  assert.deepEqual(P.FIELDS.slice().sort(), fields.sort(), 'the forks are named');
  assert.notEqual(P.rng(5, 'waiter', 'first')(), P.rng(5, 'waiter', 'family')(), 'two fields of one slot are two streams');
  assert.equal(P.rng(5, 'waiter', 'first')(), P.rng(5, 'waiter', 'first')(), 'a stream replays');
});

test('hand-written things never shift the people: room-roll\'s slots, and so the cards, are the same with a note\'s things and without', () => {
  const table = T.rooms['pelican bar'], hand = [{ name: 'A ledger on the bar', line: 'Open at today.', look: 'GM-ONLY-look', tags: ['clue'] }, { name: 'A bell', look: 'GM-ONLY-look', tags: [] }];
  const none = RL.roll(table, RL.key('rk-test', 'pelican bar#1'), {}), noted = RL.roll(table, RL.key('rk-test', 'pelican bar#1'), { hand });
  assert.ok(none.people.length >= 1, 'the public band draws someone: ' + JSON.stringify(none.people));
  assert.deepEqual(none.people, noted.people, 'room-roll: the slots do not move');
  assert.deepEqual(none.people.map((p, i) => without(P.card(Object.assign({ id: 'p' + (i + 1) }, p), CTX))), noted.people.map((p, i) => without(P.card(Object.assign({ id: 'p' + (i + 1) }, p), CTX))), 'nor do the cards');
  const rr = RL.roll(table, RL.key('rk-test', 'pelican bar#1'), { rr: 3 });
  assert.deepEqual(rr.people, none.people, 'nor does Reroll the room');
});

test('masked: the figure wears the kit\'s mask, the card says so, and it comes from the host\'s masked() or ctx.masked, never from the tables', () => {
  const slot = { id: 'p1', role: 'guest-f', seed: 31 }, plain = P.card(slot, CTX), m = P.card(slot, Object.assign({}, CTX, { masked: true }));
  assert.equal(plain.masked, false);
  assert.ok(!(plain.spec.face && plain.spec.face.mask), 'unmasked: no mask');
  assert.equal(m.masked, true);
  assert.ok(m.spec.face && m.spec.face.mask && m.spec.face.mask.type, 'masked: the kit\'s mask on the face: ' + JSON.stringify(m.spec.face && m.spec.face.mask));
  assert.equal(m.name, plain.name, 'the person is the same one, masked');
  assert.notEqual(P.portrait(m, CTX), P.portrait(plain, CTX), 'a different picture');
  const asked = []; const page = { masked: (room) => { asked.push(room); return true; } };
  assert.equal(P.card(slot, { npc: NPC, T, K, room: 'Showroom', page }).masked, true, 'the host\'s masked() is asked');
  assert.deepEqual(asked, ['Showroom']);
  assert.equal(P.card(slot, { npc: NPC, T, K, masked: false, page }).masked, false, 'an explicit masked: false beats the host');
  const h = P.html([slot], Object.assign({}, CTX, { masked: true }));
  assert.ok(h.includes('data-masked="true"') && /Guest · masked</.test(h), 'the row says masked');
  ROLES.forEach((role) => assert.ok(P.card({ role, seed: 9 }, Object.assign({}, CTX, { masked: true })).spec.face.mask, role + ': every role can be masked'));
  const viaHost = P.card({ id: 'p1', role: 'waiter', seed: 4 }, { page: { npc: () => NPC, T: () => T, masked: () => false } });
  assert.ok(viaHost.name && viaHost.line, 'the host gives the tables (npc(), T()): ' + viaHost.name);
});

test('the markup: the hooks stay, every string is escaped, one portrait a person with its own id, the kit desk adds its class, and a slot with no card is skipped', () => {
  const slots = [{ id: 'p1', role: 'waiter', seed: 1 }, { id: 'p2', role: 'cleaner', seed: 2 }, { role: 'guard', seed: 3 }, { role: '', seed: 4 }, 'nope', null];
  const h = P.html(slots, CTX);
  assert.ok(h.startsWith('<ul class="rv-ppl rr-ppl">') && h.endsWith('</ul>'));
  const lis = h.split('<li ').length - 1;
  assert.equal(lis, 3, 'three people: the bad slots are skipped');
  assert.ok(['p1', 'p2', 'p3'].every((id) => h.includes('data-rr-slot="' + id + '"')), 'ids p1 to p3 (a missing id is p + its place)');
  assert.ok(/data-role="waiter"/.test(h) && /data-role="cleaner"/.test(h) && /data-role="guard"/.test(h));
  assert.equal((h.match(/class="rv-face"/g) || []).length, 3);
  assert.equal((h.match(/<svg/g) || []).length, 3, 'one portrait a person');
  const ids = (h.match(/ id="[^"]+"/g) || []);
  assert.equal(new Set(ids).size, ids.length, 'no two ids alike (' + ids.length + ' ids)');
  assert.ok(!/<svg[^>]*\s(width|height)="/.test(h), 'the root svg has no fixed size');
  assert.ok((h.match(/<small class="rv-dim">quick<\/small>/g) || []).length === 3, 'each is tagged quick');
  assert.ok(P.html([slots[0]], Object.assign({}, CTX, { kit: true })).startsWith('<ul class="rv-ppl rr-ppl krv-ppl">') && P.html([slots[0]], Object.assign({}, CTX, { kit: true })).includes(' krv-p"'), 'the kit desk\'s classes beside the old ones');
  const evil = clone(NPC); evil.family = ['<img src=x onerror=alert(1)>'], evil.tell = ['"><script>x()</script>']; evil.errand = ['a & b'];
  const roles = clone(T); roles.roles.waiter.lines = ['</li><b>x</b>'];
  const e = P.html([{ id: 'p1', role: 'waiter', seed: 1 }], { npc: evil, T: roles, K });
  assert.ok(!/<img|<script|<b>x/.test(e.replace(/<svg[\s\S]*?<\/svg>/g, '')) && e.includes('&lt;img') && e.includes('a &amp; b'), 'hostile table text is escaped');
  const none = P.html([{ id: 'p1', role: 'waiter', seed: 1 }], { T, K: null });
  assert.ok(none.includes('<b>Waiter</b>') && none.includes('rv-ini') && !none.includes('<svg'), 'no npc part and no kit: the role as the name, its initials as the face');
  assert.ok(!/GM-ONLY/.test(h), 'none of a room\'s closer looks, rolls or dangers (the card reads the roles and the npc tables only)');
});

test('portraits are remembered: the same person is made once, and a picture is the kit\'s K.portrait at the lo level', () => {
  let calls = 0; const K2 = Object.assign({}, K, { portrait: (spec, o) => { calls++; assert.equal(o.lod, 'lo'); return K.portrait(spec, o); } });
  const ctx = Object.assign({}, CTX, { K: K2, roomKey: 'rk17-memo#1' }), c = P.card({ id: 'p1', role: 'porter', seed: 777 }, ctx);
  P.portrait(c, ctx); P.portrait(c, ctx); P.html([{ id: 'p1', role: 'porter', seed: 777 }], ctx);
  assert.equal(calls, 1, 'one K.portrait call for one person');
  assert.equal(P.portrait(c, Object.assign({}, ctx, { K: { extra: K.extra } })), '', 'a kit with no portrait() gives no picture, not an error');
  assert.equal(P.portrait(null, ctx), '');
});

test('nothing here is sent, stored or filed: GM-side only, no draw but the forks, no NPC posted, nothing but room-rolled and the page names it', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const files = walk(path.join(ROOT, 'app')).concat(walk(path.join(ROOT, 'functions'))).filter((f) => /\.(js|mjs|html)$/.test(f)).map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
  const hits = files.filter((f) => /B68GmRoomPeople|room-people/.test(read(f)));
  assert.deepEqual(hits.sort(), ['app/gm/room-people.js', 'app/gm/room-rolled.js', 'app/routes.js'].sort(), 'room-rolled, the registrar and this file; no display, phone, player or server file, and not the page itself (it gives room-rolled its host)');
  const src = read(FILE), code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|\.patch\(|\/api\/|npcs|setMark|setSwap|addExtra|setSay|addKept/.test(code), 'it sends, stores, files and writes nothing');
  assert.ok(!/Math\.random|Date\.now|new Date/.test(src), 'every draw is a fork of the slot\'s seed');
  assert.ok(src.split('\n').every((l) => !/(['"])(?:(?!\1).){221,}\1/.test(l)), 'no string literal over 220 characters');
  const room = read('app/gm/room-rolled.js'), page = read('app/gm-page.js'), spot = read('app/gm/spotlight.js');
  assert.ok(/P\.html\(c\.people/.test(room), 'room-rolled hands its slots to B68GmRoomPeople.html');
  assert.ok(!/RoomPeople|room-people|quick-draw/.test(spot), 'spotlight.js is untouched');
  const rr = page.split('\n').filter((l) => /function rrInst\(\)/.test(l));
  assert.equal(rr.length, 1);
  assert.ok(/npc: function \(\) \{ var b = S === me \? part\('npc'\) : null;/.test(rr[0]) && /masked: function \(\) \{ var rs = S === me \? runSite\(\) : null;/.test(rr[0]), 'the page gives the host npc() and masked(), on rrInst\'s own line');
  assert.ok(!/RoomPeople/.test(page.replace(/\/\*[\s\S]*?\*\//g, '')), 'and names the module nowhere else in code');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
