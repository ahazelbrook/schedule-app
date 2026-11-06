// Unit test for suite B17 (no browser, no network): stage then send (app/gm/stage.js, map.stage), the security level and the ONE alarm readout (app/gm/security.js,
// map.security), a room's people and the spotlight (app/gm/spotlight.js, face.spotlight), their seam (app/gm/panel17.js), the cue grammar's bare "reveal" and
// held "spotlight", and the registry lines. N3 (the GM night rebuild): the stage group, the readout and the people rows are drawn by the site (the Run view), and
// B68GmStage is the page's stage for the band's iPad tray. Fixtures are the invented Pelican Rooms; every GM-only string is a GM-ONLY- marker.
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
    liveText: () => state.live, dark: () => { log.dark++; log.sent.push(['dark']); state.live = ''; return Promise.resolve(); }, toast:      /* the dark: no map on the iPad */ (m, bad) => log.toasts.push([m, !!bad]), changed: () => {},
    ...over
  };
  return { host, log, state };
}

await test('registry: three bland GM switches, default off (and ON whatever is stored since N0)', () => {
  for (const id of ['map.stage', 'map.security', 'face.spotlight']) {
    const s = F.get(id); assert.ok(s, id); assert.equal(s.default, false); assert.equal(s.surface, 'gm');
    assert.doesNotMatch(s.doc + s.label, /GM-ONLY|Pelican/i);
  }
  assert.equal(F.get('map.stage').saturday, 'on'); assert.equal(F.get('map.security').saturday, 'try'); assert.equal(F.get('face.spotlight').saturday, 'on');
});

/* ---------------------------------------------------------------- 2.3 the stage ---------------------------------------------------------------- */
await test('2.3 staging: a staged room is on this page only; nothing is sent before Send', async () => {
  const { host, log } = stageHost(); const c = St.create(host);
  assert.equal(c.stage('Pelican Vault'), true); assert.equal(c.stage('Pelican Vault'), false, 'once');
  assert.equal(c.stage('Pelican Lobby'), false, 'its band already shows it'); assert.equal(c.stage('Nowhere'), false);
  assert.equal(c.canStage('Pelican Stairs'), true); assert.equal(c.canStage('Pelican Lobby'), false);
  assert.deepEqual(c.staged(), ['Pelican Vault']);
  assert.deepEqual(log.sent, [], 'no write, no push, no open before Send');
  assert.equal(c.send(), true);
  assert.deepEqual(log.open, [['Pelican Vault']]); assert.deepEqual(c.staged(), []);
});

await test('2.3 send keeps rooms already open, refuses when frozen; freeze(on) sets or flips; Blank is a button (Esc is the page\'s one Esc, N3)', async () => {
  const { host, log, state } = stageHost(); const c = St.create(host);
  state.opened = ['Pelican Stairs']; c.stage('Pelican Vault'); assert.equal(c.freeze(), true, 'no argument flips it on');
  assert.equal(c.send(), false); assert.deepEqual(log.open, []); assert.equal(c.holding(), true);
  assert.match(c.view().badge, /^FROZEN/); assert.equal(c.freeze(true), true, 'true keeps it on');
  assert.equal(c.freeze(false), false); assert.equal(c.send(), true); assert.deepEqual(log.open, [['Pelican Stairs', 'Pelican Vault']]);
  assert.equal(typeof c.esc, 'undefined', 'the stage has no Esc of its own'); state.live = 'the public band';
  assert.match(c.view().badge, /^LIVE: the public band/);
  assert.equal(await c.blank(), true); assert.equal(log.dark, 1); assert.equal(c.view().badge, 'BLANK');
  /* the review's stale BLANK: Blank, then the map goes up again another way (Show on iPad from Location) */
  state.live = 'the public band';
  assert.equal(c.view().blanked, false, 'a map live on the iPad is never blank'); assert.match(c.view().badge, /^LIVE: the public band/);
  state.live = ''; assert.equal(c.view().badge, 'BLANK', 'still blank while nothing else is up');
  assert.equal(c.unblank(), true, 'the page says something else reached the iPad'); assert.equal(c.view().badge, 'Not on the iPad'); assert.equal(c.unblank(), false, 'once');
});

