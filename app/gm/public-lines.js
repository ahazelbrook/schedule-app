/* gm/public-lines.js: public lines that can’t get lost (RK06 of the room key build, behind the GM setting night.flow). In the night-flow bundle
   (app/routes.js), fetched only while its setting is on. Plain script, UMD: window.B68GmPublicLines in the browser, module.exports under Node. ES5.

   WHAT IT IS. A play event's public line queues in the GM page's short queue (gm/players-screen.js lines(), under stage.players): at most five, each with
   Send and Not now. Today the queue's box is small, sits where it meets no control, and nothing tells the GM a line has come. With night.flow on:
     RK06.1  the box flashes once when a line queues (a cut under reduced motion), and the OLDEST line is drawn large: its words in full, then Send and Not now.
             The box itself takes the focus on a click or a Tab, and Enter on the box sends that oldest line. No key of the page's is new: the keys stay as
             they are, and the buttons are the way.
     RK06.2  a per-night choice, "Send them by themselves after 20 s", off by default. With it on, the oldest line sends itself 20 s after it became the
             oldest, its timer shown on the card with a Hold button that stops it (the line then waits for Send, as today). Every auto-sent line is written to
             the night log. The choice lasts the night, not the setting.
   Nothing here draws a line of its own: the players-screen box calls bigRow() and footer() for the pieces, and attach() for the timers and the flash.

   THE STORE (RK06.2). One new optional key on the GM state document, inside `night`: night.pubAuto = the time (ms) the choice was switched on. Nothing reads it
   but this file. The night's end (players-screen clear) and a night reset (`night: null`) clear it; one older than EXPIRE_MS counts as off, so a choice left on
   cannot carry into next week's game. Old code ignores it (night.js clean() drops an unknown key; the server keeps no list of the night's keys).

   PURE      autoOn(doc, now) -> bool      autoPatch(on, now) -> a state patch      secondsLeft(due, now) -> whole seconds      timerText(sec, held) -> string
             isSendKey(ev, box) -> bool     countdown(env) -> the one timer
   DOM       bigRow(d, it, o) -> the large card (o: { auto, held, sec })      footer(d, auto) -> the toggle row      flash(el, win) -> bool
   attach(h) -> the box's controller. h: { el() -> the box | null, items() -> [{ id, o }] oldest first, send(id, how), log(text), redraw(), auto() -> bool,
             setAuto(bool), busy() -> bool (the GM's own overlay is up on the iPad: an auto-send waits), win() -> window | null, env (optional: { now, setTimeout, clearTimeout, setInterval, clearInterval }) } */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmPublicLines = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var AUTO_MS = 20000;
  var EXPIRE_MS = 14 * 3600 * 1000;      /* a choice left on is a night's, not a week's */
  var AUTO_LABEL = 'Send them by themselves after 20 s';
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }

  /* ---- the per-night choice ---- */
  function autoOn(doc, now) {
    var n = isObj(doc) && isObj(doc.night) ? doc.night.pubAuto : null;
    if (typeof n !== 'number' || !isFinite(n) || n <= 0) return false;
    if (typeof now !== 'number' || !isFinite(now)) return true;
    var age = now - n;
    return age < EXPIRE_MS && age > -60000;      /* a minute of clock skew is fine; a stale or far-future stamp is off */
  }
  /* on: the time it was switched on; off: null (the server drops a null) */
  function autoPatch(on, now) { return { night: { pubAuto: on ? Math.round(typeof now === 'number' && isFinite(now) && now > 0 ? now : 1) : null } }; }

  /* ---- the timer ---- */
  function secondsLeft(due, now) { return Math.max(0, Math.ceil((due - now) / 1000)); }
  function timerText(sec, held, wait) { return held ? 'Held: it and the lines behind it wait for Send' : wait ? 'Sends once the iPad is clear' : 'Sends in ' + sec + ' s'; }
  /* Enter, pressed on the box itself (never on a button, field or link inside it, which have their own Enter), with no modifier */
  function isSendKey(ev, box) {
    return !!ev && !!box && ev.key === 'Enter' && ev.target === box && !ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.isComposing;
  }
  /* one timer, on one line at a time: sync(id) starts AUTO_MS for a line that is not the one running, and stops for ''.
     env: { now, setTimeout, clearTimeout, setInterval, clearInterval, fire(id), tick(id, sec) } (the globals when not given) */
  function countdown(env) {
    var cur = null;
    var now = env.now || function () { return Date.now(); };
    var st = env.setTimeout || function (f, ms) { return setTimeout(f, ms); }, ct = env.clearTimeout || function (h) { clearTimeout(h); };
    var si = env.setInterval || function (f, ms) { return setInterval(f, ms); }, ci = env.clearInterval || function (h) { clearInterval(h); };
    function stop() { if (cur) { ct(cur.to); ci(cur.iv); cur = null; } }
    return {
      stop: stop,
      running: function () { return cur ? cur.id : ''; },
      left: function (id) { return cur && cur.id === id ? secondsLeft(cur.due, now()) : null; },
      sync: function (id) {
        if (!id) { stop(); return; }
        if (cur && cur.id === id) return;
        stop();
        var me = { id: id, due: now() + AUTO_MS, to: null, iv: null };
        me.to = st(function () { if (cur !== me) return; stop(); env.fire(id); }, AUTO_MS);
        me.iv = si(function () { if (cur === me && typeof env.tick === 'function') env.tick(id, secondsLeft(me.due, now())); }, 1000);
        cur = me;
      }
    };
  }

  /* ---- the pieces ---- */
  function btn(d, act, id, label, cls) {
    var b = d.createElement('button'); b.type = 'button'; b.className = cls; b.setAttribute('data-p2-line', act); if (id) b.setAttribute('data-id', id); b.textContent = label; b.style.flex = '0 0 auto'; b.style.fontSize = '13px';      /* nothing on the GM page under 12 px (the old desk's small button is 11) */
    return b;
  }
  /* the oldest line, large: the words in full (the class and data-id of a row stay, so the old hooks find it), then Send, Not now and, with auto-send on, its
     timer and Hold. o: { auto: bool, held: bool, wait: bool, sec: seconds | null } */
  function bigRow(d, it, o) {
    o = o || {};
    var id = str(it && it.id), row = d.createElement('div'); row.className = 'gm-p2-line gm-pl-big'; row.setAttribute('data-id', id); row.setAttribute('data-pl', 'big');
    var rs = row.style; rs.display = 'grid'; rs.gap = '6px'; rs.padding = '4px 0';
    var t = d.createElement('span'); t.className = 'gm-p2-text'; t.textContent = 'Public line: “' + str(it && it.o && it.o.text).trim() + '”';
    var ts = t.style; ts.fontSize = '15px'; ts.lineHeight = '1.35'; ts.whiteSpace = 'normal'; ts.overflowWrap = 'anywhere'; ts.fontWeight = '600'; row.appendChild(t);
    var acts = d.createElement('div'); acts.className = 'gm-pl-acts'; var as = acts.style; as.display = 'flex'; as.alignItems = 'center'; as.gap = '6px'; as.flexWrap = 'wrap';
    acts.appendChild(btn(d, 'send', id, 'Send', 'btn sm primary')); acts.appendChild(btn(d, 'later', id, 'Not now', 'btn sm'));
    if (o.auto) {
      var tm = d.createElement('span'); tm.className = 'gm-pl-timer'; tm.setAttribute('data-pl-timer', id);
      tm.textContent = timerText(typeof o.sec === 'number' ? o.sec : AUTO_MS / 1000, !!o.held, !!o.wait);
      var ms = tm.style; ms.flex = '1 1 auto'; ms.fontSize = '12px'; ms.color = '#c9c1b2'; acts.appendChild(tm);
      if (!o.held) acts.appendChild(btn(d, 'hold', id, 'Hold', 'btn sm'));
    }
    row.appendChild(acts);
    return row;
  }
  /* the per-night choice, last in the box */
  function footer(d, on) {
    var lab = d.createElement('label'); lab.className = 'gm-pl-auto'; lab.setAttribute('data-pl', 'auto');
    var ls = lab.style; ls.display = 'flex'; ls.alignItems = 'center'; ls.gap = '6px'; ls.fontSize = '12px'; ls.color = '#c9c1b2'; ls.cursor = 'pointer'; ls.paddingTop = '2px';
    var cb = d.createElement('input'); cb.type = 'checkbox'; cb.setAttribute('data-p2-line', 'auto'); cb.checked = !!on; cb.style.margin = '0';
    var tx = d.createElement('span'); tx.textContent = AUTO_LABEL;
    lab.appendChild(cb); lab.appendChild(tx);
    return lab;
  }
  /* the box flashes once when a line queues; under reduced motion it is a cut (a brighter ground for 0.7 s, then back). The count goes on the box (data-pl-flash). */
  function flash(el, win) {
    if (!el) return false;
    el.setAttribute('data-pl-flash', String((parseInt(el.getAttribute('data-pl-flash'), 10) || 0) + 1));
    var calm = false;
    try { calm = !!(win && typeof win.matchMedia === 'function' && win.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { calm = false; }
    if (!calm && typeof el.animate === 'function') {
      try { el.animate([{ backgroundColor: '#6b3a12' }, { backgroundColor: '#1a1714' }], { duration: 900, iterations: 1, easing: 'ease-out' }); return true; } catch (e) { /* fall to the cut */ }
    }
    if (el._plWas === undefined) el._plWas = el.style.backgroundColor || '#1a1714';      /* the ground to go back to, kept across two flashes in a row */
    el.style.backgroundColor = '#6b3a12';
    clearTimeout(el._plT);
    el._plT = setTimeout(function () { el.style.backgroundColor = el._plWas; el._plWas = undefined; }, 700);
    return true;
  }

  /* ---- the box's controller ---- */
  function attach(h) {
    var held = {}, env = h.env || {}, cd = null, waitId = '', waitTo = null;
    var st = env.setTimeout || function (f, ms) { return setTimeout(f, ms); }, ct = env.clearTimeout || function (x) { clearTimeout(x); };
    function busy() { return typeof h.busy === 'function' && !!h.busy(); }
    function unwait() { if (waitTo !== null) ct(waitTo); waitTo = null; waitId = ''; }
    function head() { var l = h.items(); return l.length ? l[0] : null; }
    function on() { return !!h.auto(); }
    function sync() {
      var l = h.items(), live = {}, it = l.length ? l[0] : null;
      l.forEach(function (x) { live[x.id] = true; });
      Object.keys(held).forEach(function (k) { if (!live[k]) delete held[k]; });
      if (waitId && !(it && it.id === waitId && on() && !held[it.id])) unwait();
      if (waitId) return;      /* its 20 s is up; it is waiting for the iPad, not for another 20 s */
      cd.sync(it && on() && !held[it.id] ? it.id : '');
    }
    /* the 20 s is up: a line never replaces what the GM has put on the iPad (one overlay at a time), so it waits, a second at a time, until that is gone */
    function due(id) {
      var it = head();
      if (!(it && it.id === id && on() && !held[id])) { unwait(); sync(); return; }
      if (busy()) { waitId = id; waitTo = st(function () { waitTo = null; due(id); }, 1000); var el = h.el(), n = el && el.querySelector ? el.querySelector('[data-pl-timer="' + id + '"]') : null; if (n) n.textContent = timerText(0, false, true); return; }
      unwait(); h.send(id, 'auto');
    }
    function paintTimer(id, sec) {
      var el = h.el(), n = el && el.querySelector ? el.querySelector('[data-pl-timer="' + id + '"]') : null;
      if (n) n.textContent = timerText(sec, false);
    }
    cd = countdown({
      now: env.now, setTimeout: env.setTimeout, clearTimeout: env.clearTimeout, setInterval: env.setInterval, clearInterval: env.clearInterval,
      fire: due,
      tick: paintTimer
    });
    return {
      /* what the box draws for the oldest line */
      opts: function (id) { return { auto: on(), held: !!held[id], wait: waitId === id, sec: cd.left(id) }; },
      footer: function (d) { return footer(d, on()); },
      /* a line has queued: the box flashes once, and the timer follows the oldest line */
      added: function () { var el = h.el(); if (el) flash(el, h.win && h.win()); sync(); },
      /* the box has been drawn: the timer follows whatever is oldest now, and the box can take the focus */
      drawn: function () { var el = h.el(); if (el) { if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0'); el.style.outlineOffset = '-2px'; } sync(); },
      /* a press on one of the box's controls: true when it was this file's */
      click: function (act, id) {
        if (act === 'auto') {
          var go = !on(); h.setAuto(go); h.log(go ? 'Public lines: auto-send on' : 'Public lines: auto-send off'); sync(); h.redraw(); return true;
        }
        if (act === 'hold') { held[str(id)] = true; sync(); h.redraw(); return true; }
        return false;
      },
      /* Enter on the box itself sends the oldest line */
      key: function (ev) {
        if (!isSendKey(ev, h.el())) return false;
        var it = head(); if (!it) return false;
        if (typeof ev.preventDefault === 'function') ev.preventDefault();
        h.send(it.id, 'key'); return true;
      },
      /* the night ends: the timer stops, and the choice goes with the night */
      end: function () { cd.stop(); unwait(); held = {}; if (on()) h.setAuto(false); },
      stop: function () { cd.stop(); unwait(); },
      running: function () { return cd.running() || waitId; }
    };
  }

  return { VERSION: 1, AUTO_MS: AUTO_MS, EXPIRE_MS: EXPIRE_MS, AUTO_LABEL: AUTO_LABEL, autoOn: autoOn, autoPatch: autoPatch, secondsLeft: secondsLeft, timerText: timerText,
    isSendKey: isSendKey, countdown: countdown, bigRow: bigRow, footer: footer, flash: flash, attach: attach };
});
