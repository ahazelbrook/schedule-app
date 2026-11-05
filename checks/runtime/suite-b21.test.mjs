// The Debrief (1.7, spine.debrief) and the quiet line (5.8, between.quiet): the switches, the GM controllers on a recorded host and a clock the test moves, the two
// phone modules against a fake window, and the in-process store (the real /api/docs handler on in-memory SQLite) for the role matrix. The pokes against a real
// Worker are in checks/api/quiet.mjs. INVENTED data only; every GM-only string is a GM-ONLY- marker.
//   node checks/runtime/suite-b21.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { onRequest as docsHandler } from '../../functions/api/docs.js';
import { rolesFor } from '../../functions/_lib/live.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const require = createRequire(import.meta.url);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

globalThis.self = globalThis;
const Features = require(path.join(APP, 'features.js'));
const Night = require(path.join(APP, 'gm', 'night.js'));
const After = require(path.join(APP, 'gm', 'aftermath.js'));
const D = require(path.join(APP, 'gm', 'debrief.js'));
const Q = require(path.join(APP, 'gm', 'quiet.js'));
const PD = require(path.join(APP, 'sheet', 'debrief.js'));
const PQ = require(path.join(APP, 'sheet', 'quiet.js'));
import vm from 'node:vm';
import fs from 'node:fs';
const Routes = (() => { const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(APP, 'routes.js'), 'utf8'), ctx, { filename: 'routes.js' }); return ctx.window.B68Load; })();
const MARK = 'GM-ONLY-b21-marker';
const flush = () => new Promise((r) => setTimeout(r, 0));

/* ---------- the switches ---------- */
await test('both lines are registered, bland, phone-surface, and ON whatever is stored (N0: everything built is on)', () => {
  for (const id of ['spine.debrief', 'between.quiet']) {
    const s = Features.get(id);
    assert.ok(s, id); assert.equal(s.default, false); assert.equal(s.surface, 'phone');
    assert.ok(s.label && s.doc && !/GM-ONLY/.test(s.doc));
    assert.equal(Features.valueOf({}, id), true, id + ': on with nothing stored');
    assert.equal(Features.valueOf({ features: { [id]: false } }, id), true, id + ': a stored false is still on');
  }
  assert.equal(Features.get('spine.debrief').saturday, 'on'); assert.equal(Features.get('between.quiet').saturday, 'try');
  assert.ok(!Features.isSetting('spine.debrief') && !Features.isSetting('between.quiet'), 'neither is a setting');
  assert.ok(Features.publicIds().includes('spine.debrief') && Features.publicIds().includes('between.quiet'));
});
await test('routes: the two phone bundles exist alone, the GM bundle carries the GM files, and the display carries none of them', () => {
  assert.equal(JSON.stringify(Routes.BUNDLES.debrief), '["sheet/debrief.js"]'); assert.equal(JSON.stringify(Routes.BUNDLES.quiet), '["sheet/quiet.js"]');
  assert.ok(Routes.BUNDLES.gm.includes('gm/debrief.js') && Routes.BUNDLES.gm.includes('gm/quiet.js'));
  for (const b of ['core', 'table', 'figures', 'display', 'commend']) assert.ok(!Routes.BUNDLES[b].some((f) => /debrief|quiet/.test(f)), b + ' stays free of them');
});