await test('2.3 off: every call does nothing', async () => {
  const { host, log, state } = stageHost(); const c = St.create(host); state.on = false;
  assert.equal(c.stage('Pelican Vault'), false); assert.equal(c.send(), false); assert.equal(c.freeze(), false); assert.equal(await c.blank(), false); assert.equal(c.holding(), false);
  assert.deepEqual(log.sent, []);
});

await test('N3, the stage group in the site\'s toolbar: only while it has something to say; LIVE, Send (n), Freeze, Blank; escaped', () => {
  const { host, state } = stageHost(); const c = St.create(host);
  assert.equal(St.groupHtml(c.view()), '', 'nothing staged, not live, not frozen: no group');
  c.stage('Pelican Stairs'); c.stage('Pelican Vault');
  let h = St.groupHtml(c.view());
  assert.match(h, /data-site="send"[^>]*>Send <b>2<\/b>/); assert.match(h, /data-site="freeze" aria-pressed="false"/); assert.match(h, /data-site="blank"/); assert.match(h, /Not on the iPad/);
  assert.match(h, /title="Open the staged rooms for the players: Pelican Stairs, Pelican Vault"/);
  assert.doesNotMatch(h, /Esc/, 'Blank is not on Esc any more');
  state.live = 'the public band'; c.freeze(true); h = St.groupHtml(c.view());
  assert.match(h, /FROZEN · the public band/); assert.match(h, /data-site="send" disabled/); assert.match(h, />Unfreeze</);
  c.freeze(false); c.reset(); state.live = '<b>x</b>'; h = St.groupHtml(c.view());
  assert.match(h, /LIVE · &lt;b&gt;x&lt;\/b&gt;/); assert.doesNotMatch(h, /data-site="send"/, 'live alone: no Send');
  assert.match(St.groupHtml({ on: true, staged: ['<b>y</b>'], frozen: false, blanked: false, live: '' }), /&lt;b&gt;y&lt;\/b&gt;/);
  assert.equal(St.shows({ on: false, staged: ['a'], live: 'x' }), false, 'switch off: nothing');
  assert.deepEqual(St.tintIds({ rooms: ROOMS }, ['Pelican Stairs', 'Pelican Vault']), ['r1', 'r2'], 'Location\'s map tint ids');
});

await test('N3, B68GmStage, the page\'s stage for the band\'s iPad tray: provide, state, send, freeze, blank, onChange, notify; nothing provided is all quiet', async () => {
  const quiet = { staged: 0, live: '', frozen: false, blank: false };
  assert.deepEqual(St.state(), quiet); assert.equal(St.send(), false); assert.equal(St.freeze(true), false); assert.equal(await St.blank(), false);
  const { host, log, state } = stageHost(); const c = St.create(host); let heard = 0;
  const off = St.onChange(() => { heard++; });
  const unprovide = St.provide(c); assert.ok(heard >= 1, 'providing tells the listeners');
  c.stage('Pelican Vault'); state.live = 'the public band';
  assert.deepEqual(St.state(), { staged: 1, live: 'the public band', frozen: false, blank: false });
  const h0 = heard; c.stage('Pelican Stairs'); assert.equal(heard, h0 + 1, 'a change of the provided controller is heard');
  assert.equal(St.freeze(true), true); assert.equal(St.state().frozen, true); assert.equal(St.send(), false, 'frozen refuses');
  St.freeze(false); assert.equal(St.send(), true); assert.deepEqual(log.open.at(-1), ['Pelican Vault', 'Pelican Stairs']); assert.equal(St.state().staged, 0);
  assert.equal(await St.blank(), true); assert.equal(St.state().blank, true); assert.equal(log.dark, 1);
  const h1 = heard; St.notify(); assert.equal(heard, h1 + 1, 'notify: the page says the map on the iPad changed');
  const other = St.create(stageHost().host); const h2 = heard; other.stage('Pelican Vault'); assert.equal(heard, h2, 'a controller that is not provided is not heard');
  St.onChange(() => { throw new Error('a bad listener'); }); const h3 = heard; St.notify(); assert.equal(heard, h3 + 1, 'one listener throwing never stops the rest');
  off(); const h4 = heard; c.stage('Pelican Vault'); assert.equal(heard, h4, 'unsubscribed');
  unprovide(); assert.deepEqual(St.state(), quiet, 'unprovided: all quiet');
});

