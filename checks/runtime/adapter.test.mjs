// Unit test for app/runtime/cf.js: loads the adapter into a fake window/document with a fetch backed by an
// in-memory implementation of the HOSTING.md API (tombstones included). Plain node, no frameworks.
//   node checks/runtime/adapter.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withClockIds, applyClockOps, checkClockOps, changedFills, playerMayWrite, STALE_CLOCKS, CLOCK_SIZES, CLOCK_KINDS } from '../../functions/_lib/campaign.js';

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
    rulesRows: [], rulesVersion: '0',                   // the rules wiki's corpus (RULES.md)
    npcs: {},                                           // the cast: id -> { updatedAt, deleted, doc } (the GM writes, a player reads the revealed ones)
    putNpc(id, doc) { s.npcs[id] = { updatedAt: now(), deleted: false, doc: clone(doc) }; },
    npcsAt() { const t = Object.values(s.npcs).map((r) => r.updatedAt).sort(); return t.length ? t[t.length - 1] : null; },
    campaign: null,                                     // the stored campaign doc (null = none yet)
    gm: { parts: {}, state: {}, stateAt: null, seq: 0, display: { kind: 'blank' } },   // the GM tools (GM.md)
    setCampaign(doc) { s.campaign = { ...clone(doc), updatedAt: now() }; },
  };
  const defaultCampaign = () => ({
    v: 1, session: { number: 0, startedAt: null, endedAt: null },
    crew: { name: '', type: '', lair: '', notes: '', tier: 0, hold: 'weak', rep: 0, turf: 0, heat: 0, wanted: 0, vault: 0, claims: [], cohorts: [], factions: [] },
    clocks: [], log: [], updatedAt: null,
  });
  s.defaultCampaign = defaultCampaign;
  function merge(t, p) { for (const k of Object.keys(p)) { const v = p[k]; if (v === null) delete t[k]; else if (v && typeof v === 'object' && !Array.isArray(v) && t[k] && typeof t[k] === 'object' && !Array.isArray(t[k])) merge(t[k], v); else t[k] = clone(v); } return t; }
  s.applied = [];                                       // writes the server accepted, in order: 'PATCH /api/characters/a'
  s.handle = function (user, method, url, body) {
    const r = handle0(user, method, url, body);
    if (Array.isArray(r) && r[0] === 200 && method !== 'GET') s.applied.push(method + ' ' + new URL(url, 'https://app.test').pathname);
    return r;
  };
  function handle0(user, method, url, body) {
    calls.push(method + ' ' + url);
    const u = new URL(url, 'https://app.test');
    const p = u.pathname;
    for (const pre of Object.keys(s.status)) if (p.startsWith(pre)) return { forced: s.status[pre] };
    if (method !== 'GET' && s.conflicts > 0) { s.conflicts--; return [409, { error: 'the character kept changing, try again' }]; }
    if (!user) return [401, { error: 'not signed in' }];
    const me = { id: user.email, email: user.email, name: user.name || '', role: s.roleOf(user.email), campaign: 'default' };
    if (p === '/api/me') {
      const prev = members[me.id] || {};
      if (method === 'PATCH') {   // the display name (functions/api/me.js): the real rules are checks/api/name.mjs
        const n = body && typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim() : '';
        if (/[<>]/.test(n)) return [400, { error: 'name cannot contain < or >' }];
        prev.override = n || null;
      }
      const shown = prev.override || me.name;
      members[me.id] = { id: me.id, name: shown, role: me.role, override: prev.override || null };
      return [200, { ...me, name: shown }];
    }
    if (p === '/api/members') return [200, { members: Object.values(members) }];
    // the GM tools (GM.md), reduced: 403 for anyone but the GM on every /api/gm/* path; the full rules are checks/api/gm.mjs
    if (p.startsWith('/api/gm/')) {
      if (me.role !== 'gm') return [403, { error: 'only the GM can use the GM tools' }];
      const g = s.gm;
      if (p === '/api/gm/pack') {
        const part = u.searchParams.get('part');
        if (method === 'GET' && !part) return [200, { version: 'p' + Object.keys(g.parts).length, parts: Object.fromEntries(Object.entries(g.parts).map(([k, v]) => [k, { version: v.version, src: v.src }])) }];
        if (method === 'GET') return g.parts[part] ? [200, { part, ...clone(g.parts[part]) }] : [404, { error: 'not found' }];
        if (method === 'POST') { g.parts[body.part] = { version: 'v' + JSON.stringify(body.body).length, src: body.src || {}, body: clone(body.body) }; return [200, { ok: true, part: body.part, version: g.parts[body.part].version, packVersion: 'p' + Object.keys(g.parts).length }]; }
        if (method === 'DELETE') { delete g.parts[part]; return [200, { ok: true, part }]; }
      }
      if (p === '/api/gm/state') {
        if (method === 'GET') return [200, { doc: clone(g.state), updatedAt: g.stateAt }];
        if (method === 'PATCH') { merge(g.state, body); g.stateAt = now(); return [200, { doc: clone(g.state), updatedAt: g.stateAt }]; }
      }
      if (p === '/api/gm/display') {
        if (method === 'GET') { const q = u.searchParams.get('seq'); return q !== null && +q === g.seq ? [200, { seq: g.seq, unchanged: true }] : [200, { seq: g.seq, display: clone(g.display) }]; }
        if (method === 'PUT') { g.seq++; g.display = clone(body); return [200, { seq: g.seq, display: clone(g.display) }]; }
      }
      return [404, { error: 'not found' }];
    }
    if (p === '/api/export') {
      if (me.role !== 'gm') return [403, { error: 'only the GM can export' }];
      const live = Object.entries(rows).filter(([, r]) => !r.deleted).map(([id, r]) => ({ id, doc: clone(r.doc), updatedAt: r.updatedAt }));
      return [200, { exportedAt: now(), campaign: { id: 'default', doc: clone(s.campaign || defaultCampaign()), updatedAt: s.campaign ? s.campaign.updatedAt : null }, characters: live, members: Object.values(members) }];
    }
    if (p === '/api/rules' && method === 'GET') {
      const v = u.searchParams.get('v');
      return v && v === s.rulesVersion ? [200, { version: s.rulesVersion, unchanged: true }] : [200, { version: s.rulesVersion, entries: clone(s.rulesRows) }];
    }
    if (p === '/api/rules/import' && method === 'POST') {
      if (me.role !== 'gm') return [403, { error: 'only the GM can change the rules' }];
      s.rulesRows = (body.replace ? [] : s.rulesRows).concat(body.entries.map((e) => ({ book: body.book, ...e }))); s.rulesVersion = 'v' + (++tick);
      return [200, { ok: true, count: s.rulesRows.length, version: s.rulesVersion }];
    }
    const hm = p.match(/^\/api\/rules\/house\/([a-z0-9_-]+)$/);
    if (hm) {
      if (me.role !== 'gm') return [403, { error: 'only the GM can change the rules' }];
      s.rulesRows = s.rulesRows.filter((e) => !(e.book === 'house' && e.slug === hm[1])); s.rulesVersion = 'v' + (++tick);
      if (method === 'PUT') s.rulesRows.push({ book: 'house', slug: hm[1], ...body });
      return [200, method === 'PUT' ? { entry: { book: 'house', slug: hm[1], ...body }, version: s.rulesVersion } : { ok: true, version: s.rulesVersion }];
    }
    if (p === '/api/characters' && method === 'GET') {
      const since = u.searchParams.get('since');
      const list = Object.entries(rows)
        .filter(([, r]) => (since ? r.updatedAt > since : !r.deleted))
        .sort((a, b) => (a[1].updatedAt < b[1].updatedAt ? 1 : -1))
        .map(([id, r]) => ({ id, doc: r.deleted ? null : clone(r.doc), updatedAt: r.updatedAt, deleted: r.deleted }));
      return [200, { now: new Date(tick - 2000).toISOString(), docs: list, campaignUpdatedAt: s.campaign ? s.campaign.updatedAt : null, npcsUpdatedAt: s.npcsAt(), ...(typeof s.live === 'boolean' ? { live: s.live } : {}) }];   // like the real API: 2 s behind, so rows repeat
    }
    if (p === '/api/campaign') {
      // the player rule (functions/_lib/campaign.js playerMayWrite) is the server's own; checks/api/flow.mjs and clocks.mjs
      // check it against the real Worker. A PATCH adds log entries (same at + by + text: skipped; same at + by, other text:
      // 403 for a player), newest `at` first, like mergeLog; `clockOps` and a whole `clocks` array go through the server's
      // own functions (withClockIds, applyClockOps, changedFills), so the adapter's optimistic copy is compared with them.
      if (method === 'GET') return [200, { doc: clone(s.campaign || defaultCampaign()), updatedAt: s.campaign ? s.campaign.updatedAt : null }];
      if (method === 'PUT' && me.role !== 'gm') return [403, { error: 'only the GM can change that' }];
      const base = clone(s.campaign || defaultCampaign());
      if (Array.isArray(base.clocks)) base.clocks = withClockIds(base.clocks);
      let doc = null;
      if (method === 'PUT') doc = clone(body);
      else if (method === 'PATCH') {
        const { log, clockOps, ...rest } = body;
        doc = merge(clone(base), rest);
        if (Array.isArray(rest.clocks)) doc.clocks = withClockIds(doc.clocks);
        if (clockOps !== undefined) {
          try { checkClockOps(clockOps); } catch (e) { return [e.status, { error: e.message }]; }
          doc.clocks = applyClockOps(doc.clocks, clockOps);
        }
        if (me.role !== 'gm' && !playerMayWrite(base, doc, me.id)) return [403, { error: 'only the GM can change that' }];
        if (me.role !== 'gm' && Array.isArray(rest.clocks) && changedFills(base.clocks, rest.clocks) > 1) return [412, { error: STALE_CLOCKS }];
        if (log) {
          const key = (e) => JSON.stringify([e.at, e.by, e.text]), slot = (e) => JSON.stringify([e.at, e.by]);
          const have = new Set(base.log.map(key)), slots = new Set(base.log.map(slot));
          const added = [];
          for (const e of log) {
            if (have.has(key(e))) continue;
            if (slots.has(slot(e))) { if (me.role === 'gm') continue; return [403, { error: 'only the GM can change that' }]; }
            have.add(key(e)); slots.add(slot(e)); added.push(clone(e));
          }
          doc.log = added.concat(clone(base.log)).map((e, i) => [e, i])
            .sort((a, b) => (a[0].at < b[0].at ? 1 : a[0].at > b[0].at ? -1 : a[1] - b[1])).map(([e]) => e);
        }
      }
      if (!doc) return [405, { error: 'method not allowed' }];
      if (Array.isArray(doc.log)) doc.log = doc.log.slice(0, 200);
      if (Array.isArray(doc.clocks)) doc.clocks = withClockIds(doc.clocks);
      doc.updatedAt = now(); s.campaign = doc;
      return [200, { doc: clone(doc), updatedAt: doc.updatedAt }];
    }
    // the cast, as functions/_lib/npcs.js serves it: a player is sent revealed NPCs only, without gmNotes; writes are GM only
    const view = (doc) => { if (me.role === 'gm') return clone(doc); if (doc.revealed !== true) return null; const c = clone(doc); delete c.gmNotes; return c; };
    if (p === '/api/npcs' && method === 'GET') {
      const docs = Object.entries(s.npcs).filter(([, r]) => !r.deleted).map(([id, r]) => ({ id, doc: view(r.doc), updatedAt: r.updatedAt })).filter((d) => d.doc);
      return [200, { now: new Date(tick - 2000).toISOString(), docs, npcsUpdatedAt: s.npcsAt() }];
    }
    const nm = p.match(/^\/api\/npcs\/([A-Za-z0-9_-]{1,80})$/);
    if (nm) {
      const id = nm[1], row = s.npcs[id], live = row && !row.deleted;
      if (method === 'GET') { const d = live ? view(row.doc) : null; return d ? [200, { id, doc: d }] : [404, { error: 'not found' }]; }
      if (me.role !== 'gm') return [403, { error: 'only the GM can change the cast' }];
      if (method === 'DELETE') { if (!live) return [404, { error: 'not found' }]; s.npcs[id] = { updatedAt: now(), deleted: true, doc: {} }; return [200, { ok: true }]; }
      if (method === 'PUT') s.putNpc(id, body);
      else if (method === 'PATCH') { if (!live) return [404, { error: 'not found' }]; s.putNpc(id, merge(clone(row.doc), body)); }
      else return [400, { error: 'bad method' }];
      s.npcs[id].doc.updatedAt = s.npcs[id].updatedAt;
      return [200, { id, doc: clone(s.npcs[id].doc) }];
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
  }
  return s;
}

