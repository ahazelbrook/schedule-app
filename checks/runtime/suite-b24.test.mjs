// Suite B24: 2.2 the three knowledge states (map.knowledge) and 2.10 the score title card (map.title).
//   2.2: the states module (gm/knowledge.js), the kit's blueprint rooms on the player copy, the page's reveal and options, and the secrecy rule: a dark room is
//        never in the player copy, a blueprint room is in it as linework only.
//   2.10: the show kind on the server, the GM's wiring, the display's renderer and the title card's generator (what it carries, what it never can).
// INVENTED data only: the Pelican Rooms (fixtures/gm/pelican-kit1.json). Every GM-only string is a GM-ONLY- marker.
//   node checks/runtime/suite-b24.test.mjs
import path from 'node:path';
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sites, sha } from './fixtures/gm/map-kit1-cases.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const require = createRequire(import.meta.url);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

globalThis.self = globalThis;
const Features = require(path.join(APP, 'features.js'));
const KN = require(path.join(APP, 'gm', 'knowledge.js'));
const K = require(path.join(APP, 'maps', 'map-kit.js'));
const P = require(path.join(APP, 'gm-page.js'))._pure;
const Routes = (() => { const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(APP, 'routes.js'), 'utf8'), ctx, { filename: 'routes.js' }); return ctx.window.B68Load; })();
const S = sites(), PLN = S.pelican, PK1 = S.pelicanK1;
const MARK = 'GM-ONLY-b24-marker';

/* ====================================================================== 2.2 ====================================================================== */
await test('map.knowledge is registered, default off, bland, a GM switch on the map stage; a flipped doc turns it on alone', () => {
  const s = Features.get('map.knowledge');
  assert.ok(s); assert.equal(s.default, false); assert.equal(s.surface, 'gm'); assert.equal(s.stage, 'map');
  assert.ok(s.label && s.doc && !/GM-ONLY/.test(s.doc));
  assert.equal(Features.valueOf({}, 'map.knowledge'), false);
  assert.equal(Features.valueOf({ features: { 'map.knowledge': true } }, 'map.knowledge'), true);
  assert.equal(Features.valueOf({ features: { 'map.knowledge': true } }, 'map.kit1'), false);
});

const ROOMS = [{ name: 'Showroom', band: 'public' }, { name: 'Cocktail lounge', band: 'public' }, { name: 'Security control room', band: 'working' },
  { name: 'Private card rooms', band: 'controlled' }, { name: 'Underground counting room', band: 'working' }, { name: 'Luxury penthouse', band: 'secure' }];
const ctx0 = { open: [], know: [], bands: ['public'] };

await test('the states: a room is dark, blueprint or seen; its band ticked makes it seen and locked; open beats know', () => {
  const st = (n, c) => KN.stateOf(ROOMS.find((r) => r.name === n), c);
  assert.equal(st('Security control room', ctx0), 'dark');
  assert.equal(st('Security control room', { open: [], know: ['Security control room'], bands: ['public'] }), 'blueprint');
  assert.equal(st('Security control room', { open: ['Security control room'], know: ['Security control room'], bands: ['public'] }), 'seen');
  assert.equal(st('Showroom', ctx0), 'seen');
  assert.equal(st('Security control room', { open: [], know: [], bands: ['public', 'working'] }), 'seen');
  assert.equal(KN.locked(ROOMS[0], ctx0), true); assert.equal(KN.locked(ROOMS[2], ctx0), false);
  assert.deepEqual(KN.STATES, ['dark', 'blueprint', 'seen']);
  assert.deepEqual(['dark', 'blueprint', 'seen'].map(KN.next), ['blueprint', 'seen', 'dark']);
});

await test('setState keeps the two lists apart, in order, and drops a name from the list it leaves', () => {
  let l = { open: ['A'], know: ['B', 'C'] };
  l = KN.setState('B', 'seen', l); assert.deepEqual(l, { open: ['A', 'B'], know: ['C'] });
  l = KN.setState('A', 'blueprint', l); assert.deepEqual(l, { open: ['B'], know: ['C', 'A'] });
  l = KN.setState('C', 'dark', l); assert.deepEqual(l, { open: ['B'], know: ['A'] });
  assert.deepEqual(KN.setState('B', 'nonsense', l), l);
  const none = KN.setState('X', 'seen', { open: 'x', know: [5, null, 'K'] }); assert.deepEqual(none, { open: ['X'], know: ['K'] });
});

await test('Intel: every dark room of a group becomes blueprint; a seen room, a room of an open band and an unknown name are left alone', () => {
  const c = { open: ['Private card rooms'], know: [], bands: ['public'] };
  const out = KN.intel(ROOMS, ['Security control room', 'Underground counting room', 'Private card rooms', 'Showroom', 'No such room'], c);
  assert.deepEqual(out.know, ['Security control room', 'Underground counting room']);
  assert.deepEqual(out.open, ['Private card rooms']);
  const g = KN.groups(ROOMS, [{ name: 'Ground', names: ['Showroom', 'Cocktail lounge', 'Nowhere'] }, { name: 'Empty', names: [] }]);
  assert.deepEqual(g.map((x) => x.id), ['band:working', 'band:controlled', 'band:secure', 'floor:0']);
  assert.deepEqual(g[0].names, ['Security control room', 'Underground counting room']);
  assert.deepEqual(g[3].names, ['Showroom', 'Cocktail lounge']);
  assert.equal(KN.signature(['b', 'a']), KN.signature(['a', 'b'])); assert.notEqual(KN.signature(['a']), KN.signature(['a', 'b']));
});

