// The phones' table screen (MM1, design 2.4): a copy of what the iPad is showing, for a map (kind 'svg') and a handout (kind 'handout')
// and for nothing else. Plain ES, no Cloudflare imports (node loads it in the checks).
//
//   loadTableScreen(db, campaign) -> { seq, kind: 'none' }
//                                  | { seq, kind: 'svg', svg, title?, caption? }
//                                  | { seq, kind: 'handout', file, title? }
//
// It fails closed. Anything but a map or a handout (blank, lights out, an NPC, text, a rule, cards), the mirror switch off, nothing
// stored, a malformed row, or a hit on the hidden-name scan all answer { seq, kind: 'none' }. The picture is read straight out of the
// stored display with json_extract, so it is the very string the iPad was given (no parse and no re-serialise in the Worker), and
// the answer is built field by field: no other key of the stored display can ride along.
//
// The hidden-name scan (belt and braces: the display already passed the GM page's gate to reach the iPad) runs namesHit over what is
// returned: title, caption and the svg (or the handout's title and file name). Choice made: a hit REFUSES the whole screen
// ({ seq, kind: 'none' }) rather than redacting, because a half-cleaned map is a guess about what the players may see.

import { LIMITS, HANDOUT_FILE_RE, namesHit, loadHiddenNames, byteLength } from './gm.js';
import { MIRROR_SQL, mirrorFlagOf, screenKind } from './live.js';

const none = (seq) => ({ seq: Number.isInteger(seq) ? seq : 0, kind: 'none' });

// One statement: the mirror switch and the display. The big columns (svg, file...) are extracted only while the mirror is not off and
// the kind is the one that owns them. The LEFT JOIN keeps a row when no display is stored.
const SCREEN_SQL = `SELECT d.seq AS seq, m.mirror AS mirror,
    CASE WHEN m.mirror IS NOT 'false' AND json_valid(d.doc) THEN json_extract(d.doc, '$.kind') END AS kind,
    CASE WHEN m.mirror IS NOT 'false' AND json_valid(d.doc) AND json_extract(d.doc, '$.kind') IN ('svg', 'handout') THEN json_extract(d.doc, '$.title') END AS title,
    CASE WHEN m.mirror IS NOT 'false' AND json_valid(d.doc) AND json_extract(d.doc, '$.kind') = 'svg' THEN json_extract(d.doc, '$.caption') END AS caption,
    CASE WHEN m.mirror IS NOT 'false' AND json_valid(d.doc) AND json_extract(d.doc, '$.kind') = 'svg' THEN json_extract(d.doc, '$.svg') END AS svg,
    CASE WHEN m.mirror IS NOT 'false' AND json_valid(d.doc) AND json_extract(d.doc, '$.kind') = 'handout' THEN json_extract(d.doc, '$.file') END AS file,
    CASE WHEN m.mirror IS NOT 'false' AND json_valid(d.doc) AND json_extract(d.doc, '$.kind') = 'handout' THEN json_extract(d.doc, '$.showTitle') END AS showTitle
  FROM (SELECT (SELECT ${MIRROR_SQL} FROM campaigns WHERE id = ?2) AS mirror) m
  LEFT JOIN gm_display d ON d.campaign = ?1`;

// ---------- the hidden-name scan ----------
const ASCII_ONLY = /^[\x00-\x7f]*$/;
// the characters NFKC rewrites into letters (compatibility forms: full-width, ligatures, super- and subscripts, letterlike, enclosed, width variants,
// mathematical alphanumerics) and a few Latin ones; a view without any is the same text folded or not
const FOLDS = /[ ª²-¶¸-º¼-¾ĲĳĿŀŉſǄ-ǌǱ-ǳʰ-ʸᴬ-ᶿẚẛ - ⁰-₟℀-↏①-⓿ⱼⱽ　-㏿ﬀ-ﭏ︰-﹯＀-￯]|[\ud835\ud83c]/;
const nfkc = (s) => (ASCII_ONLY.test(s) ? s : s.normalize('NFKC'));

function decodeEntities(s) {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|(amp|lt|gt|quot|apos|nbsp));/g, (m, dec, hex, named) => {
    if (named) return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }[named];
    const cp = dec !== undefined ? parseInt(dec, 10) : parseInt(hex, 16);
    try { return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m; } catch (_) { return m; }
  });
}

/** The ways a name could be read out of an svg's source: as written, with entities decoded, as its text (tags to a space), and as its
 *  text with the tags simply removed (a name split over several <tspan>s). */
