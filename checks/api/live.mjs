// Live sync, the Worker's half (MD1b, design 2.5), in plain node on an in-memory D1 and a FAKE LiveHub namespace: no server.
//   - every write path pokes the right kind AFTER the write succeeded, through waitUntil; a refused write (403, 409) and every GET pokes nothing
//   - a poke is stub.poke(kind) with a bare string kind (the object stamps the time); the kinds are the table in functions/_lib/live.js
//   - the route forwards the SIGNED-IN role, never a client-sent one; the display role reaches /api/live; anonymous is 401 and the object is not touched
//   - the object down (no binding, get() throws, poke() rejects, poke() never answers): the write still answers, and the poke WAS attempted
//   - the switch (GM state `live`) rides in GET /api/characters and the display's full and sseq answers; read in SQL, one small read, on by default
// The object itself (roles, frames, {k,t}) is checked against a real wrangler dev in display-role.mjs.
//   node checks/api/live.mjs

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { worker } from '../../worker/app.js';
import { KINDS, ROLES, ROLE_HEADER, rolesFor } from '../../functions/_lib/live.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let passes = 0, failures = 0;
async function step(name, fn) {
  try { await fn(); passes++; console.log('PASS ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e && e.stack || e)); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const GM = 'gm@example.test', IPAD = 'ipad@example.test', ALEX = 'player.a@example.test', BEA = 'player.b@example.test';
const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
const DB = asD1(exec);

// A LIVE namespace stand-in. mode: 'ok' | 'getThrows' | 'idThrows' | 'rejects' | 'hangs'
function fakeHub(mode = 'ok') {
  const hub = { mode, pokes: [], closes: 0, attempts: 0, forwarded: [], names: [] };
  hub.LIVE = {
    idFromName(n) { hub.names.push(n); if (hub.mode === 'idThrows') throw new Error('id: down'); return { id: n }; },
    get(id) {
      hub.attempts++;
      if (hub.mode === 'getThrows') throw new Error('get: down');
      return {
        poke(...args) {
          hub.pokes.push(args);
          if (hub.mode === 'rejects') return Promise.reject(new Error('poke: down'));
          if (hub.mode === 'hangs') return new Promise(() => {});
          return Promise.resolve(1);
        },
        closeAll() {
          hub.closes++;
          if (hub.mode === 'rejects') return Promise.reject(new Error('closeAll: down'));
          if (hub.mode === 'hangs') return new Promise(() => {});
          return Promise.resolve(1);
        },
        async fetch(req) { hub.forwarded.push(req); return { status: 101, webSocket: {}, body: null, headers: { set() { throw new Error('touched a 101'); }, get() { return null; } } }; },
      };
    },
  };
  return hub;
}
const kindsOf = (hub) => hub.pokes.map((a) => a[0]);

// one request through the real Worker entry; the context collects what is handed to waitUntil
async function call(hub, method, p, { user = GM, body, headers = {} } = {}) {
  const pending = [];
  const env = { DEV_USER: GM, GM_EMAILS: GM, DISPLAY_EMAILS: IPAD, DB, CAMPAIGN: 'livecheck' };
  if (hub !== null) env.LIVE = hub.LIVE;
  const init = { method, headers: { 'X-Dev-User': user, ...headers } };
  if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
  const t0 = Date.now();
  const res = await worker.fetch(new Request('http://127.0.0.1:8788' + p, init), env, { waitUntil: (pr) => pending.push(pr) });
  const answeredMs = Date.now() - t0;
  const text = res.status === 101 ? '' : await res.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text, pending, answeredMs, res };
}
const settle = (r) => Promise.race([Promise.allSettled(r.pending), new Promise((ok) => setTimeout(ok, 50))]);

// ---------- the table ----------
await step('the kinds table is design 2.5: who hears what, screen reserved for phones, unknown kinds heard by nobody', () => {
  expect(same(ROLES, ['gm', 'player', 'display']), 'roles');
  expect(same(KINDS.characters, ['player', 'gm']) && same(KINDS.campaign, ['player', 'gm']) && same(KINDS.npcs, ['player', 'gm']), 'phones and GM pages: characters, campaign, npcs');
  expect(same(KINDS.display, ['display', 'gm']) && same(KINDS.ambient, ['display', 'gm']) && same(KINDS.stt, ['display', 'gm']), 'the iPad and GM pages: display, ambient, stt');
  expect(same(KINDS.cue, ['gm']), 'cue: GM pages only');
  expect(same(KINDS.screen, ['player']), 'screen: phones only (reserved)');
  expect(rolesFor('nope').length === 0 && rolesFor('constructor').length === 0 && rolesFor('__proto__').length === 0, 'unknown kinds (and Object.prototype names) are heard by nobody');
});

await step('the pokeLive call sites: exactly the write paths, and no source ever sends screen', () => {
  const sites = [];
  const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith('.js')) { const t = fs.readFileSync(p, 'utf8'); for (const m of t.matchAll(/pokeLive\(\{[^}]*\},\s*\[([^\]]*)\]\)/g)) sites.push(path.relative(ROOT, p).replace(/\\/g, '/') + ' ' + m[1].replace(/'/g, '')); }
  } };
  walk(path.join(ROOT, 'functions', 'api'));
  const want = ['functions/api/campaign.js campaign', 'functions/api/characters/[id].js characters', 'functions/api/characters/[id].js characters', 'functions/api/characters/[id].js characters',
    'functions/api/gm/ambient.js ambient', 'functions/api/gm/assist.js npcs', 'functions/api/gm/display.js display', 'functions/api/gm/stt.js stt',
    'functions/api/gm/transcript.js cue', 'functions/api/npcs/[id].js npcs', 'functions/api/npcs/[id].js npcs', 'functions/api/npcs/[id].js npcs', 'functions/api/npcs/index.js npcs'];
  expect(same(sites.sort(), want.sort()), 'call sites: ' + JSON.stringify(sites.sort()));
  expect(!sites.some((s) => /screen/.test(s)), 'nothing sends screen');
});

