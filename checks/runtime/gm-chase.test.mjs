// Unit test for the Chase panel's logic (app/gm/chase.js, B68GmChase) and the gate that sends a chase strip to the iPad
// (app/gm-page.js, chaseDisplay), in plain node. The strip is drawn by map kit 0.6 (B68Map.chase); until the vendored kit has it,
// checks/runtime/fixtures/chase-kit-stub.js stands in, written from the kit's spec (it installs only on a kit without `chase`).
// Invented data only.
//   node checks/runtime/gm-chase.test.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const G = require(path.join(ROOT, 'app', 'gm', 'chase.js'));
const P = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
const K = require(path.join(ROOT, 'app', 'maps', 'map-kit.js'));
const realKit = typeof K.chase === 'function';
require(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'chase-kit-stub.js'))(K);
const { checkSvg } = await import(pathToFileURL(path.join(ROOT, 'functions', '_lib', 'gm.js')).href);
const routes = require(path.join(ROOT, 'app', 'routes.js'));

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
console.log('map kit ' + K.VERSION + (realKit ? ' (its own chase strip)' : ' (no chase strip yet: the checks stub stands in)'));

/* invented rolls: a location roll with its secrets, and a street scene */
const LOC = { name: 'Invented Works', district: 'Nowhere Flats', namedStreet: 'Tallow Row', streetType: 'a grimy backstreet', streetDesc: 'Soot over wet brick',
  streetObstacle: 'A burst main', props: ['crates', 'a news stand'], neighbours: ['a pawn shop', 'a laundry', 'a third'], landmark: 'The Old Clock', weather: 'thin rain', timeOfDay: 'Night',
  watcher: 'A lookout named Quill', targetRoom: 'Strongroom', rooms: [{ name: 'Strongroom', band: 'secure' }], physThreatName: 'Two dogs', vectors: [{ text: 'secret way' }] };
const SCENE = { d: { n: 'Nowhere Flats' }, timeOfDay: 'Bluetime haze', weather: 'dry wind', street: 'Pinch Lane', streetType: 'a dark, narrow alley', obstacle: 'A stalled cart', neighbour: 'a tailor', landmark: 'The Pump',
  who: ['Notable Person', 'secret text'], rumour: 'A rumour the players have not heard' };
const FORM = { name: 'The tallow run', clockName: 'Shake them', size: 6, opp: 'hidden', oppName: 'Reinforcements arrive', oppSize: 4, crewToken: 'autopod', themToken: 'watch-car' };
function fresh(form = FORM) { return K.chaseNew(G.startArgs(form, G.source('location', LOC), 1234)); }
function play(c, list) { for (const t of list) c = K.chaseTick(c, G.tickArgs(c, t)); return c; }

