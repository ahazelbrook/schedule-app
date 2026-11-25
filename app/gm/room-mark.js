/* gm/room-mark.js: a thing's state (RK11 of the room key build; setting room.key, bundle room-key).

   Window.B68GmRoomMark; in Node, require() returns the same object. GM page only: nothing here is sent anywhere or drawn on the iPad or a phone.
   It defines its module when it loads and reads no other module at all: the zoom card's module hands it a ctx, and the page's room-state
   instance (ctx.rs, room-state.js, the only writer of `roomstate`) does the writing.

   THE STATE BUTTONS. The zoom card's 'state' slot asks buttons(ctx), on every draw. One button for each state the thing allows, in the note's order:
   the thing's own State: list (full · empty, on · off), else found · taken · gone. The thing's mark (ctx.state) is the pressed one. One tap writes
   the mark; a tap on the pressed one takes it away, so on / off is one tap each way. A mark that is not in the list (the note was edited since) shows
   as a Clear button, so it can always be taken off. Nothing marked is the thing as the room's note has it.
   The mark is room-state's marks: { <slug>: <state> } of the room (ctx.rollKey, ctx.roomKey), so it survives a reload and two devices merge key by
   key. It is never rolled text, and never reaches the display, a phone or the server's other parts. A taken or gone mark dims the thing on the room
   card (the zoom card's module); every other state shows as a chip only.
   With no writer (ctx.rs null: the kit desk's preview, or a page that is not the live one) or no place for the room in the roll, the buttons are drawn
   but disabled, with a title saying why, and the card shows the state read-only. Nothing here throws on a bad ctx: a bad one has no buttons.

   API   B68GmRoomMark.buttons(ctx) -> [{ label, run(ctx), rank, title, pressed, disabled, id }]   (the zoom card's hook)
   Pure: statesOf(thing) -> [state]   label(state)   markOf(ctx) -> the thing's mark now   WHY, DEFAULT_STATES, MAX */
(function (root, factory) {
  'use strict';
  var M = factory(root);
  if (typeof module === 'object' && module && module.exports) module.exports = M;
  else root.B68GmRoomMark = M;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULT_STATES = ['found', 'taken', 'gone'];
  var MAX = 4;      /* room-things.js allows 4 states a thing */
  var WHY = {
    writer: 'Marks are changed on the live GM page.',
    place: 'This room has no place in a saved roll yet.',
    fail: 'The mark was not saved. A room keeps at most 20 marks, and the setting must be on.'
  };

  function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }
  function str(v) { return typeof v === 'string' ? v : v == null ? '' : String(v); }
  function low(s) { return str(s).replace(/\s+/g, ' ').trim().toLowerCase(); }

  /* the states a thing allows: its State: list (lower case, no repeats, at most 4), else found · taken · gone */
  function statesOf(thing) {
    var out = [], src = isObj(thing) && Array.isArray(thing.states) ? thing.states : [];
    src.forEach(function (s) { var t = low(s); if (t && out.indexOf(t) < 0 && out.length < MAX) out.push(t); });
    return out.length ? out : DEFAULT_STATES.slice();
  }
  function label(s) { var t = str(s); return t ? t.charAt(0).toUpperCase() + t.slice(1) : ''; }
  function idOf(s) { return 'mark-' + (low(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'x'); }

  /* the thing's mark right now: read again from the writer when there is one (another device may have written since the card drew), else the ctx's */
  function markOf(ctx) {
    if (!isObj(ctx)) return '';
    var rs = ctx.rs, slug = isObj(ctx.thing) ? str(ctx.thing.slug) : '';
    if (rs && typeof rs.read === 'function' && str(ctx.rollKey) && str(ctx.roomKey) && slug) {
      try { var m = rs.read(str(ctx.rollKey), str(ctx.roomKey)).marks; return isObj(m) ? low(m[slug]) : ''; } catch (e) { /* the ctx's own */ }
    }
    return low(ctx.state);
  }

  /* write one mark (to a state, or null to take it away); a refusal is thrown, and the zoom card toasts it */
  function write(ctx, to) {
    var rs = ctx && ctx.rs;
    if (!rs || typeof rs.setMark !== 'function') throw new Error(WHY.writer);
    if (!str(ctx.rollKey) || !str(ctx.roomKey)) throw new Error(WHY.place);
    if (rs.setMark(str(ctx.rollKey), str(ctx.roomKey), str(ctx.thing && ctx.thing.slug), to) !== true) throw new Error(WHY.fail);
  }

  function buttons(ctx) {
    if (!isObj(ctx) || !isObj(ctx.thing) || !str(ctx.thing.slug)) return [];
    var states = statesOf(ctx.thing), now = low(ctx.state);
    var why = !ctx.rs || typeof ctx.rs.setMark !== 'function' ? WHY.writer : !str(ctx.rollKey) || !str(ctx.roomKey) ? WHY.place : '';
    var out = states.map(function (s) {
      var on = s === now;
      return {
        label: label(s), id: idOf(s), rank: 'standard', pressed: on, disabled: !!why,
        title: why || (on ? label(s) + '. Tap again to take the mark away.' : 'Mark it ' + s + '.'),
        run: function (c) { var cur = markOf(c || ctx); write(c || ctx, cur === s ? null : s); }
      };
    });
    if (now && states.indexOf(now) < 0) {
      out.push({ label: 'Clear', id: 'mark-clear', rank: 'quiet', pressed: false, disabled: !!why,
        title: why || 'It is marked "' + now + '", which the note no longer lists. Take the mark away.',
        run: function (c) { write(c || ctx, null); } });
    }
    return out;
  }

  return { buttons: buttons, statesOf: statesOf, label: label, markOf: markOf, WHY: WHY, DEFAULT_STATES: DEFAULT_STATES, MAX: MAX };
});