// ---------- every write path ----------
let nid, cid = 'char_live_1';
await step('every write path pokes its kind once, after the write: characters (PUT, PATCH, DELETE), campaign (GM PUT, player PATCH), npcs (POST, PUT, PATCH, DELETE)', async () => {
  const hub = fakeHub();
  const run = async (label, kinds, ...args) => {
    hub.pokes.length = 0;
    const r = await call(hub, ...args);
    expect(r.status >= 200 && r.status < 300, label + ': ' + r.status + ' ' + r.text.slice(0, 200));
    await settle(r);
    expect(same(kindsOf(hub), kinds), label + ': poked ' + JSON.stringify(kindsOf(hub)));
    expect(hub.pokes.every((a) => a.length === 1 && typeof a[0] === 'string'), label + ': poke(kind) takes the bare kind and nothing else');
    expect(r.pending.length === 1, label + ': one waitUntil');
    return r;
  };
  await run('characters PUT', ['characters'], 'PUT', '/api/characters/' + cid, { user: ALEX, body: { name: 'Invented Scoundrel' } });
  await run('characters PATCH', ['characters'], 'PATCH', '/api/characters/' + cid, { user: ALEX, body: { stress: 2 } });
  await run('characters DELETE', ['characters'], 'DELETE', '/api/characters/' + cid, { user: ALEX });
  await run('campaign PUT (GM)', ['campaign'], 'PUT', '/api/campaign', { user: GM, body: { crew: { name: 'Invented Crew' } } });
  await run('campaign PATCH (GM)', ['campaign'], 'PATCH', '/api/campaign', { user: GM, body: { crew: { heat: 2 } } });
  await run('campaign PATCH (player, own availability)', ['campaign'], 'PATCH', '/api/campaign', { user: ALEX, body: { schedule: { rsvp: { [ALEX]: 'yes' } } } });
  const made = await run('npcs POST', ['npcs'], 'POST', '/api/npcs', { user: GM, body: { name: 'Invented Fence', revealed: false } });
  nid = made.json.id;
  await run('npcs PUT', ['npcs'], 'PUT', '/api/npcs/' + nid, { user: GM, body: { name: 'Invented Fence', role: 'fence', revealed: false } });
  await run('npcs PATCH', ['npcs'], 'PATCH', '/api/npcs/' + nid, { user: GM, body: { role: 'broker' } });
  await run('npcs DELETE', ['npcs'], 'DELETE', '/api/npcs/' + nid, { user: GM });
});

