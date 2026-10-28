// The GM tools' API against a local `wrangler dev` (see GM.md, HOSTING.md): /api/gm/pack, /api/gm/state,
// /api/gm/ambient (docs/history/AMBIENT-PLAN.md) and /api/gm/display are GM only (403 for a player on every method, before the body is read; 401 without a token), the
// caps and validation, the unchanged answers, /api/export carrying none of it, and no GM key on /api/characters (for
// anyone). Every table, name and sentence in here is invented: the real pack is never in this repository.
//
//   node checks/api/gm.mjs            (or: npm run check:gm-api, part of npm run check:api)
//
// Applies migrations/ to a throwaway local D1 first, then starts the Worker on PORT (default 8843) with DEV_USER set.

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { worker, matchApi } from '../../worker/app.js';
import { onRequest as gmPack } from '../../functions/api/gm/pack.js';
import { onRequest as gmState } from '../../functions/api/gm/state.js';
import { onRequest as gmDisplay } from '../../functions/api/gm/display.js';
import { onRequest as gmAmbient } from '../../functions/api/gm/ambient.js';
import { gmNotFound } from '../../functions/_lib/gm.js';
import { onRequest as notFound } from '../../functions/api/[[path]].js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 8843);
const GM = 'gm@example.test';
const PLAYER = 'player@example.test';
const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler');
const OVERALL_TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS || 240000);
const KiB = 1024;
const L = { partBody: 900 * KiB, parts: 12, src: 2 * KiB, state: 256 * KiB, svg: 600 * KiB, text: 2000, rule: 40000 };
const stateDir = mkdtempSync(join(tmpdir(), 'b68-gm-check-'));
const persist = join(stateDir, 'state');
let server = null, passes = 0, failures = 0;

