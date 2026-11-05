// The iPad tray (the GM night rebuild, design section 6; app/gm/ipad-tray.js): what is live in one line, Send (n), Clear (0), Blank and the autopilot pill.
// No browser, no network: the pure line for every kind of thing on the iPad, then a tray mounted on a small DOM against a fake page and a fake
// W.B68GmStage. INVENTED data only (the Pelican Rooms; the cast in the fixtures).
//   node checks/runtime/gm-ipad-tray.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { MiniEl } from './minidom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

globalThis.self = globalThis;
const T = require(path.join(ROOT, 'app', 'gm', 'ipad-tray.js'));
const NOW = Date.parse('2026-11-07T21:30:00.000Z');
const at = (msAgo) => new Date(NOW - msAgo).toISOString();
const names = { npc: (id) => ({ n_lotte: 'Lotte Brand', n_mabel: 'Mabel Quist' })[id] || '', clock: (id) => (id === 'c_fuse' ? 'The Fuse' : ''), scene: (id) => (id === 'tram' ? 'Night tram' : '') };
const snap = (o) => Object.assign({ now: NOW, names }, o);
const texts = (s) => T.liveItems(snap(s)).map((x) => x.text);

await test('the stage: the ambient (auto, pinned or off), a map, an NPC, a read-aloud, a rule, a handout, the cards, lights out; only the ambient is not "up"', () => {
  assert.deepEqual(texts({ shown: { kind: 'blank' }, doc: { mode: 'auto' } }), ['Ambient scenes']);
  assert.deepEqual(texts({ shown: { kind: 'blank' }, doc: { mode: 'pin', scene: 'tram' } }), ['Night tram (pinned)']);
  assert.deepEqual(texts({ shown: { kind: 'blank' }, doc: { mode: 'off' } }), ['Ambient off']);
  assert.deepEqual(texts({ shown: null, doc: null }), ['Not known yet']);
  const k = (shown) => T.liveItems(snap({ shown, doc: {} }))[0];
  assert.deepEqual(k({ kind: 'svg', title: 'The Pelican Rooms' }), { key: 'stage', text: 'The Pelican Rooms (map)', up: true });
  assert.equal(k({ kind: 'npc', title: 'Lotte Brand' }).text, 'Lotte Brand (NPC)');
  assert.equal(k({ kind: 'text', title: 'Read aloud' }).text, 'Read aloud (read-aloud)');
  assert.equal(k({ kind: 'rule', title: 'Gather information' }).text, 'Gather information (rules)');
  assert.equal(k({ kind: 'handout', title: 'A brass key' }).text, 'A brass key (handout)');
  assert.equal(k({ kind: 'cards' }).text, 'The cards');
  assert.deepEqual(k({ kind: 'dark' }), { key: 'stage', text: 'Blank (lights out)', up: true });
  assert.equal(T.liveItems(snap({ shown: { kind: 'blank' }, doc: { mode: 'pin', scene: 'tram' } }))[0].up, false, 'the ambient is not up');
});

await test('the map from the stage API (N3): LIVE names the rooms shown, FROZEN is said, a blank map is said; the API missing changes nothing', () => {
  const shown = { kind: 'svg', title: 'The Pelican Rooms' };
  assert.equal(texts({ shown, doc: {}, stage: { staged: 0, live: 'Grand lobby, Cloakroom', frozen: false, blank: false } })[0], 'Grand lobby, Cloakroom (map)');
  assert.equal(texts({ shown, doc: {}, stage: { staged: 2, live: 'Grand lobby', frozen: true, blank: false } })[0], 'Grand lobby (map) · FROZEN');
  assert.deepEqual(texts({ shown: { kind: 'blank' }, doc: {}, stage: { staged: 0, live: '', frozen: false, blank: true } }), ['Ambient scenes', 'Map blanked']);
  assert.deepEqual(texts({ shown, doc: {}, stage: null }), ['The Pelican Rooms (map)']);
});