await step('every write path pokes its kind: display PUT, ambient PATCH, stt PATCH (a change pokes; a heartbeat with the same content does not), transcript POST (cue only), portrait-add', async () => {
  const hub = fakeHub();
  const run = async (label, kinds, ...args) => {
    hub.pokes.length = 0;
    const r = await call(hub, ...args);
    expect(r.status >= 200 && r.status < 300, label + ': ' + r.status + ' ' + r.text.slice(0, 200));
    await settle(r);
    expect(same(kindsOf(hub), kinds), label + ': poked ' + JSON.stringify(kindsOf(hub)) + ', wanted ' + JSON.stringify(kinds));
    return r;
  };
  await run('display PUT', ['display'], 'PUT', '/api/gm/display', { user: GM, body: { kind: 'text', text: 'Invented words' } });
  await run('ambient PATCH', ['ambient'], 'PATCH', '/api/gm/ambient', { user: GM, body: { mode: 'pin', scene: 'testcard' } });
  await run('stt PATCH (GM)', ['stt'], 'PATCH', '/api/gm/stt', { user: GM, body: { want: 'on' } });
  await run('stt PATCH (the iPad reports status)', ['stt'], 'PATCH', '/api/gm/stt', { user: IPAD, body: { status: { state: 'listening', lines: 1 } } });
  // only a change pokes: the iPad's heartbeat (same state, a new `at`) and a PATCH that sets what is already stored say nothing
  await run('stt heartbeat, same status', [], 'PATCH', '/api/gm/stt', { user: IPAD, body: { status: { state: 'listening', lines: 1 } } });
  await run('stt heartbeat again', [], 'PATCH', '/api/gm/stt', { user: IPAD, body: { status: { state: 'listening', lines: 1 } } });
  await run('stt want set to what it already is', [], 'PATCH', '/api/gm/stt', { user: GM, body: { want: 'on' } });
  await run('stt removing a speaker that was never named', [], 'PATCH', '/api/gm/stt', { user: GM, body: { speakers: { 3: null } } });
  await run('stt status with one more line', ['stt'], 'PATCH', '/api/gm/stt', { user: IPAD, body: { status: { state: 'listening', lines: 2 } } });
  await run('stt status with a new state', ['stt'], 'PATCH', '/api/gm/stt', { user: IPAD, body: { status: { state: 'error', lines: 2, error: 'invented' } } });
  await run('stt want changes', ['stt'], 'PATCH', '/api/gm/stt', { user: GM, body: { want: 'off' } });
  await run('stt a speaker is named', ['stt'], 'PATCH', '/api/gm/stt', { user: GM, body: { speakers: { 1: 'Invented Voice' } } });
  await run('stt the same name again', [], 'PATCH', '/api/gm/stt', { user: GM, body: { speakers: { 1: 'Invented Voice' } } });
  const line = (id, extra) => ({ id, at: '2030-01-01T09:30:00.000Z', session: '1', conn: 'c1', speaker: 0, kind: 'line', text: 'An invented line.', ...extra });
  await run('transcript POST, no cue', [], 'POST', '/api/gm/transcript', { user: IPAD, body: { lines: [line('t1'), line('t2', { cue: false })] } });
  await run('transcript POST with a cued line (the iPad)', ['cue'], 'POST', '/api/gm/transcript', { user: IPAD, body: { lines: [line('t3'), line('t4', { cue: true })] } });
  await run('transcript POST with a cued line (the GM)', ['cue'], 'POST', '/api/gm/transcript', { user: GM, body: { lines: [line('t5', { cue: true })] } });
  await run('assist portrait-add', ['npcs'], 'POST', '/api/gm/assist/portrait-add', { user: GM, body: { name: 'Invented Face', spec: { head: 1 } } });
});

