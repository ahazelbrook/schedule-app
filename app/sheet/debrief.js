/* sheet/debrief.js — the Debrief card on a phone's sheet (suite ticket 1.7, switch spine.debrief).

   Window.B68Debrief, and module.exports under Node. A lazy bundle (routes.js 'debrief'): boot.js fetches it only while the switch is on and calls start() / stop()
   from every campaign arrival, so with the switch off a phone loads nothing and makes no /api/docs call.

   WHAT IT READS. The GM sends each player ONE `debrief` row (app/gm/debrief.js), owner = that player, scope 'player': GET /api/docs?kind=debrief returns only the
   caller's own row (the store hides every other), so a phone cannot read another player's. The row says which Aftermath steps are left (unwind, xp, credits...),
   the downtime picks to offer, when the card shows (from: the next morning) and when the defaults take over (due: 48 hours after the night).
   WHAT IT WRITES. The player's reply goes into the SAME row (PUT kind 'debrief', scope 'player', the row's own fields carried forward): reply = { at, unwind:
   { pick, note }, xp: { ticked, note }, credits: { note } }. A phone writes only its own row (the store refuses anything else).
   WHAT IT DRAWS. bar() is a strip the sheet puts under its table bar (tracker.js, the `bar` slot): one line and a button that opens a small form (its own
   dialog, so a redraw of the sheet cannot lose what is typed). Before `from` it draws nothing; after `due` with no reply it says the defaults apply and the form
   shows them read-only. The xp triggers are the sheet's own: the form's button clicks the sheet's End of session button. This file knows no playbook text.

   API: start() stop() bar() -> html | ''  open() close() state()      pure (Node tests): viewOf(row, nowMs) -> { phase, due, from } */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68Debrief = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var KIND = 'debrief', POLL_MS = 30000, NOTE_MAX = 200;
  var LABEL = { payout: 'Payout', tithe: 'Tithe', heat: 'Heat', status: 'Status changes', harm: 'Harm complications', unwind: 'Unwind', xp: 'Commendations', credits: 'End credits' };
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function whole(v) { return typeof v === 'number' && isFinite(v) && v > 0 && Math.floor(v) === v; }
  function esc(s) { return str(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* viewOf(row, nowMs): phase 'none' (no row / nothing left) | 'waiting' (before the morning) | 'open' | 'answered' | 'default' */
  function viewOf(row, nowMs) {
    if (!isObj(row) || !Array.isArray(row.steps) || !row.steps.length) return { phase: 'none', due: 0, from: 0 };
    var from = whole(row.from) ? row.from : 0, due = whole(row.due) ? row.due : 0;
    var phase = isObj(row.reply) ? 'answered' : due && nowMs >= due ? 'default' : from && nowMs < from ? 'waiting' : 'open';
    return { phase: phase, due: due, from: from };
  }

  var cur = null, started = false, off = null, pollT = null, busy = false, again = false, vis = null, dlg = null, saving = false, onClick = null;
  function now() { return Date.now(); }
  function redraw() {
    var T = W && W.B68Tracker;
    if (T && typeof T.refresh === 'function' && typeof T.isOpen === 'function' && T.isOpen()) { try { T.refresh(); } catch (e) { if (W.console) W.console.error(e); } }
  }
  function apply(row) {
    var before = JSON.stringify([cur && viewOf(cur, now()).phase, cur && cur.reply]);
    cur = isObj(row) ? row : null;
    if (JSON.stringify([cur && viewOf(cur, now()).phase, cur && cur.reply]) !== before) redraw();
  }
  function refresh() {
    if (!started) return;
    if (busy) { again = true; return; }
    busy = true;
    W.fetch('/api/docs?kind=' + KIND + '&limit=1', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } }).then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (j) {
      if (!started || !j) return;
      var rows = Array.isArray(j.docs) ? j.docs : [], r = rows.filter(function (d) { return isObj(d) && d.kind === KIND; })[0];
      if (!saving) apply(r ? r.json : null);
    }).then(null, function () { /* offline or signed out: the card stays as it was */ }).then(function () {
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
      onClick = function (e) { var t = e.target && e.target.closest ? e.target.closest('[data-b68="debrief-open"]') : null; if (t) { e.preventDefault(); open(); } };
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
    var v = viewOf(cur, now());
    if (v.phase === 'none' || v.phase === 'waiting') return '';
    var line = v.phase === 'answered' ? 'Sent. You can change it until the defaults apply.' : v.phase === 'default' ? 'The 48 hours are up: the defaults apply.' : 'Steps the Aftermath did not reach.';
    return '<div class="ds-tablebar ds-debrief" role="status"><span class="ds-tbline"><b>Debrief</b><span class="ds-dim">' + esc(line) + '</span></span>' +
      '<button type="button" class="btn sm primary" data-b68="debrief-open">' + (v.phase === 'open' ? 'Answer the Debrief' : 'Open the Debrief') + '</button></div>';
  }

  /* ---------- the form ---------- */
  function el(tag, cls, text) { var e = W.document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function close() { if (dlg && dlg.parentNode) dlg.parentNode.removeChild(dlg); dlg = null; }
  function open() {
    if (!W || !W.document || !cur) return false;
    var v = viewOf(cur, now());
    if (v.phase === 'none' || v.phase === 'waiting') return false;
    close();
    var ro = v.phase === 'default';
    var rep = isObj(cur.reply) ? cur.reply : {}, dflt = isObj(cur.defaults) ? cur.defaults : {};
    dlg = el('div', 'ds-debrief-dlg'); dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-label', 'Debrief');
    dlg.style.cssText = 'position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.55);display:flex;align-items:flex-end;justify-content:center';
    var card = el('form', 'ds-debrief-card');
    card.style.cssText = 'background:#fff;color:#111;width:min(100%,520px);max-height:90vh;overflow:auto;border-radius:12px 12px 0 0;padding:14px 16px;font:15px system-ui,sans-serif;display:grid;gap:10px';
    card.appendChild(el('h3', '', 'Debrief'));
    card.appendChild(el('p', '', ro ? 'The 48 hours are up. These are the defaults the GM will use.' : 'Only you and the GM can see this.'));
    var fields = {};
    cur.steps.forEach(function (id) {
      var box = el('fieldset', ''); box.appendChild(el('legend', '', LABEL[id] || id));
      if (id === 'unwind') {
        var sel = el('select'); sel.disabled = ro;
        (Array.isArray(cur.options) ? cur.options : []).forEach(function (o) { var op = el('option', '', str(o.label)); op.value = str(o.id); sel.appendChild(op); });
        var want = ro ? str(dflt.unwind) : rep.unwind ? str(rep.unwind.pick) : ''; if (want) sel.value = want;
        var note = el('input'); note.type = 'text'; note.maxLength = NOTE_MAX; note.placeholder = 'What are you doing? (optional)'; note.disabled = ro; note.value = rep.unwind ? str(rep.unwind.note) : '';
        box.appendChild(el('label', '', 'Downtime pick ')); box.lastChild.appendChild(sel); box.appendChild(note); fields.unwind = { sel: sel, note: note };
      } else if (id === 'xp') {
        var cb = el('input'); cb.type = 'checkbox'; cb.disabled = ro; cb.checked = !!(rep.xp && rep.xp.ticked);
        var lab = el('label', ''); lab.appendChild(cb); lab.appendChild(el('span', '', ' I have ticked my xp triggers'));
        var go = el('button', 'btn sm', 'Open the xp triggers'); go.type = 'button';
        go.addEventListener('click', function () { var b = W.document.querySelector('[data-act="endopen"]'); close(); if (b) b.click(); });
        var xn = el('input'); xn.type = 'text'; xn.maxLength = NOTE_MAX; xn.placeholder = 'A line about it (optional)'; xn.disabled = ro; xn.value = rep.xp ? str(rep.xp.note) : '';
        box.appendChild(lab); if (!ro) box.appendChild(go); box.appendChild(xn); fields.xp = { cb: cb, note: xn };
      } else {
        var t = el('input'); t.type = 'text'; t.maxLength = NOTE_MAX; t.disabled = ro; t.placeholder = id === 'credits' ? 'Anyone you would credit? (optional)' : 'A line (optional)'; t.value = rep[id] ? str(rep[id].note) : '';
        box.appendChild(t); fields[id] = { note: t };
      }
      card.appendChild(box);
    });
    var msg = el('p', ''); msg.setAttribute('role', 'status'); card.appendChild(msg);
    var row = el('div', ''); row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end';
    var cl = el('button', 'btn', 'Close'); cl.type = 'button'; cl.addEventListener('click', close); row.appendChild(cl);
    if (!ro) {
      var sv = el('button', 'btn primary', 'Send'); sv.type = 'submit'; row.appendChild(sv);
      card.addEventListener('submit', function (e) {
        e.preventDefault();
        var reply = { at: now() };
        if (fields.unwind) reply.unwind = { pick: fields.unwind.sel.value, note: fields.unwind.note.value.trim().slice(0, NOTE_MAX) };
        if (fields.xp) reply.xp = { ticked: fields.xp.cb.checked, note: fields.xp.note.value.trim().slice(0, NOTE_MAX) };
        if (fields.credits) reply.credits = { note: fields.credits.note.value.trim().slice(0, NOTE_MAX) };
        sv.disabled = true; saving = true;
        var next = Object.assign({}, cur, { reply: reply });
        W.fetch('/api/docs', { method: 'PUT', credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: KIND, scope: 'player', json: next }) })
          .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); saving = false; apply(next); close(); }, function (err) { throw err; })
          .then(null, function () { saving = false; sv.disabled = false; msg.textContent = 'Could not send. Try again.'; });
      });
    }
    card.appendChild(row); dlg.appendChild(card); W.document.body.appendChild(dlg);
    return true;
  }
  function state() { return { started: started, phase: viewOf(cur, now()).phase, row: cur }; }

  return { start: start, stop: stop, bar: bar, open: open, close: close, state: state, viewOf: viewOf, KIND: KIND, _set: function (row) { apply(row); } };
});
