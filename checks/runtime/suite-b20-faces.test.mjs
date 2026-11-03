// Suite B20, tickets 3.5 and 3.7 (switches face.rolodex and face.pcstatus; no browser, no network): the Rolodex lower third, the PC status faces on the band
// (server bounds, secrecy, the display's reading of them, the GM controller against a fake host) and the display GET's read count and timing.
// INVENTED data only (the Pelican Rooms cast); GM-ONLY- markers for anything that must never appear.
//   node checks/runtime/suite-b20-faces.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { onRequest as ambientHandler } from '../../functions/api/gm/ambient.js';
import { onRequest as displayHandler } from '../../functions/api/gm/display.js';
import { MiniEl } from './minidom.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const require = createRequire(import.meta.url);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
globalThis.self = globalThis;
globalThis.location = { origin: 'http://x.test' };
globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};

const F = require(path.join(APP, 'features.js'));
const Shows = require(path.join(APP, 'display', 'shows.js'));
globalThis.B68RolodexCard = require(path.join(APP, 'display', 'rolodex-card.js'));      // the browser sets this global itself; under require() the file only exports
require(path.join(APP, 'display', 'show-beats.js'));
const Layers = require(path.join(APP, 'display', 'layers.js'));
const Show = require(path.join(APP, 'gm', 'show.js'));
const PC = require(path.join(APP, 'gm', 'pcstatus.js'));

const doc = () => { const d = { createElement: (t) => { const e = new MiniEl(t); e.ownerDocument = d; e.style = { setProperty() {} }; return e; }, createElementNS: (n, t) => d.createElement(t) }; return d; };
const flat = (n) => JSON.stringify([n.className, n.textContent, (n.children || []).map(flat)]);

await test('registry: both switches are default off, in the figures stage', () => {
  for (const id of ['face.rolodex', 'face.pcstatus']) { const s = F.get(id); assert.ok(s, id); assert.equal(s.default, false); assert.equal(s.stage, 'face'); }
  assert.equal(F.get('face.rolodex').surface, 'display'); assert.equal(F.get('face.pcstatus').surface, 'gm');
});

await test('rolodex: off draws the row of cards as before; on draws the lower third (name, alias, role and faction), three at most', async () => {
  const fx = Shows.entry('rolodex').fixture;
  const off = await Shows.mount({ kind: 'rolodex', payload: fx }, { document: doc() });
  assert.ok(/dp-roll/.test(flat(off)) && !/dp-rc/.test(flat(off)));
  const on = await Shows.mount({ kind: 'rolodex', payload: fx }, { document: doc(), features: { 'face.rolodex': true } });
  assert.ok(/dp-rc/.test(on.className)); assert.equal(on.children.length, 3);
  const t = flat(on.children[0]); assert.ok(/Mabel Quist/.test(t) && /Mab/.test(t) && /Fixer/.test(t) && /The Kestrel Club/.test(t), t);
  const four = { npcs: [...fx.npcs, { npcId: 'n-x', name: 'Extra Person' }] };
  assert.equal((await Shows.mount({ kind: 'rolodex', payload: four }, { document: doc(), features: { 'face.rolodex': true } })).children.length, 3);
});
await test('rolodex: a portrait comes from env.portrait only; one that throws falls back to the monogram', async () => {
  const p = { npcs: [{ npcId: 'n-mabel', name: 'Mabel Quist', spec: { v: 1 } }] };
  const d = doc(); const mk = d.createElement('svg'); mk.className = 'drawn';
  const ok = await Shows.mount({ kind: 'rolodex', payload: p }, { document: d, features: { 'face.rolodex': true }, portrait: () => mk });
  assert.ok(/drawn/.test(flat(ok)) && !/dp-rc-mono/.test(flat(ok)));
  const bad = await Shows.mount({ kind: 'rolodex', payload: p }, { document: doc(), features: { 'face.rolodex': true }, portrait: () => { throw new Error('x'); } });
  assert.ok(/dp-rc-mono/.test(flat(bad)));
  const none = await Shows.mount({ kind: 'rolodex', payload: p }, { document: doc(), features: { 'face.rolodex': true } });
  assert.ok(/dp-rc-mono/.test(flat(none)));
});