/* ---------- 1.7 pure ---------- */
const T0 = Date.parse('2026-11-07T23:30:00+11:00');
await test('pendingOf reads the Aftermath\'s list, known steps only, in step order; morningAfter is the next 07:00', () => {
  const n = (p) => ({ aftermath: { step: 'done', data: { pending: p } } });
  assert.deepEqual(D.pendingOf(n('credits,unwind,xp,bogus')), ['unwind', 'xp', 'credits']);
  assert.deepEqual(D.pendingOf(n('')), []); assert.deepEqual(D.pendingOf(null), []); assert.deepEqual(D.pendingOf({}), []);
  const m = new Date(D.morningAfter(T0)); assert.equal(m.getHours(), 7); assert.ok(m.getTime() > T0 && m.getTime() - T0 <= 24 * 3600 * 1000);
  const early = Date.parse('2026-11-08T01:00:00+11:00'); assert.ok(D.morningAfter(early) - early < 8 * 3600 * 1000, 'after midnight, the same morning');
});
await test('resolve: waiting before the morning, open, answered, and the defaults after 48 hours; a doctored reply is clamped', () => {
  const row = D.buildRow({ steps: ['unwind', 'xp', 'credits'], nightAt: T0, sentAt: T0 });
  assert.equal(row.due, T0 + 48 * 3600 * 1000); assert.ok(row.from > T0 && row.from < row.due);
  assert.deepEqual(row.steps, ['unwind', 'xp', 'credits']); assert.equal(row.options.length, 7);
  assert.equal(D.resolve(row, T0 + 60000).state, 'waiting');
  assert.equal(D.resolve(row, row.from + 1).state, 'open');
  assert.equal(D.resolve(row, row.due - 1).state, 'open');
  const d = D.resolve(row, row.due); assert.equal(d.state, 'default');
  assert.deepEqual(d.effective, { unwind: { pick: 'heat', note: '' }, xp: { ticked: false, note: '' }, credits: { note: '' } });
  const ans = Object.assign({}, row, { reply: { at: row.from + 5, unwind: { pick: 'train', note: 'x'.repeat(900) }, xp: { ticked: true, note: '' }, stray: MARK } });
  const r = D.resolve(ans, row.due + 1e6); assert.equal(r.state, 'answered', 'a reply beats the default');
  assert.equal(r.effective.unwind.pick, 'train'); assert.equal(r.effective.unwind.note.length, 200); assert.ok(!JSON.stringify(r).includes(MARK));
  assert.equal(r.effective.credits.note, '', 'a step not replied to takes the default');
  assert.equal(D.cleanReply('x'), null); assert.equal(D.cleanReply({ at: 5 }), null);
  assert.equal(D.resolve(null, T0).state, 'open'); assert.deepEqual(D.resolve({ steps: [] }, T0).steps, []);
});

