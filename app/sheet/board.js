/* sheet/board.js — post an opportunity from a phone's sheet (suite ticket 5.1, switch between.board).

   Window.B68Board, and module.exports under Node. A lazy bundle (routes.js 'board'): boot.js fetches it only while the switch is on and calls start() / stop()
   from every campaign arrival, so with the switch off a phone loads nothing and makes no /api/docs call.

   WHAT IT WRITES. A player posts a client, a target or an operation: a few words each, as part of the player's OWN `opportunity` row in the docs store
   (PUT kind 'opportunity', scope 'player', owner = the signed-in player, which the store forces). { v: 1, items: [{ id, k: client|target|operation, text, at }] },
   the latest 6 kept. The store hides the row from every other player and from the table display: nothing a player posts reaches the iPad until the GM chooses
   to put it on the board (app/gm/board.js).
   WHAT IT DRAWS. bar() is a strip the sheet puts under its table bar (tracker.js, the `bar` slot): one line and a button that opens a small form (its own
   dialog, so a redraw of the sheet cannot lose what is typed). The form lists the player's own cards with a Remove button each.

   API: start() stop() bar() -> html | ''  open() close() state()
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

  function bar() {
    if (!started) return '';
    var n = cur ? cur.items.length : 0;
    return '<div class="ds-tablebar ds-board" role="status"><span class="ds-tbline"><b>Opportunities</b><span class="ds-dim">' + (n ? n + ' posted for the planning board.' : 'Post a client, a target or an operation.') + '</span></span>' +
      '<button type="button" class="btn sm" data-b68="board-open">' + (n ? 'Your cards' : 'Post one') + '</button></div>';
  }

  /* ---------- the form ---------- */
  function el(tag, cls, text) { var e = W.document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  var listEl = null, msgEl = null;
  function close() { if (dlg && dlg.parentNode) dlg.parentNode.removeChild(dlg); dlg = null; listEl = null; msgEl = null; }
  function paintList() {
    if (!listEl) return;
    while (listEl.firstChild) listEl.removeChild(listEl.firstChild);
    var items = cur ? cur.items : [];
    if (!items.length) listEl.appendChild(el('p', '', 'Nothing posted yet.'));
    items.forEach(function (it) {
      var row = el('div', ''); row.style.cssText = 'display:flex;gap:8px;align-items:baseline;margin:4px 0';
      var lab = el('b', '', (KINDS.filter(function (x) { return x.k === it.k; })[0] || {}).label || it.k); row.appendChild(lab);
      var t = el('span', '', it.text); t.style.flex = '1'; row.appendChild(t);
      var rm = el('button', 'btn sm', 'Remove'); rm.type = 'button';
      rm.addEventListener('click', function () { write(remove(cur, it.id)).then(null, function () { if (msgEl) msgEl.textContent = 'Could not remove it. Try again.'; }); });
      row.appendChild(rm); listEl.appendChild(row);
    });
  }
  function open() {
    if (!W || !W.document || !started) return false;
    close();
    dlg = el('div', 'ds-board-dlg'); dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-label', 'Opportunity board');
    dlg.style.cssText = 'position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center';
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
    var card = el('form', 'ds-board-card');
    card.style.cssText = 'background:#fff;color:#111;width:min(100%,520px);max-height:90vh;overflow:auto;border-radius:12px 12px 0 0;padding:14px 16px;font:15px system-ui,sans-serif;display:grid;gap:10px';
    card.appendChild(el('h3', '', 'Opportunity board'));
    card.appendChild(el('p', '', 'Only you and the GM can see these until the GM puts the board up.'));
    var sel = el('select'); KINDS.forEach(function (x) { var o = el('option', '', x.label); o.value = x.k; sel.appendChild(o); });
    var txt = el('input'); txt.type = 'text'; txt.maxLength = TEXT_MAX; txt.placeholder = 'A few words'; txt.setAttribute('aria-label', 'The opportunity');
    var go = el('button', 'btn primary', 'Post it'); go.type = 'submit';
    msgEl = el('p', ''); msgEl.setAttribute('role', 'status');
    listEl = el('div', '');
    card.appendChild(sel); card.appendChild(txt); card.appendChild(go); card.appendChild(msgEl); card.appendChild(listEl);
    var cl = el('button', 'btn', 'Close'); cl.type = 'button'; cl.addEventListener('click', close); card.appendChild(cl);
    card.addEventListener('submit', function (e) {
      e.preventDefault();
      var next = add(cur, sel.value, txt.value, now());
      if (!next) { msgEl.textContent = 'Write a few words first.'; return; }
      go.disabled = true;
      write(next).then(function () { txt.value = ''; msgEl.textContent = 'Posted.'; go.disabled = false; }, function () { go.disabled = false; msgEl.textContent = 'Could not post. Try again.'; });
    });
    dlg.appendChild(card); W.document.body.appendChild(dlg);
    paintList();
    return true;
  }
  function state() { return { started: started, open: !!dlg, items: cur ? cur.items : [] }; }

  return { start: start, stop: stop, bar: bar, open: open, close: close, state: state, KIND: KIND, KINDS: KINDS, KEEP: KEEP, TEXT_MAX: TEXT_MAX, cleanItems: cleanItems, add: add, remove: remove, _set: function (j) { apply(j); } };
});
