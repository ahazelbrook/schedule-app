// Unit test for app/runtime/cf.js: loads the adapter into a fake window/document with a fetch backed by an
// in-memory implementation of the HOSTING.md API (tombstones included). Plain node, no frameworks.
//   node checks/runtime/adapter.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'app', 'runtime', 'cf.js'), 'utf8');
const POLL = 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clone = (v) => JSON.parse(JSON.stringify(v));

/* ---------- the fake API ---------- */
function fakeApi({ gms = ['gm@x.test'] } = {}) {
  let tick = Date.parse('2026-10-10T12:00:00.000Z');
  const now = () => new Date(++tick).toISOString();     // strictly increasing server clock
  const rows = {};                                       // id -> { owner, updatedAt, deleted, doc }
  const members = {};
  const calls = [];
  const s = {
    rows, calls, members, now,
    status: {}, conflicts: 0,                           // conflicts: answer the next N writes 409                                          // path prefix -> forced response kind ('401' | 'redirect' | 'html' | 'down')
    roleOf: (email) => (gms.includes(email) ? 'gm' : 'player'),
    // direct edits, as another client would make them
    put(id, doc) { const t = now(); rows[id] = { owner: doc.owner || null, updatedAt: t, deleted: false, doc: { ...clone(doc), updatedAt: t } }; },
    tombstone(id) { rows[id] = { owner: null, updatedAt: now(), deleted: true, doc: {} }; },
  };
  function merge(t, p) { for (const k of Object.keys(p)) { const v = p[k]; if (v === null) delete t[k]; else if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) merge(t[k], v); else t[k] = clone(v); } return t; }
  s.handle = function (user, method, url, body) {
    calls.push(method + ' ' + url);
    const u = new URL(url, 'https://app.test');
    const p = u.pathname;
    for (const pre of Object.keys(s.status)) if (p.startsWith(pre)) return { forced: s.status[pre] };
    if (method !== 'GET' && s.conflicts > 0) { s.conflicts--; return [409, { error: 'the character kept changing, try again' }]; }
    if (!user) return [401, { error: 'not signed in' }];
    const me = { id: user.email, email: user.email, name: user.name || '', role: s.roleOf(user.email), campaign: 'default' };
    if (p === '/api/me') { members[me.id] = { id: me.id, name: me.name, role: me.role }; return [200, me]; }
    if (p === '/api/members') return [200, { members: Object.values(members) }];
    if (p === '/api/characters' && method === 'GET') {
      const since = u.searchParams.get('since');
      const list = Object.entries(rows)
        .filter(([, r]) => (since ? r.updatedAt > since : !r.deleted))
        .sort((a, b) => (a[1].updatedAt < b[1].updatedAt ? 1 : -1))
        .map(([id, r]) => ({ id, doc: r.deleted ? null : clone(r.doc), updatedAt: r.updatedAt, deleted: r.deleted }));
      return [200, { now: new Date(tick - 2000).toISOString(), docs: list }];   // like the real API: 2 s behind, so rows repeat
    }
    const m = p.match(/^\/api\/characters\/([A-Za-z0-9_-]{1,80})$/);
    if (!m) return [404, { error: 'not found' }];
    const id = m[1], row = rows[id], live = row && !row.deleted;
    const gm = me.role === 'gm';
    if (method === 'GET') return live ? [200, { id, doc: clone(row.doc) }] : [404, { error: 'not found' }];
    if (live && !gm && row.owner !== me.id) return [403, { error: 'not your character' }];
    if (method === 'DELETE') { if (!live) return [404, { error: 'not found' }]; s.tombstone(id); return [200, { ok: true }]; }
    const t = now();
    let doc;
    if (method === 'PUT') {
      doc = clone(body); doc.updatedAt = t;
      if (live) doc.owner = row.owner; else { doc.createdAt = doc.createdAt || t; if (!gm) doc.owner = me.id; }
    } else if (method === 'PATCH') {
      if (!live) return [404, { error: 'not found' }];
      doc = merge(clone(row.doc), body); doc.updatedAt = t; doc.owner = row.owner;
    } else return [400, { error: 'bad method' }];
    rows[id] = { owner: doc.owner || null, updatedAt: t, deleted: false, doc };
    return [200, { id, doc: clone(doc) }];
  };
  return s;
}

