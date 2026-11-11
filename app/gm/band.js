/* gm/band.js — THE BAND (the GM night rebuild: the frame): one black element on top of the GM page, two rows, always there, never
   scrolling. It replaces the old top bar, the phase rail, the cue bar and the curfew bar; nothing is ever inserted between it and the main
   area again (the laptop grid is band / main / foot).

   Window.B68GmBand in the browser, and module.exports under Node (checks/runtime/gm-band.test.mjs: the pure part, and the band on a fake page).

   ROW 1, where you are: the mark and the session; the PLACES of the night (W.B68GmPlaces.list() when the places registry is on the page, else
   the same six: Before, Opening, Personal, Planning, Score, Aftermath), then Between; the save mark; Find (Ctrl K); Crew (W, the drawer); Menu,
   with a dot when the pack is old or an offline copy.
     A phase chip shows its minutes against its budget (gm/phase-rail.js: amber from 80%, red once over) and done / now / next. The chip of the
     place on screen is SELECTED (aria-current); the chip of the night's phase is NOW (an orange bar under it): they differ when the GM looks at
     Planning while the night is still in Personal business. A tap calls host.goPlace(id).
   ROW 2, what is live: the wall clock and the curfew ("curfew 22:40 · 58 min"); the running beat of the Prep run order (the page paints it);
     the iPad tray (W.B68GmIpadTray.create(host).mount(slot) when it is on the page, else today's controls: the iPad pill, Clear 0, Blank and
     the autopilot pill, painted by the page); the mic (the Listening pill, painted by the page); the cue (gm/cue-stack.js draws itself into
     cueSlot()); the quiet-line badge (gm/quiet.js mounts into its slot); PANIC, always last.
     Curfew due: row 2 turns alarm red and offers Call the Aftermath (host.callAftermath()), Keep running and Snooze 10 min (once), the rules of
     gm/curfew.js. The work light (a PANIC) turns it red too, with Resume in the cue's place. Signed out: the page marks the band `out` and row 2
     says so in red (#gm-signed).

   THE PAGE PAINTS these by id, as it painted the bar: #gm-bar-sess, .gm-save, #gm-bar-exp (the Menu's dot), #gm-bar-beat / #gm-bar-beatgo,
   #gm-bar-ipad and #gm-bar-ap (the tray's stand-in), #gm-bar-stt (the mic), #gm-signed, and the Menu's own lines (host.menuHtml()).

   PURE
     PLACES, BETWEEN                    the places when no registry is on the page
     placeList(reg?) -> { list: [{ id, label, phase }], between: { id, label, phase: null } }
     chips(o) -> [{ id, label, phase, between, selected, state, tone, text, title }]
       o: { places, night (a clean night | null), budgets (the prep note's, by phase | null), start ('HH:MM' | null), started (bool), now (ms), current (place id) }
     clockText(ms) -> 'HH:MM'          curfewText(at, curfewMs, nowMs) -> 'curfew 22:40 · 58 min' | '... · now' | '... · 5 min over' | ''
     step(list, current, d) -> the place id d places along (no wrap), for Ctrl+Left / Ctrl+Right
   DOM
     create(host) -> band { mount(headerEl), update(), el(), cueSlot(), traySlot(), quietSlot(), menuEl(), destroy() }
       host (every member optional; the band guards each):
         night() -> the night controller (gm/night.js create)      prep() -> the open prep note | null      now() -> ms
         currentPlace() -> id      goPlace(id, { navigateOnly })      callAftermath()      openView(id)      (the places, N1b; the page has stand-ins)
         curfew() -> the curfew controller (gm/curfew.js create: view(), keep(), snooze())      cue() -> the cue-stack controller | null
         panic() -> PANIC (the cue stack's: the safe scene, sound down, the work light)      menuHtml() -> the Menu's lines      signedOut() -> text
         root() -> #gm-root (the band writes --dw-top and --gm-bar-h on it: the drawer, the sheets and the phone's chips sit under the band)
       The band registers its two popovers with W.B68GmEsc (the cue's ⋯ and the quiet list, priority 70) and takes them down in destroy().
     THE NEW DESK (kit.desk, KS05): while W.B68KitBand.on() (gm/kit/band.js), mount() draws its skeleton (the same ids, hooks and old classes) and
       its Blade button, and update() its phase tabs; band.follow() redraws when the setting turns and asks host.redraw() to paint the parts again.
       live() -> the bands mounted now. Off, every branch is the old path. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmBand = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var PLACES = [
    { id: 'before', label: 'Before', phase: null }, { id: 'opening', label: 'Opening', phase: null },
    { id: 'pb', label: 'Personal', phase: 'pb' }, { id: 'plan', label: 'Planning', phase: 'plan' },
    { id: 'score', label: 'Score', phase: 'score' }, { id: 'after', label: 'Aftermath', phase: 'after' }
  ];
  var BETWEEN = { id: 'between', label: 'Between', phase: null };
  var PHASE_NAME = { pb: 'Personal Business', plan: 'Planning', score: 'Score', after: 'Aftermath' };
  var ID_RE = /^[a-z][a-z0-9-]{0,23}$/;
  var TICK_MS = 10000;

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function req(name) { try { return typeof require === 'function' ? require(name) : null; } catch (e) { return null; } }
  function mod(win, node) { return (W && W[win]) || req(node); }
  function rail() { return mod('B68GmPhaseRail', './phase-rail.js'); }
  /* the new desk (kit.desk, KS05: gm/kit/band.js) draws the band when it is on; null otherwise, and every branch below is the old path. LIVE: the bands
     mounted now, so the kit can redraw them when the setting turns (follow()) */
  var LIVE = [];
  function kit() { var K = W && W.B68KitBand; return K && typeof K.on === 'function' && K.on() ? K : null; }

  /* ---------- the places ---------- */
  function normPlace(p) { return { id: str(p.id), label: str(p.label) || str(p.id), phase: PHASE_NAME[p.phase] ? p.phase : null }; }
  function placeList(reg) {
    var R = reg || (W && W.B68GmPlaces) || null, list = null, betw = null;
    try { if (R && typeof R.list === 'function') list = R.list(); } catch (e) { list = null; }
    try { if (R && typeof R.between === 'function') betw = R.between(); } catch (e) { betw = null; }
    list = Array.isArray(list) ? list.filter(function (p) { return isObj(p) && ID_RE.test(str(p.id)) && p.id !== 'between'; }) : [];
    if (!list.length) list = PLACES;
    return { list: list.map(normPlace), between: isObj(betw) && ID_RE.test(str(betw.id)) ? normPlace(betw) : BETWEEN };
  }
  /* the place d steps along the night (Between last), never past either end */
  function step(places, current, d) {
    var ids = places.list.map(function (p) { return p.id; }).concat([places.between.id]), i = ids.indexOf(current);
    if (i < 0) i = 0;
    return ids[Math.max(0, Math.min(ids.length - 1, i + (d < 0 ? -1 : 1)))];
  }

  function toneOf(mins, budget) {
    var R = rail(); if (R && typeof R.toneOf === 'function') return R.toneOf(mins, budget);
    if (!(budget > 0) || mins === null) return '';
    return mins > budget ? 'red' : mins >= budget * 0.8 ? 'amber' : '';
  }
  function chips(o) {
    o = o || {};
    var places = o.places || placeList(), R = rail(), m = null, byId = {};
    try { m = R && typeof R.model === 'function' ? R.model(o.night || null, num(o.now) || 0) : null; } catch (e) { m = null; }
    (m && Array.isArray(m.items) ? m.items : []).forEach(function (i) { byId[i.id] = i; });
    return places.list.concat([places.between]).map(function (p) {
      var c = { id: p.id, label: p.label, phase: p.phase, between: p.id === places.between.id, selected: p.id === o.current, state: '', tone: '', text: '', title: '' };
      if (p.phase) {
        var it = byId[p.phase] || {}, budget = num(it.budget) || num(o.budgets && o.budgets[p.phase]) || null, mins = num(it.mins);
        c.state = it.state === 'now' || it.state === 'done' ? it.state : 'next';
        if (c.state === 'next') c.text = budget ? '–/' + budget : '';
        else c.text = mins === null ? (budget ? '–/' + budget : '') : mins + (budget ? '/' + budget : ' min');
        if (c.state === 'now') c.tone = toneOf(mins, budget);
        else if (c.state === 'done' && budget && mins !== null && mins > budget) c.tone = 'red';
        var said = [c.state === 'now' ? 'the night is here' : c.state === 'done' ? 'done' : 'to come'];
        if (mins !== null && c.state !== 'next') said.push(mins + (budget ? ' of ' + budget : '') + ' min'); else if (budget) said.push('a ' + budget + ' min budget');
        if (c.tone === 'red') said.push('over budget'); else if (c.tone === 'amber') said.push('nearly at budget');
        c.title = PHASE_NAME[p.phase] + ': ' + said.join(', ') + (c.selected ? '. On screen' : '. Tap to go there');
      } else {
        if (p.id === 'before') c.text = o.start ? (o.started ? 'start ' : 'to ') + o.start : '';
        else if (p.id === 'opening') c.text = 'titles';
        else if (c.between) c.text = 'sessions';
        c.title = p.label + (p.id === 'before' ? ': the room, preflight and tonight' + (o.start ? ', until ' + o.start : '') : p.id === 'opening' ? ': the hard start and the titles' : c.between ? ': the days between sessions' : '') + (c.selected ? '. On screen' : '');
      }
      return c;
    });
  }
  function chipHtml(c) {
    var a = c.phase ? ' data-state="' + c.state + '"' : '';
    return '<button type="button" class="gm-place' + (c.between ? ' gm-place-btw' : '') + '" data-band-place="' + esc(c.id) + '"' + a + (c.tone ? ' data-tone="' + c.tone + '"' : '') +
      ' aria-current="' + (c.selected ? 'true' : 'false') + '" title="' + esc(c.title) + '"><span class="gm-place-n">' + esc(c.label) + '</span>' +
      '<span class="gm-place-t">' + esc(c.text) + '</span></button>';
  }

  /* ---------- the clock and the curfew ---------- */
  function clockText(ms) { var d = new Date(ms); return isNaN(d) ? '' : pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function curfewText(at, curfewMs, nowMs) {
    if (!at || num(curfewMs) === null || num(nowMs) === null) return '';
    var diff = curfewMs - nowMs;
    if (diff > 12 * 3600000) return 'curfew ' + at;                                       /* tomorrow's, for a night that has not begun */
    if (diff > 0) return 'curfew ' + at + ' · ' + Math.ceil(diff / 60000) + ' min';
    var over = Math.floor(-diff / 60000);
    return 'curfew ' + at + ' · ' + (over ? over + ' min over' : 'now');
  }

  /* ---------- the skeleton ---------- */
  function skeleton(o) {
    return '<div class="gm-band-r gm-band-r1" role="group" aria-label="Where you are">' +
      '<a class="gm-band-mark" href="#" title="Home">’68 <b>GM</b></a><span class="gm-bar-sess" id="gm-bar-sess"></span>' +
      '<nav class="gm-band-places" aria-label="Places of the night" data-band-places></nav>' +
      '<span class="gm-band-grow"></span>' +
      '<span class="gm-save" role="status"></span>' +
      '<button type="button" class="gm-bb gm-bb-ghost gm-band-find" data-gm="find-open" title="Find anything: prep, the screen, NPCs, clocks, what you filed (Ctrl+K or /)">Find <kbd>Ctrl K</kbd></button>' +
      '<button type="button" class="gm-bb gm-bb-ghost gm-dwbtn" data-gm="drawer" id="gm-bar-drawer" aria-expanded="false" aria-controls="gm-drawer"' +
      ' title="Clocks and the crew: the table, the crew sheet and each character’s sheet (W)">Crew</button>' +
      '<span class="gm-menu"><button type="button" class="gm-bb gm-bb-ghost gm-band-menu" data-gm="menu" aria-expanded="false" aria-haspopup="true">Menu<i class="gm-band-mdot" id="gm-bar-exp" hidden></i></button>' +
      '<span class="gm-menu-list" hidden>' + str(o.menu) + '</span></span>' +
      '</div>' +
      '<div class="gm-band-r gm-band-r2" role="group" aria-label="What is live" data-alarm="">' +
      '<span class="gm-band-clock"><b data-band-clock></b><small data-band-curfew></small></span>' +
      '<span class="gm-band-due" data-band-due hidden>' +
      '<button type="button" class="gm-band-call" data-band="call" title="End the score: the night moves to the Aftermath and its show starts">Call the Aftermath</button>' +
      '<button type="button" class="gm-band-soft" data-band="keep" title="Dismiss this for tonight; Next ▸ works as normal">Keep running</button>' +
      '<button type="button" class="gm-band-soft" data-band="snooze" title="Ask again in ten minutes (once)">Snooze 10 min</button></span>' +
      '<span class="gm-beatbar" id="gm-bar-beat" hidden><button type="button" class="gm-pill gm-beat" data-gm="beat-go" id="gm-bar-beatgo" title="The beat running (the Prep run order)"></button>' +
      '<button type="button" class="gm-bb gm-bb-ghost gm-band-next" data-gm="beat-next" title="Start the next beat in the run order">Next ▸</button></span>' +
      '<span class="gm-band-sep" aria-hidden="true"></span>' +
      '<span class="gm-band-tray" id="gm-bar-tray" data-band-slot="tray"></span>' +
      '<span class="gm-band-sep gm-band-sep-mic" aria-hidden="true"></span>' +
      '<span class="gm-band-mic"><button type="button" class="gm-pill" data-gm="ipadview" id="gm-bar-stt" title="The mic: listening (opens the iPad view)" hidden></button></span>' +
      '<span class="gm-band-music" data-band-slot="music"></span>' +
      '<span class="gm-band-sep" aria-hidden="true"></span>' +
      '<span class="gm-band-cue" id="gm-cuebar" data-band-slot="cue" role="group" aria-label="Cue stack"></span>' +
      '<span class="gm-band-quiet" data-band-slot="quiet"></span>' +
      '<div class="gm-signed" id="gm-signed" role="alert" hidden>' + esc(o.signed) + '</div>' +
      '<button type="button" class="gm-band-panic" data-band="panic" title="PANIC: the safe scene on the iPad, its sound down, and the work light (Esc, when nothing is open)">PANIC <kbd>Esc</kbd></button>' +
      '</div>';
  }
  /* the tray's stand-in, until gm/ipad-tray.js is on the page: today's iPad pill, Clear (0), Blank (true black) and the autopilot pill */
  function trayFallback() {
    return '<button type="button" class="gm-pill gm-band-live" data-gm="ipadview" id="gm-bar-ipad" title="What the players see (opens the iPad view)"></button>' +
      '<button type="button" class="gm-bb" data-gm="blankipad" title="Everything off the iPad: back to the ambient scene (0)">Clear <kbd>0</kbd></button>' +
      '<button type="button" class="gm-bb gm-bb-ghost" data-gm="darkipad" title="True black on the iPad until you show something">Blank</button>' +
      '<button type="button" class="gm-pill gm-ap" data-gm="aptoggle" id="gm-bar-ap" data-ap="auto" hidden></button>';
  }

  /* ---------- the band (DOM) ---------- */
  function create(host) {
    host = host || {};
    var el = null, alive = true, timer = null, sig = {}, tray = null, escOffs = [], docOff = null, clickOff = null, KV = null, drawnKit = false;
    function call(name) {
      var f = host[name]; if (typeof f !== 'function') return undefined;
      try { return f.apply(host, [].slice.call(arguments, 1)); } catch (e) { return undefined; }
    }
    function q(sel) { return el && typeof el.querySelector === 'function' ? el.querySelector(sel) : null; }
    function setText(n, t) { if (n && n.textContent !== t) n.textContent = t; }
    function setAttr(n, k, v) { if (n && n.getAttribute(k) !== v) n.setAttribute(k, v); }
    function show(n, on) { if (!n) return; n.hidden = !on; if (on) n.removeAttribute('hidden'); else n.setAttribute('hidden', ''); }
    function cueCtl() { var c = call('cue'); return c && typeof c.view === 'function' ? c : null; }
    function quiet() { var Q = W && W.B68GmQuiet; return Q && typeof Q.mount === 'function' ? Q : null; }
    /* M1: the music's pill (gm/music.js draws it and its popover, and registers the popover with B68GmEsc itself) */
    function music() { var m = call('music'); return m && typeof m.mountPill === 'function' ? m : null; }
    function nightNow() { var N = call('night'); try { return N && typeof N.night === 'function' ? N.night() : null; } catch (e) { return null; } }
    function prepFacts() {
      var NM = mod('B68GmNight', './night.js'), note = call('prep');
      try { return NM && note ? NM.parsePrep(note) : null; } catch (e) { return null; }
    }
    function curfewMs(night, at, now) {
      var C = mod('B68GmCurfew', './curfew.js'); if (!C || !at) return null;
      var n = Object.assign({}, isObj(night) ? night : {}, { curfewAt: at });
      try { return C.curfewMs(n, now); } catch (e) { return null; }
    }

    function goPlace(id) {
      var P = placeList(), all = P.list.concat([P.between]), p = all.filter(function (x) { return x.id === id; })[0];
      if (!p) return;
      call('goPlace', id, {});
      update();
    }
    function onClick(ev) {
      if (!alive) return;
      var t = ev && ev.target, b = t && t.closest ? t.closest('[data-band-place]') : null;
      if (b) { goPlace(b.getAttribute('data-band-place')); return; }
      b = t && t.closest ? t.closest('[data-band]') : null; if (!b) return;
      var w = b.getAttribute('data-band'), cf = call('curfew');
      if (w === 'panic') call('panic');
      else if (w === 'call') call('callAftermath');
      else if (w === 'keep') { if (cf && typeof cf.keep === 'function') cf.keep(); }
      else if (w === 'snooze') { if (cf && typeof cf.snooze === 'function') cf.snooze(); }
      update();
    }
    /* a press anywhere outside an open popover (the cue's ⋯, the quiet list) takes it down */
    function onDocDown(ev) {
      if (!alive || !el) return;
      var t = ev && ev.target, c = cueCtl(), Q = quiet(), cs = q('[data-band-slot="cue"]'), qs = q('[data-band-slot="quiet"]');
      if (c && typeof c.moreOpen === 'function' && c.moreOpen() && !(cs && t && cs.contains(t))) c.closeMore();
      if (Q && typeof Q.isOpen === 'function' && Q.isOpen() && !(qs && t && qs.contains(t))) Q.close();
    }
    function escWire() {
      var E = W && W.B68GmEsc; if (!E || typeof E.register !== 'function') return;
      escOffs.forEach(function (f) { try { f(); } catch (e) {} }); escOffs = [];
      escOffs.push(E.register('band.cue-more', { priority: 70,
        isOpen: function () { var c = cueCtl(); return !!(alive && c && typeof c.moreOpen === 'function' && c.moreOpen()); },
        close: function () { var c = cueCtl(); if (c && typeof c.closeMore === 'function') c.closeMore(); } }));
      escOffs.push(E.register('band.quiet', { priority: 70,
        isOpen: function () { var Q = quiet(); return !!(alive && Q && typeof Q.isOpen === 'function' && Q.isOpen()); },
        close: function () { var Q = quiet(); if (Q && typeof Q.close === 'function') Q.close(); } }));
    }

    function mount(headerEl) {
      if (!headerEl || !alive) return null;
      el = headerEl; sig = {};
      if (KV) { try { KV.destroy(); } catch (e) {} KV = null; }
      var KB = kit(); drawnKit = !!KB; el.innerHTML = (KB ? KB.skeleton : skeleton)({ menu: call('menuHtml'), signed: call('signedOut') });      /* KS05: the new desk's band */
      var slot = q('[data-band-slot="tray"]'), T = W && W.B68GmIpadTray;
      if (tray && typeof tray.destroy === 'function') { try { tray.destroy(); } catch (e) {} }
      tray = null;
      if (slot) {
        if (T && typeof T.create === 'function') { try { tray = T.create(host); tray.mount(slot); } catch (e) { tray = null; slot.innerHTML = trayFallback(); } }
        else slot.innerHTML = trayFallback();
      }
      var Q = quiet(), qs = q('[data-band-slot="quiet"]'); if (Q && qs) { try { Q.mount(qs); } catch (e) {} }
      var mu = music(), ms = q('[data-band-slot="music"]'); if (mu && ms) { try { mu.mountPill(ms); } catch (e) {} }
      if (clickOff) { try { clickOff(); } catch (e) {} clickOff = null; }
      if (typeof el.addEventListener === 'function') { var hd = el; hd.addEventListener('click', onClick); clickOff = function () { if (typeof hd.removeEventListener === 'function') hd.removeEventListener('click', onClick); }; }
      var doc = W && W.document;
      if (!docOff && doc && typeof doc.addEventListener === 'function') {
        doc.addEventListener('pointerdown', onDocDown, true);
        docOff = function () { if (typeof doc.removeEventListener === 'function') doc.removeEventListener('pointerdown', onDocDown, true); };
      }
      escWire();
      if (KB) { try { KV = KB.wire(el, host); } catch (e) { KV = null; } }      /* KS05: the Blade button */
      if (LIVE.indexOf(api) < 0) LIVE.push(api);
      if (!timer && W && typeof W.setInterval === 'function') timer = W.setInterval(function () { if (alive && !(W.document && W.document.hidden)) update(); }, TICK_MS);
      update();
      return el;
    }

    /* a row of places wider than the screen (a phone, a tablet) scrolls so the place on screen (else the night's phase) sits in view: at 390 px the row
       would otherwise show Before, Opening and Personal while the night is in the Score. Sideways only, never the page */
    function reveal(nav) {
      var c = nav.querySelector('[aria-current="true"]') || nav.querySelector('[data-state="now"]');
      if (!c || typeof c.getBoundingClientRect !== 'function' || typeof nav.getBoundingClientRect !== 'function' || !(nav.scrollWidth > nav.clientWidth)) return;
      var nr = nav.getBoundingClientRect(), cr = c.getBoundingClientRect();
      nav.scrollLeft = Math.max(0, nav.scrollLeft + (cr.left - nr.left) - (nr.width - cr.width) / 2);
    }

    function update() {
      if (!alive || !el) return;
      var now = num(call('now')) || Date.now(), night = nightNow(), pp = prepFacts();
      var current = str(call('currentPlace')) || (night && night.phase) || 'before';
      /* row 1: the places */
      var start = (night && night.startAt) || (pp && pp.start) || null, NM = mod('B68GmNight', './night.js'), sms = start && NM ? NM.clockMs(start, now) : null;
      var begun = !!(night && night.phase) || (sms !== null && sms <= now);      /* a night past midnight began yesterday: its phase says so */
      var cs = chips({ places: placeList(), night: night, budgets: pp && pp.budgets, start: start, started: begun, now: now, current: current });
      var s1 = JSON.stringify(cs), nav = q('[data-band-places]');
      if (nav && s1 !== sig.places) { sig.places = s1; if (drawnKit && kit()) kit().places(nav, cs); else nav.innerHTML = cs.map(chipHtml).join(''); reveal(nav); }
      /* row 2: the clock, the curfew, and what turns the row red */
      setText(q('[data-band-clock]'), clockText(now));
      var at = (night && night.curfewAt) || (pp && pp.curfew) || '', cms = at ? curfewMs(night, at, now) : null, ct = curfewText(at, cms, now);
      var CF = call('curfew'), cv = null; try { cv = CF && typeof CF.view === 'function' ? CF.view() : null; } catch (e) { cv = null; }
      var due = !!(cv && cv.state === 'due');
      var cl = q('[data-band-curfew]'); setText(cl, due ? ct.replace(/^curfew \d\d:\d\d · /, '') : ct); if (cl) setAttr(cl, 'title', ct ? 'The curfew is at ' + at + ': at it, this row offers Call the Aftermath' : '');
      show(q('[data-band-due]'), due);
      show(q('[data-band="snooze"]'), due && !(cv && cv.used));
      var c = cueCtl(), v = null; try { v = c ? c.view() : null; } catch (e) { v = null; }
      var panic = !!(v && v.panic);
      setAttr(q('.gm-band-r2'), 'data-alarm', panic ? 'panic' : due ? 'curfew' : '');
      setAttr(q('[data-band="panic"]'), 'aria-pressed', panic ? 'true' : 'false');
      if (tray && typeof tray.update === 'function') { try { tray.update(); } catch (e) {} }
      var mu = music(); if (mu && typeof mu.tick === 'function') { try { mu.tick(); } catch (e) {} }      /* PANIC, Resume and a phase move reach the music at once */
      if (KV) { try { KV.update(); } catch (e) {} }
      place();
    }
    /* where the band ends: the drawer and the sheets open under it, and the phone's chips stick under it */
    function place() {
      var R = call('root');
      if (!R || !R.style || typeof R.style.setProperty !== 'function' || !el || typeof el.getBoundingClientRect !== 'function') return;
      try {
        var r = el.getBoundingClientRect(); if (!(r.height > 0)) return;
        var b = Math.round(Math.max(0, r.bottom)), h = Math.round(r.height);
        if (b !== sig.bottom) { sig.bottom = b; R.style.setProperty('--dw-top', b + 'px'); }
        if (h !== sig.height) { sig.height = h; R.style.setProperty('--gm-bar-h', h + 'px'); }
      } catch (e) { /* no layout here */ }
    }

    function destroy() {
      alive = false;
      if (timer !== null && W && typeof W.clearInterval === 'function') W.clearInterval(timer);
      timer = null;
      escOffs.forEach(function (f) { try { f(); } catch (e) {} }); escOffs = [];
      if (docOff) { try { docOff(); } catch (e) {} docOff = null; }
      if (clickOff) { try { clickOff(); } catch (e) {} clickOff = null; }
      if (tray && typeof tray.destroy === 'function') { try { tray.destroy(); } catch (e) {} }
      tray = null;
      var mu = music(); if (mu && typeof mu.unmountPill === 'function') { try { mu.unmountPill(); } catch (e) {} }
      if (KV) { try { KV.destroy(); } catch (e) {} KV = null; }
      if (LIVE.indexOf(api) >= 0) LIVE.splice(LIVE.indexOf(api), 1);
    }
    /* KS05: the setting turned (or the kit's bundle arrived): draw the other band, and the page paints its parts into it again */
    function follow() { if (alive && el && !!kit() !== drawnKit) { mount(el); call('redraw'); } }

    var api = {
      mount: mount, update: update, destroy: destroy, place: place, follow: follow,
      el: function () { return el; },
      cueSlot: function () { return alive ? q('[data-band-slot="cue"]') : null; },
      traySlot: function () { return alive ? q('[data-band-slot="tray"]') : null; },
      quietSlot: function () { return alive ? q('[data-band-slot="quiet"]') : null; },
      menuEl: function () { return q('.gm-menu-list'); },
      places: placeList,
      step: function (current, d) { return step(placeList(), current, d); }
    };
    return api;
  }

  return { PLACES: PLACES, BETWEEN: BETWEEN, TICK_MS: TICK_MS, placeList: placeList, step: step, chips: chips, chipHtml: chipHtml, clockText: clockText, curfewText: curfewText,
    skeleton: skeleton, trayFallback: trayFallback, create: create, live: function () { return LIVE.slice(); } };
});
