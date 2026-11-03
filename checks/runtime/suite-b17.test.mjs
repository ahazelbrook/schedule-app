// Unit test for suite B17 (no browser, no network): stage then send (app/gm/stage.js, map.stage), the security level (app/gm/security.js, map.security),
// the stage bar and spotlight (app/gm/spotlight.js, face.spotlight), their seam (app/gm/panel17.js), the cue grammar's bare "reveal" and held "spotlight",
// and the registry lines. Fixtures are the invented Pelican Rooms; every GM-only string is a GM-ONLY- marker.
//   node checks/runtime/suite-b17.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const St = require(path.join(ROOT, 'app', 'gm', 'stage.js'));
const Se = require(path.join(ROOT, 'app', 'gm', 'security.js'));
const Sp = require(path.join(ROOT, 'app', 'gm', 'spotlight.js'));
const Pn = require(path.join(ROOT, 'app', 'gm', 'panel17.js'));
const F = require(path.join(ROOT, 'app', 'features.js'));
const G = require(path.join(ROOT, 'app', 'gm', 'cue-grammar.js'));
const V = require(path.join(ROOT, 'app', 'cue-verbs.js'));
const hands = await import(pathToFileURL(path.join(ROOT, 'functions', '_lib', 'assist', 'hands.js')).href);

let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const tick = () => new Promise((r) => setImmediate(r));

const ROOMS = [{ name: 'Pelican Lobby', band: 'public' }, { name: 'Pelican Vault', band: 'secure' }, { name: 'Pelican Stairs', band: 'working' }];
function stageHost(over = {}) {
  const log = { open: [], dark: 0, toasts: [], sent: [] };
  const state = { opened: [], on: true, live: '' };
  const host = {
    feature: (id) => state.on && id === 'map.stage', rooms: () => ROOMS, opened: () => state.opened.slice(), shown: (n) => n === 'Pelican Lobby',
    setOpen: (names) => { log.open.push(names.slice()); state.opened = names.slice(); log.sent.push(['open', names.slice()]); return true; },
    liveText: () => state.live, dark: () => { log.dark++; log.sent.push(['dark']); return Promise.resolve(); }, toast: (m, bad) => log.toasts.push([m, !!bad]), changed: () => {},
    ...over
  };
  return { host, log, state };
}

await test('registry: three bland GM switches, default off', () => {
  for (const id of ['map.stage', 'map.security', 'face.spotlight']) {
    const s = F.get(id); assert.ok(s, id); assert.equal(s.default, false); assert.equal(s.surface, 'gm');
    assert.doesNotMatch(s.doc + s.label, /GM-ONLY|Pelican/i);
  }
  assert.equal(F.get('map.stage').saturday, 'on'); assert.equal(F.get('map.security').saturday, 'try'); assert.equal(F.get('face.spotlight').saturday, 'on');
});

await test('2.3 staging: a staged room is on this page only; nothing is sent before Send', async () => {
  const { host, log } = stageHost(); const c = St.create(host);
  assert.equal(c.stage('Pelican Vault'), true); assert.equal(c.stage('Pelican Vault'), false, 'once');
  assert.equal(c.stage('Pelican Lobby'), false, 'its band already shows it'); assert.equal(c.stage('Nowhere'), false);
  assert.deepEqual(c.staged(), ['Pelican Vault']);
  assert.deepEqual(log.sent, [], 'no write, no push, no open before Send');
  assert.equal(c.send(), true);
  assert.deepEqual(log.open, [['Pelican Vault']]); assert.deepEqual(c.staged(), []);
});

await test('2.3 send keeps rooms already open, refuses when frozen, and Blank / Esc', async () => {
  const { host, log, state } = stageHost(); const c = St.create(host);
  state.opened = ['Pelican Stairs']; c.stage('Pelican Vault'); c.freeze();
  assert.equal(c.send(), false); assert.deepEqual(log.open, []); assert.equal(c.holding(), true);
  assert.match(c.view().badge, /^FROZEN/);
  c.freeze(); assert.equal(c.send(), true); assert.deepEqual(log.open, [['Pelican Stairs', 'Pelican Vault']]);
  assert.equal(c.esc(), false, 'nothing live: Esc does nothing'); state.live = 'the public band';
  assert.match(c.view().badge, /^LIVE: the public band/);
  assert.equal(c.esc(), true); await tick(); assert.equal(log.dark, 1); assert.equal(c.view().badge, 'BLANK');
  assert.equal(c.esc(), false, 'already blank');
});

await test('2.3 off: every call does nothing', async () => {
  const { host, log, state } = stageHost(); const c = St.create(host); state.on = false;
  assert.equal(c.stage('Pelican Vault'), false); assert.equal(c.send(), false); assert.equal(c.freeze(), false); assert.equal(await c.blank(), false); assert.equal(c.holding(), false);
  assert.deepEqual(log.sent, []);
});

