// Who is who (seat `whois`): Blade suggests which person each speaker number is. The seat, the pure helpers (roster, needs, validation), the tick wake
// rules, the cooldown, the cap tier, POST /api/gm/assist/whois (the "Blade, guess" button) and its 403s, and that a suggestion is never stored where the
// table display could read it. On an in-memory D1 with a FAKE Anthropic client: no network and no key. Every name and sentence is invented.
//   node checks/runtime/gm-assist-whois.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { cleanLines, addLines, loadStt, sttPartOf } from '../../functions/_lib/stt.js';
import { decide, canRun, budgetTier, COOLDOWN_MS, CORE_SEATS, DROPPED_WHEN_REDUCED } from '../../functions/_lib/assist/conductor.js';
import { SEATS, WAKES } from '../../functions/_lib/assist/seats.js';
import { DEADLINE_MS, LEASE_TTL_MS } from '../../functions/_lib/assist/leases.js';
import { rosterOf, allowedNames, unnamedNeeds, anyUnnamed, whoisUser, toWhois, WHY_MAX, WHOIS_MIN_LINES } from '../../functions/_lib/assist/whois.js';
import { makeHandler } from '../../functions/api/gm/assist.js';
import { matchApi } from '../../worker/app.js';
import { nightCards } from '../../functions/_lib/assist/cards.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const MIN = 60_000;
const T = 1_000_000_000_000;
const GM = { role: 'gm', id: 'gm@example.test' };
const clock = { t: Date.parse('2030-06-01T09:00:00.000Z') };
const iso = (ms) => new Date(ms).toISOString();
const ROSTER = { players: { Wexley: 'Pat', Dara: 'Quinn' }, gm: 'Sam' };

// ---------- the seat ----------
await test('seat: Haiku 5.5 at medium, no prefix, a list schema; wakes on the tick; 3-minute cooldown; not a Core seat, so it stops at 85% like Voice and Stall', () => {
  const s = SEATS.whois;
  assert.deepEqual([s.model, s.effort, s.maxTokens, s.noPrefix], ['claude-haiku-5-5', 'medium', 2000, true]);
  assert.equal(s.schema.additionalProperties, false);
  assert.deepEqual(s.schema.required, ['guesses']);
  const item = s.schema.properties.guesses.items;
  assert.deepEqual(item.required, ['speaker', 'name', 'why']); assert.equal(item.properties.speaker.type, 'integer');
  assert.deepEqual(WAKES.whois, ['tick']);
  assert.equal(COOLDOWN_MS.whois, 3 * MIN);
  assert.ok(!CORE_SEATS.includes('whois') && !DROPPED_WHEN_REDUCED.includes('whois'));
  const at = (spent) => canRun('whois', { now: T, tier: budgetTier(spent, 20) }).ok;
  assert.deepEqual([0, 11.9, 12, 16.9, 17, 19.9, 20].map(at), [true, true, true, true, false, false, false], 'runs through the reduced tier, stops at 85%');
  assert.ok(DEADLINE_MS.whois > 0 && LEASE_TTL_MS.whois > DEADLINE_MS.whois);
  // the rules the GM asked for, in the instructions, and nothing campaign-specific
  assert.match(s.instructions, /GM narrates/); assert.match(s.instructions, /what do you do/); assert.match(s.instructions, /non-player character is the GM/);
  assert.match(s.instructions, /first person/); assert.match(s.instructions, /address each other by name/); assert.match(s.instructions, /Leave a number out when unsure/);
  assert.match(s.instructions, /under 80 characters/);
  assert.ok(!s.instructions.includes('gm-private') && !s.instructions.includes('[['));
});

await test('ladder with the Conductor: a tick wakes whois at 0-85% and not at 85%+; one in flight; the 3-minute cooldown', () => {
  const seats = (o) => decide({ flags: ['tick'], now: T, cap: 20, ...o }).seats.includes('whois');
  assert.equal(seats({ spent: 0 }), true); assert.equal(seats({ spent: 16.99 }), true); assert.equal(seats({ spent: 17 }), false); assert.equal(seats({ spent: 25 }), false);
  assert.equal(seats({ inFlight: ['whois'] }), false);
  assert.equal(seats({ lastRun: { whois: T - 3 * MIN + 1 } }), false); assert.equal(seats({ lastRun: { whois: T - 3 * MIN } }), true);
});