/* ---------- 1.7 the controller: stop the Aftermath at step 5, then the Debrief ---------- */
function merge(cur, p) {
  if (p === null) return null;
  const c = JSON.parse(JSON.stringify(cur || {}));
  const go = (a, b) => { for (const [k, v] of Object.entries(b)) { if (v === null) delete a[k]; else if (v && typeof v === 'object' && !Array.isArray(v)) { a[k] = a[k] && typeof a[k] === 'object' ? a[k] : {}; go(a[k], v); } else a[k] = v; } return a; };
  return go(c, p);
}
function rig() {
  const t = { now: T0 }; let nightDoc = null; const out = { toasts: [], rows: {}, puts: [], dels: [] };
  const nightCtl = Night.create({ doc: () => ({ night: nightDoc }), patch: (p) => { nightDoc = merge(nightDoc, p.night); return true; }, now: () => t.now, prep: () => null });
  const aft = After.create({
    enabled: () => true, show: () => Promise.resolve({ ok: true }), layer: () => Promise.resolve({ ok: true }), clearShow: () => Promise.resolve({ ok: true }), night: () => nightCtl,
    docs: { put: () => Promise.resolve({ ok: true }), del: () => Promise.resolve({ ok: true }) }, npcs: () => [], crew: () => ({ heat: 0, wanted: 0, vault: 0 }), now: () => t.now, toast: () => {}
  });
  const members = [{ id: 'alice@example.test', name: 'Alice' }, { id: 'bea@example.test', name: 'Bea' }];
  const deb = D.create({
    enabled: () => true, night: () => nightCtl, members: () => Promise.resolve(members), now: () => t.now, toast: (m, bad) => out.toasts.push({ m, bad: !!bad }),
    docs: {
      list: () => Promise.resolve(Object.keys(out.rows).map((o) => ({ owner: o, json: out.rows[o] }))),
      put: (r) => { assert.equal(r.kind, 'debrief'); assert.equal(r.scope, 'player'); out.puts.push(r); out.rows[r.owner] = JSON.parse(JSON.stringify(r.json)); return Promise.resolve({ ok: true }); },
      del: (k, o) => { out.dels.push([k, o]); delete out.rows[o]; return Promise.resolve({ ok: true }); }
    }
  });
  return Object.assign(out, { t, aft, deb, nightCtl, night: () => nightDoc });
}
await test('stopping the Aftermath at step 5 files steps 6 to 8; the Debrief sends exactly those, once, one scope-player row per player, stamped in the night log', async () => {
  const r = rig();
  await r.aft.start();
  for (let i = 0; i < 5; i++) { r.t.now += 60000; await r.aft.next(); }          // steps 1 to 5 done: the next is step 6
  assert.equal(r.aft.state().step.id, 'unwind');
  await r.aft.finish();                                                           // End now
  assert.deepEqual(D.pendingOf(r.night()), ['unwind', 'xp', 'credits'], 'the Aftermath filed 6 to 8: ' + JSON.stringify(r.night().aftermath));
  assert.equal(r.night().aftermath.step, 'done');
  assert.equal(r.puts.length, 0, 'nothing sent before the tick');
  const res = await r.deb.tick();
  assert.deepEqual([res.sent, res.skipped, res.steps], [2, 0, ['unwind', 'xp', 'credits']]);
  assert.deepEqual(r.puts.map((p) => p.owner).sort(), ['alice@example.test', 'bea@example.test']);
  for (const p of r.puts) { assert.equal(p.scope, 'player'); assert.deepEqual(p.json.steps, ['unwind', 'xp', 'credits']); assert.ok(p.json.from > r.t.now); }
  assert.ok(Object.values(r.night().log).some((e) => /^Debrief sent: 2 players/.test(e.text)), 'the night log holds it');
  assert.equal(D.sentFor(r.night()), true);
  assert.equal(await r.deb.tick(), null, 'the next tick sends nothing: the log says it went');
  assert.equal(r.puts.length, 2);
});
await test('a Debrief is never written over a reply: send() skips a player whose row is this night\'s; "again" clears first; a finished Aftermath with nothing pending sends nothing', async () => {
  const r = rig();
  await r.aft.start(); for (let i = 0; i < 5; i++) { r.t.now += 1000; await r.aft.next(); } await r.aft.finish();
  await r.deb.send();
  r.rows['alice@example.test'].reply = { at: r.t.now, unwind: { pick: 'train', note: '' } };
  const again = await r.deb.send();
  assert.deepEqual([again.sent, again.skipped], [0, 2]); assert.equal(r.rows['alice@example.test'].reply.unwind.pick, 'train', 'the reply survived');
  await r.deb.again();
  assert.equal(r.dels.length, 2); assert.ok(!('reply' in r.rows['alice@example.test']), 'sent fresh on purpose');
  const full = rig(); await full.aft.start(); for (let i = 0; i < 8; i++) await full.aft.next();
  assert.deepEqual(D.pendingOf(full.night()), []); assert.equal(await full.deb.tick(), null); assert.equal(full.puts.length, 0);
});
await test('replies for the GM panel: answered, open and default, each with the effective picks; off sends nothing', async () => {
  const r = rig();
  await r.aft.start(); for (let i = 0; i < 5; i++) await r.aft.next(); await r.aft.finish(); await r.deb.send();
  r.rows['alice@example.test'].reply = { at: r.t.now, unwind: { pick: 'train', note: 'hit the gym' }, xp: { ticked: true, note: '' }, credits: { note: '' } };
  r.t.now = r.rows['bea@example.test'].from + 10;
  let rs = await r.deb.replies(); const by = Object.fromEntries(rs.map((x) => [x.name, x]));
  assert.equal(by.Alice.state, 'answered'); assert.equal(by.Alice.effective.unwind.pick, 'train'); assert.equal(by.Bea.state, 'open');
  r.t.now = r.rows['bea@example.test'].due + 1;
  rs = await r.deb.replies(); assert.equal(rs.find((x) => x.name === 'Bea').state, 'default'); assert.equal(rs.find((x) => x.name === 'Bea').effective.unwind.pick, 'heat');
  assert.deepEqual(D.rollup([{ json: r.rows['alice@example.test'] }, { json: r.rows['bea@example.test'] }], r.t.now), { answered: 1, defaults: 1, open: 0, waiting: 0 });
  const off = D.create({ enabled: () => false, night: () => r.nightCtl, members: () => Promise.resolve([]), docs: { list: () => Promise.resolve([]), put() { throw new Error('no'); }, del() {} } });
  assert.equal((await off.send()).off, true);
});

