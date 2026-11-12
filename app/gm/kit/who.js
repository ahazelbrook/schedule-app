/* gm/kit/who.js: Start the night and the roster (night.who, the kit and stage build KS11; KS12 adds the roster's readers here).
   In the night-who bundle, fetched only while its setting is on. Window.B68GmWho in the browser, module.exports under Node
   (checks/runtime/night-who.test.mjs: the pure part, and the sheet on a fake page).

   THE ROSTER (the Gate 2 contract): one optional key on the campaign document,
     session.present = { <character id>: <session.startedAt> }
   An entry counts only while its value is the session's own startedAt, so a Start by any other path (the table page's button, an older
   release) leaves last night's roster inert by itself. No counting entry: no roster, and everyone is playing, as before the setting.
   KS12: extend roster() (present(), isPresent(), onChange()) here; never read session.present anywhere else.

   PURE
     roster(doc) -> null | { ids: [id], at }       the present characters of the open or last session, or null (everyone)
     isOpen(doc) -> bool                           a session is started and not ended
     startPatch(doc, o, env) -> a campaign patch   what the table's Start writes (session, the schedule's attendance through
                                                    Sm.onSessionStart, the log line), plus `present`. o: { number, present: [id] | { id: true },
                                                    attendance?: { <user id>: bool } }. The open session's own number carries it on: the
                                                    start time stays, the roster is rewritten (a player let go is null) and nothing is logged.
                                                    env: { iso (now, ISO), ms (now), me (the log line's author), Sm (B68Schedule) }
     endPatch(doc, env) -> patch | null            what the table's End writes: endedAt and the log line
     model(doc, chars, o) -> the sheet's model     chars: [{ id, name, owner }]; o: { names: { <owner>: name }, prep: '3.5' | '', Sm }
     attendanceOf(chars, ids) -> { <owner>: bool } who was here, by player, from the characters ticked
     summary(doc, chars, o) -> 'Session 5 · started 19:42 · 2 playing'    o: { hhmm(iso) }
     KS12, the one reader (roster() is its only way in):
     tidy(name) -> 'nell arbuthnot'                  join(pack, chars, roster) -> { all, chars: [{ id, name, owner, here }], pack: [{ name, id, here,
                                                    unmatched }], unmatched: [name] }   (all: no roster, everyone plays)
     presentIn(j, idOrNameOrObj) -> bool             awayOwners(j) -> [owner]   splitIn(j, list) -> { here, away }
     polaroidsOf(chars) -> [{ id, cap }]             the score scenes' polaroids (at most 8), from the characters playing
   DOM
     create(host) -> { paint(el), open(), close(), isOpen(), start(), end() -> Promise, destroy(),
                       present() -> join(...), isPresent(x), only(list), split(list), away() -> [owner], onChange(fn) -> off, sync() }
       host.pack() -> the pack's PCs [{ name, first }] (the Roll's Who chips' source). paint() also keeps the band's chip (#gm-bar-who, "2 playing")
       and tells onChange's listeners when who is playing changed.
       host: { root() -> #gm-root, campaign() -> doc | null, characters() -> [{ id, name, owner }], names(ids) -> Promise<{ id: name }>,
               prep() -> the open Prep note's session ('' when none), schedule() -> B68Schedule | null, start(o) -> Promise (boot's
               startSession), finish() -> Promise (boot's endSession), log(text) (the night log), go(place) (the places), restamp(n)
               (listening already on: its session follows), toast(msg, bad) }
       paint(el) fills [data-who-lead] (Before's one Primary) and [data-who-after] (After's line) inside el. The sheet is the page's right-edge
       sheet (.gm-sheet), and it closes on Esc through W.B68GmEsc (priority 45). Every string from a document goes in escaped. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmWho = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var MAX = 9999;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }
  function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
  function whole(v) { var n = Math.floor(+v); return isFinite(n) && n >= 1 && n <= MAX ? n : 0; }
  function sessOf(doc) { return isObj(doc) && isObj(doc.session) ? doc.session : {}; }
  function counter(doc) { return Math.max(0, Math.min(MAX, Math.floor(+sessOf(doc).number) || 0)); }

  /* ---------- the roster ---------- */
  function isOpen(doc) { var s = sessOf(doc); return counter(doc) > 0 && !!s.startedAt && !s.endedAt; }
  function roster(doc) {
    var s = sessOf(doc), at = str(s.startedAt), p = isObj(s.present) ? s.present : null;
    if (!at || !p) return null;
    var ids = Object.keys(p).filter(function (id) { return id && p[id] === at; }).sort();
    return ids.length ? { ids: ids, at: at } : null;
  }
  /* KS12.1, the one reader. The pack's PCs are known by name (the Roll's Who chips, the console's Aim at), the filed characters by id (the iPad's crew,
     the cards, the told lists). join() ties them on a tidied name: the whole name, else a first name that only one filed character has. A pack
     name no filed character matches counts as playing (and the Start sheet warns about it). No roster: everyone, as before the setting. */
  function tidy(s) {
    var t = str(s); if (t.normalize) t = t.normalize('NFKD');
    return t.replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function join(pack, chars, r) {
    var on = null; if (r && Array.isArray(r.ids)) { on = {}; r.ids.forEach(function (id) { on[id] = true; }); }
    var cs = (Array.isArray(chars) ? chars : []).filter(function (c) { return isObj(c) && str(c.id); }).map(function (c) {
      return { id: str(c.id), name: str(c.name).trim(), owner: str(c.owner), t: tidy(c.name), here: !on || on[str(c.id)] === true };
    });
    var byName = {}, byFirst = {};
    cs.forEach(function (c) { if (c.t && !byName[c.t]) byName[c.t] = c; var f = c.t.split(' ')[0]; if (f) (byFirst[f] = byFirst[f] || []).push(c); });
    var pk = (Array.isArray(pack) ? pack : []).map(function (p) {
      var name = str(isObj(p) ? p.name : p).trim(), t = tidy(name); if (!t) return null;
      var c = byName[t], f = tidy(isObj(p) && p.first ? p.first : '') || t.split(' ')[0], l = byFirst[f];
      if (!c && l && l.length === 1) c = l[0];
      return { name: name, t: t, id: c ? c.id : null, here: c ? c.here : true, unmatched: !c };
    }).filter(Boolean);
    return { all: !on, chars: cs, pack: pk, unmatched: pk.filter(function (p) { return p.unmatched; }).map(function (p) { return p.name; }) };
  }
  /* is this one playing? x: a character id, a name (pack or filed), or an object carrying id / value / name. Anyone unknown counts as playing */
  function presentIn(j, x) {
    if (!j || j.all) return true;
    var id = isObj(x) ? str(x.id) : str(x), i;
    for (i = 0; i < j.chars.length; i++) if (id && j.chars[i].id === id) return j.chars[i].here;
    var t = tidy(isObj(x) ? x.value || x.name || x.label : x); if (!t) return true;
    for (i = 0; i < j.chars.length; i++) if (j.chars[i].t === t) return j.chars[i].here;
    for (i = 0; i < j.pack.length; i++) if (j.pack[i].t === t) return j.pack[i].here;
    return true;
  }
  /* the players who are not here: every owner of a filed character none of whose characters is playing (nobody while there is no roster) */
  function awayOwners(j) {
    if (!j || j.all) return [];
    var any = {}, here = {};
    j.chars.forEach(function (c) { if (!c.owner) return; any[c.owner] = true; if (c.here) here[c.owner] = true; });
    return Object.keys(any).filter(function (o) { return !here[o]; }).sort();
  }
  function splitIn(j, list) {
    var out = { here: [], away: [] };
    (Array.isArray(list) ? list : []).forEach(function (x) { (presentIn(j, x) ? out.here : out.away).push(x); });
    return out;
  }
  function idList(present) {
    if (Array.isArray(present)) return present.map(str).filter(Boolean);
    return isObj(present) ? Object.keys(present).filter(function (k) { return k && present[k]; }) : [];
  }

  /* ---------- the writes ---------- */
  /* the schedule's changed leaves, a removed key as null (the table page's diff: the PATCH deletes it) */
  function diff(a, b) {
    if (same(a, b)) return undefined;
    if (isObj(a) && isObj(b)) {
      var out = {}, any = false;
      Object.keys(b).forEach(function (k) { var d = diff(a[k], b[k]); if (d !== undefined) { out[k] = d; any = true; } });
      Object.keys(a).forEach(function (k) { if (!has(b, k) && a[k] != null) { out[k] = null; any = true; } });
      return any ? out : undefined;
    }
    return b == null ? (a == null ? undefined : null) : clone(b);
  }
  function logLine(doc, text, env) {
    var old = isObj(doc) && Array.isArray(doc.log) ? doc.log.filter(isObj) : [];
    return [{ at: str(env.iso), by: env.me || null, text: text }].concat(clone(old)).slice(0, 200);
  }
  /* present: every id ticked gets the start time; an id stored before and not ticked now is null (the PATCH deletes it) */
  function presentMap(doc, ids, at) {
    var old = isObj(sessOf(doc).present) ? sessOf(doc).present : {}, out = {};
    Object.keys(old).forEach(function (k) { out[k] = null; });
    ids.forEach(function (id) { out[id] = at; });
    return out;
  }
  function startPatch(doc, o, env) {
    o = o || {}; env = env || {};
    var s = sessOf(doc), ids = idList(o.present), cur = counter(doc);
    var n = whole(o.number) || cur + 1, carry = isOpen(doc) && n === cur, at = carry ? str(s.startedAt) : str(env.iso), out = {};
    out.session = { number: n, startedAt: at, endedAt: null, present: presentMap(doc, ids, at) };
    var Sm = env.Sm, before = Sm && Sm.normalize ? Sm.normalize(isObj(doc) ? doc.schedule : null) : null, after = before ? clone(before) : null;
    if (after && !carry && Sm.onSessionStart) Sm.onSessionStart(after, +env.ms || Date.now(), n);       /* the table's own: next's answers become session n's attendance */
    if (after && isObj(o.attendance)) {
      /* KS12.0: the ticks go OVER the session's record (the RSVPs onSessionStart made, or a carried-on night's), so a player who said yes and has
         no filed character stays; the GM's own address (a character the GM filed) is never marked */
      var att = isObj(after.attendance) ? after.attendance : {}, base = isObj(att[String(n)]) ? att[String(n)] : {}, rec = {}, any = false;
      Object.keys(o.attendance).forEach(function (u) { if (u && u !== str(env.me) && typeof o.attendance[u] === 'boolean') { rec[u] = o.attendance[u]; any = true; } });
      Object.keys(base).forEach(function (u) { if (!has(rec, u)) rec[u] = base[u]; });      /* the ticks first (as before), then the record's others */
      if (any) { after.attendance = att; after.attendance[String(n)] = rec; }
    }
    var sd = before ? diff(before, after) : undefined;
    if (sd) out.schedule = sd;
    if (!carry) out.log = logLine(doc, 'Session ' + n + ' started', env);
    return out;
  }
  function endPatch(doc, env) {
    env = env || {};
    if (!isOpen(doc)) return null;
    var s = sessOf(doc), n = counter(doc);
    return { session: { number: n, startedAt: str(s.startedAt), endedAt: str(env.iso) }, log: logLine(doc, 'Session ' + n + ' ended', env) };
  }

  /* ---------- the sheet's model ---------- */
  function ownerName(owner, names) { var n = isObj(names) ? str(names[owner]).trim() : ''; return n || str(owner).split('@')[0]; }
  /* the answers for the next session, while the schedule has one: { <owner>: 'in' | 'out' } or null */
  function rsvpOf(doc, Sm) {
    var sc = Sm && Sm.normalize ? Sm.normalize(isObj(doc) ? doc.schedule : null) : null, out = {}, any = false;
    if (!sc || !sc.next || !isObj(sc.rsvp)) return null;
    var at = Date.parse(str(sc.next.at));      /* an answer counts for the next session only (schedule.js rsvpOf: its `at` is that session's) */
    Object.keys(sc.rsvp).forEach(function (u) { var r = sc.rsvp[u]; if (isObj(r) && (r.v === 'in' || r.v === 'out') && Date.parse(str(r.at)) === at) { out[u] = r.v; any = true; } });
    return any ? out : null;
  }
  /* the ticks: the open session's roster; else the RSVPs (everyone but a no); else everyone */
  function model(doc, chars, o) {
    o = o || {};
    var list = (Array.isArray(chars) ? chars : []).filter(function (c) { return isObj(c) && str(c.id); });
    var open = isOpen(doc), cur = counter(doc), r = open ? roster(doc) : null, rs = r ? null : rsvpOf(doc, o.Sm), from = r ? 'roster' : rs ? 'rsvp' : 'all';
    var rows = list.map(function (c) {
      var id = str(c.id), owner = str(c.owner), on = r ? r.ids.indexOf(id) >= 0 : rs ? rs[owner] !== 'out' : true;
      return { id: id, name: str(c.name).trim() || 'Unnamed', owner: owner, player: owner ? ownerName(owner, o.names) : '', on: on, rsvp: rs && owner ? rs[owner] || '' : '' };
    });
    var number = open ? cur : cur + 1, prep = str(o.prep).trim();
    return { open: open, carry: open ? cur : 0, counter: cur, number: number, prep: prep && prep !== String(number) ? prep : '', from: from, rows: rows };
  }
  function attendanceOf(chars, ids) {
    var out = {};
    (Array.isArray(chars) ? chars : []).forEach(function (c) {
      var owner = isObj(c) ? str(c.owner) : ''; if (!owner) return;
      out[owner] = out[owner] === true || ids.indexOf(str(c.id)) >= 0;
    });
    return out;
  }
  function hhmmOf(iso) { var t = Date.parse(str(iso)); if (!t) return ''; var d = new Date(t), p = function (n) { return (n < 10 ? '0' : '') + n; }; return p(d.getHours()) + ':' + p(d.getMinutes()); }
  function summary(doc, chars, o) {
    o = o || {};
    var n = counter(doc), s = sessOf(doc), hm = typeof o.hhmm === 'function' ? o.hhmm : hhmmOf;
    if (!n || !s.startedAt) return 'No session started yet';
    var r = roster(doc), count = r ? r.ids.length : (Array.isArray(chars) ? chars.length : 0);
    return ['Session ' + n, 'started ' + hm(s.startedAt), s.endedAt ? 'ended ' + hm(s.endedAt) : '', count + ' playing'].filter(Boolean).join(' · ');
  }

  /* ---------- the page ---------- */
  /* the buttons are the UI kit's (B68Ui, app/ui/ui.js: the kit-ui bundle loads before this one). They keep the old classes (btn, primary, gm-x,
     gm-pill): with night.who alone the page's old sheets style them, as before; with kit.desk the kit's own look does (KS02, layer rule 3) */
  function Ui() { return W && W.B68Ui ? W.B68Ui : null; }
  function btn(o) { var U = Ui(); return U ? U.button(o) : ''; }
  function create(host) {
    host = host || {};
    var st = { el: null, open: false, m: null, ticks: {}, num: '', busy: false, gone: false, escOff: null, names: {}, asked: {}, chip: null };
    function call(name, a) { var f = host[name]; if (typeof f !== 'function') return undefined; try { return f(a); } catch (e) { return undefined; } }
    function doc() { return call('campaign') || null; }
    function chars() { var c = call('characters'); return Array.isArray(c) ? c : []; }
    function Sm() { return call('schedule') || (W && W.B68Schedule) || null; }
    function doc0() { return W && W.document; }

    function leadHtml() {
      var d = doc(), m = model(d, chars(), { Sm: Sm() }), r = roster(d);
      var line = m.open ? 'Session ' + m.carry + ' is open' + (r ? ' · ' + r.ids.length + ' playing' : '') : 'Pick who is playing · session ' + m.number;
      var label = m.open ? 'Carry on session ' + m.carry : 'Start the night';      /* KS12.0: an open session is carried on, not started */
      return btn({ label: label, rank: 'primary', cls: ['btn', 'primary'], data: { who: 'open' }, attrs: { 'aria-haspopup': 'dialog' },
        title: m.open ? 'Who is here: add a late arrival or let someone go' : 'Pick who is playing, then start the session' }) + '<span class="who-lead-sub">' + esc(line) + '</span>';
    }

    /* ---- KS12.1: the one reader, for the page's other parts ---- */
    function pack() { var p = call('pack'); return Array.isArray(p) ? p : []; }
    function joined() { return join(pack(), chars(), roster(doc())); }
    var heard = [], sig = 'all';
    function sigOf(j) { return j.all ? 'all' : JSON.stringify([j.chars.map(function (c) { return c.id + (c.here ? '+' : '-'); }), j.unmatched]); }
    /* tell the listeners when who is playing changed (a Start, a late arrival, a player let go, a character filed); no roster and none before: silent */
    function sync() {
      var s = sigOf(joined()); if (s === sig) return false;
      sig = s;
      heard.slice().forEach(function (fn) { try { fn(); } catch (e) { /* one listener's fault stays its own */ } });
      return true;
    }
    function onChange(fn) {
      if (typeof fn !== 'function') return function () {};
      heard.push(fn);
      return function () { heard = heard.filter(function (f) { return f !== fn; }); };
    }

    /* ---- KS12.7: the band's chip, "2 playing": the page's #gm-bar-who when the band has one, else one placed after the session chip ---- */
    function chip() {
      var d = doc0(); if (!d || !d.getElementById) return;
      var c = d.getElementById('gm-bar-who');
      if (!c) {
        var sess = d.getElementById('gm-bar-sess'), U = Ui(); if (!sess || !sess.parentNode || !U || typeof U.node !== 'function') return;
        c = U.node('button', { label: '', rank: 'quiet', id: 'gm-bar-who', cls: ['gm-pill', 'who-chip'] }, d);
        sess.parentNode.insertBefore(c, sess.nextSibling); st.chip = c;
      }
      if (!c.__whoBound) { c.__whoBound = true; c.setAttribute('aria-haspopup', 'dialog'); c.addEventListener('click', onChipClick); }
      var r = roster(doc()), n = r ? r.ids.length : chars().length, t = n + ' playing';
      if (c.textContent !== t) c.textContent = t;
      c.title = 'Who is here: add a late arrival or let someone go';
    }
    function onChipClick(ev) { if (ev && ev.preventDefault) ev.preventDefault(); if (ev && ev.stopPropagation) ev.stopPropagation(); open(); }

    function paint(el) {
      if (st.gone) return;
      if (el && el.querySelectorAll) {
        Array.prototype.forEach.call(el.querySelectorAll('[data-who-lead]'), function (n) { var h = leadHtml(); if (n.setAttribute && !n.hasAttribute('data-ui-scope')) n.setAttribute('data-ui-scope', ''); if (n.__who !== h) { n.__who = h; n.innerHTML = h; } });      /* the kit's parts work here without data-kit (KS02b) */
        Array.prototype.forEach.call(el.querySelectorAll('[data-who-after]'), function (n) { var t = summary(doc(), chars()); if (n.textContent !== t) n.textContent = t; });
      }
      chip();
      if (st.open) draw();
      sync();
    }

    /* the sheet: the page's right-edge sheet */
    function sheet() {
      var d = doc0(), page = call('root') || (d && (d.getElementById('gm-page') || d.body)); if (!page) return null;      /* in #gm-root, as the workshop's sheets: under the band (--dw-top) */
      if (st.el) { if (st.el.parentNode !== page && page.appendChild) page.appendChild(st.el); return st.el; }
      var el = d.createElement('section');
      el.className = 'gm-sheet who-sheet'; el.id = 'gm-who-sheet'; el.hidden = true;
      el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Start the night'); el.setAttribute('data-ui-scope', '');      /* KS02b: a kit scope on the old page */
      el.addEventListener('click', onClick); el.addEventListener('input', onInput); el.addEventListener('keydown', onKey);
      page.appendChild(el); st.el = el;
      var U = Ui(); if (U && typeof U.guardBusy === 'function') U.guardBusy(el);      /* Start is busy while it writes: a second press is cancelled */
      return el;
    }
    /* a row: one toggle (B68Ui.button, aria-pressed). Its words are its label, so the markup alone says it all; dress() then lays the same words out
       as the tick, the name over the player, and the state, with text nodes only */
    function subOf(r) { return [r.player, r.rsvp === 'in' ? 'said yes' : r.rsvp === 'out' ? 'said no' : ''].filter(Boolean).join(' · '); }
    function rowHtml(r) {
      var on = !!st.ticks[r.id], sub = subOf(r);
      return btn({ label: [r.name, sub, on ? 'Playing' : 'Not here'].filter(Boolean).join(' · '), cls: 'who-row', data: { 'who-pc': r.id }, pressed: on });
    }
    function dress(el) {
      var d = doc0(); if (!d || !d.createElement || !el.querySelectorAll || !st.m) return;
      var byId = {}; st.m.rows.forEach(function (r) { byId[r.id] = r; });
      Array.prototype.forEach.call(el.querySelectorAll('.who-row[data-who-pc]'), function (b) {
        var r = byId[b.getAttribute('data-who-pc')]; if (!r) return;
        var on = !!st.ticks[r.id], sub = subOf(r), part = function (tag, cls, text) { var e = d.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
        var tick = part('span', 'who-tick'), name = part('span', 'who-name');
        tick.setAttribute('aria-hidden', 'true'); name.appendChild(part('b', '', r.name)); if (sub) name.appendChild(part('small', '', sub));
        b.textContent = ''; b.appendChild(tick); b.appendChild(name); b.appendChild(part('span', 'who-state', on ? 'Playing' : 'Not here'));
      });
    }
    function numberNow() { return whole(st.num) || st.m.number; }
    function primaryLabel() { var n = numberNow(); return st.m.open && n === st.m.carry ? 'Carry on session ' + n : 'Start session ' + n; }
    function numLine(m) {
      var bits = [m.open ? 'Session ' + m.carry + ' is open: keep its number to carry it on' : 'The table’s counter is ' + m.counter];
      if (m.prep) bits.push('the Prep note says ' + m.prep);
      return bits.join(' · ');
    }
    function count(m) { return m.rows.filter(function (r) { return st.ticks[r.id]; }).length; }
    function draw() {
      var el = sheet(); if (!el) return;
      var m = st.m = model(doc(), chars(), { names: st.names, prep: call('prep'), Sm: Sm() });
      m.rows.forEach(function (r) { if (!has(st.ticks, r.id)) st.ticks[r.id] = r.on; });
      var hint = !m.rows.length ? 'No characters are filed yet: the night starts with everyone.' : m.from === 'roster' ? 'Ticked: who is playing now.' : m.from === 'rsvp' ? 'Ticked from the RSVPs: everyone but a no.' : 'Ticked: everyone. Untick who is not here.';
      var un = joined().unmatched, title = m.open ? 'Who is here' : 'Start the night';      /* KS12.1: a pack PC no filed character matches */
      var warn = un.length ? '<p class="who-warn" role="note"><b>Not filed:</b> ' + esc(un.join(', ')) + '. The pack has ' + (un.length === 1 ? 'this PC' : 'these PCs') + ' but no filed character has the name, so ' + (un.length === 1 ? 'it counts' : 'they count') + ' as playing.</p>' : '';
      var h = '<div class="gm-dhead"><h2 class="gm-sheet-h">' + title + '</h2>' + btn({ label: '×', rank: 'quiet', cls: 'gm-x', data: { who: 'close' }, attrs: { 'aria-label': 'Close ' + title }, title: 'Close (Esc)' }) + '</div>' +
        '<div class="gm-sheet-body who-body">' +
        '<p class="who-hint">' + esc(hint) + '</p>' + warn +
        '<div class="who-rows" role="group" aria-label="Who is playing">' + m.rows.map(rowHtml).join('') + '</div>' +
        '<div class="who-num"><label class="who-num-l" for="who-n">Session</label><input id="who-n" class="who-n" type="number" inputmode="numeric" min="1" max="9999" step="1" data-who-n value="' + esc(st.num || String(m.number)) + '">' +
        '<span class="who-num-sub">' + esc(numLine(m)) + '</span></div>' +
        '<div class="who-go">' + btn({ label: primaryLabel(), rank: 'primary', cls: ['btn', 'primary'], data: { who: 'start' }, busy: st.busy }) + '<span class="who-count" role="status">' + count(m) + ' playing</span></div></div>';
      if (el.__who === h) return;
      var d = doc0(), f = d && d.activeElement;
      if (f && f.hasAttribute && f.hasAttribute('data-who-n') && el.contains(f)) { patchLive(el, m); return; }       /* typing the number: the caret stays */
      var focusPc = f && f.getAttribute && el.contains(f) ? f.getAttribute('data-who-pc') : null;
      el.__who = h; el.innerHTML = h; dress(el);
      if (focusPc) { var b = el.querySelector('[data-who-pc="' + focusPc.replace(/["\\]/g, '\\$&') + '"]'); if (b && b.focus) { try { b.focus({ preventScroll: true }); } catch (e) {} } }
    }
    function patchLive(el, m) {
      el.__who = '';
      var b = el.querySelector('[data-who="start"]'); if (b && b.textContent !== primaryLabel()) b.textContent = primaryLabel();
      var c = el.querySelector('.who-count'); if (c) c.textContent = count(m) + ' playing';
    }
    function askNames() {
      var owners = chars().map(function (c) { return str(c.owner); }).filter(function (o) { return o && !st.asked[o]; });
      if (!owners.length || typeof host.names !== 'function') return;
      owners.forEach(function (o) { st.asked[o] = true; });
      Promise.resolve().then(function () { return host.names(owners); }).then(function (map) {
        if (!isObj(map)) return; Object.keys(map).forEach(function (k) { var v = map[k]; st.names[k] = typeof v === 'string' ? v : isObj(v) ? str(v.name) : ''; });
        if (st.open) draw();
      }, function () {});
    }
    function open() {
      if (st.gone) return false;
      st.ticks = {}; st.num = ''; st.busy = false; st.open = true;
      var el = sheet(); if (!el) return false;
      draw(); el.hidden = false; askNames();
      var go = el.querySelector('[data-who="start"]'); if (go && go.focus) { try { go.focus({ preventScroll: true }); } catch (e) {} }
      return true;
    }
    function close() { if (!st.open) return; st.open = false; if (st.el) st.el.hidden = true; }
    function start() {
      if (st.busy || !st.m) return Promise.resolve(false);
      var m = st.m, n = numberNow(), ids = m.rows.filter(function (r) { return st.ticks[r.id]; }).map(function (r) { return r.id; });
      if (m.rows.length && !ids.length) { call('toast', 'Tick at least one player.'); return Promise.resolve(false); }
      if (typeof host.start !== 'function') { call('toast', 'The table is not available here.', true); return Promise.resolve(false); }
      var carry = m.open && n === m.carry, list = chars();
      st.busy = true; draw();
      return Promise.resolve().then(function () { return host.start({ number: n, present: ids, attendance: list.length ? attendanceOf(list, ids) : null }); }).then(function () {
        st.busy = false;
        call('log', 'Session ' + n + (carry ? ' carried on' : ' started') + ' · ' + ids.length + ' playing');
        call('restamp', n);
        close(); call('go', 'opening');
        call('toast', (carry ? 'Session ' + n + ' carries on' : 'Session ' + n + ' started') + ': ' + ids.length + ' playing.');
        return true;
      }, function (e) { st.busy = false; draw(); call('toast', 'Could not start the night: ' + str(e && e.message || e), true); return false; });
    }
    function end() {
      if (!isOpen(doc()) || typeof host.finish !== 'function') return Promise.resolve(false);
      return Promise.resolve().then(function () { return host.finish(); }).then(function () { return true; }, function (e) { call('toast', 'Could not end the session: ' + str(e && e.message || e), true); return false; });
    }
    function onClick(ev) {
      var t = ev.target, b = t && t.closest ? t.closest('[data-who-pc], [data-who]') : null; if (!b) return;
      ev.preventDefault();
      var pc = b.getAttribute('data-who-pc');
      if (pc) { st.ticks[pc] = !st.ticks[pc]; draw(); return; }
      var a = b.getAttribute('data-who');
      if (a === 'close') close(); else if (a === 'start') start();
    }
    function onInput(ev) { var t = ev.target; if (t && t.hasAttribute && t.hasAttribute('data-who-n')) { st.num = str(t.value).trim(); draw(); } }
    function onKey(ev) { var t = ev.target; if (ev.key === 'Enter' && t && t.hasAttribute && t.hasAttribute('data-who-n')) { ev.preventDefault(); start(); } }
    /* Before's lead: a click in the page's root on [data-who="open"] */
    function onRootClick(ev) { var t = ev.target, b = t && t.closest ? t.closest('[data-who="open"]') : null; if (!b) return; ev.preventDefault(); open(); }
    var bound = call('root'); if (bound && bound.addEventListener) bound.addEventListener('click', onRootClick);
    (function escape() {
      var E = W && W.B68GmEsc; if (!E || typeof E.register !== 'function') return;
      try { st.escOff = E.register('who.sheet', { priority: 45, isOpen: function () { return !st.gone && st.open; }, close: close }); } catch (e) { st.escOff = null; }
    })();
    function destroy() {
      st.gone = true; close();
      if (bound && bound.removeEventListener) bound.removeEventListener('click', onRootClick);
      if (st.escOff) { try { st.escOff(); } catch (e) { /* gone */ } }
      if (st.el && st.el.parentNode) st.el.parentNode.removeChild(st.el);
      st.el = null;
      var d = doc0(), c = d && d.getElementById ? d.getElementById('gm-bar-who') : null;      /* KS12.7: the chip this made goes; the band's own is unbound */
      if (c) { if (c.removeEventListener) c.removeEventListener('click', onChipClick); c.__whoBound = false; if (c === st.chip && c.parentNode) c.parentNode.removeChild(c); }
      st.chip = null; heard = [];
    }
    return { paint: paint, open: open, close: close, isOpen: function () { return st.open; }, start: start, end: end, destroy: destroy,
      /* KS12.1: the one reader */
      present: function () { return joined(); },
      isPresent: function (x) { return presentIn(joined(), x); },
      only: function (list) { var j = joined(); return j.all ? list : splitIn(j, list).here; },
      split: function (list) { return splitIn(joined(), list); },
      away: function () { return awayOwners(joined()); },
      onChange: onChange, sync: sync };
  }

  /* KS12.5: the score scenes' polaroids, from who is playing: [{ id: the cast canon's id (a first name, tidied), cap }], at most 8. The display draws only
     the ids its cast canon has a figure for, and sets each caption as text */
  var POLAROID_MAX = 8, CAP_MAX = 60;
  function polaroidsOf(list) {
    var out = [], seen = {};
    (Array.isArray(list) ? list : []).forEach(function (c) {
      if (!isObj(c) || out.length >= POLAROID_MAX) return;
      var id = tidy(c.name).split(' ')[0], cap = (str(c.alias).trim() || str(c.name).trim()).replace(/\s+/g, ' ').slice(0, CAP_MAX);
      if (!/^[a-z0-9]{1,40}$/.test(id) || seen[id]) return;
      seen[id] = true; out.push({ id: id, cap: cap });
    });
    return out;
  }

  return { roster: roster, isOpen: isOpen, startPatch: startPatch, endPatch: endPatch, model: model, attendanceOf: attendanceOf, summary: summary, create: create,
    tidy: tidy, join: join, presentIn: presentIn, awayOwners: awayOwners, splitIn: splitIn, polaroidsOf: polaroidsOf };
});
