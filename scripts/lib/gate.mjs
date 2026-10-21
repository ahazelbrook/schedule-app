// The gate replay ("Claude at the table", the gate before the live night): one session's transcript through the whole Tap with
// every seat on, plus the Fixer and Voice at chosen moments, with one spend cap over all of it and a report for the GM.
// Generic: it holds no table text; the transcript, the prefix and the draws are passed in and the report lands under gm-private/.
// The CLI is scripts/gm-assist-gate.mjs; the Tap itself is scripts/lib/tap-sim.mjs (the same code gm-assist-replay.mjs runs).

import { callSeat, PRICES } from '../../functions/_lib/assist/claude.js';
import { SEATS } from '../../functions/_lib/assist/seats.js';
import { fitUser, voiceUser } from '../../functions/_lib/assist/prompts.js';
import { decide } from '../../functions/_lib/assist/conductor.js';
import { toVoice } from '../../functions/_lib/assist/editor.js';
import { runTapSim, stamp, toMin, talkFor, SKIPPED } from './tap-sim.mjs';

export const GATE = { falsePer30: 1, fixerMedianSecs: 15, nightUsd: 15, nightMinutes: 240, refWithin: 2, minProjectMinutes: 30 };
export const TAP_SEATS = ['tripwire', 'ref', 'clerk', 'ledger', 'stall', 'showrunner', 'mystery'];
// Dry run only: what a reply typically costs in output tokens (thinking included), per seat. An assumption, not a measurement.
export const DRY_OUT_TOKENS = { tripwire: 150, ref: 500, clerk: 300, ledger: 500, stall: 300, showrunner: 700, mystery: 900, fixer: 1500, voice: 400, voice_plus: 200 };

const sortNum = (a) => [...a].sort((x, y) => x - y);
export const median = (a) => { const s = sortNum(a); return s.length ? s[Math.floor((s.length - 1) / 2)] : 0; };
const cell = (x) => String(x == null ? '' : x).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
const usd = (x) => '$' + (Math.round(x * 1000) / 1000).toFixed(3);

/** "22:14,~22:24" -> [{ spec: '22:14', approx: false, t }, ...]. Throws on a stamp that is not HH:MM. */
export function parseExpectRef(list) {
  return String(list || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
    const approx = x.startsWith('~'), body = x.replace(/^~/, '');
    if (!/^\d{1,2}:\d\d$/.test(body)) throw new Error('bad --expect-ref entry ' + x + ' (use HH:MM or ~HH:MM)');
    return { spec: x, approx, t: toMin(body) };
  });
}

/** Which expected slips did a Ref card cover within `within` minutes? -> [{ spec, approx, t, caught, card_t, seat }]; slips outside [fromT, toT] get inWindow:false. */
export function matchRef(expected, shown, { within = GATE.refWithin, fromT = -1, toT = 1e9 } = {}) {
  const refs = shown.filter((c) => c.seat === 'ref');
  return expected.map((e) => {
    const inWindow = e.t >= fromT && e.t <= toT;
    const hit = refs.map((c) => ({ c, d: Math.abs(c.t - e.t) })).filter((x) => x.d <= within).sort((a, b) => a.d - b.d)[0];
    return { spec: e.spec, approx: e.approx, t: e.t, inWindow, caught: !!hit, card_t: hit ? hit.c.t : null, offset_min: hit ? hit.c.t - e.t : null };
  });
}

/** Cards per 30 minutes over `minutes` replayed minutes. */
export const cardsPer30 = (cards, minutes) => (minutes > 0 ? Math.round((cards / (minutes / 30)) * 100) / 100 : 0);

/** A schema-shaped empty answer (dry run): strings '', booleans false, arrays [], numbers 0, enums their first value. */
export function blankFromSchema(s) {
  if (!s) return {};
  if (s.enum) return s.enum[0];
  if (s.type === 'object') return Object.fromEntries(Object.entries(s.properties || {}).map(([k, v]) => [k, blankFromSchema(v)]));
  if (s.type === 'array') return [];
  if (s.type === 'boolean') return false;
  if (s.type === 'number' || s.type === 'integer') return 0;
  return '';
}

/** Dry-run Tripwire: flags by keyword, so the seats it would wake are roughly the ones a real night wakes. */
export function dryTripwire(user) {
  const t = String(user || '').toLowerCase();
  const has = (re) => re.test(t);
  return {
    roll_talk: has(/\b(roll|rolls|rolling|rolled|dice|die|risky|desperate|controlled|position|effect)\b/), harm: has(/\b(harm|hurt|wound|wounded|injur\w*|bleed\w*)\b/),
    npc_change: false, new_name: false, clue_mention: has(/\b(clue|secret|theory|evidence)\b/), xp_trigger: has(/\b(xp|experience)\b/),
    scene_change: false, stall: false,
  };
}

