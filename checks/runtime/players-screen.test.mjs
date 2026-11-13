// players-screen (IP2, the players' screen: map first, behind the display setting stage.players): the pure parts and the Worker's join, no browser,
// no network, no key. Invented fixtures only; GM-ONLY- markers for anything hidden.
//   the dials        app/display/players/players.js Pure: clean, the alarm, the pick (four, the most recent first, the alarm kept), rises, where they show
//   the GM side      app/gm/players-screen.js: the public line as an offer, a new scene takes down what covers it, the scene probe, the cast notes
//   the Worker       GET /api/gm/display serves `clocks` (visible ones only) while stage.players is stored on, from the SAME statement as the
//                    switches (no new D1 call); off, the answer is byte for byte what it was
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { onRequest as displayHandler } from '../../functions/api/gm/display.js';
import { playersClocks } from '../../functions/_lib/campaign.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const req = createRequire(import.meta.url);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const P = req(path.join(ROOT, 'app', 'display', 'players', 'players.js')).Pure;
const G = req(path.join(ROOT, 'app', 'gm', 'players-screen.js'));
const L = [{ id: 'a', name: 'Lookouts', size: 4, filled: 1 }, { id: 'b', name: 'House alarm', size: 6, filled: 2 }, { id: 'c', name: 'Crowd', size: 4, filled: 0 },
  { id: 'd', name: 'The fuse', size: 8, filled: 3 }, { id: 'e', name: 'Last ferry', size: 6, filled: 0 }];

await test('dials: clean keeps the served order and drops a repeat, a nameless clock, a size past 12 and junk', () => {
  const c = P.clean(L.concat([{ id: 'a', name: 'dup', size: 4 }, { id: 'x', name: '', size: 4 }, { id: 'y', name: 'Big', size: 20 }, 'junk', { id: 'z', name: 'Over', size: 4, filled: 9 }]));
  assert.deepEqual(c.map((x) => x.id), ['a', 'b', 'c', 'd', 'e', 'z']);
  assert.equal(c[5].filled, 4, 'a fill past the size is the size');
});
await test('dials: the alarm by its name, else the one clock of its size and fill; a tie or no alarm tells nothing', () => {
  const c = P.clean(L);
  assert.equal(P.alarmId(c, { name: 'House alarm', size: 9, filled: 9 }), 'b');
  assert.equal(P.alarmId(c, { name: 'Alarm', size: 6, filled: 2 }), 'b');
  assert.equal(P.alarmId(c, { name: 'Alarm', size: 4, filled: 0 }), 'c');
  assert.equal(P.alarmId(c.concat([{ id: 'f', name: 'Twin', size: 6, filled: 2 }]), { name: 'Alarm', size: 6, filled: 2 }), '');
  assert.equal(P.alarmId(c, null), '');
});
await test('dials: four at most, the most recently changed first, a clock never seen changing by its place (the later the newer); the alarm is never the one dropped', () => {
  const c = P.clean(L);
  assert.deepEqual(P.pick(c, {}, '').map((x) => x.id), ['e', 'd', 'c', 'b']);
  assert.deepEqual(P.pick(c, { b: 1, a: 2 }, '').map((x) => x.id), ['a', 'b', 'e', 'd']);
  const p = P.pick(c, { e: 5, d: 4, c: 3, a: 2 }, 'b');
  assert.equal(p.length, 4); assert.ok(p.some((x) => x.id === 'b')); assert.ok(!p.some((x) => x.id === 'a'));
  assert.deepEqual(P.pick(c.slice(0, 2), {}, '').map((x) => x.id), ['b', 'a'], 'fewer than four: all of them');
});
await test('dials: a rise names its new segments; a new clock arrives as a rise; the first look and a resize are no rise', () => {
  const c = P.clean(L);
  const r = P.rises(c, P.clean([{ id: 'a', name: 'Lookouts', size: 4, filled: 3 }, { id: 'b', name: 'House alarm', size: 6, filled: 2 }, { id: 'z', name: 'New', size: 4, filled: 1 }, { id: 'd', name: 'The fuse', size: 6, filled: 5 }]));
  assert.deepEqual(r, { a: { segs: [1, 2], fresh: false }, z: { segs: [0], fresh: true } });
  assert.deepEqual(P.rises(null, c), {}, 'nothing swells on load');
  assert.deepEqual(P.rises(c, P.clean([{ id: 'a', name: 'Lookouts', size: 4, filled: 0 }])), {}, 'a fall is no rise');
});
await test('dials: over the map and an ambient scene; never over Blank, the hard start, a beat, the opening credits or another stage', () => {
  assert.ok(P.visible({ kind: 'svg' }) && P.visible({ kind: 'blank' }) && P.visible({}));
  for (const st of [{ kind: 'blank', ambient: 'credits' }, { kind: 'svg', dark: true }, { kind: 'dark' }, { kind: 'svg', mode: 'start' }, { kind: 'svg', beat: true }, { kind: 'handout' }, { kind: 'npc' }, { kind: 'text' }, { kind: 'rule' }, { kind: 'cards' }]) assert.ok(!P.visible(st), JSON.stringify(st));
  assert.equal(P.wedges(4).length, 4); assert.equal(P.wedges(1)[0], 'circle');
});

