// gm-room-roll: the room roll (RK13 of the room key build; setting room.tables). No browser, no network.
// app/gm/room-roll.js draws a room's read-aloud line, its things and its people from the rooms part, on three rng streams forked
// from the roll's key, the room's key and the stream's name, AFTER the site is rolled. These checks: the same seed gives the same
// draw; the location sweep and the map-kit goldens do not move; the mix holds over 1,000 seeds (and after Roll another and Swap);
// nothing repeats; note things dedupe by slug; rr changes the draw; the streams are independent; authored sites; no table.
// INVENTED data only: the fixture rooms part (rooms-pack.json), the fixture location tables, and tables made here from a seed.
//   node checks/runtime/gm-room-roll.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/room-roll.js';
const R = require(path.join(ROOT, FILE));
const RT = require(path.join(ROOT, 'app', 'gm', 'room-tables.js'));
const TH = require(path.join(ROOT, 'app', 'gm', 'room-things.js'));
const RS = require(path.join(ROOT, 'app', 'gm', 'room-state.js'));
const L = require(path.join(ROOT, 'app', 'gm', 'location.js'));
const K = require(path.join(ROOT, 'app', 'maps', 'map-kit.js'));
const P = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
const FIX = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', f), 'utf8'));
const PACK = FIX('rooms-pack.json');
const FIXL = FIX('location-pack.json');
const GOLD = FIX('map-kit-golden.json');
const clone = (o) => JSON.parse(JSON.stringify(o));
const sha = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

/* ---------- tables made from a seed (invented words; each one passes the rooms part's validator) ---------- */
function lcg(seed) { let a = seed >>> 0 || 1; return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; }; }
const ADJ = ['brass', 'tall', 'green', 'cracked', 'heavy', 'narrow', 'painted', 'dusty', 'folding', 'rusted', 'velvet', 'tin'];
const NOUN = ['lamp', 'cupboard', 'crate', 'ladder', 'mirror', 'trolley', 'shelf', 'bucket', 'screen', 'clock', 'desk', 'trunk', 'stool', 'hatch'];
const TAGS = TH.TAGS;
const ROLES = Object.keys(PACK.T.roles);
function makeRoom(name, band, seed) {
  for (let tries = 0; ; tries++) {
    const r = lcg(seed * 7919 + tries), pickOf = (a) => a[Math.floor(r() * a.length)], names = new Set(), things = [];
    while (things.length < 10) {
      const nm = 'A ' + pickOf(ADJ) + ' ' + pickOf(NOUN);
      if (names.has(nm)) continue;
      names.add(nm);
      const tags = [];
      const n = 1 + Math.floor(r() * 3);
      /* weapons and clues often, so the mix has work to do */
      while (tags.length < n) { const g = r() < 0.3 ? pickOf(['weapon', 'clue']) : pickOf(TAGS); if (!tags.includes(g)) tags.push(g); }
      things.push({ name: nm, line: 'Invented detail ' + things.length + '.', look: 'GM-ONLY-look ' + things.length, roll: '', danger: '', states: [], tags });
    }
    const room = { name, themes: ['the Pelican Rooms'], band, say: ['Say one.', 'Say two.', 'Say three.'],
      people: band === 'public' ? [{ role: 'waiter', w: 3 }, { role: 'cleaner', w: 1 }, { role: 'nobody', w: 2 }] : band === 'working' ? [{ role: 'cleaner', w: 1 }, { role: 'nobody', w: 3 }] : [{ role: 'waiter', w: 1 }, { role: 'nobody', w: 6 }],
      things };
    const T = { rooms: { [normRoom(name)]: room }, roles: PACK.T.roles, aliases: {} };
    if (!RT.validate(T, { roles: ROLES }).errors.length) return room;
  }
}
const normRoom = require(path.join(ROOT, 'app', 'gm', 'room-notes.js')).normRoom;
/* a rooms part covering every room name the fixture location tables roll in seeds 1..n */
function partFor(seeds) {
  const T = { rooms: {}, roles: PACK.T.roles, aliases: {} };
  for (const seed of seeds) {
    const o = L.generate(FIXL, {}, { seed, mem: {} });
    o.rooms.forEach((rm, i) => { const k = normRoom(rm.name); if (!T.rooms[k]) T.rooms[k] = makeRoom(rm.name, rm.band, seed * 100 + i); });
  }
  return T;
}

