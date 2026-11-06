/* gm/phase-rail.js — the phase rail (suite ticket 1.1, switch spine.rail).

   Personal Business, Planning, Score and Aftermath across the GM page's header. A tap moves the night to that phase (Back is allowed); the phase in play
   shows the time spent against its budget (amber from 80%, red once over). The iPad band is told the phase and nothing else (band.phase: an id, never a
   time). It hides nothing: the places (gm/places.js, the night rebuild) lay out each phase's tools, and the page follows the phase to its place.

   Window.B68GmPhaseRail, and module.exports under Node (the pure part).

   PURE
     model(night, nowMs) -> { phase, items: [{ id, label, state: 'done' | 'now' | 'next', mins, budget, tone: '' | 'amber' | 'red', text }] }
         mins: minutes in the phase (so far, or in total once it is done); budget: minutes or null; text: what the chip says
     toneOf(mins, budget) -> '' | 'amber' | 'red'          amber at 80% of the budget, red when over it
   DOM
     create(host) -> { sync(force?), destroy(), el(), mounted() }
       host: { root() -> #gm-root, night() -> the night contract's controller (gm/night.js create), now() -> ms }
       The bar is one element inserted after the page's top bar; sync() redraws it only when what it shows changed. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmPhaseRail = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var PHASES = [{ id: 'pb', label: 'Personal Business' }, { id: 'plan', label: 'Planning' }, { id: 'score', label: 'Score' }, { id: 'after', label: 'Aftermath' }];
  var SHORT = { pb: 'Personal', plan: 'Planning', score: 'Score', after: 'Aftermath' };
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  function toneOf(mins, budget) {
    if (!(budget > 0) || mins === null) return '';
    if (mins > budget) return 'red';
    return mins >= budget * 0.8 ? 'amber' : '';
  }
  function model(night, nowMs) {
    var n = isObj(night) ? night : {}, ph = isObj(n.phases) ? n.phases : {}, cur = PHASES.some(function (p) { return p.id === n.phase; }) ? n.phase : '';
    var seen = false;
    var items = PHASES.map(function (p) {
      var d = isObj(ph[p.id]) ? ph[p.id] : {}, start = num(d.start), end = num(d.end), budget = num(d.budget) > 0 ? d.budget : null, state, mins = null;
      if (p.id === cur) { state = 'now'; seen = true; if (start !== null && nowMs >= start) mins = Math.floor((nowMs - start) / 60000); }
      else if (start !== null && end !== null && !seen && cur) { state = 'done'; mins = Math.max(0, Math.floor((end - start) / 60000)); }
      else state = 'next';
      var tone = state === 'now' ? toneOf(mins, budget) : '';
      var text = mins === null ? (budget ? budget + ' min' : '') : mins + (budget && state === 'now' ? ' / ' + budget : '') + ' min';
      return { id: p.id, label: p.label, state: state, mins: mins, budget: budget, tone: tone, text: text };
    });
    return { phase: cur, items: items };
  }

  /* ---- the bar (DOM) ---- */
  function create(host) {
    var el = null, sig = '', alive = true;
    function rootEl() { var r = host && typeof host.root === 'function' ? host.root() : null; return r && r.ownerDocument ? r : null; }
    function ensure() {
      var r = rootEl(); if (!r) return null;
      if (el && el.parentNode === r) return el;
      var doc = r.ownerDocument, bar = r.querySelector('.gm-bar');
      el = doc.createElement('nav'); el.className = 'gm-phaserail'; el.id = 'gm-phaserail'; el.setAttribute('aria-label', 'Phase of the night');
      if (bar && bar.nextSibling) r.insertBefore(el, bar.nextSibling); else r.insertBefore(el, r.firstChild);
      sig = '';
      el.addEventListener('click', function (ev) {
        var b = ev.target && ev.target.closest ? ev.target.closest('[data-rail]') : null; if (!b || !alive) return;
        var id = b.getAttribute('data-rail');
        var N = host.night && host.night(); if (N && typeof N.enter === 'function') N.enter(id);
      });
      return el;
    }
    function nightNow() { var N = host.night && host.night(); return N && typeof N.night === 'function' ? N.night() : null; }
    function sync(force) {
      var e = ensure(); if (!e) return;
      var n = nightNow(), now = typeof host.now === 'function' ? host.now() : Date.now(), m = model(n, now);
      var s = JSON.stringify(m);
      if (!force && s === sig) return;
      sig = s;
      e.innerHTML = '<div class="gm-pr-row" role="group">' + m.items.map(function (i) {
        return '<button type="button" class="gm-pr-chip" data-rail="' + i.id + '" data-state="' + i.state + '"' + (i.tone ? ' data-tone="' + i.tone + '"' : '') + ' aria-pressed="' + (i.state === 'now') + '"' +
          ' title="' + esc(i.label) + (i.state === 'now' ? ' (now)' : ': tap to move the night here') + '"><span class="gm-pr-l">' + esc(SHORT[i.id]) + '</span>' + (i.text ? '<span class="gm-pr-t">' + esc(i.text) + '</span>' : '') + '</button>';
      }).join('') + '</div>';
    }
    function destroy() {
      alive = false;
      if (el && el.parentNode) el.parentNode.removeChild(el);
      el = null; sig = '';
    }
    return { sync: sync, destroy: destroy, el: function () { return el; }, mounted: function () { return !!el; } };
  }

  return { PHASES: PHASES, model: model, toneOf: toneOf, create: create };
});
