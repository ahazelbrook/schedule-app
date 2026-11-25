// gm-glance-now: the fiction's clock and who's where (gm.glance, RK21 of the room key build). No browser, no network.
// It loads app/gm/glance-now.js under Node (with gm/ball.js beside it) and as a plain script, and checks the clock's rule, the stored change
// (ball.fic = { b, off }, numbers only), the people's now and next, the crew's line, the block's markup and its actions, and that the module is
// only ever fetched by the GM page. The night here is invented (a cloakroom and a bar; the fixtures' Mabel Quist and the Dovetail Crew).
//   node checks/runtime/gm-glance-now.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/glance-now.js';
const G = require(path.join(ROOT, FILE));
const B = require(path.join(ROOT, 'app/gm/ball.js'));
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

/* an invented night: 21:00 to 01:00, 15-minute beats */
const PLAY = {
  v: 2,
  clock: { start: '21:00', end: '01:00', beat: 15, starts: { 6: '21:30' } },
  disguises: [{ id: 'staff', label: 'Staff', sees: ['cc'] }],
  people: [
    { id: 'zz', label: 'Lotte Brand', kind: 'staff', stops: [{ at: '21:00', room: 'Door' }] },
    { id: 'mq', label: 'Mabel Quist', kind: 'target', stops: [{ at: '21:00', room: 'Cloakroom', note: 'GM-ONLY-STOP-1' }, { at: '23:30', room: 'Bar' }] },
    { id: 'dk', label: 'Dov Kessler', kind: 'guard', stops: [{ at: '21:00', with: 'mq' }, { at: '22:00', room: 'Office' }] },
    { id: 'cc', label: 'Ada Vell', kind: 'staff', stops: [{ at: '22:30', room: 'Bar' }] },
    { id: 'gx', label: 'GM-ONLY-PERSON-1', kind: 'rival', stops: [{ at: '21:00', room: 'Office' }, { at: '00:30', gone: true }] },
    { id: 'nv', label: 'Never Comes', kind: 'staff', stops: [] }
  ]
};
const PCS = [{ id: 'pc-nell', name: 'Nell Arbuthnot' }, { id: 'pc-ray', name: 'Ray Okonjo' }, { id: 'pc-tam', name: 'Tam Petrakis' }];
const ST = { site: 'The Pelican Rooms', v: 2, start: 30, t: 45, crew: { 'pc-nell': { room: 'Bar' }, 'pc-tam': { room: 'Cloakroom' } } };
const at = (o) => Object.assign({}, ST, o);
const label = (t) => B.timeLabel(PLAY, t);

test('gm-glance-now: the module loads under Node and as a plain script, and is filled (not the stub)', () => {
  assert.ok(G && typeof G === 'object' && typeof G.create === 'function' && !G.stub);
  const win = { B68GmBall: B }; win.self = win; win.window = win;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, FILE), 'utf8'), win, { filename: FILE });
  assert.ok(win.B68GmGlanceNow && typeof win.B68GmGlanceNow.ficT === 'function' && !win.B68GmGlanceNow.stub, 'B68GmGlanceNow is defined');
  assert.equal(win.B68GmGlanceNow.ficT(at({})), 45);
});

