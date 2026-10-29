// Tests for the table iPad's transcriber (GM.md "Listening"): the iPad module's pure parts (app/stt.js), the server's
// validation, storage, roles and token (functions/_lib/stt.js and the three handlers), and the PC's copy into the vault
// (scripts/gm-transcript.mjs) on an in-memory D1 and an INVENTED vault in a temp folder. No network: Deepgram is faked.
//   node checks/runtime/stt.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { cleanLines, addLines, readLines, cleanSttPatch, patchStt, loadStt, loadSttPart, sttPartOf, grantToken, pruneLines } from '../../functions/_lib/stt.js';
import { onRequest as sttApi } from '../../functions/api/gm/stt.js';
import { onRequest as tokenApi } from '../../functions/api/gm/stt-token.js';
import { onRequest as transcriptApi } from '../../functions/api/gm/transcript.js';
import { matchApi, PAGE_HEADERS } from '../../worker/app.js';
import { pass, lineOf, newNote, withSpeakers, parseArgs, probe, watchStep, takeLock, launcherText, heardKeys } from '../../scripts/gm-transcript.mjs';
import { assertWritable } from '../../scripts/lib/vault.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ST = createRequire(import.meta.url)(path.join(ROOT, 'app', 'stt.js'));
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const newDb = async () => asD1(await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') }));
const L = (id, text, extra = {}) => ({ id, at: '2030-01-01T09:00:00.000Z', session: '9', conn: 'c1', speaker: 0, text, ...extra });

/* ---------- the iPad module ---------- */
await test('iPad: 48 kHz float -> 16 kHz 16-bit PCM; words -> runs by speaker; same speaker within 4 s merges, a gap or a new speaker splits', async () => {
  const f = new Float32Array(4800).fill(0.5), pcm = ST.downsample(f, 48000, 16000);
  assert.equal(pcm.length, 1600); assert.ok(Math.abs(pcm[10] - 16383) <= 1);
  assert.equal(ST.downsample(new Float32Array([2, -2, 2]), 16000, 16000)[1], -32768, 'clipped');
  const runs = ST.runsOf([{ word: 'a', punctuated_word: 'A', speaker: 0, start: 0, end: 0.4 }, { word: 'b', speaker: 0, start: 0.5, end: 0.9 }, { word: 'c', speaker: 1, start: 1, end: 1.2 }]);
  assert.deepEqual(runs.map((r) => [r.speaker, r.text]), [[0, 'A b'], [1, 'c']]);
  assert.deepEqual(ST.runsOf([], 'no words'), [{ speaker: null, text: 'no words', start: 0, end: 0 }]);
  let t = 0; const out = [], m = ST.makeMerger((l) => out.push(l), () => t);
  m.add({ speaker: 0, text: 'one', start: 0, end: 1 }, 'c1', 1); m.add({ speaker: 0, text: 'two', start: 3, end: 4 }, 'c1', 3);
  m.add({ speaker: 0, text: 'three', start: 9, end: 10 }, 'c1', 9);           // a 5 s gap
  m.add({ speaker: 1, text: 'four', start: 10.5, end: 11 }, 'c1', 10);        // another speaker
  t = 5000; m.tick();                                                          // quiet for 4 s: closes
  assert.deepEqual(out.map((l) => [l.speaker, l.text]), [[0, 'one two'], [0, 'three'], [1, 'four']]);
  m.add({ speaker: 1, text: 'x', start: 0, end: 1 }, 'c2', 0); m.add({ speaker: 1, text: 'y', start: 1, end: 2 }, 'c3', 1);
  m.flush(); assert.deepEqual(out.slice(3).map((l) => l.text), ['x', 'y'], 'a new connection never merges');
  assert.ok(/^l[0-9a-z]+$/.test(ST.lineId()) && ST.lineId() !== ST.lineId());
  assert.ok(/encoding=linear16/.test(ST.DG_URL) && /sample_rate=16000/.test(ST.DG_URL) && /diarize=true/.test(ST.DG_URL) && /model=nova-3/.test(ST.DG_URL));
  assert.deepEqual(ST.SCHEMES, ['bearer', 'token']);
});

/* ---------- the cue in the merger (C4b): the real app/cue.js, a fake clock, fake runs ---------- */
const CUE = createRequire(import.meta.url)(path.join(ROOT, 'app', 'cue.js'));
const STEP = 0.4;
/* a run of one speaker: one word every 0.4 s from `start` s; `at` is the wall time (ms) of the run's first word */
function runOf(speaker, text, start, at) {
  const words = text.split(' ').map((w, i) => ({ t: w, start: start + i * STEP, end: start + i * STEP + 0.3 }));
  return { run: { speaker, text, start, end: words[words.length - 1].end, words }, at: at === undefined ? start * 1000 : at };
}
function rig(cue = CUE) {
  let t = 0; const out = [];
  const m = ST.makeMerger((l) => out.push(Object.assign({ when: t }, l)), () => t, cue);
  return { m, out, at: (ms) => { t = ms; }, tick: (ms) => { t = ms; m.tick(); },
    add(speaker, text, start, ms, conn = 'c1', atWall) { if (ms !== undefined) t = ms; const r = runOf(speaker, text, start, atWall); m.add(r.run, conn, r.at); } };
}
await test('cue merger: a split mid-run. The words before close the open line, the cue starts a new one, each keeps its own times; the cue goes after a 1 s tail', () => {
  const r = rig(); r.add(0, 'Right so that is the plan. Blade, make a six clock called Escape', 10, 100);
  assert.equal(r.out.length, 1, 'the words before the cue closed at once');
  assert.deepEqual([r.out[0].text, r.out[0].speaker, r.out[0].at, r.out[0].conn], ['Right so that is the plan.', 0, 10000, 'c1']);
  assert.ok(!('cue' in r.out[0]) && !('urgent' in r.out[0]), 'an ordinary line: exactly as before');
  assert.equal(r.m.open().cue, true, 'the cue is the open line');
  r.tick(1100); assert.equal(r.out.length, 1, 'exactly 1 s after its last run it is still open');
  r.tick(1101);
  assert.equal(r.out.length, 2); const c = r.out[1];
  assert.deepEqual([c.text, c.cue, c.urgent, c.when], ['Blade, make a six clock called Escape', true, true, 1101], 'emitted as soon as the tail passes, not after 4 s');
  assert.equal(c.at, 10000 + 6 * STEP * 1000, 'the cue keeps ITS time: the 7th word started 2.4 s into the run');
  assert.equal(r.m.open(), null);
});
await test('cue merger: a cue at the start of the line (no words before) makes no empty part; "Blade" followed by punctuation and numbers as smart_format writes them', () => {
  const r = rig(); r.add(2, 'Blade, make a 6 clock called Escape', 3, 0);
  assert.equal(r.out.length, 0); r.tick(1001);
  assert.deepEqual(r.out.map((l) => [l.text, l.cue, l.speaker]), [['Blade, make a 6 clock called Escape', true, 2]]);
  /* through runsOf from Deepgram's words: punctuated_word is what the text holds, so the offsets line up with the words */
  const dg = [['okay', 'Okay.'], ['blade', 'Blade,'], ['make', 'make'], ['a', 'a'], ['6', '6'], ['clock', 'clock.']].map(([word, pw], i) => ({ word, punctuated_word: pw, speaker: 0, start: 20 + i, end: 20.5 + i }));
  const runs = ST.runsOf(dg); assert.equal(runs.length, 1); assert.equal(runs[0].words.length, 6);
  const q = rig(); q.m.add(runs[0], 'c1', 777000); assert.equal(q.out.length, 1);
  assert.deepEqual([q.out[0].text, q.out[0].at], ['Okay.', 777000]);
  q.tick(1001); assert.deepEqual([q.out[1].text, q.out[1].cue, q.out[1].at], ['Blade, make a 6 clock.', true, 778000], 'Blade starts at word 2 (1 s into the run)');
  /* a filler before the wake word is part of the words before it */
  const f = rig(); f.add(0, 'Hey Blade, tick Escape', 0, 0); assert.deepEqual(f.out.map((l) => l.text), ['Hey']); f.tick(1001); assert.equal(f.out[1].text, 'Blade, tick Escape');
});
await test('cue merger: a bare "Blade," arms for 2 s; the command under ANOTHER speaker label joins it, and the whole is cued', () => {
  const r = rig(); r.add(0, 'Blade,', 5, 0);
  assert.equal(r.out.length, 0); assert.equal(r.m.open().armed, true, 'armed: a wake word with nothing after it');
  r.add(3, 'make a six clock called Escape', 6.5, 1900);               // starts 1.2 s of audio after the wake word, another label
  assert.equal(r.out.length, 0, 'joined, not emitted'); assert.deepEqual([r.m.open().text, r.m.open().speaker, r.m.open().cue], ['Blade, make a six clock called Escape', 0, true]);
  r.tick(2900); assert.equal(r.out.length, 0); r.tick(2901);
  assert.deepEqual(r.out.map((l) => [l.text, l.cue, l.speaker, l.when]), [['Blade, make a six clock called Escape', true, 0, 2901]]);
  /* a long command: the final lands 2.6 s of wall time later (it took 2.4 s to say), still joined because the arm counts AUDIO */
  const lg = rig(); lg.add(0, 'Blade,', 5, 0); lg.add(2, 'make a six clock called Escape', 5.9, 2600);
  assert.equal(lg.out.length, 0); assert.deepEqual([lg.m.open().text, lg.m.open().cue], ['Blade, make a six clock called Escape', true]); lg.tick(3601); assert.deepEqual(lg.out.map((l) => [l.text, l.cue]), [['Blade, make a six clock called Escape', true]]);
  /* too late: 2.2 s of audio after the bare wake word it is an ordinary line and the next one starts a new line */
  const s = rig(); s.add(0, 'Blade,', 5, 0); s.add(1, 'make a six clock called Escape', 7.5, 600);
  assert.deepEqual(s.out.map((l) => [l.text, 'cue' in l]), [['Blade,', false]], 'the lapsed arm (2.2 s of audio) closed as an ordinary line');
  /* a bare wake word that the next words do not turn into a cue stays an ordinary line */
  const n = rig(); n.add(0, 'Blade,', 0, 0); n.add(1, 'hello there my friend', 1, 500); assert.equal(n.m.open().armed, false); assert.equal(n.m.open().cue, false);
  n.tick(5000); assert.deepEqual(n.out.map((l) => [l.text, 'cue' in l]), [['Blade, hello there my friend', false]]);
  /* a mishearing never arms */
  const mis = rig(); mis.add(0, 'Blaine,', 0, 0); assert.equal(mis.m.open().armed, false);
});
await test('cue merger: a command split mid-way. "Blade, make a six" then "clock called escape" under another label join and go at once; the next line goes at once too', () => {
  const r = rig(); r.add(0, 'Blade, make a six', 40, 0);
  assert.equal(r.out.length, 0); assert.equal(r.m.open().cue, true, 'a cue as far as it goes');
  r.add(1, 'clock called escape', 41.8, 600);
  assert.equal(r.out.length, 1, 'joined within 1 s and closed at once'); assert.deepEqual([r.out[0].text, r.out[0].cue, r.out[0].speaker, r.out[0].when], ['Blade, make a six clock called escape', true, 0, 600]);
  r.add(1, 'and mark two', 43, 700);
  assert.equal(r.out.length, 2, 'the line straight after a cued line is emitted at once'); assert.deepEqual([r.out[1].text, r.out[1].urgent, 'cue' in r.out[1], r.out[1].when], ['and mark two', true, false, 700]);
  r.add(1, 'more chat here', 44, 800); assert.equal(r.out.length, 2, 'only the ONE line after the cue; the next waits as before');
  r.tick(5000); assert.equal(r.out.length, 3); assert.ok(!('urgent' in r.out[2]));
  /* the tail is 1 s: a run 1.2 s after the cue line's last is a new line (and is urgent), the cue line has been emitted by the tick */
  const q = rig(); q.add(0, 'Blade, make a six', 0, 0); q.tick(1100); q.tick(1300); assert.equal(q.out.length, 1);
  q.add(1, 'clock called escape', 3, 1300); assert.deepEqual(q.out.map((l) => [l.text, l.cue === true, l.urgent === true]), [['Blade, make a six', true, true], ['clock called escape', false, true]]);
  /* a different connection never joins, even inside the tail */
  const c = rig(); c.add(0, 'Blade, make a six', 0, 0); c.add(0, 'clock called escape', 1, 300, 'c2'); assert.deepEqual(c.out.map((l) => [l.text, l.cue === true]), [['Blade, make a six', true], ['clock called escape', false]], 'the cue line went; the c2 run is its own line');
});
await test('cue merger: two cues in one run (and in a joined line) become two cued lines, each with its own time', () => {
  const r = rig(); r.add(0, 'Blade, tick Escape. Blade, tick Doom', 0, 0);
  assert.equal(r.out.length, 1, 'the first cue closed when the second began'); assert.deepEqual([r.out[0].text, r.out[0].cue, r.out[0].urgent, r.out[0].at], ['Blade, tick Escape.', true, true, 0]);
  assert.equal(r.m.open().text, 'Blade, tick Doom'); r.tick(1001);
  assert.deepEqual([r.out[1].text, r.out[1].cue, r.out[1].at], ['Blade, tick Doom', true, 3 * STEP * 1000]);
  /* a second cue that arrives as the continuation: joined, split, the first goes, the second waits its own tail */
  const j = rig(); j.add(0, 'Blade, tick Escape.', 0, 0); j.add(1, 'Blade, tick Doom', 1.5, 500);
  assert.deepEqual(j.out.map((l) => [l.text, l.cue]), [['Blade, tick Escape.', true]]); assert.equal(j.m.open().text, 'Blade, tick Doom'); assert.equal(j.m.open().cue, true);
  j.tick(1500); assert.equal(j.out.length, 1); j.tick(1501); assert.equal(j.out.length, 2, 'the second cue waited its own 1 s from its own run');
  /* a wake word inside a clause is not a second cue: "make a blade clock" */
  const k = rig(); k.add(0, 'Blade, make a blade clock called Escape', 0, 0); assert.equal(k.out.length, 0); k.tick(1001); assert.deepEqual(k.out.map((l) => l.text), ['Blade, make a blade clock called Escape']);
});
await test('cue merger: no cue = behaviour unchanged (same joins, same 4 s / 20 s closes, same line shape), with or without the finder', () => {
  for (const cue of [CUE, null]) {
    const r = rig(cue);
    r.add(0, 'the blade is sharp', 0, 0); r.add(0, 'and so is the other one', 2, 500); r.add(1, 'sure', 3, 600); r.add(1, 'yes', 9, 700);
    r.tick(5000);
    assert.deepEqual(r.out.map((l) => [l.speaker, l.text, Object.keys(l).filter((k) => k !== 'when').sort().join()]), [
      [0, 'the blade is sharp and so is the other one', 'at,conn,speaker,text'], [1, 'sure', 'at,conn,speaker,text'], [1, 'yes', 'at,conn,speaker,text']],
    'one line cut at the speaker change; "yes" is 5.7 s of audio later so it is a new line, closed at the tick');
  }
  /* a line open for 20 s closes even while speech keeps coming */
  const long = rig(); for (let i = 0; i < 6; i++) long.add(0, 'talking on and on', i * 4, i * 4000); long.tick(20000); assert.equal(long.out.length >= 1, true);
  assert.ok(!long.out.some((l) => l.cue || l.urgent));
});
await test('cue merger: a cue line takes a different label only while the command is unfinished or the run is short; MAX_LINE holds; empty runs are dropped', () => {
  const long = 'so then she said that we should really go and look at the other one now';
  const r = rig(); r.add(0, 'Blade, tick Escape', 0, 0); r.add(1, long, 2, 900);
  assert.deepEqual(r.out.map((l) => [l.text, l.cue === true]), [['Blade, tick Escape', true], [long, false]], 'a long sentence from another speaker is its own line (and goes at once, straight after a cue)');
  const s = rig(); s.add(0, 'Blade, tick Escape', 0, 0); s.add(1, 'and mark two', 2, 900);
  assert.deepEqual(s.out.map((l) => l.text), ['Blade, tick Escape and mark two'], 'a short run under another label still joins');
  const u = rig(); u.add(0, 'Blade, make a six', 0, 0); u.add(1, long, 2, 500);
  assert.deepEqual(u.out.map((l) => l.text), ['Blade, make a six ' + long], 'an unfinished command takes even a long continuation');
  const m = rig(); m.add(0, 'Blade, tick Escape', 0, 0); m.add(0, 'word '.repeat(150).trim(), 2, 500);
  assert.equal(m.out.length, 2, 'over MAX_LINE: not swallowed'); assert.equal(m.out[0].text, 'Blade, tick Escape'); assert.ok(m.out[0].cue); assert.ok(!m.out[1].cue);
  for (const bad of [{ speaker: 0, text: ' ', start: 0, end: 0 }, { speaker: 0, text: '', start: 0, end: 0, words: [] }]) { const e = rig(); e.m.add(bad, 'c1', 0); e.add(0, 'Blade, tick Escape', 1, 0); e.m.add(bad, 'c1', 0); e.tick(1001); assert.deepEqual(e.out.map((l) => l.text), ['Blade, tick Escape']); }
  const w = ST.runsOf([], ' '); const q = rig(); w.forEach((x) => q.m.add(x, 'c1', 0)); q.m.tick(); q.m.flush(); assert.equal(q.out.length, 0, 'a whitespace-only fallback transcript makes no line');
});
await test('cue merger: the DG URL carries keyterm=Blade', () => {
  assert.ok(/[?&]keyterm=Blade(&|$)/.test(ST.DG_URL), ST.DG_URL);
  assert.ok(/endpointing=300/.test(ST.DG_URL) && !/speech_final/.test(ST.DG_URL));
});

/* ---------- the server ---------- */
await test('server: a posted line carrying cue: true is accepted (no 400), and the field is NOT kept (cleanLines rebuilds from fixed fields)', async () => {
  const got = cleanLines({ lines: [L('q1', 'Blade, tick Escape', { cue: true })] });
  assert.equal(got.length, 1); assert.equal(got[0].text, 'Blade, tick Escape'); assert.ok(!('cue' in got[0]), 'dropped by the server today: C4d and MD1b cannot read it from stored lines');
});
await test('server: lines are validated, stored in order with their seq, a resend is skipped, read after / tail, pruned', async () => {
  const db = await newDb();
  for (const bad of [{}, { lines: 'x' }, { lines: new Array(51).fill(L('a', 'b')) }, { lines: [L('bad id!', 'x')] }, { lines: [L('a', '')] }, { lines: [L('a', 'x', { at: 'yesterday' })] },
    { lines: [L('a', 'x', { speaker: -1 })] }, { lines: [L('a', 'x', { kind: 'other' })] }, { lines: [L('a', 'x', { session: 'nine' })] }, { lines: [L('a', 'x'.repeat(2001))] }])
    assert.throws(() => cleanLines(bad), undefined, JSON.stringify(bad).slice(0, 60));
  assert.equal(cleanLines({ lines: [L('m1', '', { kind: 'mark', speaker: null })] })[0].kind, 'mark', 'a mark may be empty');
  const r1 = await addLines(db, 'default', cleanLines({ lines: [L('a1', 'first'), L('a2', '  second  line ', { speaker: null })] }));
  assert.deepEqual(r1, { added: 2, last: 2 });
  const r2 = await addLines(db, 'default', cleanLines({ lines: [L('a2', 'second line'), L('a3', 'third')] }));
  assert.equal(r2.last, 3, 'the resent a2 is skipped');
  const all = await readLines(db, 'default', { after: 0 });
  assert.deepEqual(all.lines.map((l) => [l.seq, l.id, l.text, l.speaker]), [[1, 'a1', 'first', 0], [2, 'a2', 'second line', null], [3, 'a3', 'third', 0]]);
  assert.deepEqual((await readLines(db, 'default', { after: 1 })).lines.map((l) => l.seq), [2, 3]);
  assert.deepEqual((await readLines(db, 'default', { tail: 2 })).lines.map((l) => l.seq), [2, 3]);
  assert.equal((await readLines(db, 'other', {})).lines.length, 0, 'per campaign');
  await pruneLines(db, 'default', 2); assert.deepEqual((await readLines(db, 'default', {})).lines.map((l) => l.seq), [3]);
  await addLines(db, 'default', cleanLines({ lines: [L('a4', 'fourth')] }));
  assert.equal((await readLines(db, 'default', {})).last, 4, 'seq keeps climbing after a prune');
});

await test('server: the control document: the GM sets want, session, speakers; the display only its status; null drops a name', async () => {
  const db = await newDb();
  assert.equal((await loadStt(db, 'default')).doc.want, 'off');
  await patchStt(db, 'default', cleanSttPatch({ want: 'on', session: '9', speakers: { 0: 'Alex (GM)', 1: 'Pip (Wen)' } }, 'gm'));
  await patchStt(db, 'default', cleanSttPatch({ speakers: { 1: null, 2: '  Odo *bold*  ' } }, 'gm'));
  await patchStt(db, 'default', cleanSttPatch({ status: { state: 'listening', lines: 4, error: '' } }, 'display'));
  const d = (await loadStt(db, 'default')).doc;
  assert.deepEqual([d.want, d.session, d.speakers, d.status.state, d.status.lines], ['on', '9', { 0: 'Alex (GM)', 2: 'Odo  bold' }, 'listening', 4]);
  assert.ok(Date.parse(d.status.at) > 0, 'the server stamps the report');
  for (const [p, role] of [[{ want: 'on' }, 'display'], [{ want: 'maybe' }, 'gm'], [{ session: 'x' }, 'gm'], [{ speakers: { 64: 'x' } }, 'gm'], [{ speakers: { 0: 'x'.repeat(61) } }, 'gm'], [{ status: { state: 'dancing' } }, 'display'], [{ other: 1 }, 'gm']])
    assert.throws(() => cleanSttPatch(p, role), undefined, JSON.stringify(p));
});

await test('server: a session change starts the names empty; the same session keeps them; names in the same PATCH survive; the display cannot set either', async () => {
  const db = await newDb(), names = async () => (await loadStt(db, 'default')).doc.speakers;
  await patchStt(db, 'default', cleanSttPatch({ want: 'on', session: '5', speakers: { 0: 'Speaker A', 3: 'Speaker B' } }, 'gm'));
  assert.deepEqual(await names(), { 0: 'Speaker A', 3: 'Speaker B' }, 'names sent with the first session stay');
  await patchStt(db, 'default', cleanSttPatch({ want: 'off', session: '5' }, 'gm'));
  await patchStt(db, 'default', cleanSttPatch({ want: 'on', session: '5' }, 'gm'));
  assert.deepEqual(await names(), { 0: 'Speaker A', 3: 'Speaker B' }, 'the same session keeps them');
  await patchStt(db, 'default', cleanSttPatch({ status: { state: 'listening', lines: 1 } }, 'display'));
  assert.deepEqual(await names(), { 0: 'Speaker A', 3: 'Speaker B' }, 'a status report keeps them');
  await patchStt(db, 'default', cleanSttPatch({ want: 'on', session: '6' }, 'gm'));
  assert.deepEqual(await names(), {}, 'a new session starts empty');
  assert.equal((await loadStt(db, 'default')).doc.session, '6');
  await patchStt(db, 'default', cleanSttPatch({ session: '7', speakers: { 1: 'Speaker C' } }, 'gm'));
  assert.deepEqual(await names(), { 1: 'Speaker C' }, 'names in the same PATCH as the change survive');
  await patchStt(db, 'default', cleanSttPatch({ speakers: { 1: null } }, 'gm'));
  assert.deepEqual(await names(), {}, 'null clears');
  assert.throws(() => cleanSttPatch({ session: '8' }, 'display'), (e) => e.status === 403);
  assert.throws(() => cleanSttPatch({ speakers: { 0: 'x' } }, 'display'), (e) => e.status === 403);
});

await test('server: the part the display GET carries is want and session only; its seq moves with those two and with nothing the iPad reports', async () => {
  const db = await newDb();
  const blank = await loadSttPart(db, 'default');
  assert.deepEqual(Object.keys(blank).sort(), ['seq', 'session', 'want']);
  assert.deepEqual([blank.want, blank.session, typeof blank.seq, Number.isInteger(blank.seq) && blank.seq >= 0], ['off', '', 'number', true], 'nothing stored: off, no session');
  assert.deepEqual(blank, sttPartOf(null), 'a missing document reads the same as a blank one');
  await patchStt(db, 'default', cleanSttPatch({ want: 'on', session: '9' }, 'gm'));
  const on = await loadSttPart(db, 'default');
  assert.deepEqual([on.want, on.session], ['on', '9']); assert.notEqual(on.seq, blank.seq, 'turning listening on moves it');
  /* everything else the document holds: the iPad's status (which rewrites updated_at every few seconds), the names, the PC's heartbeat */
  await patchStt(db, 'default', cleanSttPatch({ speakers: { 0: 'Alex (GM)' }, status: { state: 'listening', lines: 3, error: 'secret-ish words' } }, 'gm'));
  await patchStt(db, 'default', cleanSttPatch({ status: { state: 'reconnecting', lines: 4, error: '' } }, 'display'));
  await db.prepare("UPDATE gm_stt SET doc = json_set(doc, '$.copier', json(?2)) WHERE campaign = ?1").bind('default', JSON.stringify({ at: '2030-01-01T09:00:00.000Z', last: 7, host: 'LAPTOP' })).run();
  const later = await loadSttPart(db, 'default');
  assert.deepEqual(later, on, 'status reports, speaker names and the copier heartbeat do not move it');
  assert.ok(!/Alex|secret|LAPTOP|listening|reconnecting|copier|speakers/.test(JSON.stringify(later)), 'and none of them rides along');
  await patchStt(db, 'default', cleanSttPatch({ session: '9.1' }, 'gm'));
  const s2 = await loadSttPart(db, 'default');
  assert.deepEqual([s2.want, s2.session], ['on', '9.1']); assert.notEqual(s2.seq, on.seq, 'a new session moves it');
  await patchStt(db, 'default', cleanSttPatch({ want: 'off' }, 'gm'));
  const off = await loadSttPart(db, 'default');
  assert.deepEqual([off.want, off.session], ['off', '9.1']); assert.notEqual(off.seq, s2.seq);
  assert.equal(sttPartOf({ want: 'on', session: '9.1' }).seq, s2.seq, 'the seq is a function of the two values: the same values, the same seq');
  /* a document written by hand or an older build: anything but a clean value reads as the blank one */
  assert.deepEqual(sttPartOf({ want: 'yes', session: { x: 1 }, speakers: { 0: 'x' } }), blank);
  assert.deepEqual(sttPartOf({ want: 'on', session: 'nine' }), { seq: sttPartOf({ want: 'on', session: '' }).seq, want: 'on', session: '' });
  const seen = new Set(); for (const w of ['on', 'off']) for (const s of ['', '1', '2', '9', '9.1', '9.2', '10', '12.5']) seen.add(sttPartOf({ want: w, session: s }).seq);
  assert.equal(seen.size, 16, 'sixteen different states, sixteen different seqs');
});

await test('server: the control document: a write that lands between another write\'s read and save is never undone', async () => {
  const db = await newDb();
  await patchStt(db, 'default', cleanSttPatch({ want: 'off', session: '9' }, 'gm'));
  /* wrap the db so the first read of gm_stt runs `meanwhile` before it answers: another write lands mid-PATCH */
  const racing = (meanwhile) => {
    let done = false;
    return { prepare(sql) {
      const st = db.prepare(sql);
      if (done || !/^SELECT updated_at, doc FROM gm_stt/.test(sql)) return st;
      return { bind(...a) { const b = st.bind(...a); return { async first() { const r = await b.first(); done = true; await meanwhile(); return r; } }; } };
    } };
  };
  /* the iPad's status report reads, then the GM turns listening on before the report saves */
  await patchStt(racing(() => patchStt(db, 'default', cleanSttPatch({ want: 'on' }, 'gm'))), 'default', cleanSttPatch({ status: { state: 'listening', lines: 2 } }, 'display'));
  const d = (await loadStt(db, 'default')).doc;
  assert.deepEqual([d.want, d.status.state, d.status.lines], ['on', 'listening', 2], 'both writes kept');
  /* the PC's heartbeat sets copier in place (updated_at unmoved): a PATCH read before it does not wipe it */
  const beat = () => db.prepare("UPDATE gm_stt SET doc = json_set(doc, '$.copier', json(?2)) WHERE campaign = ?1").bind('default', JSON.stringify({ at: '2030-01-01T09:00:00.000Z', last: 7, host: 'LAPTOP' })).run();
  await patchStt(racing(beat), 'default', cleanSttPatch({ speakers: { 0: 'Alex (GM)' } }, 'gm'));
  const e = (await loadStt(db, 'default')).doc;
  assert.deepEqual([e.copier.host, e.copier.last, e.speakers[0], e.want], ['LAPTOP', 7, 'Alex (GM)', 'on']);
});

await test('server: the token: no secret is 503, Deepgram refusing is 502 (403 names the permission), else the token and nothing else', async () => {
  await assert.rejects(grantToken({}), (e) => e.status === 503);
  const calls = [];
  const fake = (status, body) => async (url, init) => { calls.push({ url, init }); return { ok: status === 200, status, json: async () => body }; };
  await assert.rejects(grantToken({ DEEPGRAM_API_KEY: 'k' }, fake(403, {})), (e) => e.status === 502 && /Member/.test(e.message));
  await assert.rejects(grantToken({ DEEPGRAM_API_KEY: 'k' }, async () => { throw new Error('dns'); }), (e) => e.status === 502);
  const ok = await grantToken({ DEEPGRAM_API_KEY: 'secret-key' }, fake(200, { access_token: 'jwt', expires_in: 30 }));
  assert.deepEqual(ok, { token: 'jwt', expiresIn: 30 });
  const c = calls[calls.length - 1];
  assert.equal(c.url, 'https://api.deepgram.com/v1/auth/grant'); assert.equal(c.init.method, 'POST'); assert.equal(c.init.headers.Authorization, 'Token secret-key');
  assert.ok(!JSON.stringify(ok).includes('secret-key'), 'the key is never in the answer');
  await grantToken({ DEEPGRAM_API_KEY: 'secret-key\r\n' }, fake(200, { access_token: 'jwt' }));
  assert.equal(calls[calls.length - 1].init.headers.Authorization, 'Token secret-key', 'a piped-in CRLF is trimmed');
  await assert.rejects(grantToken({ DEEPGRAM_API_KEY: ' \r\n' }), (e) => e.status === 503);
});

await test('server: roles: a player gets 403 on all three before anything; the display may post lines and its status but not read the transcript', async () => {
  const db = await newDb(), env = { DB: db, __fetch: async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'jwt', expires_in: 30 }) }), DEEPGRAM_API_KEY: 'k' };
  const req = (method, url, body) => new Request('http://x' + url, { method, body: body && method !== 'GET' ? JSON.stringify(body) : undefined, headers: { 'Content-Type': 'application/json' } });
  const call = (h, method, url, role, body) => Promise.resolve().then(() => h({ request: req(method, url, body), env, data: { me: { role } } })).then((r) => r.status, (e) => e.status);
  for (const [h, m, u] of [[sttApi, 'GET', '/api/gm/stt'], [tokenApi, 'POST', '/api/gm/stt/token'], [transcriptApi, 'POST', '/api/gm/transcript'], [transcriptApi, 'GET', '/api/gm/transcript?after=0']])
    assert.equal(await call(h, m, u, 'player', {}), 403, 'player ' + m + ' ' + u);
  assert.equal(await call(tokenApi, 'POST', '/api/gm/stt/token', 'display'), 200);
  assert.equal(await call(transcriptApi, 'POST', '/api/gm/transcript', 'display', { lines: [L('d1', 'from the iPad')] }), 200);
  assert.equal(await call(transcriptApi, 'GET', '/api/gm/transcript?after=0', 'display'), 403);
  assert.equal(await call(transcriptApi, 'GET', '/api/gm/transcript?tail=5', 'gm'), 200);
  assert.equal(await call(sttApi, 'PATCH', '/api/gm/stt', 'display', { status: { state: 'listening' } }), 200);
  assert.equal(await call(sttApi, 'PATCH', '/api/gm/stt', 'display', { want: 'off' }), 403);
  assert.deepEqual(['/api/gm/stt', '/api/gm/stt/token', '/api/gm/transcript'].map((p) => matchApi(p).functionPath), ['/api/gm/stt', '/api/gm/stt/token', '/api/gm/transcript']);
  assert.ok(/microphone=\(self\)/.test(PAGE_HEADERS['Permissions-Policy']) && /camera=\(\)/.test(PAGE_HEADERS['Permissions-Policy']), 'the page may use its own mic, nothing else');
});

