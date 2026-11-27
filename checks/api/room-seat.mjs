// room-seat (RK16 of the room key build, room.tables): the Blade tap that fits one rolled room, POST /api/gm/assist/room
// (functions/_lib/assist/room-seat.js, wired in functions/api/gm/assist.js). In process with the handler's injected fake `call` and client
// and an in-memory D1: no network, no Worker, no port, no key (nothing here reads B68_ANTHROPIC_KEY; env holds a placeholder the fake never uses).
// INVENTED data only: the Pelican Rooms, and GM-ONLY- markers in every field of the fake answers.
//   node checks/api/room-seat.mjs      (part of npm run check:api)
// Covers: a valid answer lands; a malformed one, an over-limit field and an unknown field are refused ({ room: null, error }, its row written);
// the request's unknown fields and limits (400, no call, no row); the cost cap (a call over 5¢ is refused before the call; the real seat's worst
// case for the largest legal body is under it; the row's cents are logged); room.tables off (409, no call); the night's cap (429); one at a time.
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { memoryExec, asD1 } from '../../scripts/lib/d1.mjs';
import { SEATS } from '../../functions/_lib/assist/seats.js';
import { makeHandler } from '../../functions/api/gm/assist.js';
import { makeLeases } from '../../functions/_lib/assist/leases.js';
import { ROOM_SEAT, ROOM_CAP_CENTS, ROOM_LABEL, IN, cleanRoomBody, roomUser, toRoom, worstCents, THING, TAGS as SEAT_TAGS } from '../../functions/_lib/assist/room-seat.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GM = { role: 'gm', id: 'gm@example.test' };
let t = Date.parse('2030-01-01T09:30:00.000Z'), failed = 0, passed = 0;
async function test(name, fn) { try { await fn(); passed++; console.log('PASS ' + name); } catch (e) { failed++; console.log('FAIL ' + name + ': ' + (e && e.stack || e)); } }

const BODY = {
  site: { name: 'The Pelican Rooms', theme: 'Nightclub', faction: 'The Dovetail Crew' },
  room: { name: 'Pelican bar', band: 'public', say: 'Smoke hangs under a low copper ceiling.', things: [{ name: 'A brass till', line: 'It rings on every sale.' }], people: ['bartender'] },
  tonight: { goal: 'Lift the ledger from the office', plan: 'In through the front as patrons', onStage: ['Mabel Quist'] },
};
const GOOD = {
  say: 'GM-ONLY-say: the band stops as you come in.',
  things: [
    { name: 'GM-ONLY-name velvet rope', line: 'GM-ONLY-line: it guards a side stair.', look: 'GM-ONLY-look: the hook is loose.', roll: 'GM-ONLY-roll 4/5: it drops. 6: silently.', danger: 'GM-ONLY-danger: the bouncer sees.', states: ['up', 'down'], tags: ['door'] },
    { name: 'GM-ONLY-name ice bucket', line: 'GM-ONLY-line: sweating on the bar.', look: '', roll: '', danger: '', states: [], tags: [] },
  ],
  people: [{ line: 'GM-ONLY-person: a cleaner counting tips', role: 'cleaner' }],
};
const USAGE = { input_tokens: 900, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const result = (json, extra = {}) => ({ json, text: JSON.stringify(json), usage: USAGE, cost: 0.0048, stop: 'end_turn', secs: 0.4, ...extra });

async function setup({ tables = true, cap } = {}) {
  t += 3_600_000;
  const exec = await memoryExec({ schemaFile: path.join(ROOT, 'schema.sql') });
  const db = asD1(exec);
  const env = { DB: db, CAMPAIGN: 'c', ANTHROPIC_API_KEY: 'sk-ant-test-0000', ...(cap !== undefined ? { ASSIST_CAP_USD: String(cap) } : {}) };
  const features = tables === 'unset' ? {} : { 'room.tables': tables };
  await db.prepare('INSERT INTO campaigns (id, updated_at, doc) VALUES (?1, ?2, ?3)').bind('c#gm', new Date(t).toISOString(), JSON.stringify({ features })).run();
  return { db, env };
}
function handlerFor(reply, o = {}) {
  const calls = [];
  const call = async (client, args) => { calls.push(args); if (o.wait) await o.wait; return typeof reply === 'function' ? reply(args) : reply; };
  const handler = makeHandler({ clientFor: () => ({ fake: true }), now: () => t, call, leases: o.leases || makeLeases(), ...(o.seats ? { seats: o.seats } : {}) });
  return { handler, calls };
}
async function post(handler, env, body, me = GM) {
  const res = await handler({ request: new Request('https://blades.example.test/api/gm/assist/room', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }), env, data: { me }, waitUntil() {} }).catch((e) => e);
  if (res instanceof Error) return { status: res.status || 500, out: { error: res.message } };
  return { status: res.status, out: JSON.parse(await res.text()) };
}
const rows = async (db) => (await db.prepare("SELECT seat, model, effort, input_tokens, output_tokens, cents, flags, card FROM gm_assist_log WHERE seat = 'room' ORDER BY id").all()).results.map((r) => ({ ...r, card: JSON.parse(r.card) }));

