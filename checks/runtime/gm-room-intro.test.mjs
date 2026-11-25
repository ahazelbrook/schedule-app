// gm-room-intro (RK29 of the room key build, setting room.intro): the GM half of the room opening and its server contract. No browser, no network.
//   - off: playerDisplay's answer is the base's (ea4c0099), deep-equal, across views, bands and opened rooms; P.riWrap(null, o) is o itself; the
//     live push and Show on iPad read as before (source)
//   - on, with the real map kit and the INVENTED Palazzo Rooms (kit: 1, 12 rooms on four floors): one room opened gives that room with the PLAYER
//     copy's id and number (from the sent render's model); a band ticked gives only its newly shown rooms; a blueprint room seen in full counts, a
//     room known as a blueprint only does not; a hidden room never appears; the first show, a view change and a marker push carry nothing; a room
//     not drawn in the sent svg is left out; at most 8; the floors of the new rooms are tagged (two floors sharing a shape are told apart), ids
//     only, so leaks() is unchanged
//   - the push: arrive is added at send time against what the iPad has landed (a marker push queued behind a room push names nothing again)
//   - the tray: "Opening <room> on the iPad" while the card plays, then the ordinary line
//   - the server (functions/_lib/gm.js cleanDisplay, through the real display handler on an in-memory D1): arrive kept on svg only, entries cleaned,
//     junk dropped (never a 400), at most 8; the display GET serves it
// INVENTED data only: the Palazzo Rooms (palazzo-kit1.json); GM-ONLY- markers.
//   node checks/runtime/gm-room-intro.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { onRequest as displayHandler } from '../../functions/api/gm/display.js';
import { cleanDisplay, cleanArrive, checkSvg } from '../../functions/_lib/gm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/room-intro.js';
const RI = require(path.join(ROOT, FILE));
const G = require(path.join(ROOT, 'app', 'gm', 'scene-state.js'));
const L = require(path.join(ROOT, 'app', 'gm', 'location.js'));
const K = require(path.join(ROOT, 'app', 'maps', 'map-kit.js'));
const Tray = require(path.join(ROOT, 'app', 'gm', 'ipad-tray.js'));
const P = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
P.sceneMod = G;
const BASE = 'ea4c0099';
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

/* a module as it was at a commit, loaded from a temp copy (null when git cannot show it) */
function atCommit(rev, rel) {
  const r = spawnSync('git', ['show', rev + ':' + rel], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-rk29-')), f = path.join(dir, path.basename(rel));
  fs.writeFileSync(f, r.stdout);
  try { return require(f); } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* harmless */ } }
}
const OLD = atCommit(BASE, 'app/gm-page.js'), OLDP = OLD && OLD._pure;
if (OLDP) OLDP.sceneMod = G;