await test('source: a location roll gives only the street\'s public fields, never a room, the target, a threat, the watcher or a way in', () => {
  const s = G.source('location', LOC);
  assert.equal(s.from, 'location'); assert.equal(s.district, 'Nowhere Flats'); assert.equal(s.time, 'Night'); assert.equal(s.weather, 'thin rain');
  assert.deepEqual(s.street, { named: 'Tallow Row', type: 'a grimy backstreet', desc: 'Soot over wet brick', props: ['crates', 'a news stand'], nearby: ['a pawn shop', 'a laundry'], obstacle: 'A burst main', landmark: 'The Old Clock' });
  const all = JSON.stringify(s);
  for (const secret of ['Quill', 'Strongroom', 'Two dogs', 'secret way', 'Invented Works']) assert.ok(!all.includes(secret), secret);
});
await test('source: a street scene gives its street (never the notable or the rumour); a street type is a kit ground; an unknown ground is a wide road', () => {
  const s = G.source('scene', SCENE, 'Nowhere Flats');
  assert.equal(s.time, 'Bluetime'); assert.equal(s.district, 'Nowhere Flats');
  assert.deepEqual(s.street, { named: 'Pinch Lane', type: 'a dark, narrow alley', props: [], nearby: ['a tailor'], obstacle: 'A stalled cart', landmark: 'The Pump' });
  assert.ok(!/Notable|rumour/i.test(JSON.stringify(s)));
  assert.deepEqual(G.source('ground', 'bridge', 'Anywhere').street, { named: '', ground: 'bridge', type: '', props: [], nearby: [] });
  assert.equal(G.source('ground', 'motorway').street.ground, 'corridor');
  assert.deepEqual(G.GROUNDS.map((g) => g.value), ['corridor', 'lane', 'deck', 'open', 'hub', 'covered', 'deadend', 'waterside', 'bridge']);
});
await test('startArgs: the crew\'s strip clock (4, 6 or 8), an opposing clock shown or hidden, the cast, the seed', () => {
  const a = G.startArgs(FORM, G.source('location', LOC), 99);
  assert.deepEqual(a.clocks, [{ id: 'crew1', name: 'Shake them', size: 6, side: 'crew', strip: true }, { id: 'opp', name: 'Reinforcements arrive', size: 4, side: 'against', strip: false, filled: 0, hidden: true }]);
  assert.deepEqual(a.cast.map((c) => [c.id, c.token, c.side]), [['crew', 'autopod', 'crew'], ['them', 'watch-car', 'against']]);
  assert.equal(a.seed, 99); assert.equal(a.time, 'Night'); assert.equal(a.name, 'The tallow run'); assert.equal(a.weather, 'thin rain');
  const b = G.startArgs({ size: 5, opp: 'shown', oppSize: 12 }, G.source('ground', 'lane'), 1);
  assert.equal(b.clocks[0].size, 6, 'an odd size falls back to 6'); assert.equal(b.clocks[0].name, 'Get away'); assert.equal(b.clocks[1].size, 6); assert.ok(!('hidden' in b.clocks[1]));
  assert.equal(b.name, 'The chase'); assert.equal(b.cast.length, 1, 'no pursuer picked: the crew alone');
  assert.equal(G.startArgs({ opp: 'none' }, G.source('ground', 'lane'), 1).clocks.length, 1);
});
await test('a tick: +1/+2/+3 on the leg in play, one panel per roll, clamped to what is left; a full clock asks for a leg', () => {
  let c = fresh();
  assert.equal(G.leg(c).id, 'crew1');
  const t = G.tickArgs(c, { ticks: 2, caption: '  The autopod  clips a  cart ', roll: 'Ana · Finesse · risky/standard · 4', between: 'A flashback\n\n to the garage', level: 'below', time: 'Night' });
  assert.deepEqual(t, { clock: 'crew1', ticks: 2, caption: 'The autopod clips a cart', level: 'below', time: 'Night', roll: 'Ana · Finesse · risky/standard · 4', between: ['A flashback', 'to the garage'] });
  assert.deepEqual(G.tickArgs(c, { ticks: 9 }).ticks, 3, '+3 at most'); assert.equal(G.tickArgs(c, {}).level, 'street'); assert.equal(G.tickArgs(c, {}).time, 'Night', 'the chase\'s own time by default');
  c = play(c, [{ ticks: 2, caption: 'One' }, { ticks: 3, caption: 'Two' }]);
  assert.equal(c.panels.length, 2); assert.deepEqual(G.clocks(c)[0], { id: 'crew1', name: 'Shake them', size: 6, side: 'crew', strip: true, hidden: false, filled: 5, full: false });
  const last = G.tickArgs(c, { ticks: 3 });
  assert.equal(last.ticks, 1); assert.equal(last.clamped, 3, 'one left: +3 is cut to +1 and says so');
  c = play(c, [{ ticks: 1, caption: 'Three' }]);
  assert.equal(G.leg(c), null); assert.match(G.tickArgs(c, { ticks: 1 }).error, /Add a leg/);
  const c2 = G.addLeg(c, 'Land the barge', 4);
  assert.deepEqual(G.leg(c2), { id: 'crew2', name: 'Land the barge', size: 4, side: 'crew', strip: true, hidden: false, filled: 0, full: false });
  assert.equal(G.clocks(c).length, 2, 'addLeg does not touch the chase it was given');
  assert.equal(G.addLeg(c2, '', 7).clocks[3].name, 'Leg 3'); assert.equal(G.addLeg(c2, '', 7).clocks[3].size, 6);
});
await test('undo, oppose: new objects; undo takes the last panel, oppose moves the opposing clock within 0..size', () => {
  const c = play(fresh(), [{ ticks: 1, caption: 'One' }, { ticks: 2, caption: 'Two' }]);
  const u = G.undo(c);
  assert.equal(u.panels.length, 1); assert.equal(c.panels.length, 2); assert.equal(G.leg(u).filled, 1);
  assert.equal(G.undo(G.undo(u)).panels.length, 0, 'undo on no panel is no change');
  let o = G.oppose(c, -1); assert.equal(G.opposing(o).filled, 0);
  for (let i = 0; i < 6; i++) o = G.oppose(o, 1);
  assert.equal(G.opposing(o).filled, 4); assert.equal(G.opposing(o).full, true); assert.equal(G.opposing(c).filled, 0);
  const none = fresh({ ...FORM, opp: 'none' });
  assert.equal(G.opposing(none), null); assert.deepEqual(G.oppose(none, 1), none);
});
await test('endPlan: the ended chase goes into past, stamped; past keeps the last 10 and 64 KiB, the oldest go and are named', () => {
  const past = {};
  for (let i = 0; i < 10; i++) past['old' + i] = { id: 'old' + i, name: 'Old ' + i, endedAt: '2026-10-0' + (i % 9 + 1) + 'T1' + i + ':00:00.000Z', panels: [] };
  const c = fresh();
  const r = G.endPlan(past, c, '2026-10-21T12:00:00.000Z');
  assert.equal(r.patch[c.id].endedAt, '2026-10-21T12:00:00.000Z'); assert.equal(r.patch[c.id].name, 'The tallow run');
  assert.deepEqual(r.dropped, ['Old 0']); assert.equal(r.patch.old0, null);
  assert.equal(Object.values(r.patch).filter((v) => v !== null).length, 1, 'only the new one is written');
  const big = {}; for (let i = 0; i < 4; i++) big['b' + i] = { id: 'b' + i, name: 'Big ' + i, endedAt: '2026-10-1' + i + 'T00:00:00.000Z', panels: [{ caption: 'x'.repeat(20000) }] };
  const r2 = G.endPlan(big, c, '2026-10-21T00:00:00.000Z');
  assert.deepEqual(r2.dropped.sort(), ['Big 0'], 'over 64 KiB the oldest goes: ' + r2.dropped);
  assert.deepEqual(G.endPlan(null, c, 'x').dropped, []);
});
await test('title, caption, Find: the panels\' captions; the caption names no hidden clock', () => {
  const c = play(fresh(), [{ ticks: 2, caption: 'Through the market', between: 'A flashback' }, { ticks: 1, caption: '' }, { ticks: 1, caption: 'Over the canal' }]);
  assert.equal(G.title(c), 'The tallow run');
  assert.equal(G.caption(c), 'Nowhere Flats · Shake them 4/6');
  assert.deepEqual(G.findEntries(c).map((e) => [e.kind, e.title, e.sub, e.text]), [['Chase', 'Through the market', 'Panel 1 · Shake them +2', 'A flashback'], ['Chase', 'Over the canal', 'Panel 3 · Shake them +1', '']]);
  assert.deepEqual(G.findEntries(null), []);
});
await test('playerCopy and secrets: no roll line, no GM note, no hidden opposing clock; a hidden strip clock keeps its panels, not its name', () => {
  let c = play(fresh(), [{ ticks: 2, caption: 'They split up', roll: 'Ana · Finesse · risky/standard · 4' }, { ticks: 1, caption: 'Ana rolls a four' }]);
  c.gm = 'The ambush is a bluff'; c.panels[0].gm = 'Watch captain owes the crew';
  c.clocks.push({ id: 'crew9', name: 'Secret leg', size: 4, side: 'crew', strip: true, hidden: true });
  const pc = G.playerCopy(c);
  assert.ok(!('gm' in pc) && pc.panels.every((p) => !('roll' in p) && !('gm' in p)));
  assert.deepEqual(pc.clocks.map((k) => [k.id, k.name]), [['crew1', 'Shake them'], ['crew9', '']]);
  assert.ok(c.panels[0].roll && c.gm, 'the chase itself is untouched');
  assert.deepEqual(G.secrets(c).sort(), ['ana · finesse · risky/standard · 4', 'reinforcements arrive', 'secret leg', 'the ambush is a bluff', 'watch captain owes the crew']);
  c.panels[1].caption = 'Reinforcements arrive at the bridge';
  assert.ok(!G.secrets(c).includes('reinforcements arrive'), 'a hidden name the table has heard in a caption is not a secret');
});
await test('chaseDisplay: the player layer at the iPad\'s size, whatever is asked; it passes the server\'s checkSvg and holds no secret', () => {
  const c = play(fresh(), [{ ticks: 2, caption: 'Through the market', roll: 'Ana · Finesse · risky/standard · 4', between: 'Before: a flashback' }, { ticks: 1, caption: 'Over the rails', level: 'above', time: 'Bluetime' }]);
  let asked = null;
  const d = P.chaseDisplay(c, (ch, o) => { asked = { ch, o }; return K.chase(ch, o); }, G);
  assert.deepEqual(asked.o, { layer: 'player', layout: 'ipad', theme: 'rulebook' }, 'the player layer, the iPad layout, never rolls: true');
  assert.ok(!asked.ch.panels.some((p) => p.roll) && !asked.ch.clocks.some((k) => k.hidden), 'the kit is given the player copy');
  assert.equal(d.kind, 'svg'); assert.equal(d.title, 'The tallow run'); assert.equal(d.caption, 'Nowhere Flats · Shake them 3/6');
  assert.equal(checkSvg(d.svg), d.svg.trimStart(), 'the server takes it');
  const text = P.svgText(d.svg);
  assert.ok(text.includes('through the market') && text.includes('before: a flashback'), 'captions and between lines go (the table heard them)');
  assert.ok(!text.includes('finesse') && !text.includes('reinforcements'), 'no roll line, no hidden clock');
  const gm = P.svgText(K.chase(c, { layer: 'gm', layout: 'ipad', rolls: true }).svg);
  assert.ok(gm.includes('finesse') && gm.includes('reinforcements'), 'the GM copy has both');
});
await test('chaseDisplay refuses: a render that prints a secret (whatever the kit does), a strip over 600 KiB, no kit, no chase', () => {
  const c = play(fresh(), [{ ticks: 1, caption: 'Go', roll: 'Ana · Finesse · risky/standard · 4' }]);
  for (const leak of ['Ana · <tspan>Finesse</tspan> · risky/standard · 4', 'REINFORCEMENTS ARRIVE']) {
    let e = null; try { P.chaseDisplay(c, () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>' + leak + '</text></svg>' }), G); } catch (x) { e = x; }
    assert.ok(e && e.leak === true && e.message === P.CHASE_LEAK_MSG, 'refused: ' + leak);
  }
  let e2 = null; try { P.chaseDisplay(c, () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><desc>' + 'x'.repeat(601 * 1024) + '</desc></svg>' }), G); } catch (x) { e2 = x; }
  assert.ok(e2 && e2.big === true && /too large for the iPad \(601 KiB, at most 600\)/.test(e2.message), e2 && e2.message);
  assert.throws(() => P.chaseDisplay(c, null, G), /map kit 0\.6/);
  assert.throws(() => P.chaseDisplay(null, K.chase, G), /Start a chase/);
});
await test('the GM copy grows with the clock: one panel per roll, as many slots as the leg; drawn in play, never ahead', () => {
  let c = fresh();
  const r0 = K.chase(c, { layer: 'gm', layout: 'ipad' });
  assert.equal(r0.drawn, 0, 'no panel before the first tick');
  c = play(c, [{ ticks: 2, caption: 'A' }, { ticks: 3, caption: 'B' }]);
  const r = K.chase(c, { layer: 'player', layout: 'ipad' });
  assert.equal(r.drawn, 2); assert.equal(r.slots, 3, 'two panels and one empty slot');
  assert.equal(K.chase(c, { layer: 'player', layout: 'ipad' }).svg, r.svg, 'deterministic');
});
await test('the key, the bundle: C opens the Chase panel; gm/chase.js loads before gm-page.js', () => {
  assert.deepEqual(P.keyAction({ key: 'c' }), { type: 'panel', panel: 'chase' });
  assert.deepEqual(P.keyAction({ key: 'C' }), { type: 'panel', panel: 'chase' });
  assert.equal(P.keyAction({ key: 'c', typing: true }), null); assert.equal(P.keyAction({ key: 'c', ctrlKey: true }), null);
  const gm = routes.BUNDLES ? routes.BUNDLES.gm : globalThis.B68Load.BUNDLES.gm;
  assert.ok(gm.indexOf('gm/chase.js') > 0 && gm.indexOf('gm/chase.js') < gm.indexOf('gm-page.js'), gm.join());
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
