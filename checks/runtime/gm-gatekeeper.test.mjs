// The gatekeeper seat (the "Screen" phase of Claude at the table): the plain-code side (item validation, fail-closed verdicts, Ref cite
// helpers), the seat's registry entry, and POST /api/gm/assist/gatekeeper on an in-memory D1 with a FAKE Anthropic client.
// No network and no key. Every name and sentence is invented.
//   node checks/runtime/gm-gatekeeper.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { cleanItem, verdictOf, unknownVerdict, extractCites, refCardItem } from '../../functions/_lib/assist/gatekeeper.js';
import { ITEM_KINDS, ITEM_MAX, CITES_MAX, CITE_MAX, gatekeeperUser } from '../../functions/_lib/assist/prompts.js';
import { SEATS, WAKES } from '../../functions/_lib/assist/seats.js';
import { canRun, budgetTier, CORE_SEATS } from '../../functions/_lib/assist/conductor.js';
import { makeHandler, onRequest as realHandler } from '../../functions/api/gm/assist.js';
import { matchApi } from '../../worker/app.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

// ---------- the seat ----------
await test('seat: Sonnet 5.5 at low effort, a generic instruction, the schema the endpoint relies on, woken by no flag', () => {
  const g = SEATS.gatekeeper;
  assert.equal(g.model, 'claude-sonnet-5-5'); assert.equal(g.effort, 'low');
  assert.deepEqual(g.schema.required, ['verdict', 'reasons', 'revealed', 'rule', 'cites_bad']);
  assert.deepEqual(g.schema.properties.verdict.enum, ['pass', 'block']);
  for (const k of ['reasons', 'revealed', 'rule', 'cites_bad']) assert.equal(g.schema.properties[k].type, 'array', k);
  assert.equal(g.schema.additionalProperties, false);
  assert.ok(!Object.values(WAKES).some((f) => f.includes('gatekeeper')) && !('gatekeeper' in WAKES), 'only the endpoint calls it');
  assert.match(g.instructions, /never-reveal/);
  assert.ok(!/\b[A-Z][a-z]+ [A-Z][a-z]+\b.*\b(Doskvol|Duskwall)\b/.test(g.instructions), 'generic');
});

await test('ladder: the gatekeeper is a Core seat, so it runs to the cap like Ref, and not at the cap', () => {
  assert.ok(CORE_SEATS.includes('gatekeeper'));
  for (const tier of ['all', 'reduced', 'core']) assert.equal(canRun('gatekeeper', { now: 1, tier }).ok, true, tier);
  assert.equal(canRun('gatekeeper', { now: 1, tier: 'off' }).why, 'budget');
  assert.equal(canRun('gatekeeper', { now: 1, tier: 'all', inFlight: new Set(['gatekeeper']) }).why, 'in-flight');
  assert.equal(budgetTier(19, 20), 'core');
});

// ---------- validation ----------
await test('cleanItem: kinds, text length, cites; trims and normalises', () => {
  for (const kind of ITEM_KINDS) assert.equal(cleanItem({ kind, text: 'A note.' }).ok, true, kind);
  assert.deepEqual(cleanItem({ kind: 'prop', text: '  A  note\r\n\r\n\r\n\r\nhere.  ' }), { ok: true, item: { kind: 'prop', text: 'A note\n\nhere.', cites: [] } });
  assert.equal(cleanItem({ kind: 'prop', text: 'a'.repeat(ITEM_MAX) }).ok, true);
  for (const bad of [null, [], 'x', {}, { text: 'x' }, { kind: 'poster', text: 'x' }, { kind: 'prop' }, { kind: 'prop', text: '' }, { kind: 'prop', text: '   ' }, { kind: 'prop', text: 5 },
    { kind: 'prop', text: 'a'.repeat(ITEM_MAX + 1) }, { kind: 'prop', text: 'x', cites: 'p.1' }, { kind: 'prop', text: 'x', cites: [1] },
    { kind: 'prop', text: 'x', cites: Array(CITES_MAX + 1).fill('p.1') }, { kind: 'prop', text: 'x', cites: ['p'.repeat(CITE_MAX + 1)] }]) {
    assert.equal(cleanItem(bad).ok, false, JSON.stringify(bad).slice(0, 60));
  }
  assert.deepEqual(cleanItem({ kind: 'card', text: 'x', cites: ['p.9', ' ', ' p. 12 '] }).item.cites, ['p.9', 'p. 12']);
  assert.equal(cleanItem({ kind: 'card', text: 'x', cites: null }).ok, true);
});