/* ---------- the invented site ---------- */
const FIXL = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'location-pack.json'), 'utf8'));
const PALAZZO = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'palazzo-kit1.json'), 'utf8'));
const ROLL = P.authoredRoll(L, FIXL, PALAZZO);
const withOn = (on, fn) => { const a = P.riOn, b = P.roomIntro, c = P.kit1On, d = OLDP && OLDP.kit1On; P.riOn = () => on; P.roomIntro = RI; P.kit1On = () => true; if (OLDP) OLDP.kit1On = () => true; try { return fn(); } finally { P.riOn = a; P.roomIntro = b; P.kit1On = c; if (OLDP) OLDP.kit1On = d; } };
const MAP = (reveal, extra) => Object.assign(JSON.parse(JSON.stringify(P.MAP0)), { layer: 'player', view: 'iso', theme: 'rulebook', reveal, open: [], know: [] }, extra || {});
const NOTK = () => ({ tokens: [], hide: [], sig: '' });
/* playerDisplay with the real kit, and the render that was sent (its svg is d.svg) */
function shown(reveal, extra, P2 = P) {
  const calls = [], render = (r, o) => { const x = K.render(r, o); calls.push(x); return x; };
  const d = P2.playerDisplay(ROLL, MAP(reveal, extra), render, NOTK());
  return { d, sent: calls.filter((c) => c.svg === d.svg || (d.rooms && c.model && JSON.stringify(RI.rooms(c)) === JSON.stringify(d.rooms)))[0] };
}
const PUB = { public: true }, WORK = { public: true, working: true }, ALL = { public: true, working: true, controlled: true, secure: true };
/* the live push for a change from `was` (what the iPad shows) to `now`: prep, then the wrapped prepare against `landed` (default: was) */
function push(was, now, o = {}) {
  return withOn(true, () => {
    const a = shown(was.reveal, was.extra), b = shown(now.reveal, now.extra);
    const ri = RI.prep(b.d, { roll: ROLL, was: { reveal: a.d.reveal, know: (was.extra && was.extra.know) || [] }, know: (now.extra && now.extra.know) || [], landed: () => 'landed' in o ? o.landed : { reveal: a.d.reveal, know: (was.extra && was.extra.know) || [] } });
    if (!ri) return { a, b, ri, body: null };
    const opts = ri.wrap({ prepare: (body) => (o.refuse ? null : Object.assign({}, body, { ifSeq: 7 })), done: () => {} });
    const body = opts.prepare({ kind: 'svg', title: ri.d.title, caption: ri.d.caption, svg: ri.d.svg });
    return { a, b, ri, opts, body };
  });
}
const names = (arr) => (arr || []).map((e) => e.name);

/* ---------- 1. the module ---------- */
await test('the module loads under Node, and as a plain script defines window.B68GmRoomIntro: no longer a stub', () => {
  assert.ok(RI && typeof RI.prep === 'function' && typeof RI.rooms === 'function' && typeof RI.live === 'function' && !RI.stub);
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(read(FILE), win, { filename: FILE });
  assert.ok(win.B68GmRoomIntro && typeof win.B68GmRoomIntro.prep === 'function', 'B68GmRoomIntro is defined');
  assert.equal(RI.CARD_MS, 800 + 6600, 'the lead and the card');
});

