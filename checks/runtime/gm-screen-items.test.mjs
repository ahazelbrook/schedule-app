// The Screen (Phase 3): the portrait, prop and wire seats, the case board, the hidden-NPC save, the ladder cut-offs and the gatekeeper's
// fail-closed paths for Screen items, on an in-memory D1 with a FAKE Anthropic client. No network and no key. Every name, document and
// sentence is invented.
//   node checks/runtime/gm-screen-items.test.mjs
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { cleanLines, addLines } from '../../functions/_lib/stt.js';
import { SEATS, WAKES } from '../../functions/_lib/assist/seats.js';
import { canRun, budgetTier, tierAllows, CORE_SEATS, DROPPED_WHEN_REDUCED } from '../../functions/_lib/assist/conductor.js';
import { toPortrait, toProp, toWire, buildBoard, cleanName, cleanAsk, cleanVocab, vocabText, VOCAB_KEYS } from '../../functions/_lib/assist/screen.js';
import { PROP_MAX, WIRE_MAX, BOARD_MAX, VOCAB_MAX, ITEM_MAX } from '../../functions/_lib/assist/prompts.js';
import { cleanAmbientPatch } from '../../functions/_lib/gm.js';
import { makeHandler, onRequest as realHandler, cleanScreenBody } from '../../functions/api/gm/assist.js';
import { matchApi } from '../../worker/app.js';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const K = require(path.join(ROOT, 'app', 'figures', 'figure-kit.js'));
const N = require(path.join(ROOT, 'app', 'gm', 'npc.js'));
let failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

// ---------- the seats ----------
await test('seats: portrait Sonnet 5.5 medium, prop Opus 5.5 medium with 8k, wire Sonnet 5.5 low; generic; no flag wakes them', () => {
  assert.deepEqual([SEATS.portrait.model, SEATS.portrait.effort], ['claude-sonnet-5-5', 'medium']);
  assert.deepEqual([SEATS.prop.model, SEATS.prop.effort, SEATS.prop.maxTokens], ['claude-opus-5-5', 'medium', 8000]);
  assert.deepEqual([SEATS.wire.model, SEATS.wire.effort], ['claude-sonnet-5-5', 'low']);
  for (const s of ['portrait', 'prop', 'wire']) {
    assert.ok(SEATS[s].maxTokens >= 1500 && SEATS[s].schema.additionalProperties === false, s);
    assert.ok(!(s in WAKES) && !Object.values(WAKES).some((f) => f.includes(s)), s + ' is the GM\'s button only');
    assert.ok(!/Doskvol|Duskwall|Tailor|Brackley|Karla/.test(SEATS[s].instructions), s + ' is generic');
  }
  assert.deepEqual(SEATS.portrait.schema.required, ['name', 'description', 'spec_json']);
  assert.deepEqual(SEATS.prop.schema.required, ['title', 'text']);
  assert.deepEqual(SEATS.wire.schema.required, ['text']);
  assert.match(SEATS.prop.instructions, /1200 characters/);
});

await test('ladder: Wire stops at 60% (reduced), Portrait and Prop at 85% (core), the gatekeeper runs to the cap; at the cap nothing', () => {
  assert.ok(DROPPED_WHEN_REDUCED.includes('wire') && !DROPPED_WHEN_REDUCED.includes('portrait') && !DROPPED_WHEN_REDUCED.includes('prop'));
  assert.ok(!CORE_SEATS.includes('portrait') && !CORE_SEATS.includes('prop') && !CORE_SEATS.includes('wire') && CORE_SEATS.includes('gatekeeper'));
  const at = (spent) => ['portrait', 'prop', 'wire', 'gatekeeper'].map((s) => canRun(s, { now: 1, tier: budgetTier(spent, 20) }).ok);
  assert.deepEqual(at(0), [true, true, true, true]);
  assert.deepEqual(at(11.9), [true, true, true, true]);
  assert.deepEqual(at(12), [true, true, false, true], '60%: Wire stops');
  assert.deepEqual(at(16.9), [true, true, false, true]);
  assert.deepEqual(at(17), [false, false, false, true], '85%: Portrait and Prop stop');
  assert.deepEqual(at(20), [false, false, false, false], 'the cap: nothing');
  assert.equal(tierAllows('off', 'gatekeeper'), false);
});