test('the clock: nothing before the night starts; the published time with no offset', () => {
  assert.equal(G.ficT({ t: 0 }), null, 'not started: no fiction time');
  assert.equal(G.ficT(null), null);
  assert.equal(G.ficT(at({})), 45, 'no fic: the beat time');
  assert.equal(label(G.ficT(at({}))), '21:45');
});
test('the clock: the offset counts while the beat is the one it was set at', () => {
  assert.equal(G.ficT(at({ fic: { b: 45, off: 7 } })), 52);
  assert.equal(label(G.ficT(at({ fic: { b: 45, off: 7 } }))), '21:52');
  assert.equal(G.ficT(at({ fic: { b: 45, off: -5 } })), 40, 'a typed time a little before the beat');
});
test('the clock: it advances with the beats and never goes back on a step forward', () => {
  assert.equal(G.ficT(at({ t: 60, fic: { b: 45, off: 7 } })), 60, 'the next beat (22:00) is past 21:52: the fiction follows the beat');
  assert.equal(G.ficT(at({ t: 60, fic: { b: 45, off: 25 } })), 70, 'the fiction (22:10) is still ahead of the next beat: it holds');
  assert.equal(G.ficT(at({ t: 75, fic: { b: 45, off: 25 } })), 75, 'and the beat after catches it up');
  assert.equal(G.ficT(at({ t: 30, fic: { b: 45, off: 7 } })), 30, 'stepped back before the beat it was set at: the offset no longer counts');
});
test('the clock: a stored value that is not two whole numbers in range is ignored', () => {
  for (const fic of [{ b: '45', off: 7 }, { b: 45, off: '7' }, { b: 45, off: 7.5 }, { b: 45, off: 721 }, { b: -1, off: 5 }, { b: 2000, off: 5 }, 'x', [45, 7], null]) {
    assert.equal(G.ficT(at({ fic })), 45, JSON.stringify(fic));
  }
  assert.equal(G.ficT(at({ t: 1430, fic: { b: 1430, off: 30 } })), 1439, 'clamped to the day');
});
test('ficChange: the ball change is { fic: { b, off } }, numbers only; the beat time itself clears it; past 12 hours, or not started, nothing', () => {
  assert.deepEqual(G.ficChange(at({}), 52), { fic: { b: 45, off: 7 } });
  assert.deepEqual(G.ficChange(at({ fic: { b: 45, off: 7 } }), 45), { fic: null });
  assert.deepEqual(G.ficChange(at({ t: 60 }), 50), { fic: { b: 60, off: -10 } });
  assert.equal(G.ficChange(at({}), 45 + 721), null);
  assert.equal(G.ficChange(at({}), 52.5), null);
  assert.equal(G.ficChange({ t: 0 }, 10), null);
  const ch = G.ficChange(at({}), 60);
  assert.deepEqual(Object.keys(ch.fic).sort(), ['b', 'off']);
  assert.ok(Object.values(ch.fic).every((v) => typeof v === 'number'), 'never a time as text');
  assert.equal(G.ficT(at(ch)), 60, 'the change reads back as the time asked for');
});
test('parseTime: HH:MM, H:MM, HHMM and HH.MM; anything else null', () => {
  assert.equal(G.parseTime('21:52'), '21:52');
  assert.equal(G.parseTime(' 9:05 '), '09:05');
  assert.equal(G.parseTime('2152'), '21:52');
  assert.equal(G.parseTime('21.52'), '21:52');
  for (const bad of ['', '24:00', '21:60', '9', 'nine', '21:5', '121:00', null]) assert.equal(G.parseTime(bad), null, String(bad));
});

test('people: now and next at the fiction time (Mabel Quist · the cloakroom till 23:30 · then the bar)', () => {
  const by = Object.fromEntries(G.people(PLAY, ST, 45).map((p) => [p.id, p]));
  assert.equal(by.mq.room, 'Cloakroom');
  assert.equal(label(by.mq.till), '23:30');
  assert.equal(by.mq.next, 'Bar');
  assert.equal(by.dk.room, 'Cloakroom', 'a follower is where the one they follow is');
  assert.equal(label(by.dk.till), '22:00');
  assert.equal(by.dk.next, 'Office');
  assert.equal(by.cc.room, '', 'not here yet');
  assert.equal(label(by.cc.till), '22:30');
  assert.equal(by.cc.next, 'Bar');
  assert.equal(by.zz.room, 'Door');
  assert.equal(by.zz.till, null, 'no change before the night ends');
  assert.equal(by.gx.next, '');
  assert.equal(by.gx.gone, true, 'the rival leaves the night');
  assert.equal(label(by.gx.till), '00:30');
  assert.ok(!by.nv, 'someone the play never places is left out');
});
test('people: key people first (target, rival, contact, a costume\'s looker), then the rest in play order', () => {
  assert.deepEqual(G.people(PLAY, ST, 45).map((p) => p.id), ['mq', 'cc', 'gx', 'zz', 'dk']);
  assert.deepEqual(G.people(PLAY, ST, 45).map((p) => p.key), [true, true, true, false, false]);
});
test('people: the fiction time moves who is where, and a GM pin (ball.over) holds a person', () => {
  const late = Object.fromEntries(G.people(PLAY, ST, 151).map((p) => [p.id, p]));      /* 23:31 */
  assert.equal(late.mq.room, 'Bar');
  assert.equal(late.mq.till, null);
  assert.equal(late.cc.room, 'Bar');
  const pinned = Object.fromEntries(G.people(PLAY, at({ over: { mq: { at: 'Office' } } }), 45).map((p) => [p.id, p]));
  assert.equal(pinned.mq.room, 'Office');
  assert.equal(pinned.mq.till, null, 'pinned until cleared');
});
test('crew: every PC in order, with the marker\'s room, or none', () => {
  assert.deepEqual(G.crew(PCS, ST), [{ id: 'pc-nell', name: 'Nell Arbuthnot', room: 'Bar' }, { id: 'pc-ray', name: 'Ray Okonjo', room: '' }, { id: 'pc-tam', name: 'Tam Petrakis', room: 'Cloakroom' }]);
  assert.deepEqual(G.crew(PCS, {}).map((c) => c.room), ['', '', '']);
  assert.deepEqual(G.crew(null, ST), []);
});

