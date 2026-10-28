// The one place the app talks to Claude (docs: the "Claude at the table" build plan). A thin wrapper over
// @anthropic-ai/sdk that handles the cached prefix, the effort level, schema-checked JSON output and a cost figure
// from the usage block. Plain ES module with no Cloudflare-specific imports, so node (the replay script) can import it.
//
// Prompt layout: there is NO system prompt. The shared prefix (rules digest, cast, prep) is a document block at the top of
// the USER turn with the 1-hour cache breakpoint on it; then the seat's own instructions; then the fresh talk. Nothing
// seat-specific comes before the breakpoint in OUR request, but the per-seat JSON schema (output_config.format) is placed ahead of the messages by
// the API, so each seat keeps its own cache entry: about one extra prefix write per seat per hour. The Worker names the prefix
// by Files API id (`prefixFileId`) so it never holds the text; PC scripts pass the same text inline (`prefix`).

import Anthropic from '@anthropic-ai/sdk';

// $ per million tokens. Haiku 5.5's rates hold up to 100k prompt tokens (they rise above that).
export const PRICES = {
  'claude-haiku-5-5': { in: 0.10, out: 0.50, read: 0.01 },
  'claude-sonnet-5-5': { in: 2.00, out: 10.00, read: 0.20 },
  'claude-opus-5-5': { in: 4.00, out: 20.00, read: 0.20 },
};
const WRITE_1H = 2;   // a 1-hour cache write costs 2x the input rate (5-minute: 1.25x)

export function makeClient(apiKey) {
  return new Anthropic({ apiKey });
}

// The Worker's client, one per isolate. Building an SDK client is the dearest thing on the Ask and Tick routes (S6 profile: 13-19 ms in the
// first request of an isolate, almost all of it the SDK's first read of process.env; a client built again on a warm isolate is cheap but
// pointless). The client holds no per-request state: the deadline, retry count and AbortSignal go on each call (requestOptions), so one is
// safe to share between requests. The cache is keyed by a 53-bit hash of the key, never the key, so a rotated secret gets a new client and
// the key text appears in no map key, log or global name. At most KEEP clients stay (a rotation leaves the old one to fall out).
const clients = new Map();
const KEEP = 4;
function hash53(s) {         // cyrb53: sync and cheap, so clientFor stays sync
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
export function cachedClient(apiKey, make = makeClient) {
  const id = hash53(String(apiKey)) + ':' + String(apiKey).length;
  let c = clients.get(id);
  if (!c) {
    c = make(apiKey);
    if (clients.size >= KEEP) clients.delete(clients.keys().next().value);
    clients.set(id, c);
  }
  return c;
}
export const clientCacheSize = () => clients.size;

// Pay the SDK's one-off setup at module load (isolate start) instead of inside the first request. The placeholder is not a key and makes no call.
// Whether the platform bills the global scope to the first request is NOT measurable locally (see the S6 report); if it does, this costs nothing extra.
try { new Anthropic({ apiKey: 'warm-up' }); } catch { /* best effort */ }

// cents-free dollars for one response's usage.
export function costOf(model, usage) {
  const p = PRICES[model];
  if (!p || !usage) return 0;
  const write = usage.cache_creation_input_tokens || 0;
  const read = usage.cache_read_input_tokens || 0;
  return ((usage.input_tokens || 0) * p.in + write * p.in * WRITE_1H + read * p.read + (usage.output_tokens || 0) * p.out) / 1e6;
}

// The user-turn content blocks: [document (cached)], instructions, talk.
export function buildContent({ prefix, prefixFileId, instructions = '', user }) {
  const content = [];
  if (prefixFileId) content.push({ type: 'document', source: { type: 'file', file_id: prefixFileId }, title: 'context', cache_control: { type: 'ephemeral', ttl: '1h' } });
  else if (prefix) content.push({ type: 'document', source: { type: 'text', media_type: 'text/plain', data: prefix }, title: 'context', cache_control: { type: 'ephemeral', ttl: '1h' } });
  if (instructions) content.push({ type: 'text', text: instructions });
  content.push({ type: 'text', text: user });
  return content;
}

// One seat call. `prefixFileId` (Worker) or `prefix` (scripts) is the shared cached text; `instructions` is the seat's own;
// `user` is the fresh tail. `schema` makes the reply JSON. Returns { json, text, usage, cost, stop, secs }.
// `deadlineMs` (the Worker passes it, with the `signal` that fires at the same moment) puts the SDK's per-request options on the call:
// a timeout, ONE retry, and the signal, which also ends any retry. Without it (the PC scripts) the SDK's own defaults stand.
export function requestOptions(deadlineMs, signal) {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) return undefined;
  return { timeout: deadlineMs, maxRetries: 1, ...(signal ? { signal } : {}) };
}

export async function callSeat(client, { model, effort, prefix, prefixFileId, instructions, user, schema, maxTokens = 4000, deadlineMs, signal }) {
  const output_config = { effort };
  if (schema) output_config.format = { type: 'json_schema', schema };
  const params = {
    model, max_tokens: maxTokens, output_config,
    messages: [{ role: 'user', content: buildContent({ prefix, prefixFileId, instructions, user }) }],
  };
  // Long outputs (the Night Shift writer thinks at high effort) must stream: the SDK refuses a big non-streaming request.
  const t0 = Date.now();
  const opts = requestOptions(deadlineMs, signal);
  const res = maxTokens > 16000 ? await client.messages.stream(params, opts).finalMessage() : await client.messages.create(params, opts);
  const secs = Math.round((Date.now() - t0) / 100) / 10;      // wall-clock of the call, in seconds
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let json = null;
  if (schema && text) { try { json = JSON.parse(text); } catch { json = null; } }
  return { json, text, usage: res.usage, cost: costOf(model, res.usage), stop: res.stop_reason, secs };
}

// Free: how many tokens would this prompt be. Uses the same layout as callSeat.
export async function countTokens(client, { model, prefix, prefixFileId, instructions = '', user }) {
  const r = await client.messages.countTokens({ model, messages: [{ role: 'user', content: buildContent({ prefix, prefixFileId, instructions, user }) }] });
  return r.input_tokens;
}
