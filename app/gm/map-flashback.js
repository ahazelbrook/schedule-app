/* gm/map-flashback.js — the flashback filter on the map (suite 2.9, switch map.flashback).

   Plain script, UMD: window.B68GmMapFlashback in the browser, module.exports under Node. GM side only.

   STARTING IT. "Blade, flashback", optionally followed by the Stress cost ("flashback 2", "flashback, two stress"), or the Flashback button on the Run map.
   The cue is the strict grammar's (gm/cue-grammar.js, switch ai.grammar) and the Stress cost is read only while this switch is on; the button needs only this switch.
   THE LOOK. The iPad's scene.filter layer (the sepia the show contract already has) gains grain and an "Earlier…" caption while this switch is on
   (app/display/layers.js, app/display/shows.css; the iPad hears of the switch as a display switch). The GM's own Run map goes sepia too.
   IT LASTS until "Blade, back" or a tap on the button. The layer is the one source of truth: this module only reads it (host.filter()) and writes it (host.layer).
   THE PIN. The GM drops a pin on the room where the flashback pays off (the button, on the room the crew are in). It lives on the GM page only: nothing about
   it reaches the iPad or a phone. A pin outlasts the flashback until the GM takes it up (a second tap) or the page is closed.
   THE STRESS COST. It is the GM's word: it is written to the night log and said in a toast, nothing more. Nothing is sent to a phone.

   API
     SWITCH  parseStress(words) -> { stress: n | null, ok: bool }       the words after "flashback" (lowercase), see below
     pinSvg(doc, svg, box) -> the <g>      clearPin(svg)
     create(host) -> controller { start(stress), end(), toggle(), pin(), unpin(), pinned(), note(stress), noteEnd(), paint(frame, svg, zoom) }
       host: { feature(id), doc(), filter() -> 'flashback' | null, layer(path, value) -> Promise<answer | null>, room() -> name, roomBox(svg, name) -> box | null,
               toast(msg, bad), log(text) } */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmMapFlashback = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SWITCH = 'map.flashback';
  var NS = 'http://www.w3.org/2000/svg';
  var NUM = { zero: 0, none: 0, no: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  var EXTRA = { stress: 1, cost: 1, costs: 1, for: 1, of: 1, it: 1, is: 1, that: 1, will: 1, take: 1, takes: 1, pay: 1, pays: 1, points: 1, point: 1 };
  var MAX_STRESS = 9;

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }

  /* the words after "flashback": a number (1-9 or a word) with the little words round it is the Stress cost; no number and no other word is a plain flashback;
     anything else is not a flashback cue at all ({ ok: false }). A second number is not a cost either. */
  function parseStress(words, fill) {
    var ws = Array.isArray(words) ? words : [], n = null, extra = false, fillOk = isObj(fill) ? fill : {};
    for (var i = 0; i < ws.length; i++) {
      var w = str(ws[i]).toLowerCase(), v = /^\d$/.test(w) ? +w : Object.prototype.hasOwnProperty.call(NUM, w) ? NUM[w] : null;
      if (v !== null) { if (n !== null || v > MAX_STRESS) return { stress: null, ok: false }; n = v; }
      else if (Object.prototype.hasOwnProperty.call(EXTRA, w)) extra = true;
      else if (!Object.prototype.hasOwnProperty.call(fillOk, w)) return { stress: null, ok: false };
    }
    if (n === null && extra) return { stress: null, ok: false };
    return { stress: n, ok: true };
  }

  function mk(doc, tag, attrs) {
    var e = doc.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, String(attrs[k])); });
    return e;
  }
  function clearPin(svg) {
    if (!svg || !svg.querySelectorAll) return;
    var old = svg.querySelectorAll('.b19-pin');
    for (var i = 0; i < old.length; i++) if (old[i].parentNode) old[i].parentNode.removeChild(old[i]);
  }
  /* a drawing pin standing in the middle of the room's box; every attribute is set, no text from the page */
  function pinSvg(doc, svg, box) {
    clearPin(svg);
    var u = Math.max(Math.min(box.w, box.h) * 0.16, 2), cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    var g = mk(doc, 'g', { 'class': 'b19-pin', 'pointer-events': 'none', 'aria-hidden': 'true' });
    g.appendChild(mk(doc, 'path', { d: 'M' + cx + ' ' + cy + ' l' + (-u * 0.55) + ' ' + (-u * 1.5) + ' a' + (u * 0.62) + ' ' + (u * 0.62) + ' 0 1 1 ' + (u * 1.1) + ' 0 z', fill: '#c4361e', stroke: '#14110e', 'stroke-width': u * 0.12 }));
    g.appendChild(mk(doc, 'circle', { cx: cx, cy: cy - u * 1.72, r: u * 0.22, fill: '#fff4d6' }));
    svg.appendChild(g);
    return g;
  }

  function create(host) {
    host = host || {};
    var pinRoom = '', svgRef = null, frameRef = null, zoomRef = null, stress = null;
    function on() { return typeof host.feature === 'function' ? !!host.feature(SWITCH) : false; }
    function up() { return typeof host.filter === 'function' && host.filter() === 'flashback'; }
    function toast(m, bad) { if (typeof host.toast === 'function') host.toast(m, bad); }
    function log(t) { if (typeof host.log === 'function') host.log(t); }

    /* the Stress cost and the log line, for a flashback that is on (whichever way it was started) */
    function note(cost) {
      if (!on()) return false;
      stress = typeof cost === 'number' && cost >= 0 && cost <= MAX_STRESS ? Math.floor(cost) : null;
      if (stress !== null) { log('Flashback: costs ' + stress + ' Stress'); toast('Flashback costs ' + stress + ' Stress: mark it on their sheet.', false); }
      else log('Flashback');
      return true;
    }
    function noteEnd() { if (!on()) return false; stress = null; log('Back from the flashback'); return true; }
    function start(cost) {
      if (!on()) return Promise.resolve(false);
      if (up()) return Promise.resolve(false);
      return Promise.resolve(host.layer('scene.filter', 'flashback')).then(function (r) { if (r === null || r === false) return false; note(cost); repaint(); return true; });
    }
    function end() {
      if (!on() || !up()) return Promise.resolve(false);
      return Promise.resolve(host.layer('scene.filter', null)).then(function (r) { if (r === null || r === false) return false; noteEnd(); repaint(); return true; });
    }
    function toggle(cost) { return up() ? end() : start(cost); }

    function pin() {
      if (!on()) return false;
      var room = typeof host.room === 'function' ? str(host.room()) : '';
      if (pinRoom && (!room || room === pinRoom)) return unpin();
      if (!room) { toast('Put the crew in a room first: the pin goes on that room.', true); return false; }
      pinRoom = room; log('Flashback pin: ' + room); repaint(); return true;
    }
    function unpin() { if (!pinRoom) return false; pinRoom = ''; repaint(); return true; }

    function repaint() { if (frameRef && svgRef) paint(frameRef, svgRef, zoomRef); }
    function btn(doc, label, act, pressed, title) {
      var b = doc.createElement('button'); b.type = 'button'; b.className = 'mz-btn b19-btn'; b.setAttribute('data-b19', act); b.textContent = label;
      if (pressed !== undefined) b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
      if (title) b.title = title;
      b.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
      b.addEventListener('click', function (ev) { ev.stopPropagation(); if (act === 'flashback') toggle(); else if (act === 'flash-pin') pin(); });
      return b;
    }
    function paint(frame, svg, zoom) {
      frameRef = frame; svgRef = svg; zoomRef = zoom || null;
      var doc = frame && frame.ownerDocument; if (!doc) return;
      var bar = frame.querySelector('.b19-bar'), a = frame.querySelector('[data-b19="flashback"]'), p = frame.querySelector('[data-b19="flash-pin"]');
      if (!on()) {
        [a, p].forEach(function (x) { if (x && x.parentNode) x.parentNode.removeChild(x); });
        frame.classList.remove('b19-flash'); clearPin(svg);
        if (bar && !bar.firstChild && bar.parentNode) bar.parentNode.removeChild(bar);
        return;
      }
      if (!bar) { bar = doc.createElement('div'); bar.className = 'b19-bar'; frame.appendChild(bar); }
      if (!a) { a = btn(doc, 'Flashback', 'flashback', false, 'Sepia, grain and “Earlier…” on the iPad until you tap again or say “Blade, back”'); bar.appendChild(a); }
      a.setAttribute('aria-pressed', up() ? 'true' : 'false'); a.textContent = up() ? 'Back' : 'Flashback';
      if (!p) { p = btn(doc, 'Pin', 'flash-pin', false, 'Drop a pin on the room where the flashback pays off (tap again to take it up)'); bar.appendChild(p); }
      p.setAttribute('aria-pressed', pinRoom ? 'true' : 'false');
      frame.classList.toggle('b19-flash', up());
      var box = pinRoom && typeof host.roomBox === 'function' ? host.roomBox(svg, pinRoom) : null;
      if (box && typeof host.doc === 'function') pinSvg(host.doc(), svg, box); else clearPin(svg);
    }
    return { start: start, end: end, toggle: toggle, pin: pin, unpin: unpin, pinned: function () { return pinRoom; }, stress: function () { return stress; }, note: note, noteEnd: noteEnd, paint: paint, refresh: repaint };
  }

  return { SWITCH: SWITCH, parseStress: parseStress, pinSvg: pinSvg, clearPin: clearPin, create: create };
});
