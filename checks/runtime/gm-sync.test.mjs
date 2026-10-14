// Tests for scripts/gm-sync.mjs (SYNC.md) on an INVENTED vault (checks/runtime/fixtures/vault) and an in-memory D1
// (node:sqlite with schema.sql, through the same SQL and literal binding as the live wrangler path).
//   node checks/runtime/gm-sync.test.mjs
// Every run copies the fixture vault to a temp folder whose path has spaces and an apostrophe.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { run, parseArgs } from '../../scripts/gm-sync.mjs';
import { memoryExec, asD1, bindSql, literal, splitStatements, checkCommand, D1Error, wranglerExec } from '../../scripts/lib/d1.mjs';
import * as V from '../../scripts/lib/vault.mjs';
import { fileInto, collectItems } from '../../scripts/lib/sync-notes.mjs';
import { patchState, loadState } from '../../functions/_lib/gm.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURE = path.join(ROOT, 'checks', 'runtime', 'fixtures', 'vault');
const SCHEMA = path.join(ROOT, 'schema.sql');
const S = V.SESSIONS, NP = V.NPCS;

let failed = 0, passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); }
}
function eq(a, b, msg) { if (a !== b) throw new Error((msg || 'not equal') + '\n   got: ' + JSON.stringify(a) + '\n  want: ' + JSON.stringify(b)); }
function ok(v, msg) { if (!v) throw new Error(msg || 'expected true'); }

// ---------- the invented table ----------
// Every string below is made up. Markers (ZQX...) let the log tests look for text that must never be printed.
const T0 = '2026-10-17T09:05:00.000Z';   // 20:05 in Melbourne (AEDT)
function at(min) { return new Date(Date.parse(T0) + min * 60000).toISOString(); }
function stateDoc() {
  return {
    capture: {
      cA1: { id: 'cA1', bucket: 'n', text: 'ZQXname Harl the  ferry clerk', at: at(0), s: 2 },
      cA2: { id: 'cA2', bucket: 'x', text: 'ZQXloose Who paid for the lamp?', at: at(3), s: 2 },
      cA3: { id: 'cA3', bucket: 'm', text: 'ZQXmoment The kettle sang', at: at(5) },              // no s: highest note
      cA4: { id: 'cA4', bucket: 'r', text: 'ZQXroll Complication (risky) Tick: 2', at: at(7), s: 2 },
      cA5: { id: 'cA5', bucket: 'x', text: 'ZQXlater A second loose end', at: at(9), s: '2' },
      cA6: { id: 'cA6', bucket: 'n', text: 'ZQXmissing Filed for a session with no note', at: at(11), s: 3 },
      cA7: { id: 'cA7', bucket: 'n', text: 'ZQXinterlude Filed during the interlude', at: at(12), s: 1.5 },
      cA8: { id: 'cA8', bucket: 'q', text: 'ZQXweird unknown bucket', at: at(13), s: 2 },
    },
    pins: {
      pB1: { tool: 'console', label: 'ZQXpinlabel Devil’s Bargain', title: 'x', text: 'ZQXpin line one\n\nline three', at: at(4), s: 2 },
    },
    con: {
      live: { pos: 'risky' },
      owed: { kaaaa0001: { text: 'ZQXowed A favour for the ferryman', src: 'Test PC, 17/10/2026' } },
      struck: { kaaaa0002: 'ZQXpaid The old debt' },
      used: { kaaaa0003: 'ZQXused The ferry clerk returns' },
    },
  };
}
const MARKERS = ['ZQX'];

// ---------- harness ----------
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}
function snapshot(dir) {
  const out = {};
  (function walk(d, rel) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else out[r] = crypto.createHash('sha256').update(fs.readFileSync(path.join(d, e.name))).digest('hex');
    }
  })(dir, '');
  return out;
}
const read = (vault, rel) => fs.readFileSync(V.abs(vault, rel), 'utf8');

