// The pitch seat (setting blade.pitches; the kit and stage build, KS18). Blade pitches up to three ideas at a time (a direction, a complication,
// a clue, an NPC move, a cutaway) in place of the Stall and Meanwhile offers. Pure: no I/O, no clock of its own, the same in the Worker and
// under node. The Worker reads no settings, so the page says the setting is on (`pitch: true` on the tick); everything here is reached only
// then, and with it off every wake is today's (conductor.js skips the seat). A pitch never acts: nothing here reaches the iPad or a phone.
//   PITCH_SEAT       the seat's { model, effort, maxTokens, instructions, schema } (SEATS.pitch in seats.js)
//   PITCH_WAKES      the Tripwire flags that wake it (WAKES.pitch); also the quiet table, a 6-minute idle and the GM's pitchNow (decidePitch)
//   cleanPitchBody   the tick body's pitch, pitchNow and seen, checked (a 400 before the key or a model call)
//   decidePitch      whether the seat runs on this tick, with the ladder, the 4-minute cooldown and pitchNow's exceptions
//   pitchUser        the user turn
//   toPitches        the seat's JSON -> the items the GM sees (clipped, one of each kind, nothing in `seen`, at most three) or null
// Nothing campaign-specific goes in here: the repository is public. Names, the prep and the clocks arrive in the cached prefix and the message.

export const PITCH_KINDS = ['direction', 'complication', 'clue', 'npc_move', 'cutaway'];
export const PITCH_MAX = 3;
export const SEEN_MAX = 12;                  // the page sends the last 12 lines shown or dismissed (KS19.2); the newest are kept
export const SEEN_LINE_MAX = 200;
export const LINE_MAX = 160, WHY_MAX = 120, USES_MAX = 80;
export const PITCH_COOLDOWN_MS = 4 * 60 * 1000;
export const PITCH_IDLE_MS = 6 * 60 * 1000;  // a tick with talk wakes the seat when no pitch call has been made for this long
export const PITCH_WAKES = ['scene_change', 'stall'];
export const PITCH_REPLACES = ['stall', 'meanwhile'];   // not woken while pitches are on: a complication or a clue is Stall's offer, a cutaway is Meanwhile's
export const WAKE_WHY = { scene: 'the scene changed', stall: 'the table stalled', quiet: 'the table has gone silent', idle: 'no pitch for a few minutes', asked: 'the GM asked for pitches' };

const INSTRUCTIONS = [
  "You are Blade, pitching ideas to the GM of a Blades '68 game while the session runs. You are called at a scene change, when the table stalls or goes quiet, when no pitch has come for a few minutes, or because the GM asked; the message says which. It also gives the last few minutes of talk, the live clocks, who is on stage, and the lines already pitched or dismissed tonight. Your context holds tonight's prep (cast, places, clocks, factions) and the story so far.",
  'Offer up to three pitches the GM could use in the next few minutes, each of a different kind:',
  '- direction: where the scene could go next, or the scene to cut to;',
  '- complication: a new problem that raises the pressure on what the crew is doing now;',
  '- clue: a proactive way to point the players at something they have not yet found;',
  '- npc_move: something an NPC already in play does now, on their own agenda;',
  '- cutaway: one faction doing something off-screen that the crew will feel soon.',
  'Rules:',
  '1. Build on what was just said at the table: each pitch follows from the last few minutes of talk (when the table is silent, from the talk before the silence and the story so far).',
  '2. Never repeat or rephrase a line from the already-pitched list.',
  "3. Never invent a named person, place or group when tonight's prep has one that fits: use the prep's name. Invent one, unnamed, only when nothing in the prep fits.",
  '4. Never decide what a player character does, says, thinks or feels, and never decide the outcome of a roll. Pitch what the world does; the players choose.',
  '5. No rules text: no rulings, page cites or advice on position, effect or dice. You may name a clock; never say that one ticks.',
  '6. Never hand over a clue the players already have.',
  "line: under 16 words, the point first, something the GM can say or do right now. why_now: under 12 words, what in the talk makes it fit now. uses: the exact name of the one thing from tonight's prep the pitch leans on (an NPC, a clock, a room or place, a faction), or empty.",
  'Fewer is better than weak: leave out a kind that does not fit, and return an empty list if nothing fits. When the GM asked, try for three. Use Australian spelling. Reply with JSON only.',
].join('\n');

export const PITCH_SEAT = {
  model: 'claude-sonnet-5-5', effort: 'low', maxTokens: 1500,      // Meanwhile's size: three short items and a little thinking
  instructions: INSTRUCTIONS,
  schema: {
    type: 'object', additionalProperties: false,
    properties: {
      pitches: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          properties: {
            kind: { type: 'string', enum: PITCH_KINDS },
            line: { type: 'string', description: 'under 16 words, the point first: something the GM can say or do now' },
            why_now: { type: 'string', description: 'under 12 words: what in the talk makes it fit now' },
            uses: { type: 'string', description: "the name of the one thing from tonight's prep it leans on, or empty" },
          },
          required: ['kind', 'line', 'why_now', 'uses'],
        },
      },
    },
    required: ['pitches'],
  },
};

