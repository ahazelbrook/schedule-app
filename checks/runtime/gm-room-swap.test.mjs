// gm-room-swap (RK15 of the room key build, room.tables): app/gm/room-swap.js, Swap on the zoom card, and Roll another and Reroll the room on a rolled room's card.
// INVENTED data only: the rooms part of checks/runtime/fixtures/gm/rooms-pack.json (the Pelican bar and the Pelican cloakroom, GM-ONLY- markers on every
// closer look, roll and danger) and a roll made up here. The draw is RK13's (room-roll.js); this file's buttons and writes are driven through the page's own
// write path (gm-page.js applyPatch and mergePatch, the server's deepMerge) with the real room-state.js, so what is asserted is what the GM sees and what is
// stored: which things show after a swap, where the swap is kept, and what two devices make of it. The browser half is room-tables.e2e.mjs (step 7).
//   node checks/runtime/gm-room-swap.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/room-swap.js';
const SW = require(path.join(ROOT, FILE));
const RL = require(path.join(ROOT, 'app', 'gm', 'room-roll.js'));
const RR = require(path.join(ROOT, 'app', 'gm', 'room-rolled.js'));
const RS = require(path.join(ROOT, 'app', 'gm', 'room-state.js'));
const Z = require(path.join(ROOT, 'app', 'gm', 'room-zoom.js'));
const PP = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
const { deepMerge } = await import(pathToFileURL(path.join(ROOT, 'functions', '_lib', 'http.js')).href);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const T = JSON.parse(read('checks/runtime/fixtures/gm/rooms-pack.json')).T;
const clone = (v) => JSON.parse(JSON.stringify(v));
const SEED = 424242, BAR = 'pelican bar#1', CLOAK = 'pelican cloakroom#1';
const ROLL = { seed: SEED, name: 'The Pelican Rooms', rooms: [
  { name: 'Pelican bar', band: 'public', detail: 'A low bar.' }, { name: 'Pelican cloakroom', band: 'working', detail: 'Coats.' },
  { name: 'Zorn quib room', band: 'secure', detail: 'Quib walls.' }] };
const HAND = '- **Things:**\n  1. **A ledger on the bar**, open at today.\n     - 🔍 GM-ONLY-look: one page is torn out.\n     - Tags: clue\n';
const TEXTS = [...new Set(['pelican bar', 'pelican cloakroom'].flatMap((k) => T.rooms[k].say.concat(T.rooms[k].things.flatMap((x) => [x.name, x.line, x.look, x.roll, x.danger]))).filter((s) => s && s.length >= 8))];

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

/* a device: the page's doc, its saver and the server, with the page's own applyPatch and mergePatch (as gm-room-state.test.mjs does) */
const T0 = Date.parse('2026-11-26T09:00:00.000Z');
function device(server) {
  const d = { doc: clone(server.doc), pending: null, toasts: [], t: T0 };
  d.rs = RS.create({ on: () => true, doc: () => d.doc, now: () => (d.t += 1000), part: () => 'p1', toast: (t) => d.toasts.push(t),
    busy: () => !!(d.pending && d.pending.roomstate),
    patch: (p) => { d.doc = PP.applyPatch(d.doc, p); d.pending = d.pending ? PP.mergePatch(d.pending, p) : clone(p); return true; } });
  d.flush = () => { if (d.pending) { server.doc = deepMerge(server.doc, d.pending); d.pending = null; } d.doc = clone(server.doc); };
  return d;
}
const newServer = () => ({ doc: {} });