function fake(on, start) {
  const log = [], st = { open: (start && start.open || []).slice(), know: (start && start.know || []).slice(), bands: (start && start.bands) || ['public'] };
  const host = { feature: (id) => on && id === 'map.knowledge', rooms: () => ROOMS, ctx: () => st, floors: () => [{ name: 'Ground', names: ['Showroom', 'Cocktail lounge'] }],
    write: (o, k) => { st.open = o; st.know = k; log.push(['write', o.slice(), k.slice()]); return true; }, toast: (m, bad) => log.push(['toast', m, !!bad]), changed: () => log.push(['changed']) };
  return { c: KN.create(host), log, st };
}

await test('the controller: a tap cycles dark, blueprint, seen, dark; a room whose band is open says so and writes nothing', () => {
  const { c, log, st } = fake(true);
  assert.equal(c.active(), true);
  c.cycle('Security control room'); assert.deepEqual([st.open, st.know], [[], ['Security control room']]);
  c.cycle('Security control room'); assert.deepEqual([st.open, st.know], [['Security control room'], []]);
  c.cycle('Security control room'); assert.deepEqual([st.open, st.know], [[], []]);
  const n = log.filter((x) => x[0] === 'write').length;
  assert.equal(c.cycle('Showroom'), false); assert.equal(log.filter((x) => x[0] === 'write').length, n);
  assert.ok(log.some((x) => x[0] === 'toast' && x[2] === true && /band is open/.test(x[1])));
  assert.equal(c.cycle('No such room'), false);
});

await test('the controller: Intel writes once and says when nothing is dark; with the switch off nothing is written, nothing is active', () => {
  const { c, log, st } = fake(true);
  assert.equal(c.intel('band:working'), true); assert.deepEqual(st.know, ['Security control room', 'Underground counting room']);
  const w = log.filter((x) => x[0] === 'write').length;
  assert.equal(c.intel('band:working'), false); assert.equal(log.filter((x) => x[0] === 'write').length, w);
  assert.equal(c.intel('band:nonsense'), false);
  const off = fake(false);
  assert.equal(off.c.active(), false); assert.equal(off.c.cycle('Security control room'), false); assert.equal(off.c.intel('band:working'), false); assert.equal(off.c.tapRoom(PLN, 'r1'), false);
  assert.equal(off.log.length, 0);
});

await test('a tap on the GM map names a room by its index in the roll; anything else is not ours', () => {
  const { c, st } = fake(true), roll = { rooms: ROOMS };
  assert.equal(c.tapRoom(roll, 'r2'), true); assert.deepEqual(st.know, ['Security control room']);
  for (const bad of ['', 'r', 'r9', 'x2', 'r-1', null, undefined, 'r2 ']) assert.equal(c.tapRoom(roll, bad), false, String(bad));
  assert.equal(c.tapRoom(null, 'r2'), false); assert.equal(c.tapRoom({ rooms: 'no' }, 'r2'), false);
});

await test('the panel: a row per room with its state, escaped; a locked room has no button; Intel buttons per group', () => {
  const rooms = ROOMS.concat([{ name: '<b>' + MARK + '</b>', band: 'secure' }]);
  const c = KN.create({ feature: () => true, rooms: () => rooms, ctx: () => ({ open: [], know: ['Security control room'], bands: ['public'] }), floors: () => [] });
  const v = c.view(); assert.deepEqual(v.counts, { dark: 4, blueprint: 1, seen: 2 });
  const h = KN.panelHtml(v);
  assert.ok(!h.includes('<b>' + MARK) && h.includes('&lt;b&gt;' + MARK));
  assert.equal((h.match(/data-kn="cycle"/g) || []).length, 5, 'the five rooms not seen through a band');
  assert.ok(/data-kn="intel" data-group="band:working"/.test(h));
  assert.ok(/Seen \(its band is open\)/.test(h));
});

/* ---------- the player copy ---------- */
const OPEN = ['Private card rooms'], KNOW = ['Security control room'];
const player = (roll, extra) => K.render(roll, Object.assign({ layer: 'player', layout: 'ipad', theme: 'casefile', reveal: ['public', 'room:Security control room', 'room:Private card rooms'] }, extra));
const reveal0 = ['public', 'room:Security control room', 'room:Private card rooms'];

await test('the kit: no blueprint option, an empty one, or one on the GM layer: the same bytes as before', () => {
  for (const view of ['iso', 'plan', 'rings', 'section']) {
    const a = player(PLN, { view }).svg;
    assert.equal(player(PLN, { view, blueprint: [] }).svg, a, view + ' empty');
    assert.equal(player(PLN, { view, blueprint: 'Security control room' }).svg, a, view + ' not a list');
    assert.equal(player(PLN, { view, blueprint: ['No such room'] }).svg, a, view + ' no such room');
    const gm = K.render(PLN, { view, layer: 'gm', layout: 'ipad', theme: 'casefile' }).svg;
    assert.equal(K.render(PLN, { view, layer: 'gm', layout: 'ipad', theme: 'casefile', blueprint: KNOW }).svg, gm, view + ' GM layer');
  }
});

