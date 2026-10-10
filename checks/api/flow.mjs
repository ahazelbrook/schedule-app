// End-to-end check of the API against a local `wrangler pages dev` (see HOSTING.md).
//
//   node checks/api/flow.mjs            (or: npm run check:api)
//
// Starts its own dev server on PORT (default 8788) with DEV_USER set and a throwaway D1
// state directory, plus a second one on PORT+1 without DEV_USER for the 401 checks.
// Prints PASS/FAIL per step, exits non-zero on any failure, always stops the servers.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 8788);
const PORT2 = PORT + 1;
const GM = 'gm@example.test';
const PLAYER = 'player@example.test';
const OVERALL_TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS || 180000);

const servers = [];
const stateDir = mkdtempSync(join(tmpdir(), 'b68-api-check-'));
let failures = 0;
let passes = 0;

function startServer(port, bindings) {
  const bin = join(ROOT, 'node_modules', '.bin', 'wrangler');
  const args = ['pages', 'dev', 'app', '--port', String(port), '--ip', '127.0.0.1',
    '--inspector-port', String(port + 20000), '--show-interactive-dev-session', 'false',
    '--persist-to', join(stateDir, 'p' + port), '--log-level', 'warn'];
  for (const [k, v] of Object.entries(bindings)) args.push('--binding', k + '=' + v);
  const child = spawn(bin, args, {
    cwd: ROOT,
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
    detached: true, // own process group, so workerd dies with it
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  const s = { child, port, log: () => log };
  servers.push(s);
  return s;
}

function signalServers(sig) {
  for (const s of servers) {
    // signal the whole process group (wrangler and its workerd), even if wrangler is gone
    try { process.kill(-s.child.pid, sig); } catch (_) {}
  }
}

// SIGTERM, wait up to 5 s for the servers to exit, then SIGKILL whatever is left.
async function stopServers() {
  signalServers('SIGTERM');
  const until = Date.now() + 5000;
  while (Date.now() < until && servers.some((s) => s.child.exitCode === null && s.child.signalCode === null)) {
    await new Promise((r) => setTimeout(r, 100));
  }
  signalServers('SIGKILL');
  try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {}
}

process.on('exit', () => signalServers('SIGKILL'));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, async () => { await stopServers(); process.exit(130); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(s) {
  const until = Date.now() + 90000;
  while (Date.now() < until) {
    if (s.child.exitCode !== null) throw new Error('server on ' + s.port + ' exited:\n' + s.log());
    try {
      const r = await fetch('http://127.0.0.1:' + s.port + '/index.html', { signal: AbortSignal.timeout(2000) });
      if (r.status > 0) return;
    } catch (_) {}
    await sleep(500);
  }
  throw new Error('server on ' + s.port + ' did not start:\n' + s.log());
}

async function call(port, method, path, { user, body, raw, headers = {} } = {}) {
  const h = { ...headers };
  if (user) h['X-Dev-User'] = user;
  let payload;
  if (raw !== undefined) { payload = raw; h['Content-Type'] = 'application/json'; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch('http://127.0.0.1:' + port + path, { method, headers: h, body: payload });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, json, text, headers: r.headers };
}
const api = (method, path, opts) => call(PORT, method, path, opts);

async function step(name, fn) {
  try {
    await fn();
    passes++;
    console.log('PASS ' + name);
  } catch (e) {
    failures++;
    console.log('FAIL ' + name + '\n     ' + (e && e.message || e));
  }
}

function expect(cond, msg) { if (!cond) throw new Error(msg); }
function expectStatus(r, status) {
  expect(r.status === status, 'expected ' + status + ', got ' + r.status + ' ' + r.text.slice(0, 300));
}

function sampleDoc(name, extra = {}) {
  return {
    v: 2, name, alias: '', code: '', playbook: 'hound', playbookName: 'Hound',
    spec: { body: 1 }, sheet: { name, dots: { Hunt: 2 } },
    play: {
      stress: 1, xp: { playbook: 0, insight: 1 },
      keys: [{ name: 'Sardonic', down: 'Grim', up: 'Witty', hits: 2, deadlock: null }],
      harm: { l1: ['', ''], l2: ['', ''], l3: '', l4: '' },
      notes: 'remove me',
    },
    owner: 'someone-else@example.test',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z',
    ...extra,
  };
}

async function main() {
  const s1 = startServer(PORT, { DEV_USER: GM, GM_EMAILS: GM, CAMPAIGN: 'check' });
  const s2 = startServer(PORT2, { GM_EMAILS: GM });
  await Promise.all([waitReady(s1), waitReady(s2)]);
  console.log('servers up on ' + PORT + ' (DEV_USER) and ' + PORT2 + ' (no DEV_USER)');

  await step('GET /api/me as gm (DEV_USER), no-store', async () => {
    const r = await api('GET', '/api/me');
    expectStatus(r, 200);
    expect(r.json.id === GM && r.json.email === GM && r.json.role === 'gm', JSON.stringify(r.json));
    expect(r.json.campaign === 'check', 'campaign ' + r.json.campaign);
    expect(typeof r.json.name === 'string' && r.json.name, 'name');
    expect(r.headers.get('cache-control') === 'no-store', 'cache-control ' + r.headers.get('cache-control'));
  });

  await step('GET /api/me as player (X-Dev-User)', async () => {
    const r = await api('GET', '/api/me', { user: PLAYER });
    expectStatus(r, 200);
    expect(r.json.id === PLAYER && r.json.role === 'player', JSON.stringify(r.json));
  });

  let created;
  await step('player creates a character (PUT): owner forced, timestamps stamped', async () => {
    const before = new Date().toISOString();
    const r = await api('PUT', '/api/characters/hero-1', { user: PLAYER, body: sampleDoc('Hero') });
    expectStatus(r, 200);
    created = r.json.doc;
    expect(r.json.id === 'hero-1', 'id');
    expect(created.owner === PLAYER, 'owner ' + created.owner);
    expect(created.createdAt === '2026-01-01T00:00:00.000Z', 'createdAt kept when given');
    expect(created.updatedAt >= before, 'updatedAt stamped by server: ' + created.updatedAt);
    expect(created.play.keys.length === 1 && created.v === 2, 'doc body');
  });

  await step('player creates without createdAt: server stamps it', async () => {
    const d = sampleDoc('Second'); delete d.createdAt;
    const r = await api('PUT', '/api/characters/hero-2', { user: PLAYER, body: d });
    expectStatus(r, 200);
    expect(r.json.doc.createdAt === r.json.doc.updatedAt, JSON.stringify([r.json.doc.createdAt, r.json.doc.updatedAt]));
  });

  await step('GET /api/characters lists live docs, newest first', async () => {
    const r = await api('GET', '/api/characters', { user: PLAYER });
    expectStatus(r, 200);
    expect(typeof r.json.now === 'string' && !Number.isNaN(Date.parse(r.json.now)), 'now');
    const ids = r.json.docs.map((d) => d.id);
    expect(ids.join(',') === 'hero-2,hero-1', 'ids ' + ids);
    const e = r.json.docs[1];
    expect(e.deleted === false && e.doc.name === 'Hero' && e.updatedAt === created.updatedAt, JSON.stringify(e).slice(0, 200));
  });

  await step('GET /api/characters/:id', async () => {
    const r = await api('GET', '/api/characters/hero-1', { user: GM });
    expectStatus(r, 200);
    expect(r.json.id === 'hero-1' && r.json.doc.name === 'Hero', JSON.stringify(r.json).slice(0, 200));
  });

  let since;
  await step('since: no change -> empty', async () => {
    await sleep(2300); // past the server's poll overlap window
    const r0 = await api('GET', '/api/characters');
    since = r0.json.now;
    const r = await api('GET', '/api/characters?since=' + encodeURIComponent(since));
    expectStatus(r, 200);
    expect(r.json.docs.length === 0, 'expected no rows, got ' + r.json.docs.map((d) => d.id));
  });

  await step('PATCH deep merge: play.stress changes, play.keys survives, null deletes', async () => {
    const r = await api('PATCH', '/api/characters/hero-1', {
      user: PLAYER,
      body: { play: { stress: 4, xp: { insight: 2 }, notes: null }, owner: 'thief@example.test', tags: ['a'] },
    });
    expectStatus(r, 200);
    const p = r.json.doc.play;
    expect(p.stress === 4, 'stress ' + p.stress);
    expect(Array.isArray(p.keys) && p.keys[0].name === 'Sardonic' && p.keys[0].hits === 2, 'keys ' + JSON.stringify(p.keys));
    expect(p.xp.insight === 2 && p.xp.playbook === 0, 'xp ' + JSON.stringify(p.xp));
    expect(!('notes' in p), 'notes should be deleted');
    expect(p.harm.l1.length === 2, 'harm kept');
    expect(r.json.doc.owner === PLAYER, 'owner kept: ' + r.json.doc.owner);
    expect(r.json.doc.tags[0] === 'a' && r.json.doc.createdAt === created.createdAt, 'tags / createdAt');
    expect(r.json.doc.updatedAt > created.updatedAt, 'updatedAt moved');
  });

  await step('since: one change -> one row', async () => {
    const r = await api('GET', '/api/characters?since=' + encodeURIComponent(since));
    expectStatus(r, 200);
    expect(r.json.docs.length === 1 && r.json.docs[0].id === 'hero-1', 'rows ' + JSON.stringify(r.json.docs.map((d) => d.id)));
    expect(r.json.docs[0].doc.play.stress === 4 && r.json.docs[0].deleted === false, 'row content');
  });

  await step('concurrent PATCHes on different fields all survive', async () => {
    const rs = await Promise.all([0, 1, 2, 3, 4, 5].map((i) =>
      api('PATCH', '/api/characters/hero-2', { user: i % 2 ? PLAYER : GM, body: { play: { marks: { ['m' + i]: i } } } })));
    for (const r of rs) expectStatus(r, 200);
    const g = await api('GET', '/api/characters/hero-2');
    const marks = g.json.doc.play.marks || {};
    expect([0, 1, 2, 3, 4, 5].every((i) => marks['m' + i] === i), 'marks ' + JSON.stringify(marks));
  });

  await step('gm overwrites the player\'s doc (PUT); stored owner kept', async () => {
    const r = await api('PUT', '/api/characters/hero-1', { body: sampleDoc('Hero (GM edit)', { owner: GM }) });
    expectStatus(r, 200);
    expect(r.json.doc.name === 'Hero (GM edit)' && r.json.doc.owner === PLAYER, JSON.stringify([r.json.doc.name, r.json.doc.owner]));
    const g = await api('GET', '/api/characters/hero-1', { user: PLAYER });
    expect(g.json.doc.play.stress === 1, 'replaced, not merged');
  });

  await step('gm creates an NPC (owner from body)', async () => {
    const r = await api('PUT', '/api/characters/gm-npc', { body: sampleDoc('NPC', { owner: GM }) });
    expectStatus(r, 200);
    expect(r.json.doc.owner === GM, 'owner ' + r.json.doc.owner);
  });

  await step('player cannot overwrite the gm-owned doc (PUT 403)', async () => {
    const r = await api('PUT', '/api/characters/gm-npc', { user: PLAYER, body: sampleDoc('Stolen') });
    expectStatus(r, 403);
    expect(r.json.error === 'you can only change characters you own', r.text);
  });

  await step('player cannot patch the gm-owned doc (PATCH 403)', async () => {
    const r = await api('PATCH', '/api/characters/gm-npc', { user: PLAYER, body: { play: { stress: 9 } } });
    expectStatus(r, 403);
  });

  await step('player cannot delete another\'s doc (DELETE 403)', async () => {
    const r = await api('DELETE', '/api/characters/gm-npc', { user: PLAYER });
    expectStatus(r, 403);
    expect(r.json.error === 'you can only change characters you own', r.text);
    const g = await api('GET', '/api/characters/gm-npc');
    expectStatus(g, 200);
  });

  await step('PATCH on a missing doc -> 404', async () => {
    const r = await api('PATCH', '/api/characters/nobody', { user: PLAYER, body: { play: { stress: 1 } } });
    expectStatus(r, 404);
  });

  let sinceDel;
  await step('delete -> { ok: true }, GET 404, gone from the full list', async () => {
    await sleep(2300);
    sinceDel = (await api('GET', '/api/characters')).json.now;
    const r = await api('DELETE', '/api/characters/hero-1', { user: PLAYER });
    expectStatus(r, 200);
    expect(r.json.ok === true, r.text);
    const g = await api('GET', '/api/characters/hero-1', { user: PLAYER });
    expectStatus(g, 404);
    const l = await api('GET', '/api/characters');
    expect(!l.json.docs.some((d) => d.id === 'hero-1'), 'still listed');
    const again = await api('DELETE', '/api/characters/hero-1', { user: PLAYER });
    expectStatus(again, 404);
  });

  await step('since-poll reports the tombstone', async () => {
    const r = await api('GET', '/api/characters?since=' + encodeURIComponent(sinceDel));
    expectStatus(r, 200);
    const t = r.json.docs.find((d) => d.id === 'hero-1');
    expect(t && t.deleted === true && t.doc === null && typeof t.updatedAt === 'string', JSON.stringify(r.json.docs));
    expect(r.json.docs.length === 1, 'only the tombstone: ' + r.json.docs.map((d) => d.id));
  });

  await step('PUT over a tombstone re-creates it', async () => {
    const r = await api('PUT', '/api/characters/hero-1', { user: PLAYER, body: sampleDoc('Hero reborn') });
    expectStatus(r, 200);
    expect(r.json.doc.owner === PLAYER, 'owner');
    const g = await api('GET', '/api/characters/hero-1');
    expect(g.status === 200 && g.json.doc.name === 'Hero reborn', g.text.slice(0, 200));
  });

  await step('bad ids -> 400', async () => {
    for (const p of ['/api/characters/bad.id', '/api/characters/bad%20id', '/api/characters/' + 'x'.repeat(81)]) {
      const r = await api('GET', p);
      expectStatus(r, 400);
      expect(r.json && typeof r.json.error === 'string', 'json error for ' + p);
    }
    const r = await api('PUT', '/api/characters/no%24pe', { body: sampleDoc('x') });
    expectStatus(r, 400);
  });

  await step('bad bodies and bad since -> 400', async () => {
    expectStatus(await api('PUT', '/api/characters/hero-3', { raw: '{nope' }), 400);
    expectStatus(await api('PUT', '/api/characters/hero-3', { raw: '[1,2]' }), 400);
    expectStatus(await api('GET', '/api/characters?since=yesterday-ish'), 400);
  });

  await step('oversize body -> 413', async () => {
    const big = sampleDoc('Big', { blob: 'x'.repeat(300 * 1024) });
    const r = await api('PUT', '/api/characters/big-one', { body: big });
    expectStatus(r, 413);
    expect(r.json && r.json.error, r.text.slice(0, 200));
    expectStatus(await api('GET', '/api/characters/big-one'), 404);
  });

  await step('unknown /api path -> JSON 404', async () => {
    const r = await api('GET', '/api/nope');
    expectStatus(r, 404);
    expect(r.json && r.json.error, r.text.slice(0, 200));
  });

  await step('invalid Access token -> 401 even with DEV_USER set', async () => {
    const r = await api('GET', '/api/me', { headers: { 'Cf-Access-Jwt-Assertion': 'garbage.token.here' } });
    expectStatus(r, 401);
    expect(r.json.error === 'not signed in', r.text);
  });

  await step('no identity (server without DEV_USER) -> 401; X-Dev-User ignored', async () => {
    const a = await call(PORT2, 'GET', '/api/me');
    expectStatus(a, 401);
    expect(a.json.error === 'not signed in', a.text);
    expect(a.headers.get('cache-control') === 'no-store', 'no-store on 401');
    const b = await call(PORT2, 'GET', '/api/characters', { user: GM });
    expectStatus(b, 401);
    const c = await call(PORT2, 'PUT', '/api/characters/x', { user: GM, body: sampleDoc('x') });
    expectStatus(c, 401);
  });

  await campaignSteps();

  await step('GET /api/members lists both', async () => {
    const r = await api('GET', '/api/members', { user: PLAYER });
    expectStatus(r, 200);
    const byId = Object.fromEntries(r.json.members.map((m) => [m.id, m]));
    expect(byId[GM] && byId[GM].role === 'gm' && byId[GM].name, 'gm ' + JSON.stringify(byId[GM]));
    expect(byId[PLAYER] && byId[PLAYER].role === 'player', 'player ' + JSON.stringify(byId[PLAYER]));
    expect(r.json.members.length === 2, 'count ' + r.json.members.length);
  });
}

// ---------- /api/campaign (CAMPAIGN.md) ----------

const GM_ONLY = 'only the GM can change that';

function sampleCampaign() {
  return {
    v: 1,
    session: { number: 3, startedAt: '2026-10-01T19:00:00.000Z', endedAt: null },
    crew: {
      name: 'The Lamplighters', type: 'shadows', lair: 'Canal warehouse', notes: '',
      tier: 1, hold: 'strong', rep: 4, turf: 1, heat: 2, wanted: 0, vault: 3,
      claims: [{ name: 'Lair', held: true }, { name: 'Turf', held: false }],
      cohorts: [{ name: 'Rooks', type: 'gang', edges: '', flaws: '', harm: null, armor: false }],
      factions: [{ name: 'Bluecoats', status: -1 }],
    },
    clocks: [
      { id: 'c_one', name: 'Alarm', size: 4, filled: 1, kind: 'danger', hidden: false },
      { id: 'c_two', name: 'Fence', size: 6, filled: 0, kind: 'project', hidden: true },
    ],
    log: [
      { at: '2026-10-01T20:00:00.000Z', by: GM, text: 'second' },
      { at: '2026-10-01T19:00:00.000Z', by: GM, text: 'first' },
    ],
    updatedAt: '2000-01-01T00:00:00.000Z',
  };
}

async function campaignSteps() {
  const get = async () => (await api('GET', '/api/campaign', { user: PLAYER })).json;

  await step('campaign: GET a missing doc -> the default doc, updatedAt null; list says campaignUpdatedAt null', async () => {
    const r = await api('GET', '/api/campaign', { user: PLAYER });
    expectStatus(r, 200);
    const d = r.json.doc;
    expect(r.json.updatedAt === null && d.updatedAt === null, 'updatedAt ' + r.json.updatedAt);
    expect(d.v === 1 && d.session.number === 0 && d.session.startedAt === null, 'session ' + JSON.stringify(d.session));
    expect(d.crew.hold === 'weak' && d.crew.heat === 0 && Array.isArray(d.crew.cohorts), 'crew ' + JSON.stringify(d.crew));
    expect(Array.isArray(d.clocks) && !d.clocks.length && Array.isArray(d.log) && !d.log.length, 'clocks/log');
    expect(r.headers.get('cache-control') === 'no-store', 'no-store');
    const l = await api('GET', '/api/characters', { user: PLAYER });
    expect('campaignUpdatedAt' in l.json && l.json.campaignUpdatedAt === null, 'campaignUpdatedAt ' + l.json.campaignUpdatedAt);
  });

  await step('campaign: a player PATCH on a missing doc is checked against the default (clock add -> 403)', async () => {
    const r = await api('PATCH', '/api/campaign', { user: PLAYER, body: { clocks: [{ id: 'c_x', name: 'x', size: 4, filled: 0 }] } });
    expectStatus(r, 403);
    expect(r.json.error === GM_ONLY, r.text);
    expect((await get()).updatedAt === null, 'nothing stored');
  });

  await step('campaign: player PUT -> 403', async () => {
    const r = await api('PUT', '/api/campaign', { user: PLAYER, body: sampleCampaign() });
    expectStatus(r, 403);
    expect(r.json.error === GM_ONLY, r.text);
  });

  let sinceCamp, firstAt;
  await step('campaign: GM PUT stores it, server stamps updatedAt; list carries campaignUpdatedAt', async () => {
    await sleep(2300);
    sinceCamp = (await api('GET', '/api/characters')).json.now;
    const before = new Date().toISOString();
    const r = await api('PUT', '/api/campaign', { body: sampleCampaign() });
    expectStatus(r, 200);
    firstAt = r.json.updatedAt;
    expect(firstAt >= before && r.json.doc.updatedAt === firstAt, 'updatedAt ' + firstAt);
    expect(r.json.doc.crew.name === 'The Lamplighters' && r.json.doc.clocks.length === 2, 'doc');
    const g = await get();
    expect(g.updatedAt === firstAt && g.doc.session.number === 3, 'GET after PUT');
    const l = await api('GET', '/api/characters', { user: PLAYER });
    expect(l.json.campaignUpdatedAt === firstAt, 'campaignUpdatedAt ' + l.json.campaignUpdatedAt);
  });

  await step('campaign: since-poll with no character change still reports the new campaignUpdatedAt', async () => {
    const r = await api('GET', '/api/characters?since=' + encodeURIComponent(sinceCamp), { user: PLAYER });
    expectStatus(r, 200);
    expect(r.json.docs.length === 0, 'rows ' + r.json.docs.map((d) => d.id));
    expect(r.json.campaignUpdatedAt === firstAt, 'campaignUpdatedAt ' + r.json.campaignUpdatedAt);
  });

  await step('campaign: player PATCH clocks.0.filled -> 200; campaignUpdatedAt moves', async () => {
    const clocks = sampleCampaign().clocks; clocks[0].filled = 3;
    const r = await api('PATCH', '/api/campaign', { user: PLAYER, body: { clocks } });
    expectStatus(r, 200);
    expect(r.json.doc.clocks[0].filled === 3 && r.json.doc.clocks[1].name === 'Fence', JSON.stringify(r.json.doc.clocks));
    expect(r.json.updatedAt > firstAt, 'updatedAt moved');
    expect(r.json.doc.crew.name === 'The Lamplighters', 'rest kept');
    const s = await api('GET', '/api/characters?since=' + encodeURIComponent(sinceCamp), { user: PLAYER });
    expect(s.json.campaignUpdatedAt === r.json.updatedAt, 'since campaignUpdatedAt ' + s.json.campaignUpdatedAt);
  });

  await step('campaign: player may change anything under crew (tier, heat, cohort harm, add a cohort, new keys)', async () => {
    const cur = (await get()).doc;
    const cohorts = cur.crew.cohorts.concat([{ name: 'Hounds', type: 'expert', edges: '', flaws: '', harm: null, armor: false }]);
    cohorts[0] = { ...cohorts[0], harm: 'weak' };
    const r = await api('PATCH', '/api/campaign', {
      user: PLAYER,
      body: { crew: { tier: 2, heat: 5, vault: 4, cohorts, upgrades: { carriage: true }, notes: 'shared sheet' } },
    });
    expectStatus(r, 200);
    const c = r.json.doc.crew;
    expect(c.tier === 2 && c.heat === 5 && c.vault === 4 && c.cohorts.length === 2 && c.cohorts[0].harm === 'weak', JSON.stringify(c));
    expect(c.upgrades.carriage === true && c.name === 'The Lamplighters', 'merge');
  });

  const forbidden = [
    ['player changing session.number -> 403', () => ({ session: { number: 9 } })],
    ['player renaming a clock -> 403', (d) => { const clocks = d.clocks.map((c) => ({ ...c })); clocks[0].name = 'Renamed'; return { clocks }; }],
    ['player resizing a clock -> 403', (d) => { const clocks = d.clocks.map((c) => ({ ...c })); clocks[0].size = 8; return { clocks }; }],
    ['player un-hiding a clock -> 403', (d) => { const clocks = d.clocks.map((c) => ({ ...c })); clocks[1].hidden = false; return { clocks }; }],
    ['player adding a clock -> 403', (d) => ({ clocks: d.clocks.concat([{ id: 'c_new', name: 'New', size: 4, filled: 0, kind: 'other', hidden: false }]) })],
    ['player removing a clock -> 403', (d) => ({ clocks: d.clocks.slice(1) })],
    ['player rewriting an old log entry -> 403', (d) => { const log = d.log.map((e) => ({ ...e })); log[1].text = 'rewritten'; return { log }; }],
    ['player adding a top-level key -> 403', () => ({ extra: 1 })],
    ['player changing v -> 403', () => ({ v: 2 })],
  ];
  for (const [name, mk] of forbidden) {
    await step('campaign: ' + name, async () => {
      const before = await get();
      const r = await api('PATCH', '/api/campaign', { user: PLAYER, body: mk(before.doc) });
      expectStatus(r, 403);
      expect(r.json.error === GM_ONLY, r.text);
      const after = await get();
      expect(after.updatedAt === before.updatedAt, 'stored doc changed');
    });
  }

  await step('campaign: player appending to the log -> 200 (updatedAt in the body is ignored)', async () => {
    const d = (await get()).doc;
    const entry = { at: new Date().toISOString(), by: PLAYER, text: 'we got away' };
    const r = await api('PATCH', '/api/campaign', { user: PLAYER, body: { log: [entry].concat(d.log), updatedAt: '1999-01-01T00:00:00.000Z' } });
    expectStatus(r, 200);
    expect(r.json.doc.log.length === 3 && r.json.doc.log[0].text === 'we got away' && r.json.doc.log[2].text === 'first', JSON.stringify(r.json.doc.log));
    expect(r.json.doc.updatedAt > '2026', 'stamped ' + r.json.doc.updatedAt);
  });

  await step('campaign: a PATCH log only adds: a partial (stale) log drops nothing', async () => {
    const d = (await get()).doc;
    const entry = { at: new Date().toISOString(), by: PLAYER, text: 'only mine' };
    const r = await api('PATCH', '/api/campaign', { user: PLAYER, body: { log: [entry] } });
    expectStatus(r, 200);
    expect(r.json.doc.log.length === d.log.length + 1 && r.json.doc.log[0].text === 'only mine', JSON.stringify(r.json.doc.log));
    const again = await api('PATCH', '/api/campaign', { user: PLAYER, body: { log: [entry].concat(d.log) } });
    expectStatus(again, 200);
    expect(again.json.doc.log.length === d.log.length + 1, 'resending stored entries adds nothing');
  });

  await step('campaign: two players append from the same stale base -> both entries kept, no 403', async () => {
    const base = (await get()).doc.log;
    const a = { at: new Date().toISOString(), by: PLAYER, text: 'from A' };
    const b = { at: new Date(Date.now() + 1).toISOString(), by: 'player2@example.test', text: 'from B' };
    const [ra, rb] = await Promise.all([
      api('PATCH', '/api/campaign', { user: PLAYER, body: { log: [a].concat(base) } }),
      api('PATCH', '/api/campaign', { user: 'player2@example.test', body: { log: [b].concat(base) } }),
    ]);
    expectStatus(ra, 200); expectStatus(rb, 200);
    const log = (await get()).doc.log;
    expect(log.length === base.length + 2, 'length ' + log.length);
    expect(log[0].text === 'from B' && log[1].text === 'from A', 'newest first by at: ' + log.slice(0, 2).map((e) => e.text));
    expect(JSON.stringify(log.slice(2)) === JSON.stringify(base), 'old entries unchanged');
  });

  await step('campaign: GM may change anything (session, rename/remove clocks, new keys); a GM PATCH rewrite of a log entry is ignored', async () => {
    const d = (await get()).doc;
    const rewritten = { ...d.log[0], text: 'rewritten by gm' };
    const r = await api('PATCH', '/api/campaign', {
      body: { session: { number: 4, startedAt: new Date().toISOString() }, clocks: [{ ...d.clocks[1], name: 'Fence (GM)' }], log: [rewritten], notes: 'gm key' },
    });
    expectStatus(r, 200);
    const n = r.json.doc;
    expect(n.session.number === 4 && n.session.endedAt === null, JSON.stringify(n.session));
    expect(n.clocks.length === 1 && n.clocks[0].name === 'Fence (GM)' && n.notes === 'gm key', JSON.stringify(n).slice(0, 300));
    expect(JSON.stringify(n.log) === JSON.stringify(d.log), 'log changed by a PATCH rewrite');
  });

  await step('campaign: the GM rewrites or removes log entries with PUT', async () => {
    const d = (await get()).doc;
    const r = await api('PUT', '/api/campaign', { body: { ...d, log: [{ ...d.log[0], text: 'fixed' }] } });
    expectStatus(r, 200);
    expect(r.json.doc.log.length === 1 && r.json.doc.log[0].text === 'fixed', JSON.stringify(r.json.doc.log));
  });

  await step('campaign: crew / session must be objects (400), log must be an array (400)', async () => {
    const before = (await get()).updatedAt;
    for (const [user, method, body, msg] of [
      [PLAYER, 'PATCH', { crew: 5 }, 'crew must be an object'],
      [PLAYER, 'PATCH', { crew: null }, 'crew must be an object'],
      [GM, 'PATCH', { crew: [] }, 'crew must be an object'],
      [GM, 'PATCH', { session: 'now' }, 'session must be an object'],
      [GM, 'PATCH', { session: null }, 'session must be an object'],
      [GM, 'PUT', { ...sampleCampaign(), crew: 'x' }, 'crew must be an object'],
      [GM, 'PUT', { ...sampleCampaign(), session: [1] }, 'session must be an object'],
      [GM, 'PATCH', { log: null }, null],
      [PLAYER, 'PATCH', { log: ['text'] }, null],
    ]) {
      const r = await api(method, '/api/campaign', { user, body });
      expectStatus(r, 400);
      expect(!msg || r.json.error === msg, JSON.stringify(body) + ' -> ' + r.text);
    }
    expect((await get()).updatedAt === before, 'stored doc changed');
  });

  await step('campaign: log trimmed to 200 (GM PUT), a player append at the cap keeps 200', async () => {
    const doc = sampleCampaign();
    doc.log = Array.from({ length: 250 }, (_, i) => ({ at: new Date(Date.UTC(2026, 0, 1, 0, 0, 250 - i)).toISOString(), by: GM, text: 'e' + i }));
    const r = await api('PUT', '/api/campaign', { body: doc });
    expectStatus(r, 200);
    expect(r.json.doc.log.length === 200 && r.json.doc.log[0].text === 'e0' && r.json.doc.log[199].text === 'e199', 'trim ' + r.json.doc.log.length);
    const entry = { at: new Date().toISOString(), by: PLAYER, text: 'newest' };
    const a = await api('PATCH', '/api/campaign', { user: PLAYER, body: { log: [entry].concat(r.json.doc.log) } });
    expectStatus(a, 200);
    expect(a.json.doc.log.length === 200 && a.json.doc.log[0].text === 'newest' && a.json.doc.log[199].text === 'e198', 'append past the cap');
    const entry2 = { at: new Date().toISOString(), by: PLAYER, text: 'newer' };
    const b = await api('PATCH', '/api/campaign', { user: PLAYER, body: { log: [entry2].concat(a.json.doc.log.slice(0, 199)) } });
    expectStatus(b, 200);
    expect(b.json.doc.log.length === 200 && b.json.doc.log[1].text === 'newest', 'client-trimmed append');
  });

  await step('campaign: concurrent player PATCHes to different fields all land', async () => {
    const rs = await Promise.all([0, 1, 2, 3].map((i) =>
      api('PATCH', '/api/campaign', { user: i % 2 ? PLAYER : GM, body: { crew: { marks: { ['m' + i]: i } } } })));
    for (const r of rs) expectStatus(r, 200);
    const marks = (await get()).doc.crew.marks || {};
    expect([0, 1, 2, 3].every((i) => marks['m' + i] === i), 'marks ' + JSON.stringify(marks));
  });

  await step('campaign: bad body 400, oversize 413, DELETE 405', async () => {
    expectStatus(await api('PATCH', '/api/campaign', { raw: '[1]' }), 400);
    expectStatus(await api('PUT', '/api/campaign', { body: { ...sampleCampaign(), blob: 'x'.repeat(300 * 1024) } }), 413);
    expectStatus(await api('DELETE', '/api/campaign'), 405);
  });
}

const timer = setTimeout(async () => {
  console.log('FAIL overall timeout after ' + OVERALL_TIMEOUT_MS + ' ms');
  await stopServers();
  process.exit(1);
}, OVERALL_TIMEOUT_MS);

try {
  await main();
} catch (e) {
  failures++;
  console.log('FAIL setup\n     ' + (e && e.message || e));
}
clearTimeout(timer);
console.log('\n' + passes + ' passed, ' + failures + ' failed');
await stopServers();
process.exit(failures ? 1 : 0);
