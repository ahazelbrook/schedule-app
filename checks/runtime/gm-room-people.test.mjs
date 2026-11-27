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
  assert.equal(rowOf(both, 'p2').replace(/<small class="rv-prole rr-ptag">quick<\/small>/, ''), rowOf(alone, 'p2').replace(/<small class="rv-prole rr-ptag">quick<\/small>/, ''), 'a slot draws the same with its neighbour there or not');
  const fields = ['first', 'family', 'build', 'standout', 'manner', 'goal', 'errand', 'tell', 'look', 'line', 'sex'];
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
  assert.ok(/^Guest · [a-z ]+ · masked$/.test(m.kicker) && /^Guest · [a-z ]+$/.test(plain.kicker) && plain.kicker === 'Guest · ' + plain.manner.toLowerCase(), 'the line under the name: role, manner, masked: ' + m.kicker);
  assert.notEqual(P.portrait(m, CTX), P.portrait(plain, CTX), 'a different picture');
  const asked = []; const page = { masked: (room) => { asked.push(room); return true; } };
  assert.equal(P.card(slot, { npc: NPC, T, K, room: 'Showroom', page }).masked, true, 'the host\'s masked() is asked');
  assert.deepEqual(asked, ['Showroom']);
  assert.equal(P.card(slot, { npc: NPC, T, K, masked: false, page }).masked, false, 'an explicit masked: false beats the host');
  const h = P.html([slot], Object.assign({}, CTX, { masked: true }));
  assert.ok(h.includes('data-masked="true"') && /Guest · [a-z ]+ · masked</.test(h), 'the row says masked');
  ROLES.forEach((role) => { const at = P.card({ role, seed: 9 }, Object.assign({}, CTX, { masked: true })), guest = P.GUESTS.indexOf(role) >= 0; assert.equal(!!at.spec.face.mask, guest, role + ': at a ball only a guest is masked'); assert.equal(at.masked, guest); });
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
  assert.ok((h.match(/<small class="rv-prole rr-ptag">quick<\/small>/g) || []).length === 3, 'each is tagged quick');
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

/* what the look may never say against the figure (the review of RK17: a blond figure "with a bald head", an afro and a shaved head on one card, a woman with a handlebar moustache) */
const FACIAL_RE = /moustache|mustache|beard|goatee|stubble|whisker|chops|o.clock shadow/i, BALD_RE = /bald|shav(e|ed|en)|\bhead\b|afro|buzz cut|quiff|beehive|ponytail|\bbun\b/i, GLASS_RE = /spectacle|glasses|monocle|eye ?patch|goggles|lenses|shades|pince-nez/i;
const WORD_OF = { 'cloth-black': 'black', 'ink-900': 'black', 'cloth-chocolate': 'dark brown', 'cloth-brown': 'brown', 'ink-300': 'grey' };
test('the look agrees with the drawn figure over every role and 60 seeds: its hair is the figure\'s, no baldness or hair word from the tables, no facial hair on a woman or unless drawn, glasses only if worn', () => {
  assert.ok(NPC.hair.some((h) => FACIAL_RE.test(h)) && NPC.hair.some((h) => /afro|buzz/.test(h)) && NPC.standout.some((s) => /shaved head/.test(s)), 'precondition: the fixture tables DO hold a moustache, an afro, a buzz cut and a shaved head to be kept out');
  let n = 0, fem = 0, beards = 0, specs = 0;
  ROLES.forEach((role, ri) => {
    for (let s = 0; s < 60; s++) {
      const seed = (s * 2246822519 + ri * 3266489917 + 11) >>> 0, c = P.card({ id: 'p1', role, seed }, CTX), sp = c.spec, f = sp.face || {};
      n++; if (sp.figure === 'fem') fem++;
      assert.ok(c.look.includes(P.hairWords(sp)) && P.hairWords(sp), role + ' ' + seed + ': the look holds the figure\'s own hair: ' + c.look);
      const colour = WORD_OF[sp.hair && sp.hair.color]; if (colour && !(sp.hair && sp.hair.grey)) { specs++; assert.ok(P.hairWords(sp).startsWith(colour + ' hair'), role + ' ' + seed + ': ' + sp.hair.color + ' reads ' + colour + ': ' + P.hairWords(sp)); }
      assert.ok(c.look.startsWith(c.build + ', with ' + P.hairWords(sp)) && c.hair === P.hairWords(sp), role + ' ' + seed + ': the hair in the look is the figure hair, not a line of the npc table: ' + c.look);
      assert.ok(!/shaved head|\bbald\b/i.test(c.look), role + ' ' + seed + ': nothing bald or shaved against a figure with hair: ' + c.look);
      assert.ok(!BALD_RE.test(c.standout) && !FACIAL_RE.test(c.standout), role + ' ' + seed + ': the standout says nothing about the head or a beard: ' + c.standout);
      if (sp.figure === 'fem') assert.ok(!FACIAL_RE.test(c.look) && !f.facialHair, role + ' ' + seed + ': no facial hair on a woman: ' + c.look);
      else if (f.facialHair) { beards++; assert.ok(FACIAL_RE.test(c.look), role + ' ' + seed + ': the beard drawn is in the words: ' + c.look); }
      if (!f.facialHair) assert.ok(!FACIAL_RE.test(c.look), role + ' ' + seed + ': no facial hair in the words that the figure lacks: ' + c.look);
      if (!f.eyewear) assert.ok(!GLASS_RE.test(c.standout), role + ' ' + seed + ': no glasses in the words that the figure lacks: ' + c.standout);
      assert.ok(c.standout === '' || NPC.standout.includes(c.standout), 'a standout is still the table\'s own');
    }
  });
  assert.ok(n > 2000 && fem > 300 && beards > 100 && specs > 300, 'enough of each: ' + JSON.stringify({ n, fem, beards, specs }));
  const none = P.card({ id: 'p1', role: 'waiter', seed: 5 }, Object.assign({}, CTX, { K: null }));
  assert.ok(none.hair === '' && !BALD_RE.test(none.standout) && !FACIAL_RE.test(none.look), 'with no kit there is no figure to read, and no hair word comes from the tables either');
  assert.deepEqual(P.card({ role: 'waiter', seed: 5 }, CTX), P.card({ role: 'waiter', seed: 5 }, CTX), 'still the same person every time');
  const old = P.card({ role: 'waiter', seed: 5 }, CTX), other = P.card({ role: 'waiter', seed: 6 }, CTX);
  assert.ok(old.name !== other.name || old.look !== other.look, 'and another seed another person');
});

