// The assist prefix as an Anthropic Files API file (scripts/lib/assist-file.mjs, scripts/lib/sync-pack.mjs). A MOCK client
// stands in for the API: no network, no key. Every string is invented.
//   node checks/runtime/gm-assist-file.test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { newReport } from '../../scripts/lib/report.mjs';
import { pushPack } from '../../scripts/lib/sync-pack.mjs';
import { preparePart, finishPart, readState, sha256, STATE_NAME, FILE_NAME } from '../../scripts/lib/assist-file.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

function mockClient() {
  const c = { uploads: [], deletes: [], failDelete: null, n: 0,
    files: {
      async upload(p) { const text = await p.file.text(); c.uploads.push({ name: p.file.name, type: p.file.type, text }); return { id: 'file_mock' + (++c.n) + 'AAAA' }; },
      async delete(id) { if (c.failDelete) throw c.failDelete; c.deletes.push(id); return { id, type: 'file_deleted' }; },
    } };
  return c;
}
const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'assist-file-'));

// ---------- preparePart / finishPart ----------
await test('first upload: text/plain, the pushed body carries { file_id, hash, extra } and never the text; the state is remembered', async () => {
  const dir = tmpDir(), stateFile = path.join(dir, STATE_NAME), client = mockClient();
  const r = await preparePart({ prefix: 'INVENTED RULES TEXT', extra: { ref: 'x' } }, { stateFile, client });
  assert.equal(r.action, 'upload');
  assert.equal(client.uploads.length, 1);
  assert.deepEqual([client.uploads[0].name, client.uploads[0].type, client.uploads[0].text], [FILE_NAME, 'text/plain', 'INVENTED RULES TEXT']);
  assert.deepEqual(r.body, { file_id: 'file_mock1AAAA', hash: sha256('INVENTED RULES TEXT'), extra: { ref: 'x' } });
  assert.ok(!JSON.stringify(r.body).includes('INVENTED'));
  assert.deepEqual(readState(stateFile), { hash: sha256('INVENTED RULES TEXT'), file_id: 'file_mock1AAAA' });
});

await test('an unchanged hash uploads nothing and reuses the file id', async () => {
  const dir = tmpDir(), stateFile = path.join(dir, STATE_NAME), client = mockClient();
  await preparePart({ prefix: 'SAME TEXT' }, { stateFile, client });
  const r = await preparePart({ prefix: 'SAME TEXT' }, { stateFile, client });
  assert.equal(r.action, 'reuse');
  assert.equal(client.uploads.length, 1);
  assert.equal(r.body.file_id, 'file_mock1AAAA');
  assert.equal(r.body.extra, undefined);
});

await test('a changed hash uploads again; the replaced file is deleted only after finishPart (the new part is in D1), and only once', async () => {
  const dir = tmpDir(), stateFile = path.join(dir, STATE_NAME), client = mockClient();
  await preparePart({ prefix: 'FIRST' }, { stateFile, client });
  const r = await preparePart({ prefix: 'SECOND' }, { stateFile, client });
  assert.equal(r.action, 'upload'); assert.equal(client.uploads.length, 2);
  assert.deepEqual(client.deletes, [], 'not deleted before the new part is pushed');
  assert.equal(readState(stateFile).replaces, 'file_mock1AAAA');
  const f = await finishPart({ stateFile, client });
  assert.equal(f.deleted, 'file_mock1AAAA');
  assert.deepEqual(client.deletes, ['file_mock1AAAA']);
  assert.deepEqual(readState(stateFile), { hash: sha256('SECOND'), file_id: 'file_mock2AAAA' });
  await finishPart({ stateFile, client });
  assert.equal(client.deletes.length, 1);
});

await test('a failed delete is reported and retried next time; a 404 on delete counts as deleted', async () => {
  const dir = tmpDir(), stateFile = path.join(dir, STATE_NAME), client = mockClient();
  await preparePart({ prefix: 'A' }, { stateFile, client }); await preparePart({ prefix: 'B' }, { stateFile, client });
  client.failDelete = Object.assign(new Error('boom'), { status: 500 });
  const f = await finishPart({ stateFile, client });
  assert.equal(f.deleted, ''); assert.match(f.note, /next push retries/);
  assert.equal(readState(stateFile).replaces, 'file_mock1AAAA');
  client.failDelete = Object.assign(new Error('gone'), { status: 404 });
  assert.equal((await finishPart({ stateFile, client })).deleted, 'file_mock1AAAA');
  assert.equal(readState(stateFile).replaces, undefined);
});

await test('a dry run neither uploads nor deletes, needs no key, and says what it would do', async () => {
  const dir = tmpDir(), stateFile = path.join(dir, STATE_NAME), client = mockClient();
  await preparePart({ prefix: 'OLD' }, { stateFile, client });
  const before = fs.readFileSync(stateFile, 'utf8');
  const r = await preparePart({ prefix: 'NEW' }, { stateFile, client: null, dryRun: true });
  assert.equal(r.action, 'would-upload'); assert.match(r.note, /would upload/); assert.match(r.note, /delete the file it replaces/);
  assert.equal(client.uploads.length, 1); assert.deepEqual(client.deletes, []);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), before, 'the state file is untouched');
  assert.deepEqual(await finishPart({ stateFile, client: null }), { deleted: '', note: '' });
  assert.equal((await preparePart({ prefix: 'OLD' }, { stateFile, client: null, dryRun: true })).action, 'reuse');
});

