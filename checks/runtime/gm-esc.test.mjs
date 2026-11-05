// Unit test for the GM page's one Esc (app/gm/esc.js, the GM night rebuild, design section 6). No browser, no network.
//   node checks/runtime/gm-esc.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const E = require(path.join(ROOT, 'app', 'gm', 'esc.js'));

let failed = 0, passed = 0;
async function test(name, fn) {
  E.reset();
  try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
function box(open) { const b = { open, closed: 0 }; b.def = (priority, kind) => ({ priority, kind, isOpen: () => b.open, close: () => { b.open = false; b.closed++; } }); return b; }
const field = { tag: 'input', blurred: 0 };
const ctx = (over) => ({ field: null, isField: (el) => !!el && el.tag === 'input', blur: (el) => { el.blurred++; }, panic: () => { ctx.panics++; }, ...over });
ctx.panics = 0;

await test('the topmost open overlay closes first, one per press', () => {
  const find = box(true), menu = box(true), drawer = box(true);
  E.register('find', find.def(90)); E.register('drawer', drawer.def(50)); E.register('menu', menu.def(80));
  assert.equal(E.handle(ctx()), 'closed:find');
  assert.equal(E.handle(ctx()), 'closed:menu');
  assert.equal(E.handle(ctx()), 'closed:drawer');
  assert.deepEqual([find.closed, menu.closed, drawer.closed], [1, 1, 1]);
});
await test('a tie goes to the one registered last', () => {
  const a = box(true), b = box(true);
  E.register('pop-a', a.def(70)); E.register('pop-b', b.def(70));
  assert.equal(E.handle(ctx()), 'closed:pop-b');
});
await test('closed overlays are skipped; then a focused field is left; then the stamp; then PANIC', () => {
  const find = box(false), stamp = box(true);
  E.register('find', find.def(90)); E.register('stamp', stamp.def(10, 'stamp'));
  const f = { ...field };
  assert.equal(E.handle(ctx({ field: f })), 'blur');
  assert.equal(f.blurred, 1);
  assert.equal(E.handle(ctx()), 'stamp');
  assert.equal(stamp.closed, 1);
  const before = ctx.panics;
  assert.equal(E.handle(ctx()), 'panic');
  assert.equal(ctx.panics, before + 1);
});
await test('an open overlay beats a focused field (Esc in Find closes Find, it does not just blur)', () => {
  const find = box(true);
  E.register('find', find.def(90));
  assert.equal(E.handle(ctx({ field: { ...field } })), 'closed:find');
});
await test('the stamp never closes before an overlay, whatever its priority', () => {
  const stamp = box(true), drawer = box(true);
  E.register('stamp', stamp.def(999, 'stamp')); E.register('drawer', drawer.def(50));
  assert.equal(E.handle(ctx()), 'closed:drawer');
  assert.equal(E.handle(ctx()), 'stamp');
});
await test('anyOpen counts overlays only, never the stamp', () => {
  const stamp = box(true), menu = box(false);
  E.register('stamp', stamp.def(10, 'stamp')); E.register('menu', menu.def(80));
  assert.equal(E.anyOpen(), false);
  menu.open = true;
  assert.equal(E.anyOpen(), true);
});
await test('register replaces by id; unregister removes only its own entry', () => {
  const a = box(true), b = box(true);
  const offA = E.register('pop', a.def(70));
  E.register('pop', b.def(70));
  assert.equal(E.list().length, 1);
  offA();
  assert.equal(E.list().length, 1, 'the stale unregister must not drop the replacement');
  assert.equal(E.handle(ctx()), 'closed:pop');
  assert.equal(b.closed, 1);
});
await test('a throwing entry is skipped and reported, never fatal', () => {
  const errs = [];
  E.register('bad', { priority: 99, isOpen: () => { throw new Error('boom'); }, close: () => {} });
  const ok = box(true); E.register('ok', ok.def(50));
  assert.equal(E.handle(ctx({ onError: (id) => errs.push(id) })), 'closed:ok');
  assert.deepEqual(errs, ['bad']);
});
await test('bad registrations are refused', () => {
  assert.throws(() => E.register('', { isOpen() {}, close() {} }));
  assert.throws(() => E.register('1x', { isOpen() {}, close() {} }));
  assert.throws(() => E.register('ok', { isOpen: () => true }));
});
await test('with no panic given, nothing open: none', () => {
  assert.equal(E.handle({}), 'none');
});

console.log((failed ? 'FAIL' : 'PASS') + ' gm-esc: ' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