// ---------- the pure helpers ----------
await test('rosterOf: players and the GM from the part, cleaned; nothing usable is null', () => {
  assert.deepEqual(rosterOf({ roster: { players: { Wexley: ' Pat ', Dara: 'Quinn', Bad: 7, '': 'X' }, gm: ' Sam ' } }), { players: [{ character: 'Wexley', player: 'Pat' }, { character: 'Dara', player: 'Quinn' }], gm: 'Sam' });
  assert.deepEqual(rosterOf({ roster: { players: {}, gm: 'Sam' } }), { players: [], gm: 'Sam' });
  assert.equal(rosterOf({ roster: { players: {} } }), null); assert.equal(rosterOf({}), null); assert.equal(rosterOf(null), null); assert.equal(rosterOf({ roster: 'x' }), null);
  assert.deepEqual([...allowedNames(rosterOf({ roster: ROSTER })).values()].sort(), ['Pat', 'Quinn', 'Sam']);
});

const L = (speaker, n, kind = 'line') => Array.from({ length: n }, (_, i) => ({ speaker, kind, text: 'line ' + i }));
await test('unnamedNeeds: an unnamed number needs ~8 lines; a named one (or a blank name) is judged by the name; marks and null speakers do not count', () => {
  assert.equal(WHOIS_MIN_LINES, 8);
  const lines = [...L(0, 8), ...L(1, 7), ...L(2, 9), ...L(3, 20, 'mark'), ...L(null, 12)];
  assert.deepEqual(unnamedNeeds(lines, {}), [{ n: 0, count: 8 }, { n: 2, count: 9 }]);
  assert.deepEqual(unnamedNeeds(lines, { 0: 'Pat' }), [{ n: 2, count: 9 }]);
  assert.deepEqual(unnamedNeeds(lines, { 0: '   ' }).map((x) => x.n), [0, 2], 'a blank name is no name');
  assert.deepEqual(unnamedNeeds(lines, {}, 3).map((x) => x.n), [0, 1, 2]);
  assert.equal(anyUnnamed(L(1, 2), { 1: 'Pat' }), false); assert.equal(anyUnnamed(L(1, 2), {}), true); assert.equal(anyUnnamed(L(null, 2), {}), false);
});

await test('toWhois: only names on the roster survive, only for numbers asked about; a name claimed twice is dropped; why is clipped and has no markup', () => {
  const roster = rosterOf({ roster: ROSTER }), asked = [{ n: 1, count: 9 }, { n: 2, count: 9 }, { n: 3, count: 9 }];
  const out = toWhois({ guesses: [
    { speaker: 1, name: 'pat', why: 'says "I" as <b>Wexley</b>' },
    { speaker: 2, name: 'Mallory', why: 'invented' },
    { speaker: 3, name: ' SAM ', why: 'x'.repeat(200) },
    { speaker: 9, name: 'Quinn', why: 'not asked' },
    { speaker: '1', name: 'Quinn', why: 'string number' },
  ] }, roster, asked);
  assert.deepEqual(Object.keys(out).sort(), ['1', '3']);
  assert.equal(out[1].name, 'Pat', 'spelt as the roster has it'); assert.equal(out[3].name, 'Sam');
  assert.ok(!/[<>]/.test(out[1].why)); assert.equal(out[3].why.length, WHY_MAX);
  assert.deepEqual(toWhois({ guesses: [{ speaker: 1, name: 'Pat', why: 'a' }, { speaker: 2, name: 'Pat', why: 'b' }] }, roster, asked), {}, 'two numbers claiming one name: neither kept');
  assert.deepEqual(toWhois({ guesses: [{ speaker: 1, name: 'Pat', why: 'a' }, { speaker: 1, name: 'Quinn', why: 'b' }] }, roster, asked), { 1: { name: 'Pat', why: 'a' } }, 'the first answer for a number stands');
  for (const bad of [null, {}, { guesses: 'x' }, { guesses: [null, 3, 'x'] }, { guesses: [{ speaker: 1, name: 5 }] }]) assert.deepEqual(toWhois(bad, roster, asked), {});
  assert.deepEqual(toWhois({ guesses: [{ speaker: 1, name: 'Pat', why: 'a' }] }, null, asked), {}, 'no roster: nothing');
});

