// 4.2 Preflight (switch room.preflight): the pure evaluation (green or red, a one-line fix on every red one), the 45-minute window, the iPad's report
// (off by default), the device report's validation, and the Worker's read-only answer on an in-memory D1 with Deepgram faked. No network, no key,
// nothing paid: the fake fetch records every call and the test asserts the only one is the unauthenticated reachability ping.
//   node checks/runtime/room-preflight.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { onRequest as preflightApi } from '../../functions/api/gm/preflight.js';
import { accessExpiry, pingDeepgram, DEEPGRAM_PING } from '../../functions/_lib/preflight.js';
import { cleanSttPatch, patchStt, sttSignal, cleanDevice } from '../../functions/_lib/stt.js';
import { matchApi } from '../../worker/app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const req = createRequire(import.meta.url);
const PF = req(path.join(ROOT, 'app', 'gm', 'preflight.js'));
const REP = req(path.join(ROOT, 'app', 'display', 'preflight-report.js'));
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const NOW = Date.parse('2030-01-01T10:00:00Z');
const GOOD = { access: { expiresAt: new Date(NOW + 8 * 3600000).toISOString() }, deepgram: { keySet: true, reachable: true, ms: 40 }, pack: { version: 'v9', parts: 3 },
  device: { audio: 'unlocked', files: 30, of: 30, build: 'b1', at: new Date(NOW - 20000).toISOString() } };
const LOCAL = { files: 50, of: 50, packVersion: 'v9' };
const byId = (items) => Object.fromEntries(items.map((i) => [i.id, i]));

