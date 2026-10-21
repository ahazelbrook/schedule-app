// The two vendored kits against app/kits.json (scripts/kits.mjs): each file matches its sha256, size and version, loads in Node,
// and sits in a routes.js bundle (so the service worker precaches it and the page that needs it loads it).
//   node checks/runtime/kits.test.mjs
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { KITS, verify, readManifest, cmpVersion } from '../../scripts/kits.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0;
async function test(name, fn) { try { await fn(); console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function eq(a, b, msg) { const A = JSON.stringify(a), B = JSON.stringify(b); if (A !== B) throw new Error((msg || 'not equal') + ': got ' + A + ' want ' + B); }

await test('app/kits.json: both kits, and every file on disk matches its entry (sha256, bytes, the version the file reports)', () => {
  const man = readManifest();
  eq(Object.keys(man.kits).sort(), Object.keys(KITS).sort(), 'the kits');
  for (const [n, m] of Object.entries(man.kits)) {
    ok(/^[0-9a-f]{64}$/.test(m.sha256), n + ' sha256'); ok(typeof m.source === 'string' && m.source && !/^unknown/.test(m.source), n + ' says where it came from');
    eq(Object.keys(m).filter((k) => k !== 'note').sort(), ['at', 'bytes', 'file', 'global', 'sha256', 'source', 'version'], n + ' fields');
    if ('note' in m) ok(typeof m.note === 'string' && m.note.length > 0, n + ' note');
  }
  eq(verify(man), [], 'mismatches');
});

await test('each kit is in a routes.js bundle, so sw.js precaches it; the map kit loads before gm-page.js and gm/chase.js', () => {
  const ctx = { self: {} }; ctx.window = ctx.self; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app', 'routes.js'), 'utf8'), ctx);
  const L = ctx.self.B68Load || ctx.B68Load; ok(L && L.files, 'B68Load');
  const all = L.files();
  for (const k of Object.values(KITS)) ok(all.indexOf(k.file) >= 0, k.file + ' is precached');
  const gm = L.BUNDLES && L.BUNDLES.gm; ok(Array.isArray(gm), 'the gm bundle');
  { ok(gm.indexOf('maps/map-kit.js') >= 0 && gm.indexOf('maps/map-kit.js') < gm.indexOf('gm-page.js') && gm.indexOf('maps/map-kit.js') < gm.indexOf('gm/chase.js'), 'gm bundle order'); }
});

await test('versions compare as releases: 0.8.0-beta.1 < 0.8.0 < 0.10.0; equal is 0', () => {
  eq([cmpVersion('0.7.0', '0.8.0-beta.1'), cmpVersion('0.8.0-beta.1', '0.8.0'), cmpVersion('0.8.0', '0.10.0'), cmpVersion('1.0.0', '1.0.0'), cmpVersion('0.8.0-beta.2', '0.8.0-beta.1')], [-1, -1, -1, 0, 1]);
});

await test('the map kit the app vendors has what the GM page asks of it (render views and themes, time, weather, the chase strip)', async () => {
  const { createRequire } = await import('node:module');
  const M = createRequire(import.meta.url)(path.join(ROOT, 'app', 'maps', 'map-kit.js'));
  const o = M.options();
  for (const v of ['iso', 'rings', 'plan', 'section', 'street']) ok(o.views.indexOf(v) >= 0, 'view ' + v);
  for (const t of ['rulebook', 'blueprint', 'casefile', 'board', 'plate']) ok(o.themes.indexOf(t) >= 0, 'theme ' + t);
  for (const t of ['Bluetime', 'Night']) ok(o.times.indexOf(t) >= 0, 'time ' + t);
  ok(typeof M.chase === 'function' && typeof M.chaseNew === 'function' && typeof M.chaseTick === 'function', 'the chase strip');
});

console.log('\n' + (failed ? failed + ' FAILED' : 'ALL PASSED'));
process.exit(failed ? 1 : 0);