function stop() {
  if (server) {
    // the process group on POSIX; on Windows the shell's whole tree (wrangler and workerd under it)
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
const gm = (method, path, body) => call(method, path, { user: GM, body });
const player = (method, path, body) => call(method, path, { user: PLAYER, body });
async function step(name, fn) {
  try { await fn(); passes++; console.log('PASS ' + name); } catch (e) { failures++; console.log('FAIL ' + name + '\n     ' + (e && e.message || e)); }
}
function expect(cond, msg) { if (!cond) throw new Error(msg); }
function status(r, s) { expect(r.status === s, 'expected ' + s + ', got ' + r.status + ' ' + r.text.slice(0, 300)); }
const hash12 = (text) => createHash('sha256').update(text).digest('hex').slice(0, 12);

// ---------- invented fixtures ----------
const MARK = 'quixotic-marmalade';   // must never leave through /api/export
const consolePart = {
  part: 'console',
  src: { file: 'Fixture/console.md', blockSha: 'abc123', exportedAt: '2026-10-14T00:00:00.000Z' },
  body: { T: { weather: ['A fog of ' + MARK, 'Sideways drizzle'], omen: { lo: ['A cat on a fence'], hi: ['A bell nobody rang'] } } },
};
const locationPart = {
  part: 'location',
  src: { file: 'Fixture/location.md' },
  body: { T: { rooms: ['Boiler room', 'Pigeon loft'] }, extra: { DOORS: ['Bricked up', 'Painted shut'] } },
};
const svgOk = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10">' +
  '<defs><linearGradient id="g"><stop offset="0" stop-color="#000"/></linearGradient></defs>' +
  '<rect width="10" height="10" fill="url(#g)" style="fill: url(\'#g\')"/><use href="#g"/><use xlink:href="#g"/>' +
  '<image href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/><text x="1" y="5">A moonlit ' + MARK + '</text></svg>';

// ---------- no server: the router, the middleware, and the role check before the body ----------

await step('router: /api/gm/pack, /state and /display map to their handlers; any other /api/gm path to the GM-only 404', async () => {
  for (const [p, h] of [['/api/gm/pack', gmPack], ['/api/gm/pack/', gmPack], ['/api/gm/state', gmState], ['/api/gm/display', gmDisplay], ['/api/gm/display/', gmDisplay],
    ['/api/gm/ambient', gmAmbient], ['/api/gm/ambient/', gmAmbient]]) {
    expect(matchApi(p).handler === h, p);
  }
  for (const p of ['/api/gm', '/api/gm/', '/api/gm/nope', '/api/gm/pack/x', '/api/gm/state/a/b', '/api/gm/ambient/x']) expect(matchApi(p).handler === gmNotFound, p);
  expect(matchApi('/api/gmx').handler === notFound && matchApi('/api/gm-pack').handler === notFound, 'other paths stay the plain 404');
});

await step('without a token every /api/gm path and method is 401, no-store', async () => {
  for (const [m, p] of [['GET', '/api/gm/pack'], ['POST', '/api/gm/pack'], ['DELETE', '/api/gm/pack?part=console'], ['GET', '/api/gm/state'],
    ['PATCH', '/api/gm/state'], ['GET', '/api/gm/display'], ['PUT', '/api/gm/display'], ['GET', '/api/gm/ambient'], ['PATCH', '/api/gm/ambient'],
    ['GET', '/api/gm/other']]) {
    const r = await worker.fetch(new Request('https://blades.example.test' + p, { method: m }), { CAMPAIGN: 'x' }, {});
    expect(r.status === 401, m + ' ' + p + ': ' + r.status);
    expect(r.headers.get('Cache-Control') === 'no-store', m + ' ' + p + ': cache-control');
  }
});

await step('the role is checked before anything else: a player never reaches the body, the method check or the database', async () => {
  const touched = [];
  const request = (method) => ({
    method, url: 'https://blades.example.test/api/gm/x', headers: new Headers({ 'Content-Length': String(50 * 1024 * 1024) }),
    arrayBuffer() { touched.push('arrayBuffer'); throw new Error('read'); }, json() { touched.push('json'); throw new Error('read'); },
    text() { touched.push('text'); throw new Error('read'); }, get body() { touched.push('body'); return null; },
  });
  const env = { get DB() { touched.push('DB'); return undefined; }, CAMPAIGN: 'x' };
  for (const h of [gmPack, gmState, gmDisplay, gmAmbient, gmNotFound]) {
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      for (const me of [{ role: 'player', id: PLAYER }, undefined]) {
        let err = null;
        try { await h({ request: request(m), env, data: { me } }); } catch (e) { err = e; }
        expect(err && err.status === 403, m + ': expected a 403, got ' + (err ? err.status + ' ' + err.message : 'an answer'));
      }
    }
  }
  expect(!touched.length, 'touched: ' + touched.join());
});

// ---------- the server ----------

async function main() {
  const busy = await fetch('http://127.0.0.1:' + PORT + '/api/me', { signal: AbortSignal.timeout(1500) }).then(() => true, () => false);
  if (busy) throw new Error('port ' + PORT + ' is already in use: stop what is on it, or set PORT');
  const mig = spawnSync(WRANGLER, ['d1', 'migrations', 'apply', 'DB', '--local', '--persist-to', persist],
    { cwd: ROOT, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, encoding: 'utf8', shell: process.platform === 'win32' });
  if (mig.status !== 0) throw new Error('migrations failed:\n' + mig.stdout + mig.stderr);
  server = spawn(WRANGLER, ['dev', '--port', String(PORT), '--ip', '127.0.0.1', '--inspector-port', String(PORT + 20000), '--show-interactive-dev-session', 'false',
    '--persist-to', persist, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'DISPLAY_EMAILS:table.ipad@example.test', '--var', 'CAMPAIGN:gmcheck'],
  { cwd: ROOT, env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' }, detached: process.platform !== 'win32', stdio: 'ignore', shell: process.platform === 'win32' });
  let up = false;
  for (let i = 0; i < 180 && !up; i++) { try { const r = await fetch('http://127.0.0.1:' + PORT + '/index.html', { signal: AbortSignal.timeout(2000) }); up = r.status > 0; } catch (_) {} if (!up) await sleep(500); }
  if (!up) throw new Error('server did not start on ' + PORT);
  console.log('server up on ' + PORT);

  await step('a player is refused (403) on every method of every /api/gm route, and an oversized body is still 403, not 413', async () => {
    const big = JSON.stringify({ part: 'console', body: { x: 'y'.repeat(2 * 1024 * 1024) } });
    for (const [m, p] of [['GET', '/api/gm/pack'], ['GET', '/api/gm/pack?part=console'], ['POST', '/api/gm/pack'], ['DELETE', '/api/gm/pack?part=console'],
      ['PUT', '/api/gm/pack'], ['GET', '/api/gm/state'], ['PATCH', '/api/gm/state'], ['POST', '/api/gm/state'], ['GET', '/api/gm/display'],
      ['GET', '/api/gm/display?seq=0'], ['PUT', '/api/gm/display'], ['POST', '/api/gm/display'], ['GET', '/api/gm/nope']]) {
      const r = await call(m, p, { user: PLAYER, raw: m === 'GET' || m === 'DELETE' ? undefined : '{"kind":"text","text":"hi"}' });
      status(r, 403);
      expect(/only the GM/.test(r.json && r.json.error), m + ' ' + p + ': ' + r.text);
      expect(r.headers.get('cache-control') === 'no-store', 'no-store');
    }
    for (const p of ['/api/gm/pack', '/api/gm/state', '/api/gm/display']) {
      const r = await call(p.endsWith('pack') ? 'POST' : p.endsWith('state') ? 'PATCH' : 'PUT', p, { user: PLAYER, raw: big });
      status(r, 403);
      const g = await call(p.endsWith('pack') ? 'POST' : p.endsWith('state') ? 'PATCH' : 'PUT', p, { user: GM, raw: big });
      status(g, 413);   // the same body from the GM is read, and refused for its size
    }
    status(await player('POST', '/api/gm/pack', consolePart), 403);
    const idx = await gm('GET', '/api/gm/pack');
    expect(idx.json.version === '0' && Object.keys(idx.json.parts).length === 0, 'nothing stored: ' + idx.text);
  });

  let v1;
  let SVG_CASES = [];   // [svg value, status, error pattern]: filled by the display validation step, replayed for the ambient score
  await step('GM imports two parts; the index lists them (no bodies) and a part reads back as stored', async () => {
    let r = await gm('GET', '/api/gm/pack'); status(r, 200);
    expect(r.json.version === '0' && JSON.stringify(r.json.parts) === '{}', 'empty index: ' + r.text);
    r = await gm('POST', '/api/gm/pack', consolePart); status(r, 200);
    expect(r.json.ok === true && r.json.part === 'console' && r.json.unchanged === false && r.json.version === hash12(JSON.stringify(consolePart.body)), r.text);
    r = await gm('POST', '/api/gm/pack', locationPart); status(r, 200);
    expect(r.json.version === hash12(JSON.stringify(locationPart.body)) && typeof r.json.packVersion === 'string', r.text);
    r = await gm('GET', '/api/gm/pack'); status(r, 200);
    expect(Object.keys(r.json.parts).sort().join() === 'console,location', 'parts ' + Object.keys(r.json.parts));
    expect(r.json.parts.console.version === hash12(JSON.stringify(consolePart.body)) && r.json.parts.console.src.blockSha === 'abc123', JSON.stringify(r.json.parts.console));
    expect(typeof r.json.parts.console.updatedAt === 'string' && r.json.parts.console.bytes === JSON.stringify(consolePart.body).length, 'updatedAt, bytes');
    expect(!r.text.includes(MARK) && !('body' in r.json.parts.console), 'the index carries no bodies');
    v1 = r.json.version;
    expect(v1 !== '0', 'the version moved');
    r = await gm('GET', '/api/gm/pack?part=console'); status(r, 200);
    expect(r.json.part === 'console' && r.json.version === hash12(JSON.stringify(consolePart.body)) && JSON.stringify(r.json.body) === JSON.stringify(consolePart.body), r.text.slice(0, 300));
    expect(r.json.src.file === 'Fixture/console.md' && r.headers.get('content-type').startsWith('application/json') && r.headers.get('cache-control') === 'no-store', 'src, headers');
    r = await gm('GET', '/api/gm/pack?part=location'); status(r, 200);
    expect(JSON.stringify(r.json.body.extra.DOORS) === '["Bricked up","Painted shut"]', r.text);
  });

  await step('unchanged: the same part again writes nothing; ?v= answers without a body; a change moves both versions', async () => {
    const before = (await gm('GET', '/api/gm/pack')).json;
    let r = await gm('POST', '/api/gm/pack', consolePart); status(r, 200);
    expect(r.json.unchanged === true && r.json.packVersion === v1, r.text);
    // the body as a JSON string is the same body
    r = await gm('POST', '/api/gm/pack', { ...consolePart, body: JSON.stringify(consolePart.body) }); status(r, 200);
    expect(r.json.unchanged === true, 'string body: ' + r.text);
    const after = (await gm('GET', '/api/gm/pack')).json;
    expect(after.version === v1 && after.parts.console.updatedAt === before.parts.console.updatedAt, 'nothing was written');
    r = await gm('GET', '/api/gm/pack?v=' + v1); status(r, 200);
    expect(r.json.unchanged === true && r.json.version === v1 && !('parts' in r.json), r.text);
    r = await gm('GET', '/api/gm/pack?v=stale'); expect(r.json.parts && !r.json.unchanged, 'stale index');
    const pv = after.parts.console.version;
    r = await gm('GET', '/api/gm/pack?part=console&v=' + pv); status(r, 200);
    expect(r.json.unchanged === true && r.json.version === pv && !('body' in r.json) && !r.text.includes(MARK), r.text);
    r = await gm('GET', '/api/gm/pack?part=console&v=old'); expect(r.json.body && !r.json.unchanged, 'stale part');
    // a new body
    r = await gm('POST', '/api/gm/pack', { ...consolePart, body: { T: { weather: ['Hail the size of peas'] } } }); status(r, 200);
    expect(r.json.unchanged === false && r.json.version !== pv && r.json.packVersion !== v1, r.text);
    // only src changes: the part's version stays (it hashes the body), the pack's moves
    r = await gm('POST', '/api/gm/pack', { ...locationPart, src: { file: 'Fixture/location-2.md' } }); status(r, 200);
    expect(r.json.unchanged === false && r.json.version === hash12(JSON.stringify(locationPart.body)), r.text);
    const idx = (await gm('GET', '/api/gm/pack')).json;
    expect(idx.parts.location.src.file === 'Fixture/location-2.md', 'src replaced');
    // put the console part back
    status(await gm('POST', '/api/gm/pack', consolePart), 200);
  });

  await step('pack validation: 400 for a malformed part, 404 for a missing one, 405 for other methods', async () => {
    const bad = async (body, re, raw) => {
      const r = raw !== undefined ? await call('POST', '/api/gm/pack', { user: GM, raw }) : await gm('POST', '/api/gm/pack', body);
      status(r, 400);
      expect(re.test(r.json.error), JSON.stringify(body || raw).slice(0, 80) + ' -> ' + r.text);
    };
    await bad({ body: {} }, /part must be/);
    await bad({ part: 'Console', body: {} }, /part must be/);
    await bad({ part: '', body: {} }, /part must be/);
    await bad({ part: 'a'.repeat(33), body: {} }, /part must be/);
    await bad({ part: 'a_b', body: {} }, /part must be/);
    await bad({ part: 'ok' }, /body must be a JSON object/);
    await bad({ part: 'ok', body: [1, 2] }, /body must be a JSON object/);
    await bad({ part: 'ok', body: 5 }, /body must be a JSON object/);
    await bad({ part: 'ok', body: '[1]' }, /body must be a JSON object/);
    await bad({ part: 'ok', body: '{nope' }, /body must be valid JSON/);
    await bad({ part: 'ok', body: {}, src: ['x'] }, /src must be an object/);
    await bad(null, /body must be a JSON object/, '[1]');
    await bad(null, /body must be JSON/, '{nope');
    status(await gm('GET', '/api/gm/pack?part=Bad%20Name'), 400);
    status(await gm('GET', '/api/gm/pack?part=missing'), 404);
    status(await gm('DELETE', '/api/gm/pack?part=missing'), 404);
    status(await gm('DELETE', '/api/gm/pack'), 400);
    status(await gm('PUT', '/api/gm/pack', consolePart), 405);
    status(await gm('PATCH', '/api/gm/pack', consolePart), 405);
    status(await gm('GET', '/api/gm/nope'), 404);
    const idx = (await gm('GET', '/api/gm/pack')).json;
    expect(Object.keys(idx.parts).sort().join() === 'console,location', 'nothing kept: ' + Object.keys(idx.parts));
  });

  await step('pack caps: 900 KiB per part (in bytes), 2 KiB of src, 12 parts (413); at the cap is fine; DELETE frees a slot', async () => {
    const at = { x: 'a'.repeat(L.partBody - 8) };          // {"x":"..."} is 8 bytes of JSON around the string
    expect(JSON.stringify(at).length === L.partBody, 'fixture size');
    let r = await gm('POST', '/api/gm/pack', { part: 'big', body: at }); status(r, 200);
    expect(r.json.bytes === L.partBody, 'bytes ' + r.json.bytes);
    r = await gm('POST', '/api/gm/pack', { part: 'big', body: { x: 'a'.repeat(L.partBody - 7) } }); status(r, 413);
    expect(/too large/.test(r.json.error), r.text);
    r = await gm('POST', '/api/gm/pack', { part: 'big', body: { x: 'é'.repeat(L.partBody / 2) } }); status(r, 413);   // two bytes each
    r = await gm('POST', '/api/gm/pack', { part: 'small', body: {}, src: { file: 'f'.repeat(L.src) } }); status(r, 413);
    expect(/src is too large/.test(r.json.error), r.text);
    // console, location and big are stored: nine more make twelve, the thirteenth is refused
    for (let i = 0; i < 9; i++) status(await gm('POST', '/api/gm/pack', { part: 'extra-' + i, body: { n: i } }), 200);
    r = await gm('POST', '/api/gm/pack', { part: 'one-too-many', body: {} }); status(r, 413);
    expect(/too many parts/.test(r.json.error), r.text);
    r = await gm('POST', '/api/gm/pack', { part: 'extra-0', body: { n: 'changed' } }); status(r, 200);   // replacing one is fine at the cap
    expect(Object.keys((await gm('GET', '/api/gm/pack')).json.parts).length === L.parts, 'twelve parts');
    r = await gm('DELETE', '/api/gm/pack?part=big'); status(r, 200);
    expect(r.json.ok === true && r.json.part === 'big', r.text);
    status(await gm('POST', '/api/gm/pack', { part: 'one-too-many', body: {} }), 200);
    for (const p of ['one-too-many'].concat(Array.from({ length: 9 }, (_, i) => 'extra-' + i))) status(await gm('DELETE', '/api/gm/pack?part=' + p), 200);
    expect(Object.keys((await gm('GET', '/api/gm/pack')).json.parts).sort().join() === 'console,location', 'back to two parts');
  });

  await step('display: seq starts at 0 (blank), every PUT bumps it, ?seq=N answers unchanged while it is current', async () => {
    let r = await gm('GET', '/api/gm/display'); status(r, 200);
    expect(r.json.seq === 0 && r.json.display.kind === 'blank' && r.json.updatedAt === null, r.text);
    r = await gm('GET', '/api/gm/display?seq=0'); status(r, 200);
    expect(r.json.unchanged === true && !('display' in r.json), r.text);
    r = await gm('PUT', '/api/gm/display', { kind: 'text', title: 'The Wharf', text: 'Somebody has left the lights on.', junk: 'dropped' }); status(r, 200);
    expect(r.json.seq === 1 && r.json.display.kind === 'text' && r.json.display.text === 'Somebody has left the lights on.' && r.json.display.caption === '' && !('junk' in r.json.display), r.text);
    r = await gm('GET', '/api/gm/display?seq=1'); expect(r.json.unchanged === true && r.json.seq === 1, r.text);
    r = await gm('GET', '/api/gm/display?seq=0'); expect(r.json.seq === 1 && r.json.display.title === 'The Wharf' && typeof r.json.updatedAt === 'string', r.text);
    r = await gm('PUT', '/api/gm/display', { kind: 'svg', title: 'Map', caption: 'Ground floor', svg: svgOk }); status(r, 200);
    expect(r.json.seq === 2 && r.json.display.svg === svgOk, r.text.slice(0, 200));
    r = await gm('PUT', '/api/gm/display', { kind: 'npc', npcId: 'npc_fixture-1', svg: svgOk }); status(r, 200);
    expect(r.json.seq === 3 && r.json.display.npcId === 'npc_fixture-1' && !('svg' in r.json.display), r.text.slice(0, 200));
    r = await gm('PUT', '/api/gm/display', { kind: 'blank' }); status(r, 200);
    expect(r.json.seq === 4 && r.json.display.kind === 'blank', r.text);
    r = await gm('PUT', '/api/gm/display', { kind: 'svg', svg: '  ' + svgOk }); status(r, 200);
    expect(r.json.seq === 5 && r.json.display.svg === svgOk, 'leading blanks trimmed');
    const md = '## Invented rule\n\nRoll **two dice** and keep the best.\n\n- one\n- two';
    r = await gm('PUT', '/api/gm/display', { kind: 'rule', title: 'Invented rule', caption: 'House rules', md, text: 'dropped', svg: svgOk }); status(r, 200);
    expect(r.json.seq === 6 && r.json.display.kind === 'rule' && r.json.display.md === md && r.json.display.caption === 'House rules' && !('text' in r.json.display) && !('svg' in r.json.display), r.text.slice(0, 200));
    r = await gm('GET', '/api/gm/display?seq=5'); expect(r.json.seq === 6 && r.json.display.md === md, 'a rule reads back');
    status(await gm('POST', '/api/gm/display', { kind: 'blank' }), 405);
    status(await gm('DELETE', '/api/gm/display'), 405);
  });

  await step('display ifSeq: a PUT lands only while the display is still at that seq (409 and no change otherwise); a bad ifSeq is 400; ifSeq is never stored', async () => {
    const s0 = (await gm('GET', '/api/gm/display')).json.seq;
    let r = await gm('PUT', '/api/gm/display', { kind: 'text', title: 'Live', text: 'one', ifSeq: s0 }); status(r, 200);
    expect(r.json.seq === s0 + 1 && !('ifSeq' in r.json.display), r.text);
    r = await gm('PUT', '/api/gm/display', { kind: 'text', title: 'Stale', text: 'two', ifSeq: s0 }); status(r, 409);
    r = await gm('GET', '/api/gm/display'); expect(r.json.seq === s0 + 1 && r.json.display.title === 'Live', 'a stale ifSeq changed nothing: ' + r.text);
    for (const bad of [-1, 1.5, '3', null, true]) status(await gm('PUT', '/api/gm/display', { kind: 'blank', ifSeq: bad }), 400);
    expect((await gm('GET', '/api/gm/display')).json.seq === s0 + 1, 'a bad ifSeq changed nothing');
    r = await gm('PUT', '/api/gm/display', { kind: 'blank' }); status(r, 200); expect(r.json.seq === s0 + 2, 'without ifSeq a PUT always lands');
  });

  await step('display validation: unsafe or malformed svg is 400, sizes over the caps are 413, and seq does not move', async () => {
    const seq0 = (await gm('GET', '/api/gm/display')).json.seq;
    const svg = (inner, attrs = '') => '<svg xmlns="http://www.w3.org/2000/svg"' + attrs + '>' + inner + '</svg>';
    const cases = [
      [{ kind: 'map' }, 400, /kind must be/],
      [{}, 400, /kind must be/],
      [{ kind: 'svg' }, 400, /svg must be a string/],
      [{ kind: 'svg', svg: 5 }, 400, /svg must be a string/],
      [{ kind: 'svg', svg: '<div>no</div>' }, 400, /must start with <svg/],
      [{ kind: 'svg', svg: '<svgfoo/>' }, 400, /must start with <svg/],
      [{ kind: 'svg', svg: '<?xml version="1.0"?>' + svg('') }, 400, /must start with <svg/],
      [{ kind: 'svg', svg: svg('<script>alert(1)</script>') }, 400, /<script/],
      [{ kind: 'svg', svg: svg('< SCRIPT src="#x"></SCRIPT>') }, 400, /<script/],
      [{ kind: 'svg', svg: svg('<foreignObject><div>x</div></foreignObject>') }, 400, /foreignObject/],
      [{ kind: 'svg', svg: svg('<a href="javascript:alert(1)">x</a>') }, 400, /javascript:/],
      [{ kind: 'svg', svg: svg('<rect width="1" height="1"/>', ' onload="x()"') }, 400, /event attribute/],
      [{ kind: 'svg', svg: svg('<rect/onclick=x() />') }, 400, /event attribute/],
      [{ kind: 'svg', svg: svg('<image href="https://example.test/a.png"/>') }, 400, /href must be/],
      [{ kind: 'svg', svg: svg('<use xlink:href="other.svg#x"/>') }, 400, /href must be/],
      [{ kind: 'svg', svg: svg("<image href='//example.test/a.png'/>") }, 400, /href must be/],
      [{ kind: 'svg', svg: svg('<image href=http://example.test/a.png />') }, 400, /href must be/],
      [{ kind: 'svg', svg: svg('<image src="https://example.test/a.png"/>') }, 400, /src must be/],
      [{ kind: 'svg', svg: svg('<image href="data:text/html,hi"/>') }, 400, /href must be/],
      [{ kind: 'svg', svg: svg('<rect style="fill:url(https://example.test/x)"/>') }, 400, /url\(\)/],
      [{ kind: 'svg', svg: svg('<style>@import "https://example.test/x.css";</style>') }, 400, /@import/],
      [{ kind: 'svg', svg: svg('<iframe></iframe>') }, 400, /HTML element/],
      [{ kind: 'svg', svg: svg('<set attributeName="href" to="#x"/>') }, 400, /animated href/],
      [{ kind: 'svg', svg: svg('<text>' + 'x'.repeat(L.svg) + '</text>') }, 413, /svg is too large/],
      // parity with the display page's sanitiser (checks/runtime/display.test.mjs runs the same payloads)
      [{ kind: 'svg', svg: svg('<x:script xmlns:x="http://www.w3.org/2000/svg">alert(1)</x:script>') }, 400, /<script/],
      [{ kind: 'svg', svg: svg('<x:foreignObject xmlns:x="http://www.w3.org/2000/svg"><p>hi</p></x:foreignObject>') }, 400, /foreignObject/],
      [{ kind: 'svg', svg: svg('<h:iframe xmlns:h="http://www.w3.org/1999/xhtml"/>') }, 400, /HTML element/],
      [{ kind: 'svg', svg: svg('<h:style xmlns:h="http://www.w3.org/1999/xhtml">.a{}</h:style>') }, 400, /namespaced <style>/],
      [{ kind: 'svg', svg: svg('<a href="#x"><rect/></a>') }, 400, /<a> element/],
      [{ kind: 'svg', svg: svg('<g xml:base="https://example.test/"><rect/></g>') }, 400, /xml:base/],
      [{ kind: 'svg', svg: svg('<rect fill="u\\72l(#x)"/>') }, 400, /backslash/],
      [{ kind: 'svg', svg: svg('<rect style="fill:\\75rl(#x)"/>') }, 400, /backslash/],
      [{ kind: 'svg', svg: svg('<style>.a{fill:\\75rl(#x)}</style>') }, 400, /backslash/],
      [{ kind: 'svg', svg: svg('<rect style="background:image-set(&quot;#a&quot; 1x)"/>') }, 400, /image-set/],
      [{ kind: 'svg', svg: svg('<rect style="background:src(&quot;#a&quot;)"/>') }, 400, /src\(\)/],
      [{ kind: 'svg', svg: svg('<use href="data:image/png;base64,AAAA"/>') }, 400, /must be a #fragment/],
      [{ kind: 'svg', svg: svg('<image href="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="/>') }, 400, /href must be/],
      [{ kind: 'svg', svg: svg('<rect style="fill:url(data:image/png;base64,AAAA)"/>') }, 400, /url\(\) must be a #fragment/],
      [{ kind: 'npc' }, 400, /npcId must be/],
      [{ kind: 'npc', npcId: 'bad id!' }, 400, /npcId must be/],
      [{ kind: 'npc', npcId: 'x'.repeat(81) }, 400, /npcId must be/],
      [{ kind: 'text' }, 400, /text is required/],
      [{ kind: 'text', text: '   ' }, 400, /text is required/],
      [{ kind: 'text', text: 7 }, 400, /text must be a string/],
      [{ kind: 'text', text: 'x'.repeat(L.text + 1) }, 413, /text is too long/],
      [{ kind: 'rule' }, 400, /md is required/],
      [{ kind: 'rule', md: '  ' }, 400, /md is required/],
      [{ kind: 'rule', md: ['x'] }, 400, /md must be a string/],
      [{ kind: 'rule', md: 'x'.repeat(L.rule + 1) }, 413, /md is too long/],
      [{ kind: 'blank', title: 'x'.repeat(L.text + 1) }, 413, /title is too long/],
      [{ kind: 'blank', caption: 'x'.repeat(L.text + 1) }, 413, /caption is too long/],
      [{ kind: 'blank', title: 5 }, 400, /title must be a string/],
    ];
    for (const [body, code, re] of cases) {
      const r = await gm('PUT', '/api/gm/display', body);
      expect(r.status === code && re.test(r.json && r.json.error), JSON.stringify(body).slice(0, 90) + ' -> ' + r.status + ' ' + r.text.slice(0, 160));
    }
    // the same svg refusals are replayed against the ambient score's board and iso (the ambient steps below)
    SVG_CASES = cases.filter(([b]) => b.kind === 'svg').map(([b, code, re]) => [b.svg, code, re]);
    status(await call('PUT', '/api/gm/display', { user: GM, raw: '[1]' }), 400);
    status(await call('PUT', '/api/gm/display', { user: GM, raw: '{nope' }), 400);
    // at the caps is fine
    let r = await gm('PUT', '/api/gm/display', { kind: 'text', title: 't'.repeat(L.text), caption: 'c'.repeat(L.text), text: 'x'.repeat(L.text) }); status(r, 200);
    const pad = L.svg - svg('<text></text>').length;
    r = await gm('PUT', '/api/gm/display', { kind: 'svg', svg: svg('<text>' + 'x'.repeat(pad) + '</text>') }); status(r, 200);
    r = await gm('PUT', '/api/gm/display', { kind: 'rule', md: 'x'.repeat(L.rule) }); status(r, 200);
    expect(r.json.seq === seq0 + 3, 'only the three good writes moved seq: ' + r.json.seq + ' from ' + seq0);
  });

  // ---------- the ambient document ----------
  const AMARK = 'ambient-probe-marzipan';   // must never leave through /api/export or the campaign reads
  const board = (txt) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/><text x="1" y="5">' + txt + '</text></svg>';
  const scoreOk = (extra) => ({ name: 'The Lantern Wharf Job', district: 'Eastgate', target: 'Customs shed', reveal: ['public'], view: 'plan', board: board('board ' + AMARK), iso: board('iso'), ...extra });
  const A = (body) => gm('PATCH', '/api/gm/ambient', body);
  const ambSeq = async () => (await gm('GET', '/api/gm/ambient')).json.seq;

  await step('ambient: a player gets 403 on every method before the body is read (even a malformed or oversized one); nothing is stored', async () => {
    const big = JSON.stringify({ score: { name: 'y'.repeat(3 * 1024 * 1024) } });
    for (const m of ['GET', 'PATCH', 'DELETE', 'PUT', 'POST']) {
      for (const raw of m === 'GET' || m === 'DELETE' ? [undefined] : ['{nope', '[1]', '{"mode":"pin"}', big]) {
        const r = await call(m, '/api/gm/ambient', { user: PLAYER, raw });
        status(r, 403);
        expect(/only the GM/.test(r.json && r.json.error), m + ': ' + r.text);
        expect(r.headers.get('cache-control') === 'no-store', 'no-store');
      }
    }
    const r = await gm('GET', '/api/gm/ambient'); status(r, 200);
    expect(r.json.seq === 0 && JSON.stringify(r.json.doc) === '{}' && r.json.updatedAt === null, 'empty: ' + r.text);
    for (const m of ['PUT', 'POST', 'DELETE']) status(await gm(m, '/api/gm/ambient', {}), 405);
    status(await call('PATCH', '/api/gm/ambient', { user: GM, raw: '{nope' }), 400);
    status(await call('PATCH', '/api/gm/ambient', { user: GM, raw: '[1]' }), 400);
    expect(await ambSeq() === 0, 'a refused write moves nothing');
  });

  await step('ambient: PATCH mode, scene, playlist, interval, crew and score read back; other keys dropped; arrays and crew replace', async () => {
    let r = await A({ mode: 'pin', scene: 'duskwall', junk: 1 }); status(r, 200);
    expect(r.json.seq === 1 && JSON.stringify(r.json.doc) === '{"mode":"pin","scene":"duskwall"}' && typeof r.json.updatedAt === 'string', r.text);
    const t1 = r.json.updatedAt;
    r = await A({ playlist: ['harvest', 'watch', 'board'], intervalMin: 10 }); status(r, 200);
    expect(r.json.seq === 2 && r.json.doc.mode === 'pin' && JSON.stringify(r.json.doc.playlist) === '["harvest","watch","board"]' && r.json.doc.intervalMin === 10, r.text);
    expect(r.json.updatedAt > t1, 'updatedAt moves');
    r = await A({ playlist: ['exploded'], intervalMin: 3 }); status(r, 200);
    expect(JSON.stringify(r.json.doc.playlist) === '["exploded"]' && r.json.doc.intervalMin === 3, 'playlist replaces: ' + r.text);
    r = await A({ intervalMin: 30, mode: 'auto' }); status(r, 200);
    expect(r.json.doc.intervalMin === 30 && r.json.doc.mode === 'auto', r.text);
    r = await A({ crew: { heat: 9, wanted: 4, extra: 'dropped' } }); status(r, 200);
    expect(JSON.stringify(r.json.doc.crew) === '{"heat":9,"wanted":4}', r.text);
    r = await A({ crew: { heat: 0, wanted: 0 } }); status(r, 200);
    expect(JSON.stringify(r.json.doc.crew) === '{"heat":0,"wanted":0}', 'crew replaces as a whole: ' + r.text);
    const before = Date.now();
    r = await A({ score: scoreOk({ reveal: ['secure', 'public', 'public'], view: 'rings', junk: 'dropped' }) }); status(r, 200);
    const s = r.json.doc.score;
    expect(s.name === 'The Lantern Wharf Job' && s.district === 'Eastgate' && s.target === 'Customs shed' && s.view === 'rings' && !('junk' in s), r.text.slice(0, 300));
    expect(JSON.stringify(s.reveal) === '["public","secure"]', 'reveal deduped, in band order: ' + JSON.stringify(s.reveal));
    expect(s.board === board('board ' + AMARK) && s.iso === board('iso'), 'svgs stored as sent');
    expect(Math.abs(Date.parse(s.at) - before) < 60000 && new Date(s.at).toISOString() === s.at, 'at is the server time: ' + s.at);
    r = await A({ score: scoreOk({ name: 'Kept short', at: '1999-01-01T00:00:00.000Z' }) }); status(r, 200);
    expect(r.json.doc.score.name === 'Kept short' && r.json.doc.score.at !== '1999-01-01T00:00:00.000Z', 'a sent `at` is ignored; the score replaces whole');
    const g = await gm('GET', '/api/gm/ambient'); status(g, 200);
    expect(JSON.stringify(g.json) === JSON.stringify({ seq: g.json.seq, doc: r.json.doc, updatedAt: r.json.updatedAt }) && g.json.seq === 8, 'GET reads back what PATCH answered: ' + g.text.slice(0, 200));
  });

  await step('ambient: skip:true adds one each time and survives other patches; null deletes a key; score:null clears; an empty patch writes nothing', async () => {
    let r = await A({ skip: true }); status(r, 200);
    expect(r.json.doc.skip === 1, r.text.slice(0, 200));
    r = await A({ skip: true, mode: 'off' }); status(r, 200);
    expect(r.json.doc.skip === 2 && r.json.doc.mode === 'off', 'skip with other keys');
    r = await A({ scene: 'testcard' }); expect(r.json.doc.skip === 2, 'other patches leave the counter');
    r = await A({ score: null }); status(r, 200);
    expect(!('score' in r.json.doc) && r.json.doc.skip === 2 && r.json.doc.crew.heat === 0, 'score cleared, the rest kept');
    r = await A({ scene: null, playlist: null, intervalMin: null, crew: null, mode: null }); status(r, 200);
    expect(JSON.stringify(r.json.doc) === '{"skip":2}', 'null deletes: ' + JSON.stringify(r.json.doc));
    const seq = r.json.seq;
    r = await A({}); status(r, 200);
    expect(r.json.seq === seq, 'an empty patch does not move seq');
    r = await A({ junk: true }); status(r, 200);
    expect(r.json.seq === seq && JSON.stringify(r.json.doc) === '{"skip":2}', 'a patch of only unknown keys is the same');
  });

  await step('ambient validation: malformed is 400, too long 413, and a refused patch (even one with a good key in it) changes nothing', async () => {
    const seq0 = await ambSeq();
    const cases = [
      [{ mode: 'loud' }, 400, /mode must be/], [{ mode: 5 }, 400, /mode must be/], [{ mode: '' }, 400, /mode must be/],
      [{ scene: 'nope' }, 400, /scene must be one of/], [{ scene: 5 }, 400, /scene must be one of/], [{ scene: '' }, 400, /scene must be one of/],
      [{ playlist: 'harvest' }, 400, /playlist must be a non-empty array/], [{ playlist: [] }, 400, /playlist must be a non-empty array/],
      [{ playlist: ['harvest', 'nope'] }, 400, /playlist entries must be one of/], [{ playlist: [1] }, 400, /playlist entries/],
      [{ playlist: ['watch', 'watch'] }, 400, /must not repeat/], [{ playlist: Array(17).fill('harvest') }, 413, /playlist is too long/],
      [{ intervalMin: 2 }, 400, /intervalMin must be/], [{ intervalMin: 31 }, 400, /intervalMin must be/], [{ intervalMin: 7.5 }, 400, /intervalMin must be/],
      [{ intervalMin: '7' }, 400, /intervalMin must be/], [{ intervalMin: 0 }, 400, /intervalMin must be/], [{ intervalMin: true }, 400, /intervalMin must be/],
      [{ skip: false }, 400, /skip must be true/], [{ skip: 1 }, 400, /skip must be true/], [{ skip: 'yes' }, 400, /skip must be true/], [{ skip: null }, 400, /skip must be true/],
      [{ crew: { heat: 10, wanted: 1 } }, 400, /crew\.heat/], [{ crew: { heat: -1, wanted: 1 } }, 400, /crew\.heat/], [{ crew: { heat: 1.5, wanted: 1 } }, 400, /crew\.heat/],
      [{ crew: { heat: '3', wanted: 1 } }, 400, /crew\.heat/], [{ crew: { wanted: 1 } }, 400, /crew\.heat/],
      [{ crew: { heat: 1, wanted: 5 } }, 400, /crew\.wanted/], [{ crew: { heat: 1, wanted: -1 } }, 400, /crew\.wanted/], [{ crew: { heat: 1, wanted: 2.5 } }, 400, /crew\.wanted/],
      [{ crew: { heat: 1 } }, 400, /crew\.wanted/], [{ crew: [] }, 400, /crew must be/], [{ crew: 'hot' }, 400, /crew must be/],
      [{ score: 'a score' }, 400, /score must be/], [{ score: [] }, 400, /score must be/],
      [{ score: scoreOk({ reveal: ['public', 'basement'] }) }, 400, /score\.reveal holds only/], [{ score: scoreOk({ reveal: [] }) }, 400, /score\.reveal must be/],
      [{ score: scoreOk({ reveal: 'public' }) }, 400, /score\.reveal must be/], [{ score: scoreOk({ reveal: undefined }) }, 400, /score\.reveal must be/],
      [{ score: scoreOk({ view: 'iso' }) }, 400, /score\.view must be/], [{ score: scoreOk({ view: undefined }) }, 400, /score\.view must be/],
      [{ score: scoreOk({ iso: undefined }) }, 400, /svg must be a string/], [{ score: scoreOk({ board: undefined }) }, 400, /svg must be a string/],
      [{ score: scoreOk({ iso: '' }) }, 400, /must start with <svg/], [{ score: scoreOk({ iso: null }) }, 400, /svg must be a string/],
      [{ score: scoreOk({ name: 5 }) }, 400, /score\.name must be a string/], [{ score: scoreOk({ name: 'n'.repeat(201) }) }, 413, /score\.name is too long/],
      [{ score: scoreOk({ district: 'd'.repeat(201) }) }, 413, /score\.district is too long/], [{ score: scoreOk({ target: 't'.repeat(201) }) }, 413, /score\.target is too long/],
    ];
    for (const [body, code, re] of cases) {
      // a good key beside the bad one must not be applied
      const r = await A({ scene: 'harvest', ...body });
      expect(r.status === code && re.test(r.json && r.json.error), JSON.stringify(body).slice(0, 90) + ' -> ' + r.status + ' ' + r.text.slice(0, 160));
    }
    let r = await A({ score: scoreOk({ name: 'n'.repeat(200), district: 'd'.repeat(200), target: 't'.repeat(200), reveal: ['public', 'working', 'controlled', 'secure'] }) }); status(r, 200);   // at the caps is fine
    r = await A({ score: null }); status(r, 200);
    const g = (await gm('GET', '/api/gm/ambient')).json;
    expect(g.seq === seq0 + 2 && !('scene' in g.doc), 'only the two good writes moved seq, and no scene was applied from a refused patch: ' + JSON.stringify(g).slice(0, 200));
  });

  // the table's clocks, as the campaign document holds them: a clock overlay names one by its id and the SERVER resolves its name, size and fill
  const CLOCKS = {
    c_fuse: { name: 'Invented Fuse', size: 6, filled: 2 }, c_wide: { name: 'n'.repeat(60), size: 4, filled: 0 }, c_full: { name: 'Invented Full', size: 12, filled: 12 },
    c_eight: { name: 'Invented Eight', size: 8, filled: 3 }, c_ten: { name: 'Invented Ten', size: 10, filled: 10 },
  };
  const camp = (ops) => gm('PATCH', '/api/campaign', { clockOps: ops, updatedAt: new Date().toISOString() });
  const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
  await step('setup: the campaign clocks the overlay steps name (visible ones, a hidden one, a nameless one)', async () => {
    const adds = Object.entries(CLOCKS).map(([id, c]) => ({ add: { id, ...c, kind: 'danger', hidden: false } }));
    adds.push({ add: { id: 'c_hid', name: 'HIDDEN-CLOCK-NAME', size: 4, filled: 1, kind: 'danger', hidden: true } });
    adds.push({ add: { id: 'c_blank', name: '', size: 4, filled: 1, kind: 'danger', hidden: false } });
    status(await camp(adds), 200);
    const c = (await gm('GET', '/api/campaign')).json.doc.clocks;
    expect(c.length === 7 && c.find((x) => x.id === 'c_hid').hidden === true, 'the clocks are in the campaign document');
  });

  await step('ambient overlay: every field, at its bounds; a refusal beside a good key changes nothing; the server sets at; null removes; other keys drop', async () => {
    const seq0 = await ambSeq();
    const clock = (x) => ({ id: 'ov1', kind: 'clock', ms: 8000, clockId: 'c_fuse', ...x });
    const bad = [
      [{ overlay: 'a clock' }, 400, /overlay must be/], [{ overlay: [] }, 400, /overlay must be/], [{ overlay: 7 }, 400, /overlay must be/],
      [{ overlay: clock({ id: undefined }) }, 400, /overlay\.id is required/], [{ overlay: clock({ id: '' }) }, 400, /overlay\.id is required/],
      [{ overlay: clock({ id: '   ' }) }, 400, /overlay\.id is required/], [{ overlay: clock({ id: 5 }) }, 400, /overlay\.id must be a string/],
      [{ overlay: clock({ id: 'i'.repeat(41) }) }, 413, /overlay\.id is too long/],
      [{ overlay: clock({ kind: undefined }) }, 400, /overlay\.kind must be/], [{ overlay: clock({ kind: 'wire' }) }, 400, /overlay\.kind must be/],
      [{ overlay: clock({ kind: 'Clock' }) }, 400, /overlay\.kind must be/], [{ overlay: clock({ kind: 5 }) }, 400, /overlay\.kind must be/],
      [{ overlay: clock({ ms: 999 }) }, 400, /overlay\.ms must be/], [{ overlay: clock({ ms: 180001 }) }, 400, /overlay\.ms must be/],
      [{ overlay: clock({ ms: 0 }) }, 400, /overlay\.ms must be/], [{ overlay: clock({ ms: -5000 }) }, 400, /overlay\.ms must be/],
      [{ overlay: clock({ ms: 5000.5 }) }, 400, /overlay\.ms must be/], [{ overlay: clock({ ms: '5000' }) }, 400, /overlay\.ms must be/],
      [{ overlay: clock({ ms: undefined }) }, 400, /overlay\.ms must be/], [{ overlay: clock({ ms: null }) }, 400, /overlay\.ms must be/],
      [{ overlay: clock({ clockId: undefined }) }, 400, /overlay\.clockId is a bad id/], [{ overlay: clock({ clockId: '' }) }, 400, /overlay\.clockId is a bad id/],
      [{ overlay: clock({ clockId: 5 }) }, 400, /overlay\.clockId is a bad id/], [{ overlay: clock({ clockId: 'has space' }) }, 400, /overlay\.clockId is a bad id/],
      [{ overlay: clock({ clockId: 'c'.repeat(81) }) }, 400, /overlay\.clockId is a bad id/], [{ overlay: { id: 'k', kind: 'clock', ms: 8000, name: 'Invented Fuse', size: 6, filled: 2 } }, 400, /overlay\.clockId is a bad id/],
      [{ overlay: clock({ auto: 'yes' }) }, 400, /overlay\.auto must be/], [{ overlay: clock({ auto: 1 }) }, 400, /overlay\.auto must be/],
      [{ overlay: { id: 'f', kind: 'fx', ms: 30000 } }, 400, /overlay\.fx must be/], [{ overlay: { id: 'f', kind: 'fx', ms: 30000, fx: 'dusk' } }, 400, /overlay\.fx must be/],
      [{ overlay: { id: 'f', kind: 'fx', ms: 30000, fx: 5 } }, 400, /overlay\.fx must be/],
      [{ overlay: { id: 't', kind: 'text', ms: 5000 } }, 400, /overlay\.text is required/], [{ overlay: { id: 't', kind: 'text', ms: 5000, text: '  ' } }, 400, /overlay\.text is required/],
      [{ overlay: { id: 't', kind: 'text', ms: 5000, text: 5 } }, 400, /overlay\.text must be a string/], [{ overlay: { id: 't', kind: 'text', ms: 5000, text: 'x'.repeat(121) } }, 413, /overlay\.text is too long/],
      [{ overlay: { id: 'n', kind: 'npc', ms: 5000 } }, 400, /bad id/], [{ overlay: { id: 'n', kind: 'npc', ms: 5000, npcId: 'has space' } }, 400, /bad id/],
      [{ overlay: { id: 'n', kind: 'npc', ms: 5000, npcId: 5 } }, 400, /bad id/], [{ overlay: { id: 'n', kind: 'npc', ms: 5000, npcId: '' } }, 400, /bad id/],
      [{ auto: 'yes' }, 400, /auto must be/], [{ auto: 1 }, 400, /auto must be/], [{ auto: 0 }, 400, /auto must be/], [{ auto: {} }, 400, /auto must be/],
    ];
    for (const [body, code, re] of bad) {
      const r = await A({ scene: 'harvest', ...body });   // a good key beside the bad one must not be applied
      expect(r.status === code && re.test(r.json && r.json.error), JSON.stringify(body).slice(0, 100) + ' -> ' + r.status + ' ' + r.text.slice(0, 160));
    }
    expect(await ambSeq() === seq0 && !('scene' in (await gm('GET', '/api/gm/ambient')).json.doc), 'a refused overlay stored nothing and applied no beside-key');
    // every bound that is allowed
    const edge = [
      clock({ id: 'i'.repeat(40), ms: 1000, clockId: 'c_wide' }), clock({ ms: 180000, clockId: 'c_full' }),
      clock({ clockId: 'c_eight' }), clock({ clockId: 'c_ten' }), clock({ clockId: 'c_fuse', auto: true }),
      { id: 'f', kind: 'fx', ms: 30000, fx: 'dawn' }, { id: 't', kind: 'text', ms: 1000, text: 't'.repeat(120) },
    ];
    for (const o of edge) {
      const r = await A({ overlay: o }); status(r, 200);
      const got = r.json.doc.overlay;
      expect(typeof got.at === 'string' && Math.abs(Date.parse(got.at) - Date.now()) < 60000, 'at is the server time: ' + got.at);
      const { at, ...rest } = got;
      const want = o.kind === 'clock' ? { ...o, ...CLOCKS[o.clockId] } : o;   // a clock is stored with the name, size and fill the SERVER read from the campaign
      expect(same(rest, want), 'stored as resolved: ' + JSON.stringify(rest) + ' vs ' + JSON.stringify(want));
    }
    // the server sets at, whatever the caller says; other keys (a smuggled text on a clock, a note on a dawn) are dropped; text is one line;
    // and a name, size or fill the caller sends for a clock is never kept: the document's own are
    let r = await A({ overlay: { ...clock({}), at: '1999-01-01T00:00:00.000Z', text: 'smuggled', npcId: 'npc_x', svg: '<svg/>', note: 'n', name: 'LEAK-MARKER', size: 12, filled: 0 } }); status(r, 200);
    expect(r.json.doc.overlay.at !== '1999-01-01T00:00:00.000Z' && Object.keys(r.json.doc.overlay).sort().join() === 'at,clockId,filled,id,kind,ms,name,size', 'at is the server one and other keys dropped: ' + JSON.stringify(r.json.doc.overlay));
    expect(same({ n: r.json.doc.overlay.name, s: r.json.doc.overlay.size, f: r.json.doc.overlay.filled }, { n: 'Invented Fuse', s: 6, f: 2 }) && !r.text.includes('LEAK-MARKER'), 'the clock\'s own name, size and fill, not the caller\'s: ' + JSON.stringify(r.json.doc.overlay));
    r = await A({ overlay: { id: 't', kind: 'text', ms: 5000, text: '  one\n two\t three  ', fx: 'dawn' } }); status(r, 200);
    expect(r.json.doc.overlay.text === 'one two three' && Object.keys(r.json.doc.overlay).sort().join() === 'at,id,kind,ms,text', 'text is one trimmed line: ' + JSON.stringify(r.json.doc.overlay));
    // auto
    r = await A({ auto: true }); status(r, 200); expect(r.json.doc.auto === true && r.json.doc.overlay.kind === 'text', 'auto on, the overlay untouched');
    r = await A({ auto: false }); status(r, 200); expect(r.json.doc.auto === false, 'auto false is kept');
    r = await A({ auto: null }); status(r, 200); expect(!('auto' in r.json.doc), 'auto null removes it');
    // null removes
    r = await A({ overlay: null }); status(r, 200); expect(!('overlay' in r.json.doc), 'overlay null removes it');
    r = await A({ overlay: null }); status(r, 200);
    // it rides along on the display call, which the table display sign-in reads
    r = await A({ overlay: { id: 'f', kind: 'fx', ms: 30000, fx: 'dawn' } }); status(r, 200);
    const d = (await gm('GET', '/api/gm/display')).json;
    expect(d.ambient.doc.overlay && d.ambient.doc.overlay.fx === 'dawn', 'the display GET carries the overlay: ' + JSON.stringify(d.ambient.doc));
    status(await A({ overlay: null }), 200);
    // a player cannot set one
    status(await call('PATCH', '/api/gm/ambient', { user: PLAYER, body: { overlay: { id: 'f', kind: 'fx', ms: 30000, fx: 'dawn' } } }), 403);
  });

  await step('ambient overlay: the display GET drops an overlay once the server clock passes at + ms (response only), and reports its age while it runs', async () => {
    const A = (patch) => gm('PATCH', '/api/gm/ambient', patch);
    const displays = async () => {   // every shape of the display call: the oldest, with aseq, and with aseq + sseq (stale numbers, so the ambient part is in full)
      const base = (await gm('GET', '/api/gm/display')).json;
      return [base, (await gm('GET', '/api/gm/display?seq=-1&aseq=-1')).json, (await gm('GET', '/api/gm/display?seq=-1&aseq=-1&sseq=-1')).json];
    };
    status(await A({ overlay: { id: 'short', kind: 'fx', ms: 1000, fx: 'dawn' } }), 200);
    status(await A({ auto: null }), 200);
    const seqWith = await ambSeq();
    const live = await displays();
    live.forEach((d, i) => expect(d.ambient.doc.overlay && d.ambient.doc.overlay.id === 'short' && Number.isInteger(d.ambient.doc.overlay.age) && d.ambient.doc.overlay.age >= 0 && d.ambient.doc.overlay.age < 1000, 'call ' + i + ' carries the running overlay with its age: ' + JSON.stringify(d.ambient.doc.overlay)));
    await sleep(1300);
    const gone = await displays();
    gone.forEach((d, i) => expect(d.ambient && d.ambient.doc && !('overlay' in d.ambient.doc), 'call ' + i + ' no longer carries it: ' + JSON.stringify(d.ambient.doc)));
    const held = (await gm('GET', '/api/gm/ambient')).json;
    expect(held.doc.overlay && held.doc.overlay.id === 'short' && !('age' in held.doc.overlay) && held.seq === seqWith, 'the stored document still holds it, unchanged, and seq did not move (the drop is response only): ' + JSON.stringify(held.doc.overlay));
    // a non-dawn kind expires the same way
    status(await A({ overlay: { id: 'line', kind: 'text', ms: 1000, text: 'An invented line.' } }), 200);
    expect((await displays()).every((d) => d.ambient.doc.overlay && d.ambient.doc.overlay.id === 'line'), 'the text overlay is served while it runs');
    await sleep(1300);
    expect((await displays()).every((d) => !('overlay' in d.ambient.doc)), 'and dropped once it has run out');
    // a fresh long one is served again (a new overlay, a new at)
    status(await A({ overlay: { id: 'long', kind: 'fx', ms: 60000, fx: 'dawn' } }), 200);
    expect((await displays()).every((d) => d.ambient.doc.overlay && d.ambient.doc.overlay.id === 'long' && d.ambient.doc.overlay.age < 60000), 'a long overlay is served');
    status(await A({ overlay: null }), 200);
  });

  await step('ambient overlay: an npc overlay is refused (400, nothing stored) unless that NPC is live and revealed', async () => {
    const OV = (npcId) => ({ overlay: { id: 'npc-ov', kind: 'npc', ms: 20000, npcId } });
    const put = (id, doc) => gm('PUT', '/api/npcs/' + id, doc);
    status(await put('npc_ov_hidden', { name: 'Invented Hidden Person', revealed: false }), 200);
    status(await put('npc_ov_shown', { name: 'Invented Shown Person', revealed: true }), 200);
    status(await put('npc_ov_gone', { name: 'Invented Gone Person', revealed: true }), 200);
    const seq0 = await ambSeq();
    const refuse = async (npcId, why) => {
      const r = await A({ scene: 'harvest', ...OV(npcId) });
      expect(r.status === 400 && /revealed NPC/.test(r.json && r.json.error), why + ' -> ' + r.status + ' ' + r.text.slice(0, 160));
    };
    await refuse('npc_ov_hidden', 'hidden');
    await refuse('npc_ov_missing', 'no such row');
    const doc0 = (await gm('GET', '/api/gm/ambient')).json.doc;
    expect(await ambSeq() === seq0 && !('scene' in doc0) && !('overlay' in doc0), 'the refusals stored nothing, not even the key beside them');
    const hiddenMsg = (await A(OV('npc_ov_hidden'))).json.error, missingMsg = (await A(OV('npc_ov_missing'))).json.error;
    expect(hiddenMsg === missingMsg, 'a hidden NPC reads exactly like a missing one: ' + hiddenMsg + ' / ' + missingMsg);
    // revealed: accepted, and only the NPC id is stored (no name, no description)
    let r = await A(OV('npc_ov_shown')); status(r, 200);
    expect(r.json.doc.overlay.npcId === 'npc_ov_shown' && Object.keys(r.json.doc.overlay).sort().join() === 'at,id,kind,ms,npcId', 'stored: ' + JSON.stringify(r.json.doc.overlay));
    expect(!JSON.stringify(r.json.doc).includes('Invented Shown Person'), 'no NPC text in the ambient document');
    // hidden, then revealed: refused, then accepted
    status(await A({ overlay: null }), 200);
    await refuse('npc_ov_hidden', 'still hidden');
    status(await gm('PATCH', '/api/npcs/npc_ov_hidden', { revealed: true }), 200);
    status(await A(OV('npc_ov_hidden')), 200);
    // a deleted row is refused
    status(await gm('DELETE', '/api/npcs/npc_ov_gone'), 200);
    await refuse('npc_ov_gone', 'deleted');
    // hidden again afterwards: refused again
    status(await A({ overlay: null }), 200);
    status(await gm('PATCH', '/api/npcs/npc_ov_hidden', { revealed: false }), 200);
    await refuse('npc_ov_hidden', 'revealed, then hidden again');
    status(await A({ overlay: null }), 200);
  });

  await step('ambient overlay: a clock is named by its id; a hidden, missing, removed or nameless clock is 400 in the same words with nothing stored; the caller\'s name never lands', async () => {
    const OV = (clockId, x) => ({ overlay: { id: 'ck', kind: 'clock', ms: 8000, clockId, ...x } });
    status(await A({ overlay: null }), 200);
    // positive control first: a visible clock is accepted, named from the document, whatever name the caller sent
    let r = await A(OV('c_fuse', { name: 'LEAK-MARKER', size: 12, filled: 0 })); status(r, 200);
    expect(r.json.doc.overlay.name === 'Invented Fuse' && r.json.doc.overlay.size === 6 && r.json.doc.overlay.filled === 2 && !r.text.includes('LEAK-MARKER'), 'named from the document: ' + r.text.slice(0, 200));
    status(await A({ overlay: null }), 200);
    const seq1 = await ambSeq();
    const refuse = async (clockId, why) => {
      const r2 = await A({ scene: 'harvest', ...OV(clockId, { name: 'Invented Fuse', size: 6, filled: 2 }) });   // a good name beside the id does not help
      expect(r2.status === 400 && /overlay\.clockId must be a clock the players can see/.test(r2.json && r2.json.error), why + ' -> ' + r2.status + ' ' + r2.text.slice(0, 160));
      return r2.json.error;
    };
    const hid = await refuse('c_hid', 'hidden'), miss = await refuse('c_nope', 'missing'), blank = await refuse('c_blank', 'nameless');
    expect(hid === miss && miss === blank, 'a hidden clock reads exactly like a missing one: ' + [hid, miss, blank].join(' / '));
    expect(!(hid + miss + blank).includes('HIDDEN-CLOCK-NAME'), 'and says nothing of its name');
    const held = (await gm('GET', '/api/gm/ambient')).json;
    expect(held.seq === seq1 && !('overlay' in held.doc) && !('scene' in held.doc), 'the refusals stored nothing, not even the key beside them');
    // revealing it makes the same id acceptable (the positive control for the hidden refusal); hiding it again refuses again
    status(await camp([{ id: 'c_hid', hidden: false }]), 200);
    r = await A(OV('c_hid')); status(r, 200);
    expect(r.json.doc.overlay.name === 'HIDDEN-CLOCK-NAME', 'once the players may see it, its name is the document\'s: ' + r.text.slice(0, 160));
    status(await camp([{ id: 'c_hid', hidden: true }]), 200);
    await refuse('c_hid', 'hidden again');
    // the fill is the document's, read when the overlay is set
    status(await camp([{ id: 'c_fuse', filled: 4 }]), 200);
    r = await A(OV('c_fuse')); status(r, 200); expect(r.json.doc.overlay.filled === 4, 'follows the clock: ' + r.text.slice(0, 160));
    status(await camp([{ id: 'c_fuse', filled: 2 }]), 200);
    // a removed clock is refused
    status(await camp([{ remove: 'c_eight' }]), 200);
    await refuse('c_eight', 'removed');
    // GM only
    status(await call('PATCH', '/api/gm/ambient', { user: PLAYER, body: OV('c_fuse') }), 403);
    status(await A({ overlay: null }), 200);
  });

  await step('ambient overlay: an autopilot overlay (auto: true, in the overlay or beside it) is 409 while the display is in lights out and stores nothing; a GM-pressed one is not; the display GET leaves it out under lights out', async () => {
    status(await A({ overlay: null, auto: null }), 200);
    status(await gm('PUT', '/api/gm/display', { kind: 'blank' }), 200);
    const ck = { id: 'ap1', kind: 'clock', ms: 20000, clockId: 'c_fuse' };
    const shapes = async () => {
      const d0 = (await gm('GET', '/api/gm/display')).json;
      return [d0, (await gm('GET', '/api/gm/display?seq=-1&aseq=-1')).json, (await gm('GET', '/api/gm/display?seq=-1&aseq=-1&sseq=-1')).json];
    };
    // positive controls: not dark, an autopilot overlay is accepted and marked, whichever way it says so
    let r = await A({ overlay: ck, auto: true }); status(r, 200);
    expect(r.json.doc.overlay.auto === true && r.json.doc.auto === true, 'marked: ' + JSON.stringify(r.json.doc.overlay));
    r = await A({ overlay: { ...ck, id: 'ap2', auto: true } }); status(r, 200);
    expect(r.json.doc.overlay.auto === true && r.json.doc.overlay.id === 'ap2', 'marked inside the overlay too');
    (await shapes()).forEach((d, i) => expect(d.ambient.doc.overlay && d.ambient.doc.overlay.id === 'ap2', 'while the lights are on the display GET carries it (shape ' + i + ')'));
    // lights out
    status(await gm('PUT', '/api/gm/display', { kind: 'dark' }), 200);
    (await shapes()).forEach((d, i) => expect(d.display.kind === 'dark' && d.ambient.doc && !('overlay' in d.ambient.doc), 'under lights out the display GET leaves the autopilot\'s overlay out (shape ' + i + '): ' + JSON.stringify(d.ambient.doc)));
    expect((await gm('GET', '/api/gm/ambient')).json.doc.overlay.id === 'ap2', 'the document still holds it (response only)');
    const seq0 = await ambSeq();
    for (const body of [
      { overlay: { ...ck, id: 'ap3' }, auto: true }, { overlay: { ...ck, id: 'ap4', auto: true } },
      { overlay: { id: 'ap5', kind: 'npc', ms: 5000, npcId: 'npc_ov_hidden', auto: true } }, { overlay: { id: 'ap6', kind: 'text', ms: 5000, text: 'An invented line.' }, auto: true },
    ]) {
      r = await A({ scene: 'harvest', ...body });
      expect(r.status === 409 && /lights out/.test(r.json && r.json.error), JSON.stringify(body).slice(0, 90) + ' -> ' + r.status + ' ' + r.text.slice(0, 120));
    }
    const after = (await gm('GET', '/api/gm/ambient')).json;
    expect(after.seq === seq0 && after.doc.overlay.id === 'ap2' && !('scene' in after.doc), 'the refusals stored nothing');
    // a GM-pressed overlay (the dawn) carries no auto mark and is allowed, and the display GET carries it
    r = await A({ overlay: { id: 'dawn1', kind: 'fx', ms: 30000, fx: 'dawn' } }); status(r, 200);
    expect(!('auto' in r.json.doc.overlay), 'no auto mark on the GM\'s');
    (await shapes()).forEach((d, i) => expect(d.ambient.doc.overlay && d.ambient.doc.overlay.id === 'dawn1', 'a GM-pressed dawn is carried under lights out (shape ' + i + ')'));
    // the chip alone (no overlay) is not an overlay
    status(await A({ auto: true }), 200);
    // the lights back: the autopilot's are accepted again
    status(await gm('PUT', '/api/gm/display', { kind: 'blank' }), 200);
    status(await A({ overlay: { ...ck, id: 'ap7' }, auto: true }), 200);
    status(await A({ overlay: null, auto: null }), 200);
  });

  await step('display GET joins an npc overlay to its row at read time: name, alias, role, faction and spec only, while revealed; hidden or deleted drops it; the stored overlay holds the id alone', async () => {
    const IPAD = 'table.ipad@example.test';
    const spec = { heightIn: 61, build: 'invented-spec' };
    status(await gm('PUT', '/api/npcs/npc_join', { name: 'Invented Joiner', alias: 'Join', role: 'Porter', faction: 'The Invented Guild', description: 'DESC-MARKER', gmNotes: 'GMNOTES-MARKER', tags: ['TAG-MARKER'], spec, revealed: true }), 200);
    status(await A({ overlay: null, auto: null }), 200);
    let r = await A({ overlay: { id: 'nj', kind: 'npc', ms: 60000, npcId: 'npc_join', auto: true } }); status(r, 200);
    expect(Object.keys(r.json.doc.overlay).sort().join() === 'at,auto,id,kind,ms,npcId', 'the stored overlay: ' + JSON.stringify(r.json.doc.overlay));
    expect(!(await gm('GET', '/api/gm/ambient')).text.includes('Invented Joiner'), 'no NPC name anywhere in the stored ambient document');
    const shapes = async (user) => {
      const q = (p) => call('GET', '/api/gm/display' + p, { user });
      return [await q(''), await q('?seq=-1&aseq=-1'), await q('?seq=-1&aseq=-1&sseq=-1')];
    };
    const joined = (x) => same({ n: x.name, a: x.alias, r: x.role, f: x.faction, s: JSON.stringify(x.spec) }, { n: 'Invented Joiner', a: 'Join', r: 'Porter', f: 'The Invented Guild', s: JSON.stringify(spec) }) && Object.keys(x).sort().join() === 'alias,faction,name,role,spec';
    for (const user of [GM, IPAD]) {
      for (const [i, d] of (await shapes(user)).entries()) {
        status(d, 200);
        const o = d.json.ambient.doc.overlay;
        expect(o && o.npcId === 'npc_join' && o.npc && joined(o.npc), user + ' shape ' + i + ' carries the joined fields: ' + d.text.slice(0, 260));
        expect(!/DESC-MARKER|GMNOTES-MARKER|TAG-MARKER|"revealed"|"gmNotes"|"description"|"tags"/.test(d.text), user + ' shape ' + i + ': nothing else of the row (description, gmNotes, tags, revealed)');
      }
    }
    expect((await call('GET', '/api/npcs/npc_join', { user: IPAD })).status === 403, 'the display sign-in cannot read the cast itself, so the join is how its card gets drawn');
    // the display holds what it was sent: with the ambient seq current the ambient part is "unchanged" while the NPC stays revealed
    const full = (await gm('GET', '/api/gm/display')).json, aseq = (await gm('GET', '/api/gm/ambient')).json.seq;
    const cur = (await gm('GET', '/api/gm/display?seq=' + full.seq + '&aseq=' + aseq + '&sseq=' + full.stt.seq)).json;
    expect(cur.unchanged === true && cur.ambient.unchanged === true, 'both current: ' + JSON.stringify(cur).slice(0, 160));
    // hidden: gone from every shape, for both sign-ins, and a display whose numbers are current is sent the ambient part IN FULL (without the overlay)
    status(await gm('PATCH', '/api/npcs/npc_join', { revealed: false }), 200);
    for (const user of [GM, IPAD]) {
      for (const [i, d] of (await shapes(user)).entries()) expect(!('overlay' in d.json.ambient.doc) && !d.text.includes('Invented Joiner'), user + ' shape ' + i + ' hidden: ' + d.text.slice(0, 200));
    }
    const news = (await call('GET', '/api/gm/display?seq=' + full.seq + '&aseq=' + aseq + '&sseq=' + full.stt.seq, { user: IPAD })).json;
    expect(news.ambient && news.ambient.unchanged !== true && news.ambient.doc && !('overlay' in news.ambient.doc), 'the hidden NPC is news even at a current ambient seq: ' + JSON.stringify(news).slice(0, 200));
    expect((await gm('GET', '/api/gm/ambient')).json.doc.overlay.npcId === 'npc_join', 'the stored overlay is untouched (the drop is response only)');
    // revealed again: back (the positive control for the hidden drop)
    status(await gm('PATCH', '/api/npcs/npc_join', { revealed: true }), 200);
    expect((await shapes(IPAD)).every((d) => d.json.ambient.doc.overlay && joined(d.json.ambient.doc.overlay.npc)), 'revealed again: the join returns');
    // deleted: dropped
    status(await gm('DELETE', '/api/npcs/npc_join'), 200);
    for (const [i, d] of (await shapes(IPAD)).entries()) expect(!('overlay' in d.json.ambient.doc), 'deleted, shape ' + i);
    status(await A({ overlay: null, auto: null }), 200);
    // a non-npc overlay costs no join and is served as before
    status(await A({ overlay: { id: 'fxj', kind: 'fx', ms: 60000, fx: 'dawn' } }), 200);
    expect((await shapes(IPAD)).every((d) => d.json.ambient.doc.overlay && d.json.ambient.doc.overlay.id === 'fxj' && !('npc' in d.json.ambient.doc.overlay)), 'a dawn is untouched by the join');
    status(await A({ overlay: null }), 200);
  });

  await step('ambient: every display svg refusal is replayed against score.board and score.iso', async () => {
    expect(SVG_CASES.length >= 30, 'the display step collected its svg cases: ' + SVG_CASES.length);
    const seq0 = await ambSeq();
    for (const [svg, code, re] of SVG_CASES) {
      for (const field of ['board', 'iso']) {
        const r = await A({ score: scoreOk({ [field]: svg }) });
        expect(r.status === code && re.test(r.json && r.json.error), field + ' ' + String(svg).slice(0, 70) + ' -> ' + r.status + ' ' + r.text.slice(0, 160));
      }
    }
    expect(await ambSeq() === seq0, 'nothing was stored');
  });

  await step('ambient: the stored document is capped at 1.4 MiB (413), a request at 2.5 MiB (413); nothing changes on a refusal', async () => {
    const quotes = (n) => '<svg xmlns="http://www.w3.org/2000/svg"><text>' + '"'.repeat(n) + '</text></svg>';   // every " is two bytes once stored
    const n = L.svg - 100;
    const seq0 = await ambSeq();
    let r = await A({ score: scoreOk({ board: quotes(n), iso: quotes(n) }) });
    expect(r.status === 413 && /ambient document is too large/.test(r.json.error), 'two escaped 600 KiB svgs: ' + r.status + ' ' + r.text.slice(0, 160));
    r = await A({ score: scoreOk({ board: quotes(n) }) }); status(r, 200);   // one of them fits (about 1.2 MB stored)
    expect(r.json.doc.score.board.length > 500 * KiB, 'stored');
    r = await A({ score: scoreOk({ board: board('small') }) }); status(r, 200);
    r = await A({ score: null }); status(r, 200);
    expect(await ambSeq() === seq0 + 3, 'the refused write left seq alone');
    r = await call('PATCH', '/api/gm/ambient', { user: GM, raw: JSON.stringify({ blob: 'z'.repeat(2560 * KiB) }) });
    expect(r.status === 413 && /too large/.test(r.json.error), 'request over the cap: ' + r.status + ' ' + r.text.slice(0, 100));
  });

  await step('display: the dark kind is accepted (no extra fields kept) and bumps seq', async () => {
    const seq0 = (await gm('GET', '/api/gm/display')).json.seq;
    let r = await gm('PUT', '/api/gm/display', { kind: 'dark', title: 'Lights out', text: 'dropped', svg: svgOk, npcId: 'dropped', junk: 1 }); status(r, 200);
    expect(r.json.seq === seq0 + 1 && JSON.stringify(r.json.display) === '{"kind":"dark","title":"Lights out","caption":""}', r.text.slice(0, 200));
    r = await gm('PUT', '/api/gm/display', { kind: 'dark' }); status(r, 200);
    expect(r.json.display.kind === 'dark', r.text);
    r = await gm('GET', '/api/gm/display'); expect(r.json.display.kind === 'dark', 'reads back');
    r = await gm('PUT', '/api/gm/display', { kind: 'blank' }); status(r, 200);
    r = await gm('PUT', '/api/gm/display', { kind: 'darkish' }); status(r, 400);
    expect(/kind must be one of blank, dark, svg, npc, text/.test(r.json.error), r.text);
  });

  await step('display GET carries the ambient; ?seq alone is the old call; ?seq&aseq answers unchanged per half', async () => {
    status(await A({ mode: 'auto', playlist: ['harvest', 'duskwall'], intervalMin: 7 }), 200);
    const a = await gm('GET', '/api/gm/ambient'); status(a, 200);
    const d = await gm('GET', '/api/gm/display'); status(d, 200);
    expect(Object.keys(d.json).sort().join() === 'ambient,display,seq,stt,updatedAt', 'keys ' + Object.keys(d.json));
    expect(JSON.stringify(d.json.ambient) === JSON.stringify(a.json) && d.json.ambient.doc.mode === 'auto', 'the full ambient: ' + d.text.slice(0, 200));
    const S = d.json.seq, AS = a.json.seq;
    expect(S > 1 && AS > 1, 'seqs are well past 0 and 1: ' + S + ' ' + AS);
    const get = async (q) => { const r = await gm('GET', '/api/gm/display' + q); status(r, 200); return r.json; };
    // old clients: seq alone
    let j = await get('?seq=' + S);
    expect(JSON.stringify(j) === JSON.stringify({ seq: S, unchanged: true }), 'old call, current: ' + JSON.stringify(j));
    j = await get('?seq=' + (S - 1));
    expect(j.display && j.seq === S && JSON.stringify(j.ambient) === JSON.stringify(a.json), 'old call, stale: full display and full ambient');
    // both halves
    j = await get('?seq=' + S + '&aseq=' + AS);
    expect(JSON.stringify(j) === JSON.stringify({ seq: S, unchanged: true, ambient: { seq: AS, unchanged: true } }), 'both current: ' + JSON.stringify(j));
    j = await get('?seq=' + S + '&aseq=' + (AS - 1));
    expect(j.display && !j.unchanged && j.seq === S && JSON.stringify(j.ambient) === JSON.stringify(a.json), 'ambient stale: ' + JSON.stringify(j).slice(0, 200));
    j = await get('?seq=' + (S - 1) + '&aseq=' + AS);
    expect(j.display && !j.unchanged && JSON.stringify(j.ambient) === JSON.stringify({ seq: AS, unchanged: true }), 'display stale: ' + JSON.stringify(j.ambient));
    j = await get('?seq=' + (S - 1) + '&aseq=' + (AS - 1));
    expect(j.display && JSON.stringify(j.ambient) === JSON.stringify(a.json), 'both stale');
    j = await get('?aseq=' + AS);
    expect(j.display && !j.unchanged && JSON.stringify(j.ambient) === JSON.stringify({ seq: AS, unchanged: true }), 'aseq alone: ' + JSON.stringify(j.ambient));
    j = await get('?aseq=' + AS + '&seq=garbage');
    expect(j.display && JSON.stringify(j.ambient) === JSON.stringify({ seq: AS, unchanged: true }), 'an odd seq is just stale');
    // an empty aseq is not a match
    expect((await get('?seq=' + S + '&aseq=')).ambient.doc !== undefined, 'an empty aseq is stale');
    // the ambient write moves only its own half
    status(await A({ skip: true }), 200);
    j = await get('?seq=' + S + '&aseq=' + AS);
    expect(j.display && j.ambient.doc && j.ambient.seq === AS + 1, 'after an ambient write the pair is stale: ' + JSON.stringify(j).slice(0, 160));
    status(await player('GET', '/api/gm/display?seq=1&aseq=1'), 403);
    status(await player('GET', '/api/gm/display?seq=1&aseq=1&sseq=1'), 403);
  });

  await step('display GET carries the transcriber part (want and session only); ?sseq answers unchanged per part; calls without it are answered as before', async () => {
    const get = async (q) => { const r = await gm('GET', '/api/gm/display' + q); status(r, 200); return r.json; };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const d = await get('');
    const T0 = d.stt, S = d.seq, AS = d.ambient.seq;
    expect(Object.keys(T0).sort().join() === 'seq,session,want' && T0.want === 'off' && T0.session === '' && Number.isInteger(T0.seq), 'nothing stored: off, no session: ' + JSON.stringify(T0));
    // all three current: the small answer, each part unchanged
    let j = await get('?seq=' + S + '&aseq=' + AS + '&sseq=' + T0.seq);
    expect(same(j, { seq: S, unchanged: true, ambient: { seq: AS, unchanged: true }, stt: { seq: T0.seq, unchanged: true } }), 'all three current: ' + JSON.stringify(j));
    // the calls of a display page from before the part existed: no stt in the answer, and it never keeps their answer from being the small one
    j = await get('?seq=' + S + '&aseq=' + AS);
    expect(same(j, { seq: S, unchanged: true, ambient: { seq: AS, unchanged: true } }), 'without sseq: ' + JSON.stringify(j));
    j = await get('?seq=' + (S - 1) + '&aseq=' + AS);
    expect(j.display && !j.unchanged && !('stt' in j) && same(j.ambient, { seq: AS, unchanged: true }), 'without sseq, display stale: ' + Object.keys(j));
    j = await get('?seq=' + S);
    expect(same(j, { seq: S, unchanged: true }), 'seq alone: ' + JSON.stringify(j));
    // the part stale: the display along with it, the others as asked
    j = await get('?seq=' + S + '&aseq=' + AS + '&sseq=' + (T0.seq + 1));
    expect(j.display && !j.unchanged && same(j.stt, T0) && same(j.ambient, { seq: AS, unchanged: true }), 'part stale: ' + JSON.stringify(j).slice(0, 200));
    j = await get('?seq=' + (S - 1) + '&aseq=' + AS + '&sseq=' + T0.seq);
    expect(j.display && same(j.stt, { seq: T0.seq, unchanged: true }) && same(j.ambient, { seq: AS, unchanged: true }), 'display stale, part current: ' + JSON.stringify(j.stt));
    j = await get('?sseq=' + T0.seq);
    expect(j.display && same(j.stt, { seq: T0.seq, unchanged: true }) && j.ambient.doc !== undefined, 'sseq alone: the part current, the others stale');
    for (const odd of ['&sseq=', '&sseq=garbage', '&sseq=-1']) {
      j = await get('?seq=' + S + '&aseq=' + AS + odd);
      expect(j.display && same(j.stt, T0), 'an odd sseq is just stale (' + odd + '): ' + JSON.stringify(j.stt));
    }
    // the GM turns listening on: the part moves
    status(await gm('PATCH', '/api/gm/stt', { want: 'on', session: '9' }), 200);
    j = await get('?seq=' + S + '&aseq=' + AS + '&sseq=' + T0.seq);
    expect(j.display && j.stt.want === 'on' && j.stt.session === '9' && j.stt.seq !== T0.seq, 'listening on: ' + JSON.stringify(j.stt));
    const T1 = j.stt;
    j = await get('?seq=' + S + '&aseq=' + AS);
    expect(same(j, { seq: S, unchanged: true, ambient: { seq: AS, unchanged: true } }), 'the older call is still the small answer');
    // everything else the control document holds neither moves it nor rides along: names, the iPad's report, its errors
    const STT_MARK = 'tangerine-lighthouse-chorus';
    status(await gm('PATCH', '/api/gm/stt', { speakers: { 0: 'Fixture ' + STT_MARK }, status: { state: 'listening', lines: 2, error: 'oops ' + STT_MARK } }), 200);
    j = await get('?seq=' + S + '&aseq=' + AS + '&sseq=' + T1.seq);
    expect(same(j, { seq: S, unchanged: true, ambient: { seq: AS, unchanged: true }, stt: { seq: T1.seq, unchanged: true } }), 'names and the iPad report do not move it: ' + JSON.stringify(j));
    const whole = await gm('GET', '/api/gm/display'); status(whole, 200);
    expect(same(whole.json.stt, T1) && !whole.text.includes(STT_MARK), 'only want and session ride on the display: ' + whole.text.slice(0, 200));
    // a new session number moves it; off again
    status(await gm('PATCH', '/api/gm/stt', { session: '9.1' }), 200);
    j = await get('?seq=' + S + '&aseq=' + AS + '&sseq=' + T1.seq);
    expect(j.stt.session === '9.1' && j.stt.want === 'on' && j.stt.seq !== T1.seq, 'a new session: ' + JSON.stringify(j.stt));
    status(await gm('PATCH', '/api/gm/stt', { want: 'off' }), 200);
    j = await get('');
    expect(j.stt.want === 'off' && j.stt.session === '9.1', 'off again: ' + JSON.stringify(j.stt));
  });

  await step('state: {} until written; PATCH merges maps, null deletes, arrays replace; the 256 KiB cap; /api/campaign untouched', async () => {
    const campBefore = (await gm('GET', '/api/campaign')).json;
    let r = await gm('GET', '/api/gm/state'); status(r, 200);
    expect(JSON.stringify(r.json.doc) === '{}' && r.json.updatedAt === null, r.text);
    r = await gm('PATCH', '/api/gm/state', { ui: { tab: 'N', heat: 2 }, pins: { a: { text: 'A pinned ' + MARK } }, history: [1, 2, 3] }); status(r, 200);
    const t1 = r.json.updatedAt;
    expect(r.json.doc.ui.tab === 'N' && r.json.doc.pins.a.text.includes(MARK) && typeof t1 === 'string', r.text);
    r = await gm('PATCH', '/api/gm/state', { ui: { heat: null, wanted: 1 }, pins: { b: { text: 'Second' } }, history: [9] }); status(r, 200);
    expect(JSON.stringify(r.json.doc.ui) === '{"tab":"N","wanted":1}', 'maps merge, null deletes: ' + JSON.stringify(r.json.doc.ui));
    expect(Object.keys(r.json.doc.pins).sort().join() === 'a,b' && JSON.stringify(r.json.doc.history) === '[9]', 'pins merged, arrays replace');
    expect(r.json.updatedAt > t1, 'updatedAt moves');
    r = await gm('PATCH', '/api/gm/state', { pins: null }); status(r, 200);
    expect(!('pins' in r.json.doc), 'null deletes a top-level key');
    r = await gm('GET', '/api/gm/state'); expect(r.json.doc.ui.wanted === 1 && !('pins' in r.json.doc), 'GET reads it back');
    // the cap: the stored document, and the patch itself
    r = await gm('PATCH', '/api/gm/state', { capture: { one: 'c'.repeat(200 * KiB) } }); status(r, 200);
    const stored = r.json.updatedAt;
    r = await gm('PATCH', '/api/gm/state', { capture: { two: 'd'.repeat(60 * KiB) } }); status(r, 413);
    expect(/too large/.test(r.json.error), r.text);
    r = await gm('GET', '/api/gm/state');
    expect(r.json.updatedAt === stored && !('two' in r.json.doc.capture), 'a refused patch changes nothing');
    status(await gm('PATCH', '/api/gm/state', { blob: 'e'.repeat(L.state) }), 413);
    status(await gm('PATCH', '/api/gm/state', { capture: { one: null } }), 200);
    status(await call('PATCH', '/api/gm/state', { user: GM, raw: '[1]' }), 400);
    status(await call('PATCH', '/api/gm/state', { user: GM, raw: '{nope' }), 400);
    status(await gm('PUT', '/api/gm/state', {}), 405);
    status(await gm('POST', '/api/gm/state', {}), 405);
    const campAfter = (await gm('GET', '/api/campaign')).json;
    expect(JSON.stringify(campAfter) === JSON.stringify(campBefore) && !('ui' in campAfter.doc), 'the campaign document did not change');
    expect(!(await player('GET', '/api/campaign')).text.includes(MARK), 'no GM state in the player campaign read');
  });

  await step('/api/characters carries no GM key (gmUpdatedAt was removed: nothing read it); GM and player see the same keys', async () => {
    const KEYS = 'campaignUpdatedAt,docs,now,npcsUpdatedAt';
    status(await gm('PATCH', '/api/gm/state', { ui: { tab: 'B' } }), 200);
    for (const q of ['', '?since=' + encodeURIComponent(new Date(0).toISOString())]) {
      const p = await player('GET', '/api/characters' + q); status(p, 200);
      expect(Object.keys(p.json).sort().join() === KEYS, 'player keys ' + Object.keys(p.json));
      const g = await gm('GET', '/api/characters' + q); status(g, 200);
      expect(Object.keys(g.json).sort().join() === KEYS, 'gm keys ' + Object.keys(g.json));
    }
  });

  await step('/api/export carries no GM data (no key, none of the pack, state or display text); a player is refused', async () => {
    status(await gm('PATCH', '/api/gm/state', { pins: { m: { text: 'Export probe ' + MARK } } }), 200);
    status(await gm('PUT', '/api/gm/display', { kind: 'text', text: 'Display probe ' + MARK }), 200);
    expect((await gm('GET', '/api/gm/pack?part=console')).text.includes(MARK), 'the pack holds the marker');
    const set = await A({ score: scoreOk({ name: 'Ambient probe ' + AMARK }), mode: 'pin', scene: 'board' }); status(set, 200);
    expect((await gm('GET', '/api/gm/ambient')).text.includes(AMARK) && (await gm('GET', '/api/gm/display')).text.includes(AMARK), 'the ambient holds the marker');
    const r = await gm('GET', '/api/export'); status(r, 200);
    expect(Object.keys(r.json).sort().join() === 'campaign,characters,exportedAt,members,npcs', 'keys ' + Object.keys(r.json));
    expect(!r.text.includes(MARK) && !/Fixture\/console|Pigeon loft|Display probe|gmcheck#gm/.test(r.text), 'GM data in the export');
    expect(!r.text.includes(AMARK) && !/ambient|Lantern Wharf|gm_ambient/i.test(r.text), 'ambient data in the export');
    for (const p of ['/api/campaign', '/api/characters']) {
      expect(!(await player('GET', p)).text.includes(AMARK) && !(await gm('GET', p)).text.includes(AMARK), 'ambient data on ' + p);
    }
    status(await player('GET', '/api/export'), 403);
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
