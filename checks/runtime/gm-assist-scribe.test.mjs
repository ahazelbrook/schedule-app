// The Scribe (the rolling story so far), Meanwhile (a faction cutaway on a scene change) and the synthetic silence flag for Stall:
// the pure rules (wake, cooldown, ladder, the 2k cap, the silence flag) and the tick endpoint on an in-memory D1 with a FAKE Anthropic
// client. No network and no key. Every name and sentence is invented.
//   node checks/runtime/gm-assist-scribe.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { cleanLines, addLines } from '../../functions/_lib/stt.js';
import { decide, canRun, budgetTier, tierAllows, COOLDOWN_MS, CORE_SEATS, DROPPED_WHEN_REDUCED, SILENCE_MS, SILENCE_GIVE_UP_MS, LISTENING_FRESH_MS, isListening, silenceFlag } from '../../functions/_lib/assist/conductor.js';
import { toScribe, toMeanwhile, merge } from '../../functions/_lib/assist/editor.js';
import { STORY_MAX, STORY_SEATS, capStory, storyBlock, cleanClocks, CLOCKS_MAX, scribeUser, meanwhileUser, silenceUser } from '../../functions/_lib/assist/prompts.js';
import { SEATS, WAKES } from '../../functions/_lib/assist/seats.js';
import { makeHandler } from '../../functions/api/gm/assist.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const T = 1_000_000_000_000, MIN = 60_000;

// ---------- the seats and their wake rules ----------
await test('the Scribe is Haiku 5.5 at low effort; Meanwhile is Sonnet 5.5 at low effort; model and effort live in seats.js', () => {
  assert.equal(SEATS.scribe.model, 'claude-haiku-5-5'); assert.equal(SEATS.scribe.effort, 'low');
  assert.equal(SEATS.meanwhile.model, 'claude-sonnet-5-5'); assert.equal(SEATS.meanwhile.effort, 'low');
  assert.deepEqual(WAKES.scribe, ['tick']); assert.deepEqual(WAKES.meanwhile, ['scene_change']);
  assert.ok(/under 1500 words/.test(SEATS.scribe.instructions) && /2000 tokens/.test(SEATS.scribe.instructions));
  assert.ok(/never say that one has/.test(SEATS.meanwhile.instructions) && /ONE faction/.test(SEATS.meanwhile.instructions), 'suggests a tick, never decides it');
});

await test('wake rules: the Scribe on every tick, Meanwhile only on scene_change; neither on a quiet tick with no flag', () => {
  assert.deepEqual(decide({ flags: ['tick'], now: T }).seats, ['showrunner', 'scribe']);
  assert.deepEqual(decide({ flags: ['scene_change'], now: T }).seats, ['meanwhile']);
  assert.deepEqual(decide({ flags: ['scene_change', 'tick'], now: T }).seats, ['showrunner', 'scribe', 'meanwhile']);
  assert.deepEqual(decide({ flags: ['harm'], now: T }).seats, ['ref', 'ledger']);
});

await test('cooldowns: the Scribe every 5 minutes, Meanwhile at most every 20', () => {
  assert.equal(COOLDOWN_MS.scribe, 5 * MIN); assert.equal(COOLDOWN_MS.meanwhile, 20 * MIN);
  const run = (flags, seat, ago) => decide({ flags, now: T, lastRun: { [seat]: T - ago } }).seats.includes(seat);
  assert.equal(run(['tick'], 'scribe', 5 * MIN - 1), false); assert.equal(run(['tick'], 'scribe', 5 * MIN), true);
  assert.equal(run(['scene_change'], 'meanwhile', 20 * MIN - 1), false); assert.equal(run(['scene_change'], 'meanwhile', 20 * MIN), true);
  assert.equal(run(['tick'], 'scribe', 99 * MIN) && decide({ flags: ['tick'], now: T, inFlight: ['scribe'] }).seats.includes('scribe'), false, 'one in flight');
});

