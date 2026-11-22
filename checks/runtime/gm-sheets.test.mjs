// gm-sheets: the private step that turns the publisher's playbook PDF into the phone's Full sheet pages (RK33 of the room key build). No browser, no network, no vault.
//  - The guard every write passes (assertInsideSheets) lets app/media/sheets/ and what is inside it through and refuses anything else, junctions and symlinks included.
//  - The count rules (scripts/lib/sheets-check.mjs) on an INVENTED content table: what a page must hold, how items pair, what a waiver covers.
//  - The whole step on an INVENTED one-page PDF that PyMuPDF makes at test time (rectangles, circles, polygons and made-up words: checks/runtime/fixtures/sheets/
//    make-invented-pdf.py): it maps the page, checks the counts, writes the svg, the map and the proof, and REFUSES a page whose counts are wrong unless a fix covers them.
//    With no Python (or no PyMuPDF) those tests print a SKIP line and say why. Nothing of the publisher's is read, made or kept here.
//   node checks/runtime/gm-sheets.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FILE = path.join(ROOT, 'scripts', 'gm-sheets.mjs');
const M = await import(pathToFileURL(FILE).href);
const K = await import(pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'sheets-check.mjs')).href);
const MAKER = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'sheets', 'make-invented-pdf.py');
let passed = 0, failed = 0, skipped = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
function skip(name, why) { skipped++; console.log('SKIP ' + name + ': ' + why); }

