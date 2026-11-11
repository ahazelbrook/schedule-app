/* gm/kit/shell.js: the shell of the new desk (kit.desk, KS09 of the kit and stage build). In the kit-desk bundle: fetched only while the setting is on.
   It defines B68KitShell when it loads and reads other modules only when it is called (the kit's load-order rule), so it may arrive before the GM
   page's own bundle. Every caller asks on() first and runs its old code whenever it is false: with the setting off nothing here runs.

   What it does, and who asks:
     the tabs     gm/places.js paintRow(): the view switcher as the kit's Tabs (an underline), every tab keeping its old hooks (button.gm-vt,
                  data-pv, aria-selected, aria-keyshortcuts, .gm-vt-l, the extra view's × with data-pvx). KS09.1: Chase, Street, Score generator
                  and Opportunities are put away (the plan's retire list): they leave the row and the chip row, and come back only while one of them
                  is the view on screen (opened by its key, C S J O, or from Find), so the GM always sees where they are. A place's first visit
                  opens its first view that is not put away (Planning: Intel)
     the Menu     gm-page.js menuHtml(): the same lines, ids and data-gm hooks, as the kit's menu (rows, the key hint at the edge, the one red line)
     dressing     sync(): the page's own Find, drawer, capture bar, Capture button and view row are dressed in place with the kit's classes (ui-tabs,
                  ui-tab, ui-btn, ui-field-input and this file's kshell-*; where the old sheets show or hide a node by the screen's width, only a
                  kshell- class, so the kit never changes what shows): nothing is rebuilt, so no hook can be lost, and turning the setting off
                  takes every class it added away again (data-kshell-cls records them)
     the toasts   gm-page.js toast() and gm/cue-grammar.js (the cue's Undo, and its Yes or Cancel) speak through the overlay kit's one stack
                  (B68Ui.toast, KS03): news fades with its timer, an error stays until X. The Undo and Yes buttons keep data-ug="undo" /
                  "confirm", Cancel data-ug="cancel", the toast the class gm-ugtoast. Preflight speaks through the page's toast(). The band
                  already holds "signed out" (with Reload, KS05): the page's own copy of that line is not shown twice
     the dialogs  ask(o) / askText(o): the kit's Dialog (B68Ui.confirm / B68Ui.prompt) for a native confirm or prompt that is the last thing its
                  handler does (KS09.4); null when the kit is not here, so the caller keeps its native one
   Esc: nothing here listens for it. The overlay kit's dialogs close through B68GmEsc; a toast takes no Esc (PANIC wins).

   API (window.B68KitShell; module.exports under Node)
     on() -> bool                     the desk is on, its bundle is here, and the UI kit is here
     RETIRED                          ['chase', 'scenes', 'score', 'cards']
     inRow(views, cur) -> views       the place's own views without the put-away ones (the one on screen stays)
     first(views) -> id               the first view that is not put away (the first of all when every one is)
     row(el, o) -> bool               paints the view switcher. o: { label, cur, own: [{id, label}], extra: {id, label, drop} | null,
                                      pinned: [{id, label}], views (places' VIEWS) }
     menuHtml() -> string             the Menu's lines
     toast(msg, bad) -> bool          true when the stack took it
     cueToast(o) -> { el, dismiss(), state() } | null      o: { text, ms, undo() } or { text, ms, yes, onYes(), onCancel() }
     ask(o) -> Promise<bool> | null   askText(o) -> Promise<string|null> | null
     sync()                           dress or undress the page; start() once, when the file loads in a page */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root && root.document && !root.B68KitShell) { root.B68KitShell = M; M.start(); }
})(typeof window !== 'undefined' ? window : null, function (W) {
  'use strict';

  var RETIRED = ['chase', 'scenes', 'score', 'cards'];
  var MARK = 'data-kshell-cls', SIG = 'data-kshell-sig', listening = false;

  function str(v) { return v == null ? '' : String(v); }
  function req(name) { try { return typeof require === 'function' ? require(name) : null; } catch (e) { return null; } }
  function Ui() { return (W && W.B68Ui) || req('../../ui/ui.js'); }
  function on() {
    var K = W && W.B68Kit, U = W && W.B68Ui;
    return !!(K && typeof K.ready === 'function' && K.ready('desk') && U && typeof U.node === 'function');
  }
  function later(fn) { if (W && typeof W.setTimeout === 'function') W.setTimeout(fn, 0); else fn(); }
  function doc() { return W && W.document; }

  /* ---------- KS09.1 the tabs ---------- */
  function retired(id) { return RETIRED.indexOf(str(id)) >= 0; }
  function inRow(views, cur) { return (Array.isArray(views) ? views : []).filter(function (v) { return v && (!retired(v.id) || v.id === cur); }); }
  function first(views) {
    var l = Array.isArray(views) ? views : [], i;
    for (i = 0; i < l.length; i++) if (l[i] && !retired(l[i].id)) return l[i].id;
    return l.length && l[0] ? l[0].id : '';
  }
  /* the classes this file adds to a node the page drew, recorded so they can be taken away again */
  function addCls(e, list) {
    if (!e || !e.classList) return;
    var had = str(e.getAttribute(MARK)).split(' ').filter(Boolean);
    list.forEach(function (c) { if (c && !e.classList.contains(c)) { e.classList.add(c); had.push(c); } });
    if (had.length) e.setAttribute(MARK, had.join(' '));
  }
  function row(el, o) {
    var U = Ui(), d = el && el.ownerDocument; if (!U || !d || !o) return false;
    var views = o.views || {}, cur = str(o.cur);
    var sig = JSON.stringify([cur, o.label, (o.own || []).map(function (v) { return v.id + ':' + v.label; }), o.extra && [o.extra.id, o.extra.label], (o.pinned || []).map(function (v) { return v.id; })]);
    addCls(el, ['ui-tabs', 'kshell-tabs']);
    if (el.getAttribute(SIG) === sig) return true;
    var a = d.activeElement, focused = !!(a && el.contains(a));
    function item(v, kind) {
      var vw = views[v.id] || {}, key = str(vw.key), label = str(v.label), away = kind === 'own' && retired(v.id);
      var cls = ['gm-vt', 'kshell-vt'];
      if (kind === 'pin') cls.push('gm-vt-pin');
      if (kind === 'extra') cls.push('gm-vt-extra');
      if (kind !== 'pin' && label.length > 9) cls.push('gm-vt-long');
      if (away) cls.push('kshell-vt-away');
      var tip = str(vw.title || label) + (key ? ' (' + key + ')' : '') + (kind === 'extra' ? ': brought here from another place' : away ? ': put away from the tabs; ' + (key ? key + ' or ' : '') + 'Find opens it' : '');
      var it = { label: label, value: v.id, selected: v.id === cur, title: tip, cls: cls, data: { pv: v.id } };
      if (key) { it.key = key; it.attrs = { 'aria-keyshortcuts': key }; }
      return it;
    }
    var own = (o.own || []).map(function (v) { return item(v, 'own'); });
    var ex = o.extra ? [item(o.extra, 'extra')] : [];
    var pins = (o.pinned || []).map(function (v) { return item(v, 'pin'); });
    var t = U.node('tabs', { label: o.label, items: own.concat(ex, pins) }, d); if (!t) return false;
    var tabs = [].slice.call(t.children);
    tabs.forEach(function (b) {      /* the old label hook: .gm-vt-l holds the words (the key hint stays the kit's) */
      var l = b.querySelector('.ui-label');
      if (l) { l.classList.add('gm-vt-l'); return; }
      var s = d.createElement('span'); s.className = 'gm-vt-l'; while (b.firstChild) s.appendChild(b.firstChild); b.appendChild(s);
    });
    while (el.firstChild) el.removeChild(el.firstChild);
    tabs.forEach(function (b, i) {
      if (i === own.length + ex.length) { var sep = d.createElement('span'); sep.className = 'gm-vsep kshell-vsep'; sep.setAttribute('aria-hidden', 'true'); el.appendChild(sep); }
      if (ex.length && i === own.length) {
        var w = d.createElement('span'); w.className = 'gm-vt-xw kshell-vt-xw'; w.appendChild(b);
        var x = U.node('button', { label: '×', rank: 'quiet', cls: ['gm-vt-x', 'kshell-vt-x'], data: { pvx: o.extra.id }, title: 'Drop it from this place',
          attrs: { 'aria-label': str(o.extra.drop) || 'Drop ' + str(o.extra.label) } }, d);
        if (x) w.appendChild(x);
        el.appendChild(w);
        return;
      }
      el.appendChild(b);
    });
    el.setAttribute('aria-label', str(o.label));
    el.setAttribute(SIG, sig);
    if (typeof U.wireTabs === 'function') U.wireTabs(el);
    if (focused) { var s = el.querySelector('[role="tab"][aria-selected="true"]'); if (s && typeof s.focus === 'function') { try { s.focus(); } catch (e) { /* gone */ } } }
    return true;
  }

  /* ---------- KS09.2 the Menu: the old lines, ids and hooks, as rows ---------- */
  function menuHtml() {
    var U = Ui();
    var head = '<p class="gm-menu-h kshell-menu-h"><span class="gm-exp" id="gm-menu-exp"></span></p><div class="gm-menu-warn kshell-menu-warn" id="gm-menu-warn" hidden></div>';
    var acts = U.menu({ label: 'Menu', cls: 'kshell-menu', items: [
      { label: 'Find', cls: 'gm-menu-ph', data: { gm: 'find-open' } },
      { label: 'Crew: the clocks, the crew and the sheets', cls: 'gm-menu-ph', data: { gm: 'drawer' } },
      { label: 'Shortcuts', key: '?', id: 'gm-menu-shortcuts', data: { gm: 'shortcuts' }, title: 'The keys, the “Blade, …” lines, clocks, music and cue lines on one card (?)' },
      { label: 'Update pack', data: { gm: 'update' } },
      { label: 'Export tonight’s note', data: { gm: 'note' } },
      { label: 'Clear tonight’s capture', data: { gm: 'clearcap' } },
      { label: '', id: 'gm-menu-capbar', data: { gm: 'capbar' }, title: 'The bottom bar that files a roll, a name or a moment' },
      { label: '', id: 'gm-menu-live', data: { gm: 'livesync' }, title: 'Live sync: a page hears of a change at once instead of on its next poll. Off sends every page back to polling; no deploy needed' }
    ] });
    var go = [['#display', 'Open the display page (for the iPad)', 'The players’ screen: open this on the iPad'], ['#t', 'The table'], ['#rules', 'Rules'], ['#cast', 'The cast'], ['#', 'Home']];
    var links = '<div class="kshell-mlinks" role="group" aria-label="Go to">' + go.map(function (g) {
      return U.link({ label: g[1], href: g[0], rank: 'quiet', cls: 'kshell-mlink', title: g[2] || '' });
    }).join('') + '</div>';
    var end = U.menu({ label: 'This device', cls: 'kshell-menu kshell-menu-end', items: [{ label: 'Forget GM data on this device', rank: 'danger', cls: ['bad', 'gm-menu-sep'], data: { gm: 'forget' } }] });
    return '<div class="kshell-mbox">' + head + acts + links + end + '</div>';
  }

  /* ---------- KS09.2 dressing the page's own Find, drawer, capture bar and view row ---------- */
  var DRESS = [
    ['#gm-find', ['kshell-find']], ['#gm-find .gm-find-box', ['kshell-findbox']], ['#gm-find-q', ['ui-field-input', 'kshell-findq']],
    ['.gm-viewrow', ['kshell-viewrow']], ['.gm-focusbtn', ['kshell-focus']],
    ['#gm-drawer', ['kshell-drawer']], ['#gm-drawer .gm-dtabs', ['ui-tabs', 'kshell-dtabs']], ['#gm-drawer .gm-dtab', ['ui-tab']],
    ['#gm-drawer .gm-dhead > .gm-x', ['ui-btn', 'ui-btn--quiet', 'kshell-x']], ['#gm-drawer [data-gm="dedit"]', ['ui-btn', 'ui-btn--standard', 'kshell-dedit']],
    ['#gm-foot', ['kshell-foot']], ['.gm-fab', ['kshell-fab']]
  ];
  function dress(root) {
    DRESS.forEach(function (d) { [].forEach.call(root.querySelectorAll(d[0]), function (e) { addCls(e, d[1]); }); });
  }
  function undress(root) {
    [].forEach.call(root.querySelectorAll('[' + MARK + ']'), function (e) {
      str(e.getAttribute(MARK)).split(' ').forEach(function (c) { if (c) e.classList.remove(c); });
      e.removeAttribute(MARK);
    });
    [].forEach.call(root.querySelectorAll('[' + SIG + ']'), function (e) { e.removeAttribute(SIG); });
  }
  function sync() {
    var d = doc(); if (!d) return;
    var root = d.getElementById('gm-root'); if (!root) return;
    if (on()) { dress(root); adopt(d); } else undress(root);
  }
  /* a line the page said before this bundle arrived went to the old #toast region: it joins the stack, and the old line is emptied */
  function adopt(d) {
    [['toastMsg', false], ['toastErr', true]].forEach(function (p) { var e = d.getElementById(p[0]), t = e ? str(e.textContent).trim() : ''; if (t && toast(t, p[1])) e.textContent = ''; });
  }

  /* ---------- KS09.3 one toast stack ---------- */
  function stackOk() { var U = W && W.B68Ui; return !!(on() && U && typeof U.toast === 'function'); }
  function toastEl(h) { var d = doc(); return h && d ? d.querySelector('.ui-toast[data-toast-id="' + String(h.id) + '"]') : null; }
  function toast(msg, bad) {
    if (!stackOk()) return false;
    var text = str(msg), d = doc(), sig = d && d.getElementById('gm-signed');
    if (bad && sig && str(sig.textContent).trim() === text.trim()) return true;      /* signed out: the band's own toast (with Reload) says it, once */
    try { W.B68Ui.toast({ text: text, tone: bad ? 'error' : 'info', key: 'page:' + text }); return true; } catch (e) { return false; }
  }
  /* the cue's toasts: the Undo one fades with the stack's timer; the question (Yes or Cancel) stays for o.ms with its timer shown, then answers no */
  function cueToast(o) {
    if (!stackOk() || !o) return null;
    var U = W.B68Ui, asking = typeof o.onYes === 'function', done = false, poll = null, h;
    function stop() { done = true; if (poll) { W.clearInterval(poll); poll = null; } }
    function gone() { if (done) return; stop(); if (asking && typeof o.onCancel === 'function') o.onCancel(); }
    var opt = { text: str(o.text), tone: 'info', duration: o.ms || 5000 };
    if (asking) opt.undo = { label: str(o.yes) || 'Yes', fn: function () { if (done) return; stop(); o.onYes(); } };
    else if (typeof o.undo === 'function') opt.undo = { label: 'Undo', fn: o.undo };
    try { h = U.toast(opt); } catch (e) { return null; }
    var el = toastEl(h);
    if (el) {
      el.classList.add('gm-ugtoast', 'kshell-cue');
      if (asking) el.setAttribute('role', 'alertdialog');
      var u = el.querySelector('.ui-toast-undo'); if (u) u.setAttribute('data-ug', asking ? 'confirm' : 'undo');
      if (asking) {
        var acts = el.querySelector('.ui-toast-acts'), x = el.querySelector('.ui-toast-x');
        var c = U.node('button', { label: 'Cancel', rank: 'quiet', cls: 'ui-toast-undo kshell-cancel', data: { ug: 'cancel' } });
        if (c && acts) { c.addEventListener('click', function () { try { h.dismiss(); } catch (e) { /* gone */ } gone(); }); acts.insertBefore(c, x || null); }
        if (x) x.setAttribute('aria-label', 'Cancel');
      }
    }
    /* the stack says nothing when a toast leaves by X or by its timer: a question is answered no once its toast is going */
    if (asking) poll = W.setInterval(function () { var s = h && typeof h.state === 'function' ? h.state() : 'gone'; if (s === 'gone' || s === 'leaving') gone(); }, 200);
    return { el: el, dismiss: function () { stop(); try { h.dismiss(); } catch (e) { /* gone */ } }, state: function () { return h && typeof h.state === 'function' ? h.state() : 'gone'; } };
  }

  /* ---------- KS09.4 the dialogs ---------- */
  function ask(o) { var U = W && W.B68Ui; return on() && U && typeof U.confirm === 'function' ? U.confirm(o || {}) : null; }
  function askText(o) { var U = W && W.B68Ui; return on() && U && typeof U.prompt === 'function' ? U.prompt(o || {}) : null; }

  /* ---------- following the setting ---------- */
  function start() {
    if (listening || !W || !W.B68Kit || typeof W.B68Kit.onChange !== 'function') return;
    listening = true;
    W.B68Kit.onChange(function (ev) { if (ev && ev.name === 'desk') later(sync); });
    later(sync);      /* no replay: a page drawn before this file arrived is dressed now */
  }

  return { RETIRED: RETIRED, on: on, inRow: inRow, first: first, row: row, menuHtml: menuHtml, toast: toast, cueToast: cueToast, ask: ask, askText: askText,
    sync: sync, start: start };
});
