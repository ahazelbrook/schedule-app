// The Workers Free 10 ms rule, measured locally: p99 of the display GET (the iPad's poll, with a rolodex overlay naming revealed NPCs, each of which
// adds a read) and of the state PATCH (the GM page's save), with every switch OFF and every switch ON.
//
//   node checks/p99.mjs [--port 8940] [--n 300] [--state-kib 200] [--npcs 12] [--static-kib 0] [--strict] [--json]
//
// Starts `wrangler dev` (local D1, workerd) on the port, applies migrations to a throwaway database, seeds fixtures (invented names; GM-ONLY- markers for
// anything GM-only), then times sequential requests from this process. WHAT THE NUMBERS ARE: wall-clock milliseconds per request as the client sees them,
// which include the loopback HTTP hop and the local D1 (SQLite) I/O, so they are an UPPER BOUND on the Worker's CPU time, not the CPU time itself.
// Production CPU is what Cloudflare bills against the 10 ms line; use `wrangler tail` for that after a deploy.
//
//   --state-kib   the size of the GM state document the PATCH has to read, merge and write (the hard cap is 256 KiB; the soft line is 240)
//   --static-kib  of that, how much is a "static level" copy (the thing F2 moves out of the state document); 0 = none
//   --npcs        revealed NPCs named by the display's overlay (rolodex takes at most 12)
//   --strict      exit 1 when any p99 is over --max-ms (default 10)
// Ports: this lane's range is 8900-8949.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Features from '../app/features.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const PORT = Number(arg('port', process.env.PORT || 8940));
const N = Number(arg('n', 300));
const STATE_KIB = Number(arg('state-kib', 200));
const STATIC_KIB = Number(arg('static-kib', 0));
const NPCS = Math.min(12, Number(arg('npcs', 12)));
const MAX_MS = Number(arg('max-ms', 10));
const STRICT = process.argv.includes('--strict'), AS_JSON = process.argv.includes('--json');
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test';
const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler');
const stateDir = mkdtempSync(join(tmpdir(), 'b68-p99-'));
const persist = join(stateDir, 'state');
const envOf = { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' };
let server = null;

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
async function call(method, path, user, body) {
  const h = { 'X-Dev-User': user };
  let payload;
  if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
  const r = await fetch('http://127.0.0.1:' + PORT + path, { method, headers: h, body: payload });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { status: r.status, json, text };
}
const pct = (xs, p) => { const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)]; };
const r1 = (x) => Math.round(x * 10) / 10;

/* a state document of about `kib` KiB shaped like the real one: history entries with their repeat-guard strings, saved sites, a night log, autopilot lines,
   and (when asked) a static level copy under `ball.level`. Invented words only. */
function stateDoc(kib, staticKib) {
  const filler = (n) => { let s = ''; for (let i = 0; s.length < n; i++) s += 'room' + (i % 97) + ' stair' + (i % 31) + ' lamp' + (i % 13) + ' '; return s.slice(0, n); };
  const doc = { v: 1, con: { live: {}, owed: [], n: 0 }, loc: { ui: {}, map: { view: 'iso' } }, hist: { location: {} }, sites: {}, night: { log: [] }, ap: { log: [] }, ball: { site: 'The Pelican Rooms', t: 0, crew: {}, pins: {} } };
  if (staticKib > 0) doc.ball.level = { rooms: filler(staticKib * 1024) };
  const target = (kib - staticKib) * 1024;
  let i = 0;
  while (JSON.stringify(doc).length < target) {
    i++;
    doc.hist.location['h' + i] = { seed: i, ui: { a: 1 }, mem: filler(1500), label: 'Pelican Rooms ' + i, at: '2030-01-01T10:00:00.000Z' };
    if (i % 3 === 0) doc.sites['site' + i] = { seed: i, ui: {}, mem: filler(600), name: 'Pelican Rooms ' + i, label: 'x', map: { view: 'iso', theme: 'blueprint' }, at: '2030-01-01T10:00:00.000Z' };
    if (i % 5 === 0) doc.night.log.push({ at: i, k: 'stamp', t: filler(120) });
  }
  return doc;
}

async function timeIt(name, fn, n) {
  for (let i = 0; i < 30; i++) await fn(i);      // warm the isolate and the SQLite pages
  const xs = [];
  for (let i = 0; i < n; i++) { const t0 = performance.now(); const r = await fn(i); xs.push(performance.now() - t0); if (r.status !== 200) throw new Error(name + ' answered ' + r.status + ' ' + r.text.slice(0, 160)); }
  return { name, n, p50: r1(pct(xs, 50)), p95: r1(pct(xs, 95)), p99: r1(pct(xs, 99)), max: r1(Math.max(...xs)) };
}

