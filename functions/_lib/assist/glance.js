// The glance fields (design 3.6): every card the panel shows carries { kind, headline, bullets } (and cite / check where they apply),
// next to the `text` and `detail` the older page already reads. This module is pure and builds them in one place; editor.js calls it from
// each to*() function (so a glance is made from the items that survived de-duplication), assist.js passes them through, and
// cards.js restores them from a log row. An old row with no glance fields restores as { kind (by seat), headline: text, bullets: [] }.
// Nothing here ever returns a `secret`: that field belongs to Ask Blade's answer alone.

import { extractCites } from './gatekeeper.js';
import { ASK_HEADLINE_MAX, ASK_BULLET_MAX, ASK_BULLETS_MAX } from './prompts.js';

/** The kind each seat's card wears (design 3.2 / 3.6). Ask picks its own; Stall's `kind` stays complication|clue for the Rack. */
export const GLANCE_KIND = { ref: 'rule', clerk: 'note', mystery: 'idea', showrunner: 'idea', ledger: 'note', fixer: 'say', voice: 'say', stall: 'idea', meanwhile: 'idea', handout: 'idea' };
export const GLANCE_KINDS = ['rule', 'say', 'idea', 'done', 'warn', 'note'];
export const REF_CHECKS = ['order', 'resist', 'harm', 'cost', 'house', 'other'];
export const CITE_MAX_CHARS = 40;

const one = (v, max) => {
  const s = String(typeof v === 'string' ? v : '').replace(/\s+/g, ' ').trim();
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
};

/** A glance headline: one line, at most ASK_HEADLINE_MAX characters. */
export const headlineOf = (v) => one(v, ASK_HEADLINE_MAX);

/** Bullets: the non-empty strings, one line each, at most ASK_BULLET_MAX characters, at most ASK_BULLETS_MAX of them. */
export function bulletsOf(list) {
  return (Array.isArray(list) ? list : []).map((b) => one(b, ASK_BULLET_MAX)).filter(Boolean).slice(0, ASK_BULLETS_MAX);
}

/**
 * The page cite in a Ref rule ("p.32", "pp. 12-13"), or '' when there is none. Pure; the same pattern as the panel's citesOf (the
 * extraction itself is gatekeeper.js's extractCites). Up to three cites, joined with ", ".
 */
export function citeOf(rule) {
  return one(extractCites(rule).slice(0, 3).join(', '), CITE_MAX_CHARS);
}

/** The first sentence of a text and the rest: ["First one.", "The rest."]. A text with no full stop in it is all headline. */
export function splitSentence(text) {
  const s = String(typeof text === 'string' ? text : '').replace(/\s+/g, ' ').trim();
  const m = /^(.+?[.!?])(?:\s+(.*))?$/.exec(s);
  return m ? [m[1], m[2] || ''] : [s, ''];
}

/** { kind, headline, bullets, ...extra } with every field cleaned; extra keys with an empty value are left out. */
export function glance(kind, headline, bullets, extra = {}) {
  const g = { kind, headline: headlineOf(headline), bullets: bulletsOf(bullets) };
  for (const k of ['cite', 'check']) if (extra[k]) g[k] = extra[k];
  return g;
}

/** Ref's slip: headline = the card line; bullets = what was said (and when), then the rule with its page; cite from the rule; check when valid. */
export function refGlance({ card, said_at, what_was_said, rule, check }) {
  const said = one(what_was_said, 400);
  const at = one(said_at, 20);
  return glance('rule', card, [said ? (at ? '[' + at + '] ' : '') + said : '', rule], { cite: citeOf(rule), check: REF_CHECKS.includes(check) ? check : '' });
}

/** The Clerk's surviving items ([{ text }]): the first is the headline and the rest are the bullets. */
export function clerkGlance(items) {
  const t = (items || []).map((i) => i.text);
  return glance('note', t[0], t.slice(1));
}

/** Mystery's push: headline = the push; bullets = how, then the Must land entry. */
export function mysteryGlance({ push, how, item }) {
  return glance('idea', push, [how, item ? 'Must land: ' + item : '']);
}

/** The Showrunner's advice: headline = the advice (or the spotlight when there is none); bullets = who needs the spotlight. */
export function showrunnerGlance({ advice, who }) {
  return advice ? glance('idea', advice, [who ? 'Spotlight: ' + who : '']) : glance('idea', 'Spotlight: ' + who, []);
}

/** Stall's offer. No kind here: the answer's own `kind` (complication | clue) is read by the Rack and stays as it is. */
export function stallGlance({ offer, why }) {
  const { headline, bullets } = glance('idea', offer, [why]);
  return { headline, bullets };
}

/** A Meanwhile cutaway: headline = its first sentence; bullets = the rest, then the suggested tick. */
export function meanwhileGlance({ cutaway, clock, ticks }) {
  const [first, rest] = splitSentence(cutaway);
  return glance('idea', first, [rest, ticks > 0 ? 'Tick ' + (clock || 'the clock') + ' +' + ticks : '']);
}

/** A handout offer: "Show handout: <title>?" (the id when the part has no title); bullets = why. */
export function handoutGlance({ id, title, why }) {
  return glance('idea', 'Show handout: ' + (one(title, 60) || id) + '?', [why]);
}

/** A Fixer card and a Voice answer: kind alone (they keep their Rack layouts); the Fixer's headline is its `read`. */
export function fixerGlance(read) { return glance('say', read, []); }

/** A Ledger item (one tick update, or one restored item): a note whose headline is its text, whole (a Ledger line is short already). */
export function ledgerGlance(text) { return { kind: 'note', headline: String(text || ''), bullets: [] }; }

/**
 * The glance of a logged card, for GET /cards and a held Ref coming back. `c` is the row's card JSON, `seat` the derived seat
 * (an Editor row is a ref). A row written since this ticket carries c.glance and is cleaned again; an older row has none and
 * restores as { kind by seat, headline: text (unclipped), bullets: [] }.
 */
export function restoreGlance(c, seat) {
  const text = typeof (c && c.text) === 'string' ? c.text : '';
  const g = c && c.glance && typeof c.glance === 'object' ? c.glance : null;
  if (g && typeof g.headline === 'string' && g.headline.trim()) {
    const out = glance(GLANCE_KINDS.includes(g.kind) ? g.kind : GLANCE_KIND[seat] || 'note', g.headline, g.bullets, { cite: one(g.cite, CITE_MAX_CHARS), check: REF_CHECKS.includes(g.check) ? g.check : '' });
    return out;
  }
  return { kind: GLANCE_KIND[seat] || 'note', headline: text, bullets: [] };
}