// ---------- the verdict fails closed ----------
await test('verdictOf: pass stays a pass; anything unknown is a block marked unknown', () => {
  const ok = { verdict: 'pass', reasons: [], revealed: [], rule: [], cites_bad: [] };
  assert.deepEqual(verdictOf(ok, 'end_turn'), { ...ok, unknown: false });
  assert.equal(verdictOf(ok, '').verdict, 'pass');
  for (const [j, stop] of [[null, 'end_turn'], [undefined, ''], [ok, 'refusal'], [ok, 'max_tokens'], [{ ...ok, verdict: 'maybe' }, ''], [{}, ''], ['pass', ''], [{ reasons: ['x'] }, '']]) {
    const v = verdictOf(j, stop);
    assert.equal(v.verdict, 'block', JSON.stringify(j) + stop); assert.equal(v.unknown, true);
  }
  assert.deepEqual(unknownVerdict('why').reasons, ['why']);
});

await test('verdictOf: a "pass" that lists a leak or a rule problem is a block; a bad cite alone is still a pass; lists are clipped', () => {
  const p = { verdict: 'pass', reasons: [], revealed: [], rule: [], cites_bad: [] };
  assert.equal(verdictOf({ ...p, revealed: ['#2'] }).verdict, 'block');
  assert.equal(verdictOf({ ...p, rule: ['decides the roll'] }).verdict, 'block');
  const c = verdictOf({ ...p, cites_bad: ['p.999'] });
  assert.equal(c.verdict, 'pass'); assert.deepEqual(c.cites_bad, ['p.999']);
  const long = verdictOf({ ...p, verdict: 'block', reasons: Array(30).fill('r'.repeat(900)), revealed: [1, 'a', '', '  '] });
  assert.equal(long.reasons.length, 10); assert.equal(long.reasons[0].length, 300); assert.deepEqual(long.revealed, ['a']);
});

// ---------- Ref cites ----------
await test('extractCites and refCardItem: page cites only; a card with none is not worth a check', () => {
  assert.deepEqual(extractCites('See p.152, pp. 12-13 and page 9; p.152 again.'), ['p.152', 'pp. 12-13', 'page 9']);
  assert.deepEqual(extractCites('no pages here, version 2.0'), []);
  assert.equal(refCardItem({ text: 'Position was named after the roll', detail: { rule: 'Position first' } }), null);
  assert.equal(refCardItem(null), null);
  const item = refCardItem({ text: 'Position was named after the roll', detail: { said_at: '22:14', rule: 'Position comes before the roll (p.9)' } });
  assert.equal(item.kind, 'card'); assert.deepEqual(item.cites, ['p.9']); assert.match(item.text, /Rule: Position comes before/);
  assert.equal(cleanItem(item).ok, true, 'it is a valid gatekeeper item');
  assert.deepEqual(refCardItem({ card: 'Short', rule: 'x (p.4)' }).cites, ['p.4']);
});

await test('gatekeeperUser: kind, text and cites reach the turn; no cites, no cite section', () => {
  assert.match(gatekeeperUser({ kind: 'wire', text: 'Hello', cites: [] }), /^Item kind: wire\.\nItem text:\nHello\nCheck this item\.$/);
  assert.match(gatekeeperUser({ kind: 'card', text: 'Hi', cites: ['p.9'] }), /Page cites[^\n]*\n- p\.9\n/);
});

// ---------- the endpoint ----------
const GM = { role: 'gm', id: 'gm@example.test' };
const clock = { t: Date.parse('2030-03-03T09:30:00.000Z') };
const FID = 'file_011TESTGATEKEEPER';
const PASS = { verdict: 'pass', reasons: [], revealed: [], rule: [], cites_bad: [] };

