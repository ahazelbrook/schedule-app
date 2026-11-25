// gm-room-zoom (RK09 of the room key build, room.key): app/gm/room-zoom.js, a room card's things and the zoom card, and its wiring. INVENTED data
// only: the Pelican Rooms of checks/runtime/fixtures/gm/pelican-room-things.md (GM-ONLY- markers on every closer look, roll and danger). The list's
// markup (order, keys, hooks, marks, escaping, nothing secret in it), the card's lines, the button row's slots (the RK10 / RK11 hook), marks read
// through a read-only room-state view, the keys' guards, and the page's wiring: the Run view and the kit's room card ask roomThings before roomNote,
// site.act routes data-site="thing", the page's one-line branches, the Shortcuts row drawn only while room.key is on (off: today's card, byte for
// byte), and no new document Escape listener. The browser half is room-key.e2e.mjs. No browser, no network.
//   node checks/runtime/gm-room-zoom.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/room-zoom.js';
const Z = require(path.join(ROOT, FILE));
const RT = require(path.join(ROOT, 'app', 'gm', 'room-things.js'));
const RN = require(path.join(ROOT, 'app', 'gm', 'room-notes.js'));
const RS = require(path.join(ROOT, 'app', 'gm', 'room-state.js'));
const SC = require(path.join(ROOT, 'app', 'gm', 'shortcuts.js'));
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOTE = read('checks/runtime/fixtures/gm/pelican-room-things.md');
const ROOMS = ['Showroom', 'Cocktail lounge', 'Underground counting room', 'Security control room', 'Private card rooms', 'Luxury penthouse', 'Pelican cloakroom'];
const FOUND = RN.find({ notes: [{ id: 'n-pelican', rel: 'prep/pelican.md', title: 'The Pelican Rooms', blocks: [{ k: 'md', src: NOTE }] }] }, ROOMS);
const mdOf = (room) => FOUND.byRoom[room].md;
const SHOW = RT.parse(mdOf('Showroom'));
const NAMES = ['A brass umbrella stand', 'A velvet rope', 'The stage curtain', 'A grand piano'];
const SRC = { zoom: read(FILE), page: read('app/gm-page.js'), run: read('app/gm/run-view.js'), kit: read('app/gm/kit/run.js'), site: read('app/gm/site.js'), css: read('app/gm/room-key.css') };

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const buttons = (h) => [...h.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].map((m) => m[0]);
const attr = (b, a) => { const m = new RegExp(' ' + a + '="([^"]*)"').exec(b); return m ? m[1] : null; };
const label = (b) => { const m = /<span class="ui-label">([^<]*)<\/span>/.exec(b); return m ? m[1] : null; };

test('gm-room-zoom: loads under Node, and as a plain script defines window.B68GmRoomZoom with nothing else loaded (other modules read when called)', () => {
  assert.equal(Z.stub, undefined, 'no longer a stub');
  for (const k of ['create', 'listHtml', 'rows', 'rollLines', 'slotsOf', 'noteMd']) assert.equal(typeof Z[k], 'function', k);
  assert.equal(Z.ESC_ID, 'room.zoom'); assert.deepEqual(Z.SLOTS, ['show', 'state', 'swap']); assert.equal(Z.KEYS, 9);
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(SRC.zoom, win, { filename: FILE });
  assert.ok(win.B68GmRoomZoom && typeof win.B68GmRoomZoom.create === 'function' && !win.B68GmRoomZoom.stub, 'defined');
  assert.equal(win.B68GmRoomZoom.listHtml('Showroom', SHOW), '', 'no B68Ui on the page yet: no list (it never throws)');
  vm.runInNewContext(read('app/ui/ui.js'), win, { filename: 'ui.js' });
  assert.equal(win.B68GmRoomZoom.listHtml('Showroom', SHOW), Z.listHtml('Showroom', SHOW), 'with B68Ui loaded later, the same markup as under Node');
});

