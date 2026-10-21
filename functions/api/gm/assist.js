// /api/gm/assist/{tick,fit} (GM only, see the "Claude at the table" build plan): Claude at the table, GM side. Players never
// call it and nothing it returns reaches the iPad. A player (or the table display sign-in) gets 403 before the body is read.
//   POST /api/gm/assist/tick { after?, npc? } -> { cards, updates, flags, spend, last, voice?, errors? }
//        `npc` is the name of the NPC the GM's page has on stage (at most 80 characters; the Worker holds no scene, so the page
//        says). With none, Voice never runs. With one, Voice wakes on the Tripwire's npc_change flag and on every tick (about each
//        minute), after Ref in the list, and its lines come back as `voice: { who, want, lines: [two], at }` (they go to the
//        page's Rack, not the card slot); the Editor drops a line already shown in the last 10 minutes. Voice is not in the
//        Core set, so it stops at 85% of the cap. Its row is logged like any seat's, with `voice: 1` when lines were shown.
//        Stall wakes on the Tripwire's stall flag (cooldown 5 minutes) and answers as `stall: { kind, offer, why, at }` when the table
//        is stalled and the offer is new; it goes to the Rack beside Voice, never the card slot. Like Voice it stops at 85% of the cap.
//        The Showrunner runs on every tick that has new talk, paced to one run per 10 minutes by its cooldown (it reads the last 20
//        minutes of talk); the Mystery keeper runs on the clue_mention flag, at most every 15 minutes (it reads the last 15 minutes plus
//        its own earlier "known" list from the log). Both are dropped at 60% of the cap, before Ref is. Their output goes through the
//        Editor as card candidates behind Ref and Clerk, so the one-card-per-five-minutes gap holds for every seat together; a card the
//        gap holds back is dropped, not queued. The Mystery card's push-next must name a Must land entry (must_land_item): the Worker
//        does not hold the prefix, so the seat's instructions carry the rule and the Editor drops a card that names no entry.
//        The Mystery keeper may also name a handout: the answer then carries `handout: { id, why, at }`, a separate field that never takes the
//        card slot. The id must be in the live `handouts` pack part (read from D1 only when the seat named one, and only if the part is
//        under 16 KB); anything else is dropped. The GM's page offers it in the Rack; the GM's tap is what shows it.
//   POST /api/gm/assist/another { npc, shown: [..] } -> { cards: [], voice: { who, lines: [one], at }, spend, last }
//        The Another tap on a Voice line: the voice_plus seat writes ONE more line for the same NPC, different from the 1-6 shown
//        lines (each at most 400 characters). 400 on a bad body; 429 at the cap or while a voice_plus call is in flight or cooling
//        down. Like /fit it runs at the Core tier, so it stays available until the cap.
//        The GM page calls it about once a minute while Listening is on. It reads the transcript lines newer than seq `after`
//        (the last minute when omitted), runs the Tripwire on them, asks the Conductor which seats to wake, runs those, and
//        lets the Editor pass at most one card (Ref beats Clerk) per five minutes. `cards` is [] on most ticks. A Ref card held
//        back by that gap stays pending (in the log) and shows at the next opportunity unless it is over four minutes old.
//        `updates` are the Ledger's entries (stress, harm, Heat, xp...), one-tap state updates outside the card gap:
//        [{ seat: 'ledger', at, key, text }].
//        The Tap seats read the last four MINUTES of talk (not a fixed count of lines).
//   POST /api/gm/assist/fit { position, effect?, dots?, draws: { low, mid } } -> { cards: [fixer card], flags: [], spend, last }
//        The Fixer for a position the GM names. `draws` are the console's OWN pre-rolled 1-3 and 4-5 cards (plain text, at most
//        1500 characters each); the Fixer fits them to the scene (it keeps the kind of outcome each names) and writes the 6, the
//        crit and a Devil's Bargain. `dots` (optional, a whole number 0-4) is the dice the GM has set for the roll; anything else is a 400, and
//        a request without it behaves as before. A request without draws (an old client) is a 400: there is no free-writing fallback.
//        Every seat call's row carries `secs` (wall-clock) and `stop` (the provider's stop reason) in its card JSON; a refusal
//        is logged as `refusal: 1` and shows nothing.
//   POST /api/gm/assist/gatekeeper { kind: portrait|prop|wire|board|card, text, cites? } -> { verdict, unknown, reasons, revealed, rule, cites_bad, spend }
//        The gatekeeper checks one item bound for the players' screen against the never-reveal block of the prefix, the GM's rule
//        (no decided outcomes, no player character narrated) and its shape. text is 1-1500 characters, cites at most 8 strings of 60;
//        anything else is a 400. It runs at the Core tier (to the cap, like Ref), one at a time: 429 at the cap or while busy. It
//        fails closed: no assist part, a refusal, a cut-off reply or no JSON is { verdict: 'block', unknown: true }. A bad page cite
//        is flagged in cites_bad and never blocks. The GM's tap is still needed either way. Logged like any seat (secs, stop, refusal).
//   GET  /api/gm/assist/cards?session=&since= -> { cards, updates }   tonight's shown cards and open Ledger updates (last 12 h unless
//        `since`), so a reloaded GM page restores its chat. Dismissed cards and finished updates are left out. No model, no key.
//   POST /api/gm/assist/cards { op: 'seen'|'dismiss'|'keep', items: [{ at, text, key? }] } -> { marked }   the box's marks, kept on the
//        log row (functions/_lib/assist/cards.js). A card is shown once (`shown: 1` on its row); the log is also what gm:after files.
//   card: { seat, at (ISO), text }, plus the Fixer's { read, one_three, four_five, six, crit, bargain }
//   spend: { tonight, cap, tier, tick } in dollars; tier is all | reduced | core | off (the badge says so when it is off)
// Every call is logged to gm_assist_log (seat, model, effort, tokens, cents, flags, the card): that table IS the cost meter and
// the Conductor's memory, because a Worker keeps nothing between requests. The key is the Worker secret ANTHROPIC_API_KEY;
// it is never logged and never returned. Errors reach the caller as a short status, never the provider's message or the key.
//
// The cached prefix (rules digest, campaign, prep) is NOT in the Worker. The GM pack part `assist` is small:
// { file_id, hash, extra?: { <seat>: string } }, and file_id names the prefix as a text file in Anthropic's Files API, uploaded
// by the GM's PC when it pushes the part (scripts/lib/assist-file.mjs, scripts/lib/sync-pack.mjs). Why a file: Workers Free
// gives a request 10 ms of CPU, and reading, parsing and re-sending a ~90k-token prefix in every seat call (waiting on
// Claude or D1 is free; parsing and stringifying are not) would spend it. Now a tick reads a few hundred bytes and every seat
// call carries the file id. The prefix quotes the campaign, so it is never in git or in D1.
// Warnings (in the answer, never the provider's own message): 'no assist part in the GM pack' (no part: the seats run without
// a prefix); 're-push the assist part' when the part still carries prefix text (old format: nothing is sent and the box stays
// quiet) or the provider says the file is gone.
//
// A seat call can take 15-30 s (the Fixer). That is wall-clock waiting on the provider, which Workers do not bill as CPU.
//
// The Scribe's rolling "story so far" is Phase 2: the Tap seats read the last four minutes raw for now.