await step('a refused or failed write, and every read, pokes nothing', async () => {
  const hub = fakeHub();
  const r1 = await call(hub, 'PUT', '/api/characters/char_live_2', { user: ALEX, body: { name: 'Mine' } });
  expect(r1.status === 200, 'setup ' + r1.status);
  hub.pokes.length = 0; hub.attempts = 0;
  const bad = [
    ['player edits another player\'s character', 'PUT', '/api/characters/char_live_2', BEA, { name: 'Taken' }, 403],
    ['player deletes another player\'s character', 'DELETE', '/api/characters/char_live_2', BEA, undefined, 403],
    ['player replaces the campaign', 'PUT', '/api/campaign', ALEX, { crew: {} }, 403],
    ['player creates an NPC', 'POST', '/api/npcs', ALEX, { name: 'x' }, 403],
    ['player writes the display', 'PUT', '/api/gm/display', ALEX, { kind: 'blank' }, 403],
    ['player writes the ambient', 'PATCH', '/api/gm/ambient', ALEX, { mode: 'off' }, 403],
    ['the iPad changes want', 'PATCH', '/api/gm/stt', IPAD, { want: 'on' }, 403],
    ['the iPad writes the display', 'PUT', '/api/gm/display', IPAD, { kind: 'blank' }, 403],
    ['display PUT with a stale ifSeq', 'PUT', '/api/gm/display', GM, { kind: 'blank', ifSeq: 999999 }, 409],
    ['a malformed body', 'PATCH', '/api/campaign', GM, { crew: 'nope' }, 400],
    ['a player portrait-add', 'POST', '/api/gm/assist/portrait-add', ALEX, { name: 'x', spec: {} }, 403],
  ];
  for (const [label, m, p, u, b, want] of bad) {
    const r = await call(hub, m, p, { user: u, body: b });
    await settle(r);
    expect(r.status === want, label + ': expected ' + want + ', got ' + r.status + ' ' + r.text.slice(0, 120));
  }
  for (const [label, p, u] of [['characters', '/api/characters', ALEX], ['campaign', '/api/campaign', ALEX], ['npcs', '/api/npcs', ALEX], ['display', '/api/gm/display', IPAD], ['ambient', '/api/gm/ambient', GM], ['stt', '/api/gm/stt', GM], ['transcript', '/api/gm/transcript?tail=5', GM], ['state', '/api/gm/state', GM]]) {
    const r = await call(hub, 'GET', p, { user: u });
    expect(r.status === 200, 'GET ' + label + ': ' + r.status);
    expect(r.pending.length === 0, 'GET ' + label + ' handed something to waitUntil');
  }
  expect(hub.pokes.length === 0 && hub.attempts === 0, 'poked or reached the object: ' + JSON.stringify(kindsOf(hub)));
  const st = await call(hub, 'PATCH', '/api/gm/state', { user: GM, body: { live: true } });
  expect(st.status === 200 && st.pending.length === 0 && hub.attempts === 0, 'the GM state is not a kind');
});

// ---------- the object down ----------
await step('the object down: the write answers 200 with its body, the poke WAS attempted, and a poke that never answers does not hold the answer', async () => {
  for (const mode of ['getThrows', 'idThrows', 'rejects', 'hangs']) {
    const hub = fakeHub(mode);
    const r = await call(hub, 'PUT', '/api/gm/display', { user: GM, body: { kind: 'text', text: 'Down check ' + mode } });
    expect(r.status === 200 && r.json && r.json.display && r.json.display.text === 'Down check ' + mode, mode + ': the write still answers: ' + r.status + ' ' + r.text.slice(0, 120));
    expect(r.answeredMs < 1000, mode + ': the answer was not delayed (' + r.answeredMs + ' ms)');
    expect(r.pending.length === 1, mode + ': the poke was handed to waitUntil');
    if (mode === 'hangs') { expect(hub.pokes.length === 1, 'hangs: poke() was called'); continue; }   // its promise stays pending, as waitUntil would hold it
    await settle(r);   // logged and dropped: nothing may reject
    const outcomes = await Promise.allSettled(r.pending);
    expect(outcomes.every((o) => o.status === 'fulfilled'), mode + ': the dropped poke must not reject the waitUntil promise');
    if (mode === 'getThrows') expect(hub.attempts === 1 && hub.pokes.length === 0, 'get() was tried: ' + hub.attempts);
    if (mode === 'idThrows') expect(hub.names.length === 1, 'idFromName was tried');
    if (mode === 'rejects') expect(hub.pokes.length === 1, 'poke() was tried');
  }
  const all = await call(fakeHub('rejects'), 'POST', '/api/npcs', { user: GM, body: { name: 'Invented Down', revealed: false } });
  expect(all.status === 200 && all.json.id, 'npcs POST with a rejecting object');
  const unbound = await call(null, 'PATCH', '/api/campaign', { user: GM, body: { crew: { heat: 3 } } });
  expect(unbound.status === 200 && unbound.pending.length === 0, 'no LIVE binding at all: the write answers and nothing is queued');
  // no ctx.waitUntil at all (a context that has none): still answers, no unhandled rejection
  const env = { DEV_USER: GM, GM_EMAILS: GM, DB, CAMPAIGN: 'livecheck', LIVE: fakeHub('rejects').LIVE };
  const bare = await worker.fetch(new Request('http://127.0.0.1:8788/api/gm/display', { method: 'PUT', headers: { 'X-Dev-User': GM, 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'blank' }) }), env, {});
  expect(bare.status === 200, 'no waitUntil: ' + bare.status);
});