await test('GM: the public line becomes a kept offer with Send; Send shows it; nothing is sent until then', async () => {
  const offers = [], shown = [];
  const r = await G.offerLine({ kind: 'text', text: 'The speeches' }, (s) => offers.push(s), (o) => { shown.push(o); return 'shown'; });
  assert.equal(r, null); assert.equal(shown.length, 0, 'nothing shown by itself');
  assert.equal(offers.length, 1); assert.equal(offers[0].label, 'Send'); assert.equal(offers[0].keep, true); assert.match(offers[0].text, /The speeches/);
  assert.equal(offers[0].run(), 'shown'); assert.equal(shown[0].text, 'The speeches');
  await G.offerLine({ kind: 'text', text: '  ' }, (s) => offers.push(s)); assert.equal(offers.length, 1, 'an empty line offers nothing');
});
await test('GM: a new scene takes down what covers it (the blank push, as the opening credits do); re-picking the scene that is up does nothing; Off leaves the stage', async () => {
  const calls = [];
  const host = { shown: () => 'svg', current: () => ({ mode: 'pin', scene: 'duskwall' }), patch: (p) => { calls.push(['patch', p]); return Promise.resolve({ ok: 1 }); },
    blank: () => { calls.push(['blank']); return Promise.resolve(); }, label: () => 'x', toast() {}, fetch: () => Promise.resolve({ ok: true }) };
  await G.scene(host, { mode: 'pin', scene: 'tram' }); assert.deepEqual(calls.map((x) => x[0]), ['patch', 'blank']);
  calls.length = 0; await G.scene(host, { mode: 'auto' }); assert.deepEqual(calls.map((x) => x[0]), ['patch', 'blank'], 'Auto');
  calls.length = 0; await G.scene(host, { skip: true }); assert.deepEqual(calls.map((x) => x[0]), ['patch', 'blank'], 'Next scene');
  calls.length = 0; host.shown = () => ''; await G.scene(host, { mode: 'pin', scene: 'tram' }); assert.deepEqual(calls.map((x) => x[0]), ['patch', 'blank'], 'not known what is up: blank');
  calls.length = 0; host.shown = () => 'blank'; await G.scene(host, { mode: 'pin', scene: 'duskwall' }); assert.deepEqual(calls, [], 'the scene that is up');
  calls.length = 0; await G.scene(host, { mode: 'pin', scene: 'tram' }); assert.deepEqual(calls.map((x) => x[0]), ['patch'], 'nothing covers it: the pin alone');
  calls.length = 0; host.shown = () => 'svg'; await G.scene(host, { mode: 'off' }); assert.deepEqual(calls.map((x) => x[0]), ['patch'], 'Off');
  calls.length = 0; host.patch = (p) => { calls.push(['patch', p]); return Promise.resolve(null); }; await G.scene(host, { mode: 'pin', scene: 'tram' });
  assert.deepEqual(calls.map((x) => x[0]), ['patch'], 'a refused pin (frozen, offline) takes nothing down');
});
await test('GM: a scene file the iPad cannot load is named in a toast; one that answers says nothing', async () => {
  const toasts = [], host = { label: () => 'Night tram', toast: (m) => toasts.push(m), fetch: () => Promise.resolve({ ok: false, status: 404 }) };
  assert.equal(await G.probe(host, 'tram'), false); assert.equal(toasts.length, 1); assert.match(toasts[0], /Night tram/); assert.match(toasts[0], /404/);
  host.fetch = (url) => { assert.equal(url, 'ambient/night-tram'); return Promise.resolve({ ok: true }); };
  assert.equal(await G.probe(host, 'tram'), true); assert.equal(toasts.length, 1);
});
await test('GM: the scene files agree with the display\'s list', () => {
  const D = req(path.join(ROOT, 'app', 'display-page.js'));
  const scenes = D.Pure.AMBIENT_SCENES;
  assert.equal(Object.keys(G.FILES).length, scenes.length);
  for (const s of scenes) assert.equal(G.FILES[s.id], s.file, s.id);
});
await test('GM: the cast notes as the card, Tell: and Signature: first; nothing for an NPC with no notes', () => {
  const md = G.notesMd({ role: 'Croupier', faction: 'The Pelican Rooms', gmNotes: 'deals seconds\nTell: wary\nSignature: hip\nRelation: suspect' });
  assert.match(md, /^\*Croupier · The Pelican Rooms\*/);
  assert.ok(md.indexOf('**Tell:** wary') < md.indexOf('deals seconds') && md.indexOf('**Signature:** hip') < md.indexOf('deals seconds'));
  assert.match(md, /deals seconds\n\nRelation: suspect/);
  assert.equal(G.notesMd({ name: 'Nobody' }), '');
});
await test('GM: the card waits while the GM is typing in a field; a button does not count', () => {
  const t = G._pure.typing;
  assert.equal(t({ activeElement: { tagName: 'TEXTAREA' } }), true);
  assert.equal(t({ activeElement: { tagName: 'INPUT', type: 'text' } }), true);
  assert.equal(t({ activeElement: { tagName: 'INPUT', type: 'checkbox' } }), false);
  assert.equal(t({ activeElement: { tagName: 'BUTTON' } }), false);
  assert.equal(t({ activeElement: { tagName: 'DIV', isContentEditable: true } }), true);
  const opened = [];
  const host = { doc: { activeElement: { tagName: 'BUTTON' } }, npc: () => ({ name: 'Ada Vell', alias: 'The Dealer' }), rv: () => ({ showNpc: (n, t2) => opened.push(['rv', n, t2]) }), cast: (id) => opened.push(['cast', id]) };
  assert.equal(G.openCard(host, 'npc-ada'), true);
  assert.deepEqual(opened, [['rv', ['Ada Vell', 'The Dealer'], 'Ada Vell'], ['cast', 'npc-ada']]);
  assert.equal(G.openCard({ ...host, npc: () => null }, 'x'), false, 'no such NPC: nothing');
});
await test('GM: the Autopilot row says why, and only while on', () => {
  const kids = []; const el = { ownerDocument: { createElement: () => ({ setAttribute() {}, className: '', textContent: '', parentNode: null }) }, querySelector: () => kids[0] || null, appendChild: (k) => { k.parentNode = { removeChild: () => kids.pop() }; kids.push(k); } };
  G.apLine(el, true); assert.equal(kids.length, 1); assert.match(kids[0].textContent, /Map first: you send NPCs/);
  G.apLine(el, true); assert.equal(kids.length, 1, 'once');
  G.apLine(el, false); assert.equal(kids.length, 0);
});

