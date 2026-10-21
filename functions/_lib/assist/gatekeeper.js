// The gatekeeper's plain-code side (build plan, "the Screen"): validate an item, turn the seat's reply into a verdict that fails
// closed, and the helpers the later Screen work uses for Ref cards. No I/O and no clock, so the Worker and node both import it.
// The seat itself lives in seats.js; the endpoint is /api/gm/assist/gatekeeper (functions/api/gm/assist.js).

import { ITEM_KINDS, ITEM_MAX, CITES_MAX, CITE_MAX } from './prompts.js';

const squash = (s) => String(s).replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

/**
 * The body of a gatekeeper request -> { ok: true, item: { kind, text, cites } } or { ok: false, why }.
 * kind is one of ITEM_KINDS; text is a non-empty string of at most ITEM_MAX characters; cites (optional) is up to CITES_MAX
 * strings of at most CITE_MAX characters each.
 */
export function cleanItem(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return { ok: false, why: 'the body must be an object' };
  if (!ITEM_KINDS.includes(b.kind)) return { ok: false, why: 'kind is one of ' + ITEM_KINDS.join(', ') };
  if (typeof b.text !== 'string') return { ok: false, why: 'text is required' };
  const text = squash(b.text);
  if (!text) return { ok: false, why: 'text is required' };
  if (text.length > ITEM_MAX) return { ok: false, why: 'text is at most ' + ITEM_MAX + ' characters' };
  let cites = [];
  if (b.cites !== undefined && b.cites !== null) {
    if (!Array.isArray(b.cites) || b.cites.length > CITES_MAX) return { ok: false, why: 'cites is at most ' + CITES_MAX + ' strings' };
    for (const c of b.cites) {
      if (typeof c !== 'string') return { ok: false, why: 'each cite is a string' };
      const t = c.replace(/\s+/g, ' ').trim();
      if (t.length > CITE_MAX) return { ok: false, why: 'each cite is at most ' + CITE_MAX + ' characters' };
      if (t) cites.push(t);
    }
  }
  return { ok: true, item: { kind: b.kind, text, cites } };
}

const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).slice(0, 10).map((x) => x.replace(/\s+/g, ' ').trim().slice(0, 300)) : []);

/**
 * The seat's JSON -> { verdict, unknown, reasons, revealed, rule, cites_bad }. Fails closed: no JSON, a refusal, a reply cut off
 * at the limit, or a verdict that is neither pass nor block is { verdict: 'block', unknown: true }. A pass that also lists a
 * revealed entry or a rule problem is a block. cites_bad never blocks by itself (a bad cite is flagged, the card is not held).
 */
export function verdictOf(json, stop = '') {
  if (!json || typeof json !== 'object' || stop === 'refusal' || stop === 'max_tokens' || (json.verdict !== 'pass' && json.verdict !== 'block')) {
    return { verdict: 'block', unknown: true, reasons: ['no verdict from the gatekeeper: treat as blocked'], revealed: [], rule: [], cites_bad: [] };
  }
  const out = { verdict: json.verdict, unknown: false, reasons: list(json.reasons), revealed: list(json.revealed), rule: list(json.rule), cites_bad: list(json.cites_bad) };
  if (out.verdict === 'pass' && (out.revealed.length || out.rule.length)) {
    out.verdict = 'block';
    out.reasons.push('the check listed a problem, so the verdict is block');
  }
  return out;
}

/** A verdict for when the check could not run at all (no prefix, file gone, provider failed). Blocks, unknown. */
export function unknownVerdict(why) {
  return { verdict: 'block', unknown: true, reasons: [why], revealed: [], rule: [], cites_bad: [] };
}

// ---------- Ref cites (for the later Screen work; the Ref flow is unchanged) ----------

const CITE_RE = /\b(?:pp?\.|pages?)\s*\d{1,3}(?:\s*[-–]\s*\d{1,3})?/gi;

/** The page cites in a text ("p.274", "pp. 12-13", "page 9"), in order, without repeats. */
export function extractCites(text) {
  const seen = new Set(), out = [];
  for (const m of String(text || '').matchAll(CITE_RE)) {
    const c = m[0].replace(/\s+/g, ' ').trim();
    if (!seen.has(c.toLowerCase())) { seen.add(c.toLowerCase()); out.push(c); }
  }
  return out.slice(0, CITES_MAX);
}

/**
 * A Ref card (the Editor's { text, detail: { rule } }, or the seat's { card, rule }) as a gatekeeper item, or null when it carries
 * no page cite (nothing to spot-check, so no call and no cost). The Screen work calls this, then the endpoint, only for cards it
 * means to check; the Ref flow itself never does.
 */
export function refCardItem(card) {
  if (!card || typeof card !== 'object') return null;
  const rule = (card.detail && card.detail.rule) || card.rule || '';
  const text = squash(String(card.text || card.card || ''));
  const cites = extractCites(rule + ' ' + text);
  if (!cites.length || !text) return null;
  return { kind: 'card', text: (text + (rule ? '\nRule: ' + squash(String(rule)) : '')).slice(0, ITEM_MAX), cites };
}
