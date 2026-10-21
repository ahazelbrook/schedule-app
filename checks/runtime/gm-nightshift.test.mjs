// The Night Shift (scripts/lib/nightshift.mjs, step 3c of scripts/gm-after.mjs). A mocked Claude client, in-memory D1, a temp
// vault, an invented transcript: no network, no key, no campaign text.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { run, parseArgs } from '../../scripts/gm-after.mjs';
import { parseTranscript, chunkLines, runNightShift, renderDraft, applyDraft, findDraft, rollStats, rollsTable, HEADING, parseAppRolls, appRollsFrom, mergeRolls, xpCandidates, xpLines, applyApp, sourceStats } from '../../scripts/lib/nightshift.mjs';
import { captureLine } from '../../scripts/lib/sync-notes.mjs';
import { SEATS, ROLL_SCHEMA } from '../../functions/_lib/assist/seats.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const S = 'Wiki/Games/Blades in the Dark/Campaigns/Group/Sessions';
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

// An invented evening: 19:30 to 21:15, two hour-long chunks.
const TRANSCRIPT = [
  '---', 'status: done', '---', '## Transcript',
  '- **[19:30] Ana:** Zed the fixer lifts the latch.',
  '- **[19:41] Bo:** I skulk past, desperate, I have two dots, push it.',
  '- **[20:35] Ana:** Zero dots in Study, risky, rolling two and taking the lowest.',
  '- **[21:15] Bo:** That is us for tonight.',
].join('\n');

const ROLLS_A = [
  { at: '[19:41]', who: 'Bo', action: 'skulk past the guard', position: 'desperate', effect: 'standard', dots: 2, pushed: true, result: 'partial' },
  { at: '[19:50]', who: 'Cy', action: 'a hunch', position: 'unclear', effect: 'unclear', dots: -1, pushed: false, result: 'unclear' },
];
const ROLLS_B = [{ at: '[20:35]', who: 'Ana', action: 'study the ledger', position: 'risky', effect: 'limited', dots: 0, pushed: false, result: 'full' }];
const SECTIONS = { session_log: 'Log text', xp_per_pc: 'Bo: desperate roll [19:41]', feedback_card: 'Card', group_chat: 'Chat', previously_on: 'Recap', prep_skeleton: 'Skeleton' };

function mockClient({ sorterOut = 0, writerOut = 0, rolls = [ROLLS_A, ROLLS_B], sections = SECTIONS, nojson = false } = {}) {
  const calls = []; let n = 0;
  const respond = (p) => {
    calls.push(p);
    const props = p.output_config.format.schema.properties;
    let obj, usage = { input_tokens: 1000, output_tokens: 500 };
    if (props.chunk_summary) { obj = { chunk_summary: 's', names: [], ledger: [], loose_ends: [], clocks_owed: [], rolls: rolls[n++ % rolls.length] }; usage.output_tokens = sorterOut || 500; }
    else { obj = { ...sections, rolls: ROLLS_B }; usage.output_tokens = writerOut || 500; }
    return { content: [{ type: 'text', text: nojson ? '' : JSON.stringify(obj) }], usage, stop_reason: nojson ? 'max_tokens' : 'end_turn' };
  };
  return { calls, messages: { create: async (p) => respond(p), stream: (p) => ({ finalMessage: async () => respond(p) }) } };
}

const NOTE = '---\nwiki: log\nsession: 9\ndate: 03/03/2031\n---\n# Session 9\n\n## Names\n\n## Moments\n\n## Rolled at the table\n\n## Tail\nlast words\n';
const SUN = Date.parse('2031-03-03T12:00:00.000Z');
async function setup(note = NOTE) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'b68-ns-'));
  const vault = path.join(base, 'vault'), priv = path.join(base, 'priv'), dir = path.join(vault, ...S.split('/'));
  fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(priv);
  fs.writeFileSync(path.join(dir, 'b68g-s09.md'), note);
  fs.writeFileSync(path.join(dir, 'b68g-s09-transcript-ipad.md'), TRANSCRIPT);
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  exec.db.exec('DELETE FROM npcs');
  return { base, vault, priv, dir, exec, db: asD1(exec), file: path.join(dir, 'b68g-s09.md') };
}
async function after(env, args, extra = {}) {
  const out = [];
  const r = await run({ ...parseArgs(args), vault: env.vault, privateDir: env.priv, exec: env.exec, db: env.db, campaign: 'default', now: SUN, host: 'DESK', print: (s) => out.push(s), ...extra });
  return { ...r, out: out.join('\n') };
}
const read = (f) => fs.readFileSync(f, 'utf8');
const count = (s, re) => (s.match(re) || []).length;