/* ---------- the Debrief on a phone ---------- */
function fakeWin() {
  const calls = [], listeners = {}; let rows = [], refreshed = 0;
  const W = {
    fetch: (url, o) => { calls.push({ url, method: (o && o.method) || 'GET', body: o && o.body }); return Promise.resolve({ ok: true, json: () => Promise.resolve({ docs: rows }) }); },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 2, clearTimeout() {},
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    B68Live: { on: (kinds, fn) => { listeners.live = { kinds, fn }; return () => { listeners.live = null; }; } },
    B68Tracker: { isOpen: () => true, refresh: () => { refreshed++; } }
  };
  return { W, calls, listeners, rows: (r) => { rows = r; }, refreshed: () => refreshed };
}
await test('the phone Debrief: nothing is read until started; then only its own kind; the card shows from the morning, says defaults after 48 hours, and stop() lets go', async () => {
  const w = fakeWin(); const realNow = Date.now; let now = T0;
  Date.now = () => now;
  try {
    assert.equal(PD.bar(), '', 'not started: no card'); assert.equal(w.calls.length, 0);
    Object.assign(globalThis, { fetch: w.W.fetch, document: w.W.document, B68Live: w.W.B68Live, B68Tracker: w.W.B68Tracker });
    PD.start(); await flush();
    assert.deepEqual(w.calls.map((c) => c.url), ['/api/docs?kind=debrief&limit=1']); assert.deepEqual(w.listeners.live.kinds, ['docs']);
    const row = D.buildRow({ steps: ['unwind', 'xp', 'credits'], nightAt: T0, sentAt: T0 });
    w.rows([{ kind: 'debrief', owner: 'alice@example.test', scope: 'player', json: row }]); w.listeners.live.fn('docs'); await flush();
    assert.equal(PD.bar(), '', 'before the morning: nothing on the sheet');
    now = row.from + 60000; assert.ok(PD.bar().includes('data-b68="debrief-open"') && PD.bar().includes('Answer the Debrief'), 'the next morning: the card');
    now = row.due + 1; assert.ok(PD.bar().includes('48 hours are up'), 'after 48 hours: defaults');
    w.rows([{ kind: 'debrief', owner: 'alice@example.test', scope: 'player', json: Object.assign({}, row, { reply: { at: now, xp: { ticked: true, note: '' } } }) }]); w.listeners.live.fn('docs'); await flush();
    assert.ok(PD.bar().includes('Sent.'), 'answered'); assert.ok(w.refreshed() >= 1, 'the sheet was redrawn');
    w.rows([]); w.listeners.live.fn('docs'); await flush(); assert.equal(PD.bar(), '', 'row gone: card gone');
    PD.stop(); assert.equal(w.listeners.live, null);
  } finally { Date.now = realNow; for (const k of ['fetch', 'document', 'B68Live', 'B68Tracker']) delete globalThis[k]; }
});

/* ---------- 5.8 pure and the controller ---------- */
await test('the quiet line: four kinds only, a note needs words, the row keeps the latest 8, strings are clamped and control characters removed', () => {
  assert.deepEqual(PQ.OPTIONS.map((o) => o.k), ['xcard', 'pause', 'spot', 'note']); assert.deepEqual(Q.KINDS, ['xcard', 'pause', 'spot', 'note']);
  assert.equal(PQ.itemFor('nope', '', 5), null); assert.equal(PQ.itemFor('note', '   ', 5), null);
  assert.deepEqual(PQ.itemFor('xcard', 'ignored', 7.9), { k: 'xcard', at: 7 });
  assert.equal(PQ.itemFor('note', 'a\u0007b' + 'x'.repeat(500), 5).text.length, 280);
  let j = null; for (let i = 0; i < 12; i++) j = PQ.merge(j, PQ.itemFor('pause', '', 100 + i));
  assert.equal(j.items.length, 8); assert.equal(j.items[0].at, 104);
  const clean = Q.cleanItems({ items: [{ k: 'xcard', at: 5, text: MARK }, { k: 'boom', at: 6 }, { k: 'note', at: 7, text: 'hi' }, 'x'] });
  assert.deepEqual(clean, [{ k: 'xcard', at: 5 }, { k: 'note', at: 7, text: 'hi' }], 'a text on a non-note is dropped');
});
await test('the GM badge model: newest first, named, and a new line is stamped once into the night log without the note\'s words; dismiss deletes that player\'s row', async () => {
  let rows = [{ kind: 'quiet', owner: 'alice@example.test', scope: 'player', json: { v: 1, items: [{ k: 'note', at: T0 - 1000, text: MARK + ' words' }] } },
    { kind: 'quiet', owner: 'bea@example.test', scope: 'player', json: { v: 1, items: [{ k: 'xcard', at: T0 }] } }];
  const stamps = [], dels = [];
  const c = Q.create({ enabled: () => true, now: () => T0, members: () => Promise.resolve([{ id: 'alice@example.test', name: 'Alice' }, { id: 'bea@example.test', name: 'Bea' }]),
    night: () => ({ stamp: (t) => stamps.push(t) }), docs: { list: () => Promise.resolve(rows), del: (k, o) => { dels.push([k, o]); rows = rows.filter((x) => x.owner !== o); return Promise.resolve({}); } } });
  let m = await c.refresh();
  assert.equal(m.count, 2); assert.deepEqual(m.items.map((x) => x.name + ':' + x.label), ['Bea:X-card', 'Alice:Secret note']);
  assert.deepEqual(stamps, ['Quiet: X-card (Bea)', 'Quiet: Secret note (Alice)']); assert.ok(!stamps.join().includes(MARK));
  await c.refresh(); assert.equal(stamps.length, 2, 'stamped once');
  m = await c.dismiss('bea@example.test'); assert.deepEqual(dels, [['quiet', 'bea@example.test']]); assert.equal(m.count, 1);
  const off = Q.create({ enabled: () => false, docs: { list() { throw new Error('read while off'); } } });
  assert.equal((await off.refresh()).count, 0);
});

