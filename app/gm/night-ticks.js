/* gm/night-ticks.js: a stamped consequence ticks its clock (RK03 of the room key build; setting night.flow). In the night-flow bundle (app/routes.js),
   fetched only while the setting is on, so with it off nothing here is asked for, drawn or called.

   WHAT IT DOES
     The Roll gets a small "Tick a clock" control under the stamp: On 1-3 [clock] [+n] and On 4/5 [clock] [+n]. When a 1-3 or a 4/5 is marked on a
     stamped roll (gm-page.js b09Marked, before the stamp is marked), the row for that result ticks its table clock by n: one absolute clockOps
     { id, filled } (B68GmBladeChips.tick, RK04: race-safe as map-spotted.js, capped at the clock's size), a toast with Undo, a night-log line.
       once      a stamp ticks at most once, whatever is marked after it (the key is the stamp's own `at`, view().active.at, which stamp.js gives
                 only while this setting is on). A roll marked with no stamp up ticks nothing. Clean, a 6 and a crit never tick.
       prefill   both rows start from the first of: a `▶ tick: <clock> / <n>` span in the Roll's line as typed; one in the room's own "If it goes
                 wrong" lines (the raw Markdown: the Roll's seeded line has its spans stripped already); else the running play's alarm clock, +1.
                 In Blades the threatened consequence lands on a 4/5 too, so both rows start the same; either can be set to No tick.
                 What the GM picks is kept (in this page only) until the roll is marked.
       sure      a name ticks a clock only on a sure match (RK04's rule): the clock's own name, case and punctuation aside, or it without a leading
                 a, an or the, or without a trailing "clock". A loose-only match ("House alarms") never ticks: the row says "No clock called X",
                 and marking says so again in a toast, naming the near one.
       secrecy   nothing here goes to the iPad or a phone. The stamp's payload drops action spans (stamp.js, with this setting on), so a typed span
                 never shows; a hidden clock is ticked like any other and only the GM page says so.

   API (window.B68GmNightTicks, or module.exports under Node)
     PURE   names(s) -> [folded forms]          sure(name, clocks) -> { hit } | { many: [c] } | { none: true, loose?: clock }
            wrongMd(md) -> the room's "If it goes wrong" lines as written (spans kept; fences skipped)
            roomMd(roomNotes, room, normFn) -> that room's Markdown | ''
            prefill({ line, room, alarm }) -> { name, n, from: 'line' | 'room' | 'alarm' } | null
            rows(pre, clocks, pick) -> { '13': row, '45': row }    row = { id, n, picked, miss?, loose?, many? }
     create(host) -> { paint(box, on, view), marked(situation, view) -> Promise<result>, rows(), pick(r, id, n), reset() }
       host: { clocks(), line(), roomNotes(), room(), normRoom(s)?, alarm(), tickHost() (the page's paHost), log(text), toast(msg, bad), doc(), changed() }
   ES5, as the files beside it. Every string from the table or a note goes in as text. Nothing is stored. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmNightTicks = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var SIT = { onetothree: '13', fourfive: '45' }, ROWS = ['13', '45'], WORDS = { '13': 'On 1–3', '45': 'On 4/5' }, N_MAX = 12, N_OFFER = 4;
  var LABEL = /^\s*(?:>\s*)*(?:#{1,6}\s+)?(?:[-*+]\s+)?(?:\*\*|__)?\s*if it goes wrong\b/i;
  var FENCE = /^ {0,3}(`{3,}|~{3,})/;

  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function words(s) { return str(s).replace(/\s+/g, ' ').trim(); }
  function plain(s, n) { var t = words(s); return t.length > n ? t.slice(0, n - 1) + '…' : t; }
  function whole(v, lo, hi) { var n = Math.floor(+v); return isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo; }
  function chips() {
    var C = W && W.B68GmBladeChips;
    if (!C && typeof require === 'function') { try { C = require('./blade-chips.js'); } catch (e) { C = null; } }
    return C && typeof C.tick === 'function' ? C : null;
  }

  /* ---------- the sure match ---------- */
  function norm(s) {
    var t = str(s);
    try { t = t.normalize('NFKD').replace(/[̀-ͯ]/g, ''); } catch (e) { /* no normalize: as written */ }
    return t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }
  /* the forms a name is sure under: as written, without a leading a/an/the, without a trailing "clock", both; spaces gone */
  function names(s) {
    var n = norm(s), out = [];
    if (!n) return out;
    [n, n.replace(/ clocks?$/, '')].forEach(function (x) {
      [x, x.replace(/^(?:the|a|an) /, '')].forEach(function (y) { y = y.replace(/ /g, ''); if (y && out.indexOf(y) < 0) out.push(y); });
    });
    return out;
  }
  function sure(name, clocks) {
    var l = (Array.isArray(clocks) ? clocks : []).filter(isObj), want = names(name);
    if (!want.length) return { none: true };
    var hits = l.filter(function (c) { return names(c.name).some(function (f) { return want.indexOf(f) >= 0; }); });
    if (hits.length === 1) return { hit: hits[0] };
    if (hits.length > 1) return { many: hits };
    var C = chips(), m = C && typeof C.matchClock === 'function' ? C.matchClock(str(name), l) : null;
    return m && m.hit ? { none: true, loose: m.hit } : { none: true };
  }

  /* ---------- the prefill ---------- */
  function wrongMd(md) {
    var out = [], fence = null, under = false, lines = str(md).replace(/\r\n?/g, '\n').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i], f = FENCE.exec(ln);
      if (fence) { if (f && f[1].charAt(0) === fence.charAt(0) && f[1].length >= fence.length) fence = null; continue; }
      if (f) { fence = f[1]; under = false; continue; }
      if (LABEL.test(ln)) { out.push(ln); under = true; continue; }
      if (under) { if (!/\S/.test(ln) || /^\s*#{1,6}\s/.test(ln)) under = false; else out.push(ln); }
    }
    return out.join('\n');
  }
  function roomMd(roomNotes, room, normFn) {
    if (!isObj(roomNotes) || !isObj(roomNotes.byRoom) || !str(room)) return '';
    var nf = typeof normFn === 'function' ? normFn : function (x) { return norm(x).replace(/^the /, ''); }, want = nf(room), keys = Object.keys(roomNotes.byRoom);
    for (var i = 0; i < keys.length; i++) {
      if (keys[i] === room || nf(keys[i]) === want) return isObj(roomNotes.byRoom[keys[i]]) ? str(roomNotes.byRoom[keys[i]].md) : '';
    }
    return '';
  }
  function prefill(o) {
    o = isObj(o) ? o : {};
    var C = chips(), t = C ? C.findTick(o.line) : null;
    if (t) return { name: t.name, n: t.n, from: 'line' };
    t = C ? C.findTick(wrongMd(o.room)) : null;
    if (t) return { name: t.name, n: t.n, from: 'room' };
    var a = words(o.alarm);
    return a ? { name: a, n: 1, from: 'alarm' } : null;
  }
  /* each row: the GM's pick, else the prefill matched surely to a table clock (a miss keeps the name it was given, to say so) */
  function rows(pre, clocks, pick) {
    var l = (Array.isArray(clocks) ? clocks : []).filter(isObj), base = { id: '', n: 1, picked: false };
    if (pre) {
      var m = sure(pre.name, l);
      base = m.hit ? { id: str(m.hit.id), n: whole(pre.n, 1, N_MAX), picked: false }
        : { id: '', n: whole(pre.n, 1, N_MAX), miss: pre.name, loose: m.loose ? str(m.loose.name) : '', many: !!m.many, picked: false };
    }
    var out = {};
    ROWS.forEach(function (r) {
      var p = isObj(pick) ? pick[r] : null;
      if (p && (!p.id || l.some(function (c) { return str(c.id) === p.id; }))) out[r] = { id: str(p.id), n: whole(p.n, 1, N_MAX), picked: true };
      else out[r] = Object.assign({}, base);
    });
    return out;
  }
  function missText(row) {
    if (row.many) return 'Two clocks are called “' + plain(row.miss, 40) + '”: nothing ticked. Pick one in the Roll.';
    return 'No clock called “' + plain(row.miss, 40) + '” on the table: nothing ticked.' + (row.loose ? ' Did you mean “' + plain(row.loose, 40) + '”?' : '');
  }

  /* ---------- the controller ---------- */
  function create(host) {
    host = host || {};
    var pick = {}, done = {}, el = null, sig = '';
    function call(k, d) { try { return typeof host[k] === 'function' ? host[k]() : d; } catch (e) { return d; } }
    function clocks() { var l = call('clocks', []); return (Array.isArray(l) ? l : []).filter(isObj); }
    function toast(m, bad) { if (typeof host.toast === 'function') host.toast(m, !!bad); }
    function log(t) { if (typeof host.log === 'function') { try { host.log(t); } catch (e) { /* no night log */ } } }
    function pre() {
      var nf = typeof host.normRoom === 'function' ? host.normRoom : null;
      return prefill({ line: call('line', ''), room: roomMd(call('roomNotes', null), call('room', ''), nf), alarm: call('alarm', '') });
    }
    function rowsNow() { return rows(pre(), clocks(), pick); }
    function setPick(r, id, n) {
      if (ROWS.indexOf(r) < 0) return;
      pick[r] = { id: str(id), n: whole(n, 1, N_MAX) };
      if (typeof host.changed === 'function') host.changed();
    }

    /* a result is marked: the row for it ticks its clock, once per stamp */
    function marked(sit, view) {
      var r = SIT[str(sit)], a = isObj(view) && isObj(view.active) ? view.active : null;
      if (!r) return Promise.resolve({ ok: false, why: 'result' });
      if (!a || !a.at) return Promise.resolve({ ok: false, why: 'nostamp' });
      var key = 'at' + a.at;
      if (done[key]) return Promise.resolve({ ok: false, why: 'once' });
      done[key] = true;
      var l = clocks(), row = rows(pre(), l, pick)[r];
      pick = {};      /* the roll is resolved: the next one starts from its own prefill */
      if (!row.id) {
        if (row.miss && !row.picked) toast(missText(row), true);
        return Promise.resolve({ ok: false, why: row.miss && !row.picked ? 'miss' : 'none' });
      }
      var c = l.filter(function (x) { return str(x.id) === row.id; })[0], C = chips(), th = call('tickHost', null);
      if (!c) { toast('That clock is no longer on the table: nothing ticked.', true); return Promise.resolve({ ok: false, why: 'gone' }); }
      if (!C || !th) { toast('The table is not available here: tick the clock on the table page.', true); return Promise.resolve({ ok: false, why: 'host' }); }
      var name = plain(c.name, 40), size = Math.max(1, Math.floor(+c.size) || 1), at = WORDS[r];
      /* the page's own Undo toast, its text led by the result, with a night-log line when it undoes */
      var h = Object.create(th);
      h.undoToast = function (text, undo) {
        if (typeof th.undoToast !== 'function') return null;
        return th.undoToast(at + ': ' + text, function () {
          return Promise.resolve(undo()).then(function (msg) { if (/^Undone/.test(str(msg))) log('Tick undone: ' + name); return msg; });
        });
      };
      return C.tick(h, c, row.n).then(function (res) {
        if (res && res.ok) log('Tick on ' + at.slice(3) + ': ' + name + ' ' + res.from + ' to ' + res.to + '/' + size);
        return res || { ok: false };
      });
    }

    /* ---------- the control: after #gm-stamp (or the kit desk's stamp row), only while the setting and the stamp are on ---------- */
    function opt(doc, value, text, on) { var o = doc.createElement('option'); o.value = value; o.textContent = text; if (on) o.selected = true; return o; }
    function build(doc) {
      var d = doc.createElement('div'); d.className = 'nt-tick'; d.id = 'gm-nt'; d.setAttribute('role', 'group'); d.setAttribute('aria-labelledby', 'gm-nt-l');
      var lab = doc.createElement('p'); lab.className = 'nt-lab'; lab.id = 'gm-nt-l'; lab.textContent = 'Tick a clock'; d.appendChild(lab);
      ROWS.forEach(function (r) {
        var row = doc.createElement('div'); row.className = 'nt-row'; row.setAttribute('data-nt-row', r);
        var w = doc.createElement('span'); w.className = 'nt-on'; w.textContent = WORDS[r]; row.appendChild(w);
        var s = doc.createElement('select'); s.className = 'nt-clock'; s.setAttribute('data-nt', 'clock'); s.setAttribute('aria-label', 'The clock to tick ' + WORDS[r].toLowerCase()); row.appendChild(s);
        var n = doc.createElement('select'); n.className = 'nt-n'; n.setAttribute('data-nt', 'n'); n.setAttribute('aria-label', 'How many segments ' + WORDS[r].toLowerCase()); row.appendChild(n);
        d.appendChild(row);
      });
      var note = doc.createElement('p'); note.className = 'nt-note'; note.id = 'gm-nt-note'; d.appendChild(note);
      d.addEventListener('change', function (ev) {
        var t = ev.target, row = t && t.closest ? t.closest('[data-nt-row]') : null; if (!row) return;
        var cs = row.querySelector('[data-nt="clock"]'), ns = row.querySelector('[data-nt="n"]');
        setPick(row.getAttribute('data-nt-row'), cs ? cs.value : '', ns ? ns.value : 1);
      });
      return d;
    }
    function noteOf(p, rs) {
      var r = rs['13'];
      if (p && !r.picked && r.miss) {
        if (r.many) return 'Two clocks are called “' + plain(r.miss, 40) + '”: pick one.';
        return 'No clock called “' + plain(r.miss, 40) + '”' + (r.loose ? ' (did you mean “' + plain(r.loose, 40) + '”?)' : '') + ': nothing will tick.';
      }
      if (!p) return 'Nothing ticks unless you pick a clock.';
      return p.from === 'line' ? 'From the tick in your line.' : p.from === 'room' ? 'From the room’s line.' : 'The site’s alarm clock.';
    }
    function fill(doc, d) {
      var l = clocks(), p = pre(), rs = rows(p, l, pick);
      var s = JSON.stringify([l.map(function (c) { return [c.id, c.name, c.filled, c.size, c.hidden === true]; }), rs, p && p.from]);
      if (s === sig) return;
      var f = doc.activeElement; if (f && d.contains(f) && f.tagName === 'SELECT') return;      /* never redraw a list while it has the focus */
      sig = s;
      ROWS.forEach(function (r) {
        var row = d.querySelector('[data-nt-row="' + r + '"]'), cs = row.querySelector('[data-nt="clock"]'), ns = row.querySelector('[data-nt="n"]'), cur = rs[r];
        cs.textContent = ''; cs.appendChild(opt(doc, '', 'No tick', !cur.id));
        l.forEach(function (c) {
          var sz = Math.max(1, Math.floor(+c.size) || 1);
          cs.appendChild(opt(doc, str(c.id), plain(c.name, 40) + ' ' + whole(c.filled, 0, sz) + '/' + sz, str(c.id) === cur.id));
        });
        ns.textContent = '';
        for (var i = 1, top = Math.max(N_OFFER, cur.n); i <= top; i++) ns.appendChild(opt(doc, String(i), '+' + i, i === cur.n));
        ns.disabled = !cur.id;
        row.setAttribute('data-nt-on', cur.id ? '1' : '0');
      });
      var note = d.querySelector('.nt-note');
      var hid = l.filter(function (c) { return c.hidden === true && (str(c.id) === rs['13'].id || str(c.id) === rs['45'].id); }).length > 0;
      note.textContent = noteOf(p, rs) + (hid ? ' Hidden from the players.' : '');      /* the GM's own page only: the lists are narrow, so the word is here, not in them */
      if (rs['13'].miss && !rs['13'].picked) note.setAttribute('data-nt-miss', ''); else note.removeAttribute('data-nt-miss');
    }
    function paint(box, on, view) {
      var doc = call('doc', null) || (box && box.ownerDocument);
      var show = !!(on && box && doc && isObj(view) && view.on);
      if (el && (!show || !el.isConnected)) { if (el.parentNode) el.parentNode.removeChild(el); if (!show) { el = null; sig = ''; } }
      if (!show) return;
      if (!el) { el = build(doc); sig = ''; }
      var anchor = (box.closest && box.closest('.kr-stamprow')) || box;
      if (el.previousElementSibling !== anchor || !el.isConnected) anchor.insertAdjacentElement('afterend', el);
      fill(doc, el);
    }
    return { paint: paint, marked: marked, rows: rowsNow, pick: setPick, reset: function () { pick = {}; done = {}; } };
  }

  return { names: names, sure: sure, wrongMd: wrongMd, roomMd: roomMd, prefill: prefill, rows: rows, create: create };
});
