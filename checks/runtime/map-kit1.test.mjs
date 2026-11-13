// Map kit 1.0, the grand map (ticket 2.1, switch map.kit1; app/maps/map-kit.js, src/grand.js): what it adds, and what it must not change.
//   - Backward compatible: every fixture site draws byte for byte as kit 0.9 did (golden hashes taken from 0.9 itself) with the switch
//     off and the 1.0 fields present, and with the switch on and no `kit: 1`.
//   - The six features in both views (the section is the iPad's score view, the exploded iso the planning board and the print).
//   - Per-room reveal (#135) on the new geometry: a player copy names no hidden room, and changing a hidden room's 1.0 fields changes
//     no byte of it.
//   - The GM page: mapOpts asks for kit 1.0 only while the switch is on; the authored-site exporter carries the fields through.
// INVENTED data only: the Pelican Rooms extended with the 1.0 fields (fixtures/gm/pelican-kit1.json) and the fixture tables.
//   node checks/runtime/map-kit1.test.mjs                 (--write-golden: rewrite the goldens, ONLY ever against a 0.9 kit)
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sites, rolled, cases, sha, FIXL, PELICAN_K1 } from './fixtures/gm/map-kit1-cases.mjs';
import { parseSite } from '../../scripts/lib/authored-export.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const K = require(path.join(ROOT, 'app', 'maps', 'map-kit.js'));
const M = K._internal;
const P = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
const L = require(path.join(ROOT, 'app', 'gm', 'location.js'));
const GOLDEN = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'map-kit1-golden.json');

if (process.argv.includes('--write-golden')) {
  if (K.VERSION !== '0.9.0') { console.log('FAIL --write-golden takes its hashes from kit 0.9.0 only; this kit is ' + K.VERSION); process.exit(1); }
  const S = sites(), out = {};
  for (const [key, s, opts] of cases()) out[key] = sha(K.render(typeof s === 'number' ? rolled(s) : S[s], opts).svg);
  fs.writeFileSync(GOLDEN, JSON.stringify(out, null, 0).replace(/","/g, '",\n"') + '\n');
  console.log('wrote ' + Object.keys(out).length + ' golden hashes');
  process.exit(0);
}

let failed = 0, passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const S = sites(), K1 = S.pelicanK1, GOLD0 = JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));
/* MK2: the vendored kit may change a golden case only for a listed reason (scripts/map-goldens.mjs, which works the reason out against kit 1.0.0);
   those cases and their new hashes are in map-kit1-golden-changes.json, recorded against this kit's sha256. Every other case is held to 0.9. */
const CHANGES = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'map-kit1-golden-changes.json'), 'utf8'));
const KITS = JSON.parse(fs.readFileSync(path.join(ROOT, 'app', 'kits.json'), 'utf8')).kits.maps;
const LISTED = ['heading', 'iso-cover', 'facade', 'street-key', 'key-walls'];      /* key-walls: the overseer's final build, its listed change 2 */
const GOLD = Object.assign({}, GOLD0, Object.fromEntries(Object.entries(CHANGES.changed).map(([k, v]) => [k, v.sha])));
const ROOMS = K1.rooms.map((r) => r.name);
const draw = (opts, roll = K1) => K.render(roll, Object.assign({ kit1: true, layout: 'ipad' }, opts));
/* the scene a render built (M.grand.section / M.iso.build), caught on its way to the theme */
function scene(opts, roll = K1) {
  const seen = {}, sec = M.grand.section, iso = M.iso.build;
  M.grand.section = function () { const r = sec.apply(this, arguments); seen.sec = r; return r; };
  M.iso.build = function () { const r = iso.apply(this, arguments); seen.iso = r; return r; };
  try { seen.out = draw(opts, roll); } finally { M.grand.section = sec; M.iso.build = iso; }
  return seen;
}
const flat = (ps) => ps.flatMap((p) => (p && p.t === 'g' ? [p].concat(flat(p.kids)) : p ? [p] : []));
const pieces = (sc) => flat(sc.parts.flatMap((pt) => Object.values(pt.layers).flat()));
const cls = (ps, c) => ps.filter((p) => p.t === 'g' && (p.cls || '').split(' ').includes(c));
const role = (ps, r) => ps.filter((p) => p.r === r);
const without = (roll, fn) => { const r = JSON.parse(JSON.stringify(roll)); fn(r); return r; };