/* misses of the mix over a set of things: no clue, no escape or cover, a weapon past one */
function mixOf(things) {
  const has = (g) => things.filter((t) => t.tags.includes(g)).length;
  return { clue: has('clue'), way: things.filter((t) => t.tags.includes('escape') || t.tags.includes('cover')).length, weapon: has('weapon') };
}
function assertMix(things, label) {
  const m = mixOf(things);
  assert.ok(m.clue >= 1, label + ': no clue');
  assert.ok(m.way >= 1, label + ': no escape or cover');
  assert.ok(m.weapon <= 1, label + ': ' + m.weapon + ' weapons');
}
/* a second weapon weighs more than a missing clue or way out: it never comes in to bring one back */
const misses = (things) => { const m = mixOf(things); return (m.clue ? 0 : 1) + (m.way ? 0 : 1) + 3 * Math.max(0, m.weapon - 1); };
/* the fewest misses the table allows: base plus one table thing not on show (cur) and not swapped away (gone), worked out by brute force */
/* (the weapon cap is hard: a weapon never joins things that hold one; null when nothing may come) */
const armed = (t) => t.tags.includes('weapon');
function left(room, cur, gone = []) {
  const on = cur.map((t) => TH.slug(t.name));
  return room.things.filter((t) => !on.includes(TH.slug(t.name)) && !gone.includes(TH.slug(t.name)));
}
/* what Swap on the place now showing `now` may not bring back: every stored swap's origin but this place's own (its origin comes home) */
function goneFrom(swaps, now) {
  const origin = Object.keys(swaps).find((a) => swaps[a] === now) || now;
  return Object.keys(swaps).filter((a) => a !== origin);
}
function best(room, cur, base, gone = []) {
  const cands = left(room, cur, gone).filter((t) => !(base.some(armed) && armed(t)));
  return cands.length ? Math.min(...cands.map((t) => misses(base.concat([t])))) : null;
}
/* room-state with a host of its own: the writes the buttons will make (RK15), read back as roll() takes them */
function rig() {
  const merge = (t, p) => { const out = Object.assign({}, t); for (const k of Object.keys(p)) { const v = p[k]; if (v === null) delete out[k]; else if (v && typeof v === 'object' && !Array.isArray(v)) out[k] = merge(out[k] && typeof out[k] === 'object' ? out[k] : {}, v); else out[k] = clone(v); } return out; };
  const r = { doc: {}, t: Date.UTC(2026, 10, 26) };
  r.rs = RS.create({ on: () => true, doc: () => r.doc, now: () => (r.t += 1000), part: () => 'p1', busy: () => false, patch: (p) => { r.doc = merge(r.doc, p); return true; } });
  return r;
}
/* site() takes the page's rollKey from its caller, as RK14's will (P.rollKey, gm-page.js) */
const site = (roll, T, o = {}) => R.site(roll, T, Object.assign({ rollKey: P.rollKey(roll) }, o));
const opts = (rs, rk, key) =>{ const s = rs.read(rk, key); return { say: s.say, rr: s.rr, extra: s.extra, swaps: s.swaps }; };

const BAR = RT.get('Pelican bar', PACK.T);
const CLOAK = RT.get('Pelican cloakroom', PACK.T);

/* ---------- the module ---------- */
test('the module loads under Node and as a plain script, and is no longer a stub', () => {
  assert.equal(R.stub, undefined);
  for (const f of ['key', 'roll', 'another', 'swap', 'thingsOf', 'there', 'site', 'rng']) assert.equal(typeof R[f], 'function', f);
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, FILE), 'utf8'), win, { filename: FILE });
  assert.equal(typeof win.B68GmRoomRoll.roll, 'function');
  assert.equal(R.DRAW, 4);
});

test('the same seed gives the same draw; another room or another roll gives another', () => {
  const k = R.key(42, 'pelican bar#1');
  assert.deepEqual(R.roll(BAR, k, {}), R.roll(BAR, k, {}));
  assert.deepEqual(R.roll(clone(BAR), k, {}), R.roll(BAR, k, {}), 'a copy of the table draws the same');
  const d = R.roll(BAR, k, {});
  assert.equal(d.table, true); assert.equal(d.things.length, 4); assert.equal(d.shown.length, 4);
  assert.ok(d.say >= 0 && d.say < 3);
  let differ = 0;
  for (let s = 0; s < 50; s++) if (JSON.stringify(R.roll(BAR, R.key(s, 'pelican bar#1'), {})) !== JSON.stringify(R.roll(BAR, R.key(s, 'pelican bar#2'), {}))) differ++;
  assert.ok(differ >= 40, 'the roomKey forks the streams: ' + differ + '/50 differ');
  const T = partFor([5]), roll = L.generate(FIXL, {}, { seed: 5, mem: {} });
  assert.deepEqual(site(roll, T), site(L.generate(FIXL, {}, { seed: 5, mem: {} }), T), 'rolling the same site twice gives the same rooms and things');
});

/* The fixture with no controlled or secure rooms (every band of those two made working): no room gets an obstacle, so generate() reaches its
   last draw (the obstacle fallback, location.js ~:615), and a draw added anywhere inside generate() moves its digest. */
