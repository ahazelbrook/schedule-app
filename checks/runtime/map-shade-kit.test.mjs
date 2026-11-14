// IP7 with the real kits (map kit 1.2.0, figure kit 3.1.0): what the new `shade` option draws, and what the app must survive. No browser, no network.
//   a. A shaded map WITH PEOPLE: each person behind a solid is cut by <use href="#<id>"> of that solid (class map-occluder). Every such reference
//      resolves inside the same svg; the server's checkSvg takes the svg unchanged; the page's leak scan finds nothing new; the ids keep the kit's prefix.
//      (The display's sanitiser and the planning board's checker are proved in a real browser: map-shade.e2e.mjs.)
//   b. The idPrefix: two draws of the same inputs share every id (a hash of the inputs): see map-shade.e2e.mjs for what the display does with that.
//   c. With shade the crowd stands elsewhere and can be smaller: nothing the app keeps depends on where the kit put anyone. The one thing it reads
//      back, result.people ({ room, mark }), still names every crew member with a figure, or the page puts the markers back (allDrawn).
//   3. Sizes: the demo site (the Pelican Rooms) and a grand site (its kit-1 copy), the shared screen keyed and stage, with people and a crowd, shade off
//      and on, against the 600 KiB cap; the ladder run for real with the cap forced low.
// INVENTED data only: the Pelican Rooms and its play fixture, the Dovetail Crew.
//   node checks/runtime/map-shade-kit.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sites } from './fixtures/gm/map-kit1-cases.mjs';
import { checkSvg } from '../../functions/_lib/gm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const K = require(path.join(ROOT, 'app', 'maps', 'map-kit.js'));
const FK = require(path.join(ROOT, 'app', 'figures', 'figure-kit.js'));
const G = require(path.join(ROOT, 'app', 'gm', 'scene-state.js'));
const BALL = require(path.join(ROOT, 'app', 'gm', 'ball.js'));
const RV = require(path.join(ROOT, 'app', 'gm', 'run-view.js'));
const P = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
P.sceneMod = G;

let failed = 0, passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const cl = (v) => JSON.parse(JSON.stringify(v));
const KIB = (s) => Math.round(Buffer.byteLength(s) / 1024);
const shade0 = P.shadeOn, kit10 = P.kit1On, cap0 = P.SVG_CAP;
function as(on, fn) { P.shadeOn = () => on; P.kit1On = () => true; try { return fn(); } finally { P.shadeOn = shade0; P.kit1On = kit10; P.SVG_CAP = cap0; } }

if (!/^1\.2\./.test(K.VERSION)) { console.log('SKIP the vendored map kit is ' + K.VERSION + ': these checks are for 1.2 (shade)'); process.exit(0); }

/* ---------- the fixture night ---------- */
const S = sites();
const SITES = [['the Pelican Rooms (demo)', S.pelican], ['the Pelican Rooms, kit 1 (grand)', S.pelicanK1]];
const ROOMS = S.pelican.rooms.map((r) => r.name);
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'pelican-play-v2.json'), 'utf8'));
const PLAY = BALL.checkPlay(cl(FX), ROOMS).play;
const SPEC = (id, name, figure) => ({ id, name, figure, heightIn: 68, skin: 'olive', outfit: 'street' });
const PCS = [{ id: 'pc1', name: 'Nell Arbuthnot', spec: SPEC('nell', 'Nell Arbuthnot', 'fem') }, { id: 'pc2', name: 'Ray Okonjo', spec: SPEC('ray', 'Ray Okonjo', 'masc') },
  { id: 'pc3', name: 'Tam Petrakis', spec: null }];