/* ---------- 1. backward compatible ---------- */
test('the goldens are 0.9\'s, one per case; the cases the vendored kit changed are recorded against THIS kit, each for a listed reason', () => {
  assert.deepEqual(Object.keys(GOLD0).sort(), cases().map((c) => c[0]).sort());
  assert.equal(CHANGES.kit.version, K.VERSION, 'recorded against ' + CHANGES.kit.version + ', the app vendors ' + K.VERSION);
  assert.equal(CHANGES.kit.sha256, KITS.sha256, 'the changes were recorded against another build of the map kit: run node scripts/map-goldens.mjs');
  for (const [k, v] of Object.entries(CHANGES.changed)) {
    assert.ok(k in GOLD0, k + ' is a case'); assert.ok(Array.isArray(v.why) && v.why.length && v.why.every((w) => LISTED.includes(w)), k + ': ' + JSON.stringify(v.why));
  }
  assert.ok(Object.keys(CHANGES.changed).every((k) => /:player\d$/.test(k)), 'with the switch off, only player copies changed (the GM layer is 0.9\'s)');
});

test('switch off: every fixture site draws byte for byte as kit 0.9, but for the recorded, listed changes (the 1.0 fields present on the Pelican Rooms)', () => {
  const bad = [];
  for (const [key, s, opts] of cases()) if (sha(K.render(typeof s === 'number' ? rolled(s) : S[s], opts).svg) !== GOLD[key]) bad.push(key);
  assert.deepEqual(bad, [], bad.length + ' of ' + cases().length + ' cases changed');
});

test('switch on, no kit: 1 on the roll: byte for byte as kit 0.9 too', () => {
  const bad = [];
  for (const [key, s, opts] of cases()) {
    const roll = typeof s === 'number' ? rolled(s) : s === 'pelicanK1' ? without(S[s], (r) => { delete r.kit; }) : S[s];
    if (sha(K.render(roll, Object.assign({}, opts, { kit1: true })).svg) !== GOLD[key]) bad.push(key);
  }
  assert.deepEqual(bad, [], bad.length + ' cases changed');
});

test('kit: 1 without the switch, or the switch as anything but true: 0.9', () => {
  for (const kit1 of [undefined, false, 'true', 1]) assert.equal(sha(K.render(K1, { view: 'section', layout: 'ipad', kit1 }).svg), GOLD['pelicanK1:section:rulebook:gm'], String(kit1));
});

/* ---------- 2. the six features, both views ---------- */
test('the fixture reads clean: no warning but the two passages it leaves on purpose', () => {
  const w = draw({ view: 'section', layer: 'gm' }).warnings.filter((x) => !/^colour /.test(x));
  assert.deepEqual(w, ["Top floor: 384 sq ft of its footprint is no room's — drawn as passage", "Basement: 384 sq ft of its footprint is no room's — drawn as passage"]);
});

test('1. floors with their own footprints: each floor is its build.floors rect, the top floor set back; the section steps with them', () => {
  const r = draw({ view: 'iso', layer: 'gm' }), F = PELICAN_K1.patch.build.floors;
  for (const lv of r.layout.levels) {
    const f = F[String(lv.lvl)];
    assert.deepEqual([lv.bbox.x, lv.bbox.y, lv.bbox.w, lv.bbox.h], [f.x, -(f.y + f.d), f.w, f.d], 'floor ' + lv.lvl);
    assert.equal(lv.authored, true, 'floor ' + lv.lvl + ' drawn as authored');
  }
  const rows = M.grand.secRows(r.layout, r.model), row = (l) => rows.find((x) => x.lv.lvl === l);
  assert.ok(row(2).L > row(1).L + 10, 'the top floor stands back from the front');
  assert.equal(row(0).L, 0); assert.equal(row(-1).L, 0);
  for (const [l, h] of [[0, 18], [1, 14], [2, 12], [-1, 11]]) assert.ok(Math.abs(row(l).y1 - row(l).y0 - h) < 1e-9, 'storey height of floor ' + l);
});