/* ---------------------------------------------------------------- 2.4 the level, the ONE alarm ---------------------------------------------------------------- */
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

await test('2.4 controller: silent first reading, name for 3 s on a rise, layer on every change; the readout and its popover are the GM\'s', async () => {
  const log = { layers: [], shows: [] }; let filled = 0, on = true;
  const c = Se.create({ feature: () => on, alarm: () => ({ size: 5, filled }), names: () => ['Hush', 'Eyes', 'Bells', 'Hounds', 'Walls'], key: () => 'k',
    layer: (p, v) => { log.layers.push([p, v]); return Promise.resolve({}); }, show: (k, p, o) => { log.shows.push([k, p, o]); return Promise.resolve({}); } });
  filled = 3; c.tick(); assert.deepEqual(log.shows, [], 'first reading is silent');
  assert.deepEqual(log.layers, [['band.security', 2]]);
  c.tick(); assert.equal(log.layers.length, 1, 'no change, no write');
  filled = 4; c.tick();
  assert.equal(log.shows[0][0], 'spotted'); assert.deepEqual(log.shows[0][1], { text: 'Hounds' }); assert.equal(log.shows[0][2].ms, 3000);
  filled = 2; c.tick(); assert.equal(log.shows.length, 1, 'a fall shows no name'); assert.equal(log.layers.at(-1)[1], 1);
  const v = c.view(); assert.match(v.line, /next level: /); assert.equal(v.size, 5); assert.equal(v.filled, 2); assert.equal(v.quiet, false);
  const r = Se.readoutHtml(v, { open: true, clock: 'GM-ONLY-CLOCK' });
  assert.match(r, /class="rv-alarm" data-rv="alarm" aria-haspopup="dialog" aria-expanded="true"/); assert.match(r, />Alarm</); assert.match(r, /<b class="rv-alevel">Eyes<\/b>/, '2 of 5 segments: the second of the five levels');
  assert.equal((r.match(/<i class="f"><\/i>/g) || []).length, 2, 'the clock\'s two filled segments'); assert.equal((r.match(/<i><\/i>/g) || []).length, 3);
  const pop = Se.popHtml(v, { clock: 'Fuse', beat: 'GM-ONLY-BEAT-2' });
  assert.match(pop, /<b>Fuse 2:<\/b> GM-ONLY-BEAT-2/); assert.match(pop, /Security <b>Eyes<\/b>/); assert.match(pop, /next level: Bells/); assert.doesNotMatch(pop, /sec-up/, 'a site alarm is not stepped by hand');
  on = false; filled = 5; c.tick(); assert.equal(log.shows.length, 1); assert.equal(c.view(), null);
});

await test('N3, a hidden site clock keeps the level off the iPad (no tint, no name; a tint already up comes down); shown again, the tint returns', async () => {
  const log = { layers: [], shows: [] }; let filled = 3, visible = true;
  const c = Se.create({ feature: () => true, alarm: () => ({ size: 5, filled, visible }), names: () => null, key: () => 'k',
    layer: (p, v) => { log.layers.push(v); return Promise.resolve({}); }, show: (k, p) => { log.shows.push(p.text); return Promise.resolve({}); } });
  c.tick(); assert.deepEqual(log.layers, [2]);
  visible = false; c.tick(); assert.deepEqual(log.layers, [2, null], 'hidden: the tint comes down once');
  filled = 4; c.tick(); assert.deepEqual(log.shows, [], 'a rise while hidden shows no name'); assert.deepEqual(log.layers, [2, null], 'and sends no tint');
  assert.equal(c.view().quiet, true); assert.equal(c.view().name, 'Hunting', 'the GM screen still follows it'); assert.match(Se.readoutHtml(c.view()), /class="rv-alarm quiet"/);
  assert.match(Se.popHtml(c.view(), {}), /hidden from the players/);
  visible = true; c.tick(); assert.deepEqual(log.layers, [2, null, 3], 'shown again: the tint goes back up, at the level it is now');
});