/**
 * Run the gate. opts:
 *   client, prefix, registry (default SEATS), allMinutes (parseMinutes), fromT, toT (default: the transcript's span)
 *   fixerAt [HH:MM], drawsFor (makeDrawsFor result: hhmm -> { position, low, mid }), voiceAt [{ at, npc }]
 *   expectRef (parseExpectRef), maxSpend (default 15), cap (the endpoint's own ladder cap; default 1000 so nothing is dropped)
 *   dryRun, tokenCount (optional async (model, prefix) -> tokens for the dry run; chars/4 without it), label
 * Returns the gate object that gate.json holds (see report()).
 */
export async function runGate(opts) {
  const { client, day, prefix = '', allMinutes, fixerAt = [], drawsFor, voiceAt = [], expectRef = [], maxSpend = GATE.nightUsd, cap = 1000, dryRun = false, tokenCount, label = '' } = opts;
  const registry = opts.registry || SEATS;
  const keys = [...allMinutes.keys()].sort((a, b) => a - b);
  if (!keys.length) throw new Error('no transcript lines');
  const fromT = opts.fromT != null && opts.fromT >= 0 ? opts.fromT : keys[0];
  const toT = opts.toT != null && opts.toT < 1e8 ? opts.toT : keys[keys.length - 1];

  const calls = [];                       // every call, in order: { phase, seat, at, cost, secs, stop, ok }
  let total = 0, stopped = '', stoppedAt = '';
  const overCap = () => total >= maxSpend;

  // ---- the dry run's price list: exact prefix tokens when asked, else chars/4
  const prefixTokens = {};
  if (dryRun) {
    for (const m of new Set(Object.values(registry).map((s) => s.model))) {
      let n = 0;
      if (tokenCount) { try { n = await tokenCount(m, prefix); } catch { n = 0; } }
      prefixTokens[m] = n > 0 ? n : Math.ceil(prefix.length / 4);
    }
  }
  const warmed = {};                      // seat -> virtual minute of its last call (a 1-hour cache entry lives on while it is read)
  const dryCall = (seat, a, at) => {
    const cfg = registry[seat], p = PRICES[cfg.model] || { in: 0, out: 0, read: 0 };
    const t = toMin(at), pt = prefixTokens[cfg.model] || 0;
    const fresh = Math.ceil(((a.instructions || '').length + (a.user || '').length) / 4);
    const miss = warmed[seat] == null || t - warmed[seat] >= 60;
    warmed[seat] = t;
    const out = DRY_OUT_TOKENS[seat] || 500;
    const cost = ((miss ? pt * p.in * 2 : pt * p.read) + fresh * p.in + out * p.out) / 1e6;
    const json = seat === 'tripwire' ? dryTripwire(a.user) : blankFromSchema(a.schema || cfg.schema);
    return { json, text: '', usage: {}, cost, stop: 'dry', secs: 0 };
  };

  // ---- one seat call, counted
  async function one(phase, seat, at, a) {
    const r = dryRun ? dryCall(seat, a, at) : await callSeat(client, { ...a, prefix, prefixFileId: '' });
    total += r.cost;
    calls.push({ phase, seat, at, cost: r.cost, secs: r.secs, stop: r.stop, ok: r.json !== null });
    return r;
  }
  const fail = (e) => ({ json: null, text: '', usage: {}, cost: 0, stop: 'error:' + String(e && e.message || e).slice(0, 120), secs: 0 });

  // ---- Fixer at the given moments (first: they are few and the questions the gate asks of them are sharp)
  const fixer = [];
  for (const at of fixerAt) {
    if (overCap()) { stopped = stopped || 'cap'; stoppedAt = stoppedAt || at; fixer.push({ at, skipped: true }); continue; }
    const t = toMin(at), d = drawsFor(at);
    const cfg = registry.fixer;
    const user = fitUser({ position: d.position, draws: d, stamp: at, talk: talkFor(allMinutes, t - 4, t) });
    let r;
    try { r = await one('fixer', 'fixer', at, { ...cfg, instructions: cfg.instructions, user }); } catch (e) { r = fail(e); calls.push({ phase: 'fixer', seat: 'fixer', at, cost: 0, secs: 0, stop: r.stop, ok: false }); }
    fixer.push({ at, position: d.position, draws: { low: d.low, mid: d.mid }, fitted: r.json, secs: r.secs, stop: r.stop, cost: r.cost });
  }

  // ---- Voice at the given moments (silent, with no call, when no NPC is named)
  const voice = [];
  for (const { at, npc } of voiceAt) {
    const verdict = decide({ flags: ['npc_change'], now: 1e12, onStage: !!npc });
    if (!verdict.seats.includes('voice')) { voice.push({ at, npc: '', silent: true, lines: [] }); continue; }
    if (overCap()) { stopped = stopped || 'cap'; stoppedAt = stoppedAt || at; voice.push({ at, npc, skipped: true, lines: [] }); continue; }
    const t = toMin(at), cfg = registry.voice;
    let r;
    try { r = await one('voice', 'voice', at, { ...cfg, user: voiceUser({ npc, stamp: at, talk: talkFor(allMinutes, t - 3, t) }) }); } catch (e) { r = fail(e); calls.push({ phase: 'voice', seat: 'voice', at, cost: 0, secs: 0, stop: r.stop, ok: false }); }
    const v = toVoice(r.json);
    voice.push({ at, npc, who: v ? v.who : '', want: v ? v.want : '', lines: v ? [...v.lines] : [], secs: r.secs, stop: r.stop, cost: r.cost });
  }

  // ---- the whole Tap, every seat on
  const callHook = async (seat, a, at) => {
    try { return await one('tap', seat, at, a); } catch (e) { const r = fail(e); calls.push({ phase: 'tap', seat, at, cost: 0, secs: 0, stop: r.stop, ok: false }); return r; }
  };
  const tapStart = total;
  const sim = await runTapSim({ client, registry, allMinutes, fromT, toT, enabled: new Set(TAP_SEATS), cap, ...(day ? { day } : {}), callHook, shouldStop: () => (overCap() ? 'cap' : '') });
  if (sim.stopped) { stopped = stopped || 'cap'; stoppedAt = stoppedAt || sim.stoppedAt; }
  const tapSpend = total - tapStart;
  const minutes = sim.ticks.length;

  return buildGate({ label, dryRun, maxSpend, fromT, toT, calls, total, tapSpend, minutes, ticks: sim.ticks, shown: sim.shown, fixer, voice, expectRef, stopped, stoppedAt, registry });
}