/* ---------- a fake browser running cf.js ---------- */
/* a localStorage stand-in; pass the same one to two browsers to model a reload. `broken` makes every call throw. */
function memStorage({ broken = false } = {}) {
  const m = new Map();
  const chk = () => { if (broken) throw new Error('SecurityError: storage blocked'); };
  return { getItem: (k) => (chk(), m.has(k) ? m.get(k) : null), setItem: (k, v) => { chk(); m.set(k, String(v)); }, removeItem: (k) => { chk(); m.delete(k); }, get length() { return m.size; }, _m: m };
}
const read = (st, k) => { const v = st._m.get(k); return v == null ? null : JSON.parse(v); };

function browser(server, user, { preset, protocol = 'https:', storage, extra } = {}) {
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
    /* server.hang(method, url) true: a request that never answers (a stalled connection). It settles only when the
       adapter aborts it through opts.signal, with the AbortError a real fetch gives. */
    if (server.hang && server.hang(opts.method || 'GET', url)) {
      return new Promise((_, reject) => {
        const sig = opts.signal; if (!sig) return;
        const abort = () => reject(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' }));
        if (sig.aborted) abort(); else sig.addEventListener('abort', abort);
      });
    }
    await sleep(2);
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    const r = server.handle(user, opts.method || 'GET', url, body);
    /* server.build: the Worker's build stamp, as worker/app.js puts it on every API answer (X-B68-Build) */
    const mk = (status, text, ct, extra = {}) => ({ status, ok: status >= 200 && status < 300, redirected: false, type: 'basic', headers: { get: (h) => (h.toLowerCase() === 'content-type' ? ct : h.toLowerCase() === 'x-b68-build' ? (server.build || null) : null) }, text: async () => text, ...extra });
    if (r.forced === 'down') throw new TypeError('Failed to fetch');
    if (r.forced === 'redirect') return mk(0, '', null, { type: 'opaqueredirect', ok: false });
    if (r.forced === 'html') return mk(200, '<html>Sign in</html>', 'text/html', { redirected: true });
    if (r.forced === '401') return mk(401, '{"error":"not signed in","reason":"wrong audience"}', 'application/json');
    return mk(r[0], JSON.stringify(r[1]), 'application/json; charset=utf-8');
  }
  const winListeners = {};
  const events = [];                                   // every b68:runtime detail, in order
  class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  const win = {
    document, fetch, setTimeout, clearTimeout, console, Blob, AbortController, location: { protocol, pathname: '/', host: 'app.test' },
    URL: { createObjectURL: (b) => { const u = 'blob:' + (++nBlob); blobs[u] = b; return u; }, revokeObjectURL: () => {} },
    CustomEvent,
    addEventListener: (t, fn) => { (winListeners[t] = winListeners[t] || []).push(fn); },
    dispatchEvent: (ev) => { if (ev.type === 'b68:runtime') events.push(clone(ev.detail)); (winListeners[ev.type] || []).forEach((fn) => fn(ev)); return true; },
  };
  if (storage) win.localStorage = storage;
  if (extra) Object.assign(win, extra);
  /* the user can change between page loads (a reload as someone else) */
  const fire = (t) => (winListeners[t] || []).forEach((fn) => fn({ type: t }));
  win.window = win;
  if (preset) win.claude = preset;
  win.__B68_POLL_MS = POLL;
  win.__B68_SNAPSHOT_MS = 20;                          // the snapshot throttle (2 s in the app)
  vm.createContext(win);
  vm.runInContext(SRC, win, { filename: 'cf.js' });
  return { win, fetchLog, clicks, blobs, document, listeners, events, fire, setUser: (u) => { user = u; } };
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

await test('B68Runtime.exportAll: GET /api/export for the GM, refused for a player', async () => {
  const api = fakeApi();
  api.put('a', { name: 'a', owner: 'pl@x.test' }); api.setCampaign({ ...api.defaultCampaign(), crew: { ...api.defaultCampaign().crew, name: 'The Crew' } });
  const b = browser(api, { email: 'gm@x.test' });
  await b.win.claude.use('user');
  const x = await b.win.B68Runtime.exportAll();
  eq([x.campaign.id, x.campaign.doc.crew.name, x.characters.map((c) => c.id), x.characters[0].doc.name], ['default', 'The Crew', ['a'], 'a'], 'export');
  eq(api.calls.filter((c) => c === 'GET /api/export').length, 1, '/api/export calls');
  const pb = browser(api, { email: 'pl@x.test' });
  await pb.win.claude.use('user');
  let err = null; try { await pb.win.B68Runtime.exportAll(); } catch (e) { err = e; }
  eq([err && err.message, err && err.status], ['only the GM can export', 403], 'player refused');
});

await test('window.claude.rules: list (with the cached version), import, house rules; a player is refused the writes', async () => {
  const api = fakeApi();
  const b = browser(api, { email: 'gm@x.test' });
  ok(b.win.claude.rules && ['list', 'import', 'saveHouse', 'deleteHouse'].every((k) => typeof b.win.claude.rules[k] === 'function'), 'rules API');
  const r = await b.win.claude.rules.import({ book: 'bitd', entries: [{ slug: 'a', title: 'A', body: 'placeholder' }], replace: true, part: 1, of: 1 });
  eq([r.ok, r.count], [true, 1]);
  const l = await b.win.claude.rules.list();
  eq([l.entries.length, l.entries[0].book, l.entries[0].slug], [1, 'bitd', 'a']);
  const same = await b.win.claude.rules.list({ version: l.version });
  eq([same.unchanged, same.entries], [true, undefined], 'unchanged while the version matches');
  await b.win.claude.rules.saveHouse('my-rule', { title: 'Mine', body: 'x' });
  eq((await b.win.claude.rules.list()).entries.map((e) => e.slug), ['a', 'my-rule']);
  await b.win.claude.rules.deleteHouse('my-rule');
  eq((await b.win.claude.rules.list()).entries.map((e) => e.slug), ['a']);
  const f = b.fetchLog.map((x) => x.opts.method + ' ' + x.url);
  ok(f.includes('PUT /api/rules/house/my-rule') && f.includes('DELETE /api/rules/house/my-rule') && f.some((x) => x.indexOf('GET /api/rules?v=') === 0), 'requests: ' + f.join(' | '));
  const pb = browser(api, { email: 'pl@x.test' });
  eq((await pb.win.claude.rules.list()).entries.length, 1, 'a player reads');
  let err = null; try { await pb.win.claude.rules.import({ book: 'bitd', entries: [] }); } catch (e) { err = e; }
  eq([err && err.status, err && err.message], [403, 'only the GM can change the rules']);
  const art = browser(api, { email: 'gm@x.test' }, { preset: { use: () => 1 } });
  eq(art.win.claude.rules, undefined, 'the artifact build has no rules API');
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
  const frozen = snaps.length;
  await sleep(POLL * 2);   // a poll already in flight when the last listener left may still land, once; on a busy machine that is after this line
  const polls = api.calls.length;
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

await test('409: a write is retried; when it keeps conflicting it stays queued (resolves) and lands later', async () => {
  const api = fakeApi();
  const b = browser(api, { email: 'gm@x.test' });
  const col = (await b.win.claude.use('db')).collection('characters');
  api.conflicts = 2; await col.doc('k').set(char('k'));
  eq([api.conflicts, !!api.rows.k], [0, true], 'retried twice and landed');
  api.conflicts = 5;
  await col.doc('k').update({ name: 'k2' });            // 3 attempts, then queued: resolves
  eq([api.rows.k.doc.name, b.win.B68Runtime.status.pending, b.win.B68Runtime.status.online], ['k', 1, true], 'queued after the retries');
  await until(() => api.rows.k.doc.name === 'k2', 3000);
  eq([api.rows.k.doc.name, b.win.B68Runtime.status.pending], ['k2', 0], 'landed on a later flush');
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

for (const [kind, why] of [['401', 'wrong audience'], ['redirect', 'Access answered with its sign-in page'], ['html', 'Access answered with its sign-in page']]) {
  await test('signed out at /api/me (' + kind + '): the page is told why (B68Runtime.signedOutWhy)', async () => {
    const api = fakeApi();
    api.status['/api/me'] = kind;
    const b = browser(api, { email: 'gm@x.test' });
    try { await b.win.claude.use('db'); } catch (e) { /* signed out: the point is the reason below */ }
    await until(() => b.win.B68Runtime && b.win.B68Runtime.me === null, POLL * 3);
    eq(b.win.B68Runtime.signedOutWhy, why, 'reason');
  });
}

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
    eq(b.win.B68Runtime.status.pending, 1, 'the write is kept in the queue (E6: sent at this user\'s next visit)');
    un();
  });
}

/* E1: a request that never answers (a connection that is "up" but dead) must not hold the poller or the queue */
await test('a poll that never answers is abandoned after the timeout (network: true, timeout: true); polling goes on and recovers', async () => {
  const api = fakeApi(); api.put('a', char('a'));
  const b = browser(api, { email: 'gm@x.test' });
  b.win.__B68_TIMEOUT_MS = 100;
  let polls = 0, hanging = true;
  // the 2nd poll stalls, and so does every later one until the test releases them (else the 3rd poll could answer, and
  // turn the header back online, before the offline assertion below runs on a busy machine)
  api.hang = (m, url) => m === 'GET' && /^\/api\/characters(\?|$)/.test(url) && ++polls >= 2 && hanging;
  const col = (await b.win.claude.use('db')).collection('characters');
  const snaps = [], errs = [];
  const un = col.onSnapshot((s) => snaps.push(s), (e) => errs.push(e));
  await until(() => snaps.length);
  const stalled = await until(() => b.fetchLog.length >= 3 && polls >= 2, 1000);   // /me, the full load, the hung poll
  ok(stalled, 'the second poll went out');
  const before = b.fetchLog.length;
  // the things that used to be deferred to the request in flight: hidden -> visible, the network coming back, an own write
  b.document.hidden = true; b.listeners.visibilitychange.forEach((fn) => fn()); b.document.hidden = false; b.listeners.visibilitychange.forEach((fn) => fn());
  b.fire('online');
  await sleep(50);
  eq(b.fetchLog.length - before, 0, 'nothing could go out while the stalled request was in flight (so the timeout is the fix)');
  await until(() => errs.length, 1000);
  eq([errs.length, errs[0].network, errs[0].timeout, /no answer from the server in 0 s/.test(errs[0].message)], [1, true, true, true], 'the stall surfaced once as a network error: ' + (errs[0] && errs[0].message));
  eq(b.win.B68Runtime.status.online, false, 'the header says offline while it stalls');
  hanging = false;
  await until(() => b.fetchLog.length > before + 1 && b.win.B68Runtime.status.online, 2000);
  ok(b.fetchLog.length > before + 1, 'polling resumed after the abandoned request (' + (b.fetchLog.length - before) + ' later requests)');
  eq(b.win.B68Runtime.status.online, true, 'back online once a poll answers');
  const p = col.doc('a').update({ name: 'a2' });
  await p;
  eq(api.rows.a.doc.name, 'a2', 'a write after the stall lands');
  un();
});

await test('a write whose request never answers is abandoned after the timeout, kept, retried and lands; the queue is never stuck', async () => {
  const api = fakeApi(); api.put('a', char('a'));
  const b = browser(api, { email: 'gm@x.test' });
  b.win.__B68_TIMEOUT_MS = 100;
  let hung = 0;
  api.hang = (m) => m === 'PATCH' && ++hung === 1;                         // the first PATCH stalls, the retry answers
  const col = (await b.win.claude.use('db')).collection('characters');
  const snaps = []; const un = col.onSnapshot((s) => snaps.push(s));
  await until(() => snaps.length);
  await col.doc('a').update({ name: 'a2' });                                // resolves: queued, not refused
  eq(hung, 1, 'the PATCH went out and stalled');
  await until(() => api.rows.a.doc.name === 'a2', 2000);
  eq([api.rows.a.doc.name, b.win.B68Runtime.status.pending, b.fetchLog.filter((f) => f.opts.method === 'PATCH').length], ['a2', 0, 2], 'retried after the timeout and landed');
  await until(() => b.win.B68Runtime.status.online, 1000);
  eq(b.win.B68Runtime.status.online, true, 'online again');
  un();
});

/* E6: a tap after the session ended is not lost: it waits in this user's queue for the next signed-in visit */
await test('a write after a sign-out is kept in the stored queue (rejected now with the signed-out message) and sent at this user\'s next visit, never by another account', async () => {
  const api = fakeApi(); api.put('a', char('a', { owner: 'pl@x.test' }));
  const st = memStorage();
  const b = browser(api, { email: 'pl@x.test' }, { storage: st });
  const col = (await b.win.claude.use('db')).collection('characters');
  const snaps = [], errs = [];
  col.onSnapshot((s) => snaps.push(s), (e) => errs.push(e));
  await until(() => snaps.length);
  api.status['/api/characters'] = '401';
  await until(() => errs.length, POLL * 3);
  delete api.status['/api/characters'];
  let err = null; try { await col.doc('a').update({ play: { stress: 3 } }); } catch (e) { err = e; }
  eq([err && err.code, err && err.message], ['signed_out', 'signed out: reload the page to sign in again'], 'the tap is told the session ended');
  eq(snaps[snaps.length - 1].docs[0].data().play.stress, 3, 'the sheet shows the tap');
  const PQ = 'b68.cf.pl@x.test#default#queue';
  const q = read(st, PQ);
  eq([q && q.length, q && q[0].method, q && q[0].body], [1, 'PATCH', { play: { stress: 3 } }], 'kept in the stored queue');
  eq(api.rows.a.doc.play.stress, 0, 'nothing was sent');
  // another account on this browser: untouched
  const o = browser(api, { email: 'gm@x.test' }, { storage: st });
  (await o.win.claude.use('db')).collection('characters').onSnapshot(() => {});
  await sleep(POLL * 3);
  eq([api.rows.a.doc.play.stress, read(st, PQ).length], [0, 1], 'the other account neither sends nor drops it');
  // the same user, signed in again (a reload): sent on start
  const b2 = browser(api, { email: 'pl@x.test' }, { storage: st });
  await b2.win.claude.use('db');
  await until(() => api.rows.a.doc.play.stress === 3 && read(st, PQ) === null, 1000);
  eq([api.rows.a.doc.play.stress, read(st, PQ)], [3, null], 'landed at the next visit');
});

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
  ok(timers.includes(60000), 'hidden interval: ' + timers);
  ok(timers.includes(4000), 'visible interval: ' + timers);
  un();
});

