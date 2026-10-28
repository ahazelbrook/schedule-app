// /api/gm/assist/{tick,fit} (GM only, see the "Claude at the table" build plan): Claude at the table, GM side. Players never
// call it and nothing it returns reaches the iPad. A player (or the table display sign-in) gets 403 before the body is read.
//   POST /api/gm/assist/tick { after?, npc?, rolled? } -> { cards, updates, flags, spend, last, voice?, errors? }
//        Glance fields (functions/_lib/assist/glance.js; design 3.6): every card, Ledger update, voice, handout and meanwhile answer carries kind, and cards, updates, handout, stall and
//        meanwhile also headline + bullets (a Ref card also cite and, when the seat set it, check), beside text/detail and every older field. Stall's own `kind` stays complication|clue
//        (the Rack reads it). `secret` is Ask Blade's alone. GET /cards restores them; a row from before restores as { kind by seat, headline: text, bullets: [] }.
//        `rolled: true` (the page sends one 40 s after the GM taps a console result or files a roll) adds the flag 'rolled', which wakes Ref; the Tripwire's
//        45 s gap does not apply to it, and with nothing new to read it skips the Tripwire and returns the cursor it was given.
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
//   POST /api/gm/assist/{portrait|prop|wire} -> { item: { kind, ..., at } | null, spend }    the Screen (GM-initiated; nothing here reaches the iPad)
//        portrait { name?, vocab } (vocab: the figure kit's names as text, at most 5000 characters) -> item { kind: 'portrait', name, description, spec };
//        prop { ask? } (one line, at most 200 characters) -> item { kind: 'prop', title, text } (text at most 1200 characters, so the gatekeeper
//        reads all of it); wire {} -> item { kind: 'wire', text } (at most 240 characters). Each reads the last 5 minutes of talk. The ladder:
//        Wire stops at 60% of the night's cap, Portrait and Prop at 85%, all at the cap (429); one of each at a time (429 busy). item is null
//        when the seat refused, was cut off or gave nothing usable (logged, never shown). The page runs the gatekeeper on every item.
//   POST /api/gm/assist/ask { q } -> { answer: { q, at, kind, headline, bullets, say, secret, more, text } | null, spend, warnings?, errors? }    Ask Blade: the GM's typed question in the box
//        (q is whitespace-squashed, 1-600 characters, else 400 before the database or the key). Seat `ask` (Opus, a JSON schema: kind, headline, bullets, say, secret, more) reads
//        tonight's story (the Scribe's, appended after the cache breakpoint), the last 10 minutes of talk and the last two exchanges of the
//        last 45 minutes (not the dismissed ones) (read from the log with json_extract), and answers for the GM's eyes only; nothing here reaches the iPad. Every field is clipped in code (headline 90, 5 bullets of 120, say 600, secret 300, more 900); text is their plain rendering
//        (secret marked), kept to 4000 characters, and is what askHistory and gm:after read. Like Portrait and Prop it stops at 85% of the night's cap (429 with the cap or the ladder as the reason)
//        and runs one at a time (429 busy). answer is null when there is no assist part (with a warning), the seat refused, was cut off
//        or said nothing. One row is logged (seat 'ask', card { ask: 1, q, ...fields, text, shown: 0 }); GET /cards hands the last 10 back as `asks`, with the fields (an old row without them is { headline: text }).
//   POST /api/gm/assist/board {} -> { item: { kind: 'board', title, text, at } | null }   the case board, from the Mystery keeper's latest
//        known and theories (what the players said aloud). Code only: no model, no key, no spend, and it runs at any tier.
//   POST /api/gm/assist/portrait-add { name, description?, spec } -> { id, doc }   saves a portrait as an app NPC through checkNpc/writeNpc,
//        always HIDDEN (revealed: false, whatever is sent); showing it to the players is the normal reveal flow.
//   POST /api/gm/assist/act { from, to, state } -> { actions, dropped, spend }    the co-GM's hands (seat `hands`, Haiku, low; design 5.3 and 5.4; functions/_lib/assist/hands.js).
//        from and to are transcript seqs (whole numbers, from <= to, at most 200 apart); the Worker reads those lines from D1 ITSELF (the latest 40 at most, one query) and
//        ignores any `lines` in the body, so a page cannot give the seat, or the quote check, talk that was never said. state is { clocks: [{ id, name, size, filled, hidden }],
//        npcs: [{ id, name }], pcs: [{ id, name }], onStage } of at most 8 KB of JSON, else 400. Every 400 comes before the database or the key. The seat is given the window and
//        the state and NEVER the cached prefix (no assist part is needed, none is read). The Worker validates what comes back and applies NOTHING; the page does that (C2):
//        an action is kept only if its quote is in the lines, its clock id is in the state, its size is legal, its tick is clamped to the clock and a name already known is not
//        added again; a confidence under 0.7 is mode 'offer' (a yellow card), else 'act'. Each action has a stable `key`. `dropped` is [{ type, why, name? }] (an npc_add of a
//        known name says 'already known'). An empty range of lines answers { actions: [] } with no model call and no row. Core tier (to the cap), one at a time and at most
//        every 8 s: 429 otherwise. One row is logged (seat `hands`, flags `act`, `shown: 0`, so it never holds back a card). The answer carries no `health`: the page feeds health to healthStep, and an
//        empty `skipped` would reset the other seats' stuck streaks. It does not take the lapsed leases either (only the tick reports `reaped`).
//   GET  /api/gm/assist/cards?session=&since= -> { cards, updates, asks }   tonight's shown cards, open Ledger updates and Ask Blade answers
//        (last 12 h unless `since`; asks: [{ row, at, q, text, kind, headline, bullets, say, secret, more, kept }], the last 10, oldest first), so a reloaded GM page restores its chat.
//        Dismissed cards, finished updates and dismissed asks are left out. No model, no key.
//   POST /api/gm/assist/cards { op: 'seen'|'dismiss'|'keep', items: [{ at, text, key? }] } -> { marked }   the box's marks, kept on the
//        log row (functions/_lib/assist/cards.js); an Ask Blade answer is named by its question (`text` is the q). A card is shown once (`shown: 1` on its row); the log is also what gm:after files.
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
// Leases and deadlines (functions/_lib/assist/leases.js): a seat in flight holds a lease (token + ttl) that its call releases in `finally` and that
// lapses on its own if the request is cancelled first; the next tick sweeps it and reports it in `health.reaped`. Every call has a deadline (an
// AbortSignal plus a race, so a fake that ignores the signal is bounded too): Tripwire 12 s, tick seats 30 s, the taps 45 s, Prop and Ask 75 s. A call
// that hits it is a failed call with `timeout: 1, shown: 0` in its row. The work of each request is one promise, given to `waitUntil` and awaited.
// The tick answer adds `health: { skipped: [{ seat, why }], reaped: [seat], ran: [seat] }` (the Tripwire row's card carries the same `skipped`). `ran` is the seats
// whose call came back with an answer this tick (not a timeout, not busy-skipped): the panel's dots need it, because a seat that was not woken is in neither list.
//
//
// The Scribe (seat `scribe`, Haiku, low) folds the talk since its last run into a rolling "story so far" about every five minutes of new
// talk (cooldown 5 minutes on a tick that has new talk; it runs until 85% of the cap). The story is capped at 8000 characters (about 2k
// tokens) and kept on the Scribe's own log row (card.story, card.through = the seq of the last line it read; json_extract reads it back,
// so there is no migration and no parsing here). A new session starts a new story. The Showrunner, the Mystery keeper and Meanwhile get it
// appended to their instructions, AFTER the prefix's cache breakpoint; it is never in the prefix. Nothing from the Scribe shows.
// Meanwhile (seat `meanwhile`, Sonnet, low) wakes on the Tripwire's scene_change, at most every 20 minutes, until 60%. It reads the story,
// the last 8 minutes of talk, the table's open clocks (campaigns.doc $.clocks, read by json_extract, at most 12 names) and the factions
// block of the prefix, and answers as `meanwhile: { faction, cutaway, clock, ticks, why, at }`: one off-screen cutaway for the Rack with
// a SUGGESTED tick (0-2) that nothing here applies.
// The silence flag: a tick with no new talk, with Listening on (the control document says want on and the iPad reports listening within
// the last two minutes), the newest line 4 to 30 minutes old and Stall past its 5-minute cooldown, runs Stall without the Tripwire (flags
// `stall,silence`). Listening off, the iPad stopped or errored, or the cap reached: nothing runs.