await test('R4: the band\'s alarm names its table clock by id while stage.players is on (only then); the dials match by id, never by name or size when an id is there', async () => {
  const fs = await import('node:fs');
  const B = req(path.join(ROOT, 'app', 'gm', 'ball.js')), MP = req(path.join(ROOT, 'app', 'gm', 'mission-publish.js'));
  const FX = JSON.parse(fs.readFileSync(path.join(ROOT, 'checks', 'runtime', 'fixtures', 'gm', 'pelican-play-v2.json'), 'utf8'));
  const rooms = FX.zones.flatMap((z) => z.rooms), play = B.checkPlay(FX, rooms).play;
  const state = { v: 2, site: 'The Pelican Rooms', start: 0, t: B.minuteOf('22:00', '21:00'), crew: {}, open: rooms };
  const clocks = [{ id: 'c-look', name: 'Lookouts', size: 6, filled: 2 }, { id: 'c-fuse', name: play.alarm.clock, size: 6, filled: 2, hidden: false }];
  const src = (players) => ({ play, state, clocks, pcs: [], open: rooms, players });
  const off = MP.buildMission(B, src(false), 3), on = MP.buildMission(B, src(true), 3);
  assert.ok(off && off.hud.alarm && !('id' in off.hud.alarm), 'off: the hud as before');
  assert.equal(on.hud.alarm.id, 'c-fuse');
  const hid = MP.buildMission(B, { ...src(true), clocks: [{ id: 'c-fuse', name: play.alarm.clock, size: 6, filled: 2, hidden: true }] }, 3);
  assert.ok(!hid.hud.alarm, 'a hidden alarm clock is no alarm at all');
  const P2 = P.clean(clocks);
  assert.equal(P.alarmId(P2, { name: 'Alarm', size: 6, filled: 2, id: 'c-fuse' }), 'c-fuse', 'two clocks of the same size and fill: the id tells');
  assert.equal(P.alarmId(P2, { name: 'Lookouts', size: 6, filled: 2, id: 'gone' }), '', 'an id that is not up: no alarm, never a guess by name');
  assert.equal(P.alarmId(P2, { name: 'Alarm', size: 6, filled: 2 }), '', 'an old hud: the fallback, and a tie tells nothing');
  const { cleanMission } = await import('../../functions/_lib/campaign.js');
  assert.equal(cleanMission({ seq: 1, hud: { alarm: { name: 'Alarm', size: 6, filled: 2, id: 'c-fuse' } } }).hud.alarm.id, 'c-fuse', 'the server keeps the id');
  assert.ok(!('id' in cleanMission({ seq: 1, hud: { alarm: { name: 'Alarm', size: 6, filled: 2, id: 'bad id!' } } }).hud.alarm), 'a bad id is dropped');
  assert.ok(!('id' in cleanMission({ seq: 1, hud: { alarm: { name: 'Alarm', size: 6, filled: 2 } } }).hud.alarm), 'none sent, none stored');
});
await test('R1, R2: the sheet\'s paper from its first rect (a plain colour, else the paper token); the dot after 20 s without an answer', () => {
  assert.equal(P.paper('#f2ede1'), '#f2ede1'); assert.equal(P.paper('rgb(242, 237, 225)'), 'rgb(242, 237, 225)');
  assert.match(P.paper('url(#grain)'), /--b68-paper/); assert.match(P.paper(null), /--b68-paper/);
  assert.equal(P.stale(1000, 21000), false); assert.equal(P.stale(1000, 21001), true); assert.equal(P.stale(undefined, 5), false);
});