async function setup({ doc = stateDoc(), npcs = [] } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'b68 sync '));
  const vault = path.join(base, "Alex's Vault (test copy)");
  const priv = path.join(base, "gm private 'dir'");
  copyDir(FIXTURE, vault);
  const exec = await memoryExec({ schemaFile: SCHEMA });
  exec.db.exec('DELETE FROM npcs');                          // schema.sql seeds the real cast: not wanted here
  if (doc) await patchState(asD1(exec), 'default', doc);
  for (const n of npcs) {
    exec.db.prepare('INSERT INTO npcs (id, campaign, created_at, updated_at, deleted, doc) VALUES (?, ?, ?, ?, 0, ?)')
      .run(n.id, 'default', '2026-10-10T00:00:00.000Z', n.updatedAt || '2026-10-10T00:00:00.000Z', JSON.stringify(n.doc));
  }
  return { base, vault, priv, exec };
}
async function sync(env, args, extra = {}) {
  const out = [];
  const o = { ...parseArgs(args), vault: env.vault, privateDir: env.priv, exec: env.exec, now: Date.parse('2026-10-18T01:00:00.000Z'), print: (s) => out.push(s), root: ROOT, ...extra };
  const r = await run(o);
  return { ...r, out: out.join('\n') };
}
const logText = (env) => { try { return fs.readFileSync(path.join(env.priv, 'sync-log.jsonl'), 'utf8'); } catch (_) { return ''; } };

// ======================================================================================================
// d1 layer
// ======================================================================================================
await test('d1: literals and placeholder binding (quotes doubled, ?N outside strings only, NUL refused)', async () => {
  eq(literal("it's"), "'it''s'");
  eq(literal(null), 'NULL'); eq(literal(true), '1'); eq(literal(12.5), '12.5');
  eq(bindSql("SELECT '?1', ?1, ?2 -- ?3\n", ["a'b", 3]), "SELECT '?1', 'a''b', 3 -- ?3\n");
  let threw = false; try { literal('a\u0000b'); } catch (e) { threw = true; } ok(threw, 'NUL accepted');
  eq(splitStatements("INSERT INTO t VALUES ('a;b'); SELECT 1;").length, 2);
  threw = false; try { checkCommand("SELECT '" + '"'.repeat(15000) + "'"); } catch (e) { threw = e.kind === 'size'; } ok(threw, 'oversized command accepted');
});

await test('d1: wrangler errors are classified (not logged in / offline) and nothing is parsed from them', async () => {
  const { EventEmitter } = await import('node:events');
  const fake = (stdout, code) => () => {
    const c = new EventEmitter(); c.stdout = new EventEmitter(); c.stderr = new EventEmitter();
    c.stdout.setEncoding = () => {}; c.stderr.setEncoding = () => {}; c.kill = () => {};
    setImmediate(() => { c.stdout.emit('data', stdout); c.emit('close', code); });
    return c;
  };
  const w1 = wranglerExec({ root: ROOT, database: 'x', spawnImpl: fake(JSON.stringify({ error: { text: 'You are not authenticated. Please run `wrangler login`.' } }), 1) });
  let e1 = null; try { await w1.batch('SELECT 1'); } catch (e) { e1 = e; } eq(e1 && e1.kind, 'auth');
  const w2 = wranglerExec({ root: ROOT, database: 'x', spawnImpl: fake('', 1) });
  const w2b = wranglerExec({ root: ROOT, database: 'x', spawnImpl: () => { const c = fake('fetch failed: getaddrinfo ENOTFOUND api.cloudflare.com', 1)(); return c; } });
  let e2 = null; try { await w2b.batch('SELECT 1'); } catch (e) { e2 = e; } eq(e2 && e2.kind, 'offline');
  const w3 = wranglerExec({ root: ROOT, database: 'x', spawnImpl: fake(JSON.stringify([{ results: [{ a: 1 }], success: true, meta: { changes: 0 } }]), 0) });
  eq((await asD1(w3).prepare('SELECT 1 AS a').first()).a, 1);
  void w2;
});