import { getDb } from '../../_lib/db.js';
import { HttpError, json, methodNotAllowed, readJsonObject, campaignOf } from '../../_lib/http.js';
import { requireGm, parseJson } from '../../_lib/gm.js';
import { loadStt, readLines } from '../../_lib/stt.js';
import { cachedClient, callSeat } from '../../_lib/assist/claude.js';
import { melbourneHHMM } from '../../_lib/assist/clock.js';
import { makeLeases, DEADLINE_MS, DEFAULT_DEADLINE_MS } from '../../_lib/assist/leases.js';
import { SEATS, WAKES } from '../../_lib/assist/seats.js';
import { cleanItem, verdictOf, unknownVerdict } from '../../_lib/assist/gatekeeper.js';
import { checkNpc, newNpcId, writeNpc } from '../../_lib/npcs.js';
import { toPortrait, toProp, toWire, buildBoard, boardSource, cleanName, cleanAsk, cleanVocab } from '../../_lib/assist/screen.js';
import { handsUser, portraitUser, propUser, wireUser, SCREEN_WINDOW_MIN, SCREEN_NAME_MAX, askUser, cleanAskFields, clerkUser, CLERK_KNOWN_MAX, CLERK_NAME_MAX, ASK_MAX, ASK_WINDOW_MIN, ASK_HISTORY, ASK_HISTORY_MIN, ASK_HISTORY_ANSWER_MAX } from '../../_lib/assist/prompts.js';
import { gatekeeperUser, ITEM_MAX, fitUser, voiceUser, anotherUser, showrunnerUser, mysteryUser, NPC_MAX, SHOWN_MAX, SHOWN_LINE_MAX, SHOWRUNNER_MIN, MYSTERY_MIN, KNOWN_MAX, KNOWN_ITEM_MAX,
  STORY_SEATS, storyBlock, scribeUser, SCRIBE_SLICE_MAX, SCRIBE_FIRST_MIN, MEANWHILE_MIN, meanwhileUser, cleanClocks, silenceUser } from '../../_lib/assist/prompts.js';
import { DEFAULT_CAP, COOLDOWN_MS, budgetTier, canRun, decide, followsThrough, FOLLOW_WINDOW_MS, isListening, silenceFlag } from '../../_lib/assist/conductor.js';
import { ledgerGlance, fixerGlance, restoreGlance } from '../../_lib/assist/glance.js';
import { toCandidate, toVoice, toAnother, toStall, toScribe, toMeanwhile, toHandout, handoutIds, handoutTitles, merge, pendingRefs, CARD_GAP_MS, STALE_MS } from '../../_lib/assist/editor.js';
import { nightCards, markCards, cleanMarks, OPS } from '../../_lib/assist/cards.js';
import { cleanActBody, validateActions, LINES_MAX } from '../../_lib/assist/hands.js';

const BODY_MAX = 8 * 1024;
const ACT_BODY_MAX = 32 * 1024;            // an act request holds a state of at most 8 KB; a bigger one must reach the state check (a 400), not the generic 413 at 8 KB
const PORTRAIT_BODY_MAX = 14 * 1024;       // a portrait request carries the figure kit's vocabulary (a few KB of names)
const NIGHT_MS = 12 * 60 * 60 * 1000;      // "tonight" is the last 12 hours of the log
const LAST_RUN_MS = 60 * 60 * 1000;        // cooldowns look back an hour at most
const RECENT_CARD_MS = 10 * 60 * 1000;     // shown cards that can still make a new one a repeat
const TAP_WINDOW_MS = 4 * 60 * 1000;       // the Tap seats read this much raw talk
const FIT_WINDOW_MS = 5 * 60 * 1000;
const FIRST_SLICE_MS = 60 * 1000;          // no `after`: the Tripwire reads the last minute

// Seats in flight in THIS isolate, as leases (functions/_lib/assist/leases.js): a token and an expiry per seat, so a request cancelled
// mid-call (its `finally` never runs) frees the seat when the lease lapses instead of holding it for the night. Best effort: another
// isolate does not see it, so the cooldowns (from the log) back it up.
const sharedLeases = makeLeases();

// Melbourne's HH:MM, by arithmetic (assist/clock.js): no Intl formatter at module scope, whose ICU zone load cost ~12 ms of CPU per isolate start.
const stampMemo = new Map();        // one formatted stamp per minute: a long window of talk would otherwise format every line
const hhmm = (ms) => {
  const m = Math.floor(ms / 60000);
  let v = stampMemo.get(m);
  if (v === undefined) { v = melbourneHHMM(m * 60000); if (stampMemo.size > 200) stampMemo.clear(); stampMemo.set(m, v); }
  return v;
};
const dollars = (n) => Math.round(n * 10000) / 10000;