const FLAT = (() => {
  const F = clone(FIXL), flat = (b) => (b === 'controlled' || b === 'secure' ? 'working' : b);
  for (const t of Object.values(F.T.theme)) { t.bands = t.bands.map(flat); t.alsoRooms = t.alsoRooms.map((a) => [a[0], flat(a[1])]); }
  return F;
})();
/* the sweep's digests, pinned: the rolls of location.js as it is on room/main 9efb60be (RK13 leaves it untouched) */
const SWEEP = { fixture: 'f679f8319bc71dac', flat: '4214d60512129bf5' };

test('the location sweep does not move: pinned digests (one reaching generate()\'s last draw), room rolls between the rolls, none written onto', () => {
  const T = partFor([1, 2, 3, 4, 5, 6, 7, 8]);
  for (const [name, pack] of [['fixture', FIXL], ['flat', FLAT]]) {
    const plain = [], mixed = [];
    for (let s = 0; s < 400; s++) plain.push(JSON.stringify(L.generate(pack, {}, { seed: s * 2654435761 >>> 0, mem: {} })));
    for (let s = 0; s < 400; s++) {
      const o = L.generate(pack, {}, { seed: s * 2654435761 >>> 0, mem: {} }), before = JSON.stringify(o);
      if (name === 'flat') assert.ok(!o.rooms.some((x) => x.obstacle) && o.obstacle, 'the flat fixture reaches the obstacle fallback');
      const out = site(o, T);
      assert.ok(out && out.order.length === new Set(RS.roomKeys(o.rooms.map((x) => x.name))).size);
      assert.equal(JSON.stringify(o), before, 'site() wrote onto the roll (seed ' + s + ')');
      mixed.push(JSON.stringify(o));
    }
    assert.equal(sha(mixed.join('\n')), sha(plain.join('\n')), name + ': the room rolls moved the sweep');
    assert.equal(sha(plain.join('\n')), SWEEP[name], name + ': the sweep is not the pinned one (a draw was added to or moved in generate())');
  }
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm', 'location.js'), 'utf8');
  assert.ok(!/RoomRoll|room-roll/.test(src), 'location.js does not call the room roll (no draw inside generate())');
});

test('the map-kit goldens do not move (24 seeds x 4 views, each roll room-rolled first)', () => {
  const T = partFor(Array.from({ length: 24 }, (_, i) => i + 1)), bad = [];
  for (let seed = 1; seed <= 24; seed++) {
    const r = L.generate(FIXL, {}, { seed, mem: {} });
    const out = site(r, T);
    assert.ok(out.order.every((k) => out.rooms[k].draw.table), 'every room has a table');
    for (const view of ['plan', 'iso', 'rings', 'section']) {
      const h = sha(K.render(r, { view, layer: 'gm', width: 1000 }).svg);
      if (GOLD[seed + ':' + view] !== h) bad.push(seed + ':' + view);
    }
  }
  assert.deepEqual(bad, []);
});

test('the mix holds over 1,000 seeds, and after Roll another and Swap', () => {
  let swaps = 0, extras = 0, whole = 0, nulls = 0;
  for (let s = 0; s < 1000; s++) {
    const band = ['public', 'working', 'controlled', 'secure'][s % 4];
    const room = makeRoom('Pelican room ' + (s % 7), band, s), k = R.key(s, normRoom(room.name) + '#1');
    const d = R.roll(room, k, {});
    assert.equal(d.things.length, 4, 'seed ' + s);
    assert.equal(new Set(d.shown.map((e) => e.slug)).size, 4, 'seed ' + s + ': a repeat');
    assertMix(R.thingsOf(d, room), 'seed ' + s);
    /* swap each place in turn, then roll another twice: the mix stays */
    const r = rig(), rk = String(s), key = normRoom(room.name) + '#1';
    for (let i = 0; i < 4; i++) {
      const cur = R.thingsOf(R.roll(room, k, opts(r.rs, rk, key)), room), rest = cur.filter((_, j) => j !== i);
      const gone = goneFrom(r.rs.read(rk, key).swaps, TH.slug(cur[i].name));
      const sw = R.swap(room, k, opts(r.rs, rk, key), i);
      if (!sw) { assert.equal(best(room, cur, rest, gone), null, 'seed ' + s + ': swap ' + i + ' gave null with a thing that fits left'); nulls++; continue; }
      assert.ok(!gone.includes(sw.to), 'seed ' + s + ': swap ' + i + ' brought back a thing swapped away from another place');
      assert.ok(r.rs.setSwap(rk, key, sw.slug, sw.to)); swaps++;
      const after = R.thingsOf(R.roll(room, k, opts(r.rs, rk, key)), room);
      assert.equal(misses(after), best(room, cur, rest, gone), 'seed ' + s + ' after swap ' + i + ': not the best mix the table allows');
      if (!misses(after)) whole++;
    }
    for (let i = 0; i < 2; i++) {
      const cur = R.thingsOf(R.roll(room, k, opts(r.rs, rk, key)), room), gone = Object.keys(r.rs.read(rk, key).swaps);
      const x = R.another(room, k, opts(r.rs, rk, key));
      if (!x) { assert.equal(best(room, cur, cur, gone), null, 'seed ' + s + ': Roll another gave null with a thing that fits left'); break; }
      assert.ok(r.rs.addExtra(rk, key, x)); extras++;
      const after = R.roll(room, k, opts(r.rs, rk, key));
      assert.equal(after.shown[after.shown.length - 1].slug, x, 'the extra shows last');
      assert.equal(misses(R.thingsOf(after, room)), best(room, cur, cur, gone), 'seed ' + s + ' after another ' + i);
      assert.ok(mixOf(R.thingsOf(after, room)).weapon <= Math.max(1, mixOf(cur).weapon), 'seed ' + s + ': Roll another brought a second weapon ' + JSON.stringify({ cur: cur.map((x) => x.tags), x, gone, all: room.things.map((t) => TH.slug(t.name) + ':' + t.tags) }));
    }
  }
  assert.ok(swaps > 3900 && swaps + nulls === 4000, swaps + ' swaps, ' + nulls + ' with nothing that fits');
  assert.ok(whole > 0.8 * swaps, 'the whole mix held after ' + whole + ' of ' + swaps + ' swaps (the rest: the table had no other way out or clue left)');
  assert.ok(extras > 1500, 'Roll another drew ' + extras);
});