await test('the kit: a blueprint room is linework: its floor a blue line, its name kept, no furniture, no icons; the room beside it is drawn as ever', () => {
  for (const view of ['iso', 'plan', 'rings', 'section']) {
    const plain = player(PLN, { view }).svg, bp = player(PLN, { view, blueprint: KNOW }).svg;
    assert.notEqual(bp, plain, view);
    assert.ok(/#2f5f8f/.test(bp), view + ': blue');
    assert.ok(/data-know="blueprint"/.test(bp) || view === 'section', view + ': marked');
    assert.ok(bp.length < plain.length, view + ': no furniture');
    assert.ok(!/#2f5f8f/.test(plain), view + ': the plain copy has no blue');
  }
  /* the plan: the blueprint room has no furniture group, the seen room beside it still has */
  const r = K.render(PLN, { view: 'plan', layer: 'player', layout: 'ipad', theme: 'casefile', reveal: reveal0, blueprint: KNOW });
  const idOf = (name) => r.model.rooms.find((x) => x.name === name).id;
  const furn = (id) => (r.svg.match(new RegExp('class="furniture" data-room="' + id + '"', 'g')) || []).length;
  assert.equal(furn(idOf('Security control room')), 0); assert.ok(furn(idOf('Private card rooms')) + furn(idOf('Showroom')) > 0);
});

await test('the kit: seen beats blueprint: a room whose band is revealed is never drawn as linework, and the ids differ only when a blueprint is drawn', () => {
  const rv = ['public', 'working', 'room:Private card rooms'];
  const a = K.render(PLN, { view: 'plan', layer: 'player', layout: 'ipad', theme: 'casefile', reveal: rv });
  const b = K.render(PLN, { view: 'plan', layer: 'player', layout: 'ipad', theme: 'casefile', reveal: rv, blueprint: ['Security control room'] });
  assert.equal(a.svg, b.svg, 'its band is open, so it is seen');
  const c = player(PLN, { view: 'plan' }).svg, d = player(PLN, { view: 'plan', blueprint: KNOW }).svg;
  assert.notEqual(c.match(/id="(b68m[a-z0-9]+)-/)[1], d.match(/id="(b68m[a-z0-9]+)-/)[1]);
});

await test('secrecy: a dark room is nowhere in the player copy (name, geometry, floor), at every view and theme; changing it changes no byte', () => {
  const dark = ['Luxury penthouse', 'Underground counting room', 'Cocktail lounge'].filter((n) => !reveal0.includes('room:' + n));
  for (const roll of [PLN, PK1]) for (const view of ['iso', 'plan', 'rings', 'section']) for (const theme of ['casefile', 'rulebook', 'blueprint']) {
    const r = K.render(roll, { view, theme, layer: 'player', layout: 'ipad', reveal: reveal0, blueprint: KNOW, kit1: true });
    for (const n of ['Luxury penthouse', 'Underground counting room']) assert.ok(!new RegExp(n, 'i').test(r.svg), view + '/' + theme + ': ' + n);
    assert.ok(!P.leaks(r.svg, roll, reveal0).length, view + '/' + theme + ': the page\'s own scan');
    const edited = JSON.parse(JSON.stringify(roll)); const hid = edited.rooms.find((x) => x.name === 'Luxury penthouse'); hid.detail = MARK; hid.loot = MARK + ' loot'; if (roll === PK1) hid.scale = 'grand';
    const r2 = K.render(edited, { view, theme, layer: 'player', layout: 'ipad', reveal: reveal0, blueprint: KNOW, kit1: true });
    assert.equal(sha(r2.svg), sha(r.svg), view + '/' + theme + ': a dark room changed, no byte did');
    assert.ok(!r.svg.includes(MARK), 'no GM-only marker');
  }
  void dark;
});

await test('the blueprint copy never draws a room that is dark even when its name is also on the list (a name in blueprint only counts if the reveal knows it)', () => {
  const r = K.render(PLN, { view: 'plan', layer: 'player', layout: 'ipad', theme: 'casefile', reveal: ['public'], blueprint: ['Luxury penthouse', 'Security control room'] });
  const base = K.render(PLN, { view: 'plan', layer: 'player', layout: 'ipad', theme: 'casefile', reveal: ['public'] });
  assert.equal(r.svg, base.svg);
  assert.ok(!/Luxury penthouse|Security control room/i.test(r.svg));
});

/* ---------- the page: the reveal, the options, the display door ---------- */
const mapOf = (o) => Object.assign({}, P.MAP0, { layer: 'player', reveal: { public: true, working: false, controlled: false, secure: false }, open: [], know: [] }, o);

await test('the page: know joins the player reveal as room entries, once, never beside open; on the GM layer it counts for nothing', () => {
  const m = mapOf({ open: ['Private card rooms'], know: ['Security control room', 'Private card rooms', 'Security control room', 7, ''] });
  assert.deepEqual(P.revealEntries(m), ['public', 'room:Private card rooms', 'room:Security control room']);
  assert.deepEqual(P.revealEntries(mapOf({})), ['public']);
  assert.deepEqual(P.revealEntries(Object.assign(m, { layer: 'gm' })), ['public']);
  assert.deepEqual(P.revealEntries({ layer: 'player', reveal: { public: true } }), ['public'], 'a map with no know key is what it was');
});

await test('the page: mapOpts asks the kit for blueprint only for the player layer, and only for rooms not also open; the reveal carries them', () => {
  const m = mapOf({ open: ['Private card rooms'], know: ['Security control room', 'Private card rooms'] });
  const o = P.mapOpts(m, 'player', P.revealEntries(m));
  assert.deepEqual(o.blueprint, ['Security control room']);
  assert.deepEqual(o.reveal, ['public', 'room:Private card rooms', 'room:Security control room']);
  const g = P.mapOpts(m, 'gm', ['public']); assert.ok(!('blueprint' in g)); assert.deepEqual(g.reveal, ['public']);
  const none = P.mapOpts(mapOf({}), 'player', ['public']); assert.ok(!('blueprint' in none) && JSON.stringify(none.reveal) === '["public"]');
  const b = P.mapOpts(mapOf({ know: ['Security control room'] }), 'player', ['public']);
  assert.deepEqual(b.reveal, ['public', 'room:Security control room'], 'a reveal list that left it out gets it');
});

await test('the page: the one door (playerDisplay) draws a blueprint room, names no dark room, captions it, and a hidden name still refuses', () => {
  const m = mapOf({ open: ['Private card rooms'], know: ['Security control room'], view: 'plan', theme: 'casefile' });
  const d = P.playerDisplay(PLN, m, K.render, null);
  assert.equal(d.kind, 'svg'); assert.ok(/data-know="blueprint"/.test(d.svg));
  assert.deepEqual(d.reveal, ['public', 'room:Private card rooms', 'room:Security control room']);
  assert.ok(/Security control room/.test(d.caption));
  assert.ok(!/Luxury penthouse|Underground counting room/i.test(d.svg));
  assert.deepEqual(P.leaks(d.svg, PLN, d.reveal), []);
  assert.throws(() => P.playerDisplay(PLN, Object.assign({}, m, { layer: 'gm' }), K.render, null), /player layer/);
  /* a room only in know with its name in the title of a floor is a known name, not a leak; a dark one still is */
  const hidden = P.hiddenNames(PLN, d.reveal); assert.ok(hidden.includes('luxury penthouse') && !hidden.includes('security control room'));
});

await test('the iPad redraws in about 600 ms: the median blueprint copy at iPad size, plan and iso, is well under', () => {
  const m = mapOf({ open: ['Private card rooms'], know: ['Security control room'], view: 'iso', theme: 'casefile' });
  const times = [];
  for (let i = 0; i < 5; i++) { const t0 = performance.now(); P.playerDisplay(PLN, Object.assign({}, m, { view: i % 2 ? 'plan' : 'iso' }), K.render, null); times.push(performance.now() - t0); }
  times.sort((a, b) => a - b);
  assert.ok(times[2] < 600, 'median ' + Math.round(times[2]) + ' ms');
});

/* ---------- markers never stand in a blueprint room (review item 21) ---------- */
const BALL = require(path.join(APP, 'gm', 'ball.js'));
const PLAY2 = BALL.checkPlay(JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'pelican-play-v2.json'), 'utf8')), ROOMS.map((r) => r.name)).play;
/* the target's room (the Showroom) in the working band, so a ticked public band does not show it */
const ROLL21 = { rooms: ROOMS.map((r) => (r.name === 'Showroom' ? Object.assign({}, r, { band: 'working' }) : r)) };
const REV21 = ['public', 'room:Showroom'];

