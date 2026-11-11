// assist-pitch (KS18, the kit and stage build): Blade's pitch seat, setting blade.pitches. The seat and its prompt, the wakes, the 4-minute
// cooldown, the ladder (59%, 60%, 85%, the cap), the answer's shape, `seen`, the tick endpoint on an in-memory D1 with an INJECTED FAKE
// client, the page's request hook (B68Pitches, cf.js assistPitchTick), the rollback (Deploy 35's code over pitch rows) and the e2e script's
// --fake --pitches mode. Off means today: decide() over an invented night, pitches off, equals the record made from 798907c line for line.
// $0: the key is removed from this process (and every child), fetch throws, and every client is a fake. Every name and line is invented.
//   node checks/runtime/assist-pitch.test.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

delete process.env.B68_ANTHROPIC_KEY; delete process.env.ANTHROPIC_API_KEY;     // nothing here may reach the API: no key, in this process or a child
globalThis.fetch = () => { throw new Error('assist-pitch: no network in this test'); };

const { memoryExec, asD1 } = await import('../../scripts/lib/d1.mjs');
const { cleanLines, addLines } = await import('../../functions/_lib/stt.js');
const C = await import('../../functions/_lib/assist/conductor.js');
const { SEATS, WAKES } = await import('../../functions/_lib/assist/seats.js');
const { DEADLINE_MS, LEASE_TTL_MS } = await import('../../functions/_lib/assist/leases.js');
const P = await import('../../functions/_lib/assist/pitch.js');
const { makeHandler } = await import('../../functions/api/gm/assist.js');
const { nightCards } = await import('../../functions/_lib/assist/cards.js');
const { simulate } = await import('./fixtures/gm/pitch-night.mjs');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
let failed = 0, passed = 0, skippedN = 0;
async function test(name, fn) { try { const r = await fn(); if (r === 'skip') { skippedN++; console.log('SKIP ' + name); } else { passed++; console.log('PASS ' + name); } } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const T = 1_000_000_000_000, MIN = 60_000, CAP = 30;
const { decide, budgetTier } = C;

// ---------- the seat ----------
await test('the seat: Sonnet 5.5 at low effort, Meanwhile\'s size (1500), one line in SEATS and in WAKES, a tick seat\'s deadline', () => {
  assert.equal(SEATS.pitch, P.PITCH_SEAT);
  assert.equal(SEATS.pitch.model, 'claude-sonnet-5-5'); assert.equal(SEATS.pitch.effort, 'low');
  assert.equal(SEATS.pitch.maxTokens, SEATS.meanwhile.maxTokens);
  assert.deepEqual(WAKES.pitch, ['scene_change', 'stall']);
  assert.equal(DEADLINE_MS.pitch, DEADLINE_MS.stall); assert.ok(DEADLINE_MS.pitch < LEASE_TTL_MS.pitch);
  assert.deepEqual(Object.keys(SEATS.pitch.schema.properties), ['pitches']);
  const item = SEATS.pitch.schema.properties.pitches.items;
  assert.deepEqual(item.required, ['kind', 'line', 'why_now', 'uses']); assert.deepEqual(item.properties.kind.enum, ['direction', 'complication', 'clue', 'npc_move', 'cutaway']);
});

await test('the prompt carries every rule of the brief, and nothing campaign-specific', () => {
  const ins = SEATS.pitch.instructions;
  for (const w of ['up to three pitches', 'each of a different kind', 'Build on what was just said at the table', 'Never repeat or rephrase a line from the already-pitched list',
    'Never invent a named person, place or group when tonight\'s prep has one that fits', 'Never decide what a player character does', 'No rules text',
    'line: under 16 words', 'why_now: under 12 words', 'uses: the exact name', 'return an empty list if nothing fits', 'Reply with JSON only']) assert.ok(ins.includes(w), w);
  for (const k of P.PITCH_KINDS) assert.ok(ins.includes('- ' + k + ':'), k);
  for (const n of ['Pelican', 'Arbuthnot', 'Okonjo', 'Petrakis', 'Quist', 'Kessler', 'Vell', 'Brand']) assert.ok(!ins.includes(n), 'no fixture name in the prompt: ' + n);
});

// ---------- off means today ----------
await test('off means today: the fixture night through decide(), pitches off, equals the day-0 record (798907c) line for line', () => {
  const day0 = fs.readFileSync(path.join(ROOT, 'checks/runtime/fixtures/gm/pitch-night-day0.txt'), 'utf8').split(/\r?\n/).filter(Boolean);
  const now = simulate(C);
  assert.equal(now.length, 240); assert.equal(now.length, day0.length);
  now.forEach((l, i) => assert.equal(l, day0[i], 'line ' + (i + 1)));
  assert.deepEqual(simulate(C, { extra: () => ({ pitches: false, pitchNow: false }) }), day0, 'pitches: false is the same as absent');
  assert.ok(day0.some((l) => / -> [^|]*meanwhile/.test(l)) && day0.some((l) => / -> [^|]*stall/.test(l)), 'the record has Stall and Meanwhile in it');
  assert.ok(!day0.some((l) => /pitch/.test(l)));
});

await test('off: the answer has no new key; a pitch flag alone wakes nothing', () => {
  const v = decide({ flags: ['scene_change', 'stall', 'tick'], now: T });
  assert.deepEqual(Object.keys(v), ['tier', 'seats', 'skipped']);
  assert.ok(v.seats.includes('meanwhile') && v.seats.includes('stall') && !v.seats.includes('pitch'));
  assert.deepEqual(decide({ flags: ['scene_change'], now: T, pitchNow: true }).seats, ['meanwhile'], 'pitchNow means nothing without pitches');
});

// ---------- the wakes and the cooldown ----------
const on = (o) => decide({ now: T, pitches: true, ...o });
await test('on: Stall and Meanwhile never wake (not in seats, not in skipped); pitch wakes on scene_change and stall', () => {
  for (const f of ['scene_change', 'stall']) {
    const v = on({ flags: [f], lastRun: { pitch: T - 5 * MIN } });
    assert.ok(v.seats.includes('pitch'), f); assert.equal(v.pitchWake, f === 'stall' ? 'stall' : 'scene');
    assert.ok(!v.seats.includes('stall') && !v.seats.includes('meanwhile')); assert.ok(!v.skipped.some((x) => ['stall', 'meanwhile'].includes(x.seat)));
  }
  assert.deepEqual(on({ flags: ['roll_talk'], lastRun: { pitch: T - MIN } }).seats, ['ref', 'ledger'], 'a roll alone wakes no pitch');
  assert.equal(on({ flags: ['roll_talk'], lastRun: { pitch: T - MIN } }).pitchWake, '');
});

await test('on: a tick with talk wakes pitch when no pitch call has been made for 6 minutes (and on the first tick), not sooner', () => {
  assert.equal(on({ flags: ['tick'] }).pitchWake, 'idle'); assert.ok(on({ flags: ['tick'] }).seats.includes('pitch'), 'no pitch in the last hour');
  assert.ok(!on({ flags: ['tick'], lastRun: { pitch: T - 5.9 * MIN } }).seats.includes('pitch'));
  assert.ok(on({ flags: ['tick'], lastRun: { pitch: T - 6 * MIN } }).seats.includes('pitch'));
  assert.ok(!on({ flags: [], lastRun: {} }).seats.includes('pitch'), 'no talk (a rolled-only tick has no tick flag): no idle wake');
});

await test('on: a 4-minute cooldown holds scene_change and stall wakes; pitchNow skips it; the lease still holds pitchNow', () => {
  const held = on({ flags: ['scene_change'], lastRun: { pitch: T - 3.9 * MIN } });
  assert.ok(!held.seats.includes('pitch')); assert.deepEqual(held.skipped.filter((x) => x.seat === 'pitch'), [{ seat: 'pitch', why: 'cooldown' }]);
  assert.ok(on({ flags: ['scene_change'], lastRun: { pitch: T - 4 * MIN } }).seats.includes('pitch'));
  const asked = on({ flags: [], lastRun: { pitch: T - 10_000 }, pitchNow: true });
  assert.ok(asked.seats.includes('pitch')); assert.equal(asked.pitchWake, 'asked');
  const busy = on({ flags: [], pitchNow: true, inFlight: new Set(['pitch']) });
  assert.deepEqual(busy.skipped, [{ seat: 'pitch', why: 'in-flight' }]);
  assert.equal(P.PITCH_COOLDOWN_MS, 4 * MIN); assert.equal(P.PITCH_IDLE_MS, 6 * MIN);
});

// ---------- the ladder ----------
await test('the ladder ($30, unchanged): 59% and 60% pitch (Meanwhile is dropped at 60% today); 85% only pitchNow; the cap nothing', () => {
  assert.equal(C.DEFAULT_CAP, 30);
  const at = (share, extra = {}) => on({ flags: ['scene_change'], spent: share * CAP, cap: CAP, ...extra });
  assert.equal(budgetTier(0.59 * CAP, CAP), 'all'); assert.ok(at(0.59).seats.includes('pitch'), '59%');
  assert.equal(budgetTier(0.6 * CAP, CAP), 'reduced'); assert.ok(at(0.6).seats.includes('pitch'), '60%: pitches keep running');
  assert.ok(!decide({ flags: ['scene_change'], now: T, spent: 0.6 * CAP, cap: CAP }).seats.includes('meanwhile'), 'off: Meanwhile is dropped at 60%, as today');
  assert.equal(budgetTier(0.85 * CAP, CAP), 'core');
  assert.deepEqual(at(0.85).skipped.find((x) => x.seat === 'pitch'), { seat: 'pitch', why: 'budget' }, '85%: stops with the other non-core seats');
  assert.ok(at(0.85, { pitchNow: true }).seats.includes('pitch'), '85%: pitchNow still works');
  assert.equal(budgetTier(1 * CAP, CAP), 'off');
  assert.ok(!at(1).seats.includes('pitch') && !at(1, { pitchNow: true }).seats.includes('pitch'), 'the cap: nothing, not even pitchNow');
});

await test('on: the fixture night: no Stall, no Meanwhile, pitches paced (>= 4 minutes apart) and never at or over 85% without pitchNow', () => {
  const lines = simulate(C, { extra: () => ({ pitches: true }) });
  const woken = (l) => l.split(' -> ')[1].split(' | ')[0].split(',');
  assert.ok(!lines.some((l) => woken(l).includes('stall') || woken(l).includes('meanwhile')));
  const runs = lines.map((l, i) => (woken(l).includes('pitch') ? i : -1)).filter((i) => i >= 0);
  assert.ok(runs.length >= 8, 'pitches ran: ' + runs.length);
  for (let k = 1; k < runs.length; k++) assert.ok(runs[k] - runs[k - 1] >= 4, 'paced: ' + runs[k - 1] + ' -> ' + runs[k]);
  assert.ok(lines.filter((l) => / (core|off) \[/.test(l)).every((l) => !woken(l).includes('pitch')));
});

// ---------- the body, the turn and the answer ----------
await test('cleanPitchBody: off unless pitch is true; 400s for the wrong types; seen clipped to 200 characters and the newest 12', () => {
  assert.deepEqual(P.cleanPitchBody({}), { pitch: false, pitchNow: false, seen: [] });
  assert.deepEqual(P.cleanPitchBody({ seen: 'junk' }), { pitch: false, pitchNow: false, seen: [] }, 'seen is not read while pitches are off');
  assert.match(P.cleanPitchBody({ pitch: 'yes' }).error, /pitch must be/);
  assert.match(P.cleanPitchBody({ pitch: true, pitchNow: 1 }).error, /pitchNow must be/);
  assert.match(P.cleanPitchBody({ pitchNow: true }).error, /needs pitch/);
  assert.match(P.cleanPitchBody({ pitch: true, seen: 'a line' }).error, /seen must be a list/);
  const many = Array.from({ length: 15 }, (_, i) => 'line ' + i);
  const c = P.cleanPitchBody({ pitch: true, pitchNow: true, seen: [...many, 7, '', 'x'.repeat(300)] });
  assert.equal(c.pitch, true); assert.equal(c.pitchNow, true); assert.equal(c.seen.length, 12);
  assert.equal(c.seen[11].length, 200); assert.equal(c.seen[0], 'line 4');
});

await test('toPitches: at most three, kinds all different, nothing in seen (normalised), no repeated line, every field clipped; null when nothing is left', () => {
  const j = { pitches: [
    { kind: 'npc_move', line: 'Ada closes her table early and watches the stairs.', why_now: 'Ray asked about the ledger', uses: 'Ada Vell' },
    { kind: 'npc_move', line: 'A second NPC move', why_now: 'x', uses: '' },
    { kind: 'complication', line: 'The Tidewater Watch change shift ten minutes ahead', why_now: 'they are on the stairs', uses: '' },
    { kind: 'clue', line: "Dov's ledger has a page cut out", why_now: 'the ledger came up', uses: 'Dov Kessler' },
    { kind: 'cutaway', line: 'A fourth one', why_now: '', uses: '' },
    { kind: 'rules', line: 'Not a kind', why_now: '', uses: '' },
  ] };
  const out = P.toPitches(j);
  assert.deepEqual(out.map((p) => p.kind), ['npc_move', 'complication', 'clue']);
  assert.deepEqual(Object.keys(out[0]), ['kind', 'line', 'why_now', 'uses']);
  const seen = P.toPitches(j, { seen: ['ada closes her table early, and watches the stairs'] });
  assert.deepEqual(seen.map((p) => p.kind), ['npc_move', 'complication', 'clue'], 'the seen line is dropped and the next npc_move takes its place');
  assert.equal(seen[0].line, 'A second NPC move');
  const long = P.toPitches({ pitches: [{ kind: 'direction', line: 'w '.repeat(200), why_now: 'y '.repeat(200), uses: 'z'.repeat(200) }] })[0];
  assert.ok(long.line.length <= P.LINE_MAX && long.why_now.length <= P.WHY_MAX && long.uses.length <= P.USES_MAX);
  assert.equal(P.toPitches({ pitches: [] }), null); assert.equal(P.toPitches(null), null); assert.equal(P.toPitches({ pitches: [{ kind: 'clue', line: ' ', why_now: '', uses: '' }] }), null);
  assert.equal(P.toPitches({ pitches: [{ kind: 'clue', line: 'Same', why_now: '', uses: '' }, { kind: 'direction', line: 'same.', why_now: '', uses: '' }] }).length, 1, 'a repeated line');
});

await test('pitchUser: why now, who is on stage, the clocks, the seen lines and the talk', () => {
  const u = P.pitchUser({ wake: 'scene', npc: 'Mabel Quist', clocks: [{ name: 'Watch patrol', filled: 2, size: 6 }], seen: ['Old line'], stamp: '20:06', talk: '[20:06] GM: New scene.' });
  assert.match(u, /^Why now: the scene changed\./); assert.match(u, /On stage: Mabel Quist/); assert.match(u, /- Watch patrol 2\/6/);
  assert.match(u, /never repeat\):\n- Old line/); assert.match(u, /Talk of the last four minutes, up to 20:06:\n\[20:06\] GM: New scene\./);
  assert.match(P.pitchUser({ wake: 'quiet', minutes: 5, stamp: '20:20', talk: '' }), /silent about 5 minutes[\s\S]*The last talk before the silence, up to 20:20:\n\(no talk\)/);
  assert.match(P.pitchUser({ wake: 'asked', stamp: '20:20', talk: 'x' }), /the GM asked for pitches[\s\S]*Live clocks on the table: none\.[\s\S]*nothing yet\./);
});

// ---------- the endpoint, with the injected fake client ----------
const GM = { role: 'gm', id: 'gm@example.test' };
const clock = { t: Date.parse('2030-03-01T09:00:00.000Z') };
const iso = (ms) => new Date(ms).toISOString();
const NONE = Object.fromEntries(['roll_talk', 'harm', 'npc_change', 'new_name', 'clue_mention', 'xp_trigger', 'scene_change', 'stall', 'downtime'].map((f) => [f, false]));
const SET = (k = 1) => ({ pitches: [
  { kind: 'npc_move', line: 'Ada closes her table early and watches the stairs', why_now: 'the ledger came up', uses: 'Ada Vell' },
  { kind: 'complication', line: 'The Tidewater Watch change shift ten minutes ahead ' + k, why_now: 'they are on the stairs', uses: '' },
  { kind: 'clue', line: "Dov's ledger has a page cut out", why_now: 'Ray asked who signs', uses: 'Dov Kessler' },
] });
const REPLIES = () => ({
  tripwire: { ...NONE, scene_change: true },
  ref: { slip: false, said_at: '', what_was_said: '', rule: '', check: 'other', card: '' },
  ledger: { events: [], xp_totalled: false }, clerk: { new_names: [], drift: [], clues_landed: [] },
  stall: { stalled: true, kind: 'complication', offer: 'A runner bursts in.', why_now: 'quiet' },
  meanwhile: { faction: 'The Tidewater Watch', cutaway: 'A patrol forms up.', clock: '', suggest_ticks: 0, why: '' },
  showrunner: { spotlight: [], needs_spotlight: '', beat: 'rising', elapsed_minutes: 30, advice: '', speak: false },
  scribe: { story: 'The crew reached the Pelican Rooms.', corrections: [] },
  whois: { guesses: [] },
  pitch: SET(1),
});
function fakeClient(replies, calls, gate) {
  return { messages: { async create(req) {
    const texts = req.messages[0].content.filter((b) => b.type === 'text').map((b) => b.text);
    const seat = Object.keys(SEATS).find((k) => texts[0].startsWith(SEATS[k].instructions)) || 'other';
    calls.push({ seat, model: req.model, effort: req.output_config && req.output_config.effort, max: req.max_tokens, ins: texts[0], user: texts[texts.length - 1] });
    if (gate && gate[seat]) await gate[seat];
    const r = replies[seat];
    return { content: [{ type: 'text', text: JSON.stringify(typeof r === 'function' ? r() : r || {}) }], usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0 }, stop_reason: 'end_turn' };
  } } };
}
const LISTEN = () => ({ want: 'on', session: '3', speakers: {}, status: { state: 'listening', at: iso(clock.t), lines: 5, error: '' } });
async function setup({ env = {}, stt = null, mk = makeHandler, exec: given } = {}) {
  const exec = given || await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec);
  if (!given) {
    await db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'assist', 'v', '{}', 0, ?1)").bind(JSON.stringify({ file_id: 'file_test000001' })).run();
    if (stt) await db.prepare('INSERT INTO gm_stt (campaign, updated_at, doc) VALUES (?1, ?2, ?3)').bind('c', iso(clock.t), JSON.stringify(stt)).run();
  }
  const calls = [], replies = REPLIES(), gate = {};
  const handler = mk({ clientFor: () => fakeClient(replies, calls, gate), now: () => clock.t });
  const e = { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'sk-ant-test-0000', ASSIST_CAP_USD: '30', ...env };
  let n = 0;
  const lines = (count, { ago = 20_000, text = 'we climb the back stairs' } = {}) => addLines(db, 'c', cleanLines({ lines: Array.from({ length: count }, (_, i) => ({ id: 'p' + (++n) + Math.random().toString(36).slice(2, 7), at: iso(clock.t - ago + i), session: '3', conn: 'x', speaker: 0, text: text + ' ' + n, kind: 'line' })) }));
  const post = (body = {}, action = 'tick', method = 'POST') => handler({ request: new Request('https://blades.example.test/api/gm/assist/' + action, method === 'GET' ? { method } : { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), env: e, data: { me: GM } });
  const rows = () => exec.db.prepare('SELECT * FROM gm_assist_log ORDER BY id').all().map((r) => ({ ...r }));
  const seed = (seat, at, cents = 0, card = null) => db.prepare("INSERT INTO gm_assist_log (campaign, at, session, seat, model, effort, cents, flags, card) VALUES ('c', ?1, '', ?2, 'm', 'low', ?3, '', ?4)").bind(iso(at), seat, cents, card).run();
  return { exec, db, calls, replies, gate, post, lines, rows, seed, env: e };
}
const body = async (res) => JSON.parse(await res.text());
const seatsOf = (s) => s.calls.map((c) => c.seat);
// the handler throws its HttpError (the router turns it into a response): { status, error } either way
const outcome = async (p) => { try { const r = await p; return { status: r.status, error: r.status === 200 ? '' : (await body(r)).error }; } catch (e) { return { status: e.status || 500, error: e.message }; } };

