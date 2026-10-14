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
    if (e.isDirectory()) copyDir(s, d); else fs.writeFileSync(d, fs.readFileSync(s, 'utf8').replace(/\r\n/g, '\n'));   // git may check out CRLF
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
  const lines = V.toLines(read(FIXTURE, S + '/b68g-s01.md').replace(/\r\n/g, '\n'));
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

// ======================================================================================================
// NPCs (lib/sync-npc.mjs)
// ======================================================================================================
const NPC_NAMES = ["Odo D'Arcy", 'Vell Marrow', 'Sabine Quell', 'Pim Calloway', 'Tamsin Rook'];
function npcRows() {
  return [
    { id: 'npc_odo', doc: { name: "Odo D'Arcy", alias: '', role: '', faction: '', description: 'A narrow man in a waxed coat, smelling of lamp oil.', spec: {}, revealed: true, firstSeen: '2026-10-17T10:00:00.000Z', tags: [], gmNotes: 'ZQXgm Speaks softly.\nCounts twice.' } },
    { id: 'npc_vell', doc: { name: 'Vell Marrow', alias: '', role: '', faction: '', description: 'ZQXdesc An older app description', spec: { id: 'vell', shape: 'slim', hair: 'bun', coat: 'apron' }, revealed: false, firstSeen: null, tags: [], gmNotes: '' } },
    { id: 'npc_sabine', doc: { name: 'Sabine Quell', alias: 'Quill', role: 'Night porter', faction: '', description: 'ZQXlook A porter with a lantern', spec: {}, revealed: false, firstSeen: null, tags: [], gmNotes: 'ZQXgm2 Owes the crew one.' } },
    { id: 'npc_pim', doc: { name: 'Pim Calloway', alias: '', role: '', faction: '', description: 'ZQXlook2 Short, quick', spec: {}, revealed: false, firstSeen: null, tags: [], gmNotes: '' } },
    { id: 'npc_gen', doc: { name: 'Tamsin Rook', alias: '', role: '', faction: '', description: 'ZQXlook3 A grinder with green fingers.', spec: {}, revealed: false, firstSeen: null, tags: [], gmNotes: 'ZQXgm3 how to play and levers' } },
  ];
}
const fakeGen = {
  create() {
    return {
      roll({ seed }) { return { npc: { name: seed === 77 ? 'Tamsin Rook' : 'Someone Else', profession: 'glass grinder', rank: 'Member', faction: 'The Tin Choir' } }; },
      noteBody(npc, { date }) {
        return ['---', 'wiki: entity', 'created: ' + date, 'updated: ' + date, 'quality: 1', 'district: Test Quarter', 'faction: The Tin Choir',
          'attitude: Wary', 'played_by:', 'campaign: group', 'tags:', '  - wiki/games', '  - wiki/blades-in-the-dark', '  - wiki/npc', '---', '',
          '# ' + npc.name, '', '*glass grinder*', '', '> [!quote] At a glance', '> ZQXlook3 A grinder with green fingers.', '', '## In play', '',
          '*What they wanted from the crew, what they got, what they owe.*', '', '---', '', 'Rolled from [[blades-68-npc-generator]].', ''].join('\n');
      },
    };
  },
};
const npcDoc = () => ({ ...stateDoc(), npcgen: { npc_gen: { seed: 77, mem: '{}', at: T0, s: 2 } } });
const appNpc = (env, id) => JSON.parse(env.exec.db.prepare('SELECT doc FROM npcs WHERE id = ?').get(id).doc);

