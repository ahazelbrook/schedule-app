// display-room-intro (RK29 of the room key build, setting room.intro): the iPad's half of the room opening. No browser, no network.
//   the Pure part of app/display/room-intro.js, as the NPC card's tests do: the shared clock (position), when a card plays (wants, clean,
//   startable, with the late window ending at the hand-over), the kicker tapes, the name list ("and N more"), the colours (the site's own, ink by
//   luminance), the name's size steps (fit, sizes) and the plate's stacking (stack); next() and its timers with a stand-in page; the files and the
//   display page's one-line hooks (attached from the bundle's load callback, fed every push).
// INVENTED data only: the Palazzo Rooms' room names; GM-ONLY- markers.
//   node checks/runtime/display-room-intro.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/display/room-intro.js';
const M = require(path.join(ROOT, FILE));
const P = M.Pure;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const LIB = { id: 'r3', n: 4, name: 'Library', band: 'controlled', floor: 'Upper floor' };
const W = (n, floor) => Array.from({ length: n }, (_, i) => ({ id: 'r' + (i + 1), n: i + 1, name: 'Working room ' + (i + 1), band: 'working', floor: floor || (i % 2 ? 'Basement' : 'Upper floor') }));
const MAP = (arrive) => ({ kind: 'svg', title: 'The Palazzo Rooms', caption: 'surveyed: public', svg: '<svg/>', arrive });

