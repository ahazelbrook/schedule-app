/* sheet/board.js — post an opportunity from a phone's sheet (suite ticket 5.1, switch between.board).

   Window.B68Board, and module.exports under Node. A lazy bundle (routes.js 'board'): boot.js fetches it only while the switch is on and calls start() / stop()
   from every campaign arrival, so with the switch off a phone loads nothing and makes no /api/docs call.

   WHAT IT WRITES. A player posts a client, a target or an operation: a few words each, as part of the player's OWN `opportunity` row in the docs store
   (PUT kind 'opportunity', scope 'player', owner = the signed-in player, which the store forces). { v: 1, items: [{ id, k: client|target|operation, text, at }] },
   the latest 6 kept. The store hides the row from every other player and from the table display: nothing a player posts reaches the iPad until the GM chooses
   to put it on the board (app/gm/board.js).
   WHAT IT SAYS. between() is the first item of the sheet's "Between sessions" fold (sheet/now.js): one line and a button that opens a small form (its own
   dialog, so a redraw of the sheet cannot lose what is typed). The form lists the player's own cards with a Remove button each.

   API: start() stop() between() -> item | null  open() close() state()
   pure (Node tests): KINDS  KEEP  TEXT_MAX  cleanItems(raw) -> [{ id, k, text, at }]  add(rowJson, k, text, nowMs) -> the json to write | null  remove(rowJson, id) -> json */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68Board = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var KIND = 'opportunity', POLL_MS = 30000, KEEP = 6, TEXT_MAX = 120;
  var KINDS = [{ k: 'client', label: 'Client' }, { k: 'target', label: 'Target' }, { k: 'operation', label: 'Operation' }];
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function kindOk(k) { return KINDS.some(function (x) { return x.k === k; }); }
  function clamp(v) { return str(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, TEXT_MAX); }

  function cleanItems(raw) {
    var list = isObj(raw) && Array.isArray(raw.items) ? raw.items : [], out = [];
    list.forEach(function (x) {
      if (!isObj(x) || !kindOk(x.k)) return;
      var text = clamp(x.text), id = str(x.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24), at = typeof x.at === 'number' && isFinite(x.at) && x.at > 0 ? Math.floor(x.at) : 0;
      if (text && id) out.push({ id: id, k: x.k, text: text, at: at });
    });
    return out.slice(-KEEP);
  }
  function add(json, k, text, nowMs) {
    var t = clamp(text);
    if (!kindOk(k) || !t) return null;
    var items = cleanItems(json), at = Math.floor(nowMs);
    items.push({ id: at.toString(36), k: k, text: t, at: at });
    return { v: 1, items: items.slice(-KEEP) };
  }
  function remove(json, id) { return { v: 1, items: cleanItems(json).filter(function (x) { return x.id !== id; }) }; }

  var cur = null, started = false, off = null, pollT = null, busy = false, again = false, vis = null, dlg = null, saving = false, onClick = null;
  function now() { return Date.now(); }
  function redraw() {
    var T = W && W.B68Tracker;
    if (T && typeof T.refresh === 'function' && typeof T.isOpen === 'function' && T.isOpen()) { try { T.refresh(); } catch (e) { if (W.console) W.console.error(e); } }
  }
  function apply(json) {
    var before = JSON.stringify(cleanItems(cur));
    cur = isObj(json) ? { v: 1, items: cleanItems(json) } : { v: 1, items: [] };
    if (JSON.stringify(cur.items) !== before) redraw();
    if (dlg) paintList();
  }
  function opts(method, body) {
    var o = { method: method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
    if (body) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
    return o;
  }
  function refresh() {
    if (!started) return;
    if (busy) { again = true; return; }
    busy = true;
    W.fetch('/api/docs?kind=' + KIND + '&limit=1', opts()).then(function (res) { return res.ok ? res.json() : null; }).then(function (j) {
      if (!started || !j) return;
      var rows = Array.isArray(j.docs) ? j.docs : [], r = rows.filter(function (d) { return isObj(d) && d.kind === KIND; })[0];
      if (!saving) apply(r ? r.json : null);
    }).then(null, function () { /* offline or signed out: the strip stays as it was */ }).then(function () {
      busy = false;
      if (again) { again = false; refresh(); }
    });
  }
  function write(next) {
    saving = true;
    return W.fetch('/api/docs', opts('PUT', { kind: KIND, scope: 'player', json: next })).then(function (res) {
      saving = false;
      if (!res.ok) throw new Error('HTTP ' + res.status);
      apply(next); return true;
    }, function (e) { saving = false; throw e; });
  }

  function start() {
    if (started || !W || typeof W.fetch !== 'function') return;
    started = true;
    if (W.B68Live && typeof W.B68Live.on === 'function') { try { off = W.B68Live.on(['docs'], refresh); } catch (e) { off = null; } }
    pollT = W.setInterval(function () { if (!W.document || !W.document.hidden) refresh(); }, POLL_MS);
    if (W.document && typeof W.document.addEventListener === 'function') {
      vis = function () { if (!W.document.hidden) refresh(); }; W.document.addEventListener('visibilitychange', vis);
      onClick = function (e) { var t = e.target && e.target.closest ? e.target.closest('[data-b68="board-open"]') : null; if (t) { e.preventDefault(); open(); } };
      W.document.addEventListener('click', onClick);
    }
    redraw();   /* the fold has a line for the board from now on, posted or not */
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
    cur = null;
    redraw();   /* the fold loses the board's line */
  }

  /* the fold's first item, whenever the board is on: the count and the way in */
  function betweenItem() {
    if (!started) return null;
    var n = cur ? cur.items.length : 0;
    return { title: 'Opportunities', line: n ? n + ' posted for the planning board.' : 'Post a client, a target or an operation for the planning board.',
      actions: [{ label: n ? 'Your cards' : 'Post one', attrs: 'data-b68="board-open" aria-haspopup="dialog"' }] };
  }

  /* ---------- the form (a bottom sheet in the sheet's paper and ink: tracker.css .ds-dlg) ---------- */
  function el(tag, cls, text) { var e = W.document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  var listEl = null, msgEl = null;
  /* focus goes into the form when it opens and back to what opened it when it closes; Esc closes it */
  var back = null;
  function focusIn(n) { if (n && typeof n.focus === 'function') { try { n.focus({ preventScroll: true }); } catch (e) { /* not focusable */ } } }
  function close() {
    var had = !!dlg, b = back; back = null;
    if (dlg && dlg.parentNode) dlg.parentNode.removeChild(dlg);
    dlg = null; listEl = null; msgEl = null;
    var body = W && W.document && W.document.body;
    if (had && b && body && typeof body.contains === 'function' && body.contains(b)) focusIn(b);
  }
  function paintList() {
    if (!listEl) return;
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    var items = cur ? cur.items : [];
    if (!items.length) listEl.appendChild(el('p', 'ds-dim', 'Nothing posted yet.'));
    items.forEach(function (it) {
      var row = el('div', 'ds-dlg-item');
      var lab = el('b', '', (KINDS.filter(function (x) { return x.k === it.k; })[0] || {}).label || it.k); row.appendChild(lab);
      var t = el('span', '', it.text); row.appendChild(t);
      var rm = el('button', 'btn sm', 'Remove'); rm.type = 'button';
      rm.addEventListener('click', function () { write(remove(cur, it.id)).then(null, function () { if (msgEl) msgEl.textContent = 'Could not remove it. Try again.'; }); });
      row.appendChild(rm); listEl.appendChild(row);
    });
  }
  function open() {
    if (!W || !W.document || !started) return false;
    var opener = W.document.activeElement;
    close(); back = opener;
    dlg = el('div', 'ds-dlg ds-board-dlg'); dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-label', 'Opportunity board');
    dlg.addEventListener('keydown', function (e) { if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); e.stopPropagation(); close(); } });
    /* a tap on the dimmed page closes it: one that started there, so the tap that opened it can never close it */
    var downOn = false;
    dlg.addEventListener('pointerdown', function (e) { downOn = e.target === dlg; });
    dlg.addEventListener('click', function (e) { if (e.target === dlg && downOn) close(); downOn = false; });
    var card = el('form', 'ds-dlg-card ds-board-card');
    card.appendChild(el('h3', '', 'Opportunity board'));
    card.appendChild(el('p', '', 'Only you and the GM can see these until the GM puts the board up.'));
    var sel = el('select'); sel.setAttribute('aria-label', 'What it is'); KINDS.forEach(function (x) { var o = el('option', '', x.label); o.value = x.k; sel.appendChild(o); });
    var txt = el('input'); txt.type = 'text'; txt.maxLength = TEXT_MAX; txt.placeholder = 'A few words'; txt.setAttribute('aria-label', 'The opportunity');
    var go = el('button', 'btn primary', 'Post it'); go.type = 'submit';
    msgEl = el('p', 'ds-dlg-msg'); msgEl.setAttribute('role', 'status');
    listEl = el('div', 'ds-dlg-list');
    card.appendChild(sel); card.appendChild(txt); card.appendChild(go); card.appendChild(msgEl); card.appendChild(listEl);
    var crow = el('div', 'ds-dlg-row'), cl = el('button', 'btn', 'Close'); cl.type = 'button'; cl.addEventListener('click', close); crow.appendChild(cl); card.appendChild(crow);
    card.addEventListener('submit', function (e) {
      e.preventDefault();
      var next = add(cur, sel.value, txt.value, now());
      if (!next) { msgEl.textContent = 'Write a few words first.'; return; }
      go.disabled = true;
      write(next).then(function () { txt.value = ''; msgEl.textContent = 'Posted.'; go.disabled = false; }, function () { go.disabled = false; msgEl.textContent = 'Could not post. Try again.'; });
    });
    card.setAttribute('tabindex', '-1');
    dlg.appendChild(card); W.document.body.appendChild(dlg);
    paintList();
    focusIn(card);   /* the form's top: never a field (on an iPhone a select focused inside the tap opens its picker, a text box its keyboard) */
    return true;
  }
  function state() { return { started: started, open: !!dlg, items: cur ? cur.items : [] }; }

  return { start: start, stop: stop, between: betweenItem, open: open, close: close, state: state, KIND: KIND, KINDS: KINDS, KEEP: KEEP, TEXT_MAX: TEXT_MAX, cleanItems: cleanItems, add: add, remove: remove, _set: function (j) { apply(j); } };
});
