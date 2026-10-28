// The read-time joins of an overlay to its clock or NPC (functions/_lib/campaign.js joinOverlayClock, functions/_lib/npcs.js joinOverlayNpc),
// on a fake D1 that answers the one query each makes: what is dropped (hidden, removed, nameless, the old shape with no clockId), what is
// attached (the live fill; only the figure's drawing keys of a spec), and how many reads it costs. INVENTED data only.
//   node checks/runtime/gm-overlay-join.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { joinOverlayClock, assertOverlayClock } from '../../functions/_lib/campaign.js';
import { namesHit as serverNamesHit, loadHiddenNames, patchAmbient, loadAmbient, cleanIfOverlay } from '../../functions/_lib/gm.js';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
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

await test('both joins are built from named keys: a stray key on the stored overlay (and its secret) is not served, the named ones are, an absent age/auto stays absent', async () => {
  const stray = { secretStray: 'STRAY-MARKER', text: 'TEXT-MARKER', npc: { name: 'STORED-NPC-MARKER' } };
  const c = await joinOverlayClock(fakeDb(clocksRow([clk('c_a1', 'Invented Fuse', 6, 3)])), 'camp', amb({ ...CK, auto: true, ...stray }));
  assert.deepEqual(Object.keys(c.amb.doc.overlay).sort(), ['age', 'at', 'auto', 'clockId', 'filled', 'id', 'kind', 'ms', 'name', 'size'], 'the named keys of a clock overlay and nothing more');
  assert.ok(!/STRAY-MARKER|TEXT-MARKER|STORED-NPC-MARKER/.test(JSON.stringify(c.amb)));
  const bare = await joinOverlayClock(fakeDb(clocksRow([clk('c_a1', 'Invented Fuse', 6, 3)])), 'camp', amb({ id: 'o1', kind: 'clock', ms: 20000, clockId: 'c_a1' }));
  assert.deepEqual(Object.keys(bare.amb.doc.overlay).sort(), ['clockId', 'filled', 'id', 'kind', 'ms', 'name', 'size'], 'no age, at or auto keys when the stored overlay has none');
  const n = await joinOverlayNpc(fakeDb(npcRow(BASE_DOC)), 'camp', amb({ ...NPCO, at: '2026-10-28T00:00:00.000Z', age: 9, auto: true, ...stray, name: 'STALE-NAME-MARKER' }));
  assert.deepEqual(Object.keys(n.amb.doc.overlay).sort(), ['age', 'at', 'auto', 'id', 'kind', 'ms', 'npc', 'npcId'], 'the named keys of an npc overlay and nothing more');
  assert.ok(!/STRAY-MARKER|TEXT-MARKER|STORED-NPC-MARKER|STALE-NAME-MARKER/.test(JSON.stringify(n.amb)));
  assert.equal(n.amb.doc.overlay.npc.name, 'Inspector Invented', 'the joined card is the row\'s, not the stored one');
  const nb = await joinOverlayNpc(fakeDb(npcRow(BASE_DOC)), 'camp', amb(NPCO));
  assert.deepEqual(Object.keys(nb.amb.doc.overlay).sort(), ['id', 'kind', 'ms', 'npc', 'npcId']);
});