// ======================================================================================================
// the session-note half
// ======================================================================================================
await test('pull: lines land under the four headings in the station format, with block ids, in time order', async () => {
  const env = await setup();
  const r = await sync(env, ['pull', '--only', 'notes']);
  const t = read(env.vault, S + '/b68g-s02.md');
  ok(t.includes('## Names\n\n- **20:05** ZQXname Harl the ferry clerk ^b68-cA1\n\n## Loose ends'), 'Names line (whitespace collapsed, placeholder eaten)');
  ok(t.includes('## Loose ends\n\n- **20:08** ZQXloose Who paid for the lamp? ^b68-cA2\n- **20:14** ZQXlater A second loose end ^b68-cA5\n\n## Moments'), 'two loose ends in order');
  ok(t.includes('## Moments\n\n- **20:10** ZQXmoment The kettle sang ^b68-cA3\n'), 'no s -> highest-numbered note (s02, not s1.5)');
  ok(t.includes('## Rolled at the table\n\n- **20:12** ZQXroll Complication (risky) Tick: 2 ^b68-cA4\n'), 'L roll');
  ok(!/^-\s*$/m.test(t.split('# Play log')[1]), 'every placeholder "-" in the play log was eaten');
  ok(r.report.refused.find((x) => x.target === 'b68g-s1.5.md'), 'session 1.5 is a real target (refused here: it lacks the headings)');
  eq(r.code, 1, 'exit 1: something was refused');
});

await test('pull: pins become collapsed callouts under ## Pinned, bargains under ## Bargains and callbacks, both after Rolled', async () => {
  const env = await setup();
  await sync(env, ['pull', '--only', 'notes']);
  const t = read(env.vault, S + '/b68g-s02.md');
  const rolled = t.indexOf('## Rolled at the table'), pinned = t.indexOf('## Pinned'), barg = t.indexOf('## Bargains and callbacks'), rule = t.indexOf('---\n\n## Related');
  ok(rolled < pinned && pinned < barg && barg < rule, 'order: Rolled, Pinned, Bargains, then the rule before Related');
  ok(t.includes('## Pinned\n\n> [!quote]- 20:09 · ZQXpinlabel Devil’s Bargain\n> ZQXpin line one\n>\n> line three\n\n^b68-pB1\n\n## Bargains'), 'pin callout + block id on its own line');
  ok(t.includes('- **Owed:** ZQXowed A favour for the ferryman (Test PC, 17/10/2026) ^b68-owed-kaaaa0001\n- **Collected:** ZQXpaid The old debt ^b68-paid-kaaaa0002\n- **Callback used:** ZQXused The ferry clerk returns ^b68-used-kaaaa0003\n\n---'), 'bargain lines');
});

await test('idempotent: a second run leaves the whole vault byte-identical and files nothing', async () => {
  const env = await setup();
  await sync(env, ['pull', '--only', 'notes']);
  const a = snapshot(env.vault);
  const r2 = await sync(env, ['pull', '--only', 'notes']);
  eq(JSON.stringify(snapshot(env.vault)), JSON.stringify(a), 'vault changed on the second run');
  eq(r2.report.filed.length, 0, 'filed something twice');
  ok(r2.report.skipped.filter((s) => s.why === 'already in the vault').length >= 9, 'second run skips as already in the vault');
});

await test('missing note: a capture for session 3 is refused and reported; everything else still files', async () => {
  const env = await setup();
  const r = await sync(env, ['pull', '--only', 'notes']);
  const ref = r.report.refused.find((x) => /b68g-s03/.test(x.target));
  ok(ref && ref.why === 'note missing' && ref.ids.includes('cA6'), 'refusal for b68g-s03 reported');
  ok(!fs.existsSync(V.abs(env.vault, S + '/b68g-s03.md')), 'no note created');
  ok(r.out.includes('b68g-s03.md: note missing'), 'printed');
  ok(read(env.vault, S + '/b68g-s02.md').includes('^b68-cA1'), 's02 still filed');
});