/** Everything the report says, as data (this is gate.json). */
export function buildGate({ label, dryRun, maxSpend, fromT, toT, calls, total, tapSpend, minutes, ticks, shown, fixer, voice, expectRef, stopped, stoppedAt, registry }) {
  const bySeat = {};
  for (const c of calls) { const s = (bySeat[c.seat] = bySeat[c.seat] || { calls: 0, cost: 0, refusals: 0, truncations: 0, noJson: 0, errors: 0 }); s.calls++; s.cost += c.cost; if (c.stop === 'refusal') s.refusals++; if (c.stop === 'max_tokens') s.truncations++; if (!c.ok && c.stop !== 'dry') s.noJson++; if (String(c.stop).startsWith('error:')) s.errors++; }
  const replayedTo = ticks.length ? toMin(ticks[ticks.length - 1].at) : fromT;
  const ref = matchRef(expectRef, shown, { fromT, toT: replayedTo });
  const fixerRun = fixer.filter((f) => !f.skipped);
  const secs = fixerRun.map((f) => f.secs);
  const nonTap = total - tapSpend;
  // a window under 30 minutes is mostly cold-cache writes, so scaling it to a night would say nothing true: null then
  const projected = minutes >= GATE.minProjectMinutes ? (tapSpend / minutes) * GATE.nightMinutes + nonTap : null;
  const per30 = cardsPer30(shown.length, minutes);
  const partial = !!stopped;
  const g = {
    label, dryRun: !!dryRun, partial, stopped, stoppedAt, window: { from: stamp(fromT), to: stamp(replayedTo), minutes },
    spend: { total, maxSpend, tap: tapSpend, nonTap, bySeat: Object.fromEntries(Object.entries(bySeat).map(([k, v]) => [k, { calls: v.calls, cost: v.cost }])), projectedNight: projected, nightMinutes: GATE.nightMinutes },
    cards: shown.map((c, i) => ({ n: i + 1, at: stamp(c.t), seat: c.seat, text: c.text })), cardsPer30: per30,
    ref, fixer: { moments: fixer, calls: fixerRun.length, secs, median: median(secs), max: secs.length ? Math.max(...secs) : 0 },
    voice, refusals: Object.fromEntries(Object.entries(bySeat).map(([k, v]) => [k, { refusals: v.refusals, truncations: v.truncations, noJson: v.noJson, errors: v.errors }])),
    models: Object.fromEntries(Object.entries(registry).map(([k, v]) => [k, v.model + ' ' + v.effort])),
  };
  g.criteria = criteria(g, expectRef);
  return g;
}