await test('whoisUser: the roster, the numbers, what the GM has named, and the talk as S<n>: text (no prefix, no timestamps)', () => {
  const u = whoisUser({ roster: rosterOf({ roster: ROSTER }), needs: [{ n: 1, count: 9 }], speakers: { 0: 'Sam', 5: ' ' }, lines: [{ speaker: 0, kind: 'line', text: 'What do you do?' }, { speaker: 1, kind: 'line', text: 'I check the door.' }, { speaker: null, kind: 'mark', text: 'reconnected' }] });
  assert.match(u, /- Pat plays Wexley/); assert.match(u, /- Quinn plays Dara/); assert.match(u, /- Sam is the GM/);
  assert.match(u, /Identify these speaker numbers: S1 \(9 lines\)/); assert.match(u, /already named: S0 is Sam\./); assert.ok(!/S5 is/.test(u));
  assert.match(u, /S0: What do you do\?\nS1: I check the door\.$/);
});

// ---------- the endpoint ----------
const FLAGS = ['roll_talk', 'harm', 'npc_change', 'new_name', 'clue_mention', 'xp_trigger', 'scene_change', 'stall'];
const NONE = Object.fromEntries(FLAGS.map((f) => [f, false]));
const REPLIES = () => ({
  tripwire: { ...NONE }, ref: { slip: false, said_at: '', what_was_said: '', rule: '', card: '' },
  showrunner: { spotlight: [], needs_spotlight: '', beat: 'rising', elapsed_minutes: 30, advice: '', speak: false },
  scribe: { story: 'The crew met a fence.', corrections: [] },
  whois: { guesses: [{ speaker: 1, name: 'Pat', why: "says 'I' as Wexley; others call them by name" }, { speaker: 2, name: 'Mallory', why: 'not at the table' }] },
});
function fakeClient(state, calls) {
  return { messages: { async create(req) {
    const texts = req.messages[0].content.filter((b) => b.type === 'text').map((b) => b.text);
    const seat = Object.keys(SEATS).find((k) => texts[0].startsWith(SEATS[k].instructions)) || 'other';
    calls.push({ seat, ins: texts[0], user: texts[texts.length - 1], doc: req.messages[0].content.find((b) => b.type === 'document'), model: req.model });
    if (seat === 'whois' && state.hold) await state.hold;
    const r = state.replies[seat]; if (r instanceof Error) throw r;
    return { content: [{ type: 'text', text: JSON.stringify(typeof r === 'function' ? r() : r) }], usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, stop_reason: 'end_turn' };
  } } };
}
async function setup({ env = {}, roster = ROSTER, stt = null } = {}) {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec);
  await db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'assist', 'v', '{}', 0, ?1)").bind(JSON.stringify({ file_id: 'file_test000001', ...(roster ? { roster } : {}) })).run();
  if (stt) await db.prepare('INSERT INTO gm_stt (campaign, updated_at, doc) VALUES (?1, ?2, ?3)').bind('c', iso(clock.t), JSON.stringify(stt)).run();
  const calls = [], state = { replies: REPLIES(), hold: null };
  const handler = makeHandler({ clientFor: () => fakeClient(state, calls), now: () => clock.t });
  const e = { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'sk-ant-test-0000', ASSIST_CAP_USD: '20', ...env };
  let n = 0;
  const lines = (count, { speaker = 1, conn = 'a', ago = 20_000, session = '3' } = {}) => addLines(db, 'c', cleanLines({ lines: Array.from({ length: count }, (_, i) => ({ id: 'w' + (++n), at: iso(clock.t - ago + n), session, conn, speaker, text: 'we move on the quay now ' + n, kind: 'line' })) }));
  const req = (route, method = 'POST', b = {}, data = { me: GM }) => handler({ request: new Request('https://blades.example.test/api/gm/assist/' + route, { method, ...(method === 'POST' ? { body: JSON.stringify(b), headers: { 'Content-Type': 'application/json' } } : {}) }), env: e, data });
  const tick = (b = {}) => req('tick', 'POST', b);
  const rows = () => exec.db.prepare('SELECT * FROM gm_assist_log ORDER BY id').all().map((r) => ({ ...r }));
  const seed = (seat, at, cents = 0) => db.prepare("INSERT INTO gm_assist_log (campaign, at, session, seat, model, effort, cents, flags, card) VALUES ('c', ?1, '', ?2, 'm', 'low', ?3, '', NULL)").bind(iso(at), seat, cents).run();
  const whoisCalls = () => calls.filter((c) => c.seat === 'whois');
  return { exec, db, calls, state, lines, req, tick, rows, seed, whoisCalls, env: e, handler };
}
const body = async (res) => JSON.parse(await res.text());

