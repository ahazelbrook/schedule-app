// After the game in one command (scripts/gm-after.mjs): which session, the transcript left on the server, the pull, the two
// transcripts side by side, prune, and the table's session counter. In memory D1 and a temp vault; everything made up.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { run, parseArgs, whichSession, transcriptStats } from '../../scripts/gm-after.mjs';
import { newNote } from '../../scripts/gm-transcript.mjs';
import { cleanLines, addLines, readLines, patchStt, cleanSttPatch } from '../../functions/_lib/stt.js';
import { patchState } from '../../functions/_lib/gm.js';
import { writeCampaign, loadCampaignRow, campaignDoc } from '../../functions/_lib/campaign.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const S = 'Wiki/Games/Blades in the Dark/Campaigns/Group/Sessions';
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const NOTE = (n, date) => '---\nwiki: log\nsession: ' + n + '\ndate: ' + date + '\n---\n# Session ' + n + '\n\n## Names\n\n## Loose ends\n\n## Moments\n\n## Rolled at the table\n';
const SUN = Date.parse('2026-10-17T23:30:00.000Z');          // 10:30 on Sun 18/10 in Melbourne
async function setup() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-after-'));
  const vault = path.join(base, 'vault'), priv = path.join(base, 'priv'), dir = path.join(vault, ...S.split('/'));
  fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(priv);
  fs.writeFileSync(path.join(dir, 'b68g-s01.md'), NOTE(1, '03/10/2026'));
  fs.writeFileSync(path.join(dir, 'b68g-s02.md'), NOTE(2, '17/10/2026'));
  fs.writeFileSync(path.join(dir, 'b68g-s03.md'), NOTE(3, '"[TODO: session date]"'));
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  exec.db.exec('DELETE FROM npcs');
  const db = asD1(exec);
  return { base, vault, priv, dir, exec, db };
}
async function after(env, args, extra = {}) {
  const out = [];
  const r = await run({ ...parseArgs(args), vault: env.vault, privateDir: env.priv, exec: env.exec, db: env.db, campaign: 'default', now: SUN, host: 'DESK', print: (s) => out.push(s), ...extra });
  return { ...r, out: out.join('\n') };
}

await test('which session: --session; else the note dated last night (Sunday morning finds Saturday); else the highest', async () => {
  const env = await setup();
  assert.equal(whichSession(env.vault, undefined, SUN).note.name, 'b68g-s02.md');
  assert.equal(whichSession(env.vault, 1, SUN).note.name, 'b68g-s01.md');
  assert.match(whichSession(env.vault, 7, SUN).error, /no note for session 7/);
  assert.equal(whichSession(env.vault, undefined, Date.parse('2026-11-01T02:00:00.000Z')).note.name, 'b68g-s03.md', 'nothing dated: the highest');
  assert.throws(() => parseArgs(['--prune']), /needs --yes/);
});

