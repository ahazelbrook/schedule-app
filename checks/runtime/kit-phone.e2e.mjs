// kit-phone (the four-screen sheet): Registered as an empty stub by KS01.1 of the kit and stage build; KS17 fills it.
// It starts no server and opens no browser yet: it checks that its files are registered and exist. Its default port is 9415,
// with wrangler's inspector on PORT + 20000, as the other browser checks do.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9415] node checks/runtime/kit-phone.e2e.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9415);
const FILES = ['app/sheet/kit/tabs.js', 'app/sheet/kit/tabs.css'];
assert.ok(Number.isInteger(PORT) && PORT > 0, 'a port');
for (const f of FILES) assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' exists');
console.log('PASS kit-phone: a stub until KS17 (port ' + PORT + ')');
