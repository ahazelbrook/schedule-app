/* gm/workshop-first.js — the Workshop drawer, first cuts (suite ticket 1.9, switch spine.workshop).

   Five things the GM page carries on its main screen move behind Menu -> Workshop (gm/workshop.js). While the switch is on they are registered as Workshop
   tools (gm/tools.js, workshop: true) and the page puts the originals away with CSS (gm.css, `body.ws-away`). Off, nothing is registered and no class is
   set: the page is as it was. Everything else waits for the census.

     phone cards     the Run menu's "Phone cards" line          a real toggle in the Workshop (the page's own switch, features.js phoneCards)
     screen mirror   the bar's and the iPad tab's mirror button  a real toggle in the Workshop (the page's own toggle)
     costume engine  the Run strip's Disguise select             a button that shows it again where it was
     uncued co-GM    the "Also listen for uncued decisions" box  a box in the Workshop that drives the real one
     Screen props    Draw them, Prop, Wire, Case board and the gatekeeper's verdicts (the iPad tab's Screen section)  a button that shows it again

   Window.B68GmWorkshopFirst, and module.exports under Node (items, count).

   create(host) -> { sync(), destroy(), tools() }
     host: { root(), on() -> bool (the switch), phoneCards(), setPhoneCards(on), mirrorOn(), toggleMirror(), toast(msg, bad) }
   items() -> [{ id, label, what, kind: 'toggle' | 'reveal' | 'proxy' }]       count(tabs) -> { before, after } the main page's tool count */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmWorkshopFirst = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var ITEMS = [
    { id: 'ws-phonecards', label: 'Phone mission cards', kind: 'toggle', what: 'Phones show a mission card and a Move row while a night runs. Off: character sheets only.' },
    { id: 'ws-costume', label: 'Costume engine', kind: 'reveal', cls: 'ws-show-costume', what: 'The Disguise select in the Run strip.' },
    { id: 'ws-mirror', label: 'Screen mirror', kind: 'toggle', what: 'While on, a map or a handout on the iPad also shows on the players’ phones.' },
    { id: 'ws-cogm', label: 'Uncued co-GM', kind: 'proxy', what: 'Let Blade also read uncued talk, as offers only. Needs Co-GM on (the iPad tab).' },
    { id: 'ws-screen', label: 'Screen props', kind: 'reveal', cls: 'ws-show-screen', what: 'Draw them, Prop, Wire and Case board, with the gatekeeper’s check (the iPad tab’s Screen section).' }
  ];
  function items() { return ITEMS.map(function (i) { return { id: i.id, label: i.label, what: i.what, kind: i.kind }; }); }
  /* the main page's tool count: the tabs registered (tools.js, not behind the Workshop) plus the loose controls on the page that move */
  function count(tabs) { var t = typeof tabs === 'number' ? tabs : 0; return { before: t + ITEMS.length, after: t, moved: ITEMS.length }; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function create(host) {
    var registered = false;
    function T() { return W && W.B68GmTools; }
    function r() { var x = host.root && host.root(), b = x && x.ownerDocument && x.ownerDocument.body; return b && b.classList ? b : null; }   /* the classes sit on the body: the Blade panel is beside the page, not in it */
    function gr() { var x = host.root && host.root(); return x && x.querySelector ? x : null; }
    function on() { return typeof host.on === 'function' && host.on() === true; }
    function say(m, bad) { if (typeof host.toast === 'function') host.toast(m, bad); }

    function mountFor(it) {
      return function (box) {
        var doc = box.ownerDocument;
        function draw() {
          var rt = r(), line = '', btn = '';
          if (it.id === 'ws-phonecards') { var p = typeof host.phoneCards === 'function' && host.phoneCards(); btn = 'Phone cards: ' + (p ? 'on (turn off)' : 'off (turn on)'); }
          else if (it.id === 'ws-mirror') { var m = typeof host.mirrorOn === 'function' && host.mirrorOn(); btn = 'Phones mirror the iPad: ' + (m ? 'on (turn off)' : 'off (turn on)'); }
          else if (it.kind === 'reveal') { var shown = !!(rt && rt.classList.contains(it.cls)); btn = shown ? 'Put it away again' : 'Show it on the page'; }
          else if (it.id === 'ws-cogm') {
            var o = rt && rt.ownerDocument ? rt.ownerDocument.getElementById('as-cogm-also') : null;
            line = o ? '' : '<p class="gm-dim">Turn Co-GM on first (the iPad tab).</p>';
            btn = o ? (o.checked ? 'Also listening for uncued decisions (turn off)' : 'Also listen for uncued decisions (turn on)') : '';
          }
          box.innerHTML = '<div class="gm-ws-item"><p class="gm-dim">' + esc(it.what) + '</p>' + line + (btn ? '<button type="button" class="btn" data-wsf="go">' + esc(btn) + '</button>' : '') + '</div>';
        }
        draw();
        box.addEventListener('click', function (ev) {
          var b = ev.target && ev.target.closest ? ev.target.closest('[data-wsf="go"]') : null; if (!b) return;
          var rt = r();
          if (it.id === 'ws-phonecards') { if (typeof host.setPhoneCards === 'function') host.setPhoneCards(!host.phoneCards()); }
          else if (it.id === 'ws-mirror') { if (typeof host.toggleMirror === 'function') host.toggleMirror(); }
          else if (it.kind === 'reveal') { if (rt) rt.classList.toggle(it.cls); }
          else if (it.id === 'ws-cogm') {
            var o = rt && rt.ownerDocument ? rt.ownerDocument.getElementById('as-cogm-also') : null;
            if (o) { o.checked = !o.checked; o.dispatchEvent(new (W.Event || doc.defaultView.Event)('change', { bubbles: true })); }
            else say('Turn Co-GM on first.', true);
          }
          draw();
        });
        void doc;
      };
    }

    function menuSync(want) {
      var rt = gr(); if (!rt || !rt.querySelector) return;
      var list = rt.querySelector('.gm-menu-list'), cur = rt.querySelector('#gm-menu-workshop'), WS = W && W.B68GmWorkshop;
      if (!list) return;
      if (want && !cur && WS) {
        var tmp = rt.ownerDocument.createElement('div'); tmp.innerHTML = WS.menuLine();
        var b = tmp.firstChild, sb = rt.querySelector('#gm-menu-switchboard');
        if (b) { if (sb && sb.parentNode === list) list.insertBefore(b, sb.nextSibling); else list.appendChild(b); }
      } else if (!want && cur && cur.parentNode) {
        cur.parentNode.removeChild(cur);
        if (WS && typeof WS.close === 'function') WS.close();
      }
    }

    function sync() {
      var t = T(), rt = r(), want = on();
      if (!t) return;
      if (want && !registered) {
        ITEMS.forEach(function (it) { t.register({ id: it.id, label: it.label, phases: 'all', workshop: true, mount: mountFor(it) }); });
        registered = true;
        if (rt) rt.classList.add('ws-away');
      } else if (!want && registered) {
        ITEMS.forEach(function (it) { t.unregister(it.id); });
        registered = false;
        if (rt) { rt.classList.remove('ws-away'); ITEMS.forEach(function (it) { if (it.cls) rt.classList.remove(it.cls); }); }
      } else if (want && rt && !rt.classList.contains('ws-away')) rt.classList.add('ws-away');      /* the page was redrawn */
      menuSync(want);
    }
    function destroy() {
      var t = T(), rt = r();
      if (t && registered) ITEMS.forEach(function (it) { t.unregister(it.id); });
      registered = false;
      if (rt) { rt.classList.remove('ws-away'); ITEMS.forEach(function (it) { if (it.cls) rt.classList.remove(it.cls); }); }
      menuSync(false);
    }
    return { sync: sync, destroy: destroy, tools: function () { return registered ? items() : []; } };
  }

  return { ITEMS: ITEMS, items: items, count: count, create: create };
});