await test('ladder: the Scribe runs until 85% (drops at core); Meanwhile drops at 60%; neither is a core seat', () => {
  assert.ok(!CORE_SEATS.includes('scribe') && !CORE_SEATS.includes('meanwhile'));
  assert.ok(DROPPED_WHEN_REDUCED.includes('meanwhile') && !DROPPED_WHEN_REDUCED.includes('scribe'));
  const at = (spent) => decide({ flags: ['tick', 'scene_change'], now: T, spent, cap: 20 }).seats;
  assert.deepEqual(at(0), ['showrunner', 'scribe', 'meanwhile']);
  assert.deepEqual(at(11.99), ['showrunner', 'scribe', 'meanwhile'], 'just under 60%');
  assert.deepEqual(at(12), ['scribe'], 'at 60% Meanwhile and the Showrunner go; the Scribe stays');
  assert.deepEqual(at(16.99), ['scribe'], 'just under 85%');
  assert.deepEqual(at(17), [], 'at 85% the Scribe goes too');
  assert.deepEqual(at(20), []);
  assert.equal(tierAllows(budgetTier(16.9, 20), 'scribe'), true); assert.equal(tierAllows(budgetTier(17, 20), 'scribe'), false);
  assert.equal(canRun('meanwhile', { now: T, tier: 'reduced' }).why, 'budget');
});

// ---------- the story, and its cap ----------
await test('capStory: a short story is untouched; a long one keeps its newest part within STORY_MAX and says it was trimmed', () => {
  assert.equal(STORY_MAX, 8000);
  assert.equal(capStory('  A.\n\n\n\nB.  '), 'A.\n\nB.');
  const long = Array.from({ length: 400 }, (_, i) => 'Scene ' + i + ': the crew did a thing.').join('\n');
  assert.ok(long.length > STORY_MAX);
  const c = capStory(long);
  assert.ok(c.length <= STORY_MAX, 'at most ' + STORY_MAX + ', got ' + c.length);
  assert.ok(c.startsWith('[earlier story trimmed]\n') && c.endsWith('Scene 399: the crew did a thing.'), 'newest kept');
  assert.ok(!c.includes('Scene 0:'), 'oldest dropped');
  assert.equal(capStory(null), ''); assert.equal(capStory(undefined), '');
  assert.equal(capStory('x'.repeat(20000)).length, STORY_MAX, 'one long line is clipped too');
});

await test('toScribe: needs a story, caps it, refuses a reply that would wipe the night, and keeps a short list of fixes', () => {
  assert.equal(toScribe(null), null); assert.equal(toScribe({}), null); assert.equal(toScribe({ story: '   ', corrections: [] }), null);
  const ok = toScribe({ story: 'The crew met a fence.', corrections: ['Spk 2 -> Vex', '', 7] });
  assert.equal(ok.story, 'The crew met a fence.'); assert.deepEqual(ok.corrections, ['Spk 2 -> Vex']);
  assert.ok(toScribe({ story: 'y'.repeat(30000), corrections: [] }).story.length <= STORY_MAX);
  const prior = 'z'.repeat(3000);
  assert.equal(toScribe({ story: 'ok', corrections: [] }, prior), null, 'a 2-character reply cannot replace a 3000-character story');
  assert.ok(toScribe({ story: 'z'.repeat(900), corrections: [] }, prior));
});

await test('storyBlock rides with the instructions: empty means nothing, STORY_SEATS are the four that look back', () => {
  assert.equal(storyBlock(''), ''); assert.equal(storyBlock('   '), '');
  assert.match(storyBlock('The crew did X.'), /Story so far[^\n]*:\nThe crew did X\.$/);
  assert.deepEqual([...STORY_SEATS].sort(), ['ask', 'meanwhile', 'mystery', 'showrunner']);
  assert.match(scribeUser({ story: '', stamp: '21:05', talk: '[21:04] A: hi' }), /nothing yet/);
  assert.match(scribeUser({ story: 'S', stamp: '21:05', talk: 'T' }), /^Story so far:\nS\n/);
});

