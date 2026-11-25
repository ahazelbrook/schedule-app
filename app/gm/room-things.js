/* gm/room-things.js: a room note's things (RK08.1 to RK08.3 of the room key build; setting room.key, bundle room-key).

   Window.B68GmRoomThings; in Node, require() returns the same object. Pure: no DOM, no storage, no network. GM-side only: missionFor, the
   phone paths and the display never read it (room-notes.js's find() is unchanged; the GM page hands this file a room's `md`).

   The grammar (C0, the room-table format), under a room's ### in the prep note's ## Rooms:
     - **Things:**
       1. **A brass umbrella stand**, too heavy to tip.        name (the bold run) and line (the rest of the first line)
          - 🔍 One umbrella is dry.                          look: what a closer look finds (Hidden)
          - 🎲 4/5: a ticket in its folds. 6: and more.       roll: what a roll adds (Secret)
          - ! The stand rings like a bell if it's knocked.     danger (Secret)
          - State: full · empty                                states (joined by · , / or |)
          - Tags: clue                                         tags (of TAGS; unknown ones dropped)
   - The header is a bullet ("- **Things:**", also "**Things**:", __, any case). Items are numbered (or bullets) under it; a sub-bullet is a
     bullet indented past its item. "Look:", "Roll:" and "Danger:" work in place of 🔍, 🎲 and !. Names after "Things:" on its own line count too.
   - The old one-line Find (RK08.2): "- **Find:** a cloakroom ticket · a bent key · a lipstick" (split on · ; | •) gives things with a name
     only. A Find with nothing after it and a list under it is read as a Things list. A Things block wins over a Find; the first of each wins.
   - Lines inside ``` / ~~~ fences are never read. A room note with neither block parses to [] and its md is left exactly as it is.

   parse(md) -> [thing]                 at most MAX things, in the note's order, no two with the same slug
     thing = { name <= 40, line <= 80, look <= 120, roll <= 160, danger <= 100, states: [<= 4, each <= 24], tags: [<= 3 of TAGS], slug }
     Every field is there ('' or []). Text is plain (Markdown gone, as room-notes plain()), cut at its limit with no half surrogate pair.
   read(md) -> { things, md }           md: the note without the block the things came from (so a card that draws the things does not show
                                        them twice); the same string when there are none
   slug(name) -> 'brass-umbrella-stand' a thing's key in roomstate (room-state.js): NFKD, accents and a leading a/an/the/some dropped, lower case
                                        a-z0-9 words joined by '-', <= 40; a name with none of those letters is 'x' + an 8-hex hash of it
   clean(thing) -> thing | null         any { name, line, ... } (a table's thing, the Blade tap's) cut to the same limits and lists; null with no name
   LIMITS, TAGS, MAX */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmRoomThings = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var LIMITS = { name: 40, line: 80, look: 120, roll: 160, danger: 100, state: 24, states: 4, tags: 3, slug: 40 };
  var TAGS = ['loot', 'clue', 'weapon', 'escape', 'cover', 'costume', 'talk', 'weird', 'hazard', 'tool', 'door'];
  var MAX = 10;

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  /* room-notes.js (always on the GM page; require()d under Node) is read when called, never at load */
  function rooms() {
    if (root && root.B68GmRooms) return root.B68GmRooms;
    if (typeof require === 'function') { try { return require('./room-notes.js'); } catch (e) { /* not under Node */ } }
    return null;
  }
  function plain(md) { var R = rooms(); return R ? R.plain(md) : str(md).replace(/\s+/g, ' ').trim(); }
  /* text cut at max characters, no half of a surrogate pair left at the cut */
  function cut(s, max) {
    s = str(s);
    if (s.length > max) { s = s.slice(0, max); var c = s.charCodeAt(max - 1); if (c >= 0xd800 && c <= 0xdbff) s = s.slice(0, -1); }
    return s.trim();
  }

  function hash8(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul ? Math.imul(h, 16777619) >>> 0 : (h * 16777619) % 4294967296; }
    return ('0000000' + (h >>> 0).toString(16)).slice(-8);
  }
  function slug(name) {
    var t = str(name);
    try { t = t.normalize('NFKD'); } catch (e) { /* no normalize: as written */ }
    t = t.replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/^(?:a|an|the|some)\s+/, '');
    var s = t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    if (s.length > LIMITS.slug) s = s.slice(0, LIMITS.slug).replace(/-+$/, '');
    return s || (str(name).trim() ? 'x' + hash8(str(name).trim()) : '');
  }

  function words(s, re, max, each) {
    var out = [];
    str(s).split(re).forEach(function (w) {
      var t = cut(plain(w).toLowerCase(), each);
      if (t && out.indexOf(t) < 0 && out.length < max) out.push(t);
    });
    return out;
  }
  function statesOf(s) { return words(s, /[·,|\/;•]/, LIMITS.states, LIMITS.state); }
  function tagsOf(s) { return words(s, /[\s,·;|•]+/, 99, 24).filter(function (t) { return TAGS.indexOf(t) >= 0; }).slice(0, LIMITS.tags); }

  function clean(t) {
    if (!isObj(t)) return null;
    var name = cut(plain(t.name), LIMITS.name);
    if (!name) return null;
    var sts = Array.isArray(t.states) ? t.states.map(str).join('·') : str(t.states);
    var tgs = Array.isArray(t.tags) ? t.tags.map(str).join(',') : str(t.tags);
    return { name: name, line: cut(plain(t.line), LIMITS.line), look: cut(plain(t.look), LIMITS.look), roll: cut(plain(t.roll), LIMITS.roll),
      danger: cut(plain(t.danger), LIMITS.danger), states: statesOf(sts), tags: tagsOf(tgs), slug: slug(name) };
  }

  /* ---------- the Markdown ---------- */
  /* md as lines { t, code, ind, blank } (code: inside a ``` / ~~~ fence at any indent, as one inside a list item; the fence lines included;
     ind: the indent, a tab counting 4) */
  function linesOf(md) {
    var out = [], fence = '';
    str(md).split(/\r\n?|\n/).forEach(function (t) {
      var f = /^[ \t]*(`{3,}|~{3,})/.exec(t), ind = /^[ \t]*/.exec(t)[0].replace(/\t/g, '    ').length, code;
      if (fence) { code = true; if (f && f[1].charAt(0) === fence.charAt(0) && f[1].length >= fence.length && /^\s*[`~]+\s*$/.test(t)) fence = ''; }
      else if (f) { fence = f[1]; code = true; }
      else code = false;
      out.push({ t: t, code: code, ind: ind, blank: !/\S/.test(t) });
    });
    return out;
  }
  /* a list item: { ind, text } for "- x", "* x", "+ x", "1. x", "1) x" */
  function markerOf(l) {
    var m = /^[ \t]*(?:[-*+]|\d{1,3}[.)])[ \t]+(.*)$/.exec(l.t);
    return m ? { ind: l.ind, text: m[1] } : null;
  }
  /* a block's header: the bullet "- **Things:** rest" (also **Things**:, __), the word in any case */
  function headerOf(l, word) {
    if (l.code || l.blank) return null;
    var m = new RegExp('^[ \\t]*[-*+][ \\t]+(?:\\*\\*|__)\\s*' + word + '\\s*(?::(?:\\*\\*|__)|(?:\\*\\*|__):)(.*)$', 'i').exec(l.t);
    return m ? { ind: l.ind, rest: m[1] } : null;
  }

  var LOOK = /^(?:\ud83d[\udd0d\udd0e]️?|look\s*:)\s*([\s\S]*)$/i;
  var ROLL = /^(?:🎲️?|roll\s*:)\s*([\s\S]*)$/i;
  var DANGER = /^(?:!|⚠️?)\s+([\s\S]*)$|^danger\s*:\s*([\s\S]*)$/i;
  var STATE = /^states?\s*:\s*([\s\S]*)$/i;
  var TAG = /^tags?\s*:\s*([\s\S]*)$/i;

  /* one item: its first line's text and its sub-bullets' texts -> a thing (the first of each kind of line wins) */
  function itemThing(first, subs) {
    var name = '', line = '', t = { look: '', roll: '', danger: '', states: '', tags: '' };
    var b = /^\s*(?:\*\*|__)(.+?)(?:\*\*|__)([\s\S]*)$/.exec(first);
    if (b) { name = plain(b[1]); line = plain(b[2]); }
    else { var p = plain(first), c = p.search(/[,:;]\s|\s[–—-]\s/); if (c > 0) { name = p.slice(0, c); line = p.slice(c); } else name = p; }
    line = line.replace(/^[\s,;:.–—-]+/, '');
    subs.forEach(function (s) {
      var p = plain(s), m;
      if ((m = LOOK.exec(p))) { if (!t.look) t.look = m[1]; }
      else if ((m = ROLL.exec(p))) { if (!t.roll) t.roll = m[1]; }
      else if ((m = DANGER.exec(p))) { if (!t.danger) t.danger = m[1] || m[2] || ''; }
      else if ((m = STATE.exec(p))) { if (!t.states) t.states = m[1]; }
      else if ((m = TAG.exec(p))) { if (!t.tags) t.tags = m[1]; }
    });
    return clean({ name: name, line: line, look: t.look, roll: t.roll, danger: t.danger, states: t.states, tags: t.tags });
  }
  function namesOf(text) { return str(text).split(/[·;|•]/).map(function (n) { return clean({ name: n }); }).filter(Boolean); }

  /* the list under the header at lines[h]: { from, to (exclusive; blank lines after it are left), things } */
  function block(lines, h, hd) {
    var items = [], cur = null, itemInd = -1, last = h;
    for (var j = h + 1; j < lines.length; j++) {
      var l = lines[j];
      if (l.blank) continue;
      if (l.ind <= hd.ind) break;                                    /* back at the header's level (or above): the block is over */
      last = j;
      if (l.code) continue;                                          /* a fence inside the list is never read */
      var mk = markerOf(l);
      if (mk && (itemInd < 0 || mk.ind <= itemInd + 1)) { if (itemInd < 0) itemInd = mk.ind; cur = { first: mk.text, subs: [] }; items.push(cur); }
      else if (mk && cur) cur.subs.push(mk.text);
      else if (cur) { if (cur.subs.length) cur.subs[cur.subs.length - 1] += ' ' + l.t.trim(); else cur.first += ' ' + l.t.trim(); }
    }
    var things = namesOf(plain(hd.rest));
    items.forEach(function (it) { var t = itemThing(it.first, it.subs); if (t) things.push(t); });
    return { from: h, to: last + 1, things: things };
  }

  function findBlock(lines, word) {
    for (var i = 0; i < lines.length; i++) {
      var hd = headerOf(lines[i], word);
      if (!hd) continue;
      if (word === 'Find' && plain(hd.rest)) return { from: i, to: i + 1, things: namesOf(plain(hd.rest)) };      /* the old one-line Find: names only */
      return block(lines, i, hd);
    }
    return null;
  }

  function unique(things) {
    var seen = {}, out = [];
    things.forEach(function (t) { if (!t || !t.slug || has(seen, t.slug) || out.length >= MAX) return; seen[t.slug] = true; out.push(t); });
    return out;
  }

  function read(md) {
    var src = str(md), none = { things: [], md: src };
    try {
      var lines = linesOf(src), b = findBlock(lines, 'Things');
      if (!b || !b.things.length) b = findBlock(lines, 'Find');
      var things = b ? unique(b.things) : [];
      if (!things.length) return none;
      return { things: things, md: lines.slice(0, b.from).concat(lines.slice(b.to)).map(function (l) { return l.t; }).join('\n').trim() };
    } catch (e) { return none; }
  }
  function parse(md) { return read(md).things; }

  return { parse: parse, read: read, slug: slug, clean: clean, LIMITS: LIMITS, TAGS: TAGS, MAX: MAX };
});
