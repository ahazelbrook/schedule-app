// The quiet line and the Debrief against a real `wrangler dev` (suite tickets 5.8 and 1.7): the role matrix and the live pokes. The GM, the table display, players A and B.
// Invented emails and GM-ONLY- markers only.
//
//   node checks/api/quiet.mjs        (PORT defaults to 9150, lane P's range 9150-9199; Windows: wrangler is started with a shell)
//
// What it holds:
//   5.8   A's quiet row is read by the GM and by A; B and the display list nothing of it, whatever the query (kind, owner, since); B cannot write, delete or
//         overwrite it. The poke it fires is the `quiet` kind: ONLY the GM's socket hears it, not the display's, not B's, and not A's own other pages. A
//         `docs` poke is never fired by it. The GM's dismiss is a DELETE of the row; the rest of the table hears nothing of that either.
//   1.7   the GM writes A and B a `debrief` row each (scope player); A reads only A's, B only B's, the display neither; A's reply goes into A's own row
//         and the GM reads it back with the GM's fields carried; A cannot write B's row, a public row, or a kind that is not hers; the GM's fresh send never
//         overwrites a reply (the controller skips a row sent this night: tested in checks/runtime/suite-b21-debrief.test.mjs).

import { spawn, spawnSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KINDS, rolesFor } from '../../functions/_lib/live.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 9150);
const GM = 'gm@example.test', IPAD = 'table.ipad@example.test', A = 'alice@example.test', B = 'bea@example.test';
const MARK = 'GM-ONLY-quiet-marker';
const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler');
const stateDir = mkdtempSync(join(tmpdir(), 'b68-quiet-check-'));
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
function status(r, s) { expect(r.status === s, 'expected ' + s + ', got ' + r.status + ' ' + r.text.slice(0, 300)); }

