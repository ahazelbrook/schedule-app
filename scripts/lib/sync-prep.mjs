// Pull, part 3 (SYNC.md, "Prep"): what the GM did in the Prep tab, from the GM state's `prep` key into the vault.
//
//   prep.ticks  { anchor: { at, s, rel, t } }   a task box ticked in the app -> that box ticked in its note, [ ] -> [x]
//   prep.beats  { key: { at, s, label } }       a beat started (the run-order timer) -> a line under ## At the table (app)
//   prep.cells  { key: { at, s, label } }       a tick-column cell ticked in a table  -> a line under ## At the table (app)
//
// Ticks only ever go one way: the sync ticks a box, never unticks one. A box already ticked in the note is left as it is.
// A tick whose box cannot be found (the task was reworded, moved under another heading, or appears twice) is not guessed
// onto another line: it is filed as a line under ## At the table (app) instead, and reported. The ledger's `ticked`
// remembers each tick done, so a box the GM unticks by hand afterwards is not ticked again.
// Which session note gets the lines: an entry's `s`, else the highest-numbered b68g-sNN.md (as the capture is filed).
// Nothing here prints or logs the text of a task or a beat.

import path from 'node:path';
import {
  BUCKETS, PINNED, BARGAINS, AT_TABLE, SESSION_HEADINGS, abs, readNote, toLines, fromLines, headings, insertBlock, addHeading,
  blockId, hasBlock, editNote, sessionNotes, noteForSession, highestNote, hhmm, assertPrepWritable, noteDate, noteForNight,
} from './vault.mjs';
import { tickLines } from './prep.mjs';
import { Refusal, sessionOf } from './sync-notes.mjs';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').replace(/\s\^[A-Za-z0-9-]+/g, '').trim().slice(0, 300);
const ANCHOR = /^t[0-9a-f]{12}$/, KEY = /^[A-Za-z0-9_-]{1,64}$/;

/** The lines to file and the boxes to tick, from the state's prep key. */
export function collectPrep(doc) {
  const p = isObj(doc) && isObj(doc.prep) ? doc.prep : {}, ticks = [], lines = [];
  for (const [a, e] of Object.entries(isObj(p.ticks) ? p.ticks : {})) {
    if (!isObj(e) || !ANCHOR.test(a)) continue;
    ticks.push({ kind: 'tick', id: a, bid: blockId('tick-' + a), rel: String(e.rel || ''), text: clean(e.t), at: e.at, s: sessionOf(e.s) });
  }
  for (const [k, kind] of [['beats', 'beat'], ['cells', 'cell']]) {
    for (const [key, e] of Object.entries(isObj(p[k]) ? p[k] : {})) {
      if (!isObj(e) || !KEY.test(key) || !clean(e.label)) continue;
      lines.push({ kind, id: key, bid: blockId(kind + '-' + key), text: clean(e.label), at: e.at, s: sessionOf(e.s) });
    }
  }
  return { ticks, lines };
}