/* ---------- 5.8 the phone ---------- */
await test('the phone sends a quiet line as its own scope-player row, merged with what it already holds, and nothing else', async () => {
  const w = fakeWin(); Object.assign(globalThis, { fetch: w.W.fetch });
  try {
    w.rows([{ kind: 'quiet', owner: 'alice@example.test', scope: 'player', json: { v: 1, items: [{ k: 'pause', at: 1 }] } }]);
    assert.equal(await PQ.send('xcard'), true);
    assert.deepEqual(w.calls.map((c) => c.method + ' ' + c.url), ['GET /api/docs?kind=quiet&limit=1', 'PUT /api/docs']);
    const body = JSON.parse(w.calls[1].body); assert.equal(body.kind, 'quiet'); assert.equal(body.scope, 'player'); assert.ok(!('owner' in body), 'owner is the signed-in player, set by the store');
    assert.deepEqual(body.json.items.map((x) => x.k), ['pause', 'xcard']);
    assert.equal(await PQ.send('note', ' '), false, 'an empty note sends nothing'); assert.equal(w.calls.length, 2);
  } finally { delete globalThis.fetch; }
});
await test('the switches off: the quiet module is not started, so the header does nothing and nothing is listened to', () => {
  const adds = []; const doc = { head: { appendChild() {} }, addEventListener: (n) => adds.push(n), removeEventListener() {}, createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }) };
  Object.assign(globalThis, { document: doc });
  try { assert.deepEqual(PQ.state(), { started: false, open: false }); assert.equal(adds.length, 0); PQ.start(); assert.ok(adds.includes('pointerdown')); PQ.stop(); assert.equal(PQ.state().started, false); }
  finally { delete globalThis.document; }
});

