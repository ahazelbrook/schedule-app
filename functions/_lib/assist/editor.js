// The Editor (build plan, "The Tap"): merges what the Tap seats (Ref, Clerk, Mystery, Showrunner, Ledger) returned into at most
// one card per five minutes (Ref beats Clerk beats Mystery beats Showrunner; a card held back by the gap is dropped, except Ref's), drops repeats, and lets silence be the normal answer. Ledger entries are state updates, not
// cards: they never use the card slot and come back in a separate list. A Ref card held back by the gap stays pending until
// it goes stale; a Clerk card held back is dropped. Pure code, no model call for now (the plan's Haiku
// Editor can replace pick() later without touching the endpoint). Plain ES module, node-importable.
//
// A "candidate" is what toCandidate() makes of one seat's JSON; the endpoint hands the candidates of one tick to merge().
// `recent` is the cards the GM was already shown: [{ at (ms), keys: [string] }], read from gm_assist_log by the caller.

import { isRepeatSlip, slipKeys, REPEAT_WINDOW_MS } from './conductor.js';
import { capStory } from './prompts.js';
import { REF_CHECKS, refGlance, clerkGlance, mysteryGlance, showrunnerGlance, stallGlance, meanwhileGlance, handoutGlance } from './glance.js';

export const CARD_GAP_MS = 5 * 60 * 1000;     // at most one card in this long
export const STALE_MS = 4 * 60 * 1000;        // a held-back Ref card older than this is no longer worth showing
export const REF_SAME_SAID_MS = 3 * 60 * 1000;     // two Ref cards for the same check whose said-at times are this close are one slip
export const REF_SAME_CHECK_MS = 4 * 60 * 1000;    // with a said-at missing from either, the same check this soon after the last card is a repeat
export const PRIORITY = { ref: 4, clerk: 3, mystery: 2, showrunner: 1 };   // a slip beats a canon note beats a clue push beats pacing; the ledger has no card to win

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clip = (s, n = 280) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const seenKeys = (recent, now, windowMs) => new Set(recent.filter((r) => Number.isFinite(r.at) && now - r.at < windowMs).flatMap((r) => r.keys || []));

/** "22:14" (or "22.14", "10:14 pm") -> minutes past midnight, or null when there is no time in it. */
export function sayMinutes(s) {
  const m = /(\d{1,2})\s*[:.h]\s*(\d{2})\b\s*([ap]\.?m\.?)?/i.exec(String(s || ''));
  if (!m) return null;
  let h = Number(m[1]); const mi = Number(m[2]);
  if (m[3]) { const pm = /^p/i.test(m[3]); h = (h % 12) + (pm ? 12 : 0); }
  return h > 23 || mi > 59 ? null : h * 60 + mi;
}

/** Minutes apart on the clock, either way round midnight. */
const clockGap = (a, b) => { const d = Math.abs(a - b) % 1440; return Math.min(d, 1440 - d); };

/**
 * The second repeat rule for Ref (the first is isRepeatSlip's keys): the same check twice in a row, said close together, is one
 * slip however the rule text is worded. recent: [{ at (ms), ref, check, said_at }] (shownCards). A Ref card shown in the last 10
 * minutes with the same, valid check is a repeat when both said-at times are within 3 minutes of each other; when either has no
 * said-at, when the checks match and that card was shown less than 4 minutes ago. No check never matches.
 */
export function isRepeatRef(json, recent = [], now = 0) {
  const check = json && REF_CHECKS.includes(json.check) ? json.check : '';
  if (!check) return false;
  const mine = sayMinutes(json.said_at);
  return recent.some((r) => {
    if (!r || !r.ref || r.check !== check || !Number.isFinite(r.at) || now - r.at >= REPEAT_WINDOW_MS) return false;
    const theirs = sayMinutes(r.said_at);
    return mine !== null && theirs !== null ? clockGap(mine, theirs) <= REF_SAME_SAID_MS / 60000 : now - r.at < REF_SAME_CHECK_MS;
  });
}

/** A name folded for comparison: accents stripped, lower case, anything but letters and digits collapsed to single spaces. */
export function foldName(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** True when the edit distance between a and b is 0 or 1 (insert, delete or substitute one character). */
function withinOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  const [s, l] = a.length < b.length ? [a, b] : [b, a];
  return s.slice(i) === l.slice(i + 1);
}

/** Is `name` one already noted? Same name once folded; or, for names of 5 letters or more, one edit apart (Varnek / Barnek / BARNEK). */
export function isKnownName(name, known = []) {
  const n = foldName(name);
  if (!n) return false;
  const long = n.replace(/ /g, '').length >= 5;
  return known.some((k) => { const f = foldName(k); return f && (f === n || (long && f.replace(/ /g, '').length >= 5 && withinOne(f, n))); });
}

