// The GM tools' API against a local `wrangler dev` (see GM.md, HOSTING.md): /api/gm/pack, /api/gm/state and
// /api/gm/display are GM only (403 for a player on every method, before the body is read; 401 without a token), the
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
import { gmNotFound } from '../../functions/_lib/gm.js';
import { onRequest as notFound } from '../../functions/api/[[path]].js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 8843);
const GM = 'gm@example.test';
const PLAYER = 'player@example.test';
const WRANGLER = join(ROOT, 'node_modules', '.bin', 'wrangler');
const OVERALL_TIMEOUT_MS = Number(process.env.CHECK_TIMEOUT_MS || 240000);
const KiB = 1024;
const L = { partBody: 900 * KiB, parts: 12, src: 2 * KiB, state: 256 * KiB, svg: 600 * KiB, text: 2000 };
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
  for (const [p, h] of [['/api/gm/pack', gmPack], ['/api/gm/pack/', gmPack], ['/api/gm/state', gmState], ['/api/gm/display', gmDisplay], ['/api/gm/display/', gmDisplay]]) {
    expect(matchApi(p).handler === h, p);
  }
  for (const p of ['/api/gm', '/api/gm/', '/api/gm/nope', '/api/gm/pack/x', '/api/gm/state/a/b']) expect(matchApi(p).handler === gmNotFound, p);
  expect(matchApi('/api/gmx').handler === notFound && matchApi('/api/gm-pack').handler === notFound, 'other paths stay the plain 404');
});

await step('without a token every /api/gm path and method is 401, no-store', async () => {
  for (const [m, p] of [['GET', '/api/gm/pack'], ['POST', '/api/gm/pack'], ['DELETE', '/api/gm/pack?part=console'], ['GET', '/api/gm/state'],
    ['PATCH', '/api/gm/state'], ['GET', '/api/gm/display'], ['PUT', '/api/gm/display'], ['GET', '/api/gm/other']]) {
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
  for (const h of [gmPack, gmState, gmDisplay, gmNotFound]) {
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
    '--persist-to', persist, '--log-level', 'warn', '--var', 'DEV_USER:' + GM, '--var', 'GM_EMAILS:' + GM, '--var', 'CAMPAIGN:gmcheck'],
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
    status(await gm('POST', '/api/gm/display', { kind: 'blank' }), 405);
    status(await gm('DELETE', '/api/gm/display'), 405);
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
      [{ kind: 'blank', title: 'x'.repeat(L.text + 1) }, 413, /title is too long/],
      [{ kind: 'blank', caption: 'x'.repeat(L.text + 1) }, 413, /caption is too long/],
      [{ kind: 'blank', title: 5 }, 400, /title must be a string/],
    ];
    for (const [body, code, re] of cases) {
      const r = await gm('PUT', '/api/gm/display', body);
      expect(r.status === code && re.test(r.json && r.json.error), JSON.stringify(body).slice(0, 90) + ' -> ' + r.status + ' ' + r.text.slice(0, 160));
    }
    status(await call('PUT', '/api/gm/display', { user: GM, raw: '[1]' }), 400);
    status(await call('PUT', '/api/gm/display', { user: GM, raw: '{nope' }), 400);
    // at the caps is fine
    let r = await gm('PUT', '/api/gm/display', { kind: 'text', title: 't'.repeat(L.text), caption: 'c'.repeat(L.text), text: 'x'.repeat(L.text) }); status(r, 200);
    const pad = L.svg - svg('<text></text>').length;
    r = await gm('PUT', '/api/gm/display', { kind: 'svg', svg: svg('<text>' + 'x'.repeat(pad) + '</text>') }); status(r, 200);
    expect(r.json.seq === seq0 + 2, 'only the two good writes moved seq: ' + r.json.seq + ' from ' + seq0);
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
    const r = await gm('GET', '/api/export'); status(r, 200);
    expect(Object.keys(r.json).sort().join() === 'campaign,characters,exportedAt,members,npcs', 'keys ' + Object.keys(r.json));
    expect(!r.text.includes(MARK) && !/Fixture\/console|Pigeon loft|Display probe|gmcheck#gm/.test(r.text), 'GM data in the export');
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
