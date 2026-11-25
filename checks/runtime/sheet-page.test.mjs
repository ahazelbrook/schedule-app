// sheet-page: Registered as a stub by RK30 (the late registrar) of the room key build; RK32 fills it. No browser, no network.
// For now it loads app/sheet/page.js (under Node and as a plain script in a bare context) and checks that the global B68SheetPage exists and does nothing when called.
//   node checks/runtime/sheet-page.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/sheet/page.js';
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

test('sheet-page: the module loads under Node and is an object', () => {
  const M = require(path.join(ROOT, FILE));
  assert.ok(M && typeof M === 'object', 'module.exports is an object');
});
test('sheet-page: as a plain script it defines window.B68SheetPage and its stub does nothing when called', () => {
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, FILE), 'utf8'), win, { filename: FILE });
  const M = win.B68SheetPage;
  assert.ok(M && typeof M === 'object', 'B68SheetPage is defined');
  assert.equal(M.stub, true, 'still a stub (the bundle that fills it replaces this test)');
  assert.equal(M.create(), null, 'create() does nothing');
  assert.equal(M.start(), null, 'start() does nothing');
  assert.equal(M.stop(), null, 'stop() does nothing');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