async function main() {
  const busy = await fetch('http://127.0.0.1:' + PORT + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
  if (busy) throw new Error('port ' + PORT + ' is already in use');
  const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist], { cwd: ROOT, env: envOf, encoding: 'utf8', shell: process.platform === 'win32' });
  if (mig.status !== 0) throw new Error('migrations failed:\n' + mig.stdout + mig.stderr);
  server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
    '--persist-to', persist, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'DISPLAY_EMAILS:' + IPAD, '--var', 'CAMPAIGN:p99check'],
  { cwd: ROOT, env: envOf, detached: process.platform !== 'win32', stdio: 'ignore', shell: process.platform === 'win32' });
  let up = false;
  for (let i = 0; i < 240 && !up; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/index.html', { signal: AbortSignal.timeout(2000) }); up = r.status > 0; } catch (_) {} if (!up) await sleep(500); }
  if (!up) throw new Error('server did not start on ' + PORT);

  // fixtures: revealed NPCs (named, so the display GET joins each to its row), a rolodex overlay that names them, and the state document
  const ids = [];
  for (let i = 0; i < NPCS; i++) {
    const id = 'npc_p99_' + i;
    const r = await call('PUT', '/api/npcs/' + id, GM, { name: 'Pelican Guest ' + i, role: 'guest', faction: 'The Pelican Rooms Guild', revealed: true, gmNotes: 'GM-ONLY-note-' + i });
    if (r.status !== 200) throw new Error('npc ' + r.status + ' ' + r.text.slice(0, 200));
    ids.push(id);
  }
  if (ids.length) {
    const o = await call('PATCH', '/api/gm/ambient', GM, { overlay: { id: 'p99-rolodex', kind: 'rolodex', ms: 180000, payload: { npcIds: ids } } });
    if (o.status !== 200) throw new Error('overlay ' + o.status + ' ' + o.text.slice(0, 200));
  }
  // the floor: a request that does almost nothing (GET /api/me), so the hop and the dev server's own cost can be read off the other rows
  const results = [await timeIt('baseline GET /api/me (the hop, no D1 work)', () => call('GET', '/api/me', GM), N)];
  const base = stateDoc(STATE_KIB, STATIC_KIB);
  const allOn = {}; Features.list().forEach((s) => { allOn[s.id] = true; });
  for (const mode of ['off', 'on']) {
    const doc = { ...base, features: mode === 'on' ? allOn : {} };
    const w = await call('PATCH', '/api/gm/state', GM, doc);
    if (w.status !== 200) throw new Error('seed state ' + w.status + ' ' + w.text.slice(0, 200));
    if (mode === 'on') await call('PATCH', '/api/campaign', GM, { features: Features.cleanPublic(allOn) });
    else await call('PATCH', '/api/campaign', GM, { features: null });
    const first = await call('GET', '/api/gm/display?seq=0&aseq=0&sseq=0&hseq=0', IPAD);
    if (first.status !== 200 || !first.json.overlay) throw new Error('display GET: ' + first.status + ' ' + first.text.slice(0, 200));
    const q = '/api/gm/display?seq=' + first.json.seq + '&aseq=' + first.json.ambient.seq + '&sseq=' + first.json.stt.seq + '&hseq=' + first.json.mission.hseq;
    // the iPad's steady poll: everything current, the overlay still joined to its NPCs on every call
    const get = await timeIt('display GET (switches ' + mode + ', ' + ids.length + ' named NPCs)', () => call('GET', q, IPAD), N);
    const patch = await timeIt('state PATCH (switches ' + mode + ', ' + Math.round((await call('GET', '/api/gm/state', GM)).text.length / 1024) + ' KiB doc)', (i) => call('PATCH', '/api/gm/state', GM, { con: { n: i } }), N);
    results.push(get, patch);
  }
  return results;
}

let results;
try { results = await main(); } catch (e) { console.log('FAIL ' + (e && e.message || e)); stop(); process.exit(2); }
stop();
if (AS_JSON) console.log(JSON.stringify({ stateKiB: STATE_KIB, staticKiB: STATIC_KIB, npcs: NPCS, results }, null, 1));
else {
  console.log('wall-clock ms per request, sequential, n=' + N + ' (upper bound on Worker CPU: includes the loopback hop and local D1)');
  const b = results[0];
  for (const r of results) console.log(r.name.padEnd(58) + ' p50 ' + String(r.p50).padStart(5) + '  p95 ' + String(r.p95).padStart(5) + '  p99 ' + String(r.p99).padStart(5) + '  max ' + String(r.max).padStart(6) + (r === b ? '' : '   over the floor: p50 +' + r1(r.p50 - b.p50) + ', p99 +' + r1(r.p99 - b.p99)));
}
const over = results.filter((r) => r.p99 > MAX_MS);
if (over.length) console.log((STRICT ? 'FAIL' : 'NOTE') + ' p99 over ' + MAX_MS + ' ms: ' + over.map((r) => r.name + ' ' + r.p99).join('; '));
process.exit(STRICT && over.length ? 1 : 0);