function defaultClient(env) {
  const key = env && env.ANTHROPIC_API_KEY;
  if (typeof key !== 'string' || !key) throw new HttpError(503, 'assist is not set up (no API key)');
  return cachedClient(key);          // one per isolate, keyed by a hash of the key; the deadline and signal go on each call
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

const NO_PREFIX = { fileId: '', legacy: false, extra: {}, found: true };   // the hands seat never reads the assist part, so /act does not even look for it

const REPUSH = 're-push the assist part';
const FILE_ID = /^file_[A-Za-z0-9_-]{4,100}$/;

const HANDOUTS_MAX_BYTES = 16 * 1024;           // the handouts part is a short list; a bigger one is not read here

/** The ids in the live handouts part (a Set; empty when there is none or it is too big to be the short list it should be). */
async function liveHandouts(db, campaign) {
  const row = await db.prepare("SELECT CASE WHEN LENGTH(CAST(body AS BLOB)) <= ?2 THEN body END AS body FROM gm_pack WHERE campaign = ?1 AND part = 'handouts'").bind(campaign, HANDOUTS_MAX_BYTES).first();
  const part = row && row.body ? parseJson(row.body, null) : null;
  return { ids: handoutIds(part), titles: handoutTitles(part) };
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

/** /act's one read of the log: tonight's spend and the newest `hands` row ({ spent (dollars), last (ms | null) }). The cooldown and the ladder both come from it. */
async function spendAndLastHands(db, campaign, now) {
  const since = new Date(now - NIGHT_MS).toISOString();
  const r = await db.prepare("SELECT COALESCE(SUM(cents), 0) AS cents, MAX(CASE WHEN seat = 'hands' THEN at END) AS hands FROM gm_assist_log WHERE campaign = ?1 AND at >= ?2").bind(campaign, since).first();
  return { spent: (r ? r.cents : 0) / 100, last: r && r.hands ? Date.parse(r.hands) : null };
}

/** The transcript lines from seq `from` to `to` (the latest LINES_MAX if more): the ONE read of the transcript an /act call makes. Marks are left out in SQL. */
async function actLines(db, campaign, from, to) {
  const r = await db.prepare("SELECT seq, session, at, speaker, kind, text FROM (SELECT seq, session, at, speaker, kind, text FROM gm_transcript WHERE campaign = ?1 AND seq BETWEEN ?2 AND ?3 AND kind = 'line' ORDER BY seq DESC LIMIT ?4) ORDER BY seq").bind(campaign, from, to, LINES_MAX).all();
  return r.results || [];
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

/** The cards and ledger updates the GM was shown in the last 10 minutes: [{ at (ms), keys, ref, check, said_at }]. A Ref card (its own row, or the Editor's row for a held one released later) also carries its check and said-at, for the Editor's second repeat rule. */
async function shownCards(db, campaign, now) {
  const since = new Date(now - RECENT_CARD_MS).toISOString();
  const { results } = await db.prepare("SELECT at, seat, card FROM gm_assist_log WHERE campaign = ?1 AND at >= ?2 AND (json_extract(card, '$.shown') = 1 OR json_extract(card, '$.update') = 1)").bind(campaign, since).all();
  return (results || []).map((r) => {
    const c = parseJson(r.card, {}) || {};
    const ref = r.seat === 'ref' || c.seat === 'ref';
    return { at: Date.parse(r.at), keys: c.keys || [], ...(ref ? { ref: true, check: (c.glance && c.glance.check) || '', said_at: (c.detail && c.detail.said_at) || '' } : {}) };
  });
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

const NPC_RECENT_MS = 12 * 60 * 60 * 1000;   // an NPC row touched this recently counts as already in the cast

/**
 * Names the Clerk should not raise again: the new_names on Clerk cards the GM was shown tonight (a held-back card's names stay raisable), plus the names (and aliases) of NPC rows updated in the last
 * 12 hours. json_each / json_extract keep the parsing in D1; the Worker only trims and dedupes a short list.
 */
async function clerkKnown(db, campaign, now) {
  const since = new Date(now - NIGHT_MS).toISOString(), npcSince = new Date(now - NPC_RECENT_MS).toISOString();
  const { results } = await db.prepare(
    "SELECT j.value AS n FROM gm_assist_log l, json_each(json_extract(l.card, '$.out.new_names')) j WHERE l.campaign = ?1 AND l.at >= ?2 AND l.seat = 'clerk' AND l.card IS NOT NULL AND json_extract(l.card, '$.shown') = 1 AND json_type(l.card, '$.out.new_names') = 'array' " +
    "UNION SELECT json_extract(doc, '$.name') FROM npcs WHERE campaign = ?1 AND deleted = 0 AND updated_at >= ?3 " +
    "UNION SELECT json_extract(doc, '$.alias') FROM npcs WHERE campaign = ?1 AND deleted = 0 AND updated_at >= ?3 LIMIT 60").bind(campaign, since, npcSince).all();
  const seen = new Set(), out = [];
  for (const r of results || []) {
    const n = typeof r.n === 'string' ? r.n.replace(/\s+/g, ' ').trim().slice(0, CLERK_NAME_MAX) : '';
    if (!n || seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase()); out.push(n);
    if (out.length >= CLERK_KNOWN_MAX) break;
  }
  return out;
}

/** The Scribe's last saved story tonight: { story, through (seq of the last line it read), session } or null. json_extract keeps the parsing in D1. */
async function lastStory(db, campaign, now) {
  const since = new Date(now - NIGHT_MS).toISOString();
  const r = await db.prepare("SELECT json_extract(card, '$.story') AS story, json_extract(card, '$.through') AS through, session FROM gm_assist_log WHERE campaign = ?1 AND at >= ?2 AND seat = 'scribe' AND json_extract(card, '$.story') IS NOT NULL ORDER BY id DESC LIMIT 1").bind(campaign, since).first();
  if (!r || typeof r.story !== 'string' || !r.story.trim()) return null;
  return { story: r.story, through: Number.isInteger(r.through) ? r.through : 0, session: r.session || '' };
}

/** The table's open clocks (names only, up to a dozen): the campaign document's, read with json_extract so D1 does the digging. */
async function tableClocks(db, campaign) {
  const r = await db.prepare("SELECT json_extract(doc, '$.clocks') AS c FROM campaigns WHERE id = ?1").bind(campaign).first();
  return cleanClocks(r && typeof r.c === 'string' ? parseJson(r.c, []) : []);
}

/** The newest transcript line (not a mark): { at (ms), session } or null. */
async function lastLine(db, campaign) {
  const r = await db.prepare("SELECT at, session FROM gm_transcript WHERE campaign = ?1 AND kind = 'line' ORDER BY seq DESC LIMIT 1").bind(campaign).first();
  return r ? { at: Date.parse(r.at), session: r.session || '' } : null;
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

// `timing` is { secs, stop, timeout? }: the call's wall-clock seconds and the provider's stop reason. They go into the card JSON of every
// seat call (no column, no migration). A refusal is recorded as `refusal: 1` and is never shown; a call that hit its deadline as `timeout: 1`.
function logRow(db, campaign, { at, session, seat, cfg, usage, cost, flags, card, timing }) {
  const u = usage || {};
  if (card && typeof card === 'object' && timing) {
    card = { ...card, secs: timing.secs, ...(timing.stop ? { stop: timing.stop } : {}), ...(timing.stop === 'refusal' ? { refusal: 1, shown: 0 } : {}), ...(timing.stop === 'max_tokens' ? { truncated: 1, shown: 0 } : {}), ...(timing.timeout ? { timeout: 1, shown: 0 } : {}) };
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

const SCREEN_ACTIONS = ['portrait', 'prop', 'wire', 'board', 'portrait-add'];

/** The body of a Screen request, checked before the database or the key are touched. Throws HttpError(400). */
export function cleanScreenBody(action, b) {
  if (action === 'portrait') {
    const name = cleanName(b.name), vocab = cleanVocab(b.vocab);
    if (name === null) throw new HttpError(400, 'name is at most ' + SCREEN_NAME_MAX + ' characters');
    if (!vocab) throw new HttpError(400, "vocab is required: the figure kit's names as text");
    return { name, vocab };
  }
  if (action === 'prop') {
    const ask = cleanAsk(b.ask);
    if (ask === null) throw new HttpError(400, 'ask is a line of at most 200 characters');
    return { ask };
  }
  if (action === 'portrait-add') {
    const name = cleanName(b.name);
    if (!name) throw new HttpError(400, 'name is required (at most ' + SCREEN_NAME_MAX + ' characters)');
    if (!b.spec || typeof b.spec !== 'object' || Array.isArray(b.spec)) throw new HttpError(400, 'spec must be an object');
    if (b.description !== undefined && typeof b.description !== 'string') throw new HttpError(400, 'description must be a string');
    return { name, description: b.description || '', spec: b.spec };
  }
  return {};
}

/** The question Ask Blade is asked: whitespace squashed to single spaces, 1-ASK_MAX characters; null when it is not a string or is empty or too long. */
export function cleanAskQuestion(v) {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  return t && t.length <= ASK_MAX ? t : null;
}

/** The last ASK_HISTORY exchanges of the last ASK_HISTORY_MIN minutes, oldest first: [{ q, text }] (answers clipped in D1, so the Worker never parses them). A dismissed answer is left out, so a bad one does not steer the next. */
async function askHistory(db, campaign, now) {
  const since = new Date(now - ASK_HISTORY_MIN * 60 * 1000).toISOString();
  const { results } = await db.prepare("SELECT json_extract(card, '$.q') AS q, substr(json_extract(card, '$.text'), 1, ?3) AS text FROM gm_assist_log WHERE campaign = ?1 AND at >= ?2 AND seat = 'ask' AND json_extract(card, '$.ask') = 1 AND COALESCE(json_extract(card, '$.text'), '') != '' AND COALESCE(json_extract(card, '$.dismissed'), 0) != 1 ORDER BY id DESC LIMIT " + ASK_HISTORY).bind(campaign, since, ASK_HISTORY_ANSWER_MAX).all();
  return (results || []).filter((r) => typeof r.q === 'string' && typeof r.text === 'string').map((r) => ({ q: r.q, text: r.text })).reverse();
}

/** The case board: the Mystery keeper's latest known and theories, as a text item. Code only: no model, no spend, always allowed. */
async function boardOf(db, campaign, now) {
  const since = new Date(now - NIGHT_MS).toISOString();
  const r = await db.prepare("SELECT card FROM gm_assist_log WHERE campaign = ?1 AND at >= ?2 AND seat = 'mystery' AND card IS NOT NULL ORDER BY id DESC LIMIT 1").bind(campaign, since).first();
  const c = r ? parseJson(r.card, null) : null;
  const item = buildBoard(...Object.values(boardSource(c && c.out)));
  return { item: item ? { ...item, at: new Date(now).toISOString() } : null };
}

/** Save a portrait as a HIDDEN app NPC: revealed is forced to false here, whatever the page sent. Showing it is the normal reveal flow. */
async function addPortrait(db, campaign, inp) {
  const body = { name: inp.name, description: inp.description.slice(0, 2000), spec: inp.spec, revealed: false, firstSeen: null, tags: ['screen'] };
  const id = newNpcId();
  const doc = await writeNpc(db, campaign, id, (_row, at) => ({ ...checkNpc(body), createdAt: at, updatedAt: at }));
  return { id, doc };
}

// the SDK's own timeout error (its class has no stable `name`)
const sdkTimeout = (e) => !!e && (e.name === 'APIConnectionTimeoutError' || (e.constructor && e.constructor.name === 'APIConnectionTimeoutError'));

/**
 * `leases` and `deadlines` are for tests (a private registry, a short deadline); the defaults are the isolate's registry and DEADLINE_MS.
 * The handler's work runs as ONE promise: it is handed to `waitUntil` when the platform gives one and awaited for the response, so a page that
 * gives up (its own timeout) does not cancel the seat calls, the log rows or the lease releases. Nothing ties the request's own signal to a call.
 */
export function makeHandler({ clientFor = defaultClient, now = () => Date.now(), call = callSeat, seats = SEATS, wakes = WAKES, leases = sharedLeases, deadlines = DEADLINE_MS } = {}) {
  return function onRequest(context) {
    const work = handle(context);
    if (context && typeof context.waitUntil === 'function') context.waitUntil(work.catch(() => {}));
    return work;
  };
  async function handle({ request, env, data }) {
    requireGm(data);                                   // first: before the method, the body or the database
    const url = new URL(request.url);
    const action = /\/api\/gm\/assist\/(tick|fit|another|gatekeeper|cards|portrait-add|portrait|prop|wire|board|ask|act)\/?$/.exec(url.pathname);
    if (!action) throw new HttpError(404, 'not found');
    if (action[1] === 'cards') {                       // the box's memory: no key, no model
      if (request.method === 'GET') {
        const since = url.searchParams.get('since'), session = url.searchParams.get('session');
        if (since !== null && (since.length > 40 || Number.isNaN(Date.parse(since)))) throw new HttpError(400, 'since must be a date');
        if (session !== null && session.length > 20) throw new HttpError(400, 'session is too long');
        const out = await nightCards(await getDb(env), campaignOf(env), { now: now(), ...(since !== null ? { since: new Date(since).toISOString() } : {}), ...(session ? { session } : {}) });
        return json({ cards: out.cards, updates: out.updates, asks: out.asks });
      }
      if (request.method !== 'POST') return methodNotAllowed(['GET', 'POST']);
      const b = await readJsonObject(request, BODY_MAX);
      const items = cleanMarks(b.items);
      if (!OPS.includes(b.op) || !items) throw new HttpError(400, 'op is seen, dismiss or keep, with 1-50 items { at, text }');
      return json({ marked: await markCards(await getDb(env), campaignOf(env), b.op, items) });
    }
    if (request.method !== 'POST') return methodNotAllowed(['POST']);
    const body = await readJsonObject(request, action[1] === 'portrait' ? PORTRAIT_BODY_MAX : action[1] === 'act' ? ACT_BODY_MAX : BODY_MAX);
    const actIn = action[1] === 'act' ? cleanActBody(body) : null;                // a 400 (range, state) comes before the database or the key
    const gateItem = action[1] === 'gatekeeper' ? cleanItem(body) : null;      // checked before the database or the key are touched
    if (gateItem && !gateItem.ok) throw new HttpError(400, gateItem.why);
    const screenIn = SCREEN_ACTIONS.includes(action[1]) ? cleanScreenBody(action[1], body) : null;      // a 400 comes before the database or the key
    const askQ = action[1] === 'ask' ? cleanAskQuestion(body.q) : null;
    if (action[1] === 'ask' && askQ === null) throw new HttpError(400, 'q is the question: 1-' + ASK_MAX + ' characters');
    const db = await getDb(env), campaign = campaignOf(env), t0 = now();
    // the Screen's code-only actions need no model and no key
    if (action[1] === 'board') return json(await boardOf(db, campaign, t0));
    if (action[1] === 'portrait-add') return json(await addPortrait(db, campaign, screenIn));
    const client = clientFor(env);
    const cap = capOf(env);
    // /act reads the log once for spend and its own last run, and never reads the assist part (its seat is given no prefix)
    const handsLog = actIn ? await spendAndLastHands(db, campaign, t0) : null;
    const spentBefore = handsLog ? handsLog.spent : await tonight(db, campaign, t0);
    const tier = budgetTier(spentBefore, cap);
    const { fileId, legacy, extra, found } = actIn ? NO_PREFIX : await loadPrefix(db, campaign);
    const warnings = actIn ? [] : legacy ? [REPUSH] : found && fileId ? [] : ['no assist part in the GM pack'];
    const stt = await loadStt(db, campaign);
    const speakers = stt.doc.speakers || {};
    const errors = [];
    // Every read of "who is in flight" sweeps the lapsed leases first and hands the Conductor a plain Set, so its signatures are unchanged.
    const live = () => { leases.sweep(now()); return leases.seats(); };
    let reaped = [];               // the leases that lapsed since the last tick looked (taken at the start of THIS tick, so an abandoned tick that finishes later cannot swallow them)
    const skipped = [];            // the tick's health: { seat, why } for every seat that did not run
    const ran = [];                // and the seats whose call came back with an answer
    let isTick = false;
    let thisTick = 0, fileMissing = false, storyText = '';   // storyText: the Scribe's story, appended to the instructions of the seats in STORY_SEATS (after the cache breakpoint)

    // one seat call; logging is the caller's job (the Tap rows wait for the Editor's verdict)
    // The call has a deadline: an AbortSignal that ends the SDK's request and its retry, and a race here, because `call` is injected and a
    // fake may ignore the signal. A call that hits it returns like a failed call, with timing.timeout set. The lease is released in `finally`;
    // if even that never runs (the isolate's request was killed), the lease lapses on its own ttl. Throws a busy 429 when the seat is leased.
    async function run(name, user) {
      const cfg = seats[name];
      const token = leases.acquire(name, now());
      if (!token) { const busy = new HttpError(429, 'this is busy'); busy.busy = true; throw busy; }
      const started = now();
      const secs = () => Math.round(Math.max(0, now() - started) / 100) / 10;
      const deadlineMs = deadlines[name] || DEFAULT_DEADLINE_MS;
      const ctl = new AbortController();
      let timer, timedOut = false;
      try {
        // a seat marked noPrefix (hands) gets neither the cached prefix nor the vault-built extra: its instructions and the user turn are all it reads
        const instructions = (!cfg.noPrefix && extra[name] ? cfg.instructions + '\n' + String(extra[name]) : cfg.instructions) + (STORY_SEATS.includes(name) ? storyBlock(storyText) : '');
        const deadline = new Promise((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error('deadline')); ctl.abort(); }, deadlineMs); });
        const pending = (async () => call(client, { ...cfg, instructions, prefixFileId: cfg.noPrefix ? '' : fileId, user, deadlineMs, signal: ctl.signal }))();
        pending.catch(() => {});                    // if the deadline wins, this settles later (the abort): nobody is listening, and that is fine
        const r = await Promise.race([pending, deadline]);
        thisTick += r.cost || 0;
        if (r.stop === 'refusal' || r.stop === 'max_tokens') r.json = null;     // a refusal or a reply cut off at the limit shows nothing, never a half card; the row records it
        return { cfg, r, timing: { secs: secs(), stop: typeof r.stop === 'string' ? r.stop : '' } };
      } catch (e) {
        if (timedOut || sdkTimeout(e)) { errors.push({ seat: name, error: 'timed out' }); return { cfg, r: null, timing: { secs: secs(), stop: '', timeout: 1 } }; }
        if (fileId && fileGone(e)) { fileMissing = true; if (!warnings.includes(REPUSH)) warnings.push(REPUSH); }
        else errors.push({ seat: name, error: errorOf(e) });
        return { cfg, r: null, timing: { secs: secs(), stop: '' } };
      } finally {
        clearTimeout(timer);
        leases.release(name, token);
      }
    }
    // run() for the tick's own seats: a seat leased by another request in the meantime is skipped (and said so), not an error
    async function runOrSkip(name, user) {
      try { return await run(name, user); } catch (e) { if (e && e.busy) { skipped.push({ seat: name, why: 'in-flight' }); return null; } throw e; }
    }
    const spend = () => ({ tonight: dollars(spentBefore + thisTick), cap, tier: budgetTier(spentBefore + thisTick, cap), tick: dollars(thisTick) });
    const done = (cards, flags, last, updates = [], more = {}) => json({ cards, updates, flags, spend: spend(), last, ...(more.voice ? { voice: more.voice } : {}), ...(more.stall ? { stall: more.stall } : {}), ...(more.meanwhile ? { meanwhile: more.meanwhile } : {}), ...(more.handout ? { handout: more.handout } : {}), ...(warnings.length ? { warnings } : {}), ...(errors.length ? { errors } : {}), ...(isTick ? { health: { skipped, reaped, ran } } : {}) });

    if (action[1] === 'act') {
      // The co-GM's hands (design 5.3/5.4). Core tier: it runs to the cap like Ref. One at a time, and not more often than every 8 s (from the log).
      // This route takes nothing from the page but the range and the state; it reads the lines itself, validates what the seat says, and applies nothing.
      // It does not call leases.takeReaped(): that belongs to the tick, whose health.reaped it would otherwise swallow.
      const gate = canRun('hands', { now: t0, lastRun: handsLog.last === null ? {} : { hands: handsLog.last }, inFlight: live(), tier });
      if (!gate.ok) throw new HttpError(429, gate.why === 'budget' ? "tonight's cap is reached" : gate.why === 'cooldown' ? 'the co-GM is cooling down' : 'this is busy');
      const lines = await actLines(db, campaign, actIn.from, actIn.to);                        // the one transcript read
      // No `health` in this answer: the page feeds health to healthStep, and an empty `skipped` there would reset the other seats' stuck streaks.
      if (!lines.length) return json({ actions: [], dropped: [], spend: spend() });       // nothing to read: no call, no row
      const { cfg, r, timing } = await run('hands', handsUser({ state: actIn.state, stamp: hhmm(t0), talk: formatLines(lines, speakers) }));
      const at = new Date(now()).toISOString();
      // run() nulls r.json for a refusal or a reply cut off at the limit: those show nothing
      const out = r && r.json && Array.isArray(r.json.actions) ? r.json : null;
      const v = out ? validateActions(out.actions, { state: actIn.state, lines }) : { actions: [], dropped: [] };
      await logRow(db, campaign, { at, session: lines[lines.length - 1].session || '', seat: 'hands', cfg, usage: r && r.usage, cost: r && r.cost, flags: ['act'], timing,
        card: { act: 1, from: actIn.from, to: actIn.to, n: lines.length, ...(out ? { out } : {}), actions: v.actions.map((a) => ({ type: a.type, mode: a.mode, key: a.key, at: a.at, confidence: a.confidence })), dropped: v.dropped, shown: 0,
          ...(out ? {} : { error: errors.length ? errors[0].error : r && r.stop === 'refusal' ? 'refusal' : r && r.stop === 'max_tokens' ? 'cut off' : 'no JSON' }) } }).run();
      return json({ actions: v.actions, dropped: v.dropped, spend: spend(), ...(errors.length ? { errors } : {}) });
    }

    if (action[1] === 'portrait' || action[1] === 'prop' || action[1] === 'wire') {
      const seat = action[1];
      // the ladder: Wire stops at 60% of tonight's cap, Portrait and Prop at 85% (they are not Core seats); at the cap nothing runs
      const gate = canRun(seat, { now: t0, lastRun: {}, inFlight: live(), tier });
      if (!gate.ok) throw new HttpError(429, gate.why === 'budget' ? (tier === 'off' ? "tonight's cap is reached" : 'the budget ladder has dropped this for tonight') : 'this is busy');
      if (legacy || !fileId) return json({ item: null, spend: spend(), warnings: legacy ? [REPUSH] : ['no assist part in the GM pack'] });
      const { lines: recent } = await readLines(db, campaign, { since: new Date(t0 - SCREEN_WINDOW_MIN * 60 * 1000).toISOString() });
      const talk = formatLines(recent, speakers), stamp = hhmm(t0);
      const user = seat === 'portrait' ? portraitUser({ name: screenIn.name, vocab: screenIn.vocab, stamp, talk }) : seat === 'prop' ? propUser({ ask: screenIn.ask, stamp, talk }) : wireUser({ stamp, talk });
      const { cfg, r, timing } = await run(seat, user);
      const at = new Date(now()).toISOString();
      if (fileMissing) return json({ item: null, spend: spend(), warnings });                // nothing was billed or logged: the file is gone
      const out = r && r.json ? r.json : null;
      const item = out ? (seat === 'portrait' ? toPortrait(out, screenIn.name) : seat === 'prop' ? toProp(out) : toWire(out)) : null;
      const session = recent.length ? recent[recent.length - 1].session : '';
      await logRow(db, campaign, { at, session, seat, cfg, usage: r && r.usage, cost: r && r.cost, flags: [seat], timing,
        card: out ? { out, shown: 0, made: item ? 1 : 0 } : { error: errors.length ? errors[0].error : r && r.stop === 'refusal' ? 'refusal' : 'no JSON', shown: 0 } }).run();
      return json({ item: item ? { ...item, at } : null, spend: spend(), ...(warnings.length ? { warnings } : {}), ...(errors.length ? { errors } : {}) });
    }

    if (action[1] === 'ask') {
      // Ask Blade: the GM's own question, answered in plain text for the GM's eyes only. The ladder is the Screen's: stops at 85% of the cap, 429 at the cap or while busy
      const gate = canRun('ask', { now: t0, lastRun: {}, inFlight: live(), tier });
      if (!gate.ok) throw new HttpError(429, gate.why === 'budget' ? (tier === 'off' ? "tonight's cap is reached" : 'the budget ladder has dropped this for tonight') : 'this is busy');
      if (legacy || !fileId) return json({ answer: null, spend: spend(), warnings: legacy ? [REPUSH] : ['no assist part in the GM pack'] });
      const sr = await lastStory(db, campaign, t0);          // any session will do: the GM is asking about the night
      storyText = sr ? sr.story : '';
      const history = await askHistory(db, campaign, t0);
      const { lines: recent } = await readLines(db, campaign, { since: new Date(t0 - ASK_WINDOW_MIN * 60 * 1000).toISOString() });
      const { cfg, r, timing } = await run('ask', askUser({ q: askQ, history, stamp: hhmm(t0), talk: formatLines(recent, speakers) }));
      const at = new Date(now()).toISOString();
      if (fileMissing) return json({ answer: null, spend: spend(), warnings });                // nothing was billed or logged: the file is gone
      // run() nulls r.json only: a refusal or a reply cut off at the limit shows nothing, whatever text came with it
      const fields = r && r.stop !== 'refusal' && r.stop !== 'max_tokens' ? cleanAskFields(r.json) : null;
      const text = fields ? fields.text : '';
      const session = recent.length ? recent[recent.length - 1].session : sr ? sr.session : '';
      await logRow(db, campaign, { at, session, seat: 'ask', cfg, usage: r && r.usage, cost: r && r.cost, flags: ['ask'], timing,
        card: { ask: 1, q: askQ, ...(fields || {}), text, shown: 0, ...(text ? {} : { error: errors.length ? errors[0].error : r && r.stop === 'refusal' ? 'refusal' : r && r.stop === 'max_tokens' ? 'cut off' : 'no JSON' }) } }).run();
      return json({ answer: fields ? { q: askQ, at, ...fields } : null, spend: spend(), ...(warnings.length ? { warnings } : {}), ...(errors.length ? { errors } : {}) });
    }

    if (action[1] === 'gatekeeper') {
      const item = gateItem.item;
      const gate = canRun('gatekeeper', { now: t0, lastRun: {}, inFlight: live(), tier });
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
      const gate = canRun('fixer', { now: t0, lastRun: await lastRuns(db, campaign, t0), inFlight: live(), tier });
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
      return done(out ? [{ seat: 'fixer', at, text: out.read, ...out, ...fixerGlance(out.read) }] : [], [], last);
    }

    if (action[1] === 'another') {
      const npc = cleanNpc(body.npc), shown = cleanShown(body.shown);
      if (!npc) throw new HttpError(400, 'npc is required (at most ' + NPC_MAX + ' characters)');
      if (!shown) throw new HttpError(400, 'shown is required: 1-' + SHOWN_MAX + ' lines, each at most ' + SHOWN_LINE_MAX + ' characters');
      if (legacy) return done([], [], null);
      const gate = canRun('voice_plus', { now: t0, lastRun: await lastRuns(db, campaign, t0), inFlight: live(), tier });
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
      return done([], [], last, [], one ? { voice: { kind: 'say', who: one.who || npc, lines: [one.line], at } } : {});
    }

    // ---- tick ----
    isTick = true;                                       // from here every answer carries health: { skipped, reaped }
    live(); reaped = leases.takeReaped();
    const npc = cleanNpc(body.npc);
    if (npc === null) throw new HttpError(400, 'npc must be a name of at most ' + NPC_MAX + ' characters');
    const after = body.after === undefined || body.after === null ? null : body.after;
    if (after !== null && !(Number.isInteger(after) && after >= 0)) throw new HttpError(400, 'after must be a whole number');
    if (body.rolled !== undefined && typeof body.rolled !== 'boolean') throw new HttpError(400, 'rolled must be true or false');
    const rolled = body.rolled === true;                 // the GM tapped a result or filed a roll about 40 s ago: Ref looks at the last minutes
    // the Tap seats read the last four MINUTES (a busy table says well over 50 lines in four); the Tripwire reads what is new
    const { lines: tail, last } = await readLines(db, campaign, { since: new Date(t0 - TAP_WINDOW_MS).toISOString() });
    const session = tail.length ? tail[tail.length - 1].session : '';
    if (tier === 'off' || legacy) return done([], [], last);
    const fresh = after !== null ? (await readLines(db, campaign, { after })).lines : tail.filter((l) => t0 - Date.parse(l.at) <= FIRST_SLICE_MS);
    const freshText = formatLines(fresh, speakers);
    if (rolled && !freshText && !tail.length) return done([], [], last);    // a roll was reported but there is no talk to referee
    if (!freshText && !rolled) {
      // Nothing new to read. A table gone truly quiet gives the Tripwire nothing to flag, so code raises `stall` itself: Listening on, the
      // iPad hearing, no line for SILENCE_MS (conductor.js). Stall's own cooldown and the ladder still apply.
      if (!isListening(stt.doc, t0)) return done([], [], last);
      const ll = await lastLine(db, campaign);
      const sil = silenceFlag({ listening: true, lastLineAt: ll ? ll.at : null, now: t0 });
      if (!sil.silent) return done([], [], last);
      const sg = canRun('stall', { now: t0, lastRun: await lastRuns(db, campaign, t0), inFlight: live(), tier });
      if (!sg.ok) { skipped.push({ seat: 'stall', why: sg.why }); return done([], [], last); }
      const before = (await readLines(db, campaign, { since: new Date(ll.at - TAP_WINDOW_MS).toISOString() })).lines;
      const sx = await runOrSkip('stall', silenceUser({ minutes: sil.minutes, since: hhmm(ll.at), stamp: hhmm(t0), talk: formatLines(before, speakers) }));
      if (sx && sx.r) ran.push('stall');
      if (!sx || fileMissing) return done([], [], last);
      const sat = new Date(now()).toISOString(), sflags = ['stall', 'silence'];
      const st = sx.r ? toStall(sx.r.json, { recent: await shownVoice(db, campaign, t0), now: t0 }) : null;
      await logRow(db, campaign, { at: sat, session: ll.session, seat: 'stall', cfg: sx.cfg, usage: sx.r && sx.r.usage, cost: sx.r && sx.r.cost, flags: sflags, timing: sx.timing,
        card: sx.r ? { out: sx.r.json, silence: 1, ...(st ? { stall: 1, text: st.offer, keys: st.keys } : {}) } : { error: errors.find((e) => e.seat === 'stall')?.error || 'no reply', silence: 1 } }).run();
      return done([], sflags, last, [], { stall: st ? { kind: st.kind, offer: st.offer, why: st.why, headline: st.headline, bullets: st.bullets, at: sat } : null });
    }

    const lastRun = await lastRuns(db, campaign, t0);
    // a rolled tick lands 40 s after a tap, usually inside the Tripwire's own 45 s gap: the gap does not apply to it (one at a time still does)
    const gate = canRun('tripwire', { now: t0, lastRun, inFlight: live(), tier, ...(rolled ? { cooldowns: { ...COOLDOWN_MS, tripwire: 0 } } : {}) });
    // With nothing new to read, or the Tripwire busy, a rolled tick skips the Tripwire and wakes Ref alone on 'rolled'. It hands back the cursor it was
    // given, so the talk the Tripwire has not read is still read by the next ordinary tick.
    const rolledOnly = rolled && (!freshText || !gate.ok);
    const cursor = rolledOnly ? (after !== null ? after : null) : last;
    if (!rolledOnly && !gate.ok) { skipped.push({ seat: 'tripwire', why: gate.why }); return done([], [], last); }     // a Tripwire stuck in flight is exactly what health must show
    const prev = await prevTripwire(db, campaign, t0);            // read before this tick's own Tripwire row is written
    const tw = rolledOnly ? null : await runOrSkip('tripwire', 'New talk, up to ' + hhmm(t0) + ':\n' + freshText);
    if (tw && tw.r) ran.push('tripwire');
    if (!rolledOnly && (!tw || fileMissing)) return done([], [], last);          // nothing was billed or logged: the file is gone (or another request holds the Tripwire)
    const twAt = new Date(now()).toISOString();
    const flags = tw && tw.r && tw.r.json ? Object.keys(tw.r.json).filter((k) => tw.r.json[k] === true) : [];
    if (rolled) flags.push('rolled');       // not a Tripwire flag: it wakes Ref (WAKES) and is logged, so the next tick follows through

    // 'tick' wakes the Showrunner, paced by its 10-minute cooldown; with nothing else woken a tick costs no model call
    // a rolled-only tick re-reads talk the seats have already read: only Ref looks (no 'tick' seats, no Voice minute)
    const verdict = decide({ flags: rolledOnly ? flags : flags.concat('tick'), now: t0, lastRun, inFlight: live(), spent: spentBefore + thisTick, cap, wakes, onStage: rolledOnly ? false : !!npc, follow: followsThrough(prev, t0) });
    skipped.push(...verdict.skipped);
    // the Tripwire's row is written once, after the Conductor has spoken, so its card can say which seats were skipped and why
    if (!rolledOnly) await logRow(db, campaign, { at: twAt, session, seat: 'tripwire', cfg: tw.cfg, usage: tw.r && tw.r.usage, cost: tw.r && tw.r.cost, flags, timing: tw.timing,
      card: { ...(tw.r ? { out: tw.r.json } : { error: errors.length ? errors[0].error : 'no reply' }), skipped: skipped.map((x) => ({ ...x })) } }).run();
    // a quiet tick still releases a Ref card the gap held back (one cheap read, only when no seat woke): without it a slip held behind
    // another seat's card would go stale before any flag woke a seat again
    // the Scribe folds the talk since the story's last line into the story; with nothing new to fold it does not run
    let wake = verdict.seats.slice(), prior = '', scribeThrough = 0, scribeTurn = '';
    const storyRow = wake.some((n) => n === 'scribe' || STORY_SEATS.includes(n)) ? await lastStory(db, campaign, t0) : null;
    const curSession = fresh.length ? fresh[fresh.length - 1].session : session;
    if (storyRow && storyRow.session === curSession) prior = storyRow.story;
    if (wake.includes('scribe')) {
      const slice = prior && storyRow.through > 0
        ? (await readLines(db, campaign, { after: storyRow.through })).lines
        : (await readLines(db, campaign, { since: new Date(t0 - SCRIBE_FIRST_MIN * 60 * 1000).toISOString() })).lines;
      let talk = formatLines(slice, speakers);
      if (talk.length > SCRIBE_SLICE_MAX) { talk = talk.slice(talk.length - SCRIBE_SLICE_MAX); talk = talk.slice(talk.indexOf('\n') + 1); }
      if (!talk) wake = wake.filter((n) => n !== 'scribe');
      else { scribeTurn = scribeUser({ story: prior, stamp: hhmm(t0), talk }); scribeThrough = slice.length ? slice[slice.length - 1].seq : storyRow ? storyRow.through : 0; }
    }
    storyText = prior;
    let held = null;
    if (!wake.length) {
      held = await heldRefs(db, campaign, t0);
      if (!held.length) return done([], flags, cursor);
    }

    const recentText = formatLines(tail, speakers);
    const user = 'Last four minutes, up to ' + hhmm(t0) + ':\n' + recentText;
    const voiceTurn = voiceUser({ npc, stamp: hhmm(t0), talk: recentText });
    // Showrunner and Mystery read a longer stretch than the Tap's four minutes (the Worker cannot afford the whole night): one read serves both
    const turns = {};
    if (wake.includes('showrunner') || wake.includes('mystery') || wake.includes('meanwhile')) {
      const wide = (await readLines(db, campaign, { since: new Date(t0 - SHOWRUNNER_MIN * 60 * 1000).toISOString() })).lines;
      if (wake.includes('showrunner')) turns.showrunner = showrunnerUser({ stamp: hhmm(t0), talk: formatLines(wide, speakers) });
      if (wake.includes('meanwhile')) turns.meanwhile = meanwhileUser({ clocks: await tableClocks(db, campaign), stamp: hhmm(t0), talk: formatLines(wide.filter((l) => Date.parse(l.at) >= t0 - MEANWHILE_MIN * 60 * 1000), speakers) });
      if (wake.includes('mystery')) {
        const from = t0 - MYSTERY_MIN * 60 * 1000;
        turns.mystery = mysteryUser({ stamp: hhmm(t0), talk: formatLines(wide.filter((l) => Date.parse(l.at) >= from), speakers), known: await lastKnown(db, campaign, t0) });
      }
    }
    let clerkNames = [];
    if (wake.includes('clerk')) { clerkNames = await clerkKnown(db, campaign, t0); turns.clerk = clerkUser({ known: clerkNames, stamp: hhmm(t0), talk: recentText }); }
    if (scribeTurn) turns.scribe = scribeTurn;
    // each woken seat is on its own deadline: a slow one cannot hold the others' cards. A seat another request took meanwhile is skipped, not an error.
    const settled = await Promise.allSettled(wake.map((name) => run(name, name === 'voice' ? voiceTurn : turns[name] || user)));
    const all = [];
    settled.forEach((x, i) => {
      const name = wake[i];
      if (x.status === 'fulfilled') { all.push({ name, ...x.value }); if (x.value && x.value.r) ran.push(name); }
      else if (x.reason && x.reason.busy) skipped.push({ seat: name, why: 'in-flight' });
      else all.push({ name, cfg: seats[name], r: null, timing: { secs: 0, stop: '' } });      // run() catches its own errors, so this is a bug's safety net
    });
    // Voice and Stall go to the Rack, not to the Editor's card slot
    const vx = all.find((x) => x.name === 'voice'), sx = all.find((x) => x.name === 'stall'), results = all.filter((x) => !['voice', 'stall', 'scribe', 'meanwhile'].includes(x.name));

    const recent = await shownCards(db, campaign, t0);
    const candidates = results.map((x) => (x.r ? toCandidate(x.name, x.r.json, { recent, now: t0, known: clerkNames }) : null));
    // a Ref card held back earlier waits in the log; it competes with this tick's own until it goes stale
    const pending = pendingRefs(held || await heldRefs(db, campaign, t0), { recent, now: t0 });
    const edit = merge(candidates.concat(pending), { now: t0, lastShownAt: await lastShown(db, campaign, t0), lastRefShownAt: await lastRefShown(db, campaign, t0) });
    const at = new Date(now()).toISOString();
    // a handout suggestion from the Mystery keeper: checked against the live handouts part (one small read, only when the seat named one), and
    // sent in its own field so it never takes the card slot
    const mx = all.find((x) => x.name === 'mystery');
    let handoutOut = null;
    if (mx && mx.r && mx.r.json && typeof mx.r.json.handout_id === 'string' && mx.r.json.handout_id.trim()) {
      const live = await liveHandouts(db, campaign);
      const h = toHandout(mx.r.json, live.ids, live.titles);
      if (h) handoutOut = { ...h, at };
    }
    const rows = results.map((x, i) => {
      const cand = candidates[i];
      const isShown = !!(cand && !cand.pending && edit.card && edit.card.seat === x.name && edit.card.text === cand.text);
      const held = !!(cand && cand.seat === 'ref' && edit.held.includes(cand));
      const isUpdate = !!(cand && cand.seat === 'ledger');
      const card = x.r ? { out: x.r.json, text: cand ? cand.text : '', keys: cand ? cand.keys : [], shown: isShown ? 1 : 0, ...(held ? { held: 1 } : {}), ...(cand && cand.detail ? { detail: cand.detail } : {}), ...(cand && cand.glance ? { glance: cand.glance } : {}), ...(isUpdate ? { update: 1, items: cand.items } : {}), ...(x.name === 'mystery' && handoutOut ? { handout: { id: handoutOut.id, why: handoutOut.why } } : {}) } : { error: errors.find((e) => e.seat === x.name)?.error || 'no reply' };
      return logRow(db, campaign, { at, session, seat: x.name, cfg: x.cfg, usage: x.r && x.r.usage, cost: x.r && x.r.cost, flags, card, timing: x.timing });
    });
    // a pending Ref card shown now has no row of its own this tick: record the showing (no cost) so the gap and repeats see it
    if (edit.card && edit.card.pending) rows.push(logRow(db, campaign, { at, session, seat: 'editor', cfg: { model: 'editor' }, flags, card: { seat: 'ref', text: edit.card.text, keys: edit.card.keys, ...(edit.card.detail ? { detail: edit.card.detail } : {}), ...(edit.card.glance ? { glance: edit.card.glance } : {}), shown: 1, from_pending: 1 } }));
    let voiceOut = null;
    if (vx) {
      const v = vx.r ? toVoice(vx.r.json, { recent: await shownVoice(db, campaign, t0), now: t0 }) : null;
      if (v) voiceOut = { kind: 'say', who: v.who, want: v.want, lines: v.lines, at };
      rows.push(logRow(db, campaign, { at, session, seat: 'voice', cfg: vx.cfg, usage: vx.r && vx.r.usage, cost: vx.r && vx.r.cost, flags, timing: vx.timing,
        card: vx.r ? { out: vx.r.json, ...(v ? { voice: 1, text: v.lines.join(' / '), keys: v.keys } : {}) } : { error: errors.find((e) => e.seat === 'voice')?.error || 'no reply' } }));
    }
    let stallOut = null;
    if (sx) {
      const st = sx.r ? toStall(sx.r.json, { recent: await shownVoice(db, campaign, t0), now: t0 }) : null;
      if (st) stallOut = { kind: st.kind, offer: st.offer, why: st.why, headline: st.headline, bullets: st.bullets, at };
      rows.push(logRow(db, campaign, { at, session, seat: 'stall', cfg: sx.cfg, usage: sx.r && sx.r.usage, cost: sx.r && sx.r.cost, flags, timing: sx.timing,
        card: sx.r ? { out: sx.r.json, ...(st ? { stall: 1, text: st.offer, keys: st.keys } : {}) } : { error: errors.find((e) => e.seat === 'stall')?.error || 'no reply' } }));
    }
    // the Scribe's row IS the story store (no migration); Meanwhile's cutaway goes to the Rack beside Voice and Stall
    const bx = all.find((x) => x.name === 'scribe');
    if (bx) {
      const sc = bx.r ? toScribe(bx.r.json, prior) : null;
      rows.push(logRow(db, campaign, { at, session, seat: 'scribe', cfg: bx.cfg, usage: bx.r && bx.r.usage, cost: bx.r && bx.r.cost, flags, timing: bx.timing,
        card: bx.r ? { out: bx.r.json, ...(sc ? { story: sc.story, through: scribeThrough, corrections: sc.corrections } : {}) } : { error: errors.find((e) => e.seat === 'scribe')?.error || 'no reply' } }));
    }
    let meanwhileOut = null;
    const wx = all.find((x) => x.name === 'meanwhile');
    if (wx) {
      const mw = wx.r ? toMeanwhile(wx.r.json) : null;
      if (mw) meanwhileOut = { ...mw, at };
      rows.push(logRow(db, campaign, { at, session, seat: 'meanwhile', cfg: wx.cfg, usage: wx.r && wx.r.usage, cost: wx.r && wx.r.cost, flags, timing: wx.timing,
        card: wx.r ? { out: wx.r.json, ...(mw ? { meanwhile: 1, text: mw.cutaway } : {}) } : { error: errors.find((e) => e.seat === 'meanwhile')?.error || 'no reply' } }));
    }
    if (rows.length) await db.batch(rows);
    const cardOut = edit.card ? [{ seat: edit.card.seat, at, text: edit.card.text, ...(edit.card.detail ? { detail: edit.card.detail } : {}), ...restoreGlance(edit.card, edit.card.seat) }] : [];
    const updatesOut = edit.updates.flatMap((u) => (u.items || [{ key: (u.keys || [])[0] || '', text: u.text }]).map((it) => ({ seat: 'ledger', at, key: it.key, text: it.text, ...ledgerGlance(it.text) })));
    return done(cardOut, flags, cursor, updatesOut, { voice: voiceOut, stall: stallOut, handout: handoutOut, meanwhile: meanwhileOut });
  };
}

export const onRequest = makeHandler();