await test('NPC pull: new cards (generator format, fallback, "(NPC)" on a vault-wide name collision), needs-review, log entry', async () => {
  const env = await setup({ doc: npcDoc(), npcs: npcRows() });
  const r = await sync(env, ['pull'], { npcModule: fakeGen });
  const sab = read(env.vault, NP + '/Sabine Quell.md');
  ok(sab.startsWith('---\nwiki: entity\ncreated: 18/10/2026\n'), 'frontmatter like the generator');
  ok(sab.includes('  - wiki/npc\n  - wiki/needs-review\nreview_note: "'), 'needs-review + review_note');
  ok(sab.includes('# Sabine Quell "Quill"') && sab.includes('> ZQXlook A porter with a lantern') && sab.includes('[TODO:'), 'fallback card from the app fields');
  ok(/## In play\n\n\*What they wanted.*\*\n\n> \[!note\]- 10\/10\/2026: GM notes from the app\n> ZQXgm2 Owes the crew one\.\n\n\^b68-gmn-npc-sabine-[0-9a-f]{8}\n\n---/.test(sab), 'GM notes callout inside In play, before the rule');
  ok(fs.existsSync(V.abs(env.vault, NP + '/Pim Calloway (NPC).md')), 'collision with Personal/People -> (NPC)');
  ok(!fs.existsSync(V.abs(env.vault, NP + '/Pim Calloway.md')), 'shadowed the personal note');
  const tam = read(env.vault, NP + '/Tamsin Rook.md');
  ok(tam.includes('  - wiki/npc\n  - wiki/needs-review\nreview_note: ') && tam.includes('*glass grinder*'), 'generator card + review tag');
  ok(!tam.includes('gmn-'), 'a generator card gets no GM-notes callout (the card already holds them)');
  ok(read(env.vault, V.FACTIONS + '/b68-the-tin-choir.md').endsWith("- [[Odo D'Arcy]] — lamp-oil seller, Member The Tin Choir\n- [[Tamsin Rook]] — glass grinder, Member The Tin Choir\n"), 'dossier line appended like the generator Save');
  const log = read(env.vault, V.LOG);
  ok(/\n\n## \[18\/10\/2026\] sync \| GM app: 3 new NPC cards\n- Created \[\[Sabine Quell\]\], \[\[Pim Calloway \(NPC\)\]\], \[\[Tamsin Rook\]\]/.test(log) || /## \[18\/10\/2026\] sync \| GM app: 3 new NPC cards/.test(log), 'Wiki/log.md entry');
  eq(r.report.created.length, 3);
  ok(r.out.includes('created ' + NP + '/Tamsin Rook.md (tagged wiki/needs-review), from its generator roll'), 'printed with provenance');
  const odo = read(env.vault, NP + "/Odo D'Arcy.md");
  ok(/## In play\n\n\*What they wanted.*\*\n\n- \*\*17\/10\/2026 \(app\):\*\* revealed to the table\. \^b68-rev-npc-odo\n\n> \[!note\]- 10\/10\/2026: GM notes from the app\n> ZQXgm Speaks softly\.\n> Counts twice\.\n\n\^b68-gmn-npc-odo-[0-9a-f]{8}\n\n---\n\nRolled from/.test(odo), 'reveal line and GM notes in In play, before the footer rule');
});

await test('NPC pull: idempotent (byte-identical second run, no second log entry); dry run creates nothing', async () => {
  const env = await setup({ doc: npcDoc(), npcs: npcRows() });
  const a0 = snapshot(env.vault);
  const d = await sync(env, ['pull', '--dry-run'], { npcModule: fakeGen });
  eq(JSON.stringify(snapshot(env.vault)), JSON.stringify(a0), 'dry run wrote');
  ok(d.out.includes('would create ' + NP + '/Sabine Quell.md'));
  await sync(env, ['pull'], { npcModule: fakeGen });
  const a = snapshot(env.vault);
  const r2 = await sync(env, ['pull'], { npcModule: fakeGen });
  eq(JSON.stringify(snapshot(env.vault)), JSON.stringify(a), 'second run changed the vault');
  eq(r2.report.created.length, 0);
});

await test('NPC pull: a card Alex deleted is not recreated; a new GM-notes version is added once', async () => {
  const env = await setup({ doc: npcDoc(), npcs: npcRows() });
  await sync(env, ['pull'], { npcModule: fakeGen });
  fs.renameSync(V.abs(env.vault, NP + '/Sabine Quell.md'), V.abs(env.base, 'moved away.md'));
  const r = await sync(env, ['pull'], { npcModule: fakeGen });
  ok(!fs.existsSync(V.abs(env.vault, NP + '/Sabine Quell.md')) && r.report.skipped.find((s) => s.id === 'npc_sabine' && /renamed or removed/.test(s.why)));
  env.exec.db.prepare("UPDATE npcs SET doc = json_set(doc, '$.gmNotes', 'ZQXgm Now louder.') WHERE id = 'npc_odo'").run();
  await sync(env, ['pull'], { npcModule: fakeGen });
  const odo = read(env.vault, NP + "/Odo D'Arcy.md");
  eq((odo.match(/GM notes from the app/g) || []).length, 2, 'two versions of the GM notes');
  ok(odo.indexOf('ZQXgm Speaks softly') < odo.indexOf('ZQXgm Now louder'), 'newest last');
});

await test('NPC push, no ledger: every difference is a conflict, nothing is written to D1 even with --yes', async () => {
  const env = await setup({ doc: npcDoc(), npcs: npcRows() });
  const before = appNpc(env, 'npc_vell');
  const r = await sync(env, ['push', '--yes', '--only', 'npcs']);
  eq(JSON.stringify(appNpc(env, 'npc_vell')), JSON.stringify(before), 'D1 changed');
  ok(r.report.conflicts.find((c) => c.npc === 'npc_vell' && c.field === 'description'), 'description conflict');
  ok(r.report.conflicts.find((c) => c.npc === 'npc_vell' && c.field === 'spec'), 'spec conflict');
  ok(!r.report.conflicts.find((c) => c.npc === 'npc_odo'), 'Odo: revealed, so the app owns the description: no conflict');
  ok(r.out.includes("Odo D'Arcy: faction differs between card and app"), 'data mismatch reported (faction is the app\'s)');
  eq(r.code, 1);
});

await test('NPC push with a base (--baseline): vault-owned fields are planned without --yes, written with --yes, then settle', async () => {
  const env = await setup({ doc: npcDoc(), npcs: npcRows() });
  const p = await sync(env, ['push', '--baseline', '--only', 'npcs']);
  ok(p.report.planned.find((x) => x.id === 'npc_vell' && /description, spec/.test(x.what)), 'planned');
  ok(p.out.includes('run again with --yes'), 'says how to write');
  eq(appNpc(env, 'npc_vell').description, 'ZQXdesc An older app description', 'written without --yes');
  const w = await sync(env, ['push', '--yes', '--only', 'npcs']);
  const d = appNpc(env, 'npc_vell');
  eq(d.description, 'A barber with chalk on her sleeves.'); eq(d.spec.hair, 'bob');
  ok(w.report.pushed.find((x) => x.id === 'npc_vell'), 'reported');
  const again = await sync(env, ['push', '--yes', '--only', 'npcs']);
  eq(again.report.pushed.length + again.report.planned.length + again.report.conflicts.length, 0, 'not settled');
});

await test('NPC spec three-way merge: vault-only pushes, app-only stays, both changed -> conflict, app copy kept, nothing written', async () => {
  const env = await setup({ doc: npcDoc(), npcs: npcRows() });
  await sync(env, ['push', '--baseline', '--yes', '--only', 'npcs']);
  const fig = V.abs(env.vault, V.FIGURES + '/Vell Marrow.json');
  // app only
  env.exec.db.prepare("UPDATE npcs SET doc = json_set(doc, '$.spec.hair', 'crop') WHERE id = 'npc_vell'").run();
  const a = await sync(env, ['push', '--yes', '--only', 'npcs']);
  eq(appNpc(env, 'npc_vell').spec.hair, 'crop'); ok(a.out.includes('figure edited in the app only'));
  // both
  fs.writeFileSync(fig, JSON.stringify({ kit: '2.0.0', spec: { id: 'vell', shape: 'slim', hair: 'long', coat: 'apron' } }));
  const b = await sync(env, ['push', '--yes', '--only', 'npcs']);
  eq(appNpc(env, 'npc_vell').spec.hair, 'crop', 'app overwritten');
  ok(b.report.conflicts.find((c) => c.field === 'spec' && /both/.test(c.why)));
  ok(fs.readdirSync(path.join(env.priv, 'sync-conflicts')).some((f) => /^npc_vell-spec-app-[0-9a-f]{8}\.json$/.test(f)), 'app copy kept');
  // vault only (the app goes back to the base)
  env.exec.db.prepare("UPDATE npcs SET doc = json_set(doc, '$.spec.hair', 'bob') WHERE id = 'npc_vell'").run();
  await sync(env, ['push', '--yes', '--only', 'npcs']);
  eq(appNpc(env, 'npc_vell').spec.hair, 'long', 'vault edit not pushed');
});

await test('NPC description: the app owns it from the first reveal; name: the vault wins once there is a base', async () => {
  const env = await setup({ doc: npcDoc(), npcs: npcRows() });
  await sync(env, ['push', '--baseline', '--yes', '--only', 'npcs']);
  env.exec.db.prepare("UPDATE npcs SET doc = json_set(doc, '$.revealed', json('true'), '$.firstSeen', '2026-10-17T11:00:00.000Z', '$.description', 'ZQXapp Revealed wording', '$.name', 'vell marrow') WHERE id = 'npc_vell'").run();
  const r = await sync(env, ['push', '--yes', '--only', 'npcs']);
  const d = appNpc(env, 'npc_vell');
  eq(d.description, 'ZQXapp Revealed wording', 'vault description pushed after the reveal');
  eq(d.name, 'Vell Marrow', 'vault name not pushed');
  ok(r.out.includes('renamed in the app too; the vault wins'));
});

await test('NPC push: a change made in the app during the sync is not overwritten (server-side check), reported', async () => {
  const env = await setup({ doc: npcDoc(), npcs: npcRows() });
  await sync(env, ['push', '--baseline', '--only', 'npcs']);   // record the base, write nothing
  const inner = env.exec;
  let hit = false;
  const racing = { kind: 'memory', db: inner.db, batch: async (sql) => {
    if (!hit && /FROM npcs WHERE id = 'npc_vell'/.test(sql)) { hit = true; inner.db.prepare("UPDATE npcs SET doc = json_set(doc, '$.spec.hair', 'shaved'), updated_at = '2026-10-18T00:00:00.000Z' WHERE id = 'npc_vell'").run(); }
    return inner.batch(sql);
  } };
  const r = await sync({ ...env, exec: racing }, ['push', '--yes', '--only', 'npcs']);
  eq(appNpc(env, 'npc_vell').spec.hair, 'shaved', 'the app edit was overwritten');
  ok(r.report.conflicts.find((c) => c.npc === 'npc_vell' && /changed in the app during the sync/.test(c.why)));
});

await test('NPC names and table text stay out of sync-log.jsonl; table text stays out of the printout', async () => {
  const env = await setup({ doc: npcDoc(), npcs: npcRows() });
  const r1 = await sync(env, ['both'], { npcModule: fakeGen });
  const r2 = await sync(env, ['both', '--baseline', '--yes'], { npcModule: fakeGen });
  const log = logText(env);
  for (const m of MARKERS) ok(!r1.out.includes(m) && !r2.out.includes(m) && !log.includes(m), 'marker leaked');
  for (const n of NPC_NAMES) ok(!log.includes(n) && !log.includes(n.split(' ')[0]), 'NPC name in the log: ' + n);
});

// ======================================================================================================
// the pack (lib/sync-pack.mjs)
// ======================================================================================================
import { packIndex, shortHash as sh, cleanPart } from '../../functions/_lib/gm.js';
import { pieces } from '../../scripts/lib/sync-pack.mjs';
function writePack(env, extra = {}) {
  const rows = []; for (let i = 0; i < 400; i++) rows.push(['ZQXrow ' + i + ' "quoted" it\'s ✓ 東京 🙂', i]);
  const pk = { format: 1, exportedAt: T0, parts: {
    console: { src: { file: 'Tools/x.md', blockSha: 'aa' }, T: { a: [1, 2, 3] } },
    location: { src: { file: 'Tools/y.md', blockSha: 'bb' }, T: { rows } },
    campaign: { src: { file: 'z', blockSha: 'cc' }, npcs: [], ...extra },
  } };
  fs.mkdirSync(env.priv, { recursive: true });
  fs.writeFileSync(path.join(env.priv, 'b68-gm-pack.json'), JSON.stringify(pk));
  return pk;
}
const BUDGET = 9000;   // small pieces so the location part needs three

await test('pack: pieces never split a surrogate pair and rejoin exactly; a three-piece push reads back the server\'s version', async () => {
  const env = await setup({ doc: null });
  const pk = writePack(env);
  const body = cleanPart({ part: 'location', src: pk.parts.location.src, body: { T: pk.parts.location.T } }).body;
  const ps = pieces(body, BUDGET);
  eq(ps.length, 3, 'expected three pieces at this budget');
  eq(ps.join(''), body);
  ok(ps.every((p) => !/[\uD800-\uDBFF]$/.test(p)), 'split a surrogate pair');
  const dry = await sync(env, ['push', '--only', 'pack'], { pieceBudget: BUDGET });
  ok(dry.report.planned.find((x) => x.id === 'location' && /3 pieces/.test(x.what)), 'planned with three pieces');
  eq(env.exec.db.prepare('SELECT count(*) AS n FROM gm_pack').get().n, 0, 'written without --yes');
  const r = await sync(env, ['push', '--yes', '--only', 'pack'], { pieceBudget: BUDGET });
  eq(r.code, 0, r.out);
  const idx = await packIndex(asD1(env.exec), 'default');
  eq(idx.parts.location.version, await sh(body), 'server version = hash of the body as the API would store it');
  const back = env.exec.db.prepare("SELECT body FROM gm_pack WHERE part = 'location'").get().body;
  eq(back, body, 'stored body differs');
  eq(await sh(JSON.stringify(JSON.parse(back))), idx.parts.location.version, 'read-back hash');
  eq(r.report.chunks, 3 + 1 + 1, 'pieces written (location 3, console 1, campaign 1)');
  eq(env.exec.db.prepare('SELECT count(*) AS n FROM gm_sync_stage').get().n, 0, 'staging rows left');
  const again = await sync(env, ['push', '--yes', '--only', 'pack'], { pieceBudget: BUDGET });
  eq(again.report.chunks, 0, 'unchanged parts pushed again');
  eq(again.report.skipped.filter((s) => s.why === 'unchanged').length, 3);
});

await test('pack: a push that fails part-way leaves the old part in place and stops (exit 2)', async () => {
  const env = await setup({ doc: null });
  writePack(env);
  await sync(env, ['push', '--yes', '--only', 'pack'], { pieceBudget: BUDGET });
  const old = env.exec.db.prepare("SELECT version, body FROM gm_pack WHERE part = 'location'").get();
  writePack(env, {});
  const pk = JSON.parse(fs.readFileSync(path.join(env.priv, 'b68-gm-pack.json'), 'utf8'));
  pk.parts.location.T.rows.push(['ZQXnew row', 999]);
  fs.writeFileSync(path.join(env.priv, 'b68-gm-pack.json'), JSON.stringify(pk));
  let n = 0;
  const inner = env.exec;
  const flaky = { kind: 'memory', db: inner.db, batch: async (sql) => { if (/^UPDATE gm_sync_stage/.test(sql) && ++n === 2) throw new D1Error('fetch failed', 'offline'); return inner.batch(sql); } };
  const r = await sync({ ...env, exec: flaky }, ['push', '--yes', '--only', 'pack'], { pieceBudget: BUDGET });
  eq(r.code, 2);
  const now = env.exec.db.prepare("SELECT version, body FROM gm_pack WHERE part = 'location'").get();
  eq(now.version, old.version); eq(now.body, old.body);
  ok(/connection lost mid-run/.test(r.out));
  const fixed = await sync(env, ['push', '--yes', '--only', 'pack'], { pieceBudget: BUDGET });
  eq(fixed.code, 0);
  ok(env.exec.db.prepare("SELECT body FROM gm_pack WHERE part = 'location'").get().body.includes('ZQXnew row'), 'the retry landed');
});

await test('pack: a server part the file lacks is left alone; a bad part name is refused; no pack file -> nothing', async () => {
  const env = await setup({ doc: null });
  const none = await sync(env, ['push', '--yes', '--only', 'pack']);
  ok(/pack: no pack at/.test(none.out));
  writePack(env);
  env.exec.db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('default', 'extra', 'v', '{}', 1, '{}')").run();
  const pk = JSON.parse(fs.readFileSync(path.join(env.priv, 'b68-gm-pack.json'), 'utf8'));
  pk.parts['Bad Name'] = { src: {}, T: {} };
  fs.writeFileSync(path.join(env.priv, 'b68-gm-pack.json'), JSON.stringify(pk));
  const r = await sync(env, ['push', '--yes', '--only', 'pack']);
  ok(env.exec.db.prepare("SELECT count(*) AS n FROM gm_pack WHERE part = 'extra'").get().n === 1, 'extra part deleted');
  ok(/server has a part "extra"/.test(r.out));
  ok(r.report.refused.find((x) => x.target === 'pack:Bad Name'));
  for (const m of MARKERS) ok(!r.out.includes(m) && !logText(env).includes(m));
});

await test('the core ships alone: with the NPC and pack modules absent the pull still runs and says so', async () => {
  const env = await setup();
  const core = fs.mkdtempSync(path.join(os.tmpdir(), 'b68 core '));
  const files = ['scripts/gm-sync.mjs', 'scripts/lib/d1.mjs', 'scripts/lib/vault.mjs', 'scripts/lib/ledger.mjs', 'scripts/lib/report.mjs', 'scripts/lib/sync-notes.mjs', 'functions/_lib/gm.js', 'functions/_lib/http.js'];
  for (const f of files) { fs.mkdirSync(path.dirname(path.join(core, f)), { recursive: true }); fs.copyFileSync(path.join(ROOT, f), path.join(core, f)); }
  const { pathToFileURL } = await import('node:url');
  const m = await import(pathToFileURL(path.join(core, 'scripts', 'gm-sync.mjs')).href);
  const out = [];
  const r = await m.run({ ...m.parseArgs(['both', '--yes']), vault: env.vault, privateDir: env.priv, exec: env.exec, root: core, now: Date.parse('2026-10-18T01:00:00.000Z'), print: (s) => out.push(s) });
  ok(r.report.filed.length >= 8, 'the core did not file');
  ok(out.join('\n').includes('NPC sync is not installed') && out.join('\n').includes('pack push is not installed'), 'absence not reported');
});

console.log((failed ? 'FAILED ' : 'ok ') + passed + ' passed, ' + failed + ' failed');
if (failed) process.exitCode = 1;