/* ---------- the PC's copy into the vault ---------- */
const S = 'Wiki/Games/Blades in the Dark/Campaigns/Group/Sessions';
function makeVault() {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-stt-'));
  fs.mkdirSync(path.join(v, ...S.split('/')), { recursive: true });
  fs.writeFileSync(path.join(v, ...S.split('/'), 'b68g-s09.md'), '# Session 9\n');
  return v;
}
await test('vault: lines become a new transcript note (source: ipad, speakers), later passes only append what is new, names follow the GM page', async () => {
  const v = makeVault(), db = await newDb(), ledger = {};
  await patchStt(db, 'default', cleanSttPatch({ want: 'on', session: '9', speakers: { 0: 'Alex (GM)' } }, 'gm'));
  await addLines(db, 'default', cleanLines({ lines: [L('a', 'Nobody moves.'), L('b', 'Who knocks?', { speaker: 1 }), L('m', '', { kind: 'mark', speaker: null })] }));
  const dry = await pass({ vault: v, db, campaign: 'default', ledger, dryRun: true });
  assert.equal(dry.filed, 3); assert.ok(!fs.existsSync(path.join(v, ...S.split('/'), 'b68g-s09-transcript.md')), 'a dry run writes nothing');
  const r = await pass({ vault: v, db, campaign: 'default', ledger });
  assert.deepEqual([r.filed, r.notes], [3, ['b68g-s09-transcript.md']]);
  const file = path.join(v, ...S.split('/'), 'b68g-s09-transcript.md');
  let t = fs.readFileSync(file, 'utf8');
  assert.ok(/^source: ipad$/m.test(t) && /^  S0: "Alex \(GM\)"$/m.test(t) && /\[\[b68g-s09\]\]/.test(t) && /## Transcript\n/.test(t));
  assert.ok(/- \*\*\[\d\d:\d\d\] Alex \(GM\):\*\* Nobody moves\.\n- \*\*\[\d\d:\d\d\] S1:\*\* Who knocks\?\n\*\[\d\d:\d\d\] — reconnected\*\n$/.test(t), t.slice(-160));
  assert.equal((await pass({ vault: v, db, campaign: 'default', ledger })).filed, 0); assert.equal(fs.readFileSync(file, 'utf8'), t, 'nothing new: unchanged');
  await patchStt(db, 'default', cleanSttPatch({ speakers: { 1: 'Pip (Wen)' } }, 'gm'));
  await addLines(db, 'default', cleanLines({ lines: [L('c', 'Me.', { speaker: 1 })] }));
  await pass({ vault: v, db, campaign: 'default', ledger });
  t = fs.readFileSync(file, 'utf8');
  assert.ok(t.endsWith('- **[' + t.slice(-30).match(/\[(\d\d:\d\d)\]/)[1] + '] Pip (Wen):** Me.\n'), t.slice(-60));
  assert.ok(/^  S1: "Pip \(Wen\)"$/m.test(t), 'speakers rewritten in the frontmatter');
  assert.ok(t.includes('S1:** Who knocks?'), 'lines already copied keep the label they had');
  await pass({ vault: v, db, campaign: 'default', ledger, prune: true });
  assert.equal((await readLines(db, 'default', {})).lines.length, 0, '--prune clears what was filed');
  fs.rmSync(v, { recursive: true, force: true });
});

await test('vault: a transcript the Obsidian transcriber made is never written into; the iPad\'s lines go beside it; no session -> the highest note', async () => {
  const v = makeVault(), db = await newDb(), ledger = {};
  const mine = path.join(v, ...S.split('/'), 'b68g-s09-transcript.md');
  fs.writeFileSync(mine, '---\nstatus: recording\nspeakers: {}\n---\n\n## Transcript\n\n- **[19:00] S0:** from the laptop\n');
  const before = fs.readFileSync(mine, 'utf8');
  await addLines(db, 'default', cleanLines({ lines: [L('a', 'from the iPad', { session: '' })] }));
  const r = await pass({ vault: v, db, campaign: 'default', ledger });
  assert.deepEqual(r.notes, ['b68g-s09-transcript-ipad.md'], 'session 9 from the highest note, beside the laptop\'s');
  assert.equal(fs.readFileSync(mine, 'utf8'), before);
  assert.ok(/from the iPad/.test(fs.readFileSync(path.join(v, ...S.split('/'), 'b68g-s09-transcript-ipad.md'), 'utf8')));
  assert.equal(assertWritable(S + '/b68g-s09-transcript-ipad.md'), S + '/b68g-s09-transcript-ipad.md');
  assert.throws(() => assertWritable(S + '/b68g-s09-notes.md'));
  fs.rmSync(v, { recursive: true, force: true });
});

await test('vault: helpers: the line format, the speakers block, the arguments', async () => {
  assert.equal(lineOf({ at: '2030-01-01T09:05:00Z', speaker: 2, kind: 'line', text: ' a  b ' }, { 2: 'Odo' }), '- **[20:05] Odo:** a b', 'Melbourne time');
  assert.equal(lineOf({ at: '2030-01-01T09:05:00Z', speaker: null, kind: 'line', text: 'x' }, {}), '- **[20:05] ?:** x');
  const n = newNote('9', { 0: 'A' }, '2030-01-01T09:05:00Z');
  assert.equal(withSpeakers(n, { 0: 'A' }), null, 'unchanged: no edit');
  assert.ok(/^  S3: "C"$/m.test(withSpeakers(n, { 0: 'A', 3: 'C' })));
  assert.ok(/^speakers: \{\}$/m.test(withSpeakers(n, {})));
  assert.equal(withSpeakers('no frontmatter', {}), null);
  assert.deepEqual([parseArgs(['--follow', '--every', '5']).every, parseArgs([]).follow], [5, false]);
  assert.throws(() => parseArgs(['--every', '1'])); assert.throws(() => parseArgs(['--bogus']));
  assert.deepEqual([parseArgs(['--watch']).watch, parseArgs(['--watch']).idle, parseArgs(['--watch', '--idle', '30']).idle], [true, 60, 30]);
  assert.throws(() => parseArgs(['--watch', '--follow'])); assert.throws(() => parseArgs(['--watch', '--dry-run'])); assert.throws(() => parseArgs(['--idle', '5']));
  const vbs = launcherText('C:\\Program Files\\nodejs\\node.exe', 'C:\\repo\\scripts\\gm-transcript.mjs', 'C:/Vault/Hazel Second Brain');
  assert.ok(vbs.includes('.Run """C:\\Program Files\\nodejs\\node.exe"" ""C:\\repo\\scripts\\gm-transcript.mjs"" --watch --vault ""C:/Vault/Hazel Second Brain""", 0, False'), vbs);
});

await test('watch: idle is one look and no pass; listening on files lines and beats at most once a minute; lines waiting after off still land', async () => {
  const v = makeVault(), db = await newDb(), ledger = {};
  let clock = Date.parse('2030-01-01T09:00:00Z');
  const ctx = { vault: v, db, campaign: 'default', ledger, every: 10, idle: 60, now: () => clock, host: 'LAPTOP' };
  assert.deepEqual(await probe(db, 'default'), { want: 'off', top: 0, copier: { host: '', at: '', last: 0 } }, 'no tables filled: off, nothing waiting');
  let r = await watchStep(ctx);
  assert.deepEqual([r.want, r.filed, r.wait], ['off', 0, 60000]);
  assert.ok(!fs.existsSync(path.join(v, ...S.split('/'), 'b68g-s09-transcript.md')));
  await patchStt(db, 'default', cleanSttPatch({ want: 'on', session: '9' }, 'gm'));
  r = await watchStep(ctx);
  assert.deepEqual([r.want, r.filed, r.wait], ['on', 0, 10000], 'on: the fast cadence even with nothing yet');
  assert.equal((await loadStt(db, 'default')).doc.copier.at, '2030-01-01T09:00:00.000Z', 'the first step beats');
  await addLines(db, 'default', cleanLines({ lines: [L('a', 'One.'), L('b', 'Two.')] }));
  clock += 10000; r = await watchStep(ctx);
  assert.equal(r.filed, 2); assert.equal((await loadStt(db, 'default')).doc.copier.last, ledger.transcript.last, 'filed: beats with the last seq');
  clock += 10000; await watchStep(ctx);
  assert.equal((await loadStt(db, 'default')).doc.copier.at, '2030-01-01T09:00:10.000Z', 'nothing filed, under a minute: no beat');
  clock += 60000; await watchStep(ctx);
  assert.equal((await loadStt(db, 'default')).doc.copier.at, '2030-01-01T09:01:20.000Z', 'a minute on: beats again');
  await patchStt(db, 'default', cleanSttPatch({ want: 'off' }, 'gm'));
  assert.equal((await loadStt(db, 'default')).doc.copier.last, ledger.transcript.last, 'a GM PATCH keeps the copier');
  await addLines(db, 'default', cleanLines({ lines: [L('c', 'Straggler.')] }));
  r = await watchStep(ctx);
  assert.deepEqual([r.want, r.filed, r.wait], ['off', 1, 10000], 'off but a line waiting: filed, then look again soon');
  r = await watchStep(ctx);
  assert.deepEqual([r.filed, r.wait], [0, 60000], 'then idle');
  assert.ok(/Straggler\.\n$/.test(fs.readFileSync(path.join(v, ...S.split('/'), 'b68g-s09-transcript.md'), 'utf8')));
  assert.throws(() => cleanSttPatch({ copier: { at: 'x' } }, 'gm'), /unknown key/, 'no client may set the heartbeat');
  fs.rmSync(v, { recursive: true, force: true });
});

await test('watch: two PCs on one synced vault: the one copying keeps it, the other stands back, then takes over without copying a line twice', async () => {
  const v = makeVault(), db = await newDb();
  let clock = Date.parse('2030-01-01T09:00:00Z');
  const lap = { vault: v, db, campaign: 'default', ledger: {}, every: 10, idle: 60, now: () => clock, host: 'LAPTOP' };
  const desk = { vault: v, db, campaign: 'default', ledger: {}, every: 10, idle: 60, now: () => clock, host: 'DESKTOP' };
  await patchStt(db, 'default', cleanSttPatch({ want: 'on', session: '9' }, 'gm'));
  await addLines(db, 'default', cleanLines({ lines: [L('a', 'One.'), L('b', 'Two.')] }));
  assert.equal((await watchStep(lap)).filed, 2);
  clock += 5000;
  let r = await watchStep(desk);
  assert.deepEqual([r.filed, r.other, r.wait], [0, 'LAPTOP', 60000], 'the laptop beat a moment ago: the desktop stands back');
  await addLines(db, 'default', cleanLines({ lines: [L('c', 'Three.')] }));
  clock += 200000;   /* the laptop sleeps */
  r = await watchStep(desk);
  assert.deepEqual([r.filed, r.other], [1, ''], 'the laptop gone quiet: the desktop takes over from the laptop\'s last line');
  assert.equal((await loadStt(db, 'default')).doc.copier.host, 'DESKTOP');
  clock += 5000;
  assert.equal((await watchStep(lap)).other, 'DESKTOP', 'the laptop wakes: it stands back in turn');
  const t = fs.readFileSync(path.join(v, ...S.split('/'), 'b68g-s09-transcript.md'), 'utf8');
  assert.deepEqual([(t.match(/One\./g) || []).length, (t.match(/Three\./g) || []).length], [1, 1], 'nothing copied twice');
  fs.rmSync(v, { recursive: true, force: true });
});

await test('watch: one copier at a time (a live pid holds the lock, a dead one does not)', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-lock-'));
  assert.equal(takeLock(dir), 0, 'free: taken');
  assert.equal(takeLock(dir), 0, 'this process again: still ours');
  const { spawnSync } = await import('node:child_process');
  const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']).stdout.toString();
  fs.writeFileSync(path.join(dir, 'transcript.lock'), dead);
  assert.equal(takeLock(dir), 0, 'a dead pid: taken over');
  const { spawn } = await import('node:child_process');
  const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 20000)']);
  fs.writeFileSync(path.join(dir, 'transcript.lock'), String(live.pid));
  assert.equal(takeLock(dir), live.pid, 'a live pid: refused');
  live.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

await test('vault: no session on a line -> the session note dated for that night (after midnight counts as the night before); else the highest', async () => {
  const v = makeVault(), db = await newDb(), ledger = {}, dir = path.join(v, ...S.split('/'));
  fs.writeFileSync(path.join(dir, 'b68g-s02.md'), '---\nsession: 2\ndate: 17/10/2026\n---\n# Session 2\n');
  fs.writeFileSync(path.join(dir, 'b68g-s03.md'), '---\nsession: 3\ndate: "[TODO: session date]"\n---\n# Session 3\n');
  await addLines(db, 'default', cleanLines({ lines: [
    L('a', 'evening', { session: '', at: '2026-10-17T09:30:00.000Z' }),     // 20:30 on 17/10 in Melbourne
    L('b', 'after midnight', { session: '', at: '2026-10-17T14:30:00.000Z' }),   // 01:30 on 18/10: still the night of 17/10
    L('c', 'another night', { session: '', at: '2026-10-20T09:30:00.000Z' }),    // no note dated 20/10: the highest (s09)
    L('d', 'stamped', { session: '3', at: '2026-10-17T09:31:00.000Z' }),        // a stamped session always wins
  ] }));
  const r = await pass({ vault: v, db, campaign: 'default', ledger });
  assert.deepEqual(r.notes.sort(), ['b68g-s02-transcript.md', 'b68g-s03-transcript.md', 'b68g-s09-transcript.md']);
  const t2 = fs.readFileSync(path.join(dir, 'b68g-s02-transcript.md'), 'utf8');
  assert.ok(/evening/.test(t2) && /after midnight/.test(t2) && !/another night/.test(t2));
  assert.ok(/another night/.test(fs.readFileSync(path.join(dir, 'b68g-s09-transcript.md'), 'utf8')));
  assert.ok(/stamped/.test(fs.readFileSync(path.join(dir, 'b68g-s03-transcript.md'), 'utf8')));
  fs.rmSync(v, { recursive: true, force: true });
});

await test('vault: a line the other PC already copied (old, same minute and words) is not added twice; a fresh repeat is a new line', async () => {
  const v = makeVault(), db = await newDb(), dir = path.join(v, ...S.split('/'));
  const old = '2030-01-01T09:00:00.000Z', now = () => Date.parse(old) + 3600000;
  /* the laptop copied a and b (and Sync brought its note here); this PC's ledger is behind */
  fs.writeFileSync(path.join(dir, 'b68g-s09-transcript.md'), newNote('9', {}, old) + '- **[20:00] S0:** Yes.\n- **[20:00] Pat:** Who knocks?\n');
  await addLines(db, 'default', cleanLines({ lines: [L('a', 'Yes.'), L('b', 'Who knocks?', { speaker: 1 }), L('c', 'Yes.'), L('d', 'New words.')] }));
  const r = await pass({ vault: v, db, campaign: 'default', ledger: {}, now });
  assert.equal(r.filed, 2, 'a and b were there; c (a second "Yes." that minute) and d are new');
  const t = fs.readFileSync(path.join(dir, 'b68g-s09-transcript.md'), 'utf8');
  assert.equal(t.match(/Yes\./g).length, 2); assert.equal(t.match(/Who knocks/g).length, 1); assert.ok(/New words\./.test(t));
  /* live: the same words again within the minute, seconds old, are always copied */
  const v2 = makeVault(), db2 = await newDb(), led2 = {};
  await addLines(db2, 'default', cleanLines({ lines: [L('a', 'Yes.')] }));
  await pass({ vault: v2, db: db2, campaign: 'default', ledger: led2, now: () => Date.parse(old) + 10000 });
  await addLines(db2, 'default', cleanLines({ lines: [L('b', 'Yes.', { speaker: 1 })] }));
  assert.equal((await pass({ vault: v2, db: db2, campaign: 'default', ledger: led2, now: () => Date.parse(old) + 20000 })).filed, 1);
  fs.rmSync(v, { recursive: true, force: true }); fs.rmSync(v2, { recursive: true, force: true });
});

console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\nALL PASSED (${passed})`);
process.exit(failed ? 1 : 0);
