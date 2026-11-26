// gm-room-rolled (RK14 of the room key build, room.tables): app/gm/room-rolled.js, a rolled site's room cards in the Run pane, and its wiring in the GM
// page. INVENTED data only: the rooms part of checks/runtime/fixtures/gm/rooms-pack.json (the Pelican bar and the Pelican cloakroom, GM-ONLY- markers on
// every closer look, roll and danger) and rolls made up here. The model (the read-aloud and the "There's ..." line, four things with their slugs, the
// people slots, If it goes wrong, the exits, twins, "No table for <room>"), the same cards for the same roll and an authored roll with the same room names,
// the overrides read through room-state, the markup (what it holds, what it never holds), the zoom card through the host, and the page's one-line
// branches (runSite() untouched, nothing new while room.tables is off). The browser half is room-tables.e2e.mjs. No browser, no network.
//   node checks/runtime/gm-room-rolled.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/room-rolled.js';
const RR = require(path.join(ROOT, FILE));
const RL = require(path.join(ROOT, 'app', 'gm', 'room-roll.js'));
const RT = require(path.join(ROOT, 'app', 'gm', 'room-things.js'));
const Z = require(path.join(ROOT, 'app', 'gm', 'room-zoom.js'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const T = JSON.parse(read('checks/runtime/fixtures/gm/rooms-pack.json')).T;
const PAGE = read('app/gm-page.js');

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

/* a rolled site (the generator's shape: name, band, detail, connects; skips on the roll), with twins and a room that has no table */
const ROLL = { seed: 424242, name: 'The Pelican Rooms', rooms: [
  { name: 'Pelican bar', band: 'public', detail: 'A low bar.', connects: 'a service stair' },
  { name: 'Pelican cloakroom', band: 'working', detail: 'Coats.' },
  { name: 'Pelican bar', band: 'public', detail: 'A second bar.' },
  { name: 'Zorn quib room', band: 'secure', detail: 'Quib walls and vexa floors.', isTarget: true }],
  skips: [{ from: 'Pelican cloakroom', to: 'Zorn quib room', via: 'a laundry chute' }] };
/* an authored site with the same room names, after authoredRoll: rooms carry only their names */
const AUTH = { auth: 'Pelican Annexe', rooms: [{ name: 'Pelican bar' }, { name: 'Pelican cloakroom' }] };
const HAND = '- **Things:**\n  1. **A ledger on the bar**, open at today.\n     - 🔍 GM-ONLY-look: one page is torn out.\n     - Tags: clue\n';
const SECRET = /GM-ONLY-(look|roll)/;
const tableOf = (name) => T.rooms[name.toLowerCase()];
const attrQ = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

test('gm-room-rolled: loads under Node, and as a plain script defines window.B68GmRoomRolled with nothing else loaded (the others read when called)', () => {
  assert.equal(RR.stub, undefined, 'no longer a stub');
  for (const k of ['create', 'model', 'exitsOf', 'roleLabel', 'cardHtml', 'siteHtml', 'blockHtml', 'NO_TABLE']) assert.equal(typeof RR[k], 'function', k);
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(read(FILE), win, { filename: FILE });
  const M = win.B68GmRoomRolled;
  assert.ok(M && !M.stub && typeof M.create === 'function', 'defined');
  assert.equal(M.model(ROLL, T, { rollKey: 1 }), null, 'no room-roll, room-tables or room-state on the page yet: no model, and no throw');
  const r = M.create({ roll: () => ROLL, rollKey: () => 1 });
  assert.equal(r.draw({}, ''), false, 'nothing to draw: the page draws RUN_HELP as today');
  assert.equal(r.block('Pelican bar'), null);
  assert.equal(r.act(null), false); assert.equal(r.key({ key: '1' }, {}), false);
});

test('a rolled room\'s card: the table\'s say line, "There\'s ..." naming its four things, the things with their slugs, the people slots, If it goes wrong and exits', () => {
  const m = RR.model(ROLL, T, { rollKey: ROLL.seed });
  assert.equal(m.rollKey, '424242'); assert.equal(m.tables, true);
  assert.deepEqual(m.cards.map((c) => [c.name, c.n, c.roomKey]), [['Pelican bar', 1, 'pelican bar#1'], ['Pelican cloakroom', 1, 'pelican cloakroom#1'], ['Pelican bar', 2, 'pelican bar#2'], ['Zorn quib room', 1, 'zorn quib room#1']], 'one card a room, in the roll\'s order; twins told apart by n');
  for (const c of m.cards.filter((x) => x.table)) {
    const t = tableOf(c.name), d = RL.roll(t, RL.key(ROLL.seed, c.roomKey), {});
    assert.equal(c.things.length, 4, c.roomKey + ': 4 things to click');
    assert.deepEqual(c.things.map((x) => x.slug), d.shown.map((x) => x.slug), c.roomKey + ': room-roll\'s draw, in its order');
    assert.deepEqual(c.things.map((x) => x.name), d.things.map((i) => t.things[i].name));
    assert.equal(c.say, t.say[d.say], c.roomKey + ': the say stream\'s line');
    assert.equal(c.there, RL.there(c.things.map((x) => x.name)), 'the app\'s line names the things by name only');
    assert.match(c.there, /^There's .+\.$/);
    assert.deepEqual(c.people, d.people.map((p, k) => ({ id: 'p' + (k + 1), role: p.role, seed: p.seed })), 'the people slots, ids p1, p2');
    assert.deepEqual(c.wrong, c.things.filter((x) => x.danger).map((x) => ({ name: x.name, line: x.danger })), 'If it goes wrong: the things\' danger lines');
  }
  const bar = m.cards[0];
  assert.ok(bar.people.length >= 1 && bar.people.every((p) => p.role && p.role !== 'nobody'), 'a public room draws at least one person, never nobody');
  assert.deepEqual(bar.exits, ['Out via a service stair']);
  assert.deepEqual(m.cards[1].exits, ['A laundry chute to Zorn quib room']);
  assert.deepEqual(m.cards[3].exits, ['A laundry chute from Pelican cloakroom']);
  assert.notDeepEqual(m.cards[0].things.map((x) => x.slug).concat(m.cards[0].say), m.cards[2].things.map((x) => x.slug).concat(m.cards[2].say), 'the twin draws on its own key');
});

test('a room with no table says "No table for <room>" and draws nothing from anywhere else (ruling 6: no theme-item fallback); no rooms part: every room says so', () => {
  const m = RR.model(ROLL, T, { rollKey: ROLL.seed }), z = m.cards[3];
  assert.equal(z.table, false); assert.deepEqual(z.things, []); assert.deepEqual(z.people, []); assert.equal(z.say, ''); assert.equal(z.there, '');
  assert.equal(RR.NO_TABLE('Zorn quib room'), 'No table for Zorn quib room');
  const h = RR.cardHtml(z, {});
  assert.match(h, /No table for Zorn quib room\. Quib walls and vexa floors\./, 'the wording, then the printed line as the Location roller shows it');
  assert.match(h, /★ target/); assert.ok(!/rv-say/.test(h), 'no read-aloud');
  const none = RR.model(ROLL, null, { rollKey: ROLL.seed });
  assert.equal(none.tables, false); assert.ok(none.cards.every((c) => !c.table && !c.things.length));
  assert.match(RR.siteHtml(none, {}), /4 rooms: the pack has no room tables\./);
  const hand = RR.model(ROLL, T, { rollKey: ROLL.seed, hand: (n) => n === 'Zorn quib room' ? RT.parse(HAND) : [] }).cards[3];
  assert.deepEqual(hand.things.map((x) => x.name), ['A ledger on the bar'], 'a note\'s own things still show where there is no table');
  assert.match(RR.cardHtml(hand, {}), /No table for Zorn quib room[\s\S]*There&#39;s a ledger on the bar\./);
});

test('the same roll gives the same cards (a reload); an authored site with the same room names behaves the same (keyed a:<name>)', () => {
  const a = RR.model(ROLL, T, { rollKey: ROLL.seed }), b = RR.model(JSON.parse(JSON.stringify(ROLL)), JSON.parse(JSON.stringify(T)), { rollKey: ROLL.seed });
  assert.deepEqual(a, b, 'pure: nothing but the roll, the tables and the key');
  assert.notDeepEqual(RR.model(ROLL, T, { rollKey: 7 }).cards.map((c) => c.things.map((x) => x.slug)), a.cards.map((c) => c.things.map((x) => x.slug)), 'another roll, other things');
  const au = RR.model(AUTH, T, { rollKey: 'a:Pelican Annexe' });
  assert.deepEqual(au.cards.map((c) => c.roomKey), ['pelican bar#1', 'pelican cloakroom#1']);
  for (const c of au.cards) {
    assert.ok(c.table && c.say && c.there && c.things.length === 4, c.roomKey + ': a description and 4 things');
    assert.ok(Array.isArray(c.people) && /Who’s here/.test(RR.cardHtml(c, {})), c.roomKey + ': a people slot');
    assert.deepEqual(c.exits, [], 'an authored room has no generated exits: the row is left out');
  }
  assert.ok(au.cards[0].people.length >= 1, 'the bar (public) draws someone');
  assert.equal(au.cards[0].band, '', 'every generated field optional'); assert.ok(!/class="rv-rmk/.test(RR.cardHtml(au.cards[1], {})), 'no band: no eyebrow');
});

test('overrides come through room-state\'s read (say, rr, extra, swaps); a mark never moves the draw; the note\'s things come first', () => {
  const base = RR.model(ROLL, T, { rollKey: ROLL.seed }).cards[0], t = tableOf('Pelican bar');
  const other = base.say === t.say[0] ? 1 : 0, seen = [];
  const st = (rk, key) => { seen.push([rk, key]); return key === 'pelican bar#1' ? { say: other, marks: { [base.things[0].slug]: 'taken' } } : null; };
  const m = RR.model(ROLL, T, { rollKey: ROLL.seed, state: st }).cards[0];
  assert.equal(m.say, t.say[other], 'a stored say pick'); assert.deepEqual(m.things, base.things, 'a mark changes nothing drawn');
  assert.ok(seen.some(([rk, k]) => String(rk) === '424242' && k === 'pelican bar#1'), 'read with the page\'s rollKey and the roomKey');
  const extra = RL.another(t, RL.key(ROLL.seed, 'pelican bar#1'), {});
  const sw = RL.swap(t, RL.key(ROLL.seed, 'pelican bar#1'), {}, 0);
  const ex = RR.model(ROLL, T, { rollKey: ROLL.seed, state: (rk, k) => k === 'pelican bar#1' ? { extra: [extra] } : null }).cards[0];
  assert.equal(ex.things.length, 5); assert.equal(ex.things[4].slug, extra, 'Roll another adds at the end');
  const ov = RR.model(ROLL, T, { rollKey: ROLL.seed, state: (rk, k) => k === 'pelican bar#1' ? { swaps: { [sw.slug]: sw.to } } : null }).cards[0];
  assert.equal(ov.things.length, 4); assert.equal(ov.things[0].slug, sw.to, 'a swap replaces its thing in place');
  assert.equal(ov.there, RL.there(ov.things.map((x) => x.name)), 'and the read-aloud names what is there now');
  const rr = RR.model(ROLL, T, { rollKey: ROLL.seed, state: (rk, k) => k === 'pelican bar#1' ? { rr: 1 } : null }).cards[0];
  assert.deepEqual(rr.people, base.people, 'Reroll the room never moves the people');
  const hand = RR.model(ROLL, T, { rollKey: ROLL.seed, hand: (n) => n === 'Pelican bar' ? RT.parse(HAND) : [] }).cards[0];
  assert.equal(hand.things[0].name, 'A ledger on the bar'); assert.equal(hand.things.length, 4, 'one note thing, topped up to 4 from the table');
  assert.deepEqual(hand.people, base.people, 'hand-written things never shift the people');
});

test('the markup: one card a room (rv-rm, data-room, twins data-rn), the read-aloud, Who\'s here slots, danger as text with no send button, no closer look or roll', () => {
  const m = RR.model(ROLL, T, { rollKey: ROLL.seed });
  const h = RR.siteHtml(m, { line: '<p class="rv-siteline">LINE</p>', title: 'The Pelican Rooms', things: (c) => '<div class="THINGS" data-for="' + c.roomKey + '"></div>' });
  assert.ok(h.startsWith('<div class="rr-site" data-rr-site="424242"><p class="rv-siteline">LINE</p><h3 class="rv-sh rr-title">The Pelican Rooms</h3>'), h.slice(0, 160));
  assert.match(h, /4 rooms, 3 with a table\. Tap a thing for a closer look\./);
  const cards = [...h.matchAll(/<section class="rv-rm rr-rm" data-room="([^"]+)"( data-rn="(\d)")?/g)].map((x) => x[1] + (x[3] ? '#' + x[3] : ''));
  assert.deepEqual(cards, ['Pelican bar', 'Pelican cloakroom', 'Pelican bar#2', 'Zorn quib room']);
  assert.equal((h.match(/<div class="gm-box rr-cell">/g) || []).length, 4); assert.match(h, /<div class="gm-vgrid rr-cards">/);
  for (const c of m.cards.filter((x) => x.table)) {
    assert.ok(h.includes('<div class="rv-say rr-say" data-rr-room="' + c.roomKey + '" data-rr-say><span class="rv-saylab">SAY</span> “' + attrQ(c.say + ' ' + c.there) + '”</div><div class="THINGS" data-for="' + c.roomKey + '"></div>'),
      c.roomKey + ': the read-aloud, then the things list');
  }
  assert.match(h, /<h4 class="rv-lab rr-lab">Who’s here<\/h4><ul class="rv-who rr-ppl"><li class="npc rr-slot" data-rr-slot="p1" data-role="waiter"><b>Waiter<\/b>/);
  assert.match(h, /<li class="rv-dim">Nobody drawn\.<\/li>/, 'an empty draw still has its slot list');
  assert.ok(!SECRET.test(h), 'no closer look and no roll on a card');
  const dangers = m.cards.flatMap((c) => c.wrong.map((w) => w.line));
  assert.ok(dangers.length > 0, 'the fixture draws a danger');
  for (const d of dangers) assert.ok(h.includes('<span class="rv-wrongt">' + attrQ(d) + '</span></p>'), 'a danger line shows as text');
  assert.ok(!/data-site="threat"/.test(h), 'a danger line is Secret: no "→ the Roll" (the Roll\'s line is stamped on the iPad)');
  const note = RR.cardHtml(m.cards[0], { wrong: () => ['They call the house'], note: () => '<p>NOTE</p>' });
  assert.match(note, /<p class="rr-wnote"><span class="rv-wrongt">They call the house<\/span> [\s\S]*?data-gm="site"[\s\S]*?data-site="threat"[\s\S]*?→ the Roll/, 'the note\'s own lines keep → the Roll, as on the Run view\'s card');
  assert.match(note, /<div class="rv-rmnote pp-doc pp-cardbody rr-note"><p>NOTE<\/p><\/div><\/section>/);
  const esc = RR.cardHtml(Object.assign({}, m.cards[3], { name: 'A <b> & "c"' }), {});
  assert.ok(esc.includes('data-room="A &lt;b&gt; &amp; &quot;c&quot;"') && !esc.includes('<b> &'), 'names are text');
});

test('the kit desk: the same cards with the kit\'s classes beside the old ones; a v2 card\'s block labels its people Quick-draw people', () => {
  const m = RR.model(ROLL, T, { rollKey: ROLL.seed }), h = RR.cardHtml(m.cards[0], { kit: true });
  assert.match(h, /<section class="rv-rm rr-rm krv-rm" data-room="Pelican bar"/);
  assert.match(h, /<p class="rv-rmk rr-eye krv-eyebrow">Public<\/p><h3 class="rv-sh rr-name krv-rmt">Pelican bar<\/h3>/);
  assert.match(h, /<h4 class="krv-lab rr-lab">Who’s here<\/h4><ul class="rv-who rr-ppl krv-ppl">/);
  const blk = RR.blockHtml(m.cards[0], { run: true });
  assert.match(blk, /<h4 class="rv-lab rr-lab">Quick-draw people<\/h4>/, 'beside the play\'s own Who\'s here');
  assert.ok(!/<section|<h3/.test(blk), 'a block is the parts only: the Run view\'s card keeps its own heading');
});

test('create(host): the zoom card is the page\'s (RK09\'s, made through host.zoom with things and where); block() and act() for this roll only', () => {
  let made = 0;
  const host = { roll: () => ROLL, rollKey: (r) => r.seed, T: () => T, doc: () => ({}), redraw: () => {},
    zoom: (h) => { made++; return Z.create(h); }, md: (room) => room === 'Pelican cloakroom' ? HAND : '' };
  const r = RR.create(host);
  const b = r.block('Pelican bar'), bar = r.model().cards[0];
  assert.equal(made, 1, 'made once');
  assert.deepEqual([...b.matchAll(/data-thing="([^"]+)"/g)].map((x) => x[1]), bar.things.map((x) => x.slug), 'the zoom card\'s list of the rolled room\'s things');
  assert.deepEqual([...b.matchAll(/data-ui-key="(\d)"/g)].map((x) => x[1]), ['1', '2', '3', '4'], 'keys 1 to 4');
  assert.equal(r.model().cards[1].things[0].name, 'A ledger on the bar', 'the note\'s things, through host.md');
  assert.equal(r.block('Nowhere'), null, 'a room the roll has not: null (the Run view draws RK09\'s, as before)');
  const el = (room, slug) => ({ getAttribute: (k) => ({ 'data-room': room, 'data-thing': slug })[k] || null });
  assert.equal(r.act(el('Nowhere', 'x')), false, 'another roll\'s thing is not this file\'s');
  assert.equal(r.act(el('Pelican bar', bar.things[0].slug)), true, 'this roll\'s thing: its zoom card is asked (no DOM here, so nothing opens)');
  assert.equal(r.isOpen(), false); assert.equal(made, 1);
  r.destroy();
});

test('the page: one-line branches only, each a no-op with room.tables off; runSite() and the phones\' mission untouched', () => {
  assert.match(PAGE, /function rrInst\(\) \{ var M = W\.B68GmRoomRolled, me = S; if \(!me \|\| !M \|\| M\.stub \|\| typeof M\.create !== 'function'\) return null; if \(!b09On\('room\.tables'\)\) \{ if \(me\.rr\) \{ me\.rr\.destroy\(\); me\.rr = null; \} return null; \}/, 'rrInst: null while room.tables is off, and turned off live the instance is destroyed (its zoom card and its Run pane listener go)');
  const at = PAGE.indexOf('  function renderRun() {'), rr = PAGE.slice(at, PAGE.indexOf('\n  }\n', at));
  const br = rr.indexOf('var rr = rrInst(); if (rr && rr.draw(box, ln)) return;'), help = rr.indexOf('box.innerHTML = ln + RUN_HELP;');
  assert.ok(br > rr.indexOf('if (!rs) {') && br > rr.indexOf('var ln = siteLine();') && br < help, 'the cards in the no-v2-night branch, before RUN_HELP');
  const rs = PAGE.slice(PAGE.indexOf('  function runSite() {'), PAGE.indexOf('  function ballDoc(name)'));
  assert.ok(rs.length > 200 && !/rrInst|B68GmRoomRolled|room\.tables|room-rolled/.test(rs), 'runSite() names nothing of this build');
  const ms = PAGE.slice(PAGE.indexOf('  function missionSource() {'), PAGE.indexOf('  function missionSource() {') + 4000);
  assert.ok(!/rrInst|B68GmRoomRolled|room\.tables|B68GmRoomRoll\b/.test(ms), 'the mission never reads a rolled room');
  assert.match(PAGE, /function rrHost\(h\) \{ var was = h\.roomThings; h\.roomThings = function \(room, o\) \{ var rr = rrInst\(\), rb = rr \? rr\.block\(room, o\) : null; return typeof rb === 'string' \? rb : was\(room, o\); \}; return h; \}/);
  assert.match(PAGE, /function rvHost\(\) \{\n    return rrHost\(\{/);
  const k = PAGE.indexOf("if (S.rr && b09On('room.tables') && S.rr.key(ev, { typing: typing(tg), top: escTop() })) return;"), k9 = PAGE.indexOf("if (S.rz && b09On('room.key') && S.rz.key(ev, { typing: typing(tg), top: escTop() })) return;");
  assert.ok(k > 0 && k9 > k, 'a rolled card\'s keys come before RK09\'s (which would take a digit there)');
  assert.match(PAGE, /if \(me\.rr\) \{ try \{ me\.rr\.destroy\(\); \} catch \(e\) \{\} me\.rr = null; \}/, 'the teardown');
  assert.match(PAGE, /if \(W\.B68Map && W\.B68Map\.render\) drawMap\(true\);\n    if \(rrInst\(\)\) showPanel\('run'\);/, 'RK14.3: a new roll goes straight to the site screen, only while room.tables is on');
  assert.match(PAGE, /if \(md && !rz && rrInst\(\) && W\.B68GmRoomZoom\) md = W\.B68GmRoomZoom\.noteMd\(md\);/, 'the note loses its Things block while the card draws them');
  assert.match(PAGE, /if \(S\.status === 'ready' && W\.B68Load && b09On\('room\.tables'\) && !S\.rrWait\)/, 'the bundle is asked for only while room.tables is on');
  assert.match(PAGE, /if \(S\.status === 'ready' && !!S\.rrOn !== !!rrInst\(\)\) \{ S\.rrOn = !!rrInst\(\);/);
  /* the overseer's RK14 rulings: the page's writer for a rolled card's marks (and RK15's Swap), and Show on iPad with room.tables alone */
  const rrLine = PAGE.split('\n').filter((l) => /function rrInst\(\)/.test(l));
  assert.equal(rrLine.length, 1); assert.match(rrLine[0], / rs: function \(\) \{ return S === me \? rsInst\(\) : null; \},/, 'rrInst\'s host: the page\'s room-state writer, null off the live page');
  assert.ok(!/_roomState/.test(rrLine[0]), 'never through the check hook');
  assert.match(PAGE, /function rkShowHost\(\) \{ var me = S; if \(!me \|\| !\(b09On\('room\.key'\) \|\| b09On\('room\.tables'\)\)\) return null;/, 'Show\'s host: null only while both settings are off');
});

test('destroy() takes its capture listener off the Run pane (room.tables turned off live), so an RK09 thing never reaches a rolled zoom card', () => {
  const calls = [], box = { addEventListener: (t, f, c) => calls.push(['add', t, f, c]), removeEventListener: (t, f, c) => calls.push(['remove', t, f, c]) };
  const r = RR.create({ roll: () => ROLL, rollKey: (x) => x.seed, T: () => T, doc: () => ({}), zoom: (h) => Z.create(h), box: () => box });
  r.block('Pelican bar'); r.block('Pelican cloakroom');
  assert.equal(calls.length, 1, 'one listener on the pane, however many cards'); assert.deepEqual([calls[0][0], calls[0][1], calls[0][3]], ['add', 'click', true], 'a capture click listener');
  r.destroy();
  assert.equal(calls.length, 2); assert.deepEqual([calls[1][0], calls[1][1], calls[1][3]], ['remove', 'click', true]); assert.equal(calls[1][2], calls[0][2], 'the same listener comes off');
  assert.equal(r.isOpen(), false);
});

test('marks are keyed by the rolled room\'s own roomKey: same-named rooms each read their own, and the zoom card\'s place is that key', () => {
  const store = { 'pelican bar#2': {} };
  const bar = RR.model(ROLL, T, { rollKey: ROLL.seed }).cards[2];
  store['pelican bar#2'][bar.things[0].slug] = 'open';
  const rs = { read: (rk, rm) => (String(rk) === '424242' ? { marks: store[rm] || {} } : {}), setMark: () => true };
  const r = RR.create({ roll: () => ROLL, rollKey: (x) => x.seed, T: () => T, doc: () => ({}), rs: () => rs, zoom: (h) => Z.create(h) });
  const one = r.zoom().html('Pelican bar', { n: 1 }), two = r.zoom().html('Pelican bar', { n: 2 });
  assert.ok(!/rk-tstate/.test(one), 'the first Pelican bar has no mark');
  assert.match(two, new RegExp('data-thing="' + bar.things[0].slug + '"[^>]*data-rn="2"[\\s\\S]*?<span class="rk-tstate">open</span>'), 'the second one reads its own (pelican bar#2), and its buttons say which room they are');
  r.destroy();
});

test('rolled rooms stay GM-side: no display, phone, player or server file names this file; it sends, stores and writes nothing', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const files = walk(path.join(ROOT, 'app')).concat(walk(path.join(ROOT, 'functions'))).filter((f) => /\.(js|mjs|html)$/.test(f)).map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
  const hits = files.filter((f) => /B68GmRoomRolled|room-rolled/.test(read(f)));
  assert.deepEqual(hits.sort(), ['app/gm-page.js', 'app/gm/room-rolled.js', 'app/routes.js'].sort());
  const src = read(FILE), code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|\.patch\(|setMark|setSwap|addExtra|setSay/.test(code), 'it sends, stores and writes nothing');
  assert.ok(!/Math\.random/.test(src), 'every draw is room-roll\'s seeded streams');
  assert.ok(src.split('\n').every((l) => !/(['"])(?:(?!\1).){221,}\1/.test(l)), 'no string literal over 220 characters');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
