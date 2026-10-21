// Handouts (GM.md "Handouts"): the manifest export, the gm:handouts copy and skip rules, the display kind on the server and on the iPad,
// and the GM page's pure helpers. Invented fixtures: tiny generated images in a temp folder, invented titles and file names.
//   node checks/runtime/gm-handouts.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const GP = require(path.join(ROOT, 'app', 'gm-page.js'))._pure;
const DPM = require(path.join(ROOT, 'app', 'display-page.js'));
const DP = DPM.Pure || DPM._pure || DPM;
const { cleanDisplay, DISPLAY_KINDS } = await import(pathToFileURL(path.join(ROOT, 'functions', '_lib', 'gm.js')).href);
const X = await import(pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'handouts-export.mjs')).href);
const H = await import(pathToFileURL(path.join(ROOT, 'scripts', 'gm-handouts.mjs')).href);

let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>';
const img = (tag) => Buffer.concat([PNG, Buffer.from(tag)]);       /* distinct bytes, so distinct hashes */
const hn = (buf, ext) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16) + ext;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-handouts-'));
process.on('exit', () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {} });

/* an invented vault: <vault>/Wiki/Games/Blades in the Dark/Campaigns/Group/handouts/ */
const GROUP = ['Wiki', 'Games', 'Blades in the Dark', 'Campaigns', 'Group', 'handouts'];
const vault = path.join(tmp, 'vault');
const src = path.join(vault, ...GROUP);
fs.mkdirSync(path.join(src, 'sub'), { recursive: true });
fs.writeFileSync(path.join(src, 'Brass Key Sketch.png'), img('key'));
fs.writeFileSync(path.join(src, 'harbour-ticket.JPG'), img('ticket'));
fs.writeFileSync(path.join(src, 'sub', 'harbour-ticket.jpg'), img('ticket2'));          // a name clash in another folder
fs.writeFileSync(path.join(src, 'lantern_map.svg'), SVG);
fs.writeFileSync(path.join(src, 'spin.gif'), img('gif'));
const H_KEY = hn(img('key'), '.png'), H_TICKET = hn(img('ticket'), '.jpg'), H_TICKET2 = hn(img('ticket2'), '.jpg'), H_PLAIN = hn(img('plain'), '.webp'), H_SVG = hn(Buffer.from(SVG), '.svg'), H_GIF = hn(img('gif'), '.gif');
const H_ANIM = hn(Buffer.from('x'), '.gif');
const HASHED = [H_KEY, H_TICKET, H_TICKET2, H_PLAIN, H_SVG, H_GIF, H_ANIM];
fs.writeFileSync(path.join(src, 'plain.webp'), img('plain'));
fs.writeFileSync(path.join(src, 'old-manifest.pdf'), 'x');
fs.writeFileSync(path.join(src, 'scan.tiff'), 'x');
fs.writeFileSync(path.join(src, 'anim.gif'), 'x');
fs.writeFileSync(path.join(src, 'old.bmp'), 'x');
fs.writeFileSync(path.join(src, 'notes.md'), [
  '# Invented props', '', '## The ticket stub', '![[harbour-ticket.JPG]]', 'When: after the dock clue', '',
  '## Heading for the key', '![[Brass Key Sketch.png|The brass key]]', '![[plain.webp|300]]', 'a line that is not a cue', ''].join('\n'));
fs.writeFileSync(path.join(src, '_hidden.png'), img('hidden'));
const opts = { vault, exportedAt: '2026-10-22T00:00:00Z', repo: null };

await test('scan: web images only; the rest named as skipped; hidden files ignored', () => {
  const r = X.scanHandouts(src);
  assert.deepEqual(r.items.map((i) => i.file).sort(), HASHED.slice().sort(), 'every served name is a content hash');
  assert.ok(r.items.every((i) => /^[0-9a-f]{16}\.[a-z]+$/.test(i.file)));
  assert.ok(r.items.some((i) => i.file.endsWith('.gif')), 'GIF is allowed');
  assert.deepEqual(r.skipped.map((s) => s.rel).sort(), ['old-manifest.pdf', 'old.bmp', 'scan.tiff']);
  assert.ok(r.skipped.every((s) => /not a web image/.test(s.why)));
});