/* ---------- 2. off means today ---------- */
await test('off: playerDisplay answers exactly as ' + BASE + ' did (deep-equal, no rooms key), across views, bands, rooms opened and blueprints; P.riMod() is null', () => {
  if (!OLDP) { console.log('  (skipped: git cannot show ' + BASE + ')'); return; }
  let n = 0;
  for (const on of [false, true]) {
    const a = P.riOn, b = P.roomIntro, k1 = P.kit1On, k2 = OLDP.kit1On;
    P.riOn = () => false; P.roomIntro = on ? RI : undefined; P.kit1On = () => true; OLDP.kit1On = () => true;
    try {
      assert.equal(P.riMod(), null);
      for (const view of ['iso', 'plan', 'rings']) for (const reveal of [PUB, WORK, ALL]) for (const extra of [{}, { open: ['Library'] }, { open: ['Library'], know: ['Library'] }, { time: 'Night' }]) {
        const x = OLDP.playerDisplay(ROLL, MAP(reveal, Object.assign({ view }, extra)), (r, o) => K.render(r, o), NOTK());
        const y = P.playerDisplay(ROLL, MAP(reveal, Object.assign({ view }, extra)), (r, o) => K.render(r, o), NOTK());
        assert.deepEqual(y, x); assert.ok(!('rooms' in y)); n++;
      }
    } finally { P.riOn = a; P.roomIntro = b; P.kit1On = k1; OLDP.kit1On = k2; }
  }
  assert.ok(n >= 72, n + ' maps compared');
});
await test('off: the live push\'s options are the very object (P.riWrap(null, o) is o), the push line still sends kind, title, caption and svg only, and Show on iPad is untouched', () => {
  const o = { map: true }; assert.equal(P.riWrap(null, o), o);
  const src = read('app/gm-page.js');
  assert.match(src, /var ri = P\.riMod\(\) \? P\.riMod\(\)\.prep\(d, \{[^\n]*\}\) : null; if \(ri\) d = ri\.d;/, 'liveReveal: prep only when the module is on');
  assert.match(src, /pushDisplay\(\{ kind: 'svg', title: d\.title, caption: d\.caption, svg: d\.svg \}, P\.riWrap\(ri, \{/, 'liveReveal: the same body, the options wrapped only when ri');
  assert.match(src, /return pushDisplay\(\{ kind: 'svg', title: d\.title, caption: d\.caption, svg: d\.svg \}, \{\n      map: true,\n      done:/, 'Show on iPad (the first show): never arrive');
  assert.equal((src.match(/P\.riWrap\(/g) || []).length, 1, 'the one live push');
  assert.match(src, /if \(P\.riMod\(\)\) d\.rooms = P\.riMod\(\)\.rooms\(r\);/, 'playerDisplay keeps the sent render\'s rooms only when on');
  /* the ipad tray: no opening in the snapshot, the line as before */
  assert.equal(Tray.liveItems({ shown: { kind: 'svg', title: 'The Palazzo Rooms' }, doc: null, now: 1, opening: '' })[0].text, Tray.liveItems({ shown: { kind: 'svg', title: 'The Palazzo Rooms' }, doc: null, now: 1 })[0].text);
});

/* ---------- 3. on, the real kit ---------- */
await test('on: playerDisplay keeps the SENT render\'s rooms as d.rooms (ids and numbers of the player copy, floor titles, shapes); the rest of d is as off', () => {
  withOn(true, () => {
    const { d, sent } = shown(PUB, { open: ['Library'] });
    assert.ok(Array.isArray(d.rooms) && d.rooms.length === 12, 'every room of the model');
    assert.deepEqual(d.rooms, RI.rooms(sent), 'the model of the render whose svg was sent');
    const lib = d.rooms.find((r) => r.name === 'Library');
    assert.ok(/^r\d+$/.test(lib.id) && lib.n >= 1 && lib.floor === 'Upper floor' && lib.pts.length >= 4, JSON.stringify(lib));
    const off = withOn(false, () => shown(PUB, { open: ['Library'] }).d), copy = Object.assign({}, d); delete copy.rooms;
    assert.deepEqual(copy, off, 'nothing else changes');
  });
});
await test('one room opened gives that room, with the player copy\'s id and number (the kit renumbers: the same room is another id in another push)', () => {
  const r = push({ reveal: PUB }, { reveal: PUB, extra: { open: ['Private card rooms'] } });
  assert.deepEqual(names(r.body.arrive), ['Private card rooms']);
  const e = r.body.arrive[0], m = r.b.d.rooms.find((x) => x.name === 'Private card rooms');
  assert.deepEqual(e, { id: m.id, n: m.n, name: 'Private card rooms', band: 'controlled', floor: 'Upper floor' });
  const later = withOn(true, () => shown(ALL).d.rooms.find((x) => x.name === 'Private card rooms'));
  assert.notEqual(later.n, e.n, 'with every band open it is another number (' + later.n + ' vs ' + e.n + '): the id must come from the push that was sent');
  assert.ok(new RegExp('<polygon[^>]*data-room="' + e.id + '"').test(r.body.svg), 'its floor is tagged in the svg sent');
  assert.deepEqual(Object.keys(r.body), ['kind', 'title', 'caption', 'svg', 'ifSeq', 'arrive'], 'arrive rides beside the body as it was');
});
await test('a band ticked gives only its newly shown rooms, in the roll\'s order (a room already open on its own is not named again)', () => {
  const r = push({ reveal: PUB, extra: { open: ['Gallery'] } }, { reveal: WORK, extra: { open: ['Gallery'] } });
  assert.deepEqual(names(r.body.arrive), ['Security control room', 'Underground counting room', 'Wine cellar', 'Servants hall']);
  assert.ok(r.body.arrive.every((e) => e.band === 'working'));
  for (const e of r.body.arrive) assert.ok(new RegExp('<polygon[^>]*data-room="' + e.id + '"').test(r.body.svg), e.name + ': its floor is tagged');
});
await test('two rooms on two floors with the same shape and band are told apart by their floor (each polygon tagged with its own room)', () => {
  const r = push({ reveal: PUB }, { reveal: WORK });
  const sec = r.b.d.rooms.find((x) => x.name === 'Security control room'), und = r.b.d.rooms.find((x) => x.name === 'Underground counting room');
  assert.deepEqual(sec.pts, und.pts, 'the fixture holds the case: the same shape on the upper floor and the basement');
  const tags = (r.body.svg.match(/<polygon[^>]*data-room="(r\d+)"/g) || []).map((t) => t.match(/data-room="(r\d+)"/)[1]);
  assert.ok(tags.includes(sec.id) && tags.includes(und.id) && tags.filter((t) => t === sec.id).length === 1 && tags.filter((t) => t === und.id).length === 1, tags.join(' '));
  /* the right one: each tagged polygon sits in a group whose other floor matches a room of the same floor */
  const t = RI.Pure.tagFloors(r.b.d.svg, r.b.d.rooms, null);
  const drawnRooms = r.b.d.rooms.filter((x) => P.roomShown(ROLL.rooms.find((y) => y.name === x.name), r.b.d.reveal)).length;
  assert.equal(t.tagged, drawnRooms, 'with every room asked for, every drawn floor is tagged once (no secure tone at these bands)');
});
await test('a blueprint room (known from intel: a name and an outline) seen in full counts; becoming a blueprint does not', () => {
  const r = push({ reveal: PUB, extra: { open: ['Library'], know: ['Library'] } }, { reveal: PUB, extra: { open: ['Library'] } });
  assert.deepEqual(names(r.body.arrive), ['Library'], 'seen in full');
  const k = push({ reveal: PUB }, { reveal: PUB, extra: { know: ['Library'] } });
  assert.equal(k.ri, null, 'a blueprint only: no card');
  assert.deepEqual(RI.Pure.fullNames(ROLL, ['public', 'room:Library'], ['Library']), ['Showroom', 'Cocktail lounge', 'Boat house']);
});
await test('a hidden room never appears: arrive holds only rooms the sent reveal shows, and none of the hidden names the page\'s own scan knows', () => {
  for (const [was, now] of [[{ reveal: PUB }, { reveal: WORK }], [{ reveal: PUB }, { reveal: PUB, extra: { open: ['Library'] } }], [{ reveal: WORK }, { reveal: ALL }]]) {
    const r = push(was, now), sentReveal = r.b.d.reveal, hidden = P.hiddenNames(ROLL, sentReveal);
    for (const e of r.body.arrive) {
      const room = ROLL.rooms.find((x) => x.name === e.name);
      assert.ok(P.roomShown(room, sentReveal), e.name + ' is shown');
      assert.ok(!hidden.includes(P.fold(e.name)), e.name + ' is not a hidden name');
    }
    assert.deepEqual(P.leaks(r.body.svg, ROLL, sentReveal), [], 'the tagged svg is as clean as the scan said');
    assert.ok(!/GM-ONLY/.test(JSON.stringify(r.body.arrive)));
  }
});
await test('nothing newly shown, nothing sent: the same reveal (a marker push), a change of view, theme, time or weather', () => {
  for (const extra of [{}, { view: 'plan' }, { theme: 'casefile' }, { time: 'Night' }, { weather: 'rain' }]) {
    const r = push({ reveal: WORK }, { reveal: WORK, extra });
    assert.equal(r.ri, null, JSON.stringify(extra));
  }
});
await test('at send time: a room the iPad has meanwhile landed (a marker push queued behind the room\'s push) is not named again; a push the page drops stays dropped', () => {
  const was = { reveal: PUB }, now = { reveal: PUB, extra: { open: ['Library'] } };
  const landed = withOn(true, () => shown(PUB, { open: ['Library'] }).d.reveal);
  const r = push(was, now, { landed: { reveal: landed, know: [] } });
  assert.ok(r.ri && r.ri.cands.length === 1, 'a candidate when drawn');
  assert.ok(!('arrive' in r.body), 'but the iPad has it already: no arrive, the body as it was');
  const g = push(was, now, { landed: null });
  assert.ok(!('arrive' in g.body), 'live ended (no S.mapOn): nothing');
  const x = push(was, now, { refuse: true });
  assert.equal(x.body, null, 'the page\'s own prepare refused the push: still refused');
});
await test('only rooms drawn in the svg sent count (a room on a floor the iPad is not showing is left out)', () => {
  const roll = { rooms: [{ name: 'Showroom', band: 'public' }, { name: 'Library', band: 'controlled' }] };
  const rooms = [{ id: 'r1', n: 1, name: 'Showroom', band: 'public', floor: 'Ground floor' }, { id: 'r2', n: 2, name: 'Library', band: 'controlled', floor: 'Upper floor' }];
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><g data-room="r1"><rect/></g></svg>';
  assert.deepEqual(RI.Pure.entries(roll, [0, 1], rooms, svg).map((c) => c.e.id), ['r1'], 'the Library is not in this svg');
  const badge = '<svg xmlns="http://www.w3.org/2000/svg"><g class="room-label room-pin"><rect x="1"/><text x="2">2</text></g></svg>';
  assert.deepEqual(RI.Pure.entries(roll, [1], rooms, badge).map((c) => c.e.id), ['r2'], 'its number badge alone counts');
});
await test('more than 8 at once: 8 entries go, with arriveTotal, the true count; the tray says it too; 8 or fewer carry no arriveTotal', () => {
  RI._reset();
  const r = push({ reveal: PUB }, { reveal: ALL });
  assert.equal(r.body.arrive.length, 8, 'eight named');
  assert.equal(r.body.arriveTotal, 9, 'nine opened: the true count rides beside them');
  r.opts.done({ seq: 11 });
  assert.equal(RI.live({ kind: 'svg', title: r.ri.d.title }, Date.now()), '9 rooms', 'the tray: the true count');
  const w = push({ reveal: PUB }, { reveal: WORK });
  assert.ok(!('arriveTotal' in w.body), 'five: no arriveTotal');
  assert.deepEqual(RI.Pure.body({ kind: 'svg' }, []), { kind: 'svg' }, 'none: the body as it was');
  const twelve = Array.from({ length: 12 }, (_, i) => ({ i, e: { id: 'r' + i, name: 'Room ' + i, band: 'public' } }));
  const b = RI.Pure.body({ kind: 'svg' }, twelve);
  assert.equal(b.arrive.length, 8); assert.equal(b.arriveTotal, 12);
  const svg0 = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>';
  assert.deepEqual(cleanDisplay({ kind: 'svg', svg: svg0, arrive: b.arrive, arriveTotal: b.arriveTotal }).arriveTotal, 12, 'the server keeps it');
  for (const bad of [8, 7, 12.5, '12', 1000, -1, null]) assert.ok(!('arriveTotal' in cleanDisplay({ kind: 'svg', svg: svg0, arrive: b.arrive, arriveTotal: bad })), 'dropped: ' + bad);
  assert.ok(!('arriveTotal' in cleanDisplay({ kind: 'svg', svg: svg0, arriveTotal: 12 })), 'no arrive: no arriveTotal');
  assert.ok(!('arriveTotal' in cleanDisplay({ kind: 'text', text: 'x', arrive: b.arrive, arriveTotal: 12 })), 'not on another kind');
});
await test('rooms are compared room by room, never by name: a room opened beside a shown room of the same name (another band) still gets its card', () => {
  /* an invented twin: the palazzo with its controlled Library renamed to a working room's name, Gallery (shown once Working is ticked) */
  const twin = JSON.parse(JSON.stringify(ROLL)); twin.rooms.find((x) => x.name === 'Library').name = 'Gallery';
  const run = (reveal, extra) => withOn(true, () => { const calls = []; const d = P.playerDisplay(twin, MAP(reveal, extra), (r2, o) => { const x = K.render(r2, o); calls.push(x); return x; }, NOTK()); return d; });
  const a = run(WORK), b = run({ public: true, working: true, controlled: true });
  const ri = withOn(true, () => RI.prep(b, { roll: twin, was: { reveal: a.reveal, know: [] }, know: [], landed: () => ({ reveal: a.reveal, know: [] }) }));
  const body = ri.wrap({ prepare: (x) => x }).prepare({ kind: 'svg', svg: ri.d.svg });
  const ctl = body.arrive.filter((e) => e.name === 'Gallery');
  assert.equal(ctl.length, 1, 'the controlled Gallery is named once: ' + JSON.stringify(body.arrive));
  assert.equal(ctl[0].band, 'controlled', 'and it is the controlled one, not the working Gallery already shown');
  assert.equal(ctl[0].id, b.rooms.find((x) => x.name === 'Gallery' && x.band === 'controlled').id, 'its id is the controlled room\'s');
  assert.deepEqual(body.arrive.map((e) => e.band).sort(), ['controlled', 'controlled', 'controlled'], 'every controlled room, and nothing of Working');
  /* opened on its own by name: room:Gallery shows both rooms of that name; the working one is already up, so only the controlled one arrives */
  const c = run(WORK, { open: ['Gallery'] });
  const ri2 = withOn(true, () => RI.prep(c, { roll: twin, was: { reveal: a.reveal, know: [] }, know: [], landed: () => ({ reveal: a.reveal, know: [] }) }));
  const b2 = ri2.wrap({ prepare: (x) => x }).prepare({ kind: 'svg', svg: ri2.d.svg });
  assert.deepEqual(b2.arrive.map((e) => e.name + '/' + e.band), ['Gallery/controlled']);
});
await test('the tag is an id only (never a name), a polygon already tagged is left alone, and a tagged copy over the cap goes untagged', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><g transform="matrix(1 0 0 1 0 0)"><polygon points="0,0 10,0 10,10 0,10" fill="#eee" data-band="public"/><polygon points="0,0 10,0 10,10 0,10" data-band="public" data-room="r9"/></g></svg>';
  const t = RI.Pure.tagFloors(svg, [{ id: 'r3', name: 'GM-ONLY-ROOM', band: 'public', lvl: 0, pts: [[0, 0], [10, 0], [10, 10], [0, 10]] }], ['r3']);
  assert.equal(t.tagged, 1); assert.ok(t.svg.includes('data-band="public" data-room="r3"/>') && t.svg.includes('data-room="r9"') && !t.svg.includes('GM-ONLY'), t.svg);
  assert.equal(RI.Pure.tagFloors(svg, [{ id: 'r3', band: 'public', lvl: 0, pts: [[0, 0], [10, 0], [10, 10], [0, 10]] }], ['r4']).tagged, 0, 'a room not asked for is not tagged');
  assert.doesNotThrow(() => checkSvg(t.svg), 'the server takes the tagged svg');
  const cap = RI.Pure.CAP;
  try {
    RI.Pure.CAP = 10;
    const r = push({ reveal: PUB }, { reveal: PUB, extra: { open: ['Wine cellar'] } });
    assert.equal(r.body.svg, r.b.d.svg, 'over the cap: the svg as drawn');
  } finally { RI.Pure.CAP = cap; }
});
await test('the tray: "Opening <room> on the iPad" while the card plays (a band: "N rooms"), then the ordinary line; a later map, or another title, says what it is', () => {
  RI._reset();
  const r = push({ reveal: PUB }, { reveal: PUB, extra: { open: ['Library'] } });
  const t0 = Date.now(); r.opts.done({ seq: 8 });
  const title = r.ri.d.title, shownNow = { kind: 'svg', title };
  assert.equal(RI.live(shownNow, t0 + 10), 'Library');
  assert.equal(Tray.liveItems({ shown: shownNow, doc: null, now: t0, opening: RI.live(shownNow, t0 + 10) })[0].text, 'Opening Library on the iPad');
  assert.equal(RI.live(shownNow, t0 + RI.CARD_MS + 50), '', 'after the card');
  assert.equal(RI.live({ kind: 'npc', title: 'Mabel Quist' }, t0 + 10), '', 'something else pushed since');
  const b = push({ reveal: PUB }, { reveal: WORK }); b.opts.done({ seq: 9 });
  assert.equal(RI.live(shownNow, Date.now()), '5 rooms');
  assert.equal(Tray.liveItems({ shown: shownNow, doc: null, now: 1, intro: 'Mabel Quist', opening: 'Library' })[0].text, 'Introducing Mabel Quist', 'an introduction wins');
  RI._reset();
  const n = push({ reveal: PUB }, { reveal: PUB, extra: { open: ['Library'] } }, { landed: { reveal: ['public', 'room:Library'], know: [] } }); n.opts.done({ seq: 10 });
  assert.equal(RI.live(shownNow, Date.now()), '', 'no arrive went: no tray line');
});

/* ---------- 4. the server ---------- */
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g data-room="r1"><rect width="1" height="1"/></g></svg>';
await test('cleanDisplay: arrive is kept on an svg display, entries cleaned; on any other kind it is dropped; junk is dropped, never a 400; at most 8', () => {
  const good = { id: 'r3', n: 4, name: 'Library', band: 'controlled', floor: 'Upper floor' };
  assert.deepEqual(cleanDisplay({ kind: 'svg', title: 'The Palazzo Rooms', svg: SVG, arrive: [Object.assign({ junk: 'GM-ONLY-1' }, good)] }),
    { kind: 'svg', title: 'The Palazzo Rooms', caption: '', svg: SVG, arrive: [good] });
  assert.deepEqual(cleanDisplay({ kind: 'svg', svg: SVG }), { kind: 'svg', title: '', caption: '', svg: SVG }, 'no arrive: as before');
  assert.deepEqual(cleanDisplay({ kind: 'svg', svg: SVG, arrive: 'Library' }), { kind: 'svg', title: '', caption: '', svg: SVG }, 'not a list: dropped');
  assert.deepEqual(cleanDisplay({ kind: 'svg', svg: SVG, arrive: [] }), { kind: 'svg', title: '', caption: '', svg: SVG }, 'empty: no key');
  for (const kind of ['blank', 'text']) assert.ok(!('arrive' in cleanDisplay({ kind, text: 'x', arrive: [good] })), kind + ': dropped');
  assert.ok(!('arrive' in cleanDisplay({ kind: 'npc', npcId: 'n-ada', arrive: [good] })), 'npc: dropped');
  const bad = [null, 'r3', { ...good, id: 'room3' }, { ...good, id: 'r1000' }, { ...good, n: 0 }, { ...good, n: 1.5 }, { ...good, n: '4' }, { ...good, n: 1000 },
    { ...good, name: '' }, { ...good, name: 'x'.repeat(81) }, { ...good, name: 7 }, { ...good, band: 'hidden' }, { ...good, floor: 'GM-ONLY-FLOOR' }, { ...good, floor: 3 }];
  assert.deepEqual(cleanArrive(bad.concat([good])), [good], 'every bad entry goes, the good one stays');
  const opt = cleanArrive([{ id: 'r0', name: 'Showroom', band: 'public' }]);
  assert.deepEqual(opt, [{ id: 'r0', name: 'Showroom', band: 'public' }], 'n and floor are optional');
  assert.equal(cleanArrive(Array.from({ length: 12 }, (_, i) => ({ id: 'r' + i, name: 'Room ' + i, band: 'public' }))).length, 8, 'at most 8');
  assert.deepEqual(cleanArrive([{ ...good, floor: 'upper floor' }])[0].floor, 'upper floor', 'a floor title in any case');
});
const GMU = { me: { role: 'gm', email: 'gm@example.test' } }, DISPLAY = { me: { role: 'display', email: 'table@example.test' } };
async function freshDb() { const raw = asD1(await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') })); return { prepare: (q) => raw.prepare(q), batch: (l) => raw.batch(l), raw }; }
const call = async (db, method, url, body, who = GMU) => {
  try { return await displayHandler({ request: new Request('http://x.test' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env: { DB: db }, data: who, waitUntil() {} }); }
  catch (e) { if (e && Number.isInteger(e.status)) return new Response(JSON.stringify({ error: e.message }), { status: e.status }); throw e; }
};
await test('the display GET (the iPad): a live push with arrive is served with it and updatedAt; junk in the PUT is a 200 with the junk gone; the next push without arrive has none', async () => {
  const db = await freshDb();
  const put = await call(db, 'PUT', '/api/gm/display', { kind: 'svg', title: 'The Palazzo Rooms', caption: 'surveyed: public', svg: SVG, arrive: [{ id: 'r1', n: 1, name: 'Showroom', band: 'public', floor: 'Ground floor' }, { id: 'GM-ONLY-1', name: 'x', band: 'public' }] });
  assert.equal(put.status, 200);
  const g = await (await call(db, 'GET', '/api/gm/display?seq=-1&aseq=-1&sseq=-1&hseq=-1', undefined, DISPLAY)).json();
  assert.deepEqual(g.display.arrive, [{ id: 'r1', n: 1, name: 'Showroom', band: 'public', floor: 'Ground floor' }]);
  assert.ok(typeof g.updatedAt === 'string' && !JSON.stringify(g).includes('GM-ONLY'), 'the card\'s clock rides, and no junk');
  await call(db, 'PUT', '/api/gm/display', { kind: 'svg', title: 'The Palazzo Rooms', svg: SVG });
  const h = await (await call(db, 'GET', '/api/gm/display?seq=-1&aseq=-1&sseq=-1&hseq=-1', undefined, DISPLAY)).json();
  assert.ok(!('arrive' in h.display), 'the next push: none');
});

/* ---------- 5. the files ---------- */
await test('the files: no markup sink, no request, no native dialog, no literal over 220 characters, no stray characters; the bundle is the registrar\'s', () => {
  const code = read(FILE).replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code), 'a markup sink');
  assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/.test(code), 'a request');
  assert.ok(!/confirm\(|prompt\(|alert\(/.test(code), 'a native dialog');
  for (const m of code.match(/'(?:[^'\\\n]|\\.)*'/g) || []) assert.ok(m.length <= 222, 'a literal over 220: ' + m.slice(0, 60));
  assert.ok(![...read(FILE)].some((c) => c.codePointAt(0) >= 0x80 && c.codePointAt(0) <= 0x9f));
  const R = require(path.join(ROOT, 'app', 'routes.js')), B = (R && R.BUNDLES) || (globalThis.B68Load && globalThis.B68Load.BUNDLES);
  assert.deepEqual(B['room-intro'], ['display/room-intro.css', 'gm/room-intro.js', 'display/room-intro.js']);
  assert.match(read('app/gm-page.js'), /\['room\.intro', 'room-intro'\]/, 'the GM page asks for it only while the setting is on (P.rkWant)');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