/* ---------- campaign/main ---------- */
const campaignDoc = (extra = {}) => ({
  v: 1, session: { number: 2, startedAt: '2026-10-01T19:00:00.000Z', endedAt: null },
  crew: { name: 'Lamplighters', type: 'shadows', lair: '', notes: '', tier: 1, hold: 'strong', rep: 3, turf: 0, heat: 1, wanted: 0, vault: 2, claims: [], cohorts: [], factions: [] },
  clocks: [{ id: 'c_a', name: 'Alarm', size: 4, filled: 1, kind: 'danger', hidden: false }],
  log: [{ at: '2026-10-01T19:00:00.000Z', by: 'gm@x.test', text: 'first' }],
  ...extra,
});
const campaignGets = (api) => api.calls.filter((c) => c === 'GET /api/campaign').length;

await test('campaign: a missing doc snapshots as the default (exists true); other ids and queries are empty', async () => {
  const api = fakeApi();
  const b = browser(api, { email: 'pl@x.test' });
  const db = await b.win.claude.use('db');
  const ref = db.collection('campaign').doc('main');
  eq([ref.id, ref.path], ['main', 'campaign/main']);
  const snaps = [], errs = [];
  const un = ref.onSnapshot((s) => snaps.push(s), (e) => errs.push(e));
  await until(() => snaps.length);
  eq([snaps[0].id, snaps[0].exists, snaps[0].metadata.hasPendingWrites], ['main', true, false]);
  eq(snaps[0].data(), api.defaultCampaign(), 'default doc');
  const d = snaps[0].data(); d.crew.heat = 9; eq(snaps[0].data().crew.heat, 0, 'data() clone');
  const g = await ref.get(); eq([g.exists, g.data()], [true, api.defaultCampaign()], 'get()');
  ok(api.calls.includes('GET /api/characters'), 'the poller runs for a campaign listener alone');
  // other ids and collection queries: empty, no writes
  const other = db.collection('campaign').doc('side');
  eq((await other.get()).exists, false, 'other id get');
  const os = []; other.onSnapshot((s) => os.push(s)); await until(() => os.length); eq([os[0].exists, os[0].data()], [false, undefined]);
  let err = null; try { await other.update({ x: 1 }); } catch (e) { err = e; } ok(err, 'write to another id');
  const qs = await db.collection('campaign').orderBy('updatedAt', 'desc').limit(5).get(); eq([qs.size, qs.empty, qs.docs], [0, true, []]);
  const qsn = []; db.collection('campaign').onSnapshot((s) => qsn.push(s)); await until(() => qsn.length); eq(qsn[0].docs, []);
  eq((await db.doc('campaign/main').get()).exists, true, 'db.doc path');
  // unchanged polls fire nothing and do not refetch the campaign
  const n = snaps.length, gets = campaignGets(api);
  await sleep(POLL * 3);
  eq(snaps.length, n, 'snapshots on unchanged polls'); eq(campaignGets(api), gets, 'campaign refetched without a change');
  un();
  await sleep(POLL * 2);   // a poll already in flight when the last listener left may still land, once
  const polls = api.calls.length; await sleep(POLL * 3); eq(api.calls.length, polls, 'polling after the last unsubscribe');
  eq(errs.length, 0, 'errors');
});

await test('campaign: update merges optimistically, sends a PATCH, then takes the server version', async () => {
  const api = fakeApi();
  api.setCampaign(campaignDoc());
  const b = browser(api, { email: 'pl@x.test' });
  const ref = (await b.win.claude.use('db')).collection('campaign').doc('main');
  const snaps = []; const un = ref.onSnapshot((s) => snaps.push(s));
  await until(() => snaps.length);
  eq(snaps[0].data().crew.name, 'Lamplighters');
  const clocks = snaps[0].data().clocks; clocks[0].filled = 3;
  const entry = { at: '2026-10-10T12:30:00.000Z', by: 'pl@x.test', text: 'heat rises' };
  const p = ref.update({ crew: { heat: 4 }, clocks, log: [entry].concat(snaps[0].data().log) });
  const opt = snaps[snaps.length - 1];
  eq([snaps.length, opt.data().crew.heat, opt.data().crew.name, opt.data().clocks[0].filled, opt.data().log.length, opt.metadata.hasPendingWrites],
    [2, 4, 'Lamplighters', 3, 2, true], 'optimistic snapshot');
  const sent = b.fetchLog.find((f) => f.url === '/api/campaign' && f.opts.method === 'PATCH');
  ok(sent, 'no PATCH sent');
  eq(JSON.parse(sent.opts.body).crew, { heat: 4 }, 'PATCH body');
  await p;
  eq([api.campaign.crew.heat, api.campaign.clocks[0].filled, api.campaign.log[0].text], [4, 3, 'heat rises'], 'server');
  const fin = snaps[snaps.length - 1];
  eq([fin.data().updatedAt, fin.metadata.hasPendingWrites], [api.campaign.updatedAt, false], 'after the server answered');
  // the poll after the write sees the stamp it already holds: no refetch, no extra snapshot
  const n = snaps.length, gets = campaignGets(api);
  await sleep(POLL * 3);
  eq([snaps.length, campaignGets(api)], [n, gets], 'quiet after own write');
  un();
});

await test('campaign: a change made elsewhere arrives within two polls via campaignUpdatedAt', async () => {
  const api = fakeApi();
  const b = browser(api, { email: 'gm@x.test' });
  const ref = (await b.win.claude.use('db')).collection('campaign').doc('main');
  const snaps = []; const un = ref.onSnapshot((s) => snaps.push(s));
  await until(() => snaps.length);
  await sleep(POLL * 2);
  eq(snaps.length, 1, 'no snapshot without a change');
  const t0 = Date.now();
  api.setCampaign(campaignDoc({ session: { number: 5, startedAt: null, endedAt: null } }));
  await until(() => snaps.length > 1, POLL * 2 + 60);
  const took = Date.now() - t0;
  eq(snaps[snaps.length - 1].data().session.number, 5, 'external change');
  ok(took <= POLL * 2 + 60, 'external change took ' + took + 'ms');
  eq(snaps.length, 2, 'one snapshot per change');
  // a character listener alongside does not hear campaign changes, and vice versa
  const cs = []; const cun = (await b.win.claude.use('db')).collection('characters').onSnapshot((s) => cs.push(s));
  await until(() => cs.length);
  api.setCampaign(campaignDoc({ crew: { ...campaignDoc().crew, heat: 7 } }));
  await until(() => snaps.length > 2, POLL * 2 + 60);
  eq(cs.length, 1, 'characters listener notified by a campaign change');
  api.put('zz', char('zz'));
  await until(() => cs.length > 1, POLL * 2 + 60);
  eq(snaps.length, 3, 'campaign listener notified by a character change');
  un(); cun();
});

await test('campaign: two players append to the log from the same stale copy: both entries land, no flicker', async () => {
  const api = fakeApi();
  api.setCampaign(campaignDoc());
  const pa = browser(api, { email: 'pa@x.test' }), pb = browser(api, { email: 'pb@x.test' });
  const refA = (await pa.win.claude.use('db')).collection('campaign').doc('main');
  const refB = (await pb.win.claude.use('db')).collection('campaign').doc('main');
  const sa = [], sb = [];
  const ua = refA.onSnapshot((s) => sa.push(s.data())), ub = refB.onSnapshot((s) => sb.push(s.data()));
  await until(() => sa.length && sb.length);
  const base = sa[0].log;
  const ea = { at: '2026-10-10T12:30:00.000Z', by: 'pa@x.test', text: 'A' };
  const eb = { at: '2026-10-10T12:30:01.000Z', by: 'pb@x.test', text: 'B' };
  await Promise.all([refA.update({ log: [ea].concat(base) }), refB.update({ log: [eb].concat(base) })]);
  eq(api.campaign.log.map((e) => e.text), ['B', 'A', 'first'], 'server log');
  const texts = (snaps) => snaps[snaps.length - 1].log.map((e) => e.text);
  await until(() => texts(sa).length === 3 && texts(sb).length === 3, POLL * 3);
  eq([texts(sa), texts(sb)], [['B', 'A', 'first'], ['B', 'A', 'first']], 'both views');
  ok(sa.slice(1).every((d) => d.log.some((e) => e.text === 'A')), 'A\'s entry vanished from A\'s view at some point');
  // a resent entry is not duplicated, optimistically or on the server
  const n = sa.length;
  const p = refA.update({ log: [ea] });
  eq(sa[sa.length - 1].log.length, 3, 'optimistic duplicate');
  await p;
  eq(api.campaign.log.length, 3, 'server duplicate');
  ok(sa.length - n <= 2, 'snapshots for a no-op append: ' + (sa.length - n));
  ua(); ub();
});

await test('campaign: a rejected write (player PUT, 403) rejects with the API message and rolls back', async () => {
  const api = fakeApi();
  api.setCampaign(campaignDoc());
  const b = browser(api, { email: 'pl@x.test' });
  const ref = (await b.win.claude.use('db')).collection('campaign').doc('main');
  const snaps = []; const un = ref.onSnapshot((s) => snaps.push(s));
  await until(() => snaps.length);
  let err = null;
  try { await ref.set(campaignDoc({ crew: { name: 'Hijacked' } })); } catch (e) { err = e; }
  eq(err && [err.message, err.status], ['only the GM can change that', 403]);
  eq(api.campaign.crew.name, 'Lamplighters', 'server unchanged');
  await until(() => snaps[snaps.length - 1].data().crew.name === 'Lamplighters', POLL * 3);
  eq(snaps[snaps.length - 1].data().crew.name, 'Lamplighters', 'rolled back');
  un();
});

/* ---------- campaign clocks: clockOps (CAMPAIGN.md, *Clocks*) ---------- */
const threeClocks = () => [
  { id: 'c_a', name: 'Alarm', size: 4, filled: 1, kind: 'danger', hidden: false },
  { id: 'c_b', name: 'Fence', size: 6, filled: 0, kind: 'project', hidden: false },
  { id: 'c_c', name: 'Doomed', size: 8, filled: 2, kind: 'faction', hidden: true },
];
const fills = (doc) => doc.clocks.map((c) => c.filled);

