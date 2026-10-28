// Claude at the table: seat leases and call deadlines (S1; design 2.1). On 23/10 a tick the page gave up on was cancelled mid-call, its
// `finally` never ran, and two seats stayed "in flight" for the rest of the night. These tests cover the lease registry on a fake clock,
// callSeat's SDK options, and the endpoint with a fake `call` that hangs: no network, no key. Every name and sentence is invented.
//   node checks/runtime/gm-assist-leases.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { cleanLines, addLines } from '../../functions/_lib/stt.js';
import { makeLeases, LEASE_TTL_MS, DEADLINE_MS } from '../../functions/_lib/assist/leases.js';
import { callSeat, requestOptions } from '../../functions/_lib/assist/claude.js';
import { SEATS } from '../../functions/_lib/assist/seats.js';
import { makeHandler } from '../../functions/api/gm/assist.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

// ---------- the lease registry (fake clock) ----------
const T = 1_000_000_000_000;

await test('leases: acquire gives a token and refuses a second while the lease is live', () => {
  const L = makeLeases();
  const a = L.acquire('ref', T);
  assert.ok(typeof a === 'string' && a.length > 0);
  assert.equal(L.acquire('ref', T + 1000), null, 'live: no second call for the seat');
  assert.ok(L.acquire('clerk', T), 'another seat is independent');
  assert.deepEqual([...L.seats(T + 1000)].sort(), ['clerk', 'ref']);
});

await test('leases: release frees the seat; a token that is not the current one frees nothing', () => {
  const L = makeLeases();
  const first = L.acquire('ref', T);
  assert.equal(L.release('ref', 'someone-else'), false, 'a wrong token');
  assert.ok(L.seats().has('ref'));
  assert.equal(L.release('ref', first), true);
  assert.ok(!L.seats().has('ref'));
  assert.equal(L.release('ref', first), false, 'already released');
  // a late finisher cannot free a newer lease
  const old = L.acquire('ref', T);
  L.sweep(T + LEASE_TTL_MS.ref + 1);                                // old lapsed
  const fresh = L.acquire('ref', T + LEASE_TTL_MS.ref + 2);
  assert.ok(fresh && fresh !== old);
  assert.equal(L.release('ref', old), false, 'the first holder arrives late');
  assert.ok(L.seats().has('ref'), 'the newer lease stands');
  assert.equal(L.release('ref', fresh), true);
});

await test('leases: a lease lapses at its ttl (per seat), is swept, and is reported as reaped exactly once', () => {
  const L = makeLeases();
  L.acquire('tripwire', T); L.acquire('ref', T); L.acquire('fixer', T); L.acquire('ask', T);
  assert.deepEqual(L.sweep(T + 26_999), [], 'nothing has lapsed yet');
  assert.deepEqual(L.sweep(T + 27_000), ['tripwire'], 'the Tripwire: 27 s');
  assert.deepEqual(L.sweep(T + 27_000), [], 'reaped once');
  assert.deepEqual(L.sweep(T + 45_000), ['ref'], 'a tick seat: 45 s');
  assert.deepEqual(L.sweep(T + 60_000), ['fixer'], 'the Fixer: 60 s');
  assert.deepEqual([...L.seats()], ['ask'], 'Ask Blade holds 90 s');
  assert.deepEqual(L.sweep(T + 90_000), ['ask']);
  assert.equal(L.size, 0);
  assert.deepEqual(L.takeReaped().sort(), ['ask', 'fixer', 'ref', 'tripwire'], 'the tick reports every reap once');
  assert.deepEqual(L.takeReaped(), []);
});

await test('leases: a lapsed lease is free to acquire even before anyone sweeps, and the lapse is still reported', () => {
  const L = makeLeases();
  const old = L.acquire('voice', T);
  assert.equal(L.acquire('voice', T + 44_000), null);
  const fresh = L.acquire('voice', T + 45_000);
  assert.ok(fresh && fresh !== old);
  assert.deepEqual(L.takeReaped(), ['voice']);
  assert.ok(!L.seats(T + 45_000 + 45_000).has('voice'), 'seats(now) leaves a lapsed lease out');
});