/* the page's side of the rolled instance: the host room-rolled.create is given (roll, rollKey, T, md, rs, redraw, toast, zoom) */
function page(d, o = {}) {
  const log = { hooks: null, opened: [], toasts: [], redraws: 0 };
  const host = { roll: () => ROLL, rollKey: (r) => r.seed, T: () => (o.T === undefined ? T : o.T), doc: () => d.doc, rs: () => (o.noRs ? null : d.rs),
    md: (room) => (room === 'Pelican bar' && o.hand ? HAND : ''), redraw: () => { log.redraws++; }, toast: (t, bad) => log.toasts.push([t, !!bad]),
    zoom: (h) => { log.hooks = h; const z = Z.create(h), open = z.open; z.open = (...a) => { log.opened.push([a[0], a[1], a[3], log.redraws]); return open(...a); }; return z; } };
  const rr = RR.create(host);
  return { rr, host, log, hooks: () => { rr.zoom(); return log.hooks; } };
}
const cardOf = (p, key) => p.rr.model().cards.filter((c) => c.roomKey === key)[0];
const slugsOf = (p, key) => cardOf(p, key).things.map((t) => t.slug);
/* a zoom card's ctx for a thing, as room-zoom's ctxOf builds it */
function ctxFor(p, d, key, slug) {
  const c = cardOf(p, key), i = c.things.findIndex((t) => t.slug === slug);
  return { room: c.name, rollKey: String(SEED), roomKey: key, thing: c.things[i], index: i, count: c.things.length, state: '', rs: d.rs, page: p.hooks(), refresh() {}, close() {}, toast() {} };
}
const swapBtn = (p, d, key, slug) => SW.buttons(ctxFor(p, d, key, slug))[0] || null;
const tap = (p, d, key, slug) => { const c = ctxFor(p, d, key, slug); return SW.buttons(c)[0].run(c); };
const stored = (d, key) => { const s = d.doc.roomstate, k = s && s.keys && s.keys[String(SEED)]; return k && k.rooms && k.rooms[key] ? k.rooms[key] : null; };
const btnOf = (html, act) => (new RegExp('<button[^>]*data-rr-act="' + act + '"[^>]*>').exec(html) || [])[0] || null;
const elOf = (act, room) => ({ getAttribute: (k) => ({ 'data-rr-act': act, 'data-rr-room': room })[k] || null });
const swapper = (p, d, extra = {}) => SW.create(Object.assign({ scene: p.hooks().scene, rs: () => d.rs, redraw: () => {}, toast: () => {} }, extra));

test('gm-room-swap: loads under Node and as a plain script, no longer a stub; nothing is read at load', () => {
  assert.equal(SW.stub, undefined);
  for (const k of ['buttons', 'create', 'swapPlan', 'anotherPlan', 'marksOf']) assert.equal(typeof SW[k], 'function', k);
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(read(FILE), win, { filename: FILE });
  const M = win.B68GmRoomSwap;
  assert.ok(M && !M.stub && typeof M.create === 'function', 'defined');
  assert.equal(M.buttons({}).length, 0, 'no ctx, no buttons, and no throw with no other module on the page');
  assert.equal(M.create({}).html({ table: true, roomKey: 'a#1' }, {}), '');
  assert.equal(M.create({}).act(elOf('another', 'a#1')), 'another', 'with nothing behind it the tap toasts and does nothing');
});

test('Swap: one button in the zoom card\'s swap slot for a rolled thing, labelled Swap, and none for a hand-written thing, a room with no table or a card that is not a rolled one', () => {
  const s = newServer(), d = device(s), p = page(d, { hand: true });
  const things = slugsOf(p, BAR);
  assert.equal(things[0], 'ledger-on-the-bar', 'the note\'s thing first');
  assert.equal(swapBtn(p, d, BAR, things[0]), null, 'a hand-written thing has no Swap');
  const b = swapBtn(p, d, BAR, things[1]);
  assert.ok(b && b.label === 'Swap' && b.id === 'swap' && !b.disabled && typeof b.run === 'function', 'a rolled thing has Swap: ' + JSON.stringify(b && { l: b.label, d: b.disabled }));
  assert.equal(SW.buttons(Object.assign(ctxFor(p, d, BAR, things[1]), { page: {} })).length, 0, 'a zoom card whose host has no scene (RK09\'s own, on an authored note) has none');
  const none = page(device(s), { T: null });
  assert.deepEqual(none.rr.model().cards.map((c) => c.things.length), [0, 0, 0], 'no rooms part: nothing to swap');
  const z3 = Object.assign(ctxFor(p, d, BAR, things[1]), { roomKey: 'zorn quib room#1' });
  assert.equal(SW.buttons(z3).length, 0, 'a room with no table: no Swap');
  const nw = swapBtn(p, { rs: null }, BAR, things[1]);
  assert.ok(nw && nw.disabled && /live GM page/.test(nw.title), 'no writer: drawn disabled, and it says why');
  assert.equal(Z.slotsOf('swap', ctxFor(p, d, BAR, things[1]), [], { B68GmRoomSwap: SW }).length, 1, 'room-zoom\'s slot asks this module, which is not a stub');
});

