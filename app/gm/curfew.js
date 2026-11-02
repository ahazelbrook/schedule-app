/* gm/curfew.js — the curfew (suite ticket 1.5, switch spine.curfew).

   Thirty minutes before the curfew the GM is told once (a toast). At the curfew a full-width "Call the Aftermath" bar stands under the rail; the next tap
   on it, or the next press of the page's Next beat button, moves the night to the Aftermath and tells the page (a `b68:aftermath` event on the window,
   which the Aftermath ticket listens for). It can be snoozed once, for ten minutes. The curfew time is the night's own (gm/night.js curfewAt, from the
   prep note's `curfew:` line); with none set, before a phase is entered, or in the Aftermath already, nothing happens.

   Window.B68GmCurfew, and module.exports under Node (the pure part). GM side only: nothing here is ever sent to a player.

   PURE
     curfewMs(night, nowMs) -> ms | null      today's curfew time (the next day when it falls before the night began, as a past-midnight curfew does)
     state(night, nowMs, snooze) -> 'idle' | 'warn' | 'due' | 'snoozed'      snooze: { key, until, used } | null
     snoozed(snooze, key, nowMs) -> the snooze after one use, or null when it was used already
   DOM
     create(host) -> { sync(force?), destroy(), call(), snooze() }
       host: { root(), night(), now(), toast(msg), store?: { get(), set(v) } } */
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
  function state(night, nowMs, snooze) {
    var n = isObj(night) ? night : {};
    if (!n.phase || n.phase === 'after') return 'idle';
    var t = curfewMs(n, nowMs); if (t === null) return 'idle';
    if (nowMs >= t) return isObj(snooze) && snooze.key === n.curfewAt && snooze.until > nowMs ? 'snoozed' : 'due';
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
    var store = host.store || memStore(), el = null, sig = '', alive = true, listener = null, rootEl = null;
    function r() { var x = host.root && host.root(); return x && x.ownerDocument ? x : null; }
    function nightNow() { var N = host.night && host.night(); return N && typeof N.night === 'function' ? N.night() : null; }
    function now() { return typeof host.now === 'function' ? host.now() : Date.now(); }
    function mem() { var m = store.get(); return isObj(m) ? m : {}; }
    function call() {
      var N = host.night && host.night(); if (!N || typeof N.enter !== 'function') return false;
      var ok = N.enter('after'); if (ok === false) return false;
      store.set(Object.assign(mem(), { snooze: null }));
      if (W && typeof W.dispatchEvent === 'function' && typeof W.CustomEvent === 'function') W.dispatchEvent(new W.CustomEvent('b68:aftermath', { detail: { at: now() } }));
      if (typeof host.toast === 'function') host.toast('Aftermath.');
      sync(true);
      return true;
    }
    function snooze() {
      var n = nightNow(); if (!n) return false;
      var m = mem(), s = snoozed(m.snooze, n.curfewAt, now()); if (!s) return false;
      store.set(Object.assign(m, { snooze: s })); sync(true); return true;
    }
    function wire() {
      var root = r(); if (!root || rootEl === root) return;
      if (rootEl && listener) rootEl.removeEventListener('click', listener, true);
      rootEl = root;
      /* capture phase: while the bar is up, Next beat means "go to the Aftermath" */
      listener = function (ev) {
        var t = ev.target; if (!alive || !t || !t.closest) return;
        if (t.closest('[data-gm="beat-next"]') && state(nightNow(), now(), mem().snooze) === 'due') { ev.preventDefault(); ev.stopImmediatePropagation(); call(); }
      };
      root.addEventListener('click', listener, true);
    }
    function sync(force) {
      var root = r(); if (!root) return;
      wire();
      var n = nightNow(), m = mem(), st = state(n, now(), m.snooze), key = n && n.curfewAt || '';
      if (st === 'warn' && m.warned !== key) {
        store.set(Object.assign(m, { warned: key }));
        if (typeof host.toast === 'function') host.toast('Curfew is at ' + key + ': thirty minutes.');
      }
      var rail = root.querySelector('#gm-phaserail');
      if (st !== 'due') { if (el && el.parentNode) el.parentNode.removeChild(el); el = null; sig = ''; return; }
      var used = isObj(m.snooze) && m.snooze.key === key && m.snooze.used === true;
      var s = 'due|' + used;
      if (!force && el && el.parentNode && s === sig) return;
      sig = s;
      if (!el) {
        el = root.ownerDocument.createElement('div'); el.className = 'gm-curfew'; el.setAttribute('role', 'alert');
        el.addEventListener('click', function (ev) {
          var b = ev.target && ev.target.closest ? ev.target.closest('[data-curfew]') : null; if (!b) return;
          if (b.getAttribute('data-curfew') === 'call') call(); else snooze();
        });
      }
      el.innerHTML = '<button type="button" class="gm-curfew-call" data-curfew="call">Call the Aftermath</button>' +
        (used ? '' : '<button type="button" class="gm-curfew-snooze" data-curfew="snooze" title="Ask again in ten minutes (once)">Snooze 10 min</button>');
      if (!el.parentNode) { if (rail && rail.parentNode) rail.parentNode.insertBefore(el, rail.nextSibling); else root.insertBefore(el, root.firstChild); }
    }
    function destroy() {
      alive = false;
      if (rootEl && listener) rootEl.removeEventListener('click', listener, true);
      if (el && el.parentNode) el.parentNode.removeChild(el);
      el = null; rootEl = null;
    }
    return { sync: sync, destroy: destroy, call: call, snooze: snooze };
  }

  return { WARN_MS: WARN_MS, SNOOZE_MS: SNOOZE_MS, curfewMs: curfewMs, state: state, snoozed: snoozed, create: create };
});
