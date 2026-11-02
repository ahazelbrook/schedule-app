// Unit test for the GM page's tool registry and phase filter (app/gm/tools.js) and the Workshop's shell (app/gm/workshop.js), suite ticket W0.5. No browser, no network.
// The page-level checks (tabs hide, the layout is today's with the filter off, the Workshop sheet opens) are in checks/runtime/gm-seams.e2e.mjs.
//   node checks/runtime/gm-tools.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const T = require(path.join(ROOT, 'app', 'gm', 'tools.js'));
const WS = require(path.join(ROOT, 'app', 'gm', 'workshop.js'));

let failed = 0, passed = 0;
async function test(name, fn) {
  T.reset();
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}

await test('the phases are the Run Sheet\'s four, in order', () => {
  assert.deepEqual(T.PHASES.map((p) => p.label), ['Personal Business', 'Planning', 'Score', 'Aftermath']);
  assert.deepEqual(T.ALL, ['pb', 'plan', 'score', 'after']);
  const night = require(path.join(ROOT, 'app', 'gm', 'night.js'));
  assert.deepEqual(T.PHASES.map((p) => [p.id, p.label]), night.PHASES.map((p) => [p.id, p.label]), 'the same ids and labels as night.phase (W0.4), so the rail needs no translation');
});
await test('today\'s tabs and panels carry the phase tags the ticket asks for (the table in the report)', () => {
  const want = {
    console: 'all', prep: 'all', rules: 'all', npc: 'all', ipad: 'all',
    run: ['score'], score: ['plan'], downtime: ['pb', 'after'], location: ['plan', 'score'], scenes: ['score'], chase: ['score'], cards: ['plan']
  };
  for (const [id, ph] of Object.entries(want)) assert.deepEqual(T.phasesOf(id), ph === 'all' ? T.ALL : ph, id);
  assert.deepEqual(Object.keys(want).sort(), T.list().map((t) => t.id).sort(), 'every built-in tool is tagged, and nothing else is built in');
  assert.deepEqual(T.list().filter((t) => t.key).map((t) => t.id + ':' + t.key).sort(), ['cards:O', 'chase:C', 'downtime:D', 'ipad:I', 'location:B', 'npc:N', 'prep:R', 'rules:T', 'run:G', 'scenes:S', 'score:J']);
  assert.ok(T.list().every((t) => t.workshop === false), 'nothing is behind the Workshop yet');
  const tb = T.table(); assert.deepEqual(tb.find((r) => r.id === 'downtime').phases, ['Personal Business', 'Aftermath']); assert.deepEqual(tb.find((r) => r.id === 'prep').phases, ['every phase']);
});
await test('with the filter off (the default) every tab is visible: the page is today\'s', () => {
  assert.deepEqual(T.filter(), { on: false, phase: '', all: false });
  for (const t of T.tabs()) assert.equal(T.visible(t.id), true, t.id);
  T.setFilter({ phase: 'plan' });                    // a phase chosen but the filter not on
  for (const t of T.tabs()) assert.equal(T.visible(t.id), true, t.id);
  T.setFilter({ on: true, all: true });                  // "All tools" overrides the phase
  for (const t of T.tabs()) assert.equal(T.visible(t.id), true, t.id);
});
await test('a test tool tagged Planning hides outside Planning when the filter is on, and shows inside it', () => {
  T.register({ id: 'testtool', label: 'Test tool', phases: ['plan'], mount() {} });
  assert.equal(T.visible('testtool'), true, 'filter off');
  T.setFilter({ on: true, phase: 'plan' }); assert.equal(T.visible('testtool'), true);
  for (const ph of ['pb', 'score', 'after']) { T.setFilter({ phase: ph }); assert.equal(T.visible('testtool'), false, ph); }
  T.setFilter({ phase: 'plan' }); assert.equal(T.visible('testtool'), true);
  T.setFilter({ on: false }); T.setFilter({ phase: 'score' }); assert.equal(T.visible('testtool'), true, 'off again: back to today\'s');
});
await test('the filter shows each built-in only in its phases (Run in the Score, Score in Planning, Downtime in Personal Business and the Aftermath)', () => {
  T.setFilter({ on: true, phase: 'score' });
  assert.deepEqual(T.tabs().filter((t) => T.visible(t.id)).map((t) => t.id).sort(), ['chase', 'console', 'ipad', 'location', 'npc', 'prep', 'rules', 'run', 'scenes']);
  T.setFilter({ phase: 'plan' });
  assert.deepEqual(T.tabs().filter((t) => T.visible(t.id)).map((t) => t.id).sort(), ['cards', 'console', 'ipad', 'location', 'npc', 'prep', 'rules', 'score']);
  T.setFilter({ phase: 'pb' });
  assert.deepEqual(T.tabs().filter((t) => T.visible(t.id)).map((t) => t.id).sort(), ['console', 'downtime', 'ipad', 'npc', 'prep', 'rules']);
  T.setFilter({ phase: 'after' });
  assert.deepEqual(T.tabs().filter((t) => T.visible(t.id)).map((t) => t.id).sort(), ['console', 'downtime', 'ipad', 'npc', 'prep', 'rules']);
});
await test('the tab on screen is always kept, whatever the phase', () => {
  T.setFilter({ on: true, phase: 'plan' });
  assert.equal(T.visible('run'), false); assert.equal(T.visible('run', { current: 'run' }), true); assert.equal(T.visible('chase', { current: 'run' }), false);
});
await test('a filter with no phase chosen hides nothing; a bad phase is ignored', () => {
  T.setFilter({ on: true }); for (const t of T.tabs()) assert.equal(T.visible(t.id), true);
  T.setFilter({ phase: 'nonsense' }); assert.equal(T.filter().phase, '');
});
await test('onChange fires when the filter moves or a tool is registered, not when nothing changed; off() stops it', () => {
  const heard = []; const off = T.onChange((f) => heard.push(JSON.stringify(f)));
  T.setFilter({ on: true, phase: 'score' }); T.setFilter({ on: true, phase: 'score' }); T.setFilter({ phase: 'plan' });
  assert.deepEqual(heard, ['{"on":true,"phase":"score","all":false}', '{"on":true,"phase":"plan","all":false}']);
  T.register({ id: 'x1', label: 'X', phases: 'all' }); assert.equal(heard.length, 3);
  off(); T.setFilter({ phase: 'after' }); assert.equal(heard.length, 3);
});
await test('register checks its tool: ids, labels, phases; a built-in cannot be replaced; the same id replaces a registered one', () => {
  assert.throws(() => T.register({ id: 'Bad Id', label: 'x', phases: 'all' }), /tool id/);
  assert.throws(() => T.register({ id: 'ok', label: '', phases: 'all' }), /label/);
  assert.throws(() => T.register({ id: 'ok', label: 'x', phases: ['nope'] }), /unknown phase/);
  assert.throws(() => T.register({ id: 'ok', label: 'x', phases: [] }), /empty/);
  assert.throws(() => T.register({ id: 'prep', label: 'x', phases: 'all' }), /built in/);
  assert.throws(() => T.register(null), /object/);
  T.register({ id: 'ok', label: 'One', phases: ['score'] }); T.register({ id: 'ok', label: 'Two', phases: ['plan', 'plan'] });
  assert.equal(T.get('ok').label, 'Two'); assert.deepEqual(T.phasesOf('ok'), ['plan']); assert.equal(T.list().filter((t) => t.id === 'ok').length, 1);
  assert.equal(T.unregister('ok'), true); assert.equal(T.unregister('ok'), false); assert.equal(T.unregister('prep'), false);
});
await test('extras are registered tools with a mount that are not behind the Workshop: the page gives each a tab; a workshop tool never has a tab', () => {
  T.register({ id: 'ex', label: 'Ex', phases: ['plan'], key: 'q', mount() {} });
  T.register({ id: 'nomount', label: 'No mount', phases: 'all' });
  T.register({ id: 'shop', label: 'Shop', phases: 'all', workshop: true, mount() {} });
  assert.deepEqual(T.extras().map((t) => t.id), ['ex']); assert.equal(T.get('ex').key, 'Q');
  assert.deepEqual(T.workshop().map((t) => t.id), ['shop']);
  assert.equal(T.visible('shop'), false, 'a workshop tool is not on the tab bar, filter or no filter');
  assert.ok(!T.tabs().some((t) => t.id === 'shop'));
});
await test('the Workshop\'s Menu line shows only when a tool is behind it (so the Menu is today\'s while the Workshop is empty)', () => {
  assert.equal(WS.menuLine(), ''); assert.deepEqual(WS.list(), []);
  T.register({ id: 'shop', label: 'Shop', phases: 'all', workshop: true });
  assert.match(WS.menuLine(), /data-gm="workshop"/); assert.deepEqual(WS.list(), [{ id: 'shop', label: 'Shop' }]);
  T.unregister('shop'); assert.equal(WS.menuLine(), '');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