await test('the overlay: a clock, an NPC card, a held face, a line, the dawn and every show beat, each in its own words; one whose time is up is gone', () => {
  const ov = (o) => texts({ shown: { kind: 'blank' }, doc: { mode: 'auto', overlay: Object.assign({ id: 'o1', ms: 60000, at: at(1000) }, o) } })[1];
  assert.equal(ov({ kind: 'clock', clockId: 'c_fuse' }), 'Clock: The Fuse');
  assert.equal(ov({ kind: 'npc', npcId: 'n_lotte' }), 'Lotte Brand (card)');
  assert.equal(ov({ kind: 'npc', npcId: 'n_lotte', id: 'b17sl-1' }), 'Lotte Brand (held)', 'a spotlight hold is a held face');
  assert.equal(ov({ kind: 'text', text: 'The band stops mid-song' }), 'Line: The band stops mid-song');
  assert.equal(ov({ kind: 'fx', fx: 'dawn' }), 'Dawn');
  const beats = {
    stamp: [{ word: 'PAID' }, 'Stamp: PAID'], spotted: [{}, 'Spotted'], keyturn: [{ label: 'KEY-1' }, 'Key turn: KEY-1'], title: [{ text: 'Gala night' }, 'Title: Gala night'],
    wanted: [{ level: 2 }, 'Wanted'], ring: [{}, 'Ringing'], rolodex: [{}, 'Rolodex'], spotlight: [{}, 'Spotlight'],
    report: [{ position: 'risky', effect: 'standard' }, 'Action report: risky, standard'], aftermath: [{ step: 'heat' }, 'Aftermath: heat'], credits: [{}, 'End credits'],
    board: [{}, 'Opportunity board'], castphoto: [{}, 'Cast photo'], lair: [{ name: 'The Pelican Rooms' }, 'The lair: The Pelican Rooms'], scoretitle: [{ text: 'The Pelican Rooms' }, 'Score title: The Pelican Rooms']
  };
  assert.deepEqual(Object.keys(beats).sort(), T.BEAT_KINDS.slice().sort(), 'every beat kind has its words');
  for (const [kind, [payload, want]] of Object.entries(beats)) assert.equal(ov({ kind, payload }), want, kind);
  assert.equal(texts({ shown: { kind: 'blank' }, doc: { mode: 'auto', overlay: { id: 'o2', kind: 'spotted', ms: 4000, at: at(9000) } } }).length, 1, 'a beat whose time is up has left the line');
  assert.equal(T.liveItems(snap({ shown: { kind: 'blank' }, doc: { mode: 'auto', overlay: { id: 'o3', kind: 'spotted', ms: 4000, at: at(1000) } } }))[1].up, true);
});

await test('the lasting layers that change the picture: the flashback, the montage, the hard start, the Aftermath show; never the band\'s own (phase, faces, security, ON AIR)', () => {
  const doc = { mode: 'auto', layers: { band: { phase: 'score', security: 3, faces: [{ pcId: 'pc-nell' }], onair: true }, scene: { filter: 'flashback', layout: 'montage', mode: 'start' } } };
  assert.deepEqual(texts({ shown: { kind: 'blank' }, doc }), ['Ambient scenes', 'Flashback', 'Montage', 'Hard start']);
  assert.deepEqual(texts({ shown: { kind: 'blank' }, doc: { layers: { scene: { mode: 'aftermath' } } } }), ['Ambient scenes', 'Aftermath show']);
  assert.deepEqual(texts({ shown: { kind: 'blank' }, doc: { layers: { band: { phase: 'plan', security: 1, faces: [{ pcId: 'pc-ray' }] } } } }), ['Ambient scenes'], 'the band\'s layers are not in the line');
  const line = T.liveLine(T.liveItems(snap({ shown: { kind: 'svg', title: 'The Pelican Rooms' }, doc: { overlay: { id: 'b17sl-2', kind: 'npc', npcId: 'n_mabel', ms: 180000, at: at(500) }, layers: { scene: { filter: 'flashback' } } } })));
  assert.deepEqual(line, { text: 'The Pelican Rooms (map) · Mabel Quist (held) · Flashback', full: 'The Pelican Rooms (map) · Mabel Quist (held) · Flashback', on: true });
  assert.equal(T.liveLine(T.liveItems(snap({ shown: { kind: 'blank' }, doc: { mode: 'auto' } }))).on, false, 'only the ambient: the dot is off');
});

/* ---------- the tray on a page ---------- */
function fakeDoc() {
  const d = { defaultView: null, createElement: (t) => { const e = new MiniEl(t); e.ownerDocument = d; e.listeners = {}; e.addEventListener = (k, fn) => { (e.listeners[k] = e.listeners[k] || []).push(fn); }; e.removeEventListener = (k, fn) => { e.listeners[k] = (e.listeners[k] || []).filter((x) => x !== fn); }; return e; } };
  return d;
}
function click(box, sel) {
  const target = box.querySelector(sel); assert.ok(target, 'no ' + sel);
  const ev = { target, preventDefault() {} };
  for (const fn of box.listeners.click || []) fn(ev);
}
function page(state) {
  const calls = [];
  const api = {
    snapshot: () => snap({ shown: state.shown, doc: state.doc }),
    clear: () => { calls.push('clear'); return Promise.resolve(true); }, blank: () => { calls.push('blank'); return Promise.resolve(true); },
    openView: () => { calls.push('view'); }, ap: { view: () => state.ap || null, toggle: () => { calls.push('ap'); } }
  };
  return { api, calls };
}

