// Unit test for the GM page (app/gm-page.js; no browser): its pure helpers (what may reach the iPad, replaying a console card
// exactly, saving the GM state, the Situations cards, the session on a capture) and the page itself on a small fake DOM (the
// Situations / Classic views and their toggle, the Position switch, replay after a reload, capture, the display-name editor). Invented fixtures, except two sweeps over the real pack
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

/* =====================================================================================================================
   5. Situations (phase 2): the pure parts
   ===================================================================================================================== */
const FIXC = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'console-pack.json'), 'utf8')).parts;
const FIXS = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'scenes-pack.json'), 'utf8'));
const SC = require(path.join(ROOT, 'app', 'gm', 'scenes.js')), EN = require(path.join(ROOT, 'app', 'gm', 'engagement.js'));
const FIXL = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'location-pack.json'), 'utf8'));
const mdPlain = (s) => '<p>' + String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</p>';   // the page passes B68Markdown here
const count = (s, re) => (s.match(re) || []).length;

await test('5a. conView: Situations unless this device chose Classic; the release switch off, or no situations layer, is Classic always', () => {
  assert.equal(P.conView(null, true), 'situations');
  assert.equal(P.conView('situations', true), 'situations');
  assert.equal(P.conView('classic', true), 'classic');
  assert.equal(P.conView('nonsense', true), 'situations');
  assert.equal(P.conView('situations', true, false), 'classic', 'SITUATIONS_DEFAULT = false');
  assert.equal(P.conView('situations', false), 'classic', 'a console without the layer');
  assert.equal(P.SITUATIONS_DEFAULT, true);
  assert.equal(P.VIEW_KEY, 'b68.gm.view');
});

await test('5b. keyAction: 1-4 are situations in Situations (5-9 do nothing); Classic keeps 1-9; typing and modifiers stay quiet', () => {
  for (let n = 1; n <= 4; n++) assert.deepEqual(P.keyAction({ key: String(n), view: 'situations' }), { type: 'situation', n });
  for (let n = 5; n <= 9; n++) assert.equal(P.keyAction({ key: String(n), view: 'situations' }), null);
  for (let n = 1; n <= 9; n++) { assert.deepEqual(P.keyAction({ key: String(n), view: 'classic' }), { type: 'button', n }); assert.deepEqual(P.keyAction({ key: String(n) }), { type: 'button', n }); }
  assert.equal(P.keyAction({ key: '2', view: 'situations', typing: true }), null);
  assert.equal(P.keyAction({ key: '2', view: 'situations', ctrlKey: true }), null);
  assert.equal(P.keyAction({ key: '2', view: 'classic', metaKey: true }), null);
  assert.deepEqual(P.keyAction({ key: 'l', view: 'situations' }), { type: 'last' });
  assert.deepEqual(P.keyAction({ key: 'p', view: 'situations' }), { type: 'capture', bucket: 'n' });
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
  assert.equal(P.lastText(res), 'A 1–3: ' + res.sections[0].lead);
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
    B68GmConsole: C, B68GmLocation: L, B68GmScenes: SC, B68GmEngagement: EN, setTimeout, clearTimeout, console };
  W.self = W; Object.assign(W, over || {});
  return { W, doc, ls, toasts };
}
function loadPage(W) {
  const ctx = vm.createContext(W);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8'), ctx, { filename: 'gm-page.js' });
  return W.B68GmPage;
}
/* a fake server for the GM state: the real merge, one document */
function fakeGm(camp) {
  const server = { doc: {}, at: 0, patches: [], displays: [] };
  const parts = { console: { version: 'c1', src: {}, body: FIXC.console }, campaign: { version: 'k1', src: FIXC.campaign.src || {}, body: camp || FIXC.campaign }, location: { version: 'l1', src: {}, body: { T: FIXL.T, extra: FIXL.extra } },
    scenes: { version: 's1', src: {}, body: { T: FIXS.parts.scenes.T } }, engagement: { version: 'e1', src: {}, body: { T: FIXS.parts.engagement.T } } };
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
async function openPage({ br, fg, camp, over } = {}) {
  br = br || fakeBrowser(over); fg = fg || fakeGm(); br.W.claude = { gm: fg.gm };
  const page = loadPage(br.W); const root = br.doc.createElement('div'); br.doc.body.appendChild(root);
  const cd = { current: camp === undefined ? { session: { number: 3 }, crew: {} } : camp };
  page.open(root, { ready: async () => {}, isGM: () => true, me: () => 'gm1', gm: () => fg.gm, db: () => null, campaign: () => cd.current, saveFile() {}, copy(t) { br.copied = t; } });
  const ok = await until(() => page._state() && page._state().status === 'ready' && root.querySelector('#gm-root'));
  assert.ok(ok, 'the page did not open: ' + JSON.stringify(page._state()) + ' ' + root.textContent.slice(0, 200));
  return { page, root, br, fg, press: (k, extra) => { for (const fn of br.doc.listeners.keydown || []) fn(Object.assign({ key: k, target: br.doc.body, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} }, extra || {})); },
    q: (s) => root.querySelector(s), qa: (s) => root.querySelectorAll(s), cd,
    save: async () => { await page.close(); await new Promise((r) => setTimeout(r, 20)); } };
}
const cardTxt = (h) => (h.q('#gm-card').textContent || '').replace(/\s+/g, ' ').trim();

