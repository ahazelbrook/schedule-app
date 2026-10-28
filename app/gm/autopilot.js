/* B68GmAutopilot — the iPad autopilot's controller (design 6, GM.md "Autopilot"): a pure state machine. No DOM, no storage, no network, no
 * timers, no clock of its own: every call is given the time, so a test drives it with a fake one.
 *
 * What it does. Blade directs the iPad until the GM takes over, with OVERLAYS, never cut-aways (the base display stays put). It is told what
 * happened at the table and answers with at most one action: the overlay to set, or the overlay to clear. The page (the driver in
 * gm-page.js) sends that through its own showOverlay / clearOverlay; this module sends nothing.
 *
 *   var ap = B68GmAutopilot.create({ now: function () { return Date.now(); }, idPrefix: 'a7k2-' });
 *   ap.event(e)  -> action | null     e is one of the events below; its `at` (ms) defaults to now()
 *   ap.tick(now) -> action | null     the one-second timer: time's up, and the slot freeing for something that waited
 *   ap.state()   -> a snapshot (mode, what is showing, what waits, the guards, the log)
 *   ap.note(entry)                    the driver adds a line to the log (a refused overlay, say)
 *   action       { do: 'set', overlay: { id, kind: 'clock'|'npc', ms, clockId | npcId, auto: true }, why } or { do: 'clear', id, why }
 *                Never a name, a title or any text: the overlay carries an opaque id, and the SERVER resolves a clock's name and joins an NPC's
 *                card at read time (and refuses a hidden clock or NPC). `id` is the module's own counter after a prefix the driver draws at
 *                random per page load (so an id never repeats across a reload, and is never made from a clock's or an NPC's id or name).
 *
 * Events (anything else, or a malformed one, is ignored):
 *   { type: 'clock', clockId, visible }            a table clock was made or ticked; only a VISIBLE one counts
 *   { type: 'npc', npcId, staged, revealed, portrait }
 *                                                  an NPC is speaking (Voice or npc_change for them); counts only when all three flags are true
 *   { type: 'gone', kind: 'clock'|'npc', key }     the subject was hidden, taken off stage or removed: dropped from the queue, and cleared now if showing
 *   { type: 'push', kind }                         the GM put something on the iPad (the driver's manualPush). kind: 'npc', 'handout', 'rule', 'dark',
 *                                                  'live' (a live-reveal map push) or any other display kind ('map', 'text', 'cards', 'blank', ...).
 *                                                  npc, handout, rule and dark clear what is showing (the GM wins). dark / rule are guards until the next push.
 *   { type: 'dawn', ms }                           the GM pressed the false dawn (it is theirs, and goes even on Hold). It takes the slot for ms; nothing
 *                                                  of ours is cleared over it, and nothing is set over it.
 *   { type: 'replaced' }                           the overlay in the document is no longer ours (the GM cleared it, or another sent one)
 *   { type: 'visible', visible }                   the page was hidden or shown
 *   { type: 'takeover' } { type: 'handback' } { type: 'off' } { type: 'on' }
 *
 * The state machine (design 6.4): Ready -> Showing (a visible clock changed / a revealed NPC speaking), Showing -> Showing (the same kind
 * again extends it, within its cap), Showing -> Ready (time's up: cleared, then a 15 s cooldown; or the GM pushes an NPC, handout, rule or
 * lights out: the GM wins), Ready/Showing -> Hold (Take over: cleared now), Hold -> Ready (Hand back), Ready -> Off (switched off), Off -> Ready.
 * Hold and Off ignore every table event (nothing queues), but still track the GM's pushes so the guards are right when it is handed back.
 *
 * Guards hold an overlay back (at most one waits per kind, the newest wins, and a waiter older than PENDING_MS is dropped): lights out is on, a
 * rules entry is on the iPad, a live-reveal push in the last 15 s, a handout pushed in the last 30 s, the page is hidden, a dawn is running.
 * Priority when two want the slot: dawn (the GM's, never preempted), then NPC, then clock. Nothing preempts what is showing.
 *
 * Durations (design 6.2): a clock 8 s, each further change in that time adds 8 s up to 20 s in all (each extension is a NEW overlay with a new
 * id, because the display shows an id once); an NPC while they are on the transcript plus 20 s, at least 10 s, at most 3 minutes (one overlay
 * with a 3-minute backstop, which the module clears itself when its own time is up); the dawn 30 s (the page sends it).
 *
 * Load: <script src="gm/autopilot.js"> exposes window.B68GmAutopilot; in Node, require() returns the same object.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.B68GmAutopilot = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var D = {
    clockMs: 8000, clockCapMs: 20000, clockMinMs: 1000,
    npcMinMs: 10000, npcTailMs: 20000, npcMaxMs: 180000,
    cooldownMs: 15000, liveMs: 15000, handoutMs: 30000, pendingMs: 60000,
    logMax: 20
  };
  var PRIORITY = ['npc', 'clock', 'text'];     /* dawn first, but the dawn is the GM's and never queues */
  var CLEARS = { npc: 1, handout: 1, rule: 1, dark: 1 };   /* a push of these ends what is showing */

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function isKey(v) { return typeof v === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v); }

  function create(opts) {
    opts = opts || {};
    var nowFn = typeof opts.now === 'function' ? opts.now : function () { return Date.now(); };
    var prefix = typeof opts.idPrefix === 'string' ? opts.idPrefix.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20) : 'ap';
    var n = 0;
    var st = {
      mode: 'ready',            /* ready | showing | hold | off */
      cur: null,                /* { kind, key, id, t0, until, last } while showing */
      pending: {},              /* kind -> { key, at } */
      cool: 0,                  /* no new overlay before this time (the cooldown after time's up) */
      lights: false, rule: false, hidden: false, liveAt: -Infinity, handoutAt: -Infinity, dawnUntil: 0,
      log: []
    };

    function log(at, did, kind, key, why) {
      st.log.push({ at: at, do: did, kind: kind || '', key: key || '', why: why || '' });
      while (st.log.length > D.logMax) st.log.shift();
    }
    function nextId() { n++; return prefix + n; }
    function guard(t) {
      if (st.lights) return 'lights out';
      if (st.rule) return 'a rules entry is up';
      if (t - st.liveAt < D.liveMs) return 'a live reveal just went out';
      if (t - st.handoutAt < D.handoutMs) return 'a handout was just shown';
      if (st.hidden) return 'the page is hidden';
      if (t < st.dawnUntil) return 'the dawn is running';
      return '';
    }
    function setAction(kind, key, t, ms, why) {
      var o = { id: nextId(), kind: kind, ms: ms, auto: true };
      if (kind === 'clock') o.clockId = key; else o.npcId = key;
      return { o: o, a: { do: 'set', overlay: o, why: why } };
    }
    /* put a new subject on the slot: a fresh Showing */
    function send(kind, key, t, why, keepT0) {
      var ms = kind === 'clock' ? D.clockMs : D.npcMaxMs;
      var t0 = keepT0 !== undefined ? keepT0 : t;
      if (kind === 'clock') ms = Math.min(D.clockMs, D.clockCapMs - (t - t0));
      var s = setAction(kind, key, t, ms, why);
      st.cur = { kind: kind, key: key, id: s.o.id, t0: t0, last: t, until: kind === 'clock' ? t + ms : t + Math.max(D.npcMinMs, D.npcTailMs) };
      st.mode = 'showing';
      delete st.pending[kind];
      log(t, 'set', kind, key, why);
      return s.a;
    }
    function clearCur(t, why, cool) {
      var id = st.cur ? st.cur.id : '', kind = st.cur ? st.cur.kind : '', key = st.cur ? st.cur.key : '';
      st.cur = null; st.mode = 'ready';
      if (cool) st.cool = t + D.cooldownMs;
      if (!id) return null;
      log(t, 'clear', kind, key, why);
      return { do: 'clear', id: id, why: why };
    }
    function want(kind, key, t) {
      if (st.mode === 'hold' || st.mode === 'off') return null;
      var why = guard(t);
      var c = st.cur;
      if (st.mode === 'showing' && c) {
        if (kind === 'npc' && c.kind === 'npc' && c.key === key) {
          /* the same NPC still talking: the card is already up (a guard is no reason to take it down), its end moves out: at least 10 s from the
             start, 20 s after the last word, 3 minutes at most */
          c.last = t;
          c.until = Math.min(c.t0 + D.npcMaxMs, Math.max(c.t0 + D.npcMinMs, t + D.npcTailMs));
          return null;
        }
        if (c.kind === kind && !why) {
          if (kind === 'clock') {
            var left = D.clockCapMs - (t - c.t0);
            if (left >= D.clockMinMs) return send('clock', key, t, 'extended', c.t0);
          } else if (kind === 'npc') {
            return send('npc', key, t, 'another NPC');
          }
        }
        st.pending[kind] = { key: key, at: t };
        return null;
      }
      if (why || t < st.cool) { st.pending[kind] = { key: key, at: t }; return null; }
      return send(kind, key, t, 'new');
    }

    function event(e) {
      if (!isObj(e) || typeof e.type !== 'string') return null;
      var t = typeof e.at === 'number' && isFinite(e.at) ? e.at : nowFn();
      switch (e.type) {
        case 'clock':
          if (e.visible !== true || !isKey(e.clockId)) return null;
          return want('clock', e.clockId, t);
        case 'npc':
          if (e.staged !== true || e.revealed !== true || e.portrait !== true || !isKey(e.npcId)) return null;
          return want('npc', e.npcId, t);
        case 'gone': {
          if ((e.kind !== 'clock' && e.kind !== 'npc') || !isKey(e.key)) return null;
          if (st.pending[e.kind] && st.pending[e.kind].key === e.key) delete st.pending[e.kind];
          if (st.mode === 'showing' && st.cur && st.cur.kind === e.kind && st.cur.key === e.key) return clearCur(t, 'its subject is not shown to the players now', false);
          return null;
        }
        case 'push': {
          var k = typeof e.kind === 'string' ? e.kind : '';
          st.lights = k === 'dark'; st.rule = k === 'rule';
          if (k === 'handout') st.handoutAt = t;
          if (k === 'live') st.liveAt = t;
          if (CLEARS[k] && st.mode === 'showing') return clearCur(t, 'the GM pushed ' + k, false);
          return null;
        }
        case 'dawn': {
          var ms = typeof e.ms === 'number' && isFinite(e.ms) ? e.ms : 30000;
          st.dawnUntil = t + ms;
          if (st.mode === 'showing') { st.cur = null; st.mode = 'ready'; log(t, 'yield', 'fx', '', 'the dawn took the slot'); }
          return null;
        }
        case 'replaced':
          if (st.mode === 'showing') { st.cur = null; st.mode = 'ready'; log(t, 'yield', '', '', 'the overlay is no longer ours'); }
          return null;
        case 'visible':
          st.hidden = e.visible === false;
          return null;
        case 'takeover': {
          if (st.mode === 'hold' || st.mode === 'off') return null;
          var a = st.mode === 'showing' ? clearCur(t, 'take over', false) : null;
          st.mode = 'hold'; st.pending = {};
          log(t, 'mode', '', '', 'hold');
          return a;
        }
        case 'handback':
          if (st.mode !== 'hold') return null;
          st.mode = 'ready'; st.pending = {}; st.cool = 0;
          log(t, 'mode', '', '', 'ready');
          return null;
        case 'off': {
          if (st.mode === 'off') return null;
          var b = st.mode === 'showing' ? clearCur(t, 'switched off', false) : null;
          st.mode = 'off'; st.pending = {};
          log(t, 'mode', '', '', 'off');
          return b;
        }
        case 'on':
          if (st.mode !== 'off') return null;
          st.mode = 'ready'; st.cool = 0;
          log(t, 'mode', '', '', 'ready');
          return null;
      }
      return null;
    }

    function tick(t) {
      if (typeof t !== 'number' || !isFinite(t)) t = nowFn();
      Object.keys(st.pending).forEach(function (k) { if (t - st.pending[k].at > D.pendingMs) delete st.pending[k]; });
      if (st.mode === 'showing' && st.cur) {
        if (t >= st.cur.until) return clearCur(t, 'time is up', true);
        return null;
      }
      if (st.mode !== 'ready' || t < st.cool || guard(t)) return null;
      for (var i = 0; i < PRIORITY.length; i++) {
        var p = st.pending[PRIORITY[i]];
        if (p) return send(PRIORITY[i], p.key, t, 'held back, now free');
      }
      return null;
    }

    function state() {
      var pend = {}; Object.keys(st.pending).forEach(function (k) { pend[k] = { key: st.pending[k].key, at: st.pending[k].at }; });
      return {
        mode: st.mode,
        showing: st.cur ? { kind: st.cur.kind, key: st.cur.key, id: st.cur.id, t0: st.cur.t0, until: st.cur.until } : null,
        pending: pend, cool: st.cool,
        guards: { lights: st.lights, rule: st.rule, hidden: st.hidden, live: st.liveAt, handout: st.handoutAt, dawnUntil: st.dawnUntil },
        log: st.log.map(function (x) { return { at: x.at, do: x.do, kind: x.kind, key: x.key, why: x.why }; })
      };
    }
    function note(entry) {
      if (!isObj(entry)) return;
      log(typeof entry.at === 'number' ? entry.at : nowFn(), String(entry.do || 'note').slice(0, 20), String(entry.kind || '').slice(0, 20), String(entry.key || '').slice(0, 80), String(entry.why || '').slice(0, 120));
    }
    return { event: event, tick: tick, state: state, note: note };
  }

  return { create: create, DURATIONS: D, PRIORITY: PRIORITY };
});
