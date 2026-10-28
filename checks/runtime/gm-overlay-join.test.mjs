// The read-time joins of an overlay to its clock or NPC (functions/_lib/campaign.js joinOverlayClock, functions/_lib/npcs.js joinOverlayNpc),
// on a fake D1 that answers the one query each makes: what is dropped (hidden, removed, nameless, the old shape with no clockId), what is
// attached (the live fill; only the figure's drawing keys of a spec), and how many reads it costs. INVENTED data only.
//   node checks/runtime/gm-overlay-join.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { joinOverlayClock, assertOverlayClock } from '../../functions/_lib/campaign.js';
import { joinOverlayNpc, drawingSpec, FIGURE_SPEC_KEYS, FIGURE_SPEC_LABELS } from '../../functions/_lib/npcs.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);

let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

/* a fake D1: .prepare(sql).bind(..).first() answers with `row`, and counts how many reads were made */
const fakeDb = (row) => { const db = { reads: 0, sql: [], prepare(sql) { db.sql.push(sql); return { bind: () => ({ first: async () => { db.reads++; return typeof row === 'function' ? row(sql) : row; } }) }; } }; return db; };
const clocksRow = (list) => ({ clocks: JSON.stringify(list) });
const clk = (id, name, size, filled, hidden) => ({ id, name, size, filled, kind: 'danger', hidden: !!hidden });
const amb = (overlay) => ({ seq: 4, doc: { mode: 'auto', ...(overlay ? { overlay } : {}) }, updatedAt: 'x' });
const CK = { id: 'o1', kind: 'clock', ms: 20000, clockId: 'c_a1', at: '2026-10-28T00:00:00.000Z', age: 500 };

await test('a clock overlay is joined to its clock: name, size and the LIVE fill, overwriting anything stored; one read', async () => {
  const db = fakeDb(clocksRow([clk('c_a1', 'Invented Fuse', 6, 3)]));
  const r = await joinOverlayClock(db, 'camp', amb({ ...CK, name: 'STALE-NAME', size: 4, filled: 0 }));
  assert.equal(r.dropped, false); assert.equal(r.follows, true);
  assert.deepEqual([r.amb.doc.overlay.name, r.amb.doc.overlay.size, r.amb.doc.overlay.filled], ['Invented Fuse', 6, 3], 'the clock\'s own, not the stored');
  assert.equal(r.amb.doc.overlay.clockId, 'c_a1'); assert.equal(r.amb.doc.overlay.age, 500, 'the rest of the overlay (age, ms) is kept');
  assert.equal(db.reads, 1, 'one read'); assert.match(db.sql[0], /json_extract\(doc, '\$\.clocks'\)/, 'only the clocks are cut out in SQL');
  assert.equal(r.amb.doc.mode, 'auto', 'the rest of the ambient part is kept');
  const db2 = fakeDb(clocksRow([clk('c_a1', 'Invented Fuse', 6, 5)]));
  assert.equal((await joinOverlayClock(db2, 'camp', amb(CK))).amb.doc.overlay.filled, 5, 'it follows the clock');
});

await test('hidden, removed, nameless, and a bad id: the overlay is dropped (positive control: the visible one stays)', async () => {
  const cases = [['hidden', [clk('c_a1', 'Invented Fuse', 6, 3, true)]], ['removed', [clk('c_zz', 'Other', 6, 3)]], ['nameless', [clk('c_a1', '   ', 6, 3)]], ['no clocks', []]];
  for (const [why, list] of cases) {
    const r = await joinOverlayClock(fakeDb(clocksRow(list)), 'camp', amb(CK));
    assert.equal(r.dropped, true, why); assert.equal(r.follows, false); assert.ok(!('overlay' in r.amb.doc), why + ': left out'); assert.equal(r.amb.doc.mode, 'auto');
  }
  const r2 = await joinOverlayClock(fakeDb(null), 'camp', amb(CK)); assert.equal(r2.dropped, true, 'no campaign row at all');
  const r3 = await joinOverlayClock(fakeDb({ clocks: '{not json' }), 'camp', amb(CK)); assert.equal(r3.dropped, true, 'unreadable clocks');
  const r4 = await joinOverlayClock(fakeDb(clocksRow([clk('c_a1', 'Invented Fuse', 6, 3)])), 'camp', amb({ ...CK, clockId: 'has space' })); assert.equal(r4.dropped, true, 'a bad id');
  const ok = await joinOverlayClock(fakeDb(clocksRow([clk('c_a1', 'Invented Fuse', 6, 3, false)])), 'camp', amb(CK));
  assert.equal(ok.dropped, false); assert.ok(ok.amb.doc.overlay, 'positive control: visible, kept');
});

