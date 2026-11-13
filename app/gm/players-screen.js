/* gm/players-screen.js: the GM page's side of the players' screen, map first (IP2, behind the display setting stage.players). In the gm bundle.
   It only defines B68GmPlayersScreen when it loads; gm-page.js calls it only while the setting is on, so off nothing here runs.
   ES5, window.B68GmPlayersScreen in the browser, module.exports under Node.

   WHAT IT DOES (each from a one-line branch in gm-page.js):
     offerLine(o, offer, show)   Next landing on a public event: the 8-second line is NOT sent; the GM gets the actionable notice instead (the line and
                                 Send). Send shows it exactly as before; nothing shows if the GM does nothing. The notice stays through the publish
                                 that follows the beat (keep: true).
     apLine(el, on)              the iPad view's Autopilot row says why it sends nothing: "Map first: you send NPCs."
     scene(host, p)              a scene tile, Pin or Auto, Next scene, a cue's scene: the ambient write, then whatever covers the scene comes down
                                 (a blank push, as Roll the opening credits does), so the new scene plays at once. Re-picking the scene that is up
                                 does nothing. Lasting layers (a flashback, a montage, the hard start, the Aftermath) and an overlay stay: they are the
                                 GM's own and come down with Clear. A scene file the iPad cannot load is named in a toast (probe).
     openCard(host, id)          Show on iPad, Introduce and a held spotlight open that NPC's card on this page: the Run view's card beside the
                                 right column, and the cast list's card; never while the GM is typing in a field (it opens when the field is left).
     notesMd(npc)                with no vault card, the app's own GM notes as the card: Tell: and Signature: first.
   Pure: no network but probe (a HEAD of the scene file, as the theme probe does). */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else if (root) root.B68GmPlayersScreen = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var AP_WHY = 'Map first: you send NPCs.';
  var PROBE_MS = 20000;      /* the iPad's own watchdog (display-page.js createAmbient T.watchdogMs) */
  /* the scene files, as the display names them (display-page.js Pure.AMBIENT_SCENES; players-screen.test.mjs checks the two agree) */
  var FILES = { harvest: 'second-harvest.html', watch: 'watch-feed.html', duskwall: 'duskwall-after-dark.html', boneyard: 'boneyard-dawn.html', undertow: 'undertow.html',
    vet: 'grunts-vet.html', tram: 'night-tram.html', lurker: 'lurker-press.html', cards: 'calling-cards.html', pells: 'pells-provisions.html', wanted: 'wanted-wall.html',
    meeting: 'planning-meeting.html', credits: 'opening-credits.html', veil: 'sunrise-ball-opening.html', board: 'planning-board.html', exploded: 'score-exploded.html',
    testcard: 'test-card.html' };
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }

  /* ---- IP2.3 B: the public line waits for Send ---- */
  /* q (IP2b, optional) = { root, log(text) }: the lines wait in a short queue of their own (lines()) instead of the page's one-slot notice */
  function offerLine(o, offer, show, q) {
    if (!isObj(o)) return Promise.resolve(null);
    var t = str(o.text).trim(); if (!t) return Promise.resolve(null);
    if (isObj(q) && q.root) { lines(q).add(o, show); return Promise.resolve(null); }
    if (typeof offer !== 'function') return Promise.resolve(null);
    offer({ text: 'Public line: “' + t + '”', label: 'Send', keep: true, run: function () { return typeof show === 'function' ? show(o) : null; } });
    return Promise.resolve(null);
  }

  /* ---- IP2b/IP2c: the public lines, a short queue (at most LINES_MAX), each with Send and Not now. Shown OLDEST first and at most two rows, then a
     quiet "+ n more" that opens the rest in place (it closes again at two or fewer). Every line goes to the night log as it is queued (so a reload
     loses nothing untraced), and again when it is pushed out by a sixth, put away with Not now, or dropped at the night's end (clear). One per page.
     The box is placed where it covers no control: the lowest spot in the bottom of the window that meets no button, field, link or Board room card
     (and leaves the Blade rail's strip alone). It moves only when a line comes or goes, "+ n more" opens or closes, or on a resize, and never under
     the GM's hand (see place). ---- */
  var LINES_MAX = 5, LINES_SHOWN = 2, QS = [];
  function linesPure() {
    var list = [];
    return {
      list: list,
      add: function (o) { list.unshift({ id: 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), o: o }); return list.length > LINES_MAX ? list.splice(LINES_MAX) : []; },
      take: function (id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list.splice(i, 1)[0]; return null; },
      /* the rows to draw: oldest first; collapsed, the oldest two and how many more */
      rows: function (open) { var all = list.slice().reverse(); return open || all.length <= LINES_SHOWN ? { rows: all, more: 0 } : { rows: all.slice(0, LINES_SHOWN), more: all.length - LINES_SHOWN }; },
      clear: function () { return list.splice(0); },
      /* IP2d: what a form shows: 'two' (two rows, + n more), 'one' (one row, + n more), 'chip' (no row: n waiting), 'open' (every row) */
      view: function (form) { var all = list.slice().reverse(), k = form === 'open' ? all.length : form === 'one' ? 1 : form === 'chip' ? 0 : LINES_SHOWN; return { rows: all.slice(0, k), more: form === 'chip' || form === 'open' ? 0 : Math.max(0, all.length - k), chip: form === 'chip' ? all.length : 0 }; }
    };
  }
  /* where the box goes: candidate spots (x, y, top-left of a w x h box) scanned from the bottom right; the first that meets none of `avoid` (rects) */
  function spotFor(W0, H0, w, h, avoid, railW, near) {
    var hit = function (x, y) { for (var i = 0; i < avoid.length; i++) { var a = avoid[i]; if (!(a.left >= x + w || a.right <= x || a.top >= y + h || a.bottom <= y)) return true; } return false; };
    var best = null, bd = Infinity;
    for (var y = H0 - h - 6; y >= H0 * 0.45; y -= 8) for (var x = W0 - railW - w - 8; x >= 8; x -= 16) {
      if (hit(x, y)) continue;
      if (!near) return { x: x, y: y };
      var dd = (x - near.x) * (x - near.x) + (y - near.y) * (y - near.y); if (dd < bd) { bd = dd; best = { x: x, y: y }; }
    }
    return best;
  }
  /* IP2c: does a box (x, y, w, h) meet any of avoid, or leave the window? */
  function covers(x, y, w, h, avoid, W0, H0) {
    if (x < 0 || y < 0 || x + w > W0 || y + h > H0) return true;
    for (var i = 0; i < avoid.length; i++) { var a = avoid[i]; if (!(a.left >= x + w || a.right <= x || a.top >= y + h || a.bottom <= y)) return true; }
    return false;
  }
  function lines(q) {
    var root = q.root, rec = QS.filter(function (x) { return x.root === root; })[0];
    if (!rec) { rec = { root: root, p: linesPure(), el: null, show: null, open: false, hover: false, hoverT: null, at: null }; QS.push(rec); if (QS.length > 4) QS.shift(); }
    rec.q = q;
    function log(text) { try { if (typeof rec.q.log === 'function') rec.q.log(text); } catch (e) { /* the log is a nicety */ } }
    /* IP2c (the delta review): the box never moves under the GM's hand. While the pointer is over it (and for 600 ms after it leaves) or it holds
       the focus, it stays put; a re-place asked meanwhile runs once the hand has gone. Otherwise it is placed when a line comes or goes, the list
       opens or closes, the window is resized, or (IP2d) the page under it changes; never on a timer or a scroll. It keeps its spot unless that spot
       now meets a control (or leaves the window), and then moves the shortest way that clears it.
       IP2d (a small laptop): collapsed, it SHRINKS before it covers anything: two rows and "+ n more", else one row and "+ n more", else a one-line
       chip ("3 lines waiting") that opens the list on a press. Only the open list may sit over a control (the GM asked for it). */
    var FORMS = ['two', 'one', 'chip'];
    function held() { var d = root.ownerDocument, a = d && d.activeElement; return rec.hover || !!(a && rec.el && rec.el.contains(a)); }
    function avoidList(d, el, H0) {
      var avoid = [];
      [].forEach.call(d.querySelectorAll('button, input, select, textarea, a[href], [role="button"], .rv-card'), function (n) {
        if (el.contains(n)) return; var r = n.getBoundingClientRect(); if (r.width && r.height && r.bottom > H0 * 0.4 && r.top < H0) avoid.push(r);
      });
      return avoid;
    }
    function place() {
      var el = rec.el, d = root.ownerDocument, win = d && d.defaultView; if (!el || el.hidden || !win) return;
      if (held()) { rec.owed = true; return; }      /* asked while held: done once the hand has gone */
      rec.owed = false;
      var W0 = win.innerWidth, H0 = win.innerHeight, avoid = avoidList(d, el, H0), es = el.style, forms = rec.open ? ['open'] : FORMS;
      for (var i = 0; i < forms.length; i++) {
        if (rec.form !== forms[i]) build(forms[i]);
        var w = el.offsetWidth, h = el.offsetHeight;
        if (rec.at && !covers(rec.at.x, rec.at.y, w, h, avoid, W0, H0)) { es.left = rec.at.x + 'px'; es.top = rec.at.y + 'px'; return; }      /* its spot still clears every control */
        var s = spotFor(W0, H0, w, h, avoid, 60, rec.at);
        if (s) { rec.at = s; es.right = ''; es.bottom = ''; es.left = s.x + 'px'; es.top = s.y + 'px'; return; }
      }
      var fw = el.offsetWidth, fh = el.offsetHeight;      /* nowhere clear even as a chip (or the open list): bottom right, as before */
      rec.at = { x: Math.max(8, W0 - 60 - fw - 8), y: Math.max(8, H0 - fh - 6) }; es.right = ''; es.bottom = ''; es.left = rec.at.x + 'px'; es.top = rec.at.y + 'px';
    }
    /* the rows of one form; the focus kept on the same row's same button (IP2d) */
    function build(form) {
      var el = rec.el, d = el.ownerDocument, a = d.activeElement, keep = a && el.contains(a) ? { line: a.getAttribute('data-p2-line'), id: a.getAttribute('data-id') } : null;
      var V = rec.p.view(form);
      rec.form = form; el.textContent = '';
      el.style.width = form === 'chip' ? 'auto' : 'min(430px, 34vw)';
      V.rows.forEach(function (it) {
        var row = d.createElement('div'); row.className = 'gm-p2-line'; row.style.display = 'flex'; row.style.alignItems = 'center'; row.style.gap = '6px';
        var t = d.createElement('span'); t.className = 'gm-p2-text'; t.style.flex = '1 1 auto'; t.style.minWidth = '0'; t.style.overflow = 'hidden'; t.style.textOverflow = 'ellipsis'; t.style.whiteSpace = 'nowrap';
        t.textContent = 'Public line: “' + str(it.o.text).trim() + '”'; t.title = t.textContent; row.appendChild(t);
        [['send', 'Send', 'btn sm primary'], ['later', 'Not now', 'btn sm']].forEach(function (b) {
          var x = d.createElement('button'); x.type = 'button'; x.className = b[2]; x.setAttribute('data-p2-line', b[0]); x.setAttribute('data-id', it.id); x.textContent = b[1]; x.style.flex = '0 0 auto'; row.appendChild(x);
        });
        el.appendChild(row);
      });
      if (V.more || V.chip || form === 'open') {
        var m = d.createElement('button'); m.type = 'button'; m.className = V.chip ? 'gm-p2-chip' : 'gm-p2-more'; m.setAttribute('data-p2-line', 'more');
        m.textContent = form === 'open' ? 'Show fewer' : V.chip ? V.chip + (V.chip === 1 ? ' public line waiting' : ' public lines waiting') : '+ ' + V.more + ' more';
        var ms = m.style; ms.background = 'none'; ms.border = '0'; ms.color = V.chip ? '#f2ede1' : '#c9c1b2'; ms.font = 'inherit'; ms.fontSize = V.chip ? '13px' : '12px'; ms.padding = '0 2px'; ms.textAlign = 'left'; ms.cursor = 'pointer'; ms.justifySelf = 'start';
        el.appendChild(m);
      }
      if (keep) { var back = el.querySelector('[data-p2-line="' + keep.line + '"]' + (keep.id ? '[data-id="' + keep.id + '"]' : '')) || (keep.line === 'more' ? null : el.querySelector('[data-p2-line="more"]')); if (back && back.focus) back.focus(); }
    }
    function draw() {
      var d = root.ownerDocument || (W && W.document); if (!d) return;
      if (!rec.el || !rec.el.isConnected) {
        rec.el = d.createElement('div'); rec.el.id = 'gm-p2-lines'; rec.el.className = 'gm-p2-lines'; rec.el.setAttribute('role', 'region'); rec.el.setAttribute('aria-label', 'Public lines waiting');
        var es = rec.el.style; es.position = 'fixed'; es.zIndex = '60'; es.width = 'min(430px, 34vw)'; es.display = 'grid'; es.gap = '3px';
        es.padding = '5px 8px'; es.background = '#1a1714'; es.color = '#f2ede1'; es.borderLeft = '4px solid #e0701e'; es.boxShadow = '0 2px 10px rgba(0,0,0,.35)'; es.fontSize = '13px';
        rec.el.addEventListener('click', function (ev) {
          var b = ev.target && ev.target.closest ? ev.target.closest('[data-p2-line]') : null; if (!b) return;
          var act = b.getAttribute('data-p2-line');
          if (act === 'more') { rec.open = !rec.open; draw(); return; }
          var it = rec.p.take(b.getAttribute('data-id')); if (!it) return;
          if (act === 'send') { Promise.resolve().then(function () { return typeof rec.show === 'function' ? rec.show(it.o) : null; }).then(null, function () { /* the page says why */ }); }
          else log('Public line not shown (Not now): ' + str(it.o.text).trim());
          draw();
        });
        rec.el.addEventListener('pointerenter', function () { clearTimeout(rec.hoverT); rec.hover = true; });
        rec.el.addEventListener('pointerleave', function () { clearTimeout(rec.hoverT); rec.hoverT = setTimeout(function () { rec.hover = false; if (rec.owed) place(); }, 600); });
        rec.el.addEventListener('focusout', function () { setTimeout(function () { if (rec.owed) place(); }, 0); });
        root.appendChild(rec.el); rec.at = null; rec.form = '';
        var win = d.defaultView; if (win && win.addEventListener && !rec.resizeOn) { rec.resizeOn = true; win.addEventListener('resize', function () { place(); }); }
        /* IP2d: the page under it changed (a redraw that moves controls): placed again, once things settle; the hold still applies; a scroll is no change */
        if (win && typeof win.MutationObserver === 'function') {
          var mt = null;
          rec.mo = new win.MutationObserver(function (recs) {
            for (var i = 0; i < recs.length; i++) { var t = recs[i].target; if (!(rec.el && (t === rec.el || rec.el.contains(t)))) { clearTimeout(mt); mt = setTimeout(function () { if (rec.el && !rec.el.hidden) place(); }, 400); return; } }
          });
          rec.mo.observe(root, { childList: true, subtree: true });
        }
      }
      if (rec.p.list.length <= LINES_SHOWN) rec.open = false;
      var n = rec.p.list.length;
      rec.el.hidden = !n; rec.el.style.display = n ? 'grid' : 'none';
      if (!n) { rec.el.textContent = ''; rec.at = null; rec.form = ''; return; }
      build(rec.open ? 'open' : (rec.form && rec.form !== 'open' ? rec.form : 'two'));
      if (!rec.open) rec.form = '';      /* a collapsed redraw tries the largest form first again */
      place();
    }
    return {
      add: function (o, show) {
        rec.show = show;
        log('Public line waiting for Send: ' + str(o.text).trim());      /* IP2c: in the night log from the moment it is queued, so a reload loses nothing untraced */
        rec.p.add(o).forEach(function (it) { log('Public line not shown (more than ' + LINES_MAX + ' waiting): ' + str(it.o.text).trim()); });
        draw();
      },
      /* IP2c: the night ends: every line still waiting is dropped, each written to the night log as not sent */
      clear: function (why) { rec.p.clear().reverse().forEach(function (it) { log('Public line not sent (' + (why || 'the night ended') + '): ' + str(it.o.text).trim()); }); rec.open = false; if (rec.el) draw(); },
      list: function () { return rec.p.list.map(function (it) { return str(it.o.text); }); }
    };
  }

  /* ---- IP2.3 E: the Autopilot row says why ---- */
  function apLine(el, on) {
    if (!el || typeof el.querySelector !== 'function') return;
    var w = el.querySelector('[data-p2-why]');
    if (on && !w) { var d = el.ownerDocument; w = d.createElement('span'); w.className = 'gm-dim'; w.setAttribute('data-p2-why', ''); w.textContent = ' ' + AP_WHY; el.appendChild(w); }
    else if (!on && w) w.parentNode.removeChild(w);
  }

  /* ---- IP2.4: a new scene just plays ---- */
  /* what the patch asks for: { pin: id } | { mode: 'auto' | 'off' } | { skip: true } | null (anything else: not a scene change) */
  function intent(p) {
    if (!isObj(p)) return null;
    if (p.skip === true) return { skip: true };
    if (p.mode === 'pin' && typeof p.scene === 'string') return { pin: p.scene };
    if (p.mode === 'auto' || p.mode === 'off') return { mode: p.mode };
    return null;
  }
  /* the scene already playing, unchanged by this pick: the shown display is blank and the pin names the scene pinned now */
  function same(it, cur, shownKind) {
    return !!it && !!it.pin && isObj(cur) && cur.mode === 'pin' && cur.scene === it.pin && shownKind === 'blank';
  }
  /* host = { patch(p) -> Promise<r | null>, shown() -> the display kind up ('' unknown), current() -> { mode, scene } of the ambient doc, blank() -> Promise,
             label(id) -> name, toast(m, bad), fetch(url, init) (optional) } */
  function scene(host, p) {
    var it = intent(p);
    var kind = str(host.shown());
    if (same(it, host.current(), kind)) return Promise.resolve(true);     /* re-picking the scene that is up: nothing */
    return Promise.resolve(host.patch(p)).then(function (r) {
      if (r === null || r === undefined || !it) return r;
      var cur = host.current() || {}, id = it.pin || (cur.mode === 'pin' ? cur.scene : '');
      var off = it.mode === 'off';
      /* the ambient plays only under a blank: the stage comes down, also when this page does not know what is up (Off leaves the stage alone) */
      var down = !off && kind !== 'blank' ? Promise.resolve().then(function () { return host.blank(); }).then(null, function () { return null; }) : Promise.resolve(null);
      return down.then(function () { if (id) probe(host, id); return r; });
    });
  }
  /* a HEAD of the scene file, like the theme probe: a scene the iPad cannot load is named, not silently skipped */
  function probe(host, id) {
    var f = FILES[id], fetch = host.fetch || (W && W.fetch);
    if (!f || typeof fetch !== 'function') return Promise.resolve(null);
    var url = 'ambient/' + f.replace(/\.html$/, ''), done = false;
    var say = function (why) { if (done) return; done = true; if (typeof host.toast === 'function') host.toast('The iPad could not load the scene ' + (str(host.label(id)) || id) + ' (' + why + '): it plays the next one. Pick another.', true); };
    var t = setTimeout(function () { say('no answer'); }, PROBE_MS);
    return Promise.resolve().then(function () { return fetch(url, { method: 'HEAD', credentials: 'same-origin', cache: 'no-store' }); }).then(function (r) {
      clearTimeout(t); if (done) return false;
      if (!r || !r.ok) { say(r ? 'HTTP ' + r.status : 'no answer'); return false; }
      done = true; return true;
    }, function () { clearTimeout(t); say('no answer'); return false; });
  }

  /* ---- IP2.5: the NPC's card opens on the GM page ---- */
  function typing(doc) {
    var a = doc && doc.activeElement; if (!a || !a.tagName) return false;
    var t = String(a.tagName).toUpperCase();
    if (t === 'TEXTAREA' || a.isContentEditable) return true;
    if (t !== 'INPUT') return false;
    var ty = String(a.type || 'text').toLowerCase();
    return ['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image'].indexOf(ty) < 0;
  }
  /* host = { doc, npc(id) -> the cast doc, rv() -> the Run view (showNpc) or null, cast(id) (the cast list's card open, redrawn) } */
  function openCard(host, id) {
    var d = host.npc(id); if (!isObj(d)) return false;
    var names = [str(d.name)].concat(Array.isArray(d.alias) ? d.alias.map(str) : typeof d.alias === 'string' ? [d.alias] : []).filter(Boolean);
    if (!names.length) return false;
    var go = function () {
      var rv = host.rv();
      if (rv && typeof rv.showNpc === 'function') rv.showNpc(names, names[0]);
      if (typeof host.cast === 'function') host.cast(id);
    };
    var doc = host.doc;
    if (typing(doc)) {      /* the GM is typing: the card waits until the field is left */
      var a = doc.activeElement, once = function () { a.removeEventListener('blur', once); setTimeout(go, 0); };
      a.addEventListener('blur', once);
      return 'later';
    }
    go();
    return true;
  }
  /* the app's own GM notes as the card (Markdown for the Prep card renderer): Tell: and Signature: first, then the rest */
  function notesMd(d) {
    if (!isObj(d)) return '';
    var lines = str(d.gmNotes).split(/\r?\n/), first = [], rest = [];
    lines.forEach(function (l) { if (/^\s*(tell|signature)\s*:/i.test(l)) first.push(l.trim()); else rest.push(l); });
    var head = [str(d.role), str(d.faction)].filter(Boolean).join(' · ');
    var body = first.map(function (l) { var m = l.match(/^(\w+)\s*:\s*(.*)$/); return m ? '**' + m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase() + ':** ' + m[2] : l; }).join('\n\n');
    var more = rest.map(function (l) { return l.trim(); }).filter(Boolean).join('\n\n');      /* each line of the notes is a paragraph of the card */
    var out = (head ? '*' + head + '*\n\n' : '') + body + (body && more ? '\n\n' : '') + more;
    return out.trim() ? out.trim() + '\n\n*No vault card: the cast notes.*' : '';
  }

  return { VERSION: 1, AP_WHY: AP_WHY, FILES: FILES, offerLine: offerLine, apLine: apLine, scene: scene, probe: probe, openCard: openCard, notesMd: notesMd,
    _pure: { intent: intent, same: same, typing: typing, linesPure: linesPure, LINES_MAX: LINES_MAX, spotFor: spotFor, covers: covers }, lines: lines };
});
