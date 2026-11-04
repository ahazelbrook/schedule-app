// The opportunity board (5.1, between.board) and claims and status (5.5, between.claims): the switches, the phone module against a fake window, the GM controller on a
// recorded host, the show kind through the server's builder, the GM page's mirror and the display's renderer, the store's role matrix, and (5.5) the claim track and
// the faction ladder. INVENTED data only; every GM-only string is a GM-ONLY- marker.
//   node checks/runtime/suite-b28.test.mjs
import path from 'node:path';
import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { onRequest as docsHandler } from '../../functions/api/docs.js';
import { cleanShowPayload, showTexts, SHOW_KIND_IDS } from '../../functions/_lib/show.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const APP = path.join(ROOT, 'app');
const require = createRequire(import.meta.url);
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

globalThis.self = globalThis;
const Features = require(path.join(APP, 'features.js'));
const GB = require(path.join(APP, 'gm', 'board.js'));
const PB28 = require(path.join(APP, 'sheet', 'board.js'));
const GShow = require(path.join(APP, 'gm', 'show.js'));
const Routes = (() => { const ctx = { window: {} }; vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(APP, 'routes.js'), 'utf8'), ctx, { filename: 'routes.js' }); return ctx.window.B68Load; })();
const MARK = 'GM-ONLY-b28-marker';
const flush = () => new Promise((r) => setTimeout(r, 0));

/* ---------- the switches ---------- */
await test('between.board is registered, default off, bland, phone-surface; a flipped doc turns it on alone', () => {
  const s = Features.get('between.board');
  assert.ok(s); assert.equal(s.default, false); assert.equal(s.surface, 'phone'); assert.equal(s.stage, 'between');
  assert.ok(s.label && s.doc && !/GM-ONLY/.test(s.doc));
  assert.equal(Features.valueOf({}, 'between.board'), false);
  assert.equal(Features.valueOf({ features: { 'between.board': true } }, 'between.board'), true);
  assert.equal(Features.valueOf({ features: { 'between.board': true } }, 'between.quiet'), false);
  assert.ok(Features.publicIds().includes('between.board'));
});
await test('routes: the board bundle is alone; the GM bundle has gm/board.js; the display and look book have the renderer and its css; no other bundle has any of them', () => {
  assert.equal(JSON.stringify(Routes.BUNDLES.board), '["sheet/board.js"]');
  assert.ok(Routes.BUNDLES.gm.includes('gm/board.js'));
  for (const b of ['display', 'lookbook']) { assert.ok(Routes.BUNDLES[b].includes('display/board.js') && Routes.BUNDLES[b].includes('display/board.css'), b); }
  for (const b of ['core', 'table', 'figures', 'commend', 'debrief', 'quiet']) assert.ok(!Routes.BUNDLES[b].some((f) => /board/.test(f)), b + ' stays free of it');
  assert.ok(!Routes.BUNDLES.gm.includes('sheet/board.js') && !Routes.BUNDLES.display.some((f) => /gm\/board|sheet\/board/.test(f)), 'the display never fetches the GM or phone file');
});

/* ---------- the phone ---------- */
await test('phone pure: add keeps the latest 6, clamps and cleans, refuses an empty text or an unknown kind; remove drops one', () => {
  let j = null;
  for (let i = 0; i < 8; i++) j = PB28.add(j, 'client', 'Card ' + i, 1000 + i);
  assert.equal(j.items.length, 6); assert.equal(j.items[0].text, 'Card 2'); assert.equal(j.v, 1);
  assert.equal(PB28.add(j, 'client', '   ', 5), null); assert.equal(PB28.add(j, 'boss', 'x', 5), null);
  const long = PB28.add(null, 'target', 'x'.repeat(500) + '\u0007', 7); assert.equal(long.items[0].text.length, 120);
  const gone = PB28.remove(j, j.items[0].id); assert.equal(gone.items.length, 5);
  assert.deepEqual(PB28.cleanItems({ items: [{ id: 'a', k: 'zzz', text: 'x', at: 1 }, null, { id: 'b', k: 'client', text: 'ok', at: 2 }] }).map((x) => x.id), ['b']);
});

