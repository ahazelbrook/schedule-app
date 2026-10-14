// Unit test for the GM page's logic (app/gm-page.js, its pure helpers under Node; no browser): what may reach the iPad,
// replaying a console card exactly, and saving the GM state. Invented fixtures, except two sweeps over the real pack
// (gm-private/, git-ignored) that run only when it is on this machine and print nothing from it.
//   node checks/runtime/gm-page.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const P = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
const C = require(path.join(ROOT, 'app', 'gm', 'console.js'));
const L = require(path.join(ROOT, 'app', 'gm', 'location.js'));
const M = require(path.join(ROOT, 'app', 'maps', 'map-kit.js'));
const { checkSvg } = await import(pathToFileURL(path.join(ROOT, 'functions', '_lib', 'gm.js')).href);

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
const tick = () => new Promise((r) => setImmediate(r));
const PACK_PATH = path.join(ROOT, 'gm-private', 'b68-gm-pack.json');
const REAL = fs.existsSync(PACK_PATH) ? JSON.parse(fs.readFileSync(PACK_PATH, 'utf8')) : null;

/* ---------- 1. a player map that names a hidden room never reaches the display ---------- */
/* An invented roll where the hidden target room is the only room on its level, so the kit titles the plan and section
   level after it (the kit bug the real pack hits in about a quarter of rolls). */
const LEAKY = { name: 'Invented Works', district: 'Nowhere', target: 'Apartment building', targetRoom: 'Basement', targetBand: 'secure',
  rooms: [{ name: 'Lobby', band: 'public' }, { name: 'Reception', band: 'public' }, { name: 'Break room', band: 'working' },
    { name: 'Filing room', band: 'working' }, { name: 'Server room', band: 'controlled' }, { name: 'Basement', band: 'secure', isTarget: true }],
  vectors: [], skips: [] };
const render = M.render.bind(M);

await test('1. invented roll: plan and section name the hidden "Basement" level and are refused; rings and iso go', () => {
  for (const view of ['plan', 'section']) {
    let err = null; try { P.playerDisplay(LEAKY, { layer: 'player', view, theme: 'casefile', reveal: { public: true } }, render); } catch (e) { err = e; }
    assert.ok(err && err.leak === true && err.message === P.LEAK_MSG, view + ': not refused (' + (err && err.message) + ')');
    assert.deepEqual(P.leaks(render(LEAKY, { view, layer: 'player', reveal: ['public'] }).svg, LEAKY, ['public']), ['basement'], view + ' leak list');
  }
  for (const view of ['rings', 'iso']) {
    const d = P.playerDisplay(LEAKY, { layer: 'player', view, reveal: { public: true } }, render);
    assert.equal(d.kind, 'svg'); assert.deepEqual(P.leaks(d.svg, LEAKY, ['public']), [], view);
  }
  // revealing the band makes the name fair game
  assert.equal(P.playerDisplay(LEAKY, { layer: 'player', view: 'plan', reveal: { public: true, working: true, controlled: true, secure: true } }, render).kind, 'svg');
});

await test('1. the leak scan: entities decoded, names split over tspans joined, whole words, case-insensitive; revealed names are not secrets', () => {
  const roll = { rooms: [{ name: 'Lobby', band: 'public' }, { name: 'Vault & Safe', band: 'secure' }, { name: 'Den', band: 'working' }, { name: 'Lobby', band: 'secure' }], physThreatName: 'Guard dogs', socThreatName: 'A nosy clerk', targetRoom: 'Vault & Safe', targetBand: 'secure' };
  assert.deepEqual(P.hiddenNames(roll, ['public']).sort(), ['a nosy clerk', 'den', 'guard dogs', 'vault & safe']);
  assert.deepEqual(P.leaks('<svg><text>VAULT &amp; <tspan>SAFE</tspan></text></svg>', roll, ['public']), ['vault & safe']);
  assert.deepEqual(P.leaks('<svg><text>Garden</text><text>Lobby</text></svg>', roll, ['public']), [], 'Den inside Garden is not a word; Lobby is also public');
  assert.deepEqual(P.leaks('<svg><text>guard&#32;dogs</text></svg>', roll, ['public']), ['guard dogs'], 'threats count');
});