/**
 * One Tap seat's JSON -> { seat, text, keys } or null when it has nothing worth a card (the usual case).
 * Clerk and Ledger items already shown in the last 10 minutes are left out first, so an overlapping window does not repeat them.
 * `known` (Clerk only): names already noted tonight or already in the cast; a new name that matches one is dropped, and a card left with nothing is null.
 */
export function toCandidate(seat, json, { recent = [], now = 0, known = [] } = {}) {
  if (!json || typeof json !== 'object') return null;
  if (seat === 'ref') {
    if (!json.slip || !clip(json.card)) return null;
    if (isRepeatSlip(json, recent, now) || isRepeatRef(json, recent, now)) return null;
    return { seat, text: clip(json.card), keys: slipKeys(json), detail: { said_at: json.said_at || '', rule: clip(json.rule, 200) },
      glance: refGlance({ card: clip(json.card), said_at: json.said_at, what_was_said: json.what_was_said, rule: clip(json.rule, 200), check: json.check }) };
  }
  const seen = seenKeys(recent, now, REPEAT_WINDOW_MS);
  if (seat === 'clerk') {
    const items = [];
    for (const n of json.new_names || []) if (!isKnownName(n, known)) items.push({ key: 'clerk:name:' + norm(n), text: 'New name: ' + clip(n, 60) });
    for (const d of json.drift || []) items.push({ key: 'clerk:drift:' + norm(d).slice(0, 80), text: 'Canon: ' + clip(d, 160) });
    for (const c of json.clues_landed || []) items.push({ key: 'clerk:clue:' + norm(c).slice(0, 80), text: 'Clue: ' + clip(c, 160) });
    const fresh = items.filter((i) => i.key !== 'clerk:name:' && !seen.has(i.key));
    if (!fresh.length) return null;
    return { seat, text: clip(fresh.map((i) => i.text).join(' / ')), keys: fresh.map((i) => i.key), glance: clerkGlance(fresh) };
  }
  if (seat === 'mystery') {
    // push_next must come from tonight's Must land list: the seat copies the entry into must_land_item. The Worker never holds
    // the prefix, so it cannot compare the text with the list; it drops a card that names no entry, or says it has none.
    const push = clip(json.push_next), item = clip(json.must_land_item, 200);
    if (!push || !item) return null;
    const keys = ['mystery:' + norm(push).slice(0, 80), 'mystery:item:' + norm(item).slice(0, 60)];
    if (keys.some((k) => seenKeys(recent, now, REPEAT_WINDOW_MS).has(k))) return null;
    return { seat, text: clip('Push next: ' + push + (clip(json.how) ? ' How: ' + clip(json.how) : '')), keys, glance: mysteryGlance({ push, how: clip(json.how), item }) };
  }
  if (seat === 'showrunner') {
    if (json.speak !== true) return null;                   // the Showrunner speaks only for a clear pacing problem
    const advice = clip(json.advice, 240), who = clip(json.needs_spotlight, 80);
    const named = who && !/^(none|nobody|no one|unknown|n\/a)\b/i.test(who);
    if (!advice && !named) return null;
    const key = 'showrunner:' + norm(advice || who).slice(0, 80);
    if (seenKeys(recent, now, REPEAT_WINDOW_MS).has(key)) return null;
    return { seat, text: clip((named ? 'Spotlight: ' + who + '. ' : '') + advice), keys: [key], glance: showrunnerGlance({ advice, who: named ? who : '' }) };
  }
  if (seat === 'ledger') {
    const items = [];
    for (const e of json.events || []) items.push({ key: 'ledger:' + norm([e.at, e.who, e.kind].join(' ')), text: [e.at, e.who, e.kind, e.note].filter(Boolean).join(' ') });
    if (json.xp_totalled) items.push({ key: 'ledger:xp', text: 'xp was totalled' });
    const fresh = items.filter((i) => !seen.has(i.key));
    if (!fresh.length) return null;
    return { seat, text: clip(fresh.map((i) => i.text).join(' / ')), keys: fresh.map((i) => i.key), items: fresh.map((i) => ({ key: i.key, text: clip(i.text, 280) })) };
  }
  return null;
}

/**
 * Held-back Ref rows from the log -> candidates still worth showing. rows: [{ at (ms), card: { text, keys, detail? } }] (the
 * Ref rows the Editor held back). Stale ones (older than STALE_MS) and ones whose slip was shown since are left out.
 */