function fakeClient(state) {
  return {
    messages: {
      async create(req) {
        const content = req.messages[0].content;
        const texts = content.filter((b) => b.type === 'text').map((b) => b.text);
        state.calls.push({ model: req.model, max: req.max_tokens, effort: req.output_config.effort, schema: req.output_config.format && req.output_config.format.schema, doc: content.find((b) => b.type === 'document'), ins: texts[0], user: texts[texts.length - 1] });
        if (state.gate) await state.gate;                     // hold the call open (the busy test)
        clock.t += state.ms || 0;
        if (state.err) throw state.err;
        return { content: [{ type: 'text', text: state.raw !== undefined ? state.raw : JSON.stringify(state.reply) }], usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0 }, stop_reason: state.stop || 'end_turn' };
      },
    },
  };
}
async function setup({ part = { file_id: FID, hash: 'h' }, env = {} } = {}) {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec);
  const state = { calls: [], reply: PASS };
  if (part) exec.db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'assist', 'v', '{}', 0, ?)").run(JSON.stringify(part));
  const e = { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'sk-ant-test-0000', ...env };
  const handler = makeHandler({ clientFor: () => fakeClient(state), now: () => clock.t });
  const post = (b, data = { me: GM }, raw) => handler({ request: new Request('https://blades.example.test/api/gm/assist/gatekeeper', { method: 'POST', body: raw !== undefined ? raw : JSON.stringify(b), headers: { 'Content-Type': 'application/json' } }), env: e, data });
  const rows = () => exec.db.prepare('SELECT * FROM gm_assist_log ORDER BY id').all().map((r) => ({ ...r }));
  return { exec, state, post, rows, handler, env: e };
}
const body = async (res) => JSON.parse(await res.text());
const ITEM = { kind: 'prop', text: 'A folded receipt from a baker.' };

await test('router: /api/gm/assist/gatekeeper reaches the handler', () => {
  for (const p of ['/api/gm/assist/gatekeeper', '/api/gm/assist/gatekeeper/']) assert.equal(matchApi(p).handler, realHandler, p);
});

await test('GM only: a player or the display gets 403 before the body, the database or the key', async () => {
  const touched = [];
  const request = { method: 'POST', url: 'https://blades.example.test/api/gm/assist/gatekeeper', headers: new Headers(), json() { touched.push('json'); throw new Error('read'); }, text() { touched.push('text'); throw new Error('read'); }, arrayBuffer() { touched.push('ab'); throw new Error('read'); } };
  const env = { get DB() { touched.push('DB'); return undefined; }, get ANTHROPIC_API_KEY() { touched.push('key'); return 'k'; }, CAMPAIGN: 'x' };
  for (const me of [{ role: 'player', id: 'p@example.test' }, { role: 'display', id: 'd@example.test' }, undefined]) {
    let err = null;
    try { await makeHandler()({ request, env, data: { me } }); } catch (e) { err = e; }
    assert.ok(err && err.status === 403);
  }
  assert.deepEqual(touched, []);
});

await test('a pass: the seat is called once with the item, the prefix by file id, Sonnet low; the answer carries the verdict and spend', async () => {
  const s = await setup();
  const res = await s.post({ ...ITEM, cites: ['p.9'] });
  assert.equal(res.status, 200);
  const out = await body(res);
  assert.equal(out.verdict, 'pass'); assert.equal(out.unknown, false);
  assert.deepEqual([out.reasons, out.revealed, out.rule, out.cites_bad], [[], [], [], []]);
  assert.equal(s.state.calls.length, 1);
  const c = s.state.calls[0];
  assert.equal(c.model, 'claude-sonnet-5-5'); assert.equal(c.effort, 'low'); assert.equal(c.max, SEATS.gatekeeper.maxTokens);
  assert.deepEqual(c.doc.source, { type: 'file', file_id: FID });
  assert.equal(c.ins, SEATS.gatekeeper.instructions);
  assert.match(c.user, /Item kind: prop\./); assert.match(c.user, /A folded receipt/); assert.match(c.user, /- p\.9/);
  assert.deepEqual(c.schema, SEATS.gatekeeper.schema);
  // sonnet: 1000*2 + 10000*0.2 + 200*10 = 6000 per million = $0.006
  assert.ok(Math.abs(out.spend.tick - 0.006) < 1e-9, JSON.stringify(out.spend));
});

