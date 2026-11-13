/* gm/players-intro.js: the GM's half of the NPC introduction (IP3 of the players' screen build, behind the setting stage.players). B68GmIntro.

   With the setting on, Introduce for ONE NPC (the cast list's Introduce, the Run view's people rows, the cue "Blade, introduce <name>") is
   "Show on iPad, with an opening": an ordinary display push of kind npc through the page's one push queue, carrying intro: true and the look
   (the Tell expression and the Signature pose, names from the fixed lists of display/face-look.js, worked out here from the NPC's GM notes;
   the notes never leave this page). The iPad plays a title card (display/players/intro.js) and is left on the ordinary npc stage, so a reload
   shows the NPC. A hidden NPC is asked about first, in the same words as Show on iPad, and revealed only on a yes. Two or more names stay the
   rolodex beat (the cue grammar sends those as before).

   The tray: "Introducing <name>" while the card plays (this page's clock: the push answer plus the card's length), then the ordinary line.

   API (window.B68GmIntro; module.exports under Node)
     introduce(id, host, opts?) -> Promise<the push answer (with undo() when opts.quiet) | { notShown: reason } (opts.cue) | null>     look(gmNotes) -> { expr?, pose? } | null     live(shown, nowMs) -> name | ''
     body(id, d) -> the display push      CARD_MS
     host: { npc(id) -> the cast doc | null, ask(msg, go) (the page's confirm), reveal(id, d) -> Promise, push(display) -> Promise (pushDisplay),
             toast(msg, bad), errText(e), tray() (repaint the tray), takeDown(title) (Take it down while that NPC is up), blocked?() -> a reason the card cannot go up now | '', later?(fn, ms) } */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmIntro = M;
})(typeof self !== 'undefined' ? self : this, function (W) {
  'use strict';

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function req(name, p) { if (W && W[name]) return W[name]; try { return require(p); } catch (e) { return null; } }

  /* the card's length on the iPad: the lead (display/players/intro.js LEAD_MS) and the card to its end (T.end) */
  var CARD_MS = 800 + 6200;
  var last = null;      /* { names: [name, alias], until } the card this page last sent */

  function look(notes) {
    var FL = req('B68FaceLook', '../display/face-look.js');
    if (!FL || typeof FL.parseNotes !== 'function') return null;
    var p = FL.parseNotes(notes), out = {};
    if (p.tell) out.expr = p.tell;
    if (p.signature) out.pose = p.signature;
    return FL.clean(out);
  }
  function body(id, d) {
    var b = { kind: 'npc', npcId: str(id), title: str(d && d.name).slice(0, 2000), intro: true }, lk = look(d && d.gmNotes);
    if (lk) b.look = lk;
    return b;
  }
  function live(shown, now) {
    if (!last || !isObj(shown) || shown.kind !== 'npc' || !(now < last.until)) return '';
    var t = str(shown.title);
    return t && last.names.indexOf(t) >= 0 ? t : '';
  }

  /* opts.quiet (the cue "Blade, introduce X", which says its own one toast with an Undo): no toast here, and the answer carries undo(), which
     takes the NPC down while it is still what the iPad shows.
     opts.cue (a reveal cue, IP3b item 6: the cue stack's `reveal:` and the grammar's "reveal <name>", after their own reveal has been written): quiet as
     above, never asks, and when the card cannot go up (host.blocked() names a reason: the iPad on Blank, the hard start running, the iPad frozen; or
     the push fails) it says nothing either and answers { notShown: reason }, so the caller says ONE thing: revealed, but not shown, and why. */
  function introduce(id, host, opts) {
    host = host || {}; opts = opts || {};
    if (opts.cue) opts.quiet = true;
    var d = typeof host.npc === 'function' ? host.npc(id) : null, name = isObj(d) ? str(d.name) : '';
    var toast = typeof host.toast === 'function' ? host.toast : function () {};
    var errText = typeof host.errText === 'function' ? host.errText : function (e) { return e && e.message || String(e || 'unknown error'); };
    if (!isObj(d)) return Promise.resolve(opts.cue ? { notShown: 'they are not in the cast here' } : null);
    if (opts.cue) {
      if (d.revealed !== true) return Promise.resolve({ notShown: 'they are not revealed' });      /* never a hidden person: the reveal's own write comes first */
      var why = typeof host.blocked === 'function' ? str(host.blocked()) : '';
      if (why) return Promise.resolve({ notShown: why });
    }
    function go() {
      var pre = d.revealed === true ? Promise.resolve() : Promise.resolve().then(function () { return host.reveal(id, d); });
      return pre.then(function () { return host.push(body(id, d)); }).then(function (r) {
        last = { names: [name, str(d.alias).trim()].filter(Boolean), until: Date.now() + CARD_MS };
        if (typeof host.tray === 'function') {
          host.tray();
          var later = typeof host.later === 'function' ? host.later : function (f, ms) { return setTimeout(f, ms); };
          later(function () { host.tray(); }, CARD_MS + 50);
        }
        if (!opts.quiet) { toast('Introducing ' + (name || 'them') + '.'); return r; }
        var title = body(id, d).title;
        return Object.assign({}, isObj(r) ? r : {}, { undo: function () { return typeof host.takeDown === 'function' ? host.takeDown(title) : null; } });
      }, function (e) {
        if (opts.cue) return { notShown: e && e.superseded ? 'a newer push replaced it' : errText(e) };
        if (!e || !e.superseded) toast('Could not introduce ' + (name || 'them') + ' on the iPad: ' + errText(e), true);
        return null;
      });
    }
    if (d.revealed === true) return go();
    /* hidden: the same question as Show on iPad, through the page's own confirm (the kit's dialog when the desk is on) */
    host.ask('Reveal and show? ' + (name || 'This NPC') + ' is hidden from the players. This reveals them to everyone and shows them on the iPad.', function () { go(); });
    return Promise.resolve(null);
  }

  return { introduce: introduce, look: look, body: body, live: live, CARD_MS: CARD_MS, _reset: function () { last = null; } };
});