await test('refusal: a note with a heading twice gets nothing (the 14/10 double-note case); others still file', async () => {
  const env = await setup();
  const f = V.abs(env.vault, S + '/b68g-s02.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8') + '\n## Names\n\n-\n');
  const before = fs.readFileSync(f);
  const r = await sync(env, ['pull', '--only', 'notes']);
  ok(fs.readFileSync(f).equals(before), 's02 was modified');
  const ref = r.report.refused.find((x) => x.target === 'b68g-s02.md');
  ok(ref && /heading twice: ## Names/.test(ref.why), 'reason given');
  ok(r.out.includes('REFUSED'), 'printed');
});

await test('refusal: a target lacking one of the four headings is refused (s1.5 has only ## Moments) ... unless it has them', async () => {
  const env = await setup();
  const f = V.abs(env.vault, S + '/b68g-s1.5.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('## Moments', '## Names\n\n## Loose ends\n\n## Moments\n\n## Rolled at the table') );
  await sync(env, ['pull', '--only', 'notes']);
  ok(read(env.vault, S + '/b68g-s1.5.md').includes('^b68-cA7'), 'filed once the headings exist');
  const env2 = await setup();
  const r2 = await sync(env2, ['pull', '--only', 'notes']);
  ok(r2.report.refused.find((x) => x.target === 'b68g-s1.5.md' && /missing heading: ## Names/.test(x.why)), 'refused while headings are missing');
});

await test('dry run writes nothing (vault, ledger) but reports what it would file', async () => {
  const env = await setup();
  const a = snapshot(env.vault);
  const r = await sync(env, ['pull', '--dry-run', '--only', 'notes']);
  eq(JSON.stringify(snapshot(env.vault)), JSON.stringify(a));
  ok(!fs.existsSync(path.join(env.priv, 'sync-ledger.json')), 'ledger written in a dry run');
  ok(r.out.includes('would file into b68g-s02.md'), 'printed as would');
  ok(r.report.filed.length >= 8 && r.report.filed.every((f) => f.dry), 'reported as dry');
});

await test('a line Alex deleted after it was filed is not filed again (the ledger remembers)', async () => {
  const env = await setup();
  await sync(env, ['pull', '--only', 'notes']);
  const f = V.abs(env.vault, S + '/b68g-s02.md');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^- \*\*20:05\*\* .*\^b68-cA1\n/m, ''));
  const before = fs.readFileSync(f);
  const r = await sync(env, ['pull', '--only', 'notes']);
  ok(fs.readFileSync(f).equals(before), 're-filed the deleted line');
  ok(r.report.skipped.find((s) => s.id === 'cA1' && /removed/.test(s.why)), 'reported as removed');
});

await test('a line already in ANY session note is not filed again elsewhere (s01 holds ^b68-cold1)', async () => {
  const doc = stateDoc(); doc.capture.cold1 = { bucket: 'n', text: 'ZQXold Tobble again', at: at(-500) };
  const env = await setup({ doc });
  const r = await sync(env, ['pull', '--only', 'notes']);
  ok(!read(env.vault, S + '/b68g-s02.md').includes('cold1'), 'filed into s02 as well');
  ok(r.report.skipped.find((s) => s.id === 'cold1' && s.why === 'already in the vault'));
});

await test('CRLF notes keep CRLF on every line (old and new), a BOM stays, Unicode is untouched', async () => {
  const env = await setup();
  const f = V.abs(env.vault, S + '/b68g-s02.md');
  const crlf = fs.readFileSync(f, 'utf8').replace(/\n/g, '\r\n');
  fs.writeFileSync(f, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(crlf, 'utf8')]));
  await sync(env, ['pull', '--only', 'notes']);
  const buf = fs.readFileSync(f);
  ok(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf, 'BOM lost');
  const t = buf.subarray(3).toString('utf8');
  ok(!/[^\r]\n/.test(t), 'a bare LF crept in');
  ok(t.includes('- **20:05** ZQXname Harl the ferry clerk ^b68-cA1\r\n'), 'new line has CRLF');
  ok(t.includes('“quietly”, and wait. Café, naïve, 東京 ✓\r\n'), 'Unicode line intact');
  const t2 = fs.readFileSync(f);
  await sync(env, ['pull', '--only', 'notes']);
  ok(fs.readFileSync(f).equals(t2), 'second run changed a CRLF note');
});

