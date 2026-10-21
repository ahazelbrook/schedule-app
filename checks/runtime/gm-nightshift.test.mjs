// The Night Shift (scripts/lib/nightshift.mjs, step 3c of scripts/gm-after.mjs). A mocked Claude client, in-memory D1, a temp
// vault, an invented transcript: no network, no key, no campaign text.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { run, parseArgs } from '../../scripts/gm-after.mjs';
import { parseTranscript, chunkLines, runNightShift, renderDraft, applyDraft, findDraft, rollStats, rollsTable, HEADING } from '../../scripts/lib/nightshift.mjs';
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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
