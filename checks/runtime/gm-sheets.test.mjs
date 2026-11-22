// gm-sheets: Registered as a stub by RK30 (the late registrar) of the room key build; RK33 fills it. No browser, no network, no vault.
// For now it checks that scripts/gm-sheets.mjs exports buildSheets(opts) returning { sheets: [], errors: [], warnings: [] }, that the `gm:sheets` script is in
// package.json, and that the guard every write must pass (assertInsideSheets) lets app/media/sheets/ and what is inside it through and refuses anything else.
//   node checks/runtime/gm-sheets.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = path.join(ROOT, 'scripts', 'gm-sheets.mjs');
const M = await import(pathToFileURL(FILE).href);
let passed = 0, failed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

await test('gm-sheets: buildSheets(opts) is a stub returning { sheets: [], errors: [], warnings: [] }', () => {
  assert.equal(typeof M.buildSheets, 'function');
  assert.deepEqual(M.buildSheets({}), { sheets: [], errors: [], warnings: [] });
  assert.deepEqual(M.buildSheets({ vault: 'nowhere', dry: true }), { sheets: [], errors: [], warnings: [] });
  assert.deepEqual(M.buildSheets(), { sheets: [], errors: [], warnings: [] }, 'no options at all');
});
await test('gm-sheets: package.json has the gm:sheets script, running scripts/gm-sheets.mjs', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['gm:sheets'] || '', /scripts\/gm-sheets\.mjs/);
});
await test('gm-sheets: the guard lets app/media/sheets/ and its insides through, and refuses everything else (a sibling, a parent, a traversal, another media folder)', () => {
  const S = path.join(ROOT, 'app', 'media', 'sheets');
  assert.equal(M.SHEETS_DIR, S);
  assert.equal(M.assertInsideSheets(S), S);
  assert.equal(M.assertInsideSheets(path.join(S, 'a', 'b.png')), path.join(S, 'a', 'b.png'));
  for (const bad of [path.join(ROOT, 'app', 'media'), path.join(ROOT, 'app', 'media', 'handouts', 'x.png'), path.join(ROOT, 'app', 'media', 'sheets-x'), path.join(S, '..', 'x.png'),
    path.join(S, 'a', '..', '..', 'x.png'), path.join(ROOT, 'app', 'sheet', 'glance.js'), ROOT, path.parse(ROOT).root]) {
    assert.throws(() => M.assertInsideSheets(bad), /only inside app\/media\/sheets/, bad);
  }
  assert.throws(() => M.buildSheets({ dest: path.join(ROOT, 'app', 'media') }), /only inside/, 'a dest outside app/media/sheets/ is refused before anything happens');
  assert.throws(() => M.buildSheets({ dest: path.join(ROOT, 'app', 'sheet') }), /only inside/);
});
await test('gm-sheets: run as a command it exits 0 with its one-line count, and touches no file (the tracked tree and app/media are as they were)', () => {
  const before = fs.existsSync(path.join(ROOT, 'app', 'media')) ? fs.readdirSync(path.join(ROOT, 'app', 'media')).sort().join() : '-';
  const r = spawnSync(process.execPath, [FILE, '--vault', 'nowhere'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /sheets: 0 page\(s\), 0 error\(s\), 0 warning\(s\)/);
  const after = fs.existsSync(path.join(ROOT, 'app', 'media')) ? fs.readdirSync(path.join(ROOT, 'app', 'media')).sort().join() : '-';
  assert.equal(after, before, 'app/media is unchanged');
  const bad = spawnSync(process.execPath, [FILE, '--dest', path.join(ROOT, 'app', 'sheet')], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(bad.status, 1, 'a dest outside the folder: exit 1');
  assert.match(bad.stderr, /only inside app\/media\/sheets/);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