function fakeWin(rows) {
  const calls = [];
  const win = {
    document: { hidden: false, body: { appendChild() {} }, addEventListener() {}, removeEventListener() {} },
    setInterval: () => 1, clearInterval() {},
    fetch: async (url, o) => {
      calls.push({ url, method: (o && o.method) || 'GET', body: o && o.body ? JSON.parse(o.body) : null });
      if (!o || !o.method || o.method === 'GET') return { ok: true, json: async () => ({ docs: rows.opp ? [{ kind: 'opportunity', owner: 'me', scope: 'player', json: rows.opp }] : [] }) };
      if (o.method === 'PUT') { rows.opp = JSON.parse(o.body).json; return { ok: true, json: async () => ({ ok: true }) }; }
      return { ok: false };
    }
  };
  return { win, calls };
}
function loadPhone(win) {
  const src = fs.readFileSync(path.join(APP, 'sheet', 'board.js'), 'utf8');
  const ctx = { window: win }; vm.createContext(ctx);
  vm.runInContext(src.replace(/\}\)\(typeof self !== 'undefined' \? self : this,/, '})(window,'), ctx, { filename: 'sheet/board.js' });
  return win.B68Board;
}
await test('phone: off loads nothing and draws nothing; start reads only its own kind, bar shows the count, and stop clears it', async () => {
  const rows = {}, { win, calls } = fakeWin(rows), P = loadPhone(win);
  assert.equal(P.bar(), '', 'not started: no strip'); assert.equal(calls.length, 0, 'no request before start');
  P.start(); await flush(); await flush();
  assert.ok(calls.length >= 1 && calls.every((c) => /^\/api\/docs\?kind=opportunity/.test(c.url)), 'only the opportunity kind is asked for');
  assert.match(P.bar(), /Post a client/); assert.match(P.bar(), /data-b68="board-open"/);
  rows.opp = PB28.add(null, 'operation', 'Lift the takings', 5);
  P._set(rows.opp); assert.match(P.bar(), /1 posted/);
  P.stop(); assert.equal(P.bar(), '', 'stopped: no strip');
});
await test('phone: a post is one PUT of kind opportunity, scope player, no owner, and never another kind', async () => {
  const rows = {}, { win, calls } = fakeWin(rows), P = loadPhone(win);
  P.start(); await flush();
  const next = PB28.add(null, 'client', 'A fixer wants a ledger', 9);
  // the same write the form makes
  await win.fetch('/api/docs', { method: 'PUT', body: JSON.stringify({ kind: 'opportunity', scope: 'player', json: next }) });
  const puts = calls.filter((c) => c.method === 'PUT'); assert.equal(puts.length, 1);
  assert.equal(puts[0].body.kind, 'opportunity'); assert.equal(puts[0].body.scope, 'player'); assert.equal('owner' in puts[0].body, false);
  P.stop();
});

