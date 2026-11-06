/* sheet/quiet.js — the quiet line on a phone's sheet (suite ticket 5.8, switch between.quiet).

   Window.B68Quiet, and module.exports under Node. A lazy bundle (routes.js 'quiet'): boot.js fetches it only while the switch is on and calls start() / stop()
   from every campaign arrival, so with the switch off a phone loads nothing and the header does nothing.

   WHAT IT DOES. The sheet's "Quiet" button (in its sticky bar, drawn by tracker.js while this is started) or a long press (600 ms, a finger that stays put) on
   the sheet's header opens a small menu of four: the X-card, pause, "spotlight me" and a secret note. The line goes to the store as this player's own `quiet`
   row (PUT kind 'quiet', scope 'player', owner = the signed-in player): { v: 1, items: [{ k, at, text? }] }, the latest 8 kept. Only the GM reads it (the store
   hides it from every other player and from the display; its live poke is the GM-only `quiet` kind). Nothing is shown to the table: the sender sees "Sent
   quietly" and the menu closes. No sound, no vibration. A read-only sheet (the GM's drawer) opens nothing.
   iPhone Safari: the note's box is 16 px (no zoom on focus), and lifting the finger that held the header open never closes the menu or taps what is under it
   (the click that lift-off makes is swallowed, and a tap on the dimmed page closes it only when it started there).

   API: start() stop() open(from?) close() state()      pure (Node tests): OPTIONS  itemFor(k, text, nowMs) -> { k, at, text? }  merge(rowJson, item) -> the json to write */
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

  var started = false, timer = null, sx = 0, sy = 0, dlg = null, down = null, up = null, move = null, ctxm = null, styleEl = null, swallow = null;
  var held = null, eatUntil = 0, from = null;   /* held: the pointer whose long press opened the menu; eatUntil: the click its lift-off makes is swallowed until then */
  function el(tag, cls, text) { var e = W.document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  /* the header of a live sheet the player may write: not a read-only frame, not the GM (the sheet draws no Quiet button for either) */
  function headOf(target) {
    if (!target || !target.closest || (W.B68 && W.B68.isGM === true)) return null;
    if (target.closest('button, a, input, select, textarea, label, [contenteditable]')) return null;
    return target.closest('#dossier.ds-live:not(.ds-ro) .ds-head');
  }
  function cancel() { if (timer) { W.clearTimeout(timer); timer = null; } }
  function redraw() {
    var T = W && W.B68Tracker;
    if (T && typeof T.refresh === 'function' && typeof T.isOpen === 'function' && T.isOpen()) { try { T.refresh(); } catch (e) { if (W.console) W.console.error(e); } }
  }

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

  /* closing gives focus back to the sheet's Quiet button (it may have been redrawn since), else to what opened the menu */
  function close() {
    if (!dlg) return;
    if (dlg.parentNode) dlg.parentNode.removeChild(dlg);
    dlg = null;
    var d = W && W.document, back = (d && d.querySelector && d.querySelector('#dossier .ds-quietbtn')) || from;
    from = null;
    if (back && typeof back.focus === 'function' && d.body && typeof d.body.contains === 'function' && d.body.contains(back)) { try { back.focus({ preventScroll: true }); } catch (e) { /* not focusable */ } }
  }
  /* the menu, a bottom sheet in the sheet's paper and ink (tracker.css .ds-dlg). opener: the button that opened it, for focus on the way out */
  function open(opener) {
    if (!W || !W.document || !W.document.body) return false;
    if (dlg) close();
    from = opener && typeof opener.focus === 'function' ? opener : null;
    dlg = el('div', 'ds-dlg ds-quiet-dlg'); dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-labelledby', 'ds-quiet-h');
    /* a tap on the dimmed page closes it only when it started there: the long press that opened it started on the header */
    var downOn = false;
    dlg.addEventListener('pointerdown', function (e) { downOn = e.target === dlg; });
    dlg.addEventListener('click', function (e) { if (e.target === dlg && downOn) close(); downOn = false; });
    dlg.addEventListener('keydown', function (e) { if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); e.stopPropagation(); close(); } });
    var card = el('div', 'ds-dlg-card ds-quiet-card');
    var h = el('h3', '', 'Tell the GM quietly'); h.setAttribute('id', 'ds-quiet-h'); card.appendChild(h);
    card.appendChild(el('p', 'ds-dim', 'Only the GM sees it. Nothing shows at the table.'));
    var msg = el('p', 'ds-dlg-msg'); msg.setAttribute('role', 'status');
    var note = el('textarea', 'ds-quiet-note'); note.rows = 3; note.maxLength = TEXT_MAX; note.placeholder = 'A secret note for the GM'; note.setAttribute('aria-label', 'A secret note for the GM'); note.setAttribute('hidden', '');
    var go = el('button', 'btn primary', 'Send the note'); go.type = 'button'; go.setAttribute('hidden', '');
    var opts = el('div', 'ds-quiet-opts'), first = null;
    function done(ok) { if (ok) { msg.textContent = 'Sent quietly.'; W.setTimeout(close, 900); } else msg.textContent = 'Could not send. Try again.'; }
    OPTIONS.forEach(function (o) {
      var b = el('button', 'btn ds-quiet-opt', o.label); b.type = 'button'; b.setAttribute('data-k', o.k);
      b.addEventListener('click', function () {
        if (o.k === 'note') { note.removeAttribute('hidden'); go.removeAttribute('hidden'); b.setAttribute('aria-pressed', 'true'); try { note.focus(); } catch (e) { /* not focusable */ } return; }
        send(o.k).then(done);
      });
      if (!first) first = b;
      opts.appendChild(b);
    });
    go.addEventListener('click', function () { send('note', note.value).then(done); });
    card.appendChild(opts); card.appendChild(note); card.appendChild(go); card.appendChild(msg);
    var row = el('div', 'ds-dlg-row'), cl = el('button', 'btn', 'Cancel'); cl.type = 'button'; cl.addEventListener('click', close); row.appendChild(cl); card.appendChild(row);
    dlg.appendChild(card); W.document.body.appendChild(dlg);
    if (first) { try { first.focus({ preventScroll: true }); } catch (e) { /* not focusable */ } }
    return true;
  }

  function start() {
    if (started || !W || !W.document || typeof W.document.addEventListener !== 'function') return;
    started = true;
    styleEl = el('style'); styleEl.textContent = '.ds-live .ds-head{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}'; if (W.document.head) W.document.head.appendChild(styleEl);
    down = function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!headOf(e.target)) return;
      cancel(); sx = e.clientX; sy = e.clientY;
      var id = e.pointerId;
      timer = W.setTimeout(function () { timer = null; held = id; open(); }, HOLD_MS);
    };
    move = function (e) { if (timer && (Math.abs(e.clientX - sx) > SLOP || Math.abs(e.clientY - sy) > SLOP)) cancel(); };
    /* the finger that held the header open lifts: the click it makes lands on the menu, so the next click (in the next 400 ms) is swallowed */
    up = function (e) { cancel(); if (held !== null && e && e.pointerId === held) { held = null; eatUntil = Date.now() + 400; } };
    swallow = function (e) { if (!eatUntil) return; var t = eatUntil; eatUntil = 0; if (Date.now() <= t) { e.preventDefault(); e.stopPropagation(); } };
    ctxm = function (e) { if (headOf(e.target)) e.preventDefault(); };
    W.document.addEventListener('pointerdown', down);
    W.document.addEventListener('pointermove', move);
    W.document.addEventListener('pointerup', up);
    W.document.addEventListener('pointercancel', up);
    W.document.addEventListener('click', swallow, true);
    W.document.addEventListener('contextmenu', ctxm);
    redraw();   /* the sheet draws its Quiet button from now on */
  }
  function stop() {
    if (!started) return;
    started = false; cancel(); close(); held = null; eatUntil = 0;
    W.document.removeEventListener('pointerdown', down); W.document.removeEventListener('pointermove', move);
    W.document.removeEventListener('pointerup', up); W.document.removeEventListener('pointercancel', up); W.document.removeEventListener('contextmenu', ctxm);
    W.document.removeEventListener('click', swallow, true);
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    styleEl = null;
    redraw();   /* and its Quiet button goes */
  }
  function state() { return { started: started, open: !!dlg }; }

  return { start: start, stop: stop, open: open, close: close, state: state, send: send, OPTIONS: OPTIONS, KIND: KIND, HOLD_MS: HOLD_MS, itemFor: itemFor, merge: merge };
});