export function pendingRefs(rows, { recent = [], now = 0 } = {}) {
  const out = [];
  for (const r of rows || []) {
    const c = r && r.card;
    if (!c || !c.text || !Number.isFinite(r.at) || now - r.at > STALE_MS) continue;
    const keys = c.keys || [];
    if (!keys.length || recent.some((x) => Number.isFinite(x.at) && now - x.at < REPEAT_WINDOW_MS && (x.keys || []).some((k) => keys.includes(k)))) continue;
    if (isRepeatRef({ check: c.glance && c.glance.check, said_at: c.detail && c.detail.said_at }, recent, now)) continue;
    out.push({ seat: 'ref', text: c.text, keys, ...(c.detail ? { detail: c.detail } : {}), ...(c.glance ? { glance: c.glance } : {}), pending: true, born: r.at });
  }
  return out;
}

/**
 * Candidates -> { card, updates, held, dropped }.
 *   updates: every Ledger candidate, untouched by the card gap (one-tap state updates).
 *   card: the one Ref or Clerk candidate to show (with `at` set to now) or null. Ref wins; when a Ref card is waiting the
 *     Clerk's is dropped, not queued. The gap (CARD_GAP_MS since `lastShownAt`) holds everything back.
 *   held: the Ref candidates that did not show (gap or outranked by a newer one); the caller keeps them pending.
 *   dropped: the rest, with a reason.
 * A pending Ref (from pendingRefs) and a fresh one for the same slip count once; the fresh one wins. Of several waiting Ref
 * cards the newest shows.
 */
export function merge(candidates, { now, lastShownAt = null, lastRefShownAt } = {}) {
  const list = (candidates || []).filter(Boolean);
  const updates = list.filter((c) => c.seat === 'ledger').map((c) => ({ ...c, at: now }));
  const fresh = list.filter((c) => c.seat === 'ref' && !c.pending);
  const refs = fresh.concat(list.filter((c) => c.seat === 'ref' && c.pending && !fresh.some((f) => (f.keys || []).some((k) => (c.keys || []).includes(k)))));
  refs.sort((a, b) => (b.born || now) - (a.born || now));
  // the rest compete for the slot in PRIORITY order (Clerk, then Mystery, then Showrunner) and are dropped, never queued
  const clerks = list.filter((c) => c.seat === 'clerk' || c.seat === 'mystery' || c.seat === 'showrunner').sort((a, b) => (PRIORITY[b.seat] || 0) - (PRIORITY[a.seat] || 0));
  const throttled = Number.isFinite(lastShownAt) && now - lastShownAt < CARD_GAP_MS;
  // Ref has priority: a slip is held back only by an earlier Ref card, never by a Clerk, Mystery or Showrunner card
  const refAt = lastRefShownAt === undefined ? lastShownAt : lastRefShownAt;
  const refThrottled = Number.isFinite(refAt) && now - refAt < CARD_GAP_MS;
  if (refs.length) {
    const dropped = clerks.map((c) => ({ seat: c.seat, why: 'ref-waiting' }));
    if (refThrottled) return { card: null, updates, held: refs, dropped: dropped.concat(refs.map(() => ({ seat: 'ref', why: 'throttle' }))) };
    const [top, ...rest] = refs;
    return { card: { ...top, at: now }, updates, held: rest, dropped: dropped.concat(rest.map(() => ({ seat: 'ref', why: 'outranked' }))) };
  }
  if (!clerks.length) return { card: null, updates, held: [], dropped: [] };
  if (throttled) return { card: null, updates, held: [], dropped: clerks.map((c) => ({ seat: c.seat, why: 'throttle' })) };
  const [top, ...rest] = clerks;
  return { card: { ...top, at: now }, updates, held: [], dropped: rest.map((c) => ({ seat: c.seat, why: 'outranked' })) };
}

// ---------- Handout ----------

export const HANDOUT_ID_MAX = 80;

/** The ids in the live `handouts` pack part ({ items: [{ id, ... }] }): a Set, empty when the part is missing or not that shape. */
export function handoutIds(part) {
  const out = new Set();
  if (!part || typeof part !== 'object' || !Array.isArray(part.items)) return out;
  for (const x of part.items) if (x && typeof x.id === 'string' && x.id && x.id.length <= HANDOUT_ID_MAX) out.add(x.id);
  return out;
}

/** The titles in the live `handouts` part: a Map id -> title (only items that have one). */
export function handoutTitles(part) {
  const out = new Map();
  if (!part || typeof part !== 'object' || !Array.isArray(part.items)) return out;
  for (const x of part.items) if (x && typeof x.id === 'string' && x.id && typeof x.title === 'string' && x.title.trim()) out.set(x.id, x.title.trim());
  return out;
}