await test('scan: titles from the vault (alias, then heading, then file name); cue only from a When:/Cue: line; ids unique', () => {
  const by = Object.fromEntries(X.scanHandouts(src).items.map((i) => [i.file, i]));
  assert.equal(by[H_KEY].title, 'The brass key');
  assert.equal(by[H_TICKET].title, 'The ticket stub');
  assert.equal(by[H_TICKET].when, 'after the dock clue');
  assert.equal(by[H_PLAIN].title, 'Heading for the key', 'a numeric alias is a size, not a caption');
  assert.equal(by[H_PLAIN].when, undefined, 'no cue unless the vault gives one');
  assert.equal(by[H_SVG].title, 'lantern map');
  assert.equal(by[H_TICKET2].title, 'harbour ticket');
  const ids = X.scanHandouts(src).items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
});

await test('buildHandouts: the part is { v, rel, items } with no source paths; no folder or no images: no part', () => {
  const part = X.buildHandouts(opts);
  assert.equal(part.v, 1); assert.equal(part.rel, GROUP.join('/'));
  assert.equal(part.items.length, 7);
  assert.ok(!JSON.stringify(part).match(/Brass|lantern_map|harbour-ticket|plain\.webp/i.source ? /Brass-Key|lantern_map\.svg|harbour-ticket\.|plain\.webp|Brass Key Sketch/ : 0), 'the vault file names are not in the pack');
  for (const i of part.items) { assert.deepEqual(Object.keys(i).filter((k) => !['id', 'title', 'file', 'when'].includes(k)), []); assert.ok(X.FILE_RE.test(i.file)); }
  assert.ok(!JSON.stringify(part).includes(tmp), 'no local path in the pack');
  assert.ok(part.src.blockSha && part.src.exportedAt);
  assert.equal(X.buildHandouts({ ...opts, vault: path.join(tmp, 'nowhere') }), null);
  const empty = path.join(tmp, 'v2'); fs.mkdirSync(path.join(empty, ...GROUP), { recursive: true });
  fs.writeFileSync(path.join(empty, ...GROUP, 'x.pdf'), 'x');
  const warns = []; assert.equal(X.buildHandouts({ vault: empty, exportedAt: 'x', warn: (m) => warns.push(m) }), null);
  assert.ok(warns.some((w) => /x\.pdf/.test(w)));
});

await test('buildHandouts: warns when the images are not in app/media/handouts yet', () => {
  const repo = path.join(tmp, 'repo'); fs.mkdirSync(path.join(repo, 'app', 'media', 'handouts'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'app', 'media', 'handouts', H_PLAIN), img('plain'));
  const warns = []; X.buildHandouts({ ...opts, repo, warn: (m) => warns.push(m) });
  assert.ok(warns.some((w) => /6 of 7 image/.test(w)), warns.join('|'));
});

await test('safeName: spaces, odd characters and bad extensions', () => {
  assert.equal(X.safeName('A  b (c).PNG'), 'A-b-c.png');
  assert.equal(X.safeName('x y.png'), 'x-y.png');
  assert.equal(X.safeName('.png'), null); assert.equal(X.safeName('a.pdf'), null);
  assert.equal(X.hashName(Buffer.from('abc'), 'Pic.JPEG'), 'ba7816bf8f01cfea.jpg');
});

await test('gm:handouts: copies, is idempotent, writes the private manifest, skips the rest, deletes nothing', () => {
  const dest = path.join(tmp, 'media'), manifest = path.join(tmp, 'gm-private', 'handouts-manifest.json');
  const stale = 'deadbeefdeadbeef.png';
  fs.mkdirSync(dest, { recursive: true }); fs.writeFileSync(path.join(dest, 'older.png'), PNG); fs.writeFileSync(path.join(dest, stale), PNG);
  const r1 = H.run({ vault, dest, manifest });
  assert.equal(r1.copied, 7); assert.equal(r1.same, 0); assert.equal(r1.skipped.length, 3);
  assert.deepEqual(r1.removed, [stale], 'a stale hashed file goes');
  assert.deepEqual(fs.readdirSync(dest).sort(), HASHED.concat(['older.png']).sort(), 'only hashed names, plus a file that was not ours');
  assert.ok(!fs.existsSync(path.join(dest, stale)));
  assert.deepEqual(fs.readFileSync(path.join(dest, H_KEY)), img('key'), 'the bytes are the vault image');
  assert.equal(JSON.parse(fs.readFileSync(manifest, 'utf8')).length, 7);
  const r2 = H.run({ vault, dest, manifest });
  assert.equal(r2.copied, 0); assert.equal(r2.same, 7); assert.equal(r2.removed.length, 0);
  /* an image changed in the vault: the new hash is copied, the old hashed file is removed */
  fs.writeFileSync(path.join(src, 'plain.webp'), img('plain-v2'));
  const r4 = H.run({ vault, dest, manifest });
  assert.equal(r4.copied, 1); assert.deepEqual(r4.removed, [H_PLAIN]); assert.ok(fs.existsSync(path.join(dest, hn(img('plain-v2'), '.webp'))));
  fs.writeFileSync(path.join(src, 'plain.webp'), img('plain'));
  H.run({ vault, dest, manifest });
  const dry = path.join(tmp, 'dry'); const r3 = H.run({ vault, dest: dry, manifest: path.join(tmp, 'm.json'), dry: true });
  assert.equal(r3.copied, 7); assert.ok(!fs.existsSync(dry));
  assert.match(H.run({ vault: path.join(tmp, 'nowhere'), dest }).error, /no handouts folder/);
  assert.match(H.run({ vault, src: 'Not/There', dest }).error, /Not\/There/);
});