await test('the OLD shape (a clock overlay with a name and no clockId) is dropped on read, never rendered, and costs no read', async () => {
  const db = fakeDb(clocksRow([clk('c_a1', 'Invented Fuse', 6, 3)]));
  const old = { id: 'old1', kind: 'clock', ms: 60000, name: 'Old Stored Name', size: 6, filled: 2, at: '2026-10-28T00:00:00.000Z' };
  const r = await joinOverlayClock(db, 'camp', amb(old));
  assert.equal(r.dropped, true); assert.ok(!('overlay' in r.amb.doc)); assert.ok(!JSON.stringify(r.amb).includes('Old Stored Name'));
  assert.equal(db.reads, 0, 'no clockId, nothing to read');
});

await test('other overlays pass untouched with no read: a dawn, a line of text, an npc one, none at all', async () => {
  for (const o of [{ id: 'f', kind: 'fx', fx: 'dawn', ms: 30000 }, { id: 't', kind: 'text', text: 'x', ms: 5000 }, { id: 'n', kind: 'npc', npcId: 'npc_a', ms: 5000 }, null]) {
    const db = fakeDb(clocksRow([])), a = amb(o);
    const r = await joinOverlayClock(db, 'camp', a);
    assert.equal(r.amb, a); assert.equal(r.dropped, false); assert.equal(r.follows, false); assert.equal(db.reads, 0);
  }
});

await test('assertOverlayClock (at set time): 400 for hidden / missing / nameless in the same words; passes a visible one; nothing returned of the clock', async () => {
  const list = [clk('c_a1', 'Invented Fuse', 6, 3), clk('c_h', 'Hidden Invented', 4, 1, true), clk('c_n', '', 4, 1)];
  assert.equal(await assertOverlayClock(fakeDb(clocksRow(list)), 'camp', 'c_a1'), undefined, 'a visible clock passes and returns nothing');
  const msgs = [];
  for (const id of ['c_h', 'c_missing', 'c_n']) {
    try { await assertOverlayClock(fakeDb(clocksRow(list)), 'camp', id); assert.fail('accepted ' + id); } catch (e) { assert.equal(e.status, 400); msgs.push(e.message); }
  }
  assert.equal(new Set(msgs).size, 1, 'the same words'); assert.ok(!msgs[0].includes('Hidden Invented'));
});

/* ---------- the NPC join and the spec's drawing keys ---------- */
const npcRow = (doc, extra) => ({ id: 'npc_a', campaign: 'camp', created_at: 'x', updated_at: 'y', deleted: 0, doc: JSON.stringify(doc), ...(extra || {}) });
const NPCO = { id: 'n1', kind: 'npc', ms: 20000, npcId: 'npc_a' };
const BASE_DOC = { name: 'Inspector Invented', alias: 'Inky', role: 'Clerk', faction: 'The Invented Guild', description: 'DESC-MARKER', gmNotes: 'GMNOTES-MARKER', tags: ['TAG-MARKER'], revealed: true };

