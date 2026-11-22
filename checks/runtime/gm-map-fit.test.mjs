// gm-map-fit (RK28, setting map.fit): the map fits the iPad. No browser, no network.
//   - Off means today: with map.fit off (or its module not loaded) every options object the page hands the map kit, and every svg and error, is
//     1ad1ba3d's own, byte for byte (the map-shade.test pattern, `atCommit`), across the matrix of views, bands, markers, scenes, sizes and depth.
//   - On, with a stand-in renderer that fixes each size: the steps fire in order (flat furniture, half the crowd, no crowd, one figure in a room cut,
//     no people, rings), each through the page's own clean() with the SAME markers, each recorded as { rung, bytes, leaked }; a map nothing fits is
//     refused ON THE PAGE with the smallest size tried and the steps that leaked, and nothing is ever sent for the server to 413.
//   - On, with the real map and figure kits: an INVENTED 12-room palazzo (kit: 1) with a crowded three-PC room cut reaches the iPad under 600 KiB
//     at a full scene (people, crowd, lights, depth); and, at caps set to its own measured sizes, every rung fires on the real kits.
//   - leaks(), hiddenNames() and tokenScreen() (and the helpers they read) keep their source: the same text as 1ad1ba3d, and pinned by hash.
// INVENTED data only: the Pelican Rooms and the Palazzo Rooms; the Dovetail Crew (Nell Arbuthnot, Ray Okonjo, Tam Petrakis).
//   node checks/runtime/gm-map-fit.test.mjs        (RK28_PRINT_HASHES=1 prints the scan functions' hashes instead of checking them)
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/map-fit.js';
const FIT = require(path.join(ROOT, FILE));
const SLIM = require(path.join(ROOT, 'app', 'gm', 'svg-slim.js'));
const G = require(path.join(ROOT, 'app', 'gm', 'scene-state.js'));
const F = require(path.join(ROOT, 'app', 'features.js'));
const L = require(path.join(ROOT, 'app', 'gm', 'location.js'));
const P = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
P.sceneMod = G;
const TODAY = '1ad1ba3d';
const FIXL = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'location-pack.json'), 'utf8'));

let failed = 0, passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const cl = (v) => JSON.parse(JSON.stringify(v));
const kib = (s) => Math.round(Buffer.byteLength(s) / 1024);

/* a module as it was at a commit, loaded from a temp copy (null when git cannot show it) */
function atCommit(rev, rel) {
  const r = spawnSync('git', ['show', rev + ':' + rel], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-rk28-')), f = path.join(dir, path.basename(rel));
  fs.writeFileSync(f, r.stdout);
  try { return { mod: require(f), src: r.stdout }; } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* harmless */ } }
}
const OLD = atCommit(TODAY, 'app/gm-page.js');
const OLDP = OLD && OLD.mod._pure; if (OLDP) OLDP.sceneMod = G;
const withFit = (on, fn) => { const a = P.fitOn, b = P.mapFit, c = P.svgSlim; P.fitOn = () => on; P.mapFit = FIT; P.svgSlim = SLIM; try { return fn(); } finally { P.fitOn = a; P.mapFit = b; P.svgSlim = c; } };
const withShade = (on, fn) => { const a = P.shadeOn, b = OLDP && OLDP.shadeOn; P.shadeOn = () => on; if (OLDP) OLDP.shadeOn = () => on; try { return fn(); } finally { P.shadeOn = a; if (OLDP) OLDP.shadeOn = b; } };
const withCap = (cap, fn) => { const a = P.SVG_CAP, b = OLDP && OLDP.SVG_CAP; P.SVG_CAP = cap; if (OLDP) OLDP.SVG_CAP = cap; try { return fn(); } finally { P.SVG_CAP = a; if (OLDP) OLDP.SVG_CAP = b; } };
const withKit1 = (fn) => { const a = P.kit1On; P.kit1On = () => true; try { return fn(); } finally { P.kit1On = a; } };

/* ---------- the fixture: the Pelican Rooms, the Dovetail Crew ---------- */
const ROOMS = [
  { name: 'Showroom', band: 'public' }, { name: 'Cocktail lounge', band: 'public' }, { name: 'Security control room', band: 'working' },
  { name: 'Private card rooms', band: 'controlled' }, { name: 'Underground counting room', band: 'working' }, { name: 'Luxury penthouse', band: 'secure', isTarget: true }];