await test('markers: the rooms a marker may stand in leave out a blueprint room, keep a seen one, and keep a room whose band is ticked', () => {
  assert.deepEqual(P.tokenRooms(ROLL21, REV21, ['Showroom']), ['Cocktail lounge'], 'the blueprint room is left out; the public room stays');
  assert.deepEqual(P.tokenRooms(ROLL21, REV21, []), ['Showroom', 'Cocktail lounge'], 'the same room seen (not blueprint)');
  assert.deepEqual(P.tokenRooms(ROLL21, ['public', 'working', 'room:Showroom'], ['Showroom']), ['Showroom', 'Cocktail lounge', 'Security control room', 'Underground counting room'], 'its band is ticked: seen');
  assert.deepEqual(P.tokenRooms(ROLL21, REV21, ['No such room', 5, null]), ['Showroom', 'Cocktail lounge']);
});

await test('markers: a target in a blueprint room draws no pill, initials or label (the engine and the token builder); a PC marker stays off it too; seen, both show', () => {
  const st = { site: 'x', t: 60, crew: { pc1: { room: 'Showroom' } } }, pcs = [{ id: 'pc1', name: 'Cass Fenn', icon: '' }];
  const draw = (know) => {
    const shown = P.tokenRooms(ROLL21, REV21, know), mark = BALL.targetInView(PLAY2, st, shown);
    return { mark, tokens: P.playerTokens({ crew: st.crew, pins: {} }, shown, [], pcs, mark) };
  };
  const bp = draw(['Showroom']);
  assert.equal(bp.mark, null, 'no target marker');
  assert.deepEqual(bp.tokens, [], 'no PC marker either: a blueprint room is a name and an outline');
  const seen = draw([]);
  assert.deepEqual(seen.mark, { room: 'Showroom', label: 'Odette Marsh' });
  assert.equal(seen.tokens.length, 1); assert.equal(seen.tokens[0].room, 'Showroom');
  assert.ok(/Cass Fenn/.test(seen.tokens[0].label) && /Odette Marsh/.test(seen.tokens[0].label + seen.tokens[0].svg), 'seen: the PC and the target pill');
});

