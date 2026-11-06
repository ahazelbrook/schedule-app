/* gm/stage.js — stage the rooms, then send them (suite 2.3; the GM night rebuild, N3: the site).

   Plain script, UMD: window.B68GmStage in the browser, module.exports under Node. GM side only. create(host) holds the state of one GM page and reaches the page
   only through the host it is given, so a node test can drive it with a fake.

   STAGING. A room is staged from the site (its card's Players' map: Seen), from Location's Open one room list, or by a tap on Location's map. A staged room is a
   name in a list on THIS page and nowhere else: it is never written to the GM state document, the campaign document or the ambient document, so no display GET
   can carry it. It shows amber on the GM screen only. Nothing reaches the iPad until send().
   SENDING. send() hands the staged names to the page, which opens them for the players through the same door "Open for the players" uses (the run's ball.open,
   then the live reveal, which asks first). The iPad's own cross-fade is 600 ms.
   CONTROLS. The LIVE line says what the iPad shows of the map. Freeze holds the iPad: while frozen the page sends it nothing, and send() refuses. Blank turns the
   iPad black (lights out) until the next send. Esc is not the stage's any more (the GM page's one Esc, gm/esc.js): Blank is a button.

   API (pure)
     cleanNames(list, rooms) -> names that are rooms of the roll, once each, in the order given
     tintIds(roll, names) -> ['r0', ...] the map's data-room ids of the named rooms on the GM layer (the index in the roll)
     shows(view) -> bool                    the stage group has something to say: rooms staged, the map live on the iPad, frozen or blank
     groupHtml(view, esc) -> HTML           the site toolbar's stage group: the LIVE line, Send (n), Freeze, Blank (data-site="send" | "freeze" | "blank")
     create(host) -> controller
       host: { feature(id) -> bool, rooms() -> [{ name, band }], opened() -> [name] open for the players already, shown(name) -> bool its band already shows it,
               setOpen(names) -> bool, liveText() -> string what the iPad shows, dark() -> Promise, toast(msg, bad), changed() }
       controller: toggle(name) stage(name) unstage(name) staged() isStaged(name) canStage(name) send() freeze(on?) blank() unblank() holding() view() reset()
                   (unblank: the page, when anything but the dark reaches the iPad; view() never says BLANK while a map is live)

   THE PAGE'S STAGE (what the band's iPad tray reads, N5; keep the names)
     provide(controller) -> unprovide()     the GM page hands over its controller (one at a time; a second provide replaces the first)
     state() -> { staged: n, live: 'what the iPad shows from the map', frozen: bool, blank: bool }      (all zero and empty with no controller)
     send() -> bool        freeze(on) -> bool (on: true, false, or omitted to flip)        blank() -> Promise<bool>
     onChange(fn) -> unsubscribe()          fn() after every change the controller makes, and after notify()
     notify()                               the page says what the iPad shows may have changed (a map went up or came down) */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmStage = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var MAX = 40, SWITCH = 'map.stage';
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc0(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function cleanNames(list, rooms) {
    var have = {}, out = [];
    (Array.isArray(rooms) ? rooms : []).forEach(function (r) { var n = isObj(r) ? str(r.name) : str(r); if (n) have[n] = 1; });
    (Array.isArray(list) ? list : []).forEach(function (n) { if (typeof n === 'string' && have[n] === 1 && out.indexOf(n) < 0 && out.length < MAX) out.push(n); });
    return out;
  }
  function tintIds(roll, names) {
    var rooms = roll && Array.isArray(roll.rooms) ? roll.rooms : [], out = [];
    rooms.forEach(function (r, i) { if (isObj(r) && names.indexOf(str(r.name)) >= 0) out.push('r' + i); });
    return out;
  }

  /* the stage group of the site's toolbar: only when it has something to say */
  function shows(v) { return !!v && v.on !== false && ((Array.isArray(v.staged) && v.staged.length > 0) || !!v.frozen || !!v.blanked || !!v.live); }
  function groupHtml(v, esc) {
    esc = esc || esc0;
    if (!shows(v)) return '';
    var n = v.staged.length, cls = v.frozen ? ' frozen' : v.blanked ? ' blank' : v.live ? ' live' : '';
    var line = v.frozen ? 'FROZEN · ' + (v.live || 'nothing') : v.blanked ? 'BLANK' : v.live ? 'LIVE · ' + v.live : 'Not on the iPad';
    var title = v.frozen ? 'The iPad is held: nothing is sent to it until you unfreeze' : v.blanked ? 'The iPad is black until the next send' : v.live ? 'The map on the iPad shows ' + v.live : 'The map is not on the iPad';
    return '<span class="rv-stage" role="group" aria-label="The map on the iPad">' +
      '<span class="rv-live' + cls + '" data-site-live title="' + esc(title) + '">' + esc(line) + '</span>' +
      (n ? '<button type="button" class="rv-btn sm rv-send" data-site="send"' + (v.frozen ? ' disabled title="Unfreeze the iPad first"' : ' title="Open the staged rooms for the players: ' + esc(v.staged.join(', ')) + '"') + '>Send <b>' + n + '</b></button>' : '') +
      '<button type="button" class="rv-btn sm rv-tog" data-site="freeze" aria-pressed="' + !!v.frozen + '" title="' + (v.frozen ? 'Let the iPad follow again' : 'Hold the iPad: nothing is sent to it until you unfreeze') + '">' + (v.frozen ? 'Unfreeze' : 'Freeze') + '</button>' +
      '<button type="button" class="rv-btn sm" data-site="blank" title="The iPad goes black until the next send">Blank</button></span>';
  }

  /* ---- the page's stage, for the band's tray (N5) ---- */
  var cur = null, subs = [];
  function notify() { subs.slice().forEach(function (fn) { try { fn(); } catch (e) { /* one listener failing never stops the rest */ } }); }

  function create(host) {
    host = host || {};
    var list = [], frozen = false, blanked = false, ctl = null;
    function on() { return typeof host.feature === 'function' ? !!host.feature(SWITCH) : false; }
    function say(m, bad) { if (typeof host.toast === 'function') host.toast(m, !!bad); }
    function changed() { if (typeof host.changed === 'function') host.changed(); if (cur && cur === ctl) notify(); }
    function rooms() { return typeof host.rooms === 'function' ? host.rooms() : []; }
    function isStaged(n) { return list.indexOf(n) >= 0; }
    /* only a room that is a room of the roll, and is not already showing to the players, can be staged */
    function canStage(n) {
      if (cleanNames([n], rooms()).length !== 1) return false;
      if (typeof host.shown === 'function' && host.shown(n)) return false;
      return (typeof host.opened === 'function' ? host.opened() : []).indexOf(n) < 0;
    }
    function stage(n) { if (!on() || !canStage(n) || isStaged(n)) return false; list.push(n); changed(); return true; }
    function unstage(n) { var i = list.indexOf(n); if (i < 0) return false; list.splice(i, 1); changed(); return true; }
    function toggle(n) { return isStaged(n) ? unstage(n) : stage(n); }
    function staged() { return cleanNames(list, rooms()).filter(canStage); }
    function send() {
      if (!on()) return false;
      if (frozen) { say('The iPad is frozen: unfreeze it before you send.', true); return false; }
      var names = staged();
      if (!names.length) { say('Nothing is staged.', true); list = []; changed(); return false; }
      var cur0 = typeof host.opened === 'function' ? host.opened() : [], ok = typeof host.setOpen === 'function' ? host.setOpen(cur0.concat(names.filter(function (n) { return cur0.indexOf(n) < 0; }))) : false;
      if (!ok) { say('Could not send the staged rooms.', true); return false; }
      list = []; blanked = false; changed();
      return true;
    }
    /* want: true or false sets it; anything else flips it */
    function freeze(want) {
      if (!on()) return false;
      var next = typeof want === 'boolean' ? want : !frozen;
      if (next === frozen) return frozen;
      frozen = next; say(frozen ? 'The iPad is held: nothing is sent to it until you unfreeze.' : 'Unfrozen: the iPad follows again.'); changed(); return frozen;
    }
    function blank() {
      if (!on()) return Promise.resolve(false);
      return Promise.resolve(typeof host.dark === 'function' ? host.dark() : null).then(function () { blanked = true; changed(); return true; }, function () { return false; });
    }
    /* the page calls this when anything but the dark reaches the iPad (Show on iPad from Location, a scene, a handout): Blank is over */
    function unblank() { if (!blanked) return false; blanked = false; changed(); return true; }
    function holding() { return on() && frozen; }
    function view() {
      var live = typeof host.liveText === 'function' ? str(host.liveText()) : '', bl = blanked && !live;     /* a map live on the iPad is never blank */
      return { on: on(), staged: staged(), frozen: frozen, blanked: bl, live: live, badge: frozen ? 'FROZEN: ' + (live || 'nothing') : bl ? 'BLANK' : live ? 'LIVE: ' + live : 'Not on the iPad' };
    }
    function reset() { list = []; frozen = false; blanked = false; }
    ctl = { toggle: toggle, stage: stage, unstage: unstage, staged: staged, isStaged: isStaged, canStage: canStage, send: send, freeze: freeze, blank: blank, unblank: unblank, holding: holding, view: view, reset: reset };
    return ctl;
  }

  function provide(c) {
    cur = isObj(c) && typeof c.view === 'function' ? c : null;
    notify();
    return function unprovide() { if (cur === c) { cur = null; notify(); } };
  }
  function state() {
    var v = null; try { v = cur ? cur.view() : null; } catch (e) { v = null; }
    if (!v || !v.on) return { staged: 0, live: '', frozen: false, blank: false };
    return { staged: v.staged.length, live: str(v.live), frozen: !!v.frozen, blank: !!v.blanked };
  }
  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    subs.push(fn);
    return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
  }

  return { SWITCH: SWITCH, cleanNames: cleanNames, tintIds: tintIds, shows: shows, groupHtml: groupHtml, create: create,
    provide: provide, state: state, notify: notify, onChange: onChange,
    send: function () { return cur ? cur.send() : false; },
    freeze: function (want) { return cur ? cur.freeze(want) : false; },
    blank: function () { return cur ? cur.blank() : Promise.resolve(false); } };
});