await test('tick: the seat wakes only when an unnamed number has 8 lines; 7 is not enough, and the model never sees the prefix', async () => {
  clock.t = Date.parse('2030-06-01T09:00:00.000Z');
  const s = await setup();
  await s.lines(7);
  let out = await body(await s.tick());
  assert.equal(s.whoisCalls().length, 0, '7 lines of S1: no call'); assert.equal(out.whois, undefined);
  assert.ok(s.calls.some((c) => c.seat === 'scribe'), 'the other tick seats still ran');
  clock.t += MIN; await s.lines(1);
  out = await body(await s.tick());
  assert.equal(s.whoisCalls().length, 1, '8 lines: one call');
  const c = s.whoisCalls()[0];
  assert.equal(c.doc, undefined, 'no cached prefix document: it reads the roster and the talk only');
  assert.equal(c.model, 'claude-haiku-5-5');
  assert.match(c.user, /Pat plays Wexley/); assert.match(c.user, /Sam is the GM/); assert.match(c.user, /Identify these speaker numbers: S1 \(8 lines\)/); assert.match(c.user, /S1: we move on the quay now/);
  assert.deepEqual(Object.keys(out.whois), ['1'], 'S2 was not asked about and "Mallory" is not on the roster: dropped');
  assert.equal(out.whois[1].name, 'Pat'); assert.ok(out.whois[1].why.length <= 80);
  assert.deepEqual(out.cards, [], 'never a card');
});

await test('tick: its cost is logged like any seat; the row is shown 0 and never restores as a card or an ask', async () => {
  clock.t = Date.parse('2030-06-01T09:30:00.000Z');
  const s = await setup();
  await s.lines(9);
  await body(await s.tick());
  const row = s.rows().find((r) => r.seat === 'whois'), card = JSON.parse(row.card);
  assert.equal(row.model, 'claude-haiku-5-5'); assert.equal(row.input_tokens, 1000); assert.equal(row.output_tokens, 200);
  assert.equal(card.shown, 0); assert.deepEqual(card.asked, [1]); assert.deepEqual(Object.keys(card.whois), ['1']); assert.equal(card.text, undefined);
  const night = await nightCards(s.db, 'c', { now: clock.t });
  assert.deepEqual([night.cards.length, night.updates.length, night.asks.length], [0, 0, 0]);
});

await test('tick: a named number does not wake it; a blank name still does; no roster means no call at all', async () => {
  clock.t = Date.parse('2030-06-01T10:00:00.000Z');
  let s = await setup({ stt: { want: 'on', session: '3', speakers: { 1: 'Pat (Wexley)' }, status: { state: 'listening', at: iso(clock.t), lines: 0, error: '' } } });
  await s.lines(10);
  await body(await s.tick());
  assert.equal(s.whoisCalls().length, 0, 'S1 is already named');
  s = await setup({ stt: { want: 'on', session: '3', speakers: { 1: '  ' } } });
  await s.lines(10); await body(await s.tick());
  assert.equal(s.whoisCalls().length, 1, 'a blank name is no name');
  s = await setup({ roster: null });
  await s.lines(12); const out = await body(await s.tick());
  assert.equal(s.whoisCalls().length, 0, 'the part has no players list'); assert.equal(out.whois, undefined);
});