// ---------- the plain-code side ----------
const SPEC = { heightIn: 70, shape: 'oval', skin: 'tan', age: 44, pose: { stance: 'easy', arms: { R: 'down', L: 'pocket' } }, head: { shape: 'oval' },
  face: { eyes: 'hooded', brows: 'straight', nose: 'straight', mouth: 'neutral', expression: 'cool' }, hair: { style: 'crew', color: 'cloth-black' },
  outfit: { base: { type: 'turtleneck', color: 'cloth-black' }, bottom: { type: 'trousers', color: 'cloth-charcoal' }, feet: { type: 'oxfords', color: 'cloth-black' } } };

await test('toPortrait: parses the spec string, strips the stamped fields, a typed name wins; junk is null', () => {
  const ok = toPortrait({ name: 'Heard Name', description: 'A tall person in dark clothes.', spec_json: JSON.stringify({ ...SPEC, id: 'x', name: 'y', plate: 'z', code: 'c' }) });
  assert.equal(ok.kind, 'portrait'); assert.equal(ok.name, 'Heard Name'); assert.deepEqual(ok.spec, SPEC);
  assert.equal(toPortrait({ name: 'Heard', description: '', spec_json: JSON.stringify(SPEC) }, 'Typed').name, 'Typed');
  for (const bad of [null, [], {}, { spec_json: 5 }, { spec_json: 'not json' }, { spec_json: '[]' }, { spec_json: '{}' }, { spec_json: '"x"' }, { spec_json: ' '.repeat(9000) + '{}' }]) assert.equal(toPortrait(bad), null, JSON.stringify(bad).slice(0, 40));
});

await test('toProp and toWire: inside the limits or null (a long document is refused, never cut)', () => {
  assert.deepEqual(toProp({ title: ' A memo ', text: 'Line one.\r\n\r\n\r\n\r\nLine two.' }), { kind: 'prop', title: 'A memo', text: 'Line one.\n\nLine two.' });
  assert.equal(toProp({ title: 't', text: 'x'.repeat(PROP_MAX) }).text.length, PROP_MAX);
  for (const bad of [null, {}, { title: 't' }, { title: 't', text: '' }, { title: 't', text: 'x'.repeat(PROP_MAX + 1) }, { text: 5 }]) assert.equal(toProp(bad), null);
  assert.deepEqual(toWire({ text: '  Ferries  delayed. ' }), { kind: 'wire', text: 'Ferries delayed.' });
  assert.equal(toWire({ text: 'x'.repeat(WIRE_MAX) }).text.length, WIRE_MAX);
  for (const bad of [null, {}, { text: '' }, { text: 'x'.repeat(WIRE_MAX + 1) }, { text: 4 }]) assert.equal(toWire(bad), null);
  assert.ok(PROP_MAX + 100 <= ITEM_MAX && BOARD_MAX + 20 <= ITEM_MAX, 'every item fits one gatekeeper check');
});

await test('buildBoard: known and theories as said aloud; the seat\'s own verdict on a theory and its who are left out; cut on a whole line', () => {
  const b = buildBoard(['The ledger was torn.', ' A second key exists. '], [{ who: 'Pat', theory: 'The clerk did it.', supported: 'no' }, { who: 'Sam', theory: 'It was the tram driver.', supported: 'yes' }]);
  assert.equal(b.kind, 'board'); assert.equal(b.title, 'Case board');
  assert.equal(b.text, 'WHAT WE KNOW\n- The ledger was torn.\n- A second key exists.\n\nWHO AND WHAT WE SUSPECT\n- The clerk did it.\n- It was the tram driver.');
  assert.ok(!/Pat|Sam|supported|yes|no\b/.test(b.text.replace(/\bno\b/g, '')), 'no who, no judgement');
  assert.equal(buildBoard([], []), null); assert.equal(buildBoard(undefined, 'x'), null); assert.equal(buildBoard([' '], [{ theory: ' ' }]), null);
  const many = buildBoard(Array.from({ length: 12 }, (_, i) => 'Fact number ' + i + ' ' + 'z'.repeat(150)), []);
  assert.ok(many.text.length <= BOARD_MAX && many.text.split('\n').every((l) => l.length <= 170), 'cut on a whole line');
  assert.equal(buildBoard(['x'], []).text, 'WHAT WE KNOW\n- x');
});

