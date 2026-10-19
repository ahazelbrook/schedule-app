// /api/gm/assist/{tick,fit} (GM only, see the "Claude at the table" build plan): Claude at the table, GM side. Players never
// call it and nothing it returns reaches the iPad. A player (or the table display sign-in) gets 403 before the body is read.
//   POST /api/gm/assist/tick { after? } -> { cards, flags, spend, last, errors? }
//        The GM page calls it about once a minute while Listening is on. It reads the transcript lines newer than seq `after`
//        (the last minute when omitted), runs the Tripwire on them, asks the Conductor which seats to wake, runs those, and
//        lets the Editor pass at most one Tap card (Ref, Clerk, Ledger) per five minutes. `cards` is [] on most ticks.
//   POST /api/gm/assist/fit { position, effect? } -> { cards: [fixer card], flags: [], spend, last }
//        The Fixer for a position the GM names: what could happen on a 1-3, 4-5, 6 and crit, and a Devil's Bargain.
//   card: { seat, at (ISO), text }, plus the Fixer's { read, one_three, four_five, six, crit, bargain }
//   spend: { tonight, cap, tier, tick } in dollars; tier is all | reduced | core | off (the badge says so when it is off)
// Every call is logged to gm_assist_log (seat, model, effort, tokens, cents, flags, the card): that table IS the cost meter and
// the Conductor's memory, because a Worker keeps nothing between requests. The key is the Worker secret ANTHROPIC_API_KEY;
// it is never logged and never returned. Errors reach the caller as a short status, never the provider's message or the key.
//
// The cached prefix (rules digest, campaign, prep) is the GM pack part `assist`: { prefix: string, extra?: { <seat>: string } }.
// It quotes the campaign, so it is never in git; the GM builds it on their own PC (scripts/gm-pack.mjs, lib/assist-export.mjs)
// and pushes it like any other part. Without it the prefix is empty and the answer carries warnings: ['no assist part in the GM pack'].
//
// [TODO: the Fixer can take 15-30 s. Confirm against Cloudflare's current Workers limits how long a request may stay open
//  (wall-clock versus CPU time, and any proxy idle timeout in front of it) before relying on this one non-streaming call.
//  If it is a problem, switch callSeat to client.messages.stream and send the Fixer's lines as they arrive.]
//
// The Scribe's rolling "story so far" is Phase 2: the Tap seats read the last four minutes raw for now.

import { getDb } from '../../_lib/db.js';
import { HttpError, json, methodNotAllowed, readJsonObject, campaignOf } from '../../_lib/http.js';
import { requireGm, parseJson } from '../../_lib/gm.js';
import { loadStt, readLines } from '../../_lib/stt.js';
import { makeClient, callSeat } from '../../_lib/assist/claude.js';
import { SEATS } from '../../_lib/assist/seats.js';
import { DEFAULT_CAP, budgetTier, canRun, decide } from '../../_lib/assist/conductor.js';
import { toCandidate, merge, CARD_GAP_MS } from '../../_lib/assist/editor.js';

const BODY_MAX = 8 * 1024;
const NIGHT_MS = 12 * 60 * 60 * 1000;      // "tonight" is the last 12 hours of the log
const LAST_RUN_MS = 60 * 60 * 1000;        // cooldowns look back an hour at most
const RECENT_CARD_MS = 10 * 60 * 1000;     // shown cards that can still make a new one a repeat
const TAP_WINDOW_MS = 4 * 60 * 1000;       // the Tap seats read this much raw talk
const FIT_WINDOW_MS = 5 * 60 * 1000;
const FIRST_SLICE_MS = 60 * 1000;          // no `after`: the Tripwire reads the last minute
const TZ = 'Australia/Melbourne';

// Seats in flight in THIS isolate. Best effort: another isolate does not see it, so the cooldowns (from the log) back it up.
const inFlight = new Set();

const stampFmt = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const hhmm = (ms) => stampFmt.format(new Date(ms)).replace(/^24:/, '00:');
const dollars = (n) => Math.round(n * 10000) / 10000;

function defaultClient(env) {
  const key = env && env.ANTHROPIC_API_KEY;
  if (typeof key !== 'string' || !key) throw new HttpError(503, 'assist is not set up (no API key)');
  return makeClient(key);
}

function capOf(env) {
  const n = env && env.ASSIST_CAP_USD !== undefined ? Number(env.ASSIST_CAP_USD) : NaN;
  return Number.isFinite(n) ? n : DEFAULT_CAP;
}

/** The text a seat reads: "[HH:MM] Name: text" per line, speaker names from the control document. */
export function formatLines(lines, speakers = {}) {
  return lines.filter((l) => l.kind === 'line').map((l) => {
    const who = l.speaker === null || l.speaker === undefined ? '?' : (speakers[String(l.speaker)] || 'S' + l.speaker);
    return '[' + hhmm(Date.parse(l.at)) + '] ' + who + ': ' + l.text;
  }).join('\n');
}

