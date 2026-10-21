// The Editor (build plan, "The Tap"): merges what the Tap seats (Ref, Clerk, Ledger) returned into at most one card per
// five minutes (Ref beats Clerk), drops repeats, and lets silence be the normal answer. Ledger entries are state updates, not
// cards: they never use the card slot and come back in a separate list. A Ref card held back by the gap stays pending until
// it goes stale; a Clerk card held back is dropped. Pure code, no model call for now (the plan's Haiku
// Editor can replace pick() later without touching the endpoint). Plain ES module, node-importable.
//
// A "candidate" is what toCandidate() makes of one seat's JSON; the endpoint hands the candidates of one tick to merge().
// `recent` is the cards the GM was already shown: [{ at (ms), keys: [string] }], read from gm_assist_log by the caller.

import { isRepeatSlip, slipKeys, REPEAT_WINDOW_MS } from './conductor.js';

export const CARD_GAP_MS = 5 * 60 * 1000;     // at most one card in this long
export const STALE_MS = 4 * 60 * 1000;        // a held-back Ref card older than this is no longer worth showing
export const PRIORITY = { ref: 2, clerk: 1 };   // a slip beats a canon note; the ledger has no card to win

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const clip = (s, n = 280) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const seenKeys = (recent, now, windowMs) => new Set(recent.filter((r) => Number.isFinite(r.at) && now - r.at < windowMs).flatMap((r) => r.keys || []));

/**
 * One Tap seat's JSON -> { seat, text, keys } or null when it has nothing worth a card (the usual case).
 * Clerk and Ledger items already shown in the last 10 minutes are left out first, so an overlapping window does not repeat them.
 */
export function toCandidate(seat, json, { recent = [], now = 0 } = {}) {
  if (!json || typeof json !== 'object') return null;
  if (seat === 'ref') {
    if (!json.slip || !clip(json.card)) return null;
    if (isRepeatSlip(json, recent, now)) return null;
    return { seat, text: clip(json.card), keys: slipKeys(json), detail: { said_at: json.said_at || '', rule: clip(json.rule, 200) } };
  }
  const seen = seenKeys(recent, now, REPEAT_WINDOW_MS);
  if (seat === 'clerk') {
    const items = [];
    for (const n of json.new_names || []) items.push({ key: 'clerk:name:' + norm(n), text: 'New name: ' + clip(n, 60) });
    for (const d of json.drift || []) items.push({ key: 'clerk:drift:' + norm(d).slice(0, 80), text: 'Canon: ' + clip(d, 160) });
    for (const c of json.clues_landed || []) items.push({ key: 'clerk:clue:' + norm(c).slice(0, 80), text: 'Clue: ' + clip(c, 160) });
    const fresh = items.filter((i) => i.key !== 'clerk:name:' && !seen.has(i.key));
    if (!fresh.length) return null;
    return { seat, text: clip(fresh.map((i) => i.text).join(' / ')), keys: fresh.map((i) => i.key) };
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
    out.push({ seat: 'ref', text: c.text, keys, ...(c.detail ? { detail: c.detail } : {}), pending: true, born: r.at });
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
export function merge(candidates, { now, lastShownAt = null } = {}) {
  const list = (candidates || []).filter(Boolean);
  const updates = list.filter((c) => c.seat === 'ledger').map((c) => ({ ...c, at: now }));
  const fresh = list.filter((c) => c.seat === 'ref' && !c.pending);
  const refs = fresh.concat(list.filter((c) => c.seat === 'ref' && c.pending && !fresh.some((f) => (f.keys || []).some((k) => (c.keys || []).includes(k)))));
  refs.sort((a, b) => (b.born || now) - (a.born || now));
  const clerks = list.filter((c) => c.seat === 'clerk');
  const throttled = Number.isFinite(lastShownAt) && now - lastShownAt < CARD_GAP_MS;
  if (refs.length) {
    const dropped = clerks.map(() => ({ seat: 'clerk', why: 'ref-waiting' }));
    if (throttled) return { card: null, updates, held: refs, dropped: dropped.concat(refs.map(() => ({ seat: 'ref', why: 'throttle' }))) };
    const [top, ...rest] = refs;
    return { card: { ...top, at: now }, updates, held: rest, dropped: dropped.concat(rest.map(() => ({ seat: 'ref', why: 'outranked' }))) };
  }
  if (!clerks.length) return { card: null, updates, held: [], dropped: [] };
  if (throttled) return { card: null, updates, held: [], dropped: clerks.map(() => ({ seat: 'clerk', why: 'throttle' })) };
  const [top, ...rest] = clerks;
  return { card: { ...top, at: now }, updates, held: [], dropped: rest.map(() => ({ seat: 'clerk', why: 'outranked' })) };
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