test('Swap writes one override, keyed by the roll and the room: the thing is replaced in place, the people and the say stay, chains collapse, coming round stores nothing', () => {
  const s = newServer(), d = device(s), p = page(d);
  const before = cardOf(p, BAR), t0 = before.things[0].slug;
  const exp = RL.swap(T.rooms['pelican bar'], RL.key(SEED, BAR), {}, 0);
  tap(p, d, BAR, t0);
  assert.deepEqual(stored(d, BAR).swaps, { [t0]: exp.to }, 'RS.setSwap(rollKey, roomKey, slug, to): the one key, a slug to a slug');
  assert.deepEqual(Object.keys(d.doc.roomstate.keys), [String(SEED)]); assert.deepEqual(Object.keys(d.doc.roomstate.keys[String(SEED)].rooms), [BAR], 'no other room touched');
  const after = cardOf(p, BAR);
  assert.equal(after.things.length, 4); assert.equal(after.things[0].slug, exp.to, 'replaced in its place');
  assert.deepEqual(after.things.slice(1).map((x) => x.slug), before.things.slice(1).map((x) => x.slug));
  assert.deepEqual(after.people, before.people, 'the people never move'); assert.equal(after.say, before.say);
  assert.equal(after.there, RL.there(after.things.map((x) => x.name)), 'the "There\'s ..." line names what is there now');
  /* again on the same place: a chain collapses to one entry whose key is the thing first drawn */
  tap(p, d, BAR, exp.to);
  const sw2 = stored(d, BAR).swaps;
  assert.deepEqual(Object.keys(sw2), [t0], 'one entry, never a chain'); assert.notEqual(sw2[t0], exp.to);
  /* round the table: the place comes round to its first thing, which stores nothing */
  let cur = sw2[t0], n = 0;
  while (stored(d, BAR) && n++ < 15) { tap(p, d, BAR, cur); cur = slugsOf(p, BAR)[0]; }
  assert.equal(stored(d, BAR), null, 'back to the first thing: nothing stored (the room is left with nothing in it)'); assert.equal(slugsOf(p, BAR)[0], t0);
  assert.ok(n >= 3 && n <= 10, 'it took ' + n + ' taps');
});

test('Swap keeps the mix and the weapon cap, and a button with nothing to swap in is disabled and says so (the run throws, which the zoom card toasts)', () => {
  const s = newServer(), d = device(s), p = page(d);
  const weapons = () => cardOf(p, BAR).things.filter((t) => t.tags.includes('weapon')).length;
  let k = 0;
  for (; k < 40; k++) {      /* swap every place in turn, over and over: never a second weapon */
    const sl = slugsOf(p, BAR)[k % 4], b = swapBtn(p, d, BAR, sl);
    if (b && !b.disabled) tap(p, d, BAR, sl);
    assert.ok(weapons() <= 1, 'one weapon at most (tap ' + k + ')');
  }
  /* fill the room with Roll another until the table has nothing more, then every Swap button agrees with its plan */
  const sw = swapper(p, d);
  for (let n = 0; n < 12; n++) sw.act(elOf('another', BAR));
  const sc = p.hooks().scene(BAR), rd = d.rs.read(String(SEED), BAR);
  assert.equal(SW.anotherPlan(sc, rd), null, 'the table has nothing more to add');
  let blocked = 0;
  for (const sl of slugsOf(p, BAR)) {
    const plan = SW.swapPlan(sc, rd, sl), b = swapBtn(p, d, BAR, sl);
    assert.equal(!!(b && b.disabled), plan.why === 'none', sl + ': disabled exactly when there is nothing to swap in');
    if (plan.why === 'none') { blocked++; assert.match(b.title, /Nothing else/); assert.throws(() => tap(p, d, BAR, sl), /Nothing else in this room/); }
  }
  assert.ok(blocked >= 1, 'a full room has places that cannot swap (' + blocked + ')');
  assert.ok(weapons() <= 1);
});