await step('the switch going off closes the sockets server-side: only on the flip from on or absent to false, never on other GM state writes', async () => {
  const hub = fakeHub();
  const state = async (body) => { const r = await call(hub, 'PATCH', '/api/gm/state', { user: GM, body }); expect(r.status === 200, 'state PATCH ' + r.status + ' ' + r.text.slice(0, 100)); await settle(r); return r; };
  await state({ live: true });               // make the start explicit: on
  const c0 = hub.closes;
  await state({ ui: { tab: 'A' } });         expect(hub.closes === c0, 'an unrelated state write closes nothing');
  await state({ live: true });               expect(hub.closes === c0, 'on to on closes nothing');
  const off = await state({ live: false });  expect(hub.closes === c0 + 1 && off.pending.length === 1, 'on to off closes once, through waitUntil: ' + (hub.closes - c0));
  await state({ live: false });              expect(hub.closes === c0 + 1, 'off to off closes nothing');
  await state({ ui: { tab: 'B' } });         expect(hub.closes === c0 + 1, 'a write that leaves the switch off closes nothing');
  await state({ live: true });               expect(hub.closes === c0 + 1, 'off to on closes nothing');
  await state({ live: false });              expect(hub.closes === c0 + 2, 'and off again closes again');
  await state({ live: null });               expect(hub.closes === c0 + 2, 'deleting the key (back to on) closes nothing');
  await state({ live: false });              expect(hub.closes === c0 + 3, 'absent to false (after the key was deleted) is a flip');
  await state({ live: true });
  // not a flip when the patch is refused
  const bad = await call(hub, 'PATCH', '/api/gm/state', { user: ALEX, body: { live: false } });
  expect(bad.status === 403 && hub.closes === c0 + 3, 'a player cannot flip it: ' + bad.status);
  // the object down: the write still answers, the call WAS attempted, nothing rejects
  for (const mode of ['getThrows', 'idThrows', 'rejects', 'hangs']) {
    const down = fakeHub(mode);
    await call(down, 'PATCH', '/api/gm/state', { user: GM, body: { live: true } });
    const r = await call(down, 'PATCH', '/api/gm/state', { user: GM, body: { live: false } });
    expect(r.status === 200 && r.json.doc.live === false && r.answeredMs < 1000, mode + ': answers ' + r.status);
    expect(r.pending.length === 1, mode + ': handed to waitUntil');
    if (mode === 'rejects' || mode === 'hangs') expect(down.closes === 1, mode + ': closeAll was called');
    if (mode === 'getThrows') expect(down.attempts === 1, 'get() was tried');
    if (mode !== 'hangs') expect((await Promise.allSettled(r.pending)).every((o) => o.status === 'fulfilled'), mode + ': the dropped call does not reject');
  }
  const unbound = await call(null, 'PATCH', '/api/gm/state', { user: GM, body: { live: true } });
  const u2 = await call(null, 'PATCH', '/api/gm/state', { user: GM, body: { live: false } });
  expect(unbound.status === 200 && u2.status === 200 && u2.pending.length === 0, 'no binding: the flip answers and queues nothing');
  await call(null, 'PATCH', '/api/gm/state', { user: GM, body: { live: null } });   // leave the switch absent (on) for the steps after this one
});

await step('gate d.1: the player stamp does not depend on the #gm row: GM state writes that leave live alone keep campaignUpdatedAt, npcsUpdatedAt and live; only a flip changes the answer', async () => {
  const hub = fakeHub();
  await call(hub, 'PUT', '/api/campaign', { user: GM, body: { crew: { name: 'Invented Stamp Crew' } } });
  await call(hub, 'POST', '/api/npcs', { user: GM, body: { name: 'Invented Stamp Fence', revealed: true } });
  const first = (await call(hub, 'GET', '/api/characters', { user: ALEX })).json;
  expect(first.campaignUpdatedAt && first.npcsUpdatedAt && first.live === true, 'a stamp to poll with: ' + JSON.stringify(first).slice(0, 160));
  const before = (await call(hub, 'GET', '/api/characters?since=' + encodeURIComponent(first.now), { user: ALEX })).json;   // the 2 s overlap may redeliver a recent row: compare like with like
  const stateAt = [];
  for (let i = 0; i < 3; i++) {
    const w = await call(hub, 'PATCH', '/api/gm/state', { user: GM, body: { ui: { tab: 'stamp' + i }, capture: { ['k' + i]: 'x' } } });
    expect(w.status === 200, 'state write ' + w.status);
    stateAt.push(w.json.updatedAt);
  }
  const next = (await call(hub, 'GET', '/api/characters?since=' + encodeURIComponent(first.now), { user: ALEX })).json;
  expect(next.campaignUpdatedAt === first.campaignUpdatedAt && next.npcsUpdatedAt === first.npcsUpdatedAt, 'the stamps did not move: ' + first.campaignUpdatedAt + ' / ' + next.campaignUpdatedAt);
  expect(next.live === true && JSON.stringify(next.docs) === JSON.stringify(before.docs), 'nothing else moved: ' + JSON.stringify(next).slice(0, 200));
  expect(stateAt.every((a) => !JSON.stringify(next).includes(a)), 'the #gm row updatedAt appears nowhere in the answer a player gets');
  const flip = await call(hub, 'PATCH', '/api/gm/state', { user: GM, body: { live: false } });
  const after = (await call(hub, 'GET', '/api/characters?since=' + encodeURIComponent(first.now), { user: ALEX })).json;
  expect(after.live === false && after.campaignUpdatedAt === first.campaignUpdatedAt && !JSON.stringify(after).includes(flip.json.updatedAt), 'a flip changes live and nothing else: ' + JSON.stringify(after).slice(0, 200));
  await call(hub, 'PATCH', '/api/gm/state', { user: GM, body: { live: null } });
});

