/* gm/mission-publish.js — what the GM page tells the players (design 5.1, 5.5c, 5.7): the mission, built blind, screened, and written.

   Window.B68GmMission. Nothing here reads the DOM except renderPlayersView(el, mission), which only writes text into the element it is given.

   Where the three functions the gate reads live (search for the names):
     buildMission    the blind builder: ball.playerView, then ball.missionFor, at ball.t and nothing else (never a peek)
     screenMission   every string of the finished mission against the deny lists; it fails closed and names the hit
     publishMission  one publish (inside create): build, compare with the last one sent, screen, PATCH /api/campaign { mission }
   The server cleans again (functions/_lib/campaign.js cleanMission) and refuses a hidden name (422).

   create(deps) -> the controller one GM page holds. deps:
     ball          B68GmBall (playerView, missionFor, minuteOf)
     source()      -> null (no v2 run on screen) | { play, state, clocks, pcs, open, deny: function () -> { names, secrets } }
                    play is the v2 play block; state is the GM's ball document (only ball.t is the time that is published);
                    clocks the table's clocks; pcs [{ id, name, owner }] the filed characters; open the room names the players can see
     send(m)       -> Promise: PATCH { mission: m } (null removes it); rejects with an Error that has .status and the server's .message
     stored()      -> the mission the campaign document holds now, or null (its seq is where numbering carries on from after a reload)
     namesHit(text, names) -> bool, the page's whole-word test
     hiddenNpc(name) -> { id, name } | null, a hidden NPC the name belongs to      reveal(npc) -> Promise (asks first, then the page's reveal)
     offer(spec | null)  spec = { text, label, run } an actionable notice          toast(msg, bad)
     overlay(o) -> Promise, the page's showOverlay (the gate runs inside it)        confirm(msg) -> bool
     delay(fn, ms) -> handle, cancel(handle), now() -> Date                         (all optional; setTimeout, clearTimeout and new Date)
   controller:
     changed()                   something the mission reads may have moved: publish in 800 ms (each change restarts the wait)
     noteClocks()                the table's clocks changed: changed() only when the alarm clock's fill or visibility did
     publishNow(opts?)           publish now -> Promise<{ ok, skipped?, refused?, error?, seq?, time? }>
     flush()                     publishNow() only if a publish is waiting (the page closing)
     endNight()                  asks, then PATCH { mission: null }; publishing stays off until the night's start changes
     landed(from, to, how)       the time moved from -> to; how 'next' may lay one 8 s text overlay (never 'back', never a peek)
     onPublished(fn) -> off      fn({ ok, ended?, time, at, seq, error? }) after every publish and End the night
     status()                    -> { ok, time, at, seq, text } text is "Players: HH:MM ✓" ("" before the first publish)
     last()                      -> the mission as last published (else the stored one), for the Players view
     destroy()                   cancel the wait */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmMission = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEBOUNCE_MS = 800, OVERLAY_MS = 8000, OVERLAY_MAX = 120, FIELDS = ['v', 'site', 't', 'seq', 'hud', 'cards'];

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function fold(s) { return str(s).replace(/\s+/g, ' ').trim().toLowerCase(); }
  function whole(v) { return typeof v === 'number' && isFinite(v) && Math.floor(v) === v && v >= 1 ? v : 0; }

  /* ---- the alarm: the table clock named by play.alarm.clock; hidden -> not visible -> no alarm on a player's screen ---- */
  function alarmOf(play, clocks) {
    var name = isObj(play) && isObj(play.alarm) ? fold(play.alarm.clock) : '';
    if (!name) return undefined;
    var hit = (Array.isArray(clocks) ? clocks : []).filter(function (c) { return isObj(c) && fold(c.name) === name; })[0];
    if (!hit) return undefined;
    var filled = +hit.filled;
    return { filled: isFinite(filled) && filled >= 0 ? Math.floor(filled) : 0, visible: hit.hidden !== true };
  }

  /* ---- buildMission(B, src, seq) -> a mission, or null when src is not a usable v2 run -------------------------------------
     playerView(play, state, openRooms) is the only reader of the play block; missionFor(view, ...) is handed the filtered copy. The time
     is state.t, the published time. state is copied with the alarm set from the table's clock and nothing else added.
     Cards only for the PCs on the job: filed characters that are in ball.crew. A card's own room, and the room at the end of a told window's
     exact time, are blanked when that room is not open to the players (a PC may stand in a room the players cannot see; the card says nothing
     of where rather than refusing the whole publish). Every other name stays under the screen. */
  function buildMission(B, src, seq) {
    if (!B || typeof B.playerView !== 'function' || typeof B.missionFor !== 'function' || !isObj(src) || !isObj(src.play) || !isObj(src.state)) return null;
    var t = src.state.t;
    if (typeof t !== 'number' || !isFinite(t)) return null;
    var state = Object.assign({}, src.state);
    delete state.alarm;
    var alarm = alarmOf(src.play, src.clocks);
    if (alarm) state.alarm = alarm;
    var crew = isObj(state.crew) ? state.crew : {};
    var pcs = (Array.isArray(src.pcs) ? src.pcs : []).filter(function (p) { return isObj(p) && typeof p.id === 'string' && p.id && Object.prototype.hasOwnProperty.call(crew, p.id); })
      .map(function (p) { return { id: p.id, name: str(p.name), owner: typeof p.owner === 'string' ? p.owner : '' }; });
    var open = Array.isArray(src.open) ? src.open : [], isOpen = function (r) { return open.indexOf(r) >= 0; };
    var view = B.playerView(src.play, state, open);
    if (!view) return null;
    /* a told window reads "23:30–00:15 · Room": the time part never holds " · ", so split at the FIRST one and the rest is the room (a room's own name may hold " · ") */
    (Array.isArray(view.ways) ? view.ways : []).forEach(function (w) {
      var ex = isObj(w) && isObj(w.window) ? w.window.exact : null, i = typeof ex === 'string' ? ex.indexOf(' · ') : -1;
      if (i >= 0 && !isOpen(ex.slice(i + 3))) w.window.exact = ex.slice(0, i);
    });
    var m = B.missionFor(view, state, t, pcs);
    if (!m) return null;
    Object.keys(m.cards).forEach(function (id) { var c = m.cards[id]; if (isObj(c) && c.room && !isOpen(c.room)) c.room = ''; });
    m.seq = seq;
    return m;
  }

  /* every string of a mission (and the card ids), as [path, text] pairs */
  function missionTexts(m, path, out) {
    path = path || 'mission'; out = out || [];
    if (typeof m === 'string') { if (m) out.push([path, m]); }
    else if (Array.isArray(m)) m.forEach(function (x, i) { missionTexts(x, path + '.' + i, out); });
    else if (isObj(m)) Object.keys(m).forEach(function (k) { out.push([path + '.' + k, k]); missionTexts(m[k], path + '.' + k, out); });
    return out;
  }

  /* ---- screenMission(mission, deny, namesHit) -> null when clean, else { name, path, kind } for the first hit ----------------
     deny = { names: [text], secrets: [text] }: names the players must not meet (the map's hidden names, hidden NPCs and clocks) and the
     play's own secret words. It fails closed: a mission that is not an object of the known shape, or a deny list or test that cannot run,
     is a hit; so is a mission without an object band and an object of cards, and a deny list whose names or secrets are not arrays (empty is fine). */
  function screenMission(mission, deny, namesHit) {
    if (!isObj(mission) || Object.keys(mission).some(function (k) { return FIELDS.indexOf(k) < 0; })) return { name: '(the mission’s shape)', path: 'mission', kind: 'shape' };
    if (!isObj(mission.hud) || !isObj(mission.cards)) return { name: '(the mission lacks its band or its cards)', path: 'mission', kind: 'shape' };
    if (typeof namesHit !== 'function' || !isObj(deny) || !Array.isArray(deny.names) || !Array.isArray(deny.secrets)) return { name: '(no deny list)', path: 'mission', kind: 'shape' };
    var lists = [['name', deny.names], ['secret', deny.secrets]], texts = missionTexts(mission);
    for (var i = 0; i < lists.length; i++) {
      var kind = lists[i][0], names = lists[i][1].filter(function (n) { return typeof n === 'string' && n.trim(); });
      if (!names.length) continue;
      try {
        for (var j = 0; j < texts.length; j++) {
          for (var k = 0; k < names.length; k++) if (namesHit(texts[j][1], [names[k]])) return { name: names[k], path: texts[j][0], kind: kind };
        }
      } catch (e) { return { name: '(the deny list could not be read)', path: 'mission', kind: 'shape' }; }
    }
    return null;
  }

  /* the server's refusal for a hidden name: 'mission names "X" at mission.hud.crew.0.name, which the players must not see' */
  function parseRefusal(e) {
    var msg = str(e && e.message), m = /names "([\s\S]*)" at (mission[^\s,]*)/.exec(msg);
    return e && e.status === 422 && m ? { name: m[1], path: m[2], kind: 'server' } : null;
  }

  /* ---- the controller ------------------------------------------------------------------------------------------------------ */
  function create(d) {
    d = d || {};
    var B = d.ball;
    var delay = d.delay || function (fn, ms) { return setTimeout(fn, ms); }, cancel = d.cancel || function (h) { clearTimeout(h); };
    var now = d.now || function () { return new Date(); };
    var toast = d.toast || function () {}, listeners = [];
    var st = { seq: 0, lastKey: '', last: null, timer: null, busy: false, again: false, ok: false, time: '', at: '', alarmSig: null, endedFor: null, dead: false, gen: 0, ended: false };

    function clockStamp(date) { var p = function (n) { return (n < 10 ? '0' : '') + n; }; return p(date.getHours()) + ':' + p(date.getMinutes()); }
    function emit(r) { listeners.slice().forEach(function (fn) { try { fn(r); } catch (e) { /* a listener never stops a publish */ } }); }
    function keyOf(m) { var c = clone(m); delete c.seq; return JSON.stringify(c); }
    function nextSeq() {
      var stored = typeof d.stored === 'function' ? d.stored() : null, base = Math.max(st.seq, isObj(stored) ? whole(stored.seq) : 0);
      return base + 1;
    }
    function startKey(src) { return JSON.stringify([isObj(src.state) ? src.state.site : '', isObj(src.state) ? src.state.start : null]); }
    /* a v2 night is on: the play block is v2 and the ball is a v2 ball with a time */
    function live(src) { return !!src && isObj(src.play) && src.play.v === 2 && isObj(src.state) && src.state.v === 2 && typeof src.state.t === 'number' && isFinite(src.state.t); }

    /* screenMission with the page's deny list; a deny list that cannot be read (it throws) is a refusal, never an uncaught throw */
    function screenFor(m, src) {
      var deny = null;
      try { deny = typeof src.deny === 'function' ? src.deny() : null; } catch (e) { return { name: 'the hidden-name list could not be read', path: 'mission', kind: 'deny' }; }
      return screenMission(m, deny, d.namesHit);
    }
    function say(text, bad) { try { toast(text, !!bad); } catch (e) { /* none */ } }

    /* a refusal (the page's own screen, or the server's 422): the notice replaces the one before it (it is one line, not a stack), on every attempt until it is cleared */
    function refuse(hit) {
      var npc = typeof d.hiddenNpc === 'function' ? d.hiddenNpc(hit.name) : null;
      if (npc && typeof d.offer === 'function' && typeof d.reveal === 'function') {
        d.offer({
          text: 'Not sent to the players: it names ' + npc.name + ', who is still hidden.',
          label: 'Reveal ' + npc.name + ' and send',
          run: function () { return revealAndSend(npc); }
        });
      } else if (hit.kind === 'deny') say('Not sent to the players: the hidden-name list could not be read.', true);
      else if (hit.kind === 'secret') say('Not sent to the players: it holds one of the level’s secret words (' + hit.path + ').', true);
      else if (hit.kind === 'shape') say('Not sent to the players: the page could not check it (' + hit.name + ').', true);
      else say('Not sent to the players: it names “' + hit.name + '”, which they cannot see (' + hit.path + '). Open that room, or reveal or rename it.', true);
      st.ok = false;
      emit({ ok: false, refused: hit, time: st.time, at: st.at, seq: st.seq });
    }

    function revealAndSend(npc) {
      return Promise.resolve().then(function () { return d.reveal(npc); }).then(function (done) {
        if (done === false) return { ok: false, skipped: 'declined' };
        return publishMission({ force: true });
      }, function (e) { say('Could not reveal ' + npc.name + ': ' + str(e && e.message), true); return { ok: false, error: e }; });
    }

    /* ---- publishMission: one publish (build, compare, screen, send). opts.force sends even when nothing changed since the last one ---- */
    function publishMission(opts) {
      opts = opts || {};
      if (st.timer !== null) { cancel(st.timer); st.timer = null; }
      if (st.dead) return Promise.resolve({ ok: false, skipped: 'closed' });
      if (st.busy) { st.again = true; return Promise.resolve({ ok: false, skipped: 'busy' }); }
      var src = typeof d.source === 'function' ? d.source() : null;
      if (!live(src)) return Promise.resolve({ ok: false, skipped: 'no run' });
      if (st.endedFor !== null && st.endedFor === startKey(src)) return Promise.resolve({ ok: false, skipped: 'ended' });
      st.endedFor = null;
      var seq = nextSeq(), m = buildMission(B, src, seq);
      if (!m) return Promise.resolve({ ok: false, skipped: 'no mission' });
      st.alarmSig = JSON.stringify(alarmOf(src.play, src.clocks) || null);     /* noteClocks compares with the alarm this mission was built from */
      var key = keyOf(m);
      if (!opts.force && key === st.lastKey) return Promise.resolve({ ok: true, skipped: 'unchanged', seq: st.seq });
      var hit = screenFor(m, src);
      if (hit) { refuse(hit); return Promise.resolve({ ok: false, refused: hit }); }
      st.busy = true;
      var gen = st.gen, time = isObj(m.hud) ? str(m.hud.time) : '';
      return Promise.resolve().then(function () { return d.send(m); }).then(function () {
        if (gen !== st.gen) { st.busy = false; return { ok: true, skipped: 'ended' }; }       /* the night was ended while this was out: the server saw the end after it */
        st.busy = false; st.ended = false; st.seq = seq; st.lastKey = key; st.last = clone(m); st.ok = true; st.time = time; st.at = clockStamp(now());
        var r = { ok: true, seq: seq, time: time, at: st.at };
        emit(r);
        if (st.again) { st.again = false; schedule(); }
        return r;
      }, function (e) {
        st.busy = false;
        var h = parseRefusal(e);
        if (h) { refuse(h); if (st.again) { st.again = false; schedule(); } return { ok: false, refused: h }; }
        st.ok = false;
        say('The players’ screens were not updated: ' + str(e && e.message || 'failed') + '. It tries again on the next change.', true);
        emit({ ok: false, error: e, time: st.time, at: st.at, seq: st.seq });
        if (st.again) { st.again = false; schedule(); }
        return { ok: false, error: e };
      });
    }

    function schedule() {
      if (st.dead) return;
      if (st.timer !== null) cancel(st.timer);
      st.timer = delay(function () { st.timer = null; publishMission(); }, DEBOUNCE_MS);
    }

    /* ---- End the night ---- */
    function endNight() {
      var src = typeof d.source === 'function' ? d.source() : null;
      if (typeof d.confirm === 'function' && !d.confirm('End the night? The band on the iPad and every phone’s card go away.')) return Promise.resolve({ ok: false, skipped: 'declined' });
      if (st.timer !== null) { cancel(st.timer); st.timer = null; }
      st.again = false; st.gen++;
      return Promise.resolve().then(function () { return d.send(null); }).then(function () {
        st.last = null; st.lastKey = ''; st.ok = false; st.time = ''; st.at = ''; st.ended = true;
        st.endedFor = src ? startKey(src) : null;
        var r = { ok: true, ended: true, time: '', at: clockStamp(now()), seq: st.seq };
        emit(r);
        return r;
      }, function (e) {
        say('Could not end the night: ' + str(e && e.message || 'failed') + '.', true);
        return { ok: false, error: e };
      });
    }

    /* ---- the overlay a public event earns when Next lands on it ---- */
    function landed(from, to, how) {
      if (how !== 'next' || typeof d.overlay !== 'function') return Promise.resolve(null);
      var src = typeof d.source === 'function' ? d.source() : null;
      if (!live(src)) return Promise.resolve(null);
      var o = overlayFor(B, src.play, from, to);
      if (!o) return Promise.resolve(null);
      var hit = screenFor({ v: 1, hud: { text: o.text }, cards: {} }, src);
      if (hit) return Promise.resolve(null);       /* the gate would refuse it too; stay quiet */
      return Promise.resolve(d.overlay(o)).then(function (r) { return r === undefined ? true : r; }, function () { return null; });
    }

    var ctl = {
      changed: function () { schedule(); },
      noteClocks: function () {
        var src = typeof d.source === 'function' ? d.source() : null;
        if (!live(src)) return;
        var sig = JSON.stringify(alarmOf(src.play, src.clocks) || null);
        if (st.alarmSig === null) { st.alarmSig = sig; return; }      /* the first look is the baseline */
        if (sig !== st.alarmSig) { st.alarmSig = sig; schedule(); }
      },
      publishNow: function (o) { return publishMission(o); },
      flush: function () { return st.timer !== null ? publishMission() : Promise.resolve(null); },
      endNight: endNight,
      landed: landed,
      onPublished: function (fn) { if (typeof fn !== 'function') return function () {}; listeners.push(fn); return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); }; },
      status: function () {
        if (!st.time && !st.ended) {            /* a page opened mid-night: what the campaign document holds is what the players see */
          var s0 = typeof d.stored === 'function' ? d.stored() : null, t0 = isObj(s0) && isObj(s0.hud) ? str(s0.hud.time) : '';
          if (t0) return { ok: true, time: t0, at: '', seq: whole(s0.seq), text: 'Players: ' + t0 + ' ✓' };
        }
        return { ok: st.ok, time: st.time, at: st.at, seq: st.seq, text: st.time ? 'Players: ' + st.time + (st.ok ? ' ✓' : ' ✗ not sent') : '' };
      },
      last: function () { if (st.last) return clone(st.last); if (st.ended) return null; var s = typeof d.stored === 'function' ? d.stored() : null; return isObj(s) ? clone(s) : null; },
      destroy: function () { st.dead = true; if (st.timer !== null) { cancel(st.timer); st.timer = null; } listeners.length = 0; },
      _state: function () { return { seq: st.seq, waiting: st.timer !== null, busy: st.busy, endedFor: st.endedFor }; }
    };
    return ctl;
  }

  /* ---- overlayFor(B, play, from, to) -> { kind: 'text', text, ms } | null ----------------------------------------------------
     A public event with a pub that has just become "now": it is happening at `to` and was not at `from`, and the time went forward.
     Only the event's pub is used, at most 120 characters. One overlay: the earliest, then by id. */
  function overlayFor(B, play, from, to) {
    if (!isObj(play) || !isObj(play.clock) || typeof from !== 'number' || typeof to !== 'number' || !isFinite(from) || !isFinite(to) || !(to > from)) return null;
    var c = play.clock, beat = Number.isInteger(c.beat) && c.beat >= 5 && c.beat <= 60 ? c.beat : 15, list = [];
    (Array.isArray(play.events) ? play.events : []).forEach(function (e) {
      if (!isObj(e) || e.vis !== 'public' || typeof e.pub !== 'string' || !e.pub.trim()) return;
      var at = B && typeof B.minuteOf === 'function' ? B.minuteOf(e.at, c.start) : NaN;
      if (!isFinite(at)) return;
      var on = function (t) { return at <= t && t < at + beat; };
      if (on(to) && !on(from)) list.push({ at: at, id: str(e.id), pub: e.pub });
    });
    if (!list.length) return null;
    list.sort(function (a, b) { return a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0); });
    var text = list[0].pub.replace(/\s+/g, ' ').trim().slice(0, OVERLAY_MAX).trim();
    return text ? { kind: 'text', text: text, ms: OVERLAY_MS } : null;
  }

  /* ---- the Players view: the band and each PC's card, from the mission as last published ---------------------------------------- */
  function playersModel(m) {
    if (!isObj(m) || !isObj(m.hud)) return null;
    var h = m.hud, join = function (a) { return a.filter(Boolean).join(' · '); }, list = function (v) { return Array.isArray(v) ? v.filter(isObj) : []; };
    var band = {
      time: str(h.time), label: str(h.label),
      now: list(h.now).map(function (n) { return { text: str(n.text), line: join([n.where, n.until ? 'until ' + n.until : '']) }; }),
      next: list(h.next).map(function (n) { return { text: str(n.text), line: join([n.where, n.at]) }; }),
      alarm: isObj(h.alarm) ? join([str(h.alarm.name) + ' ' + (+h.alarm.filled || 0) + '/' + (+h.alarm.size || 0), h.alarm.text]) : '',
      night: isObj(h.night) ? 'Beat ' + (((+h.night.cur) || 0) + 1) + ' of ' + (+h.night.beats || 0) : '',
      marks: isObj(h.night) ? list(h.night.marks).map(function (k) { return (k.icon === 'star' ? '★ ' : '◆ ') + str(k.text); }) : [],
      crew: list(h.crew).map(function (c) { return join([c.name, c.costume, c.room]); }),
      target: isObj(h.target) ? 'In view: ' + str(h.target.room) : '',
      ways: isObj(h.ways) ? 'Ways found: ' + (+h.ways.found || 0) + ' of ' + (+h.ways.total || 0) : ''
    };
    var cards = isObj(m.cards) ? Object.keys(m.cards).filter(function (id) { return isObj(m.cards[id]); }).map(function (id) {
      var c = m.cards[id], sec = [];
      var add = function (title, lines) { lines = lines.filter(Boolean); if (lines.length) sec.push({ title: title, lines: lines }); };
      add('Position', [join([c.room, c.pos])]);
      add('Costume', [join([c.costume, c.icon])]);
      if (isObj(c.warn)) add('Watch out', [join([c.warn.who, c.warn.look, c.warn.sees ? 'sees through ' + c.warn.sees : ''])]);
      if (isObj(c.zones)) { add('At home', (Array.isArray(c.zones.controlled) ? c.zones.controlled : []).map(str)); add('Risky', (Array.isArray(c.zones.risky) ? c.zones.risky : []).map(str)); }
      add('Carrying', (Array.isArray(c.items) ? c.items : []).map(str));
      add('Leads', list(c.leads).map(function (l) { return join([str(l.name) + (l.done ? ' (done)' : ''), l.line, l.heard ? 'heard ' + l.heard : '', l.window, l.next ? 'next: ' + l.next : '']); }));
      add('Known', (Array.isArray(c.know) ? c.know : []).map(str));
      add('Next', list(c.next).map(function (n) { return join([n.text, n.where, n.at]); }));
      add('Paths open', list(c.paths).map(function (p) { return join([p.text, p.until ? 'until ' + p.until : '']); }));
      if (c.busy) add('Busy', ['until ' + str(c.busy)]);
      return { id: id, name: str(c.name), owner: str(c.owner), sections: sec };
    }) : [];
    return { site: str(m.site), seq: whole(m.seq), band: band, cards: cards };
  }

  /* renderPlayersView(el, mission, doc?): the model as plain elements, text only (doc: the document to make them in; else el's own). A missing mission says so. */
  function renderPlayersView(el, mission, docIn) {
    if (!el) return null;
    var doc = docIn || el.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return null;
    var node = function (tag, cls, text) { var n = doc.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
    el.textContent = '';
    var mdl = playersModel(mission);
    if (!mdl) { el.appendChild(node('p', 'gm-dim gm-pv-none', 'Nothing is published to the players.')); return null; }
    var root = node('div', 'gm-pv'), b = mdl.band;
    root.appendChild(node('p', 'gm-dim gm-pv-note', 'Exactly as last published' + (mdl.seq ? ' (#' + mdl.seq + ')' : '') + ': the iPad band, then each phone’s card.'));
    var band = node('section', 'gm-pv-band');
    band.appendChild(node('h3', 'gm-pv-h', 'The iPad band'));
    if (b.time) band.appendChild(node('p', 'gm-pv-time', b.time + (b.label ? ' · ' + b.label : '')));
    var group = function (box, title, rows) {
      if (!rows.length) return;
      box.appendChild(node('p', 'gm-pv-kick', title));
      rows.forEach(function (r) { var it = node('div', 'gm-pv-item'); it.appendChild(node('p', 'gm-pv-head', r.text)); if (r.line) it.appendChild(node('p', 'gm-pv-line', r.line)); box.appendChild(it); });
    };
    group(band, 'Now', b.now); group(band, 'Next', b.next);
    if (b.alarm) band.appendChild(node('p', 'gm-pv-line gm-pv-alarm', b.alarm));
    if (b.night) band.appendChild(node('p', 'gm-pv-line', b.night + (b.marks.length ? ' · ' + b.marks.join(', ') : '')));
    b.crew.forEach(function (c) { band.appendChild(node('p', 'gm-pv-crew', c)); });
    if (b.target) band.appendChild(node('p', 'gm-pv-line', b.target));
    if (b.ways) band.appendChild(node('p', 'gm-pv-line', b.ways));
    root.appendChild(band);
    mdl.cards.forEach(function (c) {
      var card = node('section', 'gm-pv-card');
      card.setAttribute('data-pc', c.id);
      card.appendChild(node('h3', 'gm-pv-h', c.name || 'A player'));
      if (!c.sections.length) card.appendChild(node('p', 'gm-dim', 'Nothing on this card yet.'));
      c.sections.forEach(function (s) {
        card.appendChild(node('p', 'gm-pv-kick', s.title));
        s.lines.forEach(function (l) { card.appendChild(node('p', 'gm-pv-line', l)); });
      });
      root.appendChild(card);
    });
    el.appendChild(root);
    return mdl;
  }

  return {
    create: create, buildMission: buildMission, screenMission: screenMission,
    alarmOf: alarmOf, missionTexts: missionTexts, parseRefusal: parseRefusal, overlayFor: overlayFor,
    playersModel: playersModel, renderPlayersView: renderPlayersView,
    DEBOUNCE_MS: DEBOUNCE_MS, OVERLAY_MS: OVERLAY_MS, OVERLAY_MAX: OVERLAY_MAX
  };
});
