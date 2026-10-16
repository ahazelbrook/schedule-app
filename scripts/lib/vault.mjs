// The sync's vault layer (SYNC.md): where things live in Alex's Obsidian vault, how a note is read and written without
// disturbing anything else in it, and the GM station's own filing rules (`insertUnder` in
// Tools/blades-68-gm-station.md), extended for the two sections the station never had.
//
// Writes keep the note's bytes outside the inserted lines: the BOM, each line's own ending (CRLF, LF, mixed), Unicode.
// A note that is not valid UTF-8 is refused. Every write is temp file + rename in the same folder, with an mtime/size
// check just before the rename (Obsidian may save the note mid-run): changed -> redo the edit on the fresh copy, once.

import fs from 'node:fs';
import path from 'node:path';

export const ROOT = 'Wiki/Games/Blades in the Dark';
export const SESSIONS = ROOT + '/Campaigns/Group/Sessions';
export const NPCS = ROOT + '/NPCs';
export const FIGURES = NPCS + '/figures';
export const FACTIONS = ROOT + '/Factions';
export const LOCATIONS = ROOT + '/Locations';                         // the location generator's saved sites (lib/sync-sites.mjs)
export const LOG = 'Wiki/log.md';
export const NEVER = [ROOT + '/Campaigns/Group/b68g-factions.md'];   // the board: Blade copies to it at close, never the sync

export const GROUP = ROOT + '/Campaigns/Group';
export const SCORES = GROUP + '/Scores';                              // the score cards (one note each)

export const BUCKETS = { n: 'Names', x: 'Loose ends', m: 'Moments', r: 'Rolled at the table' };
export const PINNED = 'Pinned';
export const BARGAINS = 'Bargains and callbacks';
export const AT_TABLE = 'At the table (app)';        // the prep tab's log: beats started, table cells, ticks with no line
export const SESSION_HEADINGS = [BUCKETS.n, BUCKETS.x, BUCKETS.m, BUCKETS.r];

const posix = (p) => p.split(path.sep).join('/');
export const abs = (vault, rel) => path.join(vault, ...rel.split('/'));

/** Paths the sync may write, relative to the vault. Anything else throws (a bug, never a run-time choice). */
export function assertWritable(rel) {
  const r = posix(rel);
  if (NEVER.includes(r)) throw new Error('the sync never writes ' + r);
  if (/(^|\/)\./.test(r) || r.startsWith('TTRPG/') || r.startsWith('_Templates/') || r.startsWith('_archive/')) throw new Error('no-touch zone: ' + r);
  const ok = r === LOG ||
    (r.startsWith(SESSIONS + '/') && /^b68g-s[0-9.]+\.md$/.test(r.slice(SESSIONS.length + 1))) ||
    // the transcript the table iPad heard (scripts/gm-transcript.mjs: append only)
    (r.startsWith(SESSIONS + '/') && /^b68g-s[0-9.]+-transcript(-ipad)?\.md$/.test(r.slice(SESSIONS.length + 1))) ||
    (r.startsWith(NPCS + '/') && !r.slice(NPCS.length + 1).includes('/') && r.endsWith('.md')) ||
    (r.startsWith(FACTIONS + '/') && !r.slice(FACTIONS.length + 1).includes('/') && r.endsWith('.md')) ||
    // a score's site: its location note and its map (lib/sync-sites.mjs: created, never replaced)
    (r.startsWith(LOCATIONS + '/') && !r.slice(LOCATIONS.length + 1).includes('/') && /\.(md|svg)$/.test(r));
  if (!ok) throw new Error('not a path the sync writes: ' + r);
  return r;
}

/**
 * The one edit the site sync makes to a score card (lib/sync-sites.mjs): the `site:` line in its frontmatter. Score cards live
 * in the group campaign's Scores/ folder; anything else is refused.
 */
