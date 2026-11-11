// S6: the Ask and Tick routes' CPU fixes. (1) Melbourne's HH:MM by arithmetic equals Intl's over 2008-2060, transitions included.
// (2) The Worker's SDK client is built once per isolate per key, keyed by a hash (never the key), and a shared client still gives every
// call its own timeout and AbortSignal, with calls overlapping. No network and no key; every value is invented.
//   node checks/runtime/gm-assist-cpu.test.mjs
import assert from 'node:assert/strict';
import Anthropic from '@anthropic-ai/sdk';
import { melbourneHHMM, melbourneOffsetHours } from '../../functions/_lib/assist/clock.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { makeHandler } from '../../functions/api/gm/assist.js';
import { cachedClient, clientCacheSize, callSeat, requestOptions } from '../../functions/_lib/assist/claude.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const fmt = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Melbourne', hour: '2-digit', minute: '2-digit', hour12: false });
const intl = (ms) => fmt.format(new Date(ms)).replace(/^24:/, '00:');

await test('clock: equals Intl for every daylight-saving change (a minute either side) from 2008 to 2060', () => {
  let n = 0;
  for (let y = 2008; y <= 2060; y++) for (const month of [3, 9]) {
    // scan the first fortnight of the month hourly, then the minutes around each hour boundary of the two days that hold the change
    for (let t = Date.UTC(y, month, 1); t < Date.UTC(y, month, 9); t += 15 * 60000) for (const d of [-60000, 0, 60000]) { assert.equal(melbourneHHMM(t + d), intl(t + d), new Date(t + d).toISOString()); n++; }
  }
  assert.ok(n > 100000);
});
await test('clock: equals Intl on 40,000 pseudo-random instants 2008-2060, and midnight reads 00:', () => {
  let x = 123456789;
  const rnd = () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296;
  const lo = Date.UTC(2008, 0, 1), hi = Date.UTC(2061, 0, 1);
  for (let i = 0; i < 40000; i++) { const t = Math.floor(lo + rnd() * (hi - lo)); assert.equal(melbourneHHMM(t), intl(t), new Date(t).toISOString()); }
  assert.equal(melbourneHHMM(Date.parse('2026-06-01T14:05:00Z')), '00:05');
  assert.equal(melbourneOffsetHours(Date.parse('2026-06-01T00:00:00Z')), 10);
  assert.equal(melbourneOffsetHours(Date.parse('2026-12-01T00:00:00Z')), 11);
});

await test('client cache: one client per key, a different key gets its own, and the size stays bounded', () => {
  let built = 0;
  const make = (k) => { built++; return { apiKey: k }; };
  const a = cachedClient('sk-test-aaaa', make), a2 = cachedClient('sk-test-aaaa', make);
  assert.equal(a, a2); assert.equal(built, 1);
  const b = cachedClient('sk-test-bbbb', make);
  assert.notEqual(a, b); assert.equal(built, 2);
  assert.equal(cachedClient('sk-test-aaaa', make), a, 'the first key is still cached');
  for (let i = 0; i < 20; i++) cachedClient('sk-test-fill-' + i, make);
  assert.ok(clientCacheSize() <= 4, 'size ' + clientCacheSize());
});

await test('client cache: a hit whose client holds a different key is rebuilt, never reused', () => {
  let built = 0;
  const make = (k) => { built++; return { apiKey: k }; };
  const a = cachedClient('sk-test-cas-0001', make);
  a.apiKey = 'sk-test-someone-else';                 // what a hash collision would look like: the entry under this key holds another key
  const b = cachedClient('sk-test-cas-0001', make);
  assert.notEqual(a, b); assert.equal(built, 2); assert.equal(b.apiKey, 'sk-test-cas-0001');
  assert.equal(cachedClient('sk-test-cas-0001', make), b, 'and the rebuilt client is the one cached now');
});

await test('client cache: the default is a real SDK client, shared, built from the key given', () => {
  const c = cachedClient('sk-test-real-0001'), c2 = cachedClient('sk-test-real-0001');
  assert.ok(c instanceof Anthropic); assert.equal(c, c2);
  assert.equal(c.apiKey, 'sk-test-real-0001');
});

await test('route: the default handler gets its client from the cache (built once, reused by the next request), with no model called', async () => {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec);                                       // no assist pack: the route answers before any model call
  const env = { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'sk-test-route-1' };
  const h = makeHandler();                                     // the default clientFor, which is the one the Worker uses
  const post = () => h({ request: new Request('https://blades.example.test/api/gm/assist/ask', { method: 'POST', body: JSON.stringify({ q: 'Where is the lantern?' }) }), env, data: { me: { role: 'gm', id: 'gm@example.test' } } });
  const r1 = await post(); assert.equal(r1.status, 200);
  const body = await r1.json(); assert.equal(body.answer, null); assert.ok(body.warnings && body.warnings.length, 'it stopped at the missing pack, before any call');
  const size = clientCacheSize();
  // the client for this key is already cached: asking for it again must not build one
  const c = cachedClient('sk-test-route-1', () => { throw new Error('rebuilt'); });
  assert.ok(c instanceof Anthropic);
  await post();
  assert.equal(clientCacheSize(), size, 'a second request adds no client');
  assert.equal(cachedClient('sk-test-route-1', () => { throw new Error('rebuilt'); }), c);
});