await test('6a. the console opens on the four Situations: a big Position switch, the toggle, the single tables, no Result control', async () => {
  const h = await openPage();
  assert.equal(h.q('#gm-root').getAttribute('data-view'), 'situations');
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
  assert.deepEqual(h.qa('[data-gm="view"]').map((b) => [b.getAttribute('data-v'), b.getAttribute('aria-pressed')]), [['situations', 'true'], ['classic', 'false']]);
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

await test('6e. Classic toggle: one tap shows the nine buttons (keys 1-9, Result control, no Position switch), remembered across a reload; Situations are kept apart', async () => {
  const fg = fakeGm(), br = fakeBrowser();
  const h = await openPage({ fg, br });
  h.press('2'); const sitCard = cardTxt(h);
  h.qa('[data-gm="view"][data-v="classic"]')[0].click();
  assert.equal(h.q('#gm-root').getAttribute('data-view'), 'classic');
  assert.equal(br.ls.get('b68.gm.view'), 'classic');
  assert.equal(h.qa('#gm-buttons .gm-btn').length, 9); assert.equal(h.qa('#gm-pos [data-gm="pos"]').length, 0); assert.equal(h.qa('#gm-singles button').length, 0);
  assert.equal(h.qa('#gm-controls [data-ctl="result"]').length, 1, 'Result is back'); assert.equal(h.qa('#gm-controls [data-ctl="pos"]').length, 1);
  assert.ok(!h.q('#gm-card .gm-lead'), 'no composed card in Classic until you roll a single table');
  h.press('5'); assert.equal(h.q('#gm-card article').getAttribute('data-tool'), 'console'); assert.ok(!h.q('#gm-card .gm-lead'));
  h.press('9'); const classicCard = cardTxt(h);
  assert.equal(h.qa('#gm-earlier [data-gm="replay"]').length, 2, 'Classic history: its own two rolls');
  await h.save();
  assert.ok(fg.server.doc.cards.console && fg.server.doc.cards.situation, 'both cards kept, each under its own id');
  assert.equal(Object.keys(fg.server.doc.hist.console).length, 2); assert.equal(Object.keys(fg.server.doc.hist.situation).length, 1);
  const h2 = await openPage({ fg, br });
  assert.equal(h2.q('#gm-root').getAttribute('data-view'), 'classic', 'the choice is remembered on this device');
  assert.equal(cardTxt(h2), classicCard);
  h2.qa('[data-gm="view"][data-v="situations"]')[0].click();
  assert.equal(br.ls.get('b68.gm.view'), 'situations');
  assert.equal(h2.qa('#gm-buttons .gm-btn').length, 4);
  assert.ok(cardTxt(h2) === classicCard || cardTxt(h2) === sitCard, 'the newer of the two shows');
  await h2.save();
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

await test('6g. the release switch off (SITUATIONS_DEFAULT = false): no toggle, Classic only, even if this device remembered Situations', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  assert.ok(/var SITUATIONS_DEFAULT = true;/.test(src), 'the constant is near the top');
  const br = fakeBrowser(); br.ls.set('b68.gm.view', 'situations');
  const off = src.replace('var SITUATIONS_DEFAULT = true;', 'var SITUATIONS_DEFAULT = false;');
  const ctx = vm.createContext(br.W); vm.runInContext(off, ctx);
  const page = br.W.B68GmPage, fg = fakeGm(), root = br.doc.createElement('div'); br.doc.body.appendChild(root);
  page.open(root, { ready: async () => {}, isGM: () => true, me: () => 'gm1', gm: () => fg.gm, db: () => null, campaign: () => ({}), saveFile() {}, copy() {} });
  await until(() => page._state() && page._state().status === 'ready' && root.querySelector('#gm-root'));
  assert.equal(root.querySelectorAll('[data-gm="view"]').length, 0, 'no toggle');
  assert.equal(root.querySelectorAll('#gm-buttons .gm-btn').length, 9);
  assert.equal(root.querySelectorAll('#gm-pos [data-gm="pos"]').length, 0);
  for (const fn of br.doc.listeners.keydown) fn({ key: '7', target: br.doc.body, ctrlKey: false, altKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} });
  assert.equal(root.querySelector('#gm-card article').getAttribute('data-tool'), 'console');
  page.close();
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
  assert.ok(/^A 4\/5: /.test(r.text), r.text);
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

/* ---------- 8. the street scene roller (S) and the engagement roll (E) ---------- */
const cardOf = (h, sel) => (h.q(sel).textContent || '').replace(/\s+/g, ' ').trim();
const change = (el, v) => { el.value = String(v); dispatch(el, 'change'); };
const isObjLike = (v) => v && typeof v === 'object' && !Array.isArray(v);
const T_SC = FIXS.parts.scenes.T, T_EN = FIXS.parts.engagement.T;

await test('8a. keyAction: S opens the street scene panel and E the engagement panel (no longer reserved)', () => {
  assert.deepEqual(P.keyAction({ key: 's' }), { type: 'panel', panel: 'scenes' });
  assert.deepEqual(P.keyAction({ key: 'E' }), { type: 'panel', panel: 'engagement' });
  assert.equal(P.keyAction({ key: 's', ctrlKey: true }), null);
  assert.equal(P.keyAction({ key: 'e', typing: true }), null);
});

await test('8b. S opens the panel; Roll files the card (seed, controls, memory BEFORE the roll) and a history entry; the card has the read-aloud, ratings and grid', async () => {
  const fg = fakeGm(), h = await openPage({ fg });
  assert.ok(h.q('[data-pane="scenes"]') && h.q('[data-pane="engagement"]') && h.q('#gm-scn') && h.q('#gm-eng'));
  assert.equal(h.qa('.gm-tab').map((t) => t.getAttribute('data-panel')).join(), 'prep,rules,location,scenes,engagement,npc,cards,ipad');
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

await test('8f. E opens the engagement panel on a preview (1d, no roll yet); a control changes the pool and the preview; Roll files seed and controls', async () => {
  const fg = fakeGm(), h = await openPage({ fg });
  h.press('e'); assert.equal(h.page._state().panel, 'engagement');
  assert.equal(cardOf(h, '#gm-eng .gm-engcard h3'), 'Smash — 1d');
  assert.ok(/Set the factors, then roll\./.test(cardOf(h, '#gm-eng .gm-engcard')));
  assert.equal(h.qa('#gm-eng select').length, 2 + T_EN.factor.length);
  change(h.q('#gm-e-bold'), 1); assert.equal(cardOf(h, '#gm-eng .gm-engcard h3'), 'Smash — 2d');
  change(h.q('#gm-e-tier'), -1); change(h.q('#gm-e-bold'), -1); assert.equal(cardOf(h, '#gm-eng .gm-engcard h3'), 'Smash — 0d (2d, keep lowest)');   // B13: never "-1d"
  change(h.q('#gm-e-approach'), 'Slip'); change(h.q('#gm-e-load'), 'Loud');
  assert.ok(/opening gambit is the unwatched door · Loud loadout, load 6/.test(cardOf(h, '#gm-eng .gm-engcard')));
  h.q('[data-gm="engroll"]').click();
  const txt = cardOf(h, '#gm-eng .gm-engcard');
  assert.ok(/Slip — 0d \(2d, keep lowest\)/.test(txt) && !/-1d/.test(txt) && /0d — rolled 2, kept the lowest/.test(txt) && /Roll/.test(txt) && txt.replace(/\*\*/g, '').includes(T_EN.cut.replace(/\*\*/g, '')), txt);
  await h.save();
  const c = fg.server.doc.cards.engagement;
  assert.deepEqual(c.ui, { approach: 'Slip', load: 'Loud', mods: { bold: -1, tier: -1 } }); assert.ok(Number.isInteger(c.seed) && c.label.startsWith('Slip — 0d (2d, keep lowest) · '));
  assert.equal(Object.keys(fg.server.doc.hist.engagement).length, 1); assert.equal(c.mem, undefined);
});

await test('8g. engagement: reload redraws the identical dice; changing a control drops the stored card (not the history); Earlier brings back the roll and its controls', async () => {
  const fg = fakeGm(), br = fakeBrowser();
  const h = await openPage({ fg, br });
  h.press('e'); change(h.q('#gm-e-bold'), 1); h.q('[data-gm="engroll"]').click(); const a = cardOf(h, '#gm-eng .gm-engcard');
  change(h.q('#gm-e-tier'), 1); h.q('[data-gm="engroll"]').click(); const b = cardOf(h, '#gm-eng .gm-engcard'); assert.notEqual(a, b);
  await h.save();
  const h2 = await openPage({ fg, br });
  assert.equal(cardOf(h2, '#gm-eng .gm-engcard'), b, 'the same roll after a reload');
  const chips = h2.qa('#gm-eng [data-gm="replay"]'); assert.equal(chips.length, 2);
  chips.filter((c) => !c.hasAttribute('aria-current'))[0].click();
  assert.equal(cardOf(h2, '#gm-eng .gm-engcard'), a, 'Earlier redraws the first roll');
  change(h2.q('#gm-e-approach'), 'Charm');
  assert.equal(cardOf(h2, '#gm-eng .gm-engcard h3'), 'Charm — 2d', 'a control change shows the preview again');
  await h2.save();
  assert.equal(fg.server.doc.cards.engagement, undefined, 'the stored card went with it');
  assert.equal(Object.keys(fg.server.doc.hist.engagement).length, 2, 'the history stays');
  assert.deepEqual(fg.server.doc.eng.ui, { approach: 'Charm', load: 'Quiet', mods: { bold: 1, tier: 0 } }, 'the replayed rolls controls came back, then the new approach');
});

await test('8h. a pack without the scenes or engagement part: the panels say so and the rest of the page works', async () => {
  const fg = fakeGm(); const full = fg.gm.pack, part = fg.gm.packPart;
  fg.gm.pack = async () => { const r = await full(); delete r.parts.scenes; delete r.parts.engagement; return r; };
  const h = await openPage({ fg });
  h.press('s'); assert.ok(/no scenes part/.test(h.q('#gm-scn').textContent));
  h.press('e'); assert.ok(/no engagement part/.test(h.q('#gm-eng').textContent));
  h.press('2'); assert.ok(cardTxt(h).length > 20, 'the console still rolls');
  void part;
});

await test('8i. the missing modules (an old shell): a one-line message each, nothing thrown', async () => {
  const br = fakeBrowser({ B68GmScenes: undefined, B68GmEngagement: undefined });
  const h = await openPage({ br });
  assert.ok(/module is missing/.test(h.q('#gm-scn').textContent) && /module is missing/.test(h.q('#gm-eng').textContent));
});

/* ---------- 9. the iPad panel (I): ambient scenes, Clear and Lights out, the heat sync, the score scene ---------- */
const clone = (v) => JSON.parse(JSON.stringify(v));
/* a fake ambient on the fake GM server: the server's own merge for the keys the panel sends (skip adds one; null deletes) */
function addAmbient(fg, init) {
  const s = fg.server; s.amb = { seq: (init && init.seq) || 0, doc: clone((init && init.doc) || {}) }; s.ambPatches = []; s.ambFail = false; s.ambGets = 0; s.shown = (init && init.shown) || { kind: 'text', title: 'Invented line' };
  fg.gm.ambient = async () => { s.ambGets++; return { seq: s.amb.seq, doc: clone(s.amb.doc), updatedAt: 'a' + s.amb.seq }; };
  fg.gm.display = async () => ({ seq: 3, display: clone(s.shown), updatedAt: 'd', ambient: { seq: s.amb.seq, unchanged: true } });
  fg.gm.setDisplay = async (d) => { s.displays.push(d); s.shown = clone(d); return { seq: s.displays.length, display: d }; };
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
  assert.deepEqual(P.keyAction({ key: 'h' }), { type: 'blank' }, 'H still blanks the GM screen'); assert.deepEqual(P.keyAction({ key: '1', view: 'classic' }), { type: 'button', n: 1 });
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
  const calls = []; const rend = (roll, o) => { calls.push(o); return render(roll, o); };
  assert.throws(() => P.scoreScene(LEAKY, { layer: 'gm', view: 'plan' }, rend), /player layer/); assert.equal(calls.length, 0, 'a GM-layer request rendered nothing');
  assert.throws(() => P.scoreScene(null, { layer: 'player' }, rend), /Roll a location/);
  const s = P.scoreScene(LEAKY, { layer: 'player', reveal: { public: true } }, rend);
  assert.equal(s.view, 'rings'); assert.equal(s.rings, true, 'the plan named the hidden Basement: rings instead');
  assert.deepEqual(calls.map((c) => [c.view, c.theme, c.layer, c.legend, c.width]), [['plan', 'board', 'player', undefined, 1600], ['rings', 'board', 'player', undefined, 1600], ['iso', 'blueprint', 'player', false, 1600]]);
  assert.ok(calls.every((c) => c.reveal.join() === 'public'));
  assert.deepEqual(P.leaks(s.board, LEAKY, ['public']), []); assert.deepEqual(P.leaks(s.iso, LEAKY, ['public']), []);
  assert.deepEqual(s.score, { name: 'Invented Works', district: 'Nowhere', target: '', reveal: ['public'], view: 'rings', board: s.board, iso: s.iso });
  const clean = { name: 'Plain', district: 'D', rooms: [{ name: 'Lobby', band: 'public' }, { name: 'Hall', band: 'public' }], targetRoom: 'Lobby', targetBand: 'public' };
  const c = P.scoreScene(clean, { layer: 'player', reveal: { public: true, working: true } }, render);
  assert.deepEqual([c.view, c.rings, c.score.reveal], ['plan', false, ['public', 'working']]);
  const calls2 = []; const bad = (roll, o) => { calls2.push(o.view); return { svg: '<svg><text>Basement</text></svg>' }; };
  let err = null; try { P.scoreScene(LEAKY, { layer: 'player', reveal: { public: true } }, bad); } catch (e) { err = e; }
  assert.ok(err && err.leak && err.message === P.LEAK_MSG, 'a plan that leaks AND rings that leak: refused'); assert.deepEqual(calls2, ['plan', 'rings']);
  const isoOnly = (roll, o) => ({ svg: o.view === 'iso' ? '<svg><text>Basement</text></svg>' : '<svg><text>Lobby</text></svg>' });
  err = null; try { P.scoreScene(LEAKY, { layer: 'player', reveal: { public: true } }, isoOnly); } catch (e) { err = e; }
  assert.ok(err && err.leak, 'a leaking iso is refused, not redrawn');
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

await test('10a. the laptop layout: body.gm-app while open, the top bar (session, iPad, listening), the menu, F for Focus with the console as its keys, Classic layout on this device', async () => {
  const fg = fakeGm(), br = fakeBrowser(); const h = await openPage({ fg, br, camp: CAMP3 });
  assert.ok(br.doc.body.classList.contains('gm-app'), 'on while the tools are open');
  assert.equal(h.q('#gm-bar-sess').textContent, 'Session 3');
  await until(() => /^iPad: /.test(h.q('#gm-bar-ipad').textContent)); assert.match(h.q('#gm-bar-ipad').textContent, /^iPad: /);
  assert.ok(/Clear → ambient/.test(h.q('.gm-bar [data-gm="blankipad"]').textContent) && h.q('.gm-bar [data-gm="darkipad"]'), 'Clear and Lights out in the bar');
  assert.equal(h.qa('.gm-bar .gm-save').length, 1, 'saving shows in the bar');
  assert.equal(h.q('.gm-menu-list').hasAttribute('hidden'), true, 'the menu starts shut');
  h.q('[data-gm="menu"]').click(); assert.equal(h.q('.gm-menu-list').hasAttribute('hidden'), false); assert.equal(h.q('[data-gm="menu"]').getAttribute('aria-expanded'), 'true');
  assert.ok(['note', 'update', 'layout-classic', 'forget'].every((a) => h.q('.gm-menu-list [data-gm="' + a + '"]')), 'export, update, classic and forget are in it');
  h.q('[data-gm="menu"]').click(); assert.equal(h.q('.gm-menu-list').hasAttribute('hidden'), true, 'a second press shuts it');
  h.q('[data-gm="menu"]').click(); h.press('Escape'); assert.equal(h.q('.gm-menu-list').hasAttribute('hidden'), true, 'Escape shuts it');
  assert.equal(h.qa('#gm-mini button').length, 4, 'the console as its four keys');
  h.press('f'); assert.ok(h.q('#gm-root').classList.contains('focus')); assert.equal(h.q('[data-gm="focus"]').getAttribute('aria-pressed'), 'true');
  assert.equal(br.ls.get('b68.gm.prepWide'), '1', 'remembered on this device');
  h.qa('#gm-mini button')[0].click(); await until(() => fg.server.patches.some((p) => p.cards && p.cards.situation));
  assert.ok(fg.server.patches.some((p) => p.cards && p.cards.situation), 'a key in Focus rolls');
  h.q('[data-gm="focus"]').click(); assert.ok(!h.q('#gm-root').classList.contains('focus'), 'the button turns it off');
  h.q('[data-gm="menu"]').click(); h.q('.gm-menu-list [data-gm="layout-classic"]').click();
  assert.ok(!br.doc.body.classList.contains('gm-app') && br.ls.get('b68.gm.layout') === 'classic', 'Classic layout: off, and remembered');
  assert.equal(h.q('.gm-menu-list').hasAttribute('hidden'), true, 'the menu shuts after an item');
  h.q('.gm-head [data-gm="layout-app"]').click(); assert.ok(br.doc.body.classList.contains('gm-app') && !br.ls.has('b68.gm.layout'), 'Laptop layout brings it back');
  await h.save();
  assert.ok(!br.doc.body.classList.contains('gm-app'), 'off once the page closes');
});
await test('10b. the rail: an empty box is one line; Classic layout survives a reopen', async () => {
  const br = fakeBrowser(); br.ls.set('b68.gm.layout', 'classic'); const h = await openPage({ br, camp: CAMP3 });
  assert.ok(!br.doc.body.classList.contains('gm-app'), 'classic chosen: the old layout');
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

await test('11c. packLosses: a part gone, a prep note gone or much shorter; growth is fine', () => {
  const note = (rel, n) => ({ id: rel, rel, blocks: [{ src: 'x'.repeat(n) }] });
  const before = { prep: { notes: [note('S/b68g-s02.md', 44000)] }, scenes: { T: { a: 'y'.repeat(5000) } } };
  assert.deepEqual(P.packLosses(before, JSON.parse(JSON.stringify(before))), []);
  assert.deepEqual(P.packLosses(before, { scenes: before.scenes }), ['the prep part is gone (no note has gm_prep: true now)']);
  const r = P.packLosses(before, { prep: { notes: [note('S/b68g-s02.md', 19000)] }, scenes: before.scenes });
  assert.ok(r.some((x) => /prep note b68g-s02 shrank from 44000 to 19000 characters/.test(x)), JSON.stringify(r));
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

await test('11h. Update pack: a file that would lose a part says so, the button reads Upload anyway, and it asks before uploading', async () => {
  let asked = 0, uploads = 0;
  const br = fakeBrowser({ FileReader: class { readAsText(f) { this.result = f.text; this.onload(); } }, confirm: () => { asked++; return false; } });
  const fg = fakeGm(); fg.gm.importPart = async () => { uploads++; return { version: 'x' }; };
  const h = await openPage({ br, fg, camp: CAMP3 });
  h.q('.gm-head [data-gm="update"]').click();
  const pk = { format: 1, exportedAt: new Date().toISOString(), parts: { console: { src: {}, ...FIXC.console }, location: { src: {}, T: FIXL.T, extra: FIXL.extra }, campaign: { src: {}, ...FIXC.campaign } } };
  const file = h.q('#gm-file'); file.files = [{ name: 'b68-gm-pack.json', text: JSON.stringify(pk) }]; file.id = 'gm-file';
  dispatch(file, 'change');
  assert.ok(await until(() => h.q('.gm-losses')), 'the losses box');
  assert.ok(/the scenes part is gone/.test(h.q('.gm-losses').textContent) && /the engagement part is gone/.test(h.q('.gm-losses').textContent));
  assert.equal(h.q('[data-gm="upload"]').textContent, 'Upload anyway');
  h.q('[data-gm="upload"]').click(); await tick();
  assert.equal(asked, 1); assert.equal(uploads, 0, 'refused at the question: nothing uploaded');
  await h.save();
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
