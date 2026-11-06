/* B68GmHardStart: the GM's side of the hard start (suite ticket 1.2, switch spine.start). The table display draws it (app/display/hardstart.js);
   this file lays the layers it reads, through the show contract (B68Show.layer), and gives the GM a small sheet to run it from.

   The layers it writes (and nothing else):
     scene.mode 'start'    data.countdown { to, label }    data.credits [npcId]    data.previously [npcId]    band.faces [{ npcId }]
   A hidden NPC cannot be picked: pool() lists revealed NPCs only, setPick refuses any other id, and the server drops a hidden one on write and again on
   every poll (functions/_lib/show.js), so a stale pick still never reaches the iPad.

   make(host) -> ctl, with host = { layer(path, value) -> Promise, npcs() -> { id: npcDoc }, now() -> ms, startAt() -> ms | 0, toast?(msg, bad?),
     onTitles?() -> Promise<bool> (pin the credits), onIpad?() -> text (what is on the iPad),
     onAir?() -> { start, to, label, previously, faces, seq } | null (F3: what the ambient document holds: the start scene, its countdown, the faces
     laid; null before the page has read it) }
     ctl.sync()              F3: adopt what the iPad shows (after a reload the start scene arms the sheet again; one taken down elsewhere disarms it), and
                             draw the sheet again if that changed -> bool. state() adopts too.
     ctl.pool()              revealed NPCs, most recently revealed first: [{ id, name, role, firstSeen }]  (the three picks default to its first three)
     ctl.picks()             the three chosen ids now (a pick that is no longer revealed drops out and the next in the pool fills the slot)
     ctl.setPick(slot, id)   -> bool        false for an unknown or hidden NPC, or a slot outside 0..2, or an id already in another slot
     ctl.arm(at, label?)     lay the test card and the station clock for `at` (ms) -> Promise<bool>        ctl.armTest(minutes = 2) -> arm(now + minutes), a test only:
                             it never reads or writes the night's startAt
     ctl.go()                the clock to now: the same path as zero -> Promise<bool>
     ctl.reveal(slot)        show the name plate of that face (one tap) -> Promise<bool>; a face already shown stays shown
     ctl.end()               End without credits: take the hard start off the iPad (every layer it set) -> Promise<bool>; the ambient scene plays. The page's
                             Clear calls this one too, so it never plays the credits.
     ctl.roll()              Roll the opening credits: end(), then host.onTitles() (gm-page.js pins the ambient Opening credits scene, with the theme) -> Promise<bool>.
                             The GM presses it when Previously on is done: the hard start ends where the Opening Titles begin.
     ctl.state()             { armed, at, test, shown: [slot], picks, rolled }      (rolled: the last end was Roll the opening credits; the sheet then reads
                             host.onIpad() -> the tray's live line, so it says what is on the iPad)
   The sheet (open/toggle/render) is drawn in the right-edge sheet shared with the Switchboard (B68GmWorkshop.sheet). */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root) root.B68GmHardStart = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';
  var SLOTS = 3, CREDITS_MAX = 8, TEST_MIN = 2;
  var PATHS = ['scene.mode', 'data.countdown', 'data.credits', 'data.previously', 'band.faces'];

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* the revealed NPCs, newest reveal first (firstSeen is set the moment an NPC is revealed); no firstSeen sorts last, ties by name */
  function poolOf(npcs) {
    var out = [];
    Object.keys(isObj(npcs) ? npcs : {}).forEach(function (id) {
      var d = npcs[id];
      if (!isObj(d) || d.revealed !== true || !str(d.name).trim()) return;
      var t = Date.parse(str(d.firstSeen));
      out.push({ id: id, name: str(d.name).trim(), role: str(d.role).trim(), firstSeen: isFinite(t) ? t : -Infinity });
    });
    out.sort(function (a, b) { return b.firstSeen !== a.firstSeen ? (b.firstSeen > a.firstSeen ? 1 : -1) : (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1); });
    return out.map(function (p) { return { id: p.id, name: p.name, role: p.role, firstSeen: isFinite(p.firstSeen) ? new Date(p.firstSeen).toISOString() : '' }; });
  }
  function hhmm(ms) { var d = new Date(ms); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }

  /* F3: what the ambient document says is on the iPad (host.onAir(), read from the layers this file writes): null when the page has not read it yet */
  function idOf(x) { return typeof x === 'string' ? x : isObj(x) ? str(x.npcId || x.id) : ''; }
  function airOf(a) {
    if (!isObj(a)) return null;
    var to = Math.floor(Number(a.to));
    return { start: a.start === true && isFinite(to) && to > 0, to: isFinite(to) ? to : 0, label: str(a.label), seq: typeof a.seq === 'number' && isFinite(a.seq) ? a.seq : null,
      previously: (Array.isArray(a.previously) ? a.previously : []).map(idOf).filter(Boolean), faces: (Array.isArray(a.faces) ? a.faces : []).map(idOf).filter(Boolean) };
  }

  function make(host) {
    var h = host || {};
    /* busy: one of this page's own writes is under way (its document is half written: nothing is adopted from it). mark: the ambient seq (and the
       time) at this page's last arm or end, so an ambient document no newer than that cannot undo it (a stale read re-arming right after End) */
    var st = { armed: false, at: 0, test: false, shown: [], chosen: [null, null, null], busy: 0, mark: null };
    var MARK_MS = 5000;
    function npcs() { return typeof h.npcs === 'function' ? h.npcs() : {}; }
    function now() { return typeof h.now === 'function' ? h.now() : Date.now(); }
    function say(m, bad) { if (typeof h.toast === 'function') h.toast(m, bad === true); }
    function layer(path, v) { return typeof h.layer === 'function' ? Promise.resolve(h.layer(path, v)) : Promise.resolve(null); }
    function air() { if (typeof h.onAir !== 'function') return null; try { return airOf(h.onAir()); } catch (e) { return null; } }
    /* the writes AND the state they settle, as one: busy until both are done */
    function held(fn) { st.busy++; var p; try { p = Promise.resolve(fn()); } catch (e) { p = Promise.reject(e); } return p.then(function (r) { st.busy--; return r; }, function (e) { st.busy--; throw e; }); }
    function markNow() { var a = air(); st.mark = { seq: a ? a.seq : null, at: now() }; }
    function newer(a) {
      if (!st.mark) return true;
      if (a.seq !== null && st.mark.seq !== null) return a.seq > st.mark.seq;
      return now() - st.mark.at > MARK_MS;
    }
    /* F3: the source of truth is what the iPad shows. After a reload this page knows nothing of its own arm; the ambient document does: the start
       scene and its countdown arm the sheet again (the time, Test, the three faces laid and the names shown); a start taken down elsewhere (the
       tray's Clear on another device) disarms it. Never while one of this page's own writes is under way, nor from a document no newer than it */
    function adopt() {
      if (st.busy) return false;
      var a = air(); if (!a || a.start === st.armed || !newer(a)) return false;
      if (!a.start) { st.armed = false; st.test = false; st.shown = []; return true; }
      /* the faces laid, by slot, kept as ids even before the cast has arrived after a reload (picks() resolves them against the revealed cast) */
      var prev = a.previously.slice(0, SLOTS);
      if (prev.length) { var ch = prev.slice(); while (ch.length < SLOTS) ch.push(null); st.chosen = ch; }
      st.armed = true; st.at = a.to; st.test = a.label === 'Test'; st.rolled = false;
      st.shown = []; prev.forEach(function (id, i) { if (a.faces.indexOf(id) >= 0) st.shown.push(i); });
      return true;
    }
    function seq(steps) {   /* in order, stopping at the first the page refused (a refused write answers null) */
      var ok = true;
      return steps.reduce(function (p, s) { return p.then(function () { if (!ok) return null; return s().then(function (r) { if (r === null || r === undefined) ok = false; return r; }); }); }, Promise.resolve()).then(function () { return ok; });
    }
    function live() { var p = poolOf(npcs()), ids = {}; p.forEach(function (x) { ids[x.id] = x; }); return { pool: p, byId: ids }; }
    var ctl = {
      pool: function () { return live().pool; },
      picks: function () {
        var L = live(), out = [];
        st.chosen.forEach(function (id) { if (id && L.byId[id] && out.indexOf(id) < 0) out.push(id); else out.push(null); });
        for (var i = 0; i < SLOTS; i++) if (!out[i]) { for (var j = 0; j < L.pool.length; j++) if (out.indexOf(L.pool[j].id) < 0) { out[i] = L.pool[j].id; break; } }
        return out.filter(function (x) { return !!x; });
      },
      setPick: function (slot, id) {
        var L = live(); slot = +slot;
        if (!(slot >= 0 && slot < SLOTS) || Math.floor(slot) !== slot || !L.byId[id]) return false;
        var cur = ctl.picks();
        if (cur.indexOf(id) >= 0 && cur[slot] !== id) return false;
        var next = cur.slice(); while (next.length < SLOTS) next.push(null); next[slot] = id; st.chosen = next;
        return true;
      },
      arm: function (at, label) {
        var t = Math.floor(Number(at));
        if (!isFinite(t) || t < 1) { say('Pick a start time first.', true); return Promise.resolve(false); }
        /* just after a reload the cast has not arrived yet: arming now would lay no credits and no faces */
        if (!Object.keys(npcs() || {}).length) { say('The cast is still loading: arm again in a moment.', true); return Promise.resolve(false); }
        var L = live(), picks = ctl.picks(), credits = L.pool.slice(0, CREDITS_MAX).map(function (p) { return p.id; });
        st.shown = [];
        return held(function () {
          return seq([
            function () { return layer('band.faces', null); },
            function () { return layer('data.credits', credits.length ? credits : null); },
            function () { return layer('data.previously', picks.length ? picks : null); },
            function () { return layer('data.countdown', { to: t, label: str(label).trim().slice(0, 40) || 'Station clock' }); },
            function () { return layer('scene.mode', 'start'); }
          ]).then(function (ok) { if (ok) { st.armed = true; st.at = t; st.test = false; st.rolled = false; markNow(); } return ok; });
        });
      },
      armTest: function (minutes) {
        var m = Number(minutes); if (!(m > 0)) m = TEST_MIN;
        return ctl.arm(now() + Math.round(m * 60000), 'Test').then(function (ok) { if (ok) st.test = true; return ok; });
      },
      go: function () {
        adopt();      /* F3: just after a reload, the iPad's start scene is the arm */
        if (!st.armed) { say('Arm the hard start first.', true); return Promise.resolve(false); }
        var t = now();
        return held(function () { return layer('data.countdown', { to: t, label: 'Station clock' }).then(function (r) { if (r === null || r === undefined) return false; st.at = t; return true; }); });
      },
      reveal: function (slot) {
        adopt();
        slot = +slot;
        var picks = ctl.picks();
        if (!st.armed || !(slot >= 0 && slot < picks.length) || Math.floor(slot) !== slot) return Promise.resolve(false);
        if (st.shown.indexOf(slot) < 0) st.shown = st.shown.concat([slot]).sort();
        var ids = st.shown.map(function (s) { return picks[s]; }).filter(function (x) { return !!x; });
        return held(function () { return layer('band.faces', ids.map(function (id) { return { npcId: id }; })).then(function (r) { return r !== null && r !== undefined; }); });
      },
      end: function () {
        return held(function () {
          return seq(PATHS.slice().reverse().map(function (p) { return function () { return layer(p, null); }; })).then(function (ok) {
            if (ok) { st.armed = false; st.test = false; st.shown = []; st.rolled = false; markNow(); }
            return ok;
          });
        });
      },
      /* Roll the opening credits: end() (every layer it set comes off), then host.onTitles() pins the Opening credits scene (the GM picks the moment) */
      roll: function () {
        return ctl.end().then(function (ok) {
          if (!ok) return false;
          if (typeof h.onTitles !== 'function') { say('The opening credits cannot be pinned from here.', true); return false; }
          return Promise.resolve().then(function () { return h.onTitles(); }).then(function (r) { if (r === false || r === null) return false; st.rolled = true; return true; }, function () { return false; });
        });
      },
      state: function () { adopt(); return { armed: st.armed, at: st.at, test: st.test, shown: st.shown.slice(), picks: ctl.picks(), rolled: !!st.rolled }; },
      /* F3: the page calls this when its copy of the ambient document changes: the sheet is drawn again only when the arm it shows has changed */
      sync: function () {
        var ch = adopt(), b = sheet();
        /* also when what it would draw has changed under it: after a reload the cast arrives after the first draw, so the faces read (none) until then */
        if (b && b.isOpen() && (ch || (st.drawn && drawSig() !== st.drawn))) ctl.render(b.body);
        return ch;
      }
    };

    /* ---- the sheet ---- */
    function Sheet() { return W && W.B68GmWorkshop ? W.B68GmWorkshop : null; }
    function sheet() { var S = Sheet(), r = typeof h.root === 'function' ? h.root() : null; return S && r ? S.sheet(r, 'hardstart', 'Hard start') : null; }
    function drawSig() { return JSON.stringify([st.armed, st.at, st.test, st.shown, st.rolled, ctl.picks(), live().pool.map(function (p) { return p.id + ':' + p.name + ':' + p.role; })]); }
    ctl.render = function (box) {
      if (!box) return;
      var s = ctl.state(), L = live(), picks = s.picks, start = typeof h.startAt === 'function' ? +h.startAt() || 0 : 0;      /* state() first: it adopts the iPad's faces, so the picks drawn are the ones laid */
      st.drawn = drawSig();
      var opts = function (cur) { return '<option value="">(none)</option>' + L.pool.map(function (p) { return '<option value="' + esc(p.id) + '"' + (p.id === cur ? ' selected' : '') + '>' + esc(p.name) + (p.role ? ' (' + esc(p.role) + ')' : '') + '</option>'; }).join(''); };
      /* after Roll the opening credits the line says what is on the iPad now (the tray's live line, host.onIpad), until the next arm */
      var onIpad = !s.armed && s.rolled && typeof h.onIpad === 'function' ? str(h.onIpad()) : '';
      var status = s.armed ? (s.test ? 'Test armed' : 'Armed') + ' for ' + esc(hhmm(s.at)) + '.'
        : s.rolled ? '<b>On the iPad: ' + esc(onIpad || 'Opening credits') + '.</b> To move on, pin the next scene (iPad view, Scenes) or fire a cue. Clear keeps the credits’ title card.'
        : 'Not armed. The iPad shows the test card and a station clock once you arm it.';
      var h2 = '<p class="gm-dim" data-hs-status>' + status + '</p>' +
        '<div class="gm-sb-row"><button type="button" class="btn sm' + (s.armed ? '' : ' primary') + '" data-hs="arm"' + (start ? '' : ' disabled') + ' title="' + (start ? 'Counts down to the night’s start time' : 'The night has no start: line in its Run sheet') + '">Arm for ' + (start ? esc(hhmm(start)) : 'the night’s start') + '</button> ' +
        '<button type="button" class="btn sm" data-hs="test">Test: start in 2 minutes</button> <button type="button" class="btn sm" data-hs="go"' + (s.armed ? '' : ' disabled') + '>GO now</button></div>';
      /* once it is armed: how it ends. The GM picks the moment for the credits (after Previously on), or ends without them */
      if (s.armed) h2 += '<div class="gm-sb-row gm-hs-end"><button type="button" class="btn sm primary" data-hs="roll" title="End the hard start, then play the Opening credits scene on the iPad, with the theme">Roll the opening credits</button> ' +
        '<button type="button" class="btn sm" data-hs="end" title="End the hard start: its card, clock, credits and faces come off the iPad; the ambient scene plays">End without credits</button></div>' +
        '<p class="gm-dim gm-hs-tap">The iPad plays sound only after a tap on it: if it shows “Tap for sound”, tap the iPad first.</p>';
      h2 += '<h3>Previously on: three faces from the people the table has met</h3>';
      for (var i = 0; i < SLOTS; i++) {
        h2 += '<div class="gm-sb-row"><label>Face ' + (i + 1) + ' <select data-hs-pick="' + i + '">' + opts(picks[i] || '') + '</select></label> ' +
          '<button type="button" class="btn sm" data-hs-reveal="' + i + '"' + (s.armed && picks[i] ? '' : ' disabled') + ' aria-pressed="' + (s.shown.indexOf(i) >= 0) + '">' + (s.shown.indexOf(i) >= 0 ? 'Name shown' : 'Reveal the name') + '</button></div>';
      }
      h2 += '<p class="gm-dim">Only NPCs you have revealed are listed. The three newest reveals are picked for you.</p>';
      box.innerHTML = L.pool.length ? h2 : h2 + '<p class="gm-empty">No NPC has been revealed yet, so there is no one to show.</p>';
      var sh = box.parentNode;
      if (sh && !sh.__hs) {
        sh.__hs = true;
        sh.addEventListener('click', function (ev) {
          var t = ev.target && ev.target.closest ? ev.target.closest('[data-hs],[data-hs-reveal]') : null; if (!t) return;
          var a = t.getAttribute('data-hs'), p;
          if (t.hasAttribute('data-hs-reveal')) p = ctl.reveal(+t.getAttribute('data-hs-reveal'));
          else if (a === 'arm') p = ctl.arm(typeof h.startAt === 'function' ? h.startAt() : 0);
          else if (a === 'test') p = ctl.armTest(TEST_MIN);
          else if (a === 'go') p = ctl.go();
          else if (a === 'end') p = ctl.end();
          else if (a === 'roll') p = ctl.roll();
          if (p) p.then(function () { var b = sheet(); if (b && b.isOpen()) ctl.render(b.body); });
        });
        sh.addEventListener('change', function (ev) {
          var t = ev.target && ev.target.getAttribute ? ev.target : null; if (!t || !t.hasAttribute('data-hs-pick')) return;
          if (!ctl.setPick(+t.getAttribute('data-hs-pick'), t.value)) say('That NPC cannot be shown.', true);
          var b = sheet(); if (b && b.isOpen()) ctl.render(b.body);
        });
      }
    };
    ctl.open = function () { var b = sheet(); if (!b) return false; ctl.render(b.body); b.open(); return true; };
    ctl.close = function () { var b = sheet(); if (b) b.close(); };
    ctl.toggle = function () { var b = sheet(); if (b && b.isOpen()) { b.close(); return false; } return ctl.open(); };
    return ctl;
  }

  return { make: make, poolOf: poolOf, SLOTS: SLOTS, TEST_MIN: TEST_MIN, PATHS: PATHS };
});
