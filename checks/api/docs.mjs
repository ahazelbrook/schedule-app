// The store (suite build W0.6): /api/docs against a real `wrangler dev` (local D1, the LiveHub Durable Object), plus the schema checks that need
// no server. The role matrix: the GM, the table display, and players A and B. Invented emails and a GM-ONLY- marker only.
//
//   node checks/api/docs.mjs        (PORT defaults to 8930, lane S's range 8900-8949; Windows: wrangler is started with a shell)
//
// What it holds:
//   no server   migration 0009 is additive (it adds docs and one index and touches nothing else, and the old tables are byte-identical after it),
//               "the old code runs against the new schema" (db.js's lazy SCHEMA is a no-op on a migrated database and builds docs on an empty one),
//               the three copies of the table (migration, schema.sql, db.js) agree, the display allow-list and the poke table
//   server      the role matrix; a hidden row is absent, never 403; a player's upsert never replaces a GM or public row; the 64 KiB cap to the byte;
//               the pokes (a kind and a time, to whom, and none for a GM-only write)

import { spawn, spawnSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { displayMayCall } from '../../functions/_lib/auth.js';
import { KINDS, rolesFor } from '../../functions/_lib/live.js';
import { DOC_LIMITS, PLAYER_KINDS } from '../../functions/_lib/docs.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 8930);
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test', A = 'alice@example.test', B = 'bea@example.test';
const MARK = 'GM-ONLY-docs-marker';
const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler');
const OVERALL_TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS || 240000);
const stateDir = mkdtempSync(join(tmpdir(), 'b68-docs-check-'));
const persist = join(stateDir, 'state');
const envOf = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
let server = null, passes = 0, failures = 0;

function stop() {
  if (server) {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'], { stdio: 'ignore' });
    else { try { process.kill(-server.pid, 'SIGKILL'); } catch (_) {} }
    server = null;
  }
  try { rmSync(stateDir, { recursive: true, force: true }); } catch (_) {}
}
process.on('exit', stop);
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(130); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function call(method, path, { user, body, raw } = {}) {
  const h = {};
  if (user) h['X-Dev-User'] = user;
  let payload;
  if (raw !== undefined) { payload = raw; h['Content-Type'] = 'application/json'; }
  else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch('http://127.0.0.1:' + PORT + path, { method, headers: h, body: payload });
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, json, text };
}
async function step(name, fn) {
  try { await fn(); passes++; console.log('PASS ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e && e.message || e)); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
function status(r, s) { expect(r.status === s, 'expected ' + s + ', got ' + r.status + ' ' + r.text.slice(0, 300)); }
const norm = (s) => s.replace(/\s+/g, ' ').trim();

// ---------- no server: the schema ----------

const MIGRATIONS = readdirSync(join(ROOT, 'migrations')).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const migrationSql = (f) => readFileSync(join(ROOT, 'migrations', f), 'utf8');
const master = (db) => db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => ({ ...r }));

await step('migration 0009 is the newest and is additive: it creates docs and its index, IF NOT EXISTS, and runs no ALTER, DROP, UPDATE, INSERT or DELETE', () => {
  expect(MIGRATIONS[MIGRATIONS.length - 1] === '0009_docs.sql' && MIGRATIONS.length === 9, 'migrations: ' + MIGRATIONS.join());
  const sql = migrationSql('0009_docs.sql').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  expect(!/\b(ALTER|DROP|UPDATE|INSERT|DELETE|REPLACE|PRAGMA)\b/i.test(sql), 'a statement that is not a plain create');
  const creates = sql.match(/CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX)\b[^;]*/gi) || [];
  expect(creates.length === 2 && creates.every((c) => /IF NOT EXISTS/i.test(c)), 'creates: ' + creates.length);
});

await step('after 0001-0008 then 0009: every older table and index is byte-identical, only docs and docs_campaign_updated are new, and 0009 runs twice', () => {
  const db = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS.filter((x) => x < '0009')) db.exec(migrationSql(f));
  const before = master(db);
  db.exec(migrationSql('0009_docs.sql'));
  const after = master(db);
  expect(after.length === before.length + 2, 'new objects: ' + (after.length - before.length));
  expect(JSON.stringify(after.filter((r) => before.some((b) => b.name === r.name))) === JSON.stringify(before), 'an older object changed');
  expect(after.filter((r) => !before.some((b) => b.name === r.name)).map((r) => r.name).join() === 'docs,docs_campaign_updated', 'the new objects');
  db.exec(migrationSql('0009_docs.sql'));
  expect(JSON.stringify(master(db)) === JSON.stringify(after), 'a second run changed something');
});