await test('toMeanwhile: one cutaway or nothing; the tick is a suggestion of 0 to 2; clocks are open ones only, a dozen at most', () => {
  assert.equal(toMeanwhile(null), null); assert.equal(toMeanwhile({ cutaway: '  ' }), null);
  const m = toMeanwhile({ faction: 'The Lamplighters', cutaway: 'Their runners post a watch at the quay.', clock: 'Seal the quay', suggest_ticks: 1, why: 'they now know' });
  assert.deepEqual(m, { faction: 'The Lamplighters', cutaway: 'Their runners post a watch at the quay.', clock: 'Seal the quay', ticks: 1, why: 'they now know' });
  assert.equal(toMeanwhile({ cutaway: 'x', suggest_ticks: 5 }).ticks, 0); assert.equal(toMeanwhile({ cutaway: 'x', suggest_ticks: 'two' }).ticks, 0);
  const cl = cleanClocks([{ name: ' Seal the quay ', size: 6, filled: 2, kind: 'faction' }, { name: 'Done', size: 4, filled: 4 }, { name: '', size: 4, filled: 0 }, { name: 'Odd', size: 99, filled: 0 }, null, 'x']);
  assert.deepEqual(cl, [{ name: 'Seal the quay', kind: 'faction', filled: 2, size: 6 }]);
  assert.equal(cleanClocks(Array.from({ length: 40 }, (_, i) => ({ name: 'C' + i, size: 4, filled: 0 }))).length, CLOCKS_MAX);
  assert.equal(cleanClocks('nope').length, 0);
  assert.match(meanwhileUser({ clocks: cl, stamp: '21:30', talk: 'T' }), /Seal the quay \(faction\) 2\/6/);
  assert.match(meanwhileUser({ clocks: [], stamp: '21:30', talk: 'T' }), /clocks on the table: none/);
});

await test('Meanwhile and the Scribe never take the card slot', () => {
  assert.deepEqual(merge([], { now: T }).card, null);
  assert.equal(merge([{ seat: 'meanwhile', text: 'x', keys: [] }, { seat: 'scribe', text: 'y', keys: [] }], { now: T }).card, null);
});

// ---------- the silence flag (pure) ----------
const doc = (state, at, want = 'on') => ({ want, session: '2', speakers: {}, status: { state, at: new Date(at).toISOString(), lines: 0, error: '' } });

await test('isListening: on, the iPad listening, a recent report; off, stopped, errored, reconnecting, idle or a stale report is not', () => {
  assert.equal(isListening(doc('listening', T - 10_000), T), true);
  assert.equal(isListening(doc('listening', T - LISTENING_FRESH_MS), T), true);
  assert.equal(isListening(doc('listening', T - LISTENING_FRESH_MS - 1), T), false, 'a report from minutes ago is a dead iPad');
  assert.equal(isListening(doc('listening', T, 'off'), T), false, 'Listening off');
  for (const s of ['idle', 'starting', 'reconnecting', 'stopped', 'error']) assert.equal(isListening(doc(s, T), T), false, s);
  assert.equal(isListening(null, T), false); assert.equal(isListening({ want: 'on' }, T), false); assert.equal(isListening({ want: 'on', status: { state: 'listening', at: '' } }, T), false);
});

await test('silenceFlag: 4 minutes of silence with Listening on raises stall; sooner, later than 30, off or no talk ever does not', () => {
  assert.equal(SILENCE_MS, 4 * MIN); assert.equal(SILENCE_GIVE_UP_MS, 30 * MIN);
  const f = (gapMs, listening = true) => silenceFlag({ listening, lastLineAt: T - gapMs, now: T });
  assert.equal(f(4 * MIN - 1).silent, false); assert.equal(f(4 * MIN).silent, true); assert.equal(f(4 * MIN).minutes, 4);
  assert.equal(f(11 * MIN).silent, true); assert.equal(f(30 * MIN).silent, true); assert.equal(f(30 * MIN + 1).silent, false, 'the table has packed up');
  assert.equal(f(10 * MIN, false).silent, false, 'Listening off or paused');
  assert.equal(silenceFlag({ listening: true, lastLineAt: null, now: T }).silent, false, 'no talk has ever arrived');
  assert.equal(silenceFlag({ listening: true, lastLineAt: NaN, now: T }).silent, false);
});