await test('mounted: the live line with its dot and its full list in the title; Clear 0, Blank; Send and the autopilot pill only when there is something to show', () => {
  const st = { shown: { kind: 'svg', title: 'The Pelican Rooms' }, doc: { mode: 'auto' }, ap: null }, pg = page(st), doc = fakeDoc(), slot = doc.createElement('span');
  T.provide(pg.api); delete globalThis.B68GmStage;
  const tray = T.create({}).mount(slot), box = tray.el();
  assert.ok(box && slot.children[0] === box && box.className === 'gm-tray' && box.getAttribute('aria-label') === 'The iPad');
  assert.deepEqual(box.children.map((b) => b.getAttribute('data-tray')).filter(Boolean), ['open', 'send', 'clear', 'blank', 'ap']);
  assert.equal(box.querySelector('.gm-tray-text').textContent, 'The Pelican Rooms (map)');
  assert.ok(box.querySelector('.gm-tray-live .gm-dot').className.includes('on'), 'something is up: the dot is lit');
  assert.match(box.querySelector('[data-tray="open"]').getAttribute('title'), /^On the iPad: The Pelican Rooms \(map\)\. Opens the iPad view\.$/);
  assert.equal(box.querySelector('[data-tray="clear"]').textContent, 'Clear 0'); assert.equal(box.querySelector('[data-tray="clear"] kbd').textContent, '0');
  assert.equal(box.querySelector('[data-tray="blank"]').textContent, 'Blank');
  assert.equal(box.querySelector('[data-tray="send"]').hidden, true, 'no rooms staged: no Send');
  assert.equal(box.querySelector('[data-tray="ap"]').hidden, true, 'no autopilot: no pill');
  st.shown = { kind: 'blank' }; st.doc = { mode: 'pin', scene: 'tram' }; st.ap = { badge: 'Auto', title: 'Take over: Blade is laying clocks over the iPad.', mode: 'auto' };
  T.refresh();
  assert.equal(box.querySelector('.gm-tray-text').textContent, 'Night tram (pinned)');
  assert.ok(!box.querySelector('.gm-tray-live .gm-dot').className.includes('on'), 'only the ambient: the dot is off');
  const ap = box.querySelector('[data-tray="ap"]');
  assert.ok(!ap.hidden && ap.textContent === 'Auto' && ap.getAttribute('data-ap') === 'auto' && /Take over/.test(ap.getAttribute('title')), 'the autopilot pill: its badge, its action in the title');
  tray.destroy(); assert.equal(slot.children.length, 0, 'destroy takes it off the page');
});

await test('the taps: the line opens the iPad view (the band\'s host first, else the page), Clear and Blank call the page, the pill toggles the autopilot', () => {
  const st = { shown: { kind: 'blank' }, doc: { mode: 'auto' }, ap: { badge: 'GM', title: 'Hand back', mode: 'hold' } }, pg = page(st), doc = fakeDoc();
  T.provide(pg.api);
  const opened = [];
  const withHost = T.create({ openView: (id) => opened.push(id) }).mount(doc.createElement('span'));
  click(withHost.el(), '.gm-tray-text'); assert.deepEqual(opened, ['ipad'], 'a tap on the line opens the iPad view through the host');
  const bare = T.create({}).mount(doc.createElement('span'));
  click(bare.el(), '[data-tray="open"]'); assert.deepEqual(pg.calls, ['view'], 'without a host, the page opens it');
  click(bare.el(), '[data-tray="clear"]'); click(bare.el(), '[data-tray="blank"]'); click(bare.el(), '[data-tray="ap"]');
  assert.deepEqual(pg.calls, ['view', 'clear', 'blank', 'ap']);
  withHost.destroy(); bare.destroy();
});

await test('Send (n): shown only while rooms are staged (W.B68GmStage.state), sends through the stage API, and follows its onChange', () => {
  let staged = 0, unsubbed = 0; const sent = [], subs = [];
  globalThis.B68GmStage = { state: () => ({ staged, live: staged ? 'Grand lobby' : '', frozen: false, blank: false }), send: () => { sent.push(staged); return Promise.resolve(true); }, onChange: (fn) => { subs.push(fn); return () => { unsubbed++; }; } };
  const st = { shown: { kind: 'svg', title: 'The Pelican Rooms' }, doc: {} }, pg = page(st), doc = fakeDoc();
  T.provide(pg.api);
  const tray = T.create({}).mount(doc.createElement('span')), box = tray.el(), send = box.querySelector('[data-tray="send"]');
  assert.equal(send.hidden, true);
  staged = 2; subs.forEach((f) => f());
  assert.ok(!send.hidden && send.textContent === 'Send 2' && /2 staged rooms/.test(send.getAttribute('title')), 'two staged: Send 2');
  assert.equal(box.querySelector('.gm-tray-text').textContent, 'Grand lobby (map)', 'the map\'s LIVE line comes from the stage API');
  click(box, '[data-tray="send"]'); assert.deepEqual(sent, [2]);
  tray.destroy(); assert.equal(unsubbed, 1, 'destroy lets the stage API go');
  delete globalThis.B68GmStage;
});

await test('the contract the band reads: settingsInView is true, and a tray mounted twice is one tray', () => {
  assert.equal(T.settingsInView, true);
  const pg = page({ shown: { kind: 'blank' }, doc: {} }), doc = fakeDoc(), slot = doc.createElement('span');
  T.provide(pg.api);
  const tray = T.create({}); tray.mount(slot); tray.mount(slot);
  assert.equal(slot.children.length, 1, 'mounting again replaces, never doubles');
  tray.destroy();
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
