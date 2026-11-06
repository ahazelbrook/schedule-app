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
   data-scene-layout, data-scene-mode) for CSS, and THE BAND: the strip that reads those layers.

   THE BAND (the GM night rebuild, the design's iPad part). Everything lasting that sits on the frame is ONE strip across the top with a slot each, in this order:
       mic | phase | crew (a cell per face) | security          (portrait, when faces are drawn: mic | phase | security, over a row of crew cells)
     mic       the iPad's own ON AIR lamp (app/display/onair.js hands it over through mic(); "Off the record 4:32" while paused), else band.onair
     phase     band.phase, named as the GM page's places name it (Personal, Planning, Score, Aftermath); none before the night's first phase (Before
               and the Opening are not phases), so the hard start's band has no phase
     crew      band.faces: a PC as its first name over its named marks (STRESS 9, the padlock and its count, HARM and its marks); a face that holds
               an NPC as its name. Hidden while the hard start runs (scene.mode start draws its own name plates; hardstart.css)
     security  band.security as five pips
   An unset layer's slot is no width (F1: the crew cells take the room; portrait drops its top row when only the crew is up, dp-lay-solo), a first
   name shrinks before it is cut, and a long text ends in an ellipsis inside its own slot, so no layer ever draws over another, in any
   combination, landscape or portrait. While the strip is up the root carries dp-lay-on (and dp-lay-crew while crew
   cells are drawn) and app/display/shows.css lays everything else (the stages, the beats, the band beside the map and its countdown, the hard
   start, the montage, the AUTO chip) out BELOW it, so the strip never covers them either. Over lights out only the lamp stays (dp-lights-out).
   API: attach(container, { skew(), band?(), figure?(spec, id) -> node | null (the montage's PC figures) }) -> { apply(layers), message(), sceneLoaded(id), mic(lamp | null), banded(), destroy() }; clean(layers) -> the checked layers;
   mic(container, { off, text } | null) -> true when a band attached to that container took the lamp (onair.js asks before drawing a lamp of its own).
   THE TECH RUN (06/11): the strip is a choice. opts.band() says whether it is drawn (the display page reads the display.band setting, off unless the GM
   turns it on in the iPad view's Settings); without opts.band it is drawn as before. While it is off there is no strip and no dp-lay-on, so the stages,
   the map, the beats and the montage take the whole frame, and mic() answers false, so the lamp draws in its own corner (onair.js). The data-* attributes
   and the scenes' b68:data message are the same either way. A change to the setting repaints at once (the B68Flags subscription).
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
  var PHASE_LABEL = { pb: 'Personal', plan: 'Planning', score: 'Score', after: 'Aftermath' };     /* the GM page's place names, one word each */
  var SECURITY = 5;
  var SLOTS = ['mic', 'phase', 'crew', 'sec'];
  var live = [];      /* the attached bands, [{ container, api }], so the lamp finds the band of its own container (mic()) */

  function rows(list, max) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.slice(0, max).forEach(function (c) { if (isObj(c)) { var n = text(c.name, 120); if (n) out.push({ name: n, role: text(c.role, 120) }); } });
    return out;
  }
  /* a PC's face: { pcId } and, only when the GM page sent them (suite 3.7, face.pcstatus), name, stress 0-9, harm [levels 1-4] and locks 0-6 */
  function pcFace(f) {
    var o = { pcId: f.pcId }, n = text(f.name, 40), st = whole(f.stress, 0, 9), lk = whole(f.locks, 0, 6);
    if (n) o.name = n;
    if (st !== undefined) o.stress = st;
    if (lk !== undefined) o.locks = lk;
    if (Array.isArray(f.harm)) { var h = f.harm.slice(0, 4).filter(function (x) { return whole(x, 1, 4) !== undefined; }); if (h.length) o.harm = h; }
    return o;
  }
  /* suite 2.8 (data.montage): two to four panels { pcId, name, room, line, done }; [] when unset or not that shape. Not in the scenes' b68:data message (message() is unchanged). */
  function montagePanels(v) {
    if (!isObj(v) || !Array.isArray(v.panels) || v.panels.length < 2 || v.panels.length > 4) return [];
    var out = [];
    v.panels.forEach(function (p) {
      if (!isObj(p) || typeof p.pcId !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(p.pcId)) return;
      var o = { pcId: p.pcId, name: text(p.name, 40), room: text(p.room, 60), line: text(p.line, 100) };
      if (p.done === true) o.done = true;
      if (isObj(p.spec)) o.spec = p.spec;      /* the tech run: the server joins the character's figure (functions/_lib/show.js); never sent to a scene */
      out.push(o);
    });
    return out.length >= 2 ? out : [];
  }
  /* clean(layers) -> { phase, security, onair, filter, layout, mode, countdown, faces, credits, previously } with every field present (null / [] when unset) */
  var HARM_MARK = ['plaster', 'sling', 'splint', 'cross'];
  function clean(raw) {
    var l = isObj(raw) ? raw : {}, b = isObj(l.band) ? l.band : {}, s = isObj(l.scene) ? l.scene : {}, d = isObj(l.data) ? l.data : {};
    var faces = [];
    if (Array.isArray(b.faces)) b.faces.slice(0, 3).forEach(function (f) {
      if (!isObj(f)) return;
      var n = text(f.name, 120);
      if (typeof f.pcId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(f.pcId)) faces.push(pcFace(f));      /* a PC first: it may carry a name too (suite 3.7) */
      else if (n) faces.push({ name: n, role: text(f.role, 120) });
    });
    var cd = isObj(d.countdown) && whole(d.countdown.to, 1, 8.64e15) ? { to: d.countdown.to, label: text(d.countdown.label, 40) } : null;
    return {
      phase: oneOf(b.phase, PHASES) || null, security: whole(b.security, 0, SECURITY - 1) === undefined ? null : b.security, onair: b.onair === true,
      filter: oneOf(s.filter, ['flashback']) || null, layout: oneOf(s.layout, ['montage']) || null, mode: oneOf(s.mode, ['start', 'aftermath']) || null,
      countdown: cd, faces: faces, credits: rows(d.credits, 30), previously: rows(d.previously, 12), prevFaces: prevFaces(d.previously), montage: montagePanels(d.montage)
    };
  }
  /* "Previously on" draws each face (app/display/hardstart.js): one { npcId, spec } per row of `previously` (in its order; null where a row has no
     figure). The server serves a spec on a revealed NPC's row only (functions/_lib/show.js). It stays on the page: message() never sends it to a scene. */
  function prevFaces(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    list.slice(0, 12).forEach(function (c) {
      if (!isObj(c) || !text(c.name, 120)) return;
      var id = typeof c.npcId === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(c.npcId) ? c.npcId : '';
      out.push(isObj(c.spec) ? { npcId: id, spec: c.spec } : null);
    });
    return out;
  }
  /* the message a scene receives (`countdown.to` is already in THIS page's clock: the server's epoch less its skew, rounded to 250 ms so a jittery skew does not re-post; a scene computes to - Date.now()) */
  function message(state) {
    return { type: 'b68:data', phase: state.phase, security: state.security, onair: state.onair, filter: state.filter, layout: state.layout, mode: state.mode,
      countdown: state.countdown, faces: state.faces, credits: state.credits, previously: state.previously };
  }
  var ATTRS = { 'data-band-phase': 'phase', 'data-band-security': 'security', 'data-scene-filter': 'filter', 'data-scene-layout': 'layout', 'data-scene-mode': 'mode' };

  function attach(container, opts) {
    var doc = container.ownerDocument || root.document, state = clean(null), dead = false, strip = null, slots = null, lamp = null;
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
    /* the root's band classes (a container without classList, a bare test box, just has none) */
    function rootClass(name, on) { var cl = container.classList; if (!cl) return; if (on) cl.add(name); else cl.remove(name); }
    function add(parent, tag, cls, t) { var e = doc.createElement(tag); e.className = cls; if (t !== undefined) e.textContent = t; parent.appendChild(e); return e; }
    /* a PC's cell, two lines a player across the table can read and name (F1, after the real iPad):
         the first name on a line of its own, the whole width of the cell (the crew know each other by it; the full name is the cell's title). It is
         never cut while there is room: too long, its type shrinks first (fitNames), and only then does it end in an ellipsis;
         under it the marks, each named: "STRESS 9"; "HARM" and a mark per harm, coloured by its level (a plaster at 1, a sling at 2, a splint at 3,
         a cross at 4: the word is the mark's title); a padlock with the count of its deadlocked keys */
    function paintPc(cell, f) {
      var full = f.name || f.pcId, first = full.split(' ')[0] || full;
      cell.setAttribute('title', full);
      add(cell, 'b', 'dp-lay-name', first);
      var harm = f.harm && f.harm.length ? f.harm : null;
      var put = function (parent, cls, t, label) { var e = add(parent, 'i', cls, t); if (label) e.setAttribute('title', label); return e; };
      if (f.stress !== undefined || f.locks) {
        var marks = add(cell, 'span', 'dp-lay-marks');
        if (f.stress !== undefined) { var s = put(marks, 'dp-lay-mark dp-pc-stress', undefined, 'Stress ' + f.stress); add(s, 'span', 'dp-lay-cap', 'Stress'); add(s, 'b', 'dp-lay-num', String(f.stress)); }
        if (f.locks) { var lk = put(marks, 'dp-lay-mark dp-pc-locks', undefined, f.locks > 1 ? f.locks + ' keys deadlocked' : 'Key deadlocked'); add(lk, 'i', 'dp-pc-lock', ''); add(lk, 'b', 'dp-lay-num', String(f.locks)); }
      }
      if (harm) {      /* a line of its own: the marks never push the Stress or the padlock out of the cell */
        var hm = put(add(cell, 'span', 'dp-lay-marks dp-lay-hurt'), 'dp-lay-mark dp-pc-hurt', undefined, 'Harm: ' + harm.map(function (h) { return HARM_MARK[h - 1]; }).join(', '));
        add(hm, 'span', 'dp-lay-cap', 'Harm');
        harm.forEach(function (h) { put(hm, 'dp-pc-harm dp-pc-harm-' + h, HARM_MARK[h - 1], 'Harm ' + h + ': ' + HARM_MARK[h - 1]); });
      }
    }
    /* a first name too wide for its cell shrinks its type (down to FIT_MIN of the band's), and only then ends in an ellipsis; run after a paint and on a resize */
    var FIT_MIN = 0.7, fitQueued = false;
    function fitNames() {
      fitQueued = false;
      var W = root, list = strip && strip.querySelectorAll ? strip.querySelectorAll('.dp-lay-face .dp-lay-name') : [];
      if (!W || typeof W.getComputedStyle !== 'function') return;
      for (var i = 0; i < list.length; i++) {
        var e = list[i]; e.style.fontSize = '';
        var base = parseFloat(W.getComputedStyle(e).fontSize), px = base;
        for (var n = 0; n < 4 && e.clientWidth > 0 && e.scrollWidth > e.clientWidth + 1 && px > base * FIT_MIN + 0.1; n++) {
          px = Math.max(base * FIT_MIN, px * (e.clientWidth - 1) / e.scrollWidth);
          e.style.fontSize = px.toFixed(2) + 'px';
        }
        e.setAttribute('data-fit', px < base - 0.1 ? (px / base).toFixed(2) : '1');
      }
      /* a marks row too wide for a narrow cell (every slot up, off the record) draws a little smaller, never cut: its labels and counts stay whole */
      var rowsOf = strip && strip.querySelectorAll ? strip.querySelectorAll('.dp-lay-face .dp-lay-marks') : [];
      for (var j = 0; j < rowsOf.length; j++) {
        var r = rowsOf[j]; r.style.zoom = '';
        if (r.clientWidth > 0 && r.scrollWidth > r.clientWidth + 1) r.style.zoom = Math.max(MARKS_MIN, (r.clientWidth - 1) / r.scrollWidth).toFixed(3);
      }
    }
    var MARKS_MIN = 0.8;
    function fitSoon() {
      if (fitQueued || !root || typeof root.requestAnimationFrame !== 'function') return;
      fitQueued = true; root.requestAnimationFrame(fitNames);
      if (root.document && root.document.fonts && root.document.fonts.ready && typeof root.document.fonts.ready.then === 'function') root.document.fonts.ready.then(function () { if (!dead) root.requestAnimationFrame(fitNames); });
    }
    function onResize() { if (!dead && strip) fitSoon(); }
    if (root && typeof root.addEventListener === 'function') root.addEventListener('resize', onResize);
    /* the hard start draws its own name plates (scene.mode start), so the strip's crew cells stand down while it runs */
    function crewDrawn() { return state.faces.length > 0 && state.mode !== 'start'; }
    function banded() { return !(opts && typeof opts.band === 'function') || opts.band() === true; }
    function hasStrip() { return banded() && (state.phase !== null || state.security !== null || state.onair || state.faces.length > 0 || lamp !== null); }
    function paintMic() {
      if (!slots) return;
      var m = slots.mic, have = m.querySelector('.dp-onair');
      if (lamp) {
        if (!have) { m.textContent = ''; have = add(m, 'span', 'dp-onair'); add(have, 'span', 'dp-onair-text'); add(have, 'span', 'dp-onair-clock'); }
        have.setAttribute('data-state', lamp.off ? 'off' : 'on');
        var t = have.querySelector('.dp-onair-text'), c = have.querySelector('.dp-onair-clock');
        if (t.textContent !== lamp.text) t.textContent = lamp.text;
        if (c.textContent !== lamp.clock) c.textContent = lamp.clock;      /* the off-the-record countdown rewrites this one text, nothing else */
        return;
      }
      m.textContent = '';
      if (state.onair) add(m, 'span', 'dp-lay-onair', 'ON AIR');
    }
    function paintStrip() {
      if (!hasStrip()) {
        if (strip && strip.parentNode) strip.parentNode.removeChild(strip);
        strip = null; slots = null;
        rootClass('dp-lay-on', false); rootClass('dp-lay-crew', false); rootClass('dp-lay-solo', false);
        return;
      }
      if (!strip) {
        strip = doc.createElement('div'); strip.className = 'dp-lay-strip'; strip.setAttribute('aria-hidden', 'true');
        slots = {};
        SLOTS.forEach(function (k) { var s = add(strip, 'div', 'dp-lay-slot dp-lay-s-' + k); s.setAttribute('data-slot', k); slots[k] = s; });
        container.appendChild(strip);
      }
      paintMic();
      slots.phase.textContent = '';
      if (state.phase) add(slots.phase, 'span', 'dp-lay-phase', PHASE_LABEL[state.phase]);
      slots.sec.textContent = '';
      if (state.security !== null) {
        var sec = add(slots.sec, 'span', 'dp-lay-sec'); sec.setAttribute('data-level', String(state.security));
        for (var i = 0; i < SECURITY; i++) add(sec, 'i', i <= state.security ? 'on' : '');
      }
      slots.crew.textContent = '';
      state.faces.forEach(function (f) {
        var cell = add(slots.crew, 'span', 'dp-lay-face');
        if (f.pcId) { if (f.stress !== undefined || f.harm || f.locks) cell.classList.add('dp-lay-pc'); paintPc(cell, f); return; }
        cell.classList.add('dp-lay-npc'); cell.setAttribute('title', f.name);
        add(cell, 'b', 'dp-lay-name', f.name);
      });
      /* an empty slot gives its width to the others (display/shows.css: an empty slot is no width); with nothing but the crew, portrait drops its top row */
      var solo = crewDrawn() && !lamp && !state.onair && state.phase === null && state.security === null;
      rootClass('dp-lay-on', true); rootClass('dp-lay-crew', crewDrawn()); rootClass('dp-lay-solo', solo);
      if (crewDrawn()) fitSoon();
    }
    /* the lamp from app/display/onair.js: { off, text, clock } while the iPad's mic is live ('On air', or 'Off the record' over its countdown),
       null when it is not. A new countdown repaints the lamp alone; the lamp coming or going is a change to the strip (it may be its only slot) */
    function mic(m) {
      if (dead) return;
      var next = m && typeof m === 'object' ? { off: m.off === true, text: typeof m.text === 'string' ? m.text : (m.off === true ? 'Off the record' : 'On air'),
        clock: typeof m.clock === 'string' ? m.clock : '' } : null;
      if (next === null && lamp === null) return;
      if (next && lamp && next.off === lamp.off && next.text === lamp.text && next.clock === lamp.clock) return;
      var shape = (next === null) !== (lamp === null);
      lamp = next;
      if (shape) paintStrip(); else paintMic();
    }
    /* suite 2.9 (map.flashback): the flashback look gains grain and a caption (CSS on data-flash-look) while the switch is on; with it off the attribute is never set */
    function look() {
      var yes = state.filter === 'flashback' && !!(root.B68Flags && root.B68Flags.on('map.flashback'));
      if (yes) container.setAttribute('data-flash-look', '1'); else container.removeAttribute('data-flash-look');
    }
    var offFlags = root.B68Flags && typeof root.B68Flags.subscribe === 'function' ? root.B68Flags.subscribe(function () { if (dead) return; look(); if (opts && typeof opts.band === 'function') { if (!banded()) lamp = null; paintStrip(); } }) : null;
    function apply(layers) {
      if (dead) return;
      state = clean(layers);
      look();
      Object.keys(ATTRS).forEach(function (a) { var v = state[ATTRS[a]]; if (v === null || v === undefined) container.removeAttribute(a); else container.setAttribute(a, String(v)); });
      if (state.onair) container.setAttribute('data-band-onair', '1'); else container.removeAttribute('data-band-onair');
      paintStrip();
      if (root.B68DisplayMontage) root.B68DisplayMontage.paint(container, state.montage, doc, opts && typeof opts.figure === 'function' ? { figure: opts.figure } : null);      /* suite 2.8: nothing is drawn (or removed) while the layer is unset */
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
    var api = {
      apply: apply, message: msg, sceneLoaded: sceneLoaded, mic: mic, banded: banded, state: function () { return state; },
      destroy: function () {
        dead = true;
        for (var i = live.length - 1; i >= 0; i--) if (live[i].api === api) live.splice(i, 1);
        if (typeof offFlags === 'function') offFlags();
        container.removeAttribute('data-flash-look');
        if (root.removeEventListener) { root.removeEventListener('message', onMessage); root.removeEventListener('resize', onResize); }
        if (strip && strip.parentNode) strip.parentNode.removeChild(strip);
        strip = null; slots = null; lamp = null;
        rootClass('dp-lay-on', false); rootClass('dp-lay-crew', false); rootClass('dp-lay-solo', false);
        if (root.B68DisplayMontage) root.B68DisplayMontage.paint(container, [], doc);
        Object.keys(ATTRS).forEach(function (a) { container.removeAttribute(a); }); container.removeAttribute('data-band-onair');
      }
    };
    live.push({ container: container, api: api });
    return api;
  }
  /* mic(container, lamp | null): the lamp goes into the band attached to that container; false when there is none (onair.js then draws its own) */
  function micFor(container, m) {
    for (var i = live.length - 1; i >= 0; i--) if (live[i].container === container) {
      if (!live[i].api.banded()) { live[i].api.mic(null); return false; }      /* the band is off: the lamp draws in its own corner */
      live[i].api.mic(m); return true;
    }
    return false;
  }
  return { attach: attach, clean: clean, message: message, mic: micFor, PHASES: PHASES, PHASE_LABEL: PHASE_LABEL, SLOTS: SLOTS };
});