await test('tick, pitches off: today\'s answer (Meanwhile on a scene change, no pitch key, no pitch call)', async () => {
  clock.t = Date.parse('2030-03-01T09:00:00.000Z');
  const s = await setup();
  await s.lines(3);
  const out = await body(await s.post({}));
  assert.ok(seatsOf(s).includes('meanwhile') && !seatsOf(s).includes('pitch'), seatsOf(s).join(','));
  assert.ok(out.meanwhile && !('pitch' in out));
  assert.ok(!s.rows().some((r) => r.seat === 'pitch'));
});

await test('tick, pitch: true: a scene change wakes pitch (Sonnet, low) in place of Meanwhile; three items; the row is never shown and GET /cards has no pitch', async () => {
  clock.t = Date.parse('2030-03-01T10:00:00.000Z');
  const s = await setup();
  await s.db.prepare("INSERT INTO gm_assist_log (campaign, at, session, seat, model, effort, cents, flags, card) VALUES ('c', ?1, '3', 'scribe', 'm', 'low', 0, '', ?2)")
    .bind(iso(clock.t - 2 * MIN), JSON.stringify({ story: 'The crew reached the Pelican Rooms and asked after the ledger.', through: 0 })).run();   // tonight's story so far
  await s.lines(3, { text: 'New scene on the stairs' });
  const res = await s.post({ pitch: true, npc: 'Mabel Quist', seen: ['An old line'] });
  assert.equal(res.status, 200);
  const out = await body(res);
  assert.ok(seatsOf(s).includes('pitch') && !seatsOf(s).includes('meanwhile') && !seatsOf(s).includes('stall'), seatsOf(s).join(','));
  const pc = s.calls.find((c) => c.seat === 'pitch');
  assert.equal(pc.model, 'claude-sonnet-5-5'); assert.equal(pc.effort, 'low'); assert.equal(pc.max, 1500);
  assert.match(pc.user, /^Why now: the scene changed/); assert.match(pc.user, /On stage: Mabel Quist/); assert.match(pc.user, /- An old line/);
  assert.match(pc.ins, /Story so far[^\n]*:\nThe crew reached the Pelican Rooms and asked after the ledger\./, 'the story rides with the instructions, after the breakpoint');
  assert.deepEqual(out.pitch.items.map((p) => p.kind), ['npc_move', 'complication', 'clue']);
  assert.ok(out.pitch.at); assert.equal(out.pitch.wake, 'scene');
  assert.equal(out.meanwhile, undefined); assert.equal(out.stall, undefined);
  assert.ok(!out.cards.some((c) => c.seat === 'pitch'), 'never a card');
  assert.ok(out.health.ran.includes('pitch'));
  const row = s.rows().find((r) => r.seat === 'pitch'), card = JSON.parse(row.card);
  assert.equal(row.model, 'claude-sonnet-5-5'); assert.ok(row.cents > 0, 'counted in tonight\'s spend');
  assert.equal(card.pitch, 1); assert.equal(card.items.length, 3); assert.equal(card.shown, undefined, 'never shown');
  const restored = await body(await s.post(null, 'cards', 'GET'));
  assert.ok(!restored.cards.some((c) => c.seat === 'pitch'));
  assert.equal((await nightCards(s.db, 'c', { now: clock.t, all: true })).cards.filter((c) => c.seat === 'pitch').length, 0, 'gm:after files no pitch');
});

