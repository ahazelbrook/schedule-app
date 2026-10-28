// The co-GM's hands (C1): the `hands` seat and POST /api/gm/assist/act. The validation rules of design 5.4 one by one (hands.js), then the route on an
// in-memory D1 with a FAKE Anthropic client: no network, no key. Every name and sentence here is invented.
//   node checks/runtime/gm-assist-hands.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { cleanLines, addLines } from '../../functions/_lib/stt.js';
import { CORE_SEATS, COOLDOWN_MS, canRun, budgetTier } from '../../functions/_lib/assist/conductor.js';
import { SEATS, WAKES } from '../../functions/_lib/assist/seats.js';
import { STORY_SEATS, handsUser } from '../../functions/_lib/assist/prompts.js';
import { makeLeases, LEASE_TTL_MS, DEADLINE_MS } from '../../functions/_lib/assist/leases.js';
import { normalise, cleanRange, cleanState, cleanActBody, validateActions, actionKey, STATE_MAX_BYTES, CONFIDENCE_MIN, LINES_MAX } from '../../functions/_lib/assist/hands.js';
import { makeHandler } from '../../functions/api/gm/assist.js';
import { matchApi } from '../../worker/app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }
const GM = { role: 'gm', id: 'gm@example.test' };
const clock = { t: Date.parse('2030-06-01T09:00:00.000Z') };
const iso = (ms) => new Date(ms).toISOString();

// ---------- fixtures: an invented table ----------
const STATE = {
  clocks: [
    { id: 'ck1', name: 'Lamp Oil Running Low', size: 6, filled: 2, hidden: false },
    { id: 'ck2', name: 'Harbour Watch Wakes', size: 4, filled: 4, hidden: true },
    { id: 'ck3', name: 'Empty One', size: 8, filled: 0, hidden: false },
  ],
  npcs: [{ id: 'n1', name: 'Mirelle Tanager' }],
  pcs: [{ id: 'p1', name: 'Odo Vance' }],
  onStage: 'Mirelle Tanager',
};
const row = (seq, text, kind = 'line') => ({ seq, kind, text, at: iso(clock.t), session: '3', speaker: 0 });
const LINES = [
  row(1, "Right, that's going to be a six-segment clock, call it Drains Below."),
  row(2, 'Tick that once, the lamp oil is going.'),
  row(3, "The fence there? His name's Wren Alder, and he wears a green coat."),
  row(4, 'Mirelle looks at you flat.'),
];
const act = (over = {}) => ({ type: 'clock_add', quote: "that's going to be a six-segment clock", at: '09:00', confidence: 0.95, name: 'Drains Below', size: 6, hidden: false, clock_id: '', by: 0, look: '', role: '', bucket: '', text: '', who: '', action: '', position: '', effect: '', result: '', ...over });
const check = (actions, extra = {}) => validateActions(actions, { state: cleanState(STATE), lines: LINES, ...extra });
const body = async (res) => JSON.parse(await res.text());

// ---------- the seat ----------
await test('seat: Haiku 5.5 at low, 1500 tokens, no prefix; Core tier; 8 s cooldown; lease 30 s and deadline 15 s; woken by no flag', () => {
  const h = SEATS.hands;
  assert.deepEqual([h.model, h.effort, h.maxTokens, h.noPrefix], ['claude-haiku-5-5', 'low', 1500, true]);
  assert.ok(CORE_SEATS.includes('hands'));
  assert.equal(COOLDOWN_MS.hands, 8000);
  assert.equal(LEASE_TTL_MS.hands, 30_000); assert.equal(DEADLINE_MS.hands, 15_000);
  assert.ok(!Object.values(WAKES).some((f) => f.includes('hands')) && !('hands' in WAKES), 'a tick never calls it');
  assert.ok(!STORY_SEATS.includes('hands'));
  // Core: it runs at every tier but the cap
  assert.deepEqual(['all', 'reduced', 'core', 'off'].map((tier) => canRun('hands', { now: 1, tier }).ok), [true, true, true, false]);
});