const one = (v, max) => String(typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The tick body's pitch fields. -> { pitch, pitchNow, seen } or { error } (the route answers 400 with it). With `pitch` absent or false the
 * result is { pitch: false, pitchNow: false, seen: [] } whatever `seen` holds: the page with the setting off never sends these keys, and the
 * Worker then takes today's path.
 */
export function cleanPitchBody(b) {
  const body = b && typeof b === 'object' ? b : {};
  if (body.pitch !== undefined && typeof body.pitch !== 'boolean') return { error: 'pitch must be true or false' };
  if (body.pitchNow !== undefined && typeof body.pitchNow !== 'boolean') return { error: 'pitchNow must be true or false' };
  const pitch = body.pitch === true, pitchNow = body.pitchNow === true;
  if (pitchNow && !pitch) return { error: 'pitchNow needs pitch: true' };
  if (!pitch) return { pitch: false, pitchNow: false, seen: [] };
  if (body.seen !== undefined && body.seen !== null && !Array.isArray(body.seen)) return { error: 'seen must be a list of lines' };
  const seen = (Array.isArray(body.seen) ? body.seen : []).filter((s) => typeof s === 'string').map((s) => one(s, SEEN_LINE_MAX)).filter(Boolean).slice(-SEEN_MAX);
  return { pitch, pitchNow, seen };
}

/**
 * Does the pitch seat run on this tick? -> { run: boolean, wake, why } (wake: scene | stall | idle | asked, or '' when nothing woke it; why:
 * budget | in-flight | cooldown when it was woken and held).
 *   flags: the tick's flags (the Tripwire's, plus 'tick' on a tick with talk); lastRun: the cooldown map; tier: the budget tier;
 *   busy: the seat is leased; pitchNow: the GM asked.
 * The ladder: under 85% (all, reduced) it runs; at core (85%) only pitchNow does; at the cap nothing. pitchNow skips the cooldown, not the lease.
 */
export function decidePitch({ flags = [], now, lastRun = {}, tier = 'all', busy = false, pitchNow = false } = {}) {
  const set = new Set(flags), last = lastRun.pitch;
  const recent = (ms) => Number.isFinite(last) && Number.isFinite(now) && now - last < ms;
  const wake = pitchNow ? 'asked' : set.has('scene_change') ? 'scene' : set.has('stall') ? 'stall' : set.has('tick') && !recent(PITCH_IDLE_MS) ? 'idle' : '';
  if (!wake) return { run: false, wake: '', why: '' };
  if (tier === 'off' || (tier === 'core' && !pitchNow)) return { run: false, wake, why: 'budget' };
  if (busy) return { run: false, wake, why: 'in-flight' };
  if (!pitchNow && recent(PITCH_COOLDOWN_MS)) return { run: false, wake, why: 'cooldown' };
  return { run: true, wake, why: '' };
}

/** The user turn. wake: scene | stall | quiet | idle | asked; minutes: the silence (quiet only); clocks: cleanClocks()'s list; seen: cleanPitchBody()'s. */
export function pitchUser({ wake, minutes = 0, npc = '', clocks = [], seen = [], stamp, talk }) {
  const why = wake === 'quiet' ? 'the table has been silent about ' + minutes + ' minutes' : WAKE_WHY[wake] || WAKE_WHY.idle;
  const cl = clocks.length ? 'Live clocks on the table (name, filled/size):\n' + clocks.map((c) => '- ' + c.name + ' ' + c.filled + '/' + c.size).join('\n') : 'Live clocks on the table: none.';
  const sn = seen.length ? 'Already pitched or dismissed tonight (never repeat):\n' + seen.map((s) => '- ' + s).join('\n') : 'Already pitched or dismissed tonight: nothing yet.';
  const t = String(talk || '').trim();
  return 'Why now: ' + why + '.\n' + (npc ? 'On stage: ' + npc + '\n' : '') + cl + '\n' + sn + '\n' +
    (wake === 'quiet' ? 'The last talk before the silence' : 'Talk of the last four minutes') + ', up to ' + stamp + ':\n' + (t || '(no talk)');
}

/**
 * The seat's JSON -> [{ kind, line, why_now, uses }] (1 to 3, kinds all different, none repeating a line in `seen` or each other) or null.
 * The Worker's backstop for the prompt's rules it can check; the others (no invented names, no deciding for a player) are the prompt's.
 */
export function toPitches(json, { seen = [] } = {}) {
  if (!json || typeof json !== 'object' || !Array.isArray(json.pitches)) return null;
  const old = new Set(seen.map(norm).filter(Boolean)), kinds = new Set(), out = [];
  for (const p of json.pitches) {
    if (out.length >= PITCH_MAX) break;
    if (!p || typeof p !== 'object' || !PITCH_KINDS.includes(p.kind) || kinds.has(p.kind)) continue;
    const line = one(p.line, LINE_MAX), k = norm(line);
    if (!k || old.has(k)) continue;
    kinds.add(p.kind); old.add(k);
    out.push({ kind: p.kind, line, why_now: one(p.why_now, WHY_MAX), uses: one(p.uses, USES_MAX) });
  }
  return out.length ? out : null;
}