test('Swap on a thing that Roll another added replaces it in the extra list, and records it as swapped away (RK15 review)', () => {
  const s = newServer(), d = device(s), p = page(d);
  swapper(p, d).act(elOf('another', BAR));
  const slug = Object.keys(stored(d, BAR).extra)[0];
  assert.equal(slugsOf(p, BAR).length, 5); assert.equal(slugsOf(p, BAR)[4], slug, 'added at the end');
  tap(p, d, BAR, slug);
  const room = stored(d, BAR), now = Object.keys(room.extra);
  assert.equal(now.length, 1); assert.notEqual(now[0], slug); assert.deepEqual(room.swaps, { [slug]: now[0] }, 'and a swap entry is the record that the old thing is gone (room-roll reads only the keys of swaps); the draw applies swaps to the first draw only, so the card is the extra list');
  assert.equal(slugsOf(p, BAR).length, 5); assert.equal(slugsOf(p, BAR)[4], now[0], 'the same place, another thing');
  assert.equal(slugsOf(p, BAR).includes(slug), false);
});

test('the review blocker: a thing swapped away from an added place never comes back, by Roll another or by a Swap elsewhere; 30 mixed taps hold the weapon cap', () => {
  for (const [key, rname] of [[BAR, 'Pelican bar'], [CLOAK, 'Pelican cloakroom']]) {
    const s = newServer(), d = device(s), p = page(d), sw = swapper(p, d);
    sw.act(elOf('another', key));
    const gone = [Object.keys(stored(d, key).extra)[0]];
    tap(p, d, key, gone[0]);
    gone.push(stored(d, key).swaps[gone[0]]);      /* the one that took its place: it too is swapped on below */
    sw.act(elOf('another', key));
    assert.ok(!slugsOf(p, key).includes(gone[0]), rname + ': Roll another does not bring ' + gone[0] + ' back');
    tap(p, d, key, slugsOf(p, key)[0]);
    assert.ok(!slugsOf(p, key).includes(gone[0]), rname + ': nor does a Swap at another place');
    for (let k = 0; k < 30; k++) {
      const shown = slugsOf(p, key), pick = shown[(k * 3) % shown.length], b = swapBtn(p, d, key, pick);
      if (k % 3 === 0) sw.act(elOf('another', key)); else if (b && !b.disabled) tap(p, d, key, pick);
      const now = slugsOf(p, key);
      assert.ok(!now.includes(gone[0]), rname + ': ' + gone[0] + ' stays gone (tap ' + k + ')');
      assert.equal(new Set(now).size, now.length, 'no duplicate');
      assert.ok(cardOf(p, key).things.filter((t) => t.tags.includes('weapon')).length <= 1, 'one weapon at most');
    }
  }
});

test('the swaps cap: with 10 swaps stored, a Swap on an added thing is refused and changes nothing', () => {
  const s = newServer(), d = device(s), p = page(d);
  swapper(p, d).act(elOf('another', BAR));
  const extra = Object.keys(stored(d, BAR).extra)[0], tbl = T.rooms['pelican bar'].things.map((t) => require(path.join(ROOT, 'app', 'gm', 'room-things.js')).slug(t.name));
  const rest = tbl.filter((x) => x !== extra);
  for (let i = 0; i < 10; i++) assert.equal(d.rs.setSwap(String(SEED), BAR, 'zz-' + i, rest[i % rest.length] === 'zz-' + i ? 'yy' : rest[i % rest.length]), true);
  const before = JSON.stringify(d.doc.roomstate.keys);
  const c = ctxFor(p, d, BAR, extra);
  assert.throws(() => SW.buttons(c)[0].run(c), /not saved/);
  assert.equal(JSON.stringify(d.doc.roomstate.keys), before, 'nothing was written: the extra list is as it was');
});