await test('seen: a line already shown is dropped by the Worker, and the next set goes back with the first set\'s lines', async () => {
  clock.t = Date.parse('2030-03-01T11:00:00.000Z');
  const s = await setup();
  await s.lines(3);
  const first = await body(await s.post({ pitch: true }));
  const lines1 = first.pitch.items.map((p) => p.line);
  clock.t += 7 * MIN; await s.lines(3);
  s.replies.pitch = SET(2);
  const second = await body(await s.post({ pitch: true, seen: lines1 }));
  assert.match(s.calls.filter((c) => c.seat === 'pitch').pop().user, /Ada closes her table early/);
  assert.deepEqual(second.pitch.items.map((p) => p.kind), ['complication'], 'the npc_move and the clue repeat lines already seen');
});

await test('pitchNow: the pitch seat alone (no Tripwire), at once inside the cooldown, the cursor handed back; flags pitch_now', async () => {
  clock.t = Date.parse('2030-03-01T12:00:00.000Z');
  const s = await setup();
  await s.lines(3);
  const first = await body(await s.post({ pitch: true }));
  s.calls.length = 0; clock.t += 30_000;
  const out = await body(await s.post({ pitch: true, pitchNow: true, after: first.last }));
  assert.deepEqual(seatsOf(s), ['pitch']); assert.equal(out.last, first.last); assert.deepEqual(out.flags, ['pitch_now']);
  assert.equal(out.pitch.wake, 'asked'); assert.match(s.calls[0].user, /^Why now: the GM asked for pitches/);
  assert.equal(s.rows().filter((r) => r.seat === 'pitch').pop().flags, 'pitch_now');
  const noCursor = await body(await s.post({ pitch: true, pitchNow: true }));
  assert.equal(noCursor.last, null, 'no cursor given, none handed back');
});

