// The Clerk's memory (S3; design 2.4): the names it raised tonight, and the NPCs touched in the last 12 hours, ride in its turn as
// "Already noted tonight", and the Editor drops a Clerk card whose new names are all known (accents and case ignored; one edit apart
// counts as the same name for names of 5 letters or more). Fake `call`, in-memory D1, no network and no key. Every name is invented.
//   node checks/runtime/gm-assist-clerk.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { cleanLines, addLines } from '../../functions/_lib/stt.js';
import { SEATS } from '../../functions/_lib/assist/seats.js';
import { clerkUser } from '../../functions/_lib/assist/prompts.js';
import { toCandidate, merge, isKnownName, foldName } from '../../functions/_lib/assist/editor.js';
import { makeHandler } from '../../functions/api/gm/assist.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

// ---------- the matching ----------
await test('foldName: accents stripped, lower case, punctuation collapsed', () => {
  assert.equal(foldName('  BARNÈK-Vane  '), 'barnek vane');
  assert.equal(foldName("O'Hara"), 'o hara');
  assert.equal(foldName(null), '');
});

await test('isKnownName: Varnek / Barnek / BARNEK are one name; short names need an exact (folded) match; unrelated names pass', () => {
  assert.equal(isKnownName('Varnek', ['Barnek']), true);
  assert.equal(isKnownName('BARNEK', ['Varnek']), true);
  assert.equal(isKnownName('Barnèk', ['barnek']), true, 'accents ignored');
  assert.equal(isKnownName('Barnek', ['Barnek']), true);
  assert.equal(isKnownName('Barneks', ['Barnek']), true, 'one insertion');
  assert.equal(isKnownName('Barnak', ['Barnek']), true, 'one substitution');
  assert.equal(isKnownName('Barxxk', ['Barnek']), false, 'two edits is a different name');
  assert.equal(isKnownName('Bob', ['Rob']), false, 'under 5 letters: exact only');
  assert.equal(isKnownName('Rob', ['rob']), true);
  assert.equal(isKnownName('Mott', ['Mitt']), false);
  assert.equal(isKnownName('Marlo', ['Marta']), false);
  assert.equal(isKnownName('Barnek', []), false);
  assert.equal(isKnownName('', ['Barnek']), false);
});

await test('toCandidate(clerk): known names are dropped; a card left with nothing is null; drift and clues survive', () => {
  const known = ['Barnek'];
  assert.equal(toCandidate('clerk', { new_names: ['Varnek'], drift: [], clues_landed: [] }, { now: 1, known }), null, 'the repeat of a known name is no card');
  assert.equal(toCandidate('clerk', { new_names: ['BARNEK', 'barnek'], drift: [], clues_landed: [] }, { now: 1, known }), null);
  const c = toCandidate('clerk', { new_names: ['Varnek', 'Zarbo'], drift: ['The quay is east, not west'], clues_landed: [] }, { now: 1, known });
  assert.equal(c.text, 'New name: Zarbo / Canon: The quay is east, not west');
  const d = toCandidate('clerk', { new_names: ['Varnek'], drift: ['The quay is east, not west'], clues_landed: [] }, { now: 1, known });
  assert.equal(d.text, 'Canon: The quay is east, not west', 'a known name does not hide the drift note');
  assert.ok(toCandidate('clerk', { new_names: ['Varnek'], drift: [], clues_landed: [] }, { now: 1 }), 'with nothing known it is a card, as before');
  assert.equal(merge([toCandidate('clerk', { new_names: ['Varnek'], drift: [], clues_landed: [] }, { now: 1, known })], { now: 1 }).card, null);
});

await test('clerkUser: the known line comes first and only when there are names', () => {
  assert.equal(clerkUser({ known: [], stamp: '21:00', talk: 'T' }), 'Last four minutes, up to 21:00:\nT');
  assert.equal(clerkUser({ known: ['Barnek', 'Mott'], stamp: '21:00', talk: 'T' }), "Already noted tonight (don't raise again): Barnek, Mott\nLast four minutes, up to 21:00:\nT");
});

// ---------- the endpoint ----------
const GM = { role: 'gm', id: 'gm@example.test' };
const clock = { t: Date.parse('2030-01-01T20:00:00.000Z') };
const iso = (ms) => new Date(ms).toISOString();
const NONE = Object.fromEntries(['roll_talk', 'harm', 'npc_change', 'new_name', 'clue_mention', 'xp_trigger', 'scene_change', 'stall'].map((f) => [f, false]));
const result = (json) => ({ json, text: JSON.stringify(json), usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0 }, cost: 0.01, stop: 'end_turn', secs: 0.1 });
const seatOf = (args) => Object.keys(SEATS).find((k) => args.instructions.startsWith(SEATS[k].instructions));