/**
 * The Mystery seat's JSON -> { id, why, kind, headline, bullets } or null. An id that is empty, or not in the live handouts part (`ids`, from handoutIds), is
 * dropped: the model may only name a handout the GM actually has. A handout never uses the card slot: it goes in its own field of the
 * tick answer, so the Editor's merge() never sees it.
 */
export function toHandout(json, ids, titles = null) {
  if (!json || typeof json !== 'object' || typeof json.handout_id !== 'string') return null;
  const id = json.handout_id.trim();
  if (!id || !(ids instanceof Set) || !ids.has(id)) return null;
  const why = clip(json.handout_why, 200);
  return { id, why, ...handoutGlance({ id, title: titles instanceof Map ? titles.get(id) : '', why }) };
}

// ---------- Voice ----------

/**
 * The Voice seat's JSON -> { who, want, lines: [a, b], keys } or null (nobody on stage, no lines, or both lines already shown
 * in the last 10 minutes). Voice lines never use the card slot (they go to the Rack), but the Editor still keeps them from
 * repeating: a line already shown is dropped, and a repeat of both is nothing at all. `recent` is as for toCandidate.
 */
export function toVoice(json, { recent = [], now = 0 } = {}) {
  if (!json || typeof json !== 'object') return null;
  const who = clip(json.who, 60);
  if (!who) return null;
  const seen = seenKeys(recent, now, REPEAT_WINDOW_MS);
  const lines = [], keys = [];
  for (const l of [json.line_a, json.line_b]) {
    const text = clip(l, 400), k = 'voice:' + norm(text).slice(0, 80);
    if (!text || k === 'voice:' || seen.has(k) || keys.includes(k)) continue;
    lines.push(text); keys.push(k);
  }
  if (!lines.length) return null;
  return { who, want: clip(json.want, 200), lines, keys };
}

/** The Another seat's JSON -> { who, line, keys } or null (empty, or the same as a line already shown). */
export function toAnother(json, shown = []) {
  if (!json || typeof json !== 'object') return null;
  const line = clip(json.line, 400), k = 'voice:' + norm(line).slice(0, 80);
  if (!line || k === 'voice:' || shown.some((s) => 'voice:' + norm(s).slice(0, 80) === k)) return null;
  return { who: clip(json.who, 60), line, keys: [k] };
}

// ---------- Stall ----------

/**
 * The Stall seat's JSON -> { kind, offer, why, keys } or null (the table is not stalled, nothing offered, or this offer was
 * already shown in the last 10 minutes). The offer goes to the Rack, never the card slot. `recent` is as for toCandidate.
 */
export function toStall(json, { recent = [], now = 0 } = {}) {
  if (!json || typeof json !== 'object' || json.stalled !== true) return null;
  const offer = clip(json.offer, 400), k = 'stall:' + norm(offer).slice(0, 80);
  if (!offer || k === 'stall:' || seenKeys(recent, now, REPEAT_WINDOW_MS).has(k)) return null;
  const why = clip(json.why_now, 200);
  return { kind: ['complication', 'clue'].includes(json.kind) ? json.kind : 'complication', offer, why, keys: [k], ...stallGlance({ offer, why }) };
}

// ---------- Scribe and Meanwhile ----------

/**
 * The Scribe's JSON -> { story, corrections } or null (no story, or an empty one). The story is capped at STORY_MAX; a reply that
 * would shrink an existing story to almost nothing is refused, so a bad run cannot wipe the night's memory. prior: the story it was given.
 */
export function toScribe(json, prior = '') {
  if (!json || typeof json !== 'object' || typeof json.story !== 'string') return null;
  const story = capStory(json.story);
  if (!story) return null;
  if (prior && story.length < Math.min(400, prior.length) / 4) return null;
  const corrections = (Array.isArray(json.corrections) ? json.corrections : []).filter((c) => typeof c === 'string' && c.trim()).slice(0, 12).map((c) => clip(c, 120));
  return { story, corrections };
}

/**
 * The Meanwhile seat's JSON -> { faction, cutaway, clock, ticks, why } or null (nothing relevant, or no cutaway). The tick is only
 * a suggestion: a whole number 0 to 2, anything else reads as 0. It goes to the Rack, never the card slot.
 */
export function toMeanwhile(json) {
  if (!json || typeof json !== 'object') return null;
  const cutaway = clip(json.cutaway, 600);
  if (!cutaway) return null;
  const t = json.suggest_ticks;
  const clock = clip(json.clock, 100), ticks = Number.isInteger(t) && t >= 1 && t <= 2 ? t : 0;
  return { faction: clip(json.faction, 80), cutaway, clock, ticks, why: clip(json.why, 200), ...meanwhileGlance({ cutaway, clock, ticks }) };
}
