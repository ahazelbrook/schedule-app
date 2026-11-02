// W0.2 against a real `wrangler dev` (local D1, workerd): the switchboard's server half. The campaign document's `features` is the GM's alone (a player's PATCH is 403),
// is cleaned on write (a GM-only id, an unknown id and a non-boolean are dropped, never stored), is kept by a whole-document PUT, is cleaned again on a player's read,
// and reaches the iPad on the display poll (hseq present) without a second D1 call. Invented ids only.
//   node checks/api/features.mjs        (Windows: wrangler is started with a shell)
//
// Applies migrations/ to a throwaway local D1, then starts the Worker on PORT (default 8951, lane G's range 8950-8999).

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Features from '../../app/features.js';
import { cleanFeatures, forPlayer, parseFeatures } from '../../functions/_lib/features.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 8951);
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test', PLAYER = 'player@example.test';
const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler');
const OVERALL_TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS || 300000);
const stateDir = mkdtempSync(join(tmpdir(), 'b68-features-check-'));
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
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  // in-process: the registry the Worker bundles is the one the page reads
  await step('the Worker\'s door to the registry: only display and phone ids, only booleans', async () => {
    const real = Features.publicIds();
    expect(real.includes('phoneCards'), 'phoneCards is a public id: ' + real);
    expect(same(cleanFeatures({ phoneCards: true, 'gm.secret': true, nope: true, bad: 'yes' }), { phoneCards: true }), 'cleaned');
    expect(same(cleanFeatures(null), {}) && same(cleanFeatures([true]), {}) && same(cleanFeatures('x'), {}), 'junk is empty');
    expect(same(parseFeatures('{"phoneCards":false,"zzz":true}'), { phoneCards: false }) && same(parseFeatures('{not json'), {}) && same(parseFeatures(null), {}), 'parse');
    Features.register({ id: 'test.gmonly', label: 'T', surface: 'gm', stage: 'spine', default: false, saturday: 'off', doc: 'd' });
    try {
      expect(same(cleanFeatures({ 'test.gmonly': true, phoneCards: true }), { phoneCards: true }), 'a registered GM-only id is dropped too');
      expect(same(forPlayer({ a: 1, features: { 'test.gmonly': true } }), { a: 1 }), 'forPlayer leaves features out when nothing player-safe is left');
    } finally { Features.unregister('test.gmonly'); }
  });

  const busy = await fetch('http://127.0.0.1:' + PORT + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
  if (busy) throw new Error('port ' + PORT + ' is already in use: stop what is on it, or set PORT');
  const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist],
    { cwd: ROOT, env: envOf, encoding: 'utf8', shell: process.platform === 'win32' });
  if (mig.status !== 0) throw new Error('migrations failed:\n' + mig.stdout + mig.stderr);
  server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
    '--persist-to', persist, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'DISPLAY_EMAILS:' + IPAD, '--var', 'CAMPAIGN:featurescheck'],
  { cwd: ROOT, env: envOf, detached: process.platform !== 'win32', stdio: 'ignore', shell: process.platform === 'win32' });
  let up = false;
  for (let i = 0; i < 240 && !up; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/index.html', { signal: AbortSignal.timeout(2000) }); up = r.status > 0; } catch (_) {} if (!up) await sleep(500); }
  if (!up) throw new Error('server did not start on ' + PORT);
  console.log('server up on ' + PORT);

  const poll = (user, hseq = 0) => call('GET', '/api/gm/display?seq=0&aseq=0&sseq=0&hseq=' + hseq, { user });

  await step('nothing stored: the campaign has no `features`, a player reads none, and the iPad poll carries no `features` key (the answer is main\'s)', async () => {
    const g = await call('GET', '/api/campaign', { user: PLAYER });
    expect(g.status === 200 && !('features' in g.json.doc), 'player doc has no features: ' + g.text.slice(0, 160));
    const p = await poll(IPAD);
    expect(p.status === 200 && p.json.mission && !('features' in p.json), 'poll: ' + p.text.slice(0, 200));
  });

  await step('the GM writes the switch map: only registered display and phone ids are stored; a GM-only, an unknown and a non-boolean value are dropped', async () => {
    const r = await call('PATCH', '/api/campaign', { user: GM, body: { features: { phoneCards: true, 'spine.rail': true, 'gm.private': true, junk: 'yes', bad: 1 } } });
    expect(r.status === 200, 'PATCH ' + r.status + ' ' + r.text.slice(0, 200));
    expect(same(r.json.doc.features, { phoneCards: true }), 'stored ' + JSON.stringify(r.json.doc.features));
    const g = await call('GET', '/api/campaign', { user: GM });
    expect(same(g.json.doc.features, { phoneCards: true }), 'GM reads ' + JSON.stringify(g.json.doc.features));
  });

  await step('a player reads the map but can never write it (403), and a GM-only id is nowhere in what a player is sent', async () => {
    const g = await call('GET', '/api/campaign', { user: PLAYER });
    expect(g.status === 200 && same(g.json.doc.features, { phoneCards: true }), 'player reads ' + g.text.slice(0, 200));
    for (const id of ['spine.rail', 'gm.private', 'junk']) expect(!g.text.includes(id), 'the id ' + id + ' reached a player');
    const w = await call('PATCH', '/api/campaign', { user: PLAYER, body: { features: { phoneCards: false } } });
    expect(w.status === 403, 'player PATCH ' + w.status);
    const g2 = await call('GET', '/api/campaign', { user: GM });
    expect(g2.json.doc.features.phoneCards === true, 'unchanged after the refused write');
  });

  await step('features must be an object (or null): a string, an array or a number is 400', async () => {
    for (const bad of ['on', [true], 5]) { const r = await call('PATCH', '/api/campaign', { user: GM, body: { features: bad } }); expect(r.status === 400, JSON.stringify(bad) + ' -> ' + r.status); }
  });

  await step('a whole-document PUT keeps the stored switches (a stale copy cannot flip one), and a player cannot PUT at all', async () => {
    const cur = (await call('GET', '/api/campaign', { user: GM })).json.doc;
    const stale = { ...cur, features: { phoneCards: false } };
    const r = await call('PUT', '/api/campaign', { user: GM, body: stale });
    expect(r.status === 200 && same(r.json.doc.features, { phoneCards: true }), 'PUT ' + r.status + ' ' + JSON.stringify(r.json && r.json.doc && r.json.doc.features));
    const w = await call('PUT', '/api/campaign', { user: PLAYER, body: stale });
    expect(w.status === 403, 'player PUT ' + w.status);
  });

  await step('the iPad poll (hseq sent) carries the same map as `features`, on a full answer and on an unchanged one', async () => {
    const p = await poll(IPAD);
    expect(p.status === 200 && same(p.json.features, { phoneCards: true }), 'full: ' + p.text.slice(0, 240));
    const seq = p.json.seq, aseq = p.json.ambient && p.json.ambient.seq;
    const u = await call('GET', '/api/gm/display?seq=' + seq + '&aseq=' + aseq + '&sseq=' + (p.json.stt ? p.json.stt.seq : 0) + '&hseq=' + (p.json.mission ? p.json.mission.hseq : 0), { user: IPAD });
    expect(u.status === 200 && same(u.json.features, { phoneCards: true }), 'unchanged: ' + u.text.slice(0, 240));
    const old = await call('GET', '/api/gm/display?seq=0', { user: IPAD });
    expect(old.status === 200 && !('features' in old.json), 'a call without hseq is answered as before');
  });

  await step('All off: the GM writes every id false; a player and the iPad read false at their next poll, and null removes the map', async () => {
    const ids = Features.publicIds();
    const off = {}; ids.forEach((i) => { off[i] = false; });
    const r = await call('PATCH', '/api/campaign', { user: GM, body: { features: off } });
    expect(r.status === 200 && same(r.json.doc.features, off), 'off ' + r.text.slice(0, 200));
    const g = await call('GET', '/api/campaign', { user: PLAYER });
    expect(Object.values(g.json.doc.features).every((v) => v === false), 'player reads all false');
    const p = await poll(IPAD);
    expect(Object.values(p.json.features).every((v) => v === false), 'iPad reads all false');
    const n = await call('PATCH', '/api/campaign', { user: GM, body: { features: null } });
    expect(n.status === 200 && !('features' in n.json.doc), 'null removes ' + n.text.slice(0, 160));
    const p2 = await poll(IPAD);
    expect(!('features' in p2.json), 'and the poll is main\'s again');
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
