// The display name (PATCH /api/me, migrations/0005_member_name.sql) against a local `wrangler dev`: an override survives
// every later sign-in, clearing returns the Access-derived name, validation, nobody can set another person's name, and
// /api/members and /api/export show the override. Every name here is invented.
//
//   node checks/api/name.mjs            (on Windows: node --require <winspawn.cjs> checks/api/name.mjs)
//
// Applies migrations/ (0001 to 0005) to a throwaway local D1 first, then starts the Worker on PORT (default 8853).

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanName, NAME_MAX } from '../../functions/api/me.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 8853);
const GM = 'gm@example.test';
const PLAYER = 'player@example.test';
const OTHER = 'other.person@example.test';
const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler');
const OVERALL_TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS || 240000);
const stateDir = mkdtempSync(join(tmpdir(), 'b68-name-check-'));
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
  return { status: r.status, json, text, headers: r.headers };
}
const get = (user) => call('GET', '/api/me', { user });
const patch = (user, name) => call('PATCH', '/api/me', { user, body: { name } });
async function step(name, fn) {
  try { await fn(); passes++; console.log('PASS ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e && e.message || e)); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
function status(r, s) { expect(r.status === s, 'expected ' + s + ', got ' + r.status + ' ' + r.text.slice(0, 300)); }
let sqlN = 0;
function d1(sql) {
  const file = join(stateDir, 'q' + (++sqlN) + '.sql');   // --file: a --command with spaces is split by the Windows shell
  writeFileSync(file, sql);
  const r = spawnSync(WRANGLER, ['d1', 'execute', 'DB', '--local', '--persist-to', persist, '--json', '--file', file],
    { cwd: ROOT, env: envOf, encoding: 'utf8', shell: process.platform === 'win32' });
  if (r.status !== 0) throw new Error('d1 execute failed: ' + r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  return (out[0] && out[0].results) || [];
}

// ---------- no server: the cleaning rules ----------

await step('cleanName: trims, collapses whitespace, clears on empty, refuses the rest', () => {
  expect(cleanName('  Sam   the\tMan \n') === 'Sam the Man', 'collapse');
  expect(cleanName('') === null && cleanName('   \t ') === null && cleanName(null) === null, 'empty clears');
  expect(cleanName('Zoë Núñez-O’Brien 山田') === 'Zoë Núñez-O’Brien 山田', 'unicode kept');
  expect(cleanName('x'.repeat(NAME_MAX)) === 'x'.repeat(NAME_MAX), 'exactly the limit');
  expect(cleanName('\u{1F600}'.repeat(NAME_MAX)).length === NAME_MAX * 2, 'counted in characters, not UTF-16 units');
  for (const bad of ['x'.repeat(NAME_MAX + 1), '\u{1F600}'.repeat(NAME_MAX + 1), '<b>Sam</b>', 'a>b', 'a\u0007b', 'a\u0000b', 'a​b', 'a‮b', 5, true, {}, ['x']]) {
    let err = null;
    try { cleanName(bad); } catch (e) { err = e; }
    expect(err && err.status === 400, JSON.stringify(bad) + ' should be a 400');
  }
});

// ---------- the server ----------

async function main() {
  const busy = await fetch('http://127.0.0.1:' + PORT + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
  if (busy) throw new Error('port ' + PORT + ' is already in use: stop what is on it, or set PORT');
  const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist],
    { cwd: ROOT, env: envOf, encoding: 'utf8', shell: process.platform === 'win32' });
  if (mig.status !== 0) throw new Error('migrations failed:\n' + mig.stdout + mig.stderr);
  server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
    '--persist-to', persist, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'CAMPAIGN:namecheck'],
  { cwd: ROOT, env: envOf, detached: process.platform !== 'win32', stdio: 'ignore', shell: process.platform === 'win32' });
  let up = false;
  for (let i = 0; i < 180 && !up; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/index.html', { signal: AbortSignal.timeout(2000) }); up = r.status > 0; } catch (_) {} if (!up) await sleep(500); }
  if (!up) throw new Error('server did not start on ' + PORT);
  console.log('server up on ' + PORT);

  await step('GET before any override is unchanged: the same keys, the name derived from the email', async () => {
    const r = await get(PLAYER); status(r, 200);
    expect(Object.keys(r.json).sort().join() === 'build,campaign,email,id,name,role', 'keys ' + Object.keys(r.json));
    expect(r.json.name === 'player' && r.json.id === PLAYER && r.json.email === PLAYER && r.json.role === 'player' && r.json.campaign === 'namecheck', r.text);
    const g = await get(GM); status(g, 200);
    expect(g.json.name === 'gm' && g.json.role === 'gm', g.text);
    const row = d1("SELECT name, name_override FROM members WHERE email = '" + PLAYER + "'");
    expect(row.length === 1 && row[0].name === 'player' && row[0].name_override === null, 'row ' + JSON.stringify(row));
  });

  await step('a bad token is 401 (nothing written); other methods are 405 with Allow: GET, PATCH', async () => {
    const bad = await fetch('http://127.0.0.1:' + PORT + '/api/me', { method: 'PATCH', headers: { 'Cf-Access-Jwt-Assertion': 'garbage.token.here', 'Content-Type': 'application/json' }, body: '{"name":"hacked"}' });
    expect(bad.status === 401, 'bad token ' + bad.status);
    for (const m of ['POST', 'PUT', 'DELETE']) {
      const x = await call(m, '/api/me', { user: PLAYER, body: { name: 'x' } });
      expect(x.status === 405 && /GET/.test(x.headers.get('allow')) && /PATCH/.test(x.headers.get('allow')), m + ' ' + x.status + ' ' + x.headers.get('allow'));
    }
    expect((await get(PLAYER)).json.name === 'player', 'unchanged');
  });

  await step('PATCH sets the override: returned in the GET shape, no-store, and shown by the next GET', async () => {
    const r = await patch(PLAYER, '  Sam   the Man '); status(r, 200);
    expect(Object.keys(r.json).sort().join() === 'build,campaign,email,id,name,role', 'keys ' + Object.keys(r.json));
    expect(r.json.name === 'Sam the Man' && r.json.id === PLAYER && r.json.role === 'player' && r.json.campaign === 'namecheck', r.text);
    expect(r.headers.get('cache-control') === 'no-store', 'no-store');
    const g = await get(PLAYER); status(g, 200);
    expect(g.json.name === 'Sam the Man', g.text);
  });

  await step('the override survives a second (and third) sign-in: the upsert rewrites name, never name_override', async () => {
    // pretend the Access claim changed since: the stored sign-in name differs from what the next sign-in derives
    d1("UPDATE members SET name = 'Old Claim Name' WHERE email = '" + PLAYER + "'");
    let row = d1("SELECT name, name_override FROM members WHERE email = '" + PLAYER + "'");
    expect(row[0].name === 'Old Claim Name' && row[0].name_override === 'Sam the Man', 'setup ' + JSON.stringify(row));
    for (let i = 0; i < 2; i++) {
      const g = await get(PLAYER); status(g, 200);
      expect(g.json.name === 'Sam the Man', 'sign-in ' + (i + 1) + ': ' + g.text);
    }
    row = d1("SELECT name, name_override FROM members WHERE email = '" + PLAYER + "'");
    expect(row[0].name === 'player' && row[0].name_override === 'Sam the Man', 'the sign-in name was refreshed, the override kept: ' + JSON.stringify(row));
  });

  await step('another person is untouched: the GM row, a third user, and an email in the body is ignored', async () => {
    const g0 = await get(GM); status(g0, 200);
    expect(g0.json.name === 'gm' && g0.json.role === 'gm', g0.text);
    const sneaky = await call('PATCH', '/api/me', { user: PLAYER, body: { name: 'Sam the Man', email: GM, id: GM } }); status(sneaky, 200);
    expect(sneaky.json.id === PLAYER && sneaky.json.name === 'Sam the Man', sneaky.text);
    const rows = d1('SELECT email, name, name_override FROM members ORDER BY email');
    const by = Object.fromEntries(rows.map((r) => [r.email, r]));
    expect(by[GM] && by[GM].name_override === null && by[GM].name === 'gm', 'GM row ' + JSON.stringify(by[GM]));
    expect(by[PLAYER].name_override === 'Sam the Man', 'player row ' + JSON.stringify(by[PLAYER]));
    const o = await get(OTHER); status(o, 200);
    expect(o.json.name === 'other.person', o.text);
    expect(d1("SELECT name_override FROM members WHERE email = '" + OTHER + "'")[0].name_override === null, 'third user');
  });

  await step('the GM can change their own name too, and the role is unchanged', async () => {
    const r = await patch(GM, 'Game Master'); status(r, 200);
    expect(r.json.name === 'Game Master' && r.json.role === 'gm', r.text);
    expect((await get(GM)).json.name === 'Game Master', 'GET');
    expect((await get(PLAYER)).json.name === 'Sam the Man', 'the player is still Sam the Man');
  });

  await step('validation: empty body, missing name, non-string, too long, markup, control characters are refused; nothing changes', async () => {
    const refused = [
      ['no name key', { raw: '{}' }], ['not JSON', { raw: 'name=Sam' }], ['an array', { raw: '["x"]' }], ['a number', { body: { name: 5 } }],
      ['an object', { body: { name: { first: 'x' } } }], ['41 characters', { body: { name: 'y'.repeat(41) } }], ['markup', { body: { name: '<script>alert(1)</script>' } }],
      ['a lone >', { body: { name: 'Sam>' } }], ['a bell character', { body: { name: 'Sam\u0007' } }], ['a zero-width space', { body: { name: 'Sam​' } }],
      ['an RTL override', { body: { name: 'Sam‮' } }],
    ];
    for (const [label, opts] of refused) {
      const r = await call('PATCH', '/api/me', { user: PLAYER, ...opts });
      expect(r.status === 400 && r.json && typeof r.json.error === 'string', label + ': expected 400, got ' + r.status + ' ' + r.text.slice(0, 200));
    }
    const big = await call('PATCH', '/api/me', { user: PLAYER, raw: JSON.stringify({ name: 'z'.repeat(10000) }) });
    expect(big.status === 413, 'oversized body ' + big.status);
    expect((await get(PLAYER)).json.name === 'Sam the Man', 'the override survived every refusal');
    const ok = await patch(PLAYER, 'y'.repeat(40)); status(ok, 200);
    expect(ok.json.name === 'y'.repeat(40), '40 characters is allowed');
    status(await patch(PLAYER, 'Sam the Man'), 200);
  });

  await step('/api/members and /api/export show the override (and the derived name for everyone without one), in name order', async () => {
    const m = await call('GET', '/api/members', { user: PLAYER }); status(m, 200);
    const names = Object.fromEntries(m.json.members.map((x) => [x.id, x.name]));
    expect(names[PLAYER] === 'Sam the Man' && names[GM] === 'Game Master' && names[OTHER] === 'other.person', JSON.stringify(names));
    const order = m.json.members.map((x) => x.name);
    expect(order.join('|') === ['Game Master', 'other.person', 'Sam the Man'].join('|'), 'ordered by the shown name: ' + order.join('|'));
    const e = await call('GET', '/api/export', { user: GM }); status(e, 200);
    const en = Object.fromEntries(e.json.members.map((x) => [x.id, x.name]));
    expect(en[PLAYER] === 'Sam the Man' && en[GM] === 'Game Master' && en[OTHER] === 'other.person', JSON.stringify(en));
    expect(!e.text.includes('name_override'), 'the column name is not part of the export');
    expect(e.json.members.find((x) => x.id === GM).role === 'gm', 'role still follows GM_EMAILS');
  });

  await step('clearing: null and "" (and whitespace) go back to the Access-derived name, in GET, members and the row', async () => {
    for (const clear of [null, '', '   ']) {
      status(await patch(PLAYER, 'Temp Name'), 200);
      const r = await patch(PLAYER, clear); status(r, 200);
      expect(r.json.name === 'player', JSON.stringify(clear) + ' -> ' + r.text);
      expect((await get(PLAYER)).json.name === 'player', 'GET after clear');
      expect(d1("SELECT name_override FROM members WHERE email = '" + PLAYER + "'")[0].name_override === null, 'the column is NULL again');
    }
    const m = await call('GET', '/api/members', { user: GM });
    expect(m.json.members.find((x) => x.id === PLAYER).name === 'player', 'members');
    status(await patch(PLAYER, 'Back Again'), 200);
    expect((await get(PLAYER)).json.name === 'Back Again', 'can be set again after clearing');
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