await test('2.4 no site alarm: the GM steps it by hand, in the readout\'s popover', () => {
  const c = Se.create({ feature: () => true, alarm: () => null, names: () => null, key: () => 'k', layer: () => Promise.resolve(), show: () => Promise.resolve() });
  assert.equal(c.view().n, 5); c.tick(); assert.equal(c.step(1), true); assert.equal(c.view().name, 'Watchful'); assert.equal(c.step(-1), true); assert.equal(c.step(-1), true); assert.equal(c.view().index, 0);
  const pop = Se.popHtml(c.view(), { gm: true, missing: 'GM-ONLY-CLOCK' });
  assert.match(pop, /data-gm="site" data-site="sec-down"[^>]*disabled/, 'at the lowest level: no lower'); assert.match(pop, /data-gm="site" data-site="sec-up"/); assert.match(pop, /No table clock is called GM-ONLY-CLOCK/);
  c.step(1); c.step(1); const r = Se.readoutHtml(c.view(), { attr: 'data-gm="site" data-site="alarm"' });
  assert.match(r, /class="rv-alarm hand" data-gm="site" data-site="alarm"/); assert.equal((r.match(/<i class="f"><\/i>/g) || []).length, 2, 'by hand: a box per level above the first'); assert.equal((r.match(/<i><\/i>/g) || []).length, 2);
  assert.deepEqual(Se.segs(null), { n: 0, filled: 0 }); assert.equal(Se.readoutHtml(null), '');
});

/* ---------------------------------------------------------------- 3.1 the people, the spotlight ---------------------------------------------------------------- */
const CAST = [
  { id: 'n1', name: 'Mabel Quist', alias: '', role: 'The house', revealed: true }, { id: 'n2', name: 'GM-ONLY-NPC-1', alias: 'GM-ONLY-ALIAS-1', revealed: false },
  { id: 'n3', name: 'Dov Ashby', alias: '', revealed: true }, { id: 'n4', name: 'Orla Penn', alias: '', revealed: true }, { id: 'n5', name: 'Twin', alias: '', revealed: true }, { id: 'n6', name: 'Twin', alias: '', revealed: true }
];
const MD = { 'Pelican Lobby': '- **Who:** Mabel Quist, GM-ONLY-ALIAS-1 and Dov Ashby', 'Pelican Vault': '- Who: Orla Penn' };
function spotHost(over = {}) {
  const log = { holds: [], clears: 0, reveals: [], confirms: [], toasts: [] }; const st = { overlay: '', yes: true, focus: 'Pelican Lobby', here: {} };
  const timers = [];
  const host = {
    feature: () => true, npcs: () => CAST, roomMd: (r) => MD[r] || '', here: (r) => st.here[r] || [], focusRoom: () => st.focus,
    hold: (id, ms) => { log.holds.push([id, ms]); st.overlay = 'b17sl-' + log.holds.length; return Promise.resolve({ ok: true }); },
    clear: () => { log.clears++; st.overlay = ''; return Promise.resolve({}); }, overlayId: () => st.overlay,
    confirm: (m) => { log.confirms.push(m); return st.yes; }, reveal: (id) => { log.reveals.push(id); CAST.find((n) => n.id === id).revealed = true; return Promise.resolve(); },
    toast: (m) => log.toasts.push(m), changed: () => {}, setTimeout: (fn, ms) => { timers.push([fn, ms]); return timers.length; }, clearTimeout: () => {}, ...over
  };
  return { host, log, st, timers };
}

