/* gm/players-board.js: the planning board's pins (IP6 of the players' screen build, behind the setting stage.players). B68GmPlayersBoard.

   What the crew has learned, pinned to the room it belongs to on the score scene's cork board (the ambient scene "board",
   app/ambient/planning-board.html). A pin is { id, room, kind, text, npcId? }: kind line (something overheard or learned), face (a person),
   item, route or question; text at most 60 characters; at most 12 pins a site.

   Stored on the GM state under a NEW optional key, boardPins: { "<site name>": { pins: [pin], at: ms } }, at most 6 sites (the oldest goes).
   Nothing older reads it (Deploy 38 ignores it). Each pin is drawn HERE as one of the map kit's tokens, { room, label, svg } (the board theme
   pins a token to its room as a polaroid on red string, and drops a token whose room the players do not know): an index card in the kit's
   540 x 600 token frame, or for a face the figure kit's portrait of a REVEALED NPC under the name the players know (the known-as swap).
   Every figure drawn gets an id of its own (pb-<pin>-<n>): one board never holds two copies of the same ids.

   The page's own door does the rest (host.setScore): each token through the page's token screen on its own (a token in a room the players do
   not know waits; one that would name a hidden room, NPC or clock is refused and named), then the board drawn on the PLAYER layer with them
   and the page's leak scan over the whole board, the gate, and the ambient document's score.

   Pure: clean(list) · sitesOf(doc) · pinsOf(doc, site) · patchFor(doc, site, pins, now) · wrap(text, w) · fitText(text) · cardSvg(pin, uid)
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
  var MAX = 12, TEXT_MAX = 60, SITES_MAX = 6, SITE_MAX = 80, FACES_MAX = 4, SVG_MAX = 590 * 1024;      /* a face is ~70 KB of figure: four keep the board under the iPad's 600 KiB */
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
  /* the card's lines and their size: the narrowest wrap that keeps to three lines (the 60 characters always fit three), set as large as the card is wide */
  var ADV = 0.5, AREA = 470;
  function fitText(text) {
    var t = one(text).slice(0, TEXT_MAX), lw = t.split(' ').reduce(function (m, x) { return Math.max(m, x.length); }, 0), w = Math.max(8, Math.ceil(t.length / 3), Math.min(lw, 22)), lines = wrap(t, w);
    while (lines.length > 3) { w++; lines = wrap(t, w); }
    var longest = lines.reduce(function (m, l) { return Math.max(m, l.length); }, 1);
    return { lines: lines, size: Math.round(Math.min(92, AREA / (longest * ADV))) };
  }
  var FONT = "'Archivo Condensed', 'Arial Narrow', sans-serif", TYPE = "'Courier Prime', 'Courier New', monospace";
  function textBlock(fit, x, y0, h, fill, anchor) {
    var lh = fit.size * 1.08, top = y0 + (h - lh * fit.lines.length) / 2 + fit.size * 0.8;
    return fit.lines.map(function (l, i) { return '<text x="' + x + '" y="' + Math.round(top + i * lh) + '"' + (anchor ? ' text-anchor="' + anchor + '"' : '') + ' font-family="' + FONT + '" font-weight="800" font-size="' + fit.size + '" fill="' + fill + '">' + esc(l) + '</text>'; }).join('');
  }
  function head(word, fill, x, y) { return '<text x="' + x + '" y="' + y + '" font-family="' + TYPE + '" font-weight="700" font-size="44" letter-spacing="6" fill="' + fill + '">' + esc(word) + '</text>'; }
  var OPEN = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 600">';
  /* an index card for line, item, route or question, in the kit's 540 x 600 token frame; each kind its own colour and shape, read at 1.5 m */
  function cardSvg(pin, uid) {
    var p = isObj(pin) ? pin : {}, fit = fitText(p.text), g = '';
    if (p.kind === 'item') {      /* a manila luggage tag on a string */
      g = '<rect width="540" height="600" fill="#2f2a22"/><path d="M110 40 H500 V560 H110 L30 470 V130 Z" fill="#d8b878"/><circle cx="92" cy="300" r="26" fill="#2f2a22"/>' +
        '<circle cx="92" cy="300" r="34" fill="none" stroke="#b08d4e" stroke-width="10"/><path d="M92 300 C40 250 20 150 0 120" fill="none" stroke="#efe6cf" stroke-width="7"/>' +
        head('ITEM', '#5a3f12', 150, 112) + '<rect x="150" y="132" width="320" height="6" fill="#5a3f12"/>' + textBlock(fitAt(p.text, 330), 150, 150, 390, '#241a08');
    } else if (p.kind === 'route') {      /* a torn strip of street map with the way marked */
      var grid = ''; for (var i = 0; i < 6; i++) grid += '<path d="M' + (i * 100 - 20) + ' 0 L' + (i * 100 + 40) + ' 330" stroke="#a9b7c2" stroke-width="' + (i % 2 ? 10 : 22) + '"/>';
      for (var j = 0; j < 4; j++) grid += '<path d="M0 ' + (40 + j * 90) + ' L540 ' + (20 + j * 90) + '" stroke="#a9b7c2" stroke-width="' + (j % 2 ? 14 : 8) + '"/>';
      g = '<rect width="540" height="600" fill="#f4f1e8"/><rect width="540" height="330" fill="#dfe6ea"/>' + grid +
        '<path d="M40 290 C140 260 150 150 250 150 S400 90 470 50" fill="none" stroke="#c22f1c" stroke-width="16" stroke-dasharray="34 22" stroke-linecap="round"/>' +
        '<path d="M470 50 l-62 6 l40 46 z" fill="#c22f1c"/><circle cx="40" cy="290" r="18" fill="#c22f1c"/>' +
        '<path d="M0 330 L30 318 L70 336 L110 320 L160 338 L210 322 L260 336 L320 318 L380 338 L430 320 L490 336 L540 322 V600 H0 Z" fill="#f4f1e8"/>' +
        head('ROUTE', '#c22f1c', 30, 392) + textBlock(fitAt(p.text, 480), 30, 404, 190, '#14110e');
    } else if (p.kind === 'question') {      /* a yellow card with a large question mark */
      g = '<rect width="540" height="600" fill="#f2d64b"/><text x="270" y="430" text-anchor="middle" font-family="' + FONT + '" font-weight="900" font-size="560" fill="#c22f1c" opacity="0.22">?</text>' +
        '<text x="470" y="120" text-anchor="middle" font-family="' + FONT + '" font-weight="900" font-size="150" fill="#c22f1c">?</text>' +
        head('ASK', '#7a1a10', 30, 82) + textBlock(fitAt(p.text, 480), 30, 150, 420, '#14110e');
    } else {      /* line: a ruled white index card */
      var rules = ''; for (var r = 0; r < 7; r++) rules += '<rect x="0" y="' + (190 + r * 58) + '" width="540" height="3" fill="#8fa3dd"/>';
      g = '<rect width="540" height="600" fill="#fbf8f1"/><rect x="0" y="118" width="540" height="6" fill="#c22f1c"/>' + rules +
        '<path d="M40 30 h40 l-12 60 h-40 z M100 30 h40 l-12 60 h-40 z" fill="#14110e"/>' + head('HEARD', '#c22f1c', 160, 84) + textBlock(fitAt(p.text, 480), 30, 140, 440, '#14110e');
    }
    return OPEN + '<title>' + esc(one(p.text).slice(0, TEXT_MAX)) + '</title><g id="' + esc(uid) + '">' + g + '</g></svg>';      /* the words whole in the title: the page's scan reads them unbroken */
  }
  /* fitText for a narrower card face (the tag): the same wrap, scaled to `w` px */
  function fitAt(text, w) { var f = fitText(text); f.size = Math.round(Math.min(92, f.size * w / AREA)); return f; }

  /* the name the players know: a known-as NPC (tag known-as, an alias) goes by the alias, as everywhere the table sees the cast */
  function known(npc) {
    var d = isObj(npc) ? npc : {}, tags = Array.isArray(d.tags) ? d.tags : [];
    var ka = tags.some(function (t) { return typeof t === 'string' && t.trim().toLowerCase() === 'known-as'; }) && one(d.alias);
    return ka ? one(d.alias) : one(d.name);
  }
  /* a face: the figure kit's portrait of the NPC (the spec with the known name, no notes), its ids its own; '' when it cannot be drawn */
  function faceSvg(npc, K, uid) {
    var d = isObj(npc) ? npc : {};
    if (!K || typeof K.portrait !== 'function' || !isObj(d.spec) || !Object.keys(d.spec).length) return '';
    try {
      var s = JSON.parse(JSON.stringify(d.spec)), name = known(d);
      delete s.notes; delete s.$comment; s.id = uid; s.name = name; if (s.plate) s.plate = name;
      var svg = str(K.portrait(s, { lod: 'lo' }).svg);
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
      return { room: pin.room, label: known(d).slice(0, 28), svg: faceSvg(d, c.K, uid) || plateSvg(known(d), uid) };
    }
    return { room: pin.room, label: WORD[pin.kind], svg: cardSvg(pin, uid) };
  }
  function sig(parts) { return JSON.stringify(parts); }
  /* the score scene's board drawn again with the pins: the PLAYER layer, the board theme, the view the score scene chose (kit 1 only on the plan, as there),
     at the bands and the rooms opened on their own. o = { seen, tokens (each already through the page's token screen), view, kit1, leaks(svg, roll, reveal) }.
     -> the svg, or null when there is nothing to pin or the leak scan finds a hidden name anywhere on it (the board then goes up without its pins) */
  function board(roll, render, o) {
    var x = isObj(o) ? o : {};
    if (!roll || typeof render !== 'function' || typeof x.leaks !== 'function' || !Array.isArray(x.tokens) || !x.tokens.length || !Array.isArray(x.seen)) return null;
    var view = x.view === 'rings' ? 'rings' : 'plan', opts = { view: view, theme: 'board', layer: 'player', reveal: x.seen, width: 1600, tokens: x.tokens };
    if (view === 'plan' && x.kit1) opts.kit1 = true;
    var r; try { r = render(roll, opts); } catch (e) { return null; }
    return r && typeof r.svg === 'string' && r.svg.length <= SVG_MAX && !x.leaks(r.svg, roll, x.seen).length ? r.svg : null;
  }

  /* ---------- the GM's block ---------- */
  var st = { last: null, busy: false, again: false, form: { kind: 'line' }, focus: '', caret: -1 };
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
    return { site: site, pins: pins, shown: shown, rooms: rooms, npcs: npcs, sig: sig([site, Object.keys(shown).sort(), pins, faces]) };
  }
  function tokensOf(s, host) {
    var K = typeof host.figures === 'function' ? host.figures() : null, out = [];
    s.pins.forEach(function (p) { var t = token(p, { npcs: s.npcs, K: K }); if (t) out.push({ pin: p, tok: t }); });
    return out;
  }
  /* set the score scene from the pins (and the bands and rooms ticked now); one at a time, the newest wins */
  function sync(host, ask) {
    if (st.busy) { st.again = true; return Promise.resolve(null); }
    var s = state(host); if (!s.site) return Promise.resolve(null);
    st.busy = true; st.last = s.sig;
    var list = tokensOf(s, host);
    return Promise.resolve(host.setScore(list, !!ask)).then(function (r) {
      st.busy = false;
      if (r && r.refused && r.refused.length) host.toast('Not on the board: ' + r.refused.map(function (x) { return x.label; }).join(', ') + ' would show the players a name they must not see (' + r.refused.map(function (x) { return x.names.join(', '); }).join('; ') + ').', true);
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
    var s = state(host);
    if (s.sig === st.last || !onBoard(host, s)) return;
    if (typeof host.busy === 'function' && host.busy()) { if (n < 20) setTimeout(function () { follow(host, n + 1); }, 400); return; }
    sync(host, false);
  }
  function paint(box, host) {
    var slot = box && box.querySelector ? box.querySelector('[data-pb-slot]') : null;
    var s = state(host);
    /* keep the score scene in step: a pin, a reveal or a face changed since this page last set it, while this site's board is the score scene */
    if (st.last === null) st.last = s.sig;
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
    f.appendChild(field('Room', room)); f.appendChild(field('Kind', kind)); f.appendChild(field(st.form.kind === 'face' ? 'Who' : 'Text', what));
    var pinB = btn(doc, 'Pin', { type: 'submit', 'class': 'btn sm primary', 'data-pb': 'pin' });
    if (!known_.length || !s.site) { pinB.disabled = true; pinB.title = s.site ? 'No room is known to the players yet: reveal a band or open a room' : 'Roll a location first'; }
    f.appendChild(pinB);
    root.appendChild(f);
    kind.addEventListener('change', function () { st.form.kind = kind.value; st.form.room = room.value; paint(box, host); });
    room.addEventListener('change', function () { st.form.room = room.value; });
    if (what.tagName === 'INPUT') what.addEventListener('input', function () { st.form.text = what.value; });
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
  function reset() { st.last = null; st.busy = false; st.again = false; st.form = { kind: 'line' }; st.focus = ''; st.caret = -1; }

  return { KEY: KEY, KINDS: KINDS, MAX: MAX, FACES_MAX: FACES_MAX, TEXT_MAX: TEXT_MAX, SITES_MAX: SITES_MAX, WORD: WORD,
    clean: clean, sitesOf: sitesOf, pinsOf: pinsOf, patchFor: patchFor, wrap: wrap, fitText: fitText, cardSvg: cardSvg, faceSvg: faceSvg, known: known,
    token: token, sig: sig, board: board, paint: paint, add: add, remove: remove, sync: sync, reset: reset, _state: state };
});