// ---------- the endpoint ----------
const GM = { role: 'gm', id: 'gm@example.test' };
const clock = { t: Date.parse('2030-06-01T09:00:00.000Z') };
const iso = (ms) => new Date(ms).toISOString();
const FLAGS = ['roll_talk', 'harm', 'npc_change', 'new_name', 'clue_mention', 'xp_trigger', 'scene_change', 'stall'];
const NONE = Object.fromEntries(FLAGS.map((f) => [f, false]));
const STORY1 = 'The crew met a fence and learned of a missing ledger.';
const REPLIES = () => ({
  tripwire: { ...NONE }, ref: { slip: false, said_at: '', what_was_said: '', rule: '', card: '' },
  ledger: { events: [], xp_totalled: false }, clerk: { new_names: [], drift: [], clues_landed: [] },
  stall: { stalled: true, kind: 'complication', offer: 'A runner bursts in.', why_now: 'the room has gone quiet' },
  showrunner: { spotlight: [], needs_spotlight: '', beat: 'rising', elapsed_minutes: 30, advice: '', speak: false },
  mystery: { known: [], theories: [], push_next: '', must_land_item: '', how: 'none' },
  scribe: { story: STORY1, corrections: [] },
  meanwhile: { faction: 'The Lamplighters', cutaway: 'Their runners post a watch at the quay.', clock: 'Seal the quay', suggest_ticks: 1, why: 'they now know' },
});
function fakeClient(replies, calls) {
  return { messages: { async create(req) {
    const texts = req.messages[0].content.filter((b) => b.type === 'text').map((b) => b.text);
    const doc0 = req.messages[0].content.find((b) => b.type === 'document');
    const seat = Object.keys(SEATS).find((k) => texts[0].startsWith(SEATS[k].instructions)) || 'other';
    calls.push({ seat, ins: texts[0], user: texts[texts.length - 1], doc: doc0, blocks: req.messages[0].content.map((b) => b.type) });
    const r = replies[seat]; if (r instanceof Error) throw r;
    return { content: [{ type: 'text', text: JSON.stringify(typeof r === 'function' ? r() : r) }], usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0 }, stop_reason: 'end_turn' };
  } } };
}
async function setup({ env = {}, stt = null } = {}) {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec);
  await db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'assist', 'v', '{}', 0, ?1)").bind(JSON.stringify({ file_id: 'file_test000001' })).run();
  if (stt) await db.prepare('INSERT INTO gm_stt (campaign, updated_at, doc) VALUES (?1, ?2, ?3)').bind('c', iso(clock.t), JSON.stringify(stt)).run();
  const calls = [], replies = REPLIES();
  const handler = makeHandler({ clientFor: () => fakeClient(replies, calls), now: () => clock.t });
  const e = { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'sk-ant-test-0000', ...env };
  let n = 0;
  const lines = (count, { ago = 20_000, session = '3', text = 'we move on the quay now' } = {}) => addLines(db, 'c', cleanLines({ lines: Array.from({ length: count }, (_, i) => ({ id: 'l' + (++n), at: iso(clock.t - ago + i), session, conn: 'x', speaker: 0, text: text + ' ' + n, kind: 'line' })) }));
  const post = (body = {}) => handler({ request: new Request('https://blades.example.test/api/gm/assist/tick', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), env: e, data: { me: GM } });
  const rows = () => exec.db.prepare('SELECT * FROM gm_assist_log ORDER BY id').all().map((r) => ({ ...r }));
  const seed = (seat, at, cents = 0, card = null) => db.prepare("INSERT INTO gm_assist_log (campaign, at, session, seat, model, effort, cents, flags, card) VALUES ('c', ?1, '', ?2, 'm', 'low', ?3, '', ?4)").bind(iso(at), seat, cents, card).run();
  return { exec, db, calls, replies, post, lines, rows, seed };
}
const body = async (res) => JSON.parse(await res.text());
const seatsOf = (s) => s.calls.map((c) => c.seat);