await test('N3, a room\'s people: the play\'s people there now first, then the Who line, then the GM\'s own; once each, matched to the cast; a play person the cast lacks is a row without a spotlight', () => {
  assert.deepEqual(Sp.whoNames('x\n- **Who:** Mabel Quist, the porter and [[Dov Ashby]].\n'), ['Mabel Quist', 'porter', 'Dov Ashby']);
  assert.deepEqual(Sp.whoNames('```\nWho: Nobody\n```'), []);
  const rows = Sp.peopleFor({ here: [{ label: 'Dov Ashby', kind: 'guard', npc: '', moving: { to: 'Pelican Vault', inMin: 15 } }, { label: 'GM-ONLY-PERSON-1', kind: 'rival' }], md: MD['Pelican Lobby'], npcs: CAST, extra: ['n4', 'n1'] });
  assert.deepEqual(rows.map((r) => r.id || r.name), ['n3', 'GM-ONLY-PERSON-1', 'n1', 'n2', 'n4']);
  assert.equal(rows[0].kind, 'guard'); assert.equal(rows[0].here, true); assert.deepEqual(rows[0].moving, { to: 'Pelican Vault', inMin: 15 });
  assert.equal(rows[1].id, '', 'not in the cast: no id, so no spotlight'); assert.equal(rows[2].role, 'The house'); assert.equal(rows[3].revealed, false); assert.equal(rows[4].added, true);
  const h = Sp.rowsHtml(rows, { held: '' }, { room: 'Pelican Lobby', card: (r) => r.id === 'n1', face: (r) => (r.id === 'n1' ? '<svg data-face="1"></svg>' : '') });
  assert.equal((h.match(/data-site="spot"/g) || []).length, 4, 'a Spotlight per cast row'); assert.equal((h.match(/data-site="card"/g) || []).length, 1, 'Card only where there is one');
  assert.match(h, /data-site="intro" data-id="n2" disabled/, 'Introduce waits for a hidden person to be revealed'); assert.match(h, /<svg data-face="1"><\/svg>/); assert.match(h, /<span class="rv-ini">DA<\/span>/);
  assert.match(h, /data-site="who-x" data-id="n4" data-room="Pelican Lobby"/, 'only the GM\'s own additions come off'); assert.match(h, /<form class="rv-padd" data-site="who-add" data-room="Pelican Lobby">/);
  assert.match(h, /→ Pelican Vault in 15 min/); assert.match(h, /class="rv-p hidden"/);
  assert.match(Sp.rowsHtml([], {}, { room: 'x' }), /Nobody here/);
});

await test('3.1 the controller: people(room), add and remove on this page only, three added at most, an ambiguous name is not guessed', () => {
  const { host, st } = spotHost(); const c = Sp.create(host);
  assert.deepEqual(c.people('Pelican Lobby').map((r) => r.id), ['n1', 'n2', 'n3']);
  assert.equal(c.add('Pelican Lobby', 'Orla Penn'), true); assert.deepEqual(c.extras('Pelican Lobby'), ['n4']);
  assert.equal(c.add('Pelican Lobby', 'Mabel Quist'), true, 'already here: fine, nothing added'); assert.deepEqual(c.extras('Pelican Lobby'), ['n4']);
  assert.equal(c.add('Pelican Lobby', 'Twin'), false, 'two of one name are not guessed');
  st.here['Pelican Vault'] = []; assert.deepEqual(c.people('Pelican Vault').map((r) => r.id), ['n4'], 'each room its own people');
  assert.equal(c.add('Pelican Vault', 'Mabel Quist'), true); assert.equal(c.add('Pelican Vault', 'Dov Ashby'), true); assert.equal(c.add('Pelican Vault', 'GM-ONLY-ALIAS-1'), true);
  assert.equal(c.add('Pelican Vault', 'Twin'), false); assert.equal(c.remove('Pelican Vault', 'n1'), true); assert.equal(c.remove('Pelican Vault', 'n1'), false);
  assert.deepEqual(c.people('').length, 0);
});

await test('3.1 spotlight holds the npc overlay still; Take it down clears; a refresh re-lays before it runs out', async () => {
  const { host, log, timers } = spotHost(); const c = Sp.create(host);
  const r = await c.spotlight('n1'); assert.equal(r.ok, true); assert.deepEqual(log.holds, [['n1', 180000]]); assert.equal(c.held(), 'n1');
  assert.equal(timers.at(-1)[1], 170000); timers.at(-1)[0](); await tick(); assert.equal(log.holds.length, 2, 're-laid');
  const h = Sp.rowsHtml(c.people('Pelican Lobby'), c.view(), { room: 'Pelican Lobby' });
  assert.match(h, /data-site="spot" data-id="n1" aria-pressed="true"[^>]*>● On the iPad</); assert.match(h, /data-site="down"[^>]*>Take it down</);
  assert.equal(await c.narrator(), true); assert.equal(log.clears, 1); assert.equal(c.held(), ''); assert.equal(await c.narrator(), false);
});