async function setup(clerkReply) {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec);
  const env = { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'sk-ant-test-0000' };
  const calls = [], reply = { clerk: clerkReply };
  const call = async (client, args) => {
    const seat = seatOf(args);
    calls.push({ seat, user: args.user });
    return result(seat === 'tripwire' ? { ...NONE, new_name: true } : reply[seat]);
  };
  const handler = makeHandler({ clientFor: () => ({}), now: () => clock.t, call });
  const lines = (n) => addLines(db, 'c', cleanLines({ lines: Array.from({ length: n }, (_, i) => ({ id: 'l' + Math.random().toString(36).slice(2, 10) + i, at: iso(clock.t - 20_000 + i), session: '3', conn: 'x', speaker: 0, text: 'the fence mentions Varnek again ' + i, kind: 'line' })) }));
  const tick = () => handler({ request: new Request('https://blades.example.test/api/gm/assist/tick', { method: 'POST', body: JSON.stringify({ after: 0 }), headers: { 'Content-Type': 'application/json' } }), env, data: { me: GM } }).then(async (r) => JSON.parse(await r.text()));
  const seed = (seat, ageMs, card = '{}') => exec.db.prepare("INSERT INTO gm_assist_log (campaign, at, session, seat, model, effort, cents, flags, card) VALUES ('c', ?, '', ?, 'seed', '', 0, '', ?)").run(iso(clock.t - ageMs), seat, card);
  const npc = (id, name, alias, ageMs, deleted = 0) => exec.db.prepare('INSERT INTO npcs (id, campaign, created_at, updated_at, deleted, doc) VALUES (?, ?, ?, ?, ?, ?)').run(id, 'c', iso(clock.t - ageMs), iso(clock.t - ageMs), deleted, JSON.stringify({ name, alias, revealed: false }));
  const rows = () => exec.db.prepare('SELECT * FROM gm_assist_log ORDER BY id').all().map((r) => ({ ...r, card: r.card ? JSON.parse(r.card) : null }));
  return { exec, db, calls, lines, tick, seed, npc, rows };
}
const CLERK_TURN = (s) => s.calls.find((c) => c.seat === 'clerk');

await test('tick: the Clerk is told the names it raised tonight and the NPCs updated in the last 12 hours; older, deleted and other-seat names are not', async () => {
  clock.t += 3_600_000;
  const s = await setup({ new_names: ['Zarbo'], drift: [], clues_landed: [] });
  await s.lines(3);
  await s.seed('showrunner', 60_000); await s.seed('scribe', 60_000);
  await s.seed('clerk', 40 * 60_000, JSON.stringify({ out: { new_names: ['Barnek', 'Mott'], drift: [], clues_landed: [] }, shown: 1 }));
  await s.seed('clerk', 14 * 3_600_000, JSON.stringify({ out: { new_names: ['Yesterday Person'], drift: [], clues_landed: [] }, shown: 0 }));
  await s.seed('ledger', 30 * 60_000, JSON.stringify({ out: { new_names: ['Wrong Seat'] } }));
  await s.npc('n1', 'Pell Anders', 'the Ferryman', 2 * 3_600_000);
  await s.npc('n2', 'Old Cast Member', '', 20 * 3_600_000);
  await s.npc('n3', 'Deleted One', '', 3_600_000, 1);
  const out = await s.tick();
  assert.equal(out.errors, undefined);
  const turn = CLERK_TURN(s).user;
  const m = /^Already noted tonight \(don't raise again\): (.*)\nLast four minutes, up to \d\d:\d\d:\n/.exec(turn);
  assert.ok(m, 'the known line leads the Clerk turn: ' + turn.slice(0, 120));
  assert.deepEqual(m[1].split(', ').sort(), ['Barnek', 'Mott', 'Pell Anders', 'the Ferryman']);
  assert.ok(turn.includes('the fence mentions Varnek again'), 'the talk follows');
});

await test('tick: a Clerk card whose only new name is a known one (Varnek for Barnek) is dropped by the Editor; a genuinely new name is shown', async () => {
  clock.t += 3_600_000;
  let s = await setup({ new_names: ['Varnek'], drift: [], clues_landed: [] });
  await s.lines(3);
  await s.seed('showrunner', 60_000); await s.seed('scribe', 60_000);
  await s.seed('clerk', 40 * 60_000, JSON.stringify({ out: { new_names: ['Barnek'], drift: [], clues_landed: [] }, shown: 1, keys: ['clerk:name:barnek'] }));
  let out = await s.tick();
  assert.deepEqual(out.cards, [], 'the repeat is no card');
  const row = s.rows().filter((r) => r.seat === 'clerk').pop();
  assert.equal(row.card.shown, 0); assert.deepEqual(row.card.out.new_names, ['Varnek'], 'the model output is still logged');

  clock.t += 3_600_000;
  s = await setup({ new_names: ['Zarbo'], drift: [], clues_landed: [] });
  await s.lines(3);
  await s.seed('showrunner', 60_000); await s.seed('scribe', 60_000);
  await s.seed('clerk', 40 * 60_000, JSON.stringify({ out: { new_names: ['Barnek'], drift: [], clues_landed: [] }, shown: 1 }));
  out = await s.tick();
  assert.equal(out.cards.length, 1); assert.equal(out.cards[0].text, 'New name: Zarbo');
});

await test('tick: with nothing known the Clerk turn is the plain one (no "Already noted" line)', async () => {
  clock.t += 3_600_000;
  const s = await setup({ new_names: [], drift: [], clues_landed: [] });
  await s.lines(3);
  await s.seed('showrunner', 60_000); await s.seed('scribe', 60_000);
  await s.tick();
  assert.match(CLERK_TURN(s).user, /^Last four minutes, up to \d\d:\d\d:\n/);
});

console.log('\n' + (failed ? failed + ' FAILED, ' + passed + ' passed' : 'ALL PASSED (' + passed + ')'));
process.exit(failed ? 1 : 0);