async function loadPrefix(db, campaign) {
  const row = await db.prepare("SELECT body FROM gm_pack WHERE campaign = ?1 AND part = 'assist'").bind(campaign).first();
  const body = row ? parseJson(row.body, null) : null;
  const prefix = body && typeof body.prefix === 'string' ? body.prefix : '';
  const extra = body && body.extra && typeof body.extra === 'object' ? body.extra : {};
  return { prefix, extra, found: !!row };
}

async function tonight(db, campaign, now) {
  const since = new Date(now - NIGHT_MS).toISOString();
  const r = await db.prepare('SELECT COALESCE(SUM(cents), 0) AS cents FROM gm_assist_log WHERE campaign = ?1 AND at >= ?2').bind(campaign, since).first();
  return (r ? r.cents : 0) / 100;
}

async function lastRuns(db, campaign, now) {
  const since = new Date(now - LAST_RUN_MS).toISOString();
  const { results } = await db.prepare('SELECT seat, MAX(at) AS at FROM gm_assist_log WHERE campaign = ?1 AND at >= ?2 GROUP BY seat').bind(campaign, since).all();
  const out = {};
  for (const r of results || []) out[r.seat] = Date.parse(r.at);
  return out;
}

/** The cards the GM was shown in the last 10 minutes: [{ at (ms), keys }]. */
async function shownCards(db, campaign, now) {
  const since = new Date(now - RECENT_CARD_MS).toISOString();
  const { results } = await db.prepare("SELECT at, card FROM gm_assist_log WHERE campaign = ?1 AND at >= ?2 AND json_extract(card, '$.shown') = 1").bind(campaign, since).all();
  return (results || []).map((r) => ({ at: Date.parse(r.at), keys: (parseJson(r.card, {}) || {}).keys || [] }));
}

async function lastShown(db, campaign, now) {
  const since = new Date(now - CARD_GAP_MS).toISOString();
  const r = await db.prepare("SELECT MAX(at) AS at FROM gm_assist_log WHERE campaign = ?1 AND at >= ?2 AND json_extract(card, '$.shown') = 1").bind(campaign, since).first();
  return r && r.at ? Date.parse(r.at) : null;
}

function logRow(db, campaign, { at, session, seat, cfg, usage, cost, flags, card }) {
  const u = usage || {};
  return db.prepare(`INSERT INTO gm_assist_log (campaign, at, session, seat, model, effort, input_tokens, output_tokens, cache_read, cache_write, cents, flags, card)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)`)
    .bind(campaign, at, session || '', seat, cfg.model, cfg.effort || '', u.input_tokens || 0, u.output_tokens || 0,
      u.cache_read_input_tokens || 0, u.cache_creation_input_tokens || 0, (cost || 0) * 100, (flags || []).join(','), card === undefined ? null : JSON.stringify(card));
}

// a short, key-free description of a failed call: the HTTP status when there is one
function errorOf(e) {
  const s = e && Number.isInteger(e.status) ? e.status : null;
  return s ? 'provider status ' + s : 'call failed';
}

