// W0.2 and N0 against a real `wrangler dev` (local D1, workerd): the registry's server half after the night rebuild. Everything built is ON: what a phone, the iPad
// and the GM's own devices are told is made on every read from the registry (every display and phone feature ON, the three settings as stored), from the very
// first request, with no GM page ever opened. The campaign document's stored `features` is the GM's alone (a player's PATCH is 403), is cleaned on write (a GM-only
// id, an unknown id and a non-boolean are dropped), is kept by a whole-document PUT, and is NEVER rewritten by a read or by a write that does not name it (checked
// through /api/export, which returns the document as stored). The iPad reads the served map on the display poll (hseq present) without a second D1 call.
// Invented ids only.
//   node checks/api/features.mjs        (Windows: wrangler is started with a shell)
//
// Applies migrations/ to a throwaway local D1, then starts the Worker on PORT (default 8951, lane G's range 8950-8999).

import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Features from '../../app/features.js';
import { cleanFeatures, forPlayer, parseFeatures, servedFeatures } from '../../functions/_lib/features.js';

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
const sorted = (o) => Object.fromEntries(Object.keys(o || {}).sort().map((k) => [k, o[k]]));
const sameMap = (a, b) => same(sorted(a), sorted(b));
const NON_SETTINGS = Features.publicIds().filter((i) => !Features.isSetting(i));
/* A setting whose surface is 'gm' (kit.desk, night.who, blade.pitches) lives in GM state and is never served to a phone or the iPad: it is ABSENT from a served
   map, not false. The display and phone settings are served as stored. */
const PUBLIC_SETTINGS = Features.settings().filter((s) => s.surface !== 'gm').map((s) => s.id);
const GM_SETTINGS = Features.settings().filter((s) => s.surface === 'gm').map((s) => s.id);
/* a served map with every setting off: each display and phone setting false, each GM-surface setting not there at all (served at all, true or false, fails) */
const servedAllOff = (m) => PUBLIC_SETTINGS.every((i) => m[i] === false) && GM_SETTINGS.every((i) => !(i in m));

