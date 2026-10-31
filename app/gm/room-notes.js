/* gm/room-notes.js — a site's rooms as the prep notes tell them: one "## Rooms" section, one "### <room>" per room (ticket A1).

   Window.B68GmRooms; in Node, require() returns the same object. Pure: no DOM, no storage, no network.

   find(prepPart, roomNames) -> { byRoom: { <name as given>: { note, md, costume, say } }, missing: [name], extra: [heading], source: noteId | null }
     prepPart is the pack's prep part, { notes: [{ id, rel, title, blocks: [{ k: 'md' | 'embed', src }] }] }; anything malformed is the empty result.
     Each note's blocks are joined with newlines and read as Markdown; lines inside ``` / ~~~ fences are never headings, costumes or callouts.
     The first note (notes order) with an H2 reading "Rooms" (or "Rooms · …", "Rooms - …") is the source; its H3s up to the next H2 (or the end)
     are the rooms, each running to the next H3/H2, matched to roomNames with normRoom. extra: H3s no room matches; missing: rooms with no H3.
       note      the source note's id
       md        the section's Markdown, heading line left out, trimmed (GM-side: missionFor never reads it)
       costume   the plain text after the first "- **Costume:**" bullet, <= 160 characters, or null
       say       the plain bodies of "> [!quote] SAY" callouts, <= 300 characters each, at most 3
   normRoom(s)  NFKC, lower case, a leading "the " dropped, punctuation dropped, whitespace collapsed: "The Showroom!" -> "showroom"
   plain(md)    Markdown to one line of text: [[a|b]] -> b, [[a]] -> a, [t](u) -> t; emphasis, code, callout markers and HTML gone */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmRooms = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var COSTUME_MAX = 160, SAY_MAX = 300, SAY_N = 3;
  /* punctuation and symbols; an engine without \p{...} gets the ASCII and general-punctuation ranges */
  var PUNCT = (function () { try { return new RegExp('[\\p{P}\\p{S}]+', 'gu'); } catch (e) { return /[!-\/:-@\[-`{-~\u00a1-\u00bf\u00d7\u00f7\u2010-\u2027\u2030-\u205e]+/g; } })();

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  /* a room named like a prototype key ("__proto__") is just a key */
  function put(o, k, v) { Object.defineProperty(o, k, { value: v, enumerable: true, writable: true, configurable: true }); return v; }
  /* text cut at max characters, no half of a surrogate pair left at the cut */
  function cut(s, max) {
    if (s.length > max) { s = s.slice(0, max); var c = s.charCodeAt(max - 1); if (c >= 0xd800 && c <= 0xdbff) s = s.slice(0, -1); }
    return s.trim();
  }
  function empty() { return { byRoom: {}, missing: [], extra: [], source: null }; }

  function normRoom(s) {
    var t = str(s);
    try { t = t.normalize('NFKC'); } catch (e) { /* no normalize: as written */ }
    return t.toLowerCase().trim().replace(/^the\s+/, '').replace(PUNCT, '').replace(/\s+/g, ' ').trim();
  }

  function plain(md) {
    return str(md)
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2')
      .replace(/!?\[\[([^\]]*)\]\]/g, '$1')
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<\/?[A-Za-z][^>]*>/g, ' ')
      .replace(/^[ \t]*(?:>[ \t]?)+/gm, '')
      .replace(/\[![^\]]*\][+-]?/g, ' ')
      .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
      .replace(/`+|\*+|~~|==/g, '')
      .replace(/(^|\W)_+(?=\S)/g, '$1')
      .replace(/(\S)_+(?=\W|$)/g, '$1')
      .replace(/\s+/g, ' ').trim();
  }

  /* a note's blocks as Markdown lines { t, code } (code: inside a ``` / ~~~ fence, the fence lines included) */
  function linesOf(note) {
    var src = (Array.isArray(note.blocks) ? note.blocks : []).filter(function (b) { return isObj(b) && typeof b.src === 'string'; }).map(function (b) { return b.src; }).join('\n');
    var out = [], fence = '';
    src.split(/\r\n?|\n/).forEach(function (t) {
      var f = /^ {0,3}(`{3,}|~{3,})/.exec(t);
      if (fence) {
        out.push({ t: t, code: true });
        if (f && f[1].charAt(0) === fence.charAt(0) && f[1].length >= fence.length && /^\s*[`~]+\s*$/.test(t)) fence = '';
      } else if (f) { fence = f[1]; out.push({ t: t, code: true }); }
      else out.push({ t: t, code: false });
    });
    return out;
  }

  /* an ATX heading: { level, text } (a closing run of #s dropped), else null */
  function headOf(t) {
    var m = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(t);
    return m ? { level: m[1].length, text: str(m[2]).replace(/(?:^|[ \t]+)#+$/, '').trim() } : null;
  }
  function isRooms(text) { return /^(?:the\s+)?rooms(?:\s*[·\-–—:].*)?$/i.test(str(text).normalize("NFKC").trim()); } /* "Rooms", or "Rooms" + a separator + anything; not "Rooms and props" */

  /* the first "- **Costume:**" bullet (also "**Costume**:"); an empty one is null, the search stops there */
  function costumeOf(lines) {
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].code) continue;
      var m = /^\s*[-*+][ \t]+(?:\*\*|__)\s*Costume\s*(?::(?:\*\*|__)|(?:\*\*|__):)(.*)$/i.exec(lines[i].t);
      if (m) return cut(plain(m[1]), COSTUME_MAX) || null;
    }
    return null;
  }

  /* "> [!quote] SAY" callouts: the body is the > lines after the title, until a line that is not one */
  function sayOf(lines) {
    var out = [];
    for (var i = 0; i < lines.length && out.length < SAY_N; i++) {
      if (lines[i].code) continue;
      var m = /^\s*>\s*\[!quote\][+-]?(.*)$/i.exec(lines[i].t);
      if (!m || plain(m[1]).toLowerCase() !== 'say') continue;
      var body = [], j = i + 1;
      for (; j < lines.length && !lines[j].code && /^\s*>/.test(lines[j].t); j++) body.push(lines[j].t.replace(/^\s*(?:>\s?)+/, ''));
      i = j - 1;
      var t = cut(plain(body.join(' ')), SAY_MAX);
      if (t) out.push(t);
    }
    return out;
  }

  function section(id, lines) {
    return { note: id, md: lines.map(function (l) { return l.t; }).join('\n').trim(), costume: costumeOf(lines), say: sayOf(lines) };
  }

  /* the H3 sections from the line after the Rooms H2 to the next H1/H2 (or the end), matched to the room names */
  function read(out, id, lines, from, names) {
    var secs = [], cur = null;
    for (var j = from; j < lines.length; j++) {
      var h = lines[j].code ? null : headOf(lines[j].t);
      if (h && h.level <= 2) break;
      if (h && h.level === 3) { cur = { head: h.text, lines: [] }; secs.push(cur); }
      else if (cur) cur.lines.push(lines[j]);
    }
    out.source = id;
    secs.forEach(function (s) {
      var k = normRoom(s.head), hit = k ? names.filter(function (n) { return normRoom(n) === k; }) : [];
      if (!hit.length) { out.extra.push(s.head); return; }
      hit.forEach(function (n) { if (!has(out.byRoom, n)) put(out.byRoom, n, section(id, s.lines)); });      /* the first section for a room wins */
    });
    out.missing = names.filter(function (n, i) { return !has(out.byRoom, n) && names.indexOf(n) === i; });
    return out;
  }

  /* no Rooms section: nothing found, every room missing, no source */
  function none(names) { var o = empty(); o.missing = (names || []).filter(function (n, i) { return names.indexOf(n) === i; }); return o; }

  function find(prep, roomNames) {
    var names = [];
    try {
      names = (Array.isArray(roomNames) ? roomNames : []).filter(function (r) { return typeof r === 'string' && r.trim() !== ''; });
      if (!isObj(prep) || !Array.isArray(prep.notes)) return none(names);
      for (var i = 0; i < prep.notes.length; i++) {
        var note = prep.notes[i];
        if (!isObj(note)) continue;
        var lines = linesOf(note);
        for (var j = 0; j < lines.length; j++) {
          var h = lines[j].code ? null : headOf(lines[j].t);
          if (h && h.level === 2 && isRooms(h.text)) return read(empty(), str(note.id), lines, j + 1, names);
        }
      }
    } catch (e) { /* a part that cannot be read is no section */ }
    return none(names);
  }

  return { normRoom: normRoom, find: find, plain: plain };
});
