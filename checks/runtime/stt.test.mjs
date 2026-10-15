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
import { cleanLines, addLines, readLines, cleanSttPatch, patchStt, loadStt, grantToken, pruneLines } from '../../functions/_lib/stt.js';
import { onRequest as sttApi } from '../../functions/api/gm/stt.js';
import { onRequest as tokenApi } from '../../functions/api/gm/stt-token.js';
import { onRequest as transcriptApi } from '../../functions/api/gm/transcript.js';
import { matchApi, PAGE_HEADERS } from '../../worker/app.js';
import { pass, lineOf, newNote, withSpeakers, parseArgs, probe, watchStep, takeLock, launcherText } from '../../scripts/gm-transcript.mjs';
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

/* ---------- the server ---------- */
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

console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\nALL PASSED (${passed})`);
process.exit(failed ? 1 : 0);
