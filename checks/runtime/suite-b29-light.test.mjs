// Suite B29, 4.6 (switch room.light): the light cue's pure side (palette to strip colour, the hard limits), the client (zero requests while the switch is off), and
// the relay (private-network preflight, origin allowlist, the limits enforced on a raw hand-made request, the work light refused) against the SIMULATOR driver.
// Only 127.0.0.1 is touched, on a port in 9300-9349. No hardware, no outside network.
//   node checks/runtime/suite-b29-light.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createRelay, createGuard, simulator } from '../../tools/light-relay.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const req = createRequire(import.meta.url);
const L = req(path.join(ROOT, 'app', 'gm', 'light.js'));
const F = req(path.join(ROOT, 'app', 'features.js'));
const PORT = 9341;
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

await test('the line is registered, GM-only, always on (N0)', () => {
  const s = F.get('room.light'); assert.ok(s); assert.equal(s.default, false); assert.equal(s.surface, 'gm'); assert.equal(s.stage, 'room');
  assert.equal(F.valueOf({}, 'room.light'), true, 'on with nothing stored'); assert.ok(!F.publicIds().includes('room.light'));
});
await test('limits: 3 s, 2 Hz, strip and rim only', () => {
  assert.equal(L.LIMITS.ALARM_MS, 3000); assert.ok(L.LIMITS.GUARD_MS >= 250 && L.LIMITS.STEP_MS >= L.LIMITS.GUARD_MS); assert.deepEqual([...L.LIMITS.CHANNELS], ['strip', 'rim']);
  assert.throws(() => { 'use strict'; L.LIMITS.ALARM_MS = 9999; });
});
await test('alarmSteps: never past 3 s, never two changes closer than 250 ms, ends off, whatever is asked', () => {
  for (const [ms, st] of [[undefined, undefined], [99999, 1], [3000, 0], [500, 10], [-5, -5], [NaN, 'x'], [3000, 100000]]) {
    const s = L.alarmSteps(ms, st);
    assert.ok(s.length >= 1 && s[s.length - 1].on === false, JSON.stringify([ms, st]) + ' ends off');
    assert.ok(s[s.length - 1].at <= L.LIMITS.ALARM_MS + L.LIMITS.STEP_MS, 'within the window');
    for (let i = 1; i < s.length; i++) assert.ok(s[i].at - s[i - 1].at >= 250, 'gap ' + (s[i].at - s[i - 1].at));
    const flashes = s.filter((x) => x.on).length; assert.ok(flashes <= 6, 'flashes ' + flashes);       /* 3 s at 2 Hz at most */
  }
  assert.ok(L.alarmSteps().length >= 2);
});
await test('check: clamps the alarm, refuses the work light and anything else, keeps the strip to a colour', () => {
  assert.deepEqual(L.check({ channel: 'rim', alarm: true, durationMs: 60000, stepMs: 1 }).cmd, { channel: 'rim', alarm: true, durationMs: 3000, stepMs: L.LIMITS.STEP_MS });
  for (const bad of [{ channel: 'work', rgb: [255, 0, 0] }, { channel: 'work', alarm: true }, { channel: 'all' }, { channel: 'strip', alarm: true }, { channel: 'strip' }, { channel: 'rim' }, null, 'x'])
    assert.equal(L.check(bad).ok, false, JSON.stringify(bad));
  assert.deepEqual(L.check({ channel: 'strip', rgb: [300, -4, 7.6] }).cmd.rgb, [255, 0, 8]);
});
await test('stripColour: a palette accent wins, a scene id is stable and valid, junk still gives a colour', () => {
  assert.deepEqual(L.stripColour({ accent: '#102030' }), [16, 32, 48]); assert.deepEqual(L.stripColour({ bg: '#ffffff' }), [255, 255, 255]);
  assert.deepEqual(L.stripColour('harbour'), L.stripColour('harbour'));
  for (const s of ['harbour', 'x', '', null, {}, 42]) { const c = L.stripColour(s); assert.equal(c.length, 3); assert.ok(c.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)); }
});
await test('client: switch off or no fetch means ZERO requests; on, it posts the colour once per change and the alarm on request; a dead relay is quiet', async () => {
  let n = 0; const seen = []; const fetch = (u, o) => { n++; seen.push([u, JSON.parse(o.body)]); return Promise.resolve({ ok: true }); };
  let on = false; const c = L.create({ enabled: () => on, fetch, base: 'http://127.0.0.1:' + PORT });
  assert.equal(await c.follow('harbour'), false); assert.equal(await c.alarm(), false); assert.equal(n, 0, 'off: no request');
  assert.equal(await L.create({ enabled: () => true }).follow('x'), false);
  on = true; assert.equal(await c.follow('harbour'), true); assert.equal(await c.follow('harbour'), false, 'same colour: nothing'); assert.equal(await c.alarm(), true);
  assert.equal(n, 2); assert.equal(seen[0][0], 'http://127.0.0.1:' + PORT + '/light'); assert.equal(seen[0][1].channel, 'strip'); assert.deepEqual(seen[1][1], { channel: 'rim', alarm: true });
  assert.equal(await L.create({ enabled: () => true, fetch: () => Promise.reject(new Error('down')) }).alarm(), false);
});
await test('guard (fake clock): the alarm is the rim only, 3 s, steps 250 ms or more apart, one at a time, dark at the end; a strip change never touches the rim', () => {
  let t = 1000; const q = []; const drv = simulator(() => t); const g = createGuard({ driver: drv, now: () => t, schedule: (fn, ms) => q.push({ fn, at: t + ms }) });
  assert.equal(g.apply({ channel: 'strip', rgb: [1, 2, 3] }).ok, true); assert.deepEqual(drv.state().strip, [1, 2, 3]); assert.equal(drv.state().log.filter((e) => e.ch === 'rim').length, 0);
  assert.equal(g.apply({ channel: 'rim', alarm: true, durationMs: 99999, stepMs: 1 }).ok, true);
  assert.equal(g.apply({ channel: 'rim', alarm: true }).status, 409, 'one at a time');
  q.sort((a, b) => a.at - b.at); for (const e of q) { t = e.at; e.fn(); }
  const rim = drv.state().log.filter((e) => e.ch === 'rim');
  assert.ok(rim.length >= 2 && rim[rim.length - 1].v === false); assert.ok(rim[rim.length - 1].at - rim[0].at <= 3000 + L.LIMITS.STEP_MS + 5);
  for (let i = 1; i < rim.length - 1; i++) assert.ok(rim[i].at - rim[i - 1].at >= 250);
  assert.equal(drv.state().rim, false);
  /* a driver call that comes too soon is dropped by the guard itself, even if the schedule is wrong */
  t = 50000; const d2 = simulator(() => t); const g2 = createGuard({ driver: d2, now: () => t, schedule: (fn) => { t += 10; fn(); } });
  g2.apply({ channel: 'rim', alarm: true }); const r2 = d2.state().log.filter((e) => e.ch === 'rim');
  for (let i = 1; i < r2.length; i++) if (r2[i].v === true) assert.ok(r2[i].at - r2[i - 1].at >= 250);
});
function http(method, p, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = globalThis.fetch ? null : null; void r;
    import('node:http').then(({ default: h }) => {
      const q = h.request({ host: '127.0.0.1', port: PORT, method, path: p, headers }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b })); });
      q.on('error', reject); if (body !== undefined) q.write(body); q.end();
    });
  });
}
await test('relay: private-network preflight, origin allowlist, raw out-of-spec requests clamped or refused, the work light refused, real 3 s window', async () => {
  const relay = createRelay({ extraOrigins: ['https://gm.example.test'] });
  await new Promise((r) => relay.server.listen(PORT, '127.0.0.1', r));
  try {
    const pre = await http('OPTIONS', '/light', { headers: { origin: 'http://localhost:8788', 'access-control-request-method': 'POST', 'access-control-request-private-network': 'true' } });
    assert.equal(pre.status, 204); assert.equal(pre.headers['access-control-allow-private-network'], 'true'); assert.equal(pre.headers['access-control-allow-origin'], 'http://localhost:8788');
    assert.equal((await http('OPTIONS', '/light', { headers: { origin: 'http://localhost:5555', 'access-control-request-private-network': 'true' } })).status, 403, 'another local port is refused');
    const ext = await http('OPTIONS', '/light', { headers: { origin: 'https://gm.example.test', 'access-control-request-private-network': 'true' } }); assert.equal(ext.status, 204);
    const bad = await http('OPTIONS', '/light', { headers: { origin: 'https://elsewhere.example.org', 'access-control-request-private-network': 'true' } });
    assert.equal(bad.status, 403); assert.equal(bad.headers['access-control-allow-origin'], undefined);
    assert.equal((await http('POST', '/light', { headers: { origin: 'https://elsewhere.example.org' }, body: '{"channel":"strip","rgb":[1,1,1]}' })).status, 403);
    const post = (o) => http('POST', '/light', { headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });
    assert.equal((await post({ channel: 'work', rgb: [255, 255, 255] })).status, 400); assert.equal((await post({ channel: 'work', alarm: true })).status, 400);
    assert.equal((await http('POST', '/light', { body: '{nope' })).status, 400);
    assert.equal((await http('POST', '/light', { body: 'x'.repeat(5000) }).catch(() => ({ status: 0 }))).status === 200, false, 'an oversize body is not accepted');
    assert.equal((await post({ channel: 'strip', rgb: [10, 20, 30] })).status, 200);
    assert.deepEqual(JSON.parse((await http('GET', '/state')).body).strip, [10, 20, 30]);
    const t0 = Date.now(); assert.equal((await post({ channel: 'rim', alarm: true, durationMs: 600000, stepMs: 1 })).status, 200);
    assert.equal((await post({ channel: 'rim', alarm: true })).status, 409);
    await new Promise((r) => setTimeout(r, 3400));
    const log = relay.driver.state().log.filter((e) => e.ch === 'rim');
    assert.ok(log.length >= 2 && log[log.length - 1].v === false, 'dark at the end'); assert.equal(relay.driver.state().rim, false);
    assert.ok(log[log.length - 1].at - t0 <= 3000 + 600, 'inside the window: ' + (log[log.length - 1].at - t0));
    for (let i = 1; i < log.length; i++) if (log[i].v === true) assert.ok(log[i].at - log[i - 1].at >= 245, 'gap ' + (log[i].at - log[i - 1].at));
    assert.ok(log.filter((e) => e.v).length <= 6);
    assert.ok(!relay.driver.state().log.some((e) => e.ch === 'work'));
    assert.equal(typeof relay.driver.work, 'undefined', 'the driver has no work-light method at all');
  } finally { relay.server.close(); }
});
await test('hygiene: the relay binds 127.0.0.1 only and names no app domain; routes carry light.js to the GM bundle only', () => {
  const t = fs.readFileSync(path.join(ROOT, 'tools', 'light-relay.mjs'), 'utf8');
  assert.ok(t.includes("'127.0.0.1'") && !/0\.0\.0\.0|https?:\/\/[a-z0-9-]+\.(com|app|dev|net|org|io)/i.test(t.replace(/\/\/.*$/gm, '')));
  const r = fs.readFileSync(path.join(ROOT, 'app', 'routes.js'), 'utf8'), gm = /gm: \[([^\]]*)\]/.exec(r)[1], display = /display: \[([^\]]*)\]/.exec(r)[1];
  assert.ok(gm.includes("'gm/light.js'") && !display.includes('light.js'));
});
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
