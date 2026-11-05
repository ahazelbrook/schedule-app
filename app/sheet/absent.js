/* sheet/absent.js — the absent-player packet on a phone (suite ticket 5.7, switch between.absent).

   Window.B68Absent, and module.exports under Node. A lazy bundle (routes.js 'absent'): boot.js fetches it only while the switch is on and calls start() / stop()
   from every campaign arrival, so with the switch off a phone loads nothing and makes no /api/docs call.

   The GM sends a player who missed the night ONE page (gm/absent.js): the row `packet` in the docs store, owner = this player, scope 'player'. This file only
   READS it (GET /api/docs?kind=packet: the store returns this player's own row and nothing else) and draws it. Until the player has opened it, now() is the
   sheet's Now card item (sheet/now.js) with one button; the button opens the page: the front page, "Previously on" (faces and three lines) and what changed on
   the sheet. Once opened it is no longer current: between() puts it in the sheet's "Between sessions" fold, to read again. Which packet was opened is kept on
   this phone (localStorage b68.packet.seen, the packet's own time), so a reload does not bring it back to the top; a new packet does. Nothing is pushed to the
   phone; with no packet there is nothing anywhere. Everything is drawn with textContent.

   API: start() stop() now() -> item | null  between() -> item | null  open() close() state()      pure (Node tests): clean(rowJson) -> the packet or null
        seenKey(packet) -> the string kept when it is opened */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68Absent = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var KIND = 'packet', POLL_MS = 60000;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function one(s, max) { return str(s).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
  function list(raw, n, max) { return (Array.isArray(raw) ? raw : []).map(function (x) { return one(x, max); }).filter(Boolean).slice(0, n); }

  /* only the fields this page draws, bounded; anything else in the row is dropped */
  function clean(json) {
    if (!isObj(json) || json.v !== 1) return null;
    var f = isObj(json.front) && str(json.front.headline) ? json.front : null, p = isObj(json.previously) ? json.previously : {};
    var faces = (Array.isArray(p.faces) ? p.faces : []).filter(isObj).map(function (x) { return { name: one(x.name, 40), role: one(x.role, 40) }; }).filter(function (x) { return x.name; }).slice(0, 6);
    return {
      at: typeof json.at === 'number' && isFinite(json.at) ? json.at : 0,
      front: f ? { masthead: one(f.masthead, 60), issue: one(f.issue, 40), date: one(f.date, 40), headline: one(f.headline, 120), standfirst: one(f.standfirst, 240), account: list(f.account, 6, 600), name: one(f.name, 200), hook: one(f.hook, 240) } : null,
      previously: { faces: faces, lines: list(p.lines, 3, 160) },
      changes: list(json.changes, 12, 160)
    };
  }

  var cur = null, started = false, off = null, pollT = null, busy = false, again = false, vis = null, onClick = null, dlg = null, seen = 0;
  function redraw() {
    var T = W && W.B68Tracker;
    if (T && typeof T.refresh === 'function' && typeof T.isOpen === 'function' && T.isOpen()) { try { T.refresh(); } catch (e) { if (W.console) W.console.error(e); } }
  }
  function apply(json) {
    var before = JSON.stringify(cur), next = clean(json);
    cur = next;
    if (JSON.stringify(cur) !== before) redraw();
  }
  function refresh() {
    if (!started) return;
    if (busy) { again = true; return; }
    busy = true;
    W.fetch('/api/docs?kind=' + KIND + '&limit=1', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } }).then(function (res) { return res.ok ? res.json() : null; }).then(function (j) {
      if (!started || !j) return;
      var rows = Array.isArray(j.docs) ? j.docs : [], r = rows.filter(function (d) { return isObj(d) && d.kind === KIND; })[0];
      apply(r ? r.json : null);
    }).then(null, function () { /* offline or signed out: the strip stays as it was */ }).then(function () {
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
      onClick = function (e) { var t = e.target && e.target.closest ? e.target.closest('[data-b68="absent-open"]') : null; if (t) { e.preventDefault(); open(); } };
      W.document.addEventListener('click', onClick);
    }
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
    var had = !!cur; cur = null;
    if (had) redraw();
  }

  /* which packet this phone has opened: its own time, else (an older row with none) a fingerprint of what it says */
  var SEEN_KEY = 'b68.packet.seen', seenMem = null;
  function seenKey(p) {
    if (!isObj(p)) return '';
    if (p.at > 0) return 'at:' + p.at;
    var s = JSON.stringify([p.front, p.previously, p.changes]) || '', h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return 'h:' + s.length + ':' + h;
  }
  function seenNow() {
    if (seenMem !== null) return seenMem;
    try { seenMem = str(W.localStorage && W.localStorage.getItem(SEEN_KEY)); } catch (e) { seenMem = ''; }
    return seenMem;
  }
  function markSeen(p) {
    var k = seenKey(p); if (!k || k === seenNow()) return false;
    seenMem = k; try { if (W.localStorage) W.localStorage.setItem(SEEN_KEY, k); } catch (e) { /* private mode: this visit remembers it */ }
    return true;
  }
  function unread() { return !!cur && seenKey(cur) !== seenNow(); }
  /* the Now card's item until it has been opened; the fold's after that */
  function nowItem() {
    if (!started || !unread()) return null;
    return { title: 'While you were away', line: 'The GM left you the front page and a recap' + (cur.changes.length ? ', and what changed on your sheet.' : '.'),
      actions: [{ label: 'Read it', attrs: 'data-b68="absent-open" aria-haspopup="dialog"', primary: true }] };
  }
  function betweenItem() {
    if (!started || !cur || unread()) return null;
    return { title: 'While you were away', line: 'The front page and the recap from the night you missed.', actions: [{ label: 'Read it again', attrs: 'data-b68="absent-open" aria-haspopup="dialog"' }] };
  }

  function el(tag, cls, text) { var e = W.document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function close() { if (dlg && dlg.parentNode) dlg.parentNode.removeChild(dlg); dlg = null; }
  function open() {
    if (!W || !W.document || !started || !cur) return false;
    close();
    dlg = el('div', 'ds-dlg ds-absent-dlg'); dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-label', 'While you were away');
    /* a tap on the dimmed page closes it: one that started there, so the tap that opened it can never close it */
    var downOn = false;
    dlg.addEventListener('pointerdown', function (e) { downOn = e.target === dlg; });
    dlg.addEventListener('click', function (e) { if (e.target === dlg && downOn) close(); downOn = false; });
    var card = el('div', 'ds-dlg-card ds-absent-card');
    var f = cur.front;
    if (f) {
      card.appendChild(el('h3', '', f.masthead || 'The front page'));
      if (f.issue || f.date) card.appendChild(el('p', '', [f.issue, f.date].filter(Boolean).join(' · ')));
      card.appendChild(el('h2', '', f.headline));
      if (f.standfirst) card.appendChild(el('p', '', f.standfirst));
      f.account.forEach(function (p) { card.appendChild(el('p', '', p)); });
      if (f.name) card.appendChild(el('p', '', 'Also in the news: ' + f.name));
      if (f.hook) card.appendChild(el('p', '', 'Developing: ' + f.hook));
    }
    card.appendChild(el('h3', '', 'Previously on'));
    if (cur.previously.faces.length) card.appendChild(el('p', '', cur.previously.faces.map(function (x) { return x.name + (x.role ? ' (' + x.role + ')' : ''); }).join(' · ')));
    cur.previously.lines.forEach(function (l) { card.appendChild(el('p', '', l)); });
    card.appendChild(el('h3', '', 'Your sheet'));
    if (!cur.changes.length) card.appendChild(el('p', '', 'Nothing has changed on your sheet.'));
    cur.changes.forEach(function (c) { card.appendChild(el('p', '', c)); });
    var row = el('div', 'ds-dlg-row'), cl = el('button', 'btn', 'Close'); cl.type = 'button'; cl.addEventListener('click', close); row.appendChild(cl); card.appendChild(row);
    dlg.appendChild(card); W.document.body.appendChild(dlg);
    seen = Date.now();
    if (markSeen(cur)) redraw();   /* opened: it leaves the Now card for the fold */
    return true;
  }
  function state() { return { started: started, open: !!dlg, packet: cur, seen: seen, unread: unread() }; }

  return { start: start, stop: stop, now: nowItem, between: betweenItem, open: open, close: close, state: state, KIND: KIND, clean: clean, seenKey: seenKey, _set: function (j) { apply(j); } };
});
