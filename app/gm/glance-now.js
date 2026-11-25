/* gm/glance-now.js: the fiction’s clock and who’s where (gm.glance, RK21 of the room key build). GM page only: it is in the gm-glance bundle
   (app/routes.js), fetched only while the setting is on, and nothing here is ever sent to the iPad or a phone.
   Plain script, UMD: window.B68GmGlanceNow in the browser, module.exports under Node. ES5, as the files beside it. It defines its module when it
   loads, and reads B68GmBall (gm/ball.js) and B68Ui only when it is called.

   WHAT IT DRAWS: one block under the Run view's header line (run-view.js headHtml, kit/run.js head), once a v2 night has started:
     Fiction 21:52 +7  [+5] [+15]  [HH:MM][Set]  [Clear]          the time in the fiction
     Crew  Nell Arbuthnot Cocktail lounge · Ray Okonjo Showroom    where the crew's markers are (ball.crew: a drag, a phone's move, RK05.2)
     Now   Mabel Quist Showroom till 23:30, then Private card rooms · ...   the site's people at the fiction's time, and where each goes next
   Before the night starts (the engagement row) it draws nothing; with no v2 night there is no Run header and no ball, so nothing.

   THE CLOCK. A v2 night already has a time: ball.t, the published time in minutes from play.clock.start, stepped a beat at a time (the night's
   ticks); it starts at the engagement result's time (ball.start), the plan's arrival. The fiction's clock is that time plus the GM's own offset,
   so it advances with the beats. +5 and +15 add to it, a typed time sets it, Clear drops the offset.
   STORED: one new optional key in the GM state's ball (scoped to the site; Reset the night nulls it with every other key): ball.fic = { b, off },
   two whole numbers: b is ball.t when the GM set it, off the minutes added (-720 to 720). Never a time's text. Old pages ignore it.
     fiction minute = ball.t                  with no fic, or once the night was stepped back before b
                    = b + off                 while ball.t is still b
                    = max(ball.t, b + off)    once the beats have moved on: a step never takes the fiction back, and it catches the fiction up
   PURE (tested under Node, checks/runtime/gm-glance-now.test.mjs):
     ficT(st) -> minute | null      ficChange(st, want) -> { fic } | null (the ball change that makes the fiction read `want`)      parseTime(text) -> "HH:MM" | null
     people(play, st, t) -> [{ id, label, kind, key, room, till, next, gone }]      crew(pcs, st) -> [{ id, name, room }]
   THE VIEW: create(host) -> { html(x, kit), act(action, el) -> bool (true: the action was this block's) }
     host: run() -> the Run view's host (site(), state(), set(change, quiet), pcs()), redraw(), toast(msg, bad)
     x is the Run view's render input ({ rs: { name, play }, st }); kit is true on the kit desk (the kit's styles). The buttons are B68Ui's on both desks.
     Its controls are data-site="gln-add" (data-min), "gln-set" (a form) and "gln-clear": the Run view routes them to the page's siteAct. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmGlanceNow = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var MAX_OFF = 720, DAY = 1440, SHOW = 8;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isInt(v) { return typeof v === 'number' && isFinite(v) && Math.round(v) === v; }
  function Ball() {
    if (root && root.B68GmBall) return root.B68GmBall;
    try { return typeof require === 'function' ? require('./ball.js') : null; } catch (e) { return null; }
  }
  function Ui() {
    if (root && root.B68Ui) return root.B68Ui;
    try { return typeof require === 'function' ? require('../ui/ui.js') : null; } catch (e) { return null; }
  }

  /* ---- the clock ---- */
  function started(st) { return isObj(st) && typeof st.start === 'number' && isFinite(st.start); }
  function tOf(st) { return isObj(st) && typeof st.t === 'number' && isFinite(st.t) ? Math.max(0, Math.round(st.t)) : 0; }
  function rec(st) {
    var f = isObj(st) ? st.fic : null;
    return isObj(f) && isInt(f.b) && f.b >= 0 && f.b < DAY && isInt(f.off) && Math.abs(f.off) <= MAX_OFF ? { b: f.b, off: f.off } : null;
  }
  function ficT(st) {
    if (!started(st)) return null;
    var t = tOf(st), r = rec(st), v = t;
    if (r && t === r.b) v = r.b + r.off;
    else if (r && t > r.b) v = Math.max(t, r.b + r.off);
    return Math.max(0, Math.min(DAY - 1, v));
  }
  /* the ball change that makes the fiction read `want`: { fic: null } when that is the published time itself; null when it cannot */
  function ficChange(st, want) {
    if (!started(st) || !isInt(want) || want < 0 || want >= DAY) return null;
    var t = tOf(st), off = want - t;
    if (Math.abs(off) > MAX_OFF) return null;
    return { fic: off === 0 ? null : { b: t, off: off } };
  }
  /* "21:52", "2152", "9:05", "21.52" -> "HH:MM"; anything else null */
  function parseTime(text) {
    var m = /^\s*(\d{1,2})[:.h]?(\d{2})\s*$/.exec(str(text));
    if (!m || +m[1] > 23 || +m[2] > 59) return null;
    return ('0' + +m[1]).slice(-2) + ':' + m[2];
  }
  function startOf(play) { return isObj(play) && isObj(play.clock) ? str(play.clock.start) : ''; }
  function spanOf(B, play) { var n = B.minuteOf(isObj(play.clock) ? str(play.clock.end) : '', startOf(play)); return n > 0 ? n : DAY; }

  /* ---- the people: where each is at t, and where each goes next ---- */
  /* the board's rule (run-view.js model): the target, the rival, contacts, and anyone a costume is seen through by */
  function keyIds(play) {
    var k = {};
    list(play.disguises).forEach(function (d) { if (isObj(d)) list(d.sees).forEach(function (id) { k[id] = true; }); });
    list(play.people).forEach(function (p) { if (isObj(p) && (p.kind === 'target' || p.kind === 'rival' || p.kind === 'contact')) k[p.id] = true; });
    return k;
  }
  function roomOf(w) { return isObj(w) && typeof w.room === 'string' && w.room ? w.room : ''; }
  /* each person at minute t: room ('' for nowhere), and the first minute after t, up to the night's end, at which that changes (till) and the room
     then (next; '' with gone true when they leave the night). Someone nowhere now who never comes is left out. Key people first, then play order. */
  function people(play, st, t) {
    var B = Ball(); if (!B || !isObj(play) || !isObj(play.clock) || !isInt(t)) return [];
    var s = isObj(st) ? st : {}, key = keyIds(play), out = [], open = 0, now = B.placesAt(play, s, t);
    list(play.people).filter(function (p) { return isObj(p) && str(p.id); }).forEach(function (p) {
      out.push({ id: str(p.id), label: str(p.label), kind: str(p.kind), key: !!key[p.id], room: roomOf(now[p.id]), till: null, next: null, gone: false }); open++;
    });
    var end = Math.min(DAY - 1, Math.max(t, spanOf(B, play)));
    for (var m = t + 1; m <= end && open > 0; m++) {
      var at = B.placesAt(play, s, m);
      out.forEach(function (o) {
        if (o.till !== null) return;
        var r = roomOf(at[o.id]); if (r === o.room) return;
        o.till = m; o.next = r; o.gone = !r; open--;
      });
    }
    return out.filter(function (o) { return o.room || o.next; }).map(function (o, i) { return { o: o, i: i }; })
      .sort(function (a, b) { return (b.o.key ? 1 : 0) - (a.o.key ? 1 : 0) || a.i - b.i; }).map(function (x) { return x.o; });
  }
  /* the crew's markers: every PC in the page's order, with the room the ball places them in ('' when not placed) */
  function crew(pcs, st) {
    var c = isObj(st) && isObj(st.crew) ? st.crew : {};
    return list(pcs).filter(function (p) { return isObj(p) && str(p.id); }).map(function (p) {
      var e = isObj(c[p.id]) ? c[p.id] : {};
      return { id: str(p.id), name: str(p.name) || str(p.id), room: typeof e.room === 'string' ? e.room : '' };
    });
  }

  /* ---- the view ---- */
  function create(host) {
    host = host || {};
    function run() { try { return typeof host.run === 'function' ? host.run() : null; } catch (e) { return null; } }
    function toast(m, bad) { if (typeof host.toast === 'function') host.toast(m, !!bad); }
    function redraw() { if (typeof host.redraw === 'function') host.redraw(); }
    /* the buttons are B68Ui's on both desks (the page brings the kit-ui bundle in before gm-glance); they keep the old desk's rv-btn classes, as the
       room key's do. With no B68Ui (its fetch failed) the block still reads, without its buttons, and Enter in the time box still sets the time */
    function btn(label, data, title) {
      var U = Ui();
      return U ? U.button({ label: label, rank: 'quiet', cls: ['rv-btn', 'sm', 'gl-now-b'], data: data, title: title }) : '';
    }
    function submit() {
      var U = Ui();
      return U ? U.button({ label: 'Set', rank: 'quiet', type: 'submit', cls: ['rv-btn', 'sm', 'gl-now-b'], title: 'Set the fiction’s time to the one typed' }) : '';
    }
    function place(room, dim) { return room ? '<span class="gl-now-room">' + esc(room) + '</span>' : '<span class="gl-now-dim">' + esc(dim) + '</span>'; }
    var SEP = '<span class="gl-now-sep" aria-hidden="true"> · </span>';

    function html(x, kit) {
      var play = isObj(x) && isObj(x.rs) ? x.rs.play : null, st = isObj(x) && isObj(x.st) ? x.st : {}, B = Ball();
      if (!B || !isObj(play) || !isObj(play.clock)) return '';
      var ft = ficT(st); if (ft === null) return '';
      var pub = tOf(st), r = rec(st), diff = ft - pub, h = '';
      h += '<div class="gl-now' + (kit ? ' gl-now-kit' : '') + '" role="group" aria-label="The fiction’s clock and who’s where (GM only)"><div class="gl-now-row">';
      h += '<span class="gl-now-clock" title="The time in the fiction: the beat’s time plus what you added. GM only.">' +
        '<span class="gl-now-k">Fiction</span> <output class="gl-now-t" aria-label="The fiction’s time">' + esc(B.timeLabel(play, ft)) + '</output>';
      if (diff) h += ' <small class="gl-now-off" title="' + esc('The beat’s time is ' + B.timeLabel(play, pub)) + '">' + Math.abs(diff) + ' min ' + (diff > 0 ? 'ahead' : 'behind') + '</small>';
      h += '</span>';
      h += btn('+5', { site: 'gln-add', min: 5 }, 'Five minutes on in the fiction');
      h += btn('+15', { site: 'gln-add', min: 15 }, 'Fifteen minutes on in the fiction');
      if (r && diff) h += btn('Clear', { site: 'gln-clear' }, 'Back to the beat’s time (' + B.timeLabel(play, pub) + ')');
      h += '<form class="gl-now-form" data-site="gln-set" autocomplete="off"><input class="gl-now-in" name="t" type="text" inputmode="numeric" maxlength="5" size="5" placeholder="HH:MM"' +
        ' aria-label="The fiction’s time, HH:MM" title="Type the fiction’s time (HH:MM), then Enter or Set">' + submit() + '</form>';
      h += '</div>';
      var pcs = []; try { var rv = run(); pcs = rv && typeof rv.pcs === 'function' ? rv.pcs() : []; } catch (e) { pcs = []; }
      var cw = crew(pcs, st);
      h += '<p class="gl-now-line gl-now-crew"><span class="gl-now-k">Crew</span> ' + (cw.length ? cw.map(function (c) {
        return '<span class="gl-now-who"><span class="gl-now-pair"><b>' + esc(c.name) + '</b> ' + place(c.room, 'not placed') + '</span></span>';
      }).join(SEP) : '<span class="gl-now-dim">No PCs filed</span>') + '</p>';
      var ps = people(play, st, ft), shown = ps.slice(0, SHOW), more = ps.slice(SHOW);
      h += '<p class="gl-now-line gl-now-ppl"><span class="gl-now-k">Now</span> ' + (shown.length ? shown.map(function (p) {
        var nx = p.till === null ? '' : ' <span class="gl-now-dim">till ' + esc(B.timeLabel(play, p.till)) + ', then</span> ' + (p.gone ? '<span class="gl-now-dim">gone</span>' : place(p.next, ''));
        return '<span class="gl-now-who' + (p.key ? ' gl-now-key' : '') + '"><span class="gl-now-pair"><b>' + esc(p.label) + '</b> ' + place(p.room, 'not here') + '</span>' + nx + '</span>';
      }).join(SEP) : '<span class="gl-now-dim">Nobody placed by the play</span>');
      if (more.length) h += ' <span class="gl-now-dim" title="' + esc(more.map(function (p) { return p.label; }).join(', ')) + '">and ' + more.length + ' more</span>';
      return h + '</p></div>';
    }

    /* a data-site control of this block (gln-*): true when it was ours, whatever came of it */
    function act(a, el) {
      a = str(a); if (a.indexOf('gln-') !== 0) return false;
      var rv = run(), s = rv && typeof rv.site === 'function' ? rv.site() : null, st = rv && typeof rv.state === 'function' ? rv.state() : null, B = Ball();
      if (!rv || !s || !isObj(s.play) || !B) return true;
      var ft = ficT(st), want = null;
      if (ft === null) { toast('Start the night first: the fiction’s clock starts with it.', true); return true; }
      if (a === 'gln-add') want = ft + Math.max(1, Math.min(60, Math.round(+(el && el.getAttribute ? el.getAttribute('data-min') : 0) || 0)));
      else if (a === 'gln-clear') want = tOf(st);
      else if (a === 'gln-set') {
        var inp = el && el.querySelector ? el.querySelector('input[name="t"]') : null, hm = parseTime(inp ? inp.value : '');
        if (!hm) { toast('Type the fiction’s time as HH:MM, like 21:50.', true); return true; }
        want = B.minuteOf(hm, startOf(s.play));
      } else return true;
      var ch = isInt(want) ? ficChange(st, Math.min(DAY - 1, want)) : null;
      if (!ch) { toast('The fiction’s clock stays within 12 hours of the beat’s time.', true); return true; }
      if (typeof rv.set === 'function' && rv.set(ch, true)) redraw();
      return true;
    }
    return { html: html, act: act };
  }

  return { ficT: ficT, ficChange: ficChange, parseTime: parseTime, people: people, crew: crew, create: create, MAX_OFF: MAX_OFF };
});