await test('cleanName, cleanAsk, cleanVocab', () => {
  assert.equal(cleanName(undefined), ''); assert.equal(cleanName('  A   B '), 'A B'); assert.equal(cleanName('x'.repeat(81)), null); assert.equal(cleanName(5), null);
  assert.equal(cleanAsk('a telegram'), 'a telegram'); assert.equal(cleanAsk('x'.repeat(201)), null);
  assert.equal(cleanVocab(''), null); assert.equal(cleanVocab(5), null); assert.equal(cleanVocab('x'.repeat(VOCAB_MAX + 1)), null); assert.equal(cleanVocab('eyes: a, b'), 'eyes: a, b');
});

await test('the kit side: cleanSpec drops names the kit does not know and stamps the figure; a good spec renders with no warnings', () => {
  const r = N.cleanSpec({ ...SPEC, face: { ...SPEC.face, eyewear: { type: 'monocle-of-doom' } }, hair: { style: 'crew', color: 'cloth-black', hat: { type: 'nope' } } }, { K, name: 'Test Person' });
  assert.equal(r.ok, true); assert.deepEqual(r.warnings, []);
  assert.ok(r.notes.some((n) => /eyewear/.test(n)) && r.notes.some((n) => /hat/.test(n)), r.notes.join('|'));
  assert.equal(r.spec.name, 'Test Person'); assert.match(r.spec.id, /^npc-test-person$/);
  assert.equal(K.portrait(r.spec, { lod: 'lo' }).warnings.length, 0);
  assert.equal(N.cleanSpec(null, { K, name: 'x' }).ok, false);
});

await test('the vocabulary the page sends fits the limit and names real kit values', () => {
  const O = K.options(), names = (v) => (Array.isArray(v) ? v : Object.keys(v));
  const text = ['shapes', 'skins', 'armPoses', 'head', 'eyes', 'brows', 'nose', 'mouth', 'expression', 'ears', 'facialHair', 'eyewear', 'hair', 'hat', 'top', 'mid', 'outer', 'neckwear', 'bottom', 'dress', 'legwear', 'footwear', 'belt', 'gloves', 'prop', 'cloth'].map((k) => k + ': ' + names(O[k]).join(', ')).join('\n');
  assert.ok(text.length < VOCAB_MAX - 800, 'room to spare: ' + text.length);
});

await test('the page and the replay script build the same vocabulary: VOCAB_KEYS in gm-page.js equals the one in screen.js, and the text fits', async () => {
  const fs = await import('node:fs');
  const page = fs.readFileSync(path.join(ROOT, 'app', 'gm-page.js'), 'utf8');
  const start = page.indexOf('var VOCAB_KEYS = '), end = page.indexOf(']];', start);
  assert.ok(start > 0 && end > start, 'VOCAB_KEYS is in the page');
  assert.deepEqual(new Function('return ' + page.slice(start + 'var VOCAB_KEYS = '.length, end + 2))(), VOCAB_KEYS);
  const text = vocabText(K.options());
  assert.ok(text.length > 500 && text.length < VOCAB_MAX - 800, 'the vocabulary fits with room to spare: ' + text.length);
  assert.match(text, /^shape: /); assert.match(text, /cloth-black/); assert.equal(cleanVocab(text), text);
  assert.equal(vocabText(null), '');
});

// ---------- the ambient wire ----------
await test('PATCH ambient wire: up to six { id, text } bulletins, null clears, bad shapes are 400, too many 413', () => {
  assert.deepEqual(cleanAmbientPatch({ wire: [{ id: 'a', text: ' Ferries  late. ' }] }), { wire: [{ id: 'a', text: 'Ferries late.' }] });
  assert.deepEqual(cleanAmbientPatch({ wire: null }), { wire: null });
  assert.deepEqual(cleanAmbientPatch({ wire: [] }), { wire: null }, 'an empty list clears');
  for (const bad of ['x', {}, [1], [{ id: 'a' }], [{ text: 'x' }], [{ id: 'a', text: ' ' }], [{ id: 'a', text: 'x' }, { id: 'a', text: 'y' }]]) assert.throws(() => cleanAmbientPatch({ wire: bad }), (e) => e.status === 400, JSON.stringify(bad));
  assert.throws(() => cleanAmbientPatch({ wire: [{ id: 'a', text: 'x'.repeat(WIRE_MAX + 1) }] }), (e) => e.status === 413);
  assert.throws(() => cleanAmbientPatch({ wire: Array.from({ length: 7 }, (_, i) => ({ id: 'i' + i, text: 'x' })) }), (e) => e.status === 413);
  assert.equal(cleanAmbientPatch({ wire: Array.from({ length: 6 }, (_, i) => ({ id: 'i' + i, text: 'x' })) }).wire.length, 6);
});

