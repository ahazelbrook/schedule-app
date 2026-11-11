/* ui/kit-flag.js: the kit flag (B68Kit), the one kit file in the core bundle (the kit and stage build, KS01.2).

   It says which new look a screen runs, as data-kit on <html>: a space-separated list of tokens, so a stylesheet can say
   :root[data-kit~="desk"]. Each route sets its own token, from its own setting, where the settings are first known:
     desk    the GM page         gm-page.js renderBar(): the first draw, every arrival of the GM state, every Settings change
     stage   the iPad display    display-page.js onFeatures: every display poll
     phone   a live sheet        tracker.js render(): every redraw, which follows every campaign arrival, once the campaign has said
   This file knows no setting ids: the routes read their settings (app/features.js) and hand over a yes or a no.

   Turning a token on also asks for its bundle, B68Load.need('kit-' + token) (app/routes.js), which brings the shared UI kit (kit-ui)
   first. A token that is off fetches nothing. A failed fetch is asked again by a later set(token, true), at most every 30 seconds.

   Memory: localStorage b68.kit holds the tokens that are on, so a reload puts the attribute back and asks for the bundle before the
   route draws (no flash); the route's own set() then confirms or undoes it. Only this route's own token comes back at load (#gm desk,
   #display stage, any other route phone), so a tab or a sheet frame on the same laptop never takes another screen's look. The key is
   written only when a token turns on, and removed when the last one turns off: with every setting off it is never written. Storage
   may be blocked (a private window, a sandboxed frame): the memory then lasts for the visit only.
   So a kit bundle may arrive BEFORE the route's own bundle (gm, display): a kit file only defines its module when it loads, and
   reads other modules only when it is called.

   Window.B68Kit in the browser, and module.exports under Node (checks/runtime/kit-flag.test.mjs).
     on(name) -> bool        the token is on in this document (restored at load, or set)
     set(name, on) -> bool   the attribute, the memory and the bundle follow; true when the value changed. An unknown name does nothing
     onChange(fn) -> off()   fn({ name, on, ready }) after each change, and once more with ready: true when that token's bundle has loaded
     ready(name) -> bool     the token is on and its bundle has loaded
     NAMES                   ['desk', 'stage', 'phone'] */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68Kit = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var KEY = 'b68.kit', ATTR = 'data-kit', RETRY_MS = 30000;
  var NAMES = ['desk', 'stage', 'phone'];
  var ROUTE = { '#gm': 'desk', '#display': 'stage' };     /* any other route: phone */
  var state = {}, loaded = {}, asking = {}, retryAt = {}, subs = [], mem = null;

  function known(n) { return NAMES.indexOf(n) >= 0; }
  function html() { var d = W && W.document; return d && d.documentElement && typeof d.documentElement.setAttribute === 'function' ? d.documentElement : null; }
  function now() { return Date.now(); }
  function store() { try { return W && W.localStorage ? W.localStorage : null; } catch (e) { return null; } }
  function tokens(v) {
    var out = [];
    String(v || '').split(/\s+/).forEach(function (t) { if (known(t) && out.indexOf(t) < 0) out.push(t); });
    return out;
  }
  /* the remembered tokens: storage, else this visit's own copy (blocked storage) */
  function recall() {
    var ls = store();
    if (ls) { try { return tokens(ls.getItem(KEY)); } catch (e) { /* blocked: the visit's copy */ } }
    return tokens(mem);
  }
  /* one token in or out of the memory, the others kept (another tab's); nothing is written when nothing moves */
  function remember(name, on) {
    var list = recall(), at = list.indexOf(name);
    if (on ? at >= 0 : at < 0) return;
    if (on) list.push(name); else list.splice(at, 1);
    list = NAMES.filter(function (n) { return list.indexOf(n) >= 0; });
    mem = list.join(' ');
    var ls = store(); if (!ls) return;
    try { if (list.length) ls.setItem(KEY, mem); else ls.removeItem(KEY); } catch (e) { /* blocked: the visit's copy holds it */ }
  }
  function paint() {
    var el = html(); if (!el) return;
    var on = NAMES.filter(function (n) { return state[n] === true; });
    if (on.length) el.setAttribute(ATTR, on.join(' '));
    else if (el.hasAttribute && el.hasAttribute(ATTR)) el.removeAttribute(ATTR);
  }
  function emit(ev) {
    subs.slice().forEach(function (fn) { try { fn(ev); } catch (e) { if (W && W.console) W.console.error(e); } });
  }
  /* the token's bundle, once; a failure is forgotten so a later set(name, true) asks again (not sooner than RETRY_MS) */
  function fetchFor(name) {
    if (loaded[name] || asking[name] || now() < (retryAt[name] || 0)) return;
    var L = W && W.B68Load; if (!L || typeof L.need !== 'function') return;
    asking[name] = true;
    var p;
    try { p = L.need('kit-' + name); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(function () {
      asking[name] = false; loaded[name] = true;
      if (state[name] === true) emit({ name: name, on: true, ready: true });
    }, function () { asking[name] = false; retryAt[name] = now() + RETRY_MS; });
  }

  function on(name) { return known(name) && state[name] === true; }
  function ready(name) { return on(name) && loaded[name] === true; }
  function set(name, want) {
    if (!known(name)) return false;
    want = want === true;
    if (want) fetchFor(name);
    if ((state[name] === true) === want) return false;
    state[name] = want;
    paint(); remember(name, want);
    emit({ name: name, on: want, ready: ready(name) });
    return true;
  }
  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    subs.push(fn);
    return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
  }

  /* at load: this route's own token, when it was on last time, and its bundle at once (before the route's own bundle: see the header) */
  (function restore() {
    if (!html()) return;
    var h = ''; try { h = String(W.location && W.location.hash || ''); } catch (e) { h = ''; }
    var mine = ROUTE[h] || 'phone';
    if (recall().indexOf(mine) >= 0) { state[mine] = true; paint(); fetchFor(mine); }
  })();

  return { NAMES: NAMES.slice(), on: on, set: set, onChange: onChange, ready: ready };
});