await step('the old code runs against the new schema: db.js builds its lazy tables on a migrated database without a change, and builds docs on an empty one', async () => {
  const fake = (sqlite) => ({ prepare: (sql) => ({ sql }), batch: async (stmts) => { for (const s of stmts) sqlite.exec(s.sql); return []; } });
  // db.js remembers its lazy create per isolate, so each call below loads a fresh copy of the module
  const freshDb = async (n) => (await import('../../functions/_lib/db.js?fresh=' + n)).getDb;
  const migrated = new DatabaseSync(':memory:');
  for (const f of MIGRATIONS) migrated.exec(migrationSql(f));
  const before = master(migrated);
  await (await freshDb(1))({ DB: fake(migrated) });
  expect(JSON.stringify(master(migrated)) === JSON.stringify(before), 'db.js changed a migrated database');
  const empty = new DatabaseSync(':memory:');
  await (await freshDb(2))({ DB: fake(empty) });
  expect(master(empty).some((r) => r.name === 'docs'), 'docs after the lazy create');
  // the SQL the OLD routes run (characters, campaign, gm_pack, display...) never names docs: grep the old handlers for the table
  const old = ['functions/_lib/characters.js', 'functions/_lib/campaign.js', 'functions/api/export.js', 'functions/api/members.js'].map((f) => readFileSync(join(ROOT, f), 'utf8')).join('\n');
  expect(!/\bdocs\b/.test(old.replace(/\/\/.*$/gm, '')), 'an older route reads docs');
});

await step('the three copies of the table agree: migrations/0009_docs.sql, schema.sql and db.js SCHEMA', () => {
  const table = (text) => norm((text.match(/CREATE TABLE IF NOT EXISTS docs \([\s\S]*?\n\)/) || [''])[0]);
  const m = table(migrationSql('0009_docs.sql')), s = table(readFileSync(join(ROOT, 'schema.sql'), 'utf8')), d = table(readFileSync(join(ROOT, 'functions/_lib/db.js'), 'utf8'));
  expect(m.length > 100 && m === s && m === d, 'differ:\n' + m + '\n' + s + '\n' + d);
  const idx = 'CREATE INDEX IF NOT EXISTS docs_campaign_updated ON docs (campaign_id, updated_at)';
  expect(migrationSql('0009_docs.sql').includes(idx) && readFileSync(join(ROOT, 'schema.sql'), 'utf8').includes(idx) && readFileSync(join(ROOT, 'functions/_lib/db.js'), 'utf8').includes(idx), 'index');
});

await step('the scope column is checked by the database: any value but gm, player or public is refused', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(migrationSql('0009_docs.sql'));
  const ins = (scope) => db.prepare("INSERT INTO docs (campaign_id, kind, owner, scope, json, updated_at) VALUES ('c', 'k', 'o' || ?, ?, '{}', 't')").run(scope, scope);
  for (const s of ['gm', 'player', 'public']) ins(s);
  let threw = false;
  try { ins('everyone'); } catch (_) { threw = true; }
  expect(threw, 'a fourth scope went in');
});

await step('a caller with no resolved role is 401 from the handler (the middleware has already refused a missing sign-in)', async () => {
  const { onRequest } = await import('../../functions/api/docs.js');
  for (const data of [undefined, {}, { me: null }, { me: { role: 'stranger' } }]) {
    const r = await onRequest({ request: new Request('http://x.test/api/docs'), env: {}, data });
    expect(r.status === 401, 'status ' + r.status);
  }
});

