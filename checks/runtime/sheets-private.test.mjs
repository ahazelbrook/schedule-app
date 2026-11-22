// sheets-private: the guard for the phone's Full sheet (RK30 of the room key build). This repository is public, and the playbook pages are the publisher's:
// they live only in app/media/sheets/ on the GM's PC (npm run gm:sheets) and are deployed from disk. The test fails if
//   - any file tracked by git is under app/media/, or
//   - any tracked .svg, .png, .jpg, .jpeg, .webp, .pdf or .map.json over 200 KB sits outside checks/ and the named allowances below, or
//   - .gitignore stops covering app/media/ and app/media/sheets/.
// No browser, no network. Reads `git ls-files` and `git check-ignore`.
//   node checks/runtime/sheets-private.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIMIT = 200 * 1024;
const BIG = /\.(svg|png|jpe?g|webp|pdf)$|\.map\.json$/i;
/* The allowances: a tracked picture or map over the limit that may stay, each by its exact path with the reason. Empty today: nothing tracked is over 200 KB
   (the largest, app/gm/blade.svg, is about 129 KB). Under checks/ anything goes: fixtures and goldens are invented data. Adding a name here needs a reason a reviewer accepts. */
export const ALLOW = {};
const ALLOW_DIRS = ['checks/'];

let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.message || e)); } }

const git = (...args) => execFileSync('git', args, { cwd: ROOT, maxBuffer: 1 << 28, encoding: 'utf8' });
const tracked = git('ls-files', '-z').split('\0').filter(Boolean);

/** What the guard objects to in a list of tracked paths: [{ path, why }]. `size` reads a path's bytes (a test of the guard passes its own). */
export function offences(files, size = (p) => fs.statSync(path.join(ROOT, p)).size) {
  const out = [];
  for (const p of files) {
    if (/^app\/media\//.test(p)) { out.push({ path: p, why: 'tracked under app/media/ (private art, deployed from disk)' }); continue; }
    if (!BIG.test(p) || ALLOW_DIRS.some((d) => p.startsWith(d)) || Object.prototype.hasOwnProperty.call(ALLOW, p)) continue;
    let n = 0; try { n = size(p); } catch (_) { continue; }      /* deleted in the working tree but still in the index: not a file to weigh */
    if (n > LIMIT) out.push({ path: p, why: 'a tracked ' + path.extname(p).slice(1) + ' of ' + Math.round(n / 1024) + ' KB (over 200 KB; art and maps are not committed)' });
  }
  return out;
}

test('sheets-private: nothing tracked by git is under app/media/, and no tracked svg, png, jpg, jpeg, webp, pdf or .map.json over 200 KB sits outside checks/ and the allowances', () => {
  assert.ok(tracked.length > 100, 'git ls-files listed the repository (' + tracked.length + ' files)');
  const bad = offences(tracked);
  assert.deepEqual(bad, [], 'offending files: ' + bad.map((b) => b.path + ' (' + b.why + ')').join('; '));
});
test('sheets-private: every named allowance is a tracked file that really is over the limit (no stale entry)', () => {
  for (const p of Object.keys(ALLOW)) {
    assert.ok(tracked.includes(p), p + ' is tracked');
    assert.ok(fs.statSync(path.join(ROOT, p)).size > LIMIT, p + ' is over 200 KB, else it needs no allowance');
    assert.ok(String(ALLOW[p]).length > 20, p + ' has its reason');
  }
});
test('sheets-private: the guard sees what it should (a made-up list: app/media/, a big svg, a big map, a big pdf, a big png, a big jpg, jpeg and webp in any letter case; and passes checks/, small ones and code)', () => {
  const sizes = { 'app/maps/site.svg': 300 * 1024, 'app/x.map.json': 201 * 1024, 'app/y.pdf': 5e6, 'app/z.png': LIMIT + 1, 'app/ok.png': LIMIT, 'app/p.jpg': LIMIT + 1, 'app/q.jpeg': 9e6, 'app/r.webp': LIMIT + 1, 'app/S.JPG': LIMIT + 1, 'app/ok.jpg': LIMIT, 'checks/golden/big.webp': 9e6, 'checks/golden/big.svg': 9e6, 'app/maps/map-kit.js': 9e6 };
  const files = ['app/media/sheets/a.png', 'app/media/handouts/b.png', ...Object.keys(sizes)];
  const got = offences(files, (p) => sizes[p]).map((o) => o.path);
  assert.deepEqual(got, ['app/media/sheets/a.png', 'app/media/handouts/b.png', 'app/maps/site.svg', 'app/x.map.json', 'app/y.pdf', 'app/z.png', 'app/p.jpg', 'app/q.jpeg', 'app/r.webp', 'app/S.JPG']);
});
test('sheets-private: .gitignore names app/media/ and app/media/sheets/, and git ignores a page put there', () => {
  const ig = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/).map((l) => l.trim());
  assert.ok(ig.includes('app/media/'), '.gitignore has app/media/');
  assert.ok(ig.includes('app/media/sheets/'), '.gitignore has app/media/sheets/ (named, so the intent survives a change to the line above it)');
  for (const probe of ['app/media/sheets/probe-page.png', 'app/media/sheets/probe-page.pdf', 'app/media/sheets/probe-page.jpg', 'app/media/sheets/probe-page.webp','app/media/sheets/deep/probe.map.json']) {
    let ignored = true; try { git('check-ignore', '-q', probe); } catch (_) { ignored = false; }
    assert.ok(ignored, 'git ignores ' + probe);
  }
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
