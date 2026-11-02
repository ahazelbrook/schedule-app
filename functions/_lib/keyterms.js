// A1: the key terms the table iPad passes to the speech-to-text stream when it opens (switch ai.keyterms).
// Plain ES, no I/O: buildKeyterms is pure. The token handler feeds it.
//
// The limit (Deepgram's keyterm docs): 500 tokens across all key terms per request, "focus on the most important 20-50 terms"; over it the
// connection is refused. So the list is capped at KEY_MAX terms and KEY_CHARS characters in all (about 4 characters a token, so well
// inside 500), counting the fixed term the stream already carries. Never an error: a list that is too long is cut, most important first.
//
// SECRECY: the answer reaches the iPad, so the list holds only what the table may know: PC names, NPCs the GM has REVEALED, factions
// the crew has standing with, and the districts those name. A hidden NPC's name is never a key term.

export const KEY_MAX = 40;           // terms (the fixed "Blade" included)
export const KEY_CHARS = 700;        // characters in all
export const KEY_ONE = 32;           // characters in one term
export const FIXED_TERMS = ['Blade'];

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clean = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim() : '');

/**
 * campaign: the pack's campaign part body ({ pcs, standing, ... }), or null. revealed: the revealed NPC documents ([{ name, alias }]).
 * -> ['Blade', ...] in importance order: PCs, revealed NPCs, factions, districts.
 */
export function buildKeyterms(campaign, revealed) {
  const c = isObj(campaign) ? campaign : {};
  const groups = [
    (Array.isArray(c.pcs) ? c.pcs : []).flatMap((p) => (isObj(p) ? [p.name, p.alias] : [])),
    (Array.isArray(revealed) ? revealed : []).flatMap((n) => (isObj(n) ? [n.name, n.alias] : [])),
    (Array.isArray(c.standing) ? c.standing : []).map((f) => (isObj(f) ? f.faction : '')),
    (Array.isArray(c.districts) ? c.districts : []).map((d) => (isObj(d) ? d.name : d)),
  ];
  const out = [], seen = new Set();
  let chars = 0;
  const add = (raw) => {
    const t = clean(raw);
    if (!t || t.length > KEY_ONE || /[&=#%]/.test(t)) return;
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    if (out.length >= KEY_MAX || chars + t.length > KEY_CHARS) return;
    seen.add(k); out.push(t); chars += t.length;
  };
  FIXED_TERMS.forEach(add);
  groups.forEach((g) => g.forEach(add));
  return out;
}

/** The query string for a list: each term its own `keyterm=` parameter, spaces as %20. '' for an empty list. */
export function keytermQuery(terms) {
  return (Array.isArray(terms) ? terms : []).map((t) => 'keyterm=' + encodeURIComponent(t)).join('&');
}
