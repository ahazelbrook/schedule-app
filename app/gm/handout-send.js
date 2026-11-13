/* gm/handout-send.js: Send to… under each handout (the players' screen build, IP4; setting phone.handouts). In the gm-handouts bundle: gm-page.js
   fetches it and makes the controller only while the setting is on, so with it off the GM page draws, asks for and stores what it did.

   WHAT IT DOES. The GM page's handouts list (gm-page.js handoutsHtml, the iPad view and Planning's Handouts) gets, under each handout, a row of chips:
   one per player (the members with the player role, by first name; with night.who on, tonight's players first) and Everyone. A tap sends the handout
   to that player's phone; a filled chip reads as sent, and a tap on it takes the handout back (asked once: "Take it back from <name>?"). Under the
   chips: "Sent to: A, B". Sending never puts anything on the shared screen.

   WHERE IT LIVES. The docs store (functions/_lib/docs.js), one row per player: kind 'handout', owner = the player's member id, scope 'player', so the
   store gives it to that player and the GM and to nobody else (another player's list never holds it; the display reads public rows only). A player
   may not write the kind (it is not in PLAYER_KINDS): only the GM sends and takes back. The row (the store's key is kind + owner, so one row per
   player, not per handout):
     { v: 1, items: [{ id, title, file, at }] }    oldest first, at most MAX items; id, title and file are the pack's handouts part, at is when it was given
   The pack's cue line (`when`) is GM prep and is never copied. Taking back the last item deletes the row. Every write reads the player's row first,
   so a send never drops what another page sent.

   PURE (Node tests)
     KIND, MAX, FILE_RE
     clean(json) -> [{ id, title, file, at }]        a row's items, checked (a bad item is dropped), oldest first
     withItem(json, x, at) -> row json               the row with handout x added (no change when the same copy is there; a copy with another file or title is replaced)
     without(json, id) -> row json | null            the row without it; null when nothing is left (delete the row)
     names(members) -> [{ id, name }]                players by first name, a clash told apart by the next initial
     order(players, away) -> players                 tonight's first: owners in away (night.who's away()) go last, each part kept in order
     sentTo(rows, id) -> [owner]                     who holds handout id (any copy)
     current(rows, x) -> [owner]                     who holds the copy the pack has now (same file and title); the rest hold an out-of-date copy
   create(host) -> controller
     host: { fetch (default window.fetch), ask(msg, go, o) (the page's confirm), away() -> [owner], toast(msg, bad), now() }
     html(x) -> the markup for handout x's row (escaped; a placeholder until the players and rows have arrived, then painted in place)
     tap(el) -> Promise    a chip (data-gm="ho-send", data-id, data-to = owner or '*')
     load(force) -> Promise   reads the players and the rows (again after 60 s, or when forced)
     state() -> { loaded, players, rows }    destroy()
   ES5, window.B68GmHandoutSend in the browser, module.exports under Node. Every string from a document goes in escaped or as text. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmHandoutSend = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var KIND = 'handout', MAX = 100, STALE_MS = 60000;
  var FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,78}\.(?:png|jpe?g|gif|webp|svg)$/i;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function one(s, max) { return str(s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function cleanItem(x) {
    if (!isObj(x)) return null;
    var id = one(x.id, 80), file = str(x.file), at = typeof x.at === 'number' && isFinite(x.at) && x.at > 0 ? Math.floor(x.at) : 0;
    if (!id || !FILE_RE.test(file) || file.indexOf('..') >= 0) return null;
    return { id: id, title: one(x.title, 200) || file, file: file, at: at };
  }
  function clean(json) {
    var seen = {}, out = [];
    (isObj(json) && Array.isArray(json.items) ? json.items : []).forEach(function (x) { var c = cleanItem(x); if (c && !seen[c.id]) { seen[c.id] = 1; out.push(c); } });
    return out.slice(-MAX);
  }
  function withItem(json, x, at) {
    var items = clean(json), c = cleanItem({ id: x && x.id, title: x && x.title, file: x && x.file, at: at });
    if (!c) return { v: 1, items: items };
    if (items.some(function (i) { return same(i, c); })) return { v: 1, items: items };
    /* a copy of it with another file or title (the pack was exported again since): replaced, and given again now */
    return { v: 1, items: items.filter(function (i) { return i.id !== c.id; }).concat([c]).slice(-MAX) };
  }
  /* the copy a player holds is this handout as the pack has it now: the same file and title */
  function same(i, x) { return !!i && !!x && i.id === x.id && i.file === x.file && i.title === (one(x.title, 200) || x.file); }
  function current(rows, x) {
    return Object.keys(isObj(rows) ? rows : {}).filter(function (o) { return clean(rows[o]).some(function (i) { return same(i, x); }); });
  }
  function without(json, id) {
    var items = clean(json).filter(function (i) { return i.id !== id; });
    return items.length ? { v: 1, items: items } : null;
  }
  function names(members) {
    var list = (Array.isArray(members) ? members : []).filter(function (m) { return isObj(m) && str(m.id); }).map(function (m) {
      var full = one(m.name, 80) || str(m.id).split('@')[0], parts = full.split(' ');
      return { id: str(m.id), full: full, first: parts[0] || full, rest: parts.slice(1).join(' ') };
    });
    return list.map(function (m) {
      var clash = list.filter(function (o) { return o.first.toLowerCase() === m.first.toLowerCase(); }).length > 1;
      return { id: m.id, name: clash && m.rest ? m.first + ' ' + m.rest.charAt(0) + '.' : clash ? m.first + ' (' + m.id.split('@')[0] + ')' : m.first };
    });
  }
  function order(players, away) {
    var off = {}; (Array.isArray(away) ? away : []).forEach(function (o) { off[str(o)] = 1; });
    return players.filter(function (p) { return !off[p.id]; }).concat(players.filter(function (p) { return off[p.id]; }));
  }
  function sentTo(rows, id) {
    return Object.keys(isObj(rows) ? rows : {}).filter(function (o) { return clean(rows[o]).some(function (i) { return i.id === id; }); });
  }

  function create(host) {
    host = host || {};
    var F = host.fetch || (W && W.fetch ? W.fetch.bind(W) : null);
    var st = { loaded: false, loading: null, at: 0, players: [], rows: {}, error: '' }, busy = {}, dead = false, queue = Promise.resolve();
    function now() { return typeof host.now === 'function' ? host.now() : Date.now(); }
    function doc() { return host.doc || (W && W.document) || null; }
    function toast(m, bad) { if (typeof host.toast === 'function') host.toast(m, bad); }
    function jfetch(method, path, body) {
      if (!F) return Promise.reject(new Error('no network here'));
      var o = { method: method, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
      if (body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(body); }
      return F('/api' + path, o).then(function (res) {
        if (!res.ok) return res.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) { j = null; } var er = new Error((j && j.error) || 'HTTP ' + res.status); er.status = res.status; throw er; });
        return res.json();
      });
    }
    function rowOf(owner) {
      return jfetch('GET', '/docs?kind=' + KIND + '&owner=' + encodeURIComponent(owner) + '&limit=1').then(function (j) {
        var r = (Array.isArray(j.docs) ? j.docs : []).filter(function (d) { return isObj(d) && d.kind === KIND && d.owner === owner; })[0];
        return r ? r.json : null;
      });
    }
    function load(force) {
      if (dead) return Promise.resolve(false);
      if (st.loading) return st.loading;
      if (st.loaded && !force && now() - st.at < STALE_MS) return Promise.resolve(true);
      st.loading = Promise.all([
        jfetch('GET', '/members').then(function (j) { return (Array.isArray(j.members) ? j.members : []).filter(function (m) { return isObj(m) && m.role === 'player'; }); }),
        jfetch('GET', '/docs?kind=' + KIND + '&limit=200').then(function (j) { return Array.isArray(j.docs) ? j.docs : []; })
      ]).then(function (a) {
        var rows = {};
        a[1].forEach(function (d) { if (isObj(d) && d.kind === KIND && str(d.owner)) rows[d.owner] = d.json; });
        st.players = names(a[0]); st.rows = rows; st.loaded = true; st.at = now(); st.error = '';
        return true;
      }, function (e) { st.error = (e && e.message) || 'try again'; return false; }).then(function (ok) { st.loading = null; paintAll(); return ok; });
      return st.loading;
    }
    function players() { return order(st.players, typeof host.away === 'function' ? host.away() : []); }
    function nameOf(owner) { var p = st.players.filter(function (x) { return x.id === owner; })[0]; return p ? p.name : str(owner).split('@')[0]; }

    /* the row under one handout: the chips, then who holds it. Built as one string with escaped text and the page's old classes (.chip, .gm-dim) */
    function inner(x) {
      if (!st.loaded) return '<span class="gm-dim">' + (st.error ? 'Could not read who has what: ' + esc(st.error) + '. It tries again when the list redraws.' : 'Send to… (reading the players)') + '</span>';
      var ps = players(), holders = sentTo(st.rows, x.id), fresh = current(st.rows, x), all = ps.length > 0 && ps.every(function (p) { return fresh.indexOf(p.id) >= 0; });
      if (!ps.length) return '<span class="gm-dim">Send to…: no players yet. A player shows here once they have opened the app.</span>';
      var chip = function (to, label, on, title, old) {
        var b = doc().createElement('button');
        b.type = 'button'; b.className = 'chip sm' + (old ? ' gm-ho-old' : ''); b.setAttribute('data-gm', 'ho-send'); b.setAttribute('data-id', x.id); b.setAttribute('data-to', to);
        b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.title = title; b.textContent = label;
        if (busy[x.id]) b.disabled = true;
        return b.outerHTML;
      };
      var h = '<span class="gm-lab gm-ho-send-l" id="gm-ho-send-l-' + esc(x.id) + '">Send to…</span><span class="gm-ho-send-chips" role="group" aria-labelledby="gm-ho-send-l-' + esc(x.id) + '">';
      ps.forEach(function (p) {
        var on = fresh.indexOf(p.id) >= 0, old = !on && holders.indexOf(p.id) >= 0;
        h += chip(p.id, old ? p.name + ' · out of date' : p.name, on, on ? 'On ' + p.name + '’s phone: tap to take it back' : old ? 'Sent copy is out of date: tap to send again' : 'Send to ' + p.name + '’s phone', old);
      });
      h += chip('*', 'Everyone', all, all ? 'On every player’s phone: tap to take it back from everyone' : 'Send to every player’s phone') + '</span>';
      var who = holders.map(function (o) { return nameOf(o) + (fresh.indexOf(o) < 0 ? ' (out of date)' : ''); });
      h += '<span class="gm-ho-sent gm-dim">' + (who.length ? 'Sent to: ' + esc(who.join(', ')) : 'Not sent to any phone') + '</span>';
      if (holders.length > fresh.length) h += '<span class="gm-ho-sent gm-ho-oldline">Sent copy is out of date: tap to send again.</span>';
      return h;
    }
    function html(x) {
      if (!isObj(x) || !str(x.id)) return '';
      if (!st.loaded || now() - st.at >= STALE_MS) load(false);
      return '<div class="gm-ho-send" data-ho-send="' + esc(x.id) + '">' + inner(x) + '</div>';
    }
    /* repaint every row on the page in place (the iPad view and Planning's Handouts can both be drawn), keeping the focus on the chip it was on */
    var items = {};
    function paintAll() {
      var D = doc(); if (dead || !D || typeof D.querySelectorAll !== 'function') return;
      var act = D.activeElement, keep = act && act.getAttribute && act.getAttribute('data-gm') === 'ho-send' ? [act.getAttribute('data-id'), act.getAttribute('data-to')] : null;
      [].forEach.call(D.querySelectorAll('[data-ho-send]'), function (box) {
        var x = items[box.getAttribute('data-ho-send')]; if (!x) return;
        var h = inner(x); if (box.__hs === h) return;
        box.__hs = h; box.innerHTML = h;
      });
      if (keep) {
        var b = [].filter.call(D.querySelectorAll('[data-gm="ho-send"]'), function (e) { return e.getAttribute('data-id') === keep[0] && e.getAttribute('data-to') === keep[1]; })[0];
        if (b && b !== act) { try { b.focus({ preventScroll: true }); } catch (e) { /* not focusable */ } }
      }
    }
    function remember(x) { if (isObj(x) && str(x.id)) items[x.id] = { id: x.id, title: x.title, file: x.file }; }

    /* one change to one player's row: read it, change it, write it (or delete it when it is empty) */
    function change(owner, fn) {
      return rowOf(owner).then(function (cur) {
        var next = fn(cur);
        if (next === undefined) return cur;
        if (next === null) return (cur ? jfetch('DELETE', '/docs?kind=' + KIND + '&owner=' + encodeURIComponent(owner)).then(null, function (e) { if (e && e.status === 404) return null; throw e; }) : Promise.resolve(null)).then(function () { return null; });
        return jfetch('PUT', '/docs', { kind: KIND, owner: owner, scope: 'player', json: next }).then(function () { return next; });
      }).then(function (row) { if (row) st.rows[owner] = row; else delete st.rows[owner]; return row; });
    }
    function has(cur, id) { return clean(cur).some(function (i) { return i.id === id; }); }
    function send(x, owners) { var at = now(); return Promise.all(owners.map(function (o) { return change(o, function (cur) { return clean(cur).some(function (i) { return same(i, x); }) ? undefined : withItem(cur, x, at); }); })); }
    function takeBack(x, owners) { return Promise.all(owners.map(function (o) { return change(o, function (cur) { return has(cur, x.id) ? without(cur, x.id) : undefined; }); })); }

    function run(x, fn, ok) {
      busy[x.id] = true; paintAll();
      queue = queue.then(fn).then(function () { busy[x.id] = false; paintAll(); toast(ok); }, function (e) {
        busy[x.id] = false; toast('The handout did not go: ' + ((e && e.message) || 'try again') + '.', true);
        return load(true);
      });
      return queue;
    }
    function tap(el) {
      if (dead || !el || !el.getAttribute) return Promise.resolve(false);
      var id = el.getAttribute('data-id'), to = el.getAttribute('data-to'), x = items[id];
      if (!x || !st.loaded || busy[id]) return Promise.resolve(false);
      var ps = players(), holders = sentTo(st.rows, id), fresh = current(st.rows, x);
      if (to === '*') {
        var lacking = ps.filter(function (p) { return fresh.indexOf(p.id) < 0; }).map(function (p) { return p.id; });      /* an out-of-date copy is sent again */
        if (lacking.length) return run(x, function () { return send(x, lacking); }, x.title + ' is on every player’s phone.');
        return new Promise(function (done) {
          ask('Take it back from everyone?', function () { done(run(x, function () { return takeBack(x, holders); }, x.title + ' is off every phone.')); }, { confirm: 'Take it back' }, done);
        });
      }
      if (!ps.some(function (p) { return p.id === to; })) return Promise.resolve(false);
      if (fresh.indexOf(to) < 0) return run(x, function () { return send(x, [to]); }, (holders.indexOf(to) >= 0 ? 'Sent again to ' : 'Sent to ') + nameOf(to) + ': ' + x.title + '.');
      return new Promise(function (done) {
        ask('Take it back from ' + nameOf(to) + '?', function () { done(run(x, function () { return takeBack(x, [to]); }, x.title + ' is off ' + nameOf(to) + '’s phone.')); }, { confirm: 'Take it back' }, done);
      });
    }
    /* the page's own confirm (gm-page.js asked): go runs on a yes; a no leaves nothing to do. A page without one sends nothing back */
    function ask(msg, go, o, no) {
      var yes = false;
      if (typeof host.ask === 'function') host.ask(msg, function () { yes = true; go(); }, o);
      if (!yes && no) setTimeout(function () { if (!yes) no(false); }, 0);
    }

    return {
      html: function (x) { remember(x); return html(x); }, tap: tap, load: load,
      state: function () { return { loaded: st.loaded, players: players(), rows: JSON.parse(JSON.stringify(st.rows)), error: st.error }; },
      destroy: function () { dead = true; items = {}; }
    };
  }

  return { KIND: KIND, MAX: MAX, FILE_RE: FILE_RE, clean: clean, withItem: withItem, without: without, names: names, order: order, sentTo: sentTo, current: current, create: create };
});