// ---------- the endpoints ----------
const GM = { role: 'gm', id: 'gm@example.test' };
const clock = { t: Date.parse('2030-03-03T09:30:00.000Z') };
const FID = 'file_011TESTSCREEN';
const VOCAB = 'eyes: hooded, round\nbrows: straight\ncloth: cloth-black';
const REPLY = {
  portrait: { name: 'Heard Name', description: 'A tall person in dark clothes.', spec_json: JSON.stringify(SPEC) },
  prop: { title: 'Telegram', text: 'TELEGRAM\nMEET AT THE FERRY STOP\nNO NAMES' },
  wire: { text: 'Ferry timetable cut for the long weekend.' },
  gatekeeper: { verdict: 'pass', reasons: [], revealed: [], rule: [], cites_bad: [] },
};
function fakeClient(state) {
  return {
    messages: {
      async create(req) {
        const content = req.messages[0].content, texts = content.filter((b) => b.type === 'text').map((b) => b.text);
        const call = { model: req.model, max: req.max_tokens, effort: req.output_config.effort, schema: req.output_config.format && req.output_config.format.schema, doc: content.find((b) => b.type === 'document'), ins: texts[0], user: texts[texts.length - 1] };
        state.calls.push(call);
        if (state.gate) await state.gate;
        clock.t += state.ms || 0;
        if (state.err) throw state.err;
        const seat = Object.keys(SEATS).find((k) => SEATS[k].instructions === call.ins);
        const raw = state.raw !== undefined ? state.raw : JSON.stringify(state.reply && state.reply[seat] !== undefined ? state.reply[seat] : REPLY[seat]);
        return { content: [{ type: 'text', text: raw }], usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 10000, cache_creation_input_tokens: 0 }, stop_reason: state.stop || 'end_turn' };
      },
    },
  };
}
async function setup({ part = { file_id: FID, hash: 'h' }, env = {} } = {}) {
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec);
  const state = { calls: [], reply: null };
  if (part) exec.db.prepare("INSERT INTO gm_pack (campaign, part, version, src, updated_at, body) VALUES ('c', 'assist', 'v', '{}', 0, ?)").run(JSON.stringify(part));
  const e = { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'sk-ant-test-0000', ...env };
  const handler = makeHandler({ clientFor: () => fakeClient(state), now: () => clock.t });
  const post = (action, b, data = { me: GM }, raw) => handler({ request: new Request('https://blades.example.test/api/gm/assist/' + action, { method: 'POST', body: raw !== undefined ? raw : JSON.stringify(b === undefined ? {} : b), headers: { 'Content-Type': 'application/json' } }), env: e, data });
  const rows = () => exec.db.prepare('SELECT * FROM gm_assist_log ORDER BY id').all().map((r) => ({ ...r }));
  const spend = (dollars) => exec.db.prepare("INSERT INTO gm_assist_log (campaign, at, session, seat, model, effort, input_tokens, output_tokens, cache_read, cache_write, cents, flags, card) VALUES ('c', ?, '', 'ref', 'm', 'low', 0, 0, 0, 0, ?, '', NULL)").run(new Date(clock.t - 60_000).toISOString(), dollars * 100);
  const talk = (n = 3) => addLines(db, 'c', cleanLines({ lines: Array.from({ length: n }, (_, i) => ({ id: 'l' + Math.random().toString(36).slice(2, 10) + i, at: new Date(clock.t - 30_000 + i).toISOString(), session: '3', conn: 'x', speaker: 0, text: 'the man in the grey coat wears a scarf ' + i })) }));
  return { exec, db, state, post, rows, handler, env: e, spend, talk };
}
const body = async (res) => JSON.parse(await res.text());
const card = (r) => JSON.parse(r.card);

