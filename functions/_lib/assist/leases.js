// Seat leases and call deadlines (design 2.1). The Worker keeps nothing between requests, but within one isolate a seat's call is
// tracked so a second request does not start a second call for the same seat. That used to be a Set with an add before the call and a
// delete in `finally`; a request cancelled mid-call never reached the `finally`, and the seat stayed "in flight" for the rest of the
// night. A lease is the same record with a token and an expiry: whoever holds it releases it, and if nobody does, it lapses.
//
// Pure code with no clock of its own (the caller passes `now`, as the Conductor does), so it is the same in the Worker and under node.
// No D1 write and no CPU worth counting: a Map of a dozen entries.
//
//   acquire(seat, now)  -> a token, or null while a live (unexpired) lease exists
//   release(seat, token) -> true when it freed the seat; a token that is not the current one frees nothing, so a late finisher
//                          cannot free a newer lease
//   sweep(now)          -> the seats whose lease had expired (now dropped): reported ONCE, here
//   seats(now?)         -> a Set of the seats that are live; the Conductor's canRun()/decide() take it as `inFlight`, unchanged
//   takeReaped()        -> every seat sweep() has reaped since the last take: what the tick's `health.reaped` reports, so a /fit or an
//                          /ask that swept first does not swallow the tick's report

const S = 1000;

/** How long a lease lives if nobody releases it: a little past the call's deadline (DEADLINE_MS), and under the page's timeout. */
export const LEASE_TTL_MS = {
  tripwire: 27 * S,
  // the tick's seats
  ref: 45 * S, clerk: 45 * S, ledger: 45 * S, voice: 45 * S, stall: 45 * S, showrunner: 45 * S, mystery: 45 * S, scribe: 45 * S, meanwhile: 45 * S,
  // the GM's taps
  fixer: 60 * S, voice_plus: 60 * S, gatekeeper: 60 * S, portrait: 60 * S, wire: 60 * S,
  prop: 90 * S, ask: 90 * S,
  hands: 30 * S,
};
export const DEFAULT_TTL_MS = 60 * S;

/** The longest one seat call may take, retries included. Each sits below the page's timeout for that endpoint (app/runtime/cf.js). */
export const DEADLINE_MS = {
  tripwire: 12 * S,
  ref: 30 * S, clerk: 30 * S, ledger: 30 * S, voice: 30 * S, stall: 30 * S, showrunner: 30 * S, mystery: 30 * S, scribe: 30 * S, meanwhile: 30 * S,
  fixer: 45 * S, voice_plus: 45 * S, gatekeeper: 45 * S, portrait: 45 * S, wire: 45 * S,
  prop: 75 * S, ask: 75 * S,
  hands: 15 * S,
};
export const DEFAULT_DEADLINE_MS = 45 * S;

export function makeLeases({ ttls = LEASE_TTL_MS, defaultTtl = DEFAULT_TTL_MS } = {}) {
  const held = new Map();          // seat -> { token, at, ttl }
  let serial = 0;
  let unreported = [];             // reaped seats the tick has not told the page about yet

  const expired = (l, now) => Number.isFinite(now) && now - l.at >= l.ttl;

  function sweep(now) {
    const reaped = [];
    for (const [seat, l] of held) {
      if (expired(l, now)) { held.delete(seat); reaped.push(seat); }
    }
    unreported = unreported.concat(reaped);
    return reaped;
  }

  function acquire(seat, now) {
    const cur = held.get(seat);
    if (cur) {
      if (!expired(cur, now)) return null;
      held.delete(seat);           // lapsed between the caller's sweep and now: the seat is free, and the lapse is still reported
      unreported.push(seat);
    }
    const token = seat + '#' + (++serial);
    held.set(seat, { token, at: now, ttl: ttls[seat] || defaultTtl });
    return token;
  }

  function release(seat, token) {
    const cur = held.get(seat);
    if (!cur || cur.token !== token) return false;
    held.delete(seat);
    return true;
  }

  /** The seats with a live lease. With `now`, an expired one is not counted (it is not dropped either: sweep does that). */
  function seats(now) {
    const out = new Set();
    for (const [seat, l] of held) if (now === undefined || !expired(l, now)) out.add(seat);
    return out;
  }

  function takeReaped() {
    const out = unreported;
    unreported = [];
    return out;
  }

  return { acquire, release, sweep, seats, takeReaped, get size() { return held.size; } };
}
