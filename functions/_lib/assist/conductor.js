// The Conductor (build plan, "The Conductor"): which seats run now. Pure code: no model call, no I/O, no clock of its own
// (the caller passes `now`), so it is the same in the Worker and under node. The Worker keeps no state between requests,
// so everything it needs (last run per seat, tonight's spend) is read by the caller from gm_assist_log and handed in.
//
//   1. Flags wake seats (WAKES in seats.js). No flag, no call.
//   2. One of each in flight: a seat whose last call has not returned is dropped.
//   3. The budget ladder: under 60% of the cap everything; 60-85% drop Meanwhile, Showrunner and Mystery keeper (the
//      nice-to-haves); 85-100% the Fixer, Ref, Ledger and Another only (so Voice and Stall, which the GM can live without, go
//      at 85%, and Ref, the seat that earns its keep, runs to the cap); at the cap nothing.
//   4. A per-seat cooldown, so a flag that stays set for several minutes does not call the seat every minute.
//   5. Voice (the NPC on stage) wakes on npc_change, and every minute while the GM's page names an NPC on stage; with none named
//      it never runs. It runs after Ref in the list, and the Editor drops a line already shown. voice_plus is the GM's Another tap.
//   6. Stall wakes on the Tripwire's stall flag; Mystery on clue_mention; Showrunner on every tick ('tick' is added by the
//      endpoint, not a Tripwire flag) and the 10-minute cooldown paces it. Stall's offer goes to the Rack like Voice's lines;
//      Showrunner's and Mystery's go through the Editor, behind Ref and Clerk, under the same one-card-per-five-minutes gap.
//   7. Scribe (the story so far) wakes on every tick, every 5 minutes, until 85%; Meanwhile on scene_change, every 20 minutes, until
//      60%. Silence (silenceFlag, above) raises `stall` in code. A Ref card that repeats the same slip within 10 minutes is suppressed (Phase 0: Ref repeats itself on adjacent
//      minutes). isRepeatSlip() is that rule; the Editor uses it too.

import { WAKES } from './seats.js';

export const DEFAULT_CAP = 20;                       // dollars a night (a Worker setting; the Console has its own monthly limit)
export const LADDER = { reduced: 0.6, core: 0.85, off: 1 };
export const DROPPED_WHEN_REDUCED = ['meanwhile', 'showrunner', 'mystery'];
export const CORE_SEATS = ['fixer', 'ref', 'ledger', 'voice_plus', 'gatekeeper'];   // the gatekeeper runs to the cap like Ref: nothing reaches the players' screen unchecked
export const REPEAT_WINDOW_MS = 10 * 60 * 1000;

// Minimum gap between two runs of one seat. The Tap seats read the last few minutes raw, so a minute-by-minute re-run only
// repeats itself. The Fixer's gap is short because the GM presses it on purpose.
export const COOLDOWN_MS = {
  tripwire: 45 * 1000,
  ref: 60 * 1000,
  clerk: 120 * 1000,
  ledger: 120 * 1000,
  fixer: 10 * 1000,
  stall: 5 * 60 * 1000,             // a stall flag that stays set must not offer a new idea every minute
  voice: 45 * 1000,                 // the tick comes about once a minute; the gap must be shorter than that
  voice_plus: 10 * 1000,
  gatekeeper: 0,                    // the GM's own tap; one at a time (the in-flight gate), no cooldown
  showrunner: 10 * 60 * 1000,
  mystery: 15 * 60 * 1000,
  meanwhile: 20 * 60 * 1000,
  scribe: 5 * 60 * 1000,            // the story so far is folded every five minutes of new talk
};

// ---------- the silence flag (code only, no model) ----------
// The Tripwire reads new talk, so a table that has gone truly quiet gives it nothing to read and Stall never wakes. When Listening
// is on and the iPad is hearing, and no line has arrived for SILENCE_MS, the endpoint raises `stall` itself. Stall's own 5-minute
// cooldown (canRun) still applies, and it stops after SILENCE_GIVE_UP_MS: a table that has been silent that long has packed up.
export const SILENCE_MS = 4 * 60 * 1000;
export const SILENCE_GIVE_UP_MS = 30 * 60 * 1000;
export const LISTENING_FRESH_MS = 2 * 60 * 1000;     // the iPad reports at least once a minute; an older report is not "hearing"

/**
 * Is the iPad listening right now? doc: the control document (functions/_lib/stt.js). The GM wants it on, the iPad says it is
 * listening (not idle, stopped, reconnecting or errored: a dead mic is not a silent table) and said so recently.
 */
export function isListening(doc, now) {
  if (!doc || doc.want !== 'on') return false;
  const s = doc.status || {};
  if (s.state !== 'listening') return false;
  const at = Date.parse(s.at);
  return Number.isFinite(at) && Number.isFinite(now) && now - at <= LISTENING_FRESH_MS;
}

/**
 * Should the endpoint raise `stall` for silence? -> { silent: boolean, minutes } . lastLineAt: ms of the newest transcript line (null
 * when none). Silent only when Listening is on, there has been talk, and the gap is between SILENCE_MS and SILENCE_GIVE_UP_MS.
 */
export function silenceFlag({ listening, lastLineAt, now }) {
  if (!listening || !Number.isFinite(lastLineAt) || !Number.isFinite(now)) return { silent: false, minutes: 0 };
  const gap = now - lastLineAt;
  return { silent: gap >= SILENCE_MS && gap <= SILENCE_GIVE_UP_MS, minutes: Math.floor(gap / 60000) };
}