/** The PASS/FAIL/NEEDS-ALEX line per gate criterion. */
export function criteria(g, expectRef) {
  const out = [];
  const inWin = g.ref.filter((r) => r.inWindow);
  if (!expectRef.length) out.push({ id: 'ref', name: 'Ref flags the known slips', result: 'NEEDS-ALEX', detail: 'no --expect-ref given' });
  else if (g.dryRun) out.push({ id: 'ref', name: 'Ref flags the known slips', result: 'NEEDS-ALEX', detail: 'dry run: nothing was asked of Ref' });
  else if (!inWin.length) out.push({ id: 'ref', name: 'Ref flags the known slips', result: 'NEEDS-ALEX', detail: 'none of the expected slips fall in the replayed window' });
  else {
    const missed = inWin.filter((r) => !r.caught);
    out.push({ id: 'ref', name: 'Ref flags the known slips', result: missed.length ? 'FAIL' : 'PASS', detail: `${inWin.length - missed.length} of ${inWin.length} caught within ${GATE.refWithin} min` + (missed.length ? '; missed ' + missed.map((m) => m.spec).join(', ') : '') });
  }
  if (g.dryRun) out.push({ id: 'false', name: 'At most one false card per 30 min', result: 'NEEDS-ALEX', detail: 'dry run: no cards' });
  else out.push({ id: 'false', name: 'At most one false card per 30 min', result: g.cardsPer30 <= GATE.falsePer30 ? 'PASS' : 'NEEDS-ALEX', detail: `${g.cards.length} cards in ${g.window.minutes} min = ${g.cardsPer30} per 30 min` + (g.cardsPer30 <= GATE.falsePer30 ? ' (even if every card is false)' : '; Alex marks the checklist, then false per 30 min = (false cards) / ' + (g.window.minutes / 30).toFixed(2)) });
  out.push({ id: 'keep', name: "Fixer's lines keep the console's draw", result: 'NEEDS-ALEX', detail: g.fixer.calls ? `Alex reads ${g.fixer.calls} moment${g.fixer.calls === 1 ? '' : 's'} (draws beside the fitted lines)` : 'no Fixer moment ran' });
  if (g.dryRun || !g.fixer.calls) out.push({ id: 'median', name: `Fixer median under ${GATE.fixerMedianSecs} s`, result: 'NEEDS-ALEX', detail: g.dryRun ? 'dry run: no timings' : 'no Fixer moment ran' });
  else out.push({ id: 'median', name: `Fixer median under ${GATE.fixerMedianSecs} s`, result: g.fixer.median < GATE.fixerMedianSecs ? 'PASS' : 'FAIL', detail: `median ${g.fixer.median} s, max ${g.fixer.max} s over ${g.fixer.calls} call${g.fixer.calls === 1 ? '' : 's'}` });
    out.push({ id: 'cost', name: `Replay under $${GATE.nightUsd} a night`, result: g.spend.projectedNight == null ? 'NEEDS-ALEX' : g.dryRun || g.partial ? (g.spend.projectedNight >= GATE.nightUsd ? 'FAIL' : 'NEEDS-ALEX') : (g.spend.projectedNight < GATE.nightUsd ? 'PASS' : 'FAIL'),
    detail: `${usd(g.spend.total)} spent over ${g.window.minutes} min${g.spend.projectedNight == null ? '; no projection (window under ' + GATE.minProjectMinutes + ' min: mostly cache writes)' : '; projected ' + usd(g.spend.projectedNight) + ' per ' + GATE.nightMinutes / 60 + '-hour night'}` + (g.dryRun ? ' (estimate, no calls)' : '') + (g.partial ? ' (partial run: stopped at the spend cap)' : '') });
  out.push({ id: 'cpu', name: 'CPU fits Workers Free', result: 'NEEDS-ALEX', detail: 'read it from Cloudflare (Workers metrics), not from this script' });
  return out;
}