test('swapping out the only clue, or the only way out or cover, gives one back; no second weapon comes in', () => {
  let clueOut = 0, wayOut = 0;
  for (let s = 0; s < 400; s++) {
    const room = makeRoom('Pelican room', 'public', 5000 + s), k = R.key(s, 'pelican room#1'), d = R.roll(room, k, {}), th = R.thingsOf(d, room);
    th.forEach((t, i) => {
      const rest = th.filter((_, j) => j !== i), m = mixOf(rest), isWay = (g) => g.includes('escape') || g.includes('cover');
      const can = (f) => left(room, th).some((x) => f(x.tags) && !(m.weapon && armed(x)));
      const sw = R.swap(room, k, {}, i), to = sw && room.things.find((x) => TH.slug(x.name) === sw.to);
      if (!sw) { assert.equal(best(room, th, rest), null, 'seed ' + s + ': null with a thing that fits left'); return; }
      /* the only clue (and nothing else missing) went: a clue comes back when one is left; the same for a way out */
      if (!m.clue && m.way && can((g) => g.includes('clue'))) { clueOut++; assert.ok(to.tags.includes('clue'), 'seed ' + s + ': the only clue went and none came back'); }
      if (!m.way && m.clue && can(isWay)) { wayOut++; assert.ok(isWay(to.tags), 'seed ' + s + ': the only way out went and none came back'); }
      if (!m.way && !m.clue) assert.equal(misses(rest.concat([to])), best(room, th, rest), 'seed ' + s + ': both went, and the best the table has did not come');
      if (m.weapon >= 1) assert.ok(!armed(to), 'seed ' + s + ': a second weapon came in');
    });
  }
  assert.ok(clueOut > 50 && wayOut > 50, 'the case came up: ' + clueOut + ' clues, ' + wayOut + ' ways out');
});

test('the weapon cap is hard in the draw too: a note\'s weapon means no table weapon, even when the only clue and way out are on one', () => {
  const plain = (n, tags) => ({ name: n, line: 'Invented.', look: 'GM-ONLY-look', roll: '', danger: '', states: [], tags });
  const room = { name: 'Pelican armoury', themes: ['the Pelican Rooms'], band: 'working', say: ['One.', 'Two.', 'Three.'], people: [{ role: 'cleaner', w: 1 }, { role: 'nobody', w: 3 }],
    things: [plain('A rusted sabre', ['weapon', 'clue', 'cover']), plain('A loaded cane', ['weapon', 'clue']), plain('A brass lamp', ['loot']), plain('A tall cupboard', ['talk']),
      plain('A green ladder', ['weird']), plain('A tin bucket', ['tool']), plain('A cracked mirror', ['hazard']), plain('A narrow hatch', ['door']),
      plain('A velvet coat', ['costume']), plain('A dusty crate', ['loot', 'tool'])] };
  assert.deepEqual(RT.validate({ rooms: { 'pelican armoury': room }, roles: PACK.T.roles, aliases: {} }, { roles: ROLES }).errors, [], 'a valid table');
  const hand = [{ name: 'A pocket pistol', tags: ['weapon'] }];
  let alone = 0;
  for (let s = 0; s < 1000; s++) {
    const k = R.key(s, 'pelican armoury#1'), d = R.roll(room, k, { hand }), th = R.thingsOf(d, room, hand);
    assert.equal(d.things.length, 3);
    assert.equal(th.filter(armed).length, 1, 'seed ' + s + ': a table weapon joined the note\'s (' + th.map((t) => t.name).join(', ') + ')');
    const bare = R.thingsOf(R.roll(room, k, {}), room);
    assert.ok(bare.some((t) => t.name === 'A rusted sabre') && !bare.some((t) => t.name === 'A loaded cane'), 'seed ' + s + ': without the note, the one weapon that brings the whole mix');
    if (!bare.some((t) => t.name === 'A rusted sabre')) alone++;
  }
  assert.equal(alone, 0);
});