export function makeHandler({ clientFor = defaultClient, now = () => Date.now(), call = callSeat, seats = SEATS } = {}) {
  return async function onRequest({ request, env, data }) {
    requireGm(data);                                   // first: before the method, the body or the database
    const action = /\/api\/gm\/assist\/(tick|fit)\/?$/.exec(new URL(request.url).pathname);
    if (!action) throw new HttpError(404, 'not found');
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    const body = await readJsonObject(request, BODY_MAX);
    const db = await getDb(env), campaign = campaignOf(env), t0 = now();
    const client = clientFor(env);
    const cap = capOf(env);
    const spentBefore = await tonight(db, campaign, t0);
    const tier = budgetTier(spentBefore, cap);
    const { prefix, extra, found } = await loadPrefix(db, campaign);
    const warnings = found && prefix ? [] : ['no assist part in the GM pack'];
    const stt = await loadStt(db, campaign);
    const speakers = stt.doc.speakers || {};
    const errors = [];
    let thisTick = 0;

    // one seat call; logging is the caller's job (the Tap rows wait for the Editor's verdict)
    async function run(name, user) {
      const cfg = seats[name];
      inFlight.add(name);
      try {
        const instructions = extra[name] ? cfg.instructions + '\n' + String(extra[name]) : cfg.instructions;
        const r = await call(client, { ...cfg, instructions, prefix, user });
        thisTick += r.cost || 0;
        return { cfg, r };
      } catch (e) {
        errors.push({ seat: name, error: errorOf(e) });
        return { cfg, r: null };
      } finally {
        inFlight.delete(name);
      }
    }
    const spend = () => ({ tonight: dollars(spentBefore + thisTick), cap, tier: budgetTier(spentBefore + thisTick, cap), tick: dollars(thisTick) });
    const done = (cards, flags, last) => json({ cards, flags, spend: spend(), last, ...(warnings.length ? { warnings } : {}), ...(errors.length ? { errors } : {}) });

    if (action[1] === 'fit') {
      const position = typeof body.position === 'string' ? body.position.replace(/\s+/g, ' ').trim() : '';
      const effect = typeof body.effect === 'string' ? body.effect.replace(/\s+/g, ' ').trim() : '';
      if (!position || position.length > 400 || effect.length > 200) throw new HttpError(400, 'position is required (at most 400 characters); effect at most 200');
      const gate = canRun('fixer', { now: t0, lastRun: await lastRuns(db, campaign, t0), inFlight, tier });
      if (!gate.ok) throw new HttpError(429, gate.why === 'budget' ? "tonight's cap is reached" : 'the fixer is busy');
      const { lines, last } = await readLines(db, campaign, { tail: 50 });
      const recent = lines.filter((l) => t0 - Date.parse(l.at) <= FIT_WINDOW_MS);
      const named = 'The GM names the position: ' + position + (effect ? '. Effect: ' + effect : '') + '.';
      const user = 'A roll is about to be made. ' + named + '\nLast five minutes, up to ' + hhmm(t0) + ':\n' + formatLines(recent, speakers);
      const { cfg, r } = await run('fixer', user);
      const at = new Date(now()).toISOString();
      const session = lines.length ? lines[lines.length - 1].session : '';
      const out = r && r.json ? r.json : null;
      await logRow(db, campaign, { at, session, seat: 'fixer', cfg, usage: r && r.usage, cost: r && r.cost, flags: ['fit'], card: out ? { out, shown: 0 } : { error: errors.length ? errors[0].error : 'no JSON' } }).run();
      return done(out ? [{ seat: 'fixer', at, text: out.read, ...out }] : [], [], last);
    }

    // ---- tick ----
    const after = body.after === undefined || body.after === null ? null : body.after;
    if (after !== null && !(Number.isInteger(after) && after >= 0)) throw new HttpError(400, 'after must be a whole number');
    const { lines: tail, last } = await readLines(db, campaign, { tail: 50 });
    const session = tail.length ? tail[tail.length - 1].session : '';
    if (tier === 'off') return done([], [], last);
    const fresh = after !== null ? tail.filter((l) => l.seq > after) : tail.filter((l) => t0 - Date.parse(l.at) <= FIRST_SLICE_MS);
    const freshText = formatLines(fresh, speakers);
    if (!freshText) return done([], [], last);

    const lastRun = await lastRuns(db, campaign, t0);
    const gate = canRun('tripwire', { now: t0, lastRun, inFlight, tier });
    if (!gate.ok) return done([], [], last);
    const tw = await run('tripwire', 'New talk, up to ' + hhmm(t0) + ':\n' + freshText);
    const twAt = new Date(now()).toISOString();
    const flags = tw.r && tw.r.json ? Object.keys(tw.r.json).filter((k) => tw.r.json[k] === true) : [];
    await logRow(db, campaign, { at: twAt, session, seat: 'tripwire', cfg: tw.cfg, usage: tw.r && tw.r.usage, cost: tw.r && tw.r.cost, flags,
      card: tw.r ? { out: tw.r.json } : { error: errors.length ? errors[0].error : 'no reply' } }).run();
    if (!flags.length) return done([], flags, last);

    const verdict = decide({ flags, now: t0, lastRun, inFlight, spent: spentBefore + thisTick, cap });
    if (!verdict.seats.length) return done([], flags, last);

    const recentText = formatLines(tail.filter((l) => t0 - Date.parse(l.at) <= TAP_WINDOW_MS), speakers);
    const user = 'Last four minutes, up to ' + hhmm(t0) + ':\n' + recentText;
    const results = await Promise.all(verdict.seats.map(async (name) => ({ name, ...(await run(name, user)) })));

    const recent = await shownCards(db, campaign, t0);
    const candidates = results.map((x) => (x.r ? toCandidate(x.name, x.r.json, { recent, now: t0 }) : null));
    const edit = merge(candidates, { now: t0, lastShownAt: await lastShown(db, campaign, t0) });
    const at = new Date(now()).toISOString();
    const rows = results.map((x, i) => {
      const cand = candidates[i];
      const shown = !!(edit.card && cand && edit.card.seat === x.name);
      const card = x.r ? { out: x.r.json, text: cand ? cand.text : '', keys: cand ? cand.keys : [], shown: shown ? 1 : 0 } : { error: errors.find((e) => e.seat === x.name)?.error || 'no reply' };
      return logRow(db, campaign, { at, session, seat: x.name, cfg: x.cfg, usage: x.r && x.r.usage, cost: x.r && x.r.cost, flags, card });
    });
    await db.batch(rows);
    return done(edit.card ? [{ seat: edit.card.seat, at, text: edit.card.text, ...(edit.card.detail ? { detail: edit.card.detail } : {}) }] : [], flags, last);
  };
}

export const onRequest = makeHandler();