await test('markers: the kit itself draws no token in a blueprint room, and still draws it once the room is seen (a second line of defence)', () => {
  const roll = JSON.parse(JSON.stringify(PLN)), tok = { room: 'Security control room', label: MARK + ' label', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle data-b24="pill" cx="5" cy="5" r="4"/></svg>' };
  const o = { view: 'plan', theme: 'casefile', layer: 'player', layout: 'ipad', reveal: reveal0, tokens: [tok] };
  const withTok = (extra) => K.render(roll, Object.assign({}, o, extra));
  const bp = withTok({ blueprint: KNOW }), seen = withTok({});
  assert.ok(!bp.svg.includes('data-b24="pill"'), 'no marker in the blueprint room');
  assert.ok(seen.svg.includes('data-b24="pill"'), 'the same room seen: the marker is there');
});

await test('markers: through the one door (playerDisplay) a blueprint room carries no marker and a seen one does', () => {
  const m = (open, know) => mapOf({ open, know, view: 'plan', theme: 'casefile' });
  const tok = (name) => ({ tokens: [{ room: name, label: 'Cass Fenn', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle data-b24="pill" cx="5" cy="5" r="4"/></svg>' }], hide: [] });
  const asBp = P.playerDisplay(PLN, m([], ['Security control room']), K.render, tok('Security control room'));
  const asSeen = P.playerDisplay(PLN, m(['Security control room'], []), K.render, tok('Security control room'));
  assert.ok(!asBp.svg.includes('data-b24="pill"') && asSeen.svg.includes('data-b24="pill"'));
});

await test('ball.know is read only while map.knowledge is on: the page\'s own reads are all behind the switch', () => {
  const src = fs.readFileSync(path.join(APP, 'gm-page.js'), 'utf8');
  const reads = src.split('\n').filter((l) => /ballDoc\([^)]*\)\.know/.test(l));
  assert.ok(reads.length >= 4);
  const gated = (l) => /b09On\('map\.knowledge'\)/.test(l);
  /* knowNow and dropBands gate on the line; the controller (ctx) and knowRevert are reached only through the switch: active() and an on.know set only while it was on */
  for (const l of reads) assert.ok(gated(l) || /ctx: function|function knowRevert|var open = cleanRooms\(ballDoc\(rs\.name\)\.open\)\.filter\(function \(n\) \{ return upg/.test(l) || /kn = cleanRooms/.test(l), 'ungated read: ' + l.trim().slice(0, 100));
  /* and behaviourally: with the switch off the map options and the reveal ignore a know list that is sitting in the state */
  const m = Object.assign({}, mapOf({}), { know: [] });
  assert.deepEqual(P.revealEntries(m), ['public']);
});

await test('routes: gm/knowledge.js is in the GM bundle only, ahead of gm-page.js', () => {
  const B = Routes.BUNDLES, gm = B.gm;
  assert.ok(gm.includes('gm/knowledge.js') && gm.indexOf('gm/knowledge.js') < gm.indexOf('gm-page.js'));
  for (const k of Object.keys(B)) if (k !== 'gm') assert.ok(!B[k].includes('gm/knowledge.js'), k);
});

/* ===================================================================== 2.10 ===================================================================== */
const { cleanShowPayload, showTexts, SHOW_KIND_IDS, isShowKind } = await import('../../functions/_lib/show.js');
const GShow = require(path.join(APP, 'gm', 'show.js'));
const GTC = require(path.join(APP, 'gm', 'title-card.js'));
const TC = require(path.join(APP, 'display', 'title-card.js'));

await test('map.title is registered, default off, bland, a GM switch on the map stage, Saturday off', () => {
  const s = Features.get('map.title');
  assert.ok(s); assert.equal(s.default, false); assert.equal(s.surface, 'gm'); assert.equal(s.stage, 'map'); assert.equal(s.saturday, 'off');
  assert.ok(s.label && s.doc && !/GM-ONLY/.test(s.doc));
  assert.equal(Features.valueOf({}, 'map.title'), false);
  assert.equal(Features.valueOf({ features: { 'map.title': true } }, 'map.title'), true);
  assert.equal(Features.valueOf({ features: { 'map.title': true } }, 'map.knowledge'), false);
});

const OK = { text: 'The Pelican Job', sub: 'Nowhere Ward', floors: ['0,0,100,72', '0,0,100,72', '24,16,52,40'] };
await test('the server: scoretitle is a show kind, rebuilt from named keys; unknown keys are dropped; floors and sub are optional', () => {
  assert.ok(isShowKind('scoretitle') && SHOW_KIND_IDS.includes('scoretitle'));
  assert.deepEqual(cleanShowPayload('scoretitle', Object.assign({ extra: MARK, rooms: [MARK] }, OK)), OK);
  assert.deepEqual(cleanShowPayload('scoretitle', { text: '  The   Pelican  Job ' }), { text: 'The Pelican Job' });
  assert.deepEqual(cleanShowPayload('scoretitle', { text: 'A', floors: null, sub: '' }), { text: 'A' });
  assert.deepEqual(showTexts({ kind: 'scoretitle', payload: OK }), ['The Pelican Job', 'Nowhere Ward', '0,0,100,72', '0,0,100,72', '24,16,52,40'], 'the words the handler scans for hidden names');
});

await test('the server refuses what the card cannot draw: no name, a long name or line, a bad or crowded floor list, a floor off the grid', () => {
  const bad = (p, re) => assert.throws(() => cleanShowPayload('scoretitle', p), re);
  bad({}, /payload\.text is required/); bad({ text: 5 }, /must be text/); bad({ text: 'x'.repeat(81) }, /too long/); bad({ text: 'A', sub: 'x'.repeat(121) }, /too long/);
  bad({ text: 'A', floors: 'no' }, /list of 1 to 6/); bad({ text: 'A', floors: [] }, /list of 1 to 6/); bad({ text: 'A', floors: Array(7).fill('0,0,10,10') }, /list of 1 to 6/);
  for (const f of ['1,2,3', 'a,b,c,d', '0,0,0,10', '0,0,10,0', '50,0,60,10', '0,95,10,10', '0,0,10,101', '-1,0,5,5', '1,2,3,4,5', 5, null, '0,0,10,10 ']) bad({ text: 'A', floors: [f] }, /payload\.floors/);
  assert.deepEqual(cleanShowPayload('scoretitle', { text: 'A', floors: ['0,0,100,100', '99,99,1,1'] }).floors, ['0,0,100,100', '99,99,1,1'], 'the edges of the grid are in');
});

await test('the GM side mirrors the server: the same payloads pass and fail, the default is six seconds, and the overlay it sends is the one the server takes', () => {
  assert.ok(GShow.has('scoretitle'));
  const cases = [OK, { text: 'A' }, { text: 'A', floors: ['0,0,100,100'] }, { text: '' }, { text: 'x'.repeat(81) }, { text: 'A', floors: [] }, { text: 'A', floors: Array(7).fill('0,0,10,10') }, { text: 'A', sub: 'x'.repeat(121) }];
  for (const p of cases) {
    let server = true; try { cleanShowPayload('scoretitle', p); } catch (e) { server = false; }
    assert.equal(GShow.payloadOk('scoretitle', p), server, JSON.stringify(p).slice(0, 60));
  }
  const ov = GShow.overlayFor('scoretitle', OK, { id: 'k1' }); assert.equal(ov.ms, 6000); assert.equal(ov.kind, 'scoretitle');
});

/* ---------- the display's renderer ---------- */
await test('the display: clean takes the server\'s shape and nothing else; the look book has a fixture; a floor off the grid is no card', () => {
  assert.deepEqual(TC.clean(OK), OK);
  assert.equal(TC.clean({ text: '' }), null); assert.equal(TC.clean({ text: 'A', floors: ['0,0,0,1'] }), null); assert.equal(TC.clean({ text: 'A', floors: Array(7).fill('0,0,5,5') }), null); assert.equal(TC.clean({ text: 'A', sub: 5 }), null);
  assert.deepEqual(TC.clean({ text: 'A', rooms: [MARK] }), { text: 'A' });
  const ctx = { document: { createElement: () => ({}) } }; ctx.self = ctx; vm.createContext(ctx);
  for (const f of ['display/shows.js', 'display/title-card.js']) vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), ctx, { filename: f });
  const e = ctx.B68Shows.entry('scoretitle'); assert.ok(e && e.ms === 6000 && e.label); assert.deepEqual(ctx.B68Shows.clean('scoretitle', e.fixture), e.fixture); assert.ok(e.fixtures.length >= 2);
  for (const f of e.fixtures) assert.ok(ctx.B68Shows.clean('scoretitle', f.fixture), f.label);
  assert.ok(!JSON.stringify(e).includes('GM-ONLY'));
});

await test('the display: the matrix that lays each storey flat is the iso stack\'s own inverse (the plan becoming the building is one transform), and every shape sits on the stage', () => {
  for (const floors of [OK.floors, ['0,0,100,72', '0,0,100,72', '0,0,100,72', '24,16,52,40'], ['10,5,60,90'], undefined]) {
    const L = TC.layout(floors), fl = (floors || ['0,0,100,70']).map(TC.parseFloor);
    assert.equal(L.tops.length, fl.length);
    L.tops.forEach((top, i) => {
      const m = L.mats[i], at = (q) => [m[0] * q[0] + m[2] * q[1] + m[4], m[1] * q[0] + m[3] * q[1] + m[5]];
      top.forEach((q, j) => { const f = at(q), want = L.plan[i][j]; assert.ok(Math.abs(f[0] - want[0]) < 0.2 && Math.abs(f[1] - want[1]) < 0.2, 'storey ' + i + ' corner ' + j + ': ' + f + ' vs ' + want); });
      for (const poly of [top, L.lefts[i], L.rights[i]]) for (const q of poly) assert.ok(q[0] >= 0 && q[0] <= 160 && q[1] >= 0 && q[1] <= 90, 'on the 160 x 90 stage: ' + q);
    });
    for (const poly of L.plan.flat()) assert.ok(poly[0] >= 0 && poly[0] <= 160 && poly[1] >= 0 && poly[1] <= 90, 'the flat plan is on the stage too');
  }
});

function fakeDom() {
  const mk = (tag) => { const e = { tag, children: [], attrs: {}, style: { props: {}, setProperty(k, v) { this.props[k] = v; } }, className: '', textContent: '', appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = String(v); } }; return e; };
  return { createElement: mk, createElementNS: (ns, tag) => mk(tag) };
}
const walk = (n, out = []) => { out.push(n); (n.children || []).forEach((c) => walk(c, out)); return out; };

await test('the display: render builds only from the checked payload with textContent; the name, the line and the storeys are on it; reduced motion is marked', () => {
  const doc = fakeDom(), n = TC.render(TC.clean(OK), { document: doc });
  const all = walk(n);
  assert.equal(n.attrs['data-show'], 'scoretitle'); assert.ok(/dp-show-scoretitle/.test(n.className));
  assert.equal(all.filter((x) => /dp-tc-floor/.test(x.className || (x.attrs && x.attrs.class) || '')).length, 3, 'one group per storey');
  assert.ok(all.some((x) => x.textContent === 'The Pelican Job') && all.some((x) => x.textContent === 'Nowhere Ward'));
  assert.ok(!('innerHTML' in n), 'never set as HTML');
  assert.equal(TC.render(TC.clean(OK), { document: fakeDom(), reduced: true }).attrs['data-reduced'], '1');
  const evil = TC.render(TC.clean({ text: '<img src=x onerror=1>' }), { document: fakeDom() });
  assert.ok(walk(evil).some((x) => x.textContent === '<img src=x onerror=1>'), 'text stays text');
});

/* ---------- the generator: what the card is made from ---------- */
await test('generated from the site: the Pelican Rooms with kit 1.0 gives its three storeys above the ground, set back at the top, no basement, and it validates on both sides', () => {
  const fl = GTC.floorsOf(K, PK1, { kit1: true });
  assert.equal(fl.length, 3, 'floors 0, 1 and 2: the basement is not seen from the street');
  const p = fl.map(TC.parseFloor); assert.ok(p.every(Boolean));
  assert.equal(fl[0], fl[1], 'the first two storeys share a footprint (build.floors)');
  assert.ok(p[2].w < p[0].w && p[2].d < p[0].d, 'the top storey is set back');
  assert.equal(Math.max(...p.map((f) => f.x + f.w), ...p.map((f) => f.y + f.d)), 100, 'scaled to the grid by the longest side');
  const pay = GTC.payloadFor(K, PK1, { kit1: true });
  assert.equal(pay.text, 'The Pelican Rooms'); assert.equal(pay.sub, 'Nowhere Ward');
  assert.deepEqual(cleanShowPayload('scoretitle', pay), pay); assert.ok(GShow.payloadOk('scoretitle', pay)); assert.deepEqual(TC.clean(pay), pay);
});

await test('generated from the site: any site, plain or rolled, gives a valid card; with no layout it is a plain block (no floors), never an error', () => {
  const L = require(path.join(APP, 'gm', 'location.js')), FIXL = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'location-pack.json'), 'utf8'));
  for (let seed = 1; seed <= 12; seed++) {
    const roll = L.generate(FIXL, {}, { seed, mem: {} }), p = GTC.payloadFor(K, roll, {});
    assert.ok(p && p.text, 'seed ' + seed); assert.deepEqual(cleanShowPayload('scoretitle', p), p, 'seed ' + seed); assert.ok(GShow.payloadOk('scoretitle', p), 'seed ' + seed);
  }
  assert.deepEqual(GTC.floorsOf(null, PLN, {}), []); assert.deepEqual(GTC.floorsOf({ _internal: {} }, PLN, {}), []); assert.deepEqual(GTC.floorsOf(K, { rooms: [] }, {}), []);
  assert.equal(GTC.payloadFor(K, null, {}), null); assert.equal(GTC.payloadFor(K, { name: '   ' }, {}), null);
  assert.deepEqual(GTC.payloadFor(null, { name: 'A Place' }, {}), { text: 'A Place' });
});

