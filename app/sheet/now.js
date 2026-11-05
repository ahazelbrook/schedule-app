/* sheet/now.js — the phone's "Now" card and the "Between sessions" fold (the night rebuild, N6; design section 7).

   Window.B68Now, and module.exports under Node. In the core bundle (the sheet is on every route). The sheet (tracker.js) gives it two slots and one call:
   card(ctx) right under the head, fold(ctx) at the very end, and tick(root) after every redraw. Nothing here fetches, stores or pushes anything: each phone
   module keeps its own reading and its own data and only says what it has (now() and between(): an item, or null); this file decides where it goes.

   THE NOW CARD. One card at the top of the sheet, only while something is due, in this order (the first that has something wins):
     commend   the Aftermath's xp commendations, while the 90-second window is open             sheet/commend.js
     debrief   the Debrief, from the morning after until it is answered or the defaults apply    sheet/debrief.js
     absent    the absent-player packet, until it has been opened                                sheet/absent.js
     keys      "You can turn this key", while a key has three hits                               sheet/keys.js
     mission   the mission card, while the GM's Phones setting is "mission cards"                the sheet's own api.mission()
   Everything else that is due waits behind "+n more", which lists it under the card. Nothing due: no card and no gap (the slot is empty).

   THE FOLD. "Between sessions", closed by default, after the last box: the opportunity board's posting line, and the packet and the last Debrief once
   they are no longer current. Its band says how many things are inside. Nothing inside: no fold.

   ctx (built by the sheet): the keys ctx (esc, play, pb, ui, turn, ...) plus mission (api.mission() or null) and docId (this sheet's character).
   item: { id, kicker?, title, line?, ends? (ms, a countdown "Closes in m:ss"), actions?: [{ label, attrs, primary? }], html? (markup the module built
   with ctx.esc) }. Titles, lines and labels are text (escaped here); attrs and html are the module's own markup.

   API: ORDER  SHORT  due(ctx) -> [item]   between(ctx) -> [item]   card(ctx) -> html | ''   fold(ctx) -> html | ''   tick(scope?)   left(endsMs, nowMs) */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68Now = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  var ORDER = ['commend', 'debrief', 'absent', 'keys', 'mission'];
  var FOLD = ['board', 'absent', 'debrief'];
  var MODS = { commend: 'B68Commend', debrief: 'B68Debrief', absent: 'B68Absent', board: 'B68Board' };
  /* the band over the card, and the short name "+n more" gives each one that waits */
  var KICKER = { commend: 'Now · the Aftermath', debrief: 'Now · the morning after', absent: 'Now · the night you missed', keys: 'Now · your keys', mission: 'Now · the score' };
  var SHORT = { commend: 'xp', debrief: 'Debrief', absent: 'your packet', keys: 'a key to turn', mission: 'Mission' };
  /* each item keeps the class its strip had (ds-commend, ds-debrief, ...), so what pointed at a strip finds the item */
  var CLS = { commend: 'ds-commend', debrief: 'ds-debrief', absent: 'ds-absent', board: 'ds-board', keys: 'ds-keyturn', mission: 'ds-mission' };

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function log(e) { if (W && W.console) W.console.error(e); }

  /* one module's answer: an item with a title, or null (a module that is not loaded, not started or throws has nothing) */
  function ask(m, fn, arg) {
    if (!m || typeof m[fn] !== 'function') return null;
    var it = null; try { it = m[fn](arg); } catch (e) { log(e); return null; }
    return isObj(it) && str(it.title) ? it : null;
  }
  function mod(id) { var m = W && W[MODS[id]]; return m && typeof m === 'object' ? m : null; }

  /* the mission card, from the sheet's own api.mission(): this sheet's character's card, else the player's first */
  function missionItem(ctx) {
    var m = isObj(ctx) ? ctx.mission : null; if (!isObj(m) || !Array.isArray(m.pcs) || !m.pcs.length) return null;
    var pc = m.pcs.filter(function (p) { return isObj(p) && p.id === ctx.docId; })[0] || m.pcs[0], c = isObj(pc && pc.card) ? pc.card : {};
    var room = str(c.room).trim(), busy = str(c.busy).trim(), mine = pc && pc.id === ctx.docId, who = str(c.name).trim() || str(pc && pc.name).trim() || 'Your character';
    var line = room ? (mine ? 'You are in ' : who + ' is in ') + room + '.' : (mine ? 'You are' : who + ' is') + ' not placed yet.';
    if (busy) line += ' Busy until ' + busy + '.';
    return { title: 'Mission', line: line, actions: [{ label: 'Open the mission card', attrs: 'data-act="missionscreen" data-always="1" aria-haspopup="dialog"', primary: true }] };
  }

  function due(ctx) {
    var out = [];
    ORDER.forEach(function (id) {
      var it = id === 'keys' ? ask(W && W.B68SheetKeys, 'now', ctx) : id === 'mission' ? missionItem(ctx) : ask(mod(id), 'now');
      if (it) { it.id = id; out.push(it); }
    });
    return out;
  }
  function between() {
    var out = [];
    FOLD.forEach(function (id) { var it = ask(mod(id), 'between'); if (it) { it.id = id; out.push(it); } });
    return out;
  }

  /* ---------- drawing (the sheet's own box, band, body and buttons) ---------- */
  function actions(it, small) {
    var h = '';
    (Array.isArray(it.actions) ? it.actions : []).forEach(function (a) {
      if (!isObj(a) || !str(a.label)) return;
      h += '<button type="button" class="btn sm' + (a.primary && !small ? ' primary' : '') + '" ' + str(a.attrs) + '>' + esc(a.label) + '</button>';
    });
    return h;
  }
  function itemHtml(it, small) {
    var h = '<div class="ds-now-item ' + (CLS[it.id] || '') + (small ? ' ds-now-sm' : '') + '" data-now="' + esc(it.id) + '">' +
      '<p class="ds-now-t">' + esc(it.title) + '</p>';
    var ends = typeof it.ends === 'number' && isFinite(it.ends) && it.ends > 0 ? Math.floor(it.ends) : 0;
    if (str(it.line) || ends) h += '<p class="ds-now-line">' + esc(it.line) + (ends ? ' <span class="ds-now-left mono" data-ends="' + ends + '"></span>' : '') + '</p>';
    if (str(it.html)) h += '<div class="ds-now-html">' + str(it.html) + '</div>';
    var a = actions(it, small); if (a) h += '<div class="ds-now-acts">' + a + '</div>';
    return h + '</div>';
  }

  /* the Now card: the first item at full size; the rest behind "+n more" (ctx.ui.nowMore, the sheet's own toggle) */
  function card(ctx) {
    var list = due(ctx), ui = isObj(ctx) && isObj(ctx.ui) ? ctx.ui : {};
    if (list.length < 2 && ui.nowMore) ui.nowMore = false;   /* nothing waits any more: "+n more" starts folded again next time */
    if (!list.length) return '';
    var top = list[0], rest = list.slice(1), more = rest.length > 0 && ui.nowMore === true;
    var h = '<section class="ds-box ds-now" aria-label="Now">' +
      '<div class="ds-band"><h3 class="ds-bt">' + esc(str(top.kicker) || KICKER[top.id] || 'Now') + '</h3></div>' +   /* how many wait, and which, is "+n more"'s to say */
      '<div class="ds-body">' + itemHtml(top, false);
    if (rest.length) {
      h += '<button type="button" class="ds-now-more" data-act="nowmore" aria-expanded="' + more + '"' + (more ? ' aria-controls="ds-now-rest"' : '') + '>' +
        '<span>' + (more ? 'Show less' : '+' + rest.length + ' more: ' + esc(rest.map(function (it) { return SHORT[it.id] || it.title; }).join(' · '))) + '</span>' +
        '<span class="ds-chev" aria-hidden="true">' + (more ? '▴' : '▾') + '</span></button>';
      if (more) h += '<div class="ds-now-rest" id="ds-now-rest">' + rest.map(function (it) { return itemHtml(it, true); }).join('') + '</div>';
    }
    return h + '</div></section>';
  }

  /* the fold after the last box (ctx.ui.between, the sheet's own toggle) */
  function fold(ctx) {
    var list = between(ctx); if (!list.length) return '';
    var open = isObj(ctx) && isObj(ctx.ui) && ctx.ui.between === true;
    var h = '<section class="ds-box ds-betweenbox">' +
      '<button type="button" class="ds-band ds-between-t" data-act="between" aria-expanded="' + open + '"' + (open ? ' aria-controls="ds-between-b"' : '') + '>' +
        '<span class="ds-bt">Between sessions</span><span class="ds-band-r"><span class="ds-between-n">' + list.length + ' inside</span><span class="ds-chev" aria-hidden="true">' + (open ? '▴' : '▾') + '</span></span></button>';
    if (open) h += '<div class="ds-body" id="ds-between-b">' + list.map(function (it) { return itemHtml(it, true); }).join('') + '</div>';
    return h + '</section>';
  }

  /* ---------- the countdown: written in place once a second, never a redraw (a redraw under a finger can lose the tap) ---------- */
  function left(ends, nowMs) { var s = Math.max(0, Math.ceil((ends - nowMs) / 1000)), r = s % 60; return Math.floor(s / 60) + ':' + (r < 10 ? '0' : '') + r; }
  var tickT = null;
  function tick(scope) {
    var d = W && W.document, at = scope || d;
    if (!at || typeof at.querySelectorAll !== 'function') return;
    var els = at.querySelectorAll('[data-ends]'), now = Date.now(), any = false;
    for (var i = 0; i < els.length; i++) {
      var e = +els[i].getAttribute('data-ends'); if (!(e > 0)) continue;
      any = true; var t = 'Closes in ' + left(e, now);
      if (els[i].textContent !== t) els[i].textContent = t;
    }
    if (any && !tickT && typeof W.setInterval === 'function') tickT = W.setInterval(function () { tick(); }, 1000);
    else if (!any && tickT && !scope) { W.clearInterval(tickT); tickT = null; }
  }

  return { ORDER: ORDER, FOLD: FOLD, SHORT: SHORT, due: due, between: between, card: card, fold: fold, tick: tick, left: left };
});
