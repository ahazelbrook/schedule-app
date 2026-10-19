// The one place the app talks to Claude (docs: the "Claude at the table" build plan). A thin wrapper over
// @anthropic-ai/sdk that handles the cached prefix, the effort level, schema-checked JSON output and a cost figure
// from the usage block. Plain ES module with no Cloudflare-specific imports, so node (the replay script) can import it.
//
// Prefix order matters: the rules digest and context go in `system` first with the cache breakpoint on the last
// block; the seat's own instructions come after it, so every seat on one model shares one cache entry.

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

// cents-free dollars for one response's usage.
export function costOf(model, usage) {
  const p = PRICES[model];
  if (!p || !usage) return 0;
  const write = usage.cache_creation_input_tokens || 0;
  const read = usage.cache_read_input_tokens || 0;
  return ((usage.input_tokens || 0) * p.in + write * p.in * WRITE_1H + read * p.read + (usage.output_tokens || 0) * p.out) / 1e6;
}

// One seat call. `prefix` is the shared cached text (rules digest, cast, prep); `instructions` is the seat's own;
// `user` is the fresh tail. `schema` makes the reply JSON. Returns { json, text, usage, cost, stop }.
export async function callSeat(client, { model, effort, prefix, instructions, user, schema, maxTokens = 4000 }) {
  const system = [];
  if (prefix) system.push({ type: 'text', text: prefix, cache_control: { type: 'ephemeral', ttl: '1h' } });
  system.push({ type: 'text', text: instructions });
  const output_config = { effort };
  if (schema) output_config.format = { type: 'json_schema', schema };
  const res = await client.messages.create({
    model, max_tokens: maxTokens, system, output_config,
    messages: [{ role: 'user', content: user }],
  });
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let json = null;
  if (schema && text) { try { json = JSON.parse(text); } catch { json = null; } }
  return { json, text, usage: res.usage, cost: costOf(model, res.usage), stop: res.stop_reason };
}

// Free: how many tokens would this prompt be. Uses the same shape as callSeat.
export async function countTokens(client, { model, prefix, instructions = '', user }) {
  const system = [];
  if (prefix) system.push({ type: 'text', text: prefix });
  if (instructions) system.push({ type: 'text', text: instructions });
  const r = await client.messages.countTokens({ model, system, messages: [{ role: 'user', content: user }] });
  return r.input_tokens;
}