await test('SECRECY: the card holds the outside only: no room name, no hidden-room detail, no GM-only marker, and a hidden room\'s words change not one byte of it', () => {
  const marked = JSON.parse(JSON.stringify(PK1));
  for (const r of marked.rooms) { r.detail = MARK + ' ' + r.name; r.loot = MARK + ' loot'; }
  marked.targetWhy = MARK; marked.watcher = MARK;
  const a = GTC.payloadFor(K, PK1, { kit1: true }), b = GTC.payloadFor(K, marked, { kit1: true });
  assert.deepEqual(b, a, 'the card does not read what the rooms say');
  const text = JSON.stringify(a);
  for (const r of PK1.rooms) assert.ok(!text.includes(r.name), 'no room name: ' + r.name);
  assert.ok(!text.includes(MARK));
  assert.deepEqual(Object.keys(a).sort(), ['floors', 'sub', 'text']);
  /* the same card at every reveal: nothing about what the crew knows goes in */
  assert.equal(GTC.payloadFor.length <= 3, true);
});

/* ---------- the wiring: on GO into the Score phase, once, and never on load ---------- */
function night(phase0) {
  let phase = phase0 || null; const log = [];
  return { log, phase: () => phase, enter(p) { log.push(p); if (p === 'bad') return false; phase = p; return true; }, set(p) { phase = p; } };
}
function wired(on, t0) {
  const shows = [], nt = night('plan'); let now = t0 || 1e12; const toasts = [];
  const ctl = GTC.create({ feature: (id) => on && id === 'map.title', roll: () => PK1, kit: () => K, kit1: () => true, show: (k, p, o) => { shows.push([k, p, o]); return Promise.resolve({}); }, toast: (m) => toasts.push(m), now: () => now });
  assert.equal(ctl.wrap(nt), true);
  return { nt, shows, ctl, toasts, tick: (ms) => { now += ms; } };
}
const flushP = () => new Promise((r) => setTimeout(r, 0));

