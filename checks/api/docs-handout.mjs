// Handouts on the players' phones (the players' screen build, IP4; setting phone.handouts): the scoping of the `handout` rows in the docs store,
// against a real `wrangler dev` (local D1), plus the checks that need no server. Invented emails, invented file names and GM-ONLY- markers only.
//
//   node checks/api/docs-handout.mjs        (PORT defaults to 12160, IP4's range 12150-12199; Windows: wrangler is started with a shell)
//
// What it holds:
//   no server   the kind is not one a player may write (PLAYER_KINDS); every docs GET in the app and the Worker names its kind, so code that does not
//               know `handout` (Deploy 38, a1f8d57, and this tree) never lists one; when a1f8d57 is in the repository, the same is checked there;
//               no new migration
//   server      a player's GET returns only their own handout row (B never sees A's, by kind or by any list, and never the GM's pack part); the
//               display gets none; the GM gets all; only the GM may write or delete these rows (a player's PUT, DELETE and a write naming
//               another owner are 403; the display's is refused); the GM's take-back (a rewrite, then a DELETE) leaves the player nothing

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAYER_KINDS } from '../../functions/_lib/docs.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 12160);
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test', A = 'alice@example.test', B = 'bea@example.test';
const FA = 'a1b2c3d4e5f60718.png', FB = 'f0e1d2c3b4a59687.png', FM = '0badc0ffee123456.png';
const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler');
const stateDir = mkdtempSync(join(tmpdir(), 'b68-docs-handout-'));
const persist = join(stateDir, 'state');
const envOf = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
delete envOf.ANTHROPIC_API_KEY; delete envOf.B68_ANTHROPIC_KEY;
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
async function call(method, path, { user, body } = {}) {
  const h = {};
  if (user) h['X-Dev-User'] = user;
  let payload;
  if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
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

// ---------- no server ----------

/* every docs GET in a tree: a fetch of '/docs' or '/api/docs' that is a read (not a PUT or DELETE) must carry ?kind= */
function docsReads(files, read) {
  const bad = []; bad.seen = 0;
  for (const f of files) {
    const text = read(f);
    if (!text) continue;
    text.split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      const hits = code.match(/['"](?:\/api)?\/docs(\?[^'"]*)?['"]/g) || [];
      for (const h of hits) {
        bad.seen++;
        if (/\?kind=/.test(h)) continue;
        if (/'(?:PUT|DELETE)'\s*,\s*['"](?:\/api)?\/docs/.test(code) || /method:\s*'(?:PUT|DELETE)'/.test(code) || /opts\('PUT'/.test(code)) continue;
        if (/\bre:\s*\/|path:\s*'\/api\/docs'|DISPLAY_FUNCTIONS|\(\/\^/.test(code)) continue;      /* the router and the display's allow-list */
        bad.push(f + ':' + (i + 1) + ': ' + line.trim().slice(0, 160));
      }
    });
  }
  return bad;
}
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n === 'node_modules' || n === 'checks' || n.startsWith('.')) continue;
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(js|mjs)$/.test(n)) out.push(p);
  }
  return out;
}

await step('only the GM writes handout rows: the kind is not in PLAYER_KINDS', () => {
  expect(!PLAYER_KINDS.includes('handout'), 'PLAYER_KINDS: ' + PLAYER_KINDS.join());
});