await test('gm:handouts CLI: prints counts and names, no titles', () => {
  const dest = path.join(tmp, 'cli-media');
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'gm-handouts.mjs'), '--vault', vault, '--dest', dest, '--dry'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /images 7: copied 7, already there 0, skipped 3, stale removed 0/); assert.match(r.stdout, /skipped old-manifest\.pdf/);
  assert.ok(!/ticket stub|brass key/i.test(r.stdout));
});

await test('server: cleanDisplay accepts a handout, keeps only file/title/showTitle, refuses bad file names', () => {
  assert.ok(DISPLAY_KINDS.includes('handout'));
  assert.deepEqual(cleanDisplay({ kind: 'handout', title: 'The key', file: 'Brass-Key.png', showTitle: true, extra: 'x', md: 'x' }), { kind: 'handout', title: 'The key', caption: '', file: 'Brass-Key.png', showTitle: true });
  assert.equal(cleanDisplay({ kind: 'handout', file: 'a.webp', showTitle: 'yes' }).showTitle, false);
  for (const bad of ['', '../x.png', 'a/b.png', 'a\\b.png', 'x.pdf', '.png', 'a b.png', 'x.bmp', 'https://x/y.png', 'a..b/../c.png']) assert.throws(() => cleanDisplay({ kind: 'handout', file: bad }), (e) => e.status === 400, bad);
  assert.throws(() => cleanDisplay({ kind: 'handout' }), (e) => e.status === 400);
});

await test('iPad: the viewModel carries the one item only; bad files draw blank', () => {
  const vm = DP.viewModel({ kind: 'handout', title: 'The key', file: 'Brass-Key.png', showTitle: true, handouts: [{ id: 'a' }], manifest: 1 });
  assert.deepEqual(vm, { kind: 'handout', title: 'The key', file: 'Brass-Key.png', src: 'media/handouts/Brass-Key.png', showTitle: true });
  assert.equal(DP.viewModel({ kind: 'handout', file: 'a.png', title: '', showTitle: true }).showTitle, false, 'no title, no caption');
  for (const bad of [{}, { file: '../a.png' }, { file: 'a.pdf' }, { file: 5 }]) assert.deepEqual(DP.viewModel({ kind: 'handout', ...bad }), { kind: 'blank' });
});

await test('GM page: the list is checked, the display doc is the one item, the "on the iPad now" line names it', () => {
  const list = GP.handoutList({ v: 1, items: [{ id: 'a', title: ' The key ', file: 'k.png', when: 'after the dock' }, { id: 'a', file: 'dup.png' }, { id: 'b', file: '../x.png' }, { id: 'c', file: 'n.pdf' }, { id: 'd', file: 'd.svg' }, null, { file: 'z.png' }] });
  assert.deepEqual(list, [{ id: 'a', title: 'The key', file: 'k.png', when: 'after the dock' }, { id: 'd', title: 'd.svg', file: 'd.svg', when: '' }]);
  assert.deepEqual(GP.handoutList(null), []);
  assert.deepEqual(GP.handoutDisplay(list[0], true), { kind: 'handout', title: 'The key', file: 'k.png', showTitle: true });
  assert.deepEqual(GP.handoutDisplay(list[0], undefined), { kind: 'handout', title: 'The key', file: 'k.png', showTitle: false });
  assert.equal(GP.displayLine({ kind: 'handout', title: 'The key' }), 'Handout · The key');
  assert.ok(!('when' in GP.handoutDisplay(list[0], false)) && !('id' in GP.handoutDisplay(list[0], false)), 'no cue, no id, to the iPad');
});

console.log('\n' + (failed ? failed + ' FAILED, ' : 'ALL PASSED, ') + passed + ' passed');
process.exit(failed ? 1 : 0);