await test('GO: entering the Score phase from another phase puts the card up once, six seconds, with a stable key; other phases, the same phase again and a refused enter put up nothing', async () => {
  const w = wired(true);
  assert.equal(w.nt.enter('plan'), true); assert.equal(w.nt.enter('after'), true); assert.equal(w.shows.length, 0, 'not the score');
  assert.equal(w.nt.enter('score'), true); await flushP();
  assert.equal(w.shows.length, 1); const [kind, payload, opts] = w.shows[0];
  assert.equal(kind, 'scoretitle'); assert.equal(opts.ms, 6000); assert.ok(/^tc-[a-z0-9_-]+$/.test(opts.key)); assert.deepEqual(payload, GTC.payloadFor(K, PK1, { kit1: true }));
  assert.equal(w.nt.enter('score'), true); assert.equal(w.shows.length, 1, 'already in the score: no second card');
  const w2 = wired(true); w2.nt.set('plan'); assert.equal(w2.nt.enter('bad'), false); assert.equal(w2.shows.length, 0);
  assert.equal(GTC.keyFor(PK1, 1.2e12 + 5000), GTC.keyFor(PK1, 1.2e12 + 35000), 'two pages in the same minute share a key'); assert.notEqual(GTC.keyFor(PK1, 1.2e12), GTC.keyFor(PK1, 1.2e12 + 120000));
});