test('2. a room spanning two floors: a void over it ringed by a gallery, double height in the section, a chandelier in it', () => {
  const s = scene({ view: 'section', layer: 'gm' }), ps = pieces(s.sec), lay = s.out.layout;
  const up = lay.levels.find((l) => l.lvl === 1), v = up.voids[0];
  assert.equal(up.voids.length, 1); assert.equal(v.span.name, 'Showroom'); assert.equal(v.ring.name, 'Private card rooms');
  assert.deepEqual([v.rect.x, v.rect.w, v.rect.h], [32, 32, 40], 'the void: the gallery is 8 ft wide all round');
  assert.ok(up.walls.some((w) => w.t === 'rail'), 'a rail round the void');
  const ring = up.rooms.find((r) => r.name === 'Private card rooms');
  assert.equal(ring.shape.pts.length, 10, 'the gallery is the frame with the void cut out');
  assert.ok(ring.frames.length === 4, 'furnished along four runs');
  const tall = role(ps, 'floor-public').filter((p) => p.h > 18 + 14);
  assert.equal(tall.length, 1, 'one public room is drawn through two storeys');
  assert.ok(cls(ps, 'fx-rail').length === 1, 'the balustrade');
  assert.ok(cls(ps, 'fx-chandelier').length >= 1, 'the chandelier');
  const iso = scene({ view: 'iso', layer: 'gm' });
  assert.ok(cls(pieces(iso.iso), 'fx-chandelier').length >= 1, 'the iso hangs it in the void');
  assert.equal(iso.iso.coreLinks.filter((p) => p.r === 'core-link').length, 3 + 4, 'the core threads up three floors, and the void drops to the room below corner by corner');
});

test('3. the canal face: water door, water steps, boats, a loading door at the waterline (both views)', () => {
  const ps = pieces(scene({ view: 'section', layer: 'gm' }).sec);
  for (const c of ['fx-water-steps', 'fx-boat', 'fx-barge']) assert.ok(cls(ps, c).length >= 1, 'section: ' + c);
  assert.equal(cls(ps, 'fx-boat').length, 2, 'two boats');
  assert.ok(role(ps, 'water-body').length >= 1 && role(ps, 'quay').length >= 1, 'section: the canal and its landing');
  assert.ok(role(ps, 'door-gap').length >= 2, 'section: the water door and the loading door');
  const s = scene({ view: 'iso', layer: 'gm' }), ip = pieces(s.iso);
  for (const c of ['fx-water-steps', 'fx-boat', 'fx-barge']) assert.ok(cls(ip, c).length >= 1, 'iso: ' + c);
  const ground = s.out.layout.levels.find((l) => l.lvl === 0), base = s.out.layout.levels.find((l) => l.lvl === -1);
  assert.ok(role(ip, 'street').length === 0 && role(ip, 'water-body').length >= 2, 'iso: water where the street was, and along the basement');
  assert.ok(base.doors.some((d) => d.face === 'loading-door' && d.ext), 'the loading door is a door in the basement\'s front wall');
  assert.ok(ground.doors.some((d) => d.kind === 'ext-double'), 'the front (water) door');
});

test('4. a grand stair: an imperial stair in the plan and iso, branching flights in the section with the floor above open over them', () => {
  const ps = pieces(scene({ view: 'section', layer: 'gm' }).sec);
  assert.equal(cls(ps, 'fx-stairs-grand').length, 1);
  const ip = pieces(scene({ view: 'iso', layer: 'gm' }).iso);
  assert.equal(cls(ip, 'fx-stairs-grand').length, 1);
  assert.ok(K.parts['stairs-grand'], 'a registered part');
});

test('5. a palazzo section: parapet and cornice, arched windows, a rusticated base, and no pitched roof or chimney', () => {
  const ps = pieces(scene({ view: 'section', layer: 'gm' }).sec);
  assert.ok(cls(ps, 'fx-parapet').length >= 2, 'a parapet on every roof (the set-back floor makes two)');
  assert.ok(role(ps, 'cornice').length >= 3 && role(ps, 'baluster').length > 20, 'cornice and balusters');
  assert.ok(role(ps, 'arch-glass').length >= 6, 'arched windows');
  assert.ok(role(ps, 'rustic').length >= 10, 'a rusticated base');
  assert.equal(role(ps, 'roof').length, 0, 'no pitched roof, no chimney');
  // the same building without the style: the building's own shell (an Old relic is pitched and chimneyed)
  const plain = without(K1, (r) => { delete r.build.style; r.geometry = { rings: 'blurred' }; });
  const pp = pieces(scene({ view: 'section', layer: 'gm' }, plain).sec);
  assert.equal(role(pp, 'roof').length, 2, 'the pitched roof and its chimney');
  assert.equal(cls(pp, 'fx-parapet').length, 0);
  const ip = pieces(scene({ view: 'iso', layer: 'gm' }).iso);
  assert.ok(cls(ip, 'fx-arches').length >= 2, 'iso: the far walls carry arched windows');
});