const ROLL = { name: 'The Pelican Rooms', district: 'Nowhere Ward', target: 'Gambling den', targetRoom: 'Luxury penthouse', targetBand: 'secure', rooms: ROOMS, vectors: [], skips: [] };
const SPECOF = (name, i) => ({ id: 'spec-' + i, name, figure: i % 2 ? 'masc' : 'fem', heightIn: 68, skin: 'olive', outfit: 'street' });
const PCS3 = ['Nell Arbuthnot', 'Ray Okonjo', 'Tam Petrakis'].map((n, i) => ({ id: 'pc' + (i + 1), name: n, spec: SPECOF(n, i) }));
const CREW3 = { pc1: { room: 'Showroom' }, pc2: { room: 'Showroom' }, pc3: { room: 'Showroom' } };
const ALL_ON = G.flags(() => true), ONLY = (k) => G.flags((id) => id === G.IDS[k]);
const SC = (f, extra) => Object.assign({ flags: f, pcs: cl(PCS3), crew: cl(CREW3), disguises: [], crowd: true, lights: {}, screen: 'ipad', stage: true, view: '', room: '', kit: null, images: {} }, extra || {});
const PMAP = (extra) => Object.assign({ layer: 'player', view: 'iso', theme: 'rulebook', reveal: { public: true }, open: [], know: [] }, extra || {});
const TK = (scene, extra) => Object.assign({ tokens: [], hide: [], sig: '', scene }, extra || {});
const NOTK = () => ({ tokens: [], hide: [], sig: '' });
const tok = (room) => ({ room, label: 'Nell Arbuthnot', svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>NA</text></svg>' });
/* a capturing stand-in kit; `size(o)` sets the drawing's bytes (default small); `say(o)` adds visible text (to leak a hidden name) */
function spy(size, say) {
  const calls = [];
  const render = (roll, o) => { calls.push(o); const n = size ? size(o) : 0; return { svg: '<svg xmlns="http://www.w3.org/2000/svg">\n  <g>\n  <text>Showroom' + (say ? say(o) : '') + '</text>\n  </g>\n' + (n ? '<!--' + 'x'.repeat(n) + '-->' : '') + '\n</svg>', warnings: [] }; };
  return { render, calls };
}
const BIG = 700 * 1024, CAP = 600 * 1024;
const sceneOf = (f, extra) => TK(SC(f || ONLY('people'), extra));

/* ---------- 1. the module and the setting ---------- */
test('the module loads under Node, and as a plain script defines window.B68GmMapFit and window.B68GmSvgSlim: neither is a stub any more', () => {
  assert.ok(FIT && typeof FIT === 'object'); assert.ok(!FIT.stub); assert.ok(!SLIM.stub);
  for (const k of ['plan', 'wrap', 'fit', 'halfCrowd', 'oneFigure', 'refusal']) assert.equal(typeof FIT[k], 'function', k);
  assert.deepEqual(FIT.RUNGS, ['shade', 'halfcrowd', 'crowd', 'figures', 'scene', 'rings']);
  for (const [file, name, fn] of [[FILE, 'B68GmMapFit', 'fit'], ['app/gm/svg-slim.js', 'B68GmSvgSlim', 'slim']]) {
    const win = {}; win.self = win; win.window = win;
    vm.runInNewContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), win, { filename: file });
    assert.equal(typeof win[name][fn], 'function', name);
  }
});
test('map.fit is a GM setting, default off; nothing stored reads off; the page reads it through the registry; it never reaches a phone', () => {
  const s = F.get('map.fit'); assert.ok(s);
  assert.equal(s.setting, true); assert.equal(s.default, false); assert.equal(s.surface, 'gm');
  assert.equal(F.valueOf({}, 'map.fit'), false); assert.equal(F.valueOf({ features: { 'map.fit': true } }, 'map.fit'), true);
  assert.equal(P.fitOf({}), false); assert.equal(P.fitOf(null), false);
  assert.equal(P.FIT_SWITCH, 'map.fit');
  assert.match(fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8'), /function fitOf\(doc\) \{[^\n]*F\.isSetting\(FIT_SWITCH\) && F\.valueOf\(doc, FIT_SWITCH\) === true/);
  assert.deepEqual(F.publicView({}), F.publicView({ 'map.fit': true }));
});
test('off: P.fitOn() is false, P.fitMod() is null and P.fitWrap(render) is render itself; on without the module loaded, the same', () => {
  assert.equal(P.fitOn(), false); assert.equal(P.fitMod(), null);
  const r = () => ({ svg: '<svg/>' }); assert.equal(P.fitWrap(r), r);
  const a = P.fitOn, b = P.mapFit; P.fitOn = () => true; P.mapFit = undefined;
  try { assert.equal(P.fitMod(), null); assert.equal(P.fitWrap(r), r); } finally { P.fitOn = a; P.mapFit = b; }
});

/* ---------- the real kits and the invented palazzo (used by sections 2 and 7) ---------- */
const PALAZZO = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'palazzo-kit1.json'), 'utf8'));      /* invented: 12 rooms, kit: 1 */
let REAL = null;
try {
  const K = require(path.join(ROOT, 'app', 'maps', 'map-kit.js')), FK = require(path.join(ROOT, 'app', 'figures', 'figure-kit.js'));
  if (typeof FK.mini === 'function' && typeof FK.extra === 'function') REAL = { K, FK, roll: P.authoredRoll(L, FIXL, PALAZZO) };
} catch (e) { REAL = null; }
function realCase(over) {      /* the Dovetail Crew with the heaviest invented figures, all in one room, its lights on */
  const { FK } = REAL, roles = ['docker', 'sailor', 'warehouse-hand'];
  const pcs = PCS3.map((c, i) => ({ id: c.id, name: c.name, spec: FK.extra({ role: roles[i], seed: 's20' }) })), crew = { pc1: { room: 'Cocktail lounge' }, pc2: { room: 'Cocktail lounge' }, pc3: { room: 'Cocktail lounge' } };
  const scene = SC(ALL_ON, Object.assign({ pcs, crew, kit: FK, lights: { 'Cocktail lounge': 'bright' }, view: 'room', room: 'Cocktail lounge' }, over && over.scene || {}));
  return { map: PMAP(Object.assign({ reveal: { public: true } }, over && over.map || {})), tk: TK(scene) };
}
function cl2(tk) { return Object.assign({}, tk, { scene: Object.assign({}, tk.scene, { pcs: tk.scene.pcs.map((p) => Object.assign({}, p)) }) }); }
/* ---------- 2. off means today ---------- */
const MAPS = [];
for (const view of ['iso', 'plan', 'rings', 'room']) for (const reveal of [{ public: true }, { public: true, working: true }])
  for (const extra of [{}, { open: ['Private card rooms'] }, { time: 'Night', weather: 'fog' }]) MAPS.push(PMAP(Object.assign({ view, reveal }, extra)));
