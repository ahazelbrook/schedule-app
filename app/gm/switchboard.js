/* gm/switchboard.js — Menu -> Switchboard: the GM's switches (suite ticket W0.2, no switch of its own).

   Window.B68GmSwitchboard, and module.exports under Node. The registry is app/features.js; this is the controller that reads and writes it and the sheet that
   draws it. gm-page.js makes one per page session with create(host) and calls heal() on every campaign arrival.

   Where the values live (app/features.js says it too)
     the GM state document   features: { <id>: bool }   every switch; the GM page is its only writer, so it reads it live (nothing to poll)
     the campaign document   features: { <id>: bool }   the display and phone switches only, a COMPLETE map; copied here by syncPublic(), so a phone (campaign
                             poll) and the iPad (display poll) learn of a flip within one poll, no reload. A GM-only id is never in it.

   create(host) -> the controller. host:
     doc()          the GM state document (live)        patch(p, opts) -> bool   the page's patch (a change to the state document)
     campaign()     the campaign document as last arrived, or null
     publish(map)   -> Promise: write the campaign document's `features` (the page api's publishFeatures)
     root()         the #gm-root element                toast(msg, bad)        redraw()   after a flip, so what shows follows
     F, Sheet       the registry and the sheet builder (default window.B68Features, window.B68GmWorkshop)
   controller
     on(id)             -> bool          set(id, on) -> bool      allOff() -> number of switches that were on
     syncPublic()       copy the display and phone switches into the campaign document when its copy differs (an absent map is all off, so with every switch off
                        and nothing stored it writes nothing)
     heal()             = syncPublic(), for a campaign arrival; a copy just sent is not sent again for 4 s, and the same copy at most three times
     render(box)        draw the Switchboard into box           open() toggle() close()
     counts()           -> { total, on } */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmSwitchboard = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var RESEND_MS = 4000, RESEND_MAX = 3;      /* a copy the server keeps not taking (a page newer than the Worker) is tried three times, then left until the map changes */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  var SURFACE = { gm: 'GM only', display: 'the iPad', phone: 'phones' };
  var SAT = { on: 'on', 'try': 'your call on Friday', off: 'off' };

  function create(host) {
    var F = host.F || (W && W.B68Features) || null;
    var Sheet = host.Sheet || (W && W.B68GmWorkshop) || null;
    var sent = { key: '', at: 0, n: 0 };
    var ctl = {};
    function now() { return typeof host.now === 'function' ? host.now() : Date.now(); }
    function doc() { return F ? host.doc() : {}; }

    ctl.on = function (id) { return !!F && F.valueOf(doc(), id); };
    ctl.counts = function () { var l = F ? F.list() : []; return { total: l.length, on: l.filter(function (s) { return F.valueOf(doc(), s.id); }).length }; };

    ctl.syncPublic = function () {
      if (!F || typeof host.publish !== 'function') return false;
      var camp = typeof host.campaign === 'function' ? host.campaign() : null;
      if (!isObj(camp)) return false;                            /* the campaign has not arrived: nothing to compare with yet */
      var want = typeof F.publishMap === 'function' ? F.publishMap(doc(), camp.features) : F.publicMap(doc());
      if (F.sameOn(want, camp.features)) return false;
      var key = JSON.stringify(want), t = now();
      if (sent.key === key && (t - sent.at < RESEND_MS || sent.n >= RESEND_MAX)) return false;
      sent = { key: key, at: t, n: sent.key === key ? sent.n + 1 : 1 };
      Promise.resolve().then(function () { return host.publish(want); }).catch(function (e) {
        sent = { key: '', at: 0, n: 0 };
        if (typeof host.toast === 'function') host.toast('Could not copy the switches to the players’ screens: ' + (e && e.message || e), true);
      });
      return true;
    };
    ctl.heal = function () { try { return ctl.syncPublic(); } catch (e) { return false; } };

    function changed() {
      ctl.syncPublic();
      if (typeof host.redraw === 'function') host.redraw();
      var s = Sheet && host.root && host.root() && Sheet.sheet(host.root(), 'switchboard', 'Switchboard');
      if (s && s.isOpen()) ctl.render(s.body);
    }
    ctl.set = function (id, on) {
      if (!F || !F.get(id)) return false;
      if (!host.patch(F.patchFor(doc(), id, on === true), { force: true })) return false;
      changed();
      return true;
    };
    ctl.allOff = function () {
      if (!F) return 0;
      var n = ctl.counts().on;
      if (!host.patch(F.patchAllOff(doc()), { force: true })) return -1;
      sent = { key: '', at: 0, n: 0 };
      changed();
      if (typeof host.toast === 'function') host.toast(n ? 'All switches off (' + n + ' were on). The app is as it was.' : 'Every switch was already off.');
      return n;
    };

    ctl.render = function (box) {
      if (!box) return;
      var h;
      if (!F || !F.list().length) h = '<p class="gm-empty">No switches yet.</p>';
      else {
        var c = ctl.counts();
        h = '<div class="gm-sb-head"><button type="button" class="btn sm" data-sb-alloff' + (c.on ? '' : ' disabled') + ' title="Every switch off, at once, with no reload">All off</button> <span class="gm-sb-tag">' + c.on + ' of ' + c.total + ' on</span></div>' +
          F.byStage().map(function (g) {
            return '<section class="gm-sb-stage" aria-label="' + esc(g.stage.label) + '"><h3>' + esc(g.stage.label) + '</h3>' + g.switches.map(function (s) {
              var on = F.valueOf(doc(), s.id);
              return '<div class="gm-sb-row"><b>' + esc(s.label) + '</b><button type="button" class="btn sm" data-sb="' + esc(s.id) + '" aria-pressed="' + on + '">' + (on ? 'On' : 'Off') + '</button>' +
                '<small>' + esc(s.doc) + '</small><small class="gm-sb-tag">' + esc(s.id) + ' · ' + esc(SURFACE[s.surface] || s.surface) + ' · Saturday: ' + esc(SAT[s.saturday] || s.saturday) + '</small></div>';
            }).join('') + '</section>';
          }).join('');
      }
      box.innerHTML = h;
      var sh = box.parentNode;
      if (sh && !sh.__sb) {
        sh.__sb = true;
        sh.addEventListener('click', function (ev) {
          var t = ev.target && ev.target.closest ? ev.target.closest('[data-sb],[data-sb-alloff]') : null; if (!t) return;
          if (t.hasAttribute('data-sb-alloff')) ctl.allOff(); else ctl.set(t.getAttribute('data-sb'), t.getAttribute('aria-pressed') !== 'true');
        });
      }
    };
    function sheet() { var r = typeof host.root === 'function' ? host.root() : null; return Sheet && r ? Sheet.sheet(r, 'switchboard', 'Switchboard') : null; }
    ctl.open = function () { var s = sheet(); if (!s) return false; ctl.render(s.body); s.open(); return true; };
    ctl.close = function () { var s = sheet(); if (s) s.close(); };
    ctl.toggle = function () { var s = sheet(); if (s && s.isOpen()) { s.close(); return false; } return ctl.open(); };
    return ctl;
  }

  return { create: create, _pure: { esc: esc } };
});