test('Swap on each place in turn never brings back a thing swapped away from another place (the review\'s probe, 500 seeds)', () => {
  let swaps = 0, home = 0;
  for (let s = 0; s < 500; s++) {
    const r = rig(), rk = String(s), key = 'pelican bar#1', k = R.key(rk, key), first = R.roll(BAR, k, {}).shown.map((e) => e.slug);
    for (let i = 0; i < 4; i++) {
      const sv = r.rs.read(rk, key).swaps, now = R.roll(BAR, k, opts(r.rs, rk, key)).shown[i].slug, sw = R.swap(BAR, k, opts(r.rs, rk, key), i);
      if (!sw) continue;
      const away = Object.keys(sv).filter((a) => a !== first[i]);
      assert.equal(sw.slug, now);
      assert.ok(!away.includes(sw.to), 'seed ' + s + ' place ' + i + ': swap brought back ' + sw.to + ', swapped away from another place');
      r.rs.setSwap(rk, key, sw.slug, sw.to); swaps++;
    }
    /* and a run of swaps on place 0 still comes home */
    for (let n = 0; n < 12; n++) {
      const sw = R.swap(BAR, k, opts(r.rs, rk, key), 0);
      if (!sw) break;
      r.rs.setSwap(rk, key, sw.slug, sw.to);
      if (sw.to === first[0]) { home++; break; }
    }
  }
  assert.ok(swaps > 1900, swaps + ' swaps');
  /* the mix may hold a run among the things that keep it best, so the origin is not always reached in the Pelican bar */
  assert.ok(home > 350, 'a run of swaps on one place comes home (' + home + '/500)');
  /* where every thing keeps the mix alike, a run on any place walks every free thing once and comes home, after other places' swaps */
  const even = clone(BAR); even.things.forEach((t) => { t.tags = ['clue', 'cover']; });
  for (let s = 0; s < 200; s++) {
    const r = rig(), rk = String(s), key = 'pelican bar#1', k = R.key(rk, key), first = R.roll(even, k, {}).shown.map((e) => e.slug);
    const a = R.swap(even, k, {}, 1); r.rs.setSwap(rk, key, a.slug, a.to);
    const seen = [];
    for (let n = 0; n < 10; n++) {
      const sw = R.swap(even, k, opts(r.rs, rk, key), 0);
      assert.ok(sw && sw.to !== first[1], 'seed ' + s + ': place 1\'s origin came to place 0');
      assert.ok(!seen.includes(sw.to), 'seed ' + s + ': ' + sw.to + ' came twice before home');
      seen.push(sw.to); r.rs.setSwap(rk, key, sw.slug, sw.to);
      if (sw.to === first[0]) break;
    }
    assert.equal(seen[seen.length - 1], first[0], 'seed ' + s + ': home');
    assert.equal(seen.length, 10 - 4 - 1 + 1, 'seed ' + s + ': every free thing once, then home');
  }
});

