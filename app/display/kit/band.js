/* display/kit/band.js: the new stage's top band (KS14, S2), behind the setting kit.stage. In the kit-stage and kit-lookbook bundles (app/routes.js):
   fetched only while the setting is on (or by the look book). It only defines B68StageBand when it loads; it reads B68Ui and the page only when it
   is called. ES5, window.B68StageBand in the browser, module.exports under Node.

   WHAT IT DRAWS, in the stage frame's two top places (KS13: frame.slot('clock') top left, frame.slot('crew') top right):
     clock   the night's clock as the band is told it (the mission's hud.time, shown only when the GM turned the clock on) and the NEXT event (the
             first of hud.next: its time, else how soon, over its words). Nothing is worked out here: the words are the band model's (display-page.js
             Pure.bandModel), so the stage says what the old band beside the map says.
     crew    a head per PC playing: an initial in a disc, a stress ring (B68Ui's meter, a clock of 9) with the number on a badge, and the FULL name
             under it in at most two lines. The names come from the mission's hud.crew (up to 8, the PCs playing tonight: KS12 filters it); the ring
             and the acting mark come from the faces layer (band.faces, up to 3 PC faces), joined on the name. With no hud.crew the PC faces are
             the heads. A head with no face has no ring (its Stress is not on the iPad).
     acting  (KS14.2, the Gate 2 contract: KS14-contract.md) a PC face carrying acting: true. Its head is drawn larger and its disc takes the accent
             (orange: the one active thing). Nothing moves: the change is a cut, on the poll that brings it.
   Every string goes in as text (textContent and B68Ui.node): no markup sink, no request.

   API: attach(frame, host) -> { paint(), destroy() } | null      host = { band() -> the band model, layers() -> B68Layers' clean state, doc }
        paint() repaints only when what it would draw changed (a signature), so a poll that changes nothing touches nothing.
        Pure = { initial(name), heads(faces, crew) -> [{ name, initial, stress, acting }], clock(model) -> { time, kick, text } | null, sig(o) } */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else if (root) root.B68StageBand = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var HEADS_MAX = 8, NAME_MAX = 60, STRESS_MAX = 9;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function txt(v, max) { return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max || 200) : ''; }
  function U() { return W && W.B68Ui; }

  var Pure = {};
  /* the first letter or digit of a name, as the disc's initial */
  Pure.initial = function (name) {
    var m = String(name || '').match(/[A-Za-z0-9À-ɏ]/);
    return m ? m[0].toUpperCase() : '?';
  };
  /* the heads: hud.crew's names (the PCs playing) joined to the PC faces by name; with no crew, the PC faces that carry a name */
  Pure.heads = function (faces, crew) {
    var pcs = (Array.isArray(faces) ? faces : []).filter(function (f) { return isObj(f) && typeof f.pcId === 'string' && f.pcId; });
    var byName = {};
    pcs.forEach(function (f) { var n = txt(f.name, NAME_MAX); if (n && !byName[n]) byName[n] = f; });
    function head(name, f) {
      var st = f && typeof f.stress === 'number' && isFinite(f.stress) ? Math.max(0, Math.min(STRESS_MAX, Math.floor(f.stress))) : null;
      return { name: name, initial: Pure.initial(name), stress: st, acting: !!(f && f.acting === true) };
    }
    var out = [], seen = {};
    var names = (Array.isArray(crew) ? crew : []).map(function (c) { return txt(isObj(c) ? c.name : '', NAME_MAX); }).filter(Boolean);
    if (names.length) names.forEach(function (n) { if (out.length < HEADS_MAX && !seen[n]) { seen[n] = 1; out.push(head(n, byName[n] || null)); } });
    else pcs.forEach(function (f) { var n = txt(f.name, NAME_MAX); if (n && !seen[n] && out.length < HEADS_MAX) { seen[n] = 1; out.push(head(n, f)); } });
    var acting = 0;
    out.forEach(function (h) { if (h.acting && ++acting > 1) h.acting = false; });      /* one head at most, whatever arrives */
    return out;
  };
  /* the clock and NEXT, from the band model: { time, kick, text }; null when there is neither */
  Pure.clock = function (m) {
    if (!isObj(m)) return null;
    var time = txt(m.time, 16), n = Array.isArray(m.next) && isObj(m.next[0]) ? m.next[0] : null;
    var text = n ? txt(n.text, 200) : '', when = n ? (txt(n.at, 16) || txt(n.inText, 24)) : '';
    var kick = text ? 'Next' + (when ? ' · ' + when : '') : '';
    if (!time && !text) return null;
    return { time: time, kick: kick, text: text };
  };
  Pure.sig = function (o) { return JSON.stringify(o); };

  function attach(frame, host) {
    var B = U();
    if (!B || !frame || typeof frame.slot !== 'function') return null;
    host = host || {};
    var clockEl = frame.slot('clock'), crewEl = frame.slot('crew');
    if (!clockEl || !crewEl) return null;
    var doc = host.doc || clockEl.ownerDocument, dead = false, sigs = { clock: null, crew: null };
    function add(parent, tag, cls, t) { var e = doc.createElement(tag); e.className = cls; if (t !== undefined) e.textContent = t; parent.appendChild(e); return e; }

    function paintClock(c) {
      var k = Pure.sig(c); if (k === sigs.clock) return;
      sigs.clock = k; clockEl.textContent = '';
      if (!c) return;
      var box = add(clockEl, 'div', 'stage-clock');
      if (c.time) add(box, 'p', 'stage-clock-time', c.time);
      if (c.text) { var nx = add(box, 'div', 'stage-clock-next'); add(nx, 'p', 'stage-clock-kick', c.kick); add(nx, 'p', 'stage-clock-text', c.text); }
    }
    function paintCrew(list) {
      var k = Pure.sig(list); if (k === sigs.crew) return;
      sigs.crew = k; crewEl.textContent = '';
      if (!list.length) return;
      var box = add(crewEl, 'div', 'stage-heads');
      box.setAttribute('role', 'list'); box.setAttribute('aria-label', 'The crew');
      list.forEach(function (h) {
        var el = add(box, 'div', 'stage-head');
        el.setAttribute('role', 'listitem');
        if (h.acting) el.setAttribute('data-stage-acting', '');
        var face = add(el, 'div', 'stage-head-face');
        if (h.stress !== null) {
          face.appendChild(B.node('meter', { kind: 'clock', value: h.stress, max: STRESS_MAX, label: 'Stress', tone: h.acting ? 'accent' : 'ink', cls: 'stage-head-ring' }, doc));
          el.setAttribute('data-stage-stress', String(h.stress));
        }
        add(face, 'span', 'stage-head-disc', h.initial).setAttribute('aria-hidden', 'true');
        if (h.stress !== null) add(face, 'span', 'stage-head-num', String(h.stress)).setAttribute('aria-hidden', 'true');
        add(el, 'p', 'stage-head-name', h.name);
      });
    }
    function paint() {
      if (dead) return;
      var m = typeof host.band === 'function' ? host.band() : null, L = typeof host.layers === 'function' ? host.layers() : null;
      paintClock(Pure.clock(m));
      paintCrew(Pure.heads(isObj(L) ? L.faces : null, isObj(m) ? m.crew : null));
    }
    paint();
    return {
      paint: paint,
      destroy: function () { if (dead) return; dead = true; clockEl.textContent = ''; crewEl.textContent = ''; }
    };
  }

  return { VERSION: 1, Pure: Pure, attach: attach };
});