await test('leases and deadlines: the tables are the ticket\'s, and every deadline sits under its lease ttl', () => {
  const ttl = LEASE_TTL_MS, dl = DEADLINE_MS;
  assert.equal(ttl.tripwire, 27_000); assert.equal(dl.tripwire, 12_000);
  for (const s of ['ref', 'clerk', 'ledger', 'voice', 'stall', 'showrunner', 'mystery', 'scribe', 'meanwhile']) { assert.equal(ttl[s], 45_000, s); assert.equal(dl[s], 30_000, s); }
  for (const s of ['fixer', 'voice_plus', 'gatekeeper', 'portrait', 'wire']) { assert.equal(ttl[s], 60_000, s); assert.equal(dl[s], 45_000, s); }
  for (const s of ['prop', 'ask']) { assert.equal(ttl[s], 90_000, s); assert.equal(dl[s], 75_000, s); }
  for (const s of Object.keys(SEATS).filter((k) => !['sorter', 'writer', 'nightshift_single'].includes(k))) {
    assert.ok(dl[s] && ttl[s], 'every Worker seat has both: ' + s);
    assert.ok(dl[s] < ttl[s], s + ': the deadline is under the ttl');
  }
});

// ---------- callSeat hands the deadline to the SDK ----------
const OK = { content: [{ type: 'text', text: '{"a":1}' }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn' };

await test('callSeat: with a deadline the SDK gets { timeout, maxRetries: 1, signal } as its request options; without one, none (the PC scripts keep the SDK defaults)', async () => {
  const seen = [];
  const client = { messages: { async create(params, opts) { seen.push({ via: 'create', opts }); return OK; }, stream(params, opts) { seen.push({ via: 'stream', opts }); return { finalMessage: async () => OK }; } } };
  const ctl = new AbortController();
  await callSeat(client, { model: 'claude-haiku-5-5', effort: 'low', instructions: 'i', user: 'u', schema: { type: 'object' }, deadlineMs: 12_000, signal: ctl.signal });
  assert.deepEqual(seen[0], { via: 'create', opts: { timeout: 12_000, maxRetries: 1, signal: ctl.signal } });
  await callSeat(client, { model: 'claude-haiku-5-5', effort: 'low', instructions: 'i', user: 'u', maxTokens: 20000, deadlineMs: 30_000, signal: ctl.signal });
  assert.deepEqual(seen[1], { via: 'stream', opts: { timeout: 30_000, maxRetries: 1, signal: ctl.signal } }, 'the streaming path takes the same options');
  await callSeat(client, { model: 'claude-haiku-5-5', effort: 'low', instructions: 'i', user: 'u' });
  assert.equal(seen[2].opts, undefined, 'no deadline, no options');
  assert.equal(requestOptions(0), undefined); assert.equal(requestOptions(NaN), undefined);
  assert.deepEqual(requestOptions(5000), { timeout: 5000, maxRetries: 1 });
});

// ---------- the endpoint, with a fake `call` ----------
const GM = { role: 'gm', id: 'gm@example.test' };
const clock = { t: Date.parse('2030-01-01T09:30:00.000Z') };
const iso = (ms) => new Date(ms).toISOString();
const NONE = Object.fromEntries(['roll_talk', 'harm', 'npc_change', 'new_name', 'clue_mention', 'xp_trigger', 'scene_change', 'stall'].map((f) => [f, false]));
const REF_SLIP = { slip: true, said_at: '09:29', what_was_said: 'rolled first', rule: 'Position comes before the roll (p.9)', card: 'Position was named after the roll' };
const REPLIES = {
  tripwire: { ...NONE, roll_talk: true },
  ref: REF_SLIP,
  ledger: { events: [], xp_totalled: false },
  voice: { who: 'Mrs Test', want: 'to be paid', line_a: 'Pay up, dear.', line_b: 'I could forget I saw you.' },
  fixer: { read: 'who, where, risky standard', one_three: 'a', four_five: 'b', six: 'c', crit: 'd', bargain: 'e' },
};
const result = (json) => ({ json, text: JSON.stringify(json), usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0 }, cost: 0.01, stop: 'end_turn', secs: 0.1 });
const seatOf = (args) => Object.keys(SEATS).find((k) => args.instructions.startsWith(SEATS[k].instructions));
const SHORT = Object.fromEntries(Object.keys(DEADLINE_MS).map((k) => [k, 40]));      // 40 ms deadlines for the tests that want one to fire
const DRAWS = { low: 'Lost opportunity: the way in is shut.', mid: 'Complication: a second watcher arrives.' };

/** `behave(seat, n, args)` may return a promise (a hang) or nothing: the default answer is the seat's canned reply. */
async function setup({ behave = () => undefined, deadlines, leases = makeLeases() } = {}) {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec);
  const env = { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'sk-ant-test-0000' };
  const calls = [], count = {};
  const call = async (client, args) => {
    const seat = seatOf(args);
    count[seat] = (count[seat] || 0) + 1;
    calls.push({ seat, n: count[seat], deadlineMs: args.deadlineMs, signal: args.signal });
    const held = behave(seat, count[seat], args);
    if (held && typeof held.then === 'function') await held;
    return result(REPLIES[seat]);
  };
  const handler = makeHandler({ clientFor: () => ({}), now: () => clock.t, call, leases, ...(deadlines ? { deadlines } : {}) });
  const lines = (n) => addLines(db, 'c', cleanLines({ lines: Array.from({ length: n }, (_, i) => ({ id: 'l' + Math.random().toString(36).slice(2, 10) + i, at: iso(clock.t - 20_000 + i), session: '3', conn: 'x', speaker: 0, text: 'we roll the dice now ' + i, ...{} })) }));
  const collected = [];
  const post = (action, body, extra = {}) => handler({ request: new Request('https://blades.example.test/api/gm/assist/' + action, { method: 'POST', body: JSON.stringify(body || {}), headers: { 'Content-Type': 'application/json' }, ...(extra.signal ? { signal: extra.signal } : {}) }), env, data: { me: GM }, ...(extra.waitUntil === false ? {} : { waitUntil: (p) => collected.push(p) }) });
  const rows = () => exec.db.prepare('SELECT * FROM gm_assist_log ORDER BY id').all().map((r) => ({ ...r, card: r.card ? JSON.parse(r.card) : null }));
  const seed = (seat, ageMs) => exec.db.prepare("INSERT INTO gm_assist_log (campaign, at, session, seat, model, effort, cents, flags, card) VALUES ('c', ?, '', ?, 'seed', '', 0, '', '{}')").run(iso(clock.t - ageMs), seat);
  return { exec, db, env, calls, count, handler, lines, post, rows, seed, leases, collected };
}
const body = async (res) => JSON.parse(await res.text());
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const settle = () => new Promise((r) => setTimeout(r, 15));

