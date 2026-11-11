// night-who (Start the night): Registered as an empty stub by KS01.1 of the kit and stage build; KS11 fills it.
// It starts no server and opens no browser yet: it checks that its files are registered and exist. Its default port is 9409,
// with wrangler's inspector on PORT + 20000, as the other browser checks do.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9409] node checks/runtime/night-who.e2e.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9409);
const FILES = ['app/gm/kit/who.js', 'app/ui/desk-who.css'];
assert.ok(Number.isInteger(PORT) && PORT > 0, 'a port');
for (const f of FILES) assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' exists');
console.log('PASS night-who: a stub until KS11 (port ' + PORT + ')');