test('a failed setExtra on a SECOND swap of one added thing puts the first swap record back (the re-check note)', () => {
  const s = newServer(), d = device(s), p = page(d);
  swapper(p, d).act(elOf('another', BAR));
  const x = Object.keys(stored(d, BAR).extra)[0];
  tap(p, d, BAR, x);
  const y = stored(d, BAR).swaps[x];
  assert.deepEqual(stored(d, BAR).swaps, { [x]: y }, 'the first record: x gone, y shown');
  const real = d.rs.setExtra; d.rs.setExtra = () => false;      /* the second swap's setExtra fails */
  const c = ctxFor(p, d, BAR, y);
  assert.throws(() => SW.buttons(c)[0].run(c), /not saved/);
  d.rs.setExtra = real;
  assert.deepEqual(stored(d, BAR).swaps, { [x]: y }, 'the first record survives, unchanged (not deleted, not left pointing at the failed swap)');
  assert.deepEqual(Object.keys(stored(d, BAR).extra), [y]);
  /* and the very first swap failing leaves no record at all */
  const s2 = newServer(), d2 = device(s2), p2 = page(d2);
  swapper(p2, d2).act(elOf('another', BAR));
  const x2 = Object.keys(stored(d2, BAR).extra)[0]; d2.rs.setExtra = () => false;
  const c2 = ctxFor(p2, d2, BAR, x2);
  assert.throws(() => SW.buttons(c2)[0].run(c2), /not saved/);
  assert.ok(!stored(d2, BAR).swaps, 'nothing left behind');
});

test('the reroll question counts only the marks on things shown (a mark on a swapped-away thing is not what it clears)', () => {
  const s = newServer(), d = device(s), p = page(d), sw = swapper(p, d);
  const t0 = slugsOf(p, BAR)[0];
  assert.equal(d.rs.setMark(String(SEED), BAR, t0, 'taken'), true);
  tap(p, d, BAR, t0);      /* swapped away: the mark stays under its own slug, unseen */
  assert.ok(d.rs.read(String(SEED), BAR).marks[t0], 'the mark is still stored');
  assert.ok(!/rr-asking/.test(sw.html(cardOf(p, BAR), {})));
  assert.equal(sw.act(elOf('reroll', BAR)), 'reroll', 'no visible mark: no question, it rerolls');
  assert.equal(stored(d, BAR).rr, 1);
  const t1 = slugsOf(p, BAR)[1], hidden = SW.swapPlan(p.hooks().scene(BAR), d.rs.read(String(SEED), BAR), t1).to;
  assert.ok(hidden && !slugsOf(p, BAR).includes(hidden));
  d.rs.setMark(String(SEED), BAR, hidden, 'found');      /* a mark on a thing that is not on the card: not counted */
  d.rs.setMark(String(SEED), BAR, t1, 'found');
  assert.equal(SW.marksOf(d.rs.read(String(SEED), BAR), slugsOf(p, BAR)), 1);
  assert.equal(sw.act(elOf('reroll', BAR)), 'reroll-yes'); assert.match(sw.html(cardOf(p, BAR), {}), /Rerolling clears 1 mark./);
});

test('Swap follows: after the write the Run pane draws again, then the zoom card is asked to open on the thing now in that place', () => {
  const s = newServer(), d = device(s), p = page(d);
  const t0 = slugsOf(p, BAR)[0];
  const redrawsBefore = p.log.redraws;
  tap(p, d, BAR, t0);
  const to = slugsOf(p, BAR)[0];
  assert.notEqual(to, t0);
  assert.deepEqual(p.log.opened.map((o) => [o[0], o[1], o[2]]), [['Pelican bar', to, 1]], 'the instance\'s zoom card opens on it (room, slug, the room\'s n)');
  assert.ok(p.log.opened[0][3] > redrawsBefore, 'after the pane drew again, so its new button exists');
  /* a twin: its own n */
  const twin = { seed: SEED, name: 'T', rooms: [{ name: 'Pelican bar', band: 'public' }, { name: 'Pelican bar', band: 'public' }] };
  const s2 = newServer(), d2 = device(s2), p2 = page(d2); p2.host.roll = () => twin;
  const rr2 = RR.create(p2.host), sl = rr2.model().cards[1].things[0].slug;
  const hooks = (rr2.zoom(), p2.log.hooks), c = { room: 'Pelican bar', rollKey: String(SEED), roomKey: 'pelican bar#2', rs: d2.rs, page: hooks, thing: rr2.model().cards[1].things[0] };
  SW.buttons(c)[0].run(c);
  assert.equal(p2.log.opened.at(-1)[2], 2, 'the second Pelican bar: n is 2'); assert.ok(sl);
  assert.ok(stored(d2, 'pelican bar#2') && !stored(d2, 'pelican bar#1'), 'and it is stored under that room\'s own key');
});

