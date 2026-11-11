/* gm/stamp.js — the stamp before the roll (suite 1.3, switch spine.stamp) and the consequence sizer (1.4, switch spine.sizer).

   Plain script, UMD: window.B68GmStamp in the browser, module.exports under Node. GM side only. The pure parts touch nothing; create(host) holds the
   state of one GM page and reaches the page only through the host it is given, so a node test can drive it with a fake.

   THE STAMP (1.3; since the night rebuild, N4, part of the Roll, gm/roll.js). The position (the console's own, one value: host.currentPosition), an
   effect (standard until another is picked, and standard again once a roll is resolved) and the Roll's one-line threatened consequence (host.line: the
   console's Threat on screen, one field). fire() ("Stamp it on the iPad"), or a cue through stampNow(), puts the ACTION REPORT card (show kind `report`,
   functions/_lib/show.js) on the iPad and logs the stamp to night.log; picking an effect never fires it. The card stays up until the result is marked
   (mark()), until Esc, or until clear(); the server holds a beat for at most three minutes, so while it is pending the card is laid again every 170
   seconds. Nothing goes to a phone (D3). Taking the card down never touches the lasting layers, and only happens while the overlay up is still this
   stamp's own. This file listens for no key: Esc reaches the stamp through the page's one Esc (gm/esc.js, the entry the page registers as kind 'stamp').

   THE SIZER (1.4). When a 4/5 or a 1-3 is marked on a stamped roll (only then), offer the consequence at FULL size for the stamped position: the severity, ticks and
   harm come from the pack's own table (host.positions(), the console's positions, which read the pack at run time; no number is written here), and the
   lines are this room's "If it goes wrong" lines from the prep note. Reducing takes a second, deliberate tap: the first arms the button, the second
   (within six seconds) shows the size one position down the ladder, and Restore puts the full size back.

   THE ROOM'S LINES. goesWrong(md) reads a room's Markdown (gm/room-notes.js byRoom[].md). A line that starts, after any quote marks, bullet or bold marks,
   with "If it goes wrong" (a colon or dash after it is optional) gives the rest of the line; a bare "If it goes wrong" line or heading gives the bullet
   or paragraph lines under it, up to the next blank line or heading. Text in code fences is never read. "This room" is the room the page names: the Run
   view's selected room, else the room most of the crew are in on the running night (pickRoom; a tie goes to the room named first).

   THE ROLL'S LINE (N4). The page keeps one line (the GM state's con.live.threat) and prefills it from this room with seedLine(cur, room, lines, mem): the
   text to put in the line now, or null to leave it. mem is the page's own memory (never stored): { seed: { room, line } the line last put there from a
   room, cleared: { room } the room where the GM emptied the line }. A line the GM typed (anything but the last seeded line) is never replaced; an empty
   line, or the line seeded from a room before, takes this room's first line; a line the GM emptied stays empty until the room changes (lineCleared()).

   API
     POSITIONS EFFECTS LADDER EFFECT0 ('standard') TEXT_MAX
     cutText(v, n) -> a single line, control characters gone, at most n characters
     goesWrong(md) -> [line]            pickRoom(crewRooms) -> room name | ''          roomLines(roomNotes, roomName, normFn?) -> [line]
     seedLine(cur, room, lines, mem) -> text | null              lineCleared(room, mem)
     stampLine(st) -> the night.log text          payload(st) -> the report beat's payload
     sizeOf(positions, pos) -> { position, severity, ticks, harm } | null        lower(pos) -> the next position down | ''
     create(host) -> controller
       host: { feature(id) -> bool, positions() -> [{ value, severity, ticks, harm }], roomLines() -> [line], currentPosition() -> pos | '',
               setPosition(pos), show(payload, key, ms) -> Promise<answer | null>, overlayId() -> id the iPad is showing, clearOverlay() -> Promise,
               log(text), toast(msg, bad), now() -> ms, keyFor(key) -> overlay id the show will have, setTimeout/clearTimeout, changed(),
               threat(stamp) and threatClear() (optional: the map.threat glyph, gm/map-threat.js), stamped({ position, effect, text, at }) (optional:
               called once each time a stamp goes up, by fire, Stamp again or a cue: the page asks Blade for the fit, vault Projects/blades-68-fixer-on-the-stamp),
               line() and setLine(text) (optional: the Roll's one line; without them the controller keeps its own draft text, as before N4),
               KS15 (read only while the setting kit.stage is on): who() -> the picked Who's name, covered() -> true while the iPad is blank or in PANIC,
               vet(payload) -> false when the page's own check would refuse that report (optional),
               and show's fourth argument { replace: true } (lay the key's id again, no ifNotOverlay) }
       KS15, THE ROLL AS BEATS (kit.stage on; off, nothing here changes): the stamp's payload carries who; mark(result) lays the SAME beat again with its
       result (RESULT_MS, then the server lets it go and the iPad folds it into its last-roll chip) instead of taking it down, while the beat up is
       still this stamp's and the iPad is not covered (otherwise it is today's mark). After a 4/5 or a 1-3, view().cost = { result, draft, sent } is the
       Roll's "Cost on the iPad" field: costDraft(text) keeps what is typed, sendCost(text?) lays the beat again with the cost (COST_MS); nothing goes
       unless it is sent, a refusal says so and keeps the text. Take it down, Esc, Clean, a new stamp, dismiss(), PANIC, Blank and another show taking
       over end the cost (view().beats: the setting is on); a mark while a result is
       up takes it down. A write that lands after its stamp was taken down is taken straight back off.
       controller: view() draft(pos|eff|text) fire() stampNow(pos, eff, text) mark(result) esc() clear() reduce() restore() dismiss() seed() destroy()
                   result is '45', '13' or 'clean'. view() -> { on, draft: { position, effect, text }, active, stale, sizer }: stale is true while the
                   stamp is up and the position, effect or line set now differs from it (the Roll offers Stamp again). stampNow(pos, eff, '') stamps
                   the Roll's line; stampNow with a text makes that text the line (one field, one value). */