await test('campaign clocks: the ref takes clockOps; ticks of different clocks from two phones both land, also while the GM renames, adds and removes; on one clock the later tick wins', async () => {
  const api = fakeApi();
  api.setCampaign(campaignDoc({ clocks: threeClocks() }));
  const bs = [browser(api, { email: 'pa@x.test' }), browser(api, { email: 'pb@x.test' }), browser(api, { email: 'gm@x.test' })];
  const refs = await Promise.all(bs.map(async (b) => (await b.win.claude.use('db')).collection('campaign').doc('main')));
  eq(refs.map((r) => r.clockOps), [true, true, true], 'the hosted ref says its update() takes clockOps');
  const views = refs.map(() => []);
  const uns = refs.map((r, i) => r.onSnapshot((s) => views[i].push(s.data())));
  await until(() => views.every((v) => v.length));
  const last = (i) => views[i][views[i].length - 1];
  // (a) two players tick different clocks from the same copy at once: each sees its own tick at once, the server both
  const pa = refs[0].update({ clockOps: [{ id: 'c_a', filled: 2 }] }), pb = refs[1].update({ clockOps: [{ id: 'c_b', filled: 3 }] });
  eq([fills(last(0)), fills(last(1))], [[2, 0, 2], [1, 3, 2]], 'optimistic: each phone its own tick');
  await Promise.all([pa, pb]);
  eq(fills(api.campaign), [2, 3, 2], 'server: both ticks');
  // (b, c) a player ticks while the GM renames, resizes and hides one clock, removes another and adds one
  await Promise.all([
    refs[0].update({ clockOps: [{ id: 'c_b', filled: 4 }] }),
    refs[2].update({ clockOps: [{ id: 'c_a', name: 'Alarm bells', size: 6, hidden: true }, { remove: 'c_c' }, { add: { id: 'c_new', name: 'New', size: 4, filled: 0, kind: 'other', hidden: false } }] }),
  ]);
  eq(api.campaign.clocks.map((c) => [c.id, c.name, c.size, c.filled, c.hidden]), [['c_a', 'Alarm bells', 6, 2, true], ['c_b', 'Fence', 6, 4, false], ['c_new', 'New', 4, 0, false]], 'server: the GM\'s changes and the tick');
  // a tick of the clock the GM removed brings nothing back
  await refs[1].update({ clockOps: [{ id: 'c_c', filled: 5 }] });
  eq(api.campaign.clocks.map((c) => c.id), ['c_a', 'c_b', 'c_new'], 'a removed clock stays removed');
  // (d) the same clock from two phones: the tick the server gets last wins on that clock, nothing else moves
  await refs[0].update({ clockOps: [{ id: 'c_b', filled: 5 }] });
  await refs[1].update({ clockOps: [{ id: 'c_b', filled: 1 }] });
  eq(fills(api.campaign), [2, 1, 0], 'last writer wins on c_b');
  await until(() => views.every((v, i) => JSON.stringify(last(i).clocks) === JSON.stringify(api.campaign.clocks)), POLL * 6);
  views.forEach((v, i) => eq(last(i).clocks, api.campaign.clocks, 'view ' + i + ' converged'));
  // a player's op may only fill: a rename is refused (403, the server's rule) and rolled back
  let err = null; try { await refs[1].update({ clockOps: [{ id: 'c_b', name: 'Mine now' }] }); } catch (e) { err = e; }
  eq(err && [err.status, err.message], [403, 'only the GM can change that'], 'a player renaming');
  await until(() => last(1).clocks[1].name === 'Fence', POLL * 4);
  eq([last(1).clocks[1].name, api.campaign.clocks[1].name], ['Fence', 'Fence'], 'rolled back');
  uns.forEach((u) => u());
});

await test('campaign clocks: the optimistic copy applies clockOps as the server does (random ops on id-less, repeated and odd clocks)', async () => {
  const api = fakeApi();
  let seed = 20261016;
  const rnd = (n) => {   /* mulberry32: the same sequence every run */
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) % n;
  };
  const pick = (a) => a[rnd(a.length)];
  const some = (o) => Object.fromEntries(Object.entries(o).filter(() => rnd(2)));
  const oddClock = () => {
    const c = {}, id = pick(['c_0', 'c_1', 'x', 'x', undefined, 5, '', 'constructor', '__proto__', 'c_2_']);
    if (id !== undefined) c.id = id;
    if (rnd(5)) c.name = pick(['Alarm', '', 'Doom']);
    const size = pick([4, 6, 8, 10, 12, 5, '8', undefined, 0, 13]); if (size !== undefined) c.size = size;
    const filled = pick([0, 1, 3, 9, -2, '2', undefined, 2.6]); if (filled !== undefined) c.filled = filled;
    if (rnd(3)) c.kind = pick(CLOCK_KINDS.concat(['weird']));
    if (rnd(3)) c.hidden = rnd(2) === 0;
    return c;
  };
  const randomOp = (ids) => {
    const id = rnd(6) ? pick(ids.length ? ids : ['gone']) : 'gone';
    switch (rnd(5)) {
      case 0: case 1: return { id, filled: pick([0, 1, 2, 5, 7, 12, 30, -1, 2.4]) };
      case 2: {
        const f = pick([() => ({ size: pick([4, 4, 6]) }), () => ({ size: pick(CLOCK_SIZES), filled: rnd(14) }), () => ({ name: pick(['Renamed', '']) }), () => ({ kind: pick(CLOCK_KINDS), hidden: rnd(2) === 0 }),
          () => some({ name: 'Both', size: pick(CLOCK_SIZES), kind: pick(CLOCK_KINDS), hidden: rnd(2) === 0, filled: rnd(9) })])();
        return Object.keys(f).length ? { id, ...f } : { id, size: 4 };
      }
      case 3: return { add: { id: pick(['n1', 'n2', 'x', 'c_0', '5', 'constructor', '__proto__']), ...some({ name: 'New', size: pick(CLOCK_SIZES), filled: pick([0, 3, 20]), kind: pick(CLOCK_KINDS), hidden: true }) } };
      default: return { remove: id };
    }
  };
  const b = browser(api, { email: 'gm@x.test' });
  const ref = (await b.win.claude.use('db')).collection('campaign').doc('main');
  const views = []; const un = ref.onSnapshot((s) => views.push(s.data()));
  await until(() => views.length);
  let ops = 0;
  for (let round = 0; round < 25; round++) {
    api.setCampaign(campaignDoc({ clocks: Array.from({ length: rnd(6) }, () => (rnd(10) ? oddClock() : pick([null, 3, 'x']))) }));
    const want = JSON.stringify(api.campaign.clocks);
    await until(() => JSON.stringify(views[views.length - 1].clocks) === want, POLL * 6);
    eq(views[views.length - 1].clocks, api.campaign.clocks, 'round ' + round + ': the stored clocks, as stored');
    for (let k = 0; k < 4; k++) {
      const ids = withClockIds(clone(views[views.length - 1].clocks)).map((c) => c.id);   // clone: into this realm (isPlainObject)
      const list = Array.from({ length: 1 + rnd(3) }, () => randomOp(ids));
      const p = ref.update({ clockOps: list });
      const optimistic = clone(views[views.length - 1].clocks);
      await p;
      ops += list.length;
      eq(optimistic, api.campaign.clocks, 'round ' + round + ', write ' + k + ' ' + JSON.stringify(list));
    }
  }
  ok(ops > 150, 'ops ' + ops);
  un();
});

/* ---------- offline: snapshot, offline start, write queue, status ---------- */
const SNAP = 'b68.cf.gm@x.test#default', QUEUE = SNAP + '#queue';
const PSNAP = 'b68.cf.pl@x.test#default', PQUEUE = PSNAP + '#queue';
/* load a page for `who` with listeners on the characters and the campaign, so the snapshot holds both */
async function warm(api, storage, who = 'gm@x.test') {
  const b = browser(api, { email: who, name: who.split('@')[0] }, { storage });
  const db = await b.win.claude.use('db');
  const cs = [], ks = [];
  const un1 = db.collection('characters').onSnapshot((s) => cs.push(s)), un2 = db.collection('campaign').doc('main').onSnapshot((s) => ks.push(s));
  await (await b.win.claude.use('user')).profiles([who]);
  await until(() => cs.length && ks.length);
  await sleep(30);
  return { b, db, cs, ks, close() { un1(); un2(); } };
}
/* start a second page on the same storage with the network down */
async function offlinePage(api, storage, who = 'gm@x.test') {
  api.status['/api/'] = 'down';
  const b = browser(api, { email: who }, { storage });
  const u = await b.win.claude.use('user');
  const db = await b.win.claude.use('db');
  return { b, u, db };
}
const ids = (s) => s.docs.map((d) => d.id);

await test('snapshot: written after the first load (me, characters, campaign, members) and remembered as the last user', async () => {
  const api = fakeApi();
  api.put('a', char('a', { owner: 'gm@x.test' })); api.setCampaign(campaignDoc());
  const st = memStorage();
  const w = await warm(api, st);
  const snap = read(st, SNAP);
  ok(snap, 'no snapshot under ' + SNAP + ': ' + [...st._m.keys()]);
  eq([snap.me.id, snap.me.role, Object.keys(snap.docs), snap.stamps.a, snap.campaign.doc.crew.name, snap.campaign.updatedAt, Object.keys(snap.members)],
    ['gm@x.test', 'gm', ['a'], api.rows.a.updatedAt, 'Lamplighters', api.campaign.updatedAt, ['gm@x.test']], 'snapshot');
  ok(snap.syncedAt, 'syncedAt');
  eq(read(st, 'b68.cf.last'), { key: SNAP, id: 'gm@x.test' }, 'last user');
  eq(read(st, QUEUE), null, 'no queue');
  // throttled: a burst of changes does not write on every poll
  w.b.win.__B68_SNAPSHOT_MS = 2000; await sleep(30);
  let sets = 0; const real = st.setItem; st.setItem = (k, v) => { if (k === SNAP) sets++; real(k, v); };
  api.put('b', char('b')); await sleep(POLL * 4);
  ok(sets <= 1, 'snapshot writes within the throttle window: ' + sets);
  w.close();
});

await test('storage that throws everywhere: the page still works online, no offline start', async () => {
  const api = fakeApi(); api.put('a', char('a'));
  const st = memStorage({ broken: true });
  const w = await warm(api, st);
  await w.db.collection('characters').doc('a').update({ name: 'a2' });
  eq(api.rows.a.doc.name, 'a2'); w.close();
  api.status['/api/'] = 'down';
  const b = browser(api, { email: 'gm@x.test' }, { storage: st });
  eq(await b.win.claude.use('user'), null, 'user without a readable snapshot');
});

await test('offline start: user, db, listeners and profiles from the snapshot; reconnect does a full load and notifies', async () => {
  const api = fakeApi();
  api.put('a', char('a', { owner: 'gm@x.test' })); api.put('b', char('b')); api.setCampaign(campaignDoc());
  const st = memStorage();
  const w = await warm(api, st); w.close();
  const { b, u, db } = await offlinePage(api, st);
  ok(u, 'user null offline'); ok(db, 'db null offline');
  eq([await u.id(), await u.isOwner(), b.win.B68Runtime.me.id], ['gm@x.test', true, 'gm@x.test']);
  eq(await u.profiles(['gm@x.test']), { 'gm@x.test': { id: 'gm@x.test', name: 'gm' } }, 'profiles from the snapshot');
  eq([b.win.B68Runtime.status.online, b.win.B68Runtime.status.pending, b.win.B68Runtime.status.lastSync], [false, 0, read(st, SNAP).syncedAt], 'status offline');
  const cs = [], ds = [], ks = [], errs = [];
  db.collection('characters').orderBy('updatedAt', 'desc').onSnapshot((s) => cs.push(s), (e) => errs.push(e));
  db.collection('characters').doc('a').onSnapshot((s) => ds.push(s));
  db.collection('campaign').doc('main').onSnapshot((s) => ks.push(s));
  await until(() => cs.length && ds.length && ks.length, 500);
  eq([ids(cs[0]), ds[0].data().name, ds[0].metadata.fromCache, ks[0].data().crew.name], [['b', 'a'], 'a', true, 'Lamplighters'], 'served from the snapshot');
  eq((await db.collection('characters').doc('b').get()).data().name, 'b', 'doc get offline');
  eq((await db.collection('campaign').doc('main').get()).data().crew.name, 'Lamplighters', 'campaign get offline');
  await sleep(POLL * 3);
  eq(errs.length, 0, 'an offline start is not an error');
  // meanwhile on the server
  api.put('c', char('c')); api.setCampaign(campaignDoc({ crew: { ...campaignDoc().crew, heat: 6 } }));
  const n = cs.length;
  delete api.status['/api/'];
  await until(() => cs.length > n && ks[ks.length - 1].data().crew.heat === 6, POLL * 4);
  eq([ids(cs[cs.length - 1]), ks[ks.length - 1].data().crew.heat, b.win.B68Runtime.status.online], [['c', 'b', 'a'], 6, true], 'after reconnect');
  ok(b.win.B68Runtime.status.lastSync > read(st, SNAP).savedAt.slice(0, 0), 'lastSync');
  eq(api.calls.filter((c) => c === 'GET /api/characters').length >= 2, true, 'a full load after reconnect');
});

for (const kind of ['401', 'redirect', 'html']) {
  await test('no offline start when /api/me says signed out (' + kind + '), even with a snapshot', async () => {
    const api = fakeApi(); api.put('a', char('a'));
    const st = memStorage();
    (await warm(api, st)).close();
    api.status['/api/me'] = kind;
    const b = browser(api, { email: 'gm@x.test' }, { storage: st });
    eq([await b.win.claude.use('user'), await b.win.claude.use('db')], [null, null]);
  });
}