await test('2.3 panel and tint ids', () => {
  const { host } = stageHost(); const c = St.create(host); c.stage('Pelican Stairs');
  const h = St.panelHtml(c.view());
  assert.match(h, /data-b17="send"/); assert.match(h, /Pelican Stairs/); assert.match(h, /Esc/);
  assert.deepEqual(St.tintIds({ rooms: ROOMS }, ['Pelican Stairs', 'Pelican Vault']), ['r1', 'r2']);
  assert.match(St.panelHtml({ staged: ['<b>x</b>'], frozen: false, blanked: false, badge: 'x' }), /&lt;b&gt;x&lt;\/b&gt;/);
});

await test('2.4 names: a security: line, or the defaults; 4 to 6 levels', () => {
  assert.deepEqual(Se.namesFrom('# Notes\n- **Security:** Sleepy > Awake > Jumpy > Frantic'), ['Sleepy', 'Awake', 'Jumpy', 'Frantic']);
  assert.deepEqual(Se.namesFrom('security: a, b, c, d, e, f, g'), ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.equal(Se.namesFrom('security: a, b, c'), null); assert.equal(Se.namesFrom('```\nsecurity: a,b,c,d\n```'), null);
  assert.equal(Se.fromPrep({ notes: [{ blocks: [{ k: 'md', src: 'x' }, { k: 'md', src: 'Security: One | Two | Three | Four | Five' }] }] }).length, 5);
  for (let n = 1; n <= 9; n++) { const d = Se.DEFAULT_NAMES(n); assert.ok(d.length >= 4 && d.length <= 6); }
  assert.equal(Se.levelCount(3), 4); assert.equal(Se.levelCount(9), 6);
});

await test('2.4 levels follow the alarm\'s segments; the tint is only on a full level', () => {
  const idx = (f, s, n) => Se.levelIndex(f, s, n);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map((f) => idx(f, 5, 5)), [0, 0, 1, 2, 3, 4]);
  assert.equal(idx(0, 6, 6), 0); assert.equal(idx(6, 6, 6), 5); assert.equal(idx(9, 6, 6), 5);
  assert.equal(Se.tintFor(0, 5), null); assert.equal(Se.tintFor(4, 5), 4); assert.equal(Se.tintFor(2, 6), 2);
  const p = Se.plan({ size: 5, filled: 2 }, null, 0);
  assert.equal(p.n, 5); assert.equal(p.name, 'Watchful'); assert.equal(p.next, 'Alert'); assert.equal(p.site, true);
  assert.equal(Se.plan({ size: 5, filled: 5 }, null, 0).next, '');
});

await test('2.4 controller: silent first reading, name for 3 s on a rise, layer on every change, GM line only', async () => {
  const log = { layers: [], shows: [] }; let filled = 0, on = true;
  const c = Se.create({ feature: () => on, alarm: () => ({ size: 5, filled }), names: () => ['Hush', 'Eyes', 'Bells', 'Hounds', 'Walls'], key: () => 'k',
    layer: (p, v) => { log.layers.push([p, v]); return Promise.resolve({}); }, show: (k, p, o) => { log.shows.push([k, p, o]); return Promise.resolve({}); } });
  filled = 3; c.tick(); assert.deepEqual(log.shows, [], 'first reading is silent');
  assert.deepEqual(log.layers, [['band.security', 2]]);
  c.tick(); assert.equal(log.layers.length, 1, 'no change, no write');
  filled = 4; c.tick();
  assert.equal(log.shows[0][0], 'spotted'); assert.deepEqual(log.shows[0][1], { text: 'Hounds' }); assert.equal(log.shows[0][2].ms, 3000);
  filled = 2; c.tick(); assert.equal(log.shows.length, 1, 'a fall shows no name'); assert.equal(log.layers.at(-1)[1], 1);
  const v = c.view(); assert.match(v.line, /next level: /);
  assert.match(Se.html(v), /next level: /); assert.doesNotMatch(Se.html(v), /sec-up/, 'a site alarm is not stepped by hand');
  on = false; filled = 5; c.tick(); assert.equal(log.shows.length, 1); assert.equal(c.view(), null);
});

await test('2.4 no site alarm: the GM steps it by hand', () => {
  const c = Se.create({ feature: () => true, alarm: () => null, names: () => null, key: () => 'k', layer: () => Promise.resolve(), show: () => Promise.resolve() });
  assert.equal(c.view().n, 5); c.tick(); assert.equal(c.step(1), true); assert.equal(c.view().name, 'Watchful'); assert.equal(c.step(-1), true); assert.equal(c.step(-1), true); assert.equal(c.view().index, 0);
  assert.match(Se.html(c.view()), /sec-up/);
});