await test('pitchNow while a pitch call is in flight: an explicit 429 "busy", never a silent drop', async () => {
  clock.t = Date.parse('2030-03-01T13:00:00.000Z');
  const s = await setup();
  await s.lines(3);
  let release; s.gate.pitch = new Promise((ok) => { release = ok; });
  const firstP = s.post({ pitch: true, pitchNow: true });
  for (let i = 0; i < 50 && !s.calls.some((c) => c.seat === 'pitch'); i++) await new Promise((r) => setTimeout(r, 5));
  const second = await outcome(s.post({ pitch: true, pitchNow: true }));
  assert.equal(second.status, 429); assert.match(second.error, /busy/);
  release(); const first = await firstP; assert.equal(first.status, 200);
  assert.equal(s.calls.filter((c) => c.seat === 'pitch').length, 1, 'one call');
});

await test('the cap on the endpoint: at 85% a tick wakes no pitch but pitchNow runs; at the cap pitchNow is a 429 (cap reached)', async () => {
  clock.t = Date.parse('2030-03-01T14:00:00.000Z');
  const s = await setup();
  await s.seed('ref', clock.t - 30 * MIN, 0.85 * CAP * 100);
  await s.lines(3);
  await body(await s.post({ pitch: true }));
  assert.ok(!seatsOf(s).includes('pitch'), '85%: core only');
  s.calls.length = 0;
  const now = await body(await s.post({ pitch: true, pitchNow: true }));
  assert.deepEqual(seatsOf(s), ['pitch']); assert.equal(now.pitch.items.length, 3);
  await s.seed('ref', clock.t - 29 * MIN, 0.2 * CAP * 100);
  const capped = await outcome(s.post({ pitch: true, pitchNow: true }));
  assert.equal(capped.status, 429); assert.match(capped.error, /cap/);
});

