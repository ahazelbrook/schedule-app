/* gm/room-show.js: Show on iPad for one line of a thing (RK10 of the room key build; setting room.key, bundle room-key).

   Window.B68GmRoomShow; in Node, require() returns the same object. It defines its module when it loads and reads other modules (B68Show,
   B68GmPage) only when called. The zoom card asks buttons(ctx) for its 'show' slot on every draw (the card's header has the hook).

   WHAT GOES. Two lines of a thing, and only these two, each as a title beat (gm/show.js 'title', text 80, sub 120) for 12 seconds:
     'thing'  Show on iPad           { text: the name, sub: the line }      (no line: the name alone)
     'look'   Show the closer look   { text: the name, sub: the closer look }   (offered only when the thing has one)
   The roll (the 4/5 and the 6) and the danger are never sendable: payload() knows no other line, so nothing here can put them in a beat.
   Nothing of a thing is sent, stored or drawn anywhere but the GM page until the GM taps one of these, and then only that beat goes.
   The sub's first letter is raised to a capital (a line reads "too heavy to tip." in the note).
   THE SAFETY NET: a roll or a danger the parser folded into the line or the closer look (written without its dash, or on the first line) is
   cut off: the text sent stops at the first dice, warning sign, "!" that starts the text or follows a space, or "Roll:" / "Danger:" (cut()).

   THE NAMES GATE. Before a beat goes, its words are scanned with the page's namesHit against hiddenSecretNames() (hidden NPCs, name and
   alias, and hidden clocks), as the spotlight is. A hidden NPC asks "This names someone hidden: reveal and show?"; a yes reveals them (the
   spotlight's reveal) and then shows, a no shows nothing. A hidden clock is never revealed from here: the beat is refused with a toast that
   names it. Then the site's hidden names (tokenHidden: rooms, threats, loot and obstacles the players have not seen) are scanned: a hit asks
   "This names something the players haven't seen yet: show anyway?" (its button: Show anyway); a yes sends the line alone (nothing is opened), a no sends nothing.
   The page's gate and the server scan the beat again; this only asks first.

   TAKE IT DOWN. While a beat this page sent is up (the overlay up is its id, inside its 12 seconds), its button reads "Take it down" (standard, never pressed: the pressed look in the row is the thing's state) and takes
   off that beat only (never another overlay). The card draws again when the 12 seconds are over.

   API
     buttons(ctx) -> [button]     the 'show' slot (ctx: the zoom card's); none while the page has no host (room.key off, no GM page)
     make(host) -> { buttons(ctx), send(ctx, which) -> Promise<bool>, down(ctx, which) -> Promise<bool>, isUp(ctx, which) -> bool }
       host (an object, or a function that returns the current one) = { show(kind, payload, opts) -> Promise<answer | null>,
                hidden() -> [name], rooms() -> [the site's hidden names], namesHit(text, names) -> bool, npcs() -> [{ id, name, alias, revealed }], reveal(id) -> Promise,
                ask(msg, yesLabel) -> Promise<bool> (the page's own confirm: the kit's dialog on the kit desk), overlayId() -> the id up now,
                clear() -> Promise (the overlay off), toast(text, bad) }
       The page's is B68GmPage.roomShow() (null while room.key is off).
     Pure: payload(thing, which) -> { text, sub? } | null   cut(text)   keyOf(ctx, which)   hits(payload, names, namesHit) -> [name]
           WHICH, MS, KIND, QUESTION, ROOM_QUESTION */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmRoomShow = M;
})(typeof self !== 'undefined' ? self : this, function (root) {
  'use strict';

  var KIND = 'title', MS = 12000, TEXT_MAX = 80, SUB_MAX = 120;
  var WHICH = ['thing', 'look'];
  var QUESTION = 'This names someone hidden: reveal and show?', ROOM_QUESTION = "This names something the players haven't seen yet: show anyway?";
  var LABEL = { thing: 'Show on iPad', look: 'Show the closer look' }, DOWN = 'Take it down';
  var UP_TITLE = { thing: 'On the iPad now: the name and its line. Take it down', look: 'On the iPad now: the closer look. Take it down' };
  var TITLE = { thing: 'The name and its line on the iPad, for 12 seconds', look: 'The name and the closer look on the iPad, for 12 seconds' };

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function list(v) { return Array.isArray(v) ? v : []; }
  function flat(s) { return str(s).replace(/\s+/g, ' ').trim(); }
  function fold(s) { return flat(s).toLowerCase(); }
  /* at most n characters, cut at a word where it can be, with an ellipsis (the parser's limits already fit: this is a guard) */
  function clip(s, n) {
    s = flat(s); if (s.length <= n) return s;
    var c = s.slice(0, n - 1), sp = c.lastIndexOf(' ');
    return (sp > n / 2 ? c.slice(0, sp) : c).replace(/[\s,;:.]+$/, '') + '…';
  }
  function upper(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function mod(name, file) {
    if (root && root[name]) return root[name];
    if (file && typeof require === 'function') { try { return require(file); } catch (e) { /* not under Node */ } }
    return null;
  }

  /* ---------- pure ---------- */
  /* the beat for one line of a thing: 'thing' (name + line) or 'look' (name + closer look); anything else (the roll, the danger) is null */
  /* THE SAFETY NET. A roll or a danger written without its dash, or typed on the thing's first line, is folded by the parser into the line or
     the closer look. So what goes is cut at the first roll or danger marker: the dice or a warning sign anywhere, a "!" that starts the text or
     follows a space (not one inside prose: "Look out! The floor creaks" stays whole), or "Roll:" or "Danger:" at the start of a word. */
  var MARK = /🎲|⚠|(?:^|\s)!|\b(?:roll|danger)\s*:/i;
  function cut(s) { s = flat(s); var m = MARK.exec(s); return m ? flat(s.slice(0, m.index)).replace(/[\s,;:(–—-]+$/, '') : s; }
  function payload(t, which) {
    if (!isObj(t) || WHICH.indexOf(which) < 0) return null;
    var text = clip(cut(t.name), TEXT_MAX); if (!text) return null;
    var sub = which === 'look' ? cut(t.look) : cut(t.line);
    if (which === 'look' && !sub) return null;
    var out = { text: text };
    if (sub) out.sub = upper(clip(sub, SUB_MAX));
    return out;
  }
  /* the beat's key: the same thing's same line from either GM page is the same opaque id (gm/show.js hashes it), so it shows once */
  function keyOf(ctx, which) {
    var c = isObj(ctx) ? ctx : {}, t = isObj(c.thing) ? c.thing : {};
    return 'room.show|' + str(c.rollKey) + '|' + str(c.room) + '|' + str(t.slug) + '|' + which;
  }
  /* the hidden names a beat's words hold (whole word, any case: the page's namesHit), each once */
  function hits(p, names, namesHit) {
    if (!isObj(p) || typeof namesHit !== 'function') return [];
    var words = [str(p.text), str(p.sub)].filter(Boolean), seen = {};
    return list(names).filter(function (n) {
      if (typeof n !== 'string' || !flat(n) || seen[fold(n)]) return false;
      var hit = words.some(function (w) { return namesHit(w, [n]); });
      if (hit) seen[fold(n)] = 1;
      return hit;
    });
  }

  /* ---------- the slot ---------- */
  function make(host0) {
    var upTo = {};      /* beat id -> when its 12 seconds end, for the beats this page sent */
    function H() { var h = typeof host0 === 'function' ? host0() : host0; return isObj(h) ? h : null; }
    function call(name, a, b) { var h = H(); try { return h && typeof h[name] === 'function' ? h[name](a, b) : null; } catch (e) { return null; } }
    function toast(t, bad) { call('toast', t, !!bad); }
    function namesHit(t, n) { var h = H(); return !!(h && typeof h.namesHit === 'function' && h.namesHit(t, n)); }
    function idOf(ctx, which) { var S = mod('B68Show', './show.js'); return S && typeof S.idFor === 'function' ? S.idFor(keyOf(ctx, which)) : ''; }
    function isUp(ctx, which) { var id = idOf(ctx, which); return !!id && (upTo[id] || 0) > Date.now() && str(call('overlayId')) === id; }
    function later(fn, ms) { if (root && typeof root.setTimeout === 'function') root.setTimeout(fn, ms); }

    /* the names gate: -> Promise<true> to send; false when the GM said no, or the words name something that cannot be revealed here */
    function cleared(p) { return people(p).then(function (ok) { return ok ? rooms(p) : false; }); }
    /* a hidden room of the site (tokenHidden): asked, never opened from here; room names are often common words, so a yes sends the line alone */
    function rooms(p) {
      var found = hits(p, list(call('rooms')), namesHit);
      if (!found.length) return Promise.resolve(true);
      var h0 = H(), q;
      try { q = h0 && typeof h0.ask === 'function' ? h0.ask(ROOM_QUESTION + ' (' + found.join(', ') + ')', 'Show anyway') : false; } catch (e) { q = false; }
      return Promise.resolve(q).then(function (yes) { if (yes !== true) { toast('Not shown.'); return false; } return true; }, function () { return false; });
    }
    function people(p) {
      var found = hits(p, list(call('hidden')), namesHit);
      if (!found.length) return Promise.resolve(true);
      var people = list(call('npcs')).filter(function (n) {
        return isObj(n) && n.revealed !== true && found.some(function (f) { return fold(f) === fold(n.name) || (!!flat(n.alias) && fold(f) === fold(n.alias)); });
      });
      var theirs = {}; people.forEach(function (n) { theirs[fold(n.name)] = 1; if (flat(n.alias)) theirs[fold(n.alias)] = 1; });
      var other = found.filter(function (f) { return !theirs[fold(f)]; });
      if (other.length) { toast('Not shown: it names something hidden, the clock ' + other.join(', ') + '. Show that clock on the table first.', true); return Promise.resolve(false); }
      var who = people.map(function (n) { return flat(n.name); }).join(', ');
      var h0 = H(), q;
      try { q = h0 && typeof h0.ask === 'function' ? h0.ask(QUESTION + ' ' + who + ' will be revealed to everyone, and the line goes on the iPad.', 'Reveal and show') : false; } catch (e) { q = false; }
      return Promise.resolve(q).then(function (yes) {
        if (yes !== true) { toast('Not shown: ' + who + ' stays hidden.'); return false; }
        return revealAll(p, people);
      }, function () { return false; });
    }
    function revealAll(p, people) {
      return people.reduce(function (pr, n) {
        return pr.then(function (ok) {
          if (!ok) return false;
          var h = H(), r;
          try { r = h && typeof h.reveal === 'function' ? h.reveal(n.id) : Promise.reject(new Error('no reveal')); } catch (e) { r = Promise.reject(e); }
          return Promise.resolve(r).then(function () { return true; }, function () { toast('Could not reveal ' + flat(n.name) + '.', true); return false; });
        });
      }, Promise.resolve(true)).then(function (ok) {
        if (!ok) return false;
        var still = hits(p, list(call('hidden')), namesHit);      /* revealed now: nothing hidden may be left in the words */
        if (still.length) { toast('Not shown: it still names something hidden (' + still.join(', ') + ').', true); return false; }
        return true;
      });
    }

    function send(ctx, which) {
      var p = payload(ctx && ctx.thing, which), h = H();
      if (!p) return Promise.resolve(false);
      if (!h || typeof h.show !== 'function' || typeof h.namesHit !== 'function') { toast('The iPad is not available here.', true); return Promise.resolve(false); }
      return cleared(p).then(function (go) {
        var h2 = go ? H() : null;
        if (!h2 || typeof h2.show !== 'function') return false;
        var id = idOf(ctx, which);
        return Promise.resolve(h2.show(KIND, p, { ms: MS, key: keyOf(ctx, which) })).then(function (r) {
          if (r == null) return false;      /* refused: the page has said why */
          if (id) upTo[id] = Date.now() + MS;
          toast('On the iPad for 12 seconds: ' + p.text + '.');
          later(function () { if (ctx && typeof ctx.refresh === 'function') ctx.refresh(); }, MS + 400);
          return true;
        });
      });
    }
    function down(ctx, which) {
      var id = idOf(ctx, which);
      if (!id || str(call('overlayId')) !== id) { if (id) delete upTo[id]; return Promise.resolve(false); }      /* gone already, or something else is up: left alone */
      return Promise.resolve(call('clear')).then(function () { delete upTo[id]; return true; });
    }

    function buttons(ctx) {
      var h = H();
      if (!h || typeof h.show !== 'function' || !isObj(ctx) || !isObj(ctx.thing)) return [];
      var out = [];
      WHICH.forEach(function (w) {
        if (!payload(ctx.thing, w)) return;
        var up = isUp(ctx, w);
        out.push({ id: 'show-' + w, label: up ? DOWN : LABEL[w], rank: 'standard', pressed: false,      /* never the dark pressed look: that is the thing's state (RK11), one per card */
          title: up ? UP_TITLE[w] : TITLE[w],
          run: function (c) { return up ? down(c || ctx, w) : send(c || ctx, w); } });
      });
      return out;
    }
    return { buttons: buttons, send: send, down: down, isUp: isUp };
  }

  /* the page's slot: one maker for the page, asking B68GmPage.roomShow() for the host each time (null while room.key is off) */
  function pageHost() { var P = mod('B68GmPage'); try { return P && typeof P.roomShow === 'function' ? P.roomShow() : null; } catch (e) { return null; } }
  var slot = make(pageHost);

  return { buttons: function (ctx) { return slot.buttons(ctx); }, make: make, payload: payload, cut: cut, keyOf: keyOf, hits: hits, WHICH: WHICH, MS: MS, KIND: KIND, QUESTION: QUESTION, ROOM_QUESTION: ROOM_QUESTION };
});
