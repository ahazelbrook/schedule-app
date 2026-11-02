// The show contract (W0.3, functions/_lib/show.js): the brief-beat overlay kinds, the lasting layers, the read-time joins and the write-time drops,
// once-by-id, expiry, and what the display GET costs. Runs the real handlers (functions/api/gm/ambient.js and display.js) on the in-memory SQLite
// the repo's tests use. INVENTED data only; every GM-only string is a GM-ONLY- marker.
//   node checks/runtime/show-contract.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { onRequest as ambientHandler } from '../../functions/api/gm/ambient.js';
import { onRequest as displayHandler } from '../../functions/api/gm/display.js';
import { cleanShowPayload, cleanLayerOp, SHOW_KIND_IDS, LAYER_PATHS, joinShows } from '../../functions/_lib/show.js';
import { cleanOverlay, OVERLAY_KINDS } from '../../functions/_lib/gm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const GM = { me: { role: 'gm', email: 'gm@example.test' } }, DISPLAY = { me: { role: 'display', email: 'table@example.test' } };

/* a database whose prepare() calls are counted */
async function freshDb() {
  const raw = asD1(await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') }));
  const db = { n: 0, sql: [], prepare(s) { db.n++; db.sql.push(s); return raw.prepare(s); }, batch: (list) => raw.batch(list), raw };
  return db;
}
/* the handlers throw HttpError; worker/app.js turns one into its status, and so does this */
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
const setRevealed = (db, id, revealed) => db.raw.prepare("UPDATE npcs SET doc = json_set(doc, '$.revealed', json(?2)) WHERE id = ?1").bind(id, revealed ? 'true' : 'false').run();
const CAST = {
  'n-mabel': { name: 'Mabel Quist', alias: 'The Fixer', role: 'Fixer', faction: 'The Kestrel Club', description: 'DESC-MARKER', gmNotes: 'GMNOTES-MARKER', tags: ['TAG-MARKER'], revealed: true, spec: { v: 1, figure: 'femme', name: 'LABEL-NAME', secretField: 'UNKNOWN-MARKER' } },
  'n-dov': { name: 'Dov Kessler', role: 'Desk sergeant', faction: 'The Tidewater Watch', revealed: true },
  'n-lotte': { name: 'Lotte Brand', role: 'Doorwoman', faction: 'The Kestrel Club', revealed: true },
  'n-hid': { name: 'GM-ONLY-NPC-1', alias: 'GM-ONLY-ALIAS-1', role: 'GM-ONLY-ROLE-1', faction: 'The Tidewater Watch', revealed: false, gmNotes: 'GM-ONLY-NOTES' },
};
async function withCast() { const db = await freshDb(); for (const [id, d] of Object.entries(CAST)) await addNpc(db, id, d); return db; }
const OV = (kind, payload, extra) => ({ overlay: { id: 'o-' + kind, kind, ms: 20000, payload, ...(extra || {}) } });
const POLL = '?seq=-1&aseq=-1&sseq=-1';       // a display with nothing yet: every part comes in full
const FIXTURES = {
  stamp: { word: 'PAID', tone: 'orange' }, spotted: { text: 'Eyes on the door', level: 2 }, keyturn: { label: 'KEY-1', pc: 'Nell Arbuthnot' },
  title: { text: 'The Pelican Rooms', sub: 'Gala night' }, wanted: { level: 3, heat: 7, siren: true }, ring: { text: 'The desk phone' },
  rolodex: { npcIds: ['n-mabel', 'n-dov', 'n-lotte'] }, spotlight: { npcId: 'n-lotte' },
  report: { position: 'risky', effect: 'standard', text: 'Wren Tully turns round' },
  aftermath: { step: 'heat', n: 3, exposure: 4, mods: 2, heat: 5, after: 0, siren: true, wanted: 2, lines: ['The Kestrel Club +1'] }, credits: { npcIds: ['n-mabel', 'n-dov'] },   // suite 1.6
};

await test('the registry: the seven brief beats and the spotlight are overlay kinds, the old four are still there', () => {
  assert.deepEqual(['stamp', 'spotted', 'keyturn', 'rolodex', 'title', 'wanted', 'ring'].filter((k) => !SHOW_KIND_IDS.includes(k)), []);
  for (const k of ['clock', 'npc', 'fx', 'text', ...SHOW_KIND_IDS]) assert.ok(OVERLAY_KINDS.includes(k), k);
  assert.deepEqual(Object.keys(FIXTURES).sort(), [...SHOW_KIND_IDS].sort(), 'a fixture for every kind');
  assert.equal(LAYER_PATHS.length, 10);
});

await test('payloads are rebuilt from named keys: strays dropped, bounds enforced with 400', () => {
  for (const [k, p] of Object.entries(FIXTURES)) {
    const out = cleanShowPayload(k, { ...p, stray: 'STRAY-MARKER', npc: { name: 'X' } });
    assert.ok(!JSON.stringify(out).includes('STRAY-MARKER'), k + ' strays dropped');
    assert.deepEqual(cleanShowPayload(k, p), out, k + ' stable');
  }
  const bad = [['stamp', {}], ['stamp', { word: 'x'.repeat(25) }], ['stamp', { word: 'A', tone: 'pink' }], ['spotted', { level: 4 }], ['keyturn', {}], ['title', { text: 'T', sub: 'x'.repeat(121) }],
    ['wanted', { level: 5 }], ['wanted', { level: 1, siren: 'yes' }], ['rolodex', { npcIds: [] }], ['rolodex', { npcIds: Array.from({ length: 13 }, (_, i) => 'n' + i) }], ['rolodex', { npcIds: ['has space'] }], ['spotlight', { npcId: '' }]];
  for (const [k, p] of bad) assert.throws(() => cleanShowPayload(k, p), (e) => e.status === 400, k + ' ' + JSON.stringify(p));
  assert.throws(() => cleanOverlay({ id: 'a', kind: 'stamp', ms: 20000 }), (e) => e.status === 400, 'no payload');
  assert.equal(cleanOverlay({ id: 'a', kind: 'stamp', ms: 20000, payload: { word: ' PAID  ' } }).payload.word, 'PAID');
});

await test('layers: every path validates its value; null clears; a bad path or value is 400', () => {
  const good = { 'band.phase': 'plan', 'band.security': 3, 'band.faces': [{ npcId: 'n-mabel' }, { pcId: 'pc-nell' }], 'band.onair': true, 'scene.filter': 'flashback', 'scene.layout': 'montage', 'scene.mode': 'aftermath',
    'data.countdown': { to: 1760000000000, label: 'Curfew' }, 'data.credits': ['n-lotte'], 'data.previously': ['n-mabel', 'n-dov'] };
  assert.deepEqual(Object.keys(good).sort(), [...LAYER_PATHS].sort());
  for (const [p, value] of Object.entries(good)) { assert.deepEqual(cleanLayerOp({ path: p, value }), { path: p, value }, p); assert.equal(cleanLayerOp({ path: p, value: null }).value, null, p + ' clears'); }
  const bad = [['band.phase', 'late'], ['band.security', 5], ['band.security', '2'], ['band.faces', []], ['band.faces', [{ npcId: 'a' }, { npcId: 'b' }, { npcId: 'c' }, { npcId: 'd' }]], ['band.faces', [{ name: 'x' }]], ['band.onair', false], ['scene.filter', 'sepia'], ['scene.mode', 'x'],
    ['data.countdown', { to: 'soon' }], ['data.countdown', { to: 5, label: 'x'.repeat(41) }], ['data.credits', ['ok', 'bad id']], ['data.previously', Array.from({ length: 13 }, (_, i) => 'n' + i)], ['nope.path', 1]];
  for (const [p, value] of bad) assert.throws(() => cleanLayerOp({ path: p, value }), (e) => e.status === 400, p + ' ' + JSON.stringify(value));
  assert.throws(() => cleanLayerOp({ path: 'band.phase' }), (e) => e.status === 400, 'no value');
  assert.deepEqual(cleanLayerOp({ path: 'band.faces', value: [{ npcId: 'n-mabel', name: 'STRAY-MARKER' }] }).value, [{ npcId: 'n-mabel' }]);
});

await test('each brief beat reaches the display within one poll, with a payload built from named keys; the display sign-in sees it', async () => {
  const db = await withCast();
  for (const [kind, payload] of Object.entries(FIXTURES)) {
    const r = await patch(db, OV(kind, payload)); assert.equal(r.status, 200, kind + ' ' + JSON.stringify(r.body));
    const g = await getDisplay(db, POLL);       // the poll a display makes after the GM pressed the button
    const o = g.body.overlay; assert.ok(o, kind + ' reached the poll'); assert.equal(o.kind, kind); assert.equal(o.id, 'o-' + kind);
    assert.ok(o.ms === 20000 && typeof o.at === 'string' && o.payload && typeof o.payload === 'object');
    assert.deepEqual(Object.keys(o).filter((k) => k !== 'age').sort(), ['at', 'id', 'kind', 'ms', 'payload'], kind + ' named keys');
    assert.deepEqual(g.body.ambient.doc.overlay, o, kind + ': the ambient part carries the same overlay');
  }
});

await test('expiry: a brief beat is left out once at + ms has passed (the server clock), with nothing written; layers stay', async () => {
  const db = await withCast();
  await patch(db, OV('stamp', FIXTURES.stamp));
  await patch(db, { layer: { path: 'band.phase', value: 'plan' } });
  assert.equal((await getDisplay(db, POLL)).body.overlay.kind, 'stamp');
  await db.raw.prepare("UPDATE gm_ambient SET doc = json_set(doc, '$.overlay.at', ?1) WHERE campaign = 'default'").bind(new Date(Date.now() - 30000).toISOString()).run();
  const g = await getDisplay(db, POLL);
  assert.equal(g.body.overlay, null, 'expired'); assert.ok(!('overlay' in g.body.ambient.doc));
  assert.deepEqual(g.body.layers, { band: { phase: 'plan' } }, 'a lasting layer is still there');
  const row = await db.raw.prepare("SELECT json_extract(doc, '$.overlay.kind') AS k FROM gm_ambient").first(); assert.equal(row.k, 'stamp', 'the stored overlay is untouched (response only)');
});

await test('secrecy at write: a hidden NPC is dropped from a rolodex; hidden-only is 400; a hidden spotlight is 400; the same words for hidden and missing', async () => {
  const db = await withCast();
  const r = await patch(db, OV('rolodex', { npcIds: ['n-mabel', 'n-hid', 'n-dov'] })); assert.equal(r.status, 200);
  assert.deepEqual(r.body.doc.overlay.payload.npcIds, ['n-mabel', 'n-dov'], 'stored without the hidden one');
  const a = await patch(db, OV('rolodex', { npcIds: ['n-hid'] })), b = await patch(db, OV('rolodex', { npcIds: ['n-nobody'] }));
  assert.equal(a.status, 400); assert.equal(b.status, 400); assert.equal(a.body.error, b.body.error); assert.ok(!JSON.stringify(a.body).includes('GM-ONLY'));
  assert.equal((await patch(db, OV('spotlight', { npcId: 'n-hid' }))).status, 400);
  assert.equal((await patch(db, OV('spotlight', { npcId: 'n-lotte' }))).status, 200, 'positive control');
});

await test('secrecy at write: free text naming a hidden NPC (name or alias) is 400, in a beat and in a layer; a revealed name is fine', async () => {
  const db = await withCast();
  const bodies = [OV('title', { text: 'Welcome gm-only-npc-1' }), OV('title', { text: 'ok', sub: 'with GM-ONLY-ALIAS-1' }), OV('ring', { text: 'GM-ONLY-NPC-1 calls' }),
    OV('keyturn', { label: 'KEY-1', pc: 'GM-ONLY-NPC-1' }), { layer: { path: 'data.countdown', value: { to: 1760000000000, label: 'GM-ONLY-NPC-1' } } }];
  for (const body of bodies) assert.equal((await patch(db, body)).status, 400, JSON.stringify(body));
  assert.equal((await patch(db, OV('title', { text: 'Welcome Lotte' }))).status, 200, 'a revealed name is fine');
  assert.equal((await patch(db, { layer: { path: 'data.countdown', value: { to: 1760000000000, label: 'Curfew' } } })).status, 200);
});

await test('the report card (B09): position and effect are required and bounded, the consequence line is capped, and a hidden NPC named in it is 400', async () => {
  const db = await withCast();
  const ok = await patch(db, OV('report', { position: 'risky', effect: 'standard', text: 'Wren Tully turns round', junk: 1 }, { ms: 180000 }));
  assert.equal(ok.status, 200); assert.deepEqual(ok.body.doc.overlay.payload, { position: 'risky', effect: 'standard', text: 'Wren Tully turns round' }, 'rebuilt from named keys');
  for (const p of [{ effect: 'standard' }, { position: 'risky' }, { position: 'unclear', effect: 'standard' }, { position: 'risky', effect: 'huge' }, { position: 'risky', effect: 'standard', text: 'x'.repeat(101) }]) assert.equal((await patch(db, OV('report', p))).status, 400, JSON.stringify(p));
  const hid = await patch(db, OV('report', { position: 'risky', effect: 'great', text: 'GM-ONLY-NPC-1 is behind you' }));
  assert.equal(hid.status, 400); assert.ok(!JSON.stringify(hid.body).includes('GM-ONLY'));
});

await test('secrecy at write for layers: faces, credits and previously keep revealed NPCs only; none left is 400; pc faces stay', async () => {
  const db = await withCast();
  let r = await patch(db, { layer: { path: 'data.credits', value: ['n-lotte', 'n-hid', 'n-mabel'] } }); assert.equal(r.status, 200);
  assert.deepEqual(r.body.doc.layers.data.credits, ['n-lotte', 'n-mabel']);
  r = await patch(db, { layer: { path: 'band.faces', value: [{ npcId: 'n-hid' }, { pcId: 'pc-nell' }, { npcId: 'n-dov' }] } }); assert.equal(r.status, 200);
  assert.deepEqual(r.body.doc.layers.band.faces, [{ pcId: 'pc-nell' }, { npcId: 'n-dov' }]);
  assert.equal((await patch(db, { layer: { path: 'data.previously', value: ['n-hid'] } })).status, 400);
  assert.equal((await patch(db, { layer: { path: 'band.faces', value: [{ npcId: 'n-hid' }] } })).status, 400);
});

await test('secrecy at read: served from the NPC rows as they are NOW; hiding an NPC after the write drops it from the overlay and every layer; nothing else of the row is served', async () => {
  const db = await withCast();
  await patch(db, OV('rolodex', { npcIds: ['n-mabel', 'n-dov'] }));
  await patch(db, { layer: { path: 'data.credits', value: ['n-lotte', 'n-mabel'] } });
  await patch(db, { layer: { path: 'data.previously', value: ['n-mabel', 'n-dov'] } });
  await patch(db, { layer: { path: 'band.faces', value: [{ npcId: 'n-mabel' }, { npcId: 'n-dov' }, { pcId: 'pc-nell' }] } });
  let g = (await getDisplay(db, POLL)).body;
  assert.deepEqual(g.overlay.payload.npcs.map((n) => n.name), ['Mabel Quist', 'Dov Kessler']);
  assert.deepEqual(Object.keys(g.overlay.payload.npcs[0]).sort(), ['alias', 'faction', 'name', 'npcId', 'role', 'spec']);
  assert.deepEqual(g.layers.data.credits.map((n) => n.name), ['Lotte Brand', 'Mabel Quist']);
  assert.deepEqual(g.layers.band.faces.map((f) => f.name || f.pcId), ['Mabel Quist', 'Dov Kessler', 'pc-nell']);
  const text = JSON.stringify(g);
  assert.ok(!/DESC-MARKER|GMNOTES-MARKER|TAG-MARKER|LABEL-NAME|UNKNOWN-MARKER|"gmNotes"|"revealed"/.test(text), 'nothing else of the row or the spec');
  assert.deepEqual(g.ambient.doc.layers, g.layers, 'the ambient part carries the joined copy, never the stored ids');
  await setRevealed(db, 'n-mabel', false);
  g = (await getDisplay(db, '?seq=-1&aseq=' + g.ambient.seq + '&sseq=-1')).body;       // ambient seq current: the join still runs, on its own
  assert.deepEqual(g.overlay.payload.npcs.map((n) => n.name), ['Dov Kessler']);
  assert.deepEqual(g.layers.data.credits.map((n) => n.name), ['Lotte Brand']);
  assert.deepEqual(g.layers.data.previously.map((n) => n.name), ['Dov Kessler']);
  assert.deepEqual(g.layers.band.faces.map((f) => f.name || f.pcId), ['Dov Kessler', 'pc-nell']);
  await setRevealed(db, 'n-dov', false);
  g = (await getDisplay(db, POLL)).body;
  assert.equal(g.overlay, null, 'a rolodex with nobody left is left out'); assert.ok(!g.layers.data.previously && g.layers.data.credits.length === 1);
  assert.ok(!JSON.stringify(g).includes('Mabel') && !JSON.stringify(g).includes('Dov'));
  assert.ok(!JSON.stringify(g).includes('GM-ONLY'), 'no GM-ONLY marker anywhere in the display GET');
});

await test('a player cannot write the ambient document or read the display; the display sign-in cannot write', async () => {
  const db = await withCast();
  const player = { me: { role: 'player' } };
  assert.equal((await call(db, displayHandler, 'GET', '/api/gm/display', undefined, player)).status, 403);
  assert.equal((await patch(db, OV('stamp', FIXTURES.stamp), player)).status, 403);
  assert.equal((await patch(db, OV('stamp', FIXTURES.stamp), DISPLAY)).status, 403);
});

await test('once by id: a repeated command writes nothing and does not move seq; another id or an expired one shows; layers are idempotent; clear works', async () => {
  const db = await withCast();
  const a = await patch(db, { ...OV('stamp', FIXTURES.stamp, { id: 'k1' }), ifNotOverlay: 'k1' });
  assert.ok(!a.body.unchanged);
  const b = await patch(db, { ...OV('stamp', FIXTURES.stamp, { id: 'k1' }), ifNotOverlay: 'k1' });
  assert.equal(b.body.unchanged, true); assert.equal(b.body.seq, a.body.seq, 'seq did not move'); assert.equal(b.body.doc.overlay.at, a.body.doc.overlay.at, 'the clock did not restart');
  const c = await patch(db, { ...OV('stamp', FIXTURES.stamp, { id: 'k2' }), ifNotOverlay: 'k2' }); assert.ok(!c.body.unchanged && c.body.seq === a.body.seq + 1);
  await db.raw.prepare("UPDATE gm_ambient SET doc = json_set(doc, '$.overlay.at', ?1) WHERE campaign = 'default'").bind(new Date(Date.now() - 60000).toISOString()).run();
  const d = await patch(db, { ...OV('stamp', FIXTURES.stamp, { id: 'k2' }), ifNotOverlay: 'k2' }); assert.ok(!d.body.unchanged, 'an expired overlay does not block the same command later');
  assert.equal((await patch(db, { ...OV('stamp', FIXTURES.stamp, { id: 'k2' }), ifNotOverlay: 'zz' })).status, 400, 'ifNotOverlay must match the overlay it sits beside');
  assert.equal((await patch(db, { ifNotOverlay: 'k2' })).status, 400);
  const l1 = await patch(db, { layer: { path: 'scene.filter', value: 'flashback' } }), l2 = await patch(db, { layer: { path: 'scene.filter', value: 'flashback' } });
  assert.ok(!l1.body.unchanged && l2.body.unchanged === true && l2.body.seq === l1.body.seq, 'same layer value: nothing written');
  const l3 = await patch(db, { layer: { path: 'scene.mode', value: 'start' } });
  assert.deepEqual(l3.body.doc.layers, { scene: { filter: 'flashback', mode: 'start' } }, 'layers merge by path');
  const l4 = await patch(db, { layer: { path: 'scene.filter', value: null } }); assert.deepEqual(l4.body.doc.layers, { scene: { mode: 'start' } });
  const l5 = await patch(db, { layers: null }); assert.ok(!('layers' in l5.body.doc));
  const l6 = await patch(db, { layers: null }); assert.equal(l6.body.unchanged, true, 'clearing nothing writes nothing');
  assert.equal((await patch(db, { layers: {} })).status, 400);
  const o = await patch(db, { overlay: null }); assert.ok(!('overlay' in o.body.doc));
});

await test('a poll with nothing up is what it always was (no layers key); an old kind and a beat with no NPC add no read; NPCs cost one batched read', async () => {
  const db = await withCast();
  const keysOf = (b) => Object.keys(b).sort().join();
  db.n = 0; const none = await getDisplay(db, POLL); const nNone = db.n;
  assert.ok(!('layers' in none.body) && none.body.overlay === null && !('layers' in none.body.ambient.doc));
  await patch(db, { overlay: { id: 't1', kind: 'text', ms: 20000, text: 'A line' } });
  db.n = 0; const text = await getDisplay(db, POLL); const nText = db.n;
  assert.equal(text.body.overlay.kind, 'text'); assert.equal(nText, nNone, 'an old kind costs what it did');
  await patch(db, OV('stamp', FIXTURES.stamp));
  db.n = 0; const st = await getDisplay(db, POLL); assert.equal(db.n, nNone, 'a brief beat with no NPC adds no read');
  assert.equal(keysOf(st.body), keysOf(none.body));
  await patch(db, OV('rolodex', FIXTURES.rolodex));
  db.n = 0; await getDisplay(db, POLL); assert.equal(db.n, nNone + 1, 'a rolodex adds exactly one read (all its NPCs in one IN query)');
  await patch(db, { overlay: null }); await patch(db, { layer: { path: 'data.credits', value: ['n-lotte', 'n-mabel'] } }); await patch(db, { layer: { path: 'band.faces', value: [{ npcId: 'n-dov' }] } });
  db.n = 0; await getDisplay(db, POLL); assert.equal(db.n, nNone + 1, 'layers naming NPCs add one read for all of them');
  await patch(db, { layers: null }); await patch(db, { layer: { path: 'band.phase', value: 'plan' } });
  db.n = 0; await getDisplay(db, POLL); assert.equal(db.n, nNone, 'layers with no NPC add no read');
  db.sql.length = 0; await getDisplay(db, POLL);
  const lite = db.sql.filter((s) => /json_extract\(doc, '\$\.overlay'/.test(s));
  assert.ok(lite.length >= 1 && lite.every((s) => (s.match(/json_extract/g) || []).length === 1), 'the lite statement is ONE json_extract call (the document is parsed once)');
});

await test('joinShows costs no read and passes an old overlay through untouched when no NPC is named; stale stored values are left out', async () => {
  const db = await freshDb();
  const ov = { id: 'f', kind: 'fx', fx: 'dawn', ms: 20000 };
  const r = await joinShows(db, 'default', ov, null); assert.equal(r.overlay, ov); assert.equal(r.layers, null); assert.equal(db.n, 0);
  assert.deepEqual(await joinShows(db, 'default', null, null), { overlay: null, layers: null });
  const stale = await joinShows(db, 'default', { id: 's', kind: 'stamp', ms: 5000, payload: { word: '' } }, { band: { phase: 'late' } });
  assert.equal(stale.overlay, null, 'a stored beat that no longer validates is left out'); assert.equal(stale.layers, null, 'so is a stale layer');
  assert.equal(db.n, 0, 'and none of that read anything');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
