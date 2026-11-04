/* gm/corkboard.js — the intel corkboard (suite ticket 2.7, switch map.corkboard).

   Window.B68GmCorkboard, and module.exports under Node. GM side only: it builds a Planning-phase view of the site in the map kit's heist-board look
   and a print view of it. It changes no state, calls no server and no model, and nothing here reaches the iPad or a phone.

   What goes on the board
     intel      every intel fact the crew has been TOLD (play.intel, with ball.told) becomes a Polaroid pinned to its room. A fact's room is its own `room`, else
                the room of the first way or event it reveals. A fact with no room pinned anywhere is listed under the board instead.
     mugshots   every REVEALED NPC with a post gets a mugshot on that post: the NPC's `post` room, else the first room stop of the play person who is that NPC
                (person.npc is the NPC's id, or the person's label is the NPC's name or alias). The portrait is the host's figure render, else a plain plate with initials.
     Hidden NPCs, rooms nobody has revealed and intel nobody has been told never appear: the board is drawn on the PLAYER layer through the host's one door
     (host.board), which screens the markers and refuses anything that would name a hidden room.

   Pure: intelOf(play, told, rooms) · postsOf(npcs, play, rooms) · polaroidSvg(text) · mugshotSvg(name, svg) · tokensOf(model, portrait) · hideOf(npcs)
         corkboardHtml(d, size)
   make(host) -> ctl, host = { on(id), roll() -> the location roll | null, play() -> the site's play block | null, told() -> { <intel id>: 'crew' | [pc ids] },
         npcs() -> { id: npcDoc }, portrait(id) -> svg string | '', board(tokens, hide) -> { title, caption, svg, tokens, tokensRefused } (throws when nothing safe can be drawn),
         phase() -> 'pb' | 'plan' | 'score' | 'after' | '', print(html), root(), toast? }
   ctl.build() -> { board, model } | null    ctl.print(size 'A3' | 'A4')    ctl.open() ctl.toggle() ctl.render(box) */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68GmCorkboard = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var SWITCH = 'map.corkboard';
  var INTEL_MAX = 24, MUG_MAX = 16, TEXT_MAX = 180;

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fold(s) { return str(s).toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim(); }
  function clip(s, n) { s = str(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '').trim() + '…' : s; }
  function byId(list, id) { var l = Array.isArray(list) ? list : []; for (var i = 0; i < l.length; i++) if (isObj(l[i]) && l[i].id === id) return l[i]; return null; }
  function roomSet(rooms) { var s = Object.create(null); (Array.isArray(rooms) ? rooms : []).forEach(function (n) { if (typeof n === 'string' && n) s[n] = 1; }); return s; }
  /* told: 'crew' or a list of PC ids with at least one name: anyone has been told */
  function toldAny(v) { return v === 'crew' || (Array.isArray(v) && v.some(function (x) { return typeof x === 'string' && x; })); }

  /* the told intel facts, each with the room it is pinned to (or null), in play order */
  function intelOf(play, told, rooms) {
    var p = isObj(play) ? play : {}, t = isObj(told) ? told : {}, have = roomSet(rooms), out = [];
    (Array.isArray(p.intel) ? p.intel : []).forEach(function (x) {
      if (out.length >= INTEL_MAX || !isObj(x) || typeof x.id !== 'string' || !x.id || typeof x.text !== 'string' || !x.text.trim()) return;
      if (!has(t, x.id) || !toldAny(t[x.id])) return;
      var room = typeof x.room === 'string' && have[x.room] ? x.room : null, rv = isObj(x.reveals) ? x.reveals : {};
      (Array.isArray(rv.ways) ? rv.ways : []).forEach(function (id) { if (!room) { var w = byId(p.ways, id); if (w && typeof w.room === 'string' && have[w.room]) room = w.room; } });
      (Array.isArray(rv.events) ? rv.events : []).forEach(function (id) { if (!room) { var e = byId(p.events, id); if (e && typeof e.room === 'string' && have[e.room]) room = e.room; } });
      out.push({ id: x.id, text: clip(x.text, TEXT_MAX), room: room });
    });
    return out;
  }

  /* the revealed NPCs with a post: [{ id, name, room }] in name order. Hidden NPCs are never read past their `revealed` flag. */
  function postsOf(npcs, play, rooms) {
    var have = roomSet(rooms), people = isObj(play) && Array.isArray(play.people) ? play.people : [], out = [];
    Object.keys(isObj(npcs) ? npcs : {}).forEach(function (id) {
      var d = npcs[id];
      if (!isObj(d) || d.revealed !== true || !str(d.name).trim()) return;
      var room = typeof d.post === 'string' && have[d.post] ? d.post : null;
      if (!room) {
        var nm = fold(d.name), al = fold(d.alias);
        people.forEach(function (pe) {
          if (room || !isObj(pe)) return;
          if (pe.npc !== id && !(pe.npc === undefined && (fold(pe.label) === nm || (al && fold(pe.label) === al)))) return;
          (Array.isArray(pe.stops) ? pe.stops : []).forEach(function (s) { if (!room && isObj(s) && typeof s.room === 'string' && have[s.room]) room = s.room; });
        });
      }
      if (room) out.push({ id: id, name: str(d.name).trim().slice(0, 80), room: room });
    });
    out.sort(function (a, b) { var x = a.name.toLowerCase(), y = b.name.toLowerCase(); return x < y ? -1 : x > y ? 1 : 0; });
    return out.slice(0, MUG_MAX);
  }

  /* the names that must never be on the board: every NPC who is not revealed (name and alias) */
  function hideOf(npcs) {
    var out = [];
    Object.keys(isObj(npcs) ? npcs : {}).forEach(function (id) {
      var d = npcs[id]; if (!isObj(d) || d.revealed === true) return;
      [d.name, d.alias].forEach(function (n) { n = str(n).trim(); if (n.length >= 3 && out.indexOf(n) < 0) out.push(n); });
    });
    return out;
  }

  /* word wrap to lines of at most `w` characters; a word longer than the line is cut */
  function wrap(text, w, maxLines) {
    var words = str(text).split(/\s+/).filter(Boolean), lines = [], cur = '';
    words.forEach(function (x) {
      while (x.length > w) { if (cur) { lines.push(cur); cur = ''; } lines.push(x.slice(0, w)); x = x.slice(w); }
      if (!cur) cur = x; else if ((cur + ' ' + x).length <= w) cur += ' ' + x; else { lines.push(cur); cur = x; }
    });
    if (cur) lines.push(cur);
    if (lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = lines[maxLines - 1].replace(/\s*\S{0,2}$/, '') + '…'; }
    return lines;
  }

  /* an intel Polaroid: the face of a Polaroid in the kit's 540 x 600 token frame, a strip of tape and the fact in typewriter lines */
  function polaroidSvg(text) {
    var lines = wrap(text, 22, 9), s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 600"><rect width="540" height="600" fill="#f8f3e6"/>' +
      '<rect x="190" y="14" width="160" height="46" fill="#e8d9a0" opacity="0.85" transform="rotate(-2 270 37)"/>' +
      '<text x="40" y="110" font-family="Courier New, monospace" font-size="38" font-weight="700" fill="#a51d16" letter-spacing="6">INTEL</text><rect x="40" y="128" width="460" height="4" fill="#a51d16"/>';
    lines.forEach(function (l, i) { s += '<text x="40" y="' + (190 + i * 46) + '" font-family="Courier New, monospace" font-size="40" fill="#2a2521">' + esc(l) + '</text>'; });
    return s + '</svg>';
  }
  function initials(name) { return str(name).split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) { return w.charAt(0).toUpperCase(); }).join(''); }
  /* a mugshot: the host's portrait when it has one, else a silhouette plate with the initials; both on the kit's 540 x 600 frame */
  function mugshotSvg(name, portrait) {
    var p = str(portrait);
    if (/^<svg[\s>]/.test(p)) return p;
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 600"><rect width="540" height="600" fill="#cfc7b2"/><circle cx="270" cy="230" r="110" fill="#3b3326"/>' +
      '<path d="M60 600 C60 420 150 350 270 350 C390 350 480 420 480 600 Z" fill="#3b3326"/><text x="270" y="560" text-anchor="middle" font-family="Courier New, monospace" font-size="84" font-weight="700" fill="#f8f3e6">' + esc(initials(name)) + '</text></svg>';
  }

  /* the kit's markers for the board: exactly { room, label, svg } each (the shape the page's token screen accepts) */
  function tokensOf(model, portrait) {
    var m = isObj(model) ? model : {}, out = [];
    (Array.isArray(m.posts) ? m.posts : []).forEach(function (p) {
      out.push({ room: p.room, label: clip(p.name, 28), svg: mugshotSvg(p.name, typeof portrait === 'function' ? portrait(p.id) : '') });
    });
    (Array.isArray(m.intel) ? m.intel : []).forEach(function (x) { if (x.room) out.push({ room: x.room, label: 'Intel', svg: polaroidSvg(x.text) }); });
    return out;
  }

  /* ---- the print view: an A3 or A4 landscape page, the board, a title strip, and the facts that have no room under it (the same frame as gm/print.js) ---- */
  var CSS_BASE = '*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff}body{font-family:Georgia,"Times New Roman",serif;color:#1c1a17;-webkit-print-color-adjust:exact;print-color-adjust:exact}';
  var SIZES = { A3: { page: 'A3 landscape', w: 420, h: 297 }, A4: { page: 'A4 landscape', w: 297, h: 210 } };
  function corkboardHtml(d, size) {
    var key = SIZES[size] ? size : 'A4', s = SIZES[key], x = isObj(d) ? d : {}, loose = Array.isArray(x.loose) ? x.loose : [];
    var css = '@page{size:' + s.page + ';margin:0}' + CSS_BASE +
      '.cb{width:' + s.w + 'mm;height:' + s.h + 'mm;padding:8mm;display:grid;grid-template-rows:1fr auto' + (loose.length ? ' auto' : '') + ';gap:4mm;overflow:hidden}' +
      '.plan{border:.4mm solid #1c1a17;display:flex;align-items:center;justify-content:center;overflow:hidden;min-height:0;min-width:0}.plan svg{max-width:100%;max-height:100%;width:auto;height:auto}' +
      '.also{border:.4mm solid #1c1a17;padding:1.5mm 2.5mm;font-size:8pt}.also b{font-size:6.5pt;letter-spacing:.14em;text-transform:uppercase;color:#6b604a;font-weight:400;margin-right:2mm}' +
      '.tb{border:.4mm solid #1c1a17;display:grid;grid-template-columns:2fr 3fr 1fr 1fr;font-size:9pt}.tb div{padding:1.5mm 2.5mm;border-right:.3mm solid #1c1a17}.tb div:last-child{border-right:0}' +
      '.tb b{display:block;font-size:6.5pt;letter-spacing:.14em;text-transform:uppercase;color:#6b604a;font-weight:400}';
    var body = '<div class="cb"><div class="plan">' + str(x.svg) + '</div>' +
      (loose.length ? '<div class="also"><b>Also known</b>' + loose.map(function (l) { return esc(l); }).join(' · ') + '</div>' : '') +
      '<div class="tb"><div><b>Place</b>' + esc(x.title) + '</div><div><b>Known to the crew</b>' + esc(x.caption) + '</div><div><b>Sheet</b>Planning corkboard</div><div><b>Size</b>' + key + '</div></div></div>';
    return '<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><title>' + esc('Corkboard: ' + str(x.title)) + '</title><style>' + css + '</style></head><body>' + body + '</body></html>';
  }

  /* the browser's print dialog, from a hidden frame (as gm/print.js does) */
  function printFrame(html) {
    var d = W && W.document; if (!d || !d.body) return false;
    var f = d.createElement('iframe'); f.setAttribute('aria-hidden', 'true'); f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    d.body.appendChild(f);
    var fd = f.contentDocument || (f.contentWindow && f.contentWindow.document); if (!fd) { d.body.removeChild(f); return false; }
    fd.open(); fd.write(html); fd.close();
    setTimeout(function () {
      try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { /* the dialog is the browser's */ }
      setTimeout(function () { if (f.parentNode) f.parentNode.removeChild(f); }, 60000);
    }, 250);
    return true;
  }

  function make(host) {
    var h = host || {};
    function say(m, bad) { if (typeof h.toast === 'function') h.toast(m, bad === true); }
    function call(name, dflt) { try { return typeof h[name] === 'function' ? h[name]() : dflt; } catch (e) { return dflt; } }
    function isOn() { return typeof h.on === 'function' ? !!h.on(SWITCH) : true; }
    var ctl = {};
    /* { board: { title, caption, svg, tokens, tokensRefused }, model: { intel, loose, posts } }, or null with a toast when there is nothing to draw */
    ctl.build = function () {
      var roll = call('roll', null);
      if (!roll || !Array.isArray(roll.rooms)) { say('Roll or pick a location first.', true); return null; }
      var names = roll.rooms.filter(isObj).map(function (r) { return r.name; }), play = call('play', null), npcs = call('npcs', {});
      var intel = intelOf(play, call('told', {}), names), model = { intel: intel, loose: intel.filter(function (x) { return !x.room; }).map(function (x) { return x.text; }), posts: postsOf(npcs, play, names) };
      var tokens = tokensOf(model, function (id) { return typeof h.portrait === 'function' ? h.portrait(id) : ''; }), board;
      try { board = h.board(tokens, hideOf(npcs)); } catch (e) { say(e && e.message ? e.message : 'The board could not be drawn.', true); return null; }
      if (!board || !board.svg) { say('The board could not be drawn.', true); return null; }
      return { board: board, model: model };
    };
    ctl.print = function (size) {
      var b = ctl.build(); if (!b) return false;
      var html = corkboardHtml({ title: b.board.title, caption: b.board.caption, svg: b.board.svg, loose: b.model.loose }, size === 'A3' ? 'A3' : 'A4');
      return typeof h.print === 'function' ? h.print(html) : printFrame(html);
    };
    function Sheet() { return W && W.B68GmWorkshop ? W.B68GmWorkshop : null; }
    function sheet() { var S = Sheet(), r = typeof h.root === 'function' ? h.root() : null; return S && r ? S.sheet(r, 'corkboard', 'Corkboard') : null; }
    ctl.render = function (box) {
      if (!box) return;
      if (!isOn()) { box.innerHTML = '<p class="gm-empty">The corkboard switch is off.</p>'; return; }
      var ph = call('phase', ''), b = ctl.build();
      if (!b) { box.innerHTML = '<p class="gm-empty">Roll or pick a location first.</p>'; return; }
      var m = b.model;
      box.innerHTML = (ph === 'plan' ? '' : '<p class="gm-dim">This is the Planning phase’s board; the night is not in Planning right now.</p>') +
        '<div class="gm-sb-row"><button type="button" class="btn sm primary" data-cb="A4">Print A4</button> <button type="button" class="btn sm" data-cb="A3">Print A3</button></div>' +
        '<div class="gm-cb-board">' + b.board.svg + '</div>' +
        '<p class="gm-dim">' + m.intel.length + ' intel fact' + (m.intel.length === 1 ? '' : 's') + ' told, ' + m.posts.length + ' mugshot' + (m.posts.length === 1 ? '' : 's') + '.' +
        (b.board.tokensRefused ? ' The pins were left off: one would have named a hidden room or person.' : '') + '</p>' +
        (m.loose.length ? '<h3>Also known (no room)</h3><ul>' + m.loose.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>' : '');
      var sh = box.parentNode;
      if (sh && !sh.__cb) {
        sh.__cb = true;
        sh.addEventListener('click', function (ev) {
          var t = ev.target && ev.target.closest ? ev.target.closest('[data-cb]') : null; if (t) ctl.print(t.getAttribute('data-cb'));
        });
      }
    };
    ctl.open = function () { var b = sheet(); if (!b) return false; ctl.render(b.body); b.open(); return true; };
    ctl.toggle = function () { var b = sheet(); if (b && b.isOpen()) { b.close(); return false; } return ctl.open(); };
    return ctl;
  }

  return { SWITCH: SWITCH, make: make, intelOf: intelOf, postsOf: postsOf, hideOf: hideOf, polaroidSvg: polaroidSvg, mugshotSvg: mugshotSvg, tokensOf: tokensOf, corkboardHtml: corkboardHtml };
});