(function (root, factory) {
  'use strict';
  var M = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmStamp = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var POSITIONS = ['controlled', 'risky', 'desperate'], EFFECTS = ['limited', 'standard', 'great'], EFFECT0 = 'standard';
  var LADDER = ['desperate', 'risky', 'controlled'];          /* worst first: reducing a consequence moves along it */
  var TEXT_MAX = 100, LINE_MAX = 140, LINES_MAX = 5, REFRESH_MS = 170000, ARM_MS = 6000, SHOW_MS = 180000;
  var KEY = { stamp: 'spine.stamp', sizer: 'spine.sizer', stage: 'kit.stage' };
  /* KS15 (the roll as beats, kit.stage): a result stands RESULT_MS on the iPad, a cost COST_MS; then the server lets it go and the iPad folds it into
     its last-roll chip. who and cost are cut to the show contract's bounds (functions/_lib/show.js report) */
  var RESULTS = ['clean', '45', '13'], RESULT_MS = 8000, COST_MS = 10000, WHO_MAX = 40, COST_MAX = 60, WATCH_MS = 1000;

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

  /* ---------- the Roll's line, prefilled from the room (N4) ---------- */
  function seedLine(cur, room, lines, mem) {
    if (!isObj(mem)) return null;
    var c = cutText(cur, TEXT_MAX), r = str(room), first = cutText(Array.isArray(lines) && lines.length ? lines[0] : '', TEXT_MAX);
    if (!first) return null;
    if (c === first) { mem.seed = { room: r, line: first }; return null; }            /* already this room's line (also after a reload) */
    if (c && !(isObj(mem.seed) && mem.seed.line === c)) return null;                   /* the GM's own line: never replaced */
    if (!c && isObj(mem.cleared) && mem.cleared.room === r) return null;              /* emptied here by the GM: stays empty in this room */
    mem.seed = { room: r, line: first }; mem.cleared = null;
    return first;
  }
  function lineCleared(room, mem) { if (isObj(mem)) mem.cleared = { room: str(room) }; }

  /* ---------- the stamp and the size ---------- */
  function payload(st) {
    var p = { position: st.position, effect: st.effect }, t = cutText(st.text, TEXT_MAX);
    if (t) p.text = t;
    /* KS15 (kit.stage): who goes for it, the result and the cost; only a stamp made with the setting on carries them */
    var w = cutText(st.who, WHO_MAX), c = cutText(st.cost, COST_MAX);
    if (w) p.who = w;
    if (RESULTS.indexOf(st.result) >= 0) p.result = st.result;
    if (c) p.cost = c;
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
    var d = { position: '', effect: EFFECT0, text: '' };     /* what is being set (the text only when the page keeps no line of its own) */
    var active = null;                                        /* the stamp on the iPad: { position, effect, text, key, id, at } */
    var sizer = null;                                         /* { position, result, lines, text, armed, reduced } */
    var seeded = '', refreshT = null, armT = null, n = 0;
    var last = null, foldT = null, watchT = null;                         /* KS15: the resolved roll a cost may follow ({ st, draft, sent }); the result's fold timer */

    function on(id) { return typeof host.feature === 'function' ? !!host.feature(id) : false; }
    function changed() { if (typeof host.changed === 'function') host.changed(); }
    function toast(m, bad) { if (typeof host.toast === 'function') host.toast(m, bad); }
    function setT(fn, ms) { return typeof host.setTimeout === 'function' ? host.setTimeout(fn, ms) : setTimeout(fn, ms); }
    function clrT(h) { if (h === null) return; if (typeof host.clearTimeout === 'function') host.clearTimeout(h); else clearTimeout(h); }
    function now() { return typeof host.now === 'function' ? host.now() : Date.now(); }

    function stopRefresh() { if (refreshT !== null) clrT(refreshT); refreshT = null; }
    function stopArm() { if (armT !== null) clrT(armT); armT = null; }

    /* the one position (the console's) and the one line (the Roll's), with the controller's own draft as the fallback */
    function hasLine() { return typeof host.line === 'function'; }
    function lineNow() { if (!hasLine()) return d.text; try { return cutText(host.line(), TEXT_MAX); } catch (e) { return ''; } }
    function setLine(t) { if (hasLine() && typeof host.setLine === 'function') { if (t !== lineNow()) host.setLine(t); } else d.text = t; }
    function posNow() { var p = typeof host.currentPosition === 'function' ? str(host.currentPosition()) : ''; return POSITIONS.indexOf(p) >= 0 ? p : d.position; }

    function lines() { try { return (typeof host.roomLines === 'function' ? host.roomLines() : []) || []; } catch (e) { return []; } }
    /* without a line of the page's own: the consequence box starts as this room's first line while the sizer is on (1.4 pre-fills 1.3's line); a line
       the GM typed is never replaced. With one (the Roll), the page prefills its line itself (seedLine) and this does nothing. */
    function seed() {
      if (hasLine() || !on(KEY.sizer) || active) return false;
      if (d.text && d.text !== seeded) return false;
      var l = lines()[0] || '';
      if (!l || l === d.text) return false;
      d.text = seeded = cutText(l, TEXT_MAX);
      return true;
    }

    function overlayIsMine() { return !!active && typeof host.overlayId === 'function' && host.overlayId() === active.id; }
    function takeDown() {
      var mine = overlayIsMine();
      stopRefresh(); stopFold();
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

    /* ---------- KS15: the roll as beats (kit.stage) ----------
       The result and the cost are the stamp's own beat laid AGAIN under its id (show(..., { replace: true }): no ifNotOverlay), so the guard is here:
       nothing is laid again unless the overlay up is still this stamp's, the iPad is not blank or in PANIC (host.covered()), and nothing took the
       stamp down while the write was out (if something did, the late write is taken back off). */
    function stopFold() { if (foldT !== null) clrT(foldT); foldT = null; }
    function foldLater(st, ms) { stopFold(); foldT = setT(function () { foldT = null; if (active === st) { active = null; changed(); } }, ms); }
    function covered() { try { return typeof host.covered === 'function' && !!host.covered(); } catch (e) { return true; } }
    function copy(st) { var o = {}; ['position', 'effect', 'text', 'who', 'at', 'key', 'id', 'result', 'cost'].forEach(function (k) { if (st[k] !== undefined) o[k] = st[k]; }); return o; }
    function upId() { return typeof host.overlayId === 'function' ? str(host.overlayId()) : ''; }
    function relay(st, ms) { return Promise.resolve(host.show(payload(st), st.key, ms, { replace: true })).then(null, function () { return null; }); }
    /* a write that landed after its stamp was taken down: take it straight back off (only while it is what is up) */
    function takeBack(st) { if (active === null && upId() === st.id && typeof host.clearOverlay === 'function') return Promise.resolve(host.clearOverlay()).then(null, function () { return null; }); return null; }
    /* the mark of a stamp that is up: the card comes down; on a 4/5 or a 1-3 the sizer offers the size (unchanged since 1.4) */
    function markPlain(st, result) {
      return takeDown().then(function () {
        stopArm();
        if (on(KEY.sizer) && (result === '45' || result === '13') && POSITIONS.indexOf(st.position) >= 0) {
          sizer = { position: st.position, result: result, lines: lines(), text: cutText(st.text, TEXT_MAX), armed: false, reduced: false };
        } else sizer = null;
        d.effect = EFFECT0;
        if (!hasLine()) { d.text = ''; seeded = ''; }
        changed();
        return true;
      });
    }
    /* the roll is resolved already (its result or cost is up): any mark takes it down, as for a roll with no stamp, whatever the setting says now */
    function markResolved(result) {
      last = null;
      return takeDown().then(function () { stopArm(); if ((result === '45' || result === '13') && d.effect !== EFFECT0) d.effect = EFFECT0; changed(); return false; });
    }
    function markStage(st, result) {
      if (!overlayIsMine() || covered()) return markPlain(st, result);      /* another show is up, PANIC cleared it, or the iPad is blank: today's mark */
      stopRefresh(); stopArm();
      var next = copy(st); next.result = result;
      return relay(next, RESULT_MS).then(function (r) {
        if (active !== st) { takeBack(next); return false; }                  /* Esc, Take it down or a new stamp came while it was out */
        if (!r) return markPlain(st, result);                                  /* refused: the card comes down, as today */
        active = next;
        if (typeof host.threatClear === 'function') host.threatClear();
        sizer = on(KEY.sizer) && (result === '45' || result === '13') ? { position: st.position, result: result, lines: lines(), text: cutText(st.text, TEXT_MAX), armed: false, reduced: false } : null;
        d.effect = EFFECT0;
        if (!hasLine()) { d.text = ''; seeded = ''; }
        last = result === 'clean' ? null : { st: next, draft: '', sent: '' };
        if (last) watchCost();
        foldLater(next, RESULT_MS); changed();
        return true;
      });
    }
    /* the cost field (KS15.4): kept here so a redraw of the Roll never loses what is typed; nothing goes until sendCost.
       It ENDS (as Take it down ends it) the moment the iPad moves on: PANIC, Blank, another show taking over, or the overlay cleared from
       elsewhere. A once-a-second look while the field is open (the page's ambient document and display kind, no request), and again on Enter,
       so a stale cost can never put the roll back minutes later */
    function costGone(L) { return covered() || upId() !== L.st.id; }
    function stopWatch() { if (watchT !== null) clrT(watchT); watchT = null; }
    function endCost() { if (!last) return; last = null; stopWatch(); changed(); }
    function watchCost() { stopWatch(); watchT = setT(function () { watchT = null; if (!last) return; if (costGone(last)) endCost(); else watchCost(); }, WATCH_MS); }
    function costDraft(v) { if (last) last.draft = str(v).replace(/[\r\n]+/g, ' ').slice(0, COST_MAX); }
    function sendCost(v) {
      if (!last || !on(KEY.stage)) return Promise.resolve(false);
      if (v !== undefined) costDraft(v);
      var L = last, c = cutText(L.draft, COST_MAX);
      if (!c) { toast('Type the cost first. Nothing goes until it is sent.', true); return Promise.resolve(false); }
      if (costGone(L)) { endCost(); toast('The iPad has moved on, so the cost was not sent.', true); return Promise.resolve(false); }
      var next = copy(L.st); next.cost = c;
      /* the page's own check first (KS15 review): a hidden name gets this message alone, not the page's general refusal */
      if (typeof host.vet === 'function' && !host.vet(payload(next))) { toast('The cost did not go to the iPad. It is still in the field.', true); return Promise.resolve(false); }
      stopRefresh();
      return relay(next, COST_MS).then(function (r) {
        if (last !== L) { if (r) takeBack(next); return false; }
        if (!r) { toast('The cost did not go to the iPad. It is still in the field.', true); return false; }
        L.sent = c; L.st = next; active = next;
        foldLater(next, COST_MS); changed();
        return true;
      });
    }

    /* fire the stamp now: -> Promise<boolean> (false: nothing went up, what is set stays). No text: the Roll's line (a cue's "Blade, risky, standard");
       a text: it becomes the Roll's line too */
    function stampNow(pos, eff, text) {
      if (!on(KEY.stamp)) return Promise.resolve(false);
      if (POSITIONS.indexOf(pos) < 0 || EFFECTS.indexOf(eff) < 0) { toast('A stamp needs a position and an effect.', true); return Promise.resolve(false); }
      var t = cutText(text, TEXT_MAX); if (!t && hasLine()) t = lineNow();
      var st = { position: pos, effect: eff, text: t, at: now() };
      if (on(KEY.stage) && typeof host.who === 'function') { var w = ''; try { w = cutText(host.who(), WHO_MAX); } catch (e) {} if (w) st.who = w; }   /* KS15: who goes for it */
      var prevActive = active;
      return lay(st).then(function (r) {
        if (!r) return false;                               /* refused (a hidden name, the gate): the page already said why */
        active = st; sizer = null; stopArm(); stopFold(); last = null;      /* a new stamp replaces whatever beat was up, and the cost it could have had */
        d.position = pos; d.effect = eff; setLine(st.text);
        if (typeof host.log === 'function') host.log(stampLine(st));
        if (typeof host.setPosition === 'function' && typeof host.currentPosition === 'function' && host.currentPosition() !== pos) host.setPosition(pos);
        schedule(); changed();
        if (typeof host.threat === 'function') host.threat(st);               /* suite 2.5: the glyph drops on the room before the dice */
        if (typeof host.stamped === 'function') { try { host.stamped({ position: st.position, effect: st.effect, text: st.text, at: st.at }); } catch (e) {} }   /* 08/11: asks Blade for the fit */
        return true;
      }, function () { active = prevActive; return false; });
    }
    /* "Stamp it on the iPad" (and Stamp again): what is set now */
    function fire() {
      var pos = posNow();
      if (POSITIONS.indexOf(pos) < 0) { toast('Pick a position first.', true); changed(); return Promise.resolve(false); }
      return stampNow(pos, d.effect || EFFECT0, lineNow());
    }
    /* setting the position, the effect or the line: nothing goes up until fire() */
    function draft(k, v) {
      if (!on(KEY.stamp)) return Promise.resolve(false);
      if (k === 'text') { var t = cutText(v, TEXT_MAX); if (hasLine()) setLine(t); else { d.text = t; if (d.text !== seeded) seeded = ''; } changed(); return Promise.resolve(false); }
      if (k === 'pos') {
        if (POSITIONS.indexOf(v) < 0) return Promise.resolve(false);
        d.position = v;
        if (typeof host.setPosition === 'function' && typeof host.currentPosition === 'function' && host.currentPosition() !== v) host.setPosition(v);
        changed(); return Promise.resolve(false);
      }
      if (k === 'eff') {
        if (EFFECTS.indexOf(v) < 0) return Promise.resolve(false);
        d.effect = v; changed();
        return Promise.resolve(false);
      }
      return Promise.resolve(false);
    }

    /* Esc and Take it down: the card comes down; what is set stays, so it can go up again */
    function clear() {
      last = null;      /* KS15: once taken down, a late cost can never put it back */
      return takeDown().then(function () { if (!hasLine() && (!d.text || d.text === seeded)) d.text = seeded = ''; sizer = null; stopArm(); changed(); });
    }
    function esc() { return clear(); }
    /* the result is marked: on a stamped roll '45' or '13' offers the size (sizer on), 'clean' just takes the card down. Either way the roll is resolved:
       the effect is standard again (the line is the Roll's: it stays until the GM spends or clears it). With no stamp up there is no size to offer (the
       Roll's position is always set since N4, so "a position set" no longer says anything: the size belongs to the stamped promise) */
    function mark(result) {
      var st = active;
      if (!st) { last = null; if (on(KEY.stamp) && (result === '45' || result === '13') && d.effect !== EFFECT0) { d.effect = EFFECT0; changed(); } return Promise.resolve(false); }
      if (st.result) return markResolved(result);                                           /* KS15: its result is up already */
      if (on(KEY.stage) && RESULTS.indexOf(result) >= 0) return markStage(st, result);      /* KS15: the result goes on the iPad */
      return markPlain(st, result);
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
    function dismiss() { var had = !!last; last = null; if (!sizer) { if (had) changed(); return; } sizer = null; stopArm(); changed(); }

    /* what the page draws */
    function view() {
      var pos = posNow(), line = lineNow();
      var out = { on: on(KEY.stamp), draft: { position: pos, effect: d.effect, text: line }, active: active ? { position: active.position, effect: active.effect, text: active.text } : null,
        stale: !!active && (active.position !== pos || active.effect !== d.effect || active.text !== line), sizer: null };
      if (sizer && on(KEY.sizer)) {
        var shown = sizer.reduced ? lower(sizer.position) : sizer.position, positions = typeof host.positions === 'function' ? host.positions() : [];
        out.sizer = { stamped: sizer.position, shown: shown, reduced: sizer.reduced, armed: sizer.armed, canReduce: !!lower(sizer.position) && !sizer.reduced,
          size: sizeOf(positions, shown), lines: sizer.lines.slice(), text: sizer.text, result: sizer.result };
      }
      /* KS15 (kit.stage): what beat is up (the result, the cost) and the cost field after a 4/5 or a 1-3 */
      if (out.active && active.result) { out.active.result = active.result; if (active.who) out.active.who = active.who; if (active.cost) out.active.cost = active.cost; }
      if (last && on(KEY.stage)) out.cost = { result: last.st.result, draft: last.draft, sent: last.sent };
      if (out.on && on(KEY.stage)) out.beats = true;      /* the Roll says what Clean does now (gm/roll.js stampHtml) */
      return out;
    }
    function destroy() { stopRefresh(); stopArm(); stopFold(); stopWatch(); }
    return { view: view, draft: draft, fire: fire, stampNow: stampNow, mark: mark, esc: esc, clear: clear, reduce: reduce, restore: restore, dismiss: dismiss, seed: seed, destroy: destroy,
      costDraft: costDraft, sendCost: sendCost };
  }

  return { POSITIONS: POSITIONS, EFFECTS: EFFECTS, EFFECT0: EFFECT0, LADDER: LADDER, TEXT_MAX: TEXT_MAX, cutText: cutText, goesWrong: goesWrong, pickRoom: pickRoom, roomLines: roomLines,
    seedLine: seedLine, lineCleared: lineCleared, stampLine: stampLine, payload: payload, sizeOf: sizeOf, lower: lower, create: create };
});