await test('shared client: overlapping calls each carry their own timeout and signal; aborting one leaves the other', async () => {
  // a REAL SDK client, shared, with the network replaced: the fake fetch holds each request until its own signal fires or it is released
  const seen = [];
  const releases = [];
  const fakeFetch = (url, init) => new Promise((resolve, reject) => {
    const id = seen.length; seen.push({ signal: init.signal });
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    releases.push(() => resolve(new Response(JSON.stringify({ id: 'm', type: 'message', role: 'assistant', model: 'claude-haiku-5-5', content: [{ type: 'text', text: '{"ok":true}' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } })));
  });
  const client = cachedClient('sk-test-overlap-1', (k) => new Anthropic({ apiKey: k, fetch: fakeFetch }));
  assert.equal(cachedClient('sk-test-overlap-1'), client);
  const ctl1 = new AbortController(), ctl2 = new AbortController();
  const base = { model: 'claude-haiku-5-5', effort: 'low', prefixFileId: 'file_test000001', instructions: 'i', user: 'u', schema: { type: 'object' } };
  const p1 = callSeat(client, { ...base, deadlineMs: 30000, signal: ctl1.signal }).then((r) => ({ r }), (e) => ({ e }));
  const p2 = callSeat(client, { ...base, deadlineMs: 45000, signal: ctl2.signal }).then((r) => ({ r }), (e) => ({ e }));
  for (let i = 0; i < 50 && seen.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
  assert.equal(seen.length, 2, 'both requests reached the transport');
  ctl1.abort();                                   // the first call's deadline fires
  releases[1]();                                  // the second answers
  const [o1, o2] = await Promise.all([p1, p2]);
  assert.ok(o1.e, 'the aborted call fails'); assert.ok(o2.r && o2.r.json && o2.r.json.ok === true, 'the other call is unharmed');
  // the options the Worker puts on each call are still exactly requestOptions
  assert.deepEqual(Object.keys(requestOptions(30000, ctl2.signal)).sort(), ['maxRetries', 'signal', 'timeout']);
  assert.equal(requestOptions(30000, ctl2.signal).timeout, 30000);
});

// ---------- KS18: the pitch seat's paths (blade.pitches) on Workers Free's 10 ms ----------
// CPU on the tick is the JSON work plus about 0.2 ms per D1 round trip. The pitch wake path and the pitchNow path must add no round trip to the
// tick they ride (a woken pitch reads the clocks and the story inside the existing pre-seat batch, as Meanwhile did), and the pitch code itself
// must be cheap. Counted on an in-memory D1 with a fake client; no key, no network.
const P = await import('../../functions/_lib/assist/pitch.js');
const { SEATS } = await import('../../functions/_lib/assist/seats.js');
const { cleanLines, addLines } = await import('../../functions/_lib/stt.js');
async function pitchWorld({ listening = false } = {}) {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec), clock = { t: Date.parse('2030-04-01T09:00:00.000Z') };
  const iso = (ms) => new Date(ms).toISOString();
  exec.db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'assist', 'v', '{}', 0, ?)").run(JSON.stringify({ file_id: 'file_test000001' }));
  if (listening) exec.db.prepare('INSERT INTO gm_stt (campaign, updated_at, doc) VALUES (?, ?, ?)').run('c', iso(clock.t), JSON.stringify({ want: 'on', session: '3', speakers: {}, status: { state: 'listening', at: iso(clock.t), lines: 5, error: '' } }));
  const NONE = Object.fromEntries(['roll_talk', 'harm', 'npc_change', 'new_name', 'clue_mention', 'xp_trigger', 'scene_change', 'stall', 'downtime'].map((f) => [f, false]));
  const replies = { tripwire: { ...NONE, scene_change: true }, stall: { stalled: true, kind: 'clue', offer: 'A runner arrives.', why_now: 'quiet' }, meanwhile: { faction: 'F', cutaway: 'A lamp is lit.', clock: '', suggest_ticks: 0, why: '' },
    showrunner: { spotlight: [], needs_spotlight: '', beat: 'rising', elapsed_minutes: 1, advice: '', speak: false }, scribe: { story: 'S.', corrections: [] }, whois: { guesses: [] },
    pitch: { pitches: [{ kind: 'clue', line: 'A page is missing', why_now: 'x', uses: '' }, { kind: 'direction', line: 'Cut to the stairs', why_now: 'x', uses: '' }] } };
  const client = { messages: { async create(req) {
    const ins = req.messages[0].content.filter((b) => b.type === 'text').map((b) => b.text)[0];
    const seat = Object.keys(SEATS).find((k) => ins.startsWith(SEATS[k].instructions));
    return { content: [{ type: 'text', text: JSON.stringify(replies[seat] || {}) }], usage: { input_tokens: 10, output_tokens: 5 }, stop_reason: 'end_turn' };
  } } };
  const h = makeHandler({ clientFor: () => client, now: () => clock.t });
  const env = { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'sk-test-pitch-0001' };
  const lines = (n, ago) => addLines(db, 'c', cleanLines({ lines: Array.from({ length: n }, (_, i) => ({ id: 'q' + clock.t + '-' + i, at: iso(clock.t - ago + i * 100), session: '3', conn: 'x', speaker: 0, text: 'we talk on the stairs ' + i, kind: 'line' })) }));
  const post = (b) => h({ request: new Request('https://blades.example.test/api/gm/assist/tick', { method: 'POST', body: JSON.stringify(b) }), env, data: { me: { role: 'gm', id: 'gm@example.test' } } });
  await h({ request: new Request('https://blades.example.test/api/gm/assist/cards'), env, data: { me: { role: 'gm', id: 'gm@example.test' } } });   // the once-per-isolate schema batch
  const trips = async (b) => { const t0 = exec.calls; const res = await post(b); assert.equal(res.status, 200); return { trips: exec.calls - t0, json: await res.json() }; };
  return { clock, lines, trips, exec };
}

await test('KS18 pitch wake path: a scene change with pitch: true makes the same D1 round trips as the same tick today (pitch takes Meanwhile\'s reads)', async () => {
  const off = await pitchWorld(); await off.lines(20, 50_000);
  const a = await off.trips({});
  const on = await pitchWorld(); await on.lines(20, 50_000);
  const b = await on.trips({ pitch: true, seen: ['an old line'] });
  assert.ok(a.json.meanwhile && !a.json.pitch, 'today: Meanwhile'); assert.ok(b.json.pitch && !b.json.meanwhile, 'pitches: a set');
  assert.equal(b.trips, a.trips, 'round trips: pitches ' + b.trips + ', today ' + a.trips);
});

await test('KS18 pitchNow path: three D1 round trips (the opening batch, story and clocks in one batch, the row), no Tripwire', async () => {
  const w = await pitchWorld(); await w.lines(20, 50_000);
  const r = await w.trips({ pitch: true, pitchNow: true });
  assert.equal(r.json.pitch.wake, 'asked');
  assert.equal(r.trips, 3);
});

await test('KS18 quiet path: with pitch: true the silence costs no more round trips than today\'s Stall on the silence', async () => {
  const run = async (b) => { const w = await pitchWorld({ listening: true }); await w.lines(5, 5 * 60_000); return w.trips(b); };
  const today = await run({ after: 999 }), pitched = await run({ after: 999, pitch: true });
  assert.ok(today.json.stall && pitched.json.pitch, 'both offered something');
  assert.ok(pitched.trips <= today.trips, 'pitches ' + pitched.trips + ' vs today ' + today.trips);
});

await test('KS18 the pitch code is cheap: body check, wake, turn (four minutes of talk) and answer under 0.5 ms a tick on this machine', () => {
  const talk = Array.from({ length: 80 }, (_, i) => '[21:0' + (i % 10) + '] Speaker ' + (i % 4) + ': a line of table talk about the stairs and the ledger ' + i).join('\n');
  const seen = Array.from({ length: 12 }, (_, i) => 'a line shown earlier tonight ' + i);
  const reply = { pitches: [{ kind: 'clue', line: 'A page is missing from the book', why_now: 'the ledger came up', uses: '' }, { kind: 'direction', line: 'Cut to the stairs', why_now: 'x', uses: '' }, { kind: 'npc_move', line: 'Someone stops pouring', why_now: 'x', uses: '' }] };
  const once = () => { const b = P.cleanPitchBody({ pitch: true, seen }); P.decidePitch({ flags: ['scene_change', 'tick'], now: 1e12, lastRun: { pitch: 1e12 - 600000 }, tier: 'all' }); P.pitchUser({ wake: 'scene', npc: 'N', clocks: [{ name: 'C', filled: 1, size: 4 }], seen: b.seen, stamp: '21:09', talk }); P.toPitches(reply, { seen: b.seen }); };
  for (let i = 0; i < 200; i++) once();
  const N = 2000, c0 = process.cpuUsage(); for (let i = 0; i < N; i++) once(); const c = process.cpuUsage(c0);
  const ms = (c.user + c.system) / 1000 / N;
  assert.ok(ms < 0.5, ms.toFixed(4) + ' ms a tick');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
