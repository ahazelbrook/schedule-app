/* gm/blade-chips.js: Blade's cards act on what they suggest (RK04 of the room key build; setting night.flow). In the night-flow bundle (app/routes.js), which
   brings prep-actions with it: fetched only while the setting is on, so with it off nothing here is ever asked for, drawn or called.

   WHAT IT ADDS
     ▶ tick: <clock> / <n>   a prep-action verb (gm/prep-actions.js draws and taps it): ticks the table clock by n (default 1), by an absolute `filled`,
                             capped at its size, with Undo. Fields are split at " / " (whitespace both sides), as ▶ clock: is.
     Tick +1                 ▶ clock: on a clock that is already on the table offers a tick instead of only saying so.
     Ask cards               the panel decorates a card's ▶ lines (its More text and its bullets) into the same chips (gm/assist-panel.js, option flow).
     "tick the alarm 1"      typed bare into Ask (no "Blade," or "/"): a clock command is read here, against the table's clocks, and applied at once. No
                             transcript line, no co-GM lane, no model call: it costs nothing and works at the cap. A question is never taken for one.
                             Only a sure name acts at once (the clock's own, or it without a leading a/an/the); a loose match asks "Which clock?".

   FOR RK03 (the stamp's tick) AND RK23 (a getaway clock chip): everything below is on window.B68GmBladeChips, or module.exports under Node.
     parseTick(spanText) -> null | { name, n } | { bad }     spanText is a code span's text, "▶ tick: Alarm / 2" (or the ">>" lead-in). null when it is not
                                                           a tick span; { bad } (a reason) when it is one but cannot be used; n is 1 to 12, default 1.
     findTick(md) -> null | { name, n, text }                the first usable tick span in a Markdown line or block (backticked, as written in a note)
     line(name, n) -> "▶ tick: name / n"                     the span's text, as a note holds it (a name's own " / " is not allowed: it reads as a field)
     parseTickArg(arg) -> { name, n } | { bad }              the same, from what follows "tick:"
   PURE (Node tests)
     isBare(text) -> bool                                    text a bare clock command: "tick …" or "make a … clock …" (never a question: nothing ending in ?)
     matchClock(name, clocks) -> { hit } | { many: [c] } | { none: true }    exact, then the cue's own match (without the/a/an, then within a letter)
     bumped(clock) -> clock                                  the clock as this page has just left it, until the table's copy catches up (8 s at most)
   HOST (the page's paHost: { clocks(), clockOps(ops), addClock(c), canClock(), toast(msg, bad), undoToast(text, undo), card(spec), dropCard(id) })
     tick(host, clock, by) -> Promise<{ ok, from?, to? }>    one absolute clockOps { id, filled }; Undo only while the clock still holds what was set
     typed(text, host) -> Promise<{ ok }>                    a bare command, read and applied; ok is true when it was handled (the field is then cleared)
     panel(host, prepActions) -> { decorate(el), chip(btn), refresh(el), is(text), run(text) }    what the Blade panel is handed while the setting is on
   ES5, as the files beside it. Every string from the table or a card goes in as text. Nothing is stored; nothing is sent but the page's own clockOps/addClock. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmBladeChips = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var SIZES = [4, 6, 8, 12], N_MAX = 12, NAME_MAX = 60, BUMP_MS = 8000;
  var LEAD = /^\s*(?:▶️?|>>)[  ]+(\S[\s\S]*)$/;
  var TICK_VERB = /^tick\s*:\s*(\S[\s\S]*)$/i;
  var CODE_SPAN = /`([^`\n]+)`/g;

  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function words(s) { return str(s).replace(/\s+/g, ' ').trim(); }
  function fold(s) {
    var t = str(s);
    try { t = t.normalize('NFKD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* no normalize: as written */ }
    return t.toLowerCase().replace(/[^a-z0-9]+/g, '');
  }
  function whole(v, lo, hi) { var n = Math.floor(+v); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; }
  function nowMs() { return Date.now(); }

  /* ---------- the verb ---------- */
  function parseTickArg(arg) {
    var p = str(arg).split(/\s+\/\s+/).map(words), name = p[0] || '';
    if (!name) return { bad: 'The tick has no clock name.' };
    if (p.length > 2) return { bad: 'A tick takes a clock name and a number: no more.' };
    var n = p.length > 1 ? (/^\d+$/.test(p[1]) ? +p[1] : NaN) : 1;
    if (!(n >= 1 && n <= N_MAX)) return { bad: 'The tick must be a number from 1 to ' + N_MAX + '.' };
    return { name: name.slice(0, NAME_MAX), n: n };
  }
  function parseTick(text) {
    var m = LEAD.exec(str(text)); if (!m) return null;
    var v = TICK_VERB.exec(words(m[1]));
    return v ? parseTickArg(v[1]) : null;
  }
  function findTick(md) {
    var s = str(md), m, t;
    CODE_SPAN.lastIndex = 0;
    while ((m = CODE_SPAN.exec(s))) { t = parseTick(m[1]); if (t && !t.bad) return { name: t.name, n: t.n, text: words(m[1]) }; }
    return null;
  }
  function line(name, n) { return '▶ tick: ' + words(name).slice(0, NAME_MAX) + ' / ' + whole(n, 1, N_MAX); }

  /* "tick …" and "make a … clock …", and nothing a question could be: text ending in a question mark is left to Ask */
  var BARE_TICK = /^(?:please\s+)?ticks?\s+\S/i;
  var BARE_MAKE = /^(?:please\s+)?(?:make|add|start|create)\s+(?:(?:an?|the|new)\s+)*(?:\S+\s+){0,2}?clocks?\b/i;
  function isBare(text) {
    var s = words(text);
    if (!s || s.length > 200 || /\?\s*$/.test(s) || /^\s*(?:blade\s*,|\/)/i.test(s)) return false;
    return BARE_TICK.test(s) || BARE_MAKE.test(s);
  }

  /* ---------- the table's clocks ---------- */
  function cueMod() {
    var Q = W && W.B68Cue;
    if (!Q && typeof require === 'function') { try { Q = require('../cue.js'); } catch (e) { Q = null; } }
    return Q && typeof Q.parse === 'function' ? Q : null;
  }
  function clocksOf(host) {
    var l = [];
    try { l = host && typeof host.clocks === 'function' ? host.clocks() : []; } catch (e) { l = []; }
    return (Array.isArray(l) ? l : []).filter(isObj).map(bumped);
  }
  function matchClock(name, clocks) {
    var l = (Array.isArray(clocks) ? clocks : []).filter(isObj), f = fold(name);
    if (!f) return { none: true };
    var same = l.filter(function (c) { return fold(c.name) === f; });
    if (same.length === 1) return { hit: same[0] };
    if (same.length > 1) return { many: same };
    var Q = cueMod(), hits = Q && typeof Q.matchClock === 'function' ? Q.matchClock(str(name), l) : [];
    if (hits.length === 1) return { hit: hits[0] };
    if (hits.length > 1) return { many: hits };
    return { none: true };
  }

  /* what this page has just written, until the table's copy arrives: a second tap in the meantime builds on it (and the chip says it), and the
     tap is still an absolute fill, so two pages that both tap land on the same segment */
  var bump = {}, busy = {};
  function bumped(c) {
    var b = isObj(c) ? bump[c.id] : null;
    if (!b) return c;
    var f = Math.floor(+c.filled) || 0;
    if (nowMs() - b.at > BUMP_MS || f !== b.from) { delete bump[c.id]; return c; }
    return Object.assign({}, c, { filled: b.to });
  }
  function sizeOf(c) { return Math.max(1, Math.floor(+c.size) || 1); }
  function fillOf(c) { return whole(c.filled, 0, sizeOf(c)); }

  /* ---------- ticking ---------- */
  function said(host, msg, bad) { try { if (host && typeof host.toast === 'function') host.toast(msg, !!bad); } catch (e) { /* the page has no toast */ } }
  function undoShown(host, text, undo) {
    var shown = false;
    try { shown = !!(host && typeof host.undoToast === 'function' && host.undoToast(text, undo)); } catch (e) { shown = false; }
    if (!shown) said(host, text);
  }
  function plain(s, n) { var t = words(s); return t.length > n ? t.slice(0, n - 1) + '…' : t; }

  /* tick(host, clock, by): the clock one step (by, signed) further, as an absolute fill capped to 0..size */
  function tick(host, c0, by) {
    var c = bumped(c0), size = sizeOf(c), cur = fillOf(c), to = whole(cur + by, 0, size), name = plain(c.name, 40);
    if (to === cur) { said(host, name + ' is already ' + (by > 0 ? 'full' : 'empty') + ' (' + cur + '/' + size + ').'); return Promise.resolve({ ok: false, same: true }); }
    if (!host || typeof host.clockOps !== 'function') { said(host, 'The table is not available here: tick the clock on the table page.', true); return Promise.resolve({ ok: false }); }
    if (busy[c.id]) return Promise.resolve({ ok: false, busy: true });
    busy[c.id] = true;
    return Promise.resolve().then(function () { return host.clockOps([{ id: c.id, filled: to }]); }).then(function (r) {
      delete busy[c.id];
      if (r === false) throw new Error('The table did not take it.');
      bump[c.id] = { from: cur, to: to, at: nowMs() };
      var text = name + ' ticks ' + cur + ' to ' + to + ' of ' + size + '.';
      undoShown(host, text, function () { return undoTick(host, c, cur, to); });
      return { ok: true, from: cur, to: to };
    }, function (e) {
      delete busy[c.id];
      said(host, 'Could not tick the clock: ' + (e && e.message || e), true);
      return { ok: false };
    });
  }
  /* Undo: only while the clock is as it was left (the co-GM's rule); a clock the table changed since stays as it is */
  function undoTick(host, c, from, to) {
    var live = clocksOf(host).filter(function (x) { return x.id === c.id; })[0];
    if (!live) return Promise.resolve('Not undone: the clock is gone.');
    if (fillOf(live) !== to) return Promise.resolve('Not undone: the clock has changed since. Change it on the table page.');
    return Promise.resolve().then(function () { return host.clockOps([{ id: c.id, filled: from }]); }).then(function () {
      bump[c.id] = { from: to, to: from, at: nowMs() };
      return 'Undone: ' + plain(c.name, 40) + ' is back to ' + from + ' of ' + sizeOf(c) + '.';
    });
  }

  /* ---------- making a clock (typed) ---------- */
  function makeClock(host, name, size, filled) {
    var nm = words(name).slice(0, NAME_MAX);
    if (!nm) { said(host, 'The clock needs a name.', true); return Promise.resolve({ ok: false }); }
    if (SIZES.indexOf(size) < 0) { said(host, 'A clock’s size must be 4, 6, 8 or 12.', true); return Promise.resolve({ ok: false }); }
    var have = clocksOf(host).filter(function (c) { return fold(c.name) === fold(nm); })[0];
    if (have) { said(host, 'Clock: ' + plain(have.name, 40) + ' is on the table already (' + fillOf(have) + '/' + sizeOf(have) + '). Nothing added.'); return Promise.resolve({ ok: false }); }
    if (!host || typeof host.addClock !== 'function' || (typeof host.canClock === 'function' && !host.canClock())) { said(host, 'The table is not available here: start the clock on the table page.', true); return Promise.resolve({ ok: false }); }
    var n = whole(filled, 0, size), clock = { id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: nm, size: size, filled: n, kind: 'danger', hidden: true };
    return Promise.resolve().then(function () { return host.addClock(clock); }).then(function (r) {
      if (r === false) throw new Error('The clock was not added.');
      undoShown(host, 'Clock added, hidden from the players: ' + nm + ' ' + n + '/' + size + '.', function () { return undoMake(host, clock); });
      return { ok: true };
    }, function (e) { said(host, 'Could not add the clock: ' + (e && e.message || e), true); return { ok: false }; });
  }
  function undoMake(host, clock) {
    var live = clocksOf(host).filter(function (x) { return x.id === clock.id; })[0];
    if (live && (fillOf(live) !== clock.filled || sizeOf(live) !== clock.size || live.hidden !== true)) return Promise.resolve('Not undone: the clock has changed since. Change it on the table page.');
    return Promise.resolve().then(function () { return host.clockOps([{ remove: clock.id }]); }).then(function () { return 'Undone: the clock is off the table.'; });
  }

  /* ---------- the bare command ---------- */
  function sayCard(host, spec) {
    if (host && typeof host.card === 'function') { try { host.card(spec); return true; } catch (e) { return false; } }
    return false;
  }
  var cardSeq = 0;
  function typed(text, host) {
    var Q = cueMod(), s = words(text).replace(/[.!]+$/, '');
    if (!Q) { said(host, 'The cue words are not loaded here.', true); return Promise.resolve({ ok: false }); }
    var res = Q.parse('Blade, ' + s, { clocks: clocksOf(host) });
    var q = plain(s, 60);
    if (res.refused) {
      said(host, res.refused === 'nochange' ? 'Nothing to change: that clock is already there.' : 'I can’t do that from here: “' + q + '”. Say it as a clock command.', res.refused !== 'nochange');
      return Promise.resolve({ ok: false });
    }
    if (res.missing) return missing(host, res, q);
    var acts = (res.actions || []).filter(function (a) { return a && (a.type === 'clock_tick' || a.type === 'clock_add'); });
    if (!acts.length) { said(host, 'I could not read “' + q + '” as a clock command.', true); return Promise.resolve({ ok: false }); }
    var unsure = res.viaPron ? null : acts.filter(function (a) { return a.type === 'clock_tick' && !sureOf(Q, s, a); })[0];
    if (unsure) return missing(host, { missing: 'which', candidates: [{ id: str(unsure.clock_id), name: str(unsure.clock_name) }], draft: { by: +unsure.by || 1 } }, q);
    var all = true;
    return acts.reduce(function (p, a) {
      return p.then(function () { return apply(host, a).then(function (r) { if (!r.ok) all = false; }); });
    }, Promise.resolve()).then(function () { return { ok: all }; });
  }
  /* a sure match acts at once: the name as heard is the clock's own name (case and punctuation aside), or is it without a leading a, an or the (on
     either side), or with a trailing "clock" (what the cue's own exact step drops). A loose-only match ("the nights" for "Lights out") asks first.
     What was heard is the cue's own reading of the words: a parse against no clocks says the name it could not find, with any trailing amount
     ("1", "twice", "by two", "3 ticks") still on it, so that comes off here as the cue's own second reading takes it off. */
  var ONCE = { once: 1, twice: 1, thrice: 1 }, TAILN = /^(?:ticks?|segments?|times?|box(?:es)?|marks?)$/;
  function noAmount(Q, h) {
    var w = h.split(' '), k = w.length;
    if (ONCE[w[k - 1]]) return w.slice(0, k - 1).join(' ');
    if (TAILN.test(w[k - 1])) k--;
    if (k > 0 && typeof Q.numOf === 'function' && Q.numOf(w[k - 1]) !== null) { k--; if (k > 0 && w[k - 1] === 'by') k--; return w.slice(0, k).join(' '); }
    return h;
  }
  function sureOf(Q, s, a) {
    var r0 = Q.parse('Blade, ' + s, { clocks: [] }), heard = r0 && r0.missing === 'clock' ? str(r0.name) : '';
    var nm = typeof Q.norm === 'function' ? Q.norm : function (x) { return words(str(x).toLowerCase().replace(/[^a-z0-9]+/g, ' ')); };
    var lead = function (x) { return x.replace(/^(?:the|a|an) /, ''); };
    var h = nm(heard), c = nm(a.clock_name);
    if (!h || !c) return false;
    var hs = [];
    [h, noAmount(Q, h)].forEach(function (x) { var y = x.replace(/ clocks?$/, ''); hs.push(x, lead(x), y, lead(y)); });
    return hs.indexOf(c) >= 0 || hs.indexOf(lead(c)) >= 0;
  }
  function apply(host, a) {
    if (a.type === 'clock_add') return makeClock(host, a.name, +a.size, a.filled || 0);
    var c = clocksOf(host).filter(function (x) { return x.id === a.clock_id; })[0];
    if (!c) { said(host, 'No clock called “' + plain(a.clock_name, 40) + '” on the table now.', true); return Promise.resolve({ ok: false }); }
    return tick(host, c, +a.by || 1);
  }
  /* what is still missing: a question card with the answers as buttons, or a toast */
  function missing(host, res, q) {
    var d = res.draft || {}, id = 'bc|' + (++cardSeq) + '|' + Date.now().toString(36);
    var done = function (p) { return function () { if (host && typeof host.dropCard === 'function') { try { host.dropCard(id); } catch (e) { /* gone already */ } } return p(); }; };
    if (res.missing === 'which') {
      var by = Number.isFinite(d.by) ? d.by : 1;
      var spec = { id: id, seat: 'cogm', kind: 'idea', headline: 'Which clock? “' + q + '”', bullets: ['Tap the one you meant.'], ackLabel: 'Got it ×', open: true,
        actions: (res.candidates || []).slice(0, 6).map(function (c, i) {
          return { id: 'c' + i, label: plain(c.name, 38), run: done(function () { var k = clocksOf(host).filter(function (x) { return x.id === c.id; })[0]; return k ? tick(host, k, by) : Promise.resolve(); }) };
        }) };
      if (sayCard(host, spec)) return Promise.resolve({ ok: true });
    } else if (res.missing === 'size') {
      var spec2 = { id: id, seat: 'cogm', kind: 'idea', headline: 'How big is “' + plain(d.name, 50) + '”?', bullets: ['A clock has 4, 6, 8 or 12 segments.'], ackLabel: 'Got it ×', open: true,
        actions: SIZES.map(function (n) { return { id: 's' + n, label: String(n), run: done(function () { return makeClock(host, d.name, n, d.filled || 0); }) }; }) };
      if (sayCard(host, spec2)) return Promise.resolve({ ok: true });
    } else if (res.missing === 'clock') {
      said(host, 'No clock called “' + plain(res.name, 40) + '” on the table. Say “make a 6 clock called …” to start one.', true);
    } else if (res.missing === 'more' || res.missing === 'name') {
      said(host, 'Say what to call the clock: “make a 6 clock called …”.', true);
    } else {
      said(host, 'I could not read “' + q + '” as a clock command.', true);
    }
    return Promise.resolve({ ok: false });
  }

  /* ---------- what the Blade panel is handed ---------- */
  function panel(host, A) {
    if (host && host.__bladeChips && host.__bladeChips.A === A) return host.__bladeChips.p;
    var p = {
      code: true,
      decorate: function (el) { if (A && typeof A.decorate === 'function') A.decorate(el, host); },
      refresh: function (el) { if (A && typeof A.refresh === 'function' && el) A.refresh(el, host); },
      chip: function (btn) { if (A && typeof A.tap === 'function') A.tap(btn, host); },
      is: isBare,
      run: function (text) { return typed(text, host); }
    };
    if (host) { try { host.__bladeChips = { A: A, p: p }; } catch (e) { /* a frozen host: made again next time */ } }
    return p;
  }

  return { SIZES: SIZES, parseTick: parseTick, parseTickArg: parseTickArg, findTick: findTick, line: line, isBare: isBare, matchClock: matchClock, bumped: bumped,
    tick: tick, typed: typed, panel: panel, _reset: function () { bump = {}; busy = {}; } };
});
