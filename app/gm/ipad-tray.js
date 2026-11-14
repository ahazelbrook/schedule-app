/* gm/ipad-tray.js — THE iPAD TRAY (the GM night rebuild, the design's iPad part: one way on, one way off).

   Window.B68GmIpadTray in the browser, module.exports under Node (checks/runtime/gm-ipad-tray.test.mjs). GM page only.

   The tray sits in the band's second row (the band mounts it with create(host).mount(slot); before the band, the GM page's bar does). It holds:
     WHAT IS LIVE   one line built from everything the GM page has sent: the stage (the ambient or pinned scene, a map, an NPC, a handout, the cards,
                    a rules entry, a read-aloud, lights out), the overlay up now (a clock, an NPC card, a held face, a line, the dawn, a show beat:
                    the report card, Spotted, a ring, a title, the board, the cast photo, the lair...), the lasting layers that matter (the
                    flashback filter, the montage, the hard start, the Aftermath show) and the map's LIVE / FROZEN / BLANK from W.B68GmStage (when
                    that API is there). A green dot while anything but the ambient is up. The line ends in an ellipsis when it is long; its title
                    and its label hold the whole list, and a tap opens the iPad view, which lists it in full.
     Send (n)       only while rooms are staged: W.B68GmStage.send()
     Clear (0)      everything down to the ambient scene, through the page's own take-downs (provide().clear()): the stage, the overlay, a held face,
                    the report card, the flashback, the montage, the hard start. Never the band's lasting layers (the phase, the PC faces, security).
     Blank          true black until the next send (lights out)
     the Blade autopilot pill, moved here from the bar: the same modes and the same action (provide().ap)

   API
     liveItems(snap) -> [{ key, text, up }]    pure. snap: { shown: { kind, title } | null, doc: the ambient document | null, stage: B68GmStage.state()
                                               | null, now: ms, names: { npc(id), clock(id) } }. up: true when it is more than the ambient playing.
     liveLine(items) -> { text, full, on }     text joins the items with " · "; full is the same for the title; on: anything is up
     provide(api) -> unprovide()               the GM page's iPad: { snapshot() -> snap, clear() -> Promise, blank() -> Promise, openView(),
                                               ap: { view() -> { badge, title, mode, action } | null, toggle() } }
     create(host) -> tray { mount(el), update(), destroy() }   host.openView(id) opens the iPad view (else provide().openView())
     refresh()                                 every mounted tray reads again (the GM page calls it when what it knows changes)
     settingsInView                            true: the iPad view holds the night's settings, so the band's Menu has no Settings line */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmIpadTray = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function cut(s, n) { s = str(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  /* the ambient scenes by id (the GM page's P.IPAD_SCENES carries the labels; this is the fallback when the page passes none) */
  var SCENE = {};
  /* a show beat's words in the live line: the kind, and the one field that tells the GM which */
  var BEAT = {
    stamp: function (p) { return 'Stamp' + (p.word ? ': ' + cut(p.word, 18) : ''); },
    spotted: function () { return 'Spotted'; },
    keyturn: function (p) { return 'Key turn' + (p.label ? ': ' + cut(p.label, 18) : ''); },
    title: function (p) { return 'Title: ' + cut(p.text, 28); },
    wanted: function () { return 'Wanted'; },
    ring: function () { return 'Ringing'; },
    rolodex: function () { return 'Rolodex'; },
    spotlight: function () { return 'Spotlight'; },
    report: function (p) { return 'Action report' + (p.position ? ': ' + p.position + (p.effect ? ', ' + p.effect : '') : ''); },
    aftermath: function (p) { return 'Aftermath' + (p.step ? ': ' + p.step : ''); },
    credits: function () { return 'End credits'; },
    board: function () { return 'Opportunity board'; },
    castphoto: function () { return 'Cast photo'; },
    lair: function (p) { return 'The lair' + (p.name ? ': ' + cut(p.name, 24) : ''); },
    scoretitle: function (p) { return 'Score title' + (p.text ? ': ' + cut(p.text, 24) : ''); }
  };
  function overlayUp(o, now) {
    if (!isObj(o) || !o.kind) return false;
    var at = Date.parse(str(o.at)), ms = Number(o.ms) || 0;
    return !(isFinite(at) && ms > 0 && typeof now === 'number' && at + ms < now - 2000);      /* gone by itself once its time is up (2 s grace for skew) */
  }
  function overlayText(o, names) {
    var n = isObj(names) ? names : {};
    if (o.kind === 'clock') { var c = typeof n.clock === 'function' ? n.clock(o.clockId) : ''; return 'Clock' + (c ? ': ' + cut(c, 24) : ''); }
    if (o.kind === 'npc') {
      var who = typeof n.npc === 'function' ? n.npc(o.npcId) : '';
      return (who ? cut(who, 24) : 'An NPC') + (/^b17sl-/.test(str(o.id)) ? ' (held)' : ' (card)');
    }
    if (o.kind === 'fx') return 'Dawn';
    if (Object.prototype.hasOwnProperty.call(BEAT, o.kind)) return BEAT[o.kind](isObj(o.payload) ? o.payload : {});
    if (typeof o.text === 'string' && o.text.trim()) return 'Line: ' + cut(o.text, 28);
    return cut(o.kind, 20);
  }
  function stageText(shown, doc, stage, names) {
    var k = isObj(shown) ? str(shown.kind) : '', t = isObj(shown) ? cut(shown.title, 32) : '';
    if (k === 'dark') return { text: 'Blank (lights out)', up: true };
    if (k === 'svg') {
      var live = isObj(stage) && stage.live ? cut(stage.live, 32) : '';
      return { text: (live || t || 'A map') + ' (map)' + (isObj(stage) && stage.frozen ? ' · FROZEN' : ''), up: true };
    }
    if (k === 'npc') return { text: (t || 'An NPC') + ' (NPC)', up: true };
    if (k === 'text') return { text: (t ? t : 'Text') + ' (read-aloud)', up: true };
    if (k === 'rule') return { text: (t || 'A rule') + ' (rules)', up: true };
    if (k === 'handout') return { text: (t || 'A handout') + ' (handout)', up: true };
    if (k === 'cards') return { text: 'The cards', up: true };
    /* blank, or nothing known: the ambient underneath */
    var d = isObj(doc) ? doc : {}, mode = d.mode === 'pin' || d.mode === 'off' ? d.mode : 'auto';
    var label = typeof names === 'object' && names && typeof names.scene === 'function' ? names.scene(d.scene) : SCENE[d.scene] || '';
    if (!k && !isObj(doc)) return { text: 'Not known yet', up: false };
    if (mode === 'off') return { text: 'Ambient off', up: false };
    if (mode === 'pin' && label) return { text: label + ' (pinned)', up: false };
    return { text: 'Ambient scenes', up: false };
  }
  /* pure: what is on the iPad, the stage first, then the overlay, then the lasting layers that change the picture */
  function liveItems(snap) {
    var s = isObj(snap) ? snap : {}, doc = isObj(s.doc) ? s.doc : null, out = [];
    var st = s.intro ? { text: 'Introducing ' + cut(s.intro, 32), up: true } : stageText(s.shown, doc, s.stage, s.names);      /* IP3: snap.intro, the name while the title card plays */
    out.push({ key: 'stage', text: st.text, up: st.up });
    if (isObj(s.stage) && s.stage.blank && !(isObj(s.shown) && s.shown.kind === 'dark')) out.push({ key: 'stage-blank', text: 'Map blanked', up: true });
    if (doc && overlayUp(doc.overlay, s.now)) out.push({ key: 'overlay', text: overlayText(doc.overlay, s.names), up: true });
    var L = doc && isObj(doc.layers) ? doc.layers : {}, sc = isObj(L.scene) ? L.scene : {}, da = isObj(L.data) ? L.data : {};
    if (sc.filter === 'flashback') out.push({ key: 'flashback', text: 'Flashback', up: true });
    if (sc.layout === 'montage' || (isObj(da.montage) && Array.isArray(da.montage.panels))) out.push({ key: 'montage', text: 'Montage', up: true });
    if (sc.mode === 'start') out.push({ key: 'hardstart', text: 'Hard start', up: true });
    if (sc.mode === 'aftermath') out.push({ key: 'aftermath-show', text: 'Aftermath show', up: true });
    return out;
  }
  function liveLine(items) {
    var list = Array.isArray(items) ? items : [], on = list.some(function (x) { return x && x.up; });
    var text = list.map(function (x) { return x.text; }).join(' · ');
    return { text: text, full: text, on: on };
  }

  /* ---- the page's iPad, and the trays mounted on it ---- */
  var api = null, trays = [];
  function provide(a) { api = isObj(a) ? a : null; refresh(); return function () { if (api === a) api = null; }; }
  function refresh() { trays.slice().forEach(function (t) { try { t.update(); } catch (e) { /* one tray failing never stops the rest */ } }); }
  function stageApi() { return W && W.B68GmStage && typeof W.B68GmStage.state === 'function' ? W.B68GmStage : null; }

  function create(host) {
    var h = isObj(host) ? host : {}, box = null, off = null, unsub = null, drawn = '', timer = null, timerWin = null;
    function snapshot() { var s = api && typeof api.snapshot === 'function' ? api.snapshot() : null; return isObj(s) ? s : {}; }
    function stageState() { var S = stageApi(); if (!S) return null; try { var v = S.state(); return isObj(v) ? v : null; } catch (e) { return null; } }
    function openView() {
      if (typeof h.openView === 'function') return h.openView('ipad');
      if (api && typeof api.openView === 'function') return api.openView();
      return null;
    }
    var part = {};       /* the tray's own nodes, made once at mount */
    function show(node, on) { node.hidden = !on; if (on) node.removeAttribute('hidden'); else node.setAttribute('hidden', ''); }
    function paint() {
      if (!box) return;
      var snap = snapshot(); snap.stage = stageState();
      var items = liveItems(snap), line = liveLine(items), st = snap.stage, staged = isObj(st) ? Math.max(0, Math.floor(Number(st.staged) || 0)) : 0;
      var ap = api && isObj(api.ap) && typeof api.ap.view === 'function' ? api.ap.view() : null;
      var key = JSON.stringify([line.text, line.on, staged, ap ? [ap.badge, ap.title, ap.mode] : 0]);
      if (key === drawn) return;
      drawn = key;
      part.text.textContent = line.text;
      part.dot.className = 'gm-dot' + (line.on ? ' on' : '');
      part.live.setAttribute('title', 'On the iPad: ' + line.full + '. Opens the iPad view.');
      part.live.setAttribute('aria-label', 'On the iPad: ' + line.full + '. Open the iPad view');
      show(part.send, staged > 0);
      part.count.textContent = String(staged);
      part.send.setAttribute('title', 'Send the ' + staged + ' staged room' + (staged === 1 ? '' : 's') + ' to the iPad');
      show(part.ap, !!ap);
      if (ap) { part.ap.textContent = ap.badge; part.ap.setAttribute('title', ap.title || ''); part.ap.setAttribute('aria-label', 'Autopilot: ' + (ap.title || ap.badge)); part.ap.setAttribute('data-ap', ap.mode || ''); }
    }
    function act(what) {
      if (what === 'open') return openView();
      if (what === 'send') { var S = stageApi(); return S && typeof S.send === 'function' ? S.send() : null; }
      if (what === 'clear') return api && typeof api.clear === 'function' ? api.clear() : null;
      if (what === 'blank') return api && typeof api.blank === 'function' ? api.blank() : null;
      if (what === 'ap') return api && isObj(api.ap) && typeof api.ap.toggle === 'function' ? api.ap.toggle() : null;
      return null;
    }
    function onClick(ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('[data-tray]') : null;
      if (!b || !box || !box.contains(b)) return;
      ev.preventDefault();
      act(b.getAttribute('data-tray'));
    }
    var tray = {
      mount: function (el) {
        if (!el) return tray;
        tray.destroy();
        var doc = el.ownerDocument || h.document || (W && W.document);       /* host.document: a page whose elements do not carry their document */
        if (!doc) return tray;
        var mk = function (parent, tag, cls, text, attrs) {
          var e = doc.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text;
          Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); }); parent.appendChild(e); return e;
        };
        box = doc.createElement('div');
        box.className = 'gm-tray'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'The iPad');
        var KB = W && W.B68KitBand; if (!(KB && typeof KB.tray === 'function' && KB.tray(el, doc, box, part))) {      /* KS05: the new desk's band builds the same parts */
        mk(box, 'span', 'gm-tray-lbl', 'iPad', { 'aria-hidden': 'true' });
        part.live = mk(box, 'button', 'gm-tray-live', '', { type: 'button', 'data-tray': 'open' });
        part.dot = mk(part.live, 'span', 'gm-dot'); part.text = mk(part.live, 'span', 'gm-tray-text');
        part.send = mk(box, 'button', 'gm-bb gm-tray-send', 'Send ', { type: 'button', 'data-tray': 'send' }); part.count = mk(part.send, 'b', '', '0');
        part.clear = mk(box, 'button', 'gm-bb gm-tray-clear', 'Clear ', { type: 'button', 'data-tray': 'clear',
          title: 'Everything down to the ambient scene: what is shown, an overlay, a held face, the report card, the flashback, the montage, the hard start. The phase, the PC faces and security stay' });
        mk(part.clear, 'kbd', '', '0');
        part.blank = mk(box, 'button', 'gm-bb gm-tray-blank', 'Blank', { type: 'button', 'data-tray': 'blank', title: 'True black on the iPad until the next send' });
        part.ap = mk(box, 'button', 'gm-pill gm-ap gm-tray-ap', '', { type: 'button', 'data-tray': 'ap' });
        }
        show(part.send, false); show(part.ap, false);
        el.appendChild(box);
        var me = box; off = function () { if (typeof me.removeEventListener === 'function') me.removeEventListener('click', onClick); };
        box.addEventListener('click', onClick);
        var S = stageApi();
        if (S && typeof S.onChange === 'function') { try { var u = S.onChange(function () { paint(); }); unsub = typeof u === 'function' ? u : null; } catch (e) { unsub = null; } }
        trays.push(tray);
        /* a beat leaves the iPad by itself when its time is up: read again now and then, so the line lets it go too (nothing is fetched) */
        var win = doc.defaultView;
        if (win && typeof win.setInterval === 'function') { timer = win.setInterval(paint, 5000); timerWin = win; }
        drawn = ''; paint();
        return tray;
      },
      update: function () { paint(); return tray; },
      destroy: function () {
        var i = trays.indexOf(tray); if (i >= 0) trays.splice(i, 1);
        if (timer !== null && timerWin) timerWin.clearInterval(timer);
        timer = null; timerWin = null;
        if (off) { off(); off = null; }
        if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
        if (box && box.parentNode) box.parentNode.removeChild(box);
        box = null; drawn = ''; part = {};
      },
      el: function () { return box; }
    };
    return tray;
  }

  return { create: create, provide: provide, refresh: refresh, liveItems: liveItems, liveLine: liveLine, overlayText: overlayText, settingsInView: true, BEAT_KINDS: Object.keys(BEAT) };
});