await test('a block carries its reasons, revealed entries, rule problems and bad cites through', async () => {
  const s = await setup();
  s.state.reply = { verdict: 'block', reasons: ['names the buyer'], revealed: ['#2 The buyer'], rule: ['decides the roll'], cites_bad: ['p.999'] };
  const out = await body(await s.post({ ...ITEM, cites: ['p.999'] }));
  assert.deepEqual([out.verdict, out.unknown], ['block', false]);
  assert.deepEqual(out.reasons, ['names the buyer']); assert.deepEqual(out.revealed, ['#2 The buyer']);
  assert.deepEqual(out.rule, ['decides the roll']); assert.deepEqual(out.cites_bad, ['p.999']);
});

await test('validation: a bad body is a 400 and never reaches the database, the key or the model', async () => {
  const s = await setup({ env: { ANTHROPIC_API_KEY: '' } });          // with no key a valid body would be 503: a 400 proves validation came first
  const bads = [{}, { kind: 'prop' }, { text: 'x' }, { kind: 'poster', text: 'x' }, { kind: 'prop', text: 'a'.repeat(ITEM_MAX + 1) },
    { kind: 'prop', text: 'x', cites: Array(CITES_MAX + 1).fill('p.1') }, { kind: 'prop', text: 'x', cites: ['q'.repeat(CITE_MAX + 1)] }, { kind: 'prop', text: 'x', cites: 'p.1' }];
  for (const b of bads) await assert.rejects(s.post(b), (e) => e.status === 400, JSON.stringify(b).slice(0, 60));
  await assert.rejects(s.post(null, { me: GM }, '[1]'), (e) => e.status === 400);
  const real = makeHandler({ now: () => clock.t });          // the real client factory: no key is a 503, but only for a valid body
  const rawPost = (b) => real({ request: new Request('https://blades.example.test/api/gm/assist/gatekeeper', { method: 'POST', body: JSON.stringify(b) }), env: s.env, data: { me: GM } });
  await assert.rejects(rawPost({ kind: 'bad' }), (e) => e.status === 400);
  await assert.rejects(rawPost(ITEM), (e) => e.status === 503, 'a valid body with no key');
  assert.equal(s.state.calls.length, 0); assert.equal(s.rows().length, 0);
  const ok = await setup();
  assert.equal((await ok.post({ kind: 'prop', text: 'a'.repeat(ITEM_MAX) })).status, 200, 'the limit itself is allowed');
});

await test('GET is 405', async () => {
  const s = await setup();
  const res = await s.handler({ request: new Request('https://blades.example.test/api/gm/assist/gatekeeper'), env: s.env, data: { me: GM } });
  assert.equal(res.status, 405);
});

await test('cap: runs through the Core tier, stops at the cap with a 429 and no call', async () => {
  const at = async (cap, spent) => {
    const s = await setup({ env: { ASSIST_CAP_USD: String(cap) } });
    if (spent) s.exec.db.prepare("INSERT INTO gm_assist_log (campaign, at, session, seat, model, effort, input_tokens, output_tokens, cache_read, cache_write, cents, flags, card) VALUES ('c', ?, '', 'ref', 'm', 'low', 0, 0, 0, 0, ?, '', NULL)").run(new Date(clock.t - 60_000).toISOString(), spent * 100);
    return s;
  };
  let s = await at(10, 9.5);                                  // 95%: the Core tier, Ref's tier
  assert.equal((await s.post(ITEM)).status, 200);
  s = await at(10, 10);
  await assert.rejects(s.post(ITEM), (e) => e.status === 429 && /cap/.test(e.message));
  assert.equal(s.state.calls.length, 0);
  s = await at(0, 0);
  await assert.rejects(s.post(ITEM), (e) => e.status === 429, 'a cap of 0 is off');
});

await test('busy: a second check while one is in flight is a 429 and makes no second call; it frees up afterwards', async () => {
  const s = await setup();
  let release; s.state.gate = new Promise((r) => { release = r; });
  const first = s.post(ITEM);
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(s.post({ kind: 'wire', text: 'Another.' }), (e) => e.status === 429 && /busy/.test(e.message));
  assert.equal(s.state.calls.length, 1);
  release();
  assert.equal((await first).status, 200);
  s.state.gate = null;
  assert.equal((await s.post(ITEM)).status, 200, 'no cooldown once it has returned');
});

