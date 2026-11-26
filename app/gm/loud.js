/* gm/loud.js: when it goes loud (gm.glance, RK23 of the room key build). GM page only: it is in the gm-glance bundle (app/routes.js), fetched only while
   the setting is on, and nothing here is ever sent to the iPad or a phone.
   Plain script, UMD: window.B68GmLoud in the browser, module.exports under Node. ES5, as the files beside it. It defines its module when it loads, and
   reads B68GmRooms (gm/room-notes.js) and B68Ui only when it is called.

   WHAT IT ADDS to the alarm's popover (gm/site.js alarmPop and the site line's popover; the Run view's header button opens it):
     every beat     the alarm's beats (play.alarm.beats), one row each: a tick for a beat gone, Now for the beat the clock is on, Next for the one after (RK03.4:
                    the clock's next beat, read-only). Rows are text, never buttons.
     the plan       an optional section of the prep note, read the way Rooms is (gm/room-notes.js): who goes where, which doors shut, where the VIP goes.
                      ## When it goes loud            (or "When it goes loud · the evacuation": an H2; the first note that has one)
                      ### Who goes where              an H3 groups the lines under it
                      - **Guests:** out through the Cocktail lounge
                      - **VIP:** Mabel Quist goes down to the counting room
                      - **Getaway:** `▶ clock: Getaway / 6 / 0`      the getaway clock (the grammar of prep-actions.js: name / size / starting count)
                    It shows in full while the alarm clock is at its top segment; before that, one dim line says it is written.
     the getaway    the clock span is a button, "Make the <name> clock": one tap adds a hidden danger clock to the table (the page's addClock, as the prep
                    note's own chip does), with Undo; once it is on the table the line reads where it stands.
   Nothing is stored. The note is read from the pack's prep part; its text goes in escaped.

   PURE (tested under Node, checks/runtime/gm-loud.test.mjs)
     parse(md) -> null | { heading, items: [{ group, label, text }], clock: { name, size, ticks } | { bad } | null }     the section of one note's Markdown
     find(prepPart) -> null | { source (the note's id), heading, items, clock }     the first note (notes order) with the section
     beatRows(beats, filled, size) -> [{ n, text, state: 'done' | 'now' | 'next' | '' }]
     topSegment(filled, size) -> bool
   THE VIEW: create(host) -> { pop(html, info, gm) -> html, make() -> Promise, plan() -> find(...) | null }
     host: prep() -> the pack's prep part, clocks() -> [table clock], canClock() -> bool, addClock(clock) -> Promise, clockOps(ops) -> Promise,
           undoToast(text, undo) -> truthy when shown, toast(msg, bad), redraw()
     info is site.js's alarmInfo: { v (the security view), clock (name), beats, missing }. gm adds data-gm="site" to the button (the site line). Its one
     control is data-site="loud-make", which the Run view routes to the page's siteAct. */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmLoud = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var SIZES = [4, 6, 8, 12], MAX_ITEMS = 24, LABEL_MAX = 28, TEXT_MAX = 240, BEATS_MAX = 12, NAME_MAX = 60;
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function words(s) { return str(s).replace(/\s+/g, ' ').trim(); }
  function fold(s) { var t = str(s); try { t = t.normalize('NFKD'); } catch (e) { /* as written */ } return t.toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  function cut(s, max) { s = str(s); if (s.length > max) { s = s.slice(0, max); var c = s.charCodeAt(max - 1); if (c >= 0xd800 && c <= 0xdbff) s = s.slice(0, -1); s = s.replace(/\s+$/, '') + '…'; } return s; }
  function Rooms() {
    if (root && root.B68GmRooms) return root.B68GmRooms;
    try { return typeof require === 'function' ? require('./room-notes.js') : null; } catch (e) { return null; }
  }
  function Ui() {
    if (root && root.B68Ui) return root.B68Ui;
    try { return typeof require === 'function' ? require('../ui/ui.js') : null; } catch (e) { return null; }
  }

  /* ---- the note's section ---- */
  var H2 = /^ {0,3}##[ \t]+(.*?)[ \t]*#*[ \t]*$/, H3 = /^ {0,3}#{3,6}[ \t]+(.*?)[ \t]*#*[ \t]*$/;
  var HEAD = /^when it goes loud\s*(?:[·:–—-]\s*(.*))?$/i;
  var FENCE = /^ {0,3}(`{3,}|~{3,})/;
  var BULLET = /^\s*(?:[-*+]|\d+[.)])[ \t]+/;
  /* "**Label:** text", "Label: text" and "**Label**: text": a label of letters, short, so a time ("22:40 ...") or a sentence with a colon far in is no label */
  var LABEL = /^(?:\*\*|__)?([A-Za-z][^:*_`\[\]]{0,27}?)(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*([\s\S]*)$/;
  var CLOCK_SPAN = /^\s*(?:▶️?|>>)[  ]+clock\s*:\s*(\S[\s\S]*)$/i;

  /* the grammar of prep-actions.js's clock: a name, a size (4, 6, 8 or 12; 4 when absent) and a starting count (0 when absent), split at " / " */
  function parseClock(arg) {
    var p = str(arg).split(/\s+\/\s+/).map(words), name = p[0] || '';
    if (!name) return { bad: 'The getaway clock has no name.' };
    if (p.length > 3) return { bad: 'A clock takes a name, a size and a starting count: no more.' };
    var size = p.length > 1 ? (/^\d+$/.test(p[1]) ? +p[1] : NaN) : 4;
    if (SIZES.indexOf(size) < 0) return { bad: 'The getaway clock’s size must be 4, 6, 8 or 12.' };
    var ticks = p.length > 2 ? (/^\d+$/.test(p[2]) ? +p[2] : NaN) : 0;
    if (!(ticks >= 0 && ticks <= size)) return { bad: 'The getaway clock’s starting count must be a number from 0 to ' + size + '.' };
    return { name: name.slice(0, NAME_MAX), size: size, ticks: ticks };
  }
  /* the first clock span in a line (a code span as Markdown finds one: a backtick run to the next run of the same length), or null */
  function clockIn(line, R) {
    var s = str(line), i = 0;
    while (i < s.length) {
      var j = s.indexOf('`', i); if (j < 0) return null;
      var k = j; while (k < s.length && s.charAt(k) === '`') k++;
      var n = k - j, m = k, close = -1;
      while (m < s.length) { var a = s.indexOf('`', m); if (a < 0) break; var b = a; while (b < s.length && s.charAt(b) === '`') b++; if (b - a === n) { close = a; break; } m = b; }
      if (close < 0) { i = k; continue; }
      var code = s.slice(k, close), c = R && R.isAction(code) ? CLOCK_SPAN.exec(code) : null;
      if (c) return parseClock(words(c[1]));
      i = close + n;
    }
    return null;
  }

  /* one note's Markdown -> its "When it goes loud" section, or null. Lines inside fences are never headings or items. */
  function parse(md) {
    var R = Rooms(), lines = str(md).split(/\r?\n/), fence = null, open = false, heading = '', group = '', items = [], clock = null, found = false;
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i], f = FENCE.exec(l);
      if (f) { if (!fence) fence = f[1].charAt(0); else if (f[1].charAt(0) === fence) fence = null; continue; }
      if (fence) continue;
      var h2 = H2.exec(l);
      if (h2 && !/^#/.test(h2[1])) {
        if (open) break;                      /* the next H2 ends the section */
        var hm = HEAD.exec(words(R ? R.plain(h2[1]) : h2[1]));
        if (hm && !found) { open = true; found = true; heading = hm[1] ? words(hm[1]) : ''; }
        continue;
      }
      if (!open) continue;
      var h3 = H3.exec(l);
      if (h3) { group = cut(words(R ? R.plain(h3[1]) : h3[1]), LABEL_MAX + 12); continue; }
      var t = l.replace(/^[ \t]*(?:>[ \t]?)+/, '').replace(BULLET, '');
      if (!words(t)) continue;
      var ck = clockIn(t, R);
      if (ck && !clock) clock = ck;
      var body = words(R ? R.plain(t) : t);                     /* action spans gone whole, links to their text, emphasis off */
      var lm = LABEL.exec(words(R ? R.stripActions(t) : t)), label = '';
      if (lm) { label = words(R ? R.plain(lm[1]) : lm[1]); body = words(R ? R.plain(lm[2]) : lm[2]); }
      if (!body) continue;                                      /* a label with only a chip after it (the getaway line), or a line of nothing but chips */
      if (items.length < MAX_ITEMS) items.push({ group: group, label: cut(label, LABEL_MAX), text: cut(body, TEXT_MAX) });
    }
    return found ? { heading: heading, items: items, clock: clock } : null;
  }
  function blocksOf(n) { return list(isObj(n) ? n.blocks : null).map(function (b) { return isObj(b) ? str(b.src) : ''; }).join('\n'); }
  function find(prepPart) {
    var notes = isObj(prepPart) ? list(prepPart.notes) : [];
    for (var i = 0; i < notes.length; i++) {
      if (!isObj(notes[i])) continue;
      var p = parse(blocksOf(notes[i]));
      if (p) return { source: str(notes[i].id), heading: p.heading, items: p.items, clock: p.clock };
    }
    return null;
  }

  /* ---- the beats ---- */
  function topSegment(filled, size) { return size > 0 && filled >= size; }
  function beatRows(beats, filled, size) {
    var f = Math.max(0, Math.floor(+filled || 0)), out = [];
    list(beats).slice(0, BEATS_MAX).forEach(function (b, i) {
      var n = i + 1, text = words(b);
      out.push({ n: n, text: text, state: size > 0 ? (n < f ? 'done' : n === f ? 'now' : n === f + 1 ? 'next' : '') : '' });
    });
    return out;
  }
  var WORD = { done: 'Done', now: 'Now', next: 'Next' }, SHAPE = { done: '✓', now: '●', next: '→' };

  /* ---- the view ---- */
  function create(host) {
    host = host || {};
    var memo = null, made = {}, busy = false;
    function toast(m, bad) { if (typeof host.toast === 'function') host.toast(m, !!bad); }
    function redraw() { if (typeof host.redraw === 'function') host.redraw(); }
    function plan() {
      var pk = null; try { pk = typeof host.prep === 'function' ? host.prep() : null; } catch (e) { pk = null; }
      if (memo && memo.pk === pk) return memo.v;
      var v = null; try { v = find(pk); } catch (e) { v = null; }
      memo = { pk: pk, v: v };
      return v;
    }
    function clocks() { var l = []; try { l = typeof host.clocks === 'function' ? host.clocks() : []; } catch (e) { l = []; } return list(l).filter(isObj); }
    function clockNow(name) {
      var k = fold(name), c = clocks().filter(function (x) { return fold(x.name) === k; })[0] || null;
      if (c) { delete made[k]; return c; }
      return made[k] || null;
    }

    function beatsHtml(info) {
      var v = isObj(info.v) ? info.v : {}, size = v.site ? +v.size || 0 : 0, rows = beatRows(info.beats, v.site ? v.filled : 0, size);
      if (!rows.length) return '';
      var h = '<ol class="gl-loud-beats" aria-label="Every beat of ' + esc(info.clock || 'the alarm') + '">';
      rows.forEach(function (r) {
        h += '<li class="gl-lb' + (r.state ? ' gl-lb-' + r.state : '') + '"><span class="gl-lb-n">' + r.n + '</span><span class="gl-lb-s">' +
          (r.state ? '<span aria-hidden="true">' + SHAPE[r.state] + '</span> ' + WORD[r.state] : '') + '</span><span class="gl-lb-t">' + esc(r.text || '(nothing written for this beat)') + '</span></li>';
      });
      return h + '</ol>';
    }
    function planHtml(p, top) {
      if (!p.items.length) return '';
      if (!top) return '<p class="gl-loud-wait">The plan for the top segment is written: ' + p.items.length + (p.items.length === 1 ? ' line' : ' lines') + '. It shows when the clock is full.</p>';
      var h = '<section class="gl-loud-plan" aria-label="When it goes loud"><h4 class="gl-loud-h">When it goes loud' + (p.heading ? ' <span class="gl-loud-sub">' + esc(p.heading) + '</span>' : '') + '</h4>', g = null, open = false;
      p.items.forEach(function (it) {
        if (!open || it.group !== g) { if (open) h += '</ul>'; g = it.group; if (g) h += '<p class="gl-loud-g">' + esc(g) + '</p>'; h += '<ul class="gl-loud-list">'; open = true; }
        h += '<li>' + (it.label ? '<b class="gl-loud-k">' + esc(it.label) + '</b> ' : '') + '<span class="gl-loud-t">' + esc(it.text) + '</span></li>';
      });
      return h + (open ? '</ul>' : '') + '</section>';
    }
    function clockHtml(p, gm) {
      var k = p.clock; if (!k) return '';
      if (k.bad) return '<p class="gl-loud-clock gl-loud-bad">' + esc(k.bad) + '</p>';
      var c = clockNow(k.name), n = c ? Math.floor(+c.filled) || 0 : 0, size = c ? +c.size || k.size : k.size;
      if (c) return '<p class="gl-loud-clock">' + esc(str(c.name) || k.name) + ' is on the table: <b>' + n + '/' + size + '</b>.</p>';
      var U = Ui(), label = 'Make the ' + k.name + ' clock', title = 'Adds a hidden danger clock to the table: ' + k.name + ' ' + k.ticks + ' of ' + k.size + ', with Undo';
      var b = U ? U.button({ label: label, rank: 'quiet', cls: ['rv-btn', 'sm', 'gl-loud-b'], data: gm ? { gm: 'site', site: 'loud-make' } : { site: 'loud-make' }, title: title })
        : '<button type="button" class="rv-btn sm gl-loud-b"' + (gm ? ' data-gm="site"' : '') + ' data-site="loud-make" title="' + esc(title) + '">' + esc(label) + '</button>';
      return '<p class="gl-loud-clock">' + b + '</p>';
    }

    /* html: the alarm popover's own markup (a div that ends the string); the block goes in before its closing tag */
    function pop(html, info, gm) {
      html = str(html); info = isObj(info) ? info : {};
      if (!html) return html;
      var v = isObj(info.v) ? info.v : {}, p = plan(), top = !!v.site && topSegment(+v.filled || 0, +v.size || 0);
      var inner = (p ? clockHtml(p, !!gm) + planHtml(p, top) : '') + beatsHtml(info);      /* the getaway chip first (it must never scroll out of sight), then the plan, then every beat */
      if (!inner) return html;
      var at = html.lastIndexOf('</div>');
      return (at < 0 ? html : html.slice(0, at)) + '<div class="gl-loud">' + inner + '</div>' + (at < 0 ? '' : html.slice(at));
    }

    /* the getaway clock: one tap. Hidden from the players, a danger clock, as the prep note's own chip makes it. */
    function make() {
      var p = plan(), k = p ? p.clock : null;
      if (!k || k.bad) { toast(k && k.bad ? k.bad : 'The prep note names no getaway clock.', true); return Promise.resolve(false); }
      var c = clockNow(k.name);
      if (c) { toast('Clock: ' + str(c.name) + ' stands at ' + (Math.floor(+c.filled) || 0) + '/' + (+c.size || k.size) + '. Nothing added.'); return Promise.resolve(false); }
      if (busy) return Promise.resolve(false);
      if (typeof host.canClock !== 'function' || !host.canClock()) { toast('The table is not available here: start the clock on the table page.', true); return Promise.resolve(false); }
      var clock = { id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: k.name, size: k.size, filled: k.ticks, kind: 'danger', hidden: true };
      busy = true;
      return Promise.resolve().then(function () { return host.addClock(clock); }).then(function (r) {
        busy = false;
        if (r === false) throw new Error('The clock was not added.');
        made[fold(k.name)] = { id: clock.id, name: clock.name, size: clock.size, filled: clock.filled, hidden: true };
        redraw();
        var text = 'Clock added, hidden from the players: ' + k.name + ' ' + k.ticks + '/' + k.size + '.';
        var undo = function () { return undoClock(clock).then(function (m) { redraw(); return m; }); };
        if (typeof host.undoToast === 'function' && host.undoToast(text, undo)) return true;
        toast(text);
        return true;
      }, function (e) { busy = false; toast('Could not add the clock: ' + (e && e.message || e), true); return false; });
    }
    /* Undo: only while the clock is as it was left */
    function undoClock(clock) {
      var live = clocks().filter(function (x) { return x.id === clock.id; })[0] || null;
      if (live && ((Math.floor(+live.filled) || 0) !== clock.filled || +live.size !== clock.size || live.hidden !== true)) return Promise.resolve('Not undone: the clock has changed since. Change it on the table page.');
      return Promise.resolve().then(function () { return typeof host.clockOps === 'function' ? host.clockOps([{ remove: clock.id }]) : Promise.reject(new Error('The table cannot change one clock here.')); })
        .then(function () { delete made[fold(clock.name)]; return 'Undone: the clock is off the table.'; });
    }
    return { pop: pop, make: make, plan: plan };
  }

  return { parse: parse, find: find, beatRows: beatRows, topSegment: topSegment, parseClock: parseClock, create: create };
});