async function main() {
  await step('no server: the quiet kind is told to the GM alone; docs still goes to every role', () => {
    expect(JSON.stringify(KINDS.quiet) === JSON.stringify(['gm']) && rolesFor('quiet').join() === 'gm', 'KINDS.quiet: ' + JSON.stringify(KINDS.quiet));
    expect(rolesFor('docs').length === 3, 'KINDS.docs unchanged');
  });
  const busy = await fetch('http://127.0.0.1:' + PORT + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
  if (busy) throw new Error('port ' + PORT + ' is already in use: stop what is on it, or set PORT');
  const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist], { cwd: ROOT, env: envOf, encoding: 'utf8', shell: process.platform === 'win32' });
  if (mig.status !== 0) throw new Error('migrations failed:\n' + mig.stdout + mig.stderr);
  server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
    '--persist-to', persist, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'DISPLAY_EMAILS:' + IPAD, '--var', 'CAMPAIGN:quietcheck'],
  { cwd: ROOT, env: envOf, detached: process.platform !== 'win32', stdio: 'ignore', shell: process.platform === 'win32' });
  let up = false;
  for (let i = 0; i < 180 && !up; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/index.html', { signal: AbortSignal.timeout(2000) }); up = r.status > 0; } catch (_) {} if (!up) await sleep(500); }
  if (!up) throw new Error('server did not start on ' + PORT);
  console.log('server up on ' + PORT);

  const put = (user, body) => call('PUT', '/api/docs', { user, body });
  const list = (user, q = '') => call('GET', '/api/docs' + q, { user });
  const openLive = (user) => new Promise((resolveP, rejectP) => {
    const headers = { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': Buffer.from('b68-quiet-check-key').toString('base64'), 'X-Dev-User': user };
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
  const sees = (r) => (r.json.docs || []).map((d) => d.kind + '/' + d.owner);

  await step('5.8 pokes: A\'s quiet write reaches the GM socket as { k: "quiet", t } and NO other socket (not the display, not B, not A); no docs poke; the dismiss tells nobody else', async () => {
    const socks = { gm: await openLive(GM), display: await openLive(IPAD), a: await openLive(A), b: await openLive(B) };
    try {
      for (const s of Object.values(socks)) expect(s.status === 101, 'socket ' + s.status);
      const seen = (s, k) => s.messages().filter((m) => m.k === k);
      status(await put(A, { kind: 'quiet', scope: 'player', json: { v: 1, items: [{ k: 'xcard', at: Date.now() }, { k: 'note', at: Date.now(), text: MARK + ' secret' }] } }), 200);
      await socks.gm.until(2);
      await sleep(900);
      const f = seen(socks.gm, 'quiet');
      expect(f.length === 1 && Object.keys(f[0]).sort().join() === 'k,t' && Number.isFinite(f[0].t), 'gm frames: ' + JSON.stringify(socks.gm.messages()));
      for (const [n, s] of Object.entries(socks)) {
        expect(seen(s, 'docs').length === 0, n + ' heard a docs poke: ' + JSON.stringify(s.messages()));
        if (n !== 'gm') expect(seen(s, 'quiet').length === 0 && !JSON.stringify(s.frames.map((x) => x.text)).includes('xcard'), n + ' heard the quiet line: ' + JSON.stringify(s.messages()));
        expect(!JSON.stringify(s.frames.map((x) => x.text)).includes(MARK), n + ' got the data in a poke');
      }
      status(await call('DELETE', '/api/docs?kind=quiet&owner=' + A, { user: GM }), 200);
      await socks.gm.until(3);
      await sleep(700);
      expect(seen(socks.gm, 'quiet').length === 2, 'the GM was told of the dismiss');
      for (const n of ['display', 'a', 'b']) expect(socks[n].messages().filter((m) => m.k === 'quiet' || m.k === 'docs').length === 0, n + ' heard the dismiss: ' + JSON.stringify(socks[n].messages()));
    } finally { for (const s of Object.values(socks)) if (s.socket) s.socket.destroy(); }
  });

  await step('5.8 role matrix: the GM and A read A\'s quiet row; B and the display read nothing of it by any query, and B cannot write, overwrite or delete it', async () => {
    status(await put(A, { kind: 'quiet', scope: 'player', json: { v: 1, items: [{ k: 'xcard', at: 1 }, { k: 'note', at: 2, text: MARK + ' secret' }] } }), 200);
    for (const q of ['', '?kind=quiet', '?kind=quiet&owner=' + A, '?owner=' + A, '?since=2000-01-01T00:00:00Z&kind=quiet', '?limit=200']) {
      const g = await list(GM, q), a = await list(A, q), b = await list(B, q), d = await list(IPAD, q);
      status(g, 200); status(a, 200); status(b, 200); status(d, 200);
      expect(sees(g).includes('quiet/' + A) && sees(a).includes('quiet/' + A), 'GM and A see it for ' + q + ': ' + g.text);
      for (const [n, r] of [['B', b], ['display', d]]) expect(!r.text.includes('quiet') && !r.text.includes(MARK) && !r.text.includes('xcard'), n + ' saw it for ' + q + ': ' + r.text);
    }
    status(await put(B, { kind: 'quiet', owner: A, scope: 'player', json: { v: 1, items: [] } }), 403);
    status(await call('DELETE', '/api/docs?kind=quiet&owner=' + A, { user: B }), 403);
    status(await put(IPAD, { kind: 'quiet', json: { v: 1, items: [] } }), 403);
    status(await put(B, { kind: 'quiet', scope: 'public', json: { v: 1, items: [] } }), 403);   // a player cannot make a quiet line public
    const b = await put(B, { kind: 'quiet', scope: 'player', json: { v: 1, items: [{ k: 'pause', at: 3 }] } }); status(b, 200);
    const ga = await list(GM, '?kind=quiet&owner=' + A);
    expect(JSON.stringify(ga.json.docs[0].json).includes(MARK), 'A\'s row is still A\'s: ' + ga.text);
    const lb = await list(B, '?kind=quiet'); expect(sees(lb).join() === 'quiet/' + B && !lb.text.includes(MARK), 'B reads only B\'s: ' + lb.text);
    status(await call('DELETE', '/api/docs?kind=quiet&owner=' + A, { user: GM }), 200);
    status(await call('DELETE', '/api/docs?kind=quiet&owner=' + B, { user: GM }), 200);
  });

  await step('1.7 role matrix: the GM writes A and B a debrief each; each reads only theirs; the display reads neither; A\'s reply lands in A\'s own row, carried over the GM\'s fields; A cannot touch B\'s', async () => {
    const row = (who) => ({ v: 1, nightAt: 1000, sentAt: 1000, from: 2000, due: 3000, steps: ['unwind', 'xp', 'credits'], options: [{ id: 'heat', label: 'Lay low' }], defaults: { unwind: 'heat' }, who });
    status(await put(GM, { kind: 'debrief', owner: A, scope: 'player', json: row('A') }), 200);
    status(await put(GM, { kind: 'debrief', owner: B, scope: 'player', json: row('B') }), 200);
    const la = await list(A, '?kind=debrief'), lb = await list(B, '?kind=debrief'), ld = await list(IPAD, '?kind=debrief'), lg = await list(GM, '?kind=debrief');
    expect(sees(la).join() === 'debrief/' + A && la.json.docs[0].json.who === 'A', 'A reads A: ' + la.text);
    expect(sees(lb).join() === 'debrief/' + B && lb.json.docs[0].json.who === 'B', 'B reads B: ' + lb.text);
    expect(ld.json.docs.length === 0, 'the display reads none: ' + ld.text);
    expect(lg.json.docs.length === 2, 'the GM reads both');
    const named = await list(A, '?kind=debrief&owner=' + B); expect(named.json.docs.length === 0, 'A asking for B\'s by name gets nothing: ' + named.text);
    const reply = { ...row('A'), reply: { at: 2500, unwind: { pick: 'heat', note: 'a quiet week' }, xp: { ticked: true, note: '' } } };
    status(await put(A, { kind: 'debrief', scope: 'player', json: reply }), 200);
    const g = await list(GM, '?kind=debrief&owner=' + A);
    expect(g.json.docs[0].json.reply.unwind.pick === 'heat' && g.json.docs[0].json.due === 3000 && g.json.docs[0].json.steps.length === 3, 'the GM reads the reply with the fields carried: ' + g.text);
    const gb = await list(GM, '?kind=debrief&owner=' + B); expect(!('reply' in gb.json.docs[0].json), 'B\'s row has no reply');
    status(await put(A, { kind: 'debrief', owner: B, scope: 'player', json: reply }), 403);
    status(await put(A, { kind: 'debrief', scope: 'public', json: reply }), 403);
    status(await call('DELETE', '/api/docs?kind=debrief&owner=' + B, { user: A }), 403);
    status(await put(IPAD, { kind: 'debrief', json: reply }), 403);
    status(await call('DELETE', '/api/docs?kind=debrief&owner=' + A, { user: GM }), 200);
    status(await call('DELETE', '/api/docs?kind=debrief&owner=' + B, { user: GM }), 200);
  });
}

const timer = setTimeout(() => { console.log('FAIL overall timeout'); stop(); process.exit(1); }, Number(process.env.CHECK_TIMEOUT_MS || 240000));
try { await main(); } catch (e) { failures++; console.log('FAIL setup\n     ' + (e && e.message || e)); }
clearTimeout(timer);
console.log('\n' + passes + ' passed, ' + failures + ' failed');
stop();
process.exit(failures ? 1 : 0);