/* ---------- the Worker ---------- */
const DISPLAY = { me: { role: 'display', email: 'table@example.test' } };
async function freshDb() {
  const raw = asD1(await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') }));
  const db = { n: 0, prepare: (q) => { db.n++; return raw.prepare(q); }, batch: (l) => raw.batch(l), raw };
  return db;
}
const call = async (db, url) => {
  const r = await displayHandler({ request: new Request('http://x.test' + url, { method: 'GET' }), env: { DB: db }, data: DISPLAY, waitUntil() {} });
  return { status: r.status, text: await r.text() };
};
const CLOCKS = [{ id: 'c-alarm', name: 'GM-ONLY-ALARM', size: 6, filled: 2, hidden: true }, { id: 'c-look', name: 'Lookouts', size: 4, filled: 1 }, { name: 'No id yet', size: 5, filled: 9 }, { id: 'c-blank', name: '   ', size: 4 }];
async function withCampaign(features) {
  const db = await freshDb();
  const doc = { v: 1, clocks: CLOCKS, mission: { v: 1, seq: 3, hud: { time: '21:14', label: 'Gala night' } } };
  if (features) doc.features = features;
  await db.raw.prepare('INSERT INTO campaigns (id, updated_at, doc) VALUES (?1, ?2, ?3)').bind('default', new Date().toISOString(), JSON.stringify(doc)).run();
  return db;
}
const URL_ = '/api/gm/display?seq=-1&aseq=-1&sseq=-1&hseq=0';
const strip = (t) => t.replace(/"(now|updatedAt|at)":[^,}]+/g, '"$1":0');