await test('a seat call that never resolves hits its deadline: the answer is a failed call, a timeout row is logged, and the seat is free again', async () => {
  clock.t += 3_600_000;
  const s = await setup({ deadlines: SHORT, behave: (seat, n) => (n === 1 ? new Promise(() => {}) : undefined) });   // the first Fixer call hangs and ignores the abort
  await s.lines(2);
  const out = await body(await s.post('fit', { position: 'risky', draws: DRAWS }));
  assert.deepEqual(out.cards, [], 'nothing shown');
  assert.deepEqual(out.errors, [{ seat: 'fixer', error: 'timed out' }]);
  assert.equal(out.health, undefined, 'health is the tick\'s');
  const row = s.rows().find((r) => r.seat === 'fixer');
  assert.equal(row.card.timeout, 1); assert.equal(row.card.shown, 0); assert.equal(typeof row.card.secs, 'number');
  assert.equal(row.card.error, 'timed out');
  assert.equal(s.calls[0].deadlineMs, 40, 'the deadline reached the call');
  assert.ok(s.calls[0].signal && s.calls[0].signal.aborted, 'and its signal was fired at the deadline, which also ends an SDK retry');
  assert.equal(s.leases.size, 0, 'released in finally');
  // free again: past the Fixer's 10 s cooldown the next press runs and shows its card
  clock.t += 11_000;
  const again = await body(await s.post('fit', { position: 'risky', draws: DRAWS }));
  assert.equal(again.cards.length, 1); assert.equal(again.errors, undefined);
  assert.equal(s.count.fixer, 2);
});

await test('a call that honours its signal rejects on abort: the same timeout row, no unhandled rejection', async () => {
  clock.t += 3_600_000;
  const unhandled = []; const onUn = (e) => unhandled.push(e); process.on('unhandledRejection', onUn);
  const s = await setup({ deadlines: SHORT, behave: (seat, n, args) => new Promise((_, rej) => args.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'APIUserAbortError' })))) });
  await s.lines(2);
  const out = await body(await s.post('fit', { position: 'risky', draws: DRAWS }));
  assert.deepEqual(out.errors, [{ seat: 'fixer', error: 'timed out' }]);
  assert.equal(s.rows().find((r) => r.seat === 'fixer').card.timeout, 1);
  await settle(); process.off('unhandledRejection', onUn);
  assert.deepEqual(unhandled, []);
});