await test('the quiet table: with pitch: true the silence wakes pitch in place of Stall (flags stall,silence); its cooldown holds', async () => {
  clock.t = Date.parse('2030-03-01T15:00:00.000Z');
  const s = await setup({ stt: LISTEN() });
  await s.lines(3, { ago: MIN });
  const after = (await body(await s.post({ pitch: true }))).last;
  const quiet = async (m) => { clock.t += m * MIN; await s.db.prepare('UPDATE gm_stt SET doc = ?1').bind(JSON.stringify(LISTEN())).run(); s.calls.length = 0; return body(await s.post({ pitch: true, after })); };
  let out = await quiet(4.5);
  assert.deepEqual(seatsOf(s), ['pitch'], 'no Tripwire, no Stall'); assert.deepEqual(out.flags, ['stall', 'silence']);
  assert.equal(out.pitch.wake, 'quiet'); assert.equal(out.stall, undefined);
  assert.match(s.calls[0].user, /silent about \d+ minutes[\s\S]*The last talk before the silence/);
  out = await quiet(2); assert.deepEqual(seatsOf(s), [], 'two minutes later: cooling down');
  assert.ok(out.health.skipped.some((x) => x.seat === 'pitch' && x.why === 'cooldown'));
  out = await quiet(2.5); assert.deepEqual(seatsOf(s), ['pitch'], 'past four minutes: again');
});

