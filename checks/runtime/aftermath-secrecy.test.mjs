// The Aftermath show's two kinds and its phone row against the real handlers (suite ticket 1.6): functions/api/gm/ambient.js, display.js and docs.js on the
// in-memory SQLite the repo's tests use. A hidden NPC never reaches the credits or any line of a step; the commendations row is public, GM-written and
// text-free. INVENTED data only; every GM-only string is a GM-ONLY- marker.
//   node checks/runtime/aftermath-secrecy.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { onRequest as ambientHandler } from '../../functions/api/gm/ambient.js';
import { onRequest as displayHandler } from '../../functions/api/gm/display.js';
import { onRequest as docsHandler } from '../../functions/api/docs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const GM = { me: { role: 'gm', email: 'gm@example.test', id: 'gm@example.test' } }, DISPLAY = { me: { role: 'display', email: 'table@example.test', id: 'table@example.test' } };
const PLAYER = { me: { role: 'player', email: 'alice@example.test', id: 'alice@example.test' } };

async function freshDb() { return asD1(await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') })); }
const pokes = [];
const call = async (db, handler, method, url, body, who = GM) => {
  try { return await handler({ request: new Request('http://x.test' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env: { DB: db }, data: who, waitUntil: (p) => { pokes.push(p); } }); }
  catch (e) { if (e && Number.isInteger(e.status)) return new Response(JSON.stringify({ error: e.message }), { status: e.status }); throw e; }
};
const patch = async (db, body) => { const r = await call(db, ambientHandler, 'PATCH', '/api/gm/ambient', body); return { status: r.status, body: await r.json() }; };
const getDisplay = async (db) => { const r = await call(db, displayHandler, 'GET', '/api/gm/display?seq=-1&aseq=-1&sseq=-1', undefined, DISPLAY); return { status: r.status, body: await r.json() }; };
async function addNpc(db, id, doc) { const now = new Date().toISOString(); await db.prepare('INSERT INTO npcs (id, campaign, created_at, updated_at, deleted, doc) VALUES (?1, ?2, ?3, ?3, 0, ?4)').bind(id, 'default', now, JSON.stringify(doc)).run(); }
const CAST = {
  'n-mabel': { name: 'Mabel Quist', role: 'Fixer', faction: 'The Kestrel Club', description: 'DESC-MARKER', gmNotes: 'GMNOTES-MARKER', revealed: true },
  'n-dov': { name: 'Dov Kessler', role: 'Desk sergeant', faction: 'The Tidewater Watch', revealed: true },
  'n-hid': { name: 'GM-ONLY-NPC-1', alias: 'GM-ONLY-ALIAS-1', role: 'GM-ONLY-ROLE-1', faction: 'The Tidewater Watch', revealed: false, gmNotes: 'GM-ONLY-NOTES' }
};
async function withCast() { const db = await freshDb(); for (const [id, d] of Object.entries(CAST)) await addNpc(db, id, d); return db; }
const OV = (kind, payload) => ({ overlay: { id: 'o-' + kind, kind, ms: 20000, payload } });

await test('credits: written without the hidden NPC, served as cards of the revealed ones (name, role, faction only), none left is 400 in the same words as a missing one', async () => {
  const db = await withCast();
  const r = await patch(db, OV('credits', { npcIds: ['n-mabel', 'n-hid', 'n-dov'] }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.doc.overlay.payload.npcIds, ['n-mabel', 'n-dov']);
  const g = (await getDisplay(db)).body;
  assert.deepEqual(g.overlay.payload.npcs.map((n) => n.name), ['Mabel Quist', 'Dov Kessler']);
  assert.deepEqual(Object.keys(g.overlay.payload.npcs[0]).sort(), ['alias', 'faction', 'name', 'npcId', 'role', 'spec']);
  assert.ok(!/GM-ONLY|DESC-MARKER|GMNOTES-MARKER/.test(JSON.stringify(g)));
  const a = await patch(db, OV('credits', { npcIds: ['n-hid'] })), b = await patch(db, OV('credits', { npcIds: ['n-nobody'] }));
  assert.equal(a.status, 400); assert.equal(b.status, 400); assert.equal(a.body.error, b.body.error);
});

await test('credits: hiding an NPC after the write takes them off the iPad on the next poll; hiding all of them leaves no beat', async () => {
  const db = await withCast();
  await patch(db, OV('credits', { npcIds: ['n-mabel', 'n-dov'] }));
  await db.prepare("UPDATE npcs SET doc = json_set(doc, '$.revealed', json('false')) WHERE id = 'n-dov'").run();
  let g = (await getDisplay(db)).body;
  assert.deepEqual(g.overlay.payload.npcs.map((n) => n.name), ['Mabel Quist']);
  await db.prepare("UPDATE npcs SET doc = json_set(doc, '$.revealed', json('false')) WHERE id = 'n-mabel'").run();
  g = (await getDisplay(db)).body;
  assert.equal(g.overlay, null, 'nobody revealed: nothing is served');
});

await test('aftermath lines naming a hidden NPC (name or alias) are 400, a revealed name and a crew name are fine, and a list is scanned line by line', async () => {
  const db = await withCast();
  for (const lines of [['GM-ONLY-NPC-1 owes a favour'], ['The Kestrel Club +1', 'gm-only-alias-1 was hurt']]) {
    for (const step of ['status', 'harm']) assert.equal((await patch(db, OV('aftermath', { step, lines }))).status, 400, step + ' ' + JSON.stringify(lines));
  }
  assert.equal((await patch(db, OV('aftermath', { step: 'unwind', who: 'GM-ONLY-NPC-1' }))).status, 400);
  assert.equal((await patch(db, OV('aftermath', { step: 'unwind', line: 'GM-ONLY-NPC-1 decides' }))).status, 400);
  const ok = await patch(db, OV('aftermath', { step: 'status', lines: ['The Kestrel Club +1', 'Mabel Quist owes the crew'] }));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const g = (await getDisplay(db)).body;
  assert.deepEqual(Object.keys(g.overlay).filter((k) => k !== 'age').sort(), ['at', 'id', 'kind', 'ms', 'payload']);
  assert.deepEqual(g.overlay.payload, { step: 'status', lines: ['The Kestrel Club +1', 'Mabel Quist owes the crew'] });
});

await test('every step of the Aftermath is accepted by the Worker as the GM page builds it, and served back unchanged', async () => {
  const db = await withCast();
  const { default: A } = { default: (await import('node:module')).createRequire(import.meta.url)(path.join(ROOT, 'app', 'gm', 'aftermath.js')) };
  const data = { stacks: 14, tithe: 3, heat: 5, exposure: 4, mods: 2, wanted: 1, status: 'The Kestrel Club +1', harm: 'Nell Arbuthnot: a bad leg', who: 'Nell Arbuthnot', line: 'Spend your downtime first' };
  for (const s of A.STEPS) {
    const pl = A.payloadFor(s.id, data, { npcIds: ['n-mabel', 'n-dov'] });
    const r = await patch(db, { overlay: { id: 'k-' + s.id, kind: pl.kind, ms: s.id === 'xp' ? 90000 : A.HOLD_MS, payload: pl.payload } });
    assert.equal(r.status, 200, s.id + ' ' + JSON.stringify(r.body));
    const g = (await getDisplay(db)).body;
    assert.equal(g.overlay.kind, pl.kind);
    if (pl.kind === 'aftermath') assert.deepEqual(g.overlay.payload, pl.payload, s.id + ' served as sent');
    else assert.deepEqual(g.overlay.payload.npcs.map((n) => n.npcId), ['n-mabel', 'n-dov']);
  }
});

await test('the commendations row: the GM writes it public, text-free; a player and the iPad read it; a player cannot write it; the GM takes it down', async () => {
  const db = await withCast();
  const row = { kind: 'commend', owner: '_', scope: 'public', json: { v: 1, secs: 90, until: Date.now() + 90000 } };
  let r = await call(db, docsHandler, 'PUT', '/api/docs', row); assert.equal(r.status, 200, await r.text());
  const read = async (who) => { const x = await call(db, docsHandler, 'GET', '/api/docs?kind=commend', undefined, who); return (await x.json()).docs; };
  for (const who of [PLAYER, DISPLAY, GM]) { const d = await read(who); assert.equal(d.length, 1); assert.deepEqual(d[0].json, row.json); assert.equal(d[0].scope, 'public'); }
  assert.ok(!/GM-ONLY|Mabel|Dov/.test(JSON.stringify(await read(PLAYER))), 'no name in the row');
  r = await call(db, docsHandler, 'PUT', '/api/docs', { kind: 'commend', json: { v: 1, until: 1 } }, PLAYER);
  assert.ok(r.status === 400 || r.status === 403, 'a player cannot write the commend kind: ' + r.status);
  assert.deepEqual((await read(PLAYER))[0].json, row.json, 'unchanged');
  r = await call(db, docsHandler, 'DELETE', '/api/docs?kind=commend&owner=_'); assert.equal(r.status, 200);
  for (const who of [PLAYER, DISPLAY, GM]) assert.equal((await read(who)).length, 0);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