await step('gate d.2: live:false survives every writer of the GM state: no path replaces the document, so an older-shaped whole-state write cannot bring back "absent = on"', async () => {
  // the only writers of a campaigns row are writeCampaign (id = CAMPAIGN, never the #gm row) and patchState (deepMerge)
  const writers = [];
  const walk = (dir) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) { if (f.name !== 'node_modules') walk(p); }
    else if (/\.(js|mjs|cjs|sh)$/.test(f.name) && /INSERT INTO campaigns|UPDATE campaigns|REPLACE INTO campaigns|DELETE FROM campaigns/i.test(fs.readFileSync(p, 'utf8'))) writers.push(path.relative(ROOT, p).split(path.sep).join('/'));
  } };
  for (const d of ['functions', 'worker', 'scripts', 'tools', 'app']) if (fs.existsSync(path.join(ROOT, d))) walk(path.join(ROOT, d));
  expect(same(writers.sort(), ['functions/_lib/campaign.js', 'functions/_lib/gm.js', 'scripts/lib/tap-sim.mjs']), 'writers of campaigns rows: ' + JSON.stringify(writers));
  const hub = fakeHub();
  const off = await call(hub, 'PATCH', '/api/gm/state', { user: GM, body: { live: false } });
  expect(off.status === 200 && off.json.doc.live === false, 'page A turns it off');
  const closesAfterFlip = hub.closes;
  const stored = (await call(hub, 'GET', '/api/gm/state', { user: GM })).json.doc;
  const seen = async (label) => {
    const st = (await call(hub, 'GET', '/api/gm/state', { user: GM })).json.doc;
    const ch = (await call(hub, 'GET', '/api/characters', { user: ALEX })).json;
    const d = (await call(hub, 'GET', '/api/gm/display', { user: IPAD })).json;
    expect(st.live === false && ch.live === false && d.live === false, label + ': live is still false (state ' + st.live + ', phones ' + ch.live + ', display ' + d.live + ')');
  };
  // an older client: its whole copy of the state, with no live key, sent back as one patch (what a stale page, a page left open
  // across the deploy, the offline resend or a script holding the document would send)
  const whole = JSON.parse(JSON.stringify(stored)); delete whole.live;
  whole.ui = { tab: 'old' }; whole.con = { live: { a: 1 } }; whole.cards = { location: { hid: 'h1' } }; whole.mem = { console: {} };
  let w = await call(hub, 'PATCH', '/api/gm/state', { user: GM, body: whole });
  expect(w.status === 200, 'whole copy: ' + w.status); await seen('a whole-state patch with no live key');
  // the page's own replacing patches (replacePatch: nulls for the keys only the old copy had) are nested; none reaches the top level
  w = await call(hub, 'PATCH', '/api/gm/state', { user: GM, body: { cards: { location: { hid: null, extra: 1 } }, ball: { a: null }, sites: { s1: { x: 1 } }, hist: { location: null } } });
  expect(w.status === 200, 'nested replace: ' + w.status); await seen('nested replacing patches');
  w = await call(hub, 'PATCH', '/api/gm/state', { user: GM, body: {} });
  expect(w.status === 200, 'empty patch'); await seen('an empty patch');
  // a second flip request that says false again, and the unrelated writes: no further close
  expect(hub.closes === closesAfterFlip, 'none of those closed anything');
  // the only ways to change it are a patch that names it: true turns it on, null deletes it
  await call(hub, 'PATCH', '/api/gm/state', { user: GM, body: { live: true } });
  expect((await call(hub, 'GET', '/api/characters', { user: ALEX })).json.live === true, 'a patch that names it can turn it on');
});