await test('seat: generic instructions, and a flat schema with every field required', () => {
  const h = SEATS.hands;
  assert.ok(!/gm-private|\[\[/.test(h.instructions));
  assert.match(h.instructions, /DECIDED aloud/); assert.match(h.instructions, /Never act on a player's suggestion/); assert.match(h.instructions, /Never invent anything/);
  assert.match(h.instructions, /verbatim/); assert.match(h.instructions, /confidence from 0 to 1/); assert.match(h.instructions, /"That" and "it" mean the clock/);
  const s = h.schema, item = s.properties.actions.items;
  assert.equal(s.additionalProperties, false); assert.deepEqual(s.required, ['actions']);
  assert.equal(item.additionalProperties, false);
  assert.deepEqual(item.required, Object.keys(item.properties), 'every field is required: a field that does not apply is empty');
  assert.deepEqual(item.properties.type.enum, ['clock_add', 'clock_tick', 'npc_add', 'capture', 'roll_log']);
  for (const k of ['anyOf', 'oneOf', 'minimum', 'maximum']) assert.ok(!JSON.stringify(s).includes('"' + k + '"'), k + ' is not used: ranges are checked in code');
});

// ---------- the request ----------
await test('request: from and to are whole numbers, from <= to, at most 200 apart; anything else is not a range', () => {
  assert.deepEqual(cleanRange(5, 5), { from: 5, to: 5 }); assert.deepEqual(cleanRange(0, 200), { from: 0, to: 200 });
  for (const [a, b] of [[5, 4], [-1, 3], [1.5, 3], ['1', 3], [1, null], [undefined, 2], [0, 201], [NaN, 1]]) assert.equal(cleanRange(a, b), null, JSON.stringify([a, b]));
});

await test('request: state is { clocks, npcs, pcs, onStage }; unknown keys go, sizes and fills are checked, the fill is held within the size', () => {
  const s = cleanState({ ...STATE, junk: 1, clocks: [{ ...STATE.clocks[0], filled: 99, extra: 'x' }] });
  assert.deepEqual(s.clocks, [{ id: 'ck1', name: 'Lamp Oil Running Low', size: 6, filled: 6, hidden: false }]);
  assert.equal(s.junk, undefined);
  assert.deepEqual(cleanState({}), { clocks: [], npcs: [], pcs: [], onStage: '' });
  const bad = [null, [], 'x', { clocks: 'x' }, { clocks: [{ id: 'a', name: 'n', size: 0, filled: 0 }] }, { clocks: [{ id: 'a', name: 'n', size: 6, filled: -1 }] }, { clocks: [{ id: 'a', name: 'n', size: 6.5, filled: 0 }] },
    { clocks: [{ id: '', name: 'n', size: 6, filled: 0 }] }, { clocks: [{ id: 'a', name: '', size: 6, filled: 0 }] }, { npcs: [{ id: 'a' }] }, { pcs: [5] }, { onStage: 5 }, { onStage: 'x'.repeat(81) },
    { clocks: Array.from({ length: 41 }, (_, i) => ({ id: 'c' + i, name: 'n', size: 4, filled: 0 })) }, { npcs: Array.from({ length: 101 }, (_, i) => ({ id: 'n' + i, name: 'n' })) }, { pcs: Array.from({ length: 13 }, (_, i) => ({ id: 'p' + i, name: 'n' })) }];
  for (const b of bad) assert.throws(() => cleanState(b), (e) => e.status === 400, JSON.stringify(b).slice(0, 60));
});

await test('request: state is at most 8 KB of UTF-8 JSON, else 400 (counted in bytes, not characters)', () => {
  const sized = (nameLen, ch) => ({ clocks: [], npcs: [{ id: 'n1', name: 'x' }], pcs: [], pad: ch.repeat(nameLen) });
  const exact = (ch, perCh) => { const base = JSON.stringify(sized(0, ch)).length; return Math.floor((STATE_MAX_BYTES - base) / perCh); };
  assert.doesNotThrow(() => cleanState(sized(exact('a', 1), 'a')), '8192 bytes of ASCII is allowed');
  assert.throws(() => cleanState(sized(exact('a', 1) + 1, 'a')), (e) => e.status === 400 && /8 KB/.test(e.message));
  // 2-byte characters: fewer characters, the same byte cap
  const n2 = exact('é', 2);
  assert.doesNotThrow(() => cleanState(sized(n2, 'é')));
  assert.throws(() => cleanState(sized(n2 + 1, 'é')), (e) => e.status === 400);
  assert.throws(() => cleanActBody({ from: 1, to: 2, state: sized(9000, 'a') }), (e) => e.status === 400);
  assert.throws(() => cleanActBody({ from: 1, to: 2 }), (e) => e.status === 400, 'no state');
  assert.throws(() => cleanActBody({ from: 3, to: 2, state: {} }), (e) => e.status === 400, 'a bad range');
  const ok = cleanActBody({ from: 1, to: 4, state: STATE, lines: [{ text: 'ignored' }] });
  assert.deepEqual(Object.keys(ok).sort(), ['from', 'state', 'to'], 'no lines come through from the page');
});

// ---------- validation (design 5.4), one rule at a time ----------
await test('rule: a clock id must be in the state that was sent; the clock\'s name rides along', () => {
  const r = check([act({ type: 'clock_tick', quote: 'Tick that once', clock_id: 'ck1', by: 1 }), act({ type: 'clock_tick', quote: 'Tick that once', clock_id: 'nope', by: 1 }), act({ type: 'clock_tick', quote: 'Tick that once', clock_id: '', by: 1 })]);
  assert.equal(r.actions.length, 1);
  assert.deepEqual([r.actions[0].clock_id, r.actions[0].clock_name, r.actions[0].from_filled, r.actions[0].to_filled, r.actions[0].size], ['ck1', 'Lamp Oil Running Low', 2, 3, 6]);
  assert.deepEqual(r.dropped.map((d) => d.why), ['unknown clock', 'unknown clock']);
});

await test('rule: a new clock\'s size must be 4, 6, 8, 10 or 12', () => {
  for (const size of [4, 6, 8, 10, 12]) assert.equal(check([act({ size })]).actions.length, 1, 'size ' + size);
  for (const size of [0, 1, 3, 5, 7, 9, 11, 13, 100, -6, 6.5, '6', null]) { const r = check([act({ size })]); assert.equal(r.actions.length, 0, 'size ' + size); assert.equal(r.dropped[0].why, 'illegal size'); }
  assert.equal(check([act({ name: '   ' })]).dropped[0].why, 'no name');
});

await test('rule: a new clock is hidden only when hidden is exactly true; undefined, null, false and truthy non-booleans are not hidden', () => {
  const h = (hidden) => check([act({ hidden })]).actions[0].hidden;
  assert.equal(h(true), true);
  for (const v of [undefined, null, false, 'true', 1, 'yes', {}]) assert.equal(h(v), false, String(v));
});

await test('rule: ticks are clamped, to -3..+6 and then to the clock; a tick with nothing left to do is dropped, not sent as zero', () => {
  const t = (clock_id, by) => check([act({ type: 'clock_tick', quote: 'Tick that once', clock_id, by })]);
  assert.equal(t('ck3', 99).actions[0].by, 6, 'ck3 is 0/8: +6 is the most one action does');
  assert.equal(t('ck1', 99).actions[0].by, 4, 'ck1 is 2/6: only four segments left');
  assert.equal(t('ck1', 99).actions[0].to_filled, 6);
  assert.equal(t('ck1', -99).actions[0].by, -2, 'ck1 is 2/6: -3 is the most, and only two can come off');
  assert.equal(t('ck1', -99).actions[0].to_filled, 0);
  assert.equal(t('ck3', -2).actions.length, 0, 'ck3 is empty: nothing to clear'); assert.equal(t('ck3', -2).dropped[0].why, 'no change');
  assert.equal(t('ck2', 1).actions.length, 0, 'ck2 is full'); assert.equal(t('ck2', 1).dropped[0].why, 'no change');
  assert.equal(t('ck2', -3).actions[0].to_filled, 1);
  assert.equal(t('ck1', 2.9).actions[0].by, 2, 'whole segments');
  assert.equal(t('ck1', 0).dropped[0].why, 'no change');
  for (const by of [NaN, '2', null, undefined]) assert.equal(t('ck1', by).dropped[0].why, 'no amount', String(by));
});

await test('rule: a new NPC whose name is already known (an NPC or a PC, any case or punctuation) is dropped and says so', () => {
  const n = (name) => check([act({ type: 'npc_add', quote: 'Mirelle looks at you flat', name })]);
  for (const name of ['Mirelle Tanager', 'mirelle  tanager', 'MIRELLE TANAGER!', 'Odo Vance']) {
    const r = n(name); assert.equal(r.actions.length, 0, name);
    assert.deepEqual(r.dropped, [{ type: 'npc_add', why: 'already known', name: name.replace(/\s+/g, ' ').trim() }], name);
  }
  const ok = check([act({ type: 'npc_add', quote: "His name's Wren Alder", name: 'Wren Alder', look: 'a green coat'.repeat(40), role: 'fence' })]);
  assert.equal(ok.actions.length, 1); assert.equal(ok.actions[0].look.length, 200, 'look is clipped to 200');
  assert.equal(ok.actions[0].role, 'fence');
});

await test('rule: the quote must appear in the lines after normalising (case, punctuation and spacing do not matter); an invented quote drops the action', () => {
  const q = (quote) => check([act({ quote })]);
  assert.equal(q("that's going to be a six-segment clock").actions.length, 1, 'verbatim');
  assert.equal(q("THAT'S GOING TO BE A SIX-SEGMENT CLOCK").actions.length, 1, 'case');
  assert.equal(q('that\u2019s going to be a six segment clock').actions.length, 1, 'a curly apostrophe and a hyphen');
  assert.equal(q('  call   it   Drains   Below  ').actions.length, 1, 'spacing');
  assert.equal(q('Below. Tick that once').actions.length, 1, 'across two lines');
  assert.equal(q('green coat').actions.length, 1, 'inside a line');
  for (const quote of ['the harbour bell rings thrice', "that's going to be a ten-segment clock", 'Wren Alder is a spy']) { const r = q(quote); assert.equal(r.actions.length, 0, quote); assert.equal(r.dropped[0].why, 'quote not in the talk'); }
  assert.equal(q('').dropped[0].why, 'quote not in the talk', 'an empty quote');
  assert.equal(q('call').dropped[0].why, 'quote not in the talk', 'a quote too short to prove anything');
  assert.equal(q('ock call it Drains').actions.length, 0, 'a quote starts and ends on whole words: "ock" is not "clock"');
  assert.equal(q(undefined).actions.length, 0); assert.equal(q(42).actions.length, 0);
  // only the lines the Worker read count: the state's own names and the stamps are not talk
  assert.equal(check([act({ quote: 'Odo Vance' })]).actions.length, 0);
  assert.equal(check([act({ quote: '09:00' })]).actions.length, 0);
  assert.equal(check([act()], { lines: [row(9, 'a mark', 'mark'), row(10, "that's going to be a six-segment clock", 'mark')] }).actions.length, 0, 'a mark is not talk');
});

await test('rule: a confidence under 0.7 comes back as an offer; 0.7 and over is an act; a missing or odd confidence is an offer', () => {
  const m = (confidence) => check([act({ confidence })]).actions[0].mode;
  assert.equal(CONFIDENCE_MIN, 0.7);
  assert.deepEqual([0.69, 0.699, 0, 0.5].map(m), ['offer', 'offer', 'offer', 'offer']);
  assert.deepEqual([0.7, 0.71, 0.95, 1, 7].map(m), ['act', 'act', 'act', 'act', 'act']);
  assert.deepEqual([NaN, '0.9', null, undefined, Infinity].map(m), ['offer', 'offer', 'offer', 'offer', 'offer']);
  assert.equal(check([act({ confidence: 7 })]).actions[0].confidence, 1); assert.equal(check([act({ confidence: 0.123456 })]).actions[0].confidence, 0.12);
});

await test('rule: each action has a stable key (type, normalised target, hash of the line the quote starts on); at, confidence and the amount are not in it', () => {
  const a = check([act()]).actions[0], b = check([act({ at: '10:11', confidence: 0.71 })]).actions[0];
  assert.match(a.key, /^clock_add:drains-below:[0-9a-f]{8}$/);
  assert.equal(a.key, b.key, 'stable across calls');
  assert.equal(check([act({ quote: "THAT'S going to be a six segment clock" })]).actions[0].key, a.key, 'normalised first');
  const t = (quote, by = 1) => check([act({ type: 'clock_tick', quote, clock_id: 'ck1', by })]).actions[0];
  assert.equal(t('Tick that once').key, t('Tick that once', 3).key); assert.match(t('Tick that once').key, /^clock_tick:ck1:/);
  assert.equal(actionKey('npc_add', 'Wren  Alder!', 'x'), actionKey('npc_add', 'wren alder', 'x'));
  assert.notEqual(actionKey('npc_add', 'Wren', 'x'), actionKey('npc_add', 'Wren', 'y'));
  assert.notEqual(actionKey('npc_add', 'Wren', 'x'), actionKey('clock_add', 'Wren', 'x'));
  // the live replay's pair: one line, quoted short in one window and long in the next. The same decision keeps one key.
  const short = t('Tick that once'), long = t('Tick that once, the lamp oil is going.'), mid = t('the lamp oil is going');
  assert.equal(short.key, long.key, 'a short quote and the whole line'); assert.equal(short.key, mid.key, 'a quote that starts mid-line');
  assert.equal(t('Tick that once, the lamp oil is going').key, long.key, 'whatever the punctuation');
  // a different line is a different key, and a quote across two lines takes the first
  const cap = (quote) => check([act({ type: 'capture', quote, bucket: 'moment', text: 'x' })]).actions[0];
  assert.match(cap('Mirelle looks at you flat').key, /^capture:moment:[0-9a-f]{8}$/);
  assert.notEqual(cap("His name's Wren Alder").key, cap('Mirelle looks at you flat').key, 'two lines, one type and target');
  assert.equal(cap('green coat').key, cap('The fence there').key, 'two spans of line 3');
  const nameOf = (quote) => check([act({ quote })]).actions[0].key;
  assert.equal(nameOf('Below. Tick that once'), nameOf('call it Drains Below'), 'across lines 1 and 2: anchored on line 1');
  assert.notEqual(nameOf('Below. Tick that once'), nameOf('Tick that once, the lamp oil'), 'not on line 2');
  // two identical actions in one reply: one survives
  const d = check([act(), act({ at: '09:01' })]);
  assert.equal(d.actions.length, 1); assert.equal(d.dropped[0].why, 'duplicate');
});

await test('validation: capture buckets, roll_log is offer-only, unknown types and non-lists, and no more than 8 actions looked at', () => {
  const cap = (bucket, text) => check([act({ type: 'capture', quote: 'Mirelle looks at you flat', bucket, text })]);
  assert.equal(cap('loose_end', 'who is the fence?').actions[0].bucket, 'loose_end');
  assert.equal(cap('mood', 'x').dropped[0].why, 'unknown bucket'); assert.equal(cap('moment', '  ').dropped[0].why, 'no text');
  const roll = check([act({ type: 'roll_log', quote: 'Tick that once', confidence: 0.99, who: 'Odo', action: 'sneak', position: 'risky', effect: 'bogus', result: 'partial' })]).actions[0];
  assert.deepEqual([roll.mode, roll.position, roll.effect, roll.result], ['offer', 'risky', 'unclear', 'partial'], 'roll_log never acts (the page has no apply path for it yet)');
  assert.equal(check([act({ type: 'harm' })]).dropped[0].why, 'unknown type');
  for (const junk of [undefined, null, 'x', {}, 5]) assert.deepEqual(check(junk), { actions: [], dropped: [] });
  assert.equal(check([null, 5, 'x']).dropped.length, 3);
  const many = check(Array.from({ length: 12 }, (_, i) => act({ type: 'npc_add', quote: "His name's Wren Alder", name: 'Person ' + i })));
  assert.equal(many.actions.length, 8); assert.ok(many.dropped.some((d) => d.why === 'too many'));
});

await test('validation: linear and small, 8 actions over 40 lines is well under a millisecond', () => {
  const lines = Array.from({ length: 40 }, (_, i) => row(i + 1, 'the table talks about the quay and the lamp oil and something else, line ' + i));
  const acts = Array.from({ length: 8 }, (_, i) => act({ type: 'npc_add', quote: 'the table talks about the quay and the lamp oil and something else, line ' + i, name: 'Person ' + i }));
  const st = cleanState(STATE), N = 300;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) validateActions(acts, { state: st, lines });
  const per = (performance.now() - t0) / N;
  assert.ok(per < 2, per.toFixed(3) + ' ms per call');
});

await test('prompt: the user turn is the state as JSON and the window; no prefix text', () => {
  const u = handsUser({ state: cleanState(STATE), stamp: '09:00', talk: '[09:00] S0: hello' });
  assert.match(u, /"id":"ck1"/); assert.match(u, /up to 09:00:\n\[09:00\] S0: hello$/);
});

// ---------- the route ----------
function fakeClient(st, calls) {
  return { messages: { async create(req, opts) {
    calls.push({ req, opts, ins: req.messages[0].content.filter((b) => b.type === 'text')[0].text, user: req.messages[0].content.filter((b) => b.type === 'text').pop().text, blocks: req.messages[0].content.map((b) => b.type) });
    if (st.hold) await st.hold;
    if (st.error) throw st.error;
    return { content: [{ type: 'text', text: typeof st.reply === 'string' ? st.reply : JSON.stringify(st.reply) }], usage: { input_tokens: 2000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, stop_reason: st.stop || 'end_turn' };
  } } };
}
async function setup({ env = {}, pack = true, handlerOpts = {} } = {}) {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec);
  if (pack) await db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'assist', 'v', '{}', 0, ?1)").bind(JSON.stringify({ file_id: 'file_test000001', extra: { hands: 'EXTRA-FOR-HANDS' } })).run();
  const sqls = [], origPrepare = db.prepare.bind(db);
  db.prepare = (sql) => { sqls.push(sql); return origPrepare(sql); };
  const calls = [], st = { reply: { actions: [] } };
  const handler = makeHandler({ clientFor: () => fakeClient(st, calls), now: () => clock.t, ...handlerOpts });
  const e = { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'sk-ant-test-0000', ...env };
  let n = 0;
  const lines = (texts, { session = '3', kind = 'line' } = {}) => addLines(db, 'c', cleanLines({ lines: texts.map((text, i) => ({ id: 'l' + (++n), at: iso(clock.t - 20_000 + n), session, conn: 'x', speaker: 0, text, kind })) }));
  const post = (b, route = 'act') => handler({ request: new Request('https://blades.example.test/api/gm/assist/' + route, { method: 'POST', body: JSON.stringify(b), headers: { 'Content-Type': 'application/json' } }), env: e, data: { me: GM } });
  const rows = () => exec.db.prepare('SELECT * FROM gm_assist_log ORDER BY id').all().map((r) => ({ ...r }));
  const seed = (seat, at, cents = 0, card = null) => db.prepare("INSERT INTO gm_assist_log (campaign, at, session, seat, model, effort, cents, flags, card) VALUES ('c', ?1, '3', ?2, 'm', 'low', ?3, '', ?4)").bind(iso(at), seat, cents, card).run();
  const dump = () => JSON.stringify({ c: exec.db.prepare('SELECT * FROM campaigns').all(), n: exec.db.prepare('SELECT * FROM npcs ORDER BY id').all(), p: exec.db.prepare('SELECT * FROM gm_pack ORDER BY part').all() });
  return { exec, db, calls, st, post, lines, rows, seed, dump, sqls, env: e, handler };
}
const TALK = ["Right, that's going to be a six-segment clock, call it Drains Below.", 'Tick that once, the lamp oil is going.', "The fence there? His name's Wren Alder, and he wears a green coat.", 'Mirelle looks at you flat.'];
const REQ = { from: 1, to: 4, state: STATE };
const good = (over) => act(over);

await test('route: /api/gm/assist/act is wired (with or without a slash); a player or the display gets 403 before anything is read', async () => {
  const real = matchApi('/api/gm/assist/act');
  assert.ok(real && real.handler); assert.equal(matchApi('/api/gm/assist/act/').handler, real.handler); assert.equal(matchApi('/api/gm/assist/acts').handler, matchApi('/api/gm/nope').handler, 'only the one name');
  const touched = [];
  const request = { method: 'POST', url: 'https://blades.example.test/api/gm/assist/act', headers: new Headers(), json() { touched.push('json'); throw new Error('read'); }, text() { touched.push('text'); throw new Error('read'); }, arrayBuffer() { touched.push('buf'); throw new Error('read'); } };
  const env = { get DB() { touched.push('DB'); return undefined; }, get ANTHROPIC_API_KEY() { touched.push('key'); return 'k'; }, CAMPAIGN: 'x' };
  for (const me of [{ role: 'player', id: 'p@example.test' }, { role: 'display', id: 'd@example.test' }, undefined]) {
    let err = null; try { await real.handler({ request, env, data: { me } }); } catch (e) { err = e; }
    assert.ok(err && err.status === 403);
  }
  assert.deepEqual(touched, []);
});

await test('route: every bad request is a 400 before the database or the key are touched (no key set, DB getter would throw), and a GET is a 405', async () => {
  const s = await setup({ env: { ANTHROPIC_API_KEY: undefined }, handlerOpts: { clientFor: undefined } });
  let touched = 0; Object.defineProperty(s.env, 'DB', { get() { touched++; return s.db; } });
  const bigState = { clocks: [], npcs: [{ id: 'n', name: 'x' }], pcs: [], pad: 'a'.repeat(9000) };
  for (const b of [{}, { from: 1 }, { from: 2, to: 1, state: STATE }, { from: 1, to: 999, state: STATE }, { from: 1, to: 4 }, { from: 1, to: 4, state: 'x' }, { from: 1, to: 4, state: bigState }, { from: 1, to: 4, state: { clocks: [{ id: 'a', name: 'b', size: 99, filled: 0 }] } }]) {
    await assert.rejects(s.post(b), (e) => e.status === 400, JSON.stringify(b).slice(0, 50));
  }
  assert.equal(touched, 0); assert.equal(s.calls.length, 0);
  await assert.rejects(s.post('not an object'), (e) => e.status === 400);
  // with a good body and no key: 503, and only then
  await assert.rejects(s.post(REQ), (e) => e.status === 503);
  const get = await s.handler({ request: new Request('https://blades.example.test/api/gm/assist/act', { method: 'GET' }), env: s.env, data: { me: GM } });
  assert.equal(get.status, 405);
});

await test('route: a state over 8 KB is a 400 (not the generic 413), and a body far over is refused as too large', async () => {
  const s = await setup();
  await assert.rejects(s.post({ ...REQ, state: { clocks: [], npcs: [{ id: 'n', name: 'x' }], pcs: [], pad: 'a'.repeat(STATE_MAX_BYTES) } }), (e) => e.status === 400 && /8 KB/.test(e.message));
  await assert.rejects(s.post({ ...REQ, state: { pad: 'a'.repeat(40 * 1024) } }), (e) => e.status === 413);
});

await test('route: the Worker reads lines from..to from D1 itself; lines the page sends are ignored, and an invented quote is dropped while a real one is kept', async () => {
  const s = await setup();
  await s.lines(TALK);
  s.st.reply = { actions: [
    good(),                                                                                                 // real
    good({ type: 'npc_add', quote: "His name's Wren Alder", name: 'Wren Alder', look: 'a green coat', role: 'fence' }),   // real
    good({ type: 'clock_add', quote: 'a clock for the ferry bell tolling', name: 'Ferry Bell', size: 4 }),       // INVENTED: nobody said it
    good({ type: 'clock_tick', quote: 'The page said this phrase unique-zebra-quote', clock_id: 'ck1', by: 1 }),  // said only in the page\'s own `lines`
  ] };
  const res = await s.post({ ...REQ, lines: [{ seq: 9, kind: 'line', text: 'The page said this phrase unique-zebra-quote', at: iso(clock.t), session: '3', speaker: 0 }] });
  assert.equal(res.status, 200);
  const out = await body(res);
  assert.deepEqual(out.actions.map((a) => a.type), ['clock_add', 'npc_add']);
  assert.deepEqual(out.dropped.map((d) => d.why), ['quote not in the talk', 'quote not in the talk']);
  assert.ok(out.actions.every((a) => typeof a.key === 'string' && a.mode === 'act'));
  assert.equal(s.calls.length, 1);
  assert.ok(!JSON.stringify(s.calls[0].req).includes('unique-zebra-quote'), 'the page\'s lines never reached the seat');
  assert.match(s.calls[0].user, /\[\d\d:\d\d\] S0: Right, that's going to be a six-segment clock/);
  assert.match(s.calls[0].user, /"id":"ck1"/);
  assert.equal(typeof out.spend.tonight, 'number'); assert.ok(out.spend.tick > 0);
});

await test('route: the seat gets no prefix: no document block, no file id, and not even the vault-built extra for hands', async () => {
  const s = await setup();
  await s.lines(TALK);
  await s.post(REQ);
  const c = s.calls[0];
  assert.ok(!c.blocks.includes('document'), 'blocks: ' + c.blocks);
  const wire = JSON.stringify(c.req);
  assert.ok(!wire.includes('file_test000001') && !wire.includes('file_id') && !wire.includes('EXTRA-FOR-HANDS'));
  assert.deepEqual(c.blocks, ['text', 'text']);
  assert.equal(c.req.model, 'claude-haiku-5-5'); assert.equal(c.req.max_tokens, 1500); assert.deepEqual(c.req.output_config.effort, 'low');
  assert.equal(c.req.output_config.format.type, 'json_schema');
  assert.deepEqual(c.opts && c.opts.timeout, 15_000, 'the 15 s deadline and one retry go on the call'); assert.equal(c.opts.maxRetries, 1);
});

await test('route: it needs no assist part (none in the pack, a legacy one, a bad one): it still runs, with no warning', async () => {
  for (const pack of [false]) {
    const s = await setup({ pack });
    await s.lines(TALK); s.st.reply = { actions: [good()] };
    const out = await body(await s.post(REQ));
    assert.equal(out.actions.length, 1); assert.equal(out.warnings, undefined);
  }
  const s2 = await setup({ pack: false });
  await s2.db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'assist', 'v', '{}', 0, ?1)").bind(JSON.stringify({ prefix: 'LEGACY PREFIX TEXT' })).run();
  await s2.lines(TALK); s2.st.reply = { actions: [good()] };
  const out2 = await body(await s2.post(REQ));
  assert.equal(out2.actions.length, 1); assert.equal(out2.warnings, undefined); assert.ok(!JSON.stringify(s2.calls[0].req).includes('LEGACY PREFIX'));
});

await test('CPU: exactly one read of the transcript, one read for spend and the last run, one for speakers, one log write; nothing else', async () => {
  const s = await setup();
  await s.lines(TALK);
  s.sqls.length = 0;
  s.st.reply = { actions: [good()] };
  await s.post(REQ);
  const touches = s.sqls.filter((q) => /gm_transcript/.test(q));
  assert.equal(touches.length, 1, 'transcript reads: ' + touches.length);
  assert.match(touches[0], /seq BETWEEN \?2 AND \?3/); assert.match(touches[0], /LIMIT \?4/);
  assert.equal(s.sqls.length, 5, 'four reads and writes plus the tonight-keys read, which shares a batch with the log write: ' + s.sqls.map((q) => q.slice(0, 60)).join(' | '));
  assert.ok(!s.sqls.some((q) => /gm_pack/.test(q)), 'the assist part is never read');
  assert.ok(!s.sqls.some((q) => /campaigns|npcs/.test(q)), 'the table\'s own data is never read: the page sent its state');
});

await test('lines: at most 40, the latest 40 of the range; marks are not read; an empty range makes no call and writes no row', async () => {
  const s = await setup();
  await s.lines(Array.from({ length: 30 }, (_, i) => 'filler talk number ' + (i + 1)));
  await s.lines(Array.from({ length: 30 }, (_, i) => 'filler talk number ' + (i + 31)));
  await s.lines(['a mark here'], { kind: 'mark' });
  s.st.reply = { actions: [] };
  await s.post({ from: 1, to: 61, state: STATE });
  const talk = s.calls[0].user.split('\n').filter((l) => /^\[\d\d:\d\d\] /.test(l));
  assert.equal(talk.length, LINES_MAX); assert.ok(talk[0].includes('filler talk number 21') && talk[39].includes('filler talk number 60'), talk[0] + ' .. ' + talk[39]);
  assert.ok(!s.calls[0].user.includes('a mark here'));
  // a window past the end of the transcript is empty: nothing to read, nothing to ask, nothing to pay
  clock.t += 9_000;
  const before = s.calls.length, rowsBefore = s.rows().length;
  const out = await body(await s.post({ from: 500, to: 520, state: STATE }));
  assert.deepEqual([out.actions, out.dropped, s.calls.length - before, s.rows().length - rowsBefore], [[], [], 0, 0]);
  assert.ok(!('health' in out), 'no health on an act answer');
});

await test('route: it applies nothing: the campaign\'s clocks, the NPC table and the pack are byte-identical after an act that returns clock_add, clock_tick and npc_add', async () => {
  const s = await setup();
  await s.db.prepare("INSERT INTO campaigns (id, updated_at, doc) VALUES ('c', ?1, ?2)").bind(iso(clock.t), JSON.stringify({ clocks: [{ id: 'ck1', name: 'Lamp Oil Running Low', size: 6, filled: 2, kind: 'danger', hidden: false }] })).run();
  await s.lines(TALK);
  const before = s.dump();
  s.st.reply = { actions: [good(), good({ type: 'clock_tick', quote: 'Tick that once', clock_id: 'ck1', by: 1 }), good({ type: 'npc_add', quote: "His name's Wren Alder", name: 'Wren Alder' })] };
  const out = await body(await s.post(REQ));
  assert.deepEqual(out.actions.map((a) => a.type), ['clock_add', 'clock_tick', 'npc_add']);
  assert.equal(s.dump(), before);
  assert.ok(before.includes('Lamp Oil Running Low'));
});

await test('route: one log row, seat hands, flags act, never shown (it must not hold back a card), with the actions and what was dropped', async () => {
  const s = await setup();
  await s.lines(TALK);
  s.st.reply = { actions: [good(), good({ type: 'clock_add', quote: 'a clock for the ferry bell tolling', name: 'Ferry Bell', size: 4 })] };
  await s.post(REQ);
  const rows = s.rows();
  assert.equal(rows.length, 1); const r = rows[0];
  assert.deepEqual([r.seat, r.flags, r.model, r.effort], ['hands', 'act', 'claude-haiku-5-5', 'low']);
  assert.ok(r.cents > 0 && r.input_tokens === 2000 && r.cache_read === 0);
  const card = JSON.parse(r.card);
  assert.equal(card.shown, 0); assert.equal(card.update, undefined); assert.equal(card.act, 1);
  assert.deepEqual([card.from, card.to, card.n], [1, 4, 4]);
  assert.deepEqual(card.actions.map((a) => [a.type, a.mode]), [['clock_add', 'act']]);
  assert.deepEqual(card.dropped, [{ type: 'clock_add', why: 'quote not in the talk' }]);
  assert.ok(card.secs >= 0 && card.stop === 'end_turn');
  assert.equal(r.session, '3');
});

await test('route: confidence under 0.7 reaches the page as an offer', async () => {
  const s = await setup();
  await s.lines(TALK);
  s.st.reply = { actions: [good({ confidence: 0.69 }), good({ type: 'npc_add', quote: "His name's Wren Alder", name: 'Wren Alder', confidence: 0.7 })] };
  const out = await body(await s.post(REQ));
  assert.deepEqual(out.actions.map((a) => [a.type, a.mode]), [['clock_add', 'offer'], ['npc_add', 'act']]);
});

await test('route: a refusal, a cut-off and unusable JSON show nothing, and the row says why', async () => {
  for (const [stop, reply, why] of [['refusal', { actions: [good()] }, 'refusal'], ['max_tokens', { actions: [good()] }, 'cut off'], ['end_turn', 'not json at all', 'no JSON'], ['end_turn', { nope: 1 }, 'no JSON']]) {
    const s = await setup();
    await s.lines(TALK); s.st.stop = stop; s.st.reply = reply;
    const out = await body(await s.post(REQ));
    assert.deepEqual([out.actions, out.dropped], [[], []], why);
    const card = JSON.parse(s.rows()[0].card);
    assert.equal(card.error, why); assert.equal(card.shown, 0); if (stop === 'refusal') assert.equal(card.refusal, 1); if (stop === 'max_tokens') assert.equal(card.truncated, 1);
  }
});

await test('route: a provider error is a short status, a deadline is a timeout row; neither shows an action, neither leaks the key', async () => {
  const s = await setup();
  await s.lines(TALK);
  s.st.error = Object.assign(new Error('boom sk-ant-test-0000'), { status: 529 });
  const out = await body(await s.post(REQ));
  assert.deepEqual(out.actions, []); assert.deepEqual(out.errors, [{ seat: 'hands', error: 'provider status 529' }]);
  assert.ok(!JSON.stringify(out).includes('sk-ant'));
  assert.ok(!('health' in out), 'no health on an act answer');
  // a model that never answers: the seat's own deadline ends it
  const s2 = await setup({ handlerOpts: { deadlines: { hands: 30 } } });
  await s2.lines(TALK); s2.st.hold = new Promise(() => {});
  const out2 = await body(await s2.post(REQ));
  assert.deepEqual(out2.errors, [{ seat: 'hands', error: 'timed out' }]);
  const card = JSON.parse(s2.rows()[0].card); assert.equal(card.timeout, 1); assert.equal(card.shown, 0);
});

await test('route: one at a time (429 busy), at most every 8 s (429 cooling down, then fine at 8 s), and it runs to the cap (core tier) but not past it', async () => {
  const s = await setup();
  await s.lines(TALK);
  s.st.reply = { actions: [] };
  // busy: the first call is held at the provider
  let release; s.st.hold = new Promise((r) => { release = r; });
  const first = s.post(REQ);
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(s.post(REQ), (e) => e.status === 429 && /busy/.test(e.message));
  release(); await first;
  s.st.hold = null;
  // cooling down
  clock.t += 7_000;
  await assert.rejects(s.post(REQ), (e) => e.status === 429 && /cooling down/.test(e.message));
  clock.t += 1_000;
  assert.equal((await s.post(REQ)).status, 200);
  // the ladder: 90% of the cap (core tier) still runs; at the cap it does not
  clock.t += 60_000;
  await s.seed('ref', clock.t - 1000, 2700);                       // $27 of the $30 default cap
  assert.equal(budgetTier(27, 30), 'core');
  assert.equal((await s.post(REQ)).status, 200, 'core tier: hands still runs');
  clock.t += 60_000;
  await s.seed('ref', clock.t - 1000, 300);                        // $30: the cap
  await assert.rejects(s.post(REQ), (e) => e.status === 429 && /cap/.test(e.message));
});

await test('route: it leaves the tick\'s reaped report alone, and a hung hands lease lapses on its own', async () => {
  const leases = makeLeases();
  const s = await setup({ handlerOpts: { leases } });
  await s.lines(TALK);
  s.st.reply = { actions: [good()] };
  leases.acquire('ref', clock.t - 100_000);                         // a Ref lease from a cancelled tick, long past its ttl
  const out = await body(await s.post(REQ));
  assert.ok(!('health' in out), 'no health on an act answer: an empty skipped would reset the other seats\' stuck streaks in healthStep');
  assert.deepEqual(leases.takeReaped(), ['ref'], 'the lapse is still there for the tick to report');
  // a stuck hands lease (its request was killed) lapses at 30 s
  const L2 = makeLeases(); const s2 = await setup({ handlerOpts: { leases: L2 } });
  await s2.lines(TALK); s2.st.reply = { actions: [] };
  L2.acquire('hands', clock.t);
  await assert.rejects(s2.post(REQ), (e) => e.status === 429);
  clock.t += 31_000;
  assert.equal((await s2.post(REQ)).status, 200);
});

await test('route: the same window sent twice gives the same keys, so the page can dedupe', async () => {
  const s = await setup();
  await s.lines(TALK);
  s.st.reply = { actions: [good(), good({ type: 'clock_tick', quote: 'Tick that once', clock_id: 'ck1', by: 1 })] };
  const a = await body(await s.post(REQ));
  clock.t += 9_000;
  const b = await body(await s.post(REQ));
  assert.deepEqual(a.actions.map((x) => x.key), b.actions.map((x) => x.key));
  assert.equal(new Set(a.actions.map((x) => x.key)).size, 2);
  // a model that copies a different span of the same lines the second time (the live replay saw this) still gives the same keys, even in a narrower window
  clock.t += 9_000;
  s.st.reply = { actions: [good({ quote: "Right, that's going to be a six-segment clock, call it Drains Below." }), good({ type: 'clock_tick', quote: 'the lamp oil is going', clock_id: 'ck1', by: 2 })] };
  const c = await body(await s.post({ ...REQ, from: 2, to: 3 }));
  assert.deepEqual(c.actions.map((x) => x.type), ['clock_tick'], 'line 1 is outside the narrower window: its quote is not in the talk');
  assert.equal(c.actions[0].key, a.actions[1].key);
  clock.t += 9_000;
  const d = await body(await s.post(REQ));
  assert.deepEqual(d.actions.map((x) => x.key), a.actions.map((x) => x.key));
});

// ---------- C4c: the cue (/act mode 'cue') ----------
import { CUE_TYPES, markSeen } from '../../functions/_lib/assist/hands.js';
import { CUE_INSTRUCTION } from '../../functions/_lib/assist/seats.js';

// the invented cue: line 2 holds the wake word; the command runs on into line 3
const CUE_TALK = ['Okay so the dockside is quiet tonight.', 'Blade, make a six clock called Harbour Bell', 'and mark two on it. Anyway, back to the quay.', 'The crew look at each other.'];
const CUE_LINES = CUE_TALK.map((text, i) => ({ ...row(i + 1, text), id: 'l' + (i + 1) }));
const CUE_ONE = 'Blade, make a six clock called Harbour Bell', CUE_TWO = 'Blade, make a six clock called Harbour Bell and mark two on it';
const pa = (over = {}) => ({ type: 'clock_add', quote: CUE_TWO, name: 'Harbour Bell', size: 6, hidden: true, filled: 2, ...over });
const cueCheck = (raw, over = {}) => validateActions(raw, { state: cleanState(STATE), lines: CUE_LINES, cue: { parsed: true, cueLineId: 'l2' }, ...over });
const CREQ = { from: 1, to: 4, state: STATE, mode: 'cue', cueLineId: 'l2' };

await test('cue body: mode is absent or cue; parsed is 1-8 objects, needs mode cue and a cueLineId; a window body keeps its old shape', () => {
  assert.deepEqual(cleanActBody({ from: 1, to: 4, state: STATE }), { from: 1, to: 4, state: cleanState(STATE) });
  const ok = cleanActBody({ ...CREQ, parsed: [pa()] });
  assert.deepEqual([ok.mode, ok.cueLineId, ok.parsed.length], ['cue', 'l2', 1]);
  const noParse = cleanActBody(CREQ);
  assert.deepEqual([noParse.mode, noParse.parsed, noParse.cueLineId], ['cue', null, 'l2']);
  assert.equal(cleanActBody({ from: 1, to: 4, state: STATE, mode: 'cue' }).cueLineId, '', 'the model path may come without the id');
  const bads = [{ mode: 'window' }, { mode: 'cuee' }, { mode: 'cue', parsed: [] }, { mode: 'cue', parsed: 'x', cueLineId: 'l2' }, { mode: 'cue', parsed: [pa()] },
    { mode: 'cue', parsed: [pa(), 'x'], cueLineId: 'l2' }, { mode: 'cue', parsed: Array.from({ length: 9 }, () => pa()), cueLineId: 'l2' }, { parsed: [pa()], cueLineId: 'l2' },
    { mode: 'cue', cueLineId: 5 }, { mode: 'cue', cueLineId: '' }, { mode: 'cue', cueLineId: 'x'.repeat(65) }];
  for (const b of bads) assert.throws(() => cleanActBody({ from: 1, to: 4, state: STATE, ...b }), (e) => e.status === 400, JSON.stringify(b).slice(0, 60));
  assert.equal(cleanActBody({ ...CREQ, parsed: Array.from({ length: 8 }, () => pa()) }).parsed.length, 8);
});

await test('cue validation: the six cue types act; every survivor is mode act (confidence 1), whatever was sent', () => {
  assert.deepEqual(CUE_TYPES, ['clock_add', 'clock_tick', 'npc_add', 'capture', 'undo', 'rename']);
  const v = cueCheck([pa({ confidence: 0.1 }), { type: 'clock_tick', quote: CUE_TWO, clock_id: 'ck1', by: 2 }, { type: 'npc_add', quote: CUE_TWO, name: 'Corvin Lathe', look: 'tall', role: 'porter' },
    { type: 'capture', quote: CUE_TWO, bucket: 'loose_end', text: 'who owns the bell' }, { type: 'undo', quote: CUE_TWO }, { type: 'rename', quote: CUE_TWO, name: 'Big Ben' }]);
  assert.deepEqual(v.actions.map((a) => [a.type, a.mode, a.confidence]), [['clock_add', 'act', 1], ['clock_tick', 'act', 1], ['npc_add', 'act', 1], ['capture', 'act', 1], ['undo', 'act', 1], ['rename', 'act', 1]]);
  assert.deepEqual(v.dropped, []);
  assert.deepEqual(v.actions[0], { type: 'clock_add', mode: 'act', quote: CUE_TWO, at: '', confidence: 1, key: v.actions[0].key, name: 'Harbour Bell', size: 6, hidden: true, filled: 2 });
  assert.deepEqual([v.actions[1].by, v.actions[1].to_filled, v.actions[5].name], [2, 4, 'Big Ben']);
  // a roll_log is not a cue command, and the other hands rules still hold
  const bad = cueCheck([{ type: 'roll_log', quote: CUE_TWO, who: 'Odo', action: 'hunt' }, pa({ size: 7 }), pa({ name: '' }), { type: 'clock_tick', quote: CUE_TWO, clock_id: 'nope', by: 1 }, { type: 'npc_add', quote: CUE_TWO, name: 'Mirelle Tanager' }, { type: 'rename', quote: CUE_TWO, name: '   ' }]);
  assert.deepEqual(bad.actions, []); assert.deepEqual(bad.dropped.map((d) => d.why), ['unknown type', 'illegal size', 'no name', 'unknown clock', 'already known', 'no name']);
});

await test('cue validation: undo and rename are accepted only from the page: a window, or the model\'s reading of a cue, drops them (and a window drops roll_log only into an offer)', () => {
  const raw = [{ type: 'undo', quote: CUE_TWO, confidence: 1 }, { type: 'rename', quote: CUE_TWO, name: 'Big Ben', confidence: 1 }, pa({ confidence: 1 })];
  for (const cue of [undefined, { parsed: false, cueLineId: 'l2' }]) {
    const v = validateActions(raw, { state: cleanState(STATE), lines: CUE_LINES, cue });
    assert.deepEqual(v.actions.map((a) => a.type), ['clock_add']);
    assert.deepEqual(v.dropped.map((d) => [d.type, d.why]), [['undo', 'unknown type'], ['rename', 'unknown type']]);
  }
  const win = validateActions([{ type: 'roll_log', quote: CUE_TWO, who: 'Odo', action: 'hunt', confidence: 1 }], { state: cleanState(STATE), lines: CUE_LINES });
  assert.deepEqual(win.actions.map((a) => [a.type, a.mode]), [['roll_log', 'offer']], 'a window still treats roll_log as an offer');
});

await test('cue validation: a rename is capped at 80 characters', () => {
  const v = cueCheck([{ type: 'rename', quote: CUE_TWO, name: 'Z'.repeat(200) }]);
  assert.equal(v.actions[0].name.length, 80);
});

await test('cue validation: filled is clamped to 0..size (and truncated); a missing or odd one is 0; a window action gets filled 0 too', () => {
  const f = (filled, size = 6) => cueCheck([pa({ filled, size })]).actions[0].filled;
  assert.deepEqual([f(2), f(99), f(-4), f(2.9), f(6), f(0)], [2, 6, 0, 2, 6, 0]);
  assert.deepEqual([f(undefined), f('3'), f(NaN), f(null), f(4, 4), f(9, 4)], [0, 0, 0, 0, 4, 4]);
  assert.equal(check([act()]).actions[0].filled, 0);
  assert.equal(check([act({ filled: 3 })]).actions[0].filled, 3);
});

await test('cue quote: a one-line quote and a two-line quote (consecutive lines joined with one space) both pass; one that is not in the lines is dropped', () => {
  assert.equal(cueCheck([pa({ quote: CUE_ONE })]).actions.length, 1);
  assert.equal(cueCheck([pa({ quote: CUE_TWO })]).actions.length, 1, 'wake word on line 2, the command on line 3');
  assert.equal(cueCheck([pa({ quote: 'Blade, make a six clock called Harbour Bell and  MARK two on it.' })]).actions.length, 1, 'after the usual normalisation');
  const lost = cueCheck([pa({ quote: 'Blade, make a six clock called Harbour Bell and also tick the other one' })]);
  assert.deepEqual([lost.actions.length, lost.dropped.map((d) => d.why)], [0, ['quote not in the talk']]);
  assert.deepEqual(cueCheck([pa({ quote: '' }), pa({ quote: 'Blade' })]).dropped.map((d) => d.why), ['quote not in the talk', 'quote not in the talk']);
  // two lines that are not neighbours do not join
  const gap = validateActions([pa({ quote: 'Blade, make a six clock called Harbour Bell the crew look at each other' })], { state: cleanState(STATE), lines: CUE_LINES, cue: { parsed: true, cueLineId: 'l2' } });
  assert.equal(gap.actions.length, 0);
});

await test('cue quote: it must START on the cue line: a quote from an earlier line, or only said after it, is dropped; an unknown cue line drops everything', () => {
  const early = cueCheck([pa({ quote: 'Okay so the dockside is quiet tonight. Blade, make a six clock called Harbour Bell' })]);
  assert.deepEqual([early.actions.length, early.dropped.map((d) => d.why)], [0, ['quote not in the talk']], 'it starts on line 1: the search begins at the cue line, so it is not found');
  const later = cueCheck([pa({ quote: 'The crew look at each other' })]);
  assert.deepEqual([later.actions.length, later.dropped.map((d) => d.why)], [0, ['quote not on the cue line']]);
  const none = cueCheck([pa()], { cue: { parsed: true, cueLineId: 'zzz' } });
  assert.deepEqual([none.actions.length, none.dropped.map((d) => d.why)], [0, ['cue line not in the talk']]);
});

await test('cue keys: from cueLineId and the action\'s index alone, not the quote, type or target; the model\'s cue reading derives them the same way', () => {
  const a = cueCheck([pa(), pa({ type: 'capture', bucket: 'moment', text: 'x', name: '', size: 0 })]).actions.map((x) => x.key);
  const b = cueCheck([pa({ quote: CUE_ONE, name: 'Another Name' }), { type: 'undo', quote: CUE_ONE }]).actions.map((x) => x.key);
  assert.deepEqual(a, b, 'a second page that read the command differently, or joined it differently, still gets the same keys');
  assert.equal(new Set(a).size, 2); assert.match(a[0], /^cue:[0-9a-f]{8}:0$/); assert.match(a[1], /:1$/);
  const other = validateActions([pa()], { state: cleanState(STATE), lines: CUE_LINES.map((l) => ({ ...l, id: 'm' + l.id })), cue: { parsed: true, cueLineId: 'ml2' } }).actions[0].key;
  assert.notEqual(other, a[0], 'another cue line, another key');
  // the index is the position in what was sent: a dropped action does not shift the ones after it
  const k = cueCheck([pa({ size: 7 }), pa()]).actions;
  assert.deepEqual(k.map((x) => x.key), [a[0].replace(/:0$/, ':1')]);
  const m = validateActions([pa()], { state: cleanState(STATE), lines: CUE_LINES, cue: { parsed: false, cueLineId: 'l2' } }).actions[0];
  assert.equal(m.key, a[0], 'the model path, with a cueLineId, keys the same way: a page that parsed and a page that asked the model act once');
  assert.equal(m.mode, 'act');
  const noId = validateActions([pa({ confidence: 0.3 })], { state: cleanState(STATE), lines: CUE_LINES, cue: { parsed: false, cueLineId: '' } }).actions[0];
  assert.match(noId.key, /^clock_add:/); assert.equal(noId.mode, 'act', 'a cue is always act, even at low confidence');
});

await test('markSeen: only the keys in the set change mode, and nothing else about them', () => {
  const [x, y] = cueCheck([pa(), { type: 'undo', quote: CUE_ONE }]).actions;
  const out = markSeen([x, y], new Set([y.key]));
  assert.deepEqual([out[0], out[1]], [x, { ...y, mode: 'seen' }]);
});

// ---------- the route, parsed ----------
const noModel = () => { throw new Error('the model was called'); };
const cueSetup = async (o = {}) => {
  const s = await setup({ handlerOpts: { clientFor: noModel, call: noModel }, ...o });
  await s.lines(CUE_TALK);
  return s;
};
const rowCount = (s) => s.rows().length;

await test('route, parsed: no model call (a client and a call that throw if touched), no API key needed, one hands row with out.cue and spend 0, and the answer carries the actions as act', async () => {
  const s = await cueSetup({ env: { ANTHROPIC_API_KEY: undefined } });
  const res = await s.post({ ...CREQ, parsed: [pa(), { type: 'rename', quote: CUE_TWO, name: 'Big Ben' }] });
  assert.equal(res.status, 200);
  const out = await body(res);
  assert.deepEqual(out.actions.map((a) => [a.type, a.mode]), [['clock_add', 'act'], ['rename', 'act']]);
  assert.deepEqual([out.actions[0].filled, out.actions[1].name], [2, 'Big Ben']);
  assert.deepEqual(out.dropped, []); assert.equal(out.spend.tick, 0); assert.equal(out.errors, undefined);
  assert.equal(s.calls.length, 0);
  const rows = s.rows(); assert.equal(rows.length, 1);
  const r = rows[0], card = JSON.parse(r.card);
  assert.deepEqual([r.seat, r.flags, r.cents, r.input_tokens, r.output_tokens], ['hands', 'act,cue', 0, 0, 0]);
  assert.equal(card.out.cue, true); assert.equal(card.shown, 0); assert.equal(card.cue_line, 'l2');
  assert.deepEqual(card.actions.map((a) => a.key), out.actions.map((a) => a.key));
  assert.equal(r.session, '3');
});

await test('route, parsed: it works at the cap and inside the 8 s cooldown (it costs nothing), and a cue row does not start the window cooldown', async () => {
  const s = await cueSetup();
  await s.seed('ref', clock.t - 1000, 3000);                       // $30: the cap
  await s.seed('hands', clock.t - 1000, 0);                        // a window run a second ago
  const out = await body(await s.post({ ...CREQ, parsed: [pa()] }));
  assert.equal(out.actions[0].mode, 'act'); assert.equal(out.spend.tier, 'off');
  // a window run, after the cue row, is gated by the cooldown from the REAL window row only
  const s2 = await setup();
  await s2.lines(CUE_TALK); s2.st.reply = { actions: [] };
  await s2.post({ ...CREQ, parsed: [pa()] });
  assert.equal((await s2.post({ from: 1, to: 4, state: STATE })).status, 200, 'a window right after a cue row is not cooling down');
});

await test('route, parsed: a cueLineId that is not among the lines read is a 400, with no row; so is a range with no lines', async () => {
  const s = await cueSetup();
  await assert.rejects(s.post({ ...CREQ, cueLineId: 'nope', parsed: [pa()] }), (e) => e.status === 400 && /cueLineId/.test(e.message));
  await assert.rejects(s.post({ ...CREQ, from: 3, to: 4, parsed: [pa()] }), (e) => e.status === 400, 'l2 is outside 3..4');
  await assert.rejects(s.post({ ...CREQ, from: 500, to: 520, parsed: [pa()] }), (e) => e.status === 400);
  assert.equal(rowCount(s), 0);
});

await test('route, parsed: a quote that is not in the lines is dropped (and reported), and a cue whose actions were all dropped still logs its row', async () => {
  const s = await cueSetup();
  const out = await body(await s.post({ ...CREQ, parsed: [pa({ quote: 'Blade, make a nine clock called Nonsense Gate' }), pa()] }));
  assert.deepEqual(out.actions.map((a) => a.key.slice(-2)), [':1']);
  assert.deepEqual(out.dropped, [{ type: 'clock_add', why: 'quote not in the talk' }]);
  const s2 = await cueSetup();
  const out2 = await body(await s2.post({ ...CREQ, parsed: [pa({ quote: 'something nobody said at all' })] }));
  assert.deepEqual([out2.actions, out2.dropped.length, rowCount(s2)], [[], 1, 1]);
});

await test('route, parsed: it applies nothing (campaign, NPC table and pack are byte-identical)', async () => {
  const s = await cueSetup();
  const before = s.dump();
  await s.post({ ...CREQ, parsed: [pa(), { type: 'npc_add', quote: CUE_TWO, name: 'Corvin Lathe' }] });
  assert.equal(s.dump(), before);
});

await test('route, parsed: the same cue posted again is seen: no second row, and the action is still returned, as seen', async () => {
  const s = await cueSetup();
  const first = await body(await s.post({ ...CREQ, parsed: [pa(), { type: 'undo', quote: CUE_TWO }] }));
  assert.deepEqual(first.actions.map((a) => a.mode), ['act', 'act']);
  const again = await body(await s.post({ ...CREQ, parsed: [pa(), { type: 'undo', quote: CUE_TWO }] }));
  assert.deepEqual(again.actions.map((a) => [a.type, a.mode, a.key]), first.actions.map((a) => [a.type, 'seen', a.key]));
  assert.equal(rowCount(s), 1);
  // another page that read the command differently (a different quote, a different name) has the same cueLineId and index: seen
  const other = await body(await s.post({ ...CREQ, parsed: [pa({ quote: CUE_ONE, name: 'Other Name', filled: 0 })] }));
  assert.deepEqual(other.actions.map((a) => a.mode), ['seen']);
  // an action of the same cue that is new (index 2) acts, and the cue's seen ones do not block it
  const more = await body(await s.post({ ...CREQ, parsed: [pa(), { type: 'undo', quote: CUE_TWO }, { type: 'capture', quote: CUE_TWO, bucket: 'name', text: 'the bell' }] }));
  assert.deepEqual(more.actions.map((a) => a.mode), ['seen', 'seen', 'act']);
  assert.equal(rowCount(s), 2);
  const card = JSON.parse(s.rows()[1].card); assert.deepEqual(card.actions.map((a) => a.type), ['capture'], 'the row holds only what this call won');
  // a different cue line is a different key
  const diff = await body(await s.post({ ...CREQ, from: 1, to: 4, cueLineId: 'l3', parsed: [{ type: 'undo', quote: 'and mark two on it. Anyway, back to the quay.' }] }));
  assert.deepEqual(diff.actions.map((a) => a.mode), ['act']);
});

await test('route, parsed: tonight means the last 12 hours: a key older than that is not seen', async () => {
  const s = await cueSetup();
  const first = await body(await s.post({ ...CREQ, parsed: [pa()] }));
  clock.t += 13 * 3600 * 1000;
  await s.lines([]);                                                // the lines keep their old stamps; the cue is read by id and seq, not by time
  const later = await body(await s.post({ ...CREQ, parsed: [pa()] }));
  assert.deepEqual([first.actions[0].mode, later.actions[0].mode], ['act', 'act']);
  assert.equal(rowCount(s), 2);
  clock.t -= 13 * 3600 * 1000;
});

await test('route, parsed: a hands row whose card is malformed or has no actions does not break the keys read', async () => {
  const s = await cueSetup();
  await s.seed('hands', clock.t - 5000, 0, 'this is not json');
  await s.seed('hands', clock.t - 4000, 0, JSON.stringify({ act: 1 }));
  await s.seed('hands', clock.t - 3000, 0, null);
  await s.seed('hands', clock.t - 2000, 0, JSON.stringify({ actions: 'oops' }));
  const out = await body(await s.post({ ...CREQ, parsed: [pa()] }));
  assert.deepEqual(out.actions.map((a) => a.mode), ['act']);
  const again = await body(await s.post({ ...CREQ, parsed: [pa()] }));
  assert.deepEqual(again.actions.map((a) => a.mode), ['seen']);
});

await test('route, parsed: THE RACE: two pages post the same cue at the same moment: one claim wins (changes 1), the other loses (changes 0): one act, one seen, one row', async () => {
  const s = await cueSetup();
  const orig = s.db.prepare.bind(s.db), arrivals = [], changes = [];
  let open; const gate = new Promise((r) => { open = r; });
  s.db.prepare = (sql) => {
    const st = orig(sql);
    if (!/WHERE NOT EXISTS/.test(sql)) return st;
    const run = st.run.bind(st);
    st.run = async () => { arrivals.push(1); if (arrivals.length === 2) open(); await gate; const r = await run(); changes.push(r.meta.changes); return r; };
    return st;
  };
  const b = { ...CREQ, parsed: [pa()] };
  const [x, y] = await Promise.all([s.post(b), s.post(b)]);
  assert.equal(arrivals.length, 2, 'both requests reached the claim statement before either ran it');
  assert.deepEqual(changes.slice().sort(), [0, 1]);
  const modes = [(await body(x)).actions[0].mode, (await body(y)).actions[0].mode].sort();
  assert.deepEqual(modes, ['act', 'seen']);
  assert.equal(rowCount(s), 1);
  assert.equal(s.calls.length, 0);
});

await test('route, parsed: the race with a partly different list: the loser gets the actions the winner did not take and acts on them', async () => {
  const s = await cueSetup();
  const orig = s.db.prepare.bind(s.db), arrivals = [];
  let open; const gate = new Promise((r) => { open = r; });
  s.db.prepare = (sql) => {
    const st = orig(sql);
    if (!/WHERE NOT EXISTS/.test(sql) || arrivals.length >= 2) return st;
    const run = st.run.bind(st);
    st.run = async () => { arrivals.push(1); if (arrivals.length === 2) open(); await gate; return run(); };
    return st;
  };
  const [x, y] = await Promise.all([s.post({ ...CREQ, parsed: [pa()] }), s.post({ ...CREQ, parsed: [pa(), { type: 'capture', quote: CUE_TWO, bucket: 'name', text: 'the bell' }] })]);
  const a = await body(x), b = await body(y);
  assert.deepEqual(a.actions.map((z) => z.mode), ['act'], 'the first claim won index 0');
  assert.deepEqual(b.actions.map((z) => z.mode), ['seen', 'act'], 'the second lost the whole claim, found index 0 seen, and claimed the rest');
  assert.equal(rowCount(s), 2);
});

// ---------- the route, the model path ----------
const MCUE = (over = {}) => ({ ...CREQ, ...over });
const mact = (over = {}) => act({ quote: CUE_ONE, ...over });

await test('route, cue without parsed: the hands seat runs with the cue instruction AFTER the base instructions, and the cue line in the user turn', async () => {
  const s = await setup();
  await s.lines(CUE_TALK);
  s.st.reply = { actions: [mact({ confidence: 0.2, filled: 2 })] };
  const out = await body(await s.post(MCUE()));
  assert.equal(s.calls.length, 1);
  const c = s.calls[0];
  assert.ok(c.ins.startsWith(SEATS.hands.instructions), 'the base instructions come first');
  assert.ok(c.ins.endsWith('\n' + CUE_INSTRUCTION)); assert.equal(CUE_INSTRUCTION, 'The GM said this to you by name, as a command. Carry out exactly that command. Speaker labels do not matter. If you cannot tell what to do, return nothing.');
  assert.match(c.user, /The command begins in this line: \[\d\d:\d\d\] S0: Blade, make a six clock called Harbour Bell$/);
  assert.deepEqual(out.actions.map((a) => [a.type, a.mode, a.filled]), [['clock_add', 'act', 2]], 'a cue is act even at confidence 0.2');
  assert.equal(out.actions[0].key, cueCheck([pa()]).actions[0].key, 'keyed from cueLineId and index, like the page\'s parse');
  const r = s.rows()[0], card = JSON.parse(r.card);
  assert.deepEqual([r.flags, card.cue, card.cue_line, r.cents > 0], ['act,cue', 1, 'l2', true]);
  // a plain window gets no cue text, in either place
  const s2 = await setup(); await s2.lines(CUE_TALK); await s2.post(REQ);
  assert.ok(!s2.calls[0].ins.includes(CUE_INSTRUCTION) && !s2.calls[0].user.includes('The command begins'));
});

await test('route, cue without parsed: undo, rename and roll_log from the model are dropped, and a quote not in the talk too', async () => {
  const s = await setup();
  await s.lines(CUE_TALK);
  s.st.reply = { actions: [{ ...mact(), type: 'undo' }, { ...mact(), type: 'rename', name: 'Big Ben' }, { ...mact(), type: 'roll_log', who: 'Odo', action: 'hunt' }, mact({ quote: 'Blade tick the moon please' }), mact()] };
  const out = await body(await s.post(MCUE()));
  assert.deepEqual(out.actions.map((a) => a.type), ['clock_add']);
  assert.deepEqual(out.dropped.map((d) => d.why), ['unknown type', 'unknown type', 'unknown type', 'quote not in the talk']);
});

await test('route, cue without parsed: an unknown cueLineId is a 400 before any model call; with no id at all it still runs (anchor keys)', async () => {
  const s = await setup();
  await s.lines(CUE_TALK);
  await assert.rejects(s.post(MCUE({ cueLineId: 'nope' })), (e) => e.status === 400);
  assert.equal(s.calls.length, 0);
  s.st.reply = { actions: [mact()] };
  const out = await body(await s.post({ from: 1, to: 4, state: STATE, mode: 'cue' }));
  assert.match(out.actions[0].key, /^clock_add:/); assert.equal(out.actions[0].mode, 'act'); assert.ok(!s.calls[0].user.includes('The command begins'));
});

await test('route, cue without parsed: no 8 s cooldown (a cue is the GM\'s command), but one at a time (busy) and the cap still stop it', async () => {
  const s = await setup();
  await s.lines(CUE_TALK);
  s.st.reply = { actions: [] };
  await s.post(REQ);                                               // a window run: the cooldown now applies to windows
  await assert.rejects(s.post(REQ), (e) => e.status === 429 && /cooling down/.test(e.message));
  assert.equal((await s.post(MCUE())).status, 200, 'a cue right after a window run goes through');
  assert.equal((await s.post(MCUE())).status, 200, 'and right after another cue');
  await s.seed('ref', clock.t - 1000, 3000);
  await assert.rejects(s.post(MCUE()), (e) => e.status === 429 && /cap/.test(e.message));
  // busy
  const s2 = await setup(); await s2.lines(CUE_TALK); s2.st.reply = { actions: [] };
  let release; s2.st.hold = new Promise((r) => { release = r; });
  const first = s2.post(MCUE()); await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(s2.post(MCUE()), (e) => e.status === 429 && /busy/.test(e.message));
  release(); await first;
});

await test('route, cue without parsed: a cue the page parsed and a cue it sent to the model act once between them (same key)', async () => {
  const s = await setup();
  await s.lines(CUE_TALK);
  const parsed = await body(await s.post({ ...MCUE(), parsed: [pa()] }));
  s.st.reply = { actions: [mact()] };
  const viaModel = await body(await s.post(MCUE()));
  assert.deepEqual([parsed.actions[0].mode, viaModel.actions[0].mode, viaModel.actions[0].key === parsed.actions[0].key], ['act', 'seen', true]);
  assert.equal(rowCount(s), 2, 'the model call cost money, so its row is written even when its action is seen');
});

await test('route, a window: a key a cue row already holds, or an earlier window did, comes back seen; the row is still written', async () => {
  const s = await setup();
  await s.lines(TALK);
  s.st.reply = { actions: [good(), good({ type: 'clock_tick', quote: 'Tick that once', clock_id: 'ck1', by: 1 })] };
  const a = await body(await s.post(REQ));
  assert.deepEqual(a.actions.map((x) => x.mode), ['act', 'act']);
  clock.t += 9_000;
  const b = await body(await s.post(REQ));
  assert.deepEqual(b.actions.map((x) => x.mode), ['seen', 'seen']);
  assert.deepEqual(b.actions.map((x) => x.key), a.actions.map((x) => x.key));
  assert.equal(rowCount(s), 2);
  // a new decision in a later window is not seen
  clock.t += 9_000;
  s.st.reply = { actions: [good(), good({ type: 'npc_add', quote: "His name's Wren Alder", name: 'Wren Alder' })] };
  const c = await body(await s.post(REQ));
  assert.deepEqual(c.actions.map((x) => [x.type, x.mode]), [['clock_add', 'seen'], ['npc_add', 'act']]);
  // an offer's key is in the rows too
  clock.t += 9_000;
  s.st.reply = { actions: [good({ type: 'npc_add', quote: "His name's Wren Alder", name: 'Wren Alder', confidence: 0.4 })] };
  assert.deepEqual((await body(await s.post(REQ))).actions.map((x) => x.mode), ['seen']);
});

await test('route, a window: a key older than tonight is not seen', async () => {
  const s = await setup();
  await s.lines(TALK);
  s.st.reply = { actions: [good()] };
  const first = await body(await s.post(REQ));
  clock.t += 13 * 3600 * 1000;
  const next = await body(await s.post(REQ));
  assert.deepEqual([first.actions[0].mode, next.actions[0].mode], ['act', 'act']);
  clock.t -= 13 * 3600 * 1000;
});

await test('route, two overlapping model calls (two isolates, so two lease sets): both rows are written, the lower id owns the key: one act, one seen', async () => {
  const s = await setup();
  await s.lines(CUE_TALK);
  const second = makeHandler({ clientFor: () => fakeClient(s.st, s.calls), now: () => clock.t, leases: makeLeases() });
  const post2 = (b) => second({ request: new Request('https://blades.example.test/api/gm/assist/act', { method: 'POST', body: JSON.stringify(b), headers: { 'Content-Type': 'application/json' } }), env: s.env, data: { me: GM } });
  s.st.reply = { actions: [mact()] };
  let release; s.st.hold = new Promise((r) => { release = r; });
  const p1 = s.post(MCUE()), p2 = post2(MCUE());
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(s.calls.length, 2, 'both calls are in flight at the provider');
  release();
  const modes = [(await body(await p1)).actions[0].mode, (await body(await p2)).actions[0].mode].sort();
  assert.deepEqual(modes, ['act', 'seen']);
  assert.equal(rowCount(s), 2);
});

// ---------- the replay script's helpers and guards ----------
const TRANSCRIPT = [
  '# invented', '',
  ...Array.from({ length: 45 }, (_, i) => `- **[21:00] Gm:** busy line ${i}`),
  '- **[21:01] Gm:** a later minute', '- **[21:03] Pia:** another later one', 'not a line',
].join('\n');

await test('replay helpers: rows are in transcript order with a seq; windows overlap, are capped at the latest 40 lines, and skip empty or repeated ones', async () => {
  const { rowsOf, windowsOf, talkOf, applyToState, fakeHandsCall } = await import('../../scripts/lib/act-replay.mjs');
  const rows = rowsOf(TRANSCRIPT);
  assert.equal(rows.length, 47); assert.deepEqual([rows[0].seq, rows[46].seq, rows[46].stamp], [1, 47, '21:03']);
  const w = windowsOf(rows, { window: 2, step: 1 });
  assert.equal(w.length, 3, '21:00 (46 lines), 21:01 (the one line left), 21:02 (holds 21:03); the 21:03 window repeats the 21:02 one and is skipped');
  assert.equal(w[0].rows.length, LINES_MAX, 'capped at 40'); assert.equal(w[0].to, 46); assert.equal(w[0].from, 7, 'the latest 40 of the 46 in 21:00-21:01');
  assert.match(talkOf(w[2]), /^\[21:03\] Pia: another later one$/);
  assert.deepEqual(windowsOf(rows, { from: 21 * 60 + 3, to: 21 * 60 + 3 }).map((x) => [x.from, x.to]), [[47, 47]]);
  assert.deepEqual(windowsOf([], {}), []);
  // the fake model: a clock phrase and a tick phrase, plus an invented quote every third window that validation must drop
  const user = handsUser({ state: cleanState(STATE), stamp: '09:00', talk: "[09:00] Gm: That's a six-segment clock. Tick that, please." });
  const f = fakeHandsCall({ user, n: 3 });
  const v = validateActions(f.json.actions, { state: cleanState(STATE), lines: [row(1, "That's a six-segment clock. Tick that, please.")] });
  assert.deepEqual(v.actions.map((a) => a.type), ['clock_add', 'clock_tick']); assert.deepEqual(v.dropped.map((d) => d.why), ['quote not in the talk']);
  // the stand-in apply step: acts only, each key once, offers left alone
  const keys = new Set();
  const st1 = applyToState(cleanState(STATE), v.actions, keys);
  assert.equal(st1.applied.length, 2); assert.equal(st1.state.clocks.length, 4); assert.equal(st1.state.clocks[0].filled, 3);
  const st2 = applyToState(st1.state, v.actions, keys);
  assert.deepEqual([st2.applied.length, st2.skipped.length, st2.state.clocks.length], [0, 2, 4], 'a re-sent window applies nothing twice');
  const offer = validateActions([act({ confidence: 0.2 })], { state: cleanState(STATE), lines: LINES }).actions;
  assert.equal(applyToState(cleanState(STATE), offer, new Set()).applied.length, 0);
});

await test('replay with the pages pre-filter: only the windows cogm.js matches are cut, each holds its matching line and its neighbours, and quiet talk is never sent', async () => {
  const { rowsOf, windowsOf, cogmWindows, lineOf } = await import('../../scripts/lib/act-replay.mjs');
  const chatter = (m, n) => Array.from({ length: n }, (_, i) => `- **[21:${String(m).padStart(2, '0')}] Gm:** the rain keeps on falling over the quiet street ${i}`);
  const text = [...chatter(0, 12), "- **[21:01] Gm:** Right, that's a six-segment clock for the patrol.", ...chatter(1, 12), ...chatter(2, 12), ...chatter(3, 12),
    '- **[21:04] Gm:** Tick that once, please.', ...chatter(4, 6)].join('\n');
  const rows = rowsOf(text), clockSeq = rows.find((r) => /six-segment/.test(r.text)).seq, tickSeq = rows.find((r) => /Tick that/.test(r.text)).seq;
  const p = cogmWindows(rows);
  assert.equal(p.lines, rows.length); assert.equal(p.matchedLines, 2, 'the two lines the pre-filter matches');
  assert.equal(p.windows.length, 2, 'two matches far apart: two windows, not one per minute');
  assert.ok(p.windows.length < windowsOf(rows).length, 'fewer than the time windows');
  const [a, b] = p.windows;
  assert.ok(a.from <= clockSeq && clockSeq <= a.to && a.matched.includes(clockSeq) && a.rows.length > 1 && a.rows.length <= LINES_MAX);
  assert.ok(b.from <= tickSeq && tickSeq <= b.to && b.matched.includes(tickSeq));
  assert.ok(a.to < b.from, 'quiet talk between them is in neither window');
  assert.ok(a.rows.every((r, i) => i === 0 || r.seq === a.rows[i - 1].seq + 1), 'a window is a run of lines, in order');
  assert.deepEqual(cogmWindows([]).windows, []); assert.equal(cogmWindows(rowsOf('- **[21:00] Gm:** just talking')).windows.length, 0);
  assert.equal(lineOf(rows, 'Tick that once'), tickSeq); assert.equal(lineOf(rows, 'nobody said this'), 0);
});

await test('replay script guards: no key and no --fake, a budget over $0.50, and an --out outside gm-private/ all stop at once with exit 2 and no output files', async () => {
  const { spawnSync } = await import('node:child_process');
  const os = await import('node:os'), fs = await import('node:fs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hands-')), tf = path.join(dir, 't.md'), sf = path.join(dir, 's.json');
  fs.writeFileSync(tf, '- **[21:00] Gm:** hello there\n'); fs.writeFileSync(sf, JSON.stringify(STATE));
  const script = path.join(ROOT, 'scripts', 'gm-assist-act-replay.mjs');
  const run = (extra, env = {}) => spawnSync(process.execPath, [script, '--transcript', tf, '--state', sf, ...extra], { encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env } });
  const noKey = run([]); assert.equal(noKey.status, 2); assert.match(noKey.stderr, /B68_ANTHROPIC_KEY/);
  const withApiKey = run([], { ANTHROPIC_API_KEY: 'sk-ant-should-not-be-used' }); assert.equal(withApiKey.status, 2, 'ANTHROPIC_API_KEY is never read');
  assert.ok(!withApiKey.stdout.includes('sk-ant') && !withApiKey.stderr.includes('sk-ant'));
  assert.equal(run(['--fake', '--max-spend', '0.6']).status, 2);
  assert.equal(run(['--fake', '--max-spend', '0']).status, 2);
  assert.equal(run(['--fake', '--max-spend', '0.6', '--budget', '2']).status, 2, 'the ceiling itself is capped at 1');
  const out = run(['--fake', '--out', path.join(dir, 'elsewhere')]); assert.equal(out.status, 2); assert.match(out.stderr, /gm-private/);
  assert.ok(!fs.existsSync(path.join(dir, 'elsewhere')));
  fs.rmSync(dir, { recursive: true, force: true });
});