export function prepLine(it) {
  const t = hhmm(it.at), when = t ? '**' + t + '** ' : '';
  if (it.kind === 'beat') return '- ' + when + 'Beat started: ' + it.text + ' ^' + it.bid;
  if (it.kind === 'cell') return '- ' + when + 'Ticked at the table: ' + it.text + ' ^' + it.bid;
  return '- ' + when + 'Ticked at the table: ' + it.text + (it.why ? ' (' + it.why + ')' : '') + ' ^' + it.bid;
}
const order = (a, b) => (String(a.at || '') < String(b.at || '') ? -1 : String(a.at || '') > String(b.at || '') ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The session note's text with `items` under ## At the table (app) (added after Bargains, Pinned or Rolled at the table). Throws Refusal. */
export function fileAtTable(text, eol, items) {
  const lines = toLines(text);
  let H = headings(lines);
  const watched = SESSION_HEADINGS.concat([PINNED, BARGAINS, AT_TABLE]);
  const dup = watched.filter((h) => H[h] && H[h].length > 1);
  if (dup.length) throw new Refusal('heading twice: ' + dup.map((h) => '## ' + h).join(', '));
  const missing = SESSION_HEADINGS.filter((h) => !H[h]);
  if (missing.length) throw new Refusal('missing heading: ' + missing.map((h) => '## ' + h).join(', '));
  if (!H[AT_TABLE]) addHeading(lines, (H[BARGAINS] || H[PINNED] || H[BUCKETS.r])[0], AT_TABLE, eol);
  H = headings(lines);
  insertBlock(lines, H[AT_TABLE][0], items.slice().sort(order).map(prepLine), { list: true, eol });
  return fromLines(lines);
}

/** ctx: { vault, doc, ledger, report, dryRun, session, now }. Returns { ticked, filed }. */
export function pullPrep(ctx) {
  const { vault, report, ledger } = ctx;
  ledger.ticked = ledger.ticked || {};
  const { ticks, lines } = collectPrep(ctx.doc);
  const at = new Date(ctx.now || Date.now()).toISOString();
  let ticked = 0, filed = 0;

  // 1. ticks, note by note
  const byRel = new Map();
  for (const it of ticks) {
    if (ledger.ticked[it.id]) { report.skip(it, 'ticked by an earlier sync'); continue; }
    if (ledger.filed[it.bid]) { report.skip(it, 'filed by an earlier sync'); continue; }
    try { assertPrepWritable(it.rel); } catch (e) { it.kind = 'tickline'; it.why = 'its note is not one the sync ticks'; lines.push(it); continue; }
    if (!byRel.has(it.rel)) byRel.set(it.rel, []);
    byRel.get(it.rel).push(it);
  }
  for (const [rel, list] of byRel) {
    const name = path.posix.basename(rel);
    let results = {};
    const edit = (note) => {
      const r = tickLines(note.text, rel, list.map((i) => i.id));
      results = r.results;
      return Object.values(r.results).includes('ticked') ? fromLines(r.lines) : null;
    };
    try {
      if (ctx.dryRun) { const note = readNote(abs(vault, rel)); if (!note) throw Object.assign(new Error('note missing'), { code: 'MISSING' }); edit(note); }
      else editNote(vault, rel, edit, { prep: true });
    } catch (e) {
      if (e.code === 'MISSING') { for (const it of list) { it.kind = 'tickline'; it.why = 'its note is missing'; lines.push(it); } continue; }
      if (e.code === 'NOT_UTF8' || e.code === 'RACE') { report.refuse(name, e.code === 'RACE' ? e.message : 'not valid UTF-8', list); continue; }
      throw e;
    }
    for (const it of list) {
      const r = results[it.id];
      if (r === 'ticked' || r === 'already') {
        if (!ctx.dryRun) ledger.ticked[it.id] = { rel, at };
        if (r === 'ticked') { report.file(it, name, ctx.dryRun); ticked++; } else report.skip(it, 'already ticked in the note');
      } else { it.kind = 'tickline'; it.why = r === 'ambiguous' ? 'the task appears twice in ' + name.replace(/\.md$/, '') : 'not found in ' + name.replace(/\.md$/, ''); lines.push(it); }
    }
  }

  // 2. lines under ## At the table (app), in the session notes
  const notes = sessionNotes(vault), texts = new Map();
  for (const n of notes) { try { const r = readNote(abs(vault, n.rel)); texts.set(n.name, r ? r.text : null); } catch (_) { texts.set(n.name, null); } }
  const inVault = (bid) => { for (const t of texts.values()) if (t && hasBlock(t, bid)) return true; return false; };
  const fallback = ctx.session != null ? noteForSession(notes, ctx.session) : highestNote(notes);
  const dates = new Map();
  for (const [name, t] of texts) { const d = t && noteDate(t); if (d) dates.set(name, d); }
  const groups = new Map();
  for (const it of lines) {
    if (inVault(it.bid)) { report.skip(it, 'already in the vault'); continue; }
    if (ledger.filed[it.bid]) { report.skip(it, 'removed from its note since it was filed (not filed again)'); continue; }
    const t = it.s != null ? noteForSession(notes, it.s) : (ctx.session == null && it.at && noteForNight(notes, dates, it.at)) || fallback, key = t.note ? t.note.rel : 'ERR:' + t.error;
    if (!groups.has(key)) groups.set(key, { target: t, items: [] });
    groups.get(key).items.push(it);
  }
  for (const { target, items } of groups.values()) {
    if (target.error) { report.refuse(target.error.replace(/ is missing$/, ''), target.error.endsWith('is missing') ? 'note missing' : target.error, items); continue; }
    const rel = target.note.rel, name = target.note.name;
    try {
      if (ctx.dryRun) { const note = readNote(abs(vault, rel)); if (!note) throw Object.assign(new Error('note missing'), { code: 'MISSING' }); fileAtTable(note.text, note.eol, items); }
      else { editNote(vault, rel, (note) => fileAtTable(note.text, note.eol, items)); for (const it of items) ledger.filed[it.bid] = { note: name, at }; }
      for (const it of items) report.file(it, name, ctx.dryRun);
      filed += items.length;
    } catch (e) {
      if (e instanceof Refusal) report.refuse(name, e.message, items);
      else if (e.code === 'MISSING') report.refuse(name, 'note missing', items);
      else if (e.code === 'NOT_UTF8') report.refuse(name, 'not valid UTF-8', items);
      else if (e.code === 'RACE') report.refuse(name, e.message, items);
      else throw e;
    }
  }
  return { ticked, filed };
}