const CAST = [
  { id: 'n1', name: 'Mabel Quist', alias: '', revealed: true }, { id: 'n2', name: 'GM-ONLY-NPC-1', alias: 'GM-ONLY-ALIAS-1', revealed: false },
  { id: 'n3', name: 'Dov Ashby', alias: '', revealed: true }, { id: 'n4', name: 'Orla Penn', alias: '', revealed: true }, { id: 'n5', name: 'Twin', alias: '', revealed: true }, { id: 'n6', name: 'Twin', alias: '', revealed: true }
];
function spotHost(over = {}) {
  const log = { holds: [], clears: 0, reveals: [], confirms: [], toasts: [] }; const st = { overlay: '', yes: true, md: '- **Who:** Mabel Quist, GM-ONLY-ALIAS-1 and Dov Ashby, Orla Penn' };
  const timers = [];
  const host = {
    feature: () => true, npcs: () => CAST, roomKey: () => 'Pelican Lobby', roomMd: () => st.md,
    hold: (id, ms) => { log.holds.push([id, ms]); st.overlay = 'b17sl-' + log.holds.length; return Promise.resolve({ ok: true }); },
    clear: () => { log.clears++; st.overlay = ''; return Promise.resolve({}); }, overlayId: () => st.overlay,
    confirm: (m) => { log.confirms.push(m); return st.yes; }, reveal: (id) => { log.reveals.push(id); CAST.find((n) => n.id === id).revealed = true; return Promise.resolve(); },
    toast: (m) => log.toasts.push(m), changed: () => {}, setTimeout: (fn, ms) => { timers.push([fn, ms]); return timers.length; }, clearTimeout: () => {}, ...over
  };
  return { host, log, st, timers };
}

await test('3.1 Who line and the bar: up to three from the room\'s Who line, editable', () => {
  assert.deepEqual(Sp.whoNames('x\n- **Who:** Mabel Quist, the porter and [[Dov Ashby]].\n'), ['Mabel Quist', 'porter', 'Dov Ashby']);
  assert.deepEqual(Sp.whoNames('```\nWho: Nobody\n```'), []);
  const { host } = spotHost(); const c = Sp.create(host); c.seed();
  assert.deepEqual(c.bar().map((n) => n.id), ['n1', 'n2', 'n3'], 'capped at three, in order');
  assert.equal(c.add('Orla Penn'), false, 'full'); c.remove('n3'); assert.equal(c.add('Orla Penn'), true); assert.deepEqual(c.bar().map((n) => n.id), ['n1', 'n2', 'n4']);
  c.remove('n4'); assert.equal(c.add('Twin'), false, 'two of one name are not guessed'); c.seed(); assert.equal(c.bar().length, 2, 'same room: edits stay');
});

await test('3.1 spotlight holds the npc overlay still; Narrator clears; a refresh re-lays before it runs out', async () => {
  const { host, log, timers } = spotHost(); const c = Sp.create(host); c.seed();
  const r = await c.spotlight('n1'); assert.equal(r.ok, true); assert.deepEqual(log.holds, [['n1', 180000]]); assert.equal(c.held(), 'n1');
  assert.equal(timers.at(-1)[1], 170000); timers.at(-1)[0](); await tick(); assert.equal(log.holds.length, 2, 're-laid');
  assert.equal(await c.narrator(), true); assert.equal(log.clears, 1); assert.equal(c.held(), ''); assert.equal(await c.narrator(), false);
  assert.match(Sp.html(c.view()), /data-b17="spot"/);
});

await test('3.1 a hidden NPC asks "Reveal and show?" first; a no shows and reveals nothing', async () => {
  const a = spotHost(); a.st.yes = false; const c = Sp.create(a.host); c.seed();
  assert.equal((await c.spotlight('n2')).ok, false); assert.match(a.log.confirms[0], /^Reveal and show\?/); assert.deepEqual(a.log.reveals, []); assert.deepEqual(a.log.holds, []);
  a.st.yes = true; assert.equal((await c.spotlight('n2')).ok, true); assert.deepEqual(a.log.reveals, ['n2']); assert.deepEqual(a.log.holds.map((h) => h[0]), ['n2']);
  CAST.find((n) => n.id === 'n2').revealed = false;
});

await test('3.1 by voice: the bar first, a name twice in the cast is not guessed', async () => {
  const { host, log } = spotHost(); const c = Sp.create(host); c.seed();
  assert.equal((await c.holdByName('Dov Ashby')).ok, true); assert.equal(log.holds.at(-1)[0], 'n3');
  const bad = await c.holdByName('Twin'); assert.equal(bad.ok, false); assert.match(bad.say, /Which Twin/);
  const off = Sp.create({ ...host, feature: () => false }); assert.equal(off.holdByName('Mabel Quist'), null);
});

