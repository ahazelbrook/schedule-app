/* gm/knowledge.js — the three knowledge states of a room (suite ticket 2.2; the GM night rebuild, N3: the site's Players' map).

   Plain script, UMD: window.B68GmKnowledge in the browser, module.exports under Node. GM side only. The controller reaches the page only through
   the host it is given, so a node test can drive it with a fake.

   THE STATES. Every room of the run's site is dark, blueprint or seen.
     dark       the players know nothing of it: not its name, not its shape. Nothing of it is in the player copy (the kit seals it away).
     blueprint  known from intel: the player copy shows its outline and its name as blue linework, no furniture and no icons.
     seen       opened for the players: drawn in full, as the map kit has always drawn a room the crew has been in.
   WHERE THEY LIVE. Seen is the run's ball.open (as before, #135). Blueprint is a new list on the same ball, ball.know. The two lists never share
   a room: seen beats blueprint. A room whose band is ticked is seen, and cannot be changed until the band is closed.
   WHAT REACHES THE PLAYERS. The page folds ball.know into the player copy's reveal as "room:<name>" entries beside ball.open, so every check the page
   already runs on the player copy (the hidden-name scan, the token screen, the live follow's ask) treats a blueprint room as a room the crew knows,
   and a dark room as one they do not. Phones and the players' mission card read ball.open only: a blueprint room is never "open".
   ON THE SITE (N3). A room's card has ONE control for it, the Players' map: Dark | Blueprint | Seen (segHtml). Dark and Blueprint apply at once (set);
   Seen stages the room, and Send opens it (gm/stage.js: the page does that part). "Intel" (the site's ⋯) sets every dark room of a group (a band, or a
   floor) to blueprint and never lowers a room that is already known. A tap on a room of Location's GM map still cycles it (tapRoom).

   API
     STATES, SWITCH, LABEL
     cleanNames(list, rooms) -> names that are rooms of the roll, once each (at most 80), in the order given
     stateOf(room, ctx) -> 'dark' | 'blueprint' | 'seen'      room { name, band }; ctx { open: [name], know: [name], bands: [band] }
     locked(room, ctx) -> true when the room's band is ticked (it is seen, and nothing here can change it)
     next(state) -> the state a tap on Location's map gives
     setState(name, state, ctx) -> { open, know }             new lists, disjoint, order kept; the lists are the only thing a state is
     intel(rooms, names, ctx) -> { open, know }               every dark room of `names` becomes blueprint
     groups(rooms, floors) -> [{ id, label, names }]          the bands that hold a room (not public), then the floors
     signature(names) -> string                               what the live follow compares: the blueprint set, order-free
     segHtml(info, esc) -> the Players' map control           info { name, state, locked, staged }; buttons data-site="kn" data-room data-k
     create(host) -> controller { active(), view(), states(), stateOf(name), locked(name), set(name, state), cycle(name), intel(groupId), tapRoom(roll, dataRoom),
                                  roomAt(svg, event) -> name | '', seg(name, staged) -> HTML }
       host: { feature(id) -> bool, rooms() -> [{ name, band }], ctx() -> { open, know, bands }, floors() -> [{ name, names }], write(open, know) -> bool,
               toast(msg, bad), changed(), roomBox(svg, name) -> { x, y, w, h } | null (the Run map's rooms, in the svg's own units), esc } */
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

  /* the Players' map control on a room's card: three states, one pressed; Seen while staged says so (Send opens it) */
  function segHtml(info, esc) {
    esc = esc || esc0; info = isObj(info) ? info : {};
    var n = str(info.name), st = STATES.indexOf(info.state) >= 0 ? info.state : 'dark', lock = !!info.locked, staged = !!info.staged && st !== 'seen';
    var h = '<div class="rv-kseg" role="group" aria-label="' + esc('Players’ map: ' + n) + '"><span class="rv-klab">Players’ map</span><span class="seg">';
    STATES.forEach(function (k) {
      var pressed = k === st || (k === 'seen' && staged), lab = k === 'seen' && staged ? 'Seen · staged' : LABEL[k];
      var tip = lock ? 'Seen: its band is open. Close the band on Location to change it.'
        : k === 'dark' ? 'The players’ map shows nothing of it' : k === 'blueprint' ? 'Its outline and name, as linework, at once'
        : staged ? 'Staged on this screen: Send opens it for the players. Tap again to unstage' : st === 'seen' ? 'Open for the players' : 'Stage it: Send opens it for the players';
      h += '<button type="button" class="chip sm rv-k' + k + (k === 'seen' && staged ? ' staged' : '') + '" data-site="kn" data-room="' + esc(n) + '" data-k="' + k + '" aria-pressed="' + pressed + '"' + (lock ? ' disabled' : '') + ' title="' + esc(tip) + '">' + esc(lab) + '</button>';
    });
    h += '</span></div>';
    if (lock) h += '<p class="rv-khint rv-dim">Seen through its band (open on Location).</p>';
    else if (staged) h += '<p class="rv-khint staged">Staged on this screen only. <b>Send</b> opens it for the players.</p>';
    return h;
  }

  function create(host) {
    host = host || {};
    function on() { return typeof host.feature === 'function' && host.feature(SWITCH) === true; }
    function rooms() { var r = typeof host.rooms === 'function' ? host.rooms() : []; return Array.isArray(r) ? r.filter(function (x) { return isObj(x) && str(x.name); }) : []; }
    function room(name) { var n = str(name); return rooms().filter(function (x) { return str(x.name) === n; })[0] || null; }
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
    /* every room's state, by name ({} while the switch is off) */
    function states() { var out = {}; if (!active()) return out; var c = ctx(); rooms().forEach(function (r) { out[str(r.name)] = stateOf(r, c); }); return out; }
    function stateOfName(name) { var r = room(name); return r ? stateOf(r, ctx()) : 'dark'; }
    function lockedName(name) { var r = room(name); return !!r && locked(r, ctx()); }
    /* a room to a state at once (the site applies Dark and Blueprint this way; Seen is staged by the page instead, then sent) */
    function set(name, to) {
      if (!on() || STATES.indexOf(to) < 0) return false;
      var n = str(name), r = room(n), c = ctx();
      if (!r) return false;
      if (locked(r, c)) { say(n + ' is seen because its band is open. Close the band to change it.', true); return false; }
      if (stateOf(r, c) === to) return false;
      if (!write(setState(n, to, c))) return false;
      say(n + ': ' + LABEL[to].toLowerCase() + '.'); done(); return true;
    }
    function cycle(name) {
      if (!on()) return false;
      var n = str(name), r = room(n), c = ctx();
      if (!r) return false;
      if (locked(r, c)) { say(n + ' is seen because its band is open. Close the band to change it.', true); return false; }
      return set(n, next(stateOf(r, c)));
    }
    function intelGroup(id) {
      if (!on()) return false;
      var g = view().groups.filter(function (x) { return x.id === id; })[0]; if (!g) return false;
      var c = ctx(), l = intel(rooms(), g.names, c);
      if (signature(l.know) === signature(c.know)) { say('Nothing dark in ' + g.label.toLowerCase() + '.'); return false; }
      if (!write(l)) return false;
      say('Intel: ' + g.label.toLowerCase() + ' is known as blueprint.'); done(); return true;
    }
    /* a tap on Location's GM map: data-room="r<index>", the room's index in the roll. false when it names no room (the page's other taps go on) */
    function tapRoom(roll, dataRoom) {
      if (!active() || !isObj(roll) || !Array.isArray(roll.rooms)) return false;
      var m = /^r(\d+)$/.exec(str(dataRoom)), r = m ? roll.rooms[+m[1]] : null;
      if (!isObj(r) || !str(r.name)) return false;
      cycle(str(r.name)); return true;
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
    function seg(name, staged) {
      if (!active()) return '';
      var r = room(name); if (!r) return '';
      var c = ctx();
      return segHtml({ name: str(r.name), state: stateOf(r, c), locked: locked(r, c), staged: !!staged }, host.esc || esc0);
    }
    return { active: active, view: view, states: states, stateOf: stateOfName, locked: lockedName, set: set, cycle: cycle, intel: intelGroup, tapRoom: tapRoom, roomAt: roomAt, seg: seg };
  }

  return { SWITCH: SWITCH, STATES: STATES, LABEL: LABEL, cleanNames: cleanNames, stateOf: stateOf, locked: locked, next: next, setState: setState, intel: intel, groups: groups,
    signature: signature, segHtml: segHtml, create: create };
});
