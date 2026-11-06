/* gm/curfew.js — the curfew (suite ticket 1.5): the rules. Its face is the band's second row (gm/band.js).

   Thirty minutes before the curfew the GM is told once (a toast). At the curfew the band's second row turns alarm red and offers Call the Aftermath,
   Keep running and Snooze 10 min (once). Call the Aftermath goes through host.callAftermath() (the places: the night enters the Aftermath, the page
   goes to the Aftermath place and its show starts); a page without it enters the Aftermath on the night alone. While the curfew is due and not kept,
   the page's Next ▸ beat button means "go to the Aftermath" too. The curfew time is the night's own (gm/night.js curfewAt, from the prep note's
   `curfew:` line); with none set, before a phase is entered, or in the Aftermath already, nothing happens.

   Window.B68GmCurfew, and module.exports under Node (the pure part). GM side only: nothing here is ever sent to a player.

   PURE
     curfewMs(night, nowMs) -> ms | null      today's curfew time (the next day when it falls before the night began, as a past-midnight curfew does)
     state(night, nowMs, snooze) -> 'idle' | 'warn' | 'due' | 'snoozed'      snooze: { key, until, used } | null
     snoozed(snooze, key, nowMs) -> the snooze after one use, or null when it was used already
   CONTROLLER
     create(host) -> { sync(), view(), call(), keep(), snooze(), destroy() }
       host: { root() -> the element whose clicks are watched for Next ▸, night() -> the night controller, now() -> ms, toast(msg),
               callAftermath() (optional), store?: { get(), set(v) } }
       sync()   the thirty-minute toast (once a night) and the Next ▸ watch; call it on every tick
       view()   -> { state: 'idle' | 'warn' | 'due' | 'kept' | 'snoozed', at: 'HH:MM' | '', ms: the curfew | null, used: the snooze is spent tonight } */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmCurfew = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var WARN_MS = 30 * 60000, SNOOZE_MS = 10 * 60000, KEY = 'b68.gm.curfew';
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function nightMod() { return W && W.B68GmNight ? W.B68GmNight : (typeof require === 'function' ? tryReq() : null); }
  function tryReq() { try { return require('./night.js'); } catch (e) { return null; } }

  function curfewMs(night, nowMs) {
    var N = nightMod(), n = isObj(night) ? night : {};
    if (!N || !n.curfewAt) return null;
    var t = N.clockMs(n.curfewAt, nowMs); if (t === null) return null;
    var first = null;
    if (isObj(n.phases)) Object.keys(n.phases).forEach(function (k) { var s = n.phases[k] && n.phases[k].start; if (typeof s === 'number' && (first === null || s < first)) first = s; });
    if (first !== null && t < first) t += 864e5;
    return t;
  }
  /* the key the memory (warned, snoozed, kept) is filed under: the curfew time AND the night it belongs to (when its first phase began), so next week's same curfew starts clean */
  function nightKey(night) {
    var n = isObj(night) ? night : {}, first = null;
    if (isObj(n.phases)) Object.keys(n.phases).forEach(function (k) { var s = n.phases[k] && n.phases[k].start; if (typeof s === 'number' && (first === null || s < first)) first = s; });
    return n.curfewAt ? n.curfewAt + '@' + (first === null ? '' : first) : '';
  }
  function state(night, nowMs, snooze) {
    var n = isObj(night) ? night : {};
    if (!n.phase || n.phase === 'after') return 'idle';
    var t = curfewMs(n, nowMs); if (t === null) return 'idle';
    if (nowMs >= t) return isObj(snooze) && snooze.key === nightKey(n) && snooze.until > nowMs ? 'snoozed' : 'due';
    return nowMs >= t - WARN_MS ? 'warn' : 'idle';
  }
  function snoozed(snooze, key, nowMs) {
    if (isObj(snooze) && snooze.key === key && snooze.used) return null;
    return { key: key, until: nowMs + SNOOZE_MS, used: true };
  }

  function memStore() {
    var v = null, ls = null;
    try { ls = W && W.localStorage; } catch (e) {}
    return {
      get: function () { if (ls) { try { return JSON.parse(ls.getItem(KEY)); } catch (e) { return null; } } return v; },
      set: function (x) { v = x; if (ls) { try { ls.setItem(KEY, JSON.stringify(x)); } catch (e) {} } }
    };
  }

  function create(host) {
    var store = host.store || memStore(), alive = true, listener = null, rootEl = null;
    function r() { var x = host.root && host.root(); return x && typeof x.addEventListener === 'function' ? x : null; }
    function nightNow() { var N = host.night && host.night(); return N && typeof N.night === 'function' ? N.night() : null; }
    function now() { return typeof host.now === 'function' ? host.now() : Date.now(); }
    function mem() { var m = store.get(); return isObj(m) ? m : {}; }
    /* Call the Aftermath: the places' own call when the page has it (the night, the place and the show), else the night alone */
    function call() {
      var N = host.night && host.night();
      store.set(Object.assign(mem(), { snooze: null }));
      if (typeof host.callAftermath === 'function') { if (host.callAftermath() === false) return false; }
      else if (!N || typeof N.enter !== 'function' || N.enter('after') === false) return false;
      if (typeof host.toast === 'function') host.toast('Aftermath.');
      return true;
    }
    function snooze() {
      var n = nightNow(); if (!n) return false;
      var m = mem(), s = snoozed(m.snooze, nightKey(n), now()); if (!s) return false;
      store.set(Object.assign(m, { snooze: s })); return true;
    }
    /* the state as the band sees it: "Keep running" turns a due curfew into kept, and Next ▸ is left alone */
    function live() { var n = nightNow(), m = mem(), s = state(n, now(), m.snooze); return s === 'due' && m.kept === nightKey(n) ? 'kept' : s; }
    function keep() { var n = nightNow(); if (!n) return false; store.set(Object.assign(mem(), { kept: nightKey(n) })); return true; }
    function view() {
      var n = nightNow(), m = mem(), key = nightKey(n);
      return { state: live(), at: n && n.curfewAt || '', ms: curfewMs(n, now()), used: isObj(m.snooze) && m.snooze.key === key && m.snooze.used === true };
    }
    function wire() {
      var root = r(); if (!root || rootEl === root) return;
      if (rootEl && listener && typeof rootEl.removeEventListener === 'function') rootEl.removeEventListener('click', listener, true);
      rootEl = root;
      /* capture phase: while the curfew is due, Next ▸ means "go to the Aftermath" */
      listener = function (ev) {
        var t = ev.target; if (!alive || !t || !t.closest) return;
        if (t.closest('[data-gm="beat-next"]') && live() === 'due') { ev.preventDefault(); if (ev.stopImmediatePropagation) ev.stopImmediatePropagation(); call(); }
      };
      root.addEventListener('click', listener, true);
    }
    /* the thirty-minute toast, once a night, and the Next ▸ watch */
    function sync() {
      if (!alive) return;
      wire();
      var n = nightNow(), m = mem(), st = state(n, now(), m.snooze), key = nightKey(n);
      if (st === 'warn' && m.warned !== key) {
        store.set(Object.assign(m, { warned: key }));
        if (typeof host.toast === 'function') host.toast('Curfew is at ' + (n && n.curfewAt || '') + ': thirty minutes.');
      }
    }
    function destroy() {
      alive = false;
      if (rootEl && listener && typeof rootEl.removeEventListener === 'function') rootEl.removeEventListener('click', listener, true);
      rootEl = null; listener = null;
    }
    return { sync: sync, view: view, destroy: destroy, call: call, snooze: snooze, keep: keep };
  }

  return { WARN_MS: WARN_MS, SNOOZE_MS: SNOOZE_MS, curfewMs: curfewMs, nightKey: nightKey, state: state, snoozed: snoozed, create: create };
});
