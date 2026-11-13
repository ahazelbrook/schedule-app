// Handouts on the players' phones (IP4, setting phone.handouts): the pure parts of the GM's Send to… (app/gm/handout-send.js) and the phone's list
// (app/sheet/handouts.js), the GM controller against a fake store (what it reads and writes, the take-back ask), and where the files are bundled.
// No browser, no network. Invented ids and file names only.
//   node checks/runtime/handouts.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const G = require(path.join(ROOT, 'app', 'gm', 'handout-send.js'));
const P = require(path.join(ROOT, 'app', 'sheet', 'handouts.js'));
const F = require(path.join(ROOT, 'app', 'features.js'));

let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const X = { id: 'sewer-map', title: 'Invented sewer map', file: 'a1b2c3d4e5f60718.png', when: 'GM-ONLY- cue line' };
const Y = { id: 'ledger', title: 'Invented ledger page', file: 'f0e1d2c3b4a59687.png' };

await test('the setting: phone.handouts is a phone setting, off with nothing stored', () => {
  const s = F.get('phone.handouts');
  assert.ok(s && s.setting === true && s.surface === 'phone' && s.default === false, JSON.stringify(s));
  assert.equal(F.valueOf({}, 'phone.handouts'), false);
  assert.equal(F.valueOf({ features: { 'phone.handouts': true } }, 'phone.handouts'), true);
});

await test('GM pure: withItem adds once, keeps the order, never copies the cue; without drops it and says null when nothing is left', () => {
  const r1 = G.withItem(null, X, 1000);
  assert.deepEqual(r1, { v: 1, items: [{ id: 'sewer-map', title: 'Invented sewer map', file: 'a1b2c3d4e5f60718.png', at: 1000 }] });
  assert.ok(!JSON.stringify(r1).includes('GM-ONLY'), 'the cue stays on the GM page');
  const r2 = G.withItem(r1, Y, 2000);
  assert.deepEqual(r2.items.map((i) => i.id), ['sewer-map', 'ledger']);
  assert.deepEqual(G.withItem(r2, X, 3000), r2, 'sending again changes nothing (the first time stays)');
  assert.deepEqual(G.without(r2, 'sewer-map').items.map((i) => i.id), ['ledger']);
  assert.equal(G.without(G.without(r2, 'sewer-map'), 'ledger'), null);
});

await test('GM pure: clean drops a bad file name (a path, a script, a bad type) and a repeat; at most MAX items', () => {
  const bad = { v: 1, items: [X, { id: 'p', file: '../secret.png' }, { id: 'q', file: 'x.html' }, { id: 'r', file: 'a/b.png' }, { id: '', file: 'ok.png' }, Object.assign({}, X, { title: 'again' })] };
  assert.deepEqual(G.clean(bad).map((i) => i.id), ['sewer-map']);
  const many = { v: 1, items: Array.from({ length: G.MAX + 7 }, (_, i) => ({ id: 'h' + i, title: 'T', file: 'f' + i + '.png', at: i + 1 })) };
  assert.equal(G.clean(many).length, G.MAX);
  assert.equal(G.clean(many)[0].id, 'h7', 'the oldest go first');
});

await test('GM pure: names are first names, a clash told apart; order puts tonight\'s players first', () => {
  const n = G.names([{ id: 'p1@x.test', name: 'Nell Arbuthnot' }, { id: 'p2@x.test', name: 'Ray Okonjo' }, { id: 'p3@x.test', name: 'Ray Petrakis' }, { id: 'p4@x.test', name: '' }]);
  assert.deepEqual(n.map((x) => x.name), ['Nell', 'Ray O.', 'Ray P.', 'p4']);
  assert.deepEqual(G.order(n, ['p1@x.test']).map((x) => x.id), ['p2@x.test', 'p3@x.test', 'p4@x.test', 'p1@x.test']);
  assert.deepEqual(G.sentTo({ 'p1@x.test': G.withItem(null, X, 1), 'p2@x.test': G.withItem(null, Y, 1) }, 'sewer-map'), ['p1@x.test']);
});

await test('phone pure: clean is newest first and checks every file name; fresh counts what arrived after the seen mark; the toast words', () => {
  const row = { v: 1, items: [Object.assign({}, X, { at: 100 }), Object.assign({}, Y, { at: 300 }), { id: 'evil', title: 'x', file: 'javascript:alert(1)', at: 400 }, { id: 'svg', title: 'Map', file: 'abc.svg', at: 200 }] };
  const c = P.clean(row);
  assert.deepEqual(c.map((i) => i.id), ['ledger', 'svg', 'sewer-map']);
  assert.equal(P.fresh(c, 150), 2); assert.equal(P.fresh(c, 300), 0); assert.equal(P.fresh(c, 0), 3);
  assert.equal(P.toastText([c[0]]), 'Invented ledger page is in your Handouts');
  assert.equal(P.toastText(c), 'Invented ledger page and 2 more are in your Handouts');
  assert.deepEqual(P.clean(null), []); assert.deepEqual(P.clean({ items: 'x' }), []);
});