await test('Worker: off (never stored, or stored off), the display GET has no clocks and is the same answer; the same number of D1 statements', async () => {
  const a = await withCampaign(null), b = await withCampaign({ 'stage.players': false });
  const ra = await call(a, URL_), rb = await call(b, URL_);
  assert.equal(ra.status, 200); assert.ok(!/"clocks"/.test(ra.text) && !/"clocks"/.test(rb.text));
  assert.ok(!/GM-ONLY/.test(ra.text) && !/Lookouts/.test(ra.text), 'no clock name at all while off');
  const c = await withCampaign({ 'stage.players': true }); c.n = 0; a.n = 0;
  await call(a, URL_); await call(c, URL_);
  assert.equal(c.n, a.n, 'on costs no extra statement: ' + a.n + ' off, ' + c.n + ' on');
});
await test('Worker: on, the visible clocks ride as `clocks` ({ id, name, size, filled }), the hidden and the nameless never; the ids filled as the page fills them', async () => {
  const db = await withCampaign({ 'stage.players': true });
  const r = await call(db, URL_), j = JSON.parse(r.text);
  assert.deepEqual(j.clocks, [{ id: 'c-look', name: 'Lookouts', size: 4, filled: 1 }, { id: 'c_2', name: 'No id yet', size: 4, filled: 4 }]);
  assert.ok(!/GM-ONLY-ALARM/.test(r.text), 'a hidden clock\'s name never leaves the server');
  const u = await call(db, '/api/gm/display?seq=' + j.seq + '&hseq=' + j.mission.hseq);
  assert.ok(/"unchanged":true/.test(u.text) && /"clocks"/.test(u.text), 'an unchanged answer still carries the clocks (a tick reaches the dials without a new display seq)');
  const noHud = await call(db, '/api/gm/display?seq=-1&aseq=-1&sseq=-1');
  assert.ok(!/"clocks"/.test(noHud.text), 'a page that does not ask for the fourth part gets the answer it always got');
});
await test('Worker: playersClocks: at most 12, hidden and nameless left out, a bad list is none', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ id: 'k' + i, name: 'Clock ' + i, size: 4, filled: i % 5 }));
  assert.equal(playersClocks(many).length, 12);
  assert.deepEqual(playersClocks('nope'), []);
  assert.deepEqual(playersClocks([{ id: 'h', name: 'Hidden', size: 4, hidden: true }]), []);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) process.exit(1);
