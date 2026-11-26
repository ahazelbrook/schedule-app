// The room seat (RK16 of the room key build; setting room.tables): the Blade tap that fits one rolled room for tonight. The GM taps
// "Fit to tonight (~3¢)" on a rolled room's card on the GM page; POST /api/gm/assist/room sends what the card already shows the GM and this
// seat answers with overrides for that card: a read-aloud, up to two things (the room tables' thing shape) and up to three people lines. The
// page stores the answer as the room's Blade override (setBlade, in the GM state only); nothing here reaches the iPad or a phone. Pure: no I/O, no
// clock of its own, the same in the Worker and under node.
//   ROOM_SEAT        the seat's { model, effort, maxTokens, noPrefix, instructions, schema } (SEATS.room in seats.js)
//   ROOM_CAP_CENTS   5: no tap may cost more. worstCents() bounds a call before it is made; the handler refuses one over the cap
//   cleanRoomBody    the request body, checked (a 400 before the database or the key): unknown fields are refused, limits are enforced
//   roomUser         the user turn
//   toRoom           the seat's JSON -> { room: { say, things, people } } or { error }: unknown fields, over-limit fields, a bad tag or role, refused
//   worstCents       the most a call can cost, in cents: every byte of the prompt as a token (a token is never shorter than a byte) plus maxTokens of output
// Why no cached prefix (noPrefix, like the hands and whois seats): the prefix is ~90k tokens and each seat keeps its own cache entry, so the
// first tap of an hour would write it (~90k x $2/M x 2 = ~36¢). Without it the card's own text is all the seat reads, and the cap is provable.
// Nothing campaign-specific goes in here: the repository is public. The site, the room and tonight arrive in the request.

import { PRICES } from './claude.js';

export const ROOM_CAP_CENTS = 5;
export const ROOM_LABEL = 'Fit to tonight (~3¢)';
export const SAY_MAX = 300, PERSON_MAX = 120, THINGS_MAX = 2, PEOPLE_MAX = 3, ROLE_MAX = 24;
/* the room tables' thing shape and limits (the GM page's LIMITS and TAGS for a thing; gm-room-blade.test.mjs keeps the two copies equal) */
export const THING = { name: 40, line: 80, look: 120, roll: 160, danger: 100, state: 24, states: 4, tags: 3 };
export const TAGS = ['loot', 'clue', 'weapon', 'escape', 'cover', 'costume', 'talk', 'weird', 'hazard', 'tool', 'door'];
export const BANDS = ['public', 'working', 'controlled', 'secure'];
/* the request's own limits (characters, after whitespace is squashed) */
export const IN = { site: 80, theme: 60, faction: 80, room: 80, say: 300, thing: 40, thingLine: 80, things: 10, role: 24, people: 6, goal: 200, plan: 300, name: 80, onStage: 6 };

const INSTRUCTIONS = [
  "You are Blade, helping the GM of a Blades '68 game dress one room of a rolled site for tonight's score. The message gives the site, the room (its band, its read-aloud line, the things and people drawn there) and tonight (the crew's goal, the plan, who is on stage).",
  'Fit the room to tonight: keep what was drawn, and add what makes this room matter to the goal and the plan.',
  'say: one read-aloud line for the GM to speak as the crew enters, under 45 words, in the second person plural: what the crew sees, hears and smells. Never what is hidden.',
  'things: up to two new things for the room, each in the room-table shape:',
  '- name: a short noun phrase, under 6 words;',
  '- line: what anyone sees at a glance, under 14 words;',
  '- look: what a closer look finds (hidden until someone looks), under 20 words, or empty;',
  '- roll: what a roll adds, as "4/5: ... 6: ...", under 26 words, or empty;',
  '- danger: what goes wrong if it is mishandled, under 16 words, or empty;',
  '- states: up to four one-word states the GM can mark (for example full, empty), or none;',
  '- tags: up to three of: ' + TAGS.join(', ') + '.',
  'people: up to three people in the room now, each one line under 20 words: who they are and what they are doing; role: one lower-case word or hyphenated words for their job (guard, cleaner), or empty.',
  'Rules:',
  '1. Never invent a named person, place or group: describe people by what they do. Use a name only when the message already gives it.',
  '2. Never decide what a player character does, says, thinks or feels, and never decide the outcome of a roll.',
  '3. No rules text: no rulings, page cites or advice on position, effect or dice.',
  '4. Do not repeat a thing or person already drawn in the room.',
  'Fewer is better than weak: leave a list short or empty when nothing fits. Use Australian spelling. Reply with JSON only.',
].join('\n');

