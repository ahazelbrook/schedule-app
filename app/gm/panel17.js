/* gm/panel17.js — the page's seam for the staging panel, the security line and the stage bar (suite 2.3, 2.4, 3.1).

   Plain script, UMD: window.B68GmPanel17 in the browser, module.exports under Node. It builds the three controllers (gm/stage.js, gm/security.js, gm/spotlight.js)
   from ONE host the GM page gives it, draws them into one box under the map's heading, and sends every click to the right controller. Each part is drawn only
   while its own switch is on, so with all three off nothing here draws, writes or sends.

   API
     create(host) -> { stage, security, spot, paint(box), bind(box) -> unbind, tick(), esc(), holding(), tint(root, roll), reset(), active() }
       host: the union of the three controllers' hosts, plus feature(id), toast(msg, bad), changed() */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmPanel17 = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function req(name, path) { if (root && root[name]) return root[name]; try { return require(path); } catch (e) { return null; } }

  function create(host) {
    host = host || {};
    var St = req('B68GmStage', './stage.js'), Se = req('B68GmSecurity', './security.js'), Sp = req('B68GmSpotlight', './spotlight.js');
    if (!St || !Se || !Sp) return null;
    function changed() { if (typeof host.changed === 'function') host.changed(); }
    var h = Object.create(host); h.changed = changed;
    var stage = St.create(h), security = Se.create(h), spot = Sp.create(h);

    function active() { return stage.view().on || !!security.view() || spot.view().on; }
    function html() {
      var out = '', sv = stage.view();
      if (sv.on) out += '<div class="gm-stage" data-b17-part="stage">' + St.panelHtml(sv, host.esc) + '</div>';
      var cv = security.view(); if (cv) out += '<div class="gm-sec" data-b17-part="security">' + Se.html(cv, host.esc) + '</div>';
      var pv = spot.view(); if (pv.on) out += '<div class="gm-bar" data-b17-part="spotlight">' + Sp.html(pv, host.esc) + '</div>';
      return out;
    }
    function paint(box) {
      if (!box) return;
      if (typeof spot.seed === 'function') spot.seed();
      var s = html();
      box.hidden = !s;
      if (box.innerHTML !== s) box.innerHTML = s;
    }
    function bind(box) {
      function onClick(ev) {
        var b = ev.target && ev.target.closest ? ev.target.closest('[data-b17]') : null; if (!b || !box.contains(b)) return;
        var a = b.getAttribute('data-b17'), id = str(b.getAttribute('data-id')), room = str(b.getAttribute('data-room'));
        if (a === 'send') stage.send(); else if (a === 'freeze') stage.freeze(); else if (a === 'blank') stage.blank(); else if (a === 'unstage') stage.unstage(room);
        else if (a === 'sec-up') security.step(1); else if (a === 'sec-down') security.step(-1);
        else if (a === 'spot') { if (spot.held() === id) spot.narrator(); else spot.spotlight(id); }
        else if (a === 'bar-x') spot.remove(id); else if (a === 'narrator') spot.narrator();
      }
      function onSubmit(ev) {
        var f = ev.target && ev.target.closest ? ev.target.closest('[data-b17="bar-add"]') : null; if (!f) return;
        ev.preventDefault();
        var inp = f.querySelector ? f.querySelector('input') : null;
        if (inp && spot.add(str(inp.value).trim())) inp.value = '';
      }
      box.addEventListener('click', onClick); box.addEventListener('submit', onSubmit);
      return function () { box.removeEventListener('click', onClick); box.removeEventListener('submit', onSubmit); };
    }
    /* the staged rooms amber on the GM's own map: a class on the room's group (data-room="r<index>"), taken off the rest */
    function tint(rootEl, roll) {
      if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return;
      var want = stage.view().on ? St.tintIds(roll, stage.staged()) : [];
      Array.prototype.forEach.call(rootEl.querySelectorAll('[data-room]'), function (el) {
        var on = want.indexOf(el.getAttribute('data-room')) >= 0;
        if (el.classList) { if (on) el.classList.add('gm-staged'); else el.classList.remove('gm-staged'); }
      });
    }
    function reset() { stage.reset(); security.reset(); spot.reset(); }
    return { stage: stage, security: security, spot: spot, paint: paint, bind: bind, tick: function () { return security.tick(); }, esc: function () { return stage.esc(); },
      holding: function () { return stage.holding(); }, tint: tint, reset: reset, active: active, html: html };
  }
  return { create: create };
});