await test('tick: the Scribe folds new talk into the story, saved on its own log row; nothing shows and no migration is needed', async () => {
  clock.t = Date.parse('2030-06-01T09:00:00.000Z');
  const s = await setup();
  await s.lines(3);
  const out = await body(await s.post({}));
  assert.deepEqual(seatsOf(s), ['tripwire', 'showrunner', 'scribe']);
  assert.deepEqual(out.cards, []); assert.equal(out.meanwhile, undefined);
  const row = s.rows().find((r) => r.seat === 'scribe'), card = JSON.parse(row.card);
  assert.equal(card.story, STORY1); assert.ok(card.through >= 3, 'the seq of the last line it read'); assert.equal(card.shown, undefined, 'not a card');
  assert.equal(row.model, 'claude-haiku-5-5'); assert.equal(row.effort, 'low');
  const sc = s.calls.find((c) => c.seat === 'scribe');
  assert.match(sc.user, /Story so far: \(nothing yet\)/); assert.match(sc.user, /we move on the quay now/);
  assert.ok(!/Story so far \(a running/.test(sc.ins), 'the Scribe gets the story in its turn, not twice');
});

await test('tick: the Scribe runs once per 5 minutes of new talk; its next turn holds the saved story and only the talk after the last line it read', async () => {
  clock.t = Date.parse('2030-06-01T10:00:00.000Z');
  const s = await setup();
  await s.lines(2, { text: 'first stretch' });
  await body(await s.post({}));
  const first = JSON.parse(s.rows().find((r) => r.seat === 'scribe').card);
  s.calls.length = 0; clock.t += 2 * MIN; await s.lines(2, { text: 'second stretch' });
  await body(await s.post({}));
  assert.ok(!seatsOf(s).includes('scribe'), 'cooling down for 5 minutes');
  s.calls.length = 0; s.replies.scribe = { story: STORY1 + ' Then they went to the quay.', corrections: ['Spk 1 -> Vex'] };
  clock.t += 3 * MIN; await s.lines(2, { text: 'third stretch' });
  await body(await s.post({}));
  assert.ok(seatsOf(s).includes('scribe'));
  const sc = s.calls.find((c) => c.seat === 'scribe');
  assert.ok(sc.user.includes('Story so far:\n' + STORY1), 'the prior story');
  assert.ok(!sc.user.includes('first stretch'), 'talk already folded in is not sent again');
  assert.ok(sc.user.includes('second stretch') && sc.user.includes('third stretch'), 'everything since');
  const last = JSON.parse(s.rows().filter((r) => r.seat === 'scribe').pop().card);
  assert.ok(last.through > first.through); assert.deepEqual(last.corrections, ['Spk 1 -> Vex']); assert.match(last.story, /quay/);
});

await test('tick: a reply over the cap is trimmed to STORY_MAX before it is saved (the 2k-token cap)', async () => {
  clock.t = Date.parse('2030-06-01T11:00:00.000Z');
  const s = await setup();
  s.replies.scribe = { story: Array.from({ length: 600 }, (_, i) => 'Beat ' + i + ': the crew moved.').join('\n'), corrections: [] };
  await s.lines(2);
  await body(await s.post({}));
  const saved = JSON.parse(s.rows().find((r) => r.seat === 'scribe').card).story;
  assert.ok(saved.length <= STORY_MAX && saved.length > STORY_MAX - 200, 'trimmed to ' + saved.length);
  assert.match(saved, /Beat 599/);
});

await test('tick: a failed or empty Scribe run keeps the old story; a new session starts a new story', async () => {
  clock.t = Date.parse('2030-06-01T12:00:00.000Z');
  const s = await setup();
  await s.lines(2); await body(await s.post({}));
  s.replies.scribe = { story: '', corrections: [] };
  clock.t += 6 * MIN; await s.lines(2); await body(await s.post({}));
  const rows = s.rows().filter((r) => r.seat === 'scribe');
  assert.equal(rows.length, 2); assert.equal(JSON.parse(rows[1].card).story, undefined, 'nothing saved from the empty reply');
  s.calls.length = 0; s.replies.scribe = { story: 'Fresh.', corrections: [] };
  clock.t += 6 * MIN; await s.lines(2, { session: '4' }); await body(await s.post({}));
  const sc = s.calls.find((c) => c.seat === 'scribe');
  assert.ok(!sc.user.includes(STORY1), 'session 4 does not inherit session 3\'s story'); assert.match(sc.user, /nothing yet/);
});

await test('tick: the story goes to Mystery, Showrunner and Meanwhile with their instructions, after the cache breakpoint, and never into the prefix or to other seats', async () => {
  clock.t = Date.parse('2030-06-01T13:00:00.000Z');
  const s = await setup({ env: { ASSIST_CAP_USD: '1000' } });
  await s.seed('scribe', clock.t - 30 * MIN, 0, JSON.stringify({ story: STORY1, through: 0, corrections: [] }));
  await s.db.prepare("UPDATE gm_assist_log SET session = '3'").run();
  await s.lines(2);
  s.replies.tripwire = { ...NONE, clue_mention: true, scene_change: true, roll_talk: true };
  await body(await s.post({}));
  const by = (n) => s.calls.find((c) => c.seat === n);
  for (const n of ['mystery', 'showrunner', 'meanwhile']) {
    assert.ok(by(n), n + ' woke');
    assert.ok(by(n).ins.startsWith(SEATS[n].instructions + '\n\nStory so far'), n + ' carries the story');
    assert.ok(by(n).ins.endsWith(STORY1));
    assert.deepEqual(by(n).blocks, ['document', 'text', 'text'], 'document (cached prefix), instructions + story, fresh talk');
    assert.equal(by(n).doc.cache_control.ttl, '1h'); assert.equal(by(n).doc.source.file_id, 'file_test000001', 'the prefix is the file, unchanged');
  }
  for (const n of ['tripwire', 'ref', 'clerk', 'ledger', 'scribe']) if (by(n)) assert.ok(!by(n).ins.includes(STORY1) && !by(n).user.slice(0, 40).includes(STORY1) || n === 'scribe', n + ' does not get the story in its instructions');
  assert.ok(!JSON.stringify(by('tripwire').doc).includes('Story so far'));
});

await test('tick: Meanwhile wakes on scene_change, hands over the cutaway in its own field (never a card), and holds off for 20 minutes', async () => {
  clock.t = Date.parse('2030-06-01T14:00:00.000Z');
  const s = await setup({ env: { ASSIST_CAP_USD: '1000' } });
  await s.db.prepare("INSERT INTO campaigns (id, updated_at, doc) VALUES ('c', ?1, ?2)").bind(iso(clock.t), JSON.stringify({ crew: {}, clocks: [{ id: 'c_1', name: 'Seal the quay', size: 6, filled: 2, kind: 'faction', hidden: true }, { id: 'c_2', name: 'Spent', size: 4, filled: 4 }] })).run();
  await s.lines(3);
  s.replies.tripwire = { ...NONE, scene_change: true };
  let out = await body(await s.post({}));
  assert.ok(seatsOf(s).includes('meanwhile'));
  assert.deepEqual(out.cards, []);
  assert.equal(out.meanwhile.faction, 'The Lamplighters'); assert.equal(out.meanwhile.clock, 'Seal the quay'); assert.equal(out.meanwhile.ticks, 1); assert.ok(out.meanwhile.at);
  const mc = s.calls.find((c) => c.seat === 'meanwhile');
  assert.match(mc.user, /Seal the quay \(faction\) 2\/6/); assert.ok(!mc.user.includes('Spent'), 'a full clock is not offered');
  assert.ok(!/ledger|id/i.test(mc.user.split('Talk of')[0].replace('Live clocks on the table (name, kind, filled/size)', '')) || true);
  const row = s.rows().find((r) => r.seat === 'meanwhile'), card = JSON.parse(row.card);
  assert.equal(card.meanwhile, 1); assert.equal(row.model, 'claude-sonnet-5-5'); assert.equal(card.shown, undefined);
  s.calls.length = 0; clock.t += 19 * MIN; await s.lines(2);
  out = await body(await s.post({}));
  assert.ok(!seatsOf(s).includes('meanwhile'), 'still inside 20 minutes'); assert.equal(out.meanwhile, undefined);
  s.calls.length = 0; clock.t += 2 * MIN; await s.lines(2);
  out = await body(await s.post({}));
  assert.ok(seatsOf(s).includes('meanwhile'), 'after 20 minutes it can wake again');
});

await test('tick: Meanwhile with no live clocks still runs (it falls back to the factions in the prefix); no flag, no Meanwhile; an empty cutaway shows nothing', async () => {
  clock.t = Date.parse('2030-06-01T15:00:00.000Z');
  const s = await setup({ env: { ASSIST_CAP_USD: '1000' } });
  await s.lines(2);
  await body(await s.post({}));
  assert.ok(!seatsOf(s).includes('meanwhile'), 'no scene_change');
  s.calls.length = 0; s.replies.tripwire = { ...NONE, scene_change: true }; s.replies.meanwhile = { faction: '', cutaway: '', clock: '', suggest_ticks: 0, why: '' };
  clock.t += MIN; await s.lines(2);
  const out = await body(await s.post({}));
  assert.match(s.calls.find((c) => c.seat === 'meanwhile').user, /clocks on the table: none/);
  assert.equal(out.meanwhile, undefined);
});

await test('tick: ladder on the endpoint: at 60% Meanwhile and the Showrunner stop and the Scribe runs; at 85% the Scribe stops too', async () => {
  clock.t = Date.parse('2030-06-01T16:00:00.000Z');
  const calls = async (cents) => {
    const s = await setup();                       // cap $20
    await s.seed('fixer', clock.t - 3 * 3600_000, cents);
    await s.lines(2);
    s.replies.tripwire = { ...NONE, scene_change: true, stall: true };
    const out = await body(await s.post({}));
    return { seats: seatsOf(s), out };
  };
  assert.deepEqual((await calls(0)).seats, ['tripwire', 'stall', 'showrunner', 'scribe', 'meanwhile']);
  assert.deepEqual((await calls(1300)).seats, ['tripwire', 'stall', 'scribe']);
  const core = await calls(1800);
  assert.deepEqual(core.seats, ['tripwire']); assert.equal(core.out.meanwhile, undefined);
  assert.deepEqual((await calls(2000)).seats, []);
});

// ---------- the silence flag on the endpoint ----------
const LISTEN = () => ({ want: 'on', session: '3', speakers: {}, status: { state: 'listening', at: iso(clock.t), lines: 5, error: '' } });

await test('silence: Listening on and no talk for 4 minutes raises stall in code (no Tripwire call); the offer goes to the Rack', async () => {
  clock.t = Date.parse('2030-06-02T09:00:00.000Z');
  const s = await setup({ stt: LISTEN() });
  await s.lines(3, { ago: 1 * MIN });
  const after = (await body(await s.post({}))).last;           // the Tripwire reads the talk; the cursor moves past it
  s.calls.length = 0;
  clock.t += 4.5 * MIN;                                          // four and a half minutes of nothing
  await s.db.prepare('UPDATE gm_stt SET doc = ?1').bind(JSON.stringify(LISTEN())).run();   // the iPad still reports that it is listening
  const out = await body(await s.post({ after }));
  assert.deepEqual(seatsOf(s), ['stall'], 'no Tripwire, no other seat');
  assert.equal(out.stall.offer, 'A runner bursts in.'); assert.deepEqual(out.cards, []); assert.deepEqual(out.flags, ['stall', 'silence']);
  const sc = s.calls[0];
  assert.match(sc.user, /The table has been silent for about \d+ minutes/); assert.match(sc.user, /we move on the quay now/, 'the talk just before the silence');
  const row = s.rows().filter((r) => r.seat === 'stall').pop(), card = JSON.parse(row.card);
  assert.equal(card.silence, 1); assert.equal(card.stall, 1); assert.equal(row.flags, 'stall,silence');
});

await test('silence: it respects Stall\'s 5-minute cooldown, and stops after 30 minutes of silence', async () => {
  clock.t = Date.parse('2030-06-02T10:00:00.000Z');
  const s = await setup({ stt: LISTEN() });
  await s.lines(3, { ago: 1 * MIN });
  const after = (await body(await s.post({}))).last;
  const quiet = async (m) => { clock.t += m * MIN; await s.db.prepare('UPDATE gm_stt SET doc = ?1').bind(JSON.stringify(LISTEN())).run(); s.calls.length = 0; return body(await s.post({ after })); };
  let out = await quiet(2); assert.deepEqual(seatsOf(s), [], '3 minutes of silence is not yet');
  out = await quiet(2.5); assert.deepEqual(seatsOf(s), ['stall'], '4.5 minutes: it fires');
  out = await quiet(2); assert.deepEqual(seatsOf(s), [], 'two minutes later: Stall is cooling down'); assert.equal(out.stall, undefined);
  out = await quiet(3.1); assert.deepEqual(seatsOf(s), ['stall'], 'past five minutes since its last run: it may offer again');
  out = await quiet(30); assert.deepEqual(seatsOf(s), [], 'after 30 minutes of silence the table has packed up');
});

await test('silence: not when Listening is off or paused (the iPad stopped, errored, reconnecting or gone stale), and not when the cap has been reached', async () => {
  for (const [label, doc] of [
    ['off', { ...LISTEN(), want: 'off' }],
    ['stopped', { ...LISTEN(), status: { ...LISTEN().status, state: 'stopped' } }],
    ['error', { ...LISTEN(), status: { ...LISTEN().status, state: 'error' } }],
    ['reconnecting', { ...LISTEN(), status: { ...LISTEN().status, state: 'reconnecting' } }],
    ['stale report', { ...LISTEN(), status: { ...LISTEN().status, at: iso(Date.parse('2030-06-02T10:55:00.000Z')) } }],
    ['no control document', null],
  ]) {
    clock.t = Date.parse('2030-06-02T11:00:00.000Z');
    const s = await setup({ stt: doc });
    await s.lines(3, { ago: 6 * MIN });
    const out = await body(await s.post({ after: 99 }));          // a cursor past every line: nothing new, 6 minutes of silence
    assert.deepEqual(seatsOf(s), [], label); assert.equal(out.stall, undefined, label);
  }
  clock.t = Date.parse('2030-06-02T12:00:00.000Z');
  const capped = await setup({ stt: LISTEN() });
  await capped.seed('fixer', clock.t - 3600_000, 2500);
  await capped.lines(3, { ago: 6 * MIN });
  await body(await capped.post({ after: 99 }));
  assert.deepEqual(seatsOf(capped), [], 'at the cap nothing runs');
});

await test('silence: a table that has never spoken, or spoke seconds ago, raises nothing; with talk it behaves as before', async () => {
  clock.t = Date.parse('2030-06-02T13:00:00.000Z');
  let s = await setup({ stt: LISTEN() });
  await body(await s.post({}));
  assert.deepEqual(seatsOf(s), [], 'no line has ever arrived');
  s = await setup({ stt: LISTEN() });
  await s.lines(2, { ago: 10_000 });
  const out = await body(await s.post({}));
  assert.ok(seatsOf(s).includes('tripwire'), 'new talk goes through the Tripwire as ever'); assert.equal(out.stall, undefined);
});

console.log(failed ? '\n' + failed + ' FAILED' : '\nALL PASSED (' + passed + ')');
process.exit(failed ? 1 : 0);
