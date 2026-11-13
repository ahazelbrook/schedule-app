// MK1: the map takes the new kit options (app/gm/scene-state.js, the hand-over in app/gm-page.js). No browser, no network.
//   - Off means today: with map.fill, map.people, map.lights and map.room off, every options object that reaches the map kit is what it was
//     at a1f8d57 (the player path, captured through a stand-in render, compared with that commit's own gm-page.js), and the scene module hands
//     back the options it was given, untouched.
//   - The GM copy's people match the Run view's pills (the board's PCs and people, by room) for the fixture night at three times.
//   - The player copy's people are the crew and only the crew, in rooms the players can see, whatever the fixture marks as public; a disguised
//     crew member is re-dressed through a stand-in dress; the lights follow the fixture's fx "dawn" event; the options survive JSON.
// INVENTED data only: the Pelican Rooms and its play fixture (fixtures/gm/pelican-play-v2.json), the Dovetail Crew.
//   node checks/runtime/map-scene.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseSite } from '../../scripts/lib/authored-export.mjs';
import { cleanSttPatch, cleanFrame, sttSignal, sttPartOf } from '../../functions/_lib/stt.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const G = require(path.join(ROOT, 'app', 'gm', 'scene-state.js'));
const BALL = require(path.join(ROOT, 'app', 'gm', 'ball.js'));
const RV = require(path.join(ROOT, 'app', 'gm', 'run-view.js'));
const F = require(path.join(ROOT, 'app', 'features.js'));
const P = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
P.sceneMod = G;          /* in a browser the page finds window.B68GmScene; under Node the pure helpers are handed the module */
const BASE = 'a1f8d57';

let failed = 0, passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const cl = (v) => JSON.parse(JSON.stringify(v));

/* ---------- the fixture night ---------- */
const ROOMS = [
  { name: 'Showroom', band: 'public' }, { name: 'Cocktail lounge', band: 'public' }, { name: 'Security control room', band: 'working' },
  { name: 'Private card rooms', band: 'controlled' }, { name: 'Underground counting room', band: 'working' }, { name: 'Luxury penthouse', band: 'secure', isTarget: true }];
const ROLL = { name: 'The Pelican Rooms', district: 'Nowhere Ward', target: 'Gambling den', targetRoom: 'Luxury penthouse', targetBand: 'secure', rooms: ROOMS, vectors: [], skips: [] };
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'pelican-play-v2.json'), 'utf8'));
const PLAY = (mut) => { const p = cl(FX); if (mut) mut(p); return BALL.checkPlay(p, ROOMS.map((r) => r.name)).play; };
const FLOORS = { list: [{ lvl: -1, name: 'Under' }, { lvl: 0, name: 'Ground' }, { lvl: 1, name: 'Upper' }, { lvl: 2, name: 'Loft' }],
  floorOf: { Showroom: 0, 'Cocktail lounge': 0, 'Security control room': 0, 'Private card rooms': 1, 'Underground counting room': -1, 'Luxury penthouse': 2 } };
/* the Dovetail Crew, with figure specs as their sheets would hold them */
const SPEC = (name, figure) => ({ id: name.toLowerCase().replace(/\W+/g, '-'), name, figure, heightIn: 68, skin: 'olive', outfit: 'street' });
const PCS = [{ id: 'pc1', name: 'Nell Arbuthnot', spec: SPEC('Nell Arbuthnot', 'fem') }, { id: 'pc2', name: 'Ray Okonjo', spec: SPEC('Ray Okonjo', 'masc') },
  { id: 'pc3', name: 'Tam Petrakis', spec: null }];
const CREW = { pc1: { room: 'Showroom', disguise: 'guest' }, pc2: { room: 'Underground counting room', disguise: 'cook' }, pc3: { room: 'Cocktail lounge' } };
const ALL_OFF = G.flags(() => false), ALL_ON = G.flags(() => true);
const ONLY = (k) => G.flags((id) => id === G.IDS[k]);
const model = (play, crew, t) => RV.model(play, { site: 'The Pelican Rooms', v: 2, start: 0, t, crew }, { t, pcs: PCS.map((c) => ({ id: c.id, name: c.name })), floors: FLOORS, isOpen: () => false });
/* the Run view's pills by room, as runV2Tokens builds them (gm-page.js): every card with a floor, its PCs' initials then its people's */
const pills = (m) => { const out = {}; Object.keys(m.cards).sort().forEach((n) => { const c = m.cards[n]; if (c.lvl === null) return; const p = c.pcs.map((x) => x.ini).concat(c.npcs.map((x) => x.ini)); if (p.length) out[n] = p; }); return out; };
const byRoom = (ppl) => { const out = {}; ppl.forEach((p) => { (out[p.room] = out[p.room] || []).push(p.mark); }); return out; };
/* a stand-in kit that can dress (the contract's dress: the same person in the role's clothes) */
const dressCalls = [];
const KIT = { dress(spec, role, opts) { dressCalls.push([spec.name, role, opts && opts.masked === true]); return Object.assign(cl(spec), { outfit: 'role:' + role, mask: !!(opts && opts.masked) }); } };
/* the scene input the page builds (sceneInput) for these flags */
const SC = (f, extra) => Object.assign({ flags: f, pcs: cl(PCS), crew: cl(CREW), disguises: PLAY().disguises.map((d) => ({ id: d.id, icon: d.icon })), crowd: G.crowdOf(PLAY()),
  lights: G.lightsAt(PLAY(), 180), screen: 'ipad', stage: true, view: '', room: '', kit: KIT }, extra || {});      /* stage: a kit that draws layout "stage" */