async function main() {
  // in-process: the registry the Worker bundles is the one the page reads
  await step('the Worker\'s door to the registry: the write side cleans to display and phone ids; the read side serves every one of them ON, a setting as stored', async () => {
    const real = Features.publicIds();
    expect(real.includes('phoneCards') && real.includes('fx.off') && real.includes('room.music'), 'the settings are public ids: ' + real);
    expect(same(cleanFeatures({ phoneCards: true, 'gm.secret': true, nope: true, bad: 'yes' }), { phoneCards: true }), 'cleaned');
    expect(same(cleanFeatures(null), {}) && same(cleanFeatures([true]), {}) && same(cleanFeatures('x'), {}), 'junk is empty');
    for (const m of [parseFeatures('{not json'), parseFeatures(null), servedFeatures({})]) {
      expect(NON_SETTINGS.every((i) => m[i] === true) && !('phoneCards' in m), 'nothing stored: every non-setting ON, no setting: ' + JSON.stringify(m));
    }
    expect(parseFeatures('{"phoneCards":false,"zzz":true}').phoneCards === false && !('zzz' in parseFeatures('{"zzz":true}')), 'a stored setting is served as it is; junk never');
    expect(PUBLIC_SETTINGS.length > 0 && GM_SETTINGS.length > 0, 'the registry has both kinds of setting: public ' + PUBLIC_SETTINGS + ', GM ' + GM_SETTINGS);
    const gmOn = {}; GM_SETTINGS.forEach((i) => { gmOn[i] = true; });
    expect(same(cleanFeatures(gmOn), {}) && GM_SETTINGS.every((i) => !(i in servedFeatures(gmOn))), 'a GM-surface setting is never stored or served: ' + JSON.stringify(servedFeatures(gmOn)));
    Features.register({ id: 'test.gmonly', label: 'T', surface: 'gm', stage: 'spine', default: false, saturday: 'off', doc: 'd' });
    try {
      expect(same(cleanFeatures({ 'test.gmonly': true, phoneCards: true }), { phoneCards: true }), 'a registered GM-only id is dropped too');
      expect(!('test.gmonly' in forPlayer({ a: 1, features: { 'test.gmonly': true } }).features), 'and never served');
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
  /* the campaign document AS STORED: /api/export (GM only) returns it untouched by the served view */
  const stored = async () => { const r = await call('GET', '/api/export', { user: GM }); expect(r.status === 200, 'export ' + r.status); return r.json.campaign.doc.features; };

  await step('nothing stored, no GM page ever opened: a player, the GM and the iPad poll are each told every display and phone feature ON from the first request; the settings are absent (off); nothing is written', async () => {
    const want = servedFeatures({});
    expect(NON_SETTINGS.every((i) => want[i] === true) && Features.settings().every((s) => !(s.id in want)), 'the served map with nothing stored');
    const g = await call('GET', '/api/campaign', { user: PLAYER });
    expect(g.status === 200 && sameMap(g.json.doc.features, want), 'player: ' + g.text.slice(0, 300));
    const gm = await call('GET', '/api/campaign', { user: GM });
    expect(gm.status === 200 && sameMap(gm.json.doc.features, want), 'the GM reads the same served map: ' + gm.text.slice(0, 200));
    const p = await poll(IPAD);
    expect(p.status === 200 && p.json.mission && sameMap(p.json.features, want), 'poll: ' + p.text.slice(0, 300));
    expect((await stored()) === undefined, 'and the stored document still has no `features`');
  });

  await step('the GM writes a map (an older page might): only registered display and phone ids are stored; a GM-only, an unknown and a non-boolean value are dropped', async () => {
    const r = await call('PATCH', '/api/campaign', { user: GM, body: { features: { phoneCards: true, 'map.flashback': false, 'spine.rail': true, 'gm.private': true, junk: 'yes', bad: 1 } } });
    expect(r.status === 200, 'PATCH ' + r.status + ' ' + r.text.slice(0, 200));
    expect(same(await stored(), { phoneCards: true, 'map.flashback': false }), 'stored ' + JSON.stringify(await stored()));
    expect(sameMap(r.json.doc.features, servedFeatures({ phoneCards: true })), 'the answer is served: a stored false for a feature reads ON: ' + JSON.stringify(r.json.doc.features));
    const g = await call('GET', '/api/campaign', { user: GM });
    expect(g.json.doc.features.phoneCards === true && g.json.doc.features['map.flashback'] === true && !('spine.rail' in g.json.doc.features), 'GM reads ' + JSON.stringify(g.json.doc.features));
  });

  await step('a player reads the served map but can never write it (403), and a GM-only id is nowhere in what a player is sent', async () => {
    const g = await call('GET', '/api/campaign', { user: PLAYER });
    expect(g.status === 200 && g.json.doc.features.phoneCards === true && g.json.doc.features['map.flashback'] === true, 'player reads ' + g.text.slice(0, 200));
    for (const id of ['spine.rail', 'gm.private', 'junk']) expect(!g.text.includes(id), 'the id ' + id + ' reached a player');
    const w = await call('PATCH', '/api/campaign', { user: PLAYER, body: { features: { phoneCards: false } } });
    expect(w.status === 403, 'player PATCH ' + w.status);
    expect(same(await stored(), { phoneCards: true, 'map.flashback': false }), 'unchanged after the refused write');
  });

  await step('features must be an object (or null): a string, an array or a number is 400', async () => {
    for (const bad of ['on', [true], 5]) { const r = await call('PATCH', '/api/campaign', { user: GM, body: { features: bad } }); expect(r.status === 400, JSON.stringify(bad) + ' -> ' + r.status); }
  });

  await step('nothing rewrites a stored value: a whole-document PUT of the served copy (every feature ON) or of a stale one keeps the stored map; a PATCH that does not name it leaves it; a player cannot PUT', async () => {
    const cur = (await call('GET', '/api/campaign', { user: GM })).json.doc;
    expect(NON_SETTINGS.every((i) => cur.features[i] === true), 'the GM holds the served copy');
    const r1 = await call('PUT', '/api/campaign', { user: GM, body: cur });
    expect(r1.status === 200 && same(await stored(), { phoneCards: true, 'map.flashback': false }), 'PUT of the served copy: stored ' + JSON.stringify(await stored()));
    const r2 = await call('PUT', '/api/campaign', { user: GM, body: { ...cur, features: { phoneCards: false } } });
    expect(r2.status === 200 && same(await stored(), { phoneCards: true, 'map.flashback': false }), 'PUT of a stale copy: stored ' + JSON.stringify(await stored()));
    const r3 = await call('PATCH', '/api/campaign', { user: GM, body: { session: { number: 3 } } });
    expect(r3.status === 200 && same(await stored(), { phoneCards: true, 'map.flashback': false }), 'a PATCH without features: stored ' + JSON.stringify(await stored()));
    const w = await call('PUT', '/api/campaign', { user: PLAYER, body: cur });
    expect(w.status === 403, 'player PUT ' + w.status);
  });

  await step('the iPad poll (hseq sent) carries the served map as `features`, on a full answer and on an unchanged one; a call without hseq is answered as before', async () => {
    const want = servedFeatures(await stored());
    const p = await poll(IPAD);
    expect(p.status === 200 && sameMap(p.json.features, want), 'full: ' + p.text.slice(0, 240));
    const seq = p.json.seq, aseq = p.json.ambient && p.json.ambient.seq;
    const u = await call('GET', '/api/gm/display?seq=' + seq + '&aseq=' + aseq + '&sseq=' + (p.json.stt ? p.json.stt.seq : 0) + '&hseq=' + (p.json.mission ? p.json.mission.hseq : 0), { user: IPAD });
    expect(u.status === 200 && sameMap(u.json.features, want), 'unchanged: ' + u.text.slice(0, 240));
    const old = await call('GET', '/api/gm/display?seq=0', { user: IPAD });
    expect(old.status === 200 && !('features' in old.json), 'a call without hseq is answered as before');
  });

  await step('the settings (what the GM page copies): fx.off and room.music land as stored and a phone and the iPad read each as stored; turning one off lands', async () => {
    let r = await call('PATCH', '/api/campaign', { user: GM, body: { features: { 'fx.off': true, 'room.music': true } } });
    expect(r.status === 200 && same(sorted(await stored()), sorted({ phoneCards: true, 'map.flashback': false, 'fx.off': true, 'room.music': true })), 'stored ' + JSON.stringify(await stored()));
    const g = await call('GET', '/api/campaign', { user: PLAYER }), p = await poll(IPAD);
    expect(g.json.doc.features['fx.off'] === true && g.json.doc.features['room.music'] === true && p.json.features['fx.off'] === true && p.json.features['room.music'] === true, 'both read on: ' + JSON.stringify(p.json.features));
    r = await call('PATCH', '/api/campaign', { user: GM, body: { features: { 'fx.off': false } } });
    const p2 = await poll(IPAD);
    expect(p2.json.features['fx.off'] === false && p2.json.features['room.music'] === true, 'fx.off off, room.music on: ' + JSON.stringify(p2.json.features));
  });

  await step('the old All off (an older page writing every id false): the display and phone settings read off, the GM-surface settings are not served at all, and every other display and phone feature is still ON; null removes the stored map and the served one stays', async () => {
    const ids = Features.publicIds();
    const off = {}; ids.forEach((i) => { off[i] = false; });
    const r = await call('PATCH', '/api/campaign', { user: GM, body: { features: off } });
    expect(r.status === 200 && sameMap(await stored(), off), 'stored all false ' + JSON.stringify(await stored()));
    const g = await call('GET', '/api/campaign', { user: PLAYER }), p = await poll(IPAD);
    for (const m of [g.json.doc.features, p.json.features]) {
      expect(NON_SETTINGS.every((i) => m[i] === true) && servedAllOff(m), 'served: ' + JSON.stringify(m));
    }
    for (const t of [g.text, p.text]) for (const id of GM_SETTINGS) expect(!t.includes('"' + id + '"'), 'the GM-surface setting ' + id + ' reached a phone or the iPad');
    const n = await call('PATCH', '/api/campaign', { user: GM, body: { features: null } });
    expect(n.status === 200 && (await stored()) === undefined, 'null removes the stored map');
    const p2 = await poll(IPAD), g2 = await call('GET', '/api/campaign', { user: PLAYER });
    expect(sameMap(p2.json.features, servedFeatures({})) && sameMap(g2.json.doc.features, servedFeatures({})), 'and the served map is the one with nothing stored');
  });

  await step('a GM-surface setting written ON into the campaign document (kit.desk, night.who, blade.pitches) is dropped on the write and never served to a phone or the iPad', async () => {
    const body = { phoneCards: false }; GM_SETTINGS.forEach((i) => { body[i] = true; });
    const r = await call('PATCH', '/api/campaign', { user: GM, body: { features: body } });
    expect(r.status === 200 && same(await stored(), { phoneCards: false }), 'stored ' + JSON.stringify(await stored()));
    const g = await call('GET', '/api/campaign', { user: PLAYER }), p = await poll(IPAD);
    for (const m of [g.json.doc.features, p.json.features]) expect(m.phoneCards === false && GM_SETTINGS.every((i) => !(i in m)), 'served: ' + JSON.stringify(m));
    for (const t of [g.text, p.text]) for (const id of GM_SETTINGS) expect(!t.includes('"' + id + '"'), 'the GM-surface setting ' + id + ' reached a phone or the iPad');
    const n = await call('PATCH', '/api/campaign', { user: GM, body: { features: null } });
    expect(n.status === 200 && (await stored()) === undefined, 'null removes the stored map');
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