import { getDb } from '../../_lib/db.js';
import { HttpError, json, methodNotAllowed, readJsonObject, campaignOf } from '../../_lib/http.js';
import { requireGm, parseJson } from '../../_lib/gm.js';
import { loadStt, readLines } from '../../_lib/stt.js';
import { makeClient, callSeat } from '../../_lib/assist/claude.js';
import { SEATS, WAKES } from '../../_lib/assist/seats.js';
import { cleanItem, verdictOf, unknownVerdict } from '../../_lib/assist/gatekeeper.js';
import { gatekeeperUser, ITEM_MAX, fitUser, voiceUser, anotherUser, showrunnerUser, mysteryUser, NPC_MAX, SHOWN_MAX, SHOWN_LINE_MAX, SHOWRUNNER_MIN, MYSTERY_MIN, KNOWN_MAX, KNOWN_ITEM_MAX } from '../../_lib/assist/prompts.js';
import { DEFAULT_CAP, budgetTier, canRun, decide, followsThrough, FOLLOW_WINDOW_MS } from '../../_lib/assist/conductor.js';
import { toCandidate, toVoice, toAnother, toStall, toHandout, handoutIds, merge, pendingRefs, CARD_GAP_MS, STALE_MS } from '../../_lib/assist/editor.js';
import { nightCards, markCards, cleanMarks, OPS } from '../../_lib/assist/cards.js';

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
const stampMemo = new Map();        // one formatted stamp per minute: a long window of talk would otherwise format every line
const hhmm = (ms) => {
  const m = Math.floor(ms / 60000);
  let v = stampMemo.get(m);
  if (v === undefined) { v = stampFmt.format(new Date(m * 60000)).replace(/^24:/, '00:'); if (stampMemo.size > 200) stampMemo.clear(); stampMemo.set(m, v); }
  return v;
};
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

