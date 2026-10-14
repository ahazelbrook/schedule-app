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
    B68GmConsole: C, B68GmLocation: L, setTimeout, clearTimeout, console };
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
  const server = { doc: {}, at: 0, patches: [] };
  const parts = { console: { version: 'c1', src: {}, body: FIXC.console }, campaign: { version: 'k1', src: FIXC.campaign.src || {}, body: camp || FIXC.campaign }, location: { version: 'l1', src: {}, body: { T: FIXL.T, extra: FIXL.extra } } };
  const gm = {
    pack: async () => ({ version: 'v1', parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, { version: v.version }])) }),
    packPart: async (n) => ({ part: n, version: parts[n].version, src: parts[n].src, body: parts[n].body }),
    state: async () => ({ doc: JSON.parse(JSON.stringify(server.doc)), updatedAt: 't' + server.at }),
    patchState: async (p) => { server.patches.push(p); server.doc = P.applyPatch(server.doc, p); server.at++; return { doc: JSON.parse(JSON.stringify(server.doc)), updatedAt: 't' + server.at }; },
    display: async () => ({ seq: 0 }), setDisplay: async () => ({ seq: 1 }),
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
