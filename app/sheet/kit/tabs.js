/* sheet/kit/tabs.js: the four-screen sheet (kit.phone), KS17 of the kit and stage build. In the kit-phone bundle: fetched only while the setting is on
   (the kit flag asks for it when a live sheet paints the phone token), so with the setting off a phone loads, draws and stores what it did.

   A phone's sheet is one long page. With the kit on, at 760 px and under (a phone; tracker.css's own break), it is four short screens behind a bottom
   bar: Now · Sheet · Crew · Notes. Nothing is rebuilt: the sheet draws exactly what it draws today (tracker.js), and this file only
   - marks each of the sheet's parts (its keyed slots, tracker.js ORDER) with the screen it is on (TABLE below: every part on exactly one screen),
     data-ks17="<screen>", and hides the parts of the other screens with data-ks17-off (tabs.css does the hiding, in the phone's media query only, so
     the wide layout and print are untouched). Every id, data-* hook and old class stays where it was: the old handlers find everything.
     The head is special: its sticky bar (Back, the status, "…", the vitals) is the top bar and stays on every screen; the name and About show on
     Now only (data-ks17-off="head"). A box on another screen that holds an open panel (the roll, downtime and end-of-session panels, a fixed
     bottom sheet on a phone) keeps the panel: data-ks17-off="panel" hides the box and leaves its panel up, so a roll started from Now opens over Now.
   - adds three pieces of kit markup (B68Ui.node: DOM nodes, no markup sink), which exist only while the kit is on: the bottom bar (the Bottom bar
     part); on Now, the top actions (the best-rated four, each a button with the Actions box's own data-act="rollopen" hook, so tracker.js's own
     handler opens the roll) and "All twelve ›" (the Sheet screen, at the Actions box); on Crew, a link to the crew sheet (#t, the table page every
     player already has in the top nav).
   - answers the vitals: a jump (data-act="jump") to a box on another screen moves to that screen first (a capture listener on the sheet's root, so
     tracker.js's own jump then scrolls to a box that is showing).

   Which screen opens (KS17.3): Now while a session is open at the table (started, not ended: api.table().inPlay), otherwise Sheet; after that, the last
   screen used on this phone. Kept per sheet in localStorage b68.sheetTab ({ <sheet id>: { t: screen, k: 'play:<n>' | 'idle' } }, the last 12), written
   only when a screen is picked. A remembered screen holds while the table is as it was when it was picked; a session that STARTS while the sheet is
   open moves it to Now (unless a field has the focus or a panel is open: then on a later draw); a session that ends moves nothing.

   Turning the setting off mid-session (B68Kit.onChange) takes every mark and every added node away: the sheet is the long page again at once. The
   bundle arriving after the sheet's first draw asks the sheet to draw again (B68Tracker.refresh), which calls apply().

   The one seam: tracker.js render() calls apply(root, ctx) after every draw, while B68Kit.ready('phone') and the sheet is live (not a print copy).
     ctx { slots: { name: { anchor, nodes } }, table: { session, inPlay } | null, id: the sheet's id, dots: { action: n }, actions: [[attr, [action…]]] }
   No request, no markup sink, no new key, no Escape listener. Window.B68SheetTabs, and module.exports under Node (checks/runtime/kit-phone.e2e.mjs
   reads TABLE against tracker.js's ORDER, and the pure parts). ES5. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68SheetTabs = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var SCREENS = ['now', 'sheet', 'crew', 'notes'];
  var LABELS = { now: 'Now', sheet: 'Sheet', crew: 'Crew', notes: 'Notes' };
  /* every part of the sheet (tracker.js ORDER) on exactly one screen */
  var TABLE = {
    head: 'now', vitals: 'now', now: 'now', bar: 'now', stress: 'now', keys: 'now', harm: 'now',
    figure: 'sheet', strictures: 'sheet', vice: 'sheet', abilities: 'sheet', contacts: 'sheet', triggers: 'sheet', mission: 'sheet', stacks: 'sheet', actions: 'sheet', items: 'sheet',
    cohort: 'crew', session: 'crew', downtime: 'crew', clocks: 'crew', between: 'crew',
    memories: 'notes', notes: 'notes', log: 'notes'
  };
  /* the order of the grid's boxes on each screen (data-ks17-n; tabs.css turns it into order). '@top' is the top actions. Sheet in play order */
  var PLACE = {
    now: ['stress', 'keys', 'harm', '@top'],
    sheet: ['actions', 'abilities', 'triggers', 'items', 'stacks', 'vice', 'strictures', 'contacts', 'mission', 'figure'],
    crew: ['cohort', 'clocks', 'session', 'downtime'],
    notes: ['memories', 'notes', 'log']
  };
  /* the vitals' boxes (tracker.js jump) and the part each one is */
  var JUMP = { 'ds-stressbox': 'stress', 'ds-harmbox': 'harm', 'ds-xpbox': 'triggers', 'ds-itembox': 'items' };
  var KEY = 'b68.sheetTab', KEEP = 12, TOP = 4;
  var WORDS = { 12: 'twelve' };

  var st = { root: null, id: null, tab: null, k: null, ctx: null };

  function U() { return W && W.B68Ui; }
  function store() { try { return W && W.localStorage ? W.localStorage : null; } catch (e) { return null; } }
  function readAll() { var ls = store(); if (!ls) return {}; try { var o = JSON.parse(ls.getItem(KEY) || 'null'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (e) { return {}; } }
  function remembered(id) { var e = readAll()[String(id || '')]; return e && SCREENS.indexOf(e.t) >= 0 && typeof e.k === 'string' ? e : null; }
  function remember(id, t, k) {
    var ls = store(); if (!ls) return;
    var all = readAll(), key = String(id || ''), o = {};
    delete all[key];
    Object.keys(all).slice(-(KEEP - 1)).forEach(function (x) { o[x] = all[x]; });
    o[key] = { t: t, k: k };
    try { ls.setItem(KEY, JSON.stringify(o)); } catch (e) { /* private window, quota: this visit only */ }
  }

  /* ---------- pure (Node) ---------- */
  /* the table now, as a key: a session in play, or not */
  function tableKey(t) { return t && t.inPlay ? 'play:' + (t.session || 0) : 'idle'; }
  function defaultTab(t) { return t && t.inPlay ? 'now' : 'sheet'; }
  /* the screen to show at opening: the remembered one while the table is as it was, else the default */
  function opening(mem, t) { return mem && mem.k === tableKey(t) && SCREENS.indexOf(mem.t) >= 0 ? mem.t : defaultTab(t); }
  /* the best-rated actions (book order between equals), rated 1 or more, at most n; total: how many actions there are */
  function topActions(dots, groups, n) {
    var all = [];
    (groups || []).forEach(function (g) { ((g && g[1]) || []).forEach(function (a) { all.push({ a: a, v: Math.max(0, Math.floor(+(dots && dots[a]) || 0)), i: all.length }); }); });
    var rated = all.filter(function (x) { return x.v > 0; }).sort(function (x, y) { return y.v - x.v || x.i - y.i; });
    return { list: rated.slice(0, n), total: all.length };
  }
  function screenOf(part) { return TABLE[part] || null; }
  function allLabel(total) { return 'All ' + (WORDS[total] || String(total)) + ' ›'; }

  /* ---------- the added nodes (kit markup, built as DOM) ---------- */
  function div(cls, scr) { var d = W.document.createElement('div'); d.className = cls; if (scr) d.setAttribute('data-ks17', scr); return d; }
  function barNode(tab) {
    return U().node('bottombar', { label: 'Sheet screens', value: tab, fixed: true, cls: 'ks17-bar',
      items: SCREENS.map(function (s) { return { label: LABELS[s], value: s, data: { ks17Tab: s } }; }) });
  }
  /* what the top actions show: the four, each one's dots and whether its panel is open (the Actions box's own button says) */
  function topSpec(ctx, r) {
    var t = topActions(ctx.dots, ctx.actions, TOP);
    t.list.forEach(function (x) {
      var own = null, bs = r.querySelectorAll('.ds-actbtn[data-a]');
      for (var i = 0; i < bs.length; i++) if (bs[i].getAttribute('data-a') === x.a) { own = bs[i]; break; }
      x.open = !!own && own.getAttribute('aria-expanded') === 'true';
    });
    return t;
  }
  function topNode(t) {
    var B = U(), sec = W.document.createElement('section');
    sec.className = 'ks17-top'; sec.setAttribute('data-ks17', 'now'); sec.setAttribute('aria-label', 'Your top actions');
    var h = W.document.createElement('h3'); h.className = 'ks17-lab'; h.textContent = 'Actions'; sec.appendChild(h);
    t.list.forEach(function (x) {
      var row = div('ks17-act');
      row.appendChild(B.node('button', { label: x.a, rank: 'quiet', cls: 'ks17-actbtn', title: x.a + ': ' + x.v + 'd, mark the roll',
        data: { act: 'rollopen', a: x.a, always: '1' }, attrs: { 'aria-expanded': String(x.open) } }));
      row.appendChild(B.node('meter', { value: x.v, max: Math.max(4, x.v), label: x.a }));
      sec.appendChild(row);
    });
    sec.appendChild(B.node('button', { label: allLabel(t.total), rank: 'quiet', cls: 'ks17-all', data: { ks17Go: 'actions' }, title: 'Every action, on the Sheet screen' }));
    return sec;
  }
  function crewNode() {
    var d = div('ks17-crew', 'crew');
    d.appendChild(U().node('link', { label: 'The crew sheet ›', href: '#t', rank: 'quiet', cls: 'ks17-crewlink' }));
    return d;
  }
  /* each in its place: the top actions in the grid, the crew link after the fold, the bar last. The top actions are redrawn only when they change */
  function place(ctx) {
    var r = st.root, grid = r.querySelector('.ds-grid');
    var bar = r.querySelector('.ks17-bar');
    if (!bar) { bar = barNode(st.tab); r.appendChild(bar); }
    else if (bar !== r.lastElementChild) r.appendChild(bar);
    if (grid) {
      var t = topSpec(ctx, r), sig = JSON.stringify(t), top = grid.querySelector('.ks17-top');
      if (!top || top.__ks17 !== sig) { var n = topNode(t); n.__ks17 = sig; if (top) grid.replaceChild(n, top); else grid.appendChild(n); }
      else if (top !== grid.lastElementChild) grid.appendChild(top);
    }
    if (!r.querySelector('.ks17-crew')) r.insertBefore(crewNode(), bar);
  }

  /* ---------- marking ---------- */
  function setA(n, k, v) { if (v == null) { if (n.hasAttribute(k)) n.removeAttribute(k); } else if (n.getAttribute(k) !== v) n.setAttribute(k, v); }
  function elems(sl) { return ((sl && sl.nodes) || []).filter(function (n) { return n && n.nodeType === 1 && n.parentNode; }); }
  function paint() {
    var r = st.root, ctx = st.ctx; if (!r || !ctx) return;
    setA(r, 'data-ks17-screen', st.tab);
    var slots = ctx.slots || {};
    Object.keys(slots).forEach(function (name) {
      var sc = screenOf(name); if (!sc || name === 'vitals') return;   /* the vitals live in the top bar, which stays */
      var at = PLACE[sc].indexOf(name);
      elems(slots[name]).forEach(function (n) {
        setA(n, 'data-ks17', sc);
        setA(n, 'data-ks17-n', at >= 0 ? String(at + 1) : null);
        setA(n, 'data-ks17-off', sc === st.tab ? null : name === 'head' ? 'head' : n.querySelector('.ds-roll') ? 'panel' : '1');
      });
    });
    var top = r.querySelector('.ks17-top'), crew = r.querySelector('.ks17-crew');
    if (top) { setA(top, 'data-ks17-n', String(PLACE.now.indexOf('@top') + 1)); setA(top, 'data-ks17-off', st.tab === 'now' ? null : '1'); }
    if (crew) setA(crew, 'data-ks17-off', st.tab === 'crew' ? null : '1');
    var bar = r.querySelector('.ks17-bar');
    if (bar) Array.prototype.forEach.call(bar.querySelectorAll('[role="tab"]'), function (b) {
      var on = b.getAttribute('data-ks17-tab') === st.tab;
      setA(b, 'aria-selected', on ? 'true' : 'false'); setA(b, 'tabindex', on ? '0' : '-1');
    });
  }

  function typing() {
    var a = W.document.activeElement;
    return !!(a && st.root && st.root.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT'));
  }
  function select(tab, user) {
    if (SCREENS.indexOf(tab) < 0 || !st.root || !st.ctx) return;
    var moved = tab !== st.tab;
    st.tab = tab;
    if (user) remember(st.id, tab, st.k);
    paint();
    if (moved && user) { try { W.scrollTo(0, 0); } catch (e) { /* no window to scroll */ } }
  }
  function onClick(e) {
    if (!st.ctx) return;
    var t = e.target && e.target.closest ? e.target.closest('[data-ks17-tab], [data-ks17-go], [data-act="jump"]') : null;
    if (!t || !st.root || !st.root.contains(t)) return;
    if (t.hasAttribute('data-ks17-tab')) { select(t.getAttribute('data-ks17-tab'), true); return; }
    if (t.hasAttribute('data-ks17-go')) {
      select('sheet', true);
      var box = st.root.querySelector('.ds-grid .ds-actbox'); if (!box) return;
      try { box.scrollIntoView({ block: 'start' }); } catch (x) { /* an old engine: the screen's top is near enough */ }
      var h = box.querySelector('.ds-bt'); if (h) { h.setAttribute('tabindex', '-1'); try { h.focus({ preventScroll: true }); } catch (x) { /* no focus */ } }
      return;
    }
    var to = JUMP[t.getAttribute('data-to')];
    if (to && screenOf(to) !== st.tab) select(screenOf(to), true);   /* then tracker.js's own jump scrolls to the box, which now shows */
  }
  function wire(r) {
    if (r.__ks17) return;
    r.__ks17 = true;
    r.addEventListener('click', onClick, true);
    if (typeof U().wireTabs === 'function') U().wireTabs(r);   /* the arrow keys along the bar (one listener per root, added once) */
  }

  /* after every draw of a live sheet, while the kit is on (tracker.js render) */
  function apply(rootEl, ctx) {
    if (!rootEl || !ctx || !W || !W.document || !U()) return;
    var id = ctx.id == null ? '' : String(ctx.id), k = tableKey(ctx.table);
    if (st.root !== rootEl || st.id !== id || !st.tab) { st.root = rootEl; st.id = id; st.tab = opening(remembered(id), ctx.table); st.k = k; }
    else if (st.k !== k) {
      if (k.indexOf('play:') !== 0) st.k = k;                                                       /* a session ended: nothing moves */
      else if (!typing() && !rootEl.querySelector('.ds-roll')) { st.k = k; st.tab = 'now'; }        /* a session started: Now */
    }
    st.ctx = ctx;
    wire(rootEl);
    place(ctx);
    paint();
  }
  /* the setting turned off: every mark and every added node goes */
  function teardown() {
    var r = st.root; st.ctx = null; st.tab = null; st.k = null;
    if (!r) return;
    Array.prototype.forEach.call(r.querySelectorAll('.ks17-bar, .ks17-top, .ks17-crew'), function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    Array.prototype.forEach.call(r.querySelectorAll('[data-ks17], [data-ks17-off], [data-ks17-n]'), function (n) { n.removeAttribute('data-ks17'); n.removeAttribute('data-ks17-off'); n.removeAttribute('data-ks17-n'); });
    r.removeAttribute('data-ks17-screen');
  }
  function redraw() { var T = W && W.B68Tracker; if (T && typeof T.refresh === 'function') { try { T.refresh(); } catch (e) { if (W.console) W.console.error(e); } } }
  if (W && W.B68Kit && typeof W.B68Kit.onChange === 'function') {
    W.B68Kit.onChange(function (ev) { if (!ev || ev.name !== 'phone') return; if (!ev.on) teardown(); else if (ev.ready) redraw(); });
    if (typeof W.B68Kit.ready === 'function' && W.B68Kit.ready('phone')) redraw();   /* subscribed late: onChange does not replay */
  }

  return {
    SCREENS: SCREENS, LABELS: LABELS, TABLE: TABLE, PLACE: PLACE,
    apply: apply, teardown: teardown, current: function () { return st.tab; },
    Pure: { tableKey: tableKey, defaultTab: defaultTab, opening: opening, topActions: topActions, screenOf: screenOf, allLabel: allLabel }
  };
});