const TKS = [null, NOTK(), { tokens: [tok('Showroom')], hide: [], sig: 'x' },
  TK(SC(ALL_ON)), TK(SC(ALL_ON, { view: 'room', room: 'Showroom' })), TK(SC(ONLY('fill'))), TK(SC(ONLY('people'))),
  TK(SC(ALL_ON), { tokens: [tok('Showroom')], sig: 'x', bare: { tokens: [], hide: [] } })];
test('off: every options object, svg and error of the player path is ' + TODAY + '\'s, byte for byte (sizes small and over the cap, depth on and off)', () => {
  if (!OLDP) { console.log('  (skipped: git cannot show ' + TODAY + ')'); return; }
  let n = 0;
  for (const shade of [false, true]) withShade(shade, () => {
    for (const size of [null, (o) => (o.crowd ? BIG : 0), (o) => (o.people ? BIG : 0), (o) => (o.shade ? BIG : 0), () => BIG]) for (const map of MAPS) for (const tk of TKS) {
      const a = spy(size), b = spy(size); let ea = null, eb = null, ra, rb;
      try { ra = OLDP.playerDisplay(ROLL, map, a.render, tk && cl(tk)); } catch (e) { ea = e.message; }
      try { rb = P.playerDisplay(ROLL, map, b.render, tk && cl(tk)); } catch (e) { eb = e.message; }
      assert.equal(eb, ea); assert.equal(JSON.stringify(b.calls), JSON.stringify(a.calls), 'the same options: ' + JSON.stringify(map));
      if (!ea) assert.deepEqual(rb, ra);
      n += b.calls.length;
    }
  });
  assert.ok(n > 500, n + ' calls compared');
});
test('off: the real kits, the invented palazzo: the same svg byte for byte as ' + TODAY + ' (whole map, room cut, depth on and off, over the cap and under)', () => {
  if (!OLDP || !REAL) { console.log('  (skipped)'); return; }
  withKit1(() => { OLDP.kit1On = () => true; for (const shade of [false, true]) withShade(shade, () => {
    for (const c of [realCase(), realCase({ scene: { view: '', room: '' } }), realCase({ map: { view: 'plan' } })]) for (const cap of [CAP, 250 * 1024]) {
      let ea = null, eb = null, ra, rb;
      try { ra = withCap(cap, () => OLDP.playerDisplay(REAL.roll, c.map, (r, o) => REAL.K.render(r, o), cl2(c.tk))); } catch (e) { ea = e.message; }
      try { rb = withCap(cap, () => P.playerDisplay(REAL.roll, c.map, (r, o) => REAL.K.render(r, o), cl2(c.tk))); } catch (e) { eb = e.message; }
      assert.equal(eb, ea); if (!ea) assert.deepEqual(rb, ra);
    }
  }); OLDP.kit1On = () => false; });
});
test('off: the SCENE_CUT_MSG lines of today are unchanged, and the three new ones are there', () => {
  if (OLDP) for (const k of Object.keys(OLDP.SCENE_CUT_MSG)) assert.equal(P.SCENE_CUT_MSG[k], OLDP.SCENE_CUT_MSG[k], k);
  assert.match(P.SCENE_CUT_MSG.halfcrowd, /half the crowd.*over the iPad’s 600 KiB\.$/);
  assert.match(P.SCENE_CUT_MSG.figures, /one full figure and no crowd.*over the iPad’s 600 KiB\.$/);
  assert.match(P.SCENE_CUT_MSG.rings, /as rings, without its people.*over the iPad’s 600 KiB\.$/);
  for (const k of FIT.RUNGS) assert.equal(typeof P.SCENE_CUT_MSG[k], 'string', k + ' has a toast line');
});