// ---------- the route ----------
const upgrade = (user, extra) => ({ user, headers: { Upgrade: 'websocket', Connection: 'Upgrade', ...(extra || {}) } });
await step('/api/live: every role reaches the object with ITS role in the header; a client-sent role header is overwritten; the 101 is untouched', async () => {
  for (const [who, user] of [['gm', GM], ['player', ALEX], ['display', IPAD]]) {
    const hub = fakeHub();
    const r = await call(hub, 'GET', '/api/live', upgrade(user));
    expect(r.status === 101, who + ': expected 101, got ' + r.status);
    expect(hub.forwarded.length === 1, who + ': one request to the object');
    const f = hub.forwarded[0];
    expect(f.headers.get(ROLE_HEADER) === who, who + ': the object saw role ' + f.headers.get(ROLE_HEADER));
    expect(f.headers.get('Upgrade') === 'websocket', who + ': upgrade kept');
    expect(hub.names.length === 1 && hub.names[0] === 'livecheck', who + ': idFromName(campaign)');
  }
  const hub = fakeHub();
  const spoof = await call(hub, 'GET', '/api/live', upgrade(ALEX, { [ROLE_HEADER]: 'gm' }));
  expect(spoof.status === 101 && hub.forwarded[0].headers.get(ROLE_HEADER) === 'player', 'a player who sends the role header still arrives as player: ' + hub.forwarded[0].headers.get(ROLE_HEADER));
  expect(![...hub.forwarded[0].headers.keys()].some((k) => /cookie|authorization|cf-access|x-dev-user/i.test(k)), 'none of the caller\'s credentials are forwarded');
});

await step('/api/live: anonymous is 401 with the object untouched; 426 without an upgrade (every role); 503 when unbound', async () => {
  const hub = fakeHub();
  const pending = [];
  const anon = await worker.fetch(new Request('http://blades.example.test/api/live', { headers: { Upgrade: 'websocket' } }), { LIVE: hub.LIVE, CAMPAIGN: 'livecheck', GM_EMAILS: GM, DB }, { waitUntil: (p) => pending.push(p) });
  expect(anon.status === 401 && hub.attempts === 0 && hub.names.length === 0 && hub.forwarded.length === 0, 'anonymous: ' + anon.status);
  for (const user of [GM, ALEX, IPAD]) {
    const r = await call(hub, 'GET', '/api/live', { user });
    expect(r.status === 426 && hub.forwarded.length === 0 && hub.attempts === 0, user + ': plain GET ' + r.status);
  }
  const unbound = await call(null, 'GET', '/api/live', upgrade(ALEX));
  expect(unbound.status === 503, 'no binding: ' + unbound.status);
  const wrongMethod = await call(hub, 'POST', '/api/live', upgrade(IPAD));
  expect(wrongMethod.status === 403, 'the display may only GET it: ' + wrongMethod.status);
});

// ---------- the switch ----------
const reads = async (fn) => { const before = exec.calls; const out = await fn(); return { out, calls: exec.calls - before }; };

await step('the switch: on by default; GET /api/characters carries it in the poll it already makes, with no extra read (3 D1 calls, as before)', async () => {
  const hub = fakeHub();
  const { out: r, calls } = await reads(() => call(hub, 'GET', '/api/characters', { user: ALEX }));
  expect(r.status === 200 && r.json.live === true, 'live is true with no state row: ' + r.text.slice(0, 160));
  expect(calls === 3, 'the data poll makes 3 D1 calls (it made 3 before the switch): ' + calls);
  const since = await call(hub, 'GET', '/api/characters?since=2000-01-01T00:00:00.000Z', { user: BEA });
  expect(since.json.live === true && 'campaignUpdatedAt' in since.json && 'npcsUpdatedAt' in since.json, 'the ?since form carries it too');
  const stamp = exec.log.filter((s) => /json_type\(doc, '\$\.live'\)/.test(s));
  expect(stamp.length >= 2 && stamp.every((s) => /CASE WHEN json_valid\(doc\) THEN json_type\(doc, '\$\.live'\) END/.test(s)), 'the switch is read with json_type in SQL, guarded by json_valid: ' + stamp.length);
  const bare = exec.log.slice(-6).filter((s) => /FROM campaigns/i.test(s)).filter((s) => /\bdoc\b/.test(s.replace(/json_valid\(doc\)|json_type\(doc, '\$\.live'\)/g, '')));
  expect(bare.length === 0, 'no statement of the poll loads a campaigns document: ' + bare.join(' | '));
});