/** The dots in a fit request: undefined when absent, a whole number 0-4, or null when it is anything else. */
export function cleanDots(v) {
  if (v === undefined) return undefined;
  return Number.isInteger(v) && v >= 0 && v <= 4 ? v : null;
}

export const DRAW_MAX = 1500;                 // characters per draw
/** The console's two draws from a fit request: { low, mid } as trimmed text, or null when they are missing or over-long. */
export function cleanDraws(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
  const out = {};
  for (const k of ['low', 'mid']) {
    if (typeof d[k] !== 'string') return null;
    const t = d[k].replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
    if (!t || t.length > DRAW_MAX) return null;
    out[k] = t;
  }
  return out;
}

/** The on-stage NPC's name the page sends: '' when none; null when it is not a short string. */
export function cleanNpc(v) {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t.length > NPC_MAX ? null : t;
}
/** The lines Another must differ from: 1-6 trimmed strings of at most 400 characters, or null. */
export function cleanShown(v) {
  if (!Array.isArray(v) || !v.length || v.length > SHOWN_MAX) return null;
  const out = [];
  for (const x of v) {
    if (typeof x !== 'string') return null;
    const t = x.replace(/\s+/g, ' ').trim();
    if (!t || t.length > SHOWN_LINE_MAX) return null;
    out.push(t);
  }
  return out;
}

const REPUSH = 're-push the assist part';
const FILE_ID = /^file_[A-Za-z0-9_-]{4,100}$/;

const HANDOUTS_MAX_BYTES = 16 * 1024;           // the handouts part is a short list; a bigger one is not read here

/** The ids in the live handouts part (a Set; empty when there is none or it is too big to be the short list it should be). */
async function liveHandoutIds(db, campaign) {
  const row = await db.prepare("SELECT CASE WHEN LENGTH(CAST(body AS BLOB)) <= ?2 THEN body END AS body FROM gm_pack WHERE campaign = ?1 AND part = 'handouts'").bind(campaign, HANDOUTS_MAX_BYTES).first();
  return handoutIds(row && row.body ? parseJson(row.body, null) : null);
}

async function loadPrefix(db, campaign) {
  const row = await db.prepare("SELECT body FROM gm_pack WHERE campaign = ?1 AND part = 'assist'").bind(campaign).first();
  const body = row ? parseJson(row.body, null) : null;
  const fileId = body && typeof body.file_id === 'string' && FILE_ID.test(body.file_id) ? body.file_id : '';
  const legacy = !!(body && typeof body.prefix === 'string' && body.prefix);   // the old part carried the text: never sent
  const extra = body && body.extra && typeof body.extra === 'object' ? body.extra : {};
  return { fileId, legacy, extra, found: !!row };
}

// the provider says the file named in the prompt is gone (404 / not found / invalid file id)
function fileGone(e) {
  const s = e && Number.isInteger(e.status) ? e.status : null;
  if (s === 404) return true;
  return s === 400 && /file/i.test(String((e && e.message) || ''));
}

async function tonight(db, campaign, now) {
  const since = new Date(now - NIGHT_MS).toISOString();
  const r = await db.prepare('SELECT COALESCE(SUM(cents), 0) AS cents FROM gm_assist_log WHERE campaign = ?1 AND at >= ?2').bind(campaign, since).first();
  return (r ? r.cents : 0) / 100;
}

// the previous tick's Tripwire row (its flags), for the Ref follow-through
async function prevTripwire(db, campaign, now) {
  const since = new Date(now - FOLLOW_WINDOW_MS).toISOString();
  const r = await db.prepare("SELECT at, flags FROM gm_assist_log WHERE campaign = ?1 AND at >= ?2 AND seat = 'tripwire' ORDER BY id DESC LIMIT 1").bind(campaign, since).first();
  return r ? { at: Date.parse(r.at), flags: String(r.flags || '').split(',').filter(Boolean) } : null;
}

async function lastRuns(db, campaign, now) {
  const since = new Date(now - LAST_RUN_MS).toISOString();
  const { results } = await db.prepare('SELECT seat, MAX(at) AS at FROM gm_assist_log WHERE campaign = ?1 AND at >= ?2 GROUP BY seat').bind(campaign, since).all();
  const out = {};
  for (const r of results || []) out[r.seat] = Date.parse(r.at);
  return out;
}