test('two devices on one state: a swap survives a reload and a second device; two devices write different keys and the server merges them key by key', () => {
  const s = newServer(), A = device(s), pa = page(A);
  const t0 = slugsOf(pa, BAR)[0], first = slugsOf(pa, BAR).slice();
  tap(pa, A, BAR, t0);
  const swapped = slugsOf(pa, BAR);
  assert.notDeepEqual(swapped, first);
  A.flush();
  const B = device(s), pb = page(B);      /* a second device, or a reload: a new page on the server's state */
  assert.deepEqual(slugsOf(pb, BAR), swapped, 'a second device draws the same swapped card');
  assert.deepEqual(slugsOf(page(device(s)), BAR), swapped, 'and a reload of the first page does too');
  const fresh = page(device(newServer())).rr.model().cards;
  assert.deepEqual(pb.rr.model().cards.map((c) => [c.say, c.people]), fresh.map((c) => [c.say, c.people]), 'say and people are the seed\'s, as before');
  /* both write at once from the same copy: A swaps in the cloakroom, B rolls another in the bar; neither loses the other's */
  const A3 = device(s), B3 = device(s), p3a = page(A3), p3b = page(B3);
  const ct = slugsOf(p3a, CLOAK)[1];
  tap(p3a, A3, CLOAK, ct);
  swapper(p3b, B3).act(elOf('another', BAR));
  A3.flush(); B3.flush();
  const pc = page(device(s));
  assert.equal(slugsOf(pc, CLOAK).includes(ct), false, 'the cloakroom swap is there');
  assert.equal(slugsOf(pc, BAR).length, 5, 'and so is the bar\'s extra');
  assert.deepEqual(slugsOf(pc, BAR).slice(0, 4), swapped, 'and the earlier bar swap');
});

test('Roll another and Reroll the room: the card\'s two buttons, in the actions part after the read-aloud, as the build words them; none for a room with no table; kit classes on the kit desk', () => {
  const s = newServer(), d = device(s), p = page(d);
  const m = p.rr.model(), bar = m.cards[0], none = m.cards[2];
  const html = RR.cardHtml(bar, { actions: (c) => swapper(p, d).html(c, {}) });
  assert.match(html, /<p class="rv-dim rr-lab rr-actlab">This room<\/p><div class="rr-acts" data-rr-acts="pelican bar#1" role="group"/);
  const a = btnOf(html, 'another'), r = btnOf(html, 'reroll');
  assert.ok(a && r && /data-rr-room="pelican bar#1"/.test(a) && !/ disabled/.test(a) && !/ disabled/.test(r), 'both there and live');
  assert.ok(/Roll another/.test(html) && /Reroll the room/.test(html));
  assert.ok(!/data-gm=/.test(html.slice(html.indexOf('rr-acts'))), 'not routed by the page\'s own click handler');
  assert.ok(html.indexOf('rr-acts') > html.indexOf('rr-say') && html.indexOf('rr-acts') < html.indexOf('Who’s here'), 'after the read-aloud, before the people');
  assert.equal(swapper(p, d).html(none, {}), '', 'no table: no buttons');
  const kit = swapper(p, d).html(bar, { kit: true });
  assert.ok(/rr-acts krv-acts/.test(kit) && !/rv-btn/.test(kit), 'the kit desk\'s classes, none of the old desk\'s button ones');
  assert.ok(/<h4 class="krv-lab rr-lab rr-actlab">This room<\/h4>/.test(kit) && !/rv-lab/.test(html.slice(html.indexOf('rr-actlab'), html.indexOf('rr-acts"'))), 'the label is the kit\'s (12 px) there, and on the old desk never the 10.5 px rv-lab');
  const ro = swapper(p, d, { rs: () => null }).html(bar, {});
  assert.ok(/ disabled/.test(btnOf(ro, 'another')) && /live GM page/.test(ro), 'no writer: both drawn disabled, and the title says why');
});

