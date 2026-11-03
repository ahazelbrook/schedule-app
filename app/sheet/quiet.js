/* sheet/quiet.js — the quiet line on a phone's sheet (suite ticket 5.8, switch between.quiet).

   Window.B68Quiet, and module.exports under Node. A lazy bundle (routes.js 'quiet'): boot.js fetches it only while the switch is on and calls start() / stop()
   from every campaign arrival, so with the switch off a phone loads nothing and the header does nothing.

   WHAT IT DOES. A long press (600 ms, a finger that stays put) on the sheet's header opens a small menu of four: the X-card, pause, "spotlight me" and a secret
   note. The line goes to the store as this player's own `quiet` row (PUT kind 'quiet', scope 'player', owner = the signed-in player): { v: 1, items: [{ k, at,
   text? }] }, the latest 8 kept. Only the GM reads it (the store hides it from every other player and from the display; its live poke is the GM-only `quiet`
   kind). Nothing is shown to the table: the sender sees "Sent quietly" and the menu closes. No sound, no vibration.

   API: start() stop() open() close() state()      pure (Node tests): OPTIONS  itemFor(k, text, nowMs) -> { k, at, text? }  merge(rowJson, item) -> the json to write */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68Quiet = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var KIND = 'quiet', HOLD_MS = 600, SLOP = 10, KEEP = 8, TEXT_MAX = 280;
  var OPTIONS = [{ k: 'xcard', label: 'X-card' }, { k: 'pause', label: 'Pause' }, { k: 'spot', label: 'Spotlight me' }, { k: 'note', label: 'Secret note' }];
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }

  function itemFor(k, text, nowMs) {
    if (!OPTIONS.some(function (o) { return o.k === k; })) return null;
    var it = { k: k, at: Math.floor(nowMs) };
    if (k === 'note') { var t = str(text).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, TEXT_MAX); if (!t) return null; it.text = t; }
    return it;
  }
  function merge(json, item) {
    var items = isObj(json) && Array.isArray(json.items) ? json.items.filter(isObj) : [];
    items.push(item);
    return { v: 1, items: items.slice(-KEEP) };
  }

  var started = false, timer = null, sx = 0, sy = 0, dlg = null, down = null, up = null, move = null, ctxm = null, styleEl = null;
  function el(tag, cls, text) { var e = W.document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function headOf(target) {
    if (!target || !target.closest) return null;
    if (target.closest('button, a, input, select, textarea, label, [contenteditable]')) return null;
    return target.closest('#dossier.ds-live .ds-head, .ds-live .ds-head');
  }
  function cancel() { if (timer) { W.clearTimeout(timer); timer = null; } }

  function send(k, text) {
    var item = itemFor(k, text, Date.now());
    if (!item) return Promise.resolve(false);
    var opts = { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
    return W.fetch('/api/docs?kind=' + KIND + '&limit=1', opts).then(function (res) { return res.ok ? res.json() : null; }, function () { return null; }).then(function (j) {
      var rows = j && Array.isArray(j.docs) ? j.docs : [], mine = rows.filter(function (d) { return isObj(d) && d.kind === KIND; })[0];
      var body = { kind: KIND, scope: 'player', json: merge(mine ? mine.json : null, item) };
      return W.fetch('/api/docs', { method: 'PUT', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    }).then(function (res) { return !!(res && res.ok); }, function () { return false; });
  }

  function close() { if (dlg && dlg.parentNode) dlg.parentNode.removeChild(dlg); dlg = null; }
  function open() {
    if (!W || !W.document) return false;
    close();
    dlg = el('div', 'ds-quiet-dlg'); dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-label', 'Quiet line');
    dlg.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center';
    dlg.addEventListener('click', function (e) { if (e.target === dlg) close(); });
    var card = el('div', 'ds-quiet-card');
    card.style.cssText = 'background:#fff;color:#111;width:min(100%,420px);border-radius:12px 12px 0 0;padding:14px 16px;font:16px system-ui,sans-serif;display:grid;gap:10px';
    card.appendChild(el('b', '', 'Tell the GM quietly'));
    var msg = el('p', ''); msg.setAttribute('role', 'status'); msg.style.margin = '0';
    var note = el('textarea'); note.rows = 3; note.maxLength = TEXT_MAX; note.placeholder = 'A secret note for the GM'; note.setAttribute('hidden', '');
    var go = el('button', 'btn primary', 'Send the note'); go.type = 'button'; go.setAttribute('hidden', '');
    function done(ok) { if (ok) { msg.textContent = 'Sent quietly.'; W.setTimeout(close, 900); } else msg.textContent = 'Could not send. Try again.'; }
    OPTIONS.forEach(function (o) {
      var b = el('button', 'btn', o.label); b.type = 'button'; b.style.minHeight = '44px';
      b.addEventListener('click', function () {
        if (o.k === 'note') { note.removeAttribute('hidden'); go.removeAttribute('hidden'); note.focus(); return; }
        send(o.k).then(done);
      });
      card.appendChild(b);
    });
    go.addEventListener('click', function () { send('note', note.value).then(done); });
    card.appendChild(note); card.appendChild(go); card.appendChild(msg);
    var cl = el('button', 'btn', 'Cancel'); cl.type = 'button'; cl.addEventListener('click', close); card.appendChild(cl);
    dlg.appendChild(card); W.document.body.appendChild(dlg);
    return true;
  }

  function start() {
    if (started || !W || !W.document || typeof W.document.addEventListener !== 'function') return;
    started = true;
    styleEl = el('style'); styleEl.textContent = '.ds-live .ds-head{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}'; W.document.head.appendChild(styleEl);
    down = function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!headOf(e.target)) return;
      cancel(); sx = e.clientX; sy = e.clientY;
      timer = W.setTimeout(function () { timer = null; open(); }, HOLD_MS);
    };
    move = function (e) { if (timer && (Math.abs(e.clientX - sx) > SLOP || Math.abs(e.clientY - sy) > SLOP)) cancel(); };
    up = function () { cancel(); };
    ctxm = function (e) { if (headOf(e.target)) e.preventDefault(); };
    W.document.addEventListener('pointerdown', down);
    W.document.addEventListener('pointermove', move);
    W.document.addEventListener('pointerup', up);
    W.document.addEventListener('pointercancel', up);
    W.document.addEventListener('contextmenu', ctxm);
  }
  function stop() {
    if (!started) return;
    started = false; cancel(); close();
    W.document.removeEventListener('pointerdown', down); W.document.removeEventListener('pointermove', move);
    W.document.removeEventListener('pointerup', up); W.document.removeEventListener('pointercancel', up); W.document.removeEventListener('contextmenu', ctxm);
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    styleEl = null;
  }
  function state() { return { started: started, open: !!dlg }; }

  return { start: start, stop: stop, open: open, close: close, state: state, send: send, OPTIONS: OPTIONS, KIND: KIND, HOLD_MS: HOLD_MS, itemFor: itemFor, merge: merge };
});