test('no repeats: Roll another and Swap never bring back what shows, or what was swapped away; Roll another runs dry', () => {
  for (let s = 0; s < 200; s++) {
    const room = s % 2 ? BAR : makeRoom('Pelican room', 'working', 9000 + s), k = R.key(s, 'pelican room#1'), r = rig(), rk = 'a:Pelican', key = 'pelican room#1';
    /* every slug swapped away, with the origin of the place it left (the thing first drawn there) */
    const swappedAway = new Map(), originOf = {};
    for (let step = 0; step < 12; step++) {
      const cur = R.roll(room, k, opts(r.rs, rk, key)), slugs = cur.shown.map((e) => e.slug);
      assert.equal(new Set(slugs).size, slugs.length, 'seed ' + s + ' step ' + step + ': a thing shows twice');
      if (step % 3 === 2) {
        const sw = R.swap(room, k, opts(r.rs, rk, key), step % cur.shown.length);
        if (!sw) continue;
        assert.ok(!slugs.includes(sw.to), 'seed ' + s + ': swap brought back a thing on show');
        assert.notEqual(sw.to, sw.slug);
        const origin = originOf[sw.slug] || sw.slug;
        assert.ok(!swappedAway.has(sw.to) || swappedAway.get(sw.to) === origin, 'seed ' + s + ': swap brought back ' + sw.to + ', swapped away from another place');
        swappedAway.set(sw.slug, origin); originOf[sw.to] = origin;
        r.rs.setSwap(rk, key, sw.slug, sw.to);
      } else {
        const x = R.another(room, k, opts(r.rs, rk, key));
        if (x === null) {
          const th = R.thingsOf(cur, room), rest = left(room, th, Object.keys(r.rs.read(rk, key).swaps));
          assert.ok(rest.every((t) => armed(t) && th.some(armed)), 'seed ' + s + ': ran dry with a thing that fits left');
          break;
        }
        assert.ok(!slugs.includes(x), 'seed ' + s + ': Roll another drew a thing on show');
        assert.ok(!Object.keys(r.rs.read(rk, key).swaps).includes(x), 'seed ' + s + ': Roll another brought back a thing swapped away');
        r.rs.addExtra(rk, key, x);
      }
    }
  }
  /* six Roll anothers take a ten-thing table to ten, and the seventh has nothing left */
  const r = rig(), k = R.key(7, 'pelican bar#1');
  for (let i = 0; i < 6; i++) { const x = R.another(BAR, k, opts(r.rs, '7', 'pelican bar#1')); assert.ok(x, 'another ' + i); r.rs.addExtra('7', 'pelican bar#1', x); }
  assert.equal(R.roll(BAR, k, opts(r.rs, '7', 'pelican bar#1')).shown.length, 10);
  assert.equal(R.another(BAR, k, opts(r.rs, '7', 'pelican bar#1')), null);
  /* swapping one place again and again: never the thing it holds, a chain collapses, and back to the first stores nothing */
  const q = rig(), k2 = R.key(8, 'pelican bar#1'), first = R.roll(BAR, k2, {}).shown[0].slug;
  let seen = [first], back = false;
  for (let i = 0; i < 12; i++) {
    const sw = R.swap(BAR, k2, opts(q.rs, '8', 'pelican bar#1'), 0);
    assert.equal(sw.slug, seen[seen.length - 1]);
    q.rs.setSwap('8', 'pelican bar#1', sw.slug, sw.to); seen.push(sw.to);
    const sv = q.rs.read('8', 'pelican bar#1').swaps;
    if (sw.to === first) { back = true; assert.deepEqual(sv, {}, 'back to the first stores nothing'); break; }
    assert.deepEqual(sv, { [first]: sw.to }, 'the chain collapses');
  }
  assert.ok(back, 'a run of swaps comes round to the first thing again: ' + seen.join(' > '));
});

test('a note\'s things come first and dedupe by slug; fewer than 3 are topped up from the table, 3 or more draw none', () => {
  const hand = [{ name: 'The long zinc bar!', tags: ['clue'] }, { name: 'a LONG zinc bar', tags: [] }];
  for (let s = 0; s < 300; s++) {
    const d = R.roll(BAR, R.key(s, 'pelican bar#1'), { hand });
    assert.deepEqual(d.shown[0], { src: 'note', i: 0, slug: 'long-zinc-bar' });
    assert.equal(d.shown.filter((e) => e.slug === 'long-zinc-bar').length, 1, 'seed ' + s + ': the note and the table both show it');
    assert.ok(!d.things.includes(0), 'seed ' + s + ': the table drew the note\'s thing');
    assert.equal(d.shown.length, 4, 'one note thing (two by slug) + three from the table');
  }
  const k = R.key(1, 'pelican bar#1');
  assert.equal(R.roll(BAR, k, { hand: [{ name: 'A brass hook' }, { name: 'A tin cup' }] }).things.length, 2);
  const three = R.roll(BAR, k, { hand: [{ name: 'A brass hook' }, { name: 'A tin cup' }, { name: 'A paper fan' }] });
  assert.deepEqual(three.things, []); assert.equal(three.shown.length, 3, 'three note things stay three');
  assert.deepEqual(R.thingsOf(three, BAR, [{ name: 'A brass hook' }, { name: 'A tin cup' }, { name: 'A paper fan' }]).map((t) => t.name), ['A brass hook', 'A tin cup', 'A paper fan']);
  /* a swap or extra naming the note's slug is skipped (the note's thing already shows) */
  assert.deepEqual(R.roll(BAR, k, { hand, extra: ['long-zinc-bar'] }).shown.length, 4);
});