await test('pcstatus: faces from slim characters: bounds, no text, three at most, harm as levels', () => {
  const mk = (i, st) => { const o = { id: 'pc' + i, name: 'Player ' + i }; if (st) Object.defineProperty(o, 'status', { enumerable: false, value: st }); return o; };
  const f = PC.facesFrom([mk(1, { stress: 4, harm: [3, 1, 'GM-ONLY-text', 9], locks: 1 }), mk(2), mk(3, { stress: 12, harm: [], locks: 0 }), mk(4, { stress: 1 })]);
  assert.equal(f.length, 3);
  assert.deepEqual(f[0], { pcId: 'pc1', name: 'Player 1', stress: 4, harm: [3, 1], locks: 1 });
  assert.deepEqual(f[1], { pcId: 'pc2', name: 'Player 2' }); assert.deepEqual(f[2], { pcId: 'pc3', name: 'Player 3' });
  assert.ok(!JSON.stringify(f).includes('GM-ONLY'));
  assert.ok(Show.layerOk('band.faces', f), 'the GM mirror takes what the controller builds');
  assert.ok(!Show.layerOk('band.faces', [{ pcId: 'a', stress: 10 }]) && !Show.layerOk('band.faces', [{ pcId: 'a', harm: ['plaster'] }]) && !Show.layerOk('band.faces', [{ pcId: 'a', harm: [1, 1, 1, 1, 1] }]));
});
const fakeHost = (over) => {
  const sent = []; let faces = null; const pcs = [{ id: 'pc1', name: 'Nell Arbuthnot' }]; Object.defineProperty(pcs[0], 'status', { enumerable: false, writable: true, value: { stress: 2, harm: [], locks: 0 } });
  const h = { sent, on: true, feature: (id) => h.on && id === 'face.pcstatus', pcs: () => pcs, current: () => faces, layer: async (p, v) => { sent.push([p, v]); faces = v; return {}; } };
  return Object.assign(h, over || {});
};
await test('pcstatus: sends once, then only on a change; clears when the switch goes off; leaves NPC faces alone', async () => {
  PC.reset(); const h = fakeHost();
  assert.equal(await PC.sync(h), 'sent'); assert.equal(await PC.sync(h), 'same'); assert.equal(h.sent.length, 1);
  h.pcs()[0].status.stress = 3; assert.equal(await PC.sync(h), 'sent'); assert.equal(h.sent.length, 2);
  h.pcs()[0].status.harm = [1]; h.pcs()[0].status.locks = 1; assert.equal(await PC.sync(h), 'sent');
  assert.deepEqual(h.sent[2][1][0].harm, [1]); assert.equal(h.sent[2][1][0].locks, 1);
  h.on = false; assert.equal(await PC.sync(h), 'cleared'); assert.deepEqual(h.sent[3], ['band.faces', null]); assert.equal(await PC.sync(h), 'off');
  PC.reset(); const g = fakeHost({ current: () => [{ npcId: 'n-mabel' }] });
  assert.equal(await PC.sync(g), 'busy'); assert.equal(g.sent.length, 0, 'NPC faces from the hard start are not taken over');
  PC.reset(); const off = fakeHost({ on: false }); assert.equal(await PC.sync(off), 'off'); assert.equal(off.sent.length, 0, 'switch off: nothing is ever sent');
});

await test('display layers: a plain face is unchanged; a status face is read, bounded and drawn; extra keys are dropped', () => {
  assert.deepEqual(Layers.clean({ band: { faces: [{ pcId: 'p1' }, { name: 'Dov Kessler', role: 'Desk sergeant' }] } }).faces, [{ pcId: 'p1' }, { name: 'Dov Kessler', role: 'Desk sergeant' }]);
  const s = Layers.clean({ band: { faces: [{ pcId: 'p1', name: 'Nell', stress: 4, harm: [1, 2, 7], locks: 2, junk: 'GM-ONLY-x' }] } }).faces[0];
  assert.deepEqual(s, { pcId: 'p1', name: 'Nell', stress: 4, harm: [1, 2], locks: 2 });
  const d = doc(), box = d.createElement('div'); box.querySelectorAll = () => []; box.setAttribute = () => {}; box.removeAttribute = () => {};
  const L = Layers.attach(box, {}); L.apply({ band: { faces: [{ pcId: 'p1', name: 'Nell', stress: 4, harm: [1, 2], locks: 1 }] } });
  const html = flat(box);
  assert.ok(/dp-pc-stress[^\]]*4/.test(html) && /dp-pc-harm-1/.test(html) && /plaster/.test(html) && /sling/.test(html) && /dp-pc-lock/.test(html), html);
});

