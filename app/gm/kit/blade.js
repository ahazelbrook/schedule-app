/* gm/kit/blade.js: the Blade panel on the new desk (kit.desk) and the pitch cards (blade.pitches).
   Registered as an empty stub by KS01.1 of the kit and stage build; KS07 and KS19 fill it. It is in the kit-desk and blade-pitches bundles, each fetched only while its setting is on.
   Until it is filled it defines nothing and does nothing. ES5, as the files beside it: module.exports under Node. */
(function () {
  'use strict';
  var M = {};
  if (typeof module === 'object' && module && module.exports) module.exports = M;
})();

/* B68Pitches: KS18 begin */
/* Owned by KS18; KS07 and KS19 leave this block alone.
   The request side of Blade's pitches (setting blade.pitches). The Worker reads no settings, so while the setting is on the page says so on
   every tick: set(gm, true) routes the panel's gm.assistTick through gm.assistPitchTick({ pitch: true, seen }), and set(gm, false) puts
   the original back at once (a flip off needs no reload). Nothing here draws: the cards are KS19's, through onReply.
     set(gm, on)      hook or unhook (idempotent; a different gm object moves the hook)       on() -> boolean
     now()            Pitch now: { pitch, pitchNow, seen } at once; one request at a time (a second press while one waits gets the same
                      promise); rejects when the setting is off. A 429 (busy, or the cap reached) rejects with the Worker's error.
     remember(lines)  lines shown or dismissed (each answer's lines are remembered on arrival); the newest SEEN_MAX go back as `seen`
     seen()           a copy of that list           onReply(fn) -> unsubscribe: fn(answer) for every answer that carries `pitch`
   A pitch never acts: nothing here reaches the iPad or a phone. ES5; window.B68Pitches in the page, module.exports.B68Pitches under Node. */
(function (root) {
  'use strict';
  var SEEN_MAX = 12;
  function make() {
    var hooked = null, orig = null, wrapped = null, pending = null, seenList = [], subs = [];
    function remember(lines) {
      (lines || []).forEach(function (l) {
        var t = typeof l === 'string' ? l.replace(/\s+/g, ' ').trim().slice(0, 200) : '';
        if (!t) return;
        var i = seenList.indexOf(t); if (i >= 0) seenList.splice(i, 1);
        seenList.push(t);
      });
      if (seenList.length > SEEN_MAX) seenList = seenList.slice(-SEEN_MAX);
    }
    function emit(res) {
      if (!res || !res.pitch || !res.pitch.items) return res;
      remember(res.pitch.items.map(function (p) { return p && p.line; }));
      subs.slice().forEach(function (fn) { try { fn(res); } catch (e) { if (root && root.console) root.console.error(e); } });
      return res;
    }
    function unhook() {
      if (hooked && hooked.assistTick === wrapped) hooked.assistTick = orig;
      hooked = null; orig = null; wrapped = null;
    }
    function set(gm, on) {
      if (!on || !gm || typeof gm.assistPitchTick !== 'function' || typeof gm.assistTick !== 'function') { unhook(); return false; }
      if (hooked === gm && gm.assistTick === wrapped) return true;
      unhook();
      var g = gm;
      hooked = g; orig = g.assistTick;
      wrapped = function (after, npc, rolled) { return g.assistPitchTick({ pitch: true, seen: seenList.slice() }, after, npc, rolled).then(emit); };
      g.assistTick = wrapped;
      return true;
    }
    function now() {
      if (!hooked) return Promise.reject(new Error('pitches are off'));
      if (pending) return pending;
      var g = hooked;
      pending = Promise.resolve().then(function () { return g.assistPitchTick({ pitch: true, pitchNow: true, seen: seenList.slice() }); }).then(emit);
      var clear = function () { pending = null; };
      pending.then(clear, clear);
      return pending;
    }
    return {
      set: set, now: now, remember: remember,
      on: function () { return !!hooked; },
      seen: function () { return seenList.slice(); },
      onReply: function (fn) { if (typeof fn !== 'function') return function () {}; subs.push(fn); return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); }; },
    };
  }
  var P = make();
  P.make = make;
  if (root && !root.B68Pitches) root.B68Pitches = P;
  if (typeof module === 'object' && module && module.exports) module.exports.B68Pitches = P;
})(typeof window !== 'undefined' ? window : null);
/* B68Pitches: KS18 end */
