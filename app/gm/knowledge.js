/* gm/knowledge.js — the three knowledge states of a room (suite ticket 2.2, switch map.knowledge).

   Plain script, UMD: window.B68GmKnowledge in the browser, module.exports under Node. GM side only. The controller reaches the page only through
   the host it is given, so a node test can drive it with a fake.

   THE STATES. Every room of the run's site is dark, blueprint or seen.
     dark       the players know nothing of it: not its name, not its shape. Nothing of it is in the player copy (the kit seals it away).
     blueprint  known from intel: the player copy shows its outline and its name as blue linework, no furniture and no icons.
     seen       opened for the players: drawn in full, as the map kit has always drawn a room the crew has been in.
   WHERE THEY LIVE. Seen is the run's ball.open (as before, #135). Blueprint is a new list on the same ball, ball.know. The two lists never share
   a room: seen beats blueprint. A room whose band is ticked is seen, and cannot be cycled until the band is closed. With the switch off this file
   writes nothing and the page never reads ball.know.
   WHAT REACHES THE PLAYERS. The page folds ball.know into the player copy's reveal as "room:<name>" entries beside ball.open, so every check the page
   already runs on the player copy (the hidden-name scan, the token screen, the live follow's ask) treats a blueprint room as a room the crew knows,
   and a dark room as one they do not. Phones and the players' mission card read ball.open only: a blueprint room is never "open".
   THE TAP. A tap on a room of the GM map (or on its row here) cycles dark -> blueprint -> seen -> dark. "Intel" sets every dark room of a group
   (a band, or a floor) to blueprint and never lowers a room that is already known.

   API
     STATES, SWITCH
     cleanNames(list, rooms) -> names that are rooms of the roll, once each (at most 80), in the order given
     stateOf(room, ctx) -> 'dark' | 'blueprint' | 'seen'      room { name, band }; ctx { open: [name], know: [name], bands: [band] }
     locked(room, ctx) -> true when the room's band is ticked (it is seen, and a tap cannot change it)
     next(state) -> the state a tap gives
     setState(name, state, ctx) -> { open, know }             new lists, disjoint, order kept; the lists are the only thing a state is
     intel(rooms, names, ctx) -> { open, know }               every dark room of `names` becomes blueprint
     groups(rooms, floors) -> [{ id, label, names }]          the bands that hold a room (not public), then the floors
     signature(names) -> string                               what the live follow compares: the blueprint set, order-free
     panelHtml(view, esc) -> HTML
     toggleHtml(name, esc) -> the Run view's one button on a room card: its state, and what a tap makes it; '' when the room is seen through a band
     create(host) -> controller { active(), view(), cycle(name), intel(groupId), tapRoom(roll, dataRoom), bind(box) -> unbind, paint(box),
                                  toggleHtml(name), paintRun(frame, svg, zoom) }
       host: { feature(id) -> bool, rooms() -> [{ name, band }], ctx() -> { open, know, bands }, floors() -> [{ name, names }], write(open, know) -> bool,
               toast(msg, bad), changed(), roomBox(svg, name) -> { x, y, w, h } | null (the Run map's rooms, in the svg's own units) }
   THE RUN VIEW. The Run map gets a bar under it with the Intel buttons, and a tap on a room of it cycles that room (the room whose box holds the tap, the smallest
   first); each room card's Reveal button becomes its state button. All of it only while the switch is on. */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmKnowledge = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SWITCH = 'map.knowledge', STATES = ['dark', 'blueprint', 'seen'], MAX = 80;
  var LABEL = { dark: 'Dark', blueprint: 'Blueprint', seen: 'Seen' };
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc0(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function names(v) {
    var out = [];
    (Array.isArray(v) ? v : []).forEach(function (n) { if (typeof n === 'string' && n && out.indexOf(n) < 0 && out.length < MAX) out.push(n); });
    return out;
  }

  function cleanNames(list, rooms) {
    var have = {};
    (Array.isArray(rooms) ? rooms : []).forEach(function (r) { var n = isObj(r) ? str(r.name) : str(r); if (n) have[n] = 1; });
    return names(list).filter(function (n) { return have[n] === 1; });
  }
  function ctxOf(ctx) {
    var c = isObj(ctx) ? ctx : {};
    return { open: names(c.open), know: names(c.know), bands: (Array.isArray(c.bands) ? c.bands : []).map(str) };
  }
  function locked(room, ctx) { var c = ctxOf(ctx); return isObj(room) && c.bands.indexOf(str(room.band)) >= 0; }
  function stateOf(room, ctx) {
    var c = ctxOf(ctx), n = isObj(room) ? str(room.name) : '';
    if (!isObj(room)) return 'dark';
    if (c.bands.indexOf(str(room.band)) >= 0 || c.open.indexOf(n) >= 0) return 'seen';
    return c.know.indexOf(n) >= 0 ? 'blueprint' : 'dark';
  }
  function next(state) { return state === 'dark' ? 'blueprint' : state === 'blueprint' ? 'seen' : 'dark'; }

  /* a room to a state: seen goes in open, blueprint in know, dark in neither; the other list never keeps it */
  function setState(name, state, ctx) {
    var c = ctxOf(ctx), n = str(name);
    var open = c.open.filter(function (x) { return x !== n; }), know = c.know.filter(function (x) { return x !== n; });
    if (STATES.indexOf(state) < 0) return { open: c.open, know: c.know };
    if (state === 'seen') open.push(n); else if (state === 'blueprint') know.push(n);
    return { open: open.slice(0, MAX), know: know.slice(0, MAX) };
  }
  function intel(rooms, list, ctx) {
    var c = ctxOf(ctx), know = c.know.slice(), want = names(list), byName = {};
    (Array.isArray(rooms) ? rooms : []).forEach(function (r) { if (isObj(r) && str(r.name)) byName[str(r.name)] = r; });
    want.forEach(function (n) { if (byName[n] && stateOf(byName[n], c) === 'dark' && know.indexOf(n) < 0) know.push(n); });
    return { open: c.open, know: know.slice(0, MAX) };
  }
  function groups(rooms, floors) {
    var out = [], list = (Array.isArray(rooms) ? rooms : []).filter(function (r) { return isObj(r) && str(r.name); });
    ['working', 'controlled', 'secure'].forEach(function (b) {
      var ns = []; list.forEach(function (r) { if (str(r.band) === b && ns.indexOf(str(r.name)) < 0) ns.push(str(r.name)); });
      if (ns.length) out.push({ id: 'band:' + b, label: 'The ' + b + ' band', names: ns });
    });
    (Array.isArray(floors) ? floors : []).forEach(function (f, i) {
      var ns = cleanNames(isObj(f) ? f.names : [], list);
      if (ns.length) out.push({ id: 'floor:' + i, label: str(f.name) || 'Floor ' + (i + 1), names: ns });
    });
    return out;
  }
  function signature(list) { return names(list).slice().sort().join('\n'); }

  function panelHtml(v, esc) {
    esc = esc || esc0;
    var rooms = Array.isArray(v && v.rooms) ? v.rooms : [], gs = Array.isArray(v && v.groups) ? v.groups : [];
    var h = '<details class="gm-more gm-know" open><summary>What the players know <span class="gm-dim">' + v.counts.blueprint + ' blueprint, ' + v.counts.seen + ' seen, ' + v.counts.dark + ' dark</span></summary>';
    h += '<ul class="gm-roomlist gm-know-list">' + rooms.map(function (r) {
      return '<li class="gm-roomrow gm-know-' + esc(r.state) + '"><span class="gm-roomname">' + esc(r.name) + '</span> <small class="gm-dim">' + esc(r.band) + '</small> ' +
        (r.locked
          ? '<span class="gm-dim">Seen (its band is open)</span>'
          : '<button type="button" class="btn sm" data-kn="cycle" data-room="' + esc(r.name) + '" aria-label="' + esc(r.name) + ': ' + esc(LABEL[r.state]) + '. Tap for ' + esc(LABEL[next(r.state)]) + '" title="Tap for ' + esc(LABEL[next(r.state)]) + '">' + esc(LABEL[r.state]) + '</button>') + '</li>';
    }).join('') + '</ul>';
    if (gs.length) h += '<p class="gm-know-intel"><span class="gm-lab">Intel</span> ' + gs.map(function (g) {
      return '<button type="button" class="btn sm" data-kn="intel" data-group="' + esc(g.id) + '" title="Set every dark room of this group to blueprint">' + esc(g.label) + '</button>';
    }).join(' ') + '</p>';
    h += '<p class="gm-dim">Dark: nothing of the room reaches the iPad. Blueprint: its outline and name, as linework. Seen: drawn in full. ' +
      'Goes out with the map (at once while it is live on the iPad), and only while Layer is Player.</p></details>';
    return h;
  }

  function create(host) {
    host = host || {};
    function on() { return typeof host.feature === 'function' && host.feature(SWITCH) === true; }
    function rooms() { var r = typeof host.rooms === 'function' ? host.rooms() : []; return Array.isArray(r) ? r.filter(function (x) { return isObj(x) && str(x.name); }) : []; }
    function ctx() { return ctxOf(typeof host.ctx === 'function' ? host.ctx() : null); }
    function say(m, bad) { if (typeof host.toast === 'function') host.toast(m, bad); }
    function done() { if (typeof host.changed === 'function') host.changed(); }
    function write(l) { return typeof host.write === 'function' ? host.write(l.open, l.know) !== false : false; }
    function active() { return on() && rooms().length > 0; }
    function view() {
      var c = ctx(), seen = {}, rs = rooms().filter(function (r) { var k = str(r.name); if (seen[k]) return false; seen[k] = 1; return true; });
      var list = rs.map(function (r) { return { name: str(r.name), band: str(r.band), state: stateOf(r, c), locked: locked(r, c) }; });
      var counts = { dark: 0, blueprint: 0, seen: 0 };
      list.forEach(function (r) { counts[r.state]++; });
      var floors = typeof host.floors === 'function' ? host.floors() : [];
      return { rooms: list, counts: counts, groups: groups(rs, floors) };
    }
    function cycle(name) {
      if (!on()) return false;
      var n = str(name), r = rooms().filter(function (x) { return str(x.name) === n; })[0], c = ctx();
      if (!r) return false;
      if (locked(r, c)) { say(n + ' is seen because its band is open. Close the band to change it.', true); return false; }
      var to = next(stateOf(r, c));
      if (!write(setState(n, to, c))) return false;
      say(n + ': ' + LABEL[to].toLowerCase() + '.'); done(); return true;
    }
    function intelGroup(id) {
      if (!on()) return false;
      var g = view().groups.filter(function (x) { return x.id === id; })[0]; if (!g) return false;
      var c = ctx(), l = intel(rooms(), g.names, c);
      if (signature(l.know) === signature(c.know)) { say('Nothing dark in ' + g.label.toLowerCase() + '.'); return false; }
      if (!write(l)) return false;
      say('Intel: ' + g.label.toLowerCase() + ' is known as blueprint.'); done(); return true;
    }
    /* a tap on the GM map: data-room="r<index>", the room's index in the roll. false when it names no room (the page's other taps go on) */
    function tapRoom(roll, dataRoom) {
      if (!active() || !isObj(roll) || !Array.isArray(roll.rooms)) return false;
      var m = /^r(\d+)$/.exec(str(dataRoom)), r = m ? roll.rooms[+m[1]] : null;
      if (!isObj(r) || !str(r.name)) return false;
      cycle(str(r.name)); return true;
    }
    function paint(box) { if (box) box.innerHTML = panelHtml(view(), host.esc || esc0); }
    function toggleHtml(name) {
      if (!active()) return '';
      var n = str(name), r = rooms().filter(function (x) { return str(x.name) === n; })[0], c = ctx(); if (!r || locked(r, c)) return '';
      var st = stateOf(r, c), e = host.esc || esc0;
      return '<p class="rv-open ' + (st === 'dark' ? 'no' : 'yes') + ' rv-know"><button type="button" class="rv-btn sm rv-tog" data-rv="know" data-room="' + e(n) + '" aria-label="' + e(n + ': ' + LABEL[st] + '. Tap for ' + LABEL[next(st)]) + '">' +
        e(LABEL[st]) + ' <small>tap for ' + e(LABEL[next(st)].toLowerCase()) + '</small></button></p>';
    }
    /* the room under a tap on the Run map: of the rooms whose box holds the point, the smallest */
    function roomAt(svg, ev) {
      if (!svg || typeof svg.getScreenCTM !== 'function' || typeof svg.createSVGPoint !== 'function' || typeof host.roomBox !== 'function') return '';
      var ctm = svg.getScreenCTM(); if (!ctm) return '';
      var pt = svg.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY; pt = pt.matrixTransform(ctm.inverse());
      var best = '', area = Infinity;
      rooms().forEach(function (r) {
        var b = host.roomBox(svg, str(r.name)); if (!isObj(b) || !(b.w > 0) || !(b.h > 0)) return;
        if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h && b.w * b.h < area) { area = b.w * b.h; best = str(r.name); }
      });
      return best;
    }
    function paintRun(fr, svg) {
      if (!fr || !active() || !fr.parentNode) return;
      var doc = fr.ownerDocument, bar = fr.nextSibling && fr.nextSibling.getAttribute && fr.nextSibling.getAttribute('data-b24') ? fr.nextSibling : null;
      if (!bar) { bar = doc.createElement('div'); bar.className = 'rv-know-bar'; bar.setAttribute('data-b24', 'bar'); fr.parentNode.insertBefore(bar, fr.nextSibling); }
      var gs = view().groups, e = host.esc || esc0;
      bar.innerHTML = '<span class="rv-lab">Intel</span> ' + (gs.length ? gs.map(function (g) { return '<button type="button" class="rv-btn sm" data-kn="intel" data-group="' + e(g.id) + '">' + e(g.label) + '</button>'; }).join(' ') : '<span class="rv-dim">no group to set</span>') +
        ' <small class="rv-dim">Tap a room on the map to cycle it: dark, blueprint, seen.</small>';
      bar.onclick = function (ev) { var b = ev.target && ev.target.closest ? ev.target.closest('[data-kn="intel"]') : null; if (b) intelGroup(b.getAttribute('data-group')); };
      fr.addEventListener('click', function (ev) { var n = roomAt(svg, ev); if (n) cycle(n); });
    }
    function bind(box) {
      function onClick(ev) {
        var b = ev.target && ev.target.closest ? ev.target.closest('[data-kn]') : null; if (!b || !box.contains(b)) return;
        var a = b.getAttribute('data-kn');
        if (a === 'cycle') cycle(b.getAttribute('data-room')); else if (a === 'intel') intelGroup(b.getAttribute('data-group'));
      }
      box.addEventListener('click', onClick);
      return function () { box.removeEventListener('click', onClick); };
    }
    return { active: active, view: view, cycle: cycle, intel: intelGroup, tapRoom: tapRoom, paint: paint, bind: bind, toggleHtml: toggleHtml, paintRun: paintRun };
  }

  return { SWITCH: SWITCH, STATES: STATES, cleanNames: cleanNames, stateOf: stateOf, locked: locked, next: next, setState: setState, intel: intel, groups: groups,
    signature: signature, panelHtml: panelHtml, create: create };
});
