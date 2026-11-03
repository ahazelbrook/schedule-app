/* gm/stage.js — stage the rooms, then send them (suite 2.3, switch map.stage).

   Plain script, UMD: window.B68GmStage in the browser, module.exports under Node. GM side only. create(host) holds the state of one GM page and reaches the page
   only through the host it is given, so a node test can drive it with a fake.

   STAGING. Tapping a room stages it. A staged room is a name in a list on THIS page and nowhere else: it is never written to the GM state document, the campaign
   document or the ambient document, so no display GET can carry it. It shows amber on the GM screen only (tint()). Nothing reaches the iPad until send().
   SENDING. send() hands the staged names to the page, which opens them for the players through the same door "Open for the players" uses (the run's ball.open,
   then the live reveal, which asks first). The iPad's own cross-fade is 600 ms.
   CONTROLS. A LIVE badge says what the iPad shows. Freeze holds the iPad: while frozen the page sends it nothing, and send() refuses. Blank turns the iPad
   black (lights out) and is also on Esc.

   API
     cleanNames(list, rooms) -> names that are rooms of the roll, once each, in the order given
     tintIds(roll, names) -> ['r0', ...] the map's data-room ids of the named rooms on the GM layer (the index in the roll)
     panelHtml(view, esc) -> HTML          the staging panel (the badge, the staged list, Send, Freeze, Blank)
     create(host) -> controller
       host: { feature(id) -> bool, rooms() -> [{ name, band }], opened() -> [name] open for the players already, shown(name) -> bool its band already shows it,
               setOpen(names) -> bool, liveText() -> string what the iPad shows, dark() -> Promise, toast(msg, bad), changed() }
       controller: toggle(name) stage(name) unstage(name) staged() isStaged(name) send() freeze() blank() holding() view() esc() reset() */
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

  function panelHtml(v, esc) {
    esc = esc || esc0;
    var h = '<div class="gm-stage-h"><span class="gm-lab">Stage</span> <span class="gm-stage-live' + (v.frozen ? ' frozen' : v.blanked ? ' blank' : '') + '" data-b17="live">' + esc(v.badge) + '</span></div>';
    h += v.staged.length
      ? '<ul class="gm-stage-list">' + v.staged.map(function (n) { return '<li><span class="gm-stage-name">' + esc(n) + '</span> <button type="button" class="btn sm" data-b17="unstage" data-room="' + esc(n) + '" aria-label="Take ' + esc(n) + ' off the stage">×</button></li>'; }).join('') + '</ul>'
      : '<p class="gm-dim">Nothing staged. Tap Stage on a room; it stays on this screen until you send it.</p>';
    h += '<div class="gm-stage-acts"><button type="button" class="btn sm primary" data-b17="send"' + (v.staged.length && !v.frozen ? '' : ' disabled') + '>Send' + (v.staged.length ? ' (' + v.staged.length + ')' : '') + '</button> ' +
      '<button type="button" class="btn sm" data-b17="freeze" aria-pressed="' + !!v.frozen + '">' + (v.frozen ? 'Unfreeze' : 'Freeze') + '</button> ' +
      '<button type="button" class="btn sm" data-b17="blank" title="Esc">Blank</button></div>';
    return h;
  }

  function create(host) {
    host = host || {};
    var list = [], frozen = false, blanked = false;
    function on() { return typeof host.feature === 'function' ? !!host.feature(SWITCH) : false; }
    function say(m, bad) { if (typeof host.toast === 'function') host.toast(m, !!bad); }
    function changed() { if (typeof host.changed === 'function') host.changed(); }
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
      var cur = typeof host.opened === 'function' ? host.opened() : [], ok = typeof host.setOpen === 'function' ? host.setOpen(cur.concat(names.filter(function (n) { return cur.indexOf(n) < 0; }))) : false;
      if (!ok) { say('Could not send the staged rooms.', true); return false; }
      list = []; blanked = false; changed();
      return true;
    }
    function freeze() { if (!on()) return false; frozen = !frozen; say(frozen ? 'The iPad is held: nothing is sent to it until you unfreeze.' : 'Unfrozen: the iPad follows again.'); changed(); return frozen; }
    function blank() {
      if (!on()) return Promise.resolve(false);
      return Promise.resolve(typeof host.dark === 'function' ? host.dark() : null).then(function () { blanked = true; changed(); return true; }, function () { return false; });
    }
    function holding() { return on() && frozen; }
    function esc() { if (!on()) return false; if (blanked || !(typeof host.liveText === 'function' && host.liveText())) return false; blank(); return true; }
    function view() {
      var live = typeof host.liveText === 'function' ? str(host.liveText()) : '';
      return { on: on(), staged: staged(), frozen: frozen, blanked: blanked, live: live, badge: frozen ? 'FROZEN: ' + (live || 'nothing') : blanked ? 'BLANK' : live ? 'LIVE: ' + live : 'Not on the iPad' };
    }
    function reset() { list = []; frozen = false; blanked = false; }
    return { toggle: toggle, stage: stage, unstage: unstage, staged: staged, isStaged: isStaged, send: send, freeze: freeze, blank: blank, holding: holding, view: view, esc: esc, reset: reset };
  }

  /* the panel's clicks: one listener on the box, by data-b17 */
  function bind(box, ctl) {
    function onClick(ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-b17]') : null; if (!b || !box.contains(b)) return;
      var a = b.getAttribute('data-b17');
      if (a === 'send') ctl.send(); else if (a === 'freeze') ctl.freeze(); else if (a === 'blank') ctl.blank(); else if (a === 'unstage') ctl.unstage(str(b.getAttribute('data-room')));
    }
    box.addEventListener('click', onClick);
    return function () { box.removeEventListener('click', onClick); };
  }
  function paint(box, ctl, esc) { box.innerHTML = panelHtml(ctl.view(), esc); }

  return { SWITCH: SWITCH, cleanNames: cleanNames, tintIds: tintIds, panelHtml: panelHtml, create: create, bind: bind, paint: paint };
});