/* the GM controller against a fake store: the members, GET/PUT/DELETE /api/docs, as the Worker answers them for the GM */
function fakeDoc() {
  const mk = (tag) => {
    const e = { tag, attrs: {}, text: '', disabled: false, type: '', className: '', title: '' };
    e.setAttribute = (k, v) => { e.attrs[k] = String(v); };
    Object.defineProperty(e, 'textContent', { get: () => e.text, set: (v) => { e.text = String(v); } });
    Object.defineProperty(e, 'outerHTML', { get: () => '<' + tag + ' type="' + e.type + '" class="' + e.className + '"' + Object.entries(e.attrs).map(([k, v]) => ' ' + k + '="' + v + '"').join('') + (e.disabled ? ' disabled' : '') + '>' + e.text + '</' + tag + '>' });
    return e;
  };
  return { createElement: mk, querySelectorAll: () => [], activeElement: null };
}
function fakeStore(members) {
  const rows = {}, calls = [];
  const fetch = async (url, o) => {
    const u = new URL(url, 'http://x.test'), m = (o && o.method) || 'GET';
    calls.push(m + ' ' + u.pathname + u.search);
    const ok = (j) => ({ ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) });
    if (u.pathname === '/api/members') return ok({ members });
    if (u.pathname !== '/api/docs') return { ok: false, status: 404, text: async () => '{"error":"no"}' };
    if (m === 'GET') {
      const owner = u.searchParams.get('owner');
      return ok({ docs: Object.keys(rows).filter((o2) => !owner || o2 === owner).map((o2) => ({ kind: 'handout', owner: o2, scope: 'player', json: rows[o2] })), more: false });
    }
    if (m === 'PUT') { const b = JSON.parse(o.body); assert.equal(b.kind, 'handout'); assert.equal(b.scope, 'player'); rows[b.owner] = b.json; return ok({ ok: true }); }
    if (m === 'DELETE') { const ow = u.searchParams.get('owner'); if (!rows[ow]) return { ok: false, status: 404, text: async () => '{"error":"no such row"}' }; delete rows[ow]; return ok({ ok: true }); }
  };
  return { rows, calls, fetch };
}
const chip = (id, to) => ({ getAttribute: (k) => ({ 'data-id': id, 'data-to': to })[k] });
const MEMBERS = [{ id: 'gm@x.test', name: 'The GM', role: 'gm' }, { id: 'p1@x.test', name: 'Nell Arbuthnot', role: 'player' }, { id: 'p2@x.test', name: 'Ray Okonjo', role: 'player' }, { id: 'pad@x.test', name: 'iPad', role: 'display' }];

await test('GM controller: chips for the players only (not the GM, not the iPad), Everyone, and "Sent to"; a tap sends one row to that player', async () => {
  const st = fakeStore(MEMBERS), toasts = [], asks = [];
  const c = G.create({ doc: fakeDoc(), fetch: st.fetch, toast: (m) => toasts.push(m), ask: (m, go) => { asks.push(m); go(); }, away: () => [], now: () => 5000 });
  c.html(X); c.html(Y); await c.load(true);
  let h = c.html(X);
  assert.match(h, /data-to="p1@x.test"[^>]*aria-pressed="false"[^>]*>Nell</); assert.match(h, /data-to="p2@x.test"[^>]*>Ray</); assert.match(h, /data-to="\*"[^>]*>Everyone</);
  assert.ok(!/gm@x\.test|pad@x\.test/.test(h), 'only players get a chip');
  assert.match(h, /Not sent to any phone/);
  await c.tap(chip('sewer-map', 'p1@x.test'));
  assert.deepEqual(Object.keys(st.rows), ['p1@x.test']);
  assert.deepEqual(st.rows['p1@x.test'], { v: 1, items: [{ id: 'sewer-map', title: 'Invented sewer map', file: 'a1b2c3d4e5f60718.png', at: 5000 }] });
  assert.ok(st.calls.includes('GET /api/docs?kind=handout&owner=p1%40x.test&limit=1'), 'the row is read before it is written');
  h = c.html(X);
  assert.match(h, /data-to="p1@x.test"[^>]*aria-pressed="true"/); assert.match(h, /Sent to: Nell/);
  assert.equal(asks.length, 0, 'a send asks nothing');
  assert.match(toasts.pop(), /Sent to Nell: Invented sewer map/);
});

