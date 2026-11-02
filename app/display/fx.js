/* B68Fx: the FX budget on the table display (suite ticket F7, switches fx.pause and fx.off). The ambient scenes are big, animated HTML files; this file
   spares the iPad's battery and heat WITHOUT touching a line inside them. A scene is a same-origin iframe, so the display page reaches in from outside:

     fx.pause   a scene that is not on show stops moving: the page is hidden, a spotlight covers the ambient, or the frame itself is faded out.
     fx.off     every ambient scene is held still, all the time (a still picture of the scene; the display page itself is not touched).

   "Stopped" is three things, all reversible and all done from here: CSS animations and transitions in the scene (a style element this file adds, driven by a
   class on the scene's <html>), requestAnimationFrame (calls are held in a queue and replayed on resume, so a canvas loop picks up where it was), and any
   <video>/<audio> the scene plays (paused, and played again only if they were playing). A scene timed by setInterval alone keeps its own clock: this does not
   pretend otherwise. With both switches off nothing is installed in any frame, and a frame this file touched is put back the moment they go off.

   API (Pure parts are also exported for node)
     want(flags, ctx) -> { paused, off }     flags { pause, off }; ctx { pageHidden, covered, frameHidden }
     apply(win, state)                        install (once) into a frame's window and set it to state { paused, off }; a window we cannot reach is left alone
     attach(container, { flags() -> { pause, off }, covered?() }) -> { sync(), destroy() }
   The frames are the iframes under `.dp-ambient` in container. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68Fx = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  var STYLE_ID = 'b68-fx-style', CLS_PAUSED = 'b68-fx-paused', CLS_OFF = 'b68-fx-off';
  var CSS = 'html.' + CLS_PAUSED + ' *, html.' + CLS_PAUSED + ' *::before, html.' + CLS_PAUSED + ' *::after { animation-play-state: paused !important; }\n' +
    'html.' + CLS_OFF + ' *, html.' + CLS_OFF + ' *::before, html.' + CLS_OFF + ' *::after { animation-play-state: paused !important; transition: none !important; }';

  function want(flags, ctx) {
    var f = flags || {}, c = ctx || {};
    var off = f.off === true;
    var paused = off || (f.pause === true && (c.pageHidden === true || c.covered === true || c.frameHidden === true));
    return { paused: paused, off: off };
  }

  /* the per-window record: { raf, cancel, held: [{ id, cb }], next, paused, media: [els we paused] } */
  function rec(win) {
    if (win.__b68fx) return win.__b68fx;
    var r = win.__b68fx = { raf: win.requestAnimationFrame, cancel: win.cancelAnimationFrame, held: [], next: -1, paused: false, media: [], off: false };
    if (typeof r.raf === 'function') {
      win.requestAnimationFrame = function (cb) {
        if (!r.paused) return r.raf.call(win, cb);
        var id = r.next--; r.held.push({ id: id, cb: cb }); return id;
      };
      win.cancelAnimationFrame = function (id) {
        for (var i = 0; i < r.held.length; i++) if (r.held[i].id === id) { r.held.splice(i, 1); return; }
        if (typeof r.cancel === 'function') r.cancel.call(win, id);
      };
    }
    return r;
  }
  function apply(win, state) {
    var r;
    try {
      var doc = win && win.document;
      if (!doc || !doc.documentElement) return false;
      var s = state || {};
      if (!win.__b68fx && !s.paused && !s.off) return true;       /* nothing asked and nothing installed: leave the frame exactly as it is */
      r = rec(win);
      if (!doc.getElementById(STYLE_ID) && doc.head) { var st = doc.createElement('style'); st.id = STYLE_ID; st.textContent = CSS; doc.head.appendChild(st); }
      var cl = doc.documentElement.classList;
      cl.toggle(CLS_PAUSED, !!s.paused); cl.toggle(CLS_OFF, !!s.off);
      r.off = !!s.off;
      if (s.paused && !r.paused) {
        r.paused = true;
        [].forEach.call(doc.querySelectorAll ? doc.querySelectorAll('video, audio') : [], function (m) { if (!m.paused) { try { m.pause(); r.media.push(m); } catch (e) { /* ignore */ } } });
      } else if (!s.paused && r.paused) {
        r.paused = false;
        var held = r.held; r.held = [];
        held.forEach(function (h) { r.raf.call(win, h.cb); });
        var med = r.media; r.media = [];
        med.forEach(function (m) { try { var p = m.play(); if (p && p.catch) p.catch(function () {}); } catch (e) { /* ignore */ } });
      }
      return true;
    } catch (e) { return false; }     /* a frame we cannot reach (cross-origin, gone): leave it */
  }

  function attach(container, opts) {
    var doc = container.ownerDocument || root.document, dead = false, timer = null, mo = null;
    var flags = opts && typeof opts.flags === 'function' ? opts.flags : function () { return {}; };
    function frameHidden(f) {
      try {
        var cs = doc.defaultView.getComputedStyle(f), p = f.parentNode && f.parentNode.nodeType === 1 ? doc.defaultView.getComputedStyle(f.parentNode) : null;
        return cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0 || !!(p && (+p.opacity === 0 || p.display === 'none' || p.visibility === 'hidden'));
      } catch (e) { return false; }
    }
    function sync() {
      if (dead) return;
      var fl = flags() || {}, frames = container.querySelectorAll ? container.querySelectorAll('.dp-ambient iframe') : [];
      var ctx = { pageHidden: !!doc.hidden, covered: !!(opts && typeof opts.covered === 'function' && opts.covered()) };
      [].forEach.call(frames, function (f) {
        var w = null; try { w = f.contentWindow; } catch (e) { w = null; }
        if (!w) return;
        ctx.frameHidden = fl.pause === true ? frameHidden(f) : false;
        apply(w, want(fl, ctx));
      });
    }
    function onLoad() { sync(); }
    container.addEventListener && container.addEventListener('load', onLoad, true);
    if (doc.addEventListener) doc.addEventListener('visibilitychange', sync);
    var layer = container.querySelector ? container.querySelector('.dp-ambient') : null;     /* only the ambient layer: the rest of the page changes all the time */
    if (root.MutationObserver && layer && layer.nodeType === 1) { mo = new root.MutationObserver(sync); try { mo.observe(layer, { childList: true }); } catch (e) { mo = null; } }
    timer = root.setInterval ? root.setInterval(sync, 1000) : null;
    sync();
    return {
      sync: sync,
      destroy: function () {
        dead = true;
        if (timer !== null && root.clearInterval) root.clearInterval(timer);
        if (mo) mo.disconnect();
        if (container.removeEventListener) container.removeEventListener('load', onLoad, true);
        if (doc.removeEventListener) doc.removeEventListener('visibilitychange', sync);
        [].forEach.call(container.querySelectorAll ? container.querySelectorAll('.dp-ambient iframe') : [], function (f) { try { apply(f.contentWindow, { paused: false, off: false }); } catch (e) { /* gone */ } });
      }
    };
  }
  return { want: want, apply: apply, attach: attach, CSS: CSS };
});