test('Roll another adds the next thing at the end (RS.addExtra), the read-aloud names it, a toast says what came, and a full room says so', () => {
  const s = newServer(), d = device(s), p = page(d), toasts = [];
  const sw = swapper(p, d, { toast: (t, bad) => toasts.push([t, !!bad]) });
  const exp = RL.another(T.rooms['pelican bar'], RL.key(SEED, BAR), {});
  assert.equal(sw.act(elOf('another', BAR)), 'another');
  assert.deepEqual(Object.keys(stored(d, BAR).extra), [exp]); assert.ok(!stored(d, BAR).swaps && !stored(d, BAR).rr);
  const c = cardOf(p, BAR); assert.equal(c.things.length, 5); assert.equal(c.things[4].slug, exp);
  assert.ok(c.there.includes(c.things[4].name.replace(/^A /, 'a ')), 'the read-aloud names it');
  assert.deepEqual(toasts[0], ['Added ' + c.things[4].name + '.', false]);
  for (let n = 0; n < 12; n++) sw.act(elOf('another', BAR));
  toasts.length = 0; sw.act(elOf('another', BAR));
  assert.deepEqual(toasts, [[SW.WHY.more, true]], 'nothing left: it says so and writes nothing');
  assert.ok(Object.keys(stored(d, BAR).extra).length <= 10);
  assert.match(swapper(p, d).html(cardOf(p, BAR), {}), /data-rr-act="another"[^>]* disabled/, 'and the button is drawn disabled');
  assert.deepEqual(cardOf(p, BAR).people, page(device(newServer())).rr.model().cards[0].people, 'the people never move');
});

test('Reroll the room: a fresh draw of the say and the things, never the people; marks, extras and swaps go; with a mark set the first tap asks and writes nothing', () => {
  const s = newServer(), d = device(s), p = page(d), toasts = [];
  const sw = swapper(p, d, { toast: (t, bad) => toasts.push([t, !!bad]) });
  const first = cardOf(p, BAR);
  assert.equal(sw.act(elOf('reroll', BAR)), 'reroll', 'nothing marked: it does it at once');
  assert.equal(stored(d, BAR).rr, 1);
  const again = cardOf(p, BAR);
  assert.notDeepEqual(again.things.map((x) => x.slug), first.things.map((x) => x.slug), 'the things are drawn again');
  assert.deepEqual(again.people, first.people, 'the people never move'); assert.deepEqual(toasts[0], ['Rerolled Pelican bar.', false]);
  assert.equal(d.rs.setMark(String(SEED), BAR, again.things[0].slug, 'taken'), true);
  sw.act(elOf('another', BAR));
  const snap = JSON.stringify(d.doc.roomstate.keys);
  assert.equal(sw.act(elOf('reroll', BAR)), 'reroll-yes', 'the first tap asks, and the focus goes to the confirm');
  assert.equal(JSON.stringify(d.doc.roomstate.keys), snap, 'the first tap wrote nothing');
  const h = sw.html(cardOf(p, BAR), {});
  assert.match(h, /<p class="rv-dim rr-lab rr-actlab">This room<\/p><div class="rr-acts rr-asking"[^>]*><p class="rv-dim rr-asktext">Rerolling clears 1 mark\.<\/p>/, 'the question has a line of its own');
  assert.ok(!/Roll another/.test(h), 'Roll another waits while it asks'); assert.ok(btnOf(h, 'reroll-yes') && btnOf(h, 'reroll-no') && !btnOf(h, 'reroll'), 'a confirm and a Cancel in place of the button');
  assert.match(h, /data-rr-act="reroll-yes"[\s\S]*?Reroll the room[\s\S]*?data-rr-act="reroll-no"[\s\S]*?Cancel/);
  assert.equal(sw.act(elOf('reroll-no', BAR)), 'reroll'); assert.equal(JSON.stringify(d.doc.roomstate.keys), snap, 'Cancel leaves the room as it was');
  assert.ok(btnOf(sw.html(cardOf(p, BAR), {}), 'reroll') && !/rr-ask/.test(sw.html(cardOf(p, BAR), {})), 'the ask is gone');
  sw.act(elOf('reroll', BAR)); assert.equal(sw.act(elOf('reroll-yes', BAR)), 'reroll');
  const room = stored(d, BAR);
  assert.equal(room.rr, 2); assert.ok(!room.marks && !room.extra && !room.swaps, 'marks, extras and swaps went with the old draw');
  assert.deepEqual(cardOf(p, BAR).people, first.people);
  assert.ok(!/rr-ask/.test(sw.html(cardOf(p, BAR), {})), 'no ask left after it');
  /* the ask is per room: another room's marks do not ask for this one */
  assert.equal(d.rs.setMark(String(SEED), CLOAK, slugsOf(p, CLOAK)[0], 'found'), true);
  const was = stored(d, BAR).rr; assert.equal(sw.act(elOf('reroll', BAR)), 'reroll'); assert.equal(stored(d, BAR).rr, was + 1, 'the bar had no mark: no ask');
  assert.equal(sw.act(elOf('reroll', CLOAK)), 'reroll-yes', 'the cloakroom has one: it asks');
});

