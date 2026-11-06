/* gm/spine.js — the one hook the GM page calls for the night's spine: the phase on the iPad's band (1.1) and the curfew's rules (1.5).

   Window.B68GmSpine, and module.exports under Node. gm-page.js calls tick(host) from its band redraw (which runs on every state arrival, so another GM
   device's phase change shows within one poll) and this file does the rest:
     the iPad's band is told the night's phase (band.phase: an id, never a time), and only when it changed;
     the curfew controller (gm/curfew.js) is made once and synced: its thirty-minute toast and its Next ▸ watch. Its face is the band's second row
     (gm/band.js), which reads curfew().view().
   The two registry lines (app/features.js spine.rail, spine.curfew) are read live through host.on(id); since the night rebuild (N0) everything built
   is on, so both always run. The off paths stay until a later cleanup. Every 15 s the tick runs again (the curfew moves with the clock).

   host: { root() -> #gm-root, night() -> the night controller, now() -> ms, toast(msg, bad), layer(path, value) -> Promise (the show contract),
           on(id) -> bool (a line of the registry), callAftermath() (optional: the places' call, which the curfew's Call the Aftermath makes) }
   curfew() -> the curfew controller, or null while its line is off or before the first tick */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmSpine = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var cur = null, curfew = null, banded = false, lastBand, timer = null;
  function mod(name) { return W && W[name] ? W[name] : null; }
  var proxy = {
    root: function () { return cur && cur.root(); },
    night: function () { return cur && cur.night(); },
    now: function () { return cur && typeof cur.now === 'function' ? cur.now() : Date.now(); },
    toast: function (m, b) { if (cur && typeof cur.toast === 'function') cur.toast(m, b); },
    on: function () { return false; }
  };
  /* Call the Aftermath goes through the page's places when it has them; a page without falls back to the night alone (gm/curfew.js) */
  Object.defineProperty(proxy, 'callAftermath', { enumerable: true, get: function () { return cur && typeof cur.callAftermath === 'function' ? function () { return cur.callAftermath(); } : undefined; } });

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
    var C = mod('B68GmCurfew');
    var wantBand = host.on('spine.rail'), wantCurfew = !!C && host.on('spine.curfew');
    if (wantBand) { banded = true; band(true); }
    else if (banded) { banded = false; band(false); }
    if (wantCurfew) { if (!curfew) curfew = C.create(proxy); curfew.sync(); }
    else if (curfew) { curfew.destroy(); curfew = null; }
    /* the curfew moves with the clock: run again every 15 s while it is on */
    var any = wantBand || wantCurfew;
    if (any && !timer && typeof W.setInterval === 'function') timer = W.setInterval(function () { if (cur) tick(cur); }, 15000);
    else if (!any && timer) { W.clearInterval(timer); timer = null; }
  }
  /* the page went away (a new session replaces it) */
  function reset() {
    if (curfew) curfew.destroy();
    curfew = null; banded = false; lastBand = undefined; cur = null;
  }

  return { tick: tick, reset: reset, curfew: function () { return curfew; }, _state: function () { return { band: lastBand, curfew: !!curfew, timer: !!timer }; } };
});
