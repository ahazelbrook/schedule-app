/* gm/spine.js — the one hook the GM page calls for the spine tickets (1.1 the phase rail, 1.5 the curfew, 1.9 the first Workshop cuts).

   Window.B68GmSpine, and module.exports under Node. gm-page.js calls tick(host) from its top-bar redraw (which runs on every state arrival, so another GM
   device's phase change shows within one poll) and this file does the rest: each ticket's switch is read live, a switch that is off builds nothing and
   takes back what it set, and a switch that goes off in the Switchboard is put away on the next tick.

   host: { root() -> #gm-root, night() -> the night controller, now() -> ms, toast(msg, bad), layer(path, value) -> Promise (the show contract),
           on(id) -> bool (a switch), phoneCards(), setPhoneCards(on), mirrorOn(), toggleMirror() }

   Switches (app/features.js): spine.rail, spine.curfew, spine.workshop. With all three off tick() only checks and does nothing else.
   The curfew bar is drawn under the rail and is reached from the Next beat button, so it needs no other part of the page. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmSpine = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var cur = null, rail = null, curfew = null, ws = null, lastBand, timer = null;
  function mod(name) { return W && W[name] ? W[name] : null; }
  var proxy = {
    root: function () { return cur && cur.root(); },
    night: function () { return cur && cur.night(); },
    now: function () { return cur && typeof cur.now === 'function' ? cur.now() : Date.now(); },
    toast: function (m, b) { if (cur && typeof cur.toast === 'function') cur.toast(m, b); },
    on: function () { return false; }
  };
  function wsHost() {
    return { root: proxy.root, on: function () { return !!cur && cur.on('spine.workshop'); }, toast: proxy.toast,
      phoneCards: function () { return !!cur && cur.phoneCards(); }, setPhoneCards: function (v) { return cur && cur.setPhoneCards(v); },
      mirrorOn: function () { return !!cur && cur.mirrorOn(); }, toggleMirror: function () { return cur && cur.toggleMirror(); } };
  }

  function band(on) {
    var N = mod('B68GmNight'), n = cur.night(), want = on && N && n ? N.bandPhase(n.night ? n.night() : null) : null;
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
    var R = mod('B68GmPhaseRail'), C = mod('B68GmCurfew'), WF = mod('B68GmWorkshopFirst');
    var wantRail = !!R && host.on('spine.rail'), wantCurfew = !!C && host.on('spine.curfew'), wantWs = !!WF && host.on('spine.workshop');
    if (wantRail) { if (!rail) rail = R.create(proxy); rail.sync(); band(true); }
    else if (rail) { rail.destroy(); rail = null; band(false); }
    if (wantCurfew) { if (!curfew) curfew = C.create(proxy); curfew.sync(); }
    else if (curfew) { curfew.destroy(); curfew = null; }
    if (wantWs) { if (!ws) ws = WF.create(wsHost()); ws.sync(); }
    else if (ws) { ws.destroy(); ws = null; }
    /* budgets and the curfew move with the clock: re-draw every 15 s while one is on */
    var any = wantRail || wantCurfew;
    if (any && !timer && typeof W.setInterval === 'function') timer = W.setInterval(function () { if (cur) tick(cur); }, 15000);
    else if (!any && timer) { W.clearInterval(timer); timer = null; }
  }
  /* the page went away (a new session replaces it) */
  function reset() {
    if (rail) rail.destroy(); if (curfew) curfew.destroy(); if (ws) ws.destroy();
    rail = curfew = ws = null; lastBand = undefined; cur = null;
  }

  return { tick: tick, reset: reset, _state: function () { return { rail: !!rail, curfew: !!curfew, ws: !!ws, band: lastBand, timer: !!timer }; } };
});