await test('GM controller: a second handout merges into the row; Everyone fills the rest; take back asks once and deletes an emptied row', async () => {
  const st = fakeStore(MEMBERS), asks = [];
  let yes = true;
  const c = G.create({ doc: fakeDoc(), fetch: st.fetch, toast() {}, ask: (m, go) => { asks.push(m); if (yes) go(); }, away: () => [], now: () => 7000 });
  c.html(X); c.html(Y); await c.load(true);
  await c.tap(chip('sewer-map', 'p1@x.test'));
  await c.tap(chip('ledger', 'p1@x.test'));
  assert.deepEqual(st.rows['p1@x.test'].items.map((i) => i.id), ['sewer-map', 'ledger']);
  await c.tap(chip('sewer-map', '*'));
  assert.deepEqual(Object.keys(st.rows).sort(), ['p1@x.test', 'p2@x.test']);
  assert.deepEqual(st.rows['p2@x.test'].items.map((i) => i.id), ['sewer-map']);
  assert.match(c.html(X), /data-to="\*"[^>]*aria-pressed="true"/);
  yes = false; await c.tap(chip('sewer-map', 'p2@x.test')); await new Promise((r) => setTimeout(r, 5));
  assert.equal(asks.pop(), 'Take it back from Ray?'); assert.ok(st.rows['p2@x.test'], 'a no keeps it');
  yes = true; await c.tap(chip('sewer-map', 'p2@x.test'));
  assert.equal(asks.pop(), 'Take it back from Ray?');
  assert.ok(!st.rows['p2@x.test'], 'the emptied row is deleted');
  assert.ok(st.calls.includes('DELETE /api/docs?kind=handout&owner=p2%40x.test'));
  await c.tap(chip('sewer-map', 'p1@x.test'));
  assert.deepEqual(st.rows['p1@x.test'].items.map((i) => i.id), ['ledger'], 'the other handout stays');
  await c.tap(chip('ledger', '*'));      /* p2 lacks it: Everyone sends, no ask */
  await c.tap(chip('ledger', '*'));      /* now everyone has it: Everyone takes it back */
  assert.equal(asks.pop(), 'Take it back from everyone?');
  assert.deepEqual(st.rows, {});
});

await test('bundles: the phone list and the GM Send to are lazy bundles of their own, in no other bundle, each stylesheet in CSS_ORDER', () => {
  const W = { document: undefined };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'app', 'routes.js'), 'utf8'), W);
  const L = W.B68Load;
  assert.equal(JSON.stringify(L.BUNDLES.handouts), JSON.stringify(['sheet/handouts.css', 'sheet/handouts.js']));
  assert.equal(JSON.stringify(L.BUNDLES['gm-handouts']), JSON.stringify(['gm/handout-send.css', 'gm/handout-send.js']));
  for (const [n, list] of Object.entries(L.BUNDLES)) if (n !== 'handouts' && n !== 'gm-handouts') assert.ok(!list.some((f) => /handouts?\.(js|css)$|handout-send/.test(f)), n);
  assert.ok(L.CSS_ORDER.includes('sheet/handouts.css') && L.CSS_ORDER.includes('gm/handout-send.css'));
  const boot = fs.readFileSync(path.join(ROOT, 'app', 'boot.js'), 'utf8');
  assert.match(boot, /\['phone\.handouts', 'handouts', 'B68Handouts'\]/, 'boot.js starts it for a player while the setting is on');
  const gm = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  assert.match(gm, /valueOf\(S\.doc, 'phone\.handouts'\)/); assert.match(gm, /B68Load\.need\('gm-handouts'\)/);
});

await test('nothing new writes as a player and nothing touches the shared screen: no PUT in the phone file, no display call in the GM file', () => {
  const ph = fs.readFileSync(path.join(ROOT, 'app', 'sheet', 'handouts.js'), 'utf8'), gm = fs.readFileSync(path.join(ROOT, 'app', 'gm', 'handout-send.js'), 'utf8');
  assert.ok(!/method:\s*'(PUT|DELETE|POST|PATCH)'/.test(ph), 'the phone only reads');
  assert.ok(!/gm\/display|pushDisplay|\/show/.test(gm), 'sending never puts anything on the iPad');
  assert.ok(!/innerHTML\s*=/.test(ph), 'the phone draws with nodes and textContent');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