/* ---------- a fake browser running cf.js ---------- */
function browser(server, user, { preset, protocol = 'https:' } = {}) {
  const fetchLog = [];
  const clicks = [];
  const listeners = {};
  const document = {
    hidden: false,
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn); },
    createElement: (tag) => ({ tag, style: {}, click() { clicks.push({ href: this.href, download: this.download }); }, parentNode: null }),
    body: { appendChild(n) { n.parentNode = this; }, removeChild(n) { n.parentNode = null; } },
  };
  const blobs = {};
  let nBlob = 0;
  async function fetch(url, opts = {}) {
    fetchLog.push({ url, opts });
    await sleep(2);
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    const r = server.handle(user, opts.method || 'GET', url, body);
    const mk = (status, text, ct, extra = {}) => ({ status, ok: status >= 200 && status < 300, redirected: false, type: 'basic', headers: { get: (h) => (h.toLowerCase() === 'content-type' ? ct : null) }, text: async () => text, ...extra });
    if (r.forced === 'down') throw new TypeError('Failed to fetch');
    if (r.forced === 'redirect') return mk(0, '', null, { type: 'opaqueredirect', ok: false });
    if (r.forced === 'html') return mk(200, '<html>Sign in</html>', 'text/html', { redirected: true });
    if (r.forced === '401') return mk(401, '{"error":"not signed in"}', 'application/json');
    return mk(r[0], JSON.stringify(r[1]), 'application/json; charset=utf-8');
  }
  const win = {
    document, fetch, setTimeout, clearTimeout, console, Blob, location: { protocol, pathname: '/' },
    URL: { createObjectURL: (b) => { const u = 'blob:' + (++nBlob); blobs[u] = b; return u; }, revokeObjectURL: () => {} },
  };
  win.window = win;
  if (preset) win.claude = preset;
  win.__B68_POLL_MS = POLL;
  vm.createContext(win);
  vm.runInContext(SRC, win, { filename: 'cf.js' });
  return { win, fetchLog, clicks, blobs, document, listeners };
}

/* wait until fn() is truthy */
async function until(fn, ms = 2000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(5); } return fn(); }

/* ---------- tests ---------- */
let failed = 0;
async function test(name, fn) {
  try { await fn(); console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
function eq(a, b, msg) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || 'not equal') + ': got ' + A + ' want ' + B); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
const char = (name, extra = {}) => ({ v: 2, name, playbook: 'hound', spec: { id: name }, sheet: { name }, play: { stress: 0, harm: { l1: '' } }, ...extra });

await test('an existing window.claude is left untouched', async () => {
  const preset = { use: () => 'artifact', marker: 1 };
  const b = browser(fakeApi(), { email: 'gm@x.test' }, { preset });
  ok(b.win.claude === preset, 'window.claude replaced');
  eq(b.win.B68Runtime, undefined, 'B68Runtime should not be set');
  eq(b.fetchLog.length, 0, 'fetch calls');
});

await test('inert from file:// (no window.claude, no fetch)', async () => {
  const b = browser(fakeApi(), { email: 'gm@x.test' }, { protocol: 'file:' });
  eq(b.win.claude, undefined, 'window.claude'); eq(b.win.B68Runtime, undefined, 'B68Runtime'); eq(b.fetchLog.length, 0, 'fetch calls');
});

await test('update: optimistic deep merge (objects merge, arrays replace, null deletes) matches the server', async () => {
  const api = fakeApi();
  api.put('m', char('m', { play: { stress: 1, harm: { l1: 'cut', l2: 'x' }, items: ['a', 'b'], xp: { playbook: 2 } } }));
  const b = browser(api, { email: 'gm@x.test' });
  const ref = (await b.win.claude.use('db')).collection('characters').doc('m');
  const snaps = []; const un = ref.onSnapshot((s) => snaps.push(s));
  await until(() => snaps.length);
  const p = ref.update({ play: { harm: { l2: null, l3: 'broken' }, items: ['c'], xp: { playbook: 3 } } });
  const want = { stress: 1, harm: { l1: 'cut', l3: 'broken' }, items: ['c'], xp: { playbook: 3 } };
  const opt = snaps[snaps.length - 1];
  eq([opt.data().play, opt.metadata.hasPendingWrites], [want, true], 'optimistic snapshot');
  await p;
  eq(api.rows.m.doc.play, want, 'server');
  const fin = snaps[snaps.length - 1];
  eq([fin.data().play, fin.data().updatedAt, fin.metadata.hasPendingWrites], [want, api.rows.m.updatedAt, false], 'after the server answered');
  un();
});