export function assertSiteWritable(rel) {
  const r = posix(rel);
  if (NEVER.includes(r)) throw new Error('the sync never writes ' + r);
  if (/(^|\/)\./.test(r) || r.startsWith('TTRPG/') || r.startsWith('_Templates/') || r.startsWith('_archive/')) throw new Error('no-touch zone: ' + r);
  const tail = r.startsWith(SCORES + '/') ? r.slice(SCORES.length + 1) : null;
  if (tail === null || !/^[^/]+\.md$/.test(tail)) throw new Error('not a score card the site sync links: ' + r);
  return r;
}

/**
 * The one extra edit the prep sync makes (lib/sync-prep.mjs): ticking a task box, [ ] -> [x], in a prep note or a note
 * it transcludes. Those live in the group campaign's folder or its Sessions/ (pocket scores, run sheets, session notes);
 * transcripts, the faction board and anything deeper (Characters/, Clocks/) are refused.
 */
export function assertPrepWritable(rel) {
  const r = posix(rel);
  if (NEVER.includes(r)) throw new Error('the sync never writes ' + r);
  if (/(^|\/)\./.test(r) || r.startsWith('TTRPG/') || r.startsWith('_Templates/') || r.startsWith('_archive/')) throw new Error('no-touch zone: ' + r);
  const tail = r.startsWith(GROUP + '/') ? r.slice(GROUP.length + 1) : null;
  if (tail === null || !/^(Sessions\/)?[^/]+\.md$/.test(tail) || /-transcript(-ipad)?\.md$/i.test(tail)) throw new Error('not a note the prep sync ticks: ' + r);
  return r;
}

// ---------- time (Melbourne, whatever the PC's zone) ----------
const TZ = 'Australia/Melbourne';
function parts(d) {
  const f = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const o = {}; for (const p of f.formatToParts(d)) o[p.type] = p.value; return o;
}
export function hhmm(iso) { const d = new Date(iso); if (isNaN(d)) return null; const p = parts(d); return p.hour + ':' + p.minute; }
export function dmy(iso) { const d = iso instanceof Date ? iso : new Date(iso); if (isNaN(d)) return null; const p = parts(d); return p.day + '/' + p.month + '/' + p.year; }
/** The night an instant belongs to (DD/MM/YYYY): its Melbourne date, or the day before when it is before 06:00 (a session runs past midnight). */
export function nightOf(iso) {
  const d = iso instanceof Date ? iso : new Date(iso); if (isNaN(d)) return null;
  return +parts(d).hour < 6 ? dmy(new Date(d.getTime() - 6 * 3600000)) : dmy(d);
}