test('the module loads under Node, and as a plain script defines window.B68RoomIntro: no longer a stub', () => {
  assert.ok(M && typeof M.attach === 'function' && !M.stub && P);
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(read(FILE), win, { filename: FILE });
  assert.ok(win.B68RoomIntro && typeof win.B68RoomIntro.attach === 'function');
});
test('the timeline is the preview\'s: the cut, the entrance to 0.7 s, the name from 0.9 s, the hand-over at 4 s, the settle 4.2 s, the fade 4.76 s, the ring 4.9 s, gone at 6.6 s', () => {
  assert.deepEqual(P.T, { enter: 0, freeze: 700, kicker: 900, name: 1000, name2: 1060, more: 1250, out: 4000, settle: 4200, fade: 4760, ring: 4900, end: 6600 });
  assert.equal(P.LEAD_MS, 800); assert.equal(P.STILL_MS, 3000); assert.equal(P.LATE_MS, 4000, 'the late window ends where the hand-over begins');
});
test('one clock: the position is the server time less the push time and the lead, from the display\'s updatedAt and the page\'s skew', () => {
  const at = '2030-01-04T20:10:00.000Z', z = Date.parse(at);
  assert.equal(P.position(at, z + P.LEAD_MS, 0), 0);
  assert.equal(P.position(at, z, 0), -P.LEAD_MS, 'during the lead: negative');
  assert.equal(P.position(at, z + 1000, 2000), 3000 - P.LEAD_MS, 'a page 2 s slow is corrected by its skew');
  assert.equal(P.position('', z, 0), null); assert.equal(P.position('not a time', z, 0), null); assert.equal(P.position(undefined, z, 0), null);
});
test('when a card plays: the setting on, an svg display that carries at least one good arrive entry; a late page (past the hand-over\'s start) shows the map only', () => {
  assert.equal(P.wants(MAP([LIB]), true), true);
  assert.equal(P.wants(MAP([LIB]), false), false, 'off');
  assert.equal(P.wants(MAP(undefined), true), false, 'Show on iPad, a marker push: no arrive');
  assert.equal(P.wants(MAP([]), true), false);
  assert.equal(P.wants(MAP([{ id: 'GM-ONLY-1', name: 'x', band: 'public' }]), true), false, 'junk only');
  assert.equal(P.wants({ kind: 'npc', npcId: 'n-ada', arrive: [LIB] }, true), false, 'not a map');
  assert.equal(P.wants({ kind: 'svg', arrive: [LIB] }, true), false, 'a map with no svg');
  assert.equal(P.startable(-800, false), true, 'in the lead');
  assert.equal(P.startable(3999, false), true); assert.equal(P.startable(4000, false), false, 'the hand-over has begun: no card');
  assert.equal(P.startable(2999, true), true); assert.equal(P.startable(3000, true), false, 'reduced motion: the still frame\'s 3 s');
  assert.equal(P.startable(null, false), false, 'no clock: no card');
});
test('clean: the server\'s rule again (ids r0 to r999, a name of at most 80, one of the four bands, n 1 to 999 or none, a kit floor title or none), at most 8', () => {
  assert.deepEqual(P.clean([LIB]), [LIB]);
  assert.deepEqual(P.clean([{ id: 'r0', name: '  Showroom ', band: 'public' }]), [{ id: 'r0', n: null, name: 'Showroom', band: 'public', floor: '' }]);
  const bad = [null, 7, { ...LIB, id: 'x3' }, { ...LIB, band: 'GM-ONLY' }, { ...LIB, n: 0 }, { ...LIB, n: 2.5 }, { ...LIB, name: '' }];
  assert.deepEqual(P.clean(bad), []);
  assert.equal(P.clean({ ...LIB, floor: 'GM-ONLY-FLOOR' }).length, 0, 'not a list');
  assert.equal(P.clean([{ ...LIB, floor: 'GM-ONLY-FLOOR' }])[0].floor, '', 'a floor not the kit\'s: no floor tape');
  assert.equal(P.clean(W(12)).length, 8);
});
test('the kicker: one room is its band then its floor; several are the band and "N rooms", with the floor when they all share one', () => {
  assert.deepEqual(P.kicker(P.clean([LIB])), ['Controlled', 'Upper floor']);
  assert.deepEqual(P.kicker(P.clean([{ id: 'r1', name: 'Showroom', band: 'public' }])), ['Public'], 'no floor: one tape');
  assert.deepEqual(P.kicker(P.clean(W(4))), ['Working', '4 rooms']);
  assert.deepEqual(P.kicker(P.clean(W(3, 'Basement'))), ['Working', '3 rooms · Basement']);
  assert.deepEqual(P.kicker(P.clean([LIB].concat(W(1, 'Basement')))), ['Controlled · Working', '2 rooms'], 'a room opened and a band ticked at once');
});
test('the names: up to three, then "and N more"', () => {
  assert.deepEqual(P.names(P.clean([LIB])), { lines: ['Library'], more: 0 });
  assert.deepEqual(P.names(P.clean(W(3))).more, 0);
  const n5 = P.names(P.clean(W(5)));
  assert.deepEqual(n5.lines, ['Working room 1', 'Working room 2', 'Working room 3']); assert.equal(n5.more, 2);
});
test('the colours: the field is the site\'s own colour; the name is ink on a mid or pale field and paper on a dark one; the offset copy never vanishes; the ring is the signal orange', () => {
  const red = P.palette('#bf3a2c');
  assert.deepEqual([red.field, red.ink, red.back, red.ring], ['#bf3a2c', '#fbf8f1', '#14110e', '#e0691e'], 'the preview\'s red: paper names over an ink copy, as Alex approved');
  const mid = P.palette('#d6742c');
  assert.equal(mid.ink, '#14110e'); assert.equal(mid.back, '#fbf8f1', 'a lighter orange: ink names over a paper copy');
  const dark = P.palette('#3b3936');
  assert.equal(dark.ink, '#fbf8f1'); assert.equal(dark.back, '#14110e');
  const pale = P.palette('#f3ddd5');
  assert.equal(pale.ink, '#14110e'); assert.ok(pale.back !== '#fbf8f1' && pale.back !== pale.field && P.lum(pale.back) < P.lum(pale.field), 'a pale field: a deeper shade, not paper: ' + pale.back);
  assert.equal(P.palette('GM-ONLY').field, '#e0691e', 'no colour: the signal orange');
  assert.equal(P.colour('#ABC'), '#aabbcc'); assert.equal(P.colour('url(#x)'), null); assert.equal(P.colour('red'), null);
});
test('the name\'s size: the largest step that fits on one line, a single name may then wrap to two; a list is one name a line; never under the minimum', () => {
  const one = P.sizes(1, false), list3 = P.sizes(3, false);
  assert.deepEqual([one.max, one.min, one.wrap], [14, 6, true]);
  assert.deepEqual([list3.max, list3.wrap], [11, false]);
  assert.ok(P.sizes(1, true).max < one.max && P.sizes(3, true).max < list3.max, 'portrait is smaller');
  assert.deepEqual(P.fit(() => ({ fits: true }), one), { size: 14, wrap: false });
  assert.deepEqual(P.fit((s, w) => ({ fits: w }), one), { size: 14, wrap: true }, 'two lines at the top size');
  const r = P.fit((s, w) => ({ fits: !w && s <= 9 }), one); assert.ok(r.size <= 9 && r.size > 8 && !r.wrap, JSON.stringify(r));
  assert.deepEqual(P.fit(() => ({ fits: false }), list3), { size: 3.5, wrap: false }, 'nothing fits: the minimum');
  assert.ok(!P.fit((s, w) => ({ fits: w }), list3).wrap, 'a list never wraps');
});
test('the plate: one piece per room at true scale and left-right place, stacked top to bottom with the empty floors closed up; side by side rooms share a row', () => {
  const st = P.stack([{ x: 0, y: 0, w: 10, h: 10 }, { x: 20, y: 200, w: 10, h: 10 }]);
  assert.equal(st.w, 30); assert.equal(st.h, 21, 'the 190 units of empty floor between them closed to a tenth of the tallest');
  assert.deepEqual(st.at[0], { l: 0, t: 0, fw: 10 / 30, fh: 10 / 21 });
  assert.deepEqual(st.at[1], { l: 20 / 30, t: 11 / 21, fw: 10 / 30, fh: 10 / 21 });
  const row = P.stack([{ x: 0, y: 0, w: 10, h: 10 }, { x: 12, y: 1, w: 10, h: 10 }]);
  assert.equal(row.h, 11, 'one row'); assert.equal(row.at[1].t, 1 / 11);
  const order = P.stack([{ x: 0, y: 100, w: 5, h: 5 }, { x: 0, y: 0, w: 5, h: 5 }]);
  assert.ok(order.at[0].t > order.at[1].t, 'the result is in the order given, placed by height');
  assert.equal(P.stack([]), null);
});
test('next(): another push cuts at once (a pending start too); the same seq drawn again runs on; anything but a map starts nothing; nothing at all while off', () => {
  const timers = new Map(); let id = 0;
  const env = { on: () => true, later: (f, ms) => { timers.set(++id, { f, ms }); return id; }, clearLater: (i) => timers.delete(i), document: {}, at: () => new Date().toISOString(), skew: () => 0, still: () => false, svg: () => null };
  const ri = M.attach({ appendChild() {}, getBoundingClientRect: () => ({ width: 1024, height: 768 }) }, env);
  ri.next(MAP([LIB]), 5);
  assert.equal(timers.size, 1, 'a map with arrive: one start, once the map is painted under it');
  ri.next(MAP([LIB]), 5); assert.equal(timers.size, 1, 'the same seq drawn again: nothing new');
  ri.next({ kind: 'npc', npcId: 'n-ada' }, 6); assert.equal(timers.size, 0, 'another push: the pending start is cut');
  ri.next({ kind: 'blank' }, 7); assert.equal(timers.size, 0);
  assert.equal(ri.state(), null);
  ri.destroy(); ri.next(MAP([LIB]), 8); assert.equal(timers.size, 0, 'destroyed: nothing');
});

