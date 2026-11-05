// The cast photo (3.8, face.castphoto) and the lair that grows (5.4, between.lair): the switches, the server's two show kinds through the real handlers (a hidden NPC reaches the
// iPad as a height and nothing else), the GM page's mirror, the pure rules, the GM controllers on a recorded host, the figure-kit line-up and the map kit's section, the display
// renderers, and the map kit's one new line (a room's own archetype). INVENTED data only; every GM-only string is a GM-ONLY- marker.
//   node checks/runtime/suite-b30.test.mjs
import path from 'node:path';
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { onRequest as ambientHandler } from '../../functions/api/gm/ambient.js';
import { onRequest as displayHandler } from '../../functions/api/gm/display.js';
import { cleanShowPayload, showTexts, SHOW_KIND_IDS } from '../../functions/_lib/show.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const require = createRequire(import.meta.url);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

globalThis.self = globalThis;
const Features = require(path.join(APP, 'features.js'));
const Fig = require(path.join(APP, 'figures', 'figure-kit.js'));
const Kit = require(path.join(APP, 'maps', 'map-kit.js'));
const CP = require(path.join(APP, 'display', 'castphoto.js'));
const LA = require(path.join(APP, 'display', 'lair.js'));
const LD = require(path.join(APP, 'display', 'lair-draw.js'));
const GCP = require(path.join(APP, 'gm', 'castphoto.js'));
const GLA = require(path.join(APP, 'gm', 'lair.js'));
const GShow = require(path.join(APP, 'gm', 'show.js'));
const Routes = (() => { const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(APP, 'routes.js'), 'utf8'), ctx, { filename: 'routes.js' }); return ctx.window.B68Load; })();
const MARK = 'GM-ONLY-b30-marker';
const flush = () => new Promise((r) => setTimeout(r, 0));

/* ---------- the switches ---------- */
await test('face.castphoto and between.lair are registered, bland, display-surface; ON whatever is stored (N0: everything built is on)', () => {
  for (const id of ['face.castphoto', 'between.lair']) {
    const s = Features.get(id);
    assert.ok(s, id); assert.equal(s.default, false); assert.equal(s.surface, 'display');
    assert.ok(s.label && s.doc && !/GM-ONLY/.test(s.doc) && s.doc.includes('Off:'), id + ' has bland text that says what off does');
    assert.equal(Features.valueOf({}, id), true, id + ': on with nothing stored');
    assert.equal(Features.valueOf({ features: { [id]: false } }, id), true, id + ': a stored false is still on');
    assert.ok(Features.publicIds().includes(id));
  }
  assert.ok(!Features.isSetting('face.castphoto') && !Features.isSetting('between.lair'), 'neither is a setting');
});
await test('routes: the display and look book carry the two renderers and their css, the lair bundle is the kit and its drawer, the GM bundle has the panels, no player bundle has any of it', () => {
  const B = Routes.BUNDLES;
  assert.equal(JSON.stringify(B.lair), '["maps/map-kit.js","display/lair-draw.js"]');
  for (const b of ['display', 'lookbook']) for (const f of ['display/castphoto.js', 'display/lair.js', 'display/castphoto.css', 'display/lair.css']) assert.ok(B[b].includes(f), b + ' ' + f);
  assert.ok(B.lookbook.includes('display/lair-draw.js') && B.lookbook.includes('maps/map-kit.js'));
  assert.ok(!B.display.includes('maps/map-kit.js'), 'the iPad fetches the map kit only when a lair is put up');
  for (const f of ['gm/castphoto.js', 'gm/lair.js', 'display/castphoto.js', 'display/lair.js', 'display/lair-draw.js']) assert.ok(B.gm.includes(f), 'gm ' + f);
  assert.ok(B.gm.indexOf('gm/lair.js') < B.gm.indexOf('gm-page.js'), 'gm-page.js stays last');
  for (const b of ['core', 'table', 'figures', 'print', 'crews', 'commend', 'debrief', 'quiet', 'board', 'claims']) assert.ok(!B[b].some((f) => /castphoto|lair/.test(f)), b + ' stays free of them');
  for (const f of ['display/castphoto.css', 'display/lair.css']) assert.ok(Routes.files().includes(f));
});