await test('tick: numbers restart on every connection, so only the newest connection counts', async () => {
  clock.t = Date.parse('2030-06-01T10:30:00.000Z');
  const s = await setup();
  await s.lines(10, { conn: 'old', ago: 120_000 });     // S1 spoke 10 times on the old connection
  await s.lines(3, { conn: 'new', ago: 20_000 });       // and only 3 on this one
  await body(await s.tick());
  assert.equal(s.whoisCalls().length, 0, '3 lines on this connection');
  clock.t += MIN; await s.lines(5, { conn: 'new' });
  await body(await s.tick());
  assert.equal(s.whoisCalls().length, 1); assert.ok(!/ 1 \(/.test('') && (s.whoisCalls()[0].user.match(/^S1:/gm) || []).length === 8, 'it read the 8 lines of the new connection, not the old one');
});

await test('tick: the 3-minute cooldown holds, then lets it ask again; a failed call still counts as a run', async () => {
  clock.t = Date.parse('2030-06-01T11:00:00.000Z');
  const s = await setup();
  await s.lines(9); await body(await s.tick());
  assert.equal(s.whoisCalls().length, 1);
  clock.t += MIN; await s.lines(2); await body(await s.tick());
  assert.equal(s.whoisCalls().length, 1, '1 minute later: cooling down');
  clock.t += 2 * MIN - 1; await s.lines(1); await body(await s.tick());
  assert.equal(s.whoisCalls().length, 1, 'just inside 3 minutes');
  clock.t += 46_000; await s.lines(1); await body(await s.tick());   // past the Tripwire's own 45 s gap as well
  assert.equal(s.whoisCalls().length, 2, 'past 3 minutes it asks again');
});

await test('tick: the cap tier stops it at 85% (the other non-Core seats go too) and the Tripwire still runs', async () => {
  clock.t = Date.parse('2030-06-01T12:00:00.000Z');
  let s = await setup();
  await s.seed('ref', clock.t - 5 * MIN, 1699);          // $16.99 of a $20 cap
  await s.lines(9); await body(await s.tick());
  assert.equal(s.whoisCalls().length, 1, 'under 85%');
  s = await setup();
  await s.seed('ref', clock.t - 5 * MIN, 1700);          // 85%
  await s.lines(9); const out = await body(await s.tick());
  assert.equal(s.whoisCalls().length, 0, 'at 85%'); assert.equal(out.whois, undefined);
  assert.equal(out.spend.tier, 'core');
});

// ---------- POST /whois ----------
await test('route: /api/gm/assist/whois is wired; a player, the display or nobody gets 403 before the body, the database or the key are touched', async () => {
  const real = matchApi('/api/gm/assist/whois');
  assert.ok(real && real.handler); assert.equal(matchApi('/api/gm/assist/whois/').handler, real.handler);
  const touched = [];
  const request = { method: 'POST', url: 'https://blades.example.test/api/gm/assist/whois', headers: new Headers(), json() { touched.push('json'); throw new Error('read'); }, text() { touched.push('text'); throw new Error('read'); }, arrayBuffer() { touched.push('ab'); throw new Error('read'); }, get body() { touched.push('body'); throw new Error('read'); } };
  const env = { get DB() { touched.push('DB'); return undefined; }, get ANTHROPIC_API_KEY() { touched.push('key'); return 'k'; }, CAMPAIGN: 'x' };
  for (const me of [{ role: 'player', id: 'p@example.test' }, { role: 'display', id: 'd@example.test' }, undefined]) {
    let err = null; try { await real.handler({ request, env, data: { me } }); } catch (e) { err = e; }
    assert.ok(err && err.status === 403, String(me && me.role));
  }
  assert.deepEqual(touched, []);
  const s = await setup(); await s.lines(5);
  for (const me of [{ role: 'player', id: 'p@example.test' }, { role: 'display', id: 'd@example.test' }]) {
    await assert.rejects(s.req('whois', 'POST', {}, { me }), (e) => e.status === 403);
  }
  assert.equal(s.calls.length, 0);
});

await test('route: GET is 405; the button asks at once about any unnamed number with 3 lines, and keeps only roster names', async () => {
  clock.t = Date.parse('2030-06-01T13:00:00.000Z');
  const s = await setup();
  assert.equal((await s.req('whois', 'GET')).status, 405);
  await s.lines(4, { speaker: 1 }); await s.lines(3, { speaker: 2 }); await s.lines(2, { speaker: 3 });
  const out = await body(await s.req('whois'));
  assert.equal(s.whoisCalls().length, 1);
  assert.match(s.whoisCalls()[0].user, /S1 \(4 lines\), S2 \(3 lines\)\./, 'S3 has only 2 lines');
  assert.deepEqual(Object.keys(out.whois), ['1'], 'Mallory is not at the table'); assert.equal(out.whois[1].name, 'Pat');
  assert.ok(out.spend && out.spend.cap === 20);
  const row = s.rows().find((r) => r.seat === 'whois'); assert.equal(row.flags, 'whois'); assert.equal(JSON.parse(row.card).shown, 0);
});

await test('route: nothing to guess and no roster make no call; the answer says why', async () => {
  clock.t = Date.parse('2030-06-01T13:30:00.000Z');
  let s = await setup({ stt: { want: 'on', speakers: { 1: 'Pat' } } });
  await s.lines(10); let out = await body(await s.req('whois'));
  assert.equal(s.calls.length, 0); assert.deepEqual(out.whois, {}); assert.match(out.nothing, /no unnamed speaker/);
  s = await setup({ roster: null }); await s.lines(10);
  out = await body(await s.req('whois'));
  assert.equal(s.calls.length, 0); assert.deepEqual(out.whois, {}); assert.match(out.warnings[0], /players list/);
});

await test('route: 429 at the cap, while a guess is in flight, and inside 10 s of the last one', async () => {
  clock.t = Date.parse('2030-06-01T14:00:00.000Z');
  let s = await setup();
  await s.seed('ref', clock.t - MIN, 1700); await s.lines(5);
  await assert.rejects(s.req('whois'), (e) => e.status === 429 && /cap/.test(e.message));
  assert.equal(s.calls.length, 0);
  s = await setup(); await s.lines(5);
  let release; s.state.hold = new Promise((r) => { release = r; });
  const first = s.req('whois');
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(s.req('whois'), (e) => e.status === 429 && !/cap/.test(e.message), 'in flight');
  release(); assert.equal((await body(await first)).whois[1].name, 'Pat');
  clock.t += 9_000;
  await assert.rejects(s.req('whois'), (e) => e.status === 429, 'inside 10 s');
  clock.t += 2_000;
  assert.equal((await s.req('whois')).status, 200, 'after 10 s');
  assert.equal(s.whoisCalls().length, 2);
});

await test('route: a failed or refused call gives an empty answer, still logged; an unusable body from the model is dropped', async () => {
  clock.t = Date.parse('2030-06-01T15:00:00.000Z');
  const s = await setup(); await s.lines(5);
  s.state.replies.whois = new Error('boom');
  let out = await body(await s.req('whois'));
  assert.deepEqual(out.whois, {}); assert.ok(out.errors && out.errors.length);
  assert.ok(JSON.parse(s.rows().find((r) => r.seat === 'whois').card).error);
  clock.t += MIN; s.state.replies.whois = { guesses: 'nope' };
  out = await body(await s.req('whois'));
  assert.deepEqual(out.whois, {});
});

await test('hidden stays hidden: a suggestion is never written to the listening document the display can read', async () => {
  clock.t = Date.parse('2030-06-01T16:00:00.000Z');
  const s = await setup({ stt: { want: 'on', session: '3', speakers: {}, status: { state: 'listening', at: iso(clock.t), lines: 0, error: '' } } });
  await s.lines(10);
  await body(await s.tick()); clock.t += 11_000; await body(await s.req('whois'));
  assert.ok(s.whoisCalls().length >= 1);
  const { doc } = await loadStt(s.db, 'c');
  assert.deepEqual(doc.speakers, {}, 'nothing was applied');
  assert.ok(!JSON.stringify(doc).includes('Pat') && !/whois|guess/i.test(JSON.stringify(doc)));
  assert.deepEqual(Object.keys(sttPartOf(doc)).sort(), ['seq', 'want', 'session'].sort(), 'the display part carries want and session only');
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
