/* gm/spine.js — the one hook the GM page calls for the spine tickets (1.1 the phase rail, 1.5 the curfew).

   Window.B68GmSpine, and module.exports under Node. gm-page.js calls tick(host) from its top-bar redraw (which runs on every state arrival, so another GM
   device's phase change shows within one poll) and this file does the rest. The two lines (app/features.js spine.rail, spine.curfew) are read live through
   host.on(id); since the night rebuild (N0) everything built is on, so both are always drawn. The off paths below stay until a later cleanup.
   (1.9, the Workshop's first cuts, went with the Workshop: its five items are Settings or back where they were, gm/settings.js.)

   host: { root() -> #gm-root, night() -> the night controller, now() -> ms, toast(msg, bad), layer(path, value) -> Promise (the show contract),
           on(id) -> bool (a line of the registry) }

   The curfew bar is drawn under the rail and is reached from the Next beat button, so it needs no other part of the page. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmSpine = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var cur = null, rail = null, curfew = null, lastBand, timer = null;
  function mod(name) { return W && W[name] ? W[name] : null; }
  var proxy = {
    root: function () { return cur && cur.root(); },
    night: function () { return cur && cur.night(); },
    now: function () { return cur && typeof cur.now === 'function' ? cur.now() : Date.now(); },
    toast: function (m, b) { if (cur && typeof cur.toast === 'function') cur.toast(m, b); },
    on: function () { return false; }
  };

  function band(on) {
    var N = mod('B68GmNight'), n = cur.night();
    /* after a load the page's night controller comes a moment after the first tick: until it is there the night is not known, so nothing is written
       (a null then took the iPad's phase down on every reload); from the first tick that knows it, band.phase follows night.phase */
    if (on && (!N || !n)) return;
    var want = on ? N.bandPhase(n.night ? n.night() : null) : null;
    if (!on) { if (lastBand !== undefined) { var was = lastBand; lastBand = undefined; if (was) send(null); } return; }
    if (want === lastBand) return;
    lastBand = want;
    send(want || null);
  }
  function send(v) {
    if (!cur || typeof cur.layer !== 'function') return;
    var p; try { p = cur.layer('band.phase', v); } catch (e) { lastBand = undefined; return; }
    if (p && typeof p.then === 'function') p.then(function (a) { if (a === null || a === undefined) { /* the page could not write: ask again on the next tick */ lastBand = undefined; } }, function () { lastBand = undefined; });
  }

  function tick(host) {
    if (!host || typeof host.on !== 'function') return;
    cur = host;
    var R = mod('B68GmPhaseRail'), C = mod('B68GmCurfew');
    var wantRail = !!R && host.on('spine.rail'), wantCurfew = !!C && host.on('spine.curfew');
    if (wantRail) { if (!rail) rail = R.create(proxy); rail.sync(); band(true); }
    else if (rail) { rail.destroy(); rail = null; band(false); }
    if (wantCurfew) { if (!curfew) curfew = C.create(proxy); curfew.sync(); }
    else if (curfew) { curfew.destroy(); curfew = null; }
    /* budgets and the curfew move with the clock: re-draw every 15 s while one is on */
    var any = wantRail || wantCurfew;
    if (any && !timer && typeof W.setInterval === 'function') timer = W.setInterval(function () { if (cur) tick(cur); }, 15000);
    else if (!any && timer) { W.clearInterval(timer); timer = null; }
  }
  /* the page went away (a new session replaces it) */
  function reset() {
    if (rail) rail.destroy(); if (curfew) curfew.destroy();
    rail = curfew = null; lastBand = undefined; cur = null;
  }

  return { tick: tick, reset: reset, _state: function () { return { rail: !!rail, curfew: !!curfew, band: lastBand, timer: !!timer }; } };
});