/* ---------- the store: who receives what (the real handler, in-memory SQLite) ---------- */
const GM = { me: { role: 'gm', email: 'gm@example.test', id: 'gm@example.test' } }, DISPLAY = { me: { role: 'display', email: 'table@example.test', id: 'table@example.test' } };
const PA = { me: { role: 'player', email: 'alice@example.test', id: 'alice@example.test' } }, PB = { me: { role: 'player', email: 'bea@example.test', id: 'bea@example.test' } };
function storeRig() {
  const pokes = [];
  const env = (db) => ({ DB: db, LIVE: { idFromName: (n) => n, get: () => ({ poke: (k) => { pokes.push(k); return Promise.resolve(); } }) } });
  const call = async (db, method, url, body, who) => {
    const waits = [];
    let res;
    try { res = await docsHandler({ request: new Request('http://x.test' + url, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env: env(db), data: who, waitUntil: (p) => waits.push(p) }); }
    catch (e) { if (e && Number.isInteger(e.status)) res = new Response(JSON.stringify({ error: e.message }), { status: e.status }); else throw e; }
    await Promise.all(waits);
    return res;
  };
  return { pokes, call };
}
await test('5.8 the role matrix in the store: only the GM and the sender read a quiet row; the other player and the display read nothing; only the GM is poked, and with the quiet kind', async () => {
  const db = asD1(await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') })); const s = storeRig();
  let r = await s.call(db, 'PUT', '/api/docs', { kind: 'quiet', scope: 'player', json: { v: 1, items: [{ k: 'note', at: 1, text: MARK }] } }, PA); assert.equal(r.status, 200, await r.text());
  const read = async (who, q = '?kind=quiet') => JSON.stringify((await (await s.call(db, 'GET', '/api/docs' + q, undefined, who)).json()).docs);
  assert.ok((await read(GM)).includes(MARK)); assert.ok((await read(PA)).includes(MARK));
  for (const q of ['?kind=quiet', '', '?owner=alice@example.test', '?kind=quiet&owner=alice@example.test']) { assert.ok(!(await read(PB, q)).includes(MARK), 'B: ' + q); assert.ok(!(await read(DISPLAY, q)).includes(MARK), 'display: ' + q); }
  assert.deepEqual(s.pokes, ['quiet'], 'one poke, the quiet kind'); assert.deepEqual(rolesFor('quiet'), ['gm']);
  r = await s.call(db, 'PUT', '/api/docs', { kind: 'quiet', owner: 'alice@example.test', scope: 'player', json: { v: 1, items: [] } }, PB); assert.equal(r.status, 403);
  r = await s.call(db, 'DELETE', '/api/docs?kind=quiet&owner=alice@example.test', undefined, PB); assert.equal(r.status, 403);
  r = await s.call(db, 'PUT', '/api/docs', { kind: 'quiet', json: { v: 1, items: [] } }, DISPLAY); assert.equal(r.status, 403);
  assert.deepEqual(s.pokes, ['quiet'], 'a refusal pokes nobody');
  r = await s.call(db, 'DELETE', '/api/docs?kind=quiet&owner=alice@example.test', undefined, GM); assert.equal(r.status, 200);
  assert.deepEqual(s.pokes, ['quiet', 'quiet']);
  r = await s.call(db, 'PUT', '/api/docs', { kind: 'opportunity', scope: 'player', json: { v: 1 } }, PA); assert.equal(r.status, 200);
  assert.deepEqual(s.pokes, ['quiet', 'quiet', 'docs'], 'every other kind still pokes docs');
});
await test('1.7 the role matrix in the store: each player reads only their own Debrief, the iPad none, and a reply goes into the player\'s own row', async () => {
  const db = asD1(await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') })); const s = storeRig();
  const row = (who) => D.buildRow({ steps: ['unwind', 'xp', 'credits'], nightAt: T0, sentAt: T0, who });
  for (const [id, who] of [['alice@example.test', 'A'], ['bea@example.test', 'B']]) {
    const r = await s.call(db, 'PUT', '/api/docs', { kind: 'debrief', owner: id, scope: 'player', json: Object.assign(row(), { who }) }, GM); assert.equal(r.status, 200, await r.text());
  }
  const read = async (who, q = '?kind=debrief') => (await (await s.call(db, 'GET', '/api/docs' + q, undefined, who)).json()).docs;
  assert.deepEqual((await read(PA)).map((d) => d.json.who), ['A']); assert.deepEqual((await read(PB)).map((d) => d.json.who), ['B']);
  assert.deepEqual(await read(DISPLAY), []); assert.equal((await read(GM)).length, 2);
  assert.deepEqual(await read(PA, '?kind=debrief&owner=bea@example.test'), [], 'naming the other player\'s row gets nothing');
  const mine = (await read(PA))[0].json;
  let r = await s.call(db, 'PUT', '/api/docs', { kind: 'debrief', scope: 'player', json: Object.assign({}, mine, { reply: { at: 9, unwind: { pick: 'train', note: '' } } }) }, PA); assert.equal(r.status, 200);
  assert.equal((await read(GM, '?kind=debrief&owner=alice@example.test'))[0].json.reply.unwind.pick, 'train');
  assert.equal(JSON.stringify(await read(GM, '?kind=debrief&owner=bea@example.test')).includes('reply'), false, 'B\'s row is untouched');
  r = await s.call(db, 'PUT', '/api/docs', { kind: 'debrief', owner: 'bea@example.test', scope: 'player', json: mine }, PA); assert.equal(r.status, 403);
  r = await s.call(db, 'PUT', '/api/docs', { kind: 'debrief', scope: 'public', json: mine }, PA); assert.equal(r.status, 403);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
