/* B68Layers: the lasting layers of the show contract (suite W0.3) on the table display, and THE DATA CHANNEL to the HTML scenes.
   The server serves them as a top-level `layers` ({ band: { phase, security, faces, onair }, scene: { filter, layout, mode },
   data: { countdown, credits, previously } }, functions/_lib/show.js), already joined to the NPCs revealed now; absent means none.

   THE CHANNEL (decided: postMessage, not the query string). An ambient scene is an iframe at a fixed URL that the service worker caches
   per URL; changing the URL to pass a countdown, three faces or the credits would reload the scene (a flash on the table) and defeat the
   cache. So the page posts to the frame, as it already does for b68:crew and b68:score:
       { type: 'b68:data', phase, security, onair, filter, layout, mode,
         countdown: { to (epoch ms on the iPad's own clock), label } | null,
         faces: [{ name, role } | { pcId }], credits: [{ name, role }], previously: [{ name, role }] }
   sent when a scene loads, when it says { type: 'b68:ready' }, and on every change. A scene listens for 'message' from window.parent and
   ignores any other type. No NPC id, spec or note is in it: names and roles of revealed NPCs only.

   On the page: data-* attributes on the display root (data-band-phase, data-band-security, data-band-onair, data-scene-filter,
   data-scene-layout, data-scene-mode) for CSS, and a slim strip (phase, security, faces, ON AIR) that reads those layers.
   API: attach(container, { skew() }) -> { apply(layers), message(), sceneLoaded(id), destroy() }; clean(layers) -> the checked layers.
   Pure parts (clean, message) have no DOM and are also exported for node tests. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68Layers = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function text(v, max) { if (typeof v !== 'string') return ''; var t = v.replace(/\s+/g, ' ').trim(); return t.length <= max ? t : ''; }
  function whole(v, lo, hi) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= lo && v <= hi ? v : undefined; }
  function oneOf(v, list) { return typeof v === 'string' && list.indexOf(v) >= 0 ? v : undefined; }
  var PHASES = ['pb', 'plan', 'score', 'after'];
  var PHASE_LABEL = { pb: 'PB', plan: 'Plan', score: 'Score', after: 'Aftermath' };
  var SECURITY = 5;

  function rows(list, max) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.slice(0, max).forEach(function (c) { if (isObj(c)) { var n = text(c.name, 120); if (n) out.push({ name: n, role: text(c.role, 120) }); } });
    return out;
  }
  /* clean(layers) -> { phase, security, onair, filter, layout, mode, countdown, faces, credits, previously } with every field present (null / [] when unset) */
  function clean(raw) {
    var l = isObj(raw) ? raw : {}, b = isObj(l.band) ? l.band : {}, s = isObj(l.scene) ? l.scene : {}, d = isObj(l.data) ? l.data : {};
    var faces = [];
    if (Array.isArray(b.faces)) b.faces.slice(0, 3).forEach(function (f) {
      if (!isObj(f)) return;
      var n = text(f.name, 120);
      if (n) faces.push({ name: n, role: text(f.role, 120) });
      else if (typeof f.pcId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(f.pcId)) faces.push({ pcId: f.pcId });
    });
    var cd = isObj(d.countdown) && whole(d.countdown.to, 1, 8.64e15) ? { to: d.countdown.to, label: text(d.countdown.label, 40) } : null;
    return {
      phase: oneOf(b.phase, PHASES) || null, security: whole(b.security, 0, SECURITY - 1) === undefined ? null : b.security, onair: b.onair === true,
      filter: oneOf(s.filter, ['flashback']) || null, layout: oneOf(s.layout, ['montage']) || null, mode: oneOf(s.mode, ['start', 'aftermath']) || null,
      countdown: cd, faces: faces, credits: rows(d.credits, 30), previously: rows(d.previously, 12)
    };
  }
  /* the message a scene receives (`countdown.to` is already in THIS page's clock: the server's epoch less its skew, rounded to 250 ms so a jittery skew does not re-post; a scene computes to - Date.now()) */
  function message(state) {
    return { type: 'b68:data', phase: state.phase, security: state.security, onair: state.onair, filter: state.filter, layout: state.layout, mode: state.mode,
      countdown: state.countdown, faces: state.faces, credits: state.credits, previously: state.previously };
  }
  var ATTRS = { 'data-band-phase': 'phase', 'data-band-security': 'security', 'data-scene-filter': 'filter', 'data-scene-layout': 'layout', 'data-scene-mode': 'mode' };

  function attach(container, opts) {
    var doc = container.ownerDocument || root.document, state = clean(null), dead = false, strip = null;
    /* nothing set is nothing said: a scene is sent b68:data only once a layer is (or was) set, so with no layers an ambient scene's messages are exactly what they were */
    function isEmpty(s) { return s.phase === null && s.security === null && !s.onair && s.filter === null && s.layout === null && s.mode === null && !s.countdown && !s.faces.length && !s.credits.length && !s.previously.length; }
    var key = JSON.stringify(message(state));
    function frames() { return container.querySelectorAll ? container.querySelectorAll('.dp-ambient iframe') : []; }
    function post(win, msg) { try { win.postMessage(msg, root.location.origin); } catch (e) { /* the frame went away */ } }
    function msg() {
      var m = message(state);
      if (m.countdown && opts && typeof opts.skew === 'function') { var k = Number(opts.skew()); if (isFinite(k)) m.countdown = { to: m.countdown.to - Math.round(k / 250) * 250, label: m.countdown.label }; }
      return m;
    }
    function paintStrip() {
      var has = state.phase !== null || state.security !== null || state.onair || state.faces.length > 0;
      if (!has) { if (strip && strip.parentNode) strip.parentNode.removeChild(strip); strip = null; return; }
      if (!strip) { strip = doc.createElement('div'); strip.className = 'dp-lay-strip'; strip.setAttribute('aria-hidden', 'true'); container.appendChild(strip); }
      strip.textContent = '';
      var add = function (cls, t) { var e = doc.createElement('span'); e.className = cls; e.textContent = t; strip.appendChild(e); return e; };
      if (state.onair) add('dp-lay-onair', 'ON AIR');
      if (state.phase) add('dp-lay-phase', PHASE_LABEL[state.phase]);
      if (state.security !== null) {
        var sec = add('dp-lay-sec', ''); sec.setAttribute('data-level', String(state.security));
        for (var i = 0; i < SECURITY; i++) { var pip = doc.createElement('i'); pip.className = i <= state.security ? 'on' : ''; sec.appendChild(pip); }
      }
      state.faces.forEach(function (f) { add('dp-lay-face', f.name || f.pcId); });
    }
    function apply(layers) {
      if (dead) return;
      state = clean(layers);
      Object.keys(ATTRS).forEach(function (a) { var v = state[ATTRS[a]]; if (v === null || v === undefined) container.removeAttribute(a); else container.setAttribute(a, String(v)); });
      if (state.onair) container.setAttribute('data-band-onair', '1'); else container.removeAttribute('data-band-onair');
      paintStrip();
      var m = msg(), k = JSON.stringify(m);
      if (k === key) return;
      key = k;
      [].forEach.call(frames(), function (f) { if (f.contentWindow) post(f.contentWindow, m); });
    }
    function sceneLoaded(id) {
      if (dead || isEmpty(state)) return;
      [].forEach.call(frames(), function (f) { if (f.getAttribute('data-scene') === id && f.contentWindow) post(f.contentWindow, msg()); });
    }
    function onMessage(ev) {
      if (dead || isEmpty(state) || !ev || ev.origin !== root.location.origin || !ev.data || ev.data.type !== 'b68:ready' || !ev.source) return;
      var fr = frames();
      for (var i = 0; i < fr.length; i++) if (fr[i].contentWindow === ev.source) { post(ev.source, msg()); return; }
    }
    if (root.addEventListener) root.addEventListener('message', onMessage);
    return {
      apply: apply, message: msg, sceneLoaded: sceneLoaded, state: function () { return state; },
      destroy: function () {
        dead = true;
        if (root.removeEventListener) root.removeEventListener('message', onMessage);
        if (strip && strip.parentNode) strip.parentNode.removeChild(strip);
        Object.keys(ATTRS).forEach(function (a) { container.removeAttribute(a); }); container.removeAttribute('data-band-onair');
      }
    };
  }
  return { attach: attach, clean: clean, message: message, PHASES: PHASES };
});