/* ---------- 3. on, a stand-in renderer that fixes each size: the steps fire in order ---------- */
test('on: under the cap nothing is cut: one render, no sceneCut, no ladder', () => withFit(true, () => {
  const b = spy(() => 100 * 1024), d = P.playerDisplay(ROLL, PMAP(), b.render, sceneOf());
  assert.equal(b.calls.length, 1); assert.ok(!('sceneCut' in d));
}));
test('on, rung 1: a shaded map over the cap goes flat first (the people and the crowd stay), and says "shade"', () => withFit(true, () => withShade(true, () => {
  const b = spy((o) => (o.shade ? BIG : 100)), d = P.playerDisplay(ROLL, PMAP(), b.render, sceneOf());
  assert.equal(d.sceneCut, 'shade'); assert.equal(b.calls.length, 2);
  assert.equal(b.calls[0].shade, true); assert.equal(b.calls[1].shade, undefined); assert.ok(Array.isArray(b.calls[1].people) && b.calls[1].crowd, 'the scene stays');
})));
test('on, rung 2: half the crowd (density 0.5), with the people and the depth; a masked crowd stays masked', () => withFit(true, () => withShade(true, () => {
  const half = (o) => (o.crowd && !o.crowd.density ? BIG : 100);
  const b = spy(half), d = P.playerDisplay(ROLL, PMAP(), b.render, sceneOf());
  assert.equal(d.sceneCut, 'halfcrowd');
  assert.deepEqual(b.calls.map((o) => [!!o.shade, o.crowd ? (o.crowd.density || 1) : 0, Array.isArray(o.people)]), [[true, 1, true], [false, 1, true], [true, 0.5, true]], 'full, flat, then half the crowd with depth');
  const m = spy(half), d2 = P.playerDisplay(ROLL, PMAP(), m.render, sceneOf(ONLY('people'), { crowd: { masked: true } }));
  assert.equal(d2.sceneCut, 'halfcrowd'); assert.deepEqual(m.calls[m.calls.length - 1].crowd, { masked: true, density: 0.5 });
  assert.equal(FIT.halfCrowd({ density: 0.5 }), null, 'already at the kit\'s floor: no such rung'); assert.deepEqual(FIT.halfCrowd(true), { density: 0.5 });
})));
test('on, rung 3: no crowd, the people stay', () => withFit(true, () => {
  const b = spy((o) => (o.crowd ? BIG : 100)), d = P.playerDisplay(ROLL, PMAP(), b.render, sceneOf());
  assert.equal(d.sceneCut, 'crowd');
  assert.deepEqual(b.calls.map((o) => (o.crowd ? o.crowd.density || 1 : 0)), [1, 0.5, 0]);
  assert.ok(Array.isArray(b.calls[2].people) && b.calls[2].people.length > 0); assert.ok(!('crowd' in b.calls[2]));
}));
test('on, rung 4: a room cut with three figures keeps one full figure and no crowd; anything else has no such rung', () => withFit(true, () => {
  const room = () => sceneOf(ALL_ON, { view: 'room', room: 'Showroom' }), specs = (o) => (Array.isArray(o.people) ? o.people.filter((p) => p.spec && !p.image).length : 0);
  let b = spy((o) => (specs(o) > 1 ? BIG : 100)), d = P.playerDisplay(ROLL, PMAP(), b.render, room());
  assert.equal(d.sceneCut, 'figures');
  assert.deepEqual(b.calls.map((o) => [o.view, o.crowd ? o.crowd.density || 1 : 0, o.people.length]), [['room', 1, 3], ['room', 0.5, 3], ['room', 0, 3], ['room', 0, 1]]);
  assert.equal(b.calls[3].people[0].room, 'Showroom');
  const img = { href: 'data:image/png;base64,QUJD', width: 1, height: 1 };      /* a person the page has a picture of stays; only the specs after the first go */
  const one = FIT.oneFigure([{ spec: {}, room: 'a' }, { spec: {}, image: img, room: 'a' }, { spec: {}, room: 'a' }, { spec: {}, room: 'a' }]);
  assert.equal(one.length, 2); assert.ok(one[0].spec && !one[0].image && one[1].image);
  assert.equal(FIT.oneFigure([{ spec: {} }]), null); assert.equal(FIT.oneFigure([]), null); assert.equal(FIT.oneFigure(null), null);
  b = spy((o) => (o.people ? BIG : 100)); d = P.playerDisplay(ROLL, PMAP(), b.render, sceneOf());      /* an iso: crowd steps, then no people */
  assert.equal(d.sceneCut, 'scene'); assert.ok(b.calls.every((o) => !o.people || o.people.length === b.calls[0].people.length), 'no figure rung for an iso');
}));
test('on, rungs 5 and 6: no people (the map as chosen stays), then rings; with no scene only rings is left; a map already rings has none', () => withFit(true, () => {
  let b = spy((o) => (o.people ? BIG : 100)), d = P.playerDisplay(ROLL, PMAP(), b.render, sceneOf());
  assert.equal(d.sceneCut, 'scene'); assert.equal(b.calls[b.calls.length - 1].people, undefined); assert.equal(b.calls[b.calls.length - 1].view, 'iso');
  b = spy((o) => (o.view !== 'rings' ? BIG : 100)); d = P.playerDisplay(ROLL, PMAP(), b.render, sceneOf());
  assert.equal(d.sceneCut, 'rings'); assert.deepEqual(b.calls.map((o) => [o.view, !!o.people]), [['iso', true], ['iso', true], ['iso', true], ['iso', false], ['rings', false]], 'full, half crowd, no crowd, no people, rings');
  b = spy((o) => (o.view !== 'rings' ? BIG : 100)); d = P.playerDisplay(ROLL, PMAP(), b.render, NOTK());
  assert.equal(d.sceneCut, 'rings'); assert.deepEqual(b.calls.map((o) => o.view), ['iso', 'rings']);
  b = spy(() => BIG); assert.throws(() => P.playerDisplay(ROLL, PMAP({ view: 'rings' }), b.render, NOTK()), (e) => e.big === true && e.steps.length === 1);
}));
test('on: the steps fire in order, each drawn once and with the SAME markers (one set across every step)', () => withFit(true, () => withShade(true, () => {
  const markers = { tokens: [tok('Showroom')], hide: [], sig: 'x', scene: SC(ONLY('people')) }, b = spy(() => BIG);
  let err; try { P.playerDisplay(ROLL, PMAP(), b.render, cl(markers)); } catch (e) { err = e; }
  assert.ok(err && err.big, 'too large everywhere');
  assert.deepEqual(err.steps.map((s) => s.rung), ['full', 'shade', 'halfcrowd', 'crowd', 'scene', 'rings']);
  assert.ok(b.calls.every((o) => JSON.stringify(o.tokens) === JSON.stringify(b.calls[0].tokens) && o.tokens.length === 1));
  assert.deepEqual(b.calls.map((o) => [o.view, !!o.shade, o.crowd ? o.crowd.density || 1 : 0, !!o.people]), [['iso', true, 1, true], ['iso', false, 1, true], ['iso', true, 0.5, true], ['iso', true, 0, true], ['iso', true, 0, false], ['rings', true, 0, false]], 'flat furniture was not smaller, so the depth stays to the end');
  /* when the flat copy IS smaller, the map without its people and the rings go flat too */
  const f = spy((o) => (o.shade ? BIG : o.people ? BIG - 1024 : BIG - 2048)), d = (() => { try { return P.playerDisplay(ROLL, PMAP(), f.render, cl(markers)); } catch (e) { return e; } })();
  assert.ok(d.big); assert.deepEqual(f.calls.slice(-2).map((o) => [o.view, !!o.shade]), [['iso', false], ['rings', false]]);
})));