await test('router: the Screen endpoints reach the handler', () => {
  for (const a of ['portrait', 'prop', 'wire', 'board', 'portrait-add']) for (const p of ['/api/gm/assist/' + a, '/api/gm/assist/' + a + '/']) assert.equal(matchApi(p).handler, realHandler, p);
});

await test('GM only: a player or the display gets 403 on every Screen endpoint before the body, the database or the key', async () => {
  for (const a of ['portrait', 'prop', 'wire', 'board', 'portrait-add']) {
    const touched = [];
    const request = { method: 'POST', url: 'https://blades.example.test/api/gm/assist/' + a, headers: new Headers(), json() { touched.push('json'); throw new Error('read'); }, text() { touched.push('text'); throw new Error('read'); }, arrayBuffer() { touched.push('ab'); throw new Error('read'); }, get body() { touched.push('body'); return null; } };
    const env = { get DB() { touched.push('DB'); return undefined; }, get ANTHROPIC_API_KEY() { touched.push('key'); return 'k'; }, CAMPAIGN: 'x' };
    for (const me of [{ role: 'player', id: 'p@example.test' }, { role: 'display', id: 'd@example.test' }, undefined]) {
      let err = null;
      try { await makeHandler()({ request, env, data: { me } }); } catch (e) { err = e; }
      assert.ok(err && err.status === 403, a);
    }
    assert.deepEqual(touched, [], a);
  }
});

await test('portrait: Sonnet medium, the prefix by file id, the vocabulary and the typed name in the turn, the last five minutes of talk; the item carries the spec', async () => {
  const s = await setup(); await s.talk();
  const res = await s.post('portrait', { name: 'Typed Name', vocab: VOCAB });
  assert.equal(res.status, 200);
  const out = await body(res);
  assert.equal(out.item.kind, 'portrait'); assert.equal(out.item.name, 'Typed Name'); assert.deepEqual(out.item.spec, SPEC); assert.ok(out.item.at);
  const c = s.state.calls[0];
  assert.equal(c.model, 'claude-sonnet-5-5'); assert.equal(c.effort, 'medium'); assert.equal(c.max, SEATS.portrait.maxTokens);
  assert.deepEqual(c.doc.source, { type: 'file', file_id: FID });
  assert.equal(c.ins, SEATS.portrait.instructions); assert.deepEqual(c.schema, SEATS.portrait.schema);
  assert.match(c.user, /Typed Name/); assert.match(c.user, /eyes: hooded/); assert.match(c.user, /grey coat wears a scarf/); assert.match(c.user, /Last 5 minutes/);
  const r = s.rows().pop();
  assert.equal(r.seat, 'portrait'); assert.equal(r.model, 'claude-sonnet-5-5'); assert.equal(card(r).stop, 'end_turn'); assert.equal(typeof card(r).secs, 'number'); assert.equal(card(r).shown, 0);
  assert.ok(Math.abs(out.spend.tick - 0.006) < 1e-9, JSON.stringify(out.spend));
  const none = await body(await (await setup()).post('portrait', { vocab: VOCAB }));
  assert.equal(none.item.name, 'Heard Name', 'with no typed name the seat\'s own is used');
});

await test('prop: Opus medium with 8000 tokens, the ask in the turn; the item is a typed text document inside the limits', async () => {
  const s = await setup(); await s.talk();
  const out = await body(await s.post('prop', { ask: 'a ferry telegram' }));
  assert.deepEqual([out.item.kind, out.item.title, out.item.text], ['prop', 'Telegram', REPLY.prop.text]);
  const c = s.state.calls[0];
  assert.deepEqual([c.model, c.effort, c.max], ['claude-opus-5-5', 'medium', 8000]);
  assert.match(c.user, /The GM asks for: a ferry telegram/); assert.match(c.user, /grey coat/);
  assert.match((await (async () => { const t = await setup(); await t.post('prop', {}); return t.state.calls[0].user; })()), /^Make the prop that fits this moment\./);
  assert.equal(s.rows().pop().seat, 'prop');
});

await test('wire: Sonnet low, one bulletin', async () => {
  const s = await setup(); await s.talk();
  const out = await body(await s.post('wire', {}));
  assert.deepEqual(out.item, { kind: 'wire', text: REPLY.wire.text, at: out.item.at });
  assert.deepEqual([s.state.calls[0].model, s.state.calls[0].effort], ['claude-sonnet-5-5', 'low']);
  assert.equal((await body(await s.post('wire'))).item.kind, 'wire', 'an empty body is fine');
});