export function svgViews(svg) {
  const decoded = decodeEntities(svg);
  const spaced = decodeEntities(svg.replace(/<[^>]*>/g, ' '));
  const glued = decodeEntities(svg.replace(/<[^>]*>/g, ''));
  return [...new Set([svg, decoded, spaced, glued])];
}

/**
 * true when any of `views` holds any of `names` (namesHit's rule, whole word, any case, NFKC folded). The cost guard: a Worker has 10 ms
 * of CPU, and namesHit builds a unicode regex per name and reads the whole text each time, which on a 600 KiB map and a long list of
 * names would not fit. So each view is lower-cased ONCE and a name is passed to namesHit only when the view holds its longest word
 * (a necessary condition for a hit). A name or a view with a non-ASCII character is folded first (NFKC, as namesHit does), so the
 * test stays necessary; a name under two characters is ignored, as namesHit ignores it.
 */
export function hiddenNameHit(views, names) {
  const list = (Array.isArray(names) ? names : []).filter((n) => typeof n === 'string');
  if (!list.length) return false;
  const needles = list.map((n) => {
    const folded = nfkc(n).replace(/\s+/g, ' ').trim();
    if (folded.length < 2) return null;
    const word = folded.split(' ').reduce((a, b) => (b.length > a.length ? b : a), '');
    return { name: n, needle: word.toLowerCase() };
  }).filter(Boolean);
  if (!needles.length) return false;
  // ONE pattern over every name's longest word answers "could any name be in this view?" in a single pass (40 indexOf passes over a
  // 600 KiB map cost about 9 ms; this costs a fraction of one); only when it matches are the names tried one by one
  const any = new RegExp(needles.map((x) => x.needle.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|'));
  for (const view of views) {
    if (typeof view !== 'string' || !view) continue;
    // NFKC only where it can change a letter: a map's text is full of ordinary non-ASCII marks (a dot, a curly quote, an arrow) that
    // NFKC leaves alone, and folding a 600 KiB view for one of them would double the cost (4 ms against 2 ms in node)
    const ascii = ASCII_ONLY.test(view), fold = !ascii && FOLDS.test(view);
    const folded = (fold ? view.normalize('NFKC') : view).toLowerCase(), plain = fold ? view.toLowerCase() : null;
    if (!any.test(folded) && !(plain !== null && any.test(plain))) continue;
    for (const { name, needle } of needles) {
      if ((folded.indexOf(needle) >= 0 || (plain !== null && plain.indexOf(needle) >= 0)) && namesHit(view, [name])) return true;
    }
  }
  return false;
}

/** true when the screen's own text (title, caption, the svg or the file name) holds a hidden name. */
export function screenHitsHidden(parts, names) {
  const views = [];
  for (const p of parts) {
    if (typeof p !== 'string' || !p) continue;
    if (p.charCodeAt(0) === 60 /* < */) views.push(...svgViews(p));
    else { views.push(p); const loose = p.replace(/[-_.]+/g, ' '); if (loose !== p) views.push(loose); }   // a file name reads "odalys-venn.png" as "odalys venn png"
  }
  return hiddenNameHit(views, names);
}

/** The row -> the answer, before the name scan (null: nothing to scan, the answer is { seq, kind: 'none' }). */
export function screenCandidate(row) {
  if (!row) return null;
  const seq = row.seq;
  if (mirrorFlagOf(row.mirror) !== true) return null;
  if (!Number.isInteger(seq) || seq < 1 || !screenKind(row.kind)) return null;
  const out = { seq, kind: row.kind };
  if (row.kind === 'svg') {
    if (typeof row.svg !== 'string' || !/^<svg[\s>/]/i.test(row.svg) || byteLength(row.svg) > LIMITS.svg) return null;
    if (typeof row.title === 'string' && row.title) out.title = row.title;
    if (typeof row.caption === 'string' && row.caption) out.caption = row.caption;
    out.svg = row.svg;
  } else {
    // a handout: the file name only (served from media/handouts/ by the static server), and a title only when the iPad shows it
    if (typeof row.file !== 'string' || !HANDOUT_FILE_RE.test(row.file) || row.file.includes('..')) return null;
    out.file = row.file;
    if (row.showTitle === 1 && typeof row.title === 'string' && row.title) out.title = row.title;
  }
  return out;
}

export async function loadTableScreen(db, campaign) {
  const row = await db.prepare(SCREEN_SQL).bind(campaign, campaign + '#gm').first();
  const seq = row && Number.isInteger(row.seq) ? row.seq : 0;
  const out = screenCandidate(row);
  if (!out) return none(seq);
  const names = await loadHiddenNames(db, campaign);
  if (screenHitsHidden([out.title, out.caption, out.kind === 'svg' ? out.svg : out.file], names)) return none(seq);
  return out;
}
