/* gm/debrief.js — the Debrief (suite ticket 1.7, switch spine.debrief): the GM's side. Plain script, UMD: window.B68GmDebrief in the browser, module.exports under Node.
   Nothing here touches the clock or the network on its own: the host passes both (the page's host is built at the bottom).

   WHAT IT DOES. The Aftermath (gm/aftermath.js) files the steps it did not reach in night.aftermath.data.pending ("unwind,xp,credits"). When the Aftermath
   has finished with some pending, this sends each PLAYER a Debrief: one `debrief` row in the docs store, owner = that player, scope 'player', so only that
   player (and the GM) can read it. The row says which steps are left, when the card shows on the sheet (the next morning, 07:00), when the defaults take over
   (48 hours after the night), and the downtime picks to offer. The phone (sheet/debrief.js) adds the player's reply to the same row.
   The GM never writes over a row that is already there for this night (a reply lives in it); "Send again" deletes the rows first, on purpose.
   Replies are read back by the GM (the GM reads every row) and drawn in a panel: who has answered, what they chose, who is on the default.
   The send is stamped into the night log ("Debrief sent: ..."), which is also how a reloaded page knows it already sent.

   DEFAULTS. After 48 hours an unanswered Debrief stands as: Lay low for the downtime pick, no xp triggers ticked, nobody credited. Wording of rules is never here.

   PURE API (also for Node tests)
     STEPS  DUE_MS  MORNING_HOUR  DEFAULT_PICK  OPTIONS
     pendingOf(night) -> ['unwind', ...] the Aftermath's unfinished steps, known ids only, in step order
     morningAfter(nowMs) -> ms of the next 07:00 (this device's clock)
     buildRow({ steps, nightAt, sentAt, options? }) -> the row body the GM writes
     cleanReply(raw) -> a reply with every string clamped | null          resolve(row, nowMs) -> { state, due, left, effective }
     state: 'waiting' (before the card shows) | 'open' | 'answered' | 'default'
     sentFor(night) -> bool   the night log says this night's Debrief went out        rollup(entries, nowMs) -> { answered, defaults, open, waiting }
   create(host) -> controller. host: { enabled() -> bool, night() -> the B68GmNight controller | null, members() -> Promise<[{ id, name }]>,
     docs: { list(kind) -> Promise<[{ owner, json }]>, put(row), del(kind, owner) }, now() -> ms, toast(msg, bad) }
     pending() -> [steps]   send(opts?) -> Promise<{ sent, skipped, steps }>   again() -> Promise   replies() -> Promise<[{ id, name, state, reply, effective, steps }]>
     tick() -> Promise   sends once when the Aftermath has finished with steps left and this night's log has no "Debrief sent"
   sync(root, doc) draws or removes the Menu entry (only while the switch is on); open(root) opens the panel. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmDebrief = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var SWITCH = 'spine.debrief', KIND = 'debrief';
  /* the Aftermath's eight steps, labels only (the order is the Aftermath's) */
  var STEPS = [
    { id: 'payout', label: 'Payout' }, { id: 'tithe', label: 'Tithe' }, { id: 'heat', label: 'Heat' }, { id: 'status', label: 'Status changes' },
    { id: 'harm', label: 'Harm complications' }, { id: 'unwind', label: 'Unwind' }, { id: 'xp', label: 'Commendations' }, { id: 'credits', label: 'End credits' }
  ];
  var DUE_MS = 48 * 3600 * 1000, MORNING_HOUR = 7, FRESH_MS = 20 * 3600 * 1000, TICK_MS = 10000;
  /* the downtime picks offered (ids and labels the Downtime tool already uses) */
  var OPTIONS = [
    { id: 'indulge', label: 'Indulge vice' }, { id: 'recover', label: 'Recover' }, { id: 'project', label: 'Long-term project' }, { id: 'train', label: 'Train' },
    { id: 'contact', label: 'Friend or rival' }, { id: 'heat', label: 'Lay low' }, { id: 'acquire', label: 'Acquire' }
  ];
  var DEFAULT_PICK = 'heat';
  var NOTE_MAX = 200;

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function clamp(v, n) { var s = str(v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim(); return s.length > n ? s.slice(0, n) : s; }
  function whole(v) { return typeof v === 'number' && isFinite(v) && v > 0 && Math.floor(v) === v; }
  function labelOf(id) { for (var i = 0; i < STEPS.length; i++) if (STEPS[i].id === id) return STEPS[i].label; return id; }
  function optLabel(id) { for (var i = 0; i < OPTIONS.length; i++) if (OPTIONS[i].id === id) return OPTIONS[i].label; return id; }

  function pendingOf(night) {
    var a = isObj(night) && isObj(night.aftermath) ? night.aftermath : {}, d = isObj(a.data) ? a.data : {};
    var have = str(d.pending).split(',').map(function (s) { return s.trim(); });
    return STEPS.map(function (s) { return s.id; }).filter(function (id) { return have.indexOf(id) >= 0; });
  }
  function finished(night) { return isObj(night) && isObj(night.aftermath) && night.aftermath.step === 'done'; }
  function morningAfter(nowMs) {
    var d = new Date(nowMs); d.setHours(MORNING_HOUR, 0, 0, 0);
    if (d.getTime() <= nowMs) d.setDate(d.getDate() + 1);
    return d.getTime();
  }
  function buildRow(o) {
    var steps = Array.isArray(o && o.steps) ? o.steps.filter(function (id) { return STEPS.some(function (s) { return s.id === id; }); }) : [];
    var sent = whole(o && o.sentAt) ? o.sentAt : 0, at = whole(o && o.nightAt) ? o.nightAt : sent;
    return { v: 1, nightAt: at, sentAt: sent, from: morningAfter(at || sent), due: (at || sent) + DUE_MS, steps: steps,
      options: (Array.isArray(o && o.options) && o.options.length ? o.options : OPTIONS).map(function (x) { return { id: clamp(x.id, 24), label: clamp(x.label, 40) }; }),
      defaults: { unwind: DEFAULT_PICK, xp: false, credits: '' } };
  }
  /* a reply as the phone writes it; anything else is dropped and every string is clamped, so a doctored row cannot put a wall of text on the panel */
  function cleanReply(raw) {
    if (!isObj(raw)) return null;
    var out = { at: whole(raw.at) ? raw.at : 0 };
    if (isObj(raw.unwind)) out.unwind = { pick: clamp(raw.unwind.pick, 24), note: clamp(raw.unwind.note, NOTE_MAX) };
    if (isObj(raw.xp)) out.xp = { ticked: raw.xp.ticked === true, note: clamp(raw.xp.note, NOTE_MAX) };
    if (isObj(raw.credits)) out.credits = { note: clamp(raw.credits.note, NOTE_MAX) };
    return out.unwind || out.xp || out.credits ? out : null;
  }
  function resolve(row, nowMs) {
    var r = isObj(row) ? row : {}, steps = Array.isArray(r.steps) ? r.steps : [], reply = cleanReply(r.reply);
    var due = whole(r.due) ? r.due : 0, from = whole(r.from) ? r.from : 0;
    var def = { unwind: { pick: DEFAULT_PICK, note: '' }, xp: { ticked: false, note: '' }, credits: { note: '' } };
    var state = reply ? 'answered' : due && nowMs >= due ? 'default' : from && nowMs < from ? 'waiting' : 'open';
    var eff = {};
    steps.forEach(function (id) { if (def[id]) eff[id] = reply && reply[id] ? reply[id] : def[id]; });
    return { state: state, due: due, from: from, left: due ? Math.max(0, due - nowMs) : 0, steps: steps, effective: eff, reply: reply };
  }
  function sentFor(night) {
    var n = isObj(night) ? night : {}, log = isObj(n.log) ? n.log : {}, after = isObj(n.phases) && isObj(n.phases.after) && whole(n.phases.after.start) ? n.phases.after.start : 0;
    return Object.keys(log).some(function (k) { var e = log[k]; return isObj(e) && str(e.text).indexOf('Debrief sent') === 0 && (!after || (+e.at || 0) >= after); });
  }
  function rollup(entries, nowMs) {
    var out = { answered: 0, defaults: 0, open: 0, waiting: 0 };
    (entries || []).forEach(function (e) { var r = resolve(e.json || e.row || e, nowMs); out[r.state === 'answered' ? 'answered' : r.state === 'default' ? 'defaults' : r.state] += 1; });
    return out;
  }

  function create(host) {
    host = host || {};
    var busy = false;
    function now() { return typeof host.now === 'function' ? host.now() : Date.now(); }
    function enabled() { return typeof host.enabled === 'function' ? host.enabled() === true : false; }
    function night() { var n = typeof host.night === 'function' ? host.night() : null; return n && typeof n.night === 'function' ? n : null; }
    function nightDoc() { var n = night(); return n ? n.night() : null; }
    function toast(m, bad) { if (typeof host.toast === 'function') host.toast(m, bad); }
    function pending() { return pendingOf(nightDoc()); }
    function afterStart() { var d = nightDoc(); return d && isObj(d.phases) && isObj(d.phases.after) && whole(d.phases.after.start) ? d.phases.after.start : 0; }

    function send(opts) {
      opts = opts || {};
      if (!enabled()) return Promise.resolve({ sent: 0, skipped: 0, steps: [], off: true });
      var steps = pending();
      if (!steps.length) return Promise.resolve({ sent: 0, skipped: 0, steps: [], none: true });
      if (busy) return Promise.resolve({ sent: 0, skipped: 0, steps: steps, busy: true });
      busy = true;
      var at = now(), start = afterStart(), nightAt = start || at, floor = start || at - FRESH_MS;
      return Promise.all([host.members(), host.docs.list(KIND)]).then(function (a) {
        var members = (a[0] || []).filter(function (m) { return m && m.id; }), have = {};
        (a[1] || []).forEach(function (d) { have[d.owner] = d.json; });
        var todo = members.filter(function (m) { var j = have[m.id]; return opts.force || !(isObj(j) && (+j.sentAt || 0) >= floor); });
        var skipped = members.length - todo.length;
        return Promise.all(todo.map(function (m) {
          var row = buildRow({ steps: steps, nightAt: nightAt, sentAt: at });
          return host.docs.put({ kind: KIND, owner: m.id, scope: 'player', json: row });
        })).then(function () {
          if (todo.length) { var n = night(); if (n) n.stamp('Debrief sent: ' + todo.length + ' player' + (todo.length === 1 ? '' : 's') + ', ' + steps.join(' ')); }
          return { sent: todo.length, skipped: skipped, steps: steps };
        });
      }).then(function (r) { busy = false; return r; }, function (e) { busy = false; toast('The Debrief did not send: ' + (e && e.message || 'try again'), true); return { sent: 0, skipped: 0, steps: steps, error: true }; });
    }
    /* resend: remove this night's rows, replies and all, then send again. Only the panel's confirmed button calls it */
    function again() {
      return host.docs.list(KIND).then(function (rows) {
        return Promise.all((rows || []).map(function (d) { return host.docs.del(KIND, d.owner); }));
      }).then(function () { return send({ force: true }); });
    }
    function replies() {
      return Promise.all([host.members(), host.docs.list(KIND)]).then(function (a) {
        var byOwner = {}, t = now();
        (a[1] || []).forEach(function (d) { byOwner[d.owner] = d.json; });
        return (a[0] || []).filter(function (m) { return m && m.id && isObj(byOwner[m.id]); }).map(function (m) {
          var r = resolve(byOwner[m.id], t);
          return { id: m.id, name: m.name || String(m.id).split('@')[0], state: r.state, reply: r.reply, effective: r.effective, steps: r.steps, due: r.due, from: r.from, left: r.left };
        });
      });
    }
    function tick() {
      if (!enabled() || busy) return Promise.resolve(null);
      var d = nightDoc();
      if (!d || !finished(d) || !pendingOf(d).length || sentFor(d)) return Promise.resolve(null);
      return send();
    }
    return { pending: pending, send: send, again: again, replies: replies, tick: tick, enabled: enabled };
  }

  /* ---------- the page (browser only): the Menu entry, the panel, and a quiet tick that sends once the Aftermath has finished ---------- */
  function jfetch(method, path, body) {
    var opts = { method: method, credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } };
    if (body !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(body); }
    return W.fetch('/api' + path, opts).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) { j = null; } throw new Error((j && j.error) || 'HTTP ' + res.status); });
      return res.json();
    });
  }
  function el(tag, cls, text) { var e = W.document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }
  function btn(label, fn, cls) { var b = el('button', 'btn sm' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.addEventListener('click', fn); return b; }   /* the app's button, as every tool's */

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
          members = (Array.isArray(j.members) ? j.members : []).filter(function (m) { return m && m.role === 'player'; }).map(function (m) { return { id: str(m.id), name: str(m.name) }; });
          memAt = Date.now(); return members;
        });
      },
      docs: {
        list: function (kind) { return jfetch('GET', '/docs?kind=' + encodeURIComponent(kind) + '&limit=200').then(function (j) { return Array.isArray(j.docs) ? j.docs : []; }); },
        put: function (row) { return jfetch('PUT', '/docs', row); },
        del: function (kind, owner) { return jfetch('DELETE', '/docs?kind=' + encodeURIComponent(kind) + '&owner=' + encodeURIComponent(owner)); }
      },
      toast: function (m, bad) { var f = feed(); if (f && typeof f.toast === 'function') f.toast(m, bad); },
      now: function () { return Date.now(); }
    });
    return ctl;
  }

  function when(ms) { var d = new Date(ms); return d.toLocaleString('en-AU', { weekday: 'short', hour: 'numeric', minute: '2-digit' }); }
  function paint(box) {
    while (box.firstChild) box.removeChild(box.firstChild);
    var c = controller(), steps = c.pending();
    box.appendChild(el('p', 'gm-dim', steps.length ? 'Steps left from the Aftermath: ' + steps.map(labelOf).join(', ') + '. Each player gets a card on their sheet at 07:00; defaults apply after 48 hours.' : 'Nothing is pending from the Aftermath.'));
    var row = el('div', 'seg');
    row.appendChild(btn('Send to phones', function () { c.send().then(function (r) { paint(box); if (r && r.skipped && !r.sent) box.appendChild(el('p', 'gm-dim', 'Already sent for this night.')); }); }, 'primary'));
    row.appendChild(btn('Refresh', function () { paint(box); }));
    row.appendChild(btn('Send again (clears replies)', function () { if (W.confirm && !W.confirm('Delete every Debrief row, replies included, and send fresh ones?')) return; c.again().then(function () { paint(box); }); }));
    box.appendChild(row);
    var list = el('div', 'gm-debrief-list'); box.appendChild(list);
    c.replies().then(function (rs) {
      if (!rs.length) { list.appendChild(el('p', 'gm-dim', 'No Debrief sent yet.')); return; }
      rs.forEach(function (r) {
        var card = el('div', 'gm-debrief-card'); card.style.margin = '8px 0';
        card.appendChild(el('b', '', r.name + ': ' + (r.state === 'answered' ? 'answered' : r.state === 'default' ? 'default applied' : r.state === 'waiting' ? 'shows ' + when(r.from) : 'open, due ' + when(r.due))));
        r.steps.forEach(function (id) {
          var e = r.effective[id]; if (!e) return;
          var t = id === 'unwind' ? optLabel(e.pick) : id === 'xp' ? (e.ticked ? 'xp ticked' : 'xp not ticked') : (e.note ? 'credit' : 'no credit');
          card.appendChild(el('div', 'gm-dim', labelOf(id) + ': ' + t + (e.note ? ' (' + e.note + ')' : '')));
        });
        list.appendChild(card);
      });
    }, function (e) { list.appendChild(el('p', 'gm-warn', 'Could not read the Debrief: ' + (e && e.message || 'try again'))); });
  }
  /* N2: the Menu line is gone (the shell places this tool, B68GmTools.get('debrief').open()); sync() only takes down a line an older page drew, and says false. */
  function sync(rootEl) {
    var cur = rootEl && typeof rootEl.querySelector === 'function' ? rootEl.querySelector('#gm-menu-debrief') : null;
    if (cur && cur.parentNode) cur.parentNode.removeChild(cur);
    return false;
  }
  function open(rootEl) {
    var Wk = W.B68GmWorkshop; if (!Wk || typeof Wk.sheet !== 'function') return null;
    var sh = Wk.sheet(rootEl, 'debrief', 'Debrief'); if (!sh) return null;
    paint(sh.body); sh.open(); return sh;
  }
  if (W && W.document && typeof W.setInterval === 'function') W.setInterval(function () { try { controller().tick(); } catch (e) { /* the page is not ready */ } }, TICK_MS);

  return { STEPS: STEPS, OPTIONS: OPTIONS, DUE_MS: DUE_MS, MORNING_HOUR: MORNING_HOUR, DEFAULT_PICK: DEFAULT_PICK, SWITCH: SWITCH, KIND: KIND,
    pendingOf: pendingOf, morningAfter: morningAfter, buildRow: buildRow, cleanReply: cleanReply, resolve: resolve, sentFor: sentFor, rollup: rollup, create: create, sync: sync, open: open };
});