await test('cue replay: ten invented windows; a stand-in that answers each one right passes all ten, one that always says nothing passes only the two "nothing" windows, and the budget stops it', async () => {
  const { CUE_WINDOWS, runCueWindows, windowRows } = await import('../../scripts/lib/cue-replay.mjs');
  assert.equal(CUE_WINDOWS.length, 10);
  const q = (i) => windowRows(CUE_WINDOWS[i]).map((r) => r.text).join(' ');
  const correct = [
    [{ type: 'clock_add', name: 'Harbour Bell', size: 6, hidden: true, filled: 0, quote: 'Blade, make a six clock called Harbour Bell' }],
    [{ type: 'clock_add', name: 'Night Crew', size: 4, hidden: true, filled: 1, quote: 'Blade, make a four clock called Night Crew and mark one.' }],
    [{ type: 'clock_tick', clock_id: 'ck1', by: 2, quote: 'Blade, tick Lamp Oil Running Low twice.' }],
    [{ type: 'npc_add', name: 'Corvin Lathe', look: 'tall', role: 'porter', quote: 'Played, new NPC called Corvin Lathe, a tall porter with a bad knee.' }],
    [{ type: 'clock_tick', clock_id: 'ck2', by: -1, quote: 'Blade, clear one on Harbour Watch Wakes.' }],
    [{ type: 'capture', bucket: 'moment', text: 'ferry stopped', quote: 'Blade, note that the ferry stopped running after the bell.' }],
    [{ type: 'capture', bucket: 'loose_end', text: 'who rang the bell', quote: 'Blade, loose end: who rang the bell that night?' }],
    [{ type: 'capture', bucket: 'name', text: 'Pernel Quayle, ropemaker', quote: 'Blade, name: Pernel Quayle, the ropemaker.' }],
    [], [],
  ];
  const full = act({ filled: 0 });
  let n = 0;
  const call = async () => ({ json: { actions: correct[n++].map((a) => ({ ...full, confidence: 0.9, ...a })) }, usage: {}, cost: 0.001, stop: 'end_turn' });
  const good10 = await runCueWindows({ call });
  assert.deepEqual(good10.results.map((r) => r.ok), Array(10).fill(true), JSON.stringify(good10.results.filter((r) => !r.ok).map((r) => [r.name, r.dropped, r.kept])));
  assert.ok(good10.spend > 0.0099 && good10.spend < 0.0101);
  const nothing = await runCueWindows({ call: async () => ({ json: { actions: [] }, usage: {}, cost: 0, stop: 'end_turn' }) });
  assert.deepEqual(nothing.results.map((r) => r.ok), [false, false, false, false, false, false, false, false, true, true]);
  const refused = await runCueWindows({ call: async () => ({ json: null, usage: {}, cost: 0, stop: 'refusal' }) });
  assert.ok(refused.results.every((r) => !r.ok), 'a refusal is never a pass, not even for the "nothing" windows');
  let calls = 0;
  const capped = await runCueWindows({ call: async () => { calls++; return { json: { actions: [] }, usage: {}, cost: 0.04, stop: 'end_turn' }; }, maxSpend: 0.1 });
  assert.deepEqual([calls, capped.results.length, capped.stopped], [3, 3, 'budget']);
  assert.ok(q(0).length > 0);
});

await test('replay script --cue: with no key it stops at once (exit 2), --cue with --fake is refused, and the spend ceiling is capped', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = path.join(ROOT, 'scripts', 'gm-assist-act-replay.mjs');
  const run = (extra, env = {}) => spawnSync(process.execPath, [script, '--cue', ...extra], { encoding: 'utf8', env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, ...env } });
  const noKey = run([]); assert.equal(noKey.status, 2); assert.match(noKey.stderr, /B68_ANTHROPIC_KEY/);
  assert.equal(run([], { ANTHROPIC_API_KEY: 'sk-ant-should-not-be-used' }).status, 2);
  const fake = run(['--fake']); assert.equal(fake.status, 2); assert.match(fake.stderr, /real model/);
  assert.equal(run(['--max-spend', '0.6'], { B68_ANTHROPIC_KEY: 'sk-ant-x' }).status, 2, 'over the budget ceiling');
});

console.log('\n' + (failed ? failed + ' FAILED, ' + passed + ' passed' : 'ALL PASSED (' + passed + ')'));
process.exit(failed ? 1 : 0);