await test('no key and a changed prefix: refused with a message that names B68_ANTHROPIC_KEY; the key is not ANTHROPIC_API_KEY', async () => {
  const stateFile = path.join(tmpDir(), STATE_NAME);
  const r = await preparePart({ prefix: 'X' }, { stateFile, client: null });
  assert.equal(r.action, 'no-key'); assert.match(r.note, /B68_ANTHROPIC_KEY/); assert.equal(r.body, null);
  const src = fs.readFileSync(path.join(ROOT, 'scripts/lib/assist-file.mjs'), 'utf8');
  assert.ok(!/process\.env\.ANTHROPIC_API_KEY|env\.ANTHROPIC_API_KEY/.test(src));
});

// ---------- through the pack push ----------
async function pushSetup(prefix, extraParts = {}) {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec);
  const priv = tmpDir();
  const file = path.join(priv, 'b68-gm-pack.json');
  const write = (p) => fs.writeFileSync(file, JSON.stringify({ format: 1, parts: { assist: { src: { file: 'rules.md', exportedAt: 'x', tokens: 5, prep: 'Notes/Tonight.md', mustLand: 1, mustLandLanded: 0 }, prefix: p, extra: { ref: 'e' } }, ...extraParts } }));
  write(prefix);
  const go = async (o = {}) => { const report = newReport(); const ledger = { pack: {} }; await pushPack({ exec, db, campaign: 'c', report, ledger, privateDir: priv, now: Date.now(), yes: true, ...o }); return report; };
  return { exec, db, priv, file, write, go };
}
const stored = (exec) => { const r = exec.db.prepare("SELECT body FROM gm_pack WHERE campaign='c' AND part='assist'").get(); return r ? JSON.parse(r.body) : null; };

await test('pack push: the part in D1 is the small form (no prefix text); the local pack file keeps the text; unchanged text is not re-uploaded', async () => {
  const s = await pushSetup('INVENTED PREFIX TEXT');
  const client = mockClient();
  const rep = await s.go({ assistClient: client });
  assert.equal(rep.refused.length, 0, JSON.stringify(rep.refused));
  assert.equal(client.uploads.length, 1);
  assert.deepEqual(stored(s.exec), { file_id: 'file_mock1AAAA', hash: sha256('INVENTED PREFIX TEXT'), extra: { ref: 'e' } });
  assert.ok(JSON.parse(fs.readFileSync(s.file, 'utf8')).parts.assist.prefix === 'INVENTED PREFIX TEXT');
  const rep2 = await s.go({ assistClient: client });
  assert.equal(client.uploads.length, 1, 'same text: no second upload');
  assert.ok(rep2.skipped.some((x) => x.id === 'assist'), 'and the part is unchanged on the server');
});

await test('pack push: changed text uploads once, swaps the part, then deletes the old file', async () => {
  const s = await pushSetup('VERSION ONE');
  const client = mockClient();
  await s.go({ assistClient: client });
  s.write('VERSION TWO');
  await s.go({ assistClient: client });
  assert.equal(client.uploads.length, 2);
  assert.equal(stored(s.exec).file_id, 'file_mock2AAAA');
  assert.deepEqual(client.deletes, ['file_mock1AAAA']);
});

await test('pack push: if the swap into D1 fails the old file is NOT deleted', async () => {
  const s = await pushSetup('VERSION ONE');
  const client = mockClient();
  await s.go({ assistClient: client });
  s.write('VERSION TWO');
  const real = s.exec.batch;
  const broken = { ...s.exec, batch: async (sql) => { if (/INSERT INTO gm_pack/.test(sql)) throw new Error('d1 down'); return real(sql); } };
  await assert.rejects(s.go({ assistClient: client, exec: broken }), /d1 down/);
  assert.deepEqual(client.deletes, []);
  assert.equal(readState(path.join(s.priv, STATE_NAME)).replaces, 'file_mock1AAAA', 'the delete is still pending');
});

await test('pack push: --dry-run and plain (no --yes) upload and delete nothing and write nothing', async () => {
  const s = await pushSetup('VERSION ONE');
  const client = mockClient();
  await s.go({ assistClient: client });
  s.write('VERSION TWO');
  const state = fs.readFileSync(path.join(s.priv, STATE_NAME), 'utf8');
  for (const o of [{ dryRun: true }, { yes: false }, { dryRun: true, yes: true }]) {
    const rep = await s.go({ assistClient: client, ...o });
    assert.equal(client.uploads.length, 1); assert.deepEqual(client.deletes, []);
    assert.ok(rep.info.some((m) => /would upload/.test(m)), 'it says what it would do');
    assert.ok(rep.planned.some((p) => p.id === 'assist'));
  }
  assert.equal(fs.readFileSync(path.join(s.priv, STATE_NAME), 'utf8'), state);
  assert.equal(stored(s.exec).file_id, 'file_mock1AAAA', 'D1 untouched');
});

await test('pack push: with no B68_ANTHROPIC_KEY the assist part is refused (the other parts still go)', async () => {
  const s = await pushSetup('NEEDS A KEY', { console: { src: {}, tables: { a: 1 } } });
  const rep = await s.go({ assistClient: null });
  assert.equal(rep.refused.length, 1);
  assert.match(rep.refused[0].why, /B68_ANTHROPIC_KEY/);
  assert.equal(stored(s.exec), null);
  assert.ok(rep.pushed.some((p) => p.id === 'console'));
});

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nALL PASSED (${passed})`);
process.exit(failed ? 1 : 0);
