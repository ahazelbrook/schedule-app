// Unit test for the threat on the map (suite 2.5, app/gm/map-threat.js): the glyph chosen from a stamp's consequence line, the glyph drawn into the map, the controller against a fake
// host, and the stamp's two hook lines (the glyph drops when the stamp goes up and clears with it). Every name is invented.
//   node checks/runtime/gm-map-threat.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const T = require(path.join(ROOT, 'app', 'gm', 'map-threat.js'));
const St = require(path.join(ROOT, 'app', 'gm', 'stamp.js'));
const F = require(path.join(ROOT, 'app', 'features.js'));
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

function node(tag) { return { tag, attrs: {}, children: [], parentNode: null, setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { c.parentNode = this; this.children.push(c); return c; }, removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; } }; }
const fakeDoc = () => ({ createElementNS: (ns, t) => node(t) });
const fakeSvg = () => Object.assign(node('svg'), { querySelectorAll(sel) { assert.equal(sel, '.b19-threat'); return this.children.filter((c) => c.attrs.class === 'b19-threat'); } });
const BOX = { x: 10, y: 20, w: 40, h: 30 };

await test('the switch: GM-only, default off, Saturday try, in the maps stage', () => {
  const s = F.get('map.threat'); assert.ok(s); assert.equal(s.surface, 'gm'); assert.equal(s.default, false); assert.equal(s.saturday, 'try'); assert.equal(s.stage, 'map');
});
await test('glyphFor: the four consequences, a plain warning for anything else, nothing for an empty line', () => {
  const g = T.glyphFor;
  assert.equal(g('The guard turns'), 'guard'); assert.equal(g('a patrol rounds the corner'), 'guard');
  assert.equal(g('The door locks behind you'), 'door'); assert.equal(g('the gate is bolted'), 'door');
  assert.equal(g('An alarm trips'), 'alarm'); assert.equal(g('the siren goes'), 'alarm'); assert.equal(g('A guard raises the alarm'), 'alarm');
  assert.equal(g('Someone gets hurt'), 'harm'); assert.equal(g('level 2 harm'), 'harm'); assert.equal(g('a wound that bleeds'), 'harm');
  assert.equal(g('The ceiling is thin'), 'warn'); assert.equal(g(''), ''); assert.equal(g('   '), ''); assert.equal(g(null), '');
  T.KINDS.forEach((k) => assert.ok(k));
});
await test('glyphSvg: one badge in the room’s top right corner, a different mark for each kind, replaced and cleared, no text and no page words', () => {
  const svg = fakeSvg();
  const seen = new Set();
  for (const kind of T.KINDS) {
    const d = fakeDoc(); let all = []; const orig = d.createElementNS; d.createElementNS = (ns, t) => { const n = orig(ns, t); all.push(n); return n; };
    const g = T.glyphSvg(d, svg, BOX, kind);
    assert.equal(svg.children.length, 1, kind); assert.equal(g.attrs['data-glyph'], kind);
    const badge = all.find((n) => n.tag === 'circle'); assert.ok(+badge.attrs.cx > BOX.x + BOX.w / 2 && +badge.attrs.cy < BOX.y + BOX.h / 2, 'top right ' + kind);
    assert.ok(all.every((n) => !('textContent' in n)), 'no text in ' + kind);
    seen.add(all.map((n) => n.tag + (n.attrs.d || '')).join('|'));
  }
  assert.equal(seen.size, T.KINDS.length, 'each kind draws its own mark');
  assert.equal(T.glyphSvg(fakeDoc(), svg, BOX, 'nonsense'), null); assert.equal(svg.children.length, 0, 'an unknown kind draws nothing and clears the old one');
  T.glyphSvg(fakeDoc(), svg, BOX, 'door'); T.clearGlyph(svg); assert.equal(svg.children.length, 0);
});

