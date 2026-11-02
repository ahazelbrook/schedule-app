/* B68GmOnAir: the GM page's mirror of the ON AIR lamp (suite ticket A6, switch ai.onair; the iPad side is app/display/onair.js). Pure reading of the
   listening document the page already polls (GET /api/gm/stt): nothing here writes, asks the server or touches the clock; the caller passes the time.

   The iPad reports status.pausedUntil (ms; 0 when it is not off the record) along with its state. This turns that into the words the page shows:
     live      the GM wants listening, the iPad says it is listening, and its report is fresh (40 s)      -> "ON AIR"
     paused    live, and pausedUntil is still ahead                                                         -> "Off the record 4:32"
   A stale or absent report is neither: the lamp never claims a mic that nobody has heard from.

   API (also module.exports under Node)
     state(doc, nowMs) -> { live, paused, remaining }       word(st) -> '' | 'ON AIR' | 'Off the record 4:32'
     chip(doc, nowMs)  -> html for the Listening box        suffix(doc, nowMs) -> text for the bar's pill ('' or ' · ON AIR')
     tick(rootEl, doc, nowMs) -> true while a countdown still runs (the page keeps its 1 s timer), false when it can stop
   The chip is `#gm-onair`, the pill's text `#gm-bar-air`: tick() rewrites those two and nothing else. */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68GmOnAir = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var FRESH_MS = 40000;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function state(doc, nowMs) {
    var d = isObj(doc) ? doc : {}, st = isObj(d.status) ? d.status : {}, at = Date.parse(st.at);
    var live = d.want === 'on' && st.state === 'listening' && isFinite(at) && nowMs - at <= FRESH_MS;
    var until = Number.isInteger(st.pausedUntil) ? st.pausedUntil : 0;
    var paused = live && until > nowMs;
    return { live: live, paused: paused, remaining: paused ? until - nowMs : 0 };
  }
  function clock(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + (s % 60 < 10 ? '0' : '') + (s % 60); }
  function word(st) { return st.paused ? 'Off the record ' + clock(st.remaining) : st.live ? 'ON AIR' : ''; }
  function chip(doc, nowMs) {
    var st = state(doc, nowMs), w = word(st);
    return w ? ' <span class="gm-stt-on" id="gm-onair" data-state="' + (st.paused ? 'off' : 'on') + '" role="status">' + esc(w) + '</span>' : '';
  }
  function suffix(doc, nowMs) {
    var w = word(state(doc, nowMs));
    return w ? ' · <span id="gm-bar-air">' + esc(w) + '</span>' : '';
  }
  function tick(rootEl, doc, nowMs) {
    var st = state(doc, nowMs), w = word(st);
    if (rootEl && rootEl.querySelector) {
      ['#gm-onair', '#gm-bar-air'].forEach(function (sel) { var e = rootEl.querySelector(sel); if (e && e.textContent !== w) e.textContent = w; });
    }
    return st.paused;
  }
  return { state: state, word: word, chip: chip, suffix: suffix, tick: tick, FRESH_MS: FRESH_MS };
});