test('rr changes the say and the things; the people stay byte-equal (a Keep names a person slot, and reroll keeps it)', () => {
  let say = 0, things = 0;
  const room = makeRoom('Pelican lounge', 'public', 77);
  for (let s = 0; s < 200; s++) {
    const k = R.key(s, 'pelican lounge#1'), a = R.roll(room, k, {}), b = R.roll(room, k, { rr: 1 }), c = R.roll(room, k, { rr: 2 });
    if (a.say !== b.say || b.say !== c.say) say++;
    if (JSON.stringify(a.things) !== JSON.stringify(b.things)) things++;
    assert.deepEqual(b.people, a.people, 'seed ' + s); assert.deepEqual(c.people, a.people, 'seed ' + s);
    assert.deepEqual(R.roll(room, k, { rr: 1 }), b, 'the reroll replays');
  }
  assert.ok(say > 100, 'say moved in ' + say + '/200'); assert.ok(things > 150, 'things moved in ' + things + '/200');
});

test('the streams are independent: note things, swaps, extras and the say never shift the people; the things never shift the say', () => {
  const room = makeRoom('Pelican lounge', 'public', 78);
  for (let s = 0; s < 300; s++) {
    const k = R.key(s, 'pelican lounge#1'), a = R.roll(room, k, {});
    const b = R.roll(room, k, { hand: [{ name: 'A brass hook', tags: ['weapon'] }, { name: 'A paper fan' }], say: 2, extra: [TH.slug(room.things[9].name)], swaps: { [a.shown[0].slug]: TH.slug(room.things[8].name) } });
    assert.deepEqual(b.people, a.people, 'seed ' + s + ': people');
    assert.equal(R.roll(room, k, { hand: [{ name: 'A brass hook' }] }).say, a.say, 'seed ' + s + ': say');
    /* the people come from their own stream alone */
    const r = R.rng(k, 'people'), w = [3, 1, 2], pick = () => { let x = r() * 6; for (let i = 0; i < 3; i++) { x -= w[i]; if (x < 0) return i; } return 2; };
    const first = ['waiter', 'cleaner'][(() => { const x = r() * 4; return x < 3 ? 0 : 1; })()], seed1 = Math.floor(r() * 4294967296) >>> 0;
    assert.deepEqual(a.people[0], { role: first, seed: seed1 }, 'seed ' + s + ': the first person is the people stream\'s first draw');
    const two = pick(), seed2 = Math.floor(r() * 4294967296) >>> 0;
    assert.deepEqual(a.people.slice(1), two === 2 ? [] : [{ role: ['waiter', 'cleaner'][two], seed: seed2 }]);
  }
});

test('people by band: public 1 or 2 (never nobody first), working, controlled and secure 0 or 1 by the weights', () => {
  const n = { public: [0, 0, 0], working: [0, 0, 0], controlled: [0, 0, 0] };
  for (const band of Object.keys(n)) {
    const room = makeRoom('Pelican hall', band, 31);
    for (let s = 0; s < 1000; s++) {
      const p = R.roll(room, R.key(s, 'pelican hall#1'), {}).people;
      n[band][p.length]++;
      p.forEach((x) => { assert.ok(ROLES.includes(x.role) && x.role !== 'nobody'); assert.ok(Number.isInteger(x.seed) && x.seed >= 0 && x.seed < 2 ** 32); });
    }
  }
  assert.equal(n.public[0], 0); assert.ok(n.public[1] > 200 && n.public[2] > 500, JSON.stringify(n.public));
  assert.equal(n.working[2], 0); assert.ok(n.working[1] > 150 && n.working[1] < 350, JSON.stringify(n.working));
  assert.equal(n.controlled[2], 0); assert.ok(n.controlled[1] > 80 && n.controlled[1] < 220, JSON.stringify(n.controlled));
  const only = clone(BAR); only.people = [{ role: 'nobody', w: 1 }];
  assert.deepEqual(R.roll(only, 'x', {}).people, [], 'a public room whose People line is only nobody has nobody');
});

test('overrides: say picks the line, a swap replaces in place, extra adds at the end; stale or doubled slugs are skipped', () => {
  const k = R.key(3, 'pelican bar#1'), d = R.roll(BAR, k, {}), all = BAR.things.map((t) => TH.slug(t.name));
  const free = all.filter((x) => !d.shown.some((e) => e.slug === x));
  assert.equal(R.roll(BAR, k, { say: 2 }).say, 2); assert.equal(R.roll(BAR, k, { say: 7 }).say, d.say, 'a say past the table is skipped');
  const sw = R.roll(BAR, k, { swaps: { [d.shown[1].slug]: free[0] } });
  assert.equal(sw.shown[1].slug, free[0]); assert.equal(sw.shown.length, 4); assert.deepEqual(sw.shown[0], d.shown[0]);
  assert.deepEqual(R.roll(BAR, k, { swaps: { [d.shown[1].slug]: 'gone-from-the-tables' } }), d, 'a slug the table lost is skipped');
  assert.deepEqual(R.roll(BAR, k, { swaps: { [d.shown[1].slug]: d.shown[2].slug } }), d, 'a swap to a thing on show is skipped');
  const ex = R.roll(BAR, k, { extra: [free[1], 'gone-from-the-tables', d.shown[0].slug, free[2]] });
  assert.deepEqual(ex.shown.slice(4).map((e) => e.slug), [free[1], free[2]]);
  assert.deepEqual(ex.things, ex.shown.map((e) => e.i));
});

