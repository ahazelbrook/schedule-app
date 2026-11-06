/* gm/quiet.js — the quiet line (suite ticket 5.8, switch between.quiet): the GM's side. Plain script, UMD: window.B68GmQuiet in the browser, module.exports under Node.

   WHAT IT DOES. A player's phone sends a quiet line (sheet/quiet.js): the X-card, a pause, "spotlight me" or a secret note, as that player's own `quiet` row in
   the docs store (scope 'player'). Only the GM reads it: the GM reads every row; another player and the table display read nothing of it (the store hides
   it), and the live poke it fires is the `quiet` kind, which only the GM hears (functions/_lib/live.js), not the `docs` poke every page hears.
   This file shows it to the GM as a quiet badge in the band's second row (gm/band.js gives it a slot): "Quiet 2", NO SOUND, no vibration, no overlay on the
   iPad, nothing at all while there is no line. Tapping the badge opens the list under it (who, what, when); Dismiss deletes that player's row; Esc or a tap
   elsewhere closes the list (the band registers it with gm/esc.js). Each new line is stamped once into the night log (GM-side), without the note's text.

   PURE API (also for Node tests)
     KINDS  LABELS   cleanItems(raw) -> [{ k, at, text? }] only the four kinds, strings clamped, newest 8
     summarise(entries, names) -> { count, items: [{ id, name, k, label, at, text }] } newest first        fresh(entries, seen) -> new items not yet in `seen` (a map)
   create(host) -> controller. host: { enabled() -> bool, members() -> Promise<[{ id, name }]>, docs: { list(kind), del(kind, owner) }, night() -> the B68GmNight controller | null, toast }
     refresh() -> Promise<{ count, items, news }>   dismiss(owner) -> Promise   model() -> the last summary
   THE PAGE PART (browser only): mount(slot) draws the badge into the band's slot (again after the band is redrawn); isOpen() / close() for the list;
   poll() reads now. It polls every POLL_MS and on the live `quiet` poke from the moment the GM bundle loads. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmQuiet = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var SWITCH = 'between.quiet', KIND = 'quiet', POLL_MS = 8000;
  var KINDS = ['xcard', 'pause', 'spot', 'note'];
  var LABELS = { xcard: 'X-card', pause: 'Pause', spot: 'Spotlight me', note: 'Secret note' };
  var TEXT_MAX = 280, KEEP = 8;

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function clamp(v, n) { var s = str(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim(); return s.length > n ? s.slice(0, n) : s; }

  function cleanItems(raw) {
    var list = isObj(raw) && Array.isArray(raw.items) ? raw.items : [], out = [];
    list.forEach(function (x) {
      if (!isObj(x) || KINDS.indexOf(x.k) < 0) return;
      var at = typeof x.at === 'number' && isFinite(x.at) && x.at > 0 ? Math.floor(x.at) : 0;
      var it = { k: x.k, at: at };
      if (x.k === 'note') it.text = clamp(x.text, TEXT_MAX);
      out.push(it);
    });
    return out.slice(-KEEP);
  }
  function summarise(entries, names) {
    var items = [];
    (entries || []).forEach(function (e) {
      if (!isObj(e)) return;
      cleanItems(e.json).forEach(function (it) {
        items.push({ id: str(e.owner), name: (names && names[e.owner]) || str(e.owner).split('@')[0], k: it.k, label: LABELS[it.k], at: it.at, text: it.text || '' });
      });
    });
    items.sort(function (a, b) { return b.at - a.at; });
    return { count: items.length, items: items };
  }
  function fresh(summary, seen) {
    var out = [];
    (summary.items || []).forEach(function (it) { var key = it.id + '|' + it.k + '|' + it.at; if (!seen[key]) { seen[key] = 1; out.push(it); } });
    return out;
  }

  function create(host) {
    host = host || {};
    var seen = {}, last = { count: 0, items: [] }, names = null, born = (typeof host.now === 'function' ? host.now() : Date.now()) - 60000;
    function enabled() { return typeof host.enabled === 'function' && host.enabled() === true; }
    function refresh() {
      if (!enabled()) { last = { count: 0, items: [], news: [] }; return Promise.resolve(last); }
      return Promise.all([host.docs.list(KIND), typeof host.members === 'function' ? host.members() : []]).then(function (a) {
        names = {}; (a[1] || []).forEach(function (m) { if (m && m.id) names[m.id] = m.name; });
        var sum = summarise(a[0], names), news = fresh(sum, seen);
        var n = typeof host.night === 'function' ? host.night() : null;
        if (n && typeof n.stamp === 'function') news.forEach(function (it) { if (it.at >= born) n.stamp('Quiet: ' + it.label + ' (' + it.name + ')'); });
        last = { count: sum.count, items: sum.items, news: news };
        return last;
      });
    }
    function dismiss(owner) { return host.docs.del(KIND, owner).then(function () { return refresh(); }); }
    return { refresh: refresh, dismiss: dismiss, model: function () { return last; }, enabled: enabled };
  }

  /* ---------- the page (browser only): the badge in the band ---------- */
  function jfetch(method, path) {
    return W.fetch('/api' + path, { method: method, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    });
  }
  function el(tag, cls, text) { var e = W.document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

  var ctl = null, slot = null, open = false, started = false;
  function feed() { var P = W.B68GmPage; return P && typeof P.aftermath === 'function' ? P.aftermath() : null; }
  function controller() {
    if (ctl) return ctl;
    var members = null, memAt = 0;
    ctl = create({
      enabled: function () { var f = feed(); return !!(f && W.B68Features && W.B68Features.valueOf(f.doc, SWITCH)); },
      night: function () { var f = feed(); return f ? f.night : null; },
      members: function () {
        if (members && Date.now() - memAt < 60000) return Promise.resolve(members);
        return jfetch('GET', '/members').then(function (j) {
          members = (Array.isArray(j.members) ? j.members : []).map(function (m) { return { id: str(m.id), name: str(m.name) }; }); memAt = Date.now(); return members;
        });
      },
      docs: {
        list: function (kind) { return jfetch('GET', '/docs?kind=' + encodeURIComponent(kind) + '&limit=200').then(function (j) { return Array.isArray(j.docs) ? j.docs : []; }); },
        del: function (kind, owner) { return jfetch('DELETE', '/docs?kind=' + encodeURIComponent(kind) + '&owner=' + encodeURIComponent(owner)); }
      }
    });
    return ctl;
  }
  function when(ms) { return ms ? new Date(ms).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' }) : ''; }
  function live() { return !!(slot && slot.parentNode && W.document && W.document.contains && W.document.contains(slot)); }
  /* the badge and its list, drawn into the band's slot; with no line the slot is empty */
  function draw() {
    if (!slot) return;
    var m = controller().model(), on = !!(m.count && controller().enabled());
    if (!on) { open = false; while (slot.firstChild) slot.removeChild(slot.firstChild); slot.removeAttribute('data-quiet'); return; }
    while (slot.firstChild) slot.removeChild(slot.firstChild);
    slot.setAttribute('data-quiet', String(m.count));
    var badge = el('button', 'gm-quiet-badge', 'Quiet ' + m.count); badge.type = 'button';
    badge.setAttribute('aria-expanded', String(open)); badge.setAttribute('aria-haspopup', 'dialog');
    badge.title = 'The quiet line: ' + m.count + (m.count === 1 ? ' message' : ' messages') + ' from the players. Only you see this.';
    badge.addEventListener('click', function () { open = !open; draw(); });
    slot.appendChild(badge);
    var list = el('div', 'gm-quiet-list'); list.setAttribute('role', 'dialog'); list.setAttribute('aria-label', 'The quiet line');
    if (!open) list.setAttribute('hidden', '');
    m.items.forEach(function (it) {
      var row = el('div', 'gm-quiet-row');
      row.appendChild(el('b', '', it.name + ': ' + it.label)); row.appendChild(el('span', 'gm-quiet-when', when(it.at)));
      if (it.text) row.appendChild(el('span', 'gm-quiet-text', it.text));
      var d = el('button', 'btn sm', 'Dismiss'); d.type = 'button'; d.addEventListener('click', function () { controller().dismiss(it.id).then(draw, draw); });
      row.appendChild(d); list.appendChild(row);
    });
    slot.appendChild(list);
  }
  /* the band gives the badge its slot (again after every redraw of the band). The reads keep the poll's own rhythm (a line sent before the page opened
     shows within POLL_MS): a read at mount would also move the members fetch each read makes, which the page's request timing is measured against */
  function mount(s) { if (s === slot) { draw(); return; } slot = s || null; open = false; draw(); }
  function isOpen() { return !!(open && slot && live() && controller().model().count); }
  function close() { if (!open) return; open = false; draw(); }
  function poll() { controller().refresh().then(draw, function () { /* offline: the badge stays as it was */ }); }
  function start() {
    if (started || !W || !W.document || typeof W.setInterval !== 'function') return;
    started = true;
    W.setInterval(function () { if (!W.document.hidden) poll(); }, POLL_MS);
    if (W.B68Live && typeof W.B68Live.on === 'function') { try { W.B68Live.on(['quiet'], poll); } catch (e) { /* the poll covers it */ } }
  }
  start();

  return { KINDS: KINDS, LABELS: LABELS, SWITCH: SWITCH, KIND: KIND, cleanItems: cleanItems, summarise: summarise, fresh: fresh, create: create, start: start, poll: poll,
    mount: mount, isOpen: isOpen, close: close };
});
