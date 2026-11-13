/* gm/players-board.js: the planning board's pins (IP6 of the players' screen build, behind the setting stage.players). B68GmPlayersBoard.

   What the crew has learned, pinned to the room it belongs to on the score scene's cork board (the ambient scene "board",
   app/ambient/planning-board.html). A pin is { id, room, kind, text, npcId? }: kind line (something overheard or learned), face (a person),
   item, route or question; text at most 60 characters; at most 8 pins a site.

   Stored on the GM state under a NEW optional key, boardPins: { "<site name>": { pins: [pin], at: ms } }, at most 6 sites (the oldest goes).
   Nothing older reads it (Deploy 38 ignores it). Each pin is drawn HERE as one of the map kit's tokens, { room, label, svg } (the board theme
   pins a token to its room as a polaroid on red string, and drops a token whose room the players do not know): an index card in the kit's
   540 x 600 token frame, or for a face the figure kit's portrait of a REVEALED NPC under the name the players know (the known-as swap).
   Every figure drawn gets an id of its own (pb-<pin>-<n>): one board never holds two copies of the same ids.

   The page's own door does the rest (host.setScore): each token through the page's token screen on its own (a token in a room the players do
   not know waits; one that would name a hidden room, NPC or clock is refused and named), then the board drawn on the PLAYER layer with them
   and the page's leak scan over the whole board, the gate, and the ambient document's score.

   Pure: clean(list) · sitesOf(doc) · pinsOf(doc, site) · patchFor(doc, site, pins, now) · wrap(text, w) · fitText(text, w, h) · cardSvg(pin, uid)
         faceSvg(npc, K, uid) · known(npc) · token(pin, ctx) · sig(parts)
   paint(box, host): fills [data-pb-slot] under box with the Board block (DOM, no markup sink) and keeps the score scene in step
   host = { doc(), roll(), site() -> name, rooms() -> [{ name, shown }], npcs(), scan(text) -> [hidden names], patch(p) -> bool,
            score() -> the ambient score | null, setScore(tokens, ask) -> Promise<{ ok, refused: [{ label, names }], waiting: n } | null>,
            showBoard() -> Promise<bool>, toast(msg, bad), figures() -> the figure kit | null, busy() -> bool } */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmPlayersBoard = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var KEY = 'boardPins', KINDS = ['line', 'face', 'item', 'route', 'question'];
  var MAX = 8, TEXT_MAX = 60, SITES_MAX = 6, SITE_MAX = 80, FACES_MAX = 4, SVG_MAX = 590 * 1024;      /* a face is ~70 KB of figure: four keep the board under the iPad's 600 KiB */
  var WORD = { line: 'Overheard', face: 'Face', item: 'Item', route: 'Route', question: 'Question' };
  var KIND_LABEL = { line: 'Line (overheard, learned)', face: 'Face (a person)', item: 'Item', route: 'Route', question: 'Question' };

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function one(s) { return str(s).replace(/\s+/g, ' ').trim(); }

  /* ---------- the stored pins ---------- */
  function cleanPin(p) {
    if (!isObj(p) || typeof p.id !== 'string' || !/^[a-z0-9-]{1,24}$/.test(p.id) || KINDS.indexOf(p.kind) < 0) return null;
    var room = one(p.room).slice(0, 120), text = one(p.text).slice(0, TEXT_MAX);
    if (!room) return null;
    var out = { id: p.id, room: room, kind: p.kind, text: text };
    if (p.kind === 'face') { if (typeof p.npcId !== 'string' || !p.npcId) return null; out.npcId = p.npcId.slice(0, 80); }
    else if (!text) return null;
    return out;
  }
  function clean(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (p) { var c = cleanPin(p); if (c && !seen[c.id] && out.length < MAX) { seen[c.id] = 1; out.push(c); } });
    return out;
  }
  function siteName(s) { return one(s).slice(0, SITE_MAX); }
  function sitesOf(doc) { return isObj(doc) && isObj(doc[KEY]) ? doc[KEY] : {}; }
  function pinsOf(doc, site) { var s = sitesOf(doc)[siteName(site)]; return isObj(s) ? clean(s.pins) : []; }
  /* the GM state patch that stores these pins for this site (and drops the oldest sites past six) */
  function patchFor(doc, site, pins, now) {
    var name = siteName(site), all = sitesOf(doc), p = {}, keep = Object.keys(all).filter(function (k) { return k !== name && isObj(all[k]); });
    p[name] = { pins: clean(pins), at: typeof now === 'number' ? now : Date.now() };
    keep.sort(function (a, b) { return (+all[b].at || 0) - (+all[a].at || 0); });
    keep.slice(SITES_MAX - 1).forEach(function (k) { p[k] = null; });
    var out = {}; out[KEY] = p; return out;
  }
  function newId(list) { var n = 1, have = {}; list.forEach(function (p) { have[p.id] = 1; }); while (have['p' + n]) n++; return 'p' + n; }

  /* ---------- drawing ---------- */
  /* word wrap at w characters; a word longer than the line is broken (never clipped, never an ellipsis) */
  function wrap(text, w) {
    var words = one(text).split(' ').filter(Boolean), lines = [], cur = '';
    words.forEach(function (x) {
      while (x.length > w) { if (cur) { lines.push(cur); cur = ''; } lines.push(x.slice(0, w)); x = x.slice(w); }
      if (!cur) cur = x; else if ((cur + ' ' + x).length <= w) cur += ' ' + x; else { lines.push(cur); cur = x; }
    });
    if (cur) lines.push(cur);
    return lines;
  }
  /* the card's lines and their size in a w x h text area: of the wraps into one to five lines, the one that sets the words largest (a word longer
     than 22 characters is broken, never clipped; the 60 characters always fit) */
  /* the card face's advance widths in em (Archivo Condensed at weight 800, measured in Edge 14/11/2026); a character not listed counts wide */
  var LH = 1.08, ADV = { ' ': .17, '.': .28, ',': .28, "'": .24, '?': .55, '!': .3, '-': .3, '&': .73, '"': .44, '(': .37, ')': .37 };
  'abcdeghknopquxy'.split('').forEach(function (c) { ADV[c] = .57; }); 'fr'.split('').forEach(function (c) { ADV[c] = .37; }); 'ijl'.split('').forEach(function (c) { ADV[c] = .26; });
  ADV.s = .52; ADV.t = .35; ADV.v = .51; ADV.z = .48; ADV.m = .84; ADV.w = .78; ADV.I = .3; ADV.M = .84; ADV.W = .89; '0123456789'.split('').forEach(function (c) { ADV[c] = .56; });
  function ems(line) { var n = 0; for (var i = 0; i < line.length; i++) { var c = line.charAt(i); n += ADV[c] !== undefined ? ADV[c] : /[A-Z]/.test(c) ? .74 : .6; } return n; }
  function fitText(text, w, h) {
    var t = one(text).slice(0, TEXT_MAX), W0 = w || 480, H0 = h || 420, best = null;
    var lw = Math.min(22, t.split(' ').reduce(function (m, x) { return Math.max(m, x.length); }, 1));
    for (var cw = Math.max(lw, Math.ceil(t.length / 5)); cw <= Math.max(lw, t.length); cw++) {
      var lines = wrap(t, cw);
      if (lines.length > 5) continue;
      var longest = lines.reduce(function (m, l) { return Math.max(m, ems(l)); }, .5);
      var size = Math.floor(Math.min(110, W0 / longest, H0 / (lines.length * LH)));
      if (!best || size > best.size) best = { lines: lines, size: size };
    }
    return best || { lines: wrap(t, 22), size: 40 };
  }
  var FONT = "'Archivo Condensed', 'Arial Narrow', sans-serif", TYPE = "'Courier Prime', 'Courier New', monospace";
  function textBlock(fit, x, y0, h, fill) {
    var lh = fit.size * LH, top = y0 + (h - lh * fit.lines.length) / 2 + fit.size * 0.8;
    return fit.lines.map(function (l, i) { return '<text x="' + x + '" y="' + Math.round(top + i * lh) + '" font-family="' + FONT + '" font-weight="800" font-size="' + fit.size + '" fill="' + fill + '">' + esc(l) + '</text>'; }).join('');
  }
  function head(word, fill, x, y) { return '<text x="' + x + '" y="' + y + '" font-family="' + TYPE + '" font-weight="700" font-size="44" letter-spacing="6" fill="' + fill + '">' + esc(word) + '</text>'; }
  var OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 600">';
  /* the text area of each kind, [x, y, w, h] in the 540 x 600 frame: wide enough that 60 characters are set at 60 units or more */
  var AREAS = { item: [32, 172, 476, 405], route: [24, 262, 492, 334], question: [24, 140, 492, 445], line: [24, 136, 492, 450] };      /* at least 24 of 540 (4.4%) clear of each edge */
  /* an index card for line, item, route or question, in the kit's 540 x 600 token frame; each kind its own colour and shape, read at 1.5 m */
  function cardSvg(pin, uid) {
    var p = isObj(pin) ? pin : {}, k = AREAS[p.kind] ? p.kind : 'line', a = AREAS[k], fit = fitText(p.text, a[2], a[3]), g = '';
    if (k === 'item') {      /* a manila luggage tag, hung by its string */
      g = '<rect width="540" height="600" fill="#2f2a22"/><path d="M90 20 H450 L525 95 V585 H15 V95 Z" fill="#d8b878"/><circle cx="270" cy="70" r="24" fill="#2f2a22"/>' +
        '<circle cx="270" cy="70" r="32" fill="none" stroke="#b08d4e" stroke-width="9"/><path d="M270 70 C250 40 230 15 200 0" fill="none" stroke="#efe6cf" stroke-width="7"/>' +
        head('ITEM', '#5a3f12', 40, 150) + '<rect x="40" y="162" width="460" height="5" fill="#5a3f12"/>';
    } else if (k === 'route') {      /* a torn strip of street map with the way marked */
      var grid = ''; for (var i = 0; i < 6; i++) grid += '<path d="M' + (i * 100 - 20) + ' 0 L' + (i * 100 + 30) + ' 210" stroke="#a9b7c2" stroke-width="' + (i % 2 ? 10 : 22) + '"/>';
      for (var j = 0; j < 3; j++) grid += '<path d="M0 ' + (35 + j * 70) + ' L540 ' + (20 + j * 70) + '" stroke="#a9b7c2" stroke-width="' + (j % 2 ? 14 : 8) + '"/>';
      g = '<rect width="540" height="600" fill="#f4f1e8"/><rect width="540" height="210" fill="#dfe6ea"/>' + grid +
        '<path d="M40 180 C140 160 150 100 250 100 S400 60 470 36" fill="none" stroke="#c22f1c" stroke-width="16" stroke-dasharray="34 22" stroke-linecap="round"/>' +
        '<path d="M470 36 l-62 6 l40 46 z" fill="#c22f1c"/><circle cx="40" cy="180" r="18" fill="#c22f1c"/>' +
        '<path d="M0 210 L30 198 L70 216 L110 200 L160 218 L210 202 L260 216 L320 198 L380 218 L430 200 L490 216 L540 202 V600 H0 Z" fill="#f4f1e8"/>' + head('ROUTE', '#c22f1c', 30, 258);
    } else if (k === 'question') {      /* a yellow card with a large question mark */
      g = '<rect width="540" height="600" fill="#f2d64b"/><text x="270" y="430" text-anchor="middle" font-family="' + FONT + '" font-weight="900" font-size="560" fill="#c22f1c" opacity="0.22">?</text>' +
        '<text x="470" y="120" text-anchor="middle" font-family="' + FONT + '" font-weight="900" font-size="150" fill="#c22f1c">?</text>' + head('ASK', '#7a1a10', 30, 82);
    } else {      /* line: a ruled white index card */
      var rules = ''; for (var r = 0; r < 7; r++) rules += '<rect x="0" y="' + (190 + r * 58) + '" width="540" height="3" fill="#8fa3dd"/>';
      g = '<rect width="540" height="600" fill="#fbf8f1"/><rect x="0" y="118" width="540" height="6" fill="#c22f1c"/>' + rules +
        '<path d="M40 30 h40 l-12 60 h-40 z M100 30 h40 l-12 60 h-40 z" fill="#14110e"/>' + head('HEARD', '#c22f1c', 160, 84);
    }
    g += textBlock(fit, a[0], a[1], a[3], k === 'item' ? '#241a08' : '#14110e');
    return OPEN + '<title>' + esc(one(p.text).slice(0, TEXT_MAX)) + '</title><g id="' + esc(uid) + '">' + g + '</g></svg>';      /* the words whole in the title: the page's scan reads them unbroken */
  }

  /* the name the players know: a known-as NPC (tag known-as, an alias) goes by the alias, as everywhere the table sees the cast */
  function known(npc) {
    var d = isObj(npc) ? npc : {}, tags = Array.isArray(d.tags) ? d.tags : [];
    var ka = tags.some(function (t) { return typeof t === 'string' && t.trim().toLowerCase() === 'known-as'; }) && one(d.alias);
    return ka ? one(d.alias) : one(d.name);
  }
  /* a face: the figure kit's portrait of the NPC (the spec with the known name, no notes), its ids its own; '' when it cannot be drawn */
  /* lite: the same face without the height chart and halo, its path coordinates whole numbers (about a third lighter, the same picture at this size) */
  function faceSvg(npc, K, uid, lite) {
    var d = isObj(npc) ? npc : {};
    if (!K || typeof K.portrait !== 'function' || !isObj(d.spec) || !Object.keys(d.spec).length) return '';
    try {
      var s = JSON.parse(JSON.stringify(d.spec)), name = known(d);
      delete s.notes; delete s.$comment; s.id = uid; s.name = name; if (s.plate) s.plate = name;
      var svg = str(K.portrait(s, lite ? { lod: 'lo', chart: false, halo: false } : { lod: 'lo' }).svg);
      if (lite) svg = svg.replace(/ d="([^"]*)"/g, function (m, d) { return ' d="' + d.replace(/-?\d+\.\d+/g, function (n) { return String(Math.round(+n)); }) + '"'; });
      svg = svg.replace(/<svg([^>]*?)\swidth="[^"]*"/, '<svg$1').replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1');
      return /^<svg[\s>]/.test(svg) ? svg : '';
    } catch (e) { return ''; }
  }
  /* a plain plate with the initials, for a face the figure kit cannot draw */
  function plateSvg(name, uid) {
    var ini = one(name).split(' ').filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
    return OPEN + '<g id="' + esc(uid) + '"><rect width="540" height="600" fill="#cfc7b2"/><circle cx="270" cy="230" r="110" fill="#3b3326"/>' +
      '<path d="M60 600 C60 420 150 350 270 350 C390 350 480 420 480 600 Z" fill="#3b3326"/><text x="270" y="560" text-anchor="middle" font-family="' + TYPE + '" font-size="84" font-weight="700" fill="#f8f3e6">' + esc(ini) + '</text></g></svg>';
  }
  var drawN = 0;
  /* one pin as the kit's token { room, label, svg }, or null (a face whose NPC is not revealed, or not in the cast) */
  function token(pin, ctx) {
    var c = isObj(ctx) ? ctx : {}, uid = 'pb-' + pin.id + '-' + (++drawN).toString(36);
    if (pin.kind === 'face') {
      var d = isObj(c.npcs) ? c.npcs[pin.npcId] : null;
      if (!isObj(d) || d.revealed !== true || !known(d)) return null;
      return { room: pin.room, label: known(d).slice(0, 80), svg: faceSvg(d, c.K, uid) || plateSvg(known(d), uid) };
    }
    return { room: pin.room, label: WORD[pin.kind], svg: cardSvg(pin, uid) };
  }
  function sig(parts) { return JSON.stringify(parts); }
  /* the board under the iPad's cap with as many real faces as fit: items [{ full, lite?, alt? }] (screened tokens, oldest pin first). With every
     face full the board is too large -> the oldest face is drawn lighter, then the next... -> then the oldest lighter face becomes a name plate,
     then the next, until it fits. -> { svg | null, lighter, plates }. A board refused for any other reason (a leak) is null at once. */
  function fitBoard(roll, render, o, items) {
    var cur = items.map(function (x) { return x.full; }), out = { svg: null, lighter: 0, plates: 0 }, faces = [];
    function big() { var rp = {}; out.svg = board(roll, render, Object.assign({}, o, { tokens: cur, report: rp })); return !out.svg && rp.big === true; }
    if (!big()) return out;
    items.forEach(function (x, i) { if (x.lite || x.alt) faces.push(i); });
    for (var a = 0; a < faces.length; a++) { if (!items[faces[a]].lite) continue; cur[faces[a]] = items[faces[a]].lite; out.lighter++; if (!big()) return out; }
    for (var b = 0; b < faces.length; b++) { if (!items[faces[b]].alt) continue; cur[faces[b]] = items[faces[b]].alt; out.plates++; if (!big()) return out; }
    return out;
  }
  /* the score scene's board drawn again with the pins: the PLAYER layer, the board theme, the view the score scene chose (kit 1 only on the plan, as there),
     at the bands and the rooms opened on their own. o = { seen, tokens (each already through the page's token screen), view, kit1, leaks(svg, roll, reveal) }.
     -> the svg, or null when there is nothing to pin or the leak scan finds a hidden name anywhere on it (the board then goes up without its pins) */
  function board(roll, render, o) {
    var x = isObj(o) ? o : {};
    if (!roll || typeof render !== 'function' || typeof x.leaks !== 'function' || !Array.isArray(x.tokens) || !x.tokens.length || !Array.isArray(x.seen)) return null;
    var view = x.view === 'rings' ? 'rings' : 'plan', opts = { view: view, theme: 'board', layer: 'player', reveal: x.seen, width: 1600, tokens: x.tokens };
    if (view === 'plan' && x.kit1) opts.kit1 = true;
    var r; try { r = render(roll, opts); } catch (e) { return null; }
    if (r && typeof r.svg === 'string' && r.svg.length > SVG_MAX && isObj(x.report)) x.report.big = true;      /* over the iPad's cap: the caller may lighten the faces */
    return r && typeof r.svg === 'string' && r.svg.length <= SVG_MAX && !x.leaks(r.svg, roll, x.seen).length ? r.svg : null;
  }

  /* ---------- the GM's block ---------- */
  var st = { last: null, busy: false, again: false, form: { kind: 'line' }, focus: '', caret: -1, refused: [], plated: false, roll: undefined };
  function el(doc, tag, attrs, text) {
    var e = doc.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] !== false && attrs[k] != null) e.setAttribute(k, attrs[k] === true ? '' : attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function btn(doc, label, attrs) { var b = el(doc, 'button', Object.assign({ type: 'button', 'class': 'btn sm' }, attrs || {}), label); return b; }

  /* what the board shows now: the pins of this site, and the signature that says when the stored score is behind */
  function state(host) {
    var site = siteName(host.site()), pins = site ? pinsOf(host.doc(), site) : [], rooms = host.rooms() || [], npcs = host.npcs() || {};
    var shown = {}; rooms.forEach(function (r) { if (r.shown) shown[r.name] = 1; });
    var faces = pins.filter(function (p) { return p.kind === 'face'; }).map(function (p) { var d = npcs[p.npcId]; return [p.npcId, isObj(d) && d.revealed === true ? known(d) : '', isObj(d) ? JSON.stringify(d.spec || {}).length : 0]; });
    /* the names no pin may show now (hidden NPCs and clocks, a known-as NPC's full name): a change to them redraws the board, as a reveal does */
    var hide = (typeof host.hide === 'function' ? host.hide() || [] : []).map(function (x) { return str(x).toLowerCase(); }).sort();
    var shownKey = Object.keys(shown).sort().join('|');
    return { site: site, pins: pins, shown: shown, rooms: rooms, npcs: npcs, shownKey: shownKey, sig: sig([site, Object.keys(shown).sort(), pins, faces, hide]) };
  }
  function tokensOf(s, host) {
    var K = typeof host.figures === 'function' ? host.figures() : null, out = [];
    s.pins.forEach(function (p) {
      var t = token(p, { npcs: s.npcs, K: K }); if (!t) return;
      var x = { pin: p, tok: t };      /* a face also has a plain plate (initials, the name as its caption): what goes up if the figures will not fit the iPad's cap */
      if (p.kind === 'face') {      /* in reserve, lightest last: the face without its chart and with whole-number paths, then a name plate */
        var d = s.npcs[p.npcId], lite = faceSvg(d, K, 'pb-' + p.id + '-' + (++drawN).toString(36), true);
        if (lite) x.lite = { room: t.room, label: t.label, svg: lite };
        x.alt = { room: t.room, label: t.label, svg: plateSvg(t.label, 'pb-' + p.id + '-n' + (++drawN).toString(36) + '-plate') };
      }
      out.push(x);
    });
    return out;
  }
  /* set the score scene from the pins (and the bands and rooms ticked now); one at a time, the newest wins */
  function sync(host, ask) {
    if (st.busy) { st.again = true; return Promise.resolve(null); }
    var s = state(host); if (!s.site) return Promise.resolve(null);
    /* the bands the iPad shows stay as they are until the GM ticks a band or opens a room on this page (a page reloaded or a roll replayed starts at
       public: a pin, a name hidden or a face changed must not take the players' rooms away with it) */
    var keep = onBoard(host, s) && st.bands !== undefined && s.shownKey === st.bands;
    st.busy = true; st.last = s.sig;
    var list = tokensOf(s, host);
    return Promise.resolve(host.setScore(list, !!ask, keep)).then(function (r) {
      if (r && !keep) st.bands = s.shownKey;
      st.busy = false;
      /* a pin the screen refuses now (someone hidden again, a clock hidden, a known-as name) stays stored and waits, as a pin for an unknown room does; said once */
      if (r) { var ids = (r.refused || []).map(function (x) { return x.id; }), fresh = (r.refused || []).filter(function (x) { return st.refused.indexOf(x.id) < 0; }); st.refused = ids;
        if (fresh.length) host.toast('Off the board until it is safe: ' + fresh.map(function (x) { return x.label; }).join(', ') + ' would show the players a name they must not see (' + fresh.map(function (x) { return x.names.join(', '); }).join('; ') + ').', true);
        if (r.plates && !st.plated) { st.plated = true; host.toast((r.plates === 1 ? 'One face' : r.plates + ' faces') + ' went up as a name plate: with every figure the board was too large for the iPad.', true); } }
      if (!r) st.last = '';      /* not set: the next look tries again (a sig is never '') */
      if (st.again) { st.again = false; var n = state(host); if (n.sig !== st.last) return sync(host, false); }
      return r;
    }, function () { st.busy = false; st.last = ''; return null; });
  }
  function add(host, pin) {
    var s = state(host); if (!s.site) { host.toast('Roll a location first.', true); return false; }
    if (s.pins.length >= MAX) { host.toast('The board holds ' + MAX + ' pins: take one down first.', true); return false; }
    var p = cleanPin(Object.assign({ id: newId(s.pins) }, pin));
    if (!p) { host.toast(pin && pin.kind === 'face' ? 'Choose who to pin.' : 'Write what to pin (at most ' + TEXT_MAX + ' characters).', true); return false; }
    if (p.kind === 'face') {
      var d = s.npcs[p.npcId];
      if (!isObj(d) || d.revealed !== true) { host.toast('Not pinned: that person is hidden from the players. Reveal them first.', true); return false; }
      if (s.pins.some(function (q) { return q.kind === 'face' && q.npcId === p.npcId; })) { host.toast(known(d) + ' is on the board already.', true); return false; }
      if (s.pins.filter(function (q) { return q.kind === 'face'; }).length >= FACES_MAX) { host.toast('The board holds ' + FACES_MAX + ' faces: take one down first.', true); return false; }
    }
    var hits = host.scan(p.text) || [];
    if (hits.length) { host.toast('Not pinned: the text names ' + hits.join(', ') + ', which the players must not see yet.', true); return false; }
    var first = !onBoard(host, s);
    if (!host.patch(patchFor(host.doc(), s.site, s.pins.concat([p])))) return false;
    sync(host, first);
    return true;
  }
  function remove(host, id) {
    var s = state(host), left = s.pins.filter(function (p) { return p.id !== id; });
    if (left.length === s.pins.length) return false;
    if (!host.patch(patchFor(host.doc(), s.site, left))) return false;
    if (onBoard(host, s)) sync(host, false);
    return true;
  }
  /* this site's score scene is the stored one */
  function onBoard(host, s) { var sc = host.score(); return !!(isObj(sc) && s.site && siteName(sc.name) === s.site); }

  /* the score scene follows a change while this site's board is up; while the page is busy with the iPad it looks again shortly (at most 20 times) */
  function follow(host, n) {
    if (rolled(host)) return;
    var s = state(host);
    if (s.sig === st.last || !onBoard(host, s)) return;
    if (typeof host.busy === 'function' && host.busy()) { if (n < 20) setTimeout(function () { follow(host, n + 1); }, 400); return; }
    sync(host, false);
  }
  /* the roll on the Location card is another object than at the last look (another site, or this one replayed from Earlier, which resets the
     reveal to public): take it as the new starting point and write nothing, so leaving a site and coming back never downgrades the iPad */
  function rolled(host) { var r = typeof host.roll === 'function' ? host.roll() : null; if (st.roll === undefined) { st.roll = r; return false; } if (r === st.roll) return false; st.roll = r; var s0 = state(host); st.last = s0.sig; st.bands = s0.shownKey; return true; }
  function paint(box, host) {
    var slot = box && box.querySelector ? box.querySelector('[data-pb-slot]') : null;
    var s = state(host);
    /* keep the score scene in step: a pin, a reveal or a face changed since this page last set it, while this site's board is the score scene */
    if (st.last === null || rolled(host)) { st.last = s.sig; st.roll = host.roll(); st.bands = s.shownKey; }      /* a new page, or a roll replayed (its reveal reset): the stored board stands until the GM changes something */
    else follow(host, 0);
    if (!slot) return;
    var doc = slot.ownerDocument, root = el(doc, 'section', { 'class': 'gm-pboard', 'aria-label': 'Board' });
    root.appendChild(el(doc, 'h4', {}, 'Board'));
    var known_ = s.rooms.filter(function (r) { return r.shown; });
    var f = el(doc, 'form', { 'class': 'gm-map-ctl', 'data-pb': 'form' });
    function field(lab, ctl) { var l = el(doc, 'label', { 'class': 'gm-field' }); l.appendChild(el(doc, 'span', { 'class': 'gm-lab' }, lab)); l.appendChild(ctl); return l; }
    var room = el(doc, 'select', { 'data-pb': 'room', 'aria-label': 'Room' });
    known_.forEach(function (r) { room.appendChild(el(doc, 'option', { value: r.name }, r.name)); });
    if (st.form.room) room.value = st.form.room;
    var kind = el(doc, 'select', { 'data-pb': 'kind', 'aria-label': 'Kind' });
    KINDS.forEach(function (k) { kind.appendChild(el(doc, 'option', { value: k }, KIND_LABEL[k])); });
    kind.value = st.form.kind;
    var what;
    if (st.form.kind === 'face') {
      what = el(doc, 'select', { 'data-pb': 'npc', 'aria-label': 'Who' });
      Object.keys(s.npcs).filter(function (id) { var d = s.npcs[id]; return isObj(d) && d.revealed === true && known(d); })
        .sort(function (a, b) { return known(s.npcs[a]).localeCompare(known(s.npcs[b])); })
        .forEach(function (id) { what.appendChild(el(doc, 'option', { value: id }, known(s.npcs[id]))); });
    } else what = el(doc, 'input', { type: 'text', 'data-pb': 'text', maxlength: String(TEXT_MAX), placeholder: 'What the crew learned (Enter pins it)', autocomplete: 'off', 'aria-label': 'Text' });
    if (st.form.text && what.tagName === 'INPUT') what.value = st.form.text;
    if (st.form.npc && what.tagName === 'SELECT' && [].some.call(what.options, function (o) { return o.value === st.form.npc; })) what.value = st.form.npc;      /* the person chosen survives a redraw */
    f.appendChild(field('Room', room)); f.appendChild(field('Kind', kind)); f.appendChild(field(st.form.kind === 'face' ? 'Who' : 'Text', what));
    var pinB = btn(doc, 'Pin', { type: 'submit', 'class': 'btn sm primary', 'data-pb': 'pin' });
    if (!known_.length || !s.site) { pinB.disabled = true; pinB.title = s.site ? 'No room is known to the players yet: reveal a band or open a room' : 'Roll a location first'; }
    f.appendChild(pinB);
    root.appendChild(f);
    kind.addEventListener('change', function () { st.form.kind = kind.value; st.form.room = room.value; paint(box, host); });
    room.addEventListener('change', function () { st.form.room = room.value; });
    if (what.tagName === 'INPUT') what.addEventListener('input', function () { st.form.text = what.value; });
    else what.addEventListener('change', function () { st.form.npc = what.value; });
    f.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var pin = { room: room.value, kind: kind.value, text: kind.value === 'face' ? '' : what.value, npcId: kind.value === 'face' ? what.value : undefined };
      st.form.room = room.value;
      if (add(host, pin)) { st.form.text = ''; paint(box, host); var t = slot.querySelector('[data-pb="text"]'); if (t) t.focus(); }
    });
    if (s.pins.length) {
      var ul = el(doc, 'ul', { 'class': 'gm-pb-list', 'data-pb': 'list' });
      s.pins.forEach(function (p) {
        var li = el(doc, 'li', { 'data-pb-pin': p.id }), d = p.kind === 'face' ? s.npcs[p.npcId] : null;
        li.appendChild(el(doc, 'b', {}, WORD[p.kind]));
        li.appendChild(doc.createTextNode(' · ' + p.room + ' · '));
        li.appendChild(el(doc, 'span', {}, p.kind === 'face' ? (isObj(d) ? known(d) : 'someone no longer in the cast') : p.text));
        if (!s.shown[p.room]) li.appendChild(el(doc, 'span', { 'class': 'gm-dim', 'data-pb': 'waiting' }, ' (waiting for the room)'));
        else if (p.kind === 'face' && !(isObj(d) && d.revealed === true)) li.appendChild(el(doc, 'span', { 'class': 'gm-dim' }, ' (hidden: not on the board)'));
        else if (st.refused.indexOf(p.id) >= 0) li.appendChild(el(doc, 'span', { 'class': 'gm-dim', 'data-pb': 'refused' }, ' (names someone hidden: not on the board)'));
        var x = btn(doc, '×', { 'class': 'btn sm', 'data-pb': 'remove', 'aria-label': 'Take down ' + WORD[p.kind] + ' in ' + p.room, title: 'Take this pin down' });
        x.addEventListener('click', function () { if (remove(host, p.id)) paint(box, host); });
        li.appendChild(doc.createTextNode(' ')); li.appendChild(x);
        ul.appendChild(li);
      });
      root.appendChild(ul);
    } else root.appendChild(el(doc, 'p', { 'class': 'gm-dim' }, 'No pins yet. A pin goes on the planning board in its room, in front of the players.'));
    var acts = el(doc, 'div', { 'class': 'gm-map-acts' });
    var show = btn(doc, 'Board on the iPad', { 'data-pb': 'show', title: 'The planning board becomes the iPad scene (and whatever covers it comes down)' });
    if (!s.site) show.disabled = true;
    show.addEventListener('click', function () {
      var go = onBoard(host, s) && st.last === s.sig ? Promise.resolve(true) : sync(host, true).then(function (r) { return !!(r && r.ok); });
      go.then(function (ok) { if (ok) return host.showBoard(); });
    });
    acts.appendChild(show);
    root.appendChild(acts);
    while (slot.firstChild) slot.removeChild(slot.firstChild);
    slot.appendChild(root);
    /* the panel is redrawn under the GM's hands (a poll, a reveal): the field being typed in keeps the focus and the caret. The page has already
       replaced the slot, so where the focus was is this module's own note (a blur while the field is still on the page clears it) */
    [room, kind, what].forEach(function (c) {
      var name = c.getAttribute('data-pb');
      c.addEventListener('focus', function () { st.focus = name; });
      c.addEventListener('blur', function () { if (c.isConnected) st.focus = ''; });
      c.addEventListener('keyup', function () { if (typeof c.selectionStart === 'number') st.caret = c.selectionStart; });
    });
    var lost = !doc.activeElement || doc.activeElement === doc.body;
    var back = st.focus && lost ? slot.querySelector('[data-pb="' + st.focus + '"]') : null;
    if (back) { back.focus(); if (back.getAttribute('data-pb') === 'text' && back.setSelectionRange) { var c0 = Math.min(st.caret >= 0 ? st.caret : back.value.length, back.value.length); back.setSelectionRange(c0, c0); } }
  }
  function reset() { st.last = null; st.busy = false; st.again = false; st.form = { kind: 'line' }; st.focus = ''; st.caret = -1; st.refused = []; st.plated = false; st.roll = undefined; st.bands = undefined; }

  return { KEY: KEY, KINDS: KINDS, MAX: MAX, FACES_MAX: FACES_MAX, TEXT_MAX: TEXT_MAX, SITES_MAX: SITES_MAX, WORD: WORD,
    clean: clean, sitesOf: sitesOf, pinsOf: pinsOf, patchFor: patchFor, wrap: wrap, fitText: fitText, cardSvg: cardSvg, faceSvg: faceSvg, known: known,
    token: token, sig: sig, board: board, fitBoard: fitBoard, ems: ems, AREAS: AREAS, rebase: function (host) { var s0 = state(host); st.last = s0.sig; st.bands = s0.shownKey; st.roll = host.roll(); }, paint: paint, follow: function (host) { follow(host, 0); }, add: add, remove: remove, sync: sync, reset: reset, _state: state };
});