await test('400s before any model call: a bad pitch, pitchNow without pitch, seen that is not a list', async () => {
  const s = await setup();
  for (const b of [{ pitch: 'on' }, { pitchNow: true }, { pitch: true, pitchNow: 'yes' }, { pitch: true, seen: 'one line' }]) {
    const r = await outcome(s.post(b)); assert.equal(r.status, 400, JSON.stringify(b));
  }
  assert.equal(s.calls.length, 0);
});

// ---------- the rollback: Deploy 35's code (798907c) over the rows this build writes ----------
function day0Functions() {
  try { execFileSync('git', ['-C', ROOT, 'cat-file', '-e', '798907c^{commit}'], { stdio: 'ignore' }); } catch (_) { return null; }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ks18-day0-'));
  const link = path.join(dir, 'node_modules');
  try { return extractDay0(dir, link); } catch (e) { dropDay0({ dir, link }); throw e; }
}
function extractDay0(dir, link) {
  const files = execFileSync('git', ['-C', ROOT, 'ls-tree', '-r', '--name-only', '798907c', 'functions', 'app/display/face-look.js', 'app/features.js'], { encoding: 'utf8' }).split('\n').filter(Boolean);   // functions/ and the two app files it imports
  for (const f of files) {
    const out = path.join(dir, f); fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, execFileSync('git', ['-C', ROOT, 'show', '798907c:' + f], { maxBuffer: 64 * 1024 * 1024 }));
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), link, 'junction');      // the SDK, for the old claude.js import; never written to
  return { dir, link };
}
function dropDay0(d) {
  try { fs.lstatSync(d.link); try { fs.unlinkSync(d.link); } catch (_) { try { fs.rmdirSync(d.link); } catch (__) { /* left */ } } } catch (_) { /* never made */ }
  let gone = false; try { fs.lstatSync(d.link); } catch (_) { gone = true; }
  if (gone) fs.rmSync(d.dir, { recursive: true, force: true });         // only once the junction is gone: never through it
}

