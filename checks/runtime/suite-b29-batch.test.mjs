// Suite B29, A3 (switch ai.batch): the local recording state, the lamp words and the after-the-night pipeline against a FIXTURE answer and a stubbed
// transcriber. No network, no key, no live transcription: the pipeline has no network code and the test fails if it grows any.
//   node checks/runtime/suite-b29-batch.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { runBatch, utterances, formatNote, clock } from '../../scripts/lib/batch-stt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const req = createRequire(import.meta.url);
const Rec = req(path.join(ROOT, 'app', 'gm', 'batch-record.js'));
const F = req(path.join(ROOT, 'app', 'features.js'));
const FIX = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'batch-answer.json');
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

await test('the switch is registered, GM-only, default off', () => {
  const s = F.get('ai.batch'); assert.ok(s); assert.equal(s.default, false); assert.equal(s.surface, 'gm');
  assert.equal(F.valueOf({}, 'ai.batch'), false); assert.ok(!F.publicIds().includes('ai.batch'));
  assert.ok(F.valueOf({ features: { 'ai.batch': true } }, 'ai.batch'));
});
function rig(on = true) {
  const calls = { start: 0, stop: 0, saved: [] };
  const recorder = { start() { calls.start++; }, stop() { calls.stop++; return Promise.resolve({ size: 42 }); } };
  const sink = { save(n, b) { calls.saved.push([n, b.size]); return Promise.resolve(); } };
  return { calls, ctl: Rec.create({ recorder, sink, enabled: () => on, now: () => Date.UTC(2026, 10, 7, 9, 5) }) };
}
await test('switch off: start does nothing; on: start, lamp, stop saves through the sink only', async () => {
  const off = rig(false); assert.equal(off.ctl.start(), false); assert.equal(off.calls.start, 0); assert.equal(Rec.suffix(off.ctl.state()), '');
  const r = rig(); assert.equal(r.ctl.start(), true); assert.equal(r.ctl.start(), false, 'one at a time');
  assert.match(Rec.suffix(r.ctl.state()), /REC \(local\)/); assert.match(Rec.chip(r.ctl.state()), /REC \(local\)/);
  const got = await r.ctl.stop(); assert.deepEqual(got, { name: 'night-20261107-0905.webm', bytes: 42 });
  assert.deepEqual(r.calls.saved, [['night-20261107-0905.webm', 42]]); assert.equal(Rec.suffix(r.ctl.state()), '');
});
await test('an async start that fails leaves it idle with the error; a failing sink leaves it idle too', async () => {
  const c = Rec.create({ recorder: { start: () => Promise.reject(new Error('denied')), stop() {} }, sink: {}, enabled: () => true, now: () => 0 });
  assert.equal(await c.start(), false); assert.equal(c.state().recording, false); assert.match(c.state().error, /denied/);
  const d = Rec.create({ recorder: { start() {}, stop: () => Promise.resolve({ size: 1 }) }, sink: { save: () => Promise.reject(new Error('disk')) }, enabled: () => true, now: () => 0 });
  d.start(); assert.equal(await d.stop(), null); assert.match(d.state().error, /disk/); assert.equal(d.state().recording, false);
});
await test('the recording module and the pipeline hold no network code', () => {
  for (const f of ['app/gm/batch-record.js', 'scripts/lib/batch-stt.mjs', 'scripts/gm-batch-stt.mjs']) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, '');
    assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|node:https?|deepgram|api[_-]?key|process\.env/i.test(t), f);
  }
});
await test('utterances: adjacent same-speaker lines join, junk is skipped, a bad speaker is S?', () => {
  const u = utterances(JSON.parse(fs.readFileSync(FIX, 'utf8')));
  assert.equal(u.length, 3); assert.equal(u[0].text, 'We go in through the kitchen. Rook takes the lamp.');
  assert.deepEqual(utterances({}), []); assert.deepEqual(utterances({ results: { utterances: [null, { transcript: '  ' }, { speaker: 'x', transcript: 'hi', start: 'n' }] } }), [{ speaker: -1, start: 0, text: 'hi' }]);
  assert.equal(clock(3725), '1:02:05'); assert.equal(clock(7), '00:07');
});
await test('runBatch: a stubbed transcriber makes a speaker-labelled note in the output folder; names apply; the transcriber is required', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b29-')), rec = path.join(dir, 'night-20261107-0905.webm'); fs.writeFileSync(rec, 'x');
  let asked = ''; const r = await runBatch({ file: rec, transcriber: async (f) => { asked = f; return JSON.parse(fs.readFileSync(FIX, 'utf8')); }, outDir: path.join(dir, 'batch'), names: { 0: 'Rook' } });
  assert.equal(asked, rec); assert.equal(r.lines, 3); assert.equal(r.speakers, 3);
  const note = fs.readFileSync(r.out, 'utf8');
  assert.match(note, /source: batch/); assert.match(note, /- \*\*\[00:01\] Rook:\*\* We go in through the kitchen\./); assert.match(note, /- \*\*\[00:07\] S1:\*\*/); assert.match(note, /\[1:02:05\] S2/);
  assert.equal(path.basename(r.out), 'night-20261107-0905.transcript.md');
  await assert.rejects(() => runBatch({ file: rec, outDir: dir }), /transcriber is required/);
  await assert.rejects(() => runBatch({ file: path.join(dir, 'none.webm'), transcriber: async () => ({}), outDir: dir }), /No recording/);
  await assert.rejects(() => runBatch({ file: rec, transcriber: async () => ({}), outDir: dir }), /no speech/);
  fs.rmSync(dir, { recursive: true, force: true });
});
await test('the files are registered for the GM bundle only', () => {
  const t = fs.readFileSync(path.join(ROOT, 'app', 'routes.js'), 'utf8'), gm = /gm: \[([^\]]*)\]/.exec(t)[1], display = /display: \[([^\]]*)\]/.exec(t)[1];
  for (const f of ['gm/batch-record.js', 'gm/b29.js']) { assert.ok(gm.includes("'" + f + "'"), f); assert.ok(!display.includes(f)); }
  assert.ok(gm.indexOf("'gm/batch-record.js'") < gm.indexOf("'gm/b29.js'") && gm.indexOf("'gm/b29.js'") < gm.indexOf("'gm-page.js'"));
});
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