/* ---------- 4. the refusal, on the page ---------- */
test('on: nothing fits: refused on the page with the smallest size tried and every step, never sent (with a scene, and with none)', () => withFit(true, () => {
  for (const tk of [sceneOf(), NOTK()]) {
    const b = spy((o) => (o.view === 'rings' ? 640 * 1024 : o.people ? 700 * 1024 : o.crowd ? 650 * 1024 : 680 * 1024));
    assert.throws(() => P.playerDisplay(ROLL, PMAP(), b.render, tk), (e) => {
      assert.equal(e.big, true); assert.equal(e.fit, true); assert.ok(!e.leak);
      assert.match(e.message, /^This map is too large for the iPad \(smallest tried 6[3-8]\d KiB, at most 600\)\. Tried, in KiB: whole \d+, /);
      assert.ok(e.steps.every((s) => typeof s.bytes === 'number' && s.leaked === false), JSON.stringify(e.steps));
      assert.equal(e.min, Math.min(...e.steps.map((s) => s.bytes))); assert.match(e.message, new RegExp('smallest tried ' + Math.round(e.min / 1024) + ' KiB'));
      assert.match(e.message, /rings \d+\. Show fewer bands or another view\.$/);
      return true;
    });
  }
  const off = withFit(false, () => P.playerDisplay(ROLL, PMAP(), spy(() => BIG).render, NOTK()));
  assert.ok(Buffer.byteLength(off.svg) > CAP, 'off: no scene, too large: the plain map is sent as it always was (the server answers)');
}));
test('on: a step that names a hidden room has leaked: its size and its name are in the refusal, and it is never the one sent', () => withFit(true, () => {
  const say = (o) => (o.people && !o.crowd ? ' Luxury penthouse' : '');
  const b = spy((o) => (o.people && !o.crowd ? 650 * 1024 : BIG), say);
  assert.throws(() => P.playerDisplay(ROLL, PMAP(), b.render, sceneOf()), (e) => {
    const crowd = e.steps.find((s) => s.rung === 'crowd');
    assert.equal(crowd.leaked, true); assert.ok(crowd.bytes > 650 * 1024, 'the size it drew at is kept: ' + crowd.bytes); assert.deepEqual(e.leakedRungs, ['crowd']);
    assert.match(e.message, /no crowd 6\d\d \(named a hidden room\)/); assert.equal(e.big, true);
    return true;
  });
  const c = spy((o) => (o.people && o.crowd ? BIG : 100), say), d = P.playerDisplay(ROLL, PMAP(), c.render, sceneOf());      /* a clean step after the leaked one is still found */
  assert.equal(d.sceneCut, 'scene'); assert.ok(!/Luxury penthouse/.test(d.svg), 'what is sent holds no hidden name');
}));
test('on: a hidden name in the FIRST render is still the page\'s own leak refusal, and a hidden name in an id or a comment leaks a step too', () => withFit(true, () => {
  const render = (roll, o) => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><g id="luxury-penthouse"/>' + (o.crowd ? '<!--' + 'x'.repeat(BIG) + '-->' : '') + '</svg>', warnings: [] });
  assert.throws(() => P.playerDisplay(ROLL, PMAP(), render, sceneOf()), (e) => e.leak === true && e.message === P.LEAK_MSG);
  const hidden = '<svg xmlns="http://www.w3.org/2000/svg"><text>Luxury penthouse</text></svg>';
  assert.throws(() => P.playerDisplay(ROLL, PMAP(), () => ({ svg: hidden }), NOTK()), (e) => e.leak === true);
}));