/* ---------- the files ---------- */
test('the files: no markup sink, no request, no native dialog, no important flag, no stray characters; every rule is under .ro-card or .ro-rings', () => {
  const code = read(FILE).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment/.test(code), 'a markup sink');
  assert.ok(!/fetch\(|XMLHttpRequest|\.src\s*=|sendBeacon|WebSocket|href/.test(code), 'a request');
  assert.ok(!/<button|confirm\(|prompt\(|alert\(/.test(code), 'a hand-built button or a native dialog');
  assert.ok(/textContent = text/.test(code), 'strings go in as text');
  const css = read('app/display/room-intro.css');
  assert.ok(!/!\s*important/i.test(css));
  for (const f of ['app/display/room-intro.css', FILE]) assert.ok(![...read(f)].some((c) => c.codePointAt(0) >= 0x80 && c.codePointAt(0) <= 0x9f), f + ': a character in U+0080 to U+009F');
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*\s*\}/g, '').replace(/@media[^{]+\{/g, '');
  const sels = (rules.match(/[^{}]+\{/g) || []).map((s) => s.slice(0, -1).trim()).filter(Boolean);
  assert.ok(sels.length > 30, 'the sheet has its rules: ' + sels.length);
  for (const s of sels) for (const one of s.split(',')) assert.ok(/^\.ro-(card|rings)\b/.test(one.trim()), 'a rule not under the card\'s or the ring\'s root: ' + one.trim());
  const anim = css.match(/(?:animation|transition)\s*:[^;]+;/g) || [];
  const frames = css.match(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*\s*\}/g) || [];
  for (const k of frames) for (const decl of k.match(/\{[^{}]*\}/g) || []) for (const p of decl.slice(1, -1).split(';').map((x) => x.split(':')[0].trim()).filter(Boolean))
    assert.ok(/^(transform|opacity|clip-path|-webkit-clip-path)$/.test(p), 'only transform, opacity and clip-path animate: ' + p);
  assert.ok(anim.length > 10);
});
test('the display page: the bundle is asked for only while the setting is on, attached from its load callback (once), fed the display already up and every push after', () => {
  const src = read('app/display-page.js');
  assert.match(src, /if \(swOn\('room\.intro'\) && root\.B68Load && !s\.riAsked\) \{ s\.riAsked = true; root\.B68Load\.need\('room-intro'\)\.then\(function \(\) \{ riAttach\(\); \}/, 'attached from the load callback');
  assert.match(src, /function riAttach\(\) \{ if \(s\.ri \|\| s\.dead/, 'once');
  assert.match(src, /if \(s\.lastShow\) s\.ri\.next\(s\.lastShow\[0\], s\.lastShow\[1\]\); \}/, 'fed the display already up');
  assert.match(src, /if \(s\.ri\) s\.ri\.next\(display, seq\);/, 'every push');
  assert.match(src, /on: function \(\) \{ return swOn\('room\.intro'\); \}, still: function \(\) \{ return reduced\(\); \}/, 'behind the setting; only the device\'s reduced motion makes it still (Hold scenes still does not stop a sent event)');
  assert.equal((src.match(/B68RoomIntro/g) || []).length, 3, 'nothing else reads the module');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