/** 'all' | 'reduced' | 'core' | 'off' for tonight's spend against the cap (dollars). A cap of 0 or less is 'off'. */
export function budgetTier(spent, cap = DEFAULT_CAP) {
  const c = Number(cap), s = Number(spent) || 0;
  if (!(c > 0)) return 'off';
  const share = s / c;
  if (share >= LADDER.off) return 'off';
  if (share >= LADDER.core) return 'core';
  if (share >= LADDER.reduced) return 'reduced';
  return 'all';
}

/** Whether the ladder lets this seat run at this tier. The Tripwire is the gate for the others, so it runs until the cap. */
export function tierAllows(tier, seat) {
  if (tier === 'off') return false;
  if (tier === 'core') return CORE_SEATS.includes(seat) || seat === 'tripwire';
  if (tier === 'reduced') return !DROPPED_WHEN_REDUCED.includes(seat);
  return true;
}

/**
 * Can this one seat run now? -> { ok, why } (why is a short word when not: tier, in-flight, cooldown).
 * lastRun: { seat: ms of its last call }; inFlight: a Set or array of seat ids.
 */
export function canRun(seat, { now, lastRun = {}, inFlight = [], tier = 'all', cooldowns = COOLDOWN_MS } = {}) {
  if (!tierAllows(tier, seat)) return { ok: false, why: 'budget' };
  const busy = inFlight instanceof Set ? inFlight.has(seat) : inFlight.includes(seat);
  if (busy) return { ok: false, why: 'in-flight' };
  const last = lastRun[seat], gap = cooldowns[seat] || 0;
  if (Number.isFinite(last) && Number.isFinite(now) && now - last < gap) return { ok: false, why: 'cooldown' };
  return { ok: true, why: '' };
}

/**
 * Which seats run for these flags. -> { tier, seats: [ids, in WAKES order], skipped: [{ seat, why }] }
 *   flags: the Tripwire's set flags (names); spent / cap: tonight's dollars and the cap; wakes: the table (default WAKES).
 *   onStage: whether the page named an NPC on stage. Voice runs only then: on npc_change, or on any tick (about each minute).
 *   follow: the previous tick woke Ref on roll_talk (see followsThrough). Ref is woken once more on this tick, under the same gates.
 */
export function decide({ flags = [], now, lastRun = {}, inFlight = [], spent = 0, cap = DEFAULT_CAP, wakes = WAKES, cooldowns = COOLDOWN_MS, onStage = false, follow = false } = {}) {
  const tier = budgetTier(spent, cap);
  const set = new Set(flags);
  const seats = [], skipped = [];
  for (const seat of Object.keys(wakes)) {
    if (seat === 'voice' && !onStage) continue;                  // silence while nobody is on stage
    if (!wakes[seat].some((f) => set.has(f))) continue;
    const r = canRun(seat, { now, lastRun, inFlight, tier, cooldowns });
    if (r.ok) seats.push(seat); else skipped.push({ seat, why: r.why });
  }
  if (follow && !set.has('roll_talk') && wakes.ref && !seats.includes('ref') && !skipped.some((x) => x.seat === 'ref')) {   // the follow-through
    const r = canRun('ref', { now, lastRun, inFlight, tier, cooldowns });
    if (r.ok) seats.push('ref'); else skipped.push({ seat: 'ref', why: r.why });
    const order = Object.keys(wakes);
    seats.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }
  if (onStage && !seats.includes('voice') && !skipped.some((x) => x.seat === 'voice')) {   // the per-minute wake
    const r = canRun('voice', { now, lastRun, inFlight, tier, cooldowns });
    if (r.ok) seats.push('voice'); else skipped.push({ seat: 'voice', why: r.why });
  }
  return { tier, seats, skipped };
}

// ---------- follow-through ----------

export const FOLLOW_WINDOW_MS = 10 * 60 * 1000;

/**
 * Does Ref get one more look on this tick? The slip often lands a minute after the Tripwire hears the roll, so a roll_talk wake
 * is followed once by the next tick with new talk, even if the Tripwire does not flag again. prev: the previous tick's Tripwire
 * row { at (ms), flags: [names] } or null. True when that tick flagged roll_talk, whether Ref ran on it or the cooldown held it
 * (Ref's call ends a few seconds after the tick, so a flag on the very next minute is often held). A follow-through tick is not itself a roll_talk wake (decide() adds Ref only when roll_talk is not set), so
 * its own Tripwire row flags no roll_talk and the next tick finds nothing to follow: it never chains.
 */
export function followsThrough(prev, now, windowMs = FOLLOW_WINDOW_MS) {
  if (!prev || !Array.isArray(prev.flags) || !prev.flags.includes('roll_talk')) return false;
  if (!Number.isFinite(prev.at)) return false;
  return !Number.isFinite(now) || now - prev.at <= windowMs;
}

// ---------- repeats ----------

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * The keys that identify a Ref slip: the line it was said at, and the rule it cites. Two cards sharing either key are the
 * same slip. -> [] when the output is no slip.
 */
export function slipKeys(json) {
  if (!json || !json.slip) return [];
  const keys = [];
  if (json.said_at) keys.push('ref:at:' + norm(json.said_at));
  const rule = norm(json.rule).slice(0, 80);
  if (rule) keys.push('ref:rule:' + rule);
  return keys;
}

/**
 * Does this Ref output repeat a slip already shown in the last `windowMs`? recent: [{ at (ms), keys: [string] }], the cards
 * the GM was shown. Anything that is no slip counts as "repeat" too: there is nothing to show.
 */
export function isRepeatSlip(json, recent = [], now, windowMs = REPEAT_WINDOW_MS) {
  const keys = slipKeys(json);
  if (!keys.length) return true;
  return recent.some((r) => Number.isFinite(r.at) && now - r.at < windowMs && (r.keys || []).some((k) => keys.includes(k)));
}