/** gate.md: the report Alex reads on a phone. Card text is in it (it lives under gm-private/); the chat summary quotes none. */
export function report(g) {
  const L = [];
  L.push(`# Gate replay${g.label ? ' ' + g.label : ''}${g.dryRun ? ' (DRY RUN)' : ''}`, '', `Window ${g.window.from} to ${g.window.to} (${g.window.minutes} min).`);
  if (g.dryRun) L.push('', '> [!warning] Dry run: no API calls. Spend is an estimate (chars/4 or counted prefix tokens, assumed output sizes); there are no cards, timings or Ref results.');
  if (g.partial) L.push('', `> [!warning] Partial: stopped at ${g.stoppedAt} when spend reached the $${g.spend.maxSpend} cap. Everything below covers only what ran.`);
  if (/^s03$/i.test(g.label)) L.push('', '> [!note] s03 is the hold-out: replay it, read it, never tune on it.');
  L.push('', '## Criteria', '', '| | Criterion | Detail |', '|---|---|---|', ...g.criteria.map((c) => `| **${c.result}** | ${cell(c.name)} | ${cell(c.detail)} |`));
  L.push('', '## Spend', '', `Total ${usd(g.spend.total)} of $${g.spend.maxSpend} cap. ${g.spend.projectedNight == null ? 'No projection for a window this short (mostly cache writes); use a dry run of the whole night.' : 'Projected ' + usd(g.spend.projectedNight) + ' per ' + g.spend.nightMinutes / 60 + '-hour night (the Tap scaled linearly from this window; Fixer and Voice counted as run).'}`, '',
    '| Seat | Calls | Spend | Model |', '|---|---|---|---|', ...Object.entries(g.spend.bySeat).map(([s, v]) => `| ${s} | ${v.calls} | ${usd(v.cost)} | ${g.models[s] || ''} |`));
  L.push('', '## Cards', '', g.dryRun ? '_Dry run: none._' : `${g.cards.length} cards, ${g.cardsPer30} per 30 minutes. Tick a box if the card was REAL; leave it empty if false.`, '');
  for (const c of g.cards) L.push(`- [ ] ${c.n}. ${c.at} **${c.seat}**: ${String(c.text).replace(/\r?\n/g, ' / ')}`);
  L.push('', '## Ref', '');
  if (!g.ref.length) L.push('_No expected slips given._');
  else {
    L.push('| Expected | Caught within ' + GATE.refWithin + ' min | Card shown |', '|---|---|---|');
    for (const r of g.ref) L.push(`| ${r.spec} | ${!r.inWindow ? 'outside the replayed window' : g.dryRun ? 'dry run' : r.caught ? 'yes' : 'NO'} | ${r.card_t != null ? stamp(r.card_t) + ' (' + (r.offset_min >= 0 ? '+' : '') + r.offset_min + ' min)' : ''} |`);
  }
  L.push('', '## Fixer', '');
  if (!g.fixer.moments.length) L.push('_No Fixer moments given._');
  else {
    L.push(g.dryRun ? '_Dry run: not called._' : `Seconds per call: ${g.fixer.secs.join(', ') || 'none'}. Median ${g.fixer.median}, max ${g.fixer.max}.`, '');
    for (const m of g.fixer.moments) {
      if (m.skipped) { L.push(`### ${m.at}`, '', '_Skipped: spend cap reached._', ''); continue; }
      const f = m.fitted;
      L.push(`### ${m.at} (${m.position}; ${m.secs} s, stop ${m.stop}, ${usd(m.cost)})`, '', '| | Console draw | Fitted line |', '|---|---|---|',
        `| 1-3 | ${cell(m.draws.low)} | ${cell(f && f.one_three)} |`, `| 4-5 | ${cell(m.draws.mid)} | ${cell(f && f.four_five)} |`, '');
      if (!f && !g.dryRun) L.push('_No JSON (see Refusals and truncations)._', '');
    }
  }
  L.push('', '## Voice', '');
  if (!g.voice.length) L.push('_No Voice moments given._');
  for (const v of g.voice) {
    if (v.silent) L.push(`- ${v.at}: silent (no NPC named, so no call).`);
    else if (v.skipped) L.push(`- ${v.at}: skipped (spend cap reached).`);
    else { L.push(`- ${v.at}: ${v.lines.length} line${v.lines.length === 1 ? '' : 's'} (${v.secs} s, stop ${v.stop}, ${usd(v.cost)})`); for (const l of v.lines) L.push(`  - ${l}`); }
  }
  L.push('', '## Refusals and truncations', '', '| Seat | Refusals | Cut off (max_tokens) | No JSON | Errors |', '|---|---|---|---|---|', ...Object.entries(g.refusals).map(([s, v]) => `| ${s} | ${v.refusals} | ${v.truncations} | ${v.noJson} | ${v.errors} |`));
  return L.join('\n') + '\n';
}

export { SKIPPED };