const STR = { type: 'string' };
export const ROOM_SEAT = {
  model: 'claude-sonnet-5-5', effort: 'low', maxTokens: 2000, noPrefix: true,      // the pitch seat's model and effort; no prefix (above), so the card's text is the whole prompt
  instructions: INSTRUCTIONS,
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      say: { type: 'string', description: 'one read-aloud line, under 45 words' },
      things: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          properties: { name: STR, line: STR, look: STR, roll: STR, danger: STR, states: { type: 'array', items: STR }, tags: { type: 'array', items: { type: 'string', enum: TAGS } } },
          required: ['name', 'line', 'look', 'roll', 'danger', 'states', 'tags'],
        },
      },
      people: {
        type: 'array',
        items: { type: 'object', additionalProperties: false, properties: { line: STR, role: STR }, required: ['line', 'role'] },
      },
    },
    required: ['say', 'things', 'people'],
  },
};

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const squash = (s) => String(s).replace(/\s+/g, ' ').trim();
const ROLE_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/* the keys of o that are not in allowed: [] when there are none */
const unknownKeys = (o, allowed) => Object.keys(o).filter((k) => !allowed.includes(k));

/* a text field of the request: undefined/null -> '', a string within max -> squashed; anything else -> null (refused) */
function text(v, max) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null;
  const t = squash(v);
  return t.length <= max ? t : null;
}
function texts(v, max, n) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > n) return null;
  const out = [];
  for (const x of v) { const t = text(x, max); if (t === null) return null; if (t) out.push(t); }
  return out;
}

/**
 * The request body -> { site, room, tonight } or { error } (the route answers 400 with it, before the database or the key).
 *   { site: { name, theme?, faction? }, room: { name, band?, say?, things?: [{ name, line? }], people?: [role] }, tonight?: { goal?, plan?, onStage?: [name] } }
 * Every object refuses a key it does not know, and every text over its limit is refused, never cut: the page cuts before it sends.
 */
export function cleanRoomBody(b) {
  if (!isObj(b)) return { error: 'the body is { site, room, tonight }' };
  const top = unknownKeys(b, ['site', 'room', 'tonight']);
  if (top.length) return { error: 'unknown field: ' + top[0] };
  const s = b.site, r = b.room, t = b.tonight === undefined ? {} : b.tonight;
  if (!isObj(s) || !isObj(r) || !isObj(t)) return { error: 'site and room are objects (tonight too, when sent)' };
  for (const [o, keys, at] of [[s, ['name', 'theme', 'faction'], 'site'], [r, ['name', 'band', 'say', 'things', 'people'], 'room'], [t, ['goal', 'plan', 'onStage'], 'tonight']]) {
    const u = unknownKeys(o, keys);
    if (u.length) return { error: 'unknown field: ' + at + '.' + u[0] };
  }
  const site = { name: text(s.name, IN.site), theme: text(s.theme, IN.theme), faction: text(s.faction, IN.faction) };
  if (!site.name || site.theme === null || site.faction === null) return { error: 'site.name is required (at most ' + IN.site + ' characters); theme at most ' + IN.theme + ', faction at most ' + IN.faction };
  const band = text(r.band, 20);
  if (band === null || (band && !BANDS.includes(band))) return { error: 'room.band is one of ' + BANDS.join(', ') };
  const room = { name: text(r.name, IN.room), band, say: text(r.say, IN.say), things: [], people: texts(r.people, IN.role, IN.people) };
  if (!room.name || room.say === null || room.people === null) return { error: 'room.name is required (at most ' + IN.room + ' characters); say at most ' + IN.say + '; people at most ' + IN.people + ' roles of ' + IN.role };
  if (r.things !== undefined && (!Array.isArray(r.things) || r.things.length > IN.things)) return { error: 'room.things is a list of at most ' + IN.things };
  for (const x of r.things || []) {
    if (!isObj(x)) return { error: 'room.things holds { name, line }' };
    const u = unknownKeys(x, ['name', 'line']);
    if (u.length) return { error: 'unknown field: room.things.' + u[0] };
    const th = { name: text(x.name, IN.thing), line: text(x.line, IN.thingLine) };
    if (!th.name || th.line === null) return { error: 'a thing has a name (at most ' + IN.thing + ') and a line (at most ' + IN.thingLine + ')' };
    room.things.push(th);
  }
  const tonight = { goal: text(t.goal, IN.goal), plan: text(t.plan, IN.plan), onStage: texts(t.onStage, IN.name, IN.onStage) };
  if (tonight.goal === null || tonight.plan === null || tonight.onStage === null) return { error: 'tonight: goal at most ' + IN.goal + ', plan at most ' + IN.plan + ', onStage at most ' + IN.onStage + ' names of ' + IN.name };
  return { site, room, tonight };
}

/** The user turn, from cleanRoomBody()'s result. */
export function roomUser({ site, room, tonight }) {
  const of = [site.theme ? 'theme: ' + site.theme : '', site.faction ? 'held by: ' + site.faction : ''].filter(Boolean).join('; ');
  const out = ['The site: ' + site.name + (of ? ' (' + of + ')' : '') + '.', 'The room: ' + room.name + (room.band ? ', in the ' + room.band + ' band' : '') + '.'];
  out.push(room.say ? 'Its read-aloud now: "' + room.say + '"' : 'Its read-aloud now: none.');
  out.push(room.things.length ? 'Drawn here now:\n' + room.things.map((x) => '- ' + x.name + (x.line ? ': ' + x.line : '')).join('\n') : 'Drawn here now: nothing.');
  out.push(room.people.length ? 'People drawn here now (their roles): ' + room.people.join(', ') + '.' : 'People drawn here now: nobody.');
  out.push('Tonight: the goal: ' + (tonight.goal || 'not given') + '. The plan: ' + (tonight.plan || 'not given') + '. On stage: ' + (tonight.onStage.length ? tonight.onStage.join(', ') : 'nobody named') + '.');
  out.push('Fit this room to tonight.');
  return out.join('\n');
}