/* ---------- the compare-and-swap on the overlay-id clear (A2): the autopilot's clear must not take off an overlay it did not show ---------- */
const ovFx = (id) => ({ id, kind: 'fx', ms: 20000, fx: 'dawn', at: '2026-10-28T00:00:00.000Z' });
const freshAmbient = async () => asD1(await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') }));

await test('patchAmbient ifOverlay: clears while the stored overlay has that id; another id, or none, writes nothing and does not move seq', async () => {
  const db = await freshAmbient();
  const a = await patchAmbient(db, 'c', { overlay: ovFx('mine') });
  const hit = await patchAmbient(db, 'c', { overlay: null }, { ifOverlay: 'mine' });
  assert.ok(!hit.unchanged && !('overlay' in hit.doc) && hit.seq === a.seq + 1, 'the matching id clears it (positive control)');
  await patchAmbient(db, 'c', { overlay: ovFx('theirs') });
  const before = await loadAmbient(db, 'c');
  const miss = await patchAmbient(db, 'c', { overlay: null }, { ifOverlay: 'mine' });
  assert.equal(miss.unchanged, true); assert.equal(miss.doc.overlay.id, 'theirs'); assert.equal(miss.seq, before.seq, 'seq did not move');
  assert.deepEqual(await loadAmbient(db, 'c'), before, 'the stored document is exactly as it was');
  await patchAmbient(db, 'c', { overlay: null });
  const none = await patchAmbient(db, 'c', { overlay: null }, { ifOverlay: 'mine' });
  assert.equal(none.unchanged, true, 'no overlay at all: nothing to clear');
  const plain = await patchAmbient(db, 'c', { overlay: ovFx('x2') });
  assert.ok(!plain.unchanged && plain.doc.overlay.id === 'x2', 'with no ifOverlay the patch is unconditional, as before');
});

await test('patchAmbient ifOverlay: an overlay set between the read and the write is NOT cleared (the race the swap closes)', async () => {
  const real = await freshAmbient();
  await patchAmbient(real, 'c', { overlay: ovFx('mine') });
  let fired = 0;
  const racing = { prepare(sql) {          // just before the guarded UPDATE of the first attempt, another writer lands a different overlay
    const st = real.prepare(sql);
    if (!/^UPDATE gm_ambient/.test(sql)) return st;
    const wrap = { bind(...p) { st.bind(...p); return wrap; }, async run() { if (!fired++) await patchAmbient(real, 'c', { overlay: ovFx('dawn-now') }); return st.run(); } };
    return wrap;
  } };
  const r = await patchAmbient(racing, 'c', { overlay: null }, { ifOverlay: 'mine' });
  assert.ok(fired >= 1, 'the interleaved write happened');
  assert.equal(r.unchanged, true);
  assert.equal((await loadAmbient(real, 'c')).doc.overlay.id, 'dawn-now', 'the later overlay is still up');
  // the same race with no swap, to show the test would see it: the later overlay is cleared
  const real2 = await freshAmbient(); await patchAmbient(real2, 'c', { overlay: ovFx('mine') });
  let f2 = 0;
  const racing2 = { prepare(sql) { const st = real2.prepare(sql); if (!/^UPDATE gm_ambient/.test(sql)) return st;
    const wrap = { bind(...p) { st.bind(...p); return wrap; }, async run() { if (!f2++) await patchAmbient(real2, 'c', { overlay: ovFx('dawn-now') }); return st.run(); } }; return wrap; } };
  await patchAmbient(racing2, 'c', { overlay: null });
  assert.ok(!('overlay' in (await loadAmbient(real2, 'c')).doc), 'without ifOverlay the same race clears the later overlay (the control)');
});

await test('cleanIfOverlay: an id beside overlay: null; anything else is a 400, never a silent no-op', () => {
  assert.equal(cleanIfOverlay({ overlay: null, ifOverlay: 'o1' }, { overlay: null }), 'o1');
  assert.equal(cleanIfOverlay({ overlay: null }, { overlay: null }), null); assert.equal(cleanIfOverlay({}, {}), null);
  for (const [raw, patch] of [[{ ifOverlay: 'o1' }, {}], [{ ifOverlay: 'o1', overlay: ovFx('z') }, { overlay: ovFx('z') }], [{ ifOverlay: 5, overlay: null }, { overlay: null }],
    [{ ifOverlay: '  ', overlay: null }, { overlay: null }], [{ ifOverlay: 'x'.repeat(41), overlay: null }, { overlay: null }]]) {
    assert.throws(() => cleanIfOverlay(raw, patch), (e) => e.status === 400, JSON.stringify(raw).slice(0, 60));
  }
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

/* ---------- the server's text scan holds the same rule as the GM page's ---------- */
await test('the server\'s namesHit and the page\'s agree on a shared list of cases (whole word, any case, Unicode, regex characters, spaces, short names)', () => {
  const page = require(path.join(ROOT, 'app', 'gm-page.js'))._pure.namesHit;
  const cases = [
    ['Vex was here', ['Vex']], ['vex was here', ['Vex']], ['Vexing weather', ['Vex']], ['Convex lenses', ['Vex']], ['"Vex," she said', ['Vex']], ['Vex', ['Vex']],
    ['the brass   fox is out', ['The Brass Fox']], ['The Brass Foxes', ['The Brass Fox']], ['Mr. O\'Neil (Jr) arrived', ['Mr. O\'Neil (Jr)']], ['Mr. ONeil (Jr) arrived', ['Mr. O\'Neil (Jr)']],
    ['Zoë waits', ['Zoë']], ['Zoëtrope', ['Zoë']], ['x marks it', ['x']], ['', ['Vex']], ['Vex', []], ['a+b is c', ['a+b']], ['a b is c', ['a+b']], ['nothing here', ['Vex', 'Zoë']],
    ['HIDDEN-CLOCK-NAME ticks', ['HIDDEN-CLOCK-NAME']], ['HIDDEN-CLOCK-NAMES tick', ['HIDDEN-CLOCK-NAME']], ['the (hush) room', ['(hush)']], ['a \\ b', ['\\']], ['end Vex', ['Vex']], ['Vex_ and', ['Vex']], ['2Vex', ['Vex']],
  ];
  for (const [text, names] of cases) assert.equal(serverNamesHit(text, names), page(text, names), JSON.stringify([text, names]));
  assert.equal(serverNamesHit(5, ['Vex']), false); assert.equal(serverNamesHit('Vex', 'Vex'), false); assert.equal(serverNamesHit('Vex', [null, 5, {}]), false);
});

await test('namesHit folds with NFKC on both sides, in the server and the page alike: full-width letters, ligatures and a decomposed accent are hits; a longer word is still not', () => {
  const page = require(path.join(ROOT, 'app', 'gm-page.js'))._pure.namesHit;
  const FW = 'Ｖｅｘ';                       // full-width "Vex"
  const cases = [
    [FW + ' was here', ['Vex'], true], ['Vex was here', [FW], true], [FW + 'ing weather', ['Vex'], false], ['the ﬁsher waits', ['fisher'], true],
    ['Zoë waits', ['Zoë'], true], ['Zoë waits', ['Zoë'], true], ['The　Brass Fox', ['The Brass Fox'], true],
    ['Vex was here', ['Vex'], true], ['nothing here', [FW], false],         // ASCII-only paths, and a folded name that is absent
    ['José said', ['Jose'], true],                                      // folding must never remove a hit: raw "Jose" + combining acute was a hit before NFKC and stays one
    ['José said', ['José'], true], ['Josephine said', ['Jose'], false], ['Jose said', ['José'], false],      // and ASCII negative controls: a longer word, a different name
  ];
  for (const [text, names, want] of cases) {
    assert.equal(serverNamesHit(text, names), want, 'server ' + JSON.stringify([text, names]));
    assert.equal(page(text, names), want, 'page ' + JSON.stringify([text, names]));
  }
});

await test('loadHiddenNames: hidden clocks, and NPCs that are not revealed (name and alias), in one batch of two statements; revealed ones are not in it', async () => {
  const calls = { batch: 0, stmts: 0 };
  const db = {
    prepare(sql) { return { bind: () => ({ sql }) }; },
    async batch(list) { calls.batch++; calls.stmts += list.length;
      return [{ results: [{ clocks: JSON.stringify([clk('c_1', 'Visible Invented', 4, 1), clk('c_2', 'Hidden Invented Clock', 4, 1, true)]) }] }, { results: [{ name: 'Hidden Invented Person', alias: 'Shade' }, { name: 'Other Hidden', alias: null }] }]; },
  };
  const names = await loadHiddenNames(db, 'camp');
  assert.deepEqual(names, ['Hidden Invented Clock', 'Hidden Invented Person', 'Shade', 'Other Hidden']);
  assert.deepEqual([calls.batch, calls.stmts], [1, 2], 'one batch of two statements');
  assert.deepEqual(await loadHiddenNames({ prepare: () => ({ bind: () => ({}) }), batch: async () => [{ results: [] }, { results: [] }] }, 'camp'), [], 'nothing hidden');
  assert.deepEqual(await loadHiddenNames({ prepare: () => ({ bind: () => ({}) }), batch: async () => [{ results: [{ clocks: '{bad' }] }, { results: [] }] }, 'camp'), [], 'unreadable clocks');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
