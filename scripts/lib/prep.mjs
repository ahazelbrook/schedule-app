// The prep notes (GM.md, "Prep"): reading a note line by line the way app/markdown.js renders it, so the exporter
// (lib/prep-export.mjs) and the pull (lib/sync-prep.mjs) agree on every task box without a block id in the note.
//
// A task's anchor is a hash of: the note's vault path, the heading it sits under ("### B"), its text (normalised) and
// how many tasks with the same heading and text come before it. It survives edits elsewhere in the note, renaming the
// note's title or a parent section, and a move of the section; rewording the task, or moving it under another heading,
// makes it a new task (the old tick is then reported, never guessed onto another line).
//
// Pure: no file system, no vault paths. Nothing here holds or prints note text.

import crypto from 'node:crypto';

const RE_QUOTE = /^ {0,3}> ?/;
const RE_FENCE = /^ {0,3}(`{3,}|~{3,})/;
const RE_HEAD = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const RE_TASK = /^( *)([-*+]|\d{1,9}[.)]) +\[([ xX])\][ \t]+(.*)$/;
const RE_EMBED = /^\s*!\[\[([^\[\]\n]+)\]\]\s*$/;
const MEDIA = /\.(png|jpe?g|gif|svg|webp|avif|bmp|ico|heic|tiff?|pdf|mp3|mp4|m4a|ogg|oga|wav|webm|mov|mkv|flac|canvas|base)$/i;

const bare = (l) => l.replace(/\r$/, '');

/** A task's text as both sides compare it: no trailing block id, whitespace collapsed. */
export function normText(s) {
  return String(s == null ? '' : s).replace(/\s+\^[A-Za-z0-9-]+\s*$/, '').replace(/\s+/g, ' ').trim();
}
/** A heading as Obsidian matches it in [[note#Heading]]: whitespace collapsed, case kept (compare lower-cased as a fallback). */
export function normHeading(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }

export function anchorOf(rel, path, text, n) {
  return 't' + crypto.createHash('sha1').update(rel + '\u0000' + path + '\u0000' + text + '\u0000' + n).digest('hex').slice(0, 12);
}

/** Lines that are Markdown: frontmatter, %% comments %% and fenced code are masked out (false). */
function mask(lines) {
  const ok = new Array(lines.length).fill(true);
  let i = 0;
  if (lines.length && bare(lines[0]).trim() === '---') {
    ok[0] = false;
    for (i = 1; i < lines.length; i++) { ok[i] = false; const t = bare(lines[i]).trim(); if (t === '---' || t === '...') { i++; break; } }
  }
  let fence = null, comment = false;
  for (; i < lines.length; i++) {
    let s = bare(lines[i]);
    while (RE_QUOTE.test(s)) s = s.replace(RE_QUOTE, '');
    if (comment) { ok[i] = false; if ((s.match(/%%/g) || []).length % 2 === 1) comment = false; continue; }
    if (!fence && (s.match(/%%/g) || []).length % 2 === 1) { ok[i] = false; comment = true; continue; }
    const m = RE_FENCE.exec(s);
    if (fence) { ok[i] = false; if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null; continue; }
    if (m) { fence = m[1]; ok[i] = false; }
  }
  return ok;
}

/**
 * Every heading and task box of a note's text.
 *   headings [{ line, level, text }]   (top level only: not inside a callout)
 *   tasks    [{ line, col (index of the box's inner character), done, text, path, n, anchor }]
 */
export function scanNote(text, rel) {
  const lines = String(text).split('\n'), ok = mask(lines), headings = [], tasks = [], stack = [], seen = new Map();
  lines.forEach((raw, i) => {
    if (!ok[i]) return;
    let s = bare(raw), pre = 0;
    while (RE_QUOTE.test(s)) { const q = RE_QUOTE.exec(s)[0]; pre += q.length; s = s.slice(q.length); }
    let m;
    if (!pre && (m = RE_HEAD.exec(s))) {
      const level = m[1].length, t = normHeading(m[2]);
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, text: t });
      headings.push({ line: i, level, text: t });
      return;
    }
    if ((m = RE_TASK.exec(s))) {
      /* the task's own heading only: renaming the note's title or a parent section keeps every anchor */
      const t = normText(m[4]), top = stack[stack.length - 1], path = top ? '#'.repeat(top.level) + ' ' + top.text : '';
      const key = path + '\u0000' + t, n = seen.get(key) || 0;
      seen.set(key, n + 1);
      const col = pre + s.indexOf('[', m[1].length + m[2].length) + 1;
      tasks.push({ line: i, col, done: m[3] !== ' ', text: t, path, n, anchor: anchorOf(rel, path, t, n) });
    }
  });
  return { lines, headings, tasks };
}

/** The section under a heading, Obsidian's rule: to the next heading of the same or a higher level. { start, end, level, text } or null. */
export function sectionOf(scan, heading) {
  const want = normHeading(heading), lower = want.toLowerCase();
  const hit = scan.headings.find((h) => h.text === want) || scan.headings.find((h) => h.text.toLowerCase() === lower);
  if (!hit) return null;
  const next = scan.headings.find((h) => h.line > hit.line && h.level <= hit.level);
  return { start: hit.line, end: next ? next.line : scan.lines.length, level: hit.level, text: hit.text };
}

/** A line that is a transclusion on its own, ![[page#heading]]: { page, heading } or null (pictures and the like: null). */
export function embedOf(line) {
  const m = RE_EMBED.exec(bare(line));
  if (!m) return null;
  const inner = m[1], bar = inner.indexOf('|'), target = (bar < 0 ? inner : inner.slice(0, bar)).trim();
  const hash = target.indexOf('#'), page = (hash < 0 ? target : target.slice(0, hash)).trim(), heading = hash < 0 ? '' : target.slice(hash + 1).trim();
  if (!page || MEDIA.test(page) || heading.startsWith('^')) return null;
  return { page, heading };
}

/** The line where a note's Markdown starts (after the frontmatter). */
export function bodyStart(lines) {
  if (!lines.length || bare(lines[0]).trim() !== '---') return 0;
  for (let i = 1; i < lines.length; i++) { const t = bare(lines[i]).trim(); if (t === '---' || t === '...') return i + 1; }
  return 0;
}

/**
 * Match the renderer's task boxes (in document order, { text }) to the scanned tasks of the same lines, in order.
 * Returns one entry per rendered box: the scanned task, or null where they disagree (that box is then not tickable).
 */
export function alignTasks(rendered, scanned) {
  const out = [];
  let j = 0;
  for (const r of rendered) {
    const t = normText(r.text);
    let k = -1;
    for (let x = j; x < Math.min(scanned.length, j + 4); x++) if (scanned[x].text === t) { k = x; break; }
    if (k < 0) { out.push(null); continue; }
    out.push(scanned[k]); j = k + 1;
  }
  return out;
}

/**
 * Tick the boxes whose anchors are listed: [ ] -> [x], one character, nothing else on the line or in the note changes.
 * Never unticks. Returns { lines, results: { anchor: 'ticked' | 'already' | 'missing' | 'ambiguous' } }.
 */
export function tickLines(text, rel, anchors) {
  const scan = scanNote(text, rel), lines = scan.lines.slice(), results = {};
  for (const a of anchors) {
    const hits = scan.tasks.filter((t) => t.anchor === a);
    if (hits.length === 0) { results[a] = 'missing'; continue; }
    if (hits.length > 1) { results[a] = 'ambiguous'; continue; }
    const t = hits[0];
    if (t.done) { results[a] = 'already'; continue; }
    const l = lines[t.line];
    if (l[t.col] !== ' ' || l[t.col - 1] !== '[' || l[t.col + 1] !== ']') { results[a] = 'missing'; continue; }
    lines[t.line] = l.slice(0, t.col) + 'x' + l.slice(t.col + 1);
    results[a] = 'ticked';
  }
  return { lines, results };
}