test('6. scale contrast: storeys of their own heights, grand rooms arched and lit, service rooms under a dropped ceiling; taller iso walls', () => {
  const ps = pieces(scene({ view: 'section', layer: 'gm' }).sec);
  assert.ok(cls(ps, 'fx-arches').length >= 1, 'a grand room\'s arches');
  assert.ok(role(ps, 'drop-ceiling').length >= 2, 'the service rooms\' dropped ceilings');
  const s = scene({ view: 'iso', layer: 'gm' }), wallH = (l) => Math.max(...s.iso.parts.find((p) => p.lv.lvl === l).iso.walls.filter((w) => w.t !== 'ext').map((w) => w.h));
  assert.ok(Math.abs(wallH(0) / wallH(2) - 18 / 12) < 1e-9, 'iso walls stand as tall as their storey: ' + wallH(0) + ', ' + wallH(2));
});

test('every view and theme draws the grand site, gm and player, with no new warning', () => {
  for (const view of ['iso', 'plan', 'section', 'rings', 'street']) for (const theme of ['rulebook', 'blueprint', 'casefile', 'board', 'plate']) for (const layer of ['gm', 'player']) {
    const r = draw({ view, theme, layer });
    assert.match(r.svg, /^<svg/, view + ' ' + theme + ' ' + layer);
    assert.ok(!r.svg.includes('NaN') && !r.svg.includes('undefined'), view + ' ' + theme + ' ' + layer + ' has no NaN or undefined');
  }
});

/* ---------- 3. per-room reveal on the new geometry ---------- */
const REVEALS = [['public'], ['public', 'room:Private card rooms'], ['public', 'working'], ['public', 'controlled'], ['public', 'room:Luxury penthouse'], ['public', 'working', 'controlled', 'secure']];
test('the player copy names no hidden room, at every reveal, in both views and every theme (the GM page\'s own scan)', () => {
  for (const reveal of REVEALS) for (const view of ['section', 'iso', 'plan']) for (const theme of ['rulebook', 'blueprint', 'casefile', 'plate']) {
    const r = draw({ view, theme, layer: 'player', reveal });
    assert.deepEqual(P.leaks(r.svg, K1, reveal), [], view + ' ' + theme + ' at ' + reveal.join('+'));
  }
});

test('Show on iPad (playerDisplay) sends the grand section and iso clean, opening rooms one by one', () => {
  let open = [];
  for (const name of ['Private card rooms', 'Security control room', 'Underground counting room', 'Luxury penthouse']) {
    open = open.concat([name]);
    for (const view of ['section', 'iso']) {
      const d = P.playerDisplay(K1, { layer: 'player', view, theme: 'rulebook', reveal: {}, open }, (roll, o) => K.render(roll, Object.assign({}, o, { kit1: true })));
      assert.deepEqual(P.leaks(d.svg, K1, d.reveal), [], view + ' with ' + open.join(', '));
      for (const n of ROOMS) if (!open.includes(n) && !['Showroom', 'Cocktail lounge'].includes(n)) assert.ok(!d.svg.toUpperCase().includes(n.toUpperCase()), n + ' is not in the file');
    }
  }
});

