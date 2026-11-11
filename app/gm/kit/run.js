/* gm/kit/run.js: the Run view on the new desk (kit.desk, KS08 of the kit and stage build). In the kit-desk bundle: fetched only while the setting is on.
   It defines B68KitRun when it loads and reads other modules (B68Ui, B68Kit, B68GmRunView) only when it is called (the kit's load-order rule).

   HOW IT IS IN. gm/run-view.js keeps its state, its handlers and its sections. While the desk is on and its bundle is here (on()), the view's
   renderers for the head, the toolbar, the legend and the board each hand over to this file in one line (kit() in run-view.js), with what the
   view lends (kv(): the popovers' open flags, the armed PC, the selected room, the players chip, the menu's seam items, the old popover
   renderers). Every control drawn here keeps the id, the data-rv / data-site hook and the old class it had, so the view's one click handler, its
   drag, its Enter on a room and the page's checks find them. The parts come from B68Ui; a control the page's modules draw as markup (the alarm
   readout, the map tools, the stage group) is read back as attributes and drawn again as a part, its hooks untouched (redress()).
     The head (KS08.1)    one line: the site's title, the beat (◀ the time ▶, quiet; the time opens the night's squares and the timer's rest), the beat
                          timer (quiet), the clocks as chips with meters (the alarm, whose chip opens its popover; the countdown), the Players chip, ⋯.
                          Before the night starts, the engagement results in place of the time (the night.who wording, "Start the clock", kept).
     Tabs and tools (KS08.2)  Board · Map · Players as kit Tabs; the map tools (Spotted, Flashback, Pin, Montage, Show on iPad or Take it down) quiet;
                          Send (n) stays in sight while rooms are staged. The stage's state line, Freeze and Blank move into ⋯, under "The map on the iPad".
     The rooms (KS08.3)   rows grouped by floor: a swatch for what the crew knows (dark, blueprint, seen; staged), the name, one line of what is there,
                          the PCs' heads in the room they are in. The row is the one visible action (it selects; with a PC armed it is where the PC goes).
   API (window.B68KitRun; module.exports under Node)
     on() -> bool                         the desk is on, its bundle here, and B68Ui loaded
     head(x, v) toolbar(vs, cur, v) legend(view, v) -> markup       board(box, ctx, v)      the renderers run-view.js hands over to
     frame(box, on)                       the pane's krv class follows the desk (the layout lives under it); the old popovers get krv-pop
     start()                              listen to the desk (B68Kit.onChange) and redraw every Run view (B68GmRunView.redrawAll)
     pure: parse(html, doc), redress(el, o), knowWord(state, open), clockMeter(n, of) */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  if (root && root.document && !root.B68KitRun) { root.B68KitRun = M; M.start(); }
})(typeof window !== 'undefined' ? window : null, function (W) {
  'use strict';

  var MID = ' · ', listening = false, M = {};
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function esc(s) { return str(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function cap(s) { s = str(s); return s.charAt(0).toUpperCase() + s.slice(1); }
  function ui() { return (W && W.B68Ui) || M._ui || null; }
  function docOf(o) { return (o && o.ownerDocument) || (W && W.document) || M._doc || null; }
  function timeOf(st) { return isObj(st) && typeof st.t === 'number' && isFinite(st.t) ? Math.max(0, Math.round(st.t)) : 0; }
  /* a part's markup with more markup inside it, before its last closing tag (a chip with a meter, the time button with its output) */
  function inner(html, content) { return str(html).replace(/(<\/[a-z]+>)$/, function (end) { return content + end; }); }

  /* ---------- reading the page's markup back ---------- */
  /* markup the page's own modules drew (escaped there), as a fragment to read; nothing of it is put on the page as it is */
  function parse(html, doc) {
    doc = doc || docOf(); if (!doc || !html) return null;
    var t = doc.createElement('template'); t.innerHTML = str(html);
    return t.content || t;
  }
  var KEEP_ATTR = /^(aria-[a-z]+|role|name|value|tabindex|form|placeholder|autocomplete|inputmode|min|max|step|rows|maxlength|spellcheck)$/;
  /* one control as a B68Ui button: its label (the text, spaces folded), every class, data-*, aria-* and title it had, disabled and pressed; o adds to it */
  function redress(el, o) {
    o = o || {};
    var data = {}, attrs = {}, cls = str(el.getAttribute('class')).split(/\s+/).filter(Boolean), pressed = el.getAttribute('aria-pressed');
    Array.prototype.forEach.call(el.attributes, function (a) {
      if (a.name.indexOf('data-') === 0) data[a.name] = a.value === '' ? true : a.value;
      else if (KEEP_ATTR.test(a.name) && a.name !== 'aria-pressed') attrs[a.name] = a.value;
    });
    var label = str(el.textContent).replace(/\s+/g, ' ').trim();
    return ui().button({ label: o.label != null ? o.label : label, rank: o.rank || 'quiet', cls: cls.concat(list(o.cls)), data: data, attrs: attrs, title: el.getAttribute('title') || '',
      disabled: el.hasAttribute('disabled'), pressed: pressed === 'true' ? true : pressed === 'false' ? false : undefined });
  }
  /* the stage group (gm/stage.js groupHtml): its state line, Send (n), Freeze and Blank, apart */
  function stageParts(v) {
    var h = v.host, s = ''; try { s = typeof h.stageHtml === 'function' ? str(h.stageHtml()) : ''; } catch (e) { s = ''; }
    var f = parse(s), out = { live: null, send: null, rest: [] };
    if (!f) return out;
    out.live = f.querySelector('[data-site-live]');
    Array.prototype.forEach.call(f.querySelectorAll('button[data-site]'), function (b) { if (b.getAttribute('data-site') === 'send') out.send = b; else out.rest.push(b); });
    return out;
  }

  /* ---------- the head (KS08.1) ---------- */
  /* the meter of a clock: B68Ui's clock stops at 12 segments, so a longer one is drawn in twelfths (the count is always said in words beside it) */
  function clockMeter(n, of, o) {
    o = o || {}; of = Math.max(1, Math.floor(+of || 1)); n = Math.max(0, Math.min(of, Math.floor(+n || 0)));
    var max = Math.min(12, of), val = of > 12 ? Math.round(n / of * 12) : n;
    return ui().meter({ kind: o.kind || 'clock', value: val, max: max, tone: o.tone || 'ink', cls: 'krv-meter', attrs: { 'aria-hidden': 'true' } });
  }
  /* the ONE alarm readout (gm/security.js readoutHtml, or the view's own for a bare host): a chip button with its pips, the level and the count */
  function alarmChip(html) {
    var f = parse(html), b = f ? f.querySelector('button') : null; if (!b) return '';
    var segs = b.querySelectorAll('.rv-segs i'), filled = b.querySelectorAll('.rv-segs i.f').length, lab = b.querySelector('.rv-alabel'), lev = b.querySelector('.rv-alevel'), n = b.querySelector('.rv-sr');
    var label = lab ? str(lab.textContent).trim() : 'Alarm', count = n ? str(n.textContent).trim() : '', level = lev ? str(lev.textContent).trim() : '', of = segs.length;
    if (!segs.length) {           /* the bare host's readout: "<pie> Name <b>2/6</b>" */
      var bb = b.querySelector('b'), m = /(\d+)\s*\/\s*(\d+)/.exec(bb ? bb.textContent : ''); label = str(b.textContent).replace(bb ? bb.textContent : '', '').trim() || 'Alarm';
      filled = m ? +m[1] : 0; of = m ? +m[2] : 0; count = m ? m[0] : '';
    }
    var data = {}, attrs = {}, cls = str(b.getAttribute('class')).split(/\s+/).filter(Boolean).concat(['krv-ck', 'krv-alarm']);
    Array.prototype.forEach.call(b.attributes, function (a) { if (a.name.indexOf('data-') === 0) data[a.name] = a.value; else if (/^aria-/.test(a.name)) attrs[a.name] = a.value; });
    var chip = ui().chip({ button: true, tone: filled > 0 ? 'alarm' : 'plain', label: '', cls: cls, data: data, attrs: attrs, title: b.getAttribute('title') || '' });
    return inner(chip, '<span class="rv-alabel krv-sr">' + esc(label) + '</span>' + (of ? clockMeter(filled, of, { kind: of <= 8 ? 'pips' : 'clock', tone: filled > 0 ? 'alarm' : 'ink' }) : '') +
      (level ? '<b class="rv-alevel krv-ckv">' + esc(level) + '</b>' : '') + (count ? '<span class="krv-ckn">' + esc(count) + '</span>' : ''));
  }
  function head(x, v) {
    var U = ui(), B = v.B, m = x.m, p = x.rs.play, st = x.st, nowT = timeOf(st), nb = B.beatOf(p, nowT), h = '<div class="rv-headwrap krv-headwrap"><div class="rv-head krv-head">';
    h += '<h2 class="krv-title" title="' + esc(x.rs.name) + '">' + esc(x.rs.name) + '</h2>';
    if (!m.started) {
      var opts = v.startMinutes(p);
      h += '<div class="rv-start krv-start" role="group" aria-label="' + esc(v.startName) + '"><b class="krv-startl">' + esc(v.startName) + '</b><span class="krv-dim">the engagement result sets the clock</span><span class="rv-startbtns krv-startbtns">';
      h += opts.length ? opts.map(function (o) { return U.button({ label: o.label + ' ' + o.at, cls: 'rv-btn', data: { rv: 'start', key: o.key, t: o.t } }); }).join('')
        : U.button({ label: 'Start at ' + str(p.clock && p.clock.start), cls: 'rv-btn', data: { rv: 'start', key: 'open', t: 0 } });
      h += '</span></div>';
    } else {
      var tl = v.timer(x);
      h += '<span class="rv-clock krv-clock" role="group" aria-label="The night’s time">' +
        U.button({ label: '◀', rank: 'quiet', cls: 'rv-btn rv-step krv-step', data: { rv: 'back' }, attrs: { 'aria-label': 'Back a beat' }, title: 'Back a beat (Left)', disabled: v.stepTime(p, st, -1) === null }) +
        inner(U.button({ label: '', rank: 'quiet', cls: 'rv-timebtn krv-timebtn', data: { rv: 'timepop' }, attrs: { 'aria-haspopup': 'dialog', 'aria-expanded': String(!!v.timeOpen) },
          title: 'The night, a square a beat (look ahead or back), and the beat timer' }), '<output class="rv-time krv-time" id="rv-time" aria-label="Published time">' + esc(B.timeLabel(p, nowT)) + '</output><span class="krv-caret" aria-hidden="true">▾</span>') +
        U.button({ label: '▶', rank: 'quiet', cls: 'rv-btn rv-step krv-step', data: { rv: 'next' }, attrs: { 'aria-label': 'Next beat' }, title: 'Next beat (Right; Shift+Right: the next thing that happens)', disabled: v.stepTime(p, st, 1) === null }) +
        '<span class="rv-beat krv-beat">Beat ' + nb.n + ' of ' + nb.of + '</span></span>' +
        '<span class="rv-timer krv-timer" role="group" aria-label="The beat timer">' +
        inner(U.button({ label: '', rank: 'quiet', cls: 'rv-btn sm rv-tgo krv-tgo' + (tl.paused ? '' : ' going'), data: { rv: 'tgo' }, title: tl.paused ? 'Start the beat timer: at zero the night steps a beat' : 'Pause the beat timer' }),
          '<span class="krv-tgl" aria-hidden="true">' + (tl.paused ? '▶' : '❚❚') + '</span><span class="rv-sr">' + (tl.paused ? 'Start' : 'Pause') + ' </span><output class="' + esc(tl.cls) + '" data-rvtimer aria-label="Time left in this beat">' + esc(B.timerText(tl.l)) + '</output>') + '</span>';
    }
    h += alarmChip(v.alarm(x));
    var cd = m.started && typeof v.host.feature === 'function' && v.host.feature('map.countdown') && B.countdownOf ? B.countdownOf(p, nowT) : null;
    if (cd) h += inner(U.chip({ label: '', tone: cd.full ? 'alarm' : 'plain', cls: 'rv-count krv-ck krv-count' + (cd.full ? ' full' : ''), title: cd.label + ': one segment a beat, full at ' + cd.at, attrs: { role: 'img', 'aria-label': cd.label + ': ' + cd.n + ' of ' + cd.of } }),
      clockMeter(cd.n, cd.of, { tone: cd.full ? 'alarm' : 'ink' }) + '<span class="rv-clab krv-ckl">' + esc(cd.label) + '</span><span class="krv-ckn">' + cd.n + '/' + cd.of + '</span>');
    h += '<span class="rv-hsp krv-hsp" aria-hidden="true"></span>';
    h += U.chip({ label: v.players.text, cls: 'rv-chip rv-players krv-players', data: { ok: v.players.ok ? 1 : 0 }, title: v.players.text });
    h += U.button({ label: '⋯', rank: 'quiet', cls: 'rv-btn rv-more krv-more', data: { rv: 'menu' }, attrs: { 'aria-haspopup': 'menu', 'aria-expanded': String(!!v.menuOpen), 'aria-label': 'More for the night' },
      title: 'More: Back to now, False dawn, Intel, the map on the iPad, End the night' });
    h += '</div>';
    if (m.started) h += v.timePop(x);
    if (v.alarmOpen) h += v.alarmPop(x);
    h += menu(x, v);
    return h + '</div>';
  }

  /* ⋯: what today's menu holds, in its order, plus what KS08.2 moved here from the toolbar (the map on the iPad: its state, Freeze, Blank) */
  function menu(x, v) {
    var U = ui(), host = v.host, ctx = x.ctx, groups = [];
    var g = function (head, items, cls) { if (items.length) groups.push((head ? '<p class="rv-mh krv-mh">' + esc(head) + '</p>' : '') + U.menu({ items: items, cls: cls || '', attrs: { role: 'group' }, label: head || 'The night' })); };
    var first = [{ label: 'Back to now', cls: 'rv-mi', data: { rv: 'unpeek' }, disabled: v.peekT === null, title: v.peekT === null ? 'You are looking at now' : 'Back to the published time' }];
    if (typeof host.dawn === 'function') first.push({ label: 'False dawn', cls: 'rv-mi', data: { rv: 'dawn' }, title: 'The iPad goes white for 30 seconds; asks first' });
    g('', first);
    var gs = []; try { gs = typeof host.intelGroups === 'function' ? list(host.intelGroups()) : []; } catch (e) { gs = []; }
    g('Intel: set dark rooms to blueprint', gs.map(function (q) { return { label: str(q.label), cls: 'rv-mi', data: { site: 'intel', group: str(q.id) }, title: 'Every dark room of it becomes blueprint' }; }));
    var sp = stageParts(v), stage = sp.rest.map(function (b) { return { label: str(b.textContent).replace(/\s+/g, ' ').trim(), cls: 'rv-mi krv-moved ' + str(b.getAttribute('class')), data: { site: b.getAttribute('data-site') }, title: b.getAttribute('title') || '', disabled: b.hasAttribute('disabled'), attrs: b.hasAttribute('aria-pressed') ? { 'aria-pressed': b.getAttribute('aria-pressed') } : {} }; });
    if (stage.length || sp.live) groups.push('<p class="rv-mh krv-mh">The map on the iPad</p>' + (sp.live ? '<p class="rv-live krv-live ' + esc(str(sp.live.getAttribute('class')).replace(/\brv-live\b/, '')) + '" data-site-live title="' + esc(sp.live.getAttribute('title')) + '">' + esc(sp.live.textContent) + '</p>' : '') +
      (stage.length ? U.menu({ items: stage, attrs: { role: 'group' }, label: 'The map on the iPad' }) : ''));
    var own = list(v.menuItems).map(function (q, i) { return { label: str(typeof q.label === 'function' ? q.label(ctx) : q.label), cls: 'rv-mi', data: { rv: 'menuitem', i: i, mid: str(q.id) }, title: q.title || '' }; });
    if (typeof host.costume === 'function') { var cs = !!host.costume(); own.push({ label: 'Costume engine: ' + (cs ? 'shown' : 'hidden'), cls: 'rv-mi', data: { site: 'costume' }, attrs: { 'aria-checked': String(cs) }, title: 'The Disguise select in a v1 site’s Run the site strip (Location)' }); }
    g('', own);
    if (x.m.started) g('', [{ label: 'Reset the night', rank: 'danger', cls: 'rv-mi rv-reset', data: { rv: 'reset' }, title: 'Back to ' + v.startName + '; asks first' }]);
    return '<div class="rv-pop rv-menu krv-menu" id="rv-menu" role="menu" aria-label="More for the night"' + (v.menuOpen ? '' : ' hidden') + '>' + groups.join('<hr class="krv-hr">') + '</div>';
  }

  /* ---------- tabs and tools (KS08.2) ---------- */
  function toolbar(vs, cur, v) {
    var U = ui(), host = v.host, tools = '';
    try { tools = typeof host.toolsHtml === 'function' ? str(host.toolsHtml()) : ''; } catch (e) { tools = ''; }
    var tabs = U.tabs({ label: 'View', value: cur.id, cls: 'rv-views krv-views', items: vs.map(function (q) { return { label: q.label, value: q.id, cls: 'chip sm', data: { rv: 'view', v: q.id } }; }) });
    var f = parse(tools), qs = f ? Array.prototype.map.call(f.querySelectorAll('button'), function (b) { return redress(b, { rank: 'quiet', cls: ['krv-tool'] }); }).join('') : '';
    var sp = stageParts(v), send = sp.send ? redress(sp.send, { rank: 'standard', cls: ['krv-send'] }) : '';
    return '<div class="rv-tools krv-tools" role="toolbar" aria-label="The site">' + tabs +
      (qs || send ? '<span class="rv-mtools krv-mtools" role="group" aria-label="Map tools">' + qs + send + '</span>' : '') + '</div>';
  }
  function legend(view, v) {
    return '<p class="rv-legend krv-legend" aria-label="What the players’ map shows of each room">' + ['dark', 'blueprint', 'seen'].map(function (k) { return '<span class="krv-lg"><span class="krv-sw k-' + k + '" aria-hidden="true"></span>' + k + '</span>'; }).join('') +
      '<span class="krv-lg"><span class="krv-sw k-seen is-staged" aria-hidden="true"></span>staged</span></p>';
  }

  /* ---------- the rooms (KS08.3) ---------- */
  /* the word for what the crew knows of a room: the players' map state while map.knowledge is on, else open or not */
  function knowWord(ks, open) {
    if (isObj(ks) && ks.k) return cap(ks.k) + (ks.staged ? ', staged' : '');
    return open ? 'Open' : 'Not open';
  }
  function headBtn(c, v, inTray) {
    return ui().button({ label: inTray ? c.name : c.ini, rank: 'quiet', cls: 'rv-pc krv-pc' + (inTray ? ' krv-pcname' : '') + (v.arm === c.id ? ' armed' : '') + (c.moved ? ' moved' : ''), data: { rv: 'pc', id: c.id },
      pressed: v.arm === c.id, title: c.name + (c.costume ? MID + c.costume : '') + (c.moved ? MID + 'moved this beat' : '') + (c.looker ? MID + 'seen by ' + c.looker : ''), attrs: inTray ? {} : { 'aria-label': c.name } });
  }
  function board(box, ctx, v) {
    var m = ctx.model, host = v.host, h = '', states = {}, pin = '', thr = null;
    try { states = typeof host.roomStates === 'function' ? host.roomStates() || {} : {}; } catch (e) { states = {}; }
    try { pin = typeof host.pinned === 'function' ? str(host.pinned()) : ''; thr = typeof host.threat === 'function' ? host.threat() : null; } catch (e) { pin = ''; thr = null; }
    var knows = typeof host.roomStates === 'function';
    if (m.tray.length) h += '<div class="rv-tray krv-tray" data-room="" role="group" aria-label="Crew not on the board"><span class="rv-lab krv-lab">Not placed</span>' + m.tray.map(function (c) { return headBtn(c, v, true); }).join('') + '</div>';
    if (v.arm) h += '<p class="rv-arm krv-arm" role="status">Tap a room to move ' + esc(v.nameOfPc(v.arm, ctx)) + ' there. ' + ui().button({ label: 'Cancel', rank: 'quiet', cls: 'rv-btn sm', data: { rv: 'disarm' } }) + '</p>';
    m.rows.forEach(function (row) {
      h += '<section class="rv-row krv-floor" aria-label="' + esc(row.name) + '"><h3 class="rv-floor krv-floorname">' + esc(row.name) + '</h3><div class="rv-cards krv-rooms">' + row.cards.map(function (c) {
        var ks = isObj(states[c.name]) ? states[c.name] : null, kw = ks && ks.k ? ks.k : '', word = knowWord(knows ? ks || { k: '' } : null, c.open);
        var sw = 'krv-sw ' + (kw ? 'k-' + kw : knows ? 'k-dark' : c.open ? 'k-seen' : 'k-dark') + (ks && ks.staged ? ' is-staged' : '');
        var cls = 'rv-card krv-room z' + (c.zone < 0 ? 'x' : c.zone % 6) + (c.open ? ' open' : ' fog') + (kw ? ' k-' + kw : '') + (ks && ks.staged ? ' staged' : '') + (v.sel === c.name ? ' sel is-selected' : '');
        var who = c.npcs.map(function (n) { return n.label + (n.kind === 'target' ? ' ★' : n.kind === 'rival' ? ' ☠' : '') + (n.moving ? ' → ' + n.moving.to + ' in ' + n.moving.inMin + ' min' : ''); });
        var ways = c.routes.map(function (r) { return (r.timed ? '⏱ ' : '') + r.mark + ' ' + r.to + (r.until ? ' to ' + r.until : ''); });
        var sub = [word].concat(c.zoneLabel ? [c.zoneLabel] : []).concat(who.length ? [who.join(', ')] : []).concat(ways).join(MID);
        var marks = (pin && pin === c.name ? '<span class="rv-cmark pin krv-mark" title="The flashback pin">Pin</span>' : '') + (isObj(thr) && thr.room === c.name ? '<span class="rv-cmark threat krv-mark is-alarm" title="The stamp’s threat">' + esc(thr.kind) + '</span>' : '');
        var label = c.name + ', ' + word + (who.length ? ', ' + who.join(', ') : '') + (c.pcs.length ? ', PCs: ' + c.pcs.map(function (p) { return p.name; }).join(', ') : '');
        return '<div class="' + cls + '" data-rv="room" data-room="' + esc(c.name) + '" role="button" tabindex="0" aria-pressed="' + (v.sel === c.name) + '" aria-label="' + esc(label) + '">' +
          '<span class="' + sw + '" aria-hidden="true"></span>' +
          '<span class="krv-rtext"><span class="rv-cn krv-rname">' + esc(c.name) + marks + '</span><span class="krv-rsub" title="' + esc(sub) + '">' + esc(sub) + '</span></span>' +
          (c.pcs.length ? '<span class="rv-chips krv-heads">' + c.pcs.map(function (p) { return headBtn(p, v, false); }).join('') + '</span>' : '') + '</div>';
      }).join('') + '</div></section>';
    });
    box.innerHTML = h || '<p class="rv-empty krv-empty">The roll has no rooms to show.</p>';
  }

  /* ---------- in and out ---------- */
  function on() { var K = W && W.B68Kit; return !!(K && typeof K.ready === 'function' && K.ready('desk') && ui()); }
  function frame(box, inn) {
    if (!box || !box.classList) return;
    box.classList.toggle('krv', !!inn);
    if (inn) { Array.prototype.forEach.call(box.querySelectorAll('.rv-pop'), function (p) { p.classList.add('krv-pop'); }); if (ui() && ui().guardBusy) ui().guardBusy(box); }
  }
  function follow() { var RV = W && W.B68GmRunView; if (RV && typeof RV.redrawAll === 'function') { try { RV.redrawAll(); } catch (e) { if (W.console) W.console.error(e); } } }
  function later(fn) { if (W && typeof W.setTimeout === 'function') W.setTimeout(fn, 0); else fn(); }
  function start() {
    if (listening || !W || !W.B68Kit || typeof W.B68Kit.onChange !== 'function') return;
    listening = true;
    W.B68Kit.onChange(function (ev) { if (ev && ev.name === 'desk') later(follow); });
    later(follow);      /* no replay: a view drawn before this file arrived draws again now */
  }

  M.on = on; M.head = head; M.toolbar = toolbar; M.legend = legend; M.board = board; M.frame = frame; M.start = start; M.menu = menu;
  M.parse = parse; M.redress = redress; M.knowWord = knowWord; M.clockMeter = clockMeter; M.alarmChip = alarmChip; M.inner = inner;
  return M;
});
