// An invented night for the Conductor (KS18.3): four hours of ticks, one a minute, with the Tripwire's flags drawn from a fixed seed, an NPC on
// stage now and then, and a fixed cost per seat call, so tonight's spend climbs through every rung of the ladder (60%, 85%, the cap).
// simulate(conductor, opts) plays it through decide() as assist.js does (flags + 'tick', the follow-through, the cooldown map from the seats
// that ran) and returns one line per tick. With no opts it makes EXACTLY the calls the day-0 Conductor (798907c) was given, so its lines can be
// compared with pitch-night-day0.txt, recorded from that commit's conductor.js and seats.js. No model, no network; nothing campaign-specific.

export const T0 = Date.UTC(2026, 10, 14, 9, 0, 0);       // 20:00 in Melbourne (AEDT); only the minute offsets matter
export const MINUTES = 240;
export const CAP = 30;
const FLAGS = ['roll_talk', 'harm', 'npc_change', 'new_name', 'clue_mention', 'xp_trigger', 'scene_change', 'stall', 'downtime'];
const CHANCE = { roll_talk: 0.22, harm: 0.08, npc_change: 0.1, new_name: 0.1, clue_mention: 0.12, xp_trigger: 0.06, scene_change: 0.07, stall: 0.06, downtime: 0.03 };
// dollars per call: high enough that the night crosses 60% (18), 85% (25.5) and the cap (30) inside the four hours
export const COST = { tripwire: 0.02, ref: 0.09, clerk: 0.08, ledger: 0.06, voice: 0.07, stall: 0.1, showrunner: 0.05, mystery: 0.2, scribe: 0.08, meanwhile: 0.1, whois: 0.05, pitch: 0.1 };

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** The night: [{ i, flags, onStage }], the same every run. */
export function night() {
  const r = rng(20261114), out = [];
  let stage = false;
  for (let i = 0; i < MINUTES; i++) {
    const flags = FLAGS.filter((f) => r() < CHANCE[f]);
    if (flags.includes('npc_change')) stage = r() < 0.7; else if (r() < 0.03) stage = false;
    out.push({ i, flags, onStage: stage });
  }
  return out;
}

const hhmm = (i) => { const m = 20 * 60 + i; return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

/**
 * Play the night through C.decide. C: the conductor module ({ decide, followsThrough }). opts.extra(i): extra decide() options for tick i
 * (the pitch keys); with no opts.extra the call is the day-0 call exactly. opts.wakes: passed through when given. -> [line]
 */
export function simulate(C, opts = {}) {
  const lines = [], lastRun = {};
  let spent = 0, prev = null;
  for (const { i, flags, onStage } of night()) {
    const now = T0 + i * 60000;
    const args = { flags: flags.concat('tick'), now, lastRun: { ...lastRun }, inFlight: [], spent, cap: CAP, onStage, follow: C.followsThrough(prev, now) };
    if (opts.wakes) args.wakes = opts.wakes;
    if (opts.extra) Object.assign(args, opts.extra(i));
    const v = C.decide(args);
    spent += COST.tripwire;
    for (const s of v.seats) { lastRun[s] = now; spent += COST[s] || 0; }
    prev = { at: now, flags };
    lines.push(hhmm(i) + ' ' + v.tier + ' [' + flags.join(',') + ']' + (onStage ? ' stage' : '') + ' -> ' + v.seats.join(',') + (v.skipped.length ? ' | ' + v.skipped.map((x) => x.seat + ':' + x.why).join(',') : ''));
    spent = Math.round(spent * 100) / 100;
  }
  return lines;
}
