// gm-npc-find: Registered as a stub by RK01 of the room key build; its own bundle fills it. No browser, no network.
// For now it loads app/gm/npc-find.js (under Node and as a plain script in a bare context) and checks that the global B68GmNpcFind exists and does nothing when called.
//   node checks/runtime/gm-npc-find.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const FILE = 'app/gm/npc-find.js';
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

test('gm-npc-find: the module loads under Node and is an object', () => {
  const M = require(path.join(ROOT, FILE));
  assert.ok(M && typeof M === 'object', 'module.exports is an object');
});
test('gm-npc-find: as a plain script it defines window.B68GmNpcFind and its stub does nothing when called', () => {
  const win = {}; win.self = win; win.window = win;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, FILE), 'utf8'), win, { filename: FILE });
  const M = win.B68GmNpcFind;
  assert.ok(M && typeof M === 'object', 'B68GmNpcFind is defined');
  assert.equal(M.stub, true, 'still a stub (the bundle that fills it replaces this test)');
  assert.equal(M.create(), null, 'create() does nothing');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