await test('the sorter asks for every roll field: acting character, action, position, effect, dots (zero-dot too), pushed, result', () => {
  assert.deepEqual([...ROLL_SCHEMA.required].sort(), ['action', 'at', 'dots', 'effect', 'position', 'pushed', 'result', 'who']);
  assert.deepEqual(ROLL_SCHEMA.properties.position.enum, ['controlled', 'risky', 'desperate', 'unclear']);
  assert.equal(ROLL_SCHEMA.properties.dots.type, 'integer');
  assert.deepEqual(SEATS.sorter.schema.properties.rolls.items, ROLL_SCHEMA);
  assert.ok(SEATS.sorter.schema.required.includes('rolls'));
  assert.deepEqual(SEATS.nightshift_single.schema.properties.rolls.items, ROLL_SCHEMA);
  assert.match(SEATS.sorter.instructions, /zero-dot/);
  assert.match(SEATS.writer.instructions, /XP is manual/);
});

await test('transcript lines parse; the clock wraps past midnight; chunks are hour-long', () => {
  const l = parseTranscript(TRANSCRIPT);
  assert.equal(l.length, 4);
  const ch = chunkLines(l);
  assert.deepEqual(ch.map((c) => c.from), ['19:30', '20:30']);
  const w = parseTranscript('- **[23:50] A:** one\n- **[00:10] B:** two\n');
  assert.equal(w[1].t - w[0].t, 20);
  assert.equal(chunkLines(w).length, 1);
});

await test('two-stage: sorters keep each roll\'s position and dots, the writer is told them, and the stats count them', async () => {
  const client = mockClient();
  const r = await runNightShift({ client, prefix: 'PFX', lines: parseTranscript(TRANSCRIPT), maxSpend: 3 });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.rolls.length, 3);
  const s = rollStats(r.rolls);
  assert.deepEqual([s.total, s.positioned, s.withDots, s.complete, s.zeroDot, s.pushed], [3, 2, 2, 2, 1, 1]);
  const writer = client.calls.find((c) => c.max_tokens === SEATS.writer.maxTokens);
  const sent = JSON.stringify(writer.messages);
  assert.match(sent, /desperate/); assert.match(sent, /dots[^0-9-]+0[^0-9]/);
  assert.equal(client.calls.filter((c) => c.max_tokens === SEATS.sorter.maxTokens).length, 2);
  const table = rollsTable(r.rolls);
  assert.match(table, /\| Bo \| skulk past the guard \| desperate \| standard \| 2 \| yes \| partial \|/);
  assert.match(table, /0 \(zero-dot\)/);
});