await test('the seat: SEATS.room is ROOM_SEAT (the pitch seat\'s model and effort, no prefix), strict schema, the label "Fit to tonight (~3¢)", and generic instructions', () => {
  assert.equal(SEATS.room, ROOM_SEAT);
  assert.deepEqual([ROOM_SEAT.model, ROOM_SEAT.effort, ROOM_SEAT.noPrefix], [SEATS.pitch.model, SEATS.pitch.effort, true]);
  assert.equal(ROOM_SEAT.maxTokens, 2000);
  assert.equal(ROOM_SEAT.schema.additionalProperties, false);
  assert.deepEqual(Object.keys(ROOM_SEAT.schema.properties), ['say', 'things', 'people']);
  assert.equal(ROOM_SEAT.schema.properties.things.items.additionalProperties, false);
  assert.equal(ROOM_SEAT.schema.properties.people.items.additionalProperties, false);
  assert.equal(ROOM_LABEL, 'Fit to tonight (~3¢)');
  assert.ok(!/gm-private|\[\[|Pelican|Dovetail/.test(ROOM_SEAT.instructions), 'no vault paths, wikilinks or fixture names');
  assert.ok(!Object.keys(SEATS).some((k) => k !== 'room' && (SEATS[k].instructions.startsWith(ROOM_SEAT.instructions) || ROOM_SEAT.instructions.startsWith(SEATS[k].instructions))), 'no seat\'s instructions start another\'s (the suites find a seat by them)');
});

await test('the cost cap: the real seat\'s worst case for the LARGEST legal body (every field at its limit, in 3-byte characters) is under 5¢', () => {
  const w = (n) => '€'.repeat(n);
  const big = { site: { name: w(IN.site), theme: w(IN.theme), faction: w(IN.faction) },
    room: { name: w(IN.room), band: 'controlled', say: w(IN.say), things: Array.from({ length: IN.things }, () => ({ name: w(IN.thing), line: w(IN.thingLine) })), people: Array.from({ length: IN.people }, () => 'a'.repeat(IN.role)) },
    tonight: { goal: w(IN.goal), plan: w(IN.plan), onStage: Array.from({ length: IN.onStage }, () => w(IN.name)) } };
  const c = cleanRoomBody(big);
  assert.ok(!c.error, 'the largest legal body is legal: ' + c.error);
  const worst = worstCents(ROOM_SEAT, ROOM_SEAT.instructions, roomUser(c));
  console.log('  worst case for the largest legal body: ' + worst.toFixed(2) + '¢; for a typical body: ' + worstCents(ROOM_SEAT, ROOM_SEAT.instructions, roomUser(cleanRoomBody(BODY))).toFixed(2) + '¢ at most');
  assert.ok(worst <= ROOM_CAP_CENTS, 'worst ' + worst + ' <= ' + ROOM_CAP_CENTS);
  assert.ok(worstCents({ ...ROOM_SEAT, maxTokens: 10000 }, ROOM_SEAT.instructions, roomUser(c)) > ROOM_CAP_CENTS, 'a seat allowed 10k output tokens would be over it');
  assert.equal(worstCents({ model: 'no-such-model' }, '', ''), Infinity, 'an unpriced model is never under the cap');
});

await test('a valid answer lands: { room: { say, things, people, at } }, one call (no prefix, the seat\'s own instructions, the card\'s text in the user turn), one row with its cents', async () => {
  const { db, env } = await setup();
  const { handler, calls } = handlerFor(result(GOOD));
  const { status, out } = await post(handler, env, BODY);
  assert.equal(status, 200, JSON.stringify(out));
  assert.deepEqual(Object.keys(out.room).sort(), ['at', 'people', 'say', 'things']);
  assert.equal(out.room.say, GOOD.say);
  assert.deepEqual(out.room.things, GOOD.things);
  assert.deepEqual(out.room.people, GOOD.people);
  assert.equal(out.cents, 0.48); assert.ok(out.spend && typeof out.spend.tonight === 'number');
  assert.equal(calls.length, 1);
  const a = calls[0];
  assert.equal(a.prefixFileId, '', 'no cached prefix'); assert.equal(a.instructions, ROOM_SEAT.instructions);
  assert.equal(a.model, 'claude-sonnet-5-5'); assert.equal(a.maxTokens, 2000); assert.equal(a.schema, ROOM_SEAT.schema);
  for (const s of ['The Pelican Rooms', 'Nightclub', 'The Dovetail Crew', 'Pelican bar', 'public', 'Smoke hangs', 'A brass till: It rings on every sale.', 'bartender', 'Lift the ledger', 'In through the front', 'Mabel Quist']) assert.ok(a.user.includes(s), 'the user turn carries ' + s);
  const r = await rows(db);
  assert.equal(r.length, 1);
  assert.deepEqual([r[0].seat, r[0].model, r[0].effort, r[0].input_tokens, r[0].output_tokens, r[0].flags], ['room', 'claude-sonnet-5-5', 'low', 900, 300, 'room']);
  assert.ok(Math.abs(r[0].cents - 0.48) < 1e-9, 'the row\'s cents: ' + r[0].cents);
  assert.equal(r[0].card.made, 1); assert.equal(r[0].card.shown, 0, 'never shown: GET /cards never restores it'); assert.equal(r[0].card.room, 'Pelican bar');
  assert.ok(!r[0].card.over_cap);
});

const refusals = [
  ['a malformed answer (no JSON)', null, /no JSON/],
  ['a malformed answer (things is not a list)', { ...GOOD, things: 'GM-ONLY-x' }, /things/],
  ['an over-limit say (301 characters)', { ...GOOD, say: 'GM-ONLY-' + 'x'.repeat(293) }, /say is at most 300/],
  ['an over-limit thing name (41 characters)', { ...GOOD, things: [{ ...GOOD.things[0], name: 'GM-ONLY-' + 'n'.repeat(33) }] }, /things\.name/],
  ['an over-limit person line (121 characters)', { ...GOOD, people: [{ line: 'GM-ONLY-' + 'p'.repeat(113), role: '' }] }, /people\.line/],
  ['three things (2 at most)', { ...GOOD, things: [GOOD.things[0], GOOD.things[1], GOOD.things[1]] }, /things: at most 2/],
  ['four people (3 at most)', { ...GOOD, people: [1, 2, 3, 4].map((i) => ({ line: 'GM-ONLY-p' + i, role: '' })) }, /people: at most 3/],
  ['a tag that is not a room-table tag', { ...GOOD, things: [{ ...GOOD.things[0], tags: ['GM-ONLY-tag'] }] }, /tags/],
  ['a role that is not a-z0-9-', { ...GOOD, people: [{ line: 'GM-ONLY-p', role: 'Head Guard' }] }, /role/],
  ['an unknown field at the top', { ...GOOD, secret: 'GM-ONLY-extra' }, /unknown field: secret/],
  ['an unknown field on a thing', { ...GOOD, things: [{ ...GOOD.things[0], price: 'GM-ONLY-5' }] }, /unknown field: things\.price/],
  ['an unknown field on a person', { ...GOOD, people: [{ ...GOOD.people[0], name: 'GM-ONLY-Ada Vell' }] }, /unknown field: people\.name/],
  ['an empty answer', { say: '', things: [], people: [] }, /nothing for this room/],
];
for (const [what, json, re] of refusals) {
  await test('refused: ' + what + ' -> 200 { room: null, error }, nothing to store, and the row is written (the call was paid for)', async () => {
    const { db, env } = await setup();
    const { handler, calls } = handlerFor(result(json));
    const { status, out } = await post(handler, env, BODY);
    assert.equal(status, 200, 'never a 5xx: the page must read the answer, not be signed out by a non-JSON page');
    assert.equal(out.room, null); assert.match(out.error, re); assert.match(out.error, /did not fit the card .*nothing changed/);
    assert.equal(calls.length, 1);
    const r = await rows(db);
    assert.equal(r.length, 1); assert.ok(r[0].card.error, 'the row says why'); assert.ok(!r[0].card.made); assert.ok(r[0].cents > 0, 'its cost is still counted');
  });
}

await test('a failed call (the provider errored): { room: null, error: "Blade could not be reached ..." }, and its row', async () => {
  const { db, env } = await setup();
  const calls = [];
  const handler = makeHandler({ clientFor: () => ({}), now: () => t, call: async (c, a) => { calls.push(a); const e = new Error('GM-ONLY-provider text'); e.status = 529; throw e; }, leases: makeLeases() });
  const { status, out } = await post(handler, env, BODY);
  assert.equal(status, 200); assert.equal(out.room, null); assert.match(out.error, /could not be reached \(provider status 529\)/);
  assert.ok(!/GM-ONLY-provider/.test(JSON.stringify(out)), 'never the provider\'s own message');
  assert.equal((await rows(db)).length, 1);
});

await test('toRoom: a missing optional field is empty, a role is kept only when given, whitespace is squashed (pure)', () => {
  const v = toRoom({ say: '  GM-ONLY-a \n b ', things: [{ name: 'GM-ONLY-n', line: 'GM-ONLY-l' }], people: [{ line: 'GM-ONLY-p', role: '' }] });
  assert.deepEqual(v, { room: { say: 'GM-ONLY-a b', things: [{ name: 'GM-ONLY-n', line: 'GM-ONLY-l', look: '', roll: '', danger: '', states: [], tags: [] }], people: [{ line: 'GM-ONLY-p' }] } });
  assert.match(toRoom({ things: [{ line: 'no name' }] }).error, /things\.name is required/);
  assert.deepEqual(THING, { name: 40, line: 80, look: 120, roll: 160, danger: 100, state: 24, states: 4, tags: 3 });
  assert.equal(SEAT_TAGS.length, 11);
});

const badBodies = [
  ['an unknown field at the top', { ...BODY, secret: 'x' }, /unknown field: secret/],
  ['an unknown site field', { ...BODY, site: { ...BODY.site, owner: 'x' } }, /unknown field: site\.owner/],
  ['an unknown room field', { ...BODY, room: { ...BODY.room, look: 'GM-ONLY-look' } }, /unknown field: room\.look/],
  ['an unknown thing field (a closer look is never sent)', { ...BODY, room: { ...BODY.room, things: [{ name: 'a', line: 'b', roll: 'GM-ONLY-roll' }] } }, /unknown field: room\.things\.roll/],
  ['an unknown tonight field', { ...BODY, tonight: { ...BODY.tonight, secret: 'x' } }, /unknown field: tonight\.secret/],
  ['no site name', { ...BODY, site: { theme: 'x' } }, /site\.name is required/],
  ['a room name over 80', { ...BODY, room: { ...BODY.room, name: 'r'.repeat(81) } }, /room\.name/],
  ['a say over 300', { ...BODY, room: { ...BODY.room, say: 's'.repeat(301) } }, /say at most 300/],
  ['a band that is not one', { ...BODY, room: { ...BODY.room, band: 'attic' } }, /room\.band/],
  ['eleven things', { ...BODY, room: { ...BODY.room, things: Array.from({ length: 11 }, () => ({ name: 'a' })) } }, /at most 10/],
  ['seven on stage', { ...BODY, tonight: { onStage: Array.from({ length: 7 }, (_, i) => 'n' + i) } }, /onStage/],
  ['a non-string goal', { ...BODY, tonight: { goal: 5 } }, /goal/],
];
for (const [what, body, re] of badBodies) {
  await test('the request: ' + what + ' is a 400 before the database or the key: no call, no row', async () => {
    const { db, env } = await setup();
    const { handler, calls } = handlerFor(result(GOOD));
    const { status, out } = await post(handler, env, body);
    assert.equal(status, 400); assert.match(out.error, re);
    assert.equal(calls.length, 0); assert.equal((await rows(db)).length, 0);
  });
}

await test('the cost cap holds: a seat whose worst case is over 5¢ is refused (413) before the key, the lease or a row; no call is made', async () => {
  const { db, env } = await setup();
  let keyRead = 0;
  const calls = [];
  const handler = makeHandler({ clientFor: () => { keyRead++; return {}; }, now: () => t, call: async (c, a) => { calls.push(a); return result(GOOD); }, leases: makeLeases(), seats: { ...SEATS, room: { ...ROOM_SEAT, maxTokens: 10000 } } });
  const { status, out } = await post(handler, env, BODY);
  assert.equal(status, 413); assert.match(out.error, /5¢ tap: nothing was asked/);
  assert.equal(calls.length, 0); assert.equal(keyRead, 0, 'the client (the key) is never reached'); assert.equal((await rows(db)).length, 0);
});

await test('the cost cap is logged: a fake that reports more than 5¢ is recorded as over_cap on its row, with its cents', async () => {
  const { db, env } = await setup();
  const { handler } = handlerFor(result(GOOD, { cost: 0.07 }));
  const { status, out } = await post(handler, env, BODY);
  assert.equal(status, 200); assert.equal(out.cents, 7);
  const r = await rows(db);
  assert.equal(r[0].card.over_cap, 1); assert.ok(Math.abs(r[0].cents - 7) < 1e-9);
});

await test('room.tables off (or never set) in the stored state: 409, no call, no row, and the key is never reached', async () => {
  for (const tables of [false, 'unset']) {
    const { db, env } = await setup({ tables });
    let keyRead = 0;
    const calls = [];
    const handler = makeHandler({ clientFor: () => { keyRead++; return {}; }, now: () => t, call: async (c, a) => { calls.push(a); return result(GOOD); }, leases: makeLeases() });
    const { status, out } = await post(handler, env, BODY);
    assert.equal(status, 409, String(tables)); assert.match(out.error, /room\.tables\) is off/);
    assert.equal(calls.length, 0); assert.equal(keyRead, 0); assert.equal((await rows(db)).length, 0);
  }
});

await test('the night\'s cap: at the cap (tier off) 429, and at 85% (core) 429 too, since the Blade tap is not a Core seat; no call', async () => {
  for (const [cap, re] of [[0, /cap is reached/], [0.01, /budget ladder|cap is reached/]]) {
    const { db, env } = await setup({ cap });
    if (cap) await db.prepare("INSERT INTO gm_assist_log (campaign, at, session, seat, model, effort, input_tokens, output_tokens, cache_read, cache_write, cents, flags, card) VALUES ('c', ?1, '', 'ref', 'm', '', 0, 0, 0, 0, 0.9, '', NULL)").bind(new Date(t - 1000).toISOString()).run();
    const { handler, calls } = handlerFor(result(GOOD));
    const { status, out } = await post(handler, env, BODY);
    assert.equal(status, 429, 'cap ' + cap); assert.match(out.error, re);
    assert.equal(calls.length, 0);
  }
});

await test('one at a time: a second tap while the first is in flight is a 429 (the lease), and the first still lands', async () => {
  const { env } = await setup();
  let open; const wait = new Promise((r) => { open = r; });
  const leases = makeLeases();
  const { handler } = handlerFor(result(GOOD), { wait, leases });
  const first = post(handler, env, BODY);
  await new Promise((r) => setTimeout(r, 30));
  const second = await post(handler, env, BODY);
  assert.equal(second.status, 429); assert.match(second.out.error, /busy|fitting/i);
  open();
  const one = await first;
  assert.equal(one.status, 200); assert.ok(one.out.room);
});

await test('GM only: a player is refused before the body is read; no call', async () => {
  const { env } = await setup();
  const { handler, calls } = handlerFor(result(GOOD));
  const { status } = await post(handler, env, BODY, { role: 'player', id: 'p@example.test' });
  assert.equal(status, 403); assert.equal(calls.length, 0);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