await step('the switch: the GM sets it in the GM state (PATCH /api/gm/state { live }); false reaches the phone poll and the display answers; only an explicit false turns it off', async () => {
  const hub = fakeHub();
  const off = await call(hub, 'PATCH', '/api/gm/state', { user: GM, body: { live: false } });
  expect(off.status === 200 && off.json.doc.live === false, 'stored: ' + off.text.slice(0, 100));
  const chars = await call(hub, 'GET', '/api/characters', { user: ALEX });
  expect(chars.json.live === false, 'phone poll: ' + chars.json.live);
  const gmChars = await call(hub, 'GET', '/api/characters?since=2000-01-01T00:00:00.000Z', { user: GM });
  expect(gmChars.json.live === false, 'GM page poll');
  // the display: the first full answer, the sseq form (stale and current), all carry it; the seq-only call is byte-for-byte what it was
  const first = await call(hub, 'GET', '/api/gm/display', { user: IPAD });
  expect(first.status === 200 && first.json.live === false, 'display, first full answer: ' + first.text.slice(0, 120));
  const { seq } = first.json, aseq = first.json.ambient.seq, sseq = first.json.stt.seq;
  const stale = await call(hub, 'GET', '/api/gm/display?seq=0&aseq=0&sseq=0', { user: IPAD });
  expect(stale.json.live === false && stale.json.stt && stale.json.ambient, 'display, stale seqs: live ' + stale.json.live);
  const current = await call(hub, 'GET', '/api/gm/display?seq=' + seq + '&aseq=' + aseq + '&sseq=' + sseq, { user: IPAD });
  expect(current.json.unchanged === true && current.json.live === false, 'display, everything current: the flip still lands: ' + current.text.slice(0, 160));
  const oldest = await call(hub, 'GET', '/api/gm/display?seq=' + seq, { user: IPAD });
  expect(oldest.text === JSON.stringify({ seq, unchanged: true }), 'the oldest seq-only call is byte-for-byte unchanged: ' + oldest.text);
  const gmDisp = await call(hub, 'GET', '/api/gm/display?seq=' + seq + '&aseq=' + aseq + '&sseq=' + sseq, { user: GM });
  expect(gmDisp.json.live === false, 'the GM page reads the same answer');
  // a /api/live upgrade is refused while it is off, with the object untouched
  const attemptsBefore = hub.attempts;
  const refused = await call(hub, 'GET', '/api/live', upgrade(ALEX));
  expect(refused.status === 503 && hub.attempts === attemptsBefore && hub.forwarded.length === 0, 'switched off: no socket (' + refused.status + ')');
  // back on, and only an explicit false is off
  for (const [stored, expected] of [[true, true], [null, true], ['no', true], [0, true], [false, false]]) {
    await call(hub, 'PATCH', '/api/gm/state', { user: GM, body: { live: stored } });
    const r = await call(hub, 'GET', '/api/characters', { user: ALEX });
    expect(r.json.live === expected, 'stored ' + JSON.stringify(stored) + ' -> ' + r.json.live + ', wanted ' + expected);
  }
  await call(hub, 'PATCH', '/api/gm/state', { user: GM, body: { live: true } });
  const on = await call(hub, 'GET', '/api/live', upgrade(ALEX));
  expect(on.status === 101, 'back on: the socket opens again (' + on.status + ')');
});

await step('the switch costs the display poll one small read, and none on the seq-only call', async () => {
  const hub = fakeHub();
  const first = (await call(hub, 'GET', '/api/gm/display', { user: IPAD })).json;
  const url = '/api/gm/display?seq=' + first.seq + '&aseq=' + first.ambient.seq + '&sseq=' + first.stt.seq;
  const mark = exec.log.length;
  const withSwitch = await reads(() => call(hub, 'GET', url, { user: IPAD }));
  const lines = exec.log.slice(mark);
  const flagReads = lines.filter((s) => /json_type\(doc, '\$\.live'\)/.test(s));
  expect(flagReads.length === 1, 'exactly one statement reads the switch: ' + flagReads.length);
  expect(/FROM campaigns WHERE id = '[^']*#gm'/.test(flagReads[0]) && /AS live/.test(flagReads[0]), 'it is a one-key read of the GM state row: ' + flagReads[0]);
  const oldest = await reads(() => call(hub, 'GET', '/api/gm/display?seq=' + first.seq, { user: IPAD }));
  expect(oldest.calls === 1, 'the seq-only call still reads only the display row (1 call): ' + oldest.calls);
  expect(withSwitch.calls >= 2 && withSwitch.calls <= 6, 'the sseq call stays small: ' + withSwitch.calls);
});

console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