await test('1. real pack (skipped without it): 300 rolls × 4 views; every svg that passes the gate names nothing hidden and passes checkSvg', () => {
  if (!REAL) { console.log('     skipped: no gm-private/b68-gm-pack.json'); return; }
  const pk = REAL.parts.location; let passedGate = 0, refused = 0;
  for (let i = 0; i < 300; i++) {
    const roll = L.generate(pk, {}, { seed: (Math.imul(i + 1, 2654435761) >>> 0), mem: {} });
    for (const view of ['rings', 'plan', 'iso', 'section']) {
      let d = null; try { d = P.playerDisplay(roll, { layer: 'player', view, theme: ['rulebook', 'blueprint', 'casefile', 'board'][i % 4], reveal: { public: true } }, render); } catch (e) { if (!e.leak) throw e; refused++; continue; }
      passedGate++;
      // an independent check: the raw svg, entities decoded, lower case, must not hold any hidden room name as a word
      const raw = d.svg.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
      for (const r of roll.rooms) if (r.band !== 'public' && !roll.rooms.some((x) => x.band === 'public' && x.name === r.name)) {
        const n = r.name.toLowerCase(), at = (' ' + raw + ' ').search(new RegExp('[^a-z0-9]' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^a-z0-9]'));
        assert.ok(at < 0, 'roll ' + i + ' ' + view + ': a hidden room name passed the gate');
      }
      checkSvg(d.svg);
    }
  }
  console.log('     ' + passedGate + ' passed the gate, ' + refused + ' refused');
  assert.ok(passedGate > 600, 'too few passed: ' + passedGate);
});

/* ---------- 2. reveal: public unless Layer is Player; plain text for the text display ---------- */
await test('2. revealList: ticks count only on the player layer; public is always in; the reset state is public only', () => {
  const ticks = { public: true, working: true, secure: true };
  assert.deepEqual(P.revealList({ layer: 'gm', reveal: ticks }), ['public']);
  assert.deepEqual(P.revealList({ layer: 'player', reveal: ticks }), ['public', 'working', 'secure']);
  assert.deepEqual(P.revealList({ layer: 'player', reveal: {} }), ['public']);
  assert.deepEqual(P.revealList(null), ['public']);
  assert.deepEqual(P.REVEAL0, { public: true, working: false, controlled: false, secure: false });
});
await test('7c. the street description goes to the iPad as plain text (no markdown markers)', () => {
  const md = '# Invented Works\n*Nowhere · Night, rain · Fixture Lane*\n\nYou come at it down a **wide** road.\n- The front: a `door`\n> [[Somebody|a name]] and [a link](http://x)';
  const t = P.plainText(md);
  assert.equal(t, 'Invented Works\nNowhere · Night, rain · Fixture Lane\n\nYou come at it down a wide road.\n• The front: a door\na name and a link');
  if (REAL) {
    const roll = L.generate(REAL.parts.location, {}, { seed: 99, mem: {} });
    const s = P.plainText(L.playerSummary(roll, ['public']).text);
    assert.ok(!/(^|\s)#{1,6}\s|\*\*|(^|[\s(])\*[^\s*]|`|\[\[/.test(s), 'markers left in a real street description');
  }
});

/* ---------- 3. a console card replays exactly after a card action ---------- */
await test('3. roll a callback, mark it used, replay the earlier entry: the identical card (the old replay would differ)', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'console-pack.json'), 'utf8')).parts;
  const T = fx.console.T, camp = fx.campaign;
  let state = {}, found = 0;
  for (let seed = 1; seed < 400 && found < 3; seed++) {
    const con = C.create({ T, campaign: camp, state, mem: {} });
    const res = con.roll('callback', con.defaults(), { seed, mem: {} });
    const act = (res.meta.actions || []).find((a) => a.intent && a.intent.type === 'callbackUsed');
    if (!act) continue;
    const entry = P.consoleEntry(res, state);
    const after = C.applyIntent(state, act.intent);
    const again = P.replayConsoleEntry(C, T, camp, entry, after);
    assert.deepEqual(again.lines, res.lines, 'seed ' + seed + ': the replayed card differs');
    assert.deepEqual(again.meta.actions, res.meta.actions);
    // without the snapshot (the old behaviour) the used callback is gone, so the card changes
    const old = Object.assign({}, entry); delete old.con;
    const drift = P.replayConsoleEntry(C, T, camp, old, after);
    if (JSON.stringify(drift.lines) !== JSON.stringify(res.lines)) found++;
    state = after;
  }
  assert.ok(found > 0, 'no seed showed the drift the snapshot fixes');
});