/* ---------- the server's kinds ---------- */
const FIXCP = { npcIds: ['n-mabel', 'n-dov'], sil: ['66', '74'], title: 'The Pelican Rooms' };
const FIXLA = { name: 'The Pelican Rooms', front: 'canal', layers: ['up:Workshop', 'co:Night Porters', 'fl:A brass bar'] };
await test('server: castphoto and lair are show kinds; the builders rebuild from named keys and refuse out-of-bounds payloads', () => {
  assert.ok(SHOW_KIND_IDS.includes('castphoto') && SHOW_KIND_IDS.includes('lair'));
  assert.deepEqual(cleanShowPayload('castphoto', Object.assign({ extra: 'x' }, FIXCP)), FIXCP);
  assert.deepEqual(cleanShowPayload('castphoto', { sil: ['70'] }), { npcIds: [], sil: ['70'] }, 'all silhouettes is a photo');
  assert.deepEqual(cleanShowPayload('lair', Object.assign({ extra: 'x' }, FIXLA)), FIXLA);
  const badCp = [{}, { npcIds: [] }, { npcIds: ['n-a'], sil: ['7'] }, { npcIds: ['n-a'], sil: ['39'] }, { npcIds: ['n-a'], sil: ['97'] }, { npcIds: ['n-a'], sil: [70] }, { npcIds: ['n a'] },
    { npcIds: ['n-a'], sil: Array(31).fill('70') }, { npcIds: Array.from({ length: 31 }, (_, i) => 'n' + i) }, { npcIds: ['n-a'], title: 'x'.repeat(61) }, { npcIds: 'n-a' }];
  for (const p of badCp) assert.throws(() => cleanShowPayload('castphoto', p), (e) => e.status === 400, JSON.stringify(p).slice(0, 80));
  const badLa = [{}, { name: 'x' }, { name: '', layers: ['up:a'] }, { name: 'x', layers: [] }, { name: 'x', layers: Array(25).fill('up:a') }, { name: 'x', layers: ['y'.repeat(61)] }, { name: 'x', front: 'roof', layers: ['up:a'] }, { name: 'x', layers: [3] }];
  for (const p of badLa) assert.throws(() => cleanShowPayload('lair', p), (e) => e.status === 400, JSON.stringify(p).slice(0, 80));
  assert.ok(FIXLA.layers.every((l) => showTexts({ kind: 'lair', payload: FIXLA }, null).includes(l)), 'the hidden-name scan reads every layer');
  assert.ok(showTexts({ kind: 'castphoto', payload: FIXCP }, null).includes('The Pelican Rooms'));
});

