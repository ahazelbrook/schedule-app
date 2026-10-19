// The Conductor (build plan, "The Conductor"): which seats run now. Pure code: no model call, no I/O, no clock of its own
// (the caller passes `now`), so it is the same in the Worker and under node. The Worker keeps no state between requests,
// so everything it needs (last run per seat, tonight's spend) is read by the caller from gm_assist_log and handed in.
//
//   1. Flags wake seats (WAKES in seats.js). No flag, no call.
//   2. One of each in flight: a seat whose last call has not returned is dropped.
//   3. The budget ladder: under 60% of the cap everything; 60-85% drop Meanwhile, Showrunner and Mystery keeper;
//      85-100% the Fixer, Ref and Ledger only; at the cap nothing.
//   4. A per-seat cooldown, so a flag that stays set for several minutes does not call the seat every minute.
//   5. A Ref card that repeats the same slip within 10 minutes is suppressed (Phase 0: Ref repeats itself on adjacent
//      minutes). isRepeatSlip() is that rule; the Editor uses it too.

import { WAKES } from './seats.js';

export const DEFAULT_CAP = 20;                       // dollars a night (a Worker setting; the Console has its own monthly limit)
export const LADDER = { reduced: 0.6, core: 0.85, off: 1 };
export const DROPPED_WHEN_REDUCED = ['meanwhile', 'showrunner', 'mystery'];
export const CORE_SEATS = ['fixer', 'ref', 'ledger'];
export const REPEAT_WINDOW_MS = 10 * 60 * 1000;

// Minimum gap between two runs of one seat. The Tap seats read the last few minutes raw, so a minute-by-minute re-run only
// repeats itself. The Fixer's gap is short because the GM presses it on purpose.
export const COOLDOWN_MS = {
  tripwire: 45 * 1000,
  ref: 60 * 1000,
  clerk: 120 * 1000,
  ledger: 120 * 1000,
  fixer: 10 * 1000,
  showrunner: 10 * 60 * 1000,
  mystery: 15 * 60 * 1000,
  meanwhile: 20 * 60 * 1000,
};

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
 */
export function decide({ flags = [], now, lastRun = {}, inFlight = [], spent = 0, cap = DEFAULT_CAP, wakes = WAKES, cooldowns = COOLDOWN_MS } = {}) {
  const tier = budgetTier(spent, cap);
  const set = new Set(flags);
  const seats = [], skipped = [];
  for (const seat of Object.keys(wakes)) {
    if (!wakes[seat].some((f) => set.has(f))) continue;
    const r = canRun(seat, { now, lastRun, inFlight, tier, cooldowns });
    if (r.ok) seats.push(seat); else skipped.push({ seat, why: r.why });
  }
  return { tier, seats, skipped };
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