/* ---------- 4. saving the GM state ---------- */
function harness({ fail } = {}) {
  const sent = [], timers = new Map(); let id = 0, gate = null;
  const o = {
    debounce: 800,
    delay: (fn, ms) => { const h = ++id; timers.set(h, { fn, ms }); return h; }, cancel: (h) => timers.delete(h),
    send: (p) => { sent.push(p); const f = fail && fail(p, sent.length); if (f) return Promise.reject(f); return gate ? gate.then(() => ({ doc: {}, updatedAt: 't' + sent.length })) : Promise.resolve({ doc: {}, updatedAt: 't' + sent.length }); },
    beacon: (p) => { sent.push({ beacon: p }); return Promise.resolve({ doc: {}, updatedAt: 'b' }); },
  };
  const s = P.makeSaver(o);
  return { s, sent, timers, hold() { let r; gate = new Promise((x) => { r = x; }); return () => { gate = null; r(); }; }, fire() { const t = [...timers.entries()]; timers.clear(); t.forEach(([, v]) => v.fn()); } };
}
await test('4a. close while a write is in flight: what was added meanwhile still goes when it lands', async () => {
  const h = harness(); const release = h.hold();
  h.s.add({ a: 1 }); h.s.flush();
  h.s.add({ b: 2 });                         // added during the write
  h.s.flush();                               // close() calls this; the write is in flight, so it waits
  await tick();
  assert.equal(h.sent.length, 1);
  release(); await tick(); await tick(); await tick();
  assert.deepEqual(h.sent, [{ a: 1 }, { b: 2 }]);
  assert.equal(h.s.state().pending, null);
});
await test('4a. pagehide: beacon sends the pending patch at once (keepalive), even with a write in flight', async () => {
  const h = harness(); const release = h.hold();
  h.s.add({ a: 1 }); h.s.flush(); h.s.add({ b: 2 });
  await h.s.beacon();
  assert.deepEqual(h.sent, [{ a: 1 }, { beacon: { b: 2 } }]);
  release(); await tick(); await tick();
  assert.equal(h.sent.length, 2, 'nothing sent twice');
});
await test('4b. a 400 is parked (shown, kept, never resent) and later patches still save; 409, 429, 5xx and the network retry', async () => {
  const bad = Object.assign(new Error('capture must be an object'), { status: 400 });
  const h = harness({ fail: (p) => (p.bad ? bad : null) });
  h.s.add({ bad: 1 }); await h.s.flush(); await tick();
  assert.deepEqual(h.s.state().parked, { bad: 1 }); assert.match(h.s.state().error, /capture must be/);
  h.s.add({ good: 1 }); await h.s.flush(); await tick();
  assert.deepEqual(h.sent, [{ bad: 1 }, { good: 1 }], 'the refused patch was not resent with the next one');
  assert.equal(h.timers.size, 0, 'no retry scheduled for a 400');
  for (const status of [409, 429, 503, undefined]) {
    let n = 0; const g = harness({ fail: () => (++n === 1 ? Object.assign(new Error('x'), { status, network: status === undefined }) : null) });
    g.s.add({ k: status || 0 }); await g.s.flush(); await tick();
    assert.equal(g.s.state().error, 'retrying', status + ': not retrying');
    assert.equal(g.timers.size, 1); assert.equal([...g.timers.values()][0].ms, 2500, 'backoff');
    g.fire(); await tick(); await tick();
    assert.equal(g.sent.length, 2, status + ': retried once'); assert.equal(g.s.state().error, '');
  }
});
await test('4c. sizes are bytes (UTF-8), not characters', () => {
  assert.equal(P.bytes('’’'), 6, 'two curly quotes are six bytes');
  assert.equal(P.bytes({ a: 'é' }), '{"a":""}'.length + 2);
  assert.ok(P.LIMITS.stateSoft < P.LIMITS.stateCap);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
