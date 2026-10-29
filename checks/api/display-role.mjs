// The table display sign-in (DISPLAY_EMAILS, GM.md "The display sign-in") against a local `wrangler dev`: the role reads the
// display and its own identity and runs the transcriber, nothing else; every other route (known or not) is 403 with the same message, the GM
// keeps PUT, GM wins when an email is in both lists, and with DISPLAY_EMAILS unset nobody is 'display'. Invented emails only.
//
//   node checks/api/display-role.mjs   (Windows: node --require <winspawn.cjs>, or it uses shell for wrangler itself)
//
// Applies migrations/ to a throwaway local D1, then starts the Worker on PORT (default 8855).

import { spawn, spawnSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { roleFor, displayMayCall } from '../../functions/_lib/auth.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 8855);
const GM = 'gm@example.test';
const IPAD = 'table.ipad@example.test';
const PLAYER = 'player@example.test';
const BOTH = 'both@example.test';
const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler');
const OVERALL_TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS || 240000);
const stateDir = mkdtempSync(join(tmpdir(), 'b68-display-check-'));
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
  return { status: r.status, json, text, headers: r.headers };
}
async function step(name, fn) {
  try { await fn(); passes++; console.log('PASS ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e && e.message || e)); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
function status(r, s) { expect(r.status === s, 'expected ' + s + ', got ' + r.status + ' ' + r.text.slice(0, 300)); }

// ---------- no server ----------

await step('roleFor: gm wins, then display, else player; unset DISPLAY_EMAILS makes nobody display; case-insensitive', () => {
  expect(roleFor(GM, GM, IPAD) === 'gm', 'gm');
  expect(roleFor(IPAD, GM, IPAD) === 'display', 'display');
  expect(roleFor(BOTH, BOTH, BOTH) === 'gm', 'both lists: gm wins');
  expect(roleFor(PLAYER, GM, IPAD) === 'player', 'player');
  expect(roleFor(IPAD, GM, undefined) === 'player' && roleFor(IPAD, GM, '') === 'player', 'inert when unset');
  expect(roleFor('TABLE.IPAD@Example.Test', GM, ' ' + IPAD.toUpperCase() + ' ,x@y.z') === 'display', 'case and spaces');
  expect(roleFor('', GM, IPAD) === 'player' && roleFor(null, GM, IPAD) === 'player', 'no email');
});

await step('displayMayCall: GET /api/me, GET /api/gm/display and the transcriber calls (optional trailing slash), nothing else', () => {
  expect(displayMayCall('GET', '/api/me') && displayMayCall('GET', '/api/me/') && displayMayCall('GET', '/api/gm/display') && displayMayCall('GET', '/api/gm/display/'), 'allowed');
  expect(displayMayCall('POST', '/api/gm/stt/token') && displayMayCall('GET', '/api/gm/stt') && displayMayCall('PATCH', '/api/gm/stt/') && displayMayCall('POST', '/api/gm/transcript'), 'the transcriber is allowed');
  expect(displayMayCall('GET', '/api/live') && displayMayCall('GET', '/api/live/') && !displayMayCall('POST', '/api/live') && !displayMayCall('GET', '/api/livex') && !displayMayCall('GET', '/api/live/x'), 'the live-sync socket (GET only) is allowed');
  for (const [m, p] of [['GET', '/api/gm/transcript'], ['DELETE', '/api/gm/transcript'], ['GET', '/api/gm/stt/token'], ['PUT', '/api/gm/stt'], ['POST', '/api/gm/stt/tokenx']])
    expect(!displayMayCall(m, p), m + ' ' + p + ' should be refused');
  for (const [m, p] of [['PATCH', '/api/me'], ['PUT', '/api/gm/display'], ['POST', '/api/gm/display'], ['GET', '/api/gm/pack'], ['GET', '/api/gm/state'],
    ['GET', '/api/gm/ambient'], ['PATCH', '/api/gm/ambient'], ['GET', '/api/gm/ambient/'], ['GET', '/api/gm/'], ['GET', '/api/campaign'], ['GET', '/api/characters'], ['GET', '/api/npcs'], ['GET', '/api/members'], ['GET', '/api/export'],
    ['GET', '/api/rules'], ['GET', '/api/me/x'], ['GET', '/api/gm/display/x'], ['GET', '/api/nothing'], ['GET', '/api/ME'], ['GET', ''], ['GET', undefined]]) {
    expect(!displayMayCall(m, p), m + ' ' + p + ' should be refused');
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
    '--persist-to', persist, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM + ',' + BOTH,
    '--var', 'DISPLAY_EMAILS:' + IPAD + ',' + BOTH, '--var', 'CAMPAIGN:displaycheck'],
  { cwd: ROOT, env: envOf, detached: process.platform !== 'win32', stdio: 'ignore', shell: process.platform === 'win32' });
  let up = false;
  for (let i = 0; i < 180 && !up; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/index.html', { signal: AbortSignal.timeout(2000) }); up = r.status > 0; } catch (_) {} if (!up) await sleep(500); }
  if (!up) throw new Error('server did not start on ' + PORT);
  console.log('server up on ' + PORT);

  await step('GET /api/me as the display: role "display", same keys as anyone, and no member row is recorded', async () => {
    const r = await call('GET', '/api/me', { user: IPAD }); status(r, 200);
    expect(Object.keys(r.json).sort().join() === 'build,campaign,email,id,name,role', 'keys ' + Object.keys(r.json));
    expect(r.json.role === 'display' && r.json.email === IPAD && r.json.campaign === 'displaycheck', r.text);
    const m = await call('GET', '/api/members', { user: GM }); status(m, 200);
    expect(!m.json.members.some((x) => x.id === IPAD), 'the display is never listed as a player: ' + m.text);
  });

  await step('the GM pushes, the display reads (and ?seq= works), a player and the display cannot PUT', async () => {
    const put = await call('PUT', '/api/gm/display', { user: GM, body: { kind: 'text', title: 'Tonight', text: 'invented words' } }); status(put, 200);
    const seq = put.json.seq;
    const g = await call('GET', '/api/gm/display', { user: IPAD }); status(g, 200);
    expect(g.json.seq === seq && g.json.display && g.json.display.kind === 'text' && g.json.display.title === 'Tonight', g.text);
    const same = await call('GET', '/api/gm/display?seq=' + seq, { user: IPAD }); status(same, 200);
    expect(same.json.unchanged === true, same.text);
    status(await call('PUT', '/api/gm/display', { user: IPAD, body: { kind: 'text', text: 'hijack' } }), 403);
    status(await call('PUT', '/api/gm/display', { user: PLAYER, body: { kind: 'text', text: 'hijack' } }), 403);
    status(await call('GET', '/api/gm/display', { user: PLAYER }), 403);
    const after = await call('GET', '/api/gm/display', { user: GM });
    expect(after.json.seq === seq && after.json.display.text === 'invented words', 'unchanged by the refused PUTs: ' + after.text);
  });

  await step('the ambient rides on the display read; the display cannot call /api/gm/ambient (GET or PATCH) and cannot change it', async () => {
    const set = await call('PATCH', '/api/gm/ambient', { user: GM, body: { mode: 'pin', scene: 'duskwall', crew: { heat: 2, wanted: 1 } } }); status(set, 200);
    const g = await call('GET', '/api/gm/display', { user: IPAD }); status(g, 200);
    expect(g.json.ambient && g.json.ambient.seq === set.json.seq && g.json.ambient.doc.mode === 'pin' && g.json.ambient.doc.scene === 'duskwall' && g.json.ambient.doc.crew.heat === 2, g.text);
    const same = await call('GET', '/api/gm/display?seq=' + g.json.seq + '&aseq=' + g.json.ambient.seq, { user: IPAD }); status(same, 200);
    expect(same.json.unchanged === true && same.json.ambient.unchanged === true && same.json.ambient.seq === set.json.seq && !('doc' in same.json.ambient), same.text);
    const stale = await call('GET', '/api/gm/display?seq=' + g.json.seq + '&aseq=0', { user: IPAD }); status(stale, 200);
    expect(stale.json.display && stale.json.ambient.doc.mode === 'pin', stale.text);
    const refused = await call('GET', '/api/gm/ambient', { user: IPAD }); status(refused, 403);
    expect(/table display/.test(refused.text) && !refused.text.includes('duskwall'), refused.text);
    const p = await call('PATCH', '/api/gm/ambient', { user: IPAD, body: { mode: 'off', scene: 'harvest' } }); status(p, 403);
    status(await call('PATCH', '/api/gm/ambient', { user: PLAYER, body: { mode: 'off' } }), 403);
    status(await call('GET', '/api/gm/display', { user: PLAYER }), 403);
    const after = await call('GET', '/api/gm/ambient', { user: GM }); status(after, 200);
    expect(after.json.seq === set.json.seq && after.json.doc.mode === 'pin', 'unchanged by the refused PATCHes: ' + after.text);
  });

  await step('the transcriber rides on the display read as want and session only: never a line, a name or the iPad\'s own report; the display cannot change it', async () => {
    const MARK = 'saffron-ferry-whisper';
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    // the GM asks and names a speaker; the iPad reports an error and posts a line, each carrying the marker
    status(await call('PATCH', '/api/gm/stt', { user: GM, body: { want: 'on', session: '9', speakers: { 0: 'Fixture ' + MARK } } }), 200);
    status(await call('PATCH', '/api/gm/stt', { user: IPAD, body: { status: { state: 'error', lines: 1, error: 'broke ' + MARK } } }), 200);
    status(await call('POST', '/api/gm/transcript', { user: IPAD, body: { lines: [{ id: 'm1', at: '2026-10-16T10:00:00.000Z', speaker: 0, text: 'overheard ' + MARK }] } }), 200);
    const g = await call('GET', '/api/gm/display', { user: IPAD }); status(g, 200);
    expect(Object.keys(g.json.stt).sort().join() === 'seq,session,want' && g.json.stt.want === 'on' && g.json.stt.session === '9', 'the part: ' + g.text);
    // whichever way it is asked, nothing of the transcriber but the two values
    for (const q of ['', '?seq=0', '?sseq=0', '?seq=0&aseq=0&sseq=0', '?seq=' + g.json.seq + '&aseq=' + g.json.ambient.seq, '?seq=' + g.json.seq + '&aseq=' + g.json.ambient.seq + '&sseq=' + g.json.stt.seq]) {
      const r = await call('GET', '/api/gm/display' + q, { user: IPAD }); status(r, 200);
      expect(!r.text.includes(MARK), 'a transcriber word on the display read ' + q + ': ' + r.text.slice(0, 200));
      expect(!r.json.stt || Object.keys(r.json.stt).every((k) => ['seq', 'want', 'session', 'unchanged'].includes(k)), q + ' -> ' + JSON.stringify(r.json.stt));
    }
    const small = await call('GET', '/api/gm/display?seq=' + g.json.seq + '&aseq=' + g.json.ambient.seq + '&sseq=' + g.json.stt.seq, { user: IPAD });
    expect(same(small.json.stt, { seq: g.json.stt.seq, unchanged: true }) && small.json.unchanged === true, 'all three current: ' + small.text);
    // the iPad's own reports (they rewrite the control document every minute) do not move the part
    status(await call('PATCH', '/api/gm/stt', { user: IPAD, body: { status: { state: 'listening', lines: 5, error: '' } } }), 200);
    const quiet = await call('GET', '/api/gm/display?seq=' + g.json.seq + '&aseq=' + g.json.ambient.seq + '&sseq=' + g.json.stt.seq, { user: IPAD });
    expect(same(quiet.json, small.json), 'a status report moved the part: ' + quiet.text);
    // the display cannot change what it is told; a player cannot read it
    status(await call('PATCH', '/api/gm/stt', { user: IPAD, body: { want: 'off' } }), 403);
    status(await call('PATCH', '/api/gm/stt', { user: IPAD, body: { session: '1' } }), 403);
    status(await call('GET', '/api/gm/display?sseq=1', { user: PLAYER }), 403);
    expect(same((await call('GET', '/api/gm/display', { user: IPAD })).json.stt, g.json.stt), 'unchanged by the refused PATCHes');
    // and when the GM turns it off the part follows
    status(await call('PATCH', '/api/gm/stt', { user: GM, body: { want: 'off' } }), 200);
    const off = await call('GET', '/api/gm/display?seq=' + g.json.seq + '&aseq=' + g.json.ambient.seq + '&sseq=' + g.json.stt.seq, { user: IPAD }); status(off, 200);
    expect(off.json.stt.want === 'off' && off.json.stt.session === '9' && off.json.stt.seq !== g.json.stt.seq && off.json.display, 'off: ' + off.text.slice(0, 200));
  });

  await step('every other route is the same 403 for the display, known or unknown, any method, before the body is read', async () => {
    const msgs = new Set();
    const routes = [['GET', '/api/gm/ambient'], ['PATCH', '/api/gm/ambient'], ['PUT', '/api/gm/ambient'], ['DELETE', '/api/gm/ambient'],
      ['GET', '/api/campaign'], ['PUT', '/api/campaign'], ['GET', '/api/characters'], ['POST', '/api/characters'], ['GET', '/api/npcs'],
      ['GET', '/api/members'], ['GET', '/api/export'], ['GET', '/api/rules'], ['GET', '/api/gm/pack'], ['GET', '/api/gm/state'], ['PUT', '/api/gm/state'],
      ['GET', '/api/gm/anything'], ['GET', '/api/does-not-exist'], ['PATCH', '/api/me'], ['POST', '/api/me'], ['DELETE', '/api/gm/display']];
    for (const [m, p] of routes) {
      const r = await call(m, p, { user: IPAD, body: m === 'GET' ? undefined : { name: 'x' } });
      expect(r.status === 403, m + ' ' + p + ' -> ' + r.status + ' ' + r.text.slice(0, 120));
      msgs.add(r.text);
    }
    expect(msgs.size === 1, 'one message for all, so the display cannot map the routes: ' + [...msgs].join(' | '));
    expect(/table display/.test([...msgs][0]), [...msgs][0]);
  });

  await step('the display may run the transcriber: post lines and report status (not the GM keys), but never read the transcript', async () => {
    const t = await call('POST', '/api/gm/stt/token', { user: IPAD });
    expect(t.status !== 403, 'token: past the allow-list (no key here, so 503), got ' + t.status + ' ' + t.text.slice(0, 120));
    status(await call('GET', '/api/gm/stt', { user: IPAD }), 200);
    status(await call('PATCH', '/api/gm/stt', { user: IPAD, body: { status: { state: 'listening', lines: 1 } } }), 200);
    status(await call('PATCH', '/api/gm/stt', { user: IPAD, body: { want: 'on' } }), 403);
    const p = await call('POST', '/api/gm/transcript', { user: IPAD, body: { lines: [{ id: 'd1', at: '2026-10-16T10:00:00.000Z', text: 'hello' }] } });
    status(p, 200);
    expect(p.json.added === 1, p.text);
    status(await call('GET', '/api/gm/transcript?after=0', { user: IPAD }), 403);
    status(await call('DELETE', '/api/gm/transcript?through=9', { user: IPAD }), 403);
  });

  await step('an email in both lists is the GM (can PUT); the GM and players are unchanged', async () => {
    const b = await call('GET', '/api/me', { user: BOTH }); status(b, 200);
    expect(b.json.role === 'gm', b.text);
    status(await call('PUT', '/api/gm/display', { user: BOTH, body: { kind: 'blank' } }), 200);
    expect((await call('GET', '/api/me', { user: GM })).json.role === 'gm', 'gm');
    expect((await call('GET', '/api/me', { user: PLAYER })).json.role === 'player', 'player');
    status(await call('GET', '/api/characters', { user: PLAYER }), 200);
    status(await call('GET', '/api/gm/state', { user: GM }), 200);
  });

  await step('the display never appears in /api/members or /api/export for the GM', async () => {
    const e = await call('GET', '/api/export', { user: GM }); status(e, 200);
    expect(!e.text.includes(IPAD), 'export has no display sign-in');
  });

  // ---------- /api/live (MD1a, MD1b): the sockets of every role, real LiveHub Durable Object under wrangler dev ----------
  // node's fetch refuses an Upgrade header, so these speak raw HTTP and read server frames themselves (several may arrive in one chunk).
  const openLive = (user, extra) => new Promise((resolveP, rejectP) => {
    const headers = { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': Buffer.from('b68-live-check-key').toString('base64'), ...(extra || {}) };
    if (user) headers['X-Dev-User'] = user;
    const req = httpRequest({ host: '127.0.0.1', port: PORT, path: '/api/live', method: 'GET', headers });
    const timer = setTimeout(() => { req.destroy(); rejectP(new Error('no answer to the upgrade')); }, 15000);
    req.on('response', (res) => { // anything but 101: a plain answer
      let text = ''; res.on('data', (c) => { text += c; }); res.on('end', () => { clearTimeout(timer); resolveP({ status: res.statusCode, text, headers: res.headers }); });
    });
    req.on('upgrade', (res, socket, head) => {
      clearTimeout(timer);
      const c = { status: res.statusCode, socket, frames: [], buf: Buffer.alloc(0), waiters: [] };
      const pump = () => {
        for (;;) { // unmasked server frames: byte 0 FIN+opcode, byte 1 length (< 126, or 126 and two length bytes)
          const b = c.buf;
          if (b.length < 2) return;
          let len = b[1] & 0x7f, off = 2;
          if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
          if (b.length < off + len) return;
          const opcode = b[0] & 0x0f;
          c.frames.push({ opcode, text: b.subarray(off, off + len).toString('utf8'), code: opcode === 8 && len >= 2 ? b.readUInt16BE(off) : null });
          c.buf = b.subarray(off + len);
        }
      };
      const feed = (chunk) => { c.buf = Buffer.concat([c.buf, chunk]); pump(); c.waiters = c.waiters.filter((w) => !w()); };
      c.until = (n, ms = 10000) => new Promise((ok, no) => {
        const t = setTimeout(() => no(new Error('waited for ' + n + ' frames, got ' + c.frames.length + ': ' + JSON.stringify(c.frames.map((f) => f.text)))), ms);
        const check = () => { if (c.frames.length >= n) { clearTimeout(t); ok(); return true; } return false; };
        if (!check()) c.waiters.push(check);
      });
      c.send = (text) => socket.write(Buffer.concat([Buffer.from([0x81, 0x80 | text.length, 0, 0, 0, 0]), Buffer.from(text)])); // masked with four zero bytes: the payload is plain
      c.messages = () => c.frames.filter((f) => f.opcode === 1).map((f) => JSON.parse(f.text));
      c.closeFrame = () => c.frames.find((f) => f.opcode === 8) || null;
      socket.on('data', feed);
      feed(Buffer.from(head));
      c.until(1, 10000).then(() => resolveP(c), rejectP);
    });
    req.on('error', rejectP);
    req.end();
  });
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

  await step('GET /api/live as the GM with an upgrade: 101, the first frame is {"hello":1}, and a ping is answered with pong', async () => {
    const r = await openLive(GM);
    try {
      expect(r.status === 101, 'expected 101, got ' + r.status + ' ' + (r.text || ''));
      expect(r.frames[0].opcode === 1 && r.frames[0].text === '{"hello":1}', 'first frame: ' + JSON.stringify(r.frames[0]));
      r.send('ping');
      await r.until(2, 8000);
      expect(r.frames[1].opcode === 1 && r.frames[1].text === 'pong', 'ping -> pong, got ' + JSON.stringify(r.frames[1]));
    } finally { if (r.socket) r.socket.destroy(); }
  });

  await step('GET /api/live: the player and the display (MD1b) open sockets too, each answers a ping; without an upgrade every role is 426, and the display may only GET', async () => {
    for (const [who, user] of [['player', PLAYER], ['display', IPAD]]) {
      const r = await openLive(user);
      try {
        expect(r.status === 101 && r.frames[0].text === '{"hello":1}', who + ': expected 101 and hello, got ' + r.status + ' ' + (r.text || ''));
        r.send('ping'); await r.until(2, 8000);
        expect(r.frames[1].text === 'pong', who + ': pong');
      } finally { if (r.socket) r.socket.destroy(); }
    }
    for (const user of [GM, PLAYER, IPAD]) status(await call('GET', '/api/live', { user }), 426);
    status(await call('POST', '/api/live', { user: IPAD }), 403);
    status(await call('PUT', '/api/live', { user: IPAD, body: {} }), 403);
  });

  await step('live pokes: each role hears only its kinds, in the order of the writes; a poke is exactly { k, t }; a player who sends the role header is still a player', async () => {
    const gm = await openLive(GM), player = await openLive(PLAYER), display = await openLive(IPAD), spoof = await openLive(PLAYER, { 'X-B68-Role': 'gm' });
    const all = [gm, player, display, spoof];
    try {
      expect(all.every((s) => s.status === 101), 'all four opened');
      let heard = 1; // the GM has heard its hello
      // every write is followed by waiting for the GM to hear it, so the order of the pokes is the order of the writes
      const write = async (label, p) => { const r = await p; expect(r.status >= 200 && r.status < 300, label + ': ' + r.status + ' ' + r.text.slice(0, 200)); heard++; await gm.until(heard, 10000); return r; };
      await write('player character', call('PUT', '/api/characters/char_live_sock', { user: PLAYER, body: { name: 'Invented Socket Scoundrel' } }));
      await write('ambient', call('PATCH', '/api/gm/ambient', { user: GM, body: { mode: 'pin', scene: 'testcard' } }));
      await write('display', call('PUT', '/api/gm/display', { user: GM, body: { kind: 'text', text: 'invented' } }));
      const wantNow = (await call('GET', '/api/gm/stt', { user: GM })).json.doc.want;   // earlier steps may have set it: flip it, since only a change pokes
      await write('stt', call('PATCH', '/api/gm/stt', { user: GM, body: { want: wantNow === 'on' ? 'off' : 'on' } }));
      await write('stt status changes', call('PATCH', '/api/gm/stt', { user: IPAD, body: { status: { state: 'listening', lines: 7 } } }));
      for (let i = 0; i < 2; i++) status(await call('PATCH', '/api/gm/stt', { user: IPAD, body: { status: { state: 'listening', lines: 7 } } }), 200);   // heartbeats: same content, a new `at`: no poke
      await write('uncued transcript line: no poke', call('POST', '/api/gm/transcript', { user: IPAD, body: { lines: [{ id: 'sock1', at: '2030-01-01T09:30:00.000Z', text: 'An invented line.' }] } }).then((r) => { heard--; return r; }));
      await write('cued transcript line', call('POST', '/api/gm/transcript', { user: IPAD, body: { lines: [{ id: 'sock2', at: '2030-01-01T09:30:01.000Z', text: 'An invented cued line.', cue: true }] } }));
      await write('campaign', call('PATCH', '/api/campaign', { user: GM, body: { crew: { heat: 1 } } }));
      await write('npc', call('POST', '/api/npcs', { user: GM, body: { name: 'Invented Socket Fence', revealed: false } }));
      // the closing pair: each of these is heard by one group only, so a kind that leaked earlier would sit before it
      await write('ambient again', call('PATCH', '/api/gm/ambient', { user: GM, body: { mode: 'auto' } }));
      await write('character again', call('PATCH', '/api/characters/char_live_sock', { user: PLAYER, body: { stress: 1 } }));
      await sleepMs(300); // a late poke to the wrong socket would land inside this
      const kinds = (s) => s.messages().slice(1).map((m) => m.k);
      expect(JSON.stringify(kinds(gm)) === JSON.stringify(['characters', 'ambient', 'display', 'stt', 'stt', 'cue', 'campaign', 'npcs', 'ambient', 'characters']), 'GM heard ' + JSON.stringify(kinds(gm)));
      expect(JSON.stringify(kinds(player)) === JSON.stringify(['characters', 'screen', 'campaign', 'npcs', 'characters']), 'player heard ' + JSON.stringify(kinds(player)));   // 'screen' is the display PUT with the phones' mirror on (MM1); the display role and the GM never hear it
      expect(JSON.stringify(kinds(spoof)) === JSON.stringify(kinds(player)), 'the spoofing player heard what a player hears: ' + JSON.stringify(kinds(spoof)));
      expect(JSON.stringify(kinds(display)) === JSON.stringify(['ambient', 'display', 'stt', 'stt', 'ambient']), 'display heard ' + JSON.stringify(kinds(display)));
      for (const s of all) {
        expect(s.messages()[0].hello === 1, 'hello first');
        for (const m of s.messages().slice(1)) {
          expect(Object.keys(m).sort().join() === 'k,t', 'a poke carries only k and t: ' + JSON.stringify(m));
          expect(typeof m.k === 'string' && Number.isInteger(m.t) && Math.abs(Date.now() - m.t) < 120000, 'k is a kind and t a time: ' + JSON.stringify(m));
        }
        expect(s.frames.every((f) => f.opcode === 1), 'text frames only (no close frame while the switch is on)');
      }
    } finally { all.forEach((s) => s.socket && s.socket.destroy()); }
  });

  await step('live switch (real): a GM state write that leaves live alone closes nothing; the flip to off closes every open socket with 1000; a second write of false closes nothing new', async () => {
    status(await call('PATCH', '/api/gm/state', { user: GM, body: { live: true } }), 200);
    const gm = await openLive(GM), player = await openLive(PLAYER), display = await openLive(IPAD);
    const all = [gm, player, display];
    try {
      status(await call('PATCH', '/api/gm/state', { user: GM, body: { ui: { tab: 'C' } } }), 200);
      status(await call('PATCH', '/api/gm/state', { user: GM, body: { live: true } }), 200);
      await sleepMs(500);
      expect(all.every((s) => !s.closeFrame() && !s.socket.destroyed && s.frames.length === 1), 'still open, only hello heard, after writes that do not flip it');
      status(await call('PATCH', '/api/gm/state', { user: GM, body: { live: false } }), 200);
      for (const s of all) {
        for (let i = 0; i < 100 && !s.closeFrame(); i++) await sleepMs(100);
        expect(s.closeFrame() && s.closeFrame().code === 1000, 'closed with 1000: ' + JSON.stringify(s.closeFrame()));
      }
    } finally { all.forEach((s) => s.socket && s.socket.destroy()); status(await call('PATCH', '/api/gm/state', { user: GM, body: { live: true } }), 200); }
  });

  await step('live switch (real): GM state { live: false } reaches the phone poll and the display answers, closes the door to new sockets, and { live: true } reopens it', async () => {
    const before = await call('GET', '/api/characters', { user: PLAYER }); status(before, 200);
    expect(before.json.live === true, 'on by default: ' + before.json.live);
    status(await call('PATCH', '/api/gm/state', { user: GM, body: { live: false } }), 200);
    const off = await call('GET', '/api/characters', { user: PLAYER });
    expect(off.json.live === false, 'phone poll: ' + off.json.live);
    const d = await call('GET', '/api/gm/display', { user: IPAD });
    expect(d.json.live === false, 'display answer: ' + d.json.live);
    const cur = await call('GET', '/api/gm/display?seq=' + d.json.seq + '&aseq=' + d.json.ambient.seq + '&sseq=' + d.json.stt.seq, { user: IPAD });
    expect(cur.json.unchanged === true && cur.json.live === false, 'display answer, everything current: ' + cur.text.slice(0, 160));
    const refused = await openLive(PLAYER);
    expect(refused.status === 503 && !refused.socket, 'no socket while off: ' + refused.status);
    status(await call('PATCH', '/api/gm/state', { user: GM, body: { live: true } }), 200);
    const on = await openLive(PLAYER);
    try { expect(on.status === 101, 'reopened: ' + on.status); } finally { if (on.socket) on.socket.destroy(); }
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
