// Suite B26, tickets 2.8, 4.4 and 4.3 (switches map.montage, room.duck, room.music; no browser, no network, no key): the montage layer through the real
// Worker handlers on in-memory SQLite, the montage controller and the iPad's panels, the duck, and the heat-state music engine against a fake clock and a fake
// audio host. INVENTED data only (the Pelican Rooms cast); every GM-only string is a GM-ONLY- marker. Nothing here plays a sound or reaches a service.
//   node checks/runtime/suite-b26.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { onRequest as ambientHandler } from '../../functions/api/gm/ambient.js';
import { onRequest as displayHandler } from '../../functions/api/gm/display.js';
import { cleanLayerOp, LAYER_PATHS, showTexts } from '../../functions/_lib/show.js';
import { MiniEl } from './minidom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const req = createRequire(import.meta.url);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const F = req(path.join(ROOT, 'app', 'features.js'));
const Mt = req(path.join(ROOT, 'app', 'gm', 'montage.js'));
const Show = req(path.join(ROOT, 'app', 'gm', 'show.js'));
const Layers = req(path.join(ROOT, 'app', 'display', 'layers.js'));
const DM = req(path.join(ROOT, 'app', 'display', 'montage.js'));
const RA = req(path.join(ROOT, 'app', 'display', 'room-audio.js'));
const ST = req(path.join(ROOT, 'app', 'stt.js'));
const Routes = (() => { const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', 'routes.js'), 'utf8'), ctx, { filename: 'routes.js' }); return ctx.window.B68Load; })();

const GM = { me: { role: 'gm', email: 'gm@example.test' } }, DISPLAY = { me: { role: 'display', email: 'table@example.test' } };
/* the Worker handlers are called exactly as checks/runtime/show-contract.test.mjs calls them */
async function freshDb() {
  const raw = asD1(await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') }));
  return { n: 0, sql: [], prepare(q) { this.n++; return raw.prepare(q); }, batch: (list) => raw.batch(list), raw };
}
const call = async (db, handler, method, url, body, who = GM) => {
  try { return await handler({ request: new Request('http://x.test' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env: { DB: db }, data: who, waitUntil() {} }); }
  catch (e) { if (e && Number.isInteger(e.status)) return new Response(JSON.stringify({ error: e.message }), { status: e.status }); throw e; }
};
const patch = async (db, body, who) => { const r = await call(db, ambientHandler, 'PATCH', '/api/gm/ambient', body, who); return { status: r.status, body: await r.json() }; };
const getDisplay = async (db, q = '', who = DISPLAY) => { const r = await call(db, displayHandler, 'GET', '/api/gm/display' + q, undefined, who); return { status: r.status, body: await r.json() }; };
async function addNpc(db, id, doc) {
  const now = new Date().toISOString();
  await db.raw.prepare('INSERT INTO npcs (id, campaign, created_at, updated_at, deleted, doc) VALUES (?1, ?2, ?3, ?3, 0, ?4)').bind(id, 'default', now, JSON.stringify(doc)).run();
}
const CAST = {
  'n-lotte': { name: 'Lotte Brand', role: 'Doorwoman', faction: 'The Kestrel Club', revealed: true },
  'n-hid': { name: 'GM-ONLY-NPC-1', alias: 'GM-ONLY-ALIAS-1', role: 'GM-ONLY-ROLE-1', faction: 'The Tidewater Watch', revealed: false, gmNotes: 'GM-ONLY-NOTES' },
};
async function withCast() { const db = await freshDb(); for (const [id, d] of Object.entries(CAST)) await addNpc(db, id, d); return db; }
const POLL = '?seq=-1&aseq=-1&sseq=-1';

/* ---- the switches ---- */
await test('switches: three, bland text, the right surfaces; the iPad ones are display lines; room.music is a setting (off until chosen), the other two always on (N0)', () => {
  const want = { 'map.montage': 'gm', 'room.duck': 'display', 'room.music': 'display' };
  for (const [id, surface] of Object.entries(want)) {
    const s = F.get(id); assert.ok(s, id); assert.equal(s.surface, surface); assert.equal(s.default, false); assert.equal(F.valueOf({}, id), id !== 'room.music', id + (id === 'room.music' ? ': a setting, off until chosen' : ': on with nothing stored')); assert.equal(F.isSetting(id), id === 'room.music', id);
    assert.ok(s.doc.length > 40 && s.label.length > 3);
  }
  assert.equal(F.get('map.montage').saturday, 'try'); assert.equal(F.get('room.duck').saturday, 'try'); assert.equal(F.get('room.music').saturday, 'off');
  assert.match(F.get('room.duck').doc, /speaker away from the puck/);
  assert.deepEqual(F.cleanPublic({ 'map.montage': true, 'room.duck': true, 'room.music': true }), { 'room.duck': true, 'room.music': true }, 'a GM-only id never reaches the iPad');
});

/* ---- 2.8: the contract ---- */
const P = (pcId, extra) => ({ pcId, name: pcId, room: 'The bar', line: 'A line', ...(extra || {}) });
await test('contract: data.montage is a path; two to four panels, rebuilt from named keys, bounded; a bad shape is 400-able', () => {
  assert.ok(LAYER_PATHS.includes('data.montage'));
  const ok = cleanLayerOp({ path: 'data.montage', value: { panels: [P('pc-nell', { junk: 1, done: true }), P('pc-ivo'), P('pc-tam', { line: '  spaced   out ' })] } });
  assert.deepEqual(ok.value.panels[0], { pcId: 'pc-nell', name: 'pc-nell', room: 'The bar', line: 'A line', done: true });
  assert.equal(ok.value.panels[2].line, 'spaced out');
  assert.deepEqual(cleanLayerOp({ path: 'data.montage', value: null }), { path: 'data.montage', value: null }, 'null clears it');
  const bad = [{ panels: [P('a')] }, { panels: ['a', 'b'].map((x) => P(x)).concat(['c', 'd', 'e'].map((x) => P(x))) }, { panels: [P('a'), P('a')] }, { panels: [P('a'), { name: 'x' }] },
    { panels: [P('a'), P('b', { line: 'x'.repeat(101) })] }, { panels: [P('a'), P('b', { room: 'x'.repeat(61) })] }, { panels: [P('a'), P('b', { name: 'x'.repeat(41) })] },
    { panels: [P('a'), P('b', { done: 'yes' })] }, { panels: [P('a'), P('b')], extra: 1 }, { panels: 'no' }, 'no', [], { panels: [P('bad id'), P('b')] }];
  for (const v of bad) assert.throws(() => cleanLayerOp({ path: 'data.montage', value: v }), /montage|panel|pcId|too long|must be/, JSON.stringify(v).slice(0, 60));
});
await test('contract: the GM page checks the same shape before it sends (gm/show.js)', () => {
  const sh = Show.make({ send: () => Promise.resolve({}), toast: () => {} });
  assert.ok(Show.layerOk('data.montage', { panels: [P('a'), P('b')] }));
  for (const v of [{ panels: [P('a')] }, { panels: [P('a'), P('a', { junk: 1 })] }, { panels: [P('a'), P('b', { line: 'x'.repeat(101) })] }, { panels: [P('a'), P('b', { done: 1 })] }, 'x']) assert.ok(!Show.layerOk('data.montage', v));
  assert.ok(Show.layerOk('scene.layout', 'montage')); void sh;
  assert.deepEqual(Show.texts('', null, 'data.montage', { panels: [] }), []);
});
await test('secrecy at write: showTexts carries every panel string, so the server scans them for hidden names', () => {
  const t = showTexts(null, { path: 'data.montage', value: { panels: [P('a', { line: 'GM-ONLY-NPC-1 waits' }), P('b', { room: 'The cellar' })] } });
  assert.ok(t.includes('GM-ONLY-NPC-1 waits') && t.includes('The cellar') && t.includes('a'), JSON.stringify(t));
});

/* ---- 2.8: the real handlers ---- */
await test('handlers: a montage is stored and served to the iPad as set; a hidden NPC named in a line or a place is 400 with no leak; a revealed name is fine; null clears it', async () => {
  const db = await withCast();
  const good = { panels: [P('pc-nell', { line: 'Chatting with Lotte Brand' }), P('pc-ivo', { done: true })] };
  let r = await patch(db, { layer: { path: 'data.montage', value: good } }); assert.equal(r.status, 200, JSON.stringify(r.body));
  r = await patch(db, { layer: { path: 'scene.layout', value: 'montage' } }); assert.equal(r.status, 200);
  const g = (await getDisplay(db, POLL)).body;
  assert.deepEqual(g.layers.data.montage, { panels: [{ pcId: 'pc-nell', name: 'pc-nell', room: 'The bar', line: 'Chatting with Lotte Brand' }, { pcId: 'pc-ivo', name: 'pc-ivo', room: 'The bar', line: 'A line', done: true }] });
  assert.equal(g.layers.scene.layout, 'montage');
  for (const bad of [{ panels: [P('pc-nell', { line: 'gm-only-npc-1 is here' }), P('pc-ivo')] }, { panels: [P('pc-nell'), P('pc-ivo', { room: 'Where GM-ONLY-ALIAS-1 sleeps' })] }, { panels: [P('pc-nell', { name: 'GM-ONLY-NPC-1' }), P('pc-ivo')] }]) {
    const x = await patch(db, { layer: { path: 'data.montage', value: bad } });
    assert.equal(x.status, 400, JSON.stringify(bad)); assert.ok(!JSON.stringify(x.body).includes('GM-ONLY'), 'the error never repeats the hidden name');
  }
  assert.equal((await patch(db, { layer: { path: 'data.montage', value: { panels: [P('pc-nell')] } } })).status, 400, 'one panel');
  assert.ok(!JSON.stringify((await getDisplay(db, POLL)).body).includes('GM-ONLY'), 'nothing GM-only is served');
  r = await patch(db, { layer: { path: 'data.montage', value: null } }); assert.equal(r.status, 200);
  assert.ok(!(await getDisplay(db, POLL)).body.layers || !('montage' in ((await getDisplay(db, POLL)).body.layers.data || {})));
});
await test('handlers: with no montage set the display answer is byte-identical to one that never had the path', async () => {
  const db = await withCast(); await patch(db, { layer: { path: 'band.phase', value: 'plan' } });
  const before = JSON.stringify((await getDisplay(db, POLL)).body);
  await patch(db, { layer: { path: 'data.montage', value: { panels: [P('a'), P('b')] } } }); await patch(db, { layer: { path: 'data.montage', value: null } });
  assert.ok(before.length > 0);
  const after = (await getDisplay(db, POLL)).body; assert.deepEqual(after.layers, { band: { phase: 'plan' } }, 'only the layer that is set is served');
});

/* ---- 2.8: the iPad ---- */
const doc = { createElement: (t) => new MiniEl(t) };
await test('iPad: B68Layers.clean carries the montage; b68:data to the scenes is unchanged; unset is []', () => {
  const lay = { data: { montage: { panels: [P('pc-nell'), P('pc-ivo', { done: true }), { pcId: 'bad id' }] } } };
  const c = Layers.clean(lay);
  assert.equal(c.montage.length, 2); assert.equal(c.montage[1].done, true);
  assert.deepEqual(Layers.clean(null).montage, []);
  assert.deepEqual(Layers.clean({ data: { montage: { panels: [P('only')] } } }).montage, [], 'one panel is no montage');
  assert.ok(!('montage' in Layers.message(c)), 'a scene is never sent the montage');
  assert.deepEqual(Object.keys(Layers.message(Layers.clean(null))).sort(), ['countdown', 'credits', 'faces', 'filter', 'layout', 'mode', 'onair', 'phase', 'previously', 'security', 'type']);
});
await test('iPad: paint draws one panel per character (initial, place, line), a stamp on a resolved one, text by textContent; unset removes it; unchanged keeps the node', () => {
  const box = new MiniEl('div');
  assert.equal(DM.paint(box, [], doc), null); assert.equal(box.children.length, 0, 'unset draws nothing');
  const n = DM.paint(box, [{ pcId: 'pc-nell', name: 'Nell <b>', room: 'The bar', line: 'Hello' }, { pcId: 'pc-ivo', name: 'Ivo', room: '', line: '', done: true }, { pcId: 'pc-tam', name: 'Tam' }], doc);
  assert.equal(box.children.length, 1); assert.match(n.className, /dp-montage-3/);
  assert.equal(n.children.length, 3); assert.match(n.outerHTML, /RESOLVED/); assert.ok(!/<b>/.test(n.outerHTML), 'escaped');
  assert.equal(n.children[0].children[0].textContent, 'N');
  assert.equal(DM.paint(box, [{ pcId: 'pc-nell', name: 'Nell <b>', room: 'The bar', line: 'Hello' }, { pcId: 'pc-ivo', name: 'Ivo', room: '', line: '', done: true }, { pcId: 'pc-tam', name: 'Tam' }], doc), n, 'same data, same node');
  DM.paint(box, [{ pcId: 'a', name: 'A' }, { pcId: 'b', name: 'B' }], doc); assert.equal(box.children.length, 1); assert.match(box.children[0].className, /dp-montage-2/);
  DM.paint(box, null, doc); assert.equal(box.children.length, 0);
  assert.ok(DM.FIXTURE.length >= 2 && DM.FIXTURE.length <= 4);
});

/* ---- 2.8: the controller ---- */
function mtHost(over) {
  const calls = [], logs = [], toasts = [], flags = { 'map.montage': true };
  const h = { calls, logs, toasts, flags, known: ['The bar', 'The cellar'], crewRoom: '', overVal: over === undefined ? true : over,
    on: (id) => flags[id] === true, pcs: () => [{ id: 'pc-nell', name: 'Nell' }, { id: 'pc-ivo', name: 'Ivo' }, { id: 'pc-tam', name: 'Tam' }, { id: 'pc-oz', name: 'Oz' }, { id: 'pc-pim', name: 'Pim' }],
    rooms: () => h.known, over: () => h.overVal, room: () => h.crewRoom, layer: (p, v) => { calls.push([p, v]); return Promise.resolve({ ok: true }); }, log: (t) => logs.push(t), toast: (m, bad) => toasts.push([m, !!bad]) };
  return h;
}
await test('montage: off sends nothing; two to four are needed; five is refused; split sends the layer then scene.layout', async () => {
  const h = mtHost(), c = Mt.make(h);
  h.flags['map.montage'] = false; assert.equal(c.pick('pc-nell', true), false); assert.equal(await c.split(), false); assert.deepEqual(h.calls, []);
  h.flags['map.montage'] = true;
  c.pick('pc-nell', true); assert.equal(await c.split(), false, 'one is not a montage'); assert.deepEqual(h.calls, []);
  c.pick('pc-ivo', true); c.pick('pc-tam', true); c.pick('pc-oz', true); assert.equal(c.pick('pc-pim', true), false, 'a fifth is refused');
  c.setRoom('pc-nell', 'The bar'); c.setLine('pc-nell', 'Waiting'); c.setRoom('pc-ivo', 'The cellar');
  assert.equal(await c.split(), true);
  assert.deepEqual(h.calls.map((x) => x[0]), ['data.montage', 'scene.layout']); assert.equal(h.calls[1][1], 'montage');
  assert.equal(h.calls[0][1].panels.length, 4); assert.deepEqual(h.calls[0][1].panels[0], { pcId: 'pc-nell', name: 'Nell', room: 'The bar', line: 'Waiting' });
  for (const p of h.calls[0][1].panels) assert.ok(Show.layerOk('data.montage', { panels: [p, p.pcId === 'pc-ivo' ? { pcId: 'x' } : { pcId: 'y' }] }), 'each panel passes gm/show.js');
  assert.ok(Show.layerOk('data.montage', h.calls[0][1]));
  assert.ok(c.active());
});
await test('montage secrecy: a place the players do not know is refused and never sent; a stale one is dropped at send time', async () => {
  const h = mtHost(), c = Mt.make(h);
  c.pick('pc-nell', true); c.pick('pc-ivo', true);
  assert.equal(c.setRoom('pc-nell', 'GM-ONLY-vault'), false); assert.match(h.toasts.pop()[0], /not seen that place/);
  c.setRoom('pc-ivo', 'The cellar'); await c.split();
  h.known = ['The bar'];                                        /* the cellar is closed again */
  await c.update();
  const last = h.calls.filter((x) => x[0] === 'data.montage').pop()[1];
  assert.ok(!JSON.stringify(h.calls).includes('GM-ONLY'), 'no GM-ONLY text anywhere on the wire');
  assert.deepEqual(last.panels.map((p) => p.room), [undefined, undefined]);
  assert.deepEqual(c.view().rooms, ['The bar'], 'only known rooms are offered');
});
await test('montage: a marked roll resolves the Rolling panel, else the one in the crew room, else the only open one; collapse clears both layers', async () => {
  const h = mtHost(), c = Mt.make(h);
  ['pc-nell', 'pc-ivo', 'pc-tam'].forEach((i) => c.pick(i, true)); c.setRoom('pc-ivo', 'The cellar'); await c.split();
  assert.equal(await c.marked(), false, 'three open, none clearly the roller: nothing guessed');
  h.crewRoom = 'The cellar'; assert.equal(await c.marked(), true);
  assert.equal(h.calls.filter((x) => x[0] === 'data.montage').pop()[1].panels.filter((p) => p.done).map((p) => p.pcId).join(), 'pc-ivo');
  c.focus('pc-tam'); assert.equal(await c.marked(), true);
  assert.equal(h.calls.filter((x) => x[0] === 'data.montage').pop()[1].panels.filter((p) => p.done).length, 2);
  assert.equal(await c.marked(), true, 'one open panel left: it is the one');
  assert.equal(await c.marked(), false, 'all resolved');
  assert.equal(await c.collapse(), true); assert.equal(c.active(), false);
  assert.deepEqual(h.calls.slice(-2), [['data.montage', null], ['scene.layout', null]]);
  assert.equal(await c.collapse(), false, 'collapsing twice sends nothing');
  assert.equal(await c.marked(), false, 'a roll marked with no montage up does nothing');
});
await test('montage budget: the button is there whatever the budget says; the view says which', () => {
  for (const [over, word] of [[true, 'past'], [false, 'within'], [null, 'No budget']]) {
    const h = mtHost(over), c = Mt.make(h), box = new MiniEl('div');
    assert.equal(c.view().over, over); c.render(box); assert.match(box.innerHTML, new RegExp(word)); assert.match(box.innerHTML, /data-mt="split"/);
  }
});

/* ---- 4.4 / 4.3: the engine ---- */
const clock = (t0 = 1000000) => { const c = { t: t0, now: () => c.t, add: (ms) => { c.t += ms; return c.t; } }; return c; };
function audioHost(c, flags, moves = true) {
  const h = { gains: [], plays: [], stops: 0, flags: Object.assign({ 'room.duck': true, 'room.music': true }, flags || {}), busy: false, ready: true,
    now: c.now, on: (id) => h.flags[id] === true, setGain: (g) => { h.gains.push(+g.toFixed(4)); return moves; }, play: (st, t, fresh) => h.plays.push([st, t.src, fresh]), stop: () => { h.stops++; },
    busyFn: null };
  h.busy = () => h.isBusy === true; h.ready = () => h.isReady !== false;
  return h;
}
await test('duck: 12 dB is a gain of about 0.251; the wake word is a word, not a prefix', () => {
  assert.ok(Math.abs(RA.gainOf(-12) - 0.2512) < 0.001); assert.equal(RA.DUCK_DB, -12); assert.equal(RA.DUCK_MS, 6000);
  for (const t of ['Blade', 'Blade, tick the alarm', 'hey blade', 'ok. Blade!', 'BLADE']) assert.ok(RA.hearsWake(t), t);
  for (const t of ['blades in the dark', 'bladerunner', 'a switchblade', '', 'the crew', null]) assert.ok(!RA.hearsWake(t), String(t));
});
await test('duck: a heard Blade lowers the music for 6 s then lets go; another inside the window extends it; off does nothing', () => {
  const c = clock(), h = audioHost(c, { 'room.music': false }), e = RA.create(h);
  assert.equal(e.hear('the crew goes in'), false); assert.deepEqual(h.gains, []);
  assert.equal(e.hear('Blade,'), true, 'a bare wake word ducks at once (no waiting for the command)');
  assert.ok(Math.abs(h.gains[h.gains.length - 1] - 0.2512) < 0.001); assert.equal(e.report().ducked, true);
  c.add(4000); e.hear('Blade, tick it'); c.add(4000); e.tick();
  assert.equal(e.report().ducked, true, 'extended: 8 s after the first, 4 s after the second');
  c.add(2100); e.tick(); assert.equal(e.report().ducked, false); assert.equal(h.gains[h.gains.length - 1], 1, 'released');
  h.flags['room.duck'] = false; assert.equal(e.hear('Blade'), false); h.gains.length = 0; e.tick(); assert.ok(h.gains.every((g) => g === 1));
});
await test('duck on iOS: where the volume cannot move the engine says limited and fakes nothing', () => {
  const c = clock(), h = audioHost(c, { 'room.music': false }, false), e = RA.create(h);
  e.hear('Blade'); assert.equal(e.report().limited, true); c.add(7000); e.tick(); assert.equal(e.report().limited, false, 'nothing asked, nothing limited');
  assert.equal(h.plays.length + h.stops, 0, 'no pause, no play: the track is left alone');
});
await test('duck through the transcriber: simulated runs reach the engine from makeMerger before the line is emitted; no Deepgram', () => {
  const c = clock(), h = audioHost(c, { 'room.music': false }), e = RA.create(h), out = []; let t = 0;
  const m = ST.makeMerger((l) => out.push(l), () => t, null, (text) => e.hear(text));
  m.add({ speaker: 0, text: 'so we go in', start: 0, end: 1 }, 'c1', 0); assert.equal(e.report().ducked, false);
  t = 1500; m.add({ speaker: 1, text: 'Blade,', start: 2, end: 2.4 }, 'c1', 2000);
  assert.equal(e.report().ducked, true, 'ducked while the line is still open'); assert.equal(out.length, 1, 'the earlier line closed, the Blade line is not emitted yet');
  assert.doesNotThrow(() => ST.makeMerger(() => {}, () => 0, null, () => { throw new Error('listener'); }).add({ speaker: 0, text: 'x', start: 0, end: 1 }, 'c', 0), 'a listener never breaks the merge');
  const plain = []; const m2 = ST.makeMerger((l) => plain.push(l), () => 0); m2.add({ speaker: 0, text: 'Blade', start: 0, end: 1 }, 'c', 0); m2.flush(); assert.equal(plain.length, 1, 'no listener: unchanged');
});
await test('music states: security, heat, wanted and the phase pick one of five', () => {
  assert.deepEqual(RA.STATES, ['ambient', 'tension', 'alert', 'evasion', 'resolved']);
  const s = RA.stateOf;
  assert.equal(s({}), 'ambient'); assert.equal(s({ security: 0, heat: 0 }), 'ambient'); assert.equal(s(null), 'ambient');
  assert.equal(s({ security: 1 }), 'tension'); assert.equal(s({ heat: 3 }), 'tension'); assert.equal(s({ wanted: 1 }), 'tension');
  assert.equal(s({ security: 2 }), 'alert'); assert.equal(s({ security: 3 }), 'alert'); assert.equal(s({ heat: 7 }), 'alert'); assert.equal(s({ wanted: 3 }), 'alert');
  assert.equal(s({ security: 4 }), 'evasion'); assert.equal(s({ security: 4, phase: 'after' }), 'resolved'); assert.equal(s({ phase: 'after', heat: 9 }), 'resolved');
});
await test('music bars: a change lands on the next bar line from the track tempo; no tempo lands at once', () => {
  const t = { bpm: 120, beatsPerBar: 4 };        /* a bar is 2000 ms */
  assert.equal(RA.nextBar(10000, 10000, t), 10000, 'exactly on a bar'); assert.equal(RA.nextBar(10001, 10000, t), 12000); assert.equal(RA.nextBar(13999, 10000, t), 14000);
  assert.equal(RA.nextBar(5000, 10000, t), 10000, 'before the start: the start'); assert.equal(RA.nextBar(1, 0, { bpm: null }), null); assert.equal(RA.nextBar(1, 0, { bpm: 0 }), null); assert.equal(RA.nextBar(NaN, 0, t), null);
  assert.equal(RA.nextBar(3000, 0, { bpm: 90, beatsPerBar: 3 }), 4000, 'a 3/4 bar at 90 is 2000 ms');
});
await test('music engine: the first state starts at once, a change waits for the bar, a flashback muffles, switching off stops it', () => {
  const c = clock(), h = audioHost(c, { 'room.duck': false }), man = {}; RA.STATES.forEach((s) => { man[s] = { src: 'media/' + s + '.mp3', bpm: 120, beatsPerBar: 4, level: 0.5 }; });
  const e = RA.create(h, { manifest: man });
  assert.equal(e.update({ security: 0 }), 'ambient'); assert.deepEqual(h.plays[0], ['ambient', 'media/ambient.mp3', true]);
  c.add(500); assert.equal(e.update({ security: 2 }), 'ambient', 'alert is wanted but the bar has not come'); assert.equal(e.report().want, 'alert'); assert.equal(e.report().landAt, 1002000);
  c.add(1000); e.tick(); assert.equal(e.report().state, 'ambient'); c.add(600); e.tick(); assert.equal(e.report().state, 'alert'); assert.equal(h.plays.length, 2);
  e.update({ security: 2, filter: 'flashback' }); assert.equal(e.report().muffled, true); assert.ok(Math.abs(h.gains[h.gains.length - 1] - 0.5 * RA.MUFFLE) < 0.001);
  e.update({ security: 2 }); assert.equal(e.report().muffled, false);
  e.update({ security: 3 }); assert.equal(h.plays.length, 2, 'same state: no change');
  c.add(10); e.update({ security: 1 }); e.update({ security: 2 }); assert.equal(e.report().want, null, 'back to the state it is in cancels the pending change');
  h.flags['room.music'] = false; e.update({}); assert.equal(h.stops, 1); assert.equal(e.report().state, null);
});
await test('music engine: with room.music off it never plays; while a scene owns the music or the file is missing it waits; no tempo changes at once', () => {
  const c = clock(), h = audioHost(c, { 'room.music': false }), e = RA.create(h);
  e.update({ security: 4 }); assert.deepEqual(h.plays, []);
  h.flags['room.music'] = true; h.isBusy = true; e.update({ security: 4 }); assert.deepEqual(h.plays, [], 'a scene theme is playing: hands off');
  h.isBusy = false; h.isReady = false; e.update({ security: 4 }); assert.deepEqual(h.plays, [], 'locked or no file');
  h.isReady = true; e.update({ security: 4 }); assert.equal(h.plays.length, 1); assert.equal(e.report().state, 'evasion');
  c.add(100); e.update({ phase: 'after' }); assert.equal(e.report().state, 'resolved', 'the default manifest has no tempo: it lands at once');
  assert.ok(RA.STATES.every((s) => RA.DEFAULT_MANIFEST[s] && RA.DEFAULT_MANIFEST[s].src === 'media/theme.mp3'), 'today\'s single track, one layer per state');
});

/* ---- the bundles ---- */
await test('bundles: the new files are in the right bundles (GM files never in the display bundle, display files never in the GM one)', () => {
  const B = Routes.BUNDLES;
  assert.ok(B.gm.includes('gm/montage.js') && !B.display.includes('gm/montage.js'));
  for (const f of ['display/montage.js', 'display/montage.css', 'display/room-audio.js']) { assert.ok(B.display.includes(f), f); assert.ok(!B.gm.includes(f), f); assert.ok(!B.table.includes(f) && !B.core.includes(f), f); }
  assert.ok(B.lookbook.includes('display/montage.js') && B.lookbook.includes('display/montage.css'));
  assert.ok(B.display.indexOf('display/montage.js') > B.display.indexOf('display/layers.js') - 5);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