/* ---------- 5. slim runs before the scan ---------- */
test('on: the svg that is scanned is the svg that is sent: slimmed straight after the kit, in the first render and in every step; wrapping twice wraps the kit once', () => withFit(true, () => {
  const d = P.playerDisplay(ROLL, PMAP(), spy().render, sceneOf());
  assert.equal(d.svg, SLIM.slim(spy().render(ROLL, {}).svg)); assert.ok(d.svg.length < spy().render(ROLL, {}).svg.length);
  const w = FIT.wrap(spy().render, { bytes: (s) => s.length, slim: SLIM.slim }), w2 = FIT.wrap(w, { bytes: (s) => s.length, slim: SLIM.slim });
  assert.equal(w2.fitInner, w.fitInner); w2(ROLL, {}); assert.equal(w2.fitSeen.length, 1);
  const cut = spy((o) => (o.crowd ? BIG : 100)), d2 = P.playerDisplay(ROLL, PMAP(), cut.render, sceneOf());
  assert.equal(d2.sceneCut, 'crowd'); assert.ok(!/>\s+</.test(d2.svg.replace(/<text>[\s\S]*?<\/text>/g, '')), 'a step\'s svg is slimmed too');
  const bad = FIT.wrap(() => ({ svg: '<svg/>' }), { slim: () => { throw new Error('x'); } }); assert.equal(bad(ROLL, {}).svg, '<svg/>', 'a slim that throws sends the kit\'s own svg');
}));