await test('seam: nothing draws with all three switches off, and the panel draws each part under its own switch', () => {
  const on = { 'map.stage': false, 'map.security': false, 'face.spotlight': false };
  const p = Pn.create({ feature: (id) => !!on[id], rooms: () => ROOMS, opened: () => [], shown: () => false, setOpen: () => true, liveText: () => '', dark: () => Promise.resolve(), toast() {}, changed() {},
    alarm: () => ({ size: 5, filled: 1 }), names: () => null, key: () => 'k', layer: () => Promise.resolve(), show: () => Promise.resolve(), npcs: () => CAST, roomKey: () => 'r', roomMd: () => '', hold: () => Promise.resolve({}), clear: () => Promise.resolve(), overlayId: () => '', confirm: () => true, reveal: () => Promise.resolve() });
  assert.equal(p.active(), false); assert.equal(p.html(), '');
  on['map.security'] = true; assert.match(p.html(), /data-b17-part="security"/); assert.doesNotMatch(p.html(), /data-b17-part="stage"/);
  on['map.stage'] = true; on['face.spotlight'] = true; const h = p.html(); assert.match(h, /part="stage"/); assert.match(h, /part="spotlight"/);
  assert.doesNotMatch(h, /GM-ONLY/, 'a hidden name is not drawn in the bar unless the Who line named it');
});

await test('cue grammar: a bare "reveal" sends the staged rooms; spotlight holds with face.spotlight; the Worker takes a bare reveal only', async () => {
  const log = { stage: [], hold: [] }; let stageRet = true;
  const host = { feature: () => true, cueVerbs: () => V, toast() {}, npcs: () => CAST, doc: () => null, layer: () => Promise.resolve({}), layerValue: () => null, night: () => null,
    show: () => Promise.resolve({}), reveal: () => Promise.resolve(), keyFor: (k) => k, overlayId: () => '', clearOverlay: () => Promise.resolve(),
    stageSend: () => { log.stage.push(1); return stageRet; }, holdSpotlight: (n) => { log.hold.push(n); return Promise.resolve({ ok: true, say: n + ' is held on the iPad.' }); } };
  const g = G.create(host); g.register();
  const parse = (text) => { const rest = text.replace(/^reveal\s*/i, ''); return V.run('reveal', { id: 'reveal', word: 'reveal', text, rest, words: rest.toLowerCase().split(/\s+/).filter(Boolean), live: null, assume: true }); };
  const bare = parse('reveal'); assert.ok(bare && bare.action, 'a bare reveal parses'); assert.equal(bare.action.verb, 'reveal');
  const named = parse('reveal Dov Ashby'); assert.deepEqual(named.action.names, ['Dov Ashby']);
  assert.equal((await g.run({ type: 'cue_do', verb: 'reveal' })).ok, true); assert.equal(log.stage.length, 1);
  stageRet = null; assert.equal((await g.run({ type: 'cue_do', verb: 'reveal' })).ok, false);
  assert.equal((await g.run({ type: 'cue_do', verb: 'spotlight', names: ['Dov Ashby'] })).ok, true); assert.deepEqual(log.hold, ['Dov Ashby']);
  const ctx = (id, text) => ({ state: { clocks: [], npcs: [], pcs: [] }, lines: [{ kind: 'line', id, text }], cue: { parsed: true, cueLineId: id } });
  const v = hands.validateActions([{ type: 'cue_do', verb: 'reveal', quote: 'Blade reveal' }], ctx('l1', 'Blade reveal'));
  assert.equal(v.actions.length, 1, JSON.stringify(v.dropped)); assert.equal(v.actions[0].verb, 'reveal');
  const sp = hands.validateActions([{ type: 'cue_do', verb: 'spotlight', quote: 'Blade spotlight' }], ctx('l2', 'Blade spotlight'));
  assert.deepEqual(sp.dropped.map((d) => d.why), ['no name'], 'only reveal may go bare');
});

await test('files: bundled for the GM page only, in order', () => {
  const routes = fs.readFileSync(path.join(ROOT, 'app', 'routes.js'), 'utf8');
  for (const f of ['gm/stage.js', 'gm/security.js', 'gm/spotlight.js', 'gm/panel17.js']) {
    assert.ok(routes.includes("'" + f + "'"), f); assert.ok(fs.existsSync(path.join(ROOT, 'app', f)), f);
    assert.ok(routes.indexOf("'" + f + "'") < routes.indexOf("'gm-page.js'"), f + ' loads before the page');
    assert.ok(!/display:\s*\[[^\]]*gm\/(stage|security|spotlight|panel17)/.test(routes), 'players and the display never fetch ' + f);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
