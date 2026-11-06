// Unit test for the GM page's tool registry (app/gm/tools.js) and the right-edge sheet host (app/gm/workshop.js; the Workshop drawer itself went in N0),
// suite ticket W0.5. The phase filter went in the night rebuild (N1b): the places (app/gm/places.js, checks/runtime/gm-places.test.mjs) lay out each phase's tools,
// so nothing here hides anything. No browser, no network. The page-level checks are in checks/runtime/gm-places.e2e.mjs and gm-seams.e2e.mjs.
//   node checks/runtime/gm-tools.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const T = require(path.join(ROOT, 'app', 'gm', 'tools.js'));
const WS = require(path.join(ROOT, 'app', 'gm', 'workshop.js'));
const Places = require(path.join(ROOT, 'app', 'gm', 'places.js'));

let failed = 0, passed = 0;
async function test(name, fn) {
  T.reset();
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}

await test('the built-ins are the page\'s panes (and the console), with the labels and keys the places give them', () => {
  assert.deepEqual(T.list().map((t) => t.id), ['console', 'prep', 'rules', 'location', 'scenes', 'score', 'chase', 'npc', 'downtime', 'cards', 'ipad', 'run']);
  assert.ok(T.list().every((t) => t.builtin === true));
  assert.deepEqual(T.list().filter((t) => t.key).map((t) => t.id + ':' + t.key).sort(), ['cards:O', 'chase:C', 'downtime:D', 'ipad:I', 'location:B', 'npc:N', 'prep:R', 'rules:T', 'run:G', 'scenes:S', 'score:J']);
  for (const t of T.list().filter((x) => x.id !== 'console')) { const v = Places.view(t.id); assert.ok(v && v.pane === t.id, t.id + ' is a pane view'); assert.equal(v.label, t.label, t.id); assert.equal(v.key || '', t.key, t.id); }
  assert.deepEqual(T.table().find((r) => r.id === 'run'), { id: 'run', label: 'The site', key: 'G' });
});
await test('the phase filter and the Workshop flag are gone: nothing here can hide a tool', () => {
  for (const k of ['setFilter', 'filter', 'onChange', 'visible', 'phasesOf', 'inPhase', 'tabs', 'workshop', 'PHASES', 'ALL']) assert.equal(T[k], undefined, k);
  const t = T.register({ id: 'old', label: 'An older def', phases: ['plan'], workshop: true });
  assert.ok(!('phases' in t) && !('workshop' in t), 'an older def\'s phases and workshop are ignored, not refused');
});
await test('register checks its tool: ids and labels; a built-in cannot be replaced; the same id replaces a registered one', () => {
  assert.throws(() => T.register({ id: 'Bad Id', label: 'x' }), /tool id/);
  assert.throws(() => T.register({ id: 'ok', label: '' }), /label/);
  assert.throws(() => T.register({ id: 'prep', label: 'x' }), /built in/);
  assert.throws(() => T.register(null), /object/);
  T.register({ id: 'ok', label: 'One' }); T.register({ id: 'ok', label: 'Two', key: 'q', words: '  probe words ' });
  assert.equal(T.get('ok').label, 'Two'); assert.equal(T.get('ok').key, 'Q'); assert.equal(T.get('ok').words, 'probe words'); assert.equal(T.list().filter((t) => t.id === 'ok').length, 1);
  assert.equal(T.unregister('ok'), true); assert.equal(T.unregister('ok'), false); assert.equal(T.unregister('prep'), false);
  assert.equal(T.get('nothing'), null);
});
await test('extras: registered tools with a mount, which the places open as a view (an extra view of the place the GM is in) and Find lists', () => {
  T.register({ id: 'ex', label: 'Ex', key: 'q', mount() {} });
  T.register({ id: 'nomount', label: 'No mount' });
  assert.deepEqual(T.extras().map((t) => t.id), ['ex']);
  assert.ok(Places.findEntries(T.extras()).some((r) => r.title === 'Ex' && r.go.t === 'view' && r.go.id === 'ex'));
  T.reset(); assert.deepEqual(T.extras(), [], 'reset drops them');
});
await test('the object is the one a later module extends (gm/tool-registry.js wraps get): it keeps get and list as plain properties', () => {
  const was = T.get;
  T.get = function (id) { return was(id) || (id === 'probe' ? { id: 'probe', open() { return true; } } : null); };
  assert.equal(T.get('prep').builtin, true); assert.equal(typeof T.get('probe').open, 'function');
  T.get = was;
});
await test('the Workshop drawer is gone (N0): workshop.js is only the sheet host the tools open in, with no Menu line or tool list of its own', () => {
  assert.equal(typeof WS.sheet, 'function');
  for (const k of ['menuLine', 'list', 'open', 'toggle', 'close', 'render']) assert.equal(WS[k], undefined, k + ' is gone');
  assert.equal(WS.sheet(null, 'x', 'X'), null, 'no document, no sheet');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
