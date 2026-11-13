/* sheet/handouts.js: the player's Handouts on a phone (the players' screen build, IP4; setting phone.handouts).

   Window.B68Handouts, and module.exports under Node. A lazy bundle (routes.js 'handouts'): boot.js fetches it only while the setting is on and only for a
   player, and calls start() / stop() from every campaign arrival, so with the setting off a phone loads nothing and makes no request of this kind.

   WHAT IT READS. The GM sends a player a handout from the GM page (gm/handout-send.js): ONE row in the docs store per player, kind 'handout', owner = this
   player, scope 'player', json { v: 1, items: [{ id, title, file, at }] }. GET /api/docs?kind=handout gives this player their own row and nothing else
   (functions/_lib/docs.js: a player reads public rows and their own player rows; the GM writes no public row of this kind). This file never writes.
   It reads at start, on the LiveHub's 'docs' poke, when the page comes back into view, and every 30 s while it is in view (the pattern of sheet/debrief.js).

   WHAT IT DRAWS
   - button() -> the Handouts button for the sheet's top bar (tracker.js puts it after Table, so it is one tap away on the old sheet and on every screen of
     the four-screen sheet): the count when the player holds any, and a dot when one arrived after they last opened the list.
   - open(): the list, full screen: newest first, each with its title (drawn first), when it was given, and a thumbnail (the same file, scaled by CSS, loaded
     lazily). With none: "Nothing yet. The GM can send you anything you are handed at the table." A thumbnail that fails: "Needs a connection".
   - view(id): one handout full screen on a dark ground, the title on top, the picture in a scrolling box (the browser's own pinch-zoom; a double tap or Zoom
     shows it at full size, to pan by dragging), Close at the foot. Esc closes the viewer, then the list.
   - A new handout raises one quiet toast ("<Title> is in your Handouts"). One the GM takes back leaves the list; an open viewer closes with "The GM took this back".
   Which handouts the player has seen is kept on this phone (localStorage b68.handouts.seen: the newest `at` seen when the list was last open).
   The images are static files (media/handouts/<hash>.png, never cached by the service worker); every file name comes from this player's own row and is
   checked as a plain file name. Everything is drawn with textContent and DOM nodes.

   API: start() stop() refresh() button() -> markup ('' when not started) open() view(id) close() state()
   pure (Node tests): clean(rowJson) -> [{ id, title, file, at }] newest first     fresh(items, seen) -> n     toastText(items) -> string */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68Handouts = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var KIND = 'handout', POLL_MS = 30000, MAX = 100, DIR = 'media/handouts/', SEEN_KEY = 'b68.handouts.seen';
  var FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,78}\.(?:png|jpe?g|gif|webp|svg)$/i;
  var EMPTY = 'Nothing yet. The GM can send you anything you are handed at the table.';
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function one(s, max) { return str(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }

  /* only what this page draws, checked; newest first */
  function clean(json) {
    var seen = {}, out = [];
    (isObj(json) && Array.isArray(json.items) ? json.items : []).forEach(function (x) {
      if (!isObj(x)) return;
      var id = one(x.id, 80), file = str(x.file), at = typeof x.at === 'number' && isFinite(x.at) && x.at > 0 ? Math.floor(x.at) : 0;
      if (!id || seen[id] || !FILE_RE.test(file) || file.indexOf('..') >= 0) return;
      seen[id] = 1; out.push({ id: id, title: one(x.title, 200) || 'A handout', file: file, at: at });
    });
    out = out.slice(-MAX);
    return out.map(function (x, i) { return { x: x, i: i }; }).sort(function (a, b) { return (b.x.at - a.x.at) || (b.i - a.i); }).map(function (o) { return o.x; });
  }
  function fresh(items, seen) { return (items || []).filter(function (x) { return x.at > (+seen || 0); }).length; }
  function toastText(items) {
    if (!items || !items.length) return '';
    return items.length === 1 ? items[0].title + ' is in your Handouts' : items[0].title + ' and ' + (items.length - 1) + ' more are in your Handouts';
  }
  function whenText(at) {
    if (!at) return '';
    try { return 'Given ' + new Date(at).toLocaleString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; }
  }

  var items = [], loaded = false, known = null, started = false, off = null, pollT = null, busy = false, again = false, vis = null, onClick = null;
  var list = null, viewer = null, seenMem = null;
  function seenAt() {
    if (seenMem !== null) return seenMem;
    try { seenMem = Math.max(0, Math.floor(+(W.localStorage && W.localStorage.getItem(SEEN_KEY)) || 0)); } catch (e) { seenMem = 0; }
    return seenMem;
  }
  function markSeen() {
    var top = items.reduce(function (m, x) { return Math.max(m, x.at); }, 0);
    if (top <= seenAt()) return false;
    seenMem = top; try { if (W.localStorage) W.localStorage.setItem(SEEN_KEY, String(top)); } catch (e) { /* private mode: this visit remembers it */ }
    return true;
  }
  function toast(m, bad) { var A = W && W.B68; if (A && typeof A.toast === 'function') A.toast(m, bad); }
  function redraw() {
    var T = W && W.B68Tracker;
    if (T && typeof T.refresh === 'function' && typeof T.isOpen === 'function' && T.isOpen()) { try { T.refresh(); } catch (e) { if (W.console) W.console.error(e); } }
  }

  function apply(json) {
    var before = JSON.stringify(items), next = clean(json);
    items = next; loaded = true;
    var ids = {}; next.forEach(function (x) { ids[x.id] = 1; });
    if (known) {
      var arrived = next.filter(function (x) { return !known[x.id]; });
      if (arrived.length) toast(toastText(arrived));
    }
    known = ids;
    if (viewer && !ids[viewer.id]) { closeViewer(); toast('The GM took this back'); }
    if (JSON.stringify(items) !== before) { if (list) paintList(); redraw(); }
  }
  function refresh() {
    if (!started) return;
    if (busy) { again = true; return; }
    busy = true;
    W.fetch('/api/docs?kind=' + KIND + '&limit=5', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } }).then(function (res) { return res.ok ? res.json() : null; }).then(function (j) {
      if (!started || !j) return;
      var rows = Array.isArray(j.docs) ? j.docs : [], r = rows.filter(function (d) { return isObj(d) && d.kind === KIND && d.scope === 'player'; })[0];
      apply(r ? r.json : null);
    }).then(null, function () { /* offline or signed out: the list stays as it was */ }).then(function () {
      busy = false;
      if (again) { again = false; refresh(); }
    });
  }

  function start() {
    if (started || !W || typeof W.fetch !== 'function') return;
    started = true;
    if (W.B68Live && typeof W.B68Live.on === 'function') { try { off = W.B68Live.on(['docs'], refresh); } catch (e) { off = null; } }
    pollT = W.setInterval(function () { if (!W.document || !W.document.hidden) refresh(); }, POLL_MS);
    if (W.document && typeof W.document.addEventListener === 'function') {
      vis = function () { if (!W.document.hidden) refresh(); }; W.document.addEventListener('visibilitychange', vis);
      onClick = function (e) { var t = e.target && e.target.closest ? e.target.closest('[data-b68="handouts-open"]') : null; if (t) { e.preventDefault(); open(); } };
      W.document.addEventListener('click', onClick);
    }
    redraw();      /* the button shows at once (with no count until the first answer) */
    refresh();
  }
  function stop() {
    if (!started) return;
    started = false;
    if (off) { try { off(); } catch (e) { /* gone */ } off = null; }
    if (pollT) { W.clearInterval(pollT); pollT = null; }
    if (vis && W.document) { W.document.removeEventListener('visibilitychange', vis); vis = null; }
    if (onClick && W.document) { W.document.removeEventListener('click', onClick); onClick = null; }
    close();
    items = []; loaded = false; known = null;
    redraw();
  }

  /* the sheet's top-bar button: an element's own markup (built as nodes, so every attribute and word is set as text) */
  function button() {
    if (!started || !W || !W.document) return '';
    var n = items.length, nw = fresh(items, seenAt()), b = W.document.createElement('button');
    b.type = 'button'; b.className = 'btn sm ds-hobtn' + (nw ? ' new' : '');
    b.setAttribute('data-b68', 'handouts-open'); b.setAttribute('data-always', '1'); b.setAttribute('aria-haspopup', 'dialog');
    b.setAttribute('aria-label', 'Handouts' + (n ? ', ' + n : '') + (nw ? ', ' + nw + ' new' : ''));
    b.title = 'What the GM has handed you';
    b.appendChild(W.document.createTextNode('Handouts'));
    if (n) { var c = W.document.createElement('span'); c.className = 'ds-ho-n'; c.setAttribute('aria-hidden', 'true'); c.textContent = String(n); b.appendChild(c); }
    if (nw) { var d = W.document.createElement('span'); d.className = 'ds-tdot'; d.setAttribute('aria-hidden', 'true'); b.appendChild(d); }
    return b.outerHTML;
  }

  function el(tag, cls, text) { var e = W.document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function btn(cls, text, fn) { var b = el('button', cls, text); b.type = 'button'; b.addEventListener('click', fn); return b; }
  function focusIn(n) { if (n && typeof n.focus === 'function') { try { n.focus({ preventScroll: true }); } catch (e) { /* not focusable */ } } }
  function src(x) { return DIR + encodeURIComponent(x.file); }
  function layer(cls, label) {
    var d = el('div', cls); d.setAttribute('role', 'dialog'); d.setAttribute('aria-modal', 'true'); d.setAttribute('aria-label', label);
    return d;
  }
  function backTo(n) { var body = W.document.body; if (n && body && typeof body.contains === 'function' && body.contains(n)) focusIn(n); }

  /* ---------- the list ---------- */
  function open() {
    if (!started || !W || !W.document) return false;
    if (list) { focusIn(list.x); return true; }
    var from = W.document.activeElement, d = layer('ds-ho-list', 'Handouts');
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); e.stopPropagation(); closeList(); } });
    var top = el('div', 'ds-ho-top'), h = el('h2', 'ds-ho-h', 'Handouts');
    top.appendChild(h);
    var body = el('div', 'ds-ho-body'), foot = el('div', 'ds-ho-foot'), x = btn('btn ds-ho-close', 'Close', function () { closeList(); });
    foot.appendChild(x);
    d.appendChild(top); d.appendChild(body); d.appendChild(foot);
    W.document.body.appendChild(d);
    list = { el: d, body: body, x: x, from: from };
    paintList();
    focusIn(x);
    if (markSeen()) redraw();      /* looked at: the dot goes */
    refresh();
    return true;
  }
  function paintList() {
    if (!list) return;
    var body = list.body, keep = body.scrollTop;
    while (body.firstChild) body.removeChild(body.firstChild);
    if (!items.length) { body.appendChild(el('p', 'ds-ho-empty', loaded ? EMPTY : 'Looking for your handouts…')); return; }
    var ul = el('ul', 'ds-ho-items'), imgs = [];
    items.forEach(function (x) {
      var li = el('li', 'ds-ho-item'), b = btn('ds-ho-open', '', function () { view(x.id); });
      b.setAttribute('aria-label', 'Open ' + x.title);
      var th = el('span', 'ds-ho-th'), t = el('span', 'ds-ho-t'), tt = el('b', 'ds-ho-title', x.title);
      t.appendChild(tt);
      var w = whenText(x.at); if (w) t.appendChild(el('span', 'ds-ho-when', w));
      b.appendChild(th); b.appendChild(t); li.appendChild(b); ul.appendChild(li);
      imgs.push([th, x]);
    });
    body.appendChild(ul);
    body.scrollTop = keep;
    /* the titles are on screen first; the thumbnails (the full file, 1 to 5 MB) are asked for after, and lazily */
    W.setTimeout(function () {
      imgs.forEach(function (p) {
        if (!list || !p[0].isConnected) return;
        var img = el('img', 'ds-ho-img'); img.alt = ''; img.decoding = 'async'; img.loading = 'lazy'; img.draggable = false;
        img.onerror = function () { if (img.parentNode) img.parentNode.removeChild(img); p[0].classList.add('bad'); p[0].textContent = 'Needs a connection'; };
        img.src = src(p[1]); p[0].appendChild(img);
      });
    }, 0);
  }
  function closeList() {
    if (viewer) closeViewer(false);
    if (!list) return;
    var l = list; list = null;
    if (l.el.parentNode) l.el.parentNode.removeChild(l.el);
    var b = W.document.querySelector && W.document.querySelector('#dossier .ds-hobtn');
    backTo(b || l.from);
  }

  /* ---------- one handout, full screen ---------- */
  function view(id) {
    var x = items.filter(function (i) { return i.id === id; })[0];
    if (!started || !x || !W || !W.document) return false;
    closeViewer(false);
    var from = W.document.activeElement, d = layer('ds-ho-v', x.title);
    d.addEventListener('keydown', function (e) { if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); e.stopPropagation(); closeViewer(); } });
    var top = el('div', 'ds-ho-vtop'), h = el('h2', 'ds-ho-vh', x.title);
    top.appendChild(h);
    var w = whenText(x.at); if (w) top.appendChild(el('span', 'ds-ho-vwhen', w));
    var stage = el('div', 'ds-ho-stage'), img = el('img', 'ds-ho-vimg');
    img.alt = x.title; img.decoding = 'async'; img.draggable = false;
    var foot = el('div', 'ds-ho-vfoot'), zoom = btn('btn ds-ho-zoom', 'Zoom in', function () { toggleZoom(); }), x2 = btn('btn primary ds-ho-vx', 'Close', function () { closeViewer(); });
    zoom.setAttribute('aria-pressed', 'false');
    foot.appendChild(zoom); foot.appendChild(x2);
    d.appendChild(top); d.appendChild(stage); d.appendChild(foot);
    var v = viewer = { id: id, el: d, stage: stage, img: img, zoom: zoom, from: from, big: false };
    function toggleZoom(px, py) {
      if (!v.img.naturalWidth) return;
      var s = v.stage, r = s.getBoundingClientRect(), fx = px == null ? 0.5 : (px - r.left + s.scrollLeft) / Math.max(1, s.scrollWidth), fy = py == null ? 0.5 : (py - r.top + s.scrollTop) / Math.max(1, s.scrollHeight);
      v.big = !v.big; s.classList.toggle('big', v.big);
      v.zoom.textContent = v.big ? 'Fit to screen' : 'Zoom in'; v.zoom.setAttribute('aria-pressed', String(v.big));
      s.scrollLeft = Math.max(0, fx * s.scrollWidth - s.clientWidth / 2); s.scrollTop = Math.max(0, fy * s.scrollHeight - s.clientHeight / 2);
    }
    img.addEventListener('dblclick', function (e) { e.preventDefault(); toggleZoom(e.clientX, e.clientY); });
    img.onerror = function () {
      if (viewer !== v) return;
      while (stage.firstChild) stage.removeChild(stage.firstChild);
      stage.appendChild(el('p', 'ds-ho-none', 'Needs a connection. The picture loads from the internet: try again when you have signal.'));
      zoom.disabled = true;
    };
    img.src = src(x);
    stage.appendChild(img);
    W.document.body.appendChild(d);
    focusIn(x2);
    return true;
  }
  function closeViewer(restore) {
    if (!viewer) return;
    var v = viewer; viewer = null;
    if (v.el.parentNode) v.el.parentNode.removeChild(v.el);
    if (restore !== false) {
      var b = list && list.body.querySelector ? [].filter.call(list.body.querySelectorAll('.ds-ho-open'), function (e) { return e.getAttribute('aria-label') === 'Open ' + (v.img.alt || ''); })[0] : null;
      backTo(b || (list ? list.x : v.from));
    }
  }
  function close() { closeViewer(false); closeList(); }

  function state() { return { started: started, loaded: loaded, items: items.slice(), fresh: fresh(items, seenAt()), list: !!list, viewer: viewer ? viewer.id : null }; }

  return { KIND: KIND, start: start, stop: stop, refresh: refresh, button: button, open: open, view: view, close: close, state: state,
    clean: clean, fresh: fresh, toastText: toastText, _set: function (j) { apply(j); } };
});