async function freshDb() { return asD1(await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') })); }
const GM = { me: { role: 'gm', email: 'gm@example.test' } }, DISPLAY = { me: { role: 'display', email: 'table@example.test' } };
const call = async (db, handler, method, url, body, who) => {
  try { return await handler({ request: new Request('http://x.test' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env: { DB: db }, data: who, waitUntil() {} }); }
  catch (e) { if (e && Number.isInteger(e.status)) return new Response(JSON.stringify({ error: e.message }), { status: e.status }); throw e; }
};
async function addNpc(db, id, doc) { const now = new Date().toISOString(); await db.prepare('INSERT INTO npcs (id, campaign, created_at, updated_at, deleted, doc) VALUES (?1, ?2, ?3, ?3, 0, ?4)').bind(id, 'default', now, JSON.stringify(doc)).run(); }
const SPEC = (h, name) => ({ figure: 'masc', shape: 'lean', heightIn: h, skin: 'tan', name });
const CAST = {
  'n-mabel': { name: 'Mabel Quist', role: 'Fixer', faction: 'The Kestrel Club', revealed: true, spec: SPEC(64, 'Mabel') },
  'n-dov': { name: 'Dov Kessler', role: 'Desk sergeant', revealed: true, spec: SPEC(73, 'Dov') },
  'n-hid': { name: 'GM-ONLY-NPC-1', alias: 'GM-ONLY-ALIAS-1', role: 'GM-ONLY-ROLE-1', revealed: false, gmNotes: 'GM-ONLY-NOTES', spec: SPEC(71, 'GM-ONLY-SPEC-NAME') },
};
const patch = async (db, body) => { const r = await call(db, ambientHandler, 'PATCH', '/api/gm/ambient', body, GM); return { status: r.status, body: await r.json() }; };
const poll = async (db) => { const r = await call(db, displayHandler, 'GET', '/api/gm/display?seq=-1&aseq=-1&sseq=-1', undefined, DISPLAY); return { status: r.status, body: await r.json(), text: null }; };

await test('server: the cast photo is joined to the revealed NPCs only; a hidden NPC reaches the iPad as a height and nothing else, on write and on every read', async () => {
  const db = await freshDb(); for (const [id, d] of Object.entries(CAST)) await addNpc(db, id, d);
  // the GM names the hidden NPC's id by mistake: it is dropped, and its height is only ever what the GM sent in sil
  let r = await patch(db, { overlay: { id: 'cp1', kind: 'castphoto', ms: 60000, payload: { npcIds: ['n-mabel', 'n-dov', 'n-hid'], sil: ['71'], title: 'Arc one' } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  let d = await poll(db); const text = JSON.stringify(d.body);
  const ov = d.body.ambient && d.body.ambient.overlay || d.body.overlay;
  assert.ok(ov && ov.kind === 'castphoto', 'the overlay is served: ' + text.slice(0, 200));
  assert.deepEqual(ov.payload.npcs.map((n) => n.npcId), ['n-mabel', 'n-dov']);
  assert.deepEqual(ov.payload.sil, ['71']); assert.equal(ov.payload.title, 'Arc one');
  assert.ok(ov.payload.npcs.every((n) => n.spec && n.spec.heightIn), 'the met come with their drawing');
  for (const m of ['GM-ONLY', 'n-hid']) assert.ok(!text.includes(m), 'the poll never carries ' + m);
  // a silhouette-only photo is allowed, and the vet does not 400 it
  r = await patch(db, { overlay: { id: 'cp2', kind: 'castphoto', ms: 60000, payload: { npcIds: ['n-hid'], sil: ['71'] } } });
  assert.equal(r.status, 200, 'the hidden id is dropped and the silhouette stands: ' + JSON.stringify(r.body));
  d = await poll(db); const ov2 = d.body.ambient && d.body.ambient.overlay || d.body.overlay;
  assert.deepEqual(ov2.payload, { npcs: [], sil: ['71'] }); assert.ok(!JSON.stringify(d.body).includes('GM-ONLY'));
  // no met and no silhouette: refused, in the same words as any other none-revealed list
  r = await patch(db, { overlay: { id: 'cp3', kind: 'castphoto', ms: 60000, payload: { npcIds: ['n-hid'] } } });
  assert.equal(r.status, 400);
  // a name in the title that is a hidden NPC's is refused by the hidden-name scan
  r = await patch(db, { overlay: { id: 'cp4', kind: 'castphoto', ms: 60000, payload: { npcIds: ['n-mabel'], title: 'Meet GM-ONLY-NPC-1' } } });
  assert.equal(r.status, 400);
  // revealed later: the next read serves the figure; hidden again: it is gone from the next read
  await db.prepare("UPDATE npcs SET doc = json_set(doc, '$.revealed', json('true')) WHERE id = 'n-hid'").run();
  r = await patch(db, { overlay: { id: 'cp5', kind: 'castphoto', ms: 60000, payload: { npcIds: ['n-mabel', 'n-hid'] } } }); assert.equal(r.status, 200);
  await db.prepare("UPDATE npcs SET doc = json_set(doc, '$.revealed', json('false')) WHERE id = 'n-hid'").run();
  d = await poll(db); const ov5 = d.body.ambient && d.body.ambient.overlay || d.body.overlay;
  assert.deepEqual(ov5.payload.npcs.map((n) => n.npcId), ['n-mabel'], 'a re-hidden NPC leaves the next poll'); assert.ok(!JSON.stringify(d.body).includes('GM-ONLY'));
});
await test('server: the lair is stored and served by named keys, as plain strings', async () => {
  const db = await freshDb();
  const r = await patch(db, { overlay: { id: 'la1', kind: 'lair', ms: 60000, payload: Object.assign({ extra: 'x' }, FIXLA) } }); assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = await poll(db); const ov = d.body.ambient && d.body.ambient.overlay || d.body.overlay;
  assert.deepEqual(ov.payload, FIXLA); assert.equal(ov.kind, 'lair');
  assert.equal((await patch(db, { overlay: { id: 'la2', kind: 'lair', ms: 60000, payload: { name: 'x', layers: [] } } })).status, 400);
});

/* ---------- the GM page's mirror ---------- */
await test('gm/show.js mirrors the two kinds: a payload it takes the server takes, and the bounds agree', () => {
  assert.ok(GShow.has('castphoto') && GShow.has('lair'));
  const ok = [['castphoto', FIXCP], ['castphoto', { sil: ['70'] }], ['castphoto', { npcIds: ['n-a'] }], ['lair', FIXLA], ['lair', { name: 'x', layers: ['up:a'] }]];
  for (const [k, p] of ok) { assert.equal(GShow.payloadOk(k, p), true, k + ' ' + JSON.stringify(p)); assert.doesNotThrow(() => cleanShowPayload(k, p)); }
  const no = [['castphoto', { npcIds: ['n-a'], extra: 1 }], ['castphoto', { title: 'x'.repeat(61), npcIds: ['n-a'] }], ['lair', { name: 'x', layers: [] }], ['lair', { name: 'x', front: 'roof', layers: ['up:a'] }], ['lair', { layers: ['up:a'] }]];
  for (const [k, p] of no) assert.equal(GShow.payloadOk(k, p), false, k + ' ' + JSON.stringify(p));
  assert.equal(GShow.overlayFor('lair', FIXLA, { ms: 180000 }).ms, 180000);
  assert.equal(GShow.overlayFor('lair', FIXLA, { ms: 180001 }), null, 'the overlay cap is three minutes');
});

/* ---------- 3.8 the pure rules ---------- */
const NPCS = {
  a: { name: 'Mabel Quist', revealed: true, tags: ['Recurring'], spec: SPEC(64) },
  b: { name: 'Dov Kessler', revealed: true, tags: ['major'], spec: SPEC(73) },
  c: { name: 'GM-ONLY-NPC-1', revealed: false, tags: ['recurring'], spec: SPEC(71, 'GM-ONLY-SPEC') },
  d: { name: 'Lotte Brand', revealed: true, tags: [], spec: SPEC(69) },
  e: { name: '', revealed: true, tags: ['recurring'] },
};
await test('castphoto pure: the roster is the tagged NPCs, then the arc\'s own list; the payload sends ids for the met and heights for the rest', () => {
  const cands = GCP.candidates(NPCS);
  assert.deepEqual(cands.map((c) => c.id), ['b', 'c', 'a', 'd'], 'tagged first, then by name; the nameless one is not a candidate');
  const sel = GCP.chosen(cands, null);
  assert.deepEqual(sel.map((c) => c.id), ['b', 'c', 'a']);
  const p = GCP.payload(sel, 'Arc one');
  assert.deepEqual(p, { npcIds: ['b', 'a'], sil: ['71'], title: 'Arc one' });
  assert.ok(!JSON.stringify(p).includes('GM-ONLY'), 'the hidden NPC is a number');
  assert.doesNotThrow(() => cleanShowPayload('castphoto', p));
  let arc = GCP.toggle(null, cands, 'a'); assert.deepEqual(arc.ids, ['b', 'c'], 'the first toggle starts from the default and takes one out');
  arc = GCP.toggle(arc, cands, 'd'); assert.deepEqual(GCP.chosen(cands, arc).map((c) => c.id), ['b', 'c', 'd']);
  assert.deepEqual(GCP.chosen(cands, { ids: ['zzz'] }), [], 'an arc naming only gone NPCs is empty, not the default');
  assert.equal(GCP.payload([], 't'), null);
  assert.equal(GCP.slug('The Pelican Rooms, Act 1!'), 'the-pelican-rooms-act-1'); assert.equal(GCP.slug('!!'), 'arc');
  assert.deepEqual(GCP.cleanArc({ title: '  T  ', ids: ['a', 'a', 'b c', {}, 'd'] }), { v: 1, title: 'T', ids: ['a', 'd'] });
  const it = GCP.items(sel); assert.deepEqual(it.map((x) => x.name), ['Dov Kessler', 'Mabel Quist', ''], 'the unmet has no name and no spec in the drawing');
  assert.equal(it[2].spec, null);
});

/* ---------- 3.8 the line-up ---------- */
await test('castphoto drawing: a true-height line-up from the kit; a silhouette is drawn from a height alone; the same input draws the same bytes', () => {
  const items = CP.items([{ name: 'Mabel Quist', spec: SPEC(64) }, { name: 'Dov Kessler', spec: SPEC(73) }], ['66', '74']);
  assert.deepEqual(items.map((i) => i.h), [64, 73, 66, 74]);
  const d = CP.compose(items, { kit: Fig, title: 'The Pelican Rooms' });
  assert.equal(d.count, 4); assert.ok(d.svg.startsWith('<svg') && d.svg.length > 1000); assert.deepEqual(d.warnings, []);
  assert.ok(d.svg.includes('Mabel Quist') && d.svg.includes('THE PELICAN ROOMS') && (d.svg.match(/>\?</g) || []).length === 2, 'two question marks for two silhouettes');
  assert.equal(CP.compose(items, { kit: Fig, title: 'The Pelican Rooms' }).svg, d.svg, 'deterministic');
  const one = CP.compose([{ name: '', spec: null, h: 70 }], { kit: Fig });
  assert.equal(one.count, 1);
  assert.equal(CP.compose([], { kit: Fig }).count, 0);
  assert.equal(CP.items(Array.from({ length: 40 }, (_, i) => ({ name: 'n' + i, spec: SPEC(66) })), []).length, 30, 'at most thirty people');
  assert.equal(CP.fit({ heightIn: 10 }), 40); assert.equal(CP.fit({ heightIn: 200 }), 96); assert.equal(CP.fit(null), 68);
  assert.ok(!/<script|onload=|javascript:/i.test(CP.scrub('<svg onload="x()"><script>y()</script><a href="javascript:z()">q</a></svg>')));
  const names = CP.compose(CP.items([{ name: '<b>"x"&', spec: SPEC(66) }], []), { kit: Fig });
  assert.ok(!names.svg.includes('<b>') && names.svg.includes('&lt;b&gt;'), 'a name is escaped into the svg');
});
await test('castphoto print page: A4 landscape, the drawing only; a hidden NPC\'s name is nowhere on it', () => {
  const cands = GCP.candidates(NPCS), sel = GCP.chosen(cands, null);
  const d = CP.compose(GCP.items(sel), { kit: Fig, title: 'Arc one' });
  const html = GCP.printHtml(d.svg, 'Arc one');
  assert.ok(html.includes('@page{size:A4 landscape') && html.includes('<svg'));
  assert.ok(!html.includes('GM-ONLY'), 'no hidden name on paper');
});

/* ---------- 3.8 the controller ---------- */
function recorder() {
  const rows = new Map(), calls = { put: [], show: [], night: [], print: [] };
  return {
    rows, calls,
    host: {
      enabled: () => true, npcs: () => NPCS, kit: () => Fig, now: () => 1234,
      night: () => ({ stamp: (t) => calls.night.push(t) }),
      docs: { list: async (k) => [...rows.entries()].filter(([key]) => key.startsWith(k + '|')).map(([key, v]) => ({ kind: k, owner: key.split('|')[1], scope: v.scope, json: v.json })),
        put: async (row) => { calls.put.push(row); rows.set(row.kind + '|' + (row.owner || '_'), { scope: row.scope, json: row.json }); return {}; } },
      show: async (kind, payload, o) => { calls.show.push({ kind, payload, o }); return { ok: true }; },
      print: (html) => { calls.print.push(html); return true; },
    },
  };
}
await test('castphoto controller: a new arc is a GM-scope row owned by its slug; toggling saves; show sends the split payload for three minutes; print draws; it changes nothing with the switch off', async () => {
  const R = recorder(), c = GCP.create(R.host);
  await c.refresh(); assert.deepEqual(c.arcs(), []);
  await c.newArc('Arc One');
  assert.equal(R.calls.put.length, 1); assert.equal(R.calls.put[0].kind, 'castphoto'); assert.equal(R.calls.put[0].owner, 'arc-one'); assert.equal(R.calls.put[0].scope, 'gm');
  assert.equal(c.current().chosen.length, 3, 'a fresh arc starts from the tagged NPCs');
  await c.toggle('a'); assert.deepEqual(R.rows.get('castphoto|arc-one').json.ids, ['b', 'c']);
  assert.equal(await c.show(), true);
  const s = R.calls.show[0]; assert.equal(s.kind, 'castphoto'); assert.deepEqual(s.payload, { npcIds: ['b'], sil: ['71'], title: 'Arc One' }); assert.equal(s.o.ms, 180000);
  assert.ok(GShow.payloadOk('castphoto', s.payload), 'the page\'s own mirror takes it');
  assert.ok(R.calls.night[0].includes('Cast photo'));
  assert.equal(c.print(), true); assert.ok(R.calls.print[0].includes('<svg') && !R.calls.print[0].includes('GM-ONLY'));
  const c2 = GCP.create(R.host); await c2.refresh(); assert.equal(c2.current().arc.ids.length, 2, 'a reload finds the saved arc');
  const off = GCP.create(Object.assign({}, R.host, { enabled: () => false })); await off.refresh(); assert.deepEqual(off.arcs(), []);
  const none = GCP.create(Object.assign({}, R.host, { npcs: () => ({}) })); await none.refresh(); assert.equal(await none.show(), false);
});

/* ---------- 5.4 the layers ---------- */
const CREW = {
  name: 'The Floor Crew', playbook: 'dealers',
  upgrades: { Workshop: 1, Vault: 2, Boat: 1, Documents: 1, Gear: 1, Insight: 0, 'Hustlers cohort': 1, 'Lounge and quarters': 0 },
  cohorts: [{ name: 'Night Porters', type: 'Hustlers' }, { name: '', type: 'Muscle' }],
};
await test('lair layers: base upgrades, cohorts, flair and the sheet\'s other upgrades, in that order; a cohort upgrade is not a layer; hold-back and flair come from the GM row', () => {
  const layers = LA.layersOf(CREW, { flair: ['A brass bar'] });
  assert.deepEqual(layers, ['up:Vault'.replace('Vault', 'Workshop'), 'up:Vault', 'up:Boat', 'co:Night Porters', 'co:Muscle cohort', 'fl:A brass bar', 'up:Documents', 'up:Gear']);
  assert.deepEqual(LA.layersOf(CREW, { hide: ['up:Vault', 'fl:x'] }).includes('up:Vault'), false);
  assert.deepEqual(LA.layersOf({ flair: ['Mirror ball', { name: 'Neon' }, ''] }, {}), ['fl:Mirror ball', 'fl:Neon'], 'a crew.flair list is read when the sheet has one');
  assert.deepEqual(LA.layersOf(null, null), []);
  assert.equal(LA.layersOf({ upgrades: Object.fromEntries(Array.from({ length: 40 }, (_, i) => ['U' + i, 1])) }, {}).length, 24, 'at most 24');
  const pay = LA.payloadOf(CREW, { flair: ['A brass bar'] });
  assert.deepEqual(pay, { name: 'The Floor Crew', front: 'canal', layers });
  assert.equal(LA.payloadOf({ upgrades: { Van: 1 } }, {}).front, 'street'); assert.equal(LA.payloadOf({ upgrades: { Van: 1 } }, { front: 'canal' }).front, 'canal');
  assert.deepEqual(LA.payloadOf({}, {}), { name: 'The base', front: 'street', layers: ['bare:base'] });
  assert.doesNotThrow(() => cleanShowPayload('lair', pay)); assert.ok(GShow.payloadOk('lair', pay));
  assert.deepEqual(LA.parse(layers), { upgrades: ['Workshop', 'Vault', 'Boat', 'Documents', 'Gear'], cohorts: ['Night Porters', 'Muscle cohort'], flair: ['A brass bar'] });
});
await test('lair plan: each layer adds a room or a line; the Common room is always there; overflow is named, not lost', () => {
  const bare = LA.placed({ name: 'x', layers: ['bare:base'] }); assert.deepEqual(bare.rooms, ['Common room']); assert.deepEqual(bare.held, []);
  const all = LA.placed({ name: 'x', layers: ['up:Lounge and quarters', 'up:Workshop', 'up:Vault', 'up:Secure', 'up:Hidden', 'up:Van', 'up:Boat', 'co:A', 'co:B', 'co:C', 'co:D', 'co:E', 'fl:F1', 'fl:F2', 'fl:F3', 'up:Gear'] });
  assert.deepEqual(all.rooms, ['Common room', 'Lounge and quarters', 'Garage', 'Workshop', 'Vault', 'Secure rooms', 'Hidden room', 'A', 'B', 'C', 'D', 'F1', 'F2']);
  assert.deepEqual(all.notes, ['E (cohort)', 'F3 (flair)']); assert.deepEqual(all.held, ['Gear', 'Boat']);
  const dup = LA.placed({ name: 'x', layers: ['co:Porters', 'co:porters'] }); assert.deepEqual(dup.rooms, ['Common room', 'Porters', 'porters 2'], 'two cohorts of one name stay two rooms');
  assert.deepEqual(LA.captionOf(CREW && LA.payloadOf(CREW, {})), ['Fitted out: Documents, Gear, Boat']);
});
await test('lair drawing: the kit\'s section draws every combination with no unknown-room warning; each layer changes the picture; the same layers draw the same bytes', () => {
  const draw = (layers, front) => LD.draw({ name: 'The Pelican Rooms', front: front || 'street', layers }, Kit);
  const seen = new Set();
  const sets = [['bare:base'], ['up:Lounge and quarters'], ['up:Workshop'], ['up:Vault'], ['up:Secure'], ['up:Hidden'], ['co:Porters'], ['fl:A brass bar'], ['up:Van'], LA.FIXTURE.layers,
    ['up:Lounge and quarters', 'up:Workshop', 'up:Vault', 'up:Secure', 'up:Hidden', 'up:Van', 'up:Boat', 'co:A', 'co:B', 'co:C', 'co:D', 'co:E', 'fl:F1', 'fl:F2', 'fl:F3', 'up:Gear']];
  for (const l of sets) {
    const d = draw(l, l.includes('up:Boat') ? 'canal' : 'street');
    assert.ok(d && d.svg.startsWith('<svg'), l.join());
    assert.ok(!d.warnings.some((w) => /not in the catalogue|is not one of|unknown/i.test(w)), l.join() + ': ' + d.warnings.join(' | '));
    assert.ok(!seen.has(d.svg), 'each set of layers draws its own picture: ' + l.join()); seen.add(d.svg);
  }
  assert.equal(draw(LA.FIXTURE.layers, 'canal').svg, draw(LA.FIXTURE.layers, 'canal').svg);
  const flat = draw(['up:Vault'], 'street').svg, more = draw(['up:Vault', 'up:Workshop'], 'street').svg;
  assert.ok(more.length > flat.length, 'a layer adds to the picture');
  assert.equal(LD.draw(null, Kit), null); assert.equal(LD.draw(LA.FIXTURE, null), null);
});
await test('map kit: a room may name its own archetype; a roll without one draws as it always did', () => {
  const base = { name: 'T', district: 'D', rooms: [{ name: 'Showroom', band: 'public' }, { name: 'Vault', band: 'secure', isTarget: true }], vectors: [{ n: 'F', how: 'x', know: 'free', room: 'Showroom', level: 'street', means: 'door' }], skips: [], areas: ['Showroom', 'Vault'], seed: 3 };
  const w0 = Kit.render(base, { view: 'plan' }).warnings.filter((w) => /catalogue/.test(w));
  const odd = JSON.parse(JSON.stringify(base)); odd.rooms[1].name = 'My strongroom';
  assert.ok(Kit.render(odd, { view: 'plan' }).warnings.some((w) => /not in the catalogue/.test(w)), 'unknown stays a warning without an arch');
  odd.rooms[1].arch = 'vault';
  const r = Kit.render(odd, { view: 'plan' });
  assert.ok(!r.warnings.some((w) => /My strongroom.*catalogue/.test(w)), 'with a known arch it is furnished');
  odd.rooms[1].arch = 'no-such-thing';
  assert.ok(Kit.render(odd, { view: 'plan' }).warnings.some((w) => /My strongroom.*catalogue/.test(w)), 'an unknown arch is ignored');
  assert.deepEqual(w0.filter((w) => /Showroom/.test(w)), []);
});

/* ---------- 5.4 the controller ---------- */
await test('lair controller: flair and hold-backs are one GM-scope row owned by _; layers are read from the crew sheet every time; show sends the payload for three minutes', async () => {
  const R = recorder(); let crew = CREW;
  const c = GLA.create(Object.assign({}, R.host, { crew: () => crew }));
  await c.refresh(); assert.equal(c.view().all.length, 7);
  await c.addFlair('A brass bar');
  assert.equal(R.calls.put[0].kind, 'lair'); assert.equal(R.calls.put[0].owner, '_'); assert.equal(R.calls.put[0].scope, 'gm'); assert.deepEqual(R.calls.put[0].json.flair, ['A brass bar']);
  assert.ok(c.view().all.some((a) => a.layer === 'fl:A brass bar' && a.kind === 'flair'));
  await c.toggleHide('up:Boat'); assert.equal(c.view().all.find((a) => a.layer === 'up:Boat').hidden, true);
  assert.ok(!c.view().payload.layers.includes('up:Boat') && c.view().payload.front === 'street', 'a held-back layer is off the payload');
  await c.setName('The Pelican Rooms'); await c.setFront('canal');
  assert.equal(await c.show(), true);
  const s = R.calls.show[0]; assert.equal(s.kind, 'lair'); assert.equal(s.o.ms, 180000); assert.equal(s.payload.name, 'The Pelican Rooms'); assert.equal(s.payload.front, 'canal');
  assert.ok(GShow.payloadOk('lair', s.payload)); assert.ok(R.calls.night[0].includes('lair'));
  crew = Object.assign({}, CREW, { upgrades: Object.assign({}, CREW.upgrades, { Secure: 1 }) });
  assert.ok(c.view().payload.layers.includes('up:Secure'), 'the base grows as the sheet does, with nothing to save');
  const pv = c.preview(); assert.ok(pv.svg.startsWith('<svg') && pv.caption.length);
  const c2 = GLA.create(Object.assign({}, R.host, { crew: () => crew })); await c2.refresh(); assert.deepEqual(c2.state().flair, ['A brass bar']); assert.deepEqual(c2.state().hide, ['up:Boat']);
  assert.deepEqual(GLA.removeFlair({ flair: ['a', 'b'], hide: ['fl:a'] }, 'a'), { v: 1, name: '', front: '', flair: ['b'], hide: [] });
  assert.equal(GLA.addFlair({ flair: [] }, '  ').flair.length, 0);
  assert.equal(GLA.addFlair({ flair: ['x'] }, 'X').flair.length, 1, 'flair is unique without regard to case');
  const off = GLA.create(Object.assign({}, R.host, { enabled: () => false, crew: () => crew })); assert.deepEqual((await off.refresh()).flair, []);
});

/* ---------- the display renderers ---------- */
function fakeDoc() {
  const made = [];
  const mk = (tag) => { const e = { tag, className: '', children: [], style: { setProperty() {} }, attrs: {}, _t: '', innerHTML: '', classList: { add() {} }, set textContent(v) { this._t = v; }, get textContent() { return this._t; }, appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; } }; made.push(e); return e; };
  return { doc: { createElement: mk }, made };
}
const walk = (n, out = []) => { out.push(n); (n.children || []).forEach((c) => walk(c, out)); return out; };
await test('display: the cast photo kind registers with a fixture, cleans a served payload, and renders the drawing plus a count', async () => {
  const D = fakeDoc(); const ctx = { document: D.doc, B68Figure: Fig }; ctx.self = ctx; vm.createContext(ctx);
  for (const f of ['shows.js', 'castphoto.js']) vm.runInContext(fs.readFileSync(path.join(APP, 'display', f), 'utf8'), ctx, { filename: f });
  const S = ctx.B68Shows; assert.ok(S.has('castphoto'));
  const e = S.entry('castphoto'); assert.ok(e.fixture && e.fixture.npcs.length === 3 && e.fixture.sil.length === 2 && e.ms === 180000);
  const c = S.clean('castphoto', e.fixture); assert.ok(c && c.npcs.length === 3 && c.sil.length === 2 && c.title === 'The Pelican Rooms');
  assert.equal(S.clean('castphoto', {}), null); assert.equal(S.clean('castphoto', { npcs: [] }), null);
  assert.deepEqual(S.clean('castphoto', { npcs: [], sil: ['70', 'x', '7'] }).sil, ['70'], 'a served silhouette is a height and nothing else');
  assert.deepEqual(Object.keys(S.clean('castphoto', { npcs: [{ npcId: 'n-a', name: 'A', spec: SPEC(66), gmNotes: MARK }], sil: ['70'], gm: MARK }).npcs[0]).sort(), ['alias', 'faction', 'name', 'npcId', 'role', 'spec']);
  const node = await S.mount({ kind: 'castphoto', payload: e.fixture }, { document: D.doc });
  assert.ok(node && /dp-show-castphoto/.test(node.className));
  const all = walk(node), photo = all.find((n) => /dp-cp-photo/.test(n.className));
  assert.ok(photo && photo.innerHTML.startsWith('<svg'));
  /* the GM night rebuild: on the iPad a name is two lines in the label face (the first name over the rest), large enough for 1 to 1.5 m */
  assert.ok(/>MABEL<\/tspan><tspan[^>]*dy="1\.12em"[^>]*>QUIST<\/tspan>/.test(photo.innerHTML), 'the name over two lines');
  const capSizes = [...photo.innerHTML.matchAll(/<text [^>]*font-weight="900" font-size="([\d.]+)"/g)].map((m) => Number(m[1]));
  assert.ok(capSizes.length >= 5, 'a caption per person: ' + capSizes.length);
  const preview = CP.compose(CP.items(e.fixture.npcs, e.fixture.sil), { kit: Fig, title: 'The Pelican Rooms' });
  assert.ok(preview.svg.includes('>Mabel Quist</text>'), 'the GM page preview and the print keep the one-line caption');
  assert.ok(all.some((n) => n.textContent === '3 faces · 2 still unknown'));
});
await test('display: the lair kind is registered with a bundle, not a renderer, until the drawer loads; then it renders the section and its caption', async () => {
  const D = fakeDoc(); const loads = []; const ctx = { document: D.doc, B68Figure: Fig, B68Map: Kit }; ctx.self = ctx; vm.createContext(ctx);
  ctx.B68Load = { need: (b) => { loads.push(b); for (const f of ['castphoto.js', 'lair-draw.js']) vm.runInContext(fs.readFileSync(path.join(APP, 'display', f), 'utf8'), ctx, { filename: f }); return Promise.resolve(); } };
  for (const f of ['shows.js', 'lair.js']) vm.runInContext(fs.readFileSync(path.join(APP, 'display', f), 'utf8'), ctx, { filename: f });
  const S = ctx.B68Shows; assert.ok(S.has('lair'));
  const e = S.entry('lair'); assert.ok(e.fixture && e.ms === 180000);
  assert.equal(S.clean('lair', { name: 'x' }), null); assert.equal(S.clean('lair', { name: 'x', layers: ['up:a'], front: 'roof' }).front, undefined);
  assert.deepEqual(loads, []);
  const node = await S.mount({ kind: 'lair', payload: e.fixture }, { document: D.doc });
  assert.deepEqual(loads, ['lair'], 'the kit is fetched when the first lair is shown');
  assert.ok(node && /dp-show-lair/.test(node.className));
  const all = walk(node), section = all.find((n) => /dp-lair-section/.test(n.className));
  assert.ok(section && section.innerHTML.startsWith('<svg'));
  assert.ok(all.some((n) => n.textContent === 'The Pelican Rooms') && all.some((n) => /Fitted out: Documents, Gear, Boat/.test(n.textContent)));
  const again = await S.mount({ kind: 'lair', payload: e.fixture }, { document: D.doc }); assert.ok(again, 'a second lair draws too');
});
await test('look book: both kinds are drawn from invented fixtures with no GM-only text and no campaign name', () => {
  const text = JSON.stringify([CP.FIXTURE, LA.FIXTURE]);
  assert.ok(!/GM-ONLY/.test(text));
  const src = ['display/castphoto.js', 'display/lair.js', 'display/lair-draw.js', 'gm/castphoto.js', 'gm/lair.js', '../functions/_lib/show-castphoto.js'].map((f) => fs.readFileSync(path.join(APP, f), 'utf8')).join('\n');
  assert.ok(!/Anthropic|ANTHROPIC_API_KEY|api\.anthropic/i.test(src), 'no model, no key');
  assert.ok(!/fetch\(|XMLHttpRequest/.test(fs.readFileSync(path.join(APP, 'display', 'castphoto.js'), 'utf8') + fs.readFileSync(path.join(APP, 'display', 'lair.js'), 'utf8')), 'the display half never calls the network');
});

/* ---------- the Menu, with the switches off ---------- */
await test('N2: there is no Menu line any more; sync() only takes down a stale one, and says false', () => {
  const removed = [];
  const stale = { parentNode: { removeChild: (n) => removed.push(n) } };
  const rootEl = { querySelector: (sel) => (sel === '#gm-menu-castphoto' || sel === '#gm-menu-lair' ? stale : null) };
  const win = { document: {}, B68Features: Features };
  const C = vm.runInNewContext(fs.readFileSync(path.join(APP, 'gm', 'castphoto.js'), 'utf8') + '\n;B68GmCastPhoto', Object.assign(win, { self: win }));
  const L = vm.runInNewContext(fs.readFileSync(path.join(APP, 'gm', 'lair.js'), 'utf8') + '\n;B68GmLair', Object.assign(win, { self: win }));
  assert.equal(C.sync(rootEl, {}), false); assert.equal(L.sync(rootEl, {}), false); assert.equal(removed.length, 2, 'a line an older page drew is taken down');
  assert.equal(C.sync({ querySelector: () => null }), false);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