await test('user: shapes for a GM, role on B68Runtime.me, profiles cached', async () => {
  const api = fakeApi();
  api.members['pl@x.test'] = { id: 'pl@x.test', name: 'Pat', role: 'player' };
  const b = browser(api, { email: 'gm@x.test', name: 'Gloria' });
  const u = await b.win.claude.use('user');
  ok(u, 'user null');
  ok(b.win.claude.use('user') === b.win.claude.use('user'), 'use() not memoized');
  eq(await u.id(), 'gm@x.test');
  eq(await u.me(), { id: 'gm@x.test', name: 'Gloria', email: 'gm@x.test', isOwner: true, canEdit: true });
  eq(await u.can('data.write'), true); eq(await u.can('people.add'), false);
  eq(await u.isOwner(), true); eq(await u.canEdit(), true);
  eq(b.win.B68Runtime.kind, 'cloudflare'); eq(b.win.B68Runtime.me.role, 'gm'); eq(b.win.B68Runtime.me.name, 'Gloria');
  const ps = await u.profiles(['pl@x.test', 'nobody@x.test']);
  eq(ps, { 'pl@x.test': { id: 'pl@x.test', name: 'Pat' }, 'nobody@x.test': { id: 'nobody@x.test', name: '' } });
  eq(await u.profiles('pl@x.test'), { 'pl@x.test': { id: 'pl@x.test', name: 'Pat' } });
  eq(api.calls.filter((c) => c.endsWith('/api/members')).length, 1, '/api/members calls (cached)');
  eq(api.calls.filter((c) => c.endsWith('/api/me')).length, 1, '/api/me calls');
  eq(await b.win.claude.use('nope'), null);
  const f = b.fetchLog[0].opts; eq([f.credentials, f.cache], ['same-origin', 'no-store'], 'fetch options');
});

await test('user: a player is not owner/editor', async () => {
  const b = browser(fakeApi(), { email: 'pl@x.test' });
  const u = await b.win.claude.use('user');
  eq([await u.isOwner(), await u.canEdit(), await u.can('data.write')], [false, false, true]);
});

await test('user and db are null when /api/me answers 401', async () => {
  const b = browser(fakeApi(), null);
  eq(await b.win.claude.use('user'), null); eq(await b.win.claude.use('db'), null);
  eq(b.win.B68Runtime.me, null);
});

await test('user and db are null when /api/me is unreachable', async () => {
  const api = fakeApi(); api.status['/api/me'] = 'down';
  const b = browser(api, { email: 'gm@x.test' });
  eq(await b.win.claude.use('user'), null); eq(await b.win.claude.use('db'), null);
});

