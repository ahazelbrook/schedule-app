/* sheet/commend.js — the Aftermath's xp commendations on a phone's sheet (suite ticket 1.6, switch spine.aftermath).

   Window.B68Commend, and module.exports under Node. A lazy bundle (routes.js 'commend'): boot.js fetches it only while the switch is on and calls start() / stop()
   from every campaign arrival, so with the switch off a phone loads nothing and makes no /api/docs call.

   WHAT IT READS. The GM's step 7 writes a public `commend` row to the docs store (app/gm/aftermath.js): { v: 1, secs: 90, until: <ms> }, no text, and deletes it
   on the way out. The phone reads that one kind (GET /api/docs?kind=commend; a public row is visible to a player), nudged by the LiveHub `docs` poke and by a
   20-second poll while the page is visible. The window is open while the row stands AND this phone's own clock is before `until` AND less than `secs` has passed since
   this phone first saw the row, so a row left behind by a closed GM page, or a clock that is minutes off, cannot hold the card up.

   WHAT IT SAYS. now() is the sheet's Now card item (sheet/now.js draws it, first of all while it stands) while the window is open: a line, the time left (the
   card counts it down from `ends`, the window's own end, so the markup does not change every second) and a button that opens the sheet's own End of session
   panel (data-act="endopen"), where the player ticks the playbook's xp triggers. It is null otherwise, so the sheet is what it was.
   The triggers themselves are the sheet's (tracker.js sessionTriggers): this file knows no playbook text.

   API: start() stop() now() -> item | null  open() -> bool  state()      pure (Node tests): windowOf(row, nowMs, seenMs) -> { open, left } */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68Commend = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var KIND = 'commend', POLL_MS = 20000, SECS_MAX = 180;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function whole(v, lo, hi) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= lo && v <= hi; }

  /* windowOf(row, nowMs, seenMs): row is the doc's json. open: the card should show; left: whole seconds to go (0 when closed) */
  function windowOf(row, nowMs, seenMs) {
    if (!isObj(row) || !whole(row.until, 1, 8.64e15)) return { open: false, left: 0 };
    var secs = whole(row.secs, 5, SECS_MAX) ? row.secs : 90;
    var end = Math.min(row.until, (typeof seenMs === 'number' ? seenMs : nowMs) + secs * 1000);
    var left = Math.ceil((end - nowMs) / 1000);
    return left > 0 ? { open: true, left: left } : { open: false, left: 0 };
  }

  var cur = null;                  /* { until, secs, seen } the row as first seen on this phone */
  var started = false, off = null, pollT = null, expT = null, busy = false, again = false, vis = null;

  function now() { return Date.now(); }
  function redraw() {
    var T = W && W.B68Tracker;
    if (T && typeof T.refresh === 'function' && typeof T.isOpen === 'function' && T.isOpen()) { try { T.refresh(); } catch (e) { if (W.console) W.console.error(e); } }
  }
  function arm() {
    if (expT) { W.clearTimeout(expT); expT = null; }
    if (!cur) return;
    var w = windowOf(cur, now(), cur.seen);
    if (w.open) expT = W.setTimeout(function () { expT = null; redraw(); }, w.left * 1000 + 50);
  }
  function apply(row) {
    var before = cur ? cur.until + ':' + (windowOf(cur, now(), cur.seen).open ? 1 : 0) : '';
    if (!isObj(row) || !whole(row.until, 1, 8.64e15)) cur = null;
    else if (!cur || cur.until !== row.until) cur = { until: row.until, secs: whole(row.secs, 5, SECS_MAX) ? row.secs : 90, seen: now() };
    arm();
    var after = cur ? cur.until + ':' + (windowOf(cur, now(), cur.seen).open ? 1 : 0) : '';
    if (before !== after) redraw();
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
      apply(r ? r.json : null);
    }).then(null, function () { /* offline or signed out: the card simply stays as it was */ }).then(function () {
      busy = false;
      if (again) { again = false; refresh(); }
    });
  }

  function start() {
    if (started || !W || typeof W.fetch !== 'function') return;
    started = true;
    if (W.B68Live && typeof W.B68Live.on === 'function') { try { off = W.B68Live.on(['docs'], refresh); } catch (e) { off = null; } }
    pollT = W.setInterval(function () { if (!W.document || !W.document.hidden) refresh(); }, POLL_MS);
    if (W.document && typeof W.document.addEventListener === 'function') { vis = function () { if (!W.document.hidden) refresh(); }; W.document.addEventListener('visibilitychange', vis); }
    refresh();
  }
  function stop() {
    if (!started) return;
    started = false;
    if (off) { try { off(); } catch (e) { /* gone */ } off = null; }
    if (pollT) { W.clearInterval(pollT); pollT = null; }
    if (expT) { W.clearTimeout(expT); expT = null; }
    if (vis && W.document) { W.document.removeEventListener('visibilitychange', vis); vis = null; }
    var had = !!cur; cur = null;
    if (had) redraw();
  }
  function open() { return !!cur && windowOf(cur, now(), cur.seen).open; }
  /* the Now card's item while the window is open; ends is when it shuts on this phone (the same sum windowOf makes), fixed for the whole window */
  function nowItem() {
    if (!open()) return null;
    return { title: 'Did you earn xp tonight?', line: 'Tick the xp triggers that happened tonight.', ends: Math.min(cur.until, cur.seen + cur.secs * 1000),
      actions: [{ label: 'Open the xp triggers', attrs: 'data-act="endopen"', primary: true }] };
  }
  function state() { return { started: started, open: open(), left: cur ? windowOf(cur, now(), cur.seen).left : 0 }; }

  return { start: start, stop: stop, now: nowItem, open: open, state: state, windowOf: windowOf, KIND: KIND, _set: function (row) { apply(row); } };
});
