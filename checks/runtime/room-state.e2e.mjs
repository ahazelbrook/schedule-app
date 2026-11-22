// room-state (the stored room-state contract, room.key): Registered as a stub by RK01 of the room key build; filled by RK08.4.
// It starts no server and opens no browser yet: it prints "stub" and checks that its files are registered and exist. Its default port is 9505,
// with wrangler's inspector on PORT + 20000, as the other browser checks do (a builder runs it on a port of their own).
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9505] node checks/runtime/room-state.e2e.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9505);
assert.ok(Number.isInteger(PORT) && PORT > 0, 'a port');
for (const f of ['app/routes.js', 'app/features.js']) assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' exists');
console.log('stub: room-state fills in at RK08.4 (port ' + PORT + ')');
console.log('PASS room-state: a stub');
