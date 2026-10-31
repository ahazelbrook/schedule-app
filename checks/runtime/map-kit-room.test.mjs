// The two app-side changes to the vendored map kit (GM.md, "The kits"): a front vector that names a ground-floor room lands on it,
// and a roll's room may carry its own w (2..12) and lvl (-1..2) over the catalogue's. Rolled sites must draw exactly as before.
// INVENTED data only (the Pelican Rooms) and the fixture location tables.
//   node checks/runtime/map-kit-room.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const P = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
const L = require(path.join(ROOT, 'app', 'gm', 'location.js'));
const K = require(path.join(ROOT, 'app', 'maps', 'map-kit.js'));
const FIXL = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'location-pack.json'), 'utf8'));
const GOLD = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'map-kit-golden.json'), 'utf8'));

let failed = 0, passed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const rooms = (extra) => [
  Object.assign({ name: 'The grand lobby', band: 'public' }, extra && extra.lobby),
  Object.assign({ name: 'Main floor', band: 'public' }, extra && extra.main),
  { name: 'Kitchens', band: 'working' }, { name: 'Private card rooms', band: 'controlled' },
  { name: 'Luxury penthouse', band: 'secure', isTarget: true },
];
const SITE = (patch) => ({ name: 'The Pelican Rooms', patch: Object.assign({ name: 'The Pelican Rooms', rooms: rooms() }, patch) });
const FRONT = (room) => [{ n: 'The front', how: 'A door on the square.', know: 'free', room, level: 'street', means: 'door' }];
const draw = (site) => K.render(P.authoredRoll(L, FIXL, site), { view: 'iso', layer: 'gm', width: 1000 });
const frontRoom = (r) => { const e = r.layout.entries.find((x) => x.kind === 'front'); return e && e.room && e.room.name; };

test('rolled sites draw byte-for-byte as before the change (24 seeds x 4 views)', () => {
  const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);
  const bad = [];
  for (let seed = 1; seed <= 24; seed++) {
    const r = L.generate(FIXL, {}, { seed, mem: {} });
    for (const view of ['plan', 'iso', 'rings', 'section']) {
      const h = sha(K.render(r, { view, layer: 'gm', width: 1000 }).svg);
      if (GOLD[seed + ':' + view] !== h) bad.push(seed + ':' + view);
    }
  }
  assert.deepEqual(bad, []);
});

test('without a named front room the widest shallow room still takes the front (as before)', () => {
  assert.equal(frontRoom(draw(SITE({ vectors: FRONT(null) }))), 'Main floor');
});

test('a front vector naming a ground-floor room lands on it', () => {
  assert.equal(frontRoom(draw(SITE({ vectors: FRONT('The grand lobby') }))), 'The grand lobby');
});

test('a front vector naming an upstairs room is ignored (no outside wall to the street)', () => {
  assert.equal(frontRoom(draw(SITE({ vectors: FRONT('Private card rooms') }))), 'Main floor');
});

test("a roll room's w and lvl win over the catalogue; bad values are ignored", () => {
  const model = (extra) => draw(SITE({ rooms: rooms(extra) })).model.rooms;
  const get = (m, n) => m.find((r) => r.name === n);
  const base = model();
  assert.equal(get(base, 'The grand lobby').w, 4);
  const m = model({ lobby: { w: 9, lvl: 1 }, main: { w: 'wide', lvl: 7 } });
  assert.equal(get(m, 'The grand lobby').w, 9);
  assert.equal(get(m, 'The grand lobby').lvl, 1);
  assert.equal(get(m, 'Main floor').w, 7);
  assert.equal(get(m, 'Main floor').lvl, 0);
  const n = model({ lobby: { w: 1.5, lvl: 0.5 }, main: { w: 13, lvl: -2 } });
  assert.equal(get(n, 'The grand lobby').w, 4);
  assert.equal(get(n, 'Main floor').w, 7);
});

test('a bigger lobby draws wider on the ground floor', () => {
  const wide = (extra) => { const r = draw(SITE({ vectors: FRONT('The grand lobby'), rooms: rooms(extra) })); return r.layout.levels.find((l) => l.lvl === 0).rooms.find((x) => x.name === 'The grand lobby').rect.w; };
  assert.ok(wide({ lobby: { w: 10 } }) > wide());
});

test('w and lvl survive the authored-site path and the player layer renders', () => {
  const roll = P.authoredRoll(L, FIXL, SITE({ vectors: FRONT('The grand lobby'), rooms: rooms({ lobby: { w: 9, lvl: 0 } }) }));
  assert.equal(roll.rooms[0].w, 9);
  for (const layer of ['gm', 'players']) assert.match(K.render(roll, { view: 'plan', layer, width: 1000 }).svg, /^\s*<svg/);
});

console.log(passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
