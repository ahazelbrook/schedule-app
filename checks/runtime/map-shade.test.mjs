// IP7: furniture depth on the map (setting map.shade, the map kit's render option `shade: true`). No browser, no network.
//   - The setting: a GM setting in the Maps stage, off; its Settings row is the LAST, so no row of today (b7c66cd0) changes place.
//   - Off means today: no options object the GM page hands the map kit carries `shade`, and each is b7c66cd0's own, byte for byte (mapOpts,
//     playerDisplay with and without a scene, the score scene, the planning board's pinned sheet).
//   - On: `shade: true` reaches EVERY call: the GM's own map, the shared screen (keyed and stage layouts), a room cut to, the planning board,
//     the exploded site and the pinned sheet. From one place (P.shadeOpt).
//   - The caps: a shaded map over the iPad's 600 KiB goes flat first, then the crowd, then the scene; the score scene and the pinned board too.
//   - Rollback: 5686f10's registry and Settings read a stored map.shade safely (ignored, never published, never a row).
// INVENTED data only: the Pelican Rooms and its play fixture, the Dovetail Crew.
//   node checks/runtime/map-shade.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const G = require(path.join(ROOT, 'app', 'gm', 'scene-state.js'));
const F = require(path.join(ROOT, 'app', 'features.js'));
const SET = require(path.join(ROOT, 'app', 'gm', 'settings.js'));
const PB = require(path.join(ROOT, 'app', 'gm', 'players-board.js'));
const P = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
P.sceneMod = G;
const TODAY = 'b7c66cd0', ROLLBACK = '5686f10';

let failed = 0, passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const cl = (v) => JSON.parse(JSON.stringify(v));
const shadeOn = P.shadeOn;
function withShade(on, fn) { P.shadeOn = () => on; try { return fn(); } finally { P.shadeOn = shadeOn; } }

/* a module as it was at a commit, loaded from a temp copy (null when git cannot show it) */
function atCommit(rev, rel) {
  const r = spawnSync('git', ['show', rev + ':' + rel], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-ip7-')), f = path.join(dir, path.basename(rel));
  fs.writeFileSync(f, r.stdout);
  try { return require(f); } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* harmless */ } }
}

/* ---------- the fixture ---------- */
const ROOMS = [
  { name: 'Showroom', band: 'public' }, { name: 'Cocktail lounge', band: 'public' }, { name: 'Security control room', band: 'working' },
  { name: 'Private card rooms', band: 'controlled' }, { name: 'Underground counting room', band: 'working' }, { name: 'Luxury penthouse', band: 'secure', isTarget: true }];