/** The cards and ledger updates the GM was shown in the last 10 minutes: [{ at (ms), keys }]. */
async function shownCards(db, campaign, now) {
  const since = new Date(now - RECENT_CARD_MS).toISOString();
  const { results } = await db.prepare("SELECT at, card FROM gm_assist_log WHERE campaign = ?1 AND at >= ?2 AND (json_extract(card, '$.shown') = 1 OR json_extract(card, '$.update') = 1)").bind(campaign, since).all();
  return (results || []).map((r) => ({ at: Date.parse(r.at), keys: (parseJson(r.card, {}) || {}).keys || [] }));
}

/** Rack items shown in the last 10 minutes (Voice, Another and Stall rows): [{ at (ms), keys }]. */
async function shownVoice(db, campaign, now) {
  const since = new Date(now - RECENT_CARD_MS).toISOString();
  const { results } = await db.prepare("SELECT at, card FROM gm_assist_log WHERE campaign = ?1 AND at >= ?2 AND (json_extract(card, '$.voice') = 1 OR json_extract(card, '$.stall') = 1)").bind(campaign, since).all();
  return (results || []).map((r) => ({ at: Date.parse(r.at), keys: (parseJson(r.card, {}) || {}).keys || [] }));
}

/** What the Mystery keeper last reported as known (within tonight): a short list of strings, so it need not re-read the whole night. */
async function lastKnown(db, campaign, now) {
  const since = new Date(now - NIGHT_MS).toISOString();
  const r = await db.prepare("SELECT card FROM gm_assist_log WHERE campaign = ?1 AND at >= ?2 AND seat = 'mystery' AND card IS NOT NULL ORDER BY id DESC LIMIT 1").bind(campaign, since).first();
  const out = r ? (parseJson(r.card, {}) || {}).out : null;
  const known = out && Array.isArray(out.known) ? out.known : [];
  return known.filter((k) => typeof k === 'string' && k.trim()).slice(0, KNOWN_MAX).map((k) => k.replace(/\s+/g, ' ').trim().slice(0, KNOWN_ITEM_MAX));
}

/** Ref cards the Editor held back and that are not stale yet: [{ at (ms), card }]. */
async function heldRefs(db, campaign, now) {
  const since = new Date(now - STALE_MS).toISOString();
  const { results } = await db.prepare("SELECT at, card FROM gm_assist_log WHERE campaign = ?1 AND at >= ?2 AND seat = 'ref' AND json_extract(card, '$.held') = 1 ORDER BY id").bind(campaign, since).all();
  return (results || []).map((r) => ({ at: Date.parse(r.at), card: parseJson(r.card, null) }));
}

/** The latest Ref card shown in the last five minutes (its own row, or the Editor's row for a held one released later). */
async function lastRefShown(db, campaign, now) {
  const since = new Date(now - CARD_GAP_MS).toISOString();
  const r = await db.prepare("SELECT MAX(at) AS at FROM gm_assist_log WHERE campaign = ?1 AND at >= ?2 AND json_extract(card, '$.shown') = 1 AND (seat = 'ref' OR json_extract(card, '$.seat') = 'ref')").bind(campaign, since).first();
  return r && r.at ? Date.parse(r.at) : null;
}

async function lastShown(db, campaign, now) {
  const since = new Date(now - CARD_GAP_MS).toISOString();
  const r = await db.prepare("SELECT MAX(at) AS at FROM gm_assist_log WHERE campaign = ?1 AND at >= ?2 AND json_extract(card, '$.shown') = 1").bind(campaign, since).first();
  return r && r.at ? Date.parse(r.at) : null;
}