test('a reroll keeps what a Keep filed, and only overrides are stored: never a line of the table', () => {
  const s = newServer(), d = device(s), p = page(d);
  assert.equal(d.rs.addKept(String(SEED), BAR, 'npc-1', 'p1'), true);
  const sw = swapper(p, d);
  sw.act(elOf('another', BAR)); sw.act(elOf('reroll', BAR));
  tap(p, d, BAR, slugsOf(p, BAR)[0]);
  assert.deepEqual(Object.keys(stored(d, BAR).kept), ['npc-1'], 'kept stays');
  const json = JSON.stringify(d.doc.roomstate);
  assert.deepEqual(TEXTS.filter((x) => json.includes(x)), [], 'no table text anywhere in the stored state'); assert.ok(!/GM-ONLY/.test(json));
});

test('GM-side only, and no document listener: this file sends, stores and draws nothing of its own, and only the rolled instance and the zoom card name it', () => {
  const src = read(FILE), code = src.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/fetch\(|XMLHttpRequest|localStorage|sessionStorage|addEventListener|document\b|B68GmEsc|keydown|Math\.random|innerHTML|setTimeout/.test(code), 'no request, storage, listener, Esc, key or random');
  assert.ok(!/\.(setMark|setSay|setBlade|addKept|clear|clearRoll|prune)\(/.test(code), 'it writes only setSwap, setExtra, addExtra and reroll');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const files = walk(path.join(ROOT, 'app')).concat(walk(path.join(ROOT, 'functions'))).filter((f) => /\.(js|mjs|html)$/.test(f)).map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
  assert.deepEqual(files.filter((f) => /B68GmRoomSwap|room-swap/.test(read(f))).sort(), ['app/gm/room-rolled.js', 'app/gm/room-swap.js', 'app/gm/room-zoom.js', 'app/routes.js'].sort());
  assert.ok(!/RoomSwap|room-swap/.test(read('app/gm-page.js')), 'gm-page.js is not touched by this bundle');
  assert.ok(!/RoomSwap|rr-act/.test(read('app/display-page.js') + read('app/tracker.js')), 'nothing on the display or a phone');
});

test('ES5 and small literals: no arrow, let, const or template literal; no string literal over 220 characters; no C1 characters', () => {
  for (const f of [FILE, 'app/gm/room-rolled.js']) {
    const src = read(f), code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((l) => l.replace(/\/\/.*$/, '')).join('\n');
    assert.ok(!/=>|\blet\b|\bconst\b|`/.test(code.replace(/'[^'\n]*'|"[^"\n]*"/g, "''")), f + ': ES5');
    assert.ok(src.split('\n').every((l) => !/(['"])(?:(?!\1).){221,}\1/.test(l)), f + ': no literal over 220 characters');
    assert.ok(!/[\u0080-\u009f]/.test(src), f + ': no C1 characters');
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