await test('the SDK\'s own timeout error is a timeout row too (not "call failed")', async () => {
  clock.t += 3_600_000;
  class APIConnectionTimeoutError extends Error {}
  const s = await setup({ behave: () => { throw new APIConnectionTimeoutError('Request timed out.'); } });
  await s.lines(2);
  const out = await body(await s.post('fit', { position: 'risky', draws: DRAWS }));
  assert.deepEqual(out.errors, [{ seat: 'fixer', error: 'timed out' }]);
  assert.equal(s.rows().find((r) => r.seat === 'fixer').card.timeout, 1);
});

await test('a tick whose Voice hangs: Voice times out on its own deadline, Ref\'s card still comes, and health + the Tripwire row say what was skipped', async () => {
  clock.t += 3_600_000;
  const s = await setup({ deadlines: { ...SHORT, voice: 80 }, behave: (seat) => (seat === 'voice' ? new Promise(() => {}) : undefined) });
  await s.lines(3);
  await s.seed('showrunner', 60_000); await s.seed('scribe', 60_000);        // both are inside their cooldowns, so decide() skips them
  const out = await body(await s.post('tick', { after: 0, npc: 'Mrs Test' }));
  assert.equal(out.cards.length, 1, 'Ref\'s card was not held by the slow seat');
  assert.equal(out.cards[0].seat, 'ref');
  assert.equal(out.voice, undefined);
  assert.deepEqual(out.errors, [{ seat: 'voice', error: 'timed out' }]);
  assert.deepEqual(out.health.reaped, []);
  const why = Object.fromEntries(out.health.skipped.map((x) => [x.seat, x.why]));
  assert.deepEqual(why, { showrunner: 'cooldown', scribe: 'cooldown' });
  const rows = s.rows();
  const vrow = rows.find((r) => r.seat === 'voice');
  assert.equal(vrow.card.timeout, 1); assert.equal(vrow.card.shown, 0);
  const trow = rows.find((r) => r.seat === 'tripwire');
  assert.deepEqual(trow.card.skipped, out.health.skipped, 'the Tripwire row carries the Conductor\'s skipped list');
  assert.equal(rows.filter((r) => r.seat === 'tripwire').length, 1, 'one Tripwire row per tick, as before');
  assert.equal(rows.find((r) => r.seat === 'ref').card.shown, 1);
  assert.equal(s.calls.find((c) => c.seat === 'tripwire').deadlineMs, 40, 'each seat is on its own deadline');
  assert.equal(s.leases.size, 0);
});

await test('a quiet tick (nothing new) still answers with health', async () => {
  clock.t += 3_600_000;
  const s = await setup();
  const out = await body(await s.post('tick', { after: 0 }));
  assert.deepEqual(out.health, { skipped: [], reaped: [] });
  assert.equal(s.calls.length, 0);
});

await test('the stuck-seat night: a hung call whose request the page abandoned holds its lease until the ttl, then the next tick reaps it and the seat runs again', async () => {
  clock.t += 3_600_000;
  const gate1 = deferred(), gate2 = deferred();
  const s = await setup({ behave: (seat, n) => (seat === 'tripwire' ? (n === 1 ? gate1.promise : n === 2 ? gate2.promise : undefined) : undefined) });
  await s.lines(3);
  await s.seed('showrunner', 60_000); await s.seed('scribe', 60_000);
  // 1: the page's tick. Its Tripwire call hangs; the page gives up (the request's own signal fires) but waitUntil keeps the work going
  const page = new AbortController();
  const first = s.post('tick', { after: 0 }, { signal: page.signal });
  await settle();
  assert.equal(s.collected.length, 1, 'the work was handed to waitUntil as one promise');
  page.abort();
  await settle();
  assert.equal(s.count.tripwire, 1);
  assert.ok(s.leases.seats().has('tripwire'), 'the Tripwire holds its lease');
  assert.ok(!s.calls[0].signal.aborted, 'the page giving up does not cancel the call');
  // 2: the next tick, inside the ttl: the Tripwire is in flight, said so in health, and no second call is made
  clock.t += 20_000;
  let out = await body(await s.post('tick', { after: 0 }));
  assert.deepEqual(out.health, { skipped: [{ seat: 'tripwire', why: 'in-flight' }], reaped: [] });
  assert.equal(s.count.tripwire, 1);
  // 3: past the 27 s ttl: the lease is reaped, reported once, and the Tripwire runs (this call hangs too)
  clock.t += 8_000;
  const third = s.post('tick', { after: 0 }, { waitUntil: false });
  await settle();
  assert.equal(s.count.tripwire, 2, 'free after its ttl');
  assert.ok(s.leases.seats().has('tripwire'));
  // the first holder finally finishes: its late release must not free the newer lease
  gate1.resolve(); const firstRes = await first;
  assert.equal(firstRes.status, 200);
  assert.ok(s.leases.seats().has('tripwire'), 'a late finisher does not free the newer lease');
  gate2.resolve();
  out = await body(await third);
  assert.deepEqual(out.health.reaped, ['tripwire'], 'reaped is reported once, on the tick that swept it');
  assert.equal(s.leases.size, 0);
  out = await body(await s.post('tick', { after: 0 }));
  assert.deepEqual(out.health.reaped, [], 'and not again');
  await Promise.all(s.collected);
});