test('a hidden room\'s 1.0 fields change no byte of the player copy (scale, gallery, span geometry)', () => {
  const reveal = ['public'];
  const base = (roll) => ['section', 'iso', 'plan'].map((view) => sha(draw({ view, layer: 'player', reveal }, roll).svg));
  const ref = base(K1);
  const room = (r, n) => r.rooms.find((x) => x.name === n);
  const edits = {
    'the hidden penthouse made grand': (r) => { room(r, 'Luxury penthouse').scale = 'grand'; },
    'the hidden control room made grand': (r) => { room(r, 'Security control room').scale = 'grand'; },
    'the hidden gallery made wider': (r) => { room(r, 'Private card rooms').gallery = 12; },
    'the hidden counting room made plain': (r) => { delete room(r, 'Underground counting room').scale; },
  };
  for (const [what, fn] of Object.entries(edits)) assert.deepEqual(base(without(K1, fn)), ref, what);
  // and the known span room's double height shows only once the gallery round its void is known
  const sec = (rv) => pieces(scene({ view: 'section', layer: 'player', reveal: rv }).sec);
  assert.equal(role(sec(['public']), 'floor-public').filter((p) => p.h > 32).length, 0, 'gallery hidden: the showroom is one storey');
  assert.equal(cls(sec(['public']), 'fx-chandelier').length, 1, 'one storey, its own chandelier (the cocktail lounge has the stair instead)');
  assert.equal(role(sec(['public', 'room:Private card rooms']), 'floor-public').filter((p) => p.h > 32).length, 1, 'gallery known: double height');
});

test('a void the crew can see into, but not the room under it, is a dark well: no chandelier, no floor, no name', () => {
  const reveal = ['working', 'controlled'];        // the gallery, not the showroom under it
  const ps = pieces(scene({ view: 'section', layer: 'player', reveal }).sec);
  assert.ok(role(ps, 'void-well').length === 1, 'the well');
  assert.equal(cls(ps, 'fx-chandelier').length, 0);
  const r = draw({ view: 'section', layer: 'player', reveal });
  assert.deepEqual(P.leaks(r.svg, K1, reveal), []);
  const ip = pieces(scene({ view: 'iso', layer: 'player', reveal }).iso);
  assert.ok(role(ip, 'void-well').length === 1 && cls(ip, 'fx-chandelier').length === 0, 'iso: the well, no chandelier');
});

/* ---------- 4. the iPad: as quick to draw as today's map ---------- */
// Today's iPad map is 0.9's iso (the GM page's default view). The section, the new score view, carries about as much as it does
// (the paint measured in Edge, CPU slowed 4x, is in the PR); the iso, the planning board and the print, is allowed twice as much.
test('the iPad copy weighs about what today\'s map does: the section within 1.25x of 0.9\'s iso (elements and bytes), the iso within 2.2x', () => {
  const plain = without(K1, (r) => { delete r.kit; }), all = ['public', 'working', 'controlled', 'secure'];
  const els = (s) => (s.match(/<[a-z]/g) || []).length;
  for (const reveal of [['public'], all]) {
    const today = K.render(plain, { view: 'iso', layout: 'ipad', layer: 'player', reveal }).svg;
    for (const [view, x] of [['section', 1.25], ['iso', 2.2]]) {
      const svg = draw({ view, layer: 'player', reveal }).svg;
      assert.ok(els(svg) <= els(today) * x && svg.length <= today.length * x, view + ' at ' + reveal.length + ' bands: ' + els(svg) + ' elements, ' + Math.round(svg.length / 1024) + ' KiB against today\'s ' + els(today) + ', ' + Math.round(today.length / 1024));
    }
  }
  const t0 = performance.now(); for (let i = 0; i < 5; i++) draw({ view: 'section', layer: 'player', reveal: all }); const ms = (performance.now() - t0) / 5;
  assert.ok(ms < 250, 'the section renders in ' + Math.round(ms) + ' ms');
});

/* ---------- 5. the GM page and the exporter ---------- */
test('mapOpts: no kit1 key while the switch is off (the 0.9 options exactly); the switch id is map.kit1', () => {
  assert.equal(P.KIT1_SWITCH, 'map.kit1');
  assert.equal(P.kit1On(), false);
  assert.deepEqual(P.mapOpts({}, 'gm', ['public']), { view: 'iso', theme: 'rulebook', layer: 'gm', reveal: ['public'], width: 1400 });
  assert.ok(!('kit1' in P.mapOpts({ view: 'section' }, 'player', ['public'], P.IPAD_MAP)));
});

const FEAT = require(path.join(ROOT, 'app', 'features.js'));
test('the switch is a registry line: map.kit1, GM only, stage Maps, default off, Saturday try; never public', () => {
  const s = FEAT.get('map.kit1');
  assert.ok(s, 'registered');
  assert.deepEqual([s.surface, s.stage, s.default, s.saturday], ['gm', 'map', false, 'try']);
  assert.ok(!FEAT.publicIds().includes('map.kit1'), 'not a display or phone id');
  assert.deepEqual(FEAT.cleanPublic({ 'map.kit1': true }), {}, 'the campaign copy drops it');
});

