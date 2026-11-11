// kit-stage-roll: Registered as an empty stub by KS01.1 of the kit and stage build; KS15 fills it. No browser, no network.
// For now it checks that the files it will test are registered and exist.
//   node checks/runtime/kit-stage-roll.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILES = ['app/display/kit/roll.js', 'app/display/kit/roll.css'];
for (const f of FILES) assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' exists');
console.log('PASS kit-stage-roll: a stub until KS15 (' + FILES.length + ' file' + (FILES.length === 1 ? '' : 's') + ' in place)');
console.log('\n1 passed, 0 failed');
