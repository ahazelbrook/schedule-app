// kit-ui: Registered as an empty stub by KS01.1 of the kit and stage build; KS02 fills it. No browser, no network.
// For now it checks that the files it will test are registered and exist.
//   node checks/runtime/kit-ui.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILES = ['app/ui/tokens.css', 'app/ui/parts.css', 'app/ui/ui.js', 'app/ui/parts.json'];
for (const f of FILES) assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' exists');
console.log('PASS kit-ui: a stub until KS02 (' + FILES.length + ' file' + (FILES.length === 1 ? '' : 's') + ' in place)');
console.log('\n1 passed, 0 failed');