test('the registry text is GM-bland: no proper name, no GM-only marker (app/features.js is public)', () => {
  const s = FEAT.get('map.kit1'), text = s.label + ' ' + s.doc;
  assert.ok(!/GM-ONLY/.test(text));
  const caps = (text.match(/\b[A-Z][a-z]+\b/g) || []).filter((w) => !['The', 'A', 'Off'].includes(w));
  assert.deepEqual(caps, [], 'capitalised words other than sentence starts');
});

test('the GM page reads map.kit1 through the registry (B68Features.valueOf on its state document): always on since N0, whatever is stored', () => {
  const key = require.resolve(path.join(ROOT, 'app', 'gm-page.js'));
  const had = Object.getOwnPropertyDescriptor(globalThis, 'self');
  globalThis.self = { B68Features: FEAT };
  delete require.cache[key];
  try {
    const Q = require(key)._pure;
    assert.equal(Q.kit1Of({}), true, 'nothing stored: on');
    assert.equal(Q.kit1Of({ features: { 'map.kit1': false } }), true, 'a stored false (the old All off) is still on');
    assert.equal(Q.kit1Of({ features: { 'map.kit1': 'yes' } }), true);
    assert.throws(() => FEAT.patchFor({}, 'map.kit1', false), /always on/, 'and nothing can write it off');
    assert.equal(Q.kit1Of(Q.applyPatch({ features: { 'map.kit1': false } }, FEAT.patchAllOff({}))), true, 'the settings reset leaves it on');
    assert.equal(Q.kit1On(), true, 'no page open: still on');
    // what mapOpts and the score scene do while it is on
    Q.kit1On = () => true;
    assert.equal(Q.mapOpts({ view: 'section' }, 'player', ['public'], Q.IPAD_MAP).kit1, true);
    const seen = [];
    Q.scoreScene(K1, { layer: 'player', reveal: {} }, (roll, o) => { seen.push(o.view + ':' + !!o.kit1); return K.render(roll, o); });
    assert.deepEqual(seen.filter((s) => s.endsWith(':true')).map((s) => s.split(':')[0]), ['plan', 'iso'], 'the board and the iso');
  } finally {
    if (had) Object.defineProperty(globalThis, 'self', had); else delete globalThis.self;
    delete require.cache[key];
  }
});

test('the exporter carries kit, build and the room fields through an authored site\'s patch untouched', () => {
  const block = '```json b68-site\n' + JSON.stringify({ patch: PELICAN_K1.patch }) + '\n```';
  const r = parseSite(block, 'The Pelican Rooms', 'x');
  assert.deepEqual(r.site.patch, PELICAN_K1.patch);
  const roll = P.authoredRoll(L, FIXL, r.site);
  assert.equal(roll.kit, 1); assert.deepEqual(roll.build, PELICAN_K1.patch.build);
  assert.deepEqual(roll.rooms.map((x) => x.at), PELICAN_K1.patch.rooms.map((x) => x.at));
});

test('bad fields are warnings, never guesses: the building still draws', () => {
  const bad = without(K1, (r) => {
    r.build.style = 'gothic'; r.build.front = 'moat'; r.build.floors['3'] = { x: 0, y: 0, w: 10, d: 10 }; r.build.floors['1'].h = 99;
    r.build.faces.push({ kind: 'drawbridge' }, { kind: 'boats', room: 'Nowhere' }); r.build.stair = { room: 'Showroom', to: 7 };
    r.rooms[0].span = 3; r.rooms[3].ring = 'Cocktail lounge'; r.rooms[1].scale = 'huge'; r.rooms[2].at = [0, 0, 1, 1];
  });
  const r = draw({ view: 'section', layer: 'gm' }, bad);
  assert.match(r.svg, /^<svg/);
  for (const re of [/build\.style "gothic"/, /build\.front "moat"/, /build\.floors "3"/, /build\.floors "1"\.h/, /kind must be one of/, /room "Nowhere"/, /build\.stair/, /span 3/, /ring "Cocktail lounge"/, /scale "huge"/, /"at" must be/]) assert.ok(r.warnings.some((w) => re.test(w)), String(re));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