await test('no offline start without a snapshot for the last user', async () => {
  const api = fakeApi();
  const st = memStorage();
  st.setItem('b68.cf.last', JSON.stringify({ key: SNAP, id: 'gm@x.test' }));
  api.status['/api/'] = 'down';
  const b = browser(api, { email: 'gm@x.test' }, { storage: st });
  eq(await b.win.claude.use('user'), null);
});

await test('offline writes: optimistic, queued in order (with pending flags), flushed in order on reconnect; safe patches fold', async () => {
  const api = fakeApi();
  api.put('a', char('a', { owner: 'gm@x.test' })); api.put('b', char('b')); api.setCampaign(campaignDoc());
  const st = memStorage();
  (await warm(api, st)).close();
  const { b, db } = await offlinePage(api, st);
  const col = db.collection('characters'), camp = db.collection('campaign').doc('main');
  const da = [], ks = [];
  col.doc('a').onSnapshot((s) => da.push(s)); camp.onSnapshot((s) => ks.push(s));
  await until(() => da.length && ks.length);
  // each resolves at once (queued), the cache shows it, hasPendingWrites is true
  await col.doc('a').update({ play: { stress: 2 } });
  await col.doc('a').update({ play: { stress: 3, harm: { l1: 'cut' } } });      // folds into the one before
  await col.doc('b').update({ play: { harm: { l1: null } } });                   // a different doc
  await col.doc('b').update({ play: { harm: { l2: null } } });                   // null below the top: not folded
  await col.doc('n').set(char('n'));
  await camp.update({ crew: { heat: 3 }, log: [{ at: '2026-10-10T13:00:00.000Z', by: 'gm@x.test', text: 'one' }] });
  await camp.update({ log: [{ at: '2026-10-10T13:01:00.000Z', by: 'gm@x.test', text: 'two' }] });   // GM: folds, logs concatenate
  await col.doc('b').delete();
  const last = da[da.length - 1];
  eq([last.data().play.stress, last.data().play.harm.l1, last.metadata.hasPendingWrites], [3, 'cut', true], 'optimistic a');
  eq([ks[ks.length - 1].data().crew.heat, ks[ks.length - 1].data().log.map((e) => e.text), ks[ks.length - 1].metadata.hasPendingWrites], [3, ['two', 'one', 'first'], true], 'optimistic campaign');
  const q = read(st, QUEUE);
  eq(q.map((x) => x.method + ' ' + x.path), ['PATCH /characters/a', 'PATCH /characters/b', 'PATCH /characters/b', 'PUT /characters/n', 'PATCH /campaign', 'DELETE /characters/b'], 'stored queue');
  eq(q[0].body, { play: { stress: 3, harm: { l1: 'cut' } } }, 'folded character patch');
  eq(q[4].body.log.map((e) => e.text), ['one', 'two'], 'folded campaign log');
  eq([b.win.B68Runtime.status.pending, b.win.B68Runtime.status.online], [6, false], 'status while offline');
  eq(api.applied, [], 'nothing reached the server');
  // a reload while still offline: the queue and the optimistic state survive
  const again = await offlinePage(api, st);
  const ra = []; again.db.collection('characters').doc('a').onSnapshot((s) => ra.push(s));
  await until(() => ra.length);
  eq([ra[0].data().play.stress, ra[0].metadata.hasPendingWrites, again.b.win.B68Runtime.status.pending], [3, true, 6], 'after an offline reload');
  // network back: the first page flushes in order
  delete api.status['/api/'];
  await until(() => b.win.B68Runtime.status.pending === 0 && again.b.win.B68Runtime.status.pending === 0, 3000);
  const want = ['PATCH /api/characters/a', 'PATCH /api/characters/b', 'PATCH /api/characters/b', 'PUT /api/characters/n', 'PATCH /api/campaign', 'DELETE /api/characters/b'];
  eq(api.applied.slice(0, 6), want, 'applied in order');
  eq([api.rows.a.doc.play.stress, api.rows.a.doc.play.harm.l1, !!api.rows.n && !api.rows.n.deleted, api.rows.b.deleted, api.campaign.crew.heat, api.campaign.log.map((e) => e.text)],
    [3, 'cut', true, true, 3, ['two', 'one', 'first']], 'server state');
  await until(() => !da[da.length - 1].metadata.hasPendingWrites, POLL * 4);
  eq(da[da.length - 1].metadata.hasPendingWrites, false, 'pending cleared');
  eq(read(st, QUEUE), null, 'queue emptied');
});

await test('offline clock ticks: a player\'s fills fold into one write (the last per clock), a fill beside another change does not; they land on top of another phone\'s tick', async () => {
  const api = fakeApi();
  api.setCampaign(campaignDoc({ clocks: threeClocks() }));
  const st = memStorage();
  (await warm(api, st, 'pl@x.test')).close();
  const { b, db } = await offlinePage(api, st, 'pl@x.test');
  const camp = db.collection('campaign').doc('main');
  const ks = []; camp.onSnapshot((s) => ks.push(s.data()));
  await until(() => ks.length);
  const fill = (id, n) => camp.update({ clockOps: [{ id, filled: n }], updatedAt: '2026-10-16T20:00:0' + n + '.000Z' });
  await fill('c_a', 2); await fill('c_a', 3); await fill('c_b', 1); await fill('c_a', 4);
  let q = read(st, PQUEUE);
  eq(q.map((x) => x.body), [{ clockOps: [{ id: 'c_b', filled: 1 }, { id: 'c_a', filled: 4 }], updatedAt: '2026-10-16T20:00:04.000Z' }], 'four ticks, one queued write: the last fill of each clock');
  eq(fills(ks[ks.length - 1]), [4, 1, 2], 'optimistic');
  await camp.update({ clockOps: [{ id: 'c_b', filled: 2 }], crew: { heat: 2 } });   // a fill beside a crew change: its own write
  await fill('c_b', 3);                                                             // and the next fill does not fold into that one
  q = read(st, PQUEUE);
  eq(q.map((x) => Object.keys(x.body).sort().join()), ['clockOps,updatedAt', 'clockOps,crew', 'clockOps,updatedAt'], 'a player\'s fill folds only into fills');
  // meanwhile another phone ticks the hidden clock on the server
  const other = clone(api.campaign); other.clocks[2].filled = 5; api.setCampaign(other);
  delete api.status['/api/'];
  await until(() => b.win.B68Runtime.status.pending === 0, 3000);
  eq([fills(api.campaign), api.campaign.crew.heat], [[4, 3, 5], 2], 'server: every tick of this phone, and the other phone\'s kept');
  await until(() => JSON.stringify(ks[ks.length - 1].clocks) === JSON.stringify(api.campaign.clocks), POLL * 6);
  eq(fills(ks[ks.length - 1]), [4, 3, 5], 'this phone sees all of them');
});

await test('offline, the GM: clockOps concatenate in order; a whole clocks array after them is not folded; all land as made', async () => {
  const api = fakeApi();
  api.setCampaign(campaignDoc({ clocks: threeClocks() }));
  const st = memStorage();
  (await warm(api, st)).close();
  const { b, db } = await offlinePage(api, st);
  const camp = db.collection('campaign').doc('main');
  const ks = []; camp.onSnapshot((s) => ks.push(s.data()));
  await until(() => ks.length);
  await camp.update({ clockOps: [{ id: 'c_a', name: 'Alarm bells' }] });
  await camp.update({ clockOps: [{ id: 'c_a', size: 8 }, { remove: 'c_c' }] });
  await camp.update({ clockOps: [{ add: { id: 'c_n', name: 'New', size: 4, filled: 0, kind: 'other', hidden: false } }, { id: 'c_a', filled: 6 }] });
  const whole = clone(ks[ks.length - 1].clocks); whole[1].filled = 5;
  await camp.update({ clocks: whole });                                             // the previous release's whole array
  const q = read(st, QUEUE);
  eq(q.length, 2, 'ops folded, the array apart: ' + JSON.stringify(q.map((x) => x.body)));
  eq(q[0].body.clockOps.length, 5, 'the ops, concatenated');
  eq(ks[ks.length - 1].clocks.map((c) => [c.id, c.name, c.size, c.filled]), [['c_a', 'Alarm bells', 8, 6], ['c_b', 'Fence', 6, 5], ['c_n', 'New', 4, 0]], 'optimistic');
  delete api.status['/api/'];
  await until(() => b.win.B68Runtime.status.pending === 0, 3000);
  eq(api.campaign.clocks.map((c) => [c.id, c.name, c.size, c.filled]), [['c_a', 'Alarm bells', 8, 6], ['c_b', 'Fence', 6, 5], ['c_n', 'New', 4, 0]], 'server');
});

await test('a whole clocks array the previous release queued still goes out: a current one lands; one copied before another phone\'s tick is refused (412) and dropped, the table reloads, that tick stays', async () => {
  const api = fakeApi();
  api.setCampaign(campaignDoc({ clocks: threeClocks() }));
  const st = memStorage();
  (await warm(api, st, 'pl@x.test')).close();
  const old = (clocks, qid) => ({ qid, kind: 'campaign', method: 'PATCH', path: '/campaign', body: { clocks, updatedAt: '2026-10-16T19:00:00.000Z' } });
  const t1 = clone(api.campaign.clocks); t1[0].filled = 2;                          // as stored, with one tick
  st.setItem(PQUEUE, JSON.stringify([old(t1, 'prev.1')]));
  let p = await offlinePage(api, st, 'pl@x.test');
  let errs = []; const un1 = p.db.collection('campaign').doc('main').onSnapshot(() => {}, (e) => errs.push(e));
  delete api.status['/api/'];
  await until(() => p.b.win.B68Runtime.status.pending === 0, 3000);
  eq([fills(api.campaign), errs.length], [[2, 0, 2], 0], 'a current array lands');
  un1();
  // a stale one: copied before another phone ticked c_b (its own tick on c_a, c_b as it was)
  const other = clone(api.campaign); other.clocks[1].filled = 3; api.setCampaign(other);
  const t2 = clone(t1); t2[0].filled = 3;
  st.setItem(PQUEUE, JSON.stringify([old(t2, 'prev.2')]));
  p = await offlinePage(api, st, 'pl@x.test');
  const ks = []; errs = [];
  p.db.collection('campaign').doc('main').onSnapshot((s) => ks.push(s.data()), (e) => errs.push(e));
  await until(() => ks.length);
  delete api.status['/api/'];
  await until(() => errs.length && p.b.win.B68Runtime.status.pending === 0, 3000);
  eq(fills(api.campaign), [2, 3, 2], 'refused: the other phone\'s tick stays');
  eq([errs.length, errs[0].status, errs[0].code, errs[0].message], [1, 412, 'dropped', 'a change saved while offline was not accepted: ' + STALE_CLOCKS], 'reported once');
  await until(() => JSON.stringify(fills(ks[ks.length - 1])) === '[2,3,2]', POLL * 6);
  eq(fills(ks[ks.length - 1]), [2, 3, 2], 'the table reloaded');
  eq(read(st, PQUEUE), null, 'queue empty');
});

await test('online, the network drops mid-session: writes queue (resolve) and flush on the next successful poll and on `online`', async () => {
  const api = fakeApi(); api.put('a', char('a'));
  const st = memStorage();
  const w = await warm(api, st);
  const errs = []; const un = w.db.collection('characters').onSnapshot(() => {}, (e) => errs.push(e));
  api.status['/api/'] = 'down';
  await w.db.collection('characters').doc('a').update({ name: 'a2' });
  eq([w.b.win.B68Runtime.status.pending, w.b.win.B68Runtime.status.online], [1, false], 'queued');
  await sleep(POLL * 3);
  eq(errs.length, 1, 'the outage surfaced once');
  w.b.win.__B68_POLL_MS = 100000;                     // only the `online` event can bring it back now
  delete api.status['/api/'];
  w.b.fire('online');
  await until(() => api.rows.a.doc.name === 'a2', 500);
  eq([api.rows.a.doc.name, w.b.win.B68Runtime.status.pending, w.b.win.B68Runtime.status.online], ['a2', 0, true], 'flushed on online');
  un(); w.close();
});