/* ---------- 6. leaks, hiddenNames, tokenScreen: unchanged ---------- */
const bodyOf = (src, name) => { const i = src.indexOf('  function ' + name + '('); assert.ok(i >= 0, name + ' is there'); const j = src.indexOf('\n  }\n', i); return src.slice(i, j + 5); };
const SCAN = ['leaks', 'hiddenNames', 'tokenScreen', 'svgHays', 'svgText', 'fold', 'wholeWord', 'decodeEntities'];
const sha = (s) => crypto.createHash('sha256').update(s.replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
const PINNED = { leaks: 'ac92e89b739a53e2', hiddenNames: '88f9c507dfae3674', tokenScreen: 'fd4ce9906ff04f67', svgHays: 'e07544c46b874963', svgText: 'daf0ad0ac0c5880d', fold: '60db85652ea5cd78', wholeWord: '3f9ed8d124310f18', decodeEntities: 'f476c96101e66769' };
test('leaks(), hiddenNames() and tokenScreen(), and the helpers they read, are the text of ' + TODAY + ', and the text pinned here', () => {
  const now = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  for (const n of SCAN) {
    const cur = bodyOf(now, n);
    if (OLD) assert.equal(bodyOf(OLD.src.replace(/\r\n/g, '\n'), n), cur.replace(/\r\n/g, '\n'), n + ' differs from ' + TODAY);
    if (process.env.RK28_PRINT_HASHES) console.log('  ' + n + ': ' + sha(cur));
    else assert.equal(sha(cur), PINNED[n], n + ' changed: its source no longer hashes to the pinned value');
  }
  assert.equal(typeof P.leaks, 'function'); assert.equal(typeof P.hiddenNames, 'function'); assert.equal(typeof P.tokenScreen, 'function');
});
test('clean() (the one door every step goes through) is the text of ' + TODAY + ', and scene-state.js has no change', () => {
  const now = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8'), clean = (s) => { const i = s.indexOf('    function clean(opts) {'); return s.slice(i, s.indexOf('\n    }\n', i) + 7); };
  assert.match(clean(now), /leaks\(r\.svg, roll, reveal\)/);
  if (OLD) assert.equal(clean(now).replace(/\r\n/g, '\n'), clean(OLD.src).replace(/\r\n/g, '\n'));
  const sg = spawnSync('git', ['diff', '--stat', TODAY, '--', 'app/gm/scene-state.js'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(sg.stdout.trim(), '');
});

/* ---------- 7. the real kits, an invented palazzo ---------- */
test('real kits, invented palazzo (12 rooms, kit: 1): a crowded three-PC room cut and the whole map reach the iPad under 600 KiB at a full scene (people, crowd, lights, depth)', () => {
  if (!REAL) { console.log('  (skipped: the vendored kits are not here)'); return; }
  assert.equal(REAL.roll.rooms.length, 12);
  withFit(true, () => withShade(true, () => withKit1(() => {
    for (const [label, c] of [['room cut', realCase()], ['whole map, all bands', realCase({ scene: { view: '', room: '' }, map: { reveal: { public: true, working: true, controlled: true, secure: true } } })]]) {
      const seen = [], render = (roll, o) => { seen.push(o); return REAL.K.render(roll, o); };
      const d = P.playerDisplay(REAL.roll, c.map, render, cl2(c.tk));
      assert.ok(Buffer.byteLength(d.svg) <= CAP, label + ': ' + kib(d.svg) + ' KiB'); assert.ok(!('sceneCut' in d), label + ': nothing cut (' + d.sceneCut + ')');
      const o = seen[0];
      assert.equal(o.shade, true, 'depth'); assert.equal(o.people.length, 3, 'three people'); assert.ok(o.crowd, 'the crowd'); assert.equal(o.lights['Cocktail lounge'], 'bright', 'the lights');
      assert.equal(o.view, label === 'room cut' ? 'room' : 'iso');
      console.log('  ' + label + ': ' + kib(d.svg) + ' KiB at the full scene (people ' + o.people.length + ', crowd, lights, depth)');
    }
  })));
});
test('real kits: with the cap set at each rung\'s own measured size, every rung fires on the palazzo\'s room cut, in order, and what is sent fits', () => {
  if (!REAL) return;
  withFit(true, () => withShade(true, () => withKit1(() => {
    const c = realCase(), render = (roll, o) => REAL.K.render(roll, o);
    let steps; withCap(1, () => { try { P.playerDisplay(REAL.roll, c.map, render, cl2(c.tk)); } catch (e) { steps = e.steps; } });
    assert.deepEqual(steps.map((s) => s.rung), ['full', 'shade', 'halfcrowd', 'crowd', 'figures', 'scene', 'rings']);
    assert.ok(steps.every((s) => s.leaked === false && s.bytes > 0));
    const sz = Object.fromEntries(steps.map((s) => [s.rung, s.bytes]));
    console.log('  room cut sizes (KiB): ' + steps.map((s) => s.rung + ' ' + Math.round(s.bytes / 1024)).join(', '));
    assert.ok(sz.halfcrowd < sz.full && sz.crowd < sz.halfcrowd && sz.figures < sz.crowd / 2 && sz.scene < sz.figures && sz.rings < sz.scene, 'each rung is smaller than the last');
    const fired = [];
    for (const want of ['halfcrowd', 'crowd', 'figures', 'scene', 'rings']) {
      const d = withCap(sz[want], () => P.playerDisplay(REAL.roll, c.map, render, cl2(c.tk)));
      assert.equal(d.sceneCut, want); assert.ok(Buffer.byteLength(d.svg) <= sz[want]); fired.push(d.sceneCut);
    }
    assert.deepEqual(fired, ['halfcrowd', 'crowd', 'figures', 'scene', 'rings']);
    /* the figure rung draws one full figure; the page's own rule (MK2) then names the others with the full markers */
    const d1 = withCap(sz.figures, () => P.playerDisplay(REAL.roll, c.map, render, cl2(Object.assign({}, c.tk, { tokens: [tok('Cocktail lounge')], sig: 'x', bare: { tokens: [], hide: [] } }))));
    assert.equal(d1.sceneCut, 'figures'); assert.equal(d1.tokens, 1, 'the people the figure left out are named by their markers');
    assert.throws(() => withCap(sz.rings - 1, () => P.playerDisplay(REAL.roll, c.map, render, cl2(c.tk))), (e) => e.big === true && e.min === sz.rings && /smallest tried/.test(e.message), 'a cap below the smallest: refused on the page');
  })));
});
test('real kits, the whole map (iso, all bands, the crowd): half the crowd and no crowd fire in order at their own sizes', () => {
  if (!REAL) return;
  withFit(true, () => withShade(true, () => withKit1(() => {
    const c = realCase({ scene: { view: '', room: '' }, map: { reveal: { public: true, working: true, controlled: true, secure: true } } }), render = (roll, o) => REAL.K.render(roll, o);
    let steps; withCap(1, () => { try { P.playerDisplay(REAL.roll, c.map, render, cl2(c.tk)); } catch (e) { steps = e.steps; } });
    const sz = Object.fromEntries(steps.map((s) => [s.rung, s.bytes]));
    console.log('  whole map sizes (KiB): ' + steps.map((s) => s.rung + ' ' + Math.round(s.bytes / 1024)).join(', '));
    assert.ok(sz.halfcrowd < sz.full && sz.crowd < sz.halfcrowd && sz.scene < sz.crowd, 'the crowd and then the people are the weight; rings is a last resort, not always smaller');
    for (const want of ['halfcrowd', 'crowd']) { const d = withCap(sz[want], () => P.playerDisplay(REAL.roll, c.map, render, cl2(c.tk))); assert.equal(d.sceneCut, want); assert.ok(Buffer.byteLength(d.svg) <= sz[want]); }
  })));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
