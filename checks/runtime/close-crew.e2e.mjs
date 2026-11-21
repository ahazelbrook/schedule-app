// close-crew (the close writes the crew (close.crew)): Registered as a stub by RK01 of the room key build; filled by RK07.
// It starts no server and opens no browser yet: it prints "stub" and checks that its files are registered and exist. Its default port is 9501,
// with wrangler's inspector on PORT + 20000, as the other browser checks do (a builder runs it on a port of their own).
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9501] node checks/runtime/close-crew.e2e.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9501);
assert.ok(Number.isInteger(PORT) && PORT > 0, 'a port');
for (const f of ['app/routes.js', 'app/features.js']) assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' exists');
console.log('stub: close-crew fills in at RK07 (port ' + PORT + ')');
console.log('PASS close-crew: a stub');