await test('3.1 a hidden person asks "Reveal and show?" first; a no shows and reveals nothing', async () => {
  const a = spotHost(); a.st.yes = false; const c = Sp.create(a.host);
  assert.equal((await c.spotlight('n2')).ok, false); assert.match(a.log.confirms[0], /^Reveal and show\?/); assert.deepEqual(a.log.reveals, []); assert.deepEqual(a.log.holds, []);
  a.st.yes = true; assert.equal((await c.spotlight('n2')).ok, true); assert.deepEqual(a.log.reveals, ['n2']); assert.deepEqual(a.log.holds.map((h) => h[0]), ['n2']);
  CAST.find((n) => n.id === 'n2').revealed = false;
});

await test('3.1 by voice: the people of the room in focus first, a name twice in the cast is not guessed', async () => {
  const { host, log } = spotHost(); const c = Sp.create(host);
  assert.equal((await c.holdByName('Dov Ashby')).ok, true); assert.equal(log.holds.at(-1)[0], 'n3');
  const bad = await c.holdByName('Twin'); assert.equal(bad.ok, false); assert.match(bad.say, /Which Twin/);
  const off = Sp.create({ ...host, feature: () => false }); assert.equal(off.holdByName('Mabel Quist'), null);
});

await test('seam: the three controllers from one host; nothing drawn by it (the site draws them, N3); active per switch; Location\'s tint', () => {
  const on = { 'map.stage': false, 'map.security': false, 'face.spotlight': false };
  const p = Pn.create({ feature: (id) => !!on[id], rooms: () => ROOMS, opened: () => [], shown: () => false, setOpen: () => true, liveText: () => '', dark: () => Promise.resolve(), toast() {}, changed() {},
    alarm: () => ({ size: 5, filled: 1 }), names: () => null, key: () => 'k', layer: () => Promise.resolve(), show: () => Promise.resolve(), npcs: () => CAST, roomMd: () => '', here: () => [], hold: () => Promise.resolve({}), clear: () => Promise.resolve(), overlayId: () => '', confirm: () => true, reveal: () => Promise.resolve() });
  assert.equal(p.active(), false); assert.equal(p.html, undefined, 'no box html any more'); assert.equal(p.paint, undefined);
  on['map.security'] = true; assert.equal(p.active(), true);
  on['map.stage'] = true; p.stage.stage('Pelican Vault');
  const groups = [{ a: 'r0', cls: new Set() }, { a: 'r1', cls: new Set() }];
  p.tint({ querySelectorAll: () => groups.map((g) => ({ getAttribute: () => g.a, classList: { add: (c) => g.cls.add(c), remove: (c) => g.cls.delete(c) } })) }, { rooms: [{ name: 'Pelican Lobby' }, { name: 'Pelican Vault' }] });
  assert.deepEqual(groups.map((g) => [...g.cls].join()), ['', 'gm-staged']);
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

await test('files: bundled for the GM page only, in order (the site module too, N3)', () => {
  const routes = fs.readFileSync(path.join(ROOT, 'app', 'routes.js'), 'utf8');
  for (const f of ['gm/stage.js', 'gm/security.js', 'gm/spotlight.js', 'gm/panel17.js', 'gm/site.js']) {
    assert.ok(routes.includes("'" + f + "'"), f); assert.ok(fs.existsSync(path.join(ROOT, 'app', f)), f);
    assert.ok(routes.indexOf("'" + f + "'") < routes.indexOf("'gm-page.js'"), f + ' loads before the page');
    assert.ok(!/display:\s*\[[^\]]*gm\/(stage|security|spotlight|panel17|site)/.test(routes), 'players and the display never fetch ' + f);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