// ---------- reading a note ----------
const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** { text (no BOM), bom, eol for new lines, mtimeMs, size } or null when missing. Throws on bytes that are not UTF-8. */
export function readNote(file) {
  let buf, st;
  try { st = fs.statSync(file); buf = fs.readFileSync(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const bom = buf.length >= 3 && buf.subarray(0, 3).equals(BOM);
  const body = bom ? buf.subarray(3) : buf;
  const text = body.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(body)) { const e = new Error('not valid UTF-8'); e.code = 'NOT_UTF8'; throw e; }
  const crlf = (text.match(/\r\n/g) || []).length, lf = (text.match(/\n/g) || []).length;
  return { text, bom, eol: crlf > 0 && crlf * 2 >= lf ? '\r\n' : '\n', mtimeMs: st.mtimeMs, size: st.size };
}

/** Lines keep a trailing \r when the note has CRLF; inserted lines get the note's ending. */
export function toLines(text) { return text.split('\n'); }
export function fromLines(lines) { return lines.join('\n'); }
export const bare = (l) => l.replace(/\r$/, '');
const withEol = (l, eol) => (eol === '\r\n' ? l + '\r' : l);

/** Line indexes that are markdown (not frontmatter, not inside a fenced code block). */
function markdownMask(lines) {
  const ok = new Array(lines.length).fill(true);
  let i = 0;
  if (lines.length && bare(lines[0]) === '---') {
    ok[0] = false;
    for (i = 1; i < lines.length; i++) { ok[i] = false; if (bare(lines[i]) === '---') { i++; break; } }
  }
  let fence = null;
  for (; i < lines.length; i++) {
    const t = bare(lines[i]).trimStart();
    const m = /^(`{3,}|~{3,})/.exec(t);
    if (fence) { ok[i] = false; if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null; continue; }
    if (m) { fence = m[1]; ok[i] = false; }
  }
  return ok;
}

/** Every "## <name>" line (trimmed, as the station matches them), by name: { name: [index...] }. */
export function headings(lines) {
  const mask = markdownMask(lines), out = {};
  lines.forEach((l, i) => {
    if (!mask[i]) return;
    const t = bare(l).trim();
    if (/^## /.test(t)) (out[t.slice(3).trim()] = out[t.slice(3).trim()] || []).push(i);
  });
  return out;
}

const isHeadingStop = (t) => /^#{1,2} /.test(t);
const isRule = (t) => /^-{3,}$/.test(t);
const isListItem = (t) => /^(?:[-*+]|\d+[.)])\s/.test(t);

/** The end of the section that starts at `start`: the next # or ## heading or --- rule (outside code), else EOF. */
export function sectionEnd(lines, start) {
  const mask = markdownMask(lines);
  for (let i = start + 1; i < lines.length; i++) {
    if (!mask[i]) continue;
    const t = bare(lines[i]).trim();
    if (isHeadingStop(t) || isRule(t)) return i;
  }
  return lines.length;
}

/** Where new content goes in a section: after its last non-blank line (the station's rule). */
function contentEnd(lines, start) {
  let at = sectionEnd(lines, start);
  while (at > start + 1 && bare(lines[at - 1]).trim() === '') at--;
  return at;
}

/**
 * Insert `block` (lines without endings) at the end of the section headed at `start`. `list`: eat the template's
 * lone "-" placeholder, as the station does. Blank lines are added only where Markdown needs them (after the heading,
 * after a table or paragraph before a list, around a callout). Returns the index after the inserted block.
 */
export function insertBlock(lines, start, block, { list = false, eol = '\n' } = {}) {
  let at = contentEnd(lines, start);
  if (list && at > start + 1 && bare(lines[at - 1]).trim() === '-') { at--; lines.splice(at, 1); }
  else if (at === start + 1 && start + 2 < lines.length && bare(lines[start + 1]).trim() === '') at = start + 2;   // an empty section: keep the heading's blank line above
  const prev = bare(lines[at - 1]).trim(), underHeading = at - 1 === start;
  const out = [];
  if (prev !== '' && (underHeading || !(list && isListItem(prev)))) out.push('');
  for (const l of block) out.push(l);
  const next = at < lines.length ? bare(lines[at]).trim() : null;
  if (next !== null && next !== '') out.push('');
  lines.splice(at, 0, ...out.map((l) => withEol(l, eol)));
  return at + out.length;
}

/** Add "## <name>" after the content of the section headed at `afterStart` (used for Pinned and Bargains). */
export function addHeading(lines, afterStart, name, eol = '\n') {
  const at = contentEnd(lines, afterStart);
  const block = ['', '## ' + name];
  const next = at < lines.length ? bare(lines[at]).trim() : null;
  if (next !== null && next !== '') block.push('');
  lines.splice(at, 0, ...block.map((l) => withEol(l, eol)));
  return at + 1;
}

// ---------- block ids ----------
export const blockId = (s) => 'b68-' + String(s).replace(/[^A-Za-z0-9-]/g, '-');
export function hasBlock(text, id) {
  const re = new RegExp('(^|\\s)\\^' + id.replace(/[-]/g, '\\-') + '(?![A-Za-z0-9-])', 'm');
  return re.test(text);
}

// ---------- writing ----------
let hooks = {};   // tests: { beforeRename(file, attempt) } to simulate Obsidian saving mid-run
export function setHooks(h) { hooks = h || {}; }

function tempFor(file) { return path.join(path.dirname(file), '.' + path.basename(file) + '.b68sync-' + process.pid + '.tmp'); }
function encode(note, text) { const b = Buffer.from(text, 'utf8'); return note && note.bom ? Buffer.concat([BOM, b]) : b; }
function renameOver(tmp, file) {
  try { fs.renameSync(tmp, file); }
  catch (e) {
    if (e.code !== 'EPERM' && e.code !== 'EBUSY' && e.code !== 'EACCES') throw e;
    const until = Date.now() + 250; while (Date.now() < until) { /* Windows: a reader held the file; wait a moment */ }
    fs.renameSync(tmp, file);
  }
}

/**
 * Edit an existing note: `edit(note)` returns the new text, or null for "nothing to do" (a refusal is a throw).
 * Returns { changed, text }. Retries once if the note changes between the read and the rename.
 * opts.prep: the path rule is assertPrepWritable (ticking a box in a prep note), not assertWritable.
 * opts.site: the path rule is assertSiteWritable (a score card's site: line).
 */
export function editNote(vault, rel, edit, opts) {
  (opts && opts.prep ? assertPrepWritable : opts && opts.site ? assertSiteWritable : assertWritable)(rel);
  const file = abs(vault, rel);
  for (let attempt = 0; attempt < 2; attempt++) {
    const note = readNote(file);
    if (!note) { const e = new Error('note missing'); e.code = 'MISSING'; throw e; }
    const text = edit(note);
    if (text === null || text === note.text) return { changed: false, text: note.text };
    const tmp = tempFor(file);
    fs.writeFileSync(tmp, encode(note, text));
    if (hooks.beforeRename) hooks.beforeRename(file, attempt);
    let st = null; try { st = fs.statSync(file); } catch (_) {}
    if (!st || st.mtimeMs !== note.mtimeMs || st.size !== note.size) { fs.rmSync(tmp, { force: true }); continue; }
    renameOver(tmp, file);
    return { changed: true, text };
  }
  const e = new Error('the note changed while the sync was writing it (twice); run the sync again'); e.code = 'RACE'; throw e;
}

/** Create a new note; never replaces an existing file (hard link from the temp file fails if the name is taken). */
export function createNote(vault, rel, text) {
  assertWritable(rel);
  const file = abs(vault, rel);
  if (fs.existsSync(file)) { const e = new Error('already exists'); e.code = 'EXISTS'; throw e; }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = tempFor(file);
  fs.writeFileSync(tmp, Buffer.from(text, 'utf8'));
  try { fs.linkSync(tmp, file); }
  catch (e) {
    if (e.code === 'EEXIST') { fs.rmSync(tmp, { force: true }); const x = new Error('already exists'); x.code = 'EXISTS'; throw x; }
    fs.writeFileSync(file, Buffer.from(text, 'utf8'), { flag: 'wx' });   // a file system without hard links
  }
  fs.rmSync(tmp, { force: true });
}

/** Append text at the end of a note (adds the missing newline first). The station's and the generator's `append`. */
export function appendNote(vault, rel, addLines) {
  return editNote(vault, rel, (note) => {
    let t = note.text;
    if (t.length && !t.endsWith('\n')) t += note.eol;
    return t + addLines.map((l) => l + note.eol).join('');
  });
}

// ---------- finding things ----------

/** Session notes: [{ name, rel, num (number), int (true for b68g-sNN) }], transcripts and other files left out. */
export function sessionNotes(vault) {
  const dir = abs(vault, SESSIONS);
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return []; }
  return names.map((name) => {
    const m = /^b68g-s(\d+(?:\.\d+)?)\.md$/.exec(name);
    return m ? { name, rel: SESSIONS + '/' + name, num: parseFloat(m[1]), int: /^\d+$/.test(m[1]) } : null;
  }).filter(Boolean).sort((a, b) => a.num - b.num || (a.name < b.name ? -1 : 1));
}

/** The note for session `s` (a number): b68g-sNN.md, b68g-sN.md or b68g-s1.5.md. { note } or { error }. */
export function noteForSession(notes, s) {
  const hits = notes.filter((n) => n.num === s);
  if (hits.length === 1) return { note: hits[0] };
  if (hits.length > 1) return { error: 'two notes for session ' + s + ': ' + hits.map((h) => h.name).join(', ') };
  const want = Number.isInteger(s) ? 'b68g-s' + String(s).padStart(2, '0') + '.md' : 'b68g-s' + s + '.md';
  return { error: want + ' is missing' };
}

/** The station's choice for lines with no session: the highest-numbered b68g-sNN.md (b68g-s1.5 style names ignored). */
export function highestNote(notes) {
  const ints = notes.filter((n) => n.int);
  if (!ints.length) return { error: 'no session note (b68g-sNN.md) in ' + SESSIONS };
  const top = ints[ints.length - 1].num, hits = ints.filter((n) => n.num === top);
  return hits.length > 1 ? { error: 'two notes for session ' + top + ': ' + hits.map((h) => h.name).join(', ') } : { note: hits[0] };
}

/** A note's frontmatter `date:` as DD/MM/YYYY (quoted or not, D/M padded), or null ("[TODO: session date]", no frontmatter). */
export function noteDate(text) {
  const fm = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(String(text || '')); if (!fm) return null;
  const m = /^date:[ \t]*["']?(\d{1,2})\/(\d{1,2})\/(\d{4})["']?[ \t]*\r?$/m.exec(fm[1]); if (!m) return null;
  return m[1].padStart(2, '0') + '/' + m[2].padStart(2, '0') + '/' + m[3];
}

/**
 * Filing by date: the session note whose `date:` is the night of `iso` (nightOf), else its calendar date. { note } when
 * exactly one note carries that date, else null (two notes on one date, or none: the caller falls back). dates: name -> date.
 */
export function noteForNight(notes, dates, iso) {
  for (const day of [...new Set([nightOf(iso), dmy(iso)])]) {
    if (!day) continue;
    const hits = notes.filter((n) => dates.get(n.name) === day);
    if (hits.length === 1) return { note: hits[0] };
    if (hits.length > 1) return null;
  }
  return null;
}
/** name -> DD/MM/YYYY for every session note that has a date (unreadable notes are left out). */
export function noteDates(vault, notes) {
  const out = new Map();
  for (const n of notes) { try { const r = readNote(abs(vault, n.rel)); const d = r && noteDate(r.text); if (d) out.set(n.name, d); } catch (_) {} }
  return out;
}

/** Every .md basename in the vault (lower case) -> [rel...]. Dot folders (.obsidian, .trash, .claude, .git) are skipped. */
export function basenames(vault) {
  const out = new Map();
  (function walk(dir, rel) {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else if (e.name.toLowerCase().endsWith('.md')) {
        const k = e.name.slice(0, -3).toLowerCase();
        if (!out.has(k)) out.set(k, []);
        out.get(k).push(r);
      }
    }
  })(vault, '');
  return out;
}

/** NPC cards: [{ base, name, rel }] where name drops a " (NPC)" suffix. */
export function npcCards(vault) {
  let names = [];
  try { names = fs.readdirSync(abs(vault, NPCS)); } catch (_) { return []; }
  return names.filter((n) => n.toLowerCase().endsWith('.md')).map((n) => {
    const base = n.slice(0, -3);
    return { base, name: base.replace(/ \(NPC\)$/, ''), rel: NPCS + '/' + n };
  });
}

export const safeName = (s) => String(s).replace(/[\/:*?"<>|#^[\]\\]/g, '').replace(/\s+/g, ' ').trim();   // the generator's rule (+ backslash)
export const facSlug = (n) => 'b68-' + String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