await test('the draft marks xp as manual and has one heading with no stray ## inside', () => {
  const r = { mode: 'two-stage', spend: 0.5, rolls: ROLLS_A, sections: { ...SECTIONS, session_log: '# Big title\n## Another\nbody' } };
  const block = renderDraft(r, { date: '04/03/2031', session: 9 });
  assert.equal(count(block, /^## /gm), 1);
  assert.match(block, /^## Night Shift draft/);
  assert.match(block, /XP is manual/);
  assert.match(block, /Candidates only\. XP is the GM's to mark/);
  assert.match(block, /### XP candidates/);
  assert.match(block, /Rolls \(2; 1 with position and dots\)/);
  assert.doesNotMatch(block, /^#{1,2} (Big|Another)/m);
});

await test('filing: appended once, a second run leaves it alone, --force replaces only its own block', () => {
  const block1 = renderDraft({ mode: 'single', spend: 1, rolls: [], sections: SECTIONS }), block2 = block1.replace('Log text', 'Newer log');
  const a = applyDraft(NOTE, block1);
  assert.equal(a.action, 'added');
  assert.equal(count(a.text, /^## Night Shift draft/gm), 1);
  assert.ok(a.text.startsWith(NOTE.trimEnd()), 'the note above is untouched');
  const b = applyDraft(a.text, block2);
  assert.equal(b.action, 'present'); assert.equal(b.text, a.text);
  assert.ok(findDraft(a.text) && !findDraft(NOTE));
  // a heading after the block survives a forced replace
  const withAfter = a.text + '\n## After\nkeep me\n';
  const c = applyDraft(withAfter, block2, { force: true });
  assert.equal(c.action, 'replaced');
  assert.equal(count(c.text, /^## Night Shift draft/gm), 1);
  assert.match(c.text, /Newer log/); assert.doesNotMatch(c.text, /\nLog text\n/);
  assert.match(c.text, /## After\nkeep me/); assert.match(c.text, /## Tail\nlast words/);
  // CRLF notes keep CRLF
  const crlf = applyDraft(NOTE.replace(/\n/g, '\r\n'), block1).text;
  assert.equal(count(crlf, /[^\r]\n/g), 0);
});

await test('the spend cap stops cleanly: after the sorters (no writer), and a one-call variant too big for the cap', async () => {
  const lines = parseTranscript(TRANSCRIPT);
  const big = mockClient({ sorterOut: 8e6 });                           // ~$4 per sorter on Haiku output rates
  const r = await runNightShift({ client: big, prefix: 'PFX', lines, maxSpend: 3 });
  assert.equal(r.ok, false); assert.equal(r.stopped, 'cap'); assert.match(r.reason, /writer did not run/);
  assert.equal(big.calls.filter((c) => c.max_tokens === SEATS.writer.maxTokens).length, 0, 'the writer never ran');
  assert.ok(r.sorted && r.spend > 3, 'what was spent is reported and the sorters\' notes are kept');
  const huge = mockClient();
  const s = await runNightShift({ client: huge, prefix: 'x'.repeat(2e6), lines, mode: 'single', maxSpend: 3 });
  assert.equal(s.stopped, 'cap'); assert.equal(huge.calls.length, 0, 'nothing was sent');
  const none = await runNightShift({ client: mockClient({ nojson: true }), prefix: 'PFX', lines, maxSpend: 3 });
  assert.equal(none.stopped, 'nojson');
});

await test('gm:after skips the step without a key, and with --no-nightshift, writing and spending nothing', async () => {
  const env = await setup(), before = read(env.file);
  const client = mockClient();
  const nokey = await after(env, ['--yes'], { env: {}, prefix: 'PFX' });
  assert.equal(nokey.code, 0, nokey.out);
  assert.match(nokey.out, /3c\. Night Shift\n\s+skipped: B68_ANTHROPIC_KEY is not set/);
  const flag = await after(env, ['--yes', '--no-nightshift'], { env: { B68_ANTHROPIC_KEY: 'k' }, client, prefix: 'PFX' });
  assert.match(flag.out, /skipped \(--no-nightshift\)/);
  assert.equal(client.calls.length, 0);
  assert.doesNotMatch(read(env.file), /Night Shift draft/);
  assert.equal(read(env.file).includes(before.trimEnd()), true);
  assert.match(nokey.out, /4\. Transcripts for session 9/, 'the rest of gm:after still ran');
});

await test('gm:after: the plan spends nothing; --yes files one heading; a second run is skipped before any call; --nightshift-force replaces', async () => {
  const env = await setup();
  const client = mockClient();
  const ex = { env: { B68_ANTHROPIC_KEY: 'k' }, client, prefix: 'PFX' };
  const plan = await after(env, [], ex);
  assert.match(plan.out, /would draft b68g-s09's paperwork from 4 transcript lines/);
  assert.equal(client.calls.length, 0); assert.doesNotMatch(read(env.file), /Night Shift/);
  const go = await after(env, ['--yes'], ex);
  assert.equal(go.code, 0, go.out);
  assert.match(go.out, /filed "## Night Shift draft" in b68g-s09: 3 rolls \(2 with position and dots\)/);
  const t1 = read(env.file), calls1 = client.calls.length;
  assert.equal(count(t1, /^## Night Shift draft/gm), 1);
  assert.match(t1, /XP is manual/);
  assert.ok(t1.indexOf('## Tail') < t1.indexOf('## Night Shift draft'), 'appended at the end');
  const again = await after(env, ['--yes'], ex);
  assert.match(again.out, /already has "## Night Shift draft": skipped, nothing spent/);
  assert.equal(client.calls.length, calls1, 'no second spend'); assert.equal(read(env.file), t1);
  const forced = await after(env, ['--yes', '--nightshift-force', '--nightshift-mode', 'single'], ex);
  assert.match(forced.out, /replaced "## Night Shift draft"/);
  assert.equal(count(read(env.file), /^## Night Shift draft/gm), 1);
  assert.ok(read(env.file).includes('## Tail\nlast words'));
});

await test('gm:after with a cap too low stops cleanly: exit 0, nothing filed, the sorters\' notes kept in gm-private', async () => {
  const env = await setup();
  const client = mockClient({ sorterOut: 8e6 });
  const r = await after(env, ['--yes', '--nightshift-cap', '1'], { env: { B68_ANTHROPIC_KEY: 'k' }, client, prefix: 'PFX' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /stopped: the sorters used \$.* and the cap is \$1\.00/);
  assert.doesNotMatch(read(env.file), /Night Shift draft/);
  assert.ok(fs.existsSync(path.join(env.priv, 'nightshift-s9-partial.json')));
  assert.throws(() => parseArgs(['--nightshift-cap', '0']), /dollar amount/);
});

// ---- the app's own roll records win; the speech fills the gaps ----------------------------------------------------------------
// An invented note in the format gm:pull writes: "- **HH:MM** Title: lead ^b68-id" under "## Rolled at the table".
const APP_NOTE = [
  '---', 'wiki: log', 'session: 9', 'date: 03/03/2031', '---', '# Session 9', '',
  '## Names', '', '## Rolled at the table', '',
  '- **19:41** A 4/5: The latch gives, and the noise carries. ^b68-aaa111',
  '- **19:55** Before the roll: Want +1d? Your lamp gutters. ^b68-bbb222',
  '- **20:36** A 1–3 (desperate → 3 winds · harm 3): A guard turns. ^b68-ccc333',
  '- **21:05** Downtime: Lie low ^b68-ddd444',
  '- **21:10** A 4/5: Somebody notices. ^b68-eee555', '',
  '**From the transcript** (hand-written, not the app\'s):', '',
  '| Who | What | Result |', '|---|---|---|', '| Cy | A table row | 6 |', '',
  '## Moments', '', '- **19:41** A 4/5: not under the rolled heading ^b68-fff666', '',
].join('\n');
const sp = (o) => ({ at: '[19:41]', who: 'Bo', action: 'skulk past', position: 'desperate', effect: 'standard', dots: 2, pushed: false, result: 'partial', ...o });

await test('app records: only the Rolled-at-the-table bullets that carry a result band count; the rest are skipped', () => {
  const a = parseAppRolls(APP_NOTE);
  assert.deepEqual(a.map((x) => [x.at, x.result, x.position]), [['[19:41]', 'partial', ''], ['[20:36]', 'miss', 'desperate'], ['[21:10]', 'partial', '']]);
  assert.equal(appRollsFrom(APP_NOTE).others, 2, 'Before the roll and Downtime are not rolls');
  assert.deepEqual(parseAppRolls(NOTE), [], 'an empty section gives none');
  assert.deepEqual(parseAppRolls(APP_NOTE.replace(/\n/g, '\r\n')).length, 3, 'CRLF notes read the same');
});

await test('app records: the bracket the page writes ("A 4/5 (risky, standard, Name)") gives position, effect and PC; gm:pull files it unchanged', () => {
  const page = 'A 1–3 (desperate, Invented Pip): A guard turns.', page2 = 'A 4/5 (risky, standard, Invented Pip): The latch gives.', plain = 'A 4/5 (risky): Noise.';
  const note = '## Rolled at the table\n\n' + [page, page2, plain].map((t, i) => captureLine({ at: '2031-03-03T09:0' + i + ':00Z', text: t, bid: 'b68-x' + i })).join('\n') + '\n';
  assert.match(note, /A 4\/5 \(risky, standard, Invented Pip\): The latch gives\. \^b68-x1/, 'the bracket survives the pull\'s own line builder');
  const a = parseAppRolls(note);
  assert.deepEqual(a.map((x) => [x.result, x.position, x.effect, x.who]), [['miss', 'desperate', '', 'Invented Pip'], ['partial', 'risky', 'standard', 'Invented Pip'], ['partial', 'risky', '', '']]);
  const m = mergeRolls([sp({ at: '[00:00]', who: 'Invented Pip', result: 'unclear', position: 'unclear', effect: 'unclear' })], [{ ...a[0], at: '[00:01]', t: 1 }]);
  assert.equal(m.length, 1); assert.deepEqual([m[0].src, m[0].position, m[0].who], ['app+speech', 'desperate', 'Invented Pip']);
  assert.match(renderDraft({ mode: 'two-stage', spend: 0, rolls: m, sections: SECTIONS }), /Action rolls only: drop resistance and fortune rolls by hand/);
});

await test('merge: the app wins every field it states; the speech fills the rest and is never allowed to overwrite', () => {
  const m = mergeRolls([sp({ at: '[19:42]', result: 'full', who: 'Bo' })], [{ at: '[19:41]', t: 19 * 60 + 41, who: '', position: '', result: 'partial', card: 'A 4/5' }]);
  assert.equal(m.length, 2, 'speech said full, the app said partial: the speech is a different roll, the app row stands alone');
  const m2 = mergeRolls([sp({ at: '[19:42]', result: 'unclear' })], [{ at: '[19:41]', t: 19 * 60 + 41, who: '', position: 'risky', result: 'partial', card: 'A 4/5' }]);
  assert.equal(m2.length, 1);
  assert.equal(m2[0].src, 'app+speech');
  assert.equal(m2[0].result, 'partial', 'the app fills the result');
  assert.equal(m2[0].position, 'risky', 'the app\'s position beats the spoken desperate');
  assert.equal(m2[0].dots, 2, 'dots only the speech had survive'); assert.equal(m2[0].who, 'Bo'); assert.deepEqual(m2[0].app, ['position', 'result']);
});

await test('merge: matched by time within 2 minutes (and by character when the app names one); nearest wins; one-to-one', () => {
  const app = (t, extra = {}) => ({ at: '[19:' + t + ']', t: 19 * 60 + t, who: '', position: '', result: 'partial', card: 'A 4/5', ...extra });
  const near = mergeRolls([sp({ at: '[19:39]', result: 'unclear' }), sp({ at: '[19:43]', who: 'Cy', result: 'unclear' })], [app(41)]);
  assert.equal(near.filter((r) => r.src === 'app+speech').length, 1);
  assert.equal(near.find((r) => r.src === 'app+speech').at, '[19:39]', 'two minutes either side, the first nearest wins');
  const far = mergeRolls([sp({ at: '[19:44]', result: 'unclear' })], [app(41)]);
  assert.deepEqual(far.map((r) => r.src).sort(), ['app', 'speech'], 'three minutes apart: not the same roll');
  const named = mergeRolls([sp({ at: '[19:41]', who: 'Cy', result: 'unclear' }), sp({ at: '[19:42]', who: 'Bo', result: 'unclear' })], [app(41, { who: 'Bo' })]);
  assert.equal(named.find((r) => r.src === 'app+speech').who, 'Bo', 'the app named Bo, so Cy\'s nearer roll is not taken');
  const two = mergeRolls([sp({ at: '[19:41]', result: 'unclear' })], [app(41), app(42)]);
  assert.deepEqual(two.map((r) => r.src).sort(), ['app', 'app+speech'], 'a spoken roll is claimed once');
  assert.equal(mergeRolls([sp({ at: '[00:01]', result: 'unclear' })], [{ at: '[23:59]', t: 23 * 60 + 59, who: '', position: '', result: 'miss', card: 'A 1-3' }])[0].src, 'app+speech', 'across midnight');
  assert.deepEqual(mergeRolls([], []), []); assert.equal(mergeRolls([sp()], undefined)[0].src, 'speech');
});

await test('xp candidates by code: desperate rolls and zero-dot rolls from the merged table, with their source; unknown dots are not zero', () => {
  const merged = mergeRolls([sp({ at: '[20:35]', who: 'Ana', position: 'risky', dots: 0, result: 'unclear', action: 'study' }), sp({ at: '[19:50]', who: 'Cy', position: 'unclear', dots: -1, result: 'unclear' }), sp({ at: '[21:00]', who: 'Bo', position: 'desperate', dots: 0, result: 'miss' })],
    [{ at: '[20:36]', t: 20 * 60 + 36, who: '', position: 'desperate', result: 'partial', card: 'A 1-3' }]);
  const xp = xpCandidates(merged);
  assert.deepEqual(xp.map((x) => [x.who, x.kind, x.src]), [['Ana', 'desperate', 'app+speech'], ['Ana', 'zero-dot', 'app+speech'], ['Bo', 'desperate', 'speech'], ['Bo', 'zero-dot', 'speech']]);
  const text = xpLines(xp);
  assert.match(text, /\*\*Ana\*\* \(2\)/); assert.match(text, /\[21:00\] zero-dot roll/);
  assert.match(xpLines([]), /none/);
});

await test('the draft names each roll\'s source and splits the xp section into code-computed and judgement', () => {
  const r = applyApp({ mode: 'two-stage', spend: 0.5, rolls: [sp({ at: '[19:42]', result: 'unclear' }), sp({ at: '[22:00]', who: 'Cy', position: 'risky', dots: 0 })], sections: SECTIONS }, parseAppRolls(APP_NOTE));
  const block = renderDraft(r, { date: '04/03/2031', session: 9 });
  assert.match(block, /\| Source \|/);
  assert.match(block, /\| partial \| app\+speech \|/); assert.match(block, /\| speech \|\n?/);
  assert.equal(count(block, /\| app \|$/gm), 2, 'the two app-only cards are rows of their own');
  assert.match(block, /Rolls \(4;/); assert.match(block, /3 recorded by the app, 2 heard in the speech/);
  assert.match(block, /\*\*Computed from the rolls table \(/); assert.match(block, /\*\*From the transcript \(judgement\):\*\*/);
  assert.match(block, /Candidates only\. XP is the GM's to mark/);
  assert.equal(count(block, /^## /gm), 1);
});

await test('two-stage run: app rolls are merged before the writer, which is told the merged table and not to list code-computed xp', async () => {
  const client = mockClient({ rolls: [[sp({ at: '[19:42]', result: 'unclear', position: 'unclear', dots: 1 })], []] });
  const r = await runNightShift({ client, prefix: 'PFX', lines: parseTranscript(TRANSCRIPT), maxSpend: 3, appRolls: parseAppRolls(APP_NOTE) });
  assert.equal(r.ok, true, r.reason);
  assert.deepEqual(sourceStats(r.rolls), { app: 2, speech: 0, both: 1 });
  assert.equal(r.rolls.find((x) => x.src === 'app+speech').result, 'partial');
  assert.deepEqual(r.xp.map((x) => x.kind), ['desperate'], 'the 20:36 card said desperate');
  const sent = JSON.stringify(client.calls.find((c) => c.max_tokens === SEATS.writer.maxTokens).messages);
  assert.match(sent, /merged_rolls/); assert.match(sent, /computed by code/); assert.match(sent, /playbook and crew xp/);
  const none = await runNightShift({ client: mockClient(), prefix: 'PFX', lines: parseTranscript(TRANSCRIPT), maxSpend: 3 });
  assert.equal(none.ok, true); assert.deepEqual(sourceStats(none.rolls), { app: 0, speech: 3, both: 0 }, 'no app rolls: today\'s behaviour');
});

await test('gm:after: the note\'s Rolled-at-the-table cards reach the draft; the vault note above is untouched and the report counts sources', async () => {
  const env = await setup(APP_NOTE);
  const client = mockClient({ rolls: [[sp({ at: '[19:42]', result: 'unclear', position: 'unclear', dots: 1 })], []] });
  const go = await after(env, ['--yes'], { env: { B68_ANTHROPIC_KEY: 'k' }, client, prefix: 'PFX' });
  assert.equal(go.code, 0, go.out);
  assert.match(go.out, /rolls by source: 2 app only, 1 app and speech, 0 speech only; 1 XP candidate computed by code/);
  const t = read(env.file);
  assert.ok(t.startsWith(APP_NOTE.trimEnd()), 'everything above the draft is as it was');
  assert.match(t, /\| app\+speech \|/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