/* the view, with a host like the page's (rvHost): site, state, set(change, quiet), pcs */
function host(state) {
  const h = { state, sets: [], toasts: [], redraws: 0 };
  const rv = { site: () => ({ name: 'The Pelican Rooms', play: PLAY }), state: () => h.state, pcs: () => PCS,
    set: (c, quiet) => { h.sets.push({ c, quiet }); h.state = Object.assign({}, h.state, c); if (c.fic === null) delete h.state.fic; return true; } };
  h.view = G.create({ run: () => rv, redraw: () => { h.redraws++; }, toast: (m, bad) => { h.toasts.push([m, bad]); } });
  return h;
}
const xOf = (st) => ({ rs: { name: 'The Pelican Rooms', play: PLAY }, st });
const el = (attrs, input) => ({ getAttribute: (k) => (k in attrs ? String(attrs[k]) : null), querySelector: () => (input === undefined ? null : { value: input }) });
const text = (h) => h.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

test('html: answers the four questions in one block (the time, who is where now and next, where the crew is)', () => {
  const h = host(at({ fic: { b: 45, off: 7 } })), out = h.view.html(xOf(h.state), false), t = text(out);
  assert.match(out, /^<div class="gl-now" role="group"/);
  assert.match(t, /Fiction 21:52 7 min ahead/);
  assert.match(t, /Crew Nell Arbuthnot Bar · Ray Okonjo not placed · Tam Petrakis Cloakroom/);
  assert.match(t, /Now Mabel Quist Cloakroom till 23:30, then Bar/);
  assert.match(t, /Ada Vell not here till 22:30, then Bar/);
  assert.match(t, /GM-ONLY-PERSON-1 Office till 00:30, then gone/);
  assert.match(t, /Lotte Brand Door · Dov Kessler/, 'no change tonight: no till');
  assert.match(out, /data-site="gln-add" data-min="5"/);
  assert.match(out, /data-site="gln-add" data-min="15"/);
  assert.match(out, /<form class="gl-now-form" data-site="gln-set"/);
  assert.match(out, /data-site="gln-clear"/, 'Clear shows while an offset counts');
  assert.doesNotMatch(out, /GM-ONLY-STOP-1/, 'a stop\'s note is not drawn');
});
test('html: no offset, no Clear and no +n; before the night starts, or with no play, nothing', () => {
  const h = host(at({})), out = h.view.html(xOf(h.state), false);
  assert.match(text(out), /^Fiction 21:45\+5\+15Set/);
  assert.doesNotMatch(out, /gln-clear|gl-now-off/);
  assert.equal(h.view.html(xOf({ t: 0 }), false), '');
  assert.equal(h.view.html({ rs: { name: 'x', play: null }, st: ST }, false), '');
  assert.equal(h.view.html(null, false), '');
});
test('html: the text from the play and the PCs is escaped', () => {
  const h = host(at({}));
  const play = JSON.parse(JSON.stringify(PLAY)); play.people[1].label = '<img src=x onerror=alert(1)>';
  const out = h.view.html({ rs: { name: 'x', play }, st: h.state }, false);
  assert.doesNotMatch(out, /<img/);
  assert.match(out, /&lt;img src=x onerror=alert\(1\)&gt;/);
});
test('html: on the kit desk the buttons are B68Ui parts', () => {
  const calls = [];
  const win = { B68GmBall: B, B68Ui: { button: (o) => { calls.push(o); return '<button class="ui-btn">' + o.label + '</button>'; } } };
  win.self = win; win.window = win;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, FILE), 'utf8'), win, { filename: FILE });
  const v = win.B68GmGlanceNow.create({ run: () => ({ pcs: () => PCS }) }), out = v.html(xOf(at({ fic: { b: 45, off: 7 } })), true);
  assert.match(out, /class="gl-now gl-now-kit"/);
  assert.deepEqual(calls.map((o) => o.label), ['+5', '+15', 'Clear', 'Set']);
  assert.equal(calls[0].data.site, 'gln-add');
  assert.equal(calls[3].type, 'submit');
});