/* ---- the guard ---- */
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
await test('gm-sheets: the guard follows junctions and symlinks: a link inside app/media/sheets/ that leads out is refused, one that stays inside is let through', () => {
  const S = path.join(ROOT, 'app', 'media', 'sheets');
  const made = [];                                   /* what this test creates, so it can remove exactly that (app/media/sheets may not exist yet) */
  const mk = (d) => { if (!fs.existsSync(d)) { mk(path.dirname(d)); fs.mkdirSync(d); made.push(d); } };
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-guard-out-'));
  const probe = path.join(S, '_guard-' + process.pid);
  try {
    mk(probe); mk(path.join(probe, 'real'));
    try { fs.symlinkSync(outside, path.join(probe, 'leak'), 'junction'); } catch (e) { console.log('SKIP no junction or symlink here (' + e.code + ')'); return; }
    fs.symlinkSync(path.join(probe, 'real'), path.join(probe, 'ok'), 'junction');
    assert.throws(() => M.assertInsideSheets(path.join(probe, 'leak')), /only inside app\/media\/sheets/, 'the link itself');
    assert.throws(() => M.assertInsideSheets(path.join(probe, 'leak', 'x.svg')), /only inside/, 'a file that does not exist yet, under the link');
    assert.throws(() => M.assertInsideSheets(path.join(probe, 'leak', 'deep', 'x.svg')), /only inside/, 'a deeper path under the link');
    assert.throws(() => M.buildSheets({ dest: path.join(probe, 'leak') }), /only inside/, 'a dest that is such a link is refused before anything happens');
    assert.equal(M.assertInsideSheets(path.join(probe, 'ok', 'x.svg')), path.join(probe, 'ok', 'x.svg'), 'a link that stays inside is fine');
    assert.equal(fs.readdirSync(outside).length, 0, 'nothing was written outside');
  } finally {
    for (const l of ['leak', 'ok']) { try { fs.unlinkSync(path.join(probe, l)); } catch (_) { /* never made */ } }
    for (const d of made.reverse()) { try { fs.rmdirSync(d); } catch (_) { /* not empty or gone: leave it */ } }
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
await test('gm-sheets: the private folder guard: a path inside it passes, a sibling, a parent and a traversal do not', () => {
  const priv = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-priv-'));
  try {
    assert.equal(M.assertInsidePrivate(priv, path.join(priv, 'proofs', 'p.png')), path.join(priv, 'proofs', 'p.png'));
    for (const bad of [path.dirname(priv), priv + '-x', path.join(priv, '..', 'x.png'), ROOT]) assert.throws(() => M.assertInsidePrivate(priv, bad), /only inside/, bad);
  } finally { fs.rmSync(priv, { recursive: true, force: true }); }
});

/* ---- the count rules, on an invented content table ---- */
const CONTENT = {
  PLAYBOOKS: [
    { id: 'dovetail', name: 'Dovetail', abilities: [1, 2, 3], items: [['Brass lantern', 1], ['Silk rope', 0]], contacts: [['Mabel Quist', 'a ferryman'], ['Dov Kessler', 'a clerk']], bank: false },
    { id: 'tin', name: 'Tin', abilities: [1, 2], resource: 'Tally (10 boxes, instead of Stress)', items: [], contacts: [] },
  ],
  PARANORMAL: [
    { id: 'wisp', name: 'Wisp', paranormal: true, stressMax: 12, abilities: [1], fixedAbility: { n: 'x' }, itemsRule: 'none', items: [], contacts: [] },
    { id: 'pelican', name: 'Pelican', paranormal: true, maxDot: 5, abilities: [1, 2], fixedAbility: { n: 'x' }, items: [['Vial', 1], ['Vial (second)', 1]], contacts: [] },
  ],
  STANDARD_ITEMS: [['Crowbar', 1], ['Heavy coat', 2]],
};
const rect = (i) => [i, 0, i + 1, 1];
const rects = (n) => Array.from({ length: n }, (_, i) => rect(i));
const goodMap = () => ({
  stress: rects(9), xp: rects(8), xpi: rects(6), xpp: rects(6), xpr: rects(6),
  acts: Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['A' + i, { l: rect(i), d: rects(4) }])),
  ab: Array.from({ length: 4 }, () => ({ n: 'x', b: [rect(0)], k: rect(0) })),
  items: [{ n: 'Brass lantern', s: rects(1), i: 0 }, { n: 'Silk rope', s: rects(1), i: 1 }, { n: 'Crowbar', s: rects(1), i: 0 }, { n: 'Heavy coat', s: rects(2), i: 0 }],
  stacks: rects(4), bank: [], harm: Array.from({ length: 6 }, () => ({ level: 1 })), heal: rect(0),
  keys: Array.from({ length: 4 }, () => ({ hits: rects(3) })), friends: [{ n: 'Mabel Quist, a ferryman' }, { n: 'Dov Kessler, a clerk' }],
});
const failing = (checks) => checks.filter((c) => !c.ok).map((c) => c.region);

await test('sheets-check: what a page must hold comes from content.js: stress (default, stressMax, a resource line that names its own track), abilities, items, bank, friends', () => {
  const dv = K.expectFor(CONTENT, 'dovetail');
  assert.equal(dv.stress, 9); assert.equal(dv.abilities, 4, '3 + Versatile'); assert.equal(dv.items.length, 4, '2 playbook items + the 2 standard ones'); assert.equal(dv.bank, 0);
  assert.equal(dv.dots, 4); assert.deepEqual(dv.friends, ['Mabel Quist, a ferryman', 'Dov Kessler, a clerk']); assert.equal(dv.xp, 8); assert.equal(dv.xpi, 6);
  assert.equal(K.expectFor(CONTENT, 'tin').stress, 10, '"(10 boxes" in the resource line is the box count'); assert.equal(K.expectFor(CONTENT, 'tin').bank, 40);
  const wisp = K.expectFor(CONTENT, 'wisp');
  assert.equal(wisp.stress, 12); assert.equal(wisp.items.length, 0, 'an items RULE means the page prints no item lines'); assert.equal(wisp.abilities, 2, 'paranormal: no Versatile');
  const pel = K.expectFor(CONTENT, 'pelican');
  assert.equal(pel.dots, 5, 'maxDot'); assert.equal(pel.items.length, 4);
  assert.throws(() => K.expectFor(CONTENT, 'nobody'), /no playbook "nobody"/);
});
await test('sheets-check: a map that is right passes every count, and each count fails on its own when broken (a deliberate break goes red)', () => {
  const exp = K.expectFor(CONTENT, 'dovetail');
  assert.deepEqual(failing(K.checkMap(goodMap(), exp)), []);
  const breaks = {
    stress: (m) => m.stress.pop(), xp: (m) => m.xp.pop(), xpi: (m) => { m.xpi = []; }, xpp: (m) => m.xpp.pop(), xpr: (m) => m.xpr.pop(),
    acts: (m) => { delete m.acts.A3; }, dots: (m) => m.acts.A0.d.pop(), abilities: (m) => m.ab.pop(),
    items: (m) => m.items.pop(), 'item loads': (m) => m.items[3].s.pop(), stacks: (m) => m.stacks.pop(), bank: (m) => m.bank.push(rect(0)), harm: (m) => m.harm.pop(), heal: (m) => { delete m.heal; },
    keys: (m) => m.keys.pop(), 'key hits': (m) => m.keys[1].hits.pop(), friends: (m) => m.friends.pop(),
  };
  for (const [region, brk] of Object.entries(breaks)) {
    const m = goodMap(); brk(m);
    assert.ok(failing(K.checkMap(m, exp)).includes(region), region + ' fails when broken: ' + failing(K.checkMap(m, exp)));
  }
});
await test('sheets-check: items pair by name, then by words ("Second bandolier" for "Bandolier"); a load-0 item must be italic with a box; a spare page line is an error', () => {
  const lines = [{ n: 'Bandolier', s: rects(1), i: 0 }, { n: 'Rope', s: rects(1), i: 1 }, { n: 'Extra thing', s: rects(1), i: 0 }];
  const items = [{ n: 'Second bandolier', load: 1, own: true }, { n: 'Rope', load: 0, own: true }, { n: 'Missing', load: 1, own: false }];
  const { pairs, spare } = K.pairItems(lines, items);
  assert.equal(pairs[0].line.n, 'Bandolier'); assert.equal(pairs[1].line.n, 'Rope'); assert.equal(pairs[2].line, null); assert.deepEqual(spare.map((l) => l.n), ['Extra thing']);
  assert.equal(K.itemProblem(items[1], lines[1]), ''); assert.match(K.itemProblem(items[1], lines[0]), /not in italics/); assert.match(K.itemProblem(items[1], { n: 'r', s: [], i: 1 }), /no box/);
  assert.equal(K.itemProblem(items[0], lines[0]), ''); assert.match(K.itemProblem({ n: 'g', load: 1, own: true }, { n: 'g', s: rects(3), i: 0 }), /3 square\(s\), data says 1/);
  assert.match(K.itemProblem({ n: 'g', load: 2, own: false }, null), /no line/);
});
await test('sheets-check: a fix replaces whole regions; a waiver covers a failed count only with a reason (8+ characters) and its family; anything else stays refused', () => {
  const exp = K.expectFor(CONTENT, 'dovetail');
  const short = goodMap(); short.stress.pop(); short.items[3].s.pop();
  const checks = K.checkMap(short, exp);
  assert.deepEqual(K.verdict(checks, null), { ok: false, failed: ['stress', 'item loads'], waived: [] });
  const v1 = K.verdict(checks, { waive: { stress: 'the printed page has 8 boxes' } });
  assert.deepEqual(v1.failed, ['item loads']); assert.equal(v1.ok, false);
  const v2 = K.verdict(checks, { waive: { stress: 'the printed page has 8 boxes', items: 'one item prints one box less' } });
  assert.equal(v2.ok, true); assert.deepEqual(v2.waived.map((w) => w.region), ['stress', 'item loads'], 'a waiver on items covers item loads too');
  assert.equal(K.verdict(checks, { waive: { stress: 'short', items: 'x' } }).ok, false, 'a reason under 8 characters covers nothing');
  assert.deepEqual(K.fixProblems({ waive: { stress: 'no' } }), ['waive "stress" needs a reason (8 characters or more)']); assert.deepEqual(K.fixProblems({ regions: {} }), []);
  const fixed = K.applyFix(short, { regions: { stress: rects(9), extra: [rect(0)], kinds: { extra: 'text' } } });
  assert.equal(fixed.stress.length, 9); assert.deepEqual(fixed.fixed, ['stress', 'extra']); assert.equal(fixed.kinds.extra, 'text'); assert.equal(short.stress.length, 8, 'the raw map is untouched');
  assert.equal(K.applyFix(short, null), short);
});

/* ---- the whole step, on an invented PDF ---- */
const PY = M.findPython();
if (!PY) {
  skip('gm-sheets: the whole step on an invented PDF', 'no Python with PyMuPDF on this PC (set B68_PYTHON); nothing else here needs it');
} else {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-sheets-test-'));
  const madeDirs = [];
  const mk = (d) => { if (!fs.existsSync(d)) { mk(path.dirname(d)); fs.mkdirSync(d); madeDirs.push(d); } };
  const dest = path.join(M.SHEETS_DIR, '_gm-sheets-test-' + process.pid);
  mk(dest);
  const contentFile = path.join(tmp, 'content.js');
  fs.writeFileSync(contentFile, 'window.B68Content = ' + JSON.stringify(CONTENT) + ';');
  const pdf = (name, ...args) => {
    const f = path.join(tmp, name + '.pdf');
    const r = spawnSync(PY, ['-I', MAKER, f, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0, 'making the invented pdf: ' + r.stderr);
    return f;
  };
  let seq = 0;
  /** A fresh private folder and a fresh dest for each build, so one test never sees another's files. */
  const run = (pdfFile, extra = {}, fixes = {}) => {
    const priv = path.join(tmp, 'priv' + (++seq));
    fs.mkdirSync(priv);
    for (const [id, fix] of Object.entries(fixes)) fs.writeFileSync(path.join(priv, 'fix-' + id + '.json'), typeof fix === 'string' ? fix : JSON.stringify(fix));
    const d = path.join(dest, 'b' + seq);
    const r = M.buildSheets(Object.assign({ pdf: pdfFile, dest: d, private: priv, content: contentFile, playbooks: ['dovetail'], python: PY }, extra));
    return { r, priv, d };
  };
  const ls = (d) => (fs.existsSync(d) ? fs.readdirSync(d).sort() : []);
  try {
    const ok = pdf('ok');
    await test('gm-sheets: an invented PDF is mapped: every count passes, the svg (text as paths) and the map land in the dest, the proof lands in the private folder, nothing else is written', () => {
      const before = ls(M.SHEETS_DIR).join();
      const { r, priv, d } = run(ok);
      assert.deepEqual(r.errors, [], r.errors.join('; '));
      assert.equal(r.sheets.length, 1); assert.equal(r.table.length, 1); assert.equal(r.table[0].ok, true); assert.deepEqual(r.table[0].checks.filter((c) => !c.ok), []);
      assert.deepEqual(ls(d), ['dovetail.map.json', 'dovetail.svg']);
      const svg = fs.readFileSync(path.join(d, 'dovetail.svg'), 'utf8');
      assert.match(svg, /^<svg[^>]*viewBox="0 0 841\.9 595\.3"/); assert.ok(!/<text[ >]/.test(svg), 'the text is paths');
      const map = JSON.parse(fs.readFileSync(path.join(d, 'dovetail.map.json'), 'utf8'));
      assert.equal(map.v, 1); assert.equal(map.playbook, 'dovetail'); assert.equal(map.page, 1); assert.deepEqual(map.size, [841.89, 595.28]);
      assert.equal(map.stress.length, 9); assert.equal(map.xp.length, 8); assert.equal(map.xpi.length, 6); assert.equal(Object.keys(map.acts).length, 12);
      assert.ok(Object.values(map.acts).every((a) => a.d.length === 4)); assert.equal(map.ab.length, 4); assert.equal(map.stacks.length, 4); assert.equal(map.harm.length, 6);
      assert.equal(map.keys.length, 4); assert.ok(map.keys.every((k) => k.hits.length === 3)); assert.equal(map.friends.length, 2); assert.ok(map.heal);
      assert.deepEqual(map.items.map((i) => [i.s.length, i.i]), [[1, 0], [1, 1], [1, 0], [2, 0]], 'item squares are the load; the italic line takes none');
      assert.equal(map.kinds.stress, 'box'); assert.equal(map.kinds.stacks, 'diamond');
      assert.ok(map.stress.every((b) => b.length === 4), 'rectangles are [x0, y0, x1, y1]');
      assert.deepEqual(ls(priv), ['proofs'], 'the private folder holds only the proofs: the work folder is gone');
      const png = fs.readFileSync(path.join(priv, 'proofs', 'proof-dovetail.png'));
      assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], 'the proof is a png'); assert.ok(png.length > 5000);
      assert.equal(ls(M.SHEETS_DIR).join(), before, 'nothing else appeared in app/media/sheets');
      assert.equal(spawnSync('git', ['check-ignore', '-q', path.join(d, 'dovetail.svg')], { cwd: ROOT }).status, 0, 'git ignores what the step wrote');
    });
    await test('gm-sheets: a dry run reads and checks and draws the proof, but writes nothing into the app', () => {
      const { r, priv, d } = run(ok, { dry: true });
      assert.deepEqual(r.errors, []); assert.equal(r.sheets.length, 0); assert.equal(r.table[0].ok, true);
      assert.deepEqual(ls(d), []); assert.ok(fs.existsSync(path.join(priv, 'proofs', 'proof-dovetail.png')));
    });
    await test('gm-sheets: a page whose counts are wrong is REFUSED (nothing written for it, the error says which count), though its proof is still drawn for a person to look at', () => {
      const { r, priv, d } = run(pdf('short', '--stress', '8'));
      assert.equal(r.errors.length, 1); assert.match(r.errors[0], /dovetail \(page 1\) REFUSED: stress 8\/9/); assert.match(r.errors[0], /fix-dovetail\.json/);
      assert.equal(r.sheets.length, 0); assert.deepEqual(ls(d), [], 'no svg and no map for a refused page');
      assert.deepEqual(r.table[0].failed, ['stress']); assert.ok(fs.existsSync(path.join(priv, 'proofs', 'proof-dovetail.png')));
      const none = run(pdf('nofriends', '--no-friends'));
      assert.match(none.r.errors[0], /friends 0\/2/); assert.deepEqual(ls(none.d), []);
    });
    await test('gm-sheets: a fix file covers a failed count: a waiver with a reason writes the page and prints a FLAG; a replaced region makes it pass and says FIXED; a short reason or bad JSON is an error', () => {
      const short = pdf('short2', '--stress', '8');
      const w = run(short, {}, { dovetail: { waive: { stress: 'the printed track has 8 boxes' } } });
      assert.deepEqual(w.r.errors, []); assert.equal(w.r.sheets.length, 1); assert.ok(w.r.warnings.some((x) => /^FLAG dovetail \(page 1\) stress: the printed track has 8 boxes/.test(x)));
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(w.d, 'dovetail.map.json'), 'utf8')).waived, ['stress']);
      assert.match(M.formatTable(w.r.table), /01 dovetail\s+FLAG \(stress\)/);
      const f = run(short, {}, { dovetail: { regions: { stress: rects(9) } } });
      assert.deepEqual(f.r.errors, []); assert.deepEqual(f.r.sheets[0].fixed, ['stress']);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.d, 'dovetail.map.json'), 'utf8')).stress, rects(9), 'the fix is the page\'s truth for that region');
      assert.match(M.formatTable(f.r.table), /FIXED \(stress\)/);
      assert.match(run(short, {}, { dovetail: { waive: { stress: 'no' } } }).r.errors[0], /dovetail: fix file: waive "stress" needs a reason/);
      assert.match(run(short, {}, { dovetail: '{ not json' }).r.errors[0], /dovetail: fix file is not JSON/);
      assert.equal(run(short, {}, { dovetail: { waive: { items: 'covers items only, not the stress count' } } }).r.sheets.length, 0, 'a waiver for another region does not cover this one');
    });
    await test('gm-sheets: it refuses a PDF or a private folder inside the repository, a missing PDF, no --pdf, and a PDF of the wrong length', () => {
      assert.match(M.buildSheets({ dest, pdf: path.join(ROOT, 'package.json') }).errors[0], /keep it outside the repository/);
      const inRepo = path.join(M.SHEETS_DIR, '_gm-sheets-test-' + process.pid + '-priv');
      assert.match(M.buildSheets({ dest, pdf: ok, private: inRepo, python: PY }).errors[0], /private folder must be outside the repository/);
      assert.ok(!fs.existsSync(inRepo), 'and nothing was made there');
      assert.match(M.buildSheets({ dest, pdf: path.join(tmp, 'nope.pdf') }).errors[0], /no such file/);
      assert.match(M.buildSheets({ dest }).errors[0], /need --pdf/);
      assert.match(run(ok, { playbooks: ['a', 'b'] }).r.errors[0], /expected a 2-page PDF, found 1 pages/);
      assert.match(run(ok, { pages: [3], playbooks: ['dovetail'] }).r.errors[0], /page 3 is not one of the 1 playbook pages/);
    });
    await test('gm-sheets: run as a command it prints the count table and exits 0; it exits 1 on a refused page, on a wrong-length PDF and on a dest outside the folder', () => {
      const args = (pdfFile, d, priv, ...more) => [FILE, '--pdf', pdfFile, '--out', d, '--private', path.join(tmp, priv), '--python', PY, '--content', contentFile, '--playbooks', 'dovetail', ...more];
      const good = spawnSync(process.execPath, args(ok, path.join(dest, 'cli'), 'privcli'), { cwd: ROOT, encoding: 'utf8' });
      assert.equal(good.status, 0, good.stdout + good.stderr);
      assert.match(good.stdout, /^01 dovetail\s+OK\n\s+stress 9\/9, xp 8\/8, /m); assert.match(good.stdout, /sheets: 1 page\(s\) written, 0 error\(s\), 0 warning\(s\)/);
      assert.deepEqual(ls(path.join(dest, 'cli')), ['dovetail.map.json', 'dovetail.svg']);
      const bad = spawnSync(process.execPath, args(pdf('short3', '--stress', '8'), path.join(dest, 'cli2'), 'privcli2'), { cwd: ROOT, encoding: 'utf8' });
      assert.equal(bad.status, 1); assert.match(bad.stdout, /^01 dovetail\s+REFUSED\n\s+stress 8\/9\*, /m); assert.match(bad.stdout, /sheets: 0 page\(s\) written, 1 error\(s\)/);
      assert.deepEqual(ls(path.join(dest, 'cli2')), [], 'nothing written for the refused page');
      const dry = spawnSync(process.execPath, args(ok, path.join(dest, 'cli3'), 'privcli3', '--dry'), { cwd: ROOT, encoding: 'utf8' });
      assert.equal(dry.status, 0); assert.match(dry.stdout, /dry run: nothing written to the app/); assert.deepEqual(ls(path.join(dest, 'cli3')), []);
      const wrong = spawnSync(process.execPath, [FILE, '--pdf', ok, '--out', dest, '--private', path.join(tmp, 'privcli4'), '--python', PY], { cwd: ROOT, encoding: 'utf8' });
      assert.equal(wrong.status, 1); assert.match(wrong.stdout, /expected a 12-page PDF, found 1 pages/, 'the real twelve-page order against a one-page PDF');
      const away = spawnSync(process.execPath, [FILE, '--pdf', ok, '--out', path.join(ROOT, 'app', 'sheet')], { cwd: ROOT, encoding: 'utf8' });
      assert.equal(away.status, 1); assert.match(away.stderr, /only inside app\/media\/sheets/);
    });
  } finally {
    for (const d of madeDirs.slice().reverse()) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (_) { /* leave it */ } }
    for (const d of [M.SHEETS_DIR, path.dirname(M.SHEETS_DIR)]) { try { fs.rmdirSync(d); } catch (_) { /* not empty: not ours to remove */ } }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('\n' + passed + ' passed, ' + failed + ' failed, ' + skipped + ' skipped');
process.exit(failed ? 1 : 0);
