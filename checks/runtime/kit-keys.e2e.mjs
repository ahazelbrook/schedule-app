// kit-keys (every key, with the kit off and on): Registered as an empty stub by KS01.1 of the kit and stage build; KS04 fills it.
// It starts no server and opens no browser yet: it checks that its files are registered and exist. Its default port is 9402,
// with wrangler's inspector on PORT + 20000, as the other browser checks do.
//   PW_MODULE=<path to playwright> [PW_CHANNEL=msedge] [PORT=9402] node checks/runtime/kit-keys.e2e.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT || 9402);
const FILES = ['app/ui/kit-flag.js'];
assert.ok(Number.isInteger(PORT) && PORT > 0, 'a port');
for (const f of FILES) assert.ok(fs.existsSync(path.join(ROOT, f)), f + ' exists');
console.log('PASS kit-keys: a stub until KS04 (port ' + PORT + ')');