await test('LF notes: every byte outside the inserted lines is unchanged', async () => {
  const env = await setup();
  const before = read(env.vault, S + '/b68g-s02.md');
  await sync(env, ['pull', '--only', 'notes']);
  const after = read(env.vault, S + '/b68g-s02.md');
  const strip = (s) => s.split('\n').filter((l) => !/\^b68-/.test(l) && !/^> /.test(l) && l !== '>' && !/^## (Pinned|Bargains and callbacks)$/.test(l) && l.trim() !== '-' && l.trim() !== '').join('\n');
  eq(strip(after), strip(before), 'non-sync content changed');
  ok(after.includes('```dataviewjs\n// a code block with a heading-like line that must be ignored\n## Names\n```'), 'code block untouched');
});

await test('an old note with a table under Rolled at the table: a blank line separates the table from the new list', async () => {
  const lines = V.toLines(read(FIXTURE, S + '/b68g-s01.md'));
  const text = fileInto(lines.join('\n'), '\n', [{ kind: 'capture', id: 'z1', bid: 'b68-z1', bucket: 'r', text: 'ZQX a roll', at: T0 }, { kind: 'capture', id: 'z2', bid: 'b68-z2', bucket: 'x', text: 'ZQX loose', at: T0 }]);
  ok(text.includes('| 1 | Test PC | 6 |\n\n- **20:05** ZQX a roll ^b68-z1\n\n---\n\n## Close'), 'table then blank then line, before the rule');
  ok(text.includes('## Loose ends\n\n- **20:05** ZQX loose ^b68-z2\n\n## Moments'), 'placeholder replaced');
});

await test('Obsidian saves the note mid-run: the edit is redone on the fresh copy, once; twice -> refused, nothing lost', async () => {
  const env = await setup();
  const f = V.abs(env.vault, S + '/b68g-s02.md');
  let n = 0;
  V.setHooks({ beforeRename(file, attempt) { if (file === f && attempt === 0 && n++ === 0) { const t = fs.readFileSync(f, 'utf8'); fs.writeFileSync(f, t.replace('## Related\n', '## Related\n\n- typed in Obsidian mid-run\n')); } } });
  try { await sync(env, ['pull', '--only', 'notes']); } finally { V.setHooks(null); }
  const t = read(env.vault, S + '/b68g-s02.md');
  ok(t.includes('- typed in Obsidian mid-run') && t.includes('^b68-cA1'), 'both the mid-run edit and the sync lines are there');
  const env2 = await setup();
  const f2 = V.abs(env2.vault, S + '/b68g-s02.md');
  let k = 0;
  V.setHooks({ beforeRename(file) { if (file === f2) { k++; fs.appendFileSync(f2, '\n- typed again ' + k + '\n'); } } });
  let r;
  try { r = await sync(env2, ['pull', '--only', 'notes']); } finally { V.setHooks(null); }
  const t2 = read(env2.vault, S + '/b68g-s02.md');
  ok(t2.includes('- typed again 1') && t2.includes('- typed again 2') && !t2.includes('^b68-cA1'), 'kept both Obsidian edits, wrote nothing');
  ok(r.report.refused.find((x) => x.target === 'b68g-s02.md' && /changed while the sync/.test(x.why)), 'reported');
  ok(!fs.readdirSync(path.dirname(f2)).some((x) => x.endsWith('.tmp')), 'temp file left behind');
});

await test('--session N sends lines without a session there; old-style highest note picks b68g-sNN over b68g-s1.5', async () => {
  const notes = V.sessionNotes(FIXTURE);
  eq(notes.map((n) => n.name).join(','), 'b68g-s01.md,b68g-s1.5.md,b68g-s02.md', 'transcripts left out, 1.5 parsed');
  eq(V.highestNote(notes).note.name, 'b68g-s02.md');
  eq(V.noteForSession(notes, 1).note.name, 'b68g-s01.md');
  ok(/b68g-s07\.md is missing/.test(V.noteForSession(notes, 7).error));
  const doc = { capture: { c1: { bucket: 'm', text: 'ZQX for one', at: T0 } } };
  const env = await setup({ doc });
  await sync(env, ['pull', '--only', 'notes', '--session', '1']);
  ok(read(env.vault, S + '/b68g-s01.md').includes('ZQX for one ^b68-c1'), 'went to s01');
});

await test('the board (b68g-factions.md) is never written; the writer refuses no-touch paths', async () => {
  const env = await setup();
  const before = fs.readFileSync(V.abs(env.vault, V.NEVER[0]));
  await sync(env, ['both', '--yes']);
  ok(fs.readFileSync(V.abs(env.vault, V.NEVER[0])).equals(before));
  for (const p of [V.NEVER[0], 'TTRPG/x.md', '.obsidian/app.json', 'Wiki/Other/page.md', S + '/b68g-s01-transcript.md']) {
    let threw = false; try { V.assertWritable(p); } catch (e) { threw = true; } ok(threw, 'writable: ' + p);
  }
});

await test('not logged in / offline: the run stops before writing anything', async () => {
  const env = await setup();
  const a = snapshot(env.vault);
  const dead = { kind: 'wrangler', batch: async () => { throw new D1Error('wrangler: You are not authenticated', 'auth'); } };
  const r = await sync({ ...env, exec: dead }, ['both', '--yes']);
  eq(r.code, 2);
  eq(JSON.stringify(snapshot(env.vault)), JSON.stringify(a));
  ok(/not logged in to Cloudflare/.test(r.out) && /Nothing was written/.test(r.out));
});

await test('table text never reaches the printout or sync-log.jsonl (counts, ids and note names only)', async () => {
  const env = await setup();
  const r1 = await sync(env, ['pull', '--only', 'notes']);
  const r2 = await sync(env, ['pull', '--only', 'notes', '--dry-run']);
  for (const m of MARKERS) {
    ok(!r1.out.includes(m) && !r2.out.includes(m), 'marker in the printout');
    ok(!logText(env).includes(m), 'marker in the log');
  }
  const lines = logText(env).trim().split('\n').map((l) => JSON.parse(l));
  eq(lines.length, 2);
  ok(lines[0].counts.filed >= 8 && lines[0].notes.includes('b68g-s02.md'), 'counts and note names logged');
});

await test('state shapes: collectItems tolerates junk (non-objects, string owed "text | src", missing fields)', async () => {
  const items = collectItems({ capture: { a: 'x', b: null, c: { bucket: 'n' } }, pins: [1, 2], con: { owed: { k1: 'Pay | Someone, 01/10', k2: 5 }, struck: 'x' } });
  eq(items.filter((i) => i.kind === 'capture').length, 1);
  const owed = items.filter((i) => i.kind === 'owed');
  eq(owed[0].text, 'Pay'); eq(owed[0].src, 'Someone, 01/10'); eq(owed[1].text, '5');
  const st = await loadState(asD1((await setup({ doc: null })).exec), 'default');
  eq(JSON.stringify(st.doc), '{}');
});

// @@NPC-TESTS@@

console.log((failed ? 'FAILED ' : 'ok ') + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
