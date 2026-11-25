/* gm/threat-room.js: the threat marker follows the roll (night.flow). RK05 of the room key build.
   In the night-flow bundle (app/routes.js), fetched only while its setting is on. Plain script, UMD: window.B68GmThreatRoom in the browser, module.exports under Node.
   ES5, as the files beside it. GM side only: nothing here is sent to the iPad or a phone.

   Two things, both on the page's own Run view:
     room()      the room a roll is in. The room the Run view has selected (the one the Roll's own line uses) comes first; with none selected, the room most of the
                 crew are in (the old pick, a tie to the first counted). The threat glyph (gm/map-threat.js) drops there.
     stamped(st) a stamp went up with a Who set: that PC's marker moves to the roll's room. A marker move costs nothing: no clock, no heat. Nothing moves when no PC
                 is picked, the PC is not one of the night's, the room is not one of the site's rooms, or the PC is there already (so a second stamp writes nothing).

   API
     SWITCH
     roomOf(sel, crewRooms, pick)    -> the room name ('' when none)
     pcFor(who, pcs)                 -> the PC's id ('' when the name picks none or more than one)
     create(host) -> { room(), stamped() }
       host: { feature(id), sel() -> the selected room, crew() -> { pcId: room }, pick(crew) -> the most-crewed room, who() -> the Roll's Who (a name or ''),
               pcs() -> [{ id, name }], rooms() -> [names] (empty when unknown), move(pcId, room) -> true | falsy, log(text) } */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmThreatRoom = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SWITCH = 'night.flow';

  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function norm(s) { return str(s).replace(/[(),:]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase(); }

  /* the selected room first, then the old pick */
  function roomOf(sel, crewRooms, pick) {
    var s = str(sel).trim();
    if (s) return s;
    return typeof pick === 'function' ? str(pick(isObj(crewRooms) ? crewRooms : {})).trim() : '';
  }

  /* the Who chip carries a PC's full name; match it whole, else by the first name when that is one PC only */
  function pcFor(who, pcs) {
    var w = norm(who), list = Array.isArray(pcs) ? pcs.filter(function (p) { return isObj(p) && str(p.id) && norm(p.name); }) : [];
    if (!w) return '';
    var hit = list.filter(function (p) { return norm(p.name) === w; });
    if (hit.length === 1) return str(hit[0].id);
    if (hit.length > 1) return '';
    hit = list.filter(function (p) { return norm(p.name).split(' ')[0] === w.split(' ')[0]; });
    return hit.length === 1 ? str(hit[0].id) : '';
  }

  function create(host) {
    host = host || {};
    function on() { return typeof host.feature === 'function' ? !!host.feature(SWITCH) : false; }
    function get(name) { return typeof host[name] === 'function' ? host[name]() : undefined; }

    function room() { return roomOf(get('sel'), get('crew'), host.pick); }
    /* a stamp went up (the threat has already dropped on room()): -> { pc, room } when a marker moved, else null */
    function stamped() {
      if (!on() || typeof host.move !== 'function') return null;
      var who = str(get('who')).trim(); if (!who) return null;
      var pcs = get('pcs'), id = pcFor(who, pcs); if (!id) return null;
      var to = room(); if (!to) return null;
      var known = get('rooms'), list = Array.isArray(known) ? known.map(str).filter(Boolean) : [];
      if (list.length && list.indexOf(to) < 0) return null;
      var crew = get('crew'), at = isObj(crew) ? str(crew[id]) : '';
      if (at === to) return null;
      if (!host.move(id, to)) return null;
      var p = (Array.isArray(pcs) ? pcs : []).filter(function (x) { return isObj(x) && str(x.id) === id; })[0];
      if (typeof host.log === 'function') host.log('Marker follows the roll: ' + (p ? str(p.name) : 'a PC') + ' to ' + to);
      return { pc: id, room: to };
    }
    return { room: room, stamped: stamped };
  }

  return { SWITCH: SWITCH, roomOf: roomOf, pcFor: pcFor, create: create };
});