// `timing` is { secs, stop }: the call's wall-clock seconds and the provider's stop reason. They go into the card JSON of every
// seat call (no column, no migration). A refusal is recorded as `refusal: 1` and is never shown.
function logRow(db, campaign, { at, session, seat, cfg, usage, cost, flags, card, timing }) {
  const u = usage || {};
  if (card && typeof card === 'object' && timing) {
    card = { ...card, secs: timing.secs, ...(timing.stop ? { stop: timing.stop } : {}), ...(timing.stop === 'refusal' ? { refusal: 1, shown: 0 } : {}), ...(timing.stop === 'max_tokens' ? { truncated: 1, shown: 0 } : {}) };
  }
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

export function makeHandler({ clientFor = defaultClient, now = () => Date.now(), call = callSeat, seats = SEATS, wakes = WAKES } = {}) {
  return async function onRequest({ request, env, data }) {
    requireGm(data);                                   // first: before the method, the body or the database
    const url = new URL(request.url);
    const action = /\/api\/gm\/assist\/(tick|fit|another|gatekeeper|cards)\/?$/.exec(url.pathname);
    if (!action) throw new HttpError(404, 'not found');
    if (action[1] === 'cards') {                       // the box's memory: no key, no model
      if (request.method === 'GET') {
        const since = url.searchParams.get('since'), session = url.searchParams.get('session');
        if (since !== null && (since.length > 40 || Number.isNaN(Date.parse(since)))) throw new HttpError(400, 'since must be a date');
        if (session !== null && session.length > 20) throw new HttpError(400, 'session is too long');
        const out = await nightCards(await getDb(env), campaignOf(env), { now: now(), ...(since !== null ? { since: new Date(since).toISOString() } : {}), ...(session ? { session } : {}) });
        return json({ cards: out.cards, updates: out.updates });
      }
      if (request.method !== 'POST') return methodNotAllowed(['GET', 'POST']);
      const b = await readJsonObject(request, BODY_MAX);
      const items = cleanMarks(b.items);
      if (!OPS.includes(b.op) || !items) throw new HttpError(400, 'op is seen, dismiss or keep, with 1-50 items { at, text }');
      return json({ marked: await markCards(await getDb(env), campaignOf(env), b.op, items) });
    }
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    const body = await readJsonObject(request, BODY_MAX);
    const gateItem = action[1] === 'gatekeeper' ? cleanItem(body) : null;      // checked before the database or the key are touched
    if (gateItem && !gateItem.ok) throw new HttpError(400, gateItem.why);
    const db = await getDb(env), campaign = campaignOf(env), t0 = now();
    const client = clientFor(env);
    const cap = capOf(env);
    const spentBefore = await tonight(db, campaign, t0);
    const tier = budgetTier(spentBefore, cap);
    const { fileId, legacy, extra, found } = await loadPrefix(db, campaign);
    const warnings = legacy ? [REPUSH] : found && fileId ? [] : ['no assist part in the GM pack'];
    const stt = await loadStt(db, campaign);
    const speakers = stt.doc.speakers || {};
    const errors = [];
    let thisTick = 0, fileMissing = false;

    // one seat call; logging is the caller's job (the Tap rows wait for the Editor's verdict)
    async function run(name, user) {
      const cfg = seats[name];
      inFlight.add(name);
      const started = now();
      const secs = () => Math.round(Math.max(0, now() - started) / 100) / 10;
      try {
        const instructions = extra[name] ? cfg.instructions + '\n' + String(extra[name]) : cfg.instructions;
        const r = await call(client, { ...cfg, instructions, prefixFileId: fileId, user });
        thisTick += r.cost || 0;
        if (r.stop === 'refusal' || r.stop === 'max_tokens') r.json = null;     // a refusal or a reply cut off at the limit shows nothing, never a half card; the row records it
        return { cfg, r, timing: { secs: secs(), stop: typeof r.stop === 'string' ? r.stop : '' } };
      } catch (e) {
        if (fileId && fileGone(e)) { fileMissing = true; if (!warnings.includes(REPUSH)) warnings.push(REPUSH); }
        else errors.push({ seat: name, error: errorOf(e) });
        return { cfg, r: null, timing: { secs: secs(), stop: '' } };
      } finally {
        inFlight.delete(name);
      }
    }
    const spend = () => ({ tonight: dollars(spentBefore + thisTick), cap, tier: budgetTier(spentBefore + thisTick, cap), tick: dollars(thisTick) });
    const done = (cards, flags, last, updates = [], more = {}) => json({ cards, updates, flags, spend: spend(), last, ...(more.voice ? { voice: more.voice } : {}), ...(more.stall ? { stall: more.stall } : {}), ...(more.handout ? { handout: more.handout } : {}), ...(warnings.length ? { warnings } : {}), ...(errors.length ? { errors } : {}) });

    if (action[1] === 'gatekeeper') {
      const item = gateItem.item;
      const gate = canRun('gatekeeper', { now: t0, lastRun: {}, inFlight, tier });
      if (!gate.ok) throw new HttpError(429, gate.why === 'budget' ? "tonight's cap is reached" : 'the gatekeeper is busy');
      const bare = (v) => json({ ...v, spend: spend(), ...(warnings.length ? { warnings } : {}) });
      // no prefix means no never-reveal list to check against: that is a block, never a pass
      if (legacy || !fileId) return bare(unknownVerdict(legacy ? REPUSH : 'no assist part: nothing to check the item against'));
      const { cfg, r, timing } = await run('gatekeeper', gatekeeperUser(item));
      const at = new Date(now()).toISOString();
      const v = r ? verdictOf(r.json, r.stop) : unknownVerdict(fileMissing ? REPUSH : 'the gatekeeper could not be reached');
      if (fileMissing) return bare(v);                         // nothing was billed or logged: the file is gone
      await logRow(db, campaign, { at, session: '', seat: 'gatekeeper', cfg, usage: r && r.usage, cost: r && r.cost, flags: ['gatekeeper'], timing,
        card: { out: r ? r.json : null, verdict: v.verdict, unknown: v.unknown ? 1 : 0, kind: item.kind, text: item.text.slice(0, ITEM_MAX), shown: 0,
          ...(!r ? { error: errors.length ? errors[0].error : 'no reply' } : {}) } }).run();
      return json({ ...v, spend: spend(), ...(warnings.length ? { warnings } : {}), ...(errors.length ? { errors } : {}) });
    }

    if (action[1] === 'fit') {
      const position = typeof body.position === 'string' ? body.position.replace(/\s+/g, ' ').trim() : '';
      const effect = typeof body.effect === 'string' ? body.effect.replace(/\s+/g, ' ').trim() : '';
      if (!position || position.length > 400 || effect.length > 200) throw new HttpError(400, 'position is required (at most 400 characters); effect at most 200');
      const dots = cleanDots(body.dots);
      if (dots === null) throw new HttpError(400, 'dots must be a whole number from 0 to 4');
      const draws = cleanDraws(body.draws);                // no fallback: a client without the console's draws gets a 400
      if (!draws) throw new HttpError(400, 'draws is required: { low, mid }, each a text of at most ' + DRAW_MAX + ' characters');
      if (legacy) return done([], [], null);
      const gate = canRun('fixer', { now: t0, lastRun: await lastRuns(db, campaign, t0), inFlight, tier });
      if (!gate.ok) throw new HttpError(429, gate.why === 'budget' ? "tonight's cap is reached" : 'the fixer is busy');
      const { lines: recent, last } = await readLines(db, campaign, { since: new Date(t0 - FIT_WINDOW_MS).toISOString() });
      const lines = recent;
      const user = fitUser({ position, effect, ...(dots !== undefined ? { dots } : {}), draws, stamp: hhmm(t0), talk: formatLines(recent, speakers) });
      const { cfg, r, timing } = await run('fixer', user);
      const at = new Date(now()).toISOString();
      const session = lines.length ? lines[lines.length - 1].session : '';
      const out = r && r.json ? r.json : null;
      await logRow(db, campaign, { at, session, seat: 'fixer', cfg, usage: r && r.usage, cost: r && r.cost, flags: ['fit'], timing,
        card: out ? { out, shown: 0, draws } : { error: errors.length ? errors[0].error : r && r.stop === 'refusal' ? 'refusal' : 'no JSON', draws } }).run();
      return done(out ? [{ seat: 'fixer', at, text: out.read, ...out }] : [], [], last);
    }

    if (action[1] === 'another') {
      const npc = cleanNpc(body.npc), shown = cleanShown(body.shown);
      if (!npc) throw new HttpError(400, 'npc is required (at most ' + NPC_MAX + ' characters)');
      if (!shown) throw new HttpError(400, 'shown is required: 1-' + SHOWN_MAX + ' lines, each at most ' + SHOWN_LINE_MAX + ' characters');
      if (legacy) return done([], [], null);
      const gate = canRun('voice_plus', { now: t0, lastRun: await lastRuns(db, campaign, t0), inFlight, tier });
      if (!gate.ok) throw new HttpError(429, gate.why === 'budget' ? "tonight's cap is reached" : 'the voice coach is busy');
      const { lines: recent, last } = await readLines(db, campaign, { since: new Date(t0 - TAP_WINDOW_MS).toISOString() });
      const user = anotherUser({ npc, shown, stamp: hhmm(t0), talk: formatLines(recent, speakers) });
      const { cfg, r, timing } = await run('voice_plus', user);
      const at = new Date(now()).toISOString();
      const session = recent.length ? recent[recent.length - 1].session : '';
      const out = r && r.json ? r.json : null;
      const one = toAnother(out, shown);
      await logRow(db, campaign, { at, session, seat: 'voice_plus', cfg, usage: r && r.usage, cost: r && r.cost, flags: ['another'], timing,
        card: out ? { out, ...(one ? { voice: 1, text: one.line, keys: one.keys } : {}) } : { error: errors.length ? errors[0].error : r && r.stop === 'refusal' ? 'refusal' : 'no JSON' } }).run();
      return done([], [], last, [], one ? { voice: { who: one.who || npc, lines: [one.line], at } } : {});
    }

    // ---- tick ----
    const npc = cleanNpc(body.npc);
    if (npc === null) throw new HttpError(400, 'npc must be a name of at most ' + NPC_MAX + ' characters');
    const after = body.after === undefined || body.after === null ? null : body.after;
    if (after !== null && !(Number.isInteger(after) && after >= 0)) throw new HttpError(400, 'after must be a whole number');
    // the Tap seats read the last four MINUTES (a busy table says well over 50 lines in four); the Tripwire reads what is new
    const { lines: tail, last } = await readLines(db, campaign, { since: new Date(t0 - TAP_WINDOW_MS).toISOString() });
    const session = tail.length ? tail[tail.length - 1].session : '';
    if (tier === 'off' || legacy) return done([], [], last);
    const fresh = after !== null ? (await readLines(db, campaign, { after })).lines : tail.filter((l) => t0 - Date.parse(l.at) <= FIRST_SLICE_MS);
    const freshText = formatLines(fresh, speakers);
    if (!freshText) return done([], [], last);

    const lastRun = await lastRuns(db, campaign, t0);
    const gate = canRun('tripwire', { now: t0, lastRun, inFlight, tier });
    if (!gate.ok) return done([], [], last);
    const prev = await prevTripwire(db, campaign, t0);            // read before this tick's own Tripwire row is written
    const tw = await run('tripwire', 'New talk, up to ' + hhmm(t0) + ':\n' + freshText);
    if (fileMissing) return done([], [], last);          // nothing was billed or logged: the file is gone
    const twAt = new Date(now()).toISOString();
    const flags = tw.r && tw.r.json ? Object.keys(tw.r.json).filter((k) => tw.r.json[k] === true) : [];
    await logRow(db, campaign, { at: twAt, session, seat: 'tripwire', cfg: tw.cfg, usage: tw.r && tw.r.usage, cost: tw.r && tw.r.cost, flags, timing: tw.timing,
      card: tw.r ? { out: tw.r.json } : { error: errors.length ? errors[0].error : 'no reply' } }).run();

    // 'tick' wakes the Showrunner, paced by its 10-minute cooldown; with nothing else woken a tick costs no model call
    const verdict = decide({ flags: flags.concat('tick'), now: t0, lastRun, inFlight, spent: spentBefore + thisTick, cap, wakes, onStage: !!npc, follow: followsThrough(prev, t0) });
    // a quiet tick still releases a Ref card the gap held back (one cheap read, only when no seat woke): without it a slip held behind
    // another seat's card would go stale before any flag woke a seat again
    let held = null;
    if (!verdict.seats.length) {
      held = await heldRefs(db, campaign, t0);
      if (!held.length) return done([], flags, last);
    }

    const recentText = formatLines(tail, speakers);
    const user = 'Last four minutes, up to ' + hhmm(t0) + ':\n' + recentText;
    const voiceTurn = voiceUser({ npc, stamp: hhmm(t0), talk: recentText });
    // Showrunner and Mystery read a longer stretch than the Tap's four minutes (the Worker cannot afford the whole night): one read serves both
    const turns = {};
    if (verdict.seats.includes('showrunner') || verdict.seats.includes('mystery')) {
      const wide = (await readLines(db, campaign, { since: new Date(t0 - SHOWRUNNER_MIN * 60 * 1000).toISOString() })).lines;
      if (verdict.seats.includes('showrunner')) turns.showrunner = showrunnerUser({ stamp: hhmm(t0), talk: formatLines(wide, speakers) });
      if (verdict.seats.includes('mystery')) {
        const from = t0 - MYSTERY_MIN * 60 * 1000;
        turns.mystery = mysteryUser({ stamp: hhmm(t0), talk: formatLines(wide.filter((l) => Date.parse(l.at) >= from), speakers), known: await lastKnown(db, campaign, t0) });
      }
    }
    const all = await Promise.all(verdict.seats.map(async (name) => ({ name, ...(await run(name, name === 'voice' ? voiceTurn : turns[name] || user)) })));
    // Voice and Stall go to the Rack, not to the Editor's card slot
    const vx = all.find((x) => x.name === 'voice'), sx = all.find((x) => x.name === 'stall'), results = all.filter((x) => x.name !== 'voice' && x.name !== 'stall');

    const recent = await shownCards(db, campaign, t0);
    const candidates = results.map((x) => (x.r ? toCandidate(x.name, x.r.json, { recent, now: t0 }) : null));
    // a Ref card held back earlier waits in the log; it competes with this tick's own until it goes stale
    const pending = pendingRefs(held || await heldRefs(db, campaign, t0), { recent, now: t0 });
    const edit = merge(candidates.concat(pending), { now: t0, lastShownAt: await lastShown(db, campaign, t0), lastRefShownAt: await lastRefShown(db, campaign, t0) });
    const at = new Date(now()).toISOString();
    // a handout suggestion from the Mystery keeper: checked against the live handouts part (one small read, only when the seat named one), and
    // sent in its own field so it never takes the card slot
    const mx = all.find((x) => x.name === 'mystery');
    let handoutOut = null;
    if (mx && mx.r && mx.r.json && typeof mx.r.json.handout_id === 'string' && mx.r.json.handout_id.trim()) {
      const h = toHandout(mx.r.json, await liveHandoutIds(db, campaign));
      if (h) handoutOut = { ...h, at };
    }
    const rows = results.map((x, i) => {
      const cand = candidates[i];
      const isShown = !!(cand && !cand.pending && edit.card && edit.card.seat === x.name && edit.card.text === cand.text);
      const held = !!(cand && cand.seat === 'ref' && edit.held.includes(cand));
      const isUpdate = !!(cand && cand.seat === 'ledger');
      const card = x.r ? { out: x.r.json, text: cand ? cand.text : '', keys: cand ? cand.keys : [], shown: isShown ? 1 : 0, ...(held ? { held: 1 } : {}), ...(cand && cand.detail ? { detail: cand.detail } : {}), ...(isUpdate ? { update: 1, items: cand.items } : {}), ...(x.name === 'mystery' && handoutOut ? { handout: { id: handoutOut.id, why: handoutOut.why } } : {}) } : { error: errors.find((e) => e.seat === x.name)?.error || 'no reply' };
      return logRow(db, campaign, { at, session, seat: x.name, cfg: x.cfg, usage: x.r && x.r.usage, cost: x.r && x.r.cost, flags, card, timing: x.timing });
    });
    // a pending Ref card shown now has no row of its own this tick: record the showing (no cost) so the gap and repeats see it
    if (edit.card && edit.card.pending) rows.push(logRow(db, campaign, { at, session, seat: 'editor', cfg: { model: 'editor' }, flags, card: { seat: 'ref', text: edit.card.text, keys: edit.card.keys, ...(edit.card.detail ? { detail: edit.card.detail } : {}), shown: 1, from_pending: 1 } }));
    let voiceOut = null;
    if (vx) {
      const v = vx.r ? toVoice(vx.r.json, { recent: await shownVoice(db, campaign, t0), now: t0 }) : null;
      if (v) voiceOut = { who: v.who, want: v.want, lines: v.lines, at };
      rows.push(logRow(db, campaign, { at, session, seat: 'voice', cfg: vx.cfg, usage: vx.r && vx.r.usage, cost: vx.r && vx.r.cost, flags, timing: vx.timing,
        card: vx.r ? { out: vx.r.json, ...(v ? { voice: 1, text: v.lines.join(' / '), keys: v.keys } : {}) } : { error: errors.find((e) => e.seat === 'voice')?.error || 'no reply' } }));
    }
    let stallOut = null;
    if (sx) {
      const st = sx.r ? toStall(sx.r.json, { recent: await shownVoice(db, campaign, t0), now: t0 }) : null;
      if (st) stallOut = { kind: st.kind, offer: st.offer, why: st.why, at };
      rows.push(logRow(db, campaign, { at, session, seat: 'stall', cfg: sx.cfg, usage: sx.r && sx.r.usage, cost: sx.r && sx.r.cost, flags, timing: sx.timing,
        card: sx.r ? { out: sx.r.json, ...(st ? { stall: 1, text: st.offer, keys: st.keys } : {}) } : { error: errors.find((e) => e.seat === 'stall')?.error || 'no reply' } }));
    }
    if (rows.length) await db.batch(rows);
    const cardOut = edit.card ? [{ seat: edit.card.seat, at, text: edit.card.text, ...(edit.card.detail ? { detail: edit.card.detail } : {}) }] : [];
    const updatesOut = edit.updates.flatMap((u) => (u.items || [{ key: (u.keys || [])[0] || '', text: u.text }]).map((it) => ({ seat: 'ledger', at, key: it.key, text: it.text })));
    return done(cardOut, flags, last, updatesOut, { voice: voiceOut, stall: stallOut, handout: handoutOut });
  };
}

export const onRequest = makeHandler();
