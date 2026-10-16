// Pull, part 1 (SYNC.md): the GM page's capture (P / X / M lines and L rolls), pins, and the bargains and callbacks
// from the GM state document into the session note, the way the Obsidian GM station files them.
//
//   capture n|x|m|r  ->  "- **HH:MM** text ^b68-<id>"  under ## Names / ## Loose ends / ## Moments / ## Rolled at the table
//   pins             ->  a collapsed callout, then "^b68-<id>"  under ## Pinned (added after Rolled at the table)
//   con.owed/struck/used -> "- **Owed:** ..." lines        under ## Bargains and callbacks (added after Pinned)
//
// Which note: an entry's `s` (the session number the page stamps on it). Entries without one: --session N if given; else
// the session note whose `date:` is the night the entry was made (before 06:00 counts as the night before); else the
// highest-numbered b68g-sNN.md, as the station does. Duplicate guard: the block id anywhere in any session note; a
// block the ledger says was filed but is no longer in any note was removed by hand and is not filed again.
// A target note that is missing, not UTF-8, lacks one of the four headings or has any heading twice gets nothing.
// Nothing here prints or logs the text of an entry.

import {
  BUCKETS, PINNED, BARGAINS, SESSION_HEADINGS, abs, readNote, toLines, fromLines, headings, insertBlock, addHeading,
  blockId, hasBlock, editNote, sessionNotes, noteForSession, highestNote, hhmm, noteDate, noteForNight,
} from './vault.mjs';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

export class Refusal extends Error {}

/** A session number from an entry's `s`: a positive finite number (or numeric string), else null. */
export function sessionOf(v) {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Every entry of the state that belongs in a session note, with its block id. */
export function collectItems(doc) {
  const d = isObj(doc) ? doc : {}, out = [];
  for (const [id, e] of Object.entries(isObj(d.capture) ? d.capture : {})) {
    if (!isObj(e)) continue;
    out.push({ kind: 'capture', id, bid: blockId(id), bucket: e.bucket, text: clean(e.text), at: e.at, s: sessionOf(e.s) });
  }
  for (const [id, p] of Object.entries(isObj(d.pins) ? d.pins : {})) {
    if (!isObj(p)) continue;
    out.push({ kind: 'pin', id, bid: blockId(id), label: clean(p.label || p.title || 'Pinned'), text: String(p.text == null ? '' : p.text), at: p.at, s: sessionOf(p.s) });
  }
  const con = isObj(d.con) ? d.con : {};
  const pipe = (x) => {
    if (isObj(x)) return { text: clean(x.text), src: clean(x.src) };
    const s = String(x == null ? '' : x), i = s.indexOf('|');
    return i < 0 ? { text: clean(s), src: '' } : { text: clean(s.slice(0, i)), src: clean(s.slice(i + 1)) };
  };
  for (const [k, v] of Object.entries(isObj(con.owed) ? con.owed : {})) { const p = pipe(v); out.push({ kind: 'owed', id: k, bid: blockId('owed-' + k), text: p.text, src: p.src, s: null }); }
  for (const [k, v] of Object.entries(isObj(con.struck) ? con.struck : {})) out.push({ kind: 'paid', id: k, bid: blockId('paid-' + k), text: clean(v), s: null });
  for (const [k, v] of Object.entries(isObj(con.used) ? con.used : {})) out.push({ kind: 'used', id: k, bid: blockId('used-' + k), text: clean(v), s: null });
  return out;
}

const order = (a, b) => (String(a.at || '') < String(b.at || '') ? -1 : String(a.at || '') > String(b.at || '') ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function captureLine(it) {
  const t = hhmm(it.at);
  return '- ' + (t ? '**' + t + '** ' : '') + it.text + ' ^' + it.bid;
}
export function pinBlock(it) {
  const t = hhmm(it.at);
  const body = it.text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '')).map((l) => (l ? '> ' + l : '>'));
  while (body.length && body[body.length - 1] === '>') body.pop();
  return ['> [!quote]- ' + (t ? t + ' · ' : '') + it.label].concat(body, ['', '^' + it.bid]);
}
export function bargainLine(it) {
  if (it.kind === 'owed') return '- **Owed:** ' + it.text + (it.src ? ' (' + it.src + ')' : '') + ' ^' + it.bid;
  if (it.kind === 'paid') return '- **Collected:** ' + it.text + ' ^' + it.bid;
  return '- **Callback used:** ' + it.text + ' ^' + it.bid;
}