await step('the display may GET /api/docs (and only that); the poke table gives docs to every role; the player kinds are the three', () => {
  expect(displayMayCall('GET', '/api/docs') && displayMayCall('GET', '/api/docs/'), 'GET allowed');
  for (const m of ['PUT', 'POST', 'DELETE', 'PATCH']) expect(!displayMayCall(m, '/api/docs'), m + ' refused');
  expect(!displayMayCall('GET', '/api/docs/x') && !displayMayCall('GET', '/api/docsx') && !displayMayCall('GET', '/api/gm/docs'), 'no other path');
  expect(JSON.stringify(KINDS.docs) === JSON.stringify(['player', 'gm', 'display']) && rolesFor('docs').length === 3, 'KINDS.docs');
  expect(PLAYER_KINDS.join() === 'opportunity,debrief,quiet' && DOC_LIMITS.row === 65536, 'constants');
});

// ---------- the server ----------

async function main() {
  const busy = await fetch('http://127.0.0.1:' + PORT + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
  if (busy) throw new Error('port ' + PORT + ' is already in use: stop what is on it, or set PORT');
  const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist],
    { cwd: ROOT, env: envOf, encoding: 'utf8', shell: process.platform === 'win32' });
  if (mig.status !== 0) throw new Error('migrations failed:\n' + mig.stdout + mig.stderr);
  server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
    '--persist-to', persist, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'DISPLAY_EMAILS:' + IPAD, '--var', 'CAMPAIGN:docscheck'],
  { cwd: ROOT, env: envOf, detached: process.platform !== 'win32', stdio: 'ignore', shell: process.platform === 'win32' });
  let up = false;
  for (let i = 0; i < 180 && !up; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/index.html', { signal: AbortSignal.timeout(2000) }); up = r.status > 0; } catch (_) {} if (!up) await sleep(500); }
  if (!up) throw new Error('server did not start on ' + PORT);
  console.log('server up on ' + PORT);

  const put = (user, body) => call('PUT', '/api/docs', { user, body });
  const list = (user, q = '') => call('GET', '/api/docs' + q, { user });
  const keys = (r) => (r.json.docs || []).map((d) => d.kind + '/' + d.owner + '/' + d.scope).sort();

  // ----- the sockets (node's fetch refuses an Upgrade header: raw HTTP, as checks/api/display-role.mjs does) -----
  const openLive = (user) => new Promise((resolveP, rejectP) => {
    const headers = { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': Buffer.from('b68-docs-check-key').toString('base64'), 'X-Dev-User': user };
    const req = httpRequest({ host: '127.0.0.1', port: PORT, path: '/api/live', method: 'GET', headers });
    const timer = setTimeout(() => { req.destroy(); rejectP(new Error('no answer to the upgrade')); }, 15000);
    req.on('response', (res) => { let text = ''; res.on('data', (c) => { text += c; }); res.on('end', () => { clearTimeout(timer); resolveP({ status: res.statusCode, text }); }); });
    req.on('upgrade', (res, socket, head) => {
      clearTimeout(timer);
      const c = { status: res.statusCode, socket, frames: [], buf: Buffer.alloc(0), waiters: [] };
      const pump = () => {
        for (;;) {
          const b = c.buf;
          if (b.length < 2) return;
          let len = b[1] & 0x7f, off = 2;
          if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
          if (b.length < off + len) return;
          c.frames.push({ opcode: b[0] & 0x0f, text: b.subarray(off, off + len).toString('utf8') });
          c.buf = b.subarray(off + len);
        }
      };
      const feed = (chunk) => { c.buf = Buffer.concat([c.buf, chunk]); pump(); c.waiters = c.waiters.filter((w) => !w()); };
      c.until = (n, ms = 8000) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error('waited for ' + n + ' frames, got ' + JSON.stringify(c.frames.map((f) => f.text)))), ms);
        const check = () => { if (c.frames.length >= n) { clearTimeout(t); ok(); return true; } return false; };
        if (!check()) c.waiters.push(check);
      });
      c.messages = () => c.frames.filter((f) => f.opcode === 1).map((f) => JSON.parse(f.text));
      socket.on('data', feed);
      feed(Buffer.from(head));
      c.until(1).then(() => resolveP(c), rejectP);
    });
    req.on('error', rejectP);
    req.end();
  });

  await step('empty store: every role lists nothing', async () => {
    for (const u of [GM, IPAD, A, B]) { const r = await list(u); status(r, 200); expect(r.json.docs.length === 0 && r.json.more === false, u + ': ' + r.text); }
  });

  await step('the GM writes every kind of row: the scope defaults to gm, is kept when a later write leaves it out, and the answer names kind, owner, scope and time', async () => {
    let r = await put(GM, { kind: 'plan', json: { note: MARK } }); status(r, 200);
    expect(r.json.ok === true && r.json.kind === 'plan' && r.json.owner === '_' && r.json.scope === 'gm' && typeof r.json.updatedAt === 'string' && r.json.bytes > 0, r.text);
    const t1 = r.json.updatedAt;
    r = await put(GM, { kind: 'plan', json: { note: MARK + ' v2' } }); status(r, 200);
    expect(r.json.scope === 'gm' && r.json.updatedAt > t1, 'time moves forward: ' + r.text);
    status(await put(GM, { kind: 'board', scope: 'public', json: { title: 'On the board' } }), 200);
    status(await put(GM, { kind: 'board', json: { title: 'On the board, again' } }), 200);   // no scope: stays public
    status(await put(GM, { kind: 'brief', owner: A, scope: 'player', json: { for: 'alice', hint: 'a door' } }), 200);
    status(await put(GM, { kind: 'brief', owner: B, scope: 'player', json: { for: 'bea', hint: 'a window' } }), 200);
    status(await put(GM, { kind: 'quiet', owner: A, scope: 'gm', json: { note: MARK + ' about alice' } }), 200);   // a GM-only row on a PLAYER kind and a player's key
    status(await put(GM, { kind: 'listed', json: [1, 2, 3], scope: 'public' }), 200);                              // an array is a document too
    const g = await list(GM, '?kind=board'); status(g, 200);
    expect(g.json.docs.length === 1 && g.json.docs[0].scope === 'public' && g.json.docs[0].json.title === 'On the board, again', g.text);
    expect(keys(await list(GM)).join() === 'board/_/public,brief/alice@example.test/player,brief/bea@example.test/player,listed/_/public,plan/_/gm,quiet/alice@example.test/gm', 'GM sees all six: ' + keys(await list(GM)));
  });

  await step('the display reads the public rows and nothing else: not a gm row, not a player row, whatever it filters by; and it never sees the marker', async () => {
    const r = await list(IPAD); status(r, 200);
    expect(keys(r).join() === 'board/_/public,listed/_/public', keys(r).join());
    expect(!r.text.includes(MARK) && !r.text.includes('alice') && !r.text.includes('a door'), 'a private word reached the display: ' + r.text);
    for (const q of ['?kind=plan', '?kind=brief', '?kind=quiet&owner=' + A, '?owner=' + A, '?owner=' + B, '?kind=brief&owner=' + A]) {
      const x = await list(IPAD, q); status(x, 200);
      expect(x.json.docs.every((d) => d.scope === 'public') && !x.text.includes(MARK), q + ': ' + x.text);
    }
    expect((await list(IPAD, '?kind=plan')).json.docs.length === 0 && (await list(IPAD, '?kind=brief&owner=' + A)).json.docs.length === 0, 'a hidden row is absent, not refused');
  });

  await step('player A reads the public rows and her own player-scope rows, never the GM-scope row on her own key, never B\'s', async () => {
    const r = await list(A); status(r, 200);
    expect(keys(r).join() === 'board/_/public,brief/alice@example.test/player,listed/_/public', keys(r).join());
    expect(!r.text.includes(MARK) && !r.text.includes('bea') && !r.text.includes('a window'), 'private words reached A: ' + r.text);
    for (const q of ['?owner=' + B, '?kind=brief&owner=' + B, '?kind=plan', '?kind=quiet']) {
      const x = await list(A, q); status(x, 200);
      expect(x.json.docs.length === 0 && !x.text.includes(MARK) && !x.text.includes('a window'), q + ': ' + x.text);
    }
    const mine = await list(A, '?kind=brief&owner=' + A); status(mine, 200);
    expect(mine.json.docs.length === 1 && mine.json.docs[0].json.hint === 'a door', mine.text);
  });

  await step('player B is the mirror image: public rows and his own brief only', async () => {
    const r = await list(B); status(r, 200);
    expect(keys(r).join() === 'board/_/public,brief/bea@example.test/player,listed/_/public', keys(r).join());
    expect(!r.text.includes('a door') && !r.text.includes(MARK), r.text);
  });

  await step('a player writes only her own rows of opportunity, debrief and quiet: the owner is hers, the scope is player, and the GM reads them', async () => {
    let r = await put(A, { kind: 'opportunity', json: { pick: 'the roof' } }); status(r, 200);
    expect(r.json.owner === A && r.json.scope === 'player' && r.json.kind === 'opportunity', r.text);
    status(await put(A, { kind: 'debrief', owner: A, scope: 'player', json: { text: 'went fine' } }), 200);
    status(await put(B, { kind: 'opportunity', json: { pick: 'the cellar' } }), 200);
    status(await put(B, { kind: 'debrief', json: { text: 'B\'s secret debrief' } }), 200);
    // the GM's gm-scope row on A's quiet key is not hers to replace: refused, and unchanged
    r = await put(A, { kind: 'quiet', json: { note: 'overwrite' } }); status(r, 403);
    expect(!r.text.includes(MARK), 'the refusal leaks nothing: ' + r.text);
    const gmv = await list(GM, '?kind=quiet&owner=' + A);
    expect(gmv.json.docs.length === 1 && gmv.json.docs[0].scope === 'gm' && gmv.json.docs[0].json.note === MARK + ' about alice', 'GM row intact: ' + gmv.text);
    status(await put(B, { kind: 'quiet', json: { note: 'b quiet' } }), 200);
    expect(keys(await list(GM)).filter((k) => /opportunity|debrief/.test(k)).join() === 'debrief/alice@example.test/player,debrief/bea@example.test/player,opportunity/alice@example.test/player,opportunity/bea@example.test/player', 'GM sees the players rows');
    const ra = await list(A); expect(!ra.text.includes('B\'s secret') && !ra.text.includes('the cellar') && ra.text.includes('the roof'), 'A sees only her own: ' + ra.text);
    const rb = await list(B); expect(!rb.text.includes('the roof') && !rb.text.includes('went fine') && rb.text.includes('the cellar'), 'B sees only his own');
    expect(!(await list(IPAD)).text.includes('the roof'), 'the display sees none of it');
  });

  await step('a player cannot write what is not hers: another owner, another kind, a wider scope, a GM or public row of the same key; the rows stay as they were', async () => {
    const before = JSON.stringify(keys(await list(GM)));
    status(await put(A, { kind: 'opportunity', owner: B, json: { pick: 'hijack' } }), 403);
    status(await put(A, { kind: 'debrief', owner: B, scope: 'player', json: { text: 'hijack' } }), 403);
    status(await put(A, { kind: 'brief', json: { hint: 'hijack' } }), 403);                       // not a player kind (the GM's brief on her key)
    status(await put(A, { kind: 'board', owner: '_', scope: 'public', json: { title: 'hijack' } }), 403);
    status(await put(A, { kind: 'plan', json: { note: 'hijack' } }), 403);
    status(await put(A, { kind: 'opportunity', scope: 'public', json: { pick: 'show everyone' } }), 403);
    status(await put(A, { kind: 'opportunity', scope: 'gm', json: { pick: 'hide it' } }), 403);
    // the GM publishes B's opportunity row: B may no longer replace it (it is no longer a player-scope row)
    status(await put(GM, { kind: 'opportunity', owner: B, scope: 'public', json: { pick: 'the GM took it' } }), 200);
    status(await put(B, { kind: 'opportunity', json: { pick: 'take it back' } }), 403);
    const rb = await list(IPAD, '?kind=opportunity'); expect(rb.json.docs.length === 1 && rb.json.docs[0].json.pick === 'the GM took it', rb.text);
    status(await put(GM, { kind: 'opportunity', owner: B, scope: 'player', json: { pick: 'the cellar' } }), 200);   // back to B's
    status(await put(B, { kind: 'opportunity', json: { pick: 'the cellar, twice' } }), 200);
    expect(!(await list(GM)).text.includes('hijack') && JSON.stringify(keys(await list(GM))) === before, 'nothing changed');
  });

  await step('the display writes nothing: PUT and DELETE are 403 from the allow-list (the table display sign-in message), POST and PATCH too', async () => {
    const before = JSON.stringify(keys(await list(GM)));
    for (const [m, body] of [['PUT', { kind: 'board', scope: 'public', json: { x: 1 } }], ['POST', { kind: 'board', json: {} }], ['PATCH', { kind: 'board', json: {} }], ['DELETE', undefined]]) {
      const r = await call(m, m === 'DELETE' ? '/api/docs?kind=board&owner=_' : '/api/docs', { user: IPAD, body });
      status(r, 403); expect(/table display/.test(r.text), m + ': ' + r.text);
    }
    expect(JSON.stringify(keys(await list(GM))) === before, 'unchanged');
  });

  await step('deletes: the GM deletes anything (404 when missing); a player deletes only her own player-scope rows of her own kinds', async () => {
    status(await call('DELETE', '/api/docs?kind=debrief&owner=' + B, { user: A }), 403);           // naming another owner is refused outright
    expect(keys(await list(GM)).includes('debrief/bea@example.test/player'), 'B\'s debrief survived A');
    let r = await call('DELETE', '/api/docs?kind=quiet', { user: A }); status(r, 404);              // her key holds a GM-scope row: not hers to delete
    expect(keys(await list(GM)).includes('quiet/alice@example.test/gm'), 'the GM row on her key survived');
    status(await call('DELETE', '/api/docs?kind=brief', { user: A }), 403);                          // not a player kind
    status(await call('DELETE', '/api/docs?kind=board&owner=_', { user: A }), 403);
    r = await call('DELETE', '/api/docs?kind=debrief', { user: A }); status(r, 200);
    expect(r.json.ok === true && r.json.owner === A, r.text);
    expect(!keys(await list(GM)).includes('debrief/alice@example.test/player'), 'gone');
    status(await call('DELETE', '/api/docs?kind=debrief', { user: A }), 404);
    status(await call('DELETE', '/api/docs?kind=quiet&owner=' + A, { user: GM }), 200);
    status(await call('DELETE', '/api/docs?kind=quiet&owner=' + A, { user: GM }), 404);
    status(await call('DELETE', '/api/docs?kind=plan', { user: GM }), 200);                          // owner defaults to '_'
    status(await call('DELETE', '/api/docs', { user: GM }), 400);
  });

  await step('bad requests: 400 for a bad kind, owner, scope, since, limit or body; json must be an object or array; methods other than GET, PUT and DELETE are 405', async () => {
    for (const body of [{ json: {} }, { kind: 'Bad Kind', json: {} }, { kind: '9x', json: {} }, { kind: 'x'.repeat(33), json: {} }, { kind: 'ok', owner: 'two words', json: {} }, { kind: 'ok', owner: '', json: {} },
      { kind: 'ok', scope: 'everyone', json: {} }, { kind: 'ok' }, { kind: 'ok', json: 'text' }, { kind: 'ok', json: 5 }, { kind: 'ok', json: null }])
      status(await put(GM, body), 400);
    status(await call('PUT', '/api/docs', { user: GM, raw: '[1,2]' }), 400);
    status(await call('PUT', '/api/docs', { user: GM, raw: 'not json' }), 400);
    for (const q of ['?kind=Bad', '?since=yesterday', '?limit=0', '?limit=201', '?limit=x', '?owner=a%20b']) status(await list(GM, q), 400);
    status(await call('POST', '/api/docs', { user: GM, body: {} }), 405);
    status(await call('PATCH', '/api/docs', { user: A, body: {} }), 405);
  });

  await step('the cap: json of exactly 64 KiB (counted in bytes, not characters) is stored and read back whole; one byte over is 413; a body over 80 KiB is 413; nothing is written by a refusal', async () => {
    const cap = DOC_LIMITS.row;
    const at = { t: 'a'.repeat(cap - 8) };                                    // {"t":"..."} is 8 bytes of JSON around the string
    expect(JSON.stringify(at).length === cap, 'fixture size');
    let r = await put(GM, { kind: 'big', scope: 'public', json: at }); status(r, 200);
    expect(r.json.bytes === cap, 'bytes ' + r.json.bytes);
    const back = await list(IPAD, '?kind=big'); status(back, 200);
    expect(back.json.docs.length === 1 && back.json.docs[0].json.t.length === cap - 8, 'read back');
    r = await put(GM, { kind: 'big', json: { t: 'a'.repeat(cap - 7) } }); status(r, 413);
    expect(/too large/.test(r.json.error), r.text);
    r = await put(GM, { kind: 'big', json: { t: 'é'.repeat((cap - 8) / 2 + 1) } }); status(r, 413);   // two bytes each
    r = await put(A, { kind: 'debrief', json: { t: 'a'.repeat(cap - 7) } }); status(r, 413);
    r = await put(A, { kind: 'debrief', json: { t: 'a'.repeat(DOC_LIMITS.request) } }); status(r, 413);
    const still = await list(IPAD, '?kind=big');
    expect(still.json.docs[0].json.t.length === cap - 8, 'the refused writes changed nothing');
    status(await call('DELETE', '/api/docs?kind=big&owner=_', { user: GM }), 200);
  });

  await step('list: newest first, ?kind and ?owner and ?since filter, ?limit cuts with more:true, and a stored document comes back as the object that went in', async () => {
    for (let i = 0; i < 5; i++) { status(await put(GM, { kind: 'seq', owner: 'n' + i, scope: 'public', json: { i, s: 'café ✓ "q"' } }), 200); await sleep(5); }
    const all = await list(IPAD, '?kind=seq'); status(all, 200);
    expect(all.json.docs.map((d) => d.owner).join() === 'n4,n3,n2,n1,n0' && all.json.more === false, all.text.slice(0, 300));
    expect(all.json.docs[0].json.i === 4 && all.json.docs[0].json.s === 'café ✓ "q"', 'the document');
    const two = await list(IPAD, '?kind=seq&limit=2'); expect(two.json.docs.length === 2 && two.json.more === true && two.json.docs[0].owner === 'n4', two.text.slice(0, 200));
    const since = await list(GM, '?kind=seq&since=' + encodeURIComponent(all.json.docs[2].updatedAt)); expect(since.json.docs.map((d) => d.owner).join() === 'n4,n3', since.text.slice(0, 200));
    const one = await list(IPAD, '?kind=seq&owner=n2'); expect(one.json.docs.length === 1 && one.json.docs[0].json.i === 2, one.text);
    for (let i = 0; i < 5; i++) status(await call('DELETE', '/api/docs?kind=seq&owner=n' + i, { user: GM }), 200);
  });

  await step('a hostile stored row cannot break a list: bad json text is served as null, not as an error (the column is only ever written through PUT, but the reader does not trust it)', async () => {
    // not reachable through the API; checked in SQL terms: json_valid() guards the splice
    const db = new DatabaseSync(':memory:');
    db.exec(migrationSql('0009_docs.sql'));
    db.prepare("INSERT INTO docs VALUES ('c', 'k', 'o', 'public', 'not json {', 't')").run();
    const r = db.prepare("SELECT CASE WHEN json_valid(json) THEN json ELSE 'null' END AS json FROM docs").get();
    expect(r.json === 'null', 'guard');
  });

  // ---------- the pokes ----------
  await step('pokes: a player\'s write reaches the GM, the display and the other player as { k: "docs", t } and nothing else; a GM-only write pokes nobody; a public write and a delete poke all three', async () => {
    const socks = { gm: await openLive(GM), display: await openLive(IPAD), a: await openLive(A), b: await openLive(B) };
    try {
      for (const s of Object.values(socks)) expect(s.status === 101, 'socket ' + s.status);
      const docsFrames = (s) => s.messages().filter((m) => m.k === 'docs');
      const settle = () => sleep(700);
      // a GM-only write: no poke
      status(await put(GM, { kind: 'plan', json: { note: MARK + ' poke' } }), 200);
      status(await put(GM, { kind: 'plan', scope: 'gm', json: { note: MARK + ' poke 2' } }), 200);
      await settle();
      for (const [n, s] of Object.entries(socks)) expect(docsFrames(s).length === 0, n + ' heard a GM-only write: ' + JSON.stringify(s.messages()));
      // a player's write
      status(await put(A, { kind: 'opportunity', json: { note: 'alice says hush' } }), 200);   // (the quiet kind pokes the GM alone: checks/api/quiet.mjs)
      for (const [n, s] of Object.entries(socks)) { await s.until(2); }
      for (const [n, s] of Object.entries(socks)) {
        const f = docsFrames(s);
        expect(f.length === 1, n + ' frames: ' + JSON.stringify(s.messages()));
        expect(Object.keys(f[0]).sort().join() === 'k,t' && Number.isFinite(f[0].t), n + ' frame keys: ' + JSON.stringify(f[0]));
        expect(!JSON.stringify(s.frames.map((x) => x.text)).includes('hush'), n + ' got the data in a poke');
      }
      // a public write, then a delete of it
      status(await put(GM, { kind: 'board', scope: 'public', json: { title: 'poked' } }), 200);
      for (const s of Object.values(socks)) await s.until(3);
      status(await call('DELETE', '/api/docs?kind=board&owner=_', { user: GM }), 200);
      for (const s of Object.values(socks)) await s.until(4);
      for (const [n, s] of Object.entries(socks)) expect(docsFrames(s).length === 3, n + ' final frames: ' + JSON.stringify(s.messages()));
      // a GM row going from public to gm still pokes (the display and the phones must drop it); gm to gm does not
      status(await put(GM, { kind: 'board', scope: 'public', json: { title: 'again' } }), 200);
      for (const s of Object.values(socks)) await s.until(5);
      status(await put(GM, { kind: 'board', scope: 'gm', json: { title: 'hidden now' } }), 200);
      for (const s of Object.values(socks)) await s.until(6);
      for (const [n, s] of Object.entries(socks)) expect(docsFrames(s).length === 5, n + ' after the hide: ' + JSON.stringify(s.messages()));
      status(await call('DELETE', '/api/docs?kind=board&owner=_', { user: GM }), 200);   // a gm-scope delete: nobody else is told
      await settle();
      for (const [n, s] of Object.entries(socks)) expect(docsFrames(s).length === 5, n + ' heard a GM-only delete');
    } finally { for (const s of Object.values(socks)) if (s.socket) s.socket.destroy(); }
  });

  await step('a refused write pokes nobody', async () => {
    const s = await openLive(B);
    try {
      status(await put(A, { kind: 'brief', json: {} }), 403);
      status(await put(A, { kind: 'quiet', owner: B, json: {} }), 403);
      status(await put(GM, { kind: 'Bad', json: {} }), 400);
      await sleep(700);
      expect(s.messages().filter((m) => m.k === 'docs').length === 0, 'a refusal poked: ' + JSON.stringify(s.messages()));
    } finally { if (s.socket) s.socket.destroy(); }
  });

  await step('the old routes are untouched by the new table: /api/me, /api/characters, /api/campaign and /api/export answer as before, and the export holds no docs', async () => {
    status(await call('GET', '/api/me', { user: A }), 200);
    status(await call('GET', '/api/characters', { user: A }), 200);
    status(await call('GET', '/api/campaign', { user: A }), 200);
    const e = await call('GET', '/api/export', { user: GM }); status(e, 200);
    expect(!e.text.includes(MARK) && !e.text.includes('alice says hush'), 'the export has no docs rows');
  });
}

const timer = setTimeout(() => { console.log('FAIL overall timeout after ' + OVERALL_TIMEOUT_MS + ' ms'); stop(); process.exit(1); }, OVERALL_TIMEOUT_MS);
try {
  await main();
} catch (e) {
  failures++;
  console.log('FAIL setup\n     ' + (e && e.message || e));
}
clearTimeout(timer);
console.log('\n' + passes + ' passed, ' + failures + ' failed');
stop();
process.exit(failures ? 1 : 0);
