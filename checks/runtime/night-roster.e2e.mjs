// night-roster (the roster flows): Registered as an empty stub by KS01.1 of the kit and stage build; KS12 fills it.
// It starts no server and opens no browser yet: it checks that its files are registered and exist. Its default port is 9410,
// with wrangler's inspector on PORT + 20000, as the other browser checks do.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9410] node checks/runtime/night-roster.e2e.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9410);
const FILES = ['app/gm/kit/who.js'];
assert.ok(Number.isInteger(PORT) && PORT > 0, 'a port');
for (const f of FILES) assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' exists');
console.log('PASS night-roster: a stub until KS12 (port ' + PORT + ')');
