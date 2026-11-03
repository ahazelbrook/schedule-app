/* gm/stamp.js — the stamp before the roll (suite 1.3, switch spine.stamp) and the consequence sizer (1.4, switch spine.sizer).

   Plain script, UMD: window.B68GmStamp in the browser, module.exports under Node. GM side only. The pure parts touch nothing; create(host) holds the
   state of one GM page and reaches the page only through the host it is given, so a node test can drive it with a fake.

   THE STAMP (1.3). Two taps, position then effect, plus a one-line threatened consequence. The second tap puts the ACTION REPORT card (show kind
   `report`, functions/_lib/show.js) on the iPad and logs the stamp to night.log. It stays up until the result is marked (mark()), until Esc, or until
   clear(); the server holds a beat for at most three minutes, so while it is pending the card is laid again every 170 seconds. Nothing goes to a phone (D3).
   Taking the card down never touches the lasting layers, and only happens while the overlay up is still this stamp's own.

   THE SIZER (1.4). When a 4/5 or a 1-3 is marked on a stamped roll, offer the consequence at FULL size for the stamped position: the severity, ticks and
   harm come from the pack's own table (host.positions(), the console's positions, which read the pack at run time; no number is written here), and the
   lines are this room's "If it goes wrong" lines from the prep note. Reducing takes a second, deliberate tap: the first arms the button, the second
   (within six seconds) shows the size one position down the ladder, and Restore puts the full size back.

   THE ROOM'S LINES. goesWrong(md) reads a room's Markdown (gm/room-notes.js byRoom[].md). A line that starts, after any quote marks, bullet or bold marks,
   with "If it goes wrong" (a colon or dash after it is optional) gives the rest of the line; a bare "If it goes wrong" line or heading gives the bullet
   or paragraph lines under it, up to the next blank line or heading. Text in code fences is never read. "This room" is the room most of the crew are in
   on the running night (pickRoom; a tie goes to the room named first).

   API
     POSITIONS EFFECTS LADDER
     cutText(v, n) -> a single line, control characters gone, at most n characters
     goesWrong(md) -> [line]            pickRoom(crewRooms) -> room name | ''          roomLines(roomNotes, roomName, normFn?) -> [line]
     stampLine(st) -> the night.log text          payload(st) -> the report beat's payload
     sizeOf(positions, pos) -> { position, severity, ticks, harm } | null        lower(pos) -> the next position down | ''
     create(host) -> controller
       host: { feature(id) -> bool, positions() -> [{ value, severity, ticks, harm }], roomLines() -> [line], currentPosition() -> pos | '',
               setPosition(pos), show(payload, key, ms) -> Promise<answer | null>, overlayId() -> id the iPad is showing, clearOverlay() -> Promise,
               log(text), toast(msg, bad), now() -> ms, keyFor(key) -> overlay id the show will have, setTimeout/clearTimeout, changed(),
               threat(stamp) and threatClear() (optional: the map.threat glyph, gm/map-threat.js) }
       controller: view() draft(pos|eff|text) fire() stampNow(pos, eff, text) mark(result) esc() clear() reduce() restore() dismiss() seed()
                   result is '45', '13' or 'clean' */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmStamp = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var POSITIONS = ['controlled', 'risky', 'desperate'], EFFECTS = ['limited', 'standard', 'great'];
  var LADDER = ['desperate', 'risky', 'controlled'];          /* worst first: reducing a consequence moves along it */
  var TEXT_MAX = 100, LINE_MAX = 140, LINES_MAX = 5, REFRESH_MS = 170000, ARM_MS = 6000, SHOW_MS = 180000;
  var KEY = { stamp: 'spine.stamp', sizer: 'spine.sizer' };

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function cutText(v, n) {
    var s = str(v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
    return s.length > n ? s.slice(0, n).trim() : s;
  }
  function lower(pos) { var i = LADDER.indexOf(pos); return i >= 0 && i < LADDER.length - 1 ? LADDER[i + 1] : ''; }

  /* ---------- the room's lines ---------- */
  function plain(s) {
    return str(s).replace(/<!--[\s\S]*?-->/g, ' ').replace(/!?\[\[([^\]|]*)\|([^\]]*)\]\]/g, '$2').replace(/!?\[\[([^\]]*)\]\]/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/(\*\*|__|==|~~|`)/g, '').replace(/(^|[^\w])[*_]([^*_]+)[*_]/g, '$1$2').replace(/\s+/g, ' ').trim();
  }
  var LABEL = /^\s*(?:>\s*)*(?:#{1,6}\s+)?(?:[-*+]\s+)?(?:\*\*|__)?\s*if it goes wrong\b\s*(?:\*\*|__)?\s*[:–—-]?\s*(?:\*\*|__)?\s*(.*)$/i;
  var FENCE = /^ {0,3}(`{3,}|~{3,})/;
  function goesWrong(md) {
    var out = [], fence = null, lines = str(md).replace(/\r\n?/g, '\n').split('\n'), under = false;
    function add(t) { var p = cutText(plain(t), LINE_MAX); if (p && out.length < LINES_MAX && out.indexOf(p) < 0) out.push(p); }
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i], f = FENCE.exec(ln);
      if (fence) { if (f && f[1].charAt(0) === fence.charAt(0) && f[1].length >= fence.length) fence = null; continue; }
      if (f) { fence = f[1]; under = false; continue; }
      var m = LABEL.exec(ln);
      if (m) {
        var rest = m[1].replace(/^(?:\*\*|__)\s*/, '');
        if (plain(rest)) { add(rest); under = false; } else under = true;
        continue;
      }
      if (under) {
        if (!/\S/.test(ln) || /^\s*#{1,6}\s/.test(ln)) { under = false; continue; }
        add(ln.replace(/^\s*(?:>\s*)*(?:[-*+]\s+|\d+[.)]\s+)?/, ''));
      }
    }
    return out;
  }
  function pickRoom(crewRooms) {
    var count = {}, best = '', n = 0;
    if (isObj(crewRooms)) Object.keys(crewRooms).forEach(function (k) { var r = str(crewRooms[k]).trim(); if (r) { count[r] = (count[r] || 0) + 1; if (count[r] > n) { n = count[r]; best = r; } } });
    return best;
  }
  function roomLines(roomNotes, roomName, normFn) {
    if (!isObj(roomNotes) || !isObj(roomNotes.byRoom) || !str(roomName)) return [];
    var nf = typeof normFn === 'function' ? normFn : function (s) { return str(s).toLowerCase().replace(/^the\s+/, '').replace(/[^a-z0-9]+/g, ' ').trim(); };
    var keys = Object.keys(roomNotes.byRoom), want = nf(roomName), hit = '';
    for (var i = 0; i < keys.length; i++) if (keys[i] === roomName || nf(keys[i]) === want) { hit = keys[i]; break; }
    var r = hit ? roomNotes.byRoom[hit] : null;
    return isObj(r) ? goesWrong(r.md) : [];
  }

  /* ---------- the stamp and the size ---------- */
  function payload(st) {
    var p = { position: st.position, effect: st.effect }, t = cutText(st.text, TEXT_MAX);
    if (t) p.text = t;
    return p;
  }
  function stampLine(st) { var t = cutText(st.text, TEXT_MAX); return 'Stamp: ' + st.position + ', ' + st.effect + (t ? ' - ' + t : ''); }
  function sizeOf(positions, pos) {
    var list = Array.isArray(positions) ? positions : [];
    for (var i = 0; i < list.length; i++) if (isObj(list[i]) && list[i].value === pos) return { position: pos, severity: str(list[i].severity), ticks: str(list[i].ticks), harm: str(list[i].harm) };
    return null;
  }

  /* ---------- the controller ---------- */
  function create(host) {
    host = host || {};
    var d = { position: '', effect: '', text: '' };           /* what is being set */
    var active = null;                                        /* the stamp on the iPad: { position, effect, text, key, id, at } */
    var sizer = null;                                         /* { position, lines, armed, reduced } */
    var seeded = '', refreshT = null, armT = null, n = 0, offKey = null;

    function on(id) { return typeof host.feature === 'function' ? !!host.feature(id) : false; }
    function changed() { if (typeof host.changed === 'function') host.changed(); }
    function toast(m, bad) { if (typeof host.toast === 'function') host.toast(m, bad); }
    function setT(fn, ms) { return typeof host.setTimeout === 'function' ? host.setTimeout(fn, ms) : setTimeout(fn, ms); }
    function clrT(h) { if (h === null) return; if (typeof host.clearTimeout === 'function') host.clearTimeout(h); else clearTimeout(h); }
    function now() { return typeof host.now === 'function' ? host.now() : Date.now(); }

    function stopRefresh() { if (refreshT !== null) clrT(refreshT); refreshT = null; }
    function stopArm() { if (armT !== null) clrT(armT); armT = null; }
    function listen(yes) {
      var doc = typeof host.doc === 'function' ? host.doc() : null;
      if (!doc || typeof doc.addEventListener !== 'function') return;
      if (yes && !offKey) { var h = function (ev) { if (ev && ev.key === 'Escape' && active) esc(); }; doc.addEventListener('keydown', h); offKey = function () { doc.removeEventListener('keydown', h); }; }
      if (!yes && offKey) { offKey(); offKey = null; }
    }

    function lines() { try { return (typeof host.roomLines === 'function' ? host.roomLines() : []) || []; } catch (e) { return []; } }
    /* the consequence box starts as this room's first line while the sizer is on (1.4 pre-fills 1.3's line); a line the GM typed is never replaced */
    function seed() {
      if (!on(KEY.sizer) || active) return false;
      if (d.text && d.text !== seeded) return false;
      var l = lines()[0] || '';
      if (!l || l === d.text) return false;
      d.text = seeded = cutText(l, TEXT_MAX);
      return true;
    }

    function overlayIsMine() { return !!active && typeof host.overlayId === 'function' && host.overlayId() === active.id; }
    function takeDown() {
      var mine = overlayIsMine();
      stopRefresh(); listen(false);
      if (typeof host.threatClear === 'function') host.threatClear();        /* suite 2.5: the glyph on the map clears with the stamp */
      var was = active; active = null;
      if (was && mine && typeof host.clearOverlay === 'function') return Promise.resolve(host.clearOverlay()).then(null, function () { return null; });
      return Promise.resolve(null);
    }
    function lay(st) {
      var key = 'stamp-' + (++n) + '-' + st.at, ms = SHOW_MS;
      st.key = key; st.id = typeof host.keyFor === 'function' ? host.keyFor(key) : key;
      return Promise.resolve(host.show(payload(st), key, ms));
    }
    function refresh() {
      refreshT = null;
      if (!active || !overlayIsMine()) return;               /* something else is up now: leave it be */
      var st = active, prev = st.id;
      lay(st).then(function (r) { if (active === st && r) schedule(); else if (active === st && !r) st.id = prev; });
    }
    function schedule() { stopRefresh(); refreshT = setT(refresh, REFRESH_MS); }

    /* fire the stamp now: -> Promise<boolean> (false: nothing went up, the draft stays) */
    function stampNow(pos, eff, text) {
      if (!on(KEY.stamp)) return Promise.resolve(false);
      if (POSITIONS.indexOf(pos) < 0 || EFFECTS.indexOf(eff) < 0) { toast('A stamp needs a position and an effect.', true); return Promise.resolve(false); }
      var st = { position: pos, effect: eff, text: cutText(text, TEXT_MAX), at: now() };
      var prevActive = active;
      return lay(st).then(function (r) {
        if (!r) return false;                               /* refused (a hidden name, the gate): the page already said why */
        active = st; sizer = null; stopArm();
        d.position = pos; d.effect = eff; d.text = st.text;
        if (typeof host.log === 'function') host.log(stampLine(st));
        if (typeof host.setPosition === 'function' && typeof host.currentPosition === 'function' && host.currentPosition() !== pos) host.setPosition(pos);
        listen(true); schedule(); changed();
        if (typeof host.threat === 'function') host.threat(st);               /* suite 2.5: the glyph drops on the room before the dice */
        return true;
      }, function () { active = prevActive; return false; });
    }
    function fire() { return stampNow(d.position, d.effect, d.text); }
    /* the two taps */
    function draft(k, v) {
      if (!on(KEY.stamp)) return Promise.resolve(false);
      if (k === 'text') { d.text = cutText(v, TEXT_MAX); if (d.text !== seeded) seeded = ''; return Promise.resolve(false); }
      if (k === 'pos') {
        if (POSITIONS.indexOf(v) < 0) return Promise.resolve(false);
        d.position = v;
        if (typeof host.setPosition === 'function' && typeof host.currentPosition === 'function' && host.currentPosition() !== v) host.setPosition(v);
        changed(); return Promise.resolve(false);
      }
      if (k === 'eff') {
        if (EFFECTS.indexOf(v) < 0) return Promise.resolve(false);
        d.effect = v;
        if (!d.position && typeof host.currentPosition === 'function' && POSITIONS.indexOf(host.currentPosition()) >= 0) d.position = host.currentPosition();
        if (!d.position) { toast('Pick a position first.', true); changed(); return Promise.resolve(false); }
        return fire();                                      /* position then effect: the second tap stamps */
      }
      return Promise.resolve(false);
    }

    function clear() {
      return takeDown().then(function () { d.effect = ''; if (!d.text || d.text === seeded) d.text = seeded = ''; sizer = null; stopArm(); changed(); });
    }
    function esc() { return clear(); }
    /* the result is marked: '45' or '13' offers the size (sizer on), 'clean' just takes the card down */
    function mark(result) {
      var st = active;
      if (!st && !(d.position && on(KEY.sizer) && (result === '45' || result === '13'))) return Promise.resolve(false);
      var stamped = st || { position: d.position, text: d.text };
      return takeDown().then(function () {
        stopArm();
        if (on(KEY.sizer) && (result === '45' || result === '13') && POSITIONS.indexOf(stamped.position) >= 0) {
          sizer = { position: stamped.position, result: result, lines: lines(), armed: false, reduced: false };
        } else sizer = null;
        d.effect = ''; d.text = ''; seeded = '';
        changed();
        return true;
      });
    }
    function reduce() {
      if (!sizer || sizer.reduced) return false;
      if (!lower(sizer.position)) { toast('Already the smallest.', false); return false; }
      if (!sizer.armed) {
        sizer.armed = true; stopArm(); armT = setT(function () { armT = null; if (sizer) { sizer.armed = false; changed(); } }, ARM_MS);
        changed(); return false;
      }
      sizer.armed = false; sizer.reduced = true; stopArm(); changed();
      return true;
    }
    function restore() { if (!sizer) return false; sizer.armed = false; sizer.reduced = false; stopArm(); changed(); return true; }
    function dismiss() { sizer = null; stopArm(); changed(); }

    /* what the page draws */
    function view() {
      var out = { on: on(KEY.stamp), draft: { position: d.position, effect: d.effect, text: d.text }, active: active ? { position: active.position, effect: active.effect, text: active.text } : null, sizer: null };
      if (sizer && on(KEY.sizer)) {
        var shown = sizer.reduced ? lower(sizer.position) : sizer.position, positions = typeof host.positions === 'function' ? host.positions() : [];
        out.sizer = { stamped: sizer.position, shown: shown, reduced: sizer.reduced, armed: sizer.armed, canReduce: !!lower(sizer.position) && !sizer.reduced,
          size: sizeOf(positions, shown), lines: sizer.lines.slice(), result: sizer.result };
      }
      return out;
    }
    function destroy() { stopRefresh(); stopArm(); listen(false); }
    return { view: view, draft: draft, fire: fire, stampNow: stampNow, mark: mark, esc: esc, clear: clear, reduce: reduce, restore: restore, dismiss: dismiss, seed: seed, destroy: destroy };
  }

  /* ---------- the row on the GM page (plain DOM, no innerHTML from text: every string is set with textContent) ---------- */
  function cap(s) { s = str(s); return s.charAt(0).toUpperCase() + s.slice(1); }
  function mkEl(doc, tag, cls, text) { var e = doc.createElement(tag); if (cls) e.className = cls; if (text != null && text !== '') e.textContent = text; return e; }
  function btn(doc, label, act, v, pressed, title) {
    var b = mkEl(doc, 'button', 'chip sm gm-st-b', label); b.type = 'button'; b.setAttribute('data-st', act);
    if (v !== undefined) b.setAttribute('data-v', v);
    if (pressed !== undefined) b.setAttribute('aria-pressed', pressed ? 'true' : 'false');
    if (title) b.title = title;
    return b;
  }
  /* draw the row into `box` from ctl.view(); returns nothing. The consequence field keeps what is being typed across a redraw. */
  function paint(doc, box, ctl, hostBits) {
    var v = ctl.view(), typed = box.querySelector ? box.querySelector('input[data-st-text]') : null, hadFocus = !!typed && doc.activeElement === typed, keep = typed ? typed.value : null;
    while (box.firstChild) box.removeChild(box.firstChild);
    if (!v.on) { box.hidden = true; return; }
    box.hidden = false;
    var dr = v.draft;
    var row = mkEl(doc, 'div', 'gm-st-row');
    row.appendChild(mkEl(doc, 'span', 'gm-lab', 'Stamp'));
    POSITIONS.forEach(function (p) { row.appendChild(btn(doc, cap(p), 'pos', p, dr.position === p)); });
    EFFECTS.forEach(function (e) { row.appendChild(btn(doc, cap(e), 'eff', e, dr.effect === e)); });
    box.appendChild(row);
    var f = mkEl(doc, 'div', 'gm-st-row');
    var inp = mkEl(doc, 'input', 'gm-st-text'); inp.type = 'text'; inp.maxLength = TEXT_MAX; inp.autocomplete = 'off'; inp.setAttribute('data-st-text', '1');
    inp.setAttribute('aria-label', 'If it goes wrong (one line)'); inp.placeholder = 'If it goes wrong: one line';
    inp.value = keep !== null && !v.active && keep !== dr.text && hadFocus ? keep : dr.text;
    f.appendChild(inp);
    if (v.active) {
      f.appendChild(btn(doc, 'Clean (no card)', 'clean', undefined, undefined, 'Take the card down; the roll needs no consequence'));
      f.appendChild(btn(doc, 'Take down (Esc)', 'esc'));
    }
    box.appendChild(f);
    if (v.active) box.appendChild(mkEl(doc, 'p', 'gm-st-note gm-dim', 'On the iPad: ' + cap(v.active.position) + ', ' + v.active.effect + (v.active.text ? ' - ' + v.active.text : '') + '. Up until the 4/5 or 1-3 is marked, or Esc.'));
    if (v.sizer) {
      var z = v.sizer, card = mkEl(doc, 'div', 'gm-st-sizer');
      card.appendChild(mkEl(doc, 'p', 'gm-lab', (z.reduced ? 'Reduced to ' + z.shown + ' (stamped ' + z.stamped + ')' : 'Full size for ' + z.stamped) + ' - ' + (z.result === '45' ? 'a 4/5' : 'a 1-3')));
      card.appendChild(mkEl(doc, 'p', 'gm-st-size', z.size ? z.size.severity + ' · ' + z.size.ticks + ' · harm ' + z.size.harm : 'The pack has no size for ' + z.shown + '.'));
      if (z.lines.length) { var ul = mkEl(doc, 'ul', 'gm-st-lines'); z.lines.forEach(function (l) { ul.appendChild(mkEl(doc, 'li', '', l)); }); card.appendChild(ul); }
      else card.appendChild(mkEl(doc, 'p', 'gm-dim', 'No "If it goes wrong" line for this room.'));
      var acts = mkEl(doc, 'div', 'gm-st-row');
      if (z.reduced) acts.appendChild(btn(doc, 'Restore full size', 'restore'));
      else if (z.canReduce) acts.appendChild(btn(doc, z.armed ? 'Tap again to reduce one step' : 'Reduce', 'reduce', undefined, undefined, 'Needs a second tap'));
      acts.appendChild(btn(doc, 'Done', 'dismiss'));
      card.appendChild(acts);
      box.appendChild(card);
    }
    if (hadFocus && typeof inp.focus === 'function') { try { inp.focus(); } catch (e) {} }
  }
  /* the taps: one delegated listener on the row's box. -> an unbind function */
  function bind(box, ctl) {
    function onClick(ev) {
      var t = ev.target && ev.target.closest ? ev.target.closest('[data-st]') : null; if (!t || !box.contains(t)) return;
      var a = t.getAttribute('data-st');
      if (a === 'pos' || a === 'eff') ctl.draft(a, t.getAttribute('data-v'));
      else if (a === 'clean') ctl.mark('clean');
      else if (a === 'esc') ctl.esc();
      else if (a === 'reduce') ctl.reduce();
      else if (a === 'restore') ctl.restore();
      else if (a === 'dismiss') ctl.dismiss();
    }
    function onInput(ev) { var t = ev.target; if (t && t.hasAttribute && t.hasAttribute('data-st-text')) ctl.draft('text', t.value); }
    function onKey(ev) { var t = ev.target; if (ev.key === 'Enter' && t && t.hasAttribute && t.hasAttribute('data-st-text')) { ev.preventDefault(); ctl.fire(); } }
    box.addEventListener('click', onClick); box.addEventListener('input', onInput); box.addEventListener('keydown', onKey);
    return function () { box.removeEventListener('click', onClick); box.removeEventListener('input', onInput); box.removeEventListener('keydown', onKey); };
  }

  return { POSITIONS: POSITIONS, EFFECTS: EFFECTS, LADDER: LADDER, cutText: cutText, goesWrong: goesWrong, pickRoom: pickRoom, roomLines: roomLines, stampLine: stampLine,
    payload: payload, sizeOf: sizeOf, lower: lower, create: create, paint: paint, bind: bind };
});