function world(flag = true) {
  const w = { flag, logs: [], room: 'Showroom' };
  return { w, host: { feature: (id) => w.flag && id === 'map.threat', doc: () => fakeDoc(), room: () => w.room, roomBox: () => BOX, log: (t) => w.logs.push(t) } };
}
await test('drop puts the glyph on the crew’s room; a new stamp replaces it; clear takes it away; the line is logged', () => {
  const { w, host } = world(), c = T.create(host), svg = fakeSvg(); c.paint({}, svg, null);
  assert.deepEqual(c.drop({ position: 'risky', effect: 'standard', text: 'The guard turns' }), { room: 'Showroom', kind: 'guard' });
  assert.equal(svg.children.length, 1); assert.equal(svg.children[0].attrs['data-glyph'], 'guard'); assert.deepEqual(c.view(), { room: 'Showroom', kind: 'guard' });
  c.drop({ position: 'desperate', effect: 'limited', text: 'An alarm trips' }); assert.equal(svg.children.length, 1); assert.equal(svg.children[0].attrs['data-glyph'], 'alarm');
  assert.equal(c.clear(), true); assert.equal(svg.children.length, 0); assert.equal(c.view(), null); assert.equal(c.clear(), false);
  assert.equal(w.logs.length, 2); assert.match(w.logs[0], /guard in Showroom/);
});
await test('a map drawn again under a live glyph gets it back; no consequence line or no room means no glyph', () => {
  const { w, host } = world(), c = T.create(host), svg1 = fakeSvg(), svg2 = fakeSvg(); c.paint({}, svg1, null);
  c.drop({ text: 'The door locks' }); const svg3 = fakeSvg(); c.paint({}, svg3, null); assert.equal(svg3.children.length, 1);
  assert.equal(c.drop({ text: '' }), null); assert.equal(svg3.children.length, 0, 'an empty line clears and draws nothing');
  w.room = ''; assert.equal(c.drop({ text: 'The guard turns' }), null);
});
await test('switch off: nothing is drawn or logged', () => {
  const { w, host } = world(false), c = T.create(host), svg = fakeSvg(); c.paint({}, svg, null);
  assert.equal(c.drop({ text: 'The guard turns' }), null); assert.equal(svg.children.length, 0); assert.equal(w.logs.length, 0);
});

// the stamp's hooks: threat(st) when the stamp goes up (after the beat landed), threatClear() when it comes down (Esc, a marked result)
await test('the stamp calls threat when it goes up and threatClear when it comes down; a stamp the iPad refused drops nothing', async () => {
  const calls = [];
  let shown = true;
  const host = { feature: () => true, positions: () => [], roomLines: () => [], currentPosition: () => 'risky', setPosition() {}, show: async () => (shown ? { ok: 1 } : null), overlayId: () => '', clearOverlay: async () => ({}),
    log() {}, toast() {}, now: () => 1, keyFor: (k) => k, setTimeout: () => 1, clearTimeout() {}, changed() {}, threat: (s) => calls.push(['threat', s.text]), threatClear: () => calls.push(['clear']) };
  const c = St.create(host);
  assert.equal(await c.stampNow('risky', 'standard', 'The guard turns'), true); assert.deepEqual(calls, [['threat', 'The guard turns']]);
  await c.esc(); assert.deepEqual(calls.slice(1), [['clear']]);
  shown = false; calls.length = 0; assert.equal(await c.stampNow('risky', 'standard', 'An alarm trips'), false); assert.deepEqual(calls, []);
  shown = true; await c.stampNow('risky', 'standard', 'x'); calls.length = 0; await c.mark('45'); assert.deepEqual(calls, [['clear']]);
});
await test('the stamp with no hooks is as it was (a host without threat or threatClear)', async () => {
  const host = { feature: () => true, positions: () => [], roomLines: () => [], currentPosition: () => '', setPosition() {}, show: async () => ({}), overlayId: () => '', clearOverlay: async () => ({}), log() {}, toast() {}, now: () => 1, keyFor: (k) => k, setTimeout: () => 1, clearTimeout() {}, changed() {} };
  const c = St.create(host); assert.equal(await c.stampNow('risky', 'standard', 'x'), true); await c.esc();
});
await test('the files: the module is in the GM bundle and not the display, and names no campaign', () => {
  const routes = fs.readFileSync(path.join(ROOT, 'app', 'routes.js'), 'utf8');
  const gm = routes.split('\n').find((l) => /^\s*gm:/.test(l)), disp = routes.split('\n').find((l) => /^\s*display:/.test(l));
  assert.ok(gm.includes("'gm/map-threat.js'") && !disp.includes('map-threat'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