test('two people of one role in a room never speak the same line or wear the same clothes (while the role has enough), the same way every time; their order never matters to a person alone', () => {
  const T3 = clone(T); T3.roles.waiter.lines = ['Line one.', 'Line two.', 'Line three.']; T3.roles.waiter.looks = ['Jacket one.', 'Jacket two.'];
  const ctx = Object.assign({}, CTX, { T: T3 });
  let same = 0, pairs = 0;
  for (let s = 0; s < 120; s++) {
    const slots = [{ role: 'waiter', seed: s * 7 + 1 }, { role: 'cleaner', seed: s * 7 + 2 }, { role: 'waiter', seed: s * 7 + 3 }, { role: 'waiter', seed: s * 7 + 4 }];
    const a = P.cards(slots, ctx), b = P.cards(slots, ctx), w = a.filter((c) => c.role === 'waiter');
    assert.deepEqual(a.map(without), b.map(without), 'deterministic');
    assert.deepEqual(a.map((c) => c.id), ['p1', 'p2', 'p3', 'p4'], 'ids by place');
    assert.equal(new Set(w.map((c) => c.line)).size, 3, 'three waiters, three lines: ' + w.map((c) => c.line).join(' | '));
    assert.ok(new Set(w.slice(0, 2).map((c) => c.wearing)).size === 2, 'two waiters, two jackets');
    assert.ok(T3.roles.waiter.lines.includes(w[0].line), 'the first person keeps the line the slot alone gives');
    assert.equal(w[0].line, P.card(slots[0], ctx).line, 'the first person is the same as the person alone');
    pairs++; if (P.card(slots[0], ctx).line === P.card(slots[2], ctx).line) same++;
  }
  assert.ok(same > 10, 'the fixture does give two waiters the same line when alone (' + same + ' of ' + pairs + '), so the test proves something');
  const h = P.html([{ role: 'waiter', seed: 3 }, { role: 'waiter', seed: 3 }], ctx), said = h.match(/rr-pline">[^<]+/g);
  assert.ok(said.length === 2 && said[0] !== said[1], 'two waiters of one seed even: two lines in the markup');
  const one = P.cards([{ role: 'cleaner', seed: 9 }, { role: 'waiter', seed: 9 }], ctx), other = P.cards([{ role: 'waiter', seed: 9 }], ctx);
  assert.equal(one[1].line, other[0].line, 'a waiter next to a cleaner is unaffected');
});

test('at a ball only the guests are masked: guest-f, guest-m and the noble, never a waiter, guard or cleaner; the staff are the same person unmasked', () => {
  assert.deepEqual(P.GUESTS.slice().sort(), ['guest-f', 'guest-m', 'noble']);
  assert.ok(P.GUESTS.every((g) => ROLES.includes(g)), 'all three are kit roles');
  ['waiter', 'guard', 'cleaner', 'barkeep', 'croupier', 'photographer', 'servant', 'usher', 'dancer', 'punter'].forEach((role) => {
    const at = P.card({ role, seed: 21 }, Object.assign({}, CTX, { masked: true })), no = P.card({ role, seed: 21 }, CTX);
    assert.ok(at.masked === false && !(at.spec.face && at.spec.face.mask), role + ' is not masked at a ball');
    assert.deepEqual(at.spec, no.spec, role + ': the same figure as with no ball');
    assert.ok(!/masked/.test(at.kicker), role + ': the card does not say masked');
  });
  P.GUESTS.forEach((role) => { const at = P.card({ role, seed: 21 }, Object.assign({}, CTX, { masked: true })); assert.ok(at.masked && at.spec.face.mask && /masked$/.test(at.kicker), role + ' is masked'); });
  const viaHost = P.card({ role: 'waiter', seed: 4 }, { npc: NPC, T, K, page: { masked: () => true } }), guest = P.card({ role: 'guest-m', seed: 4 }, { npc: NPC, T, K, page: { masked: () => true } });
  assert.ok(!viaHost.masked && guest.masked, 'the host says it is a ball: the guest is masked, the waiter is not');
});

test('the picture memo: it holds 48 pictures (three sites of 16), the name is in its key (a pack pushed again with other names draws again), and the figures keep their own memo', () => {
  let calls = 0; const K2 = Object.assign({}, K, { portrait: (spec, o) => { calls++; return K.portrait(spec, o); } });
  const ctx = Object.assign({}, CTX, { K: K2, roomKey: 'rk17-cap#1' }), slots = [];
  for (let i = 0; i < 44; i++) slots.push({ id: 'p' + i, role: ROLES[i % ROLES.length], seed: 5000 + i });
  const cs = slots.map((s) => P.card(s, ctx));
  cs.forEach((c) => P.portrait(c, ctx)); assert.equal(calls, 44);
  cs.forEach((c) => P.portrait(c, ctx)); assert.equal(calls, 44, 'a second pass over 44 people makes no picture again (the cap is 48)');
  const renamed = clone(NPC); renamed.family = ['Renamedfamily'];
  const c1 = P.card(slots[0], Object.assign({}, ctx, { npc: renamed }));
  assert.notEqual(c1.name, cs[0].name);
  const svg0 = P.portrait(cs[0], ctx), svg1 = P.portrait(c1, Object.assign({}, ctx, { npc: renamed }));
  assert.equal(calls, 45, 'the same person under a new name is drawn again');
  assert.ok(svg0.includes('<title>' + cs[0].name + '</title>') && svg1.includes('<title>' + c1.name + '</title>') && svg0 !== svg1, 'and its title is the new name');
  for (let i = 44; i < 260; i++) P.portrait(P.card({ id: 'p' + i, role: 'waiter', seed: 9000 + i }, ctx), ctx);
  const before = calls; P.portrait(cs[1], ctx); assert.equal(calls, before + 1, 'past 48 the oldest go first');
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
  assert.ok(/P\.items\(c\.people/.test(room) && /var h = slotItems\(c,/.test(room), 'room-rolled draws the people through slotItems, which hands the slots to B68GmRoomPeople.items');
  assert.ok(!/RoomPeople|room-people|quick-draw/.test(spot), 'spotlight.js is untouched');
  const rr = page.split('\n').filter((l) => /function rrInst\(\)/.test(l));
  assert.equal(rr.length, 1);
  assert.ok(/npc: function \(\) \{ var b = S === me \? part\('npc'\) : null;/.test(rr[0]) && /masked: function \(\) \{ var rs = S === me \? runSite\(\) : null;/.test(rr[0]), 'the page gives the host npc() and masked(), on rrInst\'s own line');
  assert.ok(!/RoomPeople/.test(page.replace(/\/\*[\s\S]*?\*\//g, '')), 'and names the module nowhere else in code');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
