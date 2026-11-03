/* gm/map-spotted.js — the Spotted beat on the Run view's map (suite 2.6, switch map.spotted).

   Plain script, UMD: window.B68GmMapSpotted in the browser, module.exports under Node. GM side only.

   ONE TAP, UNDER THREE SECONDS, THEN IT RETURNS:
     1. zoom the Run map to the room            2. a sting: the `spotted` beat on the iPad (no room, no name in it)
     3. a yellow fill spreads from the NPC's eyes, inside the room, on the GM's map
     4. the alarm clock of the running site ticks once (the security clock of ticket 2.4 comes first once it exists; the host names the clock)
   then the fill goes and the map goes back to the view it had.

   ONCE WITH TWO GM PAGES. The beat is sent with a key made from the clock and the value it is about to hold, so a second page that sends the same
   beat finds the first one running (`unchanged`) and does not tick; the tick itself is an absolute `filled`, never "plus one", so a race still lands on
   one segment. Nothing is written to a phone, and the iPad gets only the brief `spotted` beat.

   API
     STEPS_MS DONE_MS                           where each step falls, and when the whole run is over
     pickClock(clocks, name) -> { id, from, to, size } | null      the table clock called `name`, one segment further; null when none or full
     beatKey(clock, now) -> the show key        eyeFor(box) -> { x, y }     the point the fill spreads from (the top middle of a room's box)
     fillSvg(doc, svg, box, id) -> the <g> it drew (every attribute set, no text from the page)      clearFill(svg)
     create(host) -> controller { run() -> Promise<result>, busy(), paint(frame, svg, zoom) }
       host: { feature(id), doc(), room() -> name, roomBox(svg, name) -> { x, y, w, h } | null, clockName() -> name | '', clocks() -> [clock],
               tick(id, to) -> Promise, show(kind, payload, { key, ms }) -> Promise<answer | null>, toast(msg, bad), log(text), now(),
               setTimeout/clearTimeout }
       zoom (from the Run view): { get(), set(view), zoomToBox(box) }
       result: { ms, zoomed, sting, filled, ticked, why } */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmMapSpotted = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SWITCH = 'map.spotted';
  var STEPS_MS = { zoom: 0, sting: 0, fill: 150, tick: 1250 }, DONE_MS = 2300, FILL_MS = 1100;
  var NS = 'http://www.w3.org/2000/svg';

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }

  function pickClock(clocks, name) {
    var n = str(name).trim();
    if (!n || !Array.isArray(clocks)) return null;
    for (var i = 0; i < clocks.length; i++) {
      var c = clocks[i]; if (!isObj(c) || str(c.name).trim() !== n || !str(c.id)) continue;
      var size = Math.floor(+c.size) || 0, from = Math.max(0, Math.floor(+c.filled) || 0);
      if (size < 1 || from >= size) return null;
      return { id: str(c.id), from: from, to: from + 1, size: size };
    }
    return null;
  }
  /* two pages that press it for the same segment send the same key; with no clock the key is the same for three seconds */
  function beatKey(clock, now) {
    var k = clock ? 'spotted-' + clock.id + '-' + clock.to : 'spotted-t' + Math.floor((+now || 0) / 3000);
    return k.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  }
  function eyeFor(box) { return { x: box.x + box.w / 2, y: box.y + box.h * 0.28 }; }

  function mk(doc, tag, attrs) {
    var e = doc.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, String(attrs[k])); });
    return e;
  }
  function clearFill(svg) {
    if (!svg || !svg.querySelectorAll) return;
    var old = svg.querySelectorAll('.b19-spot');
    for (var i = 0; i < old.length; i++) if (old[i].parentNode) old[i].parentNode.removeChild(old[i]);
  }
  function fillSvg(doc, svg, box, id, elapsedMs) {
    clearFill(svg);
    var eye = eyeFor(box), r = Math.hypot(Math.max(eye.x - box.x, box.x + box.w - eye.x), Math.max(eye.y - box.y, box.y + box.h - eye.y)) * 1.05;
    var cid = 'b19-clip-' + String(id || 's').replace(/[^A-Za-z0-9_-]/g, '');
    var g = mk(doc, 'g', { 'class': 'b19-spot', 'pointer-events': 'none', 'aria-hidden': 'true' });
    var clip = mk(doc, 'clipPath', { id: cid });
    clip.appendChild(mk(doc, 'rect', { x: box.x, y: box.y, width: box.w, height: box.h }));
    g.appendChild(clip);
    var body = mk(doc, 'g', { 'clip-path': 'url(#' + cid + ')' });
    var c = mk(doc, 'circle', { 'class': 'b19-spot-fill', cx: eye.x, cy: eye.y, r: r, fill: '#f2c200', 'fill-opacity': '0.5' });
    c.style.animationDuration = FILL_MS + 'ms';
    if (elapsedMs > 0) c.style.animationDelay = '-' + Math.round(elapsedMs) + 'ms';       /* drawn again part-way through: carry on, do not start over */
    body.appendChild(c);
    g.appendChild(body);
    g.appendChild(mk(doc, 'ellipse', { 'class': 'b19-spot-eyes', cx: eye.x, cy: eye.y, rx: Math.max(box.w * 0.05, 1), ry: Math.max(box.w * 0.025, 0.5), fill: '#fff6c9' }));
    svg.appendChild(g);
    return g;
  }

  function create(host) {
    host = host || {};
    var running = false, svgRef = null, zoomRef = null, fx = null;     /* fx: the fill in progress, drawn again if the Run view redraws the map under it */
    function on() { return typeof host.feature === 'function' ? !!host.feature(SWITCH) : false; }
    function now() { return typeof host.now === 'function' ? host.now() : Date.now(); }
    function setT(fn, ms) { return typeof host.setTimeout === 'function' ? host.setTimeout(fn, ms) : setTimeout(fn, ms); }
    function toast(m, bad) { if (typeof host.toast === 'function') host.toast(m, bad); }
    function wait(ms) { return new Promise(function (res) { setT(res, ms); }); }

    function run() {
      var t0 = now(), out = { ms: 0, zoomed: false, sting: false, filled: false, ticked: false, why: '' };
      function finish(why) { out.ms = now() - t0; if (why) out.why = why; return out; }
      if (!on()) return Promise.resolve(finish('off'));
      if (running) return Promise.resolve(finish('busy'));
      var room = typeof host.room === 'function' ? str(host.room()) : '';
      if (!room) { toast('Put the crew in a room first: the beat runs on that room.', true); return Promise.resolve(finish('no room')); }
      var svg = svgRef, zoom = zoomRef, box = svg && typeof host.roomBox === 'function' ? host.roomBox(svg, room) : null;
      var clocks = typeof host.clocks === 'function' ? host.clocks() : [], cname = typeof host.clockName === 'function' ? str(host.clockName()) : '';
      var clock = pickClock(clocks, cname), key = beatKey(clock, now()), before = zoom && typeof zoom.get === 'function' ? zoom.get() : null;
      var doc = typeof host.doc === 'function' ? host.doc() : null, landed = false;
      running = true;

      /* 1. zoom */
      if (zoom && box && typeof zoom.zoomToBox === 'function') { zoom.zoomToBox(box); out.zoomed = true; }
      /* 2. the sting: the brief beat, nothing in it names a room or a person */
      var sting = Promise.resolve().then(function () { return typeof host.show === 'function' ? host.show('spotted', { text: 'SPOTTED' }, { key: key, ms: 4000 }) : null; }).then(function (r) {
        out.sting = !!r; landed = !!r && !(isObj(r) && r.unchanged === true);
      }, function () { out.sting = false; });
      /* 3. the fill, from the eyes */
      var fill = wait(STEPS_MS.fill).then(function () { if (doc && svgRef && box) { fx = { box: box, key: key, at: now() }; fillSvg(doc, svgRef, box, key); out.filled = true; } });
      /* 4. the tick, after the fill has run, and only when this page's beat is the one that landed */
      var tick = Promise.all([sting, fill]).then(function () { return wait(Math.max(0, STEPS_MS.tick - STEPS_MS.fill)); }).then(function () {
        if (!clock) { toast('No alarm clock to tick on this site: the beat ran without one.', false); return null; }
        if (!landed) { if (!out.sting) toast('The Spotted sting did not go out, so the alarm clock was not ticked.', true); return null; }     /* unchanged = another page's beat landed first: it ticks */
        return Promise.resolve(host.tick(clock.id, clock.to)).then(function (r) {
          out.ticked = r !== null && r !== false;
          if (out.ticked && typeof host.log === 'function') host.log('Spotted in ' + room + ': the alarm clock ticks to ' + clock.to + '/' + clock.size);
        }, function () { toast('Could not tick the alarm clock.', true); });
      });
      /* then it returns */
      return Promise.all([tick, wait(DONE_MS)]).then(function () {
        fx = null; if (svgRef) clearFill(svgRef);
        /* the map may have been drawn again meanwhile (the tick redraws the Run view): go back on the controller of the map that is there now */
        if (before && zoomRef && typeof zoomRef.set === 'function') zoomRef.set(before);
        running = false; return finish('');
      }, function () { fx = null; if (svgRef) clearFill(svgRef); running = false; return finish('error'); });
    }

    /* the Run view's map was drawn: remember it, and put the button on it (or take it away while the switch is off) */
    function paint(frame, svg, zoom) {
      svgRef = svg; zoomRef = zoom || null;
      var doc = frame && frame.ownerDocument; if (!doc) return;
      if (fx && running && svg) fillSvg(doc, svg, fx.box, fx.key, now() - fx.at);
      var bar = frame.querySelector('.b19-bar'), mine = frame.querySelector('[data-b19="spotted"]');
      if (!on()) {
        if (mine && mine.parentNode) mine.parentNode.removeChild(mine);
        if (bar && !bar.firstChild && bar.parentNode) bar.parentNode.removeChild(bar);
        return;
      }
      if (!bar) { bar = doc.createElement('div'); bar.className = 'b19-bar'; frame.appendChild(bar); }
      if (!mine) {
        var b = doc.createElement('button'); b.type = 'button'; b.className = 'mz-btn b19-btn'; b.setAttribute('data-b19', 'spotted'); b.textContent = 'Spotted';
        b.title = 'Zoom to the room, sting, fill from the eyes, tick the alarm';
        b.addEventListener('pointerdown', function (ev) { ev.stopPropagation(); });
        b.addEventListener('click', function (ev) { ev.stopPropagation(); run(); });
        bar.appendChild(b);
      }
    }
    return { run: run, busy: function () { return running; }, paint: paint };
  }

  return { SWITCH: SWITCH, STEPS_MS: STEPS_MS, DONE_MS: DONE_MS, pickClock: pickClock, beatKey: beatKey, eyeFor: eyeFor, fillSvg: fillSvg, clearFill: clearFill, create: create };
});