await test('the plan writes nothing; --yes copies the transcript (not twice), pulls captures into s02, compares, and lines up the counter', async () => {
  const env = await setup();
  await patchState(env.db, 'default', { capture: { c1: { id: 'c1', bucket: 'n', text: 'ZQX Harl the clerk', at: '2026-10-17T09:30:00.000Z' } } });
  await addLines(env.db, 'default', cleanLines({ lines: [
    { id: 'a', at: '2026-10-17T09:30:00.000Z', session: '', conn: 'c', speaker: 0, text: 'ZQX one' },
    { id: 'b', at: '2026-10-17T09:31:00.000Z', session: '', conn: 'c', speaker: 1, text: 'ZQX two' },
  ] }));
  await patchStt(env.db, 'default', cleanSttPatch({ want: 'off', speakers: { 0: 'Alex (GM)' } }, 'gm'));
  fs.writeFileSync(path.join(env.dir, 'b68g-s02-transcript.md'), '---\nstatus: done\n---\n## Transcript\n- **[20:30] Alex:** laptop line\n- **[20:31] Pat:** another\n');
  const before = fs.readdirSync(env.dir).map((f) => f + fs.readFileSync(path.join(env.dir, f), 'utf8')).join('|');
  const plan = await after(env, []);
  assert.equal(plan.code, 0, plan.out);
  assert.equal(fs.readdirSync(env.dir).map((f) => f + fs.readFileSync(path.join(env.dir, f), 'utf8')).join('|'), before, 'the plan wrote the vault');
  assert.match(plan.out, /1\. Session 2 \(b68g-s02, dated 17\/10\/2026\)/);
  assert.match(plan.out, /would copy 2 lines into b68g-s02-transcript-ipad\.md/);
  assert.match(plan.out, /the table says session 0; the vault's highest note is session 3/);
  const done = await after(env, ['--yes', '--counter', '2']);
  assert.equal(done.code, 0, done.out);
  const ipad = fs.readFileSync(path.join(env.dir, 'b68g-s02-transcript-ipad.md'), 'utf8');
  assert.ok(/Alex \(GM\):\*\* ZQX one/.test(ipad) && /S1:\*\* ZQX two/.test(ipad));
  assert.ok(fs.readFileSync(path.join(env.dir, 'b68g-s02.md'), 'utf8').includes('ZQX Harl the clerk ^b68-c1'), 'the capture went to the note dated that night');
  assert.match(done.out, /the laptop \(Obsidian transcriber\): 2 lines, 20:30-20:31; named: 2/);
  assert.match(done.out, /the iPad: 2 lines, 20:30-20:31; named: 1; unnamed: S1/);
  assert.match(done.out, /set the table's counter to 2/);
  assert.equal(campaignDoc(await loadCampaignRow(env.db, 'default')).session.number, 2);
  const again = await after(env, ['--yes']);
  assert.match(again.out, /nothing waiting on the server|copied 0 lines/);
  assert.equal(fs.readFileSync(path.join(env.dir, 'b68g-s02-transcript-ipad.md'), 'utf8'), ipad, 'not copied twice');
  await after(env, ['--yes', '--prune']);
  assert.equal((await readLines(env.db, 'default', {})).lines.length, 0, 'pruned once in the vault');
  for (const o of [plan.out, done.out]) assert.ok(!/ZQX/.test(o), 'text in the printout');
});

await test('listening still on: the transcript step says stop first; the other PC already copied: those lines are not copied again', async () => {
  const env = await setup();
  await patchStt(env.db, 'default', cleanSttPatch({ want: 'on' }, 'gm'));
  const r = await after(env, ['--yes']);
  assert.match(r.out, /listening is still ON/);
  await patchStt(env.db, 'default', cleanSttPatch({ want: 'off' }, 'gm'));
  await addLines(env.db, 'default', cleanLines({ lines: [{ id: 'a', at: '2026-10-17T09:30:00.000Z', session: '2', conn: 'c', speaker: 0, text: 'ZQX old' }] }));
  env.exec.db.prepare("UPDATE gm_stt SET doc = json_set(doc, '$.copier', json(?)) WHERE campaign = 'default'").run(JSON.stringify({ host: 'LAPTOP', at: '2026-10-17T12:00:00.000Z', last: 1 }));
  const r2 = await after(env, ['--yes']);
  assert.match(r2.out, /nothing waiting on the server/);
  assert.ok(!fs.existsSync(path.join(env.dir, 'b68g-s02-transcript-ipad.md')) && !fs.existsSync(path.join(env.dir, 'b68g-s02-transcript.md')));
});

await test('transcript stats: lines, first and last, named and unnamed speakers', async () => {
  const st = transcriptStats(newNote('2', {}, '2026-10-17T09:30:00.000Z') + '- **[20:30] S0:** a\n*[20:31] — reconnected*\n- **[20:40] Pat (Vex):** b\n- **[21:02] ?:** c\n');
  assert.deepEqual(st, { lines: 3, first: '20:30', last: '21:02', speakers: ['Pat (Vex)'], unnamed: ['?', 'S0'] });
  assert.equal(transcriptStats(null), null);
});

console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\nALL PASSED (${passed})`);
process.exit(failed ? 1 : 0);