await test('rollback (Gate 2): 798907c\'s GET /cards (the reload restore), gm:after\'s read and its tick (spend) run over pitch rows: no error, no card, the cents counted', async () => {
  const d = day0Functions();
  if (!d) return 'skip';      // no git history here (a bare export): say so rather than pass
  try {
    const oldAssist = await import(pathToFileURL(path.join(d.dir, 'functions/api/gm/assist.js')).href);
    const oldCards = await import(pathToFileURL(path.join(d.dir, 'functions/_lib/assist/cards.js')).href);
    assert.ok(!fs.readFileSync(path.join(d.dir, 'functions/api/gm/assist.js'), 'utf8').includes('pitch'), 'it really is the old Worker');
    clock.t = Date.parse('2030-03-02T09:00:00.000Z');
    const s = await setup({ stt: LISTEN() });
    await s.lines(3, { ago: MIN });
    await s.post({ pitch: true });                                           // a woken pitch row
    clock.t += 30_000; await s.post({ pitch: true, pitchNow: true });       // a pitchNow row
    clock.t += 5 * MIN; await s.db.prepare('UPDATE gm_stt SET doc = ?1').bind(JSON.stringify(LISTEN())).run();
    await s.post({ pitch: true });                                           // a quiet-table row
    const prow = s.rows().filter((r) => r.seat === 'pitch');
    assert.equal(prow.length, 3, 'three kinds of pitch row written');
    const cents = s.rows().reduce((a, r) => a + r.cents, 0);
    // the old Worker on the same database
    const old = await setup({ mk: oldAssist.makeHandler, exec: s.exec });
    const got = await old.post(null, 'cards', 'GET');
    assert.equal(got.status, 200); const g = await body(got);
    assert.ok(!g.cards.some((c) => c.seat === 'pitch' || /Ada closes/.test(c.text)), 'no pitch restored as a card');
    const filed = await oldCards.nightCards(old.db, 'c', { now: clock.t, all: true });
    assert.ok(!filed.cards.some((c) => c.seat === 'pitch'), 'gm:after files no pitch');
    clock.t += 30_000;
    const t = await old.post({});                                            // the old tick: nothing new, Listening on
    assert.equal(t.status, 200); const tb = await body(t);
    const before = tb.spend.tonight - tb.spend.tick;                         // the old tick may run its own Stall on the silence: take its spend before this tick
    assert.ok(Math.abs(before - cents / 100) < 1e-6, 'the old spend sums the pitch rows: ' + before + ' vs ' + cents / 100);
    assert.ok(prow.reduce((a, r) => a + r.cents, 0) > 0);
    await old.lines(2); clock.t += 60_000;
    const t2 = await old.post({});                                           // the old tick with talk: its cooldown map holds a 'pitch' seat
    assert.equal(t2.status, 200); const tb2 = await body(t2); assert.ok(!tb2.errors, JSON.stringify(tb2.errors));
    assert.ok(!('pitch' in tb2), 'the old Worker never answers a pitch');
    const oldPitch = await old.post({ pitch: true, pitchNow: true, seen: ['x'] });   // a new page against the old Worker: an ordinary tick
    assert.equal(oldPitch.status, 200); assert.ok(!('pitch' in await body(oldPitch)));
  } finally { dropDay0(d); }
});

// ---------- the page: cf.js assistPitchTick and B68Pitches (gm/kit/blade.js) ----------
await test('cf.js: assistTick is byte-for-byte today\'s; assistPitchTick sends the same body plus pitch, pitchNow and the newest 12 seen, nothing else', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app/runtime/cf.js'), 'utf8');
  assert.ok(src.includes("assistTick: function (after, npc, rolled) { var b = {}; if (after !== undefined && after !== null) b.after = after; if (typeof npc === 'string' && npc) b.npc = npc; if (rolled === true) b.rolled = true; return api('POST', '/gm/assist/tick', b, 55000); },"));
  const m = /assistPitchTick: (function \(more, after, npc, rolled\) \{[^\n]*?\}),\r?\n/.exec(src);
  assert.ok(m, 'assistPitchTick is there');
  const sent = [];
  const fn = new Function('api', 'return ' + m[1])((method, p, b, ms) => { sent.push({ method, p, b, ms }); return Promise.resolve({}); });
  fn({ pitch: true, seen: Array.from({ length: 14 }, (_, i) => 's' + i), other: 1 }, 7, 'Mabel Quist', true);
  fn({ pitch: true, pitchNow: true });
  assert.deepEqual(sent[0], { method: 'POST', p: '/gm/assist/tick', b: { after: 7, npc: 'Mabel Quist', rolled: true, pitch: true, seen: Array.from({ length: 12 }, (_, i) => 's' + (i + 2)) }, ms: 55000 });
  assert.deepEqual(sent[1].b, { pitch: true, pitchNow: true });
});

const blade = require(path.join(ROOT, 'app/gm/kit/blade.js'));
function fakeGm() {
  const g = { sent: [], plain: 0 };
  g.assistTick = function () { g.plain++; return Promise.resolve({ cards: [] }); };
  g.assistPitchTick = function (more, after, npc, rolled) { g.sent.push({ more, after, npc, rolled }); return Promise.resolve(g.reply || { cards: [], pitch: { at: 'x', wake: 'idle', items: [{ kind: 'clue', line: "Dov's ledger has a page cut out", why_now: '', uses: '' }] } }); };
  return g;
}