await test('a queued write refused while flushing (403) is dropped, the doc is resynced, one error is reported, the rest go on', async () => {
  const api = fakeApi();
  api.put('gmc', char('gmc', { owner: 'gm@x.test' })); api.put('mine', char('mine', { owner: 'pl@x.test' }));
  const st = memStorage();
  (await warm(api, st, 'pl@x.test')).close();
  const { b, db } = await offlinePage(api, st, 'pl@x.test');
  const col = db.collection('characters');
  const qs = [], errs = [];
  col.onSnapshot((s) => qs.push(s), (e) => errs.push(e));
  await until(() => qs.length);
  await col.doc('gmc').update({ name: 'hijacked' });
  await col.doc('mine').update({ name: 'mine2' });
  const name = (s, id) => s.docs.find((d) => d.id === id).data().name;
  eq(name(qs[qs.length - 1], 'gmc'), 'hijacked', 'optimistic');
  delete api.status['/api/'];
  await until(() => b.win.B68Runtime.status.pending === 0 && api.rows.mine.doc.name === 'mine2', 2000);
  await until(() => name(qs[qs.length - 1], 'gmc') === 'gmc', POLL * 4);
  eq([api.rows.gmc.doc.name, api.rows.mine.doc.name, name(qs[qs.length - 1], 'gmc')], ['gmc', 'mine2', 'gmc'], 'dropped, resynced, the next one landed');
  eq(errs.length, 1, 'one error');
  eq([errs[0].status, errs[0].code, /not your character/.test(errs[0].message)], [403, 'dropped', true], 'the error');
  eq(read(st, PQUEUE), null, 'queue empty');
});

await test('401 while flushing: stops, keeps the queue for that user; the next start (signed in) flushes it', async () => {
  const api = fakeApi(); api.put('a', char('a'));
  const st = memStorage();
  (await warm(api, st)).close();
  const { b, db } = await offlinePage(api, st);
  const errs = []; db.collection('characters').onSnapshot(() => {}, (e) => errs.push(e));
  await db.collection('characters').doc('a').update({ name: 'a2' });
  await db.collection('characters').doc('a').update({ sheet: { name: 'A2' } });
  eq(read(st, QUEUE).length, 1, 'folded into one');
  await db.collection('characters').doc('a').update({ sheet: { look: null } });      // a delete below the top: not folded
  eq(read(st, QUEUE).length, 2, 'queued');
  delete api.status['/api/'];
  api.status['/api/characters/'] = '401';          // /api/me answers, the write is refused as signed out
  await until(() => errs.length, 1000);
  await sleep(POLL * 3);
  eq([errs.length, errs[0].message], [1, 'signed out: reload the page to sign in again'], 'err once');
  eq(read(st, QUEUE).length, 2, 'queue kept');
  eq(api.rows.a.doc.name, 'a', 'server unchanged');
  let err = null; try { await db.collection('characters').doc('a').update({ name: 'later' }); } catch (e) { err = e; }
  eq(err && err.code, 'signed_out', 'a write after the sign-out is told so');
  eq(read(st, QUEUE).length, 2, 'and kept (E6): folded into the last unsent entry of this tab');
  // signed in again: a fresh page flushes on start, the write made after the sign-out included
  delete api.status['/api/characters/'];
  const b2 = browser(api, { email: 'gm@x.test' }, { storage: st });
  await b2.win.claude.use('db');
  await until(() => api.rows.a.doc.name === 'later' && read(st, QUEUE) === null, 1000);
  eq([api.rows.a.doc.name, api.rows.a.doc.sheet.name, api.applied], ['later', 'A2', ['PATCH /api/characters/a', 'PATCH /api/characters/a']], 'flushed on start');
});

await test('a queue belongs to its user: another account on the same browser neither sends nor sees it', async () => {
  const api = fakeApi(); api.put('a', char('a'));
  const st = memStorage();
  (await warm(api, st)).close();
  const { b, db } = await offlinePage(api, st);
  b.win.__B68_POLL_MS = 100000;                       // the GM page stays offline-quiet from here
  await db.collection('characters').doc('a').update({ name: 'gm-offline' });
  delete api.status['/api/'];
  const p = browser(api, { email: 'pl@x.test' }, { storage: st });
  const pdb = await p.win.claude.use('db');
  pdb.collection('characters').onSnapshot(() => {});
  await sleep(POLL * 4);
  eq([p.win.B68Runtime.status.pending, read(st, QUEUE).length, api.rows.a.doc.name, api.applied], [0, 1, 'a', []], 'untouched');
});

await test('two tabs of one user with the same stored queue: each write is sent once, in order', async () => {
  const api = fakeApi(); api.put('a', char('a', { play: { stress: 0 } }));
  const st = memStorage();
  (await warm(api, st)).close();
  const t1 = await offlinePage(api, st);
  await t1.db.collection('characters').doc('a').update({ play: { stress: 1 } });
  await t1.db.collection('characters').doc('b').set(char('b'));
  const t2 = await offlinePage(api, st);              // opened later: loads the same queue
  await t2.db.collection('characters').doc('a').update({ play: { stress: 2 } });
  eq(read(st, QUEUE).length, 3, 'one stored queue');
  t1.db.collection('characters').onSnapshot(() => {}); t2.db.collection('characters').onSnapshot(() => {});
  delete api.status['/api/'];
  await until(() => read(st, QUEUE) === null && !t1.b.win.B68Runtime.status.pending && !t2.b.win.B68Runtime.status.pending, 3000);
  eq(api.applied, ['PATCH /api/characters/a', 'PUT /api/characters/b', 'PATCH /api/characters/a'], 'each once, in order');
  eq(api.rows.a.doc.play.stress, 2, 'last write wins');
});

await test('offline start, then the server says another account: err once, writes refused', async () => {
  const api = fakeApi(); api.put('a', char('a'));
  const st = memStorage();
  (await warm(api, st)).close();
  const { b, db } = await offlinePage(api, st);
  const errs = []; db.collection('characters').onSnapshot(() => {}, (e) => errs.push(e));
  b.setUser({ email: 'pl@x.test' });
  delete api.status['/api/'];
  await until(() => errs.length, 1000);
  eq([errs.length, errs[0].code], [1, 'other_user']);
  let err = null; try { await db.collection('characters').doc('a').update({ name: 'x' }); } catch (e) { err = e; } ok(err, 'write accepted');
});