/* ---------- the real handlers ---------- */
const GM = { me: { role: 'gm', email: 'gm@example.test' } }, DISPLAY = { me: { role: 'display', email: 'table@example.test' } };
async function freshDb() { const raw = asD1(await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') })); const db = { n: 0, prepare(s) { db.n++; return raw.prepare(s); }, batch: (l) => raw.batch(l), raw }; return db; }
const call = async (db, handler, method, url, body, who) => {
  try { return await handler({ request: new Request('http://x.test' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env: { DB: db }, data: who, params: {} }); }
  catch (e) { if (e && Number.isInteger(e.status)) return new Response(JSON.stringify({ error: e.message }), { status: e.status }); throw e; }
};
const patch = async (db, body) => { const r = await call(db, ambientHandler, 'PATCH', '/api/gm/ambient', body, GM); return { status: r.status, body: await r.json() }; };
const getDisplay = async (db) => { const r = await call(db, displayHandler, 'GET', '/api/gm/display?seq=-1&aseq=-1&sseq=-1', undefined, DISPLAY); return { status: r.status, body: await r.json() }; };
async function addNpc(db, id, d) { const now = new Date().toISOString(); await db.raw.prepare('INSERT INTO npcs (id, campaign, created_at, updated_at, deleted, doc) VALUES (?1, ?2, ?3, ?3, 0, ?4)').bind(id, 'default', now, JSON.stringify(d)).run(); }
async function withCast() {
  const db = await freshDb();
  await addNpc(db, 'n-mabel', { name: 'Mabel Quist', alias: 'Mab', role: 'Fixer', faction: 'The Kestrel Club', description: 'GM-ONLY-DESC', gmNotes: 'GM-ONLY-NOTES', revealed: true });
  await addNpc(db, 'n-hid', { name: 'GM-ONLY-NPC-1', alias: 'GM-ONLY-ALIAS', role: 'x', revealed: false });
  return db;
}

await test('server: a PC face keeps its bounded status; a plain pcId is still exactly { pcId }; bad values are 400; served rebuilt from named keys', async () => {
  const db = await withCast();
  const good = [{ pcId: 'pc1', name: 'Nell Arbuthnot', stress: 4, harm: [2, 1], locks: 1, junk: 'x' }, { pcId: 'pc2' }];
  const r = await patch(db, { layer: { path: 'band.faces', value: good } }); assert.equal(r.status, 200);
  const g = await getDisplay(db);
  assert.deepEqual(g.body.layers.band.faces, [{ pcId: 'pc1', name: 'Nell Arbuthnot', stress: 4, harm: [2, 1], locks: 1 }, { pcId: 'pc2' }]);
  for (const bad of [{ pcId: 'a', stress: 10 }, { pcId: 'a', stress: 1.5 }, { pcId: 'a', harm: ['plaster'] }, { pcId: 'a', harm: [0] }, { pcId: 'a', harm: [1, 1, 1, 1, 1] }, { pcId: 'a', locks: 7 }, { pcId: 'a', name: 'x'.repeat(41) }])
    assert.equal((await patch(db, { layer: { path: 'band.faces', value: [bad] } })).status, 400, JSON.stringify(bad));
});
await test('server: a PC face name that names a hidden NPC is refused; hidden NPCs never reach a rolodex (a revealed one does)', async () => {
  const db = await withCast();
  const r = await patch(db, { layer: { path: 'band.faces', value: [{ pcId: 'pc1', name: 'GM-ONLY-NPC-1' }] } });
  assert.equal(r.status, 400); assert.ok(!JSON.stringify(r.body).includes('GM-ONLY'));
  assert.equal((await patch(db, { overlay: { id: 'r1', kind: 'rolodex', ms: 20000, payload: { npcIds: ['n-hid'] } } })).status, 400);
  assert.equal((await patch(db, { overlay: { id: 'r2', kind: 'rolodex', ms: 20000, payload: { npcIds: ['n-mabel', 'n-hid'] } } })).status, 200);
  const g = await getDisplay(db); const s = JSON.stringify(g.body);
  assert.ok(!s.includes('GM-ONLY') && s.includes('Mabel Quist') && s.includes('"alias":"Mab"'), s.slice(0, 300));
  assert.deepEqual(Object.keys(g.body.overlay.payload.npcs[0]).sort(), ['alias', 'faction', 'name', 'npcId', 'role', 'spec']);
});
await test('server: display GET reads and timing: PC status faces add NO read; a rolodex adds exactly one', async () => {
  const db = await withCast();
  db.n = 0; await getDisplay(db); const base = db.n;
  await patch(db, { layer: { path: 'band.faces', value: [{ pcId: 'pc1', name: 'Nell', stress: 2, harm: [1], locks: 1 }, { pcId: 'pc2' }, { pcId: 'pc3' }] } });
  db.n = 0; await getDisplay(db); assert.equal(db.n, base, 'PC faces name no NPC: no extra read');
  await patch(db, { overlay: { id: 'r3', kind: 'rolodex', ms: 20000, payload: { npcIds: ['n-mabel'] } } });
  const t0 = process.hrtime.bigint(); for (let i = 0; i < 20; i++) await getDisplay(db); const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 20;
  db.n = 0; await getDisplay(db); assert.equal(db.n, base + 1, 'a rolodex: one batched read');
  console.log('INFO local display GET with a rolodex and PC faces: ' + ms.toFixed(2) + ' ms per call (in-memory SQLite, handler only)');
});

await test('files: registered for the display and the look book; the GM controller for the GM bundle; never for players', () => {
  const routes = fs.readFileSync(path.join(APP, 'routes.js'), 'utf8');
  const bundle = (n) => { const m = routes.match(new RegExp('\\n\\s*' + n + ': \\[([^\\]]*)\\]')); return m ? m[1] : ''; };
  for (const f of ['display/rolodex-card.js', 'display/face-cards.css']) { assert.ok(bundle('display').includes("'" + f + "'"), f); assert.ok(bundle('lookbook').includes("'" + f + "'"), f); }
  assert.ok(bundle('gm').includes("'gm/pcstatus.js'"));
  for (const f of ['display/rolodex-card.js', 'gm/pcstatus.js', 'display/face-cards.css']) for (const b of ['core', 'table', 'figures']) assert.ok(!bundle(b).includes(f), b + ' has ' + f);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed'); process.exit(failed ? 1 : 0);