await test('GO: with the switch off nothing is shown and the controller answers as ever; a page loaded in the Score phase shows nothing; a second wrap is refused', async () => {
  const off = wired(false); assert.equal(off.nt.enter('score'), true); await flushP(); assert.equal(off.shows.length, 0);
  const loaded = night('score'), shows = []; const ctl = GTC.create({ feature: () => true, roll: () => PK1, kit: () => K, kit1: () => true, show: (k, p, o) => { shows.push(k); return Promise.resolve({}); } });
  assert.equal(ctl.wrap(loaded), true); await flushP(); assert.equal(shows.length, 0, 'wrapping alone fires nothing');
  assert.equal(ctl.wrap(loaded), false, 'wrapped once');
  loaded.enter('score'); assert.equal(shows.length, 0, 'already score');
  const noRoll = GTC.create({ feature: () => true, roll: () => null, kit: () => K, show: (k) => { shows.push(k); return Promise.resolve({}); } }), n2 = night('plan'); noRoll.wrap(n2); n2.enter('score'); await flushP(); assert.equal(shows.length, 0, 'no site, no card');
  const failing = GTC.create({ feature: () => true, roll: () => PK1, kit: () => K, show: () => Promise.reject(new Error('no')) }), n3 = night('plan'); failing.wrap(n3);
  assert.equal(n3.enter('score'), true, 'a card that cannot go never blocks the phase'); await flushP();
});

await test('routes: gm/title-card.js is in the GM bundle only; the renderer and its css are in the display and look book bundles only; the css has a place in the cascade', () => {
  const B = Routes.BUNDLES;
  assert.ok(B.gm.includes('gm/title-card.js') && B.gm.indexOf('gm/title-card.js') < B.gm.indexOf('gm-page.js'));
  for (const f of ['display/title-card.js', 'display/title-card.css']) { assert.ok(B.display.includes(f) && B.lookbook.includes(f), f); for (const k of Object.keys(B)) if (!['display', 'lookbook'].includes(k)) assert.ok(!B[k].includes(f), k + ' has ' + f); }
  assert.ok(B.display.indexOf('display/title-card.js') > B.display.indexOf('display/shows.js'), 'after the registry');
  for (const k of Object.keys(B)) if (k !== 'gm') assert.ok(!B[k].includes('gm/title-card.js'), k);
});

await test('the stylesheet: the name is never under 5vmin, the card draws from the tokens (no colour of its own), and reduced motion stills it (the six-second timeline is measured in the browser: gm-title-card.e2e)', () => {
  const css = fs.readFileSync(path.join(APP, 'display', 'title-card.css'), 'utf8');
  assert.ok(/clamp\(5vmin,/.test(css), 'the name floor is 5vmin');
  assert.ok(!/#[0-9a-fA-F]{3,6}\b/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'only var(--b68-*) colours');
  const flat = css.replace(/\n/g, ' ');
  assert.ok(/prefers-reduced-motion: reduce\)[^}]*animation: none !important/.test(flat), 'the media query stills it');
  assert.ok(/\[data-reduced\][^{]*\{ animation: none !important/.test(flat), 'and so does the display reduced flag');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