/* a field of the answer: a string within max (squashed) -> it; else null (refused). A missing optional field is ''. */
function field(o, k, max, need) {
  if (!(k in o)) return need ? null : '';
  if (typeof o[k] !== 'string') return null;
  const t = squash(o[k]);
  if (t.length > max || (need && !t)) return null;
  return t;
}
function thingOf(x) {
  if (!isObj(x)) return { error: 'a thing is an object' };
  const u = unknownKeys(x, ['name', 'line', 'look', 'roll', 'danger', 'states', 'tags']);
  if (u.length) return { error: 'unknown field: things.' + u[0] };
  const t = { name: field(x, 'name', THING.name, true), line: field(x, 'line', THING.line), look: field(x, 'look', THING.look), roll: field(x, 'roll', THING.roll), danger: field(x, 'danger', THING.danger) };
  for (const k of Object.keys(t)) if (t[k] === null) return { error: 'things.' + k + ' is ' + (k === 'name' ? 'required and ' : '') + 'at most ' + THING[k] + ' characters' };
  const st = x.states === undefined ? [] : x.states, tg = x.tags === undefined ? [] : x.tags;
  if (!Array.isArray(st) || st.length > THING.states || st.some((v) => typeof v !== 'string' || !squash(v) || squash(v).length > THING.state)) return { error: 'things.states: at most ' + THING.states + ' of ' + THING.state + ' characters' };
  if (!Array.isArray(tg) || tg.length > THING.tags || tg.some((v) => !TAGS.includes(v))) return { error: 'things.tags: at most ' + THING.tags + ' of ' + TAGS.join(', ') };
  t.states = st.map(squash); t.tags = tg.slice();
  return { thing: t };
}

/**
 * The seat's JSON -> { room: { say, things: [thing], people: [{ line, role? }] } } or { error } (malformed: nothing is shown or stored).
 * Strict, as the request is: a key the schema does not have, a text over its limit, more than 2 things or 3 people, a tag not in TAGS or a role
 * that is not a-z0-9 words joined by '-', and the whole answer is refused (never cut). An answer with nothing in it is refused too.
 */
export function toRoom(json) {
  if (!isObj(json)) return { error: 'no JSON' };
  const u = unknownKeys(json, ['say', 'things', 'people']);
  if (u.length) return { error: 'unknown field: ' + u[0] };
  const say = field(json, 'say', SAY_MAX);
  if (say === null) return { error: 'say is at most ' + SAY_MAX + ' characters' };
  const th = json.things === undefined ? [] : json.things, pp = json.people === undefined ? [] : json.people;
  if (!Array.isArray(th) || th.length > THINGS_MAX) return { error: 'things: at most ' + THINGS_MAX };
  if (!Array.isArray(pp) || pp.length > PEOPLE_MAX) return { error: 'people: at most ' + PEOPLE_MAX };
  const things = [], people = [];
  for (const x of th) { const r = thingOf(x); if (r.error) return r; things.push(r.thing); }
  for (const p of pp) {
    if (!isObj(p)) return { error: 'a person is { line, role }' };
    const pu = unknownKeys(p, ['line', 'role']);
    if (pu.length) return { error: 'unknown field: people.' + pu[0] };
    const line = field(p, 'line', PERSON_MAX, true), role = field(p, 'role', ROLE_MAX);
    if (line === null) return { error: 'people.line is required and at most ' + PERSON_MAX + ' characters' };
    if (role === null || (role && !ROLE_RE.test(role))) return { error: 'people.role is a-z0-9 words joined by -, at most ' + ROLE_MAX };
    people.push(role ? { line, role } : { line });
  }
  if (!say && !things.length && !people.length) return { error: 'Blade had nothing for this room' };
  return { room: { say, things, people } };
}

const bytes = (s) => new TextEncoder().encode(String(s || '')).length;
/** The most one call can cost, in cents: every byte of the instructions, the user turn and the schema as a token (plus 256 for the framing), at the
 *  model's input rate, and maxTokens at its output rate. A token is never shorter than a byte, so the real cost is at most this. */
export function worstCents(cfg, instructions, user) {
  const p = PRICES[cfg && cfg.model];
  if (!p) return Infinity;
  const inTok = bytes(instructions) + bytes(user) + bytes(JSON.stringify(cfg.schema || {})) + 256;
  return (inTok * p.in + (cfg.maxTokens || 0) * p.out) / 1e6 * 100;
}