await test('set, then a query snapshot ordered by updatedAt desc and limited; changes arrive by poll; delete and unsubscribe', async () => {
  const api = fakeApi();
  const b = browser(api, { email: 'gm@x.test' });
  const db = await b.win.claude.use('db');
  const col = db.collection('characters');
  for (const n of ['a', 'b', 'c']) await col.doc(n).set(char(n, { owner: 'gm@x.test' }));
  eq(Object.keys(api.rows).length, 3);
  const snaps = [], errs = [];
  const unsub = col.orderBy('updatedAt', 'desc').limit(2).onSnapshot((s) => snaps.push(s), (e) => errs.push(e));
  await until(() => snaps.length);
  const ids = (s) => s.docs.map((d) => d.id);
  eq(ids(snaps[0]), ['c', 'b'], 'first snapshot order');
  eq([snaps[0].size, snaps[0].empty], [2, false]);
  let seen = []; snaps[0].forEach((d) => seen.push(d.id)); eq(seen, ['c', 'b'], 'forEach');
  // data() is a deep clone
  const d0 = snaps[0].docs[0].data(); d0.sheet.name = 'mutated'; eq(snaps[0].docs[0].data().sheet.name, 'c', 'data() clone');

  // own write: optimistic snapshot before the server answers
  const n0 = snaps.length;
  const w = col.doc('a').update({ play: { stress: 3 } });
  ok(snaps.length > n0, 'no optimistic notify');
  await w;
  eq(api.rows.a.doc.play, { stress: 3, harm: { l1: '' } }, 'PATCH deep merge on server');
  await until(() => ids(snaps[snaps.length - 1])[0] === 'a');
  eq(ids(snaps[snaps.length - 1]), ['a', 'c'], 'after own write');

  // a change made directly in the API arrives within two poll intervals
  const t0 = Date.now(), before = snaps.length;
  api.put('z', char('z'));
  await until(() => snaps.length > before && ids(snaps[snaps.length - 1])[0] === 'z', POLL * 2 + 60);
  const took = Date.now() - t0;
  eq(ids(snaps[snaps.length - 1]), ['z', 'a'], 'external change');
  ok(took <= POLL * 2 + 60, 'external change took ' + took + 'ms');

  // no change, no notification
  const quiet = snaps.length; await sleep(POLL * 3); eq(snaps.length, quiet, 'snapshots without changes');

  // delete: the per-doc snapshot says exists false, the query drops it
  const dsnaps = [];
  const dun = col.doc('z').onSnapshot((s) => dsnaps.push(s));
  await until(() => dsnaps.length);
  eq([dsnaps[0].exists, dsnaps[0].data().name], [true, 'z']);
  await col.doc('z').delete();
  eq(api.rows.z.deleted, true, 'tombstone on server');
  const last = dsnaps[dsnaps.length - 1]; eq([last.exists, last.data()], [false, undefined], 'doc snapshot after delete');
  eq(ids(snaps[snaps.length - 1]), ['a', 'c'], 'query after delete');

  // a tombstone from elsewhere removes and notifies
  const dsn = [];
  const cun = col.doc('c').onSnapshot((s) => dsn.push(s));
  await until(() => dsn.length);
  api.tombstone('c');
  await until(() => dsn.length > 1 && !dsn[dsn.length - 1].exists, POLL * 2 + 60);
  eq(dsn[dsn.length - 1].exists, false, 'remote tombstone doc snapshot');
  eq(ids(snaps[snaps.length - 1]), ['a', 'b'], 'remote tombstone query');

  // where
  const wh = await col.where('name', 'in', ['a', 'b']).orderBy('name').get();
  eq(wh.docs.map((d) => d.id), ['a', 'b'], 'where in');
  const wn = await col.where('name', '!=', 'a').get();
  eq(wn.docs.map((d) => d.id), ['b'], 'where !=');

  // doc get
  const g = await col.doc('a').get(); eq([g.exists, g.data().play.stress], [true, 3]);
  const gz = await col.doc('z').get(); eq([gz.exists, gz.data()], [false, undefined]);

  // unsubscribe stops callbacks and the poller
  unsub(); dun(); cun();
  const frozen = snaps.length, polls = api.calls.length;
  api.put('y', char('y'));
  await sleep(POLL * 3);
  eq(snaps.length, frozen, 'callbacks after unsubscribe');
  eq(api.calls.length, polls, 'polls after the last unsubscribe');
  eq(errs.length, 0, 'errors');
});

await test('a write by a player to a character they do not own rejects with the API message', async () => {
  const api = fakeApi();
  api.put('gmc', char('gmc', { owner: 'gm@x.test' }));
  const b = browser(api, { email: 'pl@x.test' });
  const col = (await b.win.claude.use('db')).collection('characters');
  let err = null;
  try { await col.doc('gmc').set(char('mine')); } catch (e) { err = e; }
  ok(err, 'did not reject'); eq(err.message, 'not your character');
  err = null; try { await col.doc('gmc').delete(); } catch (e) { err = e; } eq(err && err.message, 'not your character');
  // a new one is fine and owned by the player
  await col.doc('pnew').set(char('pnew')); eq(api.rows.pnew.owner, 'pl@x.test');
});

await test('409: a write is retried, then rejects with the API message', async () => {
  const api = fakeApi();
  const b = browser(api, { email: 'gm@x.test' });
  const col = (await b.win.claude.use('db')).collection('characters');
  api.conflicts = 2; await col.doc('k').set(char('k'));
  eq([api.conflicts, !!api.rows.k], [0, true], 'retried twice and landed');
  api.conflicts = 5; let err = null;
  try { await col.doc('k').update({ name: 'k2' }); } catch (e) { err = e; }
  eq(err && err.message, 'the character kept changing, try again'); eq(api.rows.k.doc.name, 'k');
});

