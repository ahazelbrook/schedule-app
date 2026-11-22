// room-key (things in rooms (room.key)): Registered as a stub by RK01 of the room key build; filled by RK09 to RK11.
// It starts no server and opens no browser yet: it prints "stub" and checks that its files are registered and exist. Its default port is 9502,
// with wrangler's inspector on PORT + 20000, as the other browser checks do (a builder runs it on a port of their own).
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9502] node checks/runtime/room-key.e2e.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9502);
assert.ok(Number.isInteger(PORT) && PORT > 0, 'a port');
for (const f of ['app/routes.js', 'app/features.js']) assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' exists');
console.log('stub: room-key fills in at RK09 to RK11 (port ' + PORT + ')');
console.log('PASS room-key: a stub');
