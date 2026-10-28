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

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