/* ---------- the GM controller ---------- */
const NOW = Date.parse('2026-11-07T20:00:00+11:00');
function host(opts = {}) {
  const store = { opportunity: opts.rows || [], board: opts.state ? [{ kind: 'board', owner: '_', scope: 'gm', json: opts.state }] : [] };
  const log = { puts: [], shows: [], stamps: [] };
  return {
    log, store,
    enabled: () => opts.on !== false,
    members: async () => [{ id: 'alice@example.test', name: 'Wren Tully' }, { id: 'bea@example.test', name: 'Nell Arbuthnot' }],
    docs: { list: async (kind) => store[kind] || [], put: async (row) => { log.puts.push(row); store.board = [{ kind: 'board', owner: '_', scope: row.scope, json: row.json }]; return { ok: true }; } },
    show: async (kind, payload, o) => { log.shows.push({ kind, payload, o }); return opts.refuse ? null : { ok: true }; },
    night: () => ({ stamp: (t) => log.stamps.push(t) }),
    now: () => NOW
  };
}
const ROWS = [
  { kind: 'opportunity', owner: 'alice@example.test', scope: 'player', json: { v: 1, items: [{ id: 'a1', k: 'client', text: 'A fixer wants a ledger fetched', at: 100 }, { id: 'a2', k: 'operation', text: 'Lift the night takings', at: 300 }] } },
  { kind: 'opportunity', owner: 'bea@example.test', scope: 'player', json: { v: 1, items: [{ id: 'b1', k: 'target', text: 'The cashier with the second books', at: 200 }] } }
];
await test('GM: gather lists every player\'s cards oldest first with a first name; compose keeps only what the GM posted', async () => {
  const h = host({ rows: ROWS }), c = GB.create(h);
  const r = await c.refresh();
  assert.deepEqual(r.cards.map((x) => x.key), ['alice@example.test|a1', 'bea@example.test|b1', 'alice@example.test|a2']);
  assert.deepEqual(r.cards.map((x) => x.name), ['Wren', 'Nell', 'Wren']);
  assert.equal(GB.compose(r.cards), null, 'nothing posted: no board');
  await c.post('bea@example.test|b1', true); await c.post('alice@example.test|a2', true);
  const p = GB.compose(c.cards());
  assert.deepEqual(p.cards, ['The cashier with the second books', 'Lift the night takings']); assert.deepEqual(p.who, ['Nell', 'Wren']);
  assert.deepEqual(p.kinds, ['target', 'operation']); assert.deepEqual(p.carried, ['0', '0']); assert.equal('pick' in p, false);
  assert.equal(h.log.puts.length, 2); assert.ok(h.log.puts.every((x) => x.kind === 'board' && x.scope === 'gm'), 'the board row is GM scope');
});
await test('GM: show sends the board kind with the 3 minute window; refuses with nothing posted; the show passes the server\'s builder and the page mirror', async () => {
  const h = host({ rows: ROWS }), c = GB.create(h); await c.refresh();
  assert.equal(await c.show(), false); assert.equal(h.log.shows.length, 0);
  await c.post('alice@example.test|a1', true); await c.post('bea@example.test|b1', true); await c.pick('bea@example.test|b1');
  assert.equal(await c.show(), true);
  const s = h.log.shows[0]; assert.equal(s.kind, 'board'); assert.equal(s.o.ms, 180000); assert.match(s.o.key, /^board:/);
  assert.equal(s.payload.pick, 1);
  assert.deepEqual(cleanShowPayload('board', s.payload), s.payload, 'the Worker takes it as it is');
  assert.equal(GShow.payloadOk('board', s.payload), true, 'and so does the GM page mirror');
  assert.ok(SHOW_KIND_IDS.includes('board') && GShow.has('board'));
  assert.ok(h.log.stamps.some((t) => /Board up/.test(t)));
  assert.equal((await GB.create(host({ rows: ROWS, refuse: true })).show()), false);
});
await test('GM: close keeps the picked card out of the list and carries the rest over, counting each night', async () => {
  const h = host({ rows: ROWS }), c = GB.create(h); await c.refresh();
  for (const k of ['alice@example.test|a1', 'bea@example.test|b1', 'alice@example.test|a2']) await c.post(k, true);
  await c.pick('bea@example.test|b1');
  await c.close();
  let cards = c.cards();
  assert.deepEqual(cards.map((x) => x.key), ['alice@example.test|a1', 'alice@example.test|a2'], 'the picked card is done');
  assert.deepEqual(cards.map((x) => x.carried), [1, 1]); assert.ok(cards.every((x) => x.shown && !x.picked));
  await c.pick('alice@example.test|a2'); await c.close(); cards = c.cards();
  assert.deepEqual(cards.map((x) => x.key), ['alice@example.test|a1']); assert.equal(cards[0].carried, 2);
  assert.equal(GB.compose(cards).carried[0], '2');
  // a fresh controller on the stored row finds the same state
  const again = GB.create(host({ rows: ROWS, state: h.store.board[0].json })); const r = await again.refresh();
  assert.deepEqual(r.cards.map((x) => x.key), ['alice@example.test|a1']); assert.equal(r.cards[0].carried, 2);
  assert.ok(h.log.stamps.some((t) => /Board closed/.test(t)));
});
await test('GM: off does nothing; a card whose player removed it is dropped from the carry; the cap is twelve', async () => {
  const off = GB.create(host({ rows: ROWS, on: false })); assert.deepEqual((await off.refresh()).cards, []);
  const many = { kind: 'opportunity', owner: 'alice@example.test', scope: 'player', json: { v: 1, items: Array.from({ length: 6 }, (_, i) => ({ id: 'x' + i, k: 'client', text: 'A' + i, at: i + 1 })) } };
  const many2 = Object.assign({}, many, { owner: 'bea@example.test' }), many3 = Object.assign({}, many, { owner: 'cy@example.test' });
  const cards = GB.gather([many, many2, many3], {}, GB.post(GB.post(GB.cleanState(null), 'alice@example.test|x0', true), 'bea@example.test|x1', true)).map((c) => Object.assign({}, c, { shown: true }));
  assert.equal(GB.compose(cards).cards.length, 12);
  const st = GB.post(GB.cleanState(null), 'gone|zz', true), next = GB.closeState(st, []);
  assert.deepEqual(next.shown, []);
});