const CREW = { pc1: { room: 'Showroom' }, pc2: { room: 'Cocktail lounge' }, pc3: { room: 'Cocktail lounge' } };
const FLAGS = (ks) => G.flags((id) => ks.some((k) => G.IDS[k] === id));
const SC = (ks, extra) => Object.assign({ flags: FLAGS(ks), pcs: cl(PCS), crew: cl(CREW), disguises: [], crowd: true, lights: {}, screen: 'tv', stage: G.stageOk(K), view: '', room: '', kit: FK }, extra || {});
const MAP = (extra) => Object.assign({ layer: 'player', view: 'iso', theme: 'rulebook', reveal: { public: true, working: true }, open: [], know: [] }, extra || {});
const LAYOUTS = [['keyed', ['people']], ['stage', ['people', 'fill']], ['room cut', ['people', 'room'], { view: 'room', room: 'Showroom' }]];
const draw = (roll, ks, extra, map) => P.playerDisplay(roll, map || MAP(), K.render, { tokens: [], hide: [], sig: '', scene: SC(ks, extra) });
/* every <use href="#x"> and url(#x) of an svg string, and whether x is an id of the same svg */
function refs(svg) {
  const ids = new Set([...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const hrefs = [...svg.matchAll(/<use\b[^>]*?\s(?:xlink:)?href="#([^"]+)"/g)].map((m) => m[1]), urls = [...svg.matchAll(/url\(#([^)]+)\)/g)].map((m) => m[1]);
  return { ids, hrefs, missing: hrefs.concat(urls).filter((x) => !ids.has(x)), occluders: (svg.match(/class="map-occluder"/g) || []).length };
}

/* ---------- a. the occluders reach the screen whole ---------- */
const ON = {}, OFF = {};
for (const [name, roll] of SITES) for (const [lay, ks, extra] of LAYOUTS) {
  ON[name + '|' + lay] = as(true, () => draw(roll, ks, extra));
  OFF[name + '|' + lay] = as(false, () => draw(roll, ks, extra));
}
test('a. with shade and people, the iso maps carry occluders (<use href="#…"> of a solid), and every reference resolves inside the same svg', () => {
  let occ = 0;
  for (const k of Object.keys(ON)) {
    const r = refs(ON[k].svg);
    assert.deepEqual(r.missing, [], k + ': every href and url() names an id of this svg');
    if (!k.endsWith('room cut')) { assert.ok(r.occluders > 0, k + ': at least one person stands behind a solid'); occ += r.occluders; }
    for (const h of r.hrefs.filter((x) => /-o[0-9a-z]+$/.test(x))) assert.ok(new RegExp('<g[^>]*\\sid="' + h + '"').test(ON[k].svg), k + ': the occluder\'s target is the solid\'s group: ' + h);
    assert.equal(refs(OFF[k].svg).occluders, 0, k + ': off, no occluder');
  }
  console.log('  occluders on the shaded maps: ' + occ);
});
test('a. the server\'s checkSvg takes every shaded map with people as it is (no reference stripped, nothing refused)', () => {
  for (const k of Object.keys(ON)) assert.equal(checkSvg(ON[k].svg), ON[k].svg.trimStart(), k);
});
test('a. the page\'s leak scan finds nothing on the shaded maps that the flat ones do not have; no hidden room is named', () => {
  for (const [name, roll] of SITES) for (const [lay] of LAYOUTS) {
    const k = name + '|' + lay, rv = P.revealEntries(MAP());
    assert.deepEqual(P.leaks(ON[k].svg, roll, rv), [], k);
  }
});
test('a. every id keeps the kit\'s prefix (b68m…, or a figure\'s own), so two maps of different inputs never share one', () => {
  for (const k of Object.keys(ON)) {
    const bad = [...refs(ON[k].svg).ids].filter((id) => !/^b68[a-z0-9]/.test(id) && !/-b68[a-z0-9]/.test(id));
    assert.deepEqual(bad.slice(0, 5), [], k);
  }
});

/* ---------- b. the idPrefix ---------- */
test('b. two draws of the same inputs are the same file, ids and all (the prefix is a hash of the inputs); a different input, different ids', () => {
  const [name, roll] = SITES[0];
  const a = as(true, () => draw(roll, ['people'])).svg, b = as(true, () => draw(roll, ['people'])).svg;
  assert.equal(a, b, 'deterministic');
  const c = as(true, () => draw(roll, ['people'], {}, MAP({ reveal: { public: true } }))).svg;
  const ia = refs(a).ids, ic = refs(c).ids, shared = [...ia].filter((x) => ic.has(x));
  console.log('  ' + name + ': the same inputs share all ' + ia.size + ' ids; one band fewer shares ' + shared.length + ' of them');
  const flat = as(false, () => draw(roll, ['people'])).svg, sf = [...refs(flat).ids].filter((x) => ia.has(x));
  console.log('  shade off and on of the same map share ' + sf.length + ' ids');
});

/* ---------- c. nothing depends on where the kit put anyone ---------- */
test('c. the crowd moves and may shrink with shade; every crew member with a figure is still drawn and named in result.people, or the page puts the markers back', () => {
  for (const [name, roll] of SITES) {
    const on = as(true, () => K.render(roll, P.scenePlayer(P.mapOpts(MAP(), 'player', P.revealEntries(MAP()), P.IPAD_MAP), roll, P.revealEntries(MAP()), MAP(), { tokens: [], hide: [], sig: '', scene: SC(['people']) })));
    const off = as(false, () => K.render(roll, P.scenePlayer(P.mapOpts(MAP(), 'player', P.revealEntries(MAP()), P.IPAD_MAP), roll, P.revealEntries(MAP()), MAP(), { tokens: [], hide: [], sig: '', scene: SC(['people']) })));
    const persons = (r) => (r.svg.match(/class="map-person"/g) || []).length;
    console.log('  ' + name + ': people drawn flat ' + persons(off) + ', with shade ' + persons(on) + '; result.people ' + (off.people || []).length + ' -> ' + (on.people || []).length);
    const want = G.figured(G.playerPeople(SC(['people']), ROOMS).filter((p) => p.spec).map((p) => Object.assign({ mark: G.initials(p.label) }, p)), 'iso');
    for (const r of [on, off]) {
      const all = G.allDrawn(r, want);
      if (!all) console.log('  (not all drawn: the page would send the markers back; checked below)');
      for (const w of want) if (all) assert.ok(r.people.some((d) => d.room === w.room && d.mark === w.mark), name + ': ' + w.label + ' drawn');
    }
  }
  /* the player path end to end: with shade, a crew member the kit does not draw keeps a marker (the bare markers are used only when all are drawn) */
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  assert.match(src, /if \(tkb !== tk && !sceneMod\(\)\.allDrawn\(r, sceneMod\(\)\.figured\(o\.people, o\.view\)\)\) return playerDisplay\(/, 'the player copy\'s check runs after the shaded render');
  assert.match(src, /r = sceneGmCheck\(o, r, K\);/, 'and the GM copy\'s');
});
test('c. the GM copy at three times of the fixture night: with shade, everyone the board places with a figure is drawn or keeps a pill', () => {
  const roll = S.pelican, FLOORS = { list: [{ lvl: 0, name: 'Ground' }], floorOf: Object.fromEntries(ROOMS.map((n) => [n, 0])) };
  for (const t of [0, 150, 180]) {
    const model = RV.model(PLAY, { site: roll.name, v: 2, start: 0, t, crew: CREW }, { t, pcs: PCS.map((c) => ({ id: c.id, name: c.name })), floors: FLOORS, isOpen: () => false });
    for (const on of [false, true]) {
      const o = as(on, () => P.mapOpts({ layer: 'gm', view: 'iso', theme: 'rulebook' }, 'gm', ['public'], P.IPAD_MAP));
      G.gm(o, FLAGS(['people']), { model, play: PLAY, crew: CREW, pcs: PCS, cast: () => null, t, kit: FK });
      const r = K.render(roll, o), want = G.figured(o.people, o.view);
      const all = G.allDrawn(r, want);
      if (!all) console.log('  t=' + t + (on ? ' shade' : ' flat') + ': ' + want.filter((w) => !r.people.some((d) => d.room === w.room && d.mark === w.mark)).map((w) => w.label).join(', ') + ' not drawn: the page gives them their pills back');
      assert.equal(o.shade, on ? true : undefined);
    }
  }
});

/* ---------- 3. sizes, and the ladder for real ---------- */
test('3. sizes: the demo site and the grand site, shared screen keyed and stage, people and a crowd, shade off and on, all under the 600 KiB cap', () => {
  const rows = [];
  for (const [name, roll] of SITES) for (const [lay] of LAYOUTS) {
    const k = name + '|' + lay, a = Buffer.byteLength(OFF[k].svg), b = Buffer.byteLength(ON[k].svg);
    rows.push('  ' + (name + ', ' + lay).padEnd(48) + String(KIB(OFF[k].svg)).padStart(4) + ' KiB -> ' + String(KIB(ON[k].svg)).padStart(4) + ' KiB (' + ((b - a) / a * 100).toFixed(1) + '%), cap ' + Math.round(cap0 / 1024) + ', cut: ' + (ON[k].sceneCut || 'none'));
    assert.ok(b <= cap0, k); assert.equal(ON[k].sceneCut, undefined, k);
  }
  rows.forEach((r) => console.log(r));
});
test('3. the ladder for real: with the cap just under the shaded map, the flat map goes ("shade"); lower, the crowd goes; lower still, the people', () => {
  const [, roll] = SITES[1];
  const on = Buffer.byteLength(ON[SITES[1][0] + '|keyed'].svg), flat = Buffer.byteLength(OFF[SITES[1][0] + '|keyed'].svg);
  const noCrowd = Buffer.byteLength(as(false, () => K.render(roll, Object.assign(P.scenePlayer(P.mapOpts(MAP(), 'player', P.revealEntries(MAP()), P.IPAD_MAP), roll, P.revealEntries(MAP()), MAP(), { tokens: [], hide: [], sig: '', scene: SC(['people']) }), { crowd: undefined }))).svg);
  console.log('  grand keyed: shaded ' + on + ', flat ' + flat + ', flat without the crowd ' + noCrowd + ' bytes');
  if (flat < on) {
    const d = as(true, () => { P.SVG_CAP = on - 1; return draw(roll, ['people']); });
    assert.equal(d.sceneCut, 'shade'); assert.ok(Buffer.byteLength(d.svg) <= on - 1); assert.equal(refs(d.svg).occluders, 0, 'flat: no occluders');
  } else console.log('  (the flat map is not smaller here: the shade step cannot help, the ladder moves on)');
  const d2 = as(true, () => { P.SVG_CAP = Math.max(noCrowd, Math.min(flat, on) - 1); return draw(roll, ['people']); });
  assert.ok(Math.min(flat, on) - 1 >= noCrowd, 'the fixture leaves room between the steps');
  assert.equal(d2.sceneCut, 'crowd', 'the crowd goes next'); assert.ok(!/class="map-occluder"/.test(d2.svg), 'and the depth with it');
  const d3 = as(true, () => { P.SVG_CAP = noCrowd - 1; try { return draw(roll, ['people']); } catch (e) { return { err: e }; } });
  assert.ok(d3.err ? d3.err.big === true : d3.sceneCut === 'scene', 'then the people (or a refusal that says it is too large)');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