await test('a failed write resyncs the cache from the server', async () => {
  const api = fakeApi();
  api.put('gmc', char('gmc', { owner: 'gm@x.test' }));
  const b = browser(api, { email: 'pl@x.test' });
  const col = (await b.win.claude.use('db')).collection('characters');
  const snaps = []; const un = col.onSnapshot((s) => snaps.push(s));
  await until(() => snaps.length);
  await col.doc('gmc').update({ name: 'hijacked' }).catch(() => {});
  await until(() => snaps[snaps.length - 1].docs[0].data().name === 'gmc', POLL * 3);
  eq(snaps[snaps.length - 1].docs[0].data().name, 'gmc', 'reverted');
  un();
});

await test('network errors surface once through err callbacks and polling retries', async () => {
  const api = fakeApi();
  const b = browser(api, { email: 'gm@x.test' });
  const col = (await b.win.claude.use('db')).collection('characters');
  const snaps = [], errs = [];
  const un = col.onSnapshot((s) => snaps.push(s), (e) => errs.push(e));
  await until(() => snaps.length);
  api.status['/api/characters'] = 'down';
  await sleep(POLL * 4);
  eq(errs.length, 1, 'error surfaced once');
  delete api.status['/api/characters'];
  api.put('back', char('back'));
  await until(() => snaps.length > 1, POLL * 3);
  eq(snaps[snaps.length - 1].docs.map((d) => d.id), ['back'], 'recovered');
  un();
});

for (const kind of ['401', 'redirect', 'html']) {
  await test('signed out on a poll (' + kind + '): err once, polling stops, writes reject', async () => {
    const api = fakeApi();
    const b = browser(api, { email: 'gm@x.test' });
    const col = (await b.win.claude.use('db')).collection('characters');
    const snaps = [], errs = [];
    const un = col.onSnapshot((s) => snaps.push(s), (e) => errs.push(e));
    await until(() => snaps.length);
    api.status['/api/characters'] = kind;
    await until(() => errs.length, POLL * 3);
    const n = api.calls.length;
    await sleep(POLL * 3);
    eq(errs.length, 1, 'err calls');
    eq(errs[0].message, 'signed out: reload the page to sign in again');
    eq(api.calls.length, n, 'kept polling');
    delete api.status['/api/characters'];
    let err = null; try { await col.doc('x').set(char('x')); } catch (e) { err = e; }
    eq(err && err.message, 'signed out: reload the page to sign in again', 'write after sign-out');
    ok(!api.rows.x, 'write reached the server');
    un();
  });
}

await test('visibility: hidden pages poll on the slow interval', async () => {
  const api = fakeApi();
  const b = browser(api, { email: 'gm@x.test' });
  delete b.win.__B68_POLL_MS;
  const col = (await b.win.claude.use('db')).collection('characters');
  const snaps = []; const un = col.onSnapshot((s) => snaps.push(s));
  await until(() => snaps.length);
  const timers = [];
  const real = b.win.setTimeout; b.win.setTimeout = (fn, ms) => { timers.push(ms); return real(fn, ms); };
  b.document.hidden = true; b.listeners.visibilitychange.forEach((fn) => fn());
  b.document.hidden = false; b.listeners.visibilitychange.forEach((fn) => fn());
  await sleep(20);
  b.win.setTimeout = real;
  ok(timers.includes(20000), 'hidden interval: ' + timers);
  ok(timers.includes(4000), 'visible interval: ' + timers);
  un();
});

await test('downloads.save makes a Blob and clicks a hidden anchor', async () => {
  const b = browser(fakeApi(), { email: 'gm@x.test' });
  const dl = await b.win.claude.use('downloads');
  const r = await dl.save({ filename: 'crew.json', data: '{"a":1}' });
  eq(r, { status: 'saved' });
  eq(b.clicks.length, 1); eq(b.clicks[0].download, 'crew.json');
  const blob = b.blobs[b.clicks[0].href]; eq([blob.type, await blob.text()], ['application/json', '{"a":1}']);
  await dl.save({ filename: 'x.bin', data: new Uint8Array([1, 2, 3]) });
  eq(b.blobs[b.clicks[1].href].size, 3, 'typed array');
  await dl.save({ filename: 'y.bin', data: new Uint8Array([4, 5]).buffer });
  eq(b.blobs[b.clicks[2].href].size, 2, 'ArrayBuffer');
  const given = new Blob(['zz']); await dl.save({ filename: 'z.png', data: given });
  ok(b.blobs[b.clicks[3].href] === given, 'Blob passed as-is');
});

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
