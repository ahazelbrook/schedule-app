// The Editor (build plan, "The Tap"): merges what the Tap seats (Ref, Clerk, Ledger) returned into at most one card per
// five minutes, drops repeats, and lets silence be the normal answer. Pure code, no model call for now (the plan's Haiku
// Editor can replace pick() later without touching the endpoint). Plain ES module, node-importable.
//
// A "candidate" is what toCandidate() makes of one seat's JSON; the endpoint hands the candidates of one tick to merge().
// `recent` is the cards the GM was already shown: [{ at (ms), keys: [string] }], read from gm_assist_log by the caller.

import { isRepeatSlip, slipKeys, REPEAT_WINDOW_MS } from './conductor.js';

export const CARD_GAP_MS = 5 * 60 * 1000;     // at most one card in this long
export const PRIORITY = { ref: 3, ledger: 2, clerk: 1 };   // a slip beats a ledger entry beats a canon note

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
    return { seat, text: clip(fresh.map((i) => i.text).join(' / ')), keys: fresh.map((i) => i.key) };
  }
  return null;
}

/**
 * Candidates -> { card, dropped }. card is the one candidate to show (with `at` set to now) or null; dropped lists the rest
 * with a reason (throttle, outranked). `lastShownAt` is the ms time of the last card shown, or null/undefined.
 */
export function merge(candidates, { now, lastShownAt = null } = {}) {
  const list = (candidates || []).filter(Boolean);
  if (!list.length) return { card: null, dropped: [] };
  if (Number.isFinite(lastShownAt) && now - lastShownAt < CARD_GAP_MS) {
    return { card: null, dropped: list.map((c) => ({ seat: c.seat, why: 'throttle' })) };
  }
  const ranked = list.slice().sort((a, b) => (PRIORITY[b.seat] || 0) - (PRIORITY[a.seat] || 0));
  const [top, ...rest] = ranked;
  return { card: { ...top, at: now }, dropped: rest.map((c) => ({ seat: c.seat, why: 'outranked' })) };
}