const ROLL = { name: 'The Pelican Rooms', district: 'Nowhere Ward', target: 'Gambling den', targetRoom: 'Luxury penthouse', targetBand: 'secure', rooms: ROOMS, vectors: [], skips: [] };
const PCS = [{ id: 'pc1', name: 'Nell Arbuthnot', spec: null }, { id: 'pc3', name: 'Tam Petrakis', spec: null }];
const CREW = { pc1: { room: 'Showroom' }, pc3: { room: 'Cocktail lounge' } };
const ALL_ON = G.flags(() => true), ONLY = (k) => G.flags((id) => id === G.IDS[k]);
const SC = (f, extra) => Object.assign({ flags: f, pcs: cl(PCS), crew: cl(CREW), disguises: [], crowd: true, lights: {}, screen: 'tv', stage: true, view: '', room: '', kit: null }, extra || {});
const PMAP = (extra) => Object.assign({ layer: 'player', view: 'iso', theme: 'rulebook', reveal: { public: true }, open: [], know: [] }, extra || {});
/* a capturing stand-in kit; `size(o)` sets the drawing's bytes (default small) */
function spy(size) {
  const calls = [];
  const render = (roll, o) => { calls.push(o); const n = size ? size(o) : 0; return { svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>Showroom</text>' + (n ? '<!--' + 'x'.repeat(n) + '-->' : '') + '</svg>', warnings: [] }; };
  return { render, calls };
}
const tok = (room) => ({ room, label: 'Nell Arbuthnot', svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>NA</text></svg>' });
const BIG = 700 * 1024;

/* ---------- 1. the setting ---------- */
test('map.shade: a GM setting in the Maps stage, default off, Saturday "try", labelled Furniture depth; nothing stored reads off; never public', () => {
  const s = F.get('map.shade'); assert.ok(s);
  assert.equal(s.setting, true); assert.equal(s.default, false); assert.equal(s.surface, 'gm'); assert.equal(s.stage, 'map'); assert.equal(s.saturday, 'try'); assert.equal(s.label, 'Furniture depth');
  assert.equal(F.valueOf({}, 'map.shade'), false); assert.equal(F.valueOf({ features: { 'map.shade': true } }, 'map.shade'), true);
  assert.equal(P.shadeOf({}), false); assert.equal(P.shadeOf(null), false);      /* under Node the page has no registry: the read is off, safely */
  assert.match(fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8'), /function shadeOf\(doc\) \{[^\n]*F\.isSetting\(SHADE_SWITCH\) && F\.valueOf\(doc, SHADE_SWITCH\) === true/, 'in the page: the registry\'s own read');
  assert.equal(P.SHADE_SWITCH, 'map.shade');
  assert.deepEqual(F.publicView({}), F.publicView({ 'map.shade': true }), 'a GM setting never reaches a phone or the iPad');
  assert.ok(!('map.shade' in F.publishMap({ features: { 'map.shade': true } }, {})), 'never copied to the campaign document');
  assert.deepEqual(G.IDS, { fill: 'map.fill', people: 'map.people', lights: 'map.lights', room: 'map.room' }, 'not one of the scene flags: the map-scene bundle is not fetched for it');
});
test('the Settings row is the last (Flat / Solid): every row of ' + TODAY + ' keeps its index', () => {
  const keys = SET.ROWS.map((r) => r.key), last = SET.ROWS[SET.ROWS.length - 1];
  assert.equal(last.key, 'map.shade'); assert.equal(last.label, 'Furniture depth');
  let state = {}; const ctl = SET.create({ F, doc: () => state, patch: (p) => { state = { features: Object.assign({}, state.features, p.features) }; return true; }, campaign: () => ({ features: {} }), publish: () => Promise.resolve(true), toast() {}, redraw() {} });
  const row = ctl.rows().pop(); assert.equal(row.key, 'map.shade'); assert.equal(row.value, false); assert.deepEqual(row.options.map((o) => [o.v, o.label]), [[false, 'Flat'], [true, 'Solid']]);
  assert.equal(ctl.choose('map.shade', true), true); assert.equal(state.features['map.shade'], true, 'Solid writes the GM state');
  const old = atCommit(TODAY, 'app/gm/settings.js');
  if (!old) { console.log('  (skipped the comparison: git cannot show ' + TODAY + ')'); return; }
  assert.deepEqual(keys.slice(0, -1), old.ROWS.map((r) => r.key), 'the rows of today, in their places');
  assert.deepEqual(SET.ROWS.slice(0, -1), old.ROWS, 'and each row as it was');
  const oldF = atCommit(TODAY, 'app/features.js');
  assert.deepEqual(F.list().map((x) => x.id).slice(0, -1), oldF.list().map((x) => x.id), 'the registry: map.shade appended, nothing else moved');
});
test('the kit-off exemption names the new row', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'kit-fingerprint.mjs'), 'utf8');
  assert.match(src, /name: 'the Furniture depth Settings row'[^\n]*\n\s*selector: '#gm-ipad-settings \[data-set-row="map\.shade"\]'/);
});

/* ---------- 2. off means today ---------- */
const OLD = atCommit(TODAY, 'app/gm-page.js');
const OLDP = OLD && OLD._pure; if (OLDP) OLDP.sceneMod = G;
const OLDB = atCommit(TODAY, 'app/gm/players-board.js');
const MAPS = [];
for (const view of ['iso', 'plan', 'rings', 'room']) for (const reveal of [{ public: true }, { public: true, working: true }])
  for (const extra of [{}, { open: ['Private card rooms'] }, { time: 'Night', weather: 'fog' }]) MAPS.push(PMAP(Object.assign({ view, reveal }, extra)));
const TKS = [null, { tokens: [], hide: [], sig: '' }, { tokens: [tok('Showroom')], hide: [], sig: 'x' },
  { tokens: [], hide: [], sig: '', scene: SC(ALL_ON) }, { tokens: [], hide: [], sig: '', scene: SC(ALL_ON, { view: 'room', room: 'Showroom' }) },
  { tokens: [], hide: [], sig: '', scene: SC(ONLY('fill')) }];
test('off: P.shadeOn() is false with nothing stored, P.shadeOpt() is {}', () => {
  assert.equal(P.shadeOn(), false); assert.deepEqual(P.shadeOpt(), {});
});
test('off: every options object of the player path and mapOpts is ' + TODAY + '\'s, byte for byte, and none has a shade key', () => {
  if (!OLDP) { console.log('  (skipped: git cannot show ' + TODAY + ')'); return; }
  let n = 0;
  for (const map of MAPS) for (const tk of TKS) {
    const a = spy(), b = spy(); let ea = null, eb = null, ra, rb;
    try { ra = OLDP.playerDisplay(ROLL, map, a.render, tk && cl(tk)); } catch (e) { ea = e.message; }
    try { rb = P.playerDisplay(ROLL, map, b.render, tk && cl(tk)); } catch (e) { eb = e.message; }
    assert.equal(eb, ea); assert.equal(JSON.stringify(b.calls), JSON.stringify(a.calls), 'the same options: ' + JSON.stringify(map));
    if (!ea) assert.deepEqual(rb, ra);
    b.calls.forEach((o) => assert.ok(!('shade' in o)));
    for (const layer of ['gm', 'player']) { const o = P.mapOpts(map, layer, P.revealEntries(map), P.IPAD_MAP); assert.ok(!('shade' in o)); assert.equal(JSON.stringify(o), JSON.stringify(OLDP.mapOpts(map, layer, OLDP.revealEntries(map), OLDP.IPAD_MAP))); }
    n += b.calls.length;
  }
  assert.ok(n >= MAPS.length * TKS.length, n + ' calls');
});
test('off: the size ladder is MK2\'s (a scene over the cap loses the crowd, then the scene; no scene, no size check)', () => {
  if (!OLDP) return;
  const sz = (o) => (o.crowd ? BIG : 0);
  for (const tk of [{ tokens: [], hide: [], sig: '', scene: SC(ONLY('people')) }, { tokens: [], hide: [], sig: '' }]) {
    const a = spy(sz), b = spy(sz);
    const ra = OLDP.playerDisplay(ROLL, PMAP(), a.render, cl(tk)), rb = P.playerDisplay(ROLL, PMAP(), b.render, cl(tk));
    assert.equal(JSON.stringify(b.calls), JSON.stringify(a.calls)); assert.deepEqual(rb, ra);
  }
  const all = (o) => BIG, a = spy(all), b = spy(all);
  assert.deepEqual(P.playerDisplay(ROLL, PMAP(), b.render, { tokens: [], hide: [], sig: '' }), OLDP.playerDisplay(ROLL, PMAP(), a.render, { tokens: [], hide: [], sig: '' }), 'no scene, too large: sent as before (the server answers)');
  assert.equal(JSON.stringify(b.calls), JSON.stringify(a.calls));
});
test('off: the score scene and the planning board\'s pinned sheet ask the kit exactly what ' + TODAY + ' asked', () => {
  if (!OLDP || !OLDB) return;
  for (const map of [PMAP(), PMAP({ reveal: { public: true, working: true } })]) for (const k1 of [false, true]) {
    OLDP.kit1On = P.kit1On = () => k1;
    const a = spy(), b = spy(); assert.deepEqual(P.scoreScene(ROLL, map, b.render), OLDP.scoreScene(ROLL, map, a.render));
    assert.equal(JSON.stringify(b.calls), JSON.stringify(a.calls)); b.calls.forEach((o) => assert.ok(!('shade' in o)));
    const items = [{ full: tok('Showroom') }], o = { seen: ['public'], view: 'plan', kit1: k1, leaks: () => [] };
    const c = spy(), d = spy(); assert.deepEqual(PB.fitBoard(ROLL, d.render, Object.assign({}, o, P.shadeOpt()), items), OLDB.fitBoard(ROLL, c.render, o, items));
    assert.equal(JSON.stringify(d.calls), JSON.stringify(c.calls));
  }
  P.kit1On = OLDP.kit1On = () => false;
});

/* ---------- 3. on: shade reaches every call ---------- */
test('on: mapOpts carries shade: true on both layers, beside kit1 and the rest (the GM\'s own map, the Run view\'s, the shared screen)', () => withShade(true, () => {
  for (const map of MAPS) for (const layer of ['gm', 'player']) {
    const o = P.mapOpts(map, layer, P.revealEntries(map), P.IPAD_MAP);
    assert.equal(o.shade, true);
    if (OLDP) assert.deepEqual(P.flat(o), cl(OLDP.mapOpts(map, layer, OLDP.revealEntries(map), OLDP.IPAD_MAP)), 'nothing else changed');
  }
}));
test('on: every call of the shared-screen path carries shade (keyed, stage layout, people, a room cut to, with markers)', () => withShade(true, () => {
  const seen = { keyed: 0, stage: 0, room: 0 };
  for (const map of MAPS) for (const tk of TKS) {
    const b = spy(); try { P.playerDisplay(ROLL, map, b.render, tk && cl(tk)); } catch (e) { continue; }
    assert.ok(b.calls.length > 0);
    b.calls.forEach((o) => { assert.equal(o.shade, true, JSON.stringify(o).slice(0, 200)); if (o.view === 'room') seen.room++; else if (o.layout === 'stage') seen.stage++; else seen.keyed++; });
  }
  assert.ok(seen.keyed > 0 && seen.stage > 0 && seen.room > 0, JSON.stringify(seen));
}));
test('on: the score scene (the planning board and the exploded site, with their rings fallbacks) and the pinned sheet carry shade', () => withShade(true, () => {
  for (const k1 of [false, true]) {
    P.kit1On = () => k1;
    const b = spy(); P.scoreScene(ROLL, PMAP(), b.render);
    assert.deepEqual(b.calls.map((o) => [o.view, o.theme, o.shade, !!o.kit1]), [['plan', 'board', true, k1], ['iso', 'blueprint', true, k1]]);
    const leaky = spy(); const lr = (roll, o) => { leaky.calls.push(o); return { svg: o.view === 'rings' ? '<svg/>' : '<svg><text>Luxury penthouse</text></svg>' }; };
    P.scoreScene(ROLL, PMAP(), lr);
    assert.deepEqual(leaky.calls.map((o) => [o.view, o.shade]), [['plan', true], ['rings', true], ['iso', true], ['rings', true]]);
    const d = spy(); PB.fitBoard(ROLL, d.render, Object.assign({ seen: ['public'], view: 'plan', kit1: k1, leaks: () => [] }, P.shadeOpt()), [{ full: tok('Showroom') }]);
    assert.equal(d.calls.length, 1); assert.equal(d.calls[0].shade, true); assert.equal(!!d.calls[0].kit1, k1);
  }
  P.kit1On = () => false;
}));
test('one place: the GM page\'s map calls take shade only through P.shadeOpt (mapOpts, scoreScene, the pinned sheet)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.equal((code.match(/P\.shadeOpt\(\)/g) || []).length, 3, 'three uses: mapOpts, scoreScene, pbSetScore');
  assert.equal((code.match(/shade: true/g) || []).length, 1, 'one literal: P.shadeOpt itself');
  const body = (name) => { const i = src.indexOf('function ' + name + '('); return i < 0 ? '' : src.slice(i, src.indexOf('\n  }\n', i)); };
  assert.match(body('mapOpts'), /Object\.assign\(o, P\.shadeOpt\(\)\)/);
  assert.match(body('pbSetScore'), /fitBoard\([^\n]*P\.shadeOpt\(\)/);
  assert.match(body('runApply'), /o\.shade \? \['shade'\]/, 'the Run view\'s map cache key follows the setting');
  assert.match(src, /redraw: function \(\) \{[^\n]*shadeRedraw\(\);/, 'a flip redraws this screen\'s maps and re-sends the live one');
});

/* ---------- 4. the caps: drop the shade first ---------- */
test('cap, shared screen, no scene: a shaded map over 600 KiB goes flat, and says so (sceneCut "shade", the toast\'s words)', () => withShade(true, () => {
  const b = spy((o) => (o.shade ? BIG : 0));
  const d = P.playerDisplay(ROLL, PMAP(), b.render, { tokens: [tok('Showroom')], hide: [], sig: 'x' });
  assert.equal(d.sceneCut, 'shade'); assert.ok(d.svg.length < P.SVG_CAP);
  assert.equal(b.calls[b.calls.length - 1].shade, undefined); assert.equal(b.calls[b.calls.length - 1].tokens.length, 1, 'the markers stay');
  assert.match(P.SCENE_CUT_MSG.shade, /^The map went to the iPad with flat furniture: with depth, it was over the iPad’s 600 KiB\.$/);
  const big = spy(() => BIG), d2 = P.playerDisplay(ROLL, PMAP(), big.render, { tokens: [], hide: [], sig: '' });
  assert.ok(!('sceneCut' in d2), 'too large even flat, no scene: the flat map goes as it always did (the server answers)');
  assert.equal(big.calls[big.calls.length - 1].shade, undefined);
}));
test('cap, shared screen with a scene: shade first, then the crowd, then the scene', () => withShade(true, () => {
  const tk = () => ({ tokens: [], hide: [], sig: '', scene: SC(ONLY('people')) });
  let b = spy((o) => (o.shade ? BIG : 0)), d = P.playerDisplay(ROLL, PMAP(), b.render, tk());
  assert.equal(d.sceneCut, 'shade'); assert.ok(Array.isArray(b.calls[b.calls.length - 1].people), 'the people stay');
  b = spy((o) => (o.crowd ? BIG : 0)); d = P.playerDisplay(ROLL, PMAP(), b.render, tk());
  assert.equal(d.sceneCut, 'crowd'); const last = b.calls[b.calls.length - 1]; assert.equal(last.shade, undefined); assert.equal(last.crowd, undefined);
  b = spy((o) => (o.people ? BIG : 0)); d = P.playerDisplay(ROLL, PMAP(), b.render, tk());
  assert.equal(d.sceneCut, 'scene'); assert.equal(b.calls[b.calls.length - 1].people, undefined);
  b = spy(() => BIG); assert.throws(() => P.playerDisplay(ROLL, PMAP(), b.render, tk()), /too large for the iPad/);
}));
test('cap, the score scene: a board or exploded site over 600 KiB with depth is drawn again flat, and shadeCut says so; under the cap, no key', () => withShade(true, () => {
  const b = spy((o) => (o.shade && o.view === 'iso' ? BIG : 0)), r = P.scoreScene(ROLL, PMAP(), b.render);
  assert.equal(r.shadeCut, true); assert.ok(r.iso.length < P.SVG_CAP); assert.ok(r.score.iso.length < P.SVG_CAP);
  assert.deepEqual(b.calls.map((o) => [o.view, o.shade]), [['plan', true], ['iso', true], ['iso', undefined]]);
  assert.ok(!('shadeCut' in P.scoreScene(ROLL, PMAP(), spy().render)));
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  assert.match(src, /if \(r && !pb && built\.shadeCut\) toast\(P\.SCENE_CUT_MSG\.shade/, 'said on this screen for Set as score scene, never on the planning board\'s path');
  assert.match(src, /flatBoard = !!\(fit\.svg && fit\.flat\) \|\| built\.shadeCut === true;/, 'the planning board\'s path hands it to the board, which says it once per change');
}));
test('cap, a flat copy that names a hidden room: the leak refusal, not "too large"', () => withShade(true, () => {
  const render = (roll, o) => ({ svg: o.shade ? '<svg><text>Showroom</text><!--' + 'x'.repeat(BIG) + '--></svg>' : '<svg><text>Luxury penthouse</text></svg>', warnings: [] });
  assert.throws(() => P.playerDisplay(ROLL, PMAP(), render, { tokens: [], hide: [], sig: '' }), (e) => e.leak === true && e.message === P.LEAK_MSG);
}));
test('cap, the pinned sheet: flat before any face is lightened or plated', () => withShade(true, () => {
  const items = [{ full: tok('Showroom'), lite: tok('Showroom'), alt: tok('Showroom') }];
  let d = spy((o) => (o.shade ? BIG : 0)), r = PB.fitBoard(ROLL, d.render, Object.assign({ seen: ['public'], view: 'plan', leaks: () => [] }, P.shadeOpt()), items);
  assert.ok(r.svg); assert.equal(r.flat, true); assert.equal(r.lighter, 0); assert.equal(r.plates, 0);
  assert.deepEqual(d.calls.map((o) => o.shade), [true, undefined]);
  d = spy(); r = PB.fitBoard(ROLL, d.render, { seen: ['public'], view: 'plan', leaks: () => [] }, items);
  assert.ok(!('flat' in r), 'off: no key');
}));

/* ---------- 4b. the planning board: a flip re-sends the stored board once; the flat toast once per change ---------- */
async function atest(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const tick = () => new Promise((r) => setTimeout(r, 0));
function boardHost(o) {
  const doc = { boardPins: { 'Site A': { pins: [{ id: 'p1', room: 'Hall', kind: 'line', text: 'Back by nine' }], at: 1 } } }, roll = { name: 'Site A' };
  return Object.assign({ doc: () => doc, roll: () => roll, site: () => roll.name, rooms: () => [{ name: 'Hall', shown: true }], npcs: () => ({}), scan: () => [], patch: () => true,
    score: () => ({ name: 'Site A' }), busy: () => false, toast: () => {}, figures: () => null, hide: () => [], showBoard: () => Promise.resolve(true), ready: () => true }, o);
}
await atest('a flip with the board up: one write each way (on, then off), none when nothing changed; no score scene stored: no write; not read yet: no write', async () => {
  PB.reset();
  let look = '', writes = [];
  const host = boardHost({ look: () => look, setScore: () => { writes.push(look); return Promise.resolve({ ok: true, refused: [] }); } });
  PB.follow(host); await tick(); assert.equal(writes.length, 0, 'the first look takes its bearings');
  PB.follow(host); await tick(); assert.equal(writes.length, 0, 'nothing changed: nothing written');
  look = 'shade'; PB.follow(host); await tick(); assert.deepEqual(writes, ['shade'], 'on: one write, shaded');
  PB.follow(host); PB.follow(host); await tick(); assert.equal(writes.length, 1, 'never a loop');
  look = ''; PB.follow(host); await tick(); assert.deepEqual(writes, ['shade', ''], 'off: one write, flat');
  PB.reset(); writes = []; look = '';
  const none = boardHost({ look: () => look, score: () => null, setScore: () => { writes.push(look); return Promise.resolve({ ok: true, refused: [] }); } });
  PB.follow(none); await tick(); look = 'shade'; PB.follow(none); await tick(); assert.equal(writes.length, 0, 'no score scene of this site stored: no write');
  PB.reset(); writes = []; look = ''; let ready = false;
  const cold = boardHost({ look: () => look, ready: () => ready, setScore: () => { writes.push(look); return Promise.resolve({ ok: true, refused: [] }); } });
  look = 'shade'; PB.follow(cold); await tick(); assert.equal(writes.length, 0, 'the stored score not read yet: nothing written');
  ready = true; PB.follow(cold); await tick(); assert.equal(writes.length, 0, 'once read, the first look is the starting point (it is already shaded or not): no write');
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8'), i = src.indexOf('function shadeRedraw(');
  assert.match(src.slice(i, src.indexOf('\n  }\n', i)), /if \(pbOn\(\)\) W\.B68GmPlayersBoard\.follow\(pbHost\(\)\);/, 'the flip goes through the board\'s own follow');
  assert.match(src, /look: function \(\) \{ return P\.shadeOn\(\) \? 'shade' : ''; \}/);
  const h0 = boardHost({}), h1 = boardHost({ look: () => '' });
  assert.equal(PB._state(h1).sig, PB._state(h0).sig, 'off: the board\'s signature is what it was');
  PB.reset();
});
await atest('the board\'s flat toast: once per change, never once per sync', async () => {
  PB.reset();
  const toasts = [], res = [{ ok: true, refused: [], flat: true }, { ok: true, refused: [], flat: true }, { ok: true, refused: [] }, { ok: true, refused: [], flat: true }];
  let n = 0;
  const host = boardHost({ toast: (m) => toasts.push(m), setScore: () => Promise.resolve(res[n++]) });
  for (let i = 0; i < res.length; i++) { await PB.sync(host, false); }
  assert.equal(toasts.filter((m) => /flat furniture/.test(m)).length, 2, 'flat, flat (said once), not flat, flat again (said again)');
  PB.reset();
});

/* ---------- 5. rollback: the code live before today ---------- */
test('rollback: ' + ROLLBACK + '\'s registry and Settings read a stored map.shade safely (ignored, never published, never a row)', () => {
  const OF = atCommit(ROLLBACK, 'app/features.js'), OS = atCommit(ROLLBACK, 'app/gm/settings.js');
  if (!OF || !OS) { console.log('  (skipped: git cannot show ' + ROLLBACK + ')'); return; }
  const doc = { features: { 'map.shade': true, 'map.fill': false } };
  assert.equal(OF.get('map.shade'), null); assert.equal(OF.isSetting('map.shade'), false);
  assert.equal(OF.valueOf(doc, 'map.fill'), false);
  assert.ok(!('map.shade' in OF.publishMap(doc, {})), 'not copied to the campaign document');
  assert.ok(!('map.shade' in OF.publicView(doc.features)), 'not served to a phone or the iPad');
  assert.doesNotThrow(() => OF.patchAllOff(doc));
  let state = cl(doc);
  const ctl = OS.create({ F: OF, doc: () => state, patch: () => true, campaign: () => ({ features: {} }), publish: () => Promise.resolve(true), toast() {}, redraw() {} });
  assert.ok(!ctl.rows().some((r) => r.key === 'map.shade'), 'no row for it');
  const box = { parentNode: null, innerHTML: '' }; assert.doesNotThrow(() => ctl.render(box)); assert.ok(!box.innerHTML.includes('map.shade'));
  const OP = atCommit(ROLLBACK, 'app/gm-page.js')._pure;
  const o = OP.mapOpts(PMAP(), 'player', OP.revealEntries(PMAP()), OP.IPAD_MAP); assert.ok(!('shade' in o), 'its maps never ask for shade');
  assert.equal(fs.readFileSync(path.join(ROOT, 'functions', '_lib', 'gm.js'), 'utf8').includes('map.shade'), false, 'the server stores no new shape');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