test('the room card\'s list (old desk): the four things as named buttons in the note\'s order, keys 1 to 4, data-site="thing" with the room, the slug and the index', () => {
  const h = Z.listHtml('Showroom', SHOW), bs = buttons(h);
  assert.ok(h.startsWith('<div class="rk-things" data-rk-things="Showroom" role="group" aria-label="Things in Showroom"><h4 class="rv-lab rk-thead">Things</h4><ul class="rk-tlist">'), h.slice(0, 200));
  assert.deepEqual(bs.map(label), NAMES);
  assert.deepEqual(bs.map((b) => attr(b, 'data-ui-key')), ['1', '2', '3', '4']);
  assert.deepEqual(bs.map((b) => attr(b, 'data-site')), ['thing', 'thing', 'thing', 'thing']);
  assert.deepEqual(bs.map((b) => attr(b, 'data-room')), ['Showroom', 'Showroom', 'Showroom', 'Showroom']);
  assert.deepEqual(bs.map((b) => attr(b, 'data-thing')), ['brass-umbrella-stand', 'velvet-rope', 'stage-curtain', 'grand-piano']);
  assert.deepEqual(bs.map((b) => attr(b, 'data-i')), ['0', '1', '2', '3']);
  for (const b of bs) { assert.match(attr(b, 'class'), /^ui-btn ui-btn--quiet rk-thing rv-btn sm$/); assert.equal(attr(b, 'aria-haspopup'), 'dialog'); assert.equal(attr(b, 'type'), 'button'); }
  assert.deepEqual(bs.map((b) => attr(b, 'title')), ['too heavy to tip.', 'on two brass posts.', 'heavy with dust.', 'its lid propped open.'], 'the title is the line: what is free to see');
  assert.ok(!/GM-ONLY-/.test(h), 'no closer look, roll or danger in the list: those are in the zoom card only');
});

test('the list on the kit desk: the kit\'s classes (krv-things, krv-lab), no old rv-btn; marks: a chip, and taken or gone dims', () => {
  const h = Z.listHtml('Showroom', SHOW, { kit: true, marks: { 'velvet-rope': 'taken', 'stage-curtain': 'open', 'grand-piano': 'gone', nobody: 'x' } }), bs = buttons(h);
  assert.ok(h.startsWith('<div class="rk-things krv-things" data-rk-things="Showroom"') && h.includes('<h4 class="krv-lab rk-thead">Things</h4>'));
  assert.deepEqual(bs.map((b) => attr(b, 'class')), ['ui-btn ui-btn--quiet rk-thing', 'ui-btn ui-btn--quiet rk-thing is-done', 'ui-btn ui-btn--quiet rk-thing', 'ui-btn ui-btn--quiet rk-thing is-done']);
  assert.deepEqual([...h.matchAll(/<span class="rk-tstate( is-done)?">([^<]*)<\/span>/g)].map((m) => m[2] + (m[1] ? '*' : '')), ['taken*', 'open', 'gone*']);
  assert.ok(!h.includes('nobody'), 'a mark on a slug the room does not have shows nowhere');
});

test('the list: escaped, at most nine keys, nothing for no things, a bad thing left out', () => {
  const ten = Array.from({ length: 10 }, (_, i) => RT.clean({ name: 'Thing ' + (i + 1) }));
  const bs = buttons(Z.listHtml('A "quoted" <room>', ten));
  assert.equal(bs.length, 10); assert.equal(attr(bs[8], 'data-ui-key'), '9'); assert.equal(attr(bs[9], 'data-ui-key'), null, 'the tenth has no key');
  assert.equal(attr(bs[0], 'data-room'), 'A &quot;quoted&quot; &lt;room&gt;');
  assert.match(Z.listHtml('R', [{ name: 'x < y & "z"', slug: 'x-y-z' }]), /<span class="ui-label">x &lt; y &amp; &quot;z&quot;<\/span>/, 'a name is text');
  for (const none of [[], null, undefined, [{}], [{ name: 'no slug' }], 'x']) assert.equal(Z.listHtml('Showroom', none), '', JSON.stringify(none));
  assert.equal(Z.listHtml('', SHOW), '', 'no room: nothing');
  assert.equal(buttons(Z.listHtml('R', [{ name: 'ok', slug: 'ok' }, null, { name: '', slug: 'x' }])).length, 1);
});