await test('the NPC join copies only the figure\'s drawing keys of a spec: an unknown key, a label and a nested stray are stripped; a drawing key is kept whole', async () => {
  const spec = { id: 'LABEL-ID', name: 'LABEL-NAME', plate: 'LABEL-PLATE', code: 'LABEL-CODE', halo: 'slate-500', notes: 'UNKNOWN-MARKER', secretField: { deep: 'UNKNOWN-DEEP' }, heightIn: 61, figure: 'masc', shape: 'lean', build: 1, skin: 'olive', age: 34,
    pose: { stance: 'easy', arms: { R: 'down', L: 'pocket' } }, head: { shape: 'oval' }, face: { eyes: 'almond' }, hair: { style: 'short' }, outfit: { base: { type: 'shirt', color: 'cloth-cream' } }, props: [{ type: 'cigarette' }], companion: { type: 'dog' } };
  const db = fakeDb(npcRow({ ...BASE_DOC, spec }));
  const r = await joinOverlayNpc(db, 'camp', amb(NPCO));
  assert.equal(r.dropped, false);
  const out = r.amb.doc.overlay.npc;
  assert.deepEqual(Object.keys(out).sort(), ['alias', 'faction', 'name', 'role', 'spec']);
  assert.deepEqual(Object.keys(out.spec).sort(), ['age', 'build', 'companion', 'face', 'figure', 'hair', 'head', 'heightIn', 'outfit', 'pose', 'props', 'shape', 'skin']);
  assert.deepEqual(out.spec.pose, spec.pose); assert.deepEqual(out.spec.outfit, spec.outfit); assert.equal(out.spec.heightIn, 61, 'drawing keys are kept whole');
  const text = JSON.stringify(r.amb);
  assert.ok(!/LABEL-|UNKNOWN-|DESC-MARKER|GMNOTES-MARKER|TAG-MARKER|"revealed"/.test(text), 'nothing else of the row or the spec: ' + text.slice(0, 200));
  assert.equal(db.reads, 1, 'one read');
  const hid = await joinOverlayNpc(fakeDb(npcRow({ ...BASE_DOC, revealed: false, spec })), 'camp', amb(NPCO));
  assert.equal(hid.dropped, true, 'positive control beside the strip: a hidden NPC is dropped'); assert.ok(!('overlay' in hid.amb.doc));
  assert.equal((await joinOverlayNpc(fakeDb(npcRow({ ...BASE_DOC, spec: 'junk' })), 'camp', amb(NPCO))).amb.doc.overlay.npc.spec, null, 'a junk spec is null');
});

await test('drawingSpec: only the listed keys, a non-object is null, the input is not mutated', () => {
  const s = { figure: 'fem', zzz: 1, name: 'x' }; const copy = JSON.stringify(s);
  assert.deepEqual(drawingSpec(s), { figure: 'fem' }); assert.equal(JSON.stringify(s), copy);
  for (const v of [null, undefined, 'x', 5, [], [1]]) assert.equal(drawingSpec(v), null);
  assert.deepEqual(drawingSpec({}), {});
});

await test('the whitelist covers the figure kit: every top-level key normalise() reads or produces is a drawing key or one of the labels left out', () => {
  const K = require(path.join(ROOT, 'app', 'figures', 'figure-kit.js'));
  const norm = K.normalise({});
  const known = new Set([...FIGURE_SPEC_KEYS, ...FIGURE_SPEC_LABELS, '_fixed']);
  const stray = Object.keys(norm).filter((k) => !known.has(k));
  assert.deepEqual(stray, [], 'keys the kit produces that the join would strip: ' + stray.join());
  const filled = K.normalise({ figure: 'fem', jewelry: [], heads: [], companion: { type: 'dog' }, props: [{ type: 'cigarette' }], body: {}, bigLeg: 'right', seed: 3, age: 40 });
  assert.deepEqual(Object.keys(filled).filter((k) => !known.has(k)), []);
  assert.ok(FIGURE_SPEC_KEYS.every((k) => !FIGURE_SPEC_LABELS.includes(k)), 'no key is both');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
