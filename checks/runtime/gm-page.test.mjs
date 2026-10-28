// Unit test for the GM page (app/gm-page.js; no browser): its pure helpers (what may reach the iPad, replaying a console card
// exactly, saving the GM state, the Situations cards, the session on a capture) and the page itself on a small fake DOM (the
// the four Situations (the single tables folded under the card), the Position switch, replay after a reload, capture, the display-name editor). Invented fixtures, except two sweeps over the real pack
// (gm-private/, git-ignored) that run only when it is on this machine and print nothing from it.
//   node checks/runtime/gm-page.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import vm from 'node:vm';

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

await test('1. invented roll: every view of the kit (0.5+: floors titled generically) goes; a render that prints a hidden room\'s own name is refused; a hidden room called like a floor is not a secret', () => {
  for (const view of ['plan', 'section', 'rings', 'iso']) {
    const d = P.playerDisplay(LEAKY, { layer: 'player', view, theme: 'casefile', reveal: { public: true } }, render);
    assert.equal(d.kind, 'svg'); assert.deepEqual(P.leaks(d.svg, LEAKY, ['public']), [], view);
    assert.ok(!d.svg.toLowerCase().includes('server room'), view + ': the hidden room name is on the svg sent to the iPad');
  }
  assert.deepEqual(P.hiddenNames(LEAKY, ['public']).sort(), ['break room', 'filing room', 'server room'], 'the kit\'s floor title "Basement" is not counted');
  /* a kit that titled a level after the hidden room (0.2 did, on plan and section) is refused */
  const named = (roll, o) => { const r = render(roll, o); return Object.assign({}, r, { svg: r.svg.replace('</svg>', '<text>SERVER ROOM</text></svg>') }); };
  for (const view of ['plan', 'section']) {
    let err = null; try { P.playerDisplay(LEAKY, { layer: 'player', view, reveal: { public: true } }, named); } catch (e) { err = e; }
    assert.ok(err && err.leak === true && err.message === P.LEAK_MSG, view + ': not refused (' + (err && err.message) + ')');
  }
  // a leaking iso is redrawn as rings; if the rings leak too it is refused
  const seen = []; const isoLeaks = (roll, o) => { seen.push(o.view); return o.view === 'iso' ? { svg: '<svg><text>Server room</text></svg>' } : render(roll, o); };
  const fb = P.playerDisplay(LEAKY, { layer: 'player', view: 'iso', reveal: { public: true } }, isoLeaks);
  assert.deepEqual(seen, ['iso', 'rings']); assert.deepEqual(P.leaks(fb.svg, LEAKY, ['public']), []);
  assert.throws(() => P.playerDisplay(LEAKY, { layer: 'player', view: 'iso', reveal: { public: true } }, () => ({ svg: '<svg><text>Server room</text></svg>' })), (e) => e.leak === true);
  // revealing the band makes the name fair game
  assert.equal(P.playerDisplay(LEAKY, { layer: 'player', view: 'plan', reveal: { public: true, working: true, controlled: true, secure: true } }, named).kind, 'svg');
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
      for (const r of roll.rooms) if (r.band !== 'public' && !roll.rooms.some((x) => x.band === 'public' && x.name === r.name) && !P.LEVEL_TITLES.includes(r.name.toLowerCase())) {   // a hidden room called like a floor is not a secret: the kit titles that floor itself
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

/* =====================================================================================================================
   5. Situations (phase 2): the pure parts
   ===================================================================================================================== */
const FIXC = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'console-pack.json'), 'utf8')).parts;
const FIXS = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'scenes-pack.json'), 'utf8'));
const SC = require(path.join(ROOT, 'app', 'gm', 'scenes.js')), SCM = require(path.join(ROOT, 'app', 'gm', 'score.js'));
const SCFIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'score-pack.json'), 'utf8')).parts;
const DT = require(path.join(ROOT, 'app', 'gm', 'downtime.js'));
const CH = require(path.join(ROOT, 'app', 'gm', 'chase.js'));
/* the map kit with a chase strip: its own (0.6), or the checks' stand-in written from the kit's spec (it installs only on a kit without one) */
const MCH = require(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'chase-kit-stub.js'))(Object.assign({}, require(path.join(ROOT, 'app', 'maps', 'map-kit.js'))));
const DTT = require(path.join(ROOT, 'app', 'downtime-tables.js'));      /* the built-in tables (B68DowntimeTables), loaded before the module */
const dtMk = (cfg) => DT.create(Object.assign({ T: DTT.T, places: DTT.PLACES }, cfg || {}));
const CTBOX = {}; CTBOX.window = CTBOX; vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'app', 'content.js'), 'utf8'), CTBOX);
const CT = CTBOX.B68Content;        /* the book's vices and purveyors (public: every player loads content.js), as the page passes them */
const FIXL = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'location-pack.json'), 'utf8'));
const mdPlain = (s) => '<p>' + String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>';   // the page passes B68Markdown here
const count = (s, re) => (s.match(re) || []).length;

await test('5a. one console: no Classic view, no view preference, no release switch, no layout preference', () => {
  assert.equal(P.conView, undefined); assert.equal(P.SITUATIONS_DEFAULT, undefined); assert.equal(P.VIEW_KEY, undefined);
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  assert.ok(!/b68\.gm\.view|b68\.gm\.layout|SITUATIONS_DEFAULT|data-view|layout-classic|layout-app/.test(src), 'nothing of the old switches is left in the page');
});

await test('5b. keyAction: 1-4 are situations, 5-9 do nothing (the single tables have no keys); typing and modifiers stay quiet', () => {
  for (let n = 1; n <= 4; n++) { assert.deepEqual(P.keyAction({ key: String(n) }), { type: 'situation', n }); assert.deepEqual(P.keyAction({ key: String(n), view: 'classic' }), { type: 'situation', n }, 'a view is not a thing any more'); }
  for (let n = 5; n <= 9; n++) assert.equal(P.keyAction({ key: String(n) }), null);
  assert.equal(P.keyAction({ key: '2', typing: true }), null);
  assert.equal(P.keyAction({ key: '2', ctrlKey: true }), null);
  assert.equal(P.keyAction({ key: '2', metaKey: true }), null);
  assert.deepEqual(P.keyAction({ key: 'l' }), { type: 'last' });
  assert.deepEqual(P.keyAction({ key: 'p' }), { type: 'capture', bucket: 'n' });
});

await test('5c. sessionOf / captureEntry: the session number goes on the entry when the campaign has one (numbers only), else the entry is as before', () => {
  assert.equal(P.sessionOf({ session: { number: 7 } }), 7);
  assert.equal(P.sessionOf({ session: { number: '3' } }), 3);
  for (const bad of [null, {}, { session: {} }, { session: { number: 0 } }, { session: { number: -2 } }, { session: { number: 'x' } }, { session: { number: 1e9 } }, { session: 5 }]) assert.equal(P.sessionOf(bad), undefined, JSON.stringify(bad));
  assert.deepEqual(P.captureEntry('c1', 'n', 'A name', 't', { session: { number: 4 } }), { id: 'c1', bucket: 'n', text: 'A name', at: 't', s: 4 });
  assert.deepEqual(P.captureEntry('c1', 'n', 'A name', 't', {}), { id: 'c1', bucket: 'n', text: 'A name', at: 't' });
  assert.ok(!('s' in P.captureEntry('c1', 'x', 'x', 't', null)));
});

await test('5d. a composed card: ONE lead box, at most three "Or" rows, ONE merged actions row; section text is escaped', () => {
  const con = C.create({ T: FIXC.console.T, campaign: FIXC.campaign, mem: {} });
  for (let n = 1; n <= 4; n++) for (const pos of ['controlled', 'risky', 'desperate']) for (const npc of ['', 'rival:Nigel Sprocket']) {
    const res = con.situation(n, Object.assign(con.situationDefaults(), { pos, npc }), { seed: 100 + n });
    const h = P.situationCardHtml(res, mdPlain);
    assert.equal(count(h, /class="gm-lead"/g), 1, 'one lead');
    assert.ok(count(h, /<details class="gm-or"/g) <= 3 && count(h, /<details class="gm-or"/g) === Math.min(3, res.sections.length - 1), 'Or rows');
    assert.equal(count(h, /class="gm-card-acts"/g), 1, 'one actions row');
    assert.equal(count(h, /data-gm="intent"/g), res.meta.actions.length, 'every merged action is a button');
    assert.ok(h.includes('data-tool="situation"') && !h.includes('data-tool="console"'), 'filed under situation');
    assert.ok(h.includes(P.esc(res.sections[0].lead)), 'the lead line is shown');
    assert.ok(!/undefined|NaN|\[object/.test(h));
  }
  const evil = { meta: { id: 'situation', situation: 'before', n: 1, title: '<b>T</b>', sub: 'x', actions: [{ label: '<i>a</i>', intent: {} }] }, lines: [], sections: [{ id: 'x', role: 'lead', title: '<u>', lead: '<script>1</script>', chips: ['<c>'], lines: [{ kind: 'want', md: 'm' }], actions: [] }] };
  const e = P.situationCardHtml(evil, mdPlain);
  assert.ok(!/<script|<b>T|<i>a|<u>|<c>/.test(e), 'no raw html from a card');
  assert.ok(P.classicCardHtml(con.roll('face', con.defaults(), { seed: 5 }), mdPlain).includes('data-tool="console"'));
});

await test('5e. a situation entry is filed under id "situation" (never "console"); replay redraws the identical card, also after a callback was used', () => {
  const con = C.create({ T: FIXC.console.T, campaign: FIXC.campaign, state: {}, mem: {} });
  let found = 0;
  for (let seed = 1; seed < 300 && found < 3; seed++) {
    const res = con.situation(2, Object.assign(con.situationDefaults(), { pos: 'desperate' }), { seed });
    const entry = P.situationEntry(res, {});
    assert.equal(entry.id, 'situation'); assert.equal(entry.situation, 'fourfive'); assert.notEqual(entry.id, 'console');
    assert.ok(typeof entry.mem === 'string' && entry.at && !('lines' in entry) && !('sections' in entry), 'replay info only');
    const act = res.meta.actions.find((a) => a.intent.type === 'callbackUsed'); if (!act) continue;
    const after = C.applyIntent({}, act.intent);
    const again = P.replaySituationEntry(C, FIXC.console.T, FIXC.campaign, entry, after);
    assert.equal(JSON.stringify(again.sections.map((s) => [s.id, s.lead, s.lines])), JSON.stringify(res.sections.map((s) => [s.id, s.lead, s.lines])), 'seed ' + seed);
    assert.equal(JSON.stringify(again.meta.actions), JSON.stringify(res.meta.actions));
    found++;
  }
  assert.ok(found > 0);
  assert.equal(P.replaySituationEntry(C, FIXC.console.T, FIXC.campaign, { id: 'console', seed: 1 }, {}), null, 'a classic entry is not replayed as a situation');
});

await test('5f. situationPlain / lastText: plain text for Copy, Pin and L', () => {
  const con = C.create({ T: FIXC.console.T, campaign: FIXC.campaign, mem: {} });
  const res = con.situation(3, con.situationDefaults(), { seed: 11 });
  const t = P.situationPlain(res);
  assert.ok(t.startsWith('A 1–3 (') && /\nOr Pay the price: /.test(t) && !/\*\*|\[\[/.test(t), t);
  assert.equal(P.lastText(res), 'A 1–3 (risky): ' + res.sections[0].lead, 'the Position the card was drawn under, in brackets');
  const withPc = con.situation(3, { ...con.situationDefaults(), pos: 'desperate', pc: 'Pip Wobble' }, { seed: 11 });
  assert.equal(P.lastText(withPc), 'A 1–3 (desperate, Pip Wobble): ' + withPc.sections[0].lead, 'the selected PC follows the Position');
  assert.equal(P.lastText(withPc, 2), 'A 1–3 (desperate, 2d, Pip Wobble): ' + withPc.sections[0].lead, 'dots sit between the Position and the PC');
  assert.equal(P.lastText(res, 0), 'A 1–3 (risky, 0d): ' + res.sections[0].lead, 'zero shows as 0d');
  assert.equal(P.lastText(res, null), P.lastText(res), 'unset adds nothing');
  const before = con.situation(1, con.situationDefaults(), { seed: 11 });
  assert.equal(P.lastText(before, 3), 'Before the roll: ' + before.sections[0].lead, 'dots never go on a Before card');
  assert.equal(P.lastText(before), 'Before the roll: ' + before.sections[0].lead, 'a Before card keeps the plain line');
  const cl = con.roll('face', con.defaults(), { seed: 3 });
  assert.equal(P.lastText(cl), cl.meta.title + ': ' + P.plainMd(cl.meta.text), 'a classic roll reads as before');
});

/* =====================================================================================================================
   6. The page itself, on a small fake DOM (no browser): views, the toggle, the position switch, replay, capture, name edit
   ===================================================================================================================== */
const VOID = new Set(['input', 'br', 'img', 'hr', 'meta', 'link']);
const decodeEnt = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|#39|apos);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()]));
function parseSel(sel) {
  return sel.split(',').map((part) => part.trim().split(/\s+/).map((c) => {
    const o = { tag: null, id: null, cls: [], attrs: [] }; let m;
    const re = /^([a-z][a-z0-9-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]/i; let rest = c;
    while (rest && (m = re.exec(rest))) { if (m[1]) o.tag = m[1].toUpperCase(); else if (m[2]) o.id = m[2]; else if (m[3]) o.cls.push(m[3]); else o.attrs.push([m[4], m[5]]); rest = rest.slice(m[0].length); }
    return o;
  }));
}
class FEl {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.nodeType = 1; this.doc = doc; this.attrs = new Map(); this.kids = []; this.parentNode = null; this.ls = {}; this.hidden = false; this._v = undefined; this.checked = false; this.disabled = false; this.dataset = {}; }
  get id() { return this.attrs.get('id') || ''; } set id(v) { this.attrs.set('id', String(v)); }
  get className() { return this.attrs.get('class') || ''; } set className(v) { this.attrs.set('class', String(v)); }
  get value() { return this._v !== undefined ? this._v : (this.attrs.get('value') || ''); } set value(v) { this._v = String(v); }
  set placeholder(v) { this.attrs.set('placeholder', String(v)); } get placeholder() { return this.attrs.get('placeholder') || ''; }
  get children() { return this.kids.filter((k) => k.nodeType === 1); } get childElementCount() { return this.children.length; }
  get type() { return this.attrs.get('type') || ''; } get isContentEditable() { return false; }
  get classList() { const el = this; const set = () => new Set(el.className.split(/\s+/).filter(Boolean)); return { contains: (c) => set().has(c), add: (c) => { const s = set(); s.add(c); el.className = [...s].join(' '); }, remove: (c) => { const s = set(); s.delete(c); el.className = [...s].join(' '); }, toggle: (c, on) => { const s = set(); const want = on === undefined ? !s.has(c) : !!on; if (want) s.add(c); else s.delete(c); el.className = [...s].join(' '); } }; }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; } setAttribute(k, v) { this.attrs.set(k, String(v)); } hasAttribute(k) { return this.attrs.has(k); } removeAttribute(k) { this.attrs.delete(k); }
  addEventListener(t, fn) { (this.ls[t] = this.ls[t] || []).push(fn); }
  get textContent() { return this.kids.map((k) => (k.nodeType === 3 ? k.text : k.textContent)).join(''); } set textContent(v) { this.kids = [{ nodeType: 3, text: String(v) }]; }
  set innerHTML(h) { this.kids = []; this._html = String(h); parseInto(this, String(h), this.doc); } get innerHTML() { return this._html || ''; }
  appendChild(n) { n.parentNode = this; this.kids.push(n); return n; } removeChild(n) { this.kids = this.kids.filter((k) => k !== n); n.parentNode = null; return n; }
  contains(n) { for (let p = n; p; p = p.parentNode) if (p === this) return true; return false; }
  closest(sel) { const alts = parseSel(sel); for (let p = this; p && p.nodeType === 1; p = p.parentNode) if (alts.some((a) => a.length === 1 && matches(p, a[0]))) return p; return null; }
  querySelectorAll(sel) { const alts = parseSel(sel), out = []; const walk = (n) => { for (const k of n.kids) if (k.nodeType === 1) { if (alts.some((a) => matchPath(k, a, this))) out.push(k); walk(k); } }; walk(this); return out; }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  focus() { this.doc.activeElement = this; } blur() { if (this.doc.activeElement === this) this.doc.activeElement = this.doc.body; }
  getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; }     /* no layout here: the outline spy and showCard see everything at 0 */
  click() { dispatch(this, 'click'); }
}
function matches(el, c) {
  if (c.tag && el.tagName !== c.tag) return false; if (c.id && el.id !== c.id) return false;
  const cl = el.className.split(/\s+/); if (c.cls.some((x) => !cl.includes(x))) return false;
  return c.attrs.every(([k, v]) => el.hasAttribute(k) && (v === undefined || el.getAttribute(k) === v));
}
function matchPath(el, path, scope) {
  if (!matches(el, path[path.length - 1])) return false;
  let i = path.length - 2, p = el.parentNode;
  while (i >= 0) { while (p && p !== scope && !matches(p, path[i])) p = p.parentNode; if (!p || p === scope) return false; i--; p = p.parentNode; }
  return true;
}
function parseInto(root, html, doc) {
  const re = /<!--[\s\S]*?-->|<\/([a-z0-9-]+)\s*>|<([a-z][a-z0-9-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)|</gi; let m; const stack = [root];
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[5] !== undefined) { top.kids.push({ nodeType: 3, text: decodeEnt(m[5]), parentNode: top }); continue; }
    if (m[1]) { for (let i = stack.length - 1; i > 0; i--) if (stack[i].tagName.toLowerCase() === m[1].toLowerCase()) { stack.length = i; break; } continue; }
    if (m[2]) {
      const el = new FEl(m[2], doc); el.parentNode = top; top.kids.push(el);
      for (const a of m[3].matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) el.attrs.set(a[1], decodeEnt(a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : ''));
      if (!VOID.has(m[2].toLowerCase()) && !m[4]) stack.push(el);
    }
  }
}
function dispatch(target, type, extra) {
  const ev = Object.assign({ type, target, preventDefault() {}, stopPropagation() {}, ctrlKey: false, altKey: false, metaKey: false }, extra || {});
  for (let n = target; n; n = n.parentNode) for (const fn of (n.ls && n.ls[type]) || []) fn(ev);
  return ev;
}
function fakeBrowser(over) {
  const doc = { listeners: {}, activeElement: null, hidden: false, createElement: (t) => new FEl(t, doc), addEventListener(t, fn) { (doc.listeners[t] = doc.listeners[t] || []).push(fn); },
    querySelector: () => null, querySelectorAll: () => [] };
  doc.body = new FEl('body', doc); doc.body.dataset.mode = 'gm'; doc.activeElement = doc.body;
  const ls = new Map(), toasts = [];
  const W = { document: doc, localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => { ls.set(k, String(v)); }, removeItem: (k) => { ls.delete(k); } },
    matchMedia: () => ({ matches: false }), addEventListener() {}, confirm: () => true, open() {}, B68: { toast: (m, bad) => toasts.push([m, !!bad]) },
    B68GmConsole: C, B68GmLocation: L, B68GmScenes: SC, B68GmScore: SCM, B68GmDowntime: DT, B68DowntimeTables: DTT, B68GmChase: CH, B68Content: CT, setTimeout, clearTimeout, console };
  W.self = W; Object.assign(W, over || {});
  return { W, doc, ls, toasts };
}
function loadPage(W) {
  const ctx = vm.createContext(W);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8'), ctx, { filename: 'gm-page.js' });
  return W.B68GmPage;
}
/* a fake server for the GM state: the real merge, one document */
function fakeGm(camp, extra) {
  const server = { doc: {}, at: 0, patches: [], displays: [] };
  const parts = { console: { version: 'c1', src: {}, body: FIXC.console }, campaign: { version: 'k1', src: FIXC.campaign.src || {}, body: camp || FIXC.campaign }, location: { version: 'l1', src: {}, body: { T: FIXL.T, extra: FIXL.extra } },
    scenes: { version: 's1', src: {}, body: { T: FIXS.parts.scenes.T } }, score: { version: 'sc1', src: {}, body: { T: SCFIX.score.T } } };
  Object.assign(parts, extra || {});      /* more pack parts for one test (screen, npc), or a replacement of one */
  const gm = {
    pack: async () => ({ version: 'v1', parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, { version: v.version }])) }),
    packPart: async (n) => ({ part: n, version: parts[n].version, src: parts[n].src, body: parts[n].body }),
    state: async () => ({ doc: JSON.parse(JSON.stringify(server.doc)), updatedAt: 't' + server.at }),
    patchState: async (p) => { server.patches.push(p); server.doc = P.applyPatch(server.doc, p); server.at++; return { doc: JSON.parse(JSON.stringify(server.doc)), updatedAt: 't' + server.at }; },
    display: async () => ({ seq: 0 }), setDisplay: async (d) => { server.displays.push(d); return { seq: 1 }; },
  };
  return { gm, server };
}
const until = async (fn, n = 200) => { for (let i = 0; i < n; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 5)); } return null; };
async function openPage({ br, fg, camp, over, api } = {}) {
  br = br || fakeBrowser(over); fg = fg || fakeGm(); br.W.claude = { gm: fg.gm };
  const page = loadPage(br.W); const root = br.doc.createElement('div'); br.doc.body.appendChild(root);
  const cd = { current: camp === undefined ? { session: { number: 3 }, crew: {} } : camp };
  page.open(root, Object.assign({ ready: async () => {}, isGM: () => true, me: () => 'gm1', gm: () => fg.gm, db: () => null, campaign: () => cd.current, saveFile() {}, copy(t) { br.copied = t; } }, api || {}));   /* api: more of boot's api for one test (characters, addClock) */
  const ok = await until(() => page._state() && page._state().status === 'ready' && root.querySelector('#gm-root'));
  assert.ok(ok, 'the page did not open: ' + JSON.stringify(page._state()) + ' ' + root.textContent.slice(0, 200));
  return { page, root, br, fg, press: (k, extra) => { for (const fn of br.doc.listeners.keydown || []) fn(Object.assign({ key: k, target: br.doc.body, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} }, extra || {})); },
    q: (s) => root.querySelector(s), qa: (s) => root.querySelectorAll(s), cd,
    save: async () => { await page.close(); await new Promise((r) => setTimeout(r, 20)); } };
}
const cardTxt = (h) => (h.q('#gm-card').textContent || '').replace(/\s+/g, ' ').trim();

await test('6a. the console is the four Situations: a big Position switch, the single tables folded under the card, no Result control, no toggle', async () => {
  const h = await openPage();
  assert.ok(!h.q('#gm-root').hasAttribute('data-view'), 'one console: no view attribute');
  const btns = h.qa('#gm-buttons .gm-btn'); assert.equal(btns.length, 4);
  assert.deepEqual(btns.map((b) => b.getAttribute('data-sit')), ['before', 'fourfive', 'onetothree', 'someone']);
  assert.deepEqual(btns.map((b) => b.querySelector('kbd').textContent), ['1', '2', '3', '4']);
  const pos = h.qa('#gm-pos [data-gm="pos"]'); assert.equal(pos.length, 3);
  assert.deepEqual(pos.map((b) => b.getAttribute('data-v')), ['controlled', 'risky', 'desperate']);
  assert.deepEqual(pos.map((b) => b.getAttribute('aria-checked')), ['false', 'true', 'false'], 'risky by default');
  assert.equal(h.qa('#gm-controls [data-ctl="result"]').length, 0, 'no Result in Situations');
  assert.equal(h.qa('#gm-controls [data-ctl="pos"]').length, 0, 'Position is the big switch, not a select');
  assert.ok(h.qa('#gm-controls [data-ctl]').length >= 4, 'scene, district, PC, NPC, threat stay');
  assert.equal(h.qa('#gm-singles [data-gm="roll"]').length, 9, 'nine single tables');
  assert.equal(h.qa('#gm-singles kbd').length, 0, 'no keys on the single tables');
  assert.equal(h.qa('[data-gm="view"]').length, 0, 'no Situations | Classic toggle anywhere'); assert.ok(!h.q('.gm-conhead') && !h.q('.gm-head'), 'no console header, no page heading');
  const col = [...h.q('.gm-console').kids].filter((k) => k.nodeType === 1).map((k) => k.id);
  assert.deepEqual(col, ['gm-pos', 'gm-scenebox', 'gm-mini', 'gm-controls', 'gm-buttons', 'gm-card', 'gm-rack', 'gm-earlier', 'gm-singles'], 'the column: Position, Scene, the buttons, the card, the Rack (empty), Earlier, More tables');
  assert.equal(h.q('#gm-scenebox > #gm-scene') || h.q('#gm-scenebox').querySelector('#gm-scene'), h.q('#gm-scene'), 'the Scene button sits in its box');
  assert.equal(h.q('#gm-singles').tagName, 'DETAILS', 'the single tables are folded');
  assert.match(h.q('#gm-scene-chips').textContent, /District: any/, 'the Scene line labels its chips');
  await h.save();
});

await test('6b. key 2 rolls a 4/5 card under "situation": a lead, Or rows, one actions row; history and the stored card carry no classic id; 5-9 do nothing', async () => {
  const h = await openPage();
  h.press('2');
  assert.ok(h.q('#gm-card .gm-lead') && h.qa('#gm-card .gm-lead-t').length === 1);
  const ors = h.qa('#gm-card details.gm-or'); assert.ok(ors.length >= 1 && ors.length <= 3, 'Or rows: ' + ors.length);
  assert.equal(h.qa('#gm-card .gm-card-acts').length, 1);
  for (const k of ['5', '6', '7', '8', '9']) h.press(k);
  assert.equal(h.qa('#gm-earlier [data-gm="replay"]').length, 1, '5-9 rolled nothing');
  await h.save();
  const d = h.fg.server.doc;
  assert.equal(d.cards.situation.id, 'situation'); assert.equal(d.cards.situation.situation, 'fourfive');
  assert.ok(!d.cards.console, 'never filed under console');
  assert.equal(Object.keys(d.hist.situation).length, 1); assert.ok(!d.hist.console);
  assert.ok(!('lines' in d.cards.situation) && !('sections' in d.cards.situation), 'replay info only');
});

await test('6c. the Position switch sets the live Position (shared with Classic) and the next card; the number keys ignore typing and modifiers', async () => {
  const h = await openPage();
  h.qa('#gm-pos [data-v="desperate"]')[0].click();
  assert.equal(h.qa('#gm-pos [data-v="desperate"]')[0].getAttribute('aria-checked'), 'true');
  h.press('3');
  assert.match(h.q('#gm-card .gm-sub').textContent, /^desperate/);
  const before = cardTxt(h);
  h.press('1', { ctrlKey: true }); h.press('1', { typing: true, target: h.q('#gm-c-threat') });
  assert.equal(cardTxt(h), before, 'a modifier, or typing in a box, rolls nothing');
  await h.save();
  assert.equal(h.fg.server.doc.con.live.pos, 'desperate');
  await h.save();
});

await test('6d. reload (close and open again) redraws the same situation card, and Earlier replays another', async () => {
  const fg = fakeGm(), br = fakeBrowser();
  const h = await openPage({ fg, br });
  h.press('2'); const a = cardTxt(h);
  h.press('3'); const b = cardTxt(h); assert.notEqual(a, b);
  await h.save();
  const h2 = await openPage({ fg, br });
  assert.equal(cardTxt(h2), b, 'the same card after a reload');
  const chips = h2.qa('#gm-earlier [data-gm="replay"]'); assert.equal(chips.length, 2);
  chips.filter((c) => !c.hasAttribute('aria-current'))[0].click();
  assert.equal(cardTxt(h2), a, 'Earlier redraws the first card');
  await h2.save();
  const h3 = await openPage({ fg, br });
  assert.equal(cardTxt(h3), a, 'and the replayed card is the one that comes back');
  await h3.save();
});

await test('6f. a single table rolled from the Situations row is a classic card (stored under console), shown in the same box', async () => {
  const h = await openPage();
  h.press('1'); await new Promise((r) => setTimeout(r, 8));
  h.qa('#gm-singles [data-gm="roll"]')[3].click();
  assert.equal(h.q('#gm-card article').getAttribute('data-tool'), 'console');
  await h.save();
  assert.ok(h.fg.server.doc.cards.console && h.fg.server.doc.cards.situation);
  const h2 = await openPage({ fg: h.fg, br: h.br });
  assert.equal(h2.q('#gm-card article').getAttribute('data-tool'), 'console', 'the newest roll is what comes back');
  assert.equal(h2.qa('#gm-earlier [data-gm="replay"]').length, 2, 'Situations history lists both tools, newest first');
  await h2.save();
});

await test('6h. an action on the merged row works as before: a Devil\'s Bargain accepted is owed (and the bargain\'s capture line carries the session)', async () => {
  let done = 0;
  for (let k = 0; k < 40 && !done; k++) {
    const h = await openPage();
    h.press('1');
    const btn = h.qa('#gm-card [data-gm="intent"]').find((b) => /Accepted/.test(b.textContent));
    if (btn) {
      btn.click(); await h.save();
      const con = h.fg.server.doc.con; assert.ok(Object.keys(con.owed || {}).length === 1, JSON.stringify(con));
      const cap = Object.values(h.fg.server.doc.capture || {});
      assert.ok(cap.length === 1 && cap[0].bucket === 'x' && cap[0].s === 3, 'the loose-end line is filed with session 3: ' + JSON.stringify(cap));
      done = 1;
    } else await h.save();
  }
  assert.ok(done, 'never saw an Accepted action');
});

await test('6h2. L files an outcome card with the Position set on the page in brackets; the default Position is risky; no effect is invented', async () => {
  const h = await openPage({ camp: { session: { number: 5 }, crew: {}, log: [] } });
  h.qa('#gm-pos [data-v="desperate"]')[0].click();
  h.press('3'); h.press('l');
  h.press('1'); h.press('l');
  await h.save();
  const lines = Object.values(h.fg.server.doc.capture).filter((e) => e.bucket === 'r').map((e) => e.text);
  assert.ok(lines.some((t) => /^A 1–3 \(desperate\): /.test(t)), JSON.stringify(lines));
  assert.ok(lines.every((t) => !/limited|standard|great/.test(t.split(':')[0])), 'no effect control, so none is written');
  assert.ok(lines.some((t) => /^Before the roll: /.test(t)), 'a Before card keeps the plain line: ' + JSON.stringify(lines));
});

await test('6h3. Dots chip: one tap selects, tap again clears, default unset; L files "(risky, 2d)" only when set; resets once the roll is filed; no new key', async () => {
  const h = await openPage({ camp: { session: { number: 5 }, crew: {}, log: [] } });
  const dots = () => h.qa('#gm-pos [data-gm="dots"]');
  assert.equal(dots().length, 5);
  assert.ok(dots().every((b) => b.getAttribute('aria-checked') === 'false'), 'unset by default');
  dots()[2].click();
  assert.deepEqual(dots().map((b) => b.getAttribute('aria-checked')), ['false', 'false', 'true', 'false', 'false']);
  dots()[2].click();
  assert.ok(dots().every((b) => b.getAttribute('aria-checked') === 'false'), 'a second tap clears');
  h.press('2'); h.press('l');                                    /* no dots set: the line is as before */
  dots()[0].click(); h.press('3'); h.press('l');                  /* zero shows as 0d */
  assert.ok(dots().every((b) => b.getAttribute('aria-checked') === 'false'), 'filing the roll resets the dots');
  dots()[2].click(); h.press('Q');                                /* an unbound key does nothing to it */
  assert.equal(dots()[2].getAttribute('aria-checked'), 'true');
  h.press('2'); h.press('l');
  dots()[1].click(); h.press('1'); h.press('l');                  /* a Before card is not an outcome: dots stay */
  assert.equal(dots()[1].getAttribute('aria-checked'), 'true');
  await h.save();
  const lines = Object.values(h.fg.server.doc.capture).filter((e) => e.bucket === 'r').map((e) => e.text);
  assert.ok(lines.some((t) => /^A 4\/5 \(risky\): /.test(t)), JSON.stringify(lines));
  assert.ok(lines.some((t) => /^A 1–3 \(risky, 0d\): /.test(t)), JSON.stringify(lines));
  assert.ok(lines.some((t) => /^A 4\/5 \(risky, 2d\): /.test(t)), JSON.stringify(lines));
});

await test('6i. captures record their session (numbers only): typed lines and L-filed rolls; absent when the campaign has none; text never in the campaign', async () => {
  const h = await openPage({ camp: { session: { number: 5 }, crew: {}, log: [] } });
  const form = h.q('[data-gm-form="capture"]'), input = h.q('#gm-cap-in');
  input.value = 'Inspector Invented'; dispatch(form, 'submit');
  h.press('2'); h.press('l');
  await h.save();
  const cap = Object.values(h.fg.server.doc.capture);
  assert.equal(cap.length, 2);
  const n = cap.find((e) => e.bucket === 'n'), r = cap.find((e) => e.bucket === 'r');
  assert.deepEqual([n.s, r.s], [5, 5]); assert.equal(typeof n.s, 'number');
  assert.ok(/^A 4\/5 \(risky\): /.test(r.text), r.text);
  for (const e of cap) assert.deepEqual(Object.keys(e).sort(), ['at', 'bucket', 'id', 's', 'text']);
  const h2 = await openPage({ camp: null });
  h2.q('#gm-cap-in').value = 'No session here'; dispatch(h2.q('[data-gm-form="capture"]'), 'submit'); await h2.save();
  assert.ok(!('s' in Object.values(h2.fg.server.doc.capture)[0]), 'no session known: no s');
  const h3 = await openPage({ camp: { session: { number: 'abc' } } });
  h3.q('#gm-cap-in').value = 'Odd'; dispatch(h3.q('[data-gm-form="capture"]'), 'submit'); await h3.save();
  assert.ok(!('s' in Object.values(h3.fg.server.doc.capture)[0]), 'a non-number is not stored');
  const long = await openPage({ camp: { session: { number: 2 } } });
  long.q('#gm-cap-in').value = 'x'.repeat(900); dispatch(long.q('[data-gm-form="capture"]'), 'submit'); await long.save();
  assert.equal(Object.values(long.fg.server.doc.capture)[0].text.length, P.LIMITS.captureText, 'the text cap still applies');
});

await test('6j. Copy and Pin work on a composed card (plain text, filed under situation)', async () => {
  const h = await openPage();
  h.press('3');
  h.q('#gm-card [data-gm="copy"]').click();
  assert.ok(/^A 1–3 \(/.test(h.br.copied) && /\nOr /.test(h.br.copied), h.br.copied);
  h.q('#gm-card [data-gm="pin"]').click(); await h.save();
  const pins = Object.values(h.fg.server.doc.pins); assert.equal(pins.length, 1); assert.equal(pins[0].tool, 'situation'); assert.ok(pins[0].text.length > 20);
});

await test('6k. no window.claude.gm (the claude.ai artifact): a one-line message and nothing drawn', async () => {
  const br = fakeBrowser(), page = loadPage(br.W), root = br.doc.createElement('div'); br.doc.body.appendChild(root);
  page.open(root, { ready: async () => {}, isGM: () => true, me: () => 'x', gm: () => null, db: () => null });
  await until(() => page._state() && page._state().status === 'off');
  assert.match(root.textContent, /GM tools are available on the hosted app/);
  assert.equal(root.querySelectorAll('[data-gm="view"]').length, 0);
  assert.equal(page.available(), false, 'boot draws no GM button');
});

/* ---------- 7. the display name (app/name-edit.js) ---------- */
const NE = require(path.join(ROOT, 'app', 'name-edit.js'));
await test('7a. name edit: hidden unless window.claude.profile.setName exists; closed and open states; the name is escaped', () => {
  assert.equal(NE.available({}), false); assert.equal(NE.available({ claude: {} }), false); assert.equal(NE.available({ claude: { profile: {} } }), false);
  assert.equal(NE.available({ claude: { profile: { setName() {} } } }), true);
  const closed = NE.html({ open: false }, 'Rex <b>');
  assert.ok(/Change name/.test(closed) && closed.includes('data-nm="open"') && closed.includes('Rex &lt;b&gt;') && !closed.includes('<form'));
  const open = NE.html({ open: true, busy: false, error: 'Names are 1-40 characters', value: 'Rex "x"' }, 'Rex');
  for (const a of ['save', 'clear', 'cancel']) assert.ok(open.includes('data-nm="' + a + '"'), a);
  assert.ok(open.includes('id="homeNameIn"') && open.includes('maxlength="40"') && open.includes('value="Rex &quot;x&quot;"') && /role="alert">Names are 1-40 characters</.test(open));
  assert.ok(/data-nm="save" disabled/.test(NE.html({ open: true, busy: true }, 'Rex')), 'buttons are disabled while saving');
});
await test('7b. name edit: save sends the trimmed name; clear sends null; a 400 shows the API\'s own message; offline says so; success reports the new name', async () => {
  const calls = [];
  const ok = { setName: async (n) => { calls.push(n); return { id: 'u1', name: n === null ? 'Sign-in Name' : n }; } };
  assert.deepEqual(await NE.save(ok, '  Rex   Marks  '), { ok: true, name: 'Rex Marks', cleared: false });
  assert.deepEqual(await NE.save(ok, ''), { ok: true, name: 'Sign-in Name', cleared: true });
  assert.deepEqual(await NE.save(ok, null), { ok: true, name: 'Sign-in Name', cleared: true });
  assert.deepEqual(calls, ['Rex Marks', null, null]);
  const bad = { setName: async () => { throw Object.assign(new Error('name may not contain < or >'), { status: 400 }); } };
  assert.deepEqual(await NE.save(bad, 'a<b'), { ok: false, message: 'name may not contain < or >' });
  const off = { setName: async () => { throw Object.assign(new Error('Failed to fetch'), { network: true }); } };
  const r = await NE.save(off, 'Rex'); assert.equal(r.ok, false); assert.equal(r.network, true); assert.match(r.message, /offline/i);
  const boom = { setName: async () => { throw Object.assign(new Error('server said no'), { status: 500 }); } };
  assert.match((await NE.save(boom, 'Rex')).message, /Could not save: server said no/);
  const n = calls.length; const long = await NE.save(ok, 'x'.repeat(41)); assert.equal(long.ok, false); assert.equal(calls.length, n, 'too long: not sent');
  assert.equal((await NE.save(null, 'x')).ok, false);
});
await test('7c. boot.js wires it: the box goes under the greeting, only on the hosted build with setName, and success refreshes A.myName and the header', () => {
  const boot = fs.readFileSync(path.join(ROOT, 'app', 'boot.js'), 'utf8');
  assert.ok(/N\.available\(window\)/.test(boot) && /hosted\(\)/.test(boot.slice(boot.indexOf('function nameMod'), boot.indexOf('function nameMod') + 200)));
  assert.ok(/A\.myName = r\.name/.test(boot) && /whoami\(\); renderHome\(\)/.test(boot), 'success: A.myName, header and greeting redrawn');
  assert.ok(/insertAdjacentHTML\('afterend', nh\)/.test(boot));
  const idx = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
  assert.ok(idx.indexOf('<script src="name-edit.js">') > 0 && idx.indexOf('<script src="name-edit.js">') < idx.indexOf('<script src="boot.js">'), 'loaded before boot.js');
});

/* ---------- 8. the street scene roller (S) ---------- */
const cardOf = (h, sel) => (h.q(sel).textContent || '').replace(/\s+/g, ' ').trim();
const change = (el, v) => { el.value = String(v); dispatch(el, 'change'); };
const isObjLike = (v) => v && typeof v === 'object' && !Array.isArray(v);
const T_SC = FIXS.parts.scenes.T;

await test('8a. keyAction: S opens the street scene panel; E opens nothing any more (Engage went)', () => {
  assert.deepEqual(P.keyAction({ key: 's' }), { type: 'panel', panel: 'scenes' });
  assert.equal(P.keyAction({ key: 'E' }), null); assert.equal(P.keyAction({ key: 'e' }), null);
  assert.equal(P.keyAction({ key: 's', ctrlKey: true }), null);
  assert.equal(P.keyAction({ key: 's', typing: true }), null);
});

await test('8b. S opens the panel; Roll files the card (seed, controls, memory BEFORE the roll) and a history entry; the card has the read-aloud, ratings and grid', async () => {
  const fg = fakeGm(), h = await openPage({ fg });
  assert.ok(h.q('[data-pane="scenes"]') && h.q('#gm-scn') && h.q('[data-pane="score"]') && h.q('#gm-score') && !h.q('[data-pane="engagement"]') && !h.q('#gm-eng'));
  assert.equal(h.qa('.gm-tab').map((t) => t.getAttribute('data-panel')).join(), 'prep,rules,location,scenes,score,chase,npc,downtime,cards,ipad');
  h.press('s'); assert.equal(h.page._state().panel, 'scenes');
  assert.ok(!h.q('#gm-scn .gm-scncard'), 'nothing before the first roll');
  h.q('[data-gm="scnroll"]').click();
  const card = h.q('#gm-scn .gm-scncard'); assert.ok(card, 'a card');
  const name = cardOf(h, '#gm-scn .gm-scncard h3');
  assert.ok(T_SC.district.some((d) => d.n === name), 'the district is one of the pack\'s');
  assert.equal(h.qa('#gm-scn .gm-read').length, 3, 'three read-aloud paragraphs');
  assert.equal(h.qa('#gm-scn .gm-chip').length, 4, 'four ratings');
  assert.ok(h.qa('#gm-scn .gm-grid dt').map((d) => d.textContent).join().startsWith('Landmark,Who\'s out,In the way,Word out,Factions'));
  await h.save();
  const c = fg.server.doc.cards.scenes;
  assert.ok(Number.isInteger(c.seed) && c.ui && c.ui.sel === '' && c.mem === '{}' && c.label.startsWith(name + ' · ') && c.hid);
  assert.equal(Object.keys(fg.server.doc.hist.scenes).length, 1);
  assert.ok(isObjLike(fg.server.doc.mem.scenes) && Object.keys(fg.server.doc.mem.scenes).length > 0, 'the repeat-guard memory is kept');
});

await test('8c. a chosen district is honoured and remembered; reload redraws the identical card; Earlier replays the first', async () => {
  const fg = fakeGm(), br = fakeBrowser();
  const h = await openPage({ fg, br });
  h.press('s'); h.q('[data-gm="scnroll"]').click(); const first = cardOf(h, '#gm-scn .gm-scncard');
  change(h.q('#gm-s-sel'), 'Cobb Hill');
  h.q('[data-gm="scnroll"]').click();
  assert.equal(cardOf(h, '#gm-scn .gm-scncard h3'), 'Cobb Hill');
  const second = cardOf(h, '#gm-scn .gm-scncard');
  await h.save();
  assert.equal(fg.server.doc.scn.ui.sel, 'Cobb Hill', 'the control is kept');
  const h2 = await openPage({ fg, br });
  assert.equal(h2.q('#gm-s-sel').getAttribute('data-scn'), 'sel');
  assert.equal(cardOf(h2, '#gm-scn .gm-scncard'), second, 'the same card after a reload');
  const chips = h2.qa('#gm-scn [data-gm="replay"]'); assert.equal(chips.length, 2);
  chips.filter((c) => !c.hasAttribute('aria-current'))[0].click();
  assert.equal(cardOf(h2, '#gm-scn .gm-scncard'), first, 'Earlier redraws the first card (its own memory, its own controls)');
  await h2.save();
  const h3 = await openPage({ fg, br });
  assert.equal(cardOf(h3, '#gm-scn .gm-scncard'), first, 'and the replayed card is the one that comes back');
  await h3.save();
});

await test('8d. Pin and Copy on a street scene are plain text filed under "scenes"; L files it under Rolled at the table', async () => {
  const fg = fakeGm(), br = fakeBrowser();
  const h = await openPage({ fg, br });
  h.press('s'); h.q('[data-gm="scnroll"]').click();
  h.q('#gm-scn [data-gm="copy"]').click(); assert.ok(br.copied && !/\*\*|\[\[/.test(br.copied) && /Landmark:/.test(br.copied), 'plain text');
  h.q('#gm-scn [data-gm="pin"]').click(); await h.save();
  const pins = Object.values(fg.server.doc.pins || {}); assert.equal(pins.length, 1); assert.equal(pins[0].tool, 'scenes');
  const h2 = await openPage({ fg, br });
  h2.press('s'); h2.q('[data-gm="scnroll"]').click(); h2.press('l'); await h2.save();
  const cap = Object.values(fg.server.doc.capture || {}); assert.ok(cap.some((c) => c.bucket === 'r' && /^Street scene: /.test(c.text)), 'filed: ' + JSON.stringify(cap));
});

await test('8e. Read-aloud to the iPad sends only the three read-aloud paragraphs: never the notable, the rumour or the district rule', async () => {
  const fg = fakeGm(), h = await openPage({ fg });
  h.press('s');
  for (const d of T_SC.district) {
    change(h.q('#gm-s-sel'), d.n); h.q('[data-gm="scnroll"]').click();
    h.q('[data-gm="scnipad"]').click(); await until(() => fg.server.displays.length);
    const sent = fg.server.displays.pop();
    assert.equal(sent.kind, 'text'); assert.equal(sent.title, d.n);
    for (const n of d.notables) assert.ok(!sent.text.includes(n[0]) && !sent.text.includes(n[1]), 'no notable');
    if (d.special) assert.ok(!sent.text.includes(d.special), 'no district rule');
    assert.ok(!sent.text.includes('Word out') && !/\*\*/.test(sent.text), 'no grid, no markdown');
    assert.equal(sent.text.split('\n\n').length, 3, 'three paragraphs');
  }
  fg.server.displays.length = 0;
});

await test('8h. a pack without the scenes part: the panel says so and the rest of the page works', async () => {
  const fg = fakeGm(); const full = fg.gm.pack, part = fg.gm.packPart;
  fg.gm.pack = async () => { const r = await full(); delete r.parts.scenes; return r; };
  const h = await openPage({ fg });
  h.press('s'); assert.ok(/no scenes part/.test(h.q('#gm-scn').textContent));
  h.press('2'); assert.ok(cardTxt(h).length > 20, 'the console still rolls');
  void part;
});

await test('8i. the missing module (an old shell): a one-line message, nothing thrown', async () => {
  const br = fakeBrowser({ B68GmScenes: undefined });
  const h = await openPage({ br });
  assert.ok(/module is missing/.test(h.q('#gm-scn').textContent));
});

await test('8j. Engage left its stored controls, current card and history in the notes: the page drops them once, and touches nothing else', async () => {
  const fg = fakeGm();
  fg.server.doc = { eng: { ui: { approach: 'x', mods: { a: 1 } } }, cards: { engagement: { hid: 'h1', seed: 3, ui: {} }, scenes: { hid: 'h9', seed: 5, ui: { sel: '' }, mem: '{}', label: 'x', at: '2026-10-16T00:00:00.000Z' } },
    hist: { engagement: { h1: { seed: 3, at: 'x' } }, scenes: { h9: { seed: 5, at: 'x' } } }, scn: { ui: { sel: '' } } };
  const h = await openPage({ fg });
  await h.save();
  const d = fg.server.doc;
  assert.ok(!('eng' in d) && !('engagement' in d.cards) && !('engagement' in d.hist), 'Engage\'s keys are gone: ' + JSON.stringify(Object.keys(d)));
  assert.equal(d.cards.scenes.hid, 'h9'); assert.equal(Object.keys(d.hist.scenes).length, 1); assert.deepEqual(d.scn, { ui: { sel: '' } });
  const before = fg.server.patches.length, h2 = await openPage({ fg }); await h2.save();
  assert.equal(fg.server.patches.length, before, 'and a clean state is not written again');
});

/* ---------- 9. the iPad panel (I): ambient scenes, Clear and Lights out, the heat sync, the score scene ---------- */
const clone = (v) => JSON.parse(JSON.stringify(v));
/* a fake ambient on the fake GM server: the server's own merge for the keys the panel sends (skip adds one; null deletes) */
function addAmbient(fg, init) {
  const s = fg.server; s.amb = { seq: (init && init.seq) || 0, doc: clone((init && init.doc) || {}) }; s.ambPatches = []; s.ambFail = false; s.ambGets = 0; s.shown = (init && init.shown) || { kind: 'text', title: 'Invented line' };
  fg.gm.ambient = async () => { s.ambGets++; return { seq: s.amb.seq, doc: clone(s.amb.doc), updatedAt: 'a' + s.amb.seq }; };
  /* the display as the server keeps it: a seq bumped by every PUT; a PUT with ifSeq lands only while the seq is still that one, else 409
     and nothing changes (functions/_lib/gm.js putDisplay). What is stored never holds ifSeq (cleanDisplay drops it) */
  s.dseq = 3;
  fg.gm.display = async () => ({ seq: s.dseq, display: clone(s.shown), updatedAt: 'd', ambient: { seq: s.amb.seq, unchanged: true } });
  fg.gm.setDisplay = async (d0) => {
    const d = clone(d0); const cond = 'ifSeq' in d ? d.ifSeq : undefined; delete d.ifSeq;
    if (cond !== undefined && cond !== s.dseq) { s.conflicts = (s.conflicts || 0) + 1; throw Object.assign(new Error('the display changed since seq ' + cond), { status: 409 }); }
    s.displays.push(d); s.shown = clone(d); s.dseq++; return { seq: s.dseq, display: d };
  };
  /* another device puts something on the iPad (the page is not told) */
  s.otherDevice = (d) => { s.shown = clone(d); s.dseq++; };
  fg.gm.patchAmbient = async (p) => {
    if (s.ambFail) throw Object.assign(new Error('the server said no'), { status: 500 });
    s.ambPatches.push(clone(p)); const d = clone(s.amb.doc);
    for (const k of Object.keys(p)) { if (k === 'skip') d.skip = (d.skip || 0) + 1; else if (p[k] === null) delete d[k]; else d[k] = clone(p[k]); }
    if (p.score) d.score.at = '2026-10-17T01:02:03.000Z';
    s.amb.seq++; s.amb.doc = d; return { seq: s.amb.seq, doc: clone(d), updatedAt: 'a' + s.amb.seq };
  };
  return fg;
}
const eqj = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
const openIpad = async (h) => { h.press('i'); await until(() => h.page._ambient().loaded); };
const CAMP3 = { session: { number: 3 }, crew: { heat: 3, wanted: 1 } };
const SCORE0 = { name: 'Invented Mill', district: 'Nowhere', target: '', reveal: ['public', 'working'], view: 'plan', board: '<svg/>', iso: '<svg/>', at: '2026-10-17T01:02:03.000Z' };

await test('9a. keys: I opens the iPad panel and 0 clears to ambient; never while typing or with a modifier; the other keys are unchanged', () => {
  assert.deepEqual(P.keyAction({ key: 'i' }), { type: 'panel', panel: 'ipad' }); assert.deepEqual(P.keyAction({ key: 'I', view: 'classic' }), { type: 'panel', panel: 'ipad' });
  assert.deepEqual(P.keyAction({ key: '0' }), { type: 'clear' }); assert.deepEqual(P.keyAction({ key: '0', view: 'situations' }), { type: 'clear' }); assert.deepEqual(P.keyAction({ key: '0', view: 'classic' }), { type: 'clear' });
  for (const k of ['i', '0']) {
    assert.equal(P.keyAction({ key: k, typing: true }), null, k + ' typing'); assert.equal(P.keyAction({ key: k, ctrlKey: true }), null, k + ' ctrl');
    assert.equal(P.keyAction({ key: k, altKey: true }), null); assert.equal(P.keyAction({ key: k, metaKey: true }), null);
  }
  assert.deepEqual(P.keyAction({ key: 'H' }), { type: 'blank' }, 'Shift+H blanks the GM screen at once'); assert.deepEqual(P.keyAction({ key: 'h' }), { type: 'blank-tap' }, 'a plain H is one tap of two');
  assert.deepEqual(P.keyAction({ key: '1' }), { type: 'situation', n: 1 });
});

await test('9b. crewOf: whole numbers clamped to 0-9 / 0-4; null without a number; ipadView draws from the server document', () => {
  assert.deepEqual(P.crewOf({ crew: { heat: 3.4, wanted: 2 } }), { heat: 3, wanted: 2 });
  assert.deepEqual(P.crewOf({ crew: { heat: 40, wanted: -3 } }), { heat: 9, wanted: 0 });
  assert.deepEqual(P.crewOf({ crew: { heat: 5 } }), { heat: 5, wanted: 0 });
  for (const d of [null, {}, { crew: null }, { crew: {} }, { crew: { heat: '3', wanted: 'x' } }, { crew: { heat: NaN } }, { crew: [] }]) assert.equal(P.crewOf(d), null, JSON.stringify(d));
  const v0 = P.ipadView(null); assert.deepEqual([v0.mode, v0.intervalMin, v0.hasScore, v0.intervals], ['auto', 7, false, [4, 7, 10, 15]]);
  assert.deepEqual(v0.tiles.map((x) => [x.id, x.disabled, x.pressed, x.note]), [['harvest', false, false, ''], ['watch', false, false, ''], ['duskwall', false, false, ''], ['boneyard', false, false, ''], ['undertow', false, false, ''], ['vet', false, false, ''], ['tram', false, false, ''], ['lurker', false, false, ''], ['cards', false, false, ''], ['pells', false, false, ''], ['wanted', false, false, ''], ['meeting', false, false, ''], ['credits', false, false, 'pin only'], ['board', true, false, 'needs a score scene'], ['exploded', true, false, 'needs a score scene'], ['testcard', false, false, 'pin only']]);
  const v1 = P.ipadView({ mode: 'pin', scene: 'board', intervalMin: 12, score: SCORE0 });
  assert.deepEqual([v1.mode, v1.intervalMin, v1.intervals, v1.hasScore], ['pin', 12, [4, 7, 10, 12, 15], true]);
  assert.deepEqual(v1.tiles.filter((x) => x.pressed).map((x) => x.id), ['board']); assert.equal(v1.tiles.filter((x) => x.disabled).length, 0);
  assert.match(v1.scoreLine, /^Invented Mill · public, working · \d\d:\d\d$/);
  assert.equal(P.ipadView({ mode: 'sideways', intervalMin: 99 }).mode, 'auto'); assert.equal(P.ipadView({ intervalMin: 99 }).intervalMin, 7);
  /* the theme line: the panel says plainly when app/media/theme.mp3 is not on the server (the credits then run silent) */
  assert.equal(P.THEME_URL, 'media/theme.mp3');
  assert.equal(P.themeLine('ok', 200), 'Theme for the credits: on the server.');
  assert.match(P.themeLine('none', 404), /^Theme for the credits: NO FILE on the server\. The credits run silent\. Copy app\/media\/theme\.mp3/);
  assert.match(P.themeLine('none', 403), /NO FILE on the server \(HTTP 403\)/);
  assert.equal(P.themeLine('unknown', 0), 'Theme for the credits: not checked yet.');
  assert.ok(P.themeType('audio/mpeg') && P.themeType('') && P.themeType('application/octet-stream') && !P.themeType('text/html; charset=utf-8'), 'only audio counts as the theme');
  assert.equal(P.ipadView({ mode: 'auto', scene: 'board' }).tiles.filter((x) => x.pressed).length, 0, 'only a pin presses a tile');
  assert.equal(P.displayLine({ kind: 'svg', title: 'Invented Mill' }), 'Map · Invented Mill'); assert.equal(P.displayLine({ kind: 'dark' }), 'Lights out');
  assert.equal(P.displayLine({ kind: 'rule', title: 'Invented rule' }), 'Rule · Invented rule');
  assert.match(P.displayLine({ kind: 'blank' }), /ambient/);
});

/* the crew sync on fake timers: a debounce, one in flight, the ambient off, one toast */
function crewRig(over) {
  const timers = []; let id = 0; const sent = [], toasts = [];
  const r = { mode: 'auto', fail: false, hold: null, sent, toasts, timers,
    run() { const t = timers.shift(); if (t) t.fn(); return !!t; } };
  r.sync = P.makeCrewSync(Object.assign({
    send: (crew) => { sent.push(crew); if (r.hold) return new Promise((res) => { r.hold.push(res); }); return r.fail ? Promise.reject(new Error('net')) : Promise.resolve({ ok: 1 }); },
    mode: () => r.mode, delay: (fn, ms) => { const h = ++id; timers.push({ id: h, fn, ms }); return h; }, cancel: (h) => { const i = timers.findIndex((x) => x.id === h); if (i >= 0) timers.splice(i, 1); },
    toast: (m) => toasts.push(m)
  }, over || {}));
  return r;
}
const settle = () => new Promise((r) => setImmediate(r));
await test('9c. crew sync: a change waits 2 s, restarts when the value moves, and sends once; the same value is not re-sent', async () => {
  const r = crewRig();
  r.sync.note({ crew: { heat: 2, wanted: 0 } }); assert.equal(r.timers.length, 1); assert.equal(r.timers[0].ms, 2000); assert.equal(r.sent.length, 0);
  r.sync.note({ crew: { heat: 2, wanted: 0 } }); assert.equal(r.timers.length, 1, 'the same value does not restart the wait');
  r.sync.note({ crew: { heat: 3, wanted: 0 } }); assert.equal(r.timers.length, 1, 'a new value replaces the wait');
  r.run(); await settle(); assert.deepEqual(r.sent, [{ heat: 3, wanted: 0 }]);
  r.sync.note({ crew: { heat: 3, wanted: 0 } }); assert.equal(r.timers.length, 0, 'already sent'); r.sync.note({ crew: { heat: 3, wanted: 1 } }); r.run(); await settle();
  assert.deepEqual(r.sent, [{ heat: 3, wanted: 0 }, { heat: 3, wanted: 1 }]);
  r.sync.note({ crew: {} }); r.sync.note(null); assert.equal(r.timers.length, 0, 'no crew numbers: nothing');
});
await test('9d. crew sync: nothing while the ambient is off; sends again once it is not; adopt() takes the server as the truth', async () => {
  const r = crewRig(); r.mode = 'off';
  r.sync.note({ crew: { heat: 1, wanted: 1 } }); assert.equal(r.timers.length, 0, 'off: no send');
  r.mode = 'auto'; r.sync.note({ crew: { heat: 1, wanted: 1 } }); assert.equal(r.timers.length, 1);
  r.sync.adopt({ heat: 1, wanted: 1 }, true); await settle(); assert.equal(r.sent.length, 0, 'the server already holds it'); assert.equal(r.timers.length, 0, 'and the wait is cancelled');
  r.sync.adopt({ heat: 5, wanted: 2 }, true); await settle(); assert.deepEqual(r.sent, [{ heat: 1, wanted: 1 }], 'stale on the server: corrected at once, no wait');
  const q = crewRig(); q.sync.note({ crew: { heat: 4, wanted: 0 } }); q.sync.adopt(undefined, true); await settle(); assert.deepEqual(q.sent, [{ heat: 4, wanted: 0 }], 'missing on the server: sent');
  const o = crewRig(); o.mode = 'off'; o.sync.note({ crew: { heat: 4, wanted: 0 } }); o.sync.adopt(undefined, true); await settle(); assert.equal(o.sent.length, 0, 'off stays off');
});
await test('9e. crew sync: one request in flight; a change meanwhile goes after; one toast on errors until a success', async () => {
  const r = crewRig(); r.hold = [];
  r.sync.note({ crew: { heat: 2, wanted: 0 } }); r.run(); await settle(); assert.equal(r.sent.length, 1);
  r.sync.note({ crew: { heat: 4, wanted: 0 } }); r.run(); await settle(); assert.equal(r.sent.length, 1, 'still the first request in flight');
  r.hold.shift()({}); await settle(); await settle();
  assert.equal(r.timers.length, 1, 'the newer value is waiting its turn'); r.hold = null; r.run(); await settle(); assert.deepEqual(r.sent.map((c) => c.heat), [2, 4]);
  const e = crewRig(); e.fail = true;
  e.sync.note({ crew: { heat: 7, wanted: 0 } }); e.run(); await settle(); e.sync.note({ crew: { heat: 8, wanted: 0 } }); e.run(); await settle(); e.sync.note({ crew: { heat: 9, wanted: 0 } }); e.run(); await settle();
  assert.equal(e.sent.length, 3, 'each change retries'); assert.equal(e.toasts.length, 1, 'one toast for the run of errors'); assert.match(e.toasts[0], /heat and wanted/);
  e.fail = false; e.sync.note({ crew: { heat: 1, wanted: 0 } }); e.run(); await settle(); e.fail = true; e.sync.note({ crew: { heat: 2, wanted: 0 } }); e.run(); await settle(); assert.equal(e.toasts.length, 2, 'a success re-arms the toast');
});

await test('9f. the score scene: player layer only; the board is the plan, or rings when the plan would name a hidden room; a leaking iso is refused', () => {
  /* the kit (0.5+) never names a hidden room: this renderer does on the plan, as kit 0.2 did */
  const calls = []; const rend = (roll, o) => { calls.push(o); const r = render(roll, o); return o.view === 'plan' || o.view === 'iso' ? Object.assign({}, r, { svg: r.svg.replace('</svg>', '<text>Server room</text></svg>') }) : r; };
  assert.throws(() => P.scoreScene(LEAKY, { layer: 'gm', view: 'plan' }, rend), /player layer/); assert.equal(calls.length, 0, 'a GM-layer request rendered nothing');
  assert.throws(() => P.scoreScene(null, { layer: 'player' }, rend), /Roll a location/);
  const s = P.scoreScene(LEAKY, { layer: 'player', reveal: { public: true } }, rend);
  assert.equal(s.view, 'rings'); assert.equal(s.rings, true, 'the plan named the hidden Server room: rings instead');
  assert.deepEqual(calls.map((c) => [c.view, c.theme, c.layer, c.legend, c.width]), [['plan', 'board', 'player', undefined, 1600], ['rings', 'board', 'player', undefined, 1600], ['iso', 'blueprint', 'player', false, 1600], ['rings', 'blueprint', 'player', false, 1600]]);
  assert.equal(s.isoRings, true, 'the iso named the hidden Server room: rings instead'); assert.ok(!s.iso.toLowerCase().includes('basement') && !s.board.toLowerCase().includes('basement'), 'the hidden name is on neither svg');
  assert.ok(calls.every((c) => c.reveal.join() === 'public'));
  assert.deepEqual(P.leaks(s.board, LEAKY, ['public']), []); assert.deepEqual(P.leaks(s.iso, LEAKY, ['public']), []);
  assert.deepEqual(s.score, { name: 'Invented Works', district: 'Nowhere', target: '', reveal: ['public'], view: 'rings', board: s.board, iso: s.iso });
  const clean = { name: 'Plain', district: 'D', rooms: [{ name: 'Lobby', band: 'public' }, { name: 'Hall', band: 'public' }], targetRoom: 'Lobby', targetBand: 'public' };
  const c = P.scoreScene(clean, { layer: 'player', reveal: { public: true, working: true } }, render);
  assert.deepEqual([c.view, c.rings, c.score.reveal], ['plan', false, ['public', 'working']]);
  const calls2 = []; const bad = (roll, o) => { calls2.push(o.view); return { svg: '<svg><text>Server room</text></svg>' }; };
  let err = null; try { P.scoreScene(LEAKY, { layer: 'player', reveal: { public: true } }, bad); } catch (e) { err = e; }
  assert.ok(err && err.leak && err.message === P.LEAK_MSG, 'a plan that leaks AND rings that leak: refused'); assert.deepEqual(calls2, ['plan', 'rings']);
  const isoOnly = (roll, o) => ({ svg: o.view === 'iso' ? '<svg><text>Server room</text></svg>' : '<svg><text>Lobby</text></svg>' });
  const fbk = P.scoreScene(LEAKY, { layer: 'player', reveal: { public: true } }, isoOnly);
  assert.equal(fbk.isoRings, true, 'a leaking iso is redrawn as rings');
  const isoAndRings = (roll, o) => ({ svg: o.view === 'iso' || (o.view === 'rings' && o.theme === 'blueprint') ? '<svg><text>Server room</text></svg>' : '<svg><text>Lobby</text></svg>' });
  err = null; try { P.scoreScene(LEAKY, { layer: 'player', reveal: { public: true } }, isoAndRings); } catch (e) { err = e; }
  assert.ok(err && err.leak, 'an iso and rings that both leak: refused');
});
await test('9g. the gate lets a score patch through only when both svgs were marked here; null and other keys pass', () => {
  const g = P.makeGate(); const sc = { board: '<svg id="b"/>', iso: '<svg id="i"/>' };
  assert.equal(g.allowsAmbient({ score: sc }), false); g.mark(sc.board); assert.equal(g.allowsAmbient({ score: sc }), false, 'one is not enough'); g.mark(sc.iso);
  assert.equal(g.allowsAmbient({ score: sc }), true); assert.equal(g.allowsAmbient({ score: { board: '<svg id="gm"/>', iso: sc.iso } }), false, 'a GM-layer svg');
  assert.equal(g.allowsAmbient({ score: null }), true); assert.equal(g.allowsAmbient({ mode: 'pin', scene: 'harvest' }), true); assert.equal(g.allowsAmbient(null), false);
  assert.equal(g.allowsAmbient({ score: { board: 5, iso: 6 } }), false);
});

await test('9h. the iPad panel: a tab (I), On the iPad now, Clear and Lights out, the mode, sixteen scenes, the interval; the server document is drawn', async () => {
  const fg = addAmbient(fakeGm(), { doc: { mode: 'pin', scene: 'duskwall', intervalMin: 10 }, shown: { kind: 'svg', title: 'Invented Mill' } });
  const h = await openPage({ fg, camp: CAMP3 });
  assert.ok(h.q('#gm-ipad') && h.q('[data-pane="ipad"]') && h.q('.gm-tab[data-panel="ipad"]').textContent.includes('iPad'));
  assert.ok(h.qa('[data-gm="seg"]').some((b) => b.getAttribute('data-seg') === 'ipad'), 'the phone bar has it too');
  h.press('i'); assert.equal(h.page._state().panel, 'ipad');
  await until(() => h.page._ambient().loaded);
  assert.equal(h.qa('#gm-ipad .gm-ipad-tile').length, 16); assert.equal(h.qa('#gm-ipad [data-gm="ambmode"]').length, 3);
  assert.equal(h.q('#gm-ipad-now').textContent, 'Map · Invented Mill', 'what the display holds, read once');
  assert.deepEqual(h.qa('#gm-ipad [data-gm="ambmode"]').map((b) => [b.getAttribute('data-v'), b.getAttribute('aria-pressed')]), [['off', 'false'], ['auto', 'false'], ['pin', 'true']]);
  assert.deepEqual(h.qa('#gm-ipad .gm-ipad-tile').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('data-id')), ['duskwall']);
  assert.deepEqual(h.qa('#gm-ipad .gm-ipad-tile').filter((b) => b.hasAttribute('disabled')).map((b) => b.getAttribute('data-id')), ['board', 'exploded'], 'score scenes wait for a score');
  assert.deepEqual(h.qa('#gm-amb-int option').map((o) => o.textContent), ['4 min', '7 min', '10 min', '15 min']); assert.equal(h.q('#gm-ipad [data-gm="ambskip"]').hasAttribute('disabled'), true, 'Next scene is Auto only');
  assert.match(h.q('#gm-ipad-score').textContent, /None set/); assert.equal(h.q('#gm-ipad [data-gm="clearscore"]').hasAttribute('disabled'), true);
  assert.deepEqual(h.qa('#gm-ipad [data-gm="blankipad"], #gm-ipad [data-gm="darkipad"]').map((b) => b.textContent.replace(/\s+/g, ' ').trim()), ['Clear → ambient 0', 'Lights out']);
  const fetches = fg.server.ambGets; h.press('i'); await until(() => fg.server.ambGets > fetches); assert.ok(fg.server.ambGets > fetches, 'opening the panel reads the document');
  await h.save();
});

await test('9i. Clear → ambient (button and key 0) sends blank; Lights out sends dark; every "Blank the iPad" button is renamed; errors are toasts', async () => {
  const fg = addAmbient(fakeGm()), br = fakeBrowser(); const h = await openPage({ fg, br, camp: CAMP3 });
  await openIpad(h);
  h.q('#gm-ipad [data-gm="darkipad"]').click(); await until(() => fg.server.displays.length === 1); eqj(fg.server.displays[0], { kind: 'dark' });
  await until(() => h.q('#gm-ipad-now').textContent === 'Lights out'); assert.equal(h.q('#gm-ipad-now').textContent, 'Lights out');
  h.q('#gm-ipad [data-gm="blankipad"]').click(); await until(() => fg.server.displays.length === 2); eqj(fg.server.displays[1], { kind: 'blank' });
  h.press('0'); await until(() => fg.server.displays.length === 3); eqj(fg.server.displays[2], { kind: 'blank' }, 'key 0');
  h.press('0', { ctrlKey: true }); await tick(); assert.equal(fg.server.displays.length, 3, 'not with a modifier');
  h.press('b'); assert.ok(h.qa('[data-gm="blankipad"]').every((b) => /Clear → ambient/.test(b.textContent)), 'the location panel button too');
  assert.ok(!/Blank the iPad/.test(h.root.textContent), 'no old name left');
  fg.gm.setDisplay = async () => { throw new Error('refused'); }; br.toasts.length = 0;
  h.press('0'); await until(() => br.toasts.length); assert.deepEqual(br.toasts[0], ['Could not clear the iPad: refused', true]);
  await h.save();
});

await test('9j. Off / Auto / Pin, a scene, the interval, Next scene and Clear score patch the server and draw its answer', async () => {
  const fg = addAmbient(fakeGm(), { doc: { score: SCORE0 } }), br = fakeBrowser(); const h = await openPage({ fg, br, camp: CAMP3 });
  await openIpad(h);
  assert.equal(h.qa('#gm-ipad .gm-ipad-tile').filter((b) => b.hasAttribute('disabled')).length, 0, 'a score is set: the score scenes are open');
  assert.match(h.q('#gm-ipad-score').textContent, /^Invented Mill · public, working · \d\d:\d\d$/);
  const patched = async (fn, n) => { fn(); await until(() => fg.server.ambPatches.length >= n); await until(() => !h.q('#gm-ipad [data-gm="ambmode"]').hasAttribute('disabled')); return fg.server.ambPatches[n - 1]; };
  const skipP = fg.server.ambPatches.length;
  eqj(await patched(() => h.qa('#gm-ipad [data-gm="ambmode"]')[0].click(), skipP + 1), { mode: 'off' });
  assert.equal(h.qa('#gm-ipad [data-gm="ambmode"]')[0].getAttribute('aria-pressed'), 'true', 'drawn from the answer');
  eqj(await patched(() => h.qa('#gm-ipad [data-gm="ambmode"]')[1].click(), skipP + 2), { mode: 'auto' });
  assert.equal(h.q('#gm-ipad [data-gm="ambskip"]').hasAttribute('disabled'), false, 'Next scene opens in Auto');
  eqj(await patched(() => h.q('#gm-ipad [data-gm="ambskip"]').click(), skipP + 3), { skip: true }); assert.equal(fg.server.amb.doc.skip, 1);
  eqj(await patched(() => h.qa('#gm-ipad [data-gm="ambmode"]')[2].click(), skipP + 4), { mode: 'pin', scene: 'harvest' }, 'Pin with no scene yet pins the first');
  eqj(await patched(() => h.q('#gm-ipad [data-id="board"]').click(), skipP + 5), { mode: 'pin', scene: 'board' });
  assert.deepEqual(h.qa('#gm-ipad .gm-ipad-tile').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('data-id')), ['board']);
  eqj(await patched(() => h.qa('#gm-ipad [data-gm="ambmode"]')[1].click(), skipP + 6), { mode: 'auto' });
  eqj(await patched(() => h.q('#gm-ipad [data-id="testcard"]').click(), skipP + 7), { mode: 'pin', scene: 'testcard' }, 'the test card pins');
  eqj(await patched(() => change(h.q('#gm-amb-int'), 15), skipP + 8), { intervalMin: 15 });
  eqj(await patched(() => h.q('#gm-ipad [data-gm="clearscore"]').click(), skipP + 9), { score: null });
  assert.match(h.q('#gm-ipad-score').textContent, /None set/); assert.equal(h.qa('#gm-ipad .gm-ipad-tile').filter((b) => b.hasAttribute('disabled')).length, 2);
  br.toasts.length = 0; fg.server.ambFail = true; h.qa('#gm-ipad [data-gm="ambmode"]')[0].click(); await until(() => br.toasts.length);
  assert.deepEqual(br.toasts[0], ['Could not change the iPad: the server said no', true]);
  assert.equal(h.qa('#gm-ipad [data-gm="ambmode"]')[2].getAttribute('aria-pressed'), 'true', 'a refused change leaves the server value (pin) on screen');
  await h.save();
});

await test('9j2. overlays: overlayOk takes exactly the server\'s shapes and no stray field; the gate lets an overlay or auto through only in that shape', () => {
  const ok = [
    { id: 'a', kind: 'clock', ms: 8000, name: 'Invented Fuse', size: 6, filled: 2 }, { id: 'a', kind: 'clock', ms: 1000, name: 'n'.repeat(60), size: 12, filled: 12 },
    { id: 'i'.repeat(40), kind: 'npc', ms: 180000, npcId: 'npc_x' }, { id: 'a', kind: 'fx', ms: 30000, fx: 'dawn' }, { id: 'a', kind: 'text', ms: 5000, text: 't'.repeat(120) },
  ];
  ok.forEach((o) => assert.equal(P.overlayOk(o), true, JSON.stringify(o)));
  const bad = [
    null, 'x', [], {}, { id: 'a', kind: 'wire', ms: 8000 }, { id: 'a', kind: 'fx', ms: 999, fx: 'dawn' }, { id: 'a', kind: 'fx', ms: 180001, fx: 'dawn' }, { id: 'a', kind: 'fx', ms: 5000.5, fx: 'dawn' },
    { id: '', kind: 'fx', ms: 5000, fx: 'dawn' }, { id: 'i'.repeat(41), kind: 'fx', ms: 5000, fx: 'dawn' }, { kind: 'fx', ms: 5000, fx: 'dawn' }, { id: 'a', kind: 'fx', ms: 5000, fx: 'dusk' },
    { id: 'a', kind: 'fx', ms: 5000, fx: 'dawn', text: 'smuggled' }, { id: 'a', kind: 'fx', ms: 5000, fx: 'dawn', svg: '<svg/>' }, { id: 'a', kind: 'text', ms: 5000, text: 'x', at: 'now' },
    { id: 'a', kind: 'text', ms: 5000, text: 'x'.repeat(121) }, { id: 'a', kind: 'text', ms: 5000, text: '  ' }, { id: 'a', kind: 'npc', ms: 5000, npcId: 'has space' }, { id: 'a', kind: 'npc', ms: 5000, npcId: 'npc_x', name: 'Name' },
    { id: 'a', kind: 'clock', ms: 8000, name: '', size: 6, filled: 2 }, { id: 'a', kind: 'clock', ms: 8000, name: 'n'.repeat(61), size: 6, filled: 2 }, { id: 'a', kind: 'clock', ms: 8000, name: 'x', size: 5, filled: 2 },
    { id: 'a', kind: 'clock', ms: 8000, name: 'x', size: 4, filled: 5 }, { id: 'a', kind: 'clock', ms: 8000, name: 'x', size: 4, filled: -1 }, { id: 'a', kind: 'clock', ms: 8000, name: 'x', size: 4, filled: 1.5 },
  ];
  bad.forEach((o) => assert.equal(P.overlayOk(o), false, JSON.stringify(o)));
  const g = P.makeGate();
  assert.equal(g.allowsAmbient({ overlay: ok[3] }), true); assert.equal(g.allowsAmbient({ overlay: null }), true); assert.equal(g.allowsAmbient({ auto: true }), true); assert.equal(g.allowsAmbient({ auto: null }), true);
  assert.equal(g.allowsAmbient({ overlay: bad[12] }), false, 'a stray field'); assert.equal(g.allowsAmbient({ overlay: 'dawn' }), false); assert.equal(g.allowsAmbient({ auto: 1 }), false); assert.equal(g.allowsAmbient({ auto: 'yes' }), false);
  assert.equal(g.allowsAmbient({ mode: 'off', overlay: bad[5] }), false, 'a good key does not carry a bad overlay');
  assert.equal(P.overlayLine(ok[3]), 'dawn · 30 s'); assert.equal(P.overlayLine(ok[0]), 'clock Invented Fuse 2/6 · 8 s'); assert.equal(P.overlayLine(null), ''); assert.equal(P.overlayLine({ kind: 'x' }), '');
  assert.equal(P.ipadView({ overlay: ok[3], auto: true }).overlayLine, 'dawn · 30 s'); assert.equal(P.ipadView({ overlay: ok[3], auto: true }).auto, true); assert.equal(P.ipadView({}).overlayLine, '');
});

await test('9j3. showOverlay and clearOverlay go through the ambient PATCH (so the gate runs); the iPad panel names the overlay and has Clear overlay; a bad overlay is refused before it is sent', async () => {
  const fg = addAmbient(fakeGm()), br = fakeBrowser(); const h = await openPage({ fg, br, camp: CAMP3 });
  await openIpad(h);
  const n0 = fg.server.ambPatches.length;
  assert.equal(typeof h.page.showOverlay, 'function'); assert.equal(typeof h.page.clearOverlay, 'function');
  assert.equal(h.q('#gm-ipad-overlay'), null, 'no overlay line while none is sent');
  await h.page.showOverlay({ kind: 'fx', fx: 'dawn', ms: 30000 });
  assert.equal(fg.server.ambPatches.length, n0 + 1);
  const sent = fg.server.ambPatches[n0];
  assert.deepEqual(Object.keys(sent), ['overlay']); assert.deepEqual(Object.keys(sent.overlay).sort(), ['fx', 'id', 'kind', 'ms']);
  assert.match(sent.overlay.id, /^ov-[a-z0-9]+$/); assert.ok(sent.overlay.id.length <= 40); assert.equal(sent.overlay.kind, 'fx');
  assert.match(h.q('#gm-ipad-overlay').textContent, /^Overlay sent: dawn · 30 s$/, 'drawn from the answer');
  await h.page.showOverlay({ id: 'my-own', kind: 'clock', ms: 8000, name: 'Invented Fuse', size: 8, filled: 3 });
  assert.equal(fg.server.ambPatches[n0 + 1].overlay.id, 'my-own', 'a given id is kept');
  assert.match(h.q('#gm-ipad-overlay').textContent, /clock Invented Fuse 3\/8 · 8 s/);
  /* refused before any request: a bad kind, a stray field, an svg, a too-long text, junk */
  br.toasts.length = 0;
  for (const bad of [{ kind: 'wire', ms: 5000 }, { kind: 'text', ms: 5000, text: 'x', svg: '<svg/>' }, { kind: 'text', ms: 5000, text: 'x'.repeat(121) }, { kind: 'fx', fx: 'dawn', ms: 10 }, { kind: 'npc', ms: 5000, npcId: 'no good' }]) {
    const r = await h.page.showOverlay(bad); assert.equal(r, null, JSON.stringify(bad));
  }
  assert.equal(await h.page.showOverlay(null), null); assert.equal(await h.page.showOverlay('dawn'), null);
  assert.equal(fg.server.ambPatches.length, n0 + 2, 'nothing was sent for them'); assert.equal(br.toasts.length, 5);
  /* the Clear overlay control */
  const btn = h.q('#gm-ipad [data-gm="clearoverlay"]'); assert.ok(btn && /Clear overlay/.test(btn.textContent), 'the iPad panel has Clear overlay');
  btn.click(); await until(() => fg.server.ambPatches.length === n0 + 3);
  assert.deepEqual(fg.server.ambPatches[n0 + 2], { overlay: null }); await until(() => !h.q('#gm-ipad-overlay'));
  assert.equal(fg.server.amb.doc.overlay, undefined);
  await h.page.showOverlay({ kind: 'text', ms: 5000, text: 'Invented line.' }); await h.page.clearOverlay();
  assert.deepEqual(fg.server.ambPatches[fg.server.ambPatches.length - 1], { overlay: null }, 'clearOverlay() sends null');
  /* a server refusal (a hidden NPC) is a toast and the panel keeps the server's value */
  br.toasts.length = 0; fg.server.ambFail = true;
  await h.page.showOverlay({ kind: 'npc', ms: 5000, npcId: 'npc_x' });
  assert.deepEqual(br.toasts[0], ['Could not change the iPad: the server said no', true]);
  assert.equal(h.q('#gm-ipad-overlay'), null);
  await h.save();
});

await test('9k. heat and wanted: the panel load sends a missing crew once; a changed campaign sends after the wait; off sends nothing', async () => {
  const fg = addAmbient(fakeGm()), br = fakeBrowser(); const h = await openPage({ fg, br, camp: CAMP3 });
  assert.equal(fg.server.ambPatches.length, 0, 'the page alone sends nothing');
  h.press('i'); await until(() => fg.server.ambPatches.length === 1);
  eqj(fg.server.ambPatches[0], { crew: { heat: 3, wanted: 1 } }, 'first load: the server had no crew');
  eqj(fg.server.amb.doc.crew, { heat: 3, wanted: 1 });
  h.press('i'); await tick(); await tick(); assert.equal(fg.server.ambPatches.length, 1, 'an up-to-date crew is not sent again');
  h.page.campaign({ session: { number: 3 }, crew: { heat: 6, wanted: 2 } });
  await tick(); assert.equal(fg.server.ambPatches.length, 1, 'debounced: not at once');
  await until(() => fg.server.ambPatches.length === 2, 700); eqj(fg.server.ambPatches[1], { crew: { heat: 6, wanted: 2 } });
  h.q('#gm-ipad [data-gm="ambmode"][data-v="off"]').click(); await until(() => fg.server.amb.doc.mode === 'off');
  h.page.campaign({ session: { number: 3 }, crew: { heat: 7, wanted: 2 } });
  await new Promise((r) => setTimeout(r, 2400)); assert.equal(fg.server.ambPatches.length, 3, 'only the mode change: the ambient is off');
  await h.save();
});

await test('9l. Set as score scene: a player-layer plan and iso from the roll, name and district only, never auto-updated; refused on the GM layer', async () => {
  const fg = addAmbient(fakeGm()), br = fakeBrowser({ B68Map: M }); const h = await openPage({ fg, br, camp: CAMP3 });
  h.press('b'); h.q('[data-gm="locroll"]').click(); const roll = h.page._state().locRoll; assert.ok(roll);
  assert.ok(h.q('[data-gm="scorescene"]') && /Set as score scene/.test(h.q('[data-gm="scorescene"]').textContent), 'beside Show on iPad');
  assert.equal(h.q('[data-gm="scorescene"]').hasAttribute('disabled'), true, 'GM layer: disabled'); h.q('[data-gm="scorescene"]').click(); await tick();
  assert.equal(fg.server.ambPatches.length, 0, 'GM layer: nothing sent'); assert.ok(br.toasts.some((x) => /player layer/i.test(x[0]) && x[1]));
  h.q('[data-gm="layer"][data-v="player"]').click(); assert.equal(h.q('[data-gm="scorescene"]').hasAttribute('disabled'), false);
  h.q('[data-gm="scorescene"]').click(); await until(() => fg.server.ambPatches.length === 1);
  const sc = fg.server.ambPatches[0].score;
  assert.deepEqual(Object.keys(sc).sort(), ['board', 'district', 'iso', 'name', 'reveal', 'target', 'view']);
  assert.deepEqual([sc.name, sc.district, sc.target, sc.reveal], [roll.name, roll.district || '', '', ['public']]);
  assert.ok(sc.view === 'plan' || sc.view === 'rings'); assert.ok(sc.board.startsWith('<svg') && sc.iso.startsWith('<svg'));
  assert.deepEqual(P.leaks(sc.board, roll, ['public']), []); assert.deepEqual(P.leaks(sc.iso, roll, ['public']), []);
  checkSvg(sc.board); checkSvg(sc.iso);
  assert.ok(h.page._ambient().doc.score, 'drawn from the answer');
  // more bands ticked: it does not change by itself
  const before = JSON.stringify(fg.server.amb.doc.score);
  h.q('[data-reveal="working"]').checked = true; dispatch(h.q('[data-reveal="working"]'), 'change'); await tick(); await tick();
  assert.equal(fg.server.ambPatches.length, 1, 'revealing a band sends nothing'); assert.equal(JSON.stringify(fg.server.amb.doc.score), before);
  h.press('i'); await until(() => h.q('#gm-ipad-score')); assert.match(h.q('#gm-ipad-score').textContent, new RegExp('^' + roll.name.replace(/[.*+?^$${}()|[\]\\]/g, '\\$&')));
  await h.save();
});

function pickSel(h, sel, v) { const s = h.q(sel); s.value = v; dispatch(s, 'change'); }
await test('9m. map kit 0.7 in the Location panel: iso by default, the street and the plate, time and weather; the iPad copy at the iPad\'s size', async () => {
  // pure: the kit's options from the controls
  eqj(P.mapOpts({}, 'gm', ['public']), { view: 'iso', theme: 'rulebook', layer: 'gm', reveal: ['public'], width: 1400 }, 'the defaults');
  eqj(P.mapOpts({ view: 'street', theme: 'plate', time: 'Night', weather: 'fog' }, 'player', ['public'], P.IPAD_MAP),
    { view: 'street', theme: 'plate', layer: 'player', reveal: ['public'], time: 'Night', weather: 'fog', layout: 'ipad' });
  eqj([P.mapOpts({ weather: 'rolled' }, 'gm', []).weather, P.mapOpts({ weather: 'none' }, 'gm', []).weather, 'weather' in P.mapOpts({ weather: '' }, 'gm', []), 'time' in P.mapOpts({ time: 'Dawn' }, 'gm', [])], [true, false, false, false], 'rolled, none, unset, an unknown time');
  eqj(P.mapOpts({ view: 'nope', theme: 'nope' }, 'gm', []).view + ' ' + P.mapOpts({ view: 'nope', theme: 'nope' }, 'gm', []).theme, 'iso rulebook');
  assert.ok(P.VIEWS.includes('street') && P.THEMES.includes('plate'));
  // the page
  const fg = addAmbient(fakeGm()), br = fakeBrowser({ B68Map: M }); const h = await openPage({ fg, br, camp: CAMP3 });
  h.press('b'); h.q('[data-gm="locroll"]').click(); const roll = h.page._state().locRoll; assert.ok(roll);
  assert.equal(h.page._state().doc.loc.map.view, 'iso', 'a roll draws iso'); assert.ok(h.page._state().map && /<svg/.test(h.page._state().map.svg));
  assert.ok(h.q('#gm-m-time') && h.q('#gm-m-weather'), 'Time and Weather under View & theme');
  assert.deepEqual([...h.q('#gm-m-view').children].map((o) => o.getAttribute('value')), ['iso', 'rings', 'plan', 'section', 'street']);
  pickSel(h, '#gm-m-view', 'street'); pickSel(h, '#gm-m-theme', 'plate'); pickSel(h, '#gm-m-time', 'Night'); pickSel(h, '#gm-m-weather', 'rain');
  const mp = h.page._state().doc.loc.map; eqj([mp.view, mp.theme, mp.time, mp.weather], ['street', 'plate', 'Night', 'rain']);
  const want = M.render(roll, { view: 'street', theme: 'plate', layer: 'gm', reveal: ['public'], time: 'Night', weather: 'rain', width: 1400 }).svg;
  assert.equal(h.page._state().map.svg, want, 'the preview is the kit\'s own render of these controls');
  assert.match(h.q('.gm-mapopts summary').textContent, /street · plate · at night · rain/);
  h.q('[data-gm="layer"][data-v="player"]').click(); h.q('[data-gm="ipad"]').click(); await until(() => fg.server.displays.length === 1);
  const d = fg.server.displays[0]; assert.equal(d.kind, 'svg');
  assert.equal(d.svg, M.render(roll, Object.assign({ view: 'street', theme: 'plate', layer: 'player', reveal: ['public'], time: 'Night', weather: 'rain' }, P.IPAD_MAP)).svg, 'the iPad copy: the player layer at the iPad\'s size');
  checkSvg(d.svg); assert.deepEqual(P.leaks(d.svg, roll, ['public']), []);
  await h.save();
});

await test('9n. live reveal: while the map is on the iPad, opening a band asks and sends it again, closing one sends without asking; no to the ask keeps the band shut', async () => {
  const fg = addAmbient(fakeGm()), br = fakeBrowser({ B68Map: M }); const h = await openPage({ fg, br, camp: CAMP3 });
  h.press('b'); h.q('[data-gm="locroll"]').click(); const roll = h.page._state().locRoll;
  const tickBand = async (b, on) => { const el = h.q('[data-reveal="' + b + '"]'); el.checked = on; dispatch(el, 'change'); await tick(); await tick(); };
  // not on the iPad yet: ticking sends nothing
  h.q('[data-gm="layer"][data-v="player"]').click(); await tickBand('working', true);
  assert.equal(fg.server.displays.length, 0, 'not on the iPad: a band only redraws here'); await tickBand('working', false);
  const asked = []; br.W.confirm = (m) => { asked.push(m); return true; };
  h.q('[data-gm="ipad"]').click(); await until(() => fg.server.displays.length === 1);
  assert.match(fg.server.displays[0].caption, /surveyed: public$/); assert.equal(asked.length, 0, 'public only: no ask');
  await until(() => /Live on the iPad/.test(h.q('.gm-reveal legend').textContent)); assert.ok(h.q('.gm-live'), 'the legend says the bands are live');
  await tickBand('working', true); await until(() => fg.server.displays.length === 2);
  assert.equal(asked.length, 1); assert.match(asked[0], /opening the working band shows it to the players now/);
  const d2 = fg.server.displays[1]; assert.match(d2.caption, /surveyed: public, working$/);
  assert.equal(d2.svg, M.render(roll, Object.assign({ view: 'iso', theme: 'rulebook', layer: 'player', reveal: ['public', 'working'] }, P.IPAD_MAP)).svg);
  checkSvg(d2.svg); assert.deepEqual(P.leaks(d2.svg, roll, ['public', 'working']), []);
  await tickBand('working', false); await until(() => fg.server.displays.length === 3);
  assert.equal(asked.length, 1, 'closing does not ask'); assert.match(fg.server.displays[2].caption, /surveyed: public$/);
  br.W.confirm = (m) => { asked.push(m); return false; };
  await tickBand('controlled', true); await tick();
  assert.equal(fg.server.displays.length, 3, 'no: nothing sent'); assert.notEqual(h.page._state().doc.loc.map.reveal.controlled, true, 'no: the band stays shut');
  assert.equal(h.q('[data-reveal="controlled"]').checked, false);
  // the GM layer: the iPad keeps what it has, and live reveal ends there (9p)
  br.W.confirm = () => true; h.q('[data-gm="layer"][data-v="gm"]').click(); await tickBand('working', true);
  assert.equal(fg.server.displays.length, 3, 'GM layer: nothing goes'); assert.ok(!h.q('.gm-live'));
  h.q('[data-gm="layer"][data-v="player"]').click(); await tickBand('working', false);
  assert.equal(fg.server.displays.length, 3, 'back on the player layer it is not live until Show on iPad');
  // something else on the iPad: the map is not live any more
  h.q('[data-gm="ipad"]').click(); await until(() => fg.server.displays.length === 4); await until(() => h.q('.gm-live'));
  h.q('[data-gm="pushtext"]').click(); await until(() => fg.server.displays.length === 5);
  await tickBand('working', true); await tick(); await tick();
  assert.equal(fg.server.displays.length, 5, 'the street description is up: a band sends nothing'); assert.ok(!h.q('.gm-live'));
  // a new roll is a new map: not live either
  h.q('[data-gm="ipad"]').click(); await until(() => fg.server.displays.length === 6);
  h.q('[data-gm="locroll"]').click(); h.q('[data-gm="layer"][data-v="player"]').click(); await tickBand('working', true);
  assert.equal(fg.server.displays.length, 6, 'another roll: nothing goes');
  await h.save();
});

await test('9o. the score scene does not follow the bands (it never updates on its own); the map box says when it is behind', async () => {
  const fg = addAmbient(fakeGm()), br = fakeBrowser({ B68Map: M }); const h = await openPage({ fg, br, camp: CAMP3 });
  h.press('b'); h.q('[data-gm="locroll"]').click(); h.q('[data-gm="layer"][data-v="player"]').click();
  h.q('[data-gm="scorescene"]').click(); await until(() => fg.server.ambPatches.length === 1);
  await until(() => h.page._ambient().doc && h.page._ambient().doc.score); h.page._render && h.page._render();
  assert.ok(!h.q('.gm-scene-behind'), 'up to date');
  const el = h.q('[data-reveal="working"]'); el.checked = true; dispatch(el, 'change'); await tick(); await tick();
  assert.equal(fg.server.ambPatches.length, 1, 'nothing sent');
  assert.ok(h.q('.gm-scene-behind') && /The score scene shows public: press Set as score scene/.test(h.q('.gm-scene-behind').textContent));
  await h.save();
});

/* ---------- live reveal, the secrecy review of 23/10/2026 (R1-R4): what reaches the iPad is what the GM confirmed ---------- */
const tickBandOf = (h) => async (b, on) => { const el = h.q('[data-reveal="' + b + '"]'); el.checked = on; dispatch(el, 'change'); await tick(); await tick(); };
/* a server whose PUTs land when the test says (two requests on two connections may land in either order) */
function deferDisplay(fg) {
  const pending = [], real = fg.realSetDisplay = fg.realSetDisplay || fg.gm.setDisplay;
  fg.gm.setDisplay = (d) => new Promise((res, rej) => { pending.push(() => real(d).then(res, rej)); });
  return pending;
}
async function liveSetup(over) {
  const fg = addAmbient(fakeGm()), br = fakeBrowser({ B68Map: (over && over.kit) || M }); const h = await openPage({ fg, br, camp: CAMP3 });
  const asked = []; br.W.confirm = (m) => { asked.push(m); return !(over && over.no && over.no(m)); };
  h.press('b'); h.q('[data-gm="locroll"]').click(); h.q('[data-gm="layer"][data-v="player"]').click();
  return { fg, br, h, asked, tickBand: tickBandOf(h), live: () => !!h.q('.gm-reveal .gm-live') };
}

await test('9p. (R1) the GM layer ends live reveal: bands ticked there never reach the iPad unconfirmed, and the legend stops saying Live', async () => {
  const { fg, h, asked, tickBand, live } = await liveSetup();
  h.q('[data-gm="ipad"]').click(); await until(() => fg.server.displays.length === 1);
  await until(() => live()); assert.equal(asked.length, 0, 'public only: no ask');
  h.q('[data-gm="layer"][data-v="gm"]').click(); await tick();
  assert.ok(!live(), 'the GM layer: the legend no longer says Live on the iPad');
  await tickBand('secure', true); await tickBand('working', true);
  h.q('[data-gm="layer"][data-v="player"]').click(); await tick();
  assert.ok(!live(), 'back on the player layer: not live again by itself');
  await tickBand('working', false); await tick(); await tick();
  assert.equal(fg.server.displays.length, 1, 'closing a band sends nothing: live reveal ended on the GM layer');
  assert.equal(asked.length, 0);
  // Show on iPad again asks for every band beyond public, by name
  h.q('[data-gm="ipad"]').click(); await until(() => fg.server.displays.length === 2);
  assert.equal(asked.length, 1); assert.match(asked[0], /secure/); assert.match(fg.server.displays[1].caption, /surveyed: public, secure$/);
  await until(() => live());
  // while live, a push that would send any band the iPad does not have asks for all of them by name, whichever box fired
  const pending = deferDisplay(fg);
  await tickBand('working', true);                 // asks for working; its PUT is still in flight
  assert.equal(asked.length, 2); assert.match(asked[1], /working/); assert.doesNotMatch(asked[1], /secure/, 'secure is on the iPad already');
  await tickBand('controlled', true);              // the iPad still has public, secure: working and controlled are both new
  assert.equal(asked.length, 3); assert.match(asked[2], /working/); assert.match(asked[2], /controlled/);
  while (pending.length) { pending.shift()(); await tick(); await tick(); }
  await until(() => /surveyed: public, working, controlled, secure$/.test(fg.server.shown.caption || ''));
  await until(() => live());
  await h.save();
});

await test('9q. (R2) quick toggles: one PUT in flight at a time, a newer state replaces queued ones, and the last state the GM set is what ends on the iPad', async () => {
  const { fg, h, tickBand, live } = await liveSetup();
  h.q('[data-gm="ipad"]').click(); await until(() => fg.server.displays.length === 1); await until(() => live());
  const pending = deferDisplay(fg);
  await tickBand('controlled', true); await tickBand('controlled', false); await tickBand('working', true); await tickBand('working', false);
  assert.equal(pending.length, 1, 'one request in flight; the others wait');
  assert.ok(!live(), 'while a push is on its way the legend does not claim the iPad has these bands');
  pending.shift()(); await tick(); await tick(); await tick();
  assert.equal(pending.length, 1, 'then only the newest state goes: the two in between were replaced');
  pending.shift()(); await tick(); await tick(); await tick();
  assert.equal(pending.length, 0);
  assert.equal(fg.server.displays.length, 3, 'Show on iPad, the first toggle, the last state');
  assert.match(fg.server.shown.caption, /surveyed: public$/, 'the iPad ends on what the GM last set (both bands shut)');
  await until(() => live());
  // the same through the real ordering: a push never starts while another is in flight, whatever kind it is
  const p2 = deferDisplay(fg);
  await tickBand('working', true); h.q('[data-gm="blankipad"]').click(); await tick();
  assert.equal(p2.length, 1, 'Clear waits for the map in flight'); p2.shift()(); await tick(); await tick();
  assert.equal(p2.length, 1); p2.shift()(); await tick(); await tick();
  assert.equal(fg.server.shown.kind, 'blank', 'Clear, pressed last, is what the iPad shows'); assert.ok(!live(), 'Clear ends live reveal');
  await h.save();
});

await test('9r. (R3) a band that cannot be closed safely clears the iPad and says so; one that cannot be opened stays shut', async () => {
  /* a kit stub that names a hidden room whenever "working" is shut and "controlled" is open (stands in for any fault the scan catches) */
  const stub = Object.assign({}, M, { render: (roll, o) => {
    const r = M.render(roll, o), rv = o.reveal || [];
    if (o.layer === 'player' && ((!rv.includes('working') && rv.includes('controlled')) || rv.includes('secure'))) { const w = roll.rooms.find((x) => x.band === (rv.includes('secure') ? 'controlled' : 'working') && !rv.includes(x.band)) || roll.rooms.find((x) => !rv.includes(x.band)); return Object.assign({}, r, { svg: w ? r.svg.replace('</svg>', '<text>' + w.name + '</text></svg>') : r.svg }); }
    return r;
  } });
  const { fg, br, h, tickBand, live } = await liveSetup({ kit: stub });
  await tickBand('working', true); await tickBand('controlled', true);
  h.q('[data-gm="ipad"]').click(); await until(() => fg.server.displays.length === 1); await until(() => live());
  br.toasts.length = 0;
  await tickBand('working', false); await until(() => fg.server.displays.length === 2);
  assert.equal(fg.server.shown.kind, 'blank', 'the map without working would name a hidden room: the iPad is cleared, not left showing working');
  assert.ok(!live(), 'live reveal ends'); assert.ok(br.toasts.some(([m, bad]) => bad && /cleared/i.test(m)), 'and the page says so');
  // an open that cannot be sent: nothing goes and the band stays shut
  await tickBand('working', true); await tickBand('controlled', false);     /* not live: these only change the ticks */
  h.q('[data-gm="ipad"]').click(); await until(() => fg.server.displays.length === 3); await until(() => live());
  br.toasts.length = 0;
  await tickBand('secure', true); await tick(); await tick();
  assert.equal(fg.server.displays.length, 3, 'nothing sent'); assert.equal(h.q('[data-reveal="secure"]').checked, false, 'the band stays shut');
  assert.notEqual(h.page._state().doc.loc.map.reveal.secure, true); assert.ok(live(), 'the iPad still shows what it showed, and live reveal goes on');
  assert.ok(br.toasts.some(([m, bad]) => bad && /not sent/i.test(m)));
  await h.save();
});

await test('9s. (R4) live reveal sends the view, theme, time and weather Show on iPad sent, not what is on screen', async () => {
  const { fg, h, tickBand, live } = await liveSetup();
  pickSel(h, '#gm-m-view', 'street'); pickSel(h, '#gm-m-theme', 'plate'); pickSel(h, '#gm-m-time', 'Night'); pickSel(h, '#gm-m-weather', 'rain');
  h.q('[data-gm="ipad"]').click(); await until(() => fg.server.displays.length === 1); await until(() => live());
  pickSel(h, '#gm-m-view', 'section'); pickSel(h, '#gm-m-theme', 'board'); pickSel(h, '#gm-m-time', ''); pickSel(h, '#gm-m-weather', 'none');
  await tickBand('working', true); await until(() => fg.server.displays.length === 2);
  const roll = h.page._state().locRoll;
  const want = M.render(roll, Object.assign({ view: 'street', theme: 'plate', layer: 'player', reveal: ['public', 'working'], time: 'Night', weather: 'rain' }, P.IPAD_MAP)).svg;
  assert.equal(fg.server.displays[1].svg, want, 'the street on the plate at Night in the rain, with working');
  await h.save();
});

await test('9t. (R4) live reveal follows the display seq, not a title: anything pushed since (another device, the chase panel, the same title) is never overwritten', async () => {
  const { fg, br, h, tickBand, live } = await liveSetup();
  h.q('[data-gm="ipad"]').click(); await until(() => fg.server.displays.length === 1); await until(() => live());
  const mine = fg.server.displays[0];
  fg.server.otherDevice({ kind: 'svg', title: mine.title, caption: 'from the other laptop', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>x</title></svg>' });
  br.toasts.length = 0;
  await tickBand('working', true); await tick(); await tick(); await tick();
  assert.equal(fg.server.displays.length, 1, 'nothing landed'); assert.equal(fg.server.shown.caption, 'from the other laptop', 'the other push stays');
  assert.ok(!live(), 'live reveal ends'); assert.ok(br.toasts.some(([m, bad]) => bad && /something else is on the iPad/i.test(m)));
  // anything this page pushes ends live reveal at once, whatever its title
  h.q('[data-gm="ipad"]').click(); await until(() => fg.server.displays.length === 2); await until(() => live());
  h.q('[data-gm="pushtext"]').click(); await until(() => fg.server.displays.length === 3); assert.ok(!live());
  await tickBand('working', false); await tick(); await tick(); assert.equal(fg.server.displays.length, 3);
  // and a new roll is not live
  h.q('[data-gm="ipad"]').click(); await until(() => fg.server.displays.length === 4); await until(() => live());
  h.q('[data-gm="locroll"]').click(); h.q('[data-gm="layer"][data-v="player"]').click(); await tickBand('working', true);
  assert.equal(fg.server.displays.length, 4); assert.ok(!live());
  await h.save();
});

await test('10a. the laptop layout: body.gm-app while open, the top bar (session, iPad, listening), the menu, F for Focus with the console as its keys, Classic layout on this device', async () => {
  const fg = fakeGm(), br = fakeBrowser(); const h = await openPage({ fg, br, camp: CAMP3 });
  assert.ok(br.doc.body.classList.contains('gm-app'), 'on while the tools are open');
  assert.equal(h.q('#gm-bar-sess').textContent, 'Session 3');
  await until(() => /^iPad: /.test(h.q('#gm-bar-ipad').textContent)); assert.match(h.q('#gm-bar-ipad').textContent, /^iPad: /);
  assert.ok(/Clear → ambient/.test(h.q('.gm-bar [data-gm="blankipad"]').textContent) && h.q('.gm-bar [data-gm="darkipad"]'), 'Clear and Lights out in the bar');
  assert.equal(h.qa('.gm-bar .gm-save').length, 1, 'saving shows in the bar');
  assert.equal(h.q('.gm-menu-list').hasAttribute('hidden'), true, 'the menu starts shut');
  h.q('[data-gm="menu"]').click(); assert.equal(h.q('.gm-menu-list').hasAttribute('hidden'), false); assert.equal(h.q('[data-gm="menu"]').getAttribute('aria-expanded'), 'true');
  assert.ok(['note', 'clearcap', 'update', 'forget'].every((a) => h.q('.gm-menu-list [data-gm="' + a + '"]')), 'export, clear the capture, update and forget are in it');
  assert.ok(h.q('.gm-menu-list a[href="#display"]') && h.qa('.gm-bar a[href="#display"]').every((a) => a.closest('.gm-menu-list')), 'the display page opens from the Menu, not the bar');
  assert.ok(!h.q('.gm-capacts [data-gm="note"]') && !h.q('.gm-capacts [data-gm="clearcap"]') && h.q('.gm-capacts [data-gm="last"]'), 'the capture bar keeps File last roll only');
  assert.equal(h.q('#gm-bar-stt').hasAttribute('hidden'), true, 'no Listening pill while the transcriber has never been set up');
  assert.ok(/GM screen/.test(h.q('.gm-tab[data-panel="rules"]').textContent) && /GM screen/.test(h.q('[data-gm="seg"][data-seg="rules"]').textContent), 'the Screen tab is called GM screen');
  h.q('[data-gm="menu"]').click(); assert.equal(h.q('.gm-menu-list').hasAttribute('hidden'), true, 'a second press shuts it');
  h.q('[data-gm="menu"]').click(); h.press('Escape'); assert.equal(h.q('.gm-menu-list').hasAttribute('hidden'), true, 'Escape shuts it');
  assert.equal(h.qa('#gm-mini button').length, 4, 'the console as its four keys');
  h.press('f'); assert.ok(h.q('#gm-root').classList.contains('focus')); assert.equal(h.q('[data-gm="focus"]').getAttribute('aria-pressed'), 'true');
  assert.equal(br.ls.get('b68.gm.prepWide'), '1', 'remembered on this device');
  h.qa('#gm-mini button')[0].click(); await until(() => fg.server.patches.some((p) => p.cards && p.cards.situation));
  assert.ok(fg.server.patches.some((p) => p.cards && p.cards.situation), 'a key in Focus rolls');
  assert.ok(!h.q('#gm-root').classList.contains('focus') && br.ls.get('b68.gm.prepWide') === '0', 'a roll leaves Focus, so the card is never rolled into a hidden box');
  assert.ok(h.q('#gm-card .gm-card') && br.toasts.some((x) => /Focus off/.test(x[0])), 'the card shows, and a toast says why Focus went');
  br.toasts.length = 0; h.press('f'); h.qa('#gm-mini button')[1].click(); await until(() => fg.server.patches.filter((p) => p.cards && p.cards.situation).length >= 2);
  assert.ok(!h.q('#gm-root').classList.contains('focus') && !br.toasts.some((x) => /Focus off/.test(x[0])), 'the second time it goes without the toast (once per page load)');
  h.press('f'); assert.ok(h.q('#gm-root').classList.contains('focus'));
  h.q('[data-gm="focus"]').click(); assert.ok(!h.q('#gm-root').classList.contains('focus'), 'the button turns it off');
  h.q('[data-gm="menu"]').click(); h.q('.gm-menu-list [data-gm="note"]').click();
  assert.equal(h.q('.gm-menu-list').hasAttribute('hidden'), true, 'the menu shuts after an item');
  assert.ok(!h.q('[data-gm="layout-classic"]') && !h.q('[data-gm="layout-app"]'), 'no layout switch: the app layout is the only one');
  await h.save();
  assert.ok(!br.doc.body.classList.contains('gm-app'), 'off once the page closes');
});
await test('10c. the full rules, searched in the GM screen pane: the hits are listed with a snippet, one opens in place with Show on iPad and its twins, the rules page stays a link; Find lists rules; a module that cannot search opens the rules page', async () => {
  const loads = [], opened = [];
  const ROWS = [
    { id: 'b68/harm', book: 'b68', slug: 'harm', title: 'Harm', caption: 'Blades ’68 · Consequences', snip: 'Level 1 is <mark>lesser</mark> harm.<script>alert(1)</script>', href: '#rules/b68/harm' },
    { id: 'house/hard-knocks', book: 'house', slug: 'hard-knocks', title: 'Hard knocks', caption: 'House rules', snip: 'Take <mark>harm</mark> twice.', href: '#rules/house/hard-knocks' }];
  const ENTRY = {
    'b68/harm': { id: 'b68/harm', title: 'Harm', caption: 'Blades ’68 · Consequences', href: '#rules/b68/harm', md: 'Level 1 is **lesser** harm.', also: [{ id: 'bitd/harm', label: 'In Blades in the Dark' }] },
    'bitd/harm': { id: 'bitd/harm', title: 'Harm', caption: 'Blades in the Dark', href: '#rules/bitd/harm', md: 'The SRD’s harm.', also: [{ id: 'b68/harm', label: 'In Blades ’68' }] } };
  const rules = { available: () => true, load: async (cacheOnly) => { loads.push(cacheOnly ? 'cache' : 'full'); return { entries: [{}] }; },
    hits: (q) => (q === 'harm' ? { total: 9, hits: ROWS } : { total: 0, hits: [] }), entry: (id) => ENTRY[id] || null };
  const SCREEN = { version: 'g1', src: {}, body: { v: 1, title: 'Screen', intro: '', sections: [{ id: 'rolling', title: 'Rolling', md: 'Ask what they want.' }, { id: 'weather', title: 'Weather', md: 'A squall.' }] } };
  const br = fakeBrowser({ B68Rules: rules, open: (u) => { opened.push(u); } }), fg = fakeGm(undefined, { screen: SCREEN });
  const h = await openPage({ br, fg, camp: CAMP3 });
  h.press('t');
  assert.ok(h.q('#gm-rq') && h.q('#gm-rq-hits') && !h.q('.gs-rules a[target="_blank"]'), 'a search box and a hits box, no new-tab chips');
  assert.ok(h.qa('[data-gm="rq"]').length >= 6, 'the common terms are buttons that search here');
  assert.ok(h.q('[data-gm="gs-rules"]'), 'a jump chip to the full rules sits with the sections');
  h.q('#gm-rq').value = 'harm'; dispatch(h.q('form[data-gm-form="rules"]'), 'submit');
  assert.ok(await until(() => h.qa('.gs-hit').length === 2), 'the hits are listed in the pane'); assert.deepEqual(loads, ['full'], 'the corpus was asked for once');
  const row = h.qa('.gs-hit')[0];
  assert.ok(/Harm/.test(row.querySelector('.gs-hit-t').textContent) && /Blades ’68 · Consequences/.test(row.querySelector('.gs-hit-c').textContent) && /lesser harm/.test(row.querySelector('.gs-hit-s').textContent), 'title, book and chapter, a snippet');
  assert.equal(row.querySelectorAll('.gs-hit-s mark').length, 1, 'the matched word is marked'); assert.equal(h.qa('#gm-rq-hits script').length, 0, 'nothing but <mark> survives in a snippet');
  assert.match(h.q('.gs-hitbar .gm-lab').textContent, /2 of 9 for “harm”/);
  const out = h.q('.gs-hitbar a[target="_blank"]');
  assert.ok(out && out.getAttribute('href') === '#rules?q=harm' && /Open in the Rules page/.test(out.textContent) && out.getAttribute('rel') === 'noopener', 'the rules page stays as a link (a new tab)');
  assert.equal(fg.server.displays.length, 0, 'a list sends nothing to the iPad');
  /* a screen filter does not touch the hits, and with nothing left on the screen it offers the same words to the rules */
  const gq = h.q('#gm-gs-q'); gq.value = 'zzz'; dispatch(gq, 'input');
  assert.ok(!h.q('.gs-none').hidden && /Search the full rules for “zzz”/.test(h.q('[data-gm="rq-find"]').textContent), 'nothing on the screen: one click to the full rules with the same words');
  assert.equal(h.qa('.gs-hit').filter((x) => x.hidden).length, 0, 'the screen filter leaves the hits alone');
  gq.value = 'squall'; dispatch(gq, 'input'); h.press('Enter', { target: gq }); assert.equal(h.qa('.gs-hit').length, 2, 'Enter with a match on the screen goes to that section, not to the rules');
  gq.value = 'harm'; dispatch(gq, 'input'); h.q('#gm-rq-hits').innerHTML = ''; h.press('Enter', { target: gq });
  assert.ok(await until(() => h.qa('.gs-hit').length === 2), 'Enter with nothing on the screen searches the full rules'); assert.equal(h.q('#gm-rq').value, 'harm');
  gq.value = ''; dispatch(gq, 'input');
  /* one entry opens in place */
  h.qa('.gs-hit')[0].click();
  assert.equal(h.qa('.gs-hit').length, 0, 'the list gives way to the entry');
  assert.ok(/Harm/.test(h.q('.gs-entry .gs-h').textContent) && /Blades ’68 · Consequences/.test(h.q('.gs-entry .gs-h').textContent) && /lesser/.test(h.q('.gs-entry .gs-body').textContent), 'the entry is read in place');
  assert.ok(h.q('.gs-hitbar a[target="_blank"][href="#rules/b68/harm"]'), 'the entry on the rules page, in a new tab');
  assert.ok(h.q('[data-gm="rq-open"][data-id="bitd/harm"]'), 'its twin in the other book is a chip');
  h.q('[data-gm="rq-ipad"]').click(); assert.ok(await until(() => fg.server.displays.length === 1));
  eqj(fg.server.displays[0], { kind: 'rule', title: 'Harm', caption: 'Blades ’68 · Consequences', md: 'Level 1 is **lesser** harm.' }, 'Show on iPad sends the entry as a rule display, as the rules page does');
  assert.ok(br.toasts.some((x) => /On the iPad: Harm/.test(x[0])), 'and says so');
  h.q('[data-gm="rq-open"][data-id="bitd/harm"]').click(); assert.match(h.q('.gs-entry .gs-body').textContent, /SRD/, 'the twin opens in the same place');
  h.q('[data-gm="rq-back"]').click(); assert.equal(h.qa('.gs-hit').length, 2, 'Back is the list again'); assert.deepEqual(loads, ['full', 'full'], 'without a new search of its own');
  h.qa('[data-gm="rq"]')[0].click(); assert.ok(await until(() => /Nothing in the rules matches/.test(h.q('#gm-rq-hits').textContent)), 'a term with no hit says so, in the pane');
  assert.ok((h.q('.gs-rules a[target="_blank"]') || { getAttribute: () => '' }).getAttribute('href').startsWith('#rules?q='), 'with the rules page as a link');
  assert.equal(opened.length, 0, 'nothing opened a new tab');
  /* Find lists the rules this device holds, and Enter opens one in the pane */
  h.press('k', { ctrlKey: true }); assert.ok(await until(() => loads.includes('cache')), 'Find reads the copy on this device, never the network');
  const fq = h.q('#gm-find-q'); fq.value = 'harm'; dispatch(fq, 'input');
  const rk = h.qa('.gm-find-hit').filter((b) => /Rules/.test(b.querySelector('.gm-find-kind').textContent));
  assert.equal(rk.length, 2, 'two rules entries in Find'); assert.equal(rk[0].querySelectorAll('.gm-find-snip mark').length, 1, 'with the matched word marked'); assert.ok(/Blades ’68 · Consequences/.test(rk[0].textContent));
  h.press('Escape', { target: fq }); h.press('Escape');
  h.press('k', { ctrlKey: true }); const fq2 = h.q('#gm-find-q'); fq2.value = 'harm'; dispatch(fq2, 'input');
  h.qa('.gm-find-hit').filter((b) => /Rules/.test(b.querySelector('.gm-find-kind').textContent))[0].click();
  assert.ok(await until(() => h.q('.gs-entry')), 'a rules hit in Find opens the entry in the GM screen pane'); assert.equal(h.page._state().panel, 'rules'); assert.ok(h.q('#gm-find').hasAttribute('hidden'), 'Find shuts');
  await h.save();
  /* an empty corpus, and a failure, say so in the pane */
  const e1 = await openPage({ br: fakeBrowser({ B68Rules: { available: () => true, load: async () => ({ entries: [] }), hits: () => ({ total: 0, hits: [] }), entry: () => null } }), camp: CAMP3 });
  e1.press('t'); e1.q('#gm-rq').value = 'heat'; dispatch(e1.q('form[data-gm-form="rules"]'), 'submit');
  assert.ok(await until(() => /No rules are imported yet/.test(e1.q('#gm-rq-hits').textContent)), 'an empty corpus is said, with the rules page as the way on'); await e1.save();
  const e2 = await openPage({ br: fakeBrowser({ B68Rules: { available: () => true, load: async () => { throw new Error('offline'); }, hits: () => ({ total: 0, hits: [] }), entry: () => null } }), camp: CAMP3 });
  e2.press('t'); e2.q('#gm-rq').value = 'heat'; dispatch(e2.q('form[data-gm-form="rules"]'), 'submit');
  assert.ok(await until(() => /could not be searched: offline/.test(e2.q('#gm-rq-hits').textContent) && e2.q('#gm-rq-hits a[target="_blank"]')), 'a failure says why, with the rules page as the way on'); await e2.save();
  /* a module without search: the rules page opens in a new tab, as it always did */
  const br2 = fakeBrowser({ B68Rules: { available: () => true }, open: (u) => { opened.push(u); } }), h2 = await openPage({ br: br2, camp: CAMP3 });
  h2.press('t'); h2.q('#gm-rq').value = 'heat'; dispatch(h2.q('form[data-gm-form="rules"]'), 'submit');
  assert.deepEqual(opened, ['#rules?q=heat'], 'a module without hits(): the rules page opens as before');
  await h2.save();
});
await test('10b. the rail: an empty box is one line; an old layout preference left in storage changes nothing', async () => {
  const br = fakeBrowser(); br.ls.set('b68.gm.layout', 'classic'); br.ls.set('b68.gm.view', 'classic'); const h = await openPage({ br, camp: CAMP3 });
  assert.ok(br.doc.body.classList.contains('gm-app') && h.qa('#gm-buttons .gm-btn').length === 4, 'the app layout and the four Situations, whatever this device remembered');
  const empties = [...h.qa('#gm-rail .gm-box-empty')].map((b) => b.textContent.replace(/\s+/g, ' ').trim());
  assert.ok(empties.includes('Table clocks · none'), JSON.stringify(empties));
  assert.ok(h.q('#gm-rail .gm-owed'), 'a box with something in it keeps its list (the fixture owes bargains)');
  await h.save();
});

/* =====================================================================================================================
   11. Table aids (17/10): Find, the beat in the bar, a speaker named from a line, the clocks to the iPad, the pack guard
   ===================================================================================================================== */
await test('11a. findHits: every word somewhere, the title first, curly and straight apostrophes are one; the snippet sits on the word', () => {
  const idx = [
    { kind: 'Prep', title: 'The score', text: 'Bazso’s crew waits at the ferry. ' + 'x '.repeat(80) + 'Later: the lamp.' },
    { kind: 'NPC', title: 'Marge Teacup', sub: 'Fence', text: 'Sells lamps; owes Bazso.' },
    { kind: 'Screen', title: 'Lamps and light', text: 'Rules for lamps.' },
  ];
  assert.deepEqual(P.findHits(idx, 'lamp').map((h) => h.title), ['Lamps and light', 'The score', 'Marge Teacup'], 'title hits first, then index order');
  assert.deepEqual(P.findHits(idx, "bazso's").map((h) => h.title), ['The score'], 'a straight apostrophe finds a curly one');
  assert.deepEqual(P.findHits(idx, 'marge fence').map((h) => h.title), ['Marge Teacup'], 'words may sit in title and sub');
  assert.deepEqual(P.findHits(idx, '   '), []);
  const sn = P.findHits(idx, 'later')[0].snip;
  assert.ok(sn.startsWith('…') && sn.includes('Later: the lamp.'), sn);
});

await test('11a2. findText reads Markdown as words (callouts, quotes, boxes, tables out); shortLabel cuts at a word', () => {
  assert.equal(P.findText('> [!quote] SAY\n> "There are Bluecoats," she says.\n- [ ] #4 Find the car ^b68-x1\n| A | B |\n|---|---|\n| one | two |\n## Head'), 'SAY "There are Bluecoats," she says. #4 Find the car A B one two Head');
  assert.equal(P.shortLabel('0 Table chat, voicing line, rules fixes, hand Isaac his sheet', 40), '0 Table chat, voicing line, rules fixes…');
  assert.equal(P.shortLabel('3 The score', 40), '3 The score');
});

await test('11b. clocksSvg: the players’ clocks only, wedges filled to the count, names escaped; none -> null; it passes the server’s svg check', () => {
  assert.equal(P.clocksSvg([]), null); assert.equal(P.clocksSvg([{ name: 'Secret', filled: 1, size: 4, hidden: true }]), null);
  const svg = P.clocksSvg([{ name: 'Bluecoats <close> in', filled: 2, size: 6 }, { name: 'Secret', filled: 1, size: 4, hidden: true }, { name: 'Rival', filled: 9, size: 4 }]);
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900">'));
  assert.ok(!svg.includes('Secret') && svg.includes('Bluecoats &lt;close&gt; in') && svg.includes('2 / 6') && svg.includes('4 / 4'), 'hidden left out, filled capped at the size');
  assert.equal((svg.match(/<path /g) || []).length, 10); assert.equal((svg.match(/fill="#d8a93b"/g) || []).length, 6);
  checkSvg(svg);
});

await test('11d. the in-app upload skips an assist part that carries prefix text, and that skip is not a loss', () => {
  assert.deepEqual(P.skippedParts({ parts: { assist: { src: {}, prefix: 'invented text' }, prep: { x: 1 } } }), ['assist']);
  assert.deepEqual(P.skippedParts({ parts: { assist: { src: {}, file_id: 'file_x', hash: 'h' } } }), []);
  assert.deepEqual(P.skippedParts({ parts: { prep: {} } }), []);
  const big = 'x'.repeat(60000);
  const have = { parts: { assist: { body: { file_id: 'file_x', hash: 'h' } }, scenes: { body: { T: { a: 'y'.repeat(5000) } } } } };
  const pk = { parts: { assist: { src: {}, prefix: big }, scenes: { src: {}, T: { a: 'y'.repeat(5000) } } } };
  assert.deepEqual(P.importLosses(have, pk), []);
  const small = { parts: { assist: { body: { prefix: big } }, scenes: have.parts.scenes } };   // an old text-form assist on the page
  assert.deepEqual(P.importLosses(small, { parts: { assist: { src: {}, prefix: 'z' }, scenes: { src: {}, T: { a: 'y'.repeat(5000) } } } }), []);
  assert.equal(P.importLosses(have, { parts: { assist: pk.parts.assist } }).length, 1, 'other parts still count (scenes gone)');
});

await test('11c. packLosses: a part gone, a prep note gone or much shorter; growth is fine', () => {
  const note = (rel, n) => ({ id: rel, rel, blocks: [{ src: 'x'.repeat(n) }] });
  const before = { prep: { notes: [note('S/b68g-s02.md', 44000)] }, scenes: { T: { a: 'y'.repeat(5000) } } };
  assert.deepEqual(P.packLosses(before, JSON.parse(JSON.stringify(before))), []);
  assert.deepEqual(P.packLosses(before, { scenes: before.scenes }), ['the prep part is gone (no note has gm_prep: true now)']);
  const r = P.packLosses(before, { prep: { notes: [note('S/b68g-s02.md', 19000)] }, scenes: before.scenes });
  assert.ok(r.some((x) => /prep note b68g-s02 shrank from 44000 to 19000 characters/.test(x)), JSON.stringify(r));
  // a part the app retired on purpose (Engage's) is not a loss, here and in the exporter's guard (same list)
  assert.deepEqual(P.packLosses({ ...before, engagement: { T: { a: 'z'.repeat(9000) } } }, JSON.parse(JSON.stringify(before))), []);
  assert.deepEqual(P.RETIRED_PARTS, ['engagement']);
});

await test('11d. Find: Ctrl+K and / open it, typing lists hits, arrows choose, Enter copies a filed line, Esc and Ctrl+K shut it; no shortcuts while it is open', async () => {
  const fg = fakeGm(); fg.server.doc = { capture: { c1: { id: 'c1', bucket: 'n', text: 'Harl the ferry clerk', at: new Date().toISOString() } } };
  const h = await openPage({ fg, camp: CAMP3 });
  assert.equal(h.q('#gm-find').hidden !== false || h.q('#gm-find').hasAttribute('hidden'), true, 'shut at first');
  h.press('k', { ctrlKey: true }); assert.ok(!h.q('#gm-find').hasAttribute('hidden'), 'Ctrl+K opens it');
  const q = h.q('#gm-find-q'); assert.equal(h.br.doc.activeElement, q, 'the box has the focus');
  q.value = 'harl'; dispatch(q, 'input');
  const hits = h.qa('.gm-find-hit'); assert.ok(hits.length >= 1 && /Harl the ferry clerk/.test(hits[0].textContent) && /Name · filed/.test(hits[0].textContent), h.q('#gm-find-list').textContent);
  q.value = 'marge'; dispatch(q, 'input'); assert.ok(/Marge Teacup/.test(h.q('#gm-find-list').textContent), 'an NPC from the pack');
  q.value = 'zzzz nothing'; dispatch(q, 'input'); assert.ok(/Nothing matches/.test(h.q('#gm-find-list').textContent));
  q.value = 'ferry clerk'; dispatch(q, 'input');
  h.press('ArrowDown', { target: q }); h.press('ArrowUp', { target: q });
  h.press('1', { target: q }); assert.ok(!h.fg.server.patches.some((p) => p.cards), 'a digit while Find is open does not roll');
  h.press('Enter', { target: q }); assert.equal(h.br.copied, 'Harl the ferry clerk', 'Enter on a filed line copies it');
  h.press('Escape', { target: q }); assert.ok(h.q('#gm-find').hasAttribute('hidden'), 'Esc shuts it');
  h.press('/'); assert.ok(!h.q('#gm-find').hasAttribute('hidden'), '/ opens it');
  h.press('k', { ctrlKey: true }); assert.ok(h.q('#gm-find').hasAttribute('hidden'), 'Ctrl+K again shuts it');
  h.q('.gm-bar [data-gm="find-open"]').click(); assert.ok(!h.q('#gm-find').hasAttribute('hidden'), 'the bar button opens it');
  dispatch(h.q('#gm-find'), 'click'); assert.ok(h.q('#gm-find').hasAttribute('hidden'), 'a click around it shuts it');
  await h.save();
});

await test('11e. the beat in the bar: the newest started beat with its minutes; none -> hidden; the bar shows the prep session while the counter is 0', async () => {
  const fg = fakeGm(); fg.server.doc = { prep: { beats: { b1: { at: new Date(Date.now() - 30 * 60000).toISOString(), label: '2 Downtime' }, b2: { at: new Date(Date.now() - 8 * 60000 - 5000).toISOString(), label: '3 The score' }, b3: null } } };
  const h = await openPage({ fg, camp: CAMP3 });
  const go = h.q('#gm-bar-beatgo');
  assert.ok(!h.q('#gm-bar-beat').hidden, 'shown'); assert.match(go.textContent, /3 The score · 8 min/);
  assert.ok(h.q('[data-gm="beat-next"]').hidden, 'no run order on the page: no Next');
  await h.save();
  const h2 = await openPage({ camp: { session: { number: 0 }, crew: {} } });
  assert.ok(h2.q('#gm-bar-beat').hidden, 'no beat: hidden');
  assert.equal(h2.q('#gm-bar-sess').textContent, 'Session 0', 'no prep in the pack: 0 as it is');
  await h2.save();
});

await test('11f. listening: a speaker in the lines is a button; it opens Who is who on that speaker’s box; Enter in the box saves it', async () => {
  const fg = fakeGm(), sent = [];
  fg.gm.stt = async () => ({ doc: { want: 'on', speakers: { 0: 'Alex (GM)' }, status: { state: 'listening', at: new Date().toISOString(), lines: 2 } } });
  fg.gm.transcript = async () => ({ lines: [{ speaker: 0, kind: 'line', text: 'Nobody moves.' }, { speaker: 2, kind: 'line', text: 'Who knocks?' }, { speaker: null, kind: 'mark', text: '' }] });
  fg.gm.patchStt = async (p) => { sent.push(p); return { doc: { want: 'on', speakers: Object.assign({ 0: 'Alex (GM)' }, p.speakers || {}), status: { state: 'listening' } } }; };
  const h = await openPage({ fg, camp: CAMP3 });
  h.press('i');
  assert.ok(await until(() => h.qa('#gm-stt .gm-stt-who').length === 2), 'two named-or-numbered speakers as buttons');
  const who = h.qa('#gm-stt .gm-stt-who'); assert.deepEqual(who.map((b) => b.textContent), ['Alex (GM)', 'S2']);
  who[1].click();
  assert.equal(h.br.doc.activeElement && h.br.doc.activeElement.id, 'gm-stt-s2', 'the S2 box has the focus');
  assert.ok(h.q('[data-sttfold]').hasAttribute('open'), 'Who is who opened');
  const box = h.q('#gm-stt-s2'); box.value = 'Pat (Vex)';
  h.press('Enter', { target: box }); assert.notEqual(h.br.doc.activeElement, box, 'Enter leaves the box (the change event saves)');
  dispatch(box, 'change'); await until(() => sent.length); assert.equal(JSON.stringify(sent.pop()), JSON.stringify({ speakers: { 2: 'Pat (Vex)' } }));
  await h.save();
});

await test('11g. clocks to the iPad: Show on iPad sends the players’ clocks as a checked svg; a clock changing on the table sends them again', async () => {
  const camp = { session: { number: 3 }, crew: {}, clocks: [{ name: 'Bluecoats close in', filled: 2, size: 6 }, { name: 'Secret plan', filled: 1, size: 4, hidden: true }] };
  const fg = fakeGm(), h = await openPage({ fg, camp });
  h.q('#gm-rail [data-gm="clocks-ipad"]').click();
  assert.ok(await until(() => fg.server.displays.length === 1));
  const d = fg.server.displays[0]; assert.equal(d.kind, 'svg'); assert.equal(d.title, 'Clocks'); assert.ok(!d.svg.includes('Secret')); checkSvg(d.svg);
  h.page.campaign({ ...camp, clocks: [{ name: 'Bluecoats close in', filled: 3, size: 6 }, camp.clocks[1]] });
  assert.ok(await until(() => fg.server.displays.length === 2, 300), 'sent again after a change');
  assert.ok(fg.server.displays[1].svg.includes('3 / 6'));
  h.page.campaign({ ...camp, clocks: [{ name: 'Bluecoats close in', filled: 3, size: 6 }, { name: 'Secret plan', filled: 2, size: 4, hidden: true }] });
  await new Promise((r) => setTimeout(r, 900)); assert.equal(fg.server.displays.length, 2, 'a hidden clock moving sends nothing (the picture is the same)');
  await h.save();
});

await test('11i. the clocks follow the display seq, not the title "Clocks": a push from another device in between stops them (and it says so); anything else this page pushes ends them', async () => {
  const camp = { session: { number: 3 }, crew: {}, clocks: [{ name: 'Bluecoats close in', filled: 2, size: 6 }] };
  const fg = addAmbient(fakeGm()), h = await openPage({ fg, camp });
  const set = (n) => h.page.campaign({ ...camp, clocks: [{ name: 'Bluecoats close in', filled: n, size: 6 }] });
  h.q('#gm-rail [data-gm="clocks-ipad"]').click(); assert.ok(await until(() => fg.server.displays.length === 1));
  set(3); assert.ok(await until(() => fg.server.displays.length === 2, 1500), 'a change sends them again');
  // another laptop puts up something called Clocks: the next change must not overwrite it
  fg.server.otherDevice({ kind: 'svg', title: 'Clocks', caption: 'from the other laptop', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>' });
  h.br.toasts.length = 0;
  set(4); await new Promise((r) => setTimeout(r, 1000)); await tick();
  assert.equal(fg.server.displays.length, 2, 'nothing landed'); assert.equal(fg.server.shown.caption, 'from the other laptop', 'the other push stays');
  assert.ok(h.br.toasts.some(([m, bad]) => bad && /something else is on the iPad/i.test(m)), 'the page says so');
  set(5); await new Promise((r) => setTimeout(r, 1000)); await tick();
  assert.equal(fg.server.displays.length, 2, 'and the clocks no longer follow the table');
  // Show on iPad starts them again; anything else this page pushes ends them
  h.q('#gm-rail [data-gm="clocks-ipad"]').click(); assert.ok(await until(() => fg.server.displays.length === 3));
  h.q('#gm-ipad [data-gm="blankipad"], [data-gm="blankipad"]').click(); assert.ok(await until(() => fg.server.displays.length === 4));
  set(6); await new Promise((r) => setTimeout(r, 1000)); await tick();
  assert.equal(fg.server.displays.length, 4, 'cleared: a change sends nothing');
  await h.save();
});

await test('11h. Update pack: a file that would lose a part says so, the button reads Upload anyway, and it asks before uploading', async () => {
  let asked = 0, uploads = 0;
  const br = fakeBrowser({ FileReader: class { readAsText(f) { this.result = f.text; this.onload(); } }, confirm: () => { asked++; return false; } });
  const fg = fakeGm(); fg.gm.importPart = async () => { uploads++; return { version: 'x' }; };
  const h = await openPage({ br, fg, camp: CAMP3 });
  h.q('.gm-menu-list [data-gm="update"]').click();
  const pk = { format: 1, exportedAt: new Date().toISOString(), parts: { console: { src: {}, ...FIXC.console }, location: { src: {}, T: FIXL.T, extra: FIXL.extra }, campaign: { src: {}, ...FIXC.campaign } } };
  const file = h.q('#gm-file'); file.files = [{ name: 'b68-gm-pack.json', text: JSON.stringify(pk) }]; file.id = 'gm-file';
  dispatch(file, 'change');
  assert.ok(await until(() => h.q('.gm-losses')), 'the losses box');
  assert.ok(/the scenes part is gone/.test(h.q('.gm-losses').textContent));
  assert.equal(h.q('[data-gm="upload"]').textContent, 'Upload anyway');
  h.q('[data-gm="upload"]').click(); await tick();
  assert.equal(asked, 1); assert.equal(uploads, 0, 'refused at the question: nothing uploaded');
  await h.save();
});

/* =====================================================================================================================
   12. Now in (A7): one district in the bar that the console, Street, Location and NPC pickers start from
   ===================================================================================================================== */
const NPCM = require(path.join(ROOT, 'app', 'gm', 'npc.js'));
const NPCFIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'npc-pack.json'), 'utf8'));
const NOWD = 'Dockside Test';            /* the location fixture's own district: added below to the other tools' lists, so all four hold it */
const cl = (o) => JSON.parse(JSON.stringify(o));
function nowParts(extra) {
  const con = cl(FIXC.console); con.T.district.push(NOWD);
  const scn = cl(FIXS.parts.scenes); const d0 = cl(scn.T.district[0]); d0.n = NOWD; scn.T.district.push(d0);
  const npc = cl(NPCFIX.parts.npc); npc.T.district.push(NOWD);
  return Object.assign({ console: { version: 'c9', src: {}, body: con }, scenes: { version: 's9', src: {}, body: { T: scn.T } }, npc: { version: 'n9', src: {}, body: npc } }, extra || {});
}
const optSel = (h, sel) => (h.q(sel + ' option[selected]') || { textContent: '', getAttribute: () => null });
function pick(h, sel, v) { const s = h.q(sel); s.value = v; dispatch(s, 'change'); }
const stateDoc = (h) => h.page._state().doc;
const nowPage = (over, parts) => openPage({ br: fakeBrowser(Object.assign({ B68GmNpc: NPCM }, over || {})), fg: fakeGm(NPCFIX.parts.campaign, nowParts(parts)), camp: CAMP3 });

await test('12a. Now in: a select in the bar (and the phone’s Scene line) lists every tool’s districts once; the four pickers lead with "Now in: …"; it is kept in the GM state', async () => {
  const h = await nowPage();
  const opts = h.qa('#gm-now option').map((o) => o.getAttribute('value'));
  assert.equal(opts[0], '', 'anywhere first'); assert.equal(new Set(opts).size, opts.length, 'each district once');
  for (const d of ['Puddleton', 'Testfield', 'Alder Quay', 'Puddle End', NOWD]) assert.ok(opts.includes(d), d + ' is listed');
  const key = (s) => s.toLowerCase().replace(/^the\s+/, ''), rest = opts.slice(1); assert.deepEqual(rest, [...rest].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)), 'alphabetical (a leading "The" does not count)');
  assert.equal(h.qa('select[data-now]').length, 2, 'one in the bar, one in the Scene line (the phone shows that one)'); assert.ok(h.q('.gm-bar #gm-now') && h.q('#gm-scenebox #gm-now-s'));
  assert.equal(optSel(h, '#gm-now').getAttribute('value'), '', 'on anywhere');
  for (const s of ['#gm-c-district', '#gm-l-district', '#gm-s-sel', '#gm-n-district']) {
    assert.equal(h.q(s + ' option').textContent, 'Now in: anywhere', s + ' leads with Now in'); assert.equal(optSel(h, s).textContent, 'Now in: anywhere', s + ' follows by default');
    assert.equal(h.qa(s + ' option').filter((o) => o.getAttribute('value') === '*').length, 1, s + ' keeps an any of its own');
  }
  pick(h, '#gm-now', NOWD);
  assert.equal(stateDoc(h).now.district, NOWD, 'kept in the GM state as now.district');
  for (const s of ['#gm-c-district', '#gm-l-district', '#gm-s-sel', '#gm-n-district']) assert.equal(optSel(h, s).textContent, 'Now in: ' + NOWD, s + ' says what it follows');
  assert.equal(optSel(h, '#gm-now-s').getAttribute('value'), NOWD, 'the Scene line’s copy shows it too'); assert.match(h.q('#gm-scene-chips').textContent, new RegExp('District: ' + NOWD));
  await h.save();
  assert.equal(h.fg.server.doc.now.district, NOWD, 'saved');
  const h2 = await openPage({ fg: h.fg, br: fakeBrowser({ B68GmNpc: NPCM }), camp: CAMP3 });
  assert.equal(optSel(h2, '#gm-now').getAttribute('value'), NOWD, 'a reload keeps it'); assert.equal(optSel(h2, '#gm-l-district').textContent, 'Now in: ' + NOWD);
  await h2.save();
});

await test('12b. the four tools roll on Now in, and store the district they resolved to in the roll’s own ui', async () => {
  const h = await nowPage();
  pick(h, '#gm-now', NOWD);
  h.press('3'); assert.equal(stateDoc(h).cards.situation.ui.district, NOWD, 'console');
  h.q('[data-gm="locroll"]').click(); assert.equal(stateDoc(h).cards.location.ui.district, NOWD, 'location'); assert.match(h.q('#gm-loc .gm-glance-place').textContent, new RegExp(NOWD));
  h.q('[data-gm="scnroll"]').click(); assert.equal(stateDoc(h).cards.scenes.ui.sel, NOWD, 'street'); assert.match(h.q('#gm-scn .gm-card-h').textContent, new RegExp(NOWD));
  h.q('[data-gm="npcroll"]').click(); assert.equal(stateDoc(h).cards.npc.ui.district, NOWD, 'NPC');
  const d = stateDoc(h);
  assert.ok(!d.con || !d.con.live || d.con.live.district === undefined, 'following stores nothing in the tool: it is the default');
  assert.ok(!d.loc || !d.loc.ui || d.loc.ui.district === undefined);
  await h.save();
});

await test('12c. a tool’s own pick wins, stays through a change of Now in, and "Now in" in the picker gives it back; "any" is a pick too', async () => {
  const h = await nowPage();
  pick(h, '#gm-now', NOWD);
  pick(h, '#gm-s-sel', 'Brindle Row');
  assert.equal(stateDoc(h).scn.ui.sel, 'Brindle Row'); assert.equal(h.q('#gm-s-sel').value, 'Brindle Row', 'the picker shows its own pick');
  h.q('[data-gm="scnroll"]').click(); assert.equal(stateDoc(h).cards.scenes.ui.sel, 'Brindle Row', 'the tool’s own pick wins over Now in');
  h.press('3'); assert.equal(stateDoc(h).cards.situation.ui.district, NOWD, 'the others still follow');
  pick(h, '#gm-now', 'Puddleton');
  assert.equal(optSel(h, '#gm-s-sel').textContent, 'Brindle Row', 'a change of Now in leaves a pick alone'); assert.match(h.q('#gm-s-sel option').textContent, /^Now in: any \(no Puddleton here\)$/, 'its first choice still says what Now in is, and that this tool lacks it');
  h.q('[data-gm="scnroll"]').click(); assert.equal(stateDoc(h).cards.scenes.ui.sel, 'Brindle Row');
  h.press('3'); assert.equal(stateDoc(h).cards.situation.ui.district, 'Puddleton', 'the console follows the new Now in');
  pick(h, '#gm-s-sel', ''); assert.equal(stateDoc(h).scn.ui.sel, '', 'the first choice gives it back'); assert.equal(h.q('#gm-s-sel').value, '');
  h.q('[data-gm="scnroll"]').click(); assert.equal(stateDoc(h).cards.scenes.ui.sel, '', 'a tool whose list lacks Now in rolls on any');
  pick(h, '#gm-now', NOWD); pick(h, '#gm-s-sel', '*');
  assert.equal(stateDoc(h).scn.ui.sel, '*'); assert.equal(h.q('#gm-s-sel').value, '*', 'any is picked');
  h.q('[data-gm="scnroll"]').click(); assert.equal(stateDoc(h).cards.scenes.ui.sel, '', 'a tool on any rolls on any whatever Now in says, and no sentinel ever reaches a roll');
  pick(h, '#gm-c-district', 'Muddle End'); h.press('3'); assert.equal(stateDoc(h).cards.situation.ui.district, 'Muddle End', 'the console’s own pick wins');
  pick(h, '#gm-l-district', 'Testfield'); h.q('[data-gm="locroll"]').click(); assert.equal(stateDoc(h).cards.location.ui.district, 'Testfield', 'the location’s own pick wins');
  pick(h, '#gm-n-district', 'Gnome Hill'); h.q('[data-gm="npcroll"]').click(); assert.equal(stateDoc(h).cards.npc.ui.district, 'Gnome Hill', 'the NPC’s own pick wins');
  pick(h, '#gm-now', ''); assert.equal(optSel(h, '#gm-now').getAttribute('value'), ''); assert.equal(h.q('#gm-c-district option').textContent, 'Now in: anywhere');
  await h.save();
});

await test('12d. Now in never moves a stored card: Earlier and a reload redraw each tool’s card as it was rolled', async () => {
  const h = await nowPage();
  pick(h, '#gm-now', 'Puddleton'); h.press('3');
  const A = cardTxt(h); assert.equal(stateDoc(h).cards.situation.ui.district, 'Puddleton');
  pick(h, '#gm-now', NOWD);
  assert.equal(cardTxt(h), A, 'the card on screen stays as rolled'); assert.match(h.q('#gm-scene-chips').textContent, new RegExp('District: ' + NOWD), 'the Scene line shows what the next roll uses');
  h.press('3'); const B = cardTxt(h); assert.equal(stateDoc(h).cards.situation.ui.district, NOWD); assert.notEqual(B, A);
  h.qa('#gm-earlier [data-gm="replay"]')[1].click(); assert.equal(cardTxt(h), A, 'Earlier: the older card, exactly as it was, whatever Now in is'); assert.equal(stateDoc(h).cards.situation.ui.district, 'Puddleton');
  h.q('[data-gm="locroll"]').click(); const L1 = h.q('#gm-loc .gm-glance-place').textContent, L1name = h.q('#gm-loc .gm-locname').textContent;
  h.q('[data-gm="scnroll"]').click(); const S1 = h.q('#gm-scn .gm-card-h').textContent;
  h.q('[data-gm="npcroll"]').click(); const N1 = h.q('#gm-npc .gm-npccard .gm-card-h').textContent;
  pick(h, '#gm-now', 'Testfield');                  /* a district only the location lists */
  assert.equal(h.q('#gm-loc .gm-glance-place').textContent, L1, 'the location card does not move'); assert.equal(h.q('#gm-scn .gm-card-h').textContent, S1, 'nor the street scene'); assert.equal(h.q('#gm-npc .gm-npccard .gm-card-h').textContent, N1, 'nor the NPC');
  await h.save();
  const h2 = await openPage({ fg: h.fg, br: fakeBrowser({ B68GmNpc: NPCM }), camp: CAMP3 });
  assert.equal(optSel(h2, '#gm-now').getAttribute('value'), 'Testfield'); assert.equal(cardTxt(h2), A, 'a reload redraws the console card as rolled');
  assert.equal(h2.q('#gm-loc .gm-glance-place').textContent, L1); assert.equal(h2.q('#gm-loc .gm-locname').textContent, L1name); assert.equal(h2.q('#gm-scn .gm-card-h').textContent, S1); assert.equal(h2.q('#gm-npc .gm-npccard .gm-card-h').textContent, N1, 'and the other three');
  h2.q('[data-gm="locroll"]').click(); assert.equal(stateDoc(h2).cards.location.ui.district, 'Testfield', 'the next roll uses the new Now in');
  await h2.save();
});

await test('12e. districts are matched without case, "the" or punctuation (each tool keeps its own spelling); the bar lists a name once; a Now in the packs no longer hold stays visible', async () => {
  const scn = cl(FIXS.parts.scenes); const d0 = cl(scn.T.district[0]); d0.n = 'puddle-TON'; scn.T.district.push(d0);
  const h = await nowPage(null, { scenes: { version: 's8', src: {}, body: { T: scn.T } } });
  const opts = h.qa('#gm-now option').map((o) => o.getAttribute('value'));
  assert.equal(opts.filter((o) => /^puddle-?ton$/i.test(o)).length, 1, 'one entry for the two spellings'); assert.ok(opts.includes('Puddleton'), 'the first tool’s spelling (the console)');
  pick(h, '#gm-now', 'Puddleton');
  assert.equal(h.q('#gm-s-sel option').textContent, 'Now in: puddle-TON', 'the Street picker names its own spelling');
  h.q('[data-gm="scnroll"]').click(); assert.equal(stateDoc(h).cards.scenes.ui.sel, 'puddle-TON', 'and rolls on it');
  h.press('3'); assert.equal(stateDoc(h).cards.situation.ui.district, 'Puddleton');
  await h.save();
  const fg = h.fg; fg.server.doc.now = { district: 'Gone Wharf' };
  const h2 = await openPage({ fg, br: fakeBrowser({ B68GmNpc: NPCM }), camp: CAMP3 });
  assert.equal(optSel(h2, '#gm-now').getAttribute('value'), 'Gone Wharf', 'a district no pack lists is still what the select shows');
  assert.match(h2.q('#gm-l-district option').textContent, /^Now in: any \(no Gone Wharf here\)$/); h2.press('3'); assert.equal(stateDoc(h2).cards.situation.ui.district, '', 'and rolls on any');
  await h2.save();
});

await test('12f. an old state with a tool’s district already set keeps it as that tool’s own pick; a state without now follows nothing; no sentinel in the source of any roll', async () => {
  const fg = fakeGm(NPCFIX.parts.campaign, nowParts()); fg.server.doc = { con: { live: { district: 'Muddle End' } }, scn: { ui: { sel: 'Alder Quay' } } };
  const h = await openPage({ fg, br: fakeBrowser({ B68GmNpc: NPCM }), camp: CAMP3 });
  assert.equal(optSel(h, '#gm-c-district').textContent, 'Muddle End'); assert.equal(optSel(h, '#gm-s-sel').textContent, 'Alder Quay'); assert.equal(optSel(h, '#gm-l-district').textContent, 'Now in: anywhere');
  pick(h, '#gm-now', NOWD); h.press('3'); assert.equal(stateDoc(h).cards.situation.ui.district, 'Muddle End', 'an older pick is that tool’s own');
  pick(h, '#gm-c-district', ''); h.press('3'); assert.equal(stateDoc(h).cards.situation.ui.district, NOWD);
  for (const t of Object.keys(stateDoc(h).cards)) assert.ok(!JSON.stringify(stateDoc(h).cards[t].ui || {}).includes('"*"'), t + ': no sentinel in a roll’s ui');
  await h.save();
});

await test('12g. Now in is in the sticky copy: with the GM state unreachable, a reload still shows it and the pickers follow it', async () => {
  const br = fakeBrowser({ B68GmNpc: NPCM }), fg = fakeGm(NPCFIX.parts.campaign, nowParts());
  const h = await openPage({ br, fg, camp: CAMP3 }); pick(h, '#gm-now', NOWD); await h.save();
  assert.equal(JSON.parse(br.ls.get('b68.gm.sticky')).now.district, NOWD, 'mirrored for a reload');
  const fg2 = fakeGm(NPCFIX.parts.campaign, nowParts()); fg2.gm.state = async () => { throw new Error('offline'); };
  const h2 = await openPage({ br, fg: fg2, camp: CAMP3 });
  assert.equal(optSel(h2, '#gm-now').getAttribute('value'), NOWD, 'drawn from the sticky copy while the notes are offline');
  assert.equal(optSel(h2, '#gm-l-district').textContent, 'Now in: ' + NOWD);
  await h2.save();
});

/* =====================================================================================================================
   13. Wave 2, the generators' new fields on the cards: the spend sentence, "Why", the position on the title line, the compose
   version, the pack check, the location plan and rule, the portrait note, Earlier chips that name the card
   ===================================================================================================================== */
const sitCon = () => C.create({ T: FIXC.console.T, campaign: FIXC.campaign, mem: {} });
const stripWhy = (h) => h.replace(/<details class="gm-why">[\s\S]*?<\/details>/g, '');
const coachTexts = (res) => res.sections.flatMap((s) => s.lines.filter((l) => l.coach).map((l) => P.plainMd(l.md)));
const mdText = (s) => '<p>' + P.plainMd(s).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>';        // markdown as its words, so a card's text can be searched
const textOf = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const leadBox = (h) => { const i = h.indexOf('<section class="gm-lead"'); return h.slice(i, h.indexOf('</section>', i)); };

await test('13a. the lead shows its spend sentence (a threat) under the lead line; the lead\'s first line is not repeated under More', () => {
  const con = sitCon();
  let withSmall = 0, checked = 0;
  for (let seed = 1; seed <= 60; seed++) {
    for (const n of [1, 2, 3, 4]) {
      const res = con.situation(n, Object.assign(con.situationDefaults(), { threat: 'the dog is waking up', npc: seed % 3 ? '' : 'rival:Nigel Sprocket' }), { seed });
      const h = P.situationCardHtml(res, mdPlain), lead = res.sections[0], l0 = lead.lines[0], box = leadBox(h);
      assert.ok(P.leadIsLine(lead), n + '/' + seed + ': the fixtures\' lead is its first line');
      assert.ok(!box.includes('<div class="gm-want">'), n + '/' + seed + ': the lead\'s first line is not drawn again under More');
      assert.equal(count(box, /class="gm-lead-t"/g), 1);
      if (l0 && l0.small) {
        withSmall++;
        assert.ok(box.includes('<div class="gm-lead-s">' + mdPlain(l0.small) + '</div>'), n + '/' + seed + ': the spend sentence sits under the lead');
        assert.ok(box.indexOf('gm-lead-t') < box.indexOf('gm-lead-s') && (box.indexOf('<details class="gm-more"') < 0 || box.indexOf('gm-lead-s') < box.indexOf('<details class="gm-more"')), 'under the lead, above More');
        assert.equal(count(h, new RegExp(mdPlain(l0.small).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')), 1, 'and only once');
      } else assert.ok(!box.includes('gm-lead-s'), 'no sentence, no box');
      checked++;
    }
  }
  assert.ok(withSmall >= 10, 'a threat gives the 4/5 lead its spend sentence in some draws (' + withSmall + ' of ' + checked + ')');
});

await test('13a. coaching lines fold under a closed "Why" in every section, and show nowhere else', () => {
  const con = sitCon();
  let whys = 0;
  for (let seed = 1; seed <= 40; seed++) for (const n of [1, 2, 3, 4]) {
    const res = con.situation(n, Object.assign(con.situationDefaults(), { pos: ['controlled', 'risky', 'desperate'][seed % 3], npc: seed % 2 ? 'rival:Nigel Sprocket' : '' }), { seed });
    const h = P.situationCardHtml(res, mdText), coach = coachTexts(res);
    const sectionsWithCoach = res.sections.filter((s) => s.lines.some((l) => l.coach)).length;
    assert.equal(count(h, /<details class="gm-why"/g), sectionsWithCoach, n + '/' + seed + ': one Why per section that has coaching');
    assert.ok(!/<details class="gm-why"[^>]*\sopen/.test(h), 'Why starts closed'); whys += sectionsWithCoach;
    const bare = textOf(stripWhy(h)), all = textOf(h);
    for (const t of coach) { assert.ok(!bare.includes(t.slice(0, 40)), n + '/' + seed + ': coaching shows outside Why: ' + t.slice(0, 40)); assert.ok(all.includes(t.slice(0, 40)), 'and is under Why'); }
  }
  assert.ok(whys > 60, 'coaching lines are common (' + whys + ' Why folds)');
  // the lead's Why sits in More beside the other lines; a lead with nothing else gets its Why without a More round it
  const only = { meta: { id: 'situation', situation: 'before', n: 1, title: 'T', sub: 's', actions: [] }, lines: [], sections: [{ id: 'x', role: 'lead', title: 'X', lead: 'Lead line', chips: [], lines: [{ kind: 'want', md: 'Lead line' }, { kind: 'read', md: 'Coached', coach: true }], actions: [] }] };
  const oh = P.situationCardHtml(only, mdPlain);
  assert.ok(!oh.includes('gm-more') && oh.includes('<details class="gm-why"><summary>Why</summary>') && oh.includes('Coached'), 'a lead with only coaching left shows Why, not an empty More');
  assert.equal(count(oh, /Lead line/g), 1, 'and the lead line once');
  // a lead cut at 120 characters keeps its full first line under More
  const longMd = 'A long line ' + 'x'.repeat(150), cutLead = { meta: only.meta, lines: [], sections: [{ id: 'x', role: 'lead', title: 'X', lead: P.plainMd(longMd).slice(0, 119) + '…', chips: [], lines: [{ kind: 'want', md: longMd, small: 'spent' }], actions: [] }] };
  const ch = P.situationCardHtml(cutLead, mdPlain);
  assert.ok(ch.includes('<details class="gm-more">') && ch.includes(longMd) && count(ch, /spent/g) === 1, 'a cut lead keeps its whole line under More (the spend sentence stays under the lead, once)');
  // a classic card has no Why: nothing there is flagged
  assert.ok(!P.classicCardHtml(sitCon().roll('face', sitCon().defaults(), { seed: 5 }), mdPlain).includes('gm-why'));
});

await test('13b. situationPlain: no coaching lines, the position chip on the title line, the lead line once', () => {
  const con = sitCon();
  for (let seed = 1; seed <= 40; seed++) for (const n of [1, 2, 3, 4]) {
    const res = con.situation(n, Object.assign(con.situationDefaults(), { threat: seed % 2 ? 'the dog is waking up' : '', npc: seed % 3 ? '' : 'rival:Nigel Sprocket' }), { seed });
    const t = P.situationPlain(res), first = t.split('\n')[0];
    assert.ok(first.includes(res.meta.chips[0]), n + '/' + seed + ': the title line carries the position chip: ' + first);
    assert.ok(first.startsWith(res.meta.title + ' ('), first);
    for (const c of coachTexts(res)) assert.ok(!t.includes(c.slice(0, 40)), 'coaching in the plain text: ' + c.slice(0, 40));
    res.sections.forEach((s) => assert.equal(count(t, new RegExp(P.plainMd(s.lead).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=\\n|$)', 'g')) >= 1, true, 'the lead is there'));
    const lead = res.sections[0];
    assert.equal(count(t, new RegExp('^ {2}' + P.plainMd(lead.lead).replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'gm')), 0, 'and not again as its first line');
    if (lead.lines[0].small) assert.ok(t.includes('\n  ' + P.plainMd(lead.lines[0].small)), 'the spend sentence stays');
    assert.ok(t.length <= 1500 || n === 2, 'short enough for a pin (' + t.length + ')');
  }
  assert.equal(P.situationPlain({ meta: { title: 'T', sub: 'risky → middling' }, sections: [] }), 'T (risky → middling)', 'without a chip the subtitle is what is there');
});

await test('13c. situationEntry stores composeVersion and replaySituationEntry passes it back: a card is not "recomposed" unless it was stored before versions', () => {
  const con = sitCon(), res = con.situation(2, con.situationDefaults(), { seed: 77 });
  const entry = P.situationEntry(res, {});
  assert.equal(entry.composeVersion, C.COMPOSE_VERSION); assert.ok(C.COMPOSE_VERSION >= 2);
  const again = P.replaySituationEntry(C, FIXC.console.T, FIXC.campaign, entry, {});
  assert.equal(again.meta.recomposed, undefined, 'a current entry redraws without a note');
  assert.equal(JSON.stringify(again.sections.map((s) => [s.id, s.lead])), JSON.stringify(res.sections.map((s) => [s.id, s.lead])), 'and identically');
  assert.ok(!P.situationCardHtml(again, mdPlain).includes('Redrawn with the current tables'));
  const old = Object.assign({}, entry); delete old.composeVersion;
  const redone = P.replaySituationEntry(C, FIXC.console.T, FIXC.campaign, old, {});
  assert.deepEqual(redone.meta.recomposed, { from: 1, to: C.COMPOSE_VERSION }, 'an entry from before versions says it was redrawn');
  const html = P.situationCardHtml(redone, mdPlain);
  assert.equal(count(html, /Redrawn with the current tables/g), 1, 'one quiet note line'); assert.ok(html.includes('class="gm-quiet"'));
  assert.equal(P.replaySituationEntry(C, FIXC.console.T, FIXC.campaign, Object.assign({}, entry, { composeVersion: 1 }), {}).meta.recomposed.from, 1, 'an explicit older version too');
});

await test('13c. on the page: a stored card redraws without a note after a reload; one stored without a version carries the note', async () => {
  const fg = fakeGm(), br = fakeBrowser();
  const h = await openPage({ fg, br }); h.press('2'); const a = cardTxt(h); await h.save();
  assert.equal(fg.server.doc.cards.situation.composeVersion, C.COMPOSE_VERSION, 'stored with the card');
  assert.equal(Object.values(fg.server.doc.hist.situation)[0].composeVersion, C.COMPOSE_VERSION, 'and with its Earlier entry');
  const h2 = await openPage({ fg, br }); assert.equal(cardTxt(h2), a); assert.ok(!h2.q('#gm-card .gm-quiet'), 'no note on a current card'); await h2.save();
  delete fg.server.doc.cards.situation.composeVersion;
  const h3 = await openPage({ fg, br }); assert.ok(h3.q('#gm-card .gm-quiet') && /Redrawn with the current tables/.test(h3.q('#gm-card .gm-quiet').textContent), 'a card stored before versions says so'); await h3.save();
});

await test('13c. replacing the stored card: replacePatch nulls what only the old card had; an Earlier entry without composeVersion brings its note back, also after a reload', async () => {
  assert.deepEqual(P.replacePatch({ a: 1, b: { c: 2, d: 3 }, e: 5 }, { a: 9, b: { c: 4 }, f: 6 }), { e: null, a: 9, b: { d: null, c: 4 }, f: 6 });
  assert.deepEqual(P.replacePatch(null, { x: { y: 1 } }), { x: { y: 1 } }); assert.deepEqual(P.replacePatch({ x: 1 }, {}), { x: null });
  const old = { cards: { scenes: { hid: 'h1', seed: 7, started: { x: 'c1' }, ui: { sel: { a: 1 } } } } };
  assert.deepEqual(P.applyPatch(old, { cards: { scenes: P.replacePatch(old.cards.scenes, { hid: 'h2', seed: 8, ui: { sel: { a: 0 } } }) } }).cards.scenes, { hid: 'h2', seed: 8, ui: { sel: { a: 0 } } }, 'the merge leaves nothing of the old card');
  const fg = fakeGm(), br = fakeBrowser();
  const h = await openPage({ fg, br }); h.press('2'); const fresh = cardTxt(h); h.press('3'); await h.save();
  const hist = fg.server.doc.hist.situation, ids = Object.keys(hist), older = ids.find((k) => hist[k].situation === 'fourfive');
  delete hist[older].composeVersion;                           /* the entry as an older page stored it */
  const h2 = await openPage({ fg, br }); assert.ok(!h2.q('#gm-card .gm-quiet'), 'the current card is a version 2 card');
  h2.qa('#gm-earlier [data-gm="replay"]').filter((c) => c.getAttribute('data-h') === older)[0].click();
  assert.ok(h2.q('#gm-card .gm-quiet'), 'Earlier: the older entry says it was redrawn');
  assert.equal(cardTxt(h2).replace(/Redrawn with the current tables/, '').replace(/\s+/g, ' ').slice(0, 20), fresh.replace(/\s+/g, ' ').slice(0, 20), 'and it is the card that was rolled first (same seed)');
  await h2.save(); assert.ok(!('composeVersion' in fg.server.doc.cards.situation), 'the stored card is that entry, version and all');
  const h3 = await openPage({ fg, br }); assert.ok(h3.q('#gm-card .gm-quiet'), 'after a reload the note is still there'); await h3.save();
});

await test('13d. packWarnings: each module\'s own check(T), guarded; a missing table is a warning list, not an error', () => {
  const mods = { B68GmConsole: C, B68GmLocation: L, B68GmScenes: SC, B68GmNpc: NPCM };
  const full = { console: FIXC.console, location: { T: FIXL.T, extra: FIXL.extra }, scenes: { T: FIXS.parts.scenes.T }, npc: NPCFIX.parts.npc };
  assert.deepEqual(P.packWarnings(mods, full), [], 'the fixtures are complete');
  const sparse = cl(full); delete sparse.console.T.spend; delete sparse.scenes.T.rumour; sparse.npc.T.faction = [['X', 'y']]; delete sparse.location.T.rumour;
  const w = P.packWarnings(mods, sparse), by = Object.fromEntries(w.map((x) => [x.part, x.missing]));
  assert.deepEqual(w.map((x) => x.part), ['console', 'location', 'npc', 'scenes'].filter((p) => by[p]), 'in part order');
  assert.ok(by.console.some((m) => /^spend/.test(m)) && by.scenes.includes('rumour') && by.location.includes('rumour'), JSON.stringify(by));
  assert.deepEqual(by.console, C.check(sparse.console.T), 'the console\'s own words'); assert.deepEqual(by.scenes, SC.check(sparse.scenes.T));
  assert.deepEqual(P.packWarnings({ B68GmConsole: { check() { throw new Error('boom'); } }, B68GmLocation: {} }, full), [], 'a check that throws, or a module without one, says nothing');
  assert.deepEqual(P.packWarnings({}, full), [], 'a module that is not loaded says nothing'); assert.deepEqual(P.packWarnings(mods, {}), [], 'a part the pack lacks says nothing');
  assert.deepEqual(P.packWarnings(mods, { scenes: {} }).map((x) => [x.part, x.missing]), [['scenes', ['T']]], 'a part without tables names T');
  assert.match(P.packWarnLines(w, 2)[0], /^console: .*\(\+\d+ more\)$|^console: [^(]*$/);
});

await test('13d. Update pack: a file missing tables shows the warning list and still uploads; the loaded pack lists them in the Menu', async () => {
  let uploads = 0;
  const br = fakeBrowser({ FileReader: class { readAsText(f) { this.result = f.text; this.onload(); } }, confirm: () => true });
  const sparseCon = cl(FIXC.console); delete sparseCon.T.spend; delete sparseCon.T.say3;
  const fg = fakeGm(null, { console: { version: 'cs', src: {}, body: sparseCon } }); fg.gm.importPart = async () => { uploads++; return { version: 'x', packVersion: 'pv' }; };
  const h = await openPage({ br, fg, camp: CAMP3 });
  // at load: the Menu holds the list, one toast says so
  assert.ok(h.q('#gm-menu-warn') && !h.q('#gm-menu-warn').hasAttribute('hidden') && /console: /.test(h.q('#gm-menu-warn').textContent) && /spend/.test(h.q('#gm-menu-warn').textContent), 'the Menu lists the missing tables: ' + h.q('#gm-menu-warn').textContent);
  assert.equal(br.toasts.filter((t) => /missing \d+ table entr/.test(t[0])).length, 1, 'one toast at load'); assert.ok(br.toasts.every((t) => !/missing \d+ table/.test(t[0]) || t[1] === false), 'a note, not an error');
  h.q('.gm-menu-list [data-gm="update"]').click();
  const pk = { format: 1, exportedAt: new Date().toISOString(), parts: { console: { src: {}, ...sparseCon }, location: { src: {}, T: FIXL.T, extra: FIXL.extra }, campaign: { src: {}, ...FIXC.campaign }, scenes: { src: {}, ...FIXS.parts.scenes } } };
  const file = h.q('#gm-file'); file.files = [{ name: 'b68-gm-pack.json', text: JSON.stringify(pk) }]; file.id = 'gm-file';
  dispatch(file, 'change');
  assert.ok(await until(() => h.q('.gm-warns')), 'the warning box');
  assert.ok(/table entr/.test(h.q('.gm-warns').textContent) && /console/.test(h.q('.gm-warns').textContent) && /spend/.test(h.q('.gm-warns').textContent), h.q('.gm-warns').textContent);
  assert.ok(h.q('.gm-warns').className.includes('warn') && !h.q('.gm-warns').className.split(/\s+/).includes('bad'), 'a warning, not an error');
  assert.ok(!h.q('.gm-errs'), 'no error list'); assert.ok(!h.q('[data-gm="upload"]').hasAttribute('disabled'), 'the upload is enabled');
  h.q('[data-gm="upload"]').click(); assert.ok(await until(() => uploads >= 4), 'and it uploads every part (' + uploads + ')');
  await h.save();
  const clean = await openPage({ fg: fakeGm(), br: fakeBrowser(), camp: CAMP3 });
  assert.ok(clean.q('#gm-menu-warn').hasAttribute('hidden') && clean.q('#gm-menu-warn').textContent === '', 'a complete pack: nothing in the Menu');
  await clean.save();
});

await test('13e. the location glance: a Plan line under Say (outside the Say box), a Rule row when the district has one, Flags only the rare ones', async () => {
  const h = await openPage({ br: fakeBrowser(), fg: fakeGm(), camp: CAMP3 });
  let plans = 0, rules = 0;
  for (let i = 0; i < 25; i++) {
    h.q('[data-gm="locroll"]').click();
    const g = L.glance(h.page._state().locRoll, { T: FIXL.T, extra: FIXL.extra }, ['public']);
    const plan = h.q('#gm-loc .gm-glance .gm-plan');
    assert.ok(plan && plan.textContent.replace(/\s+/g, ' ').includes(g.plan), 'the plan line: ' + g.plan);
    assert.ok(!plan.closest('.gm-say') && h.q('#gm-loc .gm-say') && !h.q('#gm-loc .gm-say').textContent.includes(g.plan), 'it is outside the Say box (the box the players\' "Players see" chip marks)');
    assert.equal(/Plan/.test(plan.querySelector('.gm-lab').textContent), true); plans++;
    const dts = h.qa('#gm-loc .gm-glance-dl dt').map((d) => d.textContent);
    assert.equal(dts.includes('Rule'), !!g.rule, 'a Rule row exactly when the district has a rule'); if (g.rule) { rules++; assert.ok(h.qa('#gm-loc .gm-glance-dl dd')[dts.indexOf('Rule')].textContent.includes(g.rule)); }
    assert.equal(dts.includes('Flags'), g.flags.length > 0, 'Flags only when there are rare ones');
    assert.ok(!/ring-skip|District rule/.test(h.q('#gm-loc .gm-glance').textContent), 'ring-skips and "District rule" are not flags');
  }
  assert.ok(plans === 25 && rules > 0, 'rules seen: ' + rules);
  await h.save();
});

await test('13e. the plan is GM only: not in playerSummary at any reveal, not in what Street description on iPad sends, and read by nothing but the glance card', async () => {
  const pk = { T: FIXL.T, extra: FIXL.extra };
  for (let seed = 1; seed <= 300; seed++) {
    const roll = L.generate(pk, {}, { seed, mem: {} }), g = L.glance(roll, pk, ['public']);
    for (const reveal of [['public'], ['public', 'working'], ['public', 'working', 'controlled', 'secure']]) {
      const ps = L.playerSummary(roll, reveal), all = JSON.stringify(ps);
      assert.ok(!all.includes(g.plan) && !ps.text.includes('behind') && !/\bis behind \d+ locks?\b|has no lock in the way/.test(all), seed + ': the plan sentence is in the player summary');
      assert.ok(!all.includes('the target, ' + roll.targetRoom + ' ('), seed + ': nor its target clause');
    }
  }
  const h = await openPage({ br: fakeBrowser(), fg: fakeGm(), camp: CAMP3 });
  h.q('[data-gm="locroll"]').click();
  const plan = L.glance(h.page._state().locRoll, pk, ['public']).plan;
  h.q('[data-gm="pushtext"]').click(); await until(() => h.fg.server.displays.length);
  const sent = h.fg.server.displays.pop();
  assert.equal(sent.kind, 'text'); assert.ok(!JSON.stringify(sent).includes(plan) && !/Plan/.test(JSON.stringify(sent)), 'the street description on the iPad has no plan: ' + JSON.stringify(sent).slice(0, 200));
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  assert.equal(count(src, /\.plan\b/g), 2, 'the page reads a plan in one place only (its glance card: the test and the line)');
  assert.ok(/function glanceHtml[\s\S]*?\.plan[\s\S]*?\.plan[\s\S]*?function foldsHtml/.test(src), 'and that place is glanceHtml');
  await h.save();
});

await test('13f. the NPC portrait note is the module\'s own (fig.note); no portrait when the figure failed; "No portrait: …" when the kit throws', async () => {
  const K = require(path.join(ROOT, 'app', 'figures', 'figure-kit.js'));
  const npcPage = (kit) => openPage({ br: fakeBrowser({ B68GmNpc: NPCM, B68Figure: kit }), fg: fakeGm(NPCFIX.parts.campaign, { npc: { version: 'n1', src: {}, body: NPCFIX.parts.npc } }), camp: CAMP3 });
  // a clean figure: a portrait, and no sentence about stock figures
  let h = await npcPage(K); h.q('[data-gm="npcroll"]').click();
  assert.ok(h.q('#gm-npc .gm-npccard .gm-npcfig svg'), 'a portrait'); assert.ok(!/nearest of the stock figures|No portrait/.test(h.q('#gm-npc .gm-npccard').textContent), h.q('#gm-npc .gm-npccard').textContent.slice(0, 300));
  const note = h.page._state ? null : null; void note; await h.save();
  // the module's note is what shows: a map that makes the module fall back to a stock figure
  const fallbackKit = Object.assign({}, K);
  h = await npcPage(fallbackKit);
  const G = NPCM.create({ T: NPCFIX.parts.npc.T, cast: NPCFIX.parts.npc.cast, F: NPCFIX.parts.npc.F, campaign: NPCFIX.parts.campaign });
  const stock = G.figure(G.roll({ seed: 9 }).npc, { seed: 9, K, map: () => { throw new Error('boom'); } });
  assert.ok(stock.fallback && /^Portrait: a stock figure/.test(stock.note), 'the module says so: ' + stock.note);
  // the figure kit cannot build anything: figure() is failed (no spec), the page draws no portrait and shows the module's note
  const badKit = Object.assign({}, K, { options: () => { throw new Error('no options'); } });
  h = await npcPage(badKit); h.q('[data-gm="npcroll"]').click();
  assert.ok(!h.q('#gm-npc .gm-npccard .gm-npcfig'), 'no portrait when the figure failed');
  assert.match(h.q('#gm-npc .gm-npccard .gm-fignote').textContent, /^No portrait: .*no options/, 'and the module\'s note says why: ' + h.q('#gm-npc .gm-npccard .gm-fignote').textContent);
  assert.equal(h.qa('#gm-npc .gm-npccard .gm-fignote').length, 1); await h.save();
  // the kit throws on the page's own render: no portrait, and "No portrait: <reason>"
  const portraitBoom = Object.assign({}, K, { portrait: (spec, o) => { if (spec && spec.id === 'gm-npcg') throw new Error('portrait boom'); return K.portrait(spec, o); } });
  h = await npcPage(portraitBoom); h.q('[data-gm="npcroll"]').click();
  assert.ok(!h.q('#gm-npc .gm-npccard .gm-npcfig'), 'no portrait when the kit throws'); assert.equal(h.q('#gm-npc .gm-npccard .gm-fignote').textContent, 'No portrait: portrait boom.');
  // no kit at all: the module throws, the page says why
  h = await npcPage(undefined); h.q('[data-gm="npcroll"]').click();
  assert.ok(!h.q('#gm-npc .gm-npccard .gm-npcfig') && /^No portrait: .*figure kit is not loaded/.test(h.q('#gm-npc .gm-npccard .gm-fignote').textContent), h.q('#gm-npc .gm-npccard .gm-fignote').textContent);
  assert.ok(h.q('#gm-npc [data-gm="npcfile"]'), 'the card still works: Add to the cast is there'); await h.save();
});

await test('13g. Earlier chips name what the card is (the NPC for Someone / Contact / Face), with the time and the position under it', async () => {
  const con = sitCon(), ui0 = con.situationDefaults();
  const rival = con.situation(4, Object.assign({}, ui0, { npc: 'rival:Nigel Sprocket' }), { seed: 7 });
  assert.ok(!rival.meta.label.includes('Nigel Sprocket'), 'the module\'s own label does not name the rival: ' + rival.meta.label);
  assert.ok(/^Someone: Nigel Sprocket — Grumpy/.test(P.earlierLabel(rival)), P.earlierLabel(rival));
  const friend = con.situation(4, Object.assign({}, ui0, { npc: 'friend:Marge Teacup' }), { seed: 7 });
  assert.ok(P.earlierLabel(friend).includes('Marge Teacup') && P.earlierLabel(friend) === friend.meta.label, 'a Contact names the friend already: unchanged');
  const face = con.situation(4, ui0, { seed: 5 });
  assert.equal(P.earlierLabel(face), face.meta.label, 'a Face names the NPC already');
  assert.ok(P.earlierLabel(face).includes(face.meta.face.name));
  const before = con.situation(1, ui0, { seed: 5 });
  assert.ok(!/Want \+1d/.test(P.earlierLabel(before)) && /^Before the roll: Hat Society/.test(P.earlierLabel(before)) && P.earlierLabel(before).length <= 'Before the roll: '.length + 45, P.earlierLabel(before));
  const fourfive = con.situation(2, Object.assign({}, ui0, { npc: 'rival:Nigel Sprocket' }), { seed: 7 });
  assert.equal(P.earlierLabel(fourfive), fourfive.meta.label, 'a 4/5 with a rival is about the consequence, not the rival');
  const cl1 = con.roll('reaction', Object.assign(con.defaults(), { npc: 'rival:Nigel Sprocket' }), { seed: 3 });
  assert.ok(/^NPC reaction: Nigel Sprocket — /.test(P.earlierLabel(cl1)), 'a single-table reaction too: ' + P.earlierLabel(cl1));
  assert.equal(P.earlierLabel({ meta: {} }), '', 'no label, no crash');
  // on the page: the chip is the label, the time and position are under it and in the title
  const h = await openPage({ br: fakeBrowser(), fg: fakeGm(), camp: CAMP3 });
  pick(h, '#gm-c-npc', 'rival:Nigel Sprocket'); h.press('4');
  const chip = h.q('#gm-earlier [data-gm="replay"]'), when = chip.querySelector('.gm-ech-s').textContent;
  assert.match(chip.querySelector('.gm-ech-t').textContent, /^Someone: Nigel Sprocket — /);
  assert.match(when, /^\d\d:\d\d · risky$/, 'the time and the position: ' + when);
  assert.ok(chip.getAttribute('title').includes(when) && chip.getAttribute('title').includes('Nigel Sprocket'), 'and the title says both');
  h.qa('#gm-pos [data-v="desperate"]')[0].click(); h.press('3');
  const chips = h.qa('#gm-earlier [data-gm="replay"]'); assert.equal(chips.length, 2);
  assert.match(chips[0].querySelector('.gm-ech-s').textContent, /· desperate$/, 'each chip has its own position');
  assert.match(chips[1].querySelector('.gm-ech-s').textContent, /· risky$/);
  // the other tools' chips carry the time (they have no position)
  h.q('[data-gm="scnroll"]').click(); assert.match(h.q('#gm-scn .gm-earlier .gm-ech-s').textContent, /^\d\d:\d\d$/);
  await h.save();
});

/* =====================================================================================================================
   15. E5, signed out mid-session: a 401 (Cloudflare Access expired) puts the saver on HOLD: nothing more is sent, new patches
   merge into the pending copy, which waits in the sticky copy as PENDING (a refused patch stays refused and is never resent);
   the bar says so plainly; the next open after a reload resends the pending copy once
   ===================================================================================================================== */
const SIGNED_OUT = Object.assign(new Error('signed out: reload the page to sign in again'), { status: 401, code: 'signed_out' });
const SO_MSG = 'Signed out: reload to sign in. Your notes are kept on this device.';
const stickyOf = (br) => JSON.parse(br.ls.get('b68.gm.sticky') || 'null');

await test('15a. a 401 (or the adapter\'s signed-out error) puts the saver on hold: nothing more is sent, new patches merge into the pending copy, nothing is parked', async () => {
  for (const err of [SIGNED_OUT, Object.assign(new Error('x'), { status: 401 }), Object.assign(new Error('x'), { code: 'signed_out' })]) {
    const h = harness({ fail: (p, n) => (n >= 2 ? err : null) });
    h.s.add({ a: 1 }); await h.s.flush(); await tick();
    h.s.add({ b: { x: 1 } }); await h.s.flush(); await tick();
    const st = h.s.state();
    assert.equal(st.hold, true); assert.equal(st.parked, null, 'a sign-out is not a refusal'); assert.deepEqual(st.pending, { b: { x: 1 } }); assert.equal(h.timers.size, 0, 'no retry is scheduled'); assert.equal(st.error, 'signed out');
    h.s.add({ b: { y: 2 }, c: 3 });
    assert.equal(h.timers.size, 0, 'no debounce timer while on hold'); await h.s.flush(); await h.s.beacon(); await tick();
    assert.deepEqual(h.sent, [{ a: 1 }, { b: { x: 1 } }], 'nothing is sent while on hold, the beacon neither');
    assert.deepEqual(h.s.state().pending, { b: { x: 1, y: 2 }, c: 3 }, 'later patches merge into the pending copy');
    assert.deepEqual(h.s.unsent(), { b: { x: 1, y: 2 }, c: 3 }, 'unsent() is what has not gone');
    assert.equal(P.signedOut(err), true);
  }
  assert.equal(P.signedOut({ status: 400 }), false); assert.equal(P.signedOut({ status: 403 }), false); assert.equal(P.signedOut(null), false); assert.equal(P.signedOut({ network: true }), false);
  assert.equal(P.retryable(Object.assign(new Error('x'), { status: 401 })), false, 'a 401 is still not retried on a timer');
});

await test('15b. a refused patch (400) is still parked and never resent, beside a sign-out hold; unsent() is the patch in flight and the pending one together', async () => {
  const bad = Object.assign(new Error('capture must be an object'), { status: 400 });
  const h = harness({ fail: (p) => (p.bad ? bad : p.out ? SIGNED_OUT : null) });
  h.s.add({ bad: 1 }); await h.s.flush(); await tick();
  assert.deepEqual(h.s.state().parked, { bad: 1 }); assert.equal(h.s.state().hold, false, 'a refusal is not a hold');
  h.s.add({ out: 1 }); await h.s.flush(); await tick();
  const st = h.s.state(); assert.equal(st.hold, true); assert.deepEqual(st.parked, { bad: 1 }, 'the refused patch stays parked'); assert.deepEqual(st.pending, { out: 1 }, 'the held one is pending');
  assert.deepEqual(h.s.unsent(), { out: 1 }, 'the refused patch is not part of what is resent');
  assert.deepEqual(h.sent, [{ bad: 1 }, { out: 1 }]);
  // in flight + pending together
  const g = harness(); const release = g.hold();
  g.s.add({ a: 1 }); g.s.flush(); g.s.add({ b: 2 }); await tick();
  assert.deepEqual(g.s.unsent(), { a: 1, b: 2 }, 'the write in flight is still unsent until it lands');
  release(); await tick(); await tick(); await tick(); assert.equal(g.s.unsent(), null, 'and nothing is unsent after');
  // the beacon: a signed-out answer holds the saver too, and keeps the patch
  const o2 = { debounce: 800, delay: () => 1, cancel() {}, send: async () => ({ doc: {}, updatedAt: 't' }), beacon: async () => { throw SIGNED_OUT; } };
  const s2 = P.makeSaver(o2); s2.add({ k: 1 }); await s2.beacon(); await tick();
  assert.equal(s2.state().hold, true); assert.deepEqual(s2.state().pending, { k: 1 }, 'a beacon that meets the sign-out page keeps its patch');
});

await test('15c. the page: a 401 mid-session puts a plain message in the bar, keeps the notes on this device as pending, and a reload resends them once', async () => {
  const br = fakeBrowser(), fg = fakeGm(), okPatch = fg.gm.patchState, seen = [];
  const h = await openPage({ br, fg, camp: CAMP3 });
  h.press('3'); await h.save(); assert.ok(fg.server.doc.cards.situation, 'signed in: the roll is saved');
  const h1 = await openPage({ br, fg, camp: CAMP3 }), before = cardTxt(h1);
  fg.gm.patchState = async (p) => { seen.push(p); throw SIGNED_OUT; };               // the Access session ends
  h1.press('2'); const rolled = cardTxt(h1); assert.notEqual(rolled, before);
  h1.q('#gm-cap-in').value = 'The goose, again'; dispatch(h1.q('[data-gm-form="capture"]'), 'submit');
  assert.ok(await until(() => h1.q('#gm-signed') && !h1.q('#gm-signed').hasAttribute('hidden') && h1.page._state(), 400), 'the bar message appears (the saver tried, got a 401)');
  const bar = h1.q('#gm-signed');
  assert.equal(bar.textContent, SO_MSG); assert.ok(bar.closest('.gm-bar'), 'it is in the bar'); assert.ok(h1.q('.gm-bar').className.split(/\s+/).includes('out'), 'the bar is marked');
  assert.equal(h1.q('.gm-save').textContent, 'Signed out'); assert.ok(h1.q('.gm-save').className.includes('bad'));
  assert.equal(br.toasts.filter((t) => t[0] === SO_MSG).length, 1, 'one toast, said once');
  assert.ok(!/Not saved|It is kept on this device; later changes still save/.test(h1.root.textContent + JSON.stringify(br.toasts)), 'the old "later changes still save" line is not said');
  h1.press('3'); const card1 = cardTxt(h1); h1.q('#gm-cap-in').value = 'A second line'; dispatch(h1.q('[data-gm-form="capture"]'), 'submit'); await new Promise((r) => setTimeout(r, 900));
  assert.equal(seen.length, 1, 'one request met the 401; the later patches were not sent');
  const sticky = stickyOf(br);
  assert.ok(sticky && sticky.pending && sticky.pending.cards && sticky.pending.cards.situation && sticky.pending.capture, 'the sticky copy holds the pending patch');
  assert.deepEqual(Object.values(sticky.pending.capture).map((e) => e.text).sort(), ['A second line', 'The goose, again'], 'with both lines');
  assert.ok(!sticky.parked, 'pending is not parked');
  assert.equal(Object.values(fg.server.doc.capture || {}).length, 0, 'the server has none of it');
  assert.equal(cardTxt(h1).length > 10, true, 'and the page keeps working on this device (a roll still draws)');
  const asked = []; br.W.confirm = (m) => { asked.push(m); return false; };
  h1.q('.gm-menu-list [data-gm="forget"]').click(); assert.ok(/not been saved|not yet saved/i.test(asked[0] || ''), 'Forget warns that unsent changes would go: ' + asked[0]);
  await h1.save(); assert.equal(seen.length, 1, 'closing the page sends nothing while signed out'); assert.ok(stickyOf(br).pending, 'and the copy is still there');
  // the next open after a reload, signed in again: the pending copy is resent once
  fg.gm.patchState = okPatch; fg.server.patches.length = 0;
  const h2 = await openPage({ br, fg, camp: CAMP3 });
  assert.ok(await until(() => fg.server.patches.some((p) => p.capture), 400), 'the pending copy was sent on the next open');
  assert.equal(h2.q('#gm-signed').hasAttribute('hidden'), true, 'no message now'); const card2 = cardTxt(h2);
  await h2.save();
  const sent = fg.server.patches.filter((p) => p.capture); assert.equal(sent.length, 1, 'once');
  assert.deepEqual(Object.values(fg.server.doc.capture).map((e) => e.text).sort(), ['A second line', 'The goose, again']);
  assert.equal(fg.server.doc.cards.situation.hid, JSON.parse(JSON.stringify(sticky.pending.cards.situation.hid)), 'the card rolled while signed out is the stored one');
  assert.equal(card2, card1, 'and the page draws it');
  assert.equal(stickyOf(br).pending, undefined, 'the sticky copy no longer holds it');
  const n = fg.server.patches.length, h3 = await openPage({ br, fg, camp: CAMP3 }); await h3.save();
  assert.equal(fg.server.patches.filter((p) => p.capture).length, 1, 'a later open does not resend it'); assert.equal(fg.server.patches.length, n, 'nothing at all is resent');
});

await test('15d. a refused 400 stays refused: kept on this device, shown as Not saved, and never resent after a reload', async () => {
  const br = fakeBrowser(), fg = fakeGm(), good = fg.gm.patchState;
  const h = await openPage({ br, fg, camp: CAMP3 });
  fg.gm.patchState = async (p) => { if (p.capture) throw Object.assign(new Error('capture must be an object'), { status: 400 }); return good(p); };
  h.q('#gm-cap-in').value = 'Refused line'; dispatch(h.q('[data-gm-form="capture"]'), 'submit');
  assert.ok(await until(() => /Not saved/.test(h.q('.gm-save').textContent), 400), 'Not saved'); assert.ok(h.q('#gm-signed').hasAttribute('hidden'), 'not the sign-out message');
  assert.ok(stickyOf(br).parked && stickyOf(br).parked.capture, 'kept on this device'); assert.equal(stickyOf(br).pending, undefined, 'and not pending');
  h.press('3'); await h.save();
  assert.ok(fg.server.doc.cards.situation, 'later changes still save');
  fg.gm.patchState = good; fg.server.patches.length = 0;
  const h2 = await openPage({ br, fg, camp: CAMP3 }); await new Promise((r) => setTimeout(r, 1000)); await h2.save();
  assert.ok(!fg.server.patches.some((p) => p.capture), 'the refused patch was not sent again');
  assert.ok(stickyOf(br).parked && stickyOf(br).parked.capture, 'it is still carried on this device');
});

await test('15e. the page-hide request meets the sign-in page (an opaque redirect): that is a sign-out too, not a retry loop', async () => {
  const br = fakeBrowser({ fetch: async () => ({ ok: false, status: 0, type: 'opaqueredirect' }) }), fg = fakeGm();
  const h = await openPage({ br, fg, camp: CAMP3 });
  h.press('3');
  br.doc.hidden = true; for (const fn of br.doc.listeners.visibilitychange || []) fn();
  assert.ok(await until(() => !h.q('#gm-signed').hasAttribute('hidden'), 400), 'a hidden tab whose keepalive request was redirected to the sign-in page shows the message');
  assert.equal(h.q('#gm-signed').textContent, SO_MSG); assert.ok(stickyOf(br).pending && stickyOf(br).pending.cards, 'and keeps the patch'); assert.equal(fg.server.patches.length, 0);
  br.doc.hidden = false;
});

await test('15f. an open that stops at the import screen (no pack on the server) leaves the pending copy in the sticky copy and sends nothing', async () => {
  const br = fakeBrowser(), fg = fakeGm(), pending = { capture: { cx: { id: 'cx', bucket: 'n', text: 'Kept for later', at: '2026-10-01T12:00:00.000Z', s: 3 } } };
  br.ls.set('b68.gm.sticky', JSON.stringify({ v: 1, user: 'gm1', live: {}, cards: {}, pending }));
  fg.gm.pack = async () => ({ version: '0', parts: {} }); br.W.claude = { gm: fg.gm };
  const page = loadPage(br.W), root = br.doc.createElement('div'); br.doc.body.appendChild(root);
  page.open(root, { ready: async () => {}, isGM: () => true, me: () => 'gm1', gm: () => fg.gm, db: () => null, campaign: () => CAMP3, saveFile() {}, copy() {} });
  assert.ok(await until(() => page._state() && page._state().status === 'import'), 'the import screen');
  await new Promise((r) => setTimeout(r, 1000));
  assert.equal(fg.server.patches.length, 0, 'nothing was sent'); assert.deepEqual(stickyOf(br).pending, pending, 'the pending copy is still in the sticky copy');
  page.close();
});

/* =====================================================================================================================
   16. E18, capture never blocks a roll: capture is budgeted by bytes; over it, the oldest lines of EARLIER sessions go first (never
   this session's), one toast per page load; only a session that alone exceeds the budget refuses new capture text; a roll is never refused
   ===================================================================================================================== */
const isoAt = (i) => new Date(Date.UTC(2026, 9, 1, 12, 0, 0) + i * 60000).toISOString();
function capLines(session, n, len, from) {
  const m = {};
  for (let i = 0; i < n; i++) { const id = 'c' + session + '_' + (from || 0) + '_' + i; m[id] = { id, bucket: 'm', text: 'q'.repeat(len), at: isoAt((session * 1000) + (from || 0) + i), s: session }; }
  return m;
}
const capBytes = (m) => Object.keys(m).reduce((n, k) => n + P.bytes(m[k]) + k.length + 6, 0);   // what the page counts for a line: its JSON, its key and the punctuation

await test('16a. capturePlan: within the budget everything stays; over it the oldest lines of earlier sessions go first, never this session\'s or a line without a session', () => {
  assert.ok(P.LIMITS.captureBytes >= 96 * 1024 && P.LIMITS.captureBytes <= 160 * 1024 && P.LIMITS.captureBytes < P.LIMITS.stateSoft, 'a byte budget well under the soft cap: ' + P.LIMITS.captureBytes);
  const e = (id, s) => ({ id, bucket: 'n', text: 't'.repeat(300), at: isoAt(90000), s });
  const map = Object.assign({}, capLines(1, 4, 300), capLines(2, 4, 300), capLines(3, 3, 300));
  map.nos = { id: 'nos', bucket: 'x', text: 'u'.repeat(300), at: isoAt(1) };                  // filed with no session known
  const per = capBytes({ new1: e('new1', 3) }), max = capBytes(map) + per;                       // room for exactly the new line
  let p = P.capturePlan(map, 'new1', e('new1', 3), 3, max);
  assert.equal(p.refused, false); assert.deepEqual(p.dropped, []); assert.deepEqual(Object.keys(p.patch), ['new1'], 'under the budget: just the new line');
  p = P.capturePlan(map, 'new1', e('new1', 3), 3, max - Math.round(per * 2.5));                  // two and a half lines too many
  assert.equal(p.refused, false); assert.deepEqual(p.dropped, ['c1_0_0', 'c1_0_1', 'c1_0_2'], 'three of the oldest earlier lines, session 1 first, oldest first');
  for (const id of p.dropped) assert.equal(p.patch[id], null);
  assert.equal(p.patch.new1.text.length, 300);
  const after = P.applyPatch({ capture: map }, { capture: p.patch }).capture; assert.ok(capBytes(after) <= max - Math.round(per * 2.5), 'it fits now');
  for (const id of Object.keys(capLines(3, 3, 300))) assert.ok(id in after, 'this session\'s line kept'); assert.ok('nos' in after, 'a line without a session is kept');
  p = P.capturePlan(map, 'new1', e('new1', 3), 3, capBytes(map) - per * 6);                      // more than session 1 holds: session 2 next, oldest session first
  assert.equal(p.refused, false); assert.equal(p.dropped.length, 7);
  assert.deepEqual(p.dropped.slice(0, 4), ['c1_0_0', 'c1_0_1', 'c1_0_2', 'c1_0_3'], 'all of session 1, then'); assert.ok(p.dropped.slice(4).every((id) => /^c2_/.test(id)), 'session 2');
  assert.ok(!p.dropped.some((id) => /^c3_|^nos$/.test(id)));
  // this session alone over the budget: refused, nothing dropped, nothing added
  const solo = capLines(3, 6, 300);
  p = P.capturePlan(solo, 'new1', e('new1', 3), 3, capBytes(solo));
  assert.equal(p.refused, true); assert.equal(p.patch, null); assert.deepEqual(p.dropped, []);
  const mix = Object.assign({}, capLines(1, 5, 300), capLines(3, 5, 300));
  p = P.capturePlan(mix, 'new1', e('new1', 3), 3, capBytes(capLines(3, 5, 300)) + per - 1);
  assert.equal(p.refused, true, 'every earlier line gone and this session still over: refused'); assert.equal(p.patch, null);
  p = P.capturePlan(mix, 'new1', e('new1', 3), 3, capBytes(capLines(3, 5, 300)) + per);
  assert.equal(p.refused, false); assert.equal(p.dropped.length, 5, 'and just enough room: the five earlier lines go');
  // a session that is not known drops nothing (no line can be shown to be earlier); a later session's lines are not earlier
  p = P.capturePlan(capLines(1, 6, 300), 'new1', e('new1'), undefined, 100); assert.equal(p.refused, true);
  p = P.capturePlan(capLines(5, 6, 300), 'new1', e('new1', 3), 3, 100); assert.equal(p.refused, true, 'lines of a later session are not earlier');
  // the 400-line cap still applies on top
  const many = {}; for (let i = 0; i < P.LIMITS.capture; i++) many['m' + i] = { id: 'm' + i, bucket: 'n', text: 'z', at: isoAt(i), s: 3 };
  p = P.capturePlan(many, 'new1', e('new1', 3), 3, 1e9); assert.equal(p.patch.m0, null, 'the oldest past 400 goes, as before'); assert.equal(p.dropped.length, 0);
  assert.deepEqual(P.capShed(map, 1, 3), ['c1_0_0'], 'capShed names the oldest earlier line for the first byte it must find');
  assert.equal(P.capShed(map, capBytes(capLines(1, 4, 300)) + 1, 3).length, 5, 'and goes on to the next session for more');
  assert.deepEqual(P.capShed(capLines(3, 4, 300), 1e9, 3), [], 'never this session\'s'); assert.deepEqual(P.capShed(map, 1e9, undefined), [], 'nor anything when the session is not known');
});

const submitCap = (h, text) => { h.q('#gm-cap-in').value = text; dispatch(h.q('[data-gm-form="capture"]'), 'submit'); };

await test('16b. on the page: over the byte budget, earlier sessions\' lines go first; one toast per page load says how many and that npm run gm:after files them; this session\'s are kept', async () => {
  const fg = fakeGm(), br = fakeBrowser();
  const earlier = Object.assign({}, capLines(1, 130, 470), capLines(2, 130, 470)), mine = capLines(3, 12, 200);
  fg.server.doc = { capture: Object.assign({}, earlier, mine, { nos: { id: 'nos', bucket: 'n', text: 'no session', at: isoAt(5) } }) };
  assert.ok(capBytes(fg.server.doc.capture) > P.LIMITS.captureBytes, 'the doc starts over the budget (' + capBytes(fg.server.doc.capture) + ')');
  const h = await openPage({ br, fg, camp: CAMP3 });                                        // session 3
  submitCap(h, 'The first new line');
  const left = () => h.page._state().doc.capture;
  assert.ok(capBytes(left()) <= P.LIMITS.captureBytes, 'under the budget now: ' + capBytes(left()));
  const toasts = br.toasts.filter((t) => /Dropped \d+ /.test(t[0]));
  assert.equal(toasts.length, 1, 'one toast: ' + JSON.stringify(br.toasts));
  assert.match(br.toasts[br.toasts.length - 1][0], /^Dropped \d+ /, 'and it is the last thing said: "Filed under ..." does not cover it (a toast has one line)');
  const n = +/Dropped (\d+)/.exec(toasts[0][0])[1], gone = Object.keys(earlier).filter((k) => !(k in left()));
  assert.equal(n, gone.length, 'it names how many'); assert.ok(n > 0 && /earlier session/.test(toasts[0][0]) && /npm run gm:after/.test(toasts[0][0]) && /vault/.test(toasts[0][0]), toasts[0][0]);
  for (const k of Object.keys(mine)) assert.ok(k in left(), 'this session\'s lines are all there'); assert.ok('nos' in left(), 'and the line with no session');
  const order = (a, b) => a.s - b.s || (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);
  const keptEarlier = Object.keys(earlier).filter((k) => k in left()).map((k) => earlier[k]).sort(order), oldestKept = keptEarlier[0];
  assert.ok(keptEarlier.length > 0); for (const k of gone) assert.ok(order(earlier[k], oldestKept) < 0, 'only the oldest went: ' + k);
  for (let i = 0; i < 40; i++) submitCap(h, 'filler ' + 'y'.repeat(400));
  assert.equal(br.toasts.filter((t) => /Dropped \d+ /.test(t[0])).length, 1, 'still one toast for the whole page load');
  assert.ok(capBytes(left()) <= P.LIMITS.captureBytes, 'and still under the budget');
  await h.save();
  assert.ok(capBytes(fg.server.doc.capture) <= P.LIMITS.captureBytes, 'saved under the budget'); assert.ok(Object.values(fg.server.doc.capture).some((e) => e.text === 'The first new line'));
  const br2 = fakeBrowser(), fg2 = fakeGm(); fg2.server.doc = { capture: Object.assign({}, earlier, capLines(3, 2, 100)) };
  const h2 = await openPage({ br: br2, fg: fg2, camp: CAMP3 }); submitCap(h2, 'x'); assert.equal(br2.toasts.filter((t) => /Dropped \d+ /.test(t[0])).length, 1, 'a new page load says it again'); await h2.save();
});

await test('16c. a session that alone fills the budget cannot file more text (a clear message), and a roll is never refused', async () => {
  const fg = fakeGm(), br = fakeBrowser(), mine = capLines(3, 300, 470);
  assert.ok(capBytes(mine) > P.LIMITS.captureBytes);
  fg.server.doc = { capture: Object.assign({}, capLines(2, 5, 100), mine) };
  const h = await openPage({ br, fg, camp: CAMP3 });
  const before = Object.keys(h.page._state().doc.capture).length;
  submitCap(h, 'one more line');
  assert.equal(Object.keys(h.page._state().doc.capture).length, before, 'nothing was added, and nothing dropped for a line that is refused');
  assert.ok(!Object.values(h.page._state().doc.capture).some((e) => e.text === 'one more line'), 'the line is not filed');
  const refusal = br.toasts.filter((t) => /capture/i.test(t[0]) && t[1] === true);
  assert.equal(refusal.length, 1, JSON.stringify(br.toasts)); assert.match(refusal[0][0], /Tonight.s capture is full/); assert.match(refusal[0][0], /Export tonight.s note/); assert.match(refusal[0][0], /rolls still work/i);
  assert.ok(!br.toasts.some((t) => /The GM notes are full/.test(t[0])), 'not the old "notes are full" message');
  for (const k of ['2', '3', '4', '1']) { h.press(k); assert.ok(cardTxt(h).length > 20, 'roll ' + k + ' still draws'); }
  h.press('l'); assert.equal(br.toasts.filter((t) => /Tonight.s capture is full/.test(t[0])).length, 2, 'L files text too: refused with the same message');
  await h.save();
  assert.ok(fg.server.doc.cards.situation && Object.keys(fg.server.doc.hist.situation).length === 4, 'every roll was saved');
  assert.ok(!br.toasts.some((t) => /The roll failed|notes are full/.test(t[0])));
});

await test('16d. a roll is never refused for want of room: near the server\'s cap the oldest sessions\' capture makes it', async () => {
  const fg = fakeGm(), br = fakeBrowser(), earlier = {};
  for (let i = 0; P.bytes({ capture: earlier }) < 257000; i++) Object.assign(earlier, capLines(1 + (i % 2), 1, 560, i));
  fg.server.doc = { capture: Object.assign({}, earlier, capLines(3, 4, 100)) };
  const size = P.bytes(fg.server.doc);
  assert.ok(size > 256500 && size < P.LIMITS.stateCap - 4096, 'the doc starts just under the hard line (' + size + ')');
  const h = await openPage({ br, fg, camp: CAMP3 });
  for (let i = 0; i < 6; i++) { h.press(String(1 + (i % 4))); assert.ok(cardTxt(h).length > 20, 'roll ' + (i + 1) + ' draws'); }
  assert.ok(!br.toasts.some((t) => /notes are full|The roll failed/.test(t[0])), JSON.stringify(br.toasts));
  assert.equal(br.toasts.filter((t) => /Dropped \d+ /.test(t[0])).length, 1, 'one toast says what made room');
  await h.save();
  assert.ok(P.bytes(fg.server.doc) <= P.LIMITS.stateCap - 4096, 'saved under the cap (' + P.bytes(fg.server.doc) + ')');
  assert.ok(Object.keys(fg.server.doc.hist.situation).length === 5 && fg.server.doc.cards.situation, 'the rolls are all there');
  for (const k of Object.keys(capLines(3, 4, 100))) assert.ok(k in fg.server.doc.capture, 'this session\'s lines are kept');
});

await test('16e. a bargain accepted while capture is full: the bargain is owed, its loose-end line is refused with the capture message, and "Accepted" does not cover it', async () => {
  const fg = fakeGm(), br = fakeBrowser(); fg.server.doc = { capture: capLines(3, 300, 470) };
  const h = await openPage({ br, fg, camp: CAMP3 });
  h.press('1');
  const btn = h.qa('#gm-card [data-gm="intent"]').find((b) => /Accepted/.test(b.textContent)); assert.ok(btn, 'a Devil\'s Bargain card offers Accepted');
  btn.click();
  assert.equal(Object.keys(h.page._state().doc.con.owed).length, 1, 'the bargain is owed');
  assert.ok(!Object.values(h.page._state().doc.capture).some((e) => /Bargain owed/.test(e.text)), 'its loose-end line was not filed');
  assert.match(br.toasts[br.toasts.length - 1][0], /^Tonight.s capture is full/, 'and the last thing said is why, not "Accepted."');
  await h.save();
});

/* =====================================================================================================================
   17. Downtime (D): personal business. The PCs from the live sheets (boot's api.characters(), slim copies), the activity's one row
       of buttons (a tap is the roll), the card (the morning after: the d100 box, the two cards, Keep, Another, Change, "Overindulged?";
       Start a clock), replay. Invented PCs, and invented morning tables in a pack part (the real ones never leave the vault).
   ===================================================================================================================== */
const ment = (lo, hi, band, title, md, play) => ({ lo, hi, band, title, md, play });
const MT = {
  benefit: [
    ment(1, 30, '01–30 · Small', 'The biscuit', 'A baker at {place} hands you a biscuit. *"Mind the crumbs."* **Nothing much.**', 'who baked it?'),
    ment(31, 50, '31–70 · Middling', 'The word', 'A neighbour stops you. *"I heard a thing."* **One answer, free.**', 'what thing?'),
    ment(51, 60, '31–70 · Middling', 'The tab', '{Host} waves your money away. *"Paid."* **A stack.**', 'who paid?'),
    ment(61, 70, '31–70 · Middling', 'The lift', 'A driver idles at the kerb. *"Hop in."* **A free ride.**', 'where to?'),
    ment(71, 100, '71–00 · Big', 'The jackpot', 'Everyone cheers at {place}. *"Again!"* **Keep both cards.**', 'the best moment?')
  ],
  mishap: [
    ment(1, 30, '01–50 · Bad', 'The cell', 'You wake in a cell. *"Talk."* **Attract Trouble: a questioning.**', 'talk, or not?'),
    ment(31, 50, '01–50 · Bad', 'The bill', 'A bill for a window. *"Pay up."* **Bad Decision: the glazier\'s clock.**', 'whose window?'),
    ment(51, 100, '51–00 · Silly', 'The song', 'A busker sings about you. *"Here they are!"* **Brag: +2 Heat.**', 'take a bow?')
  ]
};
const MPACK = (extraT) => ({ downtime: { version: 'm1', src: {}, body: { v: 2, T: Object.assign({}, MT, extraT || {}) } } });
const CLOCKHOOK = { vice: { Gambling: { hook: ['A debt comes due at {place}. || The debt at {place} (4)'] } } };     /* every Gambling card offers a clock */
const dtD100 = (h, v) => { const f = h.q('#gm-dt-d100'); f.value = v; h.q('#gm-dt [data-gm="dt-d100"]').click(); };
const mcards = (h) => h.qa('#gm-dt .gm-dt-mcard').map((c) => [c.getAttribute('data-which'), c.querySelector('.gm-dt-mt b').textContent]);
const PCS = [
  { id: 'c-mags', name: 'Mags Invented', alias: 'Mags', playbook: 'hound', playbookName: 'Hound', vice: 'Gambling', purveyor: 'Old Mo, Mo’s Bar',
    contacts: [{ name: 'Pell', role: 'a fixer', kind: null }, { name: 'Nim', role: 'a dock boss', kind: 'rival' }, { name: 'Ada', role: 'a nurse', kind: 'friend' }],
    clocks: [{ name: 'Fix the still', size: 6, filled: 6 }, { name: 'Learn the code', size: 8, filled: 3 }] },
  { id: 'c-rook', name: 'Rook Invented', alias: '', playbook: 'brute', playbookName: 'Brute', vice: 'Gettin’ Fucked Up', purveyor: '', contacts: [], clocks: [] }
];
/* a page with the PCs and a table that takes clocks: rig.pcs is what characters() returns (a fresh copy each call), rig.clocks what addClock got */
function dtRig(extra) {
  const rig = { pcs: cl(PCS), clocks: [], fail: null };
  rig.api = { characters: () => cl(rig.pcs), addClock: (c) => { rig.clocks.push(cl(c)); return rig.fail ? Promise.reject(rig.fail) : Promise.resolve(true); } };
  return Object.assign(rig, extra || {});
}
const dtPage = (rig, o) => openPage(Object.assign({ camp: CAMP3, api: (rig || dtRig()).api }, o || {}));
const dtCardTxt = (h) => cardOf(h, '#gm-dt .gm-dtcard');
const dtStored = (h) => h.page._state().doc.cards.downtime;
const dtRoll = (h, v) => h.q('#gm-dt [data-gm="dt-roll"][data-v="' + v + '"]').click();
const dtWho = (h, id) => h.q('#gm-dt [data-gm="dt-who"][data-id="' + id + '"]').click();
const dtAct = (h, a) => h.q('#gm-dt [data-gm="dt-act"][data-v="' + a + '"]').click();
const leadTxt = (h) => cardOf(h, '#gm-dt .gm-dtcard .gm-want');
const gridTxt = (h) => cardOf(h, '#gm-dt .gm-dtcard .gm-grid');

await test('17a. D opens the Downtime panel (a side tab after NPC, with its key; a phone segment too); never while typing or with a modifier', async () => {
  assert.deepEqual([P.keyAction({ key: 'd' }), P.keyAction({ key: 'D' })], [{ type: 'panel', panel: 'downtime' }, { type: 'panel', panel: 'downtime' }]);
  assert.deepEqual([P.keyAction({ key: 'd', typing: true }), P.keyAction({ key: 'd', ctrlKey: true }), P.keyAction({ key: 'd', metaKey: true })], [null, null, null]);
  const h = await dtPage();
  assert.equal(h.qa('.gm-tab').map((t) => t.getAttribute('data-panel')).join(), 'prep,rules,location,scenes,score,chase,npc,downtime,cards,ipad', 'Downtime sits after NPC in the generator group');
  assert.match(h.q('.gm-tab[data-panel="downtime"]').textContent, /^Downtime D$/);
  assert.equal(h.qa('[data-gm="seg"]').map((b) => b.getAttribute('data-seg')).join(), 'console,prep,location,scenes,score,chase,npc,downtime,cards,rules,ipad,state', 'and a phone segment after NPC');
  h.press('b'); assert.equal(h.page._state().panel, 'location');
  h.press('d', { target: h.q('#gm-dt-purveyor') });
  assert.equal(h.page._state().panel, 'location', 'D typed into a box is a letter, not the panel');
  h.press('d', { ctrlKey: true }); assert.equal(h.page._state().panel, 'location', 'nor with a modifier');
  h.press('d');
  assert.equal(h.page._state().panel, 'downtime'); assert.equal(h.q('[data-pane="downtime"]').hidden, false);
  assert.equal(h.q('#gm-dt .gm-band').textContent, 'Downtime · personal business', 'the heading');
  h.q('[data-gm="seg"][data-seg="downtime"]').click(); assert.equal(h.page._state().seg, 'side', 'the phone segment opens it as a side panel');
  await h.save();
});

await test('17b. Who: the PCs from the live sheets and "anyone"; picking one prefills the vice and purveyor from the sheet; editing the purveyor is panel state only', async () => {
  const rig = dtRig(), h = await dtPage(rig);
  h.press('d');
  assert.deepEqual(h.qa('#gm-dt [data-gm="dt-who"]').map((b) => b.textContent), ['Mags Invented', 'Rook Invented', 'anyone']);
  assert.equal(h.q('#gm-dt [data-gm="dt-who"][data-id=""]').getAttribute('aria-pressed'), 'true', 'anyone until a PC is picked');
  assert.deepEqual(h.qa('#gm-dt [data-gm="dt-act"]').map((b) => b.textContent), dtMk().ACTS.map((a) => a.label), 'the activities in the module\'s order');
  assert.deepEqual(h.qa('#gm-dt [data-gm="dt-act"]').map((b) => b.textContent), ['Indulge vice', 'Recover', 'Long-term project', 'Train', 'Friend or rival', 'Lay low', 'Acquire']);
  assert.equal(h.q('#gm-dt [data-gm="dt-act"][data-v="indulge"]').getAttribute('aria-pressed'), 'true', 'Indulge vice first, picked');
  assert.deepEqual(h.qa('#gm-dt-vice option').map((o) => o.getAttribute('value')), [''].concat(dtMk().VICES), 'the seven vices (and any)');
  dtWho(h, 'c-mags');
  assert.equal(h.q('#gm-dt [data-gm="dt-who"][data-id="c-mags"]').getAttribute('aria-pressed'), 'true');
  assert.equal(optSel(h, '#gm-dt-vice').getAttribute('value'), 'Gambling', 'the sheet\'s vice is preselected');
  assert.equal(h.q('#gm-dt-purveyor').value, 'Old Mo, Mo’s Bar', 'the sheet\'s purveyor fills the field');
  dtWho(h, 'c-rook');
  assert.equal(optSel(h, '#gm-dt-vice').getAttribute('value'), 'Gettin\' Fucked Up', 'a curly apostrophe on the sheet finds the vice');
  assert.equal(optSel(h, '#gm-dt-vice').textContent, 'Gettin’ Fucked Up', 'shown as the book spells it');
  assert.equal(h.q('#gm-dt-purveyor').value, '', 'no purveyor on the sheet: the field is empty (a stock host and place)');
  dtWho(h, 'c-mags');
  const pin = h.q('#gm-dt-purveyor'); pin.value = 'Old Mo, the back room'; dispatch(pin, 'change');
  assert.equal(h.page._state().doc.dt.ui.purveyor, 'Old Mo, the back room');
  assert.deepEqual(rig.pcs, PCS, 'the sheet is never written');
  await h.save();
  const ui = h.fg.server.doc.dt.ui;
  assert.deepEqual(ui, { who: 'c-mags', vice: 'Gambling', purveyor: 'Old Mo, the back room', project: '', contact: '' }, JSON.stringify(ui));
  assert.ok(h.fg.server.patches.every((p) => !p.characters && !p.play), 'nothing but the GM state is written');
});

await test('17c. Overindulged: one tap rolls the card; the morning\'s d100 box sits right under the scene (the Mishaps, a "?"); stored as replay info with the resolved strings', async () => {
  const rig = dtRig(), h = await dtPage(rig, { fg: fakeGm(undefined, MPACK()) });
  h.press('d'); dtWho(h, 'c-mags');
  assert.ok(!h.q('#gm-dt .gm-dtcard'), 'nothing before the first roll');
  assert.deepEqual(h.qa('#gm-dt [data-gm="dt-roll"]').map((b) => [b.getAttribute('data-v'), b.textContent]), [['in', 'Indulged'], ['over', 'Overindulged']], 'two buttons: how the vice roll went');
  dtRoll(h, 'over');
  const card = h.q('#gm-dt .gm-dtcard'); assert.ok(card, 'a card');
  assert.equal(cardOf(h, '#gm-dt .gm-dtcard h3'), 'Mags Invented · Indulge vice');
  assert.deepEqual(h.qa('#gm-dt .gm-dtcard .gm-chip').map((c) => c.textContent), ['Overindulged', 'Gambling']);
  const kids = card.children, iLead = kids.indexOf(h.q('#gm-dt .gm-dtcard .gm-want')), iMorn = kids.indexOf(h.q('#gm-dt .gm-dt-morning')), iGrid = kids.indexOf(h.q('#gm-dt .gm-dtcard .gm-grid'));
  assert.ok(iLead >= 0 && iMorn === iLead + 1 && iGrid > iMorn, 'the morning sits right under the scene, above the grid');
  assert.ok(h.q('#gm-dt .gm-dt-morning').classList.contains('gm-dt-bad'), 'a Mishap box, in the alarm colour');
  assert.match(cardOf(h, '#gm-dt .gm-dt-mh'), /^The morning after · Mishaps/);
  assert.ok(h.q('#gm-dt .gm-dt-mh [data-gm="dt-rule"]'), 'a "?" for the rules on overindulging');
  assert.ok(h.q('#gm-dt-d100') && h.q('#gm-dt [data-gm="dt-d100"]') && h.q('#gm-dt [data-gm="dt-d100-roll"]'), 'the d100 box, Read it, and Roll one');
  assert.equal(h.q('#gm-dt-d100').getAttribute('inputmode'), 'numeric', 'a number pad on a phone');
  assert.ok(!h.q('#gm-dt .gm-dt-mcard'), 'no cards before the d100');
  assert.ok(h.q('#gm-dt .gm-dtcard [data-gm="dt-over"][data-v="in"]'), 'and a small "Not overindulged?"');
  const st = dtStored(h), mod = dtMk({ vices: CT.VICES, pack: MT }).replay({ seed: st.seed, mem: JSON.parse(st.mem), ui: st.ui });
  assert.equal(leadTxt(h), (mod.lines[0].md + mod.lines[0].small).replace(/\s+/g, ' ').trim(), 'the module\'s scene, as drawn (this fake page shows markdown as written)');
  assert.ok(!/iPad/.test(cardOf(h, '#gm-dt .gm-dtcard')) && h.qa('#gm-dt [data-gm]').every((b) => !/ipad/i.test(b.getAttribute('data-gm'))), 'no iPad button: downtime cards never go to the display');
  assert.equal(h.q('#gm-dt [data-gm="dt-roll"][data-v="over"]').getAttribute('aria-pressed'), 'true', 'the button that made the card stays marked');
  assert.equal(h.q('#gm-dt [data-gm="dt-roll"][data-v="in"]').getAttribute('aria-pressed'), 'false');
  await h.save();
  const d = h.fg.server.doc, c = d.cards.downtime;
  assert.deepEqual(Object.keys(c).sort(), ['at', 'hid', 'label', 'mem', 'seed', 'ui']);
  assert.ok(Number.isInteger(c.seed) && c.mem === '{}' && c.label === 'Mags Invented · Gambling · overindulged', JSON.stringify(c));
  assert.deepEqual([c.ui.act, c.ui.who, c.ui.vice, c.ui.purveyor, c.ui.res, c.ui.d100], ['indulge', 'Mags Invented', 'Gambling', 'Old Mo, Mo’s Bar', 'over', ''], 'the resolved strings, not the sheet\'s id');
  assert.ok(!('lines' in c) && !('meta' in c), 'replay info only');
  assert.equal(Object.keys(d.hist.downtime).length, 1); assert.equal(d.hist.downtime[c.hid].seed, c.seed);
  assert.ok(isObjLike(d.mem.downtime) && Object.values(d.mem.downtime).every((a) => Array.isArray(a) && a.every(Number.isInteger)), 'the repeat guard keeps small integer arrays');
  assert.equal(h.fg.server.displays.length, 0, 'nothing went to the iPad');
});

await test('17d. the d100 redraws the SAME card: the card it lands on and a second from its band; Keep folds the other; Another deals the next; Change asks again; both cards go into the repeat guard', async () => {
  const h = await dtPage(undefined, { fg: fakeGm(undefined, MPACK()) });
  h.press('d'); dtWho(h, 'c-mags'); dtRoll(h, 'in');
  assert.match(cardOf(h, '#gm-dt .gm-dt-mh'), /^The morning after · Benefits/);
  const before = cl(dtStored(h)), lead = leadTxt(h), grid = gridTxt(h);
  dtD100(h, '45');
  const after = () => dtStored(h), same = (x) => assert.deepEqual([x.hid, x.seed, x.mem, x.at], [before.hid, before.seed, before.mem, before.at], 'the same card');
  same(after()); assert.equal(after().ui.d100, '45');
  assert.equal(leadTxt(h), lead, 'the scene above does not change'); assert.equal(gridTxt(h), grid, 'nor the rows');
  const two = mcards(h);
  assert.deepEqual(two[0], ['roll', 'The word'], '45 lands on The word');
  assert.ok(two[1][0] === 'alt' && ['The tab', 'The lift'].includes(two[1][1]), 'the second card from the same band: ' + two[1]);
  assert.match(cardOf(h, '#gm-dt .gm-dt-mh'), /^The morning after · Benefits · 45 · 31–70 · Middling/);
  assert.ok(!h.q('#gm-dt-d100'), 'the box goes once the number is in');
  assert.match(cardOf(h, '#gm-dt .gm-dt-mcard'), /\*\*Play it:\*\* what thing\?/, 'Play it under the card');
  assert.deepEqual(h.qa('#gm-dt .gm-dtcard .gm-chip').map((c) => c.textContent), ['Indulged', 'Gambling', 'Benefit 45']);
  assert.equal(after().label, 'Mags Invented · Gambling · The word');
  assert.deepEqual(h.page._state().doc.hist.downtime[before.hid].ui, after().ui, 'its Earlier entry follows');
  const guard = cl(h.page._state().doc.mem.downtime['morning.benefit']);
  assert.deepEqual(guard.sort(), [1, MT.benefit.findIndex((e) => e.title === two[1][1])].sort(), 'both cards are in the repeat guard now');
  /* Keep the second card: the first folds to its title; a second tap unfolds it */
  h.q('#gm-dt [data-gm="dt-keep"][data-v="alt"]').click();
  same(after()); assert.equal(after().ui.keep, 'alt');
  const roll = h.q('#gm-dt .gm-dt-mcard[data-which="roll"]'), alt = h.q('#gm-dt .gm-dt-mcard[data-which="alt"]');
  assert.ok(roll.classList.contains('gm-dt-off') && !/neighbour/.test(cardOf(h, '#gm-dt .gm-dt-mcard[data-which="roll"]')), 'the other card folds to its title');
  assert.ok(alt.classList.contains('gm-dt-kept') && h.q('#gm-dt [data-gm="dt-keep"][data-v="alt"]').getAttribute('aria-pressed') === 'true' && /Kept/.test(cardOf(h, '#gm-dt [data-gm="dt-keep"][data-v="alt"]')));
  assert.ok(!h.q('#gm-dt [data-gm="dt-deal"]'), 'no Another while a card is kept');
  assert.equal(after().label, 'Mags Invented · Gambling · ' + two[1][1], 'the label names the card kept');
  h.q('#gm-dt [data-gm="dt-keep"][data-v="alt"]').click();
  assert.equal(after().ui.keep, '', 'a second tap puts both back'); assert.ok(!h.q('#gm-dt .gm-dt-off'));
  /* Another: the band's other card, then round again */
  h.q('#gm-dt [data-gm="dt-deal"]').click(); same(after());
  assert.equal(after().ui.deal, '1'); const next = mcards(h)[1][1];
  assert.ok(['The tab', 'The lift'].includes(next) && next !== two[1][1], 'Another deals the other card in the band: ' + next);
  h.q('#gm-dt [data-gm="dt-deal"]').click(); assert.equal(mcards(h)[1][1], two[1][1], 'then round again');
  assert.equal(leadTxt(h), lead, 'the scene never moved');
  /* Change: the box again; Enter reads it; 00 is 100; a number that is not a d100 says so and changes nothing */
  h.q('#gm-dt [data-gm="dt-d100-clear"]').click();
  assert.ok(h.q('#gm-dt-d100') && !h.q('#gm-dt .gm-dt-mcard') && after().ui.d100 === '' && after().ui.deal === '', 'Change: the box is back');
  h.q('#gm-dt-d100').value = '140'; h.q('#gm-dt [data-gm="dt-d100"]').click();
  assert.ok(h.br.toasts.some((t) => /^A d100 is 1 to 100/.test(t[0]) && t[1]) && after().ui.d100 === '', 'not a d100: a toast, nothing stored');
  h.q('#gm-dt-d100').value = '00'; h.press('Enter', { target: h.q('#gm-dt-d100') });
  assert.equal(after().ui.d100, '100'); assert.deepEqual(mcards(h)[0], ['roll', 'The jackpot'], 'Enter reads it, and 00 is 100');
  assert.ok(!h.q('#gm-dt .gm-dt-alt'), 'a band of one: no second card');
  h.q('#gm-dt [data-gm="dt-d100-clear"]').click(); h.q('#gm-dt [data-gm="dt-d100-roll"]').click();
  assert.ok(+after().ui.d100 >= 1 && +after().ui.d100 <= 100 && h.q('#gm-dt .gm-dt-mcard'), 'Roll one: the page rolls the d100: ' + after().ui.d100);
  same(after());
  h.press('l'); assert.ok(Object.values(h.page._state().doc.capture).some((e) => e.bucket === 'r' && e.text === 'Downtime: ' + after().label), 'L files the card as it now reads');
  await h.save();
});

await test('17e. "Overindulged?" and "Not overindulged?" turn the SAME card to the other table (same seed, the scene kept); a d100 already in reads the other table', async () => {
  const h = await dtPage(undefined, { fg: fakeGm(undefined, MPACK()) });
  h.press('d'); dtWho(h, 'c-mags'); dtRoll(h, 'in'); dtD100(h, '15');
  assert.deepEqual(mcards(h)[0], ['roll', 'The biscuit']);
  const before = cl(dtStored(h)), lead = leadTxt(h), grid = gridTxt(h);
  h.q('#gm-dt [data-gm="dt-over"][data-v="over"]').click();
  let after = dtStored(h);
  assert.deepEqual([after.hid, after.seed, after.mem], [before.hid, before.seed, before.mem], 'the same card');
  assert.deepEqual([after.ui.res, after.ui.d100], ['over', '15'], 'overindulged, the d100 kept');
  assert.deepEqual(mcards(h).map((c) => c[1]).sort(), ['The bill', 'The cell'], 'the Mishaps it lands on, and its band\'s other');
  assert.match(cardOf(h, '#gm-dt .gm-dt-mcard'), /\*\*Attract Trouble: a questioning\.\*\*.*\*\*Cost: Attract trouble\.\*\* Trouble follows you home/, 'the cost under it, the book\'s line in our words');
  assert.equal(leadTxt(h), lead, 'the scene stays'); assert.equal(gridTxt(h), grid);
  h.q('#gm-dt [data-gm="dt-over"][data-v="in"]').click();
  after = dtStored(h); assert.deepEqual([after.ui.res, after.ui.d100], ['', '15'], 'and back');
  assert.deepEqual(mcards(h)[0], ['roll', 'The biscuit']);
  assert.equal(Object.keys(h.page._state().doc.hist.downtime).length, 1, 'still one card in Earlier');
  await h.save();
});

await test('17f. replay: a reload redraws the stored card exactly (even after the sheet changed), and Earlier brings back an older one as it was left', async () => {
  const rig = dtRig(), fg = fakeGm(undefined, MPACK()), br = fakeBrowser();
  const h = await dtPage(rig, { fg, br });
  h.press('d'); dtWho(h, 'c-mags'); dtRoll(h, 'over'); dtD100(h, '60');
  h.q('#gm-dt [data-gm="dt-keep"][data-v="roll"]').click();
  const a = dtCardTxt(h);
  assert.ok(/The song/.test(a) && dtStored(h).ui.keep === 'roll');
  dtAct(h, 'recover'); dtRoll(h, '45');
  const b = dtCardTxt(h); assert.notEqual(a, b);
  await h.save();
  rig.pcs[0].purveyor = 'Someone New, Elsewhere'; rig.pcs[0].name = 'Mags Renamed';      // the sheet changes after the roll
  const h2 = await dtPage(rig, { fg, br });
  h2.press('d');
  assert.equal(dtCardTxt(h2), b, 'the same card after a reload');
  const chips = h2.qa('#gm-dt [data-gm="replay"]'); assert.equal(chips.length, 2, 'two in Earlier');
  chips.filter((c) => !c.hasAttribute('aria-current'))[0].click();
  assert.equal(dtCardTxt(h2), a, 'Earlier redraws the first card with its d100 and the card kept, the old name and purveyor');
  await h2.save();
  const h3 = await dtPage(rig, { fg, br }); h3.press('d');
  assert.equal(dtCardTxt(h3), a, 'and that is the card that comes back');
  await h3.save();
});

await test('17g. Start a clock: addClock gets one hidden danger clock, once; the button is done for that card, after a reload too; the rail shows it from the table', async () => {
  const rig = dtRig(), fg = fakeGm(undefined, MPACK(CLOCKHOOK)), br = fakeBrowser();
  const h = await dtPage(rig, { fg, br });
  h.press('d'); dtWho(h, 'c-mags'); dtRoll(h, 'over');       // the pack's Gambling hook brings a clock on every card
  const btn = () => h.qa('#gm-dt [data-gm="dt-clock"]').find((b) => /^Start a clock: |^Clock started: /.test(b.textContent) && b.getAttribute('data-i') === '0');
  assert.ok(btn(), 'a Start a clock button'); const label = btn().textContent, name = /^Start a clock: (.*) \((\d+)\)$/.exec(label);
  assert.ok(name, label);
  btn().click(); btn() && btn().click();
  assert.ok(await until(() => br.toasts.some((t) => /^Clock started/.test(t[0]))), 'a toast');
  assert.equal(rig.clocks.length, 1, 'addClock was called once');
  const c = rig.clocks[0];
  assert.ok(/^c_[a-z0-9]+$/.test(c.id), c.id);
  assert.deepEqual(Object.assign({}, c, { id: 'x' }), { id: 'x', name: name[1], size: +name[2], filled: 0, kind: 'danger', hidden: true });
  assert.ok(br.toasts.some((t) => t[0] === 'Clock started, hidden from the players: ' + name[1] + '. Show it from the table page.' && !t[1]), JSON.stringify(br.toasts));
  assert.ok(btn().hasAttribute('disabled') && btn().textContent === 'Clock started: ' + name[1], 'the button is done');
  btn().click(); await tick(); assert.equal(rig.clocks.length, 1, 'a second tap starts nothing');
  const st = dtStored(h);
  assert.equal(st.started[name[1]], c.id, 'the card keeps the clock\'s id'); assert.equal(h.page._state().doc.hist.downtime[st.hid].started[name[1]], c.id, 'and so does its Earlier entry');
  h.page.campaign({ session: { number: 3 }, crew: {}, clocks: [c] });
  assert.ok(new RegExp(name[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' hidden from players').test(cardOf(h, '#gm-rail')), 'the rail\'s Table clocks shows it, hidden');
  await h.save();
  const h2 = await dtPage(rig, { fg, br }); h2.press('d');
  const b2 = h2.qa('#gm-dt [data-gm="dt-clock"]').find((b) => b.getAttribute('data-i') === '0');
  assert.ok(b2.hasAttribute('disabled') && b2.textContent === 'Clock started: ' + name[1], 'still done after a reload');
  dtRoll(h2, 'over');
  assert.ok(!('started' in dtStored(h2)), 'a new card starts with no clock of the old one\'s');
  await h2.save();
  /* the table refuses it: the button comes back, and the toast says so */
  const rig3 = dtRig({ fail: new Error('the table is offline') }), h3 = await dtPage(rig3, { fg: fakeGm(undefined, MPACK(CLOCKHOOK)) });
  h3.press('d'); dtWho(h3, 'c-mags'); dtRoll(h3, 'over');
  h3.q('#gm-dt [data-gm="dt-clock"]').click();
  assert.ok(await until(() => h3.br.toasts.some((t) => /^Could not start the clock: the table is offline/.test(t[0]) && t[1])));
  assert.ok(!h3.q('#gm-dt [data-gm="dt-clock"]').hasAttribute('disabled') && !('started' in dtStored(h3)), 'not marked started');
  await h3.save();
});

await test('17h. Project, Friend or rival, Train and the bands: the selects come from the PC\'s own sheet; each button rolls at once with what it says', async () => {
  const h = await dtPage();
  h.press('d'); dtWho(h, 'c-mags'); dtAct(h, 'project');
  assert.deepEqual(h.qa('#gm-dt-project option').map((o) => o.textContent), ['Fix the still · 6/6', 'Learn the code · 3/8', 'another project']);
  assert.equal(optSel(h, '#gm-dt-project').getAttribute('value'), 'Learn the code', 'the first clock still open');
  assert.deepEqual(h.qa('#gm-dt [data-gm="dt-roll"]').map((b) => b.textContent), ['1–3', '4/5', '6', 'Crit']);
  assert.match(cardOf(h, '#gm-dt .gm-dt-row .gm-lab'), /^Rolled at the table:$/);
  dtRoll(h, '45');
  assert.deepEqual([dtStored(h).ui.project, dtStored(h).ui.res], ['Learn the code', '45']);
  assert.equal(cardOf(h, '#gm-dt .gm-dtcard h3'), 'Mags Invented · Project: Learn the code');
  assert.deepEqual(h.qa('#gm-dt .gm-dtcard .gm-chip').map((c) => c.textContent), ['4/5', '+2 on the clock']);
  change(h.q('#gm-dt-project'), 'Fix the still'); dtRoll(h, 'crit');
  assert.deepEqual([dtStored(h).ui.project, dtStored(h).ui.res], ['Fix the still', 'crit']);
  change(h.q('#gm-dt-project'), '*'); dtRoll(h, '13');
  assert.equal(dtStored(h).ui.project, '', '"another project": the card says "the project"'); assert.equal(cardOf(h, '#gm-dt .gm-dtcard h3'), 'Mags Invented · Project');
  dtAct(h, 'contact');
  assert.deepEqual(h.qa('#gm-dt-contact option').map((o) => o.textContent), ['Nim, a dock boss (rival)', 'Ada, a nurse (friend)', 'Pell, a fixer', 'someone else (an old friend or rival)'], 'a friend or a rival first');
  const rel = (r) => h.q('#gm-dt [data-gm="dt-roll"][data-v="' + r + '"]');
  assert.ok(rel('rival').classList.contains('gm-dtb-sheet') && /on the sheet/.test(rel('rival').textContent) && !rel('friend').classList.contains('gm-dtb-sheet'), 'the contact\'s relation on the sheet is marked');
  change(h.q('#gm-dt-contact'), 'Ada, a nurse');
  assert.ok(rel('friend').classList.contains('gm-dtb-sheet') && !rel('rival').classList.contains('gm-dtb-sheet'), 'and follows the contact picked');
  rel('rival').click();
  assert.deepEqual([dtStored(h).ui.contact, dtStored(h).ui.rel], ['Ada, a nurse', 'rival'], 'the contact line and the relation the GM tapped');
  assert.equal(cardOf(h, '#gm-dt .gm-dtcard h3'), 'Mags Invented · Rival: Ada');
  dtAct(h, 'train');
  assert.deepEqual(h.qa('#gm-dt [data-gm="dt-roll"]').map((b) => b.textContent), ['Insight', 'Prowess', 'Resolve', 'Playbook']);
  dtRoll(h, 'Prowess'); assert.equal(dtStored(h).ui.attr, 'Prowess'); assert.deepEqual(h.qa('#gm-dt .gm-dtcard .gm-chip').map((c) => c.textContent), ['Prowess', '+1 xp']);
  for (const act of ['recover', 'heat', 'acquire']) {
    dtAct(h, act); assert.deepEqual(h.qa('#gm-dt [data-gm="dt-roll"]').map((b) => b.getAttribute('data-v')), ['13', '45', '6', 'crit'], act);
    dtRoll(h, '6'); assert.deepEqual([dtStored(h).ui.act, dtStored(h).ui.res], [act, '6']);
  }
  dtWho(h, 'c-rook'); dtAct(h, 'contact');
  assert.ok(!h.q('#gm-dt-contact') && /No contacts on Rook Invented’s sheet/.test(cardOf(h, '#gm-dt')), 'a PC without contacts: a plain note');
  rel('friend').click(); assert.equal(cardOf(h, '#gm-dt .gm-dtcard h3'), 'Rook Invented · Friend: An old friend');
  dtAct(h, 'project'); assert.ok(!h.q('#gm-dt-project') && /No clocks on Rook Invented’s sheet/.test(cardOf(h, '#gm-dt')));
  assert.equal(Object.keys(h.page._state().doc.hist.downtime).length, 5, 'Earlier keeps five');
  await h.save();
});

await test('17i. Copy and Pin are the card as plain lines; L files "Downtime: <label>"; Now in is the card\'s district (the scroll is gm.e2e.mjs\'s)', async () => {
  const fg = fakeGm(undefined, nowParts()), br = fakeBrowser(), h = await dtPage(undefined, { fg, br });
  const now = h.qa('#gm-now option').map((o) => o.getAttribute('value')).filter(Boolean)[0]; assert.ok(now, 'a Now in to pick');
  pick(h, '#gm-now', now);
  h.press('d'); dtWho(h, 'c-mags'); dtAct(h, 'heat');
  dtRoll(h, '45');
  assert.equal(dtStored(h).ui.district, now, 'Now in, stored in the card\'s own ui');
  const card = h.q('#gm-dt-card'); assert.ok(card && card.classList.contains('gm-cardbox'), 'the card sits in a card box, as the console\'s');
  h.q('#gm-dt [data-gm="copy"]').click();
  const all = dtMk({ vices: CT.VICES }).replay({ seed: dtStored(h).seed, mem: JSON.parse(dtStored(h).mem), ui: dtStored(h).ui }).meta.all;
  assert.equal(br.copied, all.join('\n'), 'Copy is meta.all'); assert.ok(!/\*\*/.test(br.copied));
  h.q('#gm-dt [data-gm="pin"]').click(); h.press('l');
  await h.save();
  const pins = Object.values(fg.server.doc.pins); assert.equal(pins.length, 1); assert.equal(pins[0].tool, 'downtime'); assert.equal(pins[0].text, all.join('\n'));
  assert.ok(Object.values(fg.server.doc.capture).some((e) => e.bucket === 'r' && e.text === 'Downtime: ' + fg.server.doc.cards.downtime.label && e.s === 3), 'L, with the session');
});

await test('17j. the "?" by Overindulged opens the rules on overindulging in the GM screen pane (its own search)', async () => {
  const asked = [];
  const rules = { available: () => true, load: async () => ({ entries: [{}] }),
    hits: (q) => { asked.push(q); return { total: 2, hits: [{ id: 'x/stress', title: 'Stress', caption: 'Invented book', snip: '' }, { id: 'x/vice', title: 'Indulging a vice', caption: 'Invented book', snip: '' }] }; },
    entry: (id) => ({ id, title: id === 'x/vice' ? 'Indulging a vice' : 'Stress', caption: 'Invented book', href: '#rules/x/vice', md: 'When you **overindulge**, choose one.', also: [] }) };
  const h = await dtPage(undefined, { br: fakeBrowser({ B68Rules: rules }), fg: fakeGm(undefined, MPACK()) });
  h.press('d'); dtWho(h, 'c-mags'); dtRoll(h, 'over');
  h.q('#gm-dt .gm-dt-mh [data-gm="dt-rule"]').click();
  assert.equal(h.page._state().panel, 'rules', 'the GM screen pane');
  assert.ok(await until(() => h.q('.gs-entry')), 'the entry opens');
  assert.deepEqual(asked, ['overindulge']); assert.match(cardOf(h, '.gs-entry .gs-h'), /^Indulging a vice/, 'the hit about indulging, not the first hit');
  h.press('d'); dtRoll(h, 'in');
  assert.ok(!h.q('#gm-dt .gm-dt-mh [data-gm="dt-rule"]'), 'a Benefit has no "?" in its heading');
  h.q('#gm-dt .gm-dt-flip [data-gm="dt-rule"]').click(); assert.equal(h.page._state().panel, 'rules', 'the "?" by "Overindulged?" too');
  await h.save();
});

await test('17k. without a module, without the characters, with a pack part over the tables: the panel says so or uses it; the pack check names what a part lacks', async () => {
  const none = await openPage({ br: fakeBrowser({ B68GmDowntime: undefined }) });
  none.press('d'); assert.match(none.q('#gm-dt').textContent, /The downtime module is missing/); none.press('2'); assert.ok(cardTxt(none).length > 20, 'the console still rolls'); await none.save();
  const bookless = await openPage({ br: fakeBrowser({ B68DowntimeTables: undefined }) });
  bookless.press('d'); assert.match(bookless.q('#gm-dt').textContent, /The downtime tables are missing/); await bookless.save();
  const bare = await openPage({ camp: CAMP3 });       // an older boot without characters() or addClock()
  bare.press('d');
  assert.deepEqual(bare.qa('#gm-dt [data-gm="dt-who"]').map((b) => b.textContent), ['anyone']); assert.match(cardOf(bare, '#gm-dt'), /No characters are filed yet/);
  dtRoll(bare, 'over'); assert.ok(bare.q('#gm-dt .gm-dtcard') && dtStored(bare).ui.who === '', 'anyone: a card with a stock host');
  await bare.save();
  const bare2 = await openPage({ camp: CAMP3, fg: fakeGm(undefined, MPACK({ vice: { [dtMk().VICES[0]]: { hook: ['A debt comes due. || The debt (4)'] } } })) });
  bare2.press('d'); pick(bare2, '#gm-dt-vice', dtMk().VICES[0]); dtRoll(bare2, 'over'); bare2.q('#gm-dt [data-gm="dt-clock"]').click();
  assert.ok(bare2.br.toasts.some((t) => /table is not available here/.test(t[0])), 'no addClock: it says where to start it');
  await bare2.save();
  const T = { vice: { Gambling: { lead: ['{Host} deals you in at {place}, and the night begins.'] } } };
  const own = await dtPage(undefined, { fg: fakeGm(undefined, { downtime: { version: 'd1', src: {}, body: { T } } }) });
  own.press('d'); dtWho(own, 'c-mags'); dtRoll(own, 'in');
  assert.match(leadTxt(own), /^Old Mo deals you in at Mo’s Bar, and the night begins\./, 'the pack part\'s table is used');
  await own.save();
  const broken = { vice: { Gambling: { lead: [] } } };
  const bad = await dtPage(undefined, { fg: fakeGm(undefined, { downtime: { version: 'd2', src: {}, body: { T: broken } } }) });
  bad.press('d'); dtRoll(bad, 'over');
  assert.ok(bad.q('#gm-dt .gm-dtcard') && /lacks tables, so these cards use the built-in ones/.test(cardOf(bad, '#gm-dt')), 'a part that lacks tables: the built-in ones, and a note');
  const dmods = { B68GmDowntime: DT, B68DowntimeTables: DTT };
  assert.deepEqual(P.packWarnings(dmods, { downtime: { T: broken } }), [{ part: 'downtime', missing: ['vice.Gambling.lead'] }], 'the pack check lists it, laid over the built-in tables');
  assert.deepEqual(P.packWarnings(dmods, { downtime: { T: T } }), [], 'a part that replaces one table is complete over the built-in ones');
  assert.deepEqual(P.packWarnings(dmods, { downtime: {} }), [], 'a part with no tables replaces nothing');
  assert.deepEqual(P.packWarnings({ B68GmDowntime: DT }, { downtime: { T: broken } }), [], 'without the built-in tables loaded it says nothing');
  await bad.save();
});

await test('17m. the morning after without the pack\'s tables: one line that says where they are, no d100 box; a pack with Benefits only still says where the Mishaps are; an older card (Good Mornings, a picked option) still opens', async () => {
  const bare = await dtPage();
  bare.press('d'); dtWho(bare, 'c-mags'); dtRoll(bare, 'in');
  assert.ok(!bare.q('#gm-dt-d100') && !bare.q('#gm-dt .gm-dt-morning'), 'no d100 box without the tables');
  assert.match(cardOf(bare, '#gm-dt .gm-dtcard'), /\*\*A Benefit\.\*\* Roll a d100 on the table in the vault: the Morning After\.\s*The pack carries no Benefits yet/, 'it says where the table is');
  bare.q('#gm-dt [data-gm="dt-over"][data-v="over"]').click();
  assert.match(cardOf(bare, '#gm-dt .gm-dtcard'), /\*\*A Mishap\.\*\* Roll a d100 on the table in the vault/);
  await bare.save();
  const half = await dtPage(undefined, { fg: fakeGm(undefined, { downtime: { version: 'b1', src: {}, body: { T: { benefit: MT.benefit } } } }) });
  half.press('d'); dtWho(half, 'c-mags'); dtRoll(half, 'in');
  assert.ok(half.q('#gm-dt-d100'), 'the Benefits are there: a d100 box');
  dtRoll(half, 'over'); assert.ok(!half.q('#gm-dt-d100') && /\*\*A Mishap\.\*\* Roll a d100/.test(cardOf(half, '#gm-dt .gm-dtcard')), 'no Mishaps: it says where they are');
  await half.save();
  /* a card stored by the version before (a vice result, a picked overindulgence) replays as a night with the d100 still to come */
  const fg = fakeGm(undefined, MPACK());
  fg.server.doc = { cards: { downtime: { hid: 'h_old', seed: 77, mem: '{}', label: 'Mags · Gambling · over: Brag', at: '2026-10-16T10:00:00.000Z', ui: { act: 'indulge', who: 'Mags', vice: 'Gambling', purveyor: '', res: 'over', pick: 'brag', vres: '6' } } } };
  const old = await dtPage(undefined, { fg }); old.press('d');
  assert.ok(old.q('#gm-dt .gm-dtcard') && old.q('#gm-dt-d100') && /Mishaps/.test(cardOf(old, '#gm-dt .gm-dt-mh')), 'the old card opens: overindulged, the d100 to come');
  dtD100(old, '70'); assert.deepEqual(mcards(old)[0], ['roll', 'The song']);
  await old.save();
});

await test('17l. the characters land after the page opened (boot\'s characters()): the chips follow, and a redraw while typing the purveyor keeps the typing', async () => {
  const rig = dtRig(); rig.pcs = [];
  const h = await dtPage(rig);
  h.press('d'); assert.deepEqual(h.qa('#gm-dt [data-gm="dt-who"]').map((b) => b.textContent), ['anyone']);
  rig.pcs = cl(PCS); h.page.characters();
  assert.deepEqual(h.qa('#gm-dt [data-gm="dt-who"]').map((b) => b.textContent), ['Mags Invented', 'Rook Invented', 'anyone'], 'the PCs appear');
  dtWho(h, 'c-mags');
  const pin = h.q('#gm-dt-purveyor'); pin.focus(); pin.value = 'Old Mo, half typ';
  rig.pcs.push({ id: 'c-wren', name: 'Wren Invented', vice: 'Faith', purveyor: '', contacts: [], clocks: [] }); h.page.characters();
  const pin2 = h.q('#gm-dt-purveyor');
  assert.ok(pin2 !== pin && pin2.value === 'Old Mo, half typ' && h.br.doc.activeElement === pin2, 'the field keeps its text and the cursor');
  assert.equal(h.qa('#gm-dt [data-gm="dt-who"]').length, 4);
  dtRoll(h, 'over'); assert.equal(dtStored(h).ui.purveyor, 'Old Mo, half typ', 'a tap rolls with what the field holds, change event or not');
  assert.equal(h.page._state().doc.dt.ui.purveyor, 'Old Mo, half typ', 'and keeps it in the panel');
  /* players tick their sheets all session: a snapshot that changes nothing the panel shows draws nothing, and an open list stays put */
  const vice = h.q('#gm-dt-vice'); h.page.characters();
  assert.equal(h.q('#gm-dt-vice'), vice, 'nothing the panel shows changed: no redraw');
  vice.focus(); rig.pcs[0].clocks.push({ name: 'Win the bet', size: 4, filled: 0 }); h.page.characters();
  assert.equal(h.q('#gm-dt-vice'), vice, 'not from under a select the GM has open');
  vice.blur(); h.page.characters();
  assert.notEqual(h.q('#gm-dt-vice'), vice, 'the next snapshot catches up');
  await h.save();
});

/* =====================================================================================================================
   Score sites (GM.md "Score sites"): a location roll saved against a score card of the prep part
   ===================================================================================================================== */
const PR = require(path.join(ROOT, 'app', 'gm', 'prep.js'));
const MDN = (() => { const box = { window: {} }; vm.createContext(box); vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', 'markdown.js'), 'utf8'), box); return box.window.B68Markdown; })();
const LC = L.controls({ T: FIXL.T, extra: FIXL.extra }).controls;
const optOf = (k, i) => LC.find((c) => c.key === k).options.filter((o) => o.value)[i].value;
const SITE_T = optOf('target', 0), SITE_D = optOf('district', 1);
const PREP_REL = 'Wiki/Games/Blades in the Dark/Campaigns/Group/Sessions/b68g-s10.md';
const prepPart = { prep: { version: 'p1', src: { exportedAt: new Date().toISOString() }, body: { v: 1, vault: 'Test Vault', links: {}, notes: [{ id: 'b68g-s10', rel: PREP_REL, title: 'Session 10', session: '10', date: '', status: 'prep', blocks: [
  { k: 'md', from: PREP_REL, src: '## Scores\n\n### F · The goose job', tasks: [] },
  { k: 'embed', from: 'Wiki/Games/Blades in the Dark/Campaigns/Group/Scores/b68g-score-goose.md', heading: '', score: { key: 'b68g-score-goose', label: 'F · The goose job', site: { target: SITE_T, district: SITE_D, faction: 'The Nobody Guild' } }, src: '**Steal the goose.**', tasks: [] },
  { k: 'md', from: PREP_REL, src: '### G · The plain job', tasks: [] },
  { k: 'embed', from: 'Wiki/Games/Blades in the Dark/Campaigns/Group/Scores/b68g-score-plain.md', heading: '', score: { key: 'b68g-score-plain', label: 'G · The plain job' }, src: 'Plain.', tasks: [] },
] }] } } };
const SITE_OVER = { B68GmPrep: PR, B68Markdown: MDN, B68Map: M };

await test('S1. score sites, pure: the card\'s hints to the Location pickers (unknown ones reported), the entry saved, the hint line', () => {
  const r = P.siteUi(LC, { target: SITE_T.toUpperCase(), district: 'the ' + SITE_D, faction: 'The Nobody Guild' });
  assert.deepEqual(r.ui, { target: SITE_T, district: SITE_D, faction: '', approach: '' }, 'matched without case or a leading "the"');
  assert.deepEqual(r.missed, [['faction', 'The Nobody Guild']]);
  assert.deepEqual(P.siteUi(LC, {}).ui, { target: '', district: '*', faction: '', approach: '' }, 'no district hint rolls on any, not on Now in');
  assert.deepEqual(P.siteUi(LC, { district: 'Atlantis' }), { ui: { target: '', district: '*', faction: '', approach: '' }, missed: [['district', 'Atlantis']] });
  const roll = L.generate({ T: FIXL.T, extra: FIXL.extra }, {}, { seed: 99, mem: {} });
  const e = P.siteEntry({ hid: 'h1', seed: 99, ui: { target: 'x' }, mem: '{"a":[1]}', label: 'L', at: 't' }, roll, 'F · Job', { view: 'iso', theme: 'board', layer: 'player' });
  assert.deepEqual(Object.keys(e), ['seed', 'ui', 'mem', 'name', 'district', 'label', 'map', 'at']);
  assert.deepEqual([e.seed, e.ui.target, e.mem, e.name, e.district, e.label, e.map.view, e.map.theme], [99, 'x', '{"a":[1]}', roll.name, roll.district, 'F · Job', 'iso', 'board']);
  assert.deepEqual(P.siteEntry({ seed: 1 }, roll, '', { view: 'nope', theme: 'nope' }).map, { view: 'iso', theme: 'rulebook' }, 'an unknown view or theme saves the defaults (iso since map kit 0.7 in the app)');
  assert.deepEqual(P.siteEntry({ seed: 1 }, roll, '', { view: 'street', theme: 'plate' }).map, { view: 'street', theme: 'plate' }, 'the street and the plate are saved as they are');
  assert.equal(P.siteEntry(null, roll), null); assert.equal(P.siteEntry({ seed: 'x' }, roll), null); assert.equal(P.siteEntry({ seed: 1 }, null), null);
  assert.equal(P.hintLine({ approach: 'Quiet', target: 'Bank', faction: 'F', district: 'D' }), 'Bank · D · F · Quiet');
  const sites = P.sitesIn({ sites: { a: { seed: 3 }, b: { seed: 4 }, c: null, d: { name: 'no seed' } } });
  assert.deepEqual(Object.keys(sites), ['a', 'b']); assert.deepEqual(P.siteKeysOf(sites, { seed: 4 }), ['b']); assert.deepEqual(P.siteKeysOf(sites, null), []);
});

await test('S2. score sites, page: Roll a site from a score card in Prep, save it, see it on the card, open it again after another roll, clear it', async () => {
  const h = await openPage({ fg: fakeGm(undefined, prepPart), over: SITE_OVER });
  h.press('r');
  const slot = () => h.q('.pp-site[data-score="b68g-score-goose"]');
  assert.ok(slot() && h.q('.pp-site[data-score="b68g-score-plain"]'), 'a slot in each score card');
  assert.match(slot().textContent, new RegExp('None yet · ' + SITE_T + ' · ' + SITE_D + ' · The Nobody Guild'));
  slot().querySelector('[data-gm="siteroll"]').click();
  assert.equal(h.page._state().panel, 'location');
  const d = stateDoc(h);
  assert.deepEqual([d.loc.ui.target, d.loc.ui.district, d.loc.ui.faction, d.loc.ui.approach], [SITE_T, SITE_D, '', '']);
  assert.equal(d.cards.location.ui.target, SITE_T, 'the roll used the card\'s hints'); assert.equal(d.cards.location.ui.district, SITE_D);
  assert.ok(h.br.toasts.some(([m, bad]) => bad && /rolled on any: faction “The Nobody Guild”/.test(m)), 'a hint the generator lacks is reported');
  const btn = h.q('[data-gm="sitesave"]');
  assert.equal(btn.textContent, 'Save as the site for F · The goose job'); assert.ok(!btn.hasAttribute('disabled'));
  btn.click();
  const s = stateDoc(h).sites['b68g-score-goose'];
  assert.equal(s.seed, stateDoc(h).cards.location.seed); assert.equal(s.name, h.page._state().locRoll.name); assert.equal(s.label, 'F · The goose job');
  assert.deepEqual({ ...s.map }, { view: 'iso', theme: 'rulebook' });       /* a copy: the page's objects come from the vm's realm; a roll draws iso */
  assert.equal(h.q('[data-gm="sitesave"]').textContent, 'Saved as its site'); assert.ok(h.q('[data-gm="sitesave"]').hasAttribute('disabled'));
  assert.match(h.q('#gm-siterow').textContent, /This roll is the site for F · The goose job/);
  h.press('r');
  assert.ok(slot().textContent.includes(s.name) && slot().querySelector('[data-gm="siteopen"]'), 'the card shows its site');
  h.press('b'); h.q('[data-gm="locroll"]').click();
  assert.notEqual(stateDoc(h).cards.location.seed, s.seed, 'another roll is on the card now');
  assert.ok(!/This roll is the site/.test(h.q('#gm-siterow').textContent));
  h.press('r'); slot().querySelector('[data-gm="siteopen"]').click();
  assert.equal(h.page._state().panel, 'location');
  assert.equal(stateDoc(h).cards.location.seed, s.seed); assert.equal(h.page._state().locRoll.name, s.name, 'the same place');
  assert.ok(h.page._state().map && h.page._state().map.layer === 'gm', 'drawn, on the GM layer');
  h.press('r'); slot().querySelector('[data-gm="siteclear"]').click();
  assert.ok(!(stateDoc(h).sites || {})['b68g-score-goose']); assert.match(slot().textContent, /None yet/);
  await h.save();
  assert.ok(!(h.fg.server.doc.sites || {})['b68g-score-goose'], 'cleared on the server too');
});

await test('S3. score sites, page: the row lists the scores; replacing a site asks; 24 at most; a site the tables no longer make says so; no scores, no row', async () => {
  const h0 = await openPage(); h0.press('b'); h0.q('[data-gm="locroll"]').click();
  assert.ok(!h0.q('#gm-siterow'), 'no prep part: no row'); await h0.save();

  const h = await openPage({ fg: fakeGm(undefined, prepPart), over: SITE_OVER });
  h.press('b'); h.q('[data-gm="locroll"]').click();
  const sel = () => h.q('#gm-site-pick');
  assert.deepEqual(sel().querySelectorAll('option').map((o) => o.getAttribute('value')), ['', 'b68g-score-goose', 'b68g-score-plain']);
  assert.ok(h.q('[data-gm="sitesave"]').hasAttribute('disabled'), 'no score chosen: nothing to save');
  const s1 = sel(); s1.value = 'b68g-score-plain'; dispatch(s1, 'change');
  h.q('[data-gm="sitesave"]').click();
  const first = stateDoc(h).sites['b68g-score-plain'].seed;
  h.q('[data-gm="locroll"]').click();
  assert.equal(h.q('[data-gm="sitesave"]').textContent, 'Save as the site for G · The plain job', 'the row still points at the score');
  let asked = ''; h.br.W.confirm = (m) => { asked = m; return false; };
  h.q('[data-gm="sitesave"]').click();
  assert.match(asked, /Replace the site saved for G · The plain job/); assert.equal(stateDoc(h).sites['b68g-score-plain'].seed, first, 'declined: kept');
  h.br.W.confirm = () => true; h.q('[data-gm="sitesave"]').click();
  assert.notEqual(stateDoc(h).sites['b68g-score-plain'].seed, first, 'replaced');
  assert.match(sel().querySelector('option[value="b68g-score-plain"]').textContent, /· this site$/);
  await h.save();

  const fg2 = fakeGm(undefined, prepPart);
  fg2.server.doc = { sites: Object.fromEntries(Array.from({ length: 24 }, (_, i) => ['k' + i, { seed: i + 1, name: 'N' + i }])) };
  const h2 = await openPage({ fg: fg2, over: SITE_OVER }); h2.press('b'); h2.q('[data-gm="locroll"]').click();
  const s2 = h2.q('#gm-site-pick'); s2.value = 'b68g-score-goose'; dispatch(s2, 'change'); h2.q('[data-gm="sitesave"]').click();
  assert.ok(!stateDoc(h2).sites['b68g-score-goose'] && h2.br.toasts.some(([m, bad]) => bad && /24 sites are saved already/.test(m)));
  await h2.save();

  const fg3 = fakeGm(undefined, prepPart);
  fg3.server.doc = { sites: { 'b68g-score-goose': { seed: 5, ui: {}, mem: '{}', name: 'Not This Place', district: 'X', label: 'F · The goose job', map: { view: 'plan', theme: 'blueprint' }, at: '2030-01-01T00:00:00Z' } } };
  const h3 = await openPage({ fg: fg3, over: SITE_OVER }); h3.press('r');
  h3.q('.pp-site[data-score="b68g-score-goose"] [data-gm="siteopen"]').click();
  assert.ok(h3.br.toasts.some(([m, bad]) => bad && /tables have changed since this site was saved/.test(m)));
  const mp = stateDoc(h3).loc.map; assert.deepEqual([mp.view, mp.theme, mp.layer], ['plan', 'blueprint', 'gm'], 'opened in the view and theme it was saved with, on the GM layer');
  await h3.save();
});

await test('S4. authored sites, page: the card\'s site: from the vault opens as the Location card, reveals band by band to the iPad, and a roll after it is a plain roll', async () => {
  const site = { name: 'The Goose House', rel: 'x', map: { view: 'iso' }, patch: { district: 'Nowhere Ward', rooms: [
    { name: 'The grand lobby', band: 'public', detail: 'Feathers.' }, { name: 'Kitchens', band: 'working', detail: 'Steam.' },
    { name: 'Private card rooms', band: 'controlled', detail: 'Cards.' }, { name: 'Luxury penthouse', band: 'secure', isTarget: true, detail: 'The goose.' }] } };
  const loc = { location: { version: 'l2', src: {}, body: { T: FIXL.T, extra: FIXL.extra, authored: { v: 1, sites: { 'The Goose House': site }, bind: { 'b68g-score-goose': 'The Goose House' } } } } };
  const fg = fakeGm(undefined, Object.assign({}, prepPart, loc));
  fg.server.doc = { sites: { 'b68g-score-goose': { seed: 5, ui: {}, mem: '{}', name: 'An Old Roll', district: 'X', label: 'F · The goose job', map: { view: 'rings', theme: 'rulebook' }, at: '2030-01-01T00:00:00Z' } } };
  const h = await openPage({ fg, over: SITE_OVER });
  h.press('r');
  const slot = () => h.q('.pp-site[data-score="b68g-score-goose"]');
  assert.match(slot().textContent, /The Goose House · authored · a saved roll too: An Old Roll/);
  assert.ok(slot().querySelector('[data-gm="siteauth"]') && slot().querySelector('[data-gm="siteopen"]') && slot().querySelector('[data-gm="siteclear"]'), 'Open map, and the saved roll stays reachable');
  assert.match(h.q('.pp-site[data-score="b68g-score-plain"]').textContent, /None yet/, 'an unbound card is as before');
  slot().querySelector('[data-gm="siteauth"]').click();
  assert.equal(h.page._state().panel, 'location');
  const card = stateDoc(h).cards.location;
  assert.equal(card.auth, 'The Goose House'); assert.equal(card.seed, undefined, 'an authored card has no seed of its own');
  assert.equal(h.page._state().locRoll.name, 'The Goose House');
  assert.deepEqual([...h.page._state().locRoll.rooms.map((r) => r.name)], site.patch.rooms.map((r) => r.name));
  assert.equal(stateDoc(h).loc.map.view, 'iso', 'the view its note asks for');
  assert.match(h.q('#gm-siterow').textContent, /Authored in the vault: The Goose House/);
  assert.ok(!h.q('[data-gm="sitesave"]'), 'nothing to save: the vault binds it');
  /* the reveal: Player layer, working ticked, Show on iPad sends a map that names the kitchens and not the card rooms */
  h.br.W.confirm = () => true;
  h.q('[data-gm="layer"][data-v="player"]').click();
  const w = h.q('[data-reveal="working"]'); w.checked = true; dispatch(w, 'change');
  h.q('[data-gm="ipad"]').click();
  const shown = await until(() => fg.server.displays.filter((d) => d.kind === 'svg').pop());
  assert.ok(shown, 'sent to the iPad');
  assert.match(shown.svg, /Kitchens/i); assert.ok(!/Private card rooms|Luxury penthouse/i.test(shown.svg), 'the controlled and secure rooms stay hidden');
  /* a render later (the replay check) does not reset the reveal: the card and its roll agree */
  h.press('r'); h.press('b');
  assert.equal(h.page._state().locRoll.name, 'The Goose House'); assert.equal(stateDoc(h).loc.map.reveal.working, true, 'still revealed');
  /* a plain roll after it: no auth survives the merge */
  h.q('[data-gm="locroll"]').click();
  const after = stateDoc(h).cards.location;
  assert.equal(after.auth, undefined, 'the authored card is replaced, not merged');
  assert.equal(typeof after.seed, 'number'); assert.notEqual(h.page._state().locRoll.name, 'The Goose House');
  await h.save();
  assert.equal((h.fg.server.doc.cards.location || {}).auth, undefined, 'and on the server');
});

/* =====================================================================================================================
   S5. Run the site (M2b): the strip above an authored site's map, its tokens, and the state in `ball`. INVENTED venue and cast.
   ===================================================================================================================== */
const BALL = require(path.join(ROOT, 'app', 'gm', 'ball.js'));
const rsleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN_ROOMS = [
  { name: 'Showroom', band: 'public', detail: 'Chairs.' }, { name: 'Cocktail lounge', band: 'public', detail: 'Glass.' },
  { name: 'Security control room', band: 'working', detail: 'Screens.' }, { name: 'Private card rooms', band: 'controlled', detail: 'Cards.' },
  { name: 'Underground counting room', band: 'working', detail: 'Coins.' }, { name: 'Luxury penthouse', band: 'secure', isTarget: true, detail: 'The strongbox.' }];
const RUN_PLAY = {
  v: 1, clock: { start: '21:00', end: '02:00', label: 'Gala night' }, floors: { '-1': 'Under', '0': 'Ground', '1': 'Upper', '2': 'Loft' },
  routes: [{ id: 'lift', from: 'Cocktail lounge', to: 'Luxury penthouse', via: 'the service lift', dir: 'up', needs: 'a key', watched: true }, { id: 'stairs', from: 'Showroom', to: 'Security control room', via: 'the back stairs' }],
  people: [
    { id: 'od', label: 'Odette Marsh', kind: 'target', stops: [{ at: '21:00', room: 'Showroom' }, { at: '23:30', room: 'Private card rooms', note: 'cards' }, { at: '00:15', room: 'Luxury penthouse', note: 'alone' }] },
    { id: 'wr', label: 'Wren Tully', kind: 'guard', with: 'od' },
    { id: 'pq', label: 'Pip Quill', kind: 'staff', stops: [{ at: '21:00', room: 'Cocktail lounge' }, { at: '00:00', room: 'Underground counting room' }] },
    { id: 'iv', label: 'Ivo Stark', kind: 'rival', stops: [{ at: '21:00', room: 'Security control room' }]}],
  disguises: [{ id: 'cook', label: 'Cook', floors: [-1], sees: 'Ivo Stark' }],
  events: [{ at: '22:00', id: 'sp', label: 'Speeches' }, { at: '00:00', id: 'fw', label: 'Fireworks', room: 'Showroom', fx: 'dawn' }],
  clocks: [{ name: 'Fuse', room: 'Security control room' }],
};
const RUN_SITE = (play) => ({ name: 'The Pelican Rooms', rel: 'x', map: { view: 'iso' }, patch: { district: 'Nowhere Ward', rooms: RUN_ROOMS }, ...(play ? { play } : {}) });
const runPack = (site) => ({ location: { version: 'l2', src: {}, body: { T: FIXL.T, extra: FIXL.extra, authored: { v: 1, sites: { 'The Pelican Rooms': site }, bind: { 'b68g-score-goose': 'The Pelican Rooms' } } } } });
/* the map kit with a spy on render: every call's options, in order */
function spyKit() { const calls = []; const K = Object.create(M); K.render = (roll, o) => { calls.push(JSON.parse(JSON.stringify(o))); return M.render(roll, o); }; return { K, calls }; }
const RUN_PCS = [{ id: 'pc1', name: 'Cass Fenn' }, { id: 'pc2', name: 'Dov Ketch' }];
const RUN_CAMP = { session: { number: 3 }, crew: {}, clocks: [{ id: 'c1', name: 'Fuse', size: 6, filled: 2, kind: 'danger' }] };
async function openRun({ fg, site, spy, camp } = {}) {
  const { K, calls } = spy || spyKit(), g = fg || fakeGm(undefined, Object.assign({}, prepPart, runPack(site || RUN_SITE(RUN_PLAY))));
  const h = await openPage({ fg: g, camp: camp || RUN_CAMP, over: { B68GmPrep: PR, B68Markdown: MDN, B68Map: K, B68GmBall: BALL }, api: { characters: () => RUN_PCS } });
  h.press('r'); h.q('.pp-site[data-score="b68g-score-goose"] [data-gm="siteauth"]').click();
  h.calls = calls; h.fg = g; return h;
}
const selectedOf = (sel) => { const o = sel.querySelectorAll('option').find((x) => x.hasAttribute('selected')); return o ? o.getAttribute('value') : ''; };
const clockText = (h) => h.q('#gm-run-clock').textContent;
const lastTokens = (h) => (h.calls[h.calls.length - 1] || {}).tokens;

await test('S5a. a token is the escaped svg the kit nests: initials, a red ring only on danger, the lens letter, a pie per clock', () => {
  const s = P.runTokenSvg({ pills: [{ t: '<b>', c: '"x' }, { t: 'AB', c: '#111111' }], pies: [{ f: 2, s: 6 }, { f: 6, s: 6 }, { f: 0, s: 4 }], lens: 'desperate', danger: true });
  assert.ok(/^<svg [^>]*viewBox="0 0 540 600"/.test(s) && s.endsWith('</svg>'));
  assert.ok(!s.includes('<b>') && s.includes('&lt;b&gt;') && !s.includes('"x"'), 'text and colours are escaped');
  assert.ok(s.includes('stroke="#d11"') && s.includes('>D<'));
  assert.ok(!P.runTokenSvg({ pills: [{ t: 'AB', c: '#111111' }], lens: 'risky' }).includes('#d11'), 'no ring without danger');
  assert.equal(P.runInitials('Odette Marsh'), 'OM'); assert.equal(P.runInitials('  wren '), 'W'); assert.equal(P.runInitials(''), '?');
  checkSvg(P.runTokenSvg({ pills: [{ t: 'AB', c: '#111111' }] }));
});

await test('S5b. the strip: floor tabs in number order, the time, the lens, the crew; one token per room; a rolled site and a site with no play have none', async () => {
  assert.deepEqual(BALL.checkPlay(RUN_PLAY, RUN_ROOMS.map((r) => r.name)).warnings, [], 'the fixture play is clean');
  const h = await openRun();
  assert.ok(h.q('#gm-run'), 'an authored site with a play block has the strip');
  const floors = M.floors(h.page._state().locRoll).map((f) => f.lvl).sort((a, b) => a - b);
  assert.deepEqual(floors, [-1, 0, 1, 2]);
  assert.deepEqual(h.qa('#gm-run-tabs button').map((b) => b.textContent), ['All', 'Under', 'Ground', 'Upper', 'Loft']);
  assert.deepEqual(h.qa('#gm-run-tabs button').map((b) => b.getAttribute('data-v')), ['all', '-1', '0', '1', '2']);
  assert.equal(clockText(h), '21:00'); assert.equal(h.q('#gm-run-t').getAttribute('max'), '300');
  assert.equal(h.qa('#gm-run .gm-run-dot').length, 3, 'a dot for each of the target\'s windows'); assert.equal(h.qa('#gm-run .gm-run-tick').length, 2, 'a tick for each event');
  assert.ok(h.q('#gm-run .gm-run-tick.fx'), 'the dawn is marked');
  assert.deepEqual(h.qa('#gm-run-lens option').map((o) => o.textContent), ['No disguise', 'Cook']);
  assert.deepEqual(h.qa('#gm-run-place [data-gm="run-pc"]').map((b) => b.textContent), ['Cass Fenn', 'Dov Ketch']);
  assert.ok(h.q('#gm-map svg'), 'a run draws itself, with no Draw press');
  /* 21:00: Odette and Wren in the showroom, Pip in the lounge, Ivo in the control room: three rooms, three tokens, never two in one room */
  const tk = lastTokens(h);
  assert.deepEqual(tk.map((t) => t.room).sort(), ['Cocktail lounge', 'Security control room', 'Showroom']);
  assert.equal(new Set(tk.map((t) => t.room)).size, tk.length, 'one token per room');
  assert.ok(tk.find((t) => t.room === 'Showroom').svg.includes('>OM<') && tk.find((t) => t.room === 'Showroom').svg.includes('>WT<'), 'both people in the one token');
  assert.ok(tk.every((t) => !t.svg.includes('#d11')), 'no disguise, no ring');
  assert.match(h.q('#gm-run-side').textContent, /At 21:00/); assert.match(h.q('#gm-run-side').textContent, /Odette Marsh.*Showroom/);
  assert.match(h.q('#gm-run-side').textContent, /22:00 Speeches/); assert.match(h.q('#gm-run-side').textContent, /Cocktail lounge ↑ Luxury penthouse/);
  assert.match(h.q('#gm-run-side').textContent, /Showroom ↕ Security control room/);
  assert.equal(stateDoc(h).ball, undefined, 'nothing is written by looking');
  /* a plain roll after it has no strip */
  h.q('[data-gm="locroll"]').click();
  assert.ok(!h.q('#gm-run') && !h.q('#gm-run-side'), 'a rolled site has no strip');
  await h.save();
  /* an authored site with no play block */
  const h2 = await openRun({ site: RUN_SITE(null) });
  assert.ok(!h2.q('#gm-run') && h2.q('#gm-map'), 'no play block, no strip');
  await h2.save();
});

await test('S5c. scrub across midnight, floors, the disguise and its danger ring, a PC, a pinned clock; every change is saved; a reload shows the same', async () => {
  const fg = fakeGm(undefined, Object.assign({}, prepPart, runPack(RUN_SITE(RUN_PLAY))));
  const h = await openRun({ fg });
  const strip = h.q('#gm-run');
  /* Next window: 23:30 (150 minutes in), saved at once */
  h.q('[data-gm="run-next"]').click();
  assert.equal(clockText(h), '23:30'); assert.equal(stateDoc(h).ball.t, 150); assert.equal(stateDoc(h).ball.site, 'The Pelican Rooms');
  assert.match(h.q('#gm-run-side').textContent, /Odette Marsh.*Private card rooms/);
  /* the slider across midnight: 00:15 is 195 minutes in; the clock and the side follow at once, the state and the map 200 ms after */
  const callsBefore = h.calls.length, slider = h.q('#gm-run-t');
  slider.value = '190'; dispatch(slider, 'input'); slider.value = '195'; dispatch(slider, 'input');
  assert.equal(clockText(h), '00:15', 'the clock is the evening\'s, across midnight'); assert.match(h.q('#gm-run-side').textContent, /Odette Marsh.*Luxury penthouse/);
  assert.equal(stateDoc(h).ball.t, 150, 'not saved while it moves'); assert.equal(h.calls.length, callsBefore, 'nor drawn');
  await rsleep(320);
  assert.equal(stateDoc(h).ball.t, 195); assert.ok(h.calls.length - callsBefore <= 1, 'one render for the whole scrub');
  assert.ok(lastTokens(h).some((t) => t.room === 'Luxury penthouse'), 'Odette is in the penthouse on the map');
  /* Left and Right: 5 minutes, only with the focus in the strip */
  h.press('ArrowRight', { target: strip }); assert.equal(clockText(h), '00:20'); assert.equal(stateDoc(h).ball.t, 200);
  h.press('ArrowLeft', { target: strip }); h.press('ArrowLeft', { target: strip }); assert.equal(clockText(h), '00:10');
  h.press('ArrowRight', { target: h.q('#gm-run-lens') }); assert.equal(clockText(h), '00:10', 'the Disguise select keeps its own arrows');
  h.press('ArrowRight', { target: h.br.doc.body }); assert.equal(clockText(h), '00:10', 'outside the strip they do nothing');
  /* the end of the night holds; the beginning too */
  slider.value = '300'; dispatch(slider, 'input'); dispatch(slider, 'change'); h.press('ArrowRight', { target: strip }); assert.equal(clockText(h), '02:00'); assert.equal(stateDoc(h).ball.t, 300);
  h.q('[data-gm="run-next"]'); h.q('[data-gm="run-next"]').click(); assert.ok(h.br.toasts.some(([m]) => /No more windows/.test(m)), 'no window after the last');
  slider.value = '195'; dispatch(slider, 'input'); dispatch(slider, 'change'); assert.equal(stateDoc(h).ball.t, 195);
  /* floors: the Loft tab keeps the penthouse and drops the rest; the kit is told the floor */
  const top = h.qa('#gm-run-tabs button').find((b) => b.getAttribute('data-v') === '2'); top.click();
  assert.equal(stateDoc(h).ball.floor, 2); await rsleep(0);
  assert.equal(h.calls[h.calls.length - 1].floor, 2); assert.deepEqual(lastTokens(h).map((t) => t.room), ['Luxury penthouse']);
  assert.deepEqual(h.qa('#gm-run-rooms [data-gm="run-room"]').map((b) => b.getAttribute('data-room')), ['Luxury penthouse'], 'the room list follows the floor');
  assert.equal(h.qa('#gm-run-tabs button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent).join(), 'Loft');
  const topSvg = h.page._state().map.svg; h.qa('#gm-run-tabs button')[0].click(); assert.equal(stateDoc(h).ball.floor, 'all'); assert.notEqual(h.page._state().map.svg, topSvg, 'All draws every floor again (from the cache: the same people, the same map)');
  /* the disguise: Cook lives in the cellar. The control room (two floors up) is desperate, and Ivo, whom a cook sees through, is in it */
  const lens = h.q('#gm-run-lens'); lens.value = 'cook'; dispatch(lens, 'change');
  assert.equal(stateDoc(h).ball.lens, 'cook');
  const rooms = Object.fromEntries(h.qa('#gm-run-rooms [data-gm="run-room"]').map((b) => [b.getAttribute('data-room'), b]));
  assert.ok(rooms['Underground counting room'].className.includes('pos-controlled') && rooms['Security control room'].className.includes('pos-desperate') && rooms['Security control room'].className.includes('danger'));
  assert.ok(rooms['Showroom'].className.includes('pos-risky'), 'one floor off the cellar');
  const ring = lastTokens(h).filter((t) => t.svg.includes('stroke="#d11"')).map((t) => t.room);
  assert.deepEqual(ring, ['Security control room'], 'the red ring only where the one the disguise sees through stands');
  assert.ok(lastTokens(h).find((t) => t.room === 'Security control room').svg.includes('>D<'), 'the lens chip');
  /* the crew: tap a PC chip, then a room; one token still; moving them leaves no old key; tapping the same room takes them off */
  h.qa('#gm-run-place [data-gm="run-pc"]')[0].click();
  assert.match(h.q('#gm-run-place').textContent, /Tap a room/);
  h.qa('#gm-run-rooms [data-gm="run-room"]').find((b) => b.getAttribute('data-room') === 'Luxury penthouse').click();
  assert.deepEqual(cl(stateDoc(h).ball.crew), { pc1: 'Luxury penthouse' });
  let pen = lastTokens(h).filter((t) => t.room === 'Luxury penthouse'); assert.equal(pen.length, 1); assert.ok(pen[0].svg.includes('>CF<') && pen[0].svg.includes('>OM<'), 'the crew and Odette share the one token');
  h.qa('#gm-run-place [data-gm="run-pc"]')[0].click(); h.qa('#gm-run-rooms [data-gm="run-room"]').find((b) => b.getAttribute('data-room') === 'Showroom').click();
  assert.deepEqual(cl(stateDoc(h).ball.crew), { pc1: 'Showroom' });
  h.qa('#gm-run-place [data-gm="run-pc"]')[1].click(); h.qa('#gm-run-rooms [data-gm="run-room"]').find((b) => b.getAttribute('data-room') === 'Showroom').click();
  assert.deepEqual(cl(stateDoc(h).ball.crew), { pc1: 'Showroom', pc2: 'Showroom' });
  h.qa('#gm-run-place [data-gm="run-pc"]')[1].click(); h.qa('#gm-run-rooms [data-gm="run-room"]').find((b) => b.getAttribute('data-room') === 'Showroom').click();
  assert.deepEqual(cl(stateDoc(h).ball.crew), { pc1: 'Showroom' }, 'tapping their room takes them off');
  /* a table clock pinned to a room draws its pie */
  h.q('#gm-run-place [data-gm="run-clock"]').click(); assert.match(h.q('#gm-run-place').textContent, /Pin to room/);
  h.qa('#gm-run-rooms [data-gm="run-room"]').find((b) => b.getAttribute('data-room') === 'Cocktail lounge').click();
  assert.deepEqual(cl(stateDoc(h).ball.pins), { c1: 'Cocktail lounge' });
  const lounge = lastTokens(h).find((t) => t.room === 'Cocktail lounge'); assert.ok(lounge && /<path d="M100 480/.test(lounge.svg), 'a pie for the clock, 2 of 6');
  /* the player layer (M3): no floor, no lens ring, no person; only the crew's marker (Showroom) and the visible clock's pie (lounge), both in public rooms */
  h.q('[data-gm="layer"][data-v="player"]').click();
  const pl = h.calls[h.calls.length - 1];
  assert.equal(pl.layer, 'player'); assert.equal(pl.floor, undefined);
  assert.deepEqual(pl.tokens.map((t) => [t.room, t.label]), [['Cocktail lounge', ''], ['Showroom', 'Cass Fenn']], 'the player copy carries the crew and the visible pinned clock, nothing else');
  assert.ok(pl.tokens.every((t) => !t.svg.includes('#d11') && !t.svg.includes('>OM<') && !t.svg.includes('>WT<') && !t.svg.includes('>PQ<') && !t.svg.includes('>IS<')), 'no person, no lens ring');
  assert.match(h.q('#gm-run-note').textContent, /GM layer/); assert.equal((h.page._state().map.svg.match(/#fffdf6/g) || []).length, 2, 'two tokens on the player layer map');
  h.q('[data-gm="layer"][data-v="gm"]').click();
  assert.ok(h.page._state().map.svg.includes('#fffdf6'), 'and the GM layer has them again');
  const svgBefore = h.page._state().map.svg;
  await h.save();
  const saved = fg.server.doc.ball;
  assert.deepEqual(saved, { site: 'The Pelican Rooms', t: 195, floor: 'all', lens: 'cook', crew: { pc1: 'Showroom' }, pins: { c1: 'Cocktail lounge' } }, 'the server holds exactly the state');
  /* a reload on the same server: the same strip, the same tokens */
  const spy2 = spyKit();
  const r = await openRun({ fg, spy: spy2 });
  assert.equal(clockText(r), '00:15'); assert.equal(r.q('#gm-run-t').value, '195'); assert.equal(selectedOf(r.q('#gm-run-lens')), 'cook');
  assert.equal(r.qa('#gm-run-tabs button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent).join(), 'All');
  assert.match(r.qa('#gm-run-place [data-gm="run-pc"]')[0].textContent, /Showroom/); assert.match(r.q('#gm-run-place [data-gm="run-clock"]').textContent, /Cocktail lounge/);
  const ids = (s) => String(s).replace(/b68md+-/g, 'b68m-');
  assert.equal(ids(r.page._state().map.svg), ids(svgBefore), 'the same people on the same map');
  await r.save();
});

await test('S5d. another site\'s ball is not this one\'s: its crew does not show, and the first write replaces it whole', async () => {
  const fg = fakeGm(undefined, Object.assign({}, prepPart, runPack(RUN_SITE(RUN_PLAY))));
  fg.server.doc = { ball: { site: 'Some Other Place', t: 200, floor: 1, lens: 'cook', crew: { pc1: 'Showroom' }, pins: { c1: 'Showroom' } } };
  const h = await openRun({ fg });
  assert.equal(clockText(h), '21:00'); assert.equal(selectedOf(h.q('#gm-run-lens')), ''); assert.ok(lastTokens(h).every((t) => !t.svg.includes('>CF<')));
  h.q('[data-gm="run-step"][data-d="15"]').click();
  assert.deepEqual(cl(stateDoc(h).ball), { site: 'The Pelican Rooms', t: 15 }, 'nothing of the other site is left');
  await h.save();
  assert.deepEqual(fg.server.doc.ball, { site: 'The Pelican Rooms', t: 15 }, 'and on the server');
});

await test('S5f. the table moves under the run: a pinned clock ticks and a new PC is filed; the strip and the map follow (and the focus survives a tap)', async () => {
  const h = await openRun();
  h.q('#gm-run-place [data-gm="run-clock"]').click();
  h.qa('#gm-run-rooms [data-gm="run-room"]').find((b) => b.getAttribute('data-room') === 'Cocktail lounge').click();
  const chip = () => h.q('#gm-run-place [data-gm="run-clock"]').textContent;
  assert.match(chip(), /Fuse 2\/6/);
  const svg0 = h.page._state().map.svg;
  h.cd.current.clocks[0].filled = 4; h.page.campaign(h.cd.current);
  await rsleep(320);
  assert.match(chip(), /Fuse 4\/6/, 'the chip reads the table');
  assert.notEqual(h.page._state().map.svg, svg0, 'and the pie on the map moved');
  assert.equal(h.qa('#gm-run-place [data-gm="run-pc"]').length, 2);
  RUN_PCS.push({ id: 'pc3', name: 'Eli Vance' });
  try { h.page.characters(); } finally { RUN_PCS.pop(); }
  assert.deepEqual(h.qa('#gm-run-place [data-gm="run-pc"]').map((b) => b.textContent), ['Cass Fenn', 'Dov Ketch', 'Eli Vance'], 'a newly filed PC is a chip at once');
  /* a tap rebuilds the chips: the focus goes to the same control, so Left and Right keep working */
  const pc = h.qa('#gm-run-place [data-gm="run-pc"]')[0]; pc.focus(); pc.click();
  assert.equal(h.br.doc.activeElement.getAttribute('data-id'), 'pc1', 'the focus is on the rebuilt chip');
  h.press('ArrowRight', { target: h.br.doc.activeElement }); assert.equal(clockText(h), '21:05', 'Left and Right still move the time');
  await h.save();
});

/* ---- M3: the run's crew and pinned clocks on the player copy ---- */
const M3_BALL = { site: 'The Pelican Rooms', t: 0, crew: { pc1: 'Showroom', pc2: 'Luxury penthouse' }, pins: { c1: 'Cocktail lounge', c2: 'Showroom' } };
const M3_CAMP = () => ({ session: { number: 3 }, crew: {}, clocks: [{ id: 'c1', name: 'Fuse', size: 6, filled: 2, kind: 'danger' }, { id: 'c2', name: 'Vault alarm', size: 4, filled: 1, kind: 'danger', hidden: true }] });
const tokN = (svg) => (String(svg).match(/#fffdf6/g) || []).length;
const plainIds = (s) => String(s).replace(/b68m\d+-/g, 'b68m-');
/* a page on the invented site with a display that keeps ifSeq (the server's seq rule), a ball already on the server, and the player layer up */
async function m3Open({ ball, camp, pcs } = {}) {
  const fg = addAmbient(fakeGm(undefined, Object.assign({}, prepPart, runPack(RUN_SITE(RUN_PLAY)))));
  const sent = []; fg.server.sent = sent;
  const set0 = fg.gm.setDisplay;
  fg.gm.setDisplay = async (d) => { sent.push({ ifSeq: d.ifSeq, seqBefore: fg.server.dseq, caption: d.caption, svg: d.svg }); return set0(d); };
  if (ball !== undefined) fg.server.doc = { ball };
  const spy = spyKit();
  const h = await openRun({ fg, spy, camp: camp || M3_CAMP() });
  h.br.W.confirm = () => true;
  h.q('[data-gm="layer"][data-v="player"]').click();
  h.sent = sent; h.spy = spy;
  return h;
}
const lastPlayerCall = (h) => { const c = h.spy.calls.filter((o) => o.layer === 'player'); return c[c.length - 1]; };
const ipadSvgs = (h) => h.fg.server.displays.filter((d) => d.kind === 'svg');
const room = (h, name) => h.qa('#gm-run-rooms [data-gm="run-room"]').find((b) => b.getAttribute('data-room') === name);

await test('S5e. SECRECY: of the run only the crew and the clocks the players can see reach the iPad, in shown rooms: no ball, no people, no disguise, no event, no hidden clock, no marker in a hidden room', async () => {
  const h = await m3Open({ ball: M3_BALL });
  h.q('[data-gm="run-next"]').click();
  const lens = h.q('#gm-run-lens'); lens.value = 'cook'; dispatch(lens, 'change');
  const w = h.q('[data-reveal="working"]'); w.checked = true; dispatch(w, 'change');
  h.q('[data-gm="ipad"]').click();
  const shown = await until(() => ipadSvgs(h).pop());
  assert.ok(shown, 'a map went to the iPad');
  const all = JSON.stringify(h.fg.server.displays);
  /* the positive controls: Cass is in the showroom (public), the visible Fuse is pinned in the lounge (public): two tokens, her name once, her pill, the pie */
  assert.equal(tokN(shown.svg), 2, 'two tokens: the crew marker and the visible clock\'s pie');
  assert.match(shown.svg, /CASS FENN/, 'her name is the label (the kit draws it in capitals)'); assert.ok(shown.svg.includes('>CF<'), 'her initials');
  const call = lastPlayerCall(h);
  assert.deepEqual(call.tokens.map((t) => [t.room, t.label]), [['Cocktail lounge', ''], ['Showroom', 'Cass Fenn']]);
  assert.ok(/<path d="M100 480/.test(call.tokens[0].svg) && !call.tokens[0].svg.includes('<text'), 'the lounge token is the pie, with no words');
  assert.ok(!call.tokens[1].svg.includes('<circle') && !call.tokens[1].svg.includes('<path'), 'the hidden clock pinned in the showroom is not drawn there');
  /* the negatives */
  for (const word of ['"ball"', 'Odette', 'Wren', 'Pip Quill', 'Ivo', 'Cook', 'Speeches', 'Fireworks', 'Gala night', '#d11', 'Vault alarm', 'Fuse', '>OM<', '>WT<', '>PQ<', '>IS<', 'Dov', '>DK<']) assert.ok(!all.includes(word), 'the iPad payload carries ' + word);
  assert.ok(!/dov ketch|vault alarm|odette|ivo stark/i.test(all), 'no hidden name in any case');
  assert.ok(!/ball/.test(Object.keys(shown).join()), 'no ball key on the payload');
  assert.match(shown.svg, /Showroom/, 'the map itself is the player layer');
  checkSvg(shown.svg);
  /* Dov stands in the penthouse (secure): revealing the band is what puts him on the map */
  await tick();
  const sc = h.q('[data-reveal="secure"]'); sc.checked = true; dispatch(sc, 'change');
  await until(() => ipadSvgs(h).length === 2);
  const last = ipadSvgs(h)[1];
  assert.equal(tokN(last.svg), 3, 'the secure band is open: the penthouse marker joins'); assert.match(last.svg, /DOV KETCH/);
  await h.save();
});

await test('S5g. byte-identical to today\'s when nothing is left to show: empty ball, crew only in hidden rooms, only hidden clocks, another site\'s ball', async () => {
  const bare = await m3Open();
  bare.q('[data-gm="ipad"]').click(); await until(() => ipadSvgs(bare).length === 1);
  const base = ipadSvgs(bare)[0].svg, baseCalls = bare.spy.calls.filter((o) => o.layer === 'player');
  assert.ok(baseCalls.length >= 1 && baseCalls.every((o) => !('tokens' in o)), 'no tokens key on any player render');
  assert.equal(tokN(base), 0);
  const empties = [
    ['crew only in rooms the players cannot see', { site: 'The Pelican Rooms', t: 0, crew: { pc1: 'Luxury penthouse', pc2: 'Private card rooms' } }],
    ['only a hidden clock', { site: 'The Pelican Rooms', t: 0, pins: { c2: 'Showroom' } }],
    ['a crew id the table does not have', { site: 'The Pelican Rooms', t: 0, crew: { nobody: 'Showroom' } }],
    ['another site\'s ball (S5d, player side)', { site: 'Some Other Place', t: 0, crew: { pc1: 'Showroom' }, pins: { c1: 'Showroom' } }],
  ];
  for (const [what, ball] of empties) {
    const h = await m3Open({ ball });
    h.q('[data-gm="ipad"]').click(); await until(() => ipadSvgs(h).length === 1);
    const svg = ipadSvgs(h)[0].svg, calls = h.spy.calls.filter((o) => o.layer === 'player');
    assert.equal(plainIds(svg), plainIds(base), what + ': the same bytes as a run with no ball'); assert.ok(calls.every((o) => !('tokens' in o)), what + ': no tokens key');
    assert.equal(calls.length, baseCalls.length, what + ': the same number of renders');
    assert.ok(!/CASS FENN|DOV/i.test(svg), what);
    await h.save();
  }
  /* the control: the same page with Cass in the showroom has her */
  const on = await m3Open({ ball: { site: 'The Pelican Rooms', t: 0, crew: { pc1: 'Showroom' } } });
  on.q('[data-gm="ipad"]').click(); await until(() => ipadSvgs(on).length === 1);
  assert.equal(tokN(ipadSvgs(on)[0].svg), 1); assert.match(ipadSvgs(on)[0].svg, /CASS FENN/);
  await on.save(); await bare.save();
});

await test('S5h. live: a marker moved, a pin moved, a clock ticked or hidden, a name changed, or the ball changed on another device re-sends with ifSeq; a time scrub or a hidden pin sends nothing', async () => {
  const h = await m3Open({ ball: { site: 'The Pelican Rooms', t: 0, crew: { pc1: 'Showroom' } } });
  const cache0 = h.page._state().runCacheN;
  h.q('[data-gm="ipad"]').click(); await until(() => h.sent.length === 1); await until(() => h.q('.gm-reveal .gm-live'));
  assert.equal(h.sent[0].ifSeq, undefined, 'Show on iPad has no ifSeq'); const shown = (i) => ipadSvgs(h)[i].svg;
  const seq1 = h.fg.server.dseq;
  /* a marker moved: Cass to the lounge */
  h.qa('#gm-run-place [data-gm="run-pc"]')[0].click(); room(h, 'Cocktail lounge').click();
  await until(() => h.sent.length === 2);
  assert.equal(h.sent[1].ifSeq, seq1, 'with the seq the last push answered'); assert.deepEqual(lastPlayerCall(h).tokens.map((t) => [t.room, t.label]), [['Cocktail lounge', 'Cass Fenn']]);
  assert.match(shown(1), /CASS FENN/); assert.equal(tokN(shown(1)), 1);
  /* the time moves: the markers do not, so nothing goes */
  h.q('[data-gm="run-step"][data-d="15"]').click(); h.q('[data-gm="run-next"]').click(); await rsleep(300);
  assert.equal(h.sent.length, 2, 'a time scrub sends nothing');
  /* a hidden clock pinned: the players see nothing of it, so nothing goes */
  h.qa('#gm-run-place [data-gm="run-clock"]').find((b) => b.getAttribute('data-id') === 'c2').click(); room(h, 'Showroom').click();
  await rsleep(300); assert.equal(stateDoc(h).ball.pins.c2, 'Showroom', 'it is pinned'); assert.equal(h.sent.length, 2, 'a hidden clock pinned sends nothing');
  /* the visible clock pinned, ticked, then hidden */
  h.qa('#gm-run-place [data-gm="run-clock"]').find((b) => b.getAttribute('data-id') === 'c1').click(); room(h, 'Showroom').click();
  await until(() => h.sent.length === 3); assert.equal(tokN(shown(2)), 2, 'the pie joins'); assert.equal(h.sent[2].ifSeq, h.sent[1].seqBefore + 1);
  const cd = h.cd.current; cd.clocks[0].filled = 5; h.page.campaign(cd);
  await until(() => h.sent.length === 4); assert.notEqual(shown(3), shown(2), 'the pie moved'); assert.equal(h.sent[3].ifSeq, h.sent[2].seqBefore + 1);
  h.page.campaign(cd); h.page.campaign(cd); await rsleep(300); assert.equal(h.sent.length, 4, 'a poll with nothing new sends nothing');
  cd.clocks[0].hidden = true; h.page.campaign(cd);
  await until(() => h.sent.length === 5); assert.equal(tokN(shown(4)), 1, 'hidden: the pie is gone, the marker stays');
  /* the filed character is renamed */
  RUN_PCS[0].name = 'Cass Fenn-Ryder';
  try { h.page.characters(); await until(() => h.sent.length === 6); } finally { RUN_PCS[0].name = 'Cass Fenn'; }
  assert.match(shown(5), /CASS FENN-RYDER/);
  /* the ball changed on another device (the page takes it when the tab comes back) */
  await rsleep(900);                  /* the page's own changes have reached the server (the saver's debounce) */
  h.fg.server.doc = Object.assign({}, h.fg.server.doc, { ball: { site: 'The Pelican Rooms', t: 0, crew: { pc2: 'Showroom' } } }); h.fg.server.at += 5;
  for (const fn of h.br.doc.listeners.visibilitychange || []) fn();
  await until(() => h.sent.length === 7, 400);
  assert.equal(h.sent.length, 7, 'a ball that arrives from the server re-sends'); assert.match(shown(6), /DOV KETCH/); assert.ok(!/CASS FENN/.test(shown(6)));
  /* all of it went through the live queue: every re-send carries ifSeq, and none touched the GM layer's cache */
  assert.ok(h.sent.slice(1).every((s) => typeof s.ifSeq === 'number'), 'every re-send carries ifSeq');
  assert.equal(h.page._state().runCacheN, cache0, 'the player copy never touched the GM layer drawn-map cache');
  await h.save();
});

await test('S5i. a refused set of markers goes without them, says so once, and does not ask again on every poll; a 409 ends live as it does for bands', async () => {
  const camp = M3_CAMP(); camp.clocks.push({ id: 'c3', name: 'Cass Fenn', size: 4, filled: 0, kind: 'danger', hidden: true });
  const h = await m3Open({ ball: { site: 'The Pelican Rooms', t: 0, crew: { pc1: 'Showroom', pc2: 'Cocktail lounge' } }, camp });
  h.q('[data-gm="ipad"]').click(); await until(() => h.sent.length === 1);
  /* the hidden clock is called like a PC: that marker would name it, so none go (fail closed), and the GM is told */
  assert.equal(tokN(h.sent[0].svg), 0); assert.ok(!/CASS FENN|DOV KETCH/.test(h.sent[0].svg));
  await rsleep(300);
  const told = () => h.br.toasts.filter(([m, bad]) => bad && m === P.TOKEN_LEAK_MSG).length;
  assert.equal(told(), 1, 'the GM is told, once');
  assert.match(h.q('#gm-map').innerHTML + h.q('#gm-mapwarn').textContent, /crew markers/, 'and the preview says so');
  for (let i = 0; i < 4; i++) h.page.campaign(h.cd.current);
  await rsleep(300); assert.equal(h.sent.length, 1, 'polls do not re-send the refused set'); assert.equal(told(), 1, 'nor tell again');
  /* the control: the clock is renamed and the same markers go */
  h.cd.current.clocks[2].name = 'Alarm bell'; h.page.campaign(h.cd.current);
  await until(() => h.sent.length === 2); assert.equal(tokN(h.sent[1].svg), 2); assert.match(h.sent[1].svg, /CASS FENN/); assert.equal(told(), 1);
  /* something else takes the iPad: the next change is a 409 and live reveal stops */
  h.fg.server.otherDevice({ kind: 'svg', title: 'x', caption: 'from the other laptop', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>x</title></svg>' });
  h.qa('#gm-run-place [data-gm="run-pc"]')[0].click(); room(h, 'Cocktail lounge').click();
  await until(() => h.fg.server.conflicts === 1); await rsleep(50);
  assert.equal(h.fg.server.shown.caption, 'from the other laptop'); assert.ok(!h.q('.gm-reveal .gm-live'), 'live reveal ended');
  assert.ok(h.br.toasts.some(([m, bad]) => bad && /something else is on the iPad/i.test(m)));
  await h.save();
});

await test('S5j. the preview on the player layer shows what the iPad would carry, from the same gate, and never the GM cache; the GM layer is unchanged', async () => {
  const h = await m3Open({ ball: M3_BALL });
  assert.equal(tokN(h.page._state().map.svg), 2, 'the player preview has the crew marker and the visible pie');
  assert.ok(lastPlayerCall(h).tokens.every((t) => !t.svg.includes('#d11')));
  h.q('[data-gm="layer"][data-v="gm"]').click();
  const gmSvg = h.page._state().map.svg;          /* the GM layer, from its own cache */
  assert.equal(h.page._state().map.layer, 'gm'); assert.ok(tokN(gmSvg) >= 3 && gmSvg.includes('>OM<'), 'the GM layer has the people too');
  h.q('[data-gm="layer"][data-v="player"]').click();
  assert.ok(!lastPlayerCall(h).tokens.some((t) => /OM<|WT<|PQ<|IS<|#d11/.test(t.svg)), 'back on the player layer: no person');
  const n2 = h.page._state().runCacheN; h.q('[data-gm="layer"][data-v="player"]').click(); h.q('[data-gm="layer"][data-v="player"]').click();
  assert.equal(h.page._state().runCacheN, n2, 'player draws add nothing to the GM cache');
  await h.save();
});

/* =====================================================================================================================
   18. Score (J): the outline of a heist, rolled for inspiration (app/gm/score.js; GM.md "Score (J)")
   ===================================================================================================================== */
const SCT = SCFIX.score.T, SFAC = SCT.faction.map((f) => f[0]), SDIST = SCT.loc.district;
const SC_DOC = { session: { number: 3 }, crew: { type: 'Tunnellers', tier: 1 } };
const SCAMP = Object.assign({}, FIXC.campaign, SCFIX.campaign);       /* the console fixture's PCs and NPCs, the score fixture's crew and standing */
/* a table that takes clocks and holds a cast: rig.clocks is what addClock got, rig.cast the NPC docs (id -> doc) the cast collection holds */
function scRig(extra) {
  const rig = { clocks: [], fail: null, cast: {} };
  rig.api = { addClock: (c) => { rig.clocks.push(cl(c)); return rig.fail ? Promise.reject(rig.fail) : Promise.resolve(true); },
    db: () => ({ collection: () => ({ onSnapshot: (cb) => { cb({ docs: Object.keys(rig.cast).map((id) => ({ id, data: () => cl(rig.cast[id]) })) }); return () => {}; } }) }) };
  return Object.assign(rig, extra || {});
}
const scPage = (o) => openPage(Object.assign({ camp: SC_DOC, fg: fakeGm(SCAMP) }, o || {}));
const scText = (h, sel) => cardOf(h, '#gm-score ' + (sel || '.gm-sccard'));
/* the rows of a grid on the card as { label: text } (the ↻ buttons left out) */
const scRows = (h, i) => {
  const dl = h.qa('#gm-score dl.gm-sc-grid')[i || 0], dd = dl.querySelectorAll('dd'), out = {};
  dl.querySelectorAll('dt').forEach((d, k) => { out[d.textContent] = dd[k].textContent.replace(/\s+/g, ' ').replace(/↻/g, '').replace(/\*+/g, '').trim(); });
  return out;
};
const scRoll = (h) => h.q('#gm-score [data-gm="scoreroll"]').click();
const scStored = (h) => h.page._state().doc.cards.score;
/* the score the stored card redraws to (a fresh instance on the same tables and campaign) */
const scReplay = (h, T) => SCM.create({ T: T || SCT, campaign: SCAMP }).replay({ seed: scStored(h).seed, mem: JSON.parse(scStored(h).mem), ui: scStored(h).ui, bump: scStored(h).bump || {} });
const scOpts = (h, id) => h.qa('#gm-sc-' + id + ' option').map((o) => o.getAttribute('value'));
const scGroups = (h, id) => h.qa('#gm-sc-' + id + ' optgroup').map((g) => g.getAttribute('label'));

await test('18a. J opens the Score panel (a side tab after Street with its key, a phone segment too); never while typing or with a modifier; E opens nothing', async () => {
  assert.deepEqual([P.keyAction({ key: 'j' }), P.keyAction({ key: 'J' })], [{ type: 'panel', panel: 'score' }, { type: 'panel', panel: 'score' }]);
  assert.deepEqual([P.keyAction({ key: 'j', typing: true }), P.keyAction({ key: 'j', ctrlKey: true }), P.keyAction({ key: 'j', metaKey: true }), P.keyAction({ key: 'e' })], [null, null, null, null]);
  const h = await scPage();
  assert.equal(h.qa('.gm-tab').map((t) => t.getAttribute('data-panel')).join(), 'prep,rules,location,scenes,score,chase,npc,downtime,cards,ipad', 'the tab sits in the slot Engage had, after Street');
  assert.match(h.q('.gm-tab[data-panel="score"]').textContent, /^Score J$/);
  assert.equal(h.qa('[data-gm="seg"]').map((b) => b.getAttribute('data-seg')).join(), 'console,prep,location,scenes,score,chase,npc,downtime,cards,rules,ipad,state');
  assert.equal(h.q('[data-gm="seg"][data-seg="score"]').textContent, 'Score');
  h.press('j'); assert.equal(h.page._state().panel, 'score');
  h.press('b'); h.press('j', { target: h.q('#gm-cap-in') }); assert.equal(h.page._state().panel, 'location', 'J typed into a box is a letter, not the panel');
  h.press('e'); assert.equal(h.page._state().panel, 'location', 'E does nothing');
  h.q('[data-gm="seg"][data-seg="score"]').click(); assert.equal(h.page._state().panel, 'score'); assert.equal(h.page._state().seg, 'side');
  await h.save();
});

await test('18b. Roll a score files the card (seed, the choices as resolved, the memory BEFORE the roll) and one Earlier entry; the card is its title, chips, pitch, eight rows, the folded cloud and the actions', async () => {
  const fg = fakeGm(SCAMP), h = await scPage({ fg });
  h.press('j');
  assert.ok(!h.q('#gm-score .gm-sccard'), 'nothing before the first roll'); assert.match(h.q('#gm-score .gm-empty').textContent, /Nothing here goes to the iPad/);
  assert.deepEqual(h.qa('#gm-score select').map((s) => s.getAttribute('data-scui')), ['client', 'target', 'job', 'district', 'crew', 'tier']);
  assert.deepEqual(h.qa('#gm-score label .gm-lab').map((l) => l.textContent), ["Who's asking", 'Target', 'Job', 'Where', 'Crew', 'Tier']);
  assert.deepEqual(scGroups(h, 'client'), ['Campaign NPCs', 'Factions', 'Kinds'], 'optgroups: the pack\'s NPCs (no cast here), the factions, the kinds of client');
  assert.deepEqual(scGroups(h, 'job'), ['Favoured by Tunnellers', 'All operations']); assert.deepEqual(scOpts(h, 'tier'), ['', '0', '1', '2', '3', '4', '5', '6']);
  assert.equal(h.q('#gm-sc-crew option').textContent, 'Tunnellers (the crew)'); assert.equal(h.q('#gm-sc-tier option').textContent, 'Tier I (the crew)');
  assert.equal(h.q('#gm-score [data-gm="scoreroll"]').textContent, 'Roll a score');
  scRoll(h);
  const card = h.q('#gm-score .gm-sccard'); assert.ok(card, 'a card'); assert.equal(card.getAttribute('data-tool'), 'score');
  assert.match(cardOf(h, '#gm-score .gm-sccard h3'), /^(Break in|Lift|Torch) · /); assert.match(cardOf(h, '#gm-score .gm-sccard .gm-sub'), /^Tier [IV]+ · .+ · \d+ stacks?, .+$/);
  assert.equal(h.qa('#gm-score .gm-sccard .gm-chip').length, 4);
  assert.ok(h.q('#gm-score .gm-sc-want') && h.q('#gm-score .gm-sc-want .gm-bump[data-row="lead"]'), 'the pitch box has its ↻ in the corner');
  const grids = h.qa('#gm-score dl.gm-sc-grid'); assert.equal(grids.length, 2);
  assert.deepEqual(grids[0].querySelectorAll('dt').map((d) => d.textContent), ["Who's asking", 'The job', 'Target', 'Where', 'Why now', 'Twist', 'Ways in', 'Pays']);
  const cloud = h.q('#gm-score details.gm-sc-cloud'); assert.ok(cloud && !cloud.hasAttribute('open'), 'the cloud is folded'); assert.equal(cloud.querySelector('summary').textContent, 'The cloud');
  assert.equal(cloud.querySelectorAll('dt')[0].textContent, 'By the book'); assert.ok(cloud.querySelectorAll('dt').map((d) => d.textContent).includes('Called Shot'));
  const bumps = h.qa('#gm-score .gm-bump'), rows = bumps.map((b) => b.getAttribute('data-row'));
  assert.ok(rows.length >= 6 && rows.length <= 8, 'a ↻ on each row that can move: ' + rows); assert.ok(rows.every((r) => ['lead', 'client', 'job', 'target', 'site', 'why', 'twist', 'pay'].includes(r)));
  assert.ok(bumps.every((b) => b.getAttribute('data-gm') === 'scorebump' && /^Reroll \S/.test(b.getAttribute('aria-label')) && b.textContent === '↻'), 'each has its label');
  assert.deepEqual(h.qa('#gm-score .gm-sccard .gm-card-acts button').map((b) => b.getAttribute('data-gm')), ['scorecards', 'scoresite', 'scoreface', 'scoreclock', 'pin', 'copy']);
  assert.deepEqual(h.qa('#gm-score .gm-sccard .gm-card-acts button').map((b) => b.textContent), ['To Cards', 'Roll the site', 'A face', 'Start the clock', 'Pin', 'Copy']);
  assert.equal(h.qa('#gm-score .gm-earlier [data-gm="replay"]').length, 1, 'Earlier: one');
  await h.save();
  const c = fg.server.doc.cards.score, d = fg.server.doc;
  assert.ok(Number.isInteger(c.seed) && c.hid && c.label && c.at && typeof c.mem === 'string' && !('bump' in c) && !('started' in c), JSON.stringify(Object.keys(c)));
  assert.equal(c.mem, '{}', 'the guard as it was before the first roll');
  assert.equal(c.ui.crew, 'Tunnellers'); assert.equal(c.ui.tier, 1, 'the crew and Tier as they were resolved'); assert.equal(c.ui.nowIn, '');
  assert.equal(Object.keys(d.hist.score).length, 1); assert.ok(Object.keys(d.mem.score).length > 5, 'the live repeat guard is kept');
  assert.ok(!/Invented (secret|right-now)|Notable \d Invented|pumping annex/.test(JSON.stringify(d)), 'no table text in the notes: replay info only');
  assert.equal(fg.server.displays.length, 0, 'nothing went to the iPad');
});

await test('18c. a reload redraws the same card, Earlier brings the first back, and ↻ rolls one row again in the same card and its Earlier entry (no new entry)', async () => {
  const fg = fakeGm(SCAMP), br = fakeBrowser();
  const h = await scPage({ fg, br }); h.press('j');
  scRoll(h); const a = scText(h); scRoll(h); const b = scText(h); assert.notEqual(a, b);
  await h.save();
  const h2 = await scPage({ fg, br }); h2.press('j');
  assert.equal(scText(h2), b, 'the same card after a reload');
  const chips = h2.qa('#gm-score [data-gm="replay"]'); assert.equal(chips.length, 2);
  chips.filter((c) => !c.hasAttribute('aria-current'))[0].click();
  assert.equal(scText(h2), a, 'Earlier redraws the first card');
  // ↻ on Why now: that row changes, the other core rows stay, the card keeps its seed and its place in Earlier
  const was = scRows(h2), seed = scStored(h2).seed, hid = scStored(h2).hid;
  h2.q('#gm-score .gm-bump[data-row="why"]').click();
  const now = scRows(h2); assert.notEqual(now['Why now'], was['Why now'], 'the row moved');
  for (const k of Object.keys(was)) if (k !== 'Why now') assert.equal(now[k], was[k], k + ' stayed');
  const st = scStored(h2); assert.equal(st.seed, seed); assert.equal(st.hid, hid); assert.ok(st.bump.why >= 1 && Object.keys(st.bump).join() === 'why');
  assert.equal(h2.qa('#gm-score [data-gm="replay"]').length, 2, 'a reroll adds no Earlier entry');
  assert.deepEqual(h2.page._state().doc.hist.score[hid].bump, st.bump, 'the Earlier entry has the bump too');
  const after = scText(h2);
  await h2.save();
  const h3 = await scPage({ fg, br }); h3.press('j');
  assert.equal(scText(h3), after, 'the rerolled card comes back after a reload');
  // the pitch ↻, a second ↻ on the same row, and a new roll starts clean
  h3.q('#gm-score .gm-bump[data-row="lead"]').click();
  assert.ok(Object.keys(scStored(h3).bump).sort().join() === 'lead,why', 'bumps are kept per section: ' + JSON.stringify(scStored(h3).bump));
  scRoll(h3); assert.ok(!('bump' in scStored(h3)) && scStored(h3).hid !== hid, 'a new roll has no bumps');
  await h3.save();
  assert.ok(!('bump' in fg.server.doc.cards.score), 'and none are left in the notes (the old card\'s are nulled)');
});

await test('18d. the pickers shape the next roll and are kept; Now in follows the Where picker; a stored card never moves with them', async () => {
  const fg = fakeGm(SCAMP), br = fakeBrowser();
  const h = await scPage({ fg, br }); h.press('j');
  pick(h, '#gm-sc-target', 'fac:' + SFAC[3]); pick(h, '#gm-sc-job', 'Lift'); pick(h, '#gm-sc-district', SDIST[1]);
  scRoll(h);
  const rows = scRows(h); assert.match(rows['Target'], new RegExp('^' + SFAC[3])); assert.match(rows['The job'], /^Lift/); assert.match(rows['Where'], new RegExp(SDIST[1] + '$'));
  const card = scText(h);
  pick(h, '#gm-sc-target', ''); pick(h, '#gm-sc-district', '');
  assert.equal(scText(h), card, 'a picker changes the next roll, not the card on screen');
  eqj(stateDoc(h).sc.ui, { target: '', job: 'Lift', district: '' });
  // Now in: the Where picker names it and follows it; 'now' rolls there; the card keeps the district it resolved
  assert.deepEqual(scOpts(h, 'district').slice(0, 3), ['', 'now', '*']); assert.equal(h.q('#gm-sc-district option[value="now"]').textContent, 'Now in: anywhere');
  pick(h, '#gm-now', SDIST[2]);
  assert.equal(h.q('#gm-sc-district option[value="now"]').textContent, 'Now in: ' + SDIST[2], 'the picker follows Now in');
  pick(h, '#gm-sc-district', 'now'); pick(h, '#gm-sc-target', 'fac:' + SFAC[5]); scRoll(h);
  assert.match(scRows(h)['Where'], new RegExp(SDIST[2] + '$')); const stored = scStored(h); assert.equal(stored.ui.district, 'now'); assert.equal(stored.ui.nowIn, SDIST[2]);
  const rolled = scText(h);
  pick(h, '#gm-now', SDIST[0]);
  assert.equal(scText(h), rolled, 'Now in changed: the card on screen stays as rolled'); assert.equal(h.q('#gm-sc-district option[value="now"]').textContent, 'Now in: ' + SDIST[0]);
  await h.save();
  const h2 = await scPage({ fg, br }); h2.press('j');
  assert.equal(scText(h2), rolled, 'and so does a reload'); assert.equal(optSel(h2, '#gm-sc-job').getAttribute('value'), 'Lift', 'the pickers came back');
  assert.equal(optSel(h2, '#gm-sc-target').getAttribute('value'), 'fac:' + SFAC[5]); assert.equal(optSel(h2, '#gm-sc-district').getAttribute('value'), 'now');
  // a Now in the score tables do not hold: the picker says so, and 'now' rolls where the target is
  pick(h2, '#gm-now', ''); assert.equal(h2.q('#gm-sc-district option[value="now"]').textContent, 'Now in: anywhere');
  await h2.save();
});

await test('18e. the crew: the live campaign document first (type, Tier), then the pack\'s crew sheet; the GM can pick another crew or Tier; the table changing moves the labels', async () => {
  const fg = fakeGm(SCAMP);
  const h = await scPage({ fg, camp: { session: { number: 3 }, crew: { type: 'Stagehands', tier: 3 } } }); h.press('j');
  assert.equal(h.q('#gm-sc-crew option').textContent, 'Stagehands (the crew)'); assert.equal(h.q('#gm-sc-tier option').textContent, 'Tier III (the crew)');
  assert.deepEqual(h.qa('#gm-sc-job optgroup')[0].querySelectorAll('option').map((o) => o.getAttribute('value')), ['Torch', 'Lift'], 'the Job picker\'s favoured group is that crew\'s');
  scRoll(h); const c1 = scStored(h); assert.equal(c1.ui.crew, 'Stagehands'); assert.equal(c1.ui.tier, 3);
  assert.match(scRows(h)['Pays'], /3d \[\d \d \d\]/, 'three dice for a Tier III crew');
  pick(h, '#gm-sc-crew', 'Tunnellers'); pick(h, '#gm-sc-tier', '5');
  assert.deepEqual(h.qa('#gm-sc-job optgroup')[0].querySelectorAll('option').map((o) => o.getAttribute('value')), SCT.crew.Tunnellers.ops, 'picking a crew redraws the Job picker');
  scRoll(h); const c2 = scStored(h); assert.equal(c2.ui.crew, 'Tunnellers'); assert.equal(c2.ui.tier, 5); assert.match(scRows(h)['Pays'], /5d \[\d \d \d \d \d\]/);
  const was = scText(h);
  h.page.campaign({ session: { number: 3 }, crew: { type: 'Stagehands', tier: 2 } });
  assert.equal(scText(h), was, 'the table changed: the card stays'); assert.equal(h.q('#gm-sc-crew option').textContent, 'Stagehands (the crew)'); assert.equal(h.q('#gm-sc-tier option').textContent, 'Tier II (the crew)', 'the labels follow the table');
  assert.equal(optSel(h, '#gm-sc-crew').getAttribute('value'), 'Tunnellers', 'the GM\'s pick stays');
  pick(h, '#gm-sc-crew', ''); pick(h, '#gm-sc-tier', ''); scRoll(h); const c3 = scStored(h); assert.equal(c3.ui.crew, 'Stagehands'); assert.equal(c3.ui.tier, 2, 'back to following the table');
  await h.save();
  // no type on the table's sheet: the pack's sheet; no document at all: the pack's Tier too
  const h2 = await scPage({ fg: fakeGm(SCAMP), camp: { session: { number: 3 }, crew: { type: '', tier: 4 } } }); h2.press('j'); scRoll(h2);
  assert.equal(scStored(h2).ui.crew, 'Tunnellers', 'the sheet\'s type'); assert.equal(scStored(h2).ui.tier, 4, 'the table\'s Tier'); await h2.save();
  const h3 = await scPage({ fg: fakeGm(SCAMP), camp: null }); h3.press('j'); scRoll(h3);
  assert.equal(scStored(h3).ui.crew, 'Tunnellers'); assert.equal(scStored(h3).ui.tier, 1, 'the sheet\'s Tier'); await h3.save();
  const h4 = await scPage({ fg: fakeGm(FIXC.campaign), camp: null }); h4.press('j'); scRoll(h4);
  assert.equal(scStored(h4).ui.crew, 'Tunnellers', 'no sheet either: the first crew in the tables'); assert.equal(scStored(h4).ui.tier, 0); await h4.save();
});

const SCAST = { n1: { name: 'Ada Invented', role: 'a lamplighter', faction: SFAC[0], revealed: true }, n2: { name: 'Bram Invented', role: '', faction: '', revealed: false } };
await test('18f. Who\'s asking: the NPCs on stage, the last NPC roll, the cast and the campaign\'s own, in optgroups; one asks and is the client, the pitch and the payer', async () => {
  const rig = scRig({ cast: cl(SCAST) }), fg = fakeGm(SCAMP);
  const h = await scPage({ fg, api: rig.api, camp: Object.assign(cl(SC_DOC), { scene: { npcs: { n1: true } } }) }); h.press('j');
  assert.deepEqual(scGroups(h, 'client'), ['On stage', 'The cast', 'Campaign NPCs', 'Factions', 'Kinds']);
  const grp = (i) => h.qa('#gm-sc-client optgroup')[i].querySelectorAll('option').map((o) => [o.getAttribute('value'), o.textContent]);
  assert.deepEqual(grp(0), [['npc:app-n1', 'Ada Invented (' + SFAC[0] + ')']]); assert.deepEqual(grp(1), [['npc:app-n2', 'Bram Invented']], 'the cast has the rest: each NPC once');
  assert.ok(grp(2).length >= 3 && grp(2).every((o) => /^npc:pack-/.test(o[0])), 'the campaign\'s NPCs, none already listed');
  pick(h, '#gm-sc-client', 'npc:app-n1'); eqj(stateDoc(h).sc.ui.who, { name: 'Ada Invented', faction: SFAC[0], district: '', role: 'a lamplighter', want: '' });
  scRoll(h);
  assert.match(scRows(h)["Who's asking"], /^Ada Invented \(a lamplighter · The Brisk30 Guild\)/); assert.match(scRows(h)['Pays'], /paid by Ada Invented$/);
  { const s = scReplay(h).score, pitch = cardOf(h, '#gm-score .gm-sc-want').replace(/\u21bb/g, '').trim(); assert.ok(s.seed ? pitch === s.pitch : pitch.startsWith('**Ada Invented** wants you to '), pitch); }
  assert.ok(!h.q('#gm-score [data-gm="scoreface"]'), 'A face is for a client who is not an NPC yet');
  const st = scStored(h); assert.equal(st.ui.client, 'npc:app-n1'); assert.equal(st.ui.who.name, 'Ada Invented'); assert.equal(st.ui.who.role, 'a lamplighter');
  const card = scText(h);
  await h.save();
  // the cast changes under the card: a replay still reads the stored who, so the card is the same
  rig.cast.n1.name = 'Someone Else'; const h2 = await scPage({ fg, api: rig.api, camp: Object.assign(cl(SC_DOC), { scene: { npcs: { n1: true } } }) }); h2.press('j');
  assert.equal(scText(h2), card, 'a reload redraws the card from the NPC the score kept'); assert.equal(optSel(h2, '#gm-sc-client').getAttribute('value'), 'npc:app-n1');
  assert.ok(h2.qa('#gm-sc-client optgroup').some((g) => g.getAttribute('label') === 'On stage'));
  await h2.save();
  // an NPC picked earlier who is in no list now stays pickable (and chosen)
  const fg3 = fakeGm(SCAMP); fg3.server.doc = { sc: { ui: { client: 'npc:app-gone', who: { name: 'Gone Invented', faction: '', district: '', role: 'a ferryman', want: 'peace' } } } };
  const h3 = await scPage({ fg: fg3 }); h3.press('j');
  assert.deepEqual(scGroups(h3, 'client')[0], 'Picked'); assert.equal(optSel(h3, '#gm-sc-client').textContent, 'Gone Invented (a ferryman)');
  scRoll(h3); assert.match(scRows(h3)["Who's asking"], /^Gone Invented \(a ferryman\) — wants peace$/); await h3.save();
});

await test('18g. A job for them (on the NPC card) and Job (beside a name in the rail\'s On stage box) set the NPC as the client, open the Score tab and roll', async () => {
  const K = require(path.join(ROOT, 'app', 'figures', 'figure-kit.js'));
  const rig = scRig({ cast: cl(SCAST) }), fg = fakeGm(Object.assign({}, NPCFIX.parts.campaign, SCFIX.campaign), { npc: { version: 'n1', src: {}, body: NPCFIX.parts.npc } });
  const camp = Object.assign(cl(SC_DOC), { scene: { npcs: { n1: true } } });
  const h = await openPage({ br: fakeBrowser({ B68GmNpc: NPCM, B68Figure: K }), fg, api: rig.api, camp });
  // the rail: a Job button beside each name on stage
  const jb = h.q('#gm-rail [data-gm="scorestage"][data-id="n1"]'); assert.ok(jb && jb.textContent === 'Job' && /A job for Ada Invented/.test(jb.getAttribute('aria-label')), 'a Job button beside the name');
  assert.ok(!h.q('#gm-rail [data-gm="scorestage"][data-id="n2"]'), 'only for those on stage'); assert.equal(h.qa('#gm-rail .gm-onstage a').length, 1);
  jb.click();
  assert.equal(h.page._state().panel, 'score'); assert.ok(h.q('#gm-score .gm-sccard'), 'it rolled');
  assert.match(scRows(h)["Who's asking"], /^Ada Invented/); assert.equal(scStored(h).ui.client, 'npc:app-n1');
  // the NPC card: A job for them
  h.press('n'); h.q('[data-gm="npcroll"]').click();
  const nm = cardOf(h, '#gm-npc .gm-npccard h3').split(' — ')[0];
  const nj = h.q('#gm-npc .gm-npccard [data-gm="npcjob"]'); assert.ok(nj && nj.textContent === 'A job for them');
  nj.click();
  assert.equal(h.page._state().panel, 'score', 'the Score tab opened');
  assert.match(scRows(h)["Who's asking"], new RegExp('^' + nm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))); assert.equal(scStored(h).ui.client.indexOf('npc:roll-'), 0);
  assert.ok(h.qa('#gm-sc-client optgroup').some((g) => g.getAttribute('label') === 'Last NPC roll'), 'the last NPC roll is in the picker');
  assert.equal(h.qa('#gm-score .gm-earlier [data-gm="replay"]').length, 2, 'each roll is in Earlier');
  await h.save();
  assert.equal(fg.server.displays.length, 0);
});

await test('18h. To Cards adds the opportunity to the Cards panel after the last, eight at most; it is shown to the players only from there', async () => {
  const fg = fakeGm(SCAMP), h = await scPage({ fg }); h.press('j'); scRoll(h);
  const e = SCM.cardEntry(scReplay(h).score);
  h.q('#gm-score [data-gm="scorecards"]').click();
  const list = () => Object.values(stateDoc(h).opps.list).sort((a, b) => a.order - b.order);
  assert.equal(list().length, 1); const o = list()[0];
  assert.deepEqual({ from: o.from, client: o.client, target: o.target, type: o.type, note: o.note, payout: o.payout }, e); assert.equal(o.order, 1);
  assert.ok(h.br.toasts.some((t) => t[0] === 'On the Cards panel: ' + e.type + ' · ' + e.target + '. Show it from there.' && !t[1]), JSON.stringify(h.br.toasts));
  h.press('o'); assert.equal(h.qa('#gm-cards .oc-in[data-f="type"]').map((i) => i.getAttribute('value'))[0], e.type, 'it is on the Cards panel');
  for (let i = 0; i < 7; i++) { scRoll(h); h.q('#gm-score [data-gm="scorecards"]').click(); }
  assert.deepEqual(list().map((x) => x.order), [1, 2, 3, 4, 5, 6, 7, 8], 'in order, after the last');
  h.br.toasts.length = 0; scRoll(h); h.q('#gm-score [data-gm="scorecards"]').click();
  assert.equal(list().length, 8, 'the ninth is refused'); assert.ok(h.br.toasts.some((t) => /Cards panel holds 8 cards already/.test(t[0]) && t[1]), JSON.stringify(h.br.toasts));
  const finalList = list();
  await h.save();
  assert.equal(fg.server.displays.length, 0, 'nothing went to the iPad: the Cards panel\'s own Show buttons do that');
  for (const o2 of finalList) for (const k of ['from', 'client', 'target', 'type', 'note', 'payout']) assert.ok(typeof o2[k] === 'string' && o2[k].length <= 120, k);
});

await test('18i. Roll the site sets the Location pickers from the score (the way Score sites does), opens Location and rolls; what the generator lacks is named', async () => {
  // approaches the location fixture holds, so every hint matches
  const T2 = cl(SCT), WAYS = ['Quiet', 'Loud'];
  for (const op of Object.values(T2.op)) op.ways = WAYS.slice(); T2.vector = { Quiet: ['a quiet way in'], Loud: ['a loud way in'] }; T2.approach = [['Quiet', 'the quiet way'], ['Loud', 'the loud way']];
  const fg = fakeGm(SCAMP, { score: { version: 'sc2', src: {}, body: { T: T2 } } }), h = await scPage({ fg }); h.press('j');
  pick(h, '#gm-sc-target', 'fac:' + SFAC[1]); scRoll(h);
  const rows = scRows(h);
  h.q('#gm-score [data-gm="scoresite"]').click();
  const st = h.page._state(); assert.equal(st.panel, 'location'); assert.ok(st.locRoll, 'a location was rolled');
  const lu = stateDoc(h).loc.ui; assert.equal(lu.faction, SFAC[1]); assert.equal(lu.approach, 'Quiet'); assert.ok(SDIST.includes(lu.district) && rows['Where'].endsWith(lu.district), JSON.stringify(lu) + ' / ' + rows['Where']);
  assert.ok(FIXL.T.targetNames.includes(lu.target) && rows['Where'].includes(lu.target), 'the building type is the location generator\'s');
  assert.ok(!h.br.toasts.some((t) => /Not in the generator/.test(t[0])), 'every hint matched');
  assert.equal(stateDoc(h).cards.location.ui.faction, SFAC[1], 'the location card was rolled with them');
  await h.save();
  // the default fixture\'s approaches are the score tables\' own (Stealth ...), which the location fixture lacks: rolled on any, and said so
  const h2 = await scPage({ fg: fakeGm(SCAMP) }); h2.press('j'); scRoll(h2);
  h2.q('#gm-score [data-gm="scoresite"]').click();
  assert.equal(h2.page._state().panel, 'location'); assert.equal(stateDoc(h2).loc.ui.approach, '', 'an approach the generator lacks rolls on any');
  assert.ok(h2.br.toasts.some((t) => t[1] && /^Not in the generator, so rolled on any: approach “\w+”\.$/.test(t[0])), JSON.stringify(h2.br.toasts));
  await h2.save();
});

await test('18j. A face sets the NPC pickers from the score (the client\'s faction, or the target\'s when nobody asks, and the district), opens NPC and says what it set; it is not offered when an NPC asks', async () => {
  const npcPart = cl(NPCFIX.parts.npc); for (const f of SFAC.slice(0, 3)) npcPart.T.faction.push([f, 3, 'S']); for (const d of SDIST.slice(0, 2)) npcPart.T.district.push(d);
  const mk = (camp) => fakeGm(camp || Object.assign({}, NPCFIX.parts.campaign, SCFIX.campaign), { npc: { version: 'n9', src: {}, body: npcPart } });
  const open = (fg) => openPage({ br: fakeBrowser({ B68GmNpc: NPCM }), fg, camp: SC_DOC });
  let h = await open(mk()); h.press('j');
  pick(h, '#gm-sc-client', 'fac:' + SFAC[0]); pick(h, '#gm-sc-district', SDIST[0]); scRoll(h);
  h.q('#gm-score [data-gm="scoreface"]').click();
  assert.equal(h.page._state().panel, 'npc'); eqj(stateDoc(h).npc.ui, { faction: SFAC[0], district: SDIST[0], place: '' });
  assert.equal(optSel(h, '#gm-n-faction').getAttribute('value'), SFAC[0], 'the NPC pickers show it');
  assert.ok(h.br.toasts.some((t) => !t[1] && t[0] === 'For a face: ' + SFAC[0] + ', ' + SDIST[0] + '. Change either before you roll.'), JSON.stringify(h.br.toasts));
  await h.save();
  // nobody asks: the target's faction; a district the NPC tables lack: any (not whatever Now in is)
  h = await open(mk()); h.press('j');
  pick(h, '#gm-sc-client', '-'); pick(h, '#gm-sc-target', 'fac:' + SFAC[2]); pick(h, '#gm-sc-district', SDIST[3]); scRoll(h);
  h.q('#gm-score [data-gm="scoreface"]').click();
  eqj(stateDoc(h).npc.ui, { faction: SFAC[2], district: '*', place: '' }); assert.ok(h.br.toasts.some((t) => t[0] === 'For a face: ' + SFAC[2] + '. Change either before you roll.'), JSON.stringify(h.br.toasts));
  await h.save();
  // a kind of client has no faction
  h = await open(mk()); h.press('j'); pick(h, '#gm-sc-client', 'kind:Civilian'); pick(h, '#gm-sc-district', SDIST[3]); scRoll(h);
  h.q('#gm-score [data-gm="scoreface"]').click(); eqj(stateDoc(h).npc.ui, { faction: '', district: '*', place: '' });
  assert.ok(h.br.toasts.some((t) => /hold neither the faction nor the district/.test(t[0])), JSON.stringify(h.br.toasts)); await h.save();
  // an NPC who asks: no A face
  h = await open(mk(SCAMP)); h.press('j'); pick(h, '#gm-sc-client', 'npc:pack-' + P.slug('Marge Teacup')); scRoll(h);
  assert.ok(!h.q('#gm-score [data-gm="scoreface"]')); await h.save();
});

await test('18k. Start the clock: addClock gets one hidden danger clock, once; the button is done for that card, after a reload and on its Earlier entry; a new card starts clean', async () => {
  const rig = scRig(), fg = fakeGm(SCAMP), br = fakeBrowser();
  const h = await scPage({ fg, br, api: rig.api }); h.press('j'); scRoll(h);
  const btn = () => h.q('#gm-score [data-gm="scoreclock"]'), want = SCM.clockOf(scReplay(h).score);
  assert.equal(btn().textContent, 'Start the clock');
  btn().click(); btn() && btn().click();
  assert.ok(await until(() => br.toasts.some((t) => /^Clock started/.test(t[0]))), 'a toast');
  assert.equal(rig.clocks.length, 1, 'addClock was called once'); const c = rig.clocks[0];
  assert.ok(/^c_[a-z0-9]+$/.test(c.id), c.id); assert.deepEqual(Object.assign({}, c, { id: 'x' }), { id: 'x', name: want.name, size: want.size, filled: 0, kind: 'danger', hidden: true });
  assert.ok(br.toasts.some((t) => t[0] === 'Clock started, hidden from the players: ' + want.name + '. Show it from the table page.' && !t[1]), JSON.stringify(br.toasts));
  assert.ok(btn().hasAttribute('disabled') && btn().textContent === 'Clock started: ' + want.name, 'the button is done');
  btn().click(); await tick(); assert.equal(rig.clocks.length, 1, 'a second tap starts nothing');
  const st = scStored(h); assert.equal(st.started[want.name], c.id, 'the card keeps the clock\'s id'); assert.equal(stateDoc(h).hist.score[st.hid].started[want.name], c.id, 'and so does its Earlier entry');
  await h.save();
  const h2 = await scPage({ fg, br, api: rig.api }); h2.press('j');
  assert.ok(h2.q('#gm-score [data-gm="scoreclock"]').hasAttribute('disabled') && h2.q('#gm-score [data-gm="scoreclock"]').textContent === 'Clock started: ' + want.name, 'still done after a reload');
  scRoll(h2); assert.ok(!('started' in scStored(h2)), 'a new card starts with no clock of the old one\'s'); assert.equal(h2.q('#gm-score [data-gm="scoreclock"]').textContent, 'Start the clock');
  h2.qa('#gm-score [data-gm="replay"]').filter((x) => !x.hasAttribute('aria-current'))[0].click();
  assert.equal(h2.q('#gm-score [data-gm="scoreclock"]').textContent, 'Clock started: ' + want.name, 'Earlier brings the card back with its clock started');
  await h2.save();
  // the table refuses it: the button comes back and the toast says so; with no table at all, it says where to start it
  const rig3 = scRig({ fail: new Error('the table is offline') }), h3 = await scPage({ api: rig3.api }); h3.press('j'); scRoll(h3);
  h3.q('#gm-score [data-gm="scoreclock"]').click();
  assert.ok(await until(() => h3.br.toasts.some((t) => /^Could not start the clock: the table is offline/.test(t[0]) && t[1]))); assert.ok(!h3.q('#gm-score [data-gm="scoreclock"]').hasAttribute('disabled'), 'the button is back'); await h3.save();
  const h4 = await scPage({}); h4.press('j'); scRoll(h4); h4.q('#gm-score [data-gm="scoreclock"]').click();
  assert.ok(h4.br.toasts.some((t) => /table is not available here/.test(t[0]) && t[1])); await h4.save();
});

await test('18l. Pin and Copy are the card as plain lines; L files "Score: <label>"; nothing in the Score panel ever goes to the iPad', async () => {
  const fg = fakeGm(SCAMP), br = fakeBrowser(), rig = scRig(), h = await scPage({ fg, br, api: rig.api }); h.press('j'); scRoll(h);
  h.q('#gm-score [data-gm="copy"]').click();
  assert.ok(/^\S.* · \S/.test(br.copied.split('\n')[0]) && /\nWho's asking: /.test(br.copied) && /\nBy the book: /.test(br.copied) && !/\*\*|↻|<[a-z]/.test(br.copied), br.copied.slice(0, 200));
  h.q('#gm-score [data-gm="pin"]').click(); h.press('l');
  h.q('#gm-score .gm-bump[data-row="why"]').click(); h.q('#gm-score [data-gm="scorecards"]').click(); h.q('#gm-score [data-gm="scoreclock"]').click(); h.q('#gm-score [data-gm="scoresite"]').click();
  await h.save();
  const pins = Object.values(fg.server.doc.pins); assert.equal(pins.length, 1); assert.equal(pins[0].tool, 'score'); assert.ok(pins[0].text.length > 100 && pins[0].text.length <= 1500);
  const cap = Object.values(fg.server.doc.capture); assert.ok(cap.some((e) => e.bucket === 'r' && /^Score: .+ · .+/.test(e.text)), JSON.stringify(cap));
  assert.equal(fg.server.displays.length, 0, 'no roll, ↻, To Cards, clock, site, pin or copy sent anything to the iPad');
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8'), sec = src.slice(src.indexOf('Score (J): the outline of a heist'), src.indexOf('Downtime (D): personal business'));
  assert.ok(sec.length > 5000 && !/pushDisplay|setDisplay|kind: 'cards'|oppShow/.test(sec), 'the Score section of the page has no road to the display');
});

await test('18m. a pack without the score part, or an old shell without the module: the panel says so, the Job buttons are not offered, the rest works; the Pack check names what the part lacks', async () => {
  const fg = fakeGm(SCAMP); const full = fg.gm.pack; fg.gm.pack = async () => { const r = await full(); delete r.parts.score; return r; };
  const rig = scRig({ cast: cl(SCAST) });
  const h = await scPage({ fg, api: rig.api, camp: Object.assign(cl(SC_DOC), { scene: { npcs: { n1: true } } }) }); h.press('j');
  assert.equal(h.q('#gm-score').textContent, 'The pack has no score part. Update the pack.'); assert.ok(!h.q('#gm-rail [data-gm="scorestage"]'), 'no Job button without a score part');
  h.press('2'); assert.ok(cardTxt(h).length > 20, 'the console still rolls'); await h.save();
  const h2 = await scPage({ br: fakeBrowser({ B68GmScore: undefined }) }); h2.press('j');
  assert.match(h2.q('#gm-score').textContent, /score generator module is missing/); await h2.save();
  const sparse = cl(SCFIX.score.T); delete sparse.why; sparse.op.Lift.verb = 'no placeholder';
  const h3 = await scPage({ fg: fakeGm(SCAMP, { score: { version: 'sc3', src: {}, body: { T: sparse } } }) });
  assert.ok(/score: op\.Lift\.verb, why/.test(h3.q('#gm-menu-warn').textContent), 'the Menu lists them: ' + h3.q('#gm-menu-warn').textContent);
  assert.deepEqual(P.packWarnings({ B68GmScore: SCM }, { score: { T: sparse } }), [{ part: 'score', missing: SCM.check(sparse) }]);
  assert.deepEqual(P.packWarnings({ B68GmScore: SCM }, { score: { T: SCT } }), [], 'the fixture is complete');
  h3.press('j'); scRoll(h3); assert.ok(h3.q('#gm-score .gm-sccard'), 'a roll still works on a pack that lacks entries'); await h3.save();
});

await test('18n. the cloud stays as the GM left it (open or shut) through a ↻ and a reload; every ↻ and button in the panel is a real control', async () => {
  const fg = fakeGm(SCAMP), br = fakeBrowser(), h = await scPage({ fg, br }); h.press('j'); scRoll(h);
  const cloud = () => h.q('#gm-score details.gm-sc-cloud');
  assert.ok(!cloud().hasAttribute('open')); cloud().setAttribute('open', ''); cloud().open = true; dispatch(cloud(), 'toggle');
  h.q('#gm-score .gm-bump[data-row="twist"]').click(); assert.ok(cloud().hasAttribute('open'), 'a ↻ leaves the cloud open');
  await h.save();
  const h2 = await scPage({ fg, br }); h2.press('j'); assert.ok(h2.q('#gm-score details.gm-sc-cloud').hasAttribute('open'), 'and so does a reload (this device)');
  for (const b of h2.qa('#gm-score button')) assert.equal(b.getAttribute('type'), 'button', 'no stray submit buttons');
  await h2.save();
});

/* =====================================================================================================================
   WP2. The console pre-rolls its 1-3 and 4/5 draws when the Position is set, sends them to the Fixer, and replays them
   ===================================================================================================================== */
/* a fake Claude box: records the fit asks; `hold` keeps an answer pending until released */
const FITCARD = (tag) => ({ seat: 'fixer', at: '2030-01-01T00:00:00.000Z', text: 'r', read: 'read ' + tag, one_three: 'low ' + tag, four_five: 'mid ' + tag, six: 'six ' + tag, crit: 'crit ' + tag, bargain: 'bargain ' + tag });
function fakeAssist(over) {
  const log = Object.assign({ fits: [], starts: 0, canFit: true, listening: true, hold: false, held: [], created: 0, opts: null, err: null }, over || {});
  const A = { create(o) {
    log.created++; log.opts = o;
    return { destroy() {}, toggle() {}, isOpen: () => false, close() {}, canFit: () => log.canFit,
      autoFit(req, onStart) {
        if (!log.canFit || !log.listening) return Promise.resolve(null);   /* what the real box does: no call at all */
        if (typeof onStart === 'function') onStart(); log.starts++;
        log.fits.push(req);
        if (log.err) return Promise.resolve({ error: log.err });
        if (log.hold) return new Promise((res) => log.held.push(() => res({ card: FITCARD(String(log.fits.length)) })));
        return Promise.resolve({ card: FITCARD(String(log.fits.length)) });
      } };
  } };
  return { A, log };
}
const PRE_WAIT = 700;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function openWithAssist(over) {
  const fa = fakeAssist(over), fg = fakeGm();
  fg.gm.assistTick = async () => ({ cards: [], updates: [], flags: [], spend: { tonight: 0, cap: 20, tier: 'all', tick: 0 }, last: 1 });
  fg.gm.stt = async () => ({ doc: { want: 'on' } }); fg.gm.transcript = async () => ({ lines: [] });
  const br = fakeBrowser({ B68GmAssist: fa.A });
  /* the page's own Math.random reads from a queue first, so the pre-rolled seeds are known */
  const queue = []; br.W.Math = Object.assign(Object.create(Math), { random: () => (queue.length ? queue.shift() : Math.random()) });
  const h = await openPage({ br, fg });
  const seedOf = (u) => (u * 4294967296) >>> 0;
  const entry = () => { const st = h.page._state(); return st && st.doc.cards && st.doc.cards.situation; };
  const entryText = () => { const e = entry(); const res = P.replaySituationEntry(C, FIXC.console.T, FIXC.campaign, e, {}); return P.drawTextOf(res); };
  const setPos = async (v, wait = PRE_WAIT) => { h.qa('#gm-pos [data-v="' + v + '"]')[0].click(); await sleep(wait); };
  return { h, fa, log: fa.log, queue, seedOf, entry, entryText, setPos };
}
const rackTxt = (h) => (h.q('#gm-rack').textContent || '').replace(/\s+/g, ' ').trim();

await test('W1. setting Position pre-rolls the 1-3 and 4/5 draws once and sends them, with the position, to the Fixer; the Rack shows the answer', async () => {
  const t = await openWithAssist();
  assert.equal(t.log.created, 1);
  assert.equal(t.log.fits.length, 0, 'nothing is asked until the Position is set');
  await t.setPos('desperate');
  assert.equal(t.log.fits.length, 1);
  const req = t.log.fits[0];
  assert.equal(req.position, 'desperate');
  assert.ok(req.draws.low.startsWith('A 1–3 (') && req.draws.mid.startsWith('A 4/5 ('), req.draws.low.slice(0, 30) + ' | ' + req.draws.mid.slice(0, 30));
  assert.ok(req.draws.low.length <= P.DRAW_CLIP && req.draws.mid.length <= P.DRAW_CLIP);
  assert.match(rackTxt(t.h), /Rack/); assert.match(rackTxt(t.h), /low 1/); assert.match(rackTxt(t.h), /mid 1/); assert.match(rackTxt(t.h), /bargain 1/);
  assert.equal(t.h.q('#gm-card .gm-lead'), null, 'the card area is untouched: nothing was rolled on screen');
  assert.equal(t.h.fg.server.doc.cards, undefined, 'pre-rolling stores nothing: page state only');
  await t.h.save();
});

await test('W2. the result uses the SAME draw (same seed, same text) and never re-rolls; no second fit call; a used draw is not served twice', async () => {
  const t = await openWithAssist();
  t.queue.push(0.25, 0.75);                     /* the two pre-rolled seeds: 1-3 first, then 4/5 */
  await t.setPos('risky');
  const req = t.log.fits[0];
  t.h.press('3');                               /* tap 1-3 */
  let e = t.entry(); assert.equal(e.situation, 'onetothree'); assert.equal(e.seed, t.seedOf(0.25), 'the pre-rolled seed, not a new one');
  assert.equal(t.entryText(), req.draws.low, 'the card IS the fitted draw');
  const t2 = await openWithAssist();
  t2.queue.push(0.25, 0.75);
  await t2.setPos('risky');
  const req2 = t2.log.fits[0];
  t2.h.press('2');                              /* tap 4/5 */
  e = t2.entry(); assert.equal(e.situation, 'fourfive'); assert.equal(e.seed, t2.seedOf(0.75));
  assert.equal(t2.entryText(), req2.draws.mid);
  assert.equal(t2.log.fits.length, 1, 'rolling the result asks nothing more');
  await t.h.save(); await t2.h.save();
  /* the hit line is marked in the Rack, and a second tap is a fresh roll (the draw was used) */
  const t3 = await openWithAssist();
  t3.queue.push(0.25, 0.75);
  await t3.setPos('risky');
  t3.h.press('3');
  assert.equal(t3.h.qa('#gm-rack li.hit').length, 1); assert.match(t3.h.qa('#gm-rack li.hit')[0].textContent, /1–3/);
  const first = t3.entry().seed; assert.equal(first, t3.seedOf(0.25));
  t3.h.press('3');
  assert.notEqual(t3.entry().seed, first, 'a used draw is not served twice');
  assert.equal(t3.log.fits.length, 1);
  await t3.h.save();
});

await test('W3. changing Position re-rolls and re-fits; a late answer for the old Position never lands; the same Position again asks nothing new', async () => {
  const t = await openWithAssist({ hold: true });
  await t.setPos('controlled');
  assert.equal(t.log.fits.length, 1);
  assert.match(rackTxt(t.h), /Fitting/, 'pending shows only once the call is made');
  await t.setPos('desperate');
  assert.equal(t.log.fits.length, 2); assert.equal(t.log.fits[1].position, 'desperate');
  t.log.held[0]();                              /* the answer for "controlled" arrives late */
  await sleep(10);
  assert.doesNotMatch(rackTxt(t.h), /low 1/, 'dropped: its draws are gone');
  t.log.held[1]();
  await sleep(10);
  assert.match(rackTxt(t.h), /low 2/);
  await t.setPos('desperate');                  /* tapped again: same Position, draws unused */
  assert.equal(t.log.fits.length, 2);
  await t.h.save();
});

await test('W4. dice that land before the Fixer answers show the raw draw; the late answer appears in the Rack and does not replace the card', async () => {
  const t = await openWithAssist({ hold: true });
  t.queue.push(0.25, 0.75);
  await t.setPos('risky');
  t.h.press('3');
  const before = cardTxt(t.h);
  assert.ok(before.includes('A 1–3'), before.slice(0, 60));
  assert.match(rackTxt(t.h), /Fitting/);
  t.log.held[0]();
  await sleep(10);
  assert.equal(cardTxt(t.h), before, 'the card is as it was');
  assert.match(rackTxt(t.h), /low 1/);
  assert.equal(t.h.qa('#gm-rack li.hit').length, 1, 'and the line for the result is marked');
  await t.h.save();
});

await test('W5. no fit call, no pre-roll and no Rack when the box is off, Listening is off or the cap is reached; the console rolls exactly as today', async () => {
  for (const over of [{ listening: false }, { canFit: false }]) {
    const t = await openWithAssist(over);
    await t.setPos('desperate');
    assert.equal(t.log.fits.length, 0, JSON.stringify(over));
    assert.equal(rackTxt(t.h), '');
    t.queue.push(0.25, 0.75);                   /* nobody pre-rolled, so the queue is not read by a pre-roll */
    t.h.press('3');
    assert.ok(cardTxt(t.h).includes('A 1–3'));
    assert.notEqual(t.entry().seed, t.seedOf(0.25), 'a plain roll: its own seed');
    await t.h.save();
  }
  /* no box at all (no B68GmAssist on the page, as on a phone) */
  const fg = fakeGm(); const h = await openPage({ fg });
  h.qa('#gm-pos [data-v="desperate"]')[0].click(); await sleep(PRE_WAIT);
  assert.equal(rackTxt(h), ''); h.press('3'); assert.ok(cardTxt(h).includes('A 1–3'));
  await h.save();
});

await test('W6. Clear on the Rack discards the stored draws: the next roll is a plain one; an error from the Fixer shows nothing', async () => {
  const t = await openWithAssist();
  t.queue.push(0.25, 0.75);
  await t.setPos('risky');
  assert.match(rackTxt(t.h), /low 1/);
  t.h.q('[data-gm="rackclear"]').click();
  assert.equal(rackTxt(t.h), '');
  t.h.press('3');
  assert.notEqual(t.entry().seed, t.seedOf(0.25));
  await t.h.save();
  const e = await openWithAssist({ err: 'other' });
  await e.setPos('risky');
  assert.equal(rackTxt(e.h), ''); assert.equal(e.log.fits.length, 1);
  await e.h.save();
});

await test('W7. changing a control the draw reads (not Position) re-rolls and re-fits once a Position has been set; before that nothing happens', async () => {
  const t = await openWithAssist();
  const sel = t.h.q('#gm-controls select[data-ctl="scene"]') || t.h.qa('#gm-controls select')[0];
  const fire = async (el, v) => { el.value = v; dispatch(el, 'change'); await sleep(1700); };
  const opt = (el) => { const kids = el.querySelectorAll('option'); return kids.length > 1 ? kids[1].getAttribute('value') : null; };
  const v = opt(sel);
  assert.ok(v !== null, 'the fixture has a scene to pick');
  await fire(sel, v);
  assert.equal(t.log.fits.length, 0, 'no Position set yet: nothing pre-rolled');
  await t.setPos('risky');
  assert.equal(t.log.fits.length, 1);
  await fire(sel, '');
  assert.equal(t.log.fits.length, 2, 'the scene changed under the draws: re-rolled and re-fitted');
  await t.h.save();
});

await test('W8. the box\'s own "Fit it" form gets the console\'s draws for its Position (and the Position follows it)', async () => {
  const t = await openWithAssist();
  const d = t.log.opts.draws('desperate');
  assert.ok(d && d.low.startsWith('A 1–3') && d.mid.startsWith('A 4/5'));
  assert.equal(t.h.qa('#gm-pos [data-v="desperate"]')[0].getAttribute('aria-checked'), 'true');
  assert.equal(t.log.opts.draws('nonsense'), null);
  assert.equal(t.log.fits.length, 0, 'no automatic fit: the form makes its own call');
  await t.h.save();
});

/* =====================================================================================================================
   19. The Chase panel (C): a chase strip that grows on the iPad as the chase clock fills (GM.md "Chase")
   ===================================================================================================================== */
const chCurOf = (h) => { const c = h.page._state().doc.chase; return c && c.current ? JSON.parse(JSON.stringify(c.current)) : null; };   /* a plain copy: the page runs in its own realm */
async function chPage(opts = {}) { return openPage(Object.assign({ br: fakeBrowser({ B68Map: MCH }) }, opts)); }
function chStartFrom(h, from, fields = {}) {
  h.press('c');
  if (from) h.q('#gm-chase [data-gm="ch-set"][data-k="from"][data-v="' + from + '"]').click();
  for (const [k, v] of Object.entries(fields)) { const el = h.q('#gm-chase [data-chf="' + k + '"]'); el.value = v; dispatch(el, 'input'); }
  h.q('#gm-chase [data-gm="ch-start"]').click();
}
function chTickIt(h, n, cap, roll, between) {
  if (cap != null) h.q('#gm-ch-cap').value = cap; if (roll != null) h.q('#gm-ch-roll').value = roll; if (between != null) h.q('#gm-ch-between').value = between;
  h.q('#gm-chase [data-gm="ch-tick"][data-n="' + n + '"]').click();
}

await test('19a. C opens the Chase panel, the tab after Score; without map kit 0.6 the panel says so and cannot start; without the module it says that', async () => {
  const h = await openPage();
  assert.match(h.q('.gm-tab[data-panel="chase"]').textContent, /^Chase C$/); assert.equal(h.q('[data-gm="seg"][data-seg="chase"]').textContent, 'Chase');
  h.press('c'); assert.equal(h.page._state().panel, 'chase'); assert.ok(!h.q('#gm-chase').hidden);
  assert.match(h.q('#gm-chase .gm-note').textContent, /needs map kit 0\.6; this build has none/); assert.ok(h.q('#gm-chase [data-gm="ch-start"]').disabled || h.q('#gm-chase [data-gm="ch-start"]').hasAttribute('disabled'));
  assert.deepEqual(h.qa('#gm-chase [data-k="from"]').map((b) => [b.getAttribute('data-v'), b.getAttribute('aria-pressed'), b.hasAttribute('disabled')]), [['location', 'false', true], ['scene', 'false', true], ['ground', 'true', false]], 'no roll yet: a street type it is');
  await h.save();
  const h2 = await openPage({ br: fakeBrowser({ B68GmChase: undefined, B68Map: MCH }) }); h2.press('c');
  assert.equal(h2.q('#gm-chase').textContent, 'The chase module is missing.'); h2.press('2'); assert.ok(cardTxt(h2).length > 20, 'the console still rolls'); await h2.save();
});

await test('19b. start from the Location roll\'s street; +1/+2/+3 each draw one panel (stored whole, replay-safe); level and time carry; undo, the opposing clock, a second leg', async () => {
  const fg = fakeGm(), h = await chPage({ fg });
  h.press('b'); h.q('[data-gm="locroll"]').click(); const roll = h.page._state().locRoll; assert.ok(roll && roll.namedStreet);
  chStartFrom(h, 'location', { name: 'The tallow run', clockName: 'Shake them' });
  assert.equal(h.q('#gm-chase .gm-note.warn'), null);
  let cur = chCurOf(h);
  assert.ok(cur && cur.schema === 'b68-chase/1' && cur.name === 'The tallow run' && cur.street.named === roll.namedStreet && cur.district === roll.district, JSON.stringify(cur && cur.street));
  assert.deepEqual(cur.clocks.map((k) => [k.id, k.name, k.size, k.strip]), [['crew1', 'Shake them', 6, true]], 'no opposing clock unless asked');
  assert.ok(!/watcher|targetRoom|rooms|vectors/.test(JSON.stringify(h.page._state().doc.chase || {})) && !JSON.stringify(h.page._state().doc.chase || {}).includes(roll.watcher || '§'), 'no secret of the site in the chase');
  assert.equal(h.qa('#gm-ch-strip svg').length, 1, 'the GM copy is drawn at once (no panel yet)');
  h.q('#gm-chase [data-gm="ch-set"][data-k="level"][data-v="below"]').click();
  h.q('#gm-ch-cap').value = 'kept while a switch redraws'; h.q('#gm-chase [data-gm="ch-set"][data-k="time"][data-v="Night"]').click();
  assert.equal(h.q('#gm-ch-cap').value, 'kept while a switch redraws', 'a switch keeps what is typed');
  chTickIt(h, 2, 'Through the market', 'Ana · Finesse · risky/standard · 4', 'A flashback to the garage');
  cur = chCurOf(h);
  assert.deepEqual(cur.panels.map((p) => [p.clock, p.ticks, p.level, p.time, p.caption, p.roll, p.between]), [['crew1', 2, 'below', 'Night', 'Through the market', 'Ana · Finesse · risky/standard · 4', ['A flashback to the garage']]]);
  assert.equal(h.q('#gm-ch-cap').value, '', 'the tick box is empty again'); assert.match(h.q('#gm-ch-strip').textContent, /Finesse/, 'the GM copy shows the roll line');
  chTickIt(h, 3, 'Over the rails'); chTickIt(h, 3, 'Too far');
  cur = chCurOf(h);
  assert.deepEqual(cur.panels.map((p) => p.ticks), [2, 3, 1], 'the last is cut to what was left'); assert.ok(h.br.toasts.some((t) => /Only 1 left on that leg: ticked 1, not 3/.test(t[0])));
  assert.ok(h.q('#gm-chase [data-gm="ch-tick"]').hasAttribute('disabled'), 'a full clock: no tick'); assert.match(h.q('#gm-chase').textContent, /clock is full\. Add a leg/);
  h.q('#gm-ch-legname').value = 'Land the barge'; h.q('#gm-chase [data-gm="ch-set"][data-k="legSize"][data-v="4"]').click(); h.q('#gm-chase [data-gm="ch-leg"]').click();
  cur = chCurOf(h); assert.deepEqual(cur.clocks.map((k) => [k.id, k.name, k.size]), [['crew1', 'Shake them', 6], ['crew2', 'Land the barge', 4]]);
  chTickIt(h, 1, 'Onto the barge'); assert.equal(chCurOf(h).panels[3].clock, 'crew2', 'the next tick is on the new leg');
  h.q('#gm-chase [data-gm="ch-undo"]').click(); assert.equal(chCurOf(h).panels.length, 3);
  h.press('l'); const mine = JSON.stringify(h.page._state().doc.chase); await h.save();
  assert.equal(JSON.stringify(fg.server.doc.chase), mine, 'the server holds the same chase');
  assert.ok(Object.values(fg.server.doc.capture).some((e) => e.bucket === 'r' && /^Chase: Onto the barge \(\+1\)$/.test(e.text)), 'L files the last tick');
  /* a reload draws the same chase */
  const h2 = await chPage({ fg }); h2.press('c'); assert.equal(h2.qa('#gm-ch-strip svg').length, 1); assert.match(h2.q('#gm-chase').textContent, /Land the barge/);
  /* the opposing clock: a hidden one, +1 / -1 within its size */
  h2.q('#gm-chase [data-gm="ch-end"]').click(); assert.ok(!chCurOf(h2));
  h2.q('#gm-chase [data-gm="ch-set"][data-k="opp"][data-v="hidden"]').click(); chStartFrom(h2, 'ground', { oppName: 'Reinforcements arrive' });
  assert.deepEqual(chCurOf(h2).clocks[1], { id: 'opp', name: 'Reinforcements arrive', size: 4, side: 'against', strip: false, filled: 0, hidden: true });
  h2.q('#gm-chase [data-gm="ch-opp"][data-d="1"]').click(); h2.q('#gm-chase [data-gm="ch-opp"][data-d="1"]').click(); h2.q('#gm-chase [data-gm="ch-opp"][data-d="-1"]').click();
  assert.equal(chCurOf(h2).clocks[1].filled, 1); assert.match(h2.q('#gm-chase .gm-ch-oppb').parentNode.textContent, /^Reinforcements arrive against · hidden from players.*−11\/4\+1\+2\+3$/, 'one row: the name, its bar, −1 1/4 +1 +2 +3'); assert.equal(h2.qa('#gm-chase .gm-ch-clocks li').length, 2, 'each clock once');
  await h2.save();
});

await test('19c. Show on iPad sends the player copy (no roll line, no hidden clock); while it is up every change sends it again; once something else is up, nothing goes', async () => {
  const fg = fakeGm(), h = await chPage({ fg });
  h.press('c'); h.q('#gm-chase [data-gm="ch-set"][data-k="opp"][data-v="hidden"]').click(); chStartFrom(h, null, { name: 'Night run', oppName: 'Reinforcements arrive' });
  chTickIt(h, 2, 'Through the market', 'Ana · Finesse · risky/standard · 4');
  h.q('#gm-chase [data-gm="ch-ipad"]').click(); assert.ok(await until(() => fg.server.displays.length === 1));
  const d = fg.server.displays[0], t = P.svgText(d.svg);
  assert.equal(d.kind, 'svg'); assert.equal(d.title, 'Night run'); assert.match(d.caption, /Get away 2\/6$/);
  assert.ok(t.includes('through the market') && !t.includes('finesse') && !t.includes('reinforcements'), 'the player copy: the caption, not the roll or the hidden clock');
  assert.ok(h.br.toasts.some((x) => /On the iPad: Night run\. It follows the chase/.test(x[0])));
  chTickIt(h, 1, 'Over the rails', 'Bo · Skirmish · desperate/great · 6');
  assert.ok(await until(() => fg.server.displays.length === 2), 'a tick sends it again'); const t2 = P.svgText(fg.server.displays[1].svg);
  assert.ok(t2.includes('over the rails') && !t2.includes('skirmish'));
  h.q('#gm-chase [data-gm="ch-opp"][data-d="1"]').click(); assert.ok(await until(() => fg.server.displays.length === 3), 'the opposing clock moving sends it again (hidden: it shows nothing of it)');
  assert.ok(!P.svgText(fg.server.displays[2].svg).includes('reinforcements'));
  h.q('#gm-chase [data-gm="ch-undo"]').click(); assert.ok(await until(() => fg.server.displays.length === 4), 'undo too');
  h.q('#gm-chase [data-gm="blankipad"]').click(); assert.ok(await until(() => fg.server.displays.length === 5 && fg.server.displays[4].kind === 'blank'));
  chTickIt(h, 1, 'After the clear'); await sleep(450);
  assert.equal(fg.server.displays.length, 5, 'cleared: a tick sends nothing');
  await h.save();
});

await test('19g. the chase follows the display seq, not its title: a push from another device in between stops it (and it says so); anything else this page pushes ends it; re-sends never overwrite', async () => {
  const fg = addAmbient(fakeGm()), h = await chPage({ fg });
  h.press('c'); chStartFrom(h, null, { name: 'Night run' }); chTickIt(h, 1, 'Out of the yard');
  h.q('#gm-chase [data-gm="ch-ipad"]').click(); assert.ok(await until(() => fg.server.displays.length === 1));
  chTickIt(h, 1, 'Through the market'); assert.ok(await until(() => fg.server.displays.length === 2), 'a tick sends it again');
  assert.equal(fg.server.conflicts || 0, 0);
  // another laptop puts something up with the same title: the next tick must not overwrite it
  fg.server.otherDevice({ kind: 'svg', title: 'Night run', caption: 'from the other laptop', svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><title>x</title></svg>' });
  h.br.toasts.length = 0;
  chTickIt(h, 1, 'Over the rails'); await sleep(450); await tick(); await tick();
  assert.equal(fg.server.displays.length, 2, 'nothing landed'); assert.equal(fg.server.shown.caption, 'from the other laptop', 'the other push stays');
  assert.ok(h.br.toasts.some(([m, bad]) => bad && /something else is on the iPad/i.test(m)), 'the page says so');
  chTickIt(h, 1, 'Down the steps'); await sleep(450); await tick();
  assert.equal(fg.server.displays.length, 2, 'and the strip no longer follows the chase');
  // Show on iPad starts it again; then anything else from this page ends it, whatever its title
  h.q('#gm-chase [data-gm="ch-ipad"]').click(); assert.ok(await until(() => fg.server.displays.length === 3));
  h.press('b'); h.q('[data-gm="locroll"]').click(); h.q('[data-gm="pushtext"]').click(); assert.ok(await until(() => fg.server.displays.length === 4));
  h.press('c'); chTickIt(h, 1, 'Into the canal'); await sleep(450); await tick();
  assert.equal(fg.server.displays.length, 4, 'the street description is up: a tick sends nothing');
  await h.save();
});

await test('19d. Find lists the current chase\'s panels by caption and jumps to the panel; ending a chase keeps it under Past chases, the last 10, and says what went', async () => {
  const past = {}; for (let i = 0; i < 10; i++) past['old' + i] = { id: 'old' + i, name: 'Old run ' + i, endedAt: '2026-10-0' + (i % 9 + 1) + 'T1' + i + ':00:00.000Z', panels: [], clocks: [] };
  const fg = fakeGm(); fg.server.doc = { chase: { past } };
  const h = await chPage({ fg });
  chStartFrom(h, null, { name: 'The canal run' }); chTickIt(h, 1, 'Under the footbridge'); chTickIt(h, 2, 'Into the lock gates');
  h.press('o'); h.press('k', { ctrlKey: true }); const fq = h.q('#gm-find-q'); fq.value = 'lock gates'; dispatch(fq, 'input');
  const hits = h.qa('.gm-find-hit'); assert.equal(hits.length, 1); assert.match(hits[0].textContent, /^ChaseInto the lock gates Panel 2 · Get away \+2/);
  hits[0].click(); assert.equal(h.page._state().panel, 'chase', 'Find goes to the Chase panel');
  h.q('#gm-chase [data-gm="ch-end"]').click();
  const doc = JSON.parse(JSON.stringify(h.page._state().doc)); assert.ok(!doc.chase.current); assert.equal(Object.keys(doc.chase.past).length, 10);
  const mine = Object.values(doc.chase.past).find((x) => x.name === 'The canal run'); assert.ok(mine && mine.endedAt && mine.panels.length === 2);
  assert.ok(!doc.chase.past.old0, 'the oldest went'); assert.ok(h.br.toasts.some((x) => /Kept the last 10 chases: dropped 1 older \(Old run 0\)/.test(x[0]) && x[1]));
  assert.match(h.q('#gm-chase .gm-ch-past summary').textContent, /Past chases 10/); assert.match(h.q('#gm-chase .gm-ch-pastl li').textContent, /^The canal run/);
  h.press('k', { ctrlKey: true }); const fq2 = h.q('#gm-find-q'); fq2.value = 'lock gates'; dispatch(fq2, 'input'); assert.equal(h.qa('.gm-find-hit').length, 0, 'an ended chase is not in Find');
  await h.save();
});

await test('19e. every button in the panel is a real control; nothing in it writes the campaign or the table clocks', async () => {
  const fg = fakeGm(), rig = { added: [] }, h = await chPage({ fg, api: { addClock: async (c) => { rig.added.push(c); } } });
  chStartFrom(h, null, {}); chTickIt(h, 1, 'One');
  for (const b of h.qa('#gm-chase button')) assert.equal(b.getAttribute('type'), 'button', 'no stray submit buttons');
  assert.equal(rig.added.length, 0);
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8'), sec = src.slice(src.indexOf('function chDoc()'), src.indexOf('function B68slug'));
  assert.ok(sec.length > 3000 && !/addClock|saveScene|campaign\(/.test(sec), 'the Chase panel never touches the table');
  await h.save();
});

await test('19f. the rules (BitD p.16, p.173, p.262–263): the opposing clock ticks +1/+2/+3 by consequence; both clocks full on the same tick is the tie, said and offered on End chase; the roll line starts at Finesse; a split crew shares one clock', async () => {
  const fg = fakeGm(), h = await chPage({ fg });
  h.press('c'); assert.match(h.q('#gm-chase .gm-ch-help').textContent, /^A split crew shares one clock: one Lose the Tail clock for everyone \(p\.262–263\)\.$/);
  h.q('#gm-chase [data-gm="ch-set"][data-k="size"][data-v="4"]').click(); h.q('#gm-chase [data-gm="ch-set"][data-k="opp"][data-v="shown"]').click(); chStartFrom(h, null, { name: 'The lock run', oppName: 'The Bluecoats close in' });
  assert.equal(h.q('#gm-ch-roll').value, 'Finesse · ', 'the roll line starts at Finesse'); assert.ok(h.q('#gm-chase .gm-ch-help'), 'the help line shows in play too');
  chTickIt(h, 2, 'No roll typed'); assert.ok(!('roll' in chCurOf(h).panels[0]), 'a roll line left at the default is no roll line');
  assert.equal(h.q('#gm-ch-roll').value, 'Finesse · ', 'and the next starts at Finesse again');
  h.q('#gm-chase [data-gm="ch-opp"][data-d="3"]').click(); assert.equal(chCurOf(h).clocks[1].filled, 3, 'a serious consequence is one press');
  assert.equal(h.q('#gm-ch-outcome option[selected]').getAttribute('value'), '', 'no clock full: no outcome yet'); assert.equal(h.q('#gm-chase .gm-ch-race'), null);
  chTickIt(h, 2, 'Through the lock gates', 'Ana · Finesse · risky/standard · 6'); h.q('#gm-chase [data-gm="ch-opp"][data-d="1"]').click();
  assert.match(h.q('#gm-chase .gm-ch-race').textContent, /^Both clocks filled on the same tick: they escape, but the pursuers are outside the lair \(BitD p\.16\)/);
  assert.equal(h.q('#gm-ch-outcome option[selected]').getAttribute('value'), 'tie'); assert.match(h.q('#gm-ch-outcome option[value="tie"]').textContent, /\(the clocks\)$/);
  h.q('#gm-chase [data-gm="ch-end"]').click();
  const past = Object.values(JSON.parse(JSON.stringify(h.page._state().doc.chase.past)));
  assert.equal(past.length, 1); assert.equal(past[0].outcome, 'tie'); assert.ok(h.br.toasts.some((x) => /Chase ended: The lock run: They escape, but the pursuers are outside the lair\./.test(x[0])));
  assert.match(h.q('#gm-chase .gm-ch-pastl li').textContent, /outside the lair/);
  /* the GM's own pick stands until the chase changes */
  chStartFrom(h, null, {}); h.q('#gm-ch-outcome').value = 'caught'; dispatch(h.q('#gm-ch-outcome'), 'change');
  h.q('#gm-chase [data-gm="ch-set"][data-k="level"][data-v="above"]').click(); assert.equal(h.q('#gm-ch-outcome option[selected]').getAttribute('value'), 'caught', 'a switch keeps the pick');
  h.q('#gm-chase [data-gm="ch-end"]').click();
  assert.ok(Object.values(JSON.parse(JSON.stringify(h.page._state().doc.chase.past))).some((x) => x.outcome === 'caught'));
  await h.save();
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