/** The note's text with `items` filed (throws Refusal). Pure: the same input gives the same bytes. */
export function fileInto(text, eol, items) {
  const lines = toLines(text);
  let H = headings(lines);
  const watched = SESSION_HEADINGS.concat([PINNED, BARGAINS]);
  const dup = watched.filter((h) => H[h] && H[h].length > 1);
  if (dup.length) throw new Refusal('heading twice: ' + dup.map((h) => '## ' + h).join(', '));
  const missing = SESSION_HEADINGS.filter((h) => !H[h]);
  if (missing.length) throw new Refusal('missing heading: ' + missing.map((h) => '## ' + h).join(', '));

  for (const k of ['n', 'x', 'm', 'r']) {
    const list = items.filter((i) => i.kind === 'capture' && i.bucket === k).sort(order);
    if (!list.length) continue;
    H = headings(lines);
    insertBlock(lines, H[BUCKETS[k]][0], list.map(captureLine), { list: true, eol });
  }
  const pins = items.filter((i) => i.kind === 'pin').sort(order);
  if (pins.length) {
    H = headings(lines);
    if (!H[PINNED]) addHeading(lines, H[BUCKETS.r][0], PINNED, eol);
    for (const p of pins) { H = headings(lines); insertBlock(lines, H[PINNED][0], pinBlock(p), { eol }); }
  }
  const kinds = ['owed', 'paid', 'used'];
  const bar = items.filter((i) => kinds.includes(i.kind)).sort((a, b) => kinds.indexOf(a.kind) - kinds.indexOf(b.kind));
  if (bar.length) {
    H = headings(lines);
    if (!H[BARGAINS]) addHeading(lines, (H[PINNED] || H[BUCKETS.r])[0], BARGAINS, eol);
    H = headings(lines);
    insertBlock(lines, H[BARGAINS][0], bar.map(bargainLine), { list: true, eol });
  }
  return fromLines(lines);
}

/**
 * File the state's entries into the session notes. ctx: { vault, doc, ledger (campaign part), report, dryRun, session }.
 * Returns { filed: n }.
 */
export function pullNotes(ctx) {
  const { vault, report, ledger } = ctx;
  const notes = sessionNotes(vault);
  const texts = new Map();
  for (const n of notes) {
    try { const r = readNote(abs(vault, n.rel)); texts.set(n.name, r ? r.text : null); }
    catch (e) { texts.set(n.name, null); }
  }
  const where = (bid) => { for (const [name, t] of texts) if (t && hasBlock(t, bid)) return name; return null; };
  const fallback = ctx.session != null ? noteForSession(notes, ctx.session) : highestNote(notes);
  const dates = new Map();
  for (const [name, t] of texts) { const d = t && noteDate(t); if (d) dates.set(name, d); }
  const undated = (it) => (ctx.session == null && it.at && noteForNight(notes, dates, it.at)) || fallback;

  const items = collectItems(ctx.doc);
  const groups = new Map();
  for (const it of items) {
    if ((it.kind === 'capture' && !BUCKETS[it.bucket]) || (!it.text && it.kind !== 'pin') || (it.kind === 'pin' && !it.text.trim() && !it.label)) {
      report.skip(it, it.kind === 'capture' && !BUCKETS[it.bucket] ? 'unknown bucket' : 'empty'); continue;
    }
    const inNote = where(it.bid);
    if (inNote) { report.skip(it, 'already in the vault'); continue; }
    if (ledger.filed[it.bid]) { report.skip(it, 'removed from its note since it was filed (not filed again)'); continue; }
    const t = it.s != null ? noteForSession(notes, it.s) : undated(it);
    const key = t.note ? t.note.rel : 'ERR:' + t.error;
    if (!groups.has(key)) groups.set(key, { target: t, items: [] });
    groups.get(key).items.push(it);
  }

  let filed = 0;
  for (const { target, items: list } of groups.values()) {
    if (target.error) { report.refuse(target.error.replace(/ is missing$/, ''), target.error.endsWith('is missing') ? 'note missing' : target.error, list); continue; }
    const rel = target.note.rel, name = target.note.name;
    try {
      if (ctx.dryRun) {
        const note = readNote(abs(vault, rel));
        if (!note) throw Object.assign(new Error('note missing'), { code: 'MISSING' });
        fileInto(note.text, note.eol, list);
      } else {
        editNote(vault, rel, (note) => fileInto(note.text, note.eol, list));
        const at = new Date(ctx.now || Date.now()).toISOString();
        for (const it of list) ledger.filed[it.bid] = { note: name, at };
      }
      for (const it of list) report.file(it, name, ctx.dryRun);
      filed += list.length;
    } catch (e) {
      if (e instanceof Refusal) report.refuse(name, e.message, list);
      else if (e.code === 'MISSING') report.refuse(name, 'note missing', list);
      else if (e.code === 'NOT_UTF8') report.refuse(name, 'not valid UTF-8', list);
      else if (e.code === 'RACE') report.refuse(name, e.message, list);
      else throw e;
    }
  }
  return { filed };
}