await step('no new migration: the migrations are the ones Deploy 38 (a1f8d57) has (the rows ride the docs table as it is)', () => {
  const m = readdirSync(join(ROOT, 'migrations')).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
  const old = spawnSync('git', ['ls-tree', '--name-only', 'a1f8d57', 'migrations/'], { cwd: ROOT, encoding: 'utf8' });
  const was = old.status === 0 && old.stdout.trim() ? old.stdout.split('\n').map((x) => x.replace(/^migrations\//, '')).filter((x) => /^\d{4}_.*\.sql$/.test(x)).sort() : null;
  if (!was) console.log('     (a1f8d57 is not in this clone: compared with the list as of 13/11)');
  const want = was || ['0001_init.sql', '0002_rules.sql', '0003_npcs.sql', '0004_gm.sql', '0005_member_name.sql', '0006_gm_ambient.sql', '0007_gm_stt.sql', '0008_gm_assist.sql', '0009_docs.sql', '0010_transcript_at.sql'];
  expect(m.join() === want.join(), 'migrations: ' + m.join() + ' (Deploy 38: ' + want.join() + ')');
});

await step('this tree: every docs GET names its kind (so no reader of another kind ever lists a handout row)', () => {
  const files = ['app', 'functions', 'worker', 'scripts'].flatMap((d) => walk(join(ROOT, d)));
  const bad = docsReads(files, (f) => readFileSync(f, 'utf8'));
  console.log('     ' + bad.seen + ' docs calls in ' + files.length + ' files');
  expect(bad.seen >= 15, 'only ' + bad.seen + ' docs calls found: the scan is not reading the files');
  expect(bad.length === 0, 'a docs read with no kind:\n     ' + bad.join('\n     '));
});

await step('Deploy 38 (a1f8d57): every docs GET names its kind, and nothing there knows the handout kind (rollback ignores the rows)', () => {
  const has = spawnSync('git', ['cat-file', '-t', 'a1f8d57'], { cwd: ROOT, encoding: 'utf8' });
  if (has.status !== 0) { console.log('     (a1f8d57 is not in this clone: skipped)'); return; }
  const ls = spawnSync('git', ['ls-tree', '-r', '--name-only', 'a1f8d57', '--', 'app', 'functions', 'worker', 'scripts'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  const files = ls.stdout.split('\n').filter((f) => /\.(js|mjs)$/.test(f) && !f.startsWith('app/checks/'));
  const read = (f) => spawnSync('git', ['show', 'a1f8d57:' + f], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 }).stdout || '';
  const bad = docsReads(files, read);
  console.log('     ' + bad.seen + ' docs calls in ' + files.length + ' files at a1f8d57');
  expect(bad.seen >= 15, 'only ' + bad.seen + ' docs calls found at a1f8d57: the scan is not reading the files');
  expect(bad.length === 0, 'a docs read with no kind at a1f8d57:\n     ' + bad.join('\n     '));
  const grep = (rev) => spawnSync('git', ['grep', '-n', '-F'].concat(rev ? [] : ['--untracked']).concat(['-e', "KIND = 'handout'", '-e', 'kind=handout']).concat(rev ? [rev] : []).concat(['--', 'app', 'functions']), { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  expect(grep(null).length > 0, 'the pattern finds nothing in this tree either, so it proves nothing');
  const g = grep('a1f8d57');
  expect(!g, 'a1f8d57 reads the kind: ' + g.slice(0, 300));
});

// ---------- the server ----------

async function main() {
  const busy = await fetch('http://127.0.0.1:' + PORT + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
  if (busy) throw new Error('port ' + PORT + ' is already in use: stop what is on it, or set PORT');
  const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist],
    { cwd: ROOT, env: envOf, encoding: 'utf8', shell: process.platform === 'win32' });
  if (mig.status !== 0) throw new Error('migrations failed:\n' + mig.stdout + mig.stderr);
  server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
    '--persist-to', persist, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'DISPLAY_EMAILS:' + IPAD, '--var', 'CAMPAIGN:hocheck'],
  { cwd: ROOT, env: envOf, detached: process.platform !== 'win32', stdio: 'ignore', shell: process.platform === 'win32' });
  let up = false;
  for (let i = 0; i < 180 && !up; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/index.html', { signal: AbortSignal.timeout(2000) }); up = r.status > 0; } catch (_) {} if (!up) await sleep(500); }
  if (!up) throw new Error('server did not start on ' + PORT);
  console.log('server up on ' + PORT);

  const row = (file, id, title) => ({ v: 1, items: [{ id, title, file, at: Date.now() }] });
  const list = (user, q = '') => call('GET', '/api/docs' + q, { user });
  const owners = (r) => (r.json && r.json.docs || []).filter((d) => d.kind === 'handout').map((d) => d.owner).sort();

  for (const u of [A, B]) await call('GET', '/api/me', { user: u });     /* each signs in once, as a phone would */
  await step('the GM sends: one row for A (the sewer map) and one for B (a GM-ONLY- titled prop), scope player', async () => {
    status(await call('PUT', '/api/docs', { user: GM, body: { kind: 'handout', owner: A, scope: 'player', json: row(FA, 'sewer-map', 'Invented sewer map') } }), 200);
    status(await call('PUT', '/api/docs', { user: GM, body: { kind: 'handout', owner: B, scope: 'player', json: row(FB, 'ledger', 'GM-ONLY-ho-B ledger page') } }), 200);
    status(await call('POST', '/api/gm/pack', { user: GM, body: { part: 'handouts', src: { file: 'invented/handouts', blockSha: '1', exportedAt: new Date().toISOString() },
      body: { v: 1, rel: 'invented', items: [{ id: 'sewer-map', title: 'Invented sewer map', file: FA }, { id: 'ledger', title: 'GM-ONLY-ho-B ledger page', file: FB }, { id: 'unsent', title: 'GM-ONLY-ho-unsent', file: FM, when: 'GM-ONLY-ho-cue' }] } } }), 200);
  });
  await step('player A: GET ?kind=handout is A\'s own row only; no list of A\'s holds B\'s file, title or the unsent one', async () => {
    const r = await list(A, '?kind=handout'); status(r, 200);
    expect(owners(r).join() === A, 'owners: ' + owners(r).join());
    expect(r.text.includes(FA) && !r.text.includes(FB) && !r.text.includes('GM-ONLY-ho-B'), 'A sees B: ' + r.text.slice(0, 300));
    for (const q of ['', '?limit=200', '?owner=' + encodeURIComponent(B), '?kind=handout&owner=' + encodeURIComponent(B)]) {
      const x = await list(A, q); status(x, 200);
      expect(!x.text.includes(FB) && !x.text.includes('GM-ONLY-ho') && !x.text.includes(FM), q + ': ' + x.text.slice(0, 300));
    }
  });
  await step('player B: only B\'s row, never A\'s file', async () => {
    const r = await list(B, '?kind=handout'); status(r, 200);
    expect(owners(r).join() === B && r.text.includes(FB) && !r.text.includes(FA), r.text.slice(0, 300));
    const all = await list(B); expect(!all.text.includes(FA), 'B\'s full list holds A\'s file');
  });
  await step('a player never gets the manifest: the GM pack (handouts part, the cue) is refused to a player and to the display', async () => {
    for (const u of [A, IPAD]) {
      for (const p of ['/api/gm/pack', '/api/gm/pack?part=handouts']) {
        const r = await call('GET', p, { user: u });
        expect(r.status === 403 && !r.text.includes(FM) && !r.text.includes('GM-ONLY-ho-cue'), u + ' ' + p + ' -> ' + r.status + ' ' + r.text.slice(0, 200));
      }
    }
  });
  await step('the display sign-in gets no handout row, by kind or in its full list', async () => {
    const r = await list(IPAD, '?kind=handout'); status(r, 200);
    expect(owners(r).length === 0, 'display owners: ' + owners(r).join());
    const all = await list(IPAD); status(all, 200);
    expect(!all.text.includes(FA) && !all.text.includes(FB), 'display list: ' + all.text.slice(0, 300));
  });
  await step('the GM gets every row', async () => {
    const r = await list(GM, '?kind=handout&limit=200'); status(r, 200);
    expect(owners(r).join() === [A, B].sort().join(), 'GM owners: ' + owners(r).join());
  });
  await step('only the GM writes: a player\'s PUT (own row, another owner, scope public) and DELETE are 403; the display\'s PUT and DELETE are refused', async () => {
    status(await call('PUT', '/api/docs', { user: A, body: { kind: 'handout', scope: 'player', json: row(FB, 'stolen', 'x') } }), 403);
    status(await call('PUT', '/api/docs', { user: A, body: { kind: 'handout', owner: B, scope: 'player', json: row(FA, 'planted', 'x') } }), 403);
    status(await call('PUT', '/api/docs', { user: A, body: { kind: 'handout', scope: 'public', json: row(FA, 'shout', 'x') } }), 403);
    status(await call('DELETE', '/api/docs?kind=handout', { user: A }), 403);
    status(await call('DELETE', '/api/docs?kind=handout&owner=' + encodeURIComponent(B), { user: A }), 403);
    for (const m of ['PUT', 'DELETE']) {
      const r = await call(m, '/api/docs' + (m === 'DELETE' ? '?kind=handout&owner=' + encodeURIComponent(A) : ''), { user: IPAD, body: m === 'PUT' ? { kind: 'handout', owner: A, scope: 'player', json: row(FB, 'x', 'x') } : undefined });
      expect(r.status === 403 || r.status === 401, 'display ' + m + ' -> ' + r.status);
    }
    const a = await list(A, '?kind=handout'), b = await list(B, '?kind=handout');
    expect(a.text.includes(FA) && !a.text.includes(FB) && b.text.includes(FB) && !b.text.includes(FA), 'a refused write changed a row');
  });
  await step('the GM takes back: B\'s row rewritten without the item, then deleted when empty; B lists nothing, A is untouched', async () => {
    status(await call('PUT', '/api/docs', { user: GM, body: { kind: 'handout', owner: B, scope: 'player', json: { v: 1, items: [] } } }), 200);
    status(await call('DELETE', '/api/docs?kind=handout&owner=' + encodeURIComponent(B), { user: GM }), 200);
    const b = await list(B, '?kind=handout'); status(b, 200);
    expect(owners(b).length === 0 && !b.text.includes(FB), 'B still holds: ' + b.text.slice(0, 200));
    const a = await list(A, '?kind=handout'); expect(owners(a).join() === A, 'A lost its row');
  });
}

try { await main(); } catch (e) { failures++; console.log('FAIL ' + (e && e.message || e)); }
stop();
console.log('\n' + passes + ' passed, ' + failures + ' failed');
process.exit(failures ? 1 : 0);