await test('the page gives up on a tick whose Tripwire never answers: waitUntil alone keeps the work alive, and it still writes the timeout row and frees the lease', async () => {
  clock.t += 3_600_000;
  const s = await setup({ deadlines: { ...SHORT, tripwire: 60 }, behave: (seat) => (seat === 'tripwire' ? new Promise(() => {}) : undefined) });
  await s.lines(3);
  const page = new AbortController();
  const response = s.post('tick', { after: 0 }, { signal: page.signal });          // nobody awaits the response: the page has gone
  response.catch(() => {});
  await settle();
  page.abort();
  assert.equal(s.collected.length, 1, 'one promise handed to waitUntil');
  assert.ok(s.leases.seats().has('tripwire'), 'the lease is held while the call hangs');
  await s.collected[0];                                                            // only the platform's grace period is waiting on it now
  const row = s.rows().find((r) => r.seat === 'tripwire');
  assert.ok(row, 'the row was written after the page left');
  assert.equal(row.card.timeout, 1); assert.equal(row.card.shown, 0); assert.equal(row.card.error, 'timed out');
  assert.equal(s.leases.size, 0, 'and the lease was released');
  assert.ok(s.calls[0].signal.aborted, 'the deadline, not the page, ended the call');
  const out = await body(await response);
  assert.deepEqual(out.errors, [{ seat: 'tripwire', error: 'timed out' }]);
});

await test('a /fit that sweeps first does not swallow the reap the tick reports', async () => {
  clock.t += 3_600_000;
  const s = await setup();
  await s.lines(2);
  s.leases.acquire('ref', clock.t);                                  // a lease nobody will release: the 23/10 state
  clock.t += 46_000;
  await s.post('fit', { position: 'risky', draws: DRAWS });          // sweeps the lapsed lease on its way
  assert.equal(s.leases.size, 0);
  const out = await body(await s.post('tick', { after: 0 }));
  assert.deepEqual(out.health.reaped, ['ref']);
});

await test('a seat that is leased is a 429 busy for a tap, and the work still goes through waitUntil when a request fails (the failure reaches the caller)', async () => {
  clock.t += 3_600_000;
  const s = await setup();
  await s.lines(2);
  s.leases.acquire('fixer', clock.t);
  await assert.rejects(s.post('fit', { position: 'risky', draws: DRAWS }), (e) => e.status === 429 && /busy/.test(e.message));
  assert.equal(s.collected.length, 1);
  await s.collected[0];                                              // the copy handed to waitUntil resolves: no unhandled rejection from a 429
  await assert.rejects(s.post('fit', { position: '', draws: DRAWS }), (e) => e.status === 400);
  await Promise.all(s.collected);
  assert.equal(s.calls.length, 0);
});

await test('no waitUntil (the tests, node) is fine: the handler answers as before', async () => {
  clock.t += 3_600_000;
  const s = await setup();
  await s.lines(2);
  const res = await s.post('fit', { position: 'risky', draws: DRAWS }, { waitUntil: false });
  assert.equal(res.status, 200);
  assert.equal(s.collected.length, 0);
});

console.log(failed ? `\n${failed} FAILED, ${passed} passed` : `\nALL PASSED (${passed})`);
process.exit(failed ? 1 : 0);