await test('B68Pitches: on routes the panel\'s assistTick through assistPitchTick (pitch: true, seen); OFF without a reload puts today\'s assistTick back', async () => {
  const B = blade.B68Pitches.make(), g = fakeGm(), orig = g.assistTick;
  assert.equal(B.on(), false);
  assert.equal(B.set(g, true), true); assert.notEqual(g.assistTick, orig); assert.equal(B.on(), true);
  assert.equal(B.set(g, true), true, 'idempotent');
  const got = [];
  const off = B.onReply((r) => got.push(r));
  await g.assistTick(5, 'Mabel Quist');
  assert.deepEqual(g.sent[0], { more: { pitch: true, seen: [] }, after: 5, npc: 'Mabel Quist', rolled: undefined });
  assert.equal(got.length, 1); assert.deepEqual(B.seen(), ["Dov's ledger has a page cut out"], 'arrived lines are remembered');
  await g.assistTick(6);
  assert.deepEqual(g.sent[1].more.seen, ["Dov's ledger has a page cut out"], 'the second request carries the first set\'s lines');
  off();
  B.set(g, false);                                                   // the setting turned off, no reload
  assert.equal(g.assistTick, orig); assert.equal(B.on(), false);
  await g.assistTick(7); assert.equal(g.plain, 1); assert.equal(g.sent.length, 2, 'nothing more through the pitch path');
  await assert.rejects(B.now(), /off/);
  B.set(g, true); const g2 = fakeGm(), orig2 = g2.assistTick;
  B.set(g2, true); assert.equal(g.assistTick, orig, 'a new gm object moves the hook'); assert.notEqual(g2.assistTick, orig2);
  B.set(null, false); assert.equal(g2.assistTick, orig2);
});

await test('B68Pitches.now: pitch + pitchNow + seen at once; two fast presses make one request; remember keeps the newest 12', async () => {
  const B = blade.B68Pitches.make(), g = fakeGm();
  B.set(g, true);
  B.remember(Array.from({ length: 14 }, (_, i) => 'dismissed ' + i));
  assert.equal(B.seen().length, 12); assert.equal(B.seen()[0], 'dismissed 2');
  const a = B.now(), b = B.now();
  assert.equal(a, b, 'one request at a time');
  await a;
  assert.equal(g.sent.length, 1); assert.equal(g.sent[0].more.pitchNow, true); assert.equal(g.sent[0].more.pitch, true); assert.equal(g.sent[0].more.seen.length, 12);
  await B.now(); assert.equal(g.sent.length, 2, 'once it has answered, the next press asks again');
});

await test('gm-page.js: one line, in renderBar, loads blade-pitches only while the setting is on and hands B68Pitches on or off on every render', () => {
  const src = fs.readFileSync(path.join(ROOT, 'app/gm-page.js'), 'utf8');
  const hits = src.split(/\r?\n/).filter((l) => /B68Pitches|blade-pitches/.test(l));
  assert.equal(hits.length, 1, 'one line');
  const l = hits[0];
  assert.ok(/W\.B68Features\.valueOf\(S\.doc, 'blade\.pitches'\)/.test(l));
  assert.ok(/if \(W\.B68Pitches\) W\.B68Pitches\.set\(gmApi\(\), pOn\)/.test(l), 'on or off on every render: a flip off unhooks without a reload');
  assert.ok(/else if \(pOn && W\.B68Load\) W\.B68Load\.need\('blade-pitches'\)/.test(l), 'fetched only while on');
  const fnStart = src.indexOf('function renderBar()'), rest = src.slice(fnStart), fnEnd = rest.search(/\r?\n {2}\}\r?\n/);
  assert.ok(fnStart > 0 && fnEnd > 0 && rest.slice(0, fnEnd).includes(l.trim()), 'inside renderBar');
});

// ---------- the e2e script's fake mode, with pitches on ----------
await test('scripts/gm-assist-e2e.mjs --fake --pitches over the invented night: pitch sets, no Stall or Meanwhile, no key and no network', () => {
  const out = path.join(os.tmpdir(), 'ks18-e2e-' + process.pid + '.txt');
  const env = { ...process.env }; delete env.B68_ANTHROPIC_KEY; delete env.ANTHROPIC_API_KEY;
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/gm-assist-e2e.mjs'), '--transcript', path.join(ROOT, 'checks/runtime/fixtures/gm/pitch-night-transcript.md'), '--fake', '--pitches', '--out', out], { env, encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, r.stderr);
  const rep = fs.readFileSync(out, 'utf8'); fs.rmSync(out, { force: true });
  assert.match(rep, /FAKE CLIENT \(no API calls\)\s+PITCHES ON/);
  const m = /PITCH SETS: (\d+) \(Stall or Meanwhile offers while pitches were on: (\d+)\)/.exec(rep);
  assert.ok(m && Number(m[1]) >= 3 && m[2] === '0', m && m[0]);
  assert.match(rep, /\bscene\s+npc_move:/, 'the scene change woke a set');
  assert.ok(!/^\s+(stall|meanwhile)\s+\d+ calls/m.test(rep), 'neither seat was called');
});

console.log(`\n${passed} passed, ${failed} failed${skippedN ? ', ' + skippedN + ' skipped' : ''}`);
process.exit(failed ? 1 : 0);