await test('status: B68Runtime.status and b68:runtime events follow offline, pending, reconnect and sync', async () => {
  const api = fakeApi(); api.put('a', char('a'));
  const st = memStorage();
  (await warm(api, st)).close();
  const { b, db } = await offlinePage(api, st);
  db.collection('characters').onSnapshot(() => {});
  ok(b.events.length >= 1, 'no event');
  eq([b.events[0].online, b.events[0].pending], [false, 0], 'first event: offline');
  await db.collection('characters').doc('a').update({ name: 'a2' });
  eq(b.events[b.events.length - 1], { online: false, pending: 1, lastSync: read(st, SNAP).syncedAt, newBuild: null }, 'one waiting');
  const t0 = new Date().toISOString();
  delete api.status['/api/'];
  await until(() => b.win.B68Runtime.status.pending === 0 && b.win.B68Runtime.status.online, 1000);
  const s = b.win.B68Runtime.status;
  ok(s.lastSync >= t0, 'lastSync moved: ' + s.lastSync);
  ok(b.events.some((e) => e.online && e.pending === 1), 'online with one to send');
  eq(b.events[b.events.length - 1].pending, 0, 'last event');
  for (let i = 1; i < b.events.length; i++) ok(JSON.stringify(b.events[i]) !== JSON.stringify(b.events[i - 1]), 'an event without a change');
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

/* ---------- the GM tools: window.claude.gm (GM.md) ---------- */
await test('window.claude.gm: plain calls for the GM (pack, parts, state, display); a player gets 403; the artifact has none', async () => {
  const api = fakeApi(), storage = memStorage();
  const b = browser(api, { email: 'gm@x.test' }, { storage });
  const g = b.win.claude.gm;
  ok(g && ['pack', 'packPart', 'importPart', 'removePart', 'state', 'patchState', 'display', 'setDisplay'].every((k) => typeof g[k] === 'function'), 'gm API');
  const MARK = 'zebra-teacup-table-text';
  eq((await g.importPart({ part: 'console', src: { file: 'f' }, body: { T: { a: MARK } } })).ok, true, 'importPart');
  const idx = await g.pack();
  eq(Object.keys(idx.parts), ['console'], 'index');
  eq((await g.packPart('console')).body.T.a, MARK, 'packPart');
  await g.patchState({ capture: { c1: { bucket: 'n', text: MARK } } });
  eq((await g.state()).doc.capture.c1.text, MARK, 'state round trip');
  eq((await g.setDisplay({ kind: 'text', text: 'hi' })).seq, 1, 'setDisplay');
  eq((await g.display(1)).unchanged, true, 'display unchanged at the current seq');
  eq((await g.display(1, 2, 3)).unchanged, true, 'display with the ambient and the transcriber seqs too');
  eq((await g.display(null, undefined, 3)).seq, 1, 'display with only the transcriber seq');
  await g.display();
  await g.removePart('console');
  const sent = b.fetchLog.map((x) => (x.opts.method || 'GET') + ' ' + x.url).filter((x) => x.includes('/api/gm/'));
  eq(sent, ['POST /api/gm/pack', 'GET /api/gm/pack', 'GET /api/gm/pack?part=console', 'PATCH /api/gm/state', 'GET /api/gm/state', 'PUT /api/gm/display', 'GET /api/gm/display?seq=1',
    'GET /api/gm/display?seq=1&aseq=2&sseq=3', 'GET /api/gm/display?sseq=3', 'GET /api/gm/display', 'DELETE /api/gm/pack?part=console'], 'requests');
  await sleep(60);
  ok(![...storage._m.values()].some((v) => String(v).includes(MARK)), 'GM text reached localStorage (snapshot or queue)');
  const pb = browser(api, { email: 'pl@x.test' });
  for (const fn of [() => pb.win.claude.gm.pack(), () => pb.win.claude.gm.state(), () => pb.win.claude.gm.setDisplay({ kind: 'blank' })]) {
    let err = null; try { await fn(); } catch (e) { err = e; }
    eq([err && err.status, err && err.message], [403, 'only the GM can use the GM tools'], 'player refused');
  }
  eq(browser(api, { email: 'gm@x.test' }, { preset: { use: () => 1 } }).win.claude.gm, undefined, 'the artifact build has no gm API');
});

await test('window.claude.gm: offline, a call rejects with network: true and is never queued or replayed', async () => {
  const api = fakeApi(), storage = memStorage();
  const b = browser(api, { email: 'gm@x.test' }, { storage });
  await b.win.claude.use('db');
  api.status['/api/gm/'] = 'down';
  let err = null; try { await b.win.claude.gm.patchState({ live: { pos: 'desperate' } }); } catch (e) { err = e; }
  eq([!!err, err && err.network], [true, true], 'network error');
  delete api.status['/api/gm/'];
  await sleep(POLL * 4);
  eq(api.calls.filter((c) => c.startsWith('PATCH /api/gm/')).length, 1, 'only the one failed attempt (never replayed)');
  eq(api.gm.state, {}, 'nothing reached the server');
  ok(![...storage._m.values()].some((v) => String(v).includes('desperate')), 'the GM write sits in localStorage');
  eq(b.win.B68Runtime.status.pending || 0, 0, 'counted as a pending change');
});

/* ---------- the cast: collection('npcs') (CAST.md) ---------- */
const npc = (name, extra = {}) => ({ name, alias: '', role: '', faction: '', description: name + ' is here.', spec: { id: name }, revealed: false, firstSeen: null, tags: [], gmNotes: 'notes on ' + name, ...extra });
const npcCalls = (api) => api.calls.filter((c) => /\/api\/npcs/.test(c));

await test('npcs: a GM listener gets every NPC; the poll refetches the list only when npcsUpdatedAt moved', async () => {
  const api = fakeApi();
  api.putNpc('grunt', npc('Grunt')); api.putNpc('mira', npc('Mira', { revealed: true }));
  const b = browser(api, { email: 'gm@x.test' });
  const col = (await b.win.claude.use('db')).collection('npcs');
  const snaps = []; const un = col.onSnapshot((s) => snaps.push(s));
  await until(() => snaps.length);
  eq(snaps[0].docs.map((d) => d.id).sort(), ['grunt', 'mira'], 'both, hidden one too');
  eq(snaps[0].docs.find((d) => d.id === 'grunt').data().gmNotes, 'notes on Grunt', 'the GM has the notes');
  await sleep(POLL * 6);
  eq(npcCalls(api).filter((c) => c === 'GET /api/npcs').length, 1, 'one fetch of the list while nothing changed');
  ok(api.calls.filter((c) => /^GET \/api\/characters/.test(c)).length >= 4, 'the characters poll kept running');
  api.putNpc('zam', npc('Zam'));
  await until(() => snaps[snaps.length - 1].size === 3);
  eq(snaps[snaps.length - 1].docs.map((d) => d.id).sort(), ['grunt', 'mira', 'zam'], 'a change on the server arrives');
  eq(npcCalls(api).filter((c) => c === 'GET /api/npcs').length, 2, 'refetched once for it');
  api.npcs.grunt = { updatedAt: api.now(), deleted: true, doc: {} };
  await until(() => snaps[snaps.length - 1].size === 2);
  eq(snaps[snaps.length - 1].docs.map((d) => d.id).sort(), ['mira', 'zam'], 'a deleted NPC leaves');
  un();
});

await test('npcs: nothing is fetched while nobody listens, and the first listener starts the cast', async () => {
  const api = fakeApi();
  api.putNpc('mira', npc('Mira', { revealed: true }));
  const b = browser(api, { email: 'pl@x.test' });
  const db = await b.win.claude.use('db');
  const chars = []; const unc = db.collection('characters').onSnapshot((s) => chars.push(s));
  await until(() => chars.length); await sleep(POLL * 3);
  eq(npcCalls(api), [], 'no /api/npcs call without a listener');
  const snaps = []; const un = db.collection('npcs').onSnapshot((s) => snaps.push(s));
  await until(() => snaps.length);
  eq(snaps[0].docs.map((d) => d.id), ['mira'], 'listed once subscribed');
  un(); unc();
});

await test('npcs: a player is sent only revealed NPCs without gmNotes; reveal and hide arrive by polling', async () => {
  const api = fakeApi();
  api.putNpc('grunt', npc('Grunt')); api.putNpc('mira', npc('Mira', { revealed: true }));
  const pl = browser(api, { email: 'pl@x.test' }), gmb = browser(api, { email: 'gm@x.test' });
  const snaps = []; const col = (await pl.win.claude.use('db')).collection('npcs');
  const un = col.onSnapshot((s) => snaps.push(s));
  await until(() => snaps.length);
  const last = () => snaps[snaps.length - 1];
  eq(last().docs.map((d) => d.id), ['mira'], 'revealed only');
  ok(!('gmNotes' in last().docs[0].data()), 'no gmNotes');
  const gref = (await gmb.win.claude.use('db')).collection('npcs').doc('grunt');
  await gref.update({ revealed: true });
  await until(() => last().size === 2);
  eq(last().docs.map((d) => d.id).sort(), ['grunt', 'mira'], 'revealed by the GM, seen by the player');
  eq(last().docs.find((d) => d.id === 'grunt').data().gmNotes, undefined, 'still no notes');
  await gref.update({ revealed: false });
  await until(() => last().size === 1);
  eq(last().docs.map((d) => d.id), ['mira'], 'hidden again, gone');
  eq((await col.doc('grunt').get()).exists, false, 'a hidden NPC reads like a missing one');
  eq((await col.doc('mira').get()).data().name, 'Mira', 'one revealed NPC reads');
  un();
});

await test('npcs: the GM writes through doc(): set, update, delete (optimistic, queued, the server holds them); a player is refused at once', async () => {
  const api = fakeApi();
  api.putNpc('mira', npc('Mira'));
  const b = browser(api, { email: 'gm@x.test' });
  const col = (await b.win.claude.use('db')).collection('npcs');
  const snaps = []; const un = col.onSnapshot((s) => snaps.push(s));
  await until(() => snaps.length);
  const last = () => snaps[snaps.length - 1];
  const p = col.doc('zam').set(npc('Zam'));
  eq([last().size, last().docs.find((d) => d.id === 'zam').metadata.hasPendingWrites], [2, true], 'optimistic set');
  await p;
  eq([api.npcs.zam.doc.name, api.npcs.zam.doc.gmNotes], ['Zam', 'notes on Zam'], 'the server holds it');
  await col.doc('zam').update({ role: 'Kid', tags: ['keys'] });
  eq([api.npcs.zam.doc.role, api.npcs.zam.doc.tags, api.npcs.zam.doc.name], ['Kid', ['keys'], 'Zam'], 'merge');
  eq(last().docs.find((d) => d.id === 'zam').data().role, 'Kid', 'the snapshot follows');
  await col.doc('zam').delete();
  eq([api.npcs.zam.deleted, last().docs.map((d) => d.id)], [true, ['mira']], 'delete');
  eq(api.applied.filter((a) => /npcs/.test(a)), ['PUT /api/npcs/zam', 'PATCH /api/npcs/zam', 'DELETE /api/npcs/zam'], 'writes in order');
  un();
  const pl = browser(api, { email: 'pl@x.test' });
  const pcol = (await pl.win.claude.use('db')).collection('npcs');
  const before = npcCalls(api).length;
  for (const fn of [() => pcol.doc('mira').set(npc('x')), () => pcol.doc('mira').update({ revealed: true }), () => pcol.doc('mira').delete()]) {
    let err = null; try { await fn(); } catch (e) { err = e; }
    eq([err && err.status, err && err.message], [403, 'only the GM can change the cast'], 'player write');
  }
  eq(npcCalls(api).length, before, 'no request was sent');
  eq(api.npcs.mira.doc.revealed, false, 'the cast is unchanged');
});

await test('npcs: a write the server refuses (400) is dropped and the cast is resynced; unknown collections still throw', async () => {
  const api = fakeApi();
  api.putNpc('mira', npc('Mira'));
  const b = browser(api, { email: 'gm@x.test' });
  const db = await b.win.claude.use('db');
  const snaps = []; const un = db.collection('npcs').onSnapshot((s) => snaps.push(s));
  await until(() => snaps.length);
  const orig = api.handle; api.handle = (u, m, url, body) => (m === 'PUT' && /\/api\/npcs\//.test(url) ? [400, { error: 'name is required' }] : orig(u, m, url, body));
  let err = null; try { await db.collection('npcs').doc('bad').set(npc('')); } catch (e) { err = e; }
  eq([err && err.status, err && err.message], [400, 'name is required'], 'the refusal reaches the caller');
  api.handle = orig;
  await until(() => snaps[snaps.length - 1].docs.every((d) => d.id !== 'bad'));
  eq(snaps[snaps.length - 1].docs.map((d) => d.id), ['mira'], 'the optimistic copy is rolled back');
  let thrown = null; try { db.collection('nope'); } catch (e) { thrown = e; }
  ok(thrown && /unknown collection/.test(thrown.message), 'unknown collection');
  ok(db.doc('npcs/mira').id === 'mira', 'db.doc("npcs/<id>")');
  un();
});

await test('profile.setName: PATCH /api/me, the signed-in user and the cached member names follow; a refusal rejects with status 400', async () => {
  const api = fakeApi();
  const b = browser(api, { email: 'pl@x.test', name: 'pl' });
  const u = await b.win.claude.use('user');
  eq((await u.me()).name, 'pl'); eq((await u.profiles('pl@x.test'))['pl@x.test'].name, 'pl');
  const r = await b.win.claude.profile.setName('  Sam   the Man ');
  eq([r.id, r.name, r.role], ['pl@x.test', 'Sam the Man', 'player']);
  const patch = b.fetchLog.find((f) => f.opts.method === 'PATCH');
  eq([patch.url, JSON.parse(patch.opts.body)], ['/api/me', { name: '  Sam   the Man ' }], 'request');
  eq((await u.me()).name, 'Sam the Man', 'user.me()'); eq(b.win.B68Runtime.me.name, 'Sam the Man', 'B68Runtime.me');
  eq((await u.profiles('pl@x.test'))['pl@x.test'].name, 'Sam the Man', 'profiles refetched');
  let err = null; try { await b.win.claude.profile.setName('<b>'); } catch (e) { err = e; }
  ok(err && err.status === 400, 'a refused name rejects with status 400'); eq((await u.me()).name, 'Sam the Man', 'unchanged after a refusal');
  eq((await b.win.claude.profile.setName(null)).name, 'pl', 'null clears');
  eq((await u.me()).name, 'pl'); eq(JSON.parse(b.fetchLog.filter((f) => f.opts.method === 'PATCH').pop().opts.body), { name: null });
});

/* E15: a page left open across a deploy learns the server's build from X-B68-Build and says so (boot.js: "Updated: reload") */
await test('status.newBuild: null while the server runs this page\'s build; the server\'s build once it differs (X-B68-Build on any API answer), with a b68:runtime event; silent when the page has no build', async () => {
  const api = fakeApi(); api.put('a', char('a')); api.build = '2026-10-16-abc1234';
  const b = browser(api, { email: 'gm@x.test' });
  b.win.B68_BUILD = '2026-10-16-abc1234';                                   // routes.js on the same build
  const db = await b.win.claude.use('db');
  eq(b.win.B68Runtime.status.newBuild, null, 'same build: nothing to say');
  const snaps = []; const un = db.collection('characters').onSnapshot((s) => snaps.push(s));
  await until(() => snaps.length);
  const n = b.events.length;
  api.build = '2026-10-17-def5678';                                         // a deploy while the page is open: the next poll's answer says so
  await until(() => b.win.B68Runtime.status.newBuild, POLL * 4);
  eq(b.win.B68Runtime.status.newBuild, '2026-10-17-def5678', 'the server\'s newer build');
  ok(b.events.length > n && b.events[b.events.length - 1].newBuild === '2026-10-17-def5678', 'a b68:runtime event carried it');
  un();
  const o = browser(api, { email: 'gm@x.test' });                           // no routes.js (the artifact, an old page): nothing is claimed
  await o.win.claude.use('db');
  eq(o.win.B68Runtime.status.newBuild, null, 'no own build: silent');
  const same = browser(api, { email: 'gm@x.test' }); same.win.B68_BUILD = '2026-10-17-def5678';
  await same.win.claude.use('db');
  eq(same.win.B68Runtime.status.newBuild, null, 'a page on the new build: silent');
});

/* ---------- live sync (design 2.5): the poke socket, with a fake WebSocket ---------- */
/* A WebSocket stand-in the test drives by hand: nothing opens, answers or closes until the test says so. */
function fakeSockets({ autoPong = true, flap = false } = {}) {
  const made = [];
  class FakeWS {
    constructor(url) {
      this.url = url; this.sent = []; this.closed = null; this.at = Date.now(); made.push(this);
      if (flap) setTimeout(() => { this.open(); setTimeout(() => this.drop(1006), 1); }, 1);   // opens, says hello and drops at once
    }
    send(d) { this.sent.push(d); if (d === 'ping' && autoPong && !this.mute) setTimeout(() => this.onmessage && this.onmessage({ data: 'pong' }), 1); }
    close(code) { this.closed = code === undefined ? 1005 : code; }
    // test side
    open() { this.onopen && this.onopen({}); this.onmessage && this.onmessage({ data: '{"hello":1}' }); }
    poke(k) { this.onmessage && this.onmessage({ data: JSON.stringify({ k, t: Date.now() }) }); }
    drop(code) { this.onclose && this.onclose({ code }); }
  }
  return { FakeWS, made, last: () => made[made.length - 1] };
}
const LIVE_KNOBS = { pingMs: 100000, pongMs: 100000, silentMs: 100000, echoMs: 80, graceMs: 80, badMs: 700, backoff: [60, 120, 300], pokeGapMs: 0 };
const HEALTHY_MS = 400;
function liveBrowser(api, knobs = {}, sockOpts, healthyMs = HEALTHY_MS) {
  const ws = fakeSockets(sockOpts);
  const b = browser(api, { email: 'gm@x.test' }, { extra: { WebSocket: ws.FakeWS, __B68_LIVE: { ...LIVE_KNOBS, ...knobs }, __B68_HEALTHY_POLL_MS: healthyMs } });
  const polls = () => b.fetchLog.filter((c) => /^\/api\/characters(\?|$)/.test(c.url)).length;
  return { b, ws, polls };
}
async function liveUp(api, knobs, sockOpts, healthyMs) {
  api.live = true;
  const L = liveBrowser(api, knobs, sockOpts, healthyMs);
  const db = await L.b.win.claude.use('db');
  const snaps = []; const un = db.collection('characters').onSnapshot((s) => snaps.push(s));
  await until(() => snaps.length);
  await until(() => L.ws.made.length, 500);
  return { ...L, db, snaps, un };
}

await test('live: no socket until a poll answer says live: true; a page with no WebSocket is untouched', async () => {
  const api = fakeApi();
  const L = liveBrowser(api);
  const db = await L.b.win.claude.use('db');
  const un = db.collection('characters').onSnapshot(() => {});
  await sleep(POLL * 5);
  eq(L.ws.made.length, 0, 'no live key in the answer: no socket');
  api.live = false; await sleep(POLL * 4);
  eq(L.ws.made.length, 0, 'live: false: no socket');
  un();
  const plain = browser(fakeApi(), { email: 'gm@x.test' });            // no WebSocket on the window at all
  const d2 = await plain.win.claude.use('db'); const u2 = d2.collection('characters').onSnapshot(() => {});
  await sleep(POLL * 3); u2();
  ok(plain.win.B68Live && plain.win.B68Live.state().connects === 0, 'inert without WebSocket');
});

await test('live: a poll that says live: true opens the same-origin socket; a poke runs the poll at once; healthy slows the poll', async () => {
  const api = fakeApi();
  const { b, ws, polls, un } = await liveUp(api);
  eq(ws.made.length, 1, 'one socket'); eq(ws.last().url, 'wss://app.test/api/live', 'same origin, wss on https');
  ws.last().open();
  ok(b.win.B68Live.state().healthy, 'healthy after hello');
  await sleep(POLL * 2);                                                // the hello poll runs at once
  const n0 = polls(); await sleep(POLL * 4);
  ok(polls() - n0 <= 1, 'a healthy socket slows the poll to ' + HEALTHY_MS + ' ms: ' + (polls() - n0) + ' polls in ' + POLL * 4 + ' ms');
  api.put('p', char('p'));
  const n1 = polls(); ws.last().poke('characters');
  await until(() => polls() > n1, 40);
  ok(polls() > n1, 'the poke ran the poll within 40 ms');
  ok(b.win.B68Live.state().healthy, 'a poke that announced the change keeps it healthy');
  await sleep(LIVE_KNOBS.graceMs * 2); ok(b.win.B68Live.state().healthy, 'still healthy past the grace');
  un();
  ok(ws.last().closed === 1000, 'the last listener leaving closes the socket');
});

await test('live: a poke for a kind nobody holds does nothing', async () => {
  const api = fakeApi();
  const { ws, polls, un } = await liveUp(api);
  ws.last().open(); await sleep(POLL * 2);
  const n = polls(); ws.last().poke('cue'); ws.last().poke('display'); await sleep(40);
  eq(polls(), n, 'no poll for cue or display');
  un();
});

await test('live: a poll that brings back a change no poke announced marks the socket unhealthy, and the poll goes back to the fast beat', async () => {
  const api = fakeApi();
  const { b, ws, polls, un } = await liveUp(api);
  ws.last().open(); await sleep(POLL * 2);
  ok(b.win.B68Live.state().healthy, 'healthy first');
  api.put('quiet', char('quiet'));                                      // a write nobody poked (a silent socket)
  await until(() => !b.win.B68Live.state().healthy, HEALTHY_MS + 400);
  ok(!b.win.B68Live.state().healthy, 'unhealthy within one healthy poll + grace');
  const n = polls(); await sleep(POLL * 6);
  ok(polls() - n >= 3, 'back on the fast beat: ' + (polls() - n) + ' polls in ' + POLL * 6 + ' ms');
  un();
});

await test('live: the first poll after a (re)connect is not judged, and a late poke inside the grace still counts', async () => {
  const api = fakeApi();
  const { b, ws, un } = await liveUp(api);
  api.put('before', char('before'));                                    // changed while the socket was still opening
  ws.last().open();                                                     // the hello poll finds it: grace
  await sleep(LIVE_KNOBS.graceMs * 2 + POLL * 2);
  ok(b.win.B68Live.state().healthy, 'the reconnect poll is not judged');
  await sleep(HEALTHY_MS);
  api.put('late', char('late'));
  setTimeout(() => ws.last().poke('characters'), 40);                   // arrives after the poll that already saw it
  await sleep(HEALTHY_MS + LIVE_KNOBS.graceMs * 2 + 100);
  ok(b.win.B68Live.state().healthy, 'a poke inside the grace announced it');
  un();
});

await test('live: an own write whose poke does not come back in time marks the socket unhealthy; one that does keeps it healthy', async () => {
  const api = fakeApi();
  const { b, ws, db, un } = await liveUp(api);
  ws.last().open(); await sleep(POLL * 2);
  await db.collection('characters').doc('w1').set(char('w1'));
  ws.last().poke('characters');                                         // the echo
  await sleep(LIVE_KNOBS.echoMs * 2); ok(b.win.B68Live.state().healthy, 'echoed: healthy');
  await db.collection('characters').doc('w2').set(char('w2'));          // no echo
  await until(() => !b.win.B68Live.state().healthy, LIVE_KNOBS.echoMs * 3 + 100);
  ok(!b.win.B68Live.state().healthy, 'no echo within the window: unhealthy');
  un();
});

await test('live: a pong alone is not health, and a missed pong reconnects with the backoff', async () => {
  const api = fakeApi();
  const { ws, un } = await liveUp(api, { pingMs: 40, pongMs: 40, echoMs: 100000, graceMs: 100000 }, { autoPong: true });
  ws.last().open();
  await sleep(200);
  eq(ws.made.length, 1, 'pongs keep the socket');
  ok(ws.last().sent.filter((x) => x === 'ping').length >= 2, 'pings go out');
  ws.last().mute = true;                                                // the runtime stops answering
  await until(() => ws.made.length > 1, 600);
  ok(ws.made.length >= 2, 'no pong: closed and reconnected');
  un();
});

await test('live: a drop after it was open reconnects on the backoff and the poll is fast meanwhile; nothing is lost', async () => {
  const api = fakeApi();
  const { b, ws, polls, snaps, un } = await liveUp(api);
  ws.last().open(); await sleep(POLL * 2);
  ws.made[0].drop(1006);
  ok(!b.win.B68Live.state().healthy, 'a dead socket is not healthy');
  api.put('during', char('during'));
  const n = polls(); await until(() => snaps.some((s) => s.docs.some((d) => d.id === 'during')), 300);
  ok(snaps.some((s) => s.docs.some((d) => d.id === 'during')), 'the fast poll still delivered the change');
  await until(() => ws.made.length > 1, 300);
  eq(ws.made.length, 2, 'reconnected once');
  un();
});

await test('live: a server close with 1000 is "off": no reconnect through the backoff, not until a poll says live: true again', async () => {
  const api = fakeApi();
  const { b, ws, un } = await liveUp(api);
  ws.last().open(); await sleep(POLL);
  api.live = false;                                                     // the GM flips the switch: the server closes every socket with 1000
  ws.last().drop(1000);
  await sleep(500);
  eq(ws.made.length, 1, 'no reconnect while the switch is off (1000 is not a drop)');
  api.live = true; await until(() => ws.made.length > 1, 600);
  eq(ws.made.length, 2, 'reopened once a poll said live: true');
  un();
});

await test('live: a refused upgrade (503, an Access redirect) costs one connect per backoff step, never one per poll, with no error', async () => {
  const api = fakeApi();
  const errors = [];
  const { b, ws, polls, un } = await liveUp(api);
  const t0 = Date.now();
  // every connect closes before it opens: what a 503 or an Access redirect looks like to a page
  const fail = () => { const w = ws.last(); if (w && !w.failed) { w.failed = true; w.drop(1006); } };
  const iv = setInterval(fail, 5);
  await sleep(1200);
  clearInterval(iv);
  const n = ws.made.length, p = polls();
  ok(p > 12, 'the poll went on: ' + p);
  ok(n >= 3 && n <= 6, 'connects on the 60/120/300 ms backoff: ' + n + ' in 1.2 s with ' + p + ' polls');
  ok(b.win.B68Runtime.status.online, 'no error shown');
  un();
});

await test('live: a hidden page closes its socket; visible again it reopens it and polls at once', async () => {
  const api = fakeApi();
  const { b, ws, polls, un } = await liveUp(api);
  ws.last().open(); await sleep(POLL * 2);
  b.document.hidden = true; b.fire('visibilitychange'); (b.listeners.visibilitychange || []).forEach((fn) => fn());
  ok(ws.made[0].closed === 1000, 'hidden: closed');
  eq(ws.made.length, 1, 'no new socket while hidden');
  b.document.hidden = false; const n = polls(); (b.listeners.visibilitychange || []).forEach((fn) => fn());
  await sleep(30);
  eq(ws.made.length, 2, 'visible: reopened'); ok(polls() > n, 'and polled at once');
  un();
});

await test('live: the switch going off closes the socket within one poll and the poll is fast again', async () => {
  const api = fakeApi();
  const { b, ws, polls, un } = await liveUp(api);
  ws.last().open(); await sleep(POLL * 2);
  api.live = false;
  await until(() => ws.made[0].closed === 1000, HEALTHY_MS + 100);
  eq(ws.made[0].closed, 1000, 'closed by the page');
  ok(!b.win.B68Live.state().open && !b.win.B68Live.state().healthy, 'not open, not healthy');
  const n = polls(); await sleep(POLL * 6); ok(polls() - n >= 3, 'fast beat again');
  eq(ws.made.length, 1, 'and no reconnect');
  un();
});

await test('live: a burst of 10 pokes in 300 ms makes 1 or 2 polls, and the last write of the burst is seen', async () => {
  const api = fakeApi();
  const { ws, polls, snaps, un } = await liveUp(api, { pokeGapMs: 500, echoMs: 100000, graceMs: 100000 }, undefined, 100000);
  ws.last().open(); await sleep(POLL * 3);
  await sleep(600);                                                     // past the hello poll gap
  const n = polls();
  for (let i = 0; i < 10; i++) { api.put('b' + i, char('b' + i)); ws.last().poke('characters'); await sleep(30); }
  await until(() => snaps.some((s) => s.docs.some((d) => d.id === 'b9')), 1000);
  await sleep(300);
  const made = polls() - n;
  ok(made >= 1 && made <= 2, 'polls made by the burst: ' + made);
  ok(snaps.some((s) => s.docs.some((d) => d.id === 'b9')), 'the last write was seen');
  un();
});

/* ---------- live sync: one connect gate (review fix) ---------- */
await test('live gate: a socket that opens, gets hello and drops with 1006 at once, again and again, connects only on the 1, 2, 5, 10, 30 s steps (scaled), never per poll', async () => {
  const api = fakeApi();
  const steps = [50, 100, 250, 500, 1000];
  const { ws, polls, un } = await liveUp(api, { backoff: steps, stableMs: 100000 }, { flap: true });
  await sleep(3200);
  const at = ws.made.map((w) => w.at), gaps = at.slice(1).map((t, i) => t - at[i]);
  console.log('flap connect gaps (ms), scaled steps ' + steps.join('/') + ': ' + gaps.join(', ') + ' with ' + polls() + ' polls');
  ok(polls() > 30, 'the poll went on (' + polls() + ')');
  ok(gaps.length >= 5 && gaps.length <= 7, 'connects: ' + ws.made.length);
  gaps.forEach((g, i) => { const want = steps[Math.min(i, steps.length - 1)]; ok(g >= want - 5 && g <= want + 120, 'gap ' + i + ' is the ' + want + ' ms step, got ' + g); });
  un();
});

await test('live gate: the breaker stops connecting after the limit and live sync stays off on that page, the poll going on', async () => {
  const api = fakeApi();
  const { b, ws, polls, un } = await liveUp(api, { backoff: [20], maxConnects: 4, stableMs: 100000 }, { flap: true });
  await sleep(900);
  eq(ws.made.length, 4, 'connects stop at the limit');
  ok(b.win.B68Live.state().broken, 'the breaker says so');
  const n = polls(); await sleep(300);
  ok(polls() - n >= 3, 'the poll goes on');
  eq(ws.made.length, 4, 'and nothing reconnects');
  un();
});

await test('live gate: a socket that stayed open past the stable time and then drops starts again at the first step', async () => {
  const api = fakeApi();
  const { ws, un } = await liveUp(api, { backoff: [60, 300, 600], stableMs: 150, echoMs: 100000, graceMs: 100000 });
  ws.last().open(); ws.made[0].drop(1006);                              // a flap: the step moves on
  await until(() => ws.made.length > 1, 500);
  const t1 = ws.made[1].at; ws.made[1].open();
  await sleep(300);                                                     // longer than stableMs: the backoff starts over
  ws.made[1].drop(1006);
  await until(() => ws.made.length > 2, 800);
  const gap = ws.made[2].at - Date.now();
  const lag = ws.made[2].at - (t1 + 300);
  ok(lag >= 0 && lag < 200, 'the next connect came one first step (60 ms) after the drop, not the second (300 ms): ' + lag);
  un();
});

await test('live gate: coming back visible after a 1000 close connects nothing until a poll says live: true', async () => {
  const api = fakeApi();
  const { b, ws, un } = await liveUp(api, { backoff: [40], echoMs: 100000, graceMs: 100000 });
  ws.last().open(); await sleep(POLL * 2);
  const vis = () => (b.listeners.visibilitychange || []).forEach((fn) => fn());
  ws.made[0].drop(1000);                                                // the server closed it: off
  b.document.hidden = true; vis(); b.document.hidden = false; vis();    // same tick: the last poll answer has not been read since
  eq(ws.made.length, 1, 'no connect from visibility while blocked by a 1000 close');
  api.live = false; await sleep(POLL * 4);
  b.document.hidden = true; vis(); b.document.hidden = false; vis();
  eq(ws.made.length, 1, 'none while the switch is off');
  api.live = true; await until(() => ws.made.length > 1, 600);
  eq(ws.made.length, 2, 'a poll that said live: true opened it');
  un();
});

console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