/* ---------- the show kind ---------- */
const FIX = { cards: ['A fixer at the Pelican Rooms wants a ledger fetched', 'The cashier who keeps the second books'], who: ['Wren', 'Nell'], kinds: ['client', 'target'], carried: ['0', '2'], pick: 1 };
await test('server: the board kind is rebuilt from named keys, bounded, and its words are scanned', () => {
  const out = cleanShowPayload('board', Object.assign({ stray: MARK }, FIX));
  assert.deepEqual(out, FIX); assert.ok(!JSON.stringify(out).includes(MARK));
  const bad = [{}, Object.assign({}, FIX, { cards: [] }), Object.assign({}, FIX, { who: ['Wren'] }), Object.assign({}, FIX, { kinds: ['client', 'boss'] }), Object.assign({}, FIX, { carried: ['0', '10'] }),
    Object.assign({}, FIX, { pick: 2 }), Object.assign({}, FIX, { pick: 'a' }), Object.assign({}, FIX, { cards: ['x'.repeat(121), 'y'] }), Object.assign({}, FIX, { cards: Array(13).fill('x'), who: Array(13).fill('w'), kinds: Array(13).fill('client'), carried: Array(13).fill('0') })];
  for (const p of bad) assert.throws(() => cleanShowPayload('board', p), (e) => e.status === 400, JSON.stringify(p).slice(0, 80));
  const t = showTexts({ kind: 'board', payload: out }, null);
  assert.ok(FIX.cards.every((c) => t.includes(c)) && FIX.who.every((w) => t.includes(w)), 'the hidden-name scan reads every card and name');
});
await test('display: the board kind registers with fixtures, cleans a served payload, and renders text only', () => {
  const ctx = { document: { createElement: () => ({}) } }; ctx.self = ctx; vm.createContext(ctx);
  for (const f of ['shows.js', 'board.js']) vm.runInContext(fs.readFileSync(path.join(APP, 'display', f), 'utf8'), ctx, { filename: f });
  const S = ctx.B68Shows; assert.ok(S && S.has('board'));
  const e = S.entry('board'); assert.ok(e.fixture && e.fixtures.length === 2);
  for (const x of e.fixtures) { const c = S.clean('board', x.fixture); assert.ok(c, x.label); }
  assert.equal(S.clean('board', { cards: ['a'], who: [], kinds: ['client'], carried: ['0'] }), null, 'mismatched lists are refused');
  assert.equal(S.clean('board', Object.assign({}, FIX, { kinds: ['client', 'boss'] })), null);
});
await test('display: mounting draws one card per entry with the picked stamp and the carried tag (fake DOM, textContent only)', async () => {
  const made = [];
  const mk = (tag) => { const e = { tag, className: '', children: [], style: { setProperty() {} }, attrs: {}, _t: '', set textContent(v) { this._t = v; }, get textContent() { return this._t; }, appendChild(c) { this.children.push(c); return c; }, setAttribute(k, v) { this.attrs[k] = v; } }; made.push(e); return e; };
  const ctx = { document: { createElement: mk } }; ctx.self = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(APP, 'display', 'shows.js'), 'utf8'), ctx, { filename: 'shows.js' });
  vm.runInContext(fs.readFileSync(path.join(APP, 'display', 'board.js'), 'utf8'), ctx, { filename: 'board.js' });
  const node = await ctx.B68Shows.mount({ kind: 'board', payload: FIX }, { document: ctx.document });
  assert.ok(node && /dp-show-board/.test(node.className));
  const cork = node.children.filter((c) => /dp-bd-cork/.test(c.className))[0]; assert.equal(cork.children.length, 2);
  const texts = made.map((e) => e.textContent).filter(Boolean);
  assert.ok(texts.includes('Picked') && texts.some((t) => /Carried over/.test(t)) && texts.includes(FIX.cards[0]));
  assert.ok(cork.children[1].className.includes('dp-bd-picked') && cork.children[1].className.includes('dp-bd-late'));
});