await test('evaluate: everything fine is all green, with no fix lines and no relay line', () => {
  const items = PF.evaluate(GOOD, NOW, LOCAL);
  assert.deepEqual(items.map((i) => i.id), ['audio', 'ipadfiles', 'gmfiles', 'deepgram', 'access', 'pack']);
  assert.ok(items.every((i) => i.ok && i.fix === ''), JSON.stringify(items));
  assert.deepEqual(PF.summary(items), { red: 0, total: 6 });
});
await test('evaluate: each failure is red with a one-line fix', () => {
  const bad = { ...GOOD, access: { expiresAt: new Date(NOW + 30 * 60000).toISOString() }, deepgram: { keySet: true, reachable: false, ms: 3000 }, pack: { version: 'v10', parts: 3 }, device: { ...GOOD.device, audio: 'locked', files: 12 } };
  const m = byId(PF.evaluate(bad, NOW, { files: 3, of: 50, packVersion: 'v9' }));
  for (const id of ['audio', 'ipadfiles', 'gmfiles', 'deepgram', 'access', 'pack']) { assert.equal(m[id].ok, false, id); assert.ok(m[id].fix && !/\n/.test(m[id].fix), id + ' fix'); }
  assert.match(m.audio.fix, /Tap the iPad/);
});
await test('evaluate: no key, no pack, no iPad report, a report gone stale, a session with no token', () => {
  let m = byId(PF.evaluate({ deepgram: { keySet: false }, pack: { version: '0' }, device: null }, NOW, LOCAL));
  assert.equal(m.deepgram.ok, false); assert.match(m.deepgram.fix, /DEEPGRAM_API_KEY/); assert.equal(m.pack.ok, false); assert.equal(m.audio.ok, false); assert.equal(m.ipadfiles.ok, false);
  assert.equal(m.access.ok, true, 'no token (local dev) is not a failure');
  m = byId(PF.evaluate({ ...GOOD, device: { ...GOOD.device, at: new Date(NOW - 10 * 60000).toISOString() } }, NOW, LOCAL));
  assert.equal(m.audio.ok, false); assert.match(m.audio.say, /10 minutes/);
  assert.equal(byId(PF.evaluate(GOOD, NOW, { files: 0, of: 0 })).gmfiles.ok, false, 'no cache is red, never green');
  assert.ok(PF.evaluate(null, NOW, null).every((i) => typeof i.ok === 'boolean'));
});
await test('due: from 45 minutes before the start, never without one', () => {
  const start = NOW + 45 * 60000;
  assert.equal(PF.due(NOW, start), true); assert.equal(PF.due(NOW - 1, start), false); assert.equal(PF.due(NOW, null), false); assert.equal(PF.due(start + 3600000, start), true);
});
await test('create: run reads the server, adds a registered relay check (a throwing one is red), tick runs once per start and toasts the reds', async () => {
  PF.clearChecks();
  PF.addCheck('relay', () => ({ ok: false, label: 'Light relay', say: 'Not answering.', fix: 'Power-cycle the relay.' }));
  PF.addCheck('boom', () => { throw new Error('x'); });
  let calls = 0; const toasts = [];
  const ctl = PF.create({ now: () => NOW, startMs: () => NOW + 30 * 60000, toast: (m) => toasts.push(m), fetchFacts: async () => { calls++; return GOOD; }, local: async () => LOCAL, root: () => null });
  assert.equal(ctl.badge(), '');
  ctl.tick(); await new Promise((r) => setTimeout(r, 20)); ctl.tick(); await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, 1); assert.equal(toasts.length, 1); assert.match(toasts[0], /2 to fix/); assert.equal(ctl.badge(), '2');
  PF.clearChecks();
  const down = PF.create({ now: () => NOW, fetchFacts: async () => { throw new Error('offline'); }, local: async () => LOCAL, root: () => null });
  const items = await down.run(); assert.equal(items[0].id, 'server'); assert.equal(items[0].ok, false);
});
await test('look: counts the GM files held in the build cache; no cache API is zero of the files, not green', async () => {
  const load = { build: 'b1', BUNDLES: { core: ['a.js', 'b.js'], figures: ['f.js'], gm: ['g.js'] } };
  const held = new Set(['a.js', 'g.js']), seen = [];
  const caches = { open: async (n) => { seen.push(n); return { match: async (f, o) => { assert.equal(o.ignoreSearch, true); return held.has(f) ? {} : undefined; } }; } };
  assert.deepEqual(await PF.look({ caches, load }), { files: 2, of: 4 }); assert.deepEqual(seen, ['b68-shell-b1']);
  assert.deepEqual(await PF.look({ caches: null, load }), { files: 0, of: 0 });
});
await test('iPad report: nothing at all while the switch is off; on, it reports the audio word and the cache count', async () => {
  assert.equal(await REP.reporter({ on: () => false })(), null);
  const load = { build: 'b2', BUNDLES: { core: ['a.js'], figures: ['f.js'], display: ['d.js', 'a.js'] } };
  const caches = { open: async () => ({ match: async (f) => (f === 'f.js' ? undefined : {}) }) };
  assert.deepEqual(await REP.reporter({ on: () => true, music: () => ({ unlocked: false }), caches, load })(), { audio: 'locked', files: 2, of: 3, build: 'b2' });
  assert.equal(REP.audioOf({ unlocked: true }), 'unlocked'); assert.equal(REP.audioOf({ file: false }), 'none'); assert.equal(REP.audioOf(null), 'none');
});
await test('server: the device report is bounded; a status without it is exactly what it was (and signs the same)', async () => {
  assert.deepEqual(cleanDevice({ audio: 'locked', files: 3, of: 9, build: 'b 1<x>' }), { audio: 'locked', files: 3, of: 9, build: 'b1x' });
  for (const bad of [null, { audio: 'loud' }, { audio: 'none', files: -1 }, { audio: 'none', files: 1.5 }]) assert.throws(() => cleanDevice(bad), (e) => e.status === 400);
  assert.equal('device' in cleanSttPatch({ status: { state: 'idle' } }, 'display').status, false);
  assert.equal(cleanSttPatch({ status: { state: 'idle', device: { audio: 'none' } } }, 'display').status.device.audio, 'none');
  const base = { want: 'on', session: '1', speakers: {}, status: { state: 'idle', lines: 0, error: '' } };
  assert.equal(sttSignal(base), JSON.stringify(['on', '1', {}, 'idle', 0, '']));
  assert.notEqual(sttSignal({ ...base, status: { ...base.status, device: { audio: 'locked', files: 1, of: 2, build: 'b' } } }), sttSignal(base));
});
await test('server: accessExpiry reads exp, ignores junk; the ping counts any HTTP answer, not a throw', async () => {
  const tok = 'h.' + Buffer.from(JSON.stringify({ exp: 1893456000 })).toString('base64url') + '.s';
  assert.equal(accessExpiry(tok), '2030-01-01T00:00:00.000Z'); assert.equal(accessExpiry('nope'), null); assert.equal(accessExpiry(null), null);
  assert.equal((await pingDeepgram(async () => ({ status: 401 }))).reachable, true);
  assert.equal((await pingDeepgram(async () => { throw new Error('down'); })).reachable, false);
});
await test('endpoint: GM only, GET only, read-only; the one outside call is the unauthenticated ping; the answer reports the iPad device and the pack', async () => {
  const db = asD1(await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') }));
  await db.prepare('INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind('default', 'campaign', 'v1', '{}', 1, '{}').run();
  await patchStt(db, 'default', cleanSttPatch({ status: { state: 'listening', device: { audio: 'unlocked', files: 30, of: 30, build: 'b1' } } }, 'display'));
  const fetched = [], env = { DB: db, DEEPGRAM_API_KEY: 'k-secret', __fetch: async (u, o) => { fetched.push([u, o]); return { status: 401 }; } };
  const call = (method, role, token) => Promise.resolve().then(() => preflightApi({ request: new Request('http://x/api/gm/preflight', { method, headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {} }), env, data: { me: { role } } })).then((r) => r, (e) => ({ status: e.status }));
  for (const role of ['player', 'display']) assert.equal((await call('GET', role)).status, 403, role);
  assert.equal((await call('POST', 'gm')).status, 405); assert.equal(fetched.length, 0, 'nothing is called before the role and method pass');
  const tok = 'h.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.s';
  const before = JSON.stringify((await db.prepare('SELECT * FROM gm_stt').all()).results);
  const res = await call('GET', 'gm', tok), out = await res.json();
  assert.equal(res.status, 200); assert.equal(out.deepgram.keySet, true); assert.equal(out.deepgram.reachable, true); assert.equal(out.pack.parts, 1); assert.notEqual(out.pack.version, '0');
  assert.equal(out.device.audio, 'unlocked'); assert.ok(out.access.expiresAt);
  assert.equal(fetched.length, 1); assert.equal(fetched[0][0], DEEPGRAM_PING); assert.ok(!JSON.stringify(fetched[0][1]).includes('k-secret') && !fetched[0][1].headers, 'no key, no header goes with the ping');
  assert.equal(JSON.stringify((await db.prepare('SELECT * FROM gm_stt').all()).results), before, 'nothing written');
  assert.equal(matchApi('/api/gm/preflight').functionPath, '/api/gm/preflight');
  const noKey = await (await preflightApi({ request: new Request('http://x/api/gm/preflight'), env: { DB: db, __fetch: async () => { throw new Error('never'); } }, data: { me: { role: 'gm' } } })).json();
  assert.deepEqual([noKey.deepgram.keySet, noKey.deepgram.reachable], [false, null]);
});
console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASSED (' + passed + ')'));
process.exit(failed ? 1 : 0);
