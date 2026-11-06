/* gm/panel17.js — the page's seam for the site's stage, security level and people (suite 2.3, 2.4, 3.1; the GM night rebuild, N3).

   Plain script, UMD: window.B68GmPanel17 in the browser, module.exports under Node. It builds the three controllers (gm/stage.js, gm/security.js, gm/spotlight.js)
   from ONE host the GM page gives it. They used to draw into one box under Location's Map heading (#gm-b17); since N3 they are drawn by the site (the Run view:
   the stage group in its toolbar, the alarm readout in its header, the people in each room's card), and this seam only builds them and tints Location's map.

   API
     create(host) -> { stage, security, spot, tick(), holding(), tint(root, roll), reset(), active() } | null (a controller file missing)
       host: the union of the three controllers' hosts, plus feature(id), toast(msg, bad), changed() */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmPanel17 = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  function req(name, path) { if (root && root[name]) return root[name]; try { return require(path); } catch (e) { return null; } }

  function create(host) {
    host = host || {};
    var St = req('B68GmStage', './stage.js'), Se = req('B68GmSecurity', './security.js'), Sp = req('B68GmSpotlight', './spotlight.js');
    if (!St || !Se || !Sp) return null;
    function changed() { if (typeof host.changed === 'function') host.changed(); }
    var h = Object.create(host); h.changed = changed;
    var stage = St.create(h), security = Se.create(h), spot = Sp.create(h);

    function active() { return stage.view().on || !!security.view() || spot.view().on; }
    /* the staged rooms amber on Location's own map: a class on the room's group (data-room="r<index>"), taken off the rest */
    function tint(rootEl, roll) {
      if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return;
      var want = stage.view().on ? St.tintIds(roll, stage.staged()) : [];
      Array.prototype.forEach.call(rootEl.querySelectorAll('[data-room]'), function (el) {
        var on = want.indexOf(el.getAttribute('data-room')) >= 0;
        if (el.classList) { if (on) el.classList.add('gm-staged'); else el.classList.remove('gm-staged'); }
      });
    }
    function reset() { stage.reset(); security.reset(); spot.reset(); }
    return { stage: stage, security: security, spot: spot, tick: function () { return security.tick(); }, holding: function () { return stage.holding(); }, tint: tint, reset: reset, active: active };
  }
  return { create: create };
});