/* ---------- the store: who may read and write ---------- */
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
await test('store: a player\'s opportunities are theirs alone (the other player and the iPad read none); the GM reads all and keeps a GM-scope board row nobody else sees', async () => {
  const db = asD1(await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') })); const s = storeRig();
  const read = async (who, q) => (await (await s.call(db, 'GET', '/api/docs' + q, undefined, who)).json()).docs;
  let r = await s.call(db, 'PUT', '/api/docs', { kind: 'opportunity', scope: 'player', json: PB28.add(null, 'client', MARK + ' A', 5) }, PA); assert.equal(r.status, 200);
  r = await s.call(db, 'PUT', '/api/docs', { kind: 'opportunity', scope: 'player', json: PB28.add(null, 'target', 'B card', 6) }, PB); assert.equal(r.status, 200);
  assert.equal((await read(PA, '?kind=opportunity')).length, 1); assert.equal((await read(PB, '?kind=opportunity')).length, 1);
  assert.ok(!JSON.stringify(await read(PB, '?kind=opportunity')).includes(MARK), 'B never sees A\'s card');
  assert.deepEqual(await read(DISPLAY, '?kind=opportunity'), [], 'the iPad reads none of it');
  assert.equal((await read(GM, '?kind=opportunity')).length, 2);
  r = await s.call(db, 'PUT', '/api/docs', { kind: 'opportunity', owner: 'bea@example.test', scope: 'player', json: { v: 1, items: [] } }, PA); assert.equal(r.status, 403, 'A cannot write B\'s row');
  r = await s.call(db, 'PUT', '/api/docs', { kind: 'board', scope: 'public', json: { v: 1 } }, PA); assert.equal(r.status, 403, 'a player cannot write the board row');
  r = await s.call(db, 'PUT', '/api/docs', { kind: 'board', scope: 'gm', json: { v: 1, shown: [MARK] } }, GM); assert.equal(r.status, 200);
  for (const who of [PA, PB, DISPLAY]) assert.deepEqual(await read(who, '?kind=board'), [], 'the GM board row is absent for everyone else');
  assert.equal((await read(GM, '?kind=board')).length, 1);
});

/* ---------- 5.5 ---------- */

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