test('the zoom card\'s lines: the closer look, the roll (4/5, then 6 on its own line), the danger, then the state (the mark) or the states', () => {
  const [stand, rope, curtain] = SHOW;
  assert.deepEqual(Z.rows(stand, ''), [
    { k: 'look', icon: '🔍', label: 'A closer look', lines: ['GM-ONLY-look: one umbrella is dry, though it is raining outside.'] },
    { k: 'roll', icon: '🎲', label: 'On a roll', lines: ['GM-ONLY-roll: 4/5: a cloakroom ticket in its folds.', '6: and the number on it is circled.'] },
    { k: 'danger', icon: '!', label: 'Danger', lines: ['GM-ONLY-danger: the stand rings like a bell if it is knocked.'] },
    { k: 'state', icon: '', label: 'States', lines: ['full · empty'] }]);
  assert.deepEqual(Z.rows(stand, 'empty').pop(), { k: 'state', icon: '', label: 'State', lines: ['empty'] }, 'a mark is the state');
  assert.deepEqual(Z.rows(rope, '').map((r) => r.k), ['look'], 'only what the thing has');
  assert.deepEqual(Z.rows(curtain, '').map((r) => r.k), ['look', 'roll', 'state']);
  assert.deepEqual(Z.rows(RT.clean({ name: 'A tin' }), ''), []); assert.deepEqual(Z.rows(null), []);
  assert.deepEqual(Z.rollLines('4/5: one. 6: two.'), ['4/5: one.', '6: two.']);
  assert.deepEqual(Z.rollLines('4/5 a ticket. 6 - and more'), ['4/5 a ticket.', '6 - and more']);
  assert.deepEqual(Z.rollLines('one line only'), ['one line only']); assert.deepEqual(Z.rollLines(''), []);
  assert.deepEqual(Z.rollLines('16: not a six'), ['16: not a six'], 'a 6 inside a number does not split');
});

test('the button row (the RK10 / RK11 / RK15 hook): each slot asks its module\'s buttons(ctx), then the added fns; a stub, a throw or a bad button gives nothing', () => {
  const ctx = { room: 'Showroom', thing: { slug: 'brass-umbrella-stand' } }, seen = [];
  const at = { B68GmRoomShow: { buttons: (c) => { seen.push(c); return [{ label: 'Show on iPad', run: () => 1 }, { label: '', run: () => 1 }, { label: 'x' }, null, 'y']; } },
    B68GmRoomMark: { stub: true, buttons: () => [{ label: 'never', run: () => 1 }] }, B68GmRoomSwap: { buttons: () => { throw new Error('boom'); } } };
  assert.deepEqual(Z.slotsOf('show', ctx, [], at).map((b) => b.label), ['Show on iPad']);
  assert.equal(seen[0], ctx, 'the module gets the ctx itself');
  assert.deepEqual(Z.slotsOf('state', ctx, [() => [{ label: 'Taken', run: () => 1 }], 'not a fn', () => 'not a list'], at).map((b) => b.label), ['Taken'], 'a stub module is passed over; an added fn draws');
  const err = console.error; console.error = () => {};
  try { assert.deepEqual(Z.slotsOf('swap', ctx, [], at), [], 'a throw is no buttons'); } finally { console.error = err; }
  assert.deepEqual(Z.slotsOf('show', ctx, [], {}), []); assert.deepEqual(Z.slotsOf('nope', ctx, [() => [{ label: 'a', run: () => 1 }]], {}).map((b) => b.label), ['a']);
});

