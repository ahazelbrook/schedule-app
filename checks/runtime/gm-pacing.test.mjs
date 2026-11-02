// Tests for the pacing post-mortem (A5) and the distinctness linter (3.9), on local fixtures only: no vault of record, no network, no model.
//   node checks/runtime/gm-pacing.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
const { pacing, render } = await imp('scripts/lib/pacing.mjs');
const { file, main } = await imp('scripts/gm-pacing.mjs');
const { overlap, sameLook, lint } = await imp('scripts/lib/cast-distinct.mjs');

let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const M = 60000, T0 = 1700000000000;
const night = {
  v: 1, phase: 'score',
  phases: { pb: { budget: 20, start: T0, end: T0 + 25 * M }, plan: { budget: 15, start: T0 + 25 * M, end: T0 + 38 * M },
    score: { budget: 60, start: T0 + 38 * M, end: null }, after: { budget: null, start: null, end: null } },
  log: {
    a: { at: T0 + 40 * M, k: 'stamp', text: 'Room: Foyer (8m)' },
    b: { at: T0 + 50 * M, k: 'cue', text: 'band strikes up' },
    c: { at: T0 + 52 * M, k: 'cue', text: 'Room: Cellar' },
    d: { at: T0 + 70 * M, k: 'cue', text: 'lights out' }
  }
};

await test('phases: actual against planned', () => {
  const r = pacing(night, T0 + 100 * M);
  const by = Object.fromEntries(r.phases.map((p) => [p.id, p]));
  assert.deepEqual([by.pb.planned, by.pb.actual, by.pb.delta], [20, 25, 5]);
  assert.deepEqual([by.plan.actual, by.plan.delta], [13, -2]);
  assert.deepEqual([by.score.actual, by.score.delta, by.score.cues], [62, 2, 3]);
  assert.equal(by.after.actual, null);
});
await test('rooms run to the next room or the end', () => {
  const r = pacing({ night }, T0 + 100 * M);
  assert.deepEqual(r.rooms.map((x) => [x.room, x.planned, x.actual, x.delta]), [['Foyer', 8, 12, 4], ['Cellar', null, 48, null]]);
});
await test('empty night gives a table of dashes, no throw', () => {
  const txt = render(pacing(null)).join('\n');
  assert.match(txt, /Personal Business \| - \| - \| - \| 0/);
});
await test('file(): adds the heading once, leaves it alone, --force replaces', () => {
  const block = render(pacing(night, T0 + 100 * M));
  const note = '---\ndate: 01/01/2000\n---\n# Session\n\n## Names\n\n- a\n';
  const once = file(note, block, false);
  assert.match(once, /## Pacing post-mortem\n\n[\s\S]*\^b68-pacing/);
  assert.equal(file(once, block, false), null);
  const again = file(once, block, true);
  assert.equal((again.match(/## Pacing post-mortem/g) || []).length, 1);
  assert.equal((again.match(/\^b68-pacing/g) || []).length, 1);
  assert.ok(again.includes('## Names') && again.includes('- a'));
});
await test('CLI: dry run writes nothing; --yes files into the highest session note of a temp vault', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pace-'));
  const sess = path.join(dir, 'Wiki/Games/Blades in the Dark/Campaigns/Group/Sessions');
  fs.mkdirSync(sess, { recursive: true });
  const note = path.join(sess, 'b68g-s99.md');
  fs.writeFileSync(note, '# S2\n\n## Names\n\n-\n');
  const nf = path.join(dir, 'night.json');
  fs.writeFileSync(nf, JSON.stringify(night));
  const log = console.log; console.log = () => {};
  try {
    assert.equal(main(['--night', nf, '--end', String(T0 + 100 * M)]), 0);
    assert.ok(!fs.readFileSync(note, 'utf8').includes('Pacing'));
    assert.equal(main(['--night', nf, '--end', String(T0 + 100 * M), '--yes', '--vault', dir]), 0);
  } finally { console.log = log; }
  assert.match(fs.readFileSync(note, 'utf8'), /## Pacing post-mortem/);
  fs.rmSync(dir, { recursive: true, force: true });
});
await test('linter: overlap, sameLook', () => {
  const a = new Uint8Array(64 * 64).fill(1), b = new Uint8Array(64 * 64);
  assert.equal(overlap(a, a), 1);
  assert.equal(overlap(a, b), 0);
  const x = { outfit: { outer: { color: 'red' } }, hair: { hat: { type: 'cap', color: 'ink' } } };
  assert.ok(sameLook(x, JSON.parse(JSON.stringify(x))));
  assert.ok(!sameLook(x, { outfit: { outer: { color: 'blue' } }, hair: { hat: { type: 'cap', color: 'ink' } } }));
  assert.ok(!sameLook({ outfit: { outer: { color: 'red' } } }, { outfit: { outer: { color: 'red' } } }));
});
await test('linter: identical invented specs warn, warnings only', async () => {
  const sq = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="100"><rect width="40" height="100" fill="#000"/></svg>';
  const bar = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><rect width="100" height="40" fill="#000"/></svg>';
  const specs = [{ id: 'one' }, { id: 'two' }, { id: 'three' }];
  const svgs = { one: sq, two: sq, three: bar };
  const r = await lint(specs, (s) => ({ svg: svgs[s.id] }));
  if (r.skipped) return;
  assert.equal(r.warnings.length, 1);
  assert.match(r.warnings[0], /one and two/);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