await test('validation: a bad body is a 400 and never reaches the database, the key or the model', async () => {
  const s = await setup({ env: { ANTHROPIC_API_KEY: '' } });
  for (const [a, b] of [['portrait', {}], ['portrait', { vocab: '' }], ['portrait', { vocab: 5 }], ['portrait', { vocab: VOCAB, name: 'x'.repeat(81) }], ['portrait', { vocab: 'x'.repeat(VOCAB_MAX + 1) }],
    ['prop', { ask: 'x'.repeat(201) }], ['prop', { ask: 5 }], ['portrait-add', {}], ['portrait-add', { name: 'A' }], ['portrait-add', { name: 'A', spec: [] }], ['portrait-add', { name: '  ', spec: {} }], ['portrait-add', { name: 'A', spec: {}, description: 5 }]]) {
    await assert.rejects(s.post(a, b), (e) => e.status === 400, a + ' ' + JSON.stringify(b).slice(0, 50));
  }
  await assert.rejects(s.post('prop', null, { me: GM }, '[1]'), (e) => e.status === 400);
  const real = makeHandler({ now: () => clock.t });          // the real client factory: no key is a 503, but only for a valid body
  await assert.rejects(real({ request: new Request('https://blades.example.test/api/gm/assist/wire', { method: 'POST', body: '{}' }), env: s.env, data: { me: GM } }), (e) => e.status === 503, 'a valid body with no key');
  assert.equal(s.state.calls.length, 0); assert.equal(s.rows().length, 0);
  assert.throws(() => cleanScreenBody('portrait', { vocab: VOCAB, name: 5 }), (e) => e.status === 400);
});

await test('ladder at the endpoints: Wire 429 from 60%, Portrait and Prop 429 from 85%, all 429 at the cap, no call made', async () => {
  const run = async (spent) => {
    const s = await setup({ env: { ASSIST_CAP_USD: '10' } }); if (spent) s.spend(spent);
    const code = async (a, b) => { try { const r = await s.post(a, b); return r.status; } catch (e) { return e.status + ' ' + e.message; } };
    return { s, wire: await code('wire', {}), prop: await code('prop', {}), portrait: await code('portrait', { vocab: VOCAB }) };
  };
  let r = await run(5.9); assert.deepEqual([r.wire, r.prop, r.portrait], [200, 200, 200]);
  r = await run(6); assert.match(String(r.wire), /^429 /); assert.equal(r.prop, 200); assert.equal(r.portrait, 200); assert.equal(r.s.state.calls.length, 2);
  r = await run(8.4); assert.match(String(r.wire), /^429 /); assert.equal(r.prop, 200);
  r = await run(8.5); assert.match(String(r.wire), /^429 /); assert.match(String(r.prop), /^429 /); assert.match(String(r.portrait), /^429 /); assert.equal(r.s.state.calls.length, 0);
  assert.match(String(r.prop), /budget/, 'a ladder cut-off is not worded as the cap');
  r = await run(10); assert.match(String(r.wire), /cap/); assert.match(String(r.portrait), /cap/); assert.equal(r.s.state.calls.length, 0);
});

