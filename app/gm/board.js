/* gm/board.js — the opportunity board (suite ticket 5.1, switch between.board): the GM's side. Plain script, UMD: window.B68GmBoard in the browser, module.exports under Node.

   WHAT IT DOES. Each player posts a client, a target or an operation from their sheet (sheet/board.js): the player's own `opportunity` row in the docs store.
   The GM reads every row (the store hides them from other players and from the iPad). This lists them, lets the GM put chosen ones on the board, mark the one the
   table picked, and show the board on the iPad as the `board` show kind (a cork board, functions/_lib/show-board.js) for the Planning phase. Nothing reaches the
   iPad that the GM did not choose to put up. "Close the board" keeps the picked card out of the list and carries every other posted card over to the next
   night (a count the board shows). The board's own bookkeeping is one GM-scope row (kind `board`, owner `_`), so a reload, or a second GM device, finds it.

   The GM-only row: { v: 1, shown: [key], pick: key | '', carried: { key: n 1-9 }, done: [key] } where key = owner + '|' + the card's id.

   PURE API (also for Node tests)
     cleanItems(raw) -> [{ id, k, text, at }]           gather(entries, names, st) -> [{ key, owner, name, id, k, text, at, shown, picked, carried }] oldest first, done cards left out
     cleanState(raw) -> the GM row, every field present    compose(cards) -> the `board` payload | null      closeState(st, cards) -> the next GM row
     post(st, key, on) -> st   pick(st, key) -> st
   create(host) -> controller. host: { enabled() -> bool, members() -> Promise<[{ id, name }]>, docs: { list(kind), put(row) }, show(kind, payload, opts) -> Promise, night() -> the B68GmNight controller | null, now() }
     refresh() -> Promise<{ cards, state }>   post(key, on) -> Promise   pick(key) -> Promise   show() -> Promise<bool>   close() -> Promise
   sync(root) takes down a stale Menu entry (N2: there is no Menu line any more); open(root) opens the panel (a Workshop sheet, or inline once the shell binds it). */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmBoard = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var SWITCH = 'between.board', KIND = 'opportunity', STATE_KIND = 'board', MS = 180000;
  var KINDS = ['client', 'target', 'operation'], LABEL = { client: 'Client', target: 'Target', operation: 'Operation' };
  var TEXT_MAX = 120, MAX_CARDS = 12, DONE_KEEP = 60;

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function clamp(v, n) { var s = str(v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) : s; }
  function firstName(s) { var t = str(s).trim().split(/\s+/)[0] || ''; return clamp(t, 40); }

  function cleanItems(raw) {
    var list = isObj(raw) && Array.isArray(raw.items) ? raw.items : [], out = [];
    list.forEach(function (x) {
      if (!isObj(x) || KINDS.indexOf(x.k) < 0) return;
      var id = str(x.id).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24), text = clamp(x.text, TEXT_MAX);
      var at = typeof x.at === 'number' && isFinite(x.at) && x.at > 0 ? Math.floor(x.at) : 0;
      if (id && text) out.push({ id: id, k: x.k, text: text, at: at });
    });
    return out;
  }
  function cleanState(raw) {
    var r = isObj(raw) ? raw : {}, carried = {};
    if (isObj(r.carried)) Object.keys(r.carried).forEach(function (k) { var n = r.carried[k]; if (typeof n === 'number' && n >= 1 && n <= 9 && Math.floor(n) === n) carried[k] = n; });
    return {
      v: 1,
      shown: (Array.isArray(r.shown) ? r.shown : []).filter(function (k) { return typeof k === 'string' && k; }).slice(0, 60),
      pick: typeof r.pick === 'string' ? r.pick : '',
      carried: carried,
      done: (Array.isArray(r.done) ? r.done : []).filter(function (k) { return typeof k === 'string' && k; }).slice(-DONE_KEEP)
    };
  }
  /* entries: the docs rows ({ owner, json }); names: { ownerId: name } */
  function gather(entries, names, st) {
    var s = cleanState(st), out = [];
    (entries || []).forEach(function (e) {
      if (!isObj(e)) return;
      var owner = str(e.owner), nm = firstName((names && names[owner]) || owner.split('@')[0]);
      cleanItems(e.json).forEach(function (it) {
        var key = owner + '|' + it.id;
        if (s.done.indexOf(key) >= 0) return;
        out.push({ key: key, owner: owner, name: nm || 'Someone', id: it.id, k: it.k, text: it.text, at: it.at, shown: s.shown.indexOf(key) >= 0, picked: s.pick === key, carried: s.carried[key] || 0 });
      });
    });
    out.sort(function (a, b) { return a.at - b.at || (a.key < b.key ? -1 : 1); });
    return out;
  }
  /* the show payload: the cards the GM put up (at most 12), as parallel lists of plain strings */
  function compose(cards) {
    var on = (cards || []).filter(function (c) { return c.shown; }).slice(0, MAX_CARDS);
    if (!on.length) return null;
    var p = { cards: on.map(function (c) { return c.text; }), who: on.map(function (c) { return c.name; }), kinds: on.map(function (c) { return c.k; }), carried: on.map(function (c) { return String(Math.min(9, c.carried || 0)); }) };
    var at = -1; on.forEach(function (c, i) { if (c.picked) at = i; });
    if (at >= 0) p.pick = at;
    return p;
  }
  function post(st, key, on) {
    var s = cleanState(st), i = s.shown.indexOf(key);
    if (on && i < 0) s.shown.push(key);
    if (!on && i >= 0) { s.shown.splice(i, 1); if (s.pick === key) s.pick = ''; }
    return s;
  }
  function pick(st, key) { var s = cleanState(st); if (s.shown.indexOf(key) < 0) return s; s.pick = s.pick === key ? '' : key; return s; }
  /* close the board: the picked card is done; every other card that was up carries over one more night; a card no longer posted by its player is forgotten */
  function closeState(st, cards) {
    var s = cleanState(st), live = {}, next = { v: 1, shown: [], pick: '', carried: {}, done: s.done.slice() };
    (cards || []).forEach(function (c) { live[c.key] = c; });
    s.shown.forEach(function (k) {
      if (!live[k]) return;
      if (k === s.pick) { next.done.push(k); return; }
      next.shown.push(k); next.carried[k] = Math.min(9, (s.carried[k] || 0) + 1);
    });
    next.done = next.done.slice(-DONE_KEEP);
    return next;
  }

  function create(host) {
    host = host || {};
    var st = cleanState(null), cards = [], names = null;
    function enabled() { return typeof host.enabled === 'function' && host.enabled() === true; }
    function save() { return host.docs.put({ kind: STATE_KIND, scope: 'gm', json: st }); }
    function refresh() {
      if (!enabled()) { cards = []; return Promise.resolve({ cards: cards, state: st }); }
      var members = typeof host.members === 'function' ? host.members() : [];
      return Promise.all([host.docs.list(KIND), host.docs.list(STATE_KIND), members]).then(function (a) {
        names = {}; (a[2] || []).forEach(function (m) { if (m && m.id) names[m.id] = m.name; });
        var row = (a[1] || []).filter(function (r) { return isObj(r) && r.owner === '_'; })[0];
        st = cleanState(row ? row.json : null);
        cards = gather(a[0], names, st);
        return { cards: cards, state: st };
      });
    }
    function change(next) { st = next; cards = cards.map(function (c) { return Object.assign({}, c, { shown: st.shown.indexOf(c.key) >= 0, picked: st.pick === c.key, carried: st.carried[c.key] || 0 }); }); return save().then(function () { return { cards: cards, state: st }; }); }
    function night(text) { var n = typeof host.night === 'function' ? host.night() : null; if (n && typeof n.stamp === 'function') n.stamp(text); }
    return {
      refresh: refresh, enabled: enabled, cards: function () { return cards; }, state: function () { return st; },
      post: function (key, on) { return change(post(st, key, on)); },
      pick: function (key) { return change(pick(st, key)).then(function (r) { var c = cards.filter(function (x) { return x.picked; })[0]; if (c) night('Board: picked ' + c.k); return r; }); },
      show: function () {
        var p = compose(cards);
        if (!p) return Promise.resolve(false);
        night('Board up (' + p.cards.length + ' cards)');
        return Promise.resolve(host.show('board', p, { ms: MS, key: 'board:' + (typeof host.now === 'function' ? host.now() : Date.now()) })).then(function (r) { return r !== null && r !== undefined; });
      },
      close: function () { night('Board closed'); return change(closeState(st, cards)).then(function () { return refresh(); }); }
    };
  }

  /* ---------- the page (browser only) ---------- */
  function jfetch(method, path, body) {
    var o = { method: method, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
    if (body) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
    return W.fetch('/api' + path, o).then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); });
  }
  function el(tag, cls, text) { var e = W.document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function btn(label, fn, cls) { var b = el('button', cls || '', label); b.type = 'button'; b.addEventListener('click', fn); return b; }

  var ctl = null;
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
        put: function (row) { return jfetch('PUT', '/docs', row); }
      },
      show: function (kind, payload, o) { var P = W.B68GmPage; return P && typeof P.show === 'function' ? P.show(kind, payload, o) : Promise.resolve(null); },
      now: function () { return Date.now(); }
    });
    return ctl;
  }
  function paint(box) {
    var c = controller();
    while (box.firstChild) box.removeChild(box.firstChild);
    var f = feed(), phase = f && f.night && typeof f.night.phase === 'function' ? str(f.night.phase()) : '';
    box.appendChild(el('p', 'gm-dim', (phase === 'plan' ? 'Planning phase: put the board up for the table. ' : '') + 'Players post from their sheets. Only the cards you post here go on the iPad.'));
    var row = el('div', 'seg');
    row.appendChild(btn('Put the board on the iPad', function () { c.show().then(function (ok) { if (!ok) box.appendChild(el('p', 'gm-warn', 'Post at least one card first.')); }); }, 'primary'));
    row.appendChild(btn('Refresh', function () { c.refresh().then(function () { paint(box); }); }));
    row.appendChild(btn('Close the board (picked is done, the rest carry over)', function () {
      if (W.confirm && !W.confirm('Close the board? The picked card is done and every other posted card carries over.')) return;
      c.close().then(function () { paint(box); });
    }));
    box.appendChild(row);
    var list = el('div', 'gm-board-list'); box.appendChild(list);
    var cards = c.cards();
    if (!cards.length) list.appendChild(el('p', 'gm-dim', 'Nothing posted yet.'));
    cards.forEach(function (k) {
      var r = el('div', 'gm-board-card'); r.style.cssText = 'display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;margin:6px 0';
      r.appendChild(el('b', '', LABEL[k.k] + ' (' + k.name + ')'));
      var t = el('span', '', k.text); t.style.flex = '1'; r.appendChild(t);
      if (k.carried) r.appendChild(el('span', 'gm-dim', 'carried ×' + k.carried));
      r.appendChild(btn(k.shown ? 'Take down' : 'Post', function () { c.post(k.key, !k.shown).then(function () { paint(box); }); }));
      if (k.shown) r.appendChild(btn(k.picked ? 'Unpick' : 'Pick', function () { c.pick(k.key).then(function () { paint(box); }); }));
      list.appendChild(r);
    });
  }
  /* N2: the Menu line is gone (the shell places this tool, B68GmTools.get('board').open()); sync() only takes down a line an older page drew, and says false. */
  function sync(rootEl) {
    var cur = rootEl && typeof rootEl.querySelector === 'function' ? rootEl.querySelector('#gm-menu-board') : null;
    if (cur && cur.parentNode) cur.parentNode.removeChild(cur);
    return false;
  }
  function open(rootEl) {
    var Wk = W.B68GmWorkshop; if (!Wk || typeof Wk.sheet !== 'function') return null;
    var sh = Wk.sheet(rootEl, 'board', 'Opportunity board'); if (!sh) return null;
    controller().refresh().then(function () { paint(sh.body); }, function (e) { sh.body.appendChild(el('p', 'gm-warn', 'Could not read the board: ' + (e && e.message || 'try again'))); });
    sh.open(); return sh;
  }

  return { SWITCH: SWITCH, KIND: KIND, STATE_KIND: STATE_KIND, KINDS: KINDS, cleanItems: cleanItems, cleanState: cleanState, gather: gather, compose: compose, post: post, pick: pick, closeState: closeState, create: create, sync: sync, open: open };
});