test('create(host) under Node: the list from the note\'s md (the Things block parsed here), marks read through a read-only room-state view of the GM state', () => {
  const rk = 'a:The Pelican Rooms', names = ['Showroom', 'Cocktail lounge', 'Showroom'];
  const keys = RS.roomKeys(names);
  const doc = { roomstate: { v: 1, at: '2030-01-07T21:45:00.000Z', keys: { [rk]: { part: '', at: '2030-01-07T21:45:00.000Z', rooms: { [keys[0]]: { marks: { 'velvet-rope': 'taken' } }, [keys[2]]: { marks: { 'velvet-rope': 'gone' } } } } } } };
  const z = Z.create({ md: (room) => room === 'Showroom' ? mdOf('Showroom') : '', roll: () => ({ key: rk, rooms: names }), doc: () => doc });
  const h = z.html('Showroom'), bs = buttons(h);
  assert.deepEqual(bs.map(label), NAMES);
  assert.match(h, /<span class="rk-tstate is-done">taken<\/span>/, 'the first Showroom\'s mark (' + keys[0] + '), never the second same-named room\'s');
  assert.ok(!h.includes('>gone<'));
  assert.equal(z.html('Cocktail lounge'), '', 'a room with no things: nothing');
  assert.equal(z.html('Nowhere'), '');
  assert.equal(z.noteMd(mdOf('Showroom')), RT.read(mdOf('Showroom')).md);
  assert.ok(!/GM-ONLY-|brass umbrella/.test(z.noteMd(mdOf('Showroom'))) && /big hall/.test(z.noteMd(mdOf('Showroom'))), 'the note without its Things block keeps the rest');
  assert.equal(z.noteMd('- **Costume:** a mask\n> [!quote] SAY\n> Hello.'), '- **Costume:** a mask\n> [!quote] SAY\n> Hello.', 'a note with no things is left exactly as it is');
  const bad = Z.create({ md: () => { throw new Error('x'); }, roll: () => { throw new Error('y'); }, doc: () => null });
  assert.equal(bad.html('Showroom'), '', 'a host that throws: nothing, never a throw');
  const own = Z.create({ things: () => [RT.clean({ name: 'A tin whistle' })], where: () => ({ rollKey: 'seed-1', roomKey: 'hall#1' }), rs: () => ({ read: () => ({ marks: { 'tin-whistle': 'taken' } }) }) });
  assert.match(own.html('Hall'), /A tin whistle[\s\S]*rk-tstate is-done">taken/, 'a host\'s own things and where (a rolled room, RK14) and its rs');
  assert.equal(z.isOpen(), false); assert.equal(z.current(), null); assert.equal(z.open('Showroom', 0), false, 'no DOM: nothing opens');
  assert.equal(z.act(null), false); assert.equal(z.act({ getAttribute: () => '' }), false);
  const off = z.addButtons('show', () => []); assert.equal(typeof off, 'function'); off(); assert.equal(typeof z.addButtons('nope', () => []), 'function');
});

test('the read-only view never writes: it is made with on() false and a refusing patch, and on() false refuses every write', () => {
  assert.match(SRC.zoom, /M\.create\(\{ on: function \(\) \{ return false; \}, doc: function \(\) \{ return call\('doc'\); \}, patch: function \(\) \{ return false; \},/);
  const v = RS.create({ on: () => false, doc: () => ({}), patch: () => { throw new Error('never'); }, busy: () => false, now: () => 0, part: () => '' });
  assert.equal(v.setMark('a:x', 'hall#1', 'lamp', 'on'), false, 'the contract: with on() false a write is false and patch is never called');
});

test('keys: only 1 to 9 and the arrows, never with a modifier or in a field; without an open card or a focused room card nothing is taken', () => {
  const z = Z.create({});
  let prevented = 0;
  const ev = (key, o = {}) => Object.assign({ key, preventDefault: () => { prevented++; } }, o);
  for (const k of ['1', '9', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) assert.equal(z.key(ev(k), {}), false, k + ': no card focused, no DOM');
  for (const [k, o, e] of [['1', { typing: true }, {}], ['1', {}, { ctrlKey: true }], ['2', {}, { altKey: true }], ['3', {}, { metaKey: true }], ['0', {}, {}], ['a', {}, {}], ['Enter', {}, {}], ['Escape', {}, {}]])
    assert.equal(z.key(ev(k, e), o), false, k + ' ' + JSON.stringify(o) + JSON.stringify(e));
  assert.equal(z.key(null), false); assert.equal(prevented, 0);
});

test('the page\'s wiring: one-line branches, gated by room.key; the Run view and the kit\'s card ask roomThings before roomNote; site.act routes data-site="thing"', () => {
  for (const [name, src, call] of [['run-view.js', SRC.run, 'host.roomThings(name)'], ['kit/run.js', SRC.kit, 'host.roomThings(name, { kit: true })']]) {
    const t = src.indexOf(call), n = src.indexOf('host.roomNote(name)');
    assert.ok(t > 0 && n > t && src.slice(t, n).split('\n').length <= 3, name + ': roomThings just before roomNote');
    assert.equal(src.split(call).length, 2, name + ': once');
  }
  assert.match(SRC.site, /case 'thing': if \(typeof page\.thing === 'function'\) page\.thing\(el, view\); break;/);
  const P = SRC.page;
  assert.match(P, /function rkZoom\(\) \{ var M = W\.B68GmRoomZoom, me = S; if \(!me \|\| !M \|\| M\.stub \|\| typeof M\.create !== 'function'\) return null; if \(!b09On\('room\.key'\)\) \{ if \(me\.rz\) me\.rz\.close\(false\); return null; \}/, 'rkZoom: null (and an open card closed) while room.key is off');
  assert.match(P, /roomThings: function \(room, o\) \{ var rz = rkZoom\(\); return rz \? rz\.html\(room, o\) : ''; \}/, 'the host\'s roomThings: \'\' while off');
  assert.match(P, /var rz = md \? rkZoom\(\) : null; if \(rz\) md = rz\.noteMd\(md\);/, 'the note loses its Things block only while things are drawn');
  assert.match(P, /thing: function \(el\) \{ var rz = S === me \? rkZoom\(\) : null; if \(rz\) rz\.act\(el\); \}/);
  const at = P.indexOf('  function onKey(ev) {'), onKey = P.slice(at, at + 9000);
  const k = onKey.indexOf("if (S.rz && b09On('room.key') && S.rz.key(ev, { typing: typing(tg), top: escTop() })) return;"), top = onKey.indexOf('var top = escTop();');
  const escAt = onKey.indexOf("if (ev.key === 'Escape' || ev.key === 'Esc') { escPress(ev); return; }");
  assert.ok(k > 0 && top > k && escAt > 0 && escAt < k, 'the card\'s keys: after Esc (the ONE Esc), before the top box and every page key');
  assert.match(P, /W\.B68Load\.need\(n\)\.then\(function \(\) \{ if \(n === 'room-key' && S === me && S\.rv\) S\.rv\.rerender\(\); \}/, 'the Run view draws again once the bundle is in');
  assert.match(P, /if \(me\.rz\) \{ try \{ me\.rz\.destroy\(\); \} catch \(e\) \{\} me\.rz = null; \}/);
  assert.match(P, /S\.shortcuts = W\.B68GmShortcuts\.make\(\{ root: function \(\) \{ return \$q\('#gm-root'\); \}, feature: b09On \}\);/);
});

test('Esc is the page\'s ONE Esc: room-zoom.js adds no document key listener, registers room.zoom with B68GmEsc at 70, and keeps the popover\'s own Esc and Tab from closing it', () => {
  const src = SRC.zoom.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.deepEqual([...src.matchAll(/addEventListener\('(key[a-z]+)', ([a-zA-Z]+)\)/g)].map((m) => m[1] + ':' + m[2]), ['keydown:onBoxKey'], 'no keydown listener but the card box\'s own');
  assert.match(src, /E\.register\(ESC_ID, \{ priority: PRIORITY, isOpen: function \(\) \{ return !!cur; \}, close: function \(\) \{ close\(true\); \} \}\)/);
  assert.match(src, /var ESC_ID = 'room\.zoom', PRIORITY = 70/);
  assert.match(src, /pinned: true/, 'pinned: the popover registers no Esc of its own and never closes on a scroll');
  assert.match(src, /if \(\(ev\.key === 'Escape' \|\| ev\.key === 'Esc'\) && typeof ev\.stopImmediatePropagation === 'function'\) \{ ev\.stopImmediatePropagation\(\); return; \}/);
});

test('the Shortcuts card: one row for the keys, drawn only while room.key is on; off, the card is today\'s, byte for byte', () => {
  const row = SC.rows().filter((r) => r.setting === 'room.key');
  assert.equal(row.length, 1); assert.equal(row[0].k, 'term'); assert.equal(row[0].sec, 'box');
  assert.match(row[0].term, /\[\[1\]\]–\[\[9\]\]/); assert.match(row[0].does, /\[\[Esc\]\]/);
  const on = SC.html(() => true), off = SC.html(() => false), all = SC.html();
  assert.ok(on.includes('<kbd>1</kbd>–<kbd>9</kbd>') && !off.includes('<kbd>1</kbd>–<kbd>9</kbd>') && all === on, 'on and with no predicate: drawn; off: not');
  assert.equal(SC.html(() => false), SC.html((id) => id !== 'room.key'));
  const g = spawnSync('git', ['show', '0ac15a50:app/gm/shortcuts.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 24 });
  if (g.status !== 0) { console.log('  (skipped the byte check: git cannot read 0ac15a50)'); return; }
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(g.stdout, win, { filename: 'shortcuts-base.js' });
  assert.equal(off, win.B68GmShortcuts.html(), 'room.key off: the card is room/main\'s base card, byte for byte');
});

test('the bundle and the rules: room-zoom.js only in the room-key bundle; no literal over 220 characters; no hand-built button; the stylesheet\'s scopes and characters', () => {
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(read('app/routes.js'), win, { filename: 'routes.js' });
  const B = win.B68Load.BUNDLES;
  assert.deepEqual(Object.keys(B).filter((n) => B[n].includes('gm/room-zoom.js')), ['room-key']);
  const lits = [...SRC.zoom.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g)].map((m) => m[0]).filter((s) => s.length > 222);
  assert.deepEqual(lits, [], 'string literals over 220 characters');
  assert.ok(!/<button/.test(SRC.zoom.replace(/\/\*[\s\S]*?\*\//g, '')), 'buttons come from B68Ui (the ratchet)');
  assert.ok(!/[\u0080-\u009f]/.test(SRC.css), 'no C1 characters in room-key.css');
  const css = SRC.css.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/!\s*important/i.test(css) && !/@layer/.test(css), 'no !important, unlayered');
  for (const rule of SRC.css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((r) => r.trim()).filter(Boolean)) {
    const sel = rule.slice(0, rule.indexOf('{')).trim();
    for (const s of sel.split(',').map((x) => x.trim())) assert.ok(/^(#gm-page \.rk-things:not\(\.krv-things\)|:root\[data-kit~="desk"\] \.krv-things|\.rk-zscope \.rk-z)/.test(s), 'a rule outside the room key\'s own scopes: ' + s);
  }
});

test('things stay GM-side: no display, phone, player or server file names the zoom card', () => {
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const files = walk(path.join(ROOT, 'app')).concat(walk(path.join(ROOT, 'functions'))).filter((f) => /\.(js|mjs|html)$/.test(f)).map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
  const hits = files.filter((f) => /B68GmRoomZoom|room-zoom|rk-zoom|rk-thing/.test(read(f)));
  assert.deepEqual(hits.sort(), ['app/gm-page.js', 'app/gm/room-zoom.js', 'app/gm/site.js', 'app/routes.js'].sort(), 'the GM page\'s own files only (site.js names it in its doc)');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