test('no table: the draw says so (the caller words "No table for <room>"); a note\'s things still show; no theme fallback', () => {
  const d = R.roll(null, 'x|y#1', { hand: [{ name: 'A brass hook' }] });
  assert.deepEqual(d, { table: false, say: null, things: [], shown: [{ src: 'note', i: 0, slug: 'brass-hook' }], people: [] });
  assert.equal(R.another(null, 'x', {}), null); assert.equal(R.swap(null, 'x', {}, 0), null);
  const roll = L.generate(FIXL, {}, { seed: 3, mem: {} });
  const out = site(roll, { rooms: {}, roles: {}, aliases: {} });
  assert.ok(out.order.length > 5 && out.order.every((k) => out.rooms[k].draw.table === false && out.rooms[k].draw.shown.length === 0));
});

test('site(): an authored site (RK13.4) is keyed by room name, every field optional; two authored sites on one seed differ', () => {
  const rooms = [{ name: 'Pelican bar' }, { name: 'Pelican cloakroom', band: 'working' }, { name: 'Pelican bar' }, { name: 'A room with no table' }, {}];
  const authored = (name) => ({ name, base: { seed: 11 }, patch: { name, rooms: clone(rooms) } });
  const a = P.authoredRoll(L, FIXL, authored('The Pelican Rooms')), b = P.authoredRoll(L, FIXL, authored('The Dovetail Rooms'));
  assert.equal(a.seed, b.seed, 'one base seed');
  const before = JSON.stringify(a);
  const hand = (room, key) => (key === 'pelican cloakroom#1' ? [{ name: 'A brass hook' }] : []);
  const ra = site(a, PACK.T, { hand }), rb = site(b, PACK.T, { hand });
  assert.equal(JSON.stringify(a), before, 'site() wrote onto the authored roll');
  assert.equal(ra.rollKey, 'a:The Pelican Rooms');
  assert.deepEqual(ra.order, ['pelican bar#1', 'pelican cloakroom#1', 'pelican bar#2', 'a room with no table#1']);
  assert.equal(ra.rooms['pelican bar#1'].draw.things.length, 4);
  assert.equal(ra.rooms['pelican cloakroom#1'].draw.shown[0].slug, 'brass-hook');
  assert.equal(ra.rooms['a room with no table#1'].draw.table, false);
  assert.deepEqual(ra.rooms['pelican bar#1'].draw, R.roll(BAR, R.key('a:The Pelican Rooms', 'pelican bar#1'), { hand: [] }));
  assert.notDeepEqual(ra, rb, 'the rollKey, not the base seed, seeds the draw');
  /* the overrides come from room-state's read shape */
  const r = rig();
  r.rs.setSay('a:The Pelican Rooms', 'pelican bar#2', 1); r.rs.reroll('a:The Pelican Rooms', 'pelican bar#1');
  const rc = site(a, PACK.T, { state: (rk, key) => r.rs.read(rk, key) });
  assert.equal(rc.rooms['pelican bar#2'].draw.say, 1);
  assert.deepEqual(rc.rooms['pelican bar#1'].draw, R.roll(BAR, R.key('a:The Pelican Rooms', 'pelican bar#1'), { rr: 1 }));
  /* the rollKey is the caller's (the page's P.rollKey), never worked out here */
  assert.equal(R.site(a, PACK.T), null, 'no rollKey from the caller: no draw');
  assert.equal(R.site(a, PACK.T, { rollKey: '' }), null);
  assert.equal(R.site(a, PACK.T, { rollKey: 'a:Another' }).rollKey, 'a:Another', 'the caller\'s key is the one used');
  assert.notDeepEqual(R.site(a, PACK.T, { rollKey: 'a:Another' }).rooms, ra.rooms);
});

test('there(): the line naming the things drawn, by name only', () => {
  assert.equal(R.there(['A tall cupboard', 'A broom', 'The radio']), "There's a tall cupboard, a broom and the radio.");
  assert.equal(R.there(['An umbrella stand']), "There's an umbrella stand.");
  assert.equal(R.there(['Coats on hooks', 'Some loose change']), "There's Coats on hooks and some loose change.");
  assert.equal(R.there([]), '');
  const d = R.roll(CLOAK, R.key(1, 'pelican cloakroom#1'), {});
  const line = R.there(R.thingsOf(d, CLOAK).map((t) => t.name));
  assert.ok(!/GM-ONLY/.test(line), 'names only: no closer look, roll or danger');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