await test('the Case board always runs: at 90% and at the cap, with no key and no model', async () => {
  const s = await setup({ env: { ASSIST_CAP_USD: '10', ANTHROPIC_API_KEY: '' } }); s.spend(10);
  const none = await s.post('board', {});
  assert.deepEqual(await body(none), { item: null }, 'nothing reported yet');
  s.exec.db.prepare("INSERT INTO gm_assist_log (campaign, at, session, seat, model, effort, input_tokens, output_tokens, cache_read, cache_write, cents, flags, card) VALUES ('c', ?, '', 'mystery', 'm', 'medium', 0, 0, 0, 0, 0, '', ?)")
    .run(new Date(clock.t - 120_000).toISOString(), JSON.stringify({ out: { known: ['The ledger was torn.'], theories: [{ who: 'Pat', theory: 'The clerk did it.', supported: 'yes' }], push_next: 'SECRET NEXT CLUE', must_land_item: '#3', how: 'private' } }));
  const out = await body(await s.post('board', {}));
  assert.equal(out.item.kind, 'board'); assert.equal(out.item.text, 'WHAT WE KNOW\n- The ledger was torn.\n\nWHO AND WHAT WE SUSPECT\n- The clerk did it.');
  assert.ok(!/SECRET|private|#3|Pat|yes/.test(JSON.stringify(out)), 'only what was said aloud');
  assert.equal(s.state.calls.length, 0);
  // the latest row wins
  s.exec.db.prepare("INSERT INTO gm_assist_log (campaign, at, session, seat, model, effort, input_tokens, output_tokens, cache_read, cache_write, cents, flags, card) VALUES ('c', ?, '', 'mystery', 'm', 'medium', 0, 0, 0, 0, 0, '', ?)")
    .run(new Date(clock.t - 60_000).toISOString(), JSON.stringify({ out: { known: ['Newer fact.'], theories: [] } }));
  assert.equal((await body(await s.post('board', {}))).item.text, 'WHAT WE KNOW\n- Newer fact.');
});

await test('a refusal, a cut-off, no JSON and an unusable item are logged with their stop reason and show nothing', async () => {
  for (const [state, stop] of [[{ stop: 'refusal', reply: { wire: { text: 'fine' } } }, 'refusal'], [{ stop: 'max_tokens', reply: { wire: { text: 'fine' } } }, 'max_tokens'], [{ raw: 'not json' }, 'end_turn'], [{ reply: { wire: { text: 'x'.repeat(WIRE_MAX + 1) } } }, 'end_turn']]) {
    const s = await setup(); Object.assign(s.state, state);
    const out = await body(await s.post('wire', {}));
    assert.equal(out.item, null, JSON.stringify(state).slice(0, 40));
    const c = card(s.rows().pop());
    assert.equal(c.stop, stop); assert.equal(typeof c.secs, 'number'); assert.equal(c.shown, 0);
    if (stop === 'refusal') assert.equal(c.refusal, 1);
  }
  const big = await setup(); big.state.reply = { prop: { title: 'T', text: 'x'.repeat(PROP_MAX + 1) } };
  assert.equal((await body(await big.post('prop', {}))).item, null, 'a prop over the limit is refused, not cut');
});

await test('busy: a second Screen call while one is in flight is a 429 and makes no call; a failed call is a short status, not the provider\'s words', async () => {
  const s = await setup();
  let release; s.state.gate = new Promise((r) => { release = r; });
  const first = s.post('prop', {});
  await new Promise((r) => setTimeout(r, 20));
  await assert.rejects(s.post('prop', {}), (e) => e.status === 429 && /busy/.test(e.message));
  assert.equal(s.state.calls.length, 1);
  release(); await first;
  const t = await setup(); t.state.err = Object.assign(new Error('secret provider text sk-ant-xyz'), { status: 500 });
  const out = await body(await t.post('wire', {}));
  assert.equal(out.item, null); assert.deepEqual(out.errors, [{ seat: 'wire', error: 'provider status 500' }]);
  assert.ok(!/secret|sk-ant/.test(JSON.stringify(out)));
});

await test('no assist part, or the old text form: no item and a warning, no model call', async () => {
  const s = await setup({ part: null });
  assert.deepEqual((await body(await s.post('wire', {}))).warnings, ['no assist part in the GM pack']);
  const l = await setup({ part: { prefix: 'old text' } });
  assert.deepEqual((await body(await l.post('prop', {}))).warnings, ['re-push the assist part']);
  assert.equal(s.state.calls.length + l.state.calls.length, 0);
});

// ---------- the hidden NPC ----------
await test('portrait-add: saves a HIDDEN NPC through checkNpc/writeNpc, whatever is sent; no key, no model, no spend', async () => {
  const s = await setup({ env: { ANTHROPIC_API_KEY: '', ASSIST_CAP_USD: '1' } }); s.spend(1);
  const res = await s.post('portrait-add', { name: 'Test Person', description: 'A tall person in dark clothes.', spec: SPEC, revealed: true, tags: ['x'], gmNotes: 'sneaky', firstSeen: '2030-01-01T00:00:00Z' });
  assert.equal(res.status, 200);
  const out = await body(res);
  assert.match(out.id, /^npc_[a-z0-9]+$/);
  assert.equal(out.doc.revealed, false); assert.equal(out.doc.name, 'Test Person'); assert.deepEqual(out.doc.spec, SPEC);
  assert.equal(out.doc.gmNotes, ''); assert.equal(out.doc.firstSeen, null); assert.deepEqual(out.doc.tags, ['screen']);
  const row = s.exec.db.prepare('SELECT * FROM npcs WHERE id = ?').get(out.id);
  assert.equal(row.campaign, 'c'); assert.equal(row.deleted, 0);
  const stored = JSON.parse(row.doc);
  assert.equal(stored.revealed, false); assert.equal(stored.name, 'Test Person'); assert.equal(stored.description, 'A tall person in dark clothes.');
  assert.equal(s.state.calls.length, 0);
  // a player-facing read of the NPC list sees nothing
  const { listNpcs } = await import('../../functions/_lib/npcs.js');
    const seeded = (await listNpcs(s.db, 'c', GM)).filter((x) => x.id !== out.id).length;
  assert.ok(!(await listNpcs(s.db, 'c', { role: 'player' })).some((x) => x.id === out.id), 'a player does not see it');
  assert.equal((await listNpcs(s.db, 'c', GM)).length, seeded + 1);
});

await test('portrait-add: an oversize spec is refused by checkNpc (413) and nothing is written', async () => {
  const s = await setup();
  const before = s.exec.db.prepare('SELECT COUNT(*) AS n FROM npcs').get().n;
  await assert.rejects(s.post('portrait-add', { name: 'Big', spec: { notes: 'x'.repeat(40 * 1024) } }), (e) => e.status === 413 || e.status === 400);
  assert.equal(s.exec.db.prepare('SELECT COUNT(*) AS n FROM npcs').get().n, before);
});

// ---------- the gatekeeper on Screen items: fail closed ----------
await test('gatekeeper for each Screen kind: pass, block with reasons, and every failure is a block marked unknown', async () => {
  for (const kind of ['portrait', 'prop', 'wire', 'board']) {
    const s = await setup();
    s.state.reply = { gatekeeper: REPLY.gatekeeper };
    const pass = await body(await s.post('gatekeeper', { kind, text: 'Something plain.' }));
    assert.deepEqual([pass.verdict, pass.unknown], ['pass', false], kind);
    s.state.reply = { gatekeeper: { verdict: 'block', reasons: ['too specific'], revealed: ['#2 The buyer'], rule: [], cites_bad: [] } };
    const blocked = await body(await s.post('gatekeeper', { kind, text: 'Something plain.' }));
    assert.deepEqual([blocked.verdict, blocked.unknown, blocked.reasons, blocked.revealed], ['block', false, ['too specific'], ['#2 The buyer']], kind);
  }
  for (const [name, st] of [['error', { err: Object.assign(new Error('x'), { status: 500 }) }], ['refusal', { stop: 'refusal' }], ['cut off', { stop: 'max_tokens' }], ['no json', { raw: 'nope' }]]) {
    const s = await setup(); s.state.reply = { gatekeeper: REPLY.gatekeeper }; Object.assign(s.state, st);
    const out = await body(await s.post('gatekeeper', { kind: 'prop', text: 'A memo.' }));
    assert.deepEqual([out.verdict, out.unknown], ['block', true], name);
  }
  const none = await setup({ part: null });
  const out = await body(await none.post('gatekeeper', { kind: 'wire', text: 'x' }));
  assert.deepEqual([out.verdict, out.unknown], ['block', true], 'no prefix means nothing to check against');
});

await test('the gatekeeper runs to the cap even when Portrait, Prop and Wire have been dropped; at the cap it is a 429 (the page shows "not checked")', async () => {
  const s = await setup({ env: { ASSIST_CAP_USD: '10' } }); s.spend(9.5);
  await assert.rejects(s.post('prop', {}), (e) => e.status === 429);
  assert.equal((await s.post('gatekeeper', { kind: 'prop', text: 'A memo.' })).status, 200);
  const t = await setup({ env: { ASSIST_CAP_USD: '10' } }); t.spend(10);
  await assert.rejects(t.post('gatekeeper', { kind: 'prop', text: 'A memo.' }), (e) => e.status === 429 && /cap/.test(e.message));
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
