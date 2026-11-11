/* ui/kit-flag.js: the kit flag (B68Kit), the one kit file in the core bundle (the kit and stage build: KS01.2; the route rule and the layers, KS01.5).

   It says which new look a screen runs, as data-kit on <html>: a space-separated list of tokens, so a stylesheet can say
   :root[data-kit~="desk"]. Each token belongs to one route, and its route sets it from its own setting, where the settings are first known:
     desk    #gm        the GM page     gm-page.js renderBar(): the first draw, every arrival of the GM state, every Settings change
     stage   #display   the iPad        display-page.js onFeatures: every display poll
     phone   #c/<id>    a live sheet    tracker.js render(): every redraw, which follows every campaign arrival, once the campaign has said
   This file knows no setting ids: the routes read their settings (app/features.js) and hand over a yes or a no.

   A document paints only the token of the route it is on now (location.hash, read at every change and on every hashchange). Home, #t,
   #print, #rules, #cast and the creator paint none. A token whose route is not on screen is kept, not painted: leaving #gm for a sheet
   takes the desk off <html>, and coming back puts it on again. A GM page left running under a sheet may still say desk; that moves the
   memory, not this page's look. The GM drawer's sheet frames are documents of their own: what they paint never reaches the GM page.

   The first token this page paints also puts the old stylesheets into the cascade layer `old` (B68Load.layerOld(), app/routes.js; Gate 1
   approach A1), so the kit's unlayered rules win; the page stays layered until it is reloaded, whatever is turned off meanwhile (the
   same look: nothing old changes order inside the layer).

   Turning the current route's token on also asks for its bundle, B68Load.need('kit-' + token) (app/routes.js), which brings the shared UI
   kit (kit-ui) first. A token that is off, or not this route's, fetches nothing. A failed fetch is asked again on a later change, at most
   every 30 seconds.

   Memory: localStorage b68.kit holds the tokens that are on (set by any route, merged one token at a time, so the laptop's tabs and frames
   keep each other's). At load, and on arriving at a route by hashchange, that route's token comes back from the memory (painted, and its
   bundle asked for) unless the route has already said otherwise in this document; the route's own set() then confirms or undoes it. The
   route check never writes the memory. The key is written only when a token turns on, and removed when the last one turns off: with every
   setting off it is never written. Storage may be blocked (a private window, a sandboxed frame): the memory then lasts for the visit only.
   So a kit bundle may arrive BEFORE the route's own bundle (gm, display): a kit file only defines its module when it loads, and reads other
   modules only when it is called.

   "No flash" holds for the attribute only. It comes back when this file runs (the end of index.html's body: in Chromium a few tens of
   milliseconds after the first paint of the loading screen), and the kit's own files arrive after that.

   Window.B68Kit in the browser, and module.exports under Node (checks/runtime/kit-flag.test.mjs).
     on(name) -> bool        the token is painted in this document now (it is on, and this is its route)
     set(name, on) -> bool   what the route says: the memory, the attribute and the bundle follow; true when the value changed. An unknown
                             name does nothing
     onChange(fn) -> off()   fn({ name, on, ready }) whenever on(name) changes in this document, and once more with ready: true when that
                             token's bundle has loaded. It does NOT replay: a listener that subscribes late reads on(name) and ready(name)
                             when it subscribes
     ready(name) -> bool     on(name), and the token's bundle has loaded
     route() -> name|null    the token of the route this document is on now
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
  var want = {}, shown = {}, loaded = {}, asking = {}, retryAt = {}, subs = [], mem = null;

  function known(n) { return NAMES.indexOf(n) >= 0; }
  function html() { var d = W && W.document; return d && d.documentElement && typeof d.documentElement.setAttribute === 'function' ? d.documentElement : null; }
  function now() { return Date.now(); }
  function store() { try { return W && W.localStorage ? W.localStorage : null; } catch (e) { return null; } }
  function tokens(v) {
    var out = [];
    String(v || '').split(/\s+/).forEach(function (t) { if (known(t) && out.indexOf(t) < 0) out.push(t); });
    return out;
  }
  /* the token of a route: #gm desk, #display stage, a sheet (#c/<id>) phone, anything else none */
  function routeOf(h) { h = String(h || ''); return h === '#gm' ? 'desk' : h === '#display' ? 'stage' : h.indexOf('#c/') === 0 ? 'phone' : null; }
  function route() { var h = ''; try { h = String(W && W.location && W.location.hash || ''); } catch (e) { h = ''; } return routeOf(h); }
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
  function on(name) { return known(name) && want[name] === true && route() === name; }
  function ready(name) { return on(name) && loaded[name] === true; }
  function paint() {
    var el = html(); if (!el) return;
    var t = NAMES.filter(on);
    if (t.length) {
      if (W && W.B68Load && typeof W.B68Load.layerOld === 'function') W.B68Load.layerOld();     /* the old sheets into layer(old), once (routes.js) */
      if (el.getAttribute && el.getAttribute(ATTR) === t.join(' ')) return;
      el.setAttribute(ATTR, t.join(' '));
    }
    else if (el.hasAttribute && el.hasAttribute(ATTR)) el.removeAttribute(ATTR);
  }
  function emit(ev) {
    subs.slice().forEach(function (fn) { try { fn(ev); } catch (e) { if (W && W.console) W.console.error(e); } });
  }
  /* the token's bundle, once; a failure is forgotten so a later change asks again (not sooner than RETRY_MS) */
  function fetchFor(name) {
    if (loaded[name] || asking[name] || now() < (retryAt[name] || 0)) return;
    var L = W && W.B68Load; if (!L || typeof L.need !== 'function') return;
    asking[name] = true;
    var p;
    try { p = L.need('kit-' + name); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(function () {
      asking[name] = false; loaded[name] = true;
      if (on(name)) emit({ name: name, on: true, ready: true });
    }, function () { asking[name] = false; retryAt[name] = now() + RETRY_MS; });
  }
  /* the route now: its token from the memory when the route has not spoken in this document; paint; its bundle; tell what moved */
  function sync() {
    var r = route();
    if (r && want[r] === undefined && recall().indexOf(r) >= 0) want[r] = true;
    paint();
    if (r && want[r] === true) fetchFor(r);
    NAMES.forEach(function (n) { var o = on(n); if ((shown[n] === true) !== o) { shown[n] = o; emit({ name: n, on: o, ready: ready(n) }); } });
  }

  function set(name, v) {
    if (!known(name)) return false;
    v = v === true;
    var changed = (want[name] === true) !== v;
    want[name] = v;
    if (changed) remember(name, v);
    sync();
    return changed;
  }
  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    subs.push(fn);
    return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
  }

  /* at load, and on every route change: this route's token (see the header) */
  if (html()) {
    sync();
    if (W && typeof W.addEventListener === 'function') W.addEventListener('hashchange', sync);
  }

  return { NAMES: NAMES.slice(), on: on, set: set, onChange: onChange, ready: ready, route: route };
});