test('html: the buttons are B68Ui parts on the old desk too (they keep rv-btn); with no B68Ui the block still reads, without buttons', () => {
  const h = host(at({ fic: { b: 45, off: 7 } })), out = h.view.html(xOf(h.state), false);
  assert.equal((out.match(/class="ui-btn ui-btn--quiet rv-btn sm gl-now-b"/g) || []).length, 4, '+5, +15, Clear, Set');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, FILE), 'utf8'), /<button\b/, 'no hand-built button (the ratchet)');
  const win = { B68GmBall: B }; win.self = win; win.window = win;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, FILE), 'utf8'), win, { filename: FILE });
  const bare = win.B68GmGlanceNow.create({ run: () => ({ pcs: () => PCS }) }).html(xOf(at({})), false);
  assert.match(text(bare), /^Fiction 21:45Crew Nell Arbuthnot/);
  assert.match(bare, /<form class="gl-now-form" data-site="gln-set"/, 'Enter in the time box still sets it');
});

test('act: +5 and +15 write ball.fic quietly (no map push) and redraw; Clear removes it', () => {
  const h = host(at({}));
  assert.equal(h.view.act('gln-add', el({ 'data-min': 5 })), true);
  assert.deepEqual(h.sets[0], { c: { fic: { b: 45, off: 5 } }, quiet: true });
  assert.equal(h.redraws, 1);
  h.view.act('gln-add', el({ 'data-min': 15 }));
  assert.deepEqual(h.sets[1].c, { fic: { b: 45, off: 20 } });
  assert.equal(label(G.ficT(h.state)), '22:05');
  h.view.act('gln-clear', el({}));
  assert.deepEqual(h.sets[2].c, { fic: null });
  assert.equal(G.ficT(h.state), 45);
});
test('act: a typed time sets it; a bad one, or one before the start (past the 12 hours), says so and writes nothing', () => {
  const h = host(at({}));
  h.view.act('gln-set', el({}, '22:10'));
  assert.deepEqual(h.sets[0].c, { fic: { b: 45, off: 25 } });
  h.view.act('gln-set', el({}, 'soon'));
  h.view.act('gln-set', el({}, '20:50'));      /* before the night's 21:00 start reads as the next day */
  assert.equal(h.sets.length, 1);
  assert.equal(h.toasts.length, 2);
  assert.ok(h.toasts.every((x) => x[1] === true));
  const h2 = host({ t: 0 });
  h2.view.act('gln-add', el({ 'data-min': 5 }));
  assert.equal(h2.sets.length, 0);
  assert.match(h2.toasts[0][0], /Start the night first/);
});
test('act: only the gln- actions are this block\'s', () => {
  const h = host(at({}));
  assert.equal(h.view.act('spotted', el({})), false);
  assert.equal(h.view.act('', el({})), false);
  assert.equal(h.sets.length, 0);
});

test('secrecy: the module is fetched by the GM page only (the gm-glance bundle), and it makes no request', () => {
  const routes = fs.readFileSync(path.join(ROOT, 'app/routes.js'), 'utf8').split('\n').filter((l) => l.includes("'gm/glance-now.js'"));
  assert.equal(routes.length, 1, 'one bundle lists it');
  assert.match(routes[0], /^\s*'gm-glance':\s*\[/, 'the gm-glance bundle');
  for (const f of ['app/boot.js', 'app/display-page.js', 'app/tracker.js']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, f), 'utf8'), /gm-glance|glance-now|B68GmGlanceNow/, f + ' never asks for it');
  }
  assert.match(fs.readFileSync(path.join(ROOT, 'app/gm-page.js'), 'utf8'), /\['gm\.glance', 'gm-glance'\]/, 'the GM page asks for it, only while gm.glance is on');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, FILE), 'utf8'), /\bfetch\(|XMLHttpRequest|pushDisplay|sendBeacon|localStorage/, 'no request, no device storage');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