await test('logging: one row per check with seat, flags, tokens, cents, secs and stop; the verdict and kind in the card', async () => {
  const s = await setup();
  s.state.ms = 4200; s.state.reply = { verdict: 'block', reasons: ['r'], revealed: ['#1'], rule: [], cites_bad: [] };
  await s.post(ITEM);
  const rows = s.rows();
  assert.equal(rows.length, 1);
  const r = rows[0], card = JSON.parse(r.card);
  assert.equal(r.seat, 'gatekeeper'); assert.equal(r.model, 'claude-sonnet-5-5'); assert.equal(r.effort, 'low'); assert.equal(r.flags, 'gatekeeper');
  assert.equal(r.input_tokens, 1000); assert.equal(r.output_tokens, 200); assert.ok(Math.abs(r.cents - 0.6) < 1e-9, 'cents ' + r.cents);
  assert.equal(card.verdict, 'block'); assert.equal(card.kind, 'prop'); assert.equal(card.shown, 0); assert.equal(card.secs, 4.2); assert.equal(card.stop, 'end_turn');
  assert.deepEqual(card.out, s.state.reply);
  // the cap meter counts it
  const next = await body(await s.post(ITEM));
  assert.ok(Math.abs(next.spend.tonight - 0.012) < 1e-9, JSON.stringify(next.spend));
});

await test('unknown is a block: a refusal, a cut-off reply, no JSON or a verdict that is neither word shows nothing and is logged', async () => {
  const cases = [['refusal', { stop: 'refusal', reply: PASS }, 'refusal'], ['cut off', { stop: 'max_tokens', reply: PASS }, 'truncated'], ['not JSON', { raw: 'pass!' }, null], ['odd verdict', { reply: { ...PASS, verdict: 'ok' } }, null]];
  for (const [name, patch, flag] of cases) {
    const s = await setup();
    Object.assign(s.state, patch);
    const out = await body(await s.post(ITEM));
    assert.deepEqual([out.verdict, out.unknown], ['block', true], name);
    assert.deepEqual([out.revealed, out.rule, out.cites_bad], [[], [], []], name);
    const card = JSON.parse(s.rows()[0].card);
    assert.equal(card.shown, 0, name); assert.equal(card.unknown, 1, name);
    if (flag) assert.equal(card[flag], 1, name);
  }
});

await test('a provider failure is a block (unknown) with a short key-free error, and is logged', async () => {
  const s = await setup();
  s.state.err = Object.assign(new Error('boom sk-ant-test-0000 secret detail'), { status: 529 });
  const out = await body(await s.post(ITEM));
  assert.deepEqual([out.verdict, out.unknown], ['block', true]);
  assert.deepEqual(out.errors, [{ seat: 'gatekeeper', error: 'provider status 529' }]);
  assert.ok(!JSON.stringify(out).includes('sk-ant') && !JSON.stringify(out).includes('secret detail'));
  assert.equal(JSON.parse(s.rows()[0].card).error, 'provider status 529');
});

await test('no assist part, or an old one that carried the text: a block with no model call', async () => {
  for (const [part, warn] of [[null, 'no assist part in the GM pack'], [{ prefix: 'old text' }, 're-push the assist part'], [{ hash: 'h' }, 'no assist part in the GM pack']]) {
    const s = await setup({ part });
    const out = await body(await s.post(ITEM));
    assert.deepEqual([out.verdict, out.unknown], ['block', true]); assert.deepEqual(out.warnings, [warn]);
    assert.equal(s.state.calls.length, 0); assert.equal(s.rows().length, 0);
  }
});

await test('the file is gone at the provider: a block with a re-push warning, nothing logged', async () => {
  const s = await setup();
  s.state.err = Object.assign(new Error('File not found: file_011SECRETDETAIL'), { status: 404 });
  const out = await body(await s.post(ITEM));
  assert.deepEqual([out.verdict, out.unknown], ['block', true]); assert.deepEqual(out.warnings, ['re-push the assist part']);
  assert.ok(!JSON.stringify(out).includes('SECRETDETAIL'));
  assert.equal(s.rows().length, 0);
});

console.log(failed ? `\n${passed} passed, ${failed} FAILED` : `\nALL PASSED (${passed})`);
process.exit(failed ? 1 : 0);