/* a stand-in map kit: captures every options object, draws the people's labels as text (as the new kit will) so the leak scan sees them */
function spyRender() {
  const calls = [];
  const render = (roll, o) => { calls.push(o); const ppl = Array.isArray(o.people) ? o.people.map((p) => '<text>' + (p.label || '') + '</text>').join('') : ''; return { svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Showroom</text>' + ppl + '</svg>', warnings: [] }; };
  return { render, calls };
}
const strip = (o) => { const c = Object.assign({}, o); if (c.figures) c.figures = Object.assign({}, c.figures, { kit: c.figures.kit ? '(kit)' : c.figures.kit }); return c; };
const PMAP = (extra) => Object.assign({ layer: 'player', view: 'iso', theme: 'rulebook', reveal: { public: true }, open: [], know: [] }, extra || {});

/* ---------- 1. off means today ---------- */
test('the four settings are registered: GM-only settings in the Maps stage, default off, Saturday "try"; nothing stored reads all four off', () => {
  for (const id of Object.values(G.IDS)) {
    const s = F.get(id); assert.ok(s, id);
    assert.equal(s.setting, true, id); assert.equal(s.default, false, id); assert.equal(s.surface, 'gm', id); assert.equal(s.stage, 'map', id); assert.equal(s.saturday, 'try', id);
    assert.equal(F.valueOf({}, id), false, id); assert.equal(F.valueOf({ features: { [id]: true } }, id), true, id);
  }
  assert.deepEqual(G.IDS, { fill: 'map.fill', people: 'map.people', lights: 'map.lights', room: 'map.room' });
  assert.notEqual(F.get('map.stage').setting, true, 'map.stage stays the always-on "Stage rooms, then send"');
  assert.deepEqual(G.flags((id) => F.valueOf({}, id)), { fill: false, people: false, lights: false, room: false });
  assert.equal(G.anyOn(G.flags((id) => F.valueOf({ features: {} }, id))), false);
  assert.deepEqual(F.publicView({}), F.publicView({ features: { 'map.fill': true, 'map.people': true, 'map.lights': true, 'map.room': true } }), 'GM settings never reach a phone or the iPad');
});
test('off: the scene module hands back the very options it was given, untouched, with an empty key (GM copy and player copy)', () => {
  const o = { view: 'iso', theme: 'rulebook', layer: 'gm', reveal: ['public'], tokens: [{ room: 'Showroom', label: '', svg: '<svg/>' }], width: 1400 }, before = cl(o);
  const play = PLAY(), m = model(play, CREW, 60);
  assert.equal(G.gm(o, ALL_OFF, { model: m, play, crew: CREW, pcs: PCS, cast: () => null, t: 60, kit: KIT }), '');
  assert.deepEqual(o, before, 'the GM copy\'s options are not touched');
  const po = { view: 'iso', theme: 'rulebook', layer: 'player', reveal: ['public'], layout: 'ipad' }, pb = cl(po);
  const r = G.forPlayer(po, SC(ALL_OFF), ['Showroom', 'Cocktail lounge'], ALL_OFF);
  assert.equal(r.opts, po, 'the same object back'); assert.equal(r.key, ''); assert.deepEqual(po, pb);
  assert.equal(P.scenePlayer(po, ROLL, ['public'], PMAP(), { tokens: [], hide: [], sig: '' }), po, 'the page: no tk.scene, o itself');
});
/* the commit the build was cut from, its own gm-page.js: the same inputs must give the same options */
function basePure() {
  const r = spawnSync('git', ['show', BASE + ':app/gm-page.js'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-mk1-base-')), f = path.join(dir, 'gm-page.js');
  fs.writeFileSync(f, r.stdout);
  try { return require(f)._pure; } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* a temp file left is harmless */ } }
}
const OLD = basePure();
test('off: every player-path options object is ' + BASE + '\'s, byte for byte (mapOpts and playerDisplay through a capturing render, a matrix of views, layers, reveals and markers)', () => {
  if (!OLD) { console.log('  (skipped: git cannot show ' + BASE + ' here)'); return; }
  const tok = (room) => ({ room, label: 'Nell Arbuthnot', svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>NA</text></svg>' });
  const cases = [];
  for (const view of ['iso', 'plan', 'rings', 'section']) for (const reveal of [{ public: true }, { public: true, working: true }, { public: true, working: true, controlled: true }])
    for (const tk of [null, { tokens: [], hide: [], sig: '' }, { tokens: [tok('Showroom')], hide: ['Odette Marsh'], sig: 'x' }, { tokens: [tok('Security control room'), tok('Luxury penthouse')], hide: [], sig: 'y' }])
      for (const extra of [{}, { open: ['Private card rooms'] }, { time: 'Night', weather: 'rain' }]) cases.push([PMAP(Object.assign({ view, reveal }, extra)), tk]);
  let n = 0;
  for (const [map, tk] of cases) {
    const a = spyRender(), b = spyRender();
    let ra, rb, ea = null, eb = null;
    try { ra = OLD.playerDisplay(ROLL, map, a.render, tk); } catch (e) { ea = e.message; }
    try { rb = P.playerDisplay(ROLL, map, b.render, tk); } catch (e) { eb = e.message; }
    assert.equal(eb, ea, 'the same refusal'); assert.deepEqual(b.calls, a.calls, 'the same options: ' + JSON.stringify(map));
    if (!ea) assert.deepEqual(rb, ra);
    for (const layer of ['gm', 'player']) assert.deepEqual(P.mapOpts(map, layer, P.revealEntries(map), P.IPAD_MAP), OLD.mapOpts(map, layer, OLD.revealEntries(map), OLD.IPAD_MAP));
    n += a.calls.length;
  }
  assert.ok(n >= cases.length, 'every case rendered at least once (' + n + ')');
});

/* ---------- 2. the GM copy ---------- */
test('the GM copy\'s people match the Run view\'s pills, room by room and in order, at three times of the fixture night', () => {
  const play = PLAY();
  for (const t of [0, 150, 180]) {
    const m = model(play, CREW, t), o = {};
    const key = G.gm(o, ONLY('people'), { model: m, play, crew: CREW, pcs: PCS, cast: () => null, t, kit: KIT });
    assert.ok(key.startsWith('scene:'), 'a key for the cache');
    assert.deepEqual(byRoom(o.people), pills(m), 'at minute ' + t);
    assert.ok(Object.keys(pills(m)).length >= 2, 'the fixture places people in at least two rooms at ' + t);
  }
});
test('the GM copy: crew are tone crew with their sheet\'s spec (dressed for their disguise) or a resident stand-in; the cast by kind, with the cast\'s spec where filed', () => {
  const play = PLAY(), m = model(play, CREW, 150), o = {}; dressCalls.length = 0;
  G.gm(o, ONLY('people'), { model: m, play, crew: CREW, pcs: PCS, cast: (p) => (p.label === 'Odette Marsh' ? { id: 'odette', name: 'Odette Marsh', figure: 'fem' } : null), t: 150, kit: KIT });
  const nell = o.people.find((p) => p.label === 'Nell Arbuthnot'), tam = o.people.find((p) => p.label === 'Tam Petrakis');
  assert.equal(nell.tone, 'crew'); assert.equal(nell.mark, 'NA'); assert.equal(nell.spec.outfit, 'role:guest-f'); assert.equal(nell.spec.mask, true);
  assert.deepEqual(tam, { room: 'Cocktail lounge', role: 'resident', seed: 'pc3', mark: 'TP', tone: 'crew', label: 'Tam Petrakis' });
  const od = o.people.find((p) => p.label === 'Odette Marsh'); assert.equal(od.tone, 'target'); assert.equal(od.spec.name, 'Odette Marsh');
  assert.equal(o.crowd, true); assert.equal(o.figures.kit, KIT);
  for (const p of o.people.filter((x) => x.tone !== 'crew' && !x.spec)) assert.equal(p.role, G.roleOf(play.people.find((q) => q.label === p.label).kind));
  assert.equal(G.roleOf('guard'), 'guard'); assert.equal(G.roleOf('staff'), 'waiter'); assert.equal(G.roleOf('target'), 'resident');
  assert.equal(G.toneOf('rival'), 'rival'); assert.equal(G.toneOf('someone'), 'staff');
});
test('the GM copy\'s cache key changes when a person moves, a setting flips or the figure kit arrives; nothing added, no key', () => {
  const play = PLAY(), inp = (crew, t, kit) => ({ model: model(play, crew, t), play, crew, pcs: PCS, cast: () => null, t, kit });
  const k1 = G.gm({}, ONLY('people'), inp(CREW, 60, KIT)), k2 = G.gm({}, ONLY('people'), inp(Object.assign(cl(CREW), { pc3: { room: 'Showroom' } }), 60, KIT));
  const k3 = G.gm({}, ONLY('people'), inp(CREW, 60, undefined)), k4 = G.gm({}, ALL_ON, inp(CREW, 180, KIT));
  assert.ok(k1 && k2 && k3 && k4); assert.notEqual(k1, k2); assert.notEqual(k1, k3); assert.notEqual(k1, k4);
  assert.equal(G.gm({}, ONLY('people'), inp(CREW, 60, KIT)), k1, 'the same night, the same key');
  assert.equal(G.gm({}, ONLY('lights'), inp(CREW, 60, KIT)), '', 'lights on but nothing lit at 22:00: nothing added');
  assert.equal(G.gm({}, ONLY('fill'), inp(CREW, 60, KIT)), '', 'the stage layout is the shared screen\'s only');
});

/* ---------- 3. the player copy ---------- */
test('the player copy\'s people are the crew and only the crew, whatever the fixture marks as public, and whatever else the input carries', () => {
  const pub = PLAY((p) => { p.people.forEach((x) => { x.public = true; x.vis = 'public'; x.kind = x.kind === 'rival' ? 'rival' : 'contact'; }); });
  const all = ROOMS.map((r) => r.name);
  const sneaky = SC(ALL_ON, { people: pub.people.map((x) => ({ room: 'Showroom', label: x.label, tone: 'contact' })), play: pub, cast: pub.people });
  const r = G.forPlayer({ layer: 'player' }, sneaky, all, ALL_ON);
  const crew = PCS.map((c) => c.name);
  assert.equal(r.opts.people.length, 3);
  for (const p of r.opts.people) { assert.equal(p.tone, 'crew'); assert.ok(crew.includes(p.label), p.label); }
  for (const x of pub.people) assert.ok(!JSON.stringify(G.forPlayer({}, sneaky, all, ALL_ON).opts.people).includes(x.label), x.label + ' is never on the player copy');
  assert.deepEqual(Object.keys(r.opts).sort(), ['crowd', 'displayHeight', 'displayWidth', 'figures', 'layer', 'layout', 'lights', 'people'].sort(), 'no other key rides along');
});
test('a crew member in a room the players cannot see is not in the player copy (nor a light there, nor the room view of it)', () => {
  const shown = ['Showroom', 'Cocktail lounge'];
  const r = G.forPlayer({}, SC(ALL_ON, { view: 'room', room: 'Underground counting room', lights: { 'Underground counting room': 'lit', Showroom: 'lit', 'Cocktail lounge': 'strobe' } }), shown, ALL_ON);
  assert.deepEqual(r.opts.people.map((p) => p.label).sort(), ['Nell Arbuthnot', 'Tam Petrakis']);
  assert.ok(!JSON.stringify(G.keyOf ? r.opts.people : []).includes('Underground'), 'nobody in the hidden room');
  assert.deepEqual(r.opts.lights, { Showroom: 'lit' }); assert.equal(r.opts.view, undefined); assert.equal(r.opts.room, undefined);
  const r2 = G.forPlayer({}, SC(ALL_ON, { view: 'room', room: 'Showroom' }), shown, ALL_ON);
  assert.equal(r2.opts.view, 'room'); assert.equal(r2.opts.room, 'Showroom');
  assert.equal(G.forPlayer({}, SC(ONLY('people'), { view: 'room', room: 'Showroom' }), shown, ONLY('people')).opts.view, undefined, 'map.room off: no room view');
});
test('through the page\'s player path: a hidden band\'s crew member is left out of the options the kit is given, and the drawn map holds no cast name', () => {
  const { render, calls } = spyRender();
  const tk = { tokens: [], hide: PLAY().people.map((p) => p.label), sig: '', scene: SC(ALL_ON) };
  const d = P.playerDisplay(ROLL, PMAP(), render, tk);
  const o = calls[calls.length - 1];
  assert.deepEqual(o.people.map((p) => p.room + '|' + p.label).sort(), ['Cocktail lounge|Tam Petrakis', 'Showroom|Nell Arbuthnot']);
  assert.equal(o.layout, 'stage'); assert.equal(o.displayWidth, 1366); assert.equal(o.displayHeight, 1024);
  for (const x of PLAY().people) assert.ok(!d.svg.includes(x.label), x.label);
  assert.equal(d.tokensRefused, false);
  /* with the working band revealed the counting room is shown: Ray is drawn there, re-dressed as the cook disguise's role */
  const s2 = spyRender(); P.playerDisplay(ROLL, PMAP({ reveal: { public: true, working: true } }), s2.render, tk);
  const ray = s2.calls[s2.calls.length - 1].people.find((p) => p.label === 'Ray Okonjo');
  assert.equal(ray.room, 'Underground counting room'); assert.equal(ray.spec.outfit, 'role:waiter');
});
test('the page\'s checks run after the door: a crew name that is a hidden name takes the people off (tokenScreen), and a map that leaks only with its scene goes without it', () => {
  const { render, calls } = spyRender();
  const pcs = [{ id: 'pc1', name: 'Security control room', spec: null }];      /* a crew member named like a hidden room: the scan must catch it */
  const tk = { tokens: [], hide: [], sig: '', scene: SC(ONLY('people'), { pcs, crew: { pc1: { room: 'Showroom' } } }) };
  P.playerDisplay(ROLL, PMAP(), render, tk);
  assert.deepEqual(calls[calls.length - 1].people, [], 'tokenScreen refused the label: no people');
  /* a scene whose drawing leaks (the kit printed a hidden name for it): the map goes as before, without the scene, and says markers were dropped */
  const leaky = (roll, o) => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg">' + (o.crowd ? '<text>Luxury penthouse</text>' : '<text>Showroom</text>') + '</svg>', warnings: [] });
  const d = P.playerDisplay(ROLL, PMAP(), leaky, { tokens: [], hide: [], sig: '', scene: SC(ONLY('people')) });
  assert.ok(!d.svg.includes('Luxury penthouse')); assert.equal(d.tokensRefused, true);
});
test('a disguised crew member is re-dressed through dress (the role from the disguise\'s icon); no dress in the kit, or an icon not in the table, leaves them as they are', () => {
  const shown = ROOMS.map((r) => r.name);
  dressCalls.length = 0;
  const r = G.forPlayer({}, SC(ONLY('people')), shown, ONLY('people'));
  assert.deepEqual(dressCalls.sort(), [['Nell Arbuthnot', 'guest-f', true], ['Ray Okonjo', 'waiter', false]].sort());
  assert.equal(r.opts.people.find((p) => p.label === 'Nell Arbuthnot').spec.outfit, 'role:guest-f');
  assert.deepEqual(G.ICON_ROLE, { mask: 'guest', tray: 'waiter', crate: 'porter', oar: 'boatman', camera: 'photographer', cards: 'croupier', jacket: 'guard', lamp: 'technician' });
  const plain = G.forPlayer({}, SC(ONLY('people'), { kit: { render() {} } }), shown, ONLY('people'));
  assert.deepEqual(plain.opts.people.find((p) => p.label === 'Ray Okonjo').spec, PCS[1].spec, 'kit 3.0.1 has no dress: the sheet\'s spec as it is');
  const odd = G.forPlayer({}, SC(ONLY('people'), { disguises: [{ id: 'guest', icon: 'balloon' }, { id: 'cook', icon: 'tray' }] }), shown, ONLY('people'));
  assert.equal(odd.opts.people.find((p) => p.label === 'Nell Arbuthnot').spec.outfit, 'street', 'an icon not in the table: as they are');
  const boom = G.forPlayer({}, SC(ONLY('people'), { kit: { dress() { throw new Error('no'); } } }), shown, ONLY('people'));
  assert.equal(boom.opts.people.length, 3, 'a dress that throws leaves the person as they are');
});
test('the crowd: true, or { masked: true } when play.crowd.masked is exactly true; on both copies', () => {
  assert.equal(G.crowdOf(PLAY()), true); assert.equal(G.crowdOf(null), true);
  assert.deepEqual(G.crowdOf(Object.assign(PLAY(), { crowd: { masked: true } })), { masked: true });
  assert.equal(G.crowdOf(Object.assign(PLAY(), { crowd: { masked: 'yes' } })), true);
  assert.deepEqual(G.forPlayer({}, SC(ONLY('people'), { crowd: { masked: true } }), [], ONLY('people')).opts.crowd, { masked: true });
  const o = {}; G.gm(o, ONLY('people'), { model: model(PLAY(), CREW, 0), play: Object.assign(PLAY(), { crowd: { masked: true } }), crew: CREW, pcs: PCS, t: 0, kit: KIT });
  assert.deepEqual(o.crowd, { masked: true });
});
test('lights follow the fixture\'s fx "dawn" event (00:00, the Showroom): "bright" in its beat, nothing before or after; the player copy only where the room is shown', () => {
  const play = PLAY();
  assert.deepEqual(G.lightsAt(play, 165), {}); assert.deepEqual(G.lightsAt(play, 180), { Showroom: 'bright' }); assert.deepEqual(G.lightsAt(play, 194), { Showroom: 'bright' });
  assert.deepEqual(G.lightsAt(play, 195), {}); assert.deepEqual(G.lightsAt(play, 0), {});
  assert.deepEqual(G.lightsAt(PLAY((p) => { p.events.forEach((e) => { delete e.fx; }); }), 180), {}, 'no fx, no light');
  const o = {}; G.gm(o, ONLY('lights'), { model: model(play, CREW, 180), play, crew: CREW, pcs: PCS, t: 180 }); assert.deepEqual(o.lights, { Showroom: 'bright' });
  assert.equal(o.people, undefined, 'lights only: no people');
  assert.deepEqual(G.forPlayer({}, SC(ONLY('lights')), ['Showroom'], ONLY('lights')).opts.lights, { Showroom: 'bright' });
  assert.deepEqual(G.forPlayer({}, SC(ONLY('lights'), { lights: { Showroom: 'bright', 'Cocktail lounge': 'lit' } }), ['Showroom', 'Cocktail lounge'], ONLY('lights')).opts.lights,
    { Showroom: 'bright', 'Cocktail lounge': 'lit' }, 'the contract\'s states pass the door');
  assert.equal(G.forPlayer({}, SC(ONLY('lights')), ['Cocktail lounge'], ONLY('lights')).opts.lights, undefined);
});
test('map.fill: layout "stage" sized to the shared screen (iPad 1366 x 1024, TV 1920 x 1080; anything else is the iPad)', () => {
  const ip = G.forPlayer({ layout: 'ipad', view: 'iso' }, SC(ONLY('fill')), [], ONLY('fill')).opts, tv = G.forPlayer({ layout: 'ipad' }, SC(ONLY('fill'), { screen: 'tv' }), [], ONLY('fill')).opts;
  assert.deepEqual(ip, { layout: 'stage', view: 'iso', displayWidth: 1366, displayHeight: 1024 }); assert.deepEqual([tv.displayWidth, tv.displayHeight], [1920, 1080]);
  assert.equal(G.screenOf('tv'), 'tv'); assert.equal(G.screenOf('TV'), 'ipad'); assert.equal(G.screenOf(undefined), 'ipad');
});
test('the options survive JSON.stringify apart from figures.kit (both copies)', () => {
  const play = PLAY(), o = { view: 'iso', layer: 'gm' };
  G.gm(o, ALL_ON, { model: model(play, CREW, 180), play, crew: CREW, pcs: PCS, cast: () => ({ id: 'x', name: 'Odette Marsh' }), t: 180, kit: KIT });
  const p = G.forPlayer({ view: 'iso', layer: 'player' }, SC(ALL_ON, { view: 'room', room: 'Showroom' }), ROOMS.map((r) => r.name), ALL_ON).opts;
  for (const x of [o, p]) {
    assert.equal(x.figures.kit, KIT);
    const noKit = Object.assign({}, x, { figures: {} });
    assert.deepEqual(JSON.parse(JSON.stringify(noKit)), noKit);
  }
  assert.ok(p.people.every((q) => !('kit' in q)));
});
test('the room control shows only where the vendored kit lists view "room"; the player scene\'s key ignores the kit object itself', () => {
  assert.equal(G.roomViewOk({ options: () => ({ views: ['iso', 'plan', 'rings', 'section', 'street'] }) }), false);
  assert.equal(G.roomViewOk({ options: () => ({ views: ['iso', 'room'] }) }), true);
  assert.equal(G.roomViewOk({ options() { throw new Error('x'); } }), false); assert.equal(G.roomViewOk(null), false);
  const K = require(path.join(ROOT, 'app', 'maps', 'map-kit.js'));
  console.log('  (the vendored map kit ' + K.VERSION + ' lists view "room": ' + G.roomViewOk(K) + ')');
  assert.equal(G.inputKey(SC(ALL_ON)), G.inputKey(SC(ALL_ON, { kit: { dress() {}, other: 1 } })), 'another kit object, the same key');
  assert.notEqual(G.inputKey(SC(ALL_ON)), G.inputKey(SC(ALL_ON, { kit: null })), 'the kit arriving changes the key');
  assert.notEqual(G.inputKey(SC(ALL_ON)), G.inputKey(SC(ALL_ON, { crew: { pc1: { room: 'Cocktail lounge' } } })), 'a move changes the key');
});
test('initials are the Run view\'s own', () => {
  for (const s of ['Nell Arbuthnot', 'ray okonjo', '  Tam  ', '', 'Ada Vell Brand', 'Élodie Ünsel']) assert.equal(G.initials(s), RV.initials(s), s);
});

/* ---------- MK2, step 3: the shared screen's cap ---------- */
test('the cap is the server\'s 600 KiB (functions/_lib/gm.js LIMITS.svg)', () => {
  assert.equal(P.SVG_CAP, 600 * 1024);
  assert.match(fs.readFileSync(path.join(ROOT, 'functions', '_lib', 'gm.js'), 'utf8'), /svg: 600 \* KiB/);
});
test('over the cap the map goes without the crowd, then without its people, and says so; a map too large even then is refused out loud; off, nothing changes', () => {
  const pad = (n) => '<!--' + 'x'.repeat(n) + '-->';
  const big = (rule) => (roll, o) => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Showroom</text>' + pad(rule(o)) + '</svg>', warnings: [] });
  const tk = () => ({ tokens: [], hide: [], sig: '', scene: SC(ONLY('people')) });
  const d1 = P.playerDisplay(ROLL, PMAP(), big((o) => (o.crowd ? 700 * 1024 : 100)), tk());
  assert.equal(d1.sceneCut, 'crowd'); assert.ok(d1.svg.length < P.SVG_CAP); assert.match(P.SCENE_CUT_MSG.crowd, /without the crowd/);
  const d2 = P.playerDisplay(ROLL, PMAP(), big((o) => (o.people ? 700 * 1024 : 100)), tk());
  assert.equal(d2.sceneCut, 'scene'); assert.match(P.SCENE_CUT_MSG.scene, /without its people/);
  assert.throws(() => P.playerDisplay(ROLL, PMAP(), big(() => 700 * 1024), tk()), (e) => e.big === true && /too large for the iPad \(700 KiB, at most 600\)/.test(e.message));
  const d3 = P.playerDisplay(ROLL, PMAP(), big(() => 700 * 1024), { tokens: [], hide: [], sig: '' });
  assert.equal(d3.sceneCut, undefined, 'off: no scene, no size check (the server answers as it always did)');
  const d4 = P.playerDisplay(ROLL, PMAP(), big(() => 100), tk());
  assert.ok(!('sceneCut' in d4), 'under the cap: nothing cut, and no sceneCut key');
});
test('the vendored kits: the Pelican Rooms\' player map with people and the crowd is under the cap at three times, all bands open, on the iPad and a TV', () => {
  const K = require(path.join(ROOT, 'app', 'maps', 'map-kit.js')), FK = require(path.join(ROOT, 'app', 'figures', 'figure-kit.js'));
  if (typeof FK.mini !== 'function') { console.log('  (skipped: the vendored figure kit has no mini)'); return; }
  const rows = [];
  for (const t of [0, 150, 180]) for (const screen of ['ipad', 'tv']) {
    const sc = SC(ALL_ON, { kit: FK, screen, lights: G.lightsAt(PLAY(), t) });
    const reveal = ['public', 'working', 'controlled', 'secure'], shown = P.tokenRooms(ROLL, reveal, []);
    const o = G.forPlayer({ view: 'iso', theme: 'rulebook', layer: 'player', reveal, layout: 'ipad' }, sc, shown, ALL_ON).opts;
    const n = Buffer.byteLength(K.render(ROLL, o).svg);
    rows.push('t=' + t + ' ' + screen + ' ' + Math.round(n / 1024) + ' KiB'); assert.ok(n < P.SVG_CAP, rows[rows.length - 1]);
  }
  console.log('  sizes (iso, all bands, people and crowd): ' + rows.join(' · '));
});

/* ---------- MK2, step 4: the room view's people as pictures ---------- */
const IMG = (n) => ({ href: 'data:image/webp;base64,' + 'QUJD'.repeat(n), width: 120, height: 420 });
test('the room view: a person with a picture goes as image (the data URL the kit and the server accept); without one, three people at most go as specs', () => {
  const crew = { pc1: { room: 'Showroom' }, pc2: { room: 'Showroom' }, pc3: { room: 'Showroom' }, pc4: { room: 'Showroom' }, pc5: { room: 'Showroom' }, pc6: { room: 'Cocktail lounge' } };
  const pcs = ['Nell Arbuthnot', 'Ray Okonjo', 'Tam Petrakis', 'Mabel Quist', 'Dov Kessler', 'Ada Vell'].map((name, i) => ({ id: 'pc' + (i + 1), name, spec: SPEC(name, 'masc') }));
  const shown = ['Showroom', 'Cocktail lounge'], f = G.flags(() => true);
  const none = G.forPlayer({}, SC(f, { pcs, crew, view: 'room', room: 'Showroom', images: {} }), shown, f).opts;
  assert.equal(none.view, 'room'); assert.equal(none.people.length, G.ROOM_SPECS); assert.equal(G.ROOM_SPECS, 3);
  assert.ok(none.people.every((p) => p.room === 'Showroom' && p.spec && !p.image), 'specs, in the room only');
  const people = G.playerPeople(SC(f, { pcs, crew }), ['Showroom']), images = {};
  people.slice(0, 4).forEach((p) => { images[G.imageKey(p)] = IMG(3); });
  images['not-a-person'] = IMG(1);
  const some = G.forPlayer({}, SC(f, { pcs, crew, view: 'room', room: 'Showroom', images }), shown, f).opts;
  assert.equal(some.people.filter((p) => p.image).length, 4, 'four pictures'); assert.equal(some.people.filter((p) => !p.image).length, 1, 'and the fifth as a spec');
  assert.deepEqual(some.people.find((p) => p.image).image, IMG(3));
  const bad = {}; bad[G.imageKey(people[0])] = { href: 'blob:http://x/1', width: 1, height: 1 }; bad[G.imageKey(people[1])] = { href: 'data:image/svg+xml;base64,QUJD', width: 1, height: 1 };
  const b = G.forPlayer({}, SC(f, { pcs, crew, view: 'room', room: 'Showroom', images: bad }), shown, f).opts;
  assert.ok(b.people.every((p) => !p.image), 'a blob: URL or an SVG data URL is never passed as a picture');
  assert.equal(G.inputKey(SC(f, { images })), G.inputKey(SC(f, { images: JSON.parse(JSON.stringify(images)) })), 'a picture keys by its person, not its bytes');
  assert.equal(G.forPlayer({}, SC(f, { pcs, crew, images }), shown, f).opts.people.filter((p) => p.image).length, 0, 'the map (not the room view) takes no pictures');
});

/* ---------- MK2, step 4b: one floor on the shared screen ---------- */
test('the shared screen\'s floor: an integer floor goes to the kit (with any map setting on); none, or the room view, sends no floor; off, nothing', () => {
  const f = ONLY('people');
  assert.equal(G.forPlayer({}, SC(f, { floor: 1 }), [], f).opts.floor, 1);
  assert.equal(G.forPlayer({}, SC(f, { floor: -1 }), [], f).opts.floor, -1);
  for (const v of [null, undefined, '1', 1.5, NaN]) assert.ok(!('floor' in G.forPlayer({}, SC(f, { floor: v }), [], f).opts), String(v));
  assert.ok(!('floor' in G.forPlayer({}, SC(ALL_ON, { floor: 1, view: 'room', room: 'Showroom' }), ['Showroom'], ALL_ON).opts), 'the room view is one room already');
  const o = { view: 'iso' }; assert.equal(G.forPlayer(o, SC(ALL_OFF, { floor: 1 }), [], ALL_OFF).opts, o, 'off: the options untouched');
});
test('the floors offered are the kit\'s own player-copy titles (generic: never a room\'s name)', () => {
  const K = require(path.join(ROOT, 'app', 'maps', 'map-kit.js'));
  const r = K.render(ROLL, { view: 'iso', layer: 'player', reveal: ['public'], layout: 'ipad' });
  const titles = (r.layout.levels || []).map((l) => String(l.title).toLowerCase());
  assert.ok(titles.length > 1 && titles.every((t) => P.LEVEL_TITLES.includes(t)), JSON.stringify(titles));
  for (const room of ROOMS) assert.ok(!titles.includes(room.name.toLowerCase()), room.name);
  const one = K.render(ROLL, { view: 'iso', layer: 'player', reveal: ['public'], layout: 'ipad', floor: r.layout.levels[0].lvl });
  assert.ok(one.svg.length < r.svg.length && !one.warnings.some((w) => /is not on this map/.test(w)), 'one floor draws less, and the kit knows the floor');
});

/* ---------- MK2, step 5: the site's crowd flag through the exporter ---------- */
test('play.crowd: { masked } (a boolean) survives the export into the pack; anything else under crowd is dropped, with a warning', () => {
  const NOTE = (play) => ['---', 'wiki: entity', '---', '# The Pelican Rooms', '', '```json b68-site\n' + JSON.stringify({ patch: { name: 'The Pelican Rooms', district: 'Nowhere Ward', rooms: ROOMS }, play }) + '\n```', ''].join('\n');
  const exp = (crowd) => { const p = cl(FX); if (crowd !== undefined) p.crowd = crowd; return parseSite(NOTE(p), 'The Pelican Rooms', 'r'); };
  const a = exp({ masked: true, colour: 'GM-ONLY-CROWD', density: 3 });
  assert.deepEqual(a.site.play.crowd, { masked: true });
  assert.ok(a.warnings.some((w) => /play\.crowd\.colour: not a crowd key; dropped/.test(w)) && a.warnings.some((w) => /play\.crowd\.density/.test(w)));
  assert.ok(!JSON.stringify(a.site).includes('GM-ONLY-CROWD'), 'nothing else under crowd reaches the pack');
  assert.deepEqual(exp({ masked: false }).site.play.crowd, { masked: false });
  assert.deepEqual(exp({ masked: 'yes' }).site.play.crowd, {}, 'masked not a boolean: dropped');
  assert.ok(!('crowd' in exp('masked').site.play) && !('crowd' in exp(undefined).site.play));
  assert.deepEqual(G.crowdOf(exp({ masked: true }).site.play), { masked: true }, 'and the map reads it');
});

/* ---------- the review of #234 ---------- */
test('a hidden dawn event never lights the player copy; a public one does; one told to the crew does; the GM copy shows them all', () => {
  const hidden = PLAY((p) => { const e = p.events.find((x) => x.fx === 'dawn'); delete e.vis; }), pub = PLAY();
  assert.equal(hidden.events.find((x) => x.fx === 'dawn').vis, 'hidden', 'no vis reads hidden');
  const st = { site: 'The Pelican Rooms', v: 2, start: 0, t: 180, crew: cl(CREW) }, shown = ROOMS.map((r) => r.name);
  assert.deepEqual(G.lightsAt(hidden, 180, G.knownEvents(hidden, st, shown)), {}, 'hidden: no light for the players');
  assert.deepEqual(G.lightsAt(pub, 180, G.knownEvents(pub, st, shown)), { Showroom: 'bright' }, 'public: lit');
  const told = PLAY((p) => { const e = p.events.find((x) => x.fx === 'dawn'); delete e.vis; });
  const toldSt = Object.assign({}, st, { told: { I1: 'crew' } });       /* fixture intel I1 reveals the speeches and the fireworks */
  assert.deepEqual(G.lightsAt(told, 180, G.knownEvents(told, toldSt, shown)), { Showroom: 'bright' }, 'told through intel: lit');
  for (const p of [hidden, pub]) { const o = {}; G.gm(o, ONLY('lights'), { model: model(p, CREW, 180), play: p, crew: CREW, pcs: PCS, t: 180 }); assert.deepEqual(o.lights, { Showroom: 'bright' }, 'the GM copy shows it'); }
  assert.deepEqual(G.knownEvents({ v: 1, events: [{ id: 'a', vis: 'public' }, { id: 'b' }] }, {}, []), { a: true }, 'no players\' view: public only');
  /* and through the page's door: the scene input carries only the known lights, the door keeps them only in shown rooms */
  const sc = SC(ONLY('lights'), { lights: G.lightsAt(hidden, 180, G.knownEvents(hidden, st, shown)) });
  assert.equal(G.forPlayer({}, sc, shown, ONLY('lights')).opts.lights, undefined);
});
test('layout "stage" only when the kit draws it: with map.fill on and a kit without it, the layout is today\'s', () => {
  assert.equal(G.stageOk({ options: () => ({ layouts: ['ipad', 'print', 'sheet', 'phone'] }) }), false);
  assert.equal(G.stageOk({ options: () => ({ layouts: ['ipad', 'stage'] }) }), true);
  assert.equal(G.stageOk(null), false); assert.equal(G.stageOk({ options() { throw new Error('x'); } }), false);
  const K = require(path.join(ROOT, 'app', 'maps', 'map-kit.js'));
  console.log('  (the vendored map kit ' + K.VERSION + ' draws layout "stage": ' + G.stageOk(K) + ')');
  const o = { layout: 'ipad', view: 'iso' };
  assert.deepEqual(G.forPlayer(o, SC(ONLY('fill'), { stage: false }), [], ONLY('fill')).opts, o, 'map.fill on, no stage in the kit: the options as today');
  assert.equal(G.forPlayer(o, SC(ONLY('fill'), { stage: false }), [], ONLY('fill')).key, '');
  const { render, calls } = spyRender();
  P.playerDisplay(ROLL, PMAP(), render, { tokens: [], hide: [], sig: '', scene: SC(ONLY('fill'), { stage: G.stageOk(K) }) });
  assert.equal(calls[calls.length - 1].layout, G.stageOk(K) ? 'stage' : 'ipad', 'what reaches the vendored kit');
});
test('the room cut: every deliberate map send clears it (Show on iPad, the Score\'s automatic map); only Cut to room keeps it', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  const body = (name) => { const i = src.indexOf('function ' + name + '('); return i < 0 ? '' : src.slice(i, src.indexOf('\n  }\n', i)); };
  assert.match(body('showOnIpad'), /if \(S && S\.sceneRoom && !S\.sceneCutting\) S\.sceneRoom = '';/, 'showOnIpad clears it unless Cut to room is sending');
  assert.match(body('siteMapUp'), /showOnIpad\(/, 'the site\'s Show on iPad and the Score\'s automatic map go through showOnIpad');
  assert.match(body('scoreMapDefault'), /siteMapUp\(/);
  const act = body('sceneAct');
  assert.match(act, /S\.sceneCutting = true;[\s\S]*siteMapUp\(false, false\)[\s\S]*finally \{ S\.sceneCutting = false; \}/, 'Cut to room is the one send that keeps it');
  assert.ok(!/sceneRoom\s*=\s*[^'=]/.test(body('liveReveal')), 'a live re-send neither sets nor clears it');
});

/* ---------- the overseer's addition 1: the stage drawn for the frame the shared screen reports ---------- */
test('the stage is sized to the reported map frame; without one (or a bad one), to the Shared screen select', () => {
  const f = ONLY('fill');
  assert.deepEqual(G.forPlayer({}, SC(f, { frame: { w: 1229, h: 870 }, screen: 'tv' }), [], f).opts, { layout: 'stage', displayWidth: 1229, displayHeight: 870 }, 'the frame wins over the select');
  for (const bad of [null, { w: 199, h: 900 }, { w: 1000, h: 10001 }, { w: '1229', h: 870 }, { w: 1229.5, h: 870 }, [1229, 870]]) {
    const o = G.forPlayer({}, SC(f, { frame: bad, screen: 'tv' }), [], f).opts;
    assert.deepEqual([o.displayWidth, o.displayHeight], [1920, 1080], 'fallback to the select: ' + JSON.stringify(bad));
  }
  assert.equal(G.frameOk({ w: 200, h: 10000 }), true); assert.equal(G.frameOk({ w: 200, h: 10001 }), false);
  assert.equal(G.frameMoved(null, { w: 1229, h: 870 }, 8), true, 'the first frame is taken');
  assert.equal(G.frameMoved({ w: 1229, h: 870 }, { w: 1236, h: 864 }, 8), false, 'a few pixels: no re-send');
  assert.equal(G.frameMoved({ w: 1229, h: 870 }, { w: 1240, h: 870 }, 8), true, 'more than 8 px: taken');
  assert.equal(G.frameMoved({ w: 1229, h: 870 }, null, 8), false, 'no frame reported: keep the last one');
  assert.notEqual(G.inputKey(SC(f, { frame: { w: 1229, h: 870 } })), G.inputKey(SC(f, { frame: { w: 1366, h: 900 } })), 'a new frame changes the live map\'s key (it is sent again)');
  assert.deepEqual(G.forPlayer({ layout: 'ipad' }, SC(f, { frame: { w: 1229, h: 870 }, stage: false }), [], f).opts, { layout: 'ipad' }, 'a kit without stage: the frame changes nothing');
});
test('the frame\'s ask and answer: top-level keys, never in the status; the GM asks (frameWant, a bare boolean), the display answers ({ w, h }); neither moves the signal; with no ask the display\'s part is a1f8d57\'s', () => {
  /* the answer: the display may send it; only w and h, whole px from 200 to 10000; anything else dropped without failing the PATCH */
  assert.deepEqual(cleanSttPatch({ frame: { w: 1229, h: 870 } }, 'display'), { frame: { w: 1229, h: 870 } });
  for (const bad of [{ w: 1229 }, { w: -1, h: 870 }, 'big', [1229, 870], { w: 1229.2, h: 870 }]) assert.deepEqual(cleanSttPatch({ frame: bad }, 'display'), {}, JSON.stringify(bad));
  assert.deepEqual(cleanSttPatch({ frame: { w: 1229, h: 870, svg: '<svg/>' } }, 'display'), { frame: { w: 1229, h: 870 } }, 'only w and h are kept');
  /* the status is a1f8d57's: a frame put in it is not kept */
  assert.ok(!('frame' in cleanSttPatch({ status: { state: 'idle', lines: 0, frame: { w: 1229, h: 870 } } }, 'display').status));
  /* the ask: the GM's only (403 for the display); true asks, anything else takes it back (null deletes the key) */
  assert.deepEqual(cleanSttPatch({ frameWant: true }, 'gm'), { frameWant: true }); assert.deepEqual(cleanSttPatch({ frameWant: false }, 'gm'), { frameWant: null });
  assert.throws(() => cleanSttPatch({ frameWant: true }, 'display'), /only the GM/);
  assert.equal(cleanFrame({ w: 200, h: 200 }).w, 200); assert.equal(cleanFrame({ w: 199, h: 200 }), null);
  /* the display's part (its GET): no ask, exactly a1f8d57's (the same keys, the same seq); with the ask, frame: true and a new seq */
  const base = { want: 'off', session: '' }, asked = Object.assign({ frameWant: true, frame: { w: 1229, h: 870 } }, base);
  assert.deepEqual(sttPartOf(Object.assign({ frame: { w: 1229, h: 870 } }, base)), sttPartOf(base), 'an answer alone changes nothing the display reads');
  assert.deepEqual(Object.keys(sttPartOf(base)), ['seq', 'want', 'session']);
  assert.equal(sttPartOf(asked).frame, true); assert.notEqual(sttPartOf(asked).seq, sttPartOf(base).seq, 'the ask reaches the display on its own GET');
  /* and the display page passes it on to its transcriber module (its part cleaner keeps frame only when it is exactly true) */
  const DP = require(path.join(ROOT, 'app', 'display-page.js')).Pure;
  assert.deepEqual(DP.sttPart({ stt: sttPartOf(asked) }), Object.assign({}, sttPartOf(asked)), 'asked: frame: true kept');
  assert.deepEqual(DP.sttPart({ stt: sttPartOf(base) }), sttPartOf(base), 'not asked: the part as a1f8d57 cleans it');
  assert.ok(!('frame' in DP.sttPart({ stt: Object.assign({}, sttPartOf(base), { frame: 'yes' }) })), 'anything but true: no ask');
  const src = fs.readFileSync(path.join(ROOT, 'app', 'display-page.js'), 'utf8');
  assert.match(src, /o\.onStt\(stt\.frame === true \? \{ seq: stt\.seq, want: stt\.want, session: stt\.session, frame: true \}/, 'the hand-off to the transcriber keeps the ask');
  /* the signal (the poke): neither key moves it, so two screens answering different sizes poke nobody */
  const doc = (x) => Object.assign({ want: 'off', status: { state: 'idle', lines: 0, error: '' } }, x || {});
  assert.equal(sttSignal(doc({ frameWant: true, frame: { w: 1229, h: 870 } })), sttSignal(doc({ frameWant: true, frame: { w: 1366, h: 900 } })), 'two answers that differ only in frame: the same signal');
  assert.equal(sttSignal(doc({ frameWant: true, frame: { w: 1229, h: 870 } })), sttSignal(doc()), 'and a1f8d57\'s signal');
});
test('the GM band\'s transcriber pill depends on what it did before: a document holding only the frame\'s ask and answer is not "set up"', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  assert.match(src, /var show = STT\.loaded && \(\(!!STT\.at && sttOwn\(d\)\) \|\| on\);/);
  const body = src.slice(src.indexOf('function sttOwn('), src.indexOf('\n', src.indexOf('function sttOwn(')));
  const sttOwn = new Function('return ' + body.replace(/^\s*/, ''))();
  assert.equal(sttOwn({ frameWant: true, frame: { w: 1, h: 1 } }), false, 'only the ask and the answer: no pill');
  assert.equal(sttOwn({ frameWant: true }), false);
  for (const d of [{ want: 'off' }, { status: { state: 'idle' } }, { session: '3' }, { speakers: {} }, { copier: { at: 'x' } }, { want: 'off', frameWant: true }]) assert.equal(sttOwn(d), true, JSON.stringify(d));
});
test('two screens cannot make the map flap: alternating frames (two sizes, twenty reports) give at most two re-sends, then the Shared screen select sizes the stage', () => {
  const A = { w: 1229, h: 1050 }, B = { w: 1088, h: 970 };
  let st = null, sends = 0, t = 0;
  for (let i = 0; i < 20; i++) { t += 60000; const r = G.frameTrack(st, i % 2 ? B : A, t); st = r.state; if (r.resend) sends++; }
  assert.equal(sends, 2, 'two re-sends (' + sends + ')'); assert.equal(G.FRAME_SENDS, 2); assert.equal(G.FRAME_WINDOW, 600000);
  assert.equal(st.stopped, true); assert.equal(st.frame, null, 'following stopped: no frame');
  const f = ONLY('fill'), o = G.forPlayer({}, SC(f, { frame: st.frame, screen: 'tv' }), [], f).opts;
  assert.deepEqual([o.displayWidth, o.displayHeight], [1920, 1080], 'the stage from the Shared screen select at the end');
  /* one screen: a resize is followed, and the same size again asks for nothing */
  let one = G.frameTrack(null, A, 0); assert.equal(one.resend, true);
  one = G.frameTrack(one.state, { w: 1232, h: 1048 }, 1000); assert.equal(one.resend, false, 'a few px: nothing');
  one = G.frameTrack(one.state, B, 2000); assert.equal(one.resend, true, 'a real resize, once');
  /* the window: two changes, then a third more than ten minutes after the first is followed again */
  let w = G.frameTrack(null, A, 0); w = G.frameTrack(w.state, B, 60000); w = G.frameTrack(w.state, A, 660001);
  assert.equal(w.resend, true, 'outside the ten minutes: followed'); assert.equal(w.state.stopped, false);
  /* stopped stays stopped until the GM chooses in the select (a null state: the page's handler) or reloads */
  assert.equal(G.frameTrack(st, A, t + 3600000).resend, false);
  assert.equal(G.frameTrack(null, A, t + 3600000).resend, true, 'a fresh start follows again');
});
test('the frame is in the scene input only where the stage is sized to it (map.fill on, a kit that draws stage)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  assert.match(src, /frame: f\.fill && G\.stageOk\(W\.B68Map\) \? S\.sceneFrame \|\| null : null/);
  for (const k of ['people', 'lights', 'room']) {
    const f = ONLY(k), a = G.forPlayer({}, SC(f, { frame: null }), ['Showroom'], f).opts, b = G.forPlayer({}, SC(f, { frame: { w: 1229, h: 1050 } }), ['Showroom'], f).opts;
    assert.deepEqual(strip(b), strip(a), k + ' alone: a frame changes nothing that reaches the kit');
  }
});

/* ---------- the overseer's addition 2: a person's own role ---------- */
test('play.people[].role: kept by checkPlay when shaped like a role id; it wins over the kind on the GM copy when the figure kit knows it', () => {
  const p = PLAY((x) => { x.people.find((q) => q.id === 'pq').role = 'croupier'; x.people.find((q) => q.id === 'wr').role = 'Not A Role'; x.people.find((q) => q.id === 'od').role = 'astronaut'; });
  assert.equal(p.people.find((q) => q.id === 'pq').role, 'croupier');
  assert.ok(!('role' in p.people.find((q) => q.id === 'wr')), 'not an id: dropped');
  const r = BALL.checkPlay((() => { const x = cl(FX); x.people[1].role = 42; return x; })(), ROOMS.map((q) => q.name));
  assert.ok(r.warnings.some((w) => /\.role: 42 is not a role id; dropped/.test(w)));
  /* minute 0: Pip Quill (staff) in the Cocktail lounge, Odette (target) in the Showroom; Pip is on the board as a looker (the cook disguise) */
  const o = {}; G.gm(o, ONLY('people'), { model: model(p, CREW, 0), play: p, crew: CREW, pcs: PCS, cast: () => null, t: 0, kit: KIT });
  const pip = o.people.find((q) => q.label === 'Pip Quill'), od = o.people.find((q) => q.label === 'Odette Marsh');
  assert.equal(pip.role, 'croupier', 'the play\'s role wins over staff (waiter)');
  assert.equal(od.role, 'resident', 'an id the kit does not know is ignored: the role from the kind');
  const kitRoles = { roles: () => [{ id: 'astronaut' }] }, o2 = {};
  G.gm(o2, ONLY('people'), { model: model(p, CREW, 0), play: p, crew: CREW, pcs: PCS, cast: () => null, t: 0, kit: Object.assign({}, KIT, kitRoles) });
  assert.equal(o2.people.find((q) => q.label === 'Odette Marsh').role, 'astronaut', 'the kit\'s own roles() decides what is known');
  assert.ok(!JSON.stringify(G.forPlayer({}, SC(ALL_ON), ROOMS.map((q) => q.name), ALL_ON).opts.people).includes('croupier'), 'GM copy only: the player copy is the crew');
});

/* ---------- the overseer's ruling: name each person once ---------- */
test('people on: each crew name appears once in the player SVG of the whole-building iso (the flag, not also the pin); a view with no people keeps the pins; people off: the pins as on ' + BASE, () => {
  const K = require(path.join(ROOT, 'app', 'maps', 'map-kit.js')), FK = require(path.join(ROOT, 'app', 'figures', 'figure-kit.js'));
  if (typeof FK.mini !== 'function' || typeof FK.extra !== 'function') { console.log('  (skipped: the vendored figure kit has no mini)'); return; }
  const render = K.render.bind(K), reveal = ['public'], shown = P.tokenRooms(ROLL, reveal, []);
  const pcs = PCS.map((c, i) => ({ id: c.id, name: c.name, spec: FK.extra({ role: i ? 'guest-m' : 'guest-f', seed: c.id }) }));
  const crew = { pc1: { room: 'Showroom' }, pc2: { room: 'Underground counting room' }, pc3: { room: 'Cocktail lounge' } };
  const placed = { crew, pins: {} }, tokPcs = (skip) => pcs.filter((c) => !skip.includes(c.id)).map((c) => ({ id: c.id, name: c.name, icon: '' }));
  const full = P.playerTokens(placed, shown, [], tokPcs([]), null), bare = P.playerTokens(placed, shown, [], tokPcs(pcs.map((c) => c.id)), null);
  assert.ok(full.length >= 2 && bare.length === 0, 'the fixture has pins to drop');
  const scene = SC(ONLY('people'), { pcs, crew, kit: FK, disguises: [] });
  const count = (svg, name) => P.svgText(svg).split(name.toLowerCase()).length - 1;
  const onIso = P.playerDisplay(ROLL, PMAP({ view: 'iso' }), render, { tokens: full, hide: [], sig: 'x', scene, bare: { tokens: bare, hide: [] } });
  for (const n of ['Nell Arbuthnot', 'Tam Petrakis']) assert.equal(count(onIso.svg, n), 1, n + ' once in the iso with people on (' + count(onIso.svg, n) + ')');
  assert.equal(count(onIso.svg, 'Ray Okonjo'), 0, 'a crew member in a hidden room: neither flag nor pin');
  assert.equal(onIso.tokens, 0, 'no pins went (each crew member is a figure with a flag)');
  /* a view that draws no people: the pins come back, so nobody is left unnamed */
  const onRings = P.playerDisplay(ROLL, PMAP({ view: 'rings' }), render, { tokens: full, hide: [], sig: 'x', scene, bare: { tokens: bare, hide: [] } });
  assert.equal(onRings.tokens, full.length, 'rings draws no people: every pin');
  /* a kit that did not draw them (no `people` in its result): the pins after all */
  const blind = (roll, o) => { const r = render(roll, o); delete r.people; return r; };
  assert.equal(P.playerDisplay(ROLL, PMAP({ view: 'iso' }), blind, { tokens: full, hide: [], sig: 'x', scene, bare: { tokens: bare, hide: [] } }).tokens, full.length);
  /* people off: no scene and no bare set, so the pins are exactly what a1f8d57's page draws */
  if (OLD) {
    const a = OLD.playerDisplay(ROLL, PMAP({ view: 'iso' }), render, { tokens: full, hide: [], sig: 'x' }), b = P.playerDisplay(ROLL, PMAP({ view: 'iso' }), render, { tokens: full, hide: [], sig: 'x' });
    assert.equal(b.svg, a.svg, 'people off: the same svg, pins and all'); assert.equal(b.tokens, full.length);
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
